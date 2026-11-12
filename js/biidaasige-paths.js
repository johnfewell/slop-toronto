(function () {
// js/biidaasige-paths.js
// Biidaasige Park's WALKING AND CYCLING SURFACES (bead st-bmyv.7; parent st-bmyv). See docs/biidaasige-paths.md.
//
// WHAT THE RUNTIME ADAPTER BUILDS — exactly three NAMED paths, each from the current OpenStreetMap geometry the parent
// inventory worker (st-bmyv.1) verified, projected through the city's own C.worldFromLatLon:
//
//   1. Biidaasige Park Main Path   OSM way/1352429162, highway=cycleway, surface=asphalt, foot=bicycle=designated
//   2. Don Greenway Trail Loop     OSM way/1414354033, highway=cycleway, surface=asphalt, foot=bicycle=designated
//   3. Water's Edge Promenade      OSM way/1013210805, highway=footway (the 2026 western section, >250 m)
//
// That is all. These three are the paths current OpenStreetMap maps with a name INSIDE the parked OSM extract the
// inventory worker clipped for this bead — an INVENTORY SUBSET, not a claim that OpenStreetMap has no other trails in
// the park. The broad Overpass extract carries River Trail North/South, Wetland Trail Loop, Lower East Don Trail and the
// Martin Goodman Trail, but their geometry is not clipped to the park here; clipping them is the next (map-registration)
// worker's job, not this one's. Nothing is placed from them.
//
// WHAT IS DELIBERATELY NOT BUILT (captain's paths review, 2026-11-10 — authoritative):
//
//   - NO LANDINGS OF ANY KIND. A path coming near water is NOT evidence that a 3.2 x 2.4 m pebble apron, a fishing
//     platform or a kayak launch exists there. River Bend / East / West Landing and the Canoe Cove pebble landing are
//     named by official City sources but have no registered current-map position; they stay UNPLACED until the next
//     map-registration worker supplies a current official-map anchor (with its stated error). The pure factories
//     (boardwalk / terrazzoSteps / riverLanding / fishingEdge / kayakLaunch) remain, unplaced, for that worker.
//   - NO CANOE COVE MARKER. OSM node/10893913022 is a `natural=bay` CENTRE point, which lies IN the water; a sign post
//     cannot stand there. No marker is built by default.
//   - NO BRIDGE. OSM way/1211500112 is the WHOLE arch ROAD bridge (Commissioners Street Bridge, 2024, Cherubiní,
//     man_made=bridge, layer=1). It is not a footpath deck and is not drawn here: the committed city already carries a
//     level-correct road bridge; a flat ribbon at park ground level would be wrong. This module does not touch it.
//   - NO STEPS PLACED. The source map's Steps symbol is representative and unlocated. On the flat native datum (street
//     y = 0, park lawn at CITY_BOUNDS.sidewalkHeight ≈ 0.22 m) there is no measured rise on these paths, so no stair is
//     placed. A terrain-aware caller can place the `terrazzoSteps` factory where a real, measured rise exists.
//
// RELIEF / HEIGHT: the native park ground is flat (docs/biidaasige-terrain.md §5). This module does NOT invent a
// promontory or badland heightfield (the MVVA ~9 m promontory has no published extent). C.biidaasigePathsSurfaceAt(x, z)
// is the exact-triangle query over THIS module's own published path triangles: it returns the triangle's own vertex
// height (never a caller's baseY, never a clamped world height) and null off the built paths. Another module that adds
// relief must own its own height query over its own triangles; this module never adds a base and never clamps.
//
// INTERACTION WITH THE CITY'S OWN PATHS: the committed geodata draws 3 generic `GEO.parkPaths` runs through the park box
// (docs/biidaasige-terrain.md §6). They are a different, unnamed source and they STAY. This module draws the 3 named
// paths at a small lift above the lawn and never masks or deletes the generic runs. Where a named path runs within
// DUPLICATE_OVERLAP_M of a generic run, the overlap is reported in `duplicates` (an integration contract), not hidden.
//
// Contract:
//   - C.buildBiidaasigePaths(scene, allColliders) -> { group, colliders, surfaces, unplaced, duplicates, stats } | null.
//     Adds the group to `scene` only when a scene is passed; appends flat, walkable `surface` colliders to
//     `allColliders`.
//   - C.biidaasigePathsFactories.{boardwalk, terrazzoSteps, riverLanding, fishingEdge, kayakLaunch, ribbonGeometry} are
//     PURE: 1 unit = 1 m, Y-up, local origin, footprint centred. They build pieces for a later anchor-aware worker.
//   - C.biidaasigePathsSurfaceAt(x, z) -> { onPath, surfaceY, pathId } | null (exact-triangle height on this module's
//     paths; null elsewhere). C.biidaasigePathsTriangles() -> [{ x0,y0,z0, x1,y1,z1, x2,y2,z2, pathId }] (the published
//     triangles, for another system's collision/ground).
//   - Geometry projects WGS84 -> world ONLY through window.CITY.worldFromLatLon. Missing projection or data -> build
//     nothing and report why (never a fabricated path).
//
// Attribution: current OpenStreetMap contributors (ODbL), 2026-11-10. Documentation-only: docs/biidaasige-paths.md.
const C = (typeof window !== 'undefined' && window.CITY) ? window.CITY : null;

// ---------------------------------------------------------------------------------------------------------------
// Recorded sizes and estimates (1 unit = 1 m). Each is marked in docs/biidaasige-paths.md.
const SIZE = {
  // Surfacing lift above the park lawn, so the drawn ribbon reads above the generic parkPaths' own lift (+0.008 m in
  // js/city-grid.js) and above the waterfront sand (+0.004 m) and never z-fights. Not a walkable height: the walkable
  // query reads the triangle's own vertex y, which already includes this lift.
  surfaceLift: 0.030,
  // Half widths by OSM highway tag: a designated multi-use cycleway ~3.0 m; a promenade footway ~2.2 m. ESTIMATES
  // (OSM does not publish widths here); documented as such.
  width: { cycleway: 3.0, footway: 2.2, path: 2.0 },
  // A ribbon is sampled every ~2 m from the source polyline so its bends follow the mapped centreline (no chord-cut).
  sampleStepM: 2.0,
  // Terrazzo stair block dimensions (a City "Steps" symbol is representative, not surveyed): tread 0.30 m, riser 0.15 m
  // (standard exterior stair), depth per flight 2.4 m. Only ever placed at a real, measured rise by a terrain build.
  terrazzo: { depth: 2.4, tread: 0.30, riser: 0.15, nosing: 0.03 },
  // Boardwalk/timber landing deck (a paddle-craft landing apron): 4.0 x 3.0 m, 0.25 m above its ground contact.
  boardwalk: { w: 4.0, d: 3.0, deckY: 0.25, rail: 1.0, post: 2.0 },
  // River landing: a small pebble/cobblestone apron. Extent ESTIMATE; a factory only (no auto-placement).
  riverLanding: { w: 3.2, d: 2.4, pebble: 0.18 },
  // Fishing edge: a low timber fishing platform with a rail gap. Extent ESTIMATE; a factory only.
  fishingEdge: { w: 3.0, d: 1.8, deckY: 0.20, rail: 0.95 },
  // Kayak / paddlecraft launch: a sloped lightweight launch apron, 1.4 m wide x 3.2 m down-slope, 22 degrees. ESTIMATE;
  // a factory only.
  kayakLaunch: { w: 1.4, length: 3.2, angleDeg: 22, rail: 0.10 }
};

// The three named paths, with their current-OSM provenance explicit.
const SOURCE = Object.freeze({
  mainPath: { osm: 'way/1352429162', name: 'Biidaasige Park Main Path', highway: 'cycleway', surface: 'asphalt' },
  donLoop: { osm: 'way/1414354033', name: 'Don Greenway Trail Loop', highway: 'cycleway', surface: 'asphalt' },
  promenade: { osm: 'way/1013210805', name: "Water's Edge Promenade", highway: 'footway', surface: 'promenade' }
});

// Duplicate contract: how close (m) a named path's sample must run to a generic GEO.parkPath line segment before it is
// reported as an overlap. 3 m catches a shared corridor without flagging a merely parallel path across a lawn.
const DUPLICATE_OVERLAP_M = 3.0;

const LAWN_Y = (() => {
  const b = C && C.CITY_BOUNDS;
  return b && typeof b.sidewalkHeight === 'number' ? b.sidewalkHeight : 0.22;
})();

const TAU = Math.PI * 2;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---------------------------------------------------------------------------------------------------------------
// Materials (WebGPU NodeMaterial with a classic fallback, the repo convention)
function material(THREE, color, roughness = 0.85, metalness = 0.0) {
  const Mat = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
  return new Mat({ color, roughness, metalness });
}
function pathMaterial(THREE, surface) {
  const s = String(surface || '').toLowerCase();
  if (/asphalt|paved/.test(s)) return material(THREE, 0x6d6f72, 0.95, 0.0);
  if (/boardwalk|wood/.test(s)) return material(THREE, 0x8a6a44, 0.9, 0.0);
  if (/pebble|cobble|gravel/.test(s)) return material(THREE, 0xa79c8e, 1.0, 0.0);
  if (/terrazzo|concrete|stone|promenade/.test(s)) return material(THREE, 0xb9b3a8, 0.9, 0.0);
  return material(THREE, 0x8f8a7f, 0.95, 0.0);
}

// ---------------------------------------------------------------------------------------------------------------
// Small geometry helpers (pure; no scene, no data).
function box(THREE, w, h, d, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return g;
}
function cyl(THREE, rTop, rBottom, h, seg, x = 0, y = 0, z = 0) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg);
  g.translate(x, y + h / 2, z);
  return g;
}
function extentOf(THREE, group) {
  const b = new THREE.Box3();
  group.updateWorldMatrix(true, true);
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    o.geometry.computeBoundingBox();
    b.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  return b;
}

