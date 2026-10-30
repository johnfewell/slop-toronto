// tools/geo-pack.mjs — packs the GEO object into data/toronto-geodata.bin (format and reader: js/geodata-loader.js).
// Lossless: each column of numbers is stored as integers at the fewest decimals that reproduce every value exactly
// (Math.round(v * 10^d) / 10^d === v, the reader's own division: decimetres for the 0.1 m coordinates); a column no
// such count fits (the frame's projection constants) is stored as doubles.
// Each column's integers take the transform that deflates smallest: differences within each array, its tuples split
// field by field (x's, then z's...), or for a raster blob a 2-D prediction; then 1, 2 or 4 bytes, byte plane by plane.
// Deterministic: the same GEO gives the same bytes (gzip level 9, no file name or time in its header).
import zlib from 'node:zlib';

const isNumArr = (a) => Array.isArray(a) && a.length > 0 && a.every((x) => typeof x === 'number');
// the reader's rule: positions inside a short array holding anything but arrays (a tuple) keep their index
const isTuple = (a) => a.length <= 16 && a.some((x) => !Array.isArray(x) || isNumArr(x));

/** The fewest decimals (0-6) at which every value is an exact int32 count, -1 for none (store doubles) */
function decimals(values) {
  for (let d = 0; d <= 6; d++) {
    const p = 10 ** d;
    if (values.every((v) => { const i = Math.round(v * p); return i / p === v && Math.abs(i) < 2 ** 31; })) return d;
  }
  return -1;
}

// LOCO-I's median edge detector: the prediction of a raster cell from its left (a), upper (b) and upper-left (c)
const med = (a, b, c) => (c >= Math.max(a, b) ? Math.min(a, b) : c <= Math.min(a, b) ? Math.max(a, b) : a + b - c);

/** Natural order -> stored integers for one transform (js/geodata-loader.js `natural` is the inverse) */
function transform(v, t, runs) {
  const n = v.length, out = new Float64Array(n);
  if (t.med) {
    const W = t.med;
    for (let i = 0; i < n; i++) {
      const x = i % W, a = x ? v[i - 1] : i >= W ? v[i - W] : 0, b = i >= W ? v[i - W] : a, c = x && i >= W ? v[i - W - 1] : b;
      out[i] = v[i] - med(a, b, c);
    }
    return out;
  }
  const k = t.split, s = t.delta, m = n / k;
  for (const [r0, r1] of runs) {
    const o = r0 / k, c = (r1 - r0) / k;
    for (let j = 0; j < k; j++) {
      for (let i = 0; i < c; i++) {
        const src = r0 + i * k + j;
        out[j * m + o + i] = k > 1 ? v[src] - (s && i ? v[src - k] : 0) : v[src] - (s && i >= s ? v[src - s] : 0);
      }
    }
  }
  return out;
}

/** Integers -> the smallest stored form. `runs`: [start, end) of each array (differences restart in each) */
function packInts(ints, runs = [[0, ints.length]], rasterWidth = 0) {
  const cands = [0, 1, 2, 3, 4].map((delta) => ({ split: 1, delta }));
  for (const k of [2, 3, 4]) if (runs.every(([a, b]) => (b - a) % k === 0)) cands.push({ split: k, delta: 0 }, { split: k, delta: 1 });
  if (rasterWidth) cands.push({ med: rasterWidth });
  let best = null;
  for (const t of cands) {
    const v = transform(ints, t, runs);
    let lo = 0, hi = 0;
    for (const x of v) { if (x < lo) lo = x; if (x > hi) hi = x; }
    if (lo < -(2 ** 31) || hi >= 2 ** 31) continue; // (differences that leave int32)
    const w = lo >= -128 && hi <= 127 ? 1 : lo >= -32768 && hi <= 32767 ? 2 : 4;
    const n = v.length, bytes = Buffer.alloc(n * w);
    for (let i = 0; i < n; i++) for (let b = 0; b < w; b++) bytes[b * n + i] = (v[i] >> (8 * b)) & 255;
    const size = zlib.deflateRawSync(bytes, { level: 6 }).length;
    if (!best || size < best.size) best = { n, w, ...t, bytes, size };
  }
  return best;
}

