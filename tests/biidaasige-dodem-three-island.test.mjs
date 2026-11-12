// Biidaasige Park second source-traced woodchip island (js/biidaasige-dodem-three-island.js, bead st-bmyv.4.2). Focused
// CPU checks that load the ACTUAL module (on top of the first island's shared helpers/materials) into a small CITY and
// prove, from the REAL built THREE geometry and the committed fixture:
//
//   1. ONE island from the Captain's 65-vertex concave trace: woodchip top exactly y = .232, curb top exactly y = .284,
//      projected area matches the traced ring (concave-safe earcut, no fan fill, no ellipse/rectangle).
//   2. Every published `surfaces` triangle is a real upward (+Y) wound rendered triangle hit by an INDEPENDENT THREE
//      downward raycast; the query returns the exact physical surface inside, null outside, and null in the notch.
//   3. It SHARES the first island's helpers and ACTUAL materials, but keeps a DISTINCT record/query/state.
//   4. The curb is bounded per-segment quads; default colliders is []; opt-in colliders are finite and bounded; the
//      material budget is bounded (two meshes).
//   5. Works in both real frames (detail and the default eglinton frame); missing projection / shared helpers / THREE
//      is graceful; an invalid rebuild clears the stale query; the module edits no other file.
//   6. The generator --check is current with the READONLY fixture and the module DATA ring matches it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three/webgpu';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => fs.readFileSync(ROOT + p, 'utf8');
const FIXTURE = JSON.parse(read('tools/fixtures/biidaasige-dodem-three-island.json'));
const FIRST_FIXTURE = JSON.parse(read('tools/fixtures/biidaasige-woodchip-island.json'));

function city({ withProjection = true, withFirst = true, withSecond = true, frame = null } = {}) {
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
  if (!withProjection) delete C.worldFromLatLon;
  if (frame) C.GEO.frame = Object.assign({}, C.GEO.frame, frame);
  if (withFirst) vm.runInContext(read('js/biidaasige-woodchip-island.js'), ctx, { filename: 'biidaasige-woodchip-island.js' });
  if (withSecond) vm.runInContext(read('js/biidaasige-dodem-three-island.js'), ctx, { filename: 'biidaasige-dodem-three-island.js' });
  return C;
}

function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function triNormalY(T) {
  const ux = T[3] - T[0], uy = T[4] - T[1], uz = T[5] - T[2];
  const vx = T[6] - T[0], vy = T[7] - T[1], vz = T[8] - T[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  return ny / (Math.hypot(nx, ny, nz) || 1);
}
function distToRing(ring, x, z) {
  let m = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0], az = ring[j][1], bx = ring[i][0], bz = ring[i][1];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    m = Math.min(m, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return m;
}
function insidePoint(ring, surfaces) {
  for (const s of surfaces) {
    if (s.kind !== 'woodchip') continue;
    const T = s.triangle;
    const x = (T[0] + T[3] + T[6]) / 3, z = (T[2] + T[5] + T[8]) / 3;
    if (pointInRing(ring, x, z) && distToRing(ring, x, z) > 0.25) return { x, z };
  }
  return null;
}
function convexHull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}
function notchPoint(ring) {
  const hull = convexHull(ring);
  const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const step = 0.5;
  for (let x = minX + step / 2; x < maxX; x += step) {
    for (let z = minZ + step / 2; z < maxZ; z += step) {
      if (!pointInRing(ring, x, z) && pointInRing(hull, x, z)) return { x, z };
    }
  }
  return null;
}

