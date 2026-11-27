// tools/build-rosedale-heights.mjs (jf-boq, docs/rosedale-spike.md phase 0): the lidar height of every Rosedale-Moore Park box,
// in a file of its own, data/frames/eglinton/rosedale-heights.bin (read by js/rosedale-heights.js).
//
// Why: the City's MAX_HEIGHT includes tree canopy, so half of Rosedale's houses stand as flat boxes a median 8.1 m too tall. The
// 2023 lidar roofs (rosedale-roofs/1 in the shared Toronto data repo, roofs.json) give each house's real roof top and eave.
//
// usage: node tools/build-rosedale-heights.mjs <roofs.json> [--stats <stats.json>]
//   roofs.json: toronto-data build/rosedale-houses/fit_houses.py's output (per City 3D Massing id: status, the footprint centre
//     lon/lat, the outline's edges with the roof height along each, topHeight, houseScale), written by finalize.py to
//     ~/.cache/toronto-data/derived/rosedale-roofs/1/roofs.json
// Each fitted house is matched to the bigger map's box rows whose centre lies inside its outline (the prototype's rule, js on
// branch rosedale-prototype). The rows the default page already draws from outlines (the downtown frame's massing sidecar) are
// left as they are. Per row, the new box height is
//   - a flat box (roof 0): the lidar roof top,
//   - a pitched or sheet-roofed box (roof 1, 2): the lidar eave (the game puts its own hip on top of the walls),
// never below 2.5 m. A row the lidar would raise keeps the City's height unless it is a house, and a house rises at most 4 m: a
// part stood on a podium sees the tower above it in its footprint. A row two outlines claim takes the taller answer.
// File: the TGB1 container (tools/geo-pack.mjs), one layer ROSEDALE_HEIGHTS { schema, dataset, geodata, rows, rowDelta, dm,
// check }: rowDelta is the ascending rows delta coded, dm the new heights in decimetres, check the FNV-1a of each row's index,
// centre and City height (js/rosedale-heights.js refuses the file for any other geodata).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { unpackGeo } from '../js/geodata-loader.js';
import { massingRows } from '../js/massing-data.js';
import { rosedaleCheck, ROSEDALE_HEIGHTS_SCHEMA } from '../js/rosedale-heights.js';
import { packGeo } from './geo-pack.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(ROOT, 'data/frames/eglinton/rosedale-heights.bin');
const args = process.argv.slice(2);
const roofsFile = args.find((a) => !a.startsWith('--'));
if (!roofsFile) { console.error('usage: node tools/build-rosedale-heights.mjs <roofs.json> [--stats out.json]'); process.exit(2); }
const statsOut = args.includes('--stats') ? args[args.indexOf('--stats') + 1] : null;

const MIN_H = 2.5, MAX_RAISE_HOUSE = 4;
const roofs = JSON.parse(fs.readFileSync(roofsFile, 'utf8'));
const geoFile = fs.readFileSync(path.join(ROOT, 'data/frames/eglinton/toronto-geodata.bin'));
const { GEO } = await unpackGeo(geoFile);
const { MASSING } = await unpackGeo(fs.readFileSync(path.join(ROOT, 'data/toronto-massing.bin')));
const drawn = massingRows(MASSING, GEO);
if (drawn.error) throw new Error(`the massing sidecar does not match the Eglinton map's geodata: ${drawn.error}`);

const P = GEO.frame.projection;
const toWorld = (lon, lat) => {
  const e = (lon - P.lon0) * P.kx, n = (lat - P.lat0) * P.ky, c = Math.cos(P.theta), s = Math.sin(P.theta);
  return [e * c - n * s - P.ox, -(e * s + n * c) - P.oz];
};
const C = Math.cos(P.theta), S = Math.sin(P.theta);
const off = (e, n) => [e * C - n * S, -(e * S + n * C)]; // a local east/north offset in metres -> a world dx, dz

const grid = new Map(); // box rows on a 20 m grid
GEO.buildings.forEach((b, row) => { const k = `${Math.floor(b[0] / 20)}_${Math.floor(b[1] / 20)}`; (grid.get(k) || grid.set(k, []).get(k)).push(row); });
const inside = (ring, x, z) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
const rowsIn = (ring) => {
  const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]), out = [];
  for (let gx = Math.floor((Math.min(...xs) - 1) / 20); gx <= Math.floor((Math.max(...xs) + 1) / 20); gx++) {
    for (let gz = Math.floor((Math.min(...zs) - 1) / 20); gz <= Math.floor((Math.max(...zs) + 1) / 20); gz++) {
      for (const row of grid.get(`${gx}_${gz}`) || []) { const b = GEO.buildings[row]; if (inside(ring, b[0], b[1])) out.push(row); }
    }
  }
  return out;
};
/** the eave: the 30th percentile, by length, of the roof's height along the outline (a gable's ends reach the ridge, its sides do not) */
function eaveOf(walls) {
  const pts = [];
  for (const e of walls) for (let i = 0; i + 1 < e.prof.length; i++) pts.push([(e.prof[i][1] + e.prof[i + 1][1]) / 2, Math.max(e.prof[i + 1][0] - e.prof[i][0], 0.01)]);
  if (!pts.length) return null;
  pts.sort((a, b) => a[0] - b[0]);
  const tot = pts.reduce((s, p) => s + p[1], 0);
  let acc = 0;
  for (const p of pts) { acc += p[1]; if (acc >= 0.3 * tot) return p[0]; }
  return pts[pts.length - 1][0];
}

