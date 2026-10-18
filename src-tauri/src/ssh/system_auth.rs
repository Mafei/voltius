//! Opt-in, device-local SSH authentication. No private material crosses IPC or is persisted.
use crate::error::{AppError, ErrorCode};
use russh::client::{self, AuthResult};
use russh::keys::{agent::client::AgentClient, ssh_key::PublicKey, PrivateKeyWithHashAlg};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::AsyncReadExt;
use zeroize::Zeroizing;

const MAX_IDENTITIES: usize = 3;
const MAX_FILE_BYTES: u64 = 256 * 1024;
const DEFAULT_KEYS: [&str; 3] = ["id_ed25519", "id_ecdsa", "id_rsa"];

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SystemAuth {
    pub mode: Mode,
    #[serde(default)]
    pub identity_files: Vec<String>,
    #[serde(default)]
    pub use_config: bool,
    pub config_host: Option<String>,
    pub identities_only: Option<bool>,
    pub credential_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Keys,
    Agent,
}

#[derive(Default, Debug, PartialEq, Eq)]
struct Config {
    identities: Vec<String>,
    identities_only: Option<bool>,
    identities_specified: bool,
}

fn problem(code: &str, message: &str) -> AppError {
    format!("SYSTEM_SSH_{code}: {message}").into()
}

/// Deliberately small OpenSSH subset. Never executes ProxyCommand/Match exec or expands shell variables.
fn words(line: &str) -> Result<Vec<String>, AppError> {
    let mut result = Vec::new();
    let mut word = String::new();
    let mut quote = None;
    let mut escaped = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if escaped {
            word.push(c);
            escaped = false;
            continue;
        }
        if c == '\\'
            && quote != Some('\'')
            && chars.peek().is_some_and(|next| {
                next.is_whitespace() || matches!(*next, '\\' | '"' | '\'' | '#')
            })
        {
            escaped = true;
            continue;
        }
        if let Some(q) = quote {
            if c == q {
                quote = None;
            } else {
                word.push(c);
            }
        } else if c == '#' {
            break;
        } else if c == '\'' || c == '"' {
            quote = Some(c);
        } else if c.is_whitespace() || (c == '=' && result.is_empty()) {
            if !word.is_empty() {
                result.push(std::mem::take(&mut word));
            }
        } else {
            word.push(c);
        }
    }
    if escaped || quote.is_some() {
        return Err(problem(
            "CONFIG_INVALID",
            "Unterminated config quote or escape.",
        ));
    }
    if !word.is_empty() {
        result.push(word);
    }
    Ok(result)
}

fn wildcard(pattern: &str, value: &str) -> bool {
    // Bounded dynamic programming; no regex backtracking or shell expansion.
    let value: Vec<_> = value.chars().collect();
    let mut row = vec![false; value.len() + 1];
    row[0] = true;
    for c in pattern.chars() {
        let mut next = vec![false; row.len()];
        for i in 0..row.len() {
            next[i] = if c == '*' {
                row[i] || (i > 0 && next[i - 1])
            } else {
                i > 0 && row[i - 1] && (c == '?' || c == value[i - 1])
            };
        }
        row = next;
    }
    row[value.len()]
}

fn matches_host(patterns: &[String], host: &str) -> bool {
    let host = host.to_lowercase();
    let matches = |p: &str| wildcard(&p.to_lowercase(), &host);
    !patterns
        .iter()
        .any(|p| p.strip_prefix('!').is_some_and(matches))
        && patterns
            .iter()
            .filter(|p| !p.starts_with('!'))
            .any(|p| matches(p))
}

