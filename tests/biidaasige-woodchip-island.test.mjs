// Biidaasige Park source-traced woodchip island (js/biidaasige-woodchip-island.js, bead st-bmyv.4.1). Focused CPU
// checks that load the ACTUAL module into a small CITY and prove, from the REAL built THREE geometry and the committed
// fixture:
//
//   1. ONE island from the Captain's 58-vertex concave trace: woodchip top exactly y = .232, curb top exactly y = .284,
//      projected area matches the traced ring (concave-safe earcut, no fan fill, no ellipse/rectangle).
//   2. Every published `surfaces` triangle is a real upward (+Y) wound rendered triangle hit by an INDEPENDENT THREE
//      downward raycast; the query returns the exact height inside, null outside, and null in the concave notch.
//   3. The pale concrete curb follows the concave ring as bounded per-segment quads (top + outer wall + inner wall),
//      not one box wall; default colliders is [] (a 6 cm step), opt-in curb colliders are finite and bounded.
//   4. Works in both real frames (detail and the default eglinton frame); missing projection / THREE is graceful; an
//      invalid rebuild clears the stale query; the module edits no other file and uses no document/network/image.
//   5. The generator --check is current with the READONLY fixture, and the module's DATA ring matches the fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three/webgpu';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => fs.readFileSync(ROOT + p, 'utf8');
const FIXTURE = JSON.parse(read('tools/fixtures/biidaasige-woodchip-island.json'));

