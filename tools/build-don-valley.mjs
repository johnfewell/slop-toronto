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

// The pilot: the valley from 800 m north of the city's edge (outside the playable city: the terrain only; far enough
// that the north taper lies beyond the Bayview-Bloor and Parkway interchange, whose ramps the geodata maps to about
// 570 m north of the edge) to the transition 900 m south of the viaduct, rim to rim (the subway's Rosedale Valley
// bridge, west of Castle Frank, to Broadview). Aligned to terrain.js's 60 m grid. (The working grid, 600 m round it,
// stays inside the 16 lidar tiles: its north-east corner is 23 m short of their north edge.)
export const BOX = { x0: 1600, x1: 2800, z0: -3800, z1: -1880, step: 10 };
// The Bloor Street road deck over the valley stands DECK_TOP above the street datum; the subway's lower deck hangs
// under it as before (js/subway.js: slab 1.25 m, rails 4.95 m under the soffit, floor 0.2 m under the rails)
export const DECK_TOP = 0.4;
const RAIL_Y = DECK_TOP - 1.25 - 4.95, PORTAL_FLOOR = RAIL_Y - 0.2;
const TAPER = { west: 80, east: 80, north: 280, south: 700 };
// The ravine rule's grade: Rosedale Valley Road from the flat city's cut under the subway's bridge down to the ravine's
// floor (the real road climbs about 1.5%, from a ravine floor some 26 m under the street at the bridge; the flat city's
// cut there is 7.2 m deep). It fades out 300 to 450 m from the bridge.
const RAVINE_GRADE = 0.05, RAVINE_REACH = [300, 450];
// The ramps (rule 8): a deck stands HUG over the ground under it; profiles from stations every RAMP_STEP metres, the
// lidar's dips under bridges closed over RAMP_CLOSE metres, smoothed over about RAMP_SMOOTH metres; the ground cut
// level across the roadway and RAMP_OUT metres beyond its edge; the output every RAMP_OUT_STEP metres
const HUG = 0.35, RAMP_STEP = 2, RAMP_CLOSE = 30, RAMP_SMOOTH = 15, RAMP_OUT = 1.5, RAMP_OUT_STEP = 4;

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
const taperW = (x, z) => smooth(BOX.x0, BOX.x0 + TAPER.west, x) * smooth(BOX.x1, BOX.x1 - TAPER.east, x) * smooth(BOX.z0, BOX.z0 + TAPER.north, z) * smooth(BOX.z1, BOX.z1 - TAPER.south, z);
{
  for (let r = 0; r < nz; r++) for (let c = 0; c < nx; c++) H[r * nx + c] *= taperW(xOf(c), zOf(r));
  alterations.boundary = { taperM: TAPER };
}

