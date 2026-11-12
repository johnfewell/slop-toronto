#!/usr/bin/env node
// tools/build-island-residential-canopy.mjs
//
// Builds js/waterfront-island-residential-canopy-data.js from the City of Toronto's topographic Tree Point layer
// (cot_geospatial3 FeatureServer/10), confined to the photographed Oneida / Ojibway residential corridors on
// Algonquin Island. This is the *residential-lot* canopy the Ontario GTA 2023 lidar park build (tools/build-park-woods.mjs
// --park toronto-island) does not cover: that build keeps only crowns on the blocks named "Toronto Island Park", so the
// private lots along Oneida and Ojibway (Algonquin Island Park / unnamed residential blocks) get no lidar crowns and only
// the sparse, generic yard scatter of street-details.js / parkland grid.
//
// Source
//   Layer:  https://gis.toronto.ca/arcgis/rest/services/cot_geospatial3/FeatureServer/10  (geometryPoint, "Tree Point")
//   Fields: OBJECTID, SUBTYPE_DESC ("Tree Point"), DERIVED_HEIGHT (m), ELEVATION (m AMSL), DERIVED_OWNER,
//           LAST_GEOMETRY_MAINT, LAST_ATTRIBUTE_MAINT, X/Y (EPSG:26917), LONGITUDE/LATITUDE (null in the layer).
//   Catalogue: https://open.toronto.ca/dataset/topographic-mapping-physical-location-of-trees/  (Open Government Licence – Toronto).
//   Species: the layer is a generic topographic tree point; it carries NO species. The builder therefore labels every
//   candidate a generic mature deciduous ("deciduous:generic", rendered as the EZ ash model family), and never a conifer
//   or a named species, because the source gives no evidence for one.
//   Privacy: public City dataset, no personal resident data (owner is a municipal department string at most).
//
// Fetch (the exact query the captain saved, $WATERFRONT_RESEARCH/width-audit/city-tree-query.txt)
//   .../query?f=json&where=1%3D1&geometry=-79.362,43.626,-79.356,43.630&geometryType=esriGeometryEnvelope&inSR=4326
//              &spatialRel=esriSpatialRelIntersects&outFields=*&outSR=4326&returnGeometry=true&resultRecordCount=2000
//   The bbox is the Algonquin residential envelope only, NOT the whole island: the builder further clips to the exact
//   Oneida/Ojibway corridor and rejects water, building footprints, pavement and duplicates of existing trees.
//
// Gates (a candidate stands only if all pass; rejected points are NOT moved, only counted and dropped)
//   1. corridor: within CORRIDOR_M of a photographed Oneida or Ojibway lane's mapped centre line (the same runs
//      js/waterfront-island-lanes-data.js 1900 holds, unmarked:1). Everything else in the bbox is out.
//   2. support: the point resolves to the active detail frame and is not water (CITY.waterAt from the committed geodata).
//   3. height: DERIVED_HEIGHT within [MIN_H, MAX_H], a conservative inclusion band. The source does not identify a tree's
//      kind, so this is not a botanical test: it only drops points too short to read as the photographed canopy and points
//      tall enough to be a height outlier or a non-tree feature.
//   4. footprint: the trunk is not inside a rendered building footprint (GEO.buildings).
//   5. pavement: the trunk is not on a mapped lane's paved strip (the narrowed representative 3.3 m Oneida / 3.5 m Ojibway
//      from docs/waterfront-island-width-audit.md, and every other mapped island lane at its own width) plus a modest
//      trunk clearance. Trunk only: a crown may overhang the lane, as real ones do.
//   6. dedupe: not within STREET_DEDUPE_M of an existing City street tree (GEO.streetTrees) — the City inventory already
//      represents it, and mapped inventory priority is preserved (the runtime keeps the inventory row, not this one).
//
// Frame
//   World coordinates come from the committed detail projection (data/toronto-geodata.bin, decoded with
//   js/geodata-loader.js). The projection is recorded in the data; the runtime helper refuses a mismatched frame.
//   js/toronto-geodata.js (the legacy script) is read ONLY to draw the geometry/height references and is not used to
//   place anything: the bin and the script agree (tests/geodata-binary.test.mjs), and the runtime audit uses the bin.
//
// Usage
//   node tools/build-island-residential-canopy.mjs --source /path/to/city-tree-algonquin.json \
//        [--bin data/toronto-geodata.bin] [--out js/waterfront-island-residential-canopy-data.js]
//
// Exit: 0 wrote or verified the file, 1 a missing source, gate or parse error.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { decodeGeo } from '../js/geodata-loader.js';
import os from 'node:os';
// Private research cache (reference downloads that never ship): set WATERFRONT_RESEARCH to its folder.
const WATERFRONT_RESEARCH = process.env.WATERFRONT_RESEARCH || path.join(os.tmpdir(), 'waterfront-research');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

