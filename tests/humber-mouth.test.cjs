// The Humber's mouth (st-01vq.8, st-01vq.7): every water the street level opens over has a surface drawn on it, the
// river runs into the lake without a bank across its mouth, and the Humber Bay Arch Bridge carries the Martin Goodman
// Trail over it, joined to the trail on both banks.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = (path) => readFileSync(join(__dirname, '..', path), 'utf8');
const context = vm.createContext({ window: { CITY: {} } });
for (const path of ['js/toronto-geodata.js', 'js/city-config.js']) vm.runInContext(read(path), context);
const { GEO, CITY_BOUNDS: B, WATER_BODIES, EDGE_WATERS, TRAIL_BRIDGES, waterAt, blockAt, bankBetween, trailBridgeAt, deckHeightAt, pointInPoly, TELEPORT_LOCATIONS } = context.window.CITY;

// What city-grid.js draws: Lake Ontario (with its islands), the water wholly inside the city, and EDGE_WATERS cut to it
const insideCity = (p) => p.x > B.minX + 5 && p.x < B.maxX - 5 && p.z > B.minZ + 5 && p.z < B.maxZ - 5;
const lake = WATER_BODIES.find((w) => w.holes && w.holes.length);
const drawnAt = (x, z) => {
  const w = waterAt(x, z);
  if (!w) return null;
  if (w === lake) return 'lake';
  if (w.pts.every(insideCity)) return 'pond';
  const e = EDGE_WATERS.find((e) => e.body === w && pointInPoly(e.pts, x, z));
  return e ? (e.open ? 'lake' : 'pond') : null;
};

test('st-01vq.8: every water the street level opens over in the city has a water surface drawn on it', () => {
  let wet = 0;
  const bare = [];
  for (let x = B.minX + 4; x < B.maxX - 4; x += 16) {
    for (let z = B.minZ + 4; z < B.maxZ - 4; z += 16) {
      if (!waterAt(x, z)) continue;
      wet++;
      if (!drawnAt(x, z)) bare.push(`${x},${z}`);
    }
  }
  assert.ok(wet > 50000, `sampled the water (${wet} points)`);
  assert.deepEqual(bare.slice(0, 10), [], `${bare.length} wet points with no water drawn`);
});

test('st-01vq.8: the Humber is the lake\'s own water to its mouth, under the Gardiner\'s and Lake Shore\'s bridges too', () => {
  const humber = EDGE_WATERS.find((e) => pointInPoly(e.pts, -7440, -760));
  assert.ok(humber && humber.open, 'the Humber reaches the lake, drawn as open water');
  // the river under the Gardiner's, Lake Shore's & the Queensway's bridges, in the reach the trail bridge spans, at its mouth
  for (const [x, z] of [[-7600, -880], [-7560, -830], [-7650, -1000], [-7440, -760], [-7445, -680], [-7430, -650]]) assert.equal(drawnAt(x, z), 'lake', `water at ${x},${z}`);
  // the other rivers and channels over the edge: the Ship Channel opens into the harbour, the Don is drawn too
  assert.ok(EDGE_WATERS.some((e) => e.body.name === 'Ship Channel' && e.open));
  assert.ok(EDGE_WATERS.length >= 4);
});

test('st-01vq.8: no bank stands across the Humber\'s mouth, where river and lake meet', () => {
  const across = [];
  for (const ring of [lake.pts, ...EDGE_WATERS.filter((e) => e.open).map((e) => e.pts)]) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      if (mx > -7480 && mx < -7380 && mz > -680 && mz < -590 && Math.hypot(b.x - a.x, b.z - a.z) > 1) across.push(bankBetween(a, b));
    }
  }
  assert.ok(across.length > 0, 'the mouth has edges between the river and the lake');
  assert.ok(across.some((b) => !b), 'the river-lake edge has no bank');
});

