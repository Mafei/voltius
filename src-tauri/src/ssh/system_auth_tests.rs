//! Synthetic loopback SSH and temporary private keys. Never touches the user's home or agent.
#![cfg(unix)]
use super::system_auth::*;
use super::system_auth::{authenticate_at, read_bounded};
use crate::port_forward::test_ssh::{host_key, serve_one};
use russh::keys::{ssh_key::PublicKey, PublicKeyOrCertificate};
use russh::server::Auth;
use std::path::Path;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use std::time::Duration;

struct PinnedClient;
impl russh::client::Handler for PinnedClient {
    type Error = russh::Error;
    async fn check_server_key(
        &mut self,
        key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        Ok(
            matches!(key, PublicKeyOrCertificate::PublicKey { key, .. } if key.key_data() == host_key().public_key().key_data()),
        )
    }
}
struct KeyServer {
    expected: PublicKey,
    offered: Arc<AtomicUsize>,
    signed: Arc<AtomicUsize>,
}
impl russh::server::Handler for KeyServer {
    type Error = russh::Error;
    async fn auth_publickey_offered(
        &mut self,
        _: &str,
        key: &PublicKey,
    ) -> Result<Auth, Self::Error> {
        self.offered.fetch_add(1, Ordering::SeqCst);
        Ok(self.decide(key))
    }
    async fn auth_publickey(&mut self, _: &str, key: &PublicKey) -> Result<Auth, Self::Error> {
        self.signed.fetch_add(1, Ordering::SeqCst);
        Ok(self.decide(key))
    }
}
impl KeyServer {
    fn decide(&self, key: &PublicKey) -> Auth {
        if key.key_data() == self.expected.key_data() {
            Auth::Accept
        } else {
            Auth::Reject {
                proceed_with_methods: Some([russh::MethodKind::PublicKey].as_slice().into()),
                partial_success: false,
            }
        }
    }
}
async fn connection(
    expected: PublicKey,
) -> (
    russh::client::Handle<PinnedClient>,
    Arc<AtomicUsize>,
    Arc<AtomicUsize>,
) {
    let offered = Arc::new(AtomicUsize::new(0));
    let signed = Arc::new(AtomicUsize::new(0));
    let port = serve_one(
        russh::server::Config {
            methods: [russh::MethodKind::PublicKey].as_slice().into(),
            auth_rejection_time: Duration::ZERO,
            auth_rejection_time_initial: Some(Duration::ZERO),
            ..Default::default()
        },
        KeyServer {
            expected,
            offered: offered.clone(),
            signed: signed.clone(),
        },
    )
    .await;
    let mut handle = russh::client::connect(Default::default(), ("127.0.0.1", port), PinnedClient)
        .await
        .unwrap();
    assert!(!handle
        .authenticate_none("synthetic-user")
        .await
        .unwrap()
        .success());
    (handle, offered, signed)
}
fn spec(mode: Mode) -> SystemAuth {
    SystemAuth {
        mode,
        identity_files: Vec::new(),
        use_config: false,
        config_host: None,
        identities_only: None,
        credential_id: Some("synthetic-connection".into()),
    }
}

#[tokio::test]
async fn removed_agent_is_blocked_before_config_keys_or_an_auth_offer() {
    let home = tempfile::tempdir().unwrap();
    let (_, public) = generate(home.path(), "id_ed25519", "");
    let forbidden = home.path().join("must-not-execute");
    std::fs::write(
        home.path().join(".ssh/config"),
        format!(
            "Match exec touch {}\n IdentityFile ~/.ssh/id_ed25519\n",
            forbidden.display()
        ),
    )
    .unwrap();
    let (mut handle, offered, signed) = connection(public).await;
    let old: SystemAuth = serde_json::from_value(
        serde_json::json!({"mode":"agent","useConfig":false,"identityFiles":["~/.ssh/id_ed25519"]}),
    )
    .unwrap();
    let error = authenticate_at(
        &mut handle,
        "synthetic-user",
        "fixture",
        &old,
        None,
        home.path(),
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("AGENT_REMOVED"));
    assert_eq!(offered.load(Ordering::SeqCst), 0);
    assert_eq!(signed.load(Ordering::SeqCst), 0);
    assert!(!forbidden.exists());
}

