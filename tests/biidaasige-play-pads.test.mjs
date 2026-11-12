// Biidaasige Park source-footprint play pads (js/biidaasige-play-pads.js, bead st-bmyv.9). Focused CPU checks that load
// the ACTUAL module into a small CITY and prove, from the REAL built THREE geometry and the common committed geodata:
//
//   1. Exactly TWO pads at the current OSM footprints ('reaching-raccoon', 'snowy-owl-playground'): rubber + woodchip,
//      the pad top is exactly y = .224 m, and the projected polygon area matches the source ring (concave-safe earcut,
//      area-covered = ring area — never a fan fill or a bounding box).
//   2. Every published `surfaces` triangle is a real upward (+Y) wound rendered triangle that an INDEPENDENT THREE
//      downward raycast hits, and C.biidaasigePlayPadAt returns that exact triangle height.
//   3. No water infill: no pad triangle bridges a water ring, and a source polygon spanning water is refused.
//   4. Works in both real frames (detail and the default eglinton frame); invalid rebuilds clear the pads (no stale
//      answers); missing data / projection / THREE builds nothing (and returns null without THREE).
//   5. colliders is [] — a ground pad is never a collider — and ONE merged mesh per source footprint (2 draws).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => fs.readFileSync(ROOT + p, 'utf8');

// Build a CITY with the real committed geodata (GEO + projection), the real park data, and the pads module.
function city({ withPark = true, withPads = true, withProjection = true, frame = null } = {}) {
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
  if (withPark) vm.runInContext(read('js/biidaasige-park-data.js'), ctx, { filename: 'biidaasige-park-data.js' });
  if (withPads) vm.runInContext(read('js/biidaasige-play-pads.js'), ctx, { filename: 'biidaasige-play-pads.js' });
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
function worldWaterRings(C) {
  const D = C.BIIDAASIGE_PARK;
  const out = [];
  for (const wg of D.waterGeometry || []) {
    if (!wg.ring) continue;
    out.push(wg.ring.map(([lat, lon]) => { const p = C.worldFromLatLon(lat, lon); return [p.x, p.z]; }));
  }
  return out;
}

test('exactly two pads at the current OSM footprints, top y = .224, projected area matches the source ring', () => {
  const C = city();
  const out = C.buildBiidaasigePlayPads(null, []);
  assert.ok(out && out.group, 'builds');
  assert.deepEqual([...out.areas.map((a) => a.id)].sort(), ['reaching-raccoon', 'snowy-owl-playground']);
  const byId = Object.fromEntries(out.areas.map((a) => [a.id, a]));
  assert.equal(byId['reaching-raccoon'].ref, 'way/1418796674', 'the actual Raccoon footprint');
  assert.equal(byId['snowy-owl-playground'].ref, 'way/1418127159', 'the generic west playground area');
  assert.equal(byId['reaching-raccoon'].material, 'rubber');
  assert.equal(byId['snowy-owl-playground'].material, 'woodchip-gravel');
  for (const a of out.areas) assert.ok(Math.abs(a.y - 0.224) < 1e-9, `${a.id} top is exactly .224`);
  assert.equal(out.stats.topY, 0.224);
  assert.equal(C.BIIDAASIGE_PLAY_PAD_TOP_Y, 0.224);

  // polygon/area match: a concave-safe earcut covers exactly the source ring's area (no fan fill, no bbox fill).
  assert.ok(Math.abs(byId['reaching-raccoon'].areaM2 - 136.7) < 1.0, `raccoon ~136.7 m2 (${byId['reaching-raccoon'].areaM2})`);
  assert.ok(Math.abs(byId['snowy-owl-playground'].areaM2 - 7116) < 20, `west bed ~7116 m2 (${byId['snowy-owl-playground'].areaM2})`);
  // one merged mesh per source footprint
  assert.equal(out.group.children.filter((m) => m.isMesh).length, 2, 'one merged mesh per source footprint');
  // colliders is [] — a ground pad is never a collider
  assert.equal(out.colliders.length, 0);
  assert.equal(C.biidaasigePlayPads.colliders.length, 0);
});

test('concave-safe triangulation covers the ring area exactly (not a fan fill)', () => {
  const C = city();
  const H = C.biidaasigePlayPadHelpers;
  const ring = [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 6 }, { x: 0, z: 6 }];
  const geo = H.padGeometry(THREE, ring, 0.224);
  const pos = geo.attributes.position;
  let area = 0;
  for (let t = 0; t + 2 < pos.count; t += 3) {
    const ax = pos.getX(t), az = pos.getZ(t), bx = pos.getX(t + 1), bz = pos.getZ(t + 1), cx = pos.getX(t + 2), cz = pos.getZ(t + 2);
    area += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
  }
  assert.ok(Math.abs(area - 20) < 1e-6, `L-shaped ring area 20 (triangulated ${area})`);
  assert.ok(pos.count / 3 > 2, 'concave shape takes more than the fan-fill two triangles');

  // the real footprints also triangulate to their ring area
  const D = C.BIIDAASIGE_PARK;
  for (const id of ['reaching-raccoon', 'snowy-owl-playground']) {
    const f = D.features.find((x) => x.id === id);
    const r = f.ring.map(([la, lo]) => { const p = C.worldFromLatLon(la, lo); return { x: p.x, z: p.z }; });
    const g = H.padGeometry(THREE, r, 0.224);
    const p = g.attributes.position;
    let a = 0;
    for (let t = 0; t + 2 < p.count; t += 3) {
      const ax = p.getX(t), az = p.getZ(t), bx = p.getX(t + 1), bz = p.getZ(t + 1), cx = p.getX(t + 2), cz = p.getZ(t + 2);
      a += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
    }
    assert.ok(Math.abs(a - H.ringArea(r)) < 0.5, `${id} triangulated area = ring area (${a.toFixed(1)} vs ${H.ringArea(r).toFixed(1)})`);
  }
});