// The captain's saved City tree query (Algonquin residential envelope). The builder reads this file; a different
// bbox must be fetched by hand and passed here. Sources are never re-fetched at build time (tests are offline).
const SOURCE = arg('--source', path.join(WATERFRONT_RESEARCH, 'width-audit/city-tree-algonquin.json'));
const BIN = arg('--bin', path.join(ROOT, 'data/toronto-geodata.bin'));
const OUT = arg('--out', path.join(ROOT, 'js/waterfront-island-residential-canopy-data.js'));
const CHECK = argv.includes('--check');

// Gate constants (all documented in docs/waterfront-island-residential-canopy.md §3)
const CORRIDOR_M = 12; // within 12 m of the Oneida/Ojibway centre line: the residential lots that front them
const MIN_H = 4.5; // conservative lower inclusion limit (not a botanical test): below this the point is not the photographed canopy
const MAX_H = 34; // conservative upper inclusion limit (not a botanical test): above this the point is a height outlier
const STREET_DEDUPE_M = 3.5; // an existing City street tree this close already stands for the tree
const BUILDING_PAD = 0.35; // a trunk at least this far outside the rendered wall (a tree does not grow through a wall)
// The narrowed representative paved widths the captain measured (docs/waterfront-island-width-audit.md): Oneida 3.3 m,
// Ojibway 3.5 m. Other mapped island lanes use their own mapped width. A trunk must clear the strip by TRUNK_CLEARANCE.
const PAVED_WIDTH = { 'Oneida Avenue': 3.3, 'Ojibway Avenue': 3.5 };
const DEFAULT_PAVED_WIDTH = 5.6; // a mapped lane with no width: the island lanes' own default (js/waterfront-island-lanes.js)
const TRUNK_CLEARANCE = 0.4; // a trunk this far off the paved edge (trunk only; a crown may overhang)

const fail = (msg) => { console.error(`build-island-residential-canopy: ${msg}`); process.exit(1); };

