# Mafei Android ARM64 build

This fork preserves the upstream Git history and AGPLv3 license. The first Android
build is frozen at upstream `dev` commit
`caf470f37ecbdc5d32b91cf288b15a6802abaa35` (version 0.51.0), including #593's
launch-lock fix and #594's Windows terminal fix after the v0.51.0 release. The fork's
existing `main` and `dev` had advanced to 0.52.1 when the fork was connected; they
are preserved. Later upstream changes belong in a separate daily candidate.

## First delivered APK provenance

- Original local build commit: `ed14a22ace398dc9d4180f24f950cb9d7026e9e6`.
- Published equivalent: `e92ea05f34d05348c44c48e1da5bbc30f21733f8`.
- Both have exactly the same tree: `7e15e7b44216face7654047c61160aab785e905b`.
- The two local build commits used a private email, so GitHub rejected their push
  with GH007. Their original local branches remain. Published equivalents use the
  account's GitHub noreply identity without changing account settings or source.
- Delivered APK SHA256:
  `f0a1517f21a88027fdd656880aa2fc00b61a05e8b9a00b7d69c16beabbc321f7`.
- Public development certificate SHA256:
  `975c51aa7858bd9af3a8e75e96d36778ac133e29aa09a7a2a71eb5c206fe590a`.

`Dockerfile.android` aligns pnpm with package.json and installs SDK 36.
`src-tauri/build.rs` applies 16 KiB max/common page alignment to the Android
cdylib. The CI workflow, verification script and this document do not change
application logic. CI APK bytes may differ from the cloud-delivered APK; each
run records its own commit, toolchain, hash and certificate.

## Repeat the build

Use an isolated Linux x86_64 checkout with Node 24.19.0, pnpm 11.5.2, JDK 21,
Rust from `rust-toolchain.toml`, Android SDK 36, build-tools 36.0.0 and NDK
27.1.12297006. Set ANDROID_HOME/ANDROID_SDK_ROOT and NDK_HOME/ANDROID_NDK_ROOT.

```bash
rustup show
rustup target add aarch64-linux-android
pnpm install --frozen-lockfile --ignore-scripts
cargo fmt --all --check
pnpm test src/services/appLock.test.ts src/hooks/useSessionExpiration.test.ts src/components/layout/SplashScreen.appLock.test.tsx src/components/layout/SplashScreen.keychainHint.test.tsx src/services/androidKeyboard.lock.test.ts src/components/terminal/androidDownloadDir.test.ts
cargo test --locked -p voltius-crypto
CARGO_PROFILE_DEV_DEBUG=0 CARGO_BUILD_JOBS=4 VOLTIUS_REQUIRE_SEEDED_PLUGINS=1 \
  pnpm tauri android build --target aarch64 --apk --debug
python3 scripts/verify-android-apk.py \
  src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk \
  android-ci-artifacts
```

The `Android ARM64 debug` workflow runs on normal pushes to
`candidate/android-*`. It checks out the triggering SHA, runs the relevant
regressions, builds a debug APK and verifies the package/version, minSdk 24,
targetSdk 36, ARM64-only native library, public development signature, APK ZIP
alignment and ELF LOAD/RELRO alignment for 16 KiB pages. It uploads only the APK,
public metadata, license/notice and logs as a 14-day Actions artifact. It has
read-only repository permissions and does not publish releases or use signing
secrets. Static alignment checks are not a runtime test. Phone/emulator startup,
InputConnection, biometric unlock and SSH/SFTP remain untested for this build.

Daily candidates also run the reconnect/rename/selection frontend regressions and
the Linux-host SFTP resume/cancellation tests (`cargo test --locked -p voltius
--lib commands::sftp::resume -- --skip '::live::'`), plus the WSL timeout helper
tests. The SFTP tests use local temporary fixtures and the OpenSSH sftp-server;
the Docker live test is excluded. Linux native test dependencies match the
upstream `ci.yml` package list. These host regressions do not prove Android
runtime behavior. CI artifacts preserve LICENSE and the upstream NOTICE.md.

## Daily candidate and maintenance branches

