const assert = require('node:assert/strict');
const { fixture, production } = require('./production.cjs');
const cases = {};
for (const limit of [4, 16]) cases[`mid-frame ${limit}-page merge draws original glyph on the first frame`] = root => {
  const f = fixture(root, limit), view = f.renderer();
  view.r.renderRows(0, 0);
  assert.equal(f.triggered(), true);
  assert.equal(view.draws[0].sample, 'red-X', 'stale UV must not be drawn against a merged page');
  assert.equal(view.draws[0].uv[0], f.red.texturePositionClipSpace.x);
  view.r.renderRows(0, 0); assert.equal(view.draws[1].sample, 'red-X');
};
cases['shared clear invalidates an unchanged sibling on its first and second frames'] = root => {
  const f = fixture(root), atlas = f.atlas();
  const raster = (code, bg, fg) => f.seed(atlas, 0, code, code === 88 ? 'red-X' : 'green-Y', fg, code === 88 ? 32 : 64, 32);
  atlas._drawToCache = raster;
  const A = f.renderer(atlas), B = f.renderer(atlas);
  A.r.renderRows(0, 0); B.r.renderRows(0, 0); assert.equal(B.draws.at(-1).sample, 'red-X');
  const before = B.clears;
  A.r.clearTextureAtlas(); f.seed(atlas, 0, 90, 'blue-from-A', 2);
  B.r.renderRows(0, 0); B.r.renderRows(0, 0);
  assert.equal(B.draws.at(-2).sample, 'red-X', 'B cells are unchanged but its UV cache must rebuild');
  assert.equal(B.draws.at(-1).sample, 'red-X'); assert.equal(B.clears, before + 1);
};
cases['background rectangle grows for every RGBA float and the clear rectangle'] = root => {
  const api = production(root), { RectangleRenderer } = api;
  const r = Object.create(RectangleRenderer.prototype);
  Object.assign(r, { _terminal: { rows: 1, cols: 1 }, _dimensions: { device: { cell: { width: 16, height: 16 }, canvas: { width: 16, height: 16 } } }, _themeService: { colors: { background: { rgba: 0x112233ff }, foreground: { rgba: 0xffeeddff } } } });
  const vertices = { attributes: new Float32Array(12), count: 0 };
  r._updateRectangle(vertices, 8, 0, 0, 0, 1, 0);
  assert.equal(vertices.attributes.length, 16); assert.equal(vertices.attributes[15], 1);
  assert.ok(Math.abs(vertices.attributes[12] - 0x11 / 255) < 1e-7);
  const { FgFlags } = api.load(require('node:path').join(api.core, 'src/common/buffer/Constants.ts'));
  r._updateRectangle(vertices, 8, FgFlags.INVERSE, 0, 0, 1, 0);
  assert.equal(vertices.attributes[12], 1); assert.ok(Math.abs(vertices.attributes[13] - 0xee / 255) < 1e-7); assert.equal(vertices.attributes[15], 1);
};

