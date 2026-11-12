(function () {
// js/waterfront-island-arrivals.js
// Toronto Islands arrival experience at the three real island ferry terminals — Ward's Island, Centre Island and
// Hanlan's Point — built from the ACTUAL OpenStreetMap features (fetched by tools/build-island-arrivals.mjs into
// js/waterfront-island-arrivals-data.js), not from probing the water mask:
//
//   * Each ferry terminal's REAL geometry: the Ward's Island Ferry Dock and Centre Island Ferry Terminal are closed
//     `amenity=ferry_terminal` ways (berth polygons); Hanlan's Point is an `amenity=ferry_terminal` node with the
//     adjacent water-taxi quay way. The berth deck is drawn on the mapped footprint (a raised platform ring), and the
//     taxi quay too.
//   * The REAL connecting footways/paths/pedestrian ways/steps and any wood/boardwalk that form each dock's approach,
//     drawn as flush walking surfaces in their mapped surface colour. Boardwalk/timber is used ONLY where the OSM
//     surface really is wood (isWood) — otherwise the footway is drawn in its asphalt/concrete/paving colour. No
//     invented path crosses the water.
//   * A legible arrival NAME for each dock, drawn into one bounded canvas atlas (the route names Ward's Island /
//     Centre Island / Hanlan's Point), with a document-less fallback that draws a plain coloured board if there is no
//     DOM canvas.
//
// The previous draft was rejected because it fabricated straight piers by probing the nearest wet cell and treated the
// geodata's Bike Share docking stations as berths. This version uses sourced terminal footprints and sourced footways;
// where the real berth is a node with no polygon (Hanlan's) it draws a small platform at the mapped node reached by the
// mapped footway, and records that as an estimated platform, not a probed pier.
//
// Sources (fetched 2026-11-09 from https://api.openstreetmap.org/api/0.6, OpenStreetMap contributors, ODbL):
// - Ward's Island Ferry Dock      way 251286976  (amenity=ferry_terminal, building=no, ferry=yes, wheelchair=yes)
// - Centre Island Ferry Terminal  way 1175136270  (amenity=ferry_terminal, 55 Avenue of the Islands)
// - Hanlan's Point Ferry Dock     node 56794382   (amenity=ferry_terminal, public_transport=stop_position)
// - Hanlan's Point Water Taxis    way 1375105747  (man_made=quay, mooring=commercial)
// plus the footway connectors extracted around each dock (see the data file). City of Toronto island visitor guidance:
// https://www.toronto.ca/explore-enjoy/toronto-island-ferries/ and .../getting-around/.
//
// Frame independence: the two city frames (detail, Eglinton) share the same `GEO.frame.projection` (verified) but have
// different building indices; the dock data is stored in world metres (from that shared projection) and keyed by OSM
// id, never by a geodata index, so this module is identical in both frames.
//
// Call createWaterfrontIslandArrivals(THREE, scene); it returns { group, colliders, stats } and only builds when the
// data is present and the active frame covers the docks (supportedCityFrame). The group is one culling root, the dock
// decks/connectors are merged per surface colour, and meshes carry cullDistance/cullCell. islandArrivalSurfaceAt(x, z)
// is gated on the builder having run in a supported frame, and matches the rendered walking surfaces.

const C = window.CITY;
const SETTING = C?.CITY_BOUNDS || {};
const GROUND = 0;
const WATER = SETTING.waterLevel ?? -0.7;

// Ground levels. The generic park lawn is drawn at CITY_BOUNDS.sidewalkHeight + 0.004 (0.224 m; js/city-grid.js), and
// the previous deck top (0.16 m) sat BELOW it, so the lawn simply covered the berth aprons in the GPU captures (Centre
// read as grass, Ward patchy, Hanlan's grass over the platform). The decks now stand just above the lawn — a 6 mm apron
// lip, never a raised slab — and the generic lawn under their exact mapped footprints is masked by
// applyWaterfrontIslandGroundMask(). The paved OSM footways likewise sit above the lawn (2 mm) instead of 4 cm below it.
const SW = () => (C?.CITY_BOUNDS?.sidewalkHeight ?? 0.22);
const LAWN_TOP = () => SW() + 0.004;
const DECK_LIFT = 0.01;       // deck top above the sidewalk datum (0.230 m; 6 mm above the 0.224 m lawn)
const WALK_LIFT = 0.006;      // paved footway strips above the sidewalk datum (0.226 m; 2 mm above the lawn)
const DECK_THICKNESS = 0.12;  // visible apron edge below the deck top (a small lip, never a 1 m slab)

const DECK_TOP = SW() + DECK_LIFT;
const WALK_TOP = SW() + WALK_LIFT;

const ESTIMATES = {
  deckTop: DECK_TOP,            // terminal platform deck top (above the park lawn, not below it)
  nodePlatform: 3.2,            // half-size of the estimated platform at a node-only terminal (Hanlan's), metres
  nodePlatformTop: DECK_TOP,
  nameBoardHeight: 1.7,         // the arrival name board (post + panel)
  nameBoardTop: 2.4,
  nameBoardWidth: 2.0,
  railHeight: 1.0,
  post: 0.16
};

// The three routes (ids align with FERRY_ROUTES where the mainland module is loaded).
const ROUTE_NAMES = { ward: "Ward's Island", centre: 'Centre Island', hanlans: "Hanlan's Point" };
const ROUTE_COLORS = { ward: 0x2f6f4f, centre: 0xb3352f, hanlans: 0x2c5f9e };

// Surface → walking colour. Wood/boardwalk is timber; the mapped footways keep their real surface colour.
function surfaceColor(surface, isWood) {
  if (isWood || surface === 'wood') return 0x9b7b4f;
  switch (surface) {
    case 'asphalt': return 0x5a5d61;
    case 'concrete': return 0x9a968f;
    case 'concrete:plates': return 0x9a968f;
    case 'paving_stones': return 0xa8a094;
    case 'paved': return 0x8f8b83;
    case 'sett': return 0x86827a;
    case 'sand': return 0xd8c69a;
    case 'dirt': return 0x8a7158;
    case 'ground': return 0x7d6b53;
    case 'grass': return 0x5f6f42;
    default: return 0x93908a;
  }
}

// --------------------------------------------------------------------------------------------------------------------
// Data access (frame-independent, keyed by OSM id, stored in world metres).
// --------------------------------------------------------------------------------------------------------------------
function data() {
  return C?.ISLAND_ARRIVALS_DATA || null;
}

function centroid(ring) {
  let x = 0, z = 0;
  for (const p of ring) { x += p[0]; z += p[1]; }
  return ring.length ? [x / ring.length, z / ring.length] : [0, 0];
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a) / 2;
}

// The centroid of the DECK (dry part of the ring), robust to a concave berth polygon whose vertex-centroid falls in a
// water channel. Falls back to the vertex centroid when no dry samples exist.
function deckAnchor(ring, point) {
  if (!ring) return point;
  const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
  let sx = 0, sz = 0, n = 0;
  const hasWater = !!C?.waterAt;
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 1.5) {
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += 1.5) {
      if (!pointInRing(ring, x, z)) continue;
      if (hasWater && C.waterAt(x, z)) continue;
      sx += x; sz += z; n++;
    }
  }
  return n ? [sx / n, sz / n] : centroid(ring);
}

