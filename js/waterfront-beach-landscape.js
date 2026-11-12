(function () {
// js/waterfront-beach-landscape.js
// The missing *landscape* character of Canada's Sugar Beach: the two candy-striped granite bedrock outcrops, the three
// grass mounds of the plaza amphitheatre, and the low charcoal-granite maple-leaf water feature beside the beach. The
// sand (js/waterfront-beach-ground.js) and the umbrellas/chairs (js/waterfront-details.js) already own their parts; this
// module adds only what those passes do not.
//
// GEOREFERENCE (the important part): the positions are fitted estimates, not survey coordinates. The captain inspected
// the original ASLA / Claude Cormier + Associés site plan (not to scale; plan north up, Jarvis Slip left, Corus right,
// Queens Quay top, harbour bottom) and read these normalized image coordinates:
//   SW park/seawall corner      (.379, .89)   west waterfront edge (.379, .22 .. .89)
//   Corus NW building corner    (.77,  .40)   Queens Quay south curb ( .14)
//   small beach outcrop         (.472, .525)  large plaza outcrop     (.656, .585)
//   large north grass mound     (.556, .24)   middle mound            (.624, .424)
//   south grass mound           (.641, .505)  maple-leaf fountain     (.598, .754)
// The world transform is fitted at runtime from the committed geodata, never from hardcoded downtown coordinates:
//   - the Sugar Beach `leisure=park` ring gives the north end of the west seawall (its minimum-x vertex) and the SW
//     seawall corner (its maximum-z vertex);
//   - the real `Corus Quay` building row gives its westmost footprint corner, matched to plan (.77,.40).
// A two-axis affine from those three anchors maps every plan coordinate to world metres. The plan is explicitly NOT TO
// SCALE, so every position is recorded as an *estimate* with the fit basis and a Queens Quay curb cross-check; this is
// not a survey. The beach outcrop lands in the real sand notch carved around it in OSM, which independently supports
// the fit. A mound whose plan point needs an implausibly large correction is marked suspect and skipped, not relocated
// arbitrarily.
//
// Source observations (captain's inspection of the four original ASLA photographs, 2026-11-10):
//   - Two low, broad brown-grey bedrock outcrops (NOT spheres or mountains): the small north beach outcrop is a gentle
//     flattened ~8x5 m rock; the larger plaza outcrop is ~12x8 m irregular flat bedrock with distinct vertical quarry
//     cut seams/cracks. Red and white thermoplastic stripes lie ON the rock surface following the seams, parallel with
//     irregular widths (red ~.12-.2 m, white ~.2-.4 m, spaced ~1.5-3 m), not a white-painted boulder.
//   - Three smooth, asymmetric grass mounds ~1.5-2.5 m high, planted with the existing pines/willows (not cones or
//     steps). Their plan positions are approximate. The historical NORTH mound's plan location is now the current
//     Waterfront Innovation Centre building (official 2021 photo + OSM way/943701268 and the committed GEO rows near
//     944,444), so it is kept unbuilt with an explicit reason: the source has three, the current-supported count is two.
//   - The source plaza is hardscape (warm medium-grey fine pavers/cobbles), not the generic bright lawn; the sand and
//     the grass mounds are the only soft islands in it. This module draws that apron and exposes a lawn mask hook.
//   - The fountain is a broad, flush/low-step (~.12 m) dark charcoal granite MAPLE LEAF at the south edge of the beach
//     / promenade boundary, with fine pavement joints and variable vertical jets ~.5-2 m high; no floating pool.
//   - The boardwalk level with the sand is already a mapped park path (GEO.parkPaths) drawn by js/city-grid.js and cut
//     through the sand mesh by js/waterfront-beach-ground.js. This module does NOT draw a fake timber strip.
//   - HTO Park's knolls/boardwalk are owned by the separate source-verified waterfront-hto-landscape.js module (the
//     captain delegated them there); this module deliberately builds nothing at HTO.
//
// Geometry conventions: 1 unit = 1 m, world x east, z south, up y; the beach/park level is CITY_BOUNDS.sidewalkHeight
// + 0.004 (0.224 m), the same level as the sand and the furniture feet. Everything here is a small number of shared
// instanced draws (two rocks, ~1.5 dozen stripe/seam slabs, three mounds, one inlaid leaf, seven jets) — never one
// object per stone. The module is self-contained and only runs when main.js calls it.
//
// Sources (retrieved 2026-11-10):
// - ASLA 2012 Honor Award, Canada's Sugar Beach: https://www.asla.org/2012awards/036.html and the original site plan
//   and gallery: https://www.asla.org/getContentAsset/7aa9e85b-644c-0be3-fa21-7710420fca2e/e477a59e-1df6-4e2f-9986-20ab37342540/GalleryFullImage/Canada-s-Sugar-Beach2294d821_GalleryFullImage.webp?language=en-US
//   Captions: the two outcrops, the red/white thermoplastic stripes masking quarry cut lines, the maple-leaf fountain,
//   the three grass mounds planted for soil volume, the boardwalk level with the sand.
// - Waterfront Toronto, Canada's Sugar Beach: https://www.waterfrontoronto.ca/our-projects/canadas-sugar-beach —
//   8,500 m², 225 m shoreline, 36 pink umbrellas, 150 chairs, the fountain in a granite maple leaf beside the beach,
//   three grass mounds, granite/tumbled-concrete cobble promenade, boardwalk level with the sand.
// - OpenStreetMap contributors, ODbL: `leisure=park` Sugar Beach ring and the real Corus Quay building footprint in the
//   committed GEO layer; `natural=beach` way/172728993 is the shared sand ring from js/waterfront-details.js.
// - docs/waterfront-details.md, docs/waterfront-beach-ground.md, docs/waterfront-realism.md for the established sand,
//   furniture counts, levels and integration.

const C = window.CITY;
const SW = () => (C?.CITY_BOUNDS?.sidewalkHeight ?? 0.22);
const GROUND = () => SW() + 0.004; // park/beach level: matches the sand and the furniture feet

// Plan anchors and features, normalized to the 1600x1995 ASLA site plan (x across, y down from the top). These are the
// only plan-space numbers in the module; every world coordinate is derived from geodata.
const PLAN = {
  west: 0.379, north: 0.22, south: 0.89, quay: 0.14,
  corusX: 0.77, corusY: 0.40
};
const PLAN_FEATURES = [
  {
    id: 'beachOutcrop', name: 'Beach bedrock outcrop', kind: 'outcrop', plan: [0.472, 0.525],
    length: 8.0, width: 5.0, height: 1.15, yaw: 'shore',
    note: 'Gentle, low, flattened north beach bedrock; about 8x5 m (photo proportion, plan extent).'
  },
  {
    id: 'plazaOutcrop', name: 'Plaza bedrock outcrop', kind: 'outcrop', plan: [0.656, 0.585],
    length: 12.0, width: 8.0, height: 1.8, yaw: 'corus',
    note: 'Larger irregular flat bedrock in the plaza in front of the Corus stage doors; about 12x8 m.'
  },
  {
    id: 'northMound', name: 'North grass mound', kind: 'mound', plan: [0.556, 0.24],
    radiusX: 9.0, radiusZ: 7.5, height: 2.25, yaw: 0.35,
    note: 'Large rounded-triangle mound at the north of the plaza (plan approximate).'
  },
  {
    id: 'middleMound', name: 'Middle grass mound', kind: 'mound', plan: [0.624, 0.424],
    radiusX: 7.0, radiusZ: 6.0, height: 1.85, yaw: -0.5,
    note: 'Middle mound of the amphitheatre; planted with existing trees.'
  },
  {
    id: 'southMound', name: 'South grass mound', kind: 'mound', plan: [0.641, 0.505],
    radiusX: 6.0, radiusZ: 5.0, height: 1.5, yaw: 0.9,
    note: 'Southern mound, between the middle mound and the plaza outcrop.'
  },
  {
    id: 'splashPad', name: 'Maple-leaf water feature', kind: 'splash', plan: [0.598, 0.754],
    length: 5.2, width: 5.0, height: 0.12, jets: 7,
    note: 'Flush/low-step dark charcoal granite maple leaf at the beach/promenade boundary; no floating pool.'
  }
];
const SKIPPED = [
  { id: 'htoPark', reason: 'HTO knolls/boardwalk are owned by waterfront-hto-landscape.js; not duplicated here' },
  { id: 'sugarBoardwalk', reason: 'the boardwalk is the existing mapped park path; not duplicated' }
];

const ROCK_STRIPES = { red: [0.12, 0.20], white: [0.20, 0.40], spacing: [1.5, 3.0] };

// ---------------------------------------------------------------- geometry / data helpers ---------------------------------

function ringBox(ring) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}
function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function distanceToEdge(ax, az, bx, bz, x, z) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}
function distanceToRing(ring, x, z) {
  let d = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) d = Math.min(d, distanceToEdge(ring[j][0], ring[j][1], ring[i][0], ring[i][1], x, z));
  return d;
}

