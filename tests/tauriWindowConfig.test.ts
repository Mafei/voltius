import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const base = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const macOS = JSON.parse(readFileSync("src-tauri/tauri.macos.conf.json", "utf8"));

it("enables native macOS decorations while preserving every base window setting", () => {
  // Tauri's JSON Merge Patch replaces arrays rather than merging their items.
  // Keep the complete window list here so dimensions and drag/drop don't reset.
  expect(base.app.windows[0].decorations).toBe(false);
  expect(macOS).toEqual({
    app: {
      windows: base.app.windows.map((window: Record<string, unknown>) => ({
        ...window,
        decorations: true,
      })),
    },
  });
});
