// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ITerminalAddon, Terminal } from "@xterm/xterm";
import { synchronizeTerminalFonts } from "./terminalFonts";

const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");
afterEach(() => {
  if (originalFonts) Object.defineProperty(document, "fonts", originalFonts);
  else delete (document as unknown as { fonts?: FontFaceSet }).fonts;
});

function fixture() {
  const faces: FontFace[] = [];
  const fonts = Object.assign(new EventTarget(), { forEach(fn: (face: FontFace) => void) { faces.forEach(fn); } }) as unknown as FontFaceSet;
  Object.defineProperty(document, "fonts", { configurable: true, value: fonts });
  const addons: ITerminalAddon[] = [];
  const term = { element: document.createElement("div"), options: { fontFamily: "'Source Code Pro', monospace" }, rows: 24,
    clearTextureAtlas: vi.fn(), refresh: vi.fn(), loadAddon(addon: ITerminalAddon) { addons.push(addon); addon.activate(this as unknown as Terminal); } };
  const loaded = (...families: string[]) => {
    const event = new Event("loadingdone"); Object.defineProperty(event, "fontfaces", { value: families.map((family) => ({ family })) }); fonts.dispatchEvent(event);
  };
  return { term: term as unknown as Terminal, clear: term.clearTextureAtlas, refresh: term.refresh, addons, faces, fonts, loaded };
}

describe("cached terminal font loading", () => {
  it("remeasures a newly available terminal face, keeps its exact setting and schedules a fit/redraw", () => {
    const f = fixture(), fit = vi.fn(), family = f.term.options.fontFamily;
    synchronizeTerminalFonts(f.term, fit);
    f.loaded('"Source Code Pro"');
    expect(f.term.options.fontFamily).toBe(family);
    expect(f.clear).toHaveBeenCalledOnce(); expect(fit).toHaveBeenCalledOnce(); expect(f.refresh).toHaveBeenCalledWith(0, 23);
    f.addons.forEach((addon) => addon.dispose());
  });
  it("ignores unrelated UI fonts", () => {
    const f = fixture(), fit = vi.fn(); synchronizeTerminalFonts(f.term, fit); f.loaded("Inter Variable");
    expect(f.clear).not.toHaveBeenCalled(); expect(fit).not.toHaveBeenCalled(); f.addons.forEach((addon) => addon.dispose());
  });
  it("survives a detached cached view and reuses one listener with the latest fit callback", () => {
    const f = fixture(), first = vi.fn(), latest = vi.fn(); synchronizeTerminalFonts(f.term, first); synchronizeTerminalFonts(f.term, latest);
    expect(f.addons).toHaveLength(1); f.term.element!.remove(); f.loaded("Source Code Pro");
    expect(first).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledOnce(); f.addons.forEach((addon) => addon.dispose());
  });
  it("stops listening when xterm disposes its addon", () => {
    const f = fixture(), fit = vi.fn(); synchronizeTerminalFonts(f.term, fit); f.addons.forEach((addon) => addon.dispose()); f.loaded("Source Code Pro");
    expect(fit).not.toHaveBeenCalled(); expect(f.clear).not.toHaveBeenCalled();
  });
  it("handles an individual face completing without a loadingdone event and deduplicates both notifications", async () => {
    const f = fixture(), fit = vi.fn(); let complete!: (face: FontFace) => void;
    const face = { family: "Source Code Pro", status: "loading", loaded: new Promise<FontFace>((resolve) => { complete = resolve; }) } as FontFace;
    f.faces.push(face); synchronizeTerminalFonts(f.term, fit); complete(face); await Promise.resolve();
    expect(fit).toHaveBeenCalledOnce();
    const event = new Event("loadingdone"); Object.defineProperty(event, "fontfaces", { value: [face] }); f.fonts.dispatchEvent(event);
    expect(fit).toHaveBeenCalledOnce(); f.addons.forEach((addon) => addon.dispose());
  });
});
