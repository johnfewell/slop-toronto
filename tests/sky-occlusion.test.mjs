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

// ---- the ground, the trees and the offset (jf-lbb, item 4) -----------------------------------------------------------
test('with an offset, heights under the street level are stored too, rounded down', () => {
  for (const off of [5, 15, 40]) {
    for (const h of [-off, -off / 2, -0.3, 0, 3, 20, 100, 553]) {
      const back = S.decodeHeight(S.encodeHeight(h, off), off);
      assert.ok(back <= h + 1e-9, `${h} (offset ${off}) came back as ${back}`);
      assert.ok(h - back <= 2 * Math.sqrt((h + off) * (S.MAX_HEIGHT + off)) / 255 + 1e-9, `${h} (offset ${off}) came back as ${back}`);
    }
    assert.equal(S.encodeHeight(-off - 3, off), 0);
  }
  assert.equal(S.decodeHeight(S.encodeHeight(37, 0), 0), S.decodeHeight(S.encodeHeight(37)), 'no offset is the old encoding');
});

// a bowl: the ground falls 12 m under the street level in a ravine along the z axis (a V of 40 m half width)
const ravine = (x) => -12 * Math.max(0, 1 - Math.abs(x) / 40);
const ravineMap = (colliders = [], trees = null) => {
  const grid0 = S.createGrid({ minX: -300, maxX: 300, minZ: -300, maxZ: 300 }, 0, 2);
  const lattice = S.groundLattice(grid0, (x) => ravine(x), 8);
  const grid = S.createGrid({ minX: -300, maxX: 300, minZ: -300, maxZ: 300 }, 0, 2, lattice.offset);
  S.fillGround(grid, lattice);
  S.collidersToGrid(grid, colliders);
  if (trees) S.treesToGrid(grid, trees, (x, z) => S.latticeAt(lattice, x, z));
  return { grid, lattice, pyramid: S.buildPyramid(grid) };
};

test('the ground lattice finds how deep the ground goes, to the next 5 m, at most 40', () => {
  const grid0 = S.createGrid({ minX: -300, maxX: 300, minZ: -300, maxZ: 300 }, 0, 2);
  assert.equal(S.groundLattice(grid0, () => 0).offset, 0);
  assert.equal(S.groundLattice(grid0, () => 14).offset, 0, 'hills need no offset');
  assert.equal(S.groundLattice(grid0, (x) => ravine(x), 8).offset, 15);
  assert.equal(S.groundLattice(grid0, () => -90).offset, 40);
  assert.equal(S.groundLattice(grid0, () => -0.2).offset, 0, 'a pond\'s 0.2 m is no ravine');
});

test('a ravine shades its floor and its sides, and the rim sees the whole sky', () => {
  const flat = open();
  const { grid, pyramid } = ravineMap();
  const sky = (m, p, n) => S.visibility(m.pyramid, m.grid, p, n);
  // (the floor is 12 m down, the rims 40 m either side: the horizon is 17 degrees up, about 0.9 of the sky)
  const floor = sky({ grid, pyramid }, [0, -12, 0], [0, 1, 0]);
  assert.ok(floor < 0.98 && floor > 0.7, `the floor: ${floor.toFixed(3)}`);
  assert.ok(floor < sky(flat, [0, 0, 0], [0, 1, 0]) - 0.02, 'less sky than open ground');
  const rim = sky({ grid, pyramid }, [60, 0, 0], [0, 1, 0]);
  assert.ok(rim > 0.995, `the rim: ${rim.toFixed(3)}`);
  // (the floor reads the same by the brute force)
  const ref = S.visibilityReference(pyramid, grid, [0, -12, 0], [0, 1, 0]);
  assert.ok(Math.abs(floor - ref) < 0.08, `${floor.toFixed(3)} against ${ref.toFixed(3)}`);
});

test('a building on the ravine floor stands over it: its roof is a height, not a depth', () => {
  const { grid } = ravineMap([box(-5, -5, 5, 5, 20)]);
  const at = (x, z) => S.decodeHeight(grid.data[Math.floor((z - grid.originZ) / grid.texel) * grid.width + Math.floor((x - grid.originX) / grid.texel)], grid.offset);
  assert.ok(Math.abs(at(0, 0) - 20) < 1.8, `the roof ${at(0, 0).toFixed(1)}`);
  assert.ok(Math.abs(at(0, 100) + 12) < 1.8 && at(20, 100) > at(0, 100) + 3 && at(50, 100) > -1.8, 'the ravine floor, its side and the plain');
});

