(function () {
// js/biidaasige-lighting.js
// Biidaasige Park's SOURCE-LOCATED LIGHTING, WAYFINDING AND BOLLARDS (bead st-bmyv.10; parent st-bmyv). See
// docs/biidaasige-lighting.md for the sources, the recorded size estimates and the licensing note.
//
// WHAT THE SOURCES ACTUALLY MAP (current OpenStreetMap, 2026-11-10, ODbL):
//
//   - street lamps: 0 nodes with highway=street_lamp lie INSIDE the committed park polygon. The 47 lamps the bbox
//     query returns are all OUTSIDE it (the surrounding streets / Don trail). They are recorded as context and are
//     NEVER repurposed as park lamps.
//   - wayfinding: 3 nodes with tourism=information + information=guidepost lie INSIDE the park polygon. They are the
//     only mapped wayfinding points, and they are placed.
//   - bollards: 0 barrier=bollard nodes lie INSIDE the park polygon. The one bollard the bbox query returns is
//     OUTSIDE it. It is recorded as context and is NEVER placed.
//
// The park photos show a DISTINCTIVE fixture: a slim round weathered natural timber post ~5-6 m high, diameter
// ~.12-.16 m, a short dark charcoal horizontal arm ~.7 m long near the top with a small flat downward luminaire, and
// the timber continuing ~.3 m above the arm. That fixture is built as a reusable local-origin factory
// (buildTimberLuminaire) with a small EMISSIVE head for night — never a point light per pole. Because no lamp is
// mapped inside the park, the factory is exported but NO lamp is placed: the source sites stay unplaced. The same is
// true of the bollard factory. This is the honest bound, not an invented count along a path.
//
// The module has two halves:
//
//   1. FACTORIES — buildXxx(THREE, options) return a THREE.Group built 1 unit = 1 m, Y-up, local origin at the
//      ground contact point (the post base), front +z, the repo prop convention (docs/city-open-data-layers.md).
//      They are pure geometry and need no scene, data or network, so a test can stand one up on the CPU and measure it.
//
//   2. LAYOUT ADAPTER — buildBiidaasigeLighting(scene, allColliders, opts) reads ONLY the verified source sites
//      embedded below (the 3 mapped guideposts), re-verifies each against the committed park polygon at call time,
//      projects through window.CITY.worldFromLatLon, and places a generic blank guidepost at each. It never invents a
//      lamp, a bollard or a count. It exposes every source site with its ID and accepts `opts.renderedSites` for a
//      spatial dedupe against another layer's already-rendered same-kind sites.
//
// Dedupe contract (`dedupe`, exported): a source site is placed only when no already-rendered same-kind site lies
// within DEDUPE_RADIUS of it. Pass `{ renderedSites: [{ x, z, kind }] }` to skip sites another layer already draws.
//
// No per-pole lights, no heavy shaders, no unbounded dynamic shadows. Node materials, shared instanced geometry and
// materials, bounded cull cells (~60 m), <5 meshes/materials for the pole factories.
const C = (typeof window !== 'undefined' && window.CITY) ? window.CITY : null;

// ---------------------------------------------------------------------------------------------------------------
// Recorded sizes (1 unit = 1 m). Each is a PHOTO ESTIMATE unless marked otherwise; see docs/biidaasige-lighting.md.
const SIZE = {
  // The distinctive timber park luminaire: slim round weathered natural timber post ~5-6 m high, diameter ~.12-.16 m;
  // a short dark charcoal horizontal arm ~.7 m long near the top with a small flat downward luminaire; the timber
  // continues ~.3 m above the arm. All values are photo estimates from the captain's written observations.
  luminaire: {
    postH: 5.5,        // photo estimate (5-6 m)
    postDia: 0.14,     // photo estimate (.12-.16 m)
    armLen: 0.7,       // photo estimate
    armY: 5.2,         // arm height; post top (5.5) continues .3 m above it
    armDia: 0.06,      // photo estimate
    headW: 0.28,       // small flat luminaire, photo estimate
    headD: 0.18,
    headH: 0.10,
    topAboveArm: 0.3   // source-fact from the written observation
  },
  // Generic blank low reader / guidepost: a slim post with two blank finger boards. No fabricated park map or text.
  guidepost: {
    postH: 2.2,        // estimate
    postDia: 0.08,     // estimate
    panelW: 0.7,       // estimate
    panelH: 0.16,      // estimate
    panelT: 0.03,      // estimate
    fingers: 2
  },
  // Simple park bollard: a short dark post with a reflective band. Estimate; no mapped bollard inside the park.
  bollard: {
    h: 0.9,            // estimate
    dia: 0.12,         // estimate
    band: 0.06         // estimate
  }
};

// The checked-in source record (tools/fixtures/biidaasige-lighting.json). The module embeds the verified sites so the
// browser never reads tools/; the fixture is the provenance and the build script re-validates it.
const SOURCE_META = Object.freeze({
  fixture: 'tools/fixtures/biidaasige-lighting.json',
  license: 'ODbL-1.0',
  licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
  attribution: '© OpenStreetMap contributors, ODbL 1.0 — https://www.openstreetmap.org/copyright',
  sourceUrl: 'https://overpass-api.de/api/interpreter',
  osmBaseTimestamp: '2026-11-10T23:24:18Z',
  fetchedOn: '2026-11-10',
  bbox: Object.freeze({ minLat: 43.642, minLon: -79.359, maxLat: 43.650, maxLon: -79.341 })
});

// The ONLY mapped wayfinding points inside the committed park polygon (tourism=information, information=guidepost).
// Copied from the fixture; the adapter re-verifies each against the park polygon at call time.
const SOURCE_SITES = Object.freeze([
  Object.freeze({ id: 'osm-node-14071202397', osmId: 14071202397, kind: 'wayfinding', lat: 43.6453419, lon: -79.3477229, placement: 'osm-node', positionConfidence: 'mapped', tags: Object.freeze({ information: 'guidepost', tourism: 'information' }) }),
  Object.freeze({ id: 'osm-node-14071241307', osmId: 14071241307, kind: 'wayfinding', lat: 43.6446681, lon: -79.3486716, placement: 'osm-node', positionConfidence: 'mapped', tags: Object.freeze({ information: 'guidepost', tourism: 'information' }) }),
  Object.freeze({ id: 'osm-node-14071243053', osmId: 14071243053, kind: 'wayfinding', lat: 43.6438325, lon: -79.350529, placement: 'osm-node', positionConfidence: 'mapped', tags: Object.freeze({ information: 'guidepost', tourism: 'information' }) })
]);

// No mapped lamp or bollard lies inside the park polygon. These stay empty on purpose; the factories remain useful.
const SOURCE_LAMPS = Object.freeze([]);
const SOURCE_BOLLARDS = Object.freeze([]);
const CONTEXT = Object.freeze({ streetLampsOutside: 47, bollardsOutside: 1 });

const DEDUPE_RADIUS = 1.5;
const CULL_CELL = 60;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---------------------------------------------------------------------------------------------------------------
// Geometry helpers. Every factory is pure: (THREE, options) -> THREE.Group, and touches no scene or data.

function material(THREE, color, roughness = 0.85, metalness = 0.0, emissive = null, emissiveIntensity = 0) {
  const Mat = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
  const opts = { color, roughness, metalness };
  if (emissive != null) { opts.emissive = emissive; opts.emissiveIntensity = emissiveIntensity; }
  return new Mat(opts);
}

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

// Bounding helper: a group's own extent, used by the factories' self-check and the tests.
function extentOf(THREE, group) {
  const box3 = new THREE.Box3();
  group.updateWorldMatrix(true, true);
  group.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    if (!g) return;
    g.computeBoundingBox();
    const b = g.boundingBox.clone().applyMatrix4(o.matrixWorld);
    box3.union(b);
  });
  return box3;
}

