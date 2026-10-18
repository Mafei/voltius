import { terminalFontStack } from "@/utils/fontStack";
import { createTerminal, write, nextFrame, captureFrame, renderer, emit, nativeViewSnapshot } from "./support";
import "@xterm/xterm/css/xterm.css";
import "@/styles/globals.css";

const characters = ["①", "②", "③", "④", "⑤", "⑩", "⑳", "⓪", "Ⓐ", "中", "A", "1"];
function inkBounds(pixels: Uint8Array, width: number, cellLeft: number, cellRight: number) {
  const background = pixels.slice(0, 3); let left = width, right = -1, ink = 0, outside = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (Math.abs(pixels[i] - background[0]) <= 3 && Math.abs(pixels[i + 1] - background[1]) <= 3 && Math.abs(pixels[i + 2] - background[2]) <= 3) continue;
    const x = i / 4 % width; left = Math.min(left, x); right = Math.max(right, x); ink++;
    if (x < cellLeft || x >= cellRight) outside++;
  }
  return { left, right, ink_pixels: ink, outside_cell_pixels: outside, ink_width: right - left + 1 };
}
async function run() {
  const results: Record<string, any>[] = [], images: Record<string, unknown>[] = [];
  for (const font of ["Source Code Pro", "JetBrains Mono"]) for (const size of [14, 18]) {
    await document.fonts.load(`${size}px "${font}"`); await document.fonts.ready;
    const host = document.getElementById("primary")!;
    const term = createTerminal(host, { cols: 40, rows: 8, fontSize: size, fontFamily: terminalFontStack(`'${font}', monospace`) });
    const production = term.options.rescaleOverlappingGlyphs;
    const ctx = document.createElement("canvas").getContext("2d")!; ctx.font = `${size}px ${term.options.fontFamily}`;
    for (const [phase, enabled] of [["legacy", false], ["production", production], ["rescale-reference", true]] as const) {
      term.options.rescaleOverlappingGlyphs = enabled;
      for (const character of characters) {
        const pixels = await captureFrame(term, () => write(term, `\x1b[?25l\x1b[0m\x1b[2J\x1b[H\x1b[3;5H${character}`));
        const r = renderer(term), gl: WebGL2RenderingContext = r._gl;
        const cell = term.buffer.active.getLine(2)!.getCell(4)!, cellWidth = r.dimensions.device.cell.width;
        const metrics = ctx.measureText(character), logical = cell.getWidth(), expected = character === "中" ? 2 : 1;
        results.push({ phase, enabled, font, font_size_css_px: size, dpr: devicePixelRatio, character, codepoint: "U+" + character.codePointAt(0)!.toString(16).toUpperCase(),
          logical_cells: logical, expected_wcwidth_narrow: expected, device_cell_width: cellWidth, glyph_advance_css_px: metrics.width,
          canvas_ink_css_px: metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight,
          ...inkBounds(pixels, gl.drawingBufferWidth, 4 * cellWidth, (4 + logical) * cellWidth) });
      }
      await write(term, "\x1b[?25l\x1b[0m\x1b[2J\x1b[H测试 ①②③④⑤ ABC 中文\r\n①③④⑤ / 0123456789 / Symbols\r\n┌────────┬───────────┐\r\n│ ①②③④⑤ │ 123456.78 │\r\n└────────┴───────────┘");
      await nextFrame();
      const image = await nativeViewSnapshot(`glyph-${font.replaceAll(" ", "-")}-${size}-${phase}`, host, true);
      if (image) images.push(image);
    }
    term.dispose(); host.replaceChildren();
  }
  const productionFailures = results.filter((r) => r.phase === "production" && (r.outside_cell_pixels > 0 || r.logical_cells !== r.expected_wcwidth_narrow));
  const referenceFailures = results.filter((r) => r.phase === "rescale-reference" && (r.outside_cell_pixels > 0 || r.logical_cells !== r.expected_wcwidth_narrow));
  const summary = ["legacy", "production", "rescale-reference"].map((phase) => ({ phase, cases: results.filter((r) => r.phase === phase).length,
    overflowing: results.filter((r) => r.phase === phase && r.outside_cell_pixels > 0).length,
    width_mismatches: results.filter((r) => r.phase === phase && r.logical_cells !== r.expected_wcwidth_narrow).length }));
  const result = { phase: "complete", case: "ambiguous-glyph-overlap", summary, results, native_images: images,
    failed_checks: productionFailures.length + referenceFailures.length,
    scope: "Synthetic enclosed alphanumerics and narrow ambiguous-width contract on native production xterm. No user screenshot or server configuration is used." };
  emit(result);
}
run().catch((error) => emit({ phase: "error", message: String(error), stack: error?.stack }));
