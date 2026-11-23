// tools/school-fences-lib.mjs — the schoolyard fence rules of st-ndw9.14 (docs/school-fences.md), pure and testable
// without the shared Toronto data repo. The build (tools/build-school-fences.mjs) supplies the grounds outline, the
// main building, the road and path crossings, the building-wall and water tests and the mapped OSM fence segments; this
// module turns them into fence runs in the city's world frame.
//
// The rules (John, 2026-11-15: "If it's a school, it has a fence"):
//
//   | rule | test | effect |
//   | --- | --- | --- |
//   | the front is open | the grounds boundary in front of the main building's street-facing side, plus a margin each way | no fence (the school's street entrance stays open) |
//   | nothing to fence: a wall | the boundary runs within WALL_CLEAR_M of a building's wall (the school's own or a neighbour's) | no fence |
//   | nothing to fence: a crossing | a road, lane or footpath in Slop's data crosses the boundary | a gap CROSS_MARGIN_M wider than what crosses, each side |
//   | nothing to fence: water or the frame's edge | the outline runs through water or outside the active frame | no fence |
//   | a mapped fence is kept | OpenStreetMap maps a barrier=fence or barrier=wall within FENCE_TOL_M of the boundary | fence, even where a rule above would remove it (except outside the frame, which cannot be drawn) |
//   | short runs go | a run shorter than MIN_RUN_M | no fence |
//
// The outline is simplified first (SIMPLIFY_TOL_M) so the fence does not zigzag at decimetre scale. A grounds whose
// outline is a point or is not a school yard (an area over MAX_AREA_M2, a university or college campus) gets nothing:
// tools/build-school-fences.mjs drops those before calling here.

export const RULES = {
  sampleM: 1,           // the outline is sampled every metre; the rules judge each sample
  simplifyTolM: 0.75,   // Douglas-Peucker tolerance on the outline and on each run (decimetre-scale zigzag goes)
  frontMarginM: 4,      // the front opening extends this far each way past the main building's street-facing side
  wallClearM: 0.5,      // boundary within this of a building wall: no fence
  crossMarginM: 1.5,    // a crossing's gap is what crosses plus this, each side
  fenceTolM: 3,         // OSM fence/wall within this of the boundary is kept (school-grounds/1's fenceTolM)
  minRunM: 3,           // runs shorter than this are dropped
  maxAreaM2: 100000,    // about 10 hectares: a grounds this large is not a school yard
  campusKinds: ['University', 'College'],
  downtownBbox: { lon0: -79.495, lon1: -79.315, lat0: 43.595, lat1: 43.692 }
};

// ---------------------------------------------------------------------------------------------------------------------
// Flat rings: [[x, z], ...], not closed (the last point is not repeated). A ring here is one outer boundary.
// ---------------------------------------------------------------------------------------------------------------------

export function ringPerimeter(ring) {
  let d = 0;
  for (let i = 0; i < ring.length; i++) { const j = (i + 1) % ring.length; d += Math.hypot(ring[j][0] - ring[i][0], ring[j][1] - ring[i][1]); }
  return d;
}

export function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const j = (i + 1) % ring.length; a += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1]; }
  return Math.abs(a) / 2;
}

function perpDistance(p, a, b) {
  const ex = b[0] - a[0], ez = b[1] - a[1], L2 = ex * ex + ez * ez;
  if (L2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a[0] + ex * t - p[0], a[1] + ez * t - p[1]);
}

/** Douglas-Peucker over an open polyline; the first and last points are always kept. */
export function simplifyOpen(pts, tol) {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    let dmax = -1, imax = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const d = perpDistance(pts[i], pts[i0], pts[i1]);
      if (d > dmax) { dmax = d; imax = i; }
    }
    if (dmax > tol && imax > 0) { keep[imax] = 1; stack.push([i0, imax], [imax, i1]); }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/** Douglas-Peucker over a closed ring: split at the vertex farthest from vertex 0, simplify both arcs. */
