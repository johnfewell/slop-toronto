(function () {
// js/waterfront-island-access.js
// The ferry-terminal -> beach access and mapped amenity identity for the Toronto Islands (st-sb3r.9). The arrival layer
// (js/waterfront-island-arrivals.js) already draws the three REAL terminals and their immediate footways. This module
// adds the next, sourced link: the REAL OpenStreetMap beach polygons, the short REAL access spurs where a mapped path
// reaches the sand, the shortest mapped dock -> beach walking route (topology only, never a long duplicated path
// overlay), and the exact mapped amenity clusters at the beaches and terminals.
//
//   * Beaches (exact OSM geometry, fetched by tools/build-island-access.mjs into js/waterfront-island-access-data.js):
//       Manitou Beach (relation 1463388), Ward's Island Beach (relation 1463389),
//       Hanlan's Point Beach (relation 16086110), Gibraltar Point Beach (way 104254897).
//     Sand is drawn on the mapped ring only; the generic island lawn under it is masked (applyWaterfrontIslandAccess-
//     GroundMask). Nothing is invented beyond the shoreline.
//   * Access spurs: only the REAL, short pieces of a mapped footway/path/service way that come within 15 m of a beach
//     ring, drawn in their mapped surface colour. Timber is used only where OSM really says surface=wood. The mapped
//     dock -> beach route is computed from the walkable graph; its full-resolution edges are compared with the native
//     GEO.roads / GEO.parkPaths and the arrival layer's connectors at BUILD TIME, and only the genuinely uncovered
//     pieces are drawn, so the visual walk exists without duplicating the whole network.
//   * Amenities at exact mapped positions: benches, picnic tables/sites, drinking water, BBQs (instanced), and the
//     toilets / shower-change buildings / shelters / information boards as legible OPAQUE text panels on posts. A
//     building already drawn by the committed geodata is preserved (identity only, no duplicate massing); a real
//     mapped beach building missing from the geodata (Hanlan's Pavilion washrooms/showers) is added from its OSM ring.
//
// Sources: OpenStreetMap contributors, ODbL (beach relations/way, amenity nodes/ways, path graph; fetched 2026-11-10).
// City of Toronto island guidance: https://www.toronto.ca/explore-enjoy/toronto-island-ferries/getting-around/ and the
// beach pages. Frame rule: detail and Eglinton share one projection; the data is world metres with no geodata indices.
//
// Call createWaterfrontIslandAccess(THREE, scene) -> { group, colliders, stats, layout }. It builds only when the data
// is present and the active frame covers every beach. islandBeachSurfaceAt(x, z) returns the sand walking height on a
// built beach, gated on the builder having run.

const C = window.CITY;
const SW = () => (C?.CITY_BOUNDS?.sidewalkHeight ?? 0.22);
const LAWN_TOP = () => SW() + 0.004;
const SAND_Y = () => SW() + 0.004;       // walking level on the sand (the lawn's own level, as the mainland beaches use)
const SAND_MESH_LIFT = 0.003;            // the sand mesh sits 3 mm above the lawn it masks
const WALK_TOP = () => SW() + 0.006;     // paved access spurs sit just above the lawn

const ESTIMATES = {
  sandY: SAND_Y(),
  sandMeshY: SAND_Y() + SAND_MESH_LIFT,
  walkTop: WALK_TOP(),
  post: 0.12,
  panelWidth: 1.9,
  panelHeight: 0.72,
  panelTop: 2.05,
  benchWidth: 1.8,
  benchDepth: 0.46,
  picnicTop: 0.75,
  fountainTop: 1.0,
  buildingHeight: 3.2
};

const SPUR_LIFT = 0.004;

// --------------------------------------------------------------------------------------------------------------------
// Data + small geometry helpers (kept local: this module owns its exports and does not reach into the arrival module).
// --------------------------------------------------------------------------------------------------------------------
function data() { return C?.ISLAND_ACCESS_DATA || null; }

function ringBox(ring) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
  return { minX, maxX, minZ, maxZ };
}
function frameCovers(frame, box) {
  if (!frame) return false;
  const f = frame.detail || frame;
  return box.minX >= f.x0 && box.maxX <= f.x1 && box.minZ >= f.z0 && box.maxZ <= f.z1;
}
function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function distSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}
function nearestOnRing(ring, x, z) {
  let best = [x, z], bd = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0], az = ring[j][1], bx = ring[i][0], bz = ring[i][1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
    let t = ((x - ax) * dx + (z - az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < bd) { bd = d; best = [px, pz]; }
  }
  return best;
}
function segIntersectsRing(ring, ax, az, bx, bz) {
  const b = ringBox(ring);
  if (Math.max(ax, bx) < b.minX || Math.min(ax, bx) > b.maxX || Math.max(az, bz) < b.minZ || Math.min(az, bz) > b.maxZ) return false;
  if (pointInRing(ring, ax, az) || pointInRing(ring, bx, bz)) return true;
  const cross = (cx, cz, dx, dz, ex, ez) => (dx - cx) * (ez - cz) - (dz - cz) * (ex - cx);
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cx = ring[j][0], cz = ring[j][1], dx = ring[i][0], dz = ring[i][1];
    if (((cross(ax, az, bx, bz, cx, cz) > 0) !== (cross(ax, az, bx, bz, dx, dz) > 0))
      && ((cross(cx, cz, dx, dz, ax, az) > 0) !== (cross(cx, cz, dx, dz, bx, bz) > 0))) return true;
  }
  return false;
}

// Surface -> colour. Wood only where OSM actually says wood; sand trails keep sand.
function surfaceColor(surface, isWood) {
  if (isWood || surface === 'wood') return 0x9b7b4f;
  switch (surface) {
    case 'asphalt': return 0x5a5d61;
    case 'concrete': return 0x9a968f;
    case 'paving_stones': return 0xa8a094;
    case 'paved': return 0x8f8b83;
    case 'ground': return 0x7d6b53;
    case 'grass': return 0x5f6f42;
    case 'dirt': return 0x8a7158;
    case 'sand': return 0xd8c69a;
    default: return 0x93908a;
  }
}

function spurWidth(s) {
  if (s.tags && s.tags.width) return Math.max(1.2, Math.min(8, parseFloat(s.tags.width) || 0));
  if (s.surface === 'sand') return 2.0;
  if (s.highway === 'service') return 3.4;
  return s.isWood ? 2.2 : 2.4;
}
function spurY(s) {
  return s.surface === 'sand' ? SAND_MESH_LIFT + SAND_Y() : WALK_TOP() + SPUR_LIFT;
}

