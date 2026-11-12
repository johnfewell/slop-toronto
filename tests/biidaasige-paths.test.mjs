// Biidaasige Park paths (js/biidaasige-paths.js, bead st-bmyv.7) — corrected after the captain's paths review.
//
// The captain's review is authoritative: a path NEAR water is not evidence that a landing exists, the Canoe Cove OSM
// point is an IN-WATER bay centre (no sign post can stand there), and way/1211500112 is a whole ROAD bridge (not a
// footpath deck). These tests pin the CORRECTED contract:
//   - the runtime adapter builds ONLY the three named OSM paths (refs, lengths, surfaces), through the city projection;
//   - every built path vertex is DRY (not inside a water ring) and on the park (within the ribbon's half-width of the
//     park edge);
//   - NO landing, NO Canoe Cove water marker and NO bridge plane is ever spawned;
//   - official landings/steps/trails with no registered position are reported UNPLACED, never scattered;
//   - the height query is exact-triangle (its own vertex y), never a caller baseY, never a clamped world height;
//   - the factories are pure and finite; the data is the real 130-feature park data (not a mock/alias).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => fs.readFileSync(ROOT + p, 'utf8');

// Build a CITY with the real committed geodata (GEO + projection), the real park data, and the paths module.
function city({ withPark = true, withPaths = true, frame = null } = {}) {
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
  if (frame) C.GEO.frame = Object.assign({}, C.GEO.frame, frame);
  if (withPark) vm.runInContext(read('js/biidaasige-park-data.js'), ctx, { filename: 'biidaasige-park-data.js' });
  if (withPaths) vm.runInContext(read('js/biidaasige-paths.js'), ctx, { filename: 'biidaasige-paths.js' });
  return C;
}

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
    for (let i = 0; i < pos.count; i++) {
      assert.ok(Number.isFinite(pos.getX(i)) && Number.isFinite(pos.getY(i)) && Number.isFinite(pos.getZ(i)), `${label}: finite vertex ${i}`);
    }
  });
}
function worldRing(C, latLonRing) { return latLonRing.map(([lat, lon]) => C.worldFromLatLon(lat, lon)); }
function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x ?? ring[i][0], zi = ring[i].z ?? ring[i][1];
    const xj = ring[j].x ?? ring[j][0], zj = ring[j].z ?? ring[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

test('the data is the real source park catalog, not a mock or an alias', () => {
  const C = city();
  assert.ok((C.BIIDAASIGE_PARK.features || []).length >= 130, 'the full verified catalog is loaded, including later equipment additions');
  assert.ok((C.BIIDAASIGE_PARK.waterGeometry || []).length >= 9, 'the water rings are present');
  // the three named path features carry their exact OSM refs
  const byId = Object.fromEntries(C.BIIDAASIGE_PARK.features.map((f) => [f.id, f]));
  assert.equal(byId['biidaasige-park-main-path'].ref, 'way/1352429162');
  assert.equal(byId['don-greenway-trail-loop'].ref, 'way/1414354033');
  assert.equal(byId['waters-edge-promenade'].ref, 'way/1013210805');
});

test('factories: pure, finite, base on y=0, footprint centred, sizes match the recorded estimates', () => {
  const C = city();
  const F = C.biidaasigePathsFactories;
  const S = C.BIIDAASIGE_PATH_SIZES;
  const cases = [
    ['boardwalk', S.boardwalk, S.boardwalk.w, S.boardwalk.d],
    ['riverLanding', S.riverLanding, S.riverLanding.w, S.riverLanding.d],
    ['fishingEdge', S.fishingEdge, S.fishingEdge.w + 0.08, S.fishingEdge.d],
    ['kayakLaunch', S.kayakLaunch, S.kayakLaunch.w + 0.24 + 2 * S.kayakLaunch.rail, null]
  ];
  for (const [name, size, wantW, wantD] of cases) {
    const g = F[name](THREE);
    assert.ok(g && g.isGroup, `${name} returns a Group`);
    assertFinite(g, name);
    const m = measure(g);
    assert.ok(Math.abs(m.size.x - wantW) < 0.4, `${name} width ${m.size.x.toFixed(2)} ~ ${wantW}`);
    if (wantD !== null) assert.ok(Math.abs(m.size.z - wantD) < 0.4, `${name} depth ${m.size.z.toFixed(2)} ~ ${wantD}`);
    // the kayak launch descends BELOW its top (path-side) origin by design; the other decks sit on/near y=0.
    const baseOk = name === 'kayakLaunch' ? m.box.min.y >= -1.5 && m.box.max.y <= 0.3 : (m.box.min.y >= -0.30 && m.box.min.y <= 0.30);
    assert.ok(baseOk, `${name} base near y=0 or its recorded descent (${m.box.min.y.toFixed(2)})`);
    assert.ok(Math.abs(m.center.x) < 0.4, `${name} footprint centred on x (${m.center.x.toFixed(2)})`);
  }
  const steps = F.terrazzoSteps(THREE, { width: 2.2, steps: 4 });
  assertFinite(steps, 'terrazzoSteps');
  const sm = measure(steps);
  assert.ok(sm.box.min.y >= -0.05 && sm.size.y > 0.4, 'steps rise from y=0');
});

test('ribbon geometry: finite, two triangles per sample pair, width honoured, flat at the given y', () => {
  const C = city();
  const H = C.biidaasigePathsHelpers;
  const samples = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }];
  const geo = H.ribbonGeometry(THREE, samples, 1.5, 0.25);
  assert.ok(geo, 'ribbon built');
  const pos = geo.attributes.position;
  assert.equal(pos.count, samples.length * 2, 'two vertices per sample');
  assert.equal(geo.index.count, (samples.length - 1) * 6, 'two triangles per sample pair');
  for (let i = 0; i < pos.count; i++) {
    assert.ok(Number.isFinite(pos.getX(i)) && Number.isFinite(pos.getZ(i)), 'finite');
    assert.equal(pos.getY(i), 0.25, 'flat at the requested y');
  }
  const dx0 = pos.getX(0) - pos.getX(1), dz0 = pos.getZ(0) - pos.getZ(1);
  assert.ok(Math.abs(Math.hypot(dx0, dz0) - 3.0) < 1e-6, 'width = 2 * half-width');
  const rs = H.resamplePolyline(samples, 2.0);
  assert.ok(rs.length > samples.length, 'resampled denser');
  assert.ok(Math.hypot(rs[0].x - samples[0].x, rs[0].z - samples[0].z) < 1e-9, 'keeps the first vertex');
});