// ---------------------------------------------------------------------------------------------------------------
// FACTORIES. Each returns a THREE.Group at local origin (post base y=0, front +z).

// The distinctive timber park luminaire. The post base is the ground contact; the arm overhangs +z. The head is a
// small flat housing with an EMISSIVE underside (a night glow), never a point light.
function buildTimberLuminaire(THREE = C?.THREE) {
  if (!THREE) throw new Error('biidaasige-lighting: THREE is required');
  const S = SIZE.luminaire;
  const group = new THREE.Group();
  group.name = 'BiidaasigeLighting_TimberLuminaire';
  const timber = material(THREE, 0x9a8a72, 0.95, 0.0);
  const charcoal = material(THREE, 0x2f3337, 0.6, 0.3);
  const lens = material(THREE, 0xfff2d0, 0.4, 0.0, 0xffe6b0, 1.2);
  // Slim round weathered timber post.
  group.add(new THREE.Mesh(cyl(THREE, S.postDia / 2, S.postDia / 2, S.postH, 10), timber));
  // Short dark charcoal horizontal arm along +z, near the top.
  const arm = new THREE.CylinderGeometry(S.armDia / 2, S.armDia / 2, S.armLen, 8);
  arm.rotateX(Math.PI / 2);
  arm.translate(0, S.armY, S.armLen / 2);
  group.add(new THREE.Mesh(arm, charcoal));
  // Small flat downward luminaire at the arm end: a charcoal housing with an emissive lens under it.
  const hz = S.armLen - S.headD / 2;
  group.add(new THREE.Mesh(box(THREE, S.headW, S.headH, S.headD, 0, S.armY - S.headH, hz), charcoal));
  group.add(new THREE.Mesh(box(THREE, S.headW * 0.8, 0.02, S.headD * 0.8, 0, S.armY - S.headH - 0.02, hz), lens));
  return group;
}

