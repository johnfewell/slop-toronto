// js/roof-skeleton.js (st-2nl.5, docs/massing-buildings.md §2): pitched roofs over a building's own City 3D Massing
// polygon, not over the rectangles the old boxes were fitted to.
//
// - `straightSkeleton(ring)`: the straight skeleton of a simple polygon by wavefront propagation (edge events and split
//   events, the textbook method), returned as one face per polygon edge with a time `t` (metres in from the eave) at every
//   corner. A hip roof is that skeleton lifted: height = tan(pitch) * t.
// - `gableFaces(ring, axis)`: the two slopes of a gable roof over a near-rectangular polygon (ridge along `axis`), plus the
//   gable-end wall triangles above the eave.
// - `planRoof(ring, opts)`: chooses hip or gable, and takes the pitch and the eave height from the City's two heights: the
//   lidar MAX_HEIGHT is the ridge and AVG_HEIGHT sits near the eaves (EAVE_RISE of the way up to the ridge), so tan(pitch) = rise
//   over tMax (the deepest point of the roof in from the eave), kept between 16 and 46 degrees with the ridge at MAX. A difference
//   that says flat, a shape the skeleton cannot do, or no room under the ridge gives `{ ok: false }` and the caller keeps its
//   flat roof.
// - `pushRoofPlan(A, plan, y0, rgb, wallRgb)`: the plan as flat-shaded triangles in the hipped roofs' accumulator
//   `{ pos, nor, uv, col }`, as js/buildings.js pushHipRoof does (uv: metres along the eave, metres up the slope).
//
// Nothing here throws on any input (NaN, repeated corners, spikes, self-crossing rings, two corners): the result is `ok:
// false` with a `reason`. A skeleton whose faces do not cover the polygon's area to 2% is rejected the same way.
// Rings are [[x, z], ...], counter-clockwise in (x, z) as the massing sidecar stores them (clockwise input is reversed).

const MAX_CORNERS = 72; // (the sidecar's rings go to 74; the naive event search is cubic, a house has 6 to 14)
const EAVE_RISE = 0.3; // (of MAX - AVG: how far above AVG_HEIGHT the eave stands)
const TAN_MIN = Math.tan(16 * Math.PI / 180), TAN_MAX = Math.tan(46 * Math.PI / 180);

export const area2 = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return a; };

/** A ring without repeated corners and without corners that sit on the line between their neighbours (within `tol` m); null when it is not a polygon. */
export function cleanRing(input, tol = 0.03) {
  if (!Array.isArray(input) || input.length < 3) return null;
  let r = [];
  for (const p of input) {
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
    const q = r[r.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.02) r.push([p[0], p[1]]);
  }
  while (r.length > 1 && Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) <= 0.02) r.pop();
  for (let pass = 0; pass < 4 && r.length >= 3; pass++) {
    const out = [];
    for (let i = 0; i < r.length; i++) {
      const a = r[(i + r.length - 1) % r.length], b = r[i], c = r[(i + 1) % r.length];
      const dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz);
      // (on the line between its neighbours and between them: a corner of no use; a spike, back along the line, stays and fails later)
      const off = l > 0 ? Math.abs((b[0] - a[0]) * dz - (b[1] - a[1]) * dx) / l : 0;
      const along = l > 0 ? ((b[0] - a[0]) * dx + (b[1] - a[1]) * dz) / (l * l) : 0;
      if (off <= tol && along > 0 && along < 1) continue;
      out.push(b);
    }
    if (out.length === r.length) break;
    r = out;
  }
  if (r.length < 3 || Math.abs(area2(r)) < 2) return null;
  return r;
}

function segCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}
/** Does the ring cross itself (a bow tie)? */
export function selfCrosses(r) {
  const n = r.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (segCross(r[i], r[(i + 1) % n], r[j], r[(j + 1) % n])) return true;
  }
  return false;
}

