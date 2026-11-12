(function () {
// js/waterfront-hto-landscape.js
// HTO Park East's designed landscape: the pale concrete plaza, the isolated sodded berms and the mapped lake-edge
// timber boardwalk. The beach modules already place the umbrellas, chairs and sand on the verified OSM beach; this
// module adds the two primary landscape moves that make HtO read as HtO:
//   - an expansive pale concrete apron inside the mapped HTO Park East ring, replacing the generic park lawn between
//     the mounds while preserving the OSM sand ring, every mapped path and the mapped buildings;
//   - broad, low, rounded sodded berms (roughly 0.7-1.5 m high, broad shoulders blended to grade) arranged on the
//     plan's three rows and cut exactly to the mapped lawn, mapped paths, sand, water and the Toronto Fire and Marine
//     Station 334 / EMS station 36 fireboat building;
//   - a narrow timber boardwalk on the mapped south shore between the sand and the seawall, with planks perpendicular
//     to the shoreline, a gray tubular seawall rail and five long dark slab benches on the mapped promenade apron.
//
// The layout is fitted to the real committed geometry, never to image pixels as metres. The primary plan's normalized
// corners (NW .512,.437; NE .812,.416; SE .812,.894; SW .512,.827) and the fireboat building's plan centre (.567,.647)
// are control points in a weighted least-squares affine fit to the mapped HTO Park ring's four corners and the mapped
// building centre. The recorded residuals are a few metres (the plan is an earlier design), so every berm's extent and
// height is an estimate; it is clipped by ray-marching the actual mapped ring, park paths, sand, water and buildings.
// The boardwalk route is not fitted from the plan: it follows the mapped south park boundary (the seawall) and is
// clipped clear of the OSM sand and the mapped promenade path. HTO West is registered separately to its own mapped
// peninsula ring with four source corners (east quay north/south, north-west condominium boundary and south-west park
// corner). West is then built from the whole-peninsula native path topology: every enclosed clear face at or above an
// explicit 120 m² threshold becomes a grass footprint (paths and buildings excluded, quay-side open/boundary areas
// skipped), so the derived count is source-grounded and no ellipse replacement can move a white hole elsewhere.
//
// The berm sampler does not re-evaluate an analytic dome: it barycentrically interpolates the exact triangles that are
// rendered. The rendered boardwalk sits below the mapped promenade, so this module exports a pure cached ground-mask
// footprint (valid before the waterfront builder runs, because city-grid is built first) plus a composable TSL lawn
// mask. It never masks a mapped road or path. The captain wires the mask to the city-grid lawn only.
//
// Sources (recorded 2026-11-10):
// - ASLA 2009 Professional Awards, HtO (primary plan and photographs):
//   https://www.asla.org/awards-events-main-landing/honors-awards/pro-student-awards/2009-professional-awards/518
//   Local primary copies: $WATERFRONT_RESEARCH/research/hto-asla.html, hto-plan.webp, hto-gallery.json,
//   hto-photo-2.webp (aerial), hto-photo-7.webp (boardwalk and slab bench), hto-photo-9.webp (sodded berm).
// - Landscape Architecture Foundation, HTO Park: fine white sand, 25 mounds, 106 trees, boardwalk:
//   https://www.landscapeperformance.org/case-study-briefs/hto-park
// - OSM/committed geodata: HTO Park ring, HTO Park West ring, Peter Slip, the south promenade path, trees, and the
//   mapped fireboat building row named "Toronto Fire and Marine Station 334 EMS station 36". The HTO beach ring is the
//   shared window.CITY.WATERFRONT_SAND_RINGS.htoPark export (OSM way 189306980).
//
// Geometry conventions: 1 unit = 1 m, world x east, z south, city ground y = 0, sidewalk top CITY_BOUNDS.sidewalkHeight
// (0.22 m), park lawn top sidewalkHeight + 0.004. The plaza is 0.5 mm above the lawn, mapped paths stay 3.5 mm above the
// plaza, the berms stand on the plaza, and the timber boardwalk is a low step below the mapped promenade. One culling
// root, shared bounded materials, merged/instanced geometry.

const C = window.CITY;
const SW = () => C?.CITY_BOUNDS?.sidewalkHeight ?? 0.22;
const PAVING_TOP = () => SW() + 0.0045;
const BERM_BASE = () => PAVING_TOP() + 0.0015;
const TIMBER_TOP = () => SW() - 0.06;
const TIMBER_BASE = () => TIMBER_TOP() - 0.03;
const PATH_TOP = () => SW() + 0.008;

const HTO_PARK_NAME = 'HTO Park';
const HTO_WEST_NAME = 'HTO Park West';
const FIREBOAT_NAME = /Fire and Marine Station 334/i;

// Surface detail is deliberately material-only: the source-registered meshes (mapped ring, paths, sand, berm triangles,
// boardwalk footprint) do not move. Colours are sampled from the recorded reference photographs, not guessed:
// - HTO east paving (hto-photo-2.webp / hto-photo-7.webp / hto-city.jpg): dominant pale concrete tones #E0DDD9,
//   #D5DAD9, #D3D7D7, warm shadow #AB9F95 / #B2AA9B. The in-engine exposed surface is set a little deeper than the
//   sunlit photo highlight so the broad plaza stops reading as flat white.
// - Sodded berms (hto-photo-9.webp): the sunlit sod is olive/yellow-green, #758920, #5D6C1E, #889630, straw #969E54,
//   not the colder blue-green used before.
// Joint spacing is a procedural approximation (large cast-in-place concrete panels), not a surveyed joint layout.
const PAVING_DETAIL = { panelX: 4.2, panelZ: 3.0, joint: 0.012 };
// Turf is the dark, rich olive of the ASLA aerial. The first revision read as a pale lime carpet; the base is darkened
// well below it and the straw/dry tint is held low until an actual dry-patch reference exists. The node material adds
// the fine grain, so no per-blade geometry is used.
const TURF_DETAIL = { dry: 0xb9b47e, fine: 43.7, grain: 0.10 };

// Source planting facts. The 106-tree total is the Landscape Performance Series HTO Park brief (both East and West);
// the ASLA materials text names concrete, sod, long grasses and willows. Mapped City tree points remain the only tree
// coordinates used; anything else is a labelled proposal, never a generated coordinate.
const HTO_PLANTING_SOURCE = {
  treesBothSections: 106,
  shrubs: 25,
  grassTypes: 3,
  species: ['golden weeping willow', 'silver maple', 'serviceberry'],
  sodMixIncludes: ['red switch grass', 'long grasses'],
  source: 'Landscape Performance Series HTO Park brief; ASLA 2009 Professional Awards HtO materials text'
};

// The captain's manual digitization of the explicit tree-symbol circles on the actual ASLA 2009 plan. Pixel coordinates
// are image pixels (origin top-left, 1600 x 1014), not metres and not current inventory. This is a historical 2009 design
// reconstruction: symbol circles carry roughly 3-5 px of digitizing uncertainty, and the plan's own registration to the
// mapped park already has about 7.2 m residual at the fireboat building. The current City inventory supersedes any plan
// point, so points conflicting with it (or with paths/buildings/water/sand) are rejected, never moved. Source of the
// points: $WATERFRONT_RESEARCH/research/hto-plan-tree-points.json (captain, 2026-11-10).
const HTO_PLAN_TREE_POINTS = {
  source: 'ASLA 2009 HTO award landscape plan, $WATERFRONT_RESEARCH/research/hto-plan.webp',
  imageSize: [1600, 1014],
  basis: 'Captain-digitized tree-symbol circle centres; historical design positions, 3-5 px uncertainty, not surveyed. ' +
    'Registered with the module\'s existing plan homographies; conflicts are rejected, not moved.',
  westPixels: [
    [467, 459], [484, 460], [468, 480], [516, 460], [533, 452], [549, 452], [525, 484], [546, 486],
    [405, 552], [462, 500], [488, 502], [476, 523], [459, 559], [477, 562], [448, 582], [531, 522],
    [521, 547], [546, 559], [403, 615], [407, 641], [470, 637], [488, 647], [486, 681], [431, 698],
    [550, 614], [539, 657], [551, 686], [363, 698], [391, 701]
  ],
  eastPixels: [
    [858, 458], [871, 460], [887, 461], [856, 486], [885, 489], [930, 459], [945, 448], [941, 472],
    [938, 491], [950, 510], [1013, 453], [1034, 467], [1050, 443], [1057, 462], [1109, 451], [1138, 453],
    [1099, 477], [1124, 477], [1183, 449], [1196, 439], [1232, 434], [1027, 510], [1023, 519], [1054, 512],
    [1028, 570], [1059, 569], [1084, 548], [1192, 499], [1208, 484], [1221, 486], [1235, 486], [1214, 507],
    [879, 542], [915, 530], [935, 559], [1143, 532], [1163, 512], [1164, 546], [1143, 566], [1199, 545],
    [1219, 569], [1247, 560], [1061, 606], [1085, 628], [1107, 601], [1181, 604], [1171, 628], [1249, 634],
    [1236, 682], [856, 644], [958, 659], [953, 679], [982, 696], [861, 738], [1037, 649], [1038, 672],
    [1086, 682], [1116, 668], [1082, 718], [1105, 728], [1162, 705], [1191, 738]
  ]
};
const PLAN_TREE_CITY_DEDUPE = 5.5;   // a plan symbol this close to a mapped City trunk is a duplicate of current inventory
const PLAN_TREE_PLAN_DEDUPE = 2.0;   // two ambiguous overlapping symbols closer than this are one tree
const PLAN_TREE_MODEL = 'ez-oak-medium'; // generic deciduous; the typed height/crown are a typology estimate, not species


// The ASLA plan, normalized image coordinates. North is up, Queens Quay is the horizontal band at v ~ .39-.43.
const PLAN = {
  park: {
    nw: { u: 0.512, v: 0.437 }, ne: { u: 0.812, v: 0.416 },
    se: { u: 0.812, v: 0.894 }, sw: { u: 0.512, v: 0.827 }
  },
  west: {
    nw: { u: 0.245, v: 0.430 }, ne: { u: 0.373, v: 0.430 },
    se: { u: 0.373, v: 0.765 }, sw: { u: 0.116, v: 0.697 }
  },
  fireboat: { u: 0.567, v: 0.647 },
  // north row, middle row, south row: [u, v, width, height] (plan extents, image-normalized)
  eastBerms: [
    [0.548, 0.470, 0.041, 0.062], [0.588, 0.477, 0.035, 0.081], [0.649, 0.449, 0.045, 0.048],
    [0.702, 0.461, 0.051, 0.066], [0.757, 0.439, 0.052, 0.045],
    [0.567, 0.542, 0.074, 0.066], [0.662, 0.534, 0.059, 0.102], [0.719, 0.540, 0.043, 0.099],
    [0.767, 0.490, 0.049, 0.052], [0.767, 0.550, 0.052, 0.062],
    [0.595, 0.689, 0.070, 0.112], [0.648, 0.637, 0.035, 0.090], [0.680, 0.608, 0.057, 0.055],
    [0.728, 0.617, 0.044, 0.064], [0.769, 0.641, 0.049, 0.112], [0.681, 0.695, 0.058, 0.112],
    [0.744, 0.707, 0.066, 0.082]
  ],
  // HTO West: the captain-inspected plan's ten grassy areas on the peninsula, west of Peter Slip. The actual aerial
  // shows roughly nine separated low mounds with pale concrete lanes; clipping against the mapped ring/paths and the
  // adjacent condominium may reduce this list.
  westBerms: [
    [0.245, 0.497, 0.053, 0.130], [0.296, 0.463, 0.036, 0.048], [0.334, 0.466, 0.044, 0.061],
    [0.297, 0.507, 0.040, 0.045], [0.334, 0.540, 0.044, 0.072], [0.288, 0.566, 0.047, 0.065],
    [0.249, 0.612, 0.052, 0.077], [0.220, 0.669, 0.078, 0.068], [0.290, 0.670, 0.065, 0.110],
    [0.339, 0.644, 0.040, 0.120]
  ]
};

// Boardwalk offsets are metres inland from the mapped south seawall. The exact inner edge is capped by the mapped
// promenade path at each station, so the boards never cover a mapped path.
const BOARDWALK = { outer: 0.6, inner: 3.0, railHeight: 1.05, benchCount: 5, benchCandidateSpacing: 3.2 };

const hash = (x, z) => {
  const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return n - Math.floor(n);
};

function ringOf(areas, name) {
  if (!Array.isArray(areas)) return null;
  for (const a of areas) {
    if (!Array.isArray(a) || a[0] !== 'park' || a[1] !== name) continue;
    const flat = a[2];
    if (!Array.isArray(flat) || flat.length < 6) continue;
    const ring = [];
    for (let i = 0; i + 1 < flat.length; i += 2) ring.push([flat[i], flat[i + 1]]);
    if (ring.length >= 3) return ring;
  }
  return null;
}

function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function distanceToRing(ring, x, z) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0], az = ring[j][1], bx = ring[i][0], bz = ring[i][1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
    const ex = ax + dx * t - x, ez = az + dz * t - z;
    best = Math.min(best, ex * ex + ez * ez);
  }
  return Math.sqrt(best);
}

function ringBox(ring) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

function frameCovers(frame, box) {
  if (!frame) return false;
  const f = frame.detail || frame;
  return box.minX >= f.x0 && box.maxX <= f.x1 && box.minZ >= f.z0 && box.maxZ <= f.z1;
}

