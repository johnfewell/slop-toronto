(function () {
// js/sidewalk-sections.js
// Toronto's sidewalks are poured in place: a continuous ribbon of concrete scored across the walk every 1.5 m or so
// (stripes, not New York's grid of flags), repaired a full-width section or a few at a time, and stamped with the
// contractor's name and year at each end of the work and every tenth bay (City of Toronto TS 3.70 and standard drawings
// T-310.010-1, -6 & -7; the Streetscape Manual's 1.2-1.6 m bays; see docs/sidewalk-polygons.md, "Toronto's poured
// sidewalks"). The shader in tsl-materials.js draws them, so it needs to know which way each walk runs. This file:
// - splits a curb island's outline into straight runs (curbRuns) and gives every triangle of the walk on that island the
//   frame of the run it lies along (walkFrames): the run's direction and curb line, a seed, and how far across the walk
//   reaches there. A triangle that spans two runs (a corner) is cut along the line where they are equally near.
//   city-grid.js stores the frame as two vertex attributes, `walkFrame` (ux, uz, curb line, seed * 2 + downtown) and
//   `walkSpan` (t0, t1: the walk from t0 to t1 metres in from the curb line);
// - holds the section rule (sidewalkSection), with the integer hash the shader repeats exactly, so tests and the
//   capture tools can say where the repairs & stamps are;
// - finds a stamp near a point in the built city (findSidewalkStamp, for close-up captures).
// It loads before city-grid.js and works without three.js (the build tools & tests run it in node).
const CITY = (window.CITY = window.CITY || {});

const SIDEWALK = {
  bay: 1.5, // contraction joints across the walk (the Streetscape Manual's 1.2-1.6 m bays; T-310.010-1 draws 2 m)
  expansionEvery: 4, // every 4th joint (6 m) a 12 mm full-depth bituminous expansion joint (TS 3.70: 6 m at most)
  longitudinalMin: 3.0, // a slab 3 m or wider gets one lengthwise joint, 1.5 m from the curb (TS 3.70.07.11.01)
  longitudinalAt: 1.5,
  margin: 0.05, // the smooth tooled band along the formed edges (TS 3.70.07.09: up to 50 mm)
  sawCutFrom: 2000, // sections poured since then have saw-cut joints without the tooled margins (TS 3.70)
  repairGroup: 4, // repairs: a run of 1-3 whole sections, at most one run in each 4 sections
  repairChance: [0.26, 0.34], // (residential, downtown) share of 4-section groups with a repair
  originalYears: [[1952, 40], [1976, 38]], // (residential, downtown) the original pour: [first year, span]
  repairYears: [1998, 28], // the repairs, 1998-2025
  stampEvery: 10, // a stamp at each end of the work and every tenth bay (TS 3.70.07.10)
  stamp: { across: 0.225, along: 0.13, fromJoint: 0.05, minWidth: 0.6, firstYear: 1950, lastYear: 2025, ovalBefore: 1985 }
};

// Integer hash of three integers to [0, 1), exactly as the shader computes it (u32 wrap-around arithmetic; the top 24
// bits, which a float holds exactly)
const SALT = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((c) => Math.imul(c, 0xcb1ab31f) >>> 0);
function sectionHash(a, b, c) {
  let h = (Math.imul(a | 0, 0x8da6b343) ^ Math.imul(b | 0, 0xd8163841) ^ SALT[c]) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h >>> 8) / 16777216;
}

// The joints' phase along a run (m): each run of curb was poured on its own
const sectionPhase = (seed) => sectionHash(seed, 0, 10) * SIDEWALK.bay;

/**
 * Section k of the run with this seed (downtown: 1 on a paved, built-up island), on a walk `width` m wide:
 * { repair, year, stamp: null | { end: 0 at the section's start joint / 1 at its end joint, offset: across from the
 * walk's centre (m), oval } }. The shader (createSidewalkMaterial) repeats this, hash for hash.
 */
function sidewalkSection(k, seed, downtown, width) {
  const S = SIDEWALK;
  const g = Math.floor(k / S.repairGroup), j = k - g * S.repairGroup;
  const start = Math.floor(sectionHash(g, seed, 2) * S.repairGroup);
  const len = 1 + Math.floor(sectionHash(g, seed, 3) * 3);
  const repair = sectionHash(g, seed, 1) < S.repairChance[downtown] && j >= start && j < start + len;
  const [y0, span] = S.originalYears[downtown];
  const year = repair ? S.repairYears[0] + Math.floor(sectionHash(g, seed, 4) * S.repairYears[1]) : y0 + Math.floor(sectionHash(seed, 0, 5) * span);
  let stamp = null;
  if (width >= S.stamp.minWidth) {
    const tenth = Math.floor(sectionHash(seed, 0, 6) * S.stampEvery);
    const k10 = k - tenth - Math.floor((k - tenth) / S.stampEvery) * S.stampEvery;
    const has = repair ? j === start && sectionHash(g, seed, 7) < 0.85 : k10 === 0;
    if (has) {
      // centred across the slab (T-310.010-6); the oldest ones drift towards an edge
      const drift = year < 1975 ? (sectionHash(k, seed, 9) - 0.5) * Math.max(0, width - S.stamp.across - 0.1) * 0.8 : 0;
      stamp = { end: repair ? 0 : sectionHash(k, seed, 8) < 0.5 ? 0 : 1, offset: drift, oval: year < S.stamp.ovalBefore };
    }
  }
  return { repair, year, stamp };
}

// The centre of a section's stamp in walk coordinates (s along the run, t in from the curb line), or null
function stampCentre(k, seed, downtown, t0, t1) {
  const S = SIDEWALK;
  const sec = sidewalkSection(k, seed, downtown, t1 - t0);
  if (!sec.stamp) return null;
  const s0 = sectionPhase(seed) + k * S.bay;
  const inset = S.stamp.fromJoint + S.stamp.along / 2;
  return { s: sec.stamp.end ? s0 + S.bay - inset : s0 + inset, t: (t0 + t1) / 2 + sec.stamp.offset, year: sec.year, oval: sec.stamp.oval, end: sec.stamp.end };
}

// ---------------------------------------------------------------------------------------------------------------------
// Walk frames
// ---------------------------------------------------------------------------------------------------------------------
const signedArea = (pts) => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  return a;
};

