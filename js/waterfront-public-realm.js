(function () {
// js/waterfront-public-realm.js
// The three timber WaveDecks on Toronto's central waterfront (West 8 + DTAH; built by Somerville; Spadina first,
// late 2008, Simcoe and Rees in 2009). They are urban docks at the heads of the Spadina, Rees and Simcoe slips, built
// out over the water where the Queens Quay sidewalks were narrow. Each articulates the level change between Queens
// Quay and Lake Ontario with timber terraces and stairs, two large swells at Simcoe, stainless steel railings that
// follow the wave, an accessible stainless-steel disc pathway, tactile dots at the deck edge, and timber stairs with
// stainless-steel nosing and a white edge strip at Simcoe and Rees. The decks created 1,780 m² of new fish habitat;
// this module models only the visible deck and its immediate arrival, leaving the habitat structures to the water
// modules.
//
// Locations & footprints (recorded 2026-11-09):
// - Spadina WaveDeck: OSM way/683024654 (area, highway=pedestrian, surface=wood), published at 43.63753, -79.39164;
//   the head of Spadina Slip, between the Music Garden and HTO Park; links them. Official 630 m² (OSM outline 613.8 m²).
// - Rees WaveDeck: OSM way/407154122 (footway, surface=wood, name "Rees Wave Deck"), published at 43.63849, -79.38732;
//   just east of HTO Park; official 480 m². OSM maps only a 45.7 m centre line, so the depth is the one estimated
//   dimension (9.4 m to match the measured decks and the shore strip).
// - Simcoe WaveDeck: OSM way/798912556 (area, highway=pedestrian, surface=wood), published at 43.63898, -79.38462;
//   just west of Simcoe Street, linking Harbourfront Centre to the western harbourfront; official 650 m² (OSM 621.5 m²).
//   Its two large swells rise 2.6 m above the lake, so the highest deck surface is at the lake's -0.7 m + 2.6 m = 1.9 m
//   in the app frame (not 2.6 m above the street). The plan tapers from 10.5 m at its west end to 4 m at its east end.
//
// Design sources:
// - https://www.waterfrontoronto.ca/our-projects/wavedecks — official areas (Spadina 630 m², Simcoe 650 m², Rees
//   480 m²), the three slips, West 8 + DTAH, the 1,780 m² of fish habitat, accessible from all sides, the stainless
//   steel disc pathway, the large barrier-free zones at the east sides of Simcoe and Rees with an accessible route
//   toward the water, tactile dots at the deck edge, stainless steel step nosing and the white step edge at Simcoe
//   and Rees, Simcoe's two swells rising 2.6 m above the lake, Slender stainless railings following the wave, Rees's
//   dip toward the water, Spadina's 57 m backless bench, Simcoe's 30 m backless bench.
// - https://www.west8.com/projects/toronto-central-waterfront/ — the timber structures articulating the level change
//   between Queens Quay and Lake Ontario, the water gateways, and the suspended decks with habitat beneath.
// - https://en.wikipedia.org/wiki/WaveDecks — dates, Spadina's 3,564 planks, the stepped levels with the widthwise
//   stepless route, 2009 Toronto Urban Design Award.
// - https://www.waterfrontbia.com/about-waterfront-bia and the City's 2021 accessible BIA map — scope.
// - OpenStreetMap contributors, ODbL: the three features above, fetched 2026-11-09. Spadina and Simcoe use the real
//   area outlines; Rees's depth is estimated.
//
// Geometry conventions (investigated in the app before coding): 1 unit = 1 m; world x is grid east, z is grid south;
// street level y = 0, the sidewalk top is CITY_BOUNDS.sidewalkHeight (0.22 m), Lake Ontario is at
// CITY_BOUNDS.waterLevel (-0.7 m). The landward band of every deck is level with the promenade (0.22 m), so the
// promenade never meets an abrupt wall; the swell rises inland/southward, the east barrier-free corridor stays a low
// stepless route to the water, and the rest steps in shallow terraces. Boards are axis-aligned segments top at the
// walking surface, deep enough to close a riser, so the rendered top and CITY.waterfrontDeckSurfaceHeight agree.
//
// This file owns the three decks and their immediate arrival details only; the existing Queens Quay promenade, Martin
// Goodman Trail, paved walks and park geometry are the city's own modules. Call createWaterfrontPublicRealm(THREE,
// scene); it returns { group, colliders, stats } and only builds when the active map frame actually covers the three
// mapped slips (see supportedCityFrame). The group is a single culling root, repeated parts are instanced, and meshes
// carry scene-culling.js's cullDistance/cullCell.
//
// Ground integration (the decks sit on the quay, not in the lake): the city's street level, sidewalks and plots run
// right up under the decks, and Rees steps down below Queens Quay. So that the gray pavement stops at the deck edge and
// a step below the promenade is built rather than buried, the caller applies applyWaterfrontDeckGroundMask(mat) to the
// city's ground materials (js/city-grid.js does, on every ground material except the lake). The deck is a suspended
// timber structure: a continuous fascia skirt drops to a sealed soffit above the lake, so the masked-away ground shows
// timber beneath, not the black void under the street level. Until the mask is applied the decks keep the old safe
// floor (4 cm above the pavement); once it is, they may dip to their landing.

const C = window.CITY;
const SW = C?.CITY_BOUNDS?.sidewalkHeight ?? 0.22;
const WATER = C?.CITY_BOUNDS?.waterLevel ?? -0.7;
const BOARD_PITCH = 0.2; // one board's pitch along the shore (m); the visible board is a little narrower
const BOARD_LEN = 1.3; // a board's length across the deck (m)
const BOARD_THICK = 0.5; // deep enough to close the riser to the next terrace
const RAIL_TOP = 1.08;
const SIMCOE_CREST = 2.6; // above the lake, per Waterfront Toronto
// The decks are suspended structures with a sealed underside (West 8): the soffit closes the substructure so that,
// once the pavement under the footprint is masked away, the open sides and the gap to the water show timber, not the
// black void under the street level. The fascia skirt drops to the soffit on every edge.
const SOFFIT_Y = WATER + 0.30; // just above the lake: seals the underside, leaving the habitat gap under the deck

// OSM footprints in world coordinates (x, z). Spadina & Simcoe are the real area outlines; Rees is the mapped
// centre line with an estimated depth (its OSM feature is a line, not an area).
const WATERFRONT_WAVEDECKS = [
  {
    id: 'spadina', name: 'Spadina WaveDeck', osm: 'way/683024654', opened: '2008',
    lat: 43.63753, lon: -79.39164, sourceArea: 630, planksSource: 3564, bench: 57,
    plan: [[-1129.25, 568.74], [-1070.08, 568.52], [-1070.16, 579.08], [-1129.15, 578.96]],
    step: 0.16, northBand: 2.7, amp: 0.85, dip: 0.05, swell: 'two',
    corridor: { outer: 4.0, drop: 0.18 }, nosing: false
  },
  {
    id: 'rees', name: 'Rees WaveDeck', osm: 'way/407154122', opened: '2009',
    lat: 43.63849, lon: -79.38732, sourceArea: 480, planksSource: null, bench: 0,
    // the OSM centre line runs x -757.9..-712.2 at z ≈ 572.0; the 9.4 m depth is an estimate (see docs)
    plan: [[-757.9, 567.3], [-712.2, 566.8], [-712.2, 576.8], [-757.9, 577.3]],
    // Rees is the deck that steps DOWN to the water (the "dip toward the lake"): its lower landing runs below the
    // Queens Quay promenade and only the ground exclusion under the footprint lets that read as built, not sunk into
    // pavement. landing is the surface height of that lower step, above the lake (Waterfront Toronto's barrier-free
    // route toward the water).
    step: 0.14, northBand: 2.4, amp: 0.42, dip: 0.30, swell: 'dip', landing: WATER + 0.42,
    corridor: { outer: 7.0, drop: 0.40 }, nosing: true
  },
  {
    id: 'simcoe', name: 'Simcoe WaveDeck', osm: 'way/798912556', opened: '2009',
    lat: 43.63898, lon: -79.38462, sourceArea: 650, planksSource: null, bench: 30,
    plan: [[-540.68, 588.05], [-479.20, 587.54], [-479.16, 581.07], [-479.14, 577.54],
      [-541.07, 577.91], [-540.91, 581.94], [-540.81, 585.52]],
    step: 0.14, northBand: 2.6, amp: WATER + SIMCOE_CREST - SW, dip: 0, swell: 'two',
    corridor: { outer: 7.0, drop: 0.35 }, nosing: true
  }
];

function polygonBounds(plan) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of plan) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return { x0, x1, z0, z1 };
}

