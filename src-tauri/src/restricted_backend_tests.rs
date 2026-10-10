//! Tests run inside the already delivered Flatpak, without extra permissions.
//! Only synthetic loopback SSH peers and throwaway files are used. No GUI,
//! account/keychain, host shell, agent, or user credentials are involved.

use crate::commands::sftp::resume::copy_one;
use crate::commands::sftp::resume::endpoint::LocalFs;
use crate::known_hosts::KnownHostsStore;
use crate::sftp::backend::{test_tree::Recorder, FileBackend};
use crate::sftp::real::{RealSftp, SftpOpener};
use crate::ssh::client::{connect_authenticated, HopRoute, SshClient};
use crate::ssh::exec::run_captured_with_stdin;
use crate::ssh::live_cells::own_cell;
use crate::ssh::test_proc_server::{proc_server_endpoint, ProcOptions};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use russh::keys::HashAlg;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::sync::{mpsc, Arc};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

fn inside_restricted_runtime() {
    assert!(std::path::Path::new("/.flatpak-info").exists());
    assert!(!crate::local::flatpak::spawns_on_host());
    assert!(std::env::var_os("SSH_AUTH_SOCK").is_none());
}

#[test]
fn runtime_pty_input_unicode_resize_and_exit() {
    inside_restricted_runtime();
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();
    let mut command = CommandBuilder::new("sh");
    command.args(["-c", "stty -echo; printf 'PTY_READY\\n'; IFS= read -r value; printf 'INPUT=%s\\n' \"$value\"; stty size; exit 7"]);
    let mut child = pair.slave.spawn_command(command).unwrap();
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().unwrap();
    let mut writer = pair.master.take_writer().unwrap();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut bytes = [0u8; 4096];
        while let Ok(n) = reader.read(&mut bytes) {
            if n == 0 || tx.send(bytes[..n].to_vec()).is_err() {
                break;
            }
        }
    });
    let mut output = Vec::new();
    while !String::from_utf8_lossy(&output).contains("PTY_READY") {
        output.extend(rx.recv_timeout(Duration::from_secs(10)).unwrap());
    }
    pair.master
        .resize(PtySize {
            rows: 40,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();
    writer.write_all("汉字 café🙂\n".as_bytes()).unwrap();
    writer.flush().unwrap();
    loop {
        match rx.recv_timeout(Duration::from_secs(10)) {
            Ok(chunk) => output.extend(chunk),
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(e) => panic!("PTY output deadline: {e}"),
        }
    }
    assert_eq!(child.wait().unwrap().exit_code(), 7);
    let text = String::from_utf8(output).unwrap();
    assert!(text.contains("INPUT=汉字 café🙂"), "{text}");
    assert!(text.contains("40 100"), "{text}");
    println!("RUNTIME_PTY_PASS shell=runtime input=unicode resize=100x40 exit=7");
}

async fn fixture_connection(
    password: &str,
    pin: Option<&str>,
) -> Result<Arc<russh::client::Handle<SshClient>>, String> {
    let (port, _) = proc_server_endpoint(ProcOptions::default(), true).await;
    let fingerprint = crate::port_forward::test_ssh::host_key()
        .public_key()
        .fingerprint(HashAlg::Sha256)
        .to_string();
    let known = Arc::new(KnownHostsStore::pinned(&[(
        "127.0.0.1",
        port,
        pin.unwrap_or(&fingerprint),
    )]));
    connect_authenticated(
        known,
        "127.0.0.1",
        port,
        "voltius-fixture",
        Some(password),
        None,
        None,
        false,
        &HopRoute::default(),
    )
    .await
    .map(Arc::new)
}

#[tokio::test]
async fn actual_ssh_password_exec_and_sftp_transfer_roundtrip() {
    inside_restricted_runtime();
    tokio::time::timeout(Duration::from_secs(60), async {
        let handle = fixture_connection("fixture-password-only", None).await.unwrap();
        let out = run_captured_with_stdin(&handle, "cat; printf stderr-marker >&2; exit 3", Some("SSH_INPUT=汉字🙂\n".as_bytes())).await.unwrap();
        assert_eq!(out.stdout, "SSH_INPUT=汉字🙂\n".as_bytes());
        assert_eq!(out.stderr, "stderr-marker");
        assert_eq!(out.code, Some(3));

        let files = tempfile::tempdir().unwrap();
        let local = files.path().join("upload.bin");
        let remote = files.path().join("remote.bin");
        let download = files.path().join("download.bin");
        let payload: Vec<u8> = (0..131_173).map(|i| (i % 251) as u8).collect();
        std::fs::write(&local, &payload).unwrap();
        let cancel = CancellationToken::new();
        let backend = RealSftp::open(own_cell(Arc::clone(&handle)), SftpOpener::Subsystem, cancel.clone()).await.unwrap();
        let events = Recorder::default();
        let endpoint = backend.endpoint();
        copy_one(&events, &LocalFs, local.to_str().unwrap(), &*endpoint, remote.to_str().unwrap(), "probe-upload", &cancel).await.unwrap();
        copy_one(&events, &*endpoint, remote.to_str().unwrap(), &LocalFs, download.to_str().unwrap(), "probe-download", &cancel).await.unwrap();
        let got = std::fs::read(&download).unwrap();
        assert_eq!(got, payload);
        let digest = format!("{:x}", Sha256::digest(&got));
        assert_eq!(backend.file_size(remote.to_str().unwrap()).await, payload.len() as u64);
        backend.rename(remote.to_str().unwrap(), files.path().join("renamed.bin").to_str().unwrap()).await.unwrap();
        backend.delete(files.path().join("renamed.bin").to_str().unwrap()).await.unwrap();
        backend.close().await;
        handle.disconnect(russh::Disconnect::ByApplication, "fixture complete", "en").await.unwrap();
        println!("ACTUAL_BACKEND_PASS auth=password hostkey=pinned stdin=unicode stdout=matched stderr=matched exit=3 sftp-upload-download-bytes={} sha256={digest} rename=pass delete=pass", got.len());
    }).await.expect("SSH/SFTP test deadline");
}

#[tokio::test]
async fn actual_ssh_rejects_wrong_password_and_changed_host_key() {
    inside_restricted_runtime();
    tokio::time::timeout(Duration::from_secs(30), async {
        let bad_password = fixture_connection("wrong-fixture-password", None)
            .await
            .err()
            .expect("wrong password accepted");
        assert!(
            bad_password.to_lowercase().contains("password"),
            "{bad_password}"
        );
        let bad_pin = fixture_connection(
            "fixture-password-only",
            Some("SHA256:incorrect-fixture-pin"),
        )
        .await
        .err()
        .expect("wrong host key accepted");
        assert!(bad_pin.to_lowercase().contains("host key"), "{bad_pin}");
        println!("ACTUAL_BACKEND_NEGATIVE_PASS wrong-password=refused changed-hostkey=refused");
    })
    .await
    .expect("negative auth test deadline");
}