test('the runtime builds ONLY the three named paths, at the exact OSM ways, projected, dry, on the park', () => {
  const C = city();
  const out = C.buildBiidaasigePaths(null, []);
  assert.ok(out && out.group, 'builds');
  assert.equal(out.stats.pathCount, 3, 'exactly three named paths');
  // NOTHING else is added to the scene: only the three path meshes
  const meshes = out.group.children.filter((m) => m.isMesh);
  assert.equal(meshes.length, 3, 'three meshes, no landing/marker/bridge mesh');
  for (const m of meshes) assert.ok(m.name.startsWith('BiidaasigePaths_'), 'each mesh is a named path');

  const byId = Object.fromEntries(out.surfaces.map((s) => [s.id, s]));
  assert.equal(byId['biidaasige-park-main-path'].ref, 'way/1352429162');
  assert.equal(byId['don-greenway-trail-loop'].ref, 'way/1414354033');
  assert.equal(byId['waters-edge-promenade'].ref, 'way/1013210805');
  assert.ok(Math.abs(byId['biidaasige-park-main-path'].lengthM - 511.2) < 1.0, 'main path ~511 m');
  assert.ok(Math.abs(byId['don-greenway-trail-loop'].lengthM - 574.4) < 1.0, 'loop ~574 m');
  assert.ok(Math.abs(byId['waters-edge-promenade'].lengthM - 239.0) < 1.0, 'promenade ~239 m');
  assert.equal(byId['biidaasige-park-main-path'].widthM, 3.0, 'cycleway 3.0 m');
  assert.equal(byId['waters-edge-promenade'].widthM, 2.2, 'footway 2.2 m');

  // DRY + on the park: sample every built ribbon vertex against the park ring and every water ring
  const D = C.BIIDAASIGE_PARK;
  const parkRing = worldRing(C, D.park.polygon);
  const waters = [];
  for (const wg of D.waterGeometry) if (wg.ring) waters.push(worldRing(C, wg.ring));
  for (const f of D.features) if (f.kind === 'wetland' && f.ring) waters.push(worldRing(C, f.ring));
  const ribbonHalf = Math.max(...out.surfaces.map((s) => s.widthM / 2));
  const nearPark = (x, z) => {
    if (pointInRing(parkRing, x, z)) return true;
    for (let i = 0; i < parkRing.length; i++) {
      const a = parkRing[i], b = parkRing[(i + 1) % parkRing.length];
      const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
      if (Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)) < ribbonHalf + 0.1) return true;
    }
    return false;
  };
  for (const mesh of out.group.children) {
    if (!mesh.isMesh || !mesh.name.startsWith('BiidaasigePaths_')) continue;
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      for (const w of waters) assert.ok(!pointInRing(w, x, z), `${mesh.name} vertex ${i} not in water`);
      assert.ok(nearPark(x, z), `${mesh.name} vertex ${i} on the park (within the ribbon's half-width of its edge)`);
    }
  }
});