function polygonArea(plan) {
  let a = 0;
  for (let i = 0, j = plan.length - 1; i < plan.length; j = i++) a += plan[j][0] * plan[i][1] - plan[i][0] * plan[j][1];
  return Math.abs(a) / 2;
}

// The z extent of a (near-x-aligned) deck outline at a given x. The WaveDeck outlines are simple, so the outer pair
// of intersections is the deck's width there. Returns null where the outline has no width.
function polygonZSpan(plan, x) {
  const zs = [];
  for (let i = 0, j = plan.length - 1; i < plan.length; j = i++) {
    const ax = plan[j][0], az = plan[j][1], bx = plan[i][0], bz = plan[i][1];
    if (Math.abs(bx - ax) < 1e-9) {
      if (Math.abs(x - ax) < 1e-9) zs.push(az, bz);
      continue;
    }
    if ((ax <= x && x <= bx) || (bx <= x && x <= ax)) zs.push(az + ((bz - az) * (x - ax)) / (bx - ax));
  }
  if (zs.length < 2) return null;
  zs.sort((a, b) => a - b);
  return [zs[0], zs[zs.length - 1]];
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (v) => { const t = clamp01(v); return t * t * (3 - 2 * t); };
const corridorDist = (deck, x) => polygonBounds(deck.plan).x1 - x;
const inCorridor = (deck, x) => deck.corridor ? corridorDist(deck, x) <= deck.corridor.outer : false;
// The ramp (barrier-free corridor) starts on a board-column edge, so no flat terraced board ever straddles the ramp
// boundary: a board's whole width sits in one surface. Shared by the walking query, board placement and the ramp mesh.
function rampStartX(deck) {
  if (!deck.corridor) return Infinity;
  const b = polygonBounds(deck.plan);
  const want = b.x1 - deck.corridor.outer;
  const col = Math.floor((want - b.x0) / BOARD_PITCH);
  return b.x0 + col * BOARD_PITCH;
}
const inRamp = (deck, x) => deck.corridor ? x >= rampStartX(deck) - 1e-9 : false;

// The swell profile along the shore (east-west): two large swells at Simcoe, the same gesture gentler at Spadina.
// Rees has shallow rises and falls toward the water.
function waterfrontDeckSwellProfile(deck, u) {
  const s = clamp01(u);
  if (deck.swell === 'dip') return 0.35 + 0.65 * Math.pow(Math.sin(2 * Math.PI * s), 2);
  return Math.pow(Math.sin(2 * Math.PI * s), 2);
}

// The deck surface before the terraces are quantized: level with the promenade in the north arrival band, rising
// inland/southward into the swells, with the east barrier-free corridor held as a low route toward the water. A deck
// with a `landing` (Rees) descends toward the lake rather than only rising; the landing is its lowest walking height.
function waterfrontDeckRawHeight(deck, x, z) {
  const b = polygonBounds(deck.plan);
  const u = clamp01((x - b.x0) / (b.x1 - b.x0));
  const depth = b.z1 - b.z0;
  const t = clamp01((z - b.z0 - deck.northBand) / Math.max(0.001, depth - deck.northBand));
  const w = deck.corridor ? smoothstep((corridorDist(deck, x) - (deck.corridor.outer - 1.6)) / 1.6) : 1;
  const profile = waterfrontDeckSwellProfile(deck, u);
  const rise = deck.amp * profile * smoothstep(t) * w;
  const dip = deck.dip * t * w;
  // The barrier-free corridor is a single, gentle descent from the promenade toward the water. A landing deck (Rees)
  // uses its own landing as that descent's foot; otherwise it is the configured corridor drop. There is exactly one
  // descent per point, so its slope stays under the fine corridor step and no board spans two steps.
  const foot = deck.landing !== undefined ? deck.landing : SW - deck.corridor?.drop;
  const corridorRamp = deck.corridor ? (SW - foot) * smoothstep(t) * (1 - w) : 0;
  return SW + rise - dip - corridorRamp;
}

// The deck's lowest walking height: its landing if it has one, else a little below the promenade so a dip can read.
const deckFloor = (deck) => (deck.landing !== undefined ? deck.landing : WATER + 0.30);

// Whether the ground under the decks has actually been masked (applyWaterfrontDeckGroundMask succeeded). Until it has,
// the decks must not step below the promenade, or the un-masked pavement shows through them (the old behaviour kept
// the lowest timber 4 cm clear of the pavement). This is the no-op guard for a caller that has not wired the mask.
let groundMaskApplied = false;

// The actual walking top: terraces outside the barrier-free corridor, a fine-stepped ramp inside it, so the rendered
// board tops and this query agree. The north band lands exactly at the sidewalk height. The floor is the deck's
// landing (over water) rather than the promenade: the ground beneath the footprint is excluded (see the ground mask)
// so the timber can step below Queens Quay without sinking into pavement.
function waterfrontDeckSurfaceHeight(deck, x, z) {
  // The visible boards are flat pieces, so footing uses the same piece centre instead of a
  // continuously varying profile between samples. Include narrow board joints in that surface.
  const b = polygonBounds(deck.plan);
  // Below the promenade the deck may step only where the pavement under its footprint has been removed. If the caller
  // has not wired the ground mask, the lowest timber stays 4 cm clear of the pavement, exactly as before.
  const floor = groundMaskApplied ? deckFloor(deck) : SW + 0.04;
  // The barrier-free corridor is a smooth ramp (accessible routes are ramps, not stairs): its walking top is the
  // continuous profile at the true (x, z), so a wheelchair route never meets a riser. It is rendered by
  // buildCorridorRamp. Outside it the deck is terraced into flat boards at a board-cell centre.
  if (inRamp(deck, x)) return Math.max(floor, waterfrontDeckRawHeight(deck, x, z));
  const column = Math.max(0, Math.min(Math.ceil((b.x1 - b.x0) / BOARD_PITCH) - 1,
    Math.floor((x - b.x0 + 1e-7) / BOARD_PITCH)));
  const sx = b.x0 + (column + 0.5) * BOARD_PITCH;
  const span = polygonZSpan(deck.plan, sx);
  if (!span) return SW + (groundMaskApplied ? 0 : 0.04);
  const start = span[0] + 0.08;
  const row = Math.max(0, Math.floor((z - start + 1e-7) / BOARD_LEN));
  const za = start + row * BOARD_LEN;
  const zb = Math.min(za + BOARD_LEN - 0.03, span[1] - 0.06);
  const sz = (za + zb) / 2;
  // Quantize to terraces around the promenade, then hold the deck floor (its landing over the water, once masked)
  // instead of the promenade: the pavement under the deck is removed, so a step below Queens Quay is built, not buried.
  const terraced = SW + Math.round((waterfrontDeckRawHeight(deck, sx, sz) - SW) / deck.step) * deck.step;
  return Math.max(floor, terraced);
}

const hash = (x, z) => {
  const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return n - Math.floor(n);
};

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

// A continuous timber fascia ribbon around a deck's perimeter: one smooth band following the outline, its top at the
// true (un-quantized) deck surface and its bottom closing to the water on the water side, or just below the promenade
// inland and at the ends. It replaces a stepped row of per-column boxes, which read as a coarse stair of separate
// boards. Returns positions/colors for a single BufferGeometry.
function buildDeckFascia(deck, THREE) {
  const b = polygonBounds(deck.plan);
  const plan = deck.plan;
  const STEP = 0.35; // sample spacing along the perimeter (m)
  const positions = [], colors = [];
  const cTop = new THREE.Color(0x6d4528), cBottom = new THREE.Color(0x3f2a19), tmp = new THREE.Color();
  // The plan winding sets which side is outside: a positive shoelace area (x east, z south) here means the outline is
  // traversed with the deck to the right, so the outward normal is (-ez, +ex); else (+ez, -ex). Keeping this consistent
  // per deck means the ribbon faces outward everywhere and lights correctly (not merely double-sided).
  let area = 0;
  for (let i = 0, j = plan.length - 1; i < plan.length; j = i++) area += plan[j][0] * plan[i][1] - plan[i][0] * plan[j][1];
  const sgn = area > 0 ? 1 : -1;
  // Walk the plan outline (edges in order), emitting a quad ribbon from top to bottom on the outward face.
  const pushQuad = (ax, az, bx, bz, topA, topB, botA, botB) => {
    const ex = bx - ax, ez = bz - az, L = Math.hypot(ex, ez) || 1;
    const nx = (ez / L) * sgn, nz = (-ex / L) * sgn; // outward normal of edge a->b
    // two triangles, slight outward offset so the face is not z-fighting the boards above it
    const o = 0.015;
    const A = [ax + nx * o, topA, az + nz * o], Bv = [bx + nx * o, topB, bz + nz * o];
    const C = [bx + nx * o, botB, bz + nz * o], D = [ax + nx * o, botA, az + nz * o];
    // wind so the face normal points outward: (B-A) is along the edge, (C-A) is down the edge
    if (sgn > 0) { positions.push(...A, ...Bv, ...C, ...A, ...C, ...D); }
    else { positions.push(...A, ...D, ...C, ...A, ...C, ...Bv); }
    // shade: top lighter, bottom darker, gentle per-edge tone
    const tone = 0.85 + 0.15 * hash(ax, az);
    for (const top of [true, true, false, true, false, false]) {
      tmp.copy(top ? cTop : cBottom).multiplyScalar(tone);
      colors.push(tmp.r, tmp.g, tmp.b);
    }
  };
  for (let i = 0; i < plan.length; i++) {
    const [ax, az] = plan[i], [bx, bz] = plan[(i + 1) % plan.length];
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(L / STEP));
    // Is this edge the water (south, high-z) edge? The plan runs the lake edge on the max-z side; approximate per vertex
    // by the edge's mean z against the deck's span.
    const midz = (az + bz) / 2;
    const waterEdge = midz > (b.z0 + b.z1) / 2 + 0.5;
    for (let k = 0; k < n; k++) {
      const s0 = k / n, s1 = (k + 1) / n;
      const x0 = ax + (bx - ax) * s0, z0 = az + (bz - az) * s0;
      const x1 = ax + (bx - ax) * s1, z1 = az + (bz - az) * s1;
      const top0 = waterfrontDeckSurfaceHeight(deck, x0 + 0.05, Math.max(b.z0 + 0.1, Math.min(b.z1 - 0.1, z0)) - (waterEdge ? 0.12 : 0)) - 0.01;
      const top1 = waterfrontDeckSurfaceHeight(deck, x1 + 0.05, Math.max(b.z0 + 0.1, Math.min(b.z1 - 0.1, z1)) - (waterEdge ? 0.12 : 0)) - 0.01;
      // the skirt drops to the soffit on every edge (water and land alike), so no black gap shows under the deck
      pushQuad(x0, z0, x1, z1, top0, top1, SOFFIT_Y, SOFFIT_Y);
    }
  }
  return { positions, colors };
}

