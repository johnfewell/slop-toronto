// tools/build-rosedale-houses.mjs (jf-abm, docs/rosedale-pilot.md): the Rosedale-Moore Park pilot's data, data/frames/eglinton/rosedale-houses.bin
// (read by js/rosedale-houses.js): per house its outline with the wall classification the massing sidecar carries (party, hidden and
// street edges), its slimmed lidar roof (planes merged, tiny planes absorbed, boundaries simplified), its eave, a style code, and
// the lidar top and mean heights for the roof planner where the lidar fit is poor.
//
// usage: node tools/build-rosedale-houses.mjs <roofs.json> <houses.csv> [--stats out.json]
//   roofs.json  rosedale-roofs/1 (the shared Toronto data repo: planes and triangles per City 3D Massing id, local metres east, north, up)
//   houses.csv  rosedale-houses/1 (the same ids with the heritage join). Its rating, year, architect and register columns pick each
//               house's era and style; only the derived codes (era, style) go in the file: the residents' associations' lists are
//               not republished.
// The rows a house stands for are the bigger map's box rows whose centre lies inside its outline (as tools/build-rosedale-heights.mjs).
// Rows the default page already draws from outlines (the downtown frame's massing sidecar) are left alone.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { unpackGeo } from '../js/geodata-loader.js';
import { massingRows } from '../js/massing-data.js';
import { ROSEDALE_HOUSES_SCHEMA, rowsCheck, ERA_NAMES, STYLE_NAMES } from '../js/rosedale-houses.js';
import { packGeo } from './geo-pack.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(ROOT, 'data/frames/eglinton/rosedale-houses.bin');
const args = process.argv.slice(2);
const statsAt = args.indexOf('--stats');
const [roofsFile, housesCsv] = args.filter((a, i) => !a.startsWith('--') && (statsAt < 0 || i !== statsAt + 1));
if (!roofsFile || !housesCsv) { console.error('usage: node tools/build-rosedale-houses.mjs <roofs.json> <houses.csv> [--stats out.json]'); process.exit(2); }
const statsOut = args.includes('--stats') ? args[args.indexOf('--stats') + 1] : null;

// ---- knobs ----------------------------------------------------------------------------------------------------------------
const GRID = 10; // stored coordinates: decimetres
const RING_TOL = 0.2; // m, Douglas-Peucker on outlines (as the massing sidecar)
const CHAIN_TOL = 0.3; // m, Douglas-Peucker on the boundaries between roof planes
const MERGE_DEG = 7, MERGE_M = 0.25; // planes this close (angle, and height at both centres) are one facet
const TINY_M2 = 2.5; // a plane under this is absorbed into the neighbour it shares the longest border with
const MIN_EAVE = 2.5;
const MAX_FACETS = 8;
const GABLE_MAX = 4.5; // m: a gable wall higher over the eave than this is noise
const STEEP_COS = 0.5; // cos of 60 degrees
const EAVE_PERCENTILE = 0.4; // the eave is the roof's height along this share (by length) of the outline from the bottom
const GABLE_TOL = 0.25; // m, Douglas-Peucker on a gable wall's top
const GABLE_MIN = 0.35; // m: the roof stands this far over the eave before the wall is carried up to it
const POOR = { coverage: 0.45, mae: 0.5, gap: 0.15 }; // a fit worse than this goes to the roof planner on the lidar heights

// ---- the geodata, the drawn rows and the street network -----------------------------------------------------------------
const geoFile = fs.readFileSync(path.join(ROOT, 'data/frames/eglinton/toronto-geodata.bin'));
const { GEO } = await unpackGeo(geoFile);
const { MASSING } = await unpackGeo(fs.readFileSync(path.join(ROOT, 'data/toronto-massing.bin')));
const drawn = massingRows(MASSING, GEO);
if (drawn.error) throw new Error(`the massing sidecar does not match the Eglinton map's geodata: ${drawn.error}`);
const win = { CITY: { GEO } };
const ctx = vm.createContext({ window: win, console, performance, Math, location: { search: '' } });
if (!GEO.areas.some((a) => a[1] === 'Distillery District')) { const { x0, z0 } = GEO.frame.detail; GEO.areas.push(['name', 'Distillery District', [x0 - 1e5, z0 - 1e5, x0 - 1e5 + 1, z0 - 1e5, x0 - 1e5, z0 - 1e5 + 1], []]); }
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/city-config.js'), 'utf8'), ctx, { filename: 'city-config.js' });
const { nearestRoads } = win.CITY;

const P = GEO.frame.projection;
const toWorld = (lon, lat) => { const e = (lon - P.lon0) * P.kx, n = (lat - P.lat0) * P.ky, c = Math.cos(P.theta), s = Math.sin(P.theta); return [e * c - n * s - P.ox, -(e * s + n * c) - P.oz]; };
const C = Math.cos(P.theta), S = Math.sin(P.theta);
const off = (e, n) => [e * C - n * S, -(e * S + n * C)]; // a local east/north offset (m) -> a world dx, dz

