// Actual dependency methods; canvas/GL rasterization is symbolic, not a physical GPU test.
const { createRequire, Module } = require('node:module');
const fs = require('node:fs'), path = require('node:path');
const project = path.resolve(__dirname, '../..');
const esbuild = createRequire(project + '/package.json')('esbuild-wasm');
const transforms = new Map();
function production(root = project) {
  const req = createRequire(root + '/package.json'), cache = new Map();
  const addon = path.dirname(req.resolve('@xterm/addon-webgl/package.json'));
  const core = path.dirname(req.resolve('@xterm/xterm/package.json'));
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const m = new Module(file, module); m.filename = file; m.paths = Module._nodeModulePaths(root); cache.set(file, m);
    m.require = id => {
      let next;
      if (/^(common|browser|vs)\//.test(id)) next = path.join(core, 'src', id);
      else if (id.startsWith('.')) next = path.resolve(path.dirname(file), id);
      else if (id.startsWith('@/')) next = path.join(root, 'src', id.slice(2));
      else return req(id);
      if (!path.extname(next)) next += '.ts';
      return load(next);
    };
    const source = fs.readFileSync(file, 'utf8');
    const cached = transforms.get(file);
    const code = cached?.source === source ? cached.code : esbuild.transformSync(source, {
      loader: 'ts', format: 'cjs', target: 'es2022', tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
    }).code;
    transforms.set(file, { source, code }); m._compile(code, file);
    return m.exports;
  }
  const fromAddon = name => load(path.join(addon, 'src', name + '.ts'));
  return { load, core, addon, ...fromAddon('TextureAtlas'), ...fromAddon('GlyphRenderer'), ...fromAddon('WebglRenderer'), ...fromAddon('RectangleRenderer') };
}
function fixture(root, limit = 16) {
  const api = production(root), { TextureAtlas, GlyphRenderer, WebglRenderer } = api;
  let canvasId = 0;
  function canvas() {
    const c = { id: ++canvasId, width: 0, height: 0, rects: [], remove() {}, getContext() { return ctx; } };
    const ctx = { clearRect() { c.rects = []; }, drawImage(source, x, y) { for (const r of source.rects) c.rects.push({ ...r, x: r.x + x, y: r.y + y }); } };
    return c;
  }
  const document = { createElement: canvas };
  function atlas() { return new TextureAtlas(document, { deviceCellWidth: 16, deviceCellHeight: 16, allowTransparency: true }, {}); }
  TextureAtlas.maxAtlasPages = undefined; TextureAtlas.maxTextureSize = 4096;
  const a = atlas(); while (a.pages.length < limit) a._createNewPage();
  function seed(target, page, code, label, fg = 1, x = 32, y = 32) {
    const p = target.pages[page], size = p.canvas.width;
    const g = { texturePage: page, texturePosition: { x, y }, texturePositionClipSpace: { x: x / size, y: y / size }, offset: { x: 0, y: 0 }, size: { x: 16, y: 16 }, sizeClipSpace: { x: 16 / size, y: 16 / size } };
    p.addGlyph(g); p.canvas.rects.push({ x, y, w: 16, h: 16, label }); p.currentRow.x = x + 16;
    target._cacheMap.set(code, 0, fg, 0, g);
    return g;
  }
  const red = seed(a, 0, 88, 'red-X'); seed(a, 0, 90, 'blue-other', 2, 64, 64);
  for (let i = 1; i < limit; i++) seed(a, i, 100 + i, 'page-' + i);
  let triggered = false;
  a._drawToCache = function(code, bg, fg) {
    if (!triggered) { triggered = true; this._createNewPage(); }
    return seed(this, this.pages.length - 1, code, code === 88 ? 'red-X' : 'green-Y', fg, 0, 0);
  };
  TextureAtlas.maxAtlasPages = limit;
  function renderer(target = a) {
    let bound, uploaded; const draws = [], uploads = [];
    const textures = Array.from({ length: limit }, () => ({ version: -1, texture: { canvas: undefined } }));
    const gl = { TEXTURE0: 100, TEXTURE_2D: 2, ARRAY_BUFFER: 3, STREAM_DRAW: 4, TRIANGLE_STRIP: 5, UNSIGNED_BYTE: 6, TEXTURE_WRAP_S: 7, TEXTURE_WRAP_T: 8, CLAMP_TO_EDGE: 9, RGBA: 10,
      useProgram() {}, bindVertexArray() {}, bindBuffer() {}, bufferData(_t, data) { uploaded = new Float32Array(data); }, activeTexture() {}, bindTexture(_t, texture) { bound = texture; }, texParameteri() {},
      texImage2D(...args) { bound.canvas = args.at(-1); uploads.push(bound.canvas.id); }, generateMipmap() {},
      drawElementsInstanced() { const p = uploaded[4], c = textures[p].texture.canvas; const x = uploaded[5] * c.width, y = uploaded[6] * c.height; const r = c.rects.findLast(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h); draws.push({ sample: r?.label ?? 'empty', page: p, uv: [uploaded[5], uploaded[6]] }); },
    };
    const g = Object.create(GlyphRenderer.prototype);
    Object.assign(g, { _atlas: target, _lastAtlasPageLayoutVersion: -1, _gl: gl, _terminal: { cols: 2, rows: 1 }, _optionsService: { rawOptions: { rescaleOverlappingGlyphs: false } }, _dimensions: { device: { cell: { width: 16 }, char: { width: 16, left: 0, top: 0 }, canvas: { width: 32, height: 16 } } }, _vertices: { count: 0, attributes: new Float32Array(0), attributesBuffers: [new Float32Array(0), new Float32Array(0)] }, _activeBuffer: 0, _atlasTextures: textures }); g.clear();
    let clearCount = 0, dirty = true;
    const r = Object.create(WebglRenderer.prototype);
    Object.assign(r, { _charAtlas: target, _isAttached: true, _terminal: { cols: 2, rows: 1 }, _renderLayers: [], _glyphRenderer: { value: g }, _rectangleRenderer: { value: { renderBackgrounds() {}, renderCursor() {} } }, _cursorBlinkStateManager: { value: undefined },
      _model: { lineLengths: [2], clear() { clearCount++; dirty = true; } },
      _updateModel() { if (!dirty) return; g.updateCell(0, 0, 88, 0, 1, 0, 'X', 1, 0); g.updateCell(1, 0, 89, 0, 2, 0, 'Y', 1, 0); dirty = false; }, _requestRedrawViewport() {},
    });
    return { r, g, gl, draws, uploads, textures, get clears() { return clearCount; }, dirty() { dirty = true; } };
  }
  return { ...api, a, red, atlas, seed, renderer, document, canvas, triggered: () => triggered };
}
module.exports = { production, fixture, project };
