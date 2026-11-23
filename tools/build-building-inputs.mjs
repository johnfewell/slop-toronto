// tools/build-building-inputs.mjs — st-ndw9.5: take the facts about every City 3D Massing part from the shared Toronto
// data repo's buildings dataset, joined to Slop's massing sidecar by durable id, and write them once to
// tools/data/building-inputs.json so tools/report-building-forms.mjs runs from the repo alone.
//
// The dataset version comes from data/shared-toronto-data-pin.json (one key, `buildings/4`); moving to a new version is
// that one line. The house-test thresholds come from the dataset's manifest `parameters` and are recorded in the file's
// header. Without TORONTO_DATA_CACHE the script refuses to rebuild and says why: the committed file is used.
//
// The file is compact (the brief's fix 1, item 2): one array per column, in sidecar order; lengths and heights in
// tenths (0.1 m / 0.1 m²); 0/1 flags; the repeated strings `use` and `form` as small integers with the names listed
// once in `enums`; the group as an integer (-1 for a one-part group, else the group's index); the durable sidecar id
// not stored (it is derived from `fid` and `k`: `<fid>` for a one-row record, else `<fid>.<k>` — the two exceptions are
// named in `checks.idSuffixExceptions`). `fid` is stored as `fidFirst` plus `fidDelta` (ints); the reader rebuilds it.
// Dropped because the report does not use them: name, osmId, lon, lat, e, n, cell, surfElev, heightSrc, perimeter,
// sidecarId, row, width, minHeight, sharedSides, sharedEdges, groupSize, perDwelling (derived from area and address
// points), yearBuilt, yearSource.
//
// The dataset's ids are `to-3dmassing-2025:<fid>` for a single-part record and `<fid>.<k>` for the k-th outer ring of a
// multi-polygon record (js/massing-data.js massingId). Four sidecar records in this frame are the one part the dataset
// kept from a multi-polygon record whose other part it dropped: the dataset then writes the record as single-part
// (`<fid>`), while the sidecar keeps the source ring index (`<fid>.<k>`). Those four are joined by their one dataset row
// for the fid, and the count is in the checks block.
//
// usage: TORONTO_DATA_CACHE=<shared cache root> node tools/build-building-inputs.mjs [--datasets <folder>] [--out <path>]
//          [--pin <path>] [--quiet]
//
// Sources: the shared Toronto data repo's buildings/4 (derived from the City's 2025 3D Massing, Open Government Licence
// – Toronto; City address points; OpenStreetMap, ODbL 1.0). Nothing the page loads is changed.
//
// st-ndw9.16: buildings/4 adds the religion, tradition and worshipSource of a place of worship and the school-grounds
// row a part stands on. `religion`, `tradition` and `worshipSource` are stored as small integers, their names listed once
// in `worshipEnums` (-1 for null); `schoolGround` is a 0/1 flag (the part stands on a school ground). No other column
// changes: the version-3 fields are read the same way and come out byte-identical.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { unpackGeo } from '../js/geodata-loader.js';
import { massingId, massingRows } from '../js/massing-data.js';
import { utm17 } from './terrain-pilot-lib.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELF = fileURLToPath(import.meta.url);

export const OSM_CLASS = { none: 0, house: 1, business: 2, worship: 3, civic: 4, industrial: 5, shed: 6, apartments: 7, other: 8 };
export const OSM_CLASS_NAMES = ['none', 'house', 'business', 'worship', 'civic', 'industrial', 'shed', 'apartments', 'other'];
export const FORM_NAMES = ['detached', 'semi', 'row', 'outbuilding', 'other'];

// The columns, in the file's `data`, each an array in sidecar order. `fidFirst` + `fidDelta` rebuilds `fid`.
// `neighbourhood` (st-ndw9.10): the City neighbourhood number holding the record's centre, from the shared
// neighbourhood-era/1 polygons; `yearBuilt` (st-ndw9.10): the dataset's construction year where a source has one, else
// null. Both feed the building-preset assignment; nothing the page loads is read from them.
export const COLUMNS = [
  'fidDelta', 'k', 'area', 'depth', 'maxHeight', 'avgHeight', 'base', 'addressPoints', 'canopyHeight', 'shop',
  'outbuilding', 'houseScale', 'dwellings', 'use', 'form', 'group', 'neighbourhood', 'yearBuilt',
  // (st-ndw9.16: buildings/4's worship fields, as enumerated integers -1 for null, and the school-grounds flag)
  'religion', 'tradition', 'worshipSource', 'schoolGround'
];

