// The sign atlases stay inside WebGPU's 8192-texel texture limit however many signs a map has (st-bz1o.3): the TTC
// destination signs (transit.js signAtlas, one cell per distinct sign: an Eglinton-sized map has ~180 bus signs, the
// City ~490) and the park name signs (park-signs.js, one channel of a cell per park: the City has ~1,350 parks). Past
// the limit the texture is invalid, and WebGPU drops every render pass that samples it (docs/map-scale-measurements.md).
// Today's map keeps its layout: one column of destination signs, four cells across for the parks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const read = (f) => fs.readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8');
// a 2D canvas that only remembers its size and where text was drawn
const canvas = () => {
  const c = { width: 0, height: 0, texts: [] };
  let tx = 0;
  c.getContext = () => ({
    save() {}, restore() { tx = 0; }, translate(x) { tx += x; }, fillRect() {}, clearRect() {}, beginPath() {}, rect() {}, clip() {},
    setTransform() {}, measureText: (t) => ({ width: t.length * 10 }), fillText(t, x) { c.texts.push(tx + x); },
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })
  });
  return c;
};
class Tex { constructor(img) { this.image = img; } }
const THREE = { CanvasTexture: Tex, DataTexture: Tex, SRGBColorSpace: 'srgb', NoColorSpace: '', LinearMipmapLinearFilter: 0, LinearFilter: 0 };
const context = vm.createContext({ window: { CITY: { THREE, GEO: { props: {} }, CITY_BOUNDS: {}, blockAt: () => null, TRANSIT_DATA: null } },
  document: { createElement: canvas }, console, location: { search: '' } });

test('the TTC destination-sign atlas runs on in columns past 8192 rows of texels', () => {
  const src = read('transit');
  vm.runInContext(`(function(){ const { THREE } = window.CITY; ${src.slice(src.indexOf('const MAX_TEXTURE'), src.indexOf('// The buses\''))}; window.CITY.__signAtlas = signAtlas; })()`, context);
  const signAtlas = context.window.CITY.__signAtlas;
  const signs = (n) => Array.from({ length: n }, (_, i) => [`${i} ROUTE`, `DESTINATION ${i}`]);
  for (const [n, aspect] of [[40, 1.9 / 0.27], [180, 1.9 / 0.27], [490, 1.9 / 0.27], [60, 1.6 / 0.34], [300, 1.6 / 0.34]]) {
    const a = signAtlas(signs(n), aspect), img = a.tex.image, H = Math.round(512 / aspect);
    assert.ok(img.width <= 8192 && img.height <= 8192, `${n} signs: ${img.width} x ${img.height}`);
    assert.ok(a.rows * a.cols >= n, `${n} signs fit ${a.rows} x ${a.cols}`);
    if (n * H <= 8192) assert.deepEqual([a.cols, a.rows, img.width, img.height], [1, n, 512, n * H], 'today\'s single column');
    assert.equal(a.rowOf(signs(n)[n - 1]), n - 1);
    // the last sign is drawn in its own column
    assert.ok(Math.max(...img.texts) >= (a.cols - 1) * 512, 'text drawn in the last column');
  }
});

test('the park-sign atlas widens past four cells only when four would run past 8192 texels', () => {
  vm.runInContext(read('park-signs'), context);
  const atlas = context.window.CITY.parkSignAtlas;
  const parks = (n) => Array.from({ length: n }, (_, i) => [0, 0, 0, `Park ${i}`, `${i}`, 'Street']);
  const today = atlas(parks(240));
  assert.equal(today.W, 4 * 512, 'today\'s 240 parks: four cells across');
  for (const n of [240, 549, 1350, 3000]) {
    const a = atlas(parks(n));
    assert.ok(a.W <= 8192 && a.H <= 8192, `${n} parks: ${a.W} x ${a.H}`);
    assert.equal(a.cells.length, n);
    assert.ok(a.cells.every(([u, v]) => u >= 0 && u < 1 && v >= 0 && v < 1));
  }
});
