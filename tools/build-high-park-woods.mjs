// tools/build-high-park-woods.mjs → js/high-park-woods-data.js
// High Park's trees from the province's lidar (docs/high-park-woods.md): every crown 5 m or taller standing on the park's
// islands, where it stands, how tall and how wide, from the Ontario Elevation Mapping Program's GTA 2023 lidar, the
// Digital Surface Model (first return) over the Digital Terrain Model (bare earth), both 0.5 m (`node
// tools/fetch-don-valley-dtm.mjs --region high-park` and the same with `--product dsm`, into DON_VALLEY_DTM, default
// ~/.cache/slop-toronto/raw/ontario-dtm-gta2023). They replace the trees street-details.js invents on the park's islands
// (an 18 m grid, capped at 700 an island); the City's own inventory trees stay, each standing for the crown it stands
// under.
//
//   canopy height  = DSM - DTM, the highest of the four 0.5 m pixels in each 1 m cell, on the park's islands, off its
//                    ponds, buildings, courts, rinks and pitches, and 1 m in from its kerbs
//   crowns         = the local maxima of the canopy (smoothed over ~1 m) in a window growing with the height (a tree's
//                    crown is wider the taller it is), 5 m or taller
//   width          = where the canopy falls under 60% of the top, the mean over 8 directions, and no more than 0.8 of
//                    the way to the nearest other top (0.8)
//   woods          = a crown in closed canopy (60% or more of the ground within 12 m under canopy 5 m or taller); the
//                    rest stand in the open (the black oak savanna, the lawns)
//   ravine         = woods on a slope steeper than 25% or under the street level (the Spring Creek, Wendigo and western
//                    ravines, the slope down to Grenadier Pond)
//   model          = one of the EZ-Tree models by habitat (the City's survey: black oak in the savanna and the oak
//                    woodland; red oak, black cherry and white ash in the ravines: oak, ash for both of the others,
//                    a few aspens) and by height
// Usage: node tools/build-high-park-woods.mjs [--out js/high-park-woods-data.js]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadCity, openDtm } from './terrain-pilot-lib.mjs';

const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? process.argv[outArg + 1] : path.join(ROOT, 'js/high-park-woods-data.js');
const C = loadCity(['js/toronto-tennis.js', 'js/toronto-rinks.js', 'js/high-park-data.js']);
const HPD = C.HIGH_PARK_DATA;
const BOX = { x0: HPD.box.x0, x1: HPD.box.x1, z0: HPD.box.z0, z1: HPD.box.z1 };
const NN_SHARE = 0.8, CANOPY_CELL = 4, PILE_MIN = 3;
const MIN_H = 5, CITY_TREE_M = 4, WOODS_COVER = 0.6, COVER_R = 12, KERB_IN = 1;
const dtm = openDtm(C, BOX, 'manifest-high-park.json'), dsm = openDtm(C, BOX, 'manifest-high-park-dsm.json');
const W = BOX.x1 - BOX.x0, H = BOX.z1 - BOX.z0, N = W * H; // 1 m cells
const xOf = (i) => BOX.x0 + i + 0.5, zOf = (j) => BOX.z0 + j + 0.5;
const pointInPoly = (pts, x, z) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
function fillPoly(mask, pts, v = 1, grow = 0) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const i0 = Math.max(0, Math.floor(minX - grow - BOX.x0)), i1 = Math.min(W - 1, Math.ceil(maxX + grow - BOX.x0)), j0 = Math.max(0, Math.floor(minZ - grow - BOX.z0)), j1 = Math.min(H - 1, Math.ceil(maxZ + grow - BOX.z0));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (pointInPoly(pts, xOf(i), zOf(j))) mask[j * W + i] = v;
  if (grow > 0) dilate(mask, grow, v);
}
function dilate(mask, r, v = 1) { // (grows every cell == v by r cells, square)
  const src = Uint8Array.from(mask);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (src[j * W + i] !== v) continue;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < W && jj < H) mask[jj * W + ii] = v; }
  }
}

