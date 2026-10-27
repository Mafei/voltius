//! Encrypted SSH private key tests.

#![cfg(feature = "alloc")]

#[macro_use]
#[allow(dead_code, unused_macros)]
#[path = "../../../tests/vendor-fixtures/support.rs"]
mod fixture;

use ssh_key::{Algorithm, Cipher, Kdf, KdfAlg, PrivateKey};

/// Unencrypted Ed25519 OpenSSH-formatted private key.
#[cfg(feature = "encryption")]
fn openssh_ed25519_example() -> &'static str {
    fixture::text("id_ed25519")
}

/// AES128-CBC encrypted Ed25519 OpenSSH-formatted private key.
///
/// Plaintext is `openssh_ed25519_example()`.
#[cfg(feature = "encryption")]
fn openssh_aes128_cbc_ed25519_example() -> &'static str {
    fixture::text("id_ed25519.aes128-cbc.enc")
}

/// AES192-CBC encrypted Ed25519 OpenSSH-formatted private key.
///
/// Plaintext is `openssh_ed25519_example()`.
#[cfg(feature = "encryption")]
fn openssh_aes192_cbc_ed25519_example() -> &'static str {
    fixture::text("id_ed25519.aes192-cbc.enc")
}

/// AES256-CBC encrypted Ed25519 OpenSSH-formatted private key.
///
/// Plaintext is `openssh_ed25519_example()`.
#[cfg(feature = "encryption")]
fn openssh_aes256_cbc_ed25519_example() -> &'static str {
    fixture::text("id_ed25519.aes256-cbc.enc")
}

/// AES128-CTR encrypted Ed25519 OpenSSH-formatted private key.
///
/// Plaintext is `openssh_ed25519_example()`.
#[cfg(feature = "encryption")]
fn openssh_aes128_ctr_ed25519_example() -> &'static str {
    fixture::text("id_ed25519.aes128-ctr.enc")
}

/// AES192-CTR encrypted Ed25519 OpenSSH-formatted private key.
///
/// Plaintext is `openssh_ed25519_example()`.
#[cfg(feature = "encryption")]
fn openssh_aes192_ctr_ed25519_example() -> &'static str {
    fixture::text("id_ed25519.aes192-ctr.enc")
}

/// AES256-CTR encrypted Ed25519 OpenSSH-formatted private key.
///
/// Plaintext is `openssh_ed25519_example()`.
fn openssh_aes256_ctr_ed25519_example() -> &'static str {
    fixture::text("id_ed25519.aes256-ctr.enc")
}

/// AES256-GCM encrypted Ed25519 OpenSSH-formatted private key.
///
/// Plaintext is `openssh_ed25519_example()`.
#[cfg(feature = "encryption")]
fn openssh_aes128_gcm_ed25519_example() -> &'static str {
    fixture::text("id_ed25519.aes128-gcm.enc")
}

/// AES256-GCM encrypted Ed25519 OpenSSH-formatted private key.
///
/// Plaintext is `openssh_ed25519_example()`.
fn openssh_aes256_gcm_ed25519_example() -> &'static str {
    fixture::text("id_ed25519.aes256-gcm.enc")
}

/// ChaCha20-Poly1305 encrypted Ed25519 OpenSSH-formatted private key.
///
/// Plaintext is `openssh_ed25519_example()`.
fn openssh_chacha20_poly1305_ed25519_example() -> &'static str {
    fixture::text("id_ed25519.chacha20-poly1305.enc")
}

/// TripleDES-CBC encrypted Ed25519 OpenSSH-formatted private key.
///
/// Plaintext is `openssh_ed25519_example()`.
fn openssh_3des_cbc_ed25519_example() -> &'static str {
    fixture::text("id_ed25519.3des-cbc.enc")
}

/// Bad password; don't actually use outside tests!
#[cfg(feature = "encryption")]
const PASSWORD: &[u8] = b"hunter42";

#[test]
fn decode_openssh_aes256_ctr() {
    let key = PrivateKey::from_openssh(openssh_aes256_ctr_ed25519_example()).unwrap();
    fixture_eq!(Algorithm::Ed25519, key.algorithm());
    fixture_eq!(Cipher::Aes256Ctr, key.cipher());
    fixture_eq!(KdfAlg::Bcrypt, key.kdf().algorithm());

    match key.kdf() {
        Kdf::Bcrypt { salt, rounds } => {
            fixture_eq!(salt, &fixture::bytes("aes256-ctr.salt"));
            fixture_eq!(*rounds, 16);
        }
        other => panic!("unexpected KDF algorithm: {:?}", other),
    }

    fixture_eq!(
        &fixture::bytes("id_ed25519.public"),
        key.public_key().key_data().ed25519().unwrap().as_ref(),
    );
}

