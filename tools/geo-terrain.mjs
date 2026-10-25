// Part 6: the terrain around and inside the city: the ravines, the old Lake Iroquois shore, the rise to the north.
// The streets are built flat (y = 0, like the engine's whole road and traffic model), so the terrain is the height of
// the land ABOVE ITS LOCAL PLAIN: the DEM minus its morphological opening (the lowest ground within 900 m, smoothed),
// i.e. inselbergs and ridges keep their true relief from the ground around them. Wherever the city is built (a road,
// a railway track or a building within ~60 m) the terrain is held at street level.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toLonLat, toWorld, load, log } from './geo-base.mjs';
import { rasterRoads, inDetail } from './geo-roads.mjs';
import { buildings } from './geo-features.mjs';
import { rails } from './geo-rails.mjs';
import { isWater } from './geo-land.mjs';

export const TERRAIN = { x0: -26000, z0: -26000, size: 52000, step: 60 };

export function buildTerrain() {
  const dem = load('dem-meta.json');
  const DATA = process.env.GEO_DATA || fileURLToPath(new URL('data/', import.meta.url));
  const raw = fs.readFileSync(path.join(DATA, 'dem.i16'));
  const dm = new Int16Array(raw.buffer, raw.byteOffset, raw.length >> 1);
  dem.h = { length: dm.length };
  const H = (k) => dm[k] / 10;
  const { x0, z0, size, step } = TERRAIN;
  const n = Math.round(size / step) + 1;
  const elev = new Float32Array(n * n);
  const demAt = (lat, lon) => {
    const fi = (lat - dem.south) / dem.step, fj = (lon - dem.west) / dem.step;
    if (fi < 0 || fj < 0 || fi > dem.nLat - 1 || fj > dem.nLon - 1) return NaN;
    const i = Math.min(dem.nLat - 2, Math.floor(fi)), j = Math.min(dem.nLon - 2, Math.floor(fj));
    const ti = fi - i, tj = fj - j;
    const w = dem.nLon;
    return (H(i * w + j) * (1 - tj) + H(i * w + j + 1) * tj) * (1 - ti) + (H((i + 1) * w + j) * (1 - tj) + H((i + 1) * w + j + 1) * tj) * ti;
  };
  let missing = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const [lon, lat] = toLonLat(x0 + c * step, z0 + r * step);
      const v = demAt(lat, lon);
      if (Number.isNaN(v)) missing++;
      elev[r * n + c] = v;
    }
  }
  // beyond the DEM: the nearest known height along the row / column (the far rim is all fog anyway)
  for (let pass = 0; pass < 2; pass++) {
    for (let r = 0; r < n; r++) {
      let last = NaN;
      for (let c = 0; c < n; c++) { const k = r * n + c; if (Number.isNaN(elev[k])) elev[k] = last; else last = elev[k]; }
      last = NaN;
      for (let c = n - 1; c >= 0; c--) { const k = r * n + c; if (Number.isNaN(elev[k])) elev[k] = last; else last = elev[k]; }
    }
    for (let c = 0; c < n; c++) {
      let last = NaN;
      for (let r = 0; r < n; r++) { const k = r * n + c; if (Number.isNaN(elev[k])) elev[k] = last; else last = elev[k]; }
      last = NaN;
      for (let r = n - 1; r >= 0; r--) { const k = r * n + c; if (Number.isNaN(elev[k])) elev[k] = last; else last = elev[k]; }
    }
  }
  // Local plain: grey-scale opening (min then max filter, square 1.6 km half-size: wider than Aso Rock's massif, so the
  // whole dome stands above it) then a 600 m box blur twice
  const R1 = Math.round(1600 / step), R2 = Math.round(600 / step);
  const filt1D = (src, dst, op, rad, horizontal) => {
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        let v = op === 'min' ? Infinity : op === 'max' ? -Infinity : 0, cnt = 0;
        for (let o = -rad; o <= rad; o++) {
          const bb = Math.min(n - 1, Math.max(0, b + o));
          const s = horizontal ? src[a * n + bb] : src[bb * n + a];
          if (op === 'min') v = Math.min(v, s); else if (op === 'max') v = Math.max(v, s); else { v += s; cnt++; }
        }
        dst[horizontal ? a * n + b : b * n + a] = op === 'avg' ? v / cnt : v;
      }
    }
  };
  const t1 = new Float32Array(n * n), t2 = new Float32Array(n * n);
  filt1D(elev, t1, 'min', R1, true); filt1D(t1, t2, 'min', R1, false);
  filt1D(t2, t1, 'max', R1, true); filt1D(t1, t2, 'max', R1, false);
  for (let k = 0; k < 2; k++) { filt1D(t2, t1, 'avg', R2, true); filt1D(t1, t2, 'avg', R2, false); }
  const base = t2;

  // Built-up cells (a road or a building), grown by one cell
  const built = new Uint8Array(n * n);
  const mark = (x, z) => {
    const c = Math.round((x - x0) / step), r = Math.round((z - z0) / step);
    if (c >= 0 && r >= 0 && c < n && r < n) built[r * n + c] = 1;
  };
  for (const s of rasterRoads) {
    const L = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
    const k = Math.max(1, Math.ceil(L / (step / 2)));
    for (let i = 0; i <= k; i++) mark(s.x0 + ((s.x1 - s.x0) * i) / k, s.z0 + ((s.z1 - s.z0) * i) / k);
  }
  for (const b of buildings) mark(b[0], b[1]);
  // (the tracks run at street level too, or on the embankments js/rail-corridor.js raises from it)
  for (const [, , , , flat] of rails) {
    for (let i = 2; i < flat.length; i += 2) {
      const L = Math.hypot(flat[i] - flat[i - 2], flat[i + 1] - flat[i - 1]);
      const k = Math.max(1, Math.ceil(L / (step / 2)));
      for (let j = 0; j <= k; j++) mark(flat[i - 2] + ((flat[i] - flat[i - 2]) * j) / k, flat[i - 1] + ((flat[i + 1] - flat[i - 1]) * j) / k);
    }
  }
  const grown = new Uint8Array(n * n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    let v = 0;
    for (let dr = -1; dr <= 1 && !v; dr++) for (let dc = -1; dc <= 1 && !v; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && cc >= 0 && rr < n && cc < n && built[rr * n + cc]) v = 1;
    }
    grown[r * n + c] = v;
  }
  // water bodies sit at street level too
  const inRing = (x, z, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  };
  const out = new Int16Array(n * n);
  let peak = 0, peakAt = [0, 0];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const k = r * n + c;
      const x = x0 + c * step, z = z0 + r * step;
      let h = Math.max(0, elev[k] - base[k]);
      if (grown[k]) h = 0;
      else if (isWater(x, z)) h = -30; // water: the runtime sinks the ground under it (terrain.js)
      out[k] = Math.round(h * 10);
      if (h > peak) { peak = h; peakAt = [x, z]; }
    }
  }
  const [plon, plat] = toLonLat(...peakAt);
  log(`terrain ${n} x ${n} at ${step} m; ${missing} samples beyond the DEM; highest relief ${peak.toFixed(0)} m at (${peakAt}) = ${plat.toFixed(4)}N ${plon.toFixed(4)}E`);
  return { x0, z0, step, n, data: Buffer.from(out.buffer).toString('base64'), baseAtOrigin: Math.round(base[Math.round(-z0 / step) * n + Math.round(-x0 / step)]) };
}