// --- the park's ground: its islands, less ponds, buildings, courts, rinks and pitches, 1 m in from the kerbs
const islands = new Set(C.BLOCKS.filter((b) => b.parkName === 'High Park' && b.cx > BOX.x0 && b.cx < BOX.x1 && b.cz > BOX.z0 && b.cz < BOX.z1).map((b) => b.id));
const ground = new Uint8Array(N);
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const b = C.blockAt(xOf(i), zOf(j)); if (b && islands.has(b.id)) ground[j * W + i] = 1; }
const island = Uint8Array.from(ground);
for (let k = 0; k < KERB_IN; k++) { // (erode by a cell)
  const src = Uint8Array.from(ground);
  for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) { const q = j * W + i; if (src[q] && (!src[q - 1] || !src[q + 1] || !src[q - W] || !src[q + W])) ground[q] = 0; }
}
const off = new Uint8Array(N);
const ringPts = (flat) => { const p = []; for (let i = 0; i < flat.length; i += 2) p.push([flat[i], flat[i + 1]]); return p; };
const inBoxPts = (pts) => pts.some(([x, z]) => x > BOX.x0 - 50 && x < BOX.x1 + 50 && z > BOX.z0 - 50 && z < BOX.z1 + 50);
const skipped = { ponds: 0, pads: 0, buildings: 0 };
for (const [kind, , flat] of C.GEO.areas) {
  if (kind !== 'water' && kind !== 'pitch') continue;
  const pts = ringPts(flat);
  if (!inBoxPts(pts)) continue;
  fillPoly(off, pts, 1, 1);
  skipped[kind === 'water' ? 'ponds' : 'pads']++;
}
for (const t of C.TENNIS.records) {
  const cs = Math.cos(t.yaw), sn = Math.sin(t.yaw), hu = t.width / 2 + 3, hv = t.length / 2 + 4;
  const corner = (u, v) => [t.x + u * cs + v * sn, t.z - u * sn + v * cs];
  const pts = [corner(-hu, -hv), corner(hu, -hv), corner(hu, hv), corner(-hu, hv)];
  if (inBoxPts(pts)) { fillPoly(off, pts, 1, 0); skipped.pads++; }
}
for (const r of C.RINKS.records) for (const p of r.polygons) if (inBoxPts(p.outer)) { fillPoly(off, p.outer, 1, 1); skipped.pads++; }
for (const [bx, bz, ang, parts] of C.GEO.buildings) {
  if (bx < BOX.x0 - 60 || bx > BOX.x1 + 60 || bz < BOX.z0 - 60 || bz > BOX.z1 + 60) continue;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  for (const [u0, u1, v0, v1] of parts) {
    const P = (u, v) => [bx + u * cs + v * sn, bz - u * sn + v * cs];
    fillPoly(off, [P(u0 - 1.5, v0 - 1.5), P(u1 + 1.5, v0 - 1.5), P(u1 + 1.5, v1 + 1.5), P(u0 - 1.5, v1 + 1.5)], 1, 0);
  }
  skipped.buildings++;
}

// --- the canopy: DSM - DTM, the highest of the 0.5 m pixels in each 1 m cell
const chm = new Float32Array(N);
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const x = xOf(i), z = zOf(j);
  let m = 0;
  for (const [dx, dz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
    const s = dsm.fineAt(x + dx, z + dz), t = dtm.fineAt(x + dx, z + dz);
    if (s > -100 && s < 1000 && t > -100 && t < 1000) m = Math.max(m, s - t);
  }
  chm[j * W + i] = Math.min(45, m);
}
// smoothed (a 5-tap binomial each way, ~1 m)
const sm = (() => {
  const g = [1, 4, 6, 4, 1].map((v) => v / 16), a = new Float32Array(N), b = new Float32Array(N);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { let s = 0; for (let o = -2; o <= 2; o++) s += g[o + 2] * chm[j * W + Math.min(W - 1, Math.max(0, i + o))]; a[j * W + i] = s; }
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { let s = 0; for (let o = -2; o <= 2; o++) s += g[o + 2] * a[Math.min(H - 1, Math.max(0, j + o)) * W + i]; b[j * W + i] = s; }
  return b;
})();
// cover: the share of the ground within COVER_R under canopy MIN_H or taller (a summed-area table)
const sat = new Float64Array((W + 1) * (H + 1));
for (let j = 0; j < H; j++) { let row = 0; for (let i = 0; i < W; i++) { row += chm[j * W + i] >= MIN_H ? 1 : 0; sat[(j + 1) * (W + 1) + i + 1] = sat[j * (W + 1) + i + 1] + row; } }
const coverAt = (i, j, r) => {
  const i0 = Math.max(0, i - r), i1 = Math.min(W, i + r + 1), j0 = Math.max(0, j - r), j1 = Math.min(H, j + r + 1);
  return (sat[j1 * (W + 1) + i1] - sat[j0 * (W + 1) + i1] - sat[j1 * (W + 1) + i0] + sat[j0 * (W + 1) + i0]) / ((i1 - i0) * (j1 - j0));
};

