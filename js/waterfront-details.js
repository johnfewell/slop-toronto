(function () {
// js/waterfront-details.js
// The two urban beaches the waterfront is known by, as real, walkable detail rather than flat park polygons:
// Canada's Sugar Beach (36 pink umbrellas, 150 white Muskoka/Adirondack chairs; Waterfront Toronto, opened 2010-08-09,
// designed by Claude Cormier + Associés) and HTO Park (38 tall yellow all-season umbrellas, Landscape Forms Solstice,
// finished 2007, Janet Rosenberg & Studio / Claude Cormier / Hariri Pontarini).
//
// Placement is constrained to the verified OSM sand polygons (natural=beach + surface=sand), not the whole park, so no
// umbrella or chair lands on the grass, plaza or promenade. Both sand rings below are the exact OSM beach ways converted
// through the game's own projection (js/toronto-geodata.js GEO.frame.projection), with their OSM way ids recorded. The
// module never uses downtown coordinates as a runtime fallback: it builds only when the active GEO frame still covers
// the sand and a matching park area is present (the eglinton map is a different frame and must not inherit blindly), and
// it keeps clear of mapped trees, shrubs/props (including the nested parkSign rows), park paths and the cycling network.
// Tests may opt into the embedded park-ring fixtures explicitly with waterfrontLayout({ fixtures: true }).
//
// Counts are the published numbers, but are reduced when the real sand cannot fit them; they are never padded onto
// grass. The counts and colours come from Waterfront Toronto's project pages (see docs/waterfront-details.md); the
// arrangement inside the sand polygon is a documented estimate. Every part is shared and instanced (six InstancedMeshes
// for both parks), the root is a single culling-friendly group, and each mesh carries scene-culling.js's
// cullDistance / cullCell. main.js calls createWaterfrontDetails(THREE, scene) once after the city is built.
//
// Chairs: Sugar Beach keeps the procedural 3-horizontal-slat Loll Adirondack. HTO Park's DEFAULT seat is the downloaded
// Innerscene "Cape – Adirondack Chair" (CC0), a real broad-arm/reclined-slat Adirondack that the captain accepted as a
// much better match than the procedural fan chair. The procedural HTO chair remains the synchronous fallback if the GLB
// fails to load, and an explicit comparison override (window.CITY.waterfrontChairTrial = false, or
// ?waterfrontChairTrial=0 before the city builds) keeps the procedural chair for side-by-side review. See
// docs/waterfront-furniture-assets.md and assets/props/waterfront-hto-adirondack.PROVENANCE.md.
// Placement, counts, colours and colliders are computed synchronously from the layout regardless of the model load.
//
// Sources (recorded 2026-11-09/10):
// - https://www.waterfrontoronto.ca/our-projects/canadas-sugar-beach (pink umbrellas, 150 chairs, 36 umbrellas,
//   8500 m², 225 m shoreline, opened 2010-08-09; alt text "pink umbrellas, white Muskoka chairs")
// - https://www.asla.org/2012awards/036.html (soft confection pink; 150 white Loll 3-slat Adirondack chairs)
// - https://www.landscapeperformance.org/case-study-briefs/hto-park (fine white sand, 38 vibrant yellow all-season
//   umbrellas, Landscape Forms Solstice Collection, 25 mounds, 106 trees, boardwalk)
// - https://en.wikipedia.org/wiki/HTO_Park (enormous fixed yellow metal umbrellas and Muskoka chairs)
// - OSM Overpass geometry $WATERFRONT_RESEARCH/research/osm-geom.json: way 172728993 (Sugar Beach sand) and way
//   189306980 (HTO Beach). The committed OSM park rings and the tree/prop/path layers are read from js/toronto-geodata.js.

const C = window.CITY;
const SW = C.CITY_BOUNDS?.sidewalkHeight ?? 0.22;

// The downloaded Adirondack chair and its baked footprint. This is the Innerscene "Cape – Adirondack Chair" (CC0, original
// model, 85 W × 101 D × 106 H cm) — a real Adirondack: broad flat + fan arms, separate seat slats, a reclined fan/vertical-
// slat back and four legs. It matches the HTO Park chair silhouette; Sugar Beach's Loll 3-horizontal-slat chair differs, so
// this model is the HTO match, not a Sugar substitute.
//
// It is the DEFAULT HTO seat (captain-accepted). The procedural HTO chair is the synchronous fallback if the GLB fails to
// load, and an explicit override keeps the procedural chair for comparison.
const CHAIR_MODEL_URL = './assets/props/waterfront-hto-adirondack.glb';
const CHAIR_MODEL_SIZE = { width: 0.849, height: 1.06, depth: 1.012 };
// Which beaches take the downloaded model. The Innerscene chair is a fan/fan-arm Adirondack: it reads as the HTO chairs
// (rounded fan back), not Sugar's 3-horizontal-slat Loll chair. Sugar keeps the procedural chair.
const CHAIR_MODEL_STYLES = new Set(['vertical']);
// Default ON. `window.CITY.waterfrontChairTrial = false` or `?waterfrontChairTrial=0` forces the procedural chair for an
// explicit side-by-side comparison; normal users get the accepted model with no opt-in.
const chairModelEnabled = () => {
  if (typeof window === 'undefined') return true;
  if (window.CITY && window.CITY.waterfrontChairTrial === false) return false;
  try {
    const q = window.location?.search || '';
    if (/(?:^|[?&])waterfrontChairTrial=0(?:&|$)/.test(q)) return false;
  } catch (e) { /* no location: keep the default */ }
  return true;
};

// Verified OSM sand polygons in world metres (GEO.frame.projection, origin Union Station, axes -16.59°).
// Sugar Beach: OSM way 172728993, natural=beach surface=sand, 3,190 m².
const SUGAR_SAND_RING = [
  [921.9, 524.8], [910.1, 454.5], [915.4, 461.5], [925.6, 478.3], [936.8, 501.1], [933.4, 500.8],
  [931.7, 500.7], [930.1, 501.4], [929.8, 502.9], [929, 504.2], [929.3, 505.8], [931.3, 506.8],
  [932.7, 506.4], [933.9, 506.7], [935.1, 508.6], [935.7, 510.5], [942.2, 513.4], [944.4, 515.8],
  [950, 523.6], [940.5, 529], [942.5, 531.9], [952.3, 526.6], [954.5, 528.8], [955.4, 533.7],
  [956.2, 539.6], [956.4, 544.1], [957.2, 548.5], [959, 554.3], [964.4, 558.8], [977.5, 570.5],
  [982.7, 578.2], [931.4, 588.7]
];
// HTO Beach: OSM way 189306980, natural=beach, 1,330 m².
const HTO_SAND_RING = [
  [-873.3, 667.9], [-766.8, 680.7], [-766.7, 663.6], [-787.2, 663.7], [-787.3, 660.6],
  [-854.8, 660.7], [-854.7, 663.7], [-873.3, 663.8]
];

// Fallback park rings are fixtures for tests/tools only; the runtime always reads GEO.areas.
const SUGAR_BEACH_RING = [
  [906.8, 435.4], [931.4, 588.7], [1165.4, 544.2], [1165.2, 533.1], [1089.2, 543.5],
  [985.1, 561.4], [970.6, 482.8], [959.7, 460.8], [936.8, 465], [915.4, 427.4]
];
const HTO_PARK_RING = [
  [-892, 564.7], [-891.5, 601.4], [-839.4, 601.7], [-836.7, 654.4], [-878.9, 655.6],
  [-879.3, 677.5], [-757.8, 695.8], [-757.8, 562.9]
];

const WATERFRONT_SITE_SPECS = [
  {
    id: 'sugarBeach', name: 'Sugar Beach', parkAreaName: 'Sugar Beach', address: '11 Dockside Dr',
    fallbackParkRing: SUGAR_BEACH_RING, sandRing: SUGAR_SAND_RING,
    sandSource: 'OSM way 172728993 (natural=beach, surface=sand, ~3,190 m²)',
    published: { umbrellas: 36, chairs: 150 }, chairsPerUmbrella: 4, chairColorVerified: true, chairStyle: 'horizontal',
    // estimate: the sand faces the Jarvis Slip; the nearest mapped water area picks the final direction at runtime
    waterDirection: [-0.99, -0.02], edgeMargin: 0.35, obstacleExtra: 0.6, chairMargin: 0.65, chairSpacing: 1.0,
    chairUmbrellaSep: 0.62, chairCollider: { hx: 0.33, hz: 0.47, top: 0.95 },
    canopyColor: 0xef8fa5, chairPalette: [0xf2efe8], canopyRadius: 1.8, canopyHeight: 0.62, rimHeight: 2.55, canopyGap: 0.6,
    poleRadius: 0.045, poleHeight: 2.9, canopyMetal: false
  },
  {
    id: 'htoPark', name: 'HTO Park', parkAreaName: 'HTO Park', address: '339 Queens Quay W',
    fallbackParkRing: HTO_PARK_RING, sandRing: HTO_SAND_RING,
    sandSource: 'OSM way 189306980 (natural=beach, ~1,330 m²)',
    // Nelson Architectural Metal Designs: 108-inch (2.7432 m) diameter perforated aluminium umbrellas on 3-inch
    // (76.2 mm) stainless posts; the City's current park photo shows multicolour red/yellow/blue/green chairs.
    published: { umbrellas: 38, chairs: 76 }, chairsPerUmbrella: 2, chairColorVerified: true, chairStyle: 'vertical',
    // estimate: the beach faces the lake (south); the nearest mapped water area picks the final direction at runtime
    // The accepted Innerscene Adirondack is 0.849 W × 1.012 D × 1.06 H m: half-diagonal 0.6605 m. The sand margin is
    // 0.67 m so the whole chair (circumscribed circle) stays on the sand; chair spacing is 2 × half-diagonal (1.321 m) and
    // the umbrella separation is half-diagonal + pole radius (0.6986 m), so no chair overlaps another or a pole.
    waterDirection: [0, 1], edgeMargin: 0.35, obstacleExtra: 0.6, chairMargin: 0.67, chairSpacing: 1.321,
    chairUmbrellaSep: 0.6986, chairCollider: { hx: 0.425, hz: 0.507, top: 1.06 },
    canopyColor: 0xf2c21b, chairPalette: [0xc8352c, 0xf2c21b, 0x2d6db5, 0x3f7d3a],
    canopyRadius: 1.3716, canopyHeight: 0.45, rimHeight: 2.45, canopyGap: 0.25,
    poleRadius: 0.0381, poleHeight: 2.7, canopyMetal: true
  }
];

const hash = (x, z) => {
  const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return n - Math.floor(n);
};

function ringOf(areas, name) {
  if (!Array.isArray(areas)) return null;
  for (const a of areas) {
    if (!Array.isArray(a) || a[0] !== 'park' || a[1] !== name) continue;
    const flat = a[2];
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
const inBox = (b, x, z, pad = 0) => x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad;

function frameCovers(frame, box) {
  if (!frame) return false;
  const f = frame.detail || frame;
  return box.minX >= f.x0 && box.maxX <= f.x1 && box.minZ >= f.z0 && box.maxZ <= f.z1;
}

function principalAxis(ring) {
  let cx = 0, cz = 0;
  for (const p of ring) { cx += p[0]; cz += p[1]; }
  cx /= ring.length; cz /= ring.length;
  let sxx = 0, sxz = 0, szz = 0;
  for (const p of ring) {
    const dx = p[0] - cx, dz = p[1] - cz;
    sxx += dx * dx; sxz += dx * dz; szz += dz * dz;
  }
  const th = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  return { cx, cz, ux: Math.cos(th), uz: Math.sin(th), nx: -Math.sin(th), nz: Math.cos(th) };
}

// The direction from the sand to the nearest mapped water (Jarvis Slip for Sugar Beach, the lake for HTO).
function waterDirection(sandRing, areas, fallback) {
  const box = ringBox(sandRing);
  const c = principalAxis(sandRing);
  let best = null, bestD = Infinity;
  for (const a of areas || []) {
    if (!Array.isArray(a) || a[0] !== 'water' || !Array.isArray(a[2])) continue;
    const ring = [];
    for (let i = 0; i + 1 < a[2].length; i += 2) ring.push([a[2][i], a[2][i + 1]]);
    if (ring.length < 3) continue;
    const b = ringBox(ring);
    if (b.minX > box.maxX + 700 || b.maxX < box.minX - 700 || b.minZ > box.maxZ + 700 || b.maxZ < box.minZ - 700) continue;
    // nearest water edge to the sand centre
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const ax = ring[j][0], az = ring[j][1], bx = ring[i][0], bz = ring[i][1];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((c.cx - ax) * dx + (c.cz - az) * dz) / L2)) : 0;
      const px = ax + dx * t, pz = az + dz * t;
      const d = Math.hypot(px - c.cx, pz - c.cz);
      if (d < bestD) { bestD = d; best = [px - c.cx, pz - c.cz]; }
    }
  }
  if (!best || bestD < 1e-6 || bestD > 400) return fallback;
  const L = Math.hypot(best[0], best[1]);
  return [best[0] / L, best[1] / L];
}

// Mapped blockers near a sand polygon: trees, street furniture (parkSign is a nested record per row), park paths, the
// cycling network, and mapped scrub/wood (shrub) patches. Shrubs passed explicitly (opts.shrubs) are added too. The
// sand box keeps the scan small.
function blockersNear(sandRing, { trees, props, parkPaths, cycling, areas, shrubs }) {
  const box = ringBox(sandRing);
  const pad = 12;
  const circles = [];
  const blockers = [];
  const add = (x, z, r, kind) => { const c = { x, z, r, kind }; circles.push(c); blockers.push(c); };
  for (let i = 0; i + 3 < (trees || []).length; i += 4) {
    const x = trees[i], z = trees[i + 1];
    if (inBox(box, x, z, pad)) add(x, z, 0.34, 'tree');
  }
  const radius = { hydrant: 0.35, bikeRing: 0.3, shelter: 1.3, litterBin: 0.35, postBox: 0.35, parkSign: 0.45 };
  for (const [kind, rows] of Object.entries(props || {})) {
    if (!Array.isArray(rows) || !rows.length) continue;
    if (Array.isArray(rows[0])) {
      for (const row of rows) if (Array.isArray(row) && Number.isFinite(row[0]) && inBox(box, row[0], row[1], pad)) add(row[0], row[1], radius[kind] || 0.35, kind);
    } else {
      for (let i = 0; i + 1 < rows.length; i += 2) if (inBox(box, rows[i], rows[i + 1], pad)) add(rows[i], rows[i + 1], radius[kind] || 0.35, kind);
    }
  }
  const addLine = (flat, width) => {
    let lx0 = Infinity, lx1 = -Infinity, lz0 = Infinity, lz1 = -Infinity;
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const x = flat[i], z = flat[i + 1];
      if (x < lx0) lx0 = x; if (x > lx1) lx1 = x;
      if (z < lz0) lz0 = z; if (z > lz1) lz1 = z;
    }
    const lp = 3;
    if (lx0 > box.maxX + lp || lx1 < box.minX - lp || lz0 > box.maxZ + lp || lz1 < box.minZ - lp) return;
    for (let i = 0; i + 3 < flat.length; i += 2) {
      const ax = flat[i], az = flat[i + 1], bx = flat[i + 2], bz = flat[i + 3];
      const L = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(L / 1.5));
      for (let k = 0; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
        if (inBox(box, x, z, lp)) add(x, z, Math.max(0.7, width / 2) + 0.25, 'path');
      }
    }
  };
  for (const p of parkPaths || []) {
    const flat = Array.isArray(p) ? (typeof p[0] === 'number' && p.length > 3 ? p.slice(1) : p[2]) : p && p.pts;
    if (!Array.isArray(flat)) continue;
    addLine(flat, typeof p[0] === 'number' && p[0] < 12 ? p[0] : 3.0);
  }
  for (const b of cycling?.bands || []) if (Array.isArray(b) && Array.isArray(b[2])) addLine(b[2], 3.0);
  // mapped scrub/wood (shrub) polygons and explicitly supplied shrubs
  for (const [kind, list] of [['scrub', (areas || []).filter((a) => a[0] === 'scrub')], ['wood', (areas || []).filter((a) => a[0] === 'wood')]]) {
    for (const a of list) {
      const ring = [];
      for (let i = 0; i + 1 < a[2].length; i += 2) ring.push([a[2][i], a[2][i + 1]]);
      if (ring.length < 3) continue;
      const b = ringBox(ring);
      if (b.minX > box.maxX + pad || b.maxX < box.minX - pad || b.minZ > box.maxZ + pad || b.maxZ < box.minZ - pad) continue;
      blockers.push({ kind, ring });
    }
  }
  for (const s of shrubs || []) {
    if (Array.isArray(s)) add(s[0], s[1], s[2] ?? 0.6, 'shrub');
    else if (Number.isFinite(s.x)) add(s.x, s.z, s.r ?? 0.6, 'shrub');
  }
  // a 6 m grid keeps the minimum-distance tests over thousands of path samples O(1)
  const cell = 6, grid = new Map(), key = (i, j) => i * 100003 + j;
  for (const c of circles) {
    const k = key(Math.floor(c.x / cell), Math.floor(c.z / cell));
    (grid.get(k) || grid.set(k, []).get(k)).push(c);
  }
  return { box, circles, blockers, grid, cell };
}