// The mapped HTO Park East corners, selected from the actual ring (not typed coordinates): north-west is the min-z
// vertex west of the ring's mid-x, north-east the min-z vertex east of it, south-east the max-z east vertex, south-west
// the max-z west vertex. This keeps the fit anchored to whatever committed ring is loaded.
function parkCorners(ring) {
  const box = ringBox(ring);
  const midX = (box.minX + box.maxX) / 2;
  let nw = null, ne = null, se = null, sw = null;
  for (const p of ring) {
    const [x, z] = p;
    if (x < midX) {
      if (!nw || z < nw[1]) nw = p;
      if (!sw || z > sw[1]) sw = p;
    } else {
      if (!ne || z < ne[1]) ne = p;
      if (!se || z > se[1]) se = p;
    }
  }
  if (!nw || !ne || !se || !sw) return null;
  return { nw, ne, se, sw };
}

function fireboatBuilding(geo, box) {
  if (!geo || !Array.isArray(geo.buildings)) return null;
  const pad = 120;
  let best = null, bestD = Infinity;
  for (const b of geo.buildings) {
    if (!Array.isArray(b) || b.length < 5) continue;
    const [cx, cz, , parts] = b;
    const name = b[9] || '';
    if (!FIREBOAT_NAME.test(name)) continue;
    if (cx < box.minX - pad || cx > box.maxX + pad || cz < box.minZ - pad || cz > box.maxZ + pad) continue;
    if (!Array.isArray(parts) || !parts.length) continue;
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (const part of parts) {
      if (!Array.isArray(part) || part.length < 4) continue;
      uMin = Math.min(uMin, part[0]); uMax = Math.max(uMax, part[1]);
      vMin = Math.min(vMin, part[2]); vMax = Math.max(vMax, part[3]);
    }
    if (!(uMax > uMin && vMax > vMin)) continue;
    const ang = b[2] || 0, cs = Math.cos(ang), sn = Math.sin(ang);
    const u = (uMin + uMax) / 2, v = (vMin + vMax) / 2;
    const centre = { x: cx + u * cs + v * sn, z: cz - u * sn + v * cs, ang, row: b };
    const d = Math.hypot(centre.x - (box.minX + box.maxX) / 2, centre.z - (box.minZ + box.maxZ) / 2);
    if (d < bestD) { bestD = d; best = centre; }
  }
  return best;
}

// Exact four-corner projective registration u,v -> x,z. The plan image is north-up while the mapped shoreline is
// angled, so its four source corners are used as corners, not as a rectangle: each keeps its own normalized v. The
// homography maps all four plan corners to the mapped ring corners exactly (zero corner residual); the mapped
// fireboat building is then a validation control and a hard footprint obstacle, with its residual reported separately.
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => row.slice().concat(b[i]));
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    if (p !== i) { const t = M[i]; M[i] = M[p]; M[p] = t; }
    const d = M[i][i];
    if (Math.abs(d) < 1e-12) return null;
    for (let j = i; j <= n; j++) M[i][j] /= d;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const f = M[k][i];
      for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
    }
  }
  return M.map((row) => row[n]);
}

function homography(controls) {
  const A = [], b = [];
  for (const { u, v, x, z } of controls) {
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * z, -v * z]); b.push(z);
  }
  const h = solveLinear(A, b);
  if (!h) return null;
  return {
    transform: (u, v) => {
      const w = h[6] * u + h[7] * v + 1;
      if (Math.abs(w) < 1e-9) return [NaN, NaN];
      return [(h[0] * u + h[1] * v + h[2]) / w, (h[3] * u + h[4] * v + h[5]) / w];
    },
    h
  };
}

function planFrame({ areas = C?.GEO?.areas, buildings = C?.GEO?.buildings, frame = C?.GEO?.frame } = {}) {
  const ring = ringOf(areas, HTO_PARK_NAME);
  if (!ring) return { supported: false, reason: `${HTO_PARK_NAME} ring not in the active GEO frame` };
  const box = ringBox(ring);
  if (!frameCovers(frame, box)) return { supported: false, reason: 'HTO Park East is not in the active GEO frame' };
  const corners = parkCorners(ring);
  if (!corners) return { supported: false, reason: 'HTO Park East ring has no usable corners' };
  const fireboat = fireboatBuilding({ buildings }, box);
  const controls = [
    { u: PLAN.park.nw.u, v: PLAN.park.nw.v, x: corners.nw[0], z: corners.nw[1] },
    { u: PLAN.park.ne.u, v: PLAN.park.ne.v, x: corners.ne[0], z: corners.ne[1] },
    { u: PLAN.park.se.u, v: PLAN.park.se.v, x: corners.se[0], z: corners.se[1] },
    { u: PLAN.park.sw.u, v: PLAN.park.sw.v, x: corners.sw[0], z: corners.sw[1] }
  ];
  const h = homography(controls);
  if (!h) return { supported: false, reason: 'plan fit is degenerate' };
  const named = { nw: corners.nw, ne: corners.ne, se: corners.se, sw: corners.sw };
  if (fireboat) named.fireboat = [fireboat.x, fireboat.z];
  let cornerResidual = 0;
  for (const c of controls) {
    const [x, z] = h.transform(c.u, c.v);
    cornerResidual = Math.max(cornerResidual, Math.hypot(x - c.x, z - c.z));
  }
  let buildingResidual = null;
  if (fireboat) {
    const [x, z] = h.transform(PLAN.fireboat.u, PLAN.fireboat.v);
    buildingResidual = Math.hypot(x - fireboat.x, z - fireboat.z);
  }
  return {
    supported: true, ring, box, corners: named, fireboat, transform: h.transform, h: h.h,
    residual: Math.round(cornerResidual * 10) / 10,
    buildingResidual: buildingResidual === null ? null : Math.round(buildingResidual * 10) / 10
  };
}

// HTO West is a separate mapped peninsula across Peter Slip. Its park ring is not rectangular: the north quay edge
// runs east-west at z ~566-571, the east quay edge is x ~-952.5, and the south-west edge tilts from (-1027.5, 648.7)
// to (-952.5, 661.7). The plan's corresponding corners keep the angled south edge and the west boundary that runs along
// the condominium frontage (plan u .245 at the north, .116 at the south-west).
function westParkCorners(ring) {
  const box = ringBox(ring);
  const midX = (box.minX + box.maxX) / 2;
  let ne = null, se = null, sw = null, nw = null;
  for (const p of ring) {
    const [x, z] = p;
    if (x >= midX) {
      if (!ne || z < ne[1]) ne = p;
      if (!se || z > se[1]) se = p;
    } else {
      if (!nw || z < nw[1]) nw = p;
      if (!sw || z > sw[1]) sw = p;
    }
  }
  if (!nw || !ne || !se || !sw) return null;
  return { nw, ne, se, sw };
}

function westPlanFrame({ areas = C?.GEO?.areas, frame = C?.GEO?.frame } = {}) {
  const ring = ringOf(areas, HTO_WEST_NAME);
  if (!ring) return { supported: false, reason: `${HTO_WEST_NAME} ring not in the active GEO frame` };
  const box = ringBox(ring);
  if (!frameCovers(frame, box)) return { supported: false, reason: 'HTO Park West is not in the active GEO frame' };
  const corners = westParkCorners(ring);
  if (!corners) return { supported: false, reason: 'HTO Park West ring has no usable corners' };
  const controls = [
    { u: PLAN.west.nw.u, v: PLAN.west.nw.v, x: corners.nw[0], z: corners.nw[1] },
    { u: PLAN.west.ne.u, v: PLAN.west.ne.v, x: corners.ne[0], z: corners.ne[1] },
    { u: PLAN.west.se.u, v: PLAN.west.se.v, x: corners.se[0], z: corners.se[1] },
    { u: PLAN.west.sw.u, v: PLAN.west.sw.v, x: corners.sw[0], z: corners.sw[1] }
  ];
  const h = homography(controls);
  if (!h) return { supported: false, reason: 'HTO West plan fit is degenerate' };
  let residual = 0;
  for (const c of controls) {
    const [x, z] = h.transform(c.u, c.v);
    residual = Math.max(residual, Math.hypot(x - c.x, z - c.z));
  }
  return {
    supported: true, ring, box, corners, transform: h.transform, h: h.h,
    residual: Math.round(residual * 10) / 10,
    namedAdjacentBuilding: null,
    adjacentBuildingNote: 'No named building row borders the West peninsula in the committed geodata (the only nearby named row, Maple Leaf Quay, is north at z ~503); the adjacent unnamed condominium row is used as a hard clip, not a named control.'
  };
}

// The mapped OSM beach ring, shared with the beach/furniture modules. A documented fallback keeps this module
// self-contained when it is loaded before the beach modules; it is the same OSM way 189306980 ring.
const HTO_SAND_FALLBACK = [
  [-873.3, 667.9], [-766.8, 680.7], [-766.7, 663.6], [-787.2, 663.7], [-787.3, 660.6],
  [-854.8, 660.7], [-854.7, 663.7], [-873.3, 663.8]
];
const htoSandRing = () => {
  const shared = C?.WATERFRONT_SAND_RINGS?.htoPark;
  return Array.isArray(shared) && shared.length >= 3 ? shared : HTO_SAND_FALLBACK;
};

// Mapped park-path and cycling corridors inside (or within 10 m of) the HTO frame box. Filtering once here keeps the
// berm ray-march and boardwalk bench probes local; the old all-city scan took more than 20 s. One cached layout per
// GEO means this filter runs once, not per height query.
function pathSegments(geo = C?.GEO, box = null) {
  const out = [];
  const pad = 10;
  const near = (x, z) => !box || (x >= box.minX - pad && x <= box.maxX + pad && z >= box.minZ - pad && z <= box.maxZ + pad);
  if (Array.isArray(geo?.parkPaths)) {
    for (const row of geo.parkPaths) {
      if (!Array.isArray(row) || row.length < 5 || typeof row[0] !== 'number') continue;
      const half = (row[0] > 0 ? row[0] : 1.8) / 2;
      for (let i = 3; i + 1 < row.length; i += 2) {
        const ax = row[i - 2], az = row[i - 1], bx = row[i], bz = row[i + 1];
        if (near(ax, az) || near(bx, bz)) out.push({ ax, az, bx, bz, half });
      }
    }
  }
  if (Array.isArray(geo?.cycling?.bands)) {
    for (const row of geo.cycling.bands) {
      if (!Array.isArray(row) || row.length < 6 || !Array.isArray(row[2])) continue;
      const pts = row[2], half = 1.5;
      for (let i = 2; i + 1 < pts.length; i += 2) {
        const ax = pts[i - 2], az = pts[i - 1], bx = pts[i], bz = pts[i + 1];
        if (near(ax, az) || near(bx, bz)) out.push({ ax, az, bx, bz, half });
      }
    }
  }
  return out;
}

function distanceToSegment(x, z, s) {
  const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L2)) : 0;
  return Math.hypot(s.ax + dx * t - x, s.az + dz * t - z);
}

function pathClearance(x, z, paths) {
  let best = Infinity;
  for (const s of paths) {
    const d = distanceToSegment(x, z, s) - s.half;
    if (d < best) best = d;
  }
  return best;
}

function buildingParts(geo, box, pad = 80) {
  const out = [];
  if (!geo || !Array.isArray(geo.buildings)) return out;
  for (const b of geo.buildings) {
    if (!Array.isArray(b) || b.length < 4) continue;
    const [cx, cz, ang, parts] = b;
    if (cx < box.minX - pad || cx > box.maxX + pad || cz < box.minZ - pad || cz > box.maxZ + pad) continue;
    if (!Array.isArray(parts)) continue;
    const cs = Math.cos(ang || 0), sn = Math.sin(ang || 0);
    for (const part of parts) {
      if (!Array.isArray(part) || part.length < 4) continue;
      const [u0, u1, v0, v1] = part;
      const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
      out.push({
        x: cx + uc * cs + vc * sn, z: cz - uc * sn + vc * cs,
        cs, sn, hx: (u1 - u0) / 2, hz: (v1 - v0) / 2
      });
    }
  }
  return out;
}

function insideBuilding(parts, x, z, margin = 0) {
  for (const p of parts) {
    const dx = x - p.x, dz = z - p.z;
    if (Math.abs(dx * p.cs - dz * p.sn) <= p.hx + margin && Math.abs(dx * p.sn + dz * p.cs) <= p.hz + margin) return true;
  }
  return false;
}

const wobbleOf = (phase) => (theta) =>
  1 + 0.10 * Math.sin(3 * theta + phase) + 0.06 * Math.sin(5 * theta + phase * 1.7);

const SECTORS = 48;
const BERM_RINGS = 8;

function buildBermMesh(cx, cz, Ux, Uz, Vx, Vz, sectorLimit, wobble, height) {
  const base = BERM_BASE();
  const positions = [];
  const indices = [];
  positions.push(cx, base + height, cz);
  for (let j = 1; j <= BERM_RINGS; j++) {
    const f = j / BERM_RINGS;
    for (let k = 0; k < SECTORS; k++) {
      const theta = (k / SECTORS) * Math.PI * 2;
      const r = f * sectorLimit[k] * wobble(theta);
      const lx = Math.cos(theta) * Ux + Math.sin(theta) * Vx;
      const lz = Math.cos(theta) * Uz + Math.sin(theta) * Vz;
      const y = base + height * (1 - f * f) * (1 - f * f);
      positions.push(cx + r * lx, y, cz + r * lz);
    }
  }
  const pushUp = (a, b, c) => {
    const ax = positions[a * 3], az = positions[a * 3 + 2];
    const bx = positions[b * 3], bz = positions[b * 3 + 2];
    const cx2 = positions[c * 3], cz2 = positions[c * 3 + 2];
    const ny = (bz - az) * (cx2 - ax) - (bx - ax) * (cz2 - az);
    if (ny > 0) indices.push(a, b, c); else indices.push(a, c, b);
  };
  for (let k = 0; k < SECTORS; k++) pushUp(0, 1 + k, 1 + ((k + 1) % SECTORS));
  for (let j = 1; j < BERM_RINGS; j++) {
    const row = 1 + (j - 1) * SECTORS, next = row + SECTORS;
    for (let k = 0; k < SECTORS; k++) {
      const k2 = (k + 1) % SECTORS;
      pushUp(row + k, next + k, row + k2);
      pushUp(row + k2, next + k, next + k2);
    }
  }
  const tris = [];
  for (let i = 0; i < indices.length; i += 3) tris.push([indices[i], indices[i + 1], indices[i + 2]]);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { positions, indices, tris, minX, maxX, minZ, maxZ };
}

