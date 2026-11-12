// Biidaasige everyday furniture (bead st-bmyv.5, after the captain's source correction): the factories are pure,
// 1 unit = 1 m, Y-up, local origin at the ground contact point, footprint centred on x/z; the layout adapter reads only
// verified positions from the current Biidaasige inventory API (js/biidaasige-park-data.js) and the real City Open Data
// water stations, and never invents a count or a layout. These tests pin the geometry, the real glTF loader path, the
// bounded merged-geometry draw counts, the collider bounds, the fitness correction and the dedupe contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const PROJ = (() => {
  const ctx = { window: { CITY: {} } };
  vm.runInNewContext(read('js/toronto-geodata.js'), ctx);
  return ctx.window.CITY.GEO.frame.projection;
})();
function worldFromLatLon(lat, lon) {
  const e = (lon - PROJ.lon0) * PROJ.kx, n = (lat - PROJ.lat0) * PROJ.ky;
  const c = Math.cos(PROJ.theta), s = Math.sin(PROJ.theta);
  return { x: e * c - n * s - PROJ.ox, z: -(e * s + n * c) - PROJ.oz };
}

// The real current inventory (st-bmyv.1) + the City water stations, the same sources the runtime reads.
function city({ inventory = true, water = true } = {}) {
  const CITY = { THREE, Addons: { mergeGeometries }, CITY_BOUNDS: { sidewalkHeight: 0.22 }, worldFromLatLon };
  const ctx = { window: { CITY }, console };
  if (water) vm.runInNewContext(read('js/toronto-city-facilities.js'), ctx);
  if (inventory) vm.runInNewContext(read('js/biidaasige-park-data.js'), ctx);
  vm.runInNewContext(read('js/biidaasige-amenities.js'), ctx);
  return CITY;
}

const S = (C) => C.BIIDAASIGE_AMENITY_SIZES;
const F = (C) => C.biidaasigeAmenityFactories;

function measure(group) {
  const box = new THREE.Box3();
  group.updateWorldMatrix(true, true);
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  return { box, size, center };
}
function assertFinite(group, label) {
  group.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) assert.ok(Number.isFinite(pos.getX(i)) && Number.isFinite(pos.getY(i)) && Number.isFinite(pos.getZ(i)), `${label}: finite vertex ${i}`);
  });
}

test('factories: pure, finite, base on y=0, footprint centred, sizes match the recorded estimates', () => {
  const C = city();
  const f = F(C), size = S(C);
  const cases = [
    ['buildParkBench', { w: size.bench.w, h: size.bench.h, d: size.bench.d }],
    ['buildBikeRack', { w: size.rack.w, h: size.rack.h }],
    ['buildDrinkingFountain', { w: size.fountain.w, h: size.fountain.h, d: size.fountain.d }],
    ['buildPicnicTable', { w: size.table.w, h: size.table.h, d: size.table.d + 2 * (size.table.benchInset + size.table.benchW) }],
    ['buildBarbecue', { w: size.barbecue.diameter, h: size.barbecue.h, d: size.barbecue.diameter }],
    ['buildTrashBin', { w: size.bin.w, h: size.bin.h, d: size.bin.d }],
    ['buildFitnessStation', { w: size.fitness.w, h: size.fitness.h }]
  ];
  for (const [name, want] of cases) {
    const g = f[name](THREE);
    assert.ok(g && g.isGroup, `${name} returns a Group`);
    assertFinite(g, name);
    const { box, size: dim, center } = measure(g);
    assert.ok(Math.abs(box.min.y) < 0.02, `${name}: base at y=0 (${box.min.y.toFixed(3)})`);
    assert.ok(Math.abs(center.x) < 0.05, `${name}: footprint centred x`);
    assert.ok(Math.abs(dim.x - want.w) < 0.12, `${name}: width ${dim.x.toFixed(2)} vs ${want.w}`);
    assert.ok(Math.abs(dim.y - want.h) < 0.12, `${name}: height ${dim.y.toFixed(2)} vs ${want.h}`);
    if (want.d) assert.ok(Math.abs(center.z) < 0.08 && Math.abs(dim.z - want.d) < 0.12, `${name}: depth ${dim.z.toFixed(2)} vs ${want.d}`);
  }
  const dog = f.buildDrinkingFountain(THREE, { dogBowl: true });
  assertFinite(dog, 'dogFountain');
  const dm = measure(dog);
  assert.ok(dm.size.x > size.fountain.w, 'dog fountain adds the bowl to the side');
  assert.ok(Math.abs(dm.size.y - size.fountain.h) < 0.12, 'dog fountain stays the station height');
});

