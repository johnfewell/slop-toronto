// tools/build-massing.mjs — writes data/toronto-massing.bin: the City's 3D Massing polygons (outer ring and courtyard
// holes) of every building in the detailed city, keyed by their durable massing IDs (docs/geodata-ids.md) with a slim
// ID -> GEO.buildings row index, for buildings.js to extrude behind ?massing=1 (docs/massing-buildings.md). Format and
// reader: js/massing-data.js. Main's default (the L/T/U boxes in GEO.buildings) is unchanged; the committed geodata is
// not rebuilt, and the default page never loads this file.
//
// Inputs (read only):
// - js/toronto-geodata.js and js/toronto-geodata-ids.js: each row's massing record (`to-3dmassing-2025:<fid>[.<k>]`),
//   height and frame. Heights come from GEO, so a polygon stands exactly as tall as its box did.
// - js/city-config.js (nearestRoads): which edges look onto a street
// - the 2025 3D Massing shapefile (tools/fetch-massing.mjs's source): the record's full polygon. fetch-massing.mjs keeps
//   only each polygon's outer ring; this reads the holes too.
// Per record it precomputes what the runtime would otherwise search for (the wall classification inputs):
// - `base`: the roof of a lower part this part stands on (a tower on its podium), so the walls start there instead of
//   doubling the podium's walls (coplanar walls flicker)
// - the party walls: outer edges with a neighbour's mass against them (sampled just outside), with that neighbour's
//   height. The shader draws them windowless (WALL_KINDS.lotLine), as mrdoob's 819a0ad does in Slop New York.
// - the hidden walls: outer edges another part as tall stands just inside (overlapping or duplicated records)
// - the street edges: outer edges facing a named road within 15 m of its kerb (buildings.js footprintEdges)
// The rings are cleaned (no repeats, under 0.02 m merged, Douglas-Peucker 0.2 m), set on the decimetre grid the file
// stores and cleaned again, so the classification sees exactly the corners the page will.
//
// usage: node tools/build-massing.mjs [<3DMassingShapefile_2025_WGS84.shp>] [--out data/toronto-massing.bin]
//          [--json <stats.json>]
// (default shapefile: ~/.cache/slop-toronto/raw/massing2025/3DMassingShapefile_2025_WGS84.shp). Deterministic: the
// same inputs give the same bytes (tests/geodata.test.mjs, npm run test:geodata). Sets the file's hash in
// js/massing-data.js when it writes the committed file.
// Source: City of Toronto Open Data, 3D Massing 2025 (Open Government Licence – Toronto).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { openShp } from 'shapefile';
import { packGeo } from './geo-pack.mjs';
import { rowCheck, MASSING_SCHEMA } from '../js/massing-data.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { values: opt, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' }, json: { type: 'string' }, geo: { type: 'string' }, ids: { type: 'string' }, frame: { type: 'string' } } });
const COMMITTED = path.join(ROOT, 'data/toronto-massing.bin');
const OUT = path.resolve(opt.out || COMMITTED);
const SHP = positionals[0] || path.join(os.homedir(), '.cache/slop-toronto/raw/massing2025/3DMassingShapefile_2025_WGS84.shp');
const EDITION = '3DMassingShapefile_2025_WGS84';
const DATASET = 'to-3dmassing-2025';

const SIMPLIFY = 0.2; // m: Douglas-Peucker on the rings (the box build used 0.25 m)
const GRID_PER_M = 10 ** Number(process.env.MASSING_DECIMALS || 1); // the stored corners' grid: decimetres, as the sidewalk rings
const PARTY_PROBE = 0.35; // m outside an edge where a neighbour's mass makes it a party wall
const BASE_REACH = 0.6; // m: a part stands on a lower one when all its corners lie within this of it
const MIN_HOLE = 4; // m²: a smaller courtyard is noise

