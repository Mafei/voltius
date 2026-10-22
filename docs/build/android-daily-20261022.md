# Android daily integration — 2026-10-22

Start from validated maintenance
`4be443d3e99849df2af0a0815db6e1b043262d26` and merge pinned upstream `dev`
`32435bb84a6eaf99397268b6a20ec67d970c02e8`. Upstream's default `main` remains
`400cba94af2ef3c9eb2afa984f26105f03e26b57`, already included. Dev adds two
commits after the previously integrated `869a621d`: #678 updates Vite and its
locked dependencies to 8.1.6; #677 corrects xterm mouse coordinates and
selection drag-scroll under UI scaling. The app version stays 0.60.0.

The only conflict is in `terminalContainer.ts`, where both histories insert
an import and a mount-time call. Retain the fork's font synchronization and
fit callback alongside upstream's mouse correction. Upstream installs its
mouse wrapper once for each terminal lifetime and reads current geometry
for each event; remounting a cached terminal must not stack or remove it.
The new mouse helper/tests and package/lockfile match the pinned upstream
blobs exactly. Existing touch pixel scrolling, native selection, clipboard,
input gates, SSH authentication and session ownership remain unchanged.

No Android permission, foreground service, power policy, build/publish
script or credential is added. LICENSE/NOTICE and both parent histories
remain. Icon PR #20 at `e044d0d0` and macOS controls at `c32bf384` stay on
their independent candidate branches; neither is merged here. The new
experimental Android feature branches are outside the established dev
tracking policy and are not build inputs.

## Reproduce and validate

```sh
git worktree add -b candidate/android-release-daily-20261022-32435bb8 \
  ../voltius-android-daily-20261022 4be443d3e99849df2af0a0815db6e1b043262d26
cd ../voltius-android-daily-20261022
git merge --no-ff 32435bb84a6eaf99397268b6a20ec67d970c02e8
# Resolve the two mount/import conflict blocks by retaining both helpers.
pnpm install --frozen-lockfile --ignore-scripts
pnpm exec vitest run src/components/terminal/terminalMouseScale.test.ts \
  src/utils/terminalFonts.test.ts src/hooks/useTerminal.reattach.test.tsx
pnpm exec tsc --noEmit
```

Local targeted tests exercise real xterm coordinate services, duplicate
installation, live scaling, font loading and cached-view reattachment. A
separate synthetic production browser check covers physical mouse selection
and SGR reports across live scale changes at actual DPR 1/2/3. These are
browser tests with synthetic native/transport boundaries, not Android OS
runtime or phone validation.

The candidate push runs the existing exact-SHA Android workflow. Its
`candidate/android-release-*` name selects optimized universalRelease ARM64
with the repository's existing public development test identity. All mobile
browser, frontend, crypto, API 24/35 Robolectric IME, targeted native and full
Rust workspace checks must pass. Verify the recorded source SHA/tree,
package/version/minSdk/ABI, APK v2 certificate and SHA256, ZIP/ELF 16 KiB
alignment, and equality with the just-built native library before promotion.
Only public APK/metadata/logs/license files belong in the temporary artifact;
do not include private signing material or browser screenshots in Library.

Re-read the remote maintenance and candidate refs before advancing. Require
`mafei/android` still to equal `4be443d3e99849df2af0a0815db6e1b043262d26`,
then use a non-forced fast-forward to the exact validated candidate. Retain
the candidate and old maintenance head on unresolved conflicts, semantic
regressions, failed checks or incomplete provenance. Do not publish a
Release/tag, install a device, or change permissions/security settings.
The public test signing identity is unsuitable for long-term production
upgrades. The x86_64 runner cannot execute this ARM64-only package without
a matching guest; record feasibility rather than claiming a runtime pass.