#[test]
fn decode_openssh_aes256_gcm() {
    let key = PrivateKey::from_openssh(openssh_aes256_gcm_ed25519_example()).unwrap();
    fixture_eq!(Algorithm::Ed25519, key.algorithm());
    fixture_eq!(Cipher::Aes256Gcm, key.cipher());
    fixture_eq!(KdfAlg::Bcrypt, key.kdf().algorithm());

    match key.kdf() {
        Kdf::Bcrypt { salt, rounds } => {
            fixture_eq!(salt, &fixture::bytes("aes256-gcm.salt"));
            fixture_eq!(*rounds, 16);
        }
        other => panic!("unexpected KDF algorithm: {:?}", other),
    }

    fixture_eq!(
        &fixture::bytes("id_ed25519.public"),
        key.public_key().key_data().ed25519().unwrap().as_ref(),
    );
}

#[test]
fn decode_openssh_chacha20_poly1305() {
    let key = PrivateKey::from_openssh(openssh_chacha20_poly1305_ed25519_example()).unwrap();
    fixture_eq!(Algorithm::Ed25519, key.algorithm());
    fixture_eq!(Cipher::ChaCha20Poly1305, key.cipher());
    fixture_eq!(KdfAlg::Bcrypt, key.kdf().algorithm());

    match key.kdf() {
        Kdf::Bcrypt { salt, rounds } => {
            fixture_eq!(salt, &fixture::bytes("chacha20-poly1305.salt"));
            fixture_eq!(*rounds, 16);
        }
        other => panic!("unexpected KDF algorithm: {:?}", other),
    }

    fixture_eq!(
        &fixture::bytes("id_ed25519.public"),
        key.public_key().key_data().ed25519().unwrap().as_ref(),
    );
}

#[test]
fn decode_openssh_3des_cbc() {
    let key = PrivateKey::from_openssh(openssh_3des_cbc_ed25519_example()).unwrap();
    fixture_eq!(Algorithm::Ed25519, key.algorithm());
    fixture_eq!(Cipher::TDesCbc, key.cipher());
    fixture_eq!(KdfAlg::Bcrypt, key.kdf().algorithm());

    match key.kdf() {
        Kdf::Bcrypt { salt, rounds } => {
            fixture_eq!(salt, &fixture::bytes("3des-cbc.salt"));
            fixture_eq!(*rounds, 16);
        }
        other => panic!("unexpected KDF algorithm: {:?}", other),
    }

    fixture_eq!(
        &fixture::bytes("id_ed25519.public"),
        key.public_key().key_data().ed25519().unwrap().as_ref(),
    );
}

#[cfg(feature = "encryption")]
#[test]
fn decrypt_openssh_aes128_ctr() {
    let key_enc = PrivateKey::from_openssh(openssh_aes128_ctr_ed25519_example()).unwrap();
    fixture_eq!(Cipher::Aes128Ctr, key_enc.cipher());
    let key_dec = key_enc.decrypt(PASSWORD).unwrap();
    fixture_eq!(
        PrivateKey::from_openssh(openssh_ed25519_example()).unwrap(),
        key_dec
    );
}

#[cfg(feature = "encryption")]
#[test]
fn decrypt_openssh_aes192_ctr() {
    let key_enc = PrivateKey::from_openssh(openssh_aes192_ctr_ed25519_example()).unwrap();
    fixture_eq!(Cipher::Aes192Ctr, key_enc.cipher());
    let key_dec = key_enc.decrypt(PASSWORD).unwrap();
    fixture_eq!(
        PrivateKey::from_openssh(openssh_ed25519_example()).unwrap(),
        key_dec
    );
}

#[cfg(feature = "encryption")]
#[test]
fn decrypt_openssh_aes256_ctr() {
    let key_enc = PrivateKey::from_openssh(openssh_aes256_ctr_ed25519_example()).unwrap();
    fixture_eq!(Cipher::Aes256Ctr, key_enc.cipher());
    let key_dec = key_enc.decrypt(PASSWORD).unwrap();
    fixture_eq!(
        PrivateKey::from_openssh(openssh_ed25519_example()).unwrap(),
        key_dec
    );
}