// --------------------------------------------------------------------------------------------------------------------
// Layout: exact beach rings, the mapped spur pieces, routes and amenities, filtered to the active frame.
// --------------------------------------------------------------------------------------------------------------------
function islandAccessLayout({ D = data(), frame = C?.GEO?.frame } = {}) {
  if (!D) return null;
  const beaches = {};
  const skipped = [];
  for (const [id, b] of Object.entries(D.beaches)) {
    const rings = (b.rings || []).map((r) => r.map((p) => [p[0], p[1]]));
    const box = rings.length ? rings.map(ringBox).reduce((a, c) => ({ minX: Math.min(a.minX, c.minX), maxX: Math.max(a.maxX, c.maxX), minZ: Math.min(a.minZ, c.minZ), maxZ: Math.max(a.maxZ, c.maxZ) })) : null;
    if (!box) { skipped.push({ id, reason: 'no ring' }); continue; }
    if (!frameCovers(frame, box)) { skipped.push({ id, reason: 'beach not in the active GEO frame' }); continue; }
    beaches[id] = {
      id, name: b.name, osmType: b.osmType, osmId: b.osmId, surface: b.surface, areaM2: b.areaM2,
      rings, box,
      access: (D.access?.[id]?.spurs || []).map((s) => ({ ...s, width: spurWidth(s), y: spurY(s) })),
      accessPoint: D.access?.[id]?.point || null,
      bestWay: D.access?.[id]?.bestWay || null
    };
  }
  return {
    beaches, skipped,
    docks: D.docks || {},
    routes: D.routes || {},
    routeSummary: D.routeSummary || {},
    amenities: (D.amenities || []).filter((a) => {
      if (!frameCovers(frame, { minX: a.point[0], maxX: a.point[0], minZ: a.point[1], maxZ: a.point[1] })) return false;
      if (!a.ring) return true;
      return frameCovers(frame, ringBox(a.ring));
    }),
    estimates: ESTIMATES, source: D.source, projection: D.projection
  };
}

function islandAccessGroundLayout({ D = data(), frame = C?.GEO?.frame, parkPaths = C?.GEO?.parkPaths } = {}) {
  const areas = [], exemptions = [], skipped = [];
  if (!D) return { areas, exemptions, skipped };
  for (const [id, b] of Object.entries(D.beaches)) {
    for (let r = 0; r < (b.rings || []).length; r++) {
      const ring = b.rings[r];
      if (!ring || ring.length < 3) continue;
      if (!frameCovers(frame, ringBox(ring))) { skipped.push({ id, reason: 'beach not in frame' }); continue; }
      areas.push({ id: r ? `${id}-${r}` : id, kind: 'beach', plan: ring.map((p) => [p[0], p[1]]) });
    }
  }
  // Never discard a native mapped path that crosses a beach ring.
  for (const row of (Array.isArray(parkPaths) ? parkPaths : [])) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const half = (row[0] > 0 ? row[0] : 1.8) / 2;
    for (let i = 3; i + 1 < row.length; i += 2) {
      const ax = row[i - 2], az = row[i - 1], bx = row[i], bz = row[i + 1];
      if (areas.some((a) => segIntersectsRing(a.plan, ax, az, bx, bz))) exemptions.push({ ax, az, bx, bz, half });
    }
  }
  return { areas, exemptions, skipped };
}

function islandAccessGroundExclusionPolygons() {
  const { areas, exemptions } = islandAccessGroundLayout();
  return {
    areas: areas.map((a) => ({ id: a.id, kind: a.kind, plan: a.plan.map((p) => [p[0], p[1]]) })),
    exemptions: exemptions.map((e) => ({ ...e }))
  };
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

function islandBeachSurfaceAt(x, z) {
  if (!C?.waterfrontIslandAccessEnabled) return null;
  const layout = C?.waterfrontIslandAccess?.layout;
  if (!layout) return null;
  if (outsideBounds(beachBounds(layout), x, z)) return null;
  for (const b of Object.values(layout.beaches)) {
    const box = b.box;
    if (x < box.minX || x > box.maxX || z < box.minZ || z > box.maxZ) continue;
    for (const ring of b.rings) if (pointInRing(ring, x, z)) return { h: ESTIMATES.sandMeshY, beachId: b.id, name: b.name };
  }
  return null;
}

// Exact rendered footprint sampler for pedestrian footing: the sand, the short access spurs and the drawn route-gap
// pieces, each at the same height the mesh is drawn. Gated on the builder. `pedestrianOnly` says the caller must route
// this through person/walker grounding, never vehicles (the beach and the walked links are not roads).
// (each corridor's own box, once per corridor list: the islands' shared box is large, so a point inside it still skips
// the corridors it is not near)
const CORRIDOR_BOXES = new WeakMap();
function corridorBoxes(corridors) {
  let boxes = CORRIDOR_BOXES.get(corridors);
  if (!boxes) {
    boxes = corridors.map((c) => {
      const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }, w = c.half + 0.15;
      for (const [nx, nz] of c.nodes) {
        b.minX = Math.min(b.minX, nx - w); b.maxX = Math.max(b.maxX, nx + w); b.minZ = Math.min(b.minZ, nz - w); b.maxZ = Math.max(b.maxZ, nz + w);
      }
      return b;
    });
    CORRIDOR_BOXES.set(corridors, boxes);
  }
  return boxes;
}
const beachBounds = (layout) => surfaceBounds(layout, (add) => {
  for (const b of Object.values(layout.beaches || {})) if (b.box) { add(b.box.minX, b.box.minZ); add(b.box.maxX, b.box.maxZ); }
});
function islandAccessSurfaceAt(x, z) {
  if (!C?.waterfrontIslandAccessEnabled) return null;
  const r = C?.waterfrontIslandAccess;
  if (!r) return null;
  if (outsideBounds(surfaceBounds(r, (add) => {
    for (const c of r.surfaces?.corridors || []) for (const [nx, nz] of c.nodes) add(nx, nz, c.half + 0.15);
    if (r.layout) { const b = beachBounds(r.layout); if (b.minX <= b.maxX) { add(b.minX, b.minZ); add(b.maxX, b.maxZ); } }
  }), x, z)) return null;
  // A drawn access spur / route-gap strip sits above the sand, so test the corridors first (topmost rendered piece).
  const corridors = r.surfaces?.corridors || [];
  const boxes = corridorBoxes(corridors);
  for (let ci = 0; ci < corridors.length; ci++) {
    const c = corridors[ci];
    if (outsideBounds(boxes[ci], x, z)) continue;
    for (let i = 0; i + 1 < c.nodes.length; i++) {
      const [ax, az] = c.nodes[i], [bx, bz] = c.nodes[i + 1];
      if (distSeg(x, z, ax, az, bx, bz) <= c.half + 0.15) {
        return { h: c.y, kind: c.kind, beachId: c.beachId ?? null, dockId: c.dockId ?? null, pedestrianOnly: true, source: 'osm' };
      }
    }
  }
  const beach = islandBeachSurfaceAt(x, z);
  if (beach) return { ...beach, kind: 'beach', pedestrianOnly: true, source: 'osm' };
  return null;
}