// ---- ear clipping of one face (counter-clockwise, a handful of corners): index triples ------------------------------------
function earClip(P) {
  const n = P.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];
  const idx = P.map((_, i) => i), out = [];
  const cross = (a, b, c) => (P[b][0] - P[a][0]) * (P[c][1] - P[a][1]) - (P[b][1] - P[a][1]) * (P[c][0] - P[a][0]);
  const inside = (a, b, c, p) => cross(a, b, p) > -1e-12 && cross(b, c, p) > -1e-12 && cross(c, a, p) > -1e-12;
  let guard = n * n + 8;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const a = idx[(k + idx.length - 1) % idx.length], b = idx[k], c = idx[(k + 1) % idx.length];
      if (cross(a, b, c) <= 1e-12) continue; // (reflex or flat)
      let ok = true;
      for (const q of idx) if (q !== a && q !== b && q !== c && inside(a, b, c, q) && Math.hypot(P[q][0] - P[b][0], P[q][1] - P[b][1]) > 1e-9) { ok = false; break; }
      if (!ok) continue;
      out.push([a, b, c]); idx.splice(k, 1); clipped = true; break;
    }
    if (!clipped) { // (a face with a flat run: drop the flattest corner and go on)
      let k = 0, best = Infinity;
      for (let i = 0; i < idx.length; i++) { const v = Math.abs(cross(idx[(i + idx.length - 1) % idx.length], idx[i], idx[(i + 1) % idx.length])); if (v < best) { best = v; k = i; } }
      idx.splice(k, 1);
    }
  }
  if (idx.length === 3 && cross(idx[0], idx[1], idx[2]) > 1e-12) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

/**
 * The straight skeleton of a simple polygon -> { ok, faces: [{ edge, poly: [[x, z, t], ...] }] } (one counter-clockwise face
 * a polygon edge, its corners the eave and the skeleton nodes on it), tMax, area. `ok: false` and a `reason` otherwise.
 */
export function straightSkeleton(input) {
  try { return skeleton(input); } catch (e) { return { ok: false, reason: 'error: ' + (e && e.message) }; }
}

