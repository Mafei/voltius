//! Tests for `~/.ssh` support. Uses the `tests/examples` directory instead.

#![cfg(feature = "std")]

#[macro_use]
#[allow(dead_code, unused_macros)]
#[path = "../../../tests/vendor-fixtures/support.rs"]
mod fixture;

use ssh_key::{Algorithm, DotSsh, Fingerprint};

/// Open `.ssh` using the `test/examples`.
fn dot_ssh() -> DotSsh {
    DotSsh::open(fixture::examples())
}

#[test]
fn path_round_trip() {
    let dot_ssh = dot_ssh();
    assert!(dot_ssh.path().ends_with("tests/examples"));
}

#[test]
fn private_keys() {
    let dot_ssh = dot_ssh();
    assert_eq!(dot_ssh.private_keys().unwrap().count(), 22);
}

#[test]
fn private_key_with_fingerprint() {
    let fingerprint =
        Fingerprint::Sha256(fixture::bytes("id_ed25519.fingerprint").try_into().unwrap());

    let dot_ssh = dot_ssh();
    let key = dot_ssh.private_key_with_fingerprint(fingerprint).unwrap();
    assert_eq!(key.algorithm(), Algorithm::Ed25519);
}

#[test]
fn public_keys() {
    let dot_ssh = dot_ssh();
    assert_eq!(dot_ssh.public_keys().unwrap().count(), 12);
}

#[test]
fn public_key_with_fingerprint() {
    let fingerprint =
        Fingerprint::Sha256(fixture::bytes("id_ed25519.fingerprint").try_into().unwrap());

    let dot_ssh = dot_ssh();
    let key = dot_ssh.public_key_with_fingerprint(fingerprint).unwrap();
    assert_eq!(key.algorithm(), Algorithm::Ed25519);
}
