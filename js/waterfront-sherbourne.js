(function () {
// js/waterfront-sherbourne.js
// Sherbourne Common, East Bayfront (Lower Sherbourne St, both sides of Queens Quay East; 1.47 ha, Lake Ontario north to
// Lake Shore Blvd). The first park in Canada to integrate a neighbourhood-wide stormwater treatment facility: rain is
// cleaned in the UV plant and released from three art sculptures into a 240 m water channel that runs north to south out
// to the lake. Designed by PFS Studio; the zinc-clad Pavilion (Teeple Architects) holds the UV facility.
//
// This pass adds ONLY the two source-georeferenced public-art features that are missing from the city's massing, and
// deliberately does not duplicate what already exists. The silhouettes follow the coordinator's inspection of the
// official photos (research/light-showers.jpg, research/unfinished-arch.jpg):
//
//   - 'Light Showers' by Jill Anholt — THREE sculptural elements, 8.9 m at the top, on the NORTH side, equally spaced
//     apart. Each is NOT an upright glass rectangle: it is a squared-shepherd-hook pair of broad leaning cantilever
//     arms. A wide CONCRETE leg leans across the channel and bends into a long horizontal raised beam whose top is
//     8.9 m; a second, lower, rounded METAL-CLAD leg bends into a horizontal spout beam at ~6 m. Thin vertical
//     suspension cables hang from the upper beam down to the lower beam, and a broad vertical WATER curtain falls from
//     the lower beam into the raised pool (no opaque panel to the ground). The base sits on the SIDE of the long raised
//     pool, not mid-channel: at the channel's west edge (derived per node from the mapped water polygon; the mapped POI
//     node centres the art, not the leg base, so the offset is recorded). The photo shows the motif repeating along the
//     channel; the three stand at the two mapped OSM nodes and their equal-spacing midpoint.
//
//   - 'Unfinished Arch' by Rafael Lozano-Hemmer (Antimodular), opened 1 June 2026 — a SILVER reflective broad flat
//     RIBBON (~2 m wide, ~0.4 m thick), not a square tube. One vertical foot rises, curves round the apex, and leans
//     down to a free tip; the main free edge is ~2.4 m above the ground (an adult reaches overhead), with a narrower
//     hanging touch piece (~1.8 m) under it. It cantilevers over 14 m at 9 m high from a SINGLE ground point in the
//     southeast lawn of the south park, just north of the Water's Edge Promenade and west of the eastern path/buildings
//     (construction notice #4). The 38 x 30 m red box on the site plan is the construction fence, not the footprint.
//
// Sources (retrieved 2026-11-09):
// - Waterfront Toronto, Sherbourne Common (1.47 ha; stormwater; 240 m channel; rink 920 m²; zinc Pavilion; three ~9 m
//   sculptures; 182 trees; five flush channel crossings): https://www.waterfrontoronto.ca/our-projects/sherbourne-common
// - Waterfront Toronto, Sherbourne Common Fact Sheet (THREE sculptural elements standing 8.9 m tall; north side, equally
//   spaced; 238.5 m channel; crossings A-E; pavilion at the 200 mm narrowest):
//   https://www.waterfrontoronto.ca/sites/default/files/documents/sherbourne-common-fact-sheet-1.pdf
// - Jill Anholt Studio, Light Showers (metal curtains; water drawn up and cascading; illuminated):
//   https://www.jillanholt.ca/Light-Showers
// - Waterfront Toronto, Unfinished Arch opens (1 June 2026):
//   https://www.waterfrontoronto.ca/news/incomplete-design-rafael-lozano-hemmers-unfinished-arch-opens-at-sherbourne-common
// - Waterfront Toronto, Construction Notice #4: Unfinished Arch (9 m high, 14 m cantilever, southeast corner of the south
//   park, adjacent to the Water's Edge Promenade, single-point ground contact):
//   https://www.waterfrontoronto.ca/construction-notice-4-unfinished-arch-sherbourne-common
// - Coordinator photo inspection: 'Light Showers' https://www.waterfrontoronto.ca/sites/default/files/2023-08/DSC_5872-sherbourne-common_0.jpg
//   and 'Unfinished Arch' https://www.waterfrontoronto.ca/sites/default/files/2026-06/Unfinished%20Arch%20-%20Media%20Launch%20-%20June%201%2C%202026-1280.jpg,
//   and the site plan https://www.waterfrontoronto.ca/sites/default/files/2026-01/Unfinished%20Arch%20Site%20Map%20V2_1280.png
//   (saved under research/). The profile proportions are estimates read from those photos and marked out.
// - OSM: two mapped 'Light Showers' nodes (node/3049761651 at world (1205.7, 335.3) and a second at (1191.5, 246.9));
//   the park rings and channel water polygons are the loaded City geodata (OpenStreetMap contributors, ODbL).
//
// NOT built here (already present or not mapped), verified before adding:
//   - the Paul Quarrington rink / splash pad: already modelled by js/toronto-rinks.js (City asset 43569).
//   - the 240 m water channel: already in the geodata as water polygons and covered by CITY.waterAt; no fake pit is cut.
//   - the zinc Pavilion: no mapped building exists in the park rings, so it is not invented.
//
// Geometry conventions: 1 unit = 1 m, world x is grid east, z grid south, ground y = 0, the lake at SETTING.waterLevel.
// The park rings come from the loaded geodata filtered by NAME (never by array index). Call
// createWaterfrontSherbourne(THREE, scene); it returns { group, colliders, stats }, builds only when the active frame
// covers the park, is deterministic, and every instance matrix is finite. One culling root, repeated parts instanced.

const C = window.CITY;
const SETTING = C?.CITY_BOUNDS || {};
const GROUND = 0;
const WATER = SETTING.waterLevel ?? -0.7;

const finite = (...v) => v.every((n) => Number.isFinite(n));

// --------------------------------------------------------------------------------------------------------------------
// Source anchors. The park rings are found by name; the Light Showers positions are the two mapped nodes plus their
// equal-spacing midpoint; each base is the channel's west edge at that node (derived from the mapped water polygon). The
// arch base is the documented southeast lawn of the south park, an estimate on dry land (no survey claim).
// --------------------------------------------------------------------------------------------------------------------
const LIGHT_SHOWERS = {
  height: 8.9,          // fact sheet "almost nine metres" = the top of the upper beam
  upperBeamTop: 8.9,
  lowerBeamTop: 6.0,    // the lower spout beam (~6 m), from the photo
  nodes: [
    { x: 1205.7, z: 335.3, osm: '3049761651', source: 'OSM node/3049761651 (Light Showers)' },
    { x: 1191.5, z: 246.9, osm: null, source: 'OSM Light Showers node (second mapped element)' }
  ],
  note: 'Three elements, north side, equally spaced apart (fact sheet); two individually mapped, the third at their equal-spacing midpoint.'
};

// Estimated cross-sections and profile, read from the coordinator-marked photos (metres).
const SHOWER_PROFILE = {
  upperThickness: 0.9, upperWidth: 1.3, upperReach: 4.6, upperLegLean: 0.7, // broad concrete arm, top 8.9 m
  lowerThickness: 0.7, lowerWidth: 1.1, lowerReach: 4.0, lowerLegLean: 0.5, // rounded metal-clad arm, beam top ~6 m
  cableRadius: 0.06, cables: 3,
  curtainWidth: 1.1, curtainThickness: 0.1,
  poolSurface: 0.4, // the raised pool water surface (estimate); the water curtain falls into it
  baseInsetFromWestEdge: 0.4 // the leg base sits just on the deck side of the channel's west edge
};

const UNFINISHED_ARCH = {
  height: 9.0,        // construction notice (apex)
  cantilever: 14.0,   // construction notice (horizontal reach to the free tip)
  ribbonWidth: 2.0,   // photo (broad flat silver ribbon)
  ribbonThickness: 0.4,
  freeEdgeHeight: 2.4, // photo: the main free edge an adult reaches overhead
  touchPieceHeight: 1.8, // photo: a narrower hanging touch piece under the free edge
  base: { x: 1246, z: 522 }, // southeast lawn, north of the promenade, west of the eastern path (estimate)
  note: 'Single-point ground contact; a 9 m-high incomplete ribbon arch cantilevering 14 m (construction notice #4).'
};

// What already exists (asserted off in the tests): this module builds none of these.
const EXISTING = {
  rink: { id: 'city-rink:43569', modelledBy: 'js/toronto-rinks.js', note: 'Paul Quarrington rink/splash pad' },
  channel: { note: '240 m channel water is in the geodata and CITY.waterAt; no pit cut here' },
  pavilion: { mapped: false, note: 'no zinc Pavilion building is mapped; not invented' }
};

// --------------------------------------------------------------------------------------------------------------------
// Small pure geometry helpers
// --------------------------------------------------------------------------------------------------------------------
function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// A uniform Catmull-Rom spline through 2D control points, sampled per span (for the smooth profile curves).
function catmullRom2D(ctrl, per = 4) {
  const P = ctrl;
  const at = (i) => P[Math.max(0, Math.min(P.length - 1, i))];
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let s = 0; s < per; s++) {
      const t = s / per, t2 = t * t, t3 = t2 * t;
      const x = 0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const y = 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      out.push([x, y]);
    }
  }
  out.push(P[P.length - 1]);
  return out;
}

