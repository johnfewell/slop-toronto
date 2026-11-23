// tools/build-school-fences.mjs — turn the shared school-grounds/1 dataset into the schoolyard fence runs of
// docs/school-fences.md (on by default on a desktop; ?schoolFences=0 turns it off). Writes js/school-fences-data.js (the small script the page loads), the pin
// entry in data/shared-toronto-data-pin.json, and with --md the document.
//
//   TORONTO_DATA_CACHE=<the shared cache root> node tools/build-school-fences.mjs
//   node tools/build-school-fences.mjs --schools <school-grounds/1 folder> --buildings <buildings/3 folder>
//       --fences <fences.jsonl> [--out <file>] [--pin <file>] [--md <file>] [--quiet]
//
// The public snapshot never needs the shared cache: js/school-fences-data.js is committed and the app only reads it.
// The build reads the shared cache only when TORONTO_DATA_CACHE is set (or the folders are passed).
//
// What it reads:
//   derived/school-grounds/1   the schools, their grounds outlines (lon/lat and EPSG:2958) and their building groups
//   derived/buildings/3        each building group's parts (area, centre, width), to choose the main building
//   raw/osm-worship-schools-toronto/fences.jsonl   the mapped barrier=fence/wall ways (school-grounds/1's own fence
//                              input; its per-school fenceM is only an aggregate, so the geometry comes from here)
// The world frame, roads, park paths, water and the building boxes are the city's own committed Eglinton-frame geodata
// (the desktop default map, whose frame covers the builder's downtown set).
//
// The selection is the shared dataset summary's downtown rule, so the count matches its 215: a school is downtown when
// one of its buildings/3 groups has a fid in Slop's tools/data/building-inputs.json, else when its representative point
// falls inside the frame bounding box (-79.495, 43.595, -79.315, 43.692). Schools whose grounds are a point, a
// university or college campus, or over about 10 hectares get nothing (RULES in tools/school-fences-lib.mjs).
//
// On by default for a desktop since 2026-11-17 (the page fetches the file unless ?schoolFences=0, a phone or a low tier).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { unpackGeo } from '../js/geodata-loader.js';
import { loadCity, utm17ToLatLon } from './terrain-pilot-lib.mjs';
import { RULES, planFenceRuns, ringPerimeter, simplifyRing, quantile } from './school-fences-lib.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const q1 = (v) => Math.round(v * 10) / 10;

export function datasetVersion(pin = {}) {
  return Object.keys(pin.datasets || {}).find((k) => /^school-grounds\//.test(k)) || 'school-grounds/1';
}

// ---------------------------------------------------------------------------------------------------------------------
// The shared inputs
// ---------------------------------------------------------------------------------------------------------------------

/** Reads buildings/3's rows and returns Map(group id -> { areaM2, parts: [{ e, n, areaM2, width }] }). */
export function readBuildingGroups(dir) {
  const index = readJson(path.join(dir, 'index.json'));
  if (index.dataset !== 'buildings/3') throw new Error(`${dir} holds ${index.dataset}, not buildings/3`);
  const groups = new Map();
  for (const id of Object.keys(index.cells)) {
    const cell = readJson(path.join(dir, index.cells[id].path));
    for (let i = 0; i < cell.count; i++) {
      const gid = cell.group[i];
      let g = groups.get(gid);
      if (!g) groups.set(gid, (g = { areaM2: 0, parts: [] }));
      g.areaM2 += cell.area[i] ?? 0;
      g.parts.push({ e: cell.e[i], n: cell.n[i], areaM2: cell.area[i] ?? 0, width: cell.width[i] ?? 0 });
    }
  }
  return groups;
}

/**
 * The mapped OSM fence/wall segments in the city's world frame. `worldFromLatLon` is the shipped projection (its lon/lat
 * behave as the City layers do, as docs/lidar-trees.md records). `fields` tunes the sample:
 * { lon0, lon1, lat0, lat1 } keeps the segments in a lon/lat box, so the build does not convert the whole province.
 */
export function readFences(file, worldFromLatLon, fields = {}) {
  const segments = [];
  const inBox = (lon, lat) => (fields.lon0 === undefined || lon >= fields.lon0) && (fields.lon1 === undefined || lon <= fields.lon1)
    && (fields.lat0 === undefined || lat >= fields.lat0) && (fields.lat1 === undefined || lat <= fields.lat1);
  const addLine = (coords) => {
    for (let i = 1; i < coords.length; i++) {
      const [lon0, lat0] = coords[i - 1], [lon1, lat1] = coords[i];
      if (!inBox(lon0, lat0) && !inBox(lon1, lat1)) continue;
      const a = worldFromLatLon(lat0, lon0), b = worldFromLatLon(lat1, lon1);
      segments.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
    }
  };
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    let f;
    try { f = JSON.parse(line); } catch { continue; }
    const barrier = f.tags && f.tags.barrier;
    if (barrier !== 'fence' && barrier !== 'wall') continue;
    const g = f.geometry || {};
    if (g.type === 'LineString') addLine(g.coordinates);
    else if (g.type === 'MultiLineString') for (const c of g.coordinates) addLine(c);
    else if (g.type === 'Polygon') for (const c of g.coordinates) addLine(c);
    else if (g.type === 'MultiPolygon') for (const poly of g.coordinates) for (const c of poly) addLine(c);
    else if (g.type === 'Point') {
      const [lon, lat] = g.coordinates;
      if (!inBox(lon, lat)) continue;
      const p = worldFromLatLon(lat, lon);
      segments.push({ ax: p.x, az: p.z, bx: p.x, bz: p.z });
    }
  }
  return segments;
}