// --- the committed geodata (detail frame) --------------------------------------------------------------------------
function loadGeo() {
  let u8 = new Uint8Array(fs.readFileSync(BIN));
  if (u8[0] === 0x1f && u8[1] === 0x8b) u8 = new Uint8Array(zlib.gunzipSync(u8));
  return decodeGeo(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
}
const { GEO } = loadGeo();
const PROJ = GEO.frame.projection;
const DETAIL = GEO.frame.detail;

const worldFromLatLon = (lat, lon) => {
  const e = (lon - PROJ.lon0) * PROJ.kx, n = (lat - PROJ.lat0) * PROJ.ky;
  const c = Math.cos(PROJ.theta), s = Math.sin(PROJ.theta);
  return { x: e * c - n * s - PROJ.ox, z: -(e * s + n * c) - PROJ.oz };
};
const inDetail = (x, z) => x > DETAIL.x0 && x < DETAIL.x1 && z > DETAIL.z0 && z < DETAIL.z1;

// --- the photographed Oneida / Ojibway lanes (same source as js/waterfront-island-lanes-data.js) --------------------
const lanesSource = fs.readFileSync(path.join(ROOT, 'js/waterfront-island-lanes-data.js'), 'utf8');
const lanesCtx = { window: { CITY: {} }, Math, JSON };
// The lanes data is a plain IIFE; evaluate it in a tiny sandbox to read the same runs the runtime uses.
vm.createContext(lanesCtx);
vm.runInContext(lanesSource, lanesCtx);
const LANES = lanesCtx.window.CITY.ISLAND_LANES_DATA;
const corridorLanes = (LANES.runs || []).filter((r) => (r.names || []).some((n) => /oneida|ojibway/i.test(n)));
if (corridorLanes.length !== 2) fail(`expected Oneida and Ojibway lane runs, found ${corridorLanes.length}`);

// --- water (the committed water polygons, as city-config.js reads them) ----------------------------------------------
// GEO.areas rows are [kind, name, flat outline, holes[]], and Lake Ontario carries its islands as holes (city-config.js
// AREAS/inWaterBody): a point is under water only if it is inside the outline AND not inside one of the holes.
const WATER_BODIES = (GEO.areas || [])
  .filter((a) => a[0] === 'water')
  .map((a) => ({ flat: a[2], holes: a[3] || [] }));
const inPoly = (flat, x, z) => {
  let inside = false;
  for (let i = 0, j = flat.length - 2; i < flat.length; j = i, i += 2) {
    const xi = flat[i], zi = flat[i + 1], xj = flat[j], zj = flat[j + 1];
    if (((zi > z) !== (zj > z)) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const inWater = (x, z) => WATER_BODIES.some((w) => inPoly(w.flat, x, z) && !w.holes.some((h) => inPoly(h, x, z)));

// --- building footprints (GEO.buildings rows: [cx, cz, rot, rects, ...]) ---------------------------------------------
// The committed building rows are [cx, cz, ang, parts], and tools/build-island-buildings.mjs rowBox places a local (u, v)
// at world x = cx + u*cos(ang) + v*sin(ang), z = cz - u*sin(ang) + v*cos(ang). The inverse is therefore
// u = dx*cos(ang) - dz*sin(ang), v = dx*sin(ang) + dz*cos(ang) (NOT a standard rotation by -ang).
function inBuilding(x, z, pad = 0) {
  for (const b of GEO.buildings || []) {
    const [cx, cz, ang, rects] = b;
    const dx = x - cx, dz = z - cz;
    const c = Math.cos(ang), s = Math.sin(ang);
    const u = dx * c - dz * s, v = dx * s + dz * c;
    for (const r of rects) {
      if (u >= r[0] - pad && u <= r[1] + pad && v >= r[2] - pad && v <= r[3] + pad) return b;
    }
  }
  return null;
}

// The bounded pilot cottages (js/waterfront-island-cottage-footprint.js) may render an EFFECTIVE rectangle that differs
// from the committed native parts. A tree must not stand inside either, so the marina gate also tests the effective
// footprint when the pilot data is present and its source binding resolves. Loaded the same way the runtime does.
function loadCottageFootprint() {
  for (const rel of ['js/waterfront-island-cottage-footprint-data.js', 'js/waterfront-island-cottage-footprint.js']) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) return null;
  }
  const ctx = { window: { CITY: {} }, Math, JSON, Number, Array, Set, Map, Object };
  vm.createContext(ctx);
  try {
    // the effective footprint needs the island profile too (its source-binding check)
    for (const rel of ['js/waterfront-island-buildings-data.js', 'js/waterfront-island-buildings.js', 'js/waterfront-island-cottage-footprint-data.js', 'js/waterfront-island-cottage-footprint.js']) {
      const file = path.join(ROOT, rel);
      if (fs.existsSync(file)) vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: rel });
    }
    ctx.window.CITY.GEO = GEO;
    return typeof ctx.window.CITY.islandCottageFootprintAt === 'function' ? ctx.window.CITY : null;
  } catch { return null; }
}
const COTTAGE = loadCottageFootprint();
function inBuildingEffective(x, z, pad = 0) {
  const native = inBuilding(x, z, pad);
  if (native) return native;
  if (!COTTAGE) return null;
  for (const b of GEO.buildings || []) {
    if (COTTAGE.islandCottageFootprintAt(b, x, z)) return b;
  }
  return null;
}

// --- nearest street tree (GEO.streetTrees rows: [x, z, model, heightDm]) ----------------------------------------------
const ST = GEO.streetTrees || [];
function nearestStreetTree(x, z) {
  let best = Infinity;
  for (let i = 0; i < ST.length; i += 4) {
    const dx = x - ST[i], dz = z - ST[i + 1];
    const d2 = dx * dx + dz * dz;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

// --- distance to the corridor lane centre lines ---------------------------------------------------------------------
function segDistance(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
  let t = L > 0 ? ((px - ax) * dx + (pz - az) * dz) / L : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + dx * t, qz = az + dz * t;
  return Math.hypot(px - qx, pz - qz);
}
function corridorDistance(x, z) {
  let best = { d: Infinity, lane: null };
  for (const r of corridorLanes) {
    const p = r.points;
    for (let i = 0; i + 1 < p.length; i++) {
      const d = segDistance(x, z, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]);
      if (d < best.d) best = { d, lane: r.names[0] };
    }
  }
  return best;
}

// The paved half-width of a mapped lane: the narrowed representative for Oneida/Ojibway, else the lane's own mapped width.
function pavedHalfWidth(run) {
  const name = (run.names || [])[0];
  const w = PAVED_WIDTH[name] ?? (Number.isFinite(run.w) ? run.w : DEFAULT_PAVED_WIDTH);
  return w / 2;
}
// Is the trunk on a mapped lane's paved strip (any island lane, not just the two corridors)? Trunk only: the clearance is
// the paved half-width plus TRUNK_CLEARANCE, never the crown radius.
function onPavement(x, z) {
  for (const r of LANES.runs || []) {
    const limit = pavedHalfWidth(r) + TRUNK_CLEARANCE;
    const p = r.points;
    for (let i = 0; i + 1 < p.length; i++) {
      if (segDistance(x, z, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]) <= limit) return r;
    }
  }
  return null;
}

