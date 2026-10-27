//! Opt-in, device-local SSH authentication. No private material crosses IPC or is persisted.
use crate::error::{AppError, ErrorCode};
use russh::client;
use russh::keys::{ssh_key::HashAlg, PrivateKeyWithHashAlg};
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
    /// Legacy transport flag: lookup is now automatic even when an old client sends false.
    #[serde(default)]
    pub use_config: bool,
    pub config_host: Option<String>,
    pub identities_only: Option<bool>,
    pub credential_id: Option<String>,
    /// Keep wrapper/jump tests inside their synthetic home without changing process HOME.
    #[cfg(test)]
    #[serde(skip)]
    pub test_home: Option<PathBuf>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Keys,
    /// Decode old callers only to return an actionable error before any identity access.
    #[serde(rename = "agent")]
    RemovedAgent,
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
            "match" | "include" => return Err(problem("CONFIG_UNSUPPORTED", "Match and Include are unsupported. Use a supported config or choose vault credentials; no config commands are executed.")),
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
    let path = home.join(".ssh/config");
    let config = if tokio::fs::try_exists(&path).await.unwrap_or(false) {
        parse_config(
            &read_bounded(&path, false).await?,
            spec.config_host
                .as_deref()
                .filter(|s| !s.is_empty())
                .unwrap_or(host),
        )?
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
        #[cfg(test)]
        let home = spec.test_home.clone().unwrap_or(home);
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
    if spec.mode == Mode::RemovedAgent {
        return Err(problem("AGENT_REMOVED", "SSH agent login has been removed. Explicitly choose system private key files or vault credentials before connecting."));
    }
    let (paths, _identities_only) = identities(spec, host, home).await?;
    let mut attempts = 0;
    let mut local_error = None;
    let mut offered = Vec::new();
    let mut public_diagnostics = Vec::new();
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
        let key = match crate::ssh::private_key::decode(&text, passphrase) {
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
        let hash = super::client::key_hash(handle, key.algorithm()).await;
        if key.algorithm().is_rsa() && hash.is_none() {
            return Err(problem("RSA_SHA2_UNAVAILABLE", "System private-key login requires RSA-SHA2 and does not fall back to RSA/SHA1. Choose a compatible key or authentication method."));
        }
        let signer = PrivateKeyWithHashAlg::new(key, hash);
        public_diagnostics.push(format!(
            "{} {}",
            signer.algorithm().as_str(),
            signer.public_key().fingerprint(HashAlg::Sha256)
        ));
        let result = handle
            .authenticate_publickey(username, signer)
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
    if let Some(error) = local_error {
        return Err(error);
    }
    if attempts == 0 {
        return Err(problem("NO_IDENTITIES", "No usable local private-key files. System keys support Ed25519, ECDSA and RSA; this mode does not use ssh-agent."));
    }
    Err(problem("KEY_REJECTED", &format!("Server rejected {attempts} selected local private-key identities. Offered algorithms and public SHA256 fingerprints: {}. At most three keys, without agent or password fallback. Compare with the identity accepted by OpenSSH.", public_diagnostics.join("; "))))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn config_lookup_is_automatic_for_old_false_and_missing_flags_and_explicit_paths_win() {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir(home.path().join(".ssh")).unwrap();
        std::fs::write(
            home.path().join(".ssh/config"),
            "Host synthetic\n IdentityFile ~/.ssh/config-key\n IdentitiesOnly yes\n",
        )
        .unwrap();
        for flag in [None, Some(false), Some(true)] {
            let mut raw = serde_json::json!({"mode":"keys","identityFiles":[]});
            if let Some(flag) = flag {
                raw["useConfig"] = flag.into();
            }
            let mut policy: SystemAuth = serde_json::from_value(raw).unwrap();
            let (paths, only) = identities(&policy, "synthetic", home.path()).await.unwrap();
            assert_eq!(paths, [home.path().join(".ssh/config-key")]);
            assert!(only);
            policy.identity_files = vec!["explicit-key".into()];
            let (paths, only) = identities(&policy, "synthetic", home.path()).await.unwrap();
            assert_eq!(paths, [home.path().join(".ssh/explicit-key")]);
            assert!(only); // Explicit paths do not turn off IdentitiesOnly from config.
        }
        let old: SystemAuth =
            serde_json::from_value(serde_json::json!({"mode":"agent","useConfig":false})).unwrap();
        assert_eq!(old.mode, Mode::RemovedAgent);
    }
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
