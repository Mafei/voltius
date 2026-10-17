use super::*;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Output, Stdio},
    time::{Duration as StdDuration, Instant},
};

#[test]
fn versions_select_the_correct_socket_namespace_and_reject_unknown_protocols() {
    assert_eq!(namespace("zellij 0.43.1").unwrap(), "0.43.1");
    assert_eq!(namespace("zellij 0.44.0").unwrap(), "contract_version_1");
    assert_eq!(namespace("zellij 0.45.1").unwrap(), "contract_version_1");
    for version in [
        "",
        "tmux 3.4",
        "zellij 0.42.2",
        "zellij 0.46.0",
        "zellij 0.45.1-dev",
        "zellij $(printf BAD)",
    ] {
        assert!(namespace(version).is_err(), "{version}");
    }
}

#[test]
fn listing_preserves_literal_new_unicode_and_delimiters_but_separates_exited_names() {
    let (scope, records) = parse_scan("VOLTIUS_ZELLIJ_SCOPE\t/tmp/z/contract_version_1\nNew [Created 1s ago] \n中文 [Created fake ago] ' $x; [Created 2s ago] \nold [Created 5s ago] (EXITED - attach to resurrect)\n").unwrap();
    assert_eq!(scope, "/tmp/z/contract_version_1");
    assert_eq!(
        records,
        vec![
            ("New".into(), false),
            ("中文 [Created fake ago] ' $x;".into(), false),
            ("old".into(), true)
        ]
    );
    assert!(parse_scan("banner\n").is_err());
    assert!(parse_scan("VOLTIUS_ZELLIJ_SCOPE\t/tmp/x\nwrong\n").is_err());
    assert!(parse_scan(
        "VOLTIUS_ZELLIJ_SCOPE\t/tmp/x\nNew [Created 0s ago] \nNew [Created 1s ago] \n"
    )
    .is_err());
    let names = vec!["New".into()];
    let sockets = parse_sockets(&scope, "10:20\tNew\n", &names).unwrap();
    assert_eq!(sockets[0].socket_id, "10:20");
    assert!(parse_sockets(&scope, "10:20\tOther\n", &names).is_err());
    assert!(parse_sockets(&scope, "\n", &names).is_err());
}

#[test]
fn command_arguments_are_data_and_attach_never_requests_creation_or_force_run() {
    for name in [
        "",
        " ",
        "..",
        ".",
        "a/b",
        "a\nb",
        "-option",
        &"x".repeat(49),
    ] {
        assert!(create_command(name).is_err());
    }
    let name = "中文 ' $(touch PWN);";
    let create = create_command(name).unwrap();
    assert!(create.contains("--session"));
    assert!(!create.contains("--create"));
    let session = ZellijSession {
        name: name.into(),
        socket_dir: "/tmp/original/contract_version_1".into(),
        socket_id: "10:20".into(),
    };
    let attach = attach_command(&session).unwrap();
    for forbidden in [
        "--create",
        "--force-run-commands",
        "kill-session",
        "delete-session",
        "--insecure",
    ] {
        assert!(!attach.contains(forbidden), "{forbidden}");
    }
    assert!(attach.contains("--on-force-close detach"));
    assert!(attach.contains("XDG_CACHE_HOME="));
    assert!(attach.contains("ZELLIJ_SOCKET_DIR="));
    assert!(attach_command(&ZellijSession {
        socket_id: "$(touch PWN)".into(),
        ..session
    })
    .is_err());
}

/// Owns only a local synthetic namespace; neither fixture nor production installs on an SSH host.
struct Fixture {
    directory: tempfile::TempDir,
    env: HashMap<String, String>,
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    version: String,
    last_started: u64,
}

