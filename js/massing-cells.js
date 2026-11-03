// js/massing-cells.js — the ?massing=1 polygon buildings as compact cell meshes in three distance tiers
// (docs/massing-buildings.md, st-2nl.3). Pure functions with no three.js and no DOM: buildings.js packs its records
// with packInput, js/massing-worker.js runs buildMassingCells off the main thread (buildings.js falls back to running
// it here), and the tests run it in node.
//
// Meshes. One per facade material per tier per 1 km block (BLOCK), as the 1 km cells before; the facade styles of a
// material (the rendered ones, the curtain walls) share its meshes, each vertex naming its own (`variant`), so a block
// is two draws where it was up to five. Each block's four 500 m
// tier cells (SUB) have their buildings' triangles back to back in its index buffer (TIER_ORDER), so a mesh draws
// the cells now in its tier as at most two index ranges (tierRuns), and the draw count stays that of the 1 km cells.
//   near  the full outline: every wall of the outer ring and the courtyards, and the roof cap
//   mid   the rings simplified at MID_TOLERANCE (Douglas-Peucker), walls a neighbour covers for their whole height
//         left out (the neighbour's own wall stands within 0.35 m), courtyards under 4 m^2 left out
//   far   the buildings' boxes (GEO.buildings parts, as the default city draws them), on the same vertex format
// The tier of each 500 m cell follows its distance from the camera with a hysteresis band (nextTier).
//
// Vertex format, 16 bytes (was 17 floats, 68 bytes):
//   position  snorm16 x 4: x and z in decimetres from the block's origin (exact: the rings are on the decimetre grid),
//             y in Y_UNIT steps (only the CPU reads it: the shadow stand-ins, bounds), w = variant * 64 + level * 16 +
//             kind * 2 + along (variant: the building's facade style within its material, tsl-materials.js footprintStyled)
//             (level: which of the building's heights the vertex stands at, LEVEL; the shader takes y from the
//             building table, so the cap's 1.2 cm steps and every wall top stay exact; kind: WALL_KINDS; along: 0 or 1
//             at the wall's two ends, increasing along the world axis the wall mostly follows)
//   normal    snorm16 x 4: the wall's edge (dx, dz) in decimetres, (0, 0) on the roof cap, and the building's index in
//             the table as 15 + 15 bits. The shader derives the wall's width (its length) and outward normal (dz, -dx)
//             from the edge: exact, where an octahedral normal would round them, and both in 4 bytes. (The attribute
//             is called `normal` so three.js finds one; the materials decode it, tsl-materials.js footprintVertex)
// Building table, two RGBA float texels per building: (height, seed + tone, base, cap height) and its paint. The
// cells' tables lie back to back in one texture (TABLE_WIDTH texels a row), in block order; the shader reads it.
import earcut from './earcut.js';

