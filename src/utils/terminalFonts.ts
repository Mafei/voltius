import type { ITerminalAddon, Terminal } from "@xterm/xterm";
import { fontStackEntries } from "@/utils/fontStack";

const installed = new WeakMap<Terminal, TerminalFontsAddon>();
const familyName = (name: string) => name.trim().replace(/^(["'])(.*)\1$/, "$2").toLowerCase();

/** Cached terminals retain this addon while their views detach or switch tabs. */
class TerminalFontsAddon implements ITerminalAddon {
  private term: Terminal | null = null;
  private fonts: FontFaceSet | null = null;
  constructor(public onMetricsChanged: () => void) {}

  activate(term: Terminal): void {
    this.term = term;
    this.fonts = term.element?.ownerDocument.fonts ?? document.fonts;
    this.fonts.addEventListener("loadingdone", this.loaded);
  }

  private loaded = (event: FontFaceSetLoadEvent): void => {
    const term = this.term;
    if (!term) return;
    const family = term.options.fontFamily ?? "monospace";
    const names = new Set(fontStackEntries(family).map(familyName));
    if (!event.fontfaces.some((face) => names.has(familyName(face.family)))) return;

    // xterm 6 does not remeasure on FontFaceSet events. Refresh/atlas clearing
    // alone retains the old cell metrics. A CSS-equivalent whitespace change
    // invokes its public font-option invalidation, then restores the exact
    // setting synchronously, before any paint or PTY fit can observe it.
    term.options.fontFamily = `${family} `;
    term.options.fontFamily = family;
    term.clearTextureAtlas();
    this.onMetricsChanged();
    term.refresh(0, term.rows - 1);
  };

  dispose(): void {
    this.fonts?.removeEventListener("loadingdone", this.loaded);
    if (this.term) installed.delete(this.term);
    this.term = null;
    this.fonts = null;
  }
}

/** Install once per terminal, with disposal owned by xterm's addon manager. */
export function synchronizeTerminalFonts(term: Terminal, onMetricsChanged: () => void): void {
  if (!term.element?.ownerDocument.fonts) return;
  const current = installed.get(term);
  if (current) { current.onMetricsChanged = onMetricsChanged; return; }
  const addon = new TerminalFontsAddon(onMetricsChanged);
  term.loadAddon(addon);
  installed.set(term, addon);
}
