// The source-correct cottage footprint pilot (js/waterfront-island-cottage-footprint.js + -data.js, st-sb3r.32).
//
// These tests load the REAL generated sidecar, the REAL committed geodata and the REAL accepted island profiles, and
// check the pilot end to end: the effective rectangle is the mapped polygon's min-bounds in the committed row's own
// yaw frame; every mapped vertex is enclosed; the guards (frame, projection, original footprint identity, confirmed
// cottage, same OSM way) refuse anything else; GEO is never mutated; and the collision helper's coordinates land exactly
// where the renderer would draw the parts. No string mirroring: the geometry is recomputed from the recorded source.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import zlib from 'node:zlib';

const readJs = (file) => fs.readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8');
const readBin = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url));

const loadBin = async (rel) => {
  let u8 = new Uint8Array(readBin(rel));
  if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = new Uint8Array(zlib.gunzipSync(u8));
  const { decodeGeo } = await import('../js/geodata-loader.js');
  return decodeGeo(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
};

const detail = await loadBin('data/toronto-geodata.bin');

const PILOT_WAY = 487167567;
const PILOT_CX = 1194.7, PILOT_CZ = 2202.9;

// window.CITY with GEO (cloned far enough that a helper cannot mutate the shared decode), then the data modules and
// the helper modules in their real load order.
function city({ geo = detail.GEO, frame = null, projection = null, withIslandData = true, withIslandModule = true, withPilotData = true, withPilotModule = true } = {}) {
  const C = { GEO: { ...geo, frame: { ...geo.frame, detail: { ...geo.frame?.detail }, projection: { ...geo.frame?.projection } } } };
  if (frame) C.GEO.frame.detail = frame;
  if (projection) C.GEO.frame.projection = projection;
  const ctx = { window: { CITY: C }, console: { info() {}, log() {}, warn() {}, error() {} } };
  vm.createContext(ctx);
  if (withIslandData) vm.runInContext(readJs('waterfront-island-buildings-data.js'), ctx, { filename: 'waterfront-island-buildings-data.js' });
  if (withIslandModule) vm.runInContext(readJs('waterfront-island-buildings.js'), ctx, { filename: 'waterfront-island-buildings.js' });
  if (withPilotData) vm.runInContext(readJs('waterfront-island-cottage-footprint-data.js'), ctx, { filename: 'waterfront-island-cottage-footprint-data.js' });
  if (withPilotModule) vm.runInContext(readJs('waterfront-island-cottage-footprint.js'), ctx, { filename: 'waterfront-island-cottage-footprint.js' });
  return ctx.window.CITY;
}

const rowAt = (geo, cx, cz, tol = 0.2) => geo.buildings.find((r) => Math.abs(r[0] - cx) < tol && Math.abs(r[1] - cz) < tol);

// The generator's exact lon/lat -> world projection, recomputed from the recorded projection.
const toWorld = (P, lon, lat) => {
  const e = (lon - P.lon0) * P.kx, n = (lat - P.lat0) * P.ky;
  const c = Math.cos(P.theta), s = Math.sin(P.theta);
  return [e * c - n * s - P.ox, -(e * s + n * c) - P.oz];
};
const ringArea = (pts) => { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]; return Math.abs(a / 2); };

