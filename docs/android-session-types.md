# Android session types: None, Tmux and Zellij

This candidate starts at validated PR9 commit
`183fe3e6873f6687f3e11584afc10afd769257c6` (upstream 0.58.0 at
`7a64f0b25a4d3adf56d4fb1fd8f76db26d41fa85`). The existing selected-system-IME,
Chinese composition, tmux protocol and shell regression fixes remain intact.

## Connection form

The form follows the approved order: **Session Type → Session List → Session
Name → Connect / Cancel**. There is one Connect action and no Socket control or
separate attach/create/ordinary-SSH action.

- **None** hides the session fields and opens ordinary SSH. It neither probes
  nor creates tmux, Zellij or Voltius's private persistence session.
- **Tmux/Zellij** authenticate through the existing credential, host-key,
  proxy and ProxyJump handling, then inspect only the selected backend.
- The list puts **＋ New** first, then a disabled separator and an existing-session
  group. The plus, bold text, creation label/group and disabled separator avoid
  relying on color. Existing names are represented by opaque option indices and
  typed session objects, so a real session named `New` is independent of creation.
- Session Name is enabled only for New. Choosing an existing item clears and
  disables it. Connect either opens the exact selected session, activates an
  existing matching tab, or explicitly creates a uniquely named session.
- Type changes cancel the old controller and clear list, target and name. Late
  responses are rejected by request generation. None starts no replacement probe.
- Refresh preserves a target only if the same remote identity still exists;
  a missing target is cleared and requires a new explicit choice. It never turns
  into New. Errors stay in the form; consumed transports are replaced before retry.
- Loading, invalid/duplicate names and an unavailable backend disable Connect.
  During connection the controls are frozen; Cancel remains available. Cancel or
  back releases this attempt/client without killing the user's remote session.

The type preference is remembered per saved host on this device and classified
as account-owned UI state, so account switching parks/clears it with the existing
account state. Each tab keeps its own backend and target independently of later
host preferences. Titles use the actual session name; host/login/backend context
stays auxiliary. Existing connected, connecting, disconnected and error tabs are
reused rather than duplicated. An offline tab retains its reconnect UI.

## Binding and restore compatibility

De-duplication includes backend, saved connection, endpoint, login and backend
session identity. Tmux retains its default-socket session ID + creation time +
server PID. Zellij retains the canonical original socket directory and device /
inode identity. A replaced socket or changed endpoint/login is rejected rather
than being treated as an unrelated new session. Metadata refresh can update the
displayed name without changing a stable remote identity.

Existing plain/tmux snapshots keep their original meaning. Legacy Voltius private
tmux/screen persistence and its restore/socket binding are unchanged. New explicit
None/Tmux/Zellij tabs use the explicit mode; they do not silently fall through to
a private persistence session or a fresh login shell.

## Zellij scope and version boundaries

This implementation supports **running Linux Zellij 0.43.1–0.45.1 sessions**.
Real CLI/PTY integration runs against official no-web binaries **0.43.1** and
**0.45.1**; intermediate versions are covered by the inspected CLI/namespace
protocol, not a physical device or every server distribution. Unsupported
versions/platforms and denied local binding operations fail visibly. Nothing
installs or upgrades software on an SSH host.

Zellij 0.43 uses its exact-version socket namespace; 0.44+ uses the inspected
`contract_version_1` namespace. The normal current user's namespace is discovered
from the existing ZELLIJ_SOCKET_DIR / XDG runtime / temporary-directory rules.
Socket identity is rechecked on connect and reconnect. Linux stat, mktemp, ln,
rm and wc are required; failure is reported rather than bypassing the guard.

The official CLI has two behaviors that make a plain attach unsafe for this
scope: it can match a unique name prefix, and it can resurrect an exited session
from its saved layout. After the user confirms a running target, a private client
directory contains a hard link to **only that original socket inode**. A short,
private alias keeps the Unix socket pathname within the CLI limit. A private
client cache excludes saved layouts. The client uses `--on-force-close detach`.
All temporary client links/cache are cleaned up when it exits; the original
socket, server configuration, saved layout and other attached clients are kept.
No PID is killed and no original socket/cache is replaced or deleted.

