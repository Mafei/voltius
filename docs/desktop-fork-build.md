# Desktop test builds from v0.52.1

Application baseline: `47a009190e9c3cb4bf2678f37d8dfe26a59ec113` in
<https://github.com/Mafei/voltius>, preserving Voltius upstream history and AGPLv3.
The desktop candidate adds build and verification files only. Android maintenance
and its APK remain unchanged. The exact candidate commit is recorded in each
artifact's BUILD-MANIFEST.json and Actions run.

## macOS ARM64

The independent `desktop-test.yml` job uses the public standard `macos-15` ARM64
runner, Node 24.19.0, pnpm 11.5.2, repository Rust 1.96.0, frozen pnpm/Cargo locks,
and `aarch64-apple-darwin`. It builds only an app bundle, with updater artifact
generation disabled. It never imports a certificate, requests an account token,
creates a release, or runs the upstream release workflow.
The upstream packaging smoke workflow is restricted to the upstream repository
in this candidate: its path filter otherwise starts unrelated Windows builds
and a certificate-import probe when macOS test scripts change in the fork.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm tauri build --target aarch64-apple-darwin --bundles app --config '{"bundle":{"createUpdaterArtifacts":false,"macOS":{"signingIdentity":"-"}}}' -- --locked
cargo test --locked -p voltius --lib local::session::tests
cargo test --locked -p voltius --lib commands::local::tests
bash scripts/verify-macos-test.sh target/aarch64-apple-darwin/release/bundle/macos/Voltius.app desktop-ci-artifacts
```

All embedded Mach-O files are signed ad-hoc and individually verified, followed
by strict deep verification of the app. The package includes no signing private
key. It is a local test build, without Developer ID or notarization; the user may
need to approve the downloaded app manually through macOS. We do not remove
quarantine, change Gatekeeper, or change the user's machine. Ad-hoc signatures
change across builds, so Keychain approvals can repeat after an update.

Normal `open` launch and a visible window are attempted on the disposable cloud
runner. Existing native PTY and shell enumeration tests run separately. They do
not establish interactive terminal UI, real SSH/SFTP, or user-machine behavior.
Any GUI startup limitation is preserved separately from the verified package.
The generated reports identify signatures/CDHash, minimum macOS load commands,
linked libraries, package SHA256, source SHA, and measured/unmeasured scope.
The source archive excludes `keystore/` (the public upstream Android debug key);
desktop compilation does not require it. No signing key file is uploaded.

## Rocky Linux 8.10 x86_64

The independent compatibility audit runs inside the Rocky project's pinned
`rockylinux/rockylinux:8.10` image:
`sha256:e8a49c5403b687db05d4d67333fa45808fbe74f36e683cec7abb1f7d0f2338c6`.
It queries BaseOS, AppStream, Extras and the official PowerTools, Devel and Plus
metadata without installing a replacement runtime. It records OS, repositories,
glibc, maximum provided GLIBCXX, package
versions and providers for WebKitGTK 4.1 / libsoup 3. Its successful CI status
means that the audit completed, not that a Rocky-compatible app exists.

Tauri 2 requires WebKitGTK 4.1 (libsoup 3). If providers are absent, the audit
reports BLOCKED and produces no Linux app. An Ubuntu-built AppImage cannot
establish Rocky glibc 2.28 compatibility. Building/bundling a maintained WebKitGTK
backport, or choosing a separate runtime package, is an architecture decision;
no old/insecure WebKit, ABI replacement, third-party repository or sandbox
exception is introduced by this candidate.

References: [Tauri Linux prerequisites](https://v2.tauri.app/start/prerequisites/),
[Tauri AppImage baseline guidance](https://v2.tauri.app/distribute/appimage/),
[GitHub standard runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
[Rocky project container images](https://hub.docker.com/r/rockylinux/rockylinux).

Artifacts expire after 14 days. Download the app ZIP inside the Actions artifact;
the artifact also contains logs, source archive, LICENSE and NOTICE. No release
is published and no user device is installed or modified.