// A berm's local frame: centre, world half-axes for the plan's width/depth, a deterministic irregular radius, the 48
// sector limits found by ray-marching the actual obstacles, and the exact triangle mesh used by both the renderer and
// the surface sampler.
function makeBerm({ id, u, v, w, h, transform, ring, sand, paths, buildings, waterAt, prior }) {
  const [cx, cz] = transform(u, v);
  const [xw, zw] = transform(u - w / 2, v);
  const [xe, ze] = transform(u + w / 2, v);
  const [xn, zn] = transform(u, v - h / 2);
  const [xs, zs] = transform(u, v + h / 2);
  const rx = Math.hypot(xe - xw, ze - zw) / 2;
  const rz = Math.hypot(xs - xn, zs - zn) / 2;
  if (!(rx > 2 && rz > 2)) return null;
  let ux = (xe - xw) / (2 * rx), uz = (ze - zw) / (2 * rx);
  let vx = (xs - xn) / (2 * rz), vz = (zs - zn) / (2 * rz);
  const dot = ux * vx + uz * vz;
  vx -= ux * dot; vz -= uz * dot;
  const vLen = Math.hypot(vx, vz);
  if (!(vLen > 1e-6)) return null;
  vx /= vLen; vz /= vLen;
  const Ux = ux * rx, Uz = uz * rx, Vx = vx * rz, Vz = vz * rz;
  const det = Ux * Vz - Uz * Vx;
  if (Math.abs(det) < 1e-9) return null;
  const W = wobbleOf(hash(cx, cz) * Math.PI * 2);
  const height = estimateBermHeight(Math.max(rx, rz), cx, cz);

  const clearCentre = (x, z, pathMargin, buildingMargin) => {
    if (!pointInRing(ring, x, z) || distanceToRing(ring, x, z) < 1.2) return false;
    if (waterAt && waterAt(x, z)) return false;
    if (pointInRing(sand, x, z)) return false;
    if (pathClearance(x, z, paths) < pathMargin) return false;
    if (insideBuilding(buildings, x, z, buildingMargin)) return false;
    for (const p of prior) {
      const [a, b] = p.local2(x, z);
      const theta = Math.atan2(b, a);
      if (Math.hypot(a, b) / p.wobble(theta) < 1.05) return false;
    }
    return true;
  };

  let scx = cx, scz = cz, shift = 0;
  if (!clearCentre(cx, cz, 0.6, 0.8)) {
    let found = null;
    outer: for (let radius = 0.5; radius <= 2.0; radius += 0.5) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const nx = cx + Math.cos(a) * radius, nz = cz + Math.sin(a) * radius;
        if (clearCentre(nx, nz, 0.6, 0.8)) { found = [nx, nz]; break outer; }
      }
    }
    if (!found) return null;
    scx = found[0]; scz = found[1];
    shift = Math.hypot(scx - cx, scz - cz);
  }

  const local2 = (x, z) => {
    const dx = x - scx, dz = z - scz;
    return [(dx * Vz - dz * Vx) / det, (Ux * dz - Uz * dx) / det];
  };

  function blockedBerm(x, z) {
    if (!pointInRing(ring, x, z) || distanceToRing(ring, x, z) < 0.35) return true;
    if (waterAt && waterAt(x, z)) return true;
    if (pointInRing(sand, x, z)) return true;
    if (pathClearance(x, z, paths) < 0.2) return true;
    if (insideBuilding(buildings, x, z, 0.35)) return true;
    for (const p of prior) {
      const [a, b] = p.local2(x, z);
      const theta = Math.atan2(b, a);
      const rho = Math.hypot(a, b) / p.wobble(theta);
      if (rho < 0.98) return true;
    }
    return false;
  }

  const sectorLimit = new Float32Array(SECTORS).fill(1);
  let sum = 0;
  for (let k = 0; k < SECTORS; k++) {
    const theta = (k / SECTORS) * Math.PI * 2;
    const wx = W(theta) * (Math.cos(theta) * Ux + Math.sin(theta) * Vx);
    const wz = W(theta) * (Math.cos(theta) * Uz + Math.sin(theta) * Vz);
    let r = 1;
    const steps = 24;
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      if (blockedBerm(scx + wx * f, scz + wz * f)) { r = Math.max(0.08, (i - 1) / steps - 0.02); break; }
    }
    sectorLimit[k] = r;
    sum += r;
  }
  if (sum / SECTORS < 0.34) return null;

  const mesh = buildBermMesh(scx, scz, Ux, Uz, Vx, Vz, sectorLimit, W, height);
  const berm = {
    id, plan: { u, v, w, h }, cx: scx, cz: scz, rx, rz, Ux, Uz, Vx, Vz, det, wobble: W,
    height, sectorLimit, shift: Math.round(shift * 10) / 10, local2, face: false,
    mesh
  };
  const scale = Math.max(rx, rz);
  berm.contains = (x, z, margin = 0) => {
    const [a, b] = local2(x, z);
    const theta = Math.atan2(b, a);
    return Math.hypot(a, b) / W(theta) <= sectorLimitAtInternal(sectorLimit, theta) + margin / scale;
  };
  return berm;
}

function estimateBermHeight(radius, x, z) {
  return Math.max(0.75, Math.min(1.45, 0.78 + 0.0225 * radius + 0.16 * hash(x + 7, z - 3)));
}

// Whole-peninsula West face extraction from the native mapped path topology. Paths and buildings block a 0.5 m grid;
// every cell not reachable from the grid boundary is an enclosed clear face (the quay-side open promenade is therefore
// excluded). Faces below the explicit area threshold are dropped as slivers, and every remaining face becomes a grass
// footprint. This derives the West mound count from the mapped topology instead of forcing the original plan count.
const WEST_FACE_MIN_AREA = 120;

function westFaceComponents(ring, paths, buildings, waterAt, box) {
  const step = 0.5;
  const x0 = box.minX - 4, z0 = box.minZ - 4;
  const nx = Math.ceil((box.maxX - box.minX + 8) / step) + 1;
  const nz = Math.ceil((box.maxZ - box.minZ + 8) / step) + 1;
  const idx = (i, j) => i * nz + j;
  const blocked = new Uint8Array(nx * nz);
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const x = x0 + i * step, z = z0 + j * step;
      let b = !pointInRing(ring, x, z) || distanceToRing(ring, x, z) < 0.8;
      if (!b && pathClearance(x, z, paths) < 0.5) b = true;
      if (!b && insideBuilding(buildings, x, z, 0.45)) b = true;
      if (!b && waterAt && waterAt(x, z)) b = true;
      blocked[idx(i, j)] = b ? 1 : 0;
    }
  }
  const seen = new Uint8Array(nx * nz);
  const queue = [];
  for (let i = 0; i < nx; i++) for (const j of [0, nz - 1]) {
    if (!blocked[idx(i, j)] && !seen[idx(i, j)]) { seen[idx(i, j)] = 1; queue.push([i, j]); }
  }
  for (let j = 0; j < nz; j++) for (const i of [0, nx - 1]) {
    if (!blocked[idx(i, j)] && !seen[idx(i, j)]) { seen[idx(i, j)] = 1; queue.push([i, j]); }
  }
  for (let q = 0; q < queue.length; q++) {
    const [i, j] = queue[q];
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
      const t = idx(ni, nj);
      if (seen[t] || blocked[t]) continue;
      seen[t] = 1; queue.push([ni, nj]);
    }
  }
  const comp = new Int32Array(nx * nz).fill(-1);
  const meta = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const t = idx(i, j);
      if (blocked[t] || seen[t] || comp[t] >= 0) continue;
      const id = meta.length;
      let cx = 0, cz = 0, n = 0;
      const stack = [[i, j]];
      comp[t] = id;
      while (stack.length) {
        const [a, b] = stack.pop();
        cx += x0 + a * step; cz += z0 + b * step; n++;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = a + di, nj = b + dj;
          if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
          const tt = idx(ni, nj);
          if (comp[tt] >= 0 || blocked[tt] || seen[tt]) continue;
          comp[tt] = id; stack.push([ni, nj]);
        }
      }
      meta.push({ id, cx: cx / n, cz: cz / n, cells: n, area: n * step * step });
    }
  }
  const faces = [];
  for (const m of meta) {
    if (m.area < WEST_FACE_MIN_AREA) continue;
    let i0 = nx, i1 = -1, j0 = nz, j1 = -1;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      if (comp[idx(i, j)] !== m.id) continue;
      if (i < i0) i0 = i; if (i > i1) i1 = i;
      if (j < j0) j0 = j; if (j > j1) j1 = j;
    }
    const w = i1 - i0 + 1, h = j1 - j0 + 1;
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) mask[i * h + j] = comp[idx(i0 + i, j0 + j)] === m.id ? 1 : 0;
    const dist = distanceToFaceEdge(mask, w, h);
    let maxDist = 0;
    for (let i = 0; i < dist.length; i++) if (dist[i] > maxDist) maxDist = dist[i];
    // The long narrow component outside the mapped perimeter footway is the
    // paved quay apron visible in the ASLA aerial, not a grass mound. Its
    // largest interior radius is 2.5 m; the smallest retained lawn face is 4.5 m.
    if (maxDist * step <= 3) continue;
    // Use the deepest interior cell (the crest cell) as the face centre/representative point, so centre sampling and
    // design-area association are always inside the derived face even when the component is concave.
    let bestI = 0, bestJ = 0, bestDist = -1;
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) {
      if (dist[i * h + j] > bestDist) { bestDist = dist[i * h + j]; bestI = i; bestJ = j; }
    }
    const faceCx = x0 + (i0 + bestI) * step, faceCz = z0 + (j0 + bestJ) * step;
    // Skip faces whose cell corners leave the mapped ring (quay-side boundary faces) so no grass vertex is off-park.
    let edgeFace = false;
    for (let i = 0; i < w && !edgeFace; i++) {
      for (let j = 0; j < h && !edgeFace; j++) {
        if (!mask[i * h + j]) continue;
        for (const [di, dj] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
          const px = x0 + (i0 + i + di) * step, pz = z0 + (j0 + j + dj) * step;
          if (!pointInRing(ring, px, pz)) { edgeFace = true; break; }
        }
      }
    }
    if (edgeFace) continue;
    faces.push({
      id: m.id, cx: faceCx, cz: faceCz, cells: m.cells, area: Math.round(m.area),
      x0: x0 + i0 * step, z0: z0 + j0 * step, w, h, step, mask, dist, maxDist
    });
  }
  faces.sort((a, b) => b.area - a.area);
  return faces;
}

// BFS distance (in cells) from every face cell to the nearest non-face cell; boundary cells are 1.
function distanceToFaceEdge(mask, w, h) {
  const dist = new Int32Array(w * h);
  const queue = [];
  const at = (i, j) => (i < 0 || j < 0 || i >= w || j >= h ? 0 : mask[i * h + j]);
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) {
      if (!mask[i * h + j]) continue;
      if (!at(i - 1, j) || !at(i + 1, j) || !at(i, j - 1) || !at(i, j + 1)) { dist[i * h + j] = 1; queue.push([i, j]); }
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const [i, j] = queue[q];
    const d = dist[i * h + j];
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
      const t = ni * h + nj;
      if (!mask[t] || dist[t]) continue;
      dist[t] = d + 1; queue.push([ni, nj]);
    }
  }
  return dist;
}