// --------------------------------------------------------------------------------------------------------------------
// Park rings, found by name from the loaded geodata (never by index). Sherbourne Common is two polygons: the north park
// (lower z) and the south park (higher z), each side of Queens Quay.
// --------------------------------------------------------------------------------------------------------------------
function sherbourneParks() {
  const rings = [];
  for (const a of C?.GEO?.areas || []) {
    if (a[0] !== 'park' || a[1] !== 'Sherbourne Common') continue;
    const flat = a[2];
    if (!Array.isArray(flat) || flat.length < 6) continue;
    const ring = [];
    let cx = 0, cz = 0;
    for (let i = 0; i < flat.length; i += 2) { ring.push([flat[i], flat[i + 1]]); cx += flat[i]; cz += flat[i + 1]; }
    cx /= ring.length; cz /= ring.length;
    rings.push({ ring, cx, cz });
  }
  if (rings.length < 2) return null;
  rings.sort((p, q) => p.cz - q.cz);
  return { north: rings[0], south: rings[rings.length - 1] };
}

// The water polygon that contains a point, as a ring (or null).
function channelRingAt(x, z) {
  for (const a of C?.GEO?.areas || []) {
    if (a[0] !== 'water') continue;
    const flat = a[2];
    if (!Array.isArray(flat) || flat.length < 6) continue;
    const ring = [];
    for (let i = 0; i < flat.length; i += 2) ring.push([flat[i], flat[i + 1]]);
    if (pointInRing(ring, x, z)) return ring;
  }
  return null;
}