// 8. decks (st-wt0.21.2): the Prince Edward Viaduct's two road sections (the Don's, and the Rosedale section over the
// ravine west of Castle Frank) level with the street; the ramps down the valley's sides on vertical profiles from the
// lidar along their OpenStreetMap alignment; the ground under a ramp cut down to it where the 10 m grid stands above
// the real road; and the flat city's flyovers that only climbed onto the Rosedale section back at the street.
const fineAt = (() => {
  const c0 = { x: (BOX.x0 + BOX.x1) / 2, z: (BOX.z0 + BOX.z1) / 2 }, q = C.latLonFromWorld(c0.x, c0.z), U0 = utm17(q.lat, q.lon);
  return (x, z) => pixel(U0[0] + J.ex[0] * (x - c0.x) + J.ez[0] * (z - c0.z), U0[1] + J.ex[1] * (x - c0.x) + J.ez[1] * (z - c0.z));
})();
const decks = buildDecks();
function buildDecks() {
  // the UTM position of (x, z) (the world frame is affine to UTM over the box: J), and the 0.5 m DTM there
  const fine = fineAt;
  const datumAt = (x, z) => {
    const fc = Math.max(0, Math.min(nx - 1.0001, (x - BOX.x0) / S)), fr = Math.max(0, Math.min(nz - 1.0001, (z - BOX.z0) / S));
    const c = Math.floor(fc), r = Math.floor(fr), tx = fc - c, tz = fr - r, k = r * nx + c;
    return (DATUM[k] * (1 - tx) + DATUM[k + 1] * tx) * (1 - tz) + (DATUM[k + nx] * (1 - tx) + DATUM[k + nx + 1] * tx) * tz;
  };
  const inside = (p) => p.x > BOX.x0 && p.x < BOX.x1 && p.z > BOX.z0 && p.z < BOX.z1;
  const stations = (pts, step) => {
    const st = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / step));
      for (let k = i ? 1 : 0; k <= n; k++) st.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n, h: a.h + ((b.h - a.h) * k) / n, vertex: k === 0 || k === n });
    }
    return st;
  };
  // --- the two viaduct sections: the Don's (the subway's viaduct line), the Rosedale section (Bloor Street's decks over
  // the ravine by the subway's Rosedale Valley bridge, where the ground under them falls away)
  const sections = [{ name: 'Don', a: viaduct.a, b: viaduct.b, ext: 140 }];
  {
    const [A, B] = alterations.ravine.bridge, mid = { x: (A[0] + B[0]) / 2, z: (A[1] + B[1]) / 2 };
    const over = C.DECKS.filter((d) => d.name === 'Bloor Street East' && d.pts.some((p) => p.x > BOX.x0 - 1 && Math.hypot(p.x - mid.x, p.z - mid.z) < 200)
      && stations(d.pts, 2).some((p) => inside(p) && sampleH(p.x, p.z) < -0.3));
    const vs = over.flatMap((d) => d.pts);
    let a = vs[0], b = vs[0], best = -1;
    for (const p of vs) for (const q of vs) { const L = Math.hypot(p.x - q.x, p.z - q.z); if (L > best) { best = L; [a, b] = p.x < q.x ? [p, q] : [q, p]; } }
    sections.push({ name: 'Rosedale', a: { x: a.x, z: a.z }, b: { x: b.x, z: b.z }, ext: 30 });
  }
  const onSection = (s, x, z, reach = 16) => {
    const L = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z), ux = (s.b.x - s.a.x) / L, uz = (s.b.z - s.a.z) / L;
    const a = (x - s.a.x) * ux + (z - s.a.z) * uz, l = -(x - s.a.x) * uz + (z - s.a.z) * ux;
    return a > -s.ext && a < L + s.ext && Math.abs(l) < reach;
  };
  const isSectionDeck = (d) => /^(Bloor Street East|Danforth Avenue)$/.test(d.name) && sections.some((s) => d.pts.every((p) => onSection(s, p.x, p.z)));
  // a section's deck height (js/don-valley.js deckHeight): DECK_TOP over the valley, ramped to the street within ~10 m of
  // where the ground comes up
  const lowestAround = (x, z, r) => {
    let lo = sampleH(x, z);
    for (let k = 0; k < 12; k++) for (const f of [0.5, 1]) lo = Math.min(lo, sampleH(x + Math.cos((k * Math.PI) / 6) * r * f, z + Math.sin((k * Math.PI) / 6) * r * f));
    return lo;
  };
  const sectionDeck = (x, z) => { const low = Math.min(sampleH(x, z), lowestAround(x, z, 10)); return low < -0.3 ? DECK_TOP * Math.min(1, -low / 1.5) : 0; };
  // what a ramp's end joins in the box: a section's deck, else the ground (a road on it), HUG under the deck
  const joinAt = (x, z) => {
    if (sections.some((s) => onSection(s, x, z))) return sectionDeck(x, z);
    const g = sampleH(x, z);
    return g < -0.3 ? g + HUG : 0;
  };
  // --- the ramps: every other deck in the box with valley under it, as stations every RAMP_STEP metres
  const ramps = [];
  C.DECKS.forEach((d, i) => {
    if (isSectionDeck(d) || !d.pts.some(inside)) return;
    const st = stations(d.pts, RAMP_STEP);
    // (a deck down into the valley, as the roads rule's roads: a street on the tableland's shallow relief keeps hugging)
    if (!st.some((p) => inside(p) && sampleH(p.x, p.z) < -2)) return;
    ramps.push({ i, d, st });
  });
  // one graph over all their stations: consecutive stations linked, ramps joined where an end meets another's station
  const nodes = [], edges = [];
  for (const r of ramps) r.ids = r.st.map((p) => { nodes.push({ ...p, nb: [] }); return nodes.length - 1; });
  const parent = nodes.map((_, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const r of ramps) for (const e of [r.ids[0], r.ids[r.ids.length - 1]]) {
    for (const q of ramps) for (const j of q.ids) if (j !== e && Math.hypot(nodes[j].x - nodes[e].x, nodes[j].z - nodes[e].z) < 0.75) parent[find(e)] = find(j);
  }
  for (const r of ramps) for (let k = 1; k < r.ids.length; k++) {
    const a = find(r.ids[k - 1]), b = find(r.ids[k]);
    if (a === b) continue;
    const L = Math.max(0.5, Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z));
    nodes[a].nb.push([b, L]); nodes[b].nb.push([a, L]); edges.push([a, b]);
  }
  const roots = [...new Set(nodes.map((_, i) => find(i)))];
  // targets: the lidar's road under each station (the median of three 0.5 m pixels across it), in the game's frame,
  // tapered with the box; pins: the ends (what they join) and anything outside the box (the flat city's deck)
  for (const r of ramps) r.st.forEach((p, k) => {
    const n = nodes[find(r.ids[k])], a = r.st[Math.max(0, k - 1)], b = r.st[Math.min(r.st.length - 1, k + 1)];
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1, nX = -(b.z - a.z) / L, nZ = (b.x - a.x) / L;
    if (!inside(p)) { n.pin = p.h; return; }
    const v = [-1, 0, 1].map((o) => fine(p.x + nX * o, p.z + nZ * o)).sort((u, w) => u - w)[1];
    n.y = (v - datumAt(p.x, p.z)) * taperW(p.x, p.z);
    n.g = sampleH(p.x, p.z);
  });
  const within = (i, R, fn) => {
    const dist = new Map([[i, 0]]), queue = [i];
    while (queue.length) {
      const u = queue.shift();
      fn(u);
      for (const [v, L] of nodes[u].nb) if (dist.get(u) + L <= R && !(dist.has(v) && dist.get(v) <= dist.get(u) + L)) { dist.set(v, dist.get(u) + L); queue.push(v); }
    }
  };
  // (the graph's connected parts: a ramp and the ramps it joins)
  const compId = new Map();
  for (const i of roots) {
    if (compId.has(i)) continue;
    const stack = [i];
    compId.set(i, i);
    while (stack.length) { const u = stack.pop(); for (const [v] of nodes[u].nb) if (!compId.has(v)) { compId.set(v, i); stack.push(v); } }
  }
  const compOf = (i) => compId.get(i);
  for (const i of roots) if (nodes[i].pin === undefined && nodes[i].nb.length <= 1) nodes[i].pin = joinAt(nodes[i].x, nodes[i].z);
  // the street datum rides a little over the real street beside the valley (its rim envelope, docs §1): where a ramp
  // leaves the street, the lidar's road starts 0.5-1 m under T. Each ramp is measured from its own street: the bias at
  // its street-level ends (within 15 m), faded out from 1 m to 6 m deep (the shallow rule's knee)
  {
    const comp = new Map();
    for (const i of roots) {
      const n = nodes[i];
      if (n.pin !== 0 || n.y === undefined) continue;
      const near = [];
      within(i, 15, (u) => { if (nodes[u].y !== undefined) near.push(nodes[u].y); });
      near.sort((a, b) => a - b);
      const c = compOf(i), b = Math.min(0, near[near.length >> 1]);
      (comp.get(c) || comp.set(c, []).get(c)).push(b);
    }
    for (const i of roots) {
      const n = nodes[i], bs = comp.get(compOf(i));
      if (n.y === undefined || !bs) continue;
      const b = bs.reduce((t, v) => t + v, 0) / bs.length;
      n.y = Math.min(0, n.y - b * (1 - smooth(1, 6, -n.y)));
    }
  }
  // bridges: where a ramp crosses over a road or the river, the bare earth under it falls away; a closing along the
  // graph (the highest within RAMP_CLOSE metres, then the lowest of those) spans any dip shorter than twice that
  const live = roots.filter((i) => nodes[i].y !== undefined);
  const dil = new Map(), clo = new Map();
  for (const i of live) { let m = -Infinity; within(i, RAMP_CLOSE, (u) => { if (nodes[u].y !== undefined) m = Math.max(m, nodes[u].y); }); dil.set(i, m); }
  for (const i of live) { let m = Infinity; within(i, RAMP_CLOSE, (u) => { if (dil.has(u)) m = Math.min(m, dil.get(u)); }); clo.set(i, m); }
  // the profile: as near the (closed) lidar road as a smooth line through the pins can be (a membrane: each station
  // weighs its target against its neighbours, over about RAMP_SMOOTH metres)
  for (const i of roots) nodes[i].h = nodes[i].pin ?? clo.get(i) ?? 0;
  for (let it = 0; it < 4000; it++) for (const i of roots) {
    const n = nodes[i];
    if (n.pin !== undefined || !n.nb.length) continue;
    let s = 0, w = 0, len = 0;
    for (const [j, L] of n.nb) { s += nodes[j].h / L; w += 1 / L; len += L / 2; }
    const a = len / RAMP_SMOOTH ** 2;
    n.h = (a * clo.get(i) + s) / (a + w);
  }
  // the ground under a ramp cut down to HUG under it where it stands higher (level across the roadway, blending out
  // over RAMP_OUT + 8 m beyond the deck's edge); a ramp over lower ground stands on its piers (city-grid.js)
  const target = new Float32Array(nx * nz).fill(Infinity), wt = new Float32Array(nx * nz);
  for (const r of ramps) {
    const half = r.d.w / 2;
    for (let k = 1; k < r.st.length; k++) {
      const a = r.st[k - 1], b = r.st[k];
      if (!inside(a) && !inside(b)) continue;
      const ha = nodes[find(r.ids[k - 1])].h, hb = nodes[find(r.ids[k])].h;
      cellsNear(Math.min(a.x, b.x) - half - RAMP_OUT - 8, Math.max(a.x, b.x) + half + RAMP_OUT + 8, Math.min(a.z, b.z) - half - RAMP_OUT - 8, Math.max(a.z, b.z) + half + RAMP_OUT + 8, (c, rr, kk) => {
        const q = segDist(xOf(c), zOf(rr), a, b), w = 1 - smooth(half + RAMP_OUT, half + RAMP_OUT + 8, q.d);
        if (w <= 0) return;
        const t = ha + (hb - ha) * q.t - HUG;
        if (t < target[kk] || w > wt[kk]) { target[kk] = Math.min(target[kk], t); wt[kk] = Math.max(wt[kk], w); }
      });
    }
  }
  const before = Float32Array.from(H);
  for (let k = 0; k < H.length; k++) if (wt[k] > 0 && H[k] > target[k]) H[k] -= (H[k] - target[k]) * wt[k];
  // (the grid's triangles under a narrow ramp reach past the cut's full width: wherever the surface under a station
  // still stands above the deck less HUG, its triangle's three nodes come down by the difference)
  for (let it = 0; it < 30; it++) {
    let worst = 0;
    for (const r of ramps) r.st.forEach((p, k) => {
      if (!inside(p)) return;
      const e = sampleH(p.x, p.z) - (nodes[find(r.ids[k])].h - HUG);
      if (e <= 0.005) return;
      worst = Math.max(worst, e);
      const fc = (p.x - BOX.x0) / S, fr = (p.z - BOX.z0) / S, c = Math.min(nx - 2, Math.floor(fc)), rr = Math.min(nz - 2, Math.floor(fr)), kk = rr * nx + c;
      for (const q of fc - c + fr - rr <= 1 ? [kk, kk + 1, kk + nx] : [kk + 1, kk + nx, kk + nx + 1]) H[q] -= e;
    });
    if (worst <= 0.005) break;
  }
  let cut = 0, cutMax = 0;
  for (let k = 0; k < H.length; k++) if (before[k] - H[k] > 0.05) { cut++; cutMax = Math.max(cutMax, before[k] - H[k]); }
  // --- the flat city's flyovers that climbed onto the Rosedale section from outside the box (Bloor Street west of the
  // ravine, Parliament Street): in the pilot the section is level with the street, so they are the street again
  const flattened = [];
  {
    const R = sections[1], ends = (d) => [d.pts[0], d.pts[d.pts.length - 1]];
    const seed = C.DECKS.filter((d) => d.pts.some(inside) && d.pts.every((p) => onSection(R, p.x, p.z)));
    const done = new Set(seed), queue = [...seed];
    while (queue.length) {
      const d = queue.shift();
      for (const e of ends(d)) {
        if (e.h <= 0.05 && !inside(e)) continue; // (down at the street: the flyover ends there)
        for (const q of C.DECKS) {
          if (done.has(q) || q.pts.every(inside) || !ends(q).some((f) => Math.hypot(f.x - e.x, f.z - e.z) < 0.75)) continue;
          if (q.pts.some((p) => p.x < BOX.x0 - 250 || p.x > BOX.x1 + 250 || p.z < BOX.z0 - 250 || p.z > BOX.z1 + 250)) continue;
          done.add(q); queue.push(q);
          if (q.pts.some((p) => !inside(p) && p.h > 0.05)) flattened.push(q);
        }
      }
    }
  }
  // --- the output: each ramp's profile every RAMP_OUT_STEP metres (and at its vertices), keyed by its flat-city ends
  const keyOf = (d) => { const a = d.pts[0], b = d.pts[d.pts.length - 1]; return `${a.x.toFixed(1)},${a.z.toFixed(1)},${b.x.toFixed(1)},${b.z.toFixed(1)},${d.pts.length}`; };
  const out = ramps.map((r) => {
    const flat = [];
    const cum = [0];
    for (let k = 1; k < r.st.length; k++) cum.push(cum[k - 1] + Math.hypot(r.st[k].x - r.st[k - 1].x, r.st[k].z - r.st[k - 1].z));
    let last = -Infinity;
    r.st.forEach((p, k) => {
      // (its vertices, its ends, and a station wherever the next would be more than RAMP_OUT_STEP from the last kept)
      if (p.vertex || k === r.st.length - 1 || cum[k + 1] - last > RAMP_OUT_STEP + 1e-6) { flat.push(+p.x.toFixed(2), +p.z.toFixed(2), +nodes[find(r.ids[k])].h.toFixed(2)); last = cum[k]; }
    });
    return { key: keyOf(r.d), name: r.d.name, w: r.d.w, pts: flat };
  });
  // ends pinned to what they join far from the lidar's road there (more than 1.5 m): a junction the 10 m grid's ground
  // road does not hold (an embankment or a bridge OpenStreetMap maps as the ground way); recorded, not hidden (TE-3)
  const junctions = roots.filter((i) => nodes[i].pin !== undefined && clo.has(i) && Math.abs(nodes[i].pin - clo.get(i)) > 1.5)
    .map((i) => ({ at: [Math.round(nodes[i].x), Math.round(nodes[i].z)], joinM: +nodes[i].pin.toFixed(1), lidarM: +clo.get(i).toFixed(1) }));
  alterations.ramps = { ramps: ramps.length, stations: roots.length, closeM: RAMP_CLOSE, smoothM: RAMP_SMOOTH, cutSamples: cut, cutMaxM: +cutMax.toFixed(1),
    flattened: flattened.length, junctions };
  return {
    hug: HUG,
    sections: sections.map((s) => ({ name: s.name, from: [+s.a.x.toFixed(2), +s.a.z.toFixed(2)], to: [+s.b.x.toFixed(2), +s.b.z.toFixed(2)], ext: s.ext })),
    ramps: out,
    flattened: flattened.map((d) => ({ key: keyOf(d), name: d.name, w: d.w, pts: d.pts.flatMap((p) => [+p.x.toFixed(2), +p.z.toFixed(2)]) }))
  };
}