// Round the derived face's 0.5 m cell staircase into a smooth source-clipped edge. Only perimeter vertices move, only
// inward, and only while the moved point stays inside the original allowed mask cells (so it can never expand onto a
// mapped path, the quay or off-park). Triangulation, vertex count and the exact surface sampler are unchanged: the
// sampler reads these same moved vertices. A triangle-inversion guard reverts any move that would fold a face.
function relaxFaceBoundary({ positions, indices, vertex, mask, w, h, step, x0, z0 },
  { iterations = 4, alpha = 0.55, maxFrac = 0.30 } = {}) {
  const keyW = h + 1;
  const nodes = [];
  for (const [key, index] of vertex) {
    const ci = Math.floor(key / keyW), cj = key - ci * keyW;
    let count = 0;
    for (const [di, dj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      const i = ci + di, j = cj + dj;
      if (i >= 0 && j >= 0 && i < w && j < h && mask[i * h + j]) count++;
    }
    nodes.push({ index, ci, cj, boundary: count < 4 });
  }
  const allowedAt = (x, z) => {
    const ci = Math.round((x - x0) / step), cj = Math.round((z - z0) / step);
    for (const di of [-1, 0]) for (const dj of [-1, 0]) {
      const i = ci + di, j = cj + dj;
      if (i >= 0 && j >= 0 && i < w && j < h && mask[i * h + j]) return true;
    }
    return false;
  };
  const neighborsOf = (n) => {
    const out = [];
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      if (!di && !dj) continue;
      const v = vertex.get((n.ci + di) * keyW + (n.cj + dj));
      if (v !== undefined) out.push(v);
    }
    return out;
  };
  const triAdj = new Map();
  for (let t = 0; t < indices.length; t += 3) {
    for (const v of [indices[t], indices[t + 1], indices[t + 2]]) {
      let l = triAdj.get(v);
      if (!l) { l = []; triAdj.set(v, l); }
      l.push(t);
    }
  }
  const nyAt = (p, t) => {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    return (p[b + 2] - p[a + 2]) * (p[c] - p[a]) - (p[b] - p[a]) * (p[c + 2] - p[a + 2]);
  };
  const maxMove = maxFrac * step;
  let moved = 0;
  for (let it = 0; it < iterations; it++) {
    const before = positions.slice();
    const touched = new Set();
    for (const n of nodes) {
      if (!n.boundary) continue;
      const nbs = neighborsOf(n);
      if (!nbs.length) continue;
      let sx = 0, sz = 0;
      for (const v of nbs) { sx += positions[v * 3]; sz += positions[v * 3 + 2]; }
      const tx = sx / nbs.length, tz = sz / nbs.length;
      const dx = tx - positions[n.index * 3], dz = tz - positions[n.index * 3 + 2];
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) continue;
      const scale = Math.min(1, maxMove / len) * alpha;
      const nx = positions[n.index * 3] + dx * scale, nz = positions[n.index * 3 + 2] + dz * scale;
      if (!allowedAt(nx, nz)) continue;
      positions[n.index * 3] = nx; positions[n.index * 3 + 2] = nz;
      touched.add(n.index);
    }
    if (!touched.size) break;
    const revert = new Set();
    for (const v of touched) {
      for (const t of triAdj.get(v) || []) {
        const n0 = nyAt(before, t), n1 = nyAt(positions, t);
        if (n0 === 0) continue;
        if (Math.sign(n1) !== Math.sign(n0) || Math.abs(n1) < 1e-9) { revert.add(v); break; }
      }
    }
    for (const v of revert) { positions[v * 3] = before[v * 3]; positions[v * 3 + 2] = before[v * 3 + 2]; }
    moved += touched.size - revert.size;
  }
  return moved;
}

// A berm whose footprint is a derived native-path face: a dense grid mesh over the face cells, with height rising from
// zero at the face edge to a broad crown. The sampler reads the same triangles as the renderer.
function makeGridFaceBerm({ id, face, plan, planCentreDistance }) {
  const { w, h, mask, dist, maxDist, step, x0, z0 } = face;
  const height = estimateBermHeight(Math.max(step * 0.6 * maxDist, 4), face.cx, face.cz);
  const base = BERM_BASE();
  const positions = [];
  const indices = [];
  const vertex = new Map();
  const heightAt = (ci, cj) => {
    let count = 0, minD = Infinity;
    for (const [di, dj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= w || j >= h || !mask[i * h + j]) continue;
      count++; minD = Math.min(minD, dist[i * h + j]);
    }
    if (!count) return null;
    if (count < 4) return base;
    const t = Math.min(1, minD / maxDist);
    return base + height * t * t * (3 - 2 * t);
  };
  const vertexIndex = (ci, cj) => {
    const key = ci * (h + 1) + cj;
    if (vertex.has(key)) return vertex.get(key);
    const y = heightAt(ci, cj);
    if (y === null) return -1;
    const index = positions.length / 3;
    positions.push(x0 + ci * step, y, z0 + cj * step);
    vertex.set(key, index);
    return index;
  };
  const pushUp = (a, b, c) => {
    if (a < 0 || b < 0 || c < 0) return;
    const ax = positions[a * 3], az = positions[a * 3 + 2];
    const bx = positions[b * 3], bz = positions[b * 3 + 2];
    const cx2 = positions[c * 3], cz2 = positions[c * 3 + 2];
    const ny = (bz - az) * (cx2 - ax) - (bx - ax) * (cz2 - az);
    if (Math.abs(ny) < 1e-12) return;
    if (ny > 0) indices.push(a, b, c); else indices.push(a, c, b);
  };
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) {
      if (!mask[i * h + j]) continue;
      const a = vertexIndex(i, j), b = vertexIndex(i + 1, j), c = vertexIndex(i + 1, j + 1), d = vertexIndex(i, j + 1);
      pushUp(a, b, c);
      pushUp(a, c, d);
    }
  }
  if (indices.length < 12) return null;
  // Keep the raw cell positions for tests/before-after, then round the perimeter inward within the allowed cells only.
  const rawPositions = positions.slice();
  const edgeMoved = relaxFaceBoundary({ positions, indices, vertex, mask, w, h, step, x0, z0 });
  const tris = [];
  for (let i = 0; i < indices.length; i += 3) tris.push([indices[i], indices[i + 1], indices[i + 2]]);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const limitRadius = [];
  for (let k = 0; k < SECTORS; k++) limitRadius.push(maxDist * step);
  const faceBerm = {
    id, plan, cx: face.cx, cz: face.cz, rx: face.area / (2 * (face.w + face.h) * step), rz: 0,
    Ux: 1, Uz: 0, Vx: 0, Vz: 1, det: 1, wobble: () => 1, height,
    sectorLimit: Float32Array.from(limitRadius), shift: 0, face: true, gridFace: true,
    faceArea: face.area, faceTarget: [face.cx, face.cz], designAreaDistance: planCentreDistance,
    planCentre: undefined, edgeMoved, faceData: face,
    mesh: { positions, indices, tris, minX, maxX, minZ, maxZ, rawPositions },
    contains(x, z, margin = 0) {
      const r = Math.ceil(Math.max(0, margin) / step);
      const ci = Math.round((x - x0) / step), cj = Math.round((z - z0) / step);
      for (let i = ci - r; i <= ci + r; i++) {
        for (let j = cj - r; j <= cj + r; j++) {
          if (i < 0 || j < 0 || i >= w || j >= h) continue;
          if (mask[i * h + j]) return true;
        }
      }
      return false;
    }
  };
  return faceBerm;
}


function sectorLimitAtInternal(sectorLimit, theta) {
  const a = ((theta / (Math.PI * 2)) % 1 + 1) % 1;
  const f = a * SECTORS;
  const i = Math.floor(f) % SECTORS;
  const j = (i + 1) % SECTORS;
  const t = f - Math.floor(f);
  return sectorLimit[i] * (1 - t) + sectorLimit[j] * t;
}

function sectorLimitAt(berm, theta) {
  const a = ((theta / (Math.PI * 2)) % 1 + 1) % 1;
  const f = a * SECTORS;
  const i = Math.floor(f) % SECTORS;
  const j = (i + 1) % SECTORS;
  const t = f - Math.floor(f);
  return berm.sectorLimit[i] * (1 - t) + berm.sectorLimit[j] * t;
}

// Exact surface on the rendered triangle mesh: point-in-triangle in XZ then barycentric y. This is the same triangle
// data bergGeometry uploads, so the sampler and the grass cannot disagree.
function bermSurface(berm, x, z) {
  const m = berm.mesh;
  if (x < m.minX || x > m.maxX || z < m.minZ || z > m.maxZ) return null;
  const p = m.positions;
  for (const [i0, i1, i2] of m.tris) {
    const ax = p[i0 * 3], az = p[i0 * 3 + 2];
    const bx = p[i1 * 3], bz = p[i1 * 3 + 2];
    const cx = p[i2 * 3], cz = p[i2 * 3 + 2];
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(den) < 1e-12) continue;
    const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den;
    const w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den;
    const w2 = 1 - w0 - w1;
    if (w0 < -1e-7 || w1 < -1e-7 || w2 < -1e-7) continue;
    const y = w0 * p[i0 * 3 + 1] + w1 * p[i1 * 3 + 1] + w2 * p[i2 * 3 + 1];
    return { h: y, y: y - BERM_BASE() };
  }
  return null;
}

// The mapped south-shore footway is the boardwalk's source alignment. The longest committed park path running along the
// SW -> SE park edge is used, so the timber deck replaces nothing and follows the real shoreline instead of a guessed
// straight line. The straight SW -> SE edge is only a fallback when no such mapped path exists.
function polylineRoute(points, width) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const cum = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    cum.push(total);
  }
  if (!(total > 20)) return null;
  const at = (d) => {
    const x = Math.max(0, Math.min(total, d));
    let i = 1;
    while (i < cum.length && cum[i] < x) i++;
    const a = points[i - 1], b = points[Math.min(points.length - 1, i)];
    const segLen = Math.max(1e-9, cum[i] - cum[i - 1]);
    const t = (x - cum[i - 1]) / segLen;
    const tx = (b[0] - a[0]) / segLen, tz = (b[1] - a[1]) / segLen;
    return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, tx, tz };
  };
  return { points, width, length: total, at };
}

function shorePathRoute(geo, frame) {
  const [sx, sz] = frame.corners.sw;
  const [ex, ez] = frame.corners.se;
  const dx = ex - sx, dz = ez - sz, L = Math.hypot(dx, dz);
  const tx = dx / L, tz = dz / L;
  let best = null, bestScore = Infinity;
  for (const row of geo?.parkPaths || []) {
    if (!Array.isArray(row) || row.length < 7 || typeof row[0] !== 'number') continue;
    const width = row[0] > 0 ? row[0] : 2;
    if (width < 1 || width > 4) continue;
    const pts = [];
    for (let i = 1; i + 1 < row.length; i += 2) pts.push([row[i], row[i + 1]]);
    if (pts.length < 2) continue;
    let mean = 0, min = Infinity, max = -Infinity;
    for (const [x, z] of pts) {
      const d = Math.abs((x - sx) * tz - (z - sz) * tx);
      mean += d; min = Math.min(min, d); max = Math.max(max, d);
    }
    mean /= pts.length;
    if (mean > 5 || max > 12) continue;
    const route = polylineRoute(pts, width);
    if (!route || route.length < 60) continue;
    const score = mean + (route.length < L * 0.65 ? 20 : 0);
    if (score < bestScore) { bestScore = score; best = route; }
  }
  if (best) return best;
  return polylineRoute([[sx, sz], [ex, ez]], 2);
}

function nearestPathPoint(x, z, paths, max = 6) {
  let best = Infinity, bx = null, bz = null, bt = null;
  for (const s of paths) {
    const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L2)) : 0;
    const px = s.ax + dx * t, pz = s.az + dz * t;
    const d = Math.hypot(px - x, pz - z) - s.half;
    if (d < best) { best = d; bx = px; bz = pz; const L = Math.sqrt(L2) || 1; bt = [dx / L, dz / L]; }
  }
  return best <= max ? [bx, bz, bt] : [null, null, null];
}

function pickEvenly(list, count) {
  if (list.length <= count) return list;
  const out = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.round((i * (list.length - 1)) / (count - 1));
    out.push(list[idx]);
  }
  return out;
}

function boardwalkLayout({ route, paths, sand, buildings, waterAt }) {
  if (!route) return null;
  const deck = Math.max(2.2, route.width + 0.6);
  const half = deck / 2;
  const planks = [];
  const railPosts = [];
  const railBars = [];
  const benchCandidates = [];
  const innerEdge = [];
  const outerEdge = [];
  const step = 0.16;
  let lastBenchCheck = -Infinity;
  for (let d = 0.5; d <= route.length - 0.5; d += step) {
    const r = route.at(d);
    let nx = -r.tz, nz = r.tx;
    if (nz < 0) { nx = -nx; nz = -nz; } // seaward is toward the lake (+z here)
    const ix = r.x - nx * half, iz = r.z - nz * half;
    const ox = r.x + nx * half, oz = r.z + nz * half;
    if (pointInRing(sand, ix, iz) || pointInRing(sand, ox, oz)) continue;
    if (waterAt && (waterAt(ix, iz) || waterAt(ox, oz))) continue;
    if (insideBuilding(buildings, r.x, r.z, 0.3)) continue;
    const ry = Math.atan2(-r.tz, r.tx);
    planks.push({ x: r.x, z: r.z, ry, len: deck, along: d, offset: 0 });
    if (innerEdge.length === 0 || Math.hypot(ix - innerEdge[innerEdge.length - 1][0], iz - innerEdge[innerEdge.length - 1][1]) > 0.7) {
      innerEdge.push([ix, iz]);
      outerEdge.push([ox, oz]);
    }
    const lastPost = railPosts[railPosts.length - 1];
    if (!lastPost || Math.hypot(ox - lastPost.x, oz - lastPost.z) >= 2.2) {
      railPosts.push({ x: ox, z: oz, along: d, ry });
    }
    if (d - lastBenchCheck >= BOARDWALK.benchCandidateSpacing) {
      lastBenchCheck = d;
      // Target the mapped promenade inland of the deck; the deck's own footway is more than 3 m from this probe.
      const probeX = r.x - nx * (half + 4.5), probeZ = r.z - nz * (half + 4.5);
      const [px, pz, pt] = nearestPathPoint(probeX, probeZ, paths, 3.0);
      if (px !== null) {
        const dShore = Math.hypot(px - r.x, pz - r.z);
        if (dShore >= 2 && dShore <= 10) {
          benchCandidates.push({ x: px, z: pz, ry: Math.atan2(-pt[1], pt[0]), along: d });
        }
      }
    }
  }
  if (planks.length < 40) return null;
  const benches = pickEvenly(benchCandidates, BOARDWALK.benchCount);
  for (let i = 1; i < railPosts.length; i++) {
    const a = railPosts[i - 1], b = railPosts[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 0.2) continue;
    const tx = (b.x - a.x) / len, tz = (b.z - a.z) / len;
    railBars.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, len, ry: Math.atan2(-tz, tx) });
  }
  // The TSL mask needs a bounded ring, not one vertex every 0.7 m. Offset the source path polyline once and simplify
  // collinear/near-collinear vertices, keeping the exact deck footprint with a 4-20 vertex ring on the real alignment.
  const maskEdges = boardwalkMaskEdges(route, half);
  const maskRing = maskEdges.outer.concat(maskEdges.inner.slice().reverse());
  return {
    planks, railPosts, railBars, benches, maskRing, innerEdge, outerEdge,
    deck, half, length: Math.round(route.length * 10) / 10, sourceBenchCount: BOARDWALK.benchCount,
    routeWidth: route.width
  };
}