// --- marina scope (st-sb3r.36): the OSM Queen City Yacht Club polygon (Way 193043084) --------------------------------
// The reviewed QCYC service sheds (st-sb3r.33/.34) stand in the mapped marina; the primary 2024 City orthophoto and the
// QCYC renovation photos show mature canopy around them. This scope adds the City Tree Point candidates that fall inside
// that exact OSM marina polygon. The cached Algonquin query bbox does not cover the marina's north portion, so a single
// bounded official query supplies the extra points; both source files are read here (offline, no fetch at build time).
const MARINA_SOURCE = arg('--marina-source', path.join(WATERFRONT_RESEARCH, 'research/island-cottages/city-tree-marina-qcyc.json'));
const MARINA_RINGS = arg('--marina-rings', path.join(WATERFRONT_RESEARCH, 'research/island-cottages/m.json'));
const MARINA_WAY = 193043084;
// The reviewed service rows (st-sb3r.33/.34): trunks are rejected on their footprints, and the marina trees are only
// claimed inside this OSM polygon. The reviewed rows' areas come from GEO.buildings so no row index is hard-coded.
const MARINA_MIN_H = 4.5;   // same conservative inclusion band as the residential corridor (not botanical)
const MARINA_MAX_H = 34;
// The marina scope rejects trunks within MARINA_BUILDING_PAD of any rendered building (wider than the lot pad) to keep
// the crane/rail/boat-rack zone clear, plus the same water and street dedupe as the residential scope.

// --- read the source -------------------------------------------------------------------------------------------------
if (!fs.existsSync(SOURCE)) {
  fail(`source not found: ${SOURCE} (pass --source; see the fetch URL in this file's header)`);
}
let source;
try {
  source = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
} catch (e) {
  fail(`could not parse ${SOURCE}: ${e.message}`);
}
if (!Array.isArray(source.features)) fail(`${SOURCE} has no features array`);
const fieldNames = (source.fields || []).map((f) => f.name);
for (const need of ['OBJECTID', 'DERIVED_HEIGHT', 'DERIVED_OWNER', 'LAST_GEOMETRY_MAINT', 'ELEVATION']) {
  if (!fieldNames.includes(need)) fail(`${SOURCE} is missing field ${need}`);
}

// --- place and gate --------------------------------------------------------------------------------------------------
const candidates = [];
const rejected = { outOfCorridor: 0, outOfFrame: 0, water: 0, noHeight: 0, height: 0, building: 0, pavement: 0, streetTree: 0 };
let externalCount = 0;
for (const f of source.features) {
  const a = f.attributes || {};
  if (!f.geometry || !Number.isFinite(f.geometry.x) || !Number.isFinite(f.geometry.y)) continue;
  const { x, z } = worldFromLatLon(f.geometry.y, f.geometry.x);
  externalCount++;
  const corr = corridorDistance(x, z);
  if (!(corr.d <= CORRIDOR_M)) { rejected.outOfCorridor++; continue; }
  if (!inDetail(x, z)) { rejected.outOfFrame++; continue; }
  if (inWater(x, z)) { rejected.water++; continue; }
  const h = a.DERIVED_HEIGHT;
  if (!Number.isFinite(h)) { rejected.noHeight++; continue; }
  if (h < MIN_H || h > MAX_H) { rejected.height++; continue; }
  if (inBuilding(x, z, BUILDING_PAD)) { rejected.building++; continue; }
  if (onPavement(x, z)) { rejected.pavement++; continue; }
  const st = nearestStreetTree(x, z);
  if (st <= STREET_DEDUPE_M) { rejected.streetTree++; continue; }
  candidates.push({
    oid: a.OBJECTID,
    x: Math.round(x * 10) / 10, // 0.1 m, as the committed geodata's own coordinates
    z: Math.round(z * 10) / 10,
    h: Math.round(h * 100) / 100, // DERIVED_HEIGHT exactly as the source reports it (0.01 m), not guessed
    elev: Number.isFinite(a.ELEVATION) ? Math.round(a.ELEVATION * 100) / 100 : null,
    owner: a.DERIVED_OWNER || null,
    lane: corr.lane,
    streetM: Math.round(st * 10) / 10, // how far the nearest existing street tree stands (provenance, not a move)
    maint: Number.isFinite(a.LAST_GEOMETRY_MAINT) ? a.LAST_GEOMETRY_MAINT : null
  });
}

