/** Symbols covered by the terminal's narrow-cell contract. Do not change the
 * Unicode width provider, ASCII, CJK wide cells, emoji presentation, box drawing
 * or private-use/Nerd Font positioning. */
export function isFittedNarrowSymbol(chars: string, width: number): boolean {
  const cp = chars.codePointAt(0) ?? 0;
  return width === 1 && !chars.includes("\ufe0f") && !chars.includes("\u200d") && (
    cp >= 0x2190 && cp <= 0x22ff || cp >= 0x2460 && cp <= 0x24ff ||
    cp >= 0x27f0 && cp <= 0x27ff || cp >= 0x2900 && cp <= 0x297f);
}

type CellArgs = [x: number, y: number, code: number, bg: number, fg: number, ext: number, chars: string, width: number, lastBg: number];
export interface GlyphFitRenderer {
  updateCell(...args: CellArgs): void;
  _vertices?: { attributes: Float32Array };
  _dimensions?: { device: { cell: { width: number }; canvas: { width: number } } };
}

/** Pinned addon-webgl0.19 layout: offsetX at0, normalized sizeX at2,11 floats
 * per cell. xterm's >1.5-cell threshold misses moderate overflow, and its
 * existing size-only compression leaves italic origin offsets outside a cell.
 * Fit the complete quad into its EXISTING single cell, preserving texture,
 * vertical metrics, attributes and buffer/cursor advances. */
export function guardNarrowSymbolBounds(renderer: GlyphFitRenderer, cols: () => number, enabled: () => boolean): () => void {
  const original = renderer.updateCell;
  const wrapped = function(this: GlyphFitRenderer, ...args: CellArgs) {
    original.apply(this, args);
    if (!enabled() || !isFittedNarrowSymbol(args[6], args[7])) return;
    const array = this._vertices?.attributes, dimensions = this._dimensions?.device;
    const index = (args[1] * cols() + args[0]) * 11;
    if (!(array instanceof Float32Array) || !dimensions || index + 10 >= array.length) return;
    const cell = dimensions.cell.width, canvas = dimensions.canvas.width;
    const origin = array[index], size = array[index + 2] * canvas;
    if (!(cell > 1 && canvas > 0 && size > 0) || origin >= 0 && origin + size <= cell + .001) return;
    const fitted = Math.min(size, cell - 1);
    array[index] = (cell - fitted) / 2;
    array[index + 2] = fitted / canvas;
  };
  renderer.updateCell = wrapped;
  return () => { if (renderer.updateCell === wrapped) renderer.updateCell = original; };
}