// The shortest mapped dock -> beach route recorded in the data (topology/evidence; no long overlay is drawn).

function islandAccessRoute(dockId) {
  return data()?.routes?.[dockId] || null;
}

// --------------------------------------------------------------------------------------------------------------------
// Ground mask: discard the generic island lawn under the exact beach rings (the sand mesh replaces it). The mask is a
// BOUNDED 1-byte DataTexture over the beaches' shared box (about 1.8 m per texel), not a shader unrolled from hundreds
// of ring edges, so the fragment cost stays flat. The visible sand boundary is the exact source mesh; the texture only
// hides the lawn beneath it. Native mapped park paths that cross a ring are cleared back into the mask. It is NOT gated
// on the builder: city-grid.js builds the lawn BEFORE this module, so the mask must be composable from the pure data +
// frame alone. It stays a no-op off the supported city frame and on non-node materials. Apply it ONLY to the park lawn
// material (the same `createParkLawnMaterial(false)` the arrival/beach-ground masks use; park-woods tints that material's
// colour, it does not replace it):
//   const lawnMat = createParkLawnMaterial(false);
//   window.CITY.applyWaterfrontIslandAccessGroundMask?.(lawnMat);
// --------------------------------------------------------------------------------------------------------------------
let _maskCache = null;
let _surfaceCorridors = null;
function islandAccessMaskTexture(THREE) {
  const D = data();
  if (!D || !THREE) return null;
  if (_maskCache && _maskCache.D === D && _maskCache.GEO === C?.GEO) return _maskCache;
  const all = [];
  for (const b of Object.values(D.beaches)) for (const ring of b.rings || []) all.push(...ring);
  if (!all.length) return null;
  const MARGIN = 8;
  const minX = Math.min(...all.map((p) => p[0])) - MARGIN, maxX = Math.max(...all.map((p) => p[0])) + MARGIN;
  const minZ = Math.min(...all.map((p) => p[1])) - MARGIN, maxZ = Math.max(...all.map((p) => p[1])) + MARGIN;
  const rangeX = Math.max(1, maxX - minX), rangeZ = Math.max(1, maxZ - minZ);
  const scale = Math.max(1.6, Math.max(rangeX, rangeZ) / 2048);
  const w = Math.max(2, Math.min(2048, Math.ceil(rangeX / scale)));
  const h = Math.max(2, Math.min(2048, Math.ceil(rangeZ / scale)));
  const sx = rangeX / w, sz = rangeZ / h;
  const mask = new Uint8Array(w * h);
  // rasterize each exact beach ring (scanline fill in world metres -> texel centres)
  for (const b of Object.values(D.beaches)) for (const ring of b.rings || []) {
    for (let py = 0; py < h; py++) {
      const z = minZ + (py + 0.5) * sz;
      const xs = [];
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const ax = ring[j][0], az = ring[j][1], bx = ring[i][0], bz = ring[i][1];
        if ((az > z) !== (bz > z)) xs.push(ax + ((z - az) / (bz - az)) * (bx - ax));
      }
      if (xs.length < 2) continue;
      xs.sort((a, c) => a - c);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const x0 = Math.max(0, Math.ceil((xs[k] - minX) / sx - 0.5));
        const x1 = Math.min(w - 1, Math.floor((xs[k + 1] - minX) / sx - 0.5));
        for (let px = x0; px <= x1; px++) mask[py * w + px] = 255;
      }
    }
  }
  // keep native mapped paths that cross a beach: clear their corridor back into the lawn mask
  const paths = C?.GEO?.parkPaths || [];
  for (const row of paths) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const half = ((row[0] > 0 ? row[0] : 1.8) / 2) + 0.1;
    const rad = Math.max(1, Math.ceil(half / Math.min(sx, sz)));
    for (let i = 3; i + 1 < row.length; i += 2) {
      const ax = row[i - 2], az = row[i - 1], bx = row[i], bz = row[i + 1];
      if (Math.max(ax, bx) < minX || Math.min(ax, bx) > maxX || Math.max(az, bz) < minZ || Math.min(az, bz) > maxZ) continue;
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / Math.min(sx, sz)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps, cx = Math.round((ax + (bx - ax) * t - minX) / sx - 0.5), cz = Math.round((az + (bz - az) * t - minZ) / sz - 0.5);
        for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
          if (dx * dx + dz * dz > rad * rad) continue;
          const px = cx + dx, py = cz + dz;
          if (px >= 0 && px < w && py >= 0 && py < h) mask[py * w + px] = 0;
        }
      }
    }
  }
  const tex = new THREE.DataTexture(mask, w, h, THREE.RedFormat, THREE.UnsignedByteType);
  tex.flipY = false;
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  _maskCache = { D, GEO: C?.GEO, tex, minX, minZ, rangeX, rangeZ, w, h, scale };
  return _maskCache;
}

function applyWaterfrontIslandAccessGroundMask(mat, THREE = C?.THREE) {
  if (!mat) return mat;
  if (mat.userData && mat.userData.waterfrontIslandAccessMask) return mat;
  // Pure lifecycle gate: the frame + data, NOT the builder (city-grid builds the lawn first).
  if (!supportedCityFrame()) return mat;
  const T = C?.TSL;
  if (!T || !mat.isNodeMaterial) return mat;
  const m = islandAccessMaskTexture(THREE);
  if (!m) return mat;
  try {
    const node = T.Fn(() => {
      const u = T.positionWorld.x.sub(T.float(m.minX)).div(T.float(m.rangeX));
      const v = T.positionWorld.z.sub(T.float(m.minZ)).div(T.float(m.rangeZ));
      const sampled = T.texture(m.tex, T.vec2(u, v)).r;
      return sampled.greaterThan(T.float(0.5));
    })();
    mat.maskNode = mat.maskNode ? mat.maskNode.and(node.not()) : node.not();
    if (!mat.userData) mat.userData = {};
    mat.userData.waterfrontIslandAccessMask = true;
  } catch (err) {
    console.warn('[waterfrontIslandAccess] ground mask not applied:', err && err.message);
  }
  return mat;
}

