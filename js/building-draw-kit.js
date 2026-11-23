// js/building-draw-kit.js — the drawing helpers the house, shop, apartment, tower and worship planners share (st-ndw9.20 moved them
// here from js/building-draw.js so that js/building-draw-tall.js and js/building-draw-worship.js need not import it back: the site
// build refuses cyclic imports). Pure functions with no three.js and no DOM.
//   - random streams: stream(id, label), a generator seeded by a hash of a building's durable id and a label;
//   - writer(A): flat-coloured triangles and roof planes into the hipped roofs' accumulator { pos, nor, uv, col };
//   - makeFrame, gableRoof, hipRoof, slab (a tar-and-gravel roof), tarRgb.

import { ROOF_TAR } from './building-prototypes.js';

export const WALL = { shop: 0, entry: 1, rear: 2, lotLine: 3, blankStone: 4 };

// ---- random streams ----------------------------------------------------------------------------------------------------
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return h >>> 0;
}
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const stream = (id, label) => mulberry32(hash32(`${id}|${label}`));
export const weighted = (table, r) => {
  let total = 0;
  for (const [, w] of table) total += w;
  let t = r * total;
  for (const [v, w] of table) { t -= w; if (t < 0) return v; }
  return table[table.length - 1][0];
};
export const lerp = (r, [a, b]) => a + (b - a) * r;
export const rad = (deg) => deg * Math.PI / 180;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---- triangle writer ---------------------------------------------------------------------------------------------------
// Writes into the hipped roofs' accumulator { pos, nor, uv, col } exactly as buildings.js pushHipRoof does (flat
// normals, uv = metres along the eave & up the slope for the tile rows, per-vertex colour).
export function writer(A) {
  const norm = (a, b, c) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    return [nx / l, ny / l, nz / l];
  };
  const W = {
    tris: 0,
    // a roof plane: the normal is kept upward; uv.y runs up the slope in metres
    slope(a, b, c, col, yBase, pitch) {
      let n = norm(a, b, c);
      if (n[1] < 0) { [b, c] = [c, b]; n = [-n[0], -n[1], -n[2]]; }
      const s = Math.max(0.2, Math.sin(pitch));
      for (const p of [a, b, c]) {
        A.pos.push(p[0], p[1], p[2]); A.nor.push(n[0], n[1], n[2]);
        A.uv.push(p[0] * -n[2] + p[2] * n[0], (p[1] - yBase) / s); A.col.push(col[0], col[1], col[2]);
      }
      W.tris++;
    },
    // a flat face (a gable end, a dormer front, a soffit): wound to face `facing`
    face(a, b, c, col, facing) {
      let n = norm(a, b, c);
      if (n[0] * facing[0] + n[1] * facing[1] + n[2] * facing[2] < 0) { [b, c] = [c, b]; n = [-n[0], -n[1], -n[2]]; }
      for (const p of [a, b, c]) {
        A.pos.push(p[0], p[1], p[2]); A.nor.push(n[0], n[1], n[2]); A.uv.push(0, 0); A.col.push(col[0], col[1], col[2]);
      }
      W.tris++;
    },
    quadSlope(a, b, c, d, col, yBase, pitch) { W.slope(a, b, c, col, yBase, pitch); W.slope(a, c, d, col, yBase, pitch); },
    quadFace(a, b, c, d, col, facing) { W.face(a, b, c, col, facing); W.face(a, c, d, col, facing); }
  };
  return W;
}
export const shade = (rgb, k) => [rgb[0] * k, rgb[1] * k, rgb[2] * k];