export function simplifyRing(ring, tol) {
  if (ring.length <= 3) return ring.map((p) => [p[0], p[1]]);
  let far = 0, fd = -1;
  for (let i = 1; i < ring.length; i++) { const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]); if (d > fd) { fd = d; far = i; } }
  const arcA = ring.slice(0, far + 1);
  const arcB = ring.slice(far).concat([ring[0]]);
  const merged = simplifyOpen(arcA, tol).slice(0, -1).concat(simplifyOpen(arcB, tol));
  merged.pop(); // (the closure repeats ring[0])
  return merged.length >= 3 ? merged : ring.map((p) => [p[0], p[1]]);
}

/** Whether (x, z) is inside the ring (ray casting). */
export function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from (px, pz) to the segment a-b. */
export function distanceToSegment(px, pz, ax, az, bx, bz) {
  const ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez;
  if (L2 === 0) return Math.hypot(px - ax, pz - az);
  let t = ((px - ax) * ex + (pz - az) * ez) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + ex * t - px, az + ez * t - pz);
}

/**
 * The intersection of segments a-b and c-d, or null. Returns the parameter along a-b (0..1) and the point, so a
 * crossing can be placed by ring arc length.
 */
export function segIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((cx - ax) * sz - (cz - az) * sx) / den;
  const u = ((cx - ax) * rz - (cz - az) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u, x: ax + rx * t, z: az + rz * t };
}

/**
 * Samples around a closed ring, every `step` m: { samples: [{ x, z, s }], length, vertexS } (s the arc length from the
 * first vertex; vertexS[i] the arc length at vertex i, so a crossing's ring position is known).
 */
export function sampleRing(ring, step) {
  const out = [], vertexS = [];
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    vertexS.push(s);
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    const seg = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(seg / step));
    for (let k = 0; k < n; k++) { const t = k / n; out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, s: s + seg * t }); }
    s += seg;
  }
  return { samples: out, length: s, vertexS };
}

// ---------------------------------------------------------------------------------------------------------------------
// Masks: one flag per sample.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The front is open. `frontage` is the main building's street-facing extent as a band across the way to the street:
 * { x, z, ux, uz (toward the street), px, pz (along the street), minP, maxP (the extent along px, relative to x, z),
 * len (maxP - minP, the street frontage) }. A sample is "in front" when it lies on the street side (its projection
 * along u is positive) and its projection along p is within [minP - margin, maxP + margin]. This bounds the opening
 * to the street frontage plus the margins, not the whole building mass. Returns the mask and the arc length of each
 * contiguous front stretch (the opening's width).
 */
export function frontMask(samples, length, frontage, margin) {
  const mask = new Uint8Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const ox = samples[i].x - frontage.x, oz = samples[i].z - frontage.z;
    const t = ox * frontage.ux + oz * frontage.uz;
    const q = ox * frontage.px + oz * frontage.pz;
    if (t > 0 && q >= frontage.minP - margin && q <= frontage.maxP + margin) mask[i] = 1;
  }
  return { mask, widths: maskWidths(samples, mask, length) };
}

/**
 * The fallback frontage when the building's street extent is unknown: a band through the building's centre, across
 * the way to the street, of the building's width, facing the street.
 */
export function centeredFrontage(building, street) {
  const dx = street.x - building.x, dz = street.z - building.z, L = Math.hypot(dx, dz) || 1;
  const ux = dx / L, uz = dz / L, px = -uz, pz = ux, half = building.width / 2;
  return { x: building.x, z: building.z, ux, uz, px, pz, minP: -half, maxP: half, len: building.width };
}

/** The crossing gaps: for each line that crosses a ring edge, half the line's width plus the margin each side. */
export function crossingMask(ring, samples, length, vertexS, crossings, margin) {
  const mask = new Uint8Array(samples.length);
  const gaps = [];
  for (const line of crossings) {
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
      const hit = segIntersect(ax, az, bx, bz, line.ax, line.az, line.bx, line.bz);
      if (!hit) continue;
      const sHit = vertexS[i] + hit.t * Math.hypot(bx - ax, bz - az);
      const half = line.width / 2 + margin;
      gaps.push([sHit - half, sHit + half]);
      for (let k = 0; k < samples.length; k++) if (inArc(samples[k].s, sHit - half, sHit + half, length)) mask[k] = 1;
    }
  }
  return { mask, gaps };
}

