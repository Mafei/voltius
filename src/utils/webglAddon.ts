import type { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";

const USER_AGENT = typeof navigator !== "undefined" ? navigator.userAgent : "";
const ANDROID = /Android/i.test(USER_AGENT);
// WebKitGTK presents a WebGL canvas one draw behind unless the buffer is preserved,
// so terminal echo only appears on the next redraw (cursor blink, ~600 ms). #224
const PRESERVE_DRAWING_BUFFER = /Linux/.test(USER_AGENT) && !ANDROID;

// Engines kill the oldest WebGL context past 16 per page (8 on Android), leaving a dead canvas.
const MAX_WEBGL_TERMINALS = ANDROID ? 8 : 14;

const pool = new Map<Terminal, PooledWebglAddon>();

// Guarded xterm addon-webgl 0.19 internals, also used to release the context.
interface RendererInternals {
  _gl?: WebGL2RenderingContext;
  _canvas?: HTMLCanvasElement;
  _glyphRenderer?: { value?: { _atlasTextures?: { texture: WebGLTexture }[] } };
}

class PooledWebglAddon extends WebglAddon {
  readonly term: Terminal;
  private samplingCanvas: HTMLCanvasElement | undefined;

  constructor(term: Terminal) {
    super(PRESERVE_DRAWING_BUFFER);
    this.term = term;
  }

  private renderer(): RendererInternals | undefined {
    return (this as unknown as { _renderer?: RendererInternals })._renderer;
  }

  /** Mipmaps mix adjacent atlas glyphs when a wide fallback symbol is shrunk
   * into one cell. Linear base-level sampling is stable across atlas packing
   * and replacement; normal-size glyph magnification remains unchanged. */
  private configureGlyphSampling = (): void => {
    const renderer = this.renderer(), gl = renderer?._gl;
    const textures = renderer?._glyphRenderer?.value?._atlasTextures;
    if (!this.term.options.rescaleOverlappingGlyphs || !gl || gl.isContextLost() || !textures) return;
    const active = gl.getParameter(gl.ACTIVE_TEXTURE);
    for (let i = 0; i < textures.length; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      const bound = gl.getParameter(gl.TEXTURE_BINDING_2D);
      gl.bindTexture(gl.TEXTURE_2D, textures[i].texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.bindTexture(gl.TEXTURE_2D, bound);
    }
    gl.activeTexture(active);
  };

  override activate(terminal: Terminal): void {
    super.activate(terminal);
    this.configureGlyphSampling();
    this.samplingCanvas = this.renderer()?._canvas;
    this.samplingCanvas?.addEventListener("webglcontextrestored", this.configureGlyphSampling);
  }

  override dispose(): void {
    if (pool.get(this.term) === this) pool.delete(this.term);
    this.samplingCanvas?.removeEventListener("webglcontextrestored", this.configureGlyphSampling);
    this.samplingCanvas = undefined;
    // The addon never releases its context, and a disposed one still counts against the cap until GC.
    const gl = this.renderer()?._gl;
    super.dispose();
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

/** Render `term` with WebGL, evicting the least recently claimed terminal back to the DOM renderer. */
export function claimWebglRenderer(term: Terminal): void {
  const held = pool.get(term);
  if (held) {
    pool.delete(term);
    pool.set(term, held);
    return;
  }
  let addon: PooledWebglAddon;
  try {
    addon = new PooledWebglAddon(term);
    term.loadAddon(addon);
  } catch {
    return;
  }
  addon.onContextLoss(() => addon.dispose());
  pool.set(term, addon);
  while (pool.size > MAX_WEBGL_TERMINALS) pool.values().next().value!.dispose();
}
