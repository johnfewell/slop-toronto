(function () {
// js/biidaasige-play-infrastructure.js
// Biidaasige Park — source-matched TIMBER PLAY INFRASTRUCTURE and its ground finishes (bead st-bmyv.9, child of st-bmyv).
// Owns only this file, its test and its doc. It does NOT edit the adventure, Dodem, ground, terrain, path, park-data or
// shared-runtime modules owned by other workers, and it binds no site coordinates: every structure is LOCAL ORIGIN.
//
// WHAT IS SOURCED AND WHAT IS ESTIMATED
//   * FACT   — the Cableway Canyon runs are 20 m and 40 m (City of Toronto, Recreation at Biidaasige Park).
//   * FACT   — Swing Hill is a swing zone on the City park map (no per-swing count is published).
//   * FACT   — the timber play structures were made by WholeTrees (oversized White Oak inverted-trident trees with
//              log circuits, balancing and beam structures; manufacturer press release, Blue Medium, 2024).
//   * PHOTO  — the identifiable inverted-trident cluster is SIX tall pale weathered trunks ~5-6 m high (slender upper
//              trunk .35-.45 m from a fork ~2.3 m to a flat cut top ~5.4 m; THREE thick flared lower branches forming
//              walk-through arches; NO solid central trunk below the fork), on the woodchip island west of the Owl
//              (captain's primary-photo read + 2025 City 8 cm ortho). Built by buildBiidaasigeInvertedTrees.
//   * PHOTO  — the captain's authoritative read of the CSLA photograph (captain/cableway-csla.jpg, viewed, never
//              reproduced): RUSTIC NATURAL GREY TIMBER A-frames, ~4 m high, legs ~0.23 m diameter, foot spread ~4 m at
//              the near and far ends; a steel cable between the apexes with a black trolley and a hanging round rubber
//              seat; a curved elongated red-terracotta + cream RUBBER corridor ~5 m wide with a slight bowl and wavy
//              mound ends; curved stone edging; boulder clusters at the entry; an adjacent woodchip area behind a LOW
//              pale-chestnut picket fence (~0.65 m) on two thin wire strands with a wide open entry to the corridor.
//   * ESTIMATE — every other dimension below (pole section, seat size, rubber thickness, counts, corridor length,
//              mound amplitude, boulder/boulder sizes, fence heights, log tangle width). Explicitly labelled in
//              `estimates`; not surveyed, not a mapped count.
//
// CONTRACT
//   * Exports: C.buildBiidaasigeCableway(lengthM, opts), C.buildBiidaasigeSwingSet(opts),
//     C.buildBiidaasigeTimberPlay(opts). Each returns { group, colliders, surfaces, triangles, surfaceHeightAt? }.
//   * Pure CPU geometry: no scene, no network, no image read. Materials are plain MeshStandardNodeMaterial (no TSL
//     graph, so a test can build it), merged to < 10 draw calls per setup.
//   * Local origin at the ground contact, Y up, 1 unit = 1 m, structure long axis along +Z (front +Z).
//   * `surfaces` is the repo format: [{ triangle: [x,y,z, x,y,z, x,y,z], kind }] in LOCAL coordinates (the caller's
//     placement transforms them, e.g. CITY.biidaasigeAddModel). Every entry is an actual rendered triangle, upward
//     (+Y) wound, so a ray test and the query agree.
//   * `surfaceHeightAt(x, z, opts)` answers the EXACT rendered triangle height (barycentric on the merged surfaces) —
//     never an analytic approximation. It returns null off the surfaces. `opts.baseY`/`opts.maxRise` gate a step.
//   * `colliders` are SOLID props only (posts, legs, the swing frame, the log-bundle bounds, the fence run), tagged
//     prop: true; clear paths stay clear. A ground finish is never a collider box.
//   * Cableway lengthM must be 20 or 40 (the published facts). Any other value is REFUSED (a thrown RangeError naming
//     the accepted lengths) rather than quietly clamped to a length the City did not build.
//   * Nothing is placed in the world. buildBiidaasigeInvertedTrees (the six-unit identifiable cluster) and the
//     buildBiidaasigeTimberPlay local preview compose the local parts; the captain registers a position and passes the
//     anchor plugin (see docs).

const C = (typeof window !== 'undefined' && (window.CITY || (window.CITY = {}))) || {};
const THREE = C.THREE;

// ------------------------------------------------------------------------------------------------
// Source facts + photo-estimate defaults (1 unit = 1 m)
// ------------------------------------------------------------------------------------------------
const CABLEWAY_LENGTHS_M = Object.freeze([20, 40]);   // FACT: the two published Cableway Canyon runs

const CABLEWAY_SPEC = {
  // PHOTO: rustic natural grey timber A-frames
  frameHeightM: 4.0,        // PHOTO ~4 m (apex height)
  legDiameterM: 0.23,       // PHOTO ~0.23 m
  footSpreadM: 4.0,         // PHOTO ~4 m at the near and far ends (the legs' feet)
  legLeanDeg: 14,           // ESTIMATE: the A-frame's splay (legs bow outward from the apex)
  boltDiameterM: 0.34,      // ESTIMATE: a timber hub / cross-bolt at the apex
  // PHOTO: cable, trolley, hanging seat
  cableDiameterM: 0.022,    // ESTIMATE: a ~3/4" steel cable
  trolleyWidthM: 0.26,      // ESTIMATE: the black trolley wheels' block
  trolleyHeightM: 0.22,
  hangerLengthM: 2.2,       // ESTIMATE: cable drop from the trolley to the seat's chain
  seatDiameterM: 0.36,      // ESTIMATE: "round rubber disc", ~36 cm
  seatThicknessM: 0.05,
  chainCount: 2,            // ESTIMATE: two short chains between the hanger and the seat
  // PHOTO: the curved elongated rubber corridor, ~5 m wide, bowl cross-section, wavy mound ends
  corridorWidthM: 5.0,      // PHOTO ~5 m
  corridorLengthExtraM: 3.0,// ESTIMATE: the corridor runs this much past each A-frame's foot
  corridorThicknessM: 0.06, // ESTIMATE: poured rubber thickness
  corridorBowlM: 0.14,      // ESTIMATE: the slight bowl across the width
  moundAmplitudeM: 0.30,    // ESTIMATE: the wavy mound ends
  moundLengthM: 2.6,        // ESTIMATE: each mound's run
  corridorSegments: 12,     // ESTIMATE: the bowl's strip count across the width
  corridorSteps: 34,        // ESTIMATE: the length sampling of the wavy profile
  // PHOTO: curved stone edging + boulder clusters at the entry
  edgingWidthM: 0.24,       // ESTIMATE: flat stone edging width
  edgingHeightM: 0.10,      // ESTIMATE
  boulderCount: 7,          // PHOTO shows clusters at BOTH entries; counts are not mapped -> ESTIMATE
  boulderRadiusMinM: 0.24,  // ESTIMATE
  boulderRadiusMaxM: 0.55,  // ESTIMATE
};

const SWING_SPEC = {
  // An A-frame swing set (ESTIMATE: a timber frame in the Swing Hill zone). No official swing count is published:
  // the default 3 is a labeled OPTION, not the park's total.
  defaultSwingCount: 2,     // the 2025 ortho pads read as small frames; 1 or 2 seats is the caller's choice (ESTIMATE)
  maxSwingCount: 3,         // a caller cap so a single pad frame stays plausible (ESTIMATE)
  frameHeightM: 3.0,        // ESTIMATE
  legDiameterM: 0.16,       // ESTIMATE
  footSpreadM: 2.2,         // ESTIMATE: each pair of legs splays to this span
  bayWidthM: 2.4,           // ESTIMATE: one swing bay
  swingSeatWidthM: 0.55,    // ESTIMATE
  chainLengthM: 2.25,       // ESTIMATE
  groundFinishM: 1.0,       // ESTIMATE: woodchip apron each side of the frame
};

const TIMBER_SPEC = {
  // WholeTrees inverted-trident White Oak (captain's read of the primary photo + 2025 City ortho):
  // SIX tall pale weathered trunks ~5-6 m high. A slender upper trunk (~0.35-0.45 m) runs from a fork at ~2.3 m up to
  // an irregular flat cut top at ~5.4 m. THREE thick tapering flared lower branches reach the ground ~3 m across and
  // form walk-through arches. There is NO solid central trunk from 0 to the fork: the central arch space stays empty.
  unitCount: 6,                 // PHOTO: six upper stems across the primary photo (x 560,645,685,760,820,900)
  upperTrunkDiameterM: 0.40,    // PHOTO .35-.45 m
  upperTrunkDiameterMinM: 0.35,
  upperTrunkDiameterMaxM: 0.45,
  forkHeightM: 2.3,             // PHOTO ~2.3 m (where the three lower branches leave the upper trunk)
  topHeightM: 5.4,              // PHOTO ~5.4 m (irregular flat cut top)
  heightMinM: 5.0,              // PHOTO range 5-6 m
  heightMaxM: 6.0,
  branchCount: 3,               // PHOTO: three thick lower branches
  branchRootDiameterM: 0.34,    // ESTIMATE: thick at the fork
  branchTipDiameterM: 0.12,     // ESTIMATE
  footFlareDiameterM: 0.30,     // ESTIMATE: flared foot at the ground
  footSpreadM: 3.0,             // PHOTO ~3 m ground spread
  archClearM: 2.0,              // PHOTO ~2 m walk-through arch
  nodeBulge: 0.16,              // ESTIMATE: bulging nodes (fractional radius)
  clusterAcrossM: 5.0,          // PHOTO/ortho: compact cluster ~5 m across
  clusterAlongM: 8.0,           // PHOTO/ortho: compact cluster ~8 m along
  // Generic local-preview extras (NOT the identifiable site; the site uses buildBiidaasigeInvertedTrees)
  archCount: 2,
  archSeparationM: 3.6,
  logCount: 6,
  logLengthM: 2.0,
  logDiameterM: 0.20,
  circuitRadiusM: 3.4,
  damLogCount: 11,
  damWidthM: 2.5,
  damLogDiameterM: 0.16,
};

// Default photo-estimated staggered layout for the SIX units: a compact cluster ~5 m across (X) and ~8 m along (Z),
// not a generic huge ring. Individual heights/yaws are explicit ESTIMATES (5.0-5.8 m, within the 5-6 m photo range).
const DEFAULT_INVERTED_LAYOUT = Object.freeze([
  { x: -2.4, z: -3.5, yaw: 0.20, heightM: 5.2 },
  { x: 0.8, z: -2.1, yaw: -0.30, heightM: 5.6 },
  { x: -0.6, z: -0.7, yaw: 0.50, heightM: 5.0 },
  { x: 2.4, z: 0.7, yaw: -0.10, heightM: 5.4 },
  { x: -1.6, z: 2.1, yaw: 0.35, heightM: 5.8 },
  { x: 1.4, z: 3.5, yaw: -0.45, heightM: 5.1 },
]);

// ------------------------------------------------------------------------------------------------
// Small deterministic helpers (stable across builds)
// ------------------------------------------------------------------------------------------------
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function smooth(t) { return t * t * (3 - 2 * t); }
function hash01(i, s) {
  let h = ((i | 0) * 374761393 + (s | 0) * 668265263) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ------------------------------------------------------------------------------------------------
// Materials — plain MeshStandardNodeMaterial, no image inputs
// ------------------------------------------------------------------------------------------------
function woodMaterials() {
  const M = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
  if (!ensureMaterials._wood) ensureMaterials._wood = {
    greyTimber: new M({ color: 0x8c8a84, roughness: 0.93, metalness: 0.0 }),   // weathered natural grey timber
    greyTimberDark: new M({ color: 0x6f6d67, roughness: 0.94, metalness: 0.0 }), // its shaded side / end grain
    naturalTimber: new M({ color: 0x9c7849, roughness: 0.90, metalness: 0.0 }),  // cut White Oak (arms, logs)
    weathered: new M({ color: 0x8f8778, roughness: 0.92, metalness: 0.0 }),     // sun-bleached trunk
    steel: new M({ color: 0x585c60, roughness: 0.35, metalness: 0.85 }),        // the cable
    blackMetal: new M({ color: 0x1c1d1f, roughness: 0.6, metalness: 0.5 }),     // trolley block / chains
    rubberSeat: new M({ color: 0x26282a, roughness: 0.85, metalness: 0.0 }),    // round rubber disc seat
    // WholeTrees White Oak: pale weathered cream-grey (the captain's read of the primary photo)
    paleOak: new M({ color: 0xc6bfae, roughness: 0.92, metalness: 0.0 }),
    paleOakShade: new M({ color: 0xaea695, roughness: 0.93, metalness: 0.0 }),
    paleOakEnd: new M({ color: 0xd9d3c6, roughness: 0.90, metalness: 0.0 }),
  };
  return ensureMaterials._wood;
}
function groundMaterials() {
  const M = THREE.MeshStandardNodeMaterial || THREE.MeshStandardMaterial;
  if (!ensureMaterials._ground) ensureMaterials._ground = {
    rubber: new M({ color: 0xb24e33, roughness: 0.94, metalness: 0.0 }),       // red-terracotta rubber (PHOTO)
    rubberCream: new M({ color: 0xd8c9a8, roughness: 0.94, metalness: 0.0 }),  // cream rubber band (PHOTO)
    stone: new M({ color: 0x9a9384, roughness: 0.90, metalness: 0.0 }),        // flat stone edging
    boulder: new M({ color: 0x86827a, roughness: 0.88, metalness: 0.0 }),      // granite boulders
    woodchip: new M({ color: 0x8a6b45, roughness: 0.97, metalness: 0.0 }),     // woodchip play area
    picket: new M({ color: 0xc2a279, roughness: 0.90, metalness: 0.0 }),       // pale chestnut picket
    wire: new M({ color: 0x4a4c4f, roughness: 0.5, metalness: 0.6 }),          // thin wire strands
  };
  return ensureMaterials._ground;
}
const ensureMaterials = {};

// ------------------------------------------------------------------------------------------------
// Geometry helpers
// ------------------------------------------------------------------------------------------------
function bufferGeo(pos, nor, uv) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
function trimGeo(g) {
  const out = g.index ? g.toNonIndexed() : g;
  if (!out.attributes.normal) out.computeVertexNormals();
  if (!out.attributes.uv) out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  return out;
}
function concatGeos(geos) {
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of geos) {
    const p = g.attributes.position, nn = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      pos[(o + i) * 3] = p.getX(i); pos[(o + i) * 3 + 1] = p.getY(i); pos[(o + i) * 3 + 2] = p.getZ(i);
      nor[(o + i) * 3] = nn ? nn.getX(i) : 0; nor[(o + i) * 3 + 1] = nn ? nn.getY(i) : 1; nor[(o + i) * 3 + 2] = nn ? nn.getZ(i) : 0;
      uv[(o + i) * 2] = u ? u.getX(i) : 0; uv[(o + i) * 2 + 1] = u ? u.getY(i) : 0;
    }
    o += p.count;
  }
  return bufferGeo(pos, nor, uv);
}
// Merge [{geo,key}] into one geometry per material key (real merge; deterministic concat fallback).
function mergeByKey(parts) {
  const out = new Map();
  for (const { geo, key } of parts) {
    if (!geo) continue;
    let g = trimGeo(geo);
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(g);
  }
  const merged = new Map();
  for (const [key, geos] of out) {
    const g = geos.length === 1 ? geos[0] : (C.Addons && C.Addons.mergeGeometries ? C.Addons.mergeGeometries(geos, false) : concatGeos(geos));
    g.computeBoundingBox(); g.computeBoundingSphere();
    merged.set(key, g);
  }
  return merged;
}

// A cylinder between two points (inclusive of both), trimmed to `seg` sides.
function cylinderBetween(a, b, rA, rB, seg) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const g = new THREE.CylinderGeometry(Math.max(1e-4, rB), Math.max(1e-4, rA), Math.max(1e-4, len), seg || 10, 1, false);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  g.translate(a.x, a.y, a.z);
  return trimGeo(g);
}
function boxAt(x, y, z, w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return trimGeo(g);
}
function cylAt(x, y, z, rTop, rBot, h, seg) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, false);
  g.translate(x, y, z);
  return trimGeo(g);
}