// Offset the mapped path polyline by the deck half-width on both sides, then remove vertices that lie within 0.2 m of
// the straight line between their neighbours. The resulting ring has the exact deck footprint on the source alignment.
function boardwalkMaskEdges(route, half) {
  const pts = route.points;
  const outer = [], inner = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const L = Math.hypot(tx, tz) || 1;
    tx /= L; tz /= L;
    let nx = -tz, nz = tx;
    if (nz < 0) { nx = -nx; nz = -nz; }
    outer.push([pts[i][0] + nx * half, pts[i][1] + nz * half]);
    inner.push([pts[i][0] - nx * half, pts[i][1] - nz * half]);
  }
  return { outer: simplifyPolyline(outer, 0.2), inner: simplifyPolyline(inner, 0.2) };
}

function simplifyPolyline(points, tolerance) {
  if (points.length <= 2) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1], b = points[i], c = points[i + 1];
    const dx = c[0] - a[0], dz = c[1] - a[1];
    const L = Math.hypot(dx, dz);
    if (L < 1e-9) continue;
    const d = Math.abs((b[0] - a[0]) * dz - (b[1] - a[1]) * dx) / L;
    if (d > tolerance) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

function buildLayout({ geo = C?.GEO, waterAt = (typeof C?.waterAt === 'function' ? C.waterAt : null) } = {}) {
  const frame = planFrame({ areas: geo?.areas, buildings: geo?.buildings, frame: geo?.frame });
  const westFrame = westPlanFrame({ areas: geo?.areas, frame: geo?.frame });
  if (!frame.supported && !westFrame.supported) {
    return { supported: false, reason: frame.reason || westFrame.reason, sites: [], skipped: [], berms: [], westBerms: [], boardwalk: null };
  }
  const sand = htoSandRing();
  const skipped = [];

  let berms = [], paths = [], buildings = [], boardwalk = null;
  if (frame.supported) {
    paths = pathSegments(geo, frame.box);
    buildings = buildingParts(geo, frame.box);
    for (let i = 0; i < PLAN.eastBerms.length; i++) {
      const [u, v, w, h] = PLAN.eastBerms[i];
      const id = `hto-east-berm-${i + 1}`;
      const berm = makeBerm({ id, u, v, w, h, transform: frame.transform, ring: frame.ring, sand, paths, buildings, waterAt, prior: berms });
      if (berm) berms.push(berm);
      else skipped.push({ id, reason: 'footprint leaves no usable mapped lawn after path/building clipping' });
    }
    const route = shorePathRoute(geo, frame);
    boardwalk = boardwalkLayout({ route, paths, sand, buildings, waterAt });
    if (!boardwalk) skipped.push({ id: 'hto-east-boardwalk', reason: 'no clear mapped shore band' });
  }

  let westBerms = [], westPaths = [], westBuildings = [], westFaces = [];
  const westSkipped = [];
  if (westFrame.supported) {
    westPaths = pathSegments(geo, westFrame.box);
    westBuildings = buildingParts(geo, westFrame.box);
    // Whole-West native path topology: every enclosed clear face (paths and buildings excluded, quay-side open areas
    // not enclosed) becomes a grass footprint. The count is derived from the mapped data, not forced to the plan's 10.
    westFaces = westFaceComponents(westFrame.ring, westPaths, westBuildings, waterAt, westFrame.box);
    const planCentres = PLAN.westBerms.map(([u, v]) => westFrame.transform(u, v));
    for (let i = 0; i < westFaces.length; i++) {
      const face = westFaces[i];
      const id = `hto-west-face-${i + 1}`;
      let nearest = null, nearestD = Infinity;
      for (const c of planCentres) {
        const d = Math.hypot(c[0] - face.cx, c[1] - face.cz);
        if (d < nearestD) { nearestD = d; nearest = c; }
      }
      const berm = makeGridFaceBerm({ id, face, plan: null, planCentreDistance: Math.round(nearestD * 10) / 10 });
      if (berm) westBerms.push(berm);
      else westSkipped.push({ id, reason: 'face too thin for a bounded grass mesh' });
    }
  }

  const east = frame.supported
    ? { supported: true, ring: frame.ring, box: frame.box, corners: frame.corners, residual: frame.residual, berms, boardwalk, skipped: skipped.filter((s) => /east|boardwalk/.test(s.id)) }
    : { supported: false, reason: frame.reason, berms: [], boardwalk: null, skipped: [] };
  const west = westFrame.supported
    ? { supported: true, ring: westFrame.ring, box: westFrame.box, corners: westFrame.corners, residual: westFrame.residual, berms: westBerms, faces: westFaces, skipped: westSkipped, namedAdjacentBuilding: westFrame.namedAdjacentBuilding, adjacentBuildingNote: westFrame.adjacentBuildingNote }
    : { supported: false, reason: westFrame.reason, berms: [], skipped: westSkipped };

  return {
    supported: frame.supported || westFrame.supported, frame, westFrame, sandRing: sand,
    paths, buildings, westPaths, westBuildings, east, west,
    berms, westBerms, westFaces, boardwalk, skipped,
    sites: [
      { id: 'htoEast', berms: berms.length, boardwalk: !!boardwalk, supported: frame.supported },
      { id: 'htoWest', berms: westBerms.length, supported: westFrame.supported }
    ]
  };
}

// One pure layout is shared by the pre-build ground mask, the pure paved-at predicate and the runtime builder. The
// cache is keyed by the GEO object; the captain builds city-grid before the waterfront modules, so the mask must not
// depend on C.waterfrontHtoLandscapeEnabled or the runtime result.
let layoutCache = null, layoutGeo = null, layoutAreaCount = -1;
function cachedLayout() {
  const geo = C?.GEO;
  const n = Array.isArray(geo?.areas) ? geo.areas.length : -1;
  if (!layoutCache || layoutGeo !== geo || layoutAreaCount !== n) {
    layoutCache = buildLayout();
    layoutGeo = geo;
    layoutAreaCount = n;
  }
  return layoutCache;
}

// --------------------------------------------------------------------------------------------------------------------
// Render
// --------------------------------------------------------------------------------------------------------------------
function standardMaterial(THREE, params) {
  const Mat = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
  return new Mat(params);
}

// Large-format pale concrete apron: shallow cast-in-place control joints (a documented approximation), per-panel tone
// drift, fine aggregate grain and a broad weathering drift. World-space so the mapped ring's angled edges never show a
// UV seam, and neutral enough that the plaza does not read as a single flat white sheet.
function pavingMaterial(THREE) {
  const mat = standardMaterial(THREE, { color: 0xb2aea6, roughness: 0.93, metalness: 0.02 });
  const T = C?.TSL;
  if (!T || !mat.isNodeMaterial) return mat;
  const { Fn, positionWorld, color, float, mix, smoothstep, fract, sin, floor, min } = T;
  try {
    const warm = color(0xbcb7ad), cool = color(0xa8a6a1), joint = color(0x8b877f);
    mat.colorNode = Fn(() => {
      const p = positionWorld.xz;
      const sx = p.x.div(float(PAVING_DETAIL.panelX));
      const sz = p.y.div(float(PAVING_DETAIL.panelZ));
      const fx = fract(sx), fz = fract(sz);
      const edgeX = min(fx, fx.oneMinus());
      const edgeZ = min(fz, fz.oneMinus());
      const face = smoothstep(float(0), float(PAVING_DETAIL.joint), edgeX)
        .mul(smoothstep(float(0), float(PAVING_DETAIL.joint), edgeZ));
      const panel = fract(sin(floor(sx).mul(12.9898).add(floor(sz).mul(78.233))).mul(43758.5453));
      const broad = sin(p.x.mul(0.21).add(0.9)).mul(0.5).add(0.5)
        .mul(sin(p.y.mul(0.17).sub(0.4)).mul(0.5).add(0.5));
      const aggregate = fract(sin(p.x.mul(37.1).add(p.y.mul(19.7))).mul(43758.5453));
      const tone = panel.mul(0.55).add(broad.mul(0.28)).add(0.10);
      const surface = mix(cool, warm, tone)
        .mul(broad.mul(0.06).add(0.965))
        .mul(aggregate.mul(0.10).add(0.935));
      return mix(joint, surface, face);
    })();
  } catch (err) {
    console.warn('[waterfrontHtoLandscape] paving colour node skipped:', err && err.message);
  }
  return mat;
}

// Sodded berm turf. The vertex colours stay the single natural base; this node multiplies in elongated grass streaks,
// medium mottling and a dry/straw tint on the crowns, so the pads stop reading as smooth plastic without any per-blade
// geometry or radial per-vertex colour fan.
function turfMaterial(THREE) {
  const mat = standardMaterial(THREE, { color: 0xffffff, vertexColors: true, roughness: 0.98, metalness: 0.0 });
  const T = C?.TSL;
  if (!T || !mat.isNodeMaterial) return mat;
  const { Fn, positionWorld, color, float, mix, fract, sin, clamp } = T;
  try {
    const dry = color(TURF_DETAIL.dry), fresh = color(0xffffff);
    mat.colorNode = Fn(() => {
      const p = positionWorld.xz;
      const patchA = sin(p.x.mul(0.37).add(1.3)).mul(0.5).add(0.5);
      const patchB = sin(p.y.mul(0.29).sub(0.7)).mul(0.5).add(0.5);
      const patch = patchA.mul(patchB);
      const mid = sin(p.x.mul(1.31).add(p.y.mul(0.93))).mul(0.5).add(0.5);
      const bladeA = sin(p.x.mul(23.0).add(p.y.mul(4.0))).mul(0.5).add(0.5);
      const bladeB = sin(p.x.mul(5.0).sub(p.y.mul(19.0))).mul(0.5).add(0.5);
      const blades = bladeA.mul(0.6).add(bladeB.mul(0.4));
      const fine = fract(sin(p.x.mul(TURF_DETAIL.fine).add(p.y.mul(29.3))).mul(43758.5453));
      const crest = clamp(positionWorld.y.sub(float(BERM_BASE())).mul(0.75), float(0), float(1));
      // Straw/dry is held low: only a faint crown lift, no dry-patch claim.
      const dryMix = clamp(patch.mul(0.22).add(blades.mul(0.14)).add(mid.mul(0.10)).add(crest.mul(0.06)), float(0), float(1));
      const tone = mix(fresh, dry, dryMix);
      const grain = fine.mul(TURF_DETAIL.grain).add(0.92);
      return tone.mul(grain);
    })();
  } catch (err) {
    console.warn('[waterfrontHtoLandscape] turf colour node skipped:', err && err.message);
  }
  return mat;
}

// The berm collar: a shaded outer reveal and a paler inner lip, plus fine concrete grain. It reads as a cast curb
// against both the paving and the turf instead of a flat pale band.
function edgingMaterial(THREE) {
  const mat = standardMaterial(THREE, { color: 0xafa89b, roughness: 0.9, metalness: 0.02 });
  const T = C?.TSL;
  if (!T || !mat.isNodeMaterial) return mat;
  const { Fn, positionWorld, attribute, color, float, mix, fract, sin } = T;
  try {
    const lip = color(0xbcb4a6), reveal = color(0x8d877d);
    mat.colorNode = Fn(() => {
      const edge = attribute('aEdge', 'float');
      const p = positionWorld.xz;
      const fine = fract(sin(p.x.mul(33.1).add(p.y.mul(21.7))).mul(43758.5453));
      return mix(reveal, lip, edge).mul(fine.mul(0.10).add(0.93));
    })();
  } catch (err) {
    console.warn('[waterfrontHtoLandscape] edging colour node skipped:', err && err.message);
  }
  return mat;
}

// Timber is left as the four sampled board tones; this only adds a dry, weathered grain multiplier so the deck does not
// read as four flat colour bands at grazing angles. instanceColor multiplies it automatically.
function timberFinishMaterial(THREE) {
  const mat = standardMaterial(THREE, { color: 0xffffff, roughness: 0.86, metalness: 0.0 });
  const T = C?.TSL;
  if (!T || !mat.isNodeMaterial) return mat;
  const { Fn, positionWorld, color, mix, fract, sin } = T;
  try {
    const weathered = color(0xd8cfc0), clean = color(0xffffff);
    mat.colorNode = Fn(() => {
      const p = positionWorld.xz;
      const streak = fract(sin(p.x.mul(17.0).add(p.y.mul(2.7))).mul(43758.5453));
      const drift = sin(p.x.mul(0.47)).mul(0.5).add(0.5).mul(0.3).add(0.55);
      return mix(weathered, clean, drift).mul(streak.mul(0.10).add(0.94));
    })();
  } catch (err) {
    console.warn('[waterfrontHtoLandscape] timber colour node skipped:', err && err.message);
  }
  return mat;
}