cases['two renderers observe a layout change independently and stop clearing when stable'] = root => {
  const f = fixture(root), A = f.renderer(), B = f.renderer();
  A.r.renderRows(0, 0); B.r.renderRows(0, 0);
  const counts = [A.clears, B.clears];
  A.r.renderRows(0, 0); B.r.renderRows(0, 0);
  assert.deepEqual([A.clears, B.clears], counts);
  assert.equal(A.draws.at(-1).sample, 'red-X'); assert.equal(B.draws.at(-1).sample, 'red-X');
};
cases['page replacement and clear versions do not collide across pages'] = root => {
  const f = fixture(root), first = f.a.pages[0], second = f.a.pages[1];
  const initial = Math.max(...f.a.pages.map(p => p.version));
  first.clear(); assert.ok(first.version > initial);
  second.clear(); assert.ok(second.version > first.version);
  const view = f.renderer(); view.g.setAtlas(f.atlas());
  assert.ok(view.textures.every(t => t.version === -1));
  assert.equal(view.g.beginFrame(), true); assert.equal(view.g.beginFrame(), false);
};
function withDocument(document, run) {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { value: document, configurable: true });
  try { return run(); } finally { if (before) Object.defineProperty(globalThis, 'document', before); else delete globalThis.document; }
}
cases['font and DPR changes reacquire compatible shared atlases without consuming sibling invalidation'] = root => {
  const f = fixture(root);
  const cache = f.load(require('node:path').join(f.addon, 'src/CharAtlasCache.ts'));
  const options = { fontSize: 16, fontFamily: 'synthetic-mono', fontWeight: 'normal', fontWeightBold: 'bold', allowTransparency: true, lineHeight: 1, letterSpacing: 0, customGlyphs: true, minimumContrastRatio: 1 };
  const colors = { foreground: { rgba: 0xffffffff }, background: { rgba: 0xff }, ansi: Array.from({ length: 256 }, () => ({ rgba: 0xff })) };
  const owners = Array.from({ length: 2 }, () => ({ _core: { unicodeService: {} } }));
  const acquire = (owner, font, dpr) => cache.acquireTextureAtlas(owner, { ...options, fontSize: font }, colors, 16 * dpr, 16 * dpr, 16 * dpr, 16 * dpr, dpr, 4096);
  withDocument(f.document, () => {
    const shared = acquire(owners[0], 16, 1); assert.equal(acquire(owners[1], 16, 1), shared);
    const font = acquire(owners[0], 18, 1); assert.notEqual(font, shared);
    const dpi = acquire(owners[0], 18, 2); assert.notEqual(dpi, font); assert.equal(acquire(owners[1], 16, 1), shared);
    const view = f.renderer(shared); view.g.beginFrame(); view.g.setAtlas(dpi);
    assert.equal(view.g.beginFrame(), true); assert.equal(view.g.beginFrame(), false);
    f.seed(dpi, 0, 88, 'red-X'); dpi.clearTexture();
    assert.equal(view.g.beginFrame(), true); assert.equal(view.g.beginFrame(), false);
    owners.forEach(owner => cache.removeTerminalFromCache(owner));
  });
};
cases['glyph-fit wrapper preserves page and UV layout after the first-frame merge repair'] = root => {
  const f = fixture(root), view = f.renderer();
  const fit = f.load(require('node:path').join(root, 'src/utils/terminalGlyphFit.ts'));
  f.red.offset.x = 2; f.red.size.x = 28;
  view.r._updateModel = () => { view.g.updateCell(0, 0, 88, 0, 1, 0, '→', 1, 0); view.g.updateCell(1, 0, 89, 0, 2, 0, 'Y', 1, 0); };
  const restore = fit.guardNarrowSymbolBounds(view.g, () => 2, () => true);
  view.r.renderRows(0, 0);
  assert.equal(view.draws[0].sample, 'red-X'); assert.equal(view.g._vertices.attributes.length, 2 * 11);
  assert.equal(view.g._vertices.attributes[4], f.red.texturePage);
  assert.equal(view.g._vertices.attributes[5], f.red.texturePositionClipSpace.x);
  assert.ok(view.g._vertices.attributes[0] >= 0);
  assert.ok(view.g._vertices.attributes[2] * 32 <= 15.001);
  restore(); view.g.updateCell(0, 0, 88, 0, 1, 0, '→', 1, 0);
  assert.equal(view.g._vertices.attributes[0], -2);
};
function pixelFixture(root) {
  const f = fixture(root), view = f.renderer(), canvases = [];
  const element = () => ({ style: {}, dataset: {}, children: [], clientHeight: 16, setAttribute() {}, appendChild(child) { this.children.push(child); }, replaceChildren(...children) { this.children = children; }, get firstChild() { return this.children[0]; }, remove() {} });
  const doc = { createElement(kind) { const e = element(); if (kind === 'canvas') { e.getContext = () => ({ drawImage(source) { e.copied = source.sample; } }); canvases.push(e); } return e; } };
  const screen = element(), buffer = { ydisp: 0 }, subscription = () => ({ dispose() {} });
  const term = { cols: 2, rows: 1, element: { querySelector: () => screen }, _core: { _bufferService: { buffer }, _renderService: { _renderer: { value: view.r } } }, buffer: { active: { baseY: 10, viewportY: 0, type: 'normal' }, onBufferChange: subscription }, modes: { mouseTrackingMode: 'none' }, onScroll: subscription, onResize: subscription, onWriteParsed: subscription,
    scrollToLine(line) { buffer.ydisp = line; this.buffer.active.viewportY = line; }, refresh() { view.r.renderRows(0, 0); } };
  view.r._gl = { isContextLost: () => false }; view.r._canvas = { width: 32, height: 16, sample: undefined };
  const draw = view.gl.drawElementsInstanced;
  view.gl.drawElementsInstanced = () => { draw(); view.r._canvas.sample = view.draws.at(-1).sample; };
  const api = f.load(require('node:path').join(root, 'src/utils/terminalPixelScroll.ts'));
  return { ...f, view, doc, canvases, buffer, term, api };
}
cases['pixel-scroll guard copies a repaired neighbour frame and restores the real viewport'] = root => {
  const f = pixelFixture(root);
  withDocument(f.doc, () => {
    try {
      f.api.setTerminalPixelPosition(f.term, 0, 2);
      assert.equal(f.buffer.ydisp, 0); assert.equal(f.canvases[0].copied, 'red-X');
      assert.equal(f.view.draws.at(-1).sample, 'red-X');
    } finally { f.api.disposeTerminalPixels(f.term); }
  });
};
cases['pixel-scroll guard restores viewport and attempts the main paint even after a neighbour error'] = root => {
  const f = pixelFixture(root), rows = [], original = f.view.r.renderRows;
  f.view.r.renderRows = function(start, end) { rows.push(f.buffer.ydisp); if (rows.length === 1) throw new Error('synthetic paint failure'); return original.call(this, start, end); };
  withDocument(f.doc, () => {
    try { assert.throws(() => f.api.setTerminalPixelPosition(f.term, 0, 2), /synthetic paint failure/); assert.deepEqual(rows, [1, 0]); assert.equal(f.buffer.ydisp, 0); }
    finally { f.api.disposeTerminalPixels(f.term); }
  });
};
// Context restoration recreates the GPU owner. Exercise its actual setAtlas/beginFrame state
// contract; browser event delivery and physical GL resource restoration still need a GPU run.
cases['a recreated context owner starts with invalid textures and observes the shared layout independently'] = root => {
  const f = fixture(root), old = f.renderer(); old.r.renderRows(0, 0);
  const restored = f.renderer(); restored.g.setAtlas(f.a);
  assert.ok(restored.textures.every(t => t.version === -1));
  restored.r.renderRows(0, 0); assert.equal(restored.draws[0].sample, 'red-X');
  const clears = restored.clears; restored.r.renderRows(0, 0); assert.equal(restored.clears, clears);
  old.r.renderRows(0, 0); assert.equal(old.draws.at(-1).sample, 'red-X');
};

