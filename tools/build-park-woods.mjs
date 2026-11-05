// tools/build-park-woods.mjs → js/<park>-woods-data.js (docs/high-park-woods.md, docs/toronto-island-woods.md)
// A wooded park's trees from the province's lidar: every crown 5 m or taller standing on the park's islands, where it
// stands, how tall and how wide, from the Ontario Elevation Mapping Program's GTA 2023 lidar, the Digital Surface Model
// (first return) over the Digital Terrain Model (bare earth), both 0.5 m (`node tools/fetch-don-valley-dtm.mjs --region
// <park>` and the same with `--product dsm`, into DON_VALLEY_DTM, default ~/.cache/slop-toronto/raw/ontario-dtm-gta2023).
// They replace the trees street-details.js invents on the park's islands (an 18 m grid, capped at 700 an island); the
// City's own inventory trees stay, each standing for the crown it stands under. Each park is an entry in PARKS
// (tools/park-woods-parks.mjs): its islands' names, its box, its tiles, how its relief is read and its species' shares.
//
//   canopy height  = DSM - DTM, the highest of the four 0.5 m pixels in each 1 m cell, on the park's islands, off its
//                    ponds, buildings, courts, rinks and pitches, and 1 m in from its kerbs
//   crowns         = the local maxima of the canopy (smoothed over ~1 m) in a window growing with the height (a tree's
//                    crown is wider the taller it is), 5 m or taller
//   width          = where the canopy falls under 60% of the top, the mean over 8 directions, and no more than 0.8 of
//                    the way to the nearest other top (0.8)
//   woods          = a crown in closed canopy (60% or more of the ground within 12 m under canopy 5 m or taller); the
//                    rest stand in the open (High Park's black oak savanna, the lawns)
//   ravine         = woods on a slope steeper than 25% or under the street level (High Park's Spring Creek, Wendigo
//                    and western ravines, the slope down to Grenadier Pond)
//   model          = one of the EZ-Tree models by habitat, in the park's own shares, and by height
// Usage: node tools/build-park-woods.mjs --park <high-park|toronto-island> [--out <file.js>]
// (High Park's: node tools/build-high-park-woods.mjs [--out js/high-park-woods-data.js], the same)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadCity, openDtm } from './terrain-pilot-lib.mjs';
import { PARKS } from './park-woods-parks.mjs';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const P = PARKS[arg('--park') || process.env.PARK_WOODS || 'high-park'];
if (!P) throw new Error(`--park: one of ${Object.keys(PARKS).join(', ')}`);
const OUT = arg('--out') || path.join(ROOT, P.out);
const C = loadCity(['js/toronto-tennis.js', 'js/toronto-rinks.js', ...P.scripts]);
const BOX = P.box(C);
const NN_SHARE = 0.8, CANOPY_CELL = 4, PILE_MIN = 3;
const MIN_H = 5, CITY_TREE_M = 4, WOODS_COVER = 0.6, COVER_R = 12, KERB_IN = 1;
const dtm = openDtm(C, BOX, P.manifests.dtm, { allowMissing: !!P.lake }), dsm = openDtm(C, BOX, P.manifests.dsm, { allowMissing: !!P.lake });
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
const islands = new Set(C.BLOCKS.filter((b) => P.parkNames.includes(b.parkName) && b.cx > BOX.x0 && b.cx < BOX.x1 && b.cz > BOX.z0 && b.cz < BOX.z1).map((b) => b.id));
const ground = new Uint8Array(N);
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const b = C.blockAt(xOf(i), zOf(j)); if (b && islands.has(b.id)) ground[j * W + i] = 1; }
const island = Uint8Array.from(ground);
for (let k = 0; k < KERB_IN; k++) { // (erode by a cell)
  const src = Uint8Array.from(ground);
  for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) { const q = j * W + i; if (src[q] && (!src[q - 1] || !src[q + 1] || !src[q - W] || !src[q + W])) ground[q] = 0; }
}
const off = new Uint8Array(N);
const polyArea = (flat) => { let a = 0; for (let i = 0, j = flat.length - 2; i < flat.length; j = i, i += 2) a += flat[j] * flat[i + 1] - flat[i] * flat[j + 1]; return Math.abs(a) / 2; };
const ringPts = (flat) => { const p = []; for (let i = 0; i < flat.length; i += 2) p.push([flat[i], flat[i + 1]]); return p; };
const inBoxPts = (pts) => pts.some(([x, z]) => x > BOX.x0 - 50 && x < BOX.x1 + 50 && z > BOX.z0 - 50 && z < BOX.z1 + 50);
const skipped = { ponds: 0, pads: 0, buildings: 0 };
for (const [kind, , flat] of C.GEO.areas) {
  if (kind !== 'water' && kind !== 'pitch') continue;
  const pts = ringPts(flat);
  if (!inBoxPts(pts)) continue;
  // (beside the open lake, Lake Ontario's own outline: the city data keeps no holes, so it holds the park's islands)
  if (P.lake && kind === 'water' && polyArea(flat) > (BOX.x1 - BOX.x0) * (BOX.z1 - BOX.z0)) continue;
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
const crowns = [], MAST_H = 30, MAST_R = 2.5;
let masts = 0, clumped = 0, split = 0;
// (st-w050: the woods had read as orchard rows. Each top had stood on its 1 m cell's centre, on a grid square to the
// world's axes, and a top had to be the highest in its whole window, so no two stood nearer than the window: a hard
// core that spaced closed canopy evenly. Now a top is placed between the cells by the canopy's own curvature (a
// parabola through it and its neighbours each way), and a second top inside a taller one's window counts when the
// canopy dips between them by CLUMP_DIP (a crown of its own: a clump, two stems, a tree under a taller one's edge))
const CLUMP_DIP = 0.12, CLUMP_DIP_MIN = 1.5, SADDLE_RISE = 0.5, CLUMP_LONG = 12, CLUMP_SPLIT = 2.5, CLUMP_CLEAR = 2.5;
const sub = (a, c, b) => { const den = a - 2 * c + b; return den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - b)) / den)) : 0; };
for (let j = 6; j < H - 6; j++) for (let i = 6; i < W - 6; i++) {
  const k = j * W + i, h = sm[k];
  if (h < MIN_H || !ground[k] || off[k]) continue;
  const r = Math.max(2, Math.min(6, Math.round(1.2 + 0.11 * h))), ri = Math.max(2, Math.round(r / 2));
  // (the highest canopy in the window beyond the inner one, if higher: the taller crown this one may stand beside)
  let top = true, bi = 0, bj = 0, bv = -1;
  for (let dj = -r; dj <= r && top; dj++) for (let di = -r; di <= r; di++) {
    const d2 = di * di + dj * dj;
    if (d2 > r * r || !d2) continue;
    const v = sm[(j + dj) * W + i + di];
    if (v > h || (v === h && (dj < 0 || (dj === 0 && di < 0)))) {
      if (d2 <= ri * ri) { top = false; break; }
      if (v > bv) { bv = v; bi = di; bj = dj; }
    }
  }
  if (!top) continue;
  if (bv >= 0) {
    // (its own crown only if the canopy between them falls CLUMP_DIP of its height, CLUMP_DIP_MIN m at least)
    let low = h;
    const n = Math.ceil(Math.hypot(bi, bj) * 2);
    for (let s = 1; s < n; s++) low = Math.min(low, sm[Math.round(j + (bj * s) / n) * W + Math.round(i + (bi * s) / n)]);
    if (h - low < Math.max(CLUMP_DIP_MIN, CLUMP_DIP * h)) continue;
    clumped++;
  }
  // (the crown's edge each of 8 ways: where the canopy falls under 60% of the top, or the saddle where it starts to rise
  // again towards a neighbour's top: in closed canopy it never falls to 60%, and the edge is the saddle)
  let rs = 0;
  const ext = [];
  for (let a = 0; a < 8; a++) {
    const ca = Math.cos((a * Math.PI) / 4), sa = Math.sin((a * Math.PI) / 4);
    let d = 1, low = h, dl = 1;
    for (; d < 11; d++) {
      const ii = Math.round(i + ca * d), jj = Math.round(j + sa * d);
      if (ii < 0 || jj < 0 || ii >= W || jj >= H) break;
      const v = sm[jj * W + ii];
      if (v < h * 0.6) break;
      if (v < low) { low = v; dl = d; } else if (v > low + SADDLE_RISE) { d = dl; break; }
    }
    rs += d; ext.push(d);
  }
  // (a top over 30 m and no wider than 2.5 m is a mast or a light standard, not a tree: Toronto Island's)
  if (Math.max(chm[k], h) > MAST_H && rs / 8 <= MAST_R) { masts++; continue; }
  const fx = sub(sm[k - 1], h, sm[k + 1]), fz = sub(sm[k - W], h, sm[k + W]);
  // (a crown twice as long one way as across, with no saddle along it, is two crowns the smoothed canopy has merged into
  // one dome: a clump. The top keeps its tree; a second stands on the long side, at the canopy's own height there)
  let la = 0;
  for (let a = 1; a < 4; a++) if (ext[a] + ext[a + 4] > ext[la] + ext[la + 4]) la = a;
  const long = ext[la] + ext[la + 4], short = Math.min(...[0, 1, 2, 3].map((a) => ext[a] + ext[a + 4]));
  if (long >= CLUMP_LONG && long >= CLUMP_SPLIT * short) {
    // (towards the long side, turned towards the longer of its neighbouring ways: the dome's own axis, not the 8 ways')
    const side = ext[la] >= ext[la + 4] ? la : la + 4, e = (q) => ext[(q + 8) % 8];
    const ang = ((side + (e(side + 1) - e(side - 1)) / (e(side - 1) + e(side) + e(side + 1))) * Math.PI) / 4, d2 = 0.6 * ext[side];
    const x2 = xOf(i) + fx + Math.cos(ang) * d2, z2 = zOf(j) + fz + Math.sin(ang) * d2;
    const i2 = Math.floor(x2 - BOX.x0), j2 = Math.floor(z2 - BOX.z0), k2 = j2 * W + i2;
    if (ground[k2] && !off[k2] && sm[k2] >= MIN_H) {
      crowns.push({ i: i2, j: j2, x: x2, z: z2, h: sm[k2], r: Math.max(2, short / 2), cover: coverAt(i2, j2, COVER_R), clump: true });
      split++;
      rs = 4 * short;
    }
  }
  crowns.push({ i, j, x: xOf(i) + fx, z: zOf(j) + fz, h: Math.max(chm[k], h), r: Math.max(2, rs / 8), cover: coverAt(i, j, COVER_R) });
}
// (a clump's second stem only where no other top stands within CLUMP_CLEAR)
{
  const g = new Map(), gk = (x, z) => Math.floor(x / 4) * 100000 + Math.floor(z / 4);
  crowns.forEach((c, n) => { const key = gk(c.x, c.z); (g.get(key) || g.set(key, []).get(key)).push(n); });
  const drop = new Set();
  crowns.forEach((c, n) => {
    if (!c.clump) return;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const m of g.get(gk(c.x, c.z) + a * 100000 + b) || []) {
      if (m !== n && !drop.has(m) && Math.hypot(crowns[m].x - c.x, crowns[m].z - c.z) < CLUMP_CLEAR) drop.add(n);
    }
  });
  for (let n = crowns.length - 1; n >= 0; n--) if (drop.has(n)) crowns.splice(n, 1);
  split -= drop.size;
}
console.log(`[park-woods] ${clumped} tops beside a taller one, ${split} merged crowns split in two; ${masts} masts left out`);
const found = crowns.length;
// (the City's inventory has these: its record stays, with its species and trunk. Each City tree is the nearest crown
// it stands under (within CITY_TREE_M of its top, or 80% of its width) of about its height (within 40%), one crown a
// tree: its survey point and the crown's top stand metres apart, as a tree leans or spreads)
const cell = new Map(), ckey = (x, z) => Math.floor(x / 8) * 10000 + Math.floor(z / 8);
crowns.forEach((c, n) => { const key = ckey(c.x, c.z); (cell.get(key) || cell.set(key, []).get(key)).push(n); });
const taken = new Uint8Array(crowns.length), ST = C.GEO.streetTrees;
// (the inventory piles many of the park's trees on one address point: in High Park 519 at the Bloor Street gate, 151 by
// Parkside Drive... Those on the park's islands are left out at runtime but one (park-woods.js piledCityTree): the lidar has
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
// (in closed canopy the canopy never falls to 60% between two crowns: a crown reaches no further towards another top
// than its share of the way, NN_SHARE between two of a height, more for the taller (it spreads over the shorter), so
// neighbours' crowns meet and overlap a little, as the canopy does, and the crowns' sizes follow their heights)
{
  const grid = new Map(), gk = (x, z) => Math.floor(x / 12) * 10000 + Math.floor(z / 12);
  kept.forEach((c, n) => { const key = gk(c.x, c.z); (grid.get(key) || grid.set(key, []).get(key)).push(n); });
  const reach = kept.map((c, n) => {
    let d = Infinity;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const m of grid.get(gk(c.x, c.z) + a * 10000 + b) || []) {
      if (m === n) continue;
      const o = kept[m];
      d = Math.min(d, (2 * NN_SHARE * Math.hypot(o.x - c.x, o.z - c.z) * c.h) / (c.h + o.h));
    }
    return d;
  });
  kept.forEach((c, n) => { c.r = Math.max(2, Math.min(c.r, reach[n])); });
}