// ------------------------------------------------------------------------------------------------
// Assembler: adds merged meshes to a group, collects real upward triangles per mesh for `surfaces`, and counts.
// ------------------------------------------------------------------------------------------------
// `surfaceKeys`: which material keys contribute WALK-ON surfaces (default: everything). A cable/chain/boulder is never
// a walkable surface even where a triangle happens to face up, so the caller names the keys that are.
function assemble(parts, mats, name, fallbackKey, surfaceKeys) {
  const merged = mergeByKey(parts);
  const group = new THREE.Group();
  group.name = name;
  const surfaces = [];
  const draws = [];
  let triangles = 0;
  for (const [key, geo] of merged) {
    const mesh = new THREE.Mesh(geo, mats[key] || mats[fallbackKey]);
    mesh.name = `${name}-${key}`;
    mesh.castShadow = key !== 'wire' && key !== 'steel';
    mesh.receiveShadow = true;
    group.add(mesh);
    const p = geo.attributes.position;
    if (!surfaceKeys || surfaceKeys.includes(key)) collectUpwardTriangles(p, surfaces, `${name}.${key}`);
    const nTri = p.count / 3;
    triangles += nTri;
    draws.push({ key, triangles: nTri });
  }
  return { group, surfaces, triangles, drawCalls: draws };
}

