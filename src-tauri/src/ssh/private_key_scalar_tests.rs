//! Public fixed synthetic scalars; no user keys or persistent signing identity.
use super::decode;
use base64::{engine::general_purpose::STANDARD, Engine};
use russh::keys::{ssh_key::HashAlg, PrivateKey, PrivateKeyWithHashAlg};
use std::sync::Arc;

fn field(out: &mut Vec<u8>, value: &[u8]) {
    out.extend_from_slice(&(value.len() as u32).to_be_bytes());
    out.extend_from_slice(value);
}

fn fixture(secret: &[u8; 32], encoded_scalar: &[u8]) -> String {
    let signing = p256::ecdsa::SigningKey::from_slice(secret).unwrap();
    let point = signing.verifying_key().to_sec1_point(false);
    let mut public = Vec::new();
    for part in [
        b"ecdsa-sha2-nistp256".as_slice(),
        b"nistp256",
        point.as_bytes(),
    ] {
        field(&mut public, part);
    }
    let mut private = Vec::new();
    private.extend_from_slice(&0x12345678u32.to_be_bytes());
    private.extend_from_slice(&0x12345678u32.to_be_bytes());
    private.extend_from_slice(&public);
    field(&mut private, encoded_scalar);
    field(&mut private, b"synthetic-short-p256");
    let mut padding = 1;
    while private.len() % 8 != 0 {
        private.push(padding);
        padding += 1;
    }
    let mut bytes = b"openssh-key-v1\0".to_vec();
    for value in [b"none".as_slice(), b"none", b""] {
        field(&mut bytes, value);
    }
    bytes.extend_from_slice(&1u32.to_be_bytes());
    field(&mut bytes, &public);
    field(&mut bytes, &private);
    let encoded = STANDARD.encode(bytes);
    let body = encoded
        .as_bytes()
        .chunks(70)
        .map(|c| std::str::from_utf8(c).unwrap())
        .collect::<Vec<_>>()
        .join("\n");
    format!("-----BEGIN OPENSSH PRIVATE KEY-----\n{body}\n-----END OPENSSH PRIVATE KEY-----\n")
}
fn secret() -> [u8; 32] {
    let mut value = [0u8; 32];
    for (i, b) in value.iter_mut().enumerate() {
        *b = i as u8;
    }
    value
}
fn verify_signature(key: &PrivateKey) {
    let message = b"synthetic P256 challenge";
    let signature = key
        .sign("voltius-synthetic", HashAlg::Sha256, message)
        .unwrap();
    key.public_key()
        .verify("voltius-synthetic", message, &signature)
        .unwrap();
    assert!(key
        .public_key()
        .verify("voltius-synthetic", b"modified challenge", &signature)
        .is_err());
}
async fn authenticate(key: PrivateKey) {
    use crate::{
        port_forward::test_ssh::TestClient,
        ssh::test_proc_server::{keyed_proc_server, ProcOptions},
    };
    let (port, _) = keyed_proc_server(ProcOptions::default(), key.public_key().clone()).await;
    let mut handle = russh::client::connect(Default::default(), ("127.0.0.1", port), TestClient)
        .await
        .unwrap();
    assert!(!handle
        .authenticate_none("synthetic")
        .await
        .unwrap()
        .success());
    assert!(handle
        .authenticate_publickey("synthetic", PrivateKeyWithHashAlg::new(Arc::new(key), None))
        .await
        .unwrap()
        .success());
    handle
        .disconnect(russh::Disconnect::ByApplication, "done", "en")
        .await
        .unwrap();
}
fn verify_legacy(pem: &str, password: Option<&str>) {
    let key = ssh_key::PrivateKey::from_openssh(pem).unwrap();
    let key = if key.is_encrypted() {
        key.decrypt(password.unwrap()).unwrap()
    } else {
        key
    };
    let signature = key
        .sign(
            "voltius-synthetic",
            ssh_key::HashAlg::Sha256,
            b"synthetic challenge",
        )
        .unwrap();
    key.public_key()
        .verify("voltius-synthetic", b"synthetic challenge", &signature)
        .unwrap();
    assert!(key
        .public_key()
        .verify("voltius-synthetic", b"modified challenge", &signature)
        .is_err());
}
#[tokio::test]
async fn canonical_short_full_and_sign_padded_p256_authenticate() {
    for first in [0u8, 1, 0x80] {
        let mut scalar = secret();
        scalar[0] = first;
        let mut wire = if first == 0 {
            scalar[1..].to_vec()
        } else {
            scalar.to_vec()
        };
        if first == 0x80 {
            wire.insert(0, 0);
        }
        let pem = fixture(&scalar, &wire);
        verify_legacy(&pem, None);
        let key = decode(&pem, None).unwrap();
        verify_signature(&key);
        authenticate(key).await;
        println!(
            "SYNTHETIC_P256_WIRE_OCTETS={} SIGN_VERIFY_LOOPBACK_AUTH=passed",
            wire.len()
        );
    }
}
#[tokio::test]
async fn openssh_encrypted_short_p256_keeps_password_and_auth_gates() {
    let file = tempfile::NamedTempFile::new().unwrap();
    std::fs::write(file.path(), fixture(&secret(), &secret()[1..])).unwrap();
    let output = std::process::Command::new("ssh-keygen")
        .args([
            "-q",
            "-p",
            "-P",
            "",
            "-N",
            "synthetic-test-passphrase",
            "-f",
        ])
        .arg(file.path())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "OpenSSH synthetic re-encryption failed"
    );
    let pem = std::fs::read_to_string(file.path()).unwrap();
    assert!(decode(&pem, None).is_err());
    assert!(decode(&pem, Some("wrong")).is_err());
    verify_legacy(&pem, Some("synthetic-test-passphrase"));
    let key = decode(&pem, Some("synthetic-test-passphrase")).unwrap();
    verify_signature(&key);
    authenticate(key).await;
}
#[test]
fn invalid_scalar_encodings_never_produce_a_signature() {
    for invalid in [
        vec![],
        vec![0],
        vec![0; 32],
        vec![0x80; 32],
        vec![1; 34],
        [vec![0], vec![0xff; 32]].concat(),
    ] {
        let pem = fixture(&secret(), &invalid);
        if let Ok(key) = decode(&pem, None) {
            assert!(key
                .sign("voltius-synthetic", HashAlg::Sha256, b"challenge")
                .is_err());
        }
        if let Ok(key) = ssh_key::PrivateKey::from_openssh(&pem) {
            assert!(key
                .sign("voltius-synthetic", ssh_key::HashAlg::Sha256, b"challenge")
                .is_err());
        }
    }
}