test('the sidecar is source-attributed and records the old and new dimensions', () => {
  const C = city();
  const D = C.ISLAND_COTTAGE_FOOTPRINT_DATA;
  assert.ok(D && Array.isArray(D.records) && D.records.length === 1, 'one pilot record');
  assert.equal(D.summary.kind, 'island-cottage-footprint');
  assert.equal(D.summary.source.licence, 'ODbL 1.0');
  assert.match(D.summary.source.attribution, /OpenStreetMap/);
  assert.equal(D.summary.source.wayId, PILOT_WAY);
  assert.equal(typeof D.summary.source.wayVersion, 'number', 'the OSM way version is recorded');
  assert.ok(D.summary.projection && Number.isFinite(D.summary.projection.kx), 'the build projection is recorded');
  const r = D.records[0];
  assert.equal(r.osm.id, PILOT_WAY);
  assert.equal(r.typology, 'cottage');
  assert.ok(Array.isArray(r.nativeParts) && r.nativeParts.length === 1);
  assert.ok(Array.isArray(r.parts) && r.parts.length === 1);
  // old = the native committed box; new = the effective mapped min-bounds; both dimensions and areas are recorded.
  assert.equal(r.areas.nativeW, r.nativeParts[0][1] - r.nativeParts[0][0]);
  assert.equal(r.areas.nativeD, r.nativeParts[0][3] - r.nativeParts[0][2]);
  assert.ok(r.areas.effective > r.areas.native, `${r.areas.effective} > ${r.areas.native}`);
  assert.ok(r.areas.nativeToSource > 0.5 && r.areas.nativeToSource < 0.6, 'the audit ratio ~0.545 is recorded');
  assert.ok(r.shape.rectangularity >= 0.99, 'the source is near-rectangular');
  assert.ok(r.shape.axisErrDeg <= 1, 'the source is near-axis-aligned');
  assert.ok(r.checks.overlap.buildings === 0 && r.checks.overlap.streetTrees === 0 && r.checks.overlap.canopy === 0, 'no recorded conflicts');
});

test('the effective parts are exactly the source min-bounds recomputed from the recorded polygon', () => {
  const C = city();
  const D = C.ISLAND_COTTAGE_FOOTPRINT_DATA;
  const r = D.records[0];
  const row = rowAt(C.GEO, r.cx, r.cz);
  assert.ok(row, 'the committed row exists');
  const cs = Math.cos(row[2]), sn = Math.sin(row[2]);
  const local = r.sourcePolygon.lonlat.map(([lo, la]) => toWorld(D.summary.projection, lo, la))
    .map(([x, z]) => { const dx = x - row[0], dz = z - row[1]; return [dx * cs - dz * sn, dx * sn + dz * cs]; });
  const us = local.map((p) => p[0]), vs = local.map((p) => p[1]);
  const expected = [[Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)]];
  for (let k = 0; k < 4; k++) assert.ok(Math.abs(r.parts[0][k] - expected[0][k]) < 5e-4, `part[${k}] ${r.parts[0][k]} ~ ${expected[0][k]}`);
  // source area recomputed matches the recorded one
  assert.ok(Math.abs(ringArea(local) - r.source.area) < 0.01, `${ringArea(local)} ~ ${r.source.area}`);
});

test('real native identity: the committed row resolves and its parts are the recorded effective rectangle', () => {
  const C = city();
  const row = rowAt(C.GEO, PILOT_CX, PILOT_CZ);
  assert.ok(row, 'the pilot row exists');
  const p = C.islandCottageFootprintProfile(row);
  assert.ok(p, 'profile resolves for the source-bound cottage');
  assert.equal(p.sourceID, PILOT_WAY);
  assert.equal(p.osm.id, PILOT_WAY);
  const D = C.ISLAND_COTTAGE_FOOTPRINT_DATA.records[0];
  assert.deepEqual(p.parts, D.parts);
  assert.deepEqual(p.nativeParts, D.nativeParts);
  assert.ok(C.islandCottageFootprintParts(row), 'the parts convenience accessor resolves');
  assert.ok(C.islandCottageFootprintSupported());
  assert.equal(C.islandCottageFootprintSummary().pilot.osm, PILOT_WAY);
});

test('every mapped source vertex is enclosed by the effective rectangle (quantified envelope)', () => {
  const C = city();
  const row = rowAt(C.GEO, PILOT_CX, PILOT_CZ);
  const D = C.ISLAND_COTTAGE_FOOTPRINT_DATA.records[0];
  const [u0, u1, v0, v1] = D.parts[0];
  const EPS = 5e-4; // the recorded bounds are rounded to 4 decimals
  for (const [u, v] of D.sourcePolygon.local) {
    assert.ok(u >= u0 - EPS && u <= u1 + EPS && v >= v0 - EPS && v <= v1 + EPS, `vertex ${u},${v} inside ${u0},${u1},${v0},${v1}`);
  }
  // the envelope is the axis-alignment cost only: a small, measured excess over the source polygon, never a buffer.
  const effArea = (u1 - u0) * (v1 - v0);
  assert.ok(Math.abs((effArea - D.source.area) - D.shape.envelope.area) < 5e-3, 'recorded envelope area');
  assert.ok(D.shape.envelope.ratio >= 1 && D.shape.envelope.ratio <= 1.05, `envelope ratio ${D.shape.envelope.ratio} within tolerance`);
  assert.ok(D.shape.envelope.maxCornerProtrusionM >= 0 && D.shape.envelope.maxCornerProtrusionM < 0.5, 'the corner overhang is small');
});

