(function () {
// js/city-grid.js
// Builds Toronto's ground: the street level (asphalt) of the detailed city, every curb island with its kerb, walkway &
// verge around the plots (yards, lawns, parks), the medians, Lake Ontario & the harbour, the streams, the walls the map
// has, and the flyovers of the Gardiner & the interchanges (decks, parapets, piers, ramps).

const { THREE } = window.CITY;
const { mergeGeometries } = window.CITY.Addons;
const {
  CITY_BOUNDS,
  BLOCKS,
  WATER_BODIES,
  EDGE_WATERS,
  bankBetween,
  STREAMS,
  DECKS,
  GEO,
  blockAt,
  ROAD_CUTS,
  cutLocal,
  cutBankAt,
  cutAt,
  pondsOnIsland,
  pondOnPolygon,
  subtractConvexXZ
} = window.CITY;
const {
  createRoadSurfaceMaterial,
  createSidewalkMaterial,
  createCurbMaterial,
  createWaterMaterial,
  createParkLawnMaterial,
  createTerrainMaterial,
  createPlotGroundMaterial,
  createForecourtMaterial,
  createRenderedWallMaterial
} = window.CITY;

function batchStaticGroupMeshes(rootGroup, excludeMaterials = null) {
  if (!mergeGeometries) return;
  rootGroup.updateMatrixWorld(true);
  const invRoot = new THREE.Matrix4().copy(rootGroup.matrixWorld).invert();
  const buckets = new Map();

  rootGroup.traverse((obj) => {
    if (!obj.isMesh || obj.isInstancedMesh || !obj.geometry || !obj.material) return;
    if (excludeMaterials && excludeMaterials.has(obj.material)) return;
    const attrs = obj.geometry.attributes;
    if (!attrs.position || !attrs.normal || !attrs.uv) return;
    if (!buckets.has(obj.material)) {
      buckets.set(obj.material, []);
    }
    buckets.get(obj.material).push(obj);
  });

  for (const [mat, meshes] of buckets.entries()) {
    if (meshes.length < 2) continue;
    const geos = [];
    let anyCast = false;
    let anyReceive = false;

    for (const m of meshes) {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const key of Object.keys(g.attributes)) {
        if (key !== 'position' && key !== 'normal' && key !== 'uv') {
          g.deleteAttribute(key);
        }
      }
      const relMat = new THREE.Matrix4().multiplyMatrices(invRoot, m.matrixWorld);
      g.applyMatrix4(relMat);
      geos.push(g);
      if (m.castShadow) anyCast = true;
      if (m.receiveShadow) anyReceive = true;
      if (m.parent) m.parent.remove(m);
    }

    const merged = mergeGeometries(geos, false);
    if (merged) {
      const batchedMesh = new THREE.Mesh(merged, mat);
      batchedMesh.castShadow = anyCast;
      batchedMesh.receiveShadow = anyReceive;
      rootGroup.add(batchedMesh);
    }
  }
}

/**
 * Helper to convert an array of world {x, z} polygon vertices into a horizontal THREE.Shape
 * in (x, -z) space so that rotating by rotateX(-Math.PI / 2) maps (x, -z, 0) -> (x, 0, z)
 * with an upward (+Y) surface normal.
 */
function createWorldXZShape(pts) {
  const shape = new THREE.Shape();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i === 0) shape.moveTo(p.x, -p.z);
    else shape.lineTo(p.x, -p.z);
  }
  shape.closePath();
  return shape;
}

function createExtrudedPolygonMesh(pts, bottomY, height, material, receiveShadow = true, castShadow = false) {
  const shape = createWorldXZShape(pts);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 1
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, bottomY, 0);
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = receiveShadow;
  mesh.castShadow = castShadow;
  return mesh;
}

function createFlatPolygonMesh(pts, y, material, receiveShadow = true) {
  const shape = createWorldXZShape(pts);
  const geo = new THREE.ShapeGeometry(shape, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = receiveShadow;
  return mesh;
}

/**
 * Sutherland-Hodgman clip of polygon [{x, z}] to the half-plane nx * x + nz * z >= c.
 */
function clipPolygonHalfPlane(pts, nx, nz, c) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const da = nx * a.x + nz * a.z - c;
    const db = nx * b.x + nz * b.z - c;
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  return out;
}

function rectPolygon(minX, maxX, minZ, maxZ) {
  return [{ x: minX, z: minZ }, { x: maxX, z: minZ }, { x: maxX, z: maxZ }, { x: minX, z: maxZ }];
}

/**
 * Clips polygon [{x, z}] (may be concave, e.g. MANHATTAN_COASTLINE) to the inside of a convex polygon (either winding).
 * The part inside must be connected.
 */
function clipPolygonToConvex(pts, convex) {
  let area = 0;
  for (let i = 0; i < convex.length; i++) {
    const a = convex[i];
    const b = convex[(i + 1) % convex.length];
    area += a.x * b.z - b.x * a.z;
  }
  const s = area > 0 ? 1 : -1;
  let out = pts;
  for (let i = 0; i < convex.length && out.length; i++) {
    const a = convex[i];
    const b = convex[(i + 1) % convex.length];
    const nx = -s * (b.z - a.z);
    const nz = s * (b.x - a.x);
    out = clipPolygonHalfPlane(out, nx, nz, nx * a.x + nz * a.z);
  }
  return out;
}

/** Area centroid {x, z} of a simple polygon [{x, z}]. */
function polygonCentroid(pts) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const f = p.x * q.z - q.x * p.z;
    a += f;
    cx += (p.x + q.x) * f;
    cz += (p.z + q.z) * f;
  }
  return Math.abs(a) < 1e-9 ? { x: pts[0].x, z: pts[0].z } : { x: cx / (3 * a), z: cz / (3 * a) };
}

/**
 * Offsets a convex polygon outward (d > 0) or inward (d < 0) by moving each vertex along its corner bisector.
 */
function offsetConvexPolygon(pts, d) {
  const src = pts.filter((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return Math.hypot(q.x - p.x, q.z - p.z) > 0.05;
  });
  const n = src.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = src[i];
    const b = src[(i + 1) % n];
    area += a.x * b.z - b.x * a.z;
  }
  const s = area > 0 ? 1 : -1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = src[(i + n - 1) % n];
    const p1 = src[i];
    const p2 = src[(i + 1) % n];
    const l1 = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    const l2 = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const n1x = (s * (p1.z - p0.z)) / l1;
    const n1z = (-s * (p1.x - p0.x)) / l1;
    const n2x = (s * (p2.z - p1.z)) / l2;
    const n2z = (-s * (p2.x - p1.x)) / l2;
    let bx = n1x + n2x;
    let bz = n1z + n2z;
    const bl = Math.hypot(bx, bz) || 1;
    bx /= bl;
    bz /= bl;
    const cosHalf = Math.max(0.3, bx * n1x + bz * n1z);
    out.push({ x: p1.x + (bx * d) / cosHalf, z: p1.z + (bz * d) / cosHalf });
  }
  return out;
}

/**
 * Tags every vertex of a mesh using the shared park paving material with its paving style (uv.x, see
 * createParkPavingMaterial: 0 hex asphalt pavers, 1 light granite plaza pavers, 2 bluestone slabs).
 */
/**
 * A simple polygon ([{x, z}], either winding, convex or not) offset inward by d with mitred corners (miters clamped
 * to 3d); null if it collapses
 */
function offsetPolygonInward(pts, d) {
  const n = pts.length;
  if (n < 3) return null;
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  const s = area > 0 ? 1 : -1; // positive area: the inside lies left of each edge, i.e. along (-dz, dx)
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n];
    const q = pts[i];
    const r = pts[(i + 1) % n];
    let ax = q.x - p.x, az = q.z - p.z;
    let bx = r.x - q.x, bz = r.z - q.z;
    const la = Math.hypot(ax, az) || 1e-9;
    const lb = Math.hypot(bx, bz) || 1e-9;
    ax /= la; az /= la; bx /= lb; bz /= lb;
    const n1x = -az * s, n1z = ax * s; // inward normals of the two edges
    const n2x = -bz * s, n2z = bx * s;
    let mx = n1x + n2x, mz = n1z + n2z;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) { out.push({ x: q.x + n1x * d, z: q.z + n1z * d }); continue; }
    mx /= ml; mz /= ml;
    const cos = mx * n1x + mz * n1z; // miter length = d / cos(half angle)
    const len = Math.min(3 * d, d / Math.max(1e-3, cos));
    out.push({ x: q.x + mx * len, z: q.z + mz * len });
  }
  let a2 = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) a2 += out[j].x * out[i].z - out[i].x * out[j].z;
  return a2 * area > 0 && Math.abs(a2) < Math.abs(area) ? out : null;
}

function polygonCentroidArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  return a * 0.5;
}

function pointInPolygonXZ(pts, x, z) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
function polygonSignedAreaXZ(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  return a * 0.5;
}
// Do two open segments cross at an interior point? (shared endpoints & touching ends are not crossings)
function segmentsCrossXZ(a, b, c, d) {
  const o = (p, q, r) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
function ringSelfIntersects(pts) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i || j === (i + 1) % n || (j + 1) % n === i) continue;
      if (segmentsCrossXZ(a, b, pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}
// Is the fixed-band annulus (inner outline, its inward offset prop as a hole) a valid, non-self-intersecting ring?
// A concave curb island (Ward's Island Park) offsets into a self-crossing prop, and THREE's hole triangulation then
// floods the whole island with the walkway. When this returns false, city-grid builds the band as edge quads instead.
function annulusSafeXZ(inner, prop) {
  if (!prop || prop.length !== inner.length || prop.length < 3) return false;
  if (ringSelfIntersects(inner) || ringSelfIntersects(prop)) return false;
  if (Math.abs(polygonSignedAreaXZ(prop)) >= Math.abs(polygonSignedAreaXZ(inner))) return false;
  for (const p of prop) if (!pointInPolygonXZ(inner, p.x, p.z)) return false;
  return true;
}
// The fixed sidewalk band (inner outline -> its inward offset prop) as per-edge quads: a top strip plus the two low
// side faces. Equivalent to the extruded annulus for a simple ring, but it cannot flood a concave island's interior.
function walkBandGeometryXZ(inner, prop, y0, y1) {
  const A = makeAcc();
  const tri = (p, q, r, n) => {
    A.pos.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
    for (let k = 0; k < 3; k++) A.nor.push(n[0], n[1], n[2]);
    A.uv.push(p.x, -p.z, q.x, -q.z, r.x, -r.z);
  };
  const quad = (a, b, c, d, n) => {
    const gx = (p, q, r) => (q.y - p.y) * (r.z - p.z) - (q.z - p.z) * (r.y - p.y);
    const gy = (p, q, r) => (q.z - p.z) * (r.x - p.x) - (q.x - p.x) * (r.z - p.z);
    const gz = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const facing = (p, q, r) => gx(p, q, r) * n[0] + gy(p, q, r) * n[1] + gz(p, q, r) * n[2] >= 0;
    if (facing(a, b, c)) { tri(a, b, c, n); tri(a, c, d, n); } else { tri(a, c, b, n); tri(a, d, c, n); }
  };
  const s = polygonSignedAreaXZ(inner) > 0 ? 1 : -1;
  const n = inner.length;
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    const a = inner[i], b = inner[i2], c = prop[i2], d = prop[i];
    // top strip (upward)
    quad({ x: a.x, y: y1, z: a.z }, { x: b.x, y: y1, z: b.z }, { x: c.x, y: y1, z: c.z }, { x: d.x, y: y1, z: d.z }, [0, 1, 0]);
    // outer face at the inner outline (away from the island's interior)
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1e-9;
    const ox = ((b.z - a.z) / L) * s, oz = ((-(b.x - a.x)) / L) * s;
    quad({ x: a.x, y: y0, z: a.z }, { x: b.x, y: y0, z: b.z }, { x: b.x, y: y1, z: b.z }, { x: a.x, y: y1, z: a.z }, [ox, 0, oz]);
    // inner face at the prop outline (toward the island's interior)
    quad({ x: d.x, y: y0, z: d.z }, { x: c.x, y: y0, z: c.z }, { x: c.x, y: y1, z: c.z }, { x: d.x, y: y1, z: d.z }, [-ox, 0, -oz]);
  }
  return accGeometry(A);
}

// An accumulator quad whose winding is chosen so it faces `n` (points are [x, y, z]; uv = world x, -z).
function accQuadFacing(A, a, b, c, d, n) {
  const gx = (p, q, r) => (q[1] - p[1]) * (r[2] - p[2]) - (q[2] - p[2]) * (r[1] - p[1]);
  const gy = (p, q, r) => (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]);
  const gz = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const facing = (p, q, r) => gx(p, q, r) * n[0] + gy(p, q, r) * n[1] + gz(p, q, r) * n[2] >= 0;
  const push = (p, q, r) => {
    for (const v of [p, q, r]) { A.pos.push(v[0], v[1], v[2]); A.nor.push(n[0], n[1], n[2]); A.uv.push(v[0], -v[2]); }
  };
  if (facing(a, b, c)) { push(a, b, c); push(a, c, d); } else { push(a, c, b); push(a, d, c); }
}

// The fixed band for the kept edges: `keep[i]` truthy builds edge i's top strip and both side faces. Same geometry as
// walkBandGeometryXZ, so the two cannot drift. Null when no edge is kept.
function walkBandGeometryXZEdges(inner, prop, y0, y1, keep) {
  const W = makeAcc();
  const s = polygonSignedAreaXZ(inner) > 0 ? 1 : -1;
  const n = inner.length;
  for (let i = 0; i < n; i++) {
    if (keep && !keep[i]) continue;
    const i2 = (i + 1) % n;
    const a = inner[i], b = inner[i2], c = prop[i2], d = prop[i];
    // top strip (upward)
    accQuadFacing(W, [a.x, y1, a.z], [b.x, y1, b.z], [c.x, y1, c.z], [d.x, y1, d.z], [0, 1, 0]);
    // outer face at the inner outline (away from the island's interior)
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1e-9;
    const ox = ((b.z - a.z) / L) * s, oz = ((-(b.x - a.x)) / L) * s;
    accQuadFacing(W, [a.x, y0, a.z], [b.x, y0, b.z], [b.x, y1, b.z], [a.x, y1, a.z], [ox, 0, oz]);
    // inner face at the prop outline (toward the island's interior)
    accQuadFacing(W, [d.x, y0, d.z], [c.x, y0, c.z], [c.x, y1, c.z], [d.x, y1, d.z], [-ox, 0, -oz]);
  }
  return accGeometry(W);
}