function skeleton(input) {
  let ring = cleanRing(input);
  if (!ring) return { ok: false, reason: 'degenerate' };
  if (area2(ring) < 0) ring = ring.slice().reverse();
  const n = ring.length;
  if (n > MAX_CORNERS) return { ok: false, reason: 'too many corners' };
  if (selfCrosses(ring)) return { ok: false, reason: 'self-crossing' };
  // edge i: corner i -> corner i + 1; d its unit direction, nrm its inward (left) normal, c: nrm . (a point on it)
  const E = ring.map((a, i) => {
    const b = ring[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    const d = [dx / l, dz / l], nrm = [-d[1], d[0]];
    return { d, nrm, c: nrm[0] * a[0] + nrm[1] * a[1], a, b };
  });
  const faces = E.map((e) => [{ x: e.a[0], z: e.a[1], t: 0 }, { x: e.b[0], z: e.b[1], t: 0 }]);
  const mk = (x, z, t, e0, e1) => {
    const n0 = E[e0].nrm, n1 = E[e1].nrm, den = 1 + n0[0] * n1[0] + n0[1] * n1[1];
    const v = { x, z, t0: t, e0, e1, prev: null, next: null, alive: true, stuck: false, vx: 0, vz: 0, reflex: false };
    if (den < 1e-6) v.stuck = true; // (two opposite edges meet: the roof's ridge; the vertex stays where it is)
    else { v.vx = (n0[0] + n1[0]) / den; v.vz = (n0[1] + n1[1]) / den; }
    v.reflex = E[e0].d[0] * E[e1].d[1] - E[e0].d[1] * E[e1].d[0] < -1e-9;
    return v;
  };
  const all = [];
  for (let i = 0; i < n; i++) all.push(mk(ring[i][0], ring[i][1], 0, (i + n - 1) % n, i));
  for (let i = 0; i < n; i++) { all[i].next = all[(i + 1) % n]; all[(i + 1) % n].prev = all[i]; }
  for (const v of all) if (v.stuck) return { ok: false, reason: 'spike' };
  const pos = (v, t) => [v.x + v.vx * (t - v.t0), v.z + v.vz * (t - v.t0)];
  const live = new Set(all);
  const finalize = (a, t) => { // (a cycle of two: its edges meet along a ridge)
    const b = a.next, pa = pos(a, t), pb = pos(b, t);
    for (const e of new Set([a.e0, a.e1, b.e0, b.e1])) faces[e].push({ x: pa[0], z: pa[1], t }, { x: pb[0], z: pb[1], t });
    a.alive = b.alive = false; live.delete(a); live.delete(b);
  };
  let now = 0, guard = 0, tMax = 0;
  const EPS = 1e-7;
  while (live.size && guard++ < 8 * n + 40) {
    let best = null;
    for (const V of live) {
      if (V.stuck) continue;
      const W = V.next;
      if (!W.stuck) { // edge event: the edge between V and W shrinks to nothing
        const e = V.e1, d = E[e].d;
        const rate = (W.vx - V.vx) * d[0] + (W.vz - V.vz) * d[1];
        if (rate < -1e-9) {
          const aV = [V.x - V.vx * V.t0, V.z - V.vz * V.t0], aW = [W.x - W.vx * W.t0, W.z - W.vz * W.t0];
          const t = -((aW[0] - aV[0]) * d[0] + (aW[1] - aV[1]) * d[1]) / rate;
          if (t >= now - EPS && (!best || t < best.t - 1e-9 || (Math.abs(t - best.t) <= 1e-9 && best.type === 'split'))) best = { type: 'edge', t: Math.max(t, now), V, W };
        }
      }
      if (V.reflex) { // split event: V runs into the wavefront edge of another stretch of its own cycle
        const aV = [V.x - V.vx * V.t0, V.z - V.vz * V.t0];
        let U = V.next; // (its own two edges are skipped below)
        for (let k = 0; k < live.size && U !== V; k++, U = U.next) {
          const e = U.e1, Wn = U.next;
          if (e === V.e0 || e === V.e1 || U === V || Wn === V) continue;
          const nr = E[e].nrm, slope = nr[0] * V.vx + nr[1] * V.vz - 1;
          if (slope > -1e-9) continue;
          const t = -(nr[0] * aV[0] + nr[1] * aV[1] - E[e].c) / slope;
          if (!(t >= now - EPS) || (best && !(t < best.t - 1e-9))) continue;
          const P = pos(V, t), d = E[e].d, pu = pos(U, t), pw = pos(Wn, t);
          if ((pu[0] - P[0]) * d[0] + (pu[1] - P[1]) * d[1] > 1e-6 || (pw[0] - P[0]) * d[0] + (pw[1] - P[1]) * d[1] < -1e-6) continue;
          best = { type: 'split', t: Math.max(t, now), V, U };
        }
      }
    }
    if (!best) break;
    now = best.t; tMax = Math.max(tMax, now);
    if (best.type === 'edge') {
      const { V, W } = best, pv = pos(V, now), pw = pos(W, now), P = [(pv[0] + pw[0]) / 2, (pv[1] + pw[1]) / 2];
      const N = mk(P[0], P[1], now, V.e0, W.e1);
      for (const e of new Set([V.e0, V.e1, W.e1])) faces[e].push({ x: P[0], z: P[1], t: now });
      N.prev = V.prev; N.next = W.next; V.prev.next = N; W.next.prev = N;
      V.alive = W.alive = false; live.delete(V); live.delete(W); live.add(N);
      if (N.next === N.prev) { finalize(N, now); continue; }
      if (N.stuck && N.next !== N.prev && N.prev.prev === N.next) { /* (a cycle of three: the next pass ends it) */ }
    } else {
      const { V, U } = best, P = pos(V, now), Wn = U.next, e = U.e1;
      for (const k of new Set([V.e0, V.e1, e])) faces[k].push({ x: P[0], z: P[1], t: now });
      const A = mk(P[0], P[1], now, V.e0, e), B = mk(P[0], P[1], now, e, V.e1);
      A.prev = V.prev; A.next = Wn; V.prev.next = A; Wn.prev = A;
      B.prev = U; B.next = V.next; U.next = B; V.next.prev = B;
      V.alive = false; live.delete(V); live.add(A); live.add(B);
      for (const X of [A, B]) if (X.next.next === X) finalize(X, now);
    }
  }
  if (live.size) return { ok: false, reason: 'events left' };
  // each face: its eave corners, then the nodes in order along the edge (the faces are monotone along their edge)
  const out = [];
  let covered = 0;
  for (let i = 0; i < n; i++) {
    const e = E[i], pts = faces[i];
    const S = pts[0], Q = pts[1], nodes = pts.slice(2).map((p) => ({ ...p, s: (p.x - e.a[0]) * e.d[0] + (p.z - e.a[1]) * e.d[1] }));
    nodes.sort((p, q) => p.s - q.s || p.t - q.t);
    const poly = [[S.x, S.z, 0], [Q.x, Q.z, 0]];
    for (let k = nodes.length - 1; k >= 0; k--) {
      const p = nodes[k], last = poly[poly.length - 1];
      if (Math.hypot(p.x - last[0], p.z - last[1]) > 1e-4) poly.push([p.x, p.z, p.t]);
    }
    const first = poly[0], last = poly[poly.length - 1];
    if (poly.length > 3 && Math.hypot(first[0] - last[0], first[1] - last[1]) <= 1e-4) poly.pop();
    const a = area2(poly);
    if (!(a > -1e-6)) return { ok: false, reason: 'face turned over' };
    covered += a / 2;
    if (poly.length >= 3 && a > 1e-9) out.push({ edge: i, poly });
  }
  const total = area2(ring) / 2;
  if (!(Math.abs(covered - total) <= 0.02 * total)) return { ok: false, reason: `faces cover ${(covered / total).toFixed(3)} of the polygon` };
  return { ok: true, faces: out, tMax, area: total, ring };
}

// ---- the smallest oriented rectangle round a ring ----------------------------------------------------------------------
/** { ang, u: [ux, uz], w (along u), d (along its normal), cu, cv (the centre in that frame), fill (ring area over rectangle area) } */
export function orientedRect(ring) {
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    if (l < 0.3) continue;
    const ux = dx / l, uz = dz / l;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of ring) {
      const u = (p[0] - a[0]) * ux + (p[1] - a[1]) * uz, v = -(p[0] - a[0]) * uz + (p[1] - a[1]) * ux;
      if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const A = (u1 - u0) * (v1 - v0);
    if (!best || A < best.A) best = { A, ux, uz, a, u0, u1, v0, v1 };
  }
  if (!best) return null;
  return { ux: best.ux, uz: best.uz, w: best.u1 - best.u0, d: best.v1 - best.v0, fill: Math.abs(area2(ring) / 2) / Math.max(best.A, 1e-9), ox: best.a[0], oz: best.a[1], u0: best.u0, v0: best.v0 };
}

