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
  blockAt
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
  mergeInto(geos.curb, curbMat, true, 'Kerbs');
  mergeInto(geos.walk, sidewalkMat, false, 'Walkways');
  mergeInto(geos.lawn, lawnMat, false, 'Lawns');
  mergeInto(geos.plot, plotMat, false, 'Yards');
  mergeInto(geos.paved, createForecourtMaterial(), false, 'Forecourts');
  mergeInto(geos.wild, wildMat, false, 'OpenLand');
  mergeInto(geos.rail, new THREE.MeshStandardNodeMaterial({ color: 0x5f5850, roughness: 0.97 }), false, 'RailLands'); // Toronto layer

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
            if (onGroundRoad(x, z, 1.2)) continue;
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

  // Every road, the expressways and the flyovers included, carries the street traffic (road-network.js): no separate
  // highway lanes
  const highwayLanes = [];

  scene.add(group);
  window.CITY.sidewalkBlocks = blockSidewalks;
  return { group, sidewalks: roadSidewalks, footprints, highwayLanes, colliders };
}

Object.assign(window.CITY, { buildCityGrid, batchStaticGroupMeshes, offsetPolygonInward, createExtrudedPolygonMesh, createFlatPolygonMesh, createWorldXZShape });
})();