/**
 * GEO -> gzip'd container. `blobs`: { 'terrain.data': { type: 'i16', width: 868 }, ... }: base64 strings to store as
 * their values (type i16, u16 or u8; width: a raster's row length, for the 2-D prediction).
 * Returns { file, raw, columns, headerBytes }.
 */
export function packGeo(GEO, blobs = {}) {
  GEO = JSON.parse(JSON.stringify(GEO)); // exactly what the JS file holds (no -0, no undefined keys)
  const cols = new Map(); // `${kind} ${path}` -> { kind, path, items }
  const col = (kind, path) => {
    const id = `${kind} ${JSON.stringify(path)}`;
    let c = cols.get(id);
    if (!c) cols.set(id, (c = { kind, path, items: [] }));
    return c;
  };
  const walk = (v, path) => {
    if (typeof v === 'number') { col('num', path).items.push(v); return 0; }
    if (typeof v === 'string' && blobs[path.join('.')]) { col('blob', path).items.push(v); return 2; }
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) {
      if (isNumArr(v)) { col('arr', path).items.push(v); return 1; }
      const tuple = isTuple(v);
      return v.map((x, i) => walk(x, [...path, tuple ? i : '*']));
    }
    const out = {};
    for (const k of Object.keys(v)) {
      if (k === '*') throw new Error('geo-pack: a key named * would clash with the array positions');
      out[k] = walk(v[k], [...path, k]);
    }
    return out;
  };
  const skeleton = walk(GEO, []);

  const sections = [];
  let off = 0;
  const put = (packed) => {
    const { bytes, size, ...t } = packed;
    const at = off;
    sections.push(bytes);
    off += bytes.length;
    const pad = (8 - (off % 8)) % 8;
    if (pad) { sections.push(Buffer.alloc(pad)); off += pad; }
    return { ...t, off: at };
  };
  const columns = [];
  for (const c of cols.values()) {
    if (c.kind === 'blob') {
      if (c.items.length !== 1) throw new Error(`geo-pack: blob ${c.path} occurs ${c.items.length} times`);
      const { type, width = 0 } = blobs[c.path.join('.')];
      const buf = Buffer.from(c.items[0], 'base64');
      if (buf.toString('base64') !== c.items[0]) throw new Error(`geo-pack: ${c.path} is not canonical base64`);
      const T = type === 'u16' ? Uint16Array : type === 'i16' ? Int16Array : Uint8Array;
      const values = Array.from(new T(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)));
      columns.push({ kind: 'blob', path: c.path, type, bytes: buf.length, ...put(packInts(values, undefined, width)) });
      continue;
    }
    const values = c.kind === 'num' ? c.items : c.items.flat();
    const runs = [];
    if (c.kind === 'arr') {
      let s = 0;
      for (const a of c.items) { runs.push([s, s + a.length]); s += a.length; }
    } else runs.push([0, values.length]);
    const d = decimals(values);
    let entry;
    if (d < 0) {
      entry = { kind: c.kind, path: c.path, d, ...put({ n: values.length, w: 8, bytes: Buffer.from(Float64Array.from(values).buffer) }) };
    } else {
      const p = 10 ** d;
      entry = { kind: c.kind, path: c.path, d, ...put(packInts(values.map((v) => Math.round(v * p)), runs)) };
    }
    if (c.kind === 'arr') entry.lens = put(packInts(c.items.map((a) => a.length)));
    columns.push(entry);
  }
  let json = Buffer.from(JSON.stringify({ format: 'toronto-geodata', version: 1, columns, skeleton }));
  const n = Math.ceil(json.length / 8) * 8;
  json = Buffer.concat([json, Buffer.alloc(n - json.length, 0x20)]);
  const head = Buffer.alloc(8);
  head.write('TGB1', 0, 'ascii');
  head.writeUInt32LE(n, 4);
  const raw = Buffer.concat([head, json, ...sections]);
  const file = zlib.gzipSync(raw, { level: 9 });
  return { file, raw, columns, headerBytes: n };
}