// ---- a gable roof: two slopes over the polygon cut along the ridge, and the gable ends ---------------------------------
/**
 * Gable faces over `ring` with the ridge along direction `axis` ([ux, uz], unit): { ok, faces: [{ poly: [[x, z, t]] }],
 * walls: [[[x, z, t], [x, z, t], [x, z, t]...]], tMax }. `t` is the distance in from the nearer eave line; a wall's `t` is its height
 * over the eave line measured the same way (the gable-end triangles).
 */
export function gableFaces(input, axis) {
  try {
    let ring = cleanRing(input);
    if (!ring || !axis) return { ok: false, reason: 'degenerate' };
    if (area2(ring) < 0) ring = ring.slice().reverse();
    if (ring.length > MAX_CORNERS || selfCrosses(ring)) return { ok: false, reason: 'ring' };
    const [ux, uz] = axis, vOf = (p) => -p[0] * uz + p[1] * ux;
    let v0 = Infinity, v1 = -Infinity;
    for (const p of ring) { const v = vOf(p); if (v < v0) v0 = v; if (v > v1) v1 = v; }
    const s = (v1 - v0) / 2, vc = (v0 + v1) / 2;
    if (!(s > 0.5)) return { ok: false, reason: 'too narrow' };
    const tOf = (p) => Math.min(vOf(p) - v0, v1 - vOf(p));
    const clip = (keepLow) => { // (Sutherland-Hodgman against v <= vc, or v >= vc)
      const inside = (p) => (keepLow ? vOf(p) <= vc + 1e-9 : vOf(p) >= vc - 1e-9);
      const out = [];
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length], ia = inside(a), ib = inside(b);
        if (ia) out.push(a);
        if (ia !== ib) { const va = vOf(a), vb = vOf(b), k = (vc - va) / (vb - va); out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]); }
      }
      return out.length >= 3 && Math.abs(area2(out)) > 1e-6 ? out.map((p) => [p[0], p[1], Math.max(0, tOf(p))]) : null;
    };
    const faces = [clip(true), clip(false)].filter(Boolean).map((poly) => ({ poly }));
    if (!faces.length) return { ok: false, reason: 'no slopes' };
    // the gable ends: wall above the eave along each ring edge, split where it crosses the ridge line
    const walls = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], va = vOf(a), vb = vOf(b), ta = tOf(a), tb = tOf(b);
      const seg = [[a, ta]];
      if ((va - vc) * (vb - vc) < 0) { const k = (vc - va) / (vb - va); seg.push([[a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], s]); }
      seg.push([b, tb]);
      for (let k = 0; k + 1 < seg.length; k++) {
        const [p, tp] = seg[k], [q, tq] = seg[k + 1];
        if (tp < 0.05 && tq < 0.05) continue;
        walls.push({ p, q, tp, tq });
      }
    }
    return { ok: true, faces, walls, tMax: s, ring };
  } catch (e) { return { ok: false, reason: 'error: ' + (e && e.message) }; }
}