// The resolved layout (for tests and integration): each dock's footprint (ring or point) + route name/colour.
function arrivalLayout() {
  const D = data();
  if (!D) return null;
  const docks = {};
  for (const [id, d] of Object.entries(D.docks)) {
    const ring = d.ring || null;
    const anchor = ring ? deckAnchor(ring, d.point) : d.point;
    const connectors = (D.connectors[id] || []).map((c) => ({
      osmId: c.osmId, isWood: !!c.isWood, surface: c.surface, nearest: c.nearest,
      tags: c.tags, nodes: c.nodes
    }));
    docks[id] = {
      id, osmType: d.osmType, osmId: d.osmId, name: d.name,
      routeName: ROUTE_NAMES[id] || d.name, color: ROUTE_COLORS[id] ?? 0x888888,
      ring, point: d.point || null, quay: d.quay || null,
      centroid: ring ? centroid(ring) : d.point,
      deckAnchor: anchor,
      boardFacing: boardFacing({ deckAnchor: anchor, connectors, osmId: d.osmId }),
      area: ring ? ringArea(ring) : 0,
      connectors
    };
  }
  return { docks, projection: D.projection, source: D.source, estimates: ESTIMATES };
}

// The arrival walking surface: a point on a terminal platform deck (or the node platform) → { h, dockId, routeName }.
// Gated on the builder having run in a supported frame (never returns a surface for an un-built module).
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