// The visible kerb ring for the kept edges (the 0.25 m top strip between the outline and its inset, plus the outer
// face). Null when no edge is kept.
function kerbRingGeometryXZEdges(poly, inner, y0, y1, keep) {
  const C = makeAcc();
  const n = poly.length;
  const s = polygonSignedAreaXZ(poly) > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    if (keep && !keep[i]) continue;
    const i2 = (i + 1) % n;
    const a = poly[i], b = poly[i2], c = inner[i2], d = inner[i];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    if (L < 1e-6) continue;
    // top strip (upward) from the outline to the 0.25 m inset
    accQuadFacing(C, [a.x, y1, a.z], [b.x, y1, b.z], [c.x, y1, c.z], [d.x, y1, d.z], [0, 1, 0]);
    // outer face at the outline (away from the block's interior)
    const ox = ((b.z - a.z) / L) * s, oz = ((-(b.x - a.x)) / L) * s;
    accQuadFacing(C, [a.x, y0, a.z], [b.x, y0, b.z], [b.x, y1, b.z], [a.x, y1, a.z], [ox, 0, oz]);
  }
  return accGeometry(C);
}

// Island-only flush verge: a ramp over the flagged edges, from the road at the block outline (roadY) to the existing
// yard at the prop inset (walkY). This REPLACES the former kerb strip and walk band on those edges (the caller builds
// neither there), so no native slab side pokes through and no old curb top remains above it. The outer vertex rises to
// the kerb top at a flagged/unflagged boundary so the ramp meets the native kerb at the corner (a local approximate
// transition, not a survey). Returns the geometry to draw; vergeRampStore reads its exact Float32 triangles.
function rampGeometryXZ(poly, prop, flags, { roadY = 0, walkY = 0.22, kerbY = 0.18 } = {}) {
  const A = makeAcc();
  const n = poly.length;
  const tri = (p, q, r) => {
    A.pos.push(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2]);
    for (let k = 0; k < 3; k++) A.nor.push(0, 1, 0);
    A.uv.push(p[0], -p[2], q[0], -q[2], r[0], -r[2]);
  };
  const gy = (p, q, r) => (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]);
  // The winding is chosen on the FLOAT32 values that are serialized, not the double ones: a thin/degenerate triangle can
  // flip winding at quantization and the front-side renderer then culls it while the sampler still counted it. Each
  // triangle is normalised to face up on the quantized positions and a truly zero-area triangle is dropped.
  const f = Math.fround;
  const q = (v) => [f(v[0]), f(v[1]), f(v[2])];
  const face = (p, a, b) => { const g = gy(p, a, b); if (Math.abs(g) < 1e-12) return; if (g >= 0) tri(p, a, b); else tri(p, b, a); };
  for (let i = 0; i < n; i++) {
    if (!flags[i]) continue;
    const i2 = (i + 1) % n, prev = (i + n - 1) % n;
    const a = poly[i], b = poly[i2], d = prop[i], c = prop[i2];
    const ya = flags[prev] ? roadY : kerbY;
    const yb = flags[i2] ? roadY : kerbY;
    const P = q([a.x, ya, a.z]), Q = q([b.x, yb, b.z]), R = q([c.x, walkY, c.z]), S = q([d.x, walkY, d.z]);
    face(P, Q, R);
    face(P, R, S);
  }
  return accGeometry(A);
}

// Island verge ramp surface: the exact rendered triangles of the flush verge ramps AND the native yard triangles that
// overlap the ramp footprint at a concave corner, for the walker's ground hook. The producer fills it as it builds;
// islandVergeSurfaceAt(x, z) barycentric-samples those same triangles and returns the TOPMOST (the rendered surface).
// Empty (null everywhere) before a build or in an unsupported frame, so an unwired page is a no-op.
const VERGE_RAMP = { cell: 8, grid: new Map(), tris: [] };
function vergeRampReset() { VERGE_RAMP.grid.clear(); VERGE_RAMP.tris.length = 0; }
function vergeRampIndex(P, Q, R, id, kind) {
  const k = VERGE_RAMP.tris.push({ P, Q, R, id, kind }) - 1;
  const cell = VERGE_RAMP.cell;
  const minX = Math.min(P[0], Q[0], R[0]), maxX = Math.max(P[0], Q[0], R[0]);
  const minZ = Math.min(P[2], Q[2], R[2]), maxZ = Math.max(P[2], Q[2], R[2]);
  for (let ix = Math.floor(minX / cell); ix <= Math.floor(maxX / cell); ix++) {
    for (let iz = Math.floor(minZ / cell); iz <= Math.floor(maxZ / cell); iz++) {
      const key = ix * 100000 + iz;
      let list = VERGE_RAMP.grid.get(key);
      if (!list) VERGE_RAMP.grid.set(key, (list = []));
      list.push(k);
    }
  }
}
// Store the geometry's exact rendered triangles (its Float32 position array), so the sampler returns the same values
// the mesh draws, not a higher-precision recomputation.
function vergeRampStore(geometry, id) {
  if (!geometry) return;
  const p = geometry.attributes.position.array;
  for (let i = 0; i + 8 < p.length; i += 9) {
    vergeRampIndex([p[i], p[i + 1], p[i + 2]], [p[i + 3], p[i + 4], p[i + 5]], [p[i + 6], p[i + 7], p[i + 8]], id, 'ramp');
  }
}
// Store the upward-facing triangles of a kept native surface (the walk band top, the kerb top) that can overlap the
// ramp at a corner, so the sampler returns the topmost rendered surface there.
function vergeTopStore(geometry, id, kind) {
  if (!geometry) return;
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const p = g.attributes.position.array, n = g.attributes.normal.array;
  for (let i = 0; i + 8 < p.length; i += 9) {
    if ((n[i + 1] + n[i + 4] + n[i + 7]) / 3 < 0.9) continue;
    vergeRampIndex([p[i], p[i + 1], p[i + 2]], [p[i + 3], p[i + 4], p[i + 5]], [p[i + 6], p[i + 7], p[i + 8]], id, kind);
  }
  if (g !== geometry) g.dispose();
}
// Store the native yard's top triangles (its actual Float32 positions) for a verge block. A centroid test is not a
// valid triangle-overlap test (a triangle whose centroid is inside prop can still cross the ramp), so every top
// triangle is stored; the query's `hasRamp` gate keeps the sampler scoped to the ramp footprint.
function vergeYardStore(geometry, id) {
  if (!geometry) return;
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const p = g.attributes.position.array, n = g.attributes.normal.array;
  for (let i = 0; i + 8 < p.length; i += 9) {
    if ((n[i + 1] + n[i + 4] + n[i + 7]) / 3 < 0.9) continue;
    vergeRampIndex([p[i], p[i + 1], p[i + 2]], [p[i + 3], p[i + 4], p[i + 5]], [p[i + 6], p[i + 7], p[i + 8]], id, 'yard');
  }
  if (g !== geometry) g.dispose();
}
// The exact flush-verge height at (x, z), barycentric-sampled from the built ramp triangles, or null elsewhere. Where
// the native yard overlaps the ramp footprint (a concave corner) the TOPMOST rendered surface wins, so the sampler
// matches the actual ground. This is the contract for the walker's ground hook (report to the captain; do not wire
// here): controllers.js getGroundHeight should consult it after sportsGround and before the deck query, so higher
// decks still win.
function islandVergeSurfaceAt(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const list = VERGE_RAMP.grid.get(Math.floor(x / VERGE_RAMP.cell) * 100000 + Math.floor(z / VERGE_RAMP.cell));
  if (!list) return null;
  let best = null, hasRamp = false;
  for (const k of list) {
    const { P, Q, R, id, kind } = VERGE_RAMP.tris[k];
    const den = (Q[2] - R[2]) * (P[0] - R[0]) + (R[0] - Q[0]) * (P[2] - R[2]);
    if (Math.abs(den) < 1e-12) continue;
    const l1 = ((Q[2] - R[2]) * (x - R[0]) + (R[0] - Q[0]) * (z - R[2])) / den;
    const l2 = ((R[2] - P[2]) * (x - R[0]) + (P[0] - R[0]) * (z - R[2])) / den;
    const l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
    if (kind === 'ramp') hasRamp = true;
    const h = l1 * P[1] + l2 * Q[1] + l3 * R[1];
    // (adjacent ramp quads overlap at the prop edge, and the native yard can overlap at a concave corner: the rendered
    // topmost surface is the raycast's first hit)
    if (!best || h > best.h) best = { h, kind, id, u: l1, v: l2, w: l3 };
  }
  return hasRamp ? best : null;
}
function islandVergeRampStats() {
  return { triangles: VERGE_RAMP.tris.length, cells: VERGE_RAMP.grid.size };
}

// Island-only: the per-edge grass flags for a block's inner outline, from the pure verge gate in
// js/waterfront-island-lanes.js. Null when the gate is absent (mainland pages, tests that do not load it) or when no
// edge is source-confirmed, so the native concrete band and stone kerb are kept byte for byte.
function islandVergeFlags(inner) {
  const gate = window.CITY.islandVergeEdgeMaterial;
  if (!gate) return null;
  const n = inner.length;
  const s = polygonSignedAreaXZ(inner) > 0 ? 1 : -1;
  const flags = new Uint8Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    const a = inner[i], b = inner[i2];
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1e-9;
    const ox = ((b.z - a.z) / L) * s, oz = ((-(b.x - a.x)) / L) * s;
    if (gate(a.x, a.z, b.x, b.z, ox, oz)) { flags[i] = 1; any = true; }
  }
  return any ? flags : null;
}

// Do two simple polygons overlap? Conservative and exact for the shapes here: a vertex of one inside the other, or any
// pair of edges crossing. (A shared boundary counts as overlap, which is the safe answer for the verge decision.)
function polygonsOverlapXZ(a, b) {
  for (const p of a) if (pointInPolygonXZ(b, p.x, p.z)) return true;
  for (const p of b) if (pointInPolygonXZ(a, p.x, p.z)) return true;
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i], a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      if (segmentsCrossXZ(a1, a2, b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return false;
}

// The yard outline for a block that has BOTH City sidewalks and source-confirmed lane edges: the yard runs to the inner
// outline on the retained (unflagged) edges, exactly as a City-sidewalk block did before, and is cut back to the prop
// inset only on the flagged edges so the flush ramp is visible. This keeps the original yard material on the untouched
// bands (no new concrete strip) while the ramp replaces the kerb/band on the lane edges.
function mixedYardOutline(inner, prop, flags) {
  const n = inner.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = flags[(i + n - 1) % n];
    const cur = flags[i];
    if (prev !== cur) {
      out.push(prev ? prop[i] : inner[i]);
      out.push(cur ? prop[i] : inner[i]);
    } else {
      out.push(cur ? prop[i] : inner[i]);
    }
  }
  return out;
}

// Does a City sidewalk piece overlap the ramp footprint of edge i (the quad from the block outline to the prop inset)?
// The City's polygons are clipped to the island slab, so this is an exact polygon/quad overlap, not a sample guess: a
// narrow or offset piece that crosses the ramp between sample points is still caught. Used to keep the native concrete
// walk on the edges the City maps, while the source-confirmed unmarked-lane edges the City does NOT map still get the
// flush verge (the captain's Third Street left edge: block 2887's City sidewalks are on its far side, not on the lane).
function cityWalkOverlapsEdge(poly, prop, i, walks) {
  if (!walks || !walks.length) return false;
  const n = poly.length;
  const i2 = (i + 1) % n;
  const quad = [poly[i], poly[i2], prop[i2], prop[i]];
  let qminX = Infinity, qmaxX = -Infinity, qminZ = Infinity, qmaxZ = -Infinity;
  for (const p of quad) { qminX = Math.min(qminX, p.x); qmaxX = Math.max(qmaxX, p.x); qminZ = Math.min(qminZ, p.z); qmaxZ = Math.max(qmaxZ, p.z); }
  for (const piece of walks) {
    const pts = piece.outer;
    let pminX = Infinity, pmaxX = -Infinity, pminZ = Infinity, pmaxZ = -Infinity;
    for (const p of pts) { pminX = Math.min(pminX, p.x); pmaxX = Math.max(pmaxX, p.x); pminZ = Math.min(pminZ, p.z); pmaxZ = Math.max(pmaxZ, p.z); }
    if (qmaxX < pminX || qminX > pmaxX || qmaxZ < pminZ || qminZ > pmaxZ) continue; // bbox reject
    if (polygonsOverlapXZ(quad, pts)) return true;
  }
  return false;
}

// --- Toronto layer: polygon intersection for the small parks' lawns & paths (city-grid.js, 2. CURB ISLANDS). Both
// polygons are cut into triangles and every overlapping pair clipped (Sutherland-Hodgman, convex by convex): the
// pieces are convex polygons [[x, z], ...] covering exactly the overlap, whatever the two outlines' shapes ---
function trianglesXZ(pts) { // [{x, z}] (or [[x, z]]) -> [[[x, z] x 3] with a positive (x, z) cross product, bounds]
  const v = pts.map((p) => (Array.isArray(p) ? new THREE.Vector2(p[0], p[1]) : new THREE.Vector2(p.x, p.z)));
  const out = [];
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(v, [])) {
    let a = v[i], b = v[j], c = v[k];
    const cr = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cr) < 1e-6) continue;
    if (cr < 0) [b, c] = [c, b];
    const t = [[a.x, a.y], [b.x, b.y], [c.x, c.y]];
    t.x0 = Math.min(a.x, b.x, c.x); t.x1 = Math.max(a.x, b.x, c.x);
    t.z0 = Math.min(a.y, b.y, c.y); t.z1 = Math.max(a.y, b.y, c.y);
    out.push(t);
  }
  return out;
}
function clipConvex(subject, clip) { // both convex with a positive (x, z) cross product
  let out = subject;
  for (let e = 0; e < clip.length && out.length; e++) {
    const [px, pz] = clip[e], [qx, qz] = clip[(e + 1) % clip.length];
    const side = (p) => (qx - px) * (p[1] - pz) - (qz - pz) * (p[0] - px);
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i], b = input[(i + 1) % input.length];
      const sa = side(a), sb = side(b);
      if (sa >= 0) out.push(a);
      if ((sa >= 0) !== (sb >= 0)) {
        const t = sa / (sa - sb);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
  }
  return out.length >= 3 ? out : null;
}
function intersectXZ(trisA, trisB) {
  const out = [];
  for (const a of trisA) {
    for (const b of trisB) {
      if (a.x1 < b.x0 || a.x0 > b.x1 || a.z1 < b.z0 || a.z0 > b.z1) continue;
      const piece = clipConvex(a, b);
      if (piece) out.push(piece);
    }
  }
  return out;
}
/** Flat, upward-facing geometry (position, normal, uv) of convex pieces [[x, z], ...] at height y */
function flatPiecesGeometry(pieces, y) {
  const pos = [];
  for (const p of pieces) {
    for (let i = 1; i + 1 < p.length; i++) pos.push(p[0][0], y, p[0][1], p[i + 1][0], y, p[i + 1][1], p[i][0], y, p[i][1]);
  }
  if (!pos.length) return null;
  const n = pos.length / 3, nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { nor[3 * i + 1] = 1; uv[2 * i] = pos[3 * i]; uv[2 * i + 1] = -pos[3 * i + 2]; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Polygon offset by d (d > 0 inward, d < 0 outward), mitred corners clamped to 3|d|; null if it degenerates */
function offsetPolygon(pts, d) {
  if (d > 0) return offsetPolygonInward(pts, d);
  const n = pts.length;
  if (n < 3) return null;
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
  const s = area > 0 ? -1 : 1; // outward normal side
  const D = -d;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n], q = pts[i], r = pts[(i + 1) % n];
    let ax = q.x - p.x, az = q.z - p.z, bx = r.x - q.x, bz = r.z - q.z;
    const la = Math.hypot(ax, az) || 1e-9, lb = Math.hypot(bx, bz) || 1e-9;
    ax /= la; az /= la; bx /= lb; bz /= lb;
    const n1x = -az * s, n1z = ax * s, n2x = -bz * s, n2z = bx * s;
    let mx = n1x + n2x, mz = n1z + n2z;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) { out.push({ x: q.x + n1x * D, z: q.z + n1z * D }); continue; }
    mx /= ml; mz /= ml;
    const len = Math.min(3 * D, D / Math.max(1e-3, mx * n1x + mz * n1z));
    out.push({ x: q.x + mx * len, z: q.z + mz * len });
  }
  return out;
}