test('NO landing, NO Canoe Cove water marker and NO bridge plane is spawned', () => {
  const C = city();
  const out = C.buildBiidaasigePaths(null, []);
  const names = out.group.children.map((m) => m.name);
  assert.ok(!names.some((n) => /landing|Landing/.test(n)), 'no landing mesh');
  assert.ok(!names.some((n) => /CanoeCove|canoe/i.test(n)), 'no Canoe Cove water marker');
  assert.ok(!names.some((n) => /bridge|Bridge|footpath/i.test(n)), 'no bridge plane');
  assert.ok(!names.some((n) => /steps|Steps/.test(n)), 'no steps on the flat datum');
  assert.ok(!out.stats.canoeCove, 'no canoe-cove record');
  assert.ok(!out.landings, 'no landings array');
  // The Canoe Cove OSM point is a natural=bay CENTRE: it is OFF the park land (spatialStatus adjacent, 8 m outside the
  // mapped land polygon because the cove is water). Prove why a sign post cannot stand there.
  const D = C.BIIDAASIGE_PARK;
  const cove = D.features.find((f) => f.id === 'canoe-cove');
  assert.equal(cove.spatialStatus, 'adjacent', 'the cove node is adjacent (in the water), not in-park');
  const p = worldRing(C, [[cove.lat, cove.lon]])[0];
  const parkRing = worldRing(C, D.park.polygon);
  assert.ok(!pointInRing(parkRing, p.x, p.z), 'the bay centre is not on the park land — no post can stand there');
});

test('official landings/steps/trails with no registered position are reported unplaced, never scattered', () => {
  const C = city();
  const out = C.buildBiidaasigePaths(null, []);
  const ids = out.unplaced.map((u) => u.id);
  for (const id of ['river-bend-landing', 'east-landing', 'west-landing', 'steps', 'trails-other-named']) {
    assert.ok(ids.includes(id), `${id} reported unplaced`);
  }
  assert.ok(!ids.includes('future-acres'), 'future acres not placed');
  for (const u of out.unplaced) assert.ok(typeof u.reason === 'string' && u.reason.length > 0, `${u.id} has a reason`);
});

test('duplicate contract: a named path overlapping a generic GEO.parkPath is reported, not hidden', () => {
  const C = city();
  const D = C.BIIDAASIGE_PARK;
  const main = D.features.find((f) => f.id === 'biidaasige-park-main-path');
  const a = C.worldFromLatLon(main.ring[0][0], main.ring[0][1]);
  const b = C.worldFromLatLon(main.ring[1][0], main.ring[1][1]);
  C.GEO.parkPaths = [[a.x, a.z, b.x, b.z]];
  const out = C.buildBiidaasigePaths(null, []);
  assert.ok(out.duplicates.some((d) => d.id === 'biidaasige-park-main-path'), 'overlap reported');
  assert.ok(Array.isArray(C.GEO.parkPaths) && C.GEO.parkPaths.length === 1, 'generic path preserved');
});

