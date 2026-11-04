// High Park's features (docs/high-park-features.md, st-5yps): the paths, gardens, paddocks, fences, fountains, Colborne
// Lodge and its coach house laid on the park's terrain, the park's trees kept off them, its car-free roads kept free of
// cars, and nothing outside the park's box
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const read = (f) => fs.readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8');
function city(files = [], search = '') {
  const context = vm.createContext({ window: { CITY: { THREE, TSL, Addons: { mergeGeometries }, DEBUG_ROADS: false, QUALITY: { surfaceWear: 2, storefronts: 2 } }, addEventListener() {} },
    document: { addEventListener() {}, hidden: false }, location: { search }, URLSearchParams, Intl, performance, console: { info() {}, warn() {}, log() {} }, atob });
  for (const f of ['toronto-geodata', 'toronto-subway', 'toronto-subway-topology', 'high-park-data', 'don-valley', 'city-config', ...files]) vm.runInContext(read(f), context);
  return context.window.CITY;
}
const C = city(['tsl-materials', 'high-park-features-data', 'high-park-features']);
const F = C.HIGH_PARK_FEATURES, DV = C.DON_VALLEY, BOX = DV.boxes.find((b) => b.kind === 'high-park');
const pairs = (f) => { const p = []; for (let i = 0; i + 1 < f.length; i += 2) p.push([f[i], f[i + 1]]); return p; };
const SWH = C.CITY_BOUNDS.sidewalkHeight;
const scene = new THREE.Scene();
const built = C.buildHighParkFeatures(scene);

test('the data: OpenStreetMap\'s paths, areas, fences, Colborne Lodge and the closed roads, all in the park', () => {
  assert.match(F.source, /OpenStreetMap/);
  assert.ok(F.paths.length > 200 && F.diagnostics.pathKm > 20, `${F.paths.length} paths, ${F.diagnostics.pathKm} km`);
  const kinds = new Set(F.areas.map((a) => a[0]));
  for (const k of ['zoo', 'dogs', 'bed', 'garden', 'fountain', 'labyrinth', 'allotments', 'parking', 'amphitheatre']) assert.ok(kinds.has(k), `an area of kind ${k}`);
  assert.ok(F.areas.some((a) => a[0] === 'dogs' && a[1] === 'Dog Hill'));
  assert.ok(F.areas.some((a) => a[0] === 'garden' && a[1] === 'High Park Maple Leaf'));
  assert.deepEqual(Array.from(F.buildings, (b) => b[0]).sort(), ['coach-house', 'colborne-lodge']);
  // every path and area point is on one of the park's islands (the paths 0.6 m in from the kerb, off the water)
  const islands = C.BLOCKS.filter((b) => b.parkName === 'High Park');
  const onIsland = (x, z) => islands.some((b) => C.blockAt(x, z) === b);
  for (const [, , ...f] of F.paths) for (const [x, z] of pairs(f)) assert.ok(onIsland(x, z) && !C.waterAt(x, z), `path point ${x}, ${z}`);
  // the Colborne Lodge's footprint is where OpenStreetMap's node for it is (43.64036, -79.46000)
  const L = pairs(F.buildings.find((b) => b[0] === 'colborne-lodge').slice(1)), at = C.worldFromLatLon(43.64036, -79.46);
  const cx = L.reduce((s, p) => s + p[0], 0) / L.length, cz = L.reduce((s, p) => s + p[1], 0) / L.length;
  assert.ok(Math.hypot(cx - at.x, cz - at.z) < 10, `lodge at ${cx.toFixed(1)}, ${cz.toFixed(1)}`);
  // the closures: West Road and Colborne Lodge Drive's middle at all times, the rest of the park's roads on weekends
  const always = new Set(F.closures.filter((c) => c[0] === 0).map((c) => c[1])), weekend = new Set(F.closures.filter((c) => c[0] === 1).map((c) => c[1]));
  for (const n of ['West Road', 'Colborne Lodge Drive']) assert.ok(always.has(n), `${n} closed at all times`);
  for (const n of ['Centre Road', 'Deer Pen Road', 'Spring Road', 'Colborne Lodge Drive']) assert.ok(weekend.has(n), `${n} closed on weekends`);
});