// ---- small geometry ---------------------------------------------------------------------------------------------------------
const area2 = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return a / 2; };
const inRing = (x, z, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
const segDist = (p, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz, t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2)) : 0; return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz); };
function dpOpen(pts, tol) { // Douglas-Peucker on an open polyline, ends kept; returns the kept indices
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    let best = -1, bd = tol;
    for (let i = i0 + 1; i < i1; i++) { const d = segDist(pts[i], pts[i0], pts[i1]); if (d > bd) { bd = d; best = i; } }
    if (best >= 0) { keep[best] = 1; stack.push([i0, best], [best, i1]); }
  }
  return keep;
}
function dpRing(pts, tol) { // closed ring, the two farthest-apart points kept
  if (pts.length < 5) return pts;
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > fd) { fd = d; far = i; } }
  const a = dpOpen(pts.slice(0, far + 1), tol), b = dpOpen(pts.slice(far).concat([pts[0]]), tol);
  const out = [];
  a.forEach((k, i) => { if (k) out.push(pts[i]); });
  b.forEach((k, i) => { if (k && i > 0 && i < b.length - 1) out.push(pts[far + i]); });
  return out;
}
const snap = (v) => Math.round(v * GRID) / GRID;
function onGrid(ring) {
  let r = ring.map(([x, z]) => [snap(x), snap(z)]);
  r = r.filter((p, i) => { const q = r[(i + r.length - 1) % r.length]; return p[0] !== q[0] || p[1] !== q[1]; });
  for (let changed = true; changed && r.length > 3;) {
    changed = false;
    for (let i = 0; i < r.length && r.length > 3; i++) {
      const a = r[(i + r.length - 1) % r.length], p = r[i], b = r[(i + 1) % r.length];
      if (Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) < 1e-9) { r.splice(i, 1); changed = true; i--; }
    }
  }
  return r;
}
function segsMeet(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const on = (p, q, r) => Math.min(p[0], q[0]) <= r[0] && r[0] <= Math.max(p[0], q[0]) && Math.min(p[1], q[1]) <= r[1] && r[1] <= Math.max(p[1], q[1]);
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  return (o1 === 0 && on(a, b, c)) || (o2 === 0 && on(a, b, d)) || (o3 === 0 && on(c, d, a)) || (o4 === 0 && on(c, d, b));
}
const selfCrossing = (ring) => { const n = ring.length; for (let a = 0; a < n; a++) for (let b = a + 2; b < n; b++) { if (a === 0 && b === n - 1) continue; if (segsMeet(ring[a], ring[(a + 1) % n], ring[b], ring[(b + 1) % n])) return true; } return false; };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };

// ---- the heritage join -> era and style --------------------------------------------------------------------------------------
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const meta = new Map(parseCsv(fs.readFileSync(housesCsv, 'utf8')).map((r) => [r.id, r]));
// (jf-bya) the lots next to houses.csv (lots.json of rosedale-houses/1, build/rosedale-houses/lots.py): each house's lot frontage (the lot's short side) and
// whether the City licenses front-yard parking there; the file carries only these two numbers, for the yard the page draws (docs/rosedale-walls.md)
const lotsFile = path.join(path.dirname(path.resolve(housesCsv)), 'lots.json');
const lots = fs.existsSync(lotsFile) ? JSON.parse(fs.readFileSync(lotsFile, 'utf8')) : {};
// (jf-bya) the chimneys the lidar shows over each roof (build/rosedale-houses/chimneys.py: returns standing above the fitted planes), next to roofs.json
const chimFile = path.join(path.dirname(path.resolve(roofsFile)), 'chimneys.json');
const chimneys = fs.existsSync(chimFile) ? JSON.parse(fs.readFileSync(chimFile, 'utf8')) : {};
// (jf-ugq) the hedges and shrub masses the lidar shows in each house's lot (build/front-yards in the shared data repo: front-yard-vegetation/1, derived/front-yards/1/hedges.json), metres
// east and north of the part's centroid; the file carries hedges (a polyline, a width, a height), shrubs (a centre, a radius, a height) and the lot's canopy share (docs/front-yards.md)
const vegFile = process.env.FRONT_YARDS_JSON || path.join(path.dirname(path.resolve(roofsFile)), '..', '..', 'front-yards', '1', 'hedges.json');
const yardVeg = fs.existsSync(vegFile) ? JSON.parse(fs.readFileSync(vegFile, 'utf8')) : {};
const PARKING = { 'Front Yard': 1, 'Widened Driveway': 2, 'Boulevard Parking': 3 };
const eraOfYear = (y) => (y < 1900 ? 0 : y <= 1916 ? 1 : y <= 1929 ? 2 : y <= 1945 ? 3 : y <= 1967 ? 4 : 5);
// Moore Park, Summerhill and the Gore lands have no inventory. The neighbourhood's own mix (the census period of construction, the
// presets' table in docs/building-presets.md: 55% before 1920, 35% 1920 to 1945, 5% 1946 to 1960, then newer) is the prior: a house
// with no year takes the era its roof shape fits best among the eras that mix allows.
const PRIOR = [0.07, 0.48, 0.20, 0.15, 0.05, 0.05];
function guessEra(r, id) {
  const slope = r.mainSlope ?? 35, hipish = r.form === 'hip', flat = r.form === 'flat', complex = r.form === 'complex', gable = r.form === 'gable';
  const w = PRIOR.slice();
  if (flat || slope < 12) { w[0] *= 0.1; w[1] *= 0.1; w[2] *= 0.2; w[3] *= 0.4; w[4] *= 6; w[5] *= 4; }
  else if (slope < 30) { w[0] *= 0.3; w[1] *= 0.6; w[2] *= 0.8; w[3] *= 1.2; w[4] *= 4; w[5] *= 2; }
  else if (slope >= 40) { w[0] *= 2; w[1] *= 1.2; w[2] *= 1.6; w[3] *= 1.4; w[4] *= 0.3; w[5] *= 0.5; }
  if (complex) { w[0] *= 2.2; w[2] *= 1.5; w[1] *= 1.1; w[4] *= 0.4; }
  if (hipish) { w[1] *= 1.5; w[3] *= 1.4; }
  if (gable) { w[0] *= 1.2; w[2] *= 1.2; }
  // (a draw from the weights, seeded by the house's id: the neighbourhood reads as a mix, not as its commonest era)
  let hsh = 2166136261; for (const ch of id) hsh = Math.imul(hsh ^ ch.charCodeAt(0), 16777619);
  let t = ((hsh >>> 0) / 4294967296) * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) { t -= w[i]; if (t < 0) return i; }
  return w.length - 1;
}
// the styles of docs/rosedale-spike.md section 6 that read from the street as a colour and a roof: 0 plain (no claim), 1 Edwardian,
// 2 revival (Tudor, English cottage), 3 Georgian and colonial revival, 5 Queen Anne and Victorian, 10 Moderne, 11 post-war, 12 infill
function styleOf(era, r, m) {
  if (r.form === 'flat' && era >= 3) return era === 3 ? 10 : 11;
  if (era === 0) return 5;
  if (era === 1) return r.form === 'complex' && (r.mainSlope ?? 35) >= 38 && m.rating && m.rating !== 'UR' ? 2 : 1;
  if (era === 2) return r.form === 'hip' || r.form === 'row' ? 3 : (r.mainSlope ?? 35) >= 36 ? 2 : 1;
  if (era === 3) return r.form === 'complex' && (r.mainSlope ?? 35) >= 40 ? 2 : 3;
  if (era === 4) return 11;
  return 12;
}

