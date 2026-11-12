#!/usr/bin/env node
// js/waterfront-island-buildings-data.js — source-matched Toronto Islands building profiles.
//
// The committed geodata rows on the Toronto Islands carry inherited generic mid/high-rise heights (many 20-35 m) over
// one- and two-storey Ward's/Algonquin cottages and small park buildings, so js/buildings.js renders them as urban
// towers. (This tool does not claim to know how those inherited heights were produced; it only records that they are
// incompatible with the mapped island buildings.) It reads the REAL OpenStreetMap building footprints and tags around
// the islands, keeps only buildings on the island land component (decoded from GEO.waterMask, so the downtown shore and
// the Port Lands are never included), drops the mapped Billy Bishop airport polygon and named landmarks (the Gibraltar
// Point Lighthouse ways 878933152 & 892934946), matches each remaining footprint to the committed geodata row it
// belongs to, and writes the conservative per-row rendering profile the captain applies in js/buildings.js.
//
// Sources (fetched by this tool; recorded in the header of the data file):
//   * building footprints + tags: OpenStreetMap (Overpass API), ODbL.
//   * residential landuse polygons (Ward's/Algonquin community): OpenStreetMap, ODbL.
//   * Billy Bishop Toronto City Airport relation 85471 (outer ring), OpenStreetMap, ODbL.
//   * island land vs water: GEO.waterMask in data/toronto-geodata.bin (itself built from OSM coastline).
//   * known landmarks are preserved: the lighthouse ways are excluded; explicit height / building:levels always win
//     (no cap); unnamed low buildings use the conservative estimates below, never a blanket height clamp.
//
// Usage:
//   node tools/build-island-buildings.mjs                       # fetch OSM + write the data file
//   node tools/build-island-buildings.mjs --buildings a.json --airport b.json
//   node tools/build-island-buildings.mjs --out /tmp/x.js --dry-run
//
// The output is a plain script (window.CITY.ISLAND_BUILDINGS_DATA = ...) so the page loads it like the other island
// data modules. It is frame-independent: records are keyed by the committed row's world centre, not a row index.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { unpackGeo } from '../js/geodata-loader.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = path.join(ROOT, 'js/waterfront-island-buildings-data.js');
const ISO_DAY = new Date().toISOString().slice(0, 10);
const UA = 'slop-toronto build-island-buildings/1.0 (Toronto Islands OSM)';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const BUILDINGS_IN = opt('--buildings');
const AIRPORT_IN = opt('--airport');
const RESIDENTIAL_IN = opt('--residential');
const MARINA_IN = opt('--marina');
const MASSING_IN = opt('--massing') || defaultMassingPath();
const OUT_FILE = opt('--out') || OUT;
const DRY = args.includes('--dry-run');

// The City 3D Massing attributes (MAX/AVG/MIN_HEIGHT) are the same 2025 shapefile cache tools/fetch-massing.mjs
// writes. They are optional: without them the OSM-only profiles are still generated, but the canopy-limited
// massing-only rows cannot be identified and are reported as skipped.
function defaultMassingPath() {
  const base = process.env.GEO_DATA || path.join(os.homedir(), '.cache/slop-toronto/osm-ids');
  const file = path.join(base, 'massing.json');
  return fs.existsSync(file) ? file : null;
}

// OSM bounding box: the whole island chain, south of the downtown shore and west of Cherry Beach.
const BBOX = '43.605,-79.405,43.6345,-79.338';

// Conservative island height estimates (explicit OSM height / building:levels always take precedence). These are
// rendering estimates for unnamed buildings, not measurements.
const EST = {
  residential: 6.5,   // two low storeys: the Island's typical cottage
  house: 6.5,
  oneStorey: 3.5,
  apartment: 6.5,     // only used when levels are missing; explicit levels win
  service: 4.0,
  toilets: 3.2,
  shed: 4.5,
  hangar: 6.0,
  retail: 4.5,
  civic: 8.0,
  church: 9.0,
  grandstand: 6.0,
  unknown: 4.5        // a generic `building=yes` outside the residential blocks: low pavilion/boathouse scale
};

const RESIDENTIAL = new Set(['house', 'detached', 'terrace', 'residential', 'semidetached_house', 'bungalow']);
const SERVICE = new Set(['service', 'toilets', 'shed', 'barn', 'roof', 'kiosk', 'grandstand', 'hangar', 'bridge', 'no', 'construction', 'industrial']);
const CIVIC = new Set(['school', 'civic', 'public', 'government', 'university', 'college', 'hospital', 'kindergarten']);
const RETAIL = new Set(['retail', 'commercial', 'office', 'hotel', 'apartments']);

function fail(msg) { console.error(`[island-buildings] ${msg}`); process.exit(1); }

async function overpass(query) {
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: query })
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const json = await res.json();
  if (!json.elements) throw new Error('Overpass response has no elements');
  return json;
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// City 3D Massing attributes by record (fid). A record can have several polygons (k); keep them together so the
// canopy test can use the record's own max/avg/min rather than one part's.
let massingByFid = null;
let massingEdition = null;
if (MASSING_IN) {
  const massingJson = readJson(MASSING_IN);
  if (Array.isArray(massingJson.parts) && massingJson.parts.length) {
    massingByFid = new Map();
    for (const part of massingJson.parts) {
      if (!Number.isInteger(part.fid)) continue;
      const list = massingByFid.get(part.fid) || [];
      list.push(part);
      massingByFid.set(part.fid, list);
    }
    massingEdition = massingJson.edition || '3DMassingShapefile_2025_WGS84';
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// GEO (frame + water mask)
// ---------------------------------------------------------------------------------------------------------------------
const { GEO } = await unpackGeo(fs.readFileSync(path.join(ROOT, 'data/toronto-geodata.bin')));

// The committed sidecar binds each GEO row to its City 3D Massing record and to the OSM footprint that names it.
// It is the only durable row -> massing-record map; refuse to guess one from geometry.
function loadGeoIds() {
  const file = path.join(ROOT, 'js/toronto-geodata-ids.js');
  if (!fs.existsSync(file)) return null;
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: 'js/toronto-geodata-ids.js' });
  const ids = ctx.window.CITY && ctx.window.CITY.GEO_IDS;
  if (!ids || !Array.isArray(ids.buildings) || ids.buildings.length !== GEO.buildings.length) return null;
  return ids;
}
const GEO_IDS = loadGeoIds();
if (!GEO_IDS) fail('js/toronto-geodata-ids.js is missing or not row-for-row with the committed geodata');