test('no other committed building part, street tree or canopy point lies inside the effective rectangle', () => {
  const C = city();
  const D = C.ISLAND_COTTAGE_FOOTPRINT_DATA.records[0];
  const row = rowAt(C.GEO, D.cx, D.cz);
  const [cx, cz, ang] = row;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const [u0, u1, v0, v1] = D.parts[0];
  const inEff = (x, z) => { const dx = x - cx, dz = z - cz; const u = dx * cs - dz * sn, v = dx * sn + dz * cs; return u > u0 && u < u1 && v > v0 && v < v1; };
  const rowIndex = C.GEO.buildings.indexOf(row);
  const minX = Math.min(cx + u0 * cs + v0 * sn, cx + u1 * cs + v0 * sn, cx + u1 * cs + v1 * sn, cx + u0 * cs + v1 * sn) - 1;
  const maxX = Math.max(cx + u0 * cs + v0 * sn, cx + u1 * cs + v0 * sn, cx + u1 * cs + v1 * sn, cx + u0 * cs + v1 * sn) + 1;
  const minZ = Math.min(cx - u0 * sn + v0 * cs, cx - u1 * sn + v0 * cs, cx - u1 * sn + v1 * cs, cx - u0 * sn + v1 * cs) - 1;
  const maxZ = Math.max(cx - u0 * sn + v0 * cs, cx - u1 * sn + v0 * cs, cx - u1 * sn + v1 * cs, cx - u0 * sn + v1 * cs) + 1;
  // other buildings: sample each drawn part's grid (0.5 m) in the pilot frame
  let buildingHits = 0;
  for (let i = 0; i < C.GEO.buildings.length; i++) {
    if (i === rowIndex) continue;
    const r = C.GEO.buildings[i];
    if (r[0] < minX || r[0] > maxX || r[1] < minZ || r[1] > maxZ) continue;
    const rcs = Math.cos(r[2]), rsn = Math.sin(r[2]);
    for (const [a0, a1, b0, b1] of r[3]) {
      if (a1 - a0 < 1 || b1 - b0 < 1) continue;
      for (let a = a0; a <= a1; a += 0.5) for (let b = b0; b <= b1; b += 0.5) {
        if (inEff(r[0] + a * rcs + b * rsn, r[1] - a * rsn + b * rcs)) buildingHits++;
      }
    }
  }
  assert.equal(buildingHits, 0, 'no other building part inside');
  // street trees: flat [x, z, model, heightDm]
  const ST = C.GEO.streetTrees || [];
  let treeHits = 0;
  for (let i = 0; i + 3 < ST.length; i += 4) if (inEff(ST[i], ST[i + 1])) treeHits++;
  assert.equal(treeHits, 0, 'no street tree inside');
  // accepted island residential-canopy points: rows [id, x_dm, z_dm, ...]
  const canopy = JSON.parse(fs.readFileSync(new URL('../js/waterfront-island-residential-canopy-data.js', import.meta.url), 'utf8').match(/ISLAND_RESIDENTIAL_CANOPY_DATA = (\{[\s\S]*\});\s*\}\)\(\);\s*$/)[1]);
  let canopyHits = 0;
  for (const rr of canopy.rows || []) if (inEff(rr[1] / 10, rr[2] / 10)) canopyHits++;
  assert.equal(canopyHits, 0, 'no canopy point inside');
});