// The west-edge x of a ring at a given z (the westernmost edge crossing that z).
function westEdgeX(ring, z) {
  let west = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, z0] = ring[i], [x1, z1] = ring[j];
    if ((z0 > z) !== (z1 > z)) {
      const x = x0 + (x1 - x0) * (z - z0) / (z1 - z0);
      if (x < west) west = x;
    }
  }
  return west;
}

// --------------------------------------------------------------------------------------------------------------------
// Light Showers: the two mapped nodes plus the equal-spacing midpoint; each base at the channel's west edge (the leg
// stands on the SIDE of the raised pool, not mid-water), arms leaning east across the channel.
// --------------------------------------------------------------------------------------------------------------------
function lightShowersPositions() {
  const parks = sherbourneParks();
  if (!parks) return null;
  const [a, b] = LIGHT_SHOWERS.nodes;
  const raw = [
    { ...a, id: 'lightShowersA' },
    { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, osm: null, id: 'lightShowersB', source: 'equal-spacing midpoint of the two mapped nodes' },
    { ...b, id: 'lightShowersC' }
  ];
  const pts = raw.map((p) => {
    const ring = channelRingAt(p.x, p.z);
    if (!ring) return null;
    const west = westEdgeX(ring, p.z);
    const base = { x: west - SHOWER_PROFILE.baseInsetFromWestEdge, z: p.z };
    return { id: p.id, node: { x: p.x, z: p.z }, base, offsetWest: p.x - base.x, osm: p.osm, source: p.source };
  });
  if (pts.some((p) => !p) || !pts.every((p) => pointInRing(parks.north.ring, p.node.x, p.node.z))) return null;
  return pts;
}

