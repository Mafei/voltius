# Temporary SSH fixtures and public-export checks

Run `python3 tests/vendor-fixtures/run.py --results <output-directory>` through
the configured Rust toolchain. All original integration targets, unit tests and
doctests run offline with fresh temporary keys. OpenSSH supplies independent
signatures; published public keys and signature vectors remain unchanged. The
temporary HOME contains no account configuration or SSH agent. Private fixture
files are removed when the runner exits, including handled failures.

The documentation examples also use temporary input. Signing examples verify a
valid message, reject a changed message and compare with an independently created
OpenSSH signature. Fixed certificate RNG streams supply public nonces only.

Run `python3 -m unittest discover -s tests/vendor-fixtures -p test_scan_export.py`
for the scanner regressions. They use invalid containers, public marker prose and
invalid length-three arrays; no usable private key is embedded in the regression
source. They cover doc/ordinary/block comments, indentation, escaped strings,
private PEM labels, PPK, raw/base64/hex containers, literal seeds, earlier trees,
parent ordering, unusual Git modes and exact review-pin enforcement.

The scanner accepts an explicit proposed-history manifest and scans every blob in
every listed tree. It reports paths, rule IDs and line numbers, never excerpts or
decoded values. A finding in an earlier tree remains a failure even if the final
tree removes it. Excluded blobs and paths cannot be exempted by a review pin.

`scan-policy.json` makes reviewed findings visible. Pins require the exact path,
blob SHA, rule and line. These distinguish invalid parser markers and public nonce
vectors from historical public PPK/mock-crypto test inputs already present in the
published ancestors. Those existing test inputs are not newly uploaded private
key payloads. A changed object requires another review; the policy does not change
GitHub repository protection or authorize use of any test key for an account.

The zero-finding claim is limited to **unreviewed findings in the selected trees**.
This static scanner is not a universal secret detector: unknown encodings,
encrypted containers and unrecognized data flow may evade its rules. Oversized
blobs, unusual modes and unsupported Git objects are reported rather than silently
skipped. Review pins, original public provenance and the separate immutable input
checks remain necessary evidence.