const separated = (x, z, minDist, placed) => {
  for (const p of placed) if (Math.hypot(p.x - x, p.z - z) < minDist) return false;
  return true;
};

function clearOf(blockers, x, z, extra) {
  if (C.waterfrontBeachLandscapeKeepoutAt?.(x, z, Math.max(0.7, extra))) return false;
  if (blockers.grid) {
    const i = Math.floor(x / blockers.cell), j = Math.floor(z / blockers.cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      for (const c of blockers.grid.get((i + a) * 100003 + (j + b)) || []) if (Math.hypot(c.x - x, c.z - z) < extra + c.r) return false;
    }
  } else for (const c of blockers.circles) if (Math.hypot(c.x - x, c.z - z) < extra + c.r) return false;
  for (const b of blockers.blockers) {
    if (!b.ring) continue;
    if (pointInRing(b.ring, x, z)) return false;
    if (distanceToRing(b.ring, x, z) < extra + 0.2) return false;
  }
  return true;
}

// A spacing grid keeps the minimum-distance tests O(1) instead of O(placed), so laying out 200+ chairs stays fast.
function spacingGrid(minDist) {
  const cell = Math.max(1, minDist);
  const map = new Map();
  const key = (i, j) => i * 100003 + j;
  return {
    add(x, z) {
      const k = key(Math.floor(x / cell), Math.floor(z / cell));
      const list = map.get(k) || map.set(k, []).get(k);
      list.push([x, z]);
    },
    has(x, z, minDist2) {
      const i = Math.floor(x / cell), j = Math.floor(z / cell);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        for (const q of map.get(key(i + a, j + b)) || []) if ((q[0] - x) ** 2 + (q[1] - z) ** 2 < minDist2 * minDist2) return true;
      }
      return false;
    }
  };
}