// The outcrop footprint outline, shared by the rendered geometry and the pre-build furniture keepout. Unit radius in
// local rock space; the instance scales it by half length/half width.
function outcropUnitRing(n = 10) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 0.78 + 0.14 * Math.sin(a * 3 + 0.8) + 0.06 * Math.sin(a * 5 - 1.4);
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
}
const OUTCROP_RING = outcropUnitRing();
const ROCK_BASE_SCALE = 1.12; // the outcrop's widest (buried) base ring
const OUTCROP_BASE_RING = OUTCROP_RING.map(([x, z]) => [x * ROCK_BASE_SCALE, z * ROCK_BASE_SCALE]);
function outcropContains(feature, x, z, margin = 0) {
  const dx = x - feature.x, dz = z - feature.z;
  const cs = Math.cos(feature.yaw), sn = Math.sin(feature.yaw);
  const hx = feature.length / 2, hz = feature.width / 2;
  const u = (dx * cs - dz * sn) / hx, v = (dx * sn + dz * cs) / hz;
  if (margin <= 0) return pointInRing(OUTCROP_BASE_RING, u, v);
  // conservative: the smaller world half-axis governs the margin
  return pointInRing(OUTCROP_BASE_RING, u, v) && distanceToRing(OUTCROP_BASE_RING, u, v) * Math.min(hx, hz) >= margin;
}
function frameCovers(frame, box) {
  if (!frame) return false;
  const f = frame.detail || frame;
  return box.minX >= f.x0 && box.maxX <= f.x1 && box.minZ >= f.z0 && box.maxZ <= f.z1;
}
function hash(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// The real park ring and the real Corus Quay footprint corner used as the plan georeference.
function sugarParkRing(areas = C?.GEO?.areas) {
  if (!Array.isArray(areas)) return null;
  for (const a of areas) {
    if (a[0] !== 'park' || a[1] !== 'Sugar Beach') continue;
    const flat = a[2];
    const ring = [];
    for (let i = 0; i + 1 < flat.length; i += 2) ring.push([flat[i], flat[i + 1]]);
    return ring.length >= 3 ? ring : null;
  }
  return null;
}
function corusNorthwestCorner(buildings = C?.GEO?.buildings) {
  if (!Array.isArray(buildings)) return null;
  for (const row of buildings) {
    const [cx, cz, ang, parts] = row;
    if (row[9] !== 'Corus Quay' || !Array.isArray(parts)) continue;
    const cs = Math.cos(ang), sn = Math.sin(ang);
    let best = null;
    for (const [u0, u1, v0, v1] of parts) {
      for (const [u, v] of [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]) {
        // the city's building convention (js/buildings.js): world x = cx + u cos + v sin, z = cz - u sin + v cos
        const x = cx + u * cs + v * sn, z = cz - u * sn + v * cs;
        if (!best || x < best[0] || (x === best[0] && z < best[1])) best = [x, z];
      }
    }
    if (best) return { corner: best, angle: ang };
  }
  return null;
}

// The plan -> world affine. SW = max-z park vertex (seawall/harbour corner); north = min-x park vertex (top of the west
// seawall); Corus = westmost real Corus Quay footprint corner. Plan +x is across the site (west->east), plan +y is down
// the site (north->south). This is a two-axis fit, so the not-to-scale plan is allowed different x/y scales.
function planGeoreference({ ring = sugarParkRing(), corus = corusNorthwestCorner() } = {}) {
  if (!ring || !corus) return null;
  let north = ring[0], sw = ring[0];
  for (const p of ring) {
    if (p[0] < north[0] || (p[0] === north[0] && p[1] < north[1])) north = p;
    if (p[1] > sw[1] || (p[1] === sw[1] && p[0] > sw[0])) sw = p;
  }
  const corusCorner = corus.corner;
  const by = [
    (north[0] - sw[0]) / (PLAN.north - PLAN.south),
    (north[1] - sw[1]) / (PLAN.north - PLAN.south)
  ];
  const bx = [
    (corusCorner[0] - sw[0] - by[0] * (PLAN.corusY - PLAN.south)) / (PLAN.corusX - PLAN.west),
    (corusCorner[1] - sw[1] - by[1] * (PLAN.corusY - PLAN.south)) / (PLAN.corusX - PLAN.west)
  ];
  const planToWorld = (px, py) => [
    sw[0] + bx[0] * (px - PLAN.west) + by[0] * (py - PLAN.south),
    sw[1] + bx[1] * (px - PLAN.west) + by[1] * (py - PLAN.south)
  ];
  // direction of the mapped south shore (plan +x maps to it) and of the west seawall (plan +y maps to it)
  const shoreAngle = Math.atan2(-by[1], by[0]); // yaw whose local +x is the world plan +x direction
  return { ring, north, sw, corus: corusCorner, corusAngle: corus.angle, bx, by, planToWorld, shoreAngle };
}

// Physical (not named-boundary) clearance: real building footprints and roads. The OSM park name polygon is not the
// landscape boundary here (it cuts through the northern Corus plaza), so mounds are validated against these instead.
function physicalContext(buildings = [], roads = [], areaBox) {
  const near = (x, z, pad) => x > areaBox.minX - pad && x < areaBox.maxX + pad && z > areaBox.minZ - pad && z < areaBox.maxZ + pad;
  const bs = [];
  for (const row of buildings) {
    if (!near(row[0], row[1], 170)) continue;
    bs.push(row);
  }
  const rs = [];
  for (const row of roads) {
    const flat = row[6];
    const half = Math.max(2.5, (row[1] || 5) / 2);
    if (!Array.isArray(flat)) continue;
    for (let i = 0; i + 3 < flat.length; i += 2) {
      const ax = flat[i], az = flat[i + 1], bx = flat[i + 2], bz = flat[i + 3];
      if (near((ax + bx) / 2, (az + bz) / 2, 170)) rs.push({ ax, az, bx, bz, half });
    }
  }
  return { buildings: bs, roads: rs };
}
function buildingClearance(context, x, z) {
  let best = Infinity;
  for (const row of context.buildings) {
    const [cx, cz, ang, parts] = row;
    const cs = Math.cos(ang), sn = Math.sin(ang);
    const dx = x - cx, dz = z - cz;
    const u = dx * cs - dz * sn, v = dx * sn + dz * cs;
    for (const [u0, u1, v0, v1] of parts) {
      const du = Math.max(u0 - u, 0, u - u1);
      const dv = Math.max(v0 - v, 0, v - v1);
      const d = Math.hypot(du, dv);
      if (d < best) best = d;
    }
  }
  return best;
}
function roadClearance(context, x, z) {
  let best = Infinity;
  for (const s of context.roads) {
    const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L2));
    const d = Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t)) - s.half;
    if (d < best) best = d;
  }
  return best;
}
function planRectToWorld(georef, x0, y0, x1, y1) {
  return [georef.planToWorld(x0, y0), georef.planToWorld(x1, y0), georef.planToWorld(x1, y1), georef.planToWorld(x0, y1)];
}