fn parse_config(text: &str, host: &str) -> Result<Config, AppError> {
    if host.len() > 1024 {
        return Err(problem("CONFIG_INVALID", "Config host is too long."));
    }
    let mut config = Config::default();
    let mut active = true;
    for line in text.lines() {
        let values = words(line)?;
        let Some(key) = values.first() else {
            continue;
        };
        let args = &values[1..];
        match key.to_ascii_lowercase().as_str() {
            "host" => {
                if args.iter().any(|p| p.len() > 1024) { return Err(problem("CONFIG_INVALID", "Host pattern is too long.")); }
                active = matches_host(args, host);
            },
            // Ignoring these can apply the wrong IdentityFile/IdentitiesOnly. Fail closed instead.
            "match" | "include" => return Err(problem("CONFIG_UNSUPPORTED", "Match and Include are unsupported. Disable config lookup and specify local identity paths.")),
            "identityfile" if active => {
                if args.len() != 1 { return Err(problem("CONFIG_INVALID", "IdentityFile requires one quoted path.")); }
                config.identities_specified = true;
                if !args[0].eq_ignore_ascii_case("none") && !config.identities.contains(&args[0]) { config.identities.push(args[0].clone()); }
            },
            "identitiesonly" if active && config.identities_only.is_none() => {
                config.identities_only = Some(match args.first().map(String::as_str) {
                    Some("yes") => true, Some("no") => false,
                    _ => return Err(problem("CONFIG_INVALID", "IdentitiesOnly must be yes or no.")),
                });
            },
            _ => {}, // Routing, user, ports, forwarding and commands stay under Voltius settings.
        }
    }
    Ok(config)
}

fn identity_path(value: &str, home: &Path) -> Result<PathBuf, AppError> {
    if value.is_empty()
        || value.contains(['\0', '\n', '\r', '%', '$'])
        || value.starts_with('~') && !value.starts_with("~/") && !value.starts_with("~\\")
    {
        return Err(problem("PATH_INVALID", "Use a literal path or ~/; shell variables, user expansion and % tokens are unsupported."));
    }
    if let Some(rest) = value
        .strip_prefix("~/")
        .or_else(|| value.strip_prefix("~\\"))
    {
        return Ok(home.join(rest));
    }
    let path = PathBuf::from(value);
    Ok(if path.is_absolute() {
        path
    } else {
        home.join(".ssh").join(path)
    })
}

pub(super) async fn read_bounded(
    path: &Path,
    private: bool,
) -> Result<Zeroizing<String>, AppError> {
    let mut options = tokio::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NONBLOCK | libc::O_NOCTTY);
    let file = options.open(path).await.map_err(|_| {
        problem(
            "KEY_UNREADABLE",
            "Local identity file is missing or unreadable.",
        )
    })?;
    let metadata = file
        .metadata()
        .await
        .map_err(|_| problem("KEY_UNREADABLE", "Cannot inspect local identity file."))?;
    if !metadata.is_file() || metadata.len() > MAX_FILE_BYTES {
        return Err(problem(
            "KEY_INVALID",
            "Local identity must be a regular file smaller than 256 KiB.",
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if private && (metadata.mode() & 0o077 != 0 || metadata.uid() != unsafe { libc::geteuid() })
        {
            return Err(problem(
                "KEY_PERMISSIONS",
                "Private key must belong to this user and have no group or other permissions.",
            ));
        }
    }
    #[cfg(not(unix))]
    let _ = private; // Windows access remains governed by the current user's ACLs.
    let mut bytes = Zeroizing::new(Vec::new());
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| problem("KEY_UNREADABLE", "Cannot read local identity file."))?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(problem("KEY_INVALID", "Local identity file is too large."));
    }
    let text = std::str::from_utf8(&bytes).map_err(|_| {
        problem(
            "KEY_INVALID",
            "Local identity file is not a supported text key.",
        )
    })?;
    Ok(Zeroizing::new(text.to_owned()))
}

async fn identities(
    spec: &SystemAuth,
    host: &str,
    home: &Path,
) -> Result<(Vec<PathBuf>, bool), AppError> {
    if spec.identity_files.len() > MAX_IDENTITIES {
        return Err(problem(
            "IDENTITY_LIMIT",
            "Select at most three identity files per connection.",
        ));
    }
    let config = if spec.use_config {
        let path = home.join(".ssh/config");
        if tokio::fs::try_exists(&path).await.unwrap_or(false) {
            parse_config(
                &read_bounded(&path, false).await?,
                spec.config_host
                    .as_deref()
                    .filter(|s| !s.is_empty())
                    .unwrap_or(host),
            )?
        } else {
            Config::default()
        }
    } else {
        Config::default()
    };
    let files = if !spec.identity_files.is_empty() {
        spec.identity_files.clone()
    } else if config.identities_specified {
        config.identities
    } else {
        DEFAULT_KEYS
            .iter()
            .map(|key| format!("~/.ssh/{key}"))
            .collect()
    };
    let mut paths = Vec::new();
    for file in files {
        let path = identity_path(&file, home)?;
        if !paths.contains(&path) {
            paths.push(path);
        }
    }
    if paths.len() > MAX_IDENTITIES {
        return Err(problem("IDENTITY_LIMIT", "Config selects more than three identities. Specify up to three local paths explicitly."));
    }
    Ok((
        paths,
        spec.identities_only
            .or(config.identities_only)
            .unwrap_or(false),
    ))
}

