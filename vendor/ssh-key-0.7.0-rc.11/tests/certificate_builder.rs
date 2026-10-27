//! Certificate builder tests.

#![cfg(all(
    feature = "alloc",
    feature = "rand_core",
    any(feature = "ed25519", feature = "p256")
))]

#[macro_use]
#[allow(dead_code, unused_macros)]
#[path = "../../../tests/vendor-fixtures/support.rs"]
mod fixture;

use chacha20::rand_core::Rng;
use chacha20::{ChaCha8Rng, rand_core::SeedableRng};
use hex_literal::hex;
use ssh_key::{Algorithm, PrivateKey, certificate};

#[cfg(feature = "p256")]
use ssh_key::EcdsaCurve;

#[cfg(all(feature = "ed25519", feature = "std"))]
use {core::time::Duration, std::time::SystemTime};

/// Example Unix timestamp when a certificate was issued (2020-09-13 12:26:40 UTC).
const ISSUED_AT: u64 = 1600000000;

/// Example Unix timestamp when a certificate is valid (2022-04-15 05:20:00 UTC).
const VALID_AT: u64 = 1650000000;

/// Example Unix timestamp when a certificate expires (2023-11-14 22:13:20 UTC).
const EXPIRES_AT: u64 = 1700000000;

/// Seed to use for PRNG.
const PRNG_SEED: [u8; 32] = [42; 32];

#[cfg(feature = "ed25519")]
#[test]
fn ed25519_sign_and_verify() {
    const SERIAL: u64 = 42;
    const KEY_ID: &str = "example";
    const PRINCIPAL: &str = "nobody";
    const CRITICAL_EXTENSION_1: (&str, &str) = ("critical name 1", "critical data 2");
    const CRITICAL_EXTENSION_2: (&str, &str) = ("critical name 2", "critical data 2");
    const EXTENSION_1: (&str, &str) = ("extension name 1", "extension data 1");
    const EXTENSION_2: (&str, &str) = ("extension name 2", "extension data 2");
    const COMMENT: &str = "user@example.com";

    let mut rng = ChaCha8Rng::from_seed(PRNG_SEED);

    let ca_key = PrivateKey::from_openssh(fixture::text("ca_ed25519")).unwrap();
    let subject_key = PrivateKey::from_openssh(fixture::text("subject_ed25519")).unwrap();

    // Consume the former key-generation stream prefix as nonsecret test bytes.
    let mut discarded = [0u8; 72];
    rng.fill_bytes(&mut discarded);
    let mut cert_builder = certificate::Builder::new_with_random_nonce(
        &mut rng,
        subject_key.public_key(),
        ISSUED_AT,
        EXPIRES_AT,
    )
    .unwrap();

    cert_builder.serial(SERIAL).unwrap();
    cert_builder.key_id(KEY_ID).unwrap();
    cert_builder.valid_principal(PRINCIPAL).unwrap();
    cert_builder
        .critical_option(CRITICAL_EXTENSION_1.0, CRITICAL_EXTENSION_1.1)
        .unwrap();
    cert_builder
        .critical_option(CRITICAL_EXTENSION_2.0, CRITICAL_EXTENSION_2.1)
        .unwrap();
    cert_builder
        .extension(EXTENSION_1.0, EXTENSION_1.1)
        .unwrap();
    cert_builder
        .extension(EXTENSION_2.0, EXTENSION_2.1)
        .unwrap();
    cert_builder.comment(COMMENT).unwrap();

    let cert = cert_builder.sign(&ca_key).unwrap();
    assert_eq!(cert.algorithm(), Algorithm::Ed25519);
    assert_eq!(cert.nonce(), &hex!("321fdf7e0a2afe803308f394f54c6abe"));
    assert_eq!(cert.public_key(), subject_key.public_key().key_data());
    assert_eq!(cert.serial(), SERIAL);
    assert_eq!(cert.cert_type(), certificate::CertType::User);
    assert_eq!(cert.key_id(), KEY_ID);
    assert_eq!(cert.valid_principals().len(), 1);
    assert_eq!(cert.valid_principals()[0], PRINCIPAL);
    assert_eq!(cert.valid_after(), ISSUED_AT);
    assert_eq!(cert.valid_before(), EXPIRES_AT);
    assert_eq!(cert.critical_options().len(), 2);
    assert_eq!(
        cert.critical_options().get(CRITICAL_EXTENSION_1.0).unwrap(),
        CRITICAL_EXTENSION_1.1
    );
    assert_eq!(cert.extensions().get(EXTENSION_2.0).unwrap(), EXTENSION_2.1);
    assert_eq!(cert.extensions().len(), 2);
    assert_eq!(cert.extensions().get(EXTENSION_1.0).unwrap(), EXTENSION_1.1);
    assert_eq!(cert.extensions().get(EXTENSION_2.0).unwrap(), EXTENSION_2.1);
    assert_eq!(cert.signature_key(), ca_key.public_key().key_data());
    assert_eq!(cert.comment(), COMMENT);

    let ca_fingerprint = ca_key.fingerprint(Default::default());
    assert!(cert.validate_at(VALID_AT, &[ca_fingerprint]).is_ok());
}

