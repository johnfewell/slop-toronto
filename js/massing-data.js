// js/massing-data.js — the City's 3D Massing polygons of every building in the detailed city
// (data/toronto-massing.bin, written by tools/build-massing.mjs; docs/massing-buildings.md), read back for buildings.js.
// Only ?massing=1 loads this module and its file (main.js), so the default page never fetches either.
//
// File: the TGB1 container of data/toronto-geodata.bin (tools/geo-pack.mjs, read by js/geodata-loader.js), holding one
// layer, MASSING, laid out in columns (one entry per record unless noted; every number lossless at its own decimals):
//   schema 2, source, edition, dataset ('to-3dmassing-2025'), geodata (the 16-digit hash of the js/toronto-geodata.js it
//   was built against), rows (GEO.buildings.length then), rowCheck (rowCheck() of those rows)
//   fid        the shapefile record number: the durable ID is `${dataset}:${fid}` (docs/geodata-ids.md), ascending
//   part       0 for a single-polygon record, k + 1 for polygon k of a multi-polygon one (ID `${dataset}:${fid}.${k}`)
//   row        its GEO.buildings row (the slim ID -> row index, valid only for the geodata named by rowCheck)
//   frameName, frameRows, frameRowCheck, frameRowDelta   the same for the bigger map's geodata (st-ndw9.21): its rows
//              are another list (140,541, in another order) that holds each of today's rows unchanged, so each record's
//              row there rides along (delta coded: the record before's, then the step), with the check of those rows.
//              The page uses whichever of the two lists the loaded geodata is, and nothing for any other
//   base       metres: the roof of a lower part it stands on (a tower on its podium), else 0
//   holes      its courtyards (rings after the outer)
//   corners    per ring, all records' rings back to back: its corner count
//   start      per ring: its first corner, x then z (m, on the decimetre grid)
//   step       per ring, back to back: each further corner from the one before, x then z, in grid steps (`grid` per m:
//              10, decimetres). Outer rings run counter-clockwise in (x, z), courtyards clockwise, so every edge's
//              right-hand normal (dz, -dx) points away from the mass.
//   partyN, partyEdge, partyCover   party walls: outer edges with a neighbour's mass against them, and how high
//   hiddenN, hiddenEdge             outer edges another part's wall stands on (no wall: it would flicker)
//   streetN, streetEdge             outer edges that look onto a street within 15 m of its kerb, as edge * 2 + 1 on a
//                                   main street (9 m or wider), else edge * 2 (buildings.js footprintEdges)
//   skipRow, skipWhy, reasons       the rows left on their boxes, and why (an index into reasons)
// Edge i of a ring runs from its corner i to corner i + 1.

import { unpackGeo } from './geodata-loader.js';

export const MASSING_URL = './data/toronto-massing.bin?v=708dd0273314'; // (tools/build-massing.mjs sets the hash)
export const MASSING_SCHEMA = 2;

/** FNV-1a over GEO.buildings' count and each row's centre and height (decimetres): the rows a sidecar was built for */
export function rowCheck(buildings) {
  let h = 0x811c9dc5;
  const mix = (v) => {
    for (let s = 0; s < 32; s += 8) { h ^= (v >>> s) & 255; h = Math.imul(h, 0x01000193); }
  };
  mix(buildings.length);
  for (const b of buildings) { mix(Math.round(b[0] * 10) | 0); mix(Math.round(b[1] * 10) | 0); mix(Math.round(b[4] * 10) | 0); }
  return h >>> 0;
}

export const massingId = (M, i) => `${M.dataset}:${M.fid[i]}${M.part[i] ? '.' + (M.part[i] - 1) : ''}`;

/**
 * The MASSING layer and the loaded GEO -> { rows: Map(GEO.buildings row -> { id, index, base, rings: [outer, ...holes] as
 * [[x, z], ...], covered: Map(edge -> covered to, m), hidden: Set(edge), street: Map(edge -> on a main street) }),
 * records, rejected, error }. `index` is the record's position in the sidecar's own record order (what the building
 * presets are indexed by, js/building-presets.js). Nothing is used (error set) unless the sidecar was built for exactly
 * these rows; a record whose row's centre lies away from its outline is rejected on its own (it keeps its boxes).
 */