test('merged geometry is bounded: a single bench of many boxes becomes ONE mesh per material, not one per box', () => {
  const C = city();
  // The raw bench is built from several separate boxes; merging collapses them per material colour.
  const raw = F(C).buildParkBench(THREE);
  let rawMeshes = 0; raw.traverse((o) => { if (o.isMesh) rawMeshes++; });
  assert.ok(rawMeshes >= 6, `raw bench is ${rawMeshes} boxes`);
  const parts = F(C).flatten(THREE, () => F(C).buildParkBench(THREE));
  assert.ok(parts.length <= 2, `merged bench is at most 2 material parts (${parts.length})`);
  for (const p of parts) {
    p.geometry.computeBoundingBox();
    const tris = p.geometry.index ? p.geometry.index.count / 3 : p.geometry.attributes.position.count / 3;
    assert.ok(Number.isFinite(tris) && tris > 0, 'each part has real geometry');
  }
  // The assembled layer's per-kind material count stays small (draw calls = instanced meshes per material).
  const out = C.buildBiidaasigeAmenities(new THREE.Scene(), []);
  for (const [kind, n] of Object.entries(out.stats.materials)) assert.ok(n <= 2, `${kind}: ${n} material parts (bounded)`);
  const drip = (kind) => C.buildBiidaasigeAmenities(new THREE.Scene(), [], { skipAssets: [kind] });
  const hoof = drip('benches');
  assert.ok(hoof.stats.skipped.includes('benches'), 'skipAssets skips the shared kind');
});

test('layout: reads the CURRENT inventory API and places only verified OSM points, inside their colliders', () => {
  const C = city();
  const out = C.buildBiidaasigeAmenities(new THREE.Scene(), []);
  assert.ok(out && out.stats.projected, 'projects through window.worldFromLatLon');
  // Counts equal the verified OSM features of each kind (the same list the inventory publishes).
  const feats = C.biidaasigeParkFeatures();
  // `biidaasigeParkFeatures()` exposes features by the inventory's `kind`; the adapter maps them to its groups.
  const groupCount = (group, kind) => feats.filter((f) => f.kind === kind).length;
  assert.equal(out.stats.counts.benches, groupCount('benches', 'bench'), 'benches = verified OSM benches');
  assert.equal(out.stats.counts.picnicTables, groupCount('picnicTables', 'picnic-table'), 'picnic tables = verified OSM tables');
  assert.equal(out.stats.counts.barbecues, groupCount('barbecues', 'bbq'), 'barbecues = verified OSM barbecues');
  assert.equal(out.stats.counts.bins, groupCount('bins', 'bin'), 'bins = verified OSM bins');
  assert.equal(out.stats.counts.mappedDogOlas, 2, 'both verified OSM dog-OLA rings');
  // Every instance lands inside a collider of its own kind.
  const m = new THREE.Matrix4(), p = new THREE.Vector3();
  for (const mesh of out.group.children) {
    if (!mesh.isInstancedMesh) continue;
    const kind = mesh.name.replace('BiidaasigeAmenities_', '');
    if (!['benches', 'picnicTables', 'barbecues', 'bins', 'fountain', 'dogFountain'].includes(kind)) continue;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m); p.setFromMatrixPosition(m);
      const c = out.colliders.find((c) => c.kind === kind && p.x >= c.minX - 1e-3 && p.x <= c.maxX + 1e-3 && p.z >= c.minZ - 1e-3 && p.z <= c.maxZ + 1e-3);
      assert.ok(c, `${kind} instance ${i} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) is inside a collider`);
    }
  }
  // Unknown gate positions leave the mapped turf traversable, never one solid
  // collider filling the entire dog park. Fence/gate completion remains explicit.
  assert.ok(!out.colliders.some(c=>c.kind==='dogOla'),'no whole-park interior blocker');
  const turf=out.group.children.find(g=>g.name==='BiidaasigeAmenities_DogOla');
  assert.ok(turf && turf.position.y > .22,'mapped turf is above the lawn');

});