function islandArrivalSurfaceAt(x, z) {
  if (!C?.waterfrontIslandArrivalsEnabled) return null;
  const layout = C?.waterfrontIslandArrivals?.layout;
  if (!layout) return null;
  if (outsideBounds(surfaceBounds(layout, (add) => {
    for (const d of Object.values(layout.docks || {})) {
      if (d.ring) for (const [px, pz] of d.ring) add(px, pz);
      else if (d.point) add(d.point[0], d.point[1], ESTIMATES.nodePlatform);
    }
  }), x, z)) return null;
  for (const d of Object.values(layout.docks)) {
    if (d.ring) {
      if (pointInRing(d.ring, x, z)) return { h: ESTIMATES.deckTop, dockId: d.id, routeName: d.routeName };
    } else if (d.point) {
      if (Math.abs(x - d.point[0]) <= ESTIMATES.nodePlatform && Math.abs(z - d.point[1]) <= ESTIMATES.nodePlatform) {
        return { h: ESTIMATES.nodePlatformTop, dockId: d.id, routeName: d.routeName };
      }
    }
  }
  return null;
}

// Generic-building replacement predicate: the terminals themselves are drawn as decks here, so a geodata massing box
// standing on a dock footprint should be suppressed. Only the dock footprints (plus margin), nothing else.
function islandBuildingReplacedAt(x, z, margin = 0) {
  const layout = C?.waterfrontIslandArrivals?.layout || arrivalLayout();
  if (!layout) return false;
  for (const d of Object.values(layout.docks)) {
    if (d.ring && pointInRing(d.ring, x, z)) return true;
    if (d.ring) {
      // margin: within `margin` of the ring (a simple bbox-expanded ring test)
      if (!pointInRing(d.ring, x, z) && nearRing(d.ring, x, z, margin)) return true;
    }
  }
  return false;
}

function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}
function nearRing(ring, x, z, margin) {
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if (distToSegment(x, z, ring[j][0], ring[j][1], ring[i][0], ring[i][1]) <= margin) return true;
  }
  return false;
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
function segIntersectsRing(ring, ax, az, bx, bz) {
  const b = ringBox(ring);
  if (Math.max(ax, bx) < b.minX || Math.min(ax, bx) > b.maxX || Math.max(az, bz) < b.minZ || Math.min(az, bz) > b.maxZ) return false;
  if (pointInRing(ring, ax, az) || pointInRing(ring, bx, bz)) return true;
  const cross = (cx, cz, dx, dz, ex, ez) => (dx - cx) * (ez - cz) - (dz - cz) * (ex - cx);
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cx = ring[j][0], cz = ring[j][1], dx = ring[i][0], dz = ring[i][1];
    const d1 = cross(ax, az, bx, bz, cx, cz), d2 = cross(ax, az, bx, bz, dx, dz);
    const d3 = cross(cx, cz, dx, dz, ax, az), d4 = cross(cx, cz, dx, dz, bx, bz);
    if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return true;
  }
  return false;
}

// The width and selection of a real OSM connector are shared by the renderer and the ground mask, so the masked lawn
// and the drawn footway can never drift apart.
function connectorWidth(c) {
  return c.tags && c.tags.width ? Math.max(1.2, Math.min(12, parseFloat(c.tags.width) || 0)) : (c.isWood ? 2.2 : 2.4);
}
function isRenderedConnector(c, d) {
  return c.osmId !== d.osmId && c.nearest <= 90;
}
// The exact square the estimated platform is drawn on at a node-only terminal (Hanlan's); the mask uses the same square.
function nodePlatformRing(point) {
  const s = ESTIMATES.nodePlatform;
  return [[point[0] - s, point[1] - s], [point[0] + s, point[1] - s], [point[0] + s, point[1] + s], [point[0] - s, point[1] + s]];
}
// Which way a dock's name board should face: toward the nearest real approach node, i.e. the point where the mapped
// walkway meets the deck. The board's front (+Z after the yaw) points this way, so a camera on the walkway reads the
// name, not its mirrored back. The dock's own ring (osmId) is not a walkway and is skipped.
function boardFacing({ deckAnchor: a, connectors = [], osmId = null }) {
  let best = null, bd = Infinity;
  for (const c of connectors) {
    if (c.osmId === osmId || !(c.nearest <= 90) || !Array.isArray(c.nodes)) continue;
    for (const [x, z] of c.nodes) {
      const dx = x - a[0], dz = z - a[1], d = Math.hypot(dx, dz);
      if (d >= 1 && d < bd) { bd = d; best = [dx, dz]; }
    }
  }
  if (!best) return [0, 1];
  return [best[0] / bd, best[1] / bd];
}