// ---- box rows by centre (a 20 m grid) ----------------------------------------------------------------------------------------
const grid = new Map();
GEO.buildings.forEach((b, row) => { const k = `${Math.floor(b[0] / 20)}_${Math.floor(b[1] / 20)}`; (grid.get(k) || grid.set(k, []).get(k)).push(row); });
const rowsIn = (ring) => {
  const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]), out = [];
  for (let gx = Math.floor((Math.min(...xs) - 1) / 20); gx <= Math.floor((Math.max(...xs) + 1) / 20); gx++) for (let gz = Math.floor((Math.min(...zs) - 1) / 20); gz <= Math.floor((Math.max(...zs) + 1) / 20); gz++) {
    for (const row of grid.get(`${gx}_${gz}`) || []) { const b = GEO.buildings[row]; if (inRing(b[0], b[1], ring)) out.push(row); }
  }
  return out;
};

// ---- the roof, slimmed ---------------------------------------------------------------------------------------------------------
const vkey = (e, n) => `${Math.round(e * 1000)}_${Math.round(n * 1000)}`;
const planeZ = (pl, e, n) => -(pl.n[0] * e + pl.n[1] * n + pl.d) / pl.n[2];
/** The lidar roof of one house -> { polys: [{ plane, ring: [[e, n, u]...] }], tris } in local metres, planes merged, tiny ones absorbed, boundaries simplified */
function slimRoof(r) {
  const T = r.tris, planes = r.planes.map((p) => ({ n: p.n, d: p.d, w: p.points || 1 }));
  if (!T.length || !planes.length) return null;
  // 1. each triangle's plane (the fit lifted every region's triangles exactly onto its plane)
  const reg = new Int32Array(T.length);
  for (let t = 0; t < T.length; t++) {
    let best = 0, bres = Infinity;
    planes.forEach((p, i) => { let m = 0; for (let j = 0; j < 3; j++) m = Math.max(m, Math.abs(p.n[0] * T[t][3 * j] + p.n[1] * T[t][3 * j + 1] + p.n[2] * T[t][3 * j + 2] + p.d)); if (m < bres) { bres = m; best = i; } });
    reg[t] = best;
  }
  const triArea = (t) => Math.abs((T[t][3] - T[t][0]) * (T[t][7] - T[t][1]) - (T[t][6] - T[t][0]) * (T[t][4] - T[t][1])) / 2;
  const edgesOf = (t) => [[0, 1], [1, 2], [2, 0]].map(([a, b]) => [vkey(T[t][3 * a], T[t][3 * a + 1]), vkey(T[t][3 * b], T[t][3 * b + 1])]);
  // 2. which regions touch, and how long their shared border is (undirected edge -> regions holding it)
  const regionOf = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const parent = planes.map((_, i) => i);
  const centre = planes.map(() => ({ a: 0, e: 0, n: 0 }));
  for (let t = 0; t < T.length; t++) { const a = triArea(t), c = centre[reg[t]]; c.a += a; c.e += a * (T[t][0] + T[t][3] + T[t][6]) / 3; c.n += a * (T[t][1] + T[t][4] + T[t][7]) / 3; }
  centre.forEach((c) => { if (c.a > 0) { c.e /= c.a; c.n /= c.a; } });
  const adjacency = () => {
    const edge = new Map(), border = new Map(); // edge key -> [regions]; "a|b" -> shared length
    for (let t = 0; t < T.length; t++) for (const [ka, kb] of edgesOf(t)) { const k = ka < kb ? `${ka}~${kb}` : `${kb}~${ka}`; (edge.get(k) || edge.set(k, []).get(k)).push(regionOf(reg[t])); }
    for (const [k, rs] of edge) {
      if (rs.length !== 2 || rs[0] === rs[1]) continue;
      const [ka, kb] = k.split('~').map((s) => s.split('_').map(Number)); const len = Math.hypot(ka[0] - kb[0], ka[1] - kb[1]) / 1000;
      const key = rs[0] < rs[1] ? `${rs[0]}|${rs[1]}` : `${rs[1]}|${rs[0]}`;
      border.set(key, (border.get(key) || 0) + len);
    }
    return border;
  };
  const areaOf = () => { const a = new Float64Array(planes.length); for (let t = 0; t < T.length; t++) a[regionOf(reg[t])] += triArea(t); return a; };
  // 3. merge coplanar facets (same slope and height within MERGE_M at both centres), then absorb the tiny ones
  const nAngle = (p, q) => Math.acos(Math.min(1, p.n[0] * q.n[0] + p.n[1] * q.n[1] + p.n[2] * q.n[2])) * 180 / Math.PI;
  for (let pass = 0; pass < 4; pass++) {
    let merged = false;
    for (const key of adjacency().keys()) {
      const [i, j] = key.split('|').map(Number);
      if (regionOf(i) === regionOf(j)) continue;
      const p = planes[i], q = planes[j];
      if (nAngle(p, q) > MERGE_DEG) continue;
      const dz = Math.max(Math.abs(planeZ(p, centre[i].e, centre[i].n) - planeZ(q, centre[i].e, centre[i].n)), Math.abs(planeZ(p, centre[j].e, centre[j].n) - planeZ(q, centre[j].e, centre[j].n)));
      if (dz > MERGE_M) continue;
      const big = p.w >= q.w ? i : j, small = big === i ? j : i;
      parent[small] = big; planes[big].w += planes[small].w; merged = true;
    }
    if (!merged) break;
  }
  for (let pass = 0; pass < 6; pass++) {
    const area = areaOf(), border = adjacency();
    let tiny = -1;
    for (let i = 0; i < planes.length; i++) if (regionOf(i) === i && area[i] > 0 && (area[i] < TINY_M2 || planes[i].n[2] < STEEP_COS) && (tiny < 0 || area[i] < area[tiny])) tiny = i; // (a plane steeper than 60 degrees is a wall or noise)
    if (tiny < 0) break;
    let best = -1, bl = 0;
    for (const [key, len] of border) { const [i, j] = key.split('|').map(Number); if (i === tiny || j === tiny) { const o = i === tiny ? j : i; if (len > bl) { bl = len; best = o; } } }
    if (best < 0) break; // an island: it stays
    parent[tiny] = best; planes[best].w += planes[tiny].w;
    for (let t = 0; t < T.length; t++) if (regionOf(reg[t]) === best && reg[t] === tiny) { /* its triangles follow the new plane below */ }
  }
  const area = areaOf();
  // 4. a refit of each surviving facet's plane (area-weighted over its original planes' normals, through its centroid) is overkill: the
  //    largest original plane of the facet stands for it
  const finalPlane = new Map();
  const wMax = new Map();
  for (let i = 0; i < planes.length; i++) { const R = regionOf(i); if (!area[R]) continue; if (!wMax.has(R) || planes[i].w > wMax.get(R)) { wMax.set(R, planes[i].w); finalPlane.set(R, planes[i]); } }
  // the facets' boundary graph: directed boundary edges per facet, from the triangles' counter-clockwise edges
  const dirEdges = new Map(); // facet -> Map(from key -> [{ to, a, b }])
  const vert = new Map(); // key -> [e, n]
  for (let t = 0; t < T.length; t++) {
    const R = regionOf(reg[t]);
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
      let p0 = [T[t][3 * a], T[t][3 * a + 1]], p1 = [T[t][3 * b], T[t][3 * b + 1]], p2 = [T[t][3 * (3 - a - b)], T[t][3 * (3 - a - b) + 1]];
      const ccw = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]) > 0;
      if (!ccw) [p0, p1] = [p1, p0];
      const ka = vkey(...p0), kb = vkey(...p1);
      vert.set(ka, p0); vert.set(kb, p1);
      const m = dirEdges.get(R) || dirEdges.set(R, new Map()).get(R);
      // an edge shared by two triangles of this facet cancels (its reverse is also there)
      const rev = m.get(kb);
      if (rev) { const ix = rev.findIndex((e) => e.to === ka); if (ix >= 0) { rev.splice(ix, 1); if (!rev.length) m.delete(kb); continue; } }
      (m.get(ka) || m.set(ka, []).get(ka)).push({ to: kb });
    }
  }
  // chain simplification: a vertex stays when it is where three boundaries meet or the facets either side change; the runs between are Douglas-Peucker'd
  const incident = new Map(); // vertex key -> Set of "facet" (boundary edges of any facet that touch it), with undirected edges
  const und = new Map(); // undirected edge key -> Set of facets
  for (const [R, m] of dirEdges) for (const [ka, list] of m) for (const { to } of list) {
    const k = ka < to ? `${ka}~${to}` : `${to}~${ka}`; (und.get(k) || und.set(k, new Set()).get(k)).add(R);
    (incident.get(ka) || incident.set(ka, new Set()).get(ka)).add(k); (incident.get(to) || incident.set(to, new Set()).get(to)).add(k);
  }
  const sig = (k) => [...und.get(k)].sort((x, y) => x - y).join(',');
  const isNode = (v) => { const es = [...incident.get(v)]; return es.length !== 2 || sig(es[0]) !== sig(es[1]); };
  const keep = new Set();
  const seenEdge = new Set();
  const walk = (v0, e0) => { // from node v0 along edge e0 to the next node: the vertex keys passed
    const chain = [v0]; let v = v0, e = e0;
    for (;;) {
      seenEdge.add(e);
      const [a, b] = e.split('~'); v = a === v ? b : a; chain.push(v);
      if (isNode(v) || v === v0) break;
      const next = [...incident.get(v)].find((x) => x !== e);
      if (!next || seenEdge.has(next)) break;
      e = next;
    }
    return chain;
  };
  for (const v of incident.keys()) if (isNode(v)) { keep.add(v); for (const e of incident.get(v)) if (!seenEdge.has(e)) { const ch = walk(v, e); keep.add(ch[ch.length - 1]); const pts = ch.map((k) => vert.get(k)); const kk = dpOpen(pts, CHAIN_TOL); ch.forEach((k, i) => { if (kk[i]) keep.add(k); }); } }
  // (a loop with no node: keep its Douglas-Peucker corners as a ring)
  for (const e of und.keys()) if (!seenEdge.has(e)) {
    const [a] = e.split('~'); const chain = [a]; let v = a, ee = e;
    for (;;) { seenEdge.add(ee); const [x, y] = ee.split('~'); v = x === v ? y : x; if (v === a) break; chain.push(v); const next = [...incident.get(v)].find((q) => q !== ee); if (!next || seenEdge.has(next)) break; ee = next; }
    const ring = dpRing(chain.map((k) => vert.get(k)), CHAIN_TOL); const rk = new Set(ring.map((p) => vkey(p[0], p[1]))); chain.forEach((k) => { if (rk.has(k)) keep.add(k); });
  }
  // 5. each facet's outer loop through the kept vertices
  const polys = [];
  for (const [R, m] of dirEdges) {
    const pl = finalPlane.get(R); if (!pl) continue;
    const loops = [], used = new Set();
    for (const [ka, list] of m) for (const first of list) {
      const id0 = `${ka}>${first.to}`; if (used.has(id0)) continue;
      const loop = [ka]; let cur = ka, nxt = first;
      for (let guard = 0; guard < 4000; guard++) {
        used.add(`${cur}>${nxt.to}`); cur = nxt.to;
        if (cur === ka) break;
        loop.push(cur);
        const opts = (m.get(cur) || []).filter((o) => !used.has(`${cur}>${o.to}`));
        if (!opts.length) break;
        nxt = opts[0];
      }
      if (cur === ka) loops.push(loop);
    }
    // every outer loop of the facet (a facet can be two pieces; a hole, a clockwise loop, is filled)
    for (const lp of loops) {
      let pts = lp.filter((k) => keep.has(k)).map((k) => vert.get(k));
      if (pts.length < 3 || selfCrossing(pts)) pts = lp.map((k) => vert.get(k)); // (simplification made it cross itself: the loop as traced)
      if (pts.length < 3 || selfCrossing(pts)) continue;
      if (area2(pts) > 0.4) polys.push({ plane: pl, ring: pts });
    }
  }
  // 6. the height at each vertex: the mean of the facets that meet there (no cracks between them)
  const zAt = new Map();
  for (const pl of polys) for (const [e, n] of pl.ring) { const k = vkey(e, n); (zAt.get(k) || zAt.set(k, []).get(k)).push(planeZ(pl.plane, e, n)); }
  for (const pl of polys) pl.ring = pl.ring.map(([e, n]) => { const zs = zAt.get(vkey(e, n)); return [e, n, Math.max(0.5, Math.min(r.topHeight + 0.1, zs.reduce((s, v) => s + v, 0) / zs.length))]; });
  return { polys };
}