async fn public_identities(paths: &[PathBuf]) -> Vec<PublicKey> {
    let mut keys = Vec::new();
    for path in paths {
        let public = if path.extension().is_some_and(|ext| ext == "pub") {
            path.clone()
        } else {
            let mut name = path.as_os_str().to_os_string();
            name.push(".pub");
            PathBuf::from(name)
        };
        if let Ok(text) = read_bounded(&public, false).await {
            if let Ok(key) = PublicKey::from_openssh(&text) {
                if !keys
                    .iter()
                    .any(|k: &PublicKey| k.key_data() == key.key_data())
                {
                    keys.push(key);
                }
            }
        }
    }
    keys
}

/// One public-key attempt per identity; no automatic legacy-RSA retry or password fallback.
pub(super) async fn authenticate<H: client::Handler>(
    handle: &mut client::Handle<H>,
    username: &str,
    host: &str,
    spec: &SystemAuth,
    passphrase: Option<&str>,
) -> Result<(), AppError> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    return Err(problem(
        "UNAVAILABLE",
        "System SSH authentication is a desktop feature.",
    ));
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let home = dirs::home_dir().ok_or_else(|| {
            problem(
                "HOME_UNAVAILABLE",
                "Cannot locate the current user's home directory.",
            )
        })?;
        authenticate_at(handle, username, host, spec, passphrase, &home).await
    }
}

pub(super) async fn authenticate_at<H: client::Handler>(
    handle: &mut client::Handle<H>,
    username: &str,
    host: &str,
    spec: &SystemAuth,
    passphrase: Option<&str>,
    home: &Path,
) -> Result<(), AppError> {
    let (paths, identities_only) = identities(spec, host, home).await?;
    let mut attempts = 0;
    let mut local_error = None;
    match spec.mode {
        Mode::Keys => {
            let mut offered = Vec::new();
            for path in &paths {
                if attempts >= MAX_IDENTITIES {
                    break;
                }
                if !tokio::fs::try_exists(path).await.unwrap_or(false) {
                    continue;
                }
                let text = match read_bounded(path, true).await {
                    Ok(text) => text,
                    Err(error) => {
                        local_error.get_or_insert(error);
                        continue;
                    }
                };
                let key = match russh::keys::decode_secret_key(&text, passphrase) {
                    Ok(key) => Arc::new(key),
                    Err(_) => {
                        let encrypted = ssh_key::PrivateKey::from_openssh(&text)
                            .is_ok_and(|key| key.is_encrypted())
                            || text.contains("ENCRYPTED");
                        let error = if encrypted {
                            AppError::coded(ErrorCode::SshKeyPassphrase, "SYSTEM_SSH_KEY_PASSPHRASE: Encrypted private key requires a valid passphrase.").with_param("authConnectionId", spec.credential_id.as_deref().unwrap_or(""))
                        } else {
                            problem(
                                "KEY_INVALID",
                                "Cannot decode local private key; check its format and passphrase.",
                            )
                        };
                        local_error.get_or_insert(error);
                        continue;
                    }
                };
                if offered.contains(key.public_key().key_data()) {
                    continue;
                }
                offered.push(key.public_key().key_data().clone());
                attempts += 1;
                let hash = if matches!(key.algorithm(), russh::keys::Algorithm::Rsa { .. }) {
                    super::client::choose_rsa_hash(
                        handle.best_supported_rsa_hash().await.ok().flatten(),
                    )
                } else {
                    None
                };
                let result = handle
                    .authenticate_publickey(username, PrivateKeyWithHashAlg::new(key, hash))
                    .await
                    .map_err(|_| {
                        problem(
                            "AUTH_FAILED",
                            "System key authentication failed or the server closed the connection.",
                        )
                    })?;
                if result.success() {
                    return Ok(());
                }
            }
        }
        Mode::Agent => {
            let stream = super::client::connect_local_agent().await.map_err(|_| problem("AGENT_UNAVAILABLE", "SSH agent is unavailable. Start your user agent and load a key, or choose another authentication mode."))?;
            if authenticate_agent(
                handle,
                username,
                &paths,
                identities_only,
                stream,
                &mut attempts,
            )
            .await?
            {
                return Ok(());
            }
        }
    }
    if let Some(error) = local_error {
        return Err(error);
    }
    if attempts == 0 {
        return Err(problem("NO_IDENTITIES", "No usable local identities. Agent IdentitiesOnly needs matching .pub files; system keys support Ed25519, ECDSA and RSA."));
    }
    Err(problem("KEY_REJECTED", "Server rejected the selected identities. At most three keys are attempted; select one path with IdentitiesOnly to avoid server MaxAuthTries limits."))
}

