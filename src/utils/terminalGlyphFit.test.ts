import { expect, test } from "vitest";
import { guardNarrowSymbolBounds, isFittedNarrowSymbol, type GlyphFitRenderer } from "./terminalGlyphFit";

test("fitting never changes Unicode classification or protected glyph classes", () => {
  for (const ch of ["→", "↔", "≤", "≥", "①", "⟹"]) expect(isFittedNarrowSymbol(ch, 1)).toBe(true);
  for (const ch of ["A", "中", "😀", "", "─", "→️"]) expect(isFittedNarrowSymbol(ch, 1)).toBe(false);
  expect(isFittedNarrowSymbol("→", 2)).toBe(false);
});
test.each([[1,12], [2,9], [-2,10]])("moderate/italic overlap origin%s width%s fits without changing atlas coordinates", (origin, size) => {
  const array = new Float32Array(11), renderer: GlyphFitRenderer = {
    _vertices: { attributes: array }, _dimensions: { device: { cell: { width: 10 }, canvas: { width: 400 } } },
    updateCell() { array.set([origin, 3, size / 400, .2, 1, .1, .2, .3, .4, 0, 0]); },
  };
  const restore = guardNarrowSymbolBounds(renderer, () => 40, () => true);
  renderer.updateCell(0, 0, 0x2192, 0, 0, 0, "→", 1, 0);
  expect(array[0]).toBeGreaterThanOrEqual(0);
  expect(array[0] + array[2] * 400).toBeLessThanOrEqual(10.001);
  expect([...array.slice(3)]).toEqual([expect.closeTo(.2), 1, expect.closeTo(.1), expect.closeTo(.2), expect.closeTo(.3), expect.closeTo(.4), 0, 0]);
  restore(); renderer.updateCell(0, 0, 0x2192, 0, 0, 0, "→", 1, 0); expect(array[0]).toBe(origin);
});