// A generic blank low reader / guidepost: a slim post with two blank finger boards. No fabricated park map, no
// artist/cultural text. The post base is the ground contact; the boards overhang.
function buildWayfindingGuidepost(THREE = C?.THREE) {
  if (!THREE) throw new Error('biidaasige-lighting: THREE is required');
  const S = SIZE.guidepost;
  const group = new THREE.Group();
  group.name = 'BiidaasigeLighting_WayfindingGuidepost';
  const post = material(THREE, 0x3a3f44, 0.5, 0.55);
  const panel = material(THREE, 0x37566b, 0.7, 0.1);
  group.add(new THREE.Mesh(cyl(THREE, S.postDia / 2, S.postDia / 2, S.postH, 8), post));
  // Two blank finger boards at different heights, pointing opposite ways. Blank on purpose: no invented text.
  for (let i = 0; i < S.fingers; i++) {
    const y = S.postH - 0.18 - i * 0.22;
    const dir = i % 2 === 0 ? 1 : -1;
    const board = box(THREE, S.panelW, S.panelH, S.panelT, 0, y, dir * (S.panelW / 2 - 0.02));
    group.add(new THREE.Mesh(board, panel));
  }
  return group;
}

// A simple park bollard: a short dark post with a reflective band. No mapped bollard inside the park, so this is a
// reusable factory only.
function buildBollard(THREE = C?.THREE) {
  if (!THREE) throw new Error('biidaasige-lighting: THREE is required');
  const S = SIZE.bollard;
  const group = new THREE.Group();
  group.name = 'BiidaasigeLighting_Bollard';
  const dark = material(THREE, 0x2b2f33, 0.7, 0.3);
  const band = material(THREE, 0xd8d2c4, 0.5, 0.1);
  group.add(new THREE.Mesh(cyl(THREE, S.dia / 2, S.dia / 2, S.h, 10), dark));
  group.add(new THREE.Mesh(cyl(THREE, S.dia / 2 + 0.005, S.dia / 2 + 0.005, S.band, 10, 0, S.h - S.band - 0.08, 0), band));
  return group;
}

