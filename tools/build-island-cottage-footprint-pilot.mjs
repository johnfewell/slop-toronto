#!/usr/bin/env node
// tools/build-island-cottage-footprint-pilot.mjs — the one bounded source-correct footprint pilot (bead st-sb3r.32).
//
// The audit (docs/waterfront-island-cottage-footprint-audit.md, tools/audit-island-cottage-footprints.mjs) found exactly
// one nearly-rectangular cottage whose rendered footprint loses most of its mapped mass: OSM way 487167567 on Nottawa
// Avenue (7 Nottawa Avenue), native committed part [-6.3, 6.3, -4, 4] (12.6 x 8 = 100.8 m^2), source polygon
// rectangularity 0.999, rendered/source area ratio 0.545. Rather than rewriting the shape of every island row, this
// tool writes ONE source-matched "effective rectangle" for that row and nothing else.
//
// What it does, and what it deliberately does NOT do
// --------------------------------------------------
//  * It reads the real mapped way from the cached Overpass response the island build matched against (ODbL) and,
//    optionally, an OSM API way/full response to record the way version + timestamp and cross-check the live geometry.
//  * It projects the source polygon with the generator's exact `toWorld` (data/toronto-geodata.bin frame projection),
//    rotates it into the committed row's own yaw frame, and takes the axis-aligned MIN-BOUNDS as the effective
//    rectangle. The source is a genuine rectangle (rectangularity >= 0.99, axis error <= 1 deg), so the min-bounds is a
//    faithful envelope, not an invented notch fill. The small envelope the axis-alignment costs is measured and recorded;
//    there is ZERO added buffer beyond it.
//  * It refuses to write unless the guards and the overlap checks pass: the way is the one the island build bound to this
//    row, the committed row still carries the original footprint signature, the row is a confirmed `cottage`, the source
//    is near-axis-aligned and near-rectangular, and the effective rectangle overlaps NO other committed building, NO
//    GEO.streetTree and NO accepted island residential-canopy point. A real conflict fails the build (it never nudges or
//    deletes another mapped trunk or house to force a fit); the pilot would then be reconsidered, not stretched.
//  * It never edits js/buildings.js, the colliders, GEO, the accepted profiles or any other module: it only writes the
//    sidecar data. The captain routes the same effective parts to the walls, roof, trim and the OBB collider producer.
//
// Sources (all recorded in the output): OpenStreetMap contributors (ODbL 1.0) for the footprint; the committed geodata
// for the frame + rows; js/waterfront-island-buildings-data.js for the cottage source binding.
//
// Usage:
//   node tools/build-island-cottage-footprint-pilot.mjs                       # cached source, no live cross-check
//   node tools/build-island-cottage-footprint-pilot.mjs --way <way.json>      # + OSM API way/full for version + check
//   node tools/build-island-cottage-footprint-pilot.mjs --dry-run --json      # machine report, write nothing
//
// Exit 0 = the pilot was built (or, with --dry-run, fully validated). Exit 1 = a required input is missing/malformed,
// a guard/overlap check failed, or the live geometry disagrees with the cache. It fails loudly; it never writes a
// partial or unverified sidecar.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { unpackGeo } from '../js/geodata-loader.js';
import os from 'node:os';
// Private research cache (reference downloads that never ship): set WATERFRONT_RESEARCH to its folder.
const WATERFRONT_RESEARCH = process.env.WATERFRONT_RESEARCH || path.join(os.tmpdir(), 'waterfront-research');
const researchLabel = (p) => (p.startsWith(WATERFRONT_RESEARCH) ? '$WATERFRONT_RESEARCH' + p.slice(WATERFRONT_RESEARCH.length) : path.basename(p));

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = path.join(ROOT, 'js/waterfront-island-cottage-footprint-data.js');
const ISO_DAY = new Date().toISOString().slice(0, 10);

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes('--dry-run');
const AS_JSON = args.includes('--json');

