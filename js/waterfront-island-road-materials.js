(function () {
// js/waterfront-island-road-materials.js
// Source-backed ROAD-SURFACE materials for the two photographed Algonquin Island lanes (beads st-sb3r.25 and st-sb3r.27),
// loaded after js/waterfront-island-lanes.js and after js/tsl-materials.js, before the city ground is built.
//
// THE PROBLEM: the committed city ground (js/city-grid.js, mesh 'StreetLevel') draws the real road plane at y = 0 with
// the ONE shared `createRoadSurfaceMaterial()` asphalt. That is correct for the asphalt lanes (Cibola, Third Street,
// Lakeshore, etc.) but WRONG for the two Algonquin living streets whose primary photographs show:
//   - Oneida Avenue (File:Oneida_Avenue_on_Algonquin_Island,_Toronto_2026.jpg): dark-neutral-grey concrete rectangular
//     pavers in a 90-degree herringbone (a 2:1 brick ratio), on a narrow flush path with garden edges. Not red clay, not
//     running bond. (Captain's visual observation, paraphrased here, not a quote.)
//   - Ojibway Avenue (File:CN_Tower_visible_from_Ojibway_Avenue,_Algonquin_Island,_Toronto_2026.jpg): a weathered light-
//     neutral-grey concrete slab path, a longitudinal central joint and transverse slab joints, no asphalt speckle, no
//     road lane paint, flush planted edges. (Captain's visual observation, paraphrased.)
//
// WHAT THIS MODULE DOES — MATERIAL ONLY: it exports `applyIslandLaneRoadMaterial(material)`, a composable hook the captain
// wires onto the existing StreetLevel asphalt material AFTER that material is created. There is NO cover quad, NO raised
// geometry, NO routing/width/collider change, NO road-paint (white/yellow) change: the true road plane already exists and
// only its fragment shading is repainted inside the two photographed source runs. Outside them the material is
// bit-for-bit the native asphalt.
//
// SCOPE (no giant per-pixel loop over all city edges): at build time (CPU, once) the module rasterizes a BOUNDED
// georeferenced mask over the tight bounding box of the Oneida+Ojibway runs plus a guard, from the exact same per-way
// `ISLAND_LANES_DATA.runs` the centre-line gate uses. Each texel stores the LANE-LOCAL coordinates (s along the mapped
// way, t across it, signed), an anti-aliased coverage, and the lane id. The shader samples that small texture and runs the
// paver/slab pattern in (s, t), so the pattern is aligned to the actual mapped lane direction, not to world X/Z.
//
// SOURCE-EXACT: only ONEIDA AVENUE (run 42, way 13541126) and OJIBWAY AVENUE (run 41, way 13541122) are claimed. Unknown/
// service/Cibola roads and the Algonquin Bridge Road wood surface stay native/unresolved. Mainland & airport are excluded
// because the data has no run there and the mask is bounded to the two Algonquin rows; a frame/projection mismatch or a
// missing ISLAND_LANES_DATA returns the material untouched (a no-op), so mainland-only pages and tests are unchanged.
//
// LIMITS (documented, not hidden): paver dimensions (~0.20 x 0.10 m herringbone, ~1.5 m x 2.8 m slabs) are TYPOLOGY
// approximations, NOT measured. The visible PAVED width is a source-informed representative strip (Oneida 3.3 m, Ojibway
// 3.5 m) centred on the existing OSM lane frame; the former asphalt outside that strip inside the original bounded lane
// mask becomes grass on the SAME physical StreetLevel plane. This is NOT an exact City Road Edge footprint relocation and
// does NOT change routing, metadata widths, colliders or ground height. The exact source-to-lane transition near the shore
// is not surveyed and is not painted. The grey tones are approximate neutral-grey choices, NOT sampled from the
// photographs. See docs/waterfront-island-paved-widths.md (and the earlier material doc).
//
// PURE CPU side (pattern, lane frame, rasterized mask, sampler, layout) is safe to test in node; the TSL graph is only
// built in the browser. The CPU herringbone/slab functions are the exact same maths the shader runs, so tests prove the
// visible pattern (true perpendicular 2:1 herringbone, source-neutral grey), not a decorative tiling.

const C = window.CITY || (window.CITY = {});

const SOURCE_STATUS = 'captain-photo-reviewed-2026-11-10';

// The two photographed Oneida/Ojibway runs. A run is ONE actual OSM way (per-way data from tools/build-island-lanes.mjs's
// output), never a concatenation across water. `sourceId` is the run id in ISLAND_LANES_DATA.runs; `osmWay` is the OSM
// way id, recorded so the data and this module cannot silently drift apart.
const SOURCE_RUNS = [
  { key: 'oneida', name: 'Oneida Avenue', sourceId: 42, osmWay: 13541126,
    photoId: 'oneida-2026', kind: 'herringbone', pavedWidthM: 3.3,
    title: 'File:Oneida Avenue on Algonquin Island, Toronto 2026.jpg',
    url: 'https://commons.wikimedia.org/wiki/File:Oneida_Avenue_on_Algonquin_Island,_Toronto_2026.jpg',
    observation: 'dark-neutral-grey concrete rectangular pavers, approx 2:1, 90-degree herringbone; narrow flush path, garden edges; not red clay, not running bond (paraphrase of the captain\'s visual observation)' },
  { key: 'ojibway', name: 'Ojibway Avenue', sourceId: 41, osmWay: 13541122,
    photoId: 'ojibway-2026', kind: 'slabs', pavedWidthM: 3.5,
    title: 'File:CN Tower visible from Ojibway Avenue, Algonquin Island, Toronto 2026.jpg',
    url: 'https://commons.wikimedia.org/wiki/File:CN_Tower_visible_from_Ojibway_Avenue,_Algonquin_Island,_Toronto_2026.jpg',
    observation: 'weathered light-neutral-grey concrete slab path, longitudinal central joint + transverse slab joints, no asphalt speckle, no lane paint, flush planted edges (paraphrase of the captain\'s visual observation)' }
];

// Representative VISIBLE paved widths (metres), centred on the existing OSM lane frame. These are source-informed typology,
// not an exact City Road Edge footprint: the official City Road Edge cross-sections (2021-01-01 geometry maintenance) give
// Oneida ~2.885-3.648 m (median 3.29) and Ojibway ~2.866-4.206 m (median 3.492) on the containing/nearby samples. The
// native 6.4 m OSM living-street width is a class default, not a measurement. See docs/waterfront-island-paved-widths.md.
const PAVED_HALF = { oneida: 3.3 / 2, ojibway: 3.5 / 2 };

// Typology approximations (metres). PAVER: 0.20 long x 0.10 wide (a 2:1 ratio, as the captain observed). The herringbone
// is the exact perpendicular domino tiling below; its period is 4 paver widths = 0.40 m in both lane-local axes. SLAB:
// 1.5 m to the central longitudinal joint each side x 2.8 m along. None of these are surveyed: see the doc.
const PAVER = { long: 0.20, wide: 0.10, joint: 0.006 };
const SLAB = { across: 1.5, along: 2.8, joint: 0.012, centralJoint: 0.006 };

// Approximate neutral-grey tones. These are NOT sampled from the photographs: they are hand-picked neutral greys chosen to
// read as weathered concrete in the engine's exposure. No warm clay red on either (Oneida was rejected as "red clay").
const TONE = {
  oneidaDark: 0x8c8a86,    // shadow/weathered paver
  oneidaLight: 0xb0ada7,   // sunlit paver
  oneidaJoint: 0x5a5751,   // damp sand joint
  ojibwayDark: 0x9d9b96,   // slab, weathered
  ojibwayLight: 0xc0bdb6,  // slab, sunlit
  ojibwayJoint: 0x6a675f,  // saw joint
  ojibwayCentral: 0x585550 // the sealed central joint
};

// Mask rasterization: 0.6 m a texel over the tight source bbox plus a guard. `guard` covers the grass cleanup envelope
// (grassHalf 6.0 m + a 0.5 m edge) so the widened grass never runs off the mental-rendered texture; the border texels are
// 0. The whole mask is a small texture; the actual dimensions/bytes are reported by islandRoadMaterialLayout().
// `innerEdge` is the modest anti-alias band (~0.12 m) of the representative paved strip; the strip edge itself is resolved
// per-fragment from the interpolated across-distance (see islandPavementCoverage), so the 3.3/3.5 m visible width stays
// faithful without a finer mask texture. `grassHalf` is the bounded grass-only cleanup envelope (see grassEnvelopeHalf).
const MASK = { res: 0.6, guard: 6.5, laneSlop: 0.75, edge: 0.5, innerEdge: 0.12, grassHalf: 6.0 };

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// The outer corridor coverage: the original bounded lane mask (native half-width + a 0.5 m anti-aliased edge). This is the
// gate that keeps every other lane, the mainland, the airport and the junction wedges native.
function outerCoverageAt(half, d) { return clamp01((half + MASK.edge - d) / MASK.edge); }

// The GRASS CLEANUP envelope: a bounded half-width for the grass blend ONLY. The actual visible corridor at some points is
// the union of the City's offset pavement and the OSM connector, broader than the 6.4 m source gate, so a bare 3.2 m half
// leaves a residual asphalt ribbon outside the 6.4 m mask. The envelope is a RENDERING cleanup bound, NOT a measured lane
// width and NOT an expansion of the claimed paved area: `sourceLaneAt`/`islandRoadLaneAt` keep their strict native
// half-width semantics, and the 3.3/3.5 m paved strip is unchanged. It only widens where the grass shoulder may paint.
// (It must NOT be clamped to the native half, or it would never widen; the strict corridor is the separate `outer` gate.)
function grassEnvelopeHalf() { return MASK.grassHalf; }

// The representative paved-strip coverage: a 3.3 m (Oneida) / 3.5 m (Ojibway) strip centred on the mapped lane frame, with
// a modest 0.12 m anti-aliased edge CENTRED on the strip edge (so the 0.5-coverage contour is exactly the representative
// half-width and the visible width is exact). It is a function of the signed across-distance t, so it is independent of the
// coarse mask texel size. The caller multiplies by the outer corridor coverage so junction exclusions and off-lane points
// stay native.
function pavementCoverageAt(pavedHalf, t) { return clamp01(0.5 + (pavedHalf - Math.abs(t)) / MASK.innerEdge); }

// --------------------------------------------------------------------------------------------------------------------
// The exact perpendicular 2:1 herringbone (captain's formula, in units of paver width w). A point (u, v) in lane-local
// metres maps to exactly one brick:
//   cx = floor(u/w), cy = floor(v/w), phase = positiveModulo(cx - cy, 4)
//   phase 0/1: horizontal brick, start = (cx - phase, cy), local = (fract(u/w) + phase, fract(v/w)), dims (2, 1)
//   phase 2/3: vertical brick,   start = (cx, cy - (phase === 2 ? 1 : 0)),
//                                local = (fract(u/w), fract(v/w) + (phase === 2 ? 1 : 0)), dims (1, 2)
// This partitions the integer grid into alternating perpendicular 2:1 rectangles with diagonal staircase joints. The CPU
// and TSL implementations below are the same maths.
// --------------------------------------------------------------------------------------------------------------------
function positiveModulo(a, m) { return ((a % m) + m) % m; }

// The exact CPU herringbone answer at lane-local (u, v): { brick, orient, startX, startY, localU, localV, jointDist, id,
// tone }. `jointDist` is metres to the nearest brick edge; `id` is a stable per-brick integer.
function herringboneAt(u, v) {
  const w = PAVER.wide;
  const cx = Math.floor(u / w), cy = Math.floor(v / w);
  const phase = positiveModulo(cx - cy, 4);
  const fu = u / w - cx, fv = v / w - cy;
  let orient, startX, startY, localU, localV, dims;
  if (phase === 0 || phase === 1) {
    orient = 'H'; startX = cx - phase; startY = cy; localU = fu + phase; localV = fv; dims = [2, 1];
  } else {
    orient = 'V'; startX = cx; startY = cy - (phase === 2 ? 1 : 0); localU = fu; localV = fv + (phase === 2 ? 1 : 0); dims = [1, 2];
  }
  const jointDist = Math.min(Math.min(localU, dims[0] - localU), Math.min(localV, dims[1] - localV)) * w;
  const id = (startX * 73856093) ^ (startY * 19349663) ^ (orient === 'H' ? 0 : 0x9e3779b9);
  const tone = ((id >>> 0) % 97) / 97;
  return { brick: true, orient, startX, startY, localU, localV, dims, jointDist, id, tone };
}

// The exact CPU slab answer at lane-local (s, t): { central, cross, jointDist, id, tone }. The central longitudinal joint
// is at t = 0 (the mapped lane centre line); transverse joints are at s = k * SLAB.along.
function slabAt(s, t) {
  const centralDist = Math.abs(t);
  const alongPhase = s - Math.floor(s / SLAB.along) * SLAB.along;
  const alongDist = Math.min(alongPhase, SLAB.along - alongPhase);
  const central = centralDist < SLAB.centralJoint;
  const cross = alongDist < SLAB.joint;
  const id = Math.floor(s / SLAB.along);
  const tone = ((id >>> 0) % 89) / 89;
  return { central, cross, joint: central || cross, centralDist, alongDist, id, tone };
}

// --------------------------------------------------------------------------------------------------------------------
// Lane-local frame: project a world point onto a run's centre-line polyline, returning the along distance s (metres from
// the run's first vertex), the signed across distance t (metres; positive on the left of the direction of travel), the
// perpendicular distance d, and the run's half-width. This is the geometry/path relation the shader's (s, t) pattern uses.
// --------------------------------------------------------------------------------------------------------------------
// Per-run segment index, built once per run (st-s1y8): each segment's box, so the polyline walks below skip a segment
// whose box is already further than the best distance found (the answers are unchanged: a pruned segment could not have
// won), and the cumulative length before each segment, summed in the original order. The mask builder asks these for
// every texel of the mask box, against every mapped island lane.
const RUN_INDEX = new WeakMap();
function runIndex(run) {
  let ix = RUN_INDEX.get(run);
  if (ix && ix.pts === run.points && ix.n === run.points.length) return ix;
  const pts = run.points, segs = [];
  const box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  let cum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [px, pz] = pts[i];
    if (px < box.minX) box.minX = px; if (px > box.maxX) box.maxX = px; if (pz < box.minZ) box.minZ = pz; if (pz > box.maxZ) box.maxZ = pz;
    if (i + 1 >= pts.length) break;
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    segs.push({ i, ax, az, bx, bz, dx, dz, L, cumBefore: cum,
      minX: Math.min(ax, bx), maxX: Math.max(ax, bx), minZ: Math.min(az, bz), maxZ: Math.max(az, bz) });
    if (L > 1e-9) cum += L;
  }
  ix = { pts, n: pts.length, segs, box };
  RUN_INDEX.set(run, ix);
  return ix;
}
// distance from (x, z) to a box (0 inside); a segment whose box is further than the best distance so far cannot win
const boxDist = (b, x, z) => Math.hypot(x < b.minX ? b.minX - x : x > b.maxX ? x - b.maxX : 0, z < b.minZ ? b.minZ - z : z > b.maxZ ? z - b.maxZ : 0);
const outsideGrown = (b, x, z, g) => x < b.minX - g || x > b.maxX + g || z < b.minZ - g || z > b.maxZ + g;

function laneFrameAt(run, x, z) {
  let best = null;
  for (const sg of runIndex(run).segs) {
    const { ax, az, dx, dz, L } = sg, cum = sg.cumBefore, i = sg.i;
    if (!(L > 1e-9)) continue;
    if (best && boxDist(sg, x, z) > best.d + 1e-9) continue;
    let u = ((x - ax) * dx + (z - az) * dz) / (L * L);
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const px = ax + dx * u, pz = az + dz * u;
    const d = Math.hypot(px - x, pz - z);
    if (!best || d < best.d) {
      // signed perpendicular: cross(direction, point - a) / L; positive on the left of the direction
      const cross = dx * (z - az) - dz * (x - ax);
      best = { d, s: cum + u * L, t: cross / L, px, pz, seg: i, u };
    }
  }
  if (!best) return null;
  best.half = (Number.isFinite(run.w) ? run.w : 6.4) / 2;
  return best;
}

function data() { return C.ISLAND_LANES_DATA || null; }

function projection() {
  const D = data();
  return D && D.projection ? D.projection : null;
}

// A projection mismatch returns no scope (a no-op). Same rule as js/waterfront-island-lanes.js: compare every recorded
// parameter, not just the frame box, because a different frame can reuse the same numeric centres.
function projectionMatches() {
  const expected = projection();
  const actual = C.GEO && C.GEO.frame && C.GEO.frame.projection;
  if (!expected || !actual) return false;
  for (const k of ['lat0', 'lon0', 'kx', 'ky', 'theta', 'ox', 'oz']) {
    const a = actual[k], e = expected[k];
    if (!Number.isFinite(a) || !Number.isFinite(e)) return false;
    if (Math.abs(a - e) > 1e-9 * Math.max(1, Math.abs(e))) return false;
  }
  return true;
}

// The two source runs, resolved by id AND OSM way (so a data swap that changes a run's id but not its way still binds, and
// a data swap that loses the way fails loudly in the tests). Returns null when data is unsuitable.
let sourceRunsCache = null;
function sourceRuns() {
  const D = data();
  if (!D || !Array.isArray(D.runs)) return null;
  // (resolved once per data object: the mask builder asks three times per texel)
  const c = sourceRunsCache;
  if (c && c.D === D && c.runs === D.runs && c.n === D.runs.length) return c.out;
  sourceRunsCache = { D, runs: D.runs, n: D.runs.length, out: sourceRunsUncached(D) };
  return sourceRunsCache.out;
}
function sourceRunsUncached(D) {
  const out = [];
  for (const spec of SOURCE_RUNS) {
    const run = D.runs.find((r) => r && r.id === spec.sourceId && Array.isArray(r.ways) && r.ways.includes(spec.osmWay));
    if (!run) return null;
    out.push({ spec, run });
  }
  return out;
}

// The tight bbox of the two runs (world metres), grown by the guard. null when the runs are absent.
function sourceBox() {
  const runs = sourceRuns();
  if (!runs) return null;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const { run } of runs) {
    for (const p of run.points) {
      if (p[0] < x0) x0 = p[0];
      if (p[0] > x1) x1 = p[0];
      if (p[1] < z0) z0 = p[1];
      if (p[1] > z1) z1 = p[1];
    }
  }
  if (![x0, x1, z0, z1].every(Number.isFinite)) return null;
  const g = MASK.guard;
  return { x0: x0 - g, x1: x1 + g, z0: z0 - g, z1: z1 + g };
}

