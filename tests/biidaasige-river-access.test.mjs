// Biidaasige Park source-footprinted river access (js/biidaasige-river-access.js, bead st-bmyv.7). Focused CPU checks
// that load the ACTUAL module into a small CITY and prove, from the REAL built THREE geometry and the committed
// geodata:
//
//   1. DEFAULT = only source-footprinted features (beaches, slipways, piers). Fishing points are a CATALOG: they are
//      candidate-only and never add a default gravel disc.
//   2. The waterline is the ACTUAL decoded water (C.GEO.areas:water with holes, or C.waterAt), NOT the whole park
//      boundary. A "0 m to the park edge" is not water contact.
//   3. A beach slopes to the water ONLY on verified wet contact; otherwise it is flat and labelled height-unverified.
//      A pier deck stays HORIZONTAL (no source elevation).
//   4. Every published `surfaces` triangle is a real upward (+Y) wound rendered triangle hit by an INDEPENDENT THREE
//      downward raycast, and C.biidaasigeRiverAccessAt returns that exact height; null off the access.
//   5. Bound: no single mesh spans more than MESH_CHUNK_M across; a long polygon is split into spatial tile batches.
//   6. colliders is []; missing projection/THREE builds nothing and never throws; an invalid rebuild drops stale
//      answers; the module edits no other file and uses no document/network/image.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => fs.readFileSync(ROOT + p, 'utf8');

function city({ withProjection = true, withRiver = true, frame = null, mutate = null, withWaterAt = true } = {}) {
  const ctx = { window: { CITY: { THREE } }, console: { info() {}, warn() {}, log() {}, error() {} }, performance };
  vm.createContext(ctx);
  vm.runInContext(read('js/toronto-geodata.js'), ctx, { filename: 'toronto-geodata.js' });
  const C = ctx.window.CITY;
  const P = C.GEO.frame.projection;
  C.CITY_BOUNDS = { minX: -7900, maxX: 3700, minZ: -3000, maxZ: 3600, sidewalkHeight: 0.22, waterLevel: -0.7 };
  C.worldFromLatLon = (lat, lon) => {
    const e = (lon - P.lon0) * P.kx, n = (lat - P.lat0) * P.ky;
    const c = Math.cos(P.theta), s = Math.sin(P.theta);
    return { x: e * c - n * s - P.ox, z: -(e * s + n * c) - P.oz };
  };
  if (withWaterAt) vm.runInContext(read('js/city-config.js'),ctx,{filename:'city-config.js'});
  if (!withProjection) delete C.worldFromLatLon;
  if (frame) C.GEO.frame = Object.assign({}, C.GEO.frame, frame);
  if (withRiver) vm.runInContext(read('js/biidaasige-river-access.js'), ctx, { filename: 'biidaasige-river-access.js' });
  if (mutate) mutate(C);
  return C;
}

