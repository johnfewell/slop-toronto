// tools/build-don-valley.mjs → js/don-valley-data.js
// The Don Valley terrain pilot (?donvalley=1, docs/don-valley-terrain.md): the real valley under the Prince Edward
// Viaduct, from the Ontario Elevation Mapping Program's GTA 2023 lidar DTM (bare earth, 0.5 m; tiles fetched by
// tools/fetch-don-valley-dtm.mjs into DON_VALLEY_DTM, default ~/.cache/slop-toronto/raw/ontario-dtm-gta2023), on a 10 m
// grid over a bounded box, as heights in the game's frame:
//
//   game height y = DTM elevation (m above CGVD2013) - street datum T(x, z) (m above CGVD2013)
//
// where T is the local street level: the DTM with its narrow bumps opened away and the valley closed over (the lowest
// tableland within 400 m either side), smoothed. The flat city's y = 0 is T everywhere, so the valley is the only place
// the pilot changes; its rims meet the city at y = 0 on both sides. (Any constant datum offset cancels in DTM - T.)
//
// The output keeps the grids separately (TE-1): `raw` the DTM as sampled (each node the mean of the lidar pixels in its
// 10 m cell), `datum` T, `unconditioned` DTM - T, and `height` the conditioned surface the game uses, with every
// conditioning rule recorded in `alterations`. Conditioning, in order:
//   1. bridge: none needed. The DTM is bare earth: the lidar's ground class has no viaduct deck, so the valley floor
//      under it is the surveyed (or the survey's own interpolated) ground. Recorded as 0 samples.
//   2. shallow: depths under 1 m are street level, full depth from 6 m (a smooth knee; the tableland's relief under the
//      smoothed datum is not the valley)
//   3. cover: the subway's tunnels and stations west and east of the viaduct keep their cover (held at street level
//      within 10 m of the tunnels, 90 m of the stations)
//   4. ravine: the Rosedale ravine leaves the box under the subway's covered Rosedale Valley bridge, which the flat city
//      keeps at street level over Rosedale Valley Road's 7.2 m road cut. On the valley's side of the bridge the
//      ravine's depth (with the cut's) is limited to the cut's floor plus RAVINE_GRADE per metre from the bridge, so
//      the road runs down from the cut to the ravine's real floor at no more than that grade; the flat city's side of
//      the bridge stays at street level
//   5. roads: each road in the valley (and each ramp) gets a profile smoothed along it (a 60 m window); its roadway is
//      level across, blending back to the ground over 12 m beyond its kerbs
//   6. portals: the ground in front of the viaduct's two tunnel portals is cut to below the portal floor
//   7. boundary: the depth tapers to 0 at the box's edges (the south over 700 m: the transition to the flat city)
// Footing: buildings keep their street-level base (y = 0); where the valley falls away under a footprint, the runtime
// stands it on a plinth down to the lowest ground under it (`plinths`: [x, z, lowest y] by building centre).
// Usage: node tools/build-don-valley.mjs [--out js/don-valley-data.js]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readTiffF32 } from './tiff-f32.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DTM = process.env.DON_VALLEY_DTM || path.join(os.homedir(), '.cache/slop-toronto/raw/ontario-dtm-gta2023');
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? process.argv[outArg + 1] : path.join(ROOT, 'js/don-valley-data.js');

// The pilot: the valley from 500 m north of the city's edge (outside the playable city: the terrain only) to the
// transition 900 m south of the viaduct, rim to rim (the subway's Rosedale Valley bridge, west of Castle Frank, to
// Broadview). Aligned to terrain.js's 60 m grid.
export const BOX = { x0: 1600, x1: 2800, z0: -3500, z1: -1880, step: 10 };
// The Bloor Street road deck over the valley stands DECK_TOP above the street datum; the subway's lower deck hangs
// under it as before (js/subway.js: slab 1.25 m, rails 4.95 m under the soffit, floor 0.2 m under the rails)
export const DECK_TOP = 0.4;
const RAIL_Y = DECK_TOP - 1.25 - 4.95, PORTAL_FLOOR = RAIL_Y - 0.2;
const TAPER = { west: 80, east: 80, north: 280, south: 700 };
// The ravine rule's grade: Rosedale Valley Road from the flat city's cut under the subway's bridge down to the ravine's
// floor (the real road climbs about 1.5%, from a ravine floor some 26 m under the street at the bridge; the flat city's
// cut there is 7.2 m deep). It fades out 300 to 450 m from the bridge.
const RAVINE_GRADE = 0.05, RAVINE_REACH = [300, 450];

