# Android session picker and terminal tabs

The Session List's line-character option is omitted on Android, removing its
entire native popup row. The existing optgroup heading, New and real session
identities remain. Desktop's separator and native OS row boundaries are unchanged.

The production mobile header is MobileTerminalScreen / MobileTerminalTopBar,
independent of desktop TitlebarTab. Its old fixed h-11 header could not contain
two inherited line heights plus chip padding and borders. A horizontal auto
scroller computes vertical overflow as auto, producing a vertical scroll range.
The fix uses intrinsic header/strip height, unitless compact line heights,
shrink-free chips with bounded ellipsis labels, and minimum 40x40 CSS-px touch
controls in every orientation/keyboard state. It does
not hide vertical overflow or limit accessibility font enlargement. Horizontal
scrolling remains available for multiple tabs; complete titles stay accessible.

The mobile browser fixture renders the actual production mobile screen and CSS,
with synthetic session data and mocked native/store effects. Verification covers
320x640, 393x852, 640x360 and 844x390 touch/mobile viewports; DPR1/2/3; font
scales1/1.3/1.5/2 using text-only and root-rem models; short/long single tabs and
six mixed single/two-line tabs, visual keyboard insets on/off and folded/unfolded
344x882/717x512 viewport models. Each glyph/line/icon/control must fit its actual
header and own line box, the strip must have zero vertical scroll range, and
horizontal scrolling, activation, close and New navigation must work. The real
extra-keys row also runs touch tap, drag-without-key and modifier long-press
checks; unit tests cover touch cancellation, focus and assistive activation.
Outer vertical padding and scrollbar tracks no longer consume terminal space;
safe-area padding remains when the keyboard is closed. Scrollbar presentation
is separate from the strict zero-vertical-scroll-range/glyph-fit assertions.
Before/after header, key-row and terminal-space measurements use CSS px, not
physical screenshot pixels; invalid overflowing baselines are marked. Before
screenshots emulate old styles on the same component, not an old APK.

Run scripts/verify-mobile-tabs.mjs with the existing local browser fixture server
and normally sandboxed Chrome. The shared verify-browser-ui action supplies the
pinned tools and temporary evidence artifact. candidate/android-ui-check-* runs
UI verification only; Release candidates require that job before their APK build.
The existing desktop browser job uses the same action without changing its UI.

These font models are simulations, not actual Android WebView textZoom/system
font settings. Browser screenshots and DOM tests do not prove an Android native
popup or physical-device behavior. The selected cloud environment currently has
no Android SDK, ADB, emulator or KVM; do not install on a user's device or disable
browser/WebKit/OS sandboxes to obtain a screenshot. No private screenshot or host
information belongs in these public fixtures. Final APK provenance, signatures,
alignment and tests are recorded by the inherited Release workflow.