// --- marina scope: City Tree Points inside the OSM QCYC marina polygon (st-sb3r.36) ----------------------------------
// Read the marina polygon (the OSM Way 193043084 the island-outliers fixture records) and the bounded official source.
function loadMarinaRings() {
  if (!fs.existsSync(MARINA_RINGS)) fail(`marina rings not found: ${MARINA_RINGS}`);
  const j = JSON.parse(fs.readFileSync(MARINA_RINGS, 'utf8'));
  const el = (j.elements || []).find((e) => e.type === 'way' && e.id === MARINA_WAY);
  if (!el || !Array.isArray(el.geometry)) fail(`OSM marina way ${MARINA_WAY} not found in ${MARINA_RINGS}`);
  return { way: el.id, ring: el.geometry.map((g) => { const w = worldFromLatLon(g.lat, g.lon); return [w.x, w.z]; }) };
}
const marina = loadMarinaRings();
const inMarina = (x, z) => inPolyPair(marina.ring, x, z);
// Point-in-polygon for a world-projected ring given as [x, z] pairs (the marina ring is already in world metres).
function inPolyPair(points, x, z) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, zi] = points[i], [xj, zj] = points[j];
    if (((zi > z) !== (zj > z)) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
// Launch rails / dry-sail crane apron / boat racks have no mapped lane row, so the marina scope keeps trunks clear of
// every rendered building by a wider pad than the lot scope (a trunk does not sit against a rail or a rack).
const MARINA_BUILDING_PAD = 1.2;
const marinaRejected = { outsideMarina: 0, outOfFrame: 0, water: 0, noHeight: 0, height: 0, building: 0, pavement: 0, streetTree: 0 };
const marinaCandidates = [];
let marinaSourceCount = 0;
if (!fs.existsSync(MARINA_SOURCE)) fail(`marina source not found: ${MARINA_SOURCE}`);
const marinaSource = JSON.parse(fs.readFileSync(MARINA_SOURCE, 'utf8'));
// ArcGIS errors / truncated pages must fail loudly, never be treated as a complete source.
if (marinaSource.error) fail(`marina source returned an ArcGIS error: ${JSON.stringify(marinaSource.error)}`);
if (marinaSource.exceededTransferLimit) fail(`marina source exceededTransferLimit: narrow the query and refetch (${MARINA_SOURCE})`);
if (!Array.isArray(marinaSource.features)) fail(`${MARINA_SOURCE} has no features array`);
if (marinaSource.spatialReference && marinaSource.spatialReference.wkid !== 4326) {
  fail(`marina source spatialReference is ${JSON.stringify(marinaSource.spatialReference)}, expected wkid 4326`);
}
if ((marinaSource.geometryType || 'esriGeometryPoint') !== 'esriGeometryPoint') fail(`marina source is not a point layer`);
const marinaFieldNames = (marinaSource.fields || []).map((f) => f.name);
for (const need of ['OBJECTID', 'DERIVED_HEIGHT', 'DERIVED_OWNER', 'LAST_GEOMETRY_MAINT', 'ELEVATION']) {
  if (!marinaFieldNames.includes(need)) fail(`${MARINA_SOURCE} is missing field ${need}`);
}
// Coordinate coverage: the source bbox must contain the whole marina polygon the query was drawn around, else the query
// would silently miss the north/south lobes. Both are WGS84 lon/lat.
const MARINA_QUERY_BBOX = [-79.3597, 43.6283, -79.3567, 43.6309];
const invWorld = (x, z) => {
  const E = x + PROJ.ox, N = -(z + PROJ.oz), c = Math.cos(PROJ.theta), s = Math.sin(PROJ.theta);
  const e = E * c + N * s, n = -E * s + N * c;
  return [e / PROJ.kx + PROJ.lon0, n / PROJ.ky + PROJ.lat0];
};
for (const [x, z] of marina.ring) {
  const [lon, lat] = invWorld(x, z);
  if (lon < MARINA_QUERY_BBOX[0] - 1e-9 || lon > MARINA_QUERY_BBOX[2] + 1e-9 || lat < MARINA_QUERY_BBOX[1] - 1e-9 || lat > MARINA_QUERY_BBOX[3] + 1e-9) {
    fail(`marina polygon vertex ${lon.toFixed(6)},${lat.toFixed(6)} lies outside the query bbox ${MARINA_QUERY_BBOX.join(',')}`);
  }
}
// The marina scope reads the UNION of the cached Algonquin source and the bounded marina source, keyed by OBJECTID, so a
// point already present in the cached file is not counted twice and the two queries agree where they overlap.
const marinaSeen = new Map();
for (const f of [...source.features, ...marinaSource.features]) {
  if (!f.geometry || !Number.isFinite(f.geometry.x) || !Number.isFinite(f.geometry.y)) continue;
  const a = f.attributes || {};
  if (!Number.isInteger(a.OBJECTID)) continue;
  const prev = marinaSeen.get(a.OBJECTID);
  if (prev) {
    // The same OBJECTID in both queries must agree; a coordinate disagreement is a real data conflict, not to be
    // silently resolved by first-wins.
    const px = prev.geometry.x, py = prev.geometry.y;
    if (Math.abs(px - f.geometry.x) > 1e-9 || Math.abs(py - f.geometry.y) > 1e-9) {
      fail(`OBJECTID ${a.OBJECTID} has conflicting coordinates across the cached and marina sources`);
    }
  } else marinaSeen.set(a.OBJECTID, f);
}
for (const f of marinaSeen.values()) {
  const a = f.attributes || {};
  const { x, z } = worldFromLatLon(f.geometry.y ?? f.geometry.y, f.geometry.x);
  marinaSourceCount++;
  if (!inMarina(x, z)) { marinaRejected.outsideMarina++; continue; }
  if (!inDetail(x, z)) { marinaRejected.outOfFrame++; continue; }
  if (inWater(x, z)) { marinaRejected.water++; continue; }
  const h = a.DERIVED_HEIGHT;
  if (!Number.isFinite(h)) { marinaRejected.noHeight++; continue; }
  if (h < MARINA_MIN_H || h > MARINA_MAX_H) { marinaRejected.height++; continue; }
  if (inBuildingEffective(x, z, MARINA_BUILDING_PAD)) { marinaRejected.building++; continue; }
  // Launch rails / crane apron / boat racks: the marina has no mapped lane rows there, but any island paved lane or path
  // still rejects a trunk (same exact segment test as the residential scope). A trunk may be near a rail it stands
  // beside; it may not stand on a mapped paved surface.
  const pav = onPavement(x, z);
  if (pav) { marinaRejected.pavement++; continue; }
  const st = nearestStreetTree(x, z);
  if (st <= STREET_DEDUPE_M) { marinaRejected.streetTree++; continue; }
  marinaCandidates.push({
    oid: a.OBJECTID,
    x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10,
    h: Math.round(h * 100) / 100,
    elev: Number.isFinite(a.ELEVATION) ? Math.round(a.ELEVATION * 100) / 100 : null,
    owner: a.DERIVED_OWNER || null,
    streetM: Math.round(st * 10) / 10,
    maint: Number.isFinite(a.LAST_GEOMETRY_MAINT) ? a.LAST_GEOMETRY_MAINT : null
  });
}
marinaCandidates.sort((a, b) => a.oid - b.oid);
// Nearest paved-lane distance and nearest building distance for the ACCEPTED marina trunks (provenance, not a move):
// proves the launch-rail/crane/rack area had no mapped pavement under any accepted trunk and records the real spacing.
function nearestPaved(x, z) {
  let best = Infinity;
  for (const r of LANES.runs || []) {
    const p = r.points;
    for (let i = 0; i + 1 < p.length; i++) best = Math.min(best, segDistance(x, z, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]));
  }
  return best;
}
function nearestBuildingEdge(x, z) {
  let best = Infinity;
  for (const b of GEO.buildings || []) {
    const [cx, cz, ang, rects] = b;
    const dx = x - cx, dz = z - cz, c = Math.cos(ang), s = Math.sin(ang);
    const u = dx * c - dz * s, v = dx * s + dz * c;
    for (const r of rects) {
      const du = Math.max(r[0] - u, 0, u - r[1]), dv = Math.max(r[2] - v, 0, v - r[3]);
      best = Math.min(best, Math.hypot(du, dv));
    }
  }
  return best;
}
const marinaClearance = marinaCandidates.length ? {
  minPavedM: Math.round(Math.min(...marinaCandidates.map((c) => nearestPaved(c.x, c.z))) * 100) / 100,
  minBuildingM: Math.round(Math.min(...marinaCandidates.map((c) => nearestBuildingEdge(c.x, c.z))) * 100) / 100
} : null;
const marinaHs = marinaCandidates.map((c) => c.h).sort((a, b) => a - b);
const marinaQuant = (p) => (marinaHs.length ? marinaHs[Math.min(marinaHs.length - 1, Math.floor(p * marinaHs.length))] : null);