// The pure layout: every source feature with its plan coordinate, world estimate, dimensions, ground level and
// confidence. `estimate` is always true for a plan-derived position; `clamped` records a mapped-ground correction.
function waterfrontBeachLandscapeLayout({ frame = C?.GEO?.frame, areas = C?.GEO?.areas, buildings = C?.GEO?.buildings, roads = C?.GEO?.roads, sands = C?.WATERFRONT_SAND_RINGS } = {}) {
  const ring = sugarParkRing(areas);
  const sandRing = sands && sands.sugarBeach;
  const georef = planGeoreference({ ring, corus: corusNorthwestCorner(buildings) });
  const skipped = SKIPPED.map((s) => ({ ...s }));
  if (!ring) return { site: null, features: [], skipped: [{ id: 'sugarBeach', reason: 'Sugar Beach park ring not in this GEO frame' }, ...skipped], georef: null };
  if (!georef) return { site: null, features: [], skipped: [{ id: 'sugarBeach', reason: 'Corus Quay footprint or park anchors missing' }, ...skipped], georef: null };
  if (!Array.isArray(sandRing) || sandRing.length < 3) return { site: null, features: [], skipped: [{ id: 'sugarBeach', reason: 'shared OSM sand ring missing' }, ...skipped], georef: null };
  const box = ringBox(ring);
  if (!frameCovers(frame, box)) return { site: null, features: [], skipped: [{ id: 'sugarBeach', reason: 'Sugar Beach not in the active GEO frame' }, ...skipped], georef: null };

  const ground = GROUND();
  // The source-plan plaza envelope (north Corus plaza + the mapped park's plaza). The named OSM park polygon has a
  // notch that excludes the north plaza, so the hardscape apron is the union of the mapped park and this plan rectangle.
  const plazaEnvelope = planRectToWorld(georef, 0.42, 0.20, 0.75, 0.64);
  const context = physicalContext(buildings || [], roads || [], box);
  const features = PLAN_FEATURES.map((f) => {
    const [px, py] = f.plan;
    const [x, z] = georef.planToWorld(px, py);
    let cx = x, cz = z, adjusted = 0, offPark = !pointInRing(ring, x, z), suspect = false, blockedReason = null;
    if (f.kind === 'mound') {
      const margin = Math.max(f.radiusX, f.radiusZ) + 1.0;
      // Validate against actual mapped buildings and streets, not the named park polygon (which cuts through the north
      // plaza). If the historical source point is now occupied, skip that mound and record why; do not relocate it.
      const building = buildingClearance(context, x, z);
      const road = roadClearance(context, x, z);
      if (building < margin) { suspect = true; blockedReason = 'building'; }
      else if (road < margin) { suspect = true; blockedReason = 'street'; }
      else if (pointInRing(sandRing, x, z) || distanceToRing(sandRing, x, z) < 1.5) { suspect = true; blockedReason = 'sand'; }
      offPark = !pointInRing(ring, cx, cz);
    }
    const yaw = f.kind === 'outcrop' ? (f.yaw === 'corus' ? georef.corusAngle : georef.shoreAngle) : (f.yaw || 0) + (f.kind === 'splash' ? georef.shoreAngle : 0);
    const feature = {
      id: f.id, name: f.name, kind: f.kind, plan: [px, py], x: cx, z: cz, y: ground, yaw,
      estimate: true, offPark, clamped: adjusted > 0.01, adjustedMeters: Math.round(adjusted * 10) / 10,
      suspect, blockedReason, built: !suspect, note: f.note
    };
    if (f.kind === 'outcrop') Object.assign(feature, { length: f.length, width: f.width, height: f.height });
    if (f.kind === 'mound') Object.assign(feature, { radiusX: f.radiusX, radiusZ: f.radiusZ, height: f.height });
    if (f.kind === 'splash') Object.assign(feature, { length: f.length, width: f.width, height: f.height, jets: f.jets });
    return feature;
  });

  for (const f of features) {
    if (f.suspect) {
      const occupied = f.blockedReason === 'building'
        ? 'historical plan location is now the mapped/current-photo Waterfront Innovation Centre building'
        : f.blockedReason === 'street' ? 'historical plan location is now a mapped street' : 'historical plan location is sand';
      skipped.push({ id: f.id, reason: `${occupied}; skipped rather than relocated (source has 3 historical mounds, 2 are current-supported)` });
    }
  }

  // mapped-ground cross-checks (informational, not placement inputs)
  const beach = features.find((f) => f.id === 'beachOutcrop');
  const fountain = features.find((f) => f.id === 'splashPad');
  const beachInSand = pointInRing(sandRing, beach.x, beach.z);
  const fountainInSand = pointInRing(sandRing, fountain.x, fountain.z);
  const fountainToSand = distanceToRing(sandRing, fountain.x, fountain.z);
  const quayPrediction = georef.planToWorld(PLAN.west + (PLAN.corusX - PLAN.west) * 0.25, PLAN.quay);
  const georeference = {
    plan: PLAN,
    anchors: {
      north: georef.north.slice(), sw: georef.sw.slice(), corus: georef.corus.slice()
    },
    basis: { x: georef.bx.map((v) => Math.round(v * 100) / 100), y: georef.by.map((v) => Math.round(v * 100) / 100) },
    quayPrediction: quayPrediction.map((v) => Math.round(v * 10) / 10),
    note: 'Plan is not to scale; positions are a two-axis affine estimate from the mapped park seawall and Corus footprint.'
  };
  return {
    site: { id: 'sugarBeach', name: 'Sugar Beach', parkRing: ring, sandRing, box, ground },
    aprons: { parkRing: ring, plazaEnvelope },
    features, skipped, georeference,
    checks: {
      beachInSand, fountainInSand,
      fountainDistanceToSand: Math.round(fountainToSand * 10) / 10,
      rocksToFountain: Math.round(Math.hypot(beach.x - fountain.x, beach.z - fountain.z) * 10) / 10
    },
    estimates: PLAN_FEATURES.map((f) => ({ id: f.id, ...(f.length ? { length: f.length, width: f.width } : {}), ...(f.radiusX ? { radiusX: f.radiusX, radiusZ: f.radiusZ } : {}), height: f.height }))
  };
}

// The mound surface shape. Broad shoulders, a flat-ish crown and a finite (smooth) slope that fades to zero at the
// grade; the angular asymmetry is multiplied by the radius so it vanishes exactly at the centre (shape(0,0) = 1).
function moundShape(u, v) {
  const r = Math.hypot(u, v);
  if (r >= 1) return 0;
  const t = Math.min(1, Math.max(0, (r - 0.10) / 0.90));
  const base = 1 - t * t * (3 - 2 * t); // smoothstep shoulder: 1 in the crown, 0 at the grade, no vertical cusp
  const theta = Math.atan2(v, u);
  const asym = 1 + 0.06 * r * Math.sin(3 * theta + 0.7) + 0.03 * r * Math.sin(5 * theta - 1.1);
  return Math.max(0, base * asym);
}
// World (x,z) -> local mound coordinates (same transform as the instance matrix: yaw about +Y, scale radiusX/radiusZ)
function moundLocal(feature, x, z) {
  const dx = x - feature.x, dz = z - feature.z;
  const cs = Math.cos(feature.yaw), sn = Math.sin(feature.yaw);
  const u = (dx * cs - dz * sn) / feature.radiusX;
  const v = (dx * sn + dz * cs) / feature.radiusZ;
  return [u, v];
}