pub(super) async fn authenticate_agent<H, S>(
    handle: &mut client::Handle<H>,
    username: &str,
    paths: &[PathBuf],
    identities_only: bool,
    stream: S,
    attempts: &mut usize,
) -> Result<bool, AppError>
where
    H: client::Handler,
    S: russh::keys::agent::client::AgentStream + Send + Unpin,
{
    let mut agent = AgentClient::connect(stream);
    let identities = agent
        .request_identities()
        .await
        .map_err(|_| problem("AGENT_UNAVAILABLE", "Cannot list SSH agent public keys."))?;
    let identities: Vec<_> = identities
        .into_iter()
        .filter(|identity| {
            matches!(
                identity,
                russh::keys::agent::AgentIdentity::PublicKey { .. }
            )
        })
        .collect();
    let preferred = public_identities(paths).await;
    let mut keys = Vec::new();
    for key in &preferred {
        if identities
            .iter()
            .any(|identity| identity.public_key().key_data() == key.key_data())
        {
            keys.push(key.clone());
        }
    }
    if !identities_only {
        for identity in identities {
            let key = identity.public_key().into_owned();
            if !keys.iter().any(|k| k.key_data() == key.key_data()) {
                keys.push(key);
            }
        }
    }
    for key in keys.into_iter().take(MAX_IDENTITIES) {
        *attempts += 1;
        let hash = if matches!(key.algorithm(), russh::keys::Algorithm::Rsa { .. }) {
            super::client::choose_rsa_hash(handle.best_supported_rsa_hash().await.ok().flatten())
        } else {
            None
        };
        let result: AuthResult = handle
            .authenticate_publickey_with(username, key, hash, &mut agent)
            .await
            .map_err(|_| {
                problem(
                    "AGENT_SIGN_FAILED",
                    "SSH agent signing failed, was cancelled, or the server closed the connection.",
                )
            })?;
        if result.success() {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn config_scope_negation_quotes_and_first_scalar() {
        let config = parse_config("Host *.example !blocked.example\n IdentityFile \"~/key one\"\n IdentitiesOnly yes\nHost *\n IdentityFile ~/.ssh/id_rsa\n IdentitiesOnly no", "lab.example").unwrap();
        assert_eq!(config.identities, ["~/key one", "~/.ssh/id_rsa"]);
        assert_eq!(config.identities_only, Some(true));
        assert_eq!(
            parse_config(
                "Host *.example !blocked.example\nIdentityFile ~/secret",
                "blocked.example"
            )
            .unwrap(),
            Config::default()
        );
    }
    #[test]
    fn unsupported_config_and_dynamic_paths_fail_without_execution() {
        for config in [
            "Match exec curl secret\nIdentityFile ~/a",
            "Include ~/.ssh/conf.d/*",
            "IdentityFile 'unclosed",
        ] {
            assert!(parse_config(config, "host").is_err());
        }
        for path in ["~other/.ssh/a", "${HOME}/a", "%d/.ssh/a", "a\nb"] {
            assert!(identity_path(path, Path::new("/synthetic")).is_err());
        }
        assert_eq!(
            identity_path("id_ed25519", Path::new("/synthetic")).unwrap(),
            Path::new("/synthetic/.ssh/id_ed25519")
        );
        let none = parse_config("IdentityFile none", "host").unwrap();
        assert!(none.identities_specified && none.identities.is_empty());
        assert_eq!(
            words(r"IdentityFile C:\Users\synthetic\.ssh\id_ed25519").unwrap()[1],
            r"C:\Users\synthetic\.ssh\id_ed25519"
        );
    }
}
