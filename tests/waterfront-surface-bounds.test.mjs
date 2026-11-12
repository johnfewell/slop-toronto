// The waterfront and Biidaasige surface hooks that city-config.js deckHeightAt / deckStoodOn ask on every query (every
// body, every frame, anywhere in the city) reject a point away from their feature at a plan box (st-s1y8). Before the
// boxes, a lookup far from the waterfront cost ~320 us in node (the HTO boardwalk planks and berms walked city-wide); the
// city's own deck grid alone costs ~0.5 us. This builds the real modules on the detail frame and checks both the cost
// far away and that each feature still answers on its own geometry (the box is not too tight).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { unpackGeo } from '../js/geodata-loader.js';

const root = new URL('../', import.meta.url);
const modules = [...fs.readFileSync(new URL('explore.html', root), 'utf8')
  .matchAll(/'\.\/js\/((?:waterfront|biidaasige)-[a-z0-9-]+)\.js'/g)].map((m) => m[1]);

async function city(withFeatures = true) {
  const layers = await unpackGeo(fs.readFileSync(new URL('data/toronto-geodata.bin', root)));
  const ctx = vm.createContext({
    window: { CITY: { ...layers, THREE, TSL, Addons: { mergeGeometries } } },
    console: { info() {}, log() {}, warn() {} }, location: { search: '?map=detail' },
    URLSearchParams, performance, Buffer, atob: (s) => Buffer.from(s, 'base64').toString('binary')
  });
  for (const name of ['high-park-data', 'don-valley', 'city-config', 'city-grid', ...(withFeatures ? modules : [])]) {
    vm.runInContext(fs.readFileSync(new URL('js/' + name + '.js', root), 'utf8'), ctx, { filename: name });
  }
  const C = ctx.window.CITY, scene = new THREE.Scene();
  for (const key of Object.keys(C).filter((k) => /^createWaterfront/.test(k)).sort()) {
    try { C[key](THREE, scene); } catch { /* a builder that cannot run in node leaves its hook inert */ }
  }
  C.parkForTest = C.createBiidaasigePark?.(THREE, scene);
  return C;
}

test('a deck lookup away from the waterfront and the park costs about what the city grid alone costs', async (t) => {
  const C = await city();
  assert.ok(C.waterfrontHtoLandscapeEnabled && C.waterfrontHtoLandscape?.boardwalk?.planks?.length, 'HTO built with its boardwalk');
  // north of Queen Street and west of Bathurst: far from every waterfront and park feature
  const pts = [];
  let s = 7;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 20000; i++) pts.push([-3000 + 2600 * r(), -2400 + 1800 * r()]);
  // (best of five rounds, each timing the same lookups on a city without the waterfront and park modules and then on this
  // one, interleaved: the suite runs its files in parallel, so an absolute time alone would measure the machine's load.
  // Idle, ~1.3 us against ~0.45 us for the grid alone; before the boxes, ~320 us)
  const bare = await city(false);
  const once = (W) => {
    let sink = 0;
    const t0 = performance.now();
    for (const [x, z] of pts) { sink += W.deckHeightAt(x, z, 0, 0.6); if (W.deckStoodOn(x, z, 0, 0.6)) sink++; }
    assert.ok(Number.isFinite(sink));
    return (performance.now() - t0) * 1000 / (pts.length * 2);
  };
  let base = Infinity, withFeatures = Infinity;
  for (let round = 0; round < 5; round++) { base = Math.min(base, once(bare)); withFeatures = Math.min(withFeatures, once(C)); }
  const msg = `deckHeightAt + deckStoodOn far from the features: ${withFeatures.toFixed(2)} us a call; the city grid alone ${base.toFixed(2)} us`;
  t.diagnostic(msg);
  assert.ok(withFeatures < Math.max(2, 5 * base), msg + ' (want under 2 us, or 5x the grid alone on a loaded machine)');
  assert.ok(withFeatures < 6, msg + ' (want < 6 us even on a loaded machine)');
});