cases['a mid-frame merge forces texture reupload before drawing'] = root => {
  const f = fixture(root), view = f.renderer(); let invalidations = 0;
  const invalidate = view.g.invalidateAtlasTextures;
  assert.equal(typeof invalidate, 'function');
  view.g.invalidateAtlasTextures = function() { invalidations++; return invalidate.call(this); };
  view.r.renderRows(0, 0); assert.equal(invalidations, 1); assert.ok(view.uploads.length >= f.a.pages.length);
  assert.equal(view.draws[0].sample, 'red-X');
};
cases['unexpected repeated layout invalidation has a finite upstream retry bound'] = root => {
  const f = fixture(root), view = f.renderer(); view.r.renderRows(0, 0); let updates = 0;
  view.r._updateModel = () => { updates++; f.a._pagesVersion++; };
  view.r.renderRows(0, 0); assert.equal(updates, 33);
  // This is the upstream safety cap, not a claim of visual correctness beyond the cap.
};
module.exports = { cases };
if (require.main === module) {
  const root = process.env.XTERM_TEST_ROOT || require('./production.cjs').project;
  let failed = 0; for (const [name, run] of Object.entries(cases)) { try { run(root); console.log('PASS', name); } catch (error) { failed++; console.log('FAIL', name, error.message); } }
  console.log(JSON.stringify({ tests: Object.keys(cases).length, failed, sourceRoot: root, physicalGPU: false })); process.exitCode = failed ? 1 : 0;
}