function lightShowerSpacing() {
  const pts = lightShowersPositions();
  if (!pts) return null;
  return {
    ab: Math.hypot(pts[0].node.x - pts[1].node.x, pts[0].node.z - pts[1].node.z),
    bc: Math.hypot(pts[1].node.x - pts[2].node.x, pts[1].node.z - pts[2].node.z)
  };
}

// The upper (concrete) arm centreline: a leaning leg bending into a horizontal beam whose top is 8.9 m.
function showerUpperProfile() {
  const P = SHOWER_PROFILE;
  const beamY = LIGHT_SHOWERS.upperBeamTop - P.upperThickness / 2;
  return [[0, 0], [P.upperLegLean, beamY], [P.upperReach, beamY]];
}
// The lower (rounded metal-clad) arm centreline: a leaning leg, a rounded bend, and a horizontal spout beam at ~6 m.
function showerLowerProfile() {
  const P = SHOWER_PROFILE;
  const beamY = LIGHT_SHOWERS.lowerBeamTop - P.lowerThickness / 2;
  const ctrl = [
    [0, 0], [P.lowerLegLean, 4.2], [P.lowerLegLean + 0.45, 5.25], [P.lowerLegLean + 1.2, 5.6], [P.lowerReach, beamY]
  ];
  return catmullRom2D(ctrl, 4);
}

// --------------------------------------------------------------------------------------------------------------------
// Unfinished Arch: a smooth vertical ribbon arc from a single foot, apex ~9 m, descending to a free tip whose main edge
// is ~2.4 m (reachable), with a narrower hanging touch piece ~1.8 m under it. Horizontal reach 14 m.
// --------------------------------------------------------------------------------------------------------------------
function archProfile(steps = 18) {
  const ctrl = [[0, 0], [1.5, 5.0], [5.5, UNFINISHED_ARCH.height], [9.5, 6.2], [UNFINISHED_ARCH.cantilever, UNFINISHED_ARCH.freeEdgeHeight]];
  const prof = catmullRom2D(ctrl, Math.max(1, Math.round(steps / (ctrl.length - 1))));
  // guarantee a single ground contact: nothing at or below ground except the foot
  for (let i = 2; i < prof.length; i++) if (prof[i][1] <= 0) prof[i][1] = 0.1;
  return prof;
}

function archSpec() {
  const base = UNFINISHED_ARCH.base;
  const parks = sherbourneParks();
  if (!parks || !pointInRing(parks.south.ring, base.x, base.z)) return null;
  let cx = 0, cz = 0;
  for (const [x, z] of parks.south.ring) { cx += x; cz += z; }
  cx /= parks.south.ring.length; cz /= parks.south.ring.length;
  let hx = cx - base.x, hz = cz - base.z;
  const len = Math.hypot(hx, hz) || 1;
  hx /= len; hz /= len;
  const prof = archProfile(18);
  const pts = prof.map(([u, y]) => ({ x: base.x + hx * u, y: GROUND + y, z: base.z + hz * u, u, y2: y }));
  const apex = pts.reduce((m, p) => (p.y > m.y ? p : m), pts[0]);
  return {
    base: { x: base.x, z: base.z }, bearing: [hx, hz], points: pts,
    tip: pts[pts.length - 1], apex: { x: apex.x, y: apex.y, z: apex.z },
    height: UNFINISHED_ARCH.height, cantilever: UNFINISHED_ARCH.cantilever,
    ribbonWidth: UNFINISHED_ARCH.ribbonWidth, ribbonThickness: UNFINISHED_ARCH.ribbonThickness,
    touchPieceHeight: UNFINISHED_ARCH.touchPieceHeight, note: UNFINISHED_ARCH.note
  };
}

