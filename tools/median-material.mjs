// tools/median-material.mjs — what a median is made of (docs/road-medians.md): the pure parts of the classifier
// (tools/classify-medians.mjs): a PNG reader for the City's orthophoto crops, an island's pixels, and the tests that tell
// planted ground, concrete and paint apart. No data is loaded at import; no dependencies.
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';

/** A PNG (8 bits a channel, not interlaced: truecolour, truecolour with alpha, grey or palette) as { w, h, rgb } */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let w = 0, h = 0, depth = 0, type = 0, interlace = 0, palette = null, trns = null;
  const idat = [];
  for (let p = 8; p < buf.length;) {
    const len = buf.readUInt32BE(p), kind = buf.toString('latin1', p + 4, p + 8), body = buf.subarray(p + 8, p + 8 + len);
    if (kind === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlace = body[12]; }
    else if (kind === 'PLTE') palette = body;
    else if (kind === 'tRNS') trns = body;
    else if (kind === 'IDAT') idat.push(body);
    p += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error(`unsupported PNG (depth ${depth}, interlace ${interlace})`);
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp;
  const out = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[dst + i - bpp] : 0, b = y ? out[dst - stride + i] : 0, c = y && i >= bpp ? out[dst - stride + i - bpp] : 0;
      let v = raw[src + i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + i] = v & 255;
    }
  }
  const rgb = new Uint8Array(w * h * 3), alpha = new Uint8Array(w * h).fill(255);
  for (let k = 0; k < w * h; k++) {
    if (type === 2 || type === 6) { rgb[k * 3] = out[k * bpp]; rgb[k * 3 + 1] = out[k * bpp + 1]; rgb[k * 3 + 2] = out[k * bpp + 2]; if (type === 6) alpha[k] = out[k * bpp + 3]; }
    else if (type === 3) { const q = out[k]; rgb[k * 3] = palette[q * 3]; rgb[k * 3 + 1] = palette[q * 3 + 1]; rgb[k * 3 + 2] = palette[q * 3 + 2]; if (trns && q < trns.length) alpha[k] = trns[q]; }
    else { rgb[k * 3] = rgb[k * 3 + 1] = rgb[k * 3 + 2] = out[k * bpp]; if (type === 4) alpha[k] = out[k * bpp + 1]; }
  }
  return { w, h, rgb, alpha };
}

export const KINDS = ['lawn', 'concrete', 'paint'];
/** Planted: at least this share of an island's pixels in the 2025 orthophoto are green by excess green (2G - R - B) / max
 *  channel over 0.07. It is the share that survives shade (a shaded lawn is dark green, not grey: that is the test
 *  the earlier attempt lacked, which read dark pixels as grey) */
export const PLANTED_SHARE = 0.15;
/** ...or the island is this much greener (mean excess green) than the road round it: a dull olive lawn or a tree pit */
export const GREENER = 0.04;
/** An island that is not planted is paint when it is the road's own surface, and concrete (a raised, paved island or
 *  apron) when it is not: within PAINT_DL grey levels of the road in a band round it in the 2025 orthophoto, and no wider than PAINT_WIDTH metres (its mean width, 2 x area / perimeter). A gore painted on the
 *  asphalt is the asphalt's grey (the lane lines run through it); paving, brick and concrete are paler or darker. A
 *  shadow falls on the island and the road round it alike, so it does not tell them apart. */
export const PAINT_DL = 14;
export const PAINT_WIDTH = 8; // m

/** Point-in-ring (even-odd), planar */
export function inRing(x, y, r) {
  let ins = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
/** Distance from (x, y) to the ring's edges */
export function edgeDistance(x, y, r) {
  let d = Infinity;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [ax, ay] = r[j], [bx, by] = r[i], dx = bx - ax, dy = by - ay;
    let t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    d = Math.min(d, Math.hypot(ax + t * dx - x, ay + t * dy - y));
  }
  return d;
}