// The dataset's normalised religion and tradition lists (buildings/4 README), and where religion and tradition came
// from: the tag (`osm:`/`city:`) or the name (`osm-name:`/`city-name:`), as the raw value's prefix.
export const RELIGION_NAMES = ['christian', 'muslim', 'jewish', 'buddhist', 'hindu', 'sikh', 'other', 'unknown'];
export const TRADITION_NAMES = ['roman catholic', 'anglican', 'united', 'presbyterian', 'baptist', 'lutheran', 'orthodox', 'pentecostal and evangelical', 'other', 'unknown'];
export const WORSHIP_SOURCE_NAMES = ['osm', 'city', 'osm-name', 'city-name'];

/** A name list's index, or -1 for a null/absent value (the compact file's encoding of "none"). */
const enumIndex = (names, value) => (value == null ? -1 : Math.max(0, names.indexOf(value)));
// Lengths and heights are stored in tenths (0.1 m, 0.1 m²): the precision the dataset publishes.
export const SCALE = { area: 10, depth: 10, maxHeight: 10, avgHeight: 10, base: 10, canopyHeight: 10 };
const BOOLEANS = new Set(['shop', 'outbuilding', 'houseScale']);

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const sourceDate = (file) => {
  try { return fs.statSync(file).mtime.toISOString().slice(0, 10); } catch { return null; }
};
const tenths = (v) => (v == null ? null : Math.round(Number(v) * 10));

/**
 * The pin's buildings dataset version, and the folder that holds it. With no pin entry yet, `buildings/4`.
 * Moving to a new version is changing the pin's one key.
 */
export function datasetVersion(pin = {}) {
  const key = Object.keys(pin.datasets || {}).find((k) => /^buildings\//.test(k));
  return key || 'buildings/4';
}

/** The shared neighbourhood-era dataset version (its polygons carry the City neighbourhood number and name). */
export function neighbourhoodVersion(pin = {}) {
  return Object.keys(pin.datasets || {}).find((k) => /^neighbourhood-era\//.test(k)) || 'neighbourhood-era/1';
}

/**
 * Reads the shared neighbourhood-era/1 `neighbourhoods.geojson`: one entry per City neighbourhood with its number, name
 * and outer rings in lon / lat (WGS84). A point-in-polygon over the rings gives a record's neighbourhood (st-ndw9.10).
 */
export function readNeighbourhoods(dir) {
  const file = path.join(dir, 'neighbourhoods.geojson');
  const geo = readJson(file);
  const features = (geo.features || []).map((f) => {
    const g = f.geometry || {};
    const rings = [];
    if (g.type === 'Polygon') rings.push(g.coordinates[0]);
    else if (g.type === 'MultiPolygon') for (const poly of g.coordinates) rings.push(poly[0]);
    return { number: f.properties.number, name: f.properties.name, rings };
  });
  const bounds = features.map((f) => {
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const ring of f.rings) for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    }
    return { minLon, maxLon, minLat, maxLat };
  });
  return { file, features, bounds, sha256: sha256(fs.readFileSync(file)), manifestSha256: null };
}

/** Whether (lon, lat) is inside one ring (ray casting in lon / lat). */
function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The City neighbourhood number holding (lon, lat), or null outside every one. */
export function neighbourhoodAt(nb, lon, lat) {
  for (let i = 0; i < nb.features.length; i++) {
    const b = nb.bounds[i];
    if (lon < b.minLon || lon > b.maxLon || lat < b.minLat || lat > b.maxLat) continue;
    for (const ring of nb.features[i].rings) if (inRing(lon, lat, ring)) return nb.features[i].number;
  }
  return null;
}

/**
 * The 500 m dataset cells whose square meets the detail frame, with 500 m spare (the frame is a rotated rectangle in
 * the city's local metres, the cells are UTM squares). Same rule as tools/build-lidar-trees.mjs.
 */