function bermGeometry(THREE, berm) {
  const geo = new THREE.BufferGeometry();
  const positions = berm.mesh.positions.slice();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(berm.mesh.indices.slice());
  geo.computeVertexNormals();
  // One consistent natural turf base with very subtle, continuous world-space variation. No per-vertex random palette,
  // so there is no radial starburst or plastic multi-colour fan across a mound. The base is the dark olive of the ASLA
  // aerial (the first revision's 0x6b8038 was lighter than the original and read as a pale lime carpet); the material
  // node adds the fine turf grain, so no per-blade geometry is needed.
  const base = new THREE.Color(0x37552a);
  const colors = [];
  const yBase = BERM_BASE();
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    const lift = Math.max(0, Math.min(1, (y - yBase) / Math.max(0.2, berm.height)));
    const broad = 0.045 * Math.sin(x * 0.23 + z * 0.17) + 0.025 * Math.sin(x * 0.11 - z * 0.29 + 1.7);
    const shade = 0.90 + 0.10 * Math.sqrt(lift) + broad;
    const v = Math.max(0.82, Math.min(1.04, shade));
    colors.push(base.r * v, base.g * v, base.b * v);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

function edgingGeometry(THREE, berm) {
  const base = BERM_BASE();
  // A shallow bevel, not a flat pale band: the inner lip is a few millimetres proud of the grass edge and the outer lip
  // sits just above the paving, so the curb catches a highlight and casts a thin shaded reveal. No source geometry moves.
  const inner = 0.955, outer = 1.0, innerY = base + 0.018, outerY = base + 0.002;
  const pos = [], idx = [], edge = [];
  for (let k = 0; k < SECTORS; k++) {
    const theta = (k / SECTORS) * Math.PI * 2;
    const lim = berm.sectorLimit[k], w = berm.wobble(theta);
    const lx = Math.cos(theta) * berm.Ux + Math.sin(theta) * berm.Vx;
    const lz = Math.cos(theta) * berm.Uz + Math.sin(theta) * berm.Vz;
    for (const [f, y, e] of [[inner, innerY, 1], [outer, outerY, 0]]) {
      const r = f * lim * w;
      pos.push(berm.cx + r * lx, y, berm.cz + r * lz);
      edge.push(e);
    }
  }
  for (let k = 0; k < SECTORS; k++) {
    const k2 = (k + 1) % SECTORS;
    const a = k * 2, b = k * 2 + 1, c = k2 * 2, d = k2 * 2 + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function ribbonGeometry(THREE, edgeA, edgeB, yA, yB) {
  const pos = [], idx = [];
  const n = Math.min(edgeA.length, edgeB.length);
  for (let i = 0; i < n; i++) pos.push(edgeA[i][0], yA, edgeA[i][1], edgeB[i][0], yB, edgeB[i][1]);
  for (let i = 0; i + 1 < n; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// A flat XZ polygon with holes (park ring minus the OSM sand and the boardwalk band), triangulated by Three's own
// ShapeUtils. Triangle winding is normalized upward and the normal is (0,1,0), so it never z-fights the lawn.
function flatPolygonGeometry(THREE, outer, holes, y) {
  const outerV = outer.map((p) => new THREE.Vector2(p[0], p[1]));
  const holeV = holes.filter((r) => Array.isArray(r) && r.length >= 3).map((r) => r.map((p) => new THREE.Vector2(p[0], p[1])));
  let tris;
  try { tris = THREE.ShapeUtils.triangulateShape(outerV, holeV); } catch { return null; }
  if (!Array.isArray(tris) || !tris.length) return null;
  const points = outerV.concat(...holeV);
  const positions = [];
  for (const p of points) positions.push(p.x, y, p.y);
  const indices = [];
  for (const [a, b, c] of tris) {
    const ax = points[a].x, az = points[a].y, bx = points[b].x, bz = points[b].y, cx = points[c].x, cz = points[c].y;
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (ny > 0) indices.push(a, b, c); else indices.push(a, c, b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  const normals = new Float32Array(positions.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geo;
}

function merge(THREE, geos) {
  const list = geos.filter(Boolean);
  if (!list.length) return null;
  const mergeGeometries = C?.Addons?.mergeGeometries;
  if (!mergeGeometries) throw new Error('waterfront-hto-landscape: CITY.Addons.mergeGeometries is required');
  const out = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  return out;
}

function box(THREE, w, h, d, x, y, z) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

function benchGeometry(THREE) {
  return merge(THREE, [
    box(THREE, 2.6, 0.10, 0.54, 0, 0.40, 0),
    box(THREE, 0.18, 0.36, 0.44, -0.95, 0.18, 0),
    box(THREE, 0.18, 0.36, 0.44, 0.95, 0.18, 0)
  ]);
}

function createWaterfrontHtoLandscape(THREE = C?.THREE, scene = null) {
  if (!THREE) throw new Error('waterfront-hto-landscape: THREE is required');
  const layout = cachedLayout();
  const allBerms = layout.berms.concat(layout.westBerms || []);
  if (!layout.supported || !allBerms.length) {
    if (C) {
      C.waterfrontHtoLandscapeEnabled = false;
      C.waterfrontHtoLandscapePlanTreesEnabled = false;
      C.waterfrontHtoLandscapeError = layout.reason || 'no HTO berms survived clipping';
    }
    console.info(`[waterfrontHtoLandscape] skipped: ${layout.reason || 'no HTO berms survived clipping'}`);
    return null;
  }
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const base = BERM_BASE();
  const group = new THREE.Group();
  group.name = 'WaterfrontHtoLandscape';
  const colliders = [];
  const meshes = [];
  const add = (mesh, role) => {
    if (!mesh) return;
    mesh.userData.role = role;
    mesh.userData.cullDistance = 800;
    mesh.userData.cullCell = 120;
    if (mesh.computeBoundingSphere) mesh.computeBoundingSphere();
    meshes.push(mesh);
    group.add(mesh);
  };

  const pavingMat = pavingMaterial(THREE);
  const grassMat = turfMaterial(THREE);
  const edgingMat = edgingMaterial(THREE);
  const timberMat = timberFinishMaterial(THREE);
  const darkTimber = standardMaterial(THREE, { color: 0x4a3a2c, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide });
  const benchMat = standardMaterial(THREE, { color: 0x3c3a36, roughness: 0.78, metalness: 0.05 });
  const railMat = standardMaterial(THREE, { color: 0x9aa0a3, roughness: 0.34, metalness: 0.72 });

  const bw = layout.boardwalk;
  const pavingGeos = [];
  if (layout.east && layout.east.supported) {
    const pavingHoles = [layout.sandRing];
    if (bw) pavingHoles.push(bw.maskRing);
    pavingGeos.push(flatPolygonGeometry(THREE, layout.east.ring, pavingHoles, PAVING_TOP()));
  }
  if (layout.west && layout.west.supported) {
    pavingGeos.push(flatPolygonGeometry(THREE, layout.west.ring, [], PAVING_TOP()));
  }
  const pavingGeo = merge(THREE, pavingGeos);
  add(pavingGeo && new THREE.Mesh(pavingGeo, pavingMat), 'paved-apron');

  const grassGeos = [], edgeGeos = [];
  for (const berm of allBerms) {
    grassGeos.push(bermGeometry(THREE, berm));
    edgeGeos.push(edgingGeometry(THREE, berm));
  }
  add(new THREE.Mesh(merge(THREE, grassGeos), grassMat), 'sodded-berms');
  add(new THREE.Mesh(merge(THREE, edgeGeos), edgingMat), 'berm-concrete-edging');

  if (bw) {
    add(new THREE.Mesh(ribbonGeometry(THREE, bw.outerEdge, bw.innerEdge, TIMBER_BASE(), TIMBER_BASE()), darkTimber), 'boardwalk-subdeck');
    add(new THREE.Mesh(ribbonGeometry(THREE, bw.outerEdge, bw.outerEdge, TIMBER_BASE() - 0.02, TIMBER_BASE()), darkTimber), 'boardwalk-seawall-fascia');
    const planks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), timberMat, bw.planks.length);
    planks.name = 'WaterfrontHtoLandscape-Planks';
    planks.userData.role = 'timber-boardwalk';
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    const palette = [0x8a6a4a, 0x96754f, 0x7d5f42, 0xa07f57];
    bw.planks.forEach((pl, i) => {
      p.set(pl.x, (TIMBER_TOP() + TIMBER_BASE()) / 2, pl.z);
      q.setFromAxisAngle(up, pl.ry);
      s.set(0.155, TIMBER_TOP() - TIMBER_BASE(), Math.max(0.5, pl.len));
      planks.setMatrixAt(i, m.compose(p, q, s));
      planks.setColorAt(i, col.setHex(palette[i % palette.length]));
    });
    planks.instanceMatrix.needsUpdate = true;
    if (planks.instanceColor) planks.instanceColor.needsUpdate = true;
    planks.castShadow = false; planks.receiveShadow = true;
    planks.userData.cullDistance = 700; planks.userData.cullCell = 100;
    if (planks.computeBoundingSphere) planks.computeBoundingSphere();
    meshes.push(planks); group.add(planks);

    const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 8), railMat, bw.railPosts.length);
    posts.name = 'WaterfrontHtoLandscape-RailPosts';
    bw.railPosts.forEach((rp, i) => {
      p.set(rp.x, TIMBER_TOP() + BOARDWALK.railHeight / 2, rp.z);
      q.identity(); s.set(1, BOARDWALK.railHeight, 1);
      posts.setMatrixAt(i, m.compose(p, q, s));
    });
    posts.instanceMatrix.needsUpdate = true;
    posts.castShadow = false; posts.receiveShadow = true;
    posts.userData.cullDistance = 600; posts.userData.cullCell = 100;
    if (posts.computeBoundingSphere) posts.computeBoundingSphere();
    meshes.push(posts); group.add(posts);
    for (const rp of bw.railPosts) {
      colliders.push({
        minX: rp.x - 0.06, maxX: rp.x + 0.06, minZ: rp.z - 0.06, maxZ: rp.z + 0.06,
        minY: TIMBER_TOP(), maxY: TIMBER_TOP() + BOARDWALK.railHeight, prop: true, kind: 'htoRailPost',
        obb: { cx: rp.x, cz: rp.z, hx: 0.06, hz: 0.06, cs: 1, sn: 0 }
      });
    }
    const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.045, 0.045), railMat, bw.railBars.length * 2);
    bars.name = 'WaterfrontHtoLandscape-Rails';
    let bi = 0;
    for (const bar of bw.railBars) {
      for (const y of [TIMBER_TOP() + 0.55, TIMBER_TOP() + BOARDWALK.railHeight]) {
        p.set(bar.x, y, bar.z); q.setFromAxisAngle(up, bar.ry); s.set(bar.len, 1, 1);
        bars.setMatrixAt(bi++, m.compose(p, q, s));
      }
    }
    bars.instanceMatrix.needsUpdate = true;
    bars.castShadow = false; bars.receiveShadow = true;
    bars.userData.cullDistance = 600; bars.userData.cullCell = 100;
    if (bars.computeBoundingSphere) bars.computeBoundingSphere();
    meshes.push(bars); group.add(bars);

    if (bw.benches.length) {
      const benches = new THREE.InstancedMesh(benchGeometry(THREE), benchMat, bw.benches.length);
      benches.name = 'WaterfrontHtoLandscape-Benches';
      bw.benches.forEach((b, i) => {
        p.set(b.x, PATH_TOP(), b.z); q.setFromAxisAngle(up, b.ry); s.set(1, 1, 1);
        benches.setMatrixAt(i, m.compose(p, q, s));
        const cs = Math.cos(b.ry), sn = Math.sin(b.ry);
        const hx = 1.3, hz = 0.27;
        const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
        colliders.push({
          minX: b.x - ex, maxX: b.x + ex, minZ: b.z - ez, maxZ: b.z + ez,
          minY: PATH_TOP(), maxY: PATH_TOP() + 0.46, prop: true, kind: 'htoSlabBench',
          obb: { cx: b.x, cz: b.z, hx, hz, cs, sn }
        });
      });
      benches.instanceMatrix.needsUpdate = true;
      benches.castShadow = true; benches.receiveShadow = true;
      benches.userData.cullDistance = 500; benches.userData.cullCell = 100;
      if (benches.computeBoundingSphere) benches.computeBoundingSphere();
      meshes.push(benches); group.add(benches);
    }
  }

  let triangles = 0;
  for (const mesh of meshes) {
    const g = mesh.geometry;
    const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
    triangles += n * (mesh.isInstancedMesh ? mesh.count : 1);
  }
  const westBerms = layout.westBerms || [];
  const planting = htoLandscapePlantingInventory();
  const planTrees = htoLandscapePlanTreeLayout();
  const stats = {
    berms: allBerms.length, eastBerms: layout.berms.length, westBerms: westBerms.length,
    westEnclosedFaces: (layout.westFaces || []).length,
    westFaceMinArea: WEST_FACE_MIN_AREA,
    westEdgeVerticesMoved: (layout.westBerms || []).reduce((n, b) => {
      const m = b.mesh;
      if (!m || !m.rawPositions) return n;
      let c = 0;
      for (let i = 0; i < m.positions.length; i += 3) {
        if (m.positions[i] !== m.rawPositions[i] || m.positions[i + 2] !== m.rawPositions[i + 2]) c++;
      }
      return n + c;
    }, 0),
    bermsSkipped: layout.skipped.filter((s) => /berm/.test(s.id)).length,
    planBerms: PLAN.eastBerms.length + PLAN.westBerms.length,
    westPlanBerms: PLAN.westBerms.length,
    planResidual: layout.east?.residual ?? null,
    westResidual: layout.west?.residual ?? null,
    planBuildingResidual: layout.frame?.buildingResidual ?? null,
    bermHeightMin: Math.min(...allBerms.map((b) => b.height)),
    bermHeightMax: Math.max(...allBerms.map((b) => b.height)),
    plantingMappedTrees: planting.totalMapped,
    plantingSourceTrees: HTO_PLANTING_SOURCE.treesBothSections,
    planTreeCandidates: planTrees.counts.candidate,
    planTreesAccepted: planTrees.counts.accepted,
    planTreesRejected: planTrees.counts.rejected,
    planTreesRejectedByReason: planTrees.counts.byReason,
    pavingTriangles: pavingGeo ? pavingGeo.index.count / 3 : 0,
    boardwalkPlanks: bw?.planks.length || 0, boardwalkLength: bw?.length || 0,
    railPosts: bw?.railPosts.length || 0, benches: bw?.benches.length || 0, sourceBenchCount: BOARDWALK.benchCount,
    meshes: meshes.length, triangles: Math.round(triangles), colliders: colliders.length, skipped: layout.skipped,
    ms: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 10) / 10
  };
  group.userData.waterfrontHtoLandscape = stats;
  if (scene && scene.add) scene.add(group);
  const result = { group, root: group, colliders, stats, layout, berms: allBerms, eastBerms: layout.berms, westBerms: layout.westBerms || [], boardwalk: bw, planTrees };
  C.waterfrontHtoLandscape = result;
  C.htoLandscapePlanTrees = planTrees;
  C.waterfrontHtoLandscapeEnabled = true;
  C.waterfrontHtoLandscapePlanTreesEnabled = planTrees.supported && planTrees.counts.accepted > 0;
  C.waterfrontHtoLandscapeError = null;
  const bwh = bw ? `, boardwalk ${bw.length} m / ${bw.planks.length} planks / ${bw.benches.length} benches` : '';
  console.info(`[waterfrontHtoLandscape] East ${layout.berms.length}/${PLAN.eastBerms.length} berms, West ${westBerms.length} derived faces ` +
    `(East residual ${layout.east?.residual} m, West residual ${layout.west?.residual} m${bwh}), ` +
    `plan trees ${planTrees.counts.accepted}/${planTrees.counts.candidate} accepted, ` +
    `${stats.meshes} meshes, ${stats.colliders} colliders, ${stats.ms} ms`);
  return result;
}

// --------------------------------------------------------------------------------------------------------------------
// Exact public surface / footprint / keepout API. Samplers are runtime-enabled gated; pure predicates use the same
// cached layout so they are safe before the builder runs.
// --------------------------------------------------------------------------------------------------------------------
// A conservative plan box for a built layout, computed once and cached on the layout object: a query away from the
// feature returns at the box test instead of walking every piece (deckHeightAt and deckStoodOn ask every frame, for
// every body, anywhere in the city; st-s1y8). An empty layout gets an empty box (nothing can hit it).
const SURFACE_BOUNDS = new WeakMap();
function surfaceBounds(layout, fill) {
  let b = SURFACE_BOUNDS.get(layout);
  if (!b) {
    b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    fill((x, z, r = 0) => {
      if (x - r < b.minX) b.minX = x - r; if (x + r > b.maxX) b.maxX = x + r;
      if (z - r < b.minZ) b.minZ = z - r; if (z + r > b.maxZ) b.maxZ = z + r;
    });
    SURFACE_BOUNDS.set(layout, b);
  }
  return b;
}
const outsideBounds = (b, x, z) => x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ;

function htoLandscapeSurfaceAt(x, z) {
  const R = C?.waterfrontHtoLandscape;
  if (!C?.waterfrontHtoLandscapeEnabled || !R) return null;
  if (outsideBounds(surfaceBounds(R, (add) => {
    for (const berm of R.berms || []) { const m = berm.mesh; if (m) { add(m.minX, m.minZ); add(m.maxX, m.maxZ); } }
    // (boardwalkContains accepts |across| <= 0.28 and |along| <= len/2 + 0.15 round each plank's centre)
    for (const pl of R.boardwalk?.planks || []) add(pl.x, pl.z, Math.hypot(0.28, pl.len / 2 + 0.15));
  }), x, z)) return null;
  let best = null;
  for (const berm of R.berms) {
    const s = bermSurface(berm, x, z);
    if (s && (!best || s.h > best.h)) best = { h: s.h, id: berm.id, kind: 'berm', pedestrianOnly: true, bermId: berm.id };
  }
  if (R.boardwalk) {
    const b = boardwalkContains(R.boardwalk, x, z);
    if (b) {
      const h = TIMBER_TOP();
      if (!best || h > best.h) best = { h, id: 'hto-east-boardwalk', kind: 'boardwalk', pedestrianOnly: true, offset: b.offset, along: b.along };
    }
  }
  return best;
}

function boardwalkContains(bw, x, z) {
  if (!bw || !bw.planks.length) return null;
  let best = null;
  for (const pl of bw.planks) {
    const tx = Math.cos(pl.ry), tz = -Math.sin(pl.ry);
    const nx = Math.sin(pl.ry), nz = Math.cos(pl.ry);
    const dx = x - pl.x, dz = z - pl.z;
    const across = dx * tx + dz * tz;
    const along = dx * nx + dz * nz;
    if (Math.abs(across) > 0.28 || Math.abs(along) > pl.len / 2 + 0.15) continue;
    if (!best || Math.abs(across) < best.margin) best = { along: pl.along, offset: pl.offset, margin: Math.abs(across) };
  }
  return best;
}

function htoLandscapeFootprintAt(x, z, margin = 0) {
  const R = C?.waterfrontHtoLandscape;
  if (!C?.waterfrontHtoLandscapeEnabled || !R) return false;
  for (const berm of R.berms) {
    if (berm.contains ? berm.contains(x, z, margin) : false) return true;
  }
  if (R.boardwalk && boardwalkContains(R.boardwalk, x, z)) return true;
  return false;
}

function htoLandscapeKeepoutAt(x, z, margin = 0) {
  const R = C?.waterfrontHtoLandscape;
  if (!C?.waterfrontHtoLandscapeEnabled || !R) return false;
  if (R.boardwalk && boardwalkContains(R.boardwalk, x, z)) return true;
  for (const c of R.colliders) {
    if (x >= c.minX - margin && x <= c.maxX + margin && z >= c.minZ - margin && z <= c.maxZ + margin) return true;
  }
  return false;
}

function htoLandscapeBermAt(x, z) {
  const R = C?.waterfrontHtoLandscape;
  if (!C?.waterfrontHtoLandscapeEnabled || !R) return null;
  for (const berm of R.berms) {
    const s = bermSurface(berm, x, z);
    if (s) return { id: berm.id, height: berm.height, surface: s.h, plan: berm.plan, shift: berm.shift };
  }
  return null;
}

// Pure predicate for the new paved aprons: true where paving is actually exposed (inside either mapped HTO ring, not on
// the OSM sand, boardwalk, a berm or a mapped building). It is valid before the runtime builder, so the captain can
// remove generated trees only on the new paving without a broad keepout that erases the real tree inventory.
function htoLandscapePavedAt(x, z) {
  const L = cachedLayout();
  if (!L.supported) return false;
  const eastInside = !!(L.east && L.east.supported && pointInRing(L.east.ring, x, z));
  const westInside = !!(L.west && L.west.supported && pointInRing(L.west.ring, x, z));
  if (!eastInside && !westInside) return false;
  if (eastInside && pointInRing(L.sandRing, x, z)) return false;
  if (eastInside && L.boardwalk && boardwalkContains(L.boardwalk, x, z)) return false;
  for (const berm of (L.berms || []).concat(L.westBerms || [])) {
    if (berm.contains ? berm.contains(x, z, 0) : false) return false;
  }
  if (eastInside && insideBuilding(L.buildings, x, z, 0)) return false;
  if (westInside && insideBuilding(L.westBuildings, x, z, 0)) return false;
  return true;
}

// Pure ground-mask footprints for the city-grid lawn under the two new plazas. The East sand is a hole so the beach's
// own sand/mask remains authoritative; the East boardwalk stays inside the masked area because its timber is lower.
function htoLandscapeGroundMaskPolygons() {
  const L = cachedLayout();
  if (!L.supported) return [];
  const out = [];
  if (L.east && L.east.supported) out.push({ id: 'hto-east-paved-apron', rings: [L.east.ring, L.sandRing] });
  if (L.west && L.west.supported) out.push({ id: 'hto-west-paved-apron', rings: [L.west.ring] });
  return out;
}

function htoLandscapeBoardwalkMaskPolygon() {
  const L = cachedLayout();
  if (!L.supported || !L.boardwalk) return null;
  return L.boardwalk.maskRing.map((p) => [p[0], p[1]]);
}

// Composable TSL ground mask for the plaza, matching js/waterfront-public-realm.js's deck mask style. It is safe to
// call while city-grid is built (before the waterfront builder), because it uses cachedLayout(), never the result.
function applyWaterfrontHtoLandscapeGroundMask(mat, THREE = C?.THREE) {
  if (!mat) return mat;
  if (mat.userData && mat.userData.waterfrontHtoLandscapeMask) return mat;
  const polys = htoLandscapeGroundMaskPolygons();
  if (!polys.length) return mat;
  const T = C?.TSL;
  if (!T || !mat.isNodeMaterial) return mat;
  const { Fn, positionWorld, float, select } = T;
  try {
    const node = Fn(() => {
      const p = positionWorld.xz;
      let crossings = float(0);
      for (const { rings } of polys) {
        for (const ring of rings) {
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const ax = ring[j][0], az = ring[j][1], bx = ring[i][0], bz = ring[i][1];
            if (az === bz) continue;
            const inZ = p.y.greaterThanEqual(float(Math.min(az, bz))).and(p.y.lessThan(float(Math.max(az, bz))));
            const tEdge = p.y.sub(float(az)).div(float(bz - az));
            const xInt = float(ax).add(float(bx - ax).mul(tEdge));
            const left = p.x.lessThan(xInt);
            crossings = crossings.add(select(inZ.and(left), float(1), float(0)));
          }
        }
      }
      return crossings.mod(2).greaterThan(0.5);
    })();
    mat.maskNode = mat.maskNode ? mat.maskNode.and(node.not()) : node.not();
    if (!mat.userData) mat.userData = {};
    mat.userData.waterfrontHtoLandscapeMask = true;
  } catch (err) {
    console.warn('[waterfrontHtoLandscape] ground mask not applied:', err && err.message);
  }
  return mat;
}