const load = (file, ctx = { window: {} }) => {
  vm.createContext(ctx);
  const p = path.isAbsolute(file) ? file : path.join(ROOT, file);
  vm.runInContext(fs.readFileSync(p, 'utf8'), ctx);
  return ctx.window.CITY;
};
const GEO_PATH = opt.geo ? path.resolve(opt.geo) : path.join(ROOT, 'js/toronto-geodata.js');
const IDS_PATH = opt.ids ? path.resolve(opt.ids) : (opt.geo ? opt.geo.replace(/\.js$/, '-ids.js') : path.join(ROOT, 'js/toronto-geodata-ids.js'));
const geoSource = fs.readFileSync(GEO_PATH, 'utf8');
const cityCtx = { window: {}, Math, JSON, Object, Array, Number, Map, Set };
const { GEO } = load(GEO_PATH, cityCtx);
load('js/city-config.js', cityCtx);
const { nearestRoads } = cityCtx.window.CITY;
const { GEO_IDS } = load(IDS_PATH);
const geodataHash = createHash('sha256').update(geoSource).digest('hex').slice(0, 16);
if (GEO_IDS.geodata !== geodataHash) throw new Error(`js/toronto-geodata-ids.js describes geodata ${GEO_IDS.geodata}, not this ${geodataHash}`);
if (GEO_IDS.buildings.length !== GEO.buildings.length) throw new Error('GEO_IDS.buildings is not row for row with GEO.buildings');

