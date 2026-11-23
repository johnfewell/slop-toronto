// tools/report-building-classes.mjs — st-ndw9.1 (Phase 0a of docs/building-prototypes-spec.md): measure every
// footprint the ?massing=1 city draws and count them by class, so the ~30 prototypes are drawn from data.
// Reads the committed data only (no new dependencies): js/toronto-geodata.js for each row's height, kind and roof, and
// data/toronto-massing.bin for the City's 3D Massing rings and their party / street / base fields, loaded the way
// tools/report-massing.mjs loads them. It changes nothing the page loads. It writes tools/building-classes.json and,
// with --md, docs/building-classes.md. (The brief names tools/shots/, but that folder holds capture fixtures and
// tests/capture-shots.test.mjs reads every file there as a shot list, so the census file lives beside its script.)
//
// usage: node tools/report-building-classes.mjs [--json <path>] [--md <path>] [--examples N] [--quiet]
//
// =====================================================================================================================
// THE CLASS TABLE — edit here; the rules are read from nothing else
// =====================================================================================================================
// A record is one City 3D Massing part, not one building: a tower and its podium are separate records, and a terrace
// may be several. So the counts are given for records (this file, the "record" style) and, for the prototype, for
// the joined GROUPS (the party-wall graph's connected components: the buildings chained through party walls).
//
// ATTACHMENT (record), from party walls (outer edges with a neighbour's mass against them, data/toronto-massing.bin
// partyEdge). An edge's outward normal is (dz, -dx) / len (the rings wind counter-clockwise in (x, z), so the
// right-hand normal points away from the mass). Steps (SIDE_* below):
//   1. take party edges PARTY_EDGE_MIN_M (1.5 m) or longer (a sliver under a metre is noise on the decimetre grid);
//   2. cluster them into sides by outward normal: walk the ring's party edges in order and add each to the side whose
//      previous edge its own normal is within SIDE_SAME_DOT (0.8, under about 37 degrees) of; a side's normal is its
//      edges' length-weighted mean;
//   3. keep sides whose edges total SIDE_MIN_M (3 m) or more (a side is a whole wall, not a nub);
//   4. classify by the kept sides:
//        none    no kept side
//        one     exactly one kept side
//        both    two or more kept sides, some pair opposite (dot under SIDE_OPPOSITE_DOT, -0.7): a middle-of-row unit
//                or a tower record pressed between neighbours
//        corner  two or more kept sides, none opposite (neighbours on different sides, e.g. two streets)
// ATTACHMENT_GROUP (record, from the joined group). The sidecar does not store which building is behind a party edge;
//   resolveParties finds it geometrically (the build's own probes, tools/build-massing.mjs PARTY_PROBE), unions the
//   edges into groups, and then:
//        none -> detached; one in a group of exactly 2 -> pair; other one -> rowEnd; both -> rowMiddle;
//        corner -> corner
//   A semi's shared wall is one whole side of each half, so "one side" + a group of two is what a pair means here.
//
// HEIGHT BAND, from storeys = height / FLOOR_M (3.4 m, the houses' storey, js/buildings.js FLOOR_HEIGHTS[0]):
//   h1 under 1.5   h2 1.5 to 2   h3 2.5 to 3   h4 3 to 5   h5 5 to 13   h6 13 or more storeys
//   (h3 is a one-and-a-half storey house at its ridge, or a storey over a shop. The bands are inclusive at the bottom.)
//
// MAIN STREET: any street-facing edge flagged as on a main street (9 m or wider: the sidecar's street edge low bit).
// KIND: the row's GEO.buildings kind (0 house, 1 low-rise, 2 mid-rise, 3 tower, 4 shed, 5 works, 6 worship, 7 civic).
// OUTBUILDING: no street edge, area <= OUTBUILDING.maxArea and height < OUTBUILDING.maxHeight. The thresholds come
//   from the area and height histograms and the run reports the count at each threshold +/- 20%.
// =====================================================================================================================

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { unpackGeo } from '../js/geodata-loader.js';
import { massingRows } from '../js/massing-data.js';
import { renderMarkdown } from './building-classes-doc.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELF = fileURLToPath(import.meta.url);