function faceStats(faces) {
  let A = 0, tA = 0, tMax = 0;
  for (const f of faces) {
    const P = f.poly;
    for (const [a, b, c] of earClip(P)) {
      const ar = Math.abs((P[b][0] - P[a][0]) * (P[c][1] - P[a][1]) - (P[b][1] - P[a][1]) * (P[c][0] - P[a][0])) / 2;
      A += ar; tA += ar * (P[a][2] + P[b][2] + P[c][2]) / 3;
    }
    for (const p of P) if (p[2] > tMax) tMax = p[2];
  }
  return { area: A, meanT: A > 0 ? tA / A : 0, tMax };
}

/**
 * The roof over `ring` from the City's heights: { ok, form: 'hip' | 'gable', eave (m above the building's base: where the walls
 * stop), tan, ridge (m above the base), faces, walls, tMax, meanT, triangles } or { ok: false, reason }.
 * opts: max, avg (the massing record's MAX_HEIGHT and AVG_HEIGHT above the ground, m: ridge and mean roof surface),
 *       form: 'hip' | 'gable' | 'auto' (gable where the plan is a plain rectangle and `gable` says so), axis ([ux, uz]: the ridge
 *       direction wanted for a gable, else the rectangle's long side), gable (bool: this is a gabled house),
 *       flatBelow (m, default 0.7: MAX - AVG under this is a flat roof), minEave (m, default 2.5), fixed ({ tan, eave }: a row's
 *       shared pitch and eave).
 */
export function planRoof(ring, opts = {}) {
  try {
    const { max, avg } = opts;
    if (!(Number.isFinite(max) && Number.isFinite(avg))) return { ok: false, reason: 'no heights' };
    const flatBelow = opts.flatBelow ?? 0.7, minEave = opts.minEave ?? 2.5;
    if (max - avg < flatBelow) return { ok: false, reason: 'flat' };
    const r = cleanRing(ring);
    if (!r) return { ok: false, reason: 'degenerate' };
    const R = area2(r) < 0 ? r.slice().reverse() : r;
    let form = opts.form || 'auto', shape = null;
    const rect = orientedRect(R);
    if (!rect) return { ok: false, reason: 'degenerate' };
    const long = Math.max(rect.w, rect.d), short = Math.min(rect.w, rect.d);
    const plain = rect.fill >= 0.84 && R.length <= 10 && long / Math.max(short, 0.5) >= 1.2;
    if (form === 'auto') form = plain && opts.gable ? 'gable' : 'hip';
    if (form === 'gable' && !plain) form = 'hip';
    if (form === 'gable') {
      // (the ridge along the wanted axis when that is within 20 degrees of the rectangle's long side, else along the long side)
      const lx = rect.w >= rect.d ? rect.ux : -rect.uz, lz = rect.w >= rect.d ? rect.uz : rect.ux;
      let ax = lx, az = lz;
      if (opts.axis) { const dot = Math.abs(opts.axis[0] * lx + opts.axis[1] * lz); if (dot > Math.cos(20 * Math.PI / 180)) { ax = opts.axis[0]; az = opts.axis[1]; } }
      shape = gableFaces(R, [ax, az]);
      if (!shape.ok) { form = 'hip'; shape = null; }
    }
    if (!shape) {
      shape = straightSkeleton(R);
      if (!shape.ok) { // (a shape the skeleton cannot do: the plain hip over its rectangle, if that is close enough; else the flat roof stays)
        if (rect.fill < 0.8) return { ok: false, reason: 'skeleton: ' + shape.reason };
        const hx = rect.ux, hz = rect.uz;
        const corners = [[0, 0], [rect.w, 0], [rect.w, rect.d], [0, rect.d]].map(([u, v]) => [rect.ox + (rect.u0 + u) * hx + (rect.v0 + v) * -hz, rect.oz + (rect.u0 + u) * hz + (rect.v0 + v) * hx]);
        shape = straightSkeleton(corners);
        if (!shape.ok) return { ok: false, reason: 'skeleton: ' + shape.reason };
        form = 'hip';
      }
    }
    const st = faceStats(shape.faces);
    if (!(st.tMax > 0.4)) return { ok: false, reason: 'no depth' };
    let tan, eave;
    if (opts.fixed && Number.isFinite(opts.fixed.tan) && Number.isFinite(opts.fixed.eave)) {
      tan = Math.min(TAN_MAX, Math.max(TAN_MIN, opts.fixed.tan)); eave = opts.fixed.eave;
    } else {
      // (AVG_HEIGHT sits near the eaves, not at the roof's mean: over the city's 15,178 pitched houses MAX - AVG is 3.5 m at the median,
      // which on the mean-of-the-roof reading would mean slopes over 54 degrees. The eave is taken a share `eaveRise` of the way up from
      // AVG to MAX, and the ridge stays at MAX.)
      tan = Math.min(TAN_MAX, Math.max(TAN_MIN, (max - (avg + EAVE_RISE * (max - avg))) / st.tMax));
      eave = max - tan * st.tMax;
      if (eave < minEave) { tan = (max - minEave) / st.tMax; eave = minEave; }
    }
    if (!(tan >= TAN_MIN * 0.8) || !(eave >= minEave - 1e-6)) return { ok: false, reason: 'no room under the ridge' };
    return { ok: true, form, eave, tan, ridge: eave + tan * st.tMax, faces: shape.faces, walls: shape.walls || [], tMax: st.tMax, meanT: st.meanT, area: st.area, ring: R };
  } catch (e) { return { ok: false, reason: 'error: ' + (e && e.message) }; }
}