// ---- the frame ---------------------------------------------------------------------------------------------------------
export function makeFrame(A, B) {
  const dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz) || 1e-9;
  const tx = dx / L, tz = dz / L, nx = tz, nz = -tx; // outward (an outer ring runs counter-clockwise)
  const F = {
    ax: A[0], az: A[1], tx, tz, nx, nz, L,
    P: (u, v, y) => [A[0] + tx * u - nx * v, y, A[1] + tz * u - nz * v],
    xz: (u, v) => [A[0] + tx * u - nx * v, A[1] + tz * u - nz * v],
    uv: (x, z) => [(x - A[0]) * tx + (z - A[1]) * tz, -((x - A[0]) * nx + (z - A[1]) * nz)],
    out: [nx, 0, nz], in: [-nx, 0, -nz], left: [-tx, 0, -tz], right: [tx, 0, tz]
  };
  return F;
}
// ---- roofs -------------------------------------------------------------------------------------------------------------
// A gable roof over [u0, u1] x [v0, v1] with its ridge along v (a gable to the street), the eave overhangs per side.
// The two gable ends take `endRgb`; a soffit under the overhang and a fascia along the two eaves close it from below.
export function gableRoof(W, F, s) {
  const uL = s.u0 - s.eL, uR = s.u1 + s.eR, vF = s.v0 - s.eF, vB = s.v1 + s.eB, y = s.y;
  const half = (uR - uL) / 2, rise = s.rise != null ? s.rise : half * Math.tan(s.pitch), uc = (uL + uR) / 2, P = F.P;
  const pitch = Math.atan2(rise, half); // (a run's gables share their ridge height: the pitch follows the width)
  const fl = P(uL, vF, y), fr = P(uR, vF, y), bl = P(uL, vB, y), br = P(uR, vB, y), rf = P(uc, vF, y + rise), rb = P(uc, vB, y + rise);
  W.quadSlope(fl, bl, rb, rf, s.rgbL || s.rgb, y, pitch);
  W.quadSlope(fr, rf, rb, br, s.rgb, y, pitch);
  if (s.bands) {
    // the front gable face in horizontal courses of two alternating tones (shingle or board), a collar line at its foot
    const n = s.bands.n;
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n, h0 = half * (1 - t0), h1 = half * (1 - t1);
      const col = k % 2 ? s.bands.b : s.bands.a;
      if (k === n - 1) W.face(P(uc - h0, vF, y + rise * t0), P(uc + h0, vF, y + rise * t0), P(uc, vF, y + rise), col, F.out);
      else W.quadFace(P(uc - h0, vF, y + rise * t0), P(uc + h0, vF, y + rise * t0), P(uc + h1, vF, y + rise * t1), P(uc - h1, vF, y + rise * t1), col, F.out);
    }
    W.quadFace(P(uL, vF - 0.02, y), P(uR, vF - 0.02, y), P(uR, vF - 0.02, y + 0.16), P(uL, vF - 0.02, y + 0.16), s.bands.trim, F.out);
  } else if (s.timber) {
    // a stucco gable end with dark half-timbering: a sill beam, a rail, studs and a king post
    W.face(fl, fr, rf, s.timber.face, F.out);
    timberBeams(W, F, { vF, y, half, rise, uc }, s.timber.beam);
  } else W.face(fl, fr, rf, s.endRgb, F.out);
  W.face(bl, br, rb, s.endRgb, F.in);
  W.quadFace(P(uL, vF, y - 0.04), P(uR, vF, y - 0.04), P(uR, vB, y - 0.04), P(uL, vB, y - 0.04), shade(s.rgb, 0.6), [0, -1, 0]);
  const down = (p) => [p[0], p[1] - 0.05, p[2]];
  W.quadFace(fl, bl, down(bl), down(fl), shade(s.rgb, 0.8), F.left);
  W.quadFace(fr, br, down(br), down(fr), shade(s.rgb, 0.8), F.right);
  return { uL, uR, vF, vB, rise, uc, half, y };
}

// A hip roof over [u0, u1] x [v0, v1]: the ridge along the longer side, the four slopes, a soffit and a fascia.
export function hipRoof(W, F, s) {
  const uL = s.u0 - s.eL, uR = s.u1 + s.eR, vF = s.v0 - s.eF, vB = s.v1 + s.eB, y = s.y;
  const Wd = uR - uL, Dd = vB - vF, alongU = Wd >= Dd, half = Math.min(Wd, Dd) / 2, rise = half * Math.tan(s.pitch);
  const uc = (uL + uR) / 2, vc = (vF + vB) / 2, P = F.P;
  const c00 = P(uL, vF, y), c10 = P(uR, vF, y), c11 = P(uR, vB, y), c01 = P(uL, vB, y);
  const r0 = alongU ? P(uL + half, vc, y + rise) : P(uc, vF + half, y + rise);
  const r1 = alongU ? P(uR - half, vc, y + rise) : P(uc, vB - half, y + rise);
  const sl = (a, b, c) => W.slope(a, b, c, s.rgb, y, s.pitch);
  if (alongU) {
    sl(c00, c10, r1); sl(c00, r1, r0); sl(c11, c01, r0); sl(c11, r0, r1); sl(c01, c00, r0); sl(c10, c11, r1);
  } else {
    sl(c10, c11, r1); sl(c10, r1, r0); sl(c01, c00, r0); sl(c01, r0, r1); sl(c00, c10, r0); sl(c11, c01, r1);
  }
  W.quadFace(P(uL, vF, y - 0.04), P(uR, vF, y - 0.04), P(uR, vB, y - 0.04), P(uL, vB, y - 0.04), shade(s.rgb, 0.6), [0, -1, 0]);
  const down = (p) => [p[0], p[1] - 0.05, p[2]];
  const edges = [[c00, c10, F.out], [c10, c11, F.right], [c11, c01, F.in], [c01, c00, F.left]];
  for (const [a, b, f] of edges) W.quadFace(a, b, down(b), down(a), shade(s.rgb, 0.8), f);
  return { uL, uR, vF, vB, rise, alongU, half, uc, vc, y };
}