// ---- the houses --------------------------------------------------------------------------------------------------------------------
const roofs = JSON.parse(fs.readFileSync(roofsFile, 'utf8'));
const stats = { parts: 0, fitted: 0, noRow: 0, inDrawnFrame: 0, houses: 0, lidar: 0, planner: 0, flat: 0, noRoof: 0, jagged: 0, ringRejected: 0, polys: 0, roofTris: 0, gableTris: 0, styles: {}, eras: {}, withYear: 0, guessedEra: 0, rowsTotal: 0 };
const houses = [];
for (const [id, r] of Object.entries(roofs)) {
  stats.parts++;
  if (r.status !== 'ok' || !r.walls || !r.walls.length) continue;
  stats.fitted++;
  const [X0, Z0] = toWorld(r.lon, r.lat);
  const rawRing = r.walls.map((e) => { const [dx, dz] = off(e.a[0], e.a[1]); return [X0 + dx, Z0 + dz]; });
  const rows = rowsIn(rawRing);
  if (!rows.length) { stats.noRow++; continue; }
  const live = rows.filter((row) => !drawn.rows.has(row));
  if (!live.length) { stats.inDrawnFrame++; continue; }
  // the outline: as the massing sidecar cleans it (no repeats, Douglas-Peucker 0.2 m, on the decimetre grid), counter-clockwise in x, z
  let ring = rawRing.filter((p, i) => Math.hypot(p[0] - rawRing[(i + rawRing.length - 1) % rawRing.length][0], p[1] - rawRing[(i + rawRing.length - 1) % rawRing.length][1]) > 0.02);
  ring = onGrid(dpRing(ring, RING_TOL));
  if (ring.length < 3 || Math.abs(area2(ring)) < 4 || selfCrossing(ring)) { stats.ringRejected++; continue; }
  if (area2(ring) < 0) ring.reverse();
  const hid = id.match(/^to-3dmassing-2025:(\d+)(?:\.(\d+))?$/);
  if (!hid) continue;
  const m = meta.get(id) || {};
  // the lidar roof, slimmed
  const planes = r.planes || [];
  const wsum = planes.reduce((s, p) => s + (p.areaM2 || 0), 0);
  const avgRaw = wsum ? planes.reduce((s, p) => s + (p.meanH || 0) * (p.areaM2 || 0), 0) / wsum : (r.avgCity ?? r.topHeight * 0.7);
  const avgH = Math.max(1, Math.min(avgRaw, r.topHeight - 0.2)); // (the mean roof height is under the top)
  const hold = r.holdout && Number.isFinite(r.holdout.mae) ? r.holdout.mae : null;
  const poor = !(r.coverage >= POOR.coverage) || (hold !== null && hold > POOR.mae) || (r.gapShare ?? 0) > POOR.gap || !r.tris || !r.tris.length;
  const mainSlope = planes.length ? planes.slice().sort((a, b) => (b.areaM2 || 0) - (a.areaM2 || 0))[0].slopeDeg : null;
  const form = r.form;
  const house = { id, fid: Number(hid[1]), part: hid[2] === undefined ? 0 : Number(hid[2]) + 1, X0, Z0, ring, rows: live, top: r.topHeight, avgH, mainSlope, form, fit: 0, polys: [], eave: null, meta: m };
  if (form === 'flat' || (r.nPlanes === 1 && (planes[0]?.slopeDeg ?? 90) < 6)) { house.fit = 2; stats.flat++; } // flat by the lidar: the walls go up to the roof top and the cap stays the roof
  else if (!poor) {
    const slim = slimRoof(r);
    // (a jagged roof, split into more than MAX_FACETS pieces under a canopy, is cleaner as the planner's hip on the lidar's heights)
    if (slim && slim.polys.length && slim.polys.length <= MAX_FACETS) { house.fit = 1; house.slim = slim; stats.lidar++; }
    else { house.fit = 0; if (slim && slim.polys.length > MAX_FACETS) stats.jagged++; else stats.noRoof++; stats.planner++; }
  } else { house.fit = 0; stats.planner++; }
  // era and style (derived codes only)
  const y = Number(m.year);
  let era;
  if (Number.isFinite(y) && y > 1700) { era = eraOfYear(y); stats.withYear++; } else { era = guessEra({ mainSlope, form }, id); stats.guessedEra++; }
  house.era = era; house.style = styleOf(era, { form, mainSlope }, m);
  stats.eras[ERA_NAMES[era]] = (stats.eras[ERA_NAMES[era]] || 0) + 1; stats.styles[STYLE_NAMES[house.style] || house.style] = (stats.styles[STYLE_NAMES[house.style] || house.style] || 0) + 1;
  houses.push(house);
}
stats.houses = houses.length;