// The single pilot target (st-sb3r.32): the near-rectangular Nottawa cottage the audit identified.
const PILOT_WAY = 487167567;
const BUILDINGS_IN = opt('--buildings') || path.join(WATERFRONT_RESEARCH, 'research/island-cottages/b.json');
const WAY_IN = opt('--way');
const OUT_FILE = opt('--out') || OUT;
const SOURCE_URL = 'https://overpass-api.de/api/interpreter';
const BUILDING_QUERY = '[out:json][timeout:90];way["building"](43.605,-79.405,43.6345,-79.338);out geom tags;';

// Acceptance tolerances for the pilot (measured, then asserted). A source that misses any of these is not a rectangle
// the renderer may claim: it is left on its native footprint and the pilot is reported as infeasible.
const MIN_RECTANGULARITY = 0.99; // source area / its minimum-area rectangle
const MAX_AXIS_ERROR_DEG = 1.0;  // source long axis vs the row's own axes, folded mod 90
const MAX_ENVELOPE_RATIO = 1.05; // axis-aligned min-bounds area / source polygon area
const MIN_PART_DIM = 1.0;        // the renderer only draws parts >= 1 m (js/buildings.js)

function fail(msg) { console.error(`[island-cottage-footprint-pilot] ${msg}`); process.exit(1); }
const round = (v, d = 3) => (Number.isFinite(v) ? +v.toFixed(d) : null);

// ---------------------------------------------------------------------------------------------------------------------
// Geometry (the same measures the audit uses)
// ---------------------------------------------------------------------------------------------------------------------
const ringArea = (pts) => { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]; return Math.abs(a / 2); };
function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = []; for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  const up = []; for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop(); return lo.concat(up);
}
function minAreaRect(pts) {
  const h = hull(pts); let best = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(ang), s = Math.sin(ang);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of h) { const u = x * c + y * s, v = -x * s + y * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, ang, w: u1 - u0, d: v1 - v0 };
  }
  return best;
}
const mod90 = (a) => { a %= Math.PI / 2; return a < 0 ? a + Math.PI / 2 : a; };
const angDiff90 = (a, b) => { const d = Math.abs(mod90(a) - mod90(b)) % (Math.PI / 2); return Math.min(d, Math.PI / 2 - d); };
const distPtSeg = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az; const l2 = dx * dx + dz * dz || 1e-9; const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)); return Math.hypot(ax + dx * t - px, az + dz * t - pz); };

// ---------------------------------------------------------------------------------------------------------------------
// Exact rectangle overlap (separating-axis theorem on two transformed rectangles in the ground plane)
// ---------------------------------------------------------------------------------------------------------------------
// The audit's building overlap probe sampled a 0.25 m grid inside each other part; a narrow intersection — a thin part
// crossing ours, or a thin other rectangle threading a lens between sampled points — can fall entirely between samples
// and be missed ("0 conflicts" would then be false). These are exact and sample-free, so a real intersection is always
// caught and a clean one never reported. A rectangle is described as an oriented box in world XZ:
//   { x, z, ux, uz, vx, vz, hu, hv } — centre; the two unit axes (u along the part's local +u, v along +v) and half-sizes.
// A part in a committed row is row-local [a0,a1,b0,b1] inside a row yaw (same placement js/buildings.js uses:
// X = cx + lu·cos + lv·sin, Z = cz − lu·sin + lv·cos).
const RECT_TOUCH_EPS = 1e-7; // m: below this the boxes only touch (shared edge/corner), which we do NOT count

function rowPartObb(cx, cz, yaw, a0, a1, b0, b1) {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const mu = (a0 + a1) / 2, mv = (b0 + b1) / 2;
  return {
    x: cx + mu * cs + mv * sn, z: cz - mu * sn + mv * cs, // the part's own centre in world
    ux: cs, uz: -sn, vx: sn, vz: cs,                      // row yaw axes in world (match buildings.js)
    hu: Math.abs(a1 - a0) / 2, hv: Math.abs(b1 - b0) / 2
  };
}