// The maple leaf outline in unit local coordinates (x across, z along the leaf; tip at +z). It is a paving inlay, not
// a pool. The rendered mesh and pointInLeaf both use this exact outline.
const LEAF_OUTLINE = [
  [0.00, 0.52], [0.10, 0.68], [0.14, 0.96], [0.24, 0.84], [0.43, 0.98], [0.39, 0.74],
  [0.62, 0.79], [0.55, 0.57], [0.82, 0.52], [0.68, 0.32], [0.92, 0.12], [0.65, 0.10],
  [0.58, -0.14], [0.31, -0.08], [0.30, -0.35], [0.10, -0.28], [0.06, -0.52],
  [-0.06, -0.52], [-0.10, -0.28], [-0.30, -0.35], [-0.31, -0.08], [-0.58, -0.14],
  [-0.65, 0.10], [-0.92, 0.12], [-0.68, 0.32], [-0.82, 0.52], [-0.55, 0.57],
  [-0.62, 0.79], [-0.39, 0.74], [-0.43, 0.98], [-0.24, 0.84], [-0.14, 0.96], [-0.10, 0.68]
];
function pointInLeafLocal(lx, lz) {
  let inside = false;
  for (let i = 0, j = LEAF_OUTLINE.length - 1; i < LEAF_OUTLINE.length; j = i++) {
    const [xi, zi] = LEAF_OUTLINE[i], [xj, zj] = LEAF_OUTLINE[j];
    if ((zi > lz) !== (zj > lz) && lx < ((xj - xi) * (lz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
// Leaf local (unit outline) -> world (x,z). Matches the mesh's rotation about +Y.
function leafToWorld(feature, lx, lz) {
  const sx = feature.width / 2, sz = feature.length / 2;
  const cs = Math.cos(feature.yaw), sn = Math.sin(feature.yaw);
  const u = lx * sx, v = lz * sz;
  return [feature.x + u * cs + v * sn, feature.z - u * sn + v * cs];
}
// World (x,z) -> unit leaf local. Inverse of leafToWorld.
function leafFromWorld(feature, x, z) {
  const dx = x - feature.x, dz = z - feature.z;
  const cs = Math.cos(feature.yaw), sn = Math.sin(feature.yaw);
  return [(dx * cs - dz * sn) / (feature.width / 2), (dx * sn + dz * cs) / (feature.length / 2)];
}
// Is a world point on the leaf? `margin` expands the leaf (metres) for furniture keepout.
function pointInLeaf(dx, dz, yaw, length, width, margin = 0) {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const hx = width / 2 + margin, hz = length / 2 + margin;
  const lx = (dx * cs - dz * sn) / hx, lz = (dx * sn + dz * cs) / hz;
  return pointInLeafLocal(lx, lz);
}

// Contiguous inside-leaf runs of a horizontal (local-x) line at local z. Used to clip the paver joints to the leaf.
function leafRunsAtZ(lz) {
  const runs = [];
  let start = null;
  for (let lx = -0.95; lx <= 0.95; lx += 0.01) {
    const inside = pointInLeafLocal(lx, lz);
    if (inside && start == null) start = lx;
    if ((!inside || lx + 0.01 > 0.95) && start != null) {
      const end = inside ? lx : lx - 0.01;
      if (end - start > 0.06) runs.push([start, end]);
      start = null;
    }
  }
  return runs;
}
// Seven broad, well-spread jet sites inside the maple leaf (farthest-point sampling of an inside-leaf grid), roughly
// 0.8 m apart rather than a central bundle.
function leafJetSites(count) {
  const candidates = [];
  for (let lz = -0.48; lz <= 0.92; lz += 0.16) {
    for (let lx = -0.88; lx <= 0.88; lx += 0.16) {
      if (pointInLeafLocal(lx, lz)) candidates.push([lx, lz]);
    }
  }
  if (!candidates.length) return [];
  let cx = 0, cz = 0;
  for (const c of candidates) { cx += c[0]; cz += c[1]; }
  cx /= candidates.length; cz /= candidates.length;
  let first = 0, fd = -1;
  for (let i = 0; i < candidates.length; i++) {
    const d = Math.hypot(candidates[i][0] - cx, candidates[i][1] - cz);
    if (d > fd) { fd = d; first = i; }
  }
  const picked = [candidates[first]];
  while (picked.length < Math.min(count, candidates.length)) {
    let best = null, bestD = -1;
    for (const c of candidates) {
      let minD = Infinity;
      for (const p of picked) minD = Math.min(minD, Math.hypot(c[0] - p[0], c[1] - p[1]));
      if (minD > bestD) { bestD = minD; best = c; }
    }
    if (!best) break;
    picked.push(best);
    candidates.splice(candidates.indexOf(best), 1);
  }
  return picked;
}

// The pure layout is cached so the pre-build furniture keepout can run after scripts load but before the builder.
let landscapeCache = { geo: null, sands: null, layout: null };
function currentLandscapeLayout() {
  if (landscapeCache.geo !== C?.GEO || landscapeCache.sands !== C?.WATERFRONT_SAND_RINGS || !landscapeCache.layout) {
    landscapeCache = { geo: C?.GEO, sands: C?.WATERFRONT_SAND_RINGS, layout: waterfrontBeachLandscapeLayout() };
  }
  return landscapeCache.layout;
}

// Pre-build furniture keepout: the exact outcrop footprints plus the maple-leaf footprint where it meets the sand.
// Call this from the furniture candidate test (chair/umbrella centres) so the published counts can be preserved on
// the remaining open sand without deleting furniture after the fact.
function waterfrontBeachLandscapeKeepoutAt(x, z, margin = 0.4) {
  const layout = currentLandscapeLayout();
  if (!layout || !layout.site) return false;
  for (const f of layout.features) {
    if (!f.built) continue;
    if (f.kind === 'outcrop' && outcropContains(f, x, z, margin)) return true;
    if (f.kind === 'splash') {
      const nearSand = f.offPark === false || layout.checks.fountainDistanceToSand < 6;
      if (nearSand && pointInLeaf(x - f.x, z - f.z, f.yaw, f.length, f.width, margin)) return true;
    }
  }
  return false;
}

// Exact rendered-surface height at (x, z): the built mound/leaf triangles are stored in world space by the builder and
// sampled with barycentric interpolation, so this agrees with the visible tessellation (including the mound mesh's
// ground offset). Disabled/unsupported frames return null. This is the API the captain can hook into walking/trees.
function sampleSurfaceTriangles(surface, x, z) {
  if (!surface) return null;
  let best = null;
  for (const t of surface.triangles) {
    if (x < t.minX || x > t.maxX || z < t.minZ || z > t.maxZ) continue;
    const den = (t.z1 - t.z2) * (t.x0 - t.x2) + (t.x2 - t.x1) * (t.z0 - t.z2);
    if (Math.abs(den) < 1e-12) continue;
    const a = ((t.z1 - t.z2) * (x - t.x2) + (t.x2 - t.x1) * (z - t.z2)) / den;
    const b = ((t.z2 - t.z0) * (x - t.x2) + (t.x0 - t.x2) * (z - t.z2)) / den;
    const c = 1 - a - b;
    if (a < -1e-7 || b < -1e-7 || c < -1e-7) continue;
    const y = a * t.y0 + b * t.y1 + c * t.y2;
    if (best == null || y > best) best = y;
  }
  return best;
}
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

function waterfrontBeachLandscapeHeightAt(x, z) {
  if (!C?.waterfrontBeachLandscapeEnabled) return null;
  const result = C.waterfrontBeachLandscape;
  if (!result || !result.surfaces || !result.layout || !result.layout.site) return null;
  if (outsideBounds(surfaceBounds(result.surfaces, (add) => {
    for (const s of result.surfaces) { add(s.minX, s.minZ); add(s.maxX, s.maxZ); }
  }), x, z)) return null;
  let best = null;
  for (const surface of result.surfaces) {
    if (x < surface.minX || x > surface.maxX || z < surface.minZ || z > surface.maxZ) continue;
    const y = sampleSurfaceTriangles(surface, x, z);
    if (y != null && (best == null || y > best)) best = y;
  }
  return best;
}
function waterfrontBeachLandscapeGroundAt(x, z) {
  const h = waterfrontBeachLandscapeHeightAt(x, z);
  return h == null ? GROUND() : h;
}

// ---------------------------------------------------------------- meshes ----------------------------------------------------

function standardMaterial(THREE, params) {
  const Mat = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
  return new Mat(params);
}
function graniteMaterial(THREE) {
  const mat = standardMaterial(THREE, { color: 0x9a9186, roughness: 0.96, metalness: 0.0 });
  const T = C?.TSL;
  if (!T || !mat.isNodeMaterial) return mat;
  const { Fn, positionWorld, color, float, mix, sin, fract } = T;
  try {
    const light = color(0xa79d90), dark = color(0x827a70);
    mat.colorNode = Fn(() => {
      const p = positionWorld.xz;
      const broad = sin(p.x.mul(0.33)).mul(0.5).add(0.5).mul(sin(p.y.mul(0.29)).mul(0.5).add(0.5));
      const grain = fract(sin(p.x.mul(31.7).add(p.y.mul(17.3))).mul(43758.5453));
      return mix(dark, light, broad).mul(grain.mul(0.18).add(0.91));
    })();
  } catch (err) {
    console.warn('[waterfrontBeachLandscape] granite colour node skipped:', err && err.message);
  }
  return mat;
}
function grassMaterial(THREE) {
  const mat = standardMaterial(THREE, { color: 0x55703a, roughness: 1.0, metalness: 0.0 });
  const T = C?.TSL;
  if (!T || !mat.isNodeMaterial) return mat;
  const { Fn, positionWorld, color, float, mix, sin, fract } = T;
  try {
    const a = color(0x4d6735), b = color(0x637d44);
    mat.colorNode = Fn(() => {
      const p = positionWorld.xz;
      const drift = sin(p.x.mul(0.21)).mul(0.5).add(0.5).mul(sin(p.y.mul(0.17)).mul(0.5).add(0.5));
      const grain = fract(sin(p.x.mul(21.9).add(p.y.mul(13.1))).mul(43758.5453));
      return mix(a, b, drift).mul(grain.mul(0.14).add(0.92));
    })();
  } catch (err) {
    console.warn('[waterfrontBeachLandscape] grass colour node skipped:', err && err.message);
  }
  return mat;
}
// World-space triangle soup for the exact height sampler. `matrix` transforms the geometry to world; `topOnly`
// keeps upward-facing faces (the leaf's 12 cm top, not its buried sides).
function collectSurface(THREE, geometry, matrix, topOnly = false) {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const count = index ? index.count : pos.count;
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const triangles = [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i + 2 < count; i += 3) {
    for (let k = 0; k < 3; k++) {
      const at = index ? index.getX(i + k) : i + k;
      v[k].fromBufferAttribute(pos, at).applyMatrix4(matrix);
    }
    if (topOnly) {
      const ux = v[1].x - v[0].x, uz = v[1].z - v[0].z;
      const wx = v[2].x - v[0].x, wz = v[2].z - v[0].z;
      // (u x w)_y = u_z w_x - u_x w_z; keep only upward-facing faces
      if (uz * wx - ux * wz <= 0) continue;
    }
    const t = {
      x0: v[0].x, y0: v[0].y, z0: v[0].z,
      x1: v[1].x, y1: v[1].y, z1: v[1].z,
      x2: v[2].x, y2: v[2].y, z2: v[2].z,
      minX: Math.min(v[0].x, v[1].x, v[2].x), maxX: Math.max(v[0].x, v[1].x, v[2].x),
      minZ: Math.min(v[0].z, v[1].z, v[2].z), maxZ: Math.max(v[0].z, v[1].z, v[2].z)
    };
    triangles.push(t);
    minX = Math.min(minX, t.minX); maxX = Math.max(maxX, t.maxX);
    minZ = Math.min(minZ, t.minZ); maxZ = Math.max(maxZ, t.maxZ);
  }
  return triangles.length ? { minX, maxX, minZ, maxZ, triangles } : null;
}
function collectInstancedSurface(THREE, mesh, topOnly = false) {
  const out = [];
  const instance = new THREE.Matrix4(), world = new THREE.Matrix4();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, instance);
    world.multiplyMatrices(mesh.matrixWorld, instance);
    const s = collectSurface(THREE, mesh.geometry, world, topOnly);
    if (s) out.push(s);
  }
  return out;
}

// Warm pale granite/cobble plaza: fine rectangular joints and grain, no texture dependency.
function paverMaterial(THREE) {
  const mat = standardMaterial(THREE, { color: 0xa39d94, roughness: 0.94, metalness: 0.0 });
  const T = C?.TSL;
  if (!T || !mat.isNodeMaterial) return mat;
  const { Fn, positionWorld, color, float, mix, smoothstep, fract, sin } = T;
  try {
    const warm = color(0xb0a89d), cool = color(0x8d8880), joint = color(0x706b64);
    mat.colorNode = Fn(() => {
      const p = positionWorld.xz;
      const gx = fract(p.x.mul(1 / 0.62)), gz = fract(p.y.mul(1 / 0.62));
      const jx = smoothstep(float(0.0), float(0.045), gx);
      const jz = smoothstep(float(0.0), float(0.045), gz);
      const face = jx.mul(jz); // 0 exactly on a joint line
      const grain = fract(sin(p.x.mul(31.7).add(p.y.mul(21.3))).mul(43758.5453));
      const drift = sin(p.x.mul(0.13)).mul(0.5).add(0.5).mul(sin(p.y.mul(0.11)).mul(0.5).add(0.5));
      return mix(joint, mix(cool, warm, drift), face).mul(grain.mul(0.13).add(0.93));
    })();
  } catch (err) {
    console.warn('[waterfrontBeachLandscape] paver colour node skipped:', err && err.message);
  }
  return mat;
}

// Append an upward-facing triangulated ring at height y to shared position/uv arrays. The aprons are simple rings;
// the sand and mound meshes are drawn above, so no holes are needed here (and no paths are covered).
function appendRing(THREE, ring, y, pos, uv) {
  const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
  const faces = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const [i, j, k] of faces) {
    const a = ring[i], b = ring[j], c = ring[k];
    const up = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    const order = up >= 0 ? [a, b, c] : [a, c, b];
    for (const p of order) { pos.push(p[0], y, p[1]); uv.push(p[0], -p[1]); }
  }
}
function plazaGeometry(THREE, rings, y) {
  const pos = [], uv = [];
  // 0.5 mm between the two overlapping aprons so their coplanar triangles never z-fight
  rings.forEach((ring, i) => appendRing(THREE, ring, y + i * 0.0005, pos, uv));
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  const norr = new Float32Array((pos.length / 3) * 3);
  for (let i = 0; i < norr.length; i += 3) norr[i + 1] = 1;
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(norr, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

// TSL ground mask: discard the generic park lawn over the source plaza apron (mapped park + north plaza envelope).
// Apply it ONLY to the park lawn material; paths are a different material and remain above. Idempotent, composes with
// an existing maskNode, and is a no-op off-frame or on a non-node material.
function applyWaterfrontBeachLandscapeGroundMask(mat) {
  if (!mat) return mat;
  if (mat.userData && mat.userData.waterfrontBeachLandscapeMask) return mat;
  const layout = currentLandscapeLayout();
  if (!layout || !layout.aprons) return mat;
  const T = C?.TSL;
  if (!T || !mat.isNodeMaterial) return mat;
  const { Fn, positionWorld, float } = T;
  try {
    const node = Fn(() => {
      const p = positionWorld.xz;
      let inside = null;
      for (const ring of [layout.aprons.parkRing, layout.aprons.plazaEnvelope]) {
        let crossings = float(0);
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const ax = ring[j][0], az = ring[j][1], bx = ring[i][0], bz = ring[i][1];
          if (az === bz) continue;
          const inZ = p.y.greaterThanEqual(float(Math.min(az, bz))).and(p.y.lessThan(float(Math.max(az, bz))));
          const tE = p.y.sub(float(az)).div(float(bz - az));
          const xInt = float(ax).add(float(bx - ax).mul(tE));
          const left = p.x.lessThan(xInt);
          crossings = crossings.add(T.select(inZ.and(left), float(1), float(0)));
        }
        const odd = crossings.mod(2).greaterThan(0.5);
        inside = inside ? inside.or(odd) : odd;
      }
      return inside || float(0).greaterThan(float(1));
    })();
    mat.maskNode = mat.maskNode ? mat.maskNode.and(node.not()) : node.not();
    if (!mat.userData) mat.userData = {};
    mat.userData.waterfrontBeachLandscapeMask = true;
  } catch (err) {
    console.warn('[waterfrontBeachLandscape] ground mask not applied:', err && err.message);
  }
  return mat;
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
  mesh.userData.cullDistance = opts.cullDistance ?? 600;
  mesh.userData.cullCell = opts.cullCell ?? 120;
  if (opts.role) mesh.userData.role = opts.role;
  if (mesh.computeBoundingSphere) mesh.computeBoundingSphere();
  return mesh;
}

// A unit low bedrock outcrop: irregular 10-gon top at y=1, a slightly wider bottom, vertical-ish quarry sides. Scaled
// per instance to the source footprint; the top stays broadly flat (people sit on it) with small natural variation.
function outcropGeometry(THREE) {
  const n = OUTCROP_RING.length;
  const top = [], bottom = [];
  for (let i = 0; i < n; i++) {
    const [rx, rz] = OUTCROP_RING[i];
    const a = (i / n) * Math.PI * 2;
    // slightly smaller top than base: a low, broad bedrock with a sloped rim, not a vertical mesa
    top.push([rx * 0.92, 0.99 + 0.025 * Math.sin(a * 4 + 0.3), rz * 0.92]);
    bottom.push([rx * 1.12, 0, rz * 1.12]);
  }
  const pos = [], norr = [];
  const push = (a, b, c) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    for (const p of [a, b, c]) pos.push(p[0], p[1], p[2]);
    for (let k = 0; k < 3; k++) norr.push(nx / l, ny / l, nz / l);
  };
  const centre = [0, 1.0, 0];
  // top faces wound counter-clockwise seen from above (+Y normal), sides wound outward
  for (let i = 0; i < n; i++) push(centre, top[(i + 1) % n], top[i]);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    push(bottom[i], top[j], bottom[j]);
    push(bottom[i], top[i], top[j]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norr, 3));
  return g;
}

// The actual rock triangles in unit local space ({ three [x,y,z] corners }). Bands are clipped to these, so they can
// never project past the footprint or float over another facet.
function geometryTriangles(geometry) {
  const p = geometry.attributes.position;
  const out = [];
  for (let i = 0; i + 2 < p.count; i += 3) out.push([
    [p.getX(i), p.getY(i), p.getZ(i)],
    [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)],
    [p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)]
  ]);
  return out;
}
function triangleNormal(tri) {
  const [a, b, c] = tri;
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}
function clipPolygonYMin(poly, ymin) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ain = a[1] >= ymin, bin = b[1] >= ymin;
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (ymin - a[1]) / (b[1] - a[1] || 1e-12);
      out.push([a[0] + (b[0] - a[0]) * t, ymin, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return out;
}
function clipPolygonX(poly, xmin, xmax) {
  const clip = (points, limit, keepGreater) => {
    const out = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const ain = keepGreater ? a[0] >= limit : a[0] <= limit;
      const bin = keepGreater ? b[0] >= limit : b[0] <= limit;
      if (ain) out.push(a);
      if (ain !== bin) {
        const t = (limit - a[0]) / (b[0] - a[0] || 1e-12);
        out.push([limit, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      }
    }
    return out;
  };
  let out = clip(poly, xmin, true);
  if (out.length < 3) return [];
  out = clip(out, xmax, false);
  return out.length >= 3 ? out : [];
}
// Transform a clipped local polygon to world, lift it 3 mm along the facet normal, and fan-triangulate it into the
// merged stripe/seam buffers.
function appendSurfacePolygon(THREE, poly, matrix, pos, norr, normal, lift = 0.003) {
  if (poly.length < 3) return 0;
  const a = new THREE.Vector3(poly[0][0], poly[0][1], poly[0][2]).applyMatrix4(matrix);
  const b = new THREE.Vector3(poly[1][0], poly[1][1], poly[1][2]).applyMatrix4(matrix);
  const c = new THREE.Vector3(poly[2][0], poly[2][1], poly[2][2]).applyMatrix4(matrix);
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  // keep the facet normal oriented like the source triangle (avoids lifting into the rock)
  if (normal && nx * normal[0] + ny * normal[1] + nz * normal[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
  const world = poly.map((p) => new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(matrix));
  for (const w of world) { w.x += nx * lift; w.y += ny * lift; w.z += nz * lift; }
  let made = 0;
  for (let i = 1; i + 1 < world.length; i++) {
    const p0 = world[0], p1 = world[i], p2 = world[i + 1];
    const ax = p1.x - p0.x, ay = p1.y - p0.y, az = p1.z - p0.z;
    const bx = p2.x - p0.x, by = p2.y - p0.y, bz = p2.z - p0.z;
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    if (Math.hypot(cx, cy, cz) < 1e-7) continue;
    for (const w of [p0, p1, p2]) { pos.push(w.x, w.y, w.z); norr.push(nx, ny, nz); }
    made++;
  }
  return made;
}
function mergedSurfaceMesh(THREE, pos, norr, material, name, role) {
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norr, 3));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material);
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.cullDistance = 450;
  mesh.userData.cullCell = 90;
  mesh.userData.role = role;
  return mesh;
}

// A unit smooth grass dome (radius 1, height 1) built from the same moundShape() the height API uses.
function moundGeometry(THREE) {
  const rings = 14, segs = 36;
  const pos = [], norr = [], index = [];
  const addVertex = (x, y, z, nx, ny, nz) => { pos.push(x, y, z); norr.push(nx, ny, nz); return pos.length / 3 - 1; };
  const centre = addVertex(0, 1, 0, 0, 1, 0);
  const grid = [];
  for (let r = 1; r <= rings; r++) {
    const rr = r / rings;
    const row = [];
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const u = Math.cos(a) * rr, v = Math.sin(a) * rr;
      const y = moundShape(u, v);
      const e = 0.01;
      const hx = (moundShape(u + e, v) - moundShape(u - e, v)) / (2 * e);
      const hz = (moundShape(u, v + e) - moundShape(u, v - e)) / (2 * e);
      const nx = -hx, nz = -hz, ny = 1;
      const nl = Math.hypot(nx, ny, nz) || 1;
      row.push(addVertex(u, y, v, nx / nl, ny / nl, nz / nl));
    }
    grid.push(row);
  }
  for (let s = 0; s < segs; s++) index.push(centre, grid[0][(s + 1) % segs], grid[0][s]);
  for (let r = 0; r < rings - 1; r++) {
    for (let s = 0; s < segs; s++) {
      const a = grid[r][s], b = grid[r][(s + 1) % segs], c = grid[r + 1][(s + 1) % segs], d = grid[r + 1][s];
      index.push(a, b, d, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norr, 3));
  g.setIndex(index);
  return g;
}

// The low charcoal maple-leaf inlay: an extruded leaf top + side, flat and flush-ish (12 cm), no pool.
function leafGeometry(THREE, length, width) {
  const shape = new THREE.Shape();
  const sx = width / 2, sz = length / 2;
  LEAF_OUTLINE.forEach(([x, z], i) => {
    // ExtrudeGeometry's shape Y becomes world -Z after rotateX(-PI/2); negate it so the mesh matches the +Z outline.
    const px = x * sx, py = -z * sz;
    if (i === 0) shape.moveTo(px, py); else shape.lineTo(px, py);
  });
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  // ExtrudeGeometry's depth is along +z, which rotateX(-PI/2) turns into +y; drop the bottom to y=0.
  g.computeBoundingBox();
  g.translate(0, -g.boundingBox.min.y, 0);
  return g;
}

function createWaterfrontBeachLandscape(THREE = C?.THREE, scene = null) {
  if (!THREE) throw new Error('waterfront-beach-landscape: THREE is required');
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const layout = waterfrontBeachLandscapeLayout();
  if (!layout.site) {
    if (C) C.waterfrontBeachLandscapeEnabled = false;
    console.info('[waterfrontBeachLandscape] none in this map: ' + layout.skipped.map((s) => `${s.id} (${s.reason})`).join('; '));
    return null;
  }
  const ground = layout.site.ground;
  const group = new THREE.Group();
  group.name = 'WaterfrontBeachLandscape';
  const stats = {
    features: layout.features.map((f) => ({ id: f.id, kind: f.kind, x: Math.round(f.x * 10) / 10, z: Math.round(f.z * 10) / 10, height: f.height, estimate: true, clamped: f.clamped, adjustedMeters: f.adjustedMeters, suspect: f.suspect, built: f.built })),
    rocks: 0, mounds: 0, moundsHistorical: 3, stripes: 0, seams: 0, jets: 0,
    meshes: 0, instances: 0, triangles: 0, colliders: 0, skipped: layout.skipped,
    georeference: layout.georeference, checks: layout.checks, estimates: layout.estimates,
    ms: 0
  };

  const rocks = layout.features.filter((f) => f.kind === 'outcrop' && f.built);
  const mounds = layout.features.filter((f) => f.kind === 'mound' && f.built);
  const splash = layout.features.find((f) => f.kind === 'splash' && f.built);
  const graniteMat = graniteMaterial(THREE);
  const grassMat = grassMaterial(THREE);
  const stripeRed = standardMaterial(THREE, { color: 0xb5342f, roughness: 0.82, metalness: 0.0 });
  const stripeWhite = standardMaterial(THREE, { color: 0xe7e2d8, roughness: 0.82, metalness: 0.0 });
  const seamMat = standardMaterial(THREE, { color: 0x565049, roughness: 0.98, metalness: 0.0 });
  const leafMat = standardMaterial(THREE, { color: 0x3c3d3c, roughness: 0.95, metalness: 0.0 });
  const jointMat = standardMaterial(THREE, { color: 0x6f716c, roughness: 0.95, metalness: 0.0 });
  const jetMat = standardMaterial(THREE, { color: 0xb7dce6, roughness: 0.25, metalness: 0.0, transparent: true, opacity: 0.55 });

  const rockGeo = outcropGeometry(THREE);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const moundGeo = moundGeometry(THREE);

  // The source plaza hardscape apron: the mapped park + the northern Corus plaza envelope. Sand and the three grass
  // mounds sit above it, so they read as the only soft islands in a hard plaza (not blobs on the generic lawn).
  const plazaMat = paverMaterial(THREE);
  const plazaGeo = plazaGeometry(THREE, [layout.aprons.parkRing, layout.aprons.plazaEnvelope], ground + 0.001);
  if (plazaGeo) {
    const plaza = new THREE.Mesh(plazaGeo, plazaMat);
    plaza.name = 'WaterfrontBeachLandscape-PlazaApron';
    plaza.receiveShadow = true;
    plaza.castShadow = false;
    plaza.userData.cullDistance = 700;
    plaza.userData.cullCell = 120;
    plaza.userData.role = 'beach-plaza';
    if (plaza.computeBoundingSphere) plaza.computeBoundingSphere();
    group.add(plaza);
    stats.meshes++;
    stats.triangles += plazaGeo.attributes.position.count / 3;
    stats.plazaAprons = 2;
  }

  // Two bedrock outcrops, one shared instanced geometry, scaled to the source footprints.
  const rockItems = rocks.map((f) => ({
    x: f.x, y: ground - 0.06, z: f.z, ry: f.yaw,
    sx: f.length / 2, sy: f.height + 0.06, sz: f.width / 2,
    color: f.id === 'plazaOutcrop' ? 0x9d9387 : 0x968d82
  }));
  const rockMesh = makeInstanced(THREE, rockGeo, graniteMat, rockItems, 'WaterfrontBeachLandscape-Rocks', { cullDistance: 550, cullCell: 120, role: 'bedrock-outcrop' });
  if (rockMesh) { group.add(rockMesh); stats.meshes++; stats.instances += rockItems.length; stats.triangles += rockGeo.attributes.position.count / 3 * rockItems.length; stats.rocks = rocks.length; }

  // Candy stripes and quarry seams are clipped to the ACTUAL rock triangles: each band is a set of polygons cut from
  // the same top/side triangles, lifted 3 mm along the facet normal. No box slab can project past the footprint.
  const localTris = geometryTriangles(rockGeo);
  const redPos = [], redNor = [], whitePos = [], whiteNor = [], seamPos = [], seamNor = [];
  let redBands = 0, whiteBands = 0, seamBands = 0;
  let redBandCount = 0, whiteBandCount = 0, seamCount = 0;
  for (const f of rocks) {
    const sx = f.length / 2, sy = f.height + 0.06, sz = f.width / 2;
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(f.x, ground - 0.06, f.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, f.yaw, 0)),
      new THREE.Vector3(sx, sy, sz)
    );
    const seed = hash(f.x, f.z);
    // source stripe bands: irregular red/white widths, 1.5-3 m spacing, running across the rock
    const bands = [];
    let along = -0.40 * f.length;
    let k = 0;
    while (along < 0.40 * f.length - 0.5) {
      const pair = k % 2 === 0;
      const w = pair ? ROCK_STRIPES.red[0] + seed * (ROCK_STRIPES.red[1] - ROCK_STRIPES.red[0])
        : ROCK_STRIPES.white[0] + seed * (ROCK_STRIPES.white[1] - ROCK_STRIPES.white[0]);
      bands.push({ pair, x0: along / sx, x1: (along + w) / sx });
      along += w + ROCK_STRIPES.spacing[0] + ((seed * 7.13 + k * 1.77) % 1) * (ROCK_STRIPES.spacing[1] - ROCK_STRIPES.spacing[0]);
      k++;
    }
    // vertical quarry cut seams: narrow bands on the actual side facets
    const seams = [-0.32, 0, 0.32].map((t) => {
      const cx = t * f.length;
      return { x0: (cx - 0.035) / sx, x1: (cx + 0.035) / sx };
    });
    redBandCount += bands.filter((b) => b.pair).length;
    whiteBandCount += bands.filter((b) => !b.pair).length;
    seamCount += seams.length;
    for (const tri of localTris) {
      const top = triangleNormal(tri)[1] > 0.5;
      // stripes follow the top AND the upper sloped rim, clipped to the same actual triangles; the buried lower
      // rim (below the plaza) is not painted, so every band stays inside the visible footprint.
      const facet = top ? tri : clipPolygonYMin(tri, 0.15);
      if (facet.length >= 3) {
        for (const band of bands) {
          const poly = clipPolygonX(facet, band.x0, band.x1);
          const made = appendSurfacePolygon(THREE, poly, matrix, band.pair ? redPos : whitePos, band.pair ? redNor : whiteNor, null, 0.003);
          if (made) { if (band.pair) redBands++; else whiteBands++; }
        }
      }
      // quarry seams are narrow dark bands on the side facets only, lifted just above the stripes
      if (!top) {
        for (const seam of seams) {
          const poly = clipPolygonX(tri, seam.x0, seam.x1);
          const made = appendSurfacePolygon(THREE, poly, matrix, seamPos, seamNor, null, 0.006);
          if (made) seamBands++;
        }
      }
    }
  }
  const redMesh = mergedSurfaceMesh(THREE, redPos, redNor, stripeRed, 'WaterfrontBeachLandscape-StripesRed', 'candy-stripe');
  const whiteMesh = mergedSurfaceMesh(THREE, whitePos, whiteNor, stripeWhite, 'WaterfrontBeachLandscape-StripesWhite', 'candy-stripe');
  const seamMesh = mergedSurfaceMesh(THREE, seamPos, seamNor, seamMat, 'WaterfrontBeachLandscape-QuarrySeams', 'quarry-seam');
  for (const m of [redMesh, whiteMesh, seamMesh]) if (m) { group.add(m); stats.meshes++; stats.triangles += m.geometry.attributes.position.count / 3; }
  stats.stripes = redBandCount + whiteBandCount;
  stats.seams = seamCount;
  stats.stripePolygons = redBands + whiteBands;
  stats.seamPolygons = seamBands;

  // Three grass mounds, one shared instanced dome. The height API evaluates the same shape.
  const moundItems = mounds.map((f) => ({ x: f.x, y: ground + 0.003, z: f.z, ry: f.yaw, sx: f.radiusX, sy: f.height, sz: f.radiusZ }));
  const moundMesh = makeInstanced(THREE, moundGeo, grassMat, moundItems, 'WaterfrontBeachLandscape-Mounds', { cullDistance: 650, cullCell: 120, role: 'grass-mound' });
  if (moundMesh) { group.add(moundMesh); stats.meshes++; stats.instances += moundItems.length; stats.triangles += (moundGeo.index ? moundGeo.index.count / 3 : moundGeo.attributes.position.count / 3) * moundItems.length; stats.mounds = mounds.length; }

  // World-space triangles of the actual rendered walking surfaces (mounds + leaf top), built after the meshes exist.
  const surfaces = [];
  group.updateMatrixWorld(true);
  if (moundMesh) surfaces.push(...collectInstancedSurface(THREE, moundMesh));

  // The flush maple-leaf inlay + its vertical jets.
  if (splash) {
    const leaf = new THREE.Mesh(leafGeometry(THREE, splash.length, splash.width), leafMat);
    leaf.name = 'WaterfrontBeachLandscape-MapleLeafFountain';
    leaf.position.set(splash.x, ground, splash.z);
    leaf.rotation.y = splash.yaw;
    leaf.castShadow = false;
    leaf.receiveShadow = true;
    leaf.userData.cullDistance = 380;
    leaf.userData.cullCell = 80;
    leaf.userData.role = 'maple-leaf-fountain';
    if (leaf.computeBoundingSphere) leaf.computeBoundingSphere();
    group.add(leaf);
    leaf.updateMatrixWorld(true);
    const leafSurface = collectSurface(THREE, leaf.geometry, leaf.matrixWorld, true);
    if (leafSurface) surfaces.push(leafSurface);
    stats.meshes++;
    stats.triangles += leaf.geometry.index ? leaf.geometry.index.count / 3 : leaf.geometry.attributes.position.count / 3;

    // fine pavement joints, each clipped to the leaf outline so no line runs out onto the plaza
    const joints = [];
    for (const lz of [-0.10, 0.16, 0.42]) {
      for (const [a, b] of leafRunsAtZ(lz)) {
        const start = leafToWorld(splash, a, lz), end = leafToWorld(splash, b, lz);
        const mx = (start[0] + end[0]) / 2, mz = (start[1] + end[1]) / 2;
        joints.push({
          x: mx, y: ground + splash.height + 0.004, z: mz,
          ry: splash.yaw, sx: Math.hypot(end[0] - start[0], end[1] - start[1]) - 0.03, sy: 0.006, sz: 0.018
        });
      }
    }
    const jointMesh = makeInstanced(THREE, boxGeo, jointMat, joints, 'WaterfrontBeachLandscape-FountainJoints', { castShadow: false, cullDistance: 360, cullCell: 80, role: 'fountain-joint' });
    if (jointMesh) { group.add(jointMesh); stats.meshes++; stats.instances += jointMesh.count; }

    // Seven broad, well-spread jets across the leaf (not a central bundle).
    const jetGeo = new THREE.CylinderGeometry(1, 1, 1, 7, 1, true);
    const jetItems = [];
    const heights = [0.55, 0.9, 1.35, 1.8, 1.1, 0.7, 1.55];
    const sites = leafJetSites(splash.jets);
    sites.forEach(([lx, lz], i) => {
      const [x, z] = leafToWorld(splash, lx, lz);
      const h = heights[i % heights.length];
      jetItems.push({ x, y: ground + splash.height + h / 2, z, sx: 0.035, sy: h, sz: 0.035 });
    });
    const jetMesh = makeInstanced(THREE, jetGeo, jetMat, jetItems, 'WaterfrontBeachLandscape-FountainJets', { castShadow: false, receiveShadow: false, cullDistance: 360, cullCell: 80, role: 'fountain-jet' });
    if (jetMesh) { group.add(jetMesh); stats.meshes++; stats.instances += jetItems.length; stats.jets = jetItems.length; }
  }

  // Colliders: the two rocks are obstacles; the mounds and the flush leaf are walkable ground (height API), not colliders.
  const colliders = [];
  for (const f of rocks) {
    const cs = Math.cos(f.yaw), sn = Math.sin(f.yaw);
    const hx = f.length / 2, hz = f.width / 2;
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz;
    const ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    colliders.push({
      minX: f.x - ex, maxX: f.x + ex, minZ: f.z - ez, maxZ: f.z + ez,
      minY: ground - 0.06, maxY: ground + f.height, prop: true, kind: 'bedrock-outcrop',
      obb: { cx: f.x, cz: f.z, hx, hz, cs, sn }
    });
  }
  stats.colliders = colliders.length;

  // Existing furniture keepout report: the module never removes chairs; it records any that overlap a new footprint.
  try {
    const furn = C?.waterfrontDetails?.layout || (C?.waterfrontLayout && C.waterfrontLayout({ fixtures: false }));
    const sugar = furn && furn.sites && furn.sites.find((s) => s.id === 'sugarBeach');
    if (sugar && Array.isArray(sugar.chairs)) {
      let min = Infinity;
      for (const f of layout.features) {
        if (f.kind !== 'outcrop') continue;
        for (const c of sugar.chairs) min = Math.min(min, Math.hypot(c.x - f.x, c.z - f.z));
      }
      stats.nearestChairToOutcrop = Number.isFinite(min) ? Math.round(min * 10) / 10 : null;
    }
  } catch (err) {
    stats.nearestChairToOutcrop = null;
  }

  stats.surfaces = surfaces.length;
  stats.surfaceTriangles = surfaces.reduce((n, s) => n + s.triangles.length, 0);
  stats.ms = Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 10) / 10;
  group.userData.waterfrontBeachLandscape = stats;
  if (scene && scene.add) scene.add(group);
  const result = { group, root: group, colliders, stats, layout, surfaces };
  if (C) {
    C.waterfrontBeachLandscape = result;
    C.waterfrontBeachLandscapeEnabled = true;
    C.rootWaterfrontBeachLandscape = group;
  }
  console.info(`[waterfrontBeachLandscape] Sugar Beach: ${stats.rocks} outcrops, ${stats.mounds} mounds, ` +
    `${stats.stripes} candy stripes, ${stats.jets} fountain jets (${stats.triangles} triangles, ${stats.ms} ms); ` +
    `skipped: ${layout.skipped.map((s) => s.id).join(', ') || 'none'}`);
  return result;
}

Object.assign(C || (window.CITY = {}), {
  WATERFRONT_BEACH_LANDSCAPE_FEATURES: PLAN_FEATURES,
  waterfrontBeachLandscapeLayout,
  planGeoreference,
  sugarParkRing,
  corusNorthwestCorner,
  OUTCROP_RING,
  outcropContains,
  moundShape,
  waterfrontBeachLandscapeHeightAt,
  waterfrontBeachLandscapeGroundAt,
  waterfrontBeachLandscapeKeepoutAt,
  applyWaterfrontBeachLandscapeGroundMask,
  pointInLeaf,
  pointInLeafLocal,
  leafToWorld,
  createWaterfrontBeachLandscape,
  buildWaterfrontBeachLandscape: createWaterfrontBeachLandscape
});
})();
