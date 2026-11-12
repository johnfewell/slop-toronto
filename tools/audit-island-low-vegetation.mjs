#!/usr/bin/env node
// tools/audit-island-low-vegetation.mjs
//
// Source audit (NOT a runtime planting pass) of low 1-5 m surface returns on the two photographed Oneida / Ojibway
// cottage frontages on Algonquin Island. Bead st-sb3r.35.
//
// Question: the accepted Oneida/Ojibway yard material, the 33 City tree points and the lawn material still read flat
// beside primary 2026 photographs that show dense cottage gardens. Does a primary source actually support a *bounded*
// low-cover layer, or is the observation missing?
//
// Evidence used, all local and offline:
//   - Ontario Elevation Mapping Program, GTA 2023 lidar (Open Government Licence - Ontario):
//     Digital Surface Model (first return) and Digital Terrain Model (bare earth), 0.5 m. The same cached tiles and
//     manifests the island park build uses (tools/build-park-woods.mjs --park toronto-island). Read through
//     tools/terrain-pilot-lib.mjs `openDtm`, which re-checks each tile's manifest SHA-256. The cache directory comes
//     from DON_VALLEY_DTM / $HOME/.cache/slop-toronto/raw/ontario-dtm-gta2023; it is never written here.
//   - OSM building polygons, saved Overpass `way["building"](43.605,-79.405,43.6345,-79.338) out geom tags`
//     ($WATERFRONT_RESEARCH/research/island-cottages/b.json). OpenStreetMap contributors, ODbL.
//   - The committed photographed lanes (js/waterfront-island-lanes-data.js; Oneida OSM way 13541126, Ojibway 13541122)
//     and the captain's narrowed representative paved widths (3.3 m / 3.5 m, docs/waterfront-island-width-audit.md).
//   - The committed water polygons (GEO.areas) and detail frame (js/toronto-geodata.js, as terrain pilots load it).
//
// The low band (1 <= DSM-DTM < 5 m) is the same band tools/build-park-cover.mjs uses for High Park's shrub layer. It is
// a *surface* height above bare earth, not a botanical class: a first return 1-5 m up can be a hedge, a shrub, a sapling,
// a fence, a shed roof, a parked machine, deck or furniture. This audit therefore reports observed low-return support
// and never names a species, flowerbed or hedge. It also reports how much of the corridor is under a >= 5 m return, where
// a first-return DSM cannot see the understory at all (the closed-canopy blind spot).
//
// Corridor (bounded, photographed frontage only):
//   0 <= distance to the mapped Oneida/Ojibway centre line <= CORRIDOR_M (12 m), inside the detail frame.
// Excluded from the eligible ground:
//   - actual OSM building polygons (b.json) plus BUILDING_PAD_M (default 1.0 m);
//   - every mapped island lane's paved strip, at the narrowed Oneida 3.3 m / Ojibway 3.5 m or its own width;
//   - committed water polygons (lake holes respected, as city-config.js / build-island-residential-canopy.mjs do).
//
// Sampling: a 0.5 m grid (the lidar's native pixel) inside the corridor bounding box, one DSM/DTM pixel pair per cell.
// Each cell counts 0.25 m2. A cell with no lidar pixel (open lake / missing tile) is counted as `noLidar`, not guessed.
//
// Usage:
//   node tools/audit-island-low-vegetation.mjs [--buildings <b.json>] [--building-pad 1.0] [--sample 0.5]
//        [--out /tmp/island-low-vegetation-audit.json]
//
// This tool writes no repository file and changes no runtime code. It prints a JSON summary and, with --out, writes the
// same JSON to a scratch path. Exit 0 on a completed audit, 1 on a parse/source error.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ROOT, loadCity, openDtm, DTM_DIR } from './terrain-pilot-lib.mjs';
import os from 'node:os';
// Private research cache (reference downloads that never ship): set WATERFRONT_RESEARCH to its folder.
const WATERFRONT_RESEARCH = process.env.WATERFRONT_RESEARCH || path.join(os.tmpdir(), 'waterfront-research');