// Separating-axis test: two oriented rectangles intersect (positive-area overlap) iff no axis separates them. The
// candidate axes are each rectangle's two edge normals. A projection gap of >= -eps on any axis means disjoint or
// boundary-only contact, so touching edges/corners are consistently ignored. Returns true only for a real overlap.
function obbOverlap(A, B, eps = RECT_TOUCH_EPS) {
  const dx = B.x - A.x, dz = B.z - A.z;
  for (const [ax, az] of [[A.ux, A.uz], [A.vx, A.vz], [B.ux, B.uz], [B.vx, B.vz]]) {
    const dist = Math.abs(dx * ax + dz * az);
    const rA = A.hu * Math.abs(A.ux * ax + A.uz * az) + A.hv * Math.abs(A.vx * ax + A.vz * az);
    const rB = B.hu * Math.abs(B.ux * ax + B.uz * az) + B.hv * Math.abs(B.vx * ax + B.vz * az);
    if (dist >= rA + rB - eps) return false; // an axis separates them (or they only touch)
  }
  return true;
}

// Two committed buildings overlap iff any drawn part (>= MIN_PART_DIM) of either intersects any drawn part of the other.
// This is the exact replacement for the removed 0.25 m in-rectangle grid sample.
function partsOverlapParts(partsA, yawA, cxA, czA, partsB, yawB, cxB, czB) {
  const obbA = partsA.filter(([a0, a1, b0, b1]) => a1 - a0 >= MIN_PART_DIM && b1 - b0 >= MIN_PART_DIM)
    .map(([a0, a1, b0, b1]) => rowPartObb(cxA, czA, yawA, a0, a1, b0, b1));
  const obbB = partsB.filter(([a0, a1, b0, b1]) => a1 - a0 >= MIN_PART_DIM && b1 - b0 >= MIN_PART_DIM)
    .map(([a0, a1, b0, b1]) => rowPartObb(cxB, czB, yawB, a0, a1, b0, b1));
  for (const A of obbA) for (const B of obbB) if (obbOverlap(A, B)) return true;
  return false;
}

// The pure geometry above is exported so the focused overlap regression (tests/waterfront-cottage-overlap.test.mjs)
// can exercise it; importing this module never reads inputs or writes the sidecar.
export { rowPartObb, obbOverlap, partsOverlapParts };

// Everything below runs only when executed as the tool (not when imported by a test), so the pure helpers stay importable.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) main();

async function main() {
// ---------------------------------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------------------------------
if (!fs.existsSync(BUILDINGS_IN)) {
  fail(`cached source missing: ${BUILDINGS_IN}\n  Re-fetch with:\n  curl -sS -A 'slop-toronto build-island-cottage-footprint-pilot/1.0' ` +
    `--data-urlencode 'data=${BUILDING_QUERY}' ${SOURCE_URL} > ${BUILDINGS_IN}`);
}
const buildingsRaw = fs.readFileSync(BUILDINGS_IN);
const sourceSha256 = crypto.createHash('sha256').update(buildingsRaw).digest('hex');
let buildingsJson;
try { buildingsJson = JSON.parse(buildingsRaw.toString('utf8')); } catch (e) { fail(`${BUILDINGS_IN} is not JSON: ${e.message}`); }
const sourceElements = buildingsJson.elements;
if (!Array.isArray(sourceElements) || !sourceElements.length) fail(`${BUILDINGS_IN} has no .elements`);

const { GEO } = await unpackGeo(fs.readFileSync(path.join(ROOT, 'data/toronto-geodata.bin')));
if (!GEO || !Array.isArray(GEO.buildings) || !GEO.frame || !GEO.frame.projection || !GEO.frame.detail) fail('GEO missing buildings/frame/projection');
const P = GEO.frame.projection;
const DETAIL = GEO.frame.detail;
const toWorld = (lon, lat) => {
  const e = (lon - P.lon0) * P.kx, n = (lat - P.lat0) * P.ky;
  const c = Math.cos(P.theta), s = Math.sin(P.theta);
  return [e * c - n * s - P.ox, -(e * s + n * c) - P.oz];
};

// The accepted island profiles: the source binding (which OSM way this row is, and that it is a confirmed cottage).
const islandData = fs.readFileSync(path.join(ROOT, 'js/waterfront-island-buildings-data.js'), 'utf8');
const im = islandData.match(/C\.ISLAND_BUILDINGS_DATA = (\{[\s\S]*\});\s*\}\)\(\);\s*$/);
if (!im) fail('could not parse C.ISLAND_BUILDINGS_DATA from js/waterfront-island-buildings-data.js');
const island = JSON.parse(im[1]);
if (!Array.isArray(island.records)) fail('ISLAND_BUILDINGS_DATA.records is not an array');
const profile = island.records.find((r) => r.osm && r.osm.id === PILOT_WAY);
if (!profile) fail(`OSM way ${PILOT_WAY} is not in the accepted island profiles; the pilot is not source-bound`);
if (profile.typology !== 'cottage') fail(`OSM way ${PILOT_WAY} is typology "${profile.typology}", not a cottage; refusing the pilot`);

