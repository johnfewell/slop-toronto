(function () {
// js/biidaasige-play-fence.js
// Biidaasige Park — reusable LOCAL playground fence factory (bead st-bmyv.4.3, child of st-bmyv.4).
// Owns only this file, its test and its doc. It does not edit the adventure, Dodem, ground, path, park-data or
// shared-runtime modules, binds no site coordinates, reads no network/images and places nothing in a scene.
//
// WHAT THIS IS, AND WHAT IT IS NOT
//   * It builds the pale natural chestnut-style narrow picket fence the captain identified in the City's 2026
//     installed-Dodem ground photo and the MVVA 4800x3600 finished overhead: narrow wood pales ~0.9 m above ground,
//     thin round/irregular flattened pales 0.04-0.05 m wide with small uneven pointed tops, two thin grey wire ties
//     at ~0.3 m and ~0.65 m, and thicker wood posts every ~2 m.
//   * Every one of those dimensions is a PHOTO ESTIMATE, not a survey. The photo maker is unknown; no manufacturer,
//     contractor or product is asserted.
//   * This is a distinct construct from the Biidaasige dog-area fences, which were NOT identified in the sources
//     reviewed for this factory. Do not merge the two.
//   * The factory invents NO gap locations or captions. `opts.gaps` carries absolute arc-length openings that the
//     CALLER has confirmed from a source; without them the ring is built as a complete run. The caller also decides
//     whether the run is a closed ring or an open run.
//
// CONTRACT
//   C.buildBiidaasigePlayFence(points, opts) -> { group, colliders, stats, sourceConfidence }
//     points : finite ordered [[x, z], ...] ring vertices in metres. Closed by default (opts.closed !== false).
//     opts.groundY : number | (x, z) => number, default 0.
//     opts.gaps    : [{ startM, endM }] absolute arc-length intervals; on a closed ring an interval may wrap the
//                    seam (e.g. 95 -> 5). Caller-confirmed openings only.
//   Fresh THREE.Group, local origin, +Y up, 1 unit = 1 m. NOT added to a scene.
//   InstancedMesh only: <= 3 draw calls per run (pales, posts, wire ties). No mesh-per-picket geometry.
//   Returns actual instance count and triangle count; all geometry is finite.
//   `colliders` are slim ORIENTED proxy boxes per <= 2 m segment, clipped at gaps. minY = ground, maxY ~= 0.94 m.
//   The proxy deliberately does NOT claim the exact picket gaps below player width: it is a continuous run guard.

const C = (typeof window !== 'undefined' && (window.CITY || (window.CITY = {}))) || {};

const LIMITS = Object.freeze({
  maxLengthM: 500,
  maxInstances: 5000,
  maxTrianglesPer100m: 40000,
});

const DEFAULTS = Object.freeze({
  paleHeightM: 0.90,          // PHOTO ~0.9 m above ground
  postHeightM: 0.94,          // photo estimate; the proxy top is anchored to this
  paleWidthM: 0.045,          // PHOTO 0.04-0.05 m
  paleSpacingM: 0.12,         // photo estimate: narrow pales with open gaps
  postSpacingM: 2.0,          // PHOTO ~2 m between thicker posts
  postDiameterM: 0.10,        // photo estimate
  wireHeightsM: Object.freeze([0.30, 0.65]), // PHOTO two ties at ~0.3 / 0.65 m
  wireRadiusM: 0.004,         // photo estimate: thin grey wire
  heightJitterM: 0.03,        // deterministic visible irregularity, HEIGHT ONLY, +/- 0.03 m
  colliderSegmentM: 2.0,      // slack proxy boxes, one per <= 2 m of run
  colliderHalfThicknessM: 0.05,
  cullDistance: 450,
  cullCell: 30,
});

const SOURCE_CONFIDENCE = Object.freeze({
  physicalDimensions: 'photo-estimate, not survey',
  photoEvidence: 'City 2026 installed-Dodem ground photo and MVVA 4800x3600 finished overhead (captain-read)',
  heightAboveGroundM: '~0.9 (photo estimate)',
  paleWidthM: '0.04-0.05 (photo estimate)',
  wireTieHeightsM: '0.30 and 0.65 (photo estimate)',
  postSpacingM: '~2 (photo estimate)',
  maker: 'unknown (no manufacturer asserted)',
  gaps: 'caller-confirmed source openings only; this factory invents none',
  dogFenceRelationship: 'distinct construct; the Biidaasige dog-area fence was not identified',
  placement: 'local ring/run; not placed in the default scene',
});

function resolveTHREE(opts) {
  const T = (opts && opts.THREE) || C.THREE;
  if (!T || typeof T.InstancedMesh !== 'function' || typeof T.BufferGeometry !== 'function') {
    throw new Error('buildBiidaasigePlayFence requires THREE (set C.THREE or pass opts.THREE)');
  }
  return T;
}

function mod(v, m) { return ((v % m) + m) % m; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function hash01(i, salt) {
  let h = ((i | 0) * 374761393 + (salt | 0) * 668265263) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ------------------------------------------------------------------------------------------------
// Input: ordered finite ring/run vertices. Consecutive duplicates and a repeated closing vertex are
// dropped; the result must still have enough distinct vertices for the requested topology.
// ------------------------------------------------------------------------------------------------
function normalizePoints(input, closed) {
  if (!Array.isArray(input)) throw new TypeError('points must be an array of finite [x, z] vertices');
  const pts = [];
  for (const p of input) {
    let x, z;
    if (Array.isArray(p)) { x = p[0]; z = p[1]; }
    else if (p && typeof p === 'object') { x = p.x; z = p.z; }
    else throw new TypeError('each point must be [x, z]');
    if (!Number.isFinite(x) || !Number.isFinite(z)) throw new TypeError('every point coordinate must be finite');
    if (pts.length) {
      const last = pts[pts.length - 1];
      if (Math.abs(last[0] - x) < 1e-9 && Math.abs(last[1] - z) < 1e-9) continue;
    }
    pts.push([x, z]);
  }
  if (closed && pts.length > 1) {
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) pts.pop();
  }
  const min = closed ? 3 : 2;
  if (pts.length < min) throw new RangeError(`a ${closed ? 'closed ring' : 'run'} needs at least ${min} distinct vertices`);
  return pts;
}

function polyline(pts, closed) {
  const segments = [];
  const n = pts.length;
  const count = closed ? n : n - 1;
  let total = 0;
  for (let i = 0; i < count; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (!(len > 1e-12)) continue;
    segments.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], dx, dz, len, start: total, end: total + len });
    total += len;
  }
  if (!segments.length) throw new RangeError('the ordered vertices have zero perimeter');
  return { segments, lengthM: total, closed };
}