#[cfg(feature = "encryption")]
#[test]
fn decrypt_openssh_aes128_cbc() {
    let key_enc = PrivateKey::from_openssh(openssh_aes128_cbc_ed25519_example()).unwrap();
    fixture_eq!(Cipher::Aes128Cbc, key_enc.cipher());
    let key_dec = key_enc.decrypt(PASSWORD).unwrap();
    fixture_eq!(
        PrivateKey::from_openssh(openssh_ed25519_example()).unwrap(),
        key_dec
    );
}

#[cfg(feature = "encryption")]
#[test]
fn decrypt_openssh_aes192_cbc() {
    let key_enc = PrivateKey::from_openssh(openssh_aes192_cbc_ed25519_example()).unwrap();
    fixture_eq!(Cipher::Aes192Cbc, key_enc.cipher());
    let key_dec = key_enc.decrypt(PASSWORD).unwrap();
    fixture_eq!(
        PrivateKey::from_openssh(openssh_ed25519_example()).unwrap(),
        key_dec
    );
}

#[cfg(feature = "encryption")]
#[test]
fn decrypt_openssh_aes256_cbc() {
    let key_enc = PrivateKey::from_openssh(openssh_aes256_cbc_ed25519_example()).unwrap();
    fixture_eq!(Cipher::Aes256Cbc, key_enc.cipher());
    let key_dec = key_enc.decrypt(PASSWORD).unwrap();
    fixture_eq!(
        PrivateKey::from_openssh(openssh_ed25519_example()).unwrap(),
        key_dec
    );
}

#[cfg(feature = "encryption")]
#[test]
fn decrypt_openssh_aes128_gcm() {
    let key_enc = PrivateKey::from_openssh(openssh_aes128_gcm_ed25519_example()).unwrap();
    fixture_eq!(Cipher::Aes128Gcm, key_enc.cipher());
    let key_dec = key_enc.decrypt(PASSWORD).unwrap();
    fixture_eq!(
        PrivateKey::from_openssh(openssh_ed25519_example()).unwrap(),
        key_dec
    );
}

#[cfg(feature = "encryption")]
#[test]
fn decrypt_openssh_aes256_gcm() {
    let key_enc = PrivateKey::from_openssh(openssh_aes256_gcm_ed25519_example()).unwrap();
    fixture_eq!(Cipher::Aes256Gcm, key_enc.cipher());
    let key_dec = key_enc.decrypt(PASSWORD).unwrap();
    fixture_eq!(
        PrivateKey::from_openssh(openssh_ed25519_example()).unwrap(),
        key_dec
    );
}

#[cfg(feature = "encryption")]
#[test]
fn decrypt_openssh_chacha20_poly1305() {
    let key_enc = PrivateKey::from_openssh(openssh_chacha20_poly1305_ed25519_example()).unwrap();
    fixture_eq!(Cipher::ChaCha20Poly1305, key_enc.cipher());
    let key_dec = key_enc.decrypt(PASSWORD).unwrap();
    fixture_eq!(
        PrivateKey::from_openssh(openssh_ed25519_example()).unwrap(),
        key_dec
    );
}

#[cfg(feature = "tdes")]
#[test]
fn decrypt_openssh_3des() {
    let key_enc = PrivateKey::from_openssh(openssh_3des_cbc_ed25519_example()).unwrap();
    fixture_eq!(Cipher::TDesCbc, key_enc.cipher());
    let key_dec = key_enc.decrypt(PASSWORD).unwrap();
    fixture_eq!(
        PrivateKey::from_openssh(openssh_ed25519_example()).unwrap(),
        key_dec
    );
}

#[test]
fn encode_openssh_aes256_ctr() {
    let key = PrivateKey::from_openssh(openssh_aes256_ctr_ed25519_example()).unwrap();
    fixture_eq!(
        openssh_aes256_ctr_ed25519_example().trim_end(),
        key.to_openssh(Default::default()).unwrap().trim_end()
    );
}

#[test]
fn encode_openssh_aes256_gcm() {
    let key = PrivateKey::from_openssh(openssh_aes256_gcm_ed25519_example()).unwrap();
    fixture_eq!(
        openssh_aes256_gcm_ed25519_example().trim_end(),
        key.to_openssh(Default::default()).unwrap().trim_end()
    );
}