// Even spread over the sand: repeatedly take the candidate farthest from everything already placed (deterministic).
// Candidates are already sand-clipped and obstacle-cleared by sandCandidates; this only enforces spacing and spread.
function farthestPoints(candidates, target, minDist, placed, extra) {
  const grid = spacingGrid(minDist);
  for (const p of placed) grid.add(p.x, p.z);
  const list = candidates;
  const dist = new Array(list.length).fill(Infinity);
  const refresh = (x, z) => {
    for (let i = 0; i < list.length; i++) {
      const d = (list[i].x - x) ** 2 + (list[i].z - z) ** 2;
      if (d < dist[i]) dist[i] = d;
    }
  };
  for (const p of placed) refresh(p.x, p.z);
  const used = new Uint8Array(list.length);
  while (placed.length < target) {
    let bi = -1, bd = -1;
    for (let i = 0; i < list.length; i++) {
      if (used[i] || grid.has(list[i].x, list[i].z, minDist)) continue;
      if (dist[i] > bd) { bd = dist[i]; bi = i; }
    }
    if (bi < 0) break;
    used[bi] = 1;
    const c = list[bi];
    placed.push({ x: c.x, z: c.z, along: c.along, across: c.across });
    grid.add(c.x, c.z);
    refresh(c.x, c.z);
  }
  return placed;
}

