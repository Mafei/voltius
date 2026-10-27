//! SSH private key tests.

#[macro_use]
#[allow(dead_code, unused_macros)]
#[path = "../../../tests/vendor-fixtures/support.rs"]
mod fixture;

use ssh_key::{Algorithm, Cipher, KdfAlg, PrivateKey};

#[cfg(feature = "ecdsa")]
use ssh_key::EcdsaCurve;

#[cfg(all(feature = "alloc"))]
use ssh_key::LineEnding;

#[cfg(all(feature = "std"))]
use {
    ssh_key::PublicKey,
    std::{io, path::PathBuf, process},
};

/// DSA OpenSSH-formatted public key
#[cfg(feature = "alloc")]
fn openssh_dsa_example() -> &'static str {
    fixture::text("id_dsa_1024")
}

/// ECDSA/P-256 OpenSSH-formatted public key
#[cfg(feature = "ecdsa")]
fn openssh_ecdsa_p256_example() -> &'static str {
    fixture::text("id_ecdsa_p256")
}

/// ECDSA/P-384 OpenSSH-formatted public key
#[cfg(feature = "ecdsa")]
fn openssh_ecdsa_p384_example() -> &'static str {
    fixture::text("id_ecdsa_p384")
}

/// ECDSA/P-521 OpenSSH-formatted public key
#[cfg(feature = "ecdsa")]
fn openssh_ecdsa_p521_example() -> &'static str {
    fixture::text("id_ecdsa_p521")
}

/// Ed25519 OpenSSH-formatted private key
fn openssh_ed25519_example() -> &'static str {
    fixture::text("id_ed25519")
}

/// RSA (3072-bit) OpenSSH-formatted public key
#[cfg(feature = "alloc")]
fn openssh_rsa_3072_example() -> &'static str {
    fixture::text("id_rsa_3072")
}

/// RSA (4096-bit) OpenSSH-formatted public key
#[cfg(feature = "alloc")]
fn openssh_rsa_4096_example() -> &'static str {
    fixture::text("id_rsa_4096")
}

/// OpenSSH-formatted private key with a custom algorithm name
#[cfg(feature = "alloc")]
fn openssh_opaque_example() -> &'static str {
    fixture::text("id_opaque")
}

/// Get a path into the `tests/scratch` directory.
#[cfg(feature = "std")]
pub fn scratch_path(filename: &str) -> PathBuf {
    fixture::root().join("scratch").join(filename)
}

#[cfg(feature = "alloc")]
#[test]
fn decode_dsa_openssh() {
    let key = PrivateKey::from_openssh(openssh_dsa_example()).unwrap();
    fixture_eq!(Algorithm::Dsa, key.algorithm());
    fixture_eq!(Cipher::None, key.cipher());
    fixture_eq!(KdfAlg::None, key.kdf().algorithm());
    assert!(key.kdf().is_none());

    let dsa_keypair = key.key_data().dsa().unwrap();
    fixture_eq!(
        &fixture::bytes("id_dsa_1024.p"),
        dsa_keypair.public.p.as_bytes(),
    );
    fixture_eq!(
        &fixture::bytes("id_dsa_1024.q"),
        dsa_keypair.public.q.as_bytes(),
    );
    fixture_eq!(
        &fixture::bytes("id_dsa_1024.g"),
        dsa_keypair.public.g.as_bytes(),
    );
    fixture_eq!(
        &fixture::bytes("id_dsa_1024.y"),
        dsa_keypair.public.y.as_bytes(),
    );
    fixture_eq!(
        &fixture::bytes("id_dsa_1024.x"),
        dsa_keypair.private.as_bytes()
    );
    fixture_eq!("user@example.com", key.comment());
}

#[cfg(feature = "ecdsa")]
#[test]
fn decode_ecdsa_p256_openssh() {
    let key = PrivateKey::from_openssh(openssh_ecdsa_p256_example()).unwrap();
    fixture_eq!(
        Algorithm::Ecdsa {
            curve: EcdsaCurve::NistP256
        },
        key.algorithm(),
    );
    fixture_eq!(Cipher::None, key.cipher());
    fixture_eq!(KdfAlg::None, key.kdf().algorithm());
    assert!(key.kdf().is_none());

    let ecdsa_keypair = key.key_data().ecdsa().unwrap();
    fixture_eq!(EcdsaCurve::NistP256, ecdsa_keypair.curve());
    fixture_eq!(
        &fixture::bytes("id_ecdsa_p256.public"),
        ecdsa_keypair.public_key_bytes(),
    );
    fixture_eq!(
        &fixture::bytes("id_ecdsa_p256.scalar"),
        ecdsa_keypair.private_key_bytes(),
    );

    #[cfg(feature = "alloc")]
    fixture_eq!("user@example.com", key.comment());
}

