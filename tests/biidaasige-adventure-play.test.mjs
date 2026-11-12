// Biidaasige Park adventure play (js/biidaasige-adventure-play.js, st-bmyv.4): the Badlands Scramble on the EXACT OSM
// footprint (way/1418541993) plus the reusable adventure factories (cableways 20/40 m, Swing Hill, mock beaver dam) and
// the seven Dodem clan animals. These tests load the ACTUAL modules (the park-data API + this module) with the real city
// projection and prove, from the real rendered THREE geometry:
//
//   1. buildBadlandsScramble() is non-null and builds on the ACTUAL OSM ring (via the existing park-data API, never a
//      private ring copy), matching way/1418541993.
//   2. The surface query returns the EXACT rendered-triangle world height (an independent real THREE downward raycast
//      agrees), answers only inside the rendered footprint, and its player-baseY/maxRise gate returns null when a step is
//      too high rather than clamping, and never increases the height on repeated calls.
//   3. The raised mesh is a real triangle mesh clipped/triangulated to the concave OSM outline (concave bays covered, no
//      floating lip — the floor is at y = 0 at the boundary), finite, +Y wound, bounded.
//   4. The query does NOT build meshes; it answers null until a build has registered one.
//   5. The adventure factories and the seven Dodem animals are UNPLACED (position null); the six non-eagle Dodem are
//      EXPLICIT placeholders (geometry unknown), never seven finished animals.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => fs.readFileSync(`${ROOT}${p}`, 'utf8');

// The real city projection, read from the committed geodata exactly as js/city-config.js does.
const PROJ = (() => {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(read('js/toronto-geodata.js'), ctx);
  return ctx.window.CITY.GEO.frame.projection;
})();
function worldFromLatLon(lat, lon) {
  const e = (lon - PROJ.lon0) * PROJ.kx, n = (lat - PROJ.lat0) * PROJ.ky;
  const c = Math.cos(PROJ.theta), s = Math.sin(PROJ.theta);
  return { x: e * c - n * s - PROJ.ox, z: -(e * s + n * c) - PROJ.oz };
}

// Load the ACTUAL park-data API and this module into one VM CITY, with the real projection (and the detail frame).
function city({ withProjection = true, withModule = true } = {}) {
  const CITY = { THREE, Addons: { mergeGeometries } };
  if (withProjection) {
    CITY.worldFromLatLon = worldFromLatLon;
    CITY.GEO = { frame: { detail: { x0: -7900, x1: 3700, z0: -3000, z1: 3600 } } };
  }
  const ctx = { window: { CITY }, console: { info() {}, warn() {}, log() {}, error() {} }, performance };
  vm.createContext(ctx);
  vm.runInContext(read('js/biidaasige-park-data.js'), ctx, { filename: 'biidaasige-park-data.js' });
  if (withModule) vm.runInContext(read('js/biidaasige-adventure-play.js'), ctx, { filename: 'biidaasige-adventure-play.js' });
  return CITY;
}

function finite(group) {
  group.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position;
    assert.ok(p, `${o.name} has positions`);
    for (let i = 0; i < p.count; i++) {
      assert.ok(Number.isFinite(p.getX(i)) && Number.isFinite(p.getY(i)) && Number.isFinite(p.getZ(i)), `${o.name} finite`);
    }
  });
}
const meshByName = (group, suffix) => group.children.find((m) => m.name.endsWith(suffix));
function xzArea(triangles) {
  let a = 0;
  for (const t of triangles) a += 0.5 * Math.abs((t.x[1] - t.x[0]) * (t.z[2] - t.z[0]) - (t.z[1] - t.z[0]) * (t.x[2] - t.x[0]));
  return a;
}