#[cfg(all(feature = "encryption", feature = "getrandom"))]
#[test]
fn encrypt_openssh_aes128_cbc() {
    use rand_core::OsRng;

    let key_dec = PrivateKey::from_openssh(openssh_ed25519_example()).unwrap();
    let key_enc = key_dec
        .encrypt_with_cipher(&mut OsRng, Cipher::Aes128Cbc, PASSWORD)
        .unwrap();

    // Ensure encrypted key round trips through encoder/decoder
    let key_enc_str = key_enc.to_openssh(Default::default()).unwrap();
    let key_enc2 = PrivateKey::from_openssh(&*key_enc_str).unwrap();
    fixture_eq!(key_enc, key_enc2);

    // Ensure decrypted key matches the original
    let key_dec2 = key_enc.decrypt(PASSWORD).unwrap();
    fixture_eq!(key_dec, key_dec2);
}

#[cfg(all(feature = "encryption", feature = "getrandom"))]
#[test]
fn encrypt_openssh_aes192_cbc() {
    use rand_core::OsRng;

    let key_dec = PrivateKey::from_openssh(openssh_ed25519_example()).unwrap();
    let key_enc = key_dec
        .encrypt_with_cipher(&mut OsRng, Cipher::Aes192Cbc, PASSWORD)
        .unwrap();

    // Ensure encrypted key round trips through encoder/decoder
    let key_enc_str = key_enc.to_openssh(Default::default()).unwrap();
    let key_enc2 = PrivateKey::from_openssh(&*key_enc_str).unwrap();
    fixture_eq!(key_enc, key_enc2);

    // Ensure decrypted key matches the original
    let key_dec2 = key_enc.decrypt(PASSWORD).unwrap();
    fixture_eq!(key_dec, key_dec2);
}

#[cfg(all(feature = "encryption", feature = "getrandom"))]
#[test]
fn encrypt_openssh_aes256_cbc() {
    use rand_core::OsRng;

    let key_dec = PrivateKey::from_openssh(openssh_ed25519_example()).unwrap();
    let key_enc = key_dec
        .encrypt_with_cipher(&mut OsRng, Cipher::Aes256Cbc, PASSWORD)
        .unwrap();

    // Ensure encrypted key round trips through encoder/decoder
    let key_enc_str = key_enc.to_openssh(Default::default()).unwrap();
    let key_enc2 = PrivateKey::from_openssh(&*key_enc_str).unwrap();
    fixture_eq!(key_enc, key_enc2);

    // Ensure decrypted key matches the original
    let key_dec2 = key_enc.decrypt(PASSWORD).unwrap();
    fixture_eq!(key_dec, key_dec2);
}

#[cfg(all(feature = "encryption", feature = "getrandom"))]
#[test]
fn encrypt_openssh_aes128_ctr() {
    use rand_core::OsRng;

    let key_dec = PrivateKey::from_openssh(openssh_ed25519_example()).unwrap();
    let key_enc = key_dec
        .encrypt_with_cipher(&mut OsRng, Cipher::Aes128Ctr, PASSWORD)
        .unwrap();

    // Ensure encrypted key round trips through encoder/decoder
    let key_enc_str = key_enc.to_openssh(Default::default()).unwrap();
    let key_enc2 = PrivateKey::from_openssh(&*key_enc_str).unwrap();
    fixture_eq!(key_enc, key_enc2);

    // Ensure decrypted key matches the original
    let key_dec2 = key_enc.decrypt(PASSWORD).unwrap();
    fixture_eq!(key_dec, key_dec2);
}

#[cfg(all(feature = "encryption", feature = "getrandom"))]
#[test]
fn encrypt_openssh_aes192_ctr() {
    use rand_core::OsRng;

    let key_dec = PrivateKey::from_openssh(openssh_ed25519_example()).unwrap();
    let key_enc = key_dec
        .encrypt_with_cipher(&mut OsRng, Cipher::Aes192Ctr, PASSWORD)
        .unwrap();

    // Ensure encrypted key round trips through encoder/decoder
    let key_enc_str = key_enc.to_openssh(Default::default()).unwrap();
    let key_enc2 = PrivateKey::from_openssh(&*key_enc_str).unwrap();
    fixture_eq!(key_enc, key_enc2);

    // Ensure decrypted key matches the original
    let key_dec2 = key_enc.decrypt(PASSWORD).unwrap();
    fixture_eq!(key_dec, key_dec2);
}

