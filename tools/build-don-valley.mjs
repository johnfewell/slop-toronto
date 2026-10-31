// tools/build-don-valley.mjs → js/don-valley-data.js
// The Don Valley terrain pilot (?donvalley=1, docs/don-valley-terrain.md): the real valley under the Prince Edward
// Viaduct, from the AWS Terrain Tiles DEM the city build already uses (dem.i16 / dem-meta.json in GEO_DATA, default
// ~/.cache/slop-toronto/osm-ids), on a 10 m grid over a bounded box, as heights in the game's frame:
//
//   game height y = DEM elevation (m above sea level) - street datum T(x, z) (m above sea level)
//
// where T is the local street level: the DEM with its narrow bumps (trees, buildings) opened away and the valley
// closed over (the lowest tableland within 400 m either side), smoothed. The flat city's y = 0 is T everywhere, so the
// valley is the only place the pilot changes; its rims meet the city at y = 0 on both sides.
//
// The output keeps three grids separately (TE-1): `raw` the DEM as sampled, `datum` T, and `height` the conditioned
// surface the game uses, with every conditioning rule recorded in `alterations`. Conditioning, in order:
//   1. bridge: the DEM (SRTM, a surface model) carries the viaduct's own deck across the valley, blurred ~60 m either
//      side; samples within 70 m of the viaduct are replaced by interpolation across it
//   2. shallow: depths under 1 m are street level, full depth from 6 m (a smooth knee; the tableland's noise is not relief)
//   3. cover: the subway's tunnels and stations west and east of the viaduct keep their cover (held at street level
//      within 10 m of the tunnels, 90 m of the stations)
//   4. roads: each road in the valley (and each ramp) gets a profile smoothed along it (a 60 m window); its roadway is
//      level across, blending back to the ground over 12 m beyond its kerbs
//   5. portals: the ground in front of the viaduct's two tunnel portals is cut to below the portal floor
//   6. boundary: the depth tapers to 0 at the box's edges (the south over 700 m: the transition to the flat city; the
//      west over 220 m where the Rosedale ravine runs out of the box)
// Footing: buildings keep their street-level base (y = 0); where the valley falls away under a footprint, the runtime
// stands it on a plinth down to the lowest ground under it (`plinths`: [x, z, lowest y] by building centre).
// Usage: node tools/build-don-valley.mjs [--out js/don-valley-data.js]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = process.env.GEO_DATA || path.join(os.homedir(), '.cache/slop-toronto/osm-ids');
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? process.argv[outArg + 1] : path.join(ROOT, 'js/don-valley-data.js');

// The pilot: the valley from 500 m north of the city's edge (outside the playable city: the terrain only) to the
// transition 900 m south of the viaduct, rim to rim (Castle Frank to Broadview). Aligned to terrain.js's 60 m grid.
export const BOX = { x0: 1780, x1: 2800, z0: -3500, z1: -1880, step: 10 };
// The Bloor Street road deck over the valley stands DECK_TOP above the street datum; the subway's lower deck hangs
// under it as before (js/subway.js: slab 1.25 m, rails 4.95 m under the soffit, floor 0.2 m under the rails)
export const DECK_TOP = 0.4;
const RAIL_Y = DECK_TOP - 1.25 - 4.95, PORTAL_FLOOR = RAIL_Y - 0.2;
const TAPER = { west: 80, east: 80, north: 280, south: 700 };