// Candidates are ordered by OBJECTID for a reproducible file (the source order is not contractual).
candidates.sort((a, b) => a.oid - b.oid);

// A brief summary of the heights actually placed, so the docs and a reviewer can see the spread without re-running.
const hs = candidates.map((c) => c.h).sort((a, b) => a - b);
const quant = (p) => (hs.length ? hs[Math.min(hs.length - 1, Math.floor(p * hs.length))] : null);

const payload = {
  version: 1,
  kind: 'island-residential-canopy',
  source: {
    name: 'City of Toronto topographic Tree Point',
    service: 'https://gis.toronto.ca/arcgis/rest/services/cot_geospatial3/FeatureServer/10',
    catalogue: 'https://open.toronto.ca/dataset/topographic-mapping-physical-location-of-trees/',
    licence: 'Open Government Licence – Toronto',
    attribution: 'Contains information licensed under the Open Government Licence – Toronto.',
    fetched: '2026-11-10',
    query: 'https://gis.toronto.ca/arcgis/rest/services/cot_geospatial3/FeatureServer/10/query?f=json&where=1%3D1&geometry=-79.362%2C43.626%2C-79.356%2C43.630&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=%2A&outSR=4326&returnGeometry=true&resultRecordCount=2000',
    bboxWgs84: [-79.362, 43.626, -79.356, 43.630],
    geometryMaintained: [1609477200000, 1621642690000], // min/max LAST_GEOMETRY_MAINT actually seen (2021)
    speciesEvidence: null, // the layer identifies no species
    note: 'Generic tree points: source position rounded to 0.1 m and DERIVED_HEIGHT, no species, no crown width. Public dataset; no personal resident data.'
  },
  projection: { lat0: PROJ.lat0, lon0: PROJ.lon0, kx: PROJ.kx, ky: PROJ.ky, theta: PROJ.theta, ox: PROJ.ox, oz: PROJ.oz },
  frame: { x0: DETAIL.x0, x1: DETAIL.x1, z0: DETAIL.z0, z1: DETAIL.z1 },
  corridor: {
    lanes: corridorLanes.map((r) => ({ name: r.names[0], ways: r.ways, points: r.points })),
    radiusM: CORRIDOR_M
  },
  gates: { corridorM: CORRIDOR_M, minHeightM: MIN_H, maxHeightM: MAX_H, streetDedupeM: STREET_DEDUPE_M, buildingPadM: BUILDING_PAD, pavedWidthM: PAVED_WIDTH, defaultPavedWidthM: DEFAULT_PAVED_WIDTH, trunkClearanceM: TRUNK_CLEARANCE },
  // width: the City layer carries no crown width; the runtime uses a generic deciduous crown estimate (documented), NOT a
  // measured width. The data states this so nothing downstream mistakes it for a source value.
  crown: { source: null, genericDeciduous: true, note: 'Crown width is a generic mature-deciduous estimate in the runtime, not from the source.' },
  counts: {
    sourceFeatures: externalCount,
    placed: candidates.length,
    rejected,
    byLane: candidates.reduce((m, c) => { m[c.lane] = (m[c.lane] || 0) + 1; return m; }, {})
  },
  heightStats: hs.length ? { min: hs[0], p10: quant(0.1), median: quant(0.5), p90: quant(0.9), max: hs[hs.length - 1] } : null,
  // Compact rows: [OBJECTID, x(dm), z(dm), h(cm), elev(cm or -1), laneIndex, streetM(dm)] in world metres when decoded.
  rows: candidates.map((c) => [c.oid, Math.round(c.x * 10), Math.round(c.z * 10), Math.round(c.h * 100), c.elev == null ? -1 : Math.round(c.elev * 100), corridorLanes.findIndex((r) => r.names[0] === c.lane), Math.round(c.streetM * 10)]),
  // Marina scope (st-sb3r.36): the QCYC marina polygon (OSM Way 193043084) and its City Tree Points. Kept as a separate
  // scope so the Oneida/Ojibway residential corridor above is unchanged. Marina rows: [OBJECTID, x(dm), z(dm), h(cm),
  // elev(cm or -1), streetM(dm)]. No species, no crown width (as the residential scope).
  marina: {
    osmWay: marina.way,
    source: {
      name: 'City of Toronto topographic Tree Point (bounded QCYC marina query)',
      service: 'https://gis.toronto.ca/arcgis/rest/services/cot_geospatial3/FeatureServer/10',
      catalogue: 'https://open.toronto.ca/dataset/topographic-mapping-physical-location-of-trees/',
      licence: 'Open Government Licence – Toronto',
      query: 'https://gis.toronto.ca/arcgis/rest/services/cot_geospatial3/FeatureServer/10/query?f=json&where=1%3D1&geometry=-79.3597%2C43.6283%2C-79.3567%2C43.6309&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=%2A&outSR=4326&returnGeometry=true&resultRecordCount=2000',
      bboxWgs84: [-79.3597, 43.6283, -79.3567, 43.6309],
      cachedOverlapNote: 'The captain Algonquin cache bbox does not cover the marina north portion; this bounded query adds the missing points. The builder reads the union keyed by OBJECTID.'
    },
    gates: { buildingPadM: MARINA_BUILDING_PAD, minHeightM: MARINA_MIN_H, maxHeightM: MARINA_MAX_H, streetDedupeM: STREET_DEDUPE_M, pavedReject: true },
    clearance: marinaClearance,
    counts: { sourceFeatures: marinaSourceCount, placed: marinaCandidates.length, rejected: marinaRejected },
    heightStats: marinaHs.length ? { min: marinaHs[0], p10: marinaQuant(0.1), median: marinaQuant(0.5), p90: marinaQuant(0.9), max: marinaHs[marinaHs.length - 1] } : null,
    rows: marinaCandidates.map((c) => [c.oid, Math.round(c.x * 10), Math.round(c.z * 10), Math.round(c.h * 100), c.elev == null ? -1 : Math.round(c.elev * 100), Math.round(c.streetM * 10)])
  }
};