The 2026-10-15 candidate starts from retained PR #6 commit
`dcda1eb46f58a93354b37152677402aba321c450` and merges fixed upstream `main`/`dev`
commit `b461cac8a86df0ce5a57f868380cd027d7022dba` (version 0.57.0).
Maintenance remains at `4e83ff5e685285b59f865d31526c4a1b66fd90c9` until the
exact candidate passes every required validation. PR #6's zsh installation,
shell suite and assertions remain. All selected native suites now record their
own exit code and run to completion, with any failure making the CI job fail.
An APK that compiles is statically checked and preserved even when native
regressions fail; this supplies evidence and does not authorize promotion.
Additional host suites cover account profile storage, editor/image paste and
SSH execution changes with synthetic fixtures. Device runtime remains untested.

Upstream 0.57.0 declares Android foreground-service/special-use and notification
permissions for mobile SSH tunnels. This build does not install the app or grant
device permissions; the declarations remain visible in the candidate source and
APK manifest for review. No account/cloud permission or signing credential is
added by this workflow.

The 2026-10-12 candidate starts from validated maintenance commit
`4e83ff5e685285b59f865d31526c4a1b66fd90c9` and merges the fixed upstream
`main`/`dev` commit `035b9aeb3a0b32b5ec819c065e4dc629ce36fa7b` (version 0.55.0).
Both upstream branches pointed to that same release commit at the check.
Existing Android adaptations and history remain. CI also runs upstream's new
passkey-loopback and updated shell-integration tests on the Linux host; zsh is
installed so its command-mark regression executes rather than returning early.
The full frontend suite covers account/two-factor/passkey/deep-link and sync
changes with synthetic fixtures. No user account, security key or phone is used;
these tests do not establish Android browser/passkey or terminal runtime behavior.

The 2026-10-11 candidate starts from validated maintenance commit
`47a009190e9c3cb4bf2678f37d8dfe26a59ec113` and merges the fixed upstream `dev`
commit `c8f330bdc9ed4daee5945eac8474dca4a7554dcc` (version 0.53.0). This includes
the upstream `main` release commit `54c8c3b9c50ca293e9d6842813ac1f9a45c7d423`
and one subsequent team-vault secret-refusal fix. Existing Android build
adaptations and history are preserved. Candidate CI now runs the complete
frontend test suite and the Linux-host port-forwarding regressions in addition
to crypto, transfer resume/cancellation and WSL timeout checks. These host
checks and static APK verification do not establish Android runtime behavior.

Track upstream `dev`; use `mafei/android` as the validated maintenance branch.
Preserve `build/upstream-dev-caf470f3` as the review baseline for this first build.
Create a new branch such as `candidate/android-YYYYMMDD-<upstream-short-sha>` for
each merge. The main thread owns the existing daily schedule.

```bash
git fetch upstream dev
git fetch origin mafei/android
maintenance_sha=$(git rev-parse origin/mafei/android)
upstream_sha=$(git rev-parse upstream/dev)
candidate="candidate/android-$(date -u +%Y%m%d)-${upstream_sha:0:8}"
git switch -c "$candidate" "$maintenance_sha"
git merge --no-edit "$upstream_sha"
git push origin "HEAD:refs/heads/$candidate"
```

On conflicts or failed checks, retain the candidate and report it; keep maintenance
at its last validated commit. Resolve conflicts on the candidate, use ordinary
commits and revalidate. Before advancing maintenance, verify this candidate's
Actions run succeeded for its exact SHA and the remote maintenance SHA still
equals `maintenance_sha`. If it changed, stop and reconcile the concurrent work.
Then fast-forward the local maintenance branch and push normally:

```bash
candidate_sha=$(git rev-parse HEAD)
git fetch origin mafei/android
test "$(git rev-parse origin/mafei/android)" = "$maintenance_sha"
git switch mafei/android
git merge --ff-only "$candidate_sha"
git push origin mafei/android
```

Never force-push or delete history. Do not merge this first-build review into
`main` or trigger the upstream release workflows. The committed public debug key
is a temporary test identity, not a long-term production upgrade-signing key;
never upload the private key as an artifact.