#[cfg(feature = "ecdsa")]
#[test]
fn decode_ecdsa_p384_openssh() {
    let key = PrivateKey::from_openssh(openssh_ecdsa_p384_example()).unwrap();
    fixture_eq!(
        Algorithm::Ecdsa {
            curve: EcdsaCurve::NistP384
        },
        key.algorithm()
    );
    fixture_eq!(Cipher::None, key.cipher());
    fixture_eq!(KdfAlg::None, key.kdf().algorithm());
    assert!(key.kdf().is_none());

    let ecdsa_keypair = key.key_data().ecdsa().unwrap();
    fixture_eq!(EcdsaCurve::NistP384, ecdsa_keypair.curve());
    fixture_eq!(
        &fixture::bytes("id_ecdsa_p384.public"),
        ecdsa_keypair.public_key_bytes(),
    );
    fixture_eq!(
        &fixture::bytes("id_ecdsa_p384.scalar"),
        ecdsa_keypair.private_key_bytes(),
    );

    #[cfg(feature = "alloc")]
    fixture_eq!("user@example.com", key.comment());
}

#[cfg(feature = "ecdsa")]
#[test]
fn decode_ecdsa_p521_openssh() {
    let key = PrivateKey::from_openssh(openssh_ecdsa_p521_example()).unwrap();
    fixture_eq!(
        Algorithm::Ecdsa {
            curve: EcdsaCurve::NistP521
        },
        key.algorithm()
    );
    fixture_eq!(Cipher::None, key.cipher());
    fixture_eq!(KdfAlg::None, key.kdf().algorithm());
    assert!(key.kdf().is_none());

    let ecdsa_keypair = key.key_data().ecdsa().unwrap();
    fixture_eq!(EcdsaCurve::NistP521, ecdsa_keypair.curve());
    fixture_eq!(
        &fixture::bytes("id_ecdsa_p521.public"),
        ecdsa_keypair.public_key_bytes(),
    );
    fixture_eq!(
        &fixture::bytes("id_ecdsa_p521.scalar"),
        ecdsa_keypair.private_key_bytes(),
    );

    #[cfg(feature = "alloc")]
    fixture_eq!("user@example.com", key.comment());
}

#[test]
fn decode_ed25519_openssh() {
    let key = PrivateKey::from_openssh(openssh_ed25519_example()).unwrap();
    fixture_eq!(Algorithm::Ed25519, key.algorithm());
    fixture_eq!(Cipher::None, key.cipher());
    fixture_eq!(KdfAlg::None, key.kdf().algorithm());
    assert!(key.kdf().is_none());

    let ed25519_keypair = key.key_data().ed25519().unwrap();
    fixture_eq!(
        &fixture::bytes("id_ed25519.public"),
        ed25519_keypair.public.as_ref(),
    );
    fixture_eq!(
        &fixture::bytes("id_ed25519.private"),
        ed25519_keypair.private.as_ref(),
    );

    #[cfg(feature = "alloc")]
    fixture_eq!(key.comment(), "user@example.com");
}

#[cfg(feature = "alloc")]
#[test]
fn decode_rsa_3072_openssh() {
    let key = PrivateKey::from_openssh(openssh_rsa_3072_example()).unwrap();
    fixture_eq!(Algorithm::Rsa { hash: None }, key.algorithm());
    fixture_eq!(Cipher::None, key.cipher());
    fixture_eq!(KdfAlg::None, key.kdf().algorithm());
    assert!(key.kdf().is_none());

    let rsa_keypair = key.key_data().rsa().unwrap();
    fixture_eq!(
        &fixture::bytes("id_rsa_3072.e"),
        rsa_keypair.public.e.as_bytes()
    );
    fixture_eq!(
        &fixture::bytes("id_rsa_3072.n"),
        rsa_keypair.public.n.as_bytes(),
    );
    fixture_eq!(
        &fixture::bytes("id_rsa_3072.d"),
        rsa_keypair.private.d.as_bytes()
    );
    fixture_eq!(
        &fixture::bytes("id_rsa_3072.iqmp"),
        rsa_keypair.private.iqmp.as_bytes()
    );
    fixture_eq!(
        &fixture::bytes("id_rsa_3072.p"),
        rsa_keypair.private.p.as_bytes()
    );
    fixture_eq!(
        &fixture::bytes("id_rsa_3072.q"),
        rsa_keypair.private.q.as_bytes()
    );
    fixture_eq!("user@example.com", key.comment());
}

#[cfg(feature = "alloc")]
#[test]
fn decode_rsa_4096_openssh() {
    let key = PrivateKey::from_openssh(openssh_rsa_4096_example()).unwrap();
    fixture_eq!(Algorithm::Rsa { hash: None }, key.algorithm());
    fixture_eq!(Cipher::None, key.cipher());
    fixture_eq!(KdfAlg::None, key.kdf().algorithm());
    assert!(key.kdf().is_none());

    let rsa_keypair = key.key_data().rsa().unwrap();
    fixture_eq!(
        &fixture::bytes("id_rsa_4096.e"),
        rsa_keypair.public.e.as_bytes()
    );
    fixture_eq!(
        &fixture::bytes("id_rsa_4096.n"),
        rsa_keypair.public.n.as_bytes(),
    );
    fixture_eq!(
        &fixture::bytes("id_rsa_4096.d"),
        rsa_keypair.private.d.as_bytes()
    );
    fixture_eq!(
        &fixture::bytes("id_rsa_4096.iqmp"),
        rsa_keypair.private.iqmp.as_bytes()
    );
    fixture_eq!(
        &fixture::bytes("id_rsa_4096.p"),
        rsa_keypair.private.p.as_bytes()
    );
    fixture_eq!(
        &fixture::bytes("id_rsa_4096.q"),
        rsa_keypair.private.q.as_bytes()
    );
    fixture_eq!("user@example.com", key.comment());
}