export const FLOOR_M = 3.4; // (js/buildings.js FLOOR_HEIGHTS[0], the houses' storey)
export const PARTY_EDGE_MIN_M = 1.5; // ignore party edges shorter than this
export const SIDE_SAME_DOT = 0.8; // two party edges are one side when cos(angle) between their normals is over this
export const SIDE_MIN_M = 3; // keep a side only if its edges total this
export const SIDE_OPPOSITE_DOT = -0.7; // two sides are opposite when cos(angle) between their normals is under this
export const PARTY_PROBE = 0.35; // m outward (tools/build-massing.mjs PARTY_PROBE)
export const NEIGHBOUR_GAP_M = 3; // m: a record with party edges but no neighbour, and the nearest record whose outer ring
                                  // lies this close, is chained to it (a wall shared with a record that draws no wall:
                                  // a tower on its podium, or two halves the lidar merged into one outline through a
                                  // sliver no probe reaches). This widens the joined groups, not the party sides.
export const OUTBUILDING = { maxArea: 60, maxHeight: 5 };
export const EXAMPLES = 10;

export const CLASS_FIELDS = ['attachment', 'heightBand', 'mainStreet', 'kind', 'outbuilding'];
export const ATTACHMENT_SIDES = ['none', 'one', 'both', 'corner'];
export const ATTACHMENT_GROUP = ['detached', 'pair', 'rowEnd', 'rowMiddle', 'corner'];
export const HEIGHT_BANDS = [
  { id: 'h1', min: -Infinity, max: 1.5 },
  { id: 'h2', min: 1.5, max: 2.5 },
  { id: 'h3', min: 2.5, max: 3 },
  { id: 'h4', min: 3, max: 5 },
  { id: 'h5', min: 5, max: 13 },
  { id: 'h6', min: 13, max: Infinity }
];
export const KIND_NAMES = ['house', 'low-rise', 'mid-rise', 'tower', 'shed', 'works', 'worship', 'civic'];
const STOREYS = (h) => h / FLOOR_M;
const bandOf = (storeys) => HEIGHT_BANDS.find((b) => storeys >= b.min && storeys < b.max);

// ---------------------------------------------------------------------------------------------------------------------
// Geometry (pure)
// ---------------------------------------------------------------------------------------------------------------------
export function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a) / 2;
}
export function perimeter(ring) {
  let p = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) p += Math.hypot(ring[i][0] - ring[j][0], ring[i][1] - ring[j][1]);
  return p;
}
/** The minimum-area rectangle around a ring (rotating calipers over its edges): { w (long), d (short), ux, uz }. */
export function orientedRect(ring) {
  let best = null;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const dx = ring[i][0] - ring[j][0], dz = ring[i][1] - ring[j][1], len = Math.hypot(dx, dz);
    if (len < 1e-9) continue;
    const ux = dx / len, uz = dz / len, vx = uz, vz = -ux;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of ring) {
      const u = x * ux + z * uz, v = x * vx + z * vz;
      if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const a = (u1 - u0) * (v1 - v0);
    if (!best || a < best.area) best = { area: a, w: u1 - u0, d: v1 - v0, ux, uz };
  }
  return best || { area: 0, w: 0, d: 0, ux: 1, uz: 0 };
}
/** Is (x, z) inside a ring (even-odd)? */
export function inRing(x, z, ring) {
  let yes = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) yes = !yes;
  }
  return yes;
}

// ---------------------------------------------------------------------------------------------------------------------
// Party walls
// ---------------------------------------------------------------------------------------------------------------------
/**
 * A record's party walls as kept sides (ATTACHMENT above). Returns { partyEdges, partyLen, allSides, sides }, where
 * `sides` holds the kept sides ({ nx, nz, edges, len }) and `allSides` the sides before the SIDE_MIN_M cut.
 *   1. party edges PARTY_EDGE_MIN_M or longer;
 *   2. single-link clustering by normal: two edges are one side where their normals' dot is over SIDE_SAME_DOT (a
 *      transitive closure, so a slightly curved wall whose ends differ by more than the threshold is still one side);
 *   3. a side's normal is its edges' length-weighted mean; keep the sides whose edges total SIDE_MIN_M or more.
 */
