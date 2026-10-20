import { terminalFontStack } from "@/utils/fontStack";
import { createTerminal, write, nextFrame, captureFrame, renderer, emit, nativeViewSnapshot, hash } from "./support";
import "@xterm/xterm/css/xterm.css";
import "@/styles/globals.css";

const variants = [["normal", "0", ""], ["bold", "1", "bold "], ["italic", "3", "italic "]] as const;
const characters = ["①", "②", "③", "④", "⑤", "⑩", "⑳", "⓪", "Ⓐ", "→", "←", "↔", "⇒", "⇢", "≤", "≥", "中", "文", "字", "A", "1", "😀", ""];
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
  const mixed: Record<string, unknown>[] = [], rebuilt: Record<string, unknown>[] = [];
  const results: Record<string, any>[] = [], images: Record<string, unknown>[] = [];
  for (const font of ["Source Code Pro", "JetBrains Mono"]) for (const size of [14, 18]) {
    const loadedFaces = await document.fonts.load(`${size}px "${font}"`); await document.fonts.ready;
    const host = document.getElementById("primary")!;
    const term = createTerminal(host, { cols: 40, rows: 8, fontSize: size, fontFamily: terminalFontStack(`'${font}', 'Noto Sans CJK SC', monospace`) });
    await nextFrame(); await nextFrame();
    const production = term.options.rescaleOverlappingGlyphs;
    const ctx = document.createElement("canvas").getContext("2d")!; ctx.font = `${size}px ${term.options.fontFamily}`;
    for (const [phase, enabled] of [["legacy", false], ["production", production], ["rescale-reference", true]] as const) {
      term.options.rescaleOverlappingGlyphs = enabled;
      await nextFrame(); await nextFrame();
      for (const [variant, sgr, weight] of variants) for (const character of characters) {
        ctx.font = `${weight}${size}px ${term.options.fontFamily}`;
        const pixels = await captureFrame(term, () => write(term, `\x1b[?25l\x1b[0m\x1b[2J\x1b[H\x1b[3;5H\x1b[${sgr}m${character}`));
        const r = renderer(term), gl: WebGL2RenderingContext = r._gl;
        const cell = term.buffer.active.getLine(2)!.getCell(4)!, cellWidth = r.dimensions.device.cell.width;
        const metrics = ctx.measureText(character), logical = cell.getWidth(), expected = ["中", "文", "字"].includes(character) ? 2 : 1;
        results.push({ phase, enabled, variant, font, declared_faces_loaded: loadedFaces.map(face => face.family), font_size_css_px: size, dpr: devicePixelRatio, character, codepoint: "U+" + character.codePointAt(0)!.toString(16).toUpperCase(),
          logical_cells: logical, expected_wcwidth_narrow: expected, device_cell_width: cellWidth, glyph_advance_css_px: metrics.width,
          canvas_ink_css_px: metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight,
          pixel_hash: hash(pixels), ...inkBounds(pixels, gl.drawingBufferWidth, 4 * cellWidth, (4 + logical) * cellWidth) });
      }
      for (const [variant, sgr] of variants) {
        await write(term, `\x1b[?25l\x1b[0m\x1b[2J\x1b[H\x1b[${sgr}m文字→中文→ABC`);
        const row = term.buffer.active.getLine(0)!;
        const advances = [0, 2, 4, 5, 7, 9, 10, 11, 12].map(col => [col, row.getCell(col)?.getChars(), row.getCell(col)?.getWidth()]);
        const valid = JSON.stringify(advances) === JSON.stringify([[0,"文",2],[2,"字",2],[4,"→",1],[5,"中",2],[7,"文",2],[9,"→",1],[10,"A",1],[11,"B",1],[12,"C",1]]) && term.buffer.active.cursorX === 13;
        mixed.push({phase,font,size,variant,valid,advances,cursor_x:term.buffer.active.cursorX});
      }
      if (enabled) {
        term.clearTextureAtlas();
        const pixels = await captureFrame(term, () => write(term, "\x1b[?25l\x1b[0m\x1b[2J\x1b[H\x1b[3;5H\x1b[3m→"));
        const r = renderer(term), gl: WebGL2RenderingContext = r._gl, cw = r.dimensions.device.cell.width;
        rebuilt.push({phase,font,size,...inkBounds(pixels,gl.drawingBufferWidth,4*cw,5*cw)});
      }
      await write(term, "\x1b[?25l\x1b[0m\x1b[2J\x1b[H测试 ①②③④⑤ ABC 中文\r\n文字→中文→ABC ≤≥↔⇒\r\n\x1b[3m文字→中文→ABC\x1b[0m\r\n┌────────┬───────────┐\r\n│ ①②③④⑤ │ 123456.78 │\r\n└────────┴───────────┘");
      await nextFrame();
      const image = await nativeViewSnapshot(`glyph-${font.replaceAll(" ", "-")}-${size}-${phase}`, host, true);
      if (image) images.push(image);
    }
    term.dispose(); host.replaceChildren();
  }
  const isControl = (r: Record<string, any>) => ["中", "文", "字", "A", "1", "😀", ""].includes(r.character);
  const invalid = (r: Record<string, any>) => {
    if (r.ink_pixels === 0 || r.logical_cells !== r.expected_wcwidth_narrow) return true;
    if (!isControl(r)) return r.outside_cell_pixels > 0;
    const before = results.find((x) => x.phase === "legacy" && x.font === r.font && x.font_size_css_px === r.font_size_css_px && x.character === r.character && x.variant === r.variant)!;
    // xterm deliberately preserves ASCII (including existing fractional-cell
    // edge ink) and double-width CJK. Assert unchanged pixels, not rescaling.
    return r.pixel_hash !== before.pixel_hash;
  };
  const productionFailures = results.filter((r) => r.phase === "production" && invalid(r));
  const referenceFailures = results.filter((r) => r.phase === "rescale-reference" && invalid(r));
  const summary = ["legacy", "production", "rescale-reference"].map((phase) => ({ phase, cases: results.filter((r) => r.phase === phase).length,
    overflowing: results.filter((r) => r.phase === phase && r.outside_cell_pixels > 0).length,
    enclosed_overflowing: results.filter((r) => r.phase === phase && /[\u2460-\u24ff]/.test(r.character) && r.outside_cell_pixels > 0).length,
    symbol_overflowing: results.filter((r) => r.phase === phase && !isControl(r) && !/[\u2460-\u24ff]/.test(r.character) && r.outside_cell_pixels > 0).length,
    width_mismatches: results.filter((r) => r.phase === phase && r.logical_cells !== r.expected_wcwidth_narrow).length }));
  const result = { phase: "complete", case: "ambiguous-glyph-overlap", summary, results, native_images: images,
    failed_checks: productionFailures.length + referenceFailures.length + mixed.filter(r => !r.valid).length + rebuilt.filter(r => Number(r.outside_cell_pixels) > 0 || !r.ink_pixels).length,
    mixed_cell_contracts: mixed, atlas_rebuild_contracts: rebuilt,
    scope: "Synthetic enclosed symbols, arrows/mathematical symbols with CJK and Latin; normal/bold/italic variants; narrow ambiguous-width contract on production xterm in a synthetic browser fixture. No user screenshot or server configuration is used." };
  emit(result);
}
run().catch((error) => emit({ phase: "error", message: String(error), stack: error?.stack }));