test('the original GEO row is never mutated by any call', () => {
  const C = city();
  const row = rowAt(C.GEO, PILOT_CX, PILOT_CZ);
  const before = JSON.stringify(row);
  C.islandCottageFootprintProfile(row);
  C.islandCottageFootprintParts(row);
  C.islandCottageFootprintAt(row, row[0], row[1]);
  C.islandCottageFootprintAt(row, row[0] + 3, row[1] + 3);
  assert.equal(JSON.stringify(row), before, 'the committed row is untouched');
  // the returned parts are copies: mutating them cannot reach the row
  const p = C.islandCottageFootprintProfile(row);
  p.parts[0][0] = 999;
  assert.notEqual(row[3][0][0], 999);
});

test('wrong frame and wrong projection are a no-op (native parts kept)', () => {
  const far = { x0: -9000, x1: -8000, z0: -9000, z1: -8000 };
  const C1 = city({ frame: far });
  const row1 = rowAt(detail.GEO, PILOT_CX, PILOT_CZ);
  assert.equal(C1.islandCottageFootprintProfile(row1), null, 'outside the frame');
  // a point inside the effective rectangle but outside the native box (u=10, v=5): true with the pilot, false on the
  // native fallback, so the guard is a real no-op rather than a silent expansion.
  const gcs = Math.cos(row1[2]), gsn = Math.sin(row1[2]);
  const [px, pz] = [row1[0] + 10 * gcs + 5 * gsn, row1[1] - 10 * gsn + 5 * gcs];
  assert.equal(city().islandCottageFootprintAt(row1, px, pz), true, 'the pilot covers the mapped-only area');
  assert.equal(C1.islandCottageFootprintAt(row1, px, pz), false, 'the far frame falls back to the native box');

  const C2 = city({ projection: { ...detail.GEO.frame.projection, kx: detail.GEO.frame.projection.kx * 1.0001 } });
  const row2 = rowAt(detail.GEO, PILOT_CX, PILOT_CZ);
  assert.equal(C2.islandCottageFootprintProfile(row2), null, 'projection mismatch');
  assert.equal(C2.islandCottageFootprintSupported(), false);
});

test('frameCovers requires BOTH the built and the active cropped frame (same projection)', () => {
  const row = rowAt(detail.GEO, PILOT_CX, PILOT_CZ);
  // The active detail frame cropped to exclude the pilot while the projection is unchanged: refused.
  const cropped = { ...detail.GEO.frame.detail, x0: -9000, x1: -8000 };
  assert.equal(city({ frame: cropped }).islandCottageFootprintProfile(row), null, 'cropped active frame refuses the row');
  // The BUILT frame crop is required too: the active frame covers the row but a built frame that excludes it must also
  // refuse (this is the case the old built-or-active test missed).
  const C = city();
  C.ISLAND_COTTAGE_FOOTPRINT_DATA.summary.frame = { ...C.ISLAND_COTTAGE_FOOTPRINT_DATA.summary.frame, x0: -9000, x1: -8000 };
  assert.ok(C.islandBuildingProfile(row), 'the accepted profile still resolves on the active frame');
  assert.equal(C.islandCottageFootprintProfile(row), null, 'a row outside the built frame is refused even when active covers it');
  // sanity: the unmodified city resolves, so it is the crop that refused it
  assert.ok(city().islandCottageFootprintProfile(row));
});

test('a missing accepted profile or a re-cut row is a no-op', () => {
  const row = rowAt(detail.GEO, PILOT_CX, PILOT_CZ);
  // no island-buildings module: the source binding cannot resolve
  assert.equal(city({ withIslandModule: false }).islandCottageFootprintProfile(row), null);
  // island-buildings module but no data
  assert.equal(city({ withIslandData: false }).islandCottageFootprintProfile(row), null);
  // data but no footprint module
  const C = city({ withPilotModule: false });
  assert.equal(typeof C.islandCottageFootprintProfile, 'undefined');
  // a re-cut row (parts changed) no longer matches the recorded original identity signature
  const C2 = city();
  const tampered = row.slice();
  tampered[3] = [[-6.3, 6.3, -4, 4.5]];
  assert.equal(C2.islandCottageFootprintProfile(tampered), null, 're-cut row refused');
  // a different, non-pilot row is never claimed
  const other = detail.GEO.buildings.find((r) => r !== row);
  assert.equal(C2.islandCottageFootprintProfile(other), null);
});

