/** Synthetic-only GPU/endurance fixture. Never loads a host, credential or user data. */
import { Terminal } from "@xterm/xterm";
import { claimWebglRenderer } from "@/utils/webglAddon";
import { nextFrame, write, emit, renderer, hash, comparePixels, terminalOptions, createTerminal, captureFrame, nativeViewSnapshot } from "./support";
import "@xterm/xterm/css/xterm.css";
import "@/styles/globals.css";

const parameters = new URLSearchParams(location.search);
const reference = parameters.get("precision") === "highp-reference";
const seconds = Number(parameters.get("seconds") ?? 120);
const nativeSnapshots: Record<string, unknown>[] = [];
// Diagnostic A/B only: production does not intercept shader compilation.
const originalShaderSource = WebGL2RenderingContext.prototype.shaderSource;
const glyphShaders: string[] = [];
WebGL2RenderingContext.prototype.shaderSource = function (shader, source) {
  if (source.includes("u_texture[") && source.includes("precision lowp float;")) {
    glyphShaders.push(reference ? "highp-reference" : "production-lowp");
    if (reference) source = source.replace("precision lowp float;", "precision highp float;");
  } else if (source.includes("u_texture[") && source.includes("precision highp float;")) glyphShaders.push("production-highp");
  originalShaderSource.call(this, shader, source);
};

async function nativeSnapshot(label: string) {
  const result = await nativeViewSnapshot(label, document.getElementById("primary")!);
  if (result) nativeSnapshots.push(result);
}
async function nativeZoom(value: number) {
  if (!(window as any).webkit?.messageHandlers.renderProbe) return;
  await new Promise<void>((resolve) => {
    (window as any).__terminalZoomAck = () => resolve();
    emit({ phase: "zoom", value });
  });
  await nextFrame(); await nextFrame();
}
function atlas(term: Terminal): any { return renderer(term)._charAtlas; }
function pages(term: Terminal) { return atlas(term)?.pages.map((p: any) => ({ width: p.canvas.width, height: p.canvas.height, version: p.version })) ?? []; }

/** Isolate normalized texture coordinates from fonts, terminal cells and atlas cache state. */
function precisionProbe(size: number, precision: "lowp" | "highp") {
  const canvas = document.createElement("canvas"); canvas.width = size; canvas.height = 1;
  const gl = canvas.getContext("webgl2", { antialias: false })!;
  if (!gl) throw Error("WebGL2 unavailable");
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!; gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader) ?? "shader compile"); return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
out highp vec2 uv;
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.0-1.0,0,1);}`);
  const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
precision highp float;
in ${precision} vec2 uv;
uniform highp sampler2D image;
out highp vec4 pixel;
void main(){pixel=texture(image,uv);}`);
  const program = gl.createProgram()!; gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program) ?? "shader link");
  gl.useProgram(program);
  const texture = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const expected = new Uint8Array(size * 4);
  for (let x = 0; x < size; x++) expected.set([x % 251, (x * 17) % 251, (x * 53) % 251, 255], x * 4);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, expected);
  gl.viewport(0, 0, size, 1); gl.drawArrays(gl.TRIANGLES, 0, 3);
  const actual = new Uint8Array(expected.length); gl.readPixels(0, 0, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, actual);
  let mismatch = 0; for (let x = 0; x < size; x++) if (actual[x * 4] !== expected[x * 4] || actual[x * 4 + 1] !== expected[x * 4 + 1] || actual[x * 4 + 2] !== expected[x * 4 + 2]) mismatch++;
  const format = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, precision === "lowp" ? gl.LOW_FLOAT : gl.HIGH_FLOAT)!;
  const result = { size, precision, mismatch_pixels: mismatch, precision_bits: format.precision, range: [format.rangeMin, format.rangeMax], actual_hash: hash(actual), expected_hash: hash(expected), gl_error: gl.getError() };
  gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment); gl.deleteTexture(texture); gl.getExtension("WEBGL_lose_context")?.loseContext();
  return result;
}