#[cfg(all(feature = "alloc"))]
#[test]
fn decode_custom_algorithm_openssh() {
    let key = PrivateKey::from_openssh(openssh_opaque_example()).unwrap();
    assert!(
        matches!(key.algorithm(), Algorithm::Other(name) if name.as_str() == "name@example.com")
    );
    fixture_eq!(Cipher::None, key.cipher());
    fixture_eq!(KdfAlg::None, key.kdf().algorithm());
    assert!(key.kdf().is_none());

    let opaque_keypair = key.key_data().other().unwrap();
    fixture_eq!(
        &fixture::bytes("id_opaque.public"),
        opaque_keypair.public.as_ref(),
    );
    fixture_eq!(
        &fixture::bytes("id_opaque.private"),
        opaque_keypair.private.as_ref(),
    );

    fixture_eq!(key.comment(), "comment@example.com");
}

#[cfg(all(feature = "alloc"))]
#[test]
fn encode_dsa_openssh() {
    encoding_test(openssh_dsa_example())
}

#[cfg(all(feature = "alloc", feature = "ecdsa"))]
#[test]
fn encode_ecdsa_p256_openssh() {
    encoding_test(openssh_ecdsa_p256_example())
}

#[cfg(all(feature = "alloc", feature = "ecdsa"))]
#[test]
fn encode_ecdsa_p384_openssh() {
    encoding_test(openssh_ecdsa_p384_example())
}

#[cfg(all(feature = "alloc", feature = "ecdsa"))]
#[test]
fn encode_ecdsa_p521_openssh() {
    encoding_test(openssh_ecdsa_p521_example())
}

#[cfg(all(feature = "alloc"))]
#[test]
fn encode_ed25519_openssh() {
    encoding_test(openssh_ed25519_example())
}

#[cfg(all(feature = "alloc"))]
#[test]
fn encode_rsa_3072_openssh() {
    encoding_test(openssh_rsa_3072_example())
}

#[cfg(all(feature = "alloc"))]
#[test]
fn encode_rsa_4096_openssh() {
    encoding_test(openssh_rsa_4096_example())
}

#[cfg(all(feature = "alloc"))]
#[test]
fn encode_custom_algorithm_openssh() {
    encoding_test(openssh_opaque_example())
}

/// Common behavior of all encoding tests
#[cfg(all(feature = "alloc"))]
fn encoding_test(private_key: &str) {
    let key = PrivateKey::from_openssh(private_key).unwrap();

    // Ensure key round-trips
    let pem = key.to_openssh(LineEnding::LF).unwrap();
    let key2 = PrivateKey::from_openssh(&*pem).unwrap();
    fixture_eq!(key, key2);

    #[cfg(feature = "std")]
    if !matches!(key.algorithm(), Algorithm::Other(_)) {
        encoding_integration_test(key)
    }
}

/// Parse PEM encoded using `PrivateKey::to_openssh` using the `ssh-keygen` utility.
#[cfg(all(feature = "std"))]
fn encoding_integration_test(private_key: PrivateKey) {
    let fingerprint = private_key
        .fingerprint(Default::default())
        .to_string()
        .replace(':', "-")
        .replace('/', "_");

    let path = scratch_path(&fingerprint);

    private_key
        .write_openssh_file(&path, LineEnding::LF)
        .unwrap();

    let public_key = if private_key.algorithm() == Algorithm::Dsa {
        // OpenSSH 10 removed DSA; keep an independent decoder rather than skip.
        PublicKey::from_openssh(&fixture::legacy_dsa_public(&path)).unwrap()
    } else {
        match process::Command::new("ssh-keygen")
            .args(["-y", "-f", path.to_str().unwrap()])
            .output()
        {
            Ok(output) => {
                fixture_eq!(output.status.code().unwrap(), 0);
                let ssh_keygen_output = std::str::from_utf8(&output.stdout).unwrap();
                PublicKey::from_openssh(ssh_keygen_output).unwrap()
            }
            Err(err) => {
                if err.kind() == io::ErrorKind::NotFound {
                    panic!("ssh-keygen is required for the external encoding oracle");
                } else {
                    panic!("error invoking ssh-keygen: {}", err)
                }
            }
        }
    };

    // Ensure ssh-keygen successfully parsed our public key
    fixture_eq!(&public_key, private_key.public_key());
    std::fs::remove_file(path).unwrap();
}