// ---- eave, gables and the wall classification -------------------------------------------------------------------------------------
const inFace = (poly2, e, n) => inRing(e, n, poly2);
for (const h of houses) {
  const ringW = h.ring; // world
  // roof height at a world point (the facet whose outline holds it), or null
  const loc = (x, z) => { // world -> local e, n (the inverse of off)
    const dx = x - h.X0, dz = z - h.Z0; return [dx * C - dz * S, -(dx * S + dz * C)];
  };
  let sampler = null;
  if (h.fit === 1) {
    const faces = h.slim.polys.map((pl) => ({ pl, flat: pl.ring.map(([e, n]) => [e, n]) }));
    sampler = (x, z) => { const [e, n] = loc(x, z); let z0 = null; for (const f of faces) if (inFace(f.flat, e, n)) { const zz = planeZ(f.pl.plane, e, n); if (z0 === null || zz > z0) z0 = zz; } return z0; };
  }
  // heights along the outline, 0.4 m apart, a little inside it
  const samples = []; // per edge: [[s, z]...]
  let all = [];
  for (let i = 0; i < ringW.length; i++) {
    const a = ringW[i], b = ringW[(i + 1) % ringW.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = (b[1] - a[1]) / (L || 1), nz = -(b[0] - a[0]) / (L || 1);
    const prof = [];
    const steps = Math.max(1, Math.ceil(L / 0.4));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps, px = a[0] + (b[0] - a[0]) * t - nx * 0.25, pz = a[1] + (b[1] - a[1]) * t - nz * 0.25;
      const z = sampler ? sampler(px, pz) : null;
      prof.push([t * L, z]);
    }
    samples.push(prof);
    for (const [, z] of prof) if (z !== null) all.push([z, L / steps]);
  }
  if (h.fit === 1 && all.length) {
    all.sort((p, q) => p[0] - q[0]);
    const tot = all.reduce((s, p) => s + p[1], 0); let acc = 0, ev = all[0][0];
    for (const p of all) { acc += p[1]; if (acc >= EAVE_PERCENTILE * tot) { ev = p[0]; break; } }
    h.eave = Math.max(MIN_EAVE, Math.min(ev, h.top - 0.3));
  } else if (h.fit === 2) h.eave = Math.max(MIN_EAVE, h.top);
  else h.eave = null;
  if (h.fit === 1 && h.eave === null) { h.fit = 0; h.slim = null; stats.lidar--; stats.planner++; stats.noRoof++; } // (no height found along the outline: the planner)
  // the gable walls above the eave: per edge, a polyline of the roof's height, trapezoids between its corners
  h.gables = [];
  if (h.fit === 1) {
    for (let i = 0; i < ringW.length; i++) {
      const a = ringW[i], b = ringW[(i + 1) % ringW.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const raw = samples[i].map(([, z]) => (z === null ? h.eave : Math.min(z, h.top)));
      // (a running median over five samples, 1.6 m: a single sample in the next facet over a corner is not a gable)
      const med5 = raw.map((_, j) => { const w = raw.slice(Math.max(0, j - 2), j + 3).sort((a, b) => a - b); return Math.min(w[w.length >> 1], h.eave + GABLE_MAX); });
      const prof = samples[i].map(([s], j) => [s, med5[j] <= h.eave + GABLE_MIN ? h.eave : med5[j]]);
      if (prof.every(([, z]) => z <= h.eave + 0.01)) continue;
      const kk = dpOpen(prof.map(([s, z]) => [s, z]), GABLE_TOL);
      const pts = prof.filter((_, j) => kk[j]);
      for (let j = 0; j + 1 < pts.length; j++) {
        const [s0, z0] = pts[j], [s1, z1] = pts[j + 1];
        if (z0 <= h.eave + 0.05 && z1 <= h.eave + 0.05) continue;
        if ((s1 - s0) * (Math.max(z0, z1) - h.eave) / 2 < 0.4) continue; // a sliver
        const A = [a[0] + (b[0] - a[0]) * (s0 / L), a[1] + (b[1] - a[1]) * (s0 / L)], B = [a[0] + (b[0] - a[0]) * (s1 / L), a[1] + (b[1] - a[1]) * (s1 / L)];
        // the ring is counter-clockwise, so the outward normal of A -> B is (dz, -dx); these windings give that normal (the loader trusts them)
        const quad = z0 <= h.eave + 0.05 ? [[A[0], A[1], h.eave], [B[0], B[1], z1], [B[0], B[1], h.eave]] : z1 <= h.eave + 0.05 ? [[A[0], A[1], h.eave], [A[0], A[1], z0], [B[0], B[1], h.eave]]
          : [[A[0], A[1], h.eave], [A[0], A[1], z0], [B[0], B[1], z1], [B[0], B[1], h.eave]];
        h.gables.push(quad);
      }
    }
  }
}

// ---- party, hidden and street edges (tools/build-massing.mjs's rules, over these houses and the drawn rows' neighbours) --------------
const CELL = 25, PARTY_PROBE = 0.35;
const key = (i, j) => i * 100000 + j;
const cgrid = new Map();
for (const h of houses) {
  h.x0 = Math.min(...h.ring.map((p) => p[0])); h.x1 = Math.max(...h.ring.map((p) => p[0])); h.z0 = Math.min(...h.ring.map((p) => p[1])); h.z1 = Math.max(...h.ring.map((p) => p[1]));
  h.hh = h.top; // (a neighbour's roof height: the lidar top)
  for (let i = Math.floor(h.x0 / CELL); i <= Math.floor(h.x1 / CELL); i++) for (let j = Math.floor(h.z0 / CELL); j <= Math.floor(h.z1 / CELL); j++) (cgrid.get(key(i, j)) || cgrid.set(key(i, j), []).get(key(i, j))).push(h);
}
const near = (x, z) => cgrid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) || [];
for (const r of houses) {
  const outer = r.ring;
  r.party = []; r.hidden = []; r.street = [];
  for (let i = 0; i < outer.length; i++) {
    const [ax, az] = outer[i], [bx, bz] = outer[(i + 1) % outer.length], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    if (L < 0.5) continue;
    const nx = dz / L, nz = -dx / L;
    let covered = Infinity;
    for (const t of [0.15, 0.5, 0.85]) {
      const px = ax + dx * t + nx * PARTY_PROBE, pz = az + dz * t + nz * PARTY_PROBE; let roof = 0;
      for (const q of near(px, pz)) { if (q === r || px < q.x0 || px > q.x1 || pz < q.z0 || pz > q.z1) continue; if (inRing(px, pz, q.ring)) roof = Math.max(roof, q.hh); }
      covered = Math.min(covered, roof); if (!covered) break;
    }
    if (covered > 0) r.party.push([i, Math.round(covered * 10) / 10]);
    let hidden = !(covered > 0);
    for (const t of [0.15, 0.5, 0.85]) {
      if (!hidden) break;
      const px = ax + dx * t - nx * PARTY_PROBE, pz = az + dz * t - nz * PARTY_PROBE;
      const cover = near(px, pz).some((q) => q !== r && (q.hh > r.hh + 0.05 || (Math.abs(q.hh - r.hh) <= 0.05 && q.fid < r.fid)) && px >= q.x0 && px <= q.x1 && pz >= q.z0 && pz <= q.z1 && inRing(px, pz, q.ring));
      if (!cover) { hidden = false; break; }
    }
    if (hidden) { r.hidden.push(i); continue; }
    if (L < 2) continue;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, road = nearestRoads(mx, mz, 40)[0];
    if (!road) continue;
    const tx = road.px - mx, tz = road.pz - mz, d = Math.hypot(tx, tz);
    if (d > 0.5 && (tx * nx + tz * nz) / d > 0.7 && d - (road.road.w || 0) / 2 < 15) r.street.push(i * 2 + ((road.road.w || 0) >= 9 ? 1 : 0));
  }
}