export const DEFAULTS = {
  corridorM: 12,
  lowLoM: 1,
  lowHiM: 5,
  sampleM: 0.5,
  buildingPadM: 1.0,
  // The captain's narrowed representative widths (docs/waterfront-island-width-audit.md §...); every other mapped
  // island lane keeps its own mapped width, else the lanes' default 5.6 m.
  pavedWidth: { 'Oneida Avenue': 3.3, 'Ojibway Avenue': 3.5 },
  defaultPavedWidthM: 5.6
};

// --- pure geometry helpers (exported for the focused test) -----------------------------------------------------------
// Flat rings are [x0, z0, x1, z1, ...] in world metres.
export function pointInRing(flat, x, z) {
  let inside = false;
  for (let i = 0, j = flat.length - 2; i < flat.length; j = i, i += 2) {
    const xi = flat[i], zi = flat[i + 1], xj = flat[j], zj = flat[j + 1];
    if (((zi > z) !== (zj > z)) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function segmentDistance(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
  const t = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L)) : 0;
  const qx = ax + dx * t, qz = az + dz * t;
  return Math.hypot(px - qx, pz - qz);
}

// Distance from a point to a closed ring: 0 inside, else the nearest edge distance.
export function ringDistance(flat, x, z) {
  if (pointInRing(flat, x, z)) return 0;
  let best = Infinity;
  for (let i = 0, j = flat.length - 2; i < flat.length; j = i, i += 2) {
    const d = segmentDistance(x, z, flat[j], flat[j + 1], flat[i], flat[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

export function ringsDistance(rings, x, z) {
  let best = Infinity;
  for (const r of rings) { const d = ringDistance(r, x, z); if (d < best) best = d; }
  return best;
}

export function corridorDistance(runs, x, z) {
  let best = { d: Infinity, lane: null };
  for (const r of runs) {
    const p = r.points;
    for (let i = 0; i + 1 < p.length; i++) {
      const d = segmentDistance(x, z, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]);
      if (d < best.d) best = { d, lane: (r.names && r.names[0]) || null };
    }
  }
  return best;
}

// A plausible bare-earth / surface elevation in metres. The GTA 2023 tiles use a nodata sentinel (and the lake has no
// tile); a value outside this band is not a measurement.
export function plausibleElevation(v) {
  return Number.isFinite(v) && v > -100 && v < 1000;
}

// Classify a DSM/DTM pair. BOTH elevations are validated independently BEFORE differencing: two nodata sentinels (e.g.
// -9999 - -9999) would otherwise cancel to 0 and be counted as bare lawn. A pair with either side implausible is
// `noLidar`, never a height class.
export function classifySample(dsm, dtm, lo = DEFAULTS.lowLoM, hi = DEFAULTS.lowHiM) {
  if (!plausibleElevation(dsm) || !plausibleElevation(dtm)) return 'noLidar';
  return classifyDiff(dsm - dtm, lo, hi);
}

export function classifyDiff(diff, lo = DEFAULTS.lowLoM, hi = DEFAULTS.lowHiM) {
  if (!Number.isFinite(diff) || diff <= -100 || diff >= 1000) return 'noLidar';
  if (diff < lo) return 'below'; // bare earth, lawn, low ground clutter under 1 m
  if (diff < hi) return 'low'; // 1-5 m surface: the candidate low-cover band (not a botanical class)
  return 'tall'; // >= 5 m first return: canopy/structure; understory here is unobservable
}

export function summarize(cellAreaM2, counts) {
  const total = counts.corridorCells || 0;
  const observed = counts.below + counts.low + counts.tall;
  const share = (n) => (observed > 0 ? +(n / observed).toFixed(4) : null);
  return {
    cellAreaM2,
    corridorCells: total,
    excluded: { building: counts.building, pavement: counts.pavement, water: counts.water, outOfFrame: counts.outOfFrame },
    observedCells: observed,
    observedAreaM2: +(observed * cellAreaM2).toFixed(1),
    noLidarCells: counts.noLidar,
    below1m: { cells: counts.below, areaM2: +(counts.below * cellAreaM2).toFixed(1), share: share(counts.below) },
    low1to5m: { cells: counts.low, areaM2: +(counts.low * cellAreaM2).toFixed(1), share: share(counts.low) },
    tall5mPlus: { cells: counts.tall, areaM2: +(counts.tall * cellAreaM2).toFixed(1), share: share(counts.tall) }
  };
}

// --- input loaders ---------------------------------------------------------------------------------------------------
function sha256File(file) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; }
}

function worldFromLatLonFn(proj) {
  return (lat, lon) => {
    const e = (lon - proj.lon0) * proj.kx, n = (lat - proj.lat0) * proj.ky;
    const c = Math.cos(proj.theta), s = Math.sin(proj.theta);
    return { x: e * c - n * s - proj.ox, z: -(e * s + n * c) - proj.oz };
  };
}

function ringBBox(flat) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < flat.length; i += 2) {
    if (flat[i] < x0) x0 = flat[i];
    if (flat[i] > x1) x1 = flat[i];
    if (flat[i + 1] < z0) z0 = flat[i + 1];
    if (flat[i + 1] > z1) z1 = flat[i + 1];
  }
  return { x0, x1, z0, z1 };
}