// The committed row at the record's centre, whose ORIGINAL footprint signature must still match (identity guard).
const footprintSignature = (r) => JSON.stringify([Math.round(r[2] * 1000) / 1000, r[3].map((p) => p.map((v) => Math.round(v * 10) / 10))]);
const key = `${(+profile.cx).toFixed(1)},${(+profile.cz).toFixed(1)}`;
const rowIndex = GEO.buildings.findIndex((r) => `${r[0].toFixed(1)},${r[1].toFixed(1)}` === key);
if (rowIndex < 0) fail(`no committed row at ${key} (the profile's centre)`);
const row = GEO.buildings[rowIndex];
if (!Array.isArray(row[3]) || !row[3].length) fail('committed row has no parts');
const nativeFp = footprintSignature(row);
if (nativeFp !== profile.fp) fail(`committed row footprint signature ${nativeFp} != accepted profile ${profile.fp} (re-cut/moved); refusing the pilot`);

// The cached source way.
const way = sourceElements.find((e) => e.type === 'way' && e.id === PILOT_WAY && Array.isArray(e.geometry) && e.geometry.length >= 3);
if (!way) fail(`OSM way ${PILOT_WAY} with geometry is not in ${BUILDINGS_IN}`);
const lonlat = way.geometry.map((g) => [g.lon, g.lat]);
if (lonlat.some(([lo, la]) => !Number.isFinite(lo) || !Number.isFinite(la))) fail(`OSM way ${PILOT_WAY} has a non-finite vertex`);

// Optional live OSM API way/full: record version + timestamp and cross-check the geometry (order-insensitive).
let wayVersion = way.version ?? null, wayTimestamp = way.timestamp ?? null, liveChecked = false;
if (WAY_IN) {
  if (!fs.existsSync(WAY_IN)) fail(`--way file missing: ${WAY_IN}`);
  let live;
  try { live = JSON.parse(fs.readFileSync(WAY_IN, 'utf8')); } catch (e) { fail(`--way ${WAY_IN} is not JSON: ${e.message}`); }
  const els = live.elements || [];
  const lw = els.find((e) => e.type === 'way' && e.id === PILOT_WAY);
  if (!lw) fail(`--way ${WAY_IN} does not contain way ${PILOT_WAY}`);
  const byId = new Map(els.filter((e) => e.type === 'node').map((e) => [e.id, e]));
  const liveLonLat = Array.isArray(lw.geometry) && lw.geometry.length
    ? lw.geometry.map((g) => [g.lon, g.lat])
    : (lw.nodes || []).map((id) => byId.get(id)).filter(Boolean).map((n) => [n.lon, n.lat]);
  if (!liveLonLat.length) fail(`--way ${WAY_IN} has no usable geometry for way ${PILOT_WAY}`);
  const maxDelta = (a, b) => { if (a.length !== b.length) return Infinity; let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1])); return m; };
  const dFwd = maxDelta(lonlat, liveLonLat);
  const dRev = maxDelta(lonlat, liveLonLat.slice().reverse());
  const dMin = Math.min(dFwd, dRev);
  if (!(dMin <= 1e-9)) fail(`live geometry of way ${PILOT_WAY} differs from the cache (max vertex delta ${dMin}); refusing the pilot`);
  wayVersion = lw.version ?? wayVersion;
  wayTimestamp = lw.timestamp ?? wayTimestamp;
  liveChecked = true;
}