test('the collision helper coordinates match the renderer transform', () => {
  const C = city();
  const row = rowAt(C.GEO, PILOT_CX, PILOT_CZ);
  const p = C.islandCottageFootprintProfile(row);
  assert.ok(p && p.parts.length === 1);
  const [u0, u1, v0, v1] = p.parts[0];
  const [cx, cz, ang] = row;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const worldOf = (u, v) => [cx + u * cs + v * sn, cz - u * sn + v * cs];
  // each mapped source vertex must fall inside the world rectangle the renderer draws from the same parts
  for (const [u, v] of C.ISLAND_COTTAGE_FOOTPRINT_DATA.records[0].sourcePolygon.local) {
    assert.ok(u >= u0 - 5e-4 && u <= u1 + 5e-4 && v >= v0 - 5e-4 && v <= v1 + 5e-4, `vertex in part frame ${u},${v}`);
  }
  // the source centroid in world space is inside; a point well outside is not
  const cu = C.ISLAND_COTTAGE_FOOTPRINT_DATA.records[0].sourcePolygon.local;
  const cxu = cu.reduce((s, q) => s + q[0], 0) / cu.length, cxv = cu.reduce((s, q) => s + q[1], 0) / cu.length;
  const [wx, wz] = worldOf(cxu, cxv);
  assert.equal(C.islandCottageFootprintAt(row, wx, wz), true, 'source centroid inside the effective footprint');
  assert.equal(C.islandCottageFootprintAt(row, wx + 20, wz), false, 'a point beyond the long side is outside');
  assert.equal(C.islandCottageFootprintAt(row, row[0], row[1]), true, 'native centre is inside the larger effective rectangle');
  // a non-pilot row falls back to its own native parts, unchanged
  const other = detail.GEO.buildings.find((r) => r !== row);
  const op = other[3][0];
  const ocs = Math.cos(other[2]), osn = Math.sin(other[2]);
  const omu = (op[0] + op[1]) / 2, omv = (op[2] + op[3]) / 2;
  const [owx, owz] = [other[0] + omu * ocs + omv * osn, other[1] - omu * osn + omv * ocs];
  assert.equal(C.islandCottageFootprintAt(other, owx, owz), C.islandCottageFootprintAt(other, owx, owz));
  assert.equal(C.islandCottageFootprintProfile(other), null, 'no override for the non-pilot row');
});

// ---------------------------------------------------------------------------------------------------------------------
// Integration regression: the real js/buildings.js -> buildCityBlocks emits a wall box AND an OBB collider from the
// SAME effective parts for the pilot cottage, and both expand relative to the native build.
// ---------------------------------------------------------------------------------------------------------------------
import * as CORE from '../vendor/three/three.core.js';