// Copy every upward (+Y) facing triangle from a position attribute into the `surfaces` format, REWOUND so its normal
// is +Y (so an independent ray from above will hit it and the barycentric query reads it directly). A triangle that is
// exactly vertical or downward is skipped (it is a wall/side, not a walk-on surface).
function collectUpwardTriangles(p, out, kind) {
  for (let t = 0; t + 2 < p.count; t += 3) {
    const ax = p.getX(t), ay = p.getY(t), az = p.getZ(t);
    const bx = p.getX(t + 1), by = p.getY(t + 1), bz = p.getZ(t + 1);
    const cx = p.getX(t + 2), cy = p.getY(t + 2), cz = p.getZ(t + 2);
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-9) continue;
    if (ny / nl < 0.5) continue;          // only clearly upward triangles are walk-on surfaces
    if (ny < 0) out.push({ triangle: [ax, ay, az, cx, cy, cz, bx, by, bz], kind });
    else out.push({ triangle: [ax, ay, az, bx, by, bz, cx, cy, cz], kind });
  }
}

// Exact rendered-triangle height at (x, z) from a `surfaces` list. Returns the HIGHEST matching triangle's height.
// `opts.baseY`/`opts.maxRise` gate a step (too high -> the triangle is skipped; if none remain, null — never a clamp).
function makeSurfaceQuery(surfaces) {
  const tris = [];
  for (const s of surfaces) {
    const T = s.triangle;
    if (!Array.isArray(T) || T.length !== 9) continue;
    tris.push({ x: [T[0], T[3], T[6]], y: [T[1], T[4], T[7]], z: [T[2], T[5], T[8]], kind: s.kind });
  }
  // coarse XZ bucket grid so a query touches O(1) candidates
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const t of tris) for (let i = 0; i < 3; i++) {
    if (t.x[i] < minX) minX = t.x[i]; if (t.x[i] > maxX) maxX = t.x[i];
    if (t.z[i] < minZ) minZ = t.z[i]; if (t.z[i] > maxZ) maxZ = t.z[i];
  }
  if (!tris.length) return { tris, cells: [], colOf: () => -1, rowOf: () => -1, nx: 0, nz: 0 };
  const cell = 1.0;
  const nx = Math.max(1, Math.ceil((maxX - minX) / cell) + 1), nz = Math.max(1, Math.ceil((maxZ - minZ) / cell) + 1);
  const cells = new Array(nx * nz);
  const colOf = (x) => clamp(Math.floor((x - minX) / cell), 0, nx - 1);
  const rowOf = (z) => clamp(Math.floor((z - minZ) / cell), 0, nz - 1);
  tris.forEach((t, ti) => {
    const tx0 = Math.min(t.x[0], t.x[1], t.x[2]), tx1 = Math.max(t.x[0], t.x[1], t.x[2]);
    const tz0 = Math.min(t.z[0], t.z[1], t.z[2]), tz1 = Math.max(t.z[0], t.z[1], t.z[2]);
    for (let c = colOf(tx0); c <= colOf(tx1); c++) for (let r = rowOf(tz0); r <= rowOf(tz1); r++) {
      const k = c * nz + r;
      (cells[k] || (cells[k] = [])).push(ti);
    }
  });
  return { tris, cells, colOf, rowOf, nx, nz, cell, minX, minZ };
}
function baryHeight(X, Y, Z, px, pz) {
  const x0 = X[0], x1 = X[1], x2 = X[2], z0 = Z[0], z1 = Z[1], z2 = Z[2];
  const den = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
  if (Math.abs(den) < 1e-12) return null;
  const a = ((z1 - z2) * (px - x2) + (x2 - x1) * (pz - z2)) / den;
  const b = ((z2 - z0) * (px - x2) + (x0 - x2) * (pz - z2)) / den;
  const c = 1 - a - b;
  const e = -1e-7;
  if (a < e || b < e || c < e) return null;
  return a * Y[0] + b * Y[1] + c * Y[2];
}
function surfaceHeightAtQuery(query, x, z, opts) {
  const o = opts || {};
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  if (!query.tris.length) return null;
  const list = query.cells[query.colOf(x) * query.nz + query.rowOf(z)];
  if (!list) return null;
  let best = null;
  for (const ti of list) {
    const t = query.tris[ti];
    const h = baryHeight(t.x, t.y, t.z, x, z);
    if (h === null) continue;
    if (Number.isFinite(o.baseY) && Number.isFinite(o.maxRise) && h > o.baseY + o.maxRise) continue;
    if (!best || h > best.h) best = { h, kind: t.kind, x, z, y: h };
  }
  return best;
}

// A collider box for a solid prop, tagged prop:true (the repo body collides with prop boxes; ground finishes never are).
function propBox(minX, maxX, minY, maxY, minZ, maxZ, kind) {
  return { minX, maxX, minY, maxY, minZ, maxZ, prop: true, kind };
}
function obbCollider(cx, cz, hx, hz, yaw, minY, maxY, kind) {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
  return { minX: cx - ex, maxX: cx + ex, minY, maxY, minZ: cz - ez, maxZ: cz + ez, obb: { cx, cz, hx, hz, cs, sn }, prop: true, kind };
}

// ------------------------------------------------------------------------------------------------
// LOCAL AXIS CONVENTION (ortho contract): the cableway's LONG AXIS is +X, Origin at the corridor centre, +Y up,
// 1 m. The A-frames stand at x = ±span/2; the parent computes yaw from the fixture's endpointLatLon bearings and
// places this local-origin group. The corridor's run is along X; its WIDTH is across Z.
// ------------------------------------------------------------------------------------------------