// The barrier-free corridor as a smooth ramp surface: a fine quad strip over the corridor footprint whose top is the
// continuous walking height (waterfrontDeckSurfaceHeight, which is un-quantized inside the corridor). It is drawn
// instead of the stepped boards there, so the accessible route reads as a ramp and the mesh matches the query.
//
// Every one of the four quad corners is evaluated at its OWN (x, z): the surface height depends on z, so a per-quad
// midpoint would misplace the ramp under the query. The two triangles are wound so their normal points up (+Y), i.e.
// the visible top faces the sky; a downward normal is culled and leaves a black hole with only the substructure below.
function buildCorridorRamp(deck, THREE) {
  if (!deck.corridor) return null;
  const b = polygonBounds(deck.plan);
  const x1 = b.x1, x0 = rampStartX(deck); // matches inRamp: the ramp meets the terraces cleanly at a board edge
  const positions = [], colors = [];
  const wood = new THREE.Color(0x8a5b36), edge = new THREE.Color(0x74492b), tmp = new THREE.Color();
  const XN = Math.max(2, Math.round((x1 - x0) / 0.5));
  const zStep = 0.5;
  const H = (x, z) => waterfrontDeckSurfaceHeight(deck, x, z);
  for (let xi = 0; xi < XN; xi++) {
    const xa = x0 + ((x1 - x0) * xi) / XN, xb = x0 + ((x1 - x0) * (xi + 1)) / XN;
    const span = polygonZSpan(deck.plan, (xa + xb) / 2);
    if (!span) continue;
    const z0span = polygonZSpan(deck.plan, xa), z1span = polygonZSpan(deck.plan, xb);
    const za = (z0span ? z0span[0] : span[0]) + 0.08, zb = (z1span ? z1span[0] : span[0]) + 0.08;
    const zhi = Math.min(z0span ? z0span[1] : span[1], z1span ? z1span[1] : span[1]) - 0.06;
    for (let z = Math.max(za, zb); z < zhi; z += zStep) {
      const zn = Math.min(z + zStep, zhi);
      // four corners, each at its own (x, z)
      const A = [xa, H(xa, z), z], B = [xb, H(xb, z), z], C = [xb, H(xb, zn), zn], D = [xa, H(xa, zn), zn];
      // A(xa,z) -> D(xa,zn) -> C(xb,zn) -> B(xb,z): CCW seen from above (+Y), so the winding below faces up.
      positions.push(...A, ...D, ...C, ...A, ...C, ...B);
      const shade = 0.9 + 0.1 * hash(xa, z);
      for (const [e] of [[0], [0], [xi === XN - 1 ? 1 : 0], [0], [xi === XN - 1 ? 1 : 0], [0]]) {
        tmp.copy(e ? edge : wood).multiplyScalar(shade);
        colors.push(tmp.r, tmp.g, tmp.b);
      }
    }
  }
  return { positions, colors };
}