// ---- write -------------------------------------------------------------------------------------------------------------------------------
houses.sort((a, b) => a.rows[0] - b.rows[0]);
const dm = (v) => Math.round(v * GRID);
const polysOf = (h) => {
  const out = [];
  if (h.fit === 1) for (const pl of h.slim.polys) {
    // a world ring (x, z, y above ground), wound counter-clockwise seen from above in (x, z) with z down the page (as the outlines)
    const ringW = pl.ring.map(([e, n, u]) => { const [dx, dz] = off(e, n); return [h.X0 + dx, h.Z0 + dz, u]; });
    out.push({ kind: 0, v: ringW });
  }
  for (const q of h.gables) out.push({ kind: 1, v: q.map(([x, z, y]) => [x, z, y]) });
  return out;
};
const cols = { fid: [], part: [], row: [], extraN: [], extraRow: [], corners: [], start: [], step: [], partyN: [], partyEdge: [], partyCover: [], hiddenN: [], hiddenEdge: [], streetN: [], streetEdge: [],
  eave: [], maxH: [], avgH: [], era: [], style: [], fit: [], lotW: [], park: [], chimN: [], chimX: [], chimZ: [], chimTop: [], chimBase: [], chimW: [], canopy: [], hedN: [], hedP: [], hedW: [], hedH: [], hedX: [], hedZ: [], shrN: [], shrX: [], shrZ: [], shrR: [], shrH: [], polyN: [], polyKind: [], polyVerts: [], vx: [], vz: [], vy: [] };