export function partySides(outer, covered) {
  const n = outer.length;
  const edges = [];
  for (const e of [...covered.keys()].sort((a, b) => a - b)) {
    const [ax, az] = outer[e], [bx, bz] = outer[(e + 1) % n];
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    if (len < PARTY_EDGE_MIN_M) continue;
    edges.push({ e, len, nx: dz / len, nz: -dx / len });
  }
  // (clustering as the coordinator's direct count: walk the edges in ring order and add each to the side whose last
  //  edge its normal is within SIDE_SAME_DOT of; the side's normal is its edges' length-weighted mean, reported)
  const groupList = [];
  for (const x of edges) {
    let side = groupList.find((s) => s.last ? s.last.nx * x.nx + s.last.nz * x.nz > SIDE_SAME_DOT : false);
    if (!side) groupList.push((side = { nx: 0, nz: 0, len: 0, last: null, list: [] }));
    side.nx += x.nx * x.len; side.nz += x.nz * x.len; side.len += x.len; side.last = x; side.list.push(x);
  }
  const allSides = [];
  for (const g of groupList) {
    const l = Math.hypot(g.nx, g.nz) || 1;
    allSides.push({ nx: g.nx / l, nz: g.nz / l, len: g.len, edges: g.list.map((x) => x.e) });
  }
  const sides = allSides.filter((x) => x.len >= SIDE_MIN_M);
  return { partyEdges: covered.size, partyLen: sides.reduce((s, x) => s + x.len, 0), allSides, sides };
}

/** The side style: none, one, both (some kept pair of sides opposite) or corner (two or more, none opposite). */
export function sideStyle(party) {
  const sides = party.sides;
  if (sides.length === 0) return 'none';
  if (sides.length === 1) return 'one';
  for (let i = 0; i < sides.length; i++) for (let j = i + 1; j < sides.length; j++) {
    if (sides[i].nx * sides[j].nx + sides[i].nz * sides[j].nz < SIDE_OPPOSITE_DOT) return 'both';
  }
  return 'corner';
}

/**
 * The group style from the side style and the joined group: none -> detached; one in a group of exactly 2 -> pair;
 * another one -> rowEnd; both -> rowMiddle; corner -> corner.
 */
export function groupStyle(attachment, group) {
  if (attachment === 'none') return 'detached';
  if (attachment === 'corner') return 'corner';
  if (attachment === 'both') return 'rowMiddle';
  return group && group.size === 2 ? 'pair' : 'rowEnd';
}

/**
 * Finds the neighbour behind every party edge, then the joined groups (the party-wall graph's connected components).
 * Builds a 25 m bucket grid of every record's outer ring; for each party edge, takes the same probes as the build
 * (0.15, 0.5, 0.85 along, PARTY_PROBE outward) and picks the candidate holding all three probes, else the most.
 * Appends each record's { neighbourIds, group: { size } } and returns { edgesResolved, edgesUnresolved }.
 */
