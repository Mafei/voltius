import type { Terminal } from "@xterm/xterm";

/** Touch positions and cell heights are CSS pixels. DPR belongs only to the
 * renderer's backing store; multiplying a finger delta by DPR changes distance. */
export function pixelPosition(position: number, delta: number, cellHeight: number, baseY: number) {
  const value = Math.max(0, Math.min(baseY * cellHeight, position + delta));
  const line = Math.floor(value / cellHeight);
  return { value, line, fraction: value - line * cellHeight };
}

interface Renderer {
  renderRows(start: number, end: number): void;
  _canvas?: HTMLCanvasElement;
  _gl?: WebGL2RenderingContext;
  _rowContainer?: HTMLElement;
  _rowElements?: HTMLElement[];
}
interface Core {
  _bufferService: { buffer: { ydisp: number } };
  _renderService: { _renderer: { value: Renderer } };
  _viewport?: { scrollToLine(line: number, disableSmoothScroll: boolean): void };
}

/** Pinned xterm6/WebGL0.19 boundary. Public scrollToLine rounds to rows. Keep
 * its real viewport at floor(pixel/cell), translate by the CSS remainder and
 * supply the newly exposed bottom row using the SAME renderer and attributes.
 * A synchronous paint-only neighbour view never emits scroll/resize/input or
 * changes PTY rows. Restore ydisp in finally and repaint the real viewport.
 * Unknown renderers fail closed to row scrolling rather than show a blank edge. */
class PixelViewport {
  fraction = 0;
  private ownScroll = false;
  private screen: HTMLElement;
  private guard: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private renderer?: Renderer;
  private original?: Renderer["renderRows"];
  private wrapped?: Renderer["renderRows"];
  private expectedY: number;
  private disposables;
  constructor(private term: Terminal) {
    this.expectedY = term.buffer.active.viewportY;
    this.screen = term.element!.querySelector<HTMLElement>(".xterm-screen")!;
    this.guard = document.createElement("div");
    this.guard.dataset.touchScrollGuard = "";
    Object.assign(this.guard.style, { position: "absolute", top: "100%", left: "0", width: "100%", pointerEvents: "none", display: "none", overflow: "hidden" });
    this.guard.setAttribute("aria-hidden", "true");
    this.canvas = document.createElement("canvas");
    this.screen.appendChild(this.guard);
    this.disposables = [term.onScroll(y => { if (!this.ownScroll && y !== this.expectedY) this.clear(); }), term.onResize(() => this.clear()),
      term.buffer.onBufferChange(() => this.clear()), term.onWriteParsed(() => { if (term.modes.mouseTrackingMode !== "none") this.clear(); })];
  }
  private core() { return this.term as unknown as { _core: Core }; }
  private height() { return this.screen.clientHeight / this.term.rows; }
  private clear() {
    this.expectedY = this.term.buffer.active.viewportY;
    this.fraction = 0;
    this.screen.style.transform = "";
    this.guard.style.display = "none";
  }
  private paintGuard(r: Renderer, paint: Renderer["renderRows"]) {
    const buffer = this.core()._core._bufferService.buffer;
    const y = buffer.ydisp;
    if (y >= this.term.buffer.active.baseY) return;
    try {
      buffer.ydisp = y + 1;
      paint.call(r, 0, this.term.rows - 1);
      if (r._gl && r._canvas && !r._gl.isContextLost()) {
        const source = r._canvas, h = source.height / this.term.rows;
        this.canvas.width = source.width;
        this.canvas.height = Math.ceil(h);
        Object.assign(this.canvas.style, { width: "100%", height: `${this.height()}px`, display: "block" });
        this.canvas.getContext("2d")!.drawImage(source, 0, source.height - h, source.width, h, 0, 0, source.width, this.canvas.height);
        if (this.guard.firstChild !== this.canvas) this.guard.replaceChildren(this.canvas);
      } else if (r._rowContainer && r._rowElements) {
        const row = r._rowElements[this.term.rows - 1];
        const container = r._rowContainer.cloneNode(false) as HTMLElement;
        container.appendChild(row.cloneNode(true));
        this.guard.replaceChildren(container);
      }
    } finally { buffer.ydisp = y; }
  }
  private attachRenderer(): boolean {
    const r = this.core()._core?._renderService?._renderer?.value;
    if (!r?.renderRows || !(r._gl && r._canvas && !r._gl.isContextLost() || r._rowContainer && r._rowElements)) return false;
    if (r === this.renderer) return true;
    this.detachRenderer();
    const original = r.renderRows, self = this;
    const wrapped = function(this: Renderer, start: number, end: number) {
      if (!self.fraction || self.term.buffer.active.type !== "normal") return original.call(this, start, end);
      try { self.paintGuard(this, original); }
      finally { original.call(this, 0, self.term.rows - 1); }
    };
    this.renderer = r; this.original = original; this.wrapped = wrapped;
    r.renderRows = wrapped;
    return true;
  }
  private detachRenderer() {
    if (this.renderer && this.renderer.renderRows === this.wrapped) this.renderer.renderRows = this.original!;
    this.renderer = undefined;
  }
  set(line: number, fraction: number) {
    const height = this.height();
    if (!(height > 0) || this.term.buffer.active.type !== "normal") { this.clear(); return; }
    const next = pixelPosition(line * height, fraction, height, this.term.buffer.active.baseY);
    if (!this.attachRenderer()) { this.clear(); this.term.scrollToLine(Math.round(next.value / height)); return; }
    this.ownScroll = true;
    this.expectedY = next.line;
    try {
      const nativeViewport = this.core()._core._viewport;
      if (nativeViewport) nativeViewport.scrollToLine(next.line, true);
      else this.term.scrollToLine(next.line);
    } finally { this.ownScroll = false; }
    const firstFraction = !this.fraction && next.fraction > 0;
    this.fraction = next.fraction;
    this.screen.style.transform = this.fraction ? `translateY(${-this.fraction}px)` : "";
    this.guard.style.display = this.fraction ? "block" : "none";
    this.guard.style.height = `${height}px`;
    if (firstFraction) this.term.refresh(0, this.term.rows - 1);
  }
  move(delta: number) { this.set(this.term.buffer.active.viewportY, this.fraction + delta); }
  reset() { this.clear(); }
  dispose() { this.clear(); this.detachRenderer(); this.disposables.forEach(d => d.dispose()); this.guard.remove(); }
}

const viewports = new WeakMap<Terminal, PixelViewport>();
const viewport = (term: Terminal) => {
  let v = viewports.get(term);
  if (!v) { v = new PixelViewport(term); viewports.set(term, v); }
  return v;
};
export const touchPixelOffset = (term: Terminal) => viewports.get(term)?.fraction ?? 0;
export const scrollTerminalPixels = (term: Terminal, delta: number) => viewport(term).move(delta);
export const setTerminalPixelPosition = (term: Terminal, line: number, fraction: number) => viewport(term).set(line, fraction);
export const resetTerminalPixels = (term: Terminal) => viewports.get(term)?.reset();
export function disposeTerminalPixels(term: Terminal) { viewports.get(term)?.dispose(); viewports.delete(term); }