const ctx = vm.createContext({ window: { CITY: {} }, console: { info() {}, warn() {}, log() {} } });
for (const f of ['js/toronto-geodata.js', 'js/toronto-subway.js', 'js/city-config.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx);
const C = ctx.window.CITY;

// --- the DTM: 1 km tiles, NAD83(CSRS) / UTM zone 17N, 0.5 m pixels, metres above CGVD2013
const manifest = JSON.parse(fs.readFileSync(path.join(DTM, 'manifest.json'), 'utf8'));
const tiles = new Map();
for (const t of manifest.tiles) {
  const buf = fs.readFileSync(path.join(DTM, t.file));
  // (the build is deterministic only from the same tiles)
  if (crypto.createHash('sha256').update(buf).digest('hex') !== t.sha256) throw new Error(`${t.file}: not the tile in manifest.json (refetch with --force)`);
  const r = readTiffF32(buf);
  tiles.set(`${r.origin[0]},${r.origin[1]}`, r);
}
// WGS84 lat/lon to UTM zone 17N (GRS80; NAD83(CSRS) and the OpenStreetMap frame differ by ~1.5 m here, under a pixel's
// worth of the 10 m grid)
function utm17(lat, lon) {
  const a = 6378137, f = 1 / 298.257222101, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2), lon0 = (-81 * Math.PI) / 180;
  const p = (lat * Math.PI) / 180, l = (lon * Math.PI) / 180, sp = Math.sin(p), cp = Math.cos(p), tp = Math.tan(p);
  const Nn = a / Math.sqrt(1 - e2 * sp * sp), T = tp * tp, Cc = ep2 * cp * cp, A = cp * (l - lon0);
  const M = a * ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * p - ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * p)
    + ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * p) - ((35 * e2 ** 3) / 3072) * Math.sin(6 * p));
  const E = 500000 + k0 * Nn * (A + ((1 - T + Cc) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * Cc - 58 * ep2) * A ** 5) / 120);
  const N = k0 * (M + Nn * tp * ((A * A) / 2 + ((5 - T + 9 * Cc + 4 * Cc * Cc) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * Cc - 330 * ep2) * A ** 6) / 720));
  return [E, N];
}
function pixel(E, N) {
  const tx = Math.floor(E / 1000) * 1000, ty = Math.floor(N / 1000) * 1000 + 1000, t = tiles.get(`${tx},${ty}`);
  if (!t) throw new Error(`no DTM tile for UTM ${E.toFixed(0)} ${N.toFixed(0)} (node tools/fetch-don-valley-dtm.mjs)`);
  const c = Math.min(t.width - 1, Math.floor((E - tx) / t.pixel[0])), r = Math.min(t.height - 1, Math.floor((ty - N) / t.pixel[1]));
  return t.data[r * t.width + c];
}
// The world frame is a turned tangent plane: over the box, UTM is affine in (x, z) to a few millimetres. Its
// derivatives, once, at the box's centre:
const J = (() => {
  const cx = (BOX.x0 + BOX.x1) / 2, cz = (BOX.z0 + BOX.z1) / 2, u = (x, z) => { const q = C.latLonFromWorld(x, z); return utm17(q.lat, q.lon); };
  const o = u(cx, cz), ex = u(cx + 100, cz), ez = u(cx, cz + 100);
  return { ex: [(ex[0] - o[0]) / 100, (ex[1] - o[1]) / 100], ez: [(ez[0] - o[0]) / 100, (ez[1] - o[1]) / 100] };
})();
/** The DTM's mean over the 10 m cell centred on (x, z): 1 m sub-samples, each the 0.5 m pixel under it */
function demAt(x, z) {
  const q = C.latLonFromWorld(x, z), [E0, N0] = utm17(q.lat, q.lon);
  let t = 0, n = 0;
  for (let i = -4.5; i <= 4.5; i++) for (let k = -4.5; k <= 4.5; k++) {
    const v = pixel(E0 + J.ex[0] * i + J.ez[0] * k, N0 + J.ex[1] * i + J.ez[1] * k);
    if (v > -100 && v < 1000) { t += v; n++; }
  }
  if (!n) throw new Error(`no DTM data at (${x}, ${z})`);
  return t / n;
}