Creation uses Zellij's explicit global `--session NAME` path, which rejects an
existing live or cached name. It does not use attach `--create` or
`--create-background`, which can reuse names. New session startup is confirmed
before returning its actual socket identity. An uncertain/failed startup requires
refresh; the app does not automatically repeat creation.

**Resurrection is not implemented or invoked.** Exited cache names remain reserved
for duplicate checking, but are not offered as running targets. Reconnect and
workspace restore fail clearly if the bound running target has ended. They do not
recreate it, run saved commands, or promise restoration of processes/work after a
server restart. The CLI's `--force-run-commands` and web/remember-token options are
never used.

Official sources inspected:

- [0.45.1 session-list IPC probes](https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-utils/src/sessions.rs#L143)
- [0.45.1 server client-removal initialization race](https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-server/src/lib.rs#L1437)
- [Session resurrection](https://zellij.dev/documentation/session-resurrection)
- [0.45.1 CLI and session matching](https://github.com/zellij-org/zellij/blob/v0.45.1/src/commands.rs)
- [0.45.1 listing and cached sessions](https://github.com/zellij-org/zellij/blob/v0.45.1/zellij-utils/src/sessions.rs)
- [0.43.1 namespace](https://github.com/zellij-org/zellij/blob/v0.43.1/zellij-utils/src/consts.rs)
- [0.44 namespace change](https://github.com/zellij-org/zellij/blob/v0.44.0/zellij-utils/src/consts.rs)

## Validation and reproducible CI

`.github/workflows/android-arm64-debug.yml` pins and verifies the official Linux
test archives before executing them, with no web capability and no user host:

| Version | Archive SHA-256 |
| --- | --- |
| 0.45.1 | `d7bda1e18c30a688833ae7627f1d6a253bbba5349a4bc48e4f0ec008aaf75ed1` |
| 0.43.1 | `bac0728945e8f5a28f2647e2b9b0cfe4591d71abfe227336b1318937241f071d` |

The real tests use private runtime/socket/cache/config directories and an explicit
test config file. This matters because Zellij's config lookup can prefer the home
config even with XDG_CONFIG_HOME set; a newer default config contains actions an
older binary cannot parse. No HOME is changed and no user's SSH/config is used.
The synthetic config uses a single shell pane and disables background plugins,
release notes and startup tips. A marker from the actual pane acknowledges server
initialization before list/attach/duplicate assertions; there is no fixed startup
sleep or weakened assertion. Both root and unprivileged UID 1001 runs are checked.

Zellij 0.45.1 can panic in `RemoveClient` when `list-sessions` IPC-probes a socket
before the server has processed its first client's initialization. New-session
confirmation therefore discovers the newly created canonical directory and reads
only socket metadata with `stat`; it never lists/probes that initializing server.
The original PTY client owns initialization and reports a launch failure. Tests
exercise this metadata-only startup path, including a symlinked socket root,
before waiting for the pane marker. Existing running-session listing still uses
the official CLI; this does not fix races caused by external clients.

The tests cover true create/duplicate rejection, Unicode and shell punctuation,
literal New, original inode attachment, concurrent clients, detach/cleanup even
with `on_force_close quit` in the fixture file, default runtime scope, and an
injected exit race with a real dumped layout and a still-running prefix neighbour.
The guarded client must fail without resurrecting the layout or attaching to the
neighbour. Fixture teardown only terminates its own synthetic servers.

Frontend tests cover both backends, same-name/cross-host separation, New sentinel,
form enablement, stale input, quick switches/None, refresh disappearance, missing
backend, retry, late cancellation, original socket snapshots and ordinary SSH.
CI also retains the full frontend suite, the selected native safety suites, the
complete default native workspace suite, API 24/35 IME contracts, ARM64 APK build
and static package/signature/ABI/16 KiB alignment evidence. Upstream's existing
ignored external-service tests remain under Cargo's default ignore policy.

No physical Android/Find N6/ColorOS, actual selected device IME, emulator startup,
real user SSH host or other server platform has been tested. Static alignment and
framework/CLI checks do not establish those runtime behaviors. Signing reuses the
repository's existing public development test key, unsuitable for long-term
production upgrades. No release or device installation is performed.
