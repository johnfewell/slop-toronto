// High Park's woods from the lidar (docs/high-park-woods.md): the crowns' data and where they stand, the tree sites
// that replace street-details.js's invented ones on the park's islands and nowhere else, the ground cover on the park's
// islands only, the lawn and tree code that take them, and the build reproducible from the tiles
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const read = (f) => fs.readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8');
function city() {
  const context = vm.createContext({ window: { CITY: { THREE, Addons: { mergeGeometries }, DEBUG_ROADS: false }, addEventListener() {} }, document: { addEventListener() {}, hidden: false },
    console: { info() {}, warn() {}, log() {} }, atob });
  for (const f of ['toronto-geodata', 'toronto-subway', 'toronto-subway-topology', 'high-park-data', 'don-valley', 'city-config', 'high-park-woods-data', 'park-woods']) vm.runInContext(read(f), context);
  return context.window.CITY;
}
const C = city(), W = C.parkWoods, D = C.HIGH_PARK_WOODS_DATA;
const onPark = (x, z) => { const b = C.blockAt(x, z); return !!(b && W.replacesBlock(b)); };
const inPoly = (flat, x, z) => { let c = false; for (let i = 0, j = flat.length - 2; i < flat.length; j = i, i += 2) { if ((flat[i + 1] > z) !== (flat[j + 1] > z) && x < ((flat[j] - flat[i]) * (z - flat[i + 1])) / (flat[j + 1] - flat[i + 1]) + flat[i]) c = !c; } return c; };

test('the data names its source (the GTA 2023 lidar\'s surface over its terrain), and every crown stands on the park\'s islands', () => {
  assert.equal(D.kind, 'high-park-woods');
  assert.match(D.source.dataset, /GTA 2023 lidar/);
  assert.match(D.source.dataset, /Digital Surface Model/);
  assert.match(D.source.dataset, /Digital Terrain Model/);
  assert.match(D.source.licence, /Open Government Licence – Ontario/);
  assert.ok(D.source.tiles.length >= 4 && D.source.tiles.every((t) => /^[0-9a-f]{64}$/.test(t.sha256) && /_DSM$/.test(t.tile)));
  for (const k of ['x0', 'x1', 'z0', 'z1']) assert.equal(D.box[k], C.HIGH_PARK_DATA.box[k]);
  const crowns = W.crowns(), models = new Set(C.GEO.treeModels.map(([id]) => id));
  assert.ok(crowns.length > 5000 && crowns.length < 12000, `${crowns.length} crowns`);
  const ponds = C.GEO.areas.filter(([kind]) => kind === 'water').map(([, , flat]) => flat);
  for (const c of crowns) {
    assert.ok(onPark(c.x, c.z), `a crown off the park's islands at ${c.x}, ${c.z}`);
    assert.ok(c.h >= 5 && c.h < 46 && c.r >= 2 && c.r < 12, `a crown ${c.h} m tall, ${c.r} m wide`);
    assert.ok(models.has(c.model), c.model);
    assert.ok(!ponds.some((f) => inPoly(f, c.x, c.z)), `a crown in a pond at ${c.x}, ${c.z}`);
  }
  // the woods, the ravines' woods and the trees in the open, each well represented; the canopy as the lidar has it
  const woods = crowns.filter((c) => c.woods), ravine = crowns.filter((c) => c.ravine), open = crowns.filter((c) => !c.woods);
  assert.ok(woods.length > 3000 && ravine.length > 1000 && open.length > 500, `${woods.length} woods, ${ravine.length} ravine, ${open.length} open`);
  assert.ok(ravine.every((c) => c.woods));
  assert.ok(D.diagnostics.canopyShare > 0.6 && D.diagnostics.canopyShare < 0.9, `canopy ${D.diagnostics.canopyShare}`);
  // not orchard rows (st-w050): the woods' crowns are as wide as their own edges, not each the share of the way to its
  // nearest neighbour; some stand closer than the window (clumps); the tops sit between the 1 m cells
  const ws = woods.filter((c) => !c.ravine), near = (c) => Math.min(...ws.filter((o) => o !== c && Math.abs(o.x - c.x) < 15 && Math.abs(o.z - c.z) < 15).map((o) => Math.hypot(o.x - c.x, o.z - c.z)));
  const sample = ws.filter((_, n) => n % 7 === 0), nn = sample.map(near);
  const clamped = sample.filter((c, n) => Math.abs(c.r - 0.8 * nn[n]) < 0.11).length / sample.length;
  assert.ok(clamped < 0.4, `${(clamped * 100).toFixed(0)}% of the woods' crowns as wide as their spacing`);
  assert.ok(nn.filter((d) => d < 3).length > 0, 'no two woods\' tops nearer than 3 m');
  assert.ok(crowns.filter((c) => Math.abs(((c.x - D.box.x0) % 1) - 0.5) > 0.05).length > crowns.length / 3, 'the tops on the 1 m cells\' centres');
  // (oaks most of all: the black oak savanna and woodland)
  assert.ok(crowns.filter((c) => c.model.includes('oak')).length > crowns.length / 2);
});