// --- the viaduct's centre line (js/subway.js VIADUCTS: the bridge=viaduct ways' mean)
const viaduct = (() => {
  const ways = C.GEO_SUBWAY.ways.filter((w) => w[1] & 8).map((w) => { const P = []; for (let i = 0; i < w[4].length; i += 2) P.push({ x: w[4][i], z: w[4][i + 1] }); return P; });
  const pts = ways.flat();
  const ax = pts.reduce((m, p) => (p.x < m.x ? p : m)), bx = pts.reduce((m, p) => (p.x > m.x ? p : m));
  return { a: ax, b: bx };
})();
const segDist = (x, z, a, b) => {
  const ex = b.x - a.x, ez = b.z - a.z, t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1)));
  return { d: Math.hypot(a.x + ex * t - x, a.z + ez * t - z), t };
};

// --- a working grid: the box grown by 600 m, so the datum's filters see the tableland round the valley
const S = BOX.step, M = 600;
const W = { x0: BOX.x0 - M, z0: BOX.z0 - M, nx: Math.round((BOX.x1 - BOX.x0 + 2 * M) / S) + 1, nz: Math.round((BOX.z1 - BOX.z0 + 2 * M) / S) + 1 };
const N = W.nx * W.nz;
const raw = new Float32Array(N);
const vx = viaduct.b.x - viaduct.a.x, vz = viaduct.b.z - viaduct.a.z, vL = Math.hypot(vx, vz), ux = vx / vL, uz = vz / vL;
for (let r = 0; r < W.nz; r++) for (let c = 0; c < W.nx; c++) raw[r * W.nx + c] = demAt(W.x0 + c * S, W.z0 + r * S);
// 1. bridge: none (bare earth)
const ground = raw;
// --- the street datum T: open (r 30 m) then close (r 400 m), smoothed twice over 150 m
function filt(src, op, rad) {
  const a = new Float32Array(N), b = new Float32Array(N);
  const run = (from, to, horizontal) => {
    const n1 = horizontal ? W.nz : W.nx, n2 = horizontal ? W.nx : W.nz;
    for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) {
      let v = op === 'min' ? Infinity : op === 'max' ? -Infinity : 0, cnt = 0;
      for (let o = -rad; o <= rad; o++) {
        const jj = Math.min(n2 - 1, Math.max(0, j + o)), s = horizontal ? from[i * W.nx + jj] : from[jj * W.nx + i];
        if (op === 'min') v = Math.min(v, s); else if (op === 'max') v = Math.max(v, s); else { v += s; cnt++; }
      }
      to[horizontal ? i * W.nx + j : j * W.nx + i] = op === 'avg' ? v / cnt : v;
    }
  };
  run(src, a, true); run(a, b, false);
  return b;
}
const opened = filt(filt(ground, 'min', 3), 'max', 3);
let datum = filt(filt(opened, 'max', 40), 'min', 40);
datum = filt(filt(datum, 'avg', 15), 'avg', 15);