// The rubber corridor: an elongated CURVED strip, bowl cross-section, wavy mound ends, red + cream tone bands. The
// raised ground is 0..0.45 m (photo estimate); the parent uses the 0.224 m lawn datum by placing the group, so this
// geometry is built with its LOW edge at y = 0 (a local offset the parent's group position supplies).
function buildRubberCorridor(lengthM, S, opts = {}) {
  const W = S.corridorWidthM, half = W / 2;
  const seg = Math.max(4, S.corridorSegments | 0);
  const steps = Math.max(8, S.corridorSteps | 0);
  const x0 = -lengthM / 2 - S.corridorLengthExtraM, x1 = lengthM / 2 + S.corridorLengthExtraM;
  const bandCount = 5;                       // red / cream / red / cream / red across the width
  const bands = new Array(bandCount).fill(null).map((_, i) => (i % 2 === 0 ? 'rubber' : 'rubberCream'));
  // a gentle S-curve along the corridor's length (PHOTO: the corridor is curved, not a straight lane)
  const curve = (u) => Math.sin(u * Math.PI) * (opts.curveM || 0.9);
  // wavy mound ends: a raised, undulating lip at each end (PHOTO; total raised 0..0.45 m including the bowl)
  const mound = (u) => {
    const endDist = Math.min(u, 1 - u) * (x1 - x0);
    if (endDist >= S.moundLengthM) return 0;
    const t = 1 - endDist / S.moundLengthM;
    return S.moundAmplitudeM * smooth(t) * (0.7 + 0.3 * Math.sin(endDist * 3.1));
  };
  const yOf = (u, v) => {
    // v in [-1, 1] across the width; a shallow bowl (higher at the lips, lower in the middle) -> a bowl cross-section
    const bowl = S.corridorBowlM * (1 - v * v) * 0.5;
    return mound(u) + bowl;
  };
  const parts = [];
  const zzs = [];
  for (let s = 0; s <= steps; s++) zzs.push({ u: s / steps, x: x0 + (x1 - x0) * (s / steps), c: curve(s / steps) });
  for (let b = 0; b < bandCount; b++) {
    const i0 = Math.round((b / bandCount) * seg), i1 = Math.round(((b + 1) / bandCount) * seg);
    const pos = [], nor = [], uv = [];
    const pushTri = (A, B, Cc) => {
      const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
      const vx = Cc[0] - A[0], vy = Cc[1] - A[1], vz = Cc[2] - A[2];
      const ny = uz * vx - ux * vz;
      if (ny < 0) { const T = B; B = Cc; Cc = T; }
      for (const q of [A, B, Cc]) { pos.push(q[0], q[1], q[2]); nor.push(0, 1, 0); uv.push(0, 0); }
    };
    for (let s = 0; s < steps; s++) {
      const rowA = zzs[s], rowB = zzs[s + 1];
      for (let i = i0; i < i1; i++) {
        const vA0 = -1 + (2 * i) / seg, vA1 = -1 + (2 * (i + 1)) / seg;
        const A = [rowA.x, yOf(rowA.u, vA0), rowA.c + vA0 * half];
        const B = [rowA.x, yOf(rowA.u, vA1), rowA.c + vA1 * half];
        const Cc = [rowB.x, yOf(rowB.u, vA1), rowB.c + vA1 * half];
        const D = [rowB.x, yOf(rowB.u, vA0), rowB.c + vA0 * half];
        pushTri(A, B, Cc); pushTri(A, Cc, D);
      }
    }
    parts.push({ geo: bufferGeo(pos, nor, uv), key: bands[b] });
  }
  // skirt walls at both end lips (real thickness, no floating sheet): down to y = 0
  const skirt = [];
  for (const idx of [0, steps]) {
    const row = zzs[idx];
    const pos = [], nor = [], uv = [];
    for (let i = 0; i < seg; i++) {
      const v0 = -1 + (2 * i) / seg, v1 = -1 + (2 * (i + 1)) / seg;
      const A = [row.x, yOf(row.u, v0), row.c + v0 * half];
      const B = [row.x, yOf(row.u, v1), row.c + v1 * half];
      const A2 = [row.x, 0, row.c + v0 * half];
      const B2 = [row.x, 0, row.c + v1 * half];
      for (const q of [A, B, B2, A, B2, A2]) { pos.push(q[0], q[1], q[2]); nor.push(-Math.sign(row.x) || 1, 0, 0); uv.push(0, 0); }
    }
    skirt.push({ geo: bufferGeo(pos, nor, uv), key: 'rubber' });
  }
  // The ortho shows broad angular chevrons/patches, not five racing stripes.
  // Partition the same actual ground triangles by a repeated angular motif; the
  // colours are photo estimates and do not change the footing geometry.
  const pattern=new Map();
  for(const part of parts){const p=part.geo.attributes.position;
    for(let t=0;t<p.count;t+=3){
      const x=(p.getX(t)+p.getX(t+1)+p.getX(t+2))/3;
      const z=(p.getZ(t)+p.getZ(t+1)+p.getZ(t+2))/3;
      const u=(x-x0)/(x1-x0),v=(z-curve(u))/half;
      const phase=(u*3.2+Math.abs(v)*.48)%1;
      const key=phase>.18&&phase<.76?'rubberCream':'rubber';
      if(!pattern.has(key))pattern.set(key,{pos:[],nor:[],uv:[]});
      const b=pattern.get(key);for(let k=0;k<3;k++){b.pos.push(p.getX(t+k),p.getY(t+k),p.getZ(t+k));b.nor.push(0,1,0);b.uv.push(0,0);}
    }
    part.geo.dispose();
  }
  const patterned=[...pattern].map(([key,b])=>({key,geo:bufferGeo(b.pos,b.nor,b.uv)}));
  return { parts: [...patterned, ...skirt], lengthM: x1 - x0, x0, x1 };
}

// Curved stone edging: two low ribbons running beside the corridor's outer curve (flat stone).
function buildStoneEdging(lengthM, S, opts = {}) {
  const W = S.corridorWidthM, half = W / 2;
  const x0 = -lengthM / 2 - S.corridorLengthExtraM, x1 = lengthM / 2 + S.corridorLengthExtraM;
  const steps = Math.max(8, S.corridorSteps | 0);
  const curve = (u) => Math.sin(u * Math.PI) * (opts.curveM || 0.9);
  const parts = [];
  for (const side of [-1, 1]) {
    const pos = [], nor = [], uv = [];
    const pushTri = (A, B, Cc) => {
      const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
      const vx = Cc[0] - A[0], vy = Cc[1] - A[1], vz = Cc[2] - A[2];
      const ny = uz * vx - ux * vz;
      if (ny < 0) { const T = B; B = Cc; Cc = T; }
      for (const q of [A, B, Cc]) { pos.push(q[0], q[1], q[2]); nor.push(0, 1, 0); uv.push(0, 0); }
    };
    for (let s = 0; s < steps; s++) {
      const u0 = s / steps, u1 = (s + 1) / steps;
      const xa = x0 + (x1 - x0) * u0, xb = x0 + (x1 - x0) * u1;
      const ca = curve(u0), cb = curve(u1);
      const oa = side * (half + 0.02), ib = side * (half + S.edgingWidthM);
      const A = [xa, S.edgingHeightM, ca + oa];
      const B = [xa, S.edgingHeightM, ca + ib];
      const Cc = [xb, S.edgingHeightM, cb + ib];
      const D = [xb, S.edgingHeightM, cb + oa];
      pushTri(A, B, Cc); pushTri(A, Cc, D);
    }
    parts.push({ geo: bufferGeo(pos, nor, uv), key: 'stone' });
  }
  return parts;
}

// A rounded granite boulder, embedded ~15% into the ground, deterministic wobble.
function boulderGeo(x, z, r, seed) {
  const g = new THREE.SphereGeometry(r, 10, 7, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const wob = 1 + (hash01(i, seed) - 0.5) * 0.3;
    p.setXYZ(i, p.getX(i) * wob * 1.15, Math.max(0, p.getY(i) * wob), p.getZ(i) * wob * 1.15);
  }
  g.translate(x, -r * 0.15, z);
  g.computeVertexNormals();
  return trimGeo(g);
}