export function frameCells(index, GEO, latLonFromWorld, marginM = 550) {
  const F = GEO.frame.detail;
  const edge = [];
  for (let s = 0; s <= 1; s += 0.01) {
    edge.push([F.x0 + s * (F.x1 - F.x0), F.z0], [F.x0 + s * (F.x1 - F.x0), F.z1], [F.x0, F.z0 + s * (F.z1 - F.z0)], [F.x1, F.z0 + s * (F.z1 - F.z0)]);
  }
  const U = edge.map(([x, z]) => { const p = latLonFromWorld(x, z); return utm17(p.lat, p.lon); });
  const [E0, E1, N0, N1] = [Math.min(...U.map((u) => u[0])) - marginM, Math.max(...U.map((u) => u[0])) + marginM, Math.min(...U.map((u) => u[1])) - marginM, Math.max(...U.map((u) => u[1])) + marginM];
  return Object.keys(index.cells).filter((id) => { const [e, n] = id.split('_').map(Number); return e + 500 > E0 && e < E1 && n + 500 > N0 && n < N1; }).sort();
}

/**
 * Reads the dataset's manifest, index and frame cells. Returns { meta, parameters, rows, byFidK, byFid } where each row
 * is the dataset's fields for one City massing part. Reads files only; writes nothing.
 */
export function readDataset(dir, { GEO, latLonFromWorld, marginM = 550 } = {}) {
  const manifest = readJson(path.join(dir, 'manifest.json'));
  const indexBytes = fs.readFileSync(path.join(dir, 'index.json'));
  const index = JSON.parse(indexBytes.toString('utf8'));
  if (!GEO || !latLonFromWorld) throw new Error('readDataset: needs GEO and latLonFromWorld');
  if (manifest.dataset !== index.dataset) throw new Error(`readDataset: ${dir} manifest says ${manifest.dataset}, index says ${index.dataset}`);
  if (!Array.isArray(index.fields)) throw new Error('readDataset: index.json has no fields list');
  const cells = frameCells(index, GEO, latLonFromWorld, marginM);
  const rows = [];
  for (const id of cells) {
    const cell = readJson(path.join(dir, index.cells[id].path));
    for (let i = 0; i < cell.count; i++) {
      const row = {};
      for (const field of index.fields) row[field] = cell[field]?.[i] ?? null;
      rows.push(row);
    }
  }
  const byFidK = new Map(rows.map((r) => [`${r.fid}:${r.k}`, r]));
  const byFid = new Map();
  for (const r of rows) (byFid.get(r.fid) || byFid.set(r.fid, []).get(r.fid)).push(r);
  // A digest of the cells: each cell's id and SHA-256 from the index, in cell-id order (content, not this machine).
  const cellsDigest = sha256(Buffer.from(cells.map((id) => `${id}:${index.cells[id].sha256 || ''}`).join('\n')));
  const P = manifest.parameters || {};
  return {
    meta: {
      dataset: manifest.dataset,
      manifestCommit: manifest.builder?.commit || null,
      manifestGenerated: manifest.generatedAt || manifest.manifestGenerated || null,
      indexSha256: sha256(indexBytes),
      cellsDigest,
      cells: cells.length,
      rows: rows.length,
      generatedAt: index.generatedAt || null
    },
    parameters: {
      houseMaxPerDwellingM2: P.houseMaxPerDwellingM2 ?? null,
      houseMaxAreaM2: P.houseMaxAreaM2 ?? null,
      houseMaxHeightM: P.houseMaxHeightM ?? null,
      excludeOsm: Array.isArray(P.excludeOsm) ? P.excludeOsm.slice() : [],
      storeyM: P.storeyM ?? null,
      outbuildingMaxAreaM2: P.outbuildingMaxAreaM2 ?? null,
      outbuildingMaxHeightM: P.outbuildingMaxHeightM ?? null
    },
    rows, byFidK, byFid
  };
}

/**
 * Joins the sidecar's (fid, k) to the dataset's rows: exact pair first, then — where a multi-polygon record's other
 * part was dropped upstream and the dataset wrote the one remaining part as single-part — the fid's one dataset row.
 * `sidecar` are { fid, k } in sidecar order. Returns the dataset row per sidecar index, plus the counts.
 */
