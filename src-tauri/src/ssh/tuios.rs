//! Explicit, user-owned TUIOS sessions. No installs, daemon resets or implicit creation.
use super::exec::{run_session_command as run, sh_c, Captured};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct TuiosSession {
    pub name: String,
    pub id: String,
    pub created: u64,
    #[serde(default)]
    pub saved: bool,
    #[serde(default)]
    pub window_count: u32,
    #[serde(default)]
    pub attached: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TuiosChoice {
    Attach {
        session: TuiosSession,
    },
    Restore {
        session: TuiosSession,
        expected: Option<ExpectedIdentity>,
    },
    Create {
        name: String,
    },
}

#[derive(Clone, Debug, Deserialize)]
pub struct ExpectedIdentity {
    pub id: String,
}

pub struct PendingRestore {
    pub name: String,
    pub expected: Option<ExpectedIdentity>,
}

pub fn validate_name(name: &str) -> Result<(), String> {
    let stem = name.split('.').next().unwrap_or("").to_ascii_lowercase();
    let device = matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
        || (stem.len() == 4
            && (stem.starts_with("com") || stem.starts_with("lpt"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'));
    if name.is_empty()
        || name.len() > 128
        || name.trim() != name
        || name.starts_with('-')
        || name.ends_with('.')
        || name.chars().all(|c| c == '.')
        || name
            .chars()
            .any(|c| c.is_control() || c == '/' || c == '\\')
        || device
    {
        return Err("TUIOS_INVALID_NAME".into());
    }
    Ok(())
}

pub fn list_command() -> String {
    sh_c("LC_ALL=C tuios ls --json", &[])
}

pub fn parse_listing(result: &Captured) -> Result<Vec<TuiosSession>, String> {
    if !matches!(result.code, Some(0 | 3)) {
        return Err("TUIOS_LIST_FAILED".into());
    }
    let mut sessions: Vec<TuiosSession> =
        serde_json::from_slice(&result.stdout).map_err(|_| "TUIOS_INVALID_LIST_RESPONSE")?;
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    for s in &mut sessions {
        validate_name(&s.name)?;
        // The real 0.11 disk listing has no live ID and sets created=0.
        if result.code == Some(3) {
            s.saved = true;
            s.attached = false;
        }
        if (!s.saved && s.id.is_empty())
            || s.id.len() > 128
            || s.id.chars().any(char::is_control)
            || s.created > 9_007_199_254_740_991
            || (!s.id.is_empty() && !ids.insert(s.id.clone()))
            || !names.insert(s.name.clone())
        {
            return Err("TUIOS_INVALID_LIST_RESPONSE".into());
        }
    }
    Ok(sessions)
}

async fn capability<H: russh::client::Handler>(
    handle: &russh::client::Handle<H>,
    command: &str,
    required: &str,
) -> Result<(), String> {
    let result = run(
        handle,
        &sh_c(&format!("LC_ALL=C tuios {command} --help"), &[]),
    )
    .await?;
    if result.code != Some(0) || !result.stdout_text().contains(required) {
        return Err(format!("TUIOS_UNSUPPORTED_CAPABILITY: {command}"));
    }
    Ok(())
}

pub async fn list<H: russh::client::Handler>(
    handle: &russh::client::Handle<H>,
) -> Result<Vec<TuiosSession>, String> {
    capability(handle, "ls", "--json").await?;
    parse_listing(&run(handle, &list_command()).await?)
}

fn matches_identity(a: &TuiosSession, b: &TuiosSession) -> bool {
    !a.id.is_empty() && a.id == b.id && a.created == b.created
}

pub fn launch_command(session: &TuiosSession, restore: bool) -> Result<String, String> {
    validate_name(&session.name)?;
    let verb = if restore { "resurrect" } else { "attach" };
    // A named attach fails when absent. Never use -c/--create or a bare tuios.
    Ok(sh_c(&format!("exec tuios {verb} \"$1\""), &[&session.name]))
}

pub struct TuiosLaunch {
    pub command: String,
    pub session: Option<TuiosSession>,
    pub pending: Option<PendingRestore>,
}

/// Capture the real running identity after the PTY has started resurrection.
pub async fn wait_restored<H: russh::client::Handler>(
    handle: &russh::client::Handle<H>,
    pending: &PendingRestore,
) -> Result<TuiosSession, String> {
    for _ in 0..50 {
        let rows = parse_listing(&run(handle, &list_command()).await?)?;
        if let Some(session) = rows
            .into_iter()
            .find(|s| s.name == pending.name && !s.saved)
        {
            if pending
                .expected
                .as_ref()
                .is_some_and(|e| e.id != session.id)
            {
                return Err("SESSION_ENDED_OR_CHANGED".into());
            }
            return Ok(session);
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    Err("TUIOS_START_NOT_CONFIRMED".into())
}

pub async fn resolve<H: russh::client::Handler>(
    handle: &russh::client::Handle<H>,
    choice: TuiosChoice,
) -> Result<TuiosLaunch, String> {
    let sessions = list(handle).await?;
    let (mut session, restore) = match choice {
        TuiosChoice::Create { name } => {
            validate_name(&name)?;
            if sessions.iter().any(|s| s.name == name) {
                return Err("DUPLICATE_SESSION_NAME".into());
            }
            capability(handle, "new", "--detach").await?;
            capability(handle, "attach", "attach").await?;
            let result = run(handle, &sh_c("tuios new --detach \"$1\"", &[&name])).await?;
            if result.code != Some(0) {
                return Err("TUIOS_START_FAILED".into());
            }
            let session = list(handle)
                .await?
                .into_iter()
                .find(|s| s.name == name && !s.saved)
                .ok_or("TUIOS_START_NOT_CONFIRMED")?;
            (session, false)
        }
        TuiosChoice::Attach { session } => {
            let current = sessions
                .into_iter()
                .find(|s| matches_identity(s, &session) && !s.saved)
                .ok_or("SESSION_ENDED_OR_CHANGED")?;
            capability(handle, "attach", "attach").await?;
            (current, false)
        }
        TuiosChoice::Restore { session, expected } => {
            if !session.saved
                || expected.as_ref().is_some_and(|e| {
                    e.id.is_empty() || e.id.len() > 128 || e.id.chars().any(char::is_control)
                })
            {
                return Err("SESSION_CHANGED".into());
            }
            let current = sessions
                .into_iter()
                .find(|s| {
                    s.saved
                        && if session.id.is_empty() {
                            s.id.is_empty() && s.name == session.name
                        } else {
                            matches_identity(s, &session)
                        }
                })
                .ok_or("SESSION_ENDED_OR_CHANGED")?;
            capability(handle, "resurrect", "resurrect").await?;
            let command = launch_command(&current, true)?;
            let expected = expected
                .or_else(|| (!current.id.is_empty()).then(|| ExpectedIdentity { id: current.id }));
            return Ok(TuiosLaunch {
                command,
                session: None,
                pending: Some(PendingRestore {
                    name: current.name,
                    expected,
                }),
            });
        }
    };
    let command = launch_command(&session, restore)?;
    // Reconnects attach only: restoration is an explicit one-time picker action.
    session.saved = false;
    Ok(TuiosLaunch {
        command,
        session: Some(session),
        pending: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn captured(code: i32, json: &str) -> Captured {
        Captured {
            code: Some(code),
            stdout: json.as_bytes().to_vec(),
            stderr: String::new(),
        }
    }
    #[test]
    fn real_tuios_0_11_saved_rows_do_not_claim_a_live_id() {
        let live = captured(
            0,
            include_str!("../../../tests/native-gates/fixtures/tuios-0.11.0-live.json"),
        );
        assert!(!parse_listing(&live).unwrap()[0].id.is_empty());
        let saved = captured(
            3,
            include_str!("../../../tests/native-gates/fixtures/tuios-0.11.0-saved.json"),
        );
        let rows = parse_listing(&saved)
            .expect("real saved listing must be selectable for explicit restore");
        assert!(rows[0].saved);
        assert!(rows[0].id.is_empty());
        assert_eq!(rows[0].created, 0);
    }

    #[test]
    fn saved_exit_three_is_not_a_running_process() {
        let result = captured(
            3,
            r#"[{"name":"work","id":"a","created":1,"attached":true}]"#,
        );
        let sessions = parse_listing(&result).unwrap();
        assert!(sessions[0].saved);
        assert!(!sessions[0].attached);
        assert!(parse_listing(&captured(1, "[]")).is_err());
        assert!(parse_listing(&captured(0, "not JSON")).is_err());
        assert!(parse_listing(&captured(0, r#"[{"name":"work","created":1}]"#)).is_err());
    }
    #[test]
    fn multiple_saved_rows_without_live_ids_stay_distinct_by_name() {
        let result = captured(
            3,
            r#"[{"name":"a","id":"","created":0},{"name":"b","id":"","created":0}]"#,
        );
        let rows = parse_listing(&result).unwrap();
        assert_eq!(rows.len(), 2);
        assert_ne!(rows[0].name, rows[1].name);
        assert!(rows.iter().all(|s| s.saved && s.id.is_empty()));
    }

    #[test]
    fn duplicate_identity_or_names_are_rejected() {
        assert!(parse_listing(&captured(
            0,
            r#"[{"name":"a","id":"x","created":1},{"name":"b","id":"x","created":2}]"#
        ))
        .is_err());
        assert!(parse_listing(&captured(
            0,
            r#"[{"name":"a","id":"x","created":1},{"name":"a","id":"y","created":2}]"#
        ))
        .is_err());
    }
    #[test]
    fn names_are_quoted_and_attach_never_creates() {
        for bad in [
            "", "..", "abc/def", "abc\\def", " abc", "abc ", "-x", "a\n", "con", "LPT1.txt",
        ] {
            assert!(validate_name(bad).is_err());
        }
        let session = TuiosSession {
            name: "工作 ' $(touch BAD)".into(),
            id: "a".into(),
            created: 1,
            saved: false,
            window_count: 1,
            attached: false,
        };
        let command = launch_command(&session, false).unwrap();
        assert!(command.contains("exec tuios attach"));
        assert!(!command.contains("--create"));
        // sh -c belongs to the quoting wrapper; the backend must never receive attach -c.
        assert!(!command.contains("tuios attach -c"));
        assert!(launch_command(&session, true)
            .unwrap()
            .contains("exec tuios resurrect"));
        assert!(!matches_identity(
            &session,
            &TuiosSession {
                id: "new".into(),
                ..session.clone()
            }
        ));
    }

    #[cfg(unix)]
    #[test]
    fn synthetic_cli_receives_literal_names_and_missing_attach_stays_an_error() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let binary = root.path().join("tuios");
        std::fs::write(&binary, "#!/bin/sh\n[ \"$1\" = attach ] || exit 97\n[ \"$2\" != missing ] || exit 23\nprintf '%s\\n' \"$@\"\n").unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
        let mut session = TuiosSession {
            name: "工作 ' $(touch BAD)".into(),
            id: "synthetic".into(),
            created: 1,
            saved: false,
            window_count: 1,
            attached: false,
        };
        let launch = |s: &TuiosSession| {
            std::process::Command::new("/bin/sh")
                .args(["-c", &launch_command(s, false).unwrap()])
                .current_dir(root.path())
                .env("HOME", root.path())
                .env("PATH", format!("{}:/usr/bin:/bin", root.path().display()))
                .output()
                .unwrap()
        };
        let output = launch(&session);
        assert!(output.status.success());
        assert_eq!(
            String::from_utf8(output.stdout).unwrap(),
            format!("attach\n{}\n", session.name)
        );
        assert!(!root.path().join("BAD").exists());
        session.name = "missing".into();
        assert_eq!(launch(&session).status.code(), Some(23));
    }
}