const stats = { parts: 0, fitted: 0, noRow: 0, drawnSkipped: 0, rows: 0, flatRows: 0, pitchedRows: 0, lowered: 0, raised: 0, unchanged: 0, keptTaller: 0 };
const result = new Map(); // row -> { h, was, house }
for (const r of Object.values(roofs)) {
  stats.parts++;
  if (r.status !== 'ok' || !r.walls || !r.walls.length) continue;
  stats.fitted++;
  const [X0, Z0] = toWorld(r.lon, r.lat);
  const ring = r.walls.map((e) => { const [dx, dz] = off(e.a[0], e.a[1]); return [X0 + dx, Z0 + dz]; });
  const rows = rowsIn(ring);
  if (!rows.length) { stats.noRow++; continue; }
  const eave = eaveOf(r.walls);
  for (const row of rows) {
    if (drawn.rows.has(row)) { stats.drawnSkipped++; continue; }
    const b = GEO.buildings[row], was = b[4], pitched = b[6] !== 0 && b[5] !== 3;
    let h = pitched ? Math.min(eave ?? r.topHeight, r.topHeight) : r.topHeight;
    h = Math.max(MIN_H, h);
    if (h > was) { if (!r.houseScale) h = was; else h = Math.min(h, was + MAX_RAISE_HOUSE); }
    h = Math.round(h * 10) / 10;
    const prev = result.get(row);
    if (prev && prev.h >= h) { stats.keptTaller++; continue; }
    result.set(row, { h, was, pitched, house: !!r.houseScale });
  }
}
const rows = [...result.keys()].sort((a, b) => a - b);
for (const row of rows) {
  const v = result.get(row);
  stats.rows++;
  if (v.pitched) stats.pitchedRows++; else stats.flatRows++;
  if (v.h < v.was - 0.05) stats.lowered++; else if (v.h > v.was + 0.05) stats.raised++; else stats.unchanged++;
}
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(p * (s.length - 1))] : null; };
const houses = rows.filter((r) => result.get(r).house).map((r) => result.get(r));
const flatHouses = houses.filter((v) => !v.pitched);
stats.houseRows = houses.length;
stats.flatHouseRows = flatHouses.length;
stats.flatHouseMedianChangeM = flatHouses.length ? Math.round(q(flatHouses.map((v) => v.h - v.was), 0.5) * 10) / 10 : null;
stats.allMedianChangeM = Math.round(q(rows.map((r) => result.get(r).h - result.get(r).was), 0.5) * 10) / 10;
stats.medianBefore = q(rows.map((r) => result.get(r).was), 0.5);
stats.medianAfter = q(rows.map((r) => result.get(r).h), 0.5);

const geodata = createHash('sha256').update(geoFile).digest('hex').slice(0, 16);
const layer = {
  schema: ROSEDALE_HEIGHTS_SCHEMA, dataset: 'rosedale-roofs/1', geodata,
  rows: rows.length,
  rowDelta: rows.map((r, i) => r - (i ? rows[i - 1] : 0)),
  dm: rows.map((r) => Math.round(result.get(r).h * 10)),
  check: rosedaleCheck(GEO.buildings, rows)
};
const packed = packGeo({ ROSEDALE_HEIGHTS: layer });
fs.writeFileSync(OUT, packed.file);
const hash = createHash('sha256').update(packed.file).digest('hex').slice(0, 12);
const page = path.join(ROOT, 'js/rosedale-heights.js');
const js = fs.readFileSync(page, 'utf8');
const next = js.replace(/(\.\/data\/frames\/eglinton\/rosedale-heights\.bin\?v=)[0-9a-f]*/, `$1${hash}`);
if (next === js && !js.includes(hash)) throw new Error('js/rosedale-heights.js: no ./data/frames/eglinton/rosedale-heights.bin?v= to set');
if (next !== js) fs.writeFileSync(page, next);
console.log(`rosedale-heights: ${rows.length} rows, ${packed.file.length} bytes gzip -> ${path.relative(ROOT, OUT)} (v=${hash})`);
console.log(JSON.stringify(stats));
if (statsOut) fs.writeFileSync(statsOut, JSON.stringify(stats, null, 1));