// The exact ground this module covers, for the lawn mask and for tests/CPU callers: the mapped terminal rings, the
// estimated Hanlan's platform square, the mapped taxi quay, and only the OSM footways it actually draws. Nothing is
// buffered and no shoreline is blanket-erased; the surrounding grass stays the city's own lawn. Native mapped park
// paths crossing a covered area are returned as exemptions so they are never discarded.
function islandArrivalsGroundLayout({ docks = data()?.docks, connectors = data()?.connectors, frame = C?.GEO?.frame, parkPaths = C?.GEO?.parkPaths } = {}) {
  const areas = [], corridors = [], exemptions = [], skipped = [];
  if (!docks) return { areas, corridors, exemptions, skipped };
  for (const [id, d] of Object.entries(docks)) {
    let area = null;
    if (Array.isArray(d.ring) && d.ring.length >= 3) area = { id, kind: 'deck', plan: d.ring };
    else if (d.point) area = { id, kind: 'platform', estimated: true, plan: nodePlatformRing(d.point) };
    let covered = false;
    if (area) {
      if (frameCovers(frame, ringBox(area.plan))) { areas.push(area); covered = true; }
      else skipped.push({ id, reason: 'deck not in the active GEO frame' });
    }
    if (d.quay && Array.isArray(d.quay.ring) && d.quay.ring.length >= 3) {
      if (frameCovers(frame, ringBox(d.quay.ring))) { areas.push({ id: id + '-taxi-quay', kind: 'quay', plan: d.quay.ring }); covered = true; }
      else skipped.push({ id: id + '-taxi-quay', reason: 'quay not in the active GEO frame' });
    }
    // all of a dock's area and its footways are in or out of a frame together: never mask a path off-frame
    if (!covered) continue;
    for (const c of (connectors && connectors[id]) || d.connectors || []) {
      if (!isRenderedConnector(c, d) || !Array.isArray(c.nodes) || c.nodes.length < 2) continue;
      corridors.push({ dockId: id, osmId: c.osmId, isWood: !!c.isWood, nodes: c.nodes, half: connectorWidth(c) / 2 });
    }
  }
  for (const row of (Array.isArray(parkPaths) ? parkPaths : [])) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const w = row[0], half = (w > 0 ? w : 1.8) / 2;
    for (let i = 2; i + 1 < row.length; i += 2) {
      const ax = row[i - 2], az = row[i - 1], bx = row[i], bz = row[i + 1];
      if (areas.some((a) => segIntersectsRing(a.plan, ax, az, bx, bz))) exemptions.push({ ax, az, bx, bz, half });
    }
  }
  return { areas, corridors, exemptions, skipped };
}

// The ground-mask hook (see applyWaterfrontIslandGroundMask): the exact polygons/corridors the mask discards, plus the
// native path corridors it exempts. Exported for a CPU caller that needs the same footprint.
function islandArrivalGroundExclusionPolygons() {
  const { areas, corridors, exemptions } = islandArrivalsGroundLayout();
  return {
    areas: areas.map((a) => ({ id: a.id, kind: a.kind, estimated: !!a.estimated, plan: a.plan.map((p) => [p[0], p[1]]) })),
    corridors: corridors.map((c) => ({ dockId: c.dockId, osmId: c.osmId, half: c.half, nodes: c.nodes.map((p) => [p[0], p[1]]) })),
    exemptions: exemptions.map((e) => ({ ax: e.ax, az: e.az, bx: e.bx, bz: e.bz, half: e.half }))
  };
}

// --------------------------------------------------------------------------------------------------------------------
// Build helpers
// --------------------------------------------------------------------------------------------------------------------
function standardMaterial(THREE, params) {
  const Mat = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
  return new Mat(params);
}

