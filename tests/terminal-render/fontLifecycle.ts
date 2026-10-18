import { terminalFontStack } from "@/utils/fontStack";
import { createTerminal, write, nextFrame, captureFrame, renderer, comparePixels, emit, nativeViewSnapshot } from "./support";
import "@xterm/xterm/css/xterm.css";
import "@/styles/globals.css";

async function run() {
  const fontEvents: Record<string, unknown>[] = [];
  document.fonts.addEventListener("loadingdone", (event) => {
    const value = { phase: "font-set-event", families: event.fontfaces.map((face) => face.family), status: document.fonts.status };
    fontEvents.push(value); emit(value);
  });
  const face = new FontFace("Synthetic Delayed Mono", 'url("/tests/terminal-render/delayed-mono.woff2")');
  document.fonts.add(face);
  const source = new URLSearchParams(location.search).get("precision") === "font-set" ? "FontFaceSet.load" : "FontFace.load";
  const loading = source === "FontFaceSet.load" ? document.fonts.load('14px "Synthetic Delayed Mono"', "0123456789") : face.load();
  const term = createTerminal(document.getElementById("primary")!, { cols: 70, rows: 8, fontFamily: terminalFontStack("'Synthetic Delayed Mono', monospace") });
  const frame = "\x1b[?25l\x1b[0m\x1b[2J\x1b[H" + ["Synthetic delayed font / 合成延迟字体", "0123456789 ABCDEFG abcdefg +-*/= → ± │", "┌──────────┬───────────┐", "│ 中文合成 │ 123456.78 │", "└──────────┴───────────┘"].join("\r\n");
  await write(term, frame); await nextFrame();
  const before = await captureFrame(term, () => write(term, frame));
  const initial = { font_status: face.status, font_set_status: document.fonts.status, dimensions: [renderer(term)._gl.drawingBufferWidth, renderer(term)._gl.drawingBufferHeight] };
  await loading; await document.fonts.ready; await nextFrame(); await nextFrame();
  const live = await captureFrame(term, () => write(term, frame));
  // A semantically identical CSS family string gives the cold reference its own atlas.
  const cold = createTerminal(document.getElementById("reference")!, { cols: 70, rows: 8, fontFamily: terminalFontStack('"Synthetic Delayed Mono", monospace') });
  await write(cold, frame); await nextFrame();
  const expected = await captureFrame(cold, () => write(cold, frame));
  const afterLoad = comparePixels(expected, live);
  const afterLoadDimensions = [renderer(term)._gl.drawingBufferWidth, renderer(term)._gl.drawingBufferHeight];
  const afterLoadImage = await nativeViewSnapshot("font-after-load", document.getElementById("primary")!, true);
  term.clearTextureAtlas();
  const afterClear = await captureFrame(term, () => write(term, frame));
  term.options.fontFamily = terminalFontStack(' "Synthetic Delayed Mono", monospace');
  const afterRemeasure = await captureFrame(term, () => write(term, frame));
  const afterRemeasureImage = await nativeViewSnapshot("font-after-remeasure", document.getElementById("primary")!, true);
  const result = { phase: "complete", case: "delayed-font-availability", load_source: source, font_events: fontEvents, initial, after_load_dimensions: afterLoadDimensions, final_font_status: face.status,
    dimensions: { live: [renderer(term)._gl.drawingBufferWidth, renderer(term)._gl.drawingBufferHeight], cold: [renderer(cold)._gl.drawingBufferWidth, renderer(cold)._gl.drawingBufferHeight] },
    after_load_vs_cold: afterLoad, after_cache_clear_vs_cold: comparePixels(expected, afterClear), after_option_remeasure_vs_cold: comparePixels(expected, afterRemeasure),
    pre_post_load: comparePixels(before, live), failed_checks: afterLoad.different_pixels === 0 && afterLoad.same_dimensions ? 0 : 1,
    native_images: { after_load: afterLoadImage, after_remeasure: afterRemeasureImage, note: "Font availability changes intentionally; image differences here are not asserted as compositor corruption." },
    scope: "Synthetic delayed bundled font on production xterm; independent of the private screenshot and not proof of the user's reported root cause." };
  (window as any).__terminalRenderResult = result; emit(result);
}
run().catch((error) => emit({ phase: "error", message: String(error), stack: error?.stack }));