test('each surface hook still answers on its own geometry', async () => {
  const C = await city();
  const R = C.waterfrontHtoLandscape;
  for (const pl of R.boardwalk.planks) assert.ok(C.htoLandscapeSurfaceAt(pl.x, pl.z), 'an HTO boardwalk plank centre has footing');
  for (const berm of R.berms) {
    const p = berm.mesh.positions, [i0, i1, i2] = berm.mesh.tris[0];
    const x = (p[i0 * 3] + p[i1 * 3] + p[i2 * 3]) / 3, z = (p[i0 * 3 + 2] + p[i1 * 3 + 2] + p[i2 * 3 + 2]) / 3;
    assert.ok(C.htoLandscapeSurfaceAt(x, z), `HTO berm ${berm.id} answers at a triangle centroid`);
  }
  const garden = C.waterfrontMusicGarden?.surfaces || [];
  assert.ok(garden.length > 0, 'the Music Garden built its surfaces');
  for (const sf of garden) assert.ok(C.waterfrontMusicGardenSurfaceAt(sf.cx, sf.cz), 'a Music Garden surface centre has footing');
  const corridors = C.waterfrontIslandAccess?.surfaces?.corridors || [];
  for (const c of corridors) assert.ok(C.islandAccessSurfaceAt(c.nodes[0][0], c.nodes[0][1]), 'an island access corridor node has footing');
  for (const d of Object.values(C.waterfrontIslandArrivals?.layout?.docks || {})) {
    if (d.point) assert.ok(C.islandArrivalSurfaceAt(d.point[0], d.point[1]), `dock ${d.id} node platform has footing`);
  }
  for (const deck of C.WATERFRONT_WAVEDECKS) {
    const x = deck.plan.reduce((a, p) => a + p[0], 0) / deck.plan.length, z = deck.plan.reduce((a, p) => a + p[1], 0) / deck.plan.length;
    assert.ok(C.waterfrontDeckAt(x, z, 10, 20)?.deck.waterfrontId, `${deck.id} WaveDeck answers at its plan centre`);
  }
  const tris = C.parkForTest?.surfaceTriangles || [];
  assert.ok(tris.length > 0, 'Biidaasige built its walking triangles');
  for (const { t } of tris.filter((_, i) => i % 97 === 0)) {
    const x = (t[0] + t[3] + t[6]) / 3, z = (t[2] + t[5] + t[8]) / 3;
    assert.ok(C.biidaasigeParkSurfaceAt(x, z), 'a Biidaasige walking triangle centroid has footing');
  }
});

test('the island lane gate and the Music Garden keep-outs answer a far point at their boxes', async (t) => {
  const C = await city();
  const pts = [];
  let s = 13;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 20000; i++) pts.push([-3000 + 2600 * r(), -2400 + 1800 * r()]);
  for (const [name, f] of [['islandLaneCentreLineSuppressed', (x, z) => C.islandLaneCentreLineSuppressed(x, z)],
    ['gardenStructureKeepoutAt', (x, z) => C.gardenStructureKeepoutAt(x, z, 0.25)], ['gardenFootprintAt', (x, z) => C.gardenFootprintAt(x, z)]]) {
    let best = Infinity, hits = 0;
    for (let round = 0; round < 5; round++) {
      const t0 = performance.now();
      for (const [x, z] of pts) if (f(x, z)) hits++;
      best = Math.min(best, (performance.now() - t0) * 1000 / pts.length);
    }
    t.diagnostic(`${name}: ${best.toFixed(2)} us a call far from the feature (before the boxes: ~63, ~45 and ~1.2 us)`);
    assert.equal(hits, 0, `${name} answers nothing far from its feature`);
    assert.ok(best < 2, `${name}: ${best.toFixed(2)} us a call (want < 2)`);
  }
  // and still answers on its own geometry
  const lane = C.ISLAND_LANES_DATA.runs.find((run) => run.unmarked === 1);
  assert.ok(C.islandLaneCentreLineSuppressed(lane.points[0][0], lane.points[0][1]), 'an unmarked lane vertex keeps its centre line suppressed');
  const st = C.waterfrontMusicGarden.structures[0];
  assert.ok(C.gardenStructureKeepoutAt(st.cx, st.cz, 0), 'a garden structure centre is kept out');
  const m = C.GEO.landmarks.musicGarden;
  const cx = m.ring.filter((_, i) => i % 2 === 0).reduce((a, v) => a + v, 0) / (m.ring.length / 2);
  const cz = m.ring.filter((_, i) => i % 2 === 1).reduce((a, v) => a + v, 0) / (m.ring.length / 2);
  assert.ok(C.gardenFootprintAt(cx, cz), 'the garden footprint holds its centroid');
});
