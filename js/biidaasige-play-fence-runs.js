(function () {
'use strict';
// Biidaasige Park picket fences around the two traced play islands (bead st-bmyv.4.3).
// Places the unplaced factory from js/biidaasige-play-fence.js on the two source-traced woodchip island rings and cuts
// the openings. See docs/biidaasige-play-fence.md ("Where the fences go").
//
// Openings come from the mapped OpenStreetMap footways, not from reading a photo here: wherever a mapped footway
// crosses or ends at a ring (within ENTRY_SNAP_M), the fence stops for OPENING_M. A ring no footway reaches gets one
// opening where its nearest mapped footway (within NEAREST_FOOTWAY_M) comes closest, so a player is never sealed in or
// out of an island. All widths are estimates, not survey.
const C = window.CITY;
const OPENING_M = 2.4;        // clear opening, estimate (a wide entry, not a counted gate)
const ENTRY_SNAP_M = 2.5;     // a footway end this close to the ring is an entrance
const NEAREST_FOOTWAY_M = 6;  // fallback: the nearest footway must be this close
const GROUND_LIFT_M = 0.008;  // woodchip top (.232) over the park ground (.224)

function ringLengths(ring) {
  const cum = [0];
  for (let i = 0; i < ring.length; i++) {
    const q = ring[(i + 1) % ring.length];
    cum.push(cum[i] + Math.hypot(q[0] - ring[i][0], q[1] - ring[i][1]));
  }
  return cum;
}
function segmentHit(p, p2, q, q2) {
  const d = (p2[0] - p[0]) * (q2[1] - q[1]) - (p2[1] - p[1]) * (q2[0] - q[0]);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((q[0] - p[0]) * (q2[1] - q[1]) - (q[1] - p[1]) * (q2[0] - q[0])) / d;
  const u = ((q[0] - p[0]) * (p2[1] - p[1]) - (q[1] - p[1]) * (p2[0] - p[0])) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? u : null;
}
// Nearest point on the ring to (x, z): { distM, arcM }.
function nearestOnRing(ring, cum, x, z) {
  let best = { distM: Infinity, arcM: 0 };
  for (let j = 0; j < ring.length; j++) {
    const a = ring[j], b = ring[(j + 1) % ring.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
    if (!(l2 > 0)) continue;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
    const d = Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz));
    if (d < best.distM) best = { distM: d, arcM: cum[j] + t * Math.sqrt(l2) };
  }
  return best;
}
// Openings for one ring from mapped footway polylines ([[x, z], ...] each). Returns [{ startM, endM, wayId, basis }].
function openingsForRing(ring, footways, opts = {}) {
  const width = opts.openingM ?? OPENING_M, snap = opts.snapM ?? ENTRY_SNAP_M, near = opts.nearestM ?? NEAREST_FOOTWAY_M;
  const cum = ringLengths(ring), total = cum[ring.length];
  const hits = []; // { arcM, wayId, basis }
  for (const way of footways) {
    const pl = way.line;
    if (!pl || pl.length < 2) continue;
    for (let i = 0; i < pl.length - 1; i++) {
      for (let j = 0; j < ring.length; j++) {
        const u = segmentHit(pl[i], pl[i + 1], ring[j], ring[(j + 1) % ring.length]);
        if (u == null) continue;
        const l = cum[j + 1] - cum[j];
        hits.push({ arcM: cum[j] + u * l, wayId: way.id, basis: 'footway-crosses-ring' });
      }
    }
    for (const e of [pl[0], pl[pl.length - 1]]) {
      const n = nearestOnRing(ring, cum, e[0], e[1]);
      if (n.distM <= snap) hits.push({ arcM: n.arcM, wayId: way.id, basis: 'footway-ends-at-ring' });
    }
  }
  if (!hits.length) {
    let best = null;
    for (const way of footways) for (const p of way.line || []) {
      const n = nearestOnRing(ring, cum, p[0], p[1]);
      if (n.distM <= near && (!best || n.distM < best.distM)) best = { ...n, wayId: way.id };
    }
    if (best) hits.push({ arcM: best.arcM, wayId: best.wayId, basis: 'nearest-footway' });
  }
  // Merge hits whose openings would leave less than 1.5 m of fence between them into one opening spanning them.
  hits.sort((a, b) => a.arcM - b.arcM);
  const groups = [];
  for (const h of hits) {
    const g = groups[groups.length - 1];
    if (g && h.arcM - g.hi < width + 1.5) { g.hi = h.arcM; g.ways.add(h.wayId); g.basis.add(h.basis); }
    else groups.push({ lo: h.arcM, hi: h.arcM, ways: new Set([h.wayId]), basis: new Set([h.basis]) });
  }
  return groups.map((g) => {
    const mid = (g.lo + g.hi) / 2, half = Math.max(width, g.hi - g.lo + width * 0.5) / 2;
    return { startM: ((mid - half) % total + total) % total, endM: ((mid + half) % total + total) % total,
      centreM: mid, widthM: half * 2, wayId: [...g.ways].join('+'), basis: [...g.basis].join('+') };
  });
}
function footwayLines() {
  const net = C.biidaasigePathNetworkWorld?.();
  if (!net) return [];
  return net.ways.filter((w) => w.polyline && /^(footway|path|cycleway|steps)$/.test(w.highway || ''))
    .map((w) => ({ id: w.id, line: w.polyline.map((p) => [p.x, p.z]) }));
}
function buildBiidaasigePlayFences(opts = {}) {
  if (typeof C.buildBiidaasigePlayFence !== 'function' || !C.THREE) return null;
  const islands = [['inverted-oak-woodchip-island', opts.woodchip ?? C.biidaasigeWoodchipIsland],
    ['dodem-three-animal-island', opts.threeIsland ?? C.biidaasigeDodemThreeIsland]];
  const ways = footwayLines();
  const runs = [];
  for (const [id, island] of islands) {
    const ringWorld = island?.ringWorld;
    if (!Array.isArray(ringWorld) || ringWorld.length < 3) continue;
    const ring = ringWorld.map((p) => (Array.isArray(p) ? [p[0], p[1]] : [p.x, p.z]));
    // Local ring about its centre: the factory keeps vertices small, the pose carries the world offset.
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const local = ring.map((p) => [p[0] - cx, p[1] - cz]);
    const gaps = openingsForRing(local, ways.map((w) => ({ id: w.id, line: w.line.map((p) => [p[0] - cx, p[1] - cz]) })));
    const fence = C.buildBiidaasigePlayFence(local, { closed: true, groundY: GROUND_LIFT_M, gaps });
    fence.group.name = 'play-fence-' + id;
    runs.push({ id, pose: { x: cx, z: cz, yaw: 0 }, fence, gaps, group: fence.group, colliders: fence.colliders });
  }
  const out = { runs, openings: runs.reduce((n, r) => n + r.gaps.length, 0),
    triangles: runs.reduce((n, r) => n + (r.fence.stats?.triangles || 0), 0) };
  C.biidaasigePlayFenceRuns = out;
  return out;
}
C.biidaasigePlayFenceOpenings = openingsForRing;
C.buildBiidaasigePlayFences = buildBiidaasigePlayFences;
})();