// --- the box grid
const nx = Math.round((BOX.x1 - BOX.x0) / S) + 1, nz = Math.round((BOX.z1 - BOX.z0) / S) + 1;
const at = (arr, c, r) => arr[(r + M / S) * W.nx + c + M / S];
const RAW = new Float32Array(nx * nz), DATUM = new Float32Array(nx * nz), H = new Float32Array(nx * nz), H0 = new Float32Array(nx * nz);
const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
for (let r = 0; r < nz; r++) for (let c = 0; c < nx; c++) {
  const k = r * nx + c;
  RAW[k] = at(raw, c, r); DATUM[k] = at(datum, c, r);
  const depth = Math.min(0, at(ground, c, r) - at(datum, c, r));
  H0[k] = depth;
  // 2. shallow: a knee from 1 m to 6 m deep
  H[k] = depth * smooth(1, 6, -depth);
}
const alterations = { bridge: { samples: 0, note: 'none needed: the DTM is bare earth (no viaduct deck in the lidar ground class)' } };
const xOf = (c) => BOX.x0 + c * S, zOf = (r) => BOX.z0 + r * S;
const cellsNear = (minX, maxX, minZ, maxZ, fn) => {
  for (let r = Math.max(0, Math.floor((minZ - BOX.z0) / S)); r <= Math.min(nz - 1, Math.ceil((maxZ - BOX.z0) / S)); r++)
    for (let c = Math.max(0, Math.floor((minX - BOX.x0) / S)); c <= Math.min(nx - 1, Math.ceil((maxX - BOX.x0) / S)); c++) fn(c, r, r * nx + c);
};
// 3. cover: the subway's tunnels and stations west and east of the viaduct (buildings: see the plinths at the end)
{
  const hold = new Float32Array(nx * nz);
  // the subway west and east of the viaduct: its tunnels and the two stations keep their cover
  for (const w of C.GEO_SUBWAY.ways) {
    if (w[1] & 8) continue;
    const f = w[4];
    for (let i = 2; i < f.length; i += 2) {
      const a = { x: f[i - 2], z: f[i - 1] }, b = { x: f[i], z: f[i + 1] };
      if (Math.max(a.x, b.x) < BOX.x0 - 30 || Math.min(a.x, b.x) > BOX.x1 + 30 || Math.max(a.z, b.z) < BOX.z0 - 30 || Math.min(a.z, b.z) > BOX.z1 + 30) continue;
      cellsNear(Math.min(a.x, b.x) - 30, Math.max(a.x, b.x) + 30, Math.min(a.z, b.z) - 30, Math.max(a.z, b.z) + 30, (c, r, k) => {
        const x = xOf(c), z = zOf(r);
        // (not the abutments: 30 m out from the viaduct's ends, where the portals face the valley)
        const along = (x - viaduct.a.x) * ux + (z - viaduct.a.z) * uz;
        if (along > -32 && along < vL + 32) return;
        hold[k] = Math.max(hold[k], 1 - smooth(10, 25, segDist(x, z, a, b).d));
      });
    }
  }
  for (const s of C.GEO_SUBWAY.stations) {
    if (s[0] < BOX.x0 - 100 || s[0] > BOX.x1 + 100 || s[1] < BOX.z0 - 100 || s[1] > BOX.z1 + 100) continue;
    cellsNear(s[0] - 120, s[0] + 120, s[1] - 120, s[1] + 120, (c, r, k) => { hold[k] = Math.max(hold[k], 1 - smooth(90, 120, Math.hypot(xOf(c) - s[0], zOf(r) - s[1]))); });
  }
  let changed = 0;
  for (let k = 0; k < H.length; k++) if (hold[k] > 0 && H[k] < -0.05) { H[k] *= 1 - hold[k]; changed++; }
  alterations.cover = { samples: changed };
}
// 4. ravine: the Rosedale ravine at the subway's covered Rosedale Valley bridge (the bridge & covered ways, not the viaduct)
{
  const ways = C.GEO_SUBWAY.ways.filter((w) => (w[1] & 5) === 5 && !(w[1] & 10) && w[4][0] > BOX.x0 - 200 && w[4][0] < BOX.x0 + 300);
  const ends = ways.map((w) => { const f = w[4], a = { x: f[0], z: f[1] }, b = { x: f[f.length - 2], z: f[f.length - 1] }; return a.x < b.x ? [a, b] : [b, a]; });
  const A = { x: ends.reduce((t, e) => t + e[0].x, 0) / ends.length, z: ends.reduce((t, e) => t + e[0].z, 0) / ends.length };
  const B = { x: ends.reduce((t, e) => t + e[1].x, 0) / ends.length, z: ends.reduce((t, e) => t + e[1].z, 0) / ends.length };
  const L = Math.hypot(B.x - A.x, B.z - A.z);
  // the flat city's Rosedale Valley Road cut under it: its floor, and its depth about its axis (smoothly across)
  const cut = C.GEO.roadCuts.find((c) => c[0] === 'Rosedale Valley Road'), half = cut[1], axis = [];
  for (let i = 0; i < cut[2].length; i += 3) axis.push({ x: cut[2][i], z: cut[2][i + 1], h: cut[2][i + 2] });
  // (signed distance from the bridge's line: positive on the valley's side, where the cut comes out towards the Don)
  const across = (x, z) => ((B.x - A.x) * (z - A.z) - (B.z - A.z) * (x - A.x)) / L;
  const east = axis.reduce((m, p) => (p.x > m.x ? p : m)), valleySide = Math.sign(across(east.x, east.z));
  const floor = -Math.min(...axis.map((p) => p.h));
  const cutDepth = (x, z) => {
    let best = null;
    for (let i = 1; i < axis.length; i++) { const q = segDist(x, z, axis[i - 1], axis[i]); if (!best || q.d < best.d) best = { d: q.d, h: axis[i - 1].h + (axis[i].h - axis[i - 1].h) * q.t }; }
    return best.h * (1 - smooth(half, half + 15, best.d));
  };
  let held = 0, capped = 0, maxM = 0;
  cellsNear(BOX.x0, BOX.x0 + RAVINE_REACH[1] + L, A.z - RAVINE_REACH[1], A.z + RAVINE_REACH[1], (c, r, k) => {
    const x = xOf(c), z = zOf(r), side = across(x, z) * valleySide, d = segDist(x, z, A, B).d;
    // the flat city's side of the bridge (the ravine west of it is not in the pilot): street level
    const flat = (1 - smooth(-5, 20, side)) * (1 - smooth(BOX.x0 + 160, BOX.x0 + 220, x));
    if (flat > 0 && H[k] < -0.05) { H[k] *= 1 - flat; held++; }
    // the valley's side: no deeper (with the cut) than the cut's floor and RAVINE_GRADE per metre from the bridge
    const cap = Math.min(0, -(floor + RAVINE_GRADE * d) - cutDepth(x, z)), w = 1 - smooth(RAVINE_REACH[0], RAVINE_REACH[1], d);
    if (H[k] < cap && w > 0) {
      const v = H[k] + (cap - H[k]) * w;
      if (v - H[k] > 0.05) { capped++; maxM = Math.max(maxM, v - H[k]); }
      H[k] = v;
    }
  });
  alterations.ravine = { bridge: [[+A.x.toFixed(1), +A.z.toFixed(1)], [+B.x.toFixed(1), +B.z.toFixed(1)]], cutFloorM: floor, grade: RAVINE_GRADE,
    reachM: RAVINE_REACH, heldSamples: held, cappedSamples: capped, maxM: +maxM.toFixed(1) };
}
// 5. roads: smoothed profiles, level across. The viaduct's own decks (Bloor & Danforth over the valley) are decks, not ground.
const isViaductDeck = (road) => road.raised && /^(Bloor Street East|Danforth Avenue)$/.test(road.name);
const overViaduct = (x, z) => { const q = segDist(x, z, viaduct.a, viaduct.b); return q.d < 20 && q.t > 0.001 && q.t < 0.999; };
const sampleH = (x, z) => {
  const fc = Math.max(0, Math.min(nx - 1.0001, (x - BOX.x0) / S)), fr = Math.max(0, Math.min(nz - 1.0001, (z - BOX.z0) / S));
  const c = Math.floor(fc), r = Math.floor(fr), tx = fc - c, tz = fr - r, k = r * nx + c;
  return tx + tz <= 1 ? H[k] + (H[k + 1] - H[k]) * tx + (H[k + nx] - H[k]) * tz
    : H[k + nx + 1] + (H[k + nx] - H[k + nx + 1]) * (1 - tx) + (H[k + 1] - H[k + nx + 1]) * (1 - tz);
};
const roadReport = [];
{
  const target = new Float32Array(nx * nz).fill(NaN), weight = new Float32Array(nx * nz), sumW = new Float64Array(nx * nz);
  for (const road of C.ROADS) {
    const P = road.pts;
    if (!P.some((p) => p.x > BOX.x0 && p.x < BOX.x1 && p.z > BOX.z0 && p.z < BOX.z1)) continue;
    // stations every 5 m along it
    const st = [];
    for (let i = 0; i + 1 < P.length; i++) {
      const a = P[i], b = P[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 5));
      for (let k = i ? 1 : 0; k <= n; k++) st.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
    }
    const inside = st.filter((p) => p.x > BOX.x0 && p.x < BOX.x1 && p.z > BOX.z0 && p.z < BOX.z1);
    // (Bloor Street & Danforth Avenue on the viaduct are its road deck, js/don-valley.js: never ground)
    if (!inside.some((p) => sampleH(p.x, p.z) < -2) || isViaductDeck(road)) continue;
    const h = st.map((p) => (p.x > BOX.x0 && p.x < BOX.x1 && p.z > BOX.z0 && p.z < BOX.z1 ? sampleH(p.x, p.z) : 0));
    const sm = h.map((_, i) => { let t = 0, n = 0; for (let j = Math.max(0, i - 6); j <= Math.min(h.length - 1, i + 6); j++) { t += h[j]; n++; } return t / n; });
    const half = road.w / 2;
    // (a ramp is a deck: it hugs the ground it crosses, js/don-valley.js; only the roads on the ground shape it)
    for (let i = 0; !road.raised && i + 1 < st.length; i++) {
      const a = st[i], b = st[i + 1];
      if (overViaduct((a.x + b.x) / 2, (a.z + b.z) / 2)) continue;
      cellsNear(Math.min(a.x, b.x) - half - 14, Math.max(a.x, b.x) + half + 14, Math.min(a.z, b.z) - half - 14, Math.max(a.z, b.z) + half + 14, (c, r, k) => {
        const q = segDist(xOf(c), zOf(r), a, b), w = 1 - smooth(half + 2, half + 14, q.d);
        if (w <= 0) return;
        // (where two roads' corridors meet, their profiles blend, the nearer one weighing most)
        const wt = w ** 4;
        weight[k] = Math.max(weight[k], w);
        target[k] = (Number.isFinite(target[k]) ? target[k] * sumW[k] : 0) + (sm[i] + (sm[i + 1] - sm[i]) * q.t) * wt;
        sumW[k] += wt; target[k] /= sumW[k];
      });
    }
    roadReport.push({ name: road.name || '(unnamed)', w: road.w, raised: !!road.raised, pts: st });
  }
  let changed = 0, maxM = 0;
  for (let k = 0; k < H.length; k++) if (weight[k] > 0 && Number.isFinite(target[k])) {
    const v = H[k] + (target[k] - H[k]) * weight[k];
    if (Math.abs(v - H[k]) > 0.05) { changed++; maxM = Math.max(maxM, Math.abs(v - H[k])); }
    H[k] = Math.min(0, v);
  }
  alterations.roads = { roads: roadReport.length, samples: changed, maxM: +maxM.toFixed(1) };
}
// 6. portals: the ground before each portal (30 m out into the valley, 12 m either side) below the portal floor
{
  let changed = 0, maxM = 0;
  for (const [end, dir] of [[viaduct.a, 1], [viaduct.b, -1]]) {
    cellsNear(end.x - 60, end.x + 60, end.z - 60, end.z + 60, (c, r, k) => {
      const dx = xOf(c) - end.x, dz = zOf(r) - end.z, a = (dx * ux + dz * uz) * dir, l = Math.abs(-dx * uz + dz * ux);
      if (a < -2 || a > 34 || l > 18) return;
      const w = (1 - smooth(10, 18, l)) * (1 - smooth(26, 34, a));
      const want = Math.min(H[k], PORTAL_FLOOR - 0.6), v = H[k] + (want - H[k]) * w;
      if (H[k] - v > 0.05) { changed++; maxM = Math.max(maxM, H[k] - v); }
      H[k] = v;
    });
  }
  alterations.portals = { samples: changed, maxM: +maxM.toFixed(1), floor: +PORTAL_FLOOR.toFixed(2) };
}
// 7. boundary: taper to 0 at the box's edges
{
  for (let r = 0; r < nz; r++) for (let c = 0; c < nx; c++) {
    const x = xOf(c), z = zOf(r);
    const w = smooth(BOX.x0, BOX.x0 + TAPER.west, x) * smooth(BOX.x1, BOX.x1 - TAPER.east, x) * smooth(BOX.z0, BOX.z0 + TAPER.north, z) * smooth(BOX.z1, BOX.z1 - TAPER.south, z);
    H[r * nx + c] *= w;
  }
  alterations.boundary = { taperM: TAPER };
}

