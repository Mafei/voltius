import { expect, test } from "vitest";
import { pixelPosition } from "./terminalPixelScroll";

test.each([11, 16, 19.5, 27.3, 48])("CSS pixel distance is additive and reversible with %spx cells", height => {
  for (const dpr of [1, 1.5, 2, 3]) {
    let position = 30 * height + .25;
    const origin = position;
    for (const delta of [2, .125, .125, .5, 15, 230, -5, -240, -2.75]) {
      const next = pixelPosition(position, delta, height, 1000);
      expect(next.value - position).toBeCloseTo(delta, 10);
      expect(next.line * height + next.fraction).toBeCloseTo(next.value, 10);
      expect(next.fraction).toBeGreaterThanOrEqual(0);
      expect(next.fraction).toBeLessThan(height + 1e-10);
      // DPR changes backing pixels, never CSS finger distance.
      expect((next.value - position) * dpr).toBeCloseTo(delta * dpr, 10);
      position = next.value;
    }
    expect(position).toBeCloseTo(origin, 10);
  }
});

test("clamping discards overshoot immediately, so reversing at a boundary has no dead travel", () => {
  expect(pixelPosition(3, -1000, 16, 100)).toEqual({ value: 0, line: 0, fraction: 0 });
  expect(pixelPosition(0, 2, 16, 100)).toEqual({ value: 2, line: 0, fraction: 2 });
  expect(pixelPosition(1599, 1000, 16, 100)).toEqual({ value: 1600, line: 100, fraction: 0 });
  expect(pixelPosition(1600, -2, 16, 100)).toEqual({ value: 1598, line: 99, fraction: 14 });
});