// A flat ribbon mesh geometry from a centreline polyline (world x/z), half-width w, at height y. Two triangles per
// sample pair; UVs run along (u = metres of arc / width, v = across 0..1) so a future texture reads as paving. Pure.
function ribbonGeometry(THREE, samples, w, y) {
  const pts = [];
  for (const p of samples) if (isNum(p.x) && isNum(p.z)) pts.push({ x: p.x, z: p.z });
  if (pts.length < 2) return null;
  const segN = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
    segN.push({ x: -dz / L, z: dx / L });
  }
  const pos = [], nor = [], uv = [];
  let arc = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], n = segN[i];
    if (i > 0) arc += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
    const l = { x: p.x + n.x * w, z: p.z + n.z * w }, r = { x: p.x - n.x * w, z: p.z - n.z * w };
    pos.push(l.x, y, l.z, r.x, y, r.z);
    nor.push(0, 1, 0, 0, 1, 0);
    uv.push(arc / Math.max(0.001, w), 0, arc / Math.max(0.001, w), 1);
  }
  const idx = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, c, d, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// Resample a polyline (world x/z) at <= step metres so a bend is not one long chord. Pure.
function resamplePolyline(samples, step) {
  const pts = [];
  for (const p of samples) if (isNum(p.x) && isNum(p.z)) pts.push({ x: p.x, z: p.z });
  if (pts.length < 2) return pts.slice();
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + (b.x - a.x) * (k / n), z: a.z + (b.z - a.z) * (k / n) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// FACTORIES. Each returns a THREE.Group at local origin (base y = 0, footprint centred on x/z), pure, unscene'd. They
// are NOT placed by this module: see the captain's review in the header. A later anchor-aware worker places them.
function buildBoardwalk(THREE = C && C.THREE, opts = {}) {
  if (!THREE) throw new Error('biidaasige-paths: THREE is required');
  const S = SIZE.boardwalk;
  const w = opts.w || S.w, d = opts.d || S.d, deckY = isNum(opts.deckY) ? opts.deckY : S.deckY;
  const g = new THREE.Group();
  g.name = 'BiidaasigePaths_Boardwalk';
  const timber = material(THREE, 0x8a6a44, 0.9);
  const dark = material(THREE, 0x5b462e, 0.9);
  const metal = material(THREE, 0x3a3f44, 0.5, 0.6);
  const planks = Math.max(3, Math.round(d / 0.20));
  for (let i = 0; i < planks; i++) {
    const z = -d / 2 + (i + 0.5) * (d / planks);
    g.add(new THREE.Mesh(box(THREE, w, 0.06, (d / planks) * 0.92, 0, deckY - 0.06, z), timber));
  }
  for (const x of [-w / 2 + 0.15, 0, w / 2 - 0.15]) g.add(new THREE.Mesh(box(THREE, 0.12, 0.12, d, x, deckY - 0.18, 0), dark));
  const posts = Math.max(2, Math.round(d / S.post));
  for (const sx of [-1, 1]) {
    for (let i = 0; i < posts; i++) {
      const z = -d / 2 + (i + 0.5) * (d / posts);
      g.add(new THREE.Mesh(cyl(THREE, 0.055, 0.055, S.rail + deckY, 8, sx * (w / 2 - 0.08), 0, z), dark));
    }
    const rail = new THREE.CylinderGeometry(0.04, 0.04, d, 6);
    rail.rotateX(Math.PI / 2);
    rail.translate(sx * (w / 2 - 0.08), deckY + S.rail, 0);
    g.add(new THREE.Mesh(rail, metal));
  }
  return g;
}

function buildTerrazzoSteps(THREE = C && C.THREE, opts = {}) {
  if (!THREE) throw new Error('biidaasige-paths: THREE is required');
  const S = SIZE.terrazzo;
  const width = isNum(opts.width) ? opts.width : SIZE.width.footway;
  const steps = Math.max(1, Math.round(opts.steps || 4));
  const g = new THREE.Group();
  g.name = 'BiidaasigePaths_TerrazzoSteps';
  const stone = material(THREE, 0xb9b3a8, 0.9);
  const edge = material(THREE, 0x9c9689, 0.9);
  const metal = material(THREE, 0x3a3f44, 0.5, 0.6);
  for (let i = 0; i < steps; i++) {
    const y0 = i * S.riser, z = i * S.tread;
    g.add(new THREE.Mesh(box(THREE, width, S.riser, S.tread, 0, y0, z + S.tread / 2), stone));
    g.add(new THREE.Mesh(box(THREE, width, S.nosing, 0.06, 0, y0 + S.riser - S.nosing, z + S.tread - 0.03), edge));
  }
  const runL = steps * S.tread, runH = steps * S.riser;
  for (const sx of [-1, 1]) {
    g.add(new THREE.Mesh(box(THREE, 0.18, runH + 0.05, runL, sx * (width / 2 + 0.05), 0, runL / 2), stone));
    const railGeo = new THREE.CylinderGeometry(0.03, 0.03, Math.hypot(runL, runH), 6);
    railGeo.rotateX(Math.PI / 2 - Math.atan2(runH, runL));
    railGeo.translate(sx * (width / 2 + 0.05), runH / 2 + 0.9, runL / 2);
    g.add(new THREE.Mesh(railGeo, metal));
  }
  return g;
}

function buildRiverLanding(THREE = C && C.THREE, opts = {}) {
  if (!THREE) throw new Error('biidaasige-paths: THREE is required');
  const S = SIZE.riverLanding;
  const w = opts.w || S.w, d = opts.d || S.d;
  const g = new THREE.Group();
  g.name = 'BiidaasigePaths_RiverLanding';
  const pebble = material(THREE, 0xa79c8e, 1.0);
  const stone = material(THREE, 0x9c9689, 0.95);
  g.add(new THREE.Mesh(box(THREE, w, 0.08, d * 0.7, 0, 0, -d * 0.15), pebble));
  const rows = 4, cols = Math.max(3, Math.round(w / 0.5));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -w / 2 + (c + 0.5) * (w / cols) + ((r % 2) ? 0.12 : -0.06);
      const z = -d * 0.42 + (r + 0.5) * (d * 0.62 / rows);
      const s = 0.10 + 0.04 * ((r + c) % 3);
      g.add(new THREE.Mesh(cyl(THREE, s * 0.5, s * 0.6, 0.06, 6, x, 0.08, z), stone));
    }
  }
  for (let i = 0; i < 2; i++) g.add(new THREE.Mesh(box(THREE, w * 0.86, 0.10, 0.4, 0, -0.10 - i * 0.10, d * 0.35 + i * 0.4), stone));
  return g;
}

