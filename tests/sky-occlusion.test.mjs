// The sky occlusion's height map & integral (js/sky-occlusion.js, ported from Ben Houston's enhanced Slop New York
// lighting, MIT): the rasteriser, the max-mip pyramid, and the integral the shader runs against the closed form of a
// street canyon and against a brute-force reference on small synthetic blocks
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const src = fs.readFileSync(new URL('../js/sky-occlusion.js', import.meta.url), 'utf8');
const window = { CITY: {} };
vm.runInContext(src, vm.createContext({ window, URLSearchParams, console, performance }));
const S = window.CITY.SkyOcclusion;

const box = (x0, z0, x1, z1, maxY) => ({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, maxY });
// a map of 600 x 600 m with 2 m texels around the origin
const mapOf = (colliders, texel = 2) => {
  const grid = S.createGrid({ minX: -300, maxX: 300, minZ: -300, maxZ: 300 }, 0, texel);
  S.collidersToGrid(grid, colliders);
  return { grid, pyramid: S.buildPyramid(grid) };
};

test('heights are stored as rounded-down square roots, never above the roof', () => {
  for (const h of [0, 3, 20, 100, 298, 553, 700]) {
    const back = S.decodeHeight(S.encodeHeight(h));
    assert.ok(back <= h + 1e-9, `${h} came back as ${back}`);
    assert.ok(h - back <= 2 * Math.sqrt(h * S.MAX_HEIGHT) / 255 + 1e-9, `${h} came back as ${back}`);
  }
  assert.equal(S.encodeHeight(-5), 0);
  assert.equal(S.encodeHeight(5000), 255);
});

test('the texel grows with the map so it stays within 14 M texels and 8192 a side', () => {
  assert.equal(S.chooseTexel(4000, 4000), 2);
  assert.equal(S.chooseTexel(15000, 12000), 4); // the desktop city, about 190 km2
  assert.equal(S.chooseTexel(40000, 40000), 8);
  for (const [w, d] of [[4000, 4000], [15000, 12000], [30000, 20000]]) {
    const t = S.chooseTexel(w, d);
    assert.ok(Math.ceil(w / t) * Math.ceil(d / t) <= 14e6 && Math.max(w, d) / t <= 8192);
  }
});

test('only buildings are drawn: not props, trees, raised decks or low walls', () => {
  const { grid } = mapOf([
    box(0, 0, 20, 20, 30), // a building
    { ...box(100, 0, 120, 20, 30), prop: true }, { ...box(100, 100, 102, 102, 12), circle: { x: 101, z: 101, r: 1 } },
    { ...box(-100, 0, -80, 20, 12), minY: 8 }, box(-100, 100, -80, 120, 2)
  ]);
  const at = (x, z) => grid.data[Math.floor((z - grid.originZ) / grid.texel) * grid.width + Math.floor((x - grid.originX) / grid.texel)];
  assert.ok(at(10, 10) > 0);
  assert.equal(at(110, 10), 0); assert.equal(at(101, 101), 0); assert.equal(at(-90, 10), 0); assert.equal(at(-90, 110), 0);
});

test('polygons (with a courtyard hole), turned boxes and the tallest-wins overlap rasterise', () => {
  const ring = [{ x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 40 }, { x: 0, z: 40 }];
  const hole = [{ x: 15, z: 15 }, { x: 25, z: 15 }, { x: 25, z: 25 }, { x: 15, z: 25 }];
  const obb = { cx: 100, cz: 100, hx: 10, hz: 4, cs: Math.SQRT1_2, sn: Math.SQRT1_2 }; // turned 45 degrees
  const { grid } = mapOf([
    { minX: 0, maxX: 40, minZ: 0, maxZ: 40, maxY: 20, polygon: { outer: ring, holes: [hole] } },
    { minX: 5, maxX: 10, minZ: 5, maxZ: 10, maxY: 60 }, // taller, inside the first
    { minX: 90, maxX: 110, minZ: 90, maxZ: 110, maxY: 25, obb }
  ]);
  const h = (x, z) => S.decodeHeight(grid.data[Math.floor((z - grid.originZ) / grid.texel) * grid.width + Math.floor((x - grid.originX) / grid.texel)]);
  assert.ok(Math.abs(h(30, 30) - 20) < 1.5);
  assert.equal(h(20, 20), 0, 'the courtyard is open');
  assert.ok(h(7, 7) > 55, 'the taller one wins');
  assert.ok(Math.abs(h(100, 100) - 25) < 1.5);
  assert.ok(Math.abs(h(104, 96) - 25) < 1.5, 'along the turned box\'s long axis');
  assert.equal(h(104, 104), 0, 'but not across it, where the unturned box would be');
});

test('a triangle fills the heights it leans to, and a wall seen edge-on nothing', () => {
  const grid = S.createGrid({ minX: 0, maxX: 64, minZ: 0, maxZ: 64 }, 0, 2);
  S.fillTriangle(grid, 0, 0, 0, 64, 0, 40, 0, 64, 40); // a ramp rising along x and z
  S.fillTriangle(grid, 10, 10, 90, 10, 20, 90, 10, 30, 90); // edge-on
  const h = (x, z) => S.decodeHeight(grid.data[Math.floor(z / 2) * grid.width + Math.floor(x / 2)]);
  assert.ok(h(8, 8) < h(40, 20));
  assert.ok(h(10, 15) < 50, 'the wall left nothing');
});