function pointAt(line, s) {
  const L = line.lengthM;
  let t;
  if (line.closed) {
    t = mod(s, L);
    if (t === L) t = 0;
  } else {
    t = clamp(s, 0, L);
  }
  const segs = line.segments;
  let lo = 0, hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].start <= t) lo = mid; else hi = mid - 1;
  }
  const seg = segs[lo];
  const f = seg.len > 0 ? clamp((t - seg.start) / seg.len, 0, 1) : 0;
  return {
    x: seg.ax + seg.dx * f,
    z: seg.az + seg.dz * f,
    tx: seg.dx / seg.len,
    tz: seg.dz / seg.len,
  };
}

// ------------------------------------------------------------------------------------------------
// Gaps: absolute arc-length intervals, including a closed-ring wraparound. Invalid/negative entries are
// normalized into [0, L) rather than producing NaN or a negative span. No gap is invented.
// ------------------------------------------------------------------------------------------------
function normalizeGaps(gaps, L, closed) {
  const out = [];
  const list = Array.isArray(gaps) ? gaps : [];
  for (const g of list) {
    if (!g || typeof g !== 'object') continue;
    const a0 = Number(g.startM), b0 = Number(g.endM);
    if (!Number.isFinite(a0) || !Number.isFinite(b0)) continue;
    if (closed) {
      let span = b0 - a0;
      if (span < 0) span = mod(span, L);
      if (span >= L - 1e-9) { out.push([0, L]); continue; }
      if (span <= 1e-9) continue;
      const start = mod(a0, L);
      const end = start + span;
      if (end <= L + 1e-9) out.push([start, Math.min(end, L)]);
      else { out.push([start, L]); out.push([0, end - L]); }
    } else {
      let lo = Math.min(a0, b0), hi = Math.max(a0, b0);
      if (hi <= 0 || lo >= L) continue;
      lo = clamp(lo, 0, L); hi = clamp(hi, 0, L);
      if (hi - lo <= 1e-9) continue;
      out.push([lo, hi]);
    }
  }
  out.sort((p, q) => p[0] - q[0]);
  const merged = [];
  for (const iv of out) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], iv[1]);
    else merged.push([iv[0], iv[1]]);
  }
  return merged;
}