/** A row's shared roof parameters: the median pitch and eave of its houses' own plans (the plans that are ok). */
export function sharedRoof(plans) {
  const ok = plans.filter((p) => p && p.ok);
  if (ok.length < 2) return null;
  const med = (a) => { const s = a.slice().sort((p, q) => p - q), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  return { tan: med(ok.map((p) => p.tan)), eave: med(ok.map((p) => p.eave)) };
}

/**
 * Pushes the plan's triangles into the accumulator A { pos, nor, uv, col } at base height y0 (the roof stands on y0 + eave):
 * returns the number of triangles. rgb: the roof's colour (linear); wallRgb: the gable ends' (linear).
 */
export function pushRoofPlan(A, plan, y0, rgb, wallRgb) {
  const y = y0 + plan.eave, tan = plan.tan, sinP = tan / Math.sqrt(1 + tan * tan);
  let count = 0;
  const emit = (a, b, c, up, outward, uvFlat) => {
    let nx, ny, nz;
    const calc = () => {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    };
    calc();
    if (!(Math.hypot(nx, ny, nz) > 0.5)) return;
    const flip = up ? ny < 0 : (nx * outward[0] + nz * outward[1]) < 0;
    if (flip) { [b, c] = [c, b]; nx = -nx; ny = -ny; nz = -nz; }
    const col = up ? rgb : wallRgb;
    for (const p of [a, b, c]) {
      A.pos.push(p[0], p[1], p[2]); A.nor.push(nx, ny, nz);
      if (uvFlat) A.uv.push(0, 0.3); else A.uv.push(p[0] * -nz + p[2] * nx, (p[1] - y) / Math.max(0.2, sinP));
      A.col.push(col[0], col[1], col[2]);
    }
    count++;
  };
  const P3 = (p) => [p[0], y + tan * p[2], p[1]];
  for (const f of plan.faces) {
    const P = f.poly;
    for (const [a, b, c] of earClip(P)) emit(P3(P[a]), P3(P[b]), P3(P[c]), true);
  }
  for (const w of plan.walls || []) {
    const { p, q, tp, tq } = w, dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz) || 1, out = [dz / l, -dx / l];
    const p0 = [p[0], y, p[1]], q0 = [q[0], y, q[1]], p1 = [p[0], y + tan * tp, p[1]], q1 = [q[0], y + tan * tq, q[1]];
    if (tp >= 0.05 && tq >= 0.05) { emit(p0, q0, q1, false, out, true); emit(p0, q1, p1, false, out, true); }
    else if (tp >= 0.05) emit(p0, q0, p1, false, out, true);
    else emit(p0, q0, q1, false, out, true);
  }
  return count;
}

/** The roof's triangle count without building it (the budget checks) */
export function planTriangles(plan) {
  let n = 0;
  for (const f of plan.faces) n += Math.max(0, f.poly.length - 2);
  for (const w of plan.walls || []) n += w.tp >= 0.05 && w.tq >= 0.05 ? 2 : 1;
  return n;
}