// One deck's members are accumulated into the shared instance lists. Boards run across the deck (north-south) and are
// deep enough that their own sides close a terrace riser; the rendered top is exactly waterfrontDeckSurfaceHeight.
function addDeck(deck, lists) {
  const b = polygonBounds(deck.plan);
  const stats = { boards: 0, fascia: 0, rails: 0, posts: 0, discs: 0, tactile: 0, beams: 0, piles: 0, nosing: 0, toeRail: 0 };
  // (the fascia is now a continuous ribbon; its geometry is accumulated separately in lists.fasciaGeo)
  let n = 0, postRun = 0, nextPost = 1.2;

  for (let x = b.x0 + BOARD_PITCH / 2; x < b.x1; x += BOARD_PITCH, n++) {
    const span = polygonZSpan(deck.plan, x);
    if (!span || span[1] - span[0] < 0.35) continue;
    const [zLo, zHi] = span;
    const corridor = inRamp(deck, x); // boards stop one column west of the ramp
    let prevTop = null;
    // Inside the barrier-free corridor the deck is the smooth ramp (buildCorridorRamp), not stepped boards.
    for (let z = corridor ? zHi : zLo + 0.08; z < zHi - 0.08; z += BOARD_LEN) {
      const zEnd = Math.min(z + BOARD_LEN - 0.03, zHi - 0.06);
      if (zEnd - z < 0.25) break;
      const zc = (z + zEnd) / 2;
      const top = waterfrontDeckSurfaceHeight(deck, x, zc);
      const tone = 0x8a5b36 + (Math.floor(hash(x, zc) * 3) * 0x070402);
      lists.boards.push({
        x, y: top - BOARD_THICK / 2, z: zc,
        sx: BOARD_PITCH - 0.015, sy: BOARD_THICK, sz: zEnd - z - 0.01, color: tone
      });
      stats.boards++;
      // stainless steel nosing with a white edge strip at the top of a step (Simcoe and Rees)
      if (deck.nosing && prevTop !== null && top - prevTop > 0.08) {
        lists.nosing.push({ x, y: top - 0.012, z: z + 0.035, sx: BOARD_PITCH - 0.015, sy: 0.026, sz: 0.07, color: 0xf2f2ee });
        stats.nosing++;
      }
      prevTop = top;
    }

    const southTop = waterfrontDeckSurfaceHeight(deck, x, zHi - 0.2);

    // Rails follow the outer (water) edge. Across the east barrier-free corridor there is only a low toe rail, so the
    // accessible route reaches the water and nobody is trapped.
    if (corridor) {
      lists.toeRail.push({ x, y: southTop + 0.07, z: zHi - 0.10, sx: BOARD_PITCH + 0.02, sy: 0.14, sz: 0.06, color: 0xb9bdc0 });
      stats.toeRail++;
    } else {
      for (const railY of [RAIL_TOP, 0.55]) {
        lists.rails.push({ x, y: southTop + railY, z: zHi - 0.10, sx: BOARD_PITCH + 0.02, sy: 0.035, sz: 0.045, color: 0xb9bdc0 });
        stats.rails++;
      }
      if (postRun >= nextPost) {
        lists.posts.push({ x, y: southTop + RAIL_TOP / 2, z: zHi - 0.10, sx: 0.05, sy: RAIL_TOP, sz: 0.05, color: 0xa9adb0 });
        stats.posts++;
        nextPost += 2.2;
      }
      // tactile dots at the water edge
      if (n % 4 === 0) {
        lists.tactile.push({ x, y: southTop + 0.006, z: zHi - 0.22, sx: 0.05, sy: 0.012, sz: 0.05, color: 0x33383b });
        stats.tactile++;
      }
    }
    postRun += BOARD_PITCH;

    // A timber bearer every 3.2 m. The bearer spans the whole deck depth and a little across x, and the deck surface is
    // lower at the entry/accessible ramp than at mid-deck, so its top is set below the MINIMUM walking surface over its
    // FULL footprint (not the mid-deck height): no bearer may poke up through the walk, including the low entry/ramp.
    if (n % 16 === 0) {
      const bx = x, hx = 0.07; // beam half-width across x
      const zA = zLo + 0.15, zB = zHi - 0.15;
      let minSurf = Infinity;
      for (let xx = bx - hx; xx <= bx + hx + 1e-9; xx += hx) {
        for (let zz = zA; zz <= zB + 1e-9; zz += 0.25) minSurf = Math.min(minSurf, waterfrontDeckSurfaceHeight(deck, xx, zz));
      }
      const top = minSurf - 0.06;                 // clear of the walking surface everywhere under the beam
      const bottom = Math.max(SOFFIT_Y, top - 0.24); // never pierce the sealed soffit beneath
      if (top - bottom > 0.06) {
        lists.beams.push({
          x: bx, y: (top + bottom) / 2, z: (zA + zB) / 2,
          sx: 0.14, sy: top - bottom, sz: zB - zA, color: 0x5f3f27
        });
        stats.beams++;
      }
    }
    if (n % 32 === 0) {
      for (const f of [0.28, 0.72]) {
        const z = zLo + (zHi - zLo) * f;
        const top = waterfrontDeckSurfaceHeight(deck, x, z) - 0.24;
        const bottom = C?.waterAt?.(x, z) ? WATER - 0.25 : 0.02;
        if (top - bottom > 0.08) {
          lists.piles.push({ x, y: (top + bottom) / 2, z, sx: 0.13, sy: top - bottom, sz: 0.13, color: 0x6b7075 });
          stats.piles++;
        }
      }
    }
  }

  // End rails: the west end always; the east end only north of the barrier-free corridor.
  for (const ex of [b.x0 + 0.08, b.x1 - 0.08]) {
    if (ex > b.x1 - 1 && inCorridor(deck, ex)) continue;
    const span = polygonZSpan(deck.plan, ex);
    if (!span) continue;
    const [zLo, zHi] = span;
    const top = waterfrontDeckSurfaceHeight(deck, ex, (zLo + zHi) / 2);
    for (const railY of [RAIL_TOP, 0.55]) {
      lists.rails.push({ x: ex, y: top + railY, z: (zLo + zHi) / 2, sx: 0.05, sy: 0.035, sz: zHi - zLo - 0.2, color: 0xb9bdc0 });
      stats.rails++;
    }
    for (const z of [zLo + 0.2, zHi - 0.2]) {
      lists.posts.push({ x: ex, y: waterfrontDeckSurfaceHeight(deck, ex, z) + RAIL_TOP / 2, z, sx: 0.05, sy: RAIL_TOP, sz: 0.05, color: 0xa9adb0 });
      stats.posts++;
    }
  }

  // The stainless steel disc pathway: the east barrier-free route from the promenade toward the water.
  if (deck.corridor) {
    const cx = b.x1 - deck.corridor.outer / 2;
    const span = polygonZSpan(deck.plan, cx);
    if (span) {
      for (let z = b.z0 + 0.6; z <= span[1] - 0.6; z += 1.1) {
        lists.discs.push({ x: cx, y: waterfrontDeckSurfaceHeight(deck, cx, z) + 0.012, z, sx: 0.13, sy: 0.018, sz: 0.13, color: 0xc9ccd0 });
        stats.discs++;
      }
      // tactile dots along the corridor edge, marking the deck edge on the landward side of the opening
      for (let x = cx - 1.4; x <= cx + 1.4; x += 0.7) {
        lists.tactile.push({ x, y: waterfrontDeckSurfaceHeight(deck, x, b.z0 + 0.35) + 0.006, z: b.z0 + 0.35, sx: 0.05, sy: 0.012, sz: 0.05, color: 0x33383b });
        stats.tactile++;
      }
    }
  }

  // The source's backless bench, on the promenade beside the deck (Spadina 57 m, Simcoe 30 m).
  if (deck.bench > 0) {
    const cx = (b.x0 + b.x1) / 2;
    const length = Math.min(deck.bench, (b.x1 - b.x0) - 4);
    for (let x = cx - length / 2 + 0.3; x < cx + length / 2; x += BOARD_PITCH) {
      const sx = Math.min(BOARD_PITCH, cx + length / 2 - x) - 0.01;
      if (sx < 0.05) continue;
      lists.benches.push({ x: x + sx / 2, y: SW + 0.21, z: b.z0 - 0.75, sx, sy: 0.42, sz: 0.45, color: 0x7a5334 });
    }
  }

  // Continuous fascia ribbon round the whole perimeter.
  const fascia = buildDeckFascia(deck, lists.THREE);
  if (fascia.positions.length) {
    lists.fasciaGeo.push(fascia);
    stats.fascia += fascia.positions.length / 3;
  }
  // The barrier-free corridor ramp.
  const ramp = buildCorridorRamp(deck, lists.THREE);
  if (ramp && ramp.positions.length) {
    lists.rampGeo.push(ramp);
    stats.rampQuads = (stats.rampQuads || 0) + ramp.positions.length / 18;
  }
  // The sealed underside: a flat soffit under the footprint, just above the lake, so the masked-away ground does not
  // leave a black void below the deck. Built as column strips so any simple plan (the concave Simcoe notch) is filled.
  {
    const pos = [], col = [];
    const c = new lists.THREE.Color(0x2c1f14), tmp = new lists.THREE.Color();
    for (let x = b.x0 + BOARD_PITCH / 2; x < b.x1; x += BOARD_PITCH) {
      const span = polygonZSpan(deck.plan, x);
      if (!span || span[1] - span[0] < 0.3) continue;
      const xL = x - BOARD_PITCH / 2, xR = x + BOARD_PITCH / 2;
      const z0 = span[0], z1 = span[1];
      const A = [xL, SOFFIT_Y, z0], B = [xR, SOFFIT_Y, z0], C = [xR, SOFFIT_Y, z1], D = [xL, SOFFIT_Y, z1];
      pos.push(...A, ...D, ...C, ...A, ...C, ...B);
      const shade = 0.85 + 0.15 * hash(x, z0);
      for (let k = 0; k < 6; k++) { tmp.copy(c).multiplyScalar(shade); col.push(tmp.r, tmp.g, tmp.b); }
    }
    if (pos.length) { lists.soffitGeo.push({ positions: pos, colors: col }); stats.soffit = pos.length / 3; }
  }

  return stats;
}

