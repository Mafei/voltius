# Fixed-window redraw recovery diagnostic

A user reported that long-running terminal garbling disappears after resizing the window. The affected version is unknown; this is not evidence that the user tested delivered source a56f521e or that a particular cache is the cause.

This isolated diagnostic is based on delivered production font/renderer/UTF-8 helpers at a56f521e. It changes no production code and builds no macOS package. Runs here use normally sandboxed Linux Chromium, including a Macintosh user-agent only to select the production preserveDrawingBuffer=false setting. They are not native macOS/WebKit, Retina hardware, real remote application or user-case reproductions.

The fixed-window interval uses fragmented UTF-8, partial row rewrites and a scrolling region. Canvas size, host CSS size, DPR and row/column counts stay fixed. No fit, hide/show, atlas clearing or reference renderer creation occurs during that interval. Primary screenshots and buffer snapshots are saved; afterwards, independent CPU/GPU atlas reference terminals replay each saved buffer for comparison. A CSS-equivalent font-family whitespace suffix prevents references from sharing the primary CPU atlas. Screenshot pixels are decoded locally using Pillow; no screenshot is edited. Raw pixel differences and hashes are retained. Independent atlas packing produced 1/255 RGB antialias sampling variation in initial controls (120 raw differing pixels at DPR1; 1198 at DPR2, maximum channel delta1). The regression reports those differences and separately gates significant differences above1/255; it does not claim bit-identical images when raw differences exist.

After the baseline, independent cases inject either framebuffer damage or zeroed GPU glyph textures. These deliberately injected failures are diagnostic controls, not reproduction of the user's garbling. Each case compares:

- No action.
- Full refresh using existing caches.
- Texture-atlas clear followed by the same full refresh.
- Fit with unchanged host size and rows/columns.
- Container size/fit change and return, with changed rows/columns and canvas allocation.
- Synthetic VT full repaint without resizing or rebuilding the atlas.

The final case only simulates application output. It sends no bytes to any real remote shell, changes no remote configuration and does not model a real application's SIGWINCH response. Container fit is not a macOS window/Metal-layer resize. No periodic resize or cache-clearing workaround is added to the application.

## Reproduce in a cloud test environment

Requires locked frontend dependencies, Playwright test tools, normal Chrome sandbox, local CJK fonts, Python3 and Pillow. For example, after `pnpm install --frozen-lockfile --ignore-scripts` and `npm ci --prefix tests/desktop-ui/tools --ignore-scripts`:

```sh
pnpm exec tsc --project tests/terminal-render/tsconfig.resize.json
pnpm exec vite --config tests/terminal-render/resize-recovery.vite.config.ts
# In another shell:
VOLTIUS_BROWSER_TOOLS="$PWD/tests/desktop-ui/tools" \
VOLTIUS_BROWSER_EXECUTABLE=/usr/bin/google-chrome \
VOLTIUS_UI_EVIDENCE=resize-evidence-dpr1 \
VOLTIUS_DIAGNOSTIC_SECONDS=180 VOLTIUS_DIAGNOSTIC_DPR=1 \
node scripts/verify-terminal-resize-recovery.mjs
```

Repeat in a fresh context at a stable DPR2 if desired; this emulates device pixel scale, not Retina hardware. No user Mac is needed or operated. Native WebKit validation requires a separately authorized native test environment; none is run by this diagnostic branch's workflow triggers. Delivered macOS branches and packages stay unchanged.

A successful fixed-window run means only that the sampled synthetic output matched independent fresh renderers for the recorded time/engine. Recovery of an injected failure explains possible mechanisms; it does not identify the user's root cause. If a healthy baseline differs, inspect the saved model, dimensions, render counts, GPU errors and unmodified PNGs before proposing a product fix.
