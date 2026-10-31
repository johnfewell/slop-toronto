// tools/build-massing-pilot.mjs — writes js/toronto-massing-pilot.js: the City's 3D Massing polygons (outer ring and
// courtyard holes) of the buildings in one bounded pilot area, keyed to their GEO.buildings rows and durable massing IDs,
// for buildings.js to extrude behind ?massing=1 (docs/massing-buildings.md). Main's default (the L/T/U boxes in
// GEO.buildings) is unchanged; the committed geodata is not rebuilt.
//
// Inputs (read only):
// - js/toronto-geodata.js and js/toronto-geodata-ids.js: which rows stand in the pilot area, their massing record
//   (`to-3dmassing-2025:<fid>[.<k>]`), height and frame. The pilot rows' heights come from GEO, so a polygon stands
//   exactly as tall as its box did.
// - the 2025 3D Massing shapefile (tools/fetch-massing.mjs's source): the record's full polygon. fetch-massing.mjs keeps
//   only each polygon's outer ring; this reads the holes too.
// Per row it precomputes what the runtime would otherwise search for:
// - `base`: the roof of a lower part this part stands on (a tower on its podium), so the walls start there instead of
//   doubling the podium's walls (coplanar walls flicker)
// - the party walls: outer edges with a neighbour's mass against them (sampled just outside), with that neighbour's
//   height. The shader draws them windowless (WALL_KINDS.lotLine), as mrdoob's 819a0ad does in Slop New York.
//
// usage: node tools/build-massing-pilot.mjs [<3DMassingShapefile_2025_WGS84.shp>] [--out js/toronto-massing-pilot.js]
// (default shapefile: ~/.cache/slop-toronto/raw/massing2025/3DMassingShapefile_2025_WGS84.shp)
// Source: City of Toronto Open Data, 3D Massing 2025 (Open Government Licence – Toronto).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openShp } from 'shapefile';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const OUT = path.resolve(outAt >= 0 ? args.splice(outAt, 2)[1] : path.join(ROOT, 'js/toronto-massing-pilot.js'));
const SHP = args[0] || path.join(os.homedir(), '.cache/slop-toronto/raw/massing2025/3DMassingShapefile_2025_WGS84.shp');
const EDITION = '3DMassingShapefile_2025_WGS84';
const DATASET = 'to-3dmassing-2025';

// The pilot: the Kensington Market neighbourhood (the City's boundary: Spadina, College, Bathurst, Dundas), corners at
// the intersections' centres, each side pulled in by half a road so the far side of the boundary streets stays boxes
const AREA = {
  name: 'Kensington Market',
  corners: [[43.6578, -79.4004], [43.6556, -79.4108], [43.6510, -79.4083], [43.6529, -79.3980]], // College & Spadina, College & Bathurst, Dundas & Bathurst, Dundas & Spadina
  inset: 11
};
const SIMPLIFY = 0.2; // m: Douglas-Peucker on the rings (the box build used 0.25 m)
const PARTY_PROBE = 0.35; // m outside an edge where a neighbour's mass makes it a party wall
const BASE_REACH = 0.6; // m: a part stands on a lower one when all its corners lie within this of it