export function joinRows(sidecar, { byFidK, byFid }) {
  const joined = new Array(sidecar.length).fill(null);
  const used = new Set();
  const fallbackIds = [];
  let exact = 0, byFidJoin = 0;
  // (the sidecar can hold more than one record with a fid: only a fid with a single sidecar record is a fallback)
  const sidecarPerFid = new Map();
  for (const s of sidecar) sidecarPerFid.set(s.fid, (sidecarPerFid.get(s.fid) || 0) + 1);
  const keyOf = (r) => `${r.fid}:${r.k}`;
  for (let i = 0; i < sidecar.length; i++) {
    const r = byFidK.get(`${sidecar[i].fid}:${sidecar[i].k}`);
    if (r && !used.has(keyOf(r))) { joined[i] = r; used.add(keyOf(r)); exact++; }
  }
  const unmatchedIds = [];
  for (let i = 0; i < sidecar.length; i++) {
    if (joined[i]) continue;
    const cand = (byFid.get(sidecar[i].fid) || []).filter((r) => !used.has(keyOf(r)));
    if (cand.length === 1 && sidecarPerFid.get(sidecar[i].fid) === 1) {
      joined[i] = cand[0]; used.add(keyOf(cand[0])); byFidJoin++;
      fallbackIds.push(`to-3dmassing-2025:${sidecar[i].fid}.${sidecar[i].k}`);
    } else {
      unmatchedIds.push(`to-3dmassing-2025:${sidecar[i].fid}.${sidecar[i].k}`);
    }
  }
  return { joined, exact, byFid: byFidJoin, fallbackIds, unmatched: unmatchedIds.length, unmatchedIds };
}

/** The sidecar's durable id from `fid` and `k` and the set's multi-part fids: `<fid>` for a one-row record, else `<fid>.<k>`. */
export function derivedSidecarId(fid, k, multiFids) {
  return `to-3dmassing-2025:${fid}${multiFids.has(fid) || k > 0 ? '.' + k : ''}`;
}

/**
 * Loads the committed geodata and sidecar and the shared dataset, joins them, and returns the compact building-inputs
 * object. No files are written here. `dir` is the dataset folder; the CLI refuses without one.
 */