test('every surface triangle is upward-wound and hit by an INDEPENDENT three.js downward raycast at y=.224', () => {
  const C = city();
  const scene = new THREE.Scene();
  const out = C.buildBiidaasigePlayPads(scene, []);
  scene.updateMatrixWorld(true);
  assert.ok(out.surfaces.length > 60, 'real triangle set published');
  for (const s of out.surfaces) assert.ok(triNormalY(s.triangle) > 0.9, 'each published triangle faces up (flat pad)');

  const ray = new THREE.Raycaster();
  let checked = 0;
  for (const s of out.surfaces) {
    const T = s.triangle;
    const x = (T[0] + T[3] + T[6]) / 3, z = (T[2] + T[5] + T[8]) / 3;
    ray.set(new THREE.Vector3(x, 20, z), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObject(out.group, true);
    const top = hits.find((h) => Math.abs(h.point.y - 0.224) < 1e-4);
    assert.ok(top, 'the published triangle is really visible to a downward ray at its own height');
    const q = C.biidaasigePlayPadAt(x, z);
    assert.ok(q && q.onPad, 'query finds the pad');
    assert.ok(Math.abs(q.surfaceY - 0.224) < 1e-4, 'query returns the exact .224 height');
    checked++;
  }
  assert.ok(checked === out.surfaces.length, 'every published triangle checked');
  // off the pads -> null (never a clamped/global answer)
  assert.equal(C.biidaasigePlayPadAt(0, 0), null);
});

test('NO water infill: no pad triangle centres in a water ring, and a source polygon spanning water is refused', () => {
  const C = city();
  const out = C.buildBiidaasigePlayPads(null, []);
  const waters = worldWaterRings(C);
  for (const s of out.surfaces) {
    const T = s.triangle;
    const cx = (T[0] + T[3] + T[6]) / 3, cz = (T[2] + T[5] + T[8]) / 3;
    for (const w of waters) assert.ok(!pointInRing(w, cx, cz), 'no pad triangle lies in the river/wetland water');
  }
  // a fabricated source polygon that spans the western water ring is refused, never bridged
  const D = C.BIIDAASIGE_PARK;
  const owl = D.features.find((f) => f.id === 'snowy-owl-playground');
  const water = D.waterGeometry.find((w) => w.ring && w.ring.length >= 3);
  D.waterGeometry = [{ ref: 'test-river', ring: owl.ring.map((r) => r.slice()) }];
  const out2 = C.buildBiidaasigePlayPads(null, []);
  assert.deepEqual([...out2.areas.map((a) => a.id)], ['reaching-raccoon'], 'the water-spanning pad is refused');
  assert.ok(out2.skipped.some((s) => s.id === 'snowy-owl-playground' && /water/.test(s.reason)), 'and reported, not silently dropped');
  assert.ok(water, 'the real data has a water ring');
});

test('works in BOTH real frames (detail and the default eglinton frame), same pads and areas', () => {
  const detail = city();
  const dOut = detail.buildBiidaasigePlayPads(null, []);
  const egl = city({ frame: { x0: -7900, x1: 9600, z0: -7300, z1: 3600 } }); // tools/frames/eglinton.json world box
  const eOut = egl.buildBiidaasigePlayPads(null, []);
  assert.deepEqual([...eOut.areas.map((a) => a.id)].sort(), [...dOut.areas.map((a) => a.id)].sort(), 'both frames build the same two pads');
  for (let i = 0; i < dOut.areas.length; i++) {
    assert.equal(eOut.areas[i].areaM2, dOut.areas[i].areaM2, `${dOut.areas[i].id} area is frame-invariant (same projection)`);
  }
});

test('a rebuild after the source changes drops stale pads (no stale results after an invalid rebuild)', () => {
  const C = city();
  const first = C.buildBiidaasigePlayPads(null, []);
  const raccoon = first.areas.find((a) => a.id === 'reaching-raccoon');
  const raccoonTris = first.surfaces.filter((s) => s.kind === 'rubber');
  const T = raccoonTris[0].triangle;
  const px = (T[0] + T[3] + T[6]) / 3, pz = (T[2] + T[5] + T[8]) / 3;
  assert.ok(C.biidaasigePlayPadAt(px, pz), 'on the Raccoon pad before the change');
  C.BIIDAASIGE_PARK.features = C.BIIDAASIGE_PARK.features.filter((f) => f.id !== 'reaching-raccoon');
  const second = C.buildBiidaasigePlayPads(null, []);
  assert.deepEqual([...second.areas.map((a) => a.id)], ['snowy-owl-playground'], 'the removed pad is gone');
  assert.equal(C.biidaasigePlayPadAt(px, pz), null, 'no stale answer from the removed pad');
  assert.equal(C.biidaasigePlayPads.areas.length, 1, 'the exposed record is replaced, not merged');
});

test('missing data / projection / THREE builds nothing and never throws', () => {
  let C = city({ withPark: false });
  let out = C.buildBiidaasigePlayPads(null, []);
  assert.ok(out && Array.isArray(out.areas) && out.areas.length === 0);
  assert.match(out.stats.reason, /BIIDAASIGE_PARK data missing/);
  assert.equal(C.biidaasigePlayPadAt(0, 0), null);

  C = city({ withProjection: false });
  out = C.buildBiidaasigePlayPads(null, []);
  assert.equal(out.areas.length, 0);
  assert.match(out.stats.reason, /projection unavailable/);

  // no THREE -> null (never a throw)
  const ctx2 = { window: { CITY: { THREE } }, console: { info() {}, warn() {}, log() {}, error() {} }, performance };
  vm.createContext(ctx2);
  vm.runInContext(read('js/biidaasige-play-pads.js'), ctx2, { filename: 'biidaasige-play-pads.js' });
  delete ctx2.window.CITY.THREE;
  assert.equal(ctx2.window.CITY.buildBiidaasigePlayPads(null, null), null);
});

test('the module edits no other file: it reads the park data and city projection only', () => {
  const src = read('js/biidaasige-play-pads.js');
  for (const other of ['biidaasige-paths', 'biidaasige-play-infrastructure', 'biidaasige-park-data', 'city-grid', 'main']) {
    assert.ok(!new RegExp(`runInContext|import .*${other}|require\\(.*${other}`).test(src), 'never loads another module');
  }
  assert.ok(/C\.worldFromLatLon/.test(src), 'projects through the city worldFromLatLon at call time');
});