const load = (file) => {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx);
  return ctx.window.CITY;
};
const geoSource = fs.readFileSync(path.join(ROOT, 'js/toronto-geodata.js'), 'utf8');
const { GEO } = load('js/toronto-geodata.js');
const { GEO_IDS } = load('js/toronto-geodata-ids.js');
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
// A ring cleaned for extrusion: no closing duplicate, no repeated or collinear points, simplified, at least 3 corners
function cleanRing(ring) {
  let r = ring.slice();
  if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
  r = r.filter((p, i) => { const q = r[(i + r.length - 1) % r.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.02; });
  r = simplify(r, SIMPLIFY);
  return r.length >= 3 && Math.abs(area2(r)) > 0.5 ? r : null;
}
const q2 = (v) => Math.round(v * 100) / 100;

// ---- the pilot area in world metres, its sides pulled in
const corners = AREA.corners.map(([lat, lon]) => toWorld(lon, lat));
const quad = (() => {
  const c = [corners.reduce((s, p) => s + p[0], 0) / 4, corners.reduce((s, p) => s + p[1], 0) / 4];
  return corners.map(([x, z]) => {
    const dx = x - c[0], dz = z - c[1], l = Math.hypot(dx, dz);
    return [x - (dx / l) * AREA.inset * Math.SQRT2, z - (dz / l) * AREA.inset * Math.SQRT2];
  });
})();

// ---- the pilot rows and the records they need
const rows = [];
const want = new Map(); // fid -> [{ row, k }]
GEO.buildings.forEach((b, row) => {
  if (!inRing(b[0], b[1], quad)) return;
  const id = GEO_IDS.buildings[row];
  const m = /^to-3dmassing-2025:(\d+)(?:\.(\d+))?$/.exec(id);
  if (!m) throw new Error(`row ${row}: unexpected building ID ${id}`);
  const fid = Number(m[1]), k = m[2] === undefined ? undefined : Number(m[2]);
  rows.push({ row, id, fid, k, cx: b[0], cz: b[1], h: b[4] });
  (want.get(fid) || want.set(fid, []).get(fid)).push(rows[rows.length - 1]);
});

const t0 = Date.now();
const src = await openShp(SHP);
let fid = -1, found = 0;
for (;;) {
  const { done, value } = await src.read();
  if (done) break;
  fid++;
  const hits = want.get(fid);
  if (!hits) continue;
  const polys = value.type === 'Polygon' ? [value.coordinates] : value.coordinates;
  for (const r of hits) {
    if ((r.k === undefined) !== (polys.length === 1)) throw new Error(`${r.id}: the record has ${polys.length} polygons`);
    const poly = polys[r.k || 0];
    r.rings = poly.map((ring) => ring.map((p) => toWorld(...lonLat(p))));
    found++;
  }
}
if (found !== rows.length) throw new Error(`found ${found} of ${rows.length} records: is ${SHP} the ${EDITION} edition?`);

// ---- clean, orient (outer counter-clockwise in x/z as stored; holes the other way), measure
const stats = { rows: rows.length, holes: 0, multi: rows.filter((r) => r.k !== undefined).length, onPodium: 0, partyEdges: 0, hiddenEdges: 0, edges: 0, droppedHoles: 0, vertices: 0 };
for (const r of rows) {
  const outer = cleanRing(r.rings[0]);
  if (!outer) { r.skip = 'degenerate outer ring'; continue; }
  if (area2(outer) < 0) outer.reverse();
  const holes = [];
  for (const h of r.rings.slice(1)) {
    const c = cleanRing(h);
    if (!c || Math.abs(area2(c)) < 4) { stats.droppedHoles++; continue; } // (a courtyard under 4 m² is noise)
    if (area2(c) > 0) c.reverse();
    holes.push(c);
  }
  r.poly = [outer, ...holes];
  stats.holes += holes.length;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of outer) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  Object.assign(r, { x0, x1, z0, z1 });
}
const live = rows.filter((r) => !r.skip);
// a coarse grid for the neighbour searches
const grid = new Map();
const key = (i, j) => i + ',' + j;
for (const r of live) for (let i = Math.floor(r.x0 / 25); i <= Math.floor(r.x1 / 25); i++) for (let j = Math.floor(r.z0 / 25); j <= Math.floor(r.z1 / 25); j++) {
  (grid.get(key(i, j)) || grid.set(key(i, j), []).get(key(i, j))).push(r);
}
const near = (x, z) => grid.get(key(Math.floor(x / 25), Math.floor(z / 25))) || [];

