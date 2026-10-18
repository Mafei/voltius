# Android toolbar, glyph and gesture candidate

Based on the delivered Android source `0b1dba3e8ff3a5155502d553816c3999feb0c257`, upstream version 0.58.0. This candidate keeps the Android native IME/cursor adapter. It selectively ports shared font-loading, overlapping-glyph rescaling and WebGL atlas/resource fixes from the independently delivered macOS source `a56f521e4104195b67b83f4f215af93a0d9ea9bf`; no macOS branch or package is rebuilt.

The management and extra-key rows share button/row classes and tokens: 40 CSS px minimum touch targets, 36 px normal faces, 6 px gaps and 3 px visible face-to-edge spacing. Both normal rows are 42 px. Text retains its size and variable button widths. All controls grow together with enlarged text, including icon-only controls. The Android system navigation inset sits outside the measured toolbar. Tab labels reserve space above the selected underline; the measured glyph-ink gap must be at least 2.5 px.

Before measurements on the delivered source (393×852, default font): management row 45.5 px, 33.25 px button face, 5.625 px horizontal/vertical container padding; extra row 40 px, 36 px face, 4 px horizontal and 0 px vertical padding. Active subtitle glyph ink was only 0.734375 px above the selected underline. Measurements distinguish visible faces, touch targets, row bounds and real glyph ink.

Two-finger input no longer enters pinch immediately. Translation resolves at 10 px when centroid travel dominates span change by 1.2×. Pinch resolves at max(12 px, 8% initial span) when span change dominates centroid travel by 1.2×. Ambiguous motion waits; a resolved gesture stays locked until all fingers lift. Contact changes and viewport resize cancel the current sequence without synthesizing a single-finger tap. Normal shell scrollback uses xterm line scrolling with sub-line carry; alternate-screen and mouse modes enter the existing wheel handler, preserving input gates, application arrows and SGR mouse reporting. One-finger interaction and the native IME implementation remain unchanged.

## Reproduce

```sh
pnpm install --frozen-lockfile --ignore-scripts
npm ci --prefix tests/desktop-ui/tools --ignore-scripts
pnpm exec tsc
pnpm test
pnpm vite --config scripts/desktop-ui.vite.config.ts
# In a second shell; requires normally sandboxed Chrome and fonts-noto-cjk:
VOLTIUS_BROWSER_TOOLS="$PWD/tests/desktop-ui/tools" \
VOLTIUS_BROWSER_EXECUTABLE=/usr/bin/google-chrome \
VOLTIUS_UI_EVIDENCE=android-ui-evidence \
node scripts/verify-android-mobile.mjs
```

The CI workflow runs this aggregate verifier before the optimized ARM64 Release build. It uses the existing public development/test signing identity, checks APK signature/metadata and 16 KiB ZIP/ELF alignment, runs Android API 24/35 Robolectric IME tests and native regressions, and attaches source/build evidence. It creates no release or persistent signing key. This test identity is public and unsuitable for production distribution.

Browser evidence uses real React components, xterm, production font/renderer/gesture helpers and synthetic terminal data. It covers portrait/landscape/narrow/wide layouts, DPR 1/2/3, text-only and root-font scales up to 3×, simulated IME open/closed and panel open/closed states, horizontal start/middle/end positions and the pinned-modifier seam. It uses local transport and TUI escape sequences to simulate Zellij mouse tracking; this is not a live Zellij session or device test. Glyph tests use bundled Source Code Pro/JetBrains Mono with an explicit wide Noto CJK fallback, checking actual framebuffer ink and unchanged narrow-cell widths/ASCII/CJK controls. This does not identify the user's exact Android WebView font fallback.

Private screenshot materialization was attempted twice per resolved Library file using the supported transfer helper and failed before any pixels reached this container. The original private screenshots were not reviewed here. Synthetic before/after screenshots were materialized locally and manually inspected. No private image, user terminal content or credentials are committed or included in public evidence. Android physical-device/System WebView/real IME and emulator launch remain untested unless separately documented by the build evidence.

Keep this branch a candidate until validation and user testing are accepted. Daily upstream maintenance remains owned by the parent task; do not promote `mafei/android`, force push, delete history, publish a release, change user host configuration or install/uninstall any device application.