const P = GEO.frame.projection;
const DETAIL = GEO.frame.detail;
const toWorld = (lon, lat) => {
  const e = (lon - P.lon0) * P.kx, n = (lat - P.lat0) * P.ky;
  const c = Math.cos(P.theta), s = Math.sin(P.theta);
  return [e * c - n * s - P.ox, -(e * s + n * c) - P.oz];
};
const inFrame = (x, z, pad = 0) => x > DETAIL.x0 + pad && x < DETAIL.x1 - pad && z > DETAIL.z0 + pad && z < DETAIL.z1 - pad;

// The build's 4 m water mask, row runs dry/wet from dry (js/water-edges.js drawnWet is the runtime twin).
function waterMask() {
  const M = GEO.waterMask;
  const bin = Buffer.from(M.runs, 'base64');
  const runs = new Uint16Array(bin.length / 2);
  for (let i = 0; i < runs.length; i++) runs[i] = bin.readUInt16LE(2 * i);
  const wet = new Uint8Array(M.w * M.h);
  let k = 0;
  for (let j = 0; j < M.h; j++) {
    let i = 0, v = 0;
    while (i < M.w) { const n = runs[k++]; if (v) wet.fill(1, j * M.w + i, j * M.w + i + n); i += n; v ^= 1; }
    if (v === 0 && runs[k] === 0) k++;
  }
  const cell = (x, z) => {
    const i = Math.floor((x - M.x0) / M.res), j = Math.floor((z - M.z0) / M.res);
    return i >= 0 && j >= 0 && i < M.w && j < M.h ? [i, j] : null;
  };
  // The downtown land component: flood-filled from the frame origin (Union Station). Any land cell NOT reached is an
  // island (or another separated shore), which keeps every mainland row out without a hand-drawn island polygon.
  const mainland = new Uint8Array(M.w * M.h);
  const seed = cell(0, 0);
  if (seed) {
    const stack = [seed];
    mainland[seed[1] * M.w + seed[0]] = 1;
    while (stack.length) {
      const [i, j] = stack.pop();
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + a, jj = j + b;
        if (ii < 0 || jj < 0 || ii >= M.w || jj >= M.h) continue;
        const q = jj * M.w + ii;
        if (mainland[q] || wet[q]) continue;
        mainland[q] = 1; stack.push([ii, jj]);
      }
    }
  }
  return {
    isIslandLand(x, z) {
      const c = cell(x, z);
      if (!c) return false;
      return !wet[c[1] * M.w + c[0]] && !mainland[c[1] * M.w + c[0]];
    },
    isMainlandLand(x, z) {
      const c = cell(x, z);
      return !!c && !wet[c[1] * M.w + c[0]] && !!mainland[c[1] * M.w + c[0]];
    }
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Rings
// ---------------------------------------------------------------------------------------------------------------------
const pointInRing = (ring, x, z) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const ringArea = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a / 2);
};
const bboxOf = (pts) => pts.reduce((b, [x, z]) => [Math.min(b[0], x), Math.max(b[1], x), Math.min(b[2], z), Math.max(b[3], z)], [Infinity, -Infinity, Infinity, -Infinity]);
const centroidOf = (pts) => { let x = 0, z = 0; for (const p of pts) { x += p[0]; z += p[1]; } return [x / pts.length, z / pts.length]; };