// A flat triangulated top surface for a polygon ring at height y. Proper ear-clipping (ShapeUtils.triangulateShape)
// rather than a centre fan: Ward's berth is concave, so a fan spilled triangles outside its mapped outline and the
// deck read as a patchy overlap. Triangles are wound to face up; a thin side cap gives the apron its edge.
function flatRingGeometry(THREE, ring, y, capBottom = DECK_THICKNESS) {
  const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
  const faces = THREE.ShapeUtils.triangulateShape(contour, []);
  const verts = [];
  for (const [i, j, k] of faces) {
    const a = ring[i], b = ring[j], c = ring[k];
    // +Y of (b-a)x(c-a): wind the top counter-clockwise seen from above (a downward-wound top is back-face culled)
    const up = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    const order = up >= 0 ? [a, b, c] : [a, c, b];
    verts.push(order[0][0], y, order[0][1], order[1][0], y, order[1][1], order[2][0], y, order[2][1]);
  }
  // side quad (down capBottom) to give the deck its apron edge
  const yb = y - capBottom;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    verts.push(a[0], y, a[1], a[0], yb, a[1], b[0], yb, b[1]);
    verts.push(a[0], y, a[1], b[0], yb, b[1], b[0], y, b[1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.computeVertexNormals();
  return g;
}

// A flat walking strip for a connector polyline: quads along the line, width `w`.
function stripGeometry(THREE, nodes, y, w) {
  const half = w / 2;
  const verts = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const [x0, z0] = nodes[i], [x1, z1] = nodes[i + 1];
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz) || 1e-9;
    const nx = -dz / len * half, nz = dx / len * half;
    // quad corners
    const a = [x0 + nx, z0 + nz], b = [x1 + nx, z1 + nz], c = [x1 - nx, z1 - nz], d = [x0 - nx, z0 - nz];
    verts.push(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1]);
    verts.push(a[0], y, a[1], c[0], y, c[1], d[0], y, d[1]);
    // a joint disc at each vertex closes gaps on tight corners
  }
  if (verts.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.computeVertexNormals();
  return g;
}

// The legible name atlas: one bounded canvas with the three route names drawn once; a MeshBasicMaterial samples it per
// board panel. No DOM canvas → a plain colour board (the caller falls back). Bounded (fixed 1024×128), so it never grows.
let _nameAtlas = null;
function nameAtlasCanvas(names) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const W = 1024, H = 128, cell = W / names.length;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#26343b';
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  names.forEach((nm, i) => {
    const cx = cell * (i + 0.5);
    ctx.font = 'bold 56px system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    // shrink long names to fit the cell width
    let size = 56;
    while (ctx.measureText(nm).width > cell - 24 && size > 22) { size -= 2; ctx.font = `bold ${size}px system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`; }
    ctx.fillText(nm, cx, H / 2);
  });
  return { canvas: c, W, H, cell };
}

// --------------------------------------------------------------------------------------------------------------------
// Ground mask: remove the generic park lawn under the exact terminal footprints and the paved OSM footways, so the
// berth aprons read as deck/paving rather than grass. This mirrors js/waterfront-beach-ground.js (compose into
// maskNode, idempotent, no-op off-frame/non-node). Apply it ONLY to the park lawn material:
//
//   const lawnMat = createParkLawnMaterial(false);
//   window.CITY.applyWaterfrontIslandGroundMask?.(lawnMat);
//
// It is gated on the builder having run in a supported frame (CITY.waterfrontIslandArrivalsEnabled), so it does nothing
// before the island arrivals exist. Native mapped paths crossing a covered area are exempt; nothing outside the real
// OSM polygons and drawn footway widths is erased, so the shoreline grass stays.
function applyWaterfrontIslandGroundMask(mat, THREE = C?.THREE) {
  if (!mat) return mat;
  if (mat.userData && mat.userData.waterfrontIslandMask) return mat;
  if (!C?.waterfrontIslandArrivalsEnabled) return mat;
  const T = C?.TSL;
  if (!T || !mat.isNodeMaterial) return mat;
  const layout = islandArrivalsGroundLayout();
  if (!layout.areas.length && !layout.corridors.length) return mat;
  const { Fn, positionWorld, float } = T;
  try {
    const node = Fn(() => {
      const p = positionWorld.xz;
      // squared distance from the point to a segment (TSL)
      const dist2 = (ax, az, bx, bz) => {
        const dx = bx - ax, dz = bz - az, L2 = float(dx * dx + dz * dz || 1e-9);
        const t = p.x.sub(float(ax)).mul(float(dx)).add(p.y.sub(float(az)).mul(float(dz))).div(L2);
        const tc = T.clamp(t, float(0), float(1));
        const px = float(ax).add(float(dx).mul(tc)), pz = float(az).add(float(dz).mul(tc));
        return p.x.sub(px).mul(p.x.sub(px)).add(p.y.sub(pz).mul(p.y.sub(pz)));
      };
      // inside any exact filled polygon (ray cast east; odd crossings = inside)
      let covered = null;
      for (const a of layout.areas) {
        const ring = a.plan;
        let crossings = float(0);
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const ax = ring[j][0], az = ring[j][1], bx = ring[i][0], bz = ring[i][1];
          if (az === bz) continue;
          const inZ = p.y.greaterThanEqual(float(Math.min(az, bz))).and(p.y.lessThan(float(Math.max(az, bz))));
          const tE = p.y.sub(float(az)).div(float(bz - az));
          const xInt = float(ax).add(float(bx - ax).mul(tE));
          crossings = crossings.add(T.select(inZ.and(p.x.lessThan(xInt)), float(1), float(0)));
        }
        const odd = crossings.mod(2).greaterThan(0.5);
        covered = covered ? covered.or(odd) : odd;
      }
      // or within a drawn OSM footway corridor (the exact width the renderer uses)
      for (const c of layout.corridors) {
        let on = null;
        for (let i = 0; i + 1 < c.nodes.length; i++) {
          const [ax, az] = c.nodes[i], [bx, bz] = c.nodes[i + 1];
          const hit = dist2(ax, az, bx, bz).lessThan(float(c.half * c.half));
          on = on ? on.or(hit) : hit;
        }
        if (on) covered = covered ? covered.or(on) : on;
      }
      if (!covered) covered = float(0).greaterThan(float(1));
      // exempt native mapped park paths crossing a covered area (they are a separate material too, but never erase them)
      let exempt = null;
      for (const s of layout.exemptions) {
        const hit = dist2(s.ax, s.az, s.bx, s.bz).lessThan(float((s.half + 0.05) * (s.half + 0.05)));
        exempt = exempt ? exempt.or(hit) : hit;
      }
      return exempt ? covered.and(exempt.not()) : covered;
    })();
    mat.maskNode = mat.maskNode ? mat.maskNode.and(node.not()) : node.not();
    if (!mat.userData) mat.userData = {};
    mat.userData.waterfrontIslandMask = true;
  } catch (err) {
    console.warn('[waterfrontIslandArrivals] ground mask not applied:', err && err.message);
  }
  return mat;
}

