import { FitAddon } from "@xterm/addon-fit";
import { createTerminal, renderer, write, nextFrame } from "./support";
import { terminalFontStack } from "@/utils/fontStack";
import { createOutputDecoder } from "@/utils/terminalEncoding";
import "@xterm/xterm/css/xterm.css";
import "@/styles/globals.css";

const WIDTH = 720, HEIGHT = 320;
const family = terminalFontStack("'Source Code Pro', 'Noto Sans CJK SC', monospace");
const setSize = (holder: HTMLElement, width = WIDTH, height = HEIGHT) => Object.assign(holder.style, { width: `${width}px`, height: `${height}px` });
const holders = ["primary", "reference"].map(id => document.getElementById(id)!);
for (const holder of holders) { Object.assign(holder.style, { position: "absolute", left: "16px", top: "48px" }); setSize(holder); }
holders[1].style.visibility = "hidden";
holders[1].style.top = "400px";
const frame = async () => { await nextFrame(); await nextFrame(); };
let referenceNumber = 0;
let primary: Awaited<ReturnType<typeof make>> | null = null;
const decoder = createOutputDecoder(undefined);
let chunks = 0, updates = 0;

async function make(holder: HTMLElement, ref = false) {
  holder.replaceChildren();
  setSize(holder);
  const term = createTerminal(holder, { fontFamily: family + (ref ? " ".repeat(++referenceNumber) : ""), fontSize: 14 });
  const fit = new FitAddon(); term.loadAddon(fit); fit.fit();
  const r = renderer(term), gl: WebGL2RenderingContext = r._gl;
  if (!gl) throw Error("Production WebGL renderer unavailable");
  let renders = 0;
  const original = r.renderRows;
  r.renderRows = (...args: number[]) => { renders++; return original.apply(r, args); };
  const lines = () => Array.from({ length: term.rows }, (_, i) => term.buffer.active.getLine(term.buffer.active.viewportY + i)?.translateToString(true) ?? "");
  const repaint = async (text: string[]) => { await write(term, "\x1b[?25l" + text.map((line, i) => `\x1b[${i + 1};1H\x1b[2K${line}`).join("")); await frame(); };
  const state = () => ({ cols: term.cols, rows: term.rows, dpr: devicePixelRatio, renders,
    css: { width: holder.getBoundingClientRect().width, height: holder.getBoundingClientRect().height },
    canvas: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
    atlas_pages: r._charAtlas?.pages.map((p: { canvas: HTMLCanvasElement; version: number }) => ({ width: p.canvas.width, height: p.canvas.height, version: p.version })),
    gl_error: gl.getError(), context_lost: gl.isContextLost(), lines: lines() });
  return { term, fit, r, gl, holder, lines, repaint, state, dispose: () => { term.dispose(); holder.replaceChildren(); } };
}

async function init() {
  primary?.dispose(); holders[0].style.visibility = "visible"; holders[1].style.visibility = "hidden";
  primary = await make(holders[0]);
  await primary.repaint(["Fixed window / no remote shell", "counter=0", "ASCII gjpqy é é / ①②③④⑤⑩⑳⓪Ⓐ / 中文", "┌──────────────┐", "│ synthetic    │", "└──────────────┘"]);
  await document.fonts.ready; primary.fit.fit(); await frame();
  await new Promise(resolve => setTimeout(resolve, 150));
  await write(primary.term, `\x1b[3;${primary.term.rows}r`);
  chunks = 0; updates = 0;
  return primary.state();
}

async function tick() {
  if (!primary) throw Error("not initialized");
  const n = ++updates;
  const text = `#${String(n).padStart(8, "0")} ①②③④⑤ 中文 ${String.fromCharCode(0x4e00 + n % 1024)}`;
  const append = n % 8 === 0;
  const payload = `\x1b[2;1H\x1b[2Kcounter=${n}` + (append ? `\x1b[${primary.term.rows};1H\r\n${text}` : `\x1b[5;1H\x1b[2K${text}`);
  const bytes = new TextEncoder().encode(payload), cut = bytes.findIndex(byte => byte >= 0xc2) + 1;
  for (const part of [bytes.subarray(0, cut), bytes.subarray(cut)]) { await write(primary.term, decoder.decode(part)); chunks++; }
  const line = primary.term.buffer.active.getLine(primary.term.buffer.active.viewportY + (append ? primary.term.rows - 1 : 4))?.translateToString(true);
  if (line !== text) throw Error("Production UTF-8/buffer content mismatch");
  return { updates, wire_chunks: chunks };
}