test('st-01vq.7: the Humber Bay Arch Bridge spans the mouth on OpenStreetMap\'s line, dry ground at both ends', () => {
  const t = TRAIL_BRIDGES.find((b) => b.name === 'Humber Bay Arch Bridge');
  assert.ok(t);
  assert.ok(t.L > 125 && t.L < 140, `${t.L.toFixed(1)} m long (130-139 m)`);
  assert.ok(Math.abs(t.s1 - t.s0 - 100) < 0.5, 'a 100 m clear span');
  assert.ok(t.wet[1] - t.wet[0] > 60, 'over the water');
  assert.ok(t.s0 < t.wet[0] && t.s1 > t.wet[1], 'the arches spring from the banks');
  for (const p of [t.a, t.b]) assert.ok(!waterAt(p.x, p.z) && blockAt(p.x, p.z), 'its ends on the banks');
  assert.equal(drawnAt(t.a.x + t.ux * (t.L / 2), t.a.z + t.uz * (t.L / 2)), 'lake', 'water under its middle');
});

test('st-01vq.7: the Martin Goodman Trail runs on over the bridge, joined on both banks', () => {
  const t = TRAIL_BRIDGES[0];
  // the red trail's ends on the bridge's line: where the City's trail stops at the water, one on each bank
  const ends = [];
  for (const [, surface, , flat] of GEO.cycling.trails) {
    if (!surface) continue;
    for (const k of [0, flat.length - 2]) {
      const { s, l } = t.local(flat[k], flat[k + 1]);
      if (s >= 0 && s <= t.L && Math.abs(l) < t.trailW / 2) ends.push(s);
    }
  }
  assert.ok(ends.some((s) => s <= t.wet[0] + 2), `the trail from the east reaches the deck (${ends.map((s) => s.toFixed(1))})`);
  assert.ok(ends.some((s) => s >= t.wet[1] - 2), 'the trail from the west reaches the deck');
  // and the deck runs on between them: a rider climbing at most 0.6 m a step stands on it all the way, over the water
  let y = B.sidewalkHeight;
  for (let s = 0.25; s <= t.L - 0.25; s += 0.5) {
    for (const l of [-1.5, 0, 1.5]) {
      const x = t.a.x + t.ux * s - t.uz * l, z = t.a.z + t.uz * s + t.ux * l;
      const h = deckHeightAt(x, z, y, 0.6);
      assert.ok(h > 0, `on the deck at ${s} m`);
      assert.ok(trailBridgeAt(x, z, -0.4), 'within its edges');
      if (l === 0) y = h;
    }
  }
  assert.ok(y < 1, 'down again at the far end');
  assert.ok(Math.max(...Array.from({ length: 131 }, (_, i) => t.heightAt(i))) < 2.5, 'a gentle rise for bicycles');
});

test('st-01vq.7: the ride start stays on the trail east of the bridge, off the water', () => {
  const p = TELEPORT_LOCATIONS.humberArch;
  assert.ok(!trailBridgeAt(p.x, p.z, 0) && !waterAt(p.x, p.z));
  assert.ok(Math.hypot(p.x - TRAIL_BRIDGES[0].a.x, p.z - TRAIL_BRIDGES[0].a.z) < 250, 'by the bridge');
});

test('st-01vq.8: the lake\'s shore is the street level beside its banks, and no tree stands in the water', () => {
  const { terrainHeightAt, treeOffRail } = context.window.CITY;
  const t = TRAIL_BRIDGES[0];
  // the east bank where the bridge lands (SRTM's 2-3 m of trees there rose behind the bank as a slab of terrain)
  for (let s = -20; s <= t.L + 20; s += 5) assert.ok(terrainHeightAt(t.a.x + t.ux * s, t.a.z + t.uz * s) < 0.3, `street level at ${s} m`);
  // inland ponds keep their slopes: High Park's hillside above Grenadier Pond
  let hill = 0;
  for (let x = -6300; x < -5600; x += 20) for (let z = -2000; z < -1200; z += 20) hill = Math.max(hill, terrainHeightAt(x, z));
  assert.ok(hill > 3, `High Park keeps its relief (${hill.toFixed(1)} m)`);
  const ST = GEO.streetTrees;
  for (let i = 0; i < ST.length; i += 4) if (waterAt(ST[i], ST[i + 1])) assert.equal(treeOffRail(ST[i], ST[i + 1]), false);
});
