# Android single-finger pixel drag and input fixes

Base: verified maintenance a4008357264eb0db31ca7bb9aac0c67d75050632 (0.59.0). This independent candidate does not merge/chase another upstream head or alter maintenance automatically. AGPLv3 and upstream NOTICE/history remain.

## Final requested behavior

- One finger drags normal, non-mouse scrollback by the delivered CSS-pixel motion, without inertia, velocity multipliers or whole-row quantization. Recognition uses1CSSpx to distinguish a tap/long press; once crossed, all motion from the initial contact is included. At scrollback boundaries motion clamps, and reversing responds immediately without accumulating overshoot. Fractional position persists after lift/cancel.
- Two-finger translation is consumed without scrolling. Deliberate pinch remains; centroid translation locks to ignored motion so later span jitter cannot become zoom. Added/removed/replaced contacts, cancellation and viewport/keyboard changes invalidate stale single-finger motion until all contacts lift.
- Long press, selection/handle bridge, copy and selection cancellation do not ask Android to show/hide IME or change its owner. Existing explicit dismissal, inactive-session ownership guard and volumeCtrl=false on hide remain. The prior direct cause was hideAndroidKeyboard(sessionId,true) on entering native selection, followed by native hideSoftInputFromWindow/resetInput/requestFocus. Removing that coupling avoids both the keyboard dismissal and artificial viewport shrink. No showSoftInput polling/reopening workaround is added. Existing session-switch dismissal/cancellation policy is preserved; stale old compositions are not forwarded to another session.
- Final shortcut order: Ctrl,Alt,Esc,Tab,Up,Down,Left,Right,Home,End,PgUp,PgDn,+,|,Paste,then existing panel toggle. Removed buttons:ShiftTab,~, -,/. Their terminal/physical-keyboard mappings remain. Plus is a literal character.
- Paste invokes the same clipboard action asCtrl+Shift+V, reads only after activation, uses xterm paste/bracketed-paste settings, does not synthesizeCtrl+V or appendEnter, and leaves modifier latches/IME focus unchanged. Empty text and Chinese/single characters are covered. Clipboard access or confirmation finishing after an Android session switch is discarded. The baseline had no terminal multiline confirmation; Android clipboard paste now asks inline before text containing line breaks. Confirmation does not focus another input. The single-character paste path bypasses virtual modifier consumption while still passing input gates. Sanitization reuses the existing terminal-paste sanitizer. Ordinary non-Android clipboard text behavior remains unchanged.

## Pixel rendering boundary and actual constraints

xterm6's public viewport rounds pixels to integer rows. The adapter pins the real buffer viewport tofloor(position/cellHeight), keeps its real PTY rows/columns, translates xterm-screen by the CSS remainder, and fills the exposed bottom strip from the same renderer's next viewport row. The neighbour paint temporarily changes the internal presentation-only viewport index synchronously, captures the WebGL backing image (or clones the DOM renderer row), restores the real index in finally and repaints the true viewport. It emits no fake PTY resize, remote data or public scroll notification for the neighbour paint. Fraction-only moves reuse the row surface; a row change/output refresh refreshes its guard. DPR affects backing pixels only, never finger CSS distance. Unknown/unavailable renderers fail closed to rows; the pinned WebGL0.19/DOM paths are tested explicitly. Actual GPU loss can still interrupt display until xterm's own fallback/restoration completes.

Alternate screen without mouse reporting has no local scrollback. It receives whole Up/Down arrow sequences. Mouse-reporting TUIs (including simulated Zellij SGR mode) receive whole wheel ticks; sub-row motion is carried only within the gesture, without a local fractional translation. Those protocols have no pixel-scroll position/acknowledgement, and the remote application decides lines, acceleration and repaint, so remote visual1:1 cannot be guaranteed. This candidate does not claim otherwise or change remote settings.

## Reproduce

The existing .github/workflows/android-arm64-debug.yml builds candidate/android-release-* in optimized ARM64 Release mode using Node24.19.0,pnpm11.5.2,Java21,SDK36/build-tools36.0.0,NDK27.1.12297006 and rustc1.96.0. It reuses the existing PUBLIC development-test signature, not a production upgrade identity. No new key/permission/credential/release is required.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm exec tsc --noEmit
pnpm exec tsc --project tests/desktop-ui/tsconfig.mobile.json
# Start a fresh local server after edits; fixture hot updates are disabled.
pnpm vite --config scripts/desktop-ui.vite.config.ts
# In another process with the documented Playwright tools/executable environment:
node scripts/verify-mobile-gestures.mjs
```

Normal-sandbox Chromium process scales1/2/3 verify actual backing density. The full verifier covers three font sizes and two line heights, short/slow/reverse/long/up drags, both boundaries, repeated pair translation and clear pinch, contact/keyboard lifecycle, real production DOM selection/copy bridge, actual shared Paste flow and WebGL/DOM pixel references. Quick mode is diagnostic only and recorded as such. Selection ranges, keyboard visibility/viewport and clipboard are synthetic test seams; no host clipboard or remote server is read by browser fixtures. The existing toolbar/tab/glyph matrix remains in the CI aggregate.

Pixel comparison requires Pillow. CI installs Ubuntu's python3-pil and explicitly selects /usr/bin/python3 with VOLTIUS_PIXEL_PYTHON, recording its version. Local tools may set the same environment variable to a Python containing Pillow. This fixes a clean-runner dependency failure in the first candidate CI; that failed run never started the APK build and its assertions were not weakened.

Robolectric API24/35 checks native InputConnection/IME/focus composition and explicit hide/VolumeDown contracts. It does not instantiate Android Chromium's OS selection handles or an OEM keyboard. Physical Android/SystemWebView/IME/clipboard permissions and device/emulator launch remain untested until separately performed. No Mac or user device operation is part of this work. Graphify update is attempted; unavailable binaries are reported rather than installed implicitly.

## Expanded symbol/CJK overlap investigation

A new user report remains unconfirmed against an installed version and unavailable as image bytes in this builder. No private screenshot/code/path is published. The synthetic regression uses only文字→中文→ABC and individual symbols.

Inspection and synthetic framebuffer measurements found two gaps in the existing flag: xterm rescales only above1.5cell width, and compressed italic quads can retain a positive/negative origin crossing the cell edge. AtDPR1,54target cases still crossed a cell under the prior production flag, including italic arrows/enclosed symbols and moderately wide≤/≥. A pinned WebGL0.19 adapter now fits the complete horizontal quad for narrow arrows/math/enclosed symbols into its existing cell. It leaves Unicode cell advancement and ASCII/CJK/emoji/private-use/box-drawing geometry unchanged; it changes neither wcwidth nor remote locale settings. Fonts, styles and atlas-rebuild tests run with the pixel-drag adapter to catch interactions. This is a measured synthetic fix, not a claim that the new private screenshot incident or every Android font has been reproduced/resolved.

Expanded glyph measurements record normal/bold/italic variants, configured font stacks and actually declared faces (an empty declaration list means system fallback, not proof the named font is installed), individual ink bounds, mixed CJK2/arrow1/Latin1 cell positions and explicit atlas rebuilds. Actual device font fallback, the affected app version and native screenshot comparison remain open verification limits.