// --- the crowns
const crowns = [];
for (let j = 6; j < H - 6; j++) for (let i = 6; i < W - 6; i++) {
  const k = j * W + i, h = sm[k];
  if (h < MIN_H || !ground[k] || off[k]) continue;
  const r = Math.max(2, Math.min(6, Math.round(1.2 + 0.11 * h)));
  let top = true;
  for (let dj = -r; dj <= r && top; dj++) for (let di = -r; di <= r; di++) {
    if (di * di + dj * dj > r * r || (!di && !dj)) continue;
    const v = sm[(j + dj) * W + i + di];
    if (v > h || (v === h && (dj < 0 || (dj === 0 && di < 0)))) { top = false; break; }
  }
  if (!top) continue;
  let rs = 0;
  for (let a = 0; a < 8; a++) {
    const ca = Math.cos((a * Math.PI) / 4), sa = Math.sin((a * Math.PI) / 4);
    let d = 1;
    for (; d < 11; d++) { const ii = Math.round(i + ca * d), jj = Math.round(j + sa * d); if (ii < 0 || jj < 0 || ii >= W || jj >= H || sm[jj * W + ii] < h * 0.6) break; }
    rs += d;
  }
  crowns.push({ i, j, x: xOf(i), z: zOf(j), h: Math.max(chm[k], h), r: Math.max(2, rs / 8), cover: coverAt(i, j, COVER_R) });
}
const found = crowns.length;
// (the City's inventory has these: its record stays, with its species and trunk. Each City tree is the nearest crown
// it stands under (within CITY_TREE_M of its top, or 80% of its width) of about its height (within 40%), one crown a
// tree: its survey point and the crown's top stand metres apart, as a tree leans or spreads)
const cell = new Map(), ckey = (x, z) => Math.floor(x / 8) * 10000 + Math.floor(z / 8);
crowns.forEach((c, n) => { const key = ckey(c.x, c.z); (cell.get(key) || cell.set(key, []).get(key)).push(n); });
const taken = new Uint8Array(crowns.length), ST = C.GEO.streetTrees;
// (the inventory piles many of the park's trees on one address point: 519 at the Bloor Street gate, 151 by Parkside
// Drive... Those on the park's islands are left out at runtime but one (high-park-woods.js piledCityTree): the lidar has
// the trees themselves. A pile is PILE_MIN or more at one point, to 0.1 m)
const pileCount = new Map(), pileKey = (x, z) => `${x.toFixed(1)},${z.toFixed(1)}`;
for (let s = 0; s < ST.length; s += 4) { const x = ST[s], z = ST[s + 1]; if (x > BOX.x0 && x < BOX.x1 && z > BOX.z0 && z < BOX.z1) pileCount.set(pileKey(x, z), (pileCount.get(pileKey(x, z)) || 0) + 1); }
const piles = [...pileCount].filter(([k, n]) => { if (n < PILE_MIN) return false; const [x, z] = k.split(',').map(Number), b = C.blockAt(x, z); return b && islands.has(b.id); })
  .map(([k, n]) => [...k.split(',').map(Number), n]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
const piled = new Set(piles.map(([x, z]) => pileKey(x, z)));
for (let s = 0; s < ST.length; s += 4) {
  const x = ST[s], z = ST[s + 1];
  if (x < BOX.x0 - 10 || x > BOX.x1 + 10 || z < BOX.z0 - 10 || z > BOX.z1 + 10 || piled.has(pileKey(x, z))) continue;
  let best = -1, bd = Infinity;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const n of cell.get(ckey(x, z) + a * 10000 + b) || []) {
    const c = crowns[n], d = Math.hypot(c.x - x, c.z - z);
    if (!taken[n] && d < bd && d < Math.max(CITY_TREE_M, 0.8 * c.r) && Math.abs(ST[s + 3] / 10 - c.h) < 0.4 * c.h) { bd = d; best = n; }
  }
  if (best >= 0) taken[best] = 1;
}
const kept = crowns.filter((_, n) => !taken[n]);
// (in closed canopy the canopy never falls to 60% between two crowns: a crown is no wider than NN_SHARE of the way to
// the nearest other top, so neighbours' crowns meet and overlap a little, as the canopy does)
{
  const grid = new Map(), gk = (x, z) => Math.floor(x / 12) * 10000 + Math.floor(z / 12);
  kept.forEach((c, n) => { const key = gk(c.x, c.z); (grid.get(key) || grid.set(key, []).get(key)).push(n); });
  kept.forEach((c, n) => {
    let d = Infinity;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const m of grid.get(gk(c.x, c.z) + a * 10000 + b) || []) if (m !== n) d = Math.min(d, Math.hypot(kept[m].x - c.x, kept[m].z - c.z));
    c.r = Math.max(2, Math.min(c.r, NN_SHARE * d));
  });
}