// The geodata's own frame (GEO.frame.projection; tools/geo-base.mjs toWorld)
const P = GEO.frame.projection;
const toWorld = (lon, lat) => {
  const e = (lon - P.lon0) * P.kx, n = (lat - P.lat0) * P.ky, c = Math.cos(P.theta), s = Math.sin(P.theta);
  return [e * c - n * s - P.ox, -(e * s + n * c) - P.oz];
};
// Web Mercator -> lon/lat, rounded to 1e-7 exactly as tools/fetch-massing.mjs does (the same points the build saw)
const R = 6378137;
const lonLat = ([x, y]) => [
  Math.round(((x / R) * 180) / Math.PI * 1e7) / 1e7,
  Math.round(((2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180) / Math.PI * 1e7) / 1e7
];

// ---- 2D helpers
const area2 = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return a / 2; };
function inRing(x, z, r) {
  let yes = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) yes = !yes;
  }
  return yes;
}
const inPolygon = (x, z, rings) => inRing(x, z, rings[0]) && !rings.slice(1).some((h) => inRing(x, z, h));
function edgeDistance(x, z, r) {
  let best = Infinity;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [ax, az] = r[j], [bx, bz] = r[i], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
}
// Douglas-Peucker on a closed ring, keeping its two farthest-apart points (as world-collision.js simplifyRing)
function simplify(pts, tol) {
  if (pts.length < 5) return pts;
  const keep = new Uint8Array(pts.length);
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > fd) { fd = d; far = i; } }
  keep[0] = keep[far] = 1;
  const stack = [[0, far], [far, pts.length]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const a = pts[i0], b = pts[i1 % pts.length];
    let best = -1, bd = tol;
    for (let i = i0 + 1; i < i1; i++) {
      const p = pts[i], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2)) : 0;
      const d = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([i0, best], [best, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const snap = (v) => Math.round(v * GRID_PER_M) / GRID_PER_M; // (exactly the stored value)
// Corners on the stored grid with no repeats and no straight-through points (both arise from snapping)
function onGrid(ring) {
  let r = ring.map(([x, z]) => [snap(x), snap(z)]);
  r = r.filter((p, i) => { const q = r[(i + r.length - 1) % r.length]; return p[0] !== q[0] || p[1] !== q[1]; });
  for (let changed = true; changed && r.length > 3;) {
    changed = false;
    for (let i = 0; i < r.length && r.length > 3; i++) {
      const a = r[(i + r.length - 1) % r.length], p = r[i], b = r[(i + 1) % r.length];
      const cross = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]);
      // (a straight-through corner, or a spike back on itself)
      if (Math.abs(cross) < 1e-9) { r.splice(i, 1); changed = true; i--; }
    }
  }
  return r;
}
// A ring cleaned for extrusion: no closing duplicate, no repeated or collinear points, simplified, on the grid, at
// least 3 corners and some area
function cleanRing(ring, tol = SIMPLIFY, grid = true) {
  let r = ring.slice();
  if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
  r = r.filter((p, i) => { const q = r[(i + r.length - 1) % r.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.02; });
  r = simplify(r, tol);
  if (grid) r = onGrid(r);
  return r.length >= 3 && Math.abs(area2(r)) > 0.5 ? r : null;
}
// Two segments cross (properly, or touch where they are not neighbours)
function segsMeet(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const on = (p, q, r) => Math.min(p[0], q[0]) <= r[0] && r[0] <= Math.max(p[0], q[0]) && Math.min(p[1], q[1]) <= r[1] && r[1] <= Math.max(p[1], q[1]);
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  return (o1 === 0 && on(a, b, c)) || (o2 === 0 && on(a, b, d)) || (o3 === 0 && on(c, d, a)) || (o4 === 0 && on(c, d, b));
}
function selfCrossing(ring) {
  const n = ring.length;
  for (let a = 0; a < n; a++) for (let b = a + 2; b < n; b++) {
    if (a === 0 && b === n - 1) continue;
    if (segsMeet(ring[a], ring[(a + 1) % n], ring[b], ring[(b + 1) % n])) return true;
  }
  return false;
}

// ---- every row and the record it needs
const rows = [];
const want = new Map(); // fid -> [{ row, k }]
GEO.buildings.forEach((b, row) => {
  const id = GEO_IDS.buildings[row];
  const m = /^to-3dmassing-2025:(\d+)(?:\.(\d+))?$/.exec(id);
  const r = { row, id, cx: b[0], cz: b[1], h: b[4] };
  rows.push(r);
  if (!m) { r.skip = 'no massing record'; return; }
  r.fid = Number(m[1]);
  r.k = m[2] === undefined ? undefined : Number(m[2]);
  (want.get(r.fid) || want.set(r.fid, []).get(r.fid)).push(r);
});

const t0 = Date.now();
const src = await openShp(SHP);
let fid = -1;
for (;;) {
  const { done, value } = await src.read();
  if (done) break;
  fid++;
  const hits = want.get(fid);
  if (!hits) continue;
  const polys = value.type === 'Polygon' ? [value.coordinates] : value.coordinates;
  for (const r of hits) {
    if ((r.k === undefined) !== (polys.length === 1) || (r.k !== undefined && !polys[r.k])) { r.skip = `the record has ${polys.length} polygons`; continue; }
    r.rings = polys[r.k || 0].map((ring) => ring.map((p) => toWorld(...lonLat(p))));
  }
}
const tRead = Date.now() - t0;
for (const r of rows) if (!r.skip && !r.rings) r.skip = 'record not in the shapefile';
if (rows.filter((r) => r.skip === 'record not in the shapefile').length > rows.length / 100) throw new Error(`most records missing: is ${SHP} the ${EDITION} edition?`);

// ---- clean, orient (outer counter-clockwise in x/z as stored; holes the other way), measure
const stats = { rows: rows.length, records: 0, skipped: {}, unsimplified: 0, multi: 0, holes: 0, droppedHoles: 0, onPodium: 0, edges: 0, partyEdges: 0, hiddenEdges: 0, streetEdges: 0, mainStreetEdges: 0, corners: 0 };
for (const r of rows) {
  if (r.skip) continue;
  let outer = cleanRing(r.rings[0]);
  if (!outer) { r.skip = 'degenerate outer ring'; continue; }
  // (a ring the simplification or the grid made cross itself: once more unsimplified; else it keeps its boxes)
  if (selfCrossing(outer)) { stats.unsimplified++; outer = cleanRing(r.rings[0], 0); }
  if (!outer || selfCrossing(outer)) {
    const raw = cleanRing(r.rings[0], 0, false);
    r.skip = !raw || selfCrossing(raw) ? 'outer ring crosses or touches itself in the source' : 'outer ring crosses itself on the decimetre grid';
    continue;
  }
  if (area2(outer) < 0) outer.reverse();
  const holes = [];
  for (const h of r.rings.slice(1)) {
    const c = cleanRing(h);
    if (!c || Math.abs(area2(c)) < MIN_HOLE || selfCrossing(c) || !c.every(([x, z]) => inRing(x, z, outer))) { stats.droppedHoles++; continue; } // (noise, or not cleanly inside)
    if (area2(c) > 0) c.reverse();
    holes.push(c);
  }
  r.poly = [outer, ...holes];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of outer) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  Object.assign(r, { x0, x1, z0, z1 });
  // (the row's box centre stands within its outline's bounds: js/massing-data.js rejects a record whose doesn't)
  if (!(r.cx >= x0 - 2 && r.cx <= x1 + 2 && r.cz >= z0 - 2 && r.cz <= z1 + 2)) { r.skip = 'row centre away from the outline'; delete r.poly; }
}
const live = rows.filter((r) => !r.skip);
// a coarse grid for the neighbour searches
const CELL = 25;
const grid = new Map();
const key = (i, j) => i * 100000 + j;
for (const r of live) for (let i = Math.floor(r.x0 / CELL); i <= Math.floor(r.x1 / CELL); i++) for (let j = Math.floor(r.z0 / CELL); j <= Math.floor(r.z1 / CELL); j++) {
  (grid.get(key(i, j)) || grid.set(key(i, j), []).get(key(i, j))).push(r);
}
const near = (x, z) => grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) || [];