export async function run({ dir, neighbourhoods = null } = {}) {
  if (!dir) throw new Error('run: needs the shared buildings dataset folder');
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/toronto-geodata.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/city-config.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/toronto-geodata-ids.js'), 'utf8'), ctx);
  const { GEO, latLonFromWorld } = ctx.window.CITY;
  const { GEO_IDS } = ctx.window.CITY;
  if (!GEO_IDS || !Array.isArray(GEO_IDS.buildings)) throw new Error('js/toronto-geodata-ids.js: no GEO_IDS.buildings');

  const { MASSING: M } = await unpackGeo(fs.readFileSync(path.join(ROOT, 'data/toronto-massing.bin')));
  const loaded = massingRows(M, GEO);
  if (loaded.error) throw new Error(loaded.error);
  const dataset = readDataset(dir, { GEO, latLonFromWorld });

  const sidecar = [];
  for (let i = 0; i < M.fid.length; i++) sidecar.push({ fid: M.fid[i], k: M.part[i] ? M.part[i] - 1 : 0 });
  const join = joinRows(sidecar, dataset);

  // Groups: the dataset's `group` as an integer. A one-part group is -1; the reader keys it by its own record.
  const groupCount = new Map();
  for (const r of join.joined) if (r) groupCount.set(r.group, (groupCount.get(r.group) || 0) + 1);
  const groupIndex = new Map();
  for (const r of join.joined) if (r && groupCount.get(r.group) > 1 && !groupIndex.has(r.group)) groupIndex.set(r.group, groupIndex.size);

  // The columns, one array per field, in sidecar order.
  const data = Object.fromEntries(COLUMNS.map((c) => [c, new Array(sidecar.length).fill(null)]));
  let fidPrev = 0;
  for (let i = 0; i < sidecar.length; i++) {
    const r = join.joined[i];
    const fid = r ? r.fid : sidecar[i].fid;
    data.fidDelta[i] = fid - fidPrev; fidPrev = fid;
    if (!r) continue;
    data.k[i] = sidecar[i].k;
    for (const c of Object.keys(SCALE)) data[c][i] = tenths(r[c]);
    data.addressPoints[i] = r.addressPoints;
    data.dwellings[i] = r.dwellings;
    for (const c of BOOLEANS) data[c][i] = r[c] ? 1 : 0;
    data.use[i] = r.use == null ? 0 : Math.max(0, OSM_CLASS_NAMES.indexOf(r.use));
    data.form[i] = Math.max(0, FORM_NAMES.indexOf(r.form));
    data.group[i] = groupCount.get(r.group) > 1 ? groupIndex.get(r.group) : -1;
    // (st-ndw9.10: the construction year where a source has one; the City neighbourhood holding the record's centre)
    data.yearBuilt[i] = r.yearBuilt == null ? null : Math.round(Number(r.yearBuilt));
    // (st-ndw9.16: buildings/4's worship fields as integers, and whether the part stands on a school ground)
    data.religion[i] = enumIndex(RELIGION_NAMES, r.religion);
    data.tradition[i] = enumIndex(TRADITION_NAMES, r.tradition);
    data.worshipSource[i] = r.worshipSource == null ? -1 : Math.max(0, WORSHIP_SOURCE_NAMES.findIndex((s) => String(r.worshipSource).startsWith(s + ':')));
    data.schoolGround[i] = r.school != null ? 1 : 0;
    if (neighbourhoods) {
      const b = GEO.buildings[M.row[i]];
      const p = latLonFromWorld(b[0], b[1]);
      data.neighbourhood[i] = neighbourhoodAt(neighbourhoods, p.lon, p.lat);
    }
  }

  const matched = join.joined.filter(Boolean);
  // (the sidecar's durable id, derived from fid, k and the multi-part fids; the exceptions are named)
  const multiFids = new Set();
  const fidRows = new Map();
  for (const s of sidecar) fidRows.set(s.fid, (fidRows.get(s.fid) || 0) + 1);
  for (const s of sidecar) if (fidRows.get(s.fid) > 1 || s.k > 0) multiFids.add(s.fid);
  const idSuffixExceptions = [];
  for (let i = 0; i < sidecar.length; i++) {
    const derived = derivedSidecarId(sidecar[i].fid, sidecar[i].k, multiFids);
    if (derived !== massingId(M, i)) idSuffixExceptions.push(massingId(M, i));
  }

  const checks = {
    sidecarRecords: sidecar.length,
    datasetRowsRead: dataset.meta.rows,
    datasetCells: dataset.meta.cells,
    matchedByFidK: join.exact,
    matchedByFidSinglePart: join.byFid,
    fallbackIds: join.fallbackIds,
    unmatched: join.unmatched,
    unmatchedIds: join.unmatchedIds.slice(0, 40),
    idSuffixExceptions,
    multiPartSidecarRecords: sidecar.filter((s) => s.k > 0).length,
    houseScaleRecords: matched.filter((r) => r.houseScale).length,
    outbuildingRecords: matched.filter((r) => r.outbuilding).length,
    maxHeightZero: matched.filter((r) => r.maxHeight === 0).length,
    addressPoints: matched.reduce((s, r) => s + (r.addressPoints || 0), 0),
    groups: groupCount.size,
    multiPartGroups: groupIndex.size,
    groupRecords: sidecar.length - [...groupCount.values()].filter((n) => n === 1).length,
    // (st-ndw9.10: the neighbourhood column and the year column)
    neighbourhoodRecords: data.neighbourhood.filter((v) => v != null).length,
    neighbourhoodsUsed: [...new Set(data.neighbourhood.filter((v) => v != null))].sort((a, b) => a - b),
    recordsWithoutNeighbourhood: data.neighbourhood.filter((v) => v == null).length,
    yearBuiltRecords: data.yearBuilt.filter((v) => v != null).length,
    // (st-ndw9.16: the worship fields and the school-grounds flag)
    religionRecords: data.religion.filter((v) => v >= 0).length,
    religionByValue: Object.fromEntries(RELIGION_NAMES.map((name, i) => [name, data.religion.filter((v) => v === i).length]).filter(([, n]) => n > 0)),
    traditionRecords: data.tradition.filter((v) => v >= 0).length,
    traditionByValue: Object.fromEntries(TRADITION_NAMES.map((name, i) => [name, data.tradition.filter((v) => v === i).length]).filter(([, n]) => n > 0)),
    worshipSourceRecords: data.worshipSource.filter((v) => v >= 0).length,
    worshipSourceByValue: Object.fromEntries(WORSHIP_SOURCE_NAMES.map((name, i) => [name, data.worshipSource.filter((v) => v === i).length]).filter(([, n]) => n > 0)),
    schoolGroundRecords: data.schoolGround.filter((v) => v === 1).length
  };
  // (positive controls on the join: every sidecar record matched, and no dataset row went to two records)
  checks.everySidecarRecordMatched = join.unmatched === 0;
  checks.rowsUnique = new Set(join.joined.filter(Boolean).map((r) => `${r.fid}:${r.k}`)).size === matched.length;

  return {
    generatedBy: 'tools/build-building-inputs.mjs',
    since: '2026-11-15',
    units: 'lengths and areas in tenths: heights and setbacks 0.1 m, footprints 0.1 m²; the reader divides by 10',
    sources: {
      massing: { file: 'data/toronto-massing.bin', edition: M.edition, records: M.fid.length, date: sourceDate(path.join(ROOT, 'data/toronto-massing.bin')) },
      geodata: { file: 'js/toronto-geodata.js', rows: GEO.buildings.length, date: sourceDate(path.join(ROOT, 'js/toronto-geodata.js')) },
      dataset: {
        dataset: dataset.meta.dataset,
        manifestCommit: dataset.meta.manifestCommit,
        manifestGenerated: dataset.meta.manifestGenerated,
        indexSha256: dataset.meta.indexSha256,
        cellsDigest: dataset.meta.cellsDigest,
        cells: dataset.meta.cells,
        rows: dataset.meta.rows,
        generatedAt: dataset.meta.generatedAt
      },
      neighbourhoods: neighbourhoods ? {
        dataset: 'neighbourhood-era/1',
        file: 'neighbourhoods.geojson',
        features: neighbourhoods.features.length,
        sha256: neighbourhoods.sha256
      } : null
    },
    parameters: dataset.parameters,
    enums: { use: OSM_CLASS_NAMES, form: FORM_NAMES },
    worshipEnums: { religion: RELIGION_NAMES, tradition: TRADITION_NAMES, worshipSource: WORSHIP_SOURCE_NAMES },
    columns: COLUMNS,
    records: sidecar.length,
    fidFirst: sidecar[0].fid,
    data,
    checks
  };
}