// ---------------------------------------------------------------------------------------------------------------
// Shared instancing helpers (the same bounded-merge pattern the amenities layer uses).

function mergeFactory(THREE, factory) {
  const group = factory();
  group.updateWorldMatrix(true, true);
  const byColor = new Map();
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const geo = o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);
    const key = o.material && o.material.color ? o.material.color.getHexString() : 'default';
    if (!byColor.has(key)) byColor.set(key, { material: o.material, geos: [] });
    byColor.get(key).geos.push(geo);
  });
  const merge = C?.Addons?.mergeGeometries;
  const parts = [];
  for (const { material: mat, geos } of byColor.values()) {
    let geo;
    if (geos.length === 1) geo = geos[0];
    else if (merge) { geo = merge(geos, false); for (const g of geos) g.dispose?.(); }
    else { geo = geos[0]; for (let i = 1; i < geos.length; i++) geos[i].dispose?.(); }
    geo.computeBoundingBox();
    parts.push({ geometry: geo, material: mat });
  }
  return { group, parts, materialCount: parts.length };
}

function instanceParts(THREE, parts, sites, name, { cullDistance = 300, cullCell = CULL_CELL, castShadow = true } = {}) {
  const meshes = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  for (const { geometry, material: mat } of parts) {
    if (!sites.length) continue;
    const mesh = new THREE.InstancedMesh(geometry, mat, sites.length);
    mesh.name = name;
    sites.forEach((site, i) => {
      p.set(site.x, site.y, site.z);
      q.setFromAxisAngle(up, site.yaw || 0);
      mesh.setMatrixAt(i, m.compose(p, q, one));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.userData.cullDistance = cullDistance;
    mesh.userData.cullCell = cullCell;
    mesh.computeBoundingBox?.();
    mesh.computeBoundingSphere?.();
    meshes.push(mesh);
  }
  return meshes;
}

// ---------------------------------------------------------------------------------------------------------------
// Source geometry helpers.

function parkPolygon() {
  const D = C && C.BIIDAASIGE_PARK;
  const poly = D && D.park && D.park.polygon;
  return Array.isArray(poly) && poly.length >= 3 ? poly : null;
}

function projectionAvailable() {
  return !!(C && typeof C.worldFromLatLon === 'function');
}

function project(lat, lon) {
  if (!projectionAvailable() || !isNum(lat) || !isNum(lon)) return null;
  const p = C.worldFromLatLon(lat, lon);
  return p && isNum(p.x) && isNum(p.z) ? { x: p.x, z: p.z } : null;
}

// Ray-cast point-in-polygon on the committed park ring (lat/lon pairs). The same test the fixture build uses.
function pointInRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][0], xi = ring[i][1], yj = ring[j][0], xj = ring[j][1];
    const inter = ((yi > lat) !== (yj > lat)) && (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
    if (inter) inside = !inside;
  }
  return inside;
}

const groundY = (x = 0, z = 0) => (C?.CITY_BOUNDS?.sidewalkHeight ?? 0.22) + 0.004 + (C?.cutAt ? (C.cutAt(x, z) || 0) : 0);

// The dedupe contract, exported so a test and a reviewer can check it: which source sites this layer may place, given
// what other layers already render. A site is kept only when no already-rendered same-kind site is within `radius`.
function dedupe({ sourceSites = [], renderedSites = [], radius = DEDUPE_RADIUS } = {}) {
  const byKind = new Map();
  for (const r of renderedSites) {
    if (!r || !isNum(r.x) || !isNum(r.z) || !r.kind) continue;
    if (!byKind.has(r.kind)) byKind.set(r.kind, []);
    byKind.get(r.kind).push(r);
  }
  const kept = [], skipped = [];
  for (const s of sourceSites) {
    if (!s || !isNum(s.x) || !isNum(s.z) || !s.kind) { skipped.push({ id: s && s.id, reason: 'invalid source site' }); continue; }
    const list = byKind.get(s.kind);
    let hit = false;
    if (list) for (const r of list) if (Math.hypot(r.x - s.x, r.z - s.z) <= radius) { hit = true; break; }
    if (hit) skipped.push({ id: s.id, reason: 'already rendered within dedupe radius' });
    else kept.push(s);
  }
  return { kept, skipped };
}

