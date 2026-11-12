(function () {
// js/waterfront-island-garden-cover.js
// Source-constrained GENERIC low-cover APPROXIMATION for the photographed Oneida/Ojibway cottage frontages (bead
// st-sb3r.37, phase 2 trial). Bounded, REVIEWED patches only; no species, no hedge/flowerbed objects; no understory
// inferred from tall returns; the plant height/shape is an explicit photo-informed approximation, not an observed 1-5 m
// plant.
//
// SOURCE REVIEW: the captain inspected the City 2024 8 cm orthophoto at native resolution over all 24 candidate patches
// ($WATERFRONT_RESEARCH/garden-captain-source-review.txt). EIGHT patches (candidate indices 1, 2, 6, 7, 10, 13, 15, 16 —
// 263 candidate cells) were accepted as visibly planted/vegetated yard surfaces with no obvious roofs/decks; the other 16
// were withheld as ambiguous. Acceptance is bound to THIS candidate dataset by a content hash, checked at build time. The
// builder never rewrites the approval: a regenerated dataset with a different cell set has a different hash and this
// module refuses to plant (strict no-op) until a new review re-binds it.
//
// WHAT IT DRAWS: one instanced generic rounded "low shrub" per ACCEPTED cell (never a patch bounding box), reusing
// js/park-cover.js's 14-card crown geometry + shaded foliage material for both LODs. The raster cells are an EVIDENCE
// MASK, not individual plant positions: the first trial planted every cell at its exact centre with ONE fixed height and
// width, which the captain's screenshot showed reading as identical shrubs in regular grid rows. This refine keeps the
// same 8 patches / 263 cells / hash / placement mask but gives each cell a DETERMINISTIC, stable-hash representative
// height, width and yaw plus a small within-cell jitter, so the mass reads as natural patches, not a plantation. The
// crown's own XZ radius plus the jitter offset is kept inside the cell's half-width (0.5 m), so no shrub spills into an
// unapproved cell or a path. Near/far + distance culling use the distance to the NEAREST REVIEWED PATCH (not the world
// origin — the island is ~2.5 km from origin). One InstancedMesh per LOD (two draw calls), no per-plant mesh/material.
// No ground height change, no collider, no path/routing change.
//
// WIRING (captain owns the loader/main insertion): after the scene exists,
//   const garden = await CITY.buildIslandGardenCover(scene);   // adds its group to `scene` and returns the handle
//   // each frame: garden?.update(camera.position);
// It returns `{ group, update(cameraPosition), layout, dispose() }`, or `null` (strict no-op) on wrong frame/projection,
// absent data, or a hash/set mismatch. The group starts hidden; the captain sets `group.visible = true` after a render
// check. Calling it again returns the SAME live handle (idempotent); `dispose()` detaches and frees, and a later build
// makes a fresh one.

const C = window.CITY || (window.CITY = {});

const SOURCE_STATUS = 'captain-source-reviewed-2026-11-10';
// Generic, photo-informed representative cover: explicit approximation, never a source measurement. The cell is 1 m, so
// its half-width (`cellInradiusM`) is 0.5 m. Each shrub's rendered crown radius (maxCrownRadiusM = 0.4, allowed up to
// 0.48) PLUS its within-cell jitter stays <= cellInradiusM, so the entire crown remains inside the one original cell and
// never spills into an unapproved cell or a path. Heights are representative of low garden cover (0.65-1.2 m); this is an
// explicit approximation, NOT a lidar-measured plant height. Widths and yaws vary per cell to read as natural patches.
const APPROX = {
  cellInradiusM: 0.5, // the original coarse cell's half-width; crown radius + jitter must stay inside this
  minHeightM: 0.65, maxHeightM: 1.2, // representative low garden cover (explicit approximation, not a lidar measurement)
  minCrownRadiusM: 0.24, maxCrownRadiusM: 0.4, // rendered crown XZ radius; width variation, capped for the cell constraint
  minWidthScale: 0.78, maxWidthScale: 1.0, // secondary (Z) width variation, relative to the crown radius
  maxJitterM: 0.09 // within-cell offset (<= ~0.1 m); crown radius + this <= cellInradiusM
};
const LOD_NEAR_M = 55; // full rounded shrubs within this distance of the nearest reviewed patch
const CULL_M = 150; // no garden shrubs when the nearest reviewed patch is beyond this
const CULL_MARGIN_M = 24; // hysteresis band so a shrub does not flicker at the cull distance

function data() {
  const D = C.ISLAND_GARDEN_COVER_DATA;
  if (!D || D.kind !== 'island-garden-cover') return null;
  return D;
}

// The approval bound to THIS exact candidate dataset, read from the data itself (set by the builder). No hard-coded hash
// here: the data carries both the reviewed indices and the hash; the two are only trusted together.
function review(D) {
  const r = D && D.reviewSelection;
  if (!r || !Array.isArray(r.acceptedPatches) || typeof r.dataCellsHash !== 'string' || !r.dataCellsHash) return null;
  return r;
}

// sha256 of the candidate cell set — the canonical rows are `patch:x10:z10` in the data's own order. Returns null when
// the data is absent or no crypto API is available (never throws).
async function cellSetHash(D) {
  if (!D || !Array.isArray(D.cells)) return Promise.resolve(null);
  if (!(globalThis.crypto && crypto.subtle)) return Promise.resolve(null);
  const rows = D.cells.map((c) => `${c[3]}:${c[0]}:${c[1]}`).join('\n');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rows));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function projectionMatches(D) {
  const f = C.GEO && C.GEO.frame;
  if (!f || !f.projection || !D.projection) return false;
  const a = f.projection, b = D.projection;
  const keys = ['lat0', 'lon0', 'kx', 'ky', 'theta', 'ox', 'oz'];
  // every value must be finite on BOTH sides; a missing value (undefined) must fail, not coerce to 0 and "match".
  for (const k of keys) { if (!Number.isFinite(a[k]) || !Number.isFinite(b[k])) return false; }
  return keys.every((k) => Math.abs(a[k] - b[k]) < 1e-9);
}

function detailFrame(D) {
  const f = C.GEO && (C.GEO.frame.detail || C.GEO.frame);
  if (!f || ![f.x0, f.x1, f.z0, f.z1].every(Number.isFinite)) return null;
  return f;
}

// The largest offset any shrub can reach from its cell centre: its maximum crown radius plus the maximum within-cell
// jitter. This is the footprint bound the frame gate and any caller must respect.
function maxFootprintM() { return APPROX.maxCrownRadiusM + APPROX.maxJitterM; }

// Every ACCEPTED reviewed cell — plus its full render footprint (crown radius + jitter = `maxFootprintM()`) — must lie
// inside BOTH the committed data's own frame bounds AND the ACTIVE detail frame, with finite bounds on each. A
// missing/absent frame on either side fails: it is never coerced to zero.
function frameCovers(D, cells) {
  const built = D && D.frame;
  const active = detailFrame(D);
  if (!built || ![built.x0, built.x1, built.z0, built.z1].every(Number.isFinite)) return false;
  if (!active) return false;
  const r = maxFootprintM();
  const inside = (c, f) => c.x - r > f.x0 && c.x + r < f.x1 && c.z - r > f.z0 && c.z + r < f.z1;
  return cells.every((c) => inside(c, active) && inside(c, built));
}

// The reviewed, accepted cells: only cells whose patch is in the review's accepted list. Cells are [x10, z10, lane, patch]
// in the data; this is the one place their layout is decoded.
function reviewedCells(D, r) {
  if (!D || !Array.isArray(D.cells) || !r) return [];
  const ok = new Set(r.acceptedPatches);
  return D.cells
    .filter((c) => ok.has(c[3]))
    .map(([x10, z10, lane, patch]) => ({ x: x10 / 10, z: z10 / 10, lane: lane === 0 ? 'oneida' : 'ojibway', patch }));
}

// A bounded plan (no scene, no THREE): what WOULD be planted, only when every gate holds. `hash` is the computed data
// hash; when the data carries a hash the two must match exactly (a null computed hash or a null stored hash is a no-op).
function plan(D, hash) {
  if (!D) return { supported: false, reason: 'ISLAND_GARDEN_COVER_DATA absent' };
  const r = review(D);
  if (!r) return { supported: false, reason: 'no review selection in the data' };
  if (!projectionMatches(D)) return { supported: false, reason: 'projection does not match the source build' };
  if (!(globalThis.crypto && crypto.subtle)) return { supported: false, reason: 'crypto.subtle unavailable; cannot verify the reviewed cell hash' };
  if (!hash) return { supported: false, reason: 'no computed cell-set hash' };
  if (hash !== r.dataCellsHash) return { supported: false, reason: 'candidate cell set differs from the reviewed hash; re-review required' };
  const cells = reviewedCells(D, r);
  if (!cells.length) return { supported: false, reason: 'reviewed patches resolved to no cells' };
  if (!frameCovers(D, cells)) return { supported: false, reason: 'reviewed cells are outside the active frame' };
  // per-patch bounds over the ACCEPTED cells only (for bounded LOD/culling, not for planting area)
  const patches = new Map();
  for (const c of cells) {
    let b = patches.get(c.patch);
    if (!b) { b = { patch: c.patch, minX: c.x, maxX: c.x, minZ: c.z, maxZ: c.z, n: 0 }; patches.set(c.patch, b); }
    b.minX = Math.min(b.minX, c.x); b.maxX = Math.max(b.maxX, c.x);
    b.minZ = Math.min(b.minZ, c.z); b.maxZ = Math.max(b.maxZ, c.z); b.n++;
  }
  return {
    supported: true, cells, acceptedPatches: r.acceptedPatches.slice(),
    patchBounds: [...patches.values()].sort((a, b) => a.patch - b.patch),
    status: r.status || SOURCE_STATUS
  };
}

// Distance from a point to the nearest reviewed patch (its accepted cells), in the XZ ground plane. Bounded: iterate the
// patch bounds' nearest point, not the origin (the island is thousands of metres from the world origin).
function distanceToPatches(patches, x, z) {
  let best = Infinity;
  for (const b of patches) {
    const dx = Math.max(b.minX - x, 0, x - b.maxX);
    const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
    const d = Math.hypot(dx, dz);
    if (d < best) best = d;
  }
  return best;
}

// --- deterministic per-cell representative placement ----------------------------------------------------------------
// A stable 32-bit hash of a cell (its lane/patch and its integer decimetre position), so every rebuild places the SAME
// representative shrub at the SAME cell — no per-rebuild randomness. Uses imul-folded mixing (well-distributed for small
// integers), not a PRNG whose state could drift between builds.
function cellHash(c, salt) {
  let h = 0x9e3779b9 ^ Math.imul((salt | 0) + 1, 0x85ebca6b);
  h = Math.imul(h ^ Math.round(c.x * 10), 0xcc9e2d51);
  h = Math.imul(h ^ Math.round(c.z * 10), 0x1b873593);
  h = Math.imul(h ^ (c.patch | 0), 0x27d4eb2f);
  h = Math.imul(h ^ (c.lane === 'ojibway' ? 0x7f4a7c15 : 0x165667b1), 0x9e3779b1);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
// Map a hash to [0, 1) with a different independent draw per `channel` (0..3), so a cell's height, width, yaw and jitter
// are uncorrelated but each is stable across rebuilds.
function cellUnit(c, channel) {
  return cellHash(c, channel) / 4294967296;
}
const lerp = (a, b, t) => a + (b - a) * t;

// The representative shrub placed on one ACCEPTED cell: a deterministic height, crown radius, secondary width scale,
// yaw and within-cell jitter. Jitter is clamped so crown radius + jitter magnitude <= cellInradiusM: the whole crown stays
// inside the original 1 m cell (the cell's half-width 0.5 m). This is the ONE place the per-cell figure is derived; the
// scene build and the tests both call it, so bounds are tested on the real placement.
function cellFigure(c) {
  const heightM = lerp(APPROX.minHeightM, APPROX.maxHeightM, cellUnit(c, 0));
  const crownRadiusM = lerp(APPROX.minCrownRadiusM, APPROX.maxCrownRadiusM, cellUnit(c, 1));
  const widthScale = lerp(APPROX.minWidthScale, APPROX.maxWidthScale, cellUnit(c, 2));
  const yaw = cellUnit(c, 3) * Math.PI * 2;
  // Jitter: a bounded within-cell offset on a direction from two more hash draws (channels 4 and 5); its magnitude is
  // clipped so that crownRadiusM + jitterM <= cellInradiusM. The real cap depends on THIS cell's crown radius, so a wide
  // cell jitters less (often not at all).
  const jAng = cellUnit(c, 4) * Math.PI * 2;
  const jitterCap = Math.max(0, APPROX.cellInradiusM - crownRadiusM);
  const jitterM = Math.min(APPROX.maxJitterM, jitterCap) * cellUnit(c, 5);
  const jx = Math.cos(jAng) * jitterM, jz = Math.sin(jAng) * jitterM;
  // The exact horizontal reach of the (elliptical) crown from its planted point, largest over its yaw: the crown's own
  // +X radius is crownRadiusM and its +Z radius is crownRadiusM * widthScale, so the reach is the larger of the two.
  const reachM = crownRadiusM * Math.max(1, widthScale);
  return { x: c.x + jx, z: c.z + jz, heightM, crownRadiusM, widthScale, yaw, jitterM, reachM, jx, jz };
}
// The horizontal distance from the CELL CENTRE to the furthest point of a placed shrub's crown (jitter offset + the
// crown's own reach). Must be <= APPROX.cellInradiusM for every accepted cell (checked at build and in tests).
function figureMaxOffsetFromCellCentre(fig) {
  return Math.hypot(fig.jx, fig.jz) + fig.reachM;
}

// --- the drawing (only called with a live scene and a real THREE) -----------------------------------------------------
// The garden shrubs REUSE js/park-cover.js's rounded 14-card crown geometry and its shaded foliage material (the same
// procedural leaf atlas, the same near-camera darkening, the same seasonal helper when available). A trial shrub is a
// real rounded mass, not two flat cards. We only supply per-instance placement and the instanced attributes the shared
// material expects: `aShrub` (atlas tile, centre x/y/z for the near fade) and `aShrubFade` (in/out distances). Nothing
// here names a species: the atlas tile is a generic broadleaf shrub foliation.

// The shared builders live on CITY.parkCover; if a build lacks them (park-cover not loaded) we fall back to a compact
// local rounded-crown copy so the garden layer never depends on load order, but the visual stays the rounded crown.
function shrubGeometryShared(C, near) {
  const p = C.parkCover;
  if (p && typeof p.shrubGeometry === 'function') return p.shrubGeometry(near);
  return fallbackShrubGeometry(C.THREE, near);
}
function shrubMaterialShared(C, near) {
  const p = C.parkCover;
  if (p && typeof p.shrubMaterial === 'function') return p.shrubMaterial(near);
  return fallbackShrubMaterial(C.THREE);
}

// A compact rounded crown (dome of leaf cards, normals from the dome's centre) — the same idea as park-cover's near
// shrub, used only when park-cover's builders are unavailable. Instanced attributes match park-cover's material contract:
// aCard (u, v, tile), aShrub (tile, cx, cy, cz), aShrubFade (near-in, band-in, far-out, band-out).
function fallbackShrubGeometry(THREE, near) {
  const pos = [], nrm = [], uvA = [], idx = [];
  let sd = 3; const r = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  const quad = (c, ux, uy, n) => {
    const o = pos.length / 3;
    for (const [a, b] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      pos.push(c[0] + ux[0] * a + uy[0] * b, c[1] + ux[1] * a + uy[1] * b, c[2] + ux[2] * a + uy[2] * b);
      nrm.push(n[0], n[1], n[2]); uvA.push(a + 0.5, b + 0.5, 0);
    }
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  };
  const CARDS = near ? 14 : 3;
  for (let k = 0; k < CARDS; k++) {
    const a = k * 2.39996, el = Math.acos(1 - (k + 0.5) / CARDS) * 0.95;
    const dir = [Math.cos(a) * Math.sin(el), Math.cos(el), Math.sin(a) * Math.sin(el)];
    const c = [dir[0] * 0.33, 0.45 + dir[1] * 0.42, dir[2] * 0.33];
    const sc = 0.62 + 0.25 * r(), tw = r() * 6.283;
    let ux = [-dir[2], 0, dir[0]]; const ul = Math.hypot(ux[0], ux[2]) || 1; ux = [ux[0] / ul, 0, ux[2] / ul];
    const uy = [dir[1] * ux[2] - dir[2] * 0, dir[2] * ux[0] - dir[0] * ux[2], dir[0] * 0 - dir[1] * ux[0]];
    const cu = Math.cos(tw), su = Math.sin(tw);
    const rx = ux.map((v, i) => (v * cu + uy[i] * su) * sc), ry = ux.map((v, i) => (-v * su + uy[i] * cu) * sc);
    quad(c, rx, ry, dir);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.normalizeNormals();
  g.setAttribute('aCard', new THREE.Float32BufferAttribute(uvA, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
function fallbackShrubMaterial(THREE) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d');
  const greens = ['#4f7a34', '#5f8a3d', '#436b2c'];
  let seed = 1234567; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 34; i++) { g.fillStyle = greens[(i * 7) % 3]; g.globalAlpha = 0.85; g.beginPath(); g.ellipse(6 + rnd() * 52, 12 + rnd() * 48, 6 + rnd() * 6, 3.5 + rnd() * 4, rnd() * Math.PI, 0, Math.PI * 2); g.fill(); }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
  mat.userData.gardenLeafTexture = true;
  return mat;
}

// The actual XZ radius of a geometry's vertices (metres at unit instance scale). Used to map a per-cell representative
// crown radius onto the shared geometry so a scaled rounded crown never spills past the reviewed cell's clearance.
function geometryXZRadius(geo, fallback) {
  const a = geo && geo.attributes && geo.attributes.position;
  if (!a || !a.array) return fallback;
  const p = a.array;
  let mx = 0;
  for (let i = 0; i + 2 < p.length; i += 3) { const r = Math.hypot(p[i], p[i + 2]); if (r > mx) mx = r; }
  return mx > 0 ? mx : fallback;
}
function geometryYExtent(geo, fallback) {
  const a = geo && geo.attributes && geo.attributes.position;
  if (!a || !a.array) return fallback;
  const p = a.array;
  let mx = 0;
  for (let i = 1; i < p.length; i += 3) if (p[i] > mx) mx = p[i];
  return mx > 0 ? mx : fallback;
}

// The true horizontal reach of a placed crown from its planted point, measured from the geometry's real vertices after
// the SAME scale (XZ by crownRadius, Z by widthScale) and yaw the instance matrix uses. This is stricter than the nominal
// crown radius: the rounded geometry's verts can sit a hair outside the nominal radius after scaling, and the yaw mixes
// the X/Z axes, so we take the max over all verts. The real-vertex value is what the inside-the-cell bound relies on.
function placedCrownReach(geo, fig) {
  const a = geo && geo.attributes && geo.attributes.position;
  if (!a || !a.array) return Math.hypot(fig.crownRadiusM, fig.crownRadiusM * fig.widthScale);
  const p = a.array, geoR = geometryXZRadius(geo, 1);
  const sx = fig.crownRadiusM / Math.max(1e-6, geoR), sz = (fig.crownRadiusM * fig.widthScale) / Math.max(1e-6, geoR);
  const cy2 = Math.cos(fig.yaw), sy2 = Math.sin(fig.yaw);
  let mx = 0;
  for (let i = 0; i + 2 < p.length; i += 3) {
    const x = p[i] * sx, z = p[i + 2] * sz;
    const rx = x * cy2 + z * sy2, rz = -x * sy2 + z * cy2; // yaw about +Y (three.js Object3D/Euler order)
    const r = Math.hypot(rx, rz);
    if (r > mx) mx = r;
  }
  return mx > 0 ? mx : Math.hypot(fig.crownRadiusM, fig.crownRadiusM * fig.widthScale);
}

let built = null;

// The captain's one call: build, add the group to `scene`, return the handle (or null on any disqualifying gate).
async function buildIslandGardenCover(scene, { THREE = C.THREE, force = false } = {}) {
  if (!scene || !THREE) return null;
  const D = data();
  const hash = await cellSetHash(D);
  const p = plan(D, hash);
  if (!p.supported) return null;
  if (built && !force && built.scene === scene) return built; // idempotent: same live handle
  if (built) built.dispose(); // a different scene / forced: free the old one first

  // Reuse park-cover's rounded shrub geometry + shaded material for both LODs; we supply the instanced attributes the
  // shared material reads (aShrub tile + centre, aShrubFade near/far) and one matrix per accepted cell.
  const N = p.cells.length;
  const nearGeo = shrubGeometryShared(C, true), farGeo = shrubGeometryShared(C, false);
  const nearMat = shrubMaterialShared(C, true), farMat = shrubMaterialShared(C, false);
  // Each LOD mesh has its OWN aShrub / aShrubFade (the near mesh must stay visible up close; a single shared fade would
  // hide both at close range). The contracts match park-cover.js buildShrubs: near = [-1e6, 1, LOD_NEAR_M, BAND], far =
  // [LOD_NEAR_M, BAND, CULL_M, BAND].
  const NEAR_BAND = 14, FAR_BAND = 24;
  const fadeNear = [-1e6, 1, LOD_NEAR_M, NEAR_BAND];
  const fadeFar = [LOD_NEAR_M, NEAR_BAND, CULL_M, FAR_BAND];
  const aShrubNear = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
  const aFadeNear = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
  const aShrubFar = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
  const aFadeFar = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
  nearGeo.setAttribute('aShrub', aShrubNear); nearGeo.setAttribute('aShrubFade', aFadeNear);
  farGeo.setAttribute('aShrub', aShrubFar); farGeo.setAttribute('aShrubFade', aFadeFar);
  const near = new THREE.InstancedMesh(nearGeo, nearMat, N);
  const far = new THREE.InstancedMesh(farGeo, farMat, N);
  near.frustumCulled = false; far.frustumCulled = false;
  near.castShadow = true; near.receiveShadow = true; far.castShadow = false; far.receiveShadow = true;

  // The shared rounded geometries have their own XZ radius (~0.64 m near, ~0.5 m far) and height (~1.1 m) at unit scale.
  // A per-cell scale maps THIS cell's representative crown radius / height from that geometry; the shared radius is the
  // MAX of the two LODs so BOTH stay within the requested crown radius (never a patch bbox), and the crown radius + jitter
  // is what the per-cell figure guarantees stays inside the original 1 m cell. Height is the explicit approximation.
  const geoXZRadius = Math.max(geometryXZRadius(nearGeo, 0.636), geometryXZRadius(farGeo, 0.5));
  const geoY = Math.max(geometryYExtent(nearGeo, 1.118), geometryYExtent(farGeo, 1));

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const e = new THREE.Euler();
  const TILE = 4; // the generic broadleaf-shrub foliage tile in park-cover's atlas (no species)
  let maxOffset = 0; // the largest cell-centre-to-crown-far-point offset actually placed (for the bound report)
  const figures = [];
  p.cells.forEach((c, i) => {
    const fig = cellFigure(c);
    figures.push(fig);
    // Per-cell representative scale: XZ by this cell's crown radius, Y by this cell's height; the Z axis carries the
    // secondary width variation (the rounded crown is roughly round, so widthScale flattens it slightly).
    const xzScaleX = fig.crownRadiusM / Math.max(1e-6, geoXZRadius);
    const xzScaleZ = (fig.crownRadiusM * fig.widthScale) / Math.max(1e-6, geoXZRadius);
    const yScale = fig.heightM / Math.max(1e-6, geoY);
    // Ground height from the committed rendered-surface sampler when available (never a guessed offset); 0 fallback.
    const surface = typeof C.islandVergeSurfaceAt === 'function' ? C.islandVergeSurfaceAt(fig.x, fig.z) : null;
    const gy = surface && Number.isFinite(surface.h) ? surface.h : 0;
    q.setFromEuler(e.set(0, fig.yaw, 0));
    v.set(fig.x, gy, fig.z);
    sc.set(xzScaleX, yScale, xzScaleZ);
    m.compose(v, q, sc);
    near.setMatrixAt(i, m); far.setMatrixAt(i, m);
    const cy = gy + fig.heightM * 0.5; // the shader reads aShrub.y as the instance's vertical centre
    aShrubNear.setXYZW(i, TILE, fig.x, cy, fig.z); aFadeNear.setXYZW(i, ...fadeNear);
    aShrubFar.setXYZW(i, TILE, fig.x, cy, fig.z); aFadeFar.setXYZW(i, ...fadeFar);
    // The measured horizontal offset of THIS placed crown from its cell centre: the jitter plus the rotated, scaled
    // geometry's true XZ reach (from real verts), not a bounding-box estimate.
    const reach = placedCrownReach(nearGeo, fig);
    maxOffset = Math.max(maxOffset, Math.hypot(fig.jx, fig.jz) + reach);
  });
  near.instanceMatrix.needsUpdate = true; far.instanceMatrix.needsUpdate = true;
  aShrubNear.needsUpdate = true; aFadeNear.needsUpdate = true;
  aShrubFar.needsUpdate = true; aFadeFar.needsUpdate = true;

  const group = new THREE.Group();
  group.name = 'IslandGardenCover';
  group.visible = false; // the captain enables it after a render check
  group.add(far, near);
  scene.add(group);

  // The shared park-cover shrub material measures its distance/LOD from viewerU. High Park's update() sets that only when
  // the viewer is inside its box, so a trial elsewhere would render against the frozen origin (2.5 km away). Set it from
  // our camera each update, through park-cover's shared setter; if a build omits the setter, fall back to the uniform.
  const setViewer = (pos) => {
    const pkc = C.parkCover;
    if (pkc && typeof pkc.updateShrubViewer === 'function') pkc.updateShrubViewer(pos);
  };
  let culled = false; // hysteresis state over the whole layer
  function update(cameraPosition) {
    if (!cameraPosition) return;
    setViewer(cameraPosition);
    const d = distanceToPatches(p.patchBounds, cameraPosition.x, cameraPosition.z);
    const cut = culled ? CULL_M + CULL_MARGIN_M : CULL_M;
    const hide = d > cut;
    if (hide !== culled) culled = hide;
    group.visible = !culled;
    // Do NOT hide one LOD mesh wholesale: the shader fades each INSTANCE by its own distance (aDither over aShrubFade),
    // so both meshes stay visible inside the overall cull and the complementary near/far fades form a smooth hand-off.
    near.visible = true;
    far.visible = true;
    return d; // the nearest-patch distance (useful for a readout)
  }
  // seed the shared viewer to the first patch centroid so a frame rendered before the first update() is not at origin
  setViewer({ x: p.patchBounds[0].minX, y: 0, z: p.patchBounds[0].minZ });

  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    group.removeFromParent();
    // shrubMaterial() builds a NEW material each call, so this trial OWNS nearMat/farMat and must dispose them. The atlas
    // TEXTURE is shared (park-cover's paintAtlas) and owned by park-cover: do not dispose material.map here.
    near.geometry.dispose(); far.geometry.dispose();
    for (const mat of new Set([nearMat, farMat])) { if (mat && mat.dispose) mat.dispose(); }
    near.dispose?.(); far.dispose?.();
    if (built && built.group === group) built = null; // never leave a disposed handle in `built`
  }

  built = {
    scene, group, update, dispose, patchBounds: p.patchBounds,
    layout: layoutFrom(p),
    status: p.status,
    hash,
    // The measured bound: the largest cell-centre-to-crown-far-point offset actually placed (jitter + real-vertex reach).
    // It must stay <= APPROX.cellInradiusM so every rendered crown remains inside its original 1 m cell.
    maxCellOffsetM: maxOffset,
    figures, // per-cell representative { x, z, heightM, crownRadiusM, widthScale, yaw, jitterM, reachM, jx, jz }
    userData: { cells: p.cells.length, patches: p.acceptedPatches, hash, maxCellOffsetM: maxOffset }
  };
  group.userData.gardenCover = built.userData;
  return built;
}

function layoutFrom(p) {
  const D = data();
  return {
    supported: !!p.supported,
    status: p.supported ? (p.status || SOURCE_STATUS) : (p.reason || 'unsupported'),
    cells: p.supported ? p.cells.length : 0,
    patches: p.supported ? p.acceptedPatches : [],
    approximate: { ...APPROX },
    lod: { nearM: LOD_NEAR_M, cullM: CULL_M, marginM: CULL_MARGIN_M },
    rules: D ? D.rules : null
  };
}

// Non-scene audit + plan for tests/review readout (async because the hash is async). No THREE needed.
async function layout() {
  const D = data();
  const hash = await cellSetHash(D);
  return layoutFrom(plan(D, hash));
}
function reviewCells() {
  const D = data();
  const r = review(D);
  return r ? reviewedCells(D, r) : null;
}

C.buildIslandGardenCover = buildIslandGardenCover;
C.islandGardenCoverLayout = layout;
C.islandGardenCoverReviewCells = reviewCells;
C.ISLAND_GARDEN_COVER = {
  status: SOURCE_STATUS, lodNearM: LOD_NEAR_M, cullM: CULL_M, marginM: CULL_MARGIN_M, approximate: APPROX,
  // pure helpers exported for focused tests
  _plan: plan, _review: review, _reviewedCells: reviewedCells, _cellSetHash: cellSetHash,
  _distanceToPatches: distanceToPatches, _projectionMatches: projectionMatches, _frameCovers: frameCovers,
  // deterministic per-cell representative placement (height/width/yaw/jitter) and its inside-the-cell bound
  _cellFigure: cellFigure, _cellHash: cellHash, _cellUnit: cellUnit,
  _figureMaxOffsetFromCellCentre: figureMaxOffsetFromCellCentre, _maxFootprintM: maxFootprintM,
  _geometryXZRadius: geometryXZRadius, _placedCrownReach: placedCrownReach
};
})();