// ---------------------------------------------------------------------------------------------------------------------
// The effective rectangle (source polygon -> world -> row yaw frame -> axis-aligned min-bounds)
// ---------------------------------------------------------------------------------------------------------------------
const world = lonlat.map(([lo, la]) => toWorld(lo, la));
const [cx, cz, yaw, nativeParts] = row;
const cs = Math.cos(yaw), sn = Math.sin(yaw);
const local = world.map(([x, z]) => { const dx = x - cx, dz = z - cz; return [dx * cs - dz * sn, dx * sn + dz * cs]; });
const u = local.map((p) => p[0]), v = local.map((p) => p[1]);
const effParts = [[Math.min(...u), Math.max(...u), Math.min(...v), Math.max(...v)]];
const effW = effParts[0][1] - effParts[0][0], effD = effParts[0][3] - effParts[0][2];

const sourceArea = ringArea(local);
const mar = minAreaRect(local);
const rawLong = mar.w >= mar.d ? mar.ang : mar.ang + Math.PI / 2;
const axisErrDeg = angDiff90(rawLong, 0) * 180 / Math.PI;
const rectangularity = sourceArea / mar.area;
const effArea = effW * effD;
const envelopeArea = effArea - sourceArea;
const envelopeRatio = effArea / sourceArea;
let maxCornerProtrusionM = 0;
for (const [ux, vx] of [[effParts[0][0], effParts[0][2]], [effParts[0][1], effParts[0][2]], [effParts[0][1], effParts[0][3]], [effParts[0][0], effParts[0][3]]]) {
  let mind = Infinity;
  for (let i = 0; i < local.length - 1; i++) mind = Math.min(mind, distPtSeg(ux, vx, local[i][0], local[i][1], local[i + 1][0], local[i + 1][1]));
  maxCornerProtrusionM = Math.max(maxCornerProtrusionM, mind);
}
const nativeArea = nativeParts.reduce((s, [a1, a2, b1, b2]) => s + (a2 - a1) * (b2 - b1), 0);

// --- guards on the source shape --------------------------------------------------------------------------------------
if (!(rectangularity >= MIN_RECTANGULARITY)) fail(`source rectangularity ${rectangularity} < ${MIN_RECTANGULARITY}; the outline is not a rectangle`);
if (!(axisErrDeg <= MAX_AXIS_ERROR_DEG)) fail(`source axis error ${axisErrDeg} deg > ${MAX_AXIS_ERROR_DEG}; the envelope would be too loose`);
if (!(envelopeRatio <= MAX_ENVELOPE_RATIO)) fail(`envelope ratio ${envelopeRatio} > ${MAX_ENVELOPE_RATIO}`);
for (const [u0, u1, v0, v1] of effParts) {
  if (!Number.isFinite(u0) || !Number.isFinite(u1) || !Number.isFinite(v0) || !Number.isFinite(v1)) fail('effective part has a non-finite bound');
  if (u1 - u0 < MIN_PART_DIM || v1 - v0 < MIN_PART_DIM) fail(`effective part ${u1 - u0} x ${v1 - v0} below the ${MIN_PART_DIM} m the renderer draws`);
}
if (!(effArea > nativeArea)) fail('effective area is not larger than the native part; nothing to correct');