let prevRow = 0;
const allRows = [];
for (const h of houses) {
  cols.fid.push(h.fid); cols.part.push(h.part);
  cols.row.push(h.rows[0] - prevRow); prevRow = h.rows[0];
  cols.extraN.push(h.rows.length - 1); for (const x of h.rows.slice(1)) cols.extraRow.push(x);
  allRows.push(...h.rows);
  cols.corners.push(h.ring.length); cols.start.push(dm(h.ring[0][0]), dm(h.ring[0][1]));
  for (let k = 1; k < h.ring.length; k++) cols.step.push(dm(h.ring[k][0]) - dm(h.ring[k - 1][0]), dm(h.ring[k][1]) - dm(h.ring[k - 1][1]));
  cols.partyN.push(h.party.length); for (const [e, c] of h.party) { cols.partyEdge.push(e); cols.partyCover.push(dm(c)); }
  cols.hiddenN.push(h.hidden.length); cols.hiddenEdge.push(...h.hidden);
  cols.streetN.push(h.street.length); cols.streetEdge.push(...h.street);
  cols.eave.push(h.eave === null ? 0 : dm(h.eave)); cols.maxH.push(dm(h.top)); cols.avgH.push(dm(h.avgH)); cols.era.push(h.era); cols.style.push(h.style); cols.fit.push(h.fit);
  const stacks = chimneys[h.id] || [];
  cols.chimN.push(stacks.length);
  for (const [e, n, top, base, size] of stacks) { const [dx, dz] = off(e, n); cols.chimX.push(dm(h.X0 + dx)); cols.chimZ.push(dm(h.Z0 + dz)); cols.chimTop.push(dm(top)); cols.chimBase.push(dm(base)); cols.chimW.push(dm(size)); }
  stats.chimneys = (stats.chimneys || 0) + stacks.length; if (stacks.length) stats.housesWithChimneys = (stats.housesWithChimneys || 0) + 1;
  const yv = yardVeg[h.id];
  cols.canopy.push(yv && yv.canopy != null ? Math.round(yv.canopy * 100) : 255);
  const hedges = yv && yv.hedges || [], shrubs = yv && yv.shrubs || [];
  cols.hedN.push(hedges.length);
  for (const [w, hh, ...pts] of hedges) {
    cols.hedP.push(pts.length / 2); cols.hedW.push(dm(w)); cols.hedH.push(dm(hh));
    for (let i = 0; i < pts.length; i += 2) { const [dx, dz] = off(pts[i], pts[i + 1]); cols.hedX.push(dm(h.X0 + dx)); cols.hedZ.push(dm(h.Z0 + dz)); }
    stats.hedgeMetres = (stats.hedgeMetres || 0) + Math.round(pts.reduce((s, v, i) => (i >= 2 && i % 2 === 0 ? s + Math.hypot(v - pts[i - 2], pts[i + 1] - pts[i - 1]) : s), 0));
  }
  cols.shrN.push(shrubs.length);
  for (const [x, y, rx, ry, , hh] of shrubs) { const [dx, dz] = off(x, y); cols.shrX.push(dm(h.X0 + dx)); cols.shrZ.push(dm(h.Z0 + dz)); cols.shrR.push(dm(Math.sqrt(rx * ry))); cols.shrH.push(dm(hh)); }
  stats.hedges = (stats.hedges || 0) + hedges.length; stats.shrubs = (stats.shrubs || 0) + shrubs.length; if (hedges.length) stats.housesWithHedges = (stats.housesWithHedges || 0) + 1;
  const lot = lots[h.id]; cols.lotW.push(lot && Number.isFinite(lot.lotShort) ? dm(Math.min(lot.lotShort, 60)) : 0); cols.park.push(lot && lot.frontYardParking ? (PARKING[lot.frontYardParking] || 1) : 0);
  const ps = polysOf(h); cols.polyN.push(ps.length);
  for (const p of ps) { cols.polyKind.push(p.kind); cols.polyVerts.push(p.v.length); for (const [x, z, y] of p.v) { cols.vx.push(dm(x)); cols.vz.push(dm(z)); cols.vy.push(dm(y)); } if (p.kind === 0) stats.roofTris += p.v.length - 2; else stats.gableTris += p.v.length - 2; }
  stats.polys += ps.length;
}
stats.rowsTotal = allRows.length;
const geodata = createHash('sha256').update(geoFile).digest('hex').slice(0, 16);
const layer = { schema: ROSEDALE_HOUSES_SCHEMA, dataset: 'rosedale-roofs/1', geodata, houses: houses.length, check: rowsCheck(GEO.buildings, allRows), grid: GRID, ...cols };
const packed = packGeo({ ROSEDALE_HOUSES: layer });
fs.writeFileSync(OUT, packed.file);
const hash = createHash('sha256').update(packed.file).digest('hex').slice(0, 12);
const page = path.join(ROOT, 'js/rosedale-houses.js');
const js = fs.readFileSync(page, 'utf8');
const next = js.replace(/(\.\/data\/frames\/eglinton\/rosedale-houses\.bin\?v=)[0-9a-f]*/, `$1${hash}`);
if (next === js && !js.includes(hash)) throw new Error('js/rosedale-houses.js: no ./data/frames/eglinton/rosedale-houses.bin?v= to set');
if (next !== js) fs.writeFileSync(page, next);
stats.bytesGzip = packed.file.length; stats.bytesRaw = packed.raw.length;
stats.roofTrisPerHouse = +(stats.roofTris / Math.max(1, stats.lidar)).toFixed(1); stats.gableTrisPerHouse = +(stats.gableTris / Math.max(1, stats.lidar)).toFixed(1);
console.log(`rosedale-houses: ${houses.length} houses, ${packed.file.length} bytes gzip -> ${path.relative(ROOT, OUT)} (v=${hash})`);
console.log(JSON.stringify(stats));
if (statsOut) fs.writeFileSync(statsOut, JSON.stringify(stats, null, 1));
