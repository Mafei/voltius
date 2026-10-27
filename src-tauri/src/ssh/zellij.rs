//! Running Linux Zellij sessions only. Never restores layouts, installs Zellij or kills a session.
use super::client::SshClient;
use super::exec::sh_c;
use super::multiplexer::{self, Backend, Launch, RemoteSession};
use serde::{Deserialize, Serialize};
use tokio::time::{sleep, Duration};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct ZellijSession {
    pub name: String,
    pub socket_dir: String,
    /// Device + inode of the original live socket. Hard links do not change this identity.
    pub socket_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ZellijChoice {
    Attach { session: ZellijSession },
    Create { name: String },
}

pub struct Scan {
    pub socket_dir: String,
    pub names: Vec<String>,
    pub sessions: Vec<ZellijSession>,
}

pub struct PendingCreation {
    pub name: String,
    pub socket_dir: String,
}

pub fn validate_name(name: &str) -> Result<(), String> {
    validate_existing_name(name)?;
    if name.len() > 48 {
        return Err("ZELLIJ_INVALID_NAME".into());
    }
    Ok(())
}

fn validate_existing_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty()
        || name.len() > 128
        || name.starts_with('-')
        || name == "."
        || name == ".."
        || name.chars().any(|c| c.is_control() || c == '/')
    {
        return Err("ZELLIJ_INVALID_NAME".into());
    }
    Ok(())
}

fn namespace(version: &str) -> Result<String, String> {
    let version_number = version
        .strip_prefix("zellij ")
        .ok_or("ZELLIJ_INVALID_VERSION")?;
    let parts: Vec<_> = version_number.split('.').collect();
    let parsed: Option<Vec<u32>> = parts.iter().map(|p| p.parse().ok()).collect();
    let Some(parts) = parsed else {
        return Err(format!("ZELLIJ_UNSUPPORTED_VERSION: {version}"));
    };
    if parts.len() != 3
        || parts[0] != 0
        || !(43..=45).contains(&parts[1])
        || (parts[1] == 43 && parts[2] < 1)
        || (parts[1] == 45 && parts[2] > 1)
    {
        return Err(format!("ZELLIJ_UNSUPPORTED_VERSION: {version}"));
    }
    // 0.44 introduced a shared protocol-contract namespace; 0.43 uses its exact version.
    Ok(if parts[1] >= 44 {
        "contract_version_1".into()
    } else {
        version_number.into()
    })
}

fn scan_command(namespace: &str) -> String {
    sh_c(
        r#"unset TMUX TMUX_PANE ZELLIJ ZELLIJ_SESSION_NAME ZELLIJ_PANE_ID
[ "$(uname -s)" = Linux ] || { printf 'ZELLIJ_REQUIRES_LINUX\n' >&2; exit 125; }
command -v stat >/dev/null 2>&1 || { printf 'ZELLIJ_REQUIRES_STAT\n' >&2; exit 125; }
voltius_root=${ZELLIJ_SOCKET_DIR:-}
if [ -z "$voltius_root" ]; then
  if [ -n "${XDG_RUNTIME_DIR:-}" ] && [ "$(stat -Lc '%u' "$XDG_RUNTIME_DIR" 2>/dev/null)" = "$(id -u)" ]; then
    voltius_root=$XDG_RUNTIME_DIR/zellij
  else
    voltius_root=${TMPDIR:-/tmp}/zellij-$(id -u)
  fi
fi
voltius_scope=$voltius_root/$1
if [ -d "$voltius_scope" ]; then voltius_scope=$(cd "$voltius_scope" && pwd -P) || exit 125; fi
printf 'VOLTIUS_ZELLIJ_SCOPE\t%s\n' "$voltius_scope"
LC_ALL=C zellij list-sessions --no-formatting"#,
        &[namespace],
    )
}

fn parse_scan(out: &str) -> Result<(String, Vec<(String, bool)>), String> {
    let mut lines = out.lines();
    let scope = lines
        .next()
        .and_then(|s| s.strip_prefix("VOLTIUS_ZELLIJ_SCOPE\t"))
        .filter(|s| !s.chars().any(char::is_control))
        .ok_or("ZELLIJ_INVALID_LIST_RESPONSE")?;
    let mut records = Vec::new();
    for line in lines.filter(|l| !l.is_empty()) {
        // The rightmost metadata delimiter belongs to Zellij, even if a name contains a fake one.
        let split = line
            .rfind(" [Created ")
            .ok_or("ZELLIJ_INVALID_LIST_RESPONSE")?;
        let name = &line[..split];
        validate_existing_name(name)?;
        let metadata = &line[split + 1..];
        let end = metadata
            .find(" ago]")
            .ok_or("ZELLIJ_INVALID_LIST_RESPONSE")?;
        let suffix = metadata[end + 5..].trim();
        let exited = match suffix {
            "" | "(current)" => false,
            "(EXITED - attach to resurrect)" => true,
            _ => return Err("ZELLIJ_INVALID_LIST_RESPONSE".into()),
        };
        if records.iter().any(|(existing, _)| existing == name) {
            return Err("ZELLIJ_INVALID_LIST_RESPONSE".into());
        }
        records.push((name.into(), exited));
    }
    if records.len() > 200 {
        return Err("ZELLIJ_TOO_MANY_SESSIONS".into());
    }
    Ok((scope.into(), records))
}