test('real-data adapter: every furniture kind is placed at its REAL inventory count (18 picnic tables, not mock shapes)', () => {
  const C = city();
  const out = C.buildBiidaasigeAmenities(new THREE.Scene(), []);
  const feats = C.biidaasigeParkFeatures();
  // The exact counts from the current data file, spelled the way the data spells them.
  assert.equal(feats.filter((f) => f.kind === 'picnic-table').length, 18, 'the inventory has 18 picnic tables');
  assert.equal(out.stats.counts.picnicTables, 18, 'the adapter places all 18 picnic tables (the hyphenated kind matched)');
  assert.equal(out.stats.counts.benches, feats.filter((f) => f.kind === 'bench').length);
  assert.equal(out.stats.counts.bins, feats.filter((f) => f.kind === 'bin').length);
  assert.equal(out.stats.counts.barbecues, feats.filter((f) => f.kind === 'bbq').length);
});

test('delegating corrected dog surfaces suppresses only successfully replaced whole-area turf', () => {
  const C=city();
  const partial=C.buildBiidaasigeAmenities(new THREE.Scene(),[],{skipDogAreaIds:['dogs-east-1200']});
  assert.equal(partial.group.children.filter(g=>g.name==='BiidaasigeAmenities_DogOla').length,1,'unreplaced west area retains fallback');
  const all=C.buildBiidaasigeAmenities(new THREE.Scene(),[],{skipDogAreaIds:['dogs-east-1200','dogs-west-800']});
  assert.equal(all.group.children.filter(g=>g.name==='BiidaasigeAmenities_DogOla').length,0,'old whole-area turf cannot cover the corrected asphalt');
  assert.equal(all.stats.counts.picnicTables,18,'furniture remains placed');
});

test('draw calls are bounded: one InstancedMesh per material per furniture kind, DogOLA merged to few meshes, local origin', () => {
  const C = city();
  const out = C.buildBiidaasigeAmenities(new THREE.Scene(), []);
  const byKind = new Map();
  const m = new THREE.Matrix4(), p = new THREE.Vector3();
  let maxLocal = 0;
  for (const child of out.group.children) {
    const kind = child.name.replace('BiidaasigeAmenities_', '');
    byKind.set(kind, (byKind.get(kind) || 0) + 1);
    child.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const a = o.geometry.attributes.position;
      for (let i = 0; i < a.count; i++) maxLocal = Math.max(maxLocal, Math.abs(a.getX(i)), Math.abs(a.getZ(i)));
    });
  }
  for (const [kind, n] of byKind) {
    if (kind === 'DogOla') continue;
    assert.ok(n <= 2, `${kind}: ${n} instanced meshes (≤2 materials, not one per instance)`);
  }
  // A DogOLA is one group (turf + merged fence parts), not ~2500 picket meshes.
  for (const ola of out.group.children.filter((c) => /DogOla/.test(c.name))) {
    let meshes = 0; ola.traverse((o) => { if (o.isMesh) meshes++; });
    assert.ok(meshes <= 5, `a dog-OLA is ${meshes} meshes (merged), not one per picket`);
    assert.ok(Math.abs(ola.position.x) > 1000 && Math.abs(ola.position.z) > 100, 'the group carries the world offset in its position');
  }
  // Local vertices never carry the million-scale world coordinates (…hundreds, not thousands).
  assert.ok(maxLocal < 200, `local vertices bounded (${maxLocal.toFixed(1)} m)`);
});