test('height query is exact-triangle: its own vertex height, not a baseY and not a clamped world height', () => {
  const C = city();
  const out = C.buildBiidaasigePaths(null, []);
  const tris = C.biidaasigePathsTriangles();
  assert.ok(tris.length > 0, 'published triangles exist');
  // every published triangle y equals the ribbon's own lift height (no base added)
  const want = C.CITY_BOUNDS.sidewalkHeight + C.BIIDAASIGE_PATH_SIZES.surfaceLift;
  for (const T of tris) assert.ok([T.y0, T.y1, T.y2].every((y) => Math.abs(y - want) < 1e-9), 'triangle heights = lawn+lift');
  // a point on the main path returns its exact triangle height and the path id
  const mesh = out.group.children.find((m) => m.name.endsWith('biidaasige-park-main-path'));
  const pos = mesh.geometry.attributes.position;
  const x = (pos.getX(0) + pos.getX(1)) / 2, z = (pos.getZ(0) + pos.getZ(1)) / 2;
  const on = C.biidaasigePathsSurfaceAt(x, z);
  assert.ok(on && on.onPath, 'on the path');
  assert.equal(on.pathId, 'biidaasige-park-main-path');
  assert.ok(Math.abs(on.surfaceY - want) < 1e-6, 'exact triangle height');
  // off the path -> not on path, null height (never a clamped/global answer)
  const off = C.biidaasigePathsSurfaceAt(0, 0);
  assert.ok(off && !off.onPath && off.surfaceY === null, 'off the path: null height');
});

test('frame guard: a path wholly outside the active GEO frame is reported unplaced, not built', () => {
  const C = city({ frame: { x0: 0, x1: 1, z0: 0, z1: 1 } });
  const out = C.buildBiidaasigePaths(null, []);
  assert.equal(out.stats.pathCount, 0, 'nothing built outside the frame');
  assert.ok(out.unplaced.some((u) => /outside the active GEO frame/.test(u.reason)), 'reported as out of frame');
});

test('the module never throws without park data, a scene or THREE, and reports why', () => {
  const C = city({ withPark: false });
  const out = C.buildBiidaasigePaths(null, null);
  assert.ok(out && out.group && Array.isArray(out.colliders));
  assert.equal(out.stats.pathCount, 0);
  assert.match(out.stats.reason, /BIIDAASIGE_PARK data missing/);
  // no THREE -> null, never a throw
  const ctx2 = { window: { CITY: { THREE } }, console: { info() {}, warn() {}, log() {}, error() {} }, performance };
  vm.createContext(ctx2);
  vm.runInContext(read('js/biidaasige-paths.js'), ctx2, { filename: 'biidaasige-paths.js' });
  delete ctx2.window.CITY.THREE;
  assert.equal(ctx2.window.CITY.buildBiidaasigePaths(null, null), null);
});

test('ribbon top faces are really visible to a downward ray, not merely assigned upward normals',()=>{
 const C=city();const out=C.buildBiidaasigePaths(new THREE.Scene(),[]);out.group.updateMatrixWorld(true);
 for(const mesh of out.group.children){
  const geo=mesh.geometry,p=geo.attributes.position,idx=geo.index;
  if(!idx||idx.count<3)continue;
  const v=[0,1,2].map(k=>idx.getX(k));
  const x=v.reduce((sum,i)=>sum+p.getX(i),0)/3,z=v.reduce((sum,i)=>sum+p.getZ(i),0)/3;
  const ray=new THREE.Raycaster(new THREE.Vector3(x,10,z),new THREE.Vector3(0,-1,0));
  assert.ok(ray.intersectObject(mesh,false).length>0,`${mesh.name} winding faces up`);
 }
});