// Row-major fill from the sand candidates with the same spacing rules (fast; used for the loose chairs).
function fillSpaced(candidates, target, minDist, placed, extra) {
  const grid = spacingGrid(minDist);
  for (const p of placed) grid.add(p.x, p.z);
  const pick = candidates.slice().sort((a, b) => a.across - b.across || a.along - b.along);
  for (const c of pick) {
    if (placed.length >= target) break;
    if (grid.has(c.x, c.z, minDist)) continue;
    placed.push({ x: c.x, z: c.z, along: c.along, across: c.across });
    grid.add(c.x, c.z);
  }
  return placed;
}

function sandCandidates(sandRing, margin, blockers, extra, step, axis) {
  const box = ringBox(sandRing);
  const { cx, cz, ux, uz, nx, nz } = axis;
  const out = [];
  for (let x = box.minX; x <= box.maxX; x += step) {
    for (let z = box.minZ; z <= box.maxZ; z += step) {
      if (!pointInRing(sandRing, x, z) || distanceToRing(sandRing, x, z) < margin) continue;
      if (!clearOf(blockers, x, z, extra)) continue;
      out.push({
        x, z,
        along: (x - cx) * ux + (z - cz) * uz,
        across: (x - cx) * nx + (z - cz) * nz,
        blockers
      });
    }
  }
  return out;
}

