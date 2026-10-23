// tools/fetch-dem.mjs — downloads the terrain around Toronto (Mapzen / AWS Terrain Tiles, "terrarium" encoding: SRTM &
// other public DEMs, ~30 m) and writes tools/data/dem.i16 (+ dem-meta.json): a regular lat/lon grid of heights above sea
// level, Int16 little-endian decimetres.
// usage: node tools/fetch-dem.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const DATA = process.env.GEO_DATA || fileURLToPath(new URL('data/', import.meta.url));
const OUT = `${DATA}/dem.i16`;
const META = `${DATA}/dem-meta.json`;
const Z = 13;
// About 26 km round downtown: the lake to the south, the rise to the Oak Ridges north, Mississauga & Scarborough
const S = 43.40, N = 43.88, W = -79.70, E = -79.05;

const tileX = (lon) => ((lon + 180) / 360) * 2 ** Z;
const tileY = (lat) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z;
};
const lonOf = (x) => (x / 2 ** Z) * 360 - 180;
const latOf = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** Z))) * 180) / Math.PI;

// Minimal PNG decoder: 8-bit RGB / RGBA, non-interlaced (what the terrarium tiles are)
function decodePNG(buf) {
  let p = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('unsupported PNG');
      ct = data[9];
    } else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (!bpp) throw new Error(`unsupported PNG colour type ${ct}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 255;
    }
  }
  return { w, h, bpp, px: out };
}

const tx0 = Math.floor(tileX(W)), tx1 = Math.floor(tileX(E));
const ty0 = Math.floor(tileY(N)), ty1 = Math.floor(tileY(S));
const tiles = new Map();
for (let ty = ty0; ty <= ty1; ty++) {
  for (let tx = tx0; tx <= tx1; tx++) {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`;
    let buf = null;
    for (let tries = 0; tries < 4 && !buf; tries++) {
      try {
        const r = await fetch(url);
        if (r.ok) buf = Buffer.from(await r.arrayBuffer());
      } catch {}
    }
    if (!buf) throw new Error(`failed ${url}`);
    tiles.set(`${tx},${ty}`, decodePNG(buf));
  }
}
console.log(`[dem] ${tiles.size} tiles at z${Z}`);

// Height (m) at fractional global pixel coordinates, bilinear
const T = 256;
function px(gx, gy) {
  const tx = Math.floor(gx / T), ty = Math.floor(gy / T);
  const t = tiles.get(`${tx},${ty}`);
  const x = Math.min(T - 1, Math.max(0, Math.floor(gx - tx * T)));
  const y = Math.min(T - 1, Math.max(0, Math.floor(gy - ty * T)));
  const i = (y * t.w + x) * t.bpp;
  return t.px[i] * 256 + t.px[i + 1] + t.px[i + 2] / 256 - 32768;
}
function heightAt(lat, lon) {
  const gx = tileX(lon) * T - 0.5, gy = tileY(lat) * T - 0.5;
  const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
  return (px(x0, y0) * (1 - fx) + px(x0 + 1, y0) * fx) * (1 - fy) + (px(x0, y0 + 1) * (1 - fx) + px(x0 + 1, y0 + 1) * fx) * fy;
}

// Resample to a regular lat / lon grid at ~20 m (1/5400°)
const STEP = 1 / 5400;
const nLat = Math.round((N - S) / STEP) + 1, nLon = Math.round((E - W) / STEP) + 1;
const h = new Int16Array(nLat * nLon);
for (let i = 0; i < nLat; i++) for (let j = 0; j < nLon; j++) h[i * nLon + j] = Math.round(heightAt(S + i * STEP, W + j * STEP) * 10);
fs.writeFileSync(OUT, Buffer.from(h.buffer));
fs.writeFileSync(META, JSON.stringify({ source: 'AWS Terrain Tiles (terrarium), SRTM-derived', south: S, west: W, step: STEP, nLat, nLon,
  encoding: 'Int16 little-endian, decimetres, rows of latitude from south, columns of longitude from west' }, null, 1));
let lo = Infinity, hi = -Infinity;
for (const v of h) { if (v / 10 < lo) lo = v / 10; if (v / 10 > hi) hi = v / 10; }
console.log(`[dem] ${nLat} x ${nLon} grid, ${lo.toFixed(0)}..${hi.toFixed(0)} m; tiles span ${latOf(ty1 + 1).toFixed(3)}..${latOf(ty0).toFixed(3)}N ${lonOf(tx0).toFixed(3)}..${lonOf(tx1 + 1).toFixed(3)}E`);
console.log(`[dem] CN Tower base: ${heightAt(43.6426, -79.3871).toFixed(0)} m; Bloor & Yonge: ${heightAt(43.6709, -79.3866).toFixed(0)} m; Scarborough Bluffs top: ${heightAt(43.706, -79.233).toFixed(0)} m`);