for (const r of live) {
  // standing on a lower part: every corner within BASE_REACH of it, the centre inside it
  const [outer] = r.poly;
  const cx = outer.reduce((s, p) => s + p[0], 0) / outer.length, cz = outer.reduce((s, p) => s + p[1], 0) / outer.length;
  let base = 0;
  for (const q of near(cx, cz)) {
    if (q === r || !(q.h < r.h - 0.5) || q.h <= base) continue;
    if (!inPolygon(cx, cz, q.poly)) continue;
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
    if (covered > 0) { r.party.push(i, q2(covered)); stats.partyEdges++; continue; }
    // hidden walls: just inside the edge another part as tall or taller stands from as low (two overlapping records
    // sharing a wall line, or one inside another): this wall would only flicker against its wall, so it is left out
    // (of two equally tall parts, the later record leaves its wall out)
    let hidden = true;
    for (const t of [0.15, 0.5, 0.85]) {
      const px = ax + dx * t - nx * PARTY_PROBE, pz = az + dz * t - nz * PARTY_PROBE;
      const cover = near(px, pz).some((q) => q !== r && q.base <= r.base + 0.05 && (q.h > r.h + 0.05 || (Math.abs(q.h - r.h) <= 0.05 && q.row < r.row))
        && px >= q.x0 && px <= q.x1 && pz >= q.z0 && pz <= q.z1 && inPolygon(px, pz, q.poly));
      if (!cover) { hidden = false; break; }
    }
    if (hidden) { r.hidden.push(i); stats.hiddenEdges++; }
  }
  stats.vertices += r.poly.reduce((s, ring) => s + ring.length, 0);
}

// ---- write
const records = live.map((r) => [r.row, r.id, r.cx, r.cz, q2(r.base), r.poly.map((ring) => ring.flatMap(([x, z]) => [q2(x), q2(z)])), r.party, r.hidden]);
const body = {
  schema: 1,
  source: 'City of Toronto 3D Massing 2025 (Open Government Licence – Toronto)',
  edition: EDITION,
  dataset: DATASET,
  geodata: geodataHash,
  area: { name: AREA.name, quad: quad.map(([x, z]) => [q2(x), q2(z)]) },
  // [row, massing ID, row centre x, z (checked against GEO.buildings before use), base (m), [outer, ...holes] as flat
  // x, z lists, party walls as flat [outer edge index, covered to (m), ...], hidden outer edges (no wall: another part's
  // wall stands on it) [index, ...]]
  records
};
const text = `// js/toronto-massing-pilot.js — GENERATED by tools/build-massing-pilot.mjs, do not edit by hand.
// The City of Toronto's 3D Massing polygons (outer ring and courtyards) of the ${AREA.name} pilot's buildings, row for
// row with GEO.buildings (checked by centre) and keyed by their durable massing IDs (docs/geodata-ids.md), for
// buildings.js to extrude instead of their boxes behind ?massing=1 (docs/massing-buildings.md). Loaded only then.
// Source: City of Toronto Open Data, 3D Massing 2025 (Open Government Licence – Toronto).
(function () {
window.CITY = window.CITY || {};
window.CITY.MASSING_PILOT = ${JSON.stringify(body)};
})();
`;
fs.writeFileSync(OUT, text);
const skipped = rows.filter((r) => r.skip);
console.log(`[massing-pilot] ${AREA.name}: ${live.length} buildings (${skipped.length} skipped${skipped.length ? ': ' + skipped.map((r) => r.id + ' ' + r.skip).join(', ') : ''}), ` +
  `${stats.multi} parts of multi-polygon records, ${stats.holes} courtyards (${stats.droppedHoles} tiny dropped), ${stats.onPodium} on a podium, ` +
  `${stats.partyEdges} of ${stats.edges} outer edges party walls, ${stats.hiddenEdges} hidden, ${stats.vertices} vertices; ${(text.length / 1024).toFixed(0)} KiB in ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${path.relative(ROOT, OUT)}`);