function waterfrontPublicRealmLayout() {
  return WATERFRONT_WAVEDECKS.map((deck) => {
    const b = polygonBounds(deck.plan);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i <= 80; i++) {
      const x = b.x0 + ((b.x1 - b.x0) * i) / 80;
      const span = polygonZSpan(deck.plan, x);
      if (!span) continue;
      for (let k = 0; k <= 40; k++) {
        const z = span[0] + ((span[1] - span[0]) * k) / 40;
        const h = waterfrontDeckSurfaceHeight(deck, x, z);
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
    }
    return {
      id: deck.id, name: deck.name, osm: deck.osm, opened: deck.opened,
      lat: deck.lat, lon: deck.lon, area: Math.round(polygonArea(deck.plan) * 10) / 10,
      sourceArea: deck.sourceArea, planksSource: deck.planksSource, bench: deck.bench,
      bounds: b, x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, step: deck.step,
      lowest: lo, highest: hi,
      heightAboveLakeCrest: hi - WATER
    };
  });
}

// The decks are downtown-world geometry: only build them when the active frame really covers their mapped slips. This
// is a guard against drawing fixed downtown coordinates in an unrelated frame, not a hardcoded fallback: the actual
// land and water beside every deck are sampled from the loaded city data.
function supportedCityFrame() {
  const G = C?.GEO;
  if (!G || !G.frame || !G.frame.detail || !C?.CITY_BOUNDS) return false;
  if (!Array.isArray(G.roads) || G.roads.length === 0 || !Array.isArray(G.areas) || G.areas.length === 0) return false;
  if (typeof C.waterAt !== 'function' || typeof C.blockAt !== 'function') return false;
  const d = G.frame.detail;
  for (const deck of WATERFRONT_WAVEDECKS) {
    const b = polygonBounds(deck.plan);
    if (!(b.x0 > d.x0 && b.x1 < d.x1 && b.z0 > d.z0 && b.z1 < d.z1)) return false;
    let n = 0, dry = 0, wet = 0;
    for (let x = b.x0 + 1; x < b.x1 - 1; x += 2) {
      const span = polygonZSpan(deck.plan, x);
      if (!span) continue;
      n++;
      if (!C.waterAt(x, span[0] - 0.8)) dry++;
      if (C.waterAt(x, span[1] + 1.5)) wet++;
    }
    if (n < 3 || dry / n < 0.8 || wet / n < 0.8) return false;
  }
  return true;
}

