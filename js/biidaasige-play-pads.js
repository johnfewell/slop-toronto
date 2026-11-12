(function () {
// js/biidaasige-play-pads.js
// Biidaasige Park — SOURCE-FOOTPRINT PLAY GROUND SURFACING (bead st-bmyv.9; small ground layer). Owns only this file,
// its test and docs/biidaasige-play-pads.md. The captain owns integration and every other module; this file edits no
// main/data/path module and adds no terrain system.
//
// WHAT IS BUILT — exactly two source footprints, both from the CURRENT OSM polygons the parent inventory worker
// (st-bmyv.1) already carries in window.CITY.BIIDAASIGE_PARK, projected through the city's own C.worldFromLatLon:
//
//   1. reaching-raccoon        OSM way/1418796674 (the actual Reaching Raccoon structure footprint, ~137 m2)
//                              -> a muted SAGE/GREY poured-rubber pad, top exactly at y = .224 m.
//   2. snowy-owl-playground    OSM way/1418127159 (a GENERIC WEST PLAYGROUND AREA, ~7069 m2; its legacy id is NOT a
//                              claim that its centroid is the Snowy Owl structure)
//                              -> the western play BED, a muted BROWN woodchip/gravel base, top at y = .224 m.
//
// The western base material is a REPRESENTATIVE RECONSTRUCTION of the mixed woodchip/gravel surfacing seen in the
// maker/City photos; the individual woodchip islands are NOT surveyed, so the bed is drawn as ONE muted base tone and
// the mixed islands are NOT invented. This layer fills neither the whole park nor a river.
//
// WHAT THIS LAYER IS NOT — the path layer (js/biidaasige-paths.js, y = lawn + 0.030) and the rubber cableway corridors
// (js/biidaasige-play-infrastructure.js, raised ground 0..0.45) sit ABOVE this pad; the named Badlands polygon is
// another worker's raised surface whose terracotta geometry overlays this base. This module does not build, raise or
// suppress any of those; it draws only the flat source-footprint ground below them.
//
// CONTRACT
//   - C.buildBiidaasigePlayPads(scene, allColliders) -> { group, colliders, surfaces, areas, stats } | null.
//     Adds the group to `scene` only when a scene is passed. Returns colliders: [] (a ground pad is never a collider).
//   - Every entry in `surfaces` is [{ triangle: [9 world numbers, y-up, upward-wound], kind }] copied from the
//     ACTUAL rendered mesh triangles, so an independent THREE downward raycast hits the same top.
//   - `areas` is [{ id, ref, ring: [[x,z],...], areaM2, y, material, sourceRef, ... }] for the two source footprints.
//   - C.biidaasigePlayPadAt(x, z) -> { onPad, kind, padId, surfaceY } | null. Exact-triangle query over THIS module's
//     published triangles; null off the pads. It is rebuilt on every successful build, so an invalid rebuild clears the
//     stale pads instead of answering from them.
//   - Concave-safe: the rings are earcut by THREE.ShapeUtils.triangulateShape (no fan fill). Winding is normalized
//     upward and every published triangle is verified with a real THREE downward raycast in the test.
//   - Geometry arrays are finite; WGS84 -> world ONLY through C.worldFromLatLon at call time. A missing source, a
//     missing projection, a degenerate ring or a vertex in a water ring builds NOTHING (and reports why) — never a
//     fabricated pad.
//   - Pure CPU build: no document, no network, no image read. Node materials, rough matte finishes, ONE merged mesh per
//     pad (no per-chip scatter, no draw call per triangle).
//
// Attribution: current OpenStreetMap contributors (ODbL), 2026-11-10; City of Toronto / Waterfront Toronto.
// Documentation-only: docs/biidaasige-play-pads.md.
const C = (typeof window !== 'undefined' && (window.CITY || (window.CITY = {}))) || null;

// ---------------------------------------------------------------------------------------------------------------
// Recorded datum and source-material estimates (1 unit = 1 m). Marked in docs/biidaasige-play-pads.md.
const PAD_TOP_Y = 0.224; // CITY sidewalk lawn datum (0.22) + 0.004 — the same base the main model pads use

// The two source footprints, with current-OSM provenance explicit. Material colours are STYLE ESTIMATES read from the
// maker/City photos; there is no published RGB for either finish.
const PADS = Object.freeze([
  {
    id: 'reaching-raccoon',
    role: 'structure-pad',
    material: 'rubber',
    color: 0x8f9489,   // muted sage/grey poured rubber — ESTIMATE (photo read)
    roughness: 0.96,
    surfaceStatus: 'source-footprint pad (exact OSM polygon), rubber colour is a photo estimate'
  },
  {
    id: 'snowy-owl-playground',
    role: 'play-bed',
    material: 'woodchip-gravel',
    color: 0x8a6f52,   // muted brown woodchip/gravel — ESTIMATE; a representative reconstruction of mixed surfacing
    roughness: 0.98,
    surfaceStatus: 'representative reconstruction of mixed woodchip/gravel; individual islands not surveyed'
  }
]);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---------------------------------------------------------------------------------------------------------------
// Materials (WebGPU NodeMaterial with a classic fallback, the repo convention).
function padMaterial(THREE, spec) {
  const Mat = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
  return new Mat({ color: spec.color, roughness: spec.roughness, metalness: 0.0 });
}

// ---------------------------------------------------------------------------------------------------------------
// Data reading through the city's own projection (C.worldFromLatLon at call time). null when unavailable.
function projectionAvailable() {
  return !!(C && typeof C.worldFromLatLon === 'function');
}
function project(lat, lon) {
  if (!projectionAvailable() || !isNum(lat) || !isNum(lon)) return null;
  const p = C.worldFromLatLon(lat, lon);
  return p && isNum(p.x) && isNum(p.z) ? { x: p.x, z: p.z } : null;
}
function parkFeature(id) {
  const D = C && C.BIIDAASIGE_PARK;
  if (!D) return null;
  return (D.features || []).find((f) => f && f.id === id) || null;
}
function worldFeatureRing(f) {
  if (!f || !Array.isArray(f.ring) || f.ring.length < 3) return null;
  if (!projectionAvailable()) return null;
  const out = [];
  for (const pt of f.ring) {
    const lat = Array.isArray(pt) ? pt[0] : pt.lat;
    const lon = Array.isArray(pt) ? pt[1] : pt.lon;
    const p = project(lat, lon);
    if (!p) return null;
    out.push({ x: p.x, z: p.z });
  }
  return out;
}
function worldWaterRings() {
  const D = C && C.BIIDAASIGE_PARK;
  if (!D || !projectionAvailable()) return [];
  const out = [];
  for (const wg of D.waterGeometry || []) {
    if (!wg || !Array.isArray(wg.ring)) continue;
    const r = [];
    let ok = true;
    for (const pt of wg.ring) {
      const p = project(pt[0], pt[1]);
      if (!p) { ok = false; break; }
      r.push({ x: p.x, z: p.z });
    }
    if (ok && r.length >= 3) out.push({ ref: wg.ref, ring: r });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Pure polygon helpers (world x/z).
function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, zi = ring[i].z, xj = ring[j].x, zj = ring[j].z;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j].x * ring[i].z - ring[i].x * ring[j].z;
  return Math.abs(a / 2);
}
function dedupeRing(ring) {
  const out = [];
  for (const p of ring) {
    if (!isNum(p.x) || !isNum(p.z)) return null;
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-9 && Math.abs(last.z - p.z) < 1e-9) continue;
    out.push({ x: p.x, z: p.z });
  }
  if (out.length >= 2) {
    const f = out[0], l = out[out.length - 1];
    if (Math.abs(f.x - l.x) < 1e-9 && Math.abs(f.z - l.z) < 1e-9) out.pop();
  }
  return out;
}

// A flat XZ polygon at height y, earcut by THREE.ShapeUtils (concave-safe; no fan fill). Winding is normalized so the
// +Y normal faces up (the front face the camera sees; a ray from above hits it). Pure.
function padGeometry(THREE, ring, y) {
  if (!ring || ring.length < 3) return null;
  const contour = ring.map((p) => new THREE.Vector2(p.x, p.z));
  let faces;
  try { faces = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { return null; }
  if (!Array.isArray(faces) || !faces.length) return null;
  const pos = [];
  for (const [i, j, k] of faces) {
    const a = ring[i], b = ring[j], c = ring[k];
    if (!a || !b || !c) continue;
    // signed area in XZ: with x right and z "up" in the Vector2 plane, the upward-facing winding has the +Y normal
    const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    const order = ny > 0 ? [a, b, c] : [a, c, b];
    if (Math.abs(ny) < 1e-12) continue;
    for (const p of order) pos.push(p.x, y, p.z);
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const n = new Float32Array(pos.length);
  for (let i = 1; i < n.length; i += 3) n[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// Copy the ACTUAL rendered triangles from a geometry into the repo `surfaces` format, rewound upward. Pure.
function collectTriangles(p, kind, out) {
  for (let t = 0; t + 2 < p.count; t += 3) {
    const ax = p.getX(t), ay = p.getY(t), az = p.getZ(t);
    const bx = p.getX(t + 1), by = p.getY(t + 1), bz = p.getZ(t + 1);
    const cx = p.getX(t + 2), cy = p.getY(t + 2), cz = p.getZ(t + 2);
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (Math.abs(ny) < 1e-12) continue;
    if (ny > 0) out.push({ triangle: [ax, ay, az, bx, by, bz, cx, cy, cz], kind });
    else out.push({ triangle: [ax, ay, az, cx, cy, cz, bx, by, bz], kind });
  }
}

// Exact-triangle point query over a `surfaces` list. Returns the highest matching triangle's height, or null.
function makeTriangleQuery(surfaces) {
  const tris = [];
  for (const s of surfaces) {
    const T = s.triangle;
    if (!Array.isArray(T) || T.length !== 9) continue;
    tris.push({ x: [T[0], T[3], T[6]], y: [T[1], T[4], T[7]], z: [T[2], T[5], T[8]], kind: s.kind });
  }
  return { tris };
}
function queryAt(query, x, z, padId) {
  if (!query || !isNum(x) || !isNum(z)) return null;
  let best = null;
  for (const t of query.tris) {
    const x0 = t.x[0], x1 = t.x[1], x2 = t.x[2], z0 = t.z[0], z1 = t.z[1], z2 = t.z[2];
    const den = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
    if (Math.abs(den) < 1e-12) continue;
    const a = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / den;
    const b = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / den;
    const c = 1 - a - b;
    if (a < -1e-7 || b < -1e-7 || c < -1e-7) continue;
    const h = a * t.y[0] + b * t.y[1] + c * t.y[2];
    if (!best || h > best.surfaceY) best = { onPad: true, kind: t.kind, padId, surfaceY: h };
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------
// LAYOUT ADAPTER — C.buildBiidaasigePlayPads(scene, allColliders). Builds ONLY the two source-footprint ground pads.
function buildBiidaasigePlayPads(scene = null, allColliders = null) {
  const THREE = (C && C.THREE) || null;
  if (!THREE) return null;
  const group = new THREE.Group();
  group.name = 'BiidaasigePlayPads';
  const surfaces = [];
  const areas = [];
  const skipped = [];
  const stats = {
    meshes: 0, triangles: 0, padCount: 0, colliders: 0, topY: PAD_TOP_Y,
    material: {}, estimates: true, source: 'current OSM footprints (parent inventory), projected at call time'
  };

  const D = C && C.BIIDAASIGE_PARK;
  if (!D) {
    stats.reason = 'BIIDAASIGE_PARK data missing';
    group.userData.biidaasigePlayPads = stats;
    if (scene && scene.add) scene.add(group);
    if (C) C.biidaasigePlayPads = { group, colliders: [], surfaces, areas, skipped, stats };
    if (C) C.biidaasigePlayPadAt = () => null;
    return { group, colliders: [], surfaces, areas, skipped, stats };
  }
  if (!projectionAvailable()) {
    stats.reason = 'projection unavailable (C.worldFromLatLon missing)';
    group.userData.biidaasigePlayPads = stats;
    if (scene && scene.add) scene.add(group);
    if (C) C.biidaasigePlayPads = { group, colliders: [], surfaces, areas, skipped, stats };
    if (C) C.biidaasigePlayPadAt = () => null;
    return { group, colliders: [], surfaces, areas, skipped, stats };
  }

  const waters = worldWaterRings();

  for (const spec of PADS) {
    const f = parkFeature(spec.id);
    if (!f) { skipped.push({ id: spec.id, reason: 'source feature missing from BIIDAASIGE_PARK' }); continue; }
    const rawRing = worldFeatureRing(f);
    if (!rawRing) { skipped.push({ id: spec.id, reason: 'source ring missing or outside the active projection' }); continue; }
    const ring = dedupeRing(rawRing);
    if (!ring || ring.length < 3) { skipped.push({ id: spec.id, reason: 'degenerate source ring' }); continue; }
    const areaM2 = ringArea(ring);
    if (!(areaM2 > 1)) { skipped.push({ id: spec.id, reason: 'source ring has no area' }); continue; }

    // No infill across water: a pad whose polygon contains any water ring vertex would bridge a river. Refuse it.
    let waterHit = false;
    for (const w of waters) for (const p of w.ring) if (pointInRing(ring, p.x, p.z)) { waterHit = true; break; }
    if (waterHit) { skipped.push({ id: spec.id, reason: 'source polygon spans a water ring (no water infill)' }); continue; }

    const geo = padGeometry(THREE, ring, PAD_TOP_Y);
    if (!geo) { skipped.push({ id: spec.id, reason: 'triangulation produced no faces' }); continue; }

    const mat = padMaterial(THREE, spec);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `BiidaasigePlayPads_${spec.id}`;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.userData.cullDistance = 700;
    mesh.userData.cullCell = 90;
    group.add(mesh);
    stats.meshes++;

    const p = geo.attributes.position;
    const nBefore = surfaces.length;
    collectTriangles(p, spec.material, surfaces);
    const nTri = Math.floor(p.count / 3);
    stats.triangles += nTri;
    stats.padCount++;
    stats.material[spec.id] = spec.material;

    areas.push({
      id: spec.id,
      ref: f.ref,
      ring: ring.map((pt) => [pt.x, pt.z]),
      areaM2: Math.round(areaM2 * 10) / 10,
      mappedAreaM2: isNum(f.areaM2Mapped) ? f.areaM2Mapped : null, // OSRM/source area in lat-lon degrees units (data)
      y: PAD_TOP_Y,
      material: spec.material,
      role: spec.role,
      sourceRef: `BIIDAASIGE_PARK.features:${spec.id} (${f.ref})`,
      sourceStatus: spec.surfaceStatus,
      triangles: nTri,
      vertices: p.count,
      surfaceEntries: surfaces.length - nBefore
    });
    // per-pad query over ONLY this pad's published triangles (its own surfaceEntries)
    const ownSurfaces = surfaces.slice(nBefore);
    areas[areas.length - 1].query = makeTriangleQuery(ownSurfaces);
  }

  stats.colliders = 0;
  group.userData.biidaasigePlayPads = stats;
  if (scene && scene.add) scene.add(group);
  if (C) C.biidaasigePlayPads = { group, colliders: [], surfaces, areas, skipped, stats };
  if (C) C.biidaasigePlayPadAt = (x, z) => padAtInternal(x, z);
  if (typeof console !== 'undefined' && console.info) {
    console.info(`[biidaasigePlayPads] ${stats.padCount} source-footprint pads (${stats.triangles} tris) at y=${PAD_TOP_Y}` +
      `${skipped.length ? `, ${skipped.length} skipped` : ''} (no river infill, no global fill)`);
  }
  return { group, colliders: [], surfaces, areas, skipped, stats };
}

// Per-pad exact-triangle lookup so C.biidaasigePlayPadAt never answers from another pad's surface. Each area record
// carries its own `query` built from ITS OWN published surface triangles; invalid rebuilds drop it with the record.
function padAtInternal(x, z) {
  const w = C && C.biidaasigePlayPads;
  if (!w || !Array.isArray(w.areas)) return null;
  for (const a of w.areas) {
    if (!a.query) continue;
    if (!pointInRing(a.ring.map((pt) => ({ x: pt[0], z: pt[1] })), x, z)) continue;
    const q = queryAt(a.query, x, z, a.id);
    if (q) return q;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Exports (the repo module convention: Object.assign(window.CITY, {...})).
if (C) {
  Object.assign(C, {
    BIIDAASIGE_PLAY_PAD_TOP_Y: PAD_TOP_Y,
    BIIDAASIGE_PLAY_PAD_SPECS: PADS,
    buildBiidaasigePlayPads,
    biidaasigePlayPadHelpers: { padGeometry, pointInRing, ringArea, dedupeRing, makeTriangleQuery, queryAt }
  });
}
})();