// 9. river (st-051): the Don's water level, one level across the river for each row of the grid, from the city's edge to
// the box's south edge. The water stands RIVER_DEPTH under the lowest ground of the river's channel in its row (as the
// patch stood under each cell's own ground before, tilting and bumping with the floor), and never falls going south: a
// pool stays level until the rising floor lifts it. At the south edge the floor is the street level, so the water is
// the flat city's (CITY_BOUNDS.waterLevel). (In the game's frame the street datum falls towards the lake, so the real
// Don, level at 74.7-75.2 m in the lidar through the box, already rises 0.9 m going south under the viaduct; the
// boundary taper then lifts its floor 39 m to the flat city's: no level surface can fall downstream and meet it.)
const river = (() => {
  const z0 = Math.max(BOX.z0, C.CITY_BOUNDS.minZ), rows = Math.round((BOX.z1 - z0) / S) + 1, floor = [];
  for (let r = 0; r < rows; r++) {
    const z = z0 + r * S;
    let lo = Infinity;
    for (const zz of [z - 4, z, z + 4]) for (let x = BOX.x0; x <= BOX.x1; x += 2.5) if (C.waterAt(x, zz)) lo = Math.min(lo, sampleH(x, zz));
    floor.push(Number.isFinite(lo) ? lo : null);
  }
  // (rows without water: their neighbours')
  for (let r = 0; r < rows; r++) if (floor[r] === null) { let k = 1; while (floor[r - k] == null && floor[r + k] == null && k < rows) k++; floor[r] = floor[r - k] ?? floor[r + k]; }
  const cap = floor.map((f) => f + C.CITY_BOUNDS.waterLevel);
  // smoothed over 50 m, then never above the cap nor falling going south (the lowest of the cap downstream)
  const smoothLv = cap.map((_, r) => { let t = 0, n = 0; for (let k = Math.max(0, r - 2); k <= Math.min(rows - 1, r + 2); k++) { t += cap[k]; n++; } return t / n; });
  const level = new Array(rows);
  let m = Infinity;
  for (let r = rows - 1; r >= 0; r--) { m = Math.min(m, cap[r], smoothLv[r]); level[r] = m; }
  level[rows - 1] = C.CITY_BOUNDS.waterLevel;
  let rise = 0;
  for (let r = 1; r < rows; r++) rise = Math.max(rise, (level[r] - level[r - 1]) / S);
  alterations.river = { rows, fromZ: z0, levels: [+level[0].toFixed(2), +level[rows - 1].toFixed(2)], steepestRisePct: +(rise * 100).toFixed(1), depthM: -C.CITY_BOUNDS.waterLevel };
  return { z0, step: S, level: level.map((v) => Math.round(v * 100)) };
})();

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
// A road's own surface: a ground road's is the valley and the flat city's road cut under it (cutAt); a raised road's is
// its deck (rule 8: a ramp's profile, a viaduct section's deck), not the ground under it
const rampSegs = decks.ramps.flatMap((r) => { const P = r.pts, out = []; for (let i = 3; i < P.length; i += 3) out.push({ w: r.w, a: { x: P[i - 3], z: P[i - 2], h: P[i - 1] }, b: { x: P[i], z: P[i + 1], h: P[i + 2] } }); return out; });
function deckSurface(x, z) {
  let best = null;
  for (const s of rampSegs) {
    if (Math.abs(s.a.x - x) > 60 || Math.abs(s.a.z - z) > 60) continue;
    const q = segDist(x, z, s.a, s.b);
    if (q.d < s.w / 2 + 1.5 && (!best || q.d < best.d)) best = { d: q.d, h: s.a.h + (s.b.h - s.a.h) * q.t };
  }
  if (best) return best.h;
  const g = sampleH(x, z);
  return g < -0.3 ? g + HUG : 0;
}
const diagnostics = { roads: [], gradeBaseM: 20 };
function lidarGrade(pts, at) {
  const st = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
    for (let k = i ? 1 : 0; k <= n; k++) st.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  const y = st.map((p) => fineAt(p.x, p.z));
  let s = 0, worst = 0;
  const cum = st.map((p, i) => (s += i ? Math.hypot(p.x - st[i - 1].x, p.z - st[i - 1].z) : 0));
  for (let i = 0, j = 0; i < st.length; i++) {
    while (j < st.length && cum[j] - cum[i] < 20) j++;
    if (j >= st.length) break;
    if (Math.min(Math.hypot(st[i].x - at[0], st[i].z - at[1]), Math.hypot(st[j].x - at[0], st[j].z - at[1])) > 30) continue;
    worst = Math.max(worst, Math.abs(y[j] - y[i]) / (cum[j] - cum[i]));
  }
  return worst;
}
const decksJunctionNear = (at) => alterations.ramps.junctions.find((j) => Math.hypot(j.at[0] - at[0], j.at[1] - at[1]) < 30) || null;
for (const rd of roadReport) {
  let maxGrade = 0, at = null, lo = 0, playable = 0;
  const y = rd.pts.map((p) => (rd.raised ? deckSurface(p.x, p.z) : sampleH(p.x, p.z) + C.roadCutAt(p.x, p.z)));
  // (the steepest 20 m: stations every 5 m)
  for (let i = 4; i < rd.pts.length; i++) {
    const a = rd.pts[i - 4], b = rd.pts[i];
    lo = Math.min(lo, sampleH(b.x, b.z));
    if (overViaduct(a.x, a.z) || overViaduct(b.x, b.z)) continue;
    let L = 0;
    for (let k = i - 3; k <= i; k++) L += Math.hypot(rd.pts[k].x - rd.pts[k - 1].x, rd.pts[k].z - rd.pts[k - 1].z);
    if (L < 1) continue;
    const g = Math.abs(y[i] - y[i - 4]) / L;
    if (g > maxGrade) { maxGrade = g; at = [Math.round(a.x), Math.round(a.z)]; }
    if (a.z > C.CITY_BOUNDS.minZ && b.z > C.CITY_BOUNDS.minZ) playable = Math.max(playable, g);
  }
  // (playableMaxPct: the steepest 20 m inside the playable city, north of which the pilot is scenery)
  if (lo < -0.5) {
    const e = { name: rd.name, raised: rd.raised, lowestM: +lo.toFixed(1), maxGradePct: +(maxGrade * 100).toFixed(1), at, playableMaxPct: +(playable * 100).toFixed(1), review: maxGrade > 0.12 };
    // a review's recorded resolution: a ground road's own slope in the lidar (the steepest 20 m of the 0.5 m DTM along
    // its centreline within 30 m of the spot), or a ramp's junction (rule 8)
    if (e.review && !rd.raised) e.lidarPct = +(100 * lidarGrade(rd.pts, at)).toFixed(1);
    if (e.review && rd.raised) e.junction = decksJunctionNear(at);
    diagnostics.roads.push(e);
  }
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
  units: { river: 'centimetres above the street datum, a level for each row from river.z0 every river.step metres', raw: 'decimetres above CGVD2013 (the cell mean)', datum: 'decimetres above CGVD2013', height: 'centimetres above the street datum', unconditioned: 'centimetres above the street datum' },
  alterations, diagnostics, plinths, decks, river,
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
for (const r of diagnostics.roads) console.log(`[don-valley]   ${r.name.padEnd(26)} ${r.raised ? "deck  " : "ground"} lowest ${String(r.lowestM).padStart(6)} m, max grade ${String(r.maxGradePct).padStart(5)} % at ${r.at}${r.review ? "  REVIEW (> 12 %)" : ""}`);
console.log(`[don-valley] wrote ${path.relative(ROOT, OUT)} (${(js.length / 1024).toFixed(0)} KB)`);