// --- footing: plinths under the buildings the valley falls away from (their lowest ground, by their centre)
const plinths = [];
{
  let deepest = 0;
  for (const b of C.GEO.buildings) {
    const [bx, bz, ang, parts] = b;
    if (bx < BOX.x0 || bx > BOX.x1 || bz < BOX.z0 || bz > BOX.z1) continue;
    const cs = Math.cos(ang), sn = Math.sin(ang);
    let lo = 0;
    for (const [u0, u1, v0, v1] of parts) {
      for (let u = u0; u <= u1 + 1e-6; u += Math.max(0.5, (u1 - u0) / Math.ceil((u1 - u0) / 3))) for (let v = v0; v <= v1 + 1e-6; v += Math.max(0.5, (v1 - v0) / Math.ceil((v1 - v0) / 3))) {
        // (local (u, v) -> world: the inverse of u = dx cs - dz sn, v = dx sn + dz cs)
        lo = Math.min(lo, sampleH(bx + u * cs + v * sn, bz - u * sn + v * cs));
      }
    }
    if (lo < -0.3) { plinths.push([bx, bz, +lo.toFixed(2)]); deepest = Math.min(deepest, lo); }
  }
  alterations.footing = { policy: 'plinth: the building keeps y = 0, foundation walls down to its lowest ground', buildings: plinths.length, deepestM: +(-deepest).toFixed(1) };
}

