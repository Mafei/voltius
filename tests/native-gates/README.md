# Supplemental native gates

This crate compiles the actual production private-key decoder, TUIOS backend,
SSH executor and existing synthetic loopback SSH/SFTP fixtures. It deliberately
has no Tauri/GTK linkage. It supplements the application tests; it does not
replace `cargo test --locked --workspace`, Android compilation or device tests.
Every registry package/version in its lockfile must also be in the workspace
lockfile. No user SSH key, config, agent, host or signing material is used.

```sh
cargo test --locked --manifest-path tests/native-gates/Cargo.toml
```

The baseline comparison reproduces the legacy russh PEM scanner's rejection of
an indented first header line for generated RSA/ECDSA keys, then checks the shared
production decoder. The production matrix also covers all three RSA sizes,
three ECDSA curves, Ed25519, encryption, incorrect/missing passphrases and CRLF.
This does not establish the cause of a failure reported without its original log.

For the opt-in real CLI gate, supply a binary built from the MIT-licensed
TUIOS v0.11.0 release, source commit
`3638a6f2093edfa7396b6233515786de4dbda683`, and retain its license.
The runner uses the previously fetched Cargo cache offline, removes account
credentials/SSH-agent variables from test subprocesses, checks dependency-version
parity, creates private XDG directories
under `/tmp/vrec-*` and a short named daemon, and runs the real integration
fixture explicitly. It also stops only that named synthetic daemon afterwards.
No remote machine is used. Python 3.11+, Unix PTY support and `ssh-keygen` are
required; the existing SFTP fixture also needs the local OpenSSH sftp-server.

```sh
python3 tests/native-gates/run-real-tuios.py --all --tuios /absolute/path/to/tuios
```

The real gate exercises production commands over loopback SSH, including create,
attach/detach through a PTY, duplicate/missing targets, saved listings, explicit
resurrection and confirmation of the old UUID. TUIOS resets `created` on
resurrection; the returned running metadata replaces that timestamp. A disk
listing's empty ID is never treated as an already-running identity. The two JSON
fixtures are captures from synthetic v0.11.0 sessions and contain no user data.
