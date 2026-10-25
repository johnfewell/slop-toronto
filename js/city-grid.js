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
  STREAMS,
  DECKS,
  GEO,
  blockAt,
  ROAD_CUTS,
  cutLocal,
  cutBankAt,
  cutAt
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
  const group = new THREE.Group();
  group.name = 'CityGround';
  const footprints = []; // ground obstacles traffic & pedestrians keep clear of
  const colliders = []; // player colliders (flyover piers)
  const SW = GEO.frame.sidewalk;
  const SW_TOP = CITY_BOUNDS.sidewalkHeight;
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
    for (const w of bigLakes) {
      // the lake with its islands as holes, out to the horizon
      const shape = createWorldXZShape(w.pts);
      for (const h of w.holes) shape.holes.push(new THREE.Path(h.pts.map((p) => new THREE.Vector2(p.x, -p.z))));
      const g = new THREE.ShapeGeometry(shape, 1);
      g.rotateX(-Math.PI / 2);
      g.translate(0, CITY_BOUNDS.waterLevel, 0);
      const m = new THREE.Mesh(g, lakeMat);
      m.receiveShadow = true;
      m.name = 'LakeOntario';
      group.add(m);
      // banks along the shore inside the city and round the islands
      for (const ring of [clipToCity(w.pts), ...w.holes.filter((h) => inside(h.pts, 0)).map((h) => h.pts)]) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length];
          const L = Math.hypot(b.x - a.x, b.z - a.z);
          if (L < 0.01) continue;
          const onEdge = (p) => Math.abs(p.x - B.minX) < 1.5 || Math.abs(p.x - B.maxX) < 1.5 || Math.abs(p.z - B.minZ) < 1.5 || Math.abs(p.z - B.maxZ) < 1.5;
          if (onEdge(a) && onEdge(b)) continue;
          const n = [-(b.z - a.z) / L, 0, (b.x - a.x) / L];
          accQuad(bank, [a.x, -2.5, a.z], [b.x, -2.5, b.z], [b.x, SW_TOP, b.z], [a.x, SW_TOP, a.z], n, [[0, 0], [L, 0], [L, 1], [0, 1]]);
        }
      }
    }
    for (const w of lakes) {
      group.add(createFlatPolygonMesh(w.pts, CITY_BOUNDS.waterLevel, waterMat, true));
      for (let i = 0; i < w.pts.length; i++) {
        const a = w.pts[i], b = w.pts[(i + 1) % w.pts.length];
        const L = Math.hypot(b.x - a.x, b.z - a.z);
        if (L < 0.01) continue;
        const n = [-(b.z - a.z) / L, 0, (b.x - a.x) / L];
        accQuad(bank, [a.x, -2.5, a.z], [b.x, -2.5, b.z], [b.x, SW_TOP, b.z], [a.x, SW_TOP, a.z], n, [[0, 0], [L, 0], [L, 1], [0, 1]]);
      }
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
  const wildMat = createTerrainMaterial();
  const blockSidewalks = []; // { cx, cz, w, d, block, cover } axis-aligned cover of each island (street-details.js)
  const roadSidewalks = []; // rectangles inside the curbs that bound the roads (road-network.js)
  const geos = { curb: [], walk: [], lawn: [], plot: [], wild: [], paved: [], rail: [] };
  // Downtown is concrete to the building line: the core from Spadina to Parliament between the lake & Bloor, and
  // anywhere else a block holds towers or big buildings. Houses keep their front lawns.
  const blockBuilt = new Map(); // block -> { n, area, top }
  for (const bl of GEO.buildings) {
    const b = blockAt(bl[0], bl[1]);
    if (!b) continue;
    let area = 0;
    for (const [u0, u1, v0, v1] of bl[3]) area += (u1 - u0) * (v1 - v0);
    const s = blockBuilt.get(b) || { n: 0, area: 0, top: 0 };
    s.n++;
    s.area += area;
    s.top = Math.max(s.top, bl[4]);
    blockBuilt.set(b, s);
  }
  const isPaved = (b) => {
    if (b.cx > -1150 && b.cx < 1500 && b.cz > -2750 && b.cz < 650) return true;
    const s = blockBuilt.get(b);
    // (the massing merges a row of houses into one long footprint: only height tells them from a block of offices)
    return !!s && (s.top >= 20 || (s.top >= 14 && s.area / s.n >= 1500));
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
        const [cx, cz, ang, parts] = GEO.buildings[i];
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
  const parketteTrees = [];
  const BED_R = 1.3;
  let parketteCount = 0;
  // the lawn, path & bed geometry of an island's small parks (null: none), cut to its yard `prop`
  const parkettesOf = (b, prop) => {
    const parks = parksOn.get(b);
    if (!parks) return null;
    const propTris = trianglesXZ(prop);
    const lawn = [], paths = [], beds = [];
    for (const a of parks) {
      const pieces = intersectXZ(trianglesXZ(a.pts), propTris);
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
          if (piece) paths.push(piece);
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
  // --- end Toronto layer ---
  for (const b of BLOCKS) {
    // kerb ring under the slab (the slab is inset 0.25 m, so the kerb's top & face show)
    geos.curb.push(extrude(createWorldXZShape(b.poly), 0.0, 0.18));
    const inner = offsetPolygonInward(b.poly, 0.25);
    if (!inner) continue;
    if (b.median) {
      geos[tramMedians.has(b) ? 'paved' : 'lawn'].push(extrude(createWorldXZShape(inner), 0.03, SW_TOP - 0.03));
      continue;
    }
    const prop = b.area > 400 ? offsetPolygonInward(b.poly, SW) : null;
    const yard = isRailLand(b) ? 'rail' : b.park > 0.6 ? 'lawn' : b.wild > 0.5 ? 'wild' : isPaved(b) ? 'paved' : 'plot'; // (rail: Toronto layer)
    if (prop) {
      const ring = createWorldXZShape(inner);
      ring.holes.push(new THREE.Path(prop.map((p) => new THREE.Vector2(p.x, -p.z))));
      geos.walk.push(extrude(ring, 0.03, SW_TOP - 0.03));
      geos[yard].push(flatShape(prop, SW_TOP - 0.002));
      const pk = yard === 'paved' || yard === 'plot' ? parkettesOf(b, prop) : null; // (Toronto layer: the small parks)
      if (pk) {
        geos.lawn.push(pk.lawn);
        if (pk.paths) geos.paved.push(pk.paths);
        if (pk.beds) geos.rail.push(pk.beds);
      }
    } else {
      geos.walk.push(extrude(createWorldXZShape(inner), 0.03, SW_TOP - 0.03));
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
  mergeInto(geos.walk, sidewalkMat, false, 'Walkways');
  mergeInto(geos.lawn, lawnMat, false, 'Lawns');
  mergeInto(geos.plot, plotMat, false, 'Yards');
  mergeInto(geos.paved, createForecourtMaterial(), false, 'Forecourts');
  mergeInto(geos.wild, wildMat, false, 'OpenLand');
  // (the rail lands' gravel bed is also the small parks' mulch, so the beds add no material: Toronto layer)
  mergeInto(geos.rail, new THREE.MeshStandardNodeMaterial({ color: 0x5f5850, roughness: 0.97 }), false, 'RailLands'); // Toronto layer
  window.CITY.parketteTrees = parketteTrees; // (street-details.js plants them)
  console.info(`[cityGrid] ${parketteCount} small parks laid in lawn, ${parketteTrees.length} trees in their beds`);

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
    for (const d of DECKS) {
      const P = d.pts;
      if (P.length < 2) continue;
      // left normal at each vertex (mitred)
      const N = P.map((p, i) => {
        const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
        const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        return [(b.z - a.z) / L, -(b.x - a.x) / L];
      });
      const hw = d.w / 2 + 0.6; // carriageway + the parapets' footing
      const yTop = (p) => Math.max(0.03, p.h + 0.03);
      const yBot = (p) => (p.h > 4.6 ? p.h - 1.25 : 0);
      let s = 0;
      for (let i = 0; i + 1 < P.length; i++) {
        const a = P[i], b = P[i + 1];
        const L = Math.hypot(b.x - a.x, b.z - a.z);
        if (L < 0.01) continue;
        const [anx, anz] = N[i], [bnx, bnz] = N[i + 1];
        const aL = [a.x + anx * hw, yTop(a), a.z + anz * hw], aR = [a.x - anx * hw, yTop(a), a.z - anz * hw];
        const bL = [b.x + bnx * hw, yTop(b), b.z + bnz * hw], bR = [b.x - bnx * hw, yTop(b), b.z - bnz * hw];
        accQuad(top, aR, bR, bL, aL, [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        // side faces & soffit
        const lo = (p, side) => [p[0], side, p[2]];
        // (wound to face outward & down: the deck read hollow from the street, its far side's inner face seen through
        // a missing soffit)
        accQuad(faces, aL, bL, lo(bL, yBot(b)), lo(aL, yBot(a)), [anx, 0, anz], [[s, 1], [s + L, 1], [s + L, 0], [s, 0]]);
        accQuad(faces, bR, aR, lo(aR, yBot(a)), lo(bR, yBot(b)), [-anx, 0, -anz], [[s + L, 1], [s, 1], [s, 0], [s + L, 0]]);
        if (a.h > 4.6 && b.h > 4.6) accQuad(faces, lo(aL, yBot(a)), lo(bL, yBot(b)), lo(bR, yBot(b)), lo(aR, yBot(a)), [0, -1, 0], [[0, 1], [1, 1], [1, 0], [0, 0]]);
        // parapets (0.9 m concrete barriers) along both edges
        for (const sgn of [1, -1]) {
          const ax = a.x + anx * (hw - 0.25) * sgn, az = a.z + anz * (hw - 0.25) * sgn;
          const bx = b.x + bnx * (hw - 0.25) * sgn, bz = b.z + bnz * (hw - 0.25) * sgn;
          if (a.h > 0.4 || b.h > 0.4) accWall(faces, ax, az, bx, bz, Math.min(yTop(a), yTop(b)), 0.9, 0.4);
        }
        // piers under the raised stretch, every ~24 m, moved along (or left out) where they'd stand in a road below
        for (let t = Math.ceil(s / 24) * 24 - s; t < L; t += 24) {
          for (const shift of [0, 4, -4, 8, -8]) {
            const tt = t + shift;
            if (tt < 0 || tt > L) continue;
            const h = a.h + ((b.h - a.h) * tt) / L;
            if (h < 4.6) break;
            const x = a.x + ((b.x - a.x) * tt) / L, z = a.z + ((b.z - a.z) * tt) / L;
            if (onGroundRoad(x, z, 1.2) || onRail(x, z, 3.2)) continue;
            if (window.CITY.subwayKeepsClear && window.CITY.subwayKeepsClear(x, z)) continue; // (subway.js: its own piers)
            piers.push({ x, z, h: h - 1.25, w: Math.min(d.w * 0.7, 9), ux: (b.x - a.x) / L, uz: (b.z - a.z) / L });
            break;
          }
        }
        s += L;
      }
    }
    for (const p of piers) {
      // a column and its crosshead across the deck
      accWall(faces, p.x - p.ux * 0.7, p.z - p.uz * 0.7, p.x + p.ux * 0.7, p.z + p.uz * 0.7, 0, p.h, 1.6);
      accWall(faces, p.x + p.uz * p.w * 0.5, p.z - p.ux * p.w * 0.5, p.x - p.uz * p.w * 0.5, p.z + p.ux * p.w * 0.5, p.h - 1.4, 1.4, 1.6);
      colliders.push({ minX: p.x - 1.0, maxX: p.x + 1.0, minZ: p.z - 1.0, maxZ: p.z + 1.0, maxY: p.h });
    }
    const gt = accGeometry(top);
    if (gt) {
      const m = new THREE.Mesh(gt, roadMat);
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
    if (window.CITY.DEBUG_ROADS !== false) console.info(`[ground] ${DECKS.length} flyover decks & ramps, ${piers.length} piers`);
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
  group.traverse((o) => {
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) maskRoadCuts(m);
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
          const capA = bA && bA.w >= 0.5 ? 0.12 : Math.min(PARAPET, -a.h * 2), capB = bB && bB.w >= 0.5 ? 0.12 : Math.min(PARAPET, -b.h * 2);
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
            colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, minY: Math.min(a.h, b.h) - 1, maxY: Math.min(ta, tb), obb: { cx, cz, hx, hz, cs, sn } });
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
        for (const p of ring) p.y = cutAt(p.x, p.z);
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
    for (const [A, mat, name] of mats) {
      const g = accGeometry(A);
      if (!g) continue;
      g.computeVertexNormals();
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

Object.assign(window.CITY, { buildCityGrid, maskRoadCuts, batchStaticGroupMeshes, offsetPolygonInward, createExtrudedPolygonMesh, createFlatPolygonMesh, createWorldXZShape });
})();