export function resolveParties(recs, records) {
  const CELL = 25;
  const grid = new Map();
  const key = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  for (const r of recs) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of r.outer) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
      const k = key(i * CELL, j * CELL); let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(r);
    }
  }
  const holds = (o, x, z) => inRing(x, z, o.outer);
  let resolved = 0, unresolved = 0;
  const edges = []; // [record, neighbour or null]
  for (const r of recs) {
    const n = r.outer.length;
    const found = new Map();
    for (const e of [...r.covered.keys()].sort((a, b) => a - b)) {
      const [ax, az] = r.outer[e], [bx, bz] = r.outer[(e + 1) % n];
      const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
      const nx = dz / l, nz = -dx / l;
      const px = [0.15, 0.5, 0.85].map((t) => [ax + dx * t + nx * PARTY_PROBE, az + dz * t + nz * PARTY_PROBE]);
      const cand = new Set();
      for (const [x, z] of px) for (const o of grid.get(key(x, z)) || []) if (o !== r) cand.add(o);
      let best = null, bestHits = 0;
      for (const o of cand) {
        const hits = px.filter(([x, z]) => holds(o, x, z)).length;
        if (hits > bestHits) { bestHits = hits; best = o; }
        if (hits === 3) break;
      }
      if (best) { found.set(e, best); resolved++; } else unresolved++;
      edges.push([r, best]);
    }
    r.neighbours = found;
  }
  // union-find over the records
  const idx = new Map(recs.map((r, i) => [r, i]));
  const parent = recs.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (const [r, o] of edges) if (o) { const a = find(idx.get(r)), b = find(idx.get(o)); if (a !== b) parent[b] = a; }
  // a record with party edges but no neighbour resolved, near another record's wall: chained to it for the group size
  const nearest = (r) => {
    let best = null, bestD = NEIGHBOUR_GAP_M;
    const n = r.outer.length;
    for (const [x, z] of r.outer) for (const o of grid.get(key(x, z)) || []) {
      if (o === r) continue;
      const m = o.outer.length;
      for (let i = 0; i < m; i++) {
        const [ax, az] = o.outer[i], [bx, bz] = o.outer[(i + 1) % m];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
        let t = ((x - ax) * dx + (z - az) * dz) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
        if (d < bestD) { bestD = d; best = o; }
      }
    }
    return best;
  };
  for (const r of recs) {
    if (!r.covered.size || r.neighbours.size) continue;
    const o = nearest(r);
    if (o) { const a = find(idx.get(r)), b = find(idx.get(o)); if (a !== b) parent[b] = a; }
  }
  const size = new Map();
  for (let i = 0; i < recs.length; i++) { const k = find(i); size.set(k, (size.get(k) || 0) + 1); }
  for (let i = 0; i < recs.length; i++) recs[i].group = { root: find(i), size: size.get(find(i)) };
  return { edgesResolved: resolved, edgesUnresolved: unresolved };
}