// Back-compat alias used by earlier tests.
function archArcPoints(steps = 18) {
  const spec = archSpec();
  if (!spec) return null;
  void steps;
  return { points: spec.points, base: spec.base, tip: spec.tip, height: spec.height, cantilever: spec.cantilever, bearing: spec.bearing };
}

// --------------------------------------------------------------------------------------------------------------------
// Build helpers
// --------------------------------------------------------------------------------------------------------------------
function standardMaterial(THREE, params) {
  const Mat = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
  return new Mat(params);
}

function makeInstanced(THREE, geometry, material, items, name, opts = {}) {
  if (!items.length) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  mesh.name = name;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const p = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    e.set(it.rx || 0, it.ry || 0, it.rz || 0);
    q.setFromEuler(e);
    p.set(it.x, it.y, it.z);
    s.set(it.sx, it.sy, it.sz);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    if (it.color !== undefined) mesh.setColorAt(i, col.setHex(it.color));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = opts.castShadow !== false;
  mesh.receiveShadow = opts.receiveShadow !== false;
  mesh.userData.cullDistance = opts.cullDistance ?? 700;
  mesh.userData.cullCell = opts.cullCell ?? 120;
  if (opts.role) mesh.userData.role = opts.role;
  if (mesh.computeBoundingSphere) mesh.computeBoundingSphere();
  return mesh;
}

// Sweep a 2D (east, up) centreline into box segments, oriented in the x-y plane; the cross-section is `thickness`
// (in-plane) by `width` (along y-as-z, i.e. world z). `joint` shrinks each segment for a visible panel joint.
function sweepProfile(list, base, profile, width, thickness, color, joint = 1) {
  for (let i = 1; i < profile.length; i++) {
    const [u0, y0] = profile[i - 1], [u1, y1] = profile[i];
    const du = u1 - u0, dy = y1 - y0;
    const len = Math.hypot(du, dy) || 0.01;
    const rz = Math.atan2(-du, dy); // rotate local +Y (the length axis) to (du, dy)
    const x = base.x + (u0 + u1) / 2, y = GROUND + (y0 + y1) / 2, z = base.z;
    if (!finite(x, y, z, len, rz)) continue;
    list.push({ x, y, z, sx: thickness, sy: len * joint, sz: width, rz, color });
  }
}

// One Light Showers element: footing on the pool side, the concrete upper arm, the rounded metal lower arm, the cables
// between them, and the water curtain from the lower beam into the raised pool.
function addLightShower(THREE, base, lists, element) {
  const P = SHOWER_PROFILE;
  const upper = showerUpperProfile();
  const lower = showerLowerProfile();
  sweepProfile(lists.concrete, base, upper, P.upperWidth, P.upperThickness, 0xb9b6ae, 1);
  sweepProfile(lists.metal, base, lower, P.lowerWidth, P.lowerThickness, 0x9aa0a4, 1);
  // footing on the deck at the pool side
  lists.footings.push({ x: base.x, y: GROUND + 0.2, z: base.z, sx: 1.3, sy: 0.4, sz: 1.3, color: 0x8f8c85 });
  // suspension cables from the upper beam bottom down to the lower beam top
  const upperBeamBottom = LIGHT_SHOWERS.upperBeamTop - P.upperThickness;
  const lowerBeamTop = LIGHT_SHOWERS.lowerBeamTop;
  const cableH = Math.max(0.1, upperBeamBottom - lowerBeamTop);
  for (let c = 0; c < P.cables; c++) {
    const u = 1.9 + c * 0.9;
    lists.cables.push({ x: base.x + u, y: GROUND + lowerBeamTop + cableH / 2, z: base.z, sx: P.cableRadius, sy: cableH, sz: P.cableRadius, color: 0x3b3f42 });
  }
  // the water curtain: a broad thin sheet dropping from the lower spout beam into the raised pool. It is broad along
  // X (the beam's run) and thin along Z, so its broad face faces +/-Z and reads from an oblique side view.
  const curtainTop = lowerBeamTop - P.lowerThickness;
  const curtainH = Math.max(0.5, curtainTop - P.poolSurface);
  lists.curtains.push({ x: base.x + 2.1, y: GROUND + P.poolSurface + curtainH / 2, z: base.z, sx: P.curtainWidth, sy: curtainH, sz: P.curtainThickness, color: 0xbfe0ea });
  element.height = LIGHT_SHOWERS.height;
  element.upperBeamTop = LIGHT_SHOWERS.upperBeamTop;
  element.lowerBeamTop = LIGHT_SHOWERS.lowerBeamTop;
  return element;
}