// ------------------------------------------------------------------------------------------------
// The Cableway (Cableway Canyon): two rustic natural grey timber A-frames, a steel cable between their apexes, a black
// trolley and a hanging round rubber disc seat, on a curved red/cream rubber corridor with stone edging and entry
// boulders. LONG AXIS = +X (the ortho contract: the parent computes yaw from the fixture's endpoints). `lengthM` MUST
// be one of the published runs (20 or 40 m); any other value is refused rather than clamped.
// ------------------------------------------------------------------------------------------------
function buildBiidaasigeCableway(lengthM, opts = {}) {
  const want = typeof lengthM === 'number' && Number.isFinite(lengthM) ? lengthM : NaN;   // require an explicit published length
  if (want !== 20 && want !== 40) {
    throw new RangeError(`buildBiidaasigeCableway: lengthM must be one of the published Cableway Canyon runs (${CABLEWAY_LENGTHS_M.join(', ')} m); got ${lengthM}. ` +
      'The City publishes only 20 m and 40 m; an unsourced length is refused rather than invented.');
  }
  const S = { ...CABLEWAY_SPEC, ...(opts.spec || {}) };
  const span = want;
  const wood = woodMaterials(), groundM = groundMaterials();
  const mats = { ...wood, ...groundM };
  const parts = [];
  const colliders = [];
  const xFrames = [ -span / 2, span / 2 ];        // the two A-frames stand at the corridor's ends (long axis = X)
  const legR = S.legDiameterM / 2;
  const footHalfZ = S.footSpreadM / 2;            // the legs' feet spread across Z (perpendicular to the run)

  // --- A-frames: each is a pair of bowing grey timber legs meeting at a bolted apex, plus a ground sill log
  for (const xc of xFrames) {
    const apex = new THREE.Vector3(xc, S.frameHeightM, 0);
    for (const sz of [-1, 1]) {
      const foot = new THREE.Vector3(xc, 0, sz * footHalfZ);
      const mid = new THREE.Vector3(xc, S.frameHeightM * 0.52, sz * footHalfZ * 0.62);
      const seg1 = cylinderBetween(foot, mid, legR, legR * 0.94, 8);
      const seg2 = cylinderBetween(mid, apex, legR * 0.94, legR * 0.8, 8);
      parts.push({ geo: seg1, key: 'greyTimber' }, { geo: seg2, key: 'greyTimber' });
      // a solid post collider on each leg at the corridor EDGE (clears the corridor centre line: only the legs are solid)
      const ez = sz * footHalfZ;
      colliders.push(propBox(xc - legR, xc + legR, 0, S.frameHeightM, ez - legR, ez + legR, 'cableway-leg'));
    }
    {
      const bolt = new THREE.CylinderGeometry(S.boltDiameterM / 2, S.boltDiameterM / 2, 0.34, 8);
      bolt.rotateX(Math.PI / 2);   // the cross-bolt runs across Z
      bolt.translate(xc, S.frameHeightM, 0);
      parts.push({ geo: trimGeo(bolt), key: 'greyTimberDark' });
    }
    // a sill log across both feet (a real foot; low enough to keep the corridor clear)
    parts.push({ geo: cylinderBetween(new THREE.Vector3(xc, 0.09, -footHalfZ), new THREE.Vector3(xc, 0.09, footHalfZ), legR * 0.7, legR * 0.7, 8), key: 'greyTimberDark' });
  }

  // --- the steel cable sagging slightly between the two apexes (along X)
  const apexA = new THREE.Vector3(xFrames[0], S.frameHeightM - 0.08, 0);
  const apexB = new THREE.Vector3(xFrames[1], S.frameHeightM - 0.08, 0);
  const sag = 0.35;
  {
    const seg = 16, pts = [];
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const y = apexA.y + (apexB.y - apexA.y) * t - sag * Math.sin(Math.PI * t);
      pts.push(new THREE.Vector3(apexA.x + (apexB.x - apexA.x) * t, y, 0));
    }
    for (let i = 0; i < seg; i++) parts.push({ geo: cylinderBetween(pts[i], pts[i + 1], S.cableDiameterM / 2, S.cableDiameterM / 2, 5), key: 'steel' });
    const tS = 0.35;
    const yS = apexA.y + (apexB.y - apexA.y) * tS - sag * Math.sin(Math.PI * tS);
    const xS = apexA.x + (apexB.x - apexA.x) * tS;
    parts.push({ geo: boxAt(xS, yS - S.trolleyHeightM / 2 + 0.02, 0, S.trolleyWidthM * 0.8, S.trolleyHeightM, S.trolleyWidthM * 1.4), key: 'blackMetal' });
    const seatY = 0.62;
    parts.push({ geo: cylAt(xS, seatY, 0, S.seatDiameterM / 2, S.seatDiameterM / 2, S.seatThicknessM, 14), key: 'rubberSeat' });
    for (const sz of [-1, 1]) {
      parts.push({ geo: cylinderBetween(new THREE.Vector3(xS, yS - S.trolleyHeightM, 0), new THREE.Vector3(xS, seatY + S.seatThicknessM / 2, sz * 0.12), 0.012, 0.012, 5), key: 'blackMetal' });
    }
  }

  // --- the curved rubber corridor (red/cream bands, bowl, wavy mound ends) + stone edging
  const corridor = buildRubberCorridor(span, S, opts);
  parts.push(...corridor.parts);
  parts.push(...buildStoneEdging(span, S, opts));

  // --- boulder clusters at the two entries (PHOTO: clusters around the entry); X offsets, Z spread
  {
    let k = 0;
    for (const xc of xFrames) {
      const side = xc < 0 ? -1 : 1;
      for (let i = 0; i < S.boulderCount; i++) {
        const r = S.boulderRadiusMinM + (S.boulderRadiusMaxM - S.boulderRadiusMinM) * hash01(k, 13);
        const ang = -0.9 + 1.8 * hash01(k, 29);
        const dist = S.corridorWidthM / 2 + 0.35 + 0.9 * hash01(k, 37);
        const z = Math.cos(ang) * dist;
        const x = xc + side * (S.corridorLengthExtraM * 0.55) + Math.sin(ang) * dist * 0.44;
        parts.push({ geo: boulderGeo(x, z, r, k + 1), key: 'boulder' });
        k++;
      }
    }
  }

  const A = assemble(parts, mats, 'BiidaasigeCableway', 'greyTimber', ['rubber', 'rubberCream', 'stone']);
  const query = makeSurfaceQuery(A.surfaces);
  // the highest raised ground across the whole corridor (0..0.45 m photo estimate; the parent adds its lawn datum).
  // Measured from the FULL rubber+stone band meshes, not only the upward `surfaces` copy.
  let raisedMax = 0;
  A.group.traverse((m) => {
    if (!m.isMesh || !/(rubber|rubberCream|stone)$/.test(m.name)) return;
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) raisedMax = Math.max(raisedMax, p.getY(i));
  });
  return {
    group: A.group,
    triangles: A.triangles,
    drawCalls: A.drawCalls,
    colliders,                            // solid A-frame legs only (prop boxes); the corridor stays clear
    surfaces: A.surfaces,                 // real upward rendered triangles, LOCAL coords
    surfaceHeightAt: (x, z, o) => surfaceHeightAtQuery(query, x, z, o),
    _query: query,
    lengthM: span,
    longAxis: 'x',                        // the parent computes yaw from the fixture endpoints
    officialLengths: CABLEWAY_LENGTHS_M.slice(),
    placementStatus: 'unplaced',          // local-origin; the captain registers an anchor
    raisedGroundMaxM: raisedMax,
    footprintM: [span + 2 * (S.corridorLengthExtraM + S.boulderRadiusMaxM), S.corridorWidthM + 2 * (S.edgingWidthM + S.boulderRadiusMaxM)],
    corridor: { widthM: S.corridorWidthM, x0: corridor.x0, x1: corridor.x1, toneBands: ['rubber', 'rubberCream', 'rubber', 'rubberCream', 'rubber'] },
    estimates: { ...S },
    facts: ['Cableway Canyon has 20 m and 40 m cableways (City of Toronto, Recreation at Biidaasige Park).',
      'Two SEPARATE offset corridors (short 20 m and long 40 m) appear in the 2025 City 8 cm ortho; the published lengths remain authoritative.'],
    source: {
      label: 'City of Toronto — Recreation at Biidaasige Park (Cableway Canyon: 20 m and 40 m cableways)',
      url: 'https://www.toronto.ca/explore-enjoy/parks-recreation/places-spaces/beaches-gardens-attractions/biidaasige-park/recreation-at-biidaasige-park/',
    },
    photoSource: {
      label: 'CSLA — Port Lands Flood Protection Program, Biidaasige Park photo (captain/cableway-csla.jpg, viewed, not reproduced)',
      url: 'https://www.csla-aapc.ca/sites/csla-aapc.ca/files/landadapt%20case%20studies/Port%20Lands%20Flood%20Protection%20Program/to-port-lands_biidaasige-park-02-sc.jpg',
    },
    note: 'Rustic natural grey timber A-frames, cable + black trolley + round rubber seat, curved red/cream rubber corridor ' +
      'with stone edging and entry boulders — from the captain\'s read of the CSLA photo. Long axis +X, local origin; unplaced.',
  };
}