// --- diagnostics (TE-3): road grades on the conditioned surface, the viaduct's clearance, the deepest point
const diagnostics = { roads: [] };
for (const rd of roadReport) {
  let maxGrade = 0, at = null, lo = 0;
  for (let i = 1; i < rd.pts.length; i++) {
    const a = rd.pts[i - 1], b = rd.pts[i];
    if (overViaduct(a.x, a.z) || overViaduct(b.x, b.z)) continue;
    // (the road's own surface: the valley and, for a ground road, the flat city's road cut under it: cutAt)
    const ha = sampleH(a.x, a.z) + (rd.raised ? 0 : C.roadCutAt(a.x, a.z)), hb = sampleH(b.x, b.z) + (rd.raised ? 0 : C.roadCutAt(b.x, b.z)), L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    if (Math.abs(hb - ha) / L > maxGrade) { maxGrade = Math.abs(hb - ha) / L; at = [Math.round(a.x), Math.round(a.z)]; }
    lo = Math.min(lo, ha);
  }
  if (lo < -0.5) diagnostics.roads.push({ name: rd.name, raised: rd.raised, lowestM: +lo.toFixed(1), maxGradePct: +(maxGrade * 100).toFixed(1), at, review: maxGrade > 0.12 });
}
diagnostics.roads.sort((a, b) => b.maxGradePct - a.maxGradePct);
{
  let floor = 0, at = null, clearance = Infinity;
  for (let k = 0; k < H.length; k++) if (H[k] < floor) { floor = H[k]; at = [xOf(k % nx), zOf(Math.floor(k / nx))]; }
  for (let t = 0.05; t <= 0.95; t += 0.01) {
    const x = viaduct.a.x + vx * t, z = viaduct.a.z + vz * t;
    clearance = Math.min(clearance, Math.max(0, -sampleH(x, z)));
  }
  let deepUnder = 0;
  for (let t = 0; t <= 1; t += 0.01) deepUnder = Math.min(deepUnder, sampleH(viaduct.a.x + vx * t, viaduct.a.z + vz * t));
  diagnostics.deepestM = +floor.toFixed(1);
  diagnostics.deepestAt = at;
  diagnostics.viaduct = { from: [viaduct.a.x, viaduct.a.z], to: [viaduct.b.x, viaduct.b.z], deckTop: DECK_TOP, railY: +RAIL_Y.toFixed(2),
    deepestUnderM: +deepUnder.toFixed(1), deckOverFloorM: +(DECK_TOP - deepUnder).toFixed(1),
    groundAtEnds: [+sampleH(viaduct.a.x, viaduct.a.z).toFixed(1), +sampleH(viaduct.b.x, viaduct.b.z).toFixed(1)] };
  const datumAt = (x, z) => { const c = Math.round((x - BOX.x0) / S), r = Math.round((z - BOX.z0) / S); return DATUM[r * nx + c]; };
  diagnostics.datumAtViaductEnds = [+datumAt(viaduct.a.x, viaduct.a.z).toFixed(1), +datumAt(viaduct.b.x, viaduct.b.z).toFixed(1)];
}

