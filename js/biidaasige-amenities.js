(function () {
// js/biidaasige-amenities.js
// Biidaasige Park's everyday furniture (bead st-bmyv.5): the two dog off-leash areas' parts, the picnic and BBQ
// terraces, the long permanent tables and communal three-grill barbecues, the park benches, bike racks, drinking
// and dog fountains and interpretive signage. See docs/biidaasige-amenities.md for the sources, the recorded
// size estimates and the licensing note.
//
// The module has two halves:
//
//   1. FACTORIES — buildXxx(THREE, options) return a THREE.Group built 1 unit = 1 m, Y-up, local origin at the
//      ground contact point (footprint centred on x/z), front +z, the repo prop convention
//      (docs/city-open-data-layers.md). They are pure geometry and need no scene, data or network, so a test can
//      stand one up on the CPU and measure it.
//
//   2. LAYOUT ADAPTER — buildBiidaasigeAmenities(scene, allColliders, opts) reads ONLY verified positions from the
//      current Biidaasige inventory API (js/biidaasige-park-data.js, bead st-bmyv.1; read, never edited here):
//        CITY.biidaasigeParkFeatures()                 verified OSM features (placement 'osm-...')
//        CITY.biidaasigeParkRingWorld(id)              an OSM dog-park ring, projected at call time
//        CITY.biidaasigeParkWorld(id) / ...Pose(id)    an OSM point, projected at call time
//      It never distributes a count along a shape: the dog areas are 800/1,200 m2 AREAS (OSM polygons verified only,
//      never guessed rectangles) and the terraces seat up to 40 (a CAPACITY), neither of which is a layout. Anything
//      the sources describe but do not locate is reported as `unplaced`, not scattered.
//
// CORRECTION (captain review): the current City Recreation page (modified 2026-09-09) DOES list "Outdoor Fitness
// Equipment — Fitness equipment is available west of Cableway Canyon". Fitness is therefore modelled as a factory
// and recorded as a LISTED-UNPLACED source zone (a published area west of Cableway Canyon, no published point); it is
// not given an invented position. The paths, the play structures, the Fire Hall/Atlas/Drum and the indigenous
// placekeeping elements belong to other workers' modules and are not touched here.
//
// Positions and counts are never invented; where they are missing the output stays honest and empty.
//
// Dedupe contract (`dedupe`, exported): the layer builds a water station ONLY where the City Open Data station it
// would render is not already rendered by another layer, and builds municipal furniture ONLY where OSM says it is
// and the shared street-furniture layout does not already place it. Pass `{ skipAssets }` to skip shared GLBs.
const C = (typeof window !== 'undefined' && window.CITY) ? window.CITY : null;

// ---------------------------------------------------------------------------------------------------------------
// Recorded sizes (1 unit = 1 m). Each is sourced or marked as an estimate in docs/biidaasige-amenities.md.
const SIZE = {
  // Existing, already-reviewed City street-bench proportion (assets/props/plaza-bench.glb,
  // docs/city-open-data-layers.md): the park bench reads as the same City standard.
  bench: { w: 1.8, h: 0.96, d: 0.8, seat: 0.45, back: 0.92 },
  // City litter-bin proportion (assets/props/litter-bin.glb): the same bin City-wide.
  bin: { w: 0.6, h: 1.0, d: 0.6 },
  // Simple inverted-U rack, matching the bike-ring family (estimate).
  rack: { w: 0.8, h: 0.9, d: 0.06, tube: 0.05 },
  // Drinking / bottle-filling station (post an estimate; the dog bowl is a source-fact for the dog fountains).
  fountain: { w: 0.6, h: 1.0, d: 0.5, bowl: 0.25, bowlR: 0.16, spout: 0.12 },
  // Long permanent table ("long ... seat up to 40" is a capacity, so one table is standard; estimate).
  table: { w: 6.0, h: 0.76, d: 0.9, benchW: 0.32, benchH: 0.45, benchInset: 0.09 },
  // Communal barbecue: circular with THREE separate grills (a source-fact); diameter an estimate.
  barbecue: { diameter: 1.6, h: 0.9, grills: 3 },
  // Dog-OLA perimeter fence post spacing and heights (City dog-OLA standard; estimates).
  fence: { h: 1.2, post: 2.4, picket: 0.10, rail: 0.05 },
  // Dog-OLA accessible gate clear opening (estimate).
  gate: { clear: 1.5, h: 1.2 },
  // Low tilted interpretive reader on two posts (estimate).
  sign: { w: 0.9, h: 0.78, d: 0.04, postH: 0.42 },
  // Outdoor fitness equipment: the City publishes only a ZONE west of Cableway Canyon, not a machine list, so one
  // generic, source-neutral pull-up/balance station is modelled (a stand, a bar and a low step) at City-standard
  // outdoor-gym proportions (estimates); it is built as a factory and never placed from an invented point.
  fitness: { w: 1.6, h: 2.3, d: 0.6, tube: 0.05 }
};

// Existing GLBs already placed elsewhere by Open Data (js/street-props.js); the adapter skips these so the park
// furniture does not double up with the mapped street furniture.
const REUSED_ASSETS = Object.freeze(['plaza-bench', 'litter-bin', 'bike-ring', 'park-sign', 'wayfinding', 'info-pillar', 'hydrant']);

// The 2026 Waterfront Toronto news supersedes the stale City "Canoe Cove closed ... open 2026" line: the western
// section opened 2026-07-24. This module does not gate anything on that text; it is recorded so a reader of the
// layout knows the park is current.
//
// Outdoor fitness: the current City Recreation page (modified 2026-09-09) lists it west of Cableway Canyon. The
// published description is a ZONE ("west of Cableway Canyon"), not a point, so the factory is built and the zone is
// recorded as listed-unplaced; no fixture places it (see docs and CITY.biidaasigeParkCatalog fitness entry).
const WEST_OPENED = '2026-07-24';

const TAU = Math.PI * 2;
const DEDUPE_RADIUS = 1.5;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---------------------------------------------------------------------------------------------------------------
// Geometry helpers. Every factory is pure: (THREE, options) -> THREE.Group, and touches no scene or data.

function material(THREE, color, roughness = 0.85, metalness = 0.0) {
  const Mat = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
  return new Mat({ color, roughness, metalness });
}

function box(THREE, w, h, d, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y + h / 2, z);
  return g;
}

function cyl(THREE, rTop, rBottom, h, seg, x = 0, y = 0, z = 0, rotX = 0) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg);
  if (rotX) g.rotateX(rotX);
  g.translate(x, y + h / 2 * Math.cos(rotX || 0), z);
  return g;
}