/**
 * The straight runs of an island's curb outline ([{x, z}], either winding): from its sharpest corner, each run takes in
 * vertices while they stay within a little of its chord (the outlines are traced from a 1 m raster, so small jogs don't
 * break a run; a curve does, into runs a few degrees apart). Each run: its ends, direction (ux, uz), inward normal
 * (nx, nz) and curb line c (t = x * nx + z * nz - c is the distance in from the curb).
 */
function curbRuns(poly) {
  const n = poly.length;
  if (n < 3) return [];
  const s = signedArea(poly) > 0 ? 1 : -1;
  // start at the sharpest turn
  let start = 0, sharp = -2;
  for (let i = 0; i < n; i++) {
    const p = poly[(i + n - 1) % n], q = poly[i], r = poly[(i + 1) % n];
    const ax = q.x - p.x, az = q.z - p.z, bx = r.x - q.x, bz = r.z - q.z;
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
    if (la < 1e-6 || lb < 1e-6) continue;
    const turn = 1 - (ax * bx + az * bz) / (la * lb);
    if (turn > sharp) { sharp = turn; start = i; }
  }
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(poly[(start + i) % n]);
  const runs = [];
  let i = 0;
  while (i < n) {
    let j = i + 1;
    while (j + 1 <= n) {
      const a = pts[i], b = pts[j + 1];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 1e-6) { j++; continue; }
      const tol = Math.min(0.9, 0.35 + 0.006 * L);
      let ok = true;
      for (let m = i + 1; m <= j; m++) {
        const d = Math.abs((pts[m].x - a.x) * (b.z - a.z) - (pts[m].z - a.z) * (b.x - a.x)) / L;
        if (d > tol) { ok = false; break; }
      }
      if (!ok) break;
      j++;
    }
    const a = pts[i], b = pts[j];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L > 1e-3) {
      // (along the curb with the island on the left, so the inward normal is always (-uz, ux), as the shader assumes)
      const ux = ((b.x - a.x) / L) * s, uz = ((b.z - a.z) / L) * s;
      const nx = -uz, nz = ux;
      runs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, ux, uz, nx, nz, c: a.x * nx + a.z * nz, len: L,
        x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) });
    }
    i = j;
  }
  return runs;
}