impl Fixture {
    fn new(binary: &Path, default_scope: bool) -> Self {
        use std::os::unix::fs::PermissionsExt;
        assert!(
            binary.exists(),
            "Install the pinned Zellij test tool in the isolated runner: {}",
            binary.display()
        );
        let directory = tempfile::Builder::new().prefix("vz-").tempdir().unwrap();
        let root = directory.path();
        for name in [
            "bin",
            "config/zellij",
            "cache",
            "data",
            "runtime",
            "tmp",
            "sockets",
        ] {
            std::fs::create_dir_all(root.join(name)).unwrap();
        }
        std::fs::set_permissions(root.join("runtime"), std::fs::Permissions::from_mode(0o700))
            .unwrap();
        let wrapper = root.join("bin/zellij");
        std::fs::write(
            &wrapper,
            format!(
                "#!/bin/sh\nexec {} \"$@\"\n",
                crate::ssh::exec::shell_quote(binary.to_str().unwrap())
            ),
        )
        .unwrap();
        std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o700)).unwrap();
        // Exercise session/PTY behavior without unrelated default plugin startup or release UI.
        let layout = root.join("config/zellij/fixture.kdl");
        std::fs::write(&layout, "layout { pane; }\n").unwrap();
        let shell = root.join("bin/fixture-shell");
        std::fs::write(
            &shell,
            "#!/bin/sh\nprintf 'VOLTIUS_FIXTURE_READY\\n'\nexec /bin/sh\n",
        )
        .unwrap();
        std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::write(
            root.join("config/zellij/config.kdl"),
            format!(
                "session_serialization true\non_force_close \"quit\"\ndefault_shell \"{}\"\nshow_release_notes false\nshow_startup_tips false\nload_plugins {{}}\ndefault_layout \"{}\"\n",
                shell.display(), layout.display()
            ),
        )
        .unwrap();
        let path = std::env::join_paths(std::iter::once(root.join("bin")).chain(
            std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()),
        ))
        .unwrap();
        let mut env = HashMap::from([
            (
                "ZELLIJ_CONFIG_FILE".into(),
                root.join("config/zellij/config.kdl").display().to_string(),
            ),
            (
                "ZELLIJ_CONFIG_DIR".into(),
                root.join("config/zellij").display().to_string(),
            ),
            ("PATH".into(), path.to_str().unwrap().into()),
            ("TERM".into(), "xterm-256color".into()),
            (
                "XDG_CONFIG_HOME".into(),
                root.join("config").display().to_string(),
            ),
            (
                "XDG_CACHE_HOME".into(),
                root.join("cache").display().to_string(),
            ),
            (
                "XDG_DATA_HOME".into(),
                root.join("data").display().to_string(),
            ),
            (
                "XDG_RUNTIME_DIR".into(),
                root.join("runtime").display().to_string(),
            ),
            ("TMPDIR".into(), root.join("tmp").display().to_string()),
        ]);
        if !default_scope {
            std::os::unix::fs::symlink(root.join("sockets"), root.join("socket-alias")).unwrap();
            env.insert(
                "ZELLIJ_SOCKET_DIR".into(),
                root.join("socket-alias").display().to_string(),
            );
        }
        let script = std::env::var_os("VOLTIUS_ZELLIJ_FIXTURE")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/zellij-pty-fixture.py")
            });
        let mut child = Command::new("python3")
            .arg(script)
            .current_dir(root)
            .env_remove("ZELLIJ_SOCKET_DIR")
            .envs(&env)
            .env_remove("ZELLIJ")
            .env_remove("ZELLIJ_SESSION_NAME")
            .env_remove("TMUX")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let input = child.stdin.take().unwrap();
        let output = BufReader::new(child.stdout.take().unwrap());
        let mut fixture = Self {
            directory,
            env,
            child,
            input,
            output,
            version: String::new(),
            last_started: 0,
        };
        if default_scope {
            fixture.env.remove("ZELLIJ_SOCKET_DIR");
        }
        fixture.version = String::from_utf8(fixture.run("zellij --version").stdout)
            .unwrap()
            .trim()
            .into();
        let check = fixture.run("zellij setup --check");
        let checked = String::from_utf8_lossy(&check.stdout);
        assert!(
            checked.contains(
                fixture
                    .directory
                    .path()
                    .join("cache/zellij")
                    .to_str()
                    .unwrap()
            ),
            "cache must be isolated: {checked}"
        );
        fixture
    }
    fn run(&self, script: &str) -> Output {
        let mut command = Command::new("/bin/sh");
        command
            .args(["-c", script])
            .current_dir(self.directory.path())
            .envs(&self.env)
            .env_remove("TMUX")
            .env_remove("TMUX_PANE")
            .env_remove("ZELLIJ")
            .env_remove("ZELLIJ_SESSION_NAME")
            .env_remove("ZELLIJ_PANE_ID");
        if !self.env.contains_key("ZELLIJ_SOCKET_DIR") {
            command.env_remove("ZELLIJ_SOCKET_DIR");
        }
        command.output().unwrap()
    }
    fn request(&mut self, value: Value) -> Value {
        writeln!(self.input, "{value}").unwrap();
        self.input.flush().unwrap();
        let mut line = String::new();
        self.output.read_line(&mut line).unwrap();
        serde_json::from_str(&line).unwrap_or_else(|_| panic!("fixture did not reply: {line:?}"))
    }
    fn start(&mut self, script: &str) -> u64 {
        let pid = self.request(json!({"op":"start","command":script}))["pid"]
            .as_u64()
            .unwrap();
        self.last_started = pid;
        pid
    }
    fn stop(&mut self, pid: u64) {
        self.request(json!({"op":"stop","pid":pid}));
    }
    fn state(&mut self, pid: u64) -> Value {
        self.request(json!({"op":"output","pid":pid}))
    }
    fn scan(&self) -> Scan {
        let result = self.run(&scan_command(&namespace(&self.version).unwrap()));
        assert!(
            result.status.success()
                || String::from_utf8_lossy(&result.stderr)
                    .contains("No active zellij sessions found."),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        let (scope, records) = parse_scan(std::str::from_utf8(&result.stdout).unwrap()).unwrap();
        let names = records
            .iter()
            .filter(|(_, dead)| !dead)
            .map(|(name, _)| name.clone())
            .collect::<Vec<_>>();
        let sessions = if names.is_empty() {
            vec![]
        } else {
            let output = self.run(&socket_command(&scope, &names));
            assert!(output.status.success());
            parse_sockets(&scope, std::str::from_utf8(&output.stdout).unwrap(), &names).unwrap()
        };
        Scan {
            socket_dir: scope,
            names: records.into_iter().map(|(name, _)| name).collect(),
            sessions,
        }
    }
    fn create_ready(&mut self, name: &str) -> (u64, ZellijSession) {
        let scope = self.scan().socket_dir;
        let pid = self.start(&create_command(name).unwrap());
        let end = Instant::now() + StdDuration::from_secs(12);
        // Socket discovery during startup uses stat only, exactly as production does.
        // Do not IPC-probe a half-initialized Zellij server with list-sessions.
        let names = vec![name.to_string()];
        let mut socket_seen = false;
        while Instant::now() < end {
            let canonical = self.run(&canonical_scope_command(&scope));
            if canonical.status.success() {
                let canonical = String::from_utf8(canonical.stdout).unwrap();
                let canonical = canonical.trim_end_matches('\n');
                let result = self.run(&socket_command(canonical, &names));
                if result.status.success() {
                    let created = parse_sockets(
                        canonical,
                        std::str::from_utf8(&result.stdout).unwrap(),
                        &names,
                    )
                    .unwrap();
                    assert!(created[0].socket_dir.starts_with('/'));
                    assert!(!created[0].socket_dir.contains("socket-alias"));
                    socket_seen = true;
                }
            }
            let state = self.state(pid);
            assert!(state["status"].is_null(), "new client exited: {state}");
            if socket_seen
                && state["output"]
                    .as_str()
                    .unwrap()
                    .contains("VOLTIUS_FIXTURE_READY")
            {
                return (pid, self.wait_session(name));
            }
            std::thread::sleep(StdDuration::from_millis(50));
        }
        panic!("pane did not acknowledge readiness: {}", self.state(pid));
    }
    fn wait_session(&mut self, name: &str) -> ZellijSession {
        let end = Instant::now() + StdDuration::from_secs(12);
        while Instant::now() < end {
            if let Some(session) = self.scan().sessions.into_iter().find(|s| s.name == name) {
                return session;
            }
            std::thread::sleep(StdDuration::from_millis(100));
        }
        let detail = self.state(self.last_started);
        panic!("session did not start: {name}; {detail}");
    }
    fn wait_exit(&mut self, pid: u64) -> Value {
        let end = Instant::now() + StdDuration::from_secs(8);
        while Instant::now() < end {
            let result = self.state(pid);
            if !result["status"].is_null() {
                return result;
            }
            std::thread::sleep(StdDuration::from_millis(50));
        }
        panic!("client did not exit: {}", self.state(pid));
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        if std::thread::panicking() {
            let diagnostic = self.run("find . -name '*.log' -type f -exec sh -c 'printf \"%s\\n\" \"$1\"; tail -35 \"$1\"' x {} \\;");
            eprintln!(
                "isolated Zellij diagnostic: {}",
                String::from_utf8_lossy(&diagnostic.stdout)
            );
        }
        let _ = writeln!(self.input, "{}", json!({"op":"quit"}));
        let _ = self.input.flush();
        let _ = self.child.wait();
        let output = self.run("zellij list-sessions --short --no-formatting");
        for name in String::from_utf8_lossy(&output.stdout).lines() {
            let _ = self.run(&sh_c("zellij kill-session \"$1\"", &[name]));
        }
    }
}