function setPavingStyle(geo, style) {
  const uvAttr = geo.attributes.uv;
  for (let i = 0; i < uvAttr.count; i++) uvAttr.setXY(i, style, 0);
  uvAttr.needsUpdate = true;
  return geo;
}

/**
 * Vertical alpha-tested iron fence strips (createIronFenceMaterial) along segments [[x1, z1, x2, z2], ...]:
 * uv.x = metres along the run, uv.y = 0 (bottom) .. 1 (top).
 */
function buildFenceStripGeometry(segments, y0, h) {
  const pos = [];
  const nor = [];
  const uvs = [];
  for (const [x1, z1, x2, z2] of segments) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 0.4) continue;
    const nx = -(z2 - z1) / len;
    const nz = (x2 - x1) / len;
    const corners = [[x1, z1, 0, 0], [x2, z2, len, 0], [x2, z2, len, 1], [x1, z1, 0, 0], [x2, z2, len, 1], [x1, z1, 0, 1]];
    for (const [x, z, u, v] of corners) {
      pos.push(x, y0 + v * h, z);
      nor.push(nx, 0, nz);
      uvs.push(u, v);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

/**
 * Closed polygon outline -> fence segments, skipping the stretches within `gapR` of any gate point {x, z}.
 */
function polygonFenceSegments(pts, gates = [], gapR = 2.0, step = 1.0) {
  const segs = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.round(len / step));
    let runStart = null;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const open = gates.some((g) => Math.hypot(g.x - x, g.z - z) < gapR);
      if (!open && runStart === null) runStart = { x, z };
      if ((open || k === n) && runStart !== null) {
        if (Math.hypot(x - runStart.x, z - runStart.z) > 0.4) segs.push([runStart.x, runStart.z, x, z]);
        runStart = null;
      }
    }
  }
  return segs;
}


