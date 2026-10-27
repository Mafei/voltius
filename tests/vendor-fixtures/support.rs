// Shared test-only access to temporary OpenSSH-generated fixtures.
// SPDX-License-Identifier: MIT OR Apache-2.0
use std::{collections::HashMap, format, path::PathBuf, string::String, sync::OnceLock, vec::Vec};

pub(crate) fn root() -> PathBuf {
    std::env::var_os("VOLTIUS_SSH_TEST_FIXTURES")
        .map(PathBuf::from)
        .expect("run tests through tests/vendor-fixtures/run.py")
}

pub(crate) fn examples() -> PathBuf {
    root().join("tests/examples")
}

pub(crate) fn text(name: &str) -> &'static str {
    static FILES: OnceLock<HashMap<String, String>> = OnceLock::new();
    FILES
        .get_or_init(|| {
            let mut result = HashMap::new();
            for directory in [examples(), root().join("extra")] {
                for item in std::fs::read_dir(directory).expect("generated fixture directory") {
                    let path = item.expect("generated fixture entry").path();
                    if path.is_file() {
                        let previous = result.insert(
                            path.file_name().unwrap().to_string_lossy().into_owned(),
                            std::fs::read_to_string(path).expect("generated text fixture"),
                        );
                        assert!(previous.is_none(), "ambiguous generated fixture name");
                    }
                }
            }
            result
        })
        .get(name)
        .expect("generated fixture name")
}

pub(crate) fn bytes(name: &str) -> Vec<u8> {
    let data = std::fs::read_to_string(root().join("oracle.tsv")).expect("external oracle");
    let value = data
        .lines()
        .find_map(|line| {
            let (key, value) = line.split_once('\t')?;
            (key == name).then_some(value)
        })
        .expect("external oracle field");
    (0..value.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&value[i..i + 2], 16).unwrap())
        .collect()
}

pub(crate) fn verify_external(name: &str, signature: &str) {
    let directory = root().join("external-verify").join(name);
    std::fs::create_dir_all(&directory).expect("private test verification directory");
    let allowed = directory.join("allowed_signers");
    std::fs::write(
        &allowed,
        format!("fixture {}", text(&format!("{name}.pub"))),
    )
    .expect("generated public signer");
    let signed = directory.join("message.sig");
    std::fs::write(&signed, signature).expect("public test signature");
    if name == "id_dsa_1024" {
        let status = std::process::Command::new("python3")
            .arg(verifier())
            .arg("signature")
            .arg(examples().join(format!("{name}.pub")))
            .arg(signed)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .expect("independent legacy DSA verifier is required");
        assert!(status.success(), "independent DSA signature verification");
        return;
    }
    let mut child = std::process::Command::new("ssh-keygen")
        .args(["-Y", "verify", "-f"])
        .arg(allowed)
        .args(["-I", "fixture", "-n", "example", "-s"])
        .arg(signed)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("external OpenSSH signature verifier is required");
    use std::io::Write;
    child.stdin.take().unwrap().write_all(b"testing").unwrap();
    assert!(
        child.wait().unwrap().success(),
        "external signature verification"
    );
}

fn verifier() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/vendor-fixtures/verify.py")
}

pub(crate) fn legacy_dsa_public(path: &std::path::Path) -> String {
    let output = std::process::Command::new("python3")
        .arg(verifier())
        .arg("public")
        .arg(path)
        .output()
        .expect("independent DSA decoder is required");
    assert!(output.status.success(), "independent DSA format decoding");
    String::from_utf8(output.stdout).expect("public key text")
}

// Same equality predicate as assert_eq!, without printing private values on failure.
macro_rules! fixture_eq {
    ($left:expr, $right:expr $(,)?) => {
        match (&$left, &$right) {
            (left, right) => assert!(
                *left == *right,
                "fixture equality at {}:{}",
                file!(),
                line!()
            ),
        }
    };
}