test('the lidar\'s trees replace street-details.js\'s invented ones on the park\'s islands, and change no other site', () => {
  const c0 = W.crowns()[0], tb = C.worldFromLatLon(43.6476, -79.4137); // (Trinity Bellwoods Park)
  const list = [
    { x: c0.x + 1, y: 0.22, z: c0.z, scale: 1, species: 0, tier: 0 }, // invented, on the park: out
    { x: tb.x, y: 0.22, z: tb.z, scale: 1, species: 1, tier: 0 }, // invented, in another park: stays
    { x: c0.x - 1, y: 0.22, z: c0.z, scale: 1, species: 2, tier: 2 }, // not the parkland grid's: stays
    { x: -5000, y: 0.22, z: 0, scale: 0.7, species: 0, tier: 1 }
  ];
  const keep = [list[1], list[2], list[3]].map((t) => ({ ...t }));
  W.replaceTrees(list, 0.22);
  assert.deepEqual(list.slice(0, 3), keep);
  const added = list.slice(3);
  assert.equal(W.stats.replaced, 1);
  assert.equal(added.length, W.stats.crowns);
  assert.ok(added.length > 5000);
  for (const t of added) {
    assert.ok(onPark(t.x, t.z) && t.y === 0.22 && t.tier === 0 && t.model && t.height >= 5 && t.width >= 2);
    assert.ok(t.scale > 0 && [0, 1, 2].includes(t.species), 'the fallback trees (mrdoob\'s) can draw it');
  }
  // (street-details.js hands its sites over once they are all placed; ez-trees.js draws the named model, height & width)
  assert.match(read('street-details'), /window\.CITY\.parkWoods\.replaceTrees\(treePositions, SW_Y\)/);
  const ez = read('ez-trees');
  assert.match(ez, /model: named >= 0 \? named : genModel\(t\.species \|\| 0, h\)/);
  assert.match(ez, /cls\[i\] = t\.woods && !isPine\[i\] \? WOODS_CLASS : tier\[i\] \* 2 \+ isPine\[i\]/);
});

test('the City\'s trees piled on one address point in the park (519 at the Bloor gate) are one tree each; no others go', () => {
  const P = D.cityTreePiles, ST = C.GEO.streetTrees;
  assert.ok(P.length >= 10 && P.some((p) => p[2] > 400), `${P.length} piles`);
  for (const [x, z, n] of P) assert.ok(n >= 3 && onPark(x, z), `a pile of ${n} at ${x}, ${z}`);
  const sites = [];
  for (let i = 0; i < ST.length; i += 4) sites.push({ x: ST[i], z: ST[i + 1], tier: 1 });
  sites.push({ x: P[0][0], z: P[0][1], tier: 0 }); // (not the City's: stays)
  const before = sites.length, dropped = W.dropPiledCityTrees(sites);
  assert.equal(dropped, P.reduce((t, p) => t + p[2] - 1, 0));
  assert.equal(sites.length, before - dropped);
  const key = (x, z) => `${x.toFixed(1)},${z.toFixed(1)}`, piles = new Set(P.map(([x, z]) => key(x, z)));
  // (one of each pile left; every tree off the park's piles, the rest of the city's piles among them, untouched)
  const left = new Map();
  for (const t of sites) if (t.tier === 1 && piles.has(key(t.x, t.z))) left.set(key(t.x, t.z), (left.get(key(t.x, t.z)) || 0) + 1);
  assert.equal(left.size, P.length);
  assert.ok([...left.values()].every((n) => n === 1));
  assert.equal(sites.filter((t) => !piles.has(key(t.x, t.z))).length, ST.length / 4 - P.reduce((t, p) => t + p[2], 0) + 0);
  assert.match(read('ez-trees'), /window\.CITY\.parkWoods \? window\.CITY\.parkWoods\.dropPiledCityTrees\(sites\) : 0/);
});

