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

test('st-72lu: the arches\' feet are set into the banks, and the thin steel keeps a pixel\'s width at a distance', async () => {
  const THREE = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
  const ctx = vm.createContext({ window: { CITY: { THREE, TSL, Addons: { mergeGeometries } } }, console: { info() {}, warn() {}, log() {} } });
  for (const path of ['js/toronto-geodata.js', 'js/city-config.js', 'js/humber-arch-bridge.js']) vm.runInContext(read(path), ctx);
  const C = ctx.window.CITY, t = C.TRAIL_BRIDGES[0];
  const { group } = C.buildArchBridge(t);
  // the four plinths: the concrete's boxes on the banks beyond the abutments, out at the arches' feet
  const conc = group.getObjectByName('HumberArchBridge-concrete').geometry.attributes.position;
  const feet = new Map();
  for (let i = 0; i < conc.count; i++) {
    const x = conc.getX(i), y = conc.getY(i), z = conc.getZ(i), { s, l } = t.local(x, z);
    if (Math.abs(l) < t.w / 2 + 1.5 || (s > t.wet[0] && s < t.wet[1])) continue;
    const k = `${s < t.L / 2 ? 'east' : 'west'} ${l < 0 ? 'right' : 'left'}`;
    const f = feet.get(k) || { lo: Infinity, hi: -Infinity, x: 0, z: 0, n: 0 };
    f.lo = Math.min(f.lo, y); f.hi = Math.max(f.hi, y); f.x += x; f.z += z; f.n++; feet.set(k, f);
  }
  assert.equal(feet.size, 4, 'four feet');
  for (const [k, f] of feet) {
    const ground = blockAt(f.x / f.n, f.z / f.n) ? B.sidewalkHeight : 0;
    assert.ok(f.hi > ground && f.hi - ground <= 0.15, `${k}: its top ${(f.hi - ground).toFixed(2)} m over the ground (was 0.48)`);
    assert.ok(f.lo < ground - 0.4, `${k}: its foot in the ground`);
  }
  // the hangers & railings: each vertex knows its piece's radius; the shader widens them, the shadow pass doesn't
  const steel = group.getObjectByName('HumberArchBridge-steel');
  const r = steel.geometry.attributes.steelR;
  assert.ok(r && r.count === steel.geometry.attributes.position.count && [...r.array].every((v) => v > 0.019 && v < 0.061));
  assert.ok(steel.material.positionNode && steel.material.castShadowPositionNode);
  assert.equal(steel.receiveShadow, false, 'the widened steel takes no shadows (they dotted it)');
});

test('st-72lu: the lake\'s night skyline fades out at the open ends of its boxes, not where two boxes meet', async () => {
  const THREE = await import('three/webgpu');
  const TSL = await import('three/tsl');
  const ctx = vm.createContext({ window: { CITY: { THREE, TSL, cityUniforms: {} } }, console: { info() {}, warn() {}, log() {} } });
  vm.runInContext(read('js/pbr-water.js'), ctx);
  const { PBR_SKYLINE: S, pbrSkylineOpenSides: open } = ctx.window.CITY;
  const at = (x, z) => S.findIndex(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1);
  // Humber Bay Shores, west of the Humber's mouth: its east side (over the river) and its north end open, so its
  // reflection no longer stops square under the arch bridge; its west and south sides run on into the next boxes
  const hbs = at(-7700, -700);
  assert.ok(hbs >= 0);
  assert.equal(open(hbs), 2 | 4);
  // downtown's boxes, one 500 m cell beside another: no fade between them
  const fd = at(250, -250);
  assert.equal(open(fd) & (1 | 2), 0, 'the Financial District\'s box runs on east and west');
  assert.ok(S.every((_, i) => open(i) >= 0 && open(i) <= 15));
});