// --------------------------------------------------------------------------------------------------------------------
// Build helpers
// --------------------------------------------------------------------------------------------------------------------
function standardMaterial(THREE, params) {
  const Mat = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
  return new Mat(params);
}
function flatRingGeometry(THREE, ring, y) {
  const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
  const faces = THREE.ShapeUtils.triangulateShape(contour, []);
  const pos = [], nor = [];
  for (const [i, j, k] of faces) {
    const a = ring[i], b = ring[j], c = ring[k];
    const up = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    const o = up >= 0 ? [a, b, c] : [a, c, b];
    for (const p of o) { pos.push(p[0], y, p[1]); nor.push(0, 1, 0); }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.computeBoundingSphere();
  return g;
}
function appendStrip(pos, nor, nodes, y, w) {
  const half = w / 2;
  for (let i = 0; i + 1 < nodes.length; i++) {
    const [x0, z0] = nodes[i], [x1, z1] = nodes[i + 1];
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz) || 1e-9;
    const nx = (-dz / len) * half, nz = (dx / len) * half;
    const a = [x0 + nx, z0 + nz], b = [x1 + nx, z1 + nz], c = [x1 - nx, z1 - nz], d = [x0 - nx, z0 - nz];
    for (const p of [a, b, c, a, c, d]) { pos.push(p[0], y, p[1]); nor.push(0, 1, 0); }
  }
}
function boxGeometry(THREE, w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}
function mergeGeoms(THREE, geoms) {
  const pos = [], nor = [];
  for (const g0 of geoms) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const p = g.attributes.position.array, n = g.attributes.normal ? g.attributes.normal.array : null;
    for (let i = 0; i < p.length; i += 3) { pos.push(p[i], p[i + 1], p[i + 2]); nor.push(n ? n[i] : 0, n ? n[i + 1] : 1, n ? n[i + 2] : 0); }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}