// --- habitat and model
// (the relief before the terrain's conditioning, DTM - datum: the roads, pads and shores rules don't move a crown's habitat)
const HG = (() => { const b = Buffer.from(HPD.unconditioned, 'base64'); return new Int16Array(b.buffer, b.byteOffset, b.length / 2); })();
const S = HPD.box.step, gnx = HPD.nx, gnz = HPD.nz;
const relief = (x, z) => {
  const fc = Math.max(0, Math.min(gnx - 1.0001, (x - BOX.x0) / S)), fr = Math.max(0, Math.min(gnz - 1.0001, (z - BOX.z0) / S));
  const c = Math.floor(fc), r = Math.floor(fr), tx = fc - c, tz = fr - r, k = r * gnx + c, h = (q) => HG[q] / 100;
  const y = (h(k) * (1 - tx) + h(k + 1) * tx) * (1 - tz) + (h(k + gnx) * (1 - tx) + h(k + gnx + 1) * tx) * tz;
  const gx = ((h(k + 1) - h(k)) * (1 - tz) + (h(k + gnx + 1) - h(k + gnx)) * tz) / S, gz = ((h(k + gnx) - h(k)) * (1 - tx) + (h(k + gnx + 1) - h(k + 1)) * tx) / S;
  return { y, slope: Math.hypot(gx, gz) };
};
const MODELS = ['ez-oak-small', 'ez-oak-medium', 'ez-oak-large', 'ez-ash-small', 'ez-ash-medium', 'ez-ash-large', 'ez-aspen-medium', 'ez-aspen-large'];
const hash = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
// shares of oak / ash / aspen by habitat: oaks (black oak, red oak) above all; white ash, and with it the ravines' other
// broadleaves (black cherry: the EZ-Tree set has no cherry, and the ash's dark bark and fine crown stand in better than
// the aspen's white bark); a few aspens (trembling aspen grows in the park's woods)
const MIX = { open: [0.9, 0.08, 0.02], woods: [0.8, 0.15, 0.05], ravine: [0.55, 0.4, 0.05] };
const counts = { open: 0, woods: 0, ravine: 0 }, byModel = Object.fromEntries(MODELS.map((m) => [m, 0]));
const out = [];
for (const c of kept) {
  const { y, slope } = relief(c.x, c.z);
  const woods = c.cover >= WOODS_COVER;
  const hab = !woods ? 'open' : slope > 0.25 || y < 0 ? 'ravine' : 'woods';
  counts[hab]++;
  const u = hash(c.x, 4.4, c.z), [po, pa] = MIX[hab];
  const sp = u < po ? 'oak' : u < po + pa ? 'ash' : 'aspen';
  const size = c.h > 15 ? 'large' : c.h > 9 ? 'medium' : 'small';
  const id = `ez-${sp}-${sp === 'aspen' && size === 'small' ? 'medium' : size}`;
  byModel[id]++;
  out.push([Math.round((c.x - BOX.x0) * 10), Math.round((c.z - BOX.z0) * 10), Math.round(c.h * 10), Math.round(c.r * 10), MODELS.indexOf(id) | (woods ? 16 : 0) | (hab === 'ravine' ? 32 : 0)]);
}
out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
const flat = new Uint16Array(out.flat());
const hs = kept.map((c) => c.h).sort((a, b) => a - b), q = (p) => +hs[Math.floor(p * (hs.length - 1))].toFixed(1);
let groundCells = 0, canopyCells = 0;
for (let k = 0; k < N; k++) if (ground[k] && !off[k]) { groundCells++; if (chm[k] >= MIN_H) canopyCells++; }
// the ground (high-park-woods.js colours the park's lawn by it): 2 bits per CANOPY_CELL m cell over the box, rows along
// x from the box's corner: 0 off the park's islands, 1 lawn, 2 meadow (OpenStreetMap's wood or scrub in the open: the
// savanna, the woods' clearings), 3 canopy (half the cell's ground or more under canopy MIN_H or taller)
const natural = [];
for (const [kind, , flat] of C.GEO.areas) if ((kind === 'wood' || kind === 'scrub') && inBoxPts(ringPts(flat))) natural.push(ringPts(flat));
const CW = Math.round(W / CANOPY_CELL), CH = Math.round(H / CANOPY_CELL), cells = new Uint8Array(Math.ceil((CW * CH) / 4));
const kinds = [0, 0, 0, 0];
for (let cj = 0; cj < CH; cj++) for (let ci = 0; ci < CW; ci++) {
  let n = 0, c = 0, on = 0;
  for (let j = cj * CANOPY_CELL; j < (cj + 1) * CANOPY_CELL; j++) for (let i = ci * CANOPY_CELL; i < (ci + 1) * CANOPY_CELL; i++) {
    const k = j * W + i;
    if (island[k]) on++;
    if (!island[k] || off[k]) continue;
    n++; if (chm[k] >= MIN_H) c++;
  }
  const x = BOX.x0 + (ci + 0.5) * CANOPY_CELL, z = BOX.z0 + (cj + 0.5) * CANOPY_CELL;
  const v = on * 2 < CANOPY_CELL * CANOPY_CELL ? 0 : n && c * 2 >= CANOPY_CELL * CANOPY_CELL ? 3 : natural.some((pts) => pointInPoly(pts, x, z)) ? 2 : 1;
  const q = cj * CW + ci;
  cells[q >> 2] |= v << ((q & 3) * 2);
  kinds[v]++;
}
const data = {
  version: 1, kind: 'high-park-woods', box: BOX,
  source: { dataset: 'Ontario Elevation Mapping Program, GTA 2023 lidar: Digital Surface Model (first return) over Digital Terrain Model (bare earth), 0.5 m', licence: `${dsm.manifest.licence} (${dsm.manifest.licenceUrl}); see CREDITS.md`, attribution: dsm.manifest.attribution, retrieved: dsm.manifest.retrieved,
    tiles: dsm.manifest.tiles.map((t) => ({ tile: t.tile, sha256: t.sha256 })) },
  rules: { minHeightM: MIN_H, cityTreePileMin: PILE_MIN, crownNeighbourShare: NN_SHARE, canopyCellM: CANOPY_CELL, cityTreeM: CITY_TREE_M, cityTreeCrownShare: 0.8, cityTreeHeightShare: 0.4, woodsCover: WOODS_COVER, coverRadiusM: COVER_R, kerbInM: KERB_IN, mix: MIX },
  units: 'crowns: [x, z] decimetres from the box corner, height and crown radius decimetres, code = model | 16 woods | 32 ravine; ground: 2 bits per cell (0 off the park, 1 lawn, 2 meadow, 3 canopy), rows along x from the box corner',
  models: MODELS,
  diagnostics: { groundHa: +(groundCells / 1e4).toFixed(1), canopyShare: +(canopyCells / groundCells).toFixed(3), found, cityTrees: found - kept.length, cityTreePiles: piles.length, cityTreesPiled: piles.reduce((t, p) => t + p[2], 0), crowns: kept.length, habitats: counts, models: byModel,
    heightM: { p10: q(0.1), p50: q(0.5), p90: q(0.9), max: q(1) }, radiusM: { woods: +(kept.filter((c) => c.cover >= WOODS_COVER).reduce((t, c) => t + c.r, 0) / Math.max(1, kept.filter((c) => c.cover >= WOODS_COVER).length)).toFixed(1), open: +(kept.filter((c) => c.cover < WOODS_COVER).reduce((t, c) => t + c.r, 0) / Math.max(1, kept.filter((c) => c.cover < WOODS_COVER).length)).toFixed(1) }, skipped },
  crowns: Buffer.from(flat.buffer).toString('base64'),
  cityTreePiles: piles,
  ground: { cell: CANOPY_CELL, w: CW, h: CH, ha: { lawn: +((kinds[1] * CANOPY_CELL ** 2) / 1e4).toFixed(1), meadow: +((kinds[2] * CANOPY_CELL ** 2) / 1e4).toFixed(1), canopy: +((kinds[3] * CANOPY_CELL ** 2) / 1e4).toFixed(1) }, cells: Buffer.from(cells).toString('base64') }
};
const js = `// js/high-park-woods-data.js — GENERATED by tools/build-high-park-woods.mjs, do not edit by hand.
// High Park's trees from the Ontario GTA 2023 lidar (Open Government Licence – Ontario; docs/high-park-woods.md): each
// crown on the park's islands, where it stands, its height and width, and its habitat. Always loaded (explore.html).
(function () {
window.CITY = window.CITY || {};
window.CITY.HIGH_PARK_WOODS_DATA = ${JSON.stringify(data)};
})();
`;
fs.writeFileSync(OUT, js);
console.log(`[high-park-woods] ${JSON.stringify(data.diagnostics)}`);
console.log(`[high-park-woods] wrote ${path.relative(ROOT, OUT)} (${(js.length / 1024).toFixed(0)} KB)`);