// A separate exact-footprint mask for the timber deck. The captain wires this to all city ground materials that are
// not water/lake (and not the whole path network): only the deck's own footprint is discarded, so the lower boards are
// visible over the mapped shore footway while every other path keeps its native material. It uses the pure cache, so
// it is safe before the waterfront builder runs.
function applyWaterfrontHtoBoardwalkGroundMask(mat, THREE = C?.THREE) {
  if (!mat) return mat;
  if (mat.userData && mat.userData.waterfrontHtoBoardwalkMask) return mat;
  const ring = htoLandscapeBoardwalkMaskPolygon();
  if (!ring || ring.length < 3) return mat;
  const T = C?.TSL;
  if (!T || !mat.isNodeMaterial) return mat;
  const { Fn, positionWorld, float, select } = T;
  try {
    const node = Fn(() => {
      const p = positionWorld.xz;
      let crossings = float(0);
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const ax = ring[j][0], az = ring[j][1], bx = ring[i][0], bz = ring[i][1];
        if (az === bz) continue;
        const inZ = p.y.greaterThanEqual(float(Math.min(az, bz))).and(p.y.lessThan(float(Math.max(az, bz))));
        const tEdge = p.y.sub(float(az)).div(float(bz - az));
        const xInt = float(ax).add(float(bx - ax).mul(tEdge));
        crossings = crossings.add(select(inZ.and(p.x.lessThan(xInt)), float(1), float(0)));
      }
      return crossings.mod(2).greaterThan(0.5);
    })();
    mat.maskNode = mat.maskNode ? mat.maskNode.and(node.not()) : node.not();
    if (!mat.userData) mat.userData = {};
    mat.userData.waterfrontHtoBoardwalkMask = true;
  } catch (err) {
    console.warn('[waterfrontHtoLandscape] boardwalk mask not applied:', err && err.message);
  }
  return mat;
}

function htoLandscapeSupported() {
  return cachedLayout().supported;
}

// Path-tone integration. city-grid draws the mapped park paths and shore footway with its own materials (forecourt /
// walkway); this module cannot move those footprints or walk heights, and does not edit core. What it can do is hand
// the captain a composable, world-space tone node so the path ribbons inside the two HTO rings share the apron's
// concrete family (joints + fine grain) instead of reading as flat white strips against the mottled apron. Wire it to
// the city path/forecourt material; it is idempotent, composes with an existing colorNode, and is a no-op off-frame,
// on a non-node material, or on a material that is not the path surface. No geometry or height is touched.
function htoLandscapePathMaskPolygons() {
  const L = cachedLayout();
  if (!L.supported) return [];
  const out = [];
  if (L.east && L.east.supported) out.push({ id: 'hto-east-paths', rings: [L.east.ring] });
  if (L.west && L.west.supported) out.push({ id: 'hto-west-paths', rings: [L.west.ring] });
  return out;
}

function applyWaterfrontHtoLandscapePathTone(mat) {
  if (!mat) return mat;
  if (mat.userData && mat.userData.waterfrontHtoPathTone) return mat;
  const polys = htoLandscapePathMaskPolygons();
  if (!polys.length) return mat;
  const T = C?.TSL;
  if (!T || !mat.isNodeMaterial) return mat;
  const { Fn, positionWorld, float, color, mix, select, fract, sin, smoothstep, min } = T;
  try {
    const inside = Fn(() => {
      const p = positionWorld.xz;
      let crossings = float(0);
      for (const { rings } of polys) {
        for (const ring of rings) {
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const ax = ring[j][0], az = ring[j][1], bx = ring[i][0], bz = ring[i][1];
            if (az === bz) continue;
            const inZ = p.y.greaterThanEqual(float(Math.min(az, bz))).and(p.y.lessThan(float(Math.max(az, bz))));
            const tEdge = p.y.sub(float(az)).div(float(bz - az));
            const xInt = float(ax).add(float(bx - ax).mul(tEdge));
            crossings = crossings.add(select(inZ.and(p.x.lessThan(xInt)), float(1), float(0)));
          }
        }
      }
      return crossings.mod(2).greaterThan(0.5);
    })();
    const base = mat.colorNode ? mat.colorNode : color(mat.color && mat.color.getHex ? mat.color.getHex() : 0x9d9b95);
    const detail = Fn(() => {
      const p = positionWorld.xz;
      const sx = p.x.div(float(PAVING_DETAIL.panelX));
      const sz = p.y.div(float(PAVING_DETAIL.panelZ));
      const fx = fract(sx), fz = fract(sz);
      const face = smoothstep(float(0), float(PAVING_DETAIL.joint), min(fx, fx.oneMinus()))
        .mul(smoothstep(float(0), float(PAVING_DETAIL.joint), min(fz, fz.oneMinus())));
      const grain = fract(sin(p.x.mul(35.3).add(p.y.mul(23.9))).mul(43758.5453));
      return mix(float(0.87), float(1.0), face).mul(grain.mul(0.07).add(0.95));
    })();
    mat.colorNode = select(inside, base.mul(detail), base);
    if (!mat.userData) mat.userData = {};
    mat.userData.waterfrontHtoPathTone = true;
  } catch (err) {
    console.warn('[waterfrontHtoLandscape] path tone node not applied:', err && err.message);
  }
  return mat;
}

