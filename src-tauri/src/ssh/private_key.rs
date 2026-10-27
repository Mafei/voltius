//! One decoder for saved keys, explicit keys and device-local key authentication.
//! OpenSSH PEM goes through the typed PEM reader, rather than the legacy format scanner.
pub fn decode(
    text: &str,
    passphrase: Option<&str>,
) -> Result<russh::keys::PrivateKey, russh::keys::Error> {
    // The legacy scanner requires an exact header line; pasted PEM can include
    // leading/trailing whitespace even when its key material is valid.
    let text = text.trim();
    if text.starts_with("-----BEGIN OPENSSH PRIVATE KEY-----") {
        let key = russh::keys::PrivateKey::from_openssh(text)?;
        if key.is_encrypted() {
            let passphrase = passphrase.ok_or(russh::keys::Error::KeyIsEncrypted)?;
            Ok(key.decrypt(passphrase)?)
        } else {
            Ok(key)
        }
    } else {
        russh::keys::decode_secret_key(text, passphrase)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use russh::keys::PublicKey;

    #[test]
    fn synthetic_rsa_ecdsa_and_ed25519_decode_gate() {
        // All files are generated inside this temporary directory. No user keys or agent.
        let directory = tempfile::tempdir().unwrap();
        for (kind, bits) in [
            ("rsa", "2048"),
            ("rsa", "3072"),
            ("rsa", "4096"),
            ("ecdsa", "256"),
            ("ecdsa", "384"),
            ("ecdsa", "521"),
            ("ed25519", "256"),
        ] {
            for passphrase in ["", "synthetic-only-passphrase"] {
                let file = directory
                    .path()
                    .join(format!("{kind}-{bits}-{}", passphrase.len()));
                let result = std::process::Command::new("ssh-keygen")
                    .args(["-q", "-t", kind, "-b", bits, "-N", passphrase, "-f"])
                    .arg(&file)
                    .output()
                    .expect("openssh-client is required for this gate");
                assert!(result.status.success(), "synthetic key generation failed");
                let pem = std::fs::read_to_string(&file).unwrap();
                let public = PublicKey::from_openssh(
                    &std::fs::read_to_string(file.with_extension("pub")).unwrap(),
                )
                .unwrap();
                let password = (!passphrase.is_empty()).then_some(passphrase);
                for text in [&pem, &format!("  {}  ", pem), &pem.replace('\n', "\r\n")] {
                    let decoded = decode(text, password).expect("RSA/ECDSA production decode gate");
                    assert_eq!(decoded.public_key().key_data(), public.key_data());
                }
                if password.is_some() {
                    assert!(decode(&pem, None).is_err());
                    assert!(decode(&pem, Some("wrong")).is_err());
                }
            }
        }
        assert!(decode("not a key", None).is_err());
    }
}

#[cfg(test)]
#[path = "private_key_scalar_tests.rs"]
mod scalar_tests;