test('the woods\' trees hand over to their coarser levels nearer than the parks\' (they stand 50-70 to the hectare)', () => {
  const ez = read('ez-trees');
  const share = JSON.parse(ez.match(/const WOODS_SHARE = (\{[^}]+\})/)[1].replace(/(\w+):/g, '"$1":'));
  assert.ok(share.near < 1 && share.mid < 1 && share.shadow < 1, JSON.stringify(share));
  // (every other class keeps its distances: only the woods' class reads the shares)
  assert.match(ez, /const nearOf = \(c\) => \(c === WOODS_CLASS \? NEAR \* WOODS_SHARE\.near : NEAR\);/);
  // (the woods keep their share of MID from street level too: MID_STREET is the other classes', st-z51b)
  assert.match(ez, /const midOf = \(c, low = false\) => \(c === WOODS_CLASS \? MID \* WOODS_SHARE\.mid \* Math\.min\(1, FAR\) : low \? MID_STREET : MID\);/);
});

test('the ground: woodland floor under the canopy and meadow in the savanna, on the park\'s islands only', () => {
  const g = W.groundCover(), { cell, w, h } = D.ground;
  assert.equal(g.W, w); assert.equal(g.H, h);
  let floor = 0, meadow = 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const o = (j * w + i) * 4;
    if (!g.data[o + 3]) { assert.equal(g.data[o] + g.data[o + 1], 0); continue; }
    floor += g.data[o] / 255; meadow += g.data[o + 1] / 255;
    // (a cell on the park: its centre, or one corner at least, on the park's islands)
    const x = D.box.x0 + (i + 0.5) * cell, z = D.box.z0 + (j + 0.5) * cell;
    assert.ok([[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]].some(([a, b]) => onPark(x + a * cell * 0.5, z + b * cell * 0.5)), `ground cover off the park at ${x}, ${z}`);
  }
  // (open floor, st-xk79: only where there is floor; more of it under the savanna's crowns than under the woods')
  const openAt = (x, z) => { const i = Math.floor((x - D.box.x0) / cell), j = Math.floor((z - D.box.z0) / cell); return g.data[(j * w + i) * 4 + 2] / 255; };
  for (let q = 0; q < w * h; q++) if (g.data[q * 4 + 2]) assert.ok(g.data[q * 4] > 0, 'open floor where there is no floor');
  const mean = (cs) => cs.reduce((t, c) => t + openAt(c.x, c.z), 0) / cs.length, cs = W.crowns();
  const openWoods = mean(cs.filter((c) => c.woods && !c.ravine)), openSavanna = mean(cs.filter((c) => !c.woods));
  assert.ok(openWoods < 0.25 && openSavanna > 0.5, `open floor ${openWoods.toFixed(2)} in the woods, ${openSavanna.toFixed(2)} in the open`);
  const ha = (v) => (v * cell * cell) / 1e4;
  assert.ok(ha(floor) > 60 && ha(floor) < 120, `woodland floor ${ha(floor).toFixed(1)} ha`);
  assert.ok(ha(meadow) > 5 && ha(meadow) < 40, `meadow ${ha(meadow).toFixed(1)} ha`);
  // the lawn material takes it through this one hook (outside the box: the lawn's own colour, nothing computed)
  assert.match(read('tsl-materials'), /PW \? PW\.groundNode\(lawn, wp, \{ seasonalGrass, noise2D \}\) : lawn/);
  // (the floor follows the sun's height: golden hour's litter, the high sun's grass where the floor is open)
  assert.match(read('park-woods'), /const noon = smoothstep\(0\.25, 0\.65, normalize\(C\.cityUniforms\.uSkySunDir\)\.y\)/);
  assert.match(read('park-woods'), /If\(uv\.x\.greaterThan\(0\.0\)\.and\(uv\.x\.lessThan\(1\.0\)\)\.and\(uv\.y\.greaterThan\(0\.0\)\)\.and\(uv\.y\.lessThan\(1\.0\)\)/);
});

test('the build is reproducible from the lidar tiles', { skip: !fs.existsSync(path.join(process.env.DON_VALLEY_DTM || path.join(os.homedir(), '.cache/slop-toronto/raw/ontario-dtm-gta2023'), 'manifest-high-park-dsm.json')) && 'no surface model tiles (node tools/fetch-don-valley-dtm.mjs --region high-park --product dsm)' }, () => {
  const out = path.join(os.tmpdir(), `high-park-woods-data-${process.pid}.js`);
  execFileSync(process.execPath, [new URL('../tools/build-high-park-woods.mjs', import.meta.url).pathname, '--out', out], { stdio: 'pipe' });
  assert.equal(fs.readFileSync(out, 'utf8'), read('high-park-woods-data'));
  fs.rmSync(out);
});