// ---------------------------------------------------------------------------------------------------------------------
// Overlap checks (source vs the real committed world): fail on any real conflict, never nudge the other object
// ---------------------------------------------------------------------------------------------------------------------
const localToWorld = (lu, lv) => [cx + lu * cs + lv * sn, cz - lu * sn + lv * cs];
const inEff = (lu, lv) => lu > effParts[0][0] && lu < effParts[0][1] && lv > effParts[0][2] && lv < effParts[0][3];
const worldToLocal = (x, z) => { const dx = x - cx, dz = z - cz; return [dx * cs - dz * sn, dx * sn + dz * cs]; };
const corners = [[effParts[0][0], effParts[0][2]], [effParts[0][1], effParts[0][2]], [effParts[0][1], effParts[0][3]], [effParts[0][0], effParts[0][3]]].map(([lu, lv]) => localToWorld(lu, lv));
const worldMinX = Math.min(...corners.map((p) => p[0])), worldMaxX = Math.max(...corners.map((p) => p[0]));
const worldMinZ = Math.min(...corners.map((p) => p[1])), worldMaxZ = Math.max(...corners.map((p) => p[1]));

// 1. other committed buildings: exact separating-axis intersection of the effective rectangle with each DRAWN part
//    rectangle (both transformed into world space). This replaces the old 0.25 m point grid, which could step over a
//    thin crossing; boundary-only contact (grazing) is ignored. The world-AABB test is only a cheap early-out.
const buildingConflicts = [];
for (let i = 0; i < GEO.buildings.length; i++) {
  if (i === rowIndex) continue;
  const r = GEO.buildings[i];
  if (!Array.isArray(r[3])) continue;
  const rcs = Math.cos(r[2]), rsn = Math.sin(r[2]);
  let rx0 = Infinity, rx1 = -Infinity, rz0 = Infinity, rz1 = -Infinity;
  for (const [a0, a1, b0, b1] of r[3]) for (const [lu, lv] of [[a0, b0], [a1, b0], [a1, b1], [a0, b1]]) {
    const X = r[0] + lu * rcs + lv * rsn, Z = r[1] - lu * rsn + lv * rcs;
    rx0 = Math.min(rx0, X); rx1 = Math.max(rx1, X); rz0 = Math.min(rz0, Z); rz1 = Math.max(rz1, Z);
  }
  if (rx1 < worldMinX || rx0 > worldMaxX || rz1 < worldMinZ || rz0 > worldMaxZ) continue;
  if (partsOverlapParts(effParts, yaw, cx, cz, r[3], r[2], r[0], r[1])) {
    buildingConflicts.push({ row: i, cx: r[0], cz: r[1], name: r[9] || null, parts: r[3].length });
  }
}

// 2. GEO.streetTrees (flat [x, z, model, heightDm]): any inside; report the nearest for context.
const ST = GEO.streetTrees || [];
let treeInside = 0, nearestTreeM = Infinity, nearestTree = null;
for (let i = 0; i + 3 < ST.length; i += 4) {
  const [lu, lv] = worldToLocal(ST[i], ST[i + 1]);
  const du = Math.max(effParts[0][0] - lu, 0, lu - effParts[0][1]), dv = Math.max(effParts[0][2] - lv, 0, lv - effParts[0][3]);
  const d = Math.hypot(du, dv);
  if (d > 0 && d < nearestTreeM) { nearestTreeM = d; nearestTree = [ST[i], ST[i + 1]]; }
  if (inEff(lu, lv)) treeInside++;
}