test('dog-OLA accessibility: open entry with no verified gate; turf covers the interior; the fence never seals the park', () => {
  const C = city();
  const F = C.biidaasigeAmenityFactories;
  const ring = [0, 0, 30, 0, 30, 10, 10, 10, 10, 30, 0, 30]; // concave L
  // No verified gate -> no fence at all, so the ring is open (interior reachable from outside).
  const open = F.buildDogOla(THREE, ring, []);
  assert.equal(open.userData.dogOla.openEntry, true, 'no gate => open entry');
  assert.ok(!open.children.some((o) => /_Posts|_Pickets|_Rails/.test(o.name)), 'no sealing perimeter without a gate');
  // The turf is ONE triangulated polygon covering the interior (concave-safe), not perimeter boxes.
  const turf = open.children.find((o) => /_Turf$/.test(o.name));
  assert.ok(turf, 'turf polygon built');
  const pos = turf.geometry.attributes.position;
  assert.ok(pos.count >= 3, 'turf has triangles');
  // A point deep inside the L's short leg is covered by a turf triangle (no naive perimeter-only result).
  const inside = (x, z) => {
    let hit = false, px = x, pz = z;
    for (let i = 0; i < pos.count; i += 3) {
      const ax = pos.getX(i), az = pos.getZ(i), bx = pos.getX(i + 1), bz = pos.getZ(i + 1), cx = pos.getX(i + 2), cz = pos.getZ(i + 2);
      const d1 = (px - bx) * (az - bz) - (ax - bx) * (pz - bz);
      const d2 = (px - cx) * (bz - cz) - (bx - cx) * (pz - cz);
      const d3 = (px - ax) * (cz - az) - (cx - ax) * (pz - az);
      const neg = d1 < 0 || d2 < 0 || d3 < 0, posv = d1 > 0 || d2 > 0 || d3 > 0;
      if (!(neg && posv)) hit = true;
    }
    return hit;
  };
  // ring is re-centred on its centroid; compute local coords of an interior point
  let cx = 0, cz = 0; for (let i = 0; i < ring.length; i += 2) { cx += ring[i]; cz += ring[i + 1]; }
  cx /= (ring.length / 2); cz /= (ring.length / 2);
  assert.ok(inside(20 - cx, 5 - cz), 'turf covers the wide leg interior');
  assert.ok(inside(5 - cx, 20 - cz), 'turf covers the narrow leg interior (concave-safe)');
  assert.ok(!inside(25 - cx, 25 - cz), 'turf does not spill outside the concave ring');
  // With a verified gate the fence exists, but is merged and leaves the gate open.
  const gated = F.buildDogOla(THREE, ring, [[15, 0]]);
  assert.equal(gated.userData.dogOla.openEntry, false);
  let fenceMeshes = 0; gated.traverse((o) => { if (o.isMesh && /_Posts|_Pickets|_Rails/.test(o.name)) fenceMeshes++; });
  assert.ok(fenceMeshes > 0 && fenceMeshes <= 3, `fence merged to ${fenceMeshes} meshes`);
  assert.ok(gated.children.some((o) => /_Gate$/.test(o.name)), 'gate leaf built');
});

test('water: the real City Open Data stations, deduped by record id, are the only fountains built here', () => {
  const C = city();
  const all = C.CITY_FACILITIES.records.filter((r) => r.kind === 'water' && r.parentName === 'Biidaasige Park');
  const out = C.buildBiidaasigeAmenities(new THREE.Scene(), []);
  assert.equal(out.stats.counts.fountains + out.stats.counts.dogFountains, all.length, 'every City station placed');
  // A caller that already renders some station ids skips them: the explicit dedupe contract.
  const skipId = all[0].id;
  const out2 = C.buildBiidaasigeAmenities(new THREE.Scene(), [], { renderedWaterIds: [skipId] });
  assert.equal(out2.stats.counts.fountains + out2.stats.counts.dogFountains, all.length - 1, 'a pre-rendered station is not duplicated');
  const ov = out.colliders.find((c) => c.assetId === all[0].assetId);
  assert.ok(ov, 'the station still has a collider in the full build');
  const dd = C.biidaasigeAmenityDedupe({ waterStations: all, renderedWaterIds: new Set([skipId]) });
  assert.equal(dd.waterStations.length, all.length - 1, 'dedupe() filters rendered ids');
});

test('renderedSites spatial dedupe: an OSM bench/bin within 1.5 m of an already-rendered same kind is skipped, others kept', () => {
  const C = city();
  const feats = C.biidaasigeParkFeatures();
  const bench = feats.find((f) => f.kind === 'bench');
  const w = C.biidaasigeParkWorld(bench.id);
  const full = C.buildBiidaasigeAmenities(new THREE.Scene(), []);
  // The data has a duplicated bench node at this exact point (a log bench and its plain node share lat/lon). Count how
  // many OSM benches coincide there, so the assertion is "all of them deduped", not a hard-coded 1.
  const coLocated = C.biidaasigeParkFeatures().filter((f) => f.kind === 'bench' && /^osm/.test(f.placement))
    .map((f) => C.biidaasigeParkWorld(f.id)).filter((p) => Math.hypot(p.x - w.x, p.z - w.z) <= 1.5).length;
  // Exact same spot as a rendered bench: deduped. A different kind at that spot does NOT dedupe the bench.
  const dup = C.buildBiidaasigeAmenities(new THREE.Scene(), [], { renderedSites: [{ x: w.x, z: w.z, kind: 'benches' }] });
  assert.equal(dup.stats.counts.benches, full.stats.counts.benches - coLocated, `a rendered same-kind bench removes the ${coLocated} OSM benches there`);
  const otherKind = C.buildBiidaasigeAmenities(new THREE.Scene(), [], { renderedSites: [{ x: w.x, z: w.z, kind: 'bins' }] });
  assert.equal(otherKind.stats.counts.benches, full.stats.counts.benches, 'a different kind does not dedupe the bench');
  // 3 m away is outside the 1.5 m radius: kept.
  const far = C.buildBiidaasigeAmenities(new THREE.Scene(), [], { renderedSites: [{ x: w.x + 3, z: w.z, kind: 'benches' }] });
  assert.equal(far.stats.counts.benches, full.stats.counts.benches, 'a bench 3 m away is not deduped');
  assert.equal(C.BIIDAASIGE_AMENITY_DEDUPE_RADIUS, 1.5);
});