// Bounding helper: a group's own extent, used by the factories' self-check and the tests.
function extentOf(THREE, group) {
  const box = new THREE.Box3();
  group.updateWorldMatrix(true, true);
  group.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    if (!g) return;
    g.computeBoundingBox();
    const b = g.boundingBox.clone().applyMatrix4(o.matrixWorld);
    box.union(b);
  });
  return box;
}

// ---------------------------------------------------------------------------------------------------------------
// FACTORIES. Each returns a THREE.Group at local origin (base y=0, footprint centred on x/z, front +z).

function buildParkBench(THREE = C?.THREE) {
  if (!THREE) throw new Error('biidaasige-amenities: THREE is required');
  const S = SIZE.bench;
  const group = new THREE.Group();
  group.name = 'BiidaasigeAmenities_Bench';
  const wood = material(THREE, 0x8a6a44, 0.9);
  const metal = material(THREE, 0x3a3f44, 0.5, 0.6);
  const legs = [
    [-(S.w / 2 - 0.18), 0, -(S.d / 2 - 0.12)], [S.w / 2 - 0.18, 0, -(S.d / 2 - 0.12)],
    [-(S.w / 2 - 0.18), 0, S.d / 2 - 0.12], [S.w / 2 - 0.18, 0, S.d / 2 - 0.12]
  ];
  for (const [x, y, z] of legs) group.add(new THREE.Mesh(box(THREE, 0.08, S.seat, 0.08, x, y, z), metal));
  group.add(new THREE.Mesh(box(THREE, S.w, 0.06, S.d - 0.24, 0, S.seat, 0), wood));
  // Backrest: from just above the seat to the recorded 0.96 m top, at the rear edge.
  group.add(new THREE.Mesh(box(THREE, S.w, S.back - S.seat, 0.06, 0, S.seat, -(S.d / 2 - 0.03)), wood));
  return group;
}

function buildBikeRack(THREE = C?.THREE) {
  if (!THREE) throw new Error('biidaasige-amenities: THREE is required');
  const S = SIZE.rack;
  const group = new THREE.Group();
  group.name = 'BiidaasigeAmenities_BikeRack';
  const metal = material(THREE, 0x3a3f44, 0.45, 0.65);
  const r = S.tube / 2;
  for (const x of [-S.w / 2, S.w / 2]) group.add(new THREE.Mesh(cyl(THREE, r, r, S.h, 8, x, 0, 0), metal));
  // The inverted-U top: a half torus whose crown reaches S.h (the torus starts at angle 0 on +x and sweeps through
  // +y): centre it at leg-top minus the radius so the crown lands on the recorded height.
  const top = new THREE.TorusGeometry(S.w / 2, r, 6, 12, Math.PI);
  top.translate(0, S.h - r - S.w / 2, 0);
  group.add(new THREE.Mesh(top, metal));
  return group;
}