test('the features are built in the park\'s box only, the flat layers on the lawn\'s draped surface', () => {
  assert.ok(built, 'built');
  const s = built.stats;
  assert.ok(s.lodge && s.fountains === 3 && s.animals >= 15 && s.posts > 1000, JSON.stringify(s));
  let flatVerts = 0, worst = 0;
  built.group.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    if (o.isInstancedMesh) { o.computeBoundingBox(); bb.copy(o.boundingBox); }
    assert.ok(bb.min.x > BOX.x0 && bb.max.x < BOX.x1 && bb.min.z > BOX.z0 && bb.max.z < BOX.z1, `${o.name} inside the box`);
    if (!o.parent || o.parent.name !== 'HighParkFeatureGround') return;
    // (a draped layer: every vertex its layer's few centimetres over the lawn, 0.22 m over the pilot's ground)
    const p = o.geometry.attributes.position;
    const idx = o.geometry.index;
    const used = idx ? new Set(idx.array) : null;
    for (let i = 0; i < p.count; i++) {
      if (used && !used.has(i)) continue;
      const d = p.getY(i) - DV.heightAt(p.getX(i), p.getZ(i)) - SWH;
      worst = Math.max(worst, Math.abs(d - 0.045));
      flatVerts++;
    }
  });
  assert.ok(flatVerts > 10000, `${flatVerts} draped vertices`);
  assert.ok(worst < 0.03, `the layers within 3 cm of their height over the lawn (worst ${worst.toFixed(3)})`);
  assert.ok(s.triangles < 400000, `${s.triangles} triangles`);
});

test('Colborne Lodge and its coach house stand on their bluff: floor over the highest ground, plinth to the lowest', () => {
  const lodge = built.group.getObjectByName('ColborneLodge'), roof = built.group.getObjectByName('ColborneLodgeRoof');
  assert.ok(lodge && roof && built.group.getObjectByName('ColborneCoachHouse'));
  const ring = pairs(F.buildings.find((b) => b[0] === 'colborne-lodge').slice(1));
  const hi = Math.max(...ring.map(([x, z]) => DV.heightAt(x, z) + SWH));
  roof.geometry.computeBoundingBox(); lodge.geometry.computeBoundingBox();
  // (the lodge stands about 12 m over the street level, docs/high-park-terrain.md; its ridge some 10 m over its floor)
  assert.ok(hi > 8 && hi < 16, `ground ${hi.toFixed(1)}`);
  assert.ok(roof.geometry.boundingBox.max.y > hi + 8 && roof.geometry.boundingBox.max.y < hi + 14, `ridge ${roof.geometry.boundingBox.max.y.toFixed(1)}`);
  assert.ok(lodge.geometry.boundingBox.min.y <= Math.min(...ring.map(([x, z]) => DV.heightAt(x, z) + SWH)), 'the plinth reaches the lowest ground');
  // solid to the player
  assert.ok(built.colliders.filter((c) => c.polygon && c.maxY > hi + 6).length >= 3, 'the lodge, its wing and the coach house collide');
});

test('the park\'s trees keep off the paths, beds and buildings; nothing changes outside the park', () => {
  const [, w, x0, z0, x1, z1] = F.paths.find((p) => p[0] === 0 && p.length >= 6);
  assert.ok(C.highParkFeatureAt((x0 + x1) / 2, (z0 + z1) / 2, 0), 'on a paved path');
  const ring = pairs(F.buildings.find((b) => b[0] === 'colborne-lodge').slice(1));
  assert.ok(C.highParkFeatureAt(ring[0][0], ring[0][1], 0), 'on Colborne Lodge');
  assert.equal(C.highParkFeatureAt(0, 0, 5), false, 'Union Station is no park feature');
  assert.equal(C.highParkFeatureAt(-6800, -1600, 1), false, 'Grenadier Pond\'s water');
  assert.ok(w > 0);
});

