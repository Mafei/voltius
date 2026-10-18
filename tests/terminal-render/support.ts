import { Terminal } from "@xterm/xterm";
import { claimWebglRenderer } from "@/utils/webglAddon";
import { terminalFontOptions } from "@/utils/fontStack";
import { synchronizeTerminalFonts } from "@/utils/terminalFonts";

export const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
export const write = (term: Terminal, text: string | Uint8Array) => new Promise<void>((resolve) => term.write(text, resolve));
export function waitForContextEvent(canvas: HTMLCanvasElement, name: string) {
  return new Promise<void>((resolve, reject) => {
    const listener = () => { clearTimeout(timeout); resolve(); };
    const timeout = setTimeout(() => { canvas.removeEventListener(name, listener); reject(Error(name + " timed out")); }, 10000);
    canvas.addEventListener(name, listener, { once: true });
  });
}
export function emit(value: Record<string, unknown>) {
  console.log(JSON.stringify(value));
  (window as any).webkit?.messageHandlers.renderProbe.postMessage(value);
}
export async function nativeViewSnapshot(label: string, element: HTMLElement, save = false) {
  if (!(window as any).webkit?.messageHandlers.renderProbe) return null;
  return await new Promise<Record<string, unknown>>((resolve) => {
    (window as any).__terminalSnapshotAck = resolve;
    const r = element.getBoundingClientRect();
    emit({ phase: "snapshot", label, save, rect: { x: r.x, y: r.y, width: r.width, height: r.height } });
  });
}
export function renderer(term: Terminal): any { return (term as any)._core._renderService._renderer.value; }
export function hash(bytes: Uint8Array) { let h = 2166136261; for (const b of bytes) h = Math.imul(h ^ b, 16777619); return (h >>> 0).toString(16).padStart(8, "0"); }
export function comparePixels(baseline: Uint8Array, actual: Uint8Array, width = 0) {
  let different = Math.max(baseline.length, actual.length) / 4;
  let maximumChannelDelta = 0; const coordinates: number[][] = [];
  if (baseline.length === actual.length) {
    different = 0;
    for (let i = 0; i < baseline.length; i += 4) if (baseline[i] !== actual[i] || baseline[i + 1] !== actual[i + 1] || baseline[i + 2] !== actual[i + 2]) {
      different++;
      maximumChannelDelta = Math.max(maximumChannelDelta, ...[0, 1, 2].map((channel) => Math.abs(baseline[i + channel] - actual[i + channel])));
      if (width && coordinates.length < 8) coordinates.push([i / 4 % width, Math.floor(i / 4 / width)]);
    }
  }
  return { different_pixels: different, maximum_channel_delta: maximumChannelDelta, first_differing_device_pixels_bottom_origin: coordinates,
    same_dimensions: baseline.length === actual.length, baseline_hash: hash(baseline), current_hash: hash(actual) };
}
type FixtureOptions = NonNullable<ConstructorParameters<typeof Terminal>[0]>;
export function terminalOptions(overrides: FixtureOptions = {}): FixtureOptions {
  return { allowProposedApi: true, cols: 80, rows: 20, cursorBlink: false, fontSize: 14, lineHeight: 1,
    ...terminalFontOptions("'Source Code Pro', monospace"), scrollback: 5000,
    theme: { background: "#111827", foreground: "#e5e7eb", cursor: "#ffffff" }, ...overrides };
}
export function createTerminal(host: HTMLElement, overrides: FixtureOptions = {}, attachRenderer = claimWebglRenderer) {
  const term = new Terminal(terminalOptions(overrides)); term.open(host); attachRenderer(term); synchronizeTerminalFonts(term, () => {}); return term;
}
/** Read the actual default framebuffer in the rendering call stack, before compositor clearing. */
export async function captureFrame(term: Terminal, trigger: () => void | Promise<void>): Promise<Uint8Array> {
  const r = renderer(term), gl: WebGL2RenderingContext = r._gl;
  if (!gl) throw Error("Production WebGL renderer was not acquired");
  // Wait for xterm's parser acknowledgement before arming the next-frame read.
  // Otherwise an already queued paint can still contain the previous counter.
  await trigger();
  return await new Promise<Uint8Array>((resolve, reject) => {
    const original = r.renderRows;
    const timeout = setTimeout(() => { r.renderRows = original; reject(Error("render capture timed out")); }, 10000);
    r.renderRows = (first: number, last: number) => {
      try {
        original.call(r, first, last); r.renderRows = original; clearTimeout(timeout);
        const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels); resolve(pixels);
      } catch (error) { r.renderRows = original; clearTimeout(timeout); reject(error); }
    };
  });
}