function layoutSite(spec, parkRing, sandRing, layers) {
  const axis = principalAxis(sandRing);
  const blockers = blockersNear(sandRing, layers);
  const water = waterDirection(sandRing, layers.areas, spec.waterDirection);
  const chairYaw = Math.atan2(water[0], water[1]);
  const result = {
    id: spec.id, name: spec.name, address: spec.address, sandRing, parkRing, axis, water,
    sandSource: spec.sandSource, published: { ...spec.published }, waterDirectionSource: 'nearest mapped water',
    sandArea: ringArea(sandRing)
  };

  // Umbrellas: canopy footprint must fit inside the sand (its centre is canopyRadius + edgeMargin from the edge).
  const umbrellaMargin = spec.canopyRadius + spec.edgeMargin;
  const umbrellaCandidates = sandCandidates(sandRing, umbrellaMargin, blockers, spec.obstacleExtra, 0.7, axis);
  const umbrellas = [];
  farthestPoints(umbrellaCandidates, spec.published.umbrellas, spec.canopyRadius * 2 + (spec.canopyGap ?? 0.6), umbrellas, spec.obstacleExtra);
  for (const u of umbrellas) u.yaw = hash(u.x, u.z) * Math.PI * 2;

  // Chairs: cluster around the umbrellas first (on the sand), then spread over the rest of the sand. The margin, spacing
  // and umbrella separation are per-site so HTO's real downloaded chair (0.849 × 1.012 m, half-diagonal 0.6605 m) keeps
  // its whole footprint on the sand and clear of other chairs and poles; Sugar keeps the procedural chair's values.
  const chairs = [];
  const chairMargin = spec.chairMargin ?? 0.62;
  const chairSpacing = spec.chairSpacing ?? 1.0;
  const chairUmbrellaSep = spec.chairUmbrellaSep ?? 0.62;
  const chairCandidates = sandCandidates(sandRing, chairMargin, blockers, 0.4, 1.0, axis);
  const chairExtra = 0.4;
  const offsets = spec.chairsPerUmbrella >= 4
    ? [[1.25, 0.9], [-1.25, 0.9], [1.25, -0.9], [-1.25, -0.9]]
    : [[1.1, 0.8], [-1.1, 0.8]];
  const tryChair = (x, z) => {
    if (!pointInRing(sandRing, x, z) || distanceToRing(sandRing, x, z) < chairMargin) return false;
    if (!clearOf(blockers, x, z, chairExtra)) return false;
    if (!separated(x, z, chairSpacing, chairs)) return false;
    if (!separated(x, z, chairUmbrellaSep, umbrellas)) return false;
    const palette = spec.chairPalette || [spec.chairColor || 0xf2efe8];
    chairs.push({ x, z, yaw: chairYaw + (hash(x, z) - 0.5) * 0.5, color: palette[chairs.length % palette.length] });
    return true;
  };
  for (const u of umbrellas) {
    for (const [a, b] of offsets) {
      if (chairs.length >= spec.published.chairs) break;
      tryChair(u.x + axis.ux * a + water[0] * b, u.z + axis.uz * a + water[1] * b);
    }
  }
  if (chairs.length < spec.published.chairs) {
    const rest = chairCandidates.filter((c) => separated(c.x, c.z, chairUmbrellaSep, umbrellas));
    fillSpaced(rest, spec.published.chairs, chairSpacing, chairs, chairExtra);
  }
  const palette = spec.chairPalette || [spec.chairColor || 0xf2efe8];
  chairs.forEach((c, i) => {
    if (c.yaw === undefined) c.yaw = chairYaw + (hash(c.x, c.z) - 0.5) * 0.5;
    if (c.color === undefined) c.color = palette[i % palette.length];
  });
  result.umbrellas = umbrellas;
  result.chairs = chairs;
  result.counts = { umbrellas: umbrellas.length, chairs: chairs.length };
  return result;
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a / 2);
}