test('ONE island from the 65-vertex concave trace: woodchip .232, curb .284, area matches the ring', () => {
  const C = city();
  const out = C.buildBiidaasigeDodemThreeIsland(null, {});
  assert.ok(out && out.group, 'builds');
  assert.equal(out.ringWorld.length, FIXTURE.ringLatLon.length, 'all traced vertices preserved');
  assert.equal(out.stats.vertices, FIXTURE.ringLatLon.length);
  assert.equal(out.stats.finishY, 0.232);
  assert.equal(out.stats.groundY, 0.224);
  assert.equal(out.stats.curbTopY, 0.284);
  assert.equal(out.stats.curbWidthM, 0.12);
  assert.equal(out.stats.curbRiseM, 0.06);

  const H = C.biidaasigeWoodchipIslandHelpers;
  const ringArea = H.ringArea(out.ringWorld);
  assert.ok(Math.abs(out.stats.areaM2 - ringArea) < 0.2, `area ${out.stats.areaM2} vs ring ${ringArea}`);
  assert.ok(out.stats.areaM2 > 150 && out.stats.areaM2 < 240, `traced island ~190 m2 (${out.stats.areaM2})`);

  assert.equal(out.group.children.filter((m) => m.isMesh).length, 2, 'two meshes total');
  assert.equal(out.stats.meshes, 2);
  assert.ok(out.group.userData.cullDistance > 0 && out.group.userData.cullCell > 0, 'bounded root for culling');
  assert.equal(out.colliders.length, 0);
  assert.equal(C.biidaasigeDodemThreeIsland.colliders.length, 0);
});

test('it SHARES the first island helpers/materials but keeps a DISTINCT record/query/state', () => {
  const C = city();
  assert.equal(typeof C.biidaasigeWoodchipIslandHelpers.woodchipMaterial, 'function', 'shared woodchip material factory');
  assert.equal(typeof C.biidaasigeWoodchipIslandHelpers.curbMaterial, 'function', 'shared curb material factory');
  const first = C.buildBiidaasigeWoodchipIsland(null, {});
  const second = C.buildBiidaasigeDodemThreeIsland(null, {});
  assert.ok(first && second);
  // distinct records and state
  assert.notEqual(C.biidaasigeWoodchipIsland, C.biidaasigeDodemThreeIsland, 'distinct records');
  assert.notEqual(C.biidaasigeWoodchipIslandAt, C.biidaasigeDodemThreeIslandAt, 'distinct queries');
  assert.equal(C.biidaasigeWoodchipIsland.ringWorld.length, FIRST_FIXTURE.ringLatLon.length);
  assert.equal(C.biidaasigeDodemThreeIsland.ringWorld.length, FIXTURE.ringLatLon.length);
  assert.notEqual(C.biidaasigeWoodchipIsland.group.name, C.biidaasigeDodemThreeIsland.group.name);
  // shared material spec: same constructor and colour as the first island's woodchip material
  const firstWood = first.group.children.find((m) => m.name.endsWith('_woodchip')).material;
  const secondWood = second.group.children.find((m) => m.name.endsWith('_woodchip')).material;
  assert.equal(secondWood.constructor, firstWood.constructor, 'same material class as the first island');
  assert.equal(secondWood.color.getHex(), firstWood.color.getHex(), 'same warm brown base colour');
  // adjacency: an interior point of the second island is not inside the first island's ring
  const ring2 = second.ringWorld.map((p) => [p.x, p.z]);
  const inside2 = insidePoint(ring2, second.surfaces);
  const ring1 = first.ringWorld.map((p) => [p.x, p.z]);
  assert.ok(!pointInRing(ring1, inside2.x, inside2.z), 'the two islands do not overlap');
  assert.equal(C.biidaasigeWoodchipIslandAt(inside2.x, inside2.z), null, 'first island query has no answer here');
  assert.ok(C.biidaasigeDodemThreeIslandAt(inside2.x, inside2.z), 'second island query answers here');
});