function gapContains(gaps, s) {
  for (const g of gaps) if (s >= g[0] - 1e-9 && s <= g[1] + 1e-9) return true;
  return false;
}

function outsidePortions(s0, s1, gaps) {
  const out = [];
  let cur = s0;
  for (const g of gaps) {
    if (g[1] <= cur) continue;
    if (g[0] >= s1) break;
    if (g[0] > cur) out.push([cur, Math.min(g[0], s1)]);
    if (g[1] > cur) cur = g[1];
    if (cur >= s1) break;
  }
  if (cur < s1) out.push([cur, s1]);
  return out.filter((p) => p[1] - p[0] > 1e-6);
}

function arcDistance(a, b, L, closed) {
  const d = Math.abs(a - b);
  return closed ? Math.min(d, L - d) : d;
}

// ------------------------------------------------------------------------------------------------
// Geometry: one shared pointed-pale geometry. Each pale is a 6-sided prism with a pyramidal point,
// so the silhouette is volumetric rather than a flat quad. The tip is a single apex at y = 1.
// ------------------------------------------------------------------------------------------------
// A 5-sided prism with a pyramidal cap is the cheapest pale that still reads as a VOLUME with a point: 20 triangles
// per pale (5 wall quads = 10, a 5-facet tip = 5, a 5-facet base = 5). Flat-shaded normals so the facets catch light
// and the pale is not a flat white quad. A single apex vertex sits at y = 1, so the silhouette narrows to a point.
function paleGeometry(T, widthM) {
  const sides = 5;
  const radius = widthM / (2 * Math.cos(Math.PI / sides));
  const bodyTop = 0.93;
  const pos = [];
  const ringB = [], ringT = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    ringB.push([Math.cos(a) * radius, -0.01, Math.sin(a) * radius]);
    ringT.push([Math.cos(a) * radius, bodyTop, Math.sin(a) * radius]);
  }
  const apex = [0, 1, 0];
  const bottom = [0, -0.01, 0];
  const tri = (a, b, c) => pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    tri(ringB[i], ringT[i], ringT[j]);
    tri(ringB[i], ringT[j], ringB[j]);
    tri(ringT[i], apex, ringT[j]);
    tri(bottom, ringB[i], ringB[j]);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function makeMaterials(T) {
  const M = T.MeshStandardNodeMaterial || T.MeshStandardMaterial;
  return {
    wood: new M({ color: 0xc2a279, roughness: 0.92, metalness: 0.0 }),  // pale natural rough wood
    post: new M({ color: 0xb1946f, roughness: 0.94, metalness: 0.0 }),  // slightly darker thicker posts
    wire: new M({ color: 0x55585b, roughness: 0.45, metalness: 0.55 }), // exposed grey wire ties
  };
}

function trianglesOf(geometry) {
  if (geometry.index) return geometry.index.count / 3;
  const p = geometry.attributes && geometry.attributes.position;
  return p ? p.count / 3 : 0;
}