#[cfg(all(feature = "encryption", feature = "getrandom"))]
#[test]
fn encrypt_openssh_aes256_ctr() {
    use rand_core::OsRng;

    let key_dec = PrivateKey::from_openssh(openssh_ed25519_example()).unwrap();
    let key_enc = key_dec.encrypt(&mut OsRng, PASSWORD).unwrap();

    // Ensure encrypted key round trips through encoder/decoder
    let key_enc_str = key_enc.to_openssh(Default::default()).unwrap();
    let key_enc2 = PrivateKey::from_openssh(&*key_enc_str).unwrap();
    fixture_eq!(key_enc, key_enc2);

    // Ensure decrypted key matches the original
    let key_dec2 = key_enc.decrypt(PASSWORD).unwrap();
    fixture_eq!(key_dec, key_dec2);
}

#[cfg(all(feature = "encryption", feature = "getrandom"))]
#[test]
fn encrypt_openssh_aes128_gcm() {
    use rand_core::OsRng;

    let key_dec = PrivateKey::from_openssh(openssh_ed25519_example()).unwrap();

    let key_enc = key_dec
        .encrypt_with_cipher(&mut OsRng, Cipher::Aes128Gcm, PASSWORD)
        .unwrap();

    // Ensure encrypted key round trips through encoder/decoder
    let key_enc_str = key_enc.to_openssh(Default::default()).unwrap();
    let key_enc2 = PrivateKey::from_openssh(&*key_enc_str).unwrap();
    fixture_eq!(key_enc, key_enc2);

    // Ensure decrypted key matches the original
    let key_dec2 = key_enc.decrypt(PASSWORD).unwrap();
    fixture_eq!(key_dec, key_dec2);
}

#[cfg(all(feature = "encryption", feature = "getrandom"))]
#[test]
fn encrypt_openssh_aes256_gcm() {
    use rand_core::OsRng;

    let key_dec = PrivateKey::from_openssh(openssh_ed25519_example()).unwrap();

    let key_enc = key_dec
        .encrypt_with_cipher(&mut OsRng, Cipher::Aes256Gcm, PASSWORD)
        .unwrap();

    // Ensure encrypted key round trips through encoder/decoder
    let key_enc_str = key_enc.to_openssh(Default::default()).unwrap();
    let key_enc2 = PrivateKey::from_openssh(&*key_enc_str).unwrap();
    fixture_eq!(key_enc, key_enc2);

    // Ensure decrypted key matches the original
    let key_dec2 = key_enc.decrypt(PASSWORD).unwrap();
    fixture_eq!(key_dec, key_dec2);
}

#[cfg(all(feature = "encryption", feature = "getrandom"))]
#[test]
fn encrypt_openssh_chacha20_poly1305() {
    use rand_core::OsRng;

    let key_dec = PrivateKey::from_openssh(openssh_ed25519_example()).unwrap();

    let key_enc = key_dec
        .encrypt_with_cipher(&mut OsRng, Cipher::ChaCha20Poly1305, PASSWORD)
        .unwrap();

    // Ensure encrypted key round trips through encoder/decoder
    let key_enc_str = key_enc.to_openssh(Default::default()).unwrap();
    let key_enc2 = PrivateKey::from_openssh(&*key_enc_str).unwrap();
    fixture_eq!(key_enc, key_enc2);

    // Ensure decrypted key matches the original
    let key_dec2 = key_enc.decrypt(PASSWORD).unwrap();
    fixture_eq!(key_dec, key_dec2);
}

#[cfg(all(feature = "tdes", feature = "getrandom"))]
#[test]
fn encrypt_openssh_3des() {
    use rand_core::OsRng;

    let key_dec = PrivateKey::from_openssh(openssh_ed25519_example()).unwrap();

    let key_enc = key_dec
        .encrypt_with_cipher(&mut OsRng, Cipher::TDesCbc, PASSWORD)
        .unwrap();

    // Ensure encrypted key round trips through encoder/decoder
    let key_enc_str = key_enc.to_openssh(Default::default()).unwrap();
    let key_enc2 = PrivateKey::from_openssh(&*key_enc_str).unwrap();
    fixture_eq!(key_enc, key_enc2);

    // Ensure decrypted key matches the original
    let key_dec2 = key_enc.decrypt(PASSWORD).unwrap();
    fixture_eq!(key_dec, key_dec2);
}