#[test]
fn real_zellij_sessions_bind_exactly_and_never_resurrect_or_steal_clients() {
    let primary = std::env::var("VOLTIUS_TEST_ZELLIJ")
        .expect("Set VOLTIUS_TEST_ZELLIJ to the pinned isolated test binary");
    let mut binaries = vec![PathBuf::from(primary)];
    if let Ok(binary) = std::env::var("VOLTIUS_TEST_ZELLIJ_COMPAT") {
        binaries.push(PathBuf::from(binary));
    }
    for binary in binaries {
        let mut fixture = Fixture::new(&binary, false);
        let name = "中文 ' $(touch PWN);";
        let (first, session) = fixture.create_ready(name);
        assert!(!fixture.directory.path().join("PWN").exists());
        let duplicate = fixture.start(&create_command(name).unwrap());
        let result = fixture.wait_exit(duplicate);
        assert_ne!(result["status"].as_i64(), Some(0), "{result}");
        assert!(
            result["output"]
                .as_str()
                .unwrap()
                .contains("already exists"),
            "{result}"
        );
        let attach = attach_command(&session).unwrap();
        let second = fixture.start(&attach);
        std::thread::sleep(StdDuration::from_millis(700));
        assert!(
            fixture.state(second)["status"].is_null(),
            "{}",
            fixture.state(second)
        );
        fixture.stop(second);
        assert!(
            fixture.state(first)["status"].is_null(),
            "closing one client must preserve another"
        );
        assert_eq!(fixture.wait_session(name).socket_id, session.socket_id);
        fixture.stop(first);
        assert_eq!(fixture.wait_session(name).socket_id,session.socket_id,"all client closes must leave the server alive, even with on_force_close quit in the file");
        assert!(!fixture.directory.path().join("PWN").exists());
        assert!(
            !std::fs::read_dir(&session.socket_dir)
                .unwrap()
                .any(|entry| entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".voltius-client.")),
            "temporary links must be removed"
        );

        // Literal New is an ordinary name in the backend, never the UI's creation sentinel.
        let (exact, target) = fixture.create_ready("New");
        let (prefix, _) = fixture.create_ready("New-longer");
        // Seed a real layout dumped by this synthetic live session. Serialization's
        // background timing is deliberately not used as a test synchronization clock.
        let dumped = fixture.run(&sh_c(
            "zellij --session \"$1\" action dump-layout",
            &["New"],
        ));
        assert!(
            dumped.status.success(),
            "{}",
            String::from_utf8_lossy(&dumped.stderr)
        );
        assert!(!dumped.stdout.is_empty());
        let backup = fixture.directory.path().join("layout-backup.kdl");
        std::fs::write(&backup, &dumped.stdout).unwrap();
        let layout = fixture
            .directory
            .path()
            .join("cache/zellij")
            .join(namespace(&fixture.version).unwrap())
            .join("session_info/New/session-layout.kdl");
        let guarded = attach_command(&target).unwrap();
        // A test-only race after hard-link binding: the original exits immediately before attach.
        let tail = format!("zellij kill-session \"$2\" >/dev/null 2>&1; for voltius_try in 1 2 3 4 5 6 7 8 9 10; do zellij --session \"$2\" action list-clients >/dev/null 2>&1 || break; sleep 0.05; done; mkdir -p {}; cp {} {};\n{ATTACH_TAIL}", crate::ssh::exec::shell_quote(layout.parent().unwrap().to_str().unwrap()), crate::ssh::exec::shell_quote(backup.to_str().unwrap()), crate::ssh::exec::shell_quote(layout.to_str().unwrap()));
        let racing = command_with_tail(&target, &tail).unwrap();
        let racing_pid = fixture.start(&racing);
        let result = fixture.wait_exit(racing_pid);
        assert_ne!(result["status"].as_i64(), Some(0), "{result}");
        let after = fixture.scan();
        assert!(
            !after.sessions.iter().any(|s| s.name == "New"),
            "must not resurrect the exited target"
        );
        assert!(
            after.sessions.iter().any(|s| s.name == "New-longer"),
            "must preserve prefix neighbour"
        );
        assert!(
            after.names.contains(&"New".into()),
            "the original saved layout must remain intact"
        );
        assert_eq!(std::fs::read(&layout).unwrap(), dumped.stdout);
        let missing = fixture.start(&guarded);
        assert_ne!(fixture.wait_exit(missing)["status"].as_i64(), Some(0));
        assert!(
            fixture.state(prefix)["status"].is_null(),
            "must not attach or terminate the prefix neighbour"
        );
        fixture.stop(exact);
        fixture.stop(prefix);
        eprintln!("{}: true create/duplicate, Unicode quoting, exact inode attach, detach cleanup, cached exit race, prefix isolation passed",fixture.version);
    }
}

#[test]
fn real_zellij_default_runtime_scope_matches_the_cli() {
    let binary =
        PathBuf::from(std::env::var("VOLTIUS_TEST_ZELLIJ").expect("isolated Zellij test binary"));
    let mut fixture = Fixture::new(&binary, true);
    let (pid, session) = fixture.create_ready("default-scope");
    assert!(session.socket_dir.contains("runtime/zellij/"));
    let joined = fixture.start(&attach_command(&session).unwrap());
    std::thread::sleep(StdDuration::from_millis(500));
    assert!(
        fixture.state(joined)["status"].is_null(),
        "{}",
        fixture.state(joined)
    );
    fixture.stop(joined);
    fixture.stop(pid);
    assert!(fixture
        .scan()
        .sessions
        .iter()
        .any(|s| s.name == "default-scope"));
}