test('the materials build to WGSL', async () => {
  const renderer = new THREE.WebGPURenderer({ canvas: { addEventListener() {}, style: {}, getContext: () => null } });
  renderer.backend.device = { limits: { maxUniformBufferBindingSize: 65536, maxStorageBufferBindingSize: 1 << 27 }, features: new Set() };
  renderer.hasFeature = () => false;
  renderer._bindings = undefined;
  const seen = new Set();
  built.group.traverse((o) => {
    if (!o.isMesh || seen.has(o.material)) return;
    seen.add(o.material);
    const b = new THREE.WGSLNodeBuilder(o, renderer);
    b.scene = new THREE.Scene(); b.camera = new THREE.PerspectiveCamera();
    b.build();
    assert.ok(b.fragmentShader.length > 100, o.name);
  });
  assert.ok(seen.size >= 15, `${seen.size} materials`);
});

test('the park roads closed to cars: always West Road and Colborne Lodge Drive\'s middle, every park road on a weekend', () => {
  const R = city(['toronto-traffic-data', 'road-network', 'high-park-features-data', 'high-park-features']);
  const day = R.buildRoadNetwork([], []), end = R.buildRoadNetwork([], []);
  const before = day.edges.map((e) => !!e.busOnly);
  const a = R.closeHighParkRoads(day, { weekend: false }), b = R.closeHighParkRoads(end, { weekend: true });
  assert.ok(a.closed > 5 && b.closed > a.closed, JSON.stringify({ a, b }));
  // nothing outside the park's box changes
  day.edges.forEach((e, i) => { if (!DV.inBox(e.sx, e.sz)) assert.equal(!!e.busOnly, before[i]); });
  // West Road is closed; Centre Road open on a weekday, closed on a weekend
  // (the edges whose middle lies within 3 m of the middle of the named road's longest mapped way)
  const mid = (name, when) => { const l = F.closures.filter((c) => c[1] === name && c[0] === when).sort((p, q) => q.length - p.length)[0]; const P = pairs(l.slice(2)); return P[Math.floor(P.length / 2)]; };
  const near = (N, [x, z]) => N.edges.filter((e) => Math.hypot(e.sx + e.dx * e.len * 0.5 - x, e.sz + e.dz * e.len * 0.5 - z) < 30 && [0.25, 0.5, 0.75].some((t) => Math.hypot(e.sx + e.dx * e.len * t - x, e.sz + e.dz * e.len * t - z) < 6));
  const west = near(day, mid('West Road', 0)), centre = near(day, mid('Centre Road', 1));
  assert.ok(west.length && west.every((e) => e.busOnly), `West Road closed (${west.length} edges)`);
  assert.ok(centre.length && centre.every((e) => !e.busOnly), `Centre Road open on a weekday (${centre.length} edges)`);
  assert.ok(near(end, mid('Centre Road', 1)).every((e) => e.busOnly), 'Centre Road closed on a weekend');
  // no open edge is a trap: every open edge in the box can still leave it on open edges
  for (const N of [day, end]) {
    const open = N.edges.filter((e) => !e.busOnly);
    const out = new Set(open.filter((e) => !DV.inBox(e.sx, e.sz)));
    let grew = true;
    while (grew) { grew = false; for (const e of open) if (!out.has(e) && (e.moves || []).some((m) => out.has(m.to))) { out.add(e); grew = true; } }
    for (const e of open) assert.ok(out.has(e), `edge at ${e.sx.toFixed(0)}, ${e.sz.toFixed(0)} can leave`);
  }
  // (the day: a preset opens on a weekday, the live date's weekday otherwise; ?parkroads= overrides)
  assert.equal(R.highParkTorontoWeekend(), false);
  assert.equal(city(['high-park-features-data', 'high-park-features'], '?parkroads=weekend').highParkTorontoWeekend(), true);
});