#[tokio::test]
async fn private_key_attempt_budget_is_three_and_explicit_identity_beats_config() {
    let home = tempfile::tempdir().unwrap();
    let wrong: Vec<_> = (0..3)
        .map(|i| {
            generate(home.path(), &format!("wrong-{i}"), "")
                .0
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    let (wanted, public) = generate(home.path(), "wanted", "");
    std::fs::write(
        home.path().join(".ssh/config"),
        "Host fixture\n IdentityFile ~/.ssh/wrong-0\n IdentitiesOnly yes\n",
    )
    .unwrap();
    let mut policy = spec(Mode::Keys);
    policy.identity_files = wrong;
    let (mut handle, offered, signed) = connection(public.clone()).await;
    assert!(authenticate_at(
        &mut handle,
        "synthetic-user",
        "fixture",
        &policy,
        None,
        home.path()
    )
    .await
    .unwrap_err()
    .to_string()
    .contains("KEY_REJECTED"));
    assert_eq!(offered.load(Ordering::SeqCst), 3);
    assert_eq!(signed.load(Ordering::SeqCst), 0);
    policy.identity_files = vec![wanted.to_string_lossy().into_owned()];
    let (mut handle, offered, signed) = connection(public).await;
    authenticate_at(
        &mut handle,
        "synthetic-user",
        "fixture",
        &policy,
        None,
        home.path(),
    )
    .await
    .unwrap();
    assert_eq!(offered.load(Ordering::SeqCst), 1);
    assert_eq!(signed.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn all_default_files_are_tried_in_a_three_identity_budget_with_rsa_last() {
    let home = tempfile::tempdir().unwrap();
    generate(home.path(), "id_ed25519", "");
    generate_kind(home.path(), "id_ecdsa", "", "ecdsa");
    let (_, public) = generate_kind(home.path(), "id_rsa", "", "rsa");
    let (mut handle, offered, signed) = connection(public).await;
    authenticate_at(
        &mut handle,
        "synthetic-user",
        "fixture",
        &spec(Mode::Keys),
        None,
        home.path(),
    )
    .await
    .unwrap();
    assert_eq!(offered.load(Ordering::SeqCst), 3);
    assert_eq!(signed.load(Ordering::SeqCst), 1);
}
fn generate(home: &Path, name: &str, passphrase: &str) -> (std::path::PathBuf, PublicKey) {
    generate_kind(home, name, passphrase, "ed25519")
}

fn generate_kind(
    home: &Path,
    name: &str,
    passphrase: &str,
    kind: &str,
) -> (std::path::PathBuf, PublicKey) {
    let directory = home.join(".ssh");
    std::fs::create_dir_all(&directory).unwrap();
    let file = directory.join(name);
    let result = std::process::Command::new("ssh-keygen")
        .args(["-q", "-t", kind, "-N", passphrase, "-f"])
        .arg(&file)
        .output()
        .expect("Install openssh-client for synthetic system-auth tests");
    assert!(result.status.success(), "Synthetic key generation failed");
    let public =
        PublicKey::from_openssh(&std::fs::read_to_string(file.with_extension("pub")).unwrap())
            .unwrap();
    (file, public)
}

#[tokio::test]
async fn default_rsa_and_ecdsa_files_authenticate_with_the_shared_signature_negotiation() {
    for (kind, name) in [("rsa", "id_rsa"), ("ecdsa", "id_ecdsa")] {
        let home = tempfile::tempdir().unwrap();
        let (_, public) = generate_kind(home.path(), name, "", kind);
        let (mut handle, _, signed) = connection(public).await;
        authenticate_at(
            &mut handle,
            "synthetic-user",
            "fixture",
            &spec(Mode::Keys),
            None,
            home.path(),
        )
        .await
        .unwrap();
        assert_eq!(signed.load(Ordering::SeqCst), 1);
    }
}

#[tokio::test]
async fn default_key_and_reconnect_authenticate_without_importing() {
    let home = tempfile::tempdir().unwrap();
    let (_, public) = generate(home.path(), "id_ed25519", "");
    for _ in 0..2 {
        let (mut handle, offered, signed) = connection(public.clone()).await;
        authenticate_at(
            &mut handle,
            "synthetic-user",
            "fixture",
            &spec(Mode::Keys),
            None,
            home.path(),
        )
        .await
        .unwrap();
        assert_eq!(signed.load(Ordering::SeqCst), 1);
        assert!(offered.load(Ordering::SeqCst) <= 1);
    }
}

#[tokio::test]
async fn config_alias_quoted_identity_and_none_are_honored_without_executing_commands() {
    let home = tempfile::tempdir().unwrap();
    let (_, public) = generate(home.path(), "key one", "");
    let forbidden = home.path().join("must-not-be-created");
    std::fs::write(home.path().join(".ssh/config"), format!("Host chosen\n IdentityFile \"~/.ssh/key one\"\n IdentitiesOnly yes\n ProxyCommand touch {}\n", forbidden.display())).unwrap();
    let mut policy = spec(Mode::Keys);
    assert!(!policy.use_config); // Legacy false must not disable automatic config lookup.
    policy.config_host = Some("chosen".into());
    let (mut handle, _, signed) = connection(public.clone()).await;
    authenticate_at(
        &mut handle,
        "synthetic-user",
        "different-endpoint",
        &policy,
        None,
        home.path(),
    )
    .await
    .unwrap();
    assert_eq!(signed.load(Ordering::SeqCst), 1);
    assert!(!forbidden.exists());
    std::fs::write(
        home.path().join(".ssh/config"),
        "Host chosen\n IdentityFile none\n",
    )
    .unwrap();
    let (mut handle, offered, _) = connection(public).await;
    assert!(authenticate_at(
        &mut handle,
        "synthetic-user",
        "different-endpoint",
        &policy,
        None,
        home.path()
    )
    .await
    .unwrap_err()
    .to_string()
    .contains("NO_IDENTITIES"));
    assert_eq!(offered.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn encrypted_key_rejects_missing_wrong_passphrases_and_accepts_correct_one_without_leaking() {
    let home = tempfile::tempdir().unwrap();
    let (_, public) = generate(home.path(), "id_ed25519", "synthetic-correct");
    for passphrase in [None, Some("synthetic-wrong"), Some("synthetic-correct")] {
        let (mut handle, offered, signed) = connection(public.clone()).await;
        let result = authenticate_at(
            &mut handle,
            "synthetic-user",
            "fixture",
            &spec(Mode::Keys),
            passphrase,
            home.path(),
        )
        .await;
        if passphrase == Some("synthetic-correct") {
            result.unwrap();
            assert_eq!(signed.load(Ordering::SeqCst), 1);
        } else {
            let error = result.unwrap_err();
            assert_eq!(
                error.code(),
                Some(crate::error::ErrorCode::SshKeyPassphrase)
            );
            let wire = serde_json::to_string(&error).unwrap();
            assert!(wire.contains("synthetic-connection"));
            for secret in [
                "synthetic-correct",
                "synthetic-wrong",
                "PRIVATE KEY",
                &home.path().to_string_lossy(),
            ] {
                assert!(!wire.contains(secret));
            }
            assert_eq!(offered.load(Ordering::SeqCst), 0);
            assert_eq!(signed.load(Ordering::SeqCst), 0);
        }
    }
}

#[tokio::test]
async fn invalid_permissions_invalid_key_and_rejected_auth_are_distinct() {
    use std::os::unix::fs::PermissionsExt;
    let home = tempfile::tempdir().unwrap();
    let (file, public) = generate(home.path(), "id_ed25519", "");
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert!(read_bounded(&file, true)
        .await
        .unwrap_err()
        .to_string()
        .contains("KEY_PERMISSIONS"));
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600)).unwrap();
    std::fs::write(&file, "synthetic-invalid-key-must-not-leak").unwrap();
    let (mut handle, offered, _) = connection(public).await;
    let error = authenticate_at(
        &mut handle,
        "synthetic-user",
        "fixture",
        &spec(Mode::Keys),
        None,
        home.path(),
    )
    .await
    .unwrap_err()
    .to_string();
    assert!(error.contains("KEY_INVALID"));
    assert!(!error.contains("synthetic-invalid-key"));
    assert_eq!(offered.load(Ordering::SeqCst), 0);
    std::fs::remove_file(file).unwrap();
    let (_, actual) = generate(home.path(), "id_ed25519", "");
    let other = tempfile::tempdir().unwrap();
    let (_, expected) = generate(other.path(), "id_ed25519", "");
    assert_ne!(actual, expected);
    let (mut handle, _, signed) = connection(expected).await;
    assert!(authenticate_at(
        &mut handle,
        "synthetic-user",
        "fixture",
        &spec(Mode::Keys),
        None,
        home.path()
    )
    .await
    .unwrap_err()
    .to_string()
    .contains("KEY_REJECTED"));
    assert_eq!(signed.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn system_key_opens_the_real_sftp_subsystem_and_jump_auth_keeps_host_key_checks() {
    use crate::ssh::test_proc_server::{keyed_proc_server, ProcOptions};
    let home = tempfile::tempdir().unwrap();
    let (file, public) = generate(home.path(), "id_ed25519", "");
    let marker = home.path().join("sftp-marker");
    std::fs::write(&marker, b"synthetic sftp fixture").unwrap();
    {
        let (port, _) = keyed_proc_server(ProcOptions::default(), public.clone()).await;
        let mut handle =
            russh::client::connect(Default::default(), ("127.0.0.1", port), PinnedClient)
                .await
                .unwrap();
        let mut policy = spec(Mode::Keys);
        policy.identity_files = vec![file.to_string_lossy().into_owned()];
        crate::ssh::client::authenticate_handle_with_system(
            &mut handle,
            "synthetic-user",
            None,
            None,
            None,
            Some(("127.0.0.1", &policy)),
        )
        .await
        .unwrap();
        let channel = handle.channel_open_session().await.unwrap();
        channel.request_subsystem(true, "sftp").await.unwrap();
        let sftp = russh_sftp::client::SftpSession::new(channel.into_stream())
            .await
            .unwrap();
        assert_eq!(
            sftp.read(marker.to_str().unwrap()).await.unwrap(),
            b"synthetic sftp fixture"
        );
    }
    let (port, _) = keyed_proc_server(ProcOptions::default(), public).await;
    let fingerprint = host_key()
        .public_key()
        .fingerprint(russh::keys::ssh_key::HashAlg::Sha256)
        .to_string();
    let known = Arc::new(crate::known_hosts::KnownHostsStore::pinned(&[(
        "127.0.0.1",
        port,
        &fingerprint,
    )]));
    let mut policy = spec(Mode::Keys);
    policy.identity_files = vec![file.to_string_lossy().into_owned()];
    let jump = super::client::JumpHostConnect {
        host: "127.0.0.1".into(),
        port,
        username: "synthetic-user".into(),
        password: None,
        private_key: None,
        passphrase: None,
        system_auth: Some(policy),
    };
    let (mut handle, _) = jump
        .connect_first(&Default::default(), &Default::default(), &known, 1)
        .await
        .unwrap();
    jump.authenticate(&mut handle).await.unwrap();
    let channel = handle.channel_open_session().await.unwrap();
    channel.request_subsystem(true, "sftp").await.unwrap();
    let sftp = russh_sftp::client::SftpSession::new(channel.into_stream())
        .await
        .unwrap();
    assert_eq!(
        sftp.read(marker.to_str().unwrap()).await.unwrap(),
        b"synthetic sftp fixture"
    );
}