// 3. the accepted island residential-canopy rows ([id, x_dm, z_dm, h_cm, ...]): any inside.
const canopyPath = path.join(ROOT, 'js/waterfront-island-residential-canopy-data.js');
let canopyInside = 0, nearestCanopyM = Infinity, nearestCanopy = null;
if (fs.existsSync(canopyPath)) {
  const cm = fs.readFileSync(canopyPath, 'utf8').match(/ISLAND_RESIDENTIAL_CANOPY_DATA = (\{[\s\S]*\});\s*\}\)\(\);\s*$/);
  const rows = cm ? (JSON.parse(cm[1]).rows || []) : [];
  for (const rr of rows) {
    if (!Array.isArray(rr)) continue;
    const x = rr[1] / 10, z = rr[2] / 10;
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    const [lu, lv] = worldToLocal(x, z);
    const du = Math.max(effParts[0][0] - lu, 0, lu - effParts[0][1]), dv = Math.max(effParts[0][2] - lv, 0, lv - effParts[0][3]);
    const d = Math.hypot(du, dv);
    if (d > 0 && d < nearestCanopyM) { nearestCanopyM = d; nearestCanopy = [x, z]; }
    if (inEff(lu, lv)) canopyInside++;
  }
}

const conflicts = buildingConflicts.length + treeInside + canopyInside;
if (conflicts > 0) {
  console.error(`[island-cottage-footprint-pilot] the effective rectangle conflicts with the committed world; refusing to force a fit:`);
  for (const c of buildingConflicts.slice(0, 10)) console.error(`  building row ${c.row} at ${c.cx},${c.cz}${c.name ? ` "${c.name}"` : ''} (${c.parts} parts)`);
  if (treeInside) console.error(`  ${treeInside} GEO.streetTree(s) inside`);
  if (canopyInside) console.error(`  ${canopyInside} accepted island canopy point(s) inside`);
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------------------------------
// The sidecar
// ---------------------------------------------------------------------------------------------------------------------
const provenance = {
  name: 'OpenStreetMap building footprint (ODbL)',
  licence: 'ODbL 1.0',
  attribution: '© OpenStreetMap contributors, ODbL 1.0',
  url: SOURCE_URL,
  query: BUILDING_QUERY,
  cache: researchLabel(BUILDINGS_IN),
  cacheSha256: sourceSha256,
  cacheElements: sourceElements.length,
  osmTimestamp: buildingsJson.osm3s?.timestamp_osm_base || null,
  generator: buildingsJson.generator || null,
  apiUrl: `https://api.openstreetmap.org/api/0.6/way/${PILOT_WAY}/full.json`,
  wayId: PILOT_WAY,
  wayVersion,
  wayTimestamp,
  liveChecked,
  fetched: ISO_DAY
};
const record = {
  cx: +cx.toFixed(1), cz: +cz.toFixed(1),
  yaw: Math.round(yaw * 1000) / 1000,
  nativeFp,
  nativeParts: nativeParts.map((p) => p.slice()),
  parts: effParts.map((p) => p.map((x) => +x.toFixed(4))),
  osm: { type: 'way', id: PILOT_WAY, version: wayVersion },
  typology: 'cottage',
  matchM: profile.matchM,
  sourcePolygon: {
    lonlat: lonlat.map((p) => p.slice()),
    world: world.map((p) => p.map((x) => +x.toFixed(3))),
    local: local.map((p) => p.map((x) => +x.toFixed(4)))
  },
  source: { area: round(sourceArea, 4), marW: round(mar.w, 4), marD: round(mar.d, 4), marArea: round(mar.area, 4) },
  areas: {
    native: round(nativeArea, 4), nativeW: round(nativeParts[0][1] - nativeParts[0][0], 4), nativeD: round(nativeParts[0][3] - nativeParts[0][2], 4),
    source: round(sourceArea, 4), effective: round(effArea, 4), effectiveW: round(effW, 4), effectiveD: round(effD, 4),
    nativeToSource: round(nativeArea / sourceArea, 4), effectiveToSource: round(effArea / sourceArea, 4), growthFactor: round(effArea / nativeArea, 4)
  },
  shape: {
    rectangularity: round(rectangularity, 5),
    axisErrDeg: round(axisErrDeg, 3),
    envelope: { area: round(envelopeArea, 4), ratio: round(envelopeRatio, 5), maxCornerProtrusionM: round(maxCornerProtrusionM, 4) }
  },
  checks: {
    projectionBound: true, islandProfileBound: true, identityBound: true, cottageTypology: true,
    overlap: {
      buildings: buildingConflicts.length, streetTrees: treeInside, canopy: canopyInside,
      nearestStreetTreeM: round(nearestTreeM, 3), nearestStreetTree: nearestTree, nearestCanopyM: round(nearestCanopyM, 3), nearestCanopy: nearestCanopy
    }
  }
};

const summary = {
  fetched: ISO_DAY,
  kind: 'island-cottage-footprint',
  projection: { ...P },
  frame: { x0: DETAIL.x0, x1: DETAIL.x1, z0: DETAIL.z0, z1: DETAIL.z1 },
  pilot: { osm: PILOT_WAY, row: rowIndex, cx: record.cx, cz: record.cz, street: way.tags?.['addr:street'] || null, housenumber: way.tags?.['addr:housenumber'] || null },
  tolerances: { minRectangularity: MIN_RECTANGULARITY, maxAxisErrorDeg: MAX_AXIS_ERROR_DEG, maxEnvelopeRatio: MAX_ENVELOPE_RATIO, minPartDim: MIN_PART_DIM },
  areas: record.areas,
  shape: record.shape,
  overlap: record.checks.overlap,
  source: provenance,
  counts: { records: 1 }
};

const payload = `// js/waterfront-island-cottage-footprint-data.js
// GENERATED by tools/build-island-cottage-footprint-pilot.mjs on ${ISO_DAY}. Do not edit by hand; rerun the tool.
// ONE source-correct effective rectangle for the near-rectangular Nottawa Avenue cottage (OSM way ${PILOT_WAY}), the
// bounded pilot from docs/waterfront-island-cottage-footprint.md (bead st-sb3r.32). Source: OpenStreetMap building
// footprint, ODbL 1.0. The \`parts\` are the axis-aligned min-bounds of the mapped polygon in the committed row's own
// yaw frame (native centre, native yaw); the \`nativeFp\` identity and the accepted cottage profile bind it. This is
// rendering/collision geometry only: the original committed row, GEO, and the door/window work are untouched. The
// consumer helper is js/waterfront-island-cottage-footprint.js (islandCottageFootprintProfile).
(function () {
  const C = window.CITY || (window.CITY = {});
  C.ISLAND_COTTAGE_FOOTPRINT_DATA = ${JSON.stringify({ summary, records: [record] }, null, 1)};
})();
`;

if (AS_JSON) {
  console.log(JSON.stringify({ summary, record }, null, 2));
}
if (DRY) {
  if (!AS_JSON) console.log(`[island-cottage-footprint-pilot] dry run OK: way ${PILOT_WAY}, effective ${round(effW, 3)} x ${round(effD, 3)} m, ` +
    `envelope +${round(envelopeArea, 3)} m^2 (${round((envelopeRatio - 1) * 100, 3)} %), conflicts 0`);
  process.exit(0);
}
fs.writeFileSync(OUT_FILE, payload);
if (!AS_JSON) {
  console.log(`[island-cottage-footprint-pilot] wrote ${path.relative(ROOT, OUT_FILE)}: way ${PILOT_WAY} (v${wayVersion}${wayTimestamp ? `, ${wayTimestamp}` : ''}), ` +
    `native ${round(nativeParts[0][1] - nativeParts[0][0], 3)} x ${round(nativeParts[0][3] - nativeParts[0][2], 3)} m -> ` +
    `effective ${round(effW, 3)} x ${round(effD, 3)} m (${round(envelopeRatio, 4)}x source), no overlaps`);
}

} // end main()