// ---------------------------------------------------------------------------------------------------------------------
test('badlands builds on the ACTUAL OSM ring from the existing park-data API (way/1418541993)', () => {
  const C = city();
  const feature = C.biidaasigeParkFeature('badlands-scramble');
  const ring = C.biidaasigeParkRingWorld('badlands-scramble');
  assert.ok(feature && feature.ref === 'way/1418541993', 'park-data carries the exact Badlands way');
  assert.ok(Array.isArray(ring) && ring.length >= 3, 'park-data projects the OSM ring to world');

  const b = C.buildBadlandsScramble();
  assert.ok(b, 'buildBadlandsScramble() is non-null with the real projection + frame');
  // the built footprint is the SAME world ring the park-data API projects (within 1 mm). The module drops the duplicated
  // closing vertex, so compare against the de-duplicated API ring.
  const api = ring.slice();
  if (Math.hypot(api[0].x - api[api.length - 1].x, api[0].z - api[api.length - 1].z) < 1e-9) api.pop();
  assert.equal(b.footprint.way, 'way/1418541993');
  assert.equal(b.footprint.ring.length, api.length);
  for (let i = 0; i < api.length; i++) {
    assert.ok(Math.hypot(b.footprint.ring[i][0] - api[i].x, b.footprint.ring[i][1] - api[i].z) < 1e-3, `ring vertex ${i} matches the API`);
  }
  // area honesty: the mapped ring's shoelace area is carried, and the official figure is recorded separately
  assert.ok(Math.abs(b.footprint.areaM2 - 1129) < 12, `mapped ring area ~1,129 m² (${b.footprint.areaM2.toFixed(0)})`);
  assert.equal(b.footprint.officialAreaM2, 1600, 'the official 1,600 m² is recorded, not conflated with the ring');
  assert.ok(b.footprint.osmAreaM2 > 0 && b.footprint.osmAreaM2 < 1600, 'OSM mapped area is below the official area');
});

test('without the projection (or outside the frame) the Badlands builds nothing (never a fabricated ring)', () => {
  assert.equal(city({ withProjection: false }).buildBadlandsScramble(), null, 'no projection -> null');
  // a frame that does not cover the park must also build nothing
  const C = city();
  C.GEO = { frame: { detail: { x0: 0, x1: 10, z0: 0, z1: 10 } } };
  assert.equal(C.buildBadlandsScramble(), null, 'frame misses the park -> null');
});

test('the walkable floor is the EXACT concave OSM outline (ear-clipped, area preserved, no convex kernel loss)', () => {
  const C = city();
  const b = C.buildBadlandsScramble();
  const q = C.__biidaasigeAdventureQuery.query;
  // the rendered triangles' summed XZ area equals the true ring area (a Sutherland–Hodgman convex clip would underfill)
  const area = xzArea(q.tris);
  assert.ok(Math.abs(area - b.footprint.areaM2) / b.footprint.areaM2 < 0.01, `mesh XZ area ${area.toFixed(0)} == ring ${b.footprint.areaM2.toFixed(0)}`);
  assert.ok(b.triangles > 800 && b.triangles < 20000, `bounded triangle budget (${Math.round(b.triangles)})`);
  finite(b.group);
});

test('the raised mesh meets the flat ground at y = 0 on the boundary (walkable seam, no floating lip)', () => {
  const C = city();
  const b = C.buildBadlandsScramble({ baseY: 0 });
  // sample just inside the OSM boundary: the blended height must be ~0 there, and the mesh never dips below the datum
  const ring = b.footprint.ring;
  let maxEdge = 0, minAll = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const A = ring[i], B = ring[(i + 1) % ring.length];
    const mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2;
    // step 0.4 m toward the centroid to stay inside
    let cx = 0, cz = 0; for (const [x, z] of ring) { cx += x; cz += z; } cx /= ring.length; cz /= ring.length;
    const d = Math.hypot(cx - mx, cz - mz) || 1, ix = mx + ((cx - mx) / d) * 0.4, iz = mz + ((cz - mz) / d) * 0.4;
    const r = b.surfaceHeightAt(ix, iz);
    if (r) maxEdge = Math.max(maxEdge, r.h);
  }
  const m = meshByName(b.group, '-terraces');
  const p = m.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) minAll = Math.min(minAll, p.getY(i));
  assert.ok(maxEdge < 0.35, `height at the boundary is near 0 (max ${maxEdge.toFixed(3)} m)`);
  assert.ok(minAll > -0.02, `the floor never dips below the datum (min ${minAll.toFixed(3)} m)`);
});

