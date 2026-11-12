(function () {
// js/waterfront-island-residential-canopy.js
// A PURE site source for the Toronto Islands' residential-lot canopy (bead st-sb3r.28), loaded before js/ez-trees.js.
//
// The problem this source fixes: js/toronto-island-woods-data.js (tools/build-park-woods.mjs --park toronto-island) keeps
// only the Ontario GTA 2023 lidar crowns on blocks named "Toronto Island Park", so the private residential lots along
// ONEIDA and OJIBWAY avenues on Algonquin Island get no mapped crowns. street-details.js then scatters a few generic yard
// trees, and the captain's photos show dense mature canopy and enclosed gardens. This module supplies the City of
// Toronto's OWN mapped tree points for exactly those two photographed corridors: exact position and DERIVED_HEIGHT, a
// generic mature deciduous, deduplicated against the City street inventory and rejected from water, buildings and pavement.
//
// What this module WILL NOT do (the same discipline as js/waterfront-island-lanes.js / road-materials.js):
//   - no invented species (the City layer carries none), no flowerbeds, fences or porches;
//   - no random blanket density: every site is a real mapped point, or there is no site;
//   - no relocation: a rejected point is dropped, never nudged to the nearest yard;
//   - no rendering of its own: it returns plain site objects for the existing EZ-Tree field (js/ez-trees.js calls
//     islandResidentialCanopySites(runtimeSites) while it assembles its sites), so instancing and LOD are unchanged;
//   - no edit to CITY.GEO, no fetch, no Date/random: a pure function of the loaded data and the committed frame.
//
// Load order (captain wires explore.html, this file does not edit it): the data module (js/waterfront-island-residential-
// canopy-data.js) then this module, before js/ez-trees.js. Absent the data or on a mismatched frame, every call is a
// no-op (null / empty), so the runtime is exactly as before.

const C = window.CITY || (window.CITY = {});

// The data was built in one exact detail projection. Bounds alone would let another frame reuse the same numbers, so
// every projection parameter must match (as js/waterfront-island-lanes.js).
function projectionMatches(D) {
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

// Is (x, z) within the built detail frame? A candidate is only claimed by the frame that built it.
function inFrame(D, x, z) {
  const f = D && D.frame;
  const active = C.GEO?.frame?.detail;
  return !!f && !!active && x > f.x0 && x < f.x1 && z > f.z0 && z < f.z1
    && x > active.x0 && x < active.x1 && z > active.z0 && z < active.z1;
}

function data() {
  return C.ISLAND_RESIDENTIAL_CANOPY_DATA || null;
}

// A source point and an existing named/lidar site this close are the same tree: the source candidate is dropped so the
// tree is not drawn twice. (The build already dedupes against the City street inventory; this is the runtime dedupe
// against the lidar park crowns and any other named site the captain passes in.)
const DEDUPE_M = 3.0;

// A site that names its own model/height/width (a lidar park crown, a City inventory row placed by a source row) or is
// itself a mapped residential-canopy point. Only these are "preserved": the coarse generated parkland/yard scatter names
// none of them, so it is the only thing dedupe may remove.
function isPreservedSite(t) {
  return !!(t && (t.model || t.residentialCanopy
    || (Number.isFinite(t.height) && t.height > 0 && Number.isFinite(t.width) && t.width > 0)));
}

/** The data, decoded to full sites, or null on a mismatched frame / absent data. Pure: never mutates the data. */
function decode() {
  const D = data();
  if (!D || !Array.isArray(D.rows) || !Array.isArray(D.corridor?.lanes)) return null;
  if (!projectionMatches(D)) return null;
  const lanes = D.corridor.lanes.map((l) => l.name);
  // rows: [OBJECTID, x(dm), z(dm), h(cm), elev(cm or -1), laneIndex, streetM(dm)]
  const sites = D.rows.map((r) => ({
    oid: r[0],
    x: r[1] / 10,
    z: r[2] / 10,
    height: r[3] / 100,
    elev: r[4] >= 0 ? r[4] / 100 : null,
    lane: lanes[r[5]] || null,
    streetM: r[6] / 10
  }));
  // Marina scope (st-sb3r.36): rows: [OBJECTID, x(dm), z(dm), h(cm), elev(cm or -1), streetM(dm)], inside the OSM QCYC
  // marina polygon. Kept a distinct array so the residential `sites` and their counts are unchanged.
  const marinaSites = Array.isArray(D.marina?.rows)
    ? D.marina.rows.map((r) => ({ oid: r[0], x: r[1] / 10, z: r[2] / 10, height: r[3] / 100, elev: r[4] >= 0 ? r[4] / 100 : null, lane: null, streetM: r[5] / 10, marina: true }))
    : [];
  return { D, sites, marinaSites };
}

// A generic mature deciduous crown radius (m) by height: not a source value. The City layer carries no crown width, so
// the runtime estimates it from the height with a broad, tidy dome (r ~ 0.22 h, clamped) and says so in the provenance.
// This only widens the EZ-Tree's own crown toward a mature tree; it never invents a species or a second tree.
function genericCrownRadius(height) {
  return Math.max(1.8, Math.min(6, 0.22 * height));
}

// The mapped EZ-Tree model family: a generic deciduous is the ash, at its trunk size by height (the same thresholds
// ez-trees.js genModel uses for its own trees, so a candidate sits in the same model set as the City's other broadleaves).
function ashModel(height) {
  return height > 15 ? 'ez-ash-large' : height > 9 ? 'ez-ash-medium' : 'ez-ash-small';
}

// The site the EZ-Tree field expects (see js/ez-trees.js / js/park-woods.js trees()): x, y, z, height, width (crown
// radius), model (an ez-trees id), species (mrdoob fallback), tier, woods. `y` is the island level: 0 with the ground
// corrected by ez-trees.js (cutDown), as the park-woods sites use. `woods: false` keeps the class below IMP_CLASS, so the
// crowns hand over at the open-canopy distances, not the closed-woods ones (a residential lot fronts a lawn and a lane).
function toEzSite(s) {
  return {
    x: s.x, y: 0, z: s.z,
    height: s.height,
    width: genericCrownRadius(s.height),
    model: ashModel(s.height),
    species: 1, // mrdoob's honey-locust far card family: a broadleaf stand-in, only if the EZ models don't load
    tier: 0, // parkland/yard class, not the street inventory's tier 1
    woods: false,
    residentialCanopy: true,
    oid: s.oid,
    lane: s.lane
  };
}

/**
 * The residential canopy sites inside the active frame, as EZ-Tree sites. Pure.
 * `existingSites` (optional) is the runtime's raw generated list (before conversion) plus any named/lidar sites: a source
 * candidate within DEDUPE_M of a preserved named/lidar site is dropped, so the same tree is not drawn twice. Generic
 * generated scatter does not suppress a source candidate (it is the scatter the source replaces).
 * Returns null when the data is absent or the frame's projection does not match the build.
 */
function dedupeSites(sourceSites, preserved, already = []) {
  const out = [];
  const tooClose = (x, z, list) => list.some((t) => { const dx = x - t.x, dz = z - t.z; return dx * dx + dz * dz <= DEDUPE_M * DEDUPE_M; });
  for (const s of sourceSites) {
    if (tooClose(s.x, s.z, preserved) || tooClose(s.x, s.z, already)) continue;
    already = already.concat([s]);
    out.push(s);
  }
  return { sites: out, accepted: already };
}

// The residential (Oneida/Ojibway) scope: exactly the accepted 33 sites, unchanged. Dedupes against preserved mapped
// trees and, when provided, against the marina source sites (`marinaSites`) so a tree in both scopes is drawn once.
function islandResidentialCanopySites(existingSites = [], marinaSites = []) {
  const dec = decode();
  if (!dec) return null;
  const { D, sites } = dec;
  const preserved = (Array.isArray(existingSites) ? existingSites : []).filter(isPreservedSite);
  const placed = sites.filter((s) => inFrame(D, s.x, s.z));
  const marina = (Array.isArray(marinaSites) ? marinaSites : []).filter((s) => inFrame(D, s.x, s.z));
  const { sites: kept } = dedupeSites(placed, preserved, marina);
  return kept.map(toEzSite);
}

// The marina scope (st-sb3r.36): the accepted City Tree Points inside the OSM QCYC marina polygon. Dedupes against the
// same preserved mapped trees and, when provided, against the residential source sites (`residentialSites`). Returns null
// when the data is absent or the frame's projection does not match the build. Distinct from the residential API so the
// residential counts, tests and docs stay exactly as accepted.
function islandMarinaCanopySites(existingSites = [], residentialSites = []) {
  const dec = decode();
  if (!dec) return null;
  const { D, marinaSites } = dec;
  const preserved = (Array.isArray(existingSites) ? existingSites : []).filter(isPreservedSite);
  const placed = marinaSites.filter((s) => inFrame(D, s.x, s.z));
  const res = (Array.isArray(residentialSites) ? residentialSites : []).filter((s) => inFrame(D, s.x, s.z));
  const { sites: kept } = dedupeSites(placed, preserved, res);
  return kept.map(toEzSite);
}

/** The layout (data-derived counts, gates and height spread) the runtime audit and the tests read. Pure. */
function islandResidentialCanopyLayout() {
  const D = data();
  if (!D) return { loaded: false, supported: false };
  const supported = projectionMatches(D) && Array.isArray(D.rows);
  return {
    loaded: true,
    supported,
    kind: D.kind,
    source: D.source?.name || null,
    licence: D.source?.licence || null,
    corridorRadiusM: D.corridor?.radiusM ?? null,
    lanes: (D.corridor?.lanes || []).map((l) => l.name),
    gates: D.gates || null,
    counts: D.counts || null,
    heightStats: D.heightStats || null,
    crown: D.crown || null,
    dedupeM: DEDUPE_M,
    inFrame: supported ? decode().sites.filter((s) => inFrame(D, s.x, s.z)).length : 0,
    marina: D.marina ? {
      osmWay: D.marina.osmWay,
      gates: D.marina.gates || null,
      counts: D.marina.counts || null,
      heightStats: D.marina.heightStats || null,
      clearance: D.marina.clearance || null,
      rows: Array.isArray(D.marina.rows) ? D.marina.rows.length : 0,
      inFrame: supported ? decode().marinaSites.filter((s) => inFrame(D, s.x, s.z)).length : 0
    } : null
  };
}

/**
 * Remove the runtime's *generated* generic yard/parkland scatter that a mapped residential-canopy point already stands
 * for, so the same tree is not drawn twice. This mirrors js/ez-trees.js's HTO reconcile and is meant to run on the RAW
 * generated list, before ez-trees.js converts it (after conversion every site has a model, so nothing would be removable).
 * Only a site that names no model/height/width (the coarse scatter) can be removed; a City inventory row, a lidar crown,
 * or any other named site is preserved. Returns { kept, removedCount } and does not mutate its inputs.
 */
function reconcileResidentialCanopy(mapped, generated, radius = DEDUPE_M) {
  if (!Array.isArray(mapped) || !Array.isArray(generated) || !mapped.length) return { kept: generated, removedCount: 0 };
  const kept = [];
  let removedCount = 0;
  for (const t of generated) {
    if (isPreservedSite(t)) { kept.push(t); continue; }
    let near = false;
    for (const m of mapped) {
      const dx = t.x - m.x, dz = t.z - m.z;
      if (dx * dx + dz * dz <= radius * radius) { near = true; break; }
    }
    if (near) removedCount++;
    else kept.push(t);
  }
  return { kept, removedCount };
}

Object.assign(C, {
  islandResidentialCanopySites,
  islandMarinaCanopySites,
  islandResidentialCanopyLayout,
  islandResidentialCanopyReconcile: reconcileResidentialCanopy
});
})();