// ------------------------------------------------------------------------------------------------
// Swing Hill: a timber A-frame swing set + woodchip apron. The swing COUNT is a labeled OPTION (the City publishes
// only that Swing Hill is a swing zone; it publishes no per-swing count).
// ------------------------------------------------------------------------------------------------
// `opts.seats`: an array of per-swing seat kinds, 'flat' (a belt seat, default) or 'basket' (a toddler bucket seat). Its
// length is the swing count. A basket seat is built as a rounded bucket on the same chains. `opts.pad`: 'north' or 'south',
// recorded only (the ortho shows TWO adjacent Swing Hill pads with separate frames; the parent places one frame per pad).
function buildBiidaasigeSwingSet(opts = {}) {
  const S = { ...SWING_SPEC, ...(opts.spec || {}) };
  const seats = Array.isArray(opts.seats) && opts.seats.length
    ? opts.seats.map((k) => (k === 'basket' ? 'basket' : 'flat'))
    : new Array(clamp(Math.round(Number.isFinite(opts.swingCount) ? opts.swingCount : S.defaultSwingCount), 1, S.maxSwingCount)).fill('flat');
  const count = seats.length;
  const spanW = S.bayWidthM * count;
  const zLegs = [-S.footSpreadM / 2, S.footSpreadM / 2];
  const mats = { ...woodMaterials(), ...groundMaterials() };
  const parts = [];
  const colliders = [];
  const legR = S.legDiameterM / 2;

  // the top beam (long axis = X; the frame's legs splay across Z)
  parts.push({ geo: cylinderBetween(new THREE.Vector3(-spanW / 2 - 0.5, S.frameHeightM, 0), new THREE.Vector3(spanW / 2 + 0.5, S.frameHeightM, 0), 0.1, 0.1, 10), key: 'naturalTimber' });
  for (const ex of [-spanW / 2, spanW / 2]) {
    for (const zl of zLegs) {
      parts.push({ geo: cylinderBetween(new THREE.Vector3(ex, 0, zl), new THREE.Vector3(ex, S.frameHeightM + 0.06, 0), legR, legR * 0.85, 8), key: 'naturalTimber' });
      colliders.push(propBox(ex - legR, ex + legR, 0, S.frameHeightM, zl - legR, zl + legR, 'swing-leg'));
    }
  }
  const seatY = S.frameHeightM - S.chainLengthM;
  for (let i = 0; i < count; i++) {
    const px = -spanW / 2 + S.bayWidthM * (i + 0.5);
    for (const sx of [-S.swingSeatWidthM * 0.35, S.swingSeatWidthM * 0.35]) {
      parts.push({ geo: cylinderBetween(new THREE.Vector3(px + sx, S.frameHeightM, 0), new THREE.Vector3(px + sx, seatY, 0), 0.014, 0.014, 5), key: 'blackMetal' });
    }
    if (seats[i] === 'basket') {
      // a toddler bucket seat: a rounded open cup, slightly deeper, hung a little closer to the ground
      const r = S.swingSeatWidthM * 0.42, h = 0.32;
      parts.push({ geo: new THREE.CylinderGeometry(r * 0.78, r, h, 14, 1, true).translate(px, seatY - h / 2 + 0.06, 0).toNonIndexed(), key: 'rubberSeat' });
      parts.push({ geo: new THREE.CylinderGeometry(r * 0.8, r * 0.8, 0.04, 14).translate(px, seatY - h + 0.08, 0).toNonIndexed(), key: 'rubberSeat' });
    } else {
      parts.push({ geo: boxAt(px, seatY, 0, S.swingSeatWidthM, 0.06, 0.22), key: 'rubberSeat' });
    }
  }
  {
    const w = spanW + 1.6, d = S.footSpreadM + S.groundFinishM * 2;
    parts.push({ geo: boxAt(0, 0.012, 0, w, 0.024, d), key: 'woodchip' });
  }

  const A = assemble(parts, mats, 'BiidaasigeSwingSet', 'naturalTimber', ['woodchip']);
  const query = makeSurfaceQuery(A.surfaces);
  const pad = opts.pad === 'north' || opts.pad === 'south' ? opts.pad : null;
  return {
    group: A.group,
    triangles: A.triangles,
    drawCalls: A.drawCalls,
    colliders,
    surfaces: A.surfaces,
    surfaceHeightAt: (x, z, o) => surfaceHeightAtQuery(query, x, z, o),
    _query: query,
    longAxis: 'x',
    swingCount: count,
    seats: seats.slice(),
    pad,
    swingCountBasis: 'SEAT ARRANGEMENT ESTIMATED — the count and per-seat kind are a caller option, NOT the park total. The ' +
      'City map marks Swing Hill as a swing zone and publishes no per-swing count; the 2025 City ortho shows two adjacent ' +
      'pads (swing-hill-north / swing-hill-south) with separate swing frames.',
    placementStatus: 'unplaced',
    footprintM: [spanW + 1.6, S.footSpreadM + S.groundFinishM * 2],
    estimates: { ...S, seatArrangement: 'estimated' },
    facts: ['The 2025 City 8 cm ortho shows two adjacent Swing Hill pads with separate swing frames (fixture swing-hill-north / swing-hill-south).'],
    source: {
      label: 'City of Toronto 2026 wayfinding map — Swing Hill (a swing zone; no published swing count); 2025 City 8 cm ortho (two pads)',
      url: 'https://www.toronto.ca/wp-content/uploads/2026/09/978c-Biidaasige-Park-map.pdf',
    },
    note: 'Timber A-frame swing set for one Swing Hill pad. The seat arrangement is ESTIMATED and caller-configured (flat / ' +
      'basket), not an official total. Long axis +X, local origin; unplaced.',
  };
}