for (const r of live) {
  // standing on a lower part: every corner within BASE_REACH of it, the centre inside it
  const [outer] = r.poly;
  const cx = outer.reduce((s, p) => s + p[0], 0) / outer.length, cz = outer.reduce((s, p) => s + p[1], 0) / outer.length;
  let base = 0;
  for (const q of near(cx, cz)) {
    if (q === r || !(q.h < r.h - 0.5) || q.h <= base) continue;
    if (cx < q.x0 || cx > q.x1 || cz < q.z0 || cz > q.z1 || !inPolygon(cx, cz, q.poly)) continue;
    if (outer.every(([x, z]) => inPolygon(x, z, q.poly) || edgeDistance(x, z, q.poly[0]) < BASE_REACH)) base = q.h;
  }
  r.base = base;
  if (base) stats.onPodium++;
}
for (const r of live) {
  const [outer] = r.poly;
  // party walls: each outer edge's three probes just outside it all inside one neighbour or another; the lowest of
  // their roofs is how high the wall is covered (a neighbour standing on a podium covers from its base up only, so its
  // podium is what counts down there: the highest mass at the probe whose base is on the ground)
  r.party = [];
  r.hidden = [];
  r.street = [];
  for (let i = 0; i < outer.length; i++) {
    const [ax, az] = outer[i], [bx, bz] = outer[(i + 1) % outer.length];
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    stats.edges++;
    if (L < 0.5) continue;
    // outward normal of a counter-clockwise ring (x right, z down the page: area2 > 0) is (dz, -dx) / L
    const nx = dz / L, nz = -dx / L;
    let covered = Infinity;
    for (const t of [0.15, 0.5, 0.85]) {
      const px = ax + dx * t + nx * PARTY_PROBE, pz = az + dz * t + nz * PARTY_PROBE;
      let roof = 0;
      for (const q of near(px, pz)) {
        if (q === r || q.base > 0 || px < q.x0 || px > q.x1 || pz < q.z0 || pz > q.z1) continue;
        if (inPolygon(px, pz, q.poly)) roof = Math.max(roof, q.h);
      }
      covered = Math.min(covered, roof);
      if (!covered) break;
    }
    if (covered > 0) { r.party.push([i, covered]); stats.partyEdges++; }
    // hidden walls: just inside the edge another part as tall or taller stands from as low (two overlapping records
    // sharing a wall line, or one inside another): this wall would only flicker against its wall, so it is left out
    // (of two equally tall parts, the later record leaves its wall out)
    let hidden = !(covered > 0);
    for (const t of [0.15, 0.5, 0.85]) {
      if (!hidden) break;
      const px = ax + dx * t - nx * PARTY_PROBE, pz = az + dz * t - nz * PARTY_PROBE;
      const cover = near(px, pz).some((q) => q !== r && q.base <= r.base + 0.05 && (q.h > r.h + 0.05 || (Math.abs(q.h - r.h) <= 0.05 && q.row < r.row))
        && px >= q.x0 && px <= q.x1 && pz >= q.z0 && pz <= q.z1 && inPolygon(px, pz, q.poly));
      if (!cover) { hidden = false; break; }
    }
    if (hidden) { r.hidden.push(i); stats.hiddenEdges++; continue; }
    // street fronts (buildings.js footprintEdges, which reads these): the nearest named road within 40 m of the edge's
    // middle, in front of it (within 45°), its kerb within 15 m; the edges under 2 m are windowless there anyway. (A
    // party edge may be one too: the page draws it as a party wall only where the neighbour covers enough of it.)
    if (L < 2) continue;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const road = nearestRoads(mx, mz, 40)[0];
    if (!road) continue;
    const tx = road.px - mx, tz = road.pz - mz, d = Math.hypot(tx, tz);
    if (d > 0.5 && (tx * nx + tz * nz) / d > 0.7 && d - (road.road.w || 0) / 2 < 15) {
      const main = (road.road.w || 0) >= 9;
      r.street.push(i * 2 + (main ? 1 : 0));
      stats.streetEdges++;
      if (main) stats.mainStreetEdges++;
    }
  }
  stats.corners += r.poly.reduce((s, ring) => s + ring.length, 0);
  stats.holes += r.poly.length - 1;
  if (r.k !== undefined) stats.multi++;
}
stats.records = live.length;
for (const r of rows) if (r.skip) stats.skipped[r.skip] = (stats.skipped[r.skip] || 0) + 1;