async function reference(input?: string[]) {
  if (!primary) throw Error("not initialized");
  const data = input ?? primary.lines();
  const ref = await make(holders[1], true);
  if (ref.r._charAtlas === primary.r._charAtlas) { ref.dispose(); throw Error("Reference must have an independent CPU glyph atlas"); }
  await ref.repaint(data);
  holders[1].style.visibility = "visible";
  await frame();
  return { state: ref.state(), release: () => { ref.dispose(); holders[1].style.visibility = "hidden"; } };
}
let activeReference: Awaited<ReturnType<typeof reference>> | null = null;
let saved: string[] = [];

async function resetCase() {
  const data = saved.length ? saved : primary?.lines() ?? [];
  await init(); await primary!.repaint(data);
  await new Promise(resolve => setTimeout(resolve, 120));
  return primary!.state();
}

async function fault(kind: string) {
  if (!primary) throw Error("not initialized");
  const { gl, r, term } = primary;
  if (kind === "framebuffer") {
    const color = gl.getParameter(gl.COLOR_CLEAR_VALUE), mask = gl.getParameter(gl.COLOR_WRITEMASK);
    const scissor = gl.isEnabled(gl.SCISSOR_TEST), bound = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true);
    gl.clearColor(1, 0, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.clearColor(color[0], color[1], color[2], color[3]); gl.colorMask(mask[0], mask[1], mask[2], mask[3]);
    if (scissor) gl.enable(gl.SCISSOR_TEST); gl.bindFramebuffer(gl.FRAMEBUFFER, bound);
  } else if (kind === "gpu-atlas") {
    const textures = r._glyphRenderer?.value?._atlasTextures;
    const pages = r._charAtlas?.pages;
    if (!textures?.length || !pages?.length) throw Error("Pinned addon texture/page internals unavailable");
    const active = gl.getParameter(gl.ACTIVE_TEXTURE); gl.activeTexture(gl.TEXTURE0);
    const bound = gl.getParameter(gl.TEXTURE_BINDING_2D);
    for (let i = 0; i < pages.length; i++) {
      if (!textures[i]?.texture) throw Error("Missing atlas texture");
      const { width, height } = pages[i].canvas;
      gl.bindTexture(gl.TEXTURE_2D, textures[i].texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(width * height * 4));
    }
    gl.bindTexture(gl.TEXTURE_2D, bound); gl.activeTexture(active);
    term.refresh(0, term.rows - 1);
  } else throw Error("unknown fault");
  if (gl.getError() !== gl.NO_ERROR) throw Error("Fault injection caused a GL API error");
  await frame();
  return primary.state();
}

async function action(name: string) {
  if (!primary) throw Error("not initialized");
  const { term, fit, holder } = primary;
  const before = primary.state(); let peak = before;
  if (name === "refresh") term.refresh(0, term.rows - 1);
  else if (name === "atlas-rebuild") { term.clearTextureAtlas(); term.refresh(0, term.rows - 1); }
  else if (name === "fit-unchanged") fit.fit();
  else if (name === "fit-resize") {
    setSize(holder, WIDTH + 40, HEIGHT + 32); fit.fit(); await frame(); peak = primary.state();
    setSize(holder); fit.fit();
  } else if (name === "vt-repaint") await primary.repaint(saved);
  else if (name !== "none") throw Error("unknown action");
  await frame();
  return { before, peak, after: primary.state() };
}

Object.assign(window, { __resizeRecovery: { init, tick, state: () => primary!.state(),
  save: () => { saved = primary!.lines(); return saved; }, resetCase, fault, action,
  reference: async (data?: string[]) => { activeReference = await reference(data); return activeReference.state; },
  releaseReference: () => { activeReference?.release(); activeReference = null; },
  environment: () => ({ user_agent: navigator.userAgent, platform: navigator.platform, dpr: devicePixelRatio,
    preserve_drawing_buffer: primary!.gl.getContextAttributes()?.preserveDrawingBuffer,
    source_scope: "Production a56 shared font/renderer/UTF-8 helpers, normally sandboxed Linux Chromium. Not native macOS/WebKit or a user-case reproduction." }),
} });
