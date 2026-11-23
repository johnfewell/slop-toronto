// js/building-presets.js — reads data/toronto-building-presets.bin (written by tools/build-building-presets.mjs,
// docs/building-presets.md) and attaches each loaded polygon record its preset. Only ?massing=1&presets=1 or
// ?massing=1&presets=debug loads this module and its file (js/main.js), so ?massing=1 alone never fetches either.
//
// File: the TGB1 container of data/toronto-geodata.bin (tools/geo-pack.mjs, read by js/geodata-loader.js), one layer,
// PRESETS: { schema, records (the sidecar's record count), rowCheck (js/massing-data.js rowCheck of the GEO rows the
// file was built for), edition (the massing edition), ids (the preset ids, once), preset (one index into `ids` per
// sidecar record, in sidecar order) }. The page checks `records` and `rowCheck` against the loaded sidecar and the
// GEO: a file built for another sidecar is refused whole (the caller warns and carries on without presets).

import { unpackGeo } from './geodata-loader.js';
import { rowCheck, fetchData } from './massing-data.js';

export const PRESETS_URL = './data/toronto-building-presets.bin?v=427a531071be'; // (tools/build-building-presets.mjs sets the hash)
export const PRESETS_SCHEMA = 1;

/**
 * The rowCheck the presets files must carry: that of the rows the sidecar's records were built for (`builtRowCheck`: the
 * records are the same on today's map and on the bigger one, whose rows massingRows maps them onto, st-ndw9.21), else the
 * loaded GEO's own.
 */
export const builtFor = (MASSING, GEO) => (MASSING && MASSING.builtRowCheck != null ? MASSING.builtRowCheck : rowCheck(GEO.buildings));

/**
 * Fetches the presets file and attaches each loaded massing record its preset (`rec.preset`, a preset id). Returns
 * { ids, preset, attached, bytes, error }. A schema, sidecar or geodata mismatch sets `error` and attaches nothing.
 */