/**
 * Writes the pin's buildings entry beside the trees and TTC ones (no paths): the manifest commit, its generated date,
 * a digest of the cells, the index's SHA-256, what the dataset is written into, and the output's SHA-256.
 */
export function writePin(pinFile, version, meta, bakedInto, dataSha256) {
  let old = null;
  try { old = readJson(pinFile); } catch { /* none yet */ }
  const entry = {
    manifestCommit: meta.manifestCommit,
    manifestGenerated: meta.manifestGenerated,
    cellsDigest: meta.cellsDigest,
    indexSha256: meta.indexSha256,
    bakedInto,
    dataSha256
  };
  const datasets = { ...(old?.datasets || {}), [version]: entry };
  const pin = {
    what: old?.what || 'The shared Toronto data repo datasets this city reads from (docs/lidar-trees.md, docs/transit-data.md). No paths: set TORONTO_DATA_CACHE to rebuild.',
    datasets
  };
  fs.mkdirSync(path.dirname(pinFile), { recursive: true });
  fs.writeFileSync(pinFile, `${JSON.stringify(pin, null, 2)}\n`);
  return pin;
}

/**
 * Writes the pin's neighbourhood-era/1 entry (st-ndw9.10), in the same shape as the buildings one: the manifest's
 * builder commit and generated date, the source geojson's SHA-256, the manifest's SHA-256, what it is written into and
 * the output's SHA-256.
 */
