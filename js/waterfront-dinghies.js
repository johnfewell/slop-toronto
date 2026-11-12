(function () {
// js/waterfront-dinghies.js
// The reviewed QCYC stored-dinghy group (st-sb3r.38, phase 2 runtime trial). Eight open dinghies stored on the apron beside
// the reviewed marina sheds, at the source-measured placements in js/waterfront-dinghies-data.js. Each hull is the real,
// CC0 prepared GLB (assets/models/waterfront-dinghies/boat-row-large-white.glb — white open hull, paddles removed) drawn as
// ONE InstancedMesh: one shared geometry + one shared material, loaded once.
//
// Provenance and limits are unchanged from phase 1: the placements come from a 2024 City orthophoto seasonal storage
// snapshot (reference only), sized/oriented by PCA per bright component; the hull is a GENERIC stand-in, not any specific
// boat, and no current-fleet claim is made. See docs/waterfront-dinghies.md.
//
// API (the captain wires the call; this module never edits main.js, explore.html or the loader):
//   const d = await window.CITY.buildWaterfrontDinghies(THREE, scene);
//   d.group      // the instanced hull group (a static child; the captain may add its own culling root)
//   d.colliders  // [{ minX,maxX,minZ,maxZ,minY,maxY, prop:true, kind:'dinghy', obb }] — the hulls' real oriented footprints
//   d.ready      // true when the real GLB loaded and the instances were built; false = the asset did not load
//   d.layout     // { count, placements, source, frame, reason }
//   d.hulls      // per-instance { x, z, yaw, lengthM, widthM, height }
//
// Honest missing-asset behaviour: if the GLB or the loader is unavailable, the promise resolves to { ready:false, ... }
// with an EMPTY group and NO colliders, and the reason is set. There is NO invented/procedural fallback hull — the group is
// simply absent, so the scene stays exactly as it was.
//
// It is not a no-op only when the data, the loader and the exact detail frame/projection are present; otherwise it returns a
// ready:false layout and adds nothing.

const C = window.CITY || (window.CITY = {});

const MODEL_URL = './assets/models/waterfront-dinghies/boat-row-large-white.glb';
const MODEL_PLAN = { x: 1.428, z: 2.852 }; // the prepared GLB's plan extent (m), +X × +Z
const MODEL_HEIGHT = 0.64;
const MIN_HULL_W = 1.0;

function data() {
  return C.WATERFRONT_DINGHIES_DATA || null;
}

// The data was built in one exact detail projection; a different frame/projection must not reuse these numbers.
function projectionMatches(D) {
  const expected = D && D.projection;
  const actual = C.GEO && C.GEO.frame && C.GEO.frame.projection;
  if (!expected || !actual) return false;
  for (const k of ['lat0', 'lon0', 'kx', 'ky', 'theta', 'ox', 'oz']) {
    const a = actual[k], e = expected[k];
    if (!Number.isFinite(a) || !Number.isFinite(e)) return false;
    if (Math.abs(a - e) > 1e-9 * Math.max(1, Math.abs(e))) return false;
  }
  return true;
}
function inDetailFrame(x, z) {
  const f = C.GEO && C.GEO.frame && C.GEO.frame.detail;
  if (!f) return false;
  return x > f.x0 && x < f.x1 && z > f.z0 && z < f.z1;
}

// The ground at (x, z) where a hull base should sit. Preference order:
//   1. the exact rendered/native ground sampler CITY.islandVergeSurfaceAt(x, z).h (the topmost built surface a raycast
//      would hit), when present — this is what the walkers use;
//   2. otherwise the marina's FLAT ground: y = 0 on this marina (it is not on the raised mainland sidewalk), plus any
//      road cut (CITY.cutAt). It is NOT the raised sidewalk offset (+0.22/+0.004), which would hover the hulls ~22 cm.
function groundAt(x, z) {
  const verge = C.islandVergeSurfaceAt ? C.islandVergeSurfaceAt(x, z) : null;
  if (verge && Number.isFinite(verge.h)) return verge.h;
  return (C.cutAt ? (C.cutAt(x, z) || 0) : 0);
}

// Decode the data rows to hull placements (world x, z, yaw, length, width), or [] on a mismatched frame / absent data.
function decodePlacements(D) {
  if (!D || !Array.isArray(D.rows) || !projectionMatches(D)) return null;
  const gate = D.gates || {};
  const out = D.rows.map((r) => ({
    // rows: [x(dm), z(dm), yaw(mrad), length(cm), width(cm), srcPxX, srcPxY, pixelAxisX, pixelAxisY]
    x: r[0] / 10, z: r[1] / 10, yaw: r[2] / 1000,
    lengthM: r[3] / 100, widthM: r[4] / 100,
    srcPx: [r[5], r[6]]
  })).filter((h) => Number.isFinite(h.x) && Number.isFinite(h.z) && inDetailFrame(h.x, h.z)
    && h.lengthM >= (gate.minHullM || 1.6) && h.lengthM <= (gate.maxHullM || 5.2)
    && h.widthM >= MIN_HULL_W && h.widthM <= (gate.maxHullWidthM || 2.4));
  // Zero valid placements (all outside the active frame / rejected) is NOT a valid build: null, so the caller skips the
  // asset load and returns ready:false rather than loading the GLB and reporting ready with 0 instances.
  return out.length ? out : null;
}

// Load the prepared GLB once and merge its meshes to one BufferGeometry (positions as floats), or null on failure.
function loadHullGeometry(THREE) {
  const { GLTFLoader } = C.Addons || {};
  if (!GLTFLoader) return Promise.resolve(null);
  let loader;
  try { loader = new GLTFLoader(); } catch (e) { return Promise.resolve(null); }
  return loader.loadAsync(MODEL_URL).then((gltf) => {
    const geos = [];
    gltf.scene.updateWorldMatrix(true, true);
    gltf.scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const geo = o.geometry.clone();
      // Meshopt/quantised positions -> floats (same guard as waterfront-details.js)
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
    let out;
    if (geos.length === 1) out = geos[0];
    else {
      const merged = mergeGeometries(THREE, geos);
      for (const g of geos) g.dispose?.();
      out = merged;
    }
    // Normalise: base at y = 0, centred x/z (the GLB already is; keep it robust).
    out.computeBoundingBox();
    const bb = out.boundingBox;
    const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2, by = bb.min.y;
    out.translate(-cx, -by, -cz);
    out.computeBoundingBox();
    out.computeBoundingSphere();
    return out;
  }).catch((e) => { console.warn(`[waterfrontDinghies] hull model did not load (${MODEL_URL}):`, e); return null; });
}

function mergeGeometries(THREE, geos) {
  // Tiny local merge (positions + index only; the hull is white/untextured): avoids importing an addon here.
  let vCount = 0, iCount = 0;
  for (const g of geos) { vCount += g.attributes.position.count; iCount += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) { pos[3 * (vo + i)] = p.getX(i); pos[3 * (vo + i) + 1] = p.getY(i); pos[3 * (vo + i) + 2] = p.getZ(i); if (n) { nor[3 * (vo + i)] = n.getX(i); nor[3 * (vo + i) + 1] = n.getY(i); nor[3 * (vo + i) + 2] = n.getZ(i); } }
    if (g.index) { for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo; io += g.index.count; }
    else { for (let i = 0; i < p.count; i++) idx[io + i] = i + vo; io += p.count; }
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (geos.some((g) => g.attributes.normal)) out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// The build is idempotent: the first call starts it and the resulting promise is cached, so a second call (or a second
// scene.add) reuses the same group/colliders rather than loading the GLB twice. Main calls it once; this guard just makes
// a repeat harmless.
let buildPromise = null;

/**
 * Build the reviewed QCYC dinghy group. Async: resolves once the shared GLB has loaded (or failed).
 * Returns { group, colliders, ready, layout, hulls, geometry }. On a missing asset / loader / data / frame, or with zero
 * valid placements in the active frame, it resolves to a ready:false result with an EMPTY group and NO colliders (no
 * invented fallback, no asset load). Idempotent: repeated calls share one build.
 */
function buildWaterfrontDinghies(THREE = C.THREE, scene = null) {
  if (!buildPromise) buildPromise = buildOnce(THREE, scene);
  return buildPromise;
}

async function buildOnce(THREE, scene) {
  const group = new THREE.Group();
  group.name = 'WaterfrontDinghies';
  const colliders = [];
  const D = data();
  const placements = decodePlacements(D);

  if (!placements) {
    const reason = !D ? 'no data module'
      : (!projectionMatches(D) ? 'frame projection mismatch'
        : (!Array.isArray(D.rows) || !D.rows.length ? 'no rows' : 'no valid placements in the active frame'));
    const layout = { count: 0, placements: 0, source: D && D.source ? D.source.name : null, frame: 'detail', reason };
    if (scene && scene.add) scene.add(group);
    const result = { group, colliders, ready: false, layout, hulls: [], geometry: null };
    C.waterfrontDinghies = result;
    return result;
  }

  const geometry = await loadHullGeometry(THREE);
  if (!geometry) {
    const layout = { count: placements.length, placements: placements.length, source: D.source ? D.source.name : null, frame: 'detail', reason: `hull model did not load (${MODEL_URL})` };
    if (scene && scene.add) scene.add(group);
    const result = { group, colliders, ready: false, layout, hulls: placements, geometry: null };
    C.waterfrontDinghies = result;
    return result;
  }

  // One shared material (flat white hull). No per-instance tint: the source hulls read white.
  const Mat = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
  const material = new Mat({ color: 0xf2f1ec, roughness: 0.82, metalness: 0.0 });

  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  mesh.name = 'WaterfrontDinghies_Hulls';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const hulls = [];
  placements.forEach((h, i) => {
    const y = groundAt(h.x, h.z);
    // The hull's plan long axis (model +Z, length 2.852) is scaled to the measured source length; the short axis (model
    // +X, 1.428) to the source width. Uniform-ish per-instance scale on each axis (the model is a generic hull).
    const scZ = h.lengthM / MODEL_PLAN.z, scX = h.widthM / MODEL_PLAN.x, scY = MODEL_HEIGHT / MODEL_HEIGHT;
    // The GLB's +Z is its length; our yaw is the world long-axis heading (atan2(dx,dz)). Three's yaw about +Y with
    // `setFromAxisAngle(up, yaw)` maps local +Z to (sin yaw, 0, cos yaw) — exactly the data yaw convention.
    q.setFromAxisAngle(up, h.yaw);
    p.set(h.x, y, h.z);
    sc.set(scX, scY, scZ);
    mesh.setMatrixAt(i, m.compose(p, q, sc));
    hulls.push({ x: h.x, z: h.z, y, yaw: h.yaw, lengthM: h.lengthM, widthM: h.widthM, height: MODEL_HEIGHT * scY });
    // Real oriented hull collider (the measured plan), so walkers meet the hull, not a point. Height is the visual
    // hull top; the shared physics is untouched (these are ordinary prop colliders like the beach chairs).
    const hx = h.widthM / 2, hz = h.lengthM / 2;
    const cs = Math.cos(h.yaw), sn = Math.sin(h.yaw);
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    colliders.push({
      minX: h.x - ex, maxX: h.x + ex, minZ: h.z - ez, maxZ: h.z + ez,
      minY: y, maxY: y + MODEL_HEIGHT * scY, prop: true, kind: 'dinghy',
      obb: { cx: h.x, cz: h.z, hx, hz, cs, sn }
    });
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox?.();
  mesh.computeBoundingSphere?.();
  // Cheap culling: the group is small and static; flag a modest cull distance/cell for a future culling root.
  mesh.userData.cullDistance = 650;
  mesh.userData.cullCell = 120;
  group.add(mesh);

  const layout = {
    count: placements.length, placements: placements.length,
    source: D.source ? D.source.name : null, acquisition: D.source ? D.source.acquisition : null,
    licence: D.source ? D.source.licence : null, asset: MODEL_URL,
    hullLengthM: { min: Math.min(...hulls.map((h) => h.lengthM)), max: Math.max(...hulls.map((h) => h.lengthM)) },
    hullWidthM: { min: Math.min(...hulls.map((h) => h.widthM)), max: Math.max(...hulls.map((h) => h.widthM)) },
    geometry: { triangles: geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3 },
    frame: 'detail', reason: null
  };
  if (scene && scene.add) scene.add(group);
  const result = { group, colliders, ready: true, layout, hulls, geometry };
  C.waterfrontDinghies = result;
  console.info(`[waterfrontDinghies] ${hulls.length} stored dinghies (mean ${(hulls.reduce((s, h) => s + h.lengthM, 0) / hulls.length).toFixed(2)} m), ${colliders.length} colliders`);
  return result;
}

// A pure synchronous layout for tests/audits: the placements the builder would draw, with no load and no scene.
function waterfrontDinghiesLayout() {
  const D = data();
  const placements = decodePlacements(D);
  if (!placements) return { loaded: !!D, supported: false, count: 0, placements: [] };
  return {
    loaded: true, supported: true, count: placements.length, placements,
    source: D.source ? D.source : null, gates: D.gates || null, asset: MODEL_URL,
    assetPlan: MODEL_PLAN, assetHeight: MODEL_HEIGHT
  };
}

// --- Trial gate + tree keep-out (st-sb3r.38) ------------------------------------------------------------------------
// Accepted source placements are enabled by default; ?dinghies=0 disables both hulls and generic-tree reconciliation.
function dinghiesEnabled() {
  const search = typeof window !== 'undefined' && window.location ? String(window.location.search || '') : '';
  const flag = search.match(/(?:^|[?&])dinghies=([^&]*)(?:&|$)/);
  return !flag || flag[1] === '1';
}

/**
 * Pure, frame-safe test: is the point (x, z) inside — or within `margin` m of — any placed hull's EXACT oriented footprint?
 * Returns { inside, hullIndex, dist } where `dist` is the point's distance to the oriented rectangle boundary (0 inside).
 * Returns { inside:false, hullIndex:-1, dist:Infinity } when the data is absent, the active frame projection does not match
 * the build, or there are no valid placements in the active frame — i.e. never claims a keep-out on the wrong frame.
 * `placements` are world { x, z, yaw, lengthM, widthM }; the hull's long axis is at `yaw` (model +Z heading convention).
 */
function waterfrontDinghyKeepout(x, z, margin = 0.25) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return { inside: false, hullIndex: -1, dist: Infinity };
  const placements = decodePlacements(data());
  if (!placements) return { inside: false, hullIndex: -1, dist: Infinity };
  let best = { inside: false, hullIndex: -1, dist: Infinity };
  placements.forEach((h, i) => {
    // local coords in the hull's own frame: u across (model +X, width), v along (model +Z, length)
    const dx = x - h.x, dz = z - h.z;
    const cs = Math.cos(h.yaw), sn = Math.sin(h.yaw);
    // world long axis (ux,uz) = (sin yaw, cos yaw); across axis (wx,wz) = (cos yaw, -sin yaw)
    const u = dx * cs - dz * sn;   // across (width)
    const v = dx * sn + dz * cs;   // along (length)
    const hu = h.widthM / 2, hv = h.lengthM / 2;
    // distance to the oriented rectangle boundary (positive outside on both axes), minus the margin
    const du = Math.max(Math.abs(u) - hu, 0), dv = Math.max(Math.abs(v) - hv, 0);
    const dist = Math.hypot(du, dv); // 0 when inside
    if (dist <= margin && (best.hullIndex < 0 || dist < best.dist)) best = { inside: true, hullIndex: i, dist };
  });
  return best;
}

// Is a raw generated-tree entry a MAPPED/source tree (never erased for a hull), as opposed to generic scatter? A mapped
// tree carries a model id, a height, an oid/sourceId, or is the residential/marina canopy / an HTO plan tree / a wooded
// park lidar tree. Generic scatter from street-details.js carries only { x, y, z, scale, species, tier }.
function isMappedOrSourceTree(t) {
  return !!(t && (t.model || Number.isFinite(t.height) || t.oid != null || t.sourceId != null
    || t.htoPlan || t.residentialCanopy || t.woods));
}

Object.assign(C, {
  buildWaterfrontDinghies,
  waterfrontDinghiesLayout,
  waterfrontDinghyKeepout,
  waterfrontDinghiesEnabled: dinghiesEnabled,
  waterfrontDinghyIsMappedTree: isMappedOrSourceTree,
  WATERFRONT_DINGHIES_MODEL_URL: MODEL_URL
});
})();