#[cfg(feature = "p256")]
#[test]
fn ecdsa_nistp256_sign_and_verify() {
    let mut rng = ChaCha8Rng::from_seed(PRNG_SEED);

    let algorithm = Algorithm::Ecdsa {
        curve: EcdsaCurve::NistP256,
    };
    let ca_key = PrivateKey::from_openssh(fixture::text("ca_ecdsa")).unwrap();
    let subject_key = PrivateKey::from_openssh(fixture::text("subject_ecdsa")).unwrap();
    // Consume the former key-generation stream prefix as nonsecret test bytes.
    let mut discarded = [0u8; 72];
    rng.fill_bytes(&mut discarded);
    let mut cert_builder = certificate::Builder::new_with_random_nonce(
        &mut rng,
        subject_key.public_key(),
        ISSUED_AT,
        EXPIRES_AT,
    )
    .unwrap();
    cert_builder.all_principals_valid().unwrap();
    let cert = cert_builder.sign(&ca_key).unwrap();

    assert_eq!(cert.algorithm(), algorithm);
    assert_eq!(cert.nonce(), &hex!("321fdf7e0a2afe803308f394f54c6abe"));
    assert_eq!(cert.public_key(), subject_key.public_key().key_data());
    assert_eq!(cert.signature_key(), ca_key.public_key().key_data());

    let ca_fingerprint = ca_key.fingerprint(Default::default());
    assert!(cert.validate_at(VALID_AT, &[ca_fingerprint]).is_ok());
}

#[cfg(all(feature = "ed25519", feature = "rsa"))]
#[test]
fn rsa_sign_and_verify() {
    let ca_key = PrivateKey::from_openssh(fixture::text("id_rsa_3072")).unwrap();

    let mut rng = ChaCha8Rng::from_seed(PRNG_SEED);
    let subject_key = PrivateKey::from_openssh(fixture::text("subject_ed25519")).unwrap();
    // Consume the former key-generation stream prefix as nonsecret test bytes.
    let mut discarded = [0u8; 36];
    rng.fill_bytes(&mut discarded);
    let mut cert_builder = certificate::Builder::new_with_random_nonce(
        &mut rng,
        subject_key.public_key(),
        ISSUED_AT,
        EXPIRES_AT,
    )
    .unwrap();
    cert_builder.all_principals_valid().unwrap();
    let cert = cert_builder.sign(&ca_key).unwrap();

    assert_eq!(
        cert.signature_key().algorithm(),
        Algorithm::Rsa { hash: None }
    );
    assert_eq!(cert.nonce(), &hex!("55742ecb25ee56057b9e35eae54c40a9"));
    assert_eq!(cert.public_key(), subject_key.public_key().key_data());
    assert_eq!(cert.signature_key(), ca_key.public_key().key_data());

    let ca_fingerprint = ca_key.fingerprint(Default::default());
    assert!(cert.validate_at(VALID_AT, &[ca_fingerprint]).is_ok());
}

#[cfg(all(feature = "ed25519", feature = "std"))]
#[test]
fn new_with_validity_times() {
    let subject_key = PrivateKey::from_openssh(fixture::text("subject_ed25519")).unwrap();

    // NOTE: use a random nonce, not an all-zero one!
    let nonce = [0u8; certificate::Builder::RECOMMENDED_NONCE_SIZE];

    let issued_at = SystemTime::now();
    let expires_at = issued_at + Duration::from_secs(3600);

    assert!(
        certificate::Builder::new_with_validity_times(
            nonce,
            subject_key.public_key(),
            issued_at,
            expires_at
        )
        .is_ok()
    );
}
