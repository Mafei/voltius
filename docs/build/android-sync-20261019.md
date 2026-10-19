# Android daily upstream integration, 2026-10-19

Upstream was inspected once at 2026-10-19 00:17:50 UTC, then pinned:

- Official default branch `main`: `2bc088a3338c0e4c6dc2f5423aaa0be16d704a04`, release 0.59.0; three commits after the previous 0.58.0 baseline `7a64f0b25a4d3adf56d4fb1fd8f76db26d41fa85`.
- Development branch `dev`: `bd2c9dda3c987f9f3f1d0e3a8913c9d3df598516`; contains that main head plus three commits: native Android terminal text selection, device-local interface language, and team ownership changes.
- Actual fork maintenance `mafei/android`: `4e83ff5e685285b59f865d31526c4a1b66fd90c9`; it is an ancestor of the four-fix candidate below.

The independent integration branch starts at verified four-fix Android source `ac2bf3b5ed7ff76b24dbf61c17883bee4d64c66c` and merges the fixed dev head. No newer heads are chased in this iteration. Main is already an ancestor of dev, so a second main merge is unnecessary. The merge keeps upstream history, the AGPLv3 license, and the fork's toolbar/tab/renderer/two-finger fixes. It uses the existing cloud Voltius worktree; no additional execution workspace or macOS branch/package is involved.

The original four-fix APK remains independently available:
https://github.com/Mafei/voltius/actions/runs/39179029937/artifacts/12155563717

It is version0.58.0, source ac2bf3b5, APK SHA256 `9444ca1fa6091ae0d5347f323ab694d68368021f6e20f52ee321aea8699997bc`. It must not be confused with this version0.59.0 integration, whose final binary requires its own validation.

## Conflict and semantic review

Conflicts occurred in MobileTerminalGestures.tsx, androidKeyboard.ts and TerminalKeyboard.kt. The resolution retains the fork's native cursor-focus reporting, session-specific keyboard ownership and composition reset, while including upstream native selection and opt-in Volume Down as Ctrl. Selection focus handoff uses `hideAndroidKeyboard(sessionId, true)`; an inactive session cannot hide the active editor. Existing lock-screen input guards remain. The first API24/35 hardware-key regression run also found that an Android root can refocus its only focusable input after hide; hiding now explicitly disables the per-session Volume Down Ctrl flag, while showing restores the configured choice. The test keeps its hide assertion and verifies re-enabling on the next show.

A real synthetic-browser regression was found after merging native selection: the first touch armed a transparent DOM text overlay; the second touch targeted one of its spans. Immediately clearing that overlay detached the second touch target, so its final touchend no longer bubbled to the terminal gesture handler. The gesture remained stuck and the next two-finger scroll stopped. The integration disarms the overlay while retaining connected touch targets until all fingers lift, then clears them. A DOM lifecycle unit test and repeated CDP two-finger sequences cover this failure. Selection content and native selection arming remain upstream behavior.

Browser checks use real production components and xterm. They cover parallel/jitter and diagonal scroll, clear pinch in/out, shell scrollback, simulated Zellij SGR mouse and alternate-arrow routing, contact changes/cancel/viewport changes and single-finger mouse routing. For upstream native selection, long press arms the real overlay and a DOM range is injected before touch release to exercise its bridge. This does not emulate Android OS handles or prove native WebView selection behavior. Native InputConnection/focus and Volume Down ownership/release tests run under Robolectric API24/35. Physical Android/WebView/native IME, real remote Zellij and native selection handles remain untested.

## Build and promotion

Use the commands in android-chrome-and-gestures.md and the existing Android ARM64 workflow. Package metadata must reflect version0.59.0, arm64-v8a only and Release optimization; signature, native source provenance and 16KiB ZIP/ELF checks are required. Signing reuses the existing public development-test identity; it is not a production upgrade key, and no private key is included in artifacts.

Only advance maintenance after the final integration commit's tests and APK verification pass. Require the observed maintenance SHA and a non-forced fast-forward; keep both candidates if conflicts, semantic failures, check failures or a concurrent ref update occur. Do not publish releases, install/uninstall user devices, add credentials/permissions/security exceptions or create another daily automation.