// ---- write: records by durable ID (the rows are already in record order, docs/geodata-ids.md)
const byId = live.slice().sort((a, b) => a.fid - b.fid || (a.k ?? -1) - (b.k ?? -1));
const skippedRows = rows.filter((r) => r.skip);
const reasons = [...new Set(skippedRows.map((r) => r.skip))].sort();
const M = {
  schema: MASSING_SCHEMA,
  source: 'City of Toronto 3D Massing 2025 (Open Government Licence – Toronto)',
  edition: EDITION,
  dataset: DATASET,
  geodata: geodataHash,
  rows: GEO.buildings.length,
  rowCheck: rowCheck(GEO.buildings),
  simplify: SIMPLIFY,
  fid: byId.map((r) => r.fid),
  part: byId.map((r) => (r.k === undefined ? 0 : r.k + 1)),
  row: byId.map((r) => r.row),
  base: byId.map((r) => r.base),
  holes: byId.map((r) => r.poly.length - 1),
  corners: byId.flatMap((r) => r.poly.map((ring) => ring.length)),
  start: byId.flatMap((r) => r.poly.flatMap((ring) => ring[0])),
  step: byId.flatMap((r) => r.poly.flatMap((ring) => ring.slice(1).flatMap(([x, z], k) => [
    Math.round(x * GRID_PER_M) - Math.round(ring[k][0] * GRID_PER_M), Math.round(z * GRID_PER_M) - Math.round(ring[k][1] * GRID_PER_M)]))),
  grid: GRID_PER_M,
  partyN: byId.map((r) => r.party.length),
  partyEdge: byId.flatMap((r) => r.party.map((p) => p[0])),
  partyCover: byId.flatMap((r) => r.party.map((p) => p[1])),
  hiddenN: byId.map((r) => r.hidden.length),
  hiddenEdge: byId.flatMap((r) => r.hidden),
  streetN: byId.map((r) => r.street.length),
  streetEdge: byId.flatMap((r) => r.street),
  skipRow: skippedRows.map((r) => r.row),
  skipWhy: skippedRows.map((r) => reasons.indexOf(r.skip)),
  reasons
};
const packed = packGeo({ MASSING: M });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, packed.file);
const hash = createHash('sha256').update(packed.file).digest('hex').slice(0, 12);
if (OUT === COMMITTED) {
  const page = path.join(ROOT, 'js/massing-data.js');
  const js = fs.readFileSync(page, 'utf8');
  const next = js.replace(/(\.\/data\/toronto-massing\.bin\?v=)[0-9a-f]*/, `$1${hash}`);
  if (next === js && !js.includes(hash)) throw new Error('js/massing-data.js: no ./data/toronto-massing.bin?v= to set');
  if (next !== js) fs.writeFileSync(page, next);
}
Object.assign(stats, { bytes: packed.file.length, raw: packed.raw.length, hash, readSeconds: tRead / 1000, seconds: (Date.now() - t0) / 1000 });
if (opt.json) fs.writeFileSync(path.resolve(opt.json), JSON.stringify(stats, null, 2) + '\n');
console.log(`[massing] ${live.length} of ${rows.length} buildings (skipped: ${JSON.stringify(stats.skipped)}; ${stats.unsimplified} unsimplified), ${stats.multi} parts of multi-polygon records, ` +
  `${stats.holes} courtyards (${stats.droppedHoles} dropped), ${stats.onPodium} on a podium; ${stats.edges} outer edges: ${stats.partyEdges} party walls, ` +
  `${stats.hiddenEdges} hidden, ${stats.streetEdges} street fronts (${stats.mainStreetEdges} on main streets); ${stats.corners} corners; ` +
  `${packed.file.length} bytes gzip (${packed.raw.length} raw) in ${stats.seconds.toFixed(1)} s -> ${path.relative(ROOT, OUT)} (v=${hash})`);
