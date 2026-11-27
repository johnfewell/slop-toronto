// The woods' impostors as fitted strips (docs/park-cover.md, jf-baa): the span of each band of a tile from its rows' coverage, the
// switch (?impstrips=N, absent: the plain quad as shipped), the geometry of N stacked quads, and the wiring of the shadow proxy
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import * as THREE from 'three/webgpu';

const src = fs.readFileSync(new URL('../js/tree-impostors.js', import.meta.url), 'utf8');
function load(search = '') {
  const window = { CITY: { THREE } };
  vm.runInNewContext(src, { window, location: { search }, URLSearchParams, console: { info() {} }, performance });
  return window.CITY.treeImpostors;
}
const rows = (fill) => { const lo = new Int16Array(256).fill(-1), hi = new Int16Array(256).fill(-1); for (const [y0, y1, a, b] of fill) for (let y = y0; y < y1; y++) { lo[y] = a; hi[y] = b; } return { lo, hi }; };

test('the strips are 4 unless ?impstrips=N says otherwise (0: the plain quad), and N is a whole count', () => {
  assert.equal(load().STRIPS, 4);
  assert.equal(load('?impstrips=8').STRIPS, 8);
  assert.equal(load('?impstrips=0').STRIPS, 0);
  assert.equal(load('?impstrips=junk').STRIPS, 0);
  assert.equal(load('?impstrips=4.7').STRIPS, 4);
  assert.equal(load('?impstrips=99').STRIPS, 32);
  assert.equal(load('?impstrips=8').SHADOW_FIT, false, 'the shadow proxy keeps its quad unless asked');
  assert.equal(load('?impstrips=8&impstripsshadow=1').SHADOW_FIT, true);
});

test('a band\'s span is the first and last covered texel of its rows, padded, and the tile\'s foot is band 0', () => {
  const { bandSpans } = load();
  const { lo, hi } = rows([[100, 200, 40, 89]]); // (memory rows 100-199: v from 0.22 to 0.61; x 40-89)
  const s = bandSpans(lo, hi, 4, 128, 256, 3, 2); // (band 0: rows 192-255, v 0 to 0.25: it sees rows 192-199 only; band 3 the tile's top)
  assert.deepEqual([s[0], s[1]], [37 / 128, 93 / 128]);
  assert.deepEqual([s[2], s[3]], [37 / 128, 93 / 128]); // (band 1: rows 128-191)
  assert.deepEqual([s[4], s[5]], [37 / 128, 93 / 128]); // (band 2: rows 64-127: rows 100-127 are covered)
  assert.deepEqual([s[6], s[7]], [0.5, 0.5], 'band 3 (rows 0-63, padded to 65) is empty: a zero-width span');
});

test('the padding reaches into the next band\'s rows, and stays inside the tile', () => {
  const { bandSpans } = load();
  const { lo, hi } = rows([[0, 4, 0, 127], [100, 101, 60, 60]]);
  const s = bandSpans(lo, hi, 8, 128, 256, 6, 2);
  assert.deepEqual([s[14], s[15]], [0, 1], 'the top band: clamped to the tile');
  const mid = bandSpans(...Object.values(rows([[130, 131, 60, 60]])), 8, 128, 256, 6, 2); // (row 130: band 4 is rows 96-127, padded to 129; band 3 is rows 128-159)
  assert.deepEqual([mid[6], mid[7]], [54 / 128, 67 / 128], 'band 3 holds row 130');
  assert.deepEqual([mid[8], mid[9]], [0.5, 0.5], 'band 4 stops two rows short of it');
  const near = bandSpans(...Object.values(rows([[128, 129, 60, 60]])), 8, 128, 256, 6, 2);
  assert.deepEqual([near[8], near[9]], [54 / 128, 67 / 128], 'band 4 sees row 128 through the two rows of padding');
});

test('half-float thresholds order like the numbers', () => {
  const { toHalf } = load();
  assert.equal(toHalf(0.5), 0x3800);
  assert.equal(toHalf(1), 0x3c00);
  assert.ok(toHalf(0.08) < toHalf(0.5));
});

test('the geometry is N stacked quads for the strips, one quad for the plain impostor and the unfitted shadow proxy', () => {
  const at = (q) => load(q).createImpostors([{ id: 'm', mid: new THREE.BoxGeometry(2, 4, 2).translate(0, 2, 0), src: {} }]);
  const plain = at('?impstrips=0').geometry();
  assert.equal(plain.index.count, 6);
  assert.equal(plain.attributes.aCorner.count, 4);
  assert.equal(plain.attributes.aCorner.itemSize, 2);
  const g = at('?impstrips=8').geometry();
  assert.equal(g.index.count, 48);
  assert.equal(g.attributes.aCorner.count, 32);
  assert.equal(g.attributes.aCorner.itemSize, 3, 'x, y and the strip: the pipeline has eight vertex buffers');
  assert.deepEqual(Array.from(g.attributes.aCorner.array.slice(0, 15)), [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1]);
  assert.equal(Object.keys(g.attributes).length, 3);
  assert.equal(Math.max(...g.index.array), 31);
  assert.equal(at('').geometry().index.count, 24, 'four strips by default');
  assert.equal(at('?impstrips=8').geometry(false).index.count, 6, 'the shadow proxy without the fit');
  assert.equal(g.boundingSphere.radius, 1e5);
});

test('the bounds table starts as the whole width and has a texel per strip, elevation pair and model', () => {
  const imp = load('?impstrips=4').createImpostors([{ id: 'a', mid: new THREE.BoxGeometry(2, 4, 2), src: {} }, { id: 'b', mid: new THREE.BoxGeometry(2, 4, 2), src: {} }]);
  const t = imp.boundsTexture;
  assert.equal(t.image.width, 4);
  assert.equal(t.image.height, 3 * 2);
  assert.deepEqual(Array.from(t.image.data.slice(0, 4)), [0, 1, 0, 0]);
});

test('ez-trees draws the proxy fitted only with the strips, and main.js waits for the fit', () => {
  const ez = fs.readFileSync(new URL('../js/ez-trees.js', import.meta.url), 'utf8');
  assert.match(ez, /const impShadowFit = !!impostors && window\.CITY\.treeImpostors\.STRIPS > 0 && window\.CITY\.treeImpostors\.SHADOW_FIT/);
  assert.match(ez, /make\(impShadowGeometry, impShadowMaterial/);
  assert.match(fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8'), /if \(window\.CITY\.treeImpostors\?\.STRIPS > 0\) await fitted/);
});