// The run whose curb segment is nearest (x, z), starting from `hint` (the last answer: queries come in runs of
// neighbours) and skipping runs whose bounds are already further
function nearestRun(runs, x, z, hint) {
  let best = hint, bd = Infinity;
  for (let k = -1; k < runs.length; k++) {
    const r = k < 0 ? hint : k;
    if (k === hint) continue;
    const R = runs[r];
    const ox = R.x0 > x ? R.x0 - x : x > R.x1 ? x - R.x1 : 0, oz = R.z0 > z ? R.z0 - z : z > R.z1 ? z - R.z1 : 0;
    if (ox * ox + oz * oz >= bd) continue;
    const dx = R.bx - R.ax, dz = R.bz - R.az;
    let t = ((x - R.ax) * dx + (z - R.az) * dz) / (dx * dx + dz * dz || 1e-12);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = R.ax + dx * t - x, ez = R.az + dz * t - z, d = ex * ex + ez * ez;
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}

// Clip a polygon of vertex records ([x, y, z, nx, ny, nz]) to f(p) <= 0, f affine in (x, z)
function clipRecords(poly, fx, fz, f0) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i], B = poly[(i + 1) % poly.length];
    const fa = A[0] * fx + A[2] * fz + f0, fb = B[0] * fx + B[2] * fz + f0;
    if (fa <= 0) out.push(A);
    if ((fa <= 0) !== (fb <= 0)) {
      const t = fa / (fa - fb);
      out.push(A.map((v, k) => v + (B[k] - v) * t));
    }
  }
  return out;
}

// How far across the walk reaches through (x, z) along the run's normal: [t0, t1] from the walk's edges `segs`
// ([ax, az, bx, bz, ...], every ring of the island's walk), or null
function spanAcross(segs, x, z, nx, nz) {
  let lo = -Infinity, hi = Infinity;
  for (let i = 0; i < segs.length; i += 4) {
    const ax = segs[i], az = segs[i + 1], ex = segs[i + 2] - ax, ez = segs[i + 3] - az;
    const den = nx * ez - nz * ex; // n x e
    if (den > -1e-12 && den < 1e-12) continue;
    const px = ax - x, pz = az - z;
    const sig = -(px * nz - pz * nx) / den; // where along the edge ((p0 - a) x n / (e x n))
    if (sig < 0 || sig >= 1) continue;
    const tau = (px * ez - pz * ex) / den; // along the normal ((a - p0) x e / (n x e))
    if (tau <= 0) { if (tau > lo) lo = tau; } else if (tau < hi) hi = tau;
  }
  return lo > -Infinity && hi < Infinity ? [lo, hi] : null;
}

/**
 * Walk frames for a non-indexed triangle soup on one island. `pos`, `nor`: its arrays (3 floats a vertex); `runs`:
 * curbRuns of the island; `segs`: the walk's edges (spanAcross); `seeds`: a seed (integer < 2^16) per run; `downtown`:
 * 0/1. Top faces are cut where a corner crosses them. Returns { pos, nor, frame (4 floats a vertex), span (2) }.
 */
