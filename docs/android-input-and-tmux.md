# Android selected IME and explicit tmux sessions

This candidate is based on `66a6c8925fb283c1b68eb27c5573cb9742b625a8`
(upstream 0.58.0 at `7a64f0b25a4d3adf56d4fb1fd8f76db26d41fa85`).
It remains a candidate; the pre-existing zsh regression is not bypassed and the
`mafei/android` maintenance branch must not advance while the full gate fails.

## Input diagnosis and change

The old `TerminalKeyboard.kt:118-123` labels even the ordinary terminal as
`TYPE_TEXT_VARIATION_VISIBLE_PASSWORD | TYPE_TEXT_FLAG_NO_SUGGESTIONS`.
Android defines that variation as a password field and cautions that suppressing
suggestions can prevent IMEs working correctly. It is consistent with the reported
ColorOS security keyboard and English-only input; this is a source-based diagnosis,
not a reproduction on the user's device. The installed APK version is unknown.
The bridge file was unchanged since upstream commit `15a2509218e71cfc48841b00a35ad30412159a0f`.

- Original source: https://github.com/Mafei/voltius/blob/66a6c8925fb283c1b68eb27c5573cb9742b625a8/src-tauri/gen/android/app/src/main/java/com/voltius/app/TerminalKeyboard.kt#L118-L123
- Android contract: https://developer.android.com/reference/android/text/InputType
- Previous Android input issue: https://github.com/VoltiusApp/voltius/issues/34

The app does not draw an IME. Its transparent native input view now advertises
ordinary text to Android's selected IME. The xterm hidden textarea remains
read-only/inputmode=none, preserving the native bridge that fixed upstream #34.
A full InputConnection buffers only pending composition, supports Android
selection/surrounding-text queries and sends confirmed text once. Pinyin updates
and candidate replacements never send speculative text or Backspaces to the PTY.
The pending text is visible in the IME's composition/candidate UI; it is not echoed
into the remote terminal until confirmed. Connection/focus loss cancels preedit.
The existing no-personalized-learning hint is retained. Real password/passphrase
form fields, app-lock guards, system IME selection and phone security settings are
unchanged. A remote terminal password prompt has no native password-field metadata.

## SSH host picker

Tapping an SSH host authenticates through the existing known-host, proxy,
ProxyJump, credential-resolution and authentication code, without starting a PTY
or shell. Changed host keys use the existing explicit trust-decision panel; the
listener is installed before the handshake. The authenticated connection is held
for at most five minutes and consumed once by a confirmed open, or disconnected
on cancel/return. Cancellation during authentication also aborts a pending host-key
prompt and releases a late successful result. No credentials are stored in this
registry. Missing credentials can still use ordinary SSH's existing repair UI.

The list is the login user's **default tmux socket**, not every custom `-L/-S`
socket or Voltius's existing private persistence socket. Nothing installs tmux or
changes its configuration. Missing tmux, an empty server and connection/list errors
are distinct states. Ordinary non-tmux SSH remains available.

Attach verifies the selected `$id`, server PID and creation time, then attaches
without `-d`. Create uses one atomic `new-session -d -P`, never `-A`: a duplicate
name fails rather than attaching. Names are passed as quoted shell arguments,
not interpolated script text. New names are limited to 128 UTF-8 bytes, cannot
start with `-`, and cannot contain `.`, `:` or control characters. Chinese,
spaces and shell punctuation are preserved. A timed-out create must be checked
by refreshing before another attempt; the app does not automatically retry it.

These are user-owned sessions: closing a tab only closes that client and does not
kill the tmux session or another attached client. Host pre/post commands and
environment-injection writes are not sent into an attached tmux program. Existing
ordinary/private-persistence sessions retain their original behavior.

Tab headings use the real tmux session name, with host/login/endpoint underneath.
Shell window titles cannot replace that name. Workspace restore retains the login,
endpoint and remote session identity. Selecting an existing tab for the same saved
connection, endpoint, login and tmux identity activates it. A disconnected/error tab
is shown in place with its original reconnect UI. Rapid taps share an open; a
connecting tab is reused. Cross-host/user and recycled remote IDs remain distinct.

## Repeat validation

Use the toolchain in `docs/android-fork-build.md`.

```sh
pnpm install --frozen-lockfile --ignore-scripts
cargo fmt --all --check
pnpm test
pnpm build
pnpm tauri android build --target aarch64 --apk --debug
(cd src-tauri/gen/android && ./gradlew :app:testUniversalDebugUnitTest --tests com.voltius.app.TerminalKeyboardTest --console=plain)
cargo test --locked -p voltius --lib ssh::tmux::
cargo test --locked -p voltius --lib ssh::client::tests
python3 scripts/verify-android-apk.py src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk android-ci-artifacts
```

Native Linux tests require the existing desktop development libraries; the tmux
fixture also requires tmux in the **isolated test runner**, not on a user's host.
Its socket, server and shell are temporary and are cleaned up after the test.
The candidate Actions workflow runs the full frontend and existing native gate,
these tmux/auth tests, Robolectric API 24/35 contracts, ARM64 build and APK static
checks. APK evidence is retained independently of gate failure, with development
signing only. No release is published.

No physical Android, ColorOS/Find N6, real selected IME, real host or emulator
test has been performed. Framework/unit/static checks do not establish actual
on-device keyboard behavior, remote-host compatibility or runtime 16 KiB support.