function buildDrinkingFountain(THREE = C?.THREE, { dogBowl = false } = {}) {
  if (!THREE) throw new Error('biidaasige-amenities: THREE is required');
  const S = SIZE.fountain;
  const group = new THREE.Group();
  group.name = dogBowl ? 'BiidaasigeAmenities_DogFountain' : 'BiidaasigeAmenities_DrinkingFountain';
  const stone = material(THREE, 0x9aa0a6, 0.7, 0.2);
  const steel = material(THREE, 0xb8bcc1, 0.35, 0.7);
  group.add(new THREE.Mesh(box(THREE, S.w, 0.15, S.d, 0, 0, 0), stone));
  group.add(new THREE.Mesh(cyl(THREE, 0.07, 0.09, S.h - 0.15, 10), steel));
  // Bubbler top and bottle spout (the post is a drinking fountain / bottle-filling station).
  group.add(new THREE.Mesh(box(THREE, 0.08, 0.05, 0.16, 0, S.h, 0.05), steel));
  // The bottle spout hangs just under the cap so the station stays at the recorded height.
  group.add(new THREE.Mesh(cyl(THREE, 0.025, 0.025, S.spout, 6, 0, S.h - S.spout - 0.05, -0.03), steel));
  if (dogBowl) {
    // Low dog bowl at 0.25 m: a shallow cylinder on a short stub.
    group.add(new THREE.Mesh(cyl(THREE, 0.02, 0.02, S.bowl, 6, 0.22, 0.15, 0.12), steel));
    group.add(new THREE.Mesh(cyl(THREE, S.bowlR, S.bowlR * 0.75, 0.08, 12, 0.22, S.bowl, 0.12), steel));
  }
  return group;
}

function buildPicnicTable(THREE = C?.THREE) {
  if (!THREE) throw new Error('biidaasige-amenities: THREE is required');
  const S = SIZE.table;
  const group = new THREE.Group();
  group.name = 'BiidaasigeAmenities_PicnicTable';
  const wood = material(THREE, 0x9c7a4f, 0.92);
  const frame = material(THREE, 0x4a4f55, 0.55, 0.5);
  // Long permanent top in a few planks and two attached benches (bench seats at 0.45 m).
  group.add(new THREE.Mesh(box(THREE, S.w, 0.06, S.d, 0, S.h, 0), wood));
  for (const side of [-1, 1]) {
    const z = side * (S.d / 2 + S.benchInset + S.benchW / 2);
    group.add(new THREE.Mesh(box(THREE, S.w, 0.05, S.benchW, 0, S.benchH, z), wood));
  }
  // Legs and cross-frames at the ends.
  for (const x of [-S.w / 2 + 0.4, S.w / 2 - 0.4]) {
    for (const side of [-1, 1]) {
      const z = side * (S.d / 2 + S.benchInset + S.benchW / 2);
      group.add(new THREE.Mesh(box(THREE, 0.07, S.benchH, 0.07, x, 0, z), frame));
    }
    group.add(new THREE.Mesh(box(THREE, 0.07, S.h, 0.07, x, 0, 0), frame));
  }
  return group;
}

function buildBarbecue(THREE = C?.THREE) {
  if (!THREE) throw new Error('biidaasige-amenities: THREE is required');
  const S = SIZE.barbecue;
  const group = new THREE.Group();
  group.name = 'BiidaasigeAmenities_Barbecue';
  const cast = material(THREE, 0x2f3337, 0.55, 0.55);
  const grill = material(THREE, 0x6b6f74, 0.4, 0.7);
  // Circular body on a post and base.
  group.add(new THREE.Mesh(cyl(THREE, 0.18, 0.24, 0.08, 12, 0, 0, 0), cast));
  group.add(new THREE.Mesh(cyl(THREE, 0.06, 0.08, S.h - 0.1, 14), cast));
  group.add(new THREE.Mesh(cyl(THREE, S.diameter / 2, S.diameter / 2, 0.14, 28, 0, S.h - 0.07, 0), cast));
  // Three separate grills on the circular top (source-fact: three grills).
  const radius = S.diameter / 2 * 0.52, ironR = S.diameter * 0.16;
  for (let i = 0; i < S.grills; i++) {
    const a = (i / S.grills) * TAU;
    group.add(new THREE.Mesh(cyl(THREE, ironR, ironR, 0.02, 14, Math.cos(a) * radius, S.h + 0.02, Math.sin(a) * radius), grill));
  }
  return group;
}

function buildTrashBin(THREE = C?.THREE) {
  if (!THREE) throw new Error('biidaasige-amenities: THREE is required');
  const S = SIZE.bin;
  const group = new THREE.Group();
  group.name = 'BiidaasigeAmenities_Bin';
  const dark = material(THREE, 0x2b2f33, 0.7, 0.3);
  const lid = material(THREE, 0x1f2327, 0.6, 0.4);
  group.add(new THREE.Mesh(box(THREE, S.w, S.h - 0.06, S.d, 0, 0, 0), dark));
  group.add(new THREE.Mesh(box(THREE, S.w + 0.02, 0.06, S.d + 0.02, 0, S.h - 0.06, 0), lid));
  return group;
}