fn socket_command(scope: &str, names: &[String]) -> String {
    let mut args: Vec<&str> = vec![scope];
    args.extend(names.iter().map(String::as_str));
    sh_c(
        r#"voltius_scope=$1; shift
for voltius_name do
  [ -S "$voltius_scope/$voltius_name" ] || exit 1
  voltius_id=$(stat -Lc '%d:%i' "$voltius_scope/$voltius_name") || exit 1
  printf '%s\t%s\n' "$voltius_id" "$voltius_name"
done"#,
        &args,
    )
}

fn canonical_scope_command(scope: &str) -> String {
    sh_c("cd \"$1\" && pwd -P", &[scope])
}

fn valid_socket_id(id: &str) -> bool {
    let parts: Vec<_> = id.split(':').collect();
    parts.len() == 2
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
}

fn parse_sockets(scope: &str, out: &str, names: &[String]) -> Result<Vec<ZellijSession>, String> {
    let sessions: Result<Vec<_>, String> = out
        .lines()
        .map(|line| {
            let (id, name) = line
                .split_once('\t')
                .ok_or("ZELLIJ_INVALID_SOCKET_RESPONSE")?;
            if !valid_socket_id(id) || !names.iter().any(|n| n == name) {
                return Err("ZELLIJ_INVALID_SOCKET_RESPONSE".into());
            }
            Ok(ZellijSession {
                name: name.into(),
                socket_dir: scope.into(),
                socket_id: id.into(),
            })
        })
        .collect();
    let sessions = sessions?;
    if sessions.len() != names.len()
        || names
            .iter()
            .any(|name| sessions.iter().filter(|s| &s.name == name).count() != 1)
    {
        return Err("ZELLIJ_SESSION_CHANGED_REFRESH_LIST".into());
    }
    Ok(sessions)
}

pub async fn scan(
    handle: &russh::client::Handle<SshClient>,
    version: &str,
) -> Result<Scan, String> {
    let result = multiplexer::run(handle, &scan_command(&namespace(version)?)).await?;
    if result.code != Some(0)
        && !(result.code == Some(1) && result.stderr.contains("No active zellij sessions found."))
    {
        return Err(format!("ZELLIJ_LIST_FAILED: {}", result.stderr.trim()));
    }
    let (scope, records) = parse_scan(&result.stdout_text())?;
    let running: Vec<_> = records
        .iter()
        .filter(|(_, exited)| !exited)
        .map(|(name, _)| name.clone())
        .collect();
    let sessions = if running.is_empty() {
        vec![]
    } else {
        let result = multiplexer::run(handle, &socket_command(&scope, &running)).await?;
        if result.code != Some(0) {
            return Err("ZELLIJ_SESSION_CHANGED_REFRESH_LIST".into());
        }
        parse_sockets(&scope, &result.stdout_text(), &running)?
    };
    Ok(Scan {
        socket_dir: scope,
        names: records.into_iter().map(|(name, _)| name).collect(),
        sessions,
    })
}

pub fn create_command(name: &str) -> Result<String, String> {
    validate_name(name)?;
    // Global --session is Zellij's exclusive new-session path. attach -b/-c would reuse names.
    Ok(sh_c("unset TMUX TMUX_PANE ZELLIJ ZELLIJ_SESSION_NAME ZELLIJ_PANE_ID; exec zellij --session \"$1\" options --on-force-close detach", &[name]))
}

const BIND_SCRIPT: &str = r#"set -eu
unset TMUX TMUX_PANE ZELLIJ ZELLIJ_SESSION_NAME ZELLIJ_PANE_ID
[ -S "$1/$2" ] && [ "$(stat -Lc '%d:%i' "$1/$2")" = "$3" ] || { printf 'ZELLIJ_SESSION_ENDED_OR_CHANGED\n' >&2; exit 1; }
voltius_private=$(mktemp -d "$1/.voltius-client.XXXXXXXX") || exit 1
voltius_alias=
trap 'rm -rf -- "$voltius_private" "$voltius_alias"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
voltius_alias=$(mktemp -d /tmp/vzc.XXXXXXXX) || exit 1
mkdir "$voltius_private/$4"
ln -- "$1/$2" "$voltius_private/$4/$2" || { printf 'ZELLIJ_SOCKET_BIND_FAILED\n' >&2; exit 1; }
[ "$(stat -Lc '%d:%i' "$voltius_private/$4/$2")" = "$3" ] || { printf 'ZELLIJ_SESSION_ENDED_OR_CHANGED\n' >&2; exit 1; }
ln -s -- "$voltius_private" "$voltius_alias/s"
voltius_bytes=$(printf '%s' "$voltius_alias/s/$4/$2" | LC_ALL=C wc -c)
[ "$voltius_bytes" -lt 108 ] || { printf 'ZELLIJ_SOCKET_PATH_TOO_LONG\n' >&2; exit 1; }"#;
const ATTACH_TAIL: &str = r#"XDG_CACHE_HOME="$voltius_private/cache" ZELLIJ_SOCKET_DIR="$voltius_alias/s" zellij attach "$2" options --on-force-close detach"#;