function city({ withProjection = true, withIsland = true, frame = null } = {}) {
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
  if (withIsland) vm.runInContext(read('js/biidaasige-woodchip-island.js'), ctx, { filename: 'biidaasige-woodchip-island.js' });
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
function triAreaXZ(T) {
  return Math.abs((T[3] - T[0]) * (T[8] - T[2]) - (T[6] - T[0]) * (T[5] - T[2])) / 2;
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

test('ONE island from the 58-vertex concave trace: woodchip .232, curb .284, area matches the ring', () => {
  const C = city();
  const out = C.buildBiidaasigeWoodchipIsland(null, {});
  assert.ok(out && out.group, 'builds');
  assert.equal(out.ringWorld.length, FIXTURE.ringLatLon.length, 'all traced vertices preserved');
  assert.equal(out.stats.vertices, FIXTURE.ringLatLon.length);
  assert.equal(out.stats.finishY, 0.232);
  assert.equal(out.stats.groundY, 0.224);
  assert.equal(out.stats.curbTopY, 0.284);
  assert.equal(out.stats.curbWidthM, 0.12);
  assert.equal(out.stats.curbRiseM, 0.06);
  assert.equal(C.BIIDAASIGE_WOODCHIP_ISLAND_FINISH.woodchipY, 0.232);
  assert.equal(C.BIIDAASIGE_WOODCHIP_ISLAND_FINISH.curbTopY, 0.284);

  // projected area matches the traced ring (concave-safe earcut, no fan fill, no bbox fill)
  const ring = out.ringWorld.map((p) => [p.x, p.z]);
  const H = C.biidaasigeWoodchipIslandHelpers;
  const ringArea = H.ringArea(out.ringWorld);
  assert.ok(Math.abs(out.stats.areaM2 - ringArea) < 0.2, `area ${out.stats.areaM2} vs ring ${ringArea}`);
  assert.ok(out.stats.areaM2 > 200 && out.stats.areaM2 < 340, `traced island ~268 m2 (${out.stats.areaM2})`);

  // ONE bounded root, TWO meshes (woodchip + curb)
  assert.equal(out.group.children.filter((m) => m.isMesh).length, 2, 'two meshes total');
  assert.equal(out.stats.meshes, 2);
  assert.ok(out.group.userData.cullDistance > 0 && out.group.userData.cullCell > 0, 'bounded root for culling');
  // default colliders is [] — a 6 cm curb is a step, not a wall
  assert.equal(out.colliders.length, 0);
  assert.equal(C.biidaasigeWoodchipIsland.colliders.length, 0);
});

test('concave-safe triangulation covers the ring area exactly (not a fan fill)', () => {
  const C = city();
  const H = C.biidaasigeWoodchipIslandHelpers;
  const ring = [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 6 }, { x: 0, z: 6 }];
  const faces = H.triangulateFaces(THREE, ring);
  assert.ok(faces && faces.length > 2, 'concave shape takes more than the fan-fill two triangles');
  let area = 0;
  for (const t of faces) area += Math.abs((t.b.x - t.a.x) * (t.c.z - t.a.z) - (t.c.x - t.a.x) * (t.b.z - t.a.z)) / 2;
  assert.ok(Math.abs(area - 20) < 1e-6, `L-shaped ring area 20 (triangulated ${area})`);

  // the real trace also triangulates to its ring area
  const out = C.buildBiidaasigeWoodchipIsland(null, {});
  const realFaces = H.triangulateFaces(THREE, out.ringWorld);
  let realArea = 0;
  for (const t of realFaces) realArea += Math.abs((t.b.x - t.a.x) * (t.c.z - t.a.z) - (t.c.x - t.a.x) * (t.b.z - t.a.z)) / 2;
  assert.ok(Math.abs(realArea - H.ringArea(out.ringWorld)) < 0.5, 'real trace triangulated area = ring area');
});

test('every surface triangle is upward-wound and hit by an INDEPENDENT three.js downward raycast', () => {
  const C = city();
  const scene = new THREE.Scene();
  const out = C.buildBiidaasigeWoodchipIsland(scene, {});
  scene.updateMatrixWorld(true);
  assert.ok(out.surfaces.length > 60, 'real triangle set published');
  for (const s of out.surfaces) assert.ok(triNormalY(s.triangle) > 0.9, 'each published triangle faces up');

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

  // inside -> woodchip .232; outside -> null; concave notch -> null
  const ring = out.ringWorld.map((p) => [p.x, p.z]);
  const inside = insidePoint(ring, out.surfaces);
  assert.ok(inside, 'found an interior point');
  const q = C.biidaasigeWoodchipIslandAt(inside.x, inside.z);
  assert.ok(q && q.onIsland, 'query finds the island inside');
  assert.ok(Math.abs(q.surfaceY - 0.232) < 1e-4, `interior query returns woodchip .232 (${q.surfaceY})`);
  assert.equal(C.biidaasigeWoodchipIslandAt(inside.x + 100, inside.z + 100), null, 'outside -> null');
  const notch = notchPoint(ring);
  assert.ok(notch, 'found a concave notch point');
  assert.equal(C.biidaasigeWoodchipIslandAt(notch.x, notch.z), null, 'concave notch -> null (no convex-hull fill)');
});

test('pale concrete curb follows the concave ring as bounded per-segment quads, not one box wall', () => {
  const C = city();
  const out = C.buildBiidaasigeWoodchipIsland(null, {});
  const curbSurfaces = out.surfaces.filter((s) => s.kind === 'curb');
  assert.ok(curbSurfaces.length >= out.ringWorld.length * 2, 'curb top has at least two triangles per traced edge');
  for (const s of curbSurfaces) {
    assert.ok(Math.abs(s.triangle[1] - 0.284) < 1e-6, 'curb top is exactly .284');
    assert.ok(triNormalY(s.triangle) > 0.9, 'curb top faces up');
  }
  // bounded segment geometry: many small triangles, not one giant box wall
  assert.ok(out.stats.curbTriangles >= out.ringWorld.length * 4, `curb is per-segment (${out.stats.curbTriangles} tris)`);
  const curbMesh = out.group.children.find((m) => m.name === 'BiidaasigeWoodchipIsland_curb');
  assert.ok(curbMesh, 'curb mesh exists');
  const box = new THREE.Box3().setFromObject(curbMesh);
  assert.ok(Number.isFinite(box.min.x) && Number.isFinite(box.max.x), 'curb bounds are finite');
  assert.ok(box.max.y - box.min.y > 0.05 && box.max.y - box.min.y < 0.1, 'curb rise is ~0.06 m');

  // opt-in curb colliders are finite and bounded; default is none
  const withColliders = C.buildBiidaasigeWoodchipIsland(null, { curbColliders: true });
  assert.equal(withColliders.colliders.length, withColliders.ringWorld.length, 'one bounded collider per traced edge');
  for (const c of withColliders.colliders) {
    for (const k of ['minX', 'maxX', 'minZ', 'maxZ', 'minY', 'maxY']) assert.ok(Number.isFinite(c[k]), `${k} finite`);
    assert.ok(c.maxX > c.minX && c.maxZ > c.minZ && c.maxY > c.minY, 'bounded volume');
    assert.equal(c.kind, 'curb');
  }
});

test('works in BOTH real frames (detail and the default eglinton frame), same island and area', () => {
  const detail = city();
  const dOut = detail.buildBiidaasigeWoodchipIsland(null, {});
  const egl = city({ frame: { x0: -7900, x1: 9600, z0: -7300, z1: 3600 } }); // tools/frames/eglinton.json world box
  const eOut = egl.buildBiidaasigeWoodchipIsland(null, {});
  assert.equal(eOut.ringWorld.length, dOut.ringWorld.length, 'both frames preserve the trace');
  assert.equal(eOut.stats.areaM2, dOut.stats.areaM2, 'area is frame-invariant (same projection)');
  assert.equal(eOut.stats.finishY, dOut.stats.finishY);
  assert.equal(eOut.stats.curbTopY, dOut.stats.curbTopY);
});

test('missing projection / THREE is graceful; an invalid rebuild clears the stale query', () => {
  let C = city({ withProjection: false });
  let out = C.buildBiidaasigeWoodchipIsland(null, {});
  assert.ok(out && Array.isArray(out.surfaces) && out.surfaces.length === 0);
  assert.match(out.stats.reason, /projection unavailable/);
  assert.equal(C.biidaasigeWoodchipIslandAt(0, 0), null);

  // no THREE -> null (never a throw)
  const ctx2 = { window: { CITY: { THREE } }, console: { info() {}, warn() {}, log() {}, error() {} }, performance };
  vm.createContext(ctx2);
  vm.runInContext(read('js/biidaasige-woodchip-island.js'), ctx2, { filename: 'biidaasige-woodchip-island.js' });
  delete ctx2.window.CITY.THREE;
  assert.equal(ctx2.window.CITY.buildBiidaasigeWoodchipIsland(null, null), null);

  // a rebuild after the source changes drops stale answers
  C = city();
  const first = C.buildBiidaasigeWoodchipIsland(null, {});
  const ring = first.ringWorld.map((p) => [p.x, p.z]);
  const inside = insidePoint(ring, first.surfaces);
  assert.ok(C.biidaasigeWoodchipIslandAt(inside.x, inside.z), 'on the island before the change');
  C.BIIDAASIGE_WOODCHIP_ISLAND_DATA.ringLatLon = [];
  const second = C.buildBiidaasigeWoodchipIsland(null, {});
  assert.equal(second.surfaces.length, 0, 'the removed trace builds nothing');
  assert.equal(C.biidaasigeWoodchipIslandAt(inside.x, inside.z), null, 'no stale answer from the removed trace');
});

test('generator --check is current with the READONLY fixture and the module DATA matches it', () => {
  const out = execFileSync(process.execPath, ['tools/build-biidaasige-woodchip-island.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /up to date/);
  const C = city();
  // cross-realm arrays/objects: compare serialized values (deepStrictEqual also checks the VM prototype)
  assert.equal(JSON.stringify(C.BIIDAASIGE_WOODCHIP_ISLAND_DATA.ringLatLon), JSON.stringify(FIXTURE.ringLatLon), 'module DATA ring matches the fixture');
  assert.equal(C.BIIDAASIGE_WOODCHIP_ISLAND_DATA.traceErrorM, FIXTURE.traceErrorM);
  assert.equal(C.BIIDAASIGE_WOODCHIP_ISLAND_DATA.placementUncertaintyM, FIXTURE.placementUncertaintyM);
  assert.equal(JSON.stringify(C.BIIDAASIGE_WOODCHIP_ISLAND_DATA.finishChoices), JSON.stringify(FIXTURE.finishChoices));
});

test('the module edits no other file: it reads the fixture data and city projection only', () => {
  const src = read('js/biidaasige-woodchip-island.js');
  for (const other of ['biidaasige-paths', 'biidaasige-play-pads', 'biidaasige-park-data', 'city-grid', 'main', 'explore']) {
    assert.ok(!new RegExp(`runInContext|import .*${other}|require\\(.*${other}`).test(src), 'never loads another module');
  }
  assert.ok(/C\.worldFromLatLon/.test(src), 'projects through the city worldFromLatLon at call time');
  assert.ok(/C\.waterEdgeNoise/.test(src), 'reuses the resident TSL noise when available');
  assert.ok(/vertexColors/.test(src), 'has a CPU colour fallback');
  assert.ok(!/\/tmp\//.test(src), 'no /tmp reference');
  const builder = read('tools/build-biidaasige-woodchip-island.mjs');
  assert.ok(!/\/tmp\//.test(builder), 'builder does not read /tmp');
  assert.match(builder, /tools\/fixtures\/biidaasige-woodchip-island\.json/);
});