function htoLandscapeLayout(opts = {}) {
  return buildLayout(opts);
}

// Tree evidence. Only the mapped City tree inventory (GEO.streetTrees, stride 4: x, z, model, height*10) is used for
// coordinates; the module never generates a tree point. The source brief counts 106 trees across both HTO sections,
// while the committed mapping carries only a handful inside the park rings, so tree densification is a proposal for the
// captain, backed by an authoritative plan, not something this module may invent.
function mappedTreesInside(ring, geo = C?.GEO) {
  const ST = geo?.streetTrees;
  if (!Array.isArray(ST) || !ring) return [];
  const box = ringBox(ring);
  const models = Array.isArray(geo.treeModels) ? geo.treeModels : null;
  const out = [];
  for (let i = 0; i + 3 < ST.length; i += 4) {
    const x = ST[i], z = ST[i + 1];
    if (x < box.minX || x > box.maxX || z < box.minZ || z > box.maxZ) continue;
    if (!pointInRing(ring, x, z)) continue;
    const modelIndex = ST[i + 2];
    const name = models && Array.isArray(models[modelIndex]) ? models[modelIndex][0] : null;
    out.push({ x, z, model: name, height: Math.round(ST[i + 3]) / 10 });
  }
  return out;
}

function htoLandscapePlantingInventory() {
  const L = cachedLayout();
  const source = HTO_PLANTING_SOURCE;
  if (!L.supported) {
    return { supported: false, source, east: [], west: [], totalMapped: 0, note: L.reason || 'HTO is not in the active frame' };
  }
  const east = L.east && L.east.supported ? mappedTreesInside(L.east.ring) : [];
  const west = L.west && L.west.supported ? mappedTreesInside(L.west.ring) : [];
  return {
    supported: true, source, east, west, totalMapped: east.length + west.length,
    note: `Mapped City tree inventory only (${east.length} East + ${west.length} West). No coordinate is invented; ` +
      `the source brief records ${source.treesBothSections} trees across both sections, so the mapped inventory is sparse.`
  };
}

function htoLandscapePlantingProposals() {
  const inventory = htoLandscapePlantingInventory();
  return {
    ...inventory,
    proposals: [
      {
        id: 'retain-mapped-trees', kind: 'retain', implemented: true,
        basis: 'mapped City tree inventory inside the HTO Park East and West rings',
        detail: 'kept unchanged; ez-trees roots each mapped trunk on the rendered berm surface through htoLandscapeSurfaceAt'
      },
      {
        id: 'berm-turf-mix', kind: 'surface', implemented: true,
        basis: 'ASLA materials text (sod, long grasses) and the Landscape Performance brief (3 grass types, red switch grass)',
        detail: 'expressed as procedural turf colour/grain detail only; no per-blade, shrub or tree geometry is added'
      },
      {
        id: 'tree-densification', kind: 'tree-plan', implemented: true,
        basis: `captain-digitized ASLA 2009 plan tree symbols (${HTO_PLAN_TREE_POINTS.eastPixels.length} East + ${HTO_PLAN_TREE_POINTS.westPixels.length} West candidate points)`,
        detail: 'registered with the existing East/West plan homographies, clipped to rendered berms, deduped against City inventory and each other; conflicts rejected, never moved. Historical design reconstruction, not current inventory.'
      },
      {
        id: 'source-species-reference', kind: 'species-reference', implemented: false,
        basis: 'Landscape Performance Series species list for HTO',
        detail: 'golden weeping willow, silver maple and serviceberry are recorded as design references only; no species is assigned to a mapped coordinate'
      }
    ]
  };
}

// Historical plan tree symbols. Pure layout (safe before the runtime builder): each captain-digitized pixel is registered
// with the same East/West plan homographies used for the berms, then clipped to the exact rendered berm triangles and
// deduped against the mapped City inventory and the other plan symbols. A conflict is rejected, never moved. The result
// depends on the cached layout and City trees only, so it is cached per GEO to keep the pure API cheap.
let planTreeCache = null, planTreeGeo = null, planTreeAreaCount = -1, planTreeTreeCount = -1;
function htoLandscapePlanTreeLayout() {
  const geo = C?.GEO;
  const n = Array.isArray(geo?.areas) ? geo.areas.length : -1;
  const tn = Array.isArray(geo?.streetTrees) ? geo.streetTrees.length : -1;
  if (planTreeCache && planTreeGeo === geo && planTreeAreaCount === n && planTreeTreeCount === tn) return planTreeCache;
  planTreeCache = computePlanTreeLayout();
  planTreeGeo = geo; planTreeAreaCount = n; planTreeTreeCount = tn;
  return planTreeCache;
}

function computePlanTreeLayout() {
  const L = cachedLayout();
  const imageSize = HTO_PLAN_TREE_POINTS.imageSize;
  const empty = {
    supported: false, source: HTO_PLAN_TREE_POINTS, imageSize, points: [], accepted: [], rejected: [],
    counts: { candidate: 0, accepted: 0, rejected: 0, byReason: {} }
  };
  if (!L.supported) return { ...empty, reason: L.reason || 'HTO is not in the active frame' };
  const waterAt = typeof C?.waterAt === 'function' ? C.waterAt : null;
  const sides = [];
  if (L.east && L.east.supported) {
    sides.push({ side: 'east', ring: L.east.ring, frame: L.frame, box: L.east.box, paths: L.paths,
      buildings: L.buildings, sand: L.sandRing });
  }
  if (L.west && L.west.supported) {
    sides.push({ side: 'west', ring: L.west.ring, frame: L.westFrame, box: L.west.box, paths: L.westPaths,
      buildings: L.westBuildings, sand: null });
  }
  // City trunks only near the two parks: avoids a 223k-row scan per plan symbol.
  const ST = C?.GEO?.streetTrees || [];
  const trunks = [];
  for (let i = 0; i + 3 < ST.length; i += 4) {
    const x = ST[i], z = ST[i + 1];
    if (sides.some((s) => x >= s.box.minX - 8 && x <= s.box.maxX + 8 && z >= s.box.minZ - 8 && z <= s.box.maxZ + 8)) {
      trunks.push([x, z]);
    }
  }
  const berms = (L.berms || []).concat(L.westBerms || []);
  const round3 = (v) => Math.round(v * 1000) / 1000;
  const round2 = (v) => Math.round(v * 100) / 100;
  const points = [], accepted = [], rejected = [];
  const byReason = {};
  const fail = (rec, reason) => {
    byReason[reason] = (byReason[reason] || 0) + 1;
    const out = { ...rec, accepted: false, reason };
    rejected.push(out); points.push(out);
  };
  for (const side of sides) {
    const list = side.side === 'east' ? HTO_PLAN_TREE_POINTS.eastPixels : HTO_PLAN_TREE_POINTS.westPixels;
    const prefix = side.side === 'east' ? 'planEast' : 'planWest';
    for (let i = 0; i < list.length; i++) {
      const [px, py] = list[i];
      const rec = {
        sourceId: `${prefix}${String(i + 1).padStart(2, '0')}`, side: side.side, pixel: [px, py],
        u: px / imageSize[0], v: py / imageSize[1]
      };
      if (!side.frame || !side.frame.supported) { rec.x = null; rec.z = null; fail(rec, 'frame'); continue; }
      const [x, z] = side.frame.transform(rec.u, rec.v);
      if (!Number.isFinite(x) || !Number.isFinite(z)) { fail(rec, 'transform'); continue; }
      rec.x = round3(x); rec.z = round3(z);
      if (!pointInRing(side.ring, x, z)) { fail(rec, 'outside-ring'); continue; }
      if (side.sand && pointInRing(side.sand, x, z)) { fail(rec, 'sand'); continue; }
      if (waterAt && waterAt(x, z)) { fail(rec, 'water'); continue; }
      if (insideBuilding(side.buildings, x, z, 0.6)) { fail(rec, 'building'); continue; }
      if (pathClearance(x, z, side.paths) < 0.4) { fail(rec, 'path'); continue; }
      let nearestCity = Infinity;
      for (const [tx, tz] of trunks) {
        const dx = tx - x, dz = tz - z, d2 = dx * dx + dz * dz;
        if (d2 < nearestCity) nearestCity = d2;
      }
      if (Math.sqrt(nearestCity) < PLAN_TREE_CITY_DEDUPE) { fail(rec, 'city-trunk'); continue; }
      if (accepted.some((a) => Math.hypot(a.x - x, a.z - z) < PLAN_TREE_PLAN_DEDUPE)) { fail(rec, 'duplicate-plan'); continue; }
      // Exact rendered berm triangle, not just the cell mask: the trunk must stand on grass above the paving lip.
      let hit = null;
      for (const b of berms) {
        const m = b.mesh;
        if (x < m.minX || x > m.maxX || z < m.minZ || z > m.maxZ) continue;
        const s = bermSurface(b, x, z);
        if (s && (!hit || s.h > hit.h)) hit = { berm: b, h: s.h };
      }
      if (!hit || hit.h < BERM_BASE() + 0.01) { fail(rec, side.side === 'east' ? 'not-on-east-berm' : 'not-on-west-berm'); continue; }
      const r = hash(px * 0.37 + 11.3, py * 0.53 - 4.7);
      rec.y = round3(hit.h);
      rec.bermId = hit.berm.id;
      rec.model = PLAN_TREE_MODEL;
      rec.typology = 'generic deciduous; height and crown are a photographic typology estimate, not a species identification';
      rec.height = round2(7.8 + 3.2 * r);
      rec.crown = round2(2.1 + 0.9 * (1 - r));
      rec.provenance = HTO_PLAN_TREE_POINTS.source;
      const out = { ...rec, accepted: true };
      accepted.push(out); points.push(out);
    }
  }
  return {
    supported: true, source: HTO_PLAN_TREE_POINTS, imageSize, points, accepted, rejected,
    counts: { candidate: points.length, accepted: accepted.length, rejected: rejected.length, byReason },
    note: 'Historical 2009 ASLA plan positions registered by the existing homographies; not surveyed and not current inventory. Conflicts are rejected, never moved.'
  };
}

// Runtime gate for ez-trees: accepted plan sites only after the HTO builder has run on a supported frame.
function htoLandscapePlanTreeSites() {
  if (!C?.waterfrontHtoLandscapePlanTreesEnabled) return [];
  const plan = C.htoLandscapePlanTrees || (C.htoLandscapePlanTrees = htoLandscapePlanTreeLayout());
  return plan.accepted.map((a) => ({
    x: a.x, y: a.y, z: a.z, model: a.model, height: a.height, crown: a.crown,
    tier: 0, htoPlan: true, sourceId: a.sourceId
  }));
}

// Keep generated trees from duplicating the explicit plan symbols. Only the generated slice is passed (mapped City
// trunks are never removed); a generated tree within `radius` of a plan symbol is dropped in favour of the plan tree.
function htoPlanTreeReconcileGenerated(planSites, generatedSites, radius = 2.5) {
  const kept = [], removed = [];
  for (const g of generatedSites || []) {
    let near = null;
    for (const p of planSites || []) {
      if (Math.hypot(g.x - p.x, g.z - p.z) < radius) { near = p; break; }
    }
    if (near) removed.push({ x: g.x, z: g.z, sourceId: near.sourceId });
    else kept.push(g);
  }
  return { kept, removed, removedCount: removed.length };
}

Object.assign(C || (window.CITY = {}), {
  HTO_LANDSCAPE_PLAN: PLAN,
  HTO_LANDSCAPE_BOARDWALK: BOARDWALK,
  HTO_PLAN_TREE_POINTS,
  htoLandscapePlanFrame: planFrame,
  htoLandscapeLayout,
  htoLandscapeSurfaceAt,
  htoLandscapeFootprintAt,
  htoLandscapeKeepoutAt,
  htoLandscapeBermAt,
  htoLandscapePavedAt,
  htoLandscapeGroundMaskPolygons,
  htoLandscapeBoardwalkMaskPolygon,
  htoLandscapePathMaskPolygons,
  applyWaterfrontHtoLandscapeGroundMask,
  applyWaterfrontHtoBoardwalkGroundMask,
  applyWaterfrontHtoLandscapePathTone,
  htoLandscapeSupported,
  htoLandscapePlantingInventory,
  htoLandscapePlantingProposals,
  htoLandscapePlanTreeLayout,
  htoLandscapePlanTreeSites,
  htoPlanTreeReconcileGenerated,
  HTO_PLANTING_SOURCE,
  HTO_PAVING_DETAIL: PAVING_DETAIL,
  createWaterfrontHtoLandscape,
  buildWaterfrontHtoLandscape: createWaterfrontHtoLandscape
});
})();