// Deterministic 0..1 hash of two numbers
const hash2 = (a, b) => {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

// Merged-geometry accumulator: position, normal, uv (+ optional per-vertex colour & one scalar attribute)
function makeAcc(withColor = false, extra = null) {
  return { pos: [], nor: [], uv: [], col: withColor ? [] : null, extra, ext: extra ? [] : null };
}
function accQuad(A, p0, p1, p2, p3, n, uvs, col, ext) {
  for (const i of [0, 1, 2, 0, 2, 3]) {
    const p = [p0, p1, p2, p3][i];
    A.pos.push(p[0], p[1], p[2]);
    A.nor.push(n[0], n[1], n[2]);
    A.uv.push(uvs[i][0], uvs[i][1]);
    if (A.col) A.col.push(col[0], col[1], col[2]);
    if (A.ext) A.ext.push(ext);
  }
}
function accGeometry(A) {
  if (!A.pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(A.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(A.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(A.uv, 2));
  if (A.col) g.setAttribute('color', new THREE.Float32BufferAttribute(A.col, 3));
  if (A.ext) g.setAttribute(A.extra, new THREE.Float32BufferAttribute(A.ext, 1));
  return g;
}
// A vertical wall slab from (ax, az) to (bx, bz): both faces, the ends and the top; uv = (metres along, metres up)
function accWall(A, ax, az, bx, bz, y0, h, t, col) {
  const L = Math.hypot(bx - ax, bz - az);
  if (L < 0.05) return;
  const ux = (bx - ax) / L, uz = (bz - az) / L;
  const nx = -uz * t * 0.5, nz = ux * t * 0.5;
  const y1 = y0 + h;
  const P = (x, y, z) => [x, y, z];
  const a0 = P(ax + nx, y0, az + nz), b0 = P(bx + nx, y0, bz + nz), b1 = P(bx + nx, y1, bz + nz), a1 = P(ax + nx, y1, az + nz);
  const c0 = P(ax - nx, y0, az - nz), d0 = P(bx - nx, y0, bz - nz), d1 = P(bx - nx, y1, bz - nz), c1 = P(ax - nx, y1, az - nz);
  const side = [[0, 0], [L, 0], [L, h], [0, h]];
  accQuad(A, a0, b0, b1, a1, [-uz, 0, ux], side, col, h);
  accQuad(A, d0, c0, c1, d1, [uz, 0, -ux], side.map(([u, v]) => [L - u, v]), col, h);
  accQuad(A, a1, b1, d1, c1, [0, 1, 0], [[0, h], [L, h], [L, h], [0, h]], col, h);
  accQuad(A, c0, a0, a1, c1, [-ux, 0, -uz], [[0, 0], [t, 0], [t, h], [0, h]], col, h);
  accQuad(A, b0, d0, d1, b1, [ux, 0, uz], [[0, 0], [t, 0], [t, h], [0, h]], col, h);
}

// Toronto's mapped walls: poured concrete, limestone & red-brown brick (sRGB hex)
const WALL_PAINTS = [0xb9b4aa, 0xa8a49c, 0xc9c0ae, 0xd6ccb6, 0x9a5a44, 0x86513f, 0xb7b0a3];
const rgb = (hex) => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

// The street level's material with its asphalt dropped over the water: GEO.waterMask's row runs (dry / wet, from dry)
// decoded into a linear-filtered texture over the city, discarded above one half
function maskedByWater(mat, M) {
  const { Fn, If, Discard, texture, positionWorld, vec2 } = window.CITY.TSL;
  const bin = atob(M.runs);
  const runs = new Uint16Array(bin.length / 2);
  for (let i = 0; i < runs.length; i++) runs[i] = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
  const data = new Uint8Array(M.w * M.h);
  let k = 0;
  for (let j = 0; j < M.h; j++) {
    let i = 0, v = 0;
    while (i < M.w) {
      const n = runs[k++];
      if (v) data.fill(255, j * M.w + i, j * M.w + i + n);
      i += n;
      v ^= 1;
    }
    if (v === 0 && runs[k] === 0) k++; // a row that ended wet carries a closing empty dry run
  }
  const tex = new THREE.DataTexture(data, M.w, M.h, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const base = mat.colorNode;
  mat.colorNode = Fn(() => {
    const uv = positionWorld.xz.sub(vec2(M.x0, M.z0)).div(vec2(M.w * M.res, M.h * M.res));
    If(texture(tex, uv).r.greaterThan(0.5), () => { Discard(); });
    return base;
  })();
  return mat;
}

// The road cuts (city-config.js ROAD_CUTS) and the subway's open cuts (subway.js SUBWAY_CUT_RECTS: Line 2's trenches
// in the west end) masked out of a street-level material: its fragments over a cut are discarded (in the shadow maps
// too), city-grid.js & subway.js build the cuts in their place. Each an oblong: t along (ux, uz) from (x0, z0) to len,
// l across from l0 to l1. A road cut's polyline axis gives one oblong per straight run (its segments merged while they
// turn less than 2 degrees), each run a little past its joints so a bend leaves no gap
function cutRects() {
  const out = [];
  for (const c of ROAD_CUTS) {
    let run = null;
    const flush = (last) => {
      if (!run) return;
      const L = Math.hypot(run.b.x - run.a.x, run.b.z - run.a.z) || 1e-6, ux = (run.b.x - run.a.x) / L, uz = (run.b.z - run.a.z) / L;
      const e0 = run.first ? 0 : 1.5, e1 = last ? 0 : 1.5;
      out.push({ x0: run.a.x - ux * e0, z0: run.a.z - uz * e0, ux, uz, len: L + e0 + e1, l0: -c.half, l1: c.half });
    };
    c.segs.forEach((g, k) => {
      if (run && Math.abs(Math.atan2(g.ux * run.uz - g.uz * run.ux, g.ux * run.ux + g.uz * run.uz)) < 0.035) { run.b = g.b; return; }
      flush(false);
      run = { a: g.a, b: g.b, ux: g.ux, uz: g.uz, first: k === 0 };
    });
    flush(true);
  }
  return [...out, ...(window.CITY.SUBWAY_CUT_RECTS || [])];
}
// The road cuts' grassed banks (city-config.js cutBankAt) as a mask texture over their footprint, 0.5 m a texel (their
// outline curves and narrows where a bank is cut short: no oblong fits), grown a texel so no street level shows over
// a bank's edge (the bank's lawn strip along its top covers the rest)
let bankMask;
function cutBankMask() {
  if (bankMask !== undefined) return bankMask;
  bankMask = null;
  const cuts = ROAD_CUTS.filter((c) => c.bankSt && c.maxBank > 0);
  if (!cuts.length) return bankMask;
  const R = 0.5;
  const x0 = Math.min(...cuts.map((c) => c.box.x0)) - 1, z0 = Math.min(...cuts.map((c) => c.box.z0)) - 1;
  const W = Math.ceil((Math.max(...cuts.map((c) => c.box.x1)) + 1 - x0) / R), H = Math.ceil((Math.max(...cuts.map((c) => c.box.z1)) + 1 - z0) / R);
  const on = new Uint8Array(W * H);
  for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
    const x = x0 + (i + 0.5) * R, z = z0 + (j + 0.5) * R;
    for (const c of cuts) {
      const p = cutLocal(c, x, z);
      if (p && p.bank && cutBankAt(c, p.s, p.l >= 0 ? 1 : -1).w > 0) { on[j * W + i] = 1; break; }
    }
  }
  const data = new Uint8Array(W * H);
  for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
    let v = 0;
    for (let b = -1; b <= 1 && !v; b++) for (let a = -1; a <= 1; a++) if (on[(j + b) * W + i + a]) { v = 255; break; }
    data[j * W + i] = v;
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  bankMask = { tex, x0, z0, w: W * R, h: H * R };
  return bankMask;
}
function maskRoadCuts(mat) {
  const rects = cutRects();
  if (!rects.length || !mat || !mat.isNodeMaterial || mat.userData.roadCutMask) return mat;
  const { positionWorld, vec2, dot } = window.CITY.TSL;
  let inside = null;
  for (const c of rects) {
    const d = positionWorld.xz.sub(vec2(c.x0, c.z0));
    const t = dot(d, vec2(c.ux, c.uz)), l = dot(d, vec2(-c.uz, c.ux));
    const inC = t.greaterThan(0.0).and(t.lessThan(c.len)).and(l.greaterThan(c.l0)).and(l.lessThan(c.l1));
    inside = inside ? inside.or(inC) : inC;
  }
  const bm = cutBankMask();
  if (bm) {
    const { texture } = window.CITY.TSL;
    const onBank = texture(bm.tex, positionWorld.xz.sub(vec2(bm.x0, bm.z0)).div(vec2(bm.w, bm.h))).r.greaterThan(0.5);
    inside = inside.or(onBank);
  }
  mat.maskNode = mat.maskNode ? mat.maskNode.and(inside.not()) : inside.not();
  mat.userData.roadCutMask = true;
  return mat;
}

function buildCityGrid(scene) {
  vergeRampReset(); // (the exact verge surface is rebuilt with the ground; empty before this and in an unsupported frame)
  const group = new THREE.Group();
  group.name = 'CityGround';
  const footprints = []; // ground obstacles traffic & pedestrians keep clear of
  const colliders = []; // player colliders (flyover piers)
  const SW = GEO.frame.sidewalk;
  const SW_TOP = CITY_BOUNDS.sidewalkHeight;
  // The visible kerb's top (the native kerb extrusion is 0.18 m). The flush ramp uses it at a flagged edge's end so it
  // meets the native kerb exactly; there it is KERB_TOP below SW_TOP, so the ramp never overlays a kept walk band.
  const KERB_TOP = 0.18;
  // Per-edge keep mask for the native kerb ring / walk band: 1 where the edge is NOT a source-confirmed verge.
  const keepMask = (n, verge) => { const k = new Uint8Array(n); for (let i = 0; i < n; i++) k[i] = verge[i] ? 0 : 1; return k; };
  const inside = (pts, m = 0) => pts.every((p) => p.x > CITY_BOUNDS.minX + m && p.x < CITY_BOUNDS.maxX - m && p.z > CITY_BOUNDS.minZ + m && p.z < CITY_BOUNDS.maxZ - m);

  // ===================================================================================================================
  // 1. STREET LEVEL: asphalt over the detailed city (y = 0), open over the lakes & reservoirs
  // ===================================================================================================================
  const roadMat = createRoadSurfaceMaterial();
  const lakes = WATER_BODIES.filter((w) => w.pts.length >= 3 && inside(w.pts, 5));
  // Lake Ontario runs far out past the city: the street level drops its asphalt wherever the build's water mask is set
  // (GEO.waterMask, 4 m cells), so the lake & its islands need no holes cut in it
  const bigLakes = WATER_BODIES.filter((w) => w.pts.length >= 3 && !inside(w.pts, 5) && w.holes && w.holes.length);
  const B = CITY_BOUNDS;
  const clipToCity = (pts) => {
    let c = pts;
    c = clipPolygonHalfPlane(c, 1, 0, B.minX + 1);
    c = clipPolygonHalfPlane(c, -1, 0, -(B.maxX - 1));
    c = clipPolygonHalfPlane(c, 0, 1, B.minZ + 1);
    c = clipPolygonHalfPlane(c, 0, -1, -(B.maxZ - 1));
    return c;
  };
  const streetMat = GEO.waterMask ? maskedByWater(createRoadSurfaceMaterial(), GEO.waterMask) : roadMat;
  window.CITY.applyIslandLaneRoadMaterial?.(streetMat);
  {
    const shape = createWorldXZShape(rectPolygon(CITY_BOUNDS.minX, CITY_BOUNDS.maxX, CITY_BOUNDS.minZ, CITY_BOUNDS.maxZ));
    for (const w of lakes) shape.holes.push(new THREE.Path(w.pts.map((p) => new THREE.Vector2(p.x, -p.z))));
    const geo = new THREE.ShapeGeometry(shape, 1);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, streetMat);
    m.receiveShadow = true;
    m.name = 'StreetLevel';
    group.add(m);
  }

  // Lakes: the water a little below street level, inside earth banks
  const waterMat = createWaterMaterial();
  const lakeMat = createWaterMaterial({ pond: 0 }); // open water: Lake Ontario & the harbour
  const bankMat = new THREE.MeshStandardNodeMaterial({ color: 0x6f4a32, roughness: 0.95, side: THREE.DoubleSide });
  {
    const bank = makeAcc();
    // a ring's banks: earth from under the water up to the street level, but not along the city's edge nor between two
    // waters (the Humber's mouth into the lake: city-config.js bankBetween)
    const onEdge = (p) => Math.abs(p.x - B.minX) < 1.5 || Math.abs(p.x - B.maxX) < 1.5 || Math.abs(p.z - B.minZ) < 1.5 || Math.abs(p.z - B.maxZ) < 1.5;
    const banks = (ring) => {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const L = Math.hypot(b.x - a.x, b.z - a.z);
        if (L < 0.01 || (onEdge(a) && onEdge(b)) || !bankBetween(a, b)) continue;
        const n = [-(b.z - a.z) / L, 0, (b.x - a.x) / L];
        accQuad(bank, [a.x, -2.5, a.z], [b.x, -2.5, b.z], [b.x, SW_TOP, b.z], [a.x, SW_TOP, a.z], n, [[0, 0], [L, 0], [L, 1], [0, 1]]);
      }
    };
    const flatGeometry = (pts, holes = []) => {
      const shape = createWorldXZShape(pts);
      for (const h of holes) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, -p.z))));
      const g = new THREE.ShapeGeometry(shape, 1);
      g.rotateX(-Math.PI / 2);
      g.translate(0, CITY_BOUNDS.waterLevel, 0);
      return g;
    };
    // the water running out over the city's edge (city-config.js EDGE_WATERS), cut to it: the rivers & channels that
    // open into the lake are the lake's own water (one mesh, so the Humber's mouth has no seam), the rest ponds
    const openWater = EDGE_WATERS.filter((e) => e.open).map((e) => flatGeometry(e.pts));
    for (const e of EDGE_WATERS) {
      if (!e.open) group.add(createFlatPolygonMesh(e.pts, CITY_BOUNDS.waterLevel, waterMat, true));
      banks(e.pts);
    }
    for (const w of bigLakes) {
      // the lake with its islands as holes, out to the horizon
      const g = flatGeometry(w.pts, w.holes.map((h) => h.pts));
      const m = new THREE.Mesh(openWater.length ? mergeGeometries([g, ...openWater.splice(0)], false) : g, lakeMat);
      m.receiveShadow = true;
      m.name = 'LakeOntario';
      group.add(m);
      // banks along the shore inside the city and round the islands
      for (const ring of [clipToCity(w.pts), ...w.holes.filter((h) => inside(h.pts, 0)).map((h) => h.pts)]) banks(ring);
    }
    // (High Park's ponds stand at their own levels, js/don-valley.js pondLevel, and the pilot draws their low
    // banks from its own ground; the drape leaves them level: PilotPond)
    const PILOT = window.CITY.DON_VALLEY || null;
    for (const w of lakes) {
      const level = PILOT && PILOT.pondLevel ? PILOT.pondLevel(w) : null;
      if (level !== null) {
        const m = createFlatPolygonMesh(w.pts, level, waterMat, true);
        m.name = 'PilotPond';
        group.add(m);
        continue;
      }
      group.add(createFlatPolygonMesh(w.pts, CITY_BOUNDS.waterLevel, waterMat, true));
      banks(w.pts);
    }
    const g = accGeometry(bank);
    if (g) group.add(new THREE.Mesh(g, bankMat));
  }

  // ===================================================================================================================
  // 2. CURB ISLANDS: kerbstones, the walkway & verge strip (SW = 4.6 m) inside the kerb, and inside the property line
  //    the plots: concrete downtown, front lawns among the houses, parkland or open land. Medians: kerbed & grassed.
  // ===================================================================================================================
  const sidewalkMat = createSidewalkMaterial();
  const curbMat = createCurbMaterial();
  const lawnMat = createParkLawnMaterial(false);
  const plotMat = createPlotGroundMaterial();
  window.CITY.applyIslandYardMaterial?.(plotMat);
  window.CITY.applyWaterfrontBeachGroundMask?.(lawnMat);
  window.CITY.applyWaterfrontIslandGroundMask?.(lawnMat);
  window.CITY.applyWaterfrontBeachLandscapeGroundMask?.(lawnMat);
  window.CITY.applyWaterfrontHtoLandscapeGroundMask?.(lawnMat);
  window.CITY.applyWaterfrontIslandAccessGroundMask?.(lawnMat);
  const wildMat = createTerrainMaterial();
  const blockSidewalks = []; // { cx, cz, w, d, block, cover } axis-aligned cover of each island (street-details.js)
  const roadSidewalks = []; // rectangles inside the curbs that bound the roads (road-network.js)
  const geos = { curb: [], walk: [], lawn: [], plot: [], wild: [], paved: [], rail: [], lanes: [] };
  // --- Toronto layer: the Distillery District's lanes (Trinity St, Gristmill, Tank House & Case Goods Lanes) are paving
  // bricks & setts, not concrete: its whole block inside the sidewalks, in their own material (one draw; st-01vq.9) ---
  const distillerySite = window.CITY.LANDMARK_SITES && window.CITY.LANDMARK_SITES.distillery;
  const distilleryBlock = distillerySite && window.CITY.createLanePavingMaterial ? blockAt(distillerySite.x, distillerySite.z) : null;
  // Downtown is concrete to the building line: the core from Spadina to Parliament between the lake & Bloor, and
  // anywhere else a block holds towers or big buildings. Houses keep their front lawns.
  const blockBuilt = new Map(); // block -> { n, area, top, matchedN, matchedArea, matchedTop, matchedResidentialN }
  for (const bl of GEO.buildings) {
    const b = blockAt(bl[0], bl[1]);
    if (!b) continue;
    let area = 0;
    for (const [u0, u1, v0, v1] of bl[3]) area += (u1 - u0) * (v1 - v0);
    const s = blockBuilt.get(b) || { n: 0, area: 0, top: 0, matchedN: 0, matchedArea: 0, matchedTop: 0, matchedResidentialN: 0 };
    s.n++;
    s.area += area;
    // Use the same sourced island height as the building renderer; inherited
    // tower defaults must not turn cottage yards into downtown concrete. Only a profile that passed the active-frame
    // and footprint identity guard counts as evidence (a reshaped/missing record or a wrong frame is a no-op).
    const prof = window.CITY.islandBuildingProfile?.(bl);
    if (prof) {
      s.matchedN++;
      s.matchedArea += area;
      s.matchedTop = Math.max(s.matchedTop, prof.height);
      if (prof.typology === 'cottage' || /^residential/.test(prof.category || '')) s.matchedResidentialN++;
      s.top = Math.max(s.top, prof.height);
    } else {
      s.top = Math.max(s.top, bl[4]);
    }
    blockBuilt.set(b, s);
  }
  const isPaved = (b) => {
    if (b.cx > -1150 && b.cx < 1500 && b.cz > -2750 && b.cz < 650) return true;
    const s = blockBuilt.get(b);
    if (!s) return false;
    // Island residential blocks: the validated source-matched cottage profiles are the evidence. Inherited tall rows
    // that did not match the OSM footprints (the massing's generic tower defaults) must not turn a cottage yard into
    // downtown concrete. Only the matched heights decide, so a genuinely tall matched building still paves the block.
    if (s.matchedN >= 3 && s.matchedResidentialN >= s.matchedN * 0.6) {
      return s.matchedTop >= 20 || (s.matchedTop >= 14 && s.matchedArea / s.matchedN >= 1500);
    }
    // (the massing merges a row of houses into one long footprint: only height tells them from a block of offices)
    return s.top >= 20 || (s.top >= 14 && s.area / s.n >= 1500);
  };
  const extrude = (shape, y0, h) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 1 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, y0, 0);
    return g;
  };
  const flatShape = (pts, y) => {
    const g = new THREE.ShapeGeometry(createWorldXZShape(pts), 1);
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
    return g;
  };
  // --- Toronto layer: the medians the streetcars run along (Spadina Ave's & Queens Quay's rights-of-way, GEO.rails)
  // are paved, not grassed (after aalghooneh/slop-toronto) ---
  const tramMedians = new Set();
  for (const [kind, , , flags, flat] of GEO.rails || []) {
    if (kind !== 0 || flags & 2) continue;
    for (let i = 2; i < flat.length; i += 2) {
      const ax = flat[i - 2], az = flat[i - 1], bx = flat[i], bz = flat[i + 1];
      const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 4);
      for (let k = 0; k <= steps; k++) {
        const b = blockAt(ax + ((bx - ax) * k) / steps, az + ((bz - az) * k) / steps);
        if (b && b.median) tramMedians.add(b);
      }
    }
  }
  // ...and the rail lands (the Union Station Rail Corridor & its yards: islands mostly covered by heavy-rail tracks,
  // ~4.5 m of land per metre of track) are a gravel bed under the tracks rail-corridor.js lays, not lawn or paving
  const railLen = new Map();
  for (const [kind, , , flags, flat] of GEO.rails || []) {
    if (kind !== 1 || flags & 2) continue;
    for (let i = 2; i < flat.length; i += 2) {
      const ax = flat[i - 2], az = flat[i - 1], bx = flat[i], bz = flat[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      const steps = Math.ceil(L / 4);
      for (let k = 0; k < steps; k++) {
        const b = blockAt(ax + ((bx - ax) * (k + 0.5)) / steps, az + ((bz - az) * (k + 0.5)) / steps);
        if (b && !b.median) railLen.set(b, (railLen.get(b) || 0) + L / steps);
      }
    }
  }
  // (a quarter covered, or a tenth where the island holds few buildings: the corridor's big islands round Union)
  const isRailLand = (b) => {
    const cover = ((railLen.get(b) || 0) * 4.5) / b.area;
    const built = blockBuilt.get(b);
    return cover > 0.25 || (cover > 0.1 && (built ? built.n : 0) < (b.area / 10000) * 1.5);
  };
  // The small parks: a parkette is a corner of an island that is mostly not park (Ritchie Avenue Parkette is a tenth
  // of its island), and the island's yard (concrete downtown, front yards elsewhere) used to run over it. Each park
  // outline on such an island gets its lawn, cut to the island's yard; the paths that cross it (GEO.parkPaths) in
  // concrete; and a few trees, each in a ring of mulch (the trees: window.CITY.parketteTrees, planted by
  // street-details.js). All in the materials the islands already use.
  const parksOn = new Map(); // block -> the park outlines over it
  for (const a of window.CITY.AREAS) {
    if (a.kind !== 'park') continue;
    for (const b of window.CITY.blocksInRect(a.minX, a.maxX, a.minZ, a.maxZ)) {
      if (b.median || b.park > 0.6 || b.maxX < a.minX || b.minX > a.maxX || b.maxZ < a.minZ || b.minZ > a.maxZ) continue;
      if (!parksOn.has(b)) parksOn.set(b, []);
      parksOn.get(b).push(a);
    }
  }
  const cellKey = (x, z, c) => Math.floor(x / c) * 100003 + Math.floor(z / c);
  const gridAdd = (g, k, v) => { const l = g.get(k); if (l) l.push(v); else g.set(k, [v]); };
  const pathGrid = new Map(); // 20 m cells -> [x0, z0, x1, z1, half width]
  for (const [w, ...flat] of GEO.parkPaths || []) {
    for (let i = 2; i < flat.length; i += 2) {
      const seg = [flat[i - 2], flat[i - 1], flat[i], flat[i + 1], w / 2];
      for (let ix = Math.floor(Math.min(seg[0], seg[2]) / 20); ix <= Math.floor(Math.max(seg[0], seg[2]) / 20); ix++) {
        for (let iz = Math.floor(Math.min(seg[1], seg[3]) / 20); iz <= Math.floor(Math.max(seg[1], seg[3]) / 20); iz++) gridAdd(pathGrid, ix * 100003 + iz, seg);
      }
    }
  }
  const segDist = (x, z, s) => {
    const dx = s[2] - s[0], dz = s[3] - s[1], L2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (z - s[1]) * dz) / L2));
    return Math.hypot(s[0] + dx * t - x, s[1] + dz * t - z);
  };
  const pathsNear = (x0, x1, z0, z1) => {
    const out = new Set();
    for (let ix = Math.floor(x0 / 20); ix <= Math.floor(x1 / 20); ix++) for (let iz = Math.floor(z0 / 20); iz <= Math.floor(z1 / 20); iz++) for (const sg of pathGrid.get(ix * 100003 + iz) || []) out.add(sg);
    return [...out];
  };
  // what a park tree keeps clear of: the houses (2.5 m), the City's own trees (6 m), the park signs (6 m: their faces
  // stay open, park-signs.js) and the paths
  let bGrid = null;
  const clearOfHouses = (x, z) => {
    if (!bGrid) {
      bGrid = new Map();
      GEO.buildings.forEach((bl, i) => gridAdd(bGrid, cellKey(bl[0], bl[1], 50), i));
    }
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) {
      for (const i of bGrid.get((Math.floor(x / 50) + a) * 100003 + Math.floor(z / 50) + c) || []) {
        const row = GEO.buildings[i];
        const [cx, cz, ang, nativeParts] = row;
        const parts = window.CITY.islandCottageFootprintParts?.(row, i) || nativeParts;
        const cs = Math.cos(ang), sn = Math.sin(ang), dx = x - cx, dz = z - cz;
        const u = dx * cs - dz * sn, v = dx * sn + dz * cs;
        for (const [u0, u1, v0, v1] of parts) if (u > u0 - 2.5 && u < u1 + 2.5 && v > v0 - 2.5 && v < v1 + 2.5) return false;
      }
    }
    return true;
  };
  const keepOut = new Map(); // 10 m cells -> [x, z, r]
  const ST = GEO.streetTrees || [];
  for (let i = 0; i + 1 < ST.length; i += 4) gridAdd(keepOut, cellKey(ST[i], ST[i + 1], 10), [ST[i], ST[i + 1], 6]);
  for (const [x, z] of (GEO.props && GEO.props.parkSign) || []) gridAdd(keepOut, cellKey(x, z, 10), [x, z, 6]);
  const keptOut = (x, z) => {
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) {
      for (const [px, pz, r] of keepOut.get((Math.floor(x / 10) + a) * 100003 + Math.floor(z / 10) + c) || []) if (Math.hypot(px - x, pz - z) < r) return true;
    }
    return false;
  };
  const hash = (x, z, k) => { const h = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453; return h - Math.floor(h); };
  const boxOf = (p) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    p.x0 = x0; p.x1 = x1; p.z0 = z0; p.z1 = z1;
    return p;
  };
  const inPieces = (pieces, x, z) => pieces.some((p) => {
    if (x < p.x0 || x > p.x1 || z < p.z0 || z > p.z1) return false;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], c = p[(i + 1) % p.length];
      if ((c[0] - a[0]) * (z - a[1]) - (c[1] - a[1]) * (x - a[0]) < 0) return false;
    }
    return true;
  });
  // The ponds on an island (city-config.js pondsOnIsland: Grenadier Pond in High Park's lawn...) are cut out of its
  // yard & small parks, so the water city-grid.js draws under them shows (st-ejsz). `cutByPonds`: convex pieces less
  // the ponds' triangles; `yardGeometry`: a yard's flat top, a pond wholly inside it a hole, one across its edge cut away
  const pondTris = new Map();
  const trisOfPond = (pond) => {
    if (!pondTris.has(pond)) pondTris.set(pond, trianglesXZ(pond.pts));
    return pondTris.get(pond);
  };
  const cutByPonds = (pieces, ponds) => {
    for (const pond of ponds) {
      if (!pieces.length) break;
      for (const t of trisOfPond(pond)) {
        pieces = pieces.flatMap((p) => {
          if (p.x0 === undefined) boxOf(p);
          if (p.x1 < t.x0 || p.x0 > t.x1 || p.z1 < t.z0 || p.z0 > t.z1) return [p];
          return subtractConvexXZ(p, t).map(boxOf);
        });
      }
    }
    return pieces;
  };
  let pondYards = 0;
  const yardGeometry = (pts, y, ponds) => {
    const holes = [], cross = [];
    for (const { pond } of ponds) {
      const on = pondOnPolygon(pts, pond);
      if (on === 'inside') holes.push(pond);
      else if (on === 'cross') cross.push(pond);
    }
    if (!holes.length && !cross.length) return flatShape(pts, y);
    pondYards++;
    if (!cross.length) {
      const shape = createWorldXZShape(pts);
      for (const h of holes) shape.holes.push(new THREE.Path(h.pts.map((p) => new THREE.Vector2(p.x, -p.z))));
      const g = new THREE.ShapeGeometry(shape, 1);
      g.rotateX(-Math.PI / 2);
      g.translate(0, y, 0);
      return g;
    }
    return flatPiecesGeometry(cutByPonds(trianglesXZ(pts), [...holes, ...cross]), y); // (null: all water)
  };
  const parketteTrees = [];
  const BED_R = 1.3;
  let parketteCount = 0;
  // the lawn, path & bed geometry of an island's small parks (null: none), cut to its yard `prop`
  const parkettesOf = (b, prop, ponds = []) => {
    const parks = parksOn.get(b);
    if (!parks) return null;
    const propTris = trianglesXZ(prop);
    const lawn = [], paths = [], beds = [];
    const wet = ponds.map((p) => p.pond);
    for (const a of parks) {
      const pieces = cutByPonds(intersectXZ(trianglesXZ(a.pts), propTris), wet);
      if (!pieces.length) continue;
      let area = 0;
      for (const p of pieces) for (let i = 1; i + 1 < p.length; i++) area += ((p[i][0] - p[0][0]) * (p[i + 1][1] - p[0][1]) - (p[i][1] - p[0][1]) * (p[i + 1][0] - p[0][0])) / 2;
      if (area < 20) continue;
      pieces.forEach(boxOf);
      parketteCount++;
      lawn.push(...pieces);
      const segs = pathsNear(a.minX, a.maxX, a.minZ, a.maxZ);
      for (const sg of segs) {
        const L = Math.hypot(sg[2] - sg[0], sg[3] - sg[1]);
        if (L < 0.05) continue;
        const ux = (sg[2] - sg[0]) / L, uz = (sg[3] - sg[1]) / L, h = sg[4];
        // the segment as a quad run on half a width past each end (so the runs' corners close), positive winding
        const ax = sg[0] - ux * h, az = sg[1] - uz * h, bx = sg[2] + ux * h, bz = sg[3] + uz * h;
        const quad = [[ax + uz * h, az - ux * h], [bx + uz * h, bz - ux * h], [bx - uz * h, bz + ux * h], [ax - uz * h, az + ux * h]];
        const cr = (quad[1][0] - quad[0][0]) * (quad[2][1] - quad[0][1]) - (quad[1][1] - quad[0][1]) * (quad[2][0] - quad[0][0]);
        if (cr < 0) quad.reverse();
        boxOf(quad);
        for (const t of propTris) {
          if (quad.x1 < t.x0 || quad.x0 > t.x1 || quad.z1 < t.z0 || quad.z0 > t.z1) continue;
          const piece = clipConvex(quad, t);
          if (piece) paths.push(...(wet.length ? cutByPonds([piece], wet) : [piece]));
        }
      }
      // trees: about one per 200 m² of lawn (at most 4), 7 m apart, 2.2 m in from the lawn's edge
      const want = Math.min(4, Math.floor(area / 200));
      const placed = [];
      const step = 5;
      for (let x = a.minX + step / 2; x < a.maxX && placed.length < want; x += step) {
        for (let z = a.minZ + step / 2; z < a.maxZ && placed.length < want; z += step) {
          const px = x + (hash(x, z, 1) - 0.5) * step * 0.8, pz = z + (hash(x, z, 2) - 0.5) * step * 0.8;
          if (hash(px, pz, 3) < 0.35) continue;
          if (![[0, 0], [2.2, 0], [-2.2, 0], [0, 2.2], [0, -2.2]].every(([ox, oz]) => inPieces(pieces, px + ox, pz + oz))) continue;
          if (placed.some(([qx, qz]) => Math.hypot(qx - px, qz - pz) < 7)) continue;
          if (segs.some((sg) => segDist(px, pz, sg) < sg[4] + BED_R + 0.6)) continue;
          if (keptOut(px, pz) || !clearOfHouses(px, pz)) continue;
          placed.push([px, pz]);
        }
      }
      for (const [px, pz] of placed) {
        parketteTrees.push({ x: px, z: pz, r: hash(px, pz, 4), s: hash(px, pz, 5) });
        const ring = [];
        for (let k = 0; k < 8; k++) ring.push([px + Math.cos((k * Math.PI) / 4) * BED_R, pz + Math.sin((k * Math.PI) / 4) * BED_R]);
        beds.push(ring); // (positive winding in (x, z): counter-clockwise from +x towards +z)
      }
    }
    if (!lawn.length) return null;
    return { lawn: flatPiecesGeometry(lawn, SW_TOP + 0.004), paths: flatPiecesGeometry(paths, SW_TOP + 0.008), beds: flatPiecesGeometry(beds, SW_TOP + 0.011) };
  };
  // The City's physical sidewalks (js/toronto-sidewalks.js, js/sidewalk-polygons.js): per island, the City's own
  // polygons, clipped at build time to the island's slab. Where an island has them, its yard runs out to the slab's edge
  // (the verges, front yards & forecourts between the curb, the walk & the buildings) and the sidewalks lie on it in
  // concrete; an island without them (a gap in the City's mapping, newer streets) keeps the fixed band. Only the
  // surface changes: the slab, its height and so the walking floor & the props on it stay exactly as they were.
  // (?sidewalks=0: the fixed band everywhere, for comparison)
  const cityWalks = window.CITY.sidewalkPieces && new URLSearchParams(location.search).get('sidewalks') !== '0'
    ? window.CITY.sidewalkPieces(window.CITY.SIDEWALKS, GEO.blocks) : null;
  window.CITY.sidewalkPieceMap = cityWalks; // (patio-layout.js keeps the CaféTO cafés on them)
  let walkIslands = 0, walkBands = 0, walkTris = 0, walkMs = 0;
  // the slab's sides alone (its top is the yard's), facing out, in the walkway's concrete
  const slabSides = (pts, y0, y1, keep = null) => {
    const A = makeAcc();
    let area = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) area += pts[j].x * pts[i].z - pts[i].x * pts[j].z;
    for (let i = 0; i < pts.length; i++) {
      if (keep && !keep[i]) continue;
      const a = pts[i], c = pts[(i + 1) % pts.length];
      const L = Math.hypot(c.x - a.x, c.z - a.z);
      if (L < 0.01) continue;
      const ux = (c.x - a.x) / L, uz = (c.z - a.z) / L;
      const uv = [[0, y0], [L, y0], [L, y1], [0, y1]];
      // (positive area: the inside lies left of a -> c, along (-uz, ux), so the outward face is c -> a)
      if (area > 0) accQuad(A, [c.x, y0, c.z], [a.x, y0, a.z], [a.x, y1, a.z], [c.x, y1, c.z], [uz, 0, -ux], uv);
      else accQuad(A, [a.x, y0, a.z], [c.x, y0, c.z], [c.x, y1, c.z], [a.x, y1, a.z], [-uz, 0, ux], uv);
    }
    return accGeometry(A);
  };
  const walkPieces = (pieces, y) => {
    const shapes = pieces.map(({ outer, holes }) => {
      const s = createWorldXZShape(outer);
      for (const h of holes) s.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, -p.z))));
      return s;
    });
    const t0 = performance.now();
    const g = new THREE.ShapeGeometry(shapes, 1);
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
    walkMs += performance.now() - t0;
    walkTris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    return g;
  };
  // Each walk triangle gets the frame of the run of curb it lies along (js/sidewalk-sections.js), so the shader scores
  // Toronto's joints across the walk on every street, the off-grid ones included: `walkFrame` (the run's direction, curb
  // line, seed & whether the island is downtown) and `walkSpan` (how far in from the curb the walk runs there)
  let frameMs = 0;
  const framed = (g, runs, rings, seeds, downtown) => {
    const t0 = performance.now();
    const ni = g.index ? g.toNonIndexed() : g;
    const a = ni.attributes;
    const r = window.CITY.walkFrames(a.position.array, a.normal.array, runs, window.CITY.ringSegments(rings), seeds, downtown);
    if (ni !== g) ni.dispose();
    g.dispose();
    // (no uv: the walkway material works in world & walk coordinates)
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(r.pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(r.nor, 3));
    out.setAttribute('walkFrame', new THREE.BufferAttribute(r.frame, 4));
    out.setAttribute('walkSpan', new THREE.BufferAttribute(r.span, 2));
    frameMs += performance.now() - t0;
    return out;
  };
  // --- end Toronto layer ---
  for (const b of BLOCKS) {
    const ponds = pondsOnIsland(b); // (st-ejsz: cut out of the kerb's top, the yard & the small parks)
    const inner = offsetPolygonInward(b.poly, 0.25);
    const prop = b.area > 400 ? offsetPolygonInward(b.poly, SW) : null;
    // Island-only: the source-confirmed unmarked lane edges become a flush grass ramp from the road at the block
    // outline to the existing yard at the prop inset, replacing the former kerb strip and walk band there. The gate is
    // pure and absent on mainland pages, so nothing changes there; a block with a City sidewalk, a median or a pond
    // keeps the native treatment.
    const hasCityWalk = !!(cityWalks && b.area > 400 && cityWalks.get(b.id));
    // The verge is source-confirmed per edge. A block with City sidewalks keeps the native concrete walk on the edges
    // the City actually maps, but a source-confirmed unmarked-lane edge the City does NOT map still gets the flush
    // verge (the captain's Third Street left edge: block 2887's City sidewalks are on its far side, not on the lane).
    let verge = inner && prop && !b.median && !ponds.length ? islandVergeFlags(inner) : null;
    if (verge && hasCityWalk) {
      const pieces = cityWalks.get(b.id);
      let any = false;
      for (let i = 0; i < verge.length; i++) {
        if (!verge[i]) continue;
        if (cityWalkOverlapsEdge(b.poly, prop, i, pieces)) verge[i] = 0;
        else any = true;
      }
      if (!any) verge = null;
    }
    // The yard's material category, resolved before the ramp so the ramp is drawn in the SAME material as the yard it
    // meets (the captain's material-continuity finding: a bright lawn ramp against a native plot yard).
    const yard = isRailLand(b) ? 'rail' : b.park > 0.6 ? 'lawn' : b.wild > 0.5 ? 'wild' : isPaved(b) ? 'paved' : 'plot';
    if (verge) {
      // The kerb strip is built only on the unflagged edges; the flagged edges are the ramp alone, so no old curb top
      // remains above it. The ramp is the walk band AND the kerb strip on those edges (the road at the outline, rising
      // over where the kerb was, to the yard at the prop inset) - never an overlay on a kept top.
      const ring = kerbRingGeometryXZEdges(b.poly, inner, 0.0, KERB_TOP, keepMask(inner.length, verge));
      if (ring) { geos.curb.push(ring); vergeTopStore(ring, b.id, 'kerb'); }
      const ramp = rampGeometryXZ(b.poly, prop, verge, { roadY: 0, walkY: SW_TOP, kerbY: KERB_TOP });
      if (ramp) { geos[yard].push(ramp); vergeRampStore(ramp, b.id); }
    } else {
      // kerb ring under the slab (the slab is inset 0.25 m, so the kerb's top & face show). Its top runs over the whole
      // island, so a pond on it is a hole in it; one across its edge leaves the kerb a ring, the slab's width
      const kerb = createWorldXZShape(b.poly);
      if (ponds.some((p) => p.on === 'cross') && inner) kerb.holes.push(new THREE.Path(inner.map((p) => new THREE.Vector2(p.x, -p.z))));
      else for (const { pond } of ponds) kerb.holes.push(new THREE.Path(pond.pts.map((p) => new THREE.Vector2(p.x, -p.z))));
      geos.curb.push(extrude(kerb, 0.0, 0.18));
    }
    if (!inner) continue;
    if (b.median) {
      const mat = tramMedians.has(b) ? 'paved' : 'lawn';
      if (!ponds.length) geos[mat].push(extrude(createWorldXZShape(inner), 0.03, SW_TOP - 0.03));
      else { const top = yardGeometry(inner, SW_TOP, ponds); if (top) geos[mat].push(top); }
      continue;
    }
    // (over the yard, +0.003: under the City's walks, the small parks' lawns & beds)
    if (b === distilleryBlock) geos.lanes.push(flatShape(prop || inner, SW_TOP + 0.003));
    const walks = cityWalks && b.area > 400 ? cityWalks.get(b.id) : null; // (Toronto layer: the City's sidewalks)
    const runs = window.CITY.curbRuns(inner);
    const seeds = runs.map((_, i) => window.CITY.runSeed(b.id, i));
    const downtown = isPaved(b) ? 1 : 0;
    if (walks) {
      walkIslands++;
      if (verge) {
        // A block with City sidewalks AND source-confirmed lane edges the City does not map: the yard keeps its original
        // material and runs to the inner outline on the retained edges, cut back to the prop inset only on the flagged
        // edges so the flush ramp is visible. No new concrete band is laid on the untouched edges; the City's own
        // sidewalk pieces are still laid on top where they exist (never on a flagged edge).
        const top = yardGeometry(mixedYardOutline(inner, prop, verge), SW_TOP, ponds);
        if (top) { geos[yard].push(top); vergeYardStore(top, b.id); }
        // The slab's vertical face at the inner outline is kept on the retained edges only: on a flagged edge the ramp
        // already rises from the road, so a face there would poke above it.
        const sides = slabSides(inner, 0.03, SW_TOP, keepMask(inner.length, verge));
        if (sides) geos.walk.push(framed(sides, runs, [], seeds, downtown));
      } else {
        const sides = slabSides(inner, 0.03, SW_TOP);
        if (sides) geos.walk.push(framed(sides, runs, [], seeds, downtown));
        const top = yardGeometry(inner, SW_TOP, ponds);
        if (top) geos[yard].push(top);
      }
      // (over the small parks' lawns, +0.004, under their paths & beds)
      const cityWalkGeo = framed(walkPieces(walks, SW_TOP + 0.006), runs, walks.flatMap((w) => [w.outer, ...w.holes]), seeds, downtown);
      // (a City sidewalk piece can overlap a ramp footprint at a corner: store its top so the sampler returns the
      // topmost rendered surface there, exactly as the walker sees it)
      if (verge) vergeTopStore(cityWalkGeo, b.id, 'walk');
      geos.walk.push(cityWalkGeo);
      const pk = prop && (yard === 'paved' || yard === 'plot') ? parkettesOf(b, prop, ponds) : null;
      if (pk) {
        geos.lawn.push(pk.lawn);
        if (pk.paths) geos.paved.push(pk.paths);
        if (pk.beds) geos.rail.push(pk.beds);
      }
    } else if (prop) {
      if (cityWalks) walkBands++;
      if (verge) {
        // (the same per-edge quads as the concave fallback, built only on the unflagged edges: the flagged edges are
        // the flush ramp, so the former band top and its sides are not drawn there at all.)
        const band = walkBandGeometryXZEdges(inner, prop, 0.03, SW_TOP, keepMask(inner.length, verge));
        if (band) { vergeTopStore(band, b.id, 'walk'); geos.walk.push(framed(band, runs, [inner, prop], seeds, downtown)); }
      } else {
        // (a concave curb island's inward offset can self-cross; the extruded hole then floods the whole island with
        // walkway — Ward's Island Park. Only then is the band built as edge quads, which cannot overfill.)
        const band = inner.length > 8 && !annulusSafeXZ(inner, prop)
          ? walkBandGeometryXZ(inner, prop, 0.03, SW_TOP)
          : (() => {
              const ring = createWorldXZShape(inner);
              ring.holes.push(new THREE.Path(prop.map((p) => new THREE.Vector2(p.x, -p.z))));
              return extrude(ring, 0.03, SW_TOP - 0.03);
            })();
        geos.walk.push(framed(band, runs, [inner, prop], seeds, downtown));
      }
      const top = yardGeometry(prop, SW_TOP - 0.002, ponds);
      if (top) {
        geos[yard].push(top);
        // (the native yard can flood over the ramp at a concave corner: store those pieces so the sampler returns the
        // topmost rendered surface, not the ramp hidden under them)
        if (verge) vergeYardStore(top, b.id);
      }
      const pk = yard === 'paved' || yard === 'plot' ? parkettesOf(b, prop, ponds) : null; // (Toronto layer: the small parks)
      if (pk) {
        geos.lawn.push(pk.lawn);
        if (pk.paths) geos.paved.push(pk.paths);
        if (pk.beds) geos.rail.push(pk.beds);
      }
    } else {
      geos.walk.push(framed(extrude(createWorldXZShape(inner), 0.03, SW_TOP - 0.03), runs, [inner], seeds, downtown));
    }
    // rectangular cover for the consumers that work on rectangles: the lot rects grown back out to the kerb
    if (b.rect) {
      blockSidewalks.push({ cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2, w: b.maxX - b.minX, d: b.maxZ - b.minZ, block: b });
      roadSidewalks.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ });
    } else {
      for (const [x0, x1, z0, z1] of b.rects) {
        const r = { minX: x0 - 4.4, maxX: x1 + 4.4, minZ: z0 - 4.4, maxZ: z1 + 4.4 };
        blockSidewalks.push({ cx: (r.minX + r.maxX) / 2, cz: (r.minZ + r.maxZ) / 2, w: r.maxX - r.minX, d: r.maxZ - r.minZ, block: b, cover: true });
        roadSidewalks.push(r);
      }
    }
  }
  const mergeInto = (list, mat, cast = false, name = '') => {
    // (extruded & flat shapes come indexed or not: merge them all non-indexed)
    list = list.map((g) => (g.index ? g.toNonIndexed() : g));
    for (let i = 0; i < list.length; i += 300) {
      const g = mergeGeometries(list.slice(i, i + 300), false);
      for (const s of list.slice(i, i + 300)) s.dispose();
      if (!g) continue;
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      m.castShadow = cast;
      if (name) m.name = name;
      group.add(m);
    }
  };
  // islands sorted along x so each merged batch is a compact strip (the culling & the frustum can skip batches)
  mergeInto(geos.curb, curbMat, window.CITY.QUALITY.kerbShadows !== false, 'Kerbs'); // (none on the phone tier)
  // the cycle tracks' separator curbs, in the kerbs' stone (cycling.js)
  for (const g of window.CITY.bikeSeparatorGeometries ? window.CITY.bikeSeparatorGeometries() : []) {
    const m = new THREE.Mesh(g, curbMat);
    m.name = 'BikeSeparators';
    m.receiveShadow = true;
    m.castShadow = false; // (13 cm high: its shadow is a line the kerbs' already draw)
    group.add(m);
  }
  // Match the source-backed HTO apron treatment on its mapped paths only.
  window.CITY.applyWaterfrontHtoLandscapePathTone?.(sidewalkMat);
  const forecourtMat = createForecourtMaterial();
  window.CITY.applyWaterfrontHtoLandscapePathTone?.(forecourtMat);
  mergeInto(geos.walk, sidewalkMat, false, 'Walkways');
  mergeInto(geos.lawn, lawnMat, false, 'Lawns');
  mergeInto(geos.plot, plotMat, false, 'Yards');
  mergeInto(geos.paved, forecourtMat, false, 'Forecourts');
  if (geos.lanes.length) mergeInto(geos.lanes, window.CITY.createLanePavingMaterial(), false, 'DistilleryLanes'); // Toronto layer
  mergeInto(geos.wild, wildMat, false, 'OpenLand');
  // (the rail lands' gravel bed is also the small parks' mulch, so the beds add no material: Toronto layer)
  mergeInto(geos.rail, new THREE.MeshStandardNodeMaterial({ color: 0x5f5850, roughness: 0.97 }), false, 'RailLands'); // Toronto layer
  window.CITY.parketteTrees = parketteTrees; // (street-details.js plants them)
  console.info(`[cityGrid] ${parketteCount} small parks laid in lawn, ${parketteTrees.length} trees in their beds; ponds cut out of ${pondYards} island yards`);
  console.info(cityWalks ? `[cityGrid] City sidewalks on ${walkIslands} islands (${walkTris} triangles, ${walkMs.toFixed(0)} ms), the fixed ${SW} m band on ${walkBands}; walk frames ${frameMs.toFixed(0)} ms` : `[cityGrid] no City sidewalks: the fixed ${SW} m band on every island; walk frames ${frameMs.toFixed(0)} ms`);

  // ===================================================================================================================
  // 3. STREAMS & RIVERS (the Wupa, the Jabi, Lobito Creek...): water channels across the islands (culverted under
  //    the roads)
  // ===================================================================================================================
  {
    const A = makeAcc();
    for (const s of STREAMS) {
      for (let i = 0; i + 1 < s.pts.length; i++) {
        const a = s.pts[i], b = s.pts[i + 1];
        if (!inside([a, b], 2)) continue;
        if (!blockAt((a.x + b.x) / 2, (a.z + b.z) / 2)) continue; // under a road: culvert
        if (window.CITY.waterAt((a.x + b.x) / 2, (a.z + b.z) / 2)) continue; // (through a pond: its water is drawn, st-ejsz)
        const L = Math.hypot(b.x - a.x, b.z - a.z);
        if (L < 0.2) continue;
        const nx = (-(b.z - a.z) / L) * s.w * 0.5, nz = ((b.x - a.x) / L) * s.w * 0.5;
        const y = SW_TOP + 0.012;
        accQuad(A, [a.x - nx, y, a.z - nz], [b.x - nx, y, b.z - nz], [b.x + nx, y, b.z + nz], [a.x + nx, y, a.z + nz], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      }
    }
    const g = accGeometry(A);
    if (g) {
      const m = new THREE.Mesh(g, waterMat);
      m.receiveShadow = true;
      m.name = 'Streams';
      group.add(m);
    }
  }

  // ===================================================================================================================
  // 4. WALLS. Only the walls the map has: Toronto's plots open onto the sidewalk (front yards, plazas, forecourts), so
  //    Abuja's generated property-line wall & gate round every plot is gone
  // ===================================================================================================================
  {
    const wallMat = createRenderedWallMaterial();
    const CELL = 700;
    const walls = new Map(); // spatial cell -> accumulator
    const accAt = (map, x, z, withExtra) => {
      const k = Math.floor(x / CELL) * 10000 + Math.floor(z / CELL);
      if (!map.has(k)) map.set(k, makeAcc(true, withExtra ? 'wallTop' : null));
      return map.get(k);
    };
    // the mapped walls
    const mappedOn = new Set();
    for (const [h, flat] of GEO.walls) {
      const col = rgb(WALL_PAINTS[Math.floor(hash2(flat[0], flat[1]) * WALL_PAINTS.length)]);
      for (let i = 0; i + 3 < flat.length; i += 2) {
        const ax = flat[i], az = flat[i + 1], bx = flat[i + 2], bz = flat[i + 3];
        const b = blockAt((ax + bx) / 2, (az + bz) / 2);
        if (!b) continue;
        mappedOn.add(b);
        accWall(accAt(walls, ax, az, true), ax, az, bx, bz, SW_TOP, Math.min(Math.max(h, 1.8), 3.5), 0.22, col);
      }
    }
    for (const A of walls.values()) {
      const g = accGeometry(A);
      if (!g) continue;
      const m = new THREE.Mesh(g, wallMat);
      m.castShadow = m.receiveShadow = true;
      m.name = 'CompoundWalls';
      group.add(m);
    }
    if (window.CITY.DEBUG_ROADS !== false) console.info(`[ground] mapped walls on ${mappedOn.size} islands`);
  }

  // ===================================================================================================================
  // 5. FLYOVERS: deck slabs (asphalt on top, concrete faces), parapets, piers every ~24 m under the raised stretches and
  //    walled embankments under the low ends of the ramps
  // ===================================================================================================================
  {
    const concrete = new THREE.MeshStandardNodeMaterial({ color: 0xb3ada2, roughness: 0.86 });
    // the carriageways on the ground (a pier must stand clear of them): every at-grade road, in 40 m cells
    const groundSegs = new Map();
    for (const r of window.CITY.ROADS) {
      if (r.raised) continue;
      for (let i = 0; i + 1 < r.pts.length; i++) {
        const a = r.pts[i], b = r.pts[i + 1];
        for (let ix = Math.floor(Math.min(a.x, b.x) / 40); ix <= Math.floor(Math.max(a.x, b.x) / 40); ix++) {
          for (let iz = Math.floor(Math.min(a.z, b.z) / 40); iz <= Math.floor(Math.max(a.z, b.z) / 40); iz++) {
            const k = ix * 100000 + iz;
            (groundSegs.get(k) || groundSegs.set(k, []).get(k)).push([a, b, r.w / 2]);
          }
        }
      }
    }
    const onGroundRoad = (x, z, m) => {
      for (const [a, b, hw] of groundSegs.get(Math.floor(x / 40) * 100000 + Math.floor(z / 40)) || []) {
        const ex = b.x - a.x, ez = b.z - a.z;
        const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1)));
        if (Math.hypot(a.x + ex * t - x, a.z + ez * t - z) < hw + m) return true;
      }
      return false;
    };
    // ...and the heavy-rail tracks (a road bridge over the rail corridor stands its piers between them)
    const railSegs = new Map();
    for (const [kind, , , flags, flat] of GEO.rails || []) {
      if (kind !== 1 || flags & 2) continue;
      for (let i = 2; i < flat.length; i += 2) {
        const a = { x: flat[i - 2], z: flat[i - 1] }, b = { x: flat[i], z: flat[i + 1] };
        for (let ix = Math.floor(Math.min(a.x, b.x) / 40); ix <= Math.floor(Math.max(a.x, b.x) / 40); ix++) {
          for (let iz = Math.floor(Math.min(a.z, b.z) / 40); iz <= Math.floor(Math.max(a.z, b.z) / 40); iz++) {
            const k = ix * 100000 + iz;
            (railSegs.get(k) || railSegs.set(k, []).get(k)).push([a, b, 0]);
          }
        }
      }
    }
    const onRail = (x, z, m) => {
      for (const [a, b] of railSegs.get(Math.floor(x / 40) * 100000 + Math.floor(z / 40)) || []) {
        const ex = b.x - a.x, ez = b.z - a.z;
        const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1)));
        if (Math.hypot(a.x + ex * t - x, a.z + ez * t - z) < m) return true;
      }
      return false;
    };
    const top = makeAcc();
    const faces = makeAcc();
    const piers = [];
    // (the deck runs, city-config.js: decks that carry straight on into the next are one run, a mitred vertex at the
    // joint and the width tapering where it changes, st-qfx)
    for (const d of window.CITY.DECK_RUNS) {
      const P = d.pts;
      if (P.length < 2) continue;
      // left normal (mitred) & half width (carriageway + the parapets' footing) at each vertex
      const { n: N, hw: HW } = window.CITY.deckOutline(d);
      // (p.g: the ground under it, below the street level in the Don Valley pilot, else 0)
      const gOf = (p) => p.g || 0;
      const deep = (p) => p.h - gOf(p) > 4.6;
      const yTop = (p) => Math.max(gOf(p) + 0.03, p.h + 0.03);
      const yBot = (p) => (deep(p) ? p.h - 1.25 : gOf(p));
      // (a low deck over a road cut spans it too, though its vertices' ground, either side of the cut, is not far under
      // it: it had no soffit. The Don Valley pilot's Rosedale section, at 0.4 m with Rosedale Valley Road's cut 6 m
      // under it: from down in the cut, Bloor Street's cars stood on nothing, st-3xe9. Such a stretch gets a soffit and
      // fascias at least 1.25 m deep, as a raised one; below the ground beside the cut they are buried)
      const ROAD_CUT_AT = window.CITY.roadCutAt;
      const overCut = (a, b, ahw, bhw, L) => {
        if (!ROAD_CUT_AT || !ROAD_CUTS || !ROAD_CUTS.length) return false;
        const n = Math.max(1, Math.ceil(L / 2)), ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
        for (let k = 0; k <= n; k++) {
          const t = k / n, h = a.h + (b.h - a.h) * t, hw = ahw + (bhw - ahw) * t;
          for (const l of [-hw, 0, hw]) {
            const cut = ROAD_CUT_AT(a.x + (b.x - a.x) * t - uz * l, a.z + (b.z - a.z) * t + ux * l);
            if (cut < -0.5 && h - cut > 4.6) return true;
          }
        }
        return false;
      };
      let s = 0, sp = 0; // (sp: along the original deck, which keeps its piers' spacing)
      for (let i = 0; i + 1 < P.length; i++) {
        const a = P[i], b = P[i + 1];
        const L = Math.hypot(b.x - a.x, b.z - a.z);
        if (d.brk[i]) sp = 0;
        if (L < 0.01) continue;
        const [anx, anz] = N[i], [bnx, bnz] = N[i + 1], ahw = HW[i], bhw = HW[i + 1];
        const aL = [a.x + anx * ahw, yTop(a), a.z + anz * ahw], aR = [a.x - anx * ahw, yTop(a), a.z - anz * ahw];
        const bL = [b.x + bnx * bhw, yTop(b), b.z + bnz * bhw], bR = [b.x - bnx * bhw, yTop(b), b.z - bnz * bhw];
        accQuad(top, aR, bR, bL, aL, [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        // side faces & soffit
        const lo = (p, side) => [p[0], side, p[2]];
        const span = !(deep(a) && deep(b)) && overCut(a, b, ahw, bhw, L);
        const ya = span ? Math.min(yBot(a), a.h - 1.25) : yBot(a), yb = span ? Math.min(yBot(b), b.h - 1.25) : yBot(b);
        // (wound to face outward & down: the deck read hollow from the street, its far side's inner face seen through
        // a missing soffit)
        accQuad(faces, aL, bL, lo(bL, yb), lo(aL, ya), [anx, 0, anz], [[s, 1], [s + L, 1], [s + L, 0], [s, 0]]);
        accQuad(faces, bR, aR, lo(aR, ya), lo(bR, yb), [-anx, 0, -anz], [[s + L, 1], [s, 1], [s, 0], [s + L, 0]]);
        if ((deep(a) && deep(b)) || span) accQuad(faces, lo(aL, ya), lo(bL, yb), lo(bR, yb), lo(aR, ya), [0, -1, 0], [[0, 1], [1, 1], [1, 0], [0, 0]]);
        // parapets (0.9 m concrete barriers) along both edges
        for (const sgn of [1, -1]) {
          const ax = a.x + anx * (ahw - 0.25) * sgn, az = a.z + anz * (ahw - 0.25) * sgn;
          const bx = b.x + bnx * (bhw - 0.25) * sgn, bz = b.z + bnz * (bhw - 0.25) * sgn;
          if (a.h - gOf(a) > 0.4 || b.h - gOf(b) > 0.4) accWall(faces, ax, az, bx, bz, Math.min(yTop(a), yTop(b)), 0.9, 0.4);
        }
        // piers under the raised stretch, every ~24 m, moved along (or left out) where they'd stand in a road below
        for (let t = Math.ceil(sp / 24) * 24 - sp; t < L; t += 24) {
          for (const shift of [0, 4, -4, 8, -8]) {
            const tt = t + shift;
            if (tt < 0 || tt > L) continue;
            const h = a.h + ((b.h - a.h) * tt) / L, g = gOf(a) + ((gOf(b) - gOf(a)) * tt) / L;
            if (h - g < 4.6) break;
            const x = a.x + ((b.x - a.x) * tt) / L, z = a.z + ((b.z - a.z) * tt) / L;
            if (onGroundRoad(x, z, 1.2) || onRail(x, z, 3.2)) continue;
            if (window.CITY.subwayKeepsClear && window.CITY.subwayKeepsClear(x, z)) continue; // (subway.js: its own piers)
            // (its foot on the ground where it stands: in a road cut, the cut's floor, cutAt; in the Don Valley pilot
            // the valley's too, cutAt, or the ground under the deck if lower)
            piers.push({ x, z, h: h - 1.25, g: Math.min(window.CITY.DON_VALLEY ? g : 0, cutAt(x, z)), w: Math.min(Math.min(d.ws[i], d.ws[i + 1]) * 0.7, 9), ux: (b.x - a.x) / L, uz: (b.z - a.z) / L });
            break;
          }
        }
        s += L;
        sp += L;
      }
    }
    // The road bridges over the water at street level (city-config.js ROAD_BRIDGES): a slab across at the street's
    // height, its faces down into the water, a sidewalk up a kerb on either side where the real bridge has one (a
    // city street's, BRIDGE_SIDEWALKS), and parapets along its outer edges where no curb island runs beside it
    // (the sidewalks in the curb islands' poured concrete, each quad with its walk's frame for the joints, as the road
    // cuts' walks: js/sidewalk-sections.js walkFrames; their kerbs the islands' too)
    const bwalk = makeAcc(), bcurb = makeAcc(), bframe = [], bspan = [];
    (window.CITY.ROAD_BRIDGES || []).forEach((d, bi) => {
      const P = d.pts, road = d.w / 2, yTop = 0.03, yBot = CITY_BOUNDS.waterLevel - 0.3;
      const [swL, swR] = d.sidewalks || [0, 0];
      // (each side's outer edge: the roadway's, 0.3 m out, or its sidewalk's; the sidewalk's top 2 cm over the curb
      // islands', which it overlaps on the banks)
      const side = [[1, swL], [-1, swR]].map(([sgn, sw]) => ({ sgn, sw, hw: road + sw + 0.3, y: sw > 0 ? SW_TOP + 0.02 : yTop, edge: sw > 0 ? road : road + 0.3 }));
      let s = 0;
      for (let i = 0; i + 1 < P.length; i++) {
        const a = P[i], b = P[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z);
        if (L < 0.01) continue;
        const nx = (b.z - a.z) / L, nz = -(b.x - a.x) / L;
        const at = (p, l, y) => [p.x + nx * l, y, p.z + nz * l];
        const [Ls, Rs] = side;
        // the roadway, to its kerbs (or the deck's edges)
        accQuad(top, at(a, -Rs.edge, yTop), at(b, -Rs.edge, yTop), at(b, Ls.edge, yTop), at(a, Ls.edge, yTop), [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        for (const S of side) {
          const g = S.sgn, o = S.hw * g;
          if (S.sw > 0) {
            // the sidewalk and its kerb face, facing the roadway
            const k = road * g;
            if (g > 0) accQuad(bwalk, at(a, k, S.y), at(b, k, S.y), at(b, o, S.y), at(a, o, S.y), [0, 1, 0], [[s, 0], [s + L, 0], [s + L, S.sw], [s, S.sw]]);
            else accQuad(bwalk, at(b, k, S.y), at(a, k, S.y), at(a, o, S.y), at(b, o, S.y), [0, 1, 0], [[s + L, 0], [s, 0], [s, S.sw], [s + L, S.sw]]);
            // (its frame, as the road cuts': along the walk, its normal (-uz, ux) out from the kerb, the kerb's line c)
            const ux = -g * (b.x - a.x) / L, uz = -g * (b.z - a.z) / L, c = g * (a.x * nx + a.z * nz) + road;
            for (let v = 0; v < 6; v++) { bframe.push(ux, uz, c, window.CITY.runSeed(30000 + bi, g > 0 ? 0 : 1) * 2); bspan.push(0, S.sw + 0.3); }
            if (g > 0) accQuad(bcurb, at(b, k, S.y), at(a, k, S.y), at(a, k, yTop), at(b, k, yTop), [-nx, 0, -nz], [[s + L, 1], [s, 1], [s, 0], [s + L, 0]]);
            else accQuad(bcurb, at(a, k, S.y), at(b, k, S.y), at(b, k, yTop), at(a, k, yTop), [nx, 0, nz], [[s, 1], [s + L, 1], [s + L, 0], [s, 0]]);
            // (its ends on the banks: a step down to the street level)
            for (const [p, q, f] of [[a, b, i === 0], [b, a, i + 2 === P.length]]) {
              if (!f) continue;
              const ux = (p.x - q.x) / L, uz = (p.z - q.z) / L;
              const c0 = at(p, k, S.y), c1 = at(p, o, S.y);
              const w0 = (g > 0) === (p === a) ? [c0, c1] : [c1, c0];
              accQuad(faces, w0[0], w0[1], [w0[1][0], 0, w0[1][2]], [w0[0][0], 0, w0[0][2]], [ux, 0, uz], [[0, 1], [1, 1], [1, 0], [0, 0]]);
            }
          }
          // the deck's outer face, down into the water
          if (g > 0) accQuad(faces, at(a, o, S.y), at(b, o, S.y), at(b, o, yBot), at(a, o, yBot), [nx, 0, nz], [[s, 1], [s + L, 1], [s + L, 0], [s, 0]]);
          else accQuad(faces, at(b, o, S.y), at(a, o, S.y), at(a, o, yBot), at(b, o, yBot), [-nx, 0, -nz], [[s + L, 1], [s, 1], [s, 0], [s + L, 0]]);
          // its parapet, on the deck's (or the sidewalk's) top
          const ax = a.x + nx * (S.hw - 0.25) * g, az = a.z + nz * (S.hw - 0.25) * g;
          const bx = b.x + nx * (S.hw - 0.25) * g, bz = b.z + nz * (S.hw - 0.25) * g;
          const mx = (ax + bx) / 2 + nx * 1.5 * g, mz = (az + bz) / 2 + nz * 1.5 * g;
          if (!blockAt(mx, mz) && window.CITY.waterAt(ax, az) && window.CITY.waterAt(bx, bz)) accWall(faces, ax, az, bx, bz, S.y, 0.9, 0.4);
        }
        s += L;
      }
    });
    {
      const gw = accGeometry(bwalk);
      if (gw) {
        gw.setAttribute('walkFrame', new THREE.Float32BufferAttribute(bframe, 4));
        gw.setAttribute('walkSpan', new THREE.Float32BufferAttribute(bspan, 2));
        const m = new THREE.Mesh(gw, createSidewalkMaterial());
        m.receiveShadow = true;
        m.name = 'RoadBridgeSidewalks';
        group.add(m);
      }
      const gc = accGeometry(bcurb);
      if (gc) {
        const m = new THREE.Mesh(gc, createCurbMaterial());
        m.receiveShadow = true;
        m.name = 'RoadBridgeKerbs';
        group.add(m);
      }
    }
    for (const p of piers) {
      // a column and its crosshead across the deck
      accWall(faces, p.x - p.ux * 0.7, p.z - p.uz * 0.7, p.x + p.ux * 0.7, p.z + p.uz * 0.7, p.g, p.h - p.g, 1.6);
      accWall(faces, p.x + p.uz * p.w * 0.5, p.z - p.ux * p.w * 0.5, p.x - p.uz * p.w * 0.5, p.z + p.ux * p.w * 0.5, p.h - 1.4, 1.4, 1.6);
      colliders.push({ minX: p.x - 1.0, maxX: p.x + 1.0, minZ: p.z - 1.0, maxZ: p.z + 1.0, maxY: p.h });
    }
    const gt = accGeometry(top);
    if (gt) {
      // (its own asphalt, not the street level's: the road cuts mask that, section 6)
      const m = new THREE.Mesh(gt, streetMat === roadMat ? createRoadSurfaceMaterial() : roadMat);
      m.receiveShadow = true;
      m.castShadow = true;
      m.name = 'FlyoverDecks';
      group.add(m);
    }
    const gf = accGeometry(faces);
    if (gf) {
      const m = new THREE.Mesh(gf, concrete);
      m.receiveShadow = true;
      m.castShadow = true;
      m.name = 'FlyoverStructure';
      group.add(m);
    }
    if (window.CITY.DEBUG_ROADS !== false) console.info(`[ground] ${DECKS.length} flyover decks & ramps (${window.CITY.DECK_RUNS.length} runs), ${piers.length} piers, ${(window.CITY.ROAD_BRIDGES || []).length} road bridges over the water`);
  }

  // ===================================================================================================================
  // 6. ROAD CUTS (city-config.js ROAD_CUTS: Strachan Ave dipping under the railway): the street level, curb islands,
  //    walls & streams above the cut are masked out (maskRoadCuts), and the cut is built in their place: its roadway on
  //    the profile, kerbs, sidewalks 0.22 m up from it, the medians, and concrete retaining walls at its sides with a
  //    parapet at the top (the player's colliders, top & bottom); a cut with banks (Rosedale Valley Road) has the parks'
  //    lawn sloping up from its sidewalks instead, a short wall at the foot where a bank is cut short. The traffic
  //    follows the profile through the street graph (road-network.js, negative heights), the walkers by cutAt
  //    (traffic.js), the player by getGroundHeight.
  // ===================================================================================================================
  //    (Not the flyovers: a deck, its parapets and piers stand over a cut, not in it. Masked, a deck crossing a cut had
  //    a hole the cut's width with its markings floating over it: the Gardiner over Strachan Avenue, Bloor Street over
  //    Rosedale Valley Road, where in the Don Valley pilot the cut's walls showed through at the deck's level, st-4qix.)
  group.traverse((o) => {
    if (/^Flyover/.test(o.name)) return;
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      maskRoadCuts(m);
      // Timber decks descend below the quay: remove the underlying pavement/bank,
      // while retaining the lake beneath them and its existing shoreline mask.
      if (m !== waterMat && m !== lakeMat) {
        window.CITY.applyWaterfrontDeckGroundMask?.(m);
        window.CITY.applyWaterfrontHtoBoardwalkGroundMask?.(m);
      }
    }
  });
  if (ROAD_CUTS.length) {
    const road = makeAcc(), walk = makeAcc(), curb = makeAcc(), wall = makeAcc();
    const quad = (A, p0, p1, p2, p3, f) => {
      const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2], vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
      const flip = (uy * vz - uz * vy) * f[0] + (uz * vx - ux * vz) * f[1] + (ux * vy - uy * vx) * f[2] < 0;
      const P = flip ? [p0, p3, p2, p1] : [p0, p1, p2, p3];
      accQuad(A, P[0], P[1], P[2], P[3], f, P.map((p) => [p[0], p[2] + p[1]]));
    };
    const PARAPET = 1.05, THICK = 0.3;
    // (the Don Valley pilot's ground under a point of the cut, js/don-valley.js: 0 outside its box)
    const DV = window.CITY.DON_VALLEY || null;
    const wallGround = ([x, , z]) => (DV.inBox(x, z) ? DV.heightAt(x, z) : 0);
    const bankAcc = makeAcc();
    let nWalls = 0, nBank = 0;
    for (const c of ROAD_CUTS) {
      // stations every 2 m along the axis (a polyline) and at each of its points (the breaks of slope among them); at
      // each, its normal (at a point between two segments, the mean of theirs) and the kerb either side (the first
      // island that isn't a median, walking out from the axis)
      const ts = [...new Set([...Array.from({ length: Math.ceil(c.len / 2) }, (_, i) => i * 2), ...c.s, c.len])].sort((a, b) => a - b);
      const st = ts.map((t) => {
        let k = 0;
        while (k < c.segs.length - 1 && t > c.segs[k].s0 + c.segs[k].len) k++;
        const g = c.segs[k], f = Math.max(0, Math.min(1, (t - g.s0) / g.len));
        const x = g.a.x + (g.b.x - g.a.x) * f, z = g.a.z + (g.b.z - g.a.z) * f, h = g.a.h + (g.b.h - g.a.h) * f;
        let ux = g.ux, uz = g.uz;
        const j = Math.abs(t - g.s0) < 1e-6 ? k - 1 : Math.abs(t - g.s0 - g.len) < 1e-6 ? k + 1 : -1;
        if (j >= 0 && j < c.segs.length) {
          const L = Math.hypot(ux + c.segs[j].ux, uz + c.segs[j].uz) || 1;
          ux = (ux + c.segs[j].ux) / L; uz = (uz + c.segs[j].uz) / L;
        }
        const nx = -uz, nz = ux;
        const kerb = (sg) => {
          for (let l = 0.5; l < c.half - 0.5; l += 0.25) {
            const b = blockAt(x + nx * l * sg, z + nz * l * sg);
            if (b && !b.median) return l;
          }
          return c.half - 0.3;
        };
        return { t, x, z, h, nx, nz, k: { 1: kerb(1), '-1': kerb(-1) } };
      });
      const P = (q, l, y) => [q.x + q.nx * l, y, q.z + q.nz * l];
      for (let i = 0; i + 1 < st.length; i++) {
        const a = st[i], b = st[i + 1];
        quad(road, P(a, -a.k[-1], a.h), P(b, -b.k[-1], b.h), P(b, b.k[1], b.h), P(a, a.k[1], a.h), [0, 1, 0]);
        for (const sg of [1, -1]) {
          const ka = a.k[sg] * sg, kb = b.k[sg] * sg, wa = c.half * sg, wb = c.half * sg, ow = (c.half + THICK) * sg;
          const sw = SW_TOP;
          const nx = (a.nx + b.nx) / 2, nz = (a.nz + b.nz) / 2;
          quad(curb, P(a, ka, a.h), P(b, kb, b.h), P(b, kb, b.h + sw), P(a, ka, a.h + sw), [-nx * sg, 0, -nz * sg]);
          quad(walk, P(a, ka, a.h + sw), P(b, kb, b.h + sw), P(b, wb, b.h + sw), P(a, wa, a.h + sw), [0, 1, 0]);
          // the retaining wall, its parapet rising with the depth (none at street level); with banks (city-config.js
          // cutBankAt), a short wall up to the bank's foot (a full one with its parapet where there's no bank), the
          // grassed bank up to the street level, and a strip of lawn along its top (over the mask's ragged edge)
          const bA = c.bankSt ? cutBankAt(c, a.t, sg) : null, bB = c.bankSt ? cutBankAt(c, b.t, sg) : null;
          const footA = bA ? bA.top : sw - 0.05, footB = bB ? bB.top : sw - 0.05;
          let capA = bA && bA.w >= 0.5 ? 0.12 : Math.min(PARAPET, -a.h * 2), capB = bB && bB.w >= 0.5 ? 0.12 : Math.min(PARAPET, -b.h * 2);
          // (the Don Valley pilot: main.js drapes the cut over the valley like the street level round it, so the wall
          // stands on the valley's ground, gA and gB under its ends; under a deck less than 2 m over that ground the
          // wall stops there: no parapet up through the deck. Bloor Street's Rosedale section stands 6 m over Rosedale
          // Valley Road's cut, st-4qix.)
          const gA = DV ? wallGround(P(a, (c.half + THICK / 2) * sg, 0)) : 0, gB = DV ? wallGround(P(b, (c.half + THICK / 2) * sg, 0)) : 0;
          if (DV) {
            const under = ([x, , z], g) => { const d = window.CITY.deckHeightAt(x, z, g + 1, 1); return d !== 0 && d - g > 0.3 && d - g < 2; };
            if (under(P(a, (c.half + THICK / 2) * sg, 0), gA)) capA = 0;
            if (under(P(b, (c.half + THICK / 2) * sg, 0), gB)) capB = 0;
          }
          const ta = (bA ? Math.max(bA.top, a.h + sw) : sw) + capA, tb = (bB ? Math.max(bB.top, b.h + sw) : sw) + capB;
          quad(wall, P(a, wa, a.h + sw), P(b, wb, b.h + sw), P(b, wb, tb), P(a, wa, ta), [-nx * sg, 0, -nz * sg]);
          quad(wall, P(a, ow, footA), P(b, ow, footB), P(b, ow, tb), P(a, ow, ta), [nx * sg, 0, nz * sg]);
          quad(wall, P(a, wa, ta), P(b, wb, tb), P(b, ow, tb), P(a, ow, ta), [0, 1, 0]);
          if (bA && (bA.w > 0 || bB.w > 0)) {
            const oa = (c.half + THICK + bA.w) * sg, ob = (c.half + THICK + bB.w) * sg;
            quad(bankAcc, P(a, ow, bA.top), P(b, ow, bB.top), P(b, ob, bB.base), P(a, oa, bA.base), [-nx * sg * 0.5, 1, -nz * sg * 0.5]);
            quad(bankAcc, P(a, oa, bA.base - 0.02), P(b, ob, bB.base - 0.02), P(b, ob + 1.2 * sg, bB.base - 0.02), P(a, oa + 1.2 * sg, bA.base - 0.02), [0, 1, 0]);
            nBank += (b.t - a.t) / 2;
          }
          // its collider: the wall's thickness from the floor to its top, where the cut is a step down
          if (Math.min(ta, tb) - Math.max(a.h, b.h) - sw > 0.25) {
            const L = b.t - a.t, cx = (a.x + b.x) / 2 + nx * (c.half + THICK / 2) * sg, cz = (a.z + b.z) / 2 + nz * (c.half + THICK / 2) * sg;
            const hx = THICK / 2 + 0.05, hz = L / 2 + 0.05, cs = -nx, sn = nz; // (along the wall: (nz, -nx))
            const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
            colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY: Math.min(a.h + gA, b.h + gB) - 1, maxY: Math.min(ta + gA, tb + gB), obb: { cx, cz, hx, hz, cs, sn } });
            nWalls++;
          }
        }
      }
      // the medians inside the cut: their outline every 1.5 m, lowered with the floor under it (kerb faces & top)
      for (const bl of BLOCKS) {
        if (!bl.median) continue;
        const mx = bl.poly.reduce((t, p) => t + p.x, 0) / bl.poly.length, mz = bl.poly.reduce((t, p) => t + p.z, 0) / bl.poly.length;
        if (!cutLocal(c, mx, mz)) continue;
        const ring = [];
        for (let i = 0; i < bl.poly.length; i++) {
          const p = bl.poly[i], q = bl.poly[(i + 1) % bl.poly.length];
          const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 1.5));
          for (let k = 0; k < n; k++) ring.push({ x: p.x + ((q.x - p.x) * k) / n, z: p.z + ((q.z - p.z) * k) / n });
        }
        for (const p of ring) p.y = (window.CITY.roadCutAt || cutAt)(p.x, p.z);
        const tris = THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p.x, p.z)), []);
        for (const [i0, i1, i2] of tris) {
          const v = [ring[i0], ring[i1], ring[i2]].map((p) => [p.x, p.y + SW_TOP, p.z]);
          quad(walk, v[0], v[1], v[2], v[0], [0, 1, 0]);
        }
        for (let i = 0; i < ring.length; i++) {
          const p = ring[i], q = ring[(i + 1) % ring.length];
          const L = Math.hypot(q.x - p.x, q.z - p.z) || 1;
          // (facing out of the island: its outline's winding decides)
          const area = ring.reduce((t, r, j) => t + r.x * ring[(j + 1) % ring.length].z - ring[(j + 1) % ring.length].x * r.z, 0);
          const o = area > 0 ? 1 : -1;
          quad(curb, [p.x, p.y, p.z], [q.x, q.y, q.z], [q.x, q.y + SW_TOP, q.z], [p.x, p.y + SW_TOP, p.z], [((q.z - p.z) / L) * o, 0, (-(q.x - p.x) / L) * o]);
        }
      }
    }
    // (the banks: the parks' lawn, its own instance: the street level's carries the mask, which would cut the banks away)
    const mats = [[bankAcc, createParkLawnMaterial(false), 'RoadCutBanks'], [road, createRoadSurfaceMaterial(), 'RoadCutRoadway'], [walk, createSidewalkMaterial(), 'RoadCutSidewalks'], [curb, createCurbMaterial(), 'RoadCutKerbs'], [wall, window.CITY.createConcreteMaterial ? window.CITY.createConcreteMaterial() : new THREE.MeshStandardNodeMaterial({ color: 0xa8a297, roughness: 0.88 }), 'RoadCutWalls']];
    // the cut's sidewalks run along its axis: each triangle the frame of the nearest piece of axis, in from the kerb on
    // its side (js/sidewalk-sections.js; the walks on the islands get theirs from their curbs)
    const cutWalkFrames = (g) => {
      const P = g.attributes.position.array, nv = P.length / 3;
      const frame = new Float32Array(nv * 4), span = new Float32Array(nv * 2);
      for (let v = 0; v + 2 < nv; v += 3) {
        const cx = (P[v * 3] + P[v * 3 + 3] + P[v * 3 + 6]) / 3, cz = (P[v * 3 + 2] + P[v * 3 + 5] + P[v * 3 + 8]) / 3;
        let best = null, bd = Infinity;
        ROAD_CUTS.forEach((c, ci) => c.segs.forEach((sg, si) => {
          const dx = sg.b.x - sg.a.x, dz = sg.b.z - sg.a.z, L2 = dx * dx + dz * dz || 1e-9;
          const t = Math.max(0, Math.min(1, ((cx - sg.a.x) * dx + (cz - sg.a.z) * dz) / L2));
          const d = Math.hypot(sg.a.x + dx * t - cx, sg.a.z + dz * t - cz);
          if (d < bd) { bd = d; best = { sg, ci, si }; }
        }));
        const { sg, ci } = best;
        const l = (i) => (P[i * 3] - sg.a.x) * -sg.uz + (P[i * 3 + 2] - sg.a.z) * sg.ux; // across the axis
        const side = l(v) + l(v + 1) + l(v + 2) >= 0 ? 1 : -1;
        const ls = [0, 1, 2].map((k) => Math.abs(l(v + k)));
        const kerb = Math.min(...ls);
        // (along the axis with the walk on the left: the inward normal (-uz, ux) points from the kerb to the wall)
        const ux = sg.ux * side, uz = sg.uz * side;
        const c = (sg.a.x * -sg.uz + sg.a.z * sg.ux) * side + kerb;
        for (let k = 0; k < 3; k++) {
          frame.set([ux, uz, c, window.CITY.runSeed(20000 + ci, side > 0 ? 0 : 1) * 2], (v + k) * 4);
          span.set([0, Math.max(...ls) - kerb], (v + k) * 2);
        }
      }
      g.setAttribute('walkFrame', new THREE.BufferAttribute(frame, 4));
      g.setAttribute('walkSpan', new THREE.BufferAttribute(span, 2));
    };
    for (const [A, mat, name] of mats) {
      const g = accGeometry(A);
      if (!g) continue;
      g.computeVertexNormals();
      if (A === walk) cutWalkFrames(g);
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      m.castShadow = name === 'RoadCutWalls' || name === 'RoadCutBanks';
      m.name = name;
      group.add(m);
    }
    if (window.CITY.DEBUG_ROADS !== false) console.info(`[ground] ${ROAD_CUTS.length} road cuts (${ROAD_CUTS.map((c) => `${c.name} ${Math.round(-Math.min(...c.pts.map((p) => p.h)) * 10) / 10} m down${c.bankSt ? `, grassed banks 1:${c.bank} up to ${c.maxBank.toFixed(1)} m wide` : ''}`).join(', ')}), ${nWalls} wall colliders, ${Math.round(nBank)} m of banks`);
  }

  // Every road, the expressways and the flyovers included, carries the street traffic (road-network.js): no separate
  // highway lanes
  const highwayLanes = [];

  scene.add(group);
  window.CITY.sidewalkBlocks = blockSidewalks;
  return { group, sidewalks: roadSidewalks, footprints, highwayLanes, colliders };
}

Object.assign(window.CITY, { buildCityGrid, maskRoadCuts, batchStaticGroupMeshes, offsetPolygonInward, createExtrudedPolygonMesh, createFlatPolygonMesh, createWorldXZShape, annulusSafeXZ, ringSelfIntersects, walkBandGeometryXZ, walkBandGeometryXZEdges, kerbRingGeometryXZEdges, rampGeometryXZ, islandVergeFlags, cityWalkOverlapsEdge, islandVergeSurfaceAt, islandVergeRampStats });
})();