function buildFishingEdge(THREE = C && C.THREE, opts = {}) {
  if (!THREE) throw new Error('biidaasige-paths: THREE is required');
  const S = SIZE.fishingEdge;
  const w = opts.w || S.w, d = opts.d || S.d;
  const g = new THREE.Group();
  g.name = 'BiidaasigePaths_FishingEdge';
  const timber = material(THREE, 0x7a5c3a, 0.9);
  const metal = material(THREE, 0x4a4f54, 0.5, 0.5);
  g.add(new THREE.Mesh(box(THREE, w, 0.08, d, 0, S.deckY - 0.08, 0), timber));
  for (const sx of [-1, 1]) {
    for (const z of [-d / 2 + 0.15, d / 2 - 0.15]) g.add(new THREE.Mesh(cyl(THREE, 0.05, 0.05, S.rail, 8, sx * (w / 2 - 0.1), S.deckY, z), metal));
  }
  const gap = w * 0.34;
  const len = Math.max(0.1, ((w - gap) / 2) - 0.25);
  for (const sx of [-1, 1]) {
    const rail = new THREE.CylinderGeometry(0.035, 0.035, len, 8);
    rail.rotateZ(Math.PI / 2);
    rail.translate(sx * (gap / 2 + len / 2), S.deckY + S.rail, d / 2 - 0.15);
    g.add(new THREE.Mesh(rail, metal));
  }
  return g;
}