const ctx = vm.createContext({ window: { CITY: {} }, console: { info() {}, warn() {}, log() {} } });
for (const f of ['js/toronto-geodata.js', 'js/toronto-subway.js', 'js/city-config.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx);
const C = ctx.window.CITY;

// --- the DEM
const meta = JSON.parse(fs.readFileSync(path.join(DATA, 'dem-meta.json'), 'utf8'));
const demBuf = fs.readFileSync(path.join(DATA, 'dem.i16'));
const dem = new Int16Array(demBuf.buffer, demBuf.byteOffset, demBuf.length >> 1);
function demAt(x, z) {
  const { lat, lon } = C.latLonFromWorld(x, z);
  const fi = (lat - meta.south) / meta.step, fj = (lon - meta.west) / meta.step;
  const i = Math.floor(fi), j = Math.floor(fj), ti = fi - i, tj = fj - j, w = meta.nLon, H = (k) => dem[k] / 10;
  return (H(i * w + j) * (1 - tj) + H(i * w + j + 1) * tj) * (1 - ti) + (H((i + 1) * w + j) * (1 - tj) + H((i + 1) * w + j + 1) * tj) * ti;
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
const raw = new Float32Array(N), ground = new Float32Array(N);
const vx = viaduct.b.x - viaduct.a.x, vz = viaduct.b.z - viaduct.a.z, vL = Math.hypot(vx, vz), ux = vx / vL, uz = vz / vL;
const BRIDGE = 70;
let bridged = 0, bridgeMax = 0;
for (let r = 0; r < W.nz; r++) for (let c = 0; c < W.nx; c++) {
  const x = W.x0 + c * S, z = W.z0 + r * S, k = r * W.nx + c;
  raw[k] = demAt(x, z);
  // 1. bridge: across the viaduct (and 30 m past its ends), interpolate between the DEM 36 m either side
  const along = (x - viaduct.a.x) * ux + (z - viaduct.a.z) * uz, across = -(x - viaduct.a.x) * uz + (z - viaduct.a.z) * ux;
  if (along > -30 && along < vL + 30 && Math.abs(across) < BRIDGE) {
    const px = x - -uz * across, pz = z - ux * across; // (the foot on the line)
    const lo = demAt(px - uz * BRIDGE, pz + ux * BRIDGE), hi = demAt(px + uz * BRIDGE, pz - ux * BRIDGE);
    const t = (BRIDGE - across) / (2 * BRIDGE);
    ground[k] = lo * (1 - t) + hi * t;
    if (ground[k] < raw[k] - 0.05) { bridged++; bridgeMax = Math.max(bridgeMax, raw[k] - ground[k]); }
    ground[k] = Math.min(ground[k], raw[k]);
  } else ground[k] = raw[k];
}
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
// (the closing over the valley is at least the opened ground: so is its blur, nearly; never let the datum dip under it)

// --- the box grid
const nx = Math.round((BOX.x1 - BOX.x0) / S) + 1, nz = Math.round((BOX.z1 - BOX.z0) / S) + 1;
const at = (arr, c, r) => arr[(r + M / S) * W.nx + c + M / S];
const RAW = new Float32Array(nx * nz), DATUM = new Float32Array(nx * nz), H = new Float32Array(nx * nz), H0 = new Float32Array(nx * nz);
const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
for (let r = 0; r < nz; r++) for (let c = 0; c < nx; c++) {
  const k = r * nx + c;
  RAW[k] = at(raw, c, r); DATUM[k] = at(datum, c, r);
  const depth = Math.min(0, at(opened, c, r) - at(datum, c, r));
  H0[k] = depth;
  // 2. shallow: a knee from 1 m to 6 m deep
  H[k] = depth * smooth(1, 6, -depth);
}
const alterations = { bridge: { samples: bridged, maxM: +bridgeMax.toFixed(1) } };
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
// 4. roads: smoothed profiles, level across. The viaduct's own decks (Bloor & Danforth over the valley) are decks, not ground.
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
// 5. portals: the ground before each portal (30 m out into the valley, 12 m either side) below the portal floor
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
// 6. boundary: taper to 0 at the box's edges
{
  for (let r = 0; r < nz; r++) for (let c = 0; c < nx; c++) {
    const x = xOf(c), z = zOf(r);
    const west = TAPER.west + 140 * smooth(-2720, -2620, z) * smooth(-2250, -2350, z); // (the Rosedale ravine)
    const w = smooth(BOX.x0, BOX.x0 + west, x) * smooth(BOX.x1, BOX.x1 - TAPER.east, x) * smooth(BOX.z0, BOX.z0 + TAPER.north, z) * smooth(BOX.z1, BOX.z1 - TAPER.south, z);
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
    const ha = sampleH(a.x, a.z), hb = sampleH(b.x, b.z), L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
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
  source: { dataset: meta.source, file: 'dem.i16 / dem-meta.json (tools/fetch-dem.mjs)', resolutionDeg: meta.step, licence: 'AWS Terrain Tiles: SRTM-derived, public domain (see CREDITS.md)' },
  crs: { horizontal: 'js/toronto-geodata.js world frame: WGS84 lat/lon on a tangent plane at Union Station, turned -16.59 deg (GEO.frame.projection)', vertical: 'DEM: metres above mean sea level (SRTM, EGM96 geoid); game: metres above the local street datum T' },
  datum: 'y = DEM - T(x, z); T = DEM opened over 30 m, closed over 400 m, box-blurred twice over 150 m (the local street level)',
  box: BOX, nx, nz, deckTop: DECK_TOP, railY: +RAIL_Y.toFixed(2),
  units: { raw: 'decimetres above sea level', datum: 'decimetres above sea level', height: 'centimetres above the street datum' },
  alterations, diagnostics, plinths,
  height: b64(H, 100), raw: b64(RAW, 10), datumGrid: b64(DATUM, 10), unconditioned: b64(H0, 100)
};
const js = `// js/don-valley-data.js — GENERATED by tools/build-don-valley.mjs, do not edit by hand.
// The Don Valley terrain pilot's surface (?donvalley=1; docs/don-valley-terrain.md): heights on a ${S} m grid over the
// box, from AWS Terrain Tiles (SRTM-derived). Loaded only with the flag.
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