function waterfrontLayout({
  areas = C?.GEO?.areas, trees = C?.GEO?.streetTrees, props = C?.GEO?.props,
  parkPaths = C?.GEO?.parkPaths, cycling = C?.GEO?.cycling, frame = C?.GEO?.frame,
  shrubs = null, specs = WATERFRONT_SITE_SPECS, fixtures = false, sands = null
} = {}) {
  const sites = [], skipped = [];
  for (const spec of specs) {
    const parkRing = ringOf(areas, spec.parkAreaName);
    const sandRing = (sands && sands[spec.id]) || spec.sandRing;
    if (!parkRing && !fixtures) { skipped.push({ id: spec.id, reason: 'park area not in the active GEO frame' }); continue; }
    if (!fixtures && !frameCovers(frame, ringBox(sandRing))) { skipped.push({ id: spec.id, reason: 'sand not in the active GEO frame' }); continue; }
    sites.push(layoutSite(spec, parkRing || spec.fallbackParkRing, sandRing, { areas, trees, props, parkPaths, cycling, shrubs }));
  }
  const counts = sites.reduce((t, s) => ({ umbrellas: t.umbrellas + s.counts.umbrellas, chairs: t.chairs + s.counts.chairs }), { umbrellas: 0, chairs: 0 });
  return { sites, skipped, counts };
}

// ---------------------------------------------------------------------------------------------------------------------
// Geometry: one shared Adirondack/Muskoka chair and two umbrella constructions. Local +z is the chair's front; every
// part stands on y = 0 so an instance matrix's y is the ground anchor.
// ---------------------------------------------------------------------------------------------------------------------
function merge(THREE, geos) {
  const mergeGeometries = C?.Addons?.mergeGeometries;
  if (!mergeGeometries) throw new Error('waterfront-details: CITY.Addons.mergeGeometries is required');
  const out = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  return out;
}

function box(THREE, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  return g.translate(x, y, z);
}

function cyl(THREE, rTop, rBottom, h, seg, x = 0, y = 0, z = 0) {
  return new THREE.CylinderGeometry(rTop, rBottom, h, seg).translate(x, y + h / 2, z);
}

function chairGeometry(THREE, style = 'horizontal') {
  const parts = [];
  parts.push(box(THREE, 0.62, 0.055, 0.54, 0, 0.39, 0.06));
  parts.push(box(THREE, 0.62, 0.09, 0.05, 0, 0.355, 0.32));
  if (style === 'vertical') {
    // HTO's rounded vertical slats (the City photo's multicolour chairs)
    for (let i = 0; i < 6; i++) {
      const x = -0.25 + (i * 0.10);
      const slat = THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.032, 0.42, 4, 6) : new THREE.CylinderGeometry(0.032, 0.032, 0.49, 6);
      slat.rotateX(-0.20);
      parts.push(slat.translate(x, 0.66, -0.275));
    }
  } else {
    for (let i = 0; i < 3; i++) parts.push(box(THREE, 0.60, 0.15, 0.035, 0, 0.50 + i * 0.155, -0.255 - i * 0.028, -0.20));
  }
  parts.push(box(THREE, 0.055, 0.62, 0.06, -0.30, 0.66, -0.27, -0.20));
  parts.push(box(THREE, 0.055, 0.62, 0.06, 0.30, 0.66, -0.27, -0.20));
  parts.push(box(THREE, 0.115, 0.045, 0.60, -0.355, 0.635, 0.045));
  parts.push(box(THREE, 0.115, 0.045, 0.60, 0.355, 0.635, 0.045));
  parts.push(box(THREE, 0.055, 0.245, 0.055, -0.355, 0.505, 0.31));
  parts.push(box(THREE, 0.055, 0.245, 0.055, 0.355, 0.505, 0.31));
  for (const x of [-0.27, 0.27]) {
    parts.push(box(THREE, 0.06, 0.39, 0.06, x, 0.195, 0.30));
    parts.push(box(THREE, 0.06, 0.90, 0.06, x, 0.45, -0.31, -0.10));
    parts.push(box(THREE, 0.06, 0.06, 0.62, x, 0.32, 0.02));
  }
  return merge(THREE, parts);
}

function umbrellaGeometries(THREE, spec) {
  const pole = merge(THREE, [
    cyl(THREE, spec.poleRadius ?? (spec.canopyMetal ? 0.055 : 0.045), 0.06, spec.poleHeight, 8),
    cyl(THREE, 0.30, 0.32, 0.07, 12)
  ]);
  const can = spec.canopyMetal
    ? new THREE.ConeGeometry(spec.canopyRadius, spec.canopyHeight, 12, 1, true)
    : new THREE.ConeGeometry(spec.canopyRadius, spec.canopyHeight, 8, 1, true);
  can.translate(0, spec.rimHeight + spec.canopyHeight / 2, 0);
  const parts = [can];
  const ring = new THREE.TorusGeometry(spec.canopyRadius * 0.965, spec.canopyMetal ? 0.035 : 0.028, 4, spec.canopyMetal ? 24 : 16);
  ring.rotateX(Math.PI / 2);
  parts.push(ring.translate(0, spec.rimHeight, 0));
  parts.push(cyl(THREE, 0.035, 0.05, 0.28, 6, 0, spec.rimHeight + spec.canopyHeight - 0.04, 0));
  return { pole, canopy: merge(THREE, parts) };
}

function standardMaterial(THREE, params) {
  const Mat = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
  return new Mat(params);
}