// ---------------------------------------------------------------------------------------------------------------
// LAYOUT ADAPTER — buildBiidaasigeLighting(scene, allColliders, opts). Places ONLY the verified mapped guideposts;
// the lamp and bollard factories stay unplaced because no source point lies inside the park.

function buildBiidaasigeLighting(scene = null, allColliders = null, opts = {}) {
  const THREE = C?.THREE;
  if (!THREE) return null;
  const { renderedSites = [], skipKinds = [], extraSites = [] } = opts;
  const group = new THREE.Group();
  group.name = 'BiidaasigeLighting';
  const colliders = [];
  const stats = {
    counts: {}, meshes: 0, materials: {}, colliders: 0, unplaced: [], skipped: [],
    source: {}, projected: false, cullCell: CULL_CELL, dedupeRadius: DEDUPE_RADIUS
  };
  const sink = (arr) => { if (Array.isArray(allColliders)) allColliders.push(...arr); };
  const poly = parkPolygon();
  if (!poly || !projectionAvailable()) {
    stats.reason = !poly ? 'BIIDAASIGE_PARK.park.polygon missing' : 'projection unavailable (C.worldFromLatLon missing)';
    group.userData.biidaasigeLighting = stats;
    if (scene && scene.add) scene.add(group);
    if (C) C.biidaasigeLighting = { group, colliders, stats, sourceSites: [], placedSites: [] };
    return { group, colliders, stats, sourceSites: [], placedSites: [] };
  }
  stats.projected = true;

  // 1. Re-verify every embedded source site (plus any caller-registered image points) against the committed park
  //    polygon, then project it. `extraSites` lets the parent register further image-interpreted points later without
  //    editing this module; each must carry its own id, kind, lat and lon.
  const allSites = SOURCE_SITES.concat(Array.isArray(extraSites) ? extraSites : []);
  const sourceSites = [];
  for (const s of allSites) {
    if (!pointInRing(s.lat, s.lon, poly)) { stats.skipped.push({ id: s.id, reason: 'source point outside park polygon' }); continue; }
    const w = project(s.lat, s.lon);
    if (!w) { stats.skipped.push({ id: s.id, reason: 'projection failed' }); continue; }
    sourceSites.push(Object.assign({}, s, { x: w.x, z: w.z }));
  }
  stats.source = {
    fixture: SOURCE_META.fixture,
    osmBaseTimestamp: SOURCE_META.osmBaseTimestamp,
    license: SOURCE_META.license,
    mappedInside: sourceSites.length,
    lampsInside: SOURCE_LAMPS.length,
    bollardsInside: SOURCE_BOLLARDS.length,
    lampsOutside: CONTEXT.streetLampsOutside,
    bollardsOutside: CONTEXT.bollardsOutside
  };

  // 2. Spatial dedupe against already-rendered same-kind sites.
  const { kept, skipped } = dedupe({ sourceSites, renderedSites, radius: DEDUPE_RADIUS });
  for (const s of skipped) stats.skipped.push(s);

  // 3. Group the kept sites by kind and instance each kind once per material.
  const byKind = new Map();
  for (const s of kept) {
    if (skipKinds.includes(s.kind)) { stats.skipped.push({ id: s.id, reason: 'kind skipped by caller' }); continue; }
    if (!byKind.has(s.kind)) byKind.set(s.kind, []);
    byKind.get(s.kind).push(s);
  }
  const FACTORY = {
    wayfinding: () => buildWayfindingGuidepost(THREE),
    streetLamp: () => buildTimberLuminaire(THREE),
    bollard: () => buildBollard(THREE)
  };
  const COLLIDER_R = {
    wayfinding: SIZE.guidepost.postDia / 2 + 0.02,
    streetLamp: SIZE.luminaire.postDia / 2 + 0.02,
    bollard: SIZE.bollard.dia / 2 + 0.02
  };
  const HEIGHT = {
    wayfinding: SIZE.guidepost.postH,
    streetLamp: SIZE.luminaire.postH,
    bollard: SIZE.bollard.h
  };
  const placedSites = [];
  for (const [kind, sites] of byKind) {
    const factory = FACTORY[kind];
    if (!factory) { stats.unplaced.push(kind); continue; }
    const merged = mergeFactory(THREE, factory);
    const placed = sites.map((s) => ({ x: s.x, z: s.z, y: groundY(s.x, s.z), yaw: isNum(s.yaw) ? s.yaw : 0 }));
    const meshes = instanceParts(THREE, merged.parts, placed, `BiidaasigeLighting_${kind}`, { cullDistance: 300, cullCell: CULL_CELL });
    for (const mesh of meshes) { group.add(mesh); stats.meshes++; }
    stats.materials[kind] = merged.materialCount;
    stats.counts[kind] = sites.length;
    const r = COLLIDER_R[kind] || 0.1;
    const h = HEIGHT[kind] || 1;
    for (const s of sites) {
      const y0 = groundY(s.x, s.z);
      // Individual solid pole collider: a small circle at the post base, never a path-blocking box.
      colliders.push({
        minX: s.x - r, maxX: s.x + r, minZ: s.z - r, maxZ: s.z + r,
        minY: y0 - 0.3, maxY: y0 + h, circle: { x: s.x, z: s.z, r },
        prop: true, kind, source: 'osm', featureId: s.id
      });
      placedSites.push({ id: s.id, kind, x: s.x, z: s.z, y: y0, yaw: isNum(s.yaw) ? s.yaw : 0 });
    }
  }

  // 4. Honest unplaced record: no mapped lamp or bollard lies inside the park polygon.
  if (!byKind.has('streetLamp')) stats.unplaced.push('streetLamps (0 mapped inside the park polygon; factory only)');
  if (!byKind.has('bollard')) stats.unplaced.push('bollards (0 mapped inside the park polygon; factory only)');

  stats.colliders = colliders.length;
  group.userData.biidaasigeLighting = stats;
  if (scene && scene.add) scene.add(group);
  sink(colliders);
  if (C) {
    C.biidaasigeLighting = { group, colliders, stats, sourceSites, placedSites };
    C.biidaasigeLightingDedupe = dedupe;
  }
  if (typeof console !== 'undefined' && console.info) {
    console.info(`[biidaasigeLighting] ${stats.counts.wayfinding || 0} wayfinding, ${stats.counts.streetLamp || 0} lamps, ${stats.counts.bollard || 0} bollards; ${stats.meshes} meshes, ${stats.colliders} colliders; unplaced: ${stats.unplaced.join(', ') || 'none'}`);
  }
  return { group, colliders, stats, sourceSites, placedSites };
}

if (C) {
  Object.assign(C, {
    BIIDAASIGE_LIGHTING_SIZES: SIZE,
    BIIDAASIGE_LIGHTING_SOURCE: SOURCE_META,
    BIIDAASIGE_LIGHTING_SITES: SOURCE_SITES,
    BIIDAASIGE_LIGHTING_DEDUPE_RADIUS: DEDUPE_RADIUS,
    buildBiidaasigeLighting,
    biidaasigeLightingFactories: {
      buildTimberLuminaire, buildWayfindingGuidepost, buildBollard,
      extentOf, pointInRing, dedupe,
      flatten: (T, factory) => mergeFactory(T, factory).parts
    },
    biidaasigeLightingDedupe: dedupe
  });
}
})();