function buildFullCity({ withPilot }) {
  const anyNode = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : anyNode), apply: () => anyNode });
  class MeshStandardNodeMaterial extends CORE.MeshStandardMaterial {}
  const win = { CITY: { THREE: { ...CORE, MeshStandardNodeMaterial }, Addons: { mergeGeometries: () => new CORE.BufferGeometry() }, DEBUG_ROADS: false } };
  win.CITY.TSL = Object.fromEntries(['Fn', 'float', 'color', 'uv', 'attribute', 'fract', 'smoothstep', 'mix', 'abs', 'positionWorld', 'normalWorldGeometry', 'fwidth'].map((n) => [n, anyNode]));
  const ctx = vm.createContext({ window: win, Math, JSON, Object, Array, Number, Map, Set, Float32Array, Float64Array, Uint8Array, Uint16Array, Uint32Array, WeakMap, Infinity, NaN, console, performance, Promise, URLSearchParams, isFinite });
  const run = (file) => vm.runInContext(readJs(file), ctx, { filename: file });
  run('toronto-geodata.js');
  run('city-config.js');
  run('waterfront-island-buildings-data.js');
  run('waterfront-island-buildings.js');
  if (withPilot) { run('waterfront-island-cottage-footprint-data.js'); run('waterfront-island-cottage-footprint.js'); }
  const batches = [];
  Object.assign(win.CITY, {
    WALL_KINDS: { shop: 0, entry: 1, rear: 2, lotLine: 3, blankStone: 4 },
    createRenderedFacadeMaterial: (o) => ({ colorNode: anyNode, userData: { opts: o } }),
    createCurtainWallMaterial: (o) => ({ colorNode: anyNode, userData: { opts: o } }),
    createFacadeBoxes: (m, boxes) => { batches.push(boxes); return new CORE.InstancedMesh(new CORE.BoxGeometry(1, 1, 1), new CORE.MeshBasicMaterial(), boxes.length); },
    createFireEscapes: () => ({ begin() {}, add() {}, end() {} })
  });
  run('buildings.js');
  const out = win.CITY.buildCityBlocks(new CORE.Scene());
  return { out, boxes: batches.flat(), CITY: win.CITY };
}

test('IMPLEMENTED: emitted wall box and OBB collider both use the effective parts and expand', { timeout: 180000 }, () => {
  const native = buildFullCity({ withPilot: false });
  const pilot = buildFullCity({ withPilot: true });
  const D = pilot.CITY.ISLAND_COTTAGE_FOOTPRINT_DATA.records[0];
  const row = rowAt(pilot.CITY.GEO, D.cx, D.cz);
  assert.ok(row, 'pilot row in the emitted city');
  const [cx, cz, ang] = row;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const [u0, u1, v0, v1] = D.parts[0];
  const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
  const wx = cx + uc * cs + vc * sn, wz = cz - uc * sn + vc * cs;
  const expHx = (u1 - u0) / 2, expHz = (v1 - v0) / 2;
  const near = (a, b, t = 0.05) => Math.abs(a - b) < t;

  // (1) the emitted OBB collider is the effective rectangle (centre, half-extents, yaw)
  const effCollider = pilot.out.colliders.find((c) => c.obb && near(c.obb.cx, wx) && near(c.obb.cz, wz) && near(c.obb.hx, expHx) && near(c.obb.hz, expHz) && near(c.obb.cs, cs, 1e-6) && near(c.obb.sn, sn, 1e-6));
  assert.ok(effCollider, 'the effective OBB collider is emitted');
  assert.ok(effCollider.maxY > 0, 'the collider has height');

  // (2) the emitted wall box is the same rectangle (so walls and collision agree)
  const effBox = pilot.boxes.find((b) => near(b.w, u1 - u0) && near(b.d, v1 - v0) && near(b.x, wx) && near(b.z, wz));
  assert.ok(effBox, 'the cottage wall box is the effective rectangle');
  assert.ok(near(effBox.ry, ang, 1e-6));

  // (3) the native build keeps the smaller box, with no expanded collider -- a real expansion, not a relabel
  const natCollider = native.out.colliders.find((c) => c.obb && near(c.obb.cx, cx) && near(c.obb.cz, cz) && near(c.obb.hx, 6.3) && near(c.obb.hz, 4.0));
  assert.ok(natCollider, 'the native build emits the 12.6 x 8 collider');
  const natBox = native.boxes.find((b) => near(b.w, 12.6) && near(b.d, 8.0) && near(b.x, cx) && near(b.z, cz));
  assert.ok(natBox, 'the native build emits the 12.6 x 8 wall box');
  assert.equal(native.out.colliders.some((c) => c.obb && near(c.obb.cx, wx) && near(c.obb.cz, wz) && near(c.obb.hx, expHx) && near(c.obb.hz, expHz)), false, 'no expanded collider without the pilot');
  assert.equal(pilot.out.colliders.some((c) => c.obb && near(c.obb.cx, cx) && near(c.obb.cz, cz) && near(c.obb.hx, 6.3) && near(c.obb.hz, 4.0)), false, 'the old native collider is not retained beside the expanded wall');
});