export function massingRows(M, GEO) {
  const rows = new Map();
  const out = { rows, records: 0, rejected: 0, error: null };
  if (!M || M.schema !== MASSING_SCHEMA) { out.error = `schema ${M && M.schema}, not ${MASSING_SCHEMA}`; return out; }
  const B = GEO.buildings;
  const check = rowCheck(B);
  // (today's rows, or the bigger map's: the records are the same either way, only each one's row differs)
  const rowOf = M.rows === B.length && M.rowCheck === check ? (i) => M.row[i]
    : M.frameRows === B.length && M.frameRowCheck === check && M.frameRowDelta && M.frameRowDelta.length === M.fid.length ? (() => { let r = 0; return (i) => (r += M.frameRowDelta[i]); })()
    : null;
  if (!rowOf) {
    out.error = `built for other geodata (${M.geodata}): its ${M.rows} rows${M.frameRows ? ` (or ${M.frameRows}, the ${M.frameName} map's)` : ''} are not these ${B.length}`;
    return out;
  }
  out.frame = M.rows === B.length && M.rowCheck === check ? 'detail' : M.frameName;
  out.builtRowCheck = M.rowCheck; // (what the presets files are checked against: they are keyed by this sidecar's records)
  const n = M.fid.length;
  out.records = n;
  const g = M.grid;
  let ring = 0, st = 0, pe = 0, he = 0, se = 0;
  for (let i = 0; i < n; i++) {
    const rings = [];
    for (let r = 0; r <= M.holes[i]; r++, ring++) {
      const pts = new Array(M.corners[ring]);
      // (integer grid steps, so every corner is exactly the value the build snapped it to)
      let X = Math.round(M.start[ring * 2] * g), Z = Math.round(M.start[ring * 2 + 1] * g);
      pts[0] = [X / g, Z / g];
      for (let k = 1; k < pts.length; k++, st += 2) { X += M.step[st]; Z += M.step[st + 1]; pts[k] = [X / g, Z / g]; }
      rings.push(pts);
    }
    const covered = new Map(), hidden = new Set(), street = new Map();
    for (let k = 0; k < M.partyN[i]; k++, pe++) covered.set(M.partyEdge[pe], M.partyCover[pe]);
    for (let k = 0; k < M.hiddenN[i]; k++, he++) hidden.add(M.hiddenEdge[he]);
    for (let k = 0; k < M.streetN[i]; k++, se++) street.set(M.streetEdge[se] >> 1, (M.streetEdge[se] & 1) === 1);
    const row = rowOf(i), b = B[row], outer = rings[0];
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of outer) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    // (the row's box centre stands within its own outline's bounds, give or take the box fit)
    if (!b || outer.length < 3 || !(b[0] >= x0 - 2 && b[0] <= x1 + 2 && b[1] >= z0 - 2 && b[1] <= z1 + 2)) { out.rejected++; continue; }
    rows.set(row, { id: massingId(M, i), index: i, base: M.base[i], rings, covered, hidden, street });
  }
  return out;
}

/**
 * fetch(url), or the request main.js started at the top of the page's build for the same file (window.CITY.EARLY_FETCH: the
 * default page asks for the sidecar and the presets files before it builds anything, so their download is done by the time
 * the buildings are made); each early request is taken once.
 */
export function fetchData(url) {
  const early = typeof window !== 'undefined' && window.CITY && window.CITY.EARLY_FETCH;
  const p = early && early.get(url);
  if (p) { early.delete(url); return p; }
  return fetch(url);
}

/**
 * Fetches and reads the sidecar for the loaded GEO: massingRows' result, plus bytes (as fetched), decodeMs (inflate +
 * decode) and expandMs (to rows). Leaves a 'massing-decode' performance measure.
 */
export async function loadMassing(GEO, url = MASSING_URL) {
  const res = await fetchData(url);
  if (!res.ok) throw new Error(`massing: ${res.url}: HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();
  const t0 = performance.now();
  const { MASSING } = await unpackGeo(buffer);
  const t1 = performance.now();
  const out = massingRows(MASSING, GEO);
  const t2 = performance.now();
  performance.measure('massing-decode', { start: t0, end: t2, detail: { bytes: buffer.byteLength } });
  return Object.assign(out, { bytes: buffer.byteLength, decodeMs: t1 - t0, expandMs: t2 - t1, meta: { edition: MASSING.edition, geodata: MASSING.geodata } });
}