/**
 * What one orthophoto crop says of an island. `img` is { w, h, rgb } (decodePng), `ring` the island's outline in the
 * crop's pixels, `pxm` the metres a pixel is. Pixels within `erode` metres of the outline are left out (the City's
 * layers sit a metre off the imagery), and so are the very dark ones (V < 35). Returns the planted share `vf`, the
 * island's mean grey `L` and the mean grey of the road in a band 1.5 to 4.5 m outside it, `ringL`, and the pixel count.
 */
export function cropStats(img, ring, pxm, erode) {
  const { w, h, rgb } = img;
  const lum = new Float32Array(w * h);
  for (let k = 0; k < w * h; k++) lum[k] = 0.3 * rgb[k * 3] + 0.59 * rgb[k * 3 + 1] + 0.11 * rgb[k * 3 + 2];
  let xa = Infinity, xb = -Infinity, ya = Infinity, yb = -Infinity;
  for (const [x, y] of ring) { xa = Math.min(xa, x); xb = Math.max(xb, x); ya = Math.min(ya, y); yb = Math.max(yb, y); }
  const reach = 4.5 / pxm;
  let n = 0, vf = 0, L = 0, ex = 0, rn = 0, rL = 0, rEx = 0;
  for (let y = Math.max(0, Math.floor(ya - reach)); y < Math.min(h, Math.ceil(yb + reach)); y++) {
    for (let x = Math.max(0, Math.floor(xa - reach)); x < Math.min(w, Math.ceil(xb + reach)); x++) {
      const inside = inRing(x + 0.5, y + 0.5, ring), d = edgeDistance(x + 0.5, y + 0.5, ring) * pxm;
      const k = (y * w + x) * 3, r = rgb[k], g = rgb[k + 1], b = rgb[k + 2], V = Math.max(r, g, b, 1);
      if (inside) {
        if (d < erode || V < 35) continue;
        n++; L += lum[y * w + x];
        const e = (2 * g - r - b) / V;
        ex += e;
        if (e > 0.07) vf++;
      } else if (d > 1.5 && d < 4.5) { rn++; rL += lum[y * w + x]; rEx += (2 * g - r - b) / V; }
    }
  }
  return { n, vf: n ? vf / n : 0, L: n ? L / n : 0, ringL: rn ? rL / rn : 0, greener: n && rn ? ex / n - rEx / rn : 0 };
}

/** The material from the 2025 crop's statistics: 'lawn', 'concrete' or 'paint'. An island
 *  with too few pixels to judge is left a lawn, as every median was before. */
export function materialOf(s25, width = 0) {
  if (s25.n < 8) return 'lawn';
  if (s25.vf >= PLANTED_SHARE || s25.greener >= GREENER) return 'lawn';
  // (the 2025 photograph alone: an island removed since the 2024 one, as Remembrance Drive's was, is still in that)
  return width < PAINT_WIDTH && Math.abs(s25.L - s25.ringL) <= PAINT_DL ? 'paint' : 'concrete';
}

/** The fixture tools/fixtures/median-materials.json: `entries` of { pt: [lon, lat], kind: 'concrete' | 'paint', ... }
 *  (a median not in it is lawn) */
export function loadMedianMaterials(file) {
  return JSON.parse(readFileSync(file, 'utf8')).entries || [];
}

/** The material of a median whose outline is `ring` (world metres), by the entries whose point lies inside it;
 *  `toWorld` turns an entry's lon/lat into world metres. `paint` wins over `concrete` where both are inside, as one
 *  island is one thing: the entry nearest the outline's middle decides. */
export function medianMaterial(entries, ring, toWorld) {
  let best = null, bd = Infinity;
  let cx = 0, cz = 0;
  for (const [x, z] of ring) { cx += x; cz += z; }
  cx /= ring.length; cz /= ring.length;
  for (const e of entries) {
    const [x, z] = toWorld(e.pt[0], e.pt[1]);
    if (!inRing(x, z, ring)) continue;
    const d = Math.hypot(x - cx, z - cz);
    if (d < bd) { bd = d; best = e; }
  }
  return best ? best.kind : 'lawn';
}