// --------------------------------------------------------------------------------------------------------------------
// Build
// --------------------------------------------------------------------------------------------------------------------
function supportedCityFrame() {
  const G = C?.GEO;
  const D = data();
  if (!G || !G.frame || !G.frame.detail || !C?.CITY_BOUNDS || !D) return false;
  const d = G.frame.detail;
  for (const dock of Object.values(D.docks)) {
    const pts = dock.ring || (dock.point ? [dock.point] : []);
    for (const [x, z] of pts) {
      if (!(x > d.x0 && x < d.x1 && z > d.z0 && z < d.z1)) return false;
    }
  }
  return true;
}

function createWaterfrontIslandArrivals(THREE = C?.THREE, scene = null) {
  if (!THREE) throw new Error('waterfront-island-arrivals: THREE is required');
  if (!supportedCityFrame()) {
    if (C) C.waterfrontIslandArrivalsEnabled = false;
    console.info('[waterfrontIslandArrivals] skipped: island arrival data missing or the active frame does not cover the docks');
    return null;
  }
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const group = new THREE.Group();
  group.name = 'WaterfrontIslandArrivals';
  const layout = arrivalLayout();

  const meshes = [];
  const add = (mesh, role) => { if (mesh) { mesh.userData.role = role; meshes.push(mesh); group.add(mesh); } };

  // Deck material per colour, merged: a single mesh per surface colour.
  const deckMat = standardMaterial(THREE, { color: 0xffffff, roughness: 0.92, metalness: 0.0 });
  const walkMat = standardMaterial(THREE, { color: 0xffffff, roughness: 0.95, metalness: 0.0 });
  const railMat = standardMaterial(THREE, { color: 0xffffff, roughness: 0.5, metalness: 0.6 });

  const dockGroups = new THREE.Group(); dockGroups.name = 'IslandArrivals-Decks';
  const walkGroups = new THREE.Group(); walkGroups.name = 'IslandArrivals-Walks';
  let piers = 0, connectorsRendered = 0, woodConnectors = 0;

  // one material per distinct colour so the merge stays tidy
  const deckMats = new Map(), walkMats = new Map();
  const getMat = (map, color, base) => {
    if (!map.has(color)) { const m = base.clone(); m.color.setHex(color); map.set(color, m); }
    return map.get(color);
  };

  for (const d of Object.values(layout.docks)) {
    // Terminal platform: the mapped berth polygon, or an estimated platform at a node-only terminal.
    if (d.ring) {
      const g = flatRingGeometry(THREE, d.ring, ESTIMATES.deckTop, DECK_THICKNESS);
      const mesh = new THREE.Mesh(g, getMat(deckMats, 0x8f9094, deckMat));
      mesh.userData.role = 'dock-deck'; mesh.userData.dockId = d.id;
      mesh.userData.cullDistance = 1200; mesh.userData.cullCell = 200;
      dockGroups.add(mesh);
      piers++;
    } else if (d.point) {
      const s = ESTIMATES.nodePlatform;
      // the same 12 cm apron as the berth rings: the top is above the lawn, the bottom is at ground + 0.11 m (no slab)
      const g = new THREE.BoxGeometry(s * 2, DECK_THICKNESS, s * 2);
      const mesh = new THREE.Mesh(g, getMat(deckMats, 0x8f9094, deckMat));
      mesh.position.set(d.point[0], ESTIMATES.nodePlatformTop - DECK_THICKNESS / 2, d.point[1]);
      mesh.userData.role = 'dock-deck'; mesh.userData.dockId = d.id; mesh.userData.estimated = true;
      mesh.userData.cullDistance = 1200; mesh.userData.cullCell = 200;
      dockGroups.add(mesh);
      piers++;
    }
    // the water-taxi quay at Hanlan's, if mapped
    if (d.quay && d.quay.ring) {
      const g = flatRingGeometry(THREE, d.quay.ring, ESTIMATES.deckTop, DECK_THICKNESS);
      const mesh = new THREE.Mesh(g, getMat(deckMats, 0x8f9094, deckMat));
      mesh.userData.role = 'taxi-quay'; mesh.userData.cullDistance = 1200; mesh.userData.cullCell = 200;
      dockGroups.add(mesh);
    }

    // the real connecting footways/piers/wood, drawn in their mapped surface colour (timber only where isWood).
    // Paved strips now sit just above the lawn (0.226 m) instead of 4 cm below it, and the lawn under their mapped
    // width is masked, so the approach reads as paving.
    for (const c of d.connectors) {
      if (!isRenderedConnector(c, d)) continue; // skip the dock itself and distant trails
      const w = connectorWidth(c);
      const y = (c.isWood ? ESTIMATES.deckTop : WALK_TOP);
      const g = stripGeometry(THREE, c.nodes, y, w);
      if (!g) continue;
      const color = surfaceColor(c.surface, c.isWood);
      const mesh = new THREE.Mesh(g, getMat(walkMats, color, walkMat));
      mesh.userData.role = c.isWood ? 'boardwalk' : 'footway';
      mesh.userData.osmId = c.osmId; mesh.userData.dockId = d.id;
      mesh.userData.cullDistance = 1200; mesh.userData.cullCell = 200;
      walkGroups.add(mesh);
      connectorsRendered++;
      if (c.isWood) woodConnectors++;
    }
  }
  add(dockGroups, 'dock-decks');
  add(walkGroups, 'dock-walks');

  // Arrival name boards: a post + a panel whose front face samples the name atlas at this route's cell. Each board gets
  // its OWN copied geometry: the previous draft shifted one shared UV set inside the loop, so every board after the
  // first sampled a wrong (cumulatively shifted) atlas cell and the names were garbled. The board is turned to face
  // inland, along the arrival footways, so the walker's front camera reads it rather than its mirrored back.
  const names = Object.values(ROUTE_NAMES);
  const atlas = nameAtlasCanvas(names);
  if (atlas) {
    const tex = new THREE.CanvasTexture(atlas.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const boardPrototype = new THREE.PlaneGeometry(ESTIMATES.nameBoardWidth, ESTIMATES.nameBoardHeight * 0.7);
    const boardMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    const boardGroup = new THREE.Group(); boardGroup.name = 'IslandArrivals-NameBoards';
    const postGeo = new THREE.CylinderGeometry(ESTIMATES.post / 2, ESTIMATES.post / 2, ESTIMATES.nameBoardTop, 8);
    const postMat = standardMaterial(THREE, { color: 0x4a4f54, roughness: 0.5, metalness: 0.6 });
    for (const d of Object.values(layout.docks)) {
      const [bx, bz] = d.deckAnchor;
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(bx, ESTIMATES.deckTop + ESTIMATES.nameBoardTop / 2, bz);
      const boardGeo = boardPrototype.clone();
      const board = new THREE.Mesh(boardGeo, boardMat);
      board.position.set(bx, ESTIMATES.deckTop + ESTIMATES.nameBoardTop - ESTIMATES.nameBoardHeight * 0.35, bz);
      // sample this route's cell from the ORIGINAL uvs, once, on this board's own geometry
      const cell = Math.max(0, names.indexOf(d.routeName)), u0 = cell / names.length, du = 1 / names.length;
      const uv = boardGeo.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setX(k, u0 + uv.getX(k) * du);
      uv.needsUpdate = true;
      const f = d.boardFacing || [0, 1];
      board.rotation.y = Math.atan2(f[0], f[1]);
      // Mount the opaque name panel in front of its post, not through the lettering.
      board.position.x += f[0] * (ESTIMATES.post / 2 + 0.025);
      board.position.z += f[1] * (ESTIMATES.post / 2 + 0.025);
      board.userData.atlasCell = cell;
      post.userData.role = 'name-post'; board.userData.role = 'name-board'; board.userData.dockId = d.id;
      [post, board].forEach((m) => { m.userData.cullDistance = 900; m.userData.cullCell = 160; });
      boardGroup.add(post); boardGroup.add(board);
    }
    add(boardGroup, 'name-boards');
  } else {
    // document-less fallback: plain coloured panels (no text), one per dock, so the arrival still reads as marked.
    const boardGroup = new THREE.Group(); boardGroup.name = 'IslandArrivals-NameBoards';
    for (const d of Object.values(layout.docks)) {
      const [bx, bz] = d.deckAnchor;
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(ESTIMATES.nameBoardWidth, ESTIMATES.nameBoardHeight * 0.7, 0.08),
        standardMaterial(THREE, { color: d.color, roughness: 0.8, metalness: 0.1 })
      );
      panel.position.set(bx, ESTIMATES.deckTop + ESTIMATES.nameBoardTop - ESTIMATES.nameBoardHeight * 0.35, bz);
      const f = d.boardFacing || [0, 1];
      panel.rotation.y = Math.atan2(f[0], f[1]);
      panel.userData.role = 'name-board'; panel.userData.dockId = d.id; panel.userData.fallback = true;
      boardGroup.add(panel);
    }
    add(boardGroup, 'name-boards');
  }

  // Bounded colliders: the name-post positions only (the decks and footways are walking surfaces).
  const colliders = [];
  for (const d of Object.values(layout.docks)) {
    const [bx, bz] = d.deckAnchor;
    colliders.push({
      minX: bx - 0.1, maxX: bx + 0.1, minZ: bz - 0.1, maxZ: bz + 0.1,
      minY: ESTIMATES.deckTop, maxY: ESTIMATES.deckTop + ESTIMATES.nameBoardTop, prop: true, kind: 'namepost',
      obb: { cx: bx, cz: bz, hx: 0.1, hz: 0.1, cs: 1, sn: 0 }
    });
  }

  let triangles = 0;
  for (const mesh of meshes) {
    mesh.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const g = o.geometry;
      const count = o.isInstancedMesh ? o.count : 1;
      triangles += ((g.index ? g.index.count : g.attributes.position.count) / 3) * count;
    });
  }

  const groundLayout = islandArrivalsGroundLayout();
  const stats = {
    layout,
    docks: Object.keys(layout.docks).length,
    piers, connectorsRendered, woodConnectors,
    nameAtlas: !!atlas, nameBoards: Object.keys(layout.docks).length,
    meshes: meshes.length, triangles: Math.round(triangles), colliders: colliders.length,
    deckTop: ESTIMATES.deckTop, lawnTop: LAWN_TOP(), walkTop: WALK_TOP,
    groundAreas: groundLayout.areas.length, groundCorridors: groundLayout.corridors.length,
    routes: Object.values(layout.docks).map((d) => d.routeName),
    ms: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 10) / 10
  };
  group.userData.waterfrontIslandArrivals = stats;
  if (scene && scene.add) scene.add(group);
  const result = {
    group, root: group, colliders, stats, layout, groundLayout,
    islandArrivalSurfaceAt,
    islandBuildingReplacedAt,
    applyWaterfrontIslandGroundMask
  };
  if (C) { C.waterfrontIslandArrivals = result; C.waterfrontIslandArrivalsEnabled = true; }
  console.info(`[waterfrontIslandArrivals] ${piers} terminal decks (${stats.routes.join(', ')}), ` +
    `${connectorsRendered} real connector footways (${woodConnectors} wood), name atlas ${atlas ? 'on' : 'fallback'}, ` +
    `${stats.triangles} triangles, ${stats.ms} ms`);
  return result;
}

Object.assign(C || (window.CITY = {}), {
  ISLAND_ARRIVAL_ESTIMATES: ESTIMATES,
  islandArrivalsLayout: arrivalLayout,
  islandArrivalsGroundLayout,
  islandArrivalGroundExclusionPolygons,
  islandArrivalSurfaceAt,
  islandBuildingReplacedAt,
  applyWaterfrontIslandGroundMask,
  supportedIslandArrivalsCityFrame: supportedCityFrame,
  createWaterfrontIslandArrivals,
  buildWaterfrontIslandArrivals: createWaterfrontIslandArrivals
});
})();