test('the pyramid holds the tallest of the four texels under each', () => {
  const { grid, pyramid } = mapOf([box(10, 10, 12, 12, 100)]); // one tower 2 x 2 m
  assert.equal(pyramid[0].width, grid.width);
  assert.equal(pyramid[pyramid.length - 1].width, 1);
  const top = pyramid[pyramid.length - 1].data[0];
  assert.equal(top, Math.max(...grid.data));
  for (let l = 1; l < pyramid.length; l++) {
    assert.equal(Math.max(...pyramid[l].data), top, 'the tower survives every level');
  }
});

const open = () => mapOf([]);
test('an open field sees all of the sky, facing up or sideways', () => {
  const { grid, pyramid } = open();
  assert.ok(S.visibility(pyramid, grid, [0, 0, 0], [0, 1, 0]) > 0.999);
  assert.ok(Math.abs(S.visibility(pyramid, grid, [0, 0, 0], [1, 0, 0]) - 0.5) < 0.02, 'a wall facing open ground sees half of it');
});

// an infinitely long street canyon, walls H high and W apart: facing up at its centre the sky is the mean over the
// compass of 1 / (1 + (2H/W cos phi)^2), which is 1 / sqrt(1 + (2H/W)^2)
const canyon = (W, H) => mapOf([box(-250, -300, -W / 2, 300, H), box(W / 2, -300, 250, 300, H)]);
test('the canyon\'s sky at the street matches the closed form', () => {
  for (const [W, H] of [[20, 20], [30, 60], [60, 30], [20, 100]]) {
    const { grid, pyramid } = canyon(W, H);
    // (the point is lifted 2 m off the ground & the walls start a texel in: the roofs rise 2.5 m less over it)
    const exact = 1 / Math.sqrt(1 + (2 * (H - 2.5) / W) ** 2);
    const v = S.visibility(pyramid, grid, [0, 0, 0], [0, 1, 0]);
    assert.ok(Math.abs(v - exact) < 0.12, `W ${W} H ${H}: ${v.toFixed(3)} against ${exact.toFixed(3)}`);
  }
});

test('the sky grows with height up the wall, and is whole above the roofs', () => {
  const { grid, pyramid } = canyon(20, 40);
  let last = -1;
  for (const y of [1, 10, 20, 30, 39]) {
    const v = S.visibility(pyramid, grid, [-9.9, y, 0], [1, 0, 0]);
    assert.ok(v >= last - 1e-6, `at ${y} m`); last = v;
  }
  assert.ok(S.visibility(pyramid, grid, [0, 41, 0], [0, 1, 0]) > 0.995, 'above the roofs, facing up');
  assert.ok(S.visibility(pyramid, grid, [0, 0, 0], [0, 1, 0]) < S.visibility(pyramid, grid, [0, 0, 0], [0, 1, 0], { bias: 0 }) + 1e-9);
});

test('the shader\'s integral agrees with the brute-force reference on a synthetic block', () => {
  const { grid, pyramid } = mapOf([
    box(-60, -60, -20, -20, 50), box(20, -60, 60, -20, 80), box(-60, 20, -20, 60, 30), box(20, 20, 40, 60, 120),
    box(100, -40, 112, 40, 200), box(-140, -10, -100, 10, 60)
  ]);
  const stats = { up: [], walls: [] };
  for (const x of [-80, -40, 0, 0.1, 40, 80, 130]) for (const z of [-80, -40, 0.1, 40, 90]) {
    for (const y of [0, 15, 45]) {
      if (S.heightAt(pyramid, grid, x, z, 0) > y - 3) continue; // inside a building
      for (const nn of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
        const a = S.visibility(pyramid, grid, [x, y, z], nn), b = S.visibilityReference(pyramid, grid, [x, y, z], nn);
        (nn[1] ? stats.up : stats.walls).push(Math.abs(a - b));
      }
    }
  }
  const report = (d) => { d.sort((p, q) => p - q); return { n: d.length, mean: d.reduce((p, q) => p + q, 0) / d.length, p95: d[Math.floor(d.length * 0.95)] }; };
  const up = report(stats.up), walls = report(stats.walls);
  // (13 steps of 1.41x against every texel, 16 slices against 64: the horizon is found a step late at times, so the sky
  // reads a little open. A wall's slices are turned outward off its own plane, so they sweep a little to one side)
  assert.ok(up.mean < 0.06 && up.p95 < 0.12, `facing up: mean ${up.mean.toFixed(3)}, 95th percentile ${up.p95.toFixed(3)} over ${up.n} points`);
  assert.ok(walls.mean < 0.1 && walls.p95 < 0.3, `on walls: mean ${walls.mean.toFixed(3)}, 95th percentile ${walls.p95.toFixed(3)} over ${walls.n} points`);
});

test('the quality tiers: the pass on high & medium, off on the phone', () => {
  const q = fs.readFileSync(new URL('../js/quality.js', import.meta.url), 'utf8');
  const on = q.match(/skyOcclusion: \{ slices: (\d+), steps: (\d+)/g);
  assert.equal(on.length, 2, 'high and medium');
  assert.match(q, /low: \{[\s\S]*?skyOcclusion: null/);
});