// A bounded label atlas (1024x1024, 4 columns) so every sign is legible and the texture count stays one.
function buildLabelAtlas(THREE, labels) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const cols = 4, cellW = 256, cellH = 128;
  const rows = Math.max(1, Math.ceil(labels.length / cols));
  if (rows * cellH > 2048) return null;
  const W = cols * cellW, H = rows * cellH;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const font = (px) => `bold ${px}px system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  ctx.fillStyle = '#20323b'; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  labels.forEach((label, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const cx = col * cellW + cellW / 2, cy = row * cellH + cellH / 2;
    const maxW = cellW - 22;
    let size = 30, lines = [];
    // greedy word wrap at the current size, then shrink until the widest line fits
    for (let guard = 0; guard < 20; guard++) {
      ctx.font = font(size);
      lines = [];
      let line = '';
      for (const word of String(label).split(/\s+/)) {
        const test = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(test).width > maxW) { lines.push(line); line = word; }
        else line = test;
      }
      if (line) lines.push(line);
      if (lines.length <= 3 && lines.every((l) => ctx.measureText(l).width <= maxW)) break;
      size -= 1;
      if (size <= 14) { size = 14; ctx.font = font(size); break; }
    }
    ctx.font = font(size);
    ctx.fillStyle = '#ffffff';
    const lh = size * 1.15;
    lines.forEach((l, k) => ctx.fillText(l, cx, cy + (k - (lines.length - 1) / 2) * lh));
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { texture: tex, cols, cellW, cellH, W, H, count: labels.length };
}
function setPanelUV(geo, atlas, index) {
  const col = index % atlas.cols, row = Math.floor(index / atlas.cols);
  const u0 = (col * atlas.cellW) / atlas.W, du = atlas.cellW / atlas.W;
  const v0 = 1 - ((row + 1) * atlas.cellH) / atlas.H, dv = atlas.cellH / atlas.H;
  const uv = geo.attributes.uv;
  for (let k = 0; k < uv.count; k++) uv.setXY(k, u0 + uv.getX(k) * du, v0 + uv.getY(k) * dv);
  uv.needsUpdate = true;
}

function labelFor(a) {
  const n = a.tags && a.tags.name;
  if (a.kind === 'information') return n || 'Information';
  if (a.kind === 'toilets') return n || 'Washrooms';
  if (a.kind === 'shower') return n || 'Showers / changing';
  if (a.kind === 'shelter') return n || 'Shelter';
  return n || a.kind;
}

function nativeBuildingName(a) {
  const G = C?.GEO;
  if (!G || !Array.isArray(G.buildings) || !a.point) return null;
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const nm = a.tags && a.tags.name ? norm(a.tags.name) : '';
  for (const b of G.buildings) {
    const bn = b[9] ? norm(b[9]) : '';
    if (nm && bn === nm) return b[9];
    if (Math.hypot(b[0] - a.point[0], b[1] - a.point[1]) < 7) return b[9] || '(unnamed)';
  }
  return null;
}

// The corridors the native city already draws (GEO.roads, the small-park paths) plus the arrival layer's rendered
// connectors. Route pieces inside these are not redrawn, so the module adds only genuinely missing walk pieces.
function nativeCorridorSegments() {
  const G = C?.GEO;
  const segs = [];
  const push = (ax, az, bx, bz, half) => {
    const pad = half;
    segs.push([Math.min(ax, bx) - pad, Math.min(az, bz) - pad, Math.max(ax, bx) + pad, Math.max(az, bz) + pad, half, ax, az, bx, bz]);
  };
  for (const row of G?.parkPaths || []) {
    const half = ((row[0] > 0 ? row[0] : 1.8) / 2) + 0.4;
    for (let i = 2; i + 1 < row.length; i += 2) push(row[i - 2], row[i - 1], row[i], row[i + 1], half);
  }
  for (const r of G?.roads || []) {
    const half = ((r[1] > 0 ? r[1] : 3) / 2) + 0.5;
    for (let i = 6; i + 3 < r.length; i += 2) push(r[i], r[i + 1], r[i + 2], r[i + 3], half);
  }
  const A = C?.ISLAND_ARRIVALS_DATA;
  for (const [dockId, list] of Object.entries(A?.connectors || {})) {
    const dock = A.docks?.[dockId];
    for (const c of list) {
      if (!c.nodes || c.nodes.length < 2) continue;
      if (dock && c.osmId === dock.osmId) continue;
      if (c.nearest !== undefined && c.nearest > 90) continue;
      const w = c.tags && c.tags.width ? Math.max(1.2, Math.min(12, parseFloat(c.tags.width) || 0)) : (c.isWood ? 2.2 : 2.4);
      const half = w / 2 + 0.35;
      for (let i = 0; i + 1 < c.nodes.length; i++) push(c.nodes[i][0], c.nodes[i][1], c.nodes[i + 1][0], c.nodes[i + 1][1], half);
    }
  }
  return segs;
}
function corridorCovered(segs, x, z) {
  for (const s of segs) {
    if (x < s[0] || x > s[2] || z < s[1] || z > s[3]) continue;
    if (distSeg(x, z, s[5], s[6], s[7], s[8]) <= s[4]) return true;
  }
  return false;
}
function segmentCovered(segs, ax, az, bx, bz) {
  for (const t of [0, 0.25, 0.5, 0.75, 1]) if (!corridorCovered(segs, ax + (bx - ax) * t, az + (bz - az) * t)) return false;
  return true;
}
function nativePropNear(point, kind) {
  // Do not double up furniture the city's own layers already draw. GEO.props holds flat [x, z, ...] arrays;
  // CITY.benchStats.sites is the Open Data bench layout. Only same-family keys count.
  const family = kind === 'bench' ? /bench|seat/i : kind === 'picnic' ? /picnic|table/i : kind === 'water' ? /water|fountain|drink/i : null;
  if (!family) return false;
  const near = (arr) => {
    if (!Array.isArray(arr)) return false;
    for (let i = 0; i + 1 < arr.length; i += 2) if (Math.hypot(arr[i] - point[0], arr[i + 1] - point[1]) < 2.5) return true;
    return false;
  };
  for (const [key, arr] of Object.entries(C?.GEO?.props || {})) if (family.test(key) && near(arr)) return true;
  for (const s of C?.benchStats?.sites || []) if (Math.hypot(s.x - point[0], s.z - point[1]) < 2.5) return true;
  return false;
}
function frontEdgePoint(ring, centre, dir) {
  let front = ring[0], best = -Infinity;
  for (const p of ring) { const dx = p[0] - centre[0], dz = p[1] - centre[1], dot = dx * dir[0] + dz * dir[1]; if (dot > best) { best = dot; front = p; } }
  return [front[0] + dir[0] * 0.5, front[1] + dir[1] * 0.5];
}
function moveOutOfNativeBuilding(point, dir) {
  for (const b of C?.GEO?.buildings || []) {
    const dx = point[0] - b[0], dz = point[1] - b[1], d = Math.hypot(dx, dz);
    if (d >= 8) continue;
    const ux = d > 0.1 ? dx / d : dir[0], uz = d > 0.1 ? dz / d : dir[1];
    return [b[0] + ux * 8, b[1] + uz * 8];
  }
  return point;
}

function supportedCityFrame() {
  const G = C?.GEO, D = data();
  if (!G || !G.frame || !G.frame.detail || !C?.CITY_BOUNDS || !D) return false;
  const d = G.frame.detail;
  for (const b of Object.values(D.beaches)) for (const ring of b.rings || []) {
    const box = ringBox(ring);
    if (!(box.minX > d.x0 && box.maxX < d.x1 && box.minZ > d.z0 && box.maxZ < d.z1)) return false;
  }
  return true;
}

// --------------------------------------------------------------------------------------------------------------------
// Build
// --------------------------------------------------------------------------------------------------------------------
function createWaterfrontIslandAccess(THREE = C?.THREE, scene = null) {
  if (!THREE) throw new Error('waterfront-island-access: THREE is required');
  if (!supportedCityFrame()) {
    if (C) C.waterfrontIslandAccessEnabled = false;
    console.info('[waterfrontIslandAccess] skipped: no island access data, or the active frame does not cover the beaches');
    return null;
  }
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const layout = islandAccessLayout();
  const group = new THREE.Group();
  group.name = 'WaterfrontIslandAccess';

  const sandGroup = new THREE.Group(); sandGroup.name = 'IslandAccess-Sand';
  const spurGroup = new THREE.Group(); spurGroup.name = 'IslandAccess-Spurs';
  const propGroup = new THREE.Group(); propGroup.name = 'IslandAccess-Furniture';
  const signGroup = new THREE.Group(); signGroup.name = 'IslandAccess-Signs';
  const buildingGroup = new THREE.Group(); buildingGroup.name = 'IslandAccess-Buildings';

  const colliders = [];
  const surfaceCorridors = [];
  let triangles = 0;
  const countTris = (g, instances = 1) => { if (g) triangles += ((g.index ? g.index.count : g.attributes.position.count) / 3) * instances; };

  // --- sand ------------------------------------------------------------------------------------------------
  const sandMat = standardMaterial(THREE, { color: 0xd9c8a4, roughness: 1.0, metalness: 0.0 });
  const sandTints = { manitou: 0xdccba8, wards: 0xd7c6a1, hanlans: 0xdfd2b4, gibraltar: 0xd5c49f };
  let sandTriangles = 0;
  for (const b of Object.values(layout.beaches)) {
    const mat = sandMat.clone(); mat.color.setHex(sandTints[b.id] ?? 0xd9c8a4);
    for (const ring of b.rings) {
      const g = flatRingGeometry(THREE, ring, ESTIMATES.sandMeshY);
      if (!g) continue;
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = `IslandAccess_${b.id}_sand`;
      mesh.receiveShadow = true; mesh.castShadow = false;
      mesh.userData.role = 'beach-sand'; mesh.userData.beachId = b.id; mesh.userData.osmId = b.osmId;
      mesh.userData.cullDistance = 900; mesh.userData.cullCell = 160;
      sandGroup.add(mesh);
      sandTriangles += g.attributes.position.count / 3;
      countTris(g);
    }
  }

  // --- short real access spurs (mapped surface colours; wood only where tagged) -----------------------------
  const spurGeoms = new Map();
  let spurCount = 0, woodSpurs = 0;
  for (const b of Object.values(layout.beaches)) {
    for (const s of b.access) {
      if (!s.nodes || s.nodes.length < 2) continue;
      const color = surfaceColor(s.surface, s.isWood);
      if (!spurGeoms.has(color)) spurGeoms.set(color, { pos: [], nor: [], count: 0 });
      const bucket = spurGeoms.get(color);
      appendStrip(bucket.pos, bucket.nor, s.nodes, s.y, s.width);
      bucket.count++;
      spurCount++; if (s.isWood) woodSpurs++;
      surfaceCorridors.push({ kind: 'access-spur', y: s.y, half: s.width / 2, nodes: s.nodes, beachId: b.id, dockId: null });
    }
  }
  const spurMats = new Map();
  for (const [color, bucket] of spurGeoms) {
    if (!bucket.pos.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(bucket.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.nor, 3));
    g.computeBoundingSphere();
    if (!spurMats.has(color)) spurMats.set(color, standardMaterial(THREE, { color, roughness: 0.95, metalness: 0.0 }));
    const mesh = new THREE.Mesh(g, spurMats.get(color));
    mesh.userData.role = 'beach-access-spur';
    mesh.userData.cullDistance = 900; mesh.userData.cullCell = 160;
    spurGroup.add(mesh);
    countTris(g);
  }

  // --- the missing pieces of the real dock -> beach walk ---------------------------------------------------
  // The native city draws GEO.roads and the small-park paths (GEO.parkPaths); the arrival layer draws its own dock
  // connectors. The data's full-resolution OSM route edges are tested against those corridors (and against our own
  // access spurs), and ONLY the uncovered pieces are drawn, in their mapped surface colour. This gives a real visual
  // ferry -> beach walk without duplicating the whole network or inventing a path.
  const routeGroup = new THREE.Group(); routeGroup.name = 'IslandAccess-RouteGaps';
  const coverageSegs = nativeCorridorSegments();
  for (const b of Object.values(layout.beaches)) for (const sp of b.access) {
    const half = sp.width / 2 + 0.3;
    for (let i = 0; i + 1 < sp.nodes.length; i++) {
      const [ax, az] = sp.nodes[i], [bx, bz] = sp.nodes[i + 1];
      coverageSegs.push([Math.min(ax, bx) - half, Math.min(az, bz) - half, Math.max(ax, bx) + half, Math.max(az, bz) + half, half, ax, az, bx, bz]);
    }
  }
  const gapGeoms = new Map();
  const gapSeen = new Set();
  let routeGapM = 0, routeGapSegments = 0, routeGapRuns = 0;
  for (const [dockId, r] of Object.entries(layout.routes)) {
    if (!Array.isArray(r.segments)) continue;
    let run = [], runSurface = null, runWidth = 2.4;
    const flush = () => {
      if (run.length >= 2) {
        const color = surfaceColor(runSurface, runSurface === 'wood');
        if (!gapGeoms.has(color)) gapGeoms.set(color, { pos: [], nor: [] });
        const bucket = gapGeoms.get(color);
        const y = runSurface === 'sand' ? ESTIMATES.sandMeshY : ESTIMATES.walkTop + SPUR_LIFT;
        appendStrip(bucket.pos, bucket.nor, run, y, runWidth);
        routeGapRuns++;
        surfaceCorridors.push({ kind: 'route-gap', y, half: runWidth / 2, nodes: run.map((p) => [p[0], p[1]]), beachId: r.beach, dockId });
      }
      run = []; runSurface = null;
    };
    for (const [ax, az, bx, bz, surface, , width] of r.segments) {
      const key = (ax < bx || (ax === bx && az <= bz)) ? `${ax},${az},${bx},${bz},${surface}` : `${bx},${bz},${ax},${az},${surface}`;
      const covered = gapSeen.has(key) || segmentCovered(coverageSegs, ax, az, bx, bz);
      if (covered) { flush(); continue; }
      gapSeen.add(key);
      if (runSurface !== surface) { flush(); runSurface = surface; runWidth = width || 2.4; }
      if (!run.length) run.push([ax, az]);
      run.push([bx, bz]);
      routeGapM += Math.hypot(bx - ax, bz - az);
      routeGapSegments++;
    }
    flush();
  }
  for (const [color, bucket] of gapGeoms) {
    if (!bucket.pos.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(bucket.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.nor, 3));
    g.computeBoundingSphere();
    if (!spurMats.has(color)) spurMats.set(color, standardMaterial(THREE, { color, roughness: 0.95, metalness: 0.0 }));
    const mesh = new THREE.Mesh(g, spurMats.get(color));
    mesh.userData.role = 'route-gap';
    mesh.userData.cullDistance = 900; mesh.userData.cullCell = 160;
    routeGroup.add(mesh);
    countTris(g);
  }

  // --- amenity furniture (instanced, exact mapped positions) ----------------------------------------------
  const benches = [], picnic = [], water = [], bbq = [];
  const signs = [];   // { kind, label, point, facing, a }
  const buildings = []; // { a, ring } real building missing from the geodata
  let nativeKept = 0, deduped = 0;
  for (const a of layout.amenities) {
    // Do not double up furniture already drawn by the city's own layers (none on the island today, but this is the
    // guard the mainland beach furniture needs too).
    if ((a.kind === 'bench' || a.kind === 'picnic' || a.kind === 'water') && nativePropNear(a.point, a.kind)) { deduped++; continue; }
    if (a.kind === 'bench') benches.push(a);
    else if (a.kind === 'picnic') picnic.push(a);
    else if (a.kind === 'water') water.push(a);
    else if (a.kind === 'bbq') bbq.push(a);
    else if (a.kind === 'toilets' || a.kind === 'shower' || a.kind === 'shelter' || a.kind === 'information') {
      const native = a.ring ? nativeBuildingName(a) : null;
      if (native) nativeKept++;
      // Only toilets / shower-change buildings get added massing when the geodata lacks them. A shelter is an open
      // structure (a pavilion or waiting shed): it gets an identity panel on its sourced front edge, never a solid box.
      const addMassing = a.ring && !native && (a.kind === 'toilets' || a.kind === 'shower');
      if (addMassing) buildings.push({ a, ring: a.ring });
      else signs.push(a);
    }
  }

  // Which way a sign / bench should face: back toward the nearest ferry dock (inland), so a walker arriving from the
  // ferry reads the front. Documented as an inferred yaw, not a surveyed orientation.
  const facingToDock = (p) => {
    let best = null, bd = Infinity;
    for (const d of Object.values(layout.docks)) {
      const dd = Math.hypot(d.anchor[0] - p[0], d.anchor[1] - p[1]);
      if (dd < bd) { bd = dd; best = d.anchor; }
    }
    if (!best) return [0, 1];
    const dx = best[0] - p[0], dz = best[1] - p[1], L = Math.hypot(dx, dz) || 1;
    return [dx / L, dz / L];
  };

  const instanced = (geo, mat, list, name, role, yawFor) => {
    if (!list.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    im.name = name;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    list.forEach((a, i) => {
      const yaw = yawFor ? yawFor(a) : 0;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      pos.set(a.point[0], ESTIMATES.sandY, a.point[1]);
      m.compose(pos, q, one);
      im.setMatrixAt(i, m);
      a._yaw = yaw;
    });
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true; im.receiveShadow = true;
    im.userData.role = role; im.userData.count = list.length;
    im.userData.cullDistance = 800; im.userData.cullCell = 140;
    countTris(geo, list.length);
    return im;
  };

  const woodMat = standardMaterial(THREE, { color: 0x7a5334, roughness: 0.85, metalness: 0.0 });
  const steelMat = standardMaterial(THREE, { color: 0x6c7278, roughness: 0.5, metalness: 0.6 });
  const benchGeo = mergeGeoms(THREE, [
    boxGeometry(THREE, ESTIMATES.benchWidth, 0.06, ESTIMATES.benchDepth, 0, 0.44, 0),
    boxGeometry(THREE, ESTIMATES.benchWidth, 0.34, 0.05, 0, 0.64, -ESTIMATES.benchDepth / 2 + 0.03),
    boxGeometry(THREE, 0.07, 0.44, ESTIMATES.benchDepth - 0.06, -ESTIMATES.benchWidth / 2 + 0.12, 0.22, 0),
    boxGeometry(THREE, 0.07, 0.44, ESTIMATES.benchDepth - 0.06, ESTIMATES.benchWidth / 2 - 0.12, 0.22, 0)
  ]);
  const picnicGeo = mergeGeoms(THREE, [
    boxGeometry(THREE, 1.6, 0.07, 0.8, 0, 0.74, 0),
    boxGeometry(THREE, 1.6, 0.05, 0.3, 0, 0.45, 0.58),
    boxGeometry(THREE, 1.6, 0.05, 0.3, 0, 0.45, -0.58),
    boxGeometry(THREE, 0.08, 0.74, 0.7, -0.62, 0.37, 0),
    boxGeometry(THREE, 0.08, 0.74, 0.7, 0.62, 0.37, 0)
  ]);
  const waterGeo = mergeGeoms(THREE, [
    new THREE.CylinderGeometry(0.11, 0.14, 0.95, 8).translate(0, 0.475, 0),
    boxGeometry(THREE, 0.46, 0.12, 0.34, 0, 0.9, 0.05)
  ]);
  const bbqGeo = mergeGeoms(THREE, [
    boxGeometry(THREE, 0.52, 0.32, 0.42, 0, 0.9, 0),
    boxGeometry(THREE, 0.07, 0.74, 0.07, 0, 0.37, 0)
  ]);

  const benchIM = instanced(benchGeo, woodMat, benches, 'IslandAccess-Benches', 'bench', (a) => {
    const b = Object.values(layout.beaches).find((x) => x.id === a.beach);
    if (!b) return 0;
    const [px, pz] = nearestOnRing(b.rings[0], a.point[0], a.point[1]);
    return Math.atan2(px - a.point[0], pz - a.point[1]);
  });
  const picnicIM = instanced(picnicGeo, woodMat, picnic, 'IslandAccess-Picnic', 'picnic');
  const waterIM = instanced(waterGeo, steelMat, water, 'IslandAccess-Water', 'water');
  const bbqIM = instanced(bbqGeo, steelMat, bbq, 'IslandAccess-BBQ', 'bbq');
  for (const im of [benchIM, picnicIM, waterIM, bbqIM]) if (im) propGroup.add(im);

  // colliders for the solid furniture (bounded boxes around the mapped points)
  for (const a of [...benches, ...picnic, ...water, ...bbq]) {
    const half = a.kind === 'bench' ? 0.95 : a.kind === 'picnic' ? 0.9 : 0.3;
    colliders.push({
      minX: a.point[0] - half, maxX: a.point[0] + half, minZ: a.point[1] - half, maxZ: a.point[1] + half,
      minY: ESTIMATES.sandY, maxY: ESTIMATES.sandY + (a.kind === 'picnic' ? 0.8 : a.kind === 'water' ? 1.1 : 0.9),
      prop: true, kind: a.kind, osmId: a.osmId,
      obb: { cx: a.point[0], cz: a.point[1], hx: half, hz: half, cs: 1, sn: 0 }
    });
  }

  // --- signs: one opaque text panel per mapped identity, mounted in front of its own post ---------------
  const signRecords = [];
  for (const a of signs) {
    const dir = facingToDock(a.point);
    // identity panel on the sourced front edge (a building's own body shape wins; the pole never stands inside a wall)
    const point = a.ring ? frontEdgePoint(a.ring, a.point, dir) : moveOutOfNativeBuilding(a.point, dir);
    signRecords.push({ kind: a.kind, label: labelFor(a), point, facing: dir, a });
  }
  // Added real buildings get their identity panel on the front edge toward the ferry, outside the wall.
  for (const { a, ring } of buildings) {
    const dir = facingToDock(a.point);
    signRecords.push({ kind: a.kind, label: labelFor(a), point: frontEdgePoint(ring, a.point, dir), facing: dir, a });
  }
  for (const b of Object.values(layout.beaches)) {
    const p = b.accessPoint || (b.bestWay && b.bestWay.point) || null;
    if (!p) continue;
    const dir = facingToDock(p);
    const route = Object.values(layout.routes).find((r) => r.beach === b.id);
    const dist = route ? ` · ${route.lengthM} m walk` : '';
    signRecords.push({ kind: 'beach-access', label: `${b.name}${dist}`, point: moveOutOfNativeBuilding(p, dir), facing: dir, beachId: b.id });
  }
  const uniqueLabels = [];
  const labelIndex = new Map();
  for (const r of signRecords) if (!labelIndex.has(r.label)) { labelIndex.set(r.label, uniqueLabels.length); uniqueLabels.push(r.label); }
  const atlas = uniqueLabels.length ? buildLabelAtlas(THREE, uniqueLabels) : null;
  let signPanels = 0;
  if (atlas) {
    const panelMat = new THREE.MeshBasicMaterial({ map: atlas.texture, side: THREE.DoubleSide });
    const postGeo = new THREE.CylinderGeometry(ESTIMATES.post / 2, ESTIMATES.post / 2, ESTIMATES.panelTop, 8);
    const postMat = standardMaterial(THREE, { color: 0x4a4f54, roughness: 0.5, metalness: 0.6 });
    const panelProto = new THREE.PlaneGeometry(ESTIMATES.panelWidth, ESTIMATES.panelHeight);
    for (const r of signRecords) {
      const [x, z] = r.point;
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(x, ESTIMATES.sandY + ESTIMATES.panelTop / 2, z);
      const geo = panelProto.clone();
      setPanelUV(geo, atlas, labelIndex.get(r.label));
      const panel = new THREE.Mesh(geo, panelMat);
      const f = r.facing || [0, 1];
      panel.rotation.y = Math.atan2(f[0], f[1]);
      panel.position.set(
        x + f[0] * (ESTIMATES.post / 2 + 0.03),
        ESTIMATES.sandY + ESTIMATES.panelTop - ESTIMATES.panelHeight / 2,
        z + f[1] * (ESTIMATES.post / 2 + 0.03)
      );
      post.userData.role = 'access-post'; panel.userData.role = 'access-panel';
      panel.userData.kind = r.kind; panel.userData.osmId = r.a?.osmId ?? null;
      panel.userData.beachId = r.beachId ?? null;
      for (const m of [post, panel]) { m.userData.cullDistance = 700; m.userData.cullCell = 120; }
      signGroup.add(post); signGroup.add(panel);
      signPanels++;
      colliders.push({
        minX: x - 0.12, maxX: x + 0.12, minZ: z - 0.12, maxZ: z + 0.12,
        minY: ESTIMATES.sandY, maxY: ESTIMATES.sandY + ESTIMATES.panelTop, prop: true, kind: 'sign', osmId: r.a?.osmId ?? null,
        obb: { cx: x, cz: z, hx: 0.12, hz: 0.12, cs: 1, sn: 0 }
      });
    }
    countTris(postGeo, signPanels);
  } else {
    // document-less fallback: one plain opaque colour panel per sign (no text), recorded in stats.signAtlas=false
    const panelMat = standardMaterial(THREE, { color: 0x33515c, roughness: 0.8, metalness: 0.1 });
    for (const r of signRecords) {
      const [x, z] = r.point, f = r.facing || [0, 1];
      const panel = new THREE.Mesh(new THREE.BoxGeometry(ESTIMATES.panelWidth, ESTIMATES.panelHeight, 0.08), panelMat);
      panel.position.set(x + f[0] * 0.1, ESTIMATES.sandY + ESTIMATES.panelTop - ESTIMATES.panelHeight / 2, z + f[1] * 0.1);
      panel.rotation.y = Math.atan2(f[0], f[1]);
      panel.userData.role = 'access-panel'; panel.userData.fallback = true; panel.userData.kind = r.kind;
      signGroup.add(panel);
      signPanels++;
    }
  }

  // --- real beach buildings missing from the geodata (identity + massing from the exact OSM ring) -------
  let addedBuildings = 0, nativeBuildingsKept = nativeKept;
  const bmat = standardMaterial(THREE, { color: 0xb9b3a6, roughness: 0.9, metalness: 0.0 });
  for (const { a, ring } of buildings) {
    const pts = ring.map(([x, z]) => ({ x, z }));
    let geo = null;
    if (typeof C?.createExtrudedPolygonMesh === 'function') {
      const made = C.createExtrudedPolygonMesh(pts, ESTIMATES.sandY + 0.01, a.height || ESTIMATES.buildingHeight, null, true, true);
      if (made && made.geometry) geo = made.geometry;
    }
    if (!geo) {
      const box = ringBox(ring);
      geo = boxGeometry(THREE, Math.max(1, box.maxX - box.minX), a.height || ESTIMATES.buildingHeight, Math.max(1, box.maxZ - box.minZ), 0, (a.height || ESTIMATES.buildingHeight) / 2, 0);
    }
    const mesh = new THREE.Mesh(geo, bmat);
    if (!(geo.attributes.position.count && geo.attributes.position.array.length)) continue;
    mesh.userData.role = 'beach-building'; mesh.userData.osmId = a.osmId; mesh.userData.name = a.tags?.name || null;
    mesh.userData.cullDistance = 900; mesh.userData.cullCell = 160;
    mesh.castShadow = true; mesh.receiveShadow = true;
    buildingGroup.add(mesh);
    countTris(geo);
    addedBuildings++;
    const box = ringBox(ring);
    colliders.push({
      minX: box.minX, maxX: box.maxX, minZ: box.minZ, maxZ: box.maxZ,
      minY: ESTIMATES.sandY, maxY: ESTIMATES.sandY + (a.height || ESTIMATES.buildingHeight), prop: true, kind: 'building', osmId: a.osmId
    });
  }

  // one group, name + cull metadata
  for (const g of [sandGroup, spurGroup, routeGroup, propGroup, signGroup, buildingGroup]) { g.userData.cullDistance = 1000; g.userData.cullCell = 200; group.add(g); }
  group.userData.waterfrontIslandAccess = null;

  const routeStats = {};
  for (const [id, r] of Object.entries(layout.routes)) routeStats[id] = { beach: r.beach, lengthM: r.lengthM, connected: !!r.connected, finalGapM: r.finalGapM, ways: r.ways.length, coverage: r.coverage || null, finalApproach: r.finalApproach || null };

  const stats = {
    beaches: Object.keys(layout.beaches).length,
    beachIds: Object.keys(layout.beaches),
    sandTriangles: Math.round(sandTriangles),
    accessSpurs: spurCount, woodSpurs,
    routeGapM: Math.round(routeGapM), routeGapSegments, routeGapRuns,
    routeBridgeSegments: Object.values(layout.routes).reduce((n, r) => n + (r.segments || []).filter((seg) => seg[7] === 1).length, 0),
    routeBridgeM: Math.round(Object.values(layout.routes).reduce((n, r) => n + (r.segments || []).filter((seg) => seg[7] === 1).reduce((m, seg) => m + Math.hypot(seg[2] - seg[0], seg[3] - seg[1]), 0), 0)),
    nativeRouteCoveredM: Math.round(Object.values(layout.routes).reduce((n, r) => n + (r.coverage ? r.coverage.covered : 0), 0)),
    amenities: layout.amenities.length, dedupedAmenities: deduped,
    benches: benches.length, picnic: picnic.length, waterFountains: water.length, bbqs: bbq.length,
    signs: signPanels, signAtlas: !!atlas, signLabels: uniqueLabels.length,
    buildingsAdded: addedBuildings, nativeBuildingsKept,
    routes: routeStats,
    routeConnected: Object.values(routeStats).filter((r) => r.connected).length,
    meshes: group.children.reduce((n, g) => n + g.children.length, 0),
    triangles: Math.round(triangles),
    colliders: colliders.length,
    sandY: ESTIMATES.sandY, sandMeshY: ESTIMATES.sandMeshY, walkTop: ESTIMATES.walkTop,
    skipped: layout.skipped,
    source: layout.source,
    ms: Math.round(((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) * 10) / 10
  };
  group.userData.waterfrontIslandAccess = stats;

  if (scene && scene.add) scene.add(group);
  const result = {
    group, root: group, colliders, stats, layout, surfaces: { corridors: surfaceCorridors },
    islandBeachSurfaceAt,
    islandAccessSurfaceAt,
    islandAccessRoute,
    applyWaterfrontIslandAccessGroundMask
  };
  result.surfaces = { corridors: surfaceCorridors };
  if (C) { C.waterfrontIslandAccess = result; C.waterfrontIslandAccessEnabled = true; }
  console.info(`[waterfrontIslandAccess] ${stats.beaches} beaches (${Math.round(stats.sandTriangles)} sand tris), ` +
    `${stats.accessSpurs} real access spurs (${stats.woodSpurs} wood), ${stats.benches} benches, ${stats.picnic} picnic, ` +
    `${stats.signs} signs, ${stats.buildingsAdded} added building(s), routes ${stats.routeConnected}/${Object.keys(routeStats).length} mapped: ` +
    `${stats.triangles} triangles, ${stats.ms} ms`);
  return result;
}

Object.assign(C || (window.CITY = {}), {
  ISLAND_ACCESS_ESTIMATES: ESTIMATES,
  islandAccessLayout,
  islandAccessGroundLayout,
  islandAccessGroundExclusionPolygons,
  islandBeachSurfaceAt,
  islandAccessSurfaceAt,
  islandAccessRoute,
  applyWaterfrontIslandAccessGroundMask,
  supportedIslandAccessCityFrame: supportedCityFrame,
  createWaterfrontIslandAccess,
  buildWaterfrontIslandAccess: createWaterfrontIslandAccess
});
})();