// The downloaded chair: one geometry shared by every chair instance of every site, loaded once. It is baked already
// (front +z, base y=0, centred x/z, real 1.06 m height, white material for per-instance tinting); here we only merge the
// mesh's parts into one BufferGeometry and hand it back. Returns null when the loader or the file is unavailable, so
// callers keep the procedural chair. Never throws: a beach with no model is still a beach with chairs.
function loadChairModel(THREE) {
  const { GLTFLoader } = C.Addons || {};
  if (!GLTFLoader) return Promise.resolve(null);
  let loader;
  try { loader = new GLTFLoader(); } catch (e) { return Promise.resolve(null); }
  return loader.loadAsync(CHAIR_MODEL_URL).then((gltf) => {
    const geos = [];
    gltf.scene.updateWorldMatrix(true, true);
    gltf.scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const geo = o.geometry.clone();
      // Meshopt stores positions as normalised 16-bit integers; back to floats or the transform bakes to garbage.
      const pos = geo.attributes.position;
      if (pos && (!(pos.array instanceof Float32Array) || pos.normalized)) {
        const f = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) { f[3 * i] = pos.getX(i); f[3 * i + 1] = pos.getY(i); f[3 * i + 2] = pos.getZ(i); }
        geo.setAttribute('position', new THREE.BufferAttribute(f, 3));
      }
      geo.applyMatrix4(o.matrixWorld);
      geos.push(geo);
    });
    if (!geos.length) return null;
    const out = geos.length === 1 ? geos[0] : merge(THREE, geos);
    if (out !== geos[0]) for (const g of geos) g.dispose?.();
    out.computeBoundingBox();
    out.computeBoundingSphere();
    return out;
  }).catch((e) => {
    console.warn(`[waterfrontDetails] chair model did not load (${CHAIR_MODEL_URL}); keeping the procedural chair:`, e);
    return null;
  });
}

