import { WebglAddon } from "@xterm/addon-webgl";
import { claimWebglRenderer } from "@/utils/webglAddon";
import { createTerminal, write, nextFrame, renderer, captureFrame, comparePixels, emit } from "./support";
import "@xterm/xterm/css/xterm.css";
import "@/styles/globals.css";

/** Instrument only this synthetic page. Attribute every GL error to the call
 * that produced it; consumed errors remain explicit failures in the result. */
function traceGl() {
  const getError = WebGL2RenderingContext.prototype.getError;
  const restoredDescriptors: { prototype: object; name: string; descriptor: PropertyDescriptor }[] = [];
  const resources = new WeakMap<object, number>();
  const errors: Record<string, unknown>[] = [];
  let target: WebGL2RenderingContext | undefined, generation = 0, stage = "initial";
  const describe = (value: any) => value && typeof value === "object"
    ? { type: value.constructor?.name, generation: resources.get(value) ?? 0 }
    : typeof value === "string" ? { type: "string", length: value.length } : value;
  const drain = (operation: string, args: unknown[] = []) => {
    if (!target) return;
    for (let i = 0; i < 8; i++) {
      const error = getError.call(target); if (!error) break;
      errors.push({ stage, operation, error, context_lost: target.isContextLost(), args: args.map(describe) });
    }
  };
  for (let prototype: any = WebGL2RenderingContext.prototype; prototype && prototype !== Object.prototype; prototype = Object.getPrototypeOf(prototype)) {
    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (["constructor", "getError", "isContextLost"].includes(name)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name)!;
      if (typeof descriptor.value !== "function") continue;
      const original = descriptor.value;
      Object.defineProperty(prototype, name, { ...descriptor, value: function (this: WebGL2RenderingContext, ...args: unknown[]) {
        const result = original.apply(this, args);
        if (this === target) {
          if (name.startsWith("create") && result && typeof result === "object") resources.set(result, generation);
          drain(name, args);
        }
        return result;
      } });
      restoredDescriptors.push({ prototype, name, descriptor });
    }
  }
  return {
    errors, target: (value: WebGL2RenderingContext) => { target = value; },
    stage: (value: string) => { stage = value; },
    beforeRestore: () => { generation++; stage = "before-xterm-restoration"; drain("native-restored-event-before-xterm"); },
    drain,
    dispose: () => restoredDescriptors.reverse().forEach(({ prototype, name, descriptor }) => Object.defineProperty(prototype, name, descriptor)),
  };
}
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function contextEvent(canvas: HTMLCanvasElement, name: string) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error(name + " timed out")), 10000);
    canvas.addEventListener(name, () => { clearTimeout(timeout); resolve(); }, { once: true });
  });
}
async function run() {
  await document.fonts.load('14px "Source Code Pro"'); await document.fonts.ready;
  const results: Record<string, any>[] = [];
  for (const production of [false, true]) for (const rescale of [false, true]) {
    const trace = traceGl(), host = document.getElementById("primary")!;
    const term = createTerminal(host, { cols: 60, rows: 8, rescaleOverlappingGlyphs: rescale },
      production ? claimWebglRenderer : (value) => value.loadAddon(new WebglAddon(false)));
    const r = renderer(term), gl = r._gl as WebGL2RenderingContext, canvas = r._canvas as HTMLCanvasElement;
    trace.target(gl); trace.drain("initial-state");
    const text = "\x1b[?25l\x1b[2J\x1b[HSynthetic restore / 中文\r\n①②③④⑤ ABC 中\r\n0123456789";
    const before = await captureFrame(term, () => write(term, text));
    trace.stage("before-loss"); trace.drain("before-loss");
    canvas.addEventListener("webglcontextrestored", trace.beforeRestore, { capture: true, once: true });
    const loss = gl.getExtension("WEBGL_lose_context")!;
    const lost = contextEvent(canvas, "webglcontextlost");
    trace.stage("lose-request"); loss.loseContext(); trace.drain("loseContext"); await lost;
    await delay(500);
    const restored = contextEvent(canvas, "webglcontextrestored");
    trace.stage("restore-request"); loss.restoreContext(); trace.drain("restoreContext"); await restored;
    trace.stage("after-restored-event"); await nextFrame(); await nextFrame();
    const after = await captureFrame(term, () => write(term, text)); trace.drain("after-redraw");
    const pixels = comparePixels(before, after, gl.drawingBufferWidth);
    trace.stage("dispose"); term.dispose(); trace.drain("after-dispose");
    trace.dispose(); host.replaceChildren();
    const unexpected = trace.errors.filter((error) => error.error !== 0x9242);
    const result = { production, rescale, ...pixels, errors: trace.errors, unexpected_errors: unexpected.length };
    results.push(result); emit({ phase: "context-case", ...result });
  }
  emit({ phase: "complete", case: "attributed-webgl-context-restoration", results,
    stock_control_error_cases: results.filter((r) => !r.production && r.unexpected_errors > 0).length,
    failed_checks: results.filter((r) => r.production && (r.unexpected_errors > 0 || r.different_pixels > 0)).length,
    scope: "Own synthetic WKWebView contexts, stock addon versus production pool. Error tracing consumes errors only to attribute them; every non-context-lost error remains an explicit failure." });
}
run().catch((error) => emit({ phase: "error", message: String(error), stack: error?.stack }));