function buildInterpretiveSign(THREE = C?.THREE) {
  if (!THREE) throw new Error('biidaasige-amenities: THREE is required');
  const S = SIZE.sign;
  const group = new THREE.Group();
  group.name = 'BiidaasigeAmenities_Sign';
  const post = material(THREE, 0x3a3f44, 0.5, 0.55);
  const panel = material(THREE, 0x37566b, 0.7, 0.1);
  for (const x of [-S.w / 2 + 0.1, S.w / 2 - 0.1]) group.add(new THREE.Mesh(box(THREE, 0.07, S.postH, 0.07, x, 0, 0), post));
  const reader = box(THREE, S.w, S.h, S.d, 0, S.postH - 0.02, 0);
  reader.rotateX(-0.28);
  reader.translate(0, 0.14, 0.06);
  group.add(new THREE.Mesh(reader, panel));
  return group;
}

// Outdoor fitness station: a generic pull-up / balance stand (the City publishes a zone, not a machine list). Two
// posts, a top bar at 2.3 m and a low balance step; proportions are estimates, geometry is source-neutral.
function buildFitnessStation(THREE = C?.THREE) {
  if (!THREE) throw new Error('biidaasige-amenities: THREE is required');
  const S = SIZE.fitness;
  const group = new THREE.Group();
  group.name = 'BiidaasigeAmenities_FitnessStation';
  const steel = material(THREE, 0x8f959b, 0.4, 0.65);
  const r = S.tube / 2;
  for (const x of [-S.w / 2, S.w / 2]) group.add(new THREE.Mesh(cyl(THREE, r, r, S.h - r, 10, x, 0, 0), steel));
  const bar = new THREE.CylinderGeometry(r, r, S.w, 10);
  bar.rotateZ(Math.PI / 2);
  bar.translate(0, S.h - r, 0);
  group.add(new THREE.Mesh(bar, steel));
  // A low balance step (a beam at 0.4 m on two short posts) in front.
  const beam = box(THREE, S.w * 0.9, 0.06, 0.12, 0, 0.4, S.d / 2);
  group.add(new THREE.Mesh(beam, steel));
  return group;
}