test('buildBadlandsScramble({baseY}) bakes the placement offset into BOTH the geometry and the query', () => {
  const C = city();
  const b = C.buildBadlandsScramble({ baseY: 5 });
  const m = meshByName(b.group, '-terraces');
  const p = m.geometry.attributes.position;
  const box = new THREE.Box3().setFromBufferAttribute(p);
  assert.ok(box.min.y >= 4.9 && box.max.y < 5 + b.riseTotal + 0.2, `geometry lifted by baseY (y ${box.min.y.toFixed(2)}..${box.max.y.toFixed(2)})`);
  const cx = (b.footprint.ring[0][0]), cz = (b.footprint.ring[0][1]);
  // pick an interior sample and confirm the query height sits on the lifted mesh (>= 5 - small)
  let sample = null;
  for (let i = 0; i < b.footprint.ring.length && !sample; i++) {
    const A = b.footprint.ring[i], B = b.footprint.ring[(i + 1) % b.footprint.ring.length];
    const r = b.surfaceHeightAt((A[0] + B[0]) / 2 + (cx - (A[0] + B[0]) / 2) * 0.0, (A[1] + B[1]) / 2);
    if (r) sample = r;
  }
  // the query must report heights >= baseY (the mesh is lifted), never the unlifted 0..rise values
  const anyHit = b.surfaceHeightAt((cx + b.bbox.maxX) / 2, (cz + b.bbox.maxZ) / 2);
  assert.ok(anyHit ? anyHit.h >= 5 - 1e-6 : true, 'query heights include the baseY offset');
});