// ------------------------------------------------------------------------------------------------
// WholeTrees-inspired timber play parts: inverted-trident White Oak trees (walk-through arches), a low log circuit
// (balancing beams), and a higher-quality source-form mock-dam log tangle. Composition of real parts; the park's own
// count and layout are NOT known and are not claimed.
// ------------------------------------------------------------------------------------------------
// One inverted-trident tree: fat grey weathered trunk standing UP, three flared curving roots/arms reaching the ground
// ~armSpread across, leaving a ~archClear walk-through arch, with bulging nodes.
// A single WholeTrees inverted-trident unit: a slender pale upper trunk from a fork (~2.3 m) up to an irregular flat
// cut top (~5.4 m), and THREE thick tapering flared lower branches reaching the ground. The central space below the
// fork is EMPTY (no solid trunk from 0 to the fork), so a walk-through arch stays clear. Returns parts + colliders.
// `unit` supplies { heightM, yaw, seed } so one definition serves the six-unit factory and the local preview.
function invertedTreeParts(S, unit) {
  const parts = [];
  const colliders = [];
  const yaw = Number.isFinite(unit.yaw) ? unit.yaw : 0;
  const seed = Number.isFinite(unit.seed) ? unit.seed : 1;
  const H = clamp(Number.isFinite(unit.heightM) ? unit.heightM : S.topHeightM, S.heightMinM, S.heightMaxM);
  const forkY = S.forkHeightM;
  const rFork = (S.upperTrunkDiameterMinM + (S.upperTrunkDiameterMaxM - S.upperTrunkDiameterMinM) * hash01(seed, 3)) / 2;
  const rTop = rFork * 0.72;

  // the UPPER trunk: a gently CURVED, LEANED, naturally-sawn stem. The upper-trunk centre drifts and leans with height
  // (a monotonic lean of .15-.35 m plus a small sinuous curve), with one or two narrow bulging knots (~10-20% radius)
  // and an irregular SLANT cut top. Its real XZ offset per segment feeds the collider below, so the collider follows the
  // bent stem rather than spanning the empty space beside it.
  const leanMag = 0.15 + 0.20 * hash01(seed, 13);              // .15-.35 m
  const leanAng = yaw + (hash01(seed, 17) - 0.5) * 1.6;        // the lean's world direction
  const leanX = Math.cos(leanAng) * leanMag, leanZ = Math.sin(leanAng) * leanMag;
  const curveAmp = 0.05 + 0.05 * hash01(seed, 19);             // a small sinuous component
  const knotSegs = hash01(seed, 23) < 0.5 ? [2] : [2, 4];      // one or two narrow knots along the stem
  const upperPts = [];
  {
    const segs = 6;
    let prev = new THREE.Vector3(0, forkY, 0), prevR = rFork;
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      const y = forkY + (H - forkY) * t;
      // a monotonic lean with height + a small sinuous curve (organic, never a straight pipe)
      const drift = leanMag * t + Math.sin(t * Math.PI * 1.3 + seed) * curveAmp;
      const ang2 = leanAng + Math.sin(t * Math.PI * 1.3 + seed) * 0.25;
      const baseR = rFork + (rTop - rFork) * t;
      const r = baseR * (knotSegs.includes(i) ? 1 + 0.12 + 0.08 * hash01(i + seed, 29) : 1);
      const p = new THREE.Vector3(Math.cos(ang2) * drift, y, Math.sin(ang2) * drift);
      parts.push({ geo: cylinderBetween(prev, p, prevR, r, 9), key: i % 2 ? 'paleOak' : 'paleOakShade' });
      prev = p; prevR = r; upperPts.push(p);
    }
    // the irregular SLANT cut top: a shallow, tilted end-grain cap (its normal tilts off vertical)
    const top = upperPts[upperPts.length - 1];
    const slant = new THREE.CylinderGeometry(prevR * 1.02, prevR * 0.98, 0.07, 9);
    slant.rotateX(0.32); slant.rotateY(hash01(seed, 31) * Math.PI);
    slant.translate(top.x, H + 0.01, top.z);
    parts.push({ geo: trimGeo(slant), key: 'paleOakEnd' });
    // slender UPPER-trunk colliders that FOLLOW the bent stem (a small box per segment), never one box spanning the
    // empty space beside the lean
    for (const p of upperPts) {
      const tr = prevR + 0.05;
      colliders.push(propBox(p.x - tr, p.x + tr, p.y - 0.4, p.y + 0.4, p.z - tr, p.z + tr, 'inverted-tree-upper-trunk'));
    }
  }

  // the THREE thick tapering flared lower branches: a SMOOTH CURVE from the fork to each foot (5 segments along the
  // curve, not a sharp 2-segment A-frame), with natural asymmetry (foot angles and lengths vary 10-15%).
  for (let b = 0; b < S.branchCount; b++) {
    const ang = (b / S.branchCount) * Math.PI * 2 + yaw + seed * 0.35 + (hash01(b + seed, 37) - 0.5) * 0.28;  // +/- ~8 deg
    const spread = S.footSpreadM * 0.5 * (0.90 + 0.20 * hash01(b + seed, 41));                                // +/- 10%
    const foot = new THREE.Vector3(Math.cos(ang) * spread, 0.0, Math.sin(ang) * spread);
    const midOut = spread * (0.68 + 0.18 * hash01(b + seed, 7));
    const midY = forkY * (0.42 + 0.12 * hash01(b + seed, 43));
    const ctrl = new THREE.Vector3(Math.cos(ang) * midOut, midY, Math.sin(ang) * midOut);   // a quadratic control point
    const nSeg = 5;
    let prev = new THREE.Vector3(0, forkY, 0), prevR = S.branchRootDiameterM / 2;           // thick at the fork
    for (let k = 1; k <= nSeg; k++) {
      const t = k / nSeg;
      const u = 1 - t;
      // quadratic Bezier from the fork, through the control, curving down to the foot (smooth taper)
      const p = new THREE.Vector3(
        u * u * 0 + 2 * u * t * ctrl.x + t * t * foot.x,
        u * u * forkY + 2 * u * t * ctrl.y + t * t * foot.y,
        u * u * 0 + 2 * u * t * ctrl.z + t * t * foot.z);
      const r = (S.branchRootDiameterM / 2) + ((S.branchTipDiameterM * 0.9) - (S.branchRootDiameterM / 2)) * Math.sqrt(t);
      parts.push({ geo: cylinderBetween(prev, p, prevR, r, 9), key: (b + k) % 2 ? 'paleOak' : 'paleOakShade' });
      prev = p; prevR = r;
    }
    // the flared foot, splayed onto the ground
    parts.push({ geo: cylinderBetween(new THREE.Vector3(foot.x, S.footFlareDiameterM * 0.35, foot.z), new THREE.Vector3(foot.x, 0.005, foot.z), S.footFlareDiameterM / 2, S.footFlareDiameterM * 0.42, 10), key: 'paleOakEnd' });
    // a slender branch/foot collider only (the arch between the branches stays clear)
    const fr = S.footFlareDiameterM / 2 + 0.03;
    colliders.push(propBox(foot.x - fr, foot.x + fr, 0, forkY * 0.6, foot.z - fr, foot.z + fr, 'inverted-tree-branch-foot'));
  }
  const top = upperPts[upperPts.length - 1] || new THREE.Vector3(0, forkY, 0);
  return { parts, colliders, heightM: H, yaw, upperTop: { x: top.x, z: top.z }, upperLeanM: Math.hypot(leanX, leanZ) };
}

// Backwards-compatible single-tree helper (used by the local preview): returns the parts for one unit at zc.
function invertedTridentTree(S, seed) {
  const unit = invertedTreeParts(S, { heightM: S.topHeightM, yaw: 0, seed });
  return unit.parts;
}

// ------------------------------------------------------------------------------------------------
// buildBiidaasigeInvertedTrees — the SIX WholeTrees inverted-trident White Oak units of the identifiable Biidaasige
// cluster (the 2025 City ortho shows a compact cluster on the woodchip island west of the shade canopies / the Owl).
// `opts.layout` is an array of { x, z, yaw, heightM } (local origin at the cluster centre); the default is the photo-
// estimated staggered layout. Returns ONLY this identifiable site: no generic mock-dam / log-circuit is dragged in.
// ------------------------------------------------------------------------------------------------
function buildBiidaasigeInvertedTrees(opts = {}) {
  const S = { ...TIMBER_SPEC, ...(opts.spec || {}) };
  const mats = { ...woodMaterials(), ...groundMaterials() };
  const layout = Array.isArray(opts.layout) && opts.layout.length
    ? opts.layout.map((u, i) => ({ x: +u.x || 0, z: +u.z || 0, yaw: Number.isFinite(u.yaw) ? u.yaw : 0, heightM: Number.isFinite(u.heightM) ? u.heightM : S.topHeightM, seed: i + 1 }))
    : DEFAULT_INVERTED_LAYOUT.map((u, i) => ({ ...u, seed: i + 1 }));
  const parts = [];
  const colliders = [];
  const placed = [];
  for (const unit of layout) {
    const res = invertedTreeParts(S, unit);
    for (const { geo, key } of res.parts) { geo.translate(unit.x, 0, unit.z); parts.push({ geo, key }); }
    for (const c of res.colliders) colliders.push({ ...c, minX: c.minX + unit.x, maxX: c.maxX + unit.x, minZ: c.minZ + unit.z, maxZ: c.maxZ + unit.z });
    placed.push({ x: unit.x, z: unit.z, yaw: unit.yaw, heightM: res.heightM, upperTop: { x: unit.x + res.upperTop.x, z: unit.z + res.upperTop.z }, upperLeanM: res.upperLeanM });
  }
  // Optional local-preview finish. Runtime uses the separately source-footprinted play pad.
  if (opts.groundFinish !== false) {
    parts.push({ geo: boxAt(0, 0.012, 0, S.clusterAcrossM + 2.0, 0.024, S.clusterAlongM + 2.0), key: 'woodchip' });
  }

  const A = assemble(parts, mats, 'BiidaasigeInvertedTrees', 'paleOak', ['woodchip']);
  const query = makeSurfaceQuery(A.surfaces);
  let maxH = 0;
  A.group.traverse((m) => { if (m.isMesh) { const p = m.geometry.attributes.position; for (let i = 0; i < p.count; i++) maxH = Math.max(maxH, p.getY(i)); } });
  return {
    group: A.group,
    triangles: A.triangles,
    drawCalls: A.drawCalls,
    colliders,                       // ONLY actual lower-branch/foot segments + the upper trunk above the fork
    surfaces: A.surfaces,            // the woodchip ground finish (the cluster is NOT a floor)
    surfaceHeightAt: (x, z, o) => surfaceHeightAtQuery(query, x, z, o),
    _query: query,
    unitCount: placed.length,
    layout: placed,
    maxHeightM: maxH,
    placementStatus: 'unplaced',
    footprintM: [S.clusterAcrossM + 2.0, S.clusterAlongM + 2.0],
    estimates: { ...S, upperTrunkDiameterM: `${S.upperTrunkDiameterMinM}-${S.upperTrunkDiameterMaxM} (PHOTO)`, forkHeightM: `${S.forkHeightM} (PHOTO)`, topHeightM: `${S.topHeightM} (PHOTO)`, footSpreadM: `${S.footSpreadM} (PHOTO)`, archClearM: `${S.archClearM} (PHOTO)`, layout: 'photo-estimated staggered 6-unit layout (individual heights/yaws ESTIMATED)' },
    facts: ['WholeTrees made oversized White Oak inverted-trident trees with log circuits, balancing and beam structures for Biidaasige Park (manufacturer press release).',
      'Six pale weathered inverted-trident trunks ~5-6 m high (captain primary photo + 2025 City ortho).'],
    source: {
      label: 'Blue Medium — WholeTrees Structures, Biidaasige Park press release',
      url: 'https://bluemedium.com/news/wholetrees-structures-brings-biophilic-timber-playscapes-to-torontos-new-biidaasige-park/',
    },
    photoSource: {
      label: 'WholeTrees primary photo (captain/inverted-timber.png) + 2025 City 8 cm ortho (captain/ortho-timber-detail.png), viewed, not reproduced',
    },
    note: 'The identifiable SIX-unit WholeTrees inverted-trident cluster: slender pale upper trunk from a fork (~2.3 m) to a ' +
      'flat cut top (~5.4 m), three thick flared lower branches forming walk-through arches, NO solid central trunk below the ' +
      'fork. Colliders are the branch/feet and the upper trunk only. Layout/heights are photo estimates. Local origin; unplaced.',
  };
}