const sentinel = [
  "Synthetic terminal rendering / 合成终端测试",
  "Counter 000000 / 0123456789 / -12.50 +99.75%",
  "中文宽字符 English 0123456789 () [] {} <> +-*/=",
  "┌──────────────┬───────────┬──────────────┐",
  "│ row-001      │ 12345.67  │ 中文合成     │",
  "│ row-002      │ -9876.50  │ Alpha beta   │",
  "└──────────────┴───────────┴──────────────┘",
  "Symbols → ← ↑ ↓ ± × ÷ ≤ ≥ ■ □ ╱ ╲ ┃ ╋",
  "Combining e\u0301 a\u0308 / \x1b[1mBold 012中文\x1b[0m / \x1b[3mItalic 345字形\x1b[0m",
  "Zellij-like redraw: synthetic panes, status and counters",
];
const frame = "\x1b[?25l\x1b[0m\x1b[2J\x1b[H" + sentinel.join("\r\n");

async function run() {
  const started = performance.now();
  const micro = [512, 1024, 2048, 4096].flatMap((size) => (["lowp", "highp"] as const).map((p) => precisionProbe(size, p)));
  emit({ phase: "precision", reference, device_pixel_ratio: devicePixelRatio, user_agent: navigator.userAgent, micro });
  await document.fonts.load('14px "Source Code Pro"'); await document.fonts.ready;
  const options = terminalOptions();
  const host = document.getElementById("primary")!, secondHost = document.getElementById("secondary")!;
  host.style.cssText = "position:absolute;left:8px;top:8px;width:800px;height:620px";
  secondHost.style.cssText = "position:absolute;left:820px;top:8px;width:330px;height:300px";
  const primary = createTerminal(host), secondary = createTerminal(secondHost, { cols: 32, rows: 8 });
  let gl: WebGL2RenderingContext;
  function bindRenderer() {
    const r = renderer(primary); gl = r._gl;
    if (!gl) throw Error("Production WebGL renderer was not acquired");
  }
  bindRenderer();
  async function captureWrite(text: string): Promise<Uint8Array> {
    return await captureFrame(primary, () => write(primary, text));
  }
  await write(primary, frame); await write(secondary, "\x1b[?25lSynthetic atlas trainer"); await nextFrame(); await nextFrame();
  if (atlas(primary) !== atlas(secondary)) throw Error("Trainer must share production texture atlas");
  const initial = await captureWrite(frame);
  if (!initial.some((x, i) => i % 4 !== 3 && x > 100)) throw Error("Empty baseline frame");
  const checks: Record<string, unknown>[] = []; let maxAtlas = 0, additions = 0, removals = 0, bytes = 0, iterations = 0;
  atlas(primary).onAddTextureAtlasCanvas((canvas: HTMLCanvasElement) => { additions++; maxAtlas = Math.max(maxAtlas, canvas.width); });
  atlas(primary).onRemoveTextureAtlasCanvas(() => { removals++; });
  function compare(label: string, pixels: Uint8Array) {
    const result = { label, ...comparePixels(initial, pixels), pages: pages(primary), gl_error: gl.getError() };
    checks.push(result); emit({ phase: "pixel-check", reference, ...result });
  }
  compare("stable-baseline", await captureWrite(frame));
  await nativeSnapshot("baseline"); await nativeSnapshot("stable-baseline");
  let combinations = 0;
  for (let base = 0; base < 512000; base += 96) {
    const color = Math.floor(base / 8000), chars = Array.from({ length: 96 }, (_, j) => String.fromCodePoint(0x4e00 + ((base + j) % 8000))).join("");
    const data = `\x1b[2J\x1b[H\x1b[38;2;${160 + color % 80};${200 + Math.floor(color / 80)};230m${chars}`;
    bytes += new TextEncoder().encode(data).byteLength; await write(secondary, data); await nextFrame();
    combinations = base + 96;
    if (base % 9600 === 0) { emit({ phase: "atlas-growth", reference, glyph_combinations: combinations, pages: pages(primary), additions, removals }); }
    if (pages(primary).some((p: { width: number }) => p.width >= 4096)) break;
  }
  compare("after-atlas-growth-incremental", await captureWrite("\x1b[2;9H000000"));
  await nativeSnapshot("after-atlas-growth");
  const soakStart = performance.now();
  while (performance.now() - soakStart < seconds * 1000) {
    const value = String(iterations % 1000000).padStart(6, "0");
    await write(primary, "\x1b[2;9H" + value);
    if (iterations % 10 === 0) { await write(secondary, `\r\nSynthetic ${iterations} 中文 0123456789 → ± │`); secondary.scrollLines(-2); secondary.scrollToBottom(); }
    if (iterations % 100 === 0) {
      const parent = primary.element!.parentElement!; primary.element!.remove(); parent.appendChild(primary.element!); claimWebglRenderer(primary);
      await write(primary, "\x1b[6;3H\x1b[7m合成ab\x1b[0m\x1b[6;3H123456\x1b[6;1H\x1b[2K" + sentinel[5]);
      compare("soak-" + iterations, await captureWrite("\x1b[2;9H000000"));
    }
    iterations++; await nextFrame();
  }
  compare("after-soak-incremental", await captureWrite("\x1b[2;9H000000"));
  await nativeSnapshot("after-soak");
  compare("after-explicit-full-refresh", await captureFrame(primary, () => primary.refresh(0, primary.rows - 1)));
  const buffer = Array.from({ length: primary.rows }, (_, i) => primary.buffer.active.getLine(i)?.translateToString(true) ?? "");
  for (const fontSize of [16, 18, 12, 14]) { primary.options.fontSize = fontSize; await nextFrame(); await nextFrame(); }
  await write(primary, frame); await nextFrame(); compare("after-font-resize-return", await captureWrite(frame));
  primary.resize(90, 22); await nextFrame(); primary.resize(80, 20); await nextFrame();
  compare("after-grid-resize-return", await captureWrite(frame));
  await nativeZoom(1.25); await nativeZoom(1.5); await nativeZoom(1);
  compare("after-native-page-zoom-return", await captureWrite(frame)); await nativeSnapshot("after-zoom");
  const pooled: Terminal[] = [], elements: HTMLElement[] = [];
  for (let i = 0; i < 16; i++) {
    const element = document.createElement("div"); element.style.cssText = `position:absolute;left:850px;top:${340 + i * 20}px;width:60px;height:30px`;
    document.body.appendChild(element); elements.push(element);
    const term = createTerminal(element, { ...options, cols: 4, rows: 2, fontSize: 12 + i / 10 });
    pooled.push(term); await write(term, "中A"); await nextFrame();
  }
  claimWebglRenderer(primary); bindRenderer(); await nextFrame(); await nextFrame();
  compare("after-context-pool-eviction-return", await captureWrite(frame));
  pooled.forEach((term) => term.dispose()); elements.forEach((element) => element.remove());
  await nativeSnapshot("after-context-pool-recovery");
  const debug = gl!.getExtension("WEBGL_debug_renderer_info");
  const result = { phase: "complete", reference, mode: reference ? "fixture-highp-reference" : "production", elapsed_seconds: (performance.now() - started) / 1000,
    soak_seconds: (performance.now() - soakStart) / 1000, iterations, glyph_combinations: combinations, synthetic_bytes_written: bytes, additions, removals, max_atlas_size: maxAtlas,
    glyph_shaders: glyphShaders, webgl_vendor: gl!.getParameter(gl!.VENDOR), webgl_renderer: gl!.getParameter(gl!.RENDERER),
    unmasked_renderer: debug ? gl!.getParameter(debug.UNMASKED_RENDERER_WEBGL) : "unavailable",
    dimensions: [gl!.drawingBufferWidth, gl!.drawingBufferHeight], buffer, checks, native_snapshots: nativeSnapshots, precision: micro,
    failed_checks: checks.filter((x) => x.different_pixels !== 0 || !x.same_dimensions).length + nativeSnapshots.filter((x) => x.valid !== true || x.different_pixels !== 0).length,
    scope: "Actual production xterm/WebGL/font stack in this engine; synthetic data only. No SSH, user host, server change or private screenshot." };
  (window as any).__terminalRenderResult = result; emit(result);
}
run().catch((error) => { const result = { phase: "error", message: String(error), stack: error?.stack }; (window as any).__terminalRenderResult = result; emit(result); });