export async function loadBuildingPresets(MASSING, GEO, url = PRESETS_URL) {
  const res = await fetchData(url);
  if (!res.ok) throw new Error(`presets: ${res.url}: HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();
  const { PRESETS } = await unpackGeo(buffer);
  const out = { ids: PRESETS.ids, preset: PRESETS.preset, attached: 0, bytes: buffer.byteLength, error: null };
  if (PRESETS.schema !== PRESETS_SCHEMA) { out.error = `schema ${PRESETS.schema}, not ${PRESETS_SCHEMA}`; return out; }
  if (!MASSING || !(MASSING.rows instanceof Map) || MASSING.error) { out.error = 'no usable massing sidecar is loaded'; return out; }
  if (PRESETS.records !== MASSING.records || PRESETS.rowCheck !== builtFor(MASSING, GEO)) {
    out.error = `built for another sidecar (${PRESETS.records} records, rowCheck ${PRESETS.rowCheck}; these are ${MASSING.records} records, rowCheck ${builtFor(MASSING, GEO)})`;
    return out;
  }
  for (const rec of MASSING.rows.values()) {
    const p = PRESETS.preset[rec.index];
    if (p != null && p >= 0 && p < PRESETS.ids.length) { rec.preset = PRESETS.ids[p]; out.attached++; }
  }
  return out;
}

// ---- the facts the drawing needs (st-ndw9.13): each record's joined group and dwelling count -------------------------
// ?massing=1&presets=draw and ?gallery=presets draw the house presets from these: a semi's two halves, or the houses of a
// row, share their group (one brick, one roof, one cornice) and the shared dataset's dwelling count says how many
// bays or gables the frontage splits into. They live in the debug file the identify panel already reads
// (the identify panel's second data file, per record its group; per group its dwellings and smallest durable id), so
// no file is added; only those two flags fetch it for this.


// the smallest-area oriented rectangle round a ring: its long side and its aspect (long over short), for the group facts
function orientedBox(ring) {
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    if (l < 0.5) continue;
    const tx = dx / l, tz = dz / l;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of ring) { const u = (p[0] - a[0]) * tx + (p[1] - a[1]) * tz, v = -(p[0] - a[0]) * tz + (p[1] - a[1]) * tx; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
    const A = (u1 - u0) * (v1 - v0);
    if (!best || A < best.A) best = { A, w: u1 - u0, d: v1 - v0 };
  }
  if (!best) return { asp: 1, long: 0 };
  const long = Math.max(best.w, best.d), short = Math.min(best.w, best.d);
  return { asp: long / Math.max(short, 0.5), long };
}

/**
 * The unpacked debug file's groups -> { facts: Map(sidecar record index -> { groupId, dwellings }), counts: { preset id:
 * buildings }, error }. A record's dwellings are its group's, shared out by footprint area (at least one each). A
 * mismatch with the sidecar sets `error` and returns no facts (the caller keeps today's look).
 */
export function drawFactsFrom(DEBUG, MASSING, GEO, presets) {
  const out = { facts: new Map(), counts: {}, error: null };
  // (the debug file's schema: 2 since st-ndw9.16 added the worship columns; the groups and dwellings are unchanged)
  if (!DEBUG || DEBUG.schema !== 2) { out.error = `debug file schema ${DEBUG && DEBUG.schema}`; return out; }
  if (!MASSING || MASSING.error || !(MASSING.rows instanceof Map)) { out.error = 'no usable massing sidecar is loaded'; return out; }
  if (DEBUG.records !== MASSING.records || DEBUG.rowCheck !== builtFor(MASSING, GEO)) { out.error = 'built for another sidecar'; return out; }
  const ringArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return Math.abs(a / 2); };
  const area = new Float64Array(DEBUG.groups), recs = [];
  for (const rec of MASSING.rows.values()) {
    const g = DEBUG.groupOfRecord[rec.index], a = ringArea(rec.rings[0]);
    area[g] += a; recs.push([rec.index, g, a]);
  }
  // (st-ndw9.20) the group facts the apartments, towers and places of worship are drawn from: the parts' count, total footprint and tallest
  // height, whether a part stands on a lower one (a podium), the largest part's plan proportions (a slab is long and thin), the
  // religion, the tradition and the name, and for a place of worship its parts' sizes (which one is the nave, which the tower)
  const G = new Map();
  for (const [bi, rec] of MASSING.rows) {
    const g = DEBUG.groupOfRecord[rec.index], a = ringArea(rec.rings[0]), h = GEO.buildings[bi] ? GEO.buildings[bi][4] : 0;
    let o = G.get(g);
    if (!o) G.set(g, o = { n: 0, area: 0, maxH: 0, podium: false, main: null, recs: [] });
    o.n++; o.area += a; o.maxH = Math.max(o.maxH, h); if (rec.base > 0) o.podium = true;
    const ob = orientedBox(rec.rings[0]);
    o.recs.push({ index: rec.index, area: a, h, asp: ob.asp, long: ob.long });
    if (!o.main || a > o.main.area) o.main = { area: a, asp: ob.asp, long: ob.long };
  }
  for (const o of G.values()) { o.mainAspect = o.main.asp; o.mainLong = o.main.long; }
  const names = (arr, i) => (i != null && i >= 0 ? arr && arr[i] : undefined);
  for (const [index, g, a] of recs) {
    const dwellings = Math.max(1, Math.round(DEBUG.dwellings[g] * a / (area[g] || 1)));
    const o = G.get(g);
    const group = o && { n: o.n, area: o.area, maxH: o.maxH, podium: o.podium, mainAspect: o.mainAspect, mainLong: o.mainLong,
      religion: names(DEBUG.religionNames, DEBUG.religion && DEBUG.religion[g]), tradition: names(DEBUG.traditionNames, DEBUG.tradition && DEBUG.tradition[g]), name: DEBUG.names && DEBUG.names[g], recs: o.recs };
    out.facts.set(index, { groupId: `${DEBUG.fid[g]}.${DEBUG.k[g]}`, dwellings, group });
  }
  const groupPreset = new Array(DEBUG.groups);
  for (let i = 0; i < DEBUG.groupOfRecord.length; i++) groupPreset[DEBUG.groupOfRecord[i]] = presets.preset[i];
  for (const p of groupPreset) { const id = presets.ids[p]; out.counts[id] = (out.counts[id] || 0) + 1; }
  return out;
}

/** Fetches the debug file and reads it with drawFactsFrom: { facts, counts, bytes, error }. */
export async function loadBuildingDrawFacts(MASSING, GEO, presets, url) {
  const res = await fetchData(url);
  if (!res.ok) throw new Error(`presets: ${res.url}: HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();
  const { DEBUG } = await unpackGeo(buffer);
  return Object.assign(drawFactsFrom(DEBUG, MASSING, GEO, presets), { bytes: buffer.byteLength });
}