// the half-timbering on a front gable's face (stucco face drawn by the caller): flat strips just proud of it
export function timberBeams(W, F, g, rgb) {
  const P = F.P, off = g.vF - 0.04, w = 0.1, y = g.y, hAt = (du) => g.rise * (1 - Math.abs(du) / g.half);
  const q = (u0, y0, u1, y1) => W.quadFace(P(u0, off, y0), P(u1, off, y0), P(u1, off, y1), P(u0, off, y1), rgb, F.out);
  q(g.uc - g.half + 0.08, y + 0.04, g.uc + g.half - 0.08, y + 0.2);
  const yr = g.rise * 0.46, wr = g.half * (1 - 0.46);
  q(g.uc - wr + 0.05, y + yr, g.uc + wr - 0.05, y + yr + 0.13);
  for (const f of [-0.62, -0.31, 0, 0.31, 0.62]) {
    const du = g.half * f, top = Math.min(hAt(du - w), hAt(du + w)) - 0.12;
    if (top > 0.45) q(g.uc + du - w / 2, y + 0.2, g.uc + du + w / 2, y + top);
  }
}

// ---- flat roofs in the roof batch (st-ndw9.15 round 3) ---------------------------------------------------------------------
// A flat roof or a rear wing's roof of a drawn building is a tar-and-gravel slab of flat-coloured triangles in the existing
// hipped roofs' batch, a hair above the wall record's own cap (which the cell material draws near white): the colour is the
// group's tar grey with a per-building shade, as the pitched roofs' are. A building that is not drawn has no slab.
export function triangulate(P) {
  const n = P.length;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area += P[j][0] * P[i][1] - P[i][0] * P[j][1];
  const idx = [...Array(n).keys()];
  if (area < 0) idx.reverse();
  const cross = (a, b, c) => (P[b][0] - P[a][0]) * (P[c][1] - P[a][1]) - (P[b][1] - P[a][1]) * (P[c][0] - P[a][0]);
  const same = (a, b) => Math.abs(P[a][0] - P[b][0]) < 1e-6 && Math.abs(P[a][1] - P[b][1]) < 1e-6;
  const inTri = (a, b, c, q) => cross(a, b, q) >= -1e-9 && cross(b, c, q) >= -1e-9 && cross(c, a, q) >= -1e-9;
  const out = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let found = false;
    for (let i = 0; i < idx.length && !found; i++) {
      const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
      if (cross(a, b, c) <= 1e-9) continue;
      let ok = true;
      for (const q of idx) { if (q === a || q === b || q === c || same(q, a) || same(q, b) || same(q, c)) continue; if (inTri(a, b, c, q)) { ok = false; break; } }
      if (ok) { out.push([a, b, c]); idx.splice(i, 1); found = true; }
    }
    if (!found) {
      let removed = false;
      for (let i = 0; i < idx.length && !removed; i++) {
        const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
        if (Math.abs(cross(a, b, c)) <= 1e-9) { idx.splice(i, 1); removed = true; }
      }
      if (!removed) break;
    }
  }
  if (idx.length === 3 && cross(idx[0], idx[1], idx[2]) > 1e-9) out.push([idx[0], idx[1], idx[2]]);
  return out;
}
// the slab: the polygon `P` ([[x, z], ...]) at height y, in colour rgb; returns the triangles written
export function slab(W, P, y, rgb) {
  let n = 0;
  for (const [a, b, c] of triangulate(P)) { W.face([P[a][0], y, P[a][1]], [P[b][0], y, P[b][1]], [P[c][0], y, P[c][1]], rgb, [0, 1, 0]); n++; }
  return n;
}
// a tar grey: the group's, shaded per building
export const tarRgb = (lin, gid, id, preset) => {
  const base = lin(weighted(ROOF_TAR, stream(gid, `${preset}:tar`)()));
  const k = 0.9 + 0.22 * stream(id, `${preset}:tarshade`)();
  return [base[0] * k, base[1] * k, base[2] * k];
};