// --- write
const b64 = (arr, scale) => {
  const q = new Int16Array(arr.length);
  for (let i = 0; i < arr.length; i++) q[i] = Math.max(-32768, Math.min(32767, Math.round(arr[i] * scale)));
  return Buffer.from(q.buffer).toString('base64');
};
const out = {
  version: 1,
  source: { dataset: manifest.dataset, file: `${manifest.tiles.length} tiles (tools/fetch-don-valley-dtm.mjs; manifest.json)`, resolutionM: manifest.tiles[0].pixelM,
    retrieved: manifest.retrieved, tiles: manifest.tiles.map((t) => ({ tile: t.tile, sha256: t.sha256 })),
    licence: `${manifest.licence} (${manifest.licenceUrl}); see CREDITS.md`, attribution: manifest.attribution },
  crs: { horizontal: 'js/toronto-geodata.js world frame: WGS84 lat/lon on a tangent plane at Union Station, turned -16.59 deg (GEO.frame.projection); the DTM: NAD83(CSRS) / UTM zone 17N (EPSG:2958)',
    vertical: 'DTM: metres above CGVD2013 (EPSG:6647); game: metres above the local street datum T' },
  datum: 'y = DTM - T(x, z); T = DTM opened over 30 m, closed over 400 m, box-blurred twice over 150 m (the local street level)',
  box: BOX, nx, nz, deckTop: DECK_TOP, railY: +RAIL_Y.toFixed(2),
  units: { raw: 'decimetres above CGVD2013 (the cell mean)', datum: 'decimetres above CGVD2013', height: 'centimetres above the street datum', unconditioned: 'centimetres above the street datum' },
  alterations, diagnostics, plinths,
  height: b64(H, 100), raw: b64(RAW, 10), datumGrid: b64(DATUM, 10), unconditioned: b64(H0, 100)
};
const js = `// js/don-valley-data.js — GENERATED by tools/build-don-valley.mjs, do not edit by hand.
// The Don Valley terrain pilot's surface (?donvalley=1; docs/don-valley-terrain.md): heights on a ${S} m grid over the
// box, from the Ontario GTA 2023 lidar DTM (Open Government Licence – Ontario). Loaded only with the flag.
(function () {
window.CITY = window.CITY || {};
window.CITY.DON_VALLEY_DATA = ${JSON.stringify(out)};
})();
`;
fs.writeFileSync(OUT, js);
console.log(`[don-valley] ${nx} x ${nz} at ${S} m; deepest ${diagnostics.deepestM} m at ${diagnostics.deepestAt}; ${JSON.stringify(alterations)}`);
console.log(`[don-valley] viaduct ${JSON.stringify(diagnostics.viaduct)}; datum at its ends ${diagnostics.datumAtViaductEnds}`);
for (const r of diagnostics.roads) console.log(`[don-valley]   ${r.name.padEnd(26)} lowest ${String(r.lowestM).padStart(6)} m, max grade ${String(r.maxGradePct).padStart(5)} % at ${r.at}${r.review ? '  REVIEW (> 12 %)' : ''}`);
console.log(`[don-valley] wrote ${path.relative(ROOT, OUT)} (${(js.length / 1024).toFixed(0)} KB)`);