test('every surface triangle is upward-wound and hit by an INDEPENDENT three.js downward raycast', () => {
  const C = city();
  const scene = new THREE.Scene();
  const out = C.buildBiidaasigeDodemThreeIsland(scene, {});
  scene.updateMatrixWorld(true);
  assert.ok(out.surfaces.length > 60, 'real triangle set published');
  assert.ok(out.surfaces.length < 6000, 'bounded triangle budget');
  for (const s of out.surfaces) {
    assert.ok(triNormalY(s.triangle) > 0.9, 'each published triangle faces up');
    for (const v of s.triangle) assert.ok(Number.isFinite(v), 'finite vertex');
  }

  const ray = new THREE.Raycaster();
  let checked = 0;
  for (const s of out.surfaces) {
    const T = s.triangle;
    const x = (T[0] + T[3] + T[6]) / 3, z = (T[2] + T[5] + T[8]) / 3;
    ray.set(new THREE.Vector3(x, 20, z), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObject(out.group, true);
    const top = hits.find((h) => Math.abs(h.point.y - T[1]) < 1e-4);
    assert.ok(top, `the published ${s.kind} triangle is really visible to a downward ray at its own height`);
    checked++;
  }
  assert.equal(checked, out.surfaces.length, 'every published triangle checked');

  // inside -> actual physical surfaceY; outside -> null; concave notch -> null
  const ring = out.ringWorld.map((p) => [p.x, p.z]);
  const inside = insidePoint(ring, out.surfaces);
  assert.ok(inside, 'found an interior point');
  const q = C.biidaasigeDodemThreeIslandAt(inside.x, inside.z);
  assert.ok(q && q.onIsland && Number.isFinite(q.surfaceY), 'query returns an actual physical surfaceY');
  assert.ok(Math.abs(q.surfaceY - 0.232) < 1e-4, `interior query returns woodchip .232 (${q.surfaceY})`);
  assert.equal(q.kind, 'woodchip');
  assert.equal(C.biidaasigeDodemThreeIslandAt(inside.x + 100, inside.z + 100), null, 'outside -> null');
  const notch = notchPoint(ring);
  assert.ok(notch, 'found a concave notch point');
  assert.equal(C.biidaasigeDodemThreeIslandAt(notch.x, notch.z), null, 'concave notch -> null (no convex-hull fill)');
});

test('pale concrete curb is bounded per-segment quads; opt-in colliders are finite and bounded', () => {
  const C = city();
  const out = C.buildBiidaasigeDodemThreeIsland(null, {});
  const curbSurfaces = out.surfaces.filter((s) => s.kind === 'curb');
  assert.ok(curbSurfaces.length >= out.ringWorld.length * 2, 'curb top has at least two triangles per traced edge');
  for (const s of curbSurfaces) {
    assert.ok(Math.abs(s.triangle[1] - 0.284) < 1e-6, 'curb top is exactly .284');
    assert.ok(triNormalY(s.triangle) > 0.9, 'curb top faces up');
  }
  assert.ok(out.stats.curbTriangles >= out.ringWorld.length * 4, `curb is per-segment (${out.stats.curbTriangles} tris)`);
  const curbMesh = out.group.children.find((m) => m.name === 'BiidaasigeDodemThreeIsland_curb');
  const box = new THREE.Box3().setFromObject(curbMesh);
  assert.ok(Number.isFinite(box.min.x) && Number.isFinite(box.max.x), 'curb bounds are finite');
  assert.ok(box.max.y - box.min.y > 0.05 && box.max.y - box.min.y < 0.1, 'curb rise is ~0.06 m');

  const withColliders = C.buildBiidaasigeDodemThreeIsland(null, { curbColliders: true });
  assert.equal(withColliders.colliders.length, withColliders.ringWorld.length, 'one bounded collider per traced edge');
  for (const c of withColliders.colliders) {
    for (const k of ['minX', 'maxX', 'minZ', 'maxZ', 'minY', 'maxY']) assert.ok(Number.isFinite(c[k]), `${k} finite`);
    assert.ok(c.maxX > c.minX && c.maxZ > c.minZ && c.maxY > c.minY, 'bounded volume');
    assert.equal(c.kind, 'curb');
  }
});

test('works in BOTH real frames (detail and the default eglinton frame), same island and area', () => {
  const detail = city();
  const dOut = detail.buildBiidaasigeDodemThreeIsland(null, {});
  const egl = city({ frame: { x0: -7900, x1: 9600, z0: -7300, z1: 3600 } });
  const eOut = egl.buildBiidaasigeDodemThreeIsland(null, {});
  assert.equal(eOut.ringWorld.length, dOut.ringWorld.length, 'both frames preserve the trace');
  assert.equal(eOut.stats.areaM2, dOut.stats.areaM2, 'area is frame-invariant (same projection)');
  assert.equal(eOut.stats.finishY, dOut.stats.finishY);
  assert.equal(eOut.stats.curbTopY, dOut.stats.curbTopY);
});

test('missing projection / shared helpers / THREE is graceful; an invalid rebuild clears the stale query', () => {
  let C = city({ withProjection: false });
  let out = C.buildBiidaasigeDodemThreeIsland(null, {});
  assert.ok(out && Array.isArray(out.surfaces) && out.surfaces.length === 0);
  assert.match(out.stats.reason, /projection unavailable/);
  assert.equal(C.biidaasigeDodemThreeIslandAt(0, 0), null);

  // shared helpers absent -> clear reason, no throw
  C = city({ withFirst: false });
  out = C.buildBiidaasigeDodemThreeIsland(null, {});
  assert.equal(out.surfaces.length, 0);
  assert.match(out.stats.reason, /shared helpers missing/);
  assert.equal(C.biidaasigeDodemThreeIslandAt(0, 0), null);

  // no THREE -> null (never a throw)
  const ctx2 = { window: { CITY: { THREE } }, console: { info() {}, warn() {}, log() {}, error() {} }, performance };
  vm.createContext(ctx2);
  vm.runInContext(read('js/biidaasige-dodem-three-island.js'), ctx2, { filename: 'biidaasige-dodem-three-island.js' });
  delete ctx2.window.CITY.THREE;
  assert.equal(ctx2.window.CITY.buildBiidaasigeDodemThreeIsland(null, null), null);

  // a rebuild after the source changes drops stale answers
  C = city();
  const first = C.buildBiidaasigeDodemThreeIsland(null, {});
  const ring = first.ringWorld.map((p) => [p.x, p.z]);
  const inside = insidePoint(ring, first.surfaces);
  assert.ok(C.biidaasigeDodemThreeIslandAt(inside.x, inside.z), 'on the island before the change');
  C.BIIDAASIGE_DODEM_THREE_ISLAND_DATA.ringLatLon = [];
  const second = C.buildBiidaasigeDodemThreeIsland(null, {});
  assert.equal(second.surfaces.length, 0, 'the removed trace builds nothing');
  assert.equal(C.biidaasigeDodemThreeIslandAt(inside.x, inside.z), null, 'no stale answer from the removed trace');
});

test('generator --check is current with the READONLY fixture and the module DATA matches it', () => {
  const out = execFileSync(process.execPath, ['tools/build-biidaasige-dodem-three-island.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /up to date/);
  const C = city();
  // cross-realm arrays/objects: compare serialized values (deepStrictEqual also checks the VM prototype)
  assert.equal(JSON.stringify(C.BIIDAASIGE_DODEM_THREE_ISLAND_DATA.ringLatLon), JSON.stringify(FIXTURE.ringLatLon), 'module DATA ring matches the fixture');
  assert.equal(C.BIIDAASIGE_DODEM_THREE_ISLAND_DATA.traceErrorM, FIXTURE.traceErrorM);
  assert.equal(C.BIIDAASIGE_DODEM_THREE_ISLAND_DATA.placementUncertaintyM, FIXTURE.placementUncertaintyM);
  assert.equal(JSON.stringify(C.BIIDAASIGE_DODEM_THREE_ISLAND_DATA.finishChoices), JSON.stringify(FIXTURE.finishChoices));
  assert.equal(C.BIIDAASIGE_DODEM_THREE_ISLAND_DATA.featureId, FIXTURE.featureId);
});

test('the module edits no other file: it reuses the shared helpers and city projection only', () => {
  const src = read('js/biidaasige-dodem-three-island.js');
  for (const other of ['biidaasige-paths', 'biidaasige-park-data', 'city-grid', 'main', 'explore']) {
    assert.ok(!new RegExp(`runInContext|import .*${other}|require\\(.*${other}`).test(src), 'never loads another module');
  }
  assert.ok(/C\.worldFromLatLon/.test(src), 'projects through the city worldFromLatLon at call time');
  assert.ok(/biidaasigeWoodchipIslandHelpers/.test(src), 'reuses the first island shared helpers/materials');
  assert.ok(!/\/tmp\//.test(src), 'no /tmp reference');
  const builder = read('tools/build-biidaasige-dodem-three-island.mjs');
  assert.ok(!/\/tmp\//.test(builder), 'builder does not read /tmp');
  assert.match(builder, /tools\/fixtures\/biidaasige-dodem-three-island\.json/);
});
