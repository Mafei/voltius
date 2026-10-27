# Local dependency repairs (2026-10-26)

These three directory copies are cached crates.io releases plus the adjacent source diffs. PROVENANCE.json records archive SHA256 values independently checked against the original lockfile. Upstream MIT/Apache licenses, public verification vectors and all 19 declared integration test targets remain present. Registry checksum/installation marker files were removed because these are modified path dependencies. No upstream master or newly selected prerelease is used.

## SSH mpint decoding

Both existing ssh-key families need the repair: authentication uses 0.7.0-rc.11; import/generation uses 0.6.7. Deliberate duplicate decoder changes follow incompatible external trait/dependency families; sharing code would broaden the patch. OpenSSH positive mpints omit redundant leading zero octets, so a valid P-256 scalar can have 31 significant octets. Left-pad to the curve field size. Preserve positive sign padding; reject empty, zero, negative and oversized encodings. Curve-order validity is enforced when constructing a signing key. Curve size and signature/password validation are unchanged.

The production private_key_scalar_tests.rs is shared by the native gate. Public synthetic 31/32/33-octet fixtures parse and sign/verify through both families; current authentication uses a real isolated loopback SSH server. OpenSSH re-encryption covers correct/missing/wrong passwords. Malformed and out-of-order encodings cannot sign. Before repair the 31-octet fixture fails with SshKey(Encoding(Length)); a 32-octet control authenticates.

## Android generated dependency script

AGP 9.4.1 lint crashes in Kotlin UAST visiting an applied Kotlin Gradle script: findFirCompiledSymbol on an uncompiled declaration. Removing the top-level configuration variable alone still crashes. Emit the equivalent applied Groovy dependency script and update the tracked application script. Dependency configurations/projects and all lint tasks remain enabled: no baseline, issue exclusion, timeout change or check suppression. The native generator owns the change. An obsolete generated .kts file in existing workspaces is no longer applied.

The actual generator output, lint and final build must be validated. These repairs do not fix the remaining RustSec RSA/legacy EC/updater ZIP advisories and are independent of the xterm atlas backport.

## Ephemeral upstream test inputs

Private sample files, inline PEMs, fixed private components and signing seeds are replaced with runtime-only test material. No test target is removed. `tests/vendor-fixtures/run.py --results <directory>` runs both crates with the checked-in standalone Cargo locks, offline, using a fresh private temporary HOME and fixture directory. OpenSSH generates the current key formats; Python cryptography supplies legacy DSA (removed by OpenSSH 10), AES/Argon2id and an independent PPK serializer. These are test tools, not production dependencies. All temporary private files are cleaned on normal exit or a handled failure. Do not use test keys for any account or persistent access.

The tests retain the published public keys, certificates and known signatures unchanged. Fresh-key signing additionally uses independent OpenSSH verification (OpenSSL-backed cryptography for legacy DSA); deterministic Ed25519 signatures are compared with OpenSSH output. The DSA 19-byte-r boundary is selected using an independent RFC6979/SHA1 implementation. Byte-field expectations come from an independent OpenSSH parser. The only fixed RNG stream supplies public certificate nonces, preserving the original known vectors. Missing test tools fail explicitly. PuTTYgen interoperability is an additional check and has not been run in this environment.

The 0.6.7 RSA conversion also requires a one-line correction from duplicate primes `[p, p]` to `[p, q]`. Original certificate/SSHSIG signing tests failed with `Crypto` before correction; fresh RSA signing and independent verification pass afterward. The adjacent production patch records this change. Test-only support and documentation changes are recorded by file hashes in PROVENANCE.json; no patch file embeds removed private examples. Root application dependency locks and upstream licenses are unchanged.
