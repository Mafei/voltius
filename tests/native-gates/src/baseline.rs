#[test]
fn compare_original_russh_scanner_with_shared_decoder() {
    let root = tempfile::tempdir().unwrap();
    for (kind, bits) in [("rsa", "2048"), ("ecdsa", "256")] {
        let path = root.path().join(kind);
        assert!(std::process::Command::new("ssh-keygen")
            .args(["-q", "-t", kind, "-b", bits, "-N", "", "-f"])
            .arg(&path)
            .status()
            .unwrap()
            .success());
        let text = std::fs::read_to_string(&path).unwrap();
        let plain = russh::keys::decode_secret_key(&text, None);
        println!(
            "baseline_standard_{kind}={}",
            if plain.is_ok() { "PASS" } else { "FAIL" }
        );
        let surrounded = format!("  {text}  ");
        let old = russh::keys::decode_secret_key(&surrounded, None);
        let new = crate::private_key::decode(&surrounded, None);
        println!("baseline_surrounded_{kind}={:?}", old.as_ref().err());
        assert!(
            old.is_err(),
            "locked legacy scanner must reproduce the indented-header failure"
        );
        assert!(new.is_ok());
    }
}
