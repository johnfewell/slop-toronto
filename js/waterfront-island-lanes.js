(function () {
// js/waterfront-island-lanes.js
// A PURE source gate for the Toronto Islands' interior lanes (bead st-sb3r.23), loaded before js/road-paint.js.
//
// The problem the gate fixes: the committed geodata turns every island service/living street into a two-way motor-road
// edge, and js/road-paint.js paints its standard centre line (a broken yellow on the one-lane edges, a double solid
// yellow on the wider ones). The islands are a car-free community (private cars prohibited; service/emergency vehicles
// authorised), and the primary photographs listed in the generated data show the interior rows as unmarked lanes. This
// module does not paint, cover or move anything: it answers "is this point on a photo-evidenced unmarked island lane?".
// js/road-paint.js calls it and simply omits the yellow centre-line geometry there. Nothing else about the road changes.
//
// What this module will NOT do (the previous overlay approach was rejected):
//   - no cover quads under/over the paint, no dark strips, no fake asphalt patch;
//   - no wood/bridge overlay at y=0 (Algonquin Bridge Road keeps its recorded wood+bridge flags unresolved: its deck
//     height is a separate layer this module does not claim, so the flat patch is not drawn);
//   - no routing, carriageway width, kerb/curb, surface material or junction-geometry change;
//   - no mainland or Billy Bishop airport treatment (the build tool hard-excludes both; the gate also refuses points
//     outside the active frame);
//   - no assumption that OSM motor_vehicle=private proves an unmarked lane. The data marks `unmarked: 1` only for rows
//     carrying primary-photo evidence in `summary.sourceProfile` (currently the photographed living-street family and
//     the photographed Cibola Avenue service row). Every other lane keeps the native paint.
//
// Purity: islandLanesLayout(), islandLaneAt() and islandLaneCentreLineSuppressed() never mutate CITY.GEO. Callers may
// pass a non-mutating bounds box ({ x0, x1, z0, z1 }); otherwise the active detail/Eglinton frame is read.
//
// Load order (captain wires explore.html, this file does not edit it): this data + module must load before
// js/road-paint.js, e.g. after js/waterfront-island-buildings.js and before js/road-network.js / js/road-paint.js.

const C = window.CITY || (window.CITY = {});
const PHOTO_STATUS = 'captain-photo-reviewed-2026-11-10';

function data() {
  return C.ISLAND_LANES_DATA || null;
}

function activeFrame() {
  return (C.GEO && C.GEO.frame && (C.GEO.frame.detail || C.GEO.frame)) || null;
}

function normalizeBounds(bounds) {
  if (!bounds) return null;
  if (bounds.frame) return normalizeBounds(bounds.frame);
  if (bounds.detail) return normalizeBounds(bounds.detail);
  const { x0, x1, z0, z1 } = bounds;
  if (![x0, x1, z0, z1].every(Number.isFinite) || x1 <= x0 || z1 <= z0) return null;
  return { x0, x1, z0, z1 };
}

// The data was built in one exact projection. Comparing bounds is not enough: a different frame could reuse the same
// numeric centres, so every projection parameter must match the recorded one.
function projectionMatches() {
  const D = data();
  const expected = D && D.projection;
  const actual = C.GEO && C.GEO.frame && C.GEO.frame.projection;
  if (!expected || !actual) return false;
  for (const k of ['lat0', 'lon0', 'kx', 'ky', 'theta', 'ox', 'oz']) {
    const a = actual[k], e = expected[k];
    if (!Number.isFinite(a) || !Number.isFinite(e)) return false;
    if (Math.abs(a - e) > 1e-9 * Math.max(1, Math.abs(e))) return false;
  }
  return true;
}

function runInside(run, frame) {
  if (!frame) return false;
  let any = false;
  for (const p of run.points) {
    const inside = p[0] >= frame.x0 && p[0] <= frame.x1 && p[1] >= frame.z0 && p[1] <= frame.z1;
    if (inside) any = true;
    else return false; // a run straddling the frame edge is not claimed by this frame
  }
  return any;
}

// The photo-evidenced unmarked runs inside a frame. Pure: `bounds` (optional) is read, never written.
function lanesInFrame(bounds = null) {
  const D = data();
  const frame = normalizeBounds(bounds) || normalizeBounds(activeFrame());
  if (!D || !Array.isArray(D.runs) || !frame || !projectionMatches()) return null;
  const runs = D.runs.filter((r) => r && r.unmarked === 1 && Array.isArray(r.points) && r.points.length >= 2 && runInside(r, frame));
  return runs.length ? runs : null;
}

// The nearest photo-evidenced unmarked lane to (x, z). The lateral tolerance is the mapped lane's own half-width plus
// a small geodata-to-OSM slop (the paint edge centre and the OSM way centre are allowed to differ slightly). Pass
// `tol` to override, or `bounds` to test a non-active frame without touching CITY.GEO.
// The runs in frame are indexed once per (data, runs, frame box, projection): lanesInFrame filters every run and checks
// the projection, which road-paint.js used to repeat for every painted sample in the city. Each run gets its points' box
// and its default tolerance, and the index the union box at the widest default tolerance, so a point away from every
// photo-evidenced lane returns at a box test (st-s1y8).
let laneIndex = null;
function indexedLanes(bounds) {
  const D = data();
  const frame = normalizeBounds(bounds) || normalizeBounds(activeFrame());
  const proj = C.GEO && C.GEO.frame && C.GEO.frame.projection;
  const k = laneIndex;
  if (k && k.D === D && k.runsRef === (D && D.runs) && k.n === (D && D.runs ? D.runs.length : -1) && k.proj === proj
      && (frame ? k.x0 === frame.x0 && k.x1 === frame.x1 && k.z0 === frame.z0 && k.z1 === frame.z1 : k.x0 === null)) return k.value;
  const runs = lanesInFrame(bounds);
  let value = null;
  if (runs) {
    const all = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    let widest = 0;
    const entries = runs.map((r) => {
      const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
      for (const [px, pz] of r.points) {
        if (px < b.minX) b.minX = px; if (px > b.maxX) b.maxX = px; if (pz < b.minZ) b.minZ = pz; if (pz > b.maxZ) b.maxZ = pz;
      }
      const limit = Math.max(1.5, (Number.isFinite(r.w) ? r.w : 5.6) / 2 + 0.9);
      if (limit > widest) widest = limit;
      all.minX = Math.min(all.minX, b.minX); all.maxX = Math.max(all.maxX, b.maxX);
      all.minZ = Math.min(all.minZ, b.minZ); all.maxZ = Math.max(all.maxZ, b.maxZ);
      return { r, b, limit };
    });
    value = { runs, entries, all, widest };
  }
  laneIndex = { D, runsRef: D && D.runs, n: D && D.runs ? D.runs.length : -1, proj, value,
    x0: frame ? frame.x0 : null, x1: frame ? frame.x1 : null, z0: frame ? frame.z0 : null, z1: frame ? frame.z1 : null };
  return value;
}

function islandLaneAt(x, z, { tol = null, bounds = null } = {}) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const index = indexedLanes(bounds);
  if (!index) return null;
  const reach = Number.isFinite(tol) ? tol : index.widest, all = index.all;
  if (x < all.minX - reach || x > all.maxX + reach || z < all.minZ - reach || z > all.maxZ + reach) return null;
  let best = null, bestD = Infinity;
  for (const { r, b, limit: defaultLimit } of index.entries) {
    const limit = Number.isFinite(tol) ? tol : defaultLimit;
    if (!(limit > 0)) continue;
    if (x < b.minX - limit || x > b.maxX + limit || z < b.minZ - limit || z > b.maxZ + limit) continue;
    for (let i = 0; i + 1 < r.points.length; i++) {
      const [ax, az] = r.points[i], [bx, bz] = r.points[i + 1];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      if (!(l2 > 1e-12)) continue;
      let t = ((x - ax) * dx + (z - az) * dz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t, pz = az + dz * t;
      const d = Math.hypot(px - x, pz - z);
      if (d <= limit && d < bestD) {
        bestD = d;
        best = {
          run: r, t, x: px, z: pz, d,
          id: r.id, names: r.names || [], cls: r.cls, surface: r.surface,
          halfWidth: (Number.isFinite(r.w) ? r.w : 5.6) / 2,
          reason: r.unmarkedReason, photoIds: r.unmarkedPhotos || []
        };
      }
    }
  }
  return best;
}

// The one question js/road-paint.js asks: may a yellow centre line be drawn at this road-network point? False where the
// point is on a photo-evidenced unmarked island lane in the active (or supplied) frame.
function islandLaneCentreLineSuppressed(x, z, opts = {}) {
  return !!islandLaneAt(x, z, opts);
}

// A pure layout/audit summary. No THREE objects, no scene, no mutation. `runs` are the photo-evidenced runs in frame;
// `kept` are all the other island lanes in frame (which keep the native paint) for tests/docs only.
function islandLanesLayout({ bounds = null } = {}) {
  const D = data();
  const frame = normalizeBounds(bounds) || normalizeBounds(activeFrame());
  if (!D) return null;
  if (!frame) return { runs: [], kept: [], stats: { runs: 0, kept: 0, suppressedM: 0, unmarked: 0 }, skipped: 'no active frame' };
  if (!projectionMatches()) return { runs: [], kept: [], stats: { runs: 0, kept: 0, suppressedM: 0, unmarked: 0 }, skipped: 'projection does not match the data' };
  const all = (D.runs || []).filter((r) => r && Array.isArray(r.points) && r.points.length >= 2 && runInside(r, frame));
  const runs = all.filter((r) => r.unmarked === 1);
  const kept = all.filter((r) => r.unmarked !== 1);
  const unmarkedM = runs.reduce((s, r) => s + (Number.isFinite(r.lengthM) ? r.lengthM : 0), 0);
  return {
    runs, kept,
    stats: {
      runs: runs.length, kept: kept.length, unmarked: runs.length,
      unmarkedM: Math.round(unmarkedM),
      serviceUnmarked: runs.filter((r) => r.cls === 'service').length,
      livingStreetUnmarked: runs.filter((r) => r.cls === 'living_street').length,
      photographedRows: [...new Set(runs.flatMap((r) => r.names || []))].sort(),
      woodKeptUnresolved: kept.concat(runs).filter((r) => r.wood).map((r) => ({ names: r.names, bridge: r.bridge, wood: r.wood }))
    },
    sourceProfile: (D.summary && D.summary.sourceProfile) || null,
    skipped: null
  };
}

function photoEvidence() {
  const D = data();
  return (D && D.summary && D.summary.sourceProfile) || null;
}

// --------------------------------------------------------------------------------------------------------------------
// Verge / footway edge fidelity (bead st-sb3r.23 follow-up). The interior lanes are photographed with FLUSH GREEN
// VERGES and NO raised kerb (Oneida herringbone pavers + garden verge; Ojibway concrete slabs + green verge; Cibola
// asphalt, no raised curb). city-grid.js otherwise gives every curb island one 4.6 m concrete walk band and a raised
// stone kerb. The pure gates below let the producer replace that band with a flush grass ramp on the source-confirmed
// edges ONLY, leaving every other edge exactly as built. A gate changes no geometry, width, height or routing by itself.
//
// The exact ramp surface is NOT computed here: the producer (js/city-grid.js) stores the actual rendered ramp triangles
// and exposes `CITY.islandVergeSurfaceAt(x, z)`, which barycentric-samples those same triangles. That is the contract
// for the walker's ground hook (controllers.js getGroundHeight, after sportsGround and before the deck query). This
// module only answers which edges are source-confirmed; it never claims a surface height.
// --------------------------------------------------------------------------------------------------------------------
const VERGE = { offset: 2.5, fractions: [0.25, 0.5, 0.75] };

// The nearest source-confirmed unmarked island lane whose verge edge is at (x, z), or null. Same pure point gate as the
// centre-line filter, so the two cannot disagree about which rows are photo-evidenced.
function islandVergeEdgeAt(x, z, opts = {}) {
  return islandLaneAt(x, z, opts);
}

// The verge material of one straight edge a -> b with outward unit normal (nx, nz): 'grass' only when every sample
// along the edge (offset outward towards the lane) sits on a source-confirmed unmarked island lane, else null (the
// native concrete band is kept). Pure: `opts` may carry `tol`/`bounds` for a non-active frame.
function islandVergeEdgeMaterial(ax, az, bx, bz, nx, nz, opts = {}) {
  if (![ax, az, bx, bz, nx, nz].every(Number.isFinite)) return null;
  const nl = Math.hypot(nx, nz);
  if (!(nl > 0)) return null;
  const ux = nx / nl, uz = nz / nl;
  const offset = Number.isFinite(opts.offset) ? opts.offset : VERGE.offset;
  const fractions = Array.isArray(opts.fractions) ? opts.fractions : VERGE.fractions;
  const point = { tol: opts.tol, bounds: opts.bounds };
  for (const t of fractions) {
    const x = ax + (bx - ax) * t + ux * offset;
    const z = az + (bz - az) * t + uz * offset;
    if (!islandLaneAt(x, z, point)) return null;
  }
  return 'grass';
}

// The straight ramp profile a flush edge draws: road at roadY, a linear ramp across the full former band width, the
// yard at walkY. Pure numbers for docs/tests; the exact surface is the producer's stored triangles.
function islandVergeRampProfile({ roadY = 0, walkY = 0.22, width = 4.6 } = {}) {
  if (![roadY, walkY, width].every(Number.isFinite) || width <= 0) return null;
  return { outerY: roadY, innerY: walkY, width, slope: (walkY - roadY) / width };
}

// A pure audit of the verge gates in frame: how many of the photo-evidenced runs would lay a grass verge, and the
// native kerb width/height the ramp would use. No geometry, no mutation.
function islandVergeLayout({ bounds = null } = {}) {
  const layout = islandLanesLayout({ bounds });
  if (!layout || layout.skipped) return { runs: [], stats: { vergeRuns: 0, vergeM: 0, kerbWidth: VERGE.kerbWidth, offset: VERGE.offset }, skipped: layout ? layout.skipped : 'no data' };
  const runs = (layout.runs || []).filter((r) => Array.isArray(r.points) && r.points.length >= 2);
  const vergeM = runs.reduce((s, r) => s + (Number.isFinite(r.lengthM) ? r.lengthM : 0), 0);
  return {
    runs: runs.map((r) => ({ id: r.id, names: r.names || [], cls: r.cls, surface: r.surface, lengthM: r.lengthM, w: r.w })),
    stats: { vergeRuns: runs.length, vergeM: Math.round(vergeM), kerbWidth: VERGE.kerbWidth, offset: VERGE.offset, livingStreet: runs.filter((r) => r.cls === 'living_street').length, service: runs.filter((r) => r.cls === 'service').length },
    skipped: null
  };
}

Object.assign(C, {
  ISLAND_LANES_DATA: C.ISLAND_LANES_DATA,
  ISLAND_LANES_PHOTO_STATUS: PHOTO_STATUS,
  ISLAND_LANES_VERGE: VERGE,
  islandLanesLayout,
  islandLaneAt,
  islandLaneNearest: islandLaneAt,
  islandLaneProfileAt: islandLaneAt,
  islandLaneCentreLineSuppressed,
  isUnmarkedIslandLane: islandLaneCentreLineSuppressed,
  islandLanePhotoEvidence: photoEvidence,
  islandVergeEdgeAt,
  islandVergeEdgeMaterial,
  islandVergeRampProfile,
  islandVergeLayout
});
})();