// Called by vegetation placement before the scene builder; availability depends on the loaded frame.
let footprintFrame = null, footprintSupported = false;
function waterfrontDeckFootprintAt(x, z, margin = 0) {
  if (footprintFrame !== C?.GEO) {
    footprintFrame = C?.GEO;
    footprintSupported = supportedCityFrame();
  }
  if (!footprintSupported) return false;
  return WATERFRONT_WAVEDECKS.some((deck) => {
    const b = polygonBounds(deck.plan);
    if (x < b.x0 - margin || x > b.x1 + margin) return false;
    const span = polygonZSpan(deck.plan, Math.max(b.x0 + 1e-5, Math.min(b.x1 - 1e-5, x)));
    return span && z >= span[0] - margin && z <= span[1] + margin;
  });
}

// The polygons whose ground must not be drawn: each deck's full footprint. The city's street level, sidewalks and
// plots stop at the waterline and otherwise run right under the decks, so the gray pavement shows at the deck's sides
// and, once the timber steps below Queens Quay (Rees), through the boards themselves. Removing the pavement under the
// footprint is what makes the decks read as built over the water and shore rather than boards floating on a slab.
// Exported as plain [{id, plan}] so a caller can also use it on the CPU (tests, vegetation, placement).
function waterfrontDeckExclusionPolygons() {
  return WATERFRONT_WAVEDECKS.map((deck) => ({ id: deck.id, plan: deck.plan.map((p) => [p[0], p[1]]) }));
}