test('a disc keeps the tallest and always marks at least the texel under its centre', () => {
  const grid = S.createGrid({ minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, 0, 2);
  S.fillDisc(grid, 0, 0, 6, 100);
  S.fillDisc(grid, 3, 0, 5, 50);
  S.fillDisc(grid, 15.2, 15.2, 0.3, 80);
  const at = (x, z) => grid.data[Math.floor((z - grid.originZ) / grid.texel) * grid.width + Math.floor((x - grid.originX) / grid.texel)];
  assert.equal(at(0, 0), 100); assert.equal(at(3, 0), 100, 'the taller disc wins where they overlap'); assert.equal(at(7, 0), 50);
  assert.equal(at(15.2, 15.2), 80, 'a crown under a texel');
  assert.equal(at(-10, 10), 0, 'outside');
});

test('trees are drawn at a share of their height, from their foot or the ground, and small ones are left out', () => {
  const trees = { count: 3, data: new Float32Array([0, 0, 100, 12, 4, 100, 0, 100, 3, 3, -150, 0, 100, 10, 4]) };
  const { grid } = ravineMap([], trees);
  const at = (x, z) => S.decodeHeight(grid.data[Math.floor((z - grid.originZ) / grid.texel) * grid.width + Math.floor((x - grid.originX) / grid.texel)], grid.offset);
  assert.ok(Math.abs(at(0, 100) - 12 * S.CROWN_SHARE) < 1.6, `a 12 m tree on the flat: ${at(0, 100).toFixed(1)}`);
  assert.ok(at(100, 100) < 1, 'a 3 m shrub is left out');
  // (foot y 0, but the ground there is 12 m under the street: the foot is taken as the street's 0 since the site's y is higher)
  assert.ok(Math.abs(at(-150, 100) - (0 + 10 * S.CROWN_SHARE)) < 1.6 || at(-150, 100) > 3, `a tree where the ground is flat: ${at(-150, 100).toFixed(1)}`);
});

test('a tree line shades the ground beside it, less than a wall of the same height', () => {
  const trees = { count: 20, data: new Float32Array(100) };
  for (let i = 0; i < 20; i++) trees.data.set([-95 + i * 10, 0, 6, 14, 4], i * 5); // a row along x at z = 6, 14 m trees (their crowns reach CROWN_SHARE of that: 4.2 m)
  const grid0 = () => S.createGrid({ minX: -300, maxX: 300, minZ: -300, maxZ: 300 }, 0, 2);
  const g = grid0(); S.treesToGrid(g, trees);
  const withTrees = { grid: g, pyramid: S.buildPyramid(g) };
  const wall = mapOf([box(-100, 6, 100, 10, 14)]);
  const open0 = open();
  const p = [0, 0, 0];
  const v = (m) => S.visibility(m.pyramid, m.grid, p, [0, 1, 0]);
  assert.ok(v(withTrees) < v(open0) - 0.005, 'trees take some of the sky');
  assert.ok(v(withTrees) > v(wall) - 1e-9, 'but a row of crowns reaches less high than a wall of their height');
});

// ---- the bounce's colour (jf-lbb, item 3) ----------------------------------------------------------------------------
test('the bounce keeps the luminance of the single bounce it replaces, warm from lit walls and cooler from shade', () => {
  const rgb = (hex) => ({ r: ((hex >> 16) & 255) / 255, g: ((hex >> 8) & 255) / 255, b: (hex & 255) / 255 });
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  for (const [skyHex, groundHex, intensity, bounce] of [[0xaad2ff, 0xb89678, 1.58, 0.58], [0x9abbe6, 0xc88a62, 1.48, 0.52], [0x4c6ca8, 0x6e5048, 0.85, 0.32]]) {
    const sky = rgb(skyHex), ground = rgb(groundHex);
    const c = S.bounceColours(sky, ground, intensity, bounce, 0xfff5e8, 1);
    const single = (0.2126 * ground.r + 0.7152 * ground.g + 0.0722 * ground.b) * bounce * intensity / Math.PI;
    assert.ok(lum(c.warm) > single && lum(c.warm) < single * 1.4, `warm ${lum(c.warm).toFixed(3)} against ${single.toFixed(3)}`);
    assert.ok(lum(c.cool) < single && lum(c.cool) > single * 0.45, `cool ${lum(c.cool).toFixed(3)} against ${single.toFixed(3)}`);
    assert.ok(c.warm[0] / c.warm[2] > c.cool[0] / c.cool[2], 'the warm light is redder than the cool');
    assert.ok(c.warm[0] > c.warm[2], 'warm: more red than blue');
  }
});

test('the sun is on the walls on a clear day and not under the moon or a heavy overcast', () => {
  assert.ok(S.sunLitness(6.6, 0) > 0.99);
  assert.ok(S.sunLitness(5.8, 0) > 0.9);
  const dusk = S.sunLitness(3.1, 0.28);
  assert.ok(dusk > 0.05 && dusk < 0.5, `the last light: ${dusk.toFixed(2)}`);
  assert.equal(S.sunLitness(1.45, 0.86), 0);
  assert.equal(S.sunLitness(1.9, 0), 0, 'a grey day');
});

// ---- part 3 of the Rosedale streetscape: the crowns' cover (docs/rosedale-streetscape.md) --------------------------------
test('the crown cover is full under a tree, falls away past its edge, and leaves out saplings', () => {
  const trees = { count: 3, data: new Float32Array([100, 0, 100, 16, 8, -100, 0, 40, 3, 2, 0, 50, 50, 6, 4]) }; // (the second is under MIN_TREE)
  const grid = S.createGrid({ minX: -300, maxX: 300, minZ: -300, maxZ: 300 }, 0, 4);
  const cc = S.crownCoverGrid(grid, trees);
  assert.equal(cc.texel, 8);
  const at = (x, z) => cc.data[Math.floor((z + 300) / cc.texel) * cc.width + Math.floor((x + 300) / cc.texel)] / 255;
  assert.ok(at(100, 100) > 0.6, `under the crown: ${at(100, 100)}`);
  assert.ok(at(100 + 8 * 1.6, 100) < 0.2, `well past its edge: ${at(100 + 12.8, 100)}`);
  assert.equal(at(-100, 40), 0, 'a sapling has no crown');
  assert.equal(at(0, -200), 0, 'open ground');
  assert.ok(at(100 + 3, 100) >= at(100 + 8, 100), 'cover falls with distance from the trunk');
});