// A dog off-leash area's PARTS, built at a LOCAL origin: the ring is re-centred on its centroid, so no vertex carries a
// million-unit world coordinate, and the returned group is positioned once by the caller. Given a verified boundary
// ring and the verified gate points (from the fixture/inventory), it builds:
//   - the turf as ONE triangulated polygon (concave-safe, THREE.ShapeUtils.triangulateShape; not perimeter boxes);
//   - the perimeter fence merged per material (ONE posts mesh, ONE pickets mesh, ONE rails mesh: 3 draw calls, not one
//     box per picket), split at the gate openings;
//   - a swing leaf at each verified gate.
// The fence is only built when at least one verified gate exists: an unbroken fence would seal the park with no entry,
// so with no verified gate the caller places no perimeter fence at all (that is the honest bound, not a midline guess).
function buildDogOla(THREE = C?.THREE, ring, gates = [], { areaM2 = null } = {}) {
  if (!THREE) throw new Error('biidaasige-amenities: THREE is required');
  if (!Array.isArray(ring) || ring.length < 6) throw new Error('biidaasige-amenities: buildDogOla needs a verified boundary ring');
  const S = SIZE.fence, G = SIZE.gate;
  const pts = [];
  if (Array.isArray(ring[0])) for (const p of ring) { if (p && isNum(p[0]) && isNum(p[1])) pts.push([p[0], p[1]]); }
  else for (let i = 0; i + 1 < ring.length; i += 2) pts.push([ring[i], ring[i + 1]]);
  // local origin: the ring's centroid (world coords stay tiny, the group is placed once by the adapter)
  let cx = 0, cz = 0;
  for (const [x, z] of pts) { cx += x; cz += z; }
  cx /= pts.length; cz /= pts.length;
  const local = pts.map(([x, z]) => [x - cx, z - cz]);
  const group = new THREE.Group();
  group.name = 'BiidaasigeAmenities_DogOla';
  const localGates = gates.map(([gx, gz]) => [gx - cx, gz - cz]);

  // Turf: one triangulated polygon, wound up. Concave rings (both OSM dog rings are) are handled by the triangulator, so
  // no triangle spills outside the mapped outline the way a fan would.
  const turfGeo = ringPolygonGeometry(THREE, local, 0.02);
  if (turfGeo) {
    const turf = new THREE.Mesh(turfGeo, material(THREE, 0x3f7d3a, 0.95));
    turf.name = 'BiidaasigeAmenities_DogOla_Turf';
    group.add(turf);
  }

  // Fence, only if there is a verified way in.
  let fencePosts = 0, fenceMeshes = 0;
  if (localGates.length) {
    const posts = [], pickets = [], rails = [];
    for (let i = 0; i < local.length; i++) {
      const [ax, az] = local[i], [bx, bz] = local[(i + 1) % local.length];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.1) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len, yaw = Math.atan2(ux, uz);
      const inGate = (t) => localGates.some(([gx, gz]) => Math.hypot(ax + ux * t - gx, az + uz * t - gz) < G.clear / 2);
      for (let t = 0; t <= len; t += S.post) {
        if (inGate(t)) continue;
        const g = box(THREE, 0.06, S.h, 0.06, 0, 0, 0); g.rotateY(yaw); g.translate(ax + ux * t, 0, az + uz * t);
        posts.push(g); fencePosts++;
      }
      for (let t = 0; t <= len; t += S.picket) {
        if (inGate(t)) continue;
        const g = box(THREE, 0.03, S.h - 0.1, 0.03, 0, 0, 0); g.rotateY(yaw); g.translate(ax + ux * t, 0, az + uz * t);
        pickets.push(g);
      }
      const cuts = localGates.map(([gx, gz]) => {
        const t = (gx - ax) * ux + (gz - az) * uz;
        return (t > 0 && t < len) ? [Math.max(0, t - G.clear / 2), Math.min(len, t + G.clear / 2)] : null;
      }).filter(Boolean).sort((a, b) => a[0] - b[0]);
      let cursor = 0;
      const addRail = (t0, t1) => {
        const L = t1 - t0;
        if (L < 0.05) return;
        const rail = box(THREE, 0.04, 0.04, L, 0, 0, 0);
        rail.rotateY(yaw); rail.translate(ax + ux * (t0 + L / 2), S.h - 0.04, az + uz * (t0 + L / 2));
        rails.push(rail);
      };
      for (const [a, b] of cuts) { if (a > cursor) addRail(cursor, a); cursor = Math.max(cursor, b); }
      if (cursor < len) addRail(cursor, len);
    }
    // Merge each material's many small parts into a single geometry: 3 draw calls for the whole perimeter.
    const mat = material(THREE, 0x34383c, 0.6, 0.5);
    const merge = C?.Addons?.mergeGeometries;
    const mergeParts = (geos) => {
      if (!geos.length) return null;
      if (geos.length === 1) return geos[0];
      return merge ? merge(geos, false) : geos[0];
    };
    for (const [name, geos] of [['Posts', posts], ['Pickets', pickets], ['Rails', rails]]) {
      const g = mergeParts(geos);
      if (!g) continue;
      g.computeBoundingBox(); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.name = `BiidaasigeAmenities_DogOla_${name}`;
      group.add(m); fenceMeshes++;
    }
  }

  // Gate leaves at each verified gate point (world coords are only the leaf's own placement, so re-centre them too).
  const gateMeshes = [];
  for (const [gx, gz] of localGates) {
    const leaf = box(THREE, G.clear, G.h - 0.1, 0.04, 0, 0.05, 0);
    leaf.translate(gx, 0, gz);
    const gm = new THREE.Mesh(leaf, material(THREE, 0x8a8f94, 0.45, 0.6));
    gm.name = 'BiidaasigeAmenities_DogOla_Gate';
    group.add(gm); gateMeshes.push(gm);
  }
  group.position.set(cx, 0, cz);
  group.userData.dogOla = { areaM2, fencePosts, fenceMeshes, gates: localGates.length, ringPoints: local.length, openEntry: localGates.length === 0, origin: [cx, cz] };
  return group;
}

