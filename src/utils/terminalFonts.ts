import type { ITerminalAddon, Terminal } from "@xterm/xterm";
import { fontStackEntries } from "@/utils/fontStack";

const installed = new WeakMap<Terminal, TerminalFontsAddon>();
const familyName = (name: string) => name.trim().replace(/^(["'])(.*)\1$/, "$2").toLowerCase();
const fontLoads = new WeakMap<FontFaceSet, FontLoads>();

/** One promise observer per face, not per cached/closed terminal. */
class FontLoads {
  private listeners = new Set<(face: FontFace) => void>();
  private observed = new WeakSet<FontFace>();
  constructor(private fonts: FontFaceSet) {
    fonts.addEventListener("loadingdone", (event) => event.fontfaces.forEach(this.notify));
  }
  private notify = (face: FontFace) => { for (const listener of this.listeners) listener(face); };
  subscribe(listener: (face: FontFace) => void): () => void {
    this.listeners.add(listener);
    // WebKit's individual FontFace.load() path need not dispatch loadingdone.
    // All stylesheet faces are registered before terminal creation, including
    // fallback faces first requested much later during a long session.
    this.fonts.forEach((face) => {
      if (this.observed.has(face) || face.status === "loaded") return;
      this.observed.add(face);
      void face.loaded.then(() => this.notify(face), () => {});
    });
    return () => { this.listeners.delete(listener); };
  }
}

function observeFonts(fonts: FontFaceSet): FontLoads {
  let observer = fontLoads.get(fonts);
  if (!observer) { observer = new FontLoads(fonts); fontLoads.set(fonts, observer); }
  return observer;
}

/** Cached terminals retain this addon while their views detach or switch tabs. */
class TerminalFontsAddon implements ITerminalAddon {
  private term: Terminal | null = null;
  private unsubscribe: (() => void) | null = null;
  private handled = new WeakSet<FontFace>();
  constructor(public onMetricsChanged: () => void) {}

  activate(term: Terminal): void {
    this.term = term;
    const fonts = term.element?.ownerDocument.fonts ?? document.fonts;
    this.unsubscribe = observeFonts(fonts).subscribe(this.loaded);
  }

  private loaded = (face: FontFace): void => {
    const term = this.term;
    if (!term || this.handled.has(face)) return;
    const family = term.options.fontFamily ?? "monospace";
    const names = new Set(fontStackEntries(family).map(familyName));
    if (!names.has(familyName(face.family))) return;
    this.handled.add(face);

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
    this.unsubscribe?.();
    if (this.term) installed.delete(this.term);
    this.term = null;
    this.unsubscribe = null;
    this.onMetricsChanged = () => {};
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
