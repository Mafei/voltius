//! Shared authenticated picker lifetime and typed user-owned session launches.
use super::client::{AuthenticatedConnection, SshClient};
use super::exec::{run_captured, sh_c, Captured};
use super::{tmux, zellij};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Backend {
    Tmux,
    Zellij,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "backend", content = "choice", rename_all = "camelCase")]
pub enum SessionChoice {
    Tmux(tmux::TmuxChoice),
    Zellij(zellij::ZellijChoice),
}

impl SessionChoice {
    pub fn backend(&self) -> Backend {
        match self {
            Self::Tmux(_) => Backend::Tmux,
            Self::Zellij(_) => Backend::Zellij,
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(tag = "backend", content = "session", rename_all = "camelCase")]
pub enum RemoteSession {
    Tmux(tmux::TmuxSession),
    Zellij(zellij::ZellijSession),
}

#[derive(Debug, Serialize)]
pub struct SessionListing {
    pub backend: Backend,
    pub installed: bool,
    pub version: Option<String>,
    pub sessions: Vec<RemoteSession>,
    /// Includes exited Zellij cache names, which are reserved but never restored here.
    pub reserved_names: Vec<String>,
}

pub async fn run(
    handle: &russh::client::Handle<SshClient>,
    command: &str,
) -> Result<Captured, String> {
    timeout(Duration::from_secs(15), run_captured(handle, command))
        .await
        .map_err(|_| "SESSION_COMMAND_TIMEOUT".to_string())?
}

pub async fn version(
    handle: &russh::client::Handle<SshClient>,
    backend: Backend,
) -> Result<Option<String>, String> {
    let (binary, flag) = match backend {
        Backend::Tmux => ("tmux", "-V"),
        Backend::Zellij => ("zellij", "--version"),
    };
    let result = run(handle, &sh_c(&format!(
        "unset TMUX TMUX_PANE ZELLIJ ZELLIJ_SESSION_NAME ZELLIJ_PANE_ID; command -v {binary} >/dev/null 2>&1 || exit 127; LC_ALL=C {binary} {flag}"
    ), &[])).await?;
    match result.code {
        Some(127) => Ok(None),
        Some(0) => {
            let value = result.stdout_text().trim().to_string();
            if value.len() > 160
                || value.chars().any(char::is_control)
                || !value.starts_with(binary)
            {
                return Err("SESSION_INVALID_VERSION_RESPONSE".into());
            }
            Ok(Some(value))
        }
        _ => Err(format!("SESSION_VERSION_FAILED: {}", result.stderr.trim())),
    }
}

pub async fn list(
    connection: &AuthenticatedConnection,
    backend: Backend,
) -> Result<SessionListing, String> {
    let version = if connection.remote_is_windows {
        None
    } else {
        version(&connection.handle, backend).await?
    };
    let mut listing = SessionListing {
        backend,
        installed: version.is_some(),
        version: version.clone(),
        sessions: vec![],
        reserved_names: vec![],
    };
    let Some(version) = version else {
        return Ok(listing);
    };
    match backend {
        Backend::Tmux => {
            let result = tmux::list(connection).await?;
            listing.reserved_names = result.sessions.iter().map(|s| s.name.clone()).collect();
            listing.sessions = result
                .sessions
                .into_iter()
                .map(RemoteSession::Tmux)
                .collect();
        }
        Backend::Zellij => {
            let result = zellij::scan(&connection.handle, &version).await?;
            listing.reserved_names = result.names;
            listing.sessions = result
                .sessions
                .into_iter()
                .map(RemoteSession::Zellij)
                .collect();
        }
    }
    Ok(listing)
}

pub struct Launch {
    pub command: String,
    pub session: Option<RemoteSession>,
    pub pending_zellij: Option<(String, String)>,
}

pub async fn resolve(
    handle: &russh::client::Handle<SshClient>,
    choice: SessionChoice,
) -> Result<Launch, String> {
    match choice {
        SessionChoice::Tmux(choice) => {
            let session = tmux::resolve_choice(handle, choice).await?;
            Ok(Launch {
                command: tmux::attach_command(&session.id)?,
                session: Some(RemoteSession::Tmux(session)),
                pending_zellij: None,
            })
        }
        SessionChoice::Zellij(choice) => zellij::resolve(handle, choice).await,
    }
}

struct Prepared {
    host: String,
    port: u16,
    username: String,
    backend: Backend,
    connection: AuthenticatedConnection,
}

/// Short-lived, one-use authenticated connections; no passwords or keys are retained here.
#[derive(Clone, Default)]
pub struct SessionPickers(Arc<Mutex<HashMap<String, Prepared>>>);

pub async fn disconnect(connection: &AuthenticatedConnection) {
    let _ = connection
        .handle
        .disconnect(russh::Disconnect::ByApplication, "Picker closed", "en")
        .await;
    for handle in &connection.jump_handles {
        let _ = handle
            .disconnect(russh::Disconnect::ByApplication, "Picker closed", "en")
            .await;
    }
}

impl SessionPickers {
    pub async fn insert(
        &self,
        id: String,
        host: String,
        port: u16,
        username: String,
        backend: Backend,
        connection: AuthenticatedConnection,
    ) -> Result<(), String> {
        // Tokens are fresh UUIDs generated by this client, never an existing terminal id.
        let mut pending = self.0.lock().await;
        if pending.contains_key(&id) {
            drop(pending);
            disconnect(&connection).await;
            return Err("SESSION_PICKER_TOKEN_REUSED".into());
        }
        pending.insert(
            id.clone(),
            Prepared {
                host,
                port,
                username,
                backend,
                connection,
            },
        );
        drop(pending);
        let registry = self.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(300)).await;
            registry.cancel(&id).await;
        });
        Ok(())
    }

    pub async fn take(
        &self,
        id: &str,
        host: &str,
        port: u16,
        username: &str,
        backend: Option<Backend>,
    ) -> Result<AuthenticatedConnection, String> {
        let mut pending = self.0.lock().await;
        let entry = pending.get(id).ok_or("SESSION_PICKER_EXPIRED")?;
        if entry.host != host
            || entry.port != port
            || entry.username != username
            || backend.is_some_and(|backend| backend != entry.backend)
        {
            return Err("SESSION_PICKER_HOST_CHANGED".into());
        }
        Ok(pending
            .remove(id)
            .expect("entry checked under the same lock")
            .connection)
    }

    pub async fn cancel(&self, id: &str) {
        let entry = self.0.lock().await.remove(id);
        if let Some(entry) = entry {
            disconnect(&entry.connection).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn protocol_keeps_backend_and_stable_session_identity_explicit() {
        let tmux: SessionChoice = serde_json::from_value(json!({"backend":"tmux","choice":{"kind":"attach","id":"$0","created":123,"serverPid":42}})).unwrap();
        let zellij: SessionChoice = serde_json::from_value(json!({"backend":"zellij","choice":{"kind":"attach","session":{"name":"New","socket_dir":"/tmp/original/contract_version_1","socket_id":"10:20"}}})).unwrap();
        assert_eq!(tmux.backend(), Backend::Tmux);
        assert_eq!(zellij.backend(), Backend::Zellij);
        assert!(serde_json::from_value::<SessionChoice>(
            json!({"backend":"zellij","choice":{"kind":"resurrect","name":"New"}})
        )
        .is_err());
        assert!(serde_json::from_value::<SessionChoice>(
            json!({"backend":"zellij","choice":{"kind":"attach","session":{"name":"New"}}})
        )
        .is_err());
        let serialized = serde_json::to_value(RemoteSession::Zellij(zellij::ZellijSession {
            name: "New".into(),
            socket_dir: "/tmp/original/contract_version_1".into(),
            socket_id: "10:20".into(),
        }))
        .unwrap();
        assert_eq!(serialized["backend"], "zellij");
        assert_eq!(serialized["session"]["socket_id"], "10:20");
    }
}