function walkFrames(pos, nor, runs, segs, seeds, downtown) {
  const out = []; // [run, x0, y0, z0, nx0, ny0, nz0, x1, ..., z2 ...] per triangle: run & 3 records of 6
  const whole = []; // [run, first vertex] of the triangles kept as they are
  const nv = pos.length / 3;
  let hint = 0;
  const rec = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]];
  for (let v = 0; v + 2 < nv; v += 3) {
    const x0 = pos[v * 3], z0 = pos[v * 3 + 2], x1 = pos[v * 3 + 3], z1 = pos[v * 3 + 5], x2 = pos[v * 3 + 6], z2 = pos[v * 3 + 8];
    const cx = (x0 + x1 + x2) / 3, cz = (z0 + z1 + z2) / 3;
    if (!runs.length) { whole.push(-1, v); continue; }
    hint = nearestRun(runs, cx, cz, hint);
    if (nor[v * 3 + 1] + nor[v * 3 + 4] + nor[v * 3 + 7] < 1.5) { whole.push(hint, v); continue; } // (not a top face)
    // the runs nearest its corners & centre; runs within ~20 degrees of one already listed add nothing (a jog in the
    // traced curb, a gentle curve), so only a real corner cuts a triangle
    const list = [hint];
    for (const r of [nearestRun(runs, x0, z0, hint), nearestRun(runs, x1, z1, hint), nearestRun(runs, x2, z2, hint)]) {
      if (!list.some((k) => k === r || runs[k].ux * runs[r].ux + runs[k].uz * runs[r].uz > 0.94)) list.push(r);
    }
    if (list.length === 1) { whole.push(hint, v); continue; }
    // a corner: each run takes the part where it is the nearest curb line (the lines' bisectors). (A run whose part
    // would be a sliver, under 0.05 m² or 2% of the triangle, leaves it to the others: the cut is only worth its extra
    // triangles where a corner really crosses the triangle)
    const T = [rec(v), rec(v + 1), rec(v + 2)];
    const cut = (ks) => ks.map((k) => {
      let poly = T;
      const A = runs[k];
      for (const j of ks) {
        if (j === k || poly.length < 3) continue;
        const B = runs[j];
        poly = clipRecords(poly, A.nx - B.nx, A.nz - B.nz, -(A.c - B.c)); // (x nA - cA) - (x nB - cB) <= 0
      }
      let area = 0;
      for (let i = 1; i + 1 < poly.length; i++) area += Math.abs((poly[i][0] - poly[0][0]) * (poly[i + 1][2] - poly[0][2]) - (poly[i][2] - poly[0][2]) * (poly[i + 1][0] - poly[0][0])) / 2;
      return { k, poly, area };
    });
    let parts = cut(list);
    const total = parts.reduce((m, p) => m + p.area, 0);
    const keep = parts.filter((p) => p.area >= Math.max(0.05, total * 0.02));
    if (keep.length < parts.length) {
      if (keep.length > 1) parts = cut(keep.map((p) => p.k));
      else { whole.push((keep[0] || parts.reduce((a, b) => (b.area > a.area ? b : a))).k, v); continue; }
    }
    for (const { k, poly } of parts) for (let i = 1; i + 1 < poly.length; i++) out.push(k, ...poly[0], ...poly[i], ...poly[i + 1]);
  }
  // Every triangle as (run, 3 x (x, y, z, nx, ny, nz)), the kept ones first: copied out into flat arrays
  const nWhole = whole.length / 2, nCut = out.length / 19, n = nWhole + nCut;
  const P = new Float32Array(n * 9), N = new Float32Array(n * 9), run = new Int32Array(n);
  for (let i = 0; i < nWhole; i++) {
    run[i] = whole[i * 2];
    const v = whole[i * 2 + 1];
    for (let c = 0; c < 9; c++) { P[i * 9 + c] = pos[v * 3 + c]; N[i * 9 + c] = nor[v * 3 + c]; }
  }
  for (let i = nWhole; i < n; i++) {
    const o = (i - nWhole) * 19;
    run[i] = out[o];
    for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) { P[i * 9 + k * 3 + c] = out[o + 1 + k * 6 + c]; N[i * 9 + k * 3 + c] = out[o + 4 + k * 6 + c]; }
  }
  // spans across the walk, then each run's typical span where a triangle's is within a little of it (so a straight walk's
  // stamps & margins don't jump where the City's outline wavers by a few cm). Each run looks only at the walk's edges
  // near it (walks are narrower than REACH m)
  const REACH = 30;
  const near = new Map();
  const segsNear = (r) => {
    let list = near.get(r);
    if (list) return list;
    const R = runs[r];
    list = [];
    for (let i = 0; i < segs.length; i += 4) {
      const sa = (segs[i] - R.ax) * R.ux + (segs[i + 1] - R.az) * R.uz, sb = (segs[i + 2] - R.ax) * R.ux + (segs[i + 3] - R.az) * R.uz;
      const ta = segs[i] * R.nx + segs[i + 1] * R.nz - R.c, tb = segs[i + 2] * R.nx + segs[i + 3] * R.nz - R.c;
      if ((sa < -REACH && sb < -REACH) || (sa > R.len + REACH && sb > R.len + REACH) || (ta < -REACH && tb < -REACH) || (ta > REACH && tb > REACH)) continue;
      list.push(segs[i], segs[i + 1], segs[i + 2], segs[i + 3]);
    }
    near.set(r, list);
    return list;
  };
  const span = new Float32Array(n * 2);
  const has = new Uint8Array(n);
  const byRun = new Map();
  for (let i = 0; i < n; i++) {
    const r = run[i];
    if (r < 0 || N[i * 9 + 1] + N[i * 9 + 4] + N[i * 9 + 7] < 1.5) continue; // (top faces only)
    const R = runs[r];
    const ax = P[i * 9], az = P[i * 9 + 2], bx = P[i * 9 + 3], bz = P[i * 9 + 5], qx = P[i * 9 + 6], qz = P[i * 9 + 8];
    const cx = (ax + bx + qx) / 3, cz = (az + bz + qz) / 3;
    const tc = cx * R.nx + cz * R.nz - R.c;
    const sp = spanAcross(segsNear(r), cx, cz, R.nx, R.nz);
    if (sp) {
      span[i * 2] = tc + sp[0];
      span[i * 2 + 1] = tc + sp[1];
      has[i] = 1;
      const area = Math.abs((bx - ax) * (qz - az) - (bz - az) * (qx - ax)) / 2;
      if (!byRun.has(r)) byRun.set(r, []);
      byRun.get(r).push(span[i * 2], span[i * 2 + 1], area);
    } else {
      const ta = ax * R.nx + az * R.nz - R.c, tb = bx * R.nx + bz * R.nz - R.c, tq = qx * R.nx + qz * R.nz - R.c;
      span[i * 2] = Math.min(ta, tb, tq);
      span[i * 2 + 1] = Math.max(ta, tb, tq);
    }
  }
  const median = (list, k) => {
    const idx = [];
    for (let i = 0; i < list.length; i += 3) idx.push(i);
    idx.sort((a, b) => list[a + k] - list[b + k]);
    let half = 0;
    for (const i of idx) half += list[i + 2];
    half /= 2;
    let acc = 0;
    for (const i of idx) if ((acc += list[i + 2]) >= half) return list[i + k];
    return list[idx[idx.length - 1] + k];
  };
  const typical = new Map();
  for (const [r, list] of byRun) typical.set(r, [median(list, 0), median(list, 1)]);
  const F = new Float32Array(n * 12), S = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const r = run[i];
    let t0 = span[i * 2], t1 = span[i * 2 + 1];
    const m = typical.get(r);
    if (m && has[i] && Math.abs(t0 - m[0]) < 0.35 && Math.abs(t1 - m[1]) < 0.35) { t0 = m[0]; t1 = m[1]; }
    const R = r >= 0 ? runs[r] : { ux: 1, uz: 0, c: 0 };
    const w = (r >= 0 ? seeds[r] : 0) * 2 + downtown;
    for (let k = 0; k < 3; k++) {
      const o = i * 3 + k;
      F[o * 4] = R.ux; F[o * 4 + 1] = R.uz; F[o * 4 + 2] = R.c; F[o * 4 + 3] = w;
      S[o * 2] = t0; S[o * 2 + 1] = t1;
    }
  }
  return { pos: P, nor: N, frame: F, span: S };
}