// ------------------------------------------------------------------------------------------------
// Public factory
// ------------------------------------------------------------------------------------------------
function buildBiidaasigePlayFence(points, opts = {}) {
  const T = resolveTHREE(opts);
  const closed = opts.closed !== false;
  const pts = normalizePoints(points, closed);
  const line = polyline(pts, closed);
  const L = line.lengthM;
  if (L > LIMITS.maxLengthM) {
    throw new RangeError(`fence run ${L.toFixed(1)} m exceeds the ${LIMITS.maxLengthM} m guard`);
  }

  const paleHeightM = Number.isFinite(opts.paleHeightM) ? opts.paleHeightM : DEFAULTS.paleHeightM;
  const paleWidthM = Number.isFinite(opts.paleWidthM) ? opts.paleWidthM : DEFAULTS.paleWidthM;
  const paleSpacingM = Number.isFinite(opts.paleSpacingM) ? opts.paleSpacingM : DEFAULTS.paleSpacingM;
  const postSpacingM = Number.isFinite(opts.postSpacingM) ? opts.postSpacingM : DEFAULTS.postSpacingM;
  const postHeightM = Number.isFinite(opts.postHeightM) ? opts.postHeightM : DEFAULTS.postHeightM;
  const postDiameterM = Number.isFinite(opts.postDiameterM) ? opts.postDiameterM : DEFAULTS.postDiameterM;
  const wireHeights = Array.isArray(opts.wireHeightsM) && opts.wireHeightsM.every(Number.isFinite)
    ? opts.wireHeightsM.slice()
    : DEFAULTS.wireHeightsM.slice();
  const jitter = Number.isFinite(opts.heightJitterM) ? Math.abs(opts.heightJitterM) : DEFAULTS.heightJitterM;
  const colliderSegmentM = Number.isFinite(opts.colliderSegmentM) && opts.colliderSegmentM > 1e-6
    ? opts.colliderSegmentM : DEFAULTS.colliderSegmentM;
  const halfThickness = Number.isFinite(opts.colliderHalfThicknessM)
    ? Math.abs(opts.colliderHalfThicknessM) : DEFAULTS.colliderHalfThicknessM;
  const groundAt = typeof opts.groundY === 'function'
    ? (x, z) => { const v = Number(opts.groundY(x, z)); return Number.isFinite(v) ? v : 0; }
    : () => (Number.isFinite(opts.groundY) ? opts.groundY : 0);

  if (!(paleHeightM > 0.2) || paleHeightM > 3) throw new RangeError('paleHeightM must be a sane metre value');
  if (!(paleWidthM > 0.005) || paleWidthM > 0.2) throw new RangeError('paleWidthM must be a sane metre value');
  if (!(paleSpacingM > 1e-4) || !(postSpacingM > 1e-4)) throw new RangeError('fence spacing must be positive');

  const gaps = normalizeGaps(opts.gaps, L, closed);
  const gapLengthM = gaps.reduce((sum, g) => sum + (g[1] - g[0]), 0);

  // Guard the whole build BEFORE allocating any instance arrays: a tiny spacing must be refused, not expanded.
  const paleEstimate = Math.floor(L / paleSpacingM) + 2;
  const postEstimate = Math.floor(L / postSpacingM) + 2;
  const wireEstimate = (Math.floor(L / colliderSegmentM) + 2) * wireHeights.length;
  if (paleEstimate > LIMITS.maxInstances || postEstimate > LIMITS.maxInstances || wireEstimate > LIMITS.maxInstances
    || paleEstimate + postEstimate + wireEstimate > LIMITS.maxInstances) {
    throw new RangeError(`fence would exceed the ${LIMITS.maxInstances} instance guard; increase spacing or shorten the run`);
  }

  // Post sites first, so pales can avoid standing inside a post.
  const postSites = [];
  if (closed) {
    for (let s = 0; s < L - 1e-9; s += postSpacingM) {
      if (!gapContains(gaps, s)) postSites.push(s);
    }
  } else {
    let last = -Infinity;
    for (let s = 0; s <= L + 1e-9; s += postSpacingM) {
      const at = Math.min(s, L);
      if (!gapContains(gaps, at)) { postSites.push(at); last = at; }
      if (at >= L) break;
    }
    if (L - last > 1e-6 && !gapContains(gaps, L)) postSites.push(L);
  }
  const postClearM = postDiameterM / 2 + 0.015;

  const paleSites = [];
  const paleLimit = closed ? L - 1e-9 : L + 1e-9;
  for (let s = 0; s <= paleLimit; s += paleSpacingM) {
    const at = closed ? s : Math.min(s, L);
    if (gapContains(gaps, at)) continue;
    if (postSites.some((p) => arcDistance(at, p, L, closed) < postClearM)) continue;
    paleSites.push(at);
    if (!closed && at >= L) break;
  }

  // Wire tie spans, split at every gap so no tie crosses an opening.
  const wireSpans = [];
  const spanCount = Math.ceil(L / colliderSegmentM);
  for (let i = 0; i < spanCount; i++) {
    const s0 = i * colliderSegmentM;
    const s1 = Math.min((i + 1) * colliderSegmentM, L);
    for (const part of outsidePortions(s0, s1, gaps)) {
      for (const h of wireHeights) wireSpans.push({ s0: part[0], s1: part[1], h });
    }
  }

  const instanceCount = paleSites.length + postSites.length + wireSpans.length;
  if (instanceCount > LIMITS.maxInstances) {
    throw new RangeError(`fence ${instanceCount} instances exceeds the ${LIMITS.maxInstances} guard`);
  }

  const mats = makeMaterials(T);
  const group = new T.Group();
  group.name = 'BiidaasigePlayFence';
  group.userData.placementStatus = 'unplaced';
  group.userData.cullDistance = DEFAULTS.cullDistance;
  group.userData.cullCell = DEFAULTS.cullCell;

  const palesGeo = paleGeometry(T, paleWidthM);
  const postGeo = new T.CylinderGeometry(1, 1, 1, 8, 1, false);
  postGeo.computeBoundingBox();
  const wireGeo = new T.CylinderGeometry(1, 1, 1, 6, 1, true);
  wireGeo.computeBoundingBox();

  const meshes = [];
  const matrices = new T.Matrix4();
  const quat = new T.Quaternion();
  const identity = new T.Quaternion();
  const pos = new T.Vector3();
  const scale = new T.Vector3();
  const up = new T.Vector3(0, 1, 0);
  const dir = new T.Vector3();

  function addInstanced(geo, mat, count, name, place) {
    if (!count) return null;
    const mesh = new T.InstancedMesh(geo, mat, count);
    mesh.name = name;
    mesh.castShadow = name !== 'play-fence-wire-ties';
    mesh.receiveShadow = true;
    mesh.userData.cullDistance = DEFAULTS.cullDistance;
    mesh.userData.cullCell = DEFAULTS.cullCell;
    mesh.userData.role = name;
    for (let i = 0; i < count; i++) {
      place(i, matrices);
      mesh.setMatrixAt(i, matrices);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox?.();
    mesh.computeBoundingSphere?.();
    group.add(mesh);
    meshes.push(mesh);
    return mesh;
  }

  addInstanced(palesGeo, mats.wood, paleSites.length, 'play-fence-pales', (i, m) => {
    const s = paleSites[i];
    const p = pointAt(line, s);
    const h = paleHeightM + (hash01(i, 0x51ed) * 2 - 1) * jitter;
    pos.set(p.x, groundAt(p.x, p.z), p.z);
    scale.set(1, Math.max(0.2, h), 1);
    m.compose(pos, identity, scale);
  });

  addInstanced(postGeo, mats.post, postSites.length, 'play-fence-posts', (i, m) => {
    const p = pointAt(line, postSites[i]);
    const r = postDiameterM / 2;
    pos.set(p.x, groundAt(p.x, p.z) + postHeightM / 2, p.z);
    scale.set(r, postHeightM, r);
    m.compose(pos, identity, scale);
  });

  addInstanced(wireGeo, mats.wire, wireSpans.length, 'play-fence-wire-ties', (i, m) => {
    const span = wireSpans[i];
    const a = pointAt(line, span.s0);
    const b = pointAt(line, span.s1);
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) {
      m.makeScale(0, 0, 0);
      return;
    }
    dir.set(dx / len, 0, dz / len);
    quat.setFromUnitVectors(up, dir);
    const gx = (a.x + b.x) / 2, gz = (a.z + b.z) / 2;
    pos.set(gx, groundAt(gx, gz) + span.h, gz);
    scale.set(DEFAULTS.wireRadiusM, len, DEFAULTS.wireRadiusM);
    m.compose(pos, quat, scale);
  });

  // Slim oriented proxy colliders: one per <= 2 m segment, clipped at every gap. Never one island-wide box.
  const colliders = [];
  for (let i = 0; i < spanCount; i++) {
    const s0 = i * colliderSegmentM;
    const s1 = Math.min((i + 1) * colliderSegmentM, L);
    for (const part of outsidePortions(s0, s1, gaps)) {
      const a = pointAt(line, part[0]);
      const b = pointAt(line, part[1]);
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
      const yaw = Math.atan2(dz, dx);
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      const hx = len / 2, hz = halfThickness;
      const ex = Math.abs(cs) * hx + Math.abs(sn) * hz;
      const ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
      const minY = groundAt(cx, cz);
      colliders.push({
        minX: cx - ex, maxX: cx + ex, minY, maxY: minY + postHeightM,
        minZ: cz - ez, maxZ: cz + ez,
        obb: { cx, cz, hx, hz, cs, sn },
        prop: true,
        kind: 'play-fence-proxy',
        proxy: true,
        claimsExactPicketGaps: false,
        note: 'continuous slim run proxy; does not resolve individual picket gaps below player width',
      });
    }
  }

  let triangles = 0;
  for (const mesh of meshes) triangles += trianglesOf(mesh.geometry) * mesh.count;

  const bounds = new T.Box3();
  for (const mesh of meshes) {
    mesh.computeBoundingBox?.();
    if (mesh.boundingBox) {
      mesh.updateMatrixWorld(true);
      bounds.union(mesh.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
    }
  }
  const bound = {
    minX: bounds.min.x, maxX: bounds.max.x,
    minY: bounds.min.y, maxY: bounds.max.y,
    minZ: bounds.min.z, maxZ: bounds.max.z,
  };
  group.userData.boundingBox = bound;
  group.userData.biidaasigePlayFence = {
    lengthM: L,
    instanceCount,
    triangles,
    sourceConfidence: SOURCE_CONFIDENCE,
  };

  const stats = {
    lengthM: L,
    perimeterM: L,
    closed,
    instanceCount,
    triangles,
    instances: { pales: paleSites.length, posts: postSites.length, wires: wireSpans.length },
    meshes: meshes.length,
    drawCalls: meshes.length,
    colliders: colliders.length,
    gapLengthM,
    gaps: gaps.map((g) => ({ startM: g[0], endM: g[1] })),
    bounds: bound,
    placementStatus: 'unplaced',
    sourceUnits: 'metres; ordered [x, z] vertices as supplied; +Y up; local origin',
    localOffset: 'pale/base at opts.groundY, not a world or park coordinate; caller supplies the site origin',
    source: 'caller-supplied ordered ring/run vertices; caller-confirmed openings only',
    estimates: {
      paleHeightM, paleWidthM, paleSpacingM, postSpacingM, postHeightM, postDiameterM,
      wireHeightsM: wireHeights.slice(), heightJitterM: jitter,
      colliderSegmentM, colliderHalfThicknessM: halfThickness,
    },
    limits: { maxLengthM: LIMITS.maxLengthM, maxInstances: LIMITS.maxInstances, maxTrianglesPer100m: LIMITS.maxTrianglesPer100m },
    sourceConfidence: SOURCE_CONFIDENCE,
  };

  return {
    group,
    colliders,
    stats,
    sourceConfidence: SOURCE_CONFIDENCE,
    instanceCount,
    triangles,
    lengthM: L,
    placementStatus: 'unplaced',
  };
}

// ------------------------------------------------------------------------------------------------
// Exports
// ------------------------------------------------------------------------------------------------
C.BIIDAASIGE_PLAY_FENCE_LIMITS = LIMITS;
C.BIIDAASIGE_PLAY_FENCE_DEFAULTS = DEFAULTS;
C.BIIDAASIGE_PLAY_FENCE_SOURCE_CONFIDENCE = SOURCE_CONFIDENCE;
C.buildBiidaasigePlayFence = buildBiidaasigePlayFence;
})();