const banner = `// js/waterfront-island-residential-canopy-data.js — GENERATED by tools/build-island-residential-canopy.mjs, do not edit by hand.
// Toronto Algonquin Island's residential-lot canopy along the photographed Oneida and Ojibway corridors, from the City
// of Toronto topographic Tree Point layer (Open Government Licence – Toronto; docs/waterfront-island-residential-canopy.md).
// Source positions rounded to 0.1 m and DERIVED_HEIGHT; generic deciduous (no species in the source); deduplicated against
// the City street inventory and rejected from water, buildings and mapped pavement. The Ontario 2023 lidar park build (js/toronto-island-woods-data.js) keeps only Toronto Island Park
// blocks, so these private residential lots had no mapped crowns. A separate marina scope (st-sb3r.36) adds the City
// Tree Points inside the OSM QCYC marina polygon (Way 193043084); the residential corridor rows above are unchanged.
(function () {
window.CITY = window.CITY || {};
window.CITY.ISLAND_RESIDENTIAL_CANOPY_DATA = ${JSON.stringify(payload)};
})();
`;

if (CHECK) {
  console.log(JSON.stringify({ counts: payload.counts, heightStats: payload.heightStats }, null, 2));
  process.exit(0);
}
fs.writeFileSync(OUT, banner);
console.log(`wrote ${path.relative(ROOT, OUT)}: ${candidates.length} candidates of ${externalCount} source points`);
console.log('rejected:', JSON.stringify(rejected));
console.log('by lane:', JSON.stringify(payload.counts.byLane));
console.log('heights:', JSON.stringify(payload.heightStats));
console.log('marina placed:', marinaCandidates.length, 'rejected:', JSON.stringify(marinaRejected));
