use crate::{
    exec::run_captured,
    test_proc_server::{proc_server, ProcOptions},
    tuios::*,
};

#[tokio::test]
#[ignore = "requires VOLTIUS_TEST_TUIOS, a vrec-* daemon and isolated XDG directories; run explicitly"]
async fn real_tuios_create_attach_and_saved_restore_over_loopback_ssh() {
    let binary =
        std::env::var("VOLTIUS_TEST_TUIOS").expect("explicit synthetic CLI fixture required");
    assert!(std::env::var("TUIOS_SERVER").unwrap().starts_with("vrec-"));
    for variable in [
        "XDG_RUNTIME_DIR",
        "XDG_CONFIG_HOME",
        "XDG_DATA_HOME",
        "XDG_STATE_HOME",
        "XDG_CACHE_HOME",
    ] {
        let p = std::env::var(variable).expect("isolated XDG directory required");
        assert!(p.starts_with("/tmp/vrec-") || p.starts_with("/workspace/voltius-recovery-"));
    }
    struct Cleanup(String);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = std::process::Command::new(&self.0)
                .arg("kill-server")
                .output();
        }
    }
    let _cleanup = Cleanup(binary.clone());
    let (handle, _) = proc_server(ProcOptions::default()).await;
    let found = run_captured(&handle, "command -v tuios").await.unwrap();
    assert_eq!(found.stdout_text().trim(), binary);
    let name = "native 工作 ' $(echo BAD)".to_string();
    let created = resolve(&handle, TuiosChoice::Create { name: name.clone() })
        .await
        .unwrap();
    assert!(created.pending.is_none());
    let identity = created.session.unwrap();
    assert!(!identity.saved && !identity.id.is_empty());
    assert_eq!(identity.name, name);
    assert!(resolve(&handle, TuiosChoice::Create { name: name.clone() })
        .await
        .is_err());
    let attached = resolve(
        &handle,
        TuiosChoice::Attach {
            session: identity.clone(),
        },
    )
    .await
    .unwrap();
    let helper = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("pty-client.py");
    let execute = |command: &str| {
        let result = std::process::Command::new("python3")
            .arg(&helper)
            .arg(command)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
    };
    execute(&attached.command);
    let missing = TuiosSession {
        id: "missing-id".into(),
        ..identity.clone()
    };
    assert!(resolve(&handle, TuiosChoice::Attach { session: missing })
        .await
        .is_err());
    assert_eq!(list(&handle).await.unwrap().len(), 1);
    assert_eq!(
        run_captured(&handle, "tuios kill-server")
            .await
            .unwrap()
            .code,
        Some(0)
    );
    let saved = list(&handle).await.unwrap().remove(0);
    assert!(saved.saved && saved.id.is_empty() && saved.created == 0);
    assert!(resolve(
        &handle,
        TuiosChoice::Attach {
            session: saved.clone()
        }
    )
    .await
    .is_err());
    let restored = resolve(
        &handle,
        TuiosChoice::Restore {
            session: saved,
            expected: Some(ExpectedIdentity {
                id: identity.id.clone(),
            }),
        },
    )
    .await
    .unwrap();
    assert!(
        restored.session.is_none(),
        "a disk row must never be represented as an already-running identity"
    );
    execute(&restored.command);
    let pending = restored.pending.unwrap();
    let actual = wait_restored(&handle, &pending).await.unwrap();
    println!(
        "TUIOS_RESTORE_UUID_CONFIRMED old_created={} restored_created={}",
        identity.created, actual.created
    );
    assert_eq!(actual.id, identity.id);
    assert!(actual.created > 0); // A restore starts fresh shells; the UUID is the durable identity.
    assert!(!actual.saved);
    assert!(wait_restored(
        &handle,
        &PendingRestore {
            name,
            expected: Some(ExpectedIdentity {
                id: "wrong-old-tab".into(),
            })
        }
    )
    .await
    .is_err());
}