function buildKayakLaunch(THREE = C && C.THREE, opts = {}) {
  if (!THREE) throw new Error('biidaasige-paths: THREE is required');
  const S = SIZE.kayakLaunch;
  const w = opts.w || S.w, L = opts.length || S.length;
  const ang = (isNum(opts.angleDeg) ? opts.angleDeg : S.angleDeg) * Math.PI / 180;
  const g = new THREE.Group();
  g.name = 'BiidaasigePaths_KayakLaunch';
  const deck = material(THREE, 0x6f7a5a, 0.95);
  const metal = material(THREE, 0x50565c, 0.5, 0.55);
  const apron = box(THREE, w, 0.08, L, 0, 0, 0);
  apron.rotateX(ang);
  apron.translate(0, -Math.sin(ang) * L / 2 + 0.02, Math.cos(ang) * L / 2);
  g.add(new THREE.Mesh(apron, deck));
  for (const sx of [-1, 1]) {
    const railGeo = new THREE.CylinderGeometry(S.rail, S.rail, L, 8);
    railGeo.rotateX(Math.PI / 2 + ang);
    railGeo.translate(sx * (w / 2 + 0.12), -Math.sin(ang) * L / 2 + 0.10, Math.cos(ang) * L / 2);
    g.add(new THREE.Mesh(railGeo, metal));
  }
  return g;
}