// Reusable TSL ground mask: a fragment whose world XZ point lies inside any deck footprint is discarded. Wire it into
// the city's ground materials after they are created, exactly as js/city-grid.js's road-cut mask is composed:
//
//   C.applyWaterfrontDeckGroundMask(cityGridGroundMaterial);   // the street level, sidewalks, plots, lawns
//
// It composes with an existing maskNode (the water mask and the road-cut mask) rather than replacing it, is a no-op if
// the active frame is unsupported (returns the material untouched) and marks the material so it is applied once.
// Nothing is drawn or mutated when called before the frame is known. The point-in-polygon runs in the shader, so there
// is no per-deck geometry to keep in step with the layout.
function applyWaterfrontDeckGroundMask(mat, THREE = C?.THREE) {
  if (!mat) return mat;
  if (mat.userData && mat.userData.waterfrontDeckMask) return mat;
  if (!supportedCityFrame()) return mat;
  const T = C?.TSL;
  if (!T || !mat.isNodeMaterial) return mat;
  const { Fn, positionWorld, float, select } = T;
  try {
    const node = Fn(() => {
      const p = positionWorld.xz;
      let inside = null;
      for (const deck of WATERFRONT_WAVEDECKS) {
        // Ray cast east from the point: an odd number of edge crossings means inside, exactly as the CPU point-in-ring
        // test. Only edges that span the point's z and lie to its east count; horizontal edges never do. Each deck is a
        // simple polygon, so the parity of its crossings is its membership.
        const plan = deck.plan;
        let crossings = float(0);
        for (let i = 0, j = plan.length - 1; i < plan.length; j = i++) {
          const ax = plan[j][0], az = plan[j][1], bx = plan[i][0], bz = plan[i][1];
          if (az === bz) continue;
          const inZ = p.y.greaterThanEqual(float(Math.min(az, bz))).and(p.y.lessThan(float(Math.max(az, bz))));
          const tEdge = p.y.sub(float(az)).div(float(bz - az));
          const xInt = float(ax).add(float(bx - ax).mul(tEdge));
          const left = p.x.lessThan(xInt);
          crossings = crossings.add(select(inZ.and(left), float(1), float(0)));
        }
        const odd = crossings.mod(2).greaterThan(0.5);
        inside = inside ? inside.or(odd) : odd;
      }
      return inside || float(0).greaterThan(float(1));
    })();
    mat.maskNode = mat.maskNode ? mat.maskNode.and(node.not()) : node.not();
    if (!mat.userData) mat.userData = {};
    mat.userData.waterfrontDeckMask = true;
    groundMaskApplied = true;
  } catch (err) {
    console.warn('[waterfrontPublicRealm] ground mask not applied:', err && err.message);
  }
  return mat;
}