test('the surface query returns the EXACT rendered triangle height — an independent THREE raycast agrees', () => {
  const C = city();
  const b = C.buildBadlandsScramble();
  const scene = new THREE.Scene();
  scene.add(b.group);
  scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const box = b.bbox;
  let checked = 0, worst = 0;
  for (let i = 0; i < 400 && checked < 120; i++) {
    const x = box.minX + (box.maxX - box.minX) * ((i * 0.618) % 1);
    const z = box.minZ + (box.maxZ - box.minZ) * ((i * 0.754 + 0.1) % 1);
    const q = b.surfaceHeightAt(x, z);
    ray.set(new THREE.Vector3(x, 60, z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(b.group, true).find((h) => h.object.name.endsWith('-terraces'));
    if (!q && !hit) continue;
    assert.ok(q && hit, `query and raycast agree on presence at (${x.toFixed(1)}, ${z.toFixed(1)})`);
    worst = Math.max(worst, Math.abs(q.h - hit.point.y));
    checked++;
  }
  assert.ok(checked > 40, `enough interior samples (${checked})`);
  assert.ok(worst < 0.01, `query height == rendered height within 1 cm (worst ${worst.toFixed(4)} m)`);
});

test('the query answers only inside the rendered footprint, never an implicit deck/plate exemption', () => {
  const C = city();
  const b = C.buildBadlandsScramble();
  assert.equal(b.surfaceHeightAt(0, 0), null, 'far away is null');
  assert.equal(b.surfaceHeightAt(b.bbox.maxX + 50, b.bbox.minZ), null, 'just outside the bbox is null');
  const c = b.footprint.ring.reduce((a, p) => [a[0] + p[0] / b.footprint.ring.length, a[1] + p[1] / b.footprint.ring.length], [0, 0]);
  assert.ok(b.surfaceHeightAt(c[0], c[1]), 'the footprint centroid answers');
});

test('player baseY + maxRise gate: a too-high step returns null (not a clamped fake), repeats never grow', () => {
  const C = city();
  const b = C.buildBadlandsScramble();
  const box = b.bbox;
  // find a high-terrace point and a low-terrace point
  let high = null, low = null;
  for (let x = box.minX; x <= box.maxX; x += 0.5) for (let z = box.minZ; z <= box.maxZ; z += 0.5) {
    const r = b.surfaceHeightAt(x, z);
    if (!r) continue;
    if (!high || r.h > high.h) high = r;
    if (!low || r.h < low.h) low = r;
  }
  assert.ok(high && low && high.h - low.h > 0.5, 'there are real terraces at different heights');
  // a player standing at the LOW terrace with a small step allowance cannot step up onto the HIGH one -> null
  const gated = b.surfaceHeightAt(high.x, high.z, { baseY: low.h, maxRise: 0.25 });
  assert.equal(gated, null, 'too high a step returns null, not a clamped height');
  // the same point with no allowance answers the true rendered height (independent of a player height)
  const bare = b.surfaceHeightAt(high.x, high.z);
  assert.ok(bare && Math.abs(bare.h - high.h) < 1e-9, 'the bare query is height-independent and exact');
  // repeated calls with an updated player height do NOT increase the returned height
  const a = b.surfaceHeightAt(high.x, high.z, { baseY: high.h - 0.1, maxRise: 1 });
  const a2 = b.surfaceHeightAt(high.x, high.z, { baseY: a.h, maxRise: 1 });
  assert.ok(a && a2, 'reachable at a close player height');
  assert.ok(Math.abs(a2.h - a.h) < 1e-9, 'repeated calls from the returned height do not grow the height');
});

test('biidaasigeAdventureSurfaceAt never builds meshes: null until a build registers a query', () => {
  const C = city();
  assert.equal(C.biidaasigeAdventureSurfaceAt(2349, 679), null, 'no registered query -> null (no fallback build)');
  assert.equal(C.__biidaasigeAdventureQuery, undefined, 'still nothing registered');
  const b = C.buildBadlandsScramble();
  assert.ok(b, 'the build registers the query');
  const q = C.biidaasigeAdventureSurfaceAt(2349, 679);
  assert.ok(q && q.id === 'badlands', 'after the build the global query answers the rendered height');
});

// ---------------------------------------------------------------------------------------------------------------------
test('cableways are the official 20 m and 40 m runs, unplaced, and clamp other requests to an official length', () => {
  const C = city();
  const c20 = C.buildCableway({ lengthM: 20 }), c40 = C.buildCableway({ lengthM: 40 });
  assert.equal(c20.lengthM, 20); assert.equal(c40.lengthM, 40);
  assert.deepEqual(Array.from(C.BIIDAASIGE_CABLEWAY_M), [20, 40]);
  for (const c of [c20, c40]) {
    assert.equal(c.position, null, 'unplaced: no invented position');
    assert.equal(c.placementStatus, 'unplaced');
    assert.equal(c.group.parent, null, 'not added to a scene by default');
    finite(c.group);
  }
  const off = C.buildCableway({ lengthM: 33 });
  assert.ok(C.BIIDAASIGE_CABLEWAY_M.includes(off.lengthM) && off.clamped, 'an unofficial length clamps to an official one');
});

test('Swing Hill and the mock beaver dam build finite, unplaced factories', () => {
  const C = city();
  const s = C.buildSwingHill({ swingCount: 3 }), d = C.buildMockBeaverDam();
  assert.equal(s.swingCount, 3);
  assert.equal(s.position, null); assert.equal(s.placementStatus, 'unplaced');
  assert.equal(d.position, null); assert.equal(d.placementStatus, 'unplaced');
  finite(s.group); finite(d.group);
});

test('the seven Dodem animals are UNPLACED; only the eagle is modelled, the six others are EXPLICIT placeholders', () => {
  const C = city();
  const set = C.buildDodemSet();
  assert.deepEqual(Object.keys(set).sort(), ['bear', 'beaver', 'eagle', 'musky', 'otter', 'turtle', 'wolf']);
  for (const k of Object.keys(set)) {
    assert.equal(set[k].position, null, `${k} is unplaced`);
    assert.equal(set[k].placementStatus, 'unplaced');
  }
  assert.equal(set.eagle.placeholder, false, 'the eagle is modelled from its primary photo');
  assert.equal(set.eagle.verifiedAppearance, true);
  for (const k of ['bear', 'beaver', 'turtle', 'otter', 'wolf', 'musky']) {
    assert.equal(set[k].placeholder, true, `${k} is an explicit placeholder (geometry unknown)`);
    assert.equal(set[k].verifiedAppearance, false, `${k} is not a verified/finished animal`);
  }
});

test('the cluster builds ONLY the Badlands (placed); the factories are deferred, not built-and-discarded', () => {
  const C = city();
  const play = C.buildBiidaasigeAdventurePlay();
  assert.ok(play.badlands, 'the Badlands is placed into the cluster');
  assert.equal(play.group.children.length, 1, 'only the Badlands group is added (factories are not built at startup)');
  assert.equal(typeof play.factories.cableway, 'function', 'the factories are exposed, deferred');
  assert.equal(play.climbable, false);
});

test('the no-mergeGeometries (concat) fallback still builds finite Badlands geometry', () => {
  const CITY = { THREE, Addons: {}, worldFromLatLon, GEO: { frame: { detail: { x0: -7900, x1: 3700, z0: -3000, z1: 3600 } } } };
  const ctx = { window: { CITY }, console: { info() {}, warn() {}, log() {}, error() {} } };
  vm.createContext(ctx);
  vm.runInContext(read('js/biidaasige-park-data.js'), ctx);
  vm.runInContext(read('js/biidaasige-adventure-play.js'), ctx);
  const b = ctx.window.CITY.buildBadlandsScramble();
  assert.ok(b && b.triangles > 500, 'builds without mergeGeometries');
  finite(b.group);
});
