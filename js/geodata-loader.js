// js/geodata-loader.js — reads data/toronto-geodata.bin (written by tools/build-geodata.mjs, encoder tools/geo-pack.mjs)
// back into the very object js/toronto-geodata.js holds: window.CITY.GEO, the same keys, arrays and numbers (lossless:
// every number is stored as an integer count of its own decimals, e.g. decimetres for the 0.1 m coordinates, and
// divided back here, which gives the same double as parsing the JS file's decimal text).
// The page (explore.html) fetches the file while three.js loads and sets window.CITY.GEO before the classic scripts
// run, so no consumer changes. tests/geodata-binary.test.mjs compares it against js/toronto-geodata.js key by key.
//
// File: gzip (the site's hosts compress JS but not application/octet-stream, so it ships compressed) of the container
//   bytes 0-3 'TGB1', 4-7 uint32 LE header length N (a multiple of 8), 8..8+N UTF-8 JSON header, then the payload
//   (8-aligned sections). Header: { skeleton, columns }. The skeleton is GEO with every number replaced by a marker:
//   0 a number, 1 an array of numbers, 2 a base64 string (raw bytes in the payload). Each marker's value comes next
//   from the column of its path (object keys; array positions as '*', or the index inside short mixed tuples), so
//   like numbers sit together and compress well. Columns hold integers (`d` decimals; 1, 2 or 4 bytes stored byte
//   plane by byte plane, after the transform `natural` undoes) or, where no integer count fits (`d` -1), doubles.
//   Values are read in the skeleton's order.

const MAGIC = 0x31424754; // 'TGB1' little-endian

/** Integers of a stored column, in stored order: undo the byte planes and the width */
function readInts(u8, base, c) {
  const { n, w, off } = c;
  if (w === 8) return new Float64Array(u8.slice(base + off, base + off + n * 8).buffer); // doubles, as they are
  const out = new Int32Array(n);
  const p = u8.subarray(base + off, base + off + n * w);
  if (w === 1) for (let i = 0; i < n; i++) out[i] = (p[i] << 24) >> 24;
  else if (w === 2) for (let i = 0; i < n; i++) out[i] = ((p[i] | (p[n + i] << 8)) << 16) >> 16;
  else for (let i = 0; i < n; i++) out[i] = p[i] | (p[n + i] << 8) | (p[2 * n + i] << 16) | (p[3 * n + i] << 24);
  return out;
}

// LOCO-I's median edge detector: a raster cell predicted from its left (a), upper (b) and upper-left (c)
const med = (a, b, c) => (c >= Math.max(a, b) ? Math.min(a, b) : c <= Math.min(a, b) ? Math.max(a, b) : a + b - c);

/**
 * Stored order -> the values in their natural order (tools/geo-pack.mjs `transform` is the inverse): `med` a 2-D
 * prediction over rows of that length; else `split` k fields stored field by field (all x's, then all z's...) and
 * `delta` differences (with a split, from the previous tuple's same field), restarting in each array of `runs`.
 */
function natural(ints, c, runs) {
  if (c.w === 8) return ints;
  const n = ints.length, out = new Float64Array(n);
  if (c.med) {
    const W = c.med;
    for (let i = 0; i < n; i++) {
      const x = i % W, a = x ? out[i - 1] : i >= W ? out[i - W] : 0, b = i >= W ? out[i - W] : a, cc = x && i >= W ? out[i - W - 1] : b;
      out[i] = ints[i] + med(a, b, cc);
    }
    return out;
  }
  const k = c.split, s = c.delta, m = n / k;
  for (const [r0, r1] of runs) {
    const cnt = (r1 - r0) / k;
    if (k === 1) {
      for (let i = 0; i < cnt; i++) out[r0 + i] = ints[r0 + i] + (s && i >= s ? out[r0 + i - s] : 0);
      continue;
    }
    for (let j = 0; j < k; j++) {
      const at = j * m + r0 / k;
      for (let i = 0; i < cnt; i++) {
        const dst = r0 + i * k + j;
        out[dst] = ints[at + i] + (s && i ? out[dst - k] : 0);
      }
    }
  }
  return out;
}