function createWaterfrontPublicRealm(THREE = C?.THREE, scene = null) {
  if (!THREE) throw new Error('waterfront-public-realm: THREE is required');
  if (!supportedCityFrame()) {
    if (C) C.waterfrontPublicRealmEnabled = false;
    console.info('[waterfrontPublicRealm] skipped: the active city frame does not cover the mapped Spadina/Rees/Simcoe slips');
    return null;
  }
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const group = new THREE.Group();
  group.name = 'WaterfrontPublicRealm';

  const lists = { boards: [], fasciaGeo: [], rampGeo: [], soffitGeo: [], rails: [], posts: [], discs: [], tactile: [], beams: [], piles: [], nosing: [], toeRail: [], benches: [], THREE };
  const deckStats = {};
  for (const deck of WATERFRONT_WAVEDECKS) deckStats[deck.id] = addDeck(deck, lists);

  const wood = standardMaterial(THREE, { color: 0xffffff, roughness: 0.84, metalness: 0.0 });
  const darkWood = standardMaterial(THREE, { color: 0xffffff, roughness: 0.88, metalness: 0.0 });
  // the continuous fascia ribbon carries its own per-vertex timber tones. It is a vertical band whose winding differs
  // per deck (the plans are mixed winding), so it is double-sided: the outward face always shows, never a culled hole.
  const fasciaWood = standardMaterial(THREE, { color: 0xffffff, roughness: 0.9, metalness: 0.0, vertexColors: true, side: THREE.DoubleSide });
  // the sealed underside: dark timber, seen from below and the sides, so double-sided
  const soffitWood = standardMaterial(THREE, { color: 0xffffff, roughness: 0.95, metalness: 0.0, vertexColors: true, side: THREE.DoubleSide });
  const steel = standardMaterial(THREE, { color: 0xffffff, roughness: 0.34, metalness: 0.78 });
  const white = standardMaterial(THREE, { color: 0xffffff, roughness: 0.5, metalness: 0.05 });
  const dark = standardMaterial(THREE, { color: 0xffffff, roughness: 0.62, metalness: 0.05 });
  const concrete = standardMaterial(THREE, { color: 0xffffff, roughness: 0.9, metalness: 0.02 });

  const box = new THREE.BoxGeometry(1, 1, 1);
  const dot = new THREE.CylinderGeometry(1, 1, 1, 10);
  const pile = new THREE.CylinderGeometry(1, 1, 1, 8);
  const meshes = [];
  const add = (mesh, role) => { if (mesh) { mesh.userData.role = role; meshes.push(mesh); group.add(mesh); } };

  add(makeInstanced(THREE, box, wood, lists.boards, 'WaterfrontPublicRealm-Boards', { cullDistance: 900, cullCell: 120 }), 'deck-boards');

  // Merge a list of {positions, colors} ribbon geometries into one mesh (shared by the fascia and the corridor ramp).
  const addRibbon = (parts, material, name, role) => {
    const pos = [], col = [];
    for (const g of parts) { for (let i = 0; i < g.positions.length; i++) pos.push(g.positions[i]); for (let i = 0; i < g.colors.length; i++) col.push(g.colors[i]); }
    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.cullDistance = 900;
    mesh.userData.cullCell = 120;
    if (mesh.computeBoundingSphere) mesh.computeBoundingSphere();
    add(mesh, role);
  };
  // The continuous fascia ribbon (perimeter skirt), the barrier-free corridor ramps and the sealed underside soffit.
  addRibbon(lists.fasciaGeo, fasciaWood, 'WaterfrontPublicRealm-Fascia', 'deck-fascia');
  addRibbon(lists.rampGeo, fasciaWood, 'WaterfrontPublicRealm-CorridorRamps', 'accessible-route-ramp');
  addRibbon(lists.soffitGeo, soffitWood, 'WaterfrontPublicRealm-Soffit', 'deck-soffit');
  add(makeInstanced(THREE, box, steel, lists.rails, 'WaterfrontPublicRealm-Rails', { castShadow: false, cullDistance: 700, cullCell: 120 }), 'deck-rails');
  add(makeInstanced(THREE, box, steel, lists.posts, 'WaterfrontPublicRealm-RailPosts', { cullDistance: 700, cullCell: 120 }), 'deck-rail-posts');
  add(makeInstanced(THREE, box, steel, lists.toeRail, 'WaterfrontPublicRealm-ToeRail', { castShadow: false, cullDistance: 600, cullCell: 120 }), 'deck-toe-rail');
  add(makeInstanced(THREE, box, white, lists.nosing, 'WaterfrontPublicRealm-StepNosing', { castShadow: false, cullDistance: 600, cullCell: 120 }), 'step-nosing');
  add(makeInstanced(THREE, dot, steel, lists.discs, 'WaterfrontPublicRealm-AccessDiscs', { castShadow: false, cullDistance: 500, cullCell: 120 }), 'accessible-route-discs');
  add(makeInstanced(THREE, dot, dark, lists.tactile, 'WaterfrontPublicRealm-TactileDots', { castShadow: false, cullDistance: 500, cullCell: 120 }), 'deck-edge-tactile-dots');
  add(makeInstanced(THREE, box, darkWood, lists.beams, 'WaterfrontPublicRealm-Beams', { cullDistance: 700, cullCell: 120 }), 'deck-beams');
  add(makeInstanced(THREE, pile, concrete, lists.piles, 'WaterfrontPublicRealm-Piles', { cullDistance: 700, cullCell: 120 }), 'deck-piles');
  add(makeInstanced(THREE, box, wood, lists.benches, 'WaterfrontPublicRealm-Benches', { cullDistance: 700, cullCell: 120 }), 'backless-benches');

  // Support piles are the only collision-worthy below-deck members; the boards themselves are the walking surface.
  const colliders = [];
  for (const p of lists.piles) {
    colliders.push({
      minX: p.x - 0.16, maxX: p.x + 0.16, minZ: p.z - 0.16, maxZ: p.z + 0.16,
      minY: p.y - p.sy / 2, maxY: p.y + p.sy / 2, prop: true, kind: 'wavedepile',
      obb: { cx: p.x, cz: p.z, hx: 0.16, hz: 0.16, cs: 1, sn: 0 }
    });
  }

  let triangles = 0;
  for (const mesh of meshes) {
    const g = mesh.geometry;
    const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
    triangles += tris * (mesh.isInstancedMesh ? mesh.count : 1);
  }
  const fasciaQuads = Math.round(lists.fasciaGeo.reduce((a, g) => a + g.positions.length / 18, 0));
  const soffitVerts = lists.soffitGeo.reduce((a, g) => a + g.positions.length / 3, 0);
  const layout = waterfrontPublicRealmLayout();
  const stats = {
    decks: deckStats, layout, boards: lists.boards.length, fascia: fasciaQuads, soffit: soffitVerts,
    rails: lists.rails.length, posts: lists.posts.length, toeRail: lists.toeRail.length,
    discs: lists.discs.length, tactile: lists.tactile.length, beams: lists.beams.length,
    piles: lists.piles.length, nosing: lists.nosing.length, benchBoards: lists.benches.length,
    meshes: meshes.length, triangles: Math.round(triangles),
    colliders: colliders.length, ms: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 10) / 10
  };
  group.userData.waterfrontPublicRealm = stats;
  if (scene && scene.add) scene.add(group);
  const result = { group, root: group, colliders, stats, layout };
  // city-config.js's deck lookups (deckHeightAt/deckStoodOn) opt in only when the rendered decks exist.
  if (C) { C.waterfrontPublicRealm = result; C.waterfrontPublicRealmEnabled = true; }
  console.info(`[waterfrontPublicRealm] ${layout.map((d) => `${d.name} ${d.area} m² (${d.highest.toFixed(2)} m top)`).join(', ')}: ` +
    `${stats.boards} boards, ${stats.discs} discs, ${stats.piles} piles, ${stats.triangles} triangles, ${stats.ms} ms`);
  return result;
}

Object.assign(C || (window.CITY = {}), {
  WATERFRONT_WAVEDECKS,
  waterfrontPublicRealmLayout,
  waterfrontDeckSwellProfile,
  waterfrontDeckRawHeight,
  waterfrontDeckSurfaceHeight,
  waterfrontDeckSpanAt: polygonZSpan,
  supportedCityFrame,
  waterfrontDeckFootprintAt,
  waterfrontDeckExclusionPolygons,
  applyWaterfrontDeckGroundMask,
  waterfrontDeckGroundMasked: () => groundMaskApplied,
  waterfrontDeckFloor: (id) => { const d = WATERFRONT_WAVEDECKS.find((w) => w.id === id); return d ? deckFloor(d) : null; },
  createWaterfrontPublicRealm,
  buildWaterfrontPublicRealm: createWaterfrontPublicRealm
});
})();
