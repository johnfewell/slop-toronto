// The ground masks run only where they can fire (st-aeg2.4). js/tsl-materials.js needs a browser, so the pure helpers are cut out of its source
// and run here, and the mask sites are checked in their source: each one's test is behind guardedInside with the box of its own footprint.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

const read = (f) => fs.readFileSync(new URL(`../js/${f}`, import.meta.url), 'utf8');
const tsl = read('tsl-materials.js');
const cut = (from, to) => {
  const a = tsl.indexOf(from), b = tsl.indexOf(to, a + 1);
  assert.ok(a >= 0 && b > a, `${from} is in tsl-materials.js`);
  return tsl.slice(a, b);
};
const code = cut('function guardedInside(', 'Object.assign(window.CITY, { COAT');
const make = (T) => new Function('window', `${code}\nreturn { guardedInside, groundMaskBox, clusterMaskBoxes };`)({ CITY: { TSL: T } });

test('groundMaskBox: the box of [x, z] pairs or { x, z } points, grown by the pad', () => {
  const { groundMaskBox } = make(TSL);
  assert.deepEqual(groundMaskBox([[0, 0], [10, -4], [3, 8]]), { x0: 0, z0: -4, x1: 10, z1: 8 });
  assert.deepEqual(groundMaskBox([{ x: 1, z: 2 }, { x: -3, z: 5 }], 1), { x0: -4, z0: 1, x1: 2, z1: 6 });
});

test('clusterMaskBoxes: boxes within the gap merge while the merged box stays under the span, others stay apart', () => {
  const { clusterMaskBoxes } = make(TSL);
  const a = { x0: 0, z0: 0, x1: 10, z1: 10 }, near = { x0: 50, z0: 0, x1: 60, z1: 10 }, far = { x0: 5000, z0: 0, x1: 5010, z1: 10 };
  const out = clusterMaskBoxes([a, near, far], 100, 900);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { x0: 0, z0: 0, x1: 60, z1: 10 });
  assert.deepEqual(out[1], far);
  // a chain that would grow past the span is cut into more than one box
  const chain = Array.from({ length: 20 }, (_, i) => ({ x0: i * 100, z0: 0, x1: i * 100 + 90, z1: 10 }));
  const cl = clusterMaskBoxes(chain, 20, 500);
  assert.ok(cl.length >= 4 && cl.every((b) => b.x1 - b.x0 <= 500), `${cl.length} boxes, none over the span`);
  // every input box lies inside some output box (nothing the mask could fire in is dropped)
  for (const b of chain) assert.ok(cl.some((c) => c.x0 <= b.x0 && c.x1 >= b.x1 && c.z0 <= b.z0 && c.z1 >= b.z1));
  assert.equal(clusterMaskBoxes([], 100, 900).length, 0);
  // (the inputs are left as they were)
  assert.deepEqual(a, { x0: 0, z0: 0, x1: 10, z1: 10 });
});

test('guardedInside builds the test only behind the boxes, and is the plain test without boxes', () => {
  const { guardedInside } = make(TSL);
  let built = 0;
  const build = () => { built++; return TSL.float(1).greaterThan(0.5); };
  const plain = guardedInside([], build);
  assert.equal(built, 1, 'no boxes: the test is built as it was');
  assert.ok(plain.isNode);
  const node = guardedInside([{ x0: 0, z0: 0, x1: 10, z1: 10 }, { x0: 50, z0: 50, x1: 60, z1: 60 }], build);
  assert.ok(node.isNode, 'a node');
  assert.notEqual(node, plain);
  // a material takes it as a mask the way the sites do
  const m = new THREE.MeshStandardNodeMaterial();
  m.maskNode = node.not();
  assert.ok(m.maskNode.isNode);
  // without the TSL conditionals the helper falls back to the plain test
  const { guardedInside: g2 } = make({ ...TSL, bool: undefined });
  const before = built;
  g2([{ x0: 0, z0: 0, x1: 1, z1: 1 }], build);
  assert.equal(built, before + 1);
});