function createWaterfrontDetails(THREE = C?.THREE, scene = null) {
  if (!THREE) throw new Error('waterfront-details: THREE is required');
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const layout = waterfrontLayout();
  const group = new THREE.Group();
  group.name = 'WaterfrontDetails';
  const colliders = [];
  const stats = { sites: {}, counts: layout.counts, skipped: layout.skipped, colliders: 0, meshes: 0 };

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  // city-grid.js draws the parks' lawns at sidewalkHeight + 0.004; that is the existing surface here (no separate
  // sand mesh yet), so the furniture stands on it rather than hovering over the generic park ground.
  const groundAt = (x, z) => (C.CITY_BOUNDS?.sidewalkHeight ?? 0.22) + 0.004 + (C.cutAt?.(x, z) || 0);
  const setInstances = (mesh, items, yawOf, colorOf = null) => {
    items.forEach((it, i) => {
      p.set(it.x, groundAt(it.x, it.z), it.z);
      q.setFromAxisAngle(up, yawOf(it));
      mesh.setMatrixAt(i, m.compose(p, q, one));
      if (colorOf) mesh.setColorAt(i, col.setHex(colorOf(it)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };
  const finish = (mesh, { castShadow = true, cullDistance = 900, cullCell = 120 } = {}) => {
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.userData.cullDistance = cullDistance;
    mesh.userData.cullCell = cullCell;
    if (mesh.computeBoundingSphere) mesh.computeBoundingSphere();
    group.add(mesh);
    stats.meshes++;
    return mesh;
  };

  for (const site of layout.sites) {
    if (!site.umbrellas.length) { stats.sites[site.id] = { ...site.counts, published: site.published }; continue; }
    const spec = WATERFRONT_SITE_SPECS.find((s) => s.id === site.id) || site;
    const geo = umbrellaGeometries(THREE, spec);
    const poleMat = standardMaterial(THREE, { color: 0xb8bcc1, roughness: 0.4, metalness: 0.55 });
    const canopyMat = standardMaterial(THREE, {
      color: 0xffffff, roughness: spec.canopyMetal ? 0.48 : 0.92, metalness: spec.canopyMetal ? 0.32 : 0.0,
      side: THREE.DoubleSide
    });
    const poles = new THREE.InstancedMesh(geo.pole, poleMat, site.umbrellas.length);
    poles.name = `WaterfrontDetails_${site.id}_UmbrellaPoles`;
    const canopies = new THREE.InstancedMesh(geo.canopy, canopyMat, site.umbrellas.length);
    canopies.name = `WaterfrontDetails_${site.id}_UmbrellaCanopies`;
    setInstances(poles, site.umbrellas, (it) => it.yaw);
    setInstances(canopies, site.umbrellas, (it) => it.yaw, () => spec.canopyColor);
    finish(poles, { cullDistance: 750 });
    finish(canopies, { cullDistance: 900 });
    for (const u of site.umbrellas) {
      const y = groundAt(u.x, u.z);
      colliders.push({
        minX: u.x - 0.18, maxX: u.x + 0.18, minZ: u.z - 0.18, maxZ: u.z + 0.18,
        minY: y, maxY: y + Math.max(spec.poleHeight, spec.rimHeight + spec.canopyHeight), prop: true, kind: 'umbrella',
        obb: { cx: u.x, cz: u.z, hx: 0.18, hz: 0.18, cs: 1, sn: 0 }
      });
    }
    stats.sites[site.id] = { ...site.counts, published: site.published, canopyColor: spec.canopyColor, chairPalette: spec.chairPalette, chairStyle: spec.chairStyle };
  }

  // The chair meshes get the procedural box now and the downloaded model when it arrives (below). Kept in one list so a
  // single load swaps them all. Colliders describe the real model's footprint and are built synchronously, so main.js's
  // pushAll() sees them on the same tick and walking is right whether or not the GLB ever loads.
  const chairMeshes = [];
  const proceduralGeos = new Set();
  for (const site of layout.sites) {
    if (!site.chairs.length) continue;
    const spec = WATERFRONT_SITE_SPECS.find((s) => s.id === site.id) || site;
    const chairGeo = chairGeometry(THREE, spec.chairStyle);
    proceduralGeos.add(chairGeo);
    const chairMat = standardMaterial(THREE, { color: 0xffffff, roughness: 0.84 });
    const mesh = new THREE.InstancedMesh(chairGeo, chairMat, site.chairs.length);
    mesh.name = `WaterfrontDetails_${site.id}_Chairs`;
    mesh.userData.chairStyle = spec.chairStyle;
    setInstances(mesh, site.chairs, (it) => it.yaw, (it) => it.color);
    // HTO's accepted model is a real chair standing on the sand; let its shared instanced mesh cast the shadow the
    // procedural feet lacked. Sugar keeps the existing no-shadow chairs (no global render change).
    finish(mesh, { castShadow: spec.chairStyle === 'vertical', cullDistance: 420, cullCell: 90 });
    chairMeshes.push(mesh);
    // Colliders use the site's real chair footprint synchronously: HTO's downloaded Adirondack (0.849 × 1.012 m,
    // 1.06 m tall) even before/without the GLB, so the fallback is enclosed too; Sugar keeps the procedural footprint.
    const { hx: chairHx, hz: chairHz, top: chairTop } = spec.chairCollider || { hx: 0.33, hz: 0.47, top: 0.95 };
    for (const c of site.chairs) {
      const y = groundAt(c.x, c.z);
      const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
      const ex = Math.abs(cs) * chairHx + Math.abs(sn) * chairHz, ez = Math.abs(sn) * chairHx + Math.abs(cs) * chairHz;
      colliders.push({
        minX: c.x - ex, maxX: c.x + ex, minZ: c.z - ez, maxZ: c.z + ez,
        minY: y, maxY: y + chairTop, prop: true, kind: 'chair',
        obb: { cx: c.x, cz: c.z, hx: chairHx, hz: chairHz, cs, sn }
      });
    }
  }
  // DEFAULT: swap the accepted Innerscene Adirondack in, in place, for the beach(es) whose procedural style it matches
  // (HTO's rounded fan/vertical slats); Sugar's 3-horizontal-slat Loll chair keeps its procedural geometry. The procedural
  // chair is the synchronous fallback if the GLB fails; a geometry is disposed only after a real success. An explicit
  // override (window.CITY.waterfrontChairTrial = false / ?waterfrontChairTrial=0) keeps the procedural chair for comparison.
  const modelMeshes = chairMeshes.filter((mesh) => CHAIR_MODEL_STYLES.has(mesh.userData.chairStyle));
  if (modelMeshes.length && chairModelEnabled()) {
    loadChairModel(THREE).then((geometry) => {
      if (!geometry) return;
      for (const mesh of modelMeshes) {
        const old = mesh.geometry;
        mesh.geometry = geometry;
        // The InstancedMesh's cached bounds were computed from the smaller procedural geometry; recompute them from the
        // real model and the instance matrices so culling and raycasts use the accepted chair's true extent.
        mesh.computeBoundingBox?.();
        mesh.computeBoundingSphere?.();
        if (proceduralGeos.has(old)) { proceduralGeos.delete(old); old.dispose?.(); }
      }
      stats.chairModel = {
        url: CHAIR_MODEL_URL, geometry,
        triangles: geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3,
        size: { ...CHAIR_MODEL_SIZE }, styles: [...CHAIR_MODEL_STYLES],
        sites: modelMeshes.map((mesh) => mesh.name)
      };
      if (group.userData.waterfrontDetails) group.userData.waterfrontDetails.chairModel = stats.chairModel;
    });
  }
  stats.colliders = colliders.length;
  stats.ms = Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 10) / 10;
  group.userData.waterfrontDetails = stats;
  if (scene && scene.add) scene.add(group);
  const result = { group, colliders, layout, stats, sites: stats.sites };
  window.CITY.waterfrontDetails = result;
  if (layout.sites.length) {
    console.info(`[waterfrontDetails] ${layout.sites.map((s) => `${s.name}: ${s.counts.umbrellas}/${s.published.umbrellas} umbrellas, ${s.counts.chairs}/${s.published.chairs} chairs on sand`).join('; ')}; ` +
      `${stats.meshes} instanced meshes, ${stats.colliders} colliders, ${stats.ms} ms`);
  } else {
    console.info(`[waterfrontDetails] none in this map: ${layout.skipped.map((s) => `${s.id} (${s.reason})`).join('; ') || 'no GEO areas'}`);
  }
  return result;
}

Object.assign(window.CITY, {
  WATERFRONT_SITE_SPECS,
  WATERFRONT_SAND_RINGS: { sugarBeach: SUGAR_SAND_RING, htoPark: HTO_SAND_RING },
  waterfrontLayout,
  waterfrontSiteRing: ringOf,
  createWaterfrontDetails
});
})();
