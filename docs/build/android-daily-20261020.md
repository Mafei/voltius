# Android daily integration — 2026-10-20

This candidate combines the Android input/rendering repair at
`18bc8a0d28264eb4cddc22df410caf1942ac13ab` with the pinned upstream
`400cba94af2ef3c9eb2afa984f26105f03e26b57`. At the check on 2026-10-20,
both upstream `main` and `dev` pointed to that commit (version 0.60.0).
The prior maintenance commit is `a4008357264eb0db31ca7bb9aac0c67d75050632`,
which contains upstream `bd2c9dda3c987f9f3f1d0e3a8913c9d3df598516`.
No moving upstream ref is used as a build input.

Upstream adds four commits: updated detected host icons, RouterOS shell
bootstrap handling, returning to the previous page/folder after closing the
last terminal, and the 0.60.0 version bump. The source changes introduce no
new build/publish scripts or credentials. AGPLv3, upstream history and the
fork notices are preserved.

Three SSH conflicts were resolved by keeping the fork's typed authentication
errors, system-key policy and user-owned tmux/Zellij sessions, while adopting
upstream's nested `OneShotTarget` and platform detection. Windows and RouterOS
skip POSIX bootstrap/env injection and multiplexer discovery. The shared
passphrase retry helper now handles the nested target without persisting
answers or accepting an unrelated credential challenge. Its tests exercise
exec, persistent-session cleanup and direct distro detection through the real
frontend service functions.

The input, selection, clipboard, toolbar and narrow-symbol changes are described
in [the repair build note](android-single-drag-and-input-20261019.md). In
particular, remote alternate-screen/mouse protocols still send whole events;
their visual movement is controlled by the remote application. The private
field screenshot and installed version have not been verified by this cloud
worker. Synthetic glyph bounds tests do not establish that the field report is
resolved.

## Reproduction and promotion

Use an isolated candidate based on the verified repair, then merge the fixed
upstream SHA without rebasing or dropping either history:

```sh
git switch -c candidate/android-release-daily-20261020-400cba94 18bc8a0d28264eb4cddc22df410caf1942ac13ab
git merge --no-ff 400cba94af2ef3c9eb2afa984f26105f03e26b57
```

The checked-in merge resolutions and regression tests are part of the candidate.
Its push runs `.github/workflows/android-arm64-debug.yml`. Despite the historic
filename, `candidate/android-release-*` builds optimized ARM64 Release using
the repository's existing public development test identity. No private signing
key is generated or uploaded. This identity is not a production signing
identity or a promise of long-term upgrade compatibility.

The workflow installs locked dependencies, runs browser touch/clipboard/glyph
checks at actual DPR 1/2/3, frontend/type checks, crypto/native regressions,
Android API 24/35 IME contracts, then verifies APK identity, signature, SHA256
and 16 KiB ZIP/ELF alignment. It preserves the APK and logs as a 14-day Actions
artifact. Full commands and pinned tool versions are in that workflow and
`docs/android-fork-build.md`.

Advance `mafei/android` only after every required job succeeds and the artifact
manifest matches the exact candidate SHA/tree and release mode. Re-read the
maintenance ref and require its expected SHA to remain
`a4008357264eb0db31ca7bb9aac0c67d75050632`; use a non-forced fast-forward.
If the ref changed, conflict resolution fails, a check fails, or artifact
verification is incomplete, retain the candidate for diagnosis and leave the
maintenance ref unchanged. Do not publish a release/tag or install a device.
