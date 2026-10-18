# Delayed terminal font availability and rendering diagnostics

The macOS ARM64 WKWebView font-lifecycle fixture reproduces stale terminal font
metrics when a bundled webfont loads after xterm opens. At 14px on the tested
cloud host, the live terminal retained a 560x128 framebuffer while a fresh
terminal using the loaded face measured 560x144. Clearing the atlas alone did
not fix the dimensions. Public font-option invalidation remeasured it, after
which the live and cold-reference pixels matched exactly. This establishes the
delayed-font defect; it does not establish that every long-running corruption
report has this cause.

The shared terminal mount installs one font-lifecycle addon per cached terminal.
It remains active across detached views and is disposed by xterm. A completed
load of a face in the terminal's font stack invalidates font metrics and cached
glyphs, refits a visible view (or defers its fit while hidden), then refreshes the
viewport. Unrelated UI fonts do not trigger it. Since xterm 6 has no public
remeasure-font method, a synchronous CSS-equivalent whitespace variation of
fontFamily invokes its public option invalidation before restoring the exact
setting. There is no interim paint or fit, no buffer clearing, and no periodic
atlas flush. System fonts/settings and the user's preferences are not changed.

The independent endurance fixture uses the production xterm/WebGL pool and
font stack with synthetic English, Chinese, digits, symbols, table borders,
combining text and styles. It grows the shared glyph atlas toward 4096, then
performs 900 seconds of output, scrolling, partial wide/narrow-cell overwrites
and DOM reattachment. It checks GPU pixels in the rendering stack and the
native WKWebView compositor's own-view snapshots. Font/grid size restoration,
native page zoom and recovery after the WebGL context pool evicts a terminal
are also checked. No private screenshot, host or business text is used.

The initial short native probe at source
7ec28094ed9525d9c6f6a0d8f5f5f2ee3b1bcfe1 had no pixel differences after
roughly 3500 updates in either production or highp-reference mode. This host
reported 23 precision bits even for lowp. The shader-precision hypothesis was
therefore not confirmed, and the production shader is unchanged.

Run the native fixture through .github/workflows/terminal-render-test.yml.
Probe branches record diagnostic failures without claiming a fix. Ordinary
candidate/desktop-render-* branches require zero failed checks and also build
and verify an ARM64 macOS test app using the existing shared desktop action.
The packaged app's signatures/architecture/normal startup and the isolated
WKWebView renderer harness are separate evidence. The harness is not a full
Voltius interaction, actual Zellij session, real SSH host, user GPU or macOS
system-settings test. A passing bounded soak is not a claim of indefinite
runtime stability or confirmation of the original unseen screenshot.