// A CONTINUOUS indexed ribbon mesh swept along the arch centreline: one rectangular cross-section per station, shared
// between neighbouring stations (indexed), with a smooth normal computed across it. No per-segment gaps or air seams.
// The ribbon's broad face normal is the (constant) horizontal plane normal, so it reads broadside from an oblique side
// view; the in-plane width axis is perpendicular to the local tangent within the vertical arc plane.
function buildArchRibbonGeometry(THREE, spec) {
  const pts = spec.points;
  const N = pts.length;
  const W = UNFINISHED_ARCH.ribbonWidth, T = UNFINISHED_ARCH.ribbonThickness;
  const [hx, hz] = spec.bearing;
  const planeNormal = new THREE.Vector3(-hz, 0, hx).normalize(); // broad-face normal (constant, horizontal)
  const tangent = new THREE.Vector3(), wAxis = new THREE.Vector3();
  const positions = [];
  for (let i = 0; i < N; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N - 1, i + 1)];
    tangent.set(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
    wAxis.crossVectors(tangent, planeNormal).normalize(); // in-plane, perpendicular to the tangent
    const c = pts[i];
    const hw = W / 2, ht = T / 2;
    // four corners: +w+t, +w-t, -w-t, -w+t (w along in-plane width, t along the broad-face normal)
    for (const [sw, st] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
      const px = c.x + wAxis.x * sw * hw + planeNormal.x * st * ht;
      const py = c.y + wAxis.y * sw * hw + planeNormal.y * st * ht;
      const pz = c.z + wAxis.z * sw * hw + planeNormal.z * st * ht;
      const ok = finite(px, py, pz);
      // clamp to the ground so the ribbon never dips below y = 0 (the single contact is the foot)
      positions.push(ok ? px : c.x, ok ? Math.max(0, py) : c.y, ok ? pz : c.z);
    }
  }
  const indices = [];
  for (let i = 0; i < N - 1; i++) {
    const a = i * 4, b = (i + 1) * 4;
    for (let e = 0; e < 4; e++) {
      const e2 = (e + 1) % 4;
      indices.push(a + e, b + e, b + e2, a + e, b + e2, a + e2);
    }
  }
  // close both ends so there is no hole at the foot or the free tip
  const s0 = 0, sN = (N - 1) * 4;
  indices.push(s0 + 0, s0 + 2, s0 + 1, s0 + 0, s0 + 3, s0 + 2);
  indices.push(sN + 0, sN + 1, sN + 2, sN + 0, sN + 2, sN + 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals(); // smooth across the shared station vertices
  g.computeBoundingSphere();
  g.userData = { stations: N, segments: N - 1, continuous: true };
  return g;
}

// The Unfinished Arch stats + the narrower hanging touch piece under the free edge. The ribbon body is a continuous
// mesh built by buildArchRibbonGeometry (see create).
function addUnfinishedArch(THREE, lists, stats) {
  const spec = archSpec();
  if (!spec) return null;
  const [hx, hz] = spec.bearing;
  // the narrower hanging touch piece under the main free edge (~1.8 m)
  const pieceTop = UNFINISHED_ARCH.freeEdgeHeight, pieceBottom = UNFINISHED_ARCH.touchPieceHeight;
  const tu = spec.cantilever - 0.8;
  lists.touch.push({
    x: spec.base.x + hx * tu, y: GROUND + (pieceTop + pieceBottom) / 2, z: spec.base.z + hz * tu,
    sx: UNFINISHED_ARCH.ribbonWidth * 0.4, sy: (pieceTop - pieceBottom), sz: UNFINISHED_ARCH.ribbonThickness, color: 0xb9c0c5
  });
  stats.arch = {
    base: spec.base, tip: { x: spec.tip.x, y: spec.tip.y, z: spec.tip.z }, apex: spec.apex,
    height: spec.height, cantilever: spec.cantilever,
    ribbonWidth: spec.ribbonWidth, ribbonThickness: spec.ribbonThickness,
    freeEdgeHeight: UNFINISHED_ARCH.freeEdgeHeight, touchPieceHeight: UNFINISHED_ARCH.touchPieceHeight,
    segments: spec.points.length - 1, continuous: true, note: spec.note
  };
  return spec;
}