function toBase64(bytes) {
  if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** A column's values, handed out in order: numbers, arrays of numbers or base64 strings */
function column(u8, base, c) {
  const ints = readInts(u8, base, c);
  if (c.kind === 'blob') {
    const T = c.type === 'u16' ? Uint16Array : c.type === 'i16' ? Int16Array : Uint8Array;
    const typed = T.from(natural(ints, c, [[0, ints.length]]));
    const b64 = toBase64(new Uint8Array(typed.buffer, 0, c.bytes));
    return { next: () => b64 };
  }
  const p = c.d < 0 ? 1 : 10 ** c.d;
  if (c.kind === 'num') {
    const v = natural(ints, c, [[0, ints.length]]);
    let k = 0;
    return { next: () => (p === 1 ? v[k++] : v[k++] / p) };
  }
  // arrays: their lengths, then their values back to back
  const lens = natural(readInts(u8, base, c.lens), c.lens, [[0, c.lens.n]]);
  const runs = new Array(lens.length);
  for (let a = 0, s = 0; a < lens.length; s += lens[a++]) runs[a] = [s, s + lens[a]];
  const v = natural(ints, c, runs);
  let k = 0, a = 0;
  return {
    next() {
      const len = lens[a++], out = new Array(len);
      if (p === 1) for (let i = 0; i < len; i++) out[i] = v[k + i];
      else for (let i = 0; i < len; i++) out[i] = v[k + i] / p;
      k += len;
      return out;
    }
  };
}

/** The container (uncompressed) -> the GEO object */
export function decodeGeo(buffer) {
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('geodata: not a TGB1 file');
  const n = dv.getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + n)));
  const base = 8 + n;
  // the columns hang off a tree of paths, so the walk below finds each by one lookup per step
  const root = { kids: new Map() };
  const at = (node, key) => {
    let k = node.kids.get(key);
    if (!k) node.kids.set(key, (k = { kids: new Map() }));
    return k;
  };
  const MARK = { num: 0, arr: 1, blob: 2 };
  for (const c of head.columns) {
    let node = root;
    for (const key of c.path) node = at(node, key);
    node[MARK[c.kind]] = column(u8, base, c);
  }
  const build = (sk, node) => {
    if (typeof sk === 'number') return node[sk].next();
    if (sk === null || typeof sk !== 'object') return sk;
    if (Array.isArray(sk)) {
      const tuple = sk.length <= 16 && sk.some((x) => !Array.isArray(x));
      const out = new Array(sk.length);
      const any = tuple ? null : at(node, '*');
      for (let i = 0; i < sk.length; i++) out[i] = build(sk[i], any || at(node, i));
      return out;
    }
    const out = {};
    for (const key of Object.keys(sk)) out[key] = build(sk[key], at(node, key));
    return out;
  };
  return build(head.skeleton, root);
}

/** The file as fetched (gzip, or already inflated by a server that sent it with a Content-Encoding) -> GEO */
export async function unpackGeo(buffer) {
  const u8 = new Uint8Array(buffer);
  if (u8[0] !== 0x1f || u8[1] !== 0x8b) return decodeGeo(u8);
  const inflated = new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip')));
  return decodeGeo(await inflated.arrayBuffer());
}

/**
 * The fetch (a URL, or a fetch already under way: the page starts it before this module has loaded) -> GEO.
 * Leaves a 'geodata-decode' performance measure (inflate + decode, main thread).
 */
export async function loadGeo(request) {
  const res = await (typeof request === 'string' ? fetch(request) : request);
  if (!res.ok) throw new Error(`geodata: ${res.url}: HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();
  const t = performance.now();
  const GEO = await unpackGeo(buffer);
  performance.measure('geodata-decode', { start: t, end: performance.now(), detail: { bytes: buffer.byteLength } });
  return GEO;
}