/** Whether an arc distance s lies in [s0, s1] (wrapping around the ring's length). */
function inArc(s, s0, s1, L) {
  const w = (x) => ((x % L) + L) % L;
  const a = w(s0), b = w(s1), p = w(s);
  return a <= b ? p >= a && p <= b : p >= a || p <= b;
}

/** The mapped OSM fence/wall mask: samples within `tol` of a mapped barrier segment. */
export function mappedMask(samples, fenceSegments, tol) {
  const mask = new Uint8Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const { x, z } = samples[i];
    for (const f of fenceSegments) if (distanceToSegment(x, z, f.ax, f.az, f.bx, f.bz) <= tol) { mask[i] = 1; break; }
  }
  return mask;
}

/** A boolean mask's contiguous runs as arc lengths (used for the front opening's width). */
export function maskWidths(samples, mask, L) {
  const n = samples.length, widths = [];
  const start = firstBoundary(mask);
  if (start < 0) return widths;
  let run = 0;
  for (let i = 0; i < n; i++) {
    const k = (start + i) % n;
    if (mask[k]) run += sampleSpan(samples, k, L);
    else if (run) { widths.push(run); run = 0; }
  }
  if (run) widths.push(run);
  return widths;
}

/** The first index after a change of the mask around the closed ring, or -1 when the mask is uniform. */
function firstBoundary(mask) {
  const n = mask.length;
  for (let i = 0; i < n; i++) if (mask[i] !== mask[(i + 1) % n]) return (i + 1) % n;
  return -1;
}