// ---------------------------------------------------------------------------------------------------------------------
// Seeded examples (mulberry32: the same seed gives the same examples on every run)
// ---------------------------------------------------------------------------------------------------------------------
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function pick(list, n, seed) {
  if (list.length <= n) return list.slice();
  const a = list.slice(), r = rng(seed);
  for (let i = 0; i < n; i++) { const j = i + Math.floor(r() * (a.length - i)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}
const hashStr = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };

// ---------------------------------------------------------------------------------------------------------------------
// The run: reads the committed data, classifies every record, returns the report object (no file writes here)
// ---------------------------------------------------------------------------------------------------------------------
export async function run({ examples = EXAMPLES } = {}) {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/toronto-geodata.js'), 'utf8'), ctx);
  // latLonFromWorld: the inverse of the frame projection, js/city-config.js (the same convention as tools/geo-base.mjs
  // `toLonLat`; the page's own copy is the one this uses)
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/city-config.js'), 'utf8'), ctx);
  const { GEO, latLonFromWorld } = ctx.window.CITY;
  const { MASSING: M } = await unpackGeo(fs.readFileSync(path.join(ROOT, 'data/toronto-massing.bin')));
  const loaded = massingRows(M, GEO);
  if (loaded.error) throw new Error(loaded.error);

  // (the projection check the brief asks for: the frame origin is lat0, lon0)
  const origin = latLonFromWorld(0, 0);
  const projection = {
    from: 'js/city-config.js latLonFromWorld (inverse of worldFromLatLon; the same as tools/geo-base.mjs toLonLat)',
    origin: { x: 0, z: 0, lat: +origin.lat.toFixed(6), lon: +origin.lon.toFixed(6) },
    // (the frame's lat0, lon0 are stored to 4 decimals: compare at that precision, and also report the raw offsets)
    // (the frame's origin, GEO.frame.lat / .lon and the projection's lat0, lon0: the inverse must give them back)
    frame: { lat: GEO.frame.lat, lon: GEO.frame.lon, lat0: GEO.frame.projection.lat0, lon0: GEO.frame.projection.lon0 },
    ok: Math.abs(origin.lat - GEO.frame.projection.lat0) < 1e-6 && Math.abs(origin.lon - GEO.frame.projection.lon0) < 1e-6,
    offsets: { lat: +(origin.lat - GEO.frame.projection.lat0).toExponential(2), lon: +(origin.lon - GEO.frame.projection.lon0).toExponential(2) }
  };
  const at = (r) => { const p = latLonFromWorld(r.cx, r.cz); return { lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6) }; };

  const recs = [];
  for (const [row, r] of loaded.rows) recs.push({ row, id: r.id, base: r.base, rings: r.rings, outer: r.rings[0], covered: r.covered, street: r.street });
  recs.sort((a, b) => a.row - b.row);

  for (const r of recs) {
    const b = GEO.buildings[r.row];
    r.cx = b[0]; r.cz = b[1]; r.h = b[4]; r.kind = b[5]; r.roof = b[6];
    r.area = r.rings.reduce((s, ring, i) => s + (i === 0 ? ringArea(ring) : -ringArea(ring)), 0);
    r.perim = perimeter(r.outer);
    r.rect = orientedRect(r.outer);
    r.shorter = Math.min(r.rect.w, r.rect.d);
    r.storeys = STOREYS(r.h);
    r.heightBand = bandOf(r.storeys).id;
    r.party = partySides(r.outer, r.covered);
    r.attachment = sideStyle(r.party);
    let frontage = 0, streets = 0, main = false;
    for (const [e, isMain] of r.street) {
      const n = r.outer.length;
      frontage += Math.hypot(r.outer[(e + 1) % n][0] - r.outer[e][0], r.outer[(e + 1) % n][1] - r.outer[e][1]);
      streets++; if (isMain) main = true;
    }
    r.streets = streets; r.frontage = frontage; r.mainStreet = main;
    r.podium = r.base > 0;
    r.courtyard = r.rings.length > 1;
    r.outbuilding = streets === 0 && r.area <= OUTBUILDING.maxArea && r.h < OUTBUILDING.maxHeight;
  }
  const parties = resolveParties(recs, GEO.buildings);
  for (const r of recs) {
    r.groupStyle = groupStyle(r.attachment, r.group);
    r.neighbourIds = r.neighbours.size ? [...new Set([...r.neighbours.values()].map((o) => o.id))].sort() : [];
    r.classId = [r.attachment, r.heightBand, r.mainStreet ? 'main' : 'side', KIND_NAMES[r.kind] || String(r.kind), r.outbuilding ? 'out' : 'in'].join('/');
    r.groupClassId = [r.groupStyle, r.heightBand, r.mainStreet ? 'main' : 'side', KIND_NAMES[r.kind] || String(r.kind), r.outbuilding ? 'out' : 'in'].join('/');
  }

  const totalArea = recs.reduce((s, r) => s + r.area, 0);
  const ex = (r) => ({ id: r.id, row: r.row, x: r.cx, z: r.cz, ...at(r), height: r.h, area: +r.area.toFixed(1) });
  // classes over a key: record classes (attachment) and group classes (groupStyle)
  const classTable = (keyOf, fieldName, allKeys) => {
    const map = new Map();
    for (const r of recs) {
      const id = r[keyOf];
      let g = map.get(id);
      if (!g) map.set(id, (g = { id, records: [] }));
      g.records.push(r);
    }
    return [...map.values()].map((g) => {
      const area = g.records.reduce((s, r) => s + r.area, 0);
      const first = g.records[0];
      return {
        id: g.id, [fieldName]: g.id, heightBand: first.heightBand, mainStreet: first.mainStreet,
        kind: first.kindName, outbuilding: first.outbuilding,
        count: g.records.length,
        share: +(g.records.length / recs.length).toFixed(6),
        areaShare: +(area / totalArea).toFixed(6),
        areaM2: Math.round(area),
        examples: pick(g.records, examples, 0x5eed ^ hashStr(g.id)).map(ex)
      };
    }).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  };
  for (const r of recs) r.kindName = KIND_NAMES[r.kind] || String(r.kind);
  const classes = classTable('classId', 'attachment', ATTACHMENT_SIDES);

  const q = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : null; };
  const round = (v, d = 1) => (v == null ? null : +v.toFixed(d));
  const qset = (list) => ({
    n: list.length,
    area: { p10: round(q(list.map((r) => r.area), 0.1)), median: round(q(list.map((r) => r.area), 0.5)), p90: round(q(list.map((r) => r.area), 0.9)) },
    height: { p10: round(q(list.map((r) => r.h), 0.1)), median: round(q(list.map((r) => r.h), 0.5)), p90: round(q(list.map((r) => r.h), 0.9)) },
    shorter: { p10: round(q(list.map((r) => r.shorter), 0.1)), median: round(q(list.map((r) => r.shorter), 0.5)), p90: round(q(list.map((r) => r.shorter), 0.9)) },
    frontage: { p10: round(q(list.map((r) => r.frontage), 0.1)), median: round(q(list.map((r) => r.frontage), 0.5)), p90: round(q(list.map((r) => r.frontage), 0.9)) }
  });
  const cross = (list, rows, cols, keyOf) => {
    const out = {};
    for (const a of rows) { out[a] = {}; for (const b of cols) out[a][b] = 0; }
    for (const r of list) { const [a, b] = keyOf(r); out[a][b]++; }
    return out;
  };
  const bins = (list, get, edges) => { const counts = new Array(edges.length + 1).fill(0); for (const r of list) { let k = edges.findIndex((e) => get(r) < e); if (k < 0) k = edges.length; counts[k]++; } return { edges, counts }; };

  // ---- joined groups: one entry per party-wall connected component --------------------------------
  const byRoot = new Map();
  for (const r of recs) {
    const key = r.group.root;
    let g = byRoot.get(key);
    if (!g) byRoot.set(key, (g = { records: [] }));
    g.records.push(r);
  }
  const groupList = [];
  for (const [root, g] of byRoot) {
    const tallest = g.records.reduce((a, b) => (b.h > a.h ? b : a));
    groupList.push({
      root, records: g.records, size: g.records.length, tallest,
      kind: KIND_NAMES[tallest.kind] || String(tallest.kind), // (the group's kind: its tallest record's)
      areaM2: Math.round(g.records.reduce((s, r) => s + r.area, 0))
    });
  }
  // group classes: one class per group, its style/height band/main street/outbuilding from the group's tallest record
  for (const g of groupList) {
    const t = g.tallest;
    g.classId = [t.groupStyle, t.heightBand, t.mainStreet ? 'main' : 'side', g.kind, t.outbuilding ? 'out' : 'in'].join('/');
  }
  const gmap = new Map();
  for (const g of groupList) {
    let c = gmap.get(g.classId);
    if (!c) gmap.set(g.classId, (c = { id: g.classId, groupStyle: g.tallest.groupStyle, heightBand: g.tallest.heightBand, mainStreet: g.tallest.mainStreet, kind: g.kind, outbuilding: g.tallest.outbuilding, groups: [], records: 0, areaM2: 0 }));
    c.groups.push(g); c.records += g.size; c.areaM2 += g.areaM2;
  }
  const totalGroupArea = groupList.reduce((s, g) => s + g.areaM2, 0);
  const groupClasses = [...gmap.values()].map((c) => ({
    id: c.id, groupStyle: c.groupStyle, heightBand: c.heightBand, mainStreet: c.mainStreet, kind: c.kind, outbuilding: c.outbuilding,
    groups: c.groups.length, count: c.records, areaM2: c.areaM2,
    share: +(c.groups.length / groupList.length).toFixed(6),
    recordShare: +(c.records / recs.length).toFixed(6),
    areaShare: +(c.areaM2 / totalGroupArea).toFixed(6),
    examples: pick(c.groups.slice().sort((a, b) => a.root - b.root), examples, 0x9e37 ^ hashStr(c.id)).map((g) => ({ group: g.size, tallest: ex(g.tallest) }))
  })).sort((a, b) => b.groups - a.groups || a.id.localeCompare(b.id));
  const groupsCity = {
    groups: groupList.length,
    sizeDistribution: Object.fromEntries([...new Set(groupList.map((g) => g.size))].sort((a, b) => a - b).map((s) => [s, groupList.filter((g) => g.size === s).length])),
    largest: Math.max(...groupList.map((g) => g.size)),
    byKind: Object.fromEntries(KIND_NAMES.map((k) => {
      const list = groupList.filter((g) => g.kind === k);
      return [k, { groups: list.length, records: list.reduce((s, g) => s + g.size, 0) }];
    }))
  };

  // ---- the class checks the brief asks for --------------------------------------------------------
  const checks = {};
  const recordTotals = Object.fromEntries(ATTACHMENT_SIDES.map((a) => [a, recs.filter((r) => r.attachment === a).length]));
  const houseTotals = Object.fromEntries(ATTACHMENT_SIDES.map((a) => [a, recs.filter((r) => r.attachment === a && r.kind === 0).length]));
  const groupStyleTotals = Object.fromEntries(ATTACHMENT_GROUP.map((a) => [a, recs.filter((r) => r.groupStyle === a).length]));
  checks.attachments = {
    sides: recordTotals, sidesSum: Object.values(recordTotals).reduce((s, v) => s + v, 0),
    house: houseTotals,
    group: groupStyleTotals, groupSum: Object.values(groupStyleTotals).reduce((s, v) => s + v, 0),
    // what the coordinator counted directly from the sidecar (st-ndw9.1-census-fix1.md), to compare
    expected: { sides: { none: 21289, one: 4891, both: 7303, corner: 1771 }, house: { none: 12168, one: 2474, both: 972, corner: 459 } }
  };
  checks.classSum = {
    records: recs.length,
    recordSum: classes.reduce((s, c) => s + c.count, 0),
    groupClassSum: groupClasses.reduce((s, c) => s + c.groups, 0),
    groupClassRecords: groupClasses.reduce((s, c) => s + c.count, 0),
    everyRecordOnce: classes.reduce((s, c) => s + c.count, 0) === recs.length && new Set(recs.map((r) => r.id)).size === recs.length
  };
  checks.partyEdges = { computed: recs.reduce((s, r) => s + r.party.partyEdges, 0), documented: 66151 };
  checks.partyEdgeNeighbours = parties;
  checks.outbuildingThresholds = Object.fromEntries([['base', 1, 1], ['area+20%', 1.2, 1], ['area-20%', 0.8, 1], ['height+20%', 1, 1.2], ['height-20%', 1, 0.8]].map(([name, am, hm]) => {
    const a = OUTBUILDING.maxArea * am, hh = OUTBUILDING.maxHeight * hm;
    return [name, { maxArea: +a.toFixed(1), maxHeight: +hh.toFixed(1), count: recs.filter((r) => r.streets === 0 && r.area <= a && r.h < hh).length }];
  }));
  const KENSINGTON = [[-1147.51, -1778.44], [-1995.31, -1784.14], [-1948.04, -1253.38], [-1117.34, -1218.66]];
  const ken = recs.filter((r) => inRing(r.cx, r.cz, KENSINGTON));
  checks.kensington = {
    buildings: ken.length,
    sides: Object.fromEntries(ATTACHMENT_SIDES.map((a) => [a, ken.filter((r) => r.attachment === a).length])),
    group: Object.fromEntries(ATTACHMENT_GROUP.map((a) => [a, ken.filter((r) => r.groupStyle === a).length])),
    byHeightBand: Object.fromEntries(HEIGHT_BANDS.map((b) => [b.id, ken.filter((r) => r.heightBand === b.id).length])),
    mainStreet: ken.filter((r) => r.mainStreet).length
  };
  checks.pairNeighbours = pick(recs.filter((r) => r.groupStyle === 'pair'), 20, 0x9a17).map((r) => ({ id: r.id, ...at(r), x: r.cx, z: r.cz, group: r.group.size, neighbours: r.neighbourIds }));
  // house records with no party wall at all: the shorter side and the area histograms, and 20 with a 9 to 12 m side
  const isolatedHouses = recs.filter((r) => r.kind === 0 && r.party.partyEdges === 0);
  checks.isolatedHouses = {
    records: isolatedHouses.length,
    shorterMedian: round(q(isolatedHouses.map((r) => r.shorter), 0.5)),
    shorterHistogram: bins(isolatedHouses, (r) => r.shorter, [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 25, 30]),
    areaHistogram: bins(isolatedHouses, (r) => r.area, [40, 60, 80, 100, 120, 140, 160, 180, 200, 240, 280, 320, 400, 500, 700, 1000]),
    narrowerThan6: isolatedHouses.filter((r) => r.shorter < 6).length,
    nineToTwelve: isolatedHouses.filter((r) => r.shorter >= 9 && r.shorter < 12).length,
    examples: pick(isolatedHouses.filter((r) => r.shorter >= 9 && r.shorter < 12), 20, 0x77aa).map((r) => ({ ...ex(r), shorter: +r.shorter.toFixed(1), kind: KIND_NAMES[r.kind] }))
  };

  const city = {
    records: recs.length,
    totalAreaM2: Math.round(totalArea),
    classes: classes.length,
    groupClasses: groupClasses.length,
    kinds: Object.fromEntries(KIND_NAMES.map((k, i) => [k, recs.filter((r) => r.kind === i).length])),
    sides: recordTotals,
    groupStyles: groupStyleTotals,
    outbuildings: recs.filter((r) => r.outbuilding).length,
    mainStreet: recs.filter((r) => r.mainStreet).length,
    podium: recs.filter((r) => r.podium).length,
    courtyards: recs.filter((r) => r.courtyard).length,
    partyEdges: checks.partyEdges.computed,
    groups: groupsCity
  };
  return {
    generatedBy: 'tools/report-building-classes.mjs',
    since: '2026-11-14',
    revision: 'fix1 (2026-11-14): sides/both/corner attachment, group-level classes, isolated-house measurement, lat/lon',
    thresholds: { FLOOR_M, PARTY_EDGE_MIN_M, SIDE_SAME_DOT, SIDE_MIN_M, SIDE_OPPOSITE_DOT, PARTY_PROBE, NEIGHBOUR_GAP_M, OUTBUILDING, EXAMPLES: examples },
    projection,
    city,
    classes,
    groupClasses,
    crossTables: {
      sidesByHeight: cross(recs, ATTACHMENT_SIDES, HEIGHT_BANDS.map((b) => b.id), (r) => [r.attachment, r.heightBand]),
      sidesByKind: cross(recs, ATTACHMENT_SIDES, KIND_NAMES, (r) => [r.attachment, KIND_NAMES[r.kind] || String(r.kind)]),
      groupByHeight: cross(recs, ATTACHMENT_GROUP, HEIGHT_BANDS.map((b) => b.id), (r) => [r.groupStyle, r.heightBand]),
      kindByGroup: cross(recs, KIND_NAMES, ATTACHMENT_GROUP, (r) => [KIND_NAMES[r.kind] || String(r.kind), r.groupStyle])
    },
    quantiles: {
      all: qset(recs),
      bySides: Object.fromEntries(ATTACHMENT_SIDES.map((a) => [a, qset(recs.filter((r) => r.attachment === a))])),
      byGroup: Object.fromEntries(ATTACHMENT_GROUP.map((a) => [a, qset(recs.filter((r) => r.groupStyle === a))])),
      byClass: Object.fromEntries(classes.map((c) => [c.id, qset(recs.filter((r) => r.classId === c.id))])),

    },
    histogram: { area: bins(recs, (r) => r.area, [10, 20, 30, 40, 60, 80, 120, 200, 400, 1000, 4000, 10000]), height: bins(recs, (r) => r.h, [3, 4, 5, 6, 8, 10, 12, 15, 20, 30, 60, 100]), shorter: bins(recs, (r) => r.shorter, [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 20, 30]) },
    checks
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  const { values: opt } = parseArgs({ options: {
    json: { type: 'string', default: 'tools/building-classes.json' },
    md: { type: 'string' },
    examples: { type: 'string', default: String(EXAMPLES) },
    quiet: { type: 'boolean', default: false }
  } });
  const out = await run({ examples: Number(opt.examples) });
  const jsonPath = path.resolve(ROOT, opt.json);
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2) + '\n');
  if (opt.md) fs.writeFileSync(path.resolve(ROOT, opt.md), renderMarkdown(out));
  if (!opt.quiet) {
    const c = out.city;
    console.log(`records ${c.records}, classes ${c.classes}, outbuildings ${c.outbuildings}, party edges ${c.partyEdges}`);
    console.log(`party sides ${JSON.stringify(c.sides)}; group style ${JSON.stringify(c.groupStyles)}`);
    console.log(`neighbours ${JSON.stringify(out.checks.partyEdgeNeighbours)}`);
    console.log(`wrote ${jsonPath}${opt.md ? ` and ${path.resolve(ROOT, opt.md)}` : ''}`);
  }
}