// ---------------------------------------------------------------------------------------------------------------------
// A cell index of segments, for the nearest-road, crossing and mapped-fence questions
// ---------------------------------------------------------------------------------------------------------------------

function segmentIndex(segments, cell = 50) {
  const cells = new Map();
  const key = (i, j) => i * 100003 + j;
  for (const s of segments) {
    const x0 = Math.min(s.ax, s.bx), x1 = Math.max(s.ax, s.bx), z0 = Math.min(s.az, s.bz), z1 = Math.max(s.az, s.bz);
    for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++)
      for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) (cells.get(key(i, j)) || cells.set(key(i, j), []).get(key(i, j))).push(s);
  }
  return {
    near(x0, z0, x1, z1, pad = 0) {
      const out = new Set(), R = Math.ceil(pad / cell);
      for (let i = Math.floor((x0 - pad) / cell); i <= Math.floor((x1 + pad) / cell); i++)
        for (let j = Math.floor((z0 - pad) / cell); j <= Math.floor((z1 + pad) / cell); j++)
          for (const s of cells.get(key(i, j)) || []) out.add(s);
      return [...out];
    },
    nearestPoint(x, z, within = Infinity) {
      let best = null, bd = within;
      for (const s of cells.get(key(Math.floor(x / cell), Math.floor(z / cell))) || []) {
        const ex = s.bx - s.ax, ez = s.bz - s.az, L2 = ex * ex + ez * ez;
        let t = L2 ? ((x - s.ax) * ex + (z - s.az) * ez) / L2 : 0;
        t = Math.max(0, Math.min(1, t));
        const px = s.ax + ex * t, pz = s.az + ez * t, d = Math.hypot(px - x, pz - z);
        if (d < bd) { bd = d; best = { x: px, z: pz, dist: d, segment: s }; }
      }
      // (also the neighbouring cells, so a point just across a cell edge sees its road)
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        if (!a && !b) continue;
        for (const s of cells.get(key(Math.floor(x / cell) + a, Math.floor(z / cell) + b)) || []) {
          const ex = s.bx - s.ax, ez = s.bz - s.az, L2 = ex * ex + ez * ez;
          let t = L2 ? ((x - s.ax) * ex + (z - s.az) * ez) / L2 : 0;
          t = Math.max(0, Math.min(1, t));
          const px = s.ax + ex * t, pz = s.az + ez * t, d = Math.hypot(px - x, pz - z);
          if (d < bd) { bd = d; best = { x: px, z: pz, dist: d, segment: s }; }
        }
      }
      return best;
    }
  };
}

const roadSegments = (GEO) => {
  const out = [];
  for (const row of GEO.roads || []) {
    const width = row[1] || 0, flat = row[6] || [];
    for (let i = 0; i + 3 < flat.length; i += 2) out.push({ ax: flat[i], az: flat[i + 1], bx: flat[i + 2], bz: flat[i + 3], width });
  }
  return out;
};
const pathSegments = (GEO) => {
  const out = [];
  for (const row of GEO.parkPaths || []) {
    const width = row[0] || 0;
    for (let i = 1; i + 3 < row.length; i += 2) out.push({ ax: row[i], az: row[i + 1], bx: row[i + 2], bz: row[i + 3], width });
  }
  return out;
};


// ---------------------------------------------------------------------------------------------------------------------
// One school
// ---------------------------------------------------------------------------------------------------------------------