const bboxOverlap = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.z0 <= b.z1 && a.z1 >= b.z0;

function loadOsmBuildings(file, worldFromLatLon, box) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rings = [];
  for (const e of j.elements || []) {
    if (!Array.isArray(e.geometry) || e.geometry.length < 4) continue;
    const flat = [];
    for (const p of e.geometry) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
      const w = worldFromLatLon(p.lat, p.lon);
      flat.push(w.x, w.z);
    }
    if (flat.length < 6) continue;
    const bb = ringBBox(flat);
    if (bboxOverlap(bb, box)) rings.push({ id: e.id, flat, bb });
  }
  return rings;
}

// Load the committed water polygons as candidate outlines with their land holes. GEO.areas rows are
// [kind, name, flatOutline, holes[]]; city-config.js AREAS/inWaterBody keeps the island land as holes of Lake Ontario.
// `box` filters only which outlines we carry (a box-overlap test), never which holes: an island hole can lie wholly
// inside a carved water polygon's outline yet its bbox still overlaps the corridor. Holes are kept in full.
function loadWaterRings(C, box) {
  const rings = [];
  for (const a of C.GEO.areas || []) {
    if (a[0] !== 'water') continue;
    const flat = a[2];
    if (!flat || flat.length < 6) continue;
    if (!bboxOverlap(ringBBox(flat), box)) continue;
    const holes = (a[3] || []).filter((h) => Array.isArray(h) && h.length >= 6);
    rings.push({ flat, holes });
  }
  return rings;
}

// A point is under water if it is inside a water outline and not inside any of that polygon's land holes
// (an island is a hole of the lake). This is the same rule city-config.js inWaterBody and
// build-island-residential-canopy.mjs use.
export function inWater(waters, x, z) {
  for (const w of waters) {
    if (!pointInRing(w.flat, x, z)) continue;
    if (!w.holes.some((h) => pointInRing(h, x, z))) return true;
  }
  return false;
}

function onPavement(runs, x, z, constants) {
  for (const r of runs) {
    const name = (r.names || [])[0];
    const width = constants.pavedWidth[name] ?? (Number.isFinite(r.w) ? r.w : constants.defaultPavedWidthM);
    const limit = width / 2;
    const p = r.points;
    for (let i = 0; i + 1 < p.length; i++) {
      if (segmentDistance(x, z, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]) <= limit) return r;
    }
  }
  return null;
}