test('fitness: the corrected source is honoured — a factory exists and the zone is LISTED-UNPLACED, never given a point', () => {
  const C = city();
  const f = F(C);
  assert.equal(typeof f.buildFitnessStation, 'function', 'fitness factory exists after the source correction');
  const g = f.buildFitnessStation(THREE);
  assertFinite(g, 'fitness');
  const { box } = measure(g);
  assert.ok(Math.abs(box.min.y) < 0.02, 'fitness base on y=0');
  // The inventory records fitness as official-listed-unplaced; the adapter must not place it.
  const catalog = C.biidaasigeParkCatalog().find((x) => x.kind === 'fitness');
  assert.ok(catalog, 'inventory catalog has the fitness entry');
  assert.equal(catalog.placement, 'unverified', 'fitness has no verified position');
  const out = C.buildBiidaasigeAmenities(new THREE.Scene(), []);
  assert.ok(out.stats.unplaced.some((u) => /outdoorFitness/.test(u)), 'adapter records fitness as listed-unplaced');
  assert.ok(!out.group.children.some((o) => /FitnessStation/.test(o.name)), 'no fitness instance placed');
});

// assets/props/plaza-bench.glb is gitignored: tools/prepare-bench.mjs makes it (npm run dev / npm run build), so a fresh
// `npm ci && npm test` has not made it yet. Skip, rather than fail, until it exists; every other reused asset is tracked.
const BENCH_PREPARED = fs.existsSync(path.join(ROOT, 'assets/props/plaza-bench.glb'));
test('the reused City bench is a real glTF binary at the recorded 1.8 x 0.96 x 0.8 m proportion', { skip: !BENCH_PREPARED && 'assets/props/plaza-bench.glb not prepared yet (node tools/prepare-bench.mjs)' }, async () => {
  const C = city();
  const size = S(C);
  for (const name of C.BIIDAASIGE_AMENITY_REUSED_ASSETS) assert.ok(fs.existsSync(path.join(ROOT, `assets/props/${name}.glb`)), `${name}.glb exists`);
  const buf = fs.readFileSync(path.join(ROOT, 'assets/props/plaza-bench.glb'));
  assert.equal(buf.toString('utf8', 0, 4), 'glTF', 'a real glTF binary');
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new Promise((res, rej) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(ab, '', res, rej));
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const dim = new THREE.Vector3(); box.getSize(dim);
  assert.ok(Math.abs(dim.x - size.bench.w) < 0.05, `bench width ${dim.x.toFixed(2)} matches the factory's ${size.bench.w}`);
  assert.ok(Math.abs(dim.y - size.bench.h) < 0.05, `bench height ${dim.y.toFixed(2)} matches the factory's ${size.bench.h}`);
  assert.ok(Math.abs(dim.z - size.bench.d) < 0.05, `bench depth ${dim.z.toFixed(2)} matches the factory's ${size.bench.d}`);
});

test('degrades honestly: without the inventory API it still builds City water, no invented furniture', () => {
  const C = city({ inventory: false });
  const out = C.buildBiidaasigeAmenities(null, null);
  assert.ok(out && out.group && Array.isArray(out.colliders));
  assert.equal(out.stats.projected, true);
  assert.ok(out.stats.unplaced.includes('benches'), 'benches unplaced without the inventory');
  assert.equal(out.stats.westOpened, '2026-07-24');
  assert.equal(C.biidaasigeAmenities.stats.colliders, out.colliders.length);
});