// A simple ring as ONE upward-facing triangulated geometry (concave-safe), re-centred by the caller. The +Y of
// (b-a)x(c-a) must be positive, or the top is back-face culled and the surface vanishes (waterfront-beach-ground.js).
function ringPolygonGeometry(THREE, ring, y = 0) {
  if (ring.length < 3) return null;
  const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
  let faces;
  try { faces = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { faces = null; }
  if (!faces || !faces.length) return null;
  const pos = [];
  for (const [i, j, k] of faces) {
    const a = ring[i], b = ring[j], c = ring[k];
    const up = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    const order = up >= 0 ? [a, b, c] : [a, c, b];
    for (const p of order) pos.push(p[0], y, p[1]);
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const n = new Float32Array((pos.length / 3) * 3);
  for (let i = 1; i < n.length; i += 3) n[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  g.computeBoundingBox();
  return g;
}

// ---------------------------------------------------------------------------------------------------------------
// The layout adapter. Reads ONLY the current Biidaasige inventory API (js/biidaasige-park-data.js) and the City Open
// Data water stations; never a guessed rectangle, never an invented point.

// The City's real water stations in Biidaasige Park (projected already in js/toronto-city-facilities.js).
function parkWaterStations() {
  const records = C?.CITY_FACILITIES?.records || [];
  return records.filter((r) => r && r.kind === 'water' && r.parentName === 'Biidaasige Park' && isNum(r.x) && isNum(r.z));
}

// The current inventory's verified features (OSM-placed only, by default).
function inventoryFeatures() {
  if (typeof C?.biidaasigeParkFeatures !== 'function') return null;
  try { return C.biidaasigeParkFeatures(); } catch (e) { return null; }
}

const groundY = (x = 0, z = 0) => (C?.CITY_BOUNDS?.sidewalkHeight ?? 0.22) + 0.004 + (C?.cutAt ? (C.cutAt(x, z) || 0) : 0);

// A shared geometry merged ONCE per material from a factory, so every instance of a kind costs one draw call per
// material (not one per box). The merge is what the review asked for ("bounded merged geometry material counts, not 30
// draw calls per bench").
function mergeFactory(THREE, factory, { keepInstances = true } = {}) {
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
  return { group, parts, materialCount: parts.length, keepInstances };
}

// One InstancedMesh per merged part, real bounds, cull metadata. Returns the meshes it made.
function instanceParts(THREE, parts, sites, name, { cullDistance = 400, cullCell = 60, castShadow = true } = {}) {
  const meshes = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  for (const { geometry, material: mat } of parts) {
    if (!sites.length) continue;
    const mesh = new THREE.InstancedMesh(geometry, mat, sites.length);
    mesh.name = `${name}`;
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

// Footprints (half extents + height) read from the merged geometry itself, not a mirrored constant, so a collider lines
// up with the model even if a size changes.
function footprintOf(parts) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = -Infinity, minY = Infinity;
  for (const { geometry } of parts) {
    const b = geometry.boundingBox || (geometry.computeBoundingBox(), geometry.boundingBox);
    if (!b) continue;
    minX = Math.min(minX, b.min.x); maxX = Math.max(maxX, b.max.x);
    minZ = Math.min(minZ, b.min.z); maxZ = Math.max(maxZ, b.max.z);
    minY = Math.min(minY, b.min.y); maxY = Math.max(maxY, b.max.y);
  }
  if (!Number.isFinite(minX)) return null;
  return { hx: (maxX - minX) / 2, hz: (maxZ - minZ) / 2, top: maxY - Math.min(0, minY), base: minY };
}

// The dedupe contract, exported so a test and a reviewer can check it: which source points this layer is allowed to
// render, given what other layers already render.
function dedupe({ waterStations = [], features = [], renderedWaterIds = new Set(), skipAssets = [] } = {}) {
  const skip = new Set(skipAssets);
  // water: render a station only if no other layer already renders that City station record id
  const keepWater = waterStations.filter((r) => !renderedWaterIds.has(r.id));
  // furniture: only OSM-mapped kinds, and never a shared GLB the caller asked us to skip
  const furnitureKinds = { bench: 'benches', 'occasional-bench': 'benches', 'picnic-table': 'picnicTables', bbq: 'barbecues', bin: 'bins', 'waste-basket': 'bins', drinking_water: 'fountains' };
  const keep = features.filter((f) => f && f.placement && /^osm/.test(f.placement) && isNum(f.lat) && isNum(f.lon) && furnitureKinds[f.kind]);
  return { waterStations: keepWater, features: keep, skip, furnitureKinds };
}

function buildBiidaasigeAmenities(scene = null, allColliders = null, opts = {}) {
  const THREE = C?.THREE;
  if (!THREE) return null;
  const { skipAssets = [], renderedSites = [] } = opts;
  // Spatial dedupe: the captain integrates this AFTER js/street-props.js and passes the already-rendered sites as
  // { x, z, kind }. A mapped OSM bench/bin/water point within ~1.5 m of an already-rendered site OF THE SAME KIND is
  // skipped, so the park furniture never double-stacks a native/street-prop bench, bin or fountain.
  const DEDUPE_R = DEDUPE_RADIUS;
  const renderedByKind = new Map();
  for (const s of renderedSites) {
    if (!s || !isNum(s.x) || !isNum(s.z) || !s.kind) continue;
    if (!renderedByKind.has(s.kind)) renderedByKind.set(s.kind, []);
    renderedByKind.get(s.kind).push(s);
  }
  const alreadyRendered = (kind, x, z) => {
    const list = renderedByKind.get(kind);
    if (!list) return false;
    for (const s of list) if (Math.hypot(s.x - x, s.z - z) <= DEDUPE_R) return true;
    return false;
  };
  const group = new THREE.Group();
  group.name = 'BiidaasigeAmenities';
  const colliders = [];
  const stats = { counts: {}, colliders: 0, meshes: 0, materials: {}, unplaced: [], skipped: [], source: {}, westOpened: WEST_OPENED, projected: false };
  const sink = (arr) => { if (Array.isArray(allColliders)) allColliders.push(...arr); };
  if (typeof C?.worldFromLatLon !== 'function') { if (C) C.biidaasigeAmenities = { group, colliders, stats }; return { group, colliders, stats }; }
  stats.projected = true;

  // The inventory API (st-bmyv.1). Absent -> the adapter still builds the City water stations, nothing invented.
  const features = inventoryFeatures();
  const KIND_PLACEHOLDER = { fountains: 0, dogFountains: 0, benches: 0, picnicTables: 0, barbecues: 0, bins: 0, bikeRacks: 0, signs: 0, mappedDogOlas: 0 };
  const water = dedupe({ waterStations: parkWaterStations(), renderedWaterIds: new Set(opts.renderedWaterIds || []), skipAssets }).waterStations;
  for (const k of Object.keys(KIND_PLACEHOLDER)) stats.counts[k] = 0;
  stats.source.waterStations = parkWaterStations().length;
  stats.source.verifiedFeatures = features ? features.length : 0;

  // 1. Drinking / dog fountains at the real City points, merged once per material and instanced once per group.
  if (water.length) {
    const dogRecs = water.filter((r) => /dog fountain/i.test(r.type || ''));
    const plainRecs = water.filter((r) => !/dog fountain/i.test(r.type || ''));
    const y = groundY();
    const placeWater = (recs, factory, kindName) => {
      if (!recs.length) return;
      const merged = mergeFactory(THREE, factory);
      const kept = recs.filter((r) => !alreadyRendered('fountain', r.x, r.z));
      if (!kept.length) return;
      const sites = kept.slice().sort((a, b) => String(a.id).localeCompare(String(b.id))).map((r) => ({ x: r.x, z: r.z, y: groundY(r.x, r.z), yaw: 0 }));
      const meshes = instanceParts(THREE, merged.parts, sites, `BiidaasigeAmenities_${kindName}`, { cullDistance: 300, cullCell: 40 });
      for (const mesh of meshes) { group.add(mesh); stats.meshes++; }
      const fp = footprintOf(merged.parts) || { hx: SIZE.fountain.w / 2, hz: SIZE.fountain.d / 2, top: SIZE.fountain.h };
      stats.materials[kindName] = merged.materialCount;
      for (const r of kept) {
        colliders.push({ minX: r.x - fp.hx, maxX: r.x + fp.hx, minZ: r.z - fp.hz, maxZ: r.z + fp.hz, minY: groundY(r.x, r.z), maxY: groundY(r.x, r.z) + fp.top, prop: true, kind: /dog fountain/i.test(r.type || '') ? 'dogFountain' : 'fountain', openData: true, assetId: r.assetId });
      }
    };
    placeWater(plainRecs, () => buildDrinkingFountain(THREE, { dogBowl: false }), 'fountain');
    placeWater(dogRecs, () => buildDrinkingFountain(THREE, { dogBowl: true }), 'dogFountain');
    stats.counts.fountains = colliders.filter((c) => c.kind === 'fountain').length;
    stats.counts.dogFountains = colliders.filter((c) => c.kind === 'dogFountain').length;
  } else stats.unplaced.push('waterStations');

  // 2. OSM-mapped park furniture, merged and instanced per kind. The shared GLB types are never re-instanced here.
  // Only kinds the current inventory maps as OSM points (bench, picnic_table, bbq, bin/waste_basket, drinking_water).
  // bikeRacks / signs / fitness have factories but no mapped point in the inventory, so they are never placed from a
  // guessed spot; they stay reusable factories and are recorded unplaced.
  const FACTORY = {
    benches: () => buildParkBench(THREE),
    picnicTables: () => buildPicnicTable(THREE),
    barbecues: () => buildBarbecue(THREE),
    bins: () => buildTrashBin(THREE)
  };
  // The REAL data kinds (js/biidaasige-park-data.js). picnic-table is hyphenated in the inventory; the underscore
  // spelling the first pass used silently skipped all 18 tables. Every alias here is tested against real data.
  const KIND_OF = { bench: 'benches', 'occasional-bench': 'benches', 'picnic-table': 'picnicTables', bbq: 'barbecues', bin: 'bins', 'waste-basket': 'bins', drinking_water: 'fountains' };
  if (features) {
    const byKind = new Map();
    for (const f of features) {
      const kind = KIND_OF[f.kind];
      if (!kind || kind === 'fountains') continue; // water is handled above from the City source
      if (skipAssets.includes(kind)) { stats.skipped.push(kind); continue; }
      const w = C.biidaasigeParkWorld(f.id);
      if (!w) continue;
      // spatial dedupe against already-rendered same-kind sites (benches/bins/water)
      if (alreadyRendered(kind, w.x, w.z)) continue;
      if (!byKind.has(kind)) byKind.set(kind, []);
      byKind.get(kind).push({ id: f.id, x: w.x, z: w.z, yaw: isNum(f.orientationDeg) ? f.orientationDeg * Math.PI / 180 : 0 });
    }
    for (const [kind, sites] of byKind) {
      const factory = FACTORY[kind];
      if (!factory) { stats.unplaced.push(kind); continue; }
      const merged = mergeFactory(THREE, factory);
      const meshes = instanceParts(THREE, merged.parts, sites.map((s) => ({ x: s.x, z: s.z, y: groundY(s.x, s.z), yaw: s.yaw })), `BiidaasigeAmenities_${kind}`, { cullDistance: 400, cullCell: 60 });
      for (const mesh of meshes) { group.add(mesh); stats.meshes++; }
      stats.materials[kind] = (stats.materials[kind] || 0) + merged.materialCount;
      const fp = footprintOf(merged.parts);
      if (fp) for (const s of sites) {
        const cs = Math.cos(s.yaw), sn = Math.sin(s.yaw), y0 = groundY(s.x, s.z);
        const ex = Math.abs(cs) * fp.hx + Math.abs(sn) * fp.hz, ez = Math.abs(sn) * fp.hx + Math.abs(cs) * fp.hz;
        colliders.push({ minX: s.x - ex, maxX: s.x + ex, minZ: s.z - ez, maxZ: s.z + ez, minY: y0, maxY: y0 + fp.top, prop: true, kind, source: 'osm', featureId: s.id });
      }
      stats.counts[kind] = sites.length;
    }
    // 3. The two dog off-leash areas: the VERIFIED OSM rings only (never the 800/1200 m² rectangles), with parts.
    const olas = features.filter((f) => f.kind === 'dog-park');
    if (!olas.length) stats.unplaced.push('dogOlas');
    for (const f of olas) {
      if (opts.skipDogAreaIds?.includes(f.id)) {
        stats.unplaced.push(`dogOlaFenceAndGates:${f.id} (surface delegated; gates not mapped)`);
        continue;
      }
      const ring = typeof C.biidaasigeParkRingWorld === 'function' ? C.biidaasigeParkRingWorld(f.id) : null;
      if (!ring || ring.length < 3) { stats.unplaced.push(`dogOla:${f.id}`); continue; }
      const flat = [];
      for (const p of ring) flat.push(p.x, p.z);
      const areaM2 = (f.areaM2 != null) ? f.areaM2 : null;
      const g = buildDogOla(THREE, flat, [], { areaM2 });
      g.position.y = groundY(g.position.x,g.position.z);
      group.add(g); stats.meshes += g.children.length;
      // The turf is a traversable ground overlay. With no source-verified gate there
      // is no rendered fence and consequently no perimeter or interior collider.
      stats.unplaced.push(`dogOlaFenceAndGates:${f.id} (gate geometry not mapped)`);
      stats.counts.mappedDogOlas = (stats.counts.mappedDogOlas || 0) + 1;
    }
  } else {
    stats.unplaced.push('benches', 'picnicTables', 'barbecues', 'bins', 'bikeRacks', 'signs', 'fitness', 'dogOlas');
  }
  // Outdoor fitness is officially LISTED but has no published point: recorded as listed-unplaced, never placed.
  stats.unplaced.push('outdoorFitness (listed west of Cableway Canyon; no published point)');

  stats.colliders = colliders.length;
  group.userData.biidaasigeAmenities = stats;
  if (scene && scene.add) scene.add(group);
  sink(colliders);
  if (C) {
    C.biidaasigeAmenities = { group, colliders, stats };
    C.biidaasigeAmenitiesDedupe = dedupe;
  }
  if (water.length || stats.meshes) console.info(`[biidaasigeAmenities] ${stats.counts.fountains || 0} drinking fountains, ${stats.counts.dogFountains || 0} dog fountains, ${stats.meshes} meshes, ${stats.colliders} colliders; unplaced: ${stats.unplaced.join(', ') || 'none'}`);
  return { group, colliders, stats };
}

if (C) {
  Object.assign(C, {
    BIIDAASIGE_AMENITY_SIZES: SIZE,
    BIIDAASIGE_AMENITY_REUSED_ASSETS: REUSED_ASSETS,
    BIIDAASIGE_AMENITY_DEDUPE_RADIUS: DEDUPE_RADIUS,
    buildBiidaasigeAmenities,
    biidaasigeAmenityFactories: {
      buildParkBench, buildBikeRack, buildDrinkingFountain, buildPicnicTable, buildBarbecue, buildTrashBin,
      buildInterpretiveSign, buildFitnessStation, buildDogOla,
      parkWaterStations, inventoryFeatures, footprintOf, dedupe,
      flatten: (T, factory) => mergeFactory(T, factory).parts
    },
    biidaasigeAmenityDedupe: dedupe
  });
}
})();