// The walk's edges as segments for spanAcross, from rings of {x, z}
function ringSegments(rings) {
  const out = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      out.push(a.x, a.z, b.x, b.z);
    }
  }
  return out;
}

// A run's seed, from its island & its place on it (each side of a block is its own pour)
const runSeed = (island, run) => (Math.imul(island + 1, 0x9e3779b1) ^ Math.imul(run + 7, 0x85ebca77)) >>> 16;

// ---------------------------------------------------------------------------------------------------------------------
// Finding a stamp in the built city (capture tools): the nearest stamp to (x, z) within r m, on the Walkways meshes
// ---------------------------------------------------------------------------------------------------------------------
function findSidewalkStamp(x, z, r = 30) {
  const app = window.__CITY_APP;
  if (!app) return null;
  let best = null;
  app.scene.traverse((o) => {
    if (!o.isMesh || o.name !== 'Walkways') return;
    const g = o.geometry, P = g.attributes.position, F = g.attributes.walkFrame, W = g.attributes.walkSpan, Nn = g.attributes.normal;
    if (!P || !P.array || !F || !F.array || !P.array.length) return;
    for (let v = 0; v + 2 < P.count; v += 3) {
      if (Nn.getY(v) < 0.5) continue;
      const xs = [P.getX(v), P.getX(v + 1), P.getX(v + 2)], zs = [P.getZ(v), P.getZ(v + 1), P.getZ(v + 2)];
      if (Math.min(...xs) > x + r || Math.max(...xs) < x - r || Math.min(...zs) > z + r || Math.max(...zs) < z - r) continue;
      const ux = F.getX(v), uz = F.getY(v), c = F.getZ(v), w = F.getW(v);
      const seed = Math.floor(w / 2), downtown = w - seed * 2 > 0.5 ? 1 : 0;
      const t0 = W.getX(v), t1 = W.getY(v);
      const nx = -uz, nz = ux;
      const ss = xs.map((px, i) => px * ux + zs[i] * uz);
      const phase = sectionPhase(seed);
      for (let k = Math.floor((Math.min(...ss) - phase) / SIDEWALK.bay); k <= Math.floor((Math.max(...ss) - phase) / SIDEWALK.bay); k++) {
        const st = stampCentre(k, seed, downtown, t0, t1);
        if (!st) continue;
        // back to world xz: x = s u + (t + c) n
        const px = st.s * ux + (st.t + c) * nx, pz = st.s * uz + (st.t + c) * nz;
        const d = Math.hypot(px - x, pz - z);
        if (d > r || (best && d >= best.d)) continue;
        // inside this triangle?
        const cr = (i, j) => (xs[j] - xs[i]) * (pz - zs[i]) - (zs[j] - zs[i]) * (px - xs[i]);
        const c0 = cr(0, 1), c1 = cr(1, 2), c2 = cr(2, 0);
        if ((c0 < 0 || c1 < 0 || c2 < 0) && (c0 > 0 || c1 > 0 || c2 > 0)) continue;
        best = { x: +px.toFixed(3), z: +pz.toFixed(3), ux: +ux.toFixed(4), uz: +uz.toFixed(4), year: st.year, oval: st.oval, end: st.end, d };
      }
    }
  });
  return best;
}

Object.assign(CITY, {
  SIDEWALK, sectionHash, sectionPhase, sidewalkSection, stampCentre, curbRuns, walkFrames, ringSegments, runSeed,
  spanAcross, findSidewalkStamp
});
})();