// Stitch Overpass member ways into closed rings by matching endpoints (order in the relation is not guaranteed).
function stitchRings(ways) {
  const segs = ways.map((w) => w.geometry.map((g) => [g.lon, g.lat])).filter((s) => s.length >= 2);
  const used = new Array(segs.length).fill(false);
  const key = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
  const rings = [];
  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue;
    used[s] = true;
    let ring = segs[s].slice();
    let grew = true;
    while (grew) {
      grew = false;
      if (key(ring[0]) === key(ring[ring.length - 1])) break;
      for (let j = 0; j < segs.length; j++) {
        if (used[j]) continue;
        const seg = segs[j];
        const a = ring[0], b = ring[ring.length - 1], c = seg[0], d = seg[seg.length - 1];
        if (key(b) === key(c)) ring = ring.concat(seg.slice(1));
        else if (key(b) === key(d)) ring = ring.concat(seg.slice(0, -1).reverse());
        else if (key(a) === key(d)) ring = seg.slice(0, -1).concat(ring);
        else if (key(a) === key(c)) ring = seg.slice(1).reverse().concat(ring);
        else continue;
        used[j] = true; grew = true; break;
      }
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

// ---------------------------------------------------------------------------------------------------------------------
// Source inputs
// ---------------------------------------------------------------------------------------------------------------------
const buildingQuery = `[out:json][timeout:90];way["building"](${BBOX});out geom tags;`;
const residentialQuery = `[out:json][timeout:60];way["landuse"="residential"](${BBOX});out geom tags;`;
const marinaQuery = `[out:json][timeout:60];way["leisure"="marina"](${BBOX});out geom tags;`;
const airportQuery = '[out:json][timeout:60];relation(85471);out geom;';

const buildingsJson = BUILDINGS_IN ? readJson(BUILDINGS_IN) : await overpass(buildingQuery);
const residentialJson = RESIDENTIAL_IN ? readJson(RESIDENTIAL_IN) : await overpass(residentialQuery);
const marinaJson = MARINA_IN ? readJson(MARINA_IN) : await overpass(marinaQuery);
const airportJson = AIRPORT_IN ? readJson(AIRPORT_IN) : await overpass(airportQuery);

// The Ward's/Algonquin community polygons (landuse=residential). A generic `building=yes` is treated as a cottage only
// when it stands inside one of these mapped blocks; otherwise it is skipped unless its own name/tags say what it is.
const residentialRings = (residentialJson.elements || [])
  .filter((e) => e.type === 'way' && Array.isArray(e.geometry) && e.geometry.length >= 3)
  .map((e) => e.geometry.map((g) => toWorld(g.lon, g.lat)));
const inResidentialBlock = (x, z) => residentialRings.some((r) => pointInRing(r, x, z));

// Mapped yacht-club / marina polygons. A bare `building=yes` inside one is a marina service structure, not a
// Ward's/Algonquin cottage; the polygon is also the context that lets a canopy-limited City massing record be
// interpreted as a low marina structure rather than a tower.
const marinaRings = (marinaJson.elements || [])
  .filter((e) => e.type === 'way' && Array.isArray(e.geometry) && e.geometry.length >= 3)
  .map((e) => ({ id: e.id, name: e.tags?.name || null, ring: e.geometry.map((g) => toWorld(g.lon, g.lat)) }));
const marinaAt = (x, z) => marinaRings.find((m) => pointInRing(m.ring, x, z)) || null;

// Named landmarks the correction must never flatten. The Gibraltar Point Lighthouse is drawn by the landmark/landscape
// layers; these OSM ways are excluded even though their tag is a bare building=yes.
const LANDMARK_EXCLUDE = new Map([
  [878933152, 'Gibraltar Point Lighthouse (source way)'],
  [892934946, 'Gibraltar Point Lighthouse']
]);
const LIGHTHOUSE = /lighthouse/i;

const airportRel = (airportJson.elements || []).find((e) => e.type === 'relation' && e.id === 85471);
if (!airportRel) fail('mapped Billy Bishop airport relation 85471 not found; refusing to guess its polygon');
const airportRingsLonLat = stitchRings((airportRel.members || []).filter((m) => m.role !== 'inner'));
const airportRings = airportRingsLonLat.map((r) => r.map(([lon, lat]) => toWorld(lon, lat)));
const airportBox = bboxOf(airportRings.flat());
const inAirport = (x, z) => x > airportBox[0] && x < airportBox[1] && z > airportBox[2] && z < airportBox[3]
  && airportRings.some((r) => pointInRing(r, x, z));

const mask = waterMask();
const osmBuildings = (buildingsJson.elements || []).filter((e) => e.type === 'way' && e.tags && e.tags.building
  && Array.isArray(e.geometry) && e.geometry.length >= 3)
  .map((e) => {
    const pts = e.geometry.map((g) => toWorld(g.lon, g.lat));
    const box = bboxOf(pts);
    const center = centroidOf(pts);
    return {
      e, pts, box, center,
      bboxCenter: [(box[0] + box[1]) / 2, (box[2] + box[3]) / 2],
      w: box[1] - box[0], d: box[3] - box[2], area: ringArea(pts) || (box[1] - box[0]) * (box[3] - box[2])
    };
  });

// The airport and named landmarks are explicit exclusions; the land-component test already removes the mainland.
const isLandmark = (b) => LANDMARK_EXCLUDE.has(b.e.id) || LIGHTHOUSE.test(b.e.tags.name || '') || b.e.tags.man_made === 'lighthouse';
const islandCandidates = osmBuildings.filter((b) => !isLandmark(b) && inFrame(b.center[0], b.center[1])
  && mask.isIslandLand(b.center[0], b.center[1]) && !inAirport(b.center[0], b.center[1]));
const excludedAirport = osmBuildings.filter((b) => inAirport(b.center[0], b.center[1]));
const excludedLandmarks = osmBuildings.filter((b) => isLandmark(b));

// ---------------------------------------------------------------------------------------------------------------------
// Match OSM footprints to committed GEO rows
// ---------------------------------------------------------------------------------------------------------------------
function rowBox(r) {
  const [cx, cz, ang, parts] = r;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  let box = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [u0, u1, v0, v1] of parts) {
    for (const u of [u0, u1]) for (const v of [v0, v1]) {
      const x = cx + u * cs + v * sn, z = cz - u * sn + v * cs;
      box = [Math.min(box[0], x), Math.max(box[1], x), Math.min(box[2], z), Math.max(box[3], z)];
    }
  }
  return { cx, cz, box, bboxCenter: [(box[0] + box[1]) / 2, (box[2] + box[3]) / 2], w: box[1] - box[0], d: box[3] - box[2] };
}

// A stable identity for the committed footprint this record belongs to (yaw + part rectangles; all geodata numbers are
// already quantised). The runtime refuses a row whose footprint no longer matches, even at the same centre.
const footprintSignature = (r) => JSON.stringify([Math.round(r[2] * 1000) / 1000, r[3].map((p) => p.map((v) => Math.round(v * 10) / 10))]);

// The City 3D Massing record behind a committed row (GEO_IDS.buildings[row] is `to-3dmassing-2025:<fid>[.<k>]`).
// This returns ALWAYS an array of the record's polygons (one per `k`), or null. A `<fid>.<k>` id that names a
// polygon the record no longer has is rejected rather than silently falling back to part 0.
function rowMassing(rowIndex) {
  if (!massingByFid) return null;
  const id = GEO_IDS.buildings[rowIndex] || '';
  const m = id.match(/^to-3dmassing-2025:(\d+)(?:\.(\d+))?$/);
  if (!m) return null;
  const fid = Number(m[1]);
  const k = m[2] == null ? null : Number(m[2]);
  const parts = massingByFid.get(fid);
  if (!parts || !parts.length) return null;
  const chosen = k == null ? parts : parts.filter((p) => p.k === k);
  return chosen.length ? chosen : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// REVIEWED marina outliers (st-sb3r.33)
//
// Three committed rows on the Queen City Yacht Club marina (Way 193043084) keep inherited tall City MAX_HEIGHT values
// while having no confirmed OSM footprint match. Captain review of the official 2024 City orthophoto, plus the City
// 3D Massing record attributes and the OSM building data, identifies them as low marina structures. This is a
// BOUNDED, source-reviewed list, not a general rule:
//
//  - The canopy explanation is an INFERENCE from MAX_HEIGHT >> AVG_HEIGHT with a low AVG, corroborated for these
//    three rows by the orthophoto. It is not an established City classification, and the massing metadata is
//    illustrative, not a survey.
//  - Rows 32502 and 32503 have NO OSM building footprint. Absence of an OSM footprint is not "no structure"; the
//    orthophoto shows ground-level-looking pads under canopy, and their function/roof is uncertain.
//  - Row 32501's OSM footprint (Way 795796083) is a bare `building=yes`. It sits inside the marina and is visibly a
//    small low pitched-roof marina building; this does NOT make it a cottage. A residential/civic `building=*` value or
//    an explicit OSM height/levels would still win (see the call sites).
//  - No demolition or construction date is claimed. The 2024 imagery is the review's evidence; the massing edition is
//    2025.
//
// Height is an explicit labelled ESTIMATE (EST.service, 4.0 m); the City record's AVG_HEIGHT (3.3/2.8/2.9 m) is not
// used as a measurement. The native roof is retained (`roof: null`): OSM gives no `roof:shape` for these footprints.
// The massing edition the reviewed values were read from. A different edition invalidates every entry below.
const REVIEWED_MASSING_EDITION = '3DMassingShapefile_2025_WGS84';

// The reviewed bindings. `osmOsm` is the sidecar's `buildingOsm` string (`osm:way/<id>` or ''); `osmWay` is the
// numeric OSM way id for reference (`null` when the row has no OSM footprint). `nativeFp` is the committed row's own
// footprint signature, so a rebuilt/reshaped row can never inherit this override.
const REVIEWED_MARINA_OUTLIERS = new Map([
  [32501, { row: 32501, massingId: 'to-3dmassing-2025:354314', marinaWay: 193043084, osmWay: 795796083, appearance: 'shed',
    osmOsm: 'osm:way/795796083', nativeFp: '[0.551,[[-6.3,6.3,-2.8,2.8]]]', nativeHeight: 31.9,
    massing: { max: 31.9, avg: 3.3, min: 16.1 }, note: 'OSM Way 795796083 building=yes; 2024 orthophoto: small low dark grey pitched-roof marina building beside grouped dinghies' }],
  [32502, { row: 32502, massingId: 'to-3dmassing-2025:354315', marinaWay: 193043084, osmWay: null, appearance: 'storage',
    osmOsm: '', nativeFp: '[0.608,[[-5.6,5.6,-3.1,3.1]]]', nativeHeight: 28.7,
    massing: { max: 28.7, avg: 2.8, min: 9.8 }, note: 'no OSM footprint; 2024 orthophoto: pale ground-level pad under leafless canopy beside boat racks; function and roof uncertain' }],
  [32503, { row: 32503, massingId: 'to-3dmassing-2025:354316', marinaWay: 193043084, osmWay: null, appearance: 'storage',
    osmOsm: '', nativeFp: '[-0.953,[[-5.4,5.4,-3.1,3.1]]]', nativeHeight: 28.5,
    massing: { max: 28.5, avg: 2.9, min: 0.4 }, note: 'no OSM footprint; 2024 orthophoto: pale ground-level pad under leafless canopy beside boat racks; function and roof uncertain' }]
]);

// A reviewed outlier for this row, or null. Every part of the review's binding is re-checked against the committed
// data: the expected massing record id, the massing edition, the marina polygon, the exact OSM footprint binding string,
// the committed footprint signature, and the row's own massing record values. Any drift (a new massing edition, a
// rebuilt row, a changed outline) disables the override rather than applying it to a different building.
function reviewedMarinaOutlier(rowIndex, row, marina, massingParts) {
  const entry = REVIEWED_MARINA_OUTLIERS.get(rowIndex);
  if (!entry) return null;
  if (massingEdition !== REVIEWED_MASSING_EDITION) return null;
  if ((GEO_IDS.buildings[rowIndex] || '') !== entry.massingId) return null;
  if (!marina || marina.id !== entry.marinaWay) return null;
  if ((GEO_IDS.buildingOsm?.[rowIndex] || '') !== entry.osmOsm) return null; // both sides are strings
  if (footprintSignature(row) !== entry.nativeFp) return null;
  if (row[4] !== entry.nativeHeight) return null;
  if (!massingParts || !massingParts.length) return null;
  for (const p of massingParts) {
    if (p.fid !== Number(entry.massingId.split(':')[1])) return null;
    if (Math.abs(p.max - entry.massing.max) > 0.15 || Math.abs(p.avg - entry.massing.avg) > 0.15
      || Math.abs(p.min - entry.massing.min) > 0.15) return null;
  }
  return entry;
}

// Photo-informed appearance for the reviewed rows (st-sb3r.34). These are representative typology colours and forms
// from the primary sources, not per-row measurements: the QCYC 2019 renovation gallery shows white paneled plywood/
// timber walls, dark navy doors/shutters/trim and low eaves; the 2024 City orthophoto shows the first row's low dark
// pitched roof and the other two as pale low storage under canopy. Door counts/positions are approximations.
//
// st-sb3r.39 (QCYC clubhouse, row 32139 / OSM Way 43805118): the `clubhouse` entry is a representative, photo-informed
// read of the official club homepage hero (white two-storey envelope, dark grey pitched/hip roof with an offset wing,
// a waterfront balcony/terrace and repeated bays). The hero image's acquisition date is unknown; it is NOT a measured
// survey. Client-side `js/buildings.js` derives the frontage wall from the mapped footprint + the marina water instead
// of trusting the photo's orientation, so neighbour/section fields here are ranges/labels, never surveyed numbers.
const MARINA_APPEARANCE = {
  shed: {
    style: 'qcyc-shed',
    wall: 0xf2f0ea, trim: 0x1b2a44, roof: 0x3a3d42, roofType: 'gable',
    source: 'QCYC 2019 renovation gallery (official club photos) + 2024 City orthophoto',
    note: 'White paneled plywood/timber walls, dark navy doors/shutters/trim, low eaves, shallow pitched roof; representative door count/layout, not a per-row survey. No demolition debris or people modelled.'
  },
  storage: {
    style: 'qcyc-storage',
    wall: 0xb9b3a6, trim: 0xdad5c8, roof: null, roofType: 'flat',
    source: '2024 City orthophoto + mapped Queen City Yacht Club marina context',
    note: 'Pale low storage pad/structure under leafless canopy; function and roof are uncertain, so a neutral flat-envelope storage treatment is used (no invented brick or home windows).'
  },
  clubhouse: {
    style: 'qcyc-clubhouse',
    wall: 0xf4f2ec, trim: 0xe8e5dc, roof: 0x4a4d52, roofType: 'hip',
    // The water-facing side is local -v. This is the captain-baseline-GPU / source-verified fact for this exact row
    // (QCYC basin camera on the -v side; the native wing v -8.5..-3.5 protrudes toward the water). It is recorded here,
    // on the already-fingerprint-and-projection-gated profile, so the renderer never runs a water detector at runtime.
    waterV: -1,
    source: 'QCYC official homepage hero image (queen-city-yacht-club-toronto-island-lt-1920.jpg, acquisition date unknown; reference only)',
    note: 'White two-storey envelope (two window bands), shallow dark grey pitched/hip roof, waterfront balcony/terrace on the -v (water) side and repetitive window bays; balcony/roof/bay detail is representative, not a measured survey. Footprint, collider and the 6.5 m OSM-levels height are unchanged.'
  }
};

// Conservative low marina/service rendering profile for a reviewed outlier. Footprint, collider and the native roof
// are untouched; only the height/kind are reduced to a labelled estimate. The first row is the source-supported shed;
// the other two keep the native flat envelope with a neutral storage appearance.
function classifyReviewedMarinaOutlier(massingParts, entry) {
  const appearance = entry.appearance === 'shed' ? MARINA_APPEARANCE.shed : MARINA_APPEARANCE.storage;
  return {
    kind: 1,
    roof: appearance.style === 'qcyc-shed' ? 1 : null,
    height: EST.service,
    category: 'service (reviewed marina low structure, st-sb3r.33)',
    heightSource: 'conservative island estimate',
    level: null,
    explicitHeight: null,
    typology: 'service',
    roofType: appearance.roofType,
    roofSource: null,
    siding: null,
    sidingSource: null,
    entry: null,
    entrySource: null,
    appearance: { ...appearance },
    marina: { type: 'way', id: entry.marinaWay },
    massing: {
      type: '3dmassing',
      id: entry.massingId,
      edition: massingEdition,
      max: Math.max(...massingParts.map((p) => p.max)),
      avg: Math.max(...massingParts.map((p) => p.avg)),
      min: Math.min(...massingParts.map((p) => p.min)),
      massingHeightSource: massingParts[0].src || null,
      source: 'City of Toronto 3D Massing 2025 (OGL – Toronto)',
      canopyExplanation: 'inference, not established source classification',
      note: entry.note
    }
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// REVIEWED QCYC clubhouse (st-sb3r.39)
//
// One committed island row (32139, centre 1255.6, 2126.3) inside the mapped Queen City Yacht Club marina (OSM Way
// 193043084) carries OSM Way 43805118: `building=yes`, name "Queen City Yacht Club clubhouse", `building:levels=2`
// (CanVec_Import_2009). With no `roof:shape`/`building:material` it classified as a generic named-service building and
// rendered as the brown "generic envelope" the GPU captures still show. This is a BOUNDED, source-reviewed entry, not a
// general rule: only this exact row/footprint/OSM binding gets the clubhouse appearance. Height (6.5 m from OSM levels),
// the native footprint and the collider are NOT changed — appearance only. A different massing edition, footprint,
// OSM binding or level count disables it (fail closed).
const CLUBHOUSE_MASSING_EDITION = '3DMassingShapefile_2025_WGS84';
const REVIEWED_CLUBHOUSE = {
  row: 32139, osmWay: 43805118, marinaWay: 193043084, osmOsm: 'osm:way/43805118',
  nativeFp: '[-0.983,[[-18.7,15.3,-3.5,9.5],[-2.2,18.8,-8.5,-3.5]]]', nativeHeight: 9.4, levels: 2,
  waterV: -1,
  note: 'OSM Way 43805118 building=yes, name "Queen City Yacht Club clubhouse", building:levels 2 (NRCan CanVec import); official QCYC homepage hero: white two-storey envelope, dark grey hip roof, waterfront balcony on the -v side, repeated bays'
};

// The clubhouse entry for this row, re-checked against the committed data; null on any drift (fail closed).
function reviewedClubhouse(rowIndex, row) {
  if (rowIndex !== REVIEWED_CLUBHOUSE.row) return null;
  if (massingEdition !== CLUBHOUSE_MASSING_EDITION) return null;
  if ((GEO_IDS.buildingOsm?.[rowIndex] || '') !== REVIEWED_CLUBHOUSE.osmOsm) return null;
  if (footprintSignature(row) !== REVIEWED_CLUBHOUSE.nativeFp) return null;
  if (row[4] !== REVIEWED_CLUBHOUSE.nativeHeight) return null;
  return REVIEWED_CLUBHOUSE;
}

// The clubhouse rendering profile: appearance only. Height/kind/roof stay exactly the classified values (OSM levels 2
// -> 6.5 m, no invented pitch); the renderer derives the dark hip roof silhouette and waterfront detail from the
// footprint, keeping the total envelope. `level` is kept from the OSM tag so an explicit-levels row stays classified.
function applyClubhouseAppearance(p) {
  return { ...p, appearance: { ...MARINA_APPEARANCE.clubhouse } };
}

const rows = GEO.buildings.map((r, i) => ({ r, i, box: rowBox(r) }))
  .filter((row) => mask.isIslandLand(row.box.bboxCenter[0], row.box.bboxCenter[1]) && !inAirport(row.box.bboxCenter[0], row.box.bboxCenter[1]));
const MAX_MATCH = 6;   // m between footprint centres (the island's cottages can be ~10 m apart, so this is tight)
const MAX_SIZE_RATIO = 2.0; // one footprint cannot be more than twice the other in width/depth
const MIN_OVERLAP = 0.25;   // axis-aligned overlap of the two footprint boxes as a fraction of the smaller box

const boxOverlap = (a, b) => {
  const w = Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
  const d = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[2], b[2]));
  const small = Math.min((a[1] - a[0]) * (a[3] - a[2]), (b[1] - b[0]) * (b[3] - b[2])) || 1;
  return (w * d) / small;
};
const canMatch = (b, row) => {
  const d = Math.hypot(b.bboxCenter[0] - row.box.bboxCenter[0], b.bboxCenter[1] - row.box.bboxCenter[1]);
  if (d > MAX_MATCH) return null;
  const ratio = Math.max((b.w + 1) / (row.box.w + 1), (row.box.w + 1) / (b.w + 1), (b.d + 1) / (row.box.d + 1), (row.box.d + 1) / (b.d + 1));
  if (ratio > MAX_SIZE_RATIO) return null;
  if (boxOverlap(b.box, row.box.box) < MIN_OVERLAP) return null;
  return d;
};
// Mutual nearest only: the OSM footprint's nearest committed row and that row's nearest OSM footprint must be each
// other. Ambiguous pairs (a shed between two massing parts, two OSM ways over one row) are skipped and counted below.
const nearestRow = new Map();     // candidate index -> { row, d }
const rowNearest = new Map();     // row index -> { candidate, d }
islandCandidates.forEach((b, ci) => {
  let best = null;
  for (const row of rows) {
    const d = canMatch(b, row);
    if (d == null || (best && d >= best.d)) continue;
    best = { row, d };
  }
  if (best) nearestRow.set(ci, best);
});
islandCandidates.forEach((b, ci) => {
  const near = nearestRow.get(ci);
  if (!near) return;
  const cur = rowNearest.get(near.row.i);
  if (!cur || near.d < cur.d) rowNearest.set(near.row.i, { candidate: b, d: near.d, ci });
});
const matches = new Map(); // geo row index -> candidate (mutual nearest only)
let ambiguous = 0, unmatchedOsm = 0;
islandCandidates.forEach((b, ci) => {
  const near = nearestRow.get(ci);
  if (!near) { unmatchedOsm++; return; }
  const mutual = rowNearest.get(near.row.i);
  if (!mutual || mutual.ci !== ci) { ambiguous++; return; }
  matches.set(near.row.i, { b, d: near.d });
});

// ---------------------------------------------------------------------------------------------------------------------
// Profile classification (explicit OSM values first; conservative estimates for unnamed island buildings)
// ---------------------------------------------------------------------------------------------------------------------
function parseLevels(tags) {
  const raw = tags['building:levels'];
  if (raw == null) return null;
  const n = parseFloat(String(raw).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}
function parseHeight(tags) {
  const raw = tags.height;
  if (raw == null) return null;
  const m = String(raw).match(/([\d.]+)\s*(m|ft)?/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return /ft/i.test(m[2] || '') ? n * 0.3048 : n;
}

// roof:shape -> the renderer's roof code (1 pitched, 0 flat); null means "leave the native roof alone". The subtype is
// kept separately so the island extension can draw a gable ridge instead of the native hip everywhere.
function parseRoofShape(tags) {
  const shape = String(tags['roof:shape'] || '').toLowerCase();
  if (!shape) return null;
  if (shape === 'flat') return 'flat';
  if (/gambrel|mansard/.test(shape)) return 'gambrel';
  if (/gable|saltbox/.test(shape)) return 'gable';
  if (/pyramidal/.test(shape)) return 'pyramidal';
  if (/hipped|half-hipped|hip/.test(shape)) return 'hip';
  if (/round|dome|conical/.test(shape)) return 'round';
  return 'pitched';
}
function parseRoof(tags) {
  const shape = parseRoofShape(tags);
  if (shape === 'flat') return 0;
  if (shape) return 1;
  return null;
}

// Confirmed residential typology: a real cottage/house tag, or a generic `yes` inside a mapped landuse=residential
// block. Nothing else is assumed to be a cottage.
function classify(b, inResBlock) {
  const tags = b.e.tags;
  const type = (tags.building || 'yes').toLowerCase();
  const levels = parseLevels(tags);
  const height = parseHeight(tags);
  const isResidential = RESIDENTIAL.has(type);
  let kind = 1, roof = parseRoof(tags), estimate = EST.unknown, category = 'low-rise';

  if (isResidential) { kind = 0; roof = 1; estimate = EST.residential; category = 'residential'; }
  else if (type === 'apartments') { kind = 1; estimate = EST.apartment; category = 'apartments'; }
  else if (type === 'church' || type === 'cathedral' || type === 'chapel' || type === 'place_of_worship') {
    kind = 6; estimate = EST.church; category = 'worship';
  } else if (CIVIC.has(type)) { kind = 7; estimate = EST.civic; category = 'civic'; }
  else if (RETAIL.has(type)) { kind = 1; estimate = EST.retail; category = 'retail'; }
  else if (SERVICE.has(type)) {
    kind = type === 'toilets' ? 1 : type === 'shed' || type === 'barn' || type === 'roof' || type === 'kiosk' || type === 'grandstand' ? 4 : 1;
    category = 'service';
    estimate = type === 'toilets' ? EST.toilets : type === 'hangar' ? EST.hangar
      : type === 'shed' || type === 'barn' || type === 'roof' ? EST.shed : EST.service;
  } else if (type === 'yes') {
    const serviceName = /washroom|shower|toilet|changing|change room|station|shop|store|caf|club|pavilion|terminal|centre|center|hall|school|church|garage|shed|depot|office|museum|theatre|boathouse|kitchen|bar\b/i.test(tags.name || '');
    if (serviceName || tags.amenity) {
      // A named/amenity generic building is a service building: low, with its own roof shape if OSM gives one.
      kind = 1; estimate = EST.service; category = 'service (named/amenity generic building)';
    } else if ((inResBlock || (tags['addr:housenumber'] && tags['addr:street'])) && b.area < 260) {
      // A small bare `yes` is a cottage when it stands in the mapped Ward's/Algonquin residential blocks, or when the
      // mapper gave it a street address on the Island (the community's named streets). No other generic footprint is
      // assumed to be a house.
      kind = 0; roof = 1; estimate = EST.residential; category = inResBlock ? 'residential (generic yes in mapped residential block)' : 'residential (generic yes with island street address)';
    } else if (levels != null || height != null) {
      // No residential block, but the mapper gave an explicit height/level: keep it as a low-rise, no guessed roof.
      kind = 1; estimate = EST.unknown; category = 'generic building with explicit height/levels';
    } else {
      return null; // unclassified generic footprint outside the mapped residential blocks: skip rather than guess
    }
  }

  // Explicit OSM data always wins over the estimates above; no cap.
  let outHeight = height;
  let heightSource = height != null ? 'OSM height tag' : null;
  if (outHeight == null && levels != null) {
    outHeight = levels <= 1 ? EST.oneStorey : levels === 2 ? EST.residential : EST.oneStorey + (levels - 1) * 3.0;
    heightSource = 'OSM building:levels';
  }
  if (outHeight == null) { outHeight = estimate; heightSource = 'conservative island estimate'; }

  // Appearance metadata for the scoped island renderer. A confirmed cottage is a wood-frame island cottage in the
  // Ward's/Algonquin community; that typology (clapboard siding, a front entry/porch, a gable or hipped roof) is an
  // explicit approximation, except where OSM itself tags the material or roof shape. Service buildings keep their
  // native materials: the extension only runs for `typology === 'cottage'`.
  const cottage = kind === 0 && /^residential/.test(category);
  const roofShape = parseRoofShape(tags);
  const material = String(tags['building:material'] || '').toLowerCase();
  const woodSiding = /wood|siding|clapboard|shingle/.test(material);
  const typology = cottage ? 'cottage'
    : type === 'apartments' ? 'apartment'
    : category.startsWith('worship') ? 'worship'
    : category === 'civic' ? 'civic'
    : category === 'retail' ? 'retail'
    : category.startsWith('service') || SERVICE.has(type) ? 'service'
    : 'generic';
  // For a confirmed cottage without an explicit roof:shape, the island's documented cottage typology is a gable or hip
  // roof; both appear in the community photographs. A stable split (70 % gable, 30 % hip, keyed by the OSM way id) gives
  // the rows a varied silhouette without claiming any specific house's roof. Labelled approximation, never measured.
  const roofType = roofShape || (cottage ? ((b.e.id % 10) < 7 ? 'gable' : 'hip') : null);
  const roofSource = roofShape ? 'OSM roof:shape' : cottage ? 'island cottage typology approximation' : null;
  const siding = cottage ? (woodSiding ? 'wood' : 'clapboard') : null;
  const sidingSource = cottage ? (woodSiding ? 'OSM building:material' : 'island cottage typology approximation') : null;
  const entry = cottage ? 'inset-front-porch' : null;
  const entrySource = cottage ? 'island cottage typology approximation' : null;

  return {
    kind, roof, height: Math.round(outHeight * 10) / 10, category, heightSource, level: levels, explicitHeight: height,
    typology, roofType, roofSource, siding, sidingSource, entry, entrySource
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Records + output
// ---------------------------------------------------------------------------------------------------------------------
const records = [];
const massingRecords = [];
let explicitCount = 0, estimateCount = 0;
let skippedUnclassified = 0;
let marinaLowOsm = 0, marinaLowMassing = 0, clubhouseAppearances = 0;
for (const [idx, m] of [...matches.entries()].sort((a, b) => a[0] - b[0])) {
  const row = GEO.buildings[idx];
  const inResBlock = inResidentialBlock(m.b.center[0], m.b.center[1]);
  let p = classify(m.b, inResBlock);
  // A reviewed outlier whose generic OSM footprint was not classified as anything else falls to a low marina/service
  // profile. The review entry is re-checked against the committed row, marina polygon and massing record first.
  const reviewed = reviewedMarinaOutlier(idx, row, marinaAt(m.b.center[0], m.b.center[1]), rowMassing(idx));
  if (reviewed && (!p || !p.explicitHeight && p.level == null && /^service/.test(p.category))) {
    p = classifyReviewedMarinaOutlier(rowMassing(idx), reviewed);
    marinaLowOsm++;
  }
  // The reviewed QCYC clubhouse keeps its classified height/kind/roof (OSM levels 2 -> 6.5 m, no invented pitch) and only
  // gains a source-supported facade appearance. It is OSM-attributed like any other row, so it needs the generic
  // named-service classification to be present — never a reclassification into the low marina service profile above.
  const clubhouse = reviewedClubhouse(idx, row);
  if (clubhouse && p && p.level === clubhouse.levels && /^service \(named\/amenity/.test(p.category)) {
    p = applyClubhouseAppearance(p);
    clubhouseAppearances++;
  }
  if (!p) { skippedUnclassified++; continue; }
  const tags = m.b.e.tags;
  if (p.explicitHeight != null || p.level != null) explicitCount++; else estimateCount++;
  const record = {
    cx: Math.round(row[0] * 10) / 10, cz: Math.round(row[1] * 10) / 10,
    row: idx, height: p.height, kind: p.kind, roof: p.roof, category: p.category,
    heightSource: p.heightSource,
    typology: p.typology, roofType: p.roofType, roofSource: p.roofSource,
    siding: p.siding, sidingSource: p.sidingSource, entry: p.entry, entrySource: p.entrySource,
    native: { height: row[4], kind: row[5], roof: row[6] },
    fp: footprintSignature(row),
    matchM: Math.round(m.d * 10) / 10,
    osm: { type: 'way', id: m.b.e.id, version: m.b.e.version ?? null },
    tags: {
      building: tags.building || null, name: tags.name || null,
      'building:levels': tags['building:levels'] ?? null, height: tags.height ?? null,
      'building:material': tags['building:material'] ?? null, 'building:colour': tags['building:colour'] ?? null,
      'roof:shape': tags['roof:shape'] ?? null, 'roof:material': tags['roof:material'] ?? null,
      'roof:colour': tags['roof:colour'] ?? null,
      amenity: tags.amenity ?? null, tourism: tags.tourism ?? null, man_made: tags.man_made ?? null
    }
  };
  if (p.appearance) record.appearance = p.appearance;
  if (p.marina) record.marina = p.marina;
  if (p.massing) record.massing = p.massing;
  records.push(record);
}

// Rows with no OSM footprint whose committed City 3D Massing record is one of the REVIEWED marina outliers. They are
// kept in a separate array so every `records` entry remains OSM-attributed. The review re-checks the massing record id,
// the marina polygon and the record's own values, so a new massing edition or a rebuilt row disables the override.
for (const row of rows) {
  if (matches.has(row.i)) continue;
  const data = GEO.buildings[row.i];
  const marina = marinaAt(row.box.bboxCenter[0], row.box.bboxCenter[1]);
  const entry = reviewedMarinaOutlier(row.i, data, marina, rowMassing(row.i));
  if (!entry) continue;
  if (data[4] !== entry.massing.max) continue;
  if (data[5] === 0) continue; // a residential/civic native kind is never reclassified here
  const p = classifyReviewedMarinaOutlier(rowMassing(row.i), entry);
  estimateCount++;
  marinaLowMassing++;
  massingRecords.push({
    cx: Math.round(data[0] * 10) / 10, cz: Math.round(data[1] * 10) / 10,
    row: row.i, height: p.height, kind: p.kind, roof: p.roof, category: p.category,
    heightSource: p.heightSource,
    typology: p.typology, roofType: p.roofType, roofSource: p.roofSource,
    siding: p.siding, sidingSource: p.sidingSource, entry: p.entry, entrySource: p.entrySource,
    native: { height: data[4], kind: data[5], roof: data[6] },
    fp: footprintSignature(data),
    matchM: null,
    osm: null,
    appearance: p.appearance,
    marina: p.marina,
    massing: p.massing
  });
}

const inheritedHighRiseRows = [...records, ...massingRecords].filter((r) => r.native.height >= 12).length;
const summary = {
  fetched: ISO_DAY,
  osmBbox: BBOX,
  // The exact projection the committed rows were matched in. The runtime refuses a frame whose projection differs, so
  // a different world frame with superficially similar coordinates can never receive these overrides.
  projection: { ...GEO.frame.projection },
  bbox: bboxOf(airportRings.flat()).map((v) => Math.round(v * 10) / 10),
  airport: { type: 'relation', id: 85471, rings: airportRings.length, name: airportRel.tags?.name || 'Billy Bishop Toronto City Airport' },
  landmarksExcluded: [...LANDMARK_EXCLUDE.entries()].map(([id, name]) => ({ type: 'way', id, name })),
  marina: {
    source: 'OpenStreetMap leisure=marina ways (ODbL)',
    count: marinaRings.length,
    // The polygon rings are kept so the runtime can resolve a reviewed building's WATER side from mapped geometry
    // (st-sb3r.39 fixes the QCYC clubhouse balcony to the water-facing wall without trusting a photo's orientation).
    rings: marinaRings.map((m) => ({ type: 'way', id: m.id, name: m.name, ring: m.ring }))
  },
  massing: {
    source: 'City of Toronto 3D Massing 2025 (OGL – Toronto)',
    edition: massingEdition,
    applied: !!massingByFid,
    records: massingRecords.length,
    reviewedOutliers: [...REVIEWED_MARINA_OUTLIERS.values()],
    reviewedClubhouse: REVIEWED_CLUBHOUSE
  },
  counts: {
    osmBuildingsInQuery: osmBuildings.length,
    islandCandidates: islandCandidates.length,
    matchedRows: records.length,
    unmatchedIslandBuildings: islandCandidates.length - records.length - ambiguous - skippedUnclassified,
    ambiguousPairsSkipped: ambiguous,
    unclassifiedSkipped: skippedUnclassified,
    excludedAirportBuildings: excludedAirport.length,
    excludedLandmarkBuildings: excludedLandmarks.length,
    explicitHeightOrLevels: explicitCount,
    conservativeEstimates: estimateCount,
    inheritedHighRiseRowsCorrected: inheritedHighRiseRows,
    cottageTypology: records.filter((r) => r.typology === 'cottage').length,
    explicitRoofShape: records.filter((r) => r.roofSource === 'OSM roof:shape').length,
    oSMTaggedWoodSiding: records.filter((r) => r.sidingSource === 'OSM building:material').length,
    marinaLowOsmRecords: marinaLowOsm,
    marinaLowMassingRecords: marinaLowMassing,
    clubhouseAppearances,
    massingOnlyRows: massingRecords.length
  },
  appearanceApproximation: 'Cottage clapboard siding, gable/hip roof choice, white casing/fascia and inset front porch are ' +
    'island cottage typology approximations (Ward\'s/Algonquin community photographs). OSM building:material and ' +
    'roof:shape tags win where present. No per-house colour is claimed as measured.',
  estimates: EST
};

const payload = `// js/waterfront-island-buildings-data.js
// GENERATED by tools/build-island-buildings.mjs on ${ISO_DAY}. Do not edit by hand; rerun the tool.
// Source-matched Toronto Islands building profiles. OpenStreetMap contributors, ODbL; airport polygon relation
// 85471; residential landuse polygons; mapped leisure=marina polygons; island land from the committed GEO.waterMask.
// Every \`records\` entry names the OSM way it came from. \`massingRecords\` are rows with no OSM footprint whose
// committed City 3D Massing record is canopy-limited and whose footprint is inside a mapped marina; they name the
// massing record instead. Keyed by the committed geodata row's world centre (frame-independent: the detail and
// Eglinton frames share a projection), never by row index. Explicit OSM \`height\` / \`building:levels\` win with no
// cap; unnamed buildings use the conservative estimates below. \`roof: null\` means "keep the native roof" (source did
// not specify one and the typology is not a confirmed cottage). The profiles are rendering overrides only:
// footprints, colliders and GEO are not changed.
(function () {
  const C = window.CITY || (window.CITY = {});
  C.ISLAND_BUILDINGS_DATA = ${JSON.stringify({ summary, records, massingRecords }, null, 1)};
})();
`;

if (DRY) {
  console.log(JSON.stringify(summary, null, 2));
  console.log('records sample', JSON.stringify(records.slice(0, 5), null, 2));
} else {
  fs.writeFileSync(OUT_FILE, payload);
  console.log(`[island-buildings] wrote ${path.relative(ROOT, OUT_FILE)}: ${records.length} matched rows (${explicitCount} explicit, ${estimateCount} estimates), ${inheritedHighRiseRows} inherited high-rise rows corrected, ${excludedAirport.length} airport + ${excludedLandmarks.length} landmark buildings excluded, ${ambiguous} ambiguous pairs skipped`);
  console.log(`[island-buildings] ${JSON.stringify(summary.counts)}`);
}
