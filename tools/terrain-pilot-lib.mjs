// tools/terrain-pilot-lib.mjs — what the terrain pilots' builds share (tools/build-don-valley.mjs, docs/don-valley-terrain.md;
// tools/build-high-park.mjs, docs/high-park-terrain.md): the city's world frame in a vm, the Ontario GTA 2023 lidar DTM's
// 1 km tiles (checked against their manifest's SHA-256), the world frame to UTM zone 17N, the DTM's 10 m cell means and
// its 0.5 m pixels, the separable grid filters, and the grids' Int16 base64 packing.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readTiffF32 } from './tiff-f32.mjs';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DTM_DIR = process.env.DON_VALLEY_DTM || path.join(os.homedir(), '.cache/slop-toronto/raw/ontario-dtm-gta2023');

/** The city (window.CITY) as the browser has it before the runtime: the geodata, the subway, `extra` scripts, city-config.js */
export function loadCity(extra = []) {
  const ctx = vm.createContext({ window: { CITY: {} }, console: { info() {}, warn() {}, log() {} } });
  for (const f of ['js/toronto-geodata.js', 'js/toronto-subway.js', ...extra, 'js/city-config.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx);
  return ctx.window.CITY;
}

// WGS84 lat/lon to UTM zone 17N (GRS80; NAD83(CSRS) and the OpenStreetMap frame differ by ~1.5 m here, under a pixel's
// worth of the 10 m grid)
export function utm17(lat, lon) {
  const a = 6378137, f = 1 / 298.257222101, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2), lon0 = (-81 * Math.PI) / 180;
  const p = (lat * Math.PI) / 180, l = (lon * Math.PI) / 180, sp = Math.sin(p), cp = Math.cos(p), tp = Math.tan(p);
  const Nn = a / Math.sqrt(1 - e2 * sp * sp), T = tp * tp, Cc = ep2 * cp * cp, A = cp * (l - lon0);
  const M = a * ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * p - ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * p)
    + ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * p) - ((35 * e2 ** 3) / 3072) * Math.sin(6 * p));
  const E = 500000 + k0 * Nn * (A + ((1 - T + Cc) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * Cc - 58 * ep2) * A ** 5) / 120);
  const N = k0 * (M + Nn * tp * ((A * A) / 2 + ((5 - T + 9 * Cc + 4 * Cc * Cc) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * Cc - 330 * ep2) * A ** 6) / 720));
  return [E, N];
}

/**
 * The DTM under a pilot box: its tiles from `manifestFile` (in DTM_DIR), each checked against the manifest's SHA-256
 * (the build is deterministic only from the same tiles). Returns { manifest, pixel(E, N), demAt(x, z), fineAt(x, z) }:
 * - pixel: the 0.5 m pixel under a UTM position;
 * - demAt: the DTM's mean over the 10 m cell centred on world (x, z) (1 m sub-samples, each the 0.5 m pixel under it);
 * - fineAt: the 0.5 m pixel under world (x, z).
 * The world frame is a turned tangent plane: over the box, UTM is affine in (x, z) to a few millimetres; its derivatives
 * are taken once, at the box's centre.
 */
export function openDtm(C, box, manifestFile = 'manifest.json') {
  const manifest = JSON.parse(fs.readFileSync(path.join(DTM_DIR, manifestFile), 'utf8'));
  const tiles = new Map();
  for (const t of manifest.tiles) {
    const buf = fs.readFileSync(path.join(DTM_DIR, t.file));
    if (crypto.createHash('sha256').update(buf).digest('hex') !== t.sha256) throw new Error(`${t.file}: not the tile in ${manifestFile} (refetch with --force)`);
    const r = readTiffF32(buf);
    tiles.set(`${r.origin[0]},${r.origin[1]}`, r);
  }
  function pixel(E, N) {
    const tx = Math.floor(E / 1000) * 1000, ty = Math.floor(N / 1000) * 1000 + 1000, t = tiles.get(`${tx},${ty}`);
    if (!t) throw new Error(`no DTM tile for UTM ${E.toFixed(0)} ${N.toFixed(0)} (node tools/fetch-don-valley-dtm.mjs)`);
    const c = Math.min(t.width - 1, Math.floor((E - tx) / t.pixel[0])), r = Math.min(t.height - 1, Math.floor((ty - N) / t.pixel[1]));
    return t.data[r * t.width + c];
  }
  const J = (() => {
    const cx = (box.x0 + box.x1) / 2, cz = (box.z0 + box.z1) / 2, u = (x, z) => { const q = C.latLonFromWorld(x, z); return utm17(q.lat, q.lon); };
    const o = u(cx, cz), ex = u(cx + 100, cz), ez = u(cx, cz + 100);
    return { ex: [(ex[0] - o[0]) / 100, (ex[1] - o[1]) / 100], ez: [(ez[0] - o[0]) / 100, (ez[1] - o[1]) / 100] };
  })();
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
  const fineAt = (() => {
    const c0 = { x: (box.x0 + box.x1) / 2, z: (box.z0 + box.z1) / 2 }, q = C.latLonFromWorld(c0.x, c0.z), U0 = utm17(q.lat, q.lon);
    return (x, z) => pixel(U0[0] + J.ex[0] * (x - c0.x) + J.ez[0] * (z - c0.z), U0[1] + J.ex[1] * (x - c0.x) + J.ez[1] * (z - c0.z));
  })();
  return { manifest, pixel, demAt, fineAt, J };
}

/** A separable filter over a grid of nx x nz: 'min', 'max' or 'avg' over 2 rad + 1 samples, edges clamped */
export function filt(src, nx, nz, op, rad) {
  const N = nx * nz, a = new Float32Array(N), b = new Float32Array(N);
  const run = (from, to, horizontal) => {
    const n1 = horizontal ? nz : nx, n2 = horizontal ? nx : nz;
    for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) {
      let v = op === 'min' ? Infinity : op === 'max' ? -Infinity : 0, cnt = 0;
      for (let o = -rad; o <= rad; o++) {
        const jj = Math.min(n2 - 1, Math.max(0, j + o)), s = horizontal ? from[i * nx + jj] : from[jj * nx + i];
        if (op === 'min') v = Math.min(v, s); else if (op === 'max') v = Math.max(v, s); else { v += s; cnt++; }
      }
      to[horizontal ? i * nx + j : j * nx + i] = op === 'avg' ? v / cnt : v;
    }
  };
  run(src, a, true); run(a, b, false);
  return b;
}

/** A grid as base64 Int16, each value times `scale` (centimetres: 100; decimetres: 10) */
export const b64 = (arr, scale) => {
  const q = new Int16Array(arr.length);
  for (let i = 0; i < arr.length; i++) q[i] = Math.max(-32768, Math.min(32767, Math.round(arr[i] * scale)));
  return Buffer.from(q.buffer).toString('base64');
};
export const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
export const segDist = (x, z, a, b) => {
  const ex = b.x - a.x, ez = b.z - a.z, t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1)));
  return { d: Math.hypot(a.x + ex * t - x, a.z + ez * t - z), t };
};