export const BLOCK = 1000;
export const SUB = 500;
export const MID_TOLERANCE = 1.25;
export const SNORM = 32767;
export const XZ_UNIT = 0.1;
const PER_M = 10; // (decimetres per metre: multiplying by it is exact where dividing by XZ_UNIT is not)
export const LEVEL = { base: 0, top: 1, cap: 2, ground: 3 };
export const TIERS = ['near', 'mid', 'far'];
export const TABLE_WIDTH = 2048;
export const BYTES_PER_VERTEX = 16;
// the tier cells' order in a block's index buffer: (0, 0), (1, 0), (1, 1), (0, 1), round the block
export const TIER_ORDER = [0, 1, 3, 2]; // by local sx + 2 * sz
const REC = 10; // packed per record: cx, cz, base, h, capY, seed + tone, paint r, g, b, w
const MAX_VARIANTS = 8;
const KIND_REAR = 2, KIND_LOTLINE = 3;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Records -> transferable typed arrays. A record is { cx, cz, style (its material), variant (its facade style within
 * that material, 0 to 7), rings: [outer, ...holes] as [[x, z], ...] on the
 * decimetre grid, kinds: WALL_KINDS per outer edge (-1: no wall), cover?: per outer edge the roof height of the
 * neighbour against it (NaN: none), base, h, capY, tone, seed, paint: [r, g, b, w], boxes: [[x, z, w, d, ry], ...],
 * faces: the boxes' WALL_KINDS of their -u, +u, -v, +v walls }.
 */
export function packInput(records) {
  const n = records.length;
  let rings = 0, corners = 0, edges = 0, boxes = 0;
  for (const r of records) {
    rings += r.rings.length; edges += r.rings[0].length; boxes += r.boxes ? r.boxes.length : 0;
    for (const ring of r.rings) corners += ring.length;
  }
  const out = {
    n, rec: new Float64Array(n * REC), style: new Uint8Array(n), variant: new Uint8Array(n), ringsPer: new Uint16Array(n), boxesPer: new Uint16Array(n),
    ringCorners: new Int32Array(rings), xz: new Int32Array(corners * 2), kinds: new Int8Array(edges), cover: new Float32Array(edges),
    box: new Float64Array(boxes * 5), faces: new Int8Array(n * 4)
  };
  let ri = 0, ci = 0, ei = 0, bi = 0;
  records.forEach((r, i) => {
    const seedTone = (Math.floor(r.seed ?? i * 29) % 1000) + 0.1 + 0.8 * (r.tone ?? 0.5);
    const p = r.paint || [0.6, 0.6, 0.6, 0.5];
    out.rec.set([r.cx, r.cz, r.base || 0, r.h, r.capY ?? r.h, seedTone, p[0], p[1], p[2], p[3]], i * REC);
    out.style[i] = r.style || 0;
    out.variant[i] = r.variant || 0;
    if (!(out.variant[i] < MAX_VARIANTS)) throw new Error(`massing cells: variant ${r.variant}`);
    out.ringsPer[i] = r.rings.length;
    for (const ring of r.rings) {
      out.ringCorners[ri++] = ring.length;
      for (const [x, z] of ring) { out.xz[ci++] = Math.round(x / XZ_UNIT); out.xz[ci++] = Math.round(z / XZ_UNIT); }
    }
    const m = r.rings[0].length;
    for (let k = 0; k < m; k++, ei++) {
      out.kinds[ei] = r.kinds ? (r.kinds[k] ?? KIND_REAR) : KIND_REAR;
      out.cover[ei] = r.cover ? r.cover[k] ?? NaN : NaN;
    }
    out.boxesPer[i] = r.boxes ? r.boxes.length : 0;
    for (const b of r.boxes || []) { out.box.set(b, bi * 5); bi++; }
    out.faces.set(r.faces || [KIND_REAR, KIND_REAR, KIND_REAR, KIND_REAR], i * 4);
  });
  return out;
}

export const inputTransferables = (input) => [input.rec, input.style, input.variant, input.ringsPer, input.boxesPer, input.ringCorners, input.xz,
  input.kinds, input.cover, input.box, input.faces].map((a) => a.buffer);

// growable typed arrays
class Grow {
  constructor(Type, n = 4096) { this.Type = Type; this.a = new Type(n); this.n = 0; }
  push4(a, b, c, d) {
    if (this.n + 4 > this.a.length) this.grow(this.n + 4);
    const A = this.a, n = this.n; A[n] = a; A[n + 1] = b; A[n + 2] = c; A[n + 3] = d; this.n = n + 4;
  }
  push3(a, b, c) {
    if (this.n + 3 > this.a.length) this.grow(this.n + 3);
    const A = this.a, n = this.n; A[n] = a; A[n + 1] = b; A[n + 2] = c; this.n = n + 3;
  }
  grow(min) { const b = new this.Type(Math.max(min, this.a.length * 2)); b.set(this.a.subarray(0, this.n)); this.a = b; }
  done() { return this.a.slice(0, this.n); }
}

const signedArea = (X, Z) => { let a = 0; for (let i = 0, j = X.length - 1; i < X.length; j = i++) a += X[j] * Z[i] - X[i] * Z[j]; return a / 2; };

// a ring's corners without repeats, outer counter-clockwise (positive signed area in x, z), holes clockwise; `map`
// gives, for each of its edges, the edge of the ring as given (the kinds' order)
function orient(X, Z, outer) {
  const keep = [];
  for (let k = 0; k < X.length; k++) {
    const q = (k + X.length - 1) % X.length;
    if (X[k] !== X[q] || Z[k] !== Z[q]) keep.push(k);
  }
  let x = keep.map((k) => X[k]), z = keep.map((k) => Z[k]);
  const n = x.length;
  const flipped = (signedArea(X, Z) > 0) !== outer;
  if (flipped) { x.reverse(); z.reverse(); }
  // (kinds are given for the ring as listed; reversed, an edge's index moves with it, as createFootprintFacades did)
  const map = new Int32Array(n);
  for (let i = 0; i < n; i++) map[i] = flipped ? (2 * n - 2 - i) % n : i;
  return { x, z, map };
}

// Douglas-Peucker on a closed ring (decimetre integers, tolerance in decimetres): the kept corners' indices, in order
export function simplifyRing(x, z, tol) {
  const n = x.length;
  if (n <= 3) return Array.from({ length: n }, (_, i) => i);
  let far = 0, best = -1;
  for (let i = 1; i < n; i++) { const d = (x[i] - x[0]) ** 2 + (z[i] - z[0]) ** 2; if (d > best) { best = d; far = i; } }
  const keep = new Uint8Array(n);
  keep[0] = keep[far] = 1;
  const stack = [[0, far], [far, n]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const ax = x[a], az = z[a], bx = x[b % n], bz = z[b % n];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    let worst = -1, at = -1;
    for (let k = a + 1; k < b; k++) {
      // (to the segment, not its line: a spike running on past an end is no shortcut)
      const px = x[k % n] - ax, pz = z[k % n] - az;
      const t = L2 > 0 ? Math.max(0, Math.min(1, (px * dx + pz * dz) / L2)) : 0;
      const d = Math.hypot(px - t * dx, pz - t * dz);
      if (d > worst) { worst = d; at = k; }
    }
    if (worst > tol) { keep[at % n] = 1; stack.push([a, at], [at, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

// do any two edges of these rings cross or touch (other than neighbours sharing their corner)? Integer coordinates
function ringsCross(rings) {
  const segs = [];
  rings.forEach(({ x, z }, r) => { for (let i = 0; i < x.length; i++) segs.push([x[i], z[i], x[(i + 1) % x.length], z[(i + 1) % x.length], r, i, x.length]); });
  const orient3 = (ax, az, bx, bz, cx, cz) => Math.sign((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
  const onSeg = (ax, az, bx, bz, cx, cz) => Math.min(ax, bx) <= cx && cx <= Math.max(ax, bx) && Math.min(az, bz) <= cz && cz <= Math.max(az, bz);
  for (let i = 0; i < segs.length; i++) {
    const [ax, az, bx, bz, ra, ia, na] = segs[i];
    for (let j = i + 1; j < segs.length; j++) {
      const [cx, cz, dx, dz, rb, ib, nb] = segs[j];
      if (Math.max(ax, bx) < Math.min(cx, dx) || Math.max(cx, dx) < Math.min(ax, bx) || Math.max(az, bz) < Math.min(cz, dz) || Math.max(cz, dz) < Math.min(az, bz)) continue;
      const adjacent = ra === rb && ((ia + 1) % na === ib || (ib + 1) % nb === ia);
      const o1 = orient3(ax, az, bx, bz, cx, cz), o2 = orient3(ax, az, bx, bz, dx, dz);
      const o3 = orient3(cx, cz, dx, dz, ax, az), o4 = orient3(cx, cz, dx, dz, bx, bz);
      if (adjacent) {
        // neighbours share one corner; they may not fold back onto each other
        if (o1 === 0 && o2 === 0 && na > 2) {
          const shared = (ia + 1) % na === ib ? [bx, bz] : [ax, az];
          const other = (ia + 1) % na === ib ? [dx, dz] : [cx, cz];
          const back = (ia + 1) % na === ib ? [ax, az] : [bx, bz];
          if ((other[0] - shared[0]) * (back[0] - shared[0]) + (other[1] - shared[1]) * (back[1] - shared[1]) > 0) return true;
        }
        continue;
      }
      if (o1 !== o2 && o3 !== o4) return true;
      if (o1 === 0 && onSeg(ax, az, bx, bz, cx, cz)) return true;
      if (o2 === 0 && onSeg(ax, az, bx, bz, dx, dz)) return true;
      if (o3 === 0 && onSeg(cx, cz, dx, dz, ax, az)) return true;
      if (o4 === 0 && onSeg(cx, cz, dx, dz, bx, bz)) return true;
    }
  }
  return false;
}

/**
 * The mid tier's rings for one record: { rings: [{ x, z, kinds }], simplified } (kinds: per edge, -1 for no wall).
 * An edge of the simplified ring takes the kind of the most wall it replaces, or none when most of what it replaces
 * was hidden or covered by the neighbour for its whole height. A simplification that crosses itself (or a courtyard)
 * is not used: the record keeps its full rings, with the same rule for the covered walls.
 */
export function midRings(outer, holes, kindOf, coveredFull, tol) {
  const lenOf = (r, i) => Math.hypot(r.x[(i + 1) % r.x.length] - r.x[i], r.z[(i + 1) % r.x.length] - r.z[i]);
  const spanKind = (r, from, to, own) => {
    // the original edges from..to-1 (mod n): their kinds weighted by length
    const n = r.x.length, w = new Map();
    let none = 0, all = 0;
    for (let i = from; i !== to; i = (i + 1) % n) {
      const L = lenOf(r, i), k = own ? kindOf(i) : KIND_REAR;
      all += L;
      if (k < 0 || (own && coveredFull(i))) { none += L; continue; }
      w.set(k, (w.get(k) || 0) + L);
    }
    if (none >= all / 2 || !w.size) return -1;
    return [...w].sort((p, q) => q[1] - p[1] || p[0] - q[0])[0][0];
  };
  const take = (r, own, idx) => {
    const n = r.x.length, x = idx.map((i) => r.x[i]), z = idx.map((i) => r.z[i]);
    const kinds = idx.map((from, k) => spanKind(r, from, idx[(k + 1) % idx.length], own));
    void n;
    return { x, z, kinds };
  };
  const full = (r, own) => take(r, own, r.x.map((_, i) => i));
  const so = simplifyRing(outer.x, outer.z, tol);
  if (so.length >= 3) {
    const o = take(outer, true, so);
    const hs = [];
    for (const h of holes) {
      const sh = simplifyRing(h.x, h.z, tol);
      if (sh.length < 3) continue;
      const t = take(h, false, sh);
      if (Math.abs(signedArea(t.x, t.z)) * XZ_UNIT * XZ_UNIT < 4) continue;
      hs.push(t);
    }
    const area = signedArea(o.x, o.z);
    if (area > 0 && !ringsCross([o, ...hs]) && hs.every((h) => signedArea(h.x, h.z) < 0)) return { rings: [o, ...hs], simplified: true };
  }
  return { rings: [full(outer, true), ...holes.map((h) => full(h, false))], simplified: false };
}

// one block-style's geometry for one tier
class TierGeometry {
  constructor(ox, oz) { this.ox = ox; this.oz = oz; this.variant = 0; this.pos = new Grow(Int16Array); this.edge = new Grow(Int16Array); this.idx = new Grow(Uint32Array); this.wallCount = 0; }
  vert(X, yq, Z, level, kind, along, dx, dz, b) {
    const code = this.variant * 64 + level * 16 + kind * 2 + along;
    const x = X - this.ox, z = Z - this.oz;
    if (!(Math.abs(x) <= SNORM && Math.abs(z) <= SNORM && Math.abs(dx) <= SNORM && Math.abs(dz) <= SNORM && yq <= SNORM)) {
      throw new Error(`massing cells: a corner ${x / PER_M}, ${z / PER_M} m from its block's centre is out of range`);
    }
    this.pos.push4(x, yq, z, code);
    this.edge.push4(dx, dz, b & 0x7fff, b >> 15);
    return this.pos.n / 4 - 1;
  }
  // walls along a ring (x, z: decimetres, oriented), standing at levels lo..hi (yLo, yHi quantized)
  walls(x, z, kinds, lo, hi, yLo, yHi, b) {
    const n = x.length;
    for (let i = 0; i < n; i++) {
      const kind = kinds[i];
      if (kind < 0) continue;
      const ax = x[i], az = z[i], bx = x[(i + 1) % n], bz = z[(i + 1) % n];
      const dx = bx - ax, dz = bz - az;
      if (!(Math.hypot(dx, dz) * XZ_UNIT > 1e-3)) continue;
      // (in metres as the decoded rings hold them, X / 10: on a 45-degree wall, which axis wins is float rounding, and
      // it must be the same rounding as the pilot's, so the wall's windows start from the same end)
      const mx = bx / PER_M - ax / PER_M, mz = bz / PER_M - az / PER_M;
      const reverse = (Math.abs(mz) >= Math.abs(mx) ? mz : mx) < 0;
      const o = this.vert(ax, yLo, az, lo, kind, reverse ? 1 : 0, dx, dz, b);
      this.vert(bx, yLo, bz, lo, kind, reverse ? 0 : 1, dx, dz, b);
      this.vert(ax, yHi, az, hi, kind, reverse ? 1 : 0, dx, dz, b);
      this.vert(bx, yHi, bz, hi, kind, reverse ? 0 : 1, dx, dz, b);
      // counter-clockwise seen from outside: (a1 - a0) x (b0 - a0) points along the normal (dz, -dx)
      this.idx.push3(o, o + 2, o + 1); this.idx.push3(o + 2, o + 3, o + 1);
      this.wallCount++;
    }
  }
  // the flat roof cap over the outer ring and its courtyards, facing up
  cap(rings, level, yq, b) {
    const flat = [], holes = [];
    for (let r = 0; r < rings.length; r++) {
      if (r) holes.push(flat.length / 2);
      for (let i = 0; i < rings[r].x.length; i++) flat.push(rings[r].x[i], rings[r].z[i]);
    }
    const tris = earcut(flat, holes.length ? holes : null);
    const o = this.pos.n / 4;
    for (let i = 0; i < flat.length; i += 2) this.vert(flat[i], yq, flat[i + 1], level, 0, 0, 0, 0, b);
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], c = tris[t + 1], d = tris[t + 2];
      const cross = (flat[c * 2 + 1] - flat[a * 2 + 1]) * (flat[d * 2] - flat[a * 2]) - (flat[c * 2] - flat[a * 2]) * (flat[d * 2 + 1] - flat[a * 2 + 1]);
      if (cross > 0) this.idx.push3(o + a, o + c, o + d); else this.idx.push3(o + a, o + d, o + c);
    }
  }
}

/**
 * packInput's arrays -> { blocks: [{ bx, bz, style, ox, oz, tiers: [{ position, normal, index, ranges, sphere, walls }
 * x 3] }], table, order (table row -> record), cells: [{ sx, sz, maxY }], yUnit, stats }. Every array is a transferable typed array
 * (transferables()). Block order, record order within a block's tier cells, and so every index and byte, depend only
 * on the input.
 */
export function buildMassingCells(input, opts = {}) {
  const t0 = now();
  const tol = (opts.midTolerance ?? MID_TOLERANCE) / XZ_UNIT;
  const { n, rec, style, variant, ringsPer, boxesPer, ringCorners, xz, kinds, cover, box, faces } = input;
  // offsets per record
  const ring0 = new Int32Array(n + 1), corner0 = new Int32Array(n + 1), edge0 = new Int32Array(n + 1), box0 = new Int32Array(n + 1);
  let rc = 0, cc = 0;
  for (let i = 0; i < n; i++) {
    ring0[i + 1] = ring0[i] + ringsPer[i];
    edge0[i + 1] = edge0[i] + ringCorners[ring0[i]];
    box0[i + 1] = box0[i] + boxesPer[i];
    for (let r = ring0[i]; r < ring0[i + 1]; r++) cc += ringCorners[r];
    corner0[i + 1] = cc;
    rc += ringsPer[i];
  }
  void rc;
  // heights: one y step for the whole city (the shader reads it), centimetres unless something stands higher
  let maxY = 0;
  for (let i = 0; i < n; i++) maxY = Math.max(maxY, rec[i * REC + 3], rec[i * REC + 4]);
  const yUnit = Math.max(0.01, Math.ceil((maxY + 1) / SNORM * 1000) / 1000);
  const yq = (y) => Math.round(y / yUnit);
  // records by block and style, each block's in tier-cell order
  const groups = new Map(), cells = new Map();
  for (let i = 0; i < n; i++) {
    const cx = rec[i * REC], cz = rec[i * REC + 1];
    const bx = Math.floor(cx / BLOCK), bz = Math.floor(cz / BLOCK);
    const sx = Math.floor(cx / SUB), sz = Math.floor(cz / SUB);
    const sub = TIER_ORDER[(sx - bx * 2) + 2 * (sz - bz * 2)];
    const key = `${bx},${bz},${style[i]}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { bx, bz, style: style[i], subs: [[], [], [], []] }));
    g.subs[sub].push(i);
    const ck = `${sx},${sz}`;
    const c = cells.get(ck) || cells.set(ck, { sx, sz, maxY: 0 }).get(ck);
    c.maxY = Math.max(c.maxY, rec[i * REC + 3]);
  }
  const keys = [...groups.keys()].sort((p, q) => {
    const a = groups.get(p), b = groups.get(q);
    return a.bz - b.bz || a.bx - b.bx || a.style - b.style;
  });
  const table = new Float32Array(Math.ceil(Math.max(1, n * 2) / TABLE_WIDTH) * TABLE_WIDTH * 4);
  const stats = { records: n, blocks: keys.length, simplified: 0, midKept: 0, coveredDropped: 0, tiers: TIERS.map((name) => ({ name, vertices: 0, triangles: 0, walls: 0, bytes: 0 })) };
  const blocks = [];
  const order = new Int32Array(n); // table row -> input record
  let b = 0;
  for (const key of keys) {
    const g = groups.get(key);
    const oxm = g.bx * BLOCK + BLOCK / 2, ozm = g.bz * BLOCK + BLOCK / 2; // (the block's centre, m)
    const ox = oxm * PER_M, oz = ozm * PER_M;
    const T = [new TierGeometry(ox, oz), new TierGeometry(ox, oz), new TierGeometry(ox, oz)];
    const ranges = [new Uint32Array(8), new Uint32Array(8), new Uint32Array(8)];
    for (let s = 0; s < 4; s++) {
      for (let t = 0; t < 3; t++) ranges[t][s * 2] = T[t].idx.n;
      for (const i of g.subs[s]) {
        const o = i * REC, base = rec[o + 2], h = rec[o + 3], capY = rec[o + 4];
        table.set([h, rec[o + 5], base, capY, rec[o + 6], rec[o + 7], rec[o + 8], rec[o + 9]], b * 8);
        order[b] = i;
        if (!(h > base) || ringCorners[ring0[i]] < 3) { b++; continue; }
        for (const G of T) G.variant = variant[i];
        // the rings, oriented, with the outer's kinds in its own order
        const rings = [];
        let c = corner0[i];
        for (let r = ring0[i]; r < ring0[i + 1]; r++) {
          const m = ringCorners[r], X = new Array(m), Z = new Array(m);
          for (let k = 0; k < m; k++, c++) { X[k] = xz[c * 2]; Z[k] = xz[c * 2 + 1]; }
          rings.push(orient(X, Z, r === ring0[i]));
        }
        const e0 = edge0[i];
        const outer = rings[0];
        const outerKinds = Array.from(outer.map, (k) => kinds[e0 + k]);
        // near: the full rings, every wall but the hidden ones
        T[0].walls(outer.x, outer.z, outerKinds, LEVEL.base, LEVEL.top, yq(base), yq(h), b);
        for (let r = 1; r < rings.length; r++) T[0].walls(rings[r].x, rings[r].z, rings[r].x.map(() => KIND_REAR), LEVEL.base, LEVEL.top, yq(base), yq(h), b);
        T[0].cap(rings, LEVEL.cap, yq(capY), b);
        // mid: simplified, without the walls the neighbour covers whole
        const coveredFull = (k) => outerKinds[k] === KIND_LOTLINE && cover[e0 + outer.map[k]] >= h - 0.01;
        const mid = midRings(outer, rings.slice(1), (k) => outerKinds[k], coveredFull, tol);
        if (mid.simplified) stats.simplified++; else stats.midKept++;
        for (let k = 0; k < outerKinds.length; k++) if (outerKinds[k] >= 0 && coveredFull(k)) stats.coveredDropped++;
        mid.rings.forEach((r) => T[1].walls(r.x, r.z, r.kinds, LEVEL.base, LEVEL.top, yq(base), yq(h), b));
        T[1].cap(mid.rings, LEVEL.cap, yq(capY), b);
        // far: the boxes, from the ground, capped at the full height (as the default city's boxes)
        for (let k = box0[i]; k < box0[i + 1]; k++) {
          const [x, z, w, d, ry] = box.subarray(k * 5, k * 5 + 5);
          const cs = Math.cos(ry), sn = Math.sin(ry);
          const P = (u, v) => [Math.round((x + u * cs + v * sn) / XZ_UNIT), Math.round((z - u * sn + v * cs) / XZ_UNIT)];
          const corners = [P(-w / 2, -d / 2), P(w / 2, -d / 2), P(w / 2, d / 2), P(-w / 2, d / 2)];
          const f = faces.subarray(i * 4, i * 4 + 4);
          const ringKinds = [f[2], f[1], f[3], f[0]]; // -v, +u, +v, -u
          const r = orient(corners.map((p) => p[0]), corners.map((p) => p[1]), true);
          T[2].walls(r.x, r.z, Array.from(r.map, (m) => ringKinds[m]), LEVEL.ground, LEVEL.top, 0, yq(h), b);
          T[2].cap([r], LEVEL.top, yq(h), b);
        }
        b++;
      }
      for (let t = 0; t < 3; t++) ranges[t][s * 2 + 1] = T[t].idx.n - ranges[t][s * 2];
    }
    blocks.push({
      bx: g.bx, bz: g.bz, style: g.style, ox: oxm, oz: ozm,
      tiers: T.map((G, t) => {
        const position = G.pos.done(), normal = G.edge.done(), idx = G.idx.done();
        const vertices = position.length / 4;
        const index = vertices > 65535 ? idx : Uint16Array.from(idx);
        // bounds (world metres): the box of its vertices
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (let v = 0; v < position.length; v += 4) {
          const x = position[v], y = position[v + 1], z = position[v + 2];
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
        }
        const sphere = vertices ? [(x0 + x1) / 2 * XZ_UNIT + oxm, (y0 + y1) / 2 * yUnit, (z0 + z1) / 2 * XZ_UNIT + ozm,
          Math.hypot((x1 - x0) * XZ_UNIT, (y1 - y0) * yUnit, (z1 - z0) * XZ_UNIT) / 2] : [0, 0, 0, 0];
        const st = stats.tiers[t];
        st.vertices += vertices; st.triangles += idx.length / 3; st.walls += G.wallCount;
        st.bytes += position.byteLength + normal.byteLength + index.byteLength;
        return { position, normal, index, ranges: ranges[t], sphere, walls: G.wallCount };
      })
    });
  }
  stats.tableBytes = table.byteLength;
  stats.ms = Math.round((now() - t0) * 10) / 10;
  return { blocks, table, order, tableWidth: TABLE_WIDTH, cells: [...cells.values()].sort((p, q) => p.sz - q.sz || p.sx - q.sx), yUnit, stats };
}

export const outputTransferables = (out) => [out.table.buffer, out.order.buffer, ...out.blocks.flatMap((b) => b.tiers.flatMap((t) => [t.position.buffer, t.normal.buffer, t.index.buffer, t.ranges.buffer]))];

/**
 * The tier (0 near, 1 mid, 2 far) of a cell `d` m from the camera, given its tier before (-1: none yet): it moves out
 * a tier only once beyond that tier's limit plus `band`, and back in only once within the limit minus `band`, so a
 * camera standing on a limit never flips it. `limits`: [near, mid] (m); needs near + band < mid - band.
 */
export function nextTier(prev, d, limits, band) {
  if (!(d >= 0)) return prev < 0 ? 0 : prev; // (NaN keeps what it had)
  let t = prev < 0 ? (d < limits[0] ? 0 : d < limits[1] ? 1 : 2) : prev;
  while (t < 2 && d > limits[t] + band) t++;
  while (t > 0 && d < limits[t - 1] - band) t--;
  return t;
}

// distance (m) from (px, py, pz) to a tier cell's box (its 500 m square, from the ground to its tallest building)
export function cellDistance(cell, px, py, pz) {
  const x0 = cell.sx * SUB, z0 = cell.sz * SUB;
  const dx = Math.max(x0 - px, 0, px - x0 - SUB), dz = Math.max(z0 - pz, 0, pz - z0 - SUB), dy = Math.max(-py, 0, py - cell.maxY);
  return Math.hypot(dx, dy, dz);
}

/**
 * The index ranges a block mesh draws for tier `t`: `ranges` its four tier cells' [start, count] (TIER_ORDER),
 * `tiers` their tiers in that order. Adjacent cells merge (an empty cell never splits a run), so there are at most
 * two: [[start, count], ...].
 */
export function tierRuns(ranges, tiers, t) {
  const runs = [];
  let open = false;
  for (let s = 0; s < 4; s++) {
    const start = ranges[s * 2], count = ranges[s * 2 + 1];
    if (!count) continue;
    if (tiers[s] !== t) { open = false; continue; }
    const last = runs[runs.length - 1];
    if (open && last[0] + last[1] === start) last[1] += count;
    else { runs.push([start, count]); open = true; }
  }
  return runs;
}

/**
 * What the shader reads at vertex `v` of a tier geometry, as tsl-materials.js decodes it (for the tests and tools):
 * { x, y, z (world m), normal, box: [width, height, 0, seed + tone], wall: [along, metres below the top, kind],
 * paint, building, variant }.
 */
export function decodeVertex(block, tier, v, table, yUnit) {
  const T = block.tiers[tier], p = T.position, e = T.normal;
  const w = p[v * 4 + 3], variant = w >> 6, level = (w >> 4) & 3, kind = (w >> 1) & 7, along = w & 1;
  const building = e[v * 4 + 2] + e[v * 4 + 3] * 32768;
  const t = table.subarray(building * 8, building * 8 + 8);
  const h = t[0], y = [t[2], t[0], t[3], 0][level];
  const dx = e[v * 4] * XZ_UNIT, dz = e[v * 4 + 1] * XZ_UNIT, len = Math.hypot(dx, dz);
  return {
    x: block.ox + p[v * 4] * XZ_UNIT, y, yStored: p[v * 4 + 1] * yUnit, z: block.oz + p[v * 4 + 2] * XZ_UNIT,
    normal: len > 0 ? [dz / len, 0, -dx / len] : [0, 1, 0],
    box: [len > 0 ? len : 1, h, 0, t[1]], wall: [along, h - y, kind], paint: [t[4], t[5], t[6], t[7]], building, variant
  };
}
