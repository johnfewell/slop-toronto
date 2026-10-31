// tools/tiff-f32.mjs — a minimal GeoTIFF reader for single-band float32 rasters (the lidar DTM tiles,
// tools/fetch-don-valley-dtm.mjs): little- or big-endian, tiled or stripped, uncompressed, LZW (5) or Deflate (8, 32946),
// no predictor or the floating-point predictor (3). Returns { width, height, data: Float32Array (row 0 = north),
// origin: [x, y] of the north-west corner, pixel: [sx, sy], noData }.
import zlib from 'node:zlib';

function lzw(src, expected) {
  const out = new Uint8Array(expected);
  let o = 0, bit = 0, width = 9, prev = null;
  let dict = [];
  const reset = () => { dict = []; for (let i = 0; i < 256; i++) dict.push(Uint8Array.of(i)); dict.push(null, null); width = 9; };
  reset();
  const read = () => {
    let v = 0;
    for (let i = 0; i < width; i++) {
      const byte = src[(bit >> 3)] ?? 0;
      v = (v << 1) | ((byte >> (7 - (bit & 7))) & 1);
      bit++;
    }
    return v;
  };
  while ((bit >> 3) < src.length) {
    const code = read();
    if (code === 257) break;
    if (code === 256) { reset(); prev = null; continue; }
    let entry;
    if (code < dict.length && dict[code]) entry = dict[code];
    else if (code === dict.length && prev) { entry = new Uint8Array(prev.length + 1); entry.set(prev); entry[prev.length] = prev[0]; }
    else throw new Error(`tiff: bad LZW code ${code}`);
    if (o + entry.length > out.length) { out.set(entry.subarray(0, out.length - o), o); o = out.length; break; }
    out.set(entry, o); o += entry.length;
    if (prev) { const e = new Uint8Array(prev.length + 1); e.set(prev); e[prev.length] = entry[0]; dict.push(e); }
    prev = entry;
    // (TIFF's LZW switches width one code early)
    if (dict.length + 1 >= 1 << width && width < 12) width++;
  }
  return out;
}

export function readTiffF32(buf) {
  const le = buf.toString('ascii', 0, 2) === 'II';
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o)), u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const f64 = (o) => (le ? buf.readDoubleLE(o) : buf.readDoubleBE(o));
  if (u16(2) !== 42) throw new Error('tiff: not a classic TIFF');
  const ifd = u32(4), n = u16(ifd), size = { 1: 1, 2: 1, 3: 2, 4: 4, 11: 4, 12: 8, 16: 8 };
  const tags = {};
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12, tag = u16(e), type = u16(e + 2), cnt = u32(e + 4), bytes = size[type] * cnt, off = bytes <= 4 ? e + 8 : u32(e + 8);
    const v = [];
    if (type === 2) tags[tag] = buf.toString('ascii', off, off + cnt).replace(/\0+$/, '');
    else {
      for (let k = 0; k < cnt; k++) { const p = off + k * size[type]; v.push(type === 3 ? u16(p) : type === 4 ? u32(p) : type === 12 ? f64(p) : buf[p]); }
      tags[tag] = v;
    }
  }
  const width = tags[256][0], height = tags[257][0], bits = tags[258]?.[0] ?? 1, comp = tags[259]?.[0] ?? 1, fmt = tags[339]?.[0] ?? 1;
  const spp = tags[277]?.[0] ?? 1, pred = tags[317]?.[0] ?? 1;
  if (bits !== 32 || fmt !== 3 || spp !== 1) throw new Error(`tiff: want one float32 band, got ${spp} x ${bits} bit format ${fmt}`);
  const tiled = !!tags[322];
  const tw = tiled ? tags[322][0] : width, th = tiled ? tags[323][0] : (tags[278]?.[0] ?? height);
  const offsets = tiled ? tags[324] : tags[273], counts = tiled ? tags[325] : tags[279];
  const across = Math.ceil(width / tw);
  const data = new Float32Array(width * height);
  const dv = new DataView(new ArrayBuffer(tw * th * 4));
  for (let t = 0; t < offsets.length; t++) {
    const src = buf.subarray(offsets[t], offsets[t] + counts[t]);
    const rows = tiled ? th : Math.min(th, height - t * th), expected = tw * rows * 4;
    let raw = comp === 1 ? new Uint8Array(src) : comp === 5 ? lzw(src, expected) : comp === 8 || comp === 32946 ? new Uint8Array(zlib.inflateSync(src)) : null;
    if (!raw) throw new Error(`tiff: compression ${comp} not supported`);
    if (pred === 3) {
      // floating-point predictor: byte differences across the row, then bytes regrouped most significant first
      const rowBytes = tw * 4, out = new Uint8Array(raw.length);
      for (let r = 0; r < rows; r++) {
        const row = raw.subarray(r * rowBytes, (r + 1) * rowBytes);
        for (let i = 1; i < rowBytes; i++) row[i] = (row[i] + row[i - 1]) & 255;
        for (let i = 0; i < tw; i++) for (let b = 0; b < 4; b++) out[r * rowBytes + i * 4 + (le ? 3 - b : b)] = row[b * tw + i];
      }
      raw = out;
    } else if (pred !== 1) throw new Error(`tiff: predictor ${pred} not supported`);
    new Uint8Array(dv.buffer).set(raw.subarray(0, Math.min(raw.length, dv.byteLength)));
    const x0 = tiled ? (t % across) * tw : 0, y0 = tiled ? Math.floor(t / across) * th : t * th;
    for (let r = 0; r < rows && y0 + r < height; r++) for (let c = 0; c < tw && x0 + c < width; c++) {
      data[(y0 + r) * width + x0 + c] = dv.getFloat32((r * tw + c) * 4, le);
    }
  }
  const scale = tags[33550] || [1, 1], tie = tags[33922] || [0, 0, 0, 0, 0, 0];
  const noData = tags[42113] != null ? Number(tags[42113]) : null;
  return { width, height, data, origin: [tie[3] - tie[0] * scale[0], tie[4] + tie[1] * scale[1]], pixel: [scale[0], scale[1]], noData };
}