pub fn attach_command(session: &ZellijSession) -> Result<String, String> {
    command_with_tail(session, ATTACH_TAIL)
}

fn command_with_tail(session: &ZellijSession, tail: &str) -> Result<String, String> {
    validate_existing_name(&session.name)?;
    let namespace = session.socket_dir.rsplit('/').next().unwrap_or("");
    if !session.socket_dir.starts_with('/')
        || session.socket_dir.chars().any(char::is_control)
        || !(namespace == "contract_version_1" || namespace.starts_with("0.43."))
        || !valid_socket_id(&session.socket_id)
    {
        return Err("ZELLIJ_INVALID_SOCKET_IDENTITY".into());
    }
    Ok(sh_c(
        &format!("{BIND_SCRIPT}\n{tail}"),
        &[
            &session.socket_dir,
            &session.name,
            &session.socket_id,
            namespace,
        ],
    ))
}

pub async fn resolve(
    handle: &russh::client::Handle<SshClient>,
    choice: ZellijChoice,
) -> Result<Launch, String> {
    let version = multiplexer::version(handle, Backend::Zellij)
        .await?
        .ok_or("ZELLIJ_NOT_INSTALLED")?;
    let listing = scan(handle, &version).await?;
    match choice {
        ZellijChoice::Attach { session } => {
            let actual = listing
                .sessions
                .into_iter()
                .find(|s| s.socket_dir == session.socket_dir && s.socket_id == session.socket_id)
                .ok_or("ZELLIJ_SESSION_NOT_RUNNING")?;
            let preflight = multiplexer::run(handle, &command_with_tail(&actual, ":")?).await?;
            if preflight.code != Some(0) {
                return Err(format!(
                    "ZELLIJ_SOCKET_BIND_FAILED: {}",
                    preflight.stderr.trim()
                ));
            }
            Ok(Launch {
                command: attach_command(&actual)?,
                session: Some(RemoteSession::Zellij(actual)),
                pending_tuios: None,
                pending_zellij: None,
            })
        }
        ZellijChoice::Create { name } => {
            validate_name(&name)?;
            if listing.names.contains(&name) {
                return Err("ZELLIJ_DUPLICATE_SESSION_NAME".into());
            }
            Ok(Launch {
                command: create_command(&name)?,
                session: None,
                pending_tuios: None,
                pending_zellij: Some(PendingCreation {
                    name,
                    socket_dir: listing.socket_dir,
                }),
            })
        }
    }
}

pub async fn wait_created(
    handle: &russh::client::Handle<SshClient>,
    pending: &PendingCreation,
) -> Result<RemoteSession, String> {
    tokio::time::timeout(Duration::from_secs(10), async {
        let names = vec![pending.name.clone()];
        for _ in 0..25 {
            // list-sessions opens an IPC connection to every socket. In 0.45.1 that
            // probe can crash an initializing server before FirstClientConnected.
            // Confirm only the exact new socket's metadata; the original PTY client
            // stays responsible for initialization and reports any launch failure.
            let canonical =
                multiplexer::run(handle, &canonical_scope_command(&pending.socket_dir)).await?;
            if canonical.code != Some(0) {
                sleep(Duration::from_millis(200)).await;
                continue;
            }
            let scope = canonical.stdout_text().trim_end_matches('\n').to_string();
            if !scope.starts_with('/') || scope.chars().any(char::is_control) {
                return Err("ZELLIJ_INVALID_SOCKET_IDENTITY".into());
            }
            let result = multiplexer::run(handle, &socket_command(&scope, &names)).await?;
            if result.code == Some(0) {
                let mut sessions = parse_sockets(&scope, &result.stdout_text(), &names)?;
                return Ok(RemoteSession::Zellij(sessions.remove(0)));
            }
            sleep(Duration::from_millis(200)).await;
        }
        Err("ZELLIJ_START_NOT_CONFIRMED_REFRESH_LIST".into())
    })
    .await
    .map_err(|_| "ZELLIJ_START_NOT_CONFIRMED_REFRESH_LIST".to_string())?
}

#[cfg(all(test, target_os = "linux"))]
mod tests;