function buildBiidaasigeTimberPlay(opts = {}) {
  const S = { ...TIMBER_SPEC, ...(opts.spec || {}) };
  const mats = { ...woodMaterials(), ...groundMaterials() };
  const parts = [];
  const colliders = [];

  // (1) the inverted-trident trees — a pair, forming walk-through arches (count is a local composition choice)
  const archCount = clamp(Math.round(Number.isFinite(opts.archCount) ? opts.archCount : S.archCount), 1, 4);
  for (let i = 0; i < archCount; i++) {
    const zc = (i - (archCount - 1) / 2) * S.archSeparationM;
    const res = invertedTreeParts(S, { heightM: S.topHeightM, yaw: 0, seed: i + 1 });
    for (const { geo, key } of res.parts) { geo.translate(0, 0, zc); parts.push({ geo, key }); }
    for (const c of res.colliders) colliders.push({ ...c, minZ: c.minZ + zc, maxZ: c.maxZ + zc });
  }

  // (2) a low log circuit (balancing beams) — a ring of horizontal logs on short stone footings
  {
    const R = S.circuitRadiusM, n = Math.max(4, Math.round(S.logCount));
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 0.82) / n) * Math.PI * 2;
      const y = S.logDiameterM / 2 + 0.22;
      const p0 = new THREE.Vector3(Math.cos(a0) * R, y, Math.sin(a0) * R);
      const p1 = new THREE.Vector3(Math.cos(a1) * R, y, Math.sin(a1) * R);
      parts.push({ geo: cylinderBetween(p0, p1, S.logDiameterM / 2, S.logDiameterM / 2, 8), key: 'naturalTimber' });
      for (const p of [p0, p1]) parts.push({ geo: cylAt(p.x, 0.11, p.z, 0.12, 0.14, 0.22, 8), key: 'stone' });
      colliders.push(obbCollider((p0.x + p1.x) / 2, (p0.z + p1.z) / 2,
        Math.hypot(p1.x - p0.x, p1.z - p0.z) / 2, S.logDiameterM / 2 + 0.02,
        Math.atan2(-(p1.z - p0.z), p1.x - p0.x), 0, y + S.logDiameterM / 2, 'timber-play-log'));
    }
  }

  // (3) the mock-dam log tangle: an interlocking bundle of logs (higher-quality source form), with a ground stone apron
  {
    const W = S.damWidthM, halfW = W / 2;
    parts.push({ geo: boxAt(0, 0.02, 0, W + 0.8, 0.04, 1.6), key: 'stone' });
    for (let i = 0; i < S.damLogCount; i++) {
      const layer = Math.floor(i / 4), col = i % 4;
      const y = S.damLogDiameterM / 2 + 0.05 + layer * S.damLogDiameterM * 0.82;
      const yaw = (layer % 2 ? 1 : -1) * (0.25 + 0.15 * hash01(i, 5));
      const cx = -halfW + (col + 0.5) * (W / 4) + (hash01(i, 11) - 0.5) * 0.2;
      const len = 1.0 + 0.5 * hash01(i, 17);
      const dx = Math.cos(yaw) * len / 2, dz = Math.sin(yaw) * len / 2;
      parts.push({ geo: cylinderBetween(new THREE.Vector3(cx - dx, y, -dz), new THREE.Vector3(cx + dx, y, dz), S.damLogDiameterM / 2, S.damLogDiameterM / 2, 7), key: i % 3 === 0 ? 'greyTimber' : 'naturalTimber' });
    }
    // two upright snags braced into the bundle
    for (const sx of [-1, 1]) {
      parts.push({ geo: cylinderBetween(new THREE.Vector3(sx * halfW * 0.6, 0, 0), new THREE.Vector3(sx * halfW * 0.55, 1.5, 0.1), 0.09, 0.1, 8), key: 'weathered' });
    }
    colliders.push(propBox(-halfW, halfW, 0, S.damLogDiameterM * 4, -0.9, 0.9, 'timber-play-dam'));
  }

  const A = assemble(parts, mats, 'BiidaasigeTimberPlay', 'naturalTimber', []);
  const query = makeSurfaceQuery(A.surfaces);
  return {
    group: A.group,
    triangles: A.triangles,
    drawCalls: A.drawCalls,
    colliders,
    surfaces: A.surfaces,
    surfaceHeightAt: (x, z, o) => surfaceHeightAtQuery(query, x, z, o),
    _query: query,
    archCount,
    placementStatus: 'unplaced',
    footprintM: [S.circuitRadiusM * 2 + S.damWidthM * 0.5, S.archSeparationM * (archCount - 1) + S.footSpreadM + S.damWidthM * 0.5],
    estimates: { ...S, upperTrunkDiameterM: `${S.upperTrunkDiameterMinM}-${S.upperTrunkDiameterMaxM} (PHOTO)`, footSpreadM: `${S.footSpreadM} (PHOTO)`, archClearM: `${S.archClearM} (PHOTO)`, damWidthM: `${S.damWidthM} (PHOTO/City: "~2.5 m wide")` },
    facts: ['WholeTrees made oversized White Oak inverted-trident trees with log circuits, balancing and beam structures for Biidaasige Park (manufacturer press release).'],
    source: {
      label: 'Blue Medium — "WholeTrees Structures Brings Biophilic Timber Playscapes to Toronto\'s New Biidaasige Park" (manufacturer press release)',
      url: 'https://bluemedium.com/news/wholetrees-structures-brings-biophilic-timber-playscapes-to-torontos-new-biidaasige-park/',
    },
    note: 'LOCAL PREVIEW aggregate: inverted-trident White Oak units plus a generic low log circuit and mock-dam log tangle. ' +
      'The identifiable six-unit site is buildBiidaasigeInvertedTrees. Local origin; unplaced.',
  };
}

// ------------------------------------------------------------------------------------------------
// Exports
// ------------------------------------------------------------------------------------------------
C.BIIDAASIGE_CABLEWAY_LENGTHS_M = CABLEWAY_LENGTHS_M.slice();
C.BIIDAASIGE_CABLEWAY_SPEC = CABLEWAY_SPEC;
C.BIIDAASIGE_SWING_SPEC = SWING_SPEC;
C.BIIDAASIGE_TIMBER_SPEC = TIMBER_SPEC;
C.buildBiidaasigeCableway = buildBiidaasigeCableway;
C.buildBiidaasigeSwingSet = buildBiidaasigeSwingSet;
C.buildBiidaasigeInvertedTrees = buildBiidaasigeInvertedTrees;
C.buildBiidaasigeTimberPlay = buildBiidaasigeTimberPlay;
C.BIIDAASIGE_INVERTED_LAYOUT = DEFAULT_INVERTED_LAYOUT.map((u) => ({ ...u }));
})();