const FACTORIES = Object.freeze({
  boardwalk: buildBoardwalk,
  terrazzoSteps: buildTerrazzoSteps,
  riverLanding: buildRiverLanding,
  fishingEdge: buildFishingEdge,
  kayakLaunch: buildKayakLaunch,
  ribbonGeometry
});

// ---------------------------------------------------------------------------------------------------------------
// Pure polygon helpers (world x/z) used by the adapter and the tests.
function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function polylineLength(samples) {
  let L = 0;
  for (let i = 1; i < samples.length; i++) L += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z);
  return L;
}
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  const t = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
function polylineDist(px, pz, samples) {
  let best = Infinity;
  for (let i = 0; i < samples.length - 1; i++) {
    const d = segDist(px, pz, samples[i].x, samples[i].z, samples[i + 1].x, samples[i + 1].z);
    if (d < best) best = d;
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------
// Source data reading through the city's own projection (C.worldFromLatLon at call time). null when unavailable.
function projectionAvailable() {
  return !!(C && typeof C.worldFromLatLon === 'function');
}
function project(lat, lon) {
  if (!projectionAvailable() || !isNum(lat) || !isNum(lon)) return null;
  const p = C.worldFromLatLon(lat, lon);
  return p && isNum(p.x) && isNum(p.z) ? { x: p.x, z: p.z } : null;
}
function pathSpecs() {
  const network=C?.BIIDAASIGE_PATH_NETWORK;
  if(network?.ways?.length) return network.ways
    .filter(w=>!w.bridge && w.highway!=='steps' && !['private','no'].includes(w.tags?.access) && !w.tags?.construction && !w.tags?.proposed)
    .map(w=>({id:w.id.replace(/[^a-zA-Z0-9_-]/g,'-'),feature:{id:w.id,name:w.name||'Park path',ring:w.polyline,lat:w.polyline[0]?.[0],lon:w.polyline[0]?.[1]},
      meta:{source:{osm:w.id},highway:w.highway,surface:w.surface||'unknown',widthM:w.widthM}}));
  const D = C && C.BIIDAASIGE_PARK;
  if (!D) return null;
  const find = (id) => (D.features || []).find((f) => f.id === id) || null;
  const specs = [];
  const add = (id, meta) => {
    const f = find(id);
    if (!f || f.lat === null || f.lon === null) return;
    specs.push({ id, feature: f, meta });
  };
  add('biidaasige-park-main-path', { source: SOURCE.mainPath, highway: SOURCE.mainPath.highway, surface: SOURCE.mainPath.surface });
  add('don-greenway-trail-loop', { source: SOURCE.donLoop, highway: SOURCE.donLoop.highway, surface: SOURCE.donLoop.surface });
  add('waters-edge-promenade', { source: SOURCE.promenade, highway: SOURCE.promenade.highway, surface: SOURCE.promenade.surface });
  return specs;
}
function worldParkRing() {
  const D = C && C.BIIDAASIGE_PARK;
  if (!D || !projectionAvailable()) return null;
  const latLon = D.park && D.park.polygon;
  if (!Array.isArray(latLon) || latLon.length < 3) return null;
  const out = [];
  for (const pt of latLon) {
    const p = project(pt[0], pt[1]);
    if (!p) return null;
    out.push([p.x, p.z]);
  }
  return out;
}
function worldWaterRings() {
  const D = C && C.BIIDAASIGE_PARK;
  if (!D || !projectionAvailable()) return [];
  const out = [];
  const toRing = (latLon) => {
    if (!Array.isArray(latLon) || latLon.length < 3) return null;
    const r = [];
    for (const pt of latLon) { const p = project(pt[0], pt[1]); if (!p) return null; r.push([p.x, p.z]); }
    return r;
  };
  for (const wg of D.waterGeometry || []) { const r = toRing(wg.ring); if (r) out.push({ ref: wg.ref, ring: r }); }
  for (const f of D.features || []) {
    if (f.kind === 'wetland' && Array.isArray(f.ring)) { const r = toRing(f.ring); if (r && !out.some((w) => w.ref === f.ref)) out.push({ ref: f.ref, ring: r }); }
  }
  return out;
}

// The active frame, from GEO (the same guard js/waterfront-beach-ground.js uses). Missing GEO -> do not skip.
function frameCoversPoint(x, z) {
  const GEO = C && C.GEO;
  const f = GEO && GEO.frame;
  if (!f || !isNum(f.x0)) return true;
  return x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1;
}

// The generic city paths the committed geodata already draws inside the park box (js/biidaasige-terrain.md §6). A
// different source; we do NOT delete them, and we report a named path that overlaps one.
function genericParkPaths(parkRing) {
  const GEO = C && C.GEO;
  const paths = GEO && GEO.parkPaths;
  if (!Array.isArray(paths)) return [];
  const out = [];
  for (const run of paths) {
    const pts = [];
    for (let i = 0; i + 1 < run.length; i += 2) if (isNum(run[i]) && isNum(run[i + 1])) pts.push({ x: run[i], z: run[i + 1] });
    if (pts.length >= 2) {
      if(parkRing?.length){
        const px0=Math.min(...parkRing.map(p=>p[0]))-5,px1=Math.max(...parkRing.map(p=>p[0]))+5;
        const pz0=Math.min(...parkRing.map(p=>p[1]))-5,pz1=Math.max(...parkRing.map(p=>p[1]))+5;
        if(Math.max(...pts.map(p=>p.x))<px0||Math.min(...pts.map(p=>p.x))>px1||
          Math.max(...pts.map(p=>p.z))<pz0||Math.min(...pts.map(p=>p.z))>pz1)continue;
      }
      out.push(pts);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// LAYOUT ADAPTER — C.buildBiidaasigePaths(scene, allColliders). Builds ONLY the three named OSM paths as flat ribbons
// at the park lawn + lift; nothing else (no landing, no marker, no bridge, no steps).
function buildBiidaasigePaths(scene = null, allColliders = null) {
  const THREE = (C && C.THREE) || null;
  if (!THREE) return null;
  const group = new THREE.Group();
  group.name = 'BiidaasigePaths';
  const colliders = [];
  const surfaces = [];
  const unplaced = [];
  const duplicates = [];
  const stats = {
    meshes: 0, triangles_total: 0, source: {}, estimates: true, reliefApplied: false,
    lawnY: LAWN_Y, surfaceLift: SIZE.surfaceLift, pathCount: 0, landingCount: 0, stepCount: 0
  };
  const sink = (arr) => { if (Array.isArray(allColliders)) allColliders.push(...arr); };

  const specs = pathSpecs();
  const parkRing = worldParkRing();
  if (!specs || !specs.length || !parkRing) {
    stats.reason = !specs ? 'BIIDAASIGE_PARK data missing' : 'park ring or projection unavailable';
    group.userData.biidaasigePaths = stats;
    if (scene && scene.add) scene.add(group);
    if (C) C.biidaasigePaths = { group, colliders, surfaces, unplaced, duplicates, stats };
    return { group, colliders, surfaces, unplaced, duplicates, stats };
  }

  if(C.BIIDAASIGE_PATH_NETWORK){
    for(const w of C.BIIDAASIGE_PATH_NETWORK.ways) if(w.bridge||w.highway==='steps')unplaced.push({id:w.id,
      reason:w.bridge?'Existing bridge deck retains its native level; no flat ground ribbon added':'Mapped stairs require surveyed or source-derived vertical profile'});
  }
  const generic = genericParkPaths(parkRing);
  const waters = worldWaterRings(); // the test/consumer can prove every ribbon vertex is dry
  const y = LAWN_Y + SIZE.surfaceLift;

  const surfaceMaterials=new Map();
  for (const spec of specs) {
    const f = spec.feature;
    const latLonRing = Array.isArray(f.ring) ? f.ring : null;
    if (!latLonRing || latLonRing.length < 2) { unplaced.push({ id: spec.id, reason: 'no source polyline' }); continue; }
    const raw = [];
    let projectFail = false;
    for (const pt of latLonRing) {
      const p = project(pt[0], pt[1]);
      if (!p) { projectFail = true; break; }
      raw.push(p);
    }
    if (projectFail) { unplaced.push({ id: spec.id, reason: 'source vertex outside the active projection' }); continue; }
    let anyInside = false;
    for (const p of raw) { if (frameCoversPoint(p.x, p.z)) { anyInside = true; break; } }
    if (!anyInside) { unplaced.push({ id: spec.id, reason: 'path outside the active GEO frame' }); continue; }

    const samples = resamplePolyline(raw, SIZE.sampleStepM);
    const w = spec.meta.widthM || SIZE.width[spec.meta.highway] || SIZE.width.path;
    const geo = ribbonGeometry(THREE, samples, w / 2, y);
    if (!geo) { unplaced.push({ id: spec.id, reason: 'degenerate polyline' }); continue; }
    const materialKey=spec.meta.surface||'unknown';
    if(!surfaceMaterials.has(materialKey))surfaceMaterials.set(materialKey,pathMaterial(THREE,materialKey));
    const mat = surfaceMaterials.get(materialKey);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `BiidaasigePaths_${spec.id}`;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.userData.cullDistance = 600;
    mesh.userData.cullCell = 80;
    group.add(mesh); stats.meshes++;
    const tris = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    const length = polylineLength(samples);

    // duplicate contract: how close does this run to a generic GEO.parkPath? Reported, never hidden.
    let overlapM = Infinity;
    for (const run of generic) for (const p of samples) { const d = polylineDist(p.x, p.z, run); if (d < overlapM) overlapM = d; }
    const duplicate = overlapM < DUPLICATE_OVERLAP_M;
    if (duplicate) duplicates.push({ id: spec.id, genericOverlapM: Math.round(overlapM * 100) / 100 });

    // walkable `surface` colliders: one box per sample pair so a bend's collider follows the bend. Not a wall.
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i], b = samples[i + 1], pad = w / 2;
      colliders.push({
        minX: Math.min(a.x, b.x) - pad, maxX: Math.max(a.x, b.x) + pad,
        minZ: Math.min(a.z, b.z) - pad, maxZ: Math.max(a.z, b.z) + pad,
        minY: 0, maxY: y, surface: true, kind: 'path', pathId: spec.id
      });
    }

    surfaces.push({ id: spec.id, ref: spec.meta.source.osm, name: f.name, highway: spec.meta.highway, sourceSurface: spec.meta.surface,
      lengthM: Math.round(length * 10) / 10, widthM: w, y, triangles: tris, sampleCount: samples.length, duplicate });
    stats.source[spec.id] = { osm: spec.meta.source.osm, lengthM: Math.round(length * 10) / 10, surface: spec.meta.surface,
      widthM: w, duplicateOverlapM: duplicate ? Math.round(overlapM * 100) / 100 : null };
    stats.pathCount++;
    stats.triangles_total += tris;
  }

  // Everything named by official sources but with no registered current-map position stays UNPLACED and reported —
  // including every landing type, the steps symbol and the promoted Canoe Cove landing. Never scattered along the shore.
  const D = C.BIIDAASIGE_PARK;
  for (const f of (D && D.unverifiedFeatures) || []) {
    if (!f) continue;
    if (['landing', 'steps', 'water-access', 'viewpoint', 'play'].indexOf(f.kind) === -1) continue;
    unplaced.push({ id: f.id, name: f.name, kind: f.kind, reason: 'official source, no registered current-map position (see docs/biidaasige-paths.md)' });
  }
  // Paths whose geometry is not clipped to the park here are reported too (the next map-registration worker clips them).
  for (const f of (D && D.unverifiedFeatures) || []) {
    if (f && f.id === 'trails-other-named') unplaced.push({ id: f.id, name: f.name, kind: 'path', reason: 'broad-extract geometry, clipped in a later pass' });
  }

  if(C.BIIDAASIGE_PATH_NETWORK && C.THREE.Float32BufferAttribute){
    const buckets=new Map(),cell=120;
    for(const mesh of [...group.children]){
      const geo=mesh.geometry,p=geo.attributes.position,uv=geo.attributes.uv,idx=geo.index;
      const count=idx?idx.count:p.count;
      for(let t=0;t<count;t+=3){
        const indices=[0,1,2].map(k=>idx?idx.getX(t+k):t+k);
        const cx=indices.reduce((v,i)=>v+p.getX(i),0)/3,cz=indices.reduce((v,i)=>v+p.getZ(i),0)/3;
        const key=mesh.material.uuid+':'+Math.floor(cx/cell)+':'+Math.floor(cz/cell);
        if(!buckets.has(key))buckets.set(key,{material:mesh.material,pos:[],uv:[],norm:[]});
        const b=buckets.get(key);
        for(const i of indices){b.pos.push(p.getX(i),p.getY(i),p.getZ(i));b.norm.push(0,1,0);b.uv.push(uv.getX(i),uv.getY(i));}
      }
      group.remove(mesh);geo.dispose();
    }
    let i=0;
    for(const b of buckets.values()){
      const geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.Float32BufferAttribute(b.pos,3));
      geo.setAttribute('normal',new THREE.Float32BufferAttribute(b.norm,3));
      geo.setAttribute('uv',new THREE.Float32BufferAttribute(b.uv,2));
      geo.computeBoundingBox();geo.computeBoundingSphere();
      const mesh=new THREE.Mesh(geo,b.material);mesh.name='BiidaasigePaths_Cell_'+i++;
      mesh.receiveShadow=true;mesh.userData.cullDistance=900;mesh.userData.cullCell=120;group.add(mesh);
    }
    stats.meshes=group.children.length;stats.batchCellM=cell;
  }
  stats.colliders = colliders.length;
  stats.triangles = stats.triangles_total;
  group.userData.biidaasigePaths = stats;
  if (scene && scene.add) scene.add(group);
  sink(colliders);
  if (C) C.biidaasigePaths = { group, colliders, surfaces, unplaced, duplicates, stats };
  if (typeof console !== 'undefined' && console.info) {
    console.info(`[biidaasigePaths] ${stats.pathCount} named paths (${stats.triangles} tris), ${stats.colliders} surface cells, ` +
      `${duplicates.length} generic overlaps, ${unplaced.length} unplaced (no landing/marker/bridge/step placed)`);
  }
  return { group, colliders, surfaces, unplaced, duplicates, stats };
}

// ---------------------------------------------------------------------------------------------------------------
// EXACT-TRIANGLE HEIGHT QUERY over this module's own published path triangles. It returns the triangle's OWN vertex
// height (already the lawn + lift); it never adds a caller baseY and never clamps to a world height. Another module
// that adds relief owns its own query. Pure over C.biidaasigePaths.
function pathsTriangles() {
  const w = C && C.biidaasigePaths;
  if (!w || !w.group) return [];
  const out = [];
  for (const mesh of w.group.children) {
    if (!mesh.isMesh || !mesh.geometry || !mesh.name.startsWith('BiidaasigePaths_')) continue;
    const pos = mesh.geometry.attributes.position;
    const idx = mesh.geometry.index;
    const pathId = mesh.name.replace('BiidaasigePaths_', '');
    const tri = idx ? idx.count / 3 : pos.count / 3;
    for (let t = 0; t < tri; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      out.push({
        pathId,
        x0: pos.getX(i0), y0: pos.getY(i0), z0: pos.getZ(i0),
        x1: pos.getX(i1), y1: pos.getY(i1), z1: pos.getZ(i1),
        x2: pos.getX(i2), y2: pos.getY(i2), z2: pos.getZ(i2)
      });
    }
  }
  return out;
}
function biidaasigePathsSurfaceAt(x, z) {
  if (!isNum(x) || !isNum(z)) return null;
  const tris = pathsTriangles();
  for (const T of tris) {
    // barycentric point-in-triangle test (2D, x/z), then the triangle's own height at (x, z)
    const d = (T.z1 - T.z2) * (T.x0 - T.x2) + (T.x2 - T.x1) * (T.z0 - T.z2);
    if (Math.abs(d) < 1e-9) continue;
    const a = ((T.z1 - T.z2) * (x - T.x2) + (T.x2 - T.x1) * (z - T.z2)) / d;
    const b = ((T.z2 - T.z0) * (x - T.x2) + (T.x0 - T.x2) * (z - T.z2)) / d;
    const c = 1 - a - b;
    if (a < -1e-6 || b < -1e-6 || c < -1e-6) continue;
    const surfaceY = a * T.y0 + b * T.y1 + c * T.y2; // exact triangle height, no base added, no clamp
    return { onPath: true, surfaceY, pathId: T.pathId };
  }
  return { onPath: false, surfaceY: null, pathId: null };
}

// ---------------------------------------------------------------------------------------------------------------
// Exports (the repo module convention: Object.assign(window.CITY, {...})).
if (C) {
  Object.assign(C, {
    BIIDAASIGE_PATH_SIZES: SIZE,
    BIIDAASIGE_PATH_SOURCE: SOURCE,
    BIIDAASIGE_PATH_DUPLICATE_OVERLAP_M: DUPLICATE_OVERLAP_M,
    buildBiidaasigePaths,
    biidaasigePathsFactories: FACTORIES,
    biidaasigePathsSurfaceAt,
    biidaasigePathsTriangles: pathsTriangles,
    // pure helpers a consumer or test can use without a scene
    biidaasigePathsHelpers: { ribbonGeometry, resamplePolyline, pointInRing, polylineLength, polylineDist, segDist, extentOf }
  });
}
})();