/** Clear a mask's runs longer than `cap` (in arc length), from the ends in, to bound the front opening. */
function trimRuns(samples, mask, L, cap) {
  const n = mask.length;
  const start = firstBoundary(mask);
  if (start < 0) return;
  let i = 0;
  while (i < n) {
    const k = (start + i) % n;
    if (!mask[k]) { i++; continue; }
    const idx = [];
    let len = 0;
    while (i + idx.length < n && mask[(start + i + idx.length) % n]) { const kk = (start + i + idx.length) % n; idx.push(kk); len += sampleSpan(samples, kk, L); }
    let drop = len - cap;
    if (drop > 0.5) {
      let lo = 0, hi = idx.length - 1;
      while (drop > 0.5 && lo <= hi) {
        if (sampleSpan(samples, idx[hi], L) <= drop + 1e-6) { drop -= sampleSpan(samples, idx[hi], L); mask[idx[hi]] = 0; hi--; }
        else { mask[idx[lo]] = 0; drop -= sampleSpan(samples, idx[lo], L); lo++; }
      }
    }
    i += idx.length;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The orchestrator
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Turn one simplified grounds ring into fence runs. `opts`:
 *   frontage      { ax, az, bx, bz, nx, nz }  the main building's street-facing edge and outward normal (preferred)
 *   building      { x, z, width }  the main building (its width is its street frontage)
 *   street        { x, z }         the nearest point of the street the front faces
 *   frontageM     number           the frontage; the opening is capped at this plus the margins (fix 1)
 *   crossings     [{ ax, az, bx, bz, width }]  road/lane/footpath segments that may cross the ring
 *   nearWall      (x, z) => bool   inside WALL_CLEAR_M of a building wall
 *   waterAt       (x, z) => bool
 *   inFrameAt     (x, z) => bool   inside the active frame (default true everywhere)
 *   fenceSegments [{ ax, az, bx, bz }]  mapped OSM fence/wall segments
 *   rules         overrides of RULES
 * Returns { runs: [[[x, z], ...]], metres, mappedKeptM, removedM: { front, wall, cross, water, frame, short },
 *           openingWidthsM: [number] }. A run is simplified again so straight fences stay two points.
 */
export function planFenceRuns(ring, opts = {}) {
  const R = { ...RULES, ...(opts.rules || {}) };
  const removedM = { front: 0, wall: 0, cross: 0, water: 0, frame: 0, short: 0 };
  if (ring.length < 3) return { runs: [], metres: 0, mappedKeptM: 0, removedM, openingWidthsM: [] };
  const simplified = simplifyRing(ring, R.simplifyTolM);
  const { samples, length, vertexS } = sampleRing(simplified, R.sampleM);
  const n = samples.length;

  const inFrame = new Uint8Array(n);
  const water = new Uint8Array(n);
  const wall = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const { x, z } = samples[i];
    inFrame[i] = opts.inFrameAt ? (opts.inFrameAt(x, z) ? 1 : 0) : 1;
    water[i] = opts.waterAt && opts.waterAt(x, z) ? 1 : 0;
    wall[i] = opts.nearWall && opts.nearWall(x, z) ? 1 : 0;
  }
  const facade = opts.frontage || (opts.building && opts.street ? centeredFrontage(opts.building, opts.street) : null);
  const front = facade ? frontMask(samples, length, facade, R.frontMarginM) : { mask: new Uint8Array(n), widths: [] };
  // (fix 1: the opening is the frontage plus the margins; trim where the boundary bulges past it, so a small yard's
  // whole street side is not opened by one wide building)
  if (opts.frontageM) {
    trimRuns(samples, front.mask, length, opts.frontageM + 2 * R.frontMarginM);
    front.widths = maskWidths(samples, front.mask, length);
  }
  const cross = opts.crossings && opts.crossings.length ? crossingMask(simplified, samples, length, vertexS, opts.crossings, R.crossMarginM) : { mask: new Uint8Array(n) };
  const mapped = opts.fenceSegments && opts.fenceSegments.length ? mappedMask(samples, opts.fenceSegments, R.fenceTolM) : new Uint8Array(n);

  const keep = new Uint8Array(n);
  let mappedKeptM = 0;
  for (let i = 0; i < n; i++) {
    const span = sampleSpan(samples, i, length);
    const removed = water[i] || wall[i] || front.mask[i] || cross.mask[i];
    keep[i] = inFrame[i] && (mapped[i] || !removed) ? 1 : 0;
    if (mapped[i]) mappedKeptM += span;
    if (front.mask[i]) removedM.front += span;
    if (wall[i]) removedM.wall += span;
    if (cross.mask[i]) removedM.cross += span;
    if (water[i]) removedM.water += span;
    if (!inFrame[i]) removedM.frame += span;
  }

  const runs = [];
  const start = firstBoundary(keep);
  if (start >= 0) {
    let cur = [];
    for (let i = 0; i < n; i++) {
      const k = (start + i) % n;
      if (keep[k]) cur.push(samples[k]);
      else if (cur.length) { runs.push(cur); cur = []; }
    }
    if (cur.length) runs.push(cur);
  }

  const out = [];
  let metres = 0;
  for (const run of runs) {
    const simple = simplifyOpen(run.map((p) => [p.x, p.z]), R.simplifyTolM);
    const d = polylineLength(simple);
    if (d < R.minRunM) { removedM.short += d; continue; }
    metres += d;
    out.push(simple);
  }
  return { runs: out, metres, mappedKeptM, removedM, openingWidthsM: front.widths };
}

function sampleSpan(samples, i, L) {
  const a = samples[i], b = samples[(i + 1) % samples.length];
  const d = b.s - a.s;
  return d >= 0 ? d : d + L;
}

export function polylineLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return d;
}

/** The p-quantile of a numeric array (nearest rank), or null when empty. */
export function quantile(values, p) {
  if (!values.length) return null;
  const a = values.slice().sort((x, y) => x - y);
  const i = Math.min(a.length - 1, Math.max(0, Math.ceil(p * a.length) - 1));
  return a[i];
}