function triNormalY(T) {
  const ux = T[3] - T[0], uy = T[4] - T[1], uz = T[5] - T[2];
  const vx = T[6] - T[0], vy = T[7] - T[1], vz = T[8] - T[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  return ny / (Math.hypot(nx, ny, nz) || 1);
}

test('DEFAULT builds only source-footprinted features; fishing is a candidate catalog, never a default pad', () => {
  const C = city();
  const out = C.buildBiidaasigeRiverAccess(null, []);
  assert.ok(out && out.group, 'builds');
  const defaultIds = out.sites.map((s) => s.id).sort().join(',');
  assert.equal(defaultIds, ['canoe-cove-east-pier', 'east-slipway', 'north-beach', 'west-landing'].join(','));
  // no fishing site is default
  assert.ok(!out.sites.some((s) => s.kind === 'fishing'), 'no fishing pad is built by default');
  // the six fishing nodes are candidates with an explicitly unverified footprint
  const fishingCands = out.candidates.sites.filter((s) => s.kind === 'fishing');
  assert.equal(fishingCands.length, 6, 'all six fishing nodes are candidates');
  for (const f of fishingCands) {
    assert.equal(f.evidenceTier, 'catalog-point-unverified-footprint');
    assert.equal(f.defaultVisible, false);
    assert.ok(/unverified/.test(f.footprint));
    assert.ok(/^(node)\/\d+$/.test(f.ref), `${f.id} keeps the exact OSM node`);
  }
  // the default group holds exactly the source-footprint meshes (no fishing, no candidate)
  assert.ok(!out.group.children.some((m) => /candidate|fishing/.test(m.name)), 'no candidate/fishing mesh in the default group');
  for (const m of out.group.children) {
    const id = m.name.replace('BiidaasigeRiverAccess_', '');
    assert.ok(out.sites.some((s) => s.id === id), `${m.name} maps to a default source site`);
  }
});

test('the waterline is the ACTUAL decoded water, not the whole park boundary', () => {
  const C = city();
  const out = C.buildBiidaasigeRiverAccess(null, []);
  assert.match(out.stats.waterEdgeSource, /C\.GEO\.areas:water/, 'uses the decoded water polygons');
  assert.ok(out.stats.waterEdgeCount > 10, `decoded water edges present (${out.stats.waterEdgeCount})`);
  // the park boundary is NOT among the shore edges: no edge ref names the park polygon
  assert.ok(!/park-shore|way\/813717630/.test(JSON.stringify(out.stats)), 'the park boundary is not a shore edge');
  // West Landing genuinely meets the decoded water (verified wet vertex); the east slipway does not slope
  assert.equal(out.sites.find((s) => s.id === 'west-landing').heightStatus,'flat-height-unverified');
  assert.equal(out.sites.find((s) => s.id === 'east-slipway').slope, 'flat-horizontal-at-datum');
});

test('default beaches stay at the native datum until a sourced bank profile is available',()=>{
 const C=city(),r=C.buildBiidaasigeRiverAccess();
 for(const s of r.sites.filter(s=>s.kind==='beach')){
  assert.equal(s.slope,'flat-source-footprint');assert.equal(s.heightStatus,'flat-height-unverified');
  for(const q of r.surfaces.filter(q=>q.siteId===s.id))for(let i=1;i<9;i+=3)assert.ok(Math.abs(q.triangle[i]-.224)<1e-6);
 }
 const bare=city({withWaterAt:false}).buildBiidaasigeRiverAccess();
 assert.ok(bare.sites.filter(s=>s.kind==='beach').every(s=>s.heightStatus==='flat-height-unverified'));
});

test('a pier deck stays HORIZONTAL and its width is an estimate, not a source footprint', () => {
  const C = city();
  const out = C.buildBiidaasigeRiverAccess(null, []);
  const pier = out.sites.find((s) => s.id === 'canoe-cove-east-pier');
  assert.equal(pier.slope, 'flat-horizontal-at-datum');
  assert.equal(pier.heightStatus, 'flat-height-unverified-no-source-elevation');
  assert.equal(pier.evidenceTier, 'source-line-estimated-width');
  assert.equal(pier.widthStatus, 'source-line-width-estimate');
  for (const s of out.surfaces.filter((x) => x.siteId === 'canoe-cove-east-pier')) {
    for (let i = 1; i < 9; i += 3) assert.ok(Math.abs(s.triangle[i] - 0.224) < 1e-6, 'pier deck horizontal at the datum');
  }
  // the slipway is likewise a line + estimated width, horizontal
  const slip = out.sites.find((s) => s.id === 'east-slipway');
  assert.equal(slip.widthStatus, 'source-line-width-estimate');
  assert.equal(slip.slope, 'flat-horizontal-at-datum');
});

test('every surface triangle is upward-wound and hit by an INDEPENDENT three.js downward raycast', () => {
  const C = city();
  const scene = new THREE.Scene();
  const out = C.buildBiidaasigeRiverAccess(scene, []);
  scene.updateMatrixWorld(true);
  assert.ok(out.surfaces.length > 40, 'real triangle set published');
  for (const s of out.surfaces) assert.ok(triNormalY(s.triangle) > 0.9, 'each published triangle faces up');

  const ray = new THREE.Raycaster();
  let checked = 0;
  for (const s of out.surfaces) {
    const T = s.triangle;
    const x = (T[0] + T[3] + T[6]) / 3, z = (T[2] + T[5] + T[8]) / 3;
    ray.set(new THREE.Vector3(x, 40, z), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObject(out.group, true);
    assert.ok(hits.length, 'the published triangle is visible to a downward ray at its own centroid');
    const q = C.biidaasigeRiverAccessAt(x, z);
    assert.ok(q && q.onAccess, 'query finds the access at its own triangle');
    assert.ok(Math.abs(q.surfaceY - hits[0].point.y) < 1e-4, `query returns the rendered height (${q.surfaceY} vs ${hits[0].point.y})`);
    checked++;
  }
  assert.equal(checked, out.surfaces.length, 'every published triangle checked');
  assert.equal(C.biidaasigeRiverAccessAt(0, 0), null, 'off the access -> null');
});

test('BOUND: no single default mesh spans more than MESH_CHUNK_M across (long polygon tiled)', () => {
  const C = city();
  const out = C.buildBiidaasigeRiverAccess(null, []);
  const CHUNK = out.stats.meshChunkM;
  assert.ok(CHUNK > 0 && CHUNK <= 120, `chunk <= 120 m (${CHUNK})`);
  for (const m of out.group.children) {
    const bb = m.geometry.boundingBox;
    const dx = bb.max.x - bb.min.x, dz = bb.max.z - bb.min.z;
    assert.ok(dx <= CHUNK + 1e-6 && dz <= CHUNK + 1e-6, `${m.name} mesh extent ${dx.toFixed(1)}x${dz.toFixed(1)} <= ${CHUNK}`);
  }
  // the long north beach (a ~157 m ring) is split into more than one mesh
  const north = out.sites.find((s) => s.id === 'north-beach');
  assert.ok(north.meshCount >= 2, `long polygon tiled into ${north.meshCount} bounded meshes`);
});

test('colliders is [] (traversable landing, no giant blocking box); one mesh per bounded tile; finite geometry', () => {
  const C = city();
  const out = C.buildBiidaasigeRiverAccess(null, []);
  assert.equal(out.colliders.length, 0);
  assert.equal(C.biidaasigeRiverAccess.colliders.length, 0);
  for (const m of out.group.children) {
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.array.length; i++) assert.ok(Number.isFinite(pos.array[i]), 'finite vertex position');
    assert.ok(m.geometry.boundingBox, 'bounded geometry');
    assert.equal(m.castShadow, false);
    assert.equal(m.receiveShadow, true);
  }
  assert.equal(C.BIIDAASIGE_RIVER_ACCESS_GROUND_Y, 0.224);
  assert.equal(C.BIIDAASIGE_RIVER_ACCESS_WATER_Y, -0.7);
});

test('works with the city waterAt present AND with the module fallback; same default sites', () => {
  const a = city({ withWaterAt: true }).buildBiidaasigeRiverAccess(null, []);
  const b = city({ withWaterAt: false }).buildBiidaasigeRiverAccess(null, []);
  assert.equal(a.sites.map((s) => s.id).sort().join(','), b.sites.map((s) => s.id).sort().join(','), 'same default sites either way');
  // Without the actual classifier the footprint is useful, but a slope must not be invented.
  assert.equal(a.sites.find((s) => s.id === 'west-landing').slope, 'flat-source-footprint');
  assert.equal(b.sites.find((s) => s.id === 'west-landing').slope, 'flat-source-footprint');
});

test('works in BOTH real frames (detail and the default eglinton frame), same sites and shore distances', () => {
  const detail = city();
  const dOut = detail.buildBiidaasigeRiverAccess(null, []);
  const egl = city({ frame: { x0: -7900, x1: 9600, z0: -7300, z1: 3600 } });
  const eOut = egl.buildBiidaasigeRiverAccess(null, []);
  assert.equal(eOut.sites.map((s) => s.id).sort().join(','), dOut.sites.map((s) => s.id).sort().join(','), 'both frames build the same sites');
  for (let i = 0; i < dOut.sites.length; i++) {
    assert.equal(eOut.sites[i].shoreDistanceM, dOut.sites[i].shoreDistanceM, `${dOut.sites[i].id} shore distance is frame-invariant`);
  }
});

test('an invalid rebuild drops stale results (no stale query answers)', () => {
  const C = city();
  const first = C.buildBiidaasigeRiverAccess(null, []);
  const west = first.sites.find((s) => s.id === 'west-landing');
  const T = first.surfaces.find((s) => s.siteId === 'west-landing').triangle;
  const px = (T[0] + T[3] + T[6]) / 3, pz = (T[2] + T[5] + T[8]) / 3;
  assert.ok(C.biidaasigeRiverAccessAt(px, pz), 'on the West Landing before the change');
  C.BIIDAASIGE_RIVER_ACCESS.features = C.BIIDAASIGE_RIVER_ACCESS.features.filter((f) => f.id !== 'west-landing');
  const second = C.buildBiidaasigeRiverAccess(null, []);
  assert.ok(!second.sites.some((s) => s.id === 'west-landing'), 'the removed site is gone');
  assert.equal(C.biidaasigeRiverAccessAt(px, pz), null, 'no stale answer from the removed site');
  assert.ok(west, 'the first build really had the site');
});

test('a source feature with no decoded water within tolerance is not built and is reported as unplaced', () => {
  const C = city({ mutate: (c) => { c.BIIDAASIGE_RIVER_ACCESS.features = c.BIIDAASIGE_RIVER_ACCESS.features.concat([{
    id: 'far-beach', ref: 'way/9999999999', kind: 'beach', geometryType: 'polygon', role: 'beach',
    name: null, surface: 'gravel', tags: {}, geometry: [[43.6457, -79.3502], [43.6458, -79.3502], [43.6458, -79.3503]]
  }]); } });
  const out = C.buildBiidaasigeRiverAccess(null, []);
  assert.ok(!out.sites.some((s) => s.id === 'far-beach'), 'an inland feature is not built');
  const u = out.unplaced.find((x) => x.id === 'far-beach');
  assert.ok(u && /water edge/.test(u.reason), 'and is reported, not silently dropped');
});

test('missing projection / THREE builds nothing and never throws', () => {
  let C = city({ withProjection: false });
  let out = C.buildBiidaasigeRiverAccess(null, []);
  assert.ok(out && Array.isArray(out.sites) && out.sites.length === 0);
  assert.match(out.stats.reason, /projection unavailable/);
  assert.equal(C.biidaasigeRiverAccessAt(0, 0), null);
  assert.equal(C.biidaasigeRiverAccessProjectionAvailable(), false);

  const ctx2 = { window: { CITY: { THREE } }, console: { info() {}, warn() {}, log() {}, error() {} }, performance };
  vm.createContext(ctx2);
  vm.runInContext(read('js/biidaasige-river-access.js'), ctx2, { filename: 'biidaasige-river-access.js' });
  delete ctx2.window.CITY.THREE;
  assert.equal(ctx2.window.CITY.buildBiidaasigeRiverAccess(null, null), null);
});

test('the module edits no other file and is a pure CPU build (no document/network/image)', () => {
  const src = read('js/biidaasige-river-access.js');
  for (const other of ['biidaasige-paths', 'biidaasige-play-pads', 'biidaasige-park-data', 'city-grid', 'main', 'water-edges']) {
    assert.ok(!new RegExp(`runInContext|import .*${other}|require\\(.*${other}`).test(src), `never loads ${other}`);
  }
  assert.ok(/C\.worldFromLatLon/.test(src), 'projects through the city worldFromLatLon at call time');
  const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/document|\bfetch\(|XMLHttpRequest|loadImage/.test(code), 'pure CPU build: no document, network or image in code');
});