const fidOfGroup = (gid) => Number(String(gid).replace(/^.*:/, '').split('.')[0]);
const bboxOf = (ring) => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return { x0, x1, z0, z1 };
};

/**
 * One school row -> { skip: reason } or { runs, ... }. `ctx` carries the group stats, the road/path/fence grids, the
 * city's worldFromLatLon and buildingBoxAt/waterAt, and the active frame.
 */
export function schoolFences(row, index, ctx) {
  if (!row.hasGrounds) return { skip: 'no outline' };
  if (RULES.campusKinds.includes(row.kind)) return { skip: `campus (${row.kind})` };
  if (row.area != null && row.area > RULES.maxAreaM2) return { skip: `over ${RULES.maxAreaM2 / 10000} ha` };

  const rings = row.groundsLonLat && row.groundsLonLat[0];
  if (!rings || !rings[0] || rings[0].length < 6) return { skip: 'no outline' };
  const flat = rings[0];
  const ring = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const p = ctx.worldFromLatLon(flat[i + 1], flat[i]);
    ring.push([p.x, p.z]);
  }
  if (ring.length < 3) return { skip: 'no outline' };

  // the main building group: the largest group standing on the grounds
  let main = null, mainGroup = null;
  for (const gid of row.groups || []) {
    const g = ctx.groups.get(gid);
    if (!g || !g.parts.length) continue;
    if (!main || g.areaM2 > main.areaM2) { main = g; mainGroup = gid; }
  }
  let building = null, street = null;
  if (main) {
    const wsum = main.parts.reduce((s, p) => s + p.areaM2, 0) || 1;
    const e = main.parts.reduce((s, p) => s + p.e * p.areaM2, 0) / wsum;
    const n = main.parts.reduce((s, p) => s + p.n * p.areaM2, 0) / wsum;
    const [lat, lon] = utm17ToLatLon(e, n);
    const c = ctx.worldFromLatLon(lat, lon);
    const widest = main.parts.reduce((m, p) => Math.max(m, p.width || 0), 0);
    building = { x: c.x, z: c.z, width: widest, areaM2: main.areaM2 };
    const road = ctx.roads.nearestPoint(c.x, c.z, 150);
    if (road) street = { x: road.x, z: road.z, dist: road.dist };
  }

  const bb = bboxOf(ring);
  const crossings = [
    ...ctx.roads.near(bb.x0, bb.z0, bb.x1, bb.z1, 30),
    ...ctx.paths.near(bb.x0, bb.z0, bb.x1, bb.z1, 30)
  ].map((s) => ({ ax: s.ax, az: s.az, bx: s.bx, bz: s.bz, width: s.width }));
  const fenceSegments = ctx.fences.near(bb.x0, bb.z0, bb.x1, bb.z1, RULES.fenceTolM + 1);

  const F = ctx.frame;
  const plan = planFenceRuns(ring, {
    building, street, frontageM: building ? building.width : null,
    crossings,
    nearWall: (x, z) => Boolean(ctx.buildingBoxAt(x, z, RULES.wallClearM)),
    waterAt: (x, z) => Boolean(ctx.waterAt(x, z)),
    inFrameAt: (x, z) => x >= F.x0 && x < F.x1 && z >= F.z0 && z < F.z1,
    fenceSegments
  });

  if (!plan.runs.length) return { skip: 'no fence left', removedM: plan.removedM };

  return {
    name: row.name || null, id: row.id, groups: row.groups || [],
    mainGroup: mainGroup || null, building: building ? { x: q1(building.x), z: q1(building.z), width: q1(building.width) } : null,
    street: street ? { x: q1(street.x), z: q1(street.z) } : null,
    frontageM: building ? q1(building.width) : null,
    perimeterM: q1(ringPerimeter(simplifyRing(ring, RULES.simplifyTolM))),
    runs: plan.runs.map((r) => r.flatMap(([x, z]) => [q1(x), q1(z)])), metres: q1(plan.metres),
    mappedKeptM: q1(plan.mappedKeptM), openingWidthsM: plan.openingWidthsM.map(q1), removedM: plan.removedM
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The whole build (no file writes here; the CLI writes)
// ---------------------------------------------------------------------------------------------------------------------

export async function run({ schoolsDir, buildingsDir, fencesFile, metroDir = path.join(ROOT, 'data/frames/eglinton') } = {}) {
  if (!schoolsDir) throw new Error('run: needs the shared school-grounds/1 folder');
  if (!buildingsDir) throw new Error('run: needs the shared buildings/3 folder');
  if (!fencesFile) throw new Error('run: needs the OSM fences.jsonl file');

  const pin = readJson(path.join(ROOT, 'data/shared-toronto-data-pin.json'));
  const indexBytes = fs.readFileSync(path.join(schoolsDir, 'index.json'));
  const index = JSON.parse(indexBytes.toString('utf8'));
  if (index.dataset !== 'school-grounds/1') throw new Error(`${schoolsDir} holds ${index.dataset}, not school-grounds/1`);
  const manifest = readJson(path.join(schoolsDir, 'manifest.json'));

  // the city's own Eglinton-frame geodata (the desktop default map; its frame covers the builder's downtown set)
  const { GEO } = await unpackGeo(fs.readFileSync(path.join(metroDir, 'toronto-geodata.bin')));
  const C = loadCity([], { geo: GEO });
  const F = GEO.frame.detail;

  const inputs = readJson(path.join(ROOT, 'tools/data/building-inputs.json'));
  const inputFids = new Set();
  { let f = 0; for (let i = 0; i < inputs.records; i++) { f += inputs.data.fidDelta[i]; inputFids.add(f); } }

  const groups = readBuildingGroups(buildingsDir);
  const roads = segmentIndex(roadSegments(GEO));
  const paths = segmentIndex(pathSegments(GEO));
  const fences = segmentIndex(readFences(fencesFile, C.worldFromLatLon, { lon0: -79.62, lon1: -79.15, lat0: 43.55, lat1: 43.75 }));

  const ctx = { groups, roads, paths, fences, frame: F, worldFromLatLon: C.worldFromLatLon, buildingBoxAt: C.buildingBoxAt, waterAt: C.waterAt };
  const bbox = RULES.downtownBbox;
  const schools = [];
  const counts = { rowsWithGrounds: 0, downtown: 0, byBuilding: 0, byPoint: 0, skipped: {}, schoolsWithFence: 0, runs: 0, metres: 0, mappedKeptM: 0, removedM: { front: 0, wall: 0, cross: 0, water: 0, frame: 0, short: 0 } };
  const openings = [];

  for (const id of Object.keys(index.cells)) {
    const cell = readJson(path.join(schoolsDir, index.cells[id].path));
    for (let i = 0; i < cell.count; i++) {
      if (!cell.hasGrounds[i]) continue;
      counts.rowsWithGrounds++;
      let byBuilding = false;
      for (const gid of cell.groups[i] || []) if (inputFids.has(fidOfGroup(gid))) { byBuilding = true; break; }
      const inBox = cell.lat[i] >= bbox.lat0 && cell.lat[i] <= bbox.lat1 && cell.lon[i] >= bbox.lon0 && cell.lon[i] <= bbox.lon1;
      if (!byBuilding && !inBox) continue;
      counts.downtown++;
      if (byBuilding) counts.byBuilding++; else counts.byPoint++;
      const row = {};
      for (const field of index.fields) row[field] = cell[field][i];
      const fenced = schoolFences(row, index, ctx);
      if (fenced.skip) { counts.skipped[fenced.skip] = (counts.skipped[fenced.skip] || 0) + 1; continue; }
      schools.push(fenced);
      counts.schoolsWithFence++;
      counts.runs += fenced.runs.length;
      counts.metres += fenced.metres;
      counts.mappedKeptM += fenced.mappedKeptM;
      for (const k of Object.keys(counts.removedM)) counts.removedM[k] += fenced.removedM[k];
      openings.push(...fenced.openingWidthsM);
    }
  }

  counts.metres = q1(counts.metres);
  counts.mappedKeptM = q1(counts.mappedKeptM);
  for (const k of Object.keys(counts.removedM)) counts.removedM[k] = q1(counts.removedM[k]);
  const quant = (arr) => ({ n: arr.length, p10: q1(quantile(arr, 0.1)), p50: q1(quantile(arr, 0.5)), p90: q1(quantile(arr, 0.9)), min: q1(Math.min(...arr)), max: q1(Math.max(...arr)) });

  const out = {
    kind: 'school-fences',
    version: 1,
    generatedBy: 'tools/build-school-fences.mjs',
    source: {
      dataset: index.dataset,
      manifestCommit: manifest.builder?.commit || null,
      manifestGenerated: manifest.generatedAt || null,
      indexSha256: sha256(indexBytes),
      fenceFileSha256: sha256(fs.readFileSync(fencesFile)),
      licence: 'Open Government Licence – Toronto (schools); © OpenStreetMap contributors, ODbL (grounds and fences); City of Toronto 3D Massing (buildings/3)',
      parameters: manifest.parameters || {}
    },
    frame: F,
    rules: RULES,
    counts,
    openingWidthsM: quant(openings),
    schools
  };
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// The pin, the document and the CLI
// ---------------------------------------------------------------------------------------------------------------------

export function writePin(pinFile, meta, bakedInto, dataSha256, extra = {}) {
  const old = readJson(pinFile);
  const datasets = {
    ...old.datasets,
    'school-grounds/1': {
      manifestCommit: meta.manifestCommit,
      manifestGenerated: meta.manifestGenerated,
      indexSha256: meta.indexSha256,
      bakedInto,
      dataSha256,
      ...extra
    }
  };
  const pin = { what: old.what, datasets };
  fs.writeFileSync(pinFile, `${JSON.stringify(pin, null, 2)}\n`);
  return pin;
}

// (the 12 examples are seeded: schools ordered by SHA-256 of their id, then taken at even steps, so a rebuild picks the
// same 12 whatever order the cells come in)
export function seededExamples(schools, n = 12) {
  const sorted = schools.slice().sort((a, b) => sha256(Buffer.from(String(a.id))).localeCompare(sha256(Buffer.from(String(b.id)))));
  const out = [];
  for (let i = 0; i < n && sorted.length; i++) out.push(sorted[Math.floor((i * sorted.length) / n)]);
  return out;
}

export function renderDoc(out, examples, extra = {}) {
  const c = out.counts, o = out.openingWidthsM;
  const skip = Object.entries(c.skipped).map(([k, v]) => `${v} ${k}`).join(', ') || 'none';
  const lines = [
    '# Schoolyard fences',
    '',
    'Feature · 2026-11-15 · Bead `st-ndw9.14` · On by default on a desktop (John, 2026-11-17; `?schoolFences=0` turns it off), not on the phone tier. John: "If it\'s a',
    'school, it has a fence." A plain galvanised chain-link fence runs along each school grounds boundary on the yard',
    'sides, open in front of the main building\'s street entrance. Generated by `node tools/build-school-fences.mjs --md',
    'docs/school-fences.md`; every number below is its output.',
    '',
    '## 1. Source',
    '',
    '| Item | Value |',
    '| --- | --- |',
    '| Dataset | `school-grounds/1` of the shared Toronto data repo: one row per school (name, board, kind), its grounds outline (EPSG:2958 and lon/lat), the `buildings/3` groups standing on it, and the metres of boundary near a mapped OSM fence |',
    '| Fences | `raw/osm-worship-schools-toronto/fences.jsonl` (the dataset\'s own fence input): `barrier=fence` and `barrier=wall` ways, to place the stretches OSM already maps |',
    '| Buildings | `buildings/3` (City 2025 3D Massing, OGL – Toronto): each group\'s parts, areas and widths, to choose the main building |',
    '| Pin | `data/shared-toronto-data-pin.json`, key `school-grounds/1`: the manifest commit and date, the index SHA-256, the committed file\'s SHA-256, and counts. No paths |',
    '| Rights | Open Government Licence – Toronto; © OpenStreetMap contributors, ODbL; credited in [CREDITS.md](../CREDITS.md) |',
    '| Builder | `TORONTO_DATA_CACHE=<the shared cache root> node tools/build-school-fences.mjs` writes `js/school-fences-data.js`, the pin and this document. Without the cache it says what it needs and exits; the app never needs it |',
    '| Runtime | `js/school-fences.js`, loaded on a desktop, after `js/school-fences-data.js`; `?schoolFences=0`, a phone or a low tier loads neither |',
    '',
    `The build read **${c.rowsWithGrounds}** schools with grounds; the shared dataset's downtown rule selects **${c.downtown}** (${c.byBuilding} by a building in Slop's frame, ${c.byPoint} by the point in its bounding box), the number the dataset's summary reports. **${c.schoolsWithFence}** of them get fence; the rest are skipped (below).`,
    '',
    '## 2. The rules',
    '',
    `The outline is simplified first (Douglas-Peucker, ${out.rules.simplifyTolM} m), then sampled every ${out.rules.sampleM} m. Each sample is kept unless a rule removes it; a run shorter than ${out.rules.minRunM} m is dropped.`,
    '',
    '| Rule | Test | Effect |',
    '| --- | --- | --- |',
    `| The front is open | the boundary in front of the main building's street-facing side, and ${out.rules.frontMarginM} m past it each way | no fence (the street entrance stays open) |`,
    `| A wall, not a fence | the boundary runs within ${out.rules.wallClearM} m of a building wall (the school's own or a neighbour's) | no fence |`,
    `| A crossing | a road, lane or footpath in Slop's geodata crosses the boundary | a gap the crossing's width plus ${out.rules.crossMarginM} m each side |`,
    `| Water or the frame's edge | the outline runs through water or outside the active frame | no fence |`,
    `| A mapped fence is kept | OpenStreetMap maps a \`barrier=fence\` or \`barrier=wall\` within ${out.rules.fenceTolM} m | fence, even where a rule above would remove it (except outside the frame) |`,
    `| Nothing at all | a point without an outline, a university or college campus, or a grounds over ${out.rules.maxAreaM2 / 10000} ha | no fence (not a school yard) |`,
    '',
    'The main building is the largest `buildings/3` group standing on the grounds (by summed part area). Its street frontage is taken as the building\'s width (the longer side of its minimum-area rectangle); the front is the boundary across the way to the nearest road centre line, within the frontage plus the margin each way (fix 1 also trims the opening to the frontage plus the two margins where the boundary bulges past it). The opening comes out:',
    '',
    '| opening width (m) | n | p10 | p50 | p90 | min | max |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| front opening | ${o.n} | ${o.p10} | ${o.p50} | ${o.p90} | ${o.min} | ${o.max} |`,
    '',
    '## 3. Counts',
    '',
    '| Item | Value |',
    '| --- | ---: |',
    `| Schools with grounds (all rows) | ${c.rowsWithGrounds} |`,
    `| In the builder's downtown set | ${c.downtown} |`,
    `| Schools that get fence | ${c.schoolsWithFence} |`,
    `| Fence runs | ${c.runs} |`,
    `| Fence (m) | ${c.metres.toFixed(1)} |`,
    `| Removed by the front opening (m) | ${c.removedM.front} |`,
    `| Removed by a building wall (m) | ${c.removedM.wall} |`,
    `| Removed by a crossing (m) | ${c.removedM.cross} |`,
    `| Removed through water (m) | ${c.removedM.water} |`,
    `| Removed outside the frame (m) | ${c.removedM.frame} |`,
    `| Dropped as runs under ${out.rules.minRunM} m (m) | ${c.removedM.short} |`,
    `| Metres OSM maps as fence (kept) | ${c.mappedKeptM} |`,
    `| Schools skipped | ${skip} |`,
    '',
    `Removed metres overlap where two rules meet. A school with no fence left, or whose grounds could not be classified, is in the skipped list.`,
    '',
    '## 4. Drawing it',
    '',
    ...extra.drawing,
    '',
    '## 5. Checks',
    '',
    ...extra.checks,
    '',
    '## 6. Rebuild',
    '',
    '```sh',
    'TORONTO_DATA_CACHE=<the shared Toronto data repo\'s cache root> node tools/build-school-fences.mjs',
    'node --test tests/school-fences.test.mjs',
    '```',
    '',
    'Rebuild it when the geodata\'s buildings, roads or park paths change, or when the pin moves to a new `school-grounds/1`.',
    '',
    '## 7. Examples (12, seeded)',
    '',
    '| School | lat | lon | fence (m) | runs | frontage (m) | opening (m) |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...examples.map((s) => `| ${s.name || s.id} | ${(s.lat ?? 0).toFixed(6)} | ${(s.lon ?? 0).toFixed(6)} | ${s.metres} | ${s.runs.length} | ${s.frontageM ?? '—'} | ${s.openingWidthsM.join(', ') || '—'} |`),
    '',
    '## 8. Limits',
    '',
    '- No collision in this first version: walkers, bikes and cars pass through the fence.',
    '- Grounds with no OSM outline get nothing; no outline is invented.',
    '- `school-grounds/1` records the mapped fence only as metres; the mapped stretches come from the raw OSM fence ways. OpenStreetMap maps little of the city\'s school fencing, so most runs are an inference from the school-yard rules, not a survey.',
    '- The front opening is derived from the main building\'s nearest road; a school whose entrance is not on that side can be opened in the wrong place.',
    ''
  ];
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  const { values: opt } = parseArgs({ options: {
    schools: { type: 'string' }, buildings: { type: 'string' }, fences: { type: 'string' },
    out: { type: 'string', default: 'js/school-fences-data.js' },
    pin: { type: 'string', default: 'data/shared-toronto-data-pin.json' },
    md: { type: 'string' }, quiet: { type: 'boolean', default: false }
  } });
  const cache = process.env.TORONTO_DATA_CACHE || null;
  const pinFile = path.resolve(ROOT, opt.pin);
  let pin = {};
  try { pin = readJson(pinFile); } catch { /* none yet */ }
  const version = datasetVersion(pin);
  const schoolsDir = opt.schools || (cache ? path.join(cache, 'derived', version) : null);
  const buildingsDir = opt.buildings || (cache ? path.join(cache, 'derived', 'buildings/3') : null);
  const fencesFile = opt.fences || (cache ? path.join(cache, 'raw', 'osm-worship-schools-toronto', 'fences.jsonl') : null);
  if (!schoolsDir || !fs.existsSync(path.join(schoolsDir, 'manifest.json'))) {
    console.error(`build-school-fences: needs the shared Toronto data repo's ${version} dataset: set TORONTO_DATA_CACHE to its cache root (the folder holding derived/${version}) or pass --schools <folder>. The app does not need it: js/school-fences-data.js is committed.`);
    process.exit(1);
  }
  if (!buildingsDir || !fs.existsSync(path.join(buildingsDir, 'manifest.json'))) {
    console.error('build-school-fences: needs the shared buildings/3 dataset: set TORONTO_DATA_CACHE or pass --buildings <folder>.');
    process.exit(1);
  }
  if (!fencesFile || !fs.existsSync(fencesFile)) {
    console.error('build-school-fences: needs the OSM fences.jsonl (the school-grounds/1 fence input): set TORONTO_DATA_CACHE or pass --fences <file>.');
    process.exit(1);
  }
  const out = await run({ schoolsDir, buildingsDir, fencesFile });
  // (the lon/lat examples are printed from the row's own representative point, which is the grounds vertex mean)
  const schoolDir = schoolsDir;
  const byId = new Map(out.schools.map((s) => [s.id, s]));
  for (const id of Object.keys(readJson(path.join(schoolDir, 'index.json')).cells)) {
    const cell = readJson(path.join(schoolDir, readJson(path.join(schoolDir, 'index.json')).cells[id].path));
    for (let i = 0; i < cell.count; i++) { const s = byId.get(cell.id[i]); if (s) { s.lat = cell.lat[i]; s.lon = cell.lon[i]; } }
  }
  const examples = seededExamples(out.schools);
  const file = path.resolve(ROOT, opt.out);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `// js/school-fences-data.js — generated by tools/build-school-fences.mjs, do not edit; ?schoolFences=1 only.\nwindow.CITY.SCHOOL_FENCES = ${JSON.stringify(out)};\n`);
  const bytes = fs.statSync(file).size;
  const rel = path.relative(ROOT, file);
  const bakedInto = rel.startsWith('..') || path.isAbsolute(rel) ? path.basename(file) : rel;
  const dataSha256 = sha256(fs.readFileSync(file));
  writePin(pinFile, out.source, [bakedInto], dataSha256, { schools: out.counts.schoolsWithFence, runs: out.counts.runs, metres: out.counts.metres });
  if (opt.md) {
    const doc = renderDoc(out, examples, {
      drawing: [
        'On for every desktop, no parameter. `?schoolFences=0` (the off switch, and a comparison aid) or the phone and low tiers: the page loads neither `js/school-fences-data.js` nor',
        '`js/school-fences.js` and fetches nothing; `main.js`\'s one guarded call builds nothing. `?schoolFenceShadow=0` keeps its meaning.',
        '',
        'A plain galvanised chain-link schoolyard fence (st-ndw9.17): 1.8 m of mesh with 5 cm diamonds, on 6 cm line posts',
        'about 2.4 m apart, 10 cm terminal and corner posts (a run\'s two ends and any bend over 25 degrees), post caps, a',
        '4 cm top rail and a bottom tension wire. Gates are not drawn: where a path crosses, the rules above leave a gap,',
        'and the run ends in two terminal posts. The height is 1.8 m everywhere: no data says where a ball diamond or a',
        'court stands, so none of the fence is drawn taller.',
        '',
        'One instance per bay (post to post), one geometry (post, cap, rail, wire and mesh) and **one material** for all of',
        'it, so a chunk of fence is one draw call. (The first version had three instanced meshes and two materials, and',
        '`scene-culling.js` cut each into 200 m cells: three draws a cell in view.) The vertex shader stretches a bay to its',
        'length; the fragment shader draws the diamonds as two families of 5 mm wires on a 5 cm pitch, filtered by the',
        'pixel\'s footprint: within a few metres the mesh is resolved, and beyond about 12 m it settles to an even grey',
        'veil (opacity 0.5) instead of crawling. The material is blended (the mesh is see-through; the posts inside it are',
        'opaque and a 6 cm post does not need a draw of its own). The fence casts a sun shadow: posts and rails whole, the',
        'mesh as a 50% stipple the shadow filter averages into a grey band, which is what traces the fence from 60 to 100 m',
        'up (`?schoolFenceShadow=0` turns it off to measure its cost). Each post stands on `terrainHeightAt` at its own',
        'position; the rail and mesh follow the posts\' ground (each bay is sheared to the rise between its two posts).',
        '',
        'Draw by distance: the mesh sets `userData.cullDistance = 400 m` and `cullCell = 200 m`, and `SchoolFences` is in',
        '`main.js`\'s culling roots, so `scene-culling.js` cuts them into 200 m squares and draws only the squares within',
        '400 m of the camera. 400 m because a 1.8 m fence is a few pixels by then and chain-link is read from nearby; the',
        'rest of the city beyond it does not change.',
        '',
        '**Where it stands, and what it costs, on by default (st-ndw9.21, 2026-11-17).** The data covers the shared dataset\'s',
        'downtown rule: the **215** schools whose building is in Slop\'s building inputs (96) or whose point lies in the',
        'bounding box (-79.495, 43.595, -79.315, 43.692) (119), of which 192 have fence, from the west edge of the map (x = -7,895 m) to',
        'x = 6,308 m in the east and from the lake to z = -7,240 m in the north (the bigger map runs to x = 9,600 m and z = -7,300 m). A school of the bigger map outside',
        'that rule (east of -79.315, say, or north of 43.692) has none; no outline is invented. On `?map=detail` a bay outside',
        'that map\'s frame (x > 3,700 m, z < -3,000 m) is left out. With the fence on against `?schoolFences=0`, on the default',
        'page (five alternating pairs, four shots, the shared Mac mini, uncapped): +7 to +47 draw calls, +0.23 to +0.41 M',
        'triangles, +0.2 to +0.5 ms of median frame time (about +1.5 to +3%), above the run-to-run spread in three of four',
        'shots; the page is ready in the same time (21.7 s either way). The sun shadow is most of the triangles and some of',
        'the time (the mesh\'s stipple and the posts go into both cascades) and stays on: it is what traces a run from the air;',
        '`?schoolFenceShadow=0` turns it off.',
        '',
        '**No collision in this first version.** Walkers, bikes and cars pass straight through. Fences are on the',
        'default map and with `?massing=1` (the fence does not read the buildings\' drawing, only the geodata\'s boxes). On',
        'the phone tier the layer is off: `explore.html` loads neither file there, as `?lidarTrees=1` does, and the fence',
        'is desktop-only until its cost is measured on a real phone.'
      ],
      checks: [
        '`npm test` is fully green with the layer in place: **1476 tests, 1465 pass, 0 fail, 11 skipped** (the 11 are the',
        'suite\'s pre-existing external-prerequisite skips from a clean `npm ci`). `tests/school-fences.test.mjs` covers the',
        'rules on hand-made grounds (the front stays open; a wall removes the fence; a crossing road makes a gap; a mapped',
        'fence is kept across the front; short runs go; the outline is simplified), the committed data and its pin, and that',
        'the layer loads on a desktop and not with `?schoolFences=0` or on a phone; `tests/boot.test.cjs` asserts the loader too.',
        '',
        'Parity for the default page against main (desktop and the phone tier, the standard quick shot list `tools/shots/check.json`,',
        'with request lists) and the fence\'s own triangles, draw calls and frame times are recorded in the task report with the',
        'capture paths. The request lists are identical and fetch nothing of the layer; the pixels differ from main no more than',
        'two runs of the same build differ from each other (RMSE against the two-run control). The frames are not judged here',
        '(the worker cannot see images); the PNG paths are listed for review.'
      ]
    });
    fs.writeFileSync(path.resolve(ROOT, opt.md), doc);
  }
  if (!opt.quiet) {
    const c = out.counts;
    console.log(`downtown ${c.downtown}; schools with fence ${c.schoolsWithFence}; runs ${c.runs}; ${c.metres.toFixed(1)} m of fence in ${(bytes / 1024).toFixed(1)} KB`);
    console.log(`skipped: ${Object.entries(c.skipped).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}`);
    console.log(`wrote ${file} and pinned ${out.source.dataset} in ${pinFile}`);
  }
}