// --- habitat and model
// (the relief: { y: height over the street level, slope }; the park's own, P.relief)
const relief = P.relief(C, BOX, dtm);
// (a park may name a model as its own species: Toronto Island's aspens are its cottonwoods, ez-trees.js's bark for them)
const named = (m) => (P.modelNames && P.modelNames[m]) || m;
const MODELS = ['ez-oak-small', 'ez-oak-medium', 'ez-oak-large', 'ez-ash-small', 'ez-ash-medium', 'ez-ash-large', 'ez-aspen-medium', 'ez-aspen-large'];
const hash = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
// shares of oak / ash / aspen by habitat, the park's own (P.mix)
const MIX = P.mix;
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
// the ground (park-woods.js colours the park's lawn by it): 2 bits per CANOPY_CELL m cell over the box, rows along
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
  version: 1, kind: `${P.id}-woods`, box: BOX, ...(P.parkNamesInData === false ? {} : { parkNames: P.parkNames }),
  source: { dataset: 'Ontario Elevation Mapping Program, GTA 2023 lidar: Digital Surface Model (first return) over Digital Terrain Model (bare earth), 0.5 m', licence: `${dsm.manifest.licence} (${dsm.manifest.licenceUrl}); see CREDITS.md`, attribution: dsm.manifest.attribution, retrieved: dsm.manifest.retrieved,
    tiles: dsm.manifest.tiles.map((t) => ({ tile: t.tile, sha256: t.sha256 })) },
  rules: { minHeightM: MIN_H, cityTreePileMin: PILE_MIN, crownNeighbourShare: NN_SHARE, clumpDip: CLUMP_DIP, clumpDipMinM: CLUMP_DIP_MIN, saddleRiseM: SADDLE_RISE, clumpLongM: CLUMP_LONG, clumpSplit: CLUMP_SPLIT, clumpClearM: CLUMP_CLEAR, canopyCellM: CANOPY_CELL, cityTreeM: CITY_TREE_M, cityTreeCrownShare: 0.8, cityTreeHeightShare: 0.4, woodsCover: WOODS_COVER, coverRadiusM: COVER_R, kerbInM: KERB_IN, mix: MIX },
  units: 'crowns: [x, z] decimetres from the box corner, height and crown radius decimetres, code = model | 16 woods | 32 ravine; ground: 2 bits per cell (0 off the park, 1 lawn, 2 meadow, 3 canopy), rows along x from the box corner',
  models: MODELS.map(named),
  diagnostics: { groundHa: +(groundCells / 1e4).toFixed(1), canopyShare: +(canopyCells / groundCells).toFixed(3), found, cityTrees: found - kept.length, cityTreePiles: piles.length, cityTreesPiled: piles.reduce((t, p) => t + p[2], 0), crowns: kept.length, habitats: counts, models: Object.fromEntries(Object.entries(byModel).map(([m, n]) => [named(m), n])),
    heightM: { p10: q(0.1), p50: q(0.5), p90: q(0.9), max: q(1) }, radiusM: { woods: +(kept.filter((c) => c.cover >= WOODS_COVER).reduce((t, c) => t + c.r, 0) / Math.max(1, kept.filter((c) => c.cover >= WOODS_COVER).length)).toFixed(1), open: +(kept.filter((c) => c.cover < WOODS_COVER).reduce((t, c) => t + c.r, 0) / Math.max(1, kept.filter((c) => c.cover < WOODS_COVER).length)).toFixed(1) }, skipped },
  crowns: Buffer.from(flat.buffer).toString('base64'),
  cityTreePiles: piles,
  ground: { cell: CANOPY_CELL, w: CW, h: CH, ha: { lawn: +((kinds[1] * CANOPY_CELL ** 2) / 1e4).toFixed(1), meadow: +((kinds[2] * CANOPY_CELL ** 2) / 1e4).toFixed(1), canopy: +((kinds[3] * CANOPY_CELL ** 2) / 1e4).toFixed(1) }, cells: Buffer.from(cells).toString('base64') }
};
const js = `${P.header}(function () {
window.CITY = window.CITY || {};
window.CITY.${P.global} = ${JSON.stringify(data)};
})();
`;
fs.writeFileSync(OUT, js);
console.log(`[park-woods] ${P.id} ${JSON.stringify(data.diagnostics)}`);
console.log(`[park-woods] wrote ${path.relative(ROOT, OUT)} (${(js.length / 1024).toFixed(0)} KB)`);