export function writeNeighbourhoodPin(pinFile, meta, nbDir, bakedInto, dataSha256) {
  const old = readJson(pinFile);
  let manifest = {};
  try { manifest = readJson(path.join(nbDir, 'manifest.json')); } catch { /* none */ }
  const entry = {
    manifestCommit: manifest.builder?.commit || null,
    manifestGenerated: manifest.generatedAt || null,
    indexSha256: meta?.sha256 || null,
    manifestSha256: sha256(fs.readFileSync(path.join(nbDir, 'manifest.json'))),
    features: meta?.features ?? null,
    bakedInto,
    dataSha256
  };
  const datasets = { ...(old.datasets || {}), 'neighbourhood-era/1': entry };
  const pin = { what: old.what, datasets };
  fs.writeFileSync(pinFile, `${JSON.stringify(pin, null, 2)}\n`);
  return pin;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  const { values: opt } = parseArgs({ options: {
    datasets: { type: 'string' },
    'neighbourhoods': { type: 'string' },
    out: { type: 'string', default: 'tools/data/building-inputs.json' },
    pin: { type: 'string', default: 'data/shared-toronto-data-pin.json' },
    quiet: { type: 'boolean', default: false }
  } });
  const pinFile = path.resolve(ROOT, opt.pin);
  let pin = {};
  try { pin = readJson(pinFile); } catch { /* none yet */ }
  const dir = opt.datasets || (process.env.TORONTO_DATA_CACHE ? path.join(process.env.TORONTO_DATA_CACHE, 'derived', datasetVersion(pin)) : null);
  const version = datasetVersion(pin);
  const nbDir = opt.neighbourhoods || (process.env.TORONTO_DATA_CACHE ? path.join(process.env.TORONTO_DATA_CACHE, 'derived', neighbourhoodVersion(pin)) : null);
  if (!dir || !fs.existsSync(path.join(dir, 'manifest.json'))) {
    console.error(`build-building-inputs: needs the shared Toronto data repo's ${version} dataset: set TORONTO_DATA_CACHE to its cache root (the folder holding derived/${version}) or pass --datasets <folder>. The app does not need it: tools/data/building-inputs.json is committed.`);
    process.exit(1);
  }
  if (!nbDir || !fs.existsSync(path.join(nbDir, 'neighbourhoods.geojson'))) {
    console.error(`build-building-inputs: needs the shared Toronto data repo's ${neighbourhoodVersion(pin)} neighbourhoods.geojson (derived/${neighbourhoodVersion(pin)}): set TORONTO_DATA_CACHE or pass --neighbourhoods <folder>.`);
    process.exit(1);
  }
  const neighbourhoods = readNeighbourhoods(nbDir);
  const out = await run({ dir, neighbourhoods });
  const file = path.resolve(ROOT, opt.out);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out) + '\n');
  const bytes = fs.statSync(file).size;
  const rel = path.relative(ROOT, file);
  const bakedInto = rel.startsWith('..') || path.isAbsolute(rel) ? path.basename(file) : rel;
  const dataSha256 = sha256(fs.readFileSync(file));
  writePin(pinFile, out.sources.dataset.dataset, out.sources.dataset, [bakedInto], dataSha256);
  writeNeighbourhoodPin(pinFile, out.sources.neighbourhoods, nbDir, [bakedInto], dataSha256);
  if (!opt.quiet) {
    const c = out.checks;
    console.log(`records ${out.records}; dataset ${out.sources.dataset.dataset} (${out.sources.dataset.cells} cells, ${c.datasetRowsRead} rows)`);
    console.log(`matched by (fid, k) ${c.matchedByFidK}, by the single-part fallback ${c.matchedByFidSinglePart}, unmatched ${c.unmatched}`);
    console.log(`house-scale records ${c.houseScaleRecords}, groups ${c.groups}, no maximum ${c.maxHeightZero}`);
    console.log(`neighbourhood records ${c.neighbourhoodRecords} (${c.neighbourhoodsUsed.length} neighbourhoods), without one ${c.recordsWithoutNeighbourhood}; dated records ${c.yearBuiltRecords}`);
    console.log(`worship records: religion ${c.religionRecords}, tradition ${c.traditionRecords}, source ${c.worshipSourceRecords}; on a school ground ${c.schoolGroundRecords}`);
    console.log(`wrote ${file} (${(bytes / 1024 / 1024).toFixed(2)} MB) and pinned ${out.sources.dataset.dataset} and neighbourhood-era/1 in ${pinFile}`);
  }
}