// --- CLI -------------------------------------------------------------------------------------------------------------
async function main() {
  const argv = process.argv.slice(2);
  const arg = (n, f) => { const i = argv.indexOf(n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : f; };
  const BUILDINGS = arg('--buildings', path.join(WATERFRONT_RESEARCH, 'research/island-cottages/b.json'));
  const OUT = arg('--out', null);
  const constants = { ...DEFAULTS };
  constants.buildingPadM = Number(arg('--building-pad', DEFAULTS.buildingPadM));
  constants.sampleM = Number(arg('--sample', DEFAULTS.sampleM));
  if (!Number.isFinite(constants.sampleM) || constants.sampleM <= 0) throw new Error(`--sample must be a finite number > 0 (got ${arg('--sample', DEFAULTS.sampleM)})`);
  if (!Number.isFinite(constants.buildingPadM) || constants.buildingPadM < 0) throw new Error(`--building-pad must be a finite number >= 0 (got ${arg('--building-pad', DEFAULTS.buildingPadM)})`);

  const C = loadCity(['js/waterfront-island-lanes-data.js']);
  const PROJ = C.GEO.frame.projection;
  const DETAIL = C.GEO.frame.detail;
  const worldFromLatLon = worldFromLatLonFn(PROJ);
  const LANES = C.ISLAND_LANES_DATA;
  const corridorLanes = (LANES.runs || []).filter((r) => (r.names || []).some((n) => /oneida|ojibway/i.test(n)));
  if (corridorLanes.length !== 2) throw new Error(`expected 2 Oneida/Ojibway lanes, found ${corridorLanes.length}`);

  // The corridor bounding box, padded by the corridor radius and one sample.
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const r of corridorLanes) for (const p of r.points) {
    if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
    if (p[1] < z0) z0 = p[1]; if (p[1] > z1) z1 = p[1];
  }
  const pad = constants.corridorM + constants.sampleM;
  const box = { x0: x0 - pad, x1: x1 + pad, z0: z0 - pad, z1: z1 + pad };

  const buildings = loadOsmBuildings(BUILDINGS, worldFromLatLon, box);
  const waters = loadWaterRings(C, box);
  const lanes = LANES.runs || [];

  const dsm = openDtm(C, box, 'manifest-toronto-island-dsm.json', { allowMissing: true });
  const dtm = openDtm(C, box, 'manifest-toronto-island.json', { allowMissing: true });

  const counts = { corridorCells: 0, outOfCorridor: 0, outOfFrame: 0, building: 0, pavement: 0, water: 0, noLidar: 0, below: 0, low: 0, tall: 0 };
  const byLane = {};
  const step = constants.sampleM;
  const cellArea = step * step;
  const lo = constants.lowLoM, hi = constants.lowHiM;
  // Diagnostics for the small building exclusion: how many OSM polygons actually touch the corridor, and how far the
  // corridor ground sits from the nearest polygon. Measured, not assumed.
  const buildingDiag = { polygonsInBox: buildings.length, polygonsTouchingCorridor: 0, nearestM: { min: null, p10: null, median: null, p90: null, max: null }, cellsWithinM: { 1: 0, 2: 0, 5: 0, 10: 0 } };
  for (const b of buildings) {
    let d = Infinity;
    for (let i = 0; i < b.flat.length; i += 2) d = Math.min(d, corridorDistance(corridorLanes, b.flat[i], b.flat[i + 1]).d);
    if (d <= constants.corridorM) buildingDiag.polygonsTouchingCorridor++;
  }
  const nearestDistances = [];

  for (let z = box.z0 + step / 2; z < box.z1; z += step) {
    for (let x = box.x0 + step / 2; x < box.x1; x += step) {
      const corr = corridorDistance(corridorLanes, x, z);
      if (!(corr.d <= constants.corridorM)) { counts.outOfCorridor++; continue; }
      counts.corridorCells++;
      const laneKey = corr.lane === 'Oneida Avenue' ? 'oneida' : 'ojibway';
      const L = (byLane[laneKey] ||= { corridorCells: 0, building: 0, pavement: 0, water: 0, outOfFrame: 0, noLidar: 0, below: 0, low: 0, tall: 0 });
      L.corridorCells++;
      if (x <= DETAIL.x0 || x >= DETAIL.x1 || z <= DETAIL.z0 || z >= DETAIL.z1) { counts.outOfFrame++; L.outOfFrame++; continue; }
      let nearestBuilding = Infinity;
      for (const b of buildings) { const d = ringDistance(b.flat, x, z); if (d < nearestBuilding) nearestBuilding = d; }
      nearestDistances.push(nearestBuilding);
      for (const m of [1, 2, 5, 10]) if (nearestBuilding <= m) buildingDiag.cellsWithinM[m]++;
      if (nearestBuilding <= constants.buildingPadM) { counts.building++; L.building++; continue; }
      if (onPavement(lanes, x, z, constants)) { counts.pavement++; L.pavement++; continue; }
      if (inWater(waters, x, z)) { counts.water++; L.water++; continue; }
      const a = dsm.fineAt(x, z), b = dtm.fineAt(x, z);
      const cls = classifySample(a, b, lo, hi);
      if (cls === 'noLidar') { counts.noLidar++; L.noLidar++; continue; }
      counts[cls]++; L[cls]++;
    }
  }
  if (nearestDistances.length) {
    nearestDistances.sort((a, b) => a - b);
    const q = (p) => +nearestDistances[Math.min(nearestDistances.length - 1, Math.floor(p * nearestDistances.length))].toFixed(2);
    buildingDiag.nearestM = { min: q(0), p10: q(0.1), median: q(0.5), p90: q(0.9), max: q(1) };
  }

  const summary = summarize(cellArea, counts);
  const perLane = {};
  for (const [k, L] of Object.entries(byLane)) perLane[k] = summarize(cellArea, { corridorCells: L.corridorCells, building: L.building, pavement: L.pavement, water: L.water, outOfFrame: L.outOfFrame, noLidar: L.noLidar, below: L.below, low: L.low, tall: L.tall });

  const payload = {
    kind: 'island-low-vegetation-audit',
    bead: 'st-sb3r.35',
    note: 'Surface-return audit only. 1-5 m first-return height is not botanical proof; >=5 m returns hide the understory.',
    sources: {
      lidar: {
        dataset: 'Ontario Elevation Mapping Program, GTA 2023 lidar, DSM (first return) over DTM (bare earth), 0.5 m',
        licence: dsm.manifest.licence || null,
        licenceUrl: dsm.manifest.licenceUrl || null,
        attribution: dsm.manifest.attribution || null,
        dsmManifest: 'manifest-toronto-island-dsm.json',
        dtmManifest: 'manifest-toronto-island.json',
        cacheDir: DTM_DIR,
        dsmTiles: (dsm.manifest.tiles || []).length,
        dtmTiles: (dtm.manifest.tiles || []).length,
        manifestSha256: {
          dsm: sha256File(path.join(DTM_DIR, 'manifest-toronto-island-dsm.json')),
          dtm: sha256File(path.join(DTM_DIR, 'manifest-toronto-island.json'))
        },
        note: 'openDtm checks each tile against its manifest SHA-256 before reading it, so the numbers are reproducible only from these exact tiles.'
      },
      buildings: { file: BUILDINGS, source: 'OpenStreetMap contributors, ODbL', polygonsInCorridorBox: buildings.length },
      lanes: { file: 'js/waterfront-island-lanes-data.js', corridor: corridorLanes.map((r) => ({ name: r.names[0], ways: r.ways, lengthM: r.lengthM })) },
      water: { file: 'data/toronto-geodata.bin / js/toronto-geodata.js GEO.areas', polygonsInCorridorBox: waters.length }
    },
    rules: {
      corridorM: constants.corridorM,
      lowBandM: [lo, hi],
      buildingPadM: constants.buildingPadM,
      sampleM: step,
      cellAreaM2: cellArea,
      pavedWidthM: constants.pavedWidth,
      defaultPavedWidthM: constants.defaultPavedWidthM
    },
    summary,
    byLane: perLane,
    diagnostics: {
      buildingExclusion: buildingDiag,
      note: 'buildingExclusion.nearestM is over every corridor cell (before the pavement/water gates); cellsWithinM counts corridor cells within that distance of the nearest OSM building polygon. polygonsTouchingCorridor counts OSM polygons with a vertex within corridorM of a lane centre line.'
    },
    caveats: [
      'The lidar is a first-return DSM: under a closed >=5 m canopy it cannot observe the understory. tall5mPlus is a blind spot, not absence or presence of shrubs.',
      'A 1-5 m return is an elevated surface, not a species, flowerbed or hedge. Fences, sheds, decks, furniture, parked machines and vehicles can produce the same return.',
      'Areas within 1 m of an OSM building polygon, on a mapped paved lane, or under committed water are excluded; un-mapped sheds/decks/patios can still appear as low returns.',
      'OSM building completeness and geometry are community-mapped, not a survey. The lane widths are the captain-measured narrowed representatives.'
    ]
  };

  const text = JSON.stringify(payload, null, 2);
  console.log(text);
  if (OUT) { fs.writeFileSync(OUT, text + '\n'); console.error(`wrote ${OUT}`); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`audit-island-low-vegetation: ${e.message}`); process.exit(1); });
}