// Distance from (x, z) to one run's centre-line polyline, in metres (and the nearest point + the run's half-width). This is
// the EXACT same distance-to-segment maths as js/waterfront-island-lanes.js islandLaneAt, reused so the material cannot
// disagree with the paint gate about where a row is.
function distanceToRun(run, x, z) {
  let bestD = Infinity, bestPx = 0, bestPz = 0;
  for (const sg of runIndex(run).segs) {
    const { ax, az, dx, dz } = sg, l2 = dx * dx + dz * dz;
    if (!(l2 > 1e-12)) continue;
    if (bestD < Infinity && boxDist(sg, x, z) > bestD + 1e-9) continue;
    let t = ((x - ax) * dx + (z - az) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t, pz = az + dz * t;
    const d = Math.hypot(px - x, pz - z);
    if (d < bestD) { bestD = d; bestPx = px; bestPz = pz; }
  }
  return { d: bestD, x: bestPx, z: bestPz, half: (Number.isFinite(run.w) ? run.w : 6.4) / 2 };
}

// JUNCTION EXCLUSION: the Ojibway way shares its endpoints with other mapped rows (Algonquin Bridge Road at the NE end and
// Seneca Avenue at the SW end), so a plain distance tube would paint ~4 m of those OTHER lanes' carriageway (they are
// photographed/asphalt rows this module must not touch). We therefore refuse a point on a source lane whenever another
// mapped island lane is *inside its own half-width* there AND is at least as close to its own centre line. On a genuine
// Oneida/Ojibway cross-section no other row's centre line is that close (the fishbone rows meet only at their endpoints),
// so this removes exactly the junction wedges and nothing else.
// (the other lanes, filtered once per data object, each with its points' box: both tests below need the point within
// half + 1 m of the run, so a run whose grown box misses the point is skipped)
let otherLanesCache = null;
function otherLanes(D) {
  const c = otherLanesCache;
  if (c && c.D === D && c.runs === D.runs && c.n === D.runs.length) return c.out;
  const out = [];
  for (const r of D.runs) {
    if (!r || !Array.isArray(r.points) || r.points.length < 2) continue;
    if ((r.names || []).includes('Oneida Avenue') || (r.names || []).includes('Ojibway Avenue')) continue;
    out.push({ r, box: runIndex(r).box, half: (Number.isFinite(r.w) ? r.w : 6.4) / 2 });
  }
  otherLanesCache = { D, runs: D.runs, n: D.runs.length, out };
  return out;
}
function otherLaneCloser(x, z, srcD, slack = MASK.laneSlop) {
  const D = data();
  if (!D || !Array.isArray(D.runs)) return false;
  for (const { r, box, half: grow } of otherLanes(D)) {
    if (outsideGrown(box, x, z, grow + 1)) continue;
    if (slack > MASK.laneSlop) {
      // Grass cleanup envelope: also test the run's own geometry so the widened envelope cannot cover another lane's
      // centre line even where that run has no vertex inside the box.
      const dAny = distanceToRun(r, x, z).d;
      const halfAny = (Number.isFinite(r.w) ? r.w : 6.4) / 2;
      if (dAny <= halfAny && dAny <= srcD + slack) return true;
    }
    const half = (Number.isFinite(r.w) ? r.w : 6.4) / 2;
    let near = false;
    for (const p of r.points) {
      if (Math.abs(p[0] - x) <= half + 1 && Math.abs(p[1] - z) <= half + 1) { near = true; break; }
    }
    if (!near) continue;
    const d = distanceToRun(r, x, z).d;
    if (d <= half && d <= srcD + MASK.laneSlop) return true;
  }
  return false;
}

// The nearest source run at (x, z), or null. `half` is the native lane half-width; only points within it (plus the small
// geodata-to-OSM slop) are claimed, so the mask never paints the verge or the yards.
function sourceLaneAt(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const runs = sourceRuns();
  if (!runs) return null;
  let best = null;
  for (const entry of runs) {
    // (a point outside the run's box grown by its half-width and slop cannot be within them)
    if (outsideGrown(runIndex(entry.run).box, x, z, (Number.isFinite(entry.run.w) ? entry.run.w : 6.4) / 2 + MASK.laneSlop)) continue;
    const hit = distanceToRun(entry.run, x, z);
    if (hit.d > hit.half + MASK.laneSlop) continue;
    if (!best || hit.d < best.d) best = { spec: entry.spec, run: entry.run, ...hit };
  }
  if (!best) return null;
  if (otherLaneCloser(x, z, best.d)) return null;
  return best;
}

// SOURCE ELIGIBILITY for the GRASS cleanup envelope: unlike sourceLaneAt it has no native half-width gate (so the City-
// offset connector along the named ways is covered), but it still binds to the nearest Oneida/Ojibway run, still refuses a
// point nearer the mapped centre line of another island lane, and applies the SAME junction exclusion (with a wider
// slack across the envelope so the wedge cannot bleed). It never widens the paved claim: the paved strip stays 3.3/3.5 m.
function sourceEligibleAt(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const runs = sourceRuns();
  if (!runs) return null;
  // (outside every run's box grown by the envelope, the nearest run is further than the envelope: null, as below)
  if (runs.every((entry) => outsideGrown(runIndex(entry.run).box, x, z, MASK.grassHalf + MASK.edge))) return null;
  let best = null;
  for (const entry of runs) {
    const hit = distanceToRun(entry.run, x, z);
    if (!best || hit.d < best.d) best = { spec: entry.spec, run: entry.run, ...hit };
  }
  if (!best || best.d > MASK.grassHalf + MASK.edge) return null;
  if (otherLaneCloser(x, z, best.d, MASK.edge)) return null;
  return best;
}

let _maskCache = null;

// The nearest source run at (x, z) regardless of the lane half-width: used to give EVERY texel in the mask box a padded
// lane-local (s, t) frame, so the interpolation near the lane edge is not distorted by zeroed coordinates.
function nearestSourceRun(x, z) {
  const runs = sourceRuns();
  if (!runs) return null;
  let best = null;
  for (const entry of runs) {
    const hit = distanceToRun(entry.run, x, z);
    if (!best || hit.d < best.d) best = { spec: entry.spec, run: entry.run, ...hit };
  }
  return best;
}

// The mask is a Float32 RGBA texture with NearestFilter, sampled with an explicit manual bilinear in the shader. Float32
// filtering is an optional WebGPU feature (not on every phone), so we never ask the sampler to filter it; the manual
// bilinear is four nearest fetches. s is stored UNWRAPPED over the full bounded lane length (so a LinearFilter-style
// interpolation can never run backwards at a wrap); the pattern applies modulo only AFTER interpolation. t is the signed
// across distance. B is the anti-aliased outer corridor coverage; A is the signed lane id (0.5 off, 1.0 Oneida,
// 0.0 Ojibway). The representative paved-strip edge is NOT baked into B: it is computed ANALYTICALLY, after interpolating
// the continuous lane-local t, from abs(t), the per-lane representative half-width (1.65/1.75 m) and a 0.12 m smooth edge,
// multiplied by the outer corridor coverage. This keeps the small ~2 MB mask and a sub-texel-faithful width.
const S_PERIOD = 2.8; // the pattern period (a common multiple of the 0.4 m herringbone and 2.8 m slab periods)

// Build the CPU rasterized mask ONCE for the current data + geometry. Every texel in the box gets a padded (s, t) frame
// from the nearest run; coverage is 0 outside the lane. The outer border has coverage 0 and id off, so a clamp-to-edge
// sample outside the bounds is always off. The actual dimensions/bytes are recorded and reported by
// islandRoadMaterialLayout().
function buildMask({ THREE = C.THREE, force = false } = {}) {
  const box = sourceBox();
  if (!box) return null;
  if (_maskCache && !force && _maskCache.box.x0 === box.x0 && _maskCache.box.z0 === box.z0
      && _maskCache.box.x1 === box.x1 && _maskCache.box.z1 === box.z1
      && _maskCache.data === data() && _maskCache.geo === C.GEO && (!!_maskCache.tex === !!THREE)) return _maskCache;
  const runs = sourceRuns();
  if (!runs) return null;
  const res = MASK.res;
  const w = Math.max(2, Math.ceil((box.x1 - box.x0) / res));
  const h = Math.max(2, Math.ceil((box.z1 - box.z0) / res));
  const px = (box.x1 - box.x0) / w, pz = (box.z1 - box.z0) / h;
  // Two Float32 RGBA textures: base = (s, t, outer corridor coverage, signed id); grass = (shoulder cleanup coverage, 0, 0,
  // 0). Float32 RGBA is the portable float layout (no optional float32-filterable feature); both use NearestFilter + the
  // shader's manual bilinear.
  const base4 = new Float32Array(w * h * 4);
  const grass4 = new Float32Array(w * h * 4);
  let inside = 0, grassInside = 0;
  for (let j = 0; j < h; j++) {
    const z = box.z0 + (j + 0.5) * pz;
    for (let i = 0; i < w; i++) {
      const x = box.x0 + (i + 0.5) * px;
      const near = nearestSourceRun(x, z);
      if (!near) continue;
      const frame = laneFrameAt(near.run, x, z);
      if (!frame) continue;
      // Strict source eligibility (native half-width + junction exclusion) for the outer corridor and lane id; the grass
      // cleanup envelope uses its own bounded eligibility (no native half-width gate, same junction exclusion).
      const hit = sourceLaneAt(x, z);
      const eligible = sourceEligibleAt(x, z);
      let outer = 0, shoulder = 0, id = 0;
      if (hit) {
        outer = outerCoverageAt(frame.half, frame.d);
        id = hit.spec.key === 'oneida' ? 1 : 2;
      }
      if (eligible && frame.d <= MASK.grassHalf + MASK.edge) {
        shoulder = outerCoverageAt(grassEnvelopeHalf(), frame.d);
        if (id === 0) id = eligible.spec.key === 'oneida' ? 1 : 2;
      }
      const k = (j * w + i) * 4;
      base4[k] = frame.s;          // unwrapped along distance (metres)
      base4[k + 1] = frame.t;      // signed across distance (metres)
      base4[k + 2] = outer;        // anti-aliased outer corridor coverage (strict)
      base4[k + 3] = id === 1 ? 1.0 : id === 2 ? 0.0 : 0.5; // signed lane id
      grass4[k] = shoulder;        // grass cleanup envelope coverage (bounded, grass only)
      if (outer > 0) inside++;
      if (shoulder > 0) grassInside++;
    }
  }
  // Force the outer 1-texel border to all-zero coverage and id off, so a clamp-to-edge sample outside is always off.
  const zeroBorder = (i, j) => {
    const k = (j * w + i) * 4;
    base4[k + 2] = 0; base4[k + 3] = 0.5; grass4[k] = 0;
  };
  for (let i = 0; i < w; i++) { zeroBorder(i, 0); zeroBorder(i, h - 1); }
  for (let j = 0; j < h; j++) { zeroBorder(0, j); zeroBorder(w - 1, j); }
  const makeTex = (arr) => {
    const t = new THREE.DataTexture(arr, w, h, THREE.RGBAFormat, THREE.FloatType);
    t.flipY = false;
    t.magFilter = THREE.NearestFilter; // (Float32 filtering is optional; the shader does the bilinear manually)
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };
  let tex = null, grassTex = null;
  if (THREE) { tex = makeTex(base4); grassTex = makeTex(grass4); }
  _maskCache = {
    box, res, w, h, px, pz, data4: base4, grass4, tex, grassTex, inside, grassInside,
    bytes: w * h * 16, // Float32 RGBA (16 B) per texel, per texture (two textures)
    data: data(), geo: C.GEO,
    runs: runs.map(({ spec, run }) => ({ key: spec.key, sourceId: run.id, osmWay: run.ways[0], name: spec.name, pavedWidthM: spec.pavedWidthM }))
  };
  return _maskCache;
}

// The pure CPU sampler at (x, z): { key, id, s, t, coverage, corridor, pavement, shoulder, grass } or null. It
// bilinearly interpolates the SAME Float32 values the shader's manual bilinear interpolates, then re-derives the
// representative paved strip ANALYTICALLY from the interpolated across-distance t (exactly like the shader), so it is a
// meaningful parity check. `coverage`/`corridor` is the strict outer corridor (native -> grass inside the source gate),
// `grass` the bounded grass cleanup envelope (native -> grass, can exceed the 6.4 m gate along the named ways),
// `pavement` the inner paved strip (grass -> pavers), `shoulder` the grass cover that is neither native nor paved.
// Returns null where neither the corridor nor the grass envelope covers the point.
function sampleMask(x, z, opts = {}) {
  const m = buildMask(opts);
  if (!m) return null;
  const fx = (x - m.box.x0) / m.px - 0.5, fz = (z - m.box.z0) / m.pz - 0.5;
  if (!(fx >= -0.5 && fx <= m.w - 0.5 && fz >= -0.5 && fz <= m.h - 0.5)) return null;
  const i0 = Math.floor(fx), j0 = Math.floor(fz);
  const tx = fx - i0, tz = fz - j0;
  const readAt = (buf, i, j, c) => (i < 0 || j < 0 || i >= m.w || j >= m.h) ? 0 : buf[(j * m.w + i) * 4 + c];
  const bil = (buf, c) => {
    const at = (i, j) => readAt(buf, i, j, c);
    const v00 = at(i0, j0), v10 = at(i0 + 1, j0), v01 = at(i0, j0 + 1), v11 = at(i0 + 1, j0 + 1);
    return v00 * (1 - tx) * (1 - tz) + v10 * tx * (1 - tz) + v01 * (1 - tx) * tz + v11 * tx * tz;
  };
  const corridor = bil(m.data4, 2);
  const grass = bil(m.grass4, 0);
  const cover = Math.max(corridor, grass);
  if (!(cover > 0)) return null;
  const signedId = bil(m.data4, 3); // 0.5 off, 1.0 Oneida, 0.0 Ojibway
  const isOneida = signedId > 0.5;
  const t = bil(m.data4, 1);
  const pavedHalf = isOneida ? PAVED_HALF.oneida : PAVED_HALF.ojibway;
  const pavement = pavementCoverageAt(pavedHalf, t) * cover;
  return {
    key: isOneida ? 'oneida' : 'ojibway', id: isOneida ? 1 : 2,
    s: bil(m.data4, 0), t, coverage: corridor, corridor, pavement, grass,
    shoulder: Math.max(0, cover - pavement)
  };
}

// A pure audit (no THREE, no mutation): the two source runs resolve to real per-way runs, with their recorded classes,
// lengths and OSM way ids, and the mask covers exactly them. Reports the ACTUAL texture dimensions and bytes.
function islandRoadMaterialLayout({ force = false } = {}) {
  const runs = sourceRuns();
  if (!runs) return { supported: false, reason: 'no matching ISLAND_LANES_DATA source runs' };
  const m = buildMask({ force });
  if (!m) return { supported: false, reason: 'no source box' };
  return {
    supported: true,
    status: SOURCE_STATUS,
    runs: m.runs,
    box: m.box,
    res: m.res, w: m.w, h: m.h, inside: m.inside, grassInside: m.grassInside,
    texture: { width: m.w, height: m.h, bytes: m.bytes, textures: 2, totalBytes: m.bytes * 2, format: 'RGBA Float32, NearestFilter + manual bilinear' },
    channels: { r: 's (unwrapped along, m)', g: 't (signed across, m)', b: 'outer corridor coverage', a: 'signed lane id (0.5 off, 1 Oneida, 0 Ojibway)' },
    grassChannels: { r: 'grass cleanup envelope coverage (bounded)', g: 'unused', b: 'unused', a: 'unused' },
    grassEnvelopeHalfM: MASK.grassHalf,
    pavedWidthM: { oneida: SOURCE_RUNS.find((s) => s.key === 'oneida').pavedWidthM, ojibway: SOURCE_RUNS.find((s) => s.key === 'ojibway').pavedWidthM },
    kinds: runs.map(({ spec, run }) => ({ key: spec.key, names: run.names, cls: run.cls, surface: run.surface, w: run.w, ways: run.ways, lengthM: run.lengthM, pavedWidthM: spec.pavedWidthM })),
    typology: { paver: { ...PAVER }, slab: { ...SLAB } }
  };
}

// Whether the mask is relevant to the active frame: the source bbox is entirely inside the frame's detail box, so a frame
// that excludes them is a no-op. (The data was built in the same projection as js/waterfront-island-lanes.js.)
function activeFrameCovers() {
  const box = sourceBox();
  const f = C.GEO && C.GEO.frame && (C.GEO.frame.detail || C.GEO.frame);
  if (!box || !f) return false;
  return Number.isFinite(f.x0) && Number.isFinite(f.x1) && Number.isFinite(f.z0) && Number.isFinite(f.z1)
    && box.x0 >= f.x0 && box.x1 <= f.x1 && box.z0 >= f.z0 && box.z1 <= f.z1;
}

// --------------------------------------------------------------------------------------------------------------------
// TSL layer. Everything below runs only in the browser (C.TSL is the three/tsl namespace). The exported hook COMPOSES a
// lane subgraph into the existing StreetLevel asphalt material's colorNode / roughnessNode / normalNode. Where the coverage
// is 0 every channel is the native material (unchanged); inside a lane it is the source material.
//
// The mask is a Float32 RGBA texture sampled with NearestFilter + an explicit manual bilinear (four nearest fetches), so it
// needs no optional float32-filterable feature. s is unwrapped over the full lane length; the pattern applies modulo only
// after interpolation, so a wrap can never reverse an interpolation. Comparisons produce bool nodes, so the id choice uses
// select() and the coverage blend uses mix() with the float coverage (never a bool fed to mix).
// --------------------------------------------------------------------------------------------------------------------

function maskUV(m) {
  const { vec2 } = C.TSL;
  return C.TSL.positionWorld.xz.sub(vec2(m.box.x0, m.box.z0)).div(vec2(m.w * m.px, m.h * m.pz));
}

// One manual-bilinear sample of a Float32 RGBA mask texture at the fragment. Float32 texel fetch (textureLoad) at the four
// nearest texels, weighted by the fractional coordinate. No sampler filtering, so no float32-filterable feature.
function manualBilinearTex(tex, m) {
  const T = C.TSL;
  const { Fn, float, vec2, vec4, ivec2, floor, fract, clamp, textureLoad, mix } = T;
  const W = float(m.w), H = float(m.h);
  const UV = maskUV(m); // build the UV node graph once, outside the deferred Fn body
  return Fn(() => {
    const g = UV.mul(vec2(W, H)).sub(vec2(0.5, 0.5)); // texel-centre coordinates
    const i0 = floor(g.x), j0 = floor(g.y);
    const tx = fract(g.x), ty = fract(g.y);
    const fetch = (i, j) => {
      const ci = clamp(i, float(0.0), W.sub(1.0));
      const cj = clamp(j, float(0.0), H.sub(1.0));
      return textureLoad(tex, ivec2(ci, cj));
    };
    const c00 = fetch(i0, j0), c10 = fetch(i0.add(1.0), j0), c01 = fetch(i0, j0.add(1.0)), c11 = fetch(i0.add(1.0), j0.add(1.0));
    const bilerp = (a, b, c, d) => mix(mix(a, b, tx), mix(c, d, tx), ty);
    return vec4(
      bilerp(c00.r, c10.r, c01.r, c11.r),
      bilerp(c00.g, c10.g, c01.g, c11.g),
      bilerp(c00.b, c10.b, c01.b, c11.b),
      bilerp(c00.a, c10.a, c01.a, c11.a)
    );
  })();
}

// The base mask sample at the fragment: { s, t, outer corridor coverage, signed id }.
function laneMaskSample(m) { return manualBilinearTex(m.tex, m); }

function floatConst(v) { return C.TSL.float(v); }

// Thin adapters so the pattern functions below read (s, t) and the lane id from one shared mask sample. `laneST` returns a
// vec3-like {x: s, y: t, z: outer corridor coverage}; `laneId` returns the signed id (1.0 Oneida, 0.0 Ojibway). Each still
// triggers a fresh Fn() call, so channel graphs each sample the mask once.
function laneST(m) { return laneMaskSample(m).xyz; }
function laneId(m) { return laneMaskSample(m).w; }

// The outer corridor blend (native -> grass shoulder): the anti-aliased B channel (strict source gate).
function laneOuter(m) { return laneST(m).z; }

// The grass cleanup envelope cover (native -> grass): the bounded envelope that may exceed the strict 6.4 m source gate
// along the named ways (not an expansion of the paved strip). The actual grass blend is max(outer, envelope).
function laneGrass(m) { return manualBilinearTex(m.grassTex, m).r; }

// Whether the fragment is on Oneida (the herringbone lane) rather than Ojibway.
function laneIsOneida(m) { return laneId(m).greaterThan(floatConst(0.5)); }

// The representative paved-strip cover (grass -> pavers/slabs), computed ANALYTICALLY from the interpolated lane-local
// across-distance t (NOT baked into the coarse mask), so the visible 3.3/3.5 m width is sub-texel faithful. The paved strip
// is always inside the strict source corridor, so this is clamped to laneOuter (never widened by the grass envelope). The
// actual grass blend is max(outer, envelope), which contains this strip.
function islandPavementCoverage(m) {
  const T = C.TSL;
  const { Fn, float, abs, clamp, select } = T;
  const half = PAVED_HALF;
  return Fn(() => {
    const t = laneST(m).y;
    const pavedHalf = select(laneIsOneida(m), float(half.oneida), float(half.ojibway));
    const inner = clamp(float(0.5).add(pavedHalf.sub(abs(t)).div(float(MASK.innerEdge))), float(0.0), float(1.0));
    return inner.mul(laneOuter(m));
  })();
}

// The GRASS cover (native -> grass): the union of the strict corridor and the bounded cleanup envelope. It is >= the paved
// strip wherever the strip exists, so grass always underlies the pavers.
function islandGrassCoverage(m) {
  const T = C.TSL;
  const { Fn } = T;
  return Fn(() => laneOuter(m).max(laneGrass(m)))();
}

// The Oneida herringbone colour in lane-local (s, t), the exact captain formula. Fine detail fades with the pixel
// footprint so it cannot alias at grazing angles or from the air.
function islandLaneColorOneida(m) {
  const T = C.TSL;
  const { Fn, float, vec2, mix, smoothstep, fract, floor, sin, color, length, min, select, mod } = T;
  return Fn(() => {
    const st = laneST(m);
    const s = st.x, t = st.y;
    const pxSize = length(C.TSL.fwidth(C.TSL.positionWorld.xz));
    const fineFade = smoothstep(0.06, 0.02, pxSize);
    const w = float(PAVER.wide);
    const cx = floor(s.div(w));
    const cy = floor(t.div(w));
    const phase = mod(cx.sub(cy), float(4.0));
    const fu = fract(s.div(w));
    const fv = fract(t.div(w));
    const isH = phase.lessThan(float(2.0));
    // horizontal local
    const localU_h = fu.add(phase);
    const localV_h = fv;
    // vertical local: phase 2 -> +1, phase 3 -> +0
    const vOffset = select(phase.lessThan(float(2.5)), float(1.0), float(0.0));
    const localU_v = fu;
    const localV_v = fv.add(vOffset);
    const distH = min(min(localU_h, float(2.0).sub(localU_h)), min(localV_h, float(1.0).sub(localV_h))).mul(w);
    const distV = min(min(localU_v, float(1.0).sub(localU_v)), min(localV_v, float(2.0).sub(localV_v))).mul(w);
    const jointDist = select(isH, distH, distV);
    const joint = float(1.0).sub(smoothstep(float(0.0), float(PAVER.joint), jointDist));
    const startX = select(isH, cx.sub(phase), cx);
    const startY = select(isH, cy, cy.sub(select(phase.lessThan(float(2.5)), float(1.0), float(0.0))));
    const brickId = vec2(startX, startY);
    const rand = fract(sin(brickId.x.mul(127.1).add(brickId.y.mul(311.7))).mul(43758.5453));
    const tone = mix(color(TONE.oneidaDark), color(TONE.oneidaLight), rand.mul(0.74).add(0.13));
    return mix(tone, color(TONE.oneidaJoint), joint.mul(fineFade).mul(0.9));
  })();
}

// The Ojibway slab colour in lane-local (s, t): the central longitudinal joint at t = 0 (the mapped lane centre line),
// transverse joints at s = k * SLAB.along. Fine detail fades with the pixel footprint.
function islandLaneColorOjibway(m) {
  const T = C.TSL;
  const { Fn, float, vec2, mix, smoothstep, fract, floor, sin, color, length, min, abs } = T;
  return Fn(() => {
    const st = laneST(m);
    const s = st.x, t = st.y;
    const pxSize = length(C.TSL.fwidth(C.TSL.positionWorld.xz));
    const fineFade = smoothstep(0.06, 0.02, pxSize);
    const central = float(1.0).sub(smoothstep(float(0.0), float(SLAB.centralJoint), abs(t)));
    const alongPhase = fract(s.div(float(SLAB.along))).mul(float(SLAB.along));
    const alongDist = min(alongPhase, float(SLAB.along).sub(alongPhase));
    const cross = float(1.0).sub(smoothstep(float(0.0), float(SLAB.joint), alongDist));
    const slabId = floor(s.div(float(SLAB.along)));
    const rand = fract(sin(slabId.mul(41.3)).mul(43758.5453));
    const tone = mix(color(TONE.ojibwayDark), color(TONE.ojibwayLight), rand.mul(0.62).add(0.18));
    const sawed = mix(tone, color(TONE.ojibwayJoint), cross.mul(fineFade).mul(0.7));
    return mix(sawed, color(TONE.ojibwayCentral), central.mul(fineFade).mul(0.85));
  })();
}

// A gentle large-scale weathering mottle shared by both, kept neutral so it never reads as decorative tiling.
function islandLaneMottle(m) {
  const T = C.TSL;
  const { Fn, float, smoothstep, length } = T;
  return Fn(() => {
    const p = C.TSL.positionWorld.xz;
    const pxSize = length(C.TSL.fwidth(p));
    const coarseFade = smoothstep(0.4, 0.1, pxSize);
    // Keep this noise local: the global material module does not export its noise2D helper.
    const q = p.mul(0.42), cell = T.floor(q), f = T.fract(q);
    const blend = f.mul(f).mul(T.vec2(3).sub(f.mul(2)));
    const hash = (v) => T.fract(T.sin(v.dot(T.vec2(127.1, 311.7))).mul(43758.5453));
    const n = T.mix(T.mix(hash(cell), hash(cell.add(T.vec2(1, 0))), blend.x),
      T.mix(hash(cell.add(T.vec2(0, 1))), hash(cell.add(T.vec2(1, 1))), blend.x), blend.y);
    return n.sub(0.5).mul(0.12).mul(coarseFade).add(1.0);
  })();
}

// The lane colour: pick the lane by the id (select, not a bool into mix), then the mottle.
function islandLaneColor(m) {
  const { Fn, mix, select, float } = C.TSL;
  const oneida = islandLaneColorOneida(m);
  const ojibway = islandLaneColorOjibway(m);
  const mottle = islandLaneMottle(m);
  return Fn(() => {
    const isOneida = laneId(m).greaterThan(floatConst(0.5)); // signed id: 1 Oneida, 0 Ojibway
    return select(isOneida, oneida, ojibway).mul(mottle);
  })();
}

// The lane roughness: concrete pavers/slabs, dry-leaning; ~0.82 Oneida, ~0.86 Ojibway.
function islandLaneRoughness(m) {
  const { mix, select, float } = C.TSL;
  return select(laneId(m).greaterThan(floatConst(0.5)), float(0.82), float(0.86));
}

// A local derivative-based bump normal. The global material module does not export its bumpNormal helper, so this module
// keeps its own (the captain's accepted fix). Shared by the lane joints and the grass shoulder.
function localBumpNormal() {
  const T = C.TSL;
  return T.Fn(([height]) => {
    const h = T.float(height).toVar();
    const dx = T.positionView.dFdx(), dy = T.positionView.dFdy();
    const r1 = dy.cross(T.normalView), r2 = T.normalView.cross(dx);
    const det = dx.dot(r1);
    const grad = det.sign().mul(h.dFdx().mul(r1).add(h.dFdy().mul(r2)));
    return det.abs().mul(T.normalView).sub(grad).normalize();
  });
}

// The lane normal: a shallow paver / slab joint relief, faded to flat with the pixel footprint so it cannot alias.
function islandLaneNormal(m) {
  const T = C.TSL;
  const { Fn, float, vec2, mix, smoothstep, fract, floor, length, min, select, mod, abs } = T;
  const bumpNormal = localBumpNormal();
  return Fn(() => {
    const st = laneST(m);
    const s = st.x, t = st.y;
    const pxSize = length(C.TSL.fwidth(C.TSL.positionWorld.xz));
    const fade = smoothstep(0.03, 0.008, pxSize);
    const w = float(PAVER.wide);
    const cx = floor(s.div(w));
    const cy = floor(t.div(w));
    const phase = mod(cx.sub(cy), float(4.0));
    const fu = fract(s.div(w));
    const fv = fract(t.div(w));
    const isH = phase.lessThan(float(2.0));
    const localU_h = fu.add(phase);
    const localV_h = fv;
    const vOffset = select(phase.lessThan(float(2.5)), float(1.0), float(0.0));
    const localU_v = fu;
    const localV_v = fv.add(vOffset);
    const distH = min(min(localU_h, float(2.0).sub(localU_h)), min(localV_h, float(1.0).sub(localV_h))).mul(w);
    const distV = min(min(localU_v, float(1.0).sub(localU_v)), min(localV_v, float(2.0).sub(localV_v))).mul(w);
    const paverDome = smoothstep(float(0.0), float(0.02), select(isH, distH, distV)).mul(0.0016);
    const central = abs(t);
    const alongPhase = fract(s.div(float(SLAB.along))).mul(float(SLAB.along));
    const alongDist = min(alongPhase, float(SLAB.along).sub(alongPhase));
    const slabDome = smoothstep(float(0.0), float(0.03), min(central, alongDist)).mul(0.0048);
    const h = select(laneId(m).greaterThan(floatConst(0.5)), paverDome, slabDome).mul(fade);
    return bumpNormal(h);
  })();
}

// The grass shoulder colour: a deliberately bounded, neutral turf green (deep -> mid -> sunny) built with the same local
// value-noise idiom as the lane mottle, so it reads as the adjacent park lawn's family without importing the plot-ground
// concrete patches. If the shared seasonal grass helper is loaded it is applied, so the shoulder follows the season too.
function islandShoulderGrassColor() {
  const T = C.TSL;
  const { Fn, vec2, mix, color, sin, fract, floor } = T;
  return Fn(() => {
    const p = C.TSL.positionWorld.xz;
    const value = (freq) => {
      const q = p.mul(freq), cell = floor(q), f = fract(q);
      const blend = f.mul(f).mul(vec2(3).sub(f.mul(2)));
      const hash = (v) => fract(sin(v.dot(vec2(127.1, 311.7))).mul(43758.5453));
      return mix(mix(hash(cell), hash(cell.add(vec2(1, 0))), blend.x),
        mix(hash(cell.add(vec2(0, 1))), hash(cell.add(vec2(1, 1))), blend.x), blend.y);
    };
    const macro = value(0.031), mid = value(0.35), micro = value(2.6);
    // MATCH the native plot lawn (js/tsl-materials.js createPlotGroundMaterial: mix(0x4f7a2c, 0x6f8a38) through
    // seasonalGrass) so the shoulder does not read as a dark ribbon against the adjacent bright yards. Subtle variation only.
    const baseLawn = mix(color(0x4f7a2c), color(0x6f8a38), macro.mul(0.6).add(mid.mul(0.4)));
    let g = mix(baseLawn, color(0x6f8a38), micro.mul(0.18));
    if (typeof C.seasonalGrass === 'function') g = C.seasonalGrass(g);
    return g;
  })();
}

// The grass shoulder normal: a gentle turf relief, faded with the pixel footprint so it cannot alias.
function islandShoulderGrassNormal() {
  const T = C.TSL;
  const { Fn, smoothstep, length, sin } = T;
  const bumpNormal = localBumpNormal();
  return Fn(() => {
    const p = C.TSL.positionWorld.xz;
    const pxSize = length(C.TSL.fwidth(p));
    const fade = smoothstep(0.5, 0.12, pxSize);
    const turf = sin(p.x.mul(7.1)).mul(sin(p.y.mul(6.3)).mul(sin(p.x.add(p.y).mul(3.7)))).mul(0.0045).mul(fade);
    return bumpNormal(turf);
  })();
}

// The exported hook: compose the lane and grass-shoulder subgraph onto the material's existing channels. The native
// surface is blended to the grass shoulder by the outer corridor cover, then to the representative paved strip by the
// analytic inner cover (inner <= outer, so the paved strip always wins where it exists). A bool is never fed to mix: the
// id choice uses select(), the coverage blends use the float covers.
//
// ALWAYS mix against the real native default of each channel: the material's own colorNode/roughnessNode/normalNode/
// metalnessNode when present, otherwise the engine's material default (materialColor / materialRoughness / materialNormal
// / materialMetalness). A material with an absent optional channel must stay untouched OFF-mask, never get the lane (or
// the grass) everywhere.
function applyIslandLaneRoadMaterial(mat, { THREE = C.THREE } = {}) {
  if (!mat) return mat;
  if (mat.userData && mat.userData.islandLaneRoadMaterial) return mat; // idempotent
  const T = C.TSL;
  if (!T || !mat.isNodeMaterial) return mat;                             // never touch a non-node material
  if (!projectionMatches() || !activeFrameCovers()) return mat;          // off-frame / mismatched projection: no-op
  const m = buildMask({ THREE });
  if (!m || !m.tex) return mat;
  try {
    const grass = islandGrassCoverage(m);  // native -> grass (strict corridor U bounded cleanup envelope)
    const pavement = islandPavementCoverage(m); // grass -> pavers/slabs (<= strict outer, never widened)
    const laneCol = islandLaneColor(m);
    const laneRough = islandLaneRoughness(m);
    const laneNormal = islandLaneNormal(m);
    const grassCol = islandShoulderGrassColor();
    const grassNormal = islandShoulderGrassNormal();
    const nativeColor = mat.colorNode || T.materialColor;
    const nativeRough = mat.roughnessNode || T.materialRoughness;
    const nativeNormal = mat.normalNode || T.materialNormal;
    const nativeMetal = mat.metalnessNode || T.materialMetalness;
    // The road material carries a canyon sky-AO node and a wet-film emissive reflection. The native plot lawn has neither,
    // so leaving them inherited darkens the shoulder (the road AO uses tall generic GEO heights) and adds a road sheen.
    // Override them LOCALLY on the grass cover only: AO -> 1, emissive -> 0. Off-mask (grass 0) the native defaults are
    // untouched. This is bounded road-lighting removal, not a fake bright grass colour correction.
    const nativeAO = mat.aoNode || T.materialAO;
    const nativeEmissive = mat.emissiveNode || T.materialEmissive;
    // native -> grass (by the grass cover), then -> pavers (by pavement). The native asphalt's wet-film metalness is
    // brought to 0 across the whole shoulder + strip (grass and concrete are dielectric); off-mask it stays the native
    // default.
    mat.colorNode = T.mix(T.mix(nativeColor, grassCol, grass), laneCol, pavement);
    mat.roughnessNode = T.mix(T.mix(nativeRough, T.float(0.95), grass), laneRough, pavement);
    mat.normalNode = T.mix(T.mix(nativeNormal, grassNormal, grass), laneNormal, pavement);
    mat.metalnessNode = T.mix(nativeMetal, T.float(0.0), grass);
    mat.aoNode = T.mix(nativeAO, T.float(1.0), grass);
    mat.emissiveNode = T.mix(nativeEmissive, T.vec3(0.0), grass);
    if (!mat.userData) mat.userData = {};
    mat.userData.islandLaneRoadMaterial = { oneida: true, ojibway: true, source: SOURCE_STATUS, pavedWidthsM: { oneida: PAVED_HALF.oneida * 2, ojibway: PAVED_HALF.ojibway * 2 } };
    mat.userData.islandLaneRoadMaterialInfo = islandRoadMaterialLayout();
  } catch (err) {
    console.warn('[waterfrontIslandRoadMaterials] material graph not applied:', err && err.message);
  }
  return mat;
}

Object.assign(C, {
  ISLAND_ROAD_MATERIALS_STATUS: SOURCE_STATUS,
  ISLAND_ROAD_MATERIALS_SOURCES: SOURCE_RUNS,
  ISLAND_ROAD_PAVER: PAVER,
  ISLAND_ROAD_SLAB: SLAB,
  ISLAND_ROAD_MASK: MASK,
  ISLAND_ROAD_PAVED_HALF: PAVED_HALF,
  islandRoadPavementCoverageAt: pavementCoverageAt,
  islandRoadOuterCoverageAt: outerCoverageAt,
  islandRoadMaterialLayout,
  islandRoadSourceBox: sourceBox,
  islandRoadLaneAt: sourceLaneAt,
  islandRoadLaneFrameAt: laneFrameAt,
  islandRoadMaskSample: sampleMask,
  islandRoadMaskBuild: buildMask,
  islandRoadHerringboneAt: herringboneAt,
  islandRoadSlabAt: slabAt,
  applyIslandLaneRoadMaterial
});
})();