test('every ground mask site runs its test behind its own footprint box', () => {
  const sites = [
    ['city-grid.js', 'cutMaskBoxes(rects, bm)', 'the road cuts and the subway spans'],
    ['waterfront-hto-landscape.js', 'C.groundMaskBox(ring, 1)', 'the HTO boardwalk'],
    ['waterfront-hto-landscape.js', 'rings.map((r) => C.groundMaskBox(r, 1))', 'the HTO plaza aprons'],
    ['waterfront-public-realm.js', 'WATERFRONT_WAVEDECKS.map((d) => C.groundMaskBox(d.plan, 1))', 'the wave decks'],
    ['waterfront-beach-landscape.js', 'C.groundMaskBox(r, 1)', 'the beach landscape aprons'],
    ['waterfront-beach-ground.js', 'C.groundMaskBox(s.sandRing, 1)', 'the sand rings'],
    ['waterfront-island-arrivals.js', 'C.groundMaskBox(c.nodes, c.half + 1)', 'the Island berths and footways'],
    ['waterfront-island-access.js', 'C.guardedInside([{ x0: m.minX - 1', 'the Island access mask'],
    ['biidaasige-ground-mask.js', 'C.guardedInside(C.clusterMaskBoxes(boxes),build)', 'the Biidaasige park surfaces']
  ];
  for (const [file, needle, what] of sites) {
    const src = read(file);
    assert.ok(src.includes(needle), `${what}: ${file} has its box`);
    assert.ok(src.includes('guardedInside'), `${what}: ${file} guards its test`);
  }
  // the lake: the water mask's lookup sits behind the box of the wet cells
  const grid = read('city-grid.js');
  assert.match(grid, /const wet = \{ x0: M\.x0 \+ \(wi0 - 2\) \* M\.res/);
  assert.match(grid, /guardedInside\(\[wet\], buildWet\)/);
});

test('the street water mask uses explicit LOD coverage without changing the road colour', () => {
  const grid = read('city-grid.js');
  const source = grid.slice(grid.indexOf('function maskedByWater('), grid.indexOf('// The road cuts', grid.indexOf('function maskedByWater(')));
  const { guardedInside } = make(TSL);
  const mask = new Function('window', 'THREE', `${source}\nreturn maskedByWater;`)({ CITY: { TSL, guardedInside } }, THREE);
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.colorNode = TSL.color(0x343434);
  const colour = mat.colorNode;
  const runs = Buffer.from([1, 0, 2, 0, 1, 0]).toString('base64');
  mask(mat, { runs, w: 4, h: 1, x0: 0, z0: 0, res: 4 });
  assert.equal(mat.colorNode, colour);
  assert.ok(mat.maskNode.isNode, 'coverage applies before colour shading');
  assert.match(source, /texture\(tex, uv\)\.level\(0\)/);
});

test('the road-cut oblongs: every corner of every oblong lies inside the boxes the guard uses', () => {
  const src = read('city-grid.js');
  const fn = src.slice(src.indexOf('function cutMaskBoxes('), src.indexOf('function buildCityGrid('));
  const { groundMaskBox, clusterMaskBoxes } = make(TSL);
  const f = new Function('window', `${fn}\nreturn cutMaskBoxes;`)({ CITY: { groundMaskBox, clusterMaskBoxes } });
  // an oblong along (0.6, 0.8) from (100, -40), 50 m long, 30 m wide across (-0.8, 0.6): corners by the mask's own t and l
  const r = { x0: 100, z0: -40, ux: 0.6, uz: 0.8, len: 50, l0: -15, l1: 15 };
  const boxes = f([r], null);
  assert.ok(boxes.length >= 1);
  for (const t of [0, 50]) for (const l of [-15, 15]) {
    const x = r.x0 + r.ux * t - r.uz * l, z = r.z0 + r.uz * t + r.ux * l;
    assert.ok(boxes.some((b) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1), `corner t=${t} l=${l} is inside a box`);
  }
  // a point on the oblong's axis in the middle is inside too, and a point 300 m off is outside every box
  const mx = r.x0 + r.ux * 25, mz = r.z0 + r.uz * 25;
  assert.ok(boxes.some((b) => mx >= b.x0 && mx <= b.x1 && mz >= b.z0 && mz <= b.z1));
  assert.ok(!boxes.some((b) => 400 >= b.x0 && 400 <= b.x1 && 400 >= b.z0 && 400 <= b.z1));
  // the banks' texture footprint is one more box
  const withBank = f([r], { x0: -500, z0: -500, w: 100, h: 80 });
  assert.ok(withBank.some((b) => b.x0 <= -500 && b.x1 >= -400 && b.z0 <= -500 && b.z1 >= -420));
});