// --------------------------------------------------------------------------------------------------------------------
// Frame guard (unique name — never the shared supportedCityFrame)
// --------------------------------------------------------------------------------------------------------------------
function waterfrontSherbourneSupported() {
  const G = C?.GEO;
  if (!G || !G.frame || !G.frame.detail || !C?.CITY_BOUNDS) return false;
  const parks = sherbourneParks();
  if (!parks) return false;
  const d = G.frame.detail;
  const pts = lightShowersPositions();
  const arc = archSpec();
  if (!pts || !arc) return false;
  const all = [...pts.map((p) => [p.base.x, p.base.z]), ...arc.points.map((p) => [p.x, p.z])];
  for (const [x, z] of all) {
    if (!(x > d.x0 && x < d.x1 && z > d.z0 && z < d.z1)) return false;
    if (!finite(x, z)) return false;
  }
  return true;
}

function createWaterfrontSherbourne(THREE = C?.THREE, scene = null) {
  if (!THREE) throw new Error('waterfront-sherbourne: THREE is required');
  if (!waterfrontSherbourneSupported()) {
    if (C) C.waterfrontSherbourneEnabled = false;
    console.info('[waterfrontSherbourne] skipped: the active city frame does not cover Sherbourne Common');
    return null;
  }
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const group = new THREE.Group();
  group.name = 'WaterfrontSherbourne';

  const lists = { concrete: [], metal: [], footings: [], cables: [], curtains: [], arch: [], touch: [] };
  const stats = { elements: [], lightShowers: 0, arch: null };
  const pts = lightShowersPositions();
  for (const p of pts) {
    const element = { id: p.id, node: p.node, base: p.base, offsetWest: p.offsetWest, osm: p.osm, source: p.source };
    addLightShower(THREE, p.base, lists, element);
    stats.elements.push(element);
  }
  stats.lightShowers = stats.elements.length;
  addUnfinishedArch(THREE, lists, stats);

  const concrete = standardMaterial(THREE, { color: 0xffffff, roughness: 0.9, metalness: 0.02 });
  const steel = standardMaterial(THREE, { color: 0xffffff, roughness: 0.45, metalness: 0.7 });
  const metal = standardMaterial(THREE, { color: 0xffffff, roughness: 0.5, metalness: 0.65 });
  const cableMat = standardMaterial(THREE, { color: 0xffffff, roughness: 0.5, metalness: 0.6 });
  const ribbon = standardMaterial(THREE, { color: 0xffffff, roughness: 0.28, metalness: 0.85 });
  const waterMat = standardMaterial(THREE, { color: 0xffffff, roughness: 0.15, metalness: 0.0, transparent: true, opacity: 0.55 });

  const box = new THREE.BoxGeometry(1, 1, 1);
  const meshes = [];
  const add = (mesh, role) => { if (mesh) { mesh.userData.role = role; meshes.push(mesh); group.add(mesh); } };

  add(makeInstanced(THREE, box, concrete, lists.concrete, 'WaterfrontSherbourne-UpperArms', { cullDistance: 700, cullCell: 120 }), 'light-shower-upper-arms');
  add(makeInstanced(THREE, box, metal, lists.metal, 'WaterfrontSherbourne-LowerArms', { cullDistance: 700, cullCell: 120 }), 'light-shower-lower-arms');
  add(makeInstanced(THREE, box, concrete, lists.footings, 'WaterfrontSherbourne-Footings', { castShadow: false, cullDistance: 600, cullCell: 120 }), 'light-shower-footings');
  add(makeInstanced(THREE, box, cableMat, lists.cables, 'WaterfrontSherbourne-Cables', { castShadow: false, cullDistance: 500, cullCell: 120 }), 'light-shower-cables');
  add(makeInstanced(THREE, box, waterMat, lists.curtains, 'WaterfrontSherbourne-Curtains', { castShadow: false, cullDistance: 500, cullCell: 120 }), 'light-shower-curtains');

  // The Unfinished Arch ribbon is ONE continuous indexed swept mesh (no per-segment gaps / air seams).
  const archSpecNow = archSpec();
  if (archSpecNow) {
    const ribbonMesh = new THREE.Mesh(buildArchRibbonGeometry(THREE, archSpecNow), ribbon);
    ribbonMesh.name = 'WaterfrontSherbourne-UnfinishedArch';
    ribbonMesh.castShadow = true;
    ribbonMesh.receiveShadow = true;
    ribbonMesh.userData.cullDistance = 900;
    ribbonMesh.userData.cullCell = 120;
    add(ribbonMesh, 'unfinished-arch');
  }
  add(makeInstanced(THREE, box, ribbon, lists.touch, 'WaterfrontSherbourne-ArchTouchPiece', { cullDistance: 700, cullCell: 120 }), 'arch-touch-piece');

  const colliders = [];
  for (const e of stats.elements) {
    colliders.push({
      minX: e.base.x - 0.8, maxX: e.base.x + 0.8, minZ: e.base.z - 0.8, maxZ: e.base.z + 0.8,
      minY: GROUND, maxY: GROUND + e.height, prop: true, kind: 'lightshower',
      obb: { cx: e.base.x, cz: e.base.z, hx: 0.8, hz: 0.8, cs: 1, sn: 0 }
    });
  }
  if (stats.arch) {
    const b = stats.arch.base;
    colliders.push({
      minX: b.x - 1.0, maxX: b.x + 1.0, minZ: b.z - 1.0, maxZ: b.z + 1.0,
      minY: GROUND, maxY: GROUND + 2.0, prop: true, kind: 'unfinishedarch',
      obb: { cx: b.x, cz: b.z, hx: 1.0, hz: 1.0, cs: 1, sn: 0 }
    });
  }

  let triangles = 0;
  for (const mesh of meshes) {
    const g = mesh.geometry;
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    const instances = mesh.isInstancedMesh ? mesh.count : 1;
    triangles += tris * instances;
  }
  const out = {
    lightShowers: stats.lightShowers, elements: stats.elements, arch: stats.arch,
    profile: SHOWER_PROFILE, existing: EXISTING,
    meshes: meshes.length, triangles: Math.round(triangles), colliders: colliders.length,
    ms: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 10) / 10
  };
  group.userData.waterfrontSherbourne = out;
  if (scene && scene.add) scene.add(group);
  const result = { group, root: group, colliders, stats: out };
  if (C) { C.waterfrontSherbourne = result; C.waterfrontSherbourneEnabled = true; }
  console.info(`[waterfrontSherbourne] ${out.lightShowers} Light Showers (upper beam ${LIGHT_SHOWERS.upperBeamTop} m, lower ${LIGHT_SHOWERS.lowerBeamTop} m) ` +
    `+ Unfinished Arch (${out.arch ? out.arch.height : 0} m / ${out.arch ? out.arch.cantilever : 0} m cantilever, ${out.arch ? out.arch.ribbonWidth : 0} m ribbon); ` +
    `${out.triangles} triangles, ${out.ms} ms`);
  return result;
}

Object.assign(C || (window.CITY = {}), {
  LIGHT_SHOWERS,
  SHOWER_PROFILE,
  UNFINISHED_ARCH,
  SHERBOURNE_EXISTING: EXISTING,
  sherbourneParks,
  lightShowersPositions,
  lightShowerSpacing,
  showerUpperProfile,
  showerLowerProfile,
  archProfile,
  archSpec,
  archArcPoints,
  waterfrontSherbourneSupported,
  createWaterfrontSherbourne,
  buildWaterfrontSherbourne: createWaterfrontSherbourne
});
})();