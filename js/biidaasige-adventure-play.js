(function () {
// js/biidaasige-adventure-play.js
// Biidaasige Park's Badlands Scramble and adventure play cluster (Port Lands / Ookwemin Minising, st-bmyv.4):
//
//   1. Badlands Scramble — the official City primacy feature. The City Recreation page describes 1,600 m² of
//      Cheltenham-Badlands-inspired play: THREE broad wavy terraces of warm-terracotta/red-orange sculpted shotcrete
//      with flat winding cream stone channels and paved landings, embedded rounded granite boulders, small stainless
//      hoop hand-pumps and water troughs, grates, low stone edging and tall timber poles. This module builds exactly that
//      on the ONE exact footprint OSM maps (way/1418541993): a CONTINUOUS, undulating, walkable triangle mesh clipped to
//      the mapped ring (not stacked uniform boxes, not random cones). A raised real triangle mesh, not an analytic
//      sampler, stands behind a shared barycentric height query so movement and rendering agree.
//
//   2. Reusable adventure play factories with NO invented positions:
//        cableway({ lengthM: 20 | 40 })      — Cableway Canyon's 20 m and 40 m cableways (official City source)
//        swingHill({ swingCount })           — Swing Hill (official City source)
//        mockBeaverDam()                     — the mock beaver dam (official City source)
//        dodemSculpture(kind)                — the seven Dodem clan animals (official City list)
//   The cableways/swings/mock dam have only a published ZONE, and the seven Dodem animals have no published individual
//   position, so this module NEVER places them. It returns them with position:null / placementStatus:'unplaced'.
//   Badlands is the only structure here with an exact OSM ring, so it is the only one this module places.
//
// Ground rules (docs/biidaasige-adventure-play.md):
//   - The native park ground is flat at y = 0 (the committed runtime's datum). Badlands is a RAISED mesh on top of it;
//     its base sits at the runtime datum and its sculpted landforms rise from there, blended back to y = 0 at the mapped
//     boundary so the footing meets the flat ground with no floating lip. baseY is a BUILD-time placement offset.
//   - The mesh converts WGS84 lat/lon ONLY through window.CITY.worldFromLatLon (never a private projection) and builds
//     nothing, returning null, when the frame does not cover the footprint.
//   - biidaasigeAdventureSurfaceAt(x, z, { baseY, maxRise }) is an EXACT RENDERED-TRIANGLE height query. It returns the
//     real world height h of the rendered triangle at (x, z), `y: h`, id 'badlands', and never clamps to a step or adds
//     anything but the mesh's own datum. `opts.baseY` is the PLAYER'S CURRENT height and `opts.maxRise` the allowed step:
//     if h > playerBaseY + maxRise the query returns null (too high to step, not a clamped fake height). It answers only
//     inside the rendered OSM footprint (never an implicit global deck or plate exemption) and returns null off-footprint.
//   - Every height/dimension is an explicit PHOTO ESTIMATE (Badlands `estimates`) or an official figure (1,600 m²,
//     20 m / 40 m cableways, seven clan animals). The official 1,600 m² area vs the mapped ~1,129 m² outline difference is
//     recorded, not faked by expanding the unscaled rectangle.
//   - The visible water channels are a static VISUAL flow only; they claim no physics. Nothing here is claimed
//     climbable or water-swimmable, and no count of boulders, pumps or grates pretends to be a mapped count.
//
// Sources: City of Toronto — Recreation at Biidaasige Park, modified 2026-09-09
//   <https://www.toronto.ca/explore-enjoy/parks-recreation/places-spaces/beaches-gardens-attractions/biidaasige-park/recreation-at-biidaasige-park/>
//   (1,600 m² Badlands Scramble; three wavy levels, flat stone pavement, pumped water; Cableway Canyon 20 m + 40 m;
//   Swing Hill; mock beaver dam; seven Dodem clan animals); the captain's own reading of the primary City photo
//   (captain/badlands.jpg, captain/dodem-eagle.jpg). No copyrighted photo is copied into the repository — cited only.

const C = (typeof window !== 'undefined' && (window.CITY || (window.CITY = {}))) || {};
const THREE = C.THREE;

// -------------------------------------------------------------------------------------------------------------------
// Badlands photo-estimate specification (recognisable over precise: every dimension is an estimate)
// -------------------------------------------------------------------------------------------------------------------
// The footprint outline comes from OSM (way/1418541993); these numbers sculpt inside it. All lengths in metres.
const BADLANDS_SPEC = {
  // Three broad wavy terraces (the City brief: "three wavy levels"), each a landing then a smooth slope up to its own
  // crest; the third terrace's crest is the crown (the top of the climb reaches riseTotal).
  terraces: [
    { id: 'lower', yBase: 0.0, yCrest: 0.65, phase: 0.0, waveAmp: 0.16 },
    { id: 'middle', yBase: 0.65, yCrest: 1.45, phase: 2.1, waveAmp: 0.20 },
    { id: 'crown', yBase: 1.45, yCrest: 2.2, phase: 4.3, waveAmp: 0.24 }
  ],
  riseTotal: 2.2,             // the whole sculpted rise (base 0 → crown crest)
  cellTarget: 1.6,            // the walkable mesh's target grid cell (resolution of the triangle mesh)
  maxCells: 4200,             // hard cap so the mesh stays bounded
  boundaryBlend: 2.2,         // over this many metres the sculpted height blends down to 0 at the OSM ring (walkable seam)
  terraceTreadDepth: 1.15,    // a nearly-flat landing on each terrace / at each landing strip
  channelCount: 3,            // winding cream channels that run the climb (visual flow only)
  channelWidth: 0.7,
  channelDepth: 0.09,
  channelMeander: 1.1,
  boulderCount: 11,           // embedded rounded granite boulders — a representative ESTIMATE, not a mapped count
  boulderRadiusMin: 0.35,
  boulderRadiusMax: 0.75,
  pumpCount: 5,               // small stainless hoop hand-pumps — representative ESTIMATE, not a mapped count
  troughWidth: 0.9,
  poleCount: 4,               // tall timber poles at the landings — representative ESTIMATE, not a mapped count
  poleHeight: 3.2,
  edgingHeight: 0.28,         // low stone edging around the mapped outline
  landingDepth: 1.8,          // flat stone paved landing strips at the crest and the foot
};

// -------------------------------------------------------------------------------------------------------------------
// Deterministic hashing (stable across builds; never random counts pretending to be mapped)
// -------------------------------------------------------------------------------------------------------------------
function hash01(i, s) {
  let h = ((i | 0) * 374761393 + (s | 0) * 668265263) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function smooth(t) { return t * t * (3 - 2 * t); }

// -------------------------------------------------------------------------------------------------------------------
// Projection + frame guards (never a private lat/lon guess; never fabricated geometry in a frame that lacks the site)
// -------------------------------------------------------------------------------------------------------------------
function frameCovers(box) {
  if (!box) return false;
  const f = C.GEO && C.GEO.frame && (C.GEO.frame.detail || C.GEO.frame);
  if (!f) return true;                       // no frame object present (a pure test with its own projection): allowed
  const x0 = fd(f.x0), x1 = fd(f.x1), z0 = fd(f.z0), z1 = fd(f.z1);
  if (![x0, x1, z0, z1].every(Number.isFinite)) return true;
  return box.minX >= x0 && box.maxX <= x1 && box.minZ >= z0 && box.maxZ <= z1;
}
function fd(v) { return typeof v === 'number' ? v : NaN; }

// The exact Badlands footprint as a world ring, from the EXISTING park-data API (js/biidaasige-park-data.js, owned by
// another worker — never edited here). `C.biidaasigeParkRingWorld('badlands-scramble')` returns the projected OSM ring
// as [{x,z},…]; `C.biidaasigeParkFeature('badlands-scramble')` carries the ref, the mapped area and the official area.
// Null (never an invented rectangle) when the projection is absent, the ring is missing, or the frame does not cover it.
function badlandsFootprint() {
  let ring = null, feature = null;
  if (typeof C.biidaasigeParkRingWorld === 'function') {
    const r = C.biidaasigeParkRingWorld('badlands-scramble');
    if (Array.isArray(r) && r.length >= 3) {
      ring = [];
      for (const p of r) {
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) { ring = null; break; }
        ring.push([p.x, p.z]);
      }
    }
  }
  if (!ring) return null;
  // drop a duplicated closing vertex (the OSM way repeats its first point) so the ear-clipping triangulation is clean
  if (ring.length > 1 && Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) < 1e-9) ring.pop();
  if (typeof C.biidaasigeParkFeature === 'function') feature = C.biidaasigeParkFeature('badlands-scramble');
  const bbox = ringBox(ring);
  if (!frameCovers(bbox)) return null;
  const areaM2 = Math.abs(ringSignedArea(ring));
  const officialAreaM2 = (feature && feature.official && Number.isFinite(feature.official.areaM2)) ? feature.official.areaM2 : 1600;
  const osmAreaM2 = (feature && Number.isFinite(feature.areaM2Mapped)) ? feature.areaM2Mapped : areaM2;
  return {
    way: (feature && feature.ref) || 'way/1418541993',
    name: (feature && feature.name) || 'Badlands Scramble',
    ring, bbox, areaM2, officialAreaM2, osmAreaM2,
  };
}

// -------------------------------------------------------------------------------------------------------------------
// 2D geometry helpers on the world ring
// -------------------------------------------------------------------------------------------------------------------
// Ear-clipping triangulation of a simple polygon (the OSM ring), so a CONCAVE outline is covered EXACTLY. Sutherland–
// Hodgman against the whole concave ring would clip to the convex KERNEL and silently drop the concave bays; ear clipping
// keeps every bay. Returns index triples into `ring` (each [x,z]).
function triangulateRing(ring) {
  const n = ring.length;
  if (n < 3) return [];
  const ccw = ringSignedArea(ring) > 0;
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(ccw ? i : n - 1 - i);
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let ear = -1;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i - 1 + idx.length) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
      if (isEar(ring, idx, a, b, c)) { ear = i; tris.push([a, b, c]); break; }
    }
    if (ear < 0) break;                       // degenerate ring: stop rather than emit a bad triangle
    idx.splice(ear, 1);
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}
function isEar(ring, idx, a, b, c) {
  const A = ring[a], B = ring[b], C = ring[c];
  const cross = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
  if (cross <= 1e-9) return false;            // reflex or collinear (CCW ring)
  for (const k of idx) {
    if (k === a || k === b || k === c) continue;
    if (pointInTriangle2D(ring[k], A, B, C)) return false;
  }
  return true;
}
function pointInTriangle2D(p, A, B, C) {
  const d1 = (p[0] - B[0]) * (A[1] - B[1]) - (A[0] - B[0]) * (p[1] - B[1]);
  const d2 = (p[0] - C[0]) * (B[1] - C[1]) - (B[0] - C[0]) * (p[1] - C[1]);
  const d3 = (p[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (p[1] - A[1]);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}
// Recursively bisect a triangle's longest edge until each sub-triangle's XZ area is <= targetArea (bounded depth). The
// midpoint height is sampled from the rendered field, so the subdivided mesh follows the sculpted surface.
function subdivideTriangle(A, B, C, targetArea, depth, emit, heightAt) {
  const area = triAreaXZ(A, B, C);
  if (area <= targetArea || depth >= 9) { emit(A, B, C); return; }
  const edges = [[A, B, C], [B, C, A], [C, A, B]];
  let best = 0, bestLen = -1;
  for (let e = 0; e < 3; e++) {
    const d = (edges[e][0][0] - edges[e][1][0]) ** 2 + (edges[e][0][2] - edges[e][1][2]) ** 2;
    if (d > bestLen) { bestLen = d; best = e; }
  }
  const [P, Q, R] = edges[best];
  const mx = (P[0] + Q[0]) / 2, mz = (P[2] + Q[2]) / 2;
  const M = [mx, heightAt(mx, mz), mz];
  subdivideTriangle(P, M, R, targetArea, depth + 1, emit, heightAt);
  subdivideTriangle(M, Q, R, targetArea, depth + 1, emit, heightAt);
}
function triAreaXZ(A, B, C) {
  return 0.5 * Math.abs((B[0] - A[0]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[0] - A[0]));
}

function ringSignedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}
function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function ringBox(ring) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
  return { minX, maxX, minZ, maxZ };
}
function distToRing(ring, x, z) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0], az = ring[j][1], bx = ring[i][0], bz = ring[i][1];
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1e-9;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1);
    const px = ax + dx * t, pz = az + dz * t;
    best = Math.min(best, Math.hypot(x - px, z - pz));
  }
  return best;
}

// -------------------------------------------------------------------------------------------------------------------
// The Badlands height field: a smooth, three-terraced sculpted profile measured in a local frame aligned to the OSM
// footprint's long axis. This is the RENDERED definition — the triangle mesh is sampled from exactly this, and the
// runtime height query reads the actual triangle, not this function. The channel carve + boulder/pump/pole features
// are drawn as part of the same mesh or as accessories on top of it.
// -------------------------------------------------------------------------------------------------------------------
function buildBadlandsField(footprint, spec) {
  const ring = footprint.ring;
  const box = footprint.bbox;
  // the footprint's long axis (the OSM outline's real extent, not a rotated guess)
  let best = 0, bestD = -1;
  for (let i = 1; i < ring.length; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > bestD) { bestD = d; best = i; }
  }
  const ax = ring[best][0] - ring[0][0], az = ring[best][1] - ring[0][1];
  const len = Math.hypot(ax, az) || 1;
  const ux = ax / len, uz = az / len;       // long-axis unit vector
  const nx = -uz, nz = ux;                  // cross-axis unit vector
  const cx = (box.minX + box.maxX) / 2, cz = (box.minZ + box.maxZ) / 2;

  // local coordinates: s along the long axis (the climb direction), t across it (the wavy bays)
  const toLocal = (x, z) => ({ s: (x - cx) * ux + (z - cz) * uz, t: (x - cx) * nx + (z - cz) * nz });
  const halfSpan = Math.max(Math.abs(toLocal(box.minX, box.minZ).s), Math.abs(toLocal(box.maxX, box.maxZ).s), 6);

  // map s ∈ [-halfSpan, +halfSpan] to a 0..1 climb, with three terraces. Each terrace is a wavy landing → a slope.
  const T = spec.terraces;                       // 3 broad terraces, each a wavy landing→slope, climbing to riseTotal
  const n = T.length;
  // the 1..3 OFFICIAL terrace a point belongs to
  const terraceOf = (u) => Math.min(n, Math.floor(clamp(u, 0, 1) * n) + 1);
  const bandOf = (u) => clamp(Math.floor(clamp(u, 0, 1) * n), 0, n - 1);
  // The sculpted profile BEFORE the boundary blend: the three terraces climbing along the long axis.
  const profileAt = (x, z) => {
    const { s, t } = toLocal(x, z);
    const u = clamp((s + halfSpan) / (2 * halfSpan), 0, 1);           // 0 foot, 1 crest
    const band = bandOf(u);
    const frac = u * n - band;
    const tr = T[band];
    // within a band: a flat landing on the first ~30 %, then a smooth slope up toward the band's crest
    const landing = 0.30;
    const up = frac <= landing ? 0 : smooth((frac - landing) / (1 - landing));
    // the wavy bays across the terrace (the Cheltenham ripple): a transverse sine that gently warps the height
    const wave = Math.sin((t / 5.5) * Math.PI * 2 + tr.phase) * tr.waveAmp * (0.4 + 0.6 * up);
    // a broad meandering gully carved along the climb (the flat cream channels below sit in it)
    const gully = -0.2 * Math.pow(Math.max(0, Math.cos(((t + 2.0 * Math.sin(u * 3.1)) / 6.4) * Math.PI)), 6);
    const baseY = tr.yBase + (tr.yCrest - tr.yBase) * up;
    return baseY + wave + gully * (band < n - 1 ? 1 : 0.5);
  };
  // The RENDERED height: the profile blended to 0 at the OSM boundary (so the walkable footing meets the flat ground
  // at y = 0, never a floating 1 mm lip) and tapered to 0 at both ends of the long axis (so the crown is inset and the
  // player can walk on and off from every edge). Clamped to >= 0 (no negative height below the ground datum).
  const blendWidth = spec.boundaryBlend;
  const heightAt = (x, z) => {
    const d = distToRing(ring, x, z);
    const edge = smooth(clamp(d / blendWidth, 0, 1));                 // 0 at the ring, 1 in the interior
    const { s } = toLocal(x, z);
    const u = clamp((s + halfSpan) / (2 * halfSpan), 0, 1);
    const end = smooth(clamp(u / 0.18, 0, 1)) * (1 - smooth(clamp((u - 0.80) / 0.16, 0, 1)));
    return Math.max(0, profileAt(x, z) * edge * end);
  };
  return { toLocal, profileAt, heightAt, bandOf, terraceOf, halfSpan, cx, cz, ux, uz, nx, nz };
}

// -------------------------------------------------------------------------------------------------------------------
// Materials — plain MeshStandardNodeMaterial, no image inputs, frame-safe to build in a CPU test
// -------------------------------------------------------------------------------------------------------------------
function badlandsMaterials() {
  const M = THREE.MeshStandardNodeMaterial;
  return {
    terraces: new M({ color: 0xb4542b, roughness: 0.86, metalness: 0.0 }),     // warm terracotta/red-orange shotcrete
    stones: new M({ color: 0xcbb894, roughness: 0.82, metalness: 0.0 }),       // flat winding cream stone channels
    granite: new M({ color: 0x8a8378, roughness: 0.78, metalness: 0.0 }),      // rounded granite boulders
    metal: new M({ color: 0xc9ccce, roughness: 0.24, metalness: 0.9 }),        // stainless hoop hand-pumps / grates
    timber: new M({ color: 0x7c5a39, roughness: 0.92, metalness: 0.0 }),       // tall timber poles
    water: new M({ color: 0x6fb6c4, roughness: 0.25, metalness: 0.0, transparent: true, opacity: 0.72 }),
    edging: new M({ color: 0x9c8f78, roughness: 0.86, metalness: 0.0 }),       // low stone edging
  };
}

// Merge a [{geo,key}] list into one geometry per material key (real merge; a concat fallback without the util).
function mergeByKey(list) {
  const out = new Map();
  for (const { geo, key } of list) {
    if (!geo) continue;
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
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
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

// -------------------------------------------------------------------------------------------------------------------
// The Badlands Scramble
// -------------------------------------------------------------------------------------------------------------------
function buildBadlandsScramble(opts = {}) {
  const S = { ...BADLANDS_SPEC, ...(opts.spec || {}) };
  const fp = badlandsFootprint();
  if (!fp) return null;                       // projection absent or frame does not cover the site: build nothing
  const field = buildBadlandsField(fp, S);
  const boxInset = fp.bbox;

  // -------- 1. the WALKABLE triangle mesh: the exact OSM ring triangulated by EAR CLIPPING (so a CONCAVE outline is
  // covered exactly — no convex-kernel clipping), then each triangle subdivided to ~cellTarget so the sculpted height is
  // sampled densely. Every vertex height comes from the rendered field, so the mesh and the query agree by construction.
  const baseY = Number.isFinite(opts.baseY) ? opts.baseY : 0;   // BUILD-time placement offset, baked into the geometry
  const ringTris = triangulateRing(fp.ring);
  if (!ringTris.length) return null;
  const targetArea = S.cellTarget * S.cellTarget;
  const subTris = [];                          // [{ verts:[[x,y,z],..], terrace }]
  const heightAt = (x, z) => field.heightAt(x, z);
  for (const [i0, i1, i2] of ringTris) {
    const A = [fp.ring[i0][0], heightAt(fp.ring[i0][0], fp.ring[i0][1]), fp.ring[i0][1]];
    const B = [fp.ring[i1][0], heightAt(fp.ring[i1][0], fp.ring[i1][1]), fp.ring[i1][1]];
    const Cc = [fp.ring[i2][0], heightAt(fp.ring[i2][0], fp.ring[i2][1]), fp.ring[i2][1]];
    subdivideTriangle(A, B, Cc, targetArea, 0, (P, Q, R) => {
      const local = field.toLocal((P[0] + Q[0] + R[0]) / 3, (P[2] + Q[2] + R[2]) / 3);
      const u = clamp((local.s + field.halfSpan) / (2 * field.halfSpan), 0, 1);
      subTris.push({ verts: [P, Q, R], terrace: field.terraceOf(u) });
    }, heightAt);
  }
  if (!subTris.length) return null;
  const floorGeo = new THREE.BufferGeometry();
  const fpos = [], fuv = [];
  const tris = [];
  const solidProps = [];                       // solid props only (poles); the walkable terrain is NOT a collider box
  const spanX = Math.max(1e-6, fp.bbox.maxX - fp.bbox.minX), spanZ = Math.max(1e-6, fp.bbox.maxZ - fp.bbox.minZ);
  for (const { verts, terrace } of subTris) {
    const [A, B, Cc] = verts;
    // upward winding so the triangle renders up and the walk query reads it
    const nyv = (B[2] - A[2]) * (Cc[0] - A[0]) - (B[0] - A[0]) * (Cc[2] - A[2]);
    const order = nyv < 0 ? [A, Cc, B] : [A, B, Cc];
    for (const p of order) { fpos.push(p[0], p[1] + baseY, p[2]); fuv.push((p[0] - fp.bbox.minX) / spanX, (p[2] - fp.bbox.minZ) / spanZ); }
    tris.push({ x: [A[0], B[0], Cc[0]], y: [A[1] + baseY, B[1] + baseY, Cc[1] + baseY], z: [A[2], B[2], Cc[2]], terrace });
  }
  floorGeo.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3));
  floorGeo.setAttribute('uv', new THREE.Float32BufferAttribute(fuv, 2));
  floorGeo.computeVertexNormals();

  // -------- 2. accessories: cream stone channels + paved landings (flat winding strips), granite boulders, stainless
  // hoop pumps/troughs/grates, low stone edging, tall timber poles. All bounded by the footprint; nothing supplements
  // the floor outside the rendered ring.
  const parts = [{ geo: floorGeo, key: 'terraces' }];
  const thinStrip = (x0, z0, x1, z1, w, y, step = 0.5) => {
    // a flat cream channel/landing strip as a thin ribbon of quads (visual only)
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(2, Math.ceil(len / step));
    const ux2 = (x1 - x0) / len, uz2 = (z1 - z0) / len;
    const px = -uz2 * w / 2, pz = ux2 * w / 2;
    const pos = [], nor = [], uv = [];
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const a = [x0 + (x1 - x0) * t0 + px, y, z0 + (z1 - z0) * t0 + pz];
      const b = [x0 + (x1 - x0) * t0 - px, y, z0 + (z1 - z0) * t0 - pz];
      const c = [x0 + (x1 - x0) * t1 - px, y, z0 + (z1 - z0) * t1 - pz];
      const d = [x0 + (x1 - x0) * t1 + px, y, z0 + (z1 - z0) * t1 + pz];
      for (const q of [b, a, d, b, d, c]) { pos.push(...q); nor.push(0, 1, 0); uv.push(0, 0); }
    }
    return { geo: bufferGeo(pos, nor, uv), key: 'stones' };
  };
  // three meandering channels run the climb (visual flow only); the channel y follows the floor at its start point
  for (let ch = 0; ch < S.channelCount; ch++) {
    const t0 = (ch - 1) * 2.4;
    const steps = 10;
    for (let k = 0; k < steps; k++) {
      const u0 = k / steps, u1 = (k + 1) / steps;
      const s0 = -field.halfSpan + 2 * field.halfSpan * u0, s1 = -field.halfSpan + 2 * field.halfSpan * u1;
      const wav0 = Math.sin(u0 * 3.1 * Math.PI + ch) * S.channelMeander, wav1 = Math.sin(u1 * 3.1 * Math.PI + ch) * S.channelMeander;
      const p0 = fieldPoint(field, s0, t0 + wav0), p1 = fieldPoint(field, s1, t0 + wav1);
      if (!pointInRing(fp.ring, p0[0], p0[1]) || !pointInRing(fp.ring, p1[0], p1[1])) continue;
      const y0 = field.heightAt(p0[0], p0[1]) + S.channelDepth;
      const y1 = field.heightAt(p1[0], p1[1]) + S.channelDepth;
      parts.push(thinStrip(p0[0], p0[1], p1[0], p1[1], S.channelWidth, Math.max(y0, y1) + 0.01, 0.6));
    }
  }
  // flat stone paved landing strips: a broad cream apron at the foot and one at the crest
  for (const uLand of [0.06, 0.94]) {
    const s = -field.halfSpan + 2 * field.halfSpan * uLand;
    const a = fieldPoint(field, s, -3.4), b = fieldPoint(field, s, 3.4);
    if (pointInRing(fp.ring, a[0], a[1]) && pointInRing(fp.ring, b[0], b[1])) {
      const y = field.heightAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) + 0.012;
      const strip = thinStrip(a[0], a[1], b[0], b[1], 3.0, y, 0.6);
      strip.key = 'stones';
      parts.push(strip);
    }
  }
  // rounded granite boulders embedded along the terrace edges + across the slopes (representative estimate, NOT counted)
  for (let k = 0; k < S.boulderCount; k++) {
    const u = 0.12 + 0.76 * hash01(k, 3), t = -3.8 + 7.6 * hash01(k, 11);
    const p = fieldPoint(field, -field.halfSpan + 2 * field.halfSpan * u, t);
    if (!pointInRing(fp.ring, p[0], p[1])) continue;
    const y = field.heightAt(p[0], p[1]);
    const r = S.boulderRadiusMin + (S.boulderRadiusMax - S.boulderRadiusMin) * hash01(k, 29);
    parts.push({ geo: roundedBoulder(p[0], y, p[1], r, k % 3), key: 'granite' });
  }
  // stainless hoop hand-pumps + water troughs at flat landings + grates (representative estimate, NOT a mapped count)
  for (let k = 0; k < S.pumpCount; k++) {
    const u = 0.12 + 0.76 * hash01(k, 41), t = -2.6 + 5.2 * hash01(k, 53);
    const p = fieldPoint(field, -field.halfSpan + 2 * field.halfSpan * u, t);
    if (!pointInRing(fp.ring, p[0], p[1])) continue;
    const y = field.heightAt(p[0], p[1]);
    const hoop = 0.9;
    // a small stainless hoop (a bent cylinder) + a shallow trough + a grate
    parts.push({ geo: hoopGeometry(p[0], y, p[1], hoop, 0.045), key: 'metal' });
    parts.push({ geo: troughGeometry(p[0], y, p[1], S.troughWidth, hoop), key: 'water' });
    parts.push({ geo: grateGeometry(p[0] + hoop * 0.4, y + 0.02, p[1], 0.5, 0.5), key: 'metal' });
  }
  // low stone edging around the mapped outline (a thin apron following the OSM ring exactly)
  parts.push({ geo: edgingGeometry(fp.ring, field, S.edgingHeight), key: 'edging' });
  // tall timber poles at the landings (representative estimate, NOT counted)
  for (let k = 0; k < S.poleCount; k++) {
    const u = 0.1 + 0.8 * hash01(k, 71), t = (k % 2 === 0 ? -3.7 : 3.7);
    const p = fieldPoint(field, -field.halfSpan + 2 * field.halfSpan * u, t);
    if (!pointInRing(fp.ring, p[0], p[1])) continue;
    const y = field.heightAt(p[0], p[1]);
    parts.push({ geo: poleGeometry(p[0], y, p[1], S.poleHeight), key: 'timber' });
    // a tall timber pole is a solid prop: a small AABB the body can bump into (NOT a terrain box)
    solidProps.push({ minX: p[0] - 0.2, maxX: p[0] + 0.2, minY: y + baseY, maxY: y + baseY + S.poleHeight, minZ: p[1] - 0.2, maxZ: p[1] + 0.2, prop: true, kind: 'badlands-pole' });
  }

  // -------- assemble
  const merged = mergeByKey(parts);
  const mats = badlandsMaterials();
  const group = new THREE.Group();
  group.name = 'BiidaasigeBadlandsScramble';
  let triangles = 0;
  const drawCalls = [];
  for (const [key, geo] of merged) {
    const mesh = new THREE.Mesh(geo, mats[key] || mats.terraces);
    mesh.name = `BiidaasigeBadlandsScramble-${key}`;
    mesh.castShadow = key !== 'water';
    mesh.receiveShadow = true;
    group.add(mesh);
    triangles += geo.attributes.position.count / 3;
    drawCalls.push({ key, triangles: geo.attributes.position.count / 3 });
  }

  // -------- the shared walk/height query: the RENDERED triangle's barycentric height, indexed by a coarse XZ grid so a
  // query touches O(1) candidate triangles. Every triangle's y is the mesh's OWN baked world height (baseY offset already
  // applied to the geometry below), so the query returns exactly what is drawn. The query is REGISTERED (not built by a
  // query call) and reset on every rebuild so a stale mesh can never answer.
  const query = makeSurfaceQuery(tris, fp.ring, 2.0, baseY);
  C.__biidaasigeAdventureQuery = { query, ring: fp.ring, baseY, way: fp.way };   // registered by the build; a query NEVER builds
  const footprints = [{ ring: fp.ring, way: fp.way, areaM2: fp.areaM2, officialAreaM2: fp.officialAreaM2, osmAreaM2: fp.osmAreaM2 }];

  return {
    group,
    triangles,
    drawCalls,
    colliders: solidProps,   // solid props only (tall timber poles); the walkable terrain is NOT a collider box
    climbable: false,                        // the captain integrates movement/footing before this is true
    waterPhysics: false,                     // the channels are static visual flow only
    footprint: footprints[0],
    bbox: fp.bbox,
    baseY,
    riseTotal: S.riseTotal,
    surfaceHeightAt: (x, z, o) => surfaceHeightAt(query, x, z, o),
    _query: query,
    estimates: { ...S },
    sources: [{
      label: 'City of Toronto — Recreation at Biidaasige Park (modified 2026-09-09)',
      url: 'https://www.toronto.ca/explore-enjoy/parks-recreation/places-spaces/beaches-gardens-attractions/biidaasige-park/recreation-at-biidaasige-park/',
      facts: ['Badlands Scramble: 1,600 m²', 'three wavy levels', 'flat stone-pavement sections', 'water pumped down its slopes']
    }, {
      label: 'OpenStreetMap way/1418541993 (Badlands Scramble footprint)',
      url: 'https://www.openstreetmap.org/way/1418541993',
      attribution: 'Data © OpenStreetMap contributors (ODbL).'
    }],
    attribution: 'Badlands Scramble reconstruction for Slop Toronto. Footprint © OpenStreetMap contributors (ODbL). No image reproduced.',
  };
}

// A point on the local (s, t) field back in world x/z, using the field's basis.
function fieldPoint(field, s, t) {
  return [field.cx + s * field.ux + t * field.nx, field.cz + s * field.uz + t * field.nz];
}

function bufferGeo(pos, nor, uv) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

// A rounded granite boulder: a low-poly sphere flattened into the ground (embedded), varied by seed.
function roundedBoulder(x, y, z, r, seed) {
  const g = new THREE.SphereGeometry(r, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const wob = 1 + (hash01(i, seed + 7) - 0.5) * 0.24;
    p.setXYZ(i, p.getX(i) * wob * 1.1, Math.max(0, p.getY(i) * wob * 0.7), p.getZ(i) * wob * 1.1);
  }
  g.translate(x, y - r * 0.18, z);           // sunk ~18 % so it reads embedded
  g.computeVertexNormals();
  return g.toNonIndexed();
}
// A small stainless hoop hand-pump: a bent tube rising from the ground and curving over.
function hoopGeometry(x, y, z, size, tube) {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI;
    pts.push(new THREE.Vector3(x + Math.cos(a) * size * 0.5, y + size * 0.35 + Math.sin(a) * size * 0.6, z));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, 14, tube, 6, false);
  g.translate(0, 0, 0);
  g.computeVertexNormals();
  return g.toNonIndexed();
}
// A shallow water trough (a low open box) under the hoop.
function troughGeometry(x, y, z, width, size) {
  const half = width / 2, depth = 0.16, len = size * 1.1;
  const pos = [], nor = [], uv = [];
  const push = (a, b, c, n) => { for (const q of [a, b, c]) { pos.push(...q); nor.push(...n); uv.push(0, 0); } };
  const y0 = y + 0.02, y1 = y + depth;
  const L = [x - half, 0, z - len / 2], R = [x + half, 0, z - len / 2], R2 = [x + half, 0, z + len / 2], L2 = [x - half, 0, z + len / 2];
  // inner floor + four low walls (visual shallow basin)
  const floor = [[L[0], y0, L[2]], [R[0], y0, R[2]], [R2[0], y0, R2[2]], [L2[0], y0, L2[2]]];
  push(floor[0], floor[2], floor[1], [0, 1, 0]); push(floor[0], floor[3], floor[2], [0, 1, 0]);
  const wall = (a, b) => push([a[0], y0, a[2]], [b[0], y0, b[2]], [b[0], y1, b[2]], [1, 0, 0]);
  wall(L, R); wall(R2, L2); wall(R, R2); wall(L2, L);
  return bufferGeo(pos, nor, uv);
}
function grateGeometry(x, y, z, w, d) {
  helperBox.push({ x, y, z, w, h: 0.03, d, style: 'grate' });
  return boxAt(x, y, z, w, 0.03, d);
}
const helperBox = [];
function boxAt(x, y, z, w, h, d) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return g.toNonIndexed(); }
// A tall timber pole with a small cross-brace.
function poleGeometry(x, y, z, height) {
  const parts = [];
  parts.push(cylAt(x, y + height / 2, z, 0.11, 0.13, height, 10));
  parts.push(cylAt(x + 0.02, y + height + 0.05, z, 0.15, 0.04, 0.12, 10));
  return concatGeos(parts);
}
function cylAt(x, y, z, rTop, rBot, h, seg) { const g = new THREE.CylinderGeometry(rTop, rBot, h, seg); g.translate(x, y, z); return g.toNonIndexed(); }
// Low stone edging: a thin apron around the OSM ring, following the ring exactly (a real boundary, no invented box).
function edgingGeometry(ring, field, height) {
  const pos = [], nor = [], uv = [];
  const push = (a, b, c) => { for (const q of [a, b, c]) { pos.push(q[0], q[1], q[2]); nor.push(0, 1, 0); uv.push(0, 0); } };
  let cx = 0, cz = 0;
  for (const [x, z] of ring) { cx += x; cz += z; }
  cx /= ring.length; cz /= ring.length;
  for (let i = 0; i < ring.length; i++) {
    const A = ring[i], B = ring[(i + 1) % ring.length];
    if (Math.hypot(B[0] - A[0], B[1] - A[1]) < 1e-6) continue;
    const yA = field.heightAt(A[0], A[1]), yB = field.heightAt(B[0], B[1]);
    const ia = insetToward(A, cx, cz, 0.35), ib = insetToward(B, cx, cz, 0.35);
    const oA = [A[0], yA + height, A[1]], oB = [B[0], yB + height, B[1]];
    const iA = [ia[0], yA + height, ia[1]], iB = [ib[0], yB + height, ib[1]];
    push(oA, iB, iA); push(oA, oB, iB);
  }
  return bufferGeo(pos, nor, uv);
}
function insetToward(p, cx, cz, d) {
  const dx = p[0] - cx, dz = p[1] - cz, len = Math.hypot(dx, dz) || 1;
  return [p[0] - (dx / len) * d, p[1] - (dz / len) * d];
}

// -------------------------------------------------------------------------------------------------------------------
// The shared barycentric height query: an XZ grid over the rendered triangles, each triangle registered in every cell
// its bbox touches; a query scans the cell's triangles and returns the exact barycentric height of the one it lands in.
// This is the SINGLE source the mesh renders from, so query and render agree by construction (no separate sampler).
// -------------------------------------------------------------------------------------------------------------------
function makeSurfaceQuery(tris, ring, cell, baseY) {
  const box = ringBox(ring);
  const nx = Math.max(1, Math.ceil((box.maxX - box.minX) / cell)), nz = Math.max(1, Math.ceil((box.maxZ - box.minZ) / cell));
  const cells = new Array(nx * nz);
  const colOf = (x) => clamp(Math.floor((x - box.minX) / cell), 0, nx - 1);
  const rowOf = (z) => clamp(Math.floor((z - box.minZ) / cell), 0, nz - 1);
  tris.forEach((t, ti) => {
    const minX = Math.min(t.x[0], t.x[1], t.x[2]), maxX = Math.max(t.x[0], t.x[1], t.x[2]);
    const minZ = Math.min(t.z[0], t.z[1], t.z[2]), maxZ = Math.max(t.z[0], t.z[1], t.z[2]);
    for (let c = colOf(minX); c <= colOf(maxX); c++) {
      for (let r = rowOf(minZ); r <= rowOf(maxZ); r++) {
        const k = c * nz + r;
        (cells[k] || (cells[k] = [])).push(ti);
      }
    }
  });
  return { tris, cells, colOf, rowOf, nx, nz, box, ring, baseY: Number.isFinite(baseY) ? baseY : 0 };
}

// The EXACT rendered-triangle surface height at (x, z). Every stored triangle vertex already includes the BUILD-time baseY
// (the mesh is translated by it), so `h` here is the true world height of the drawn triangle — nothing is added and
// nothing is clamped to a step. `opts.baseY` is the PLAYER'S CURRENT height and `opts.maxRise` the allowed step: if
// h > playerBaseY + maxRise the point is out of footing range and the query returns null (NOT a clamped fake height).
// Answering is independent of the caller's height when neither is supplied. Returns null off the rendered footprint.
function surfaceHeightAt(query, x, z, opts) {
  const o = opts || {};
  const playerY = Number.isFinite(o.baseY) ? o.baseY : null;
  const maxRise = Number.isFinite(o.maxRise) ? o.maxRise : null;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  // (the ring's box first: a query away from the Badlands stops here, not after walking the ring; st-s1y8)
  const qb = query.box;
  if (x < qb.minX || x > qb.maxX || z < qb.minZ || z > qb.maxZ) return null;
  if (!pointInRing(query.ring, x, z)) return null;
  const list = query.cells[query.colOf(x) * query.nz + query.rowOf(z)];
  if (!list) return null;
  for (const ti of list) {
    const t = query.tris[ti];
    const h = baryHeight(t.x, t.y, t.z, x, z);
    if (h === null) continue;
    if (playerY !== null && maxRise !== null && h > playerY + maxRise) return null;   // too high to step: no footing
    return { id: 'badlands', x, z, y: h, h, terrace: t.terrace, meshDatum: query.baseY || 0 };
  }
  return null;
}
function baryHeight(X, Y, Z, px, pz) {
  const x0 = X[0], x1 = X[1], x2 = X[2], z0 = Z[0], z1 = Z[1], z2 = Z[2];
  const den = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
  if (Math.abs(den) < 1e-9) return null;
  const a = ((z1 - z2) * (px - x2) + (x2 - x1) * (pz - z2)) / den;
  const b = ((z2 - z0) * (px - x2) + (x0 - x2) * (pz - z2)) / den;
  const c = 1 - a - b;
  const e = -1e-6;
  if (a < e || b < e || c < e) return null;
  return a * Y[0] + b * Y[1] + c * Y[2];
}

// -------------------------------------------------------------------------------------------------------------------
// Reusable adventure play factories — NO invented positions. Cableways/swings/mock dam have only a published ZONE and
// the seven Dodem animals have no published individual position: every one is returned unplaced (position: null).
// -------------------------------------------------------------------------------------------------------------------
const CABLEWAY_M = [20, 40];                 // the two official City cableway lengths
const DODEM_ANIMALS = ['bear', 'beaver', 'eagle', 'turtle', 'otter', 'wolf', 'musky'];

function adventureMaterials() {
  const M = THREE.MeshStandardNodeMaterial;
  return {
    cable: new M({ color: 0x565a5e, roughness: 0.45, metalness: 0.7 }),
    metal: new M({ color: 0xc4c8cb, roughness: 0.3, metalness: 0.85 }),
    timber: new M({ color: 0x8a6239, roughness: 0.92, metalness: 0.0 }),
    timberDark: new M({ color: 0x5a3c25, roughness: 0.94, metalness: 0.0 }),
    seat: new M({ color: 0x2f3236, roughness: 0.7, metalness: 0.1 }),
    wood: new M({ color: 0x896a43, roughness: 0.93, metalness: 0.0 }),
    stone: new M({ color: 0x9c9a92, roughness: 0.9, metalness: 0.0 }),
  };
}

// A cableway of an official length (20 m or 40 m): two posts and a taut cable. `lengthM` must be one of the published
// lengths (a caller passing any other number is clamped to the nearest official length and told so in `clamped`).
function buildCableway(opts = {}) {
  const req = Number.isFinite(opts.lengthM) ? opts.lengthM : CABLEWAY_M[0];
  const lengthM = CABLEWAY_M.reduce((best, v) => (Math.abs(v - req) < Math.abs(best - req) ? v : best), CABLEWAY_M[0]);
  const clamped = lengthM !== req;
  const postH = 4.2, span = lengthM;
  const parts = [];
  const postX = [-span / 2, span / 2];
  for (const px of postX) {
    parts.push({ geo: cylAt(px, postH / 2, 0, 0.14, 0.18, postH, 12), key: 'metal' });
    parts.push({ geo: boxAt(px, 0.1, 0, 0.7, 0.2, 0.7), key: 'metal' });
    parts.push({ geo: cylAt(px, postH - 0.2, 0, 0.1, 0.1, 0.5, 8), key: 'metal' });
  }
  // the taut cable between the post tops (a wire, + a little sag visual thing is not modelled: drawn straight)
  parts.push({ geo: cableBetween(new THREE.Vector3(postX[0], postH - 0.1, 0), new THREE.Vector3(postX[1], postH - 0.1, 0), 0.03), key: 'cable' });
  // a trolley seat hanging at ~1/3 along
  const tx = postX[0] + span * 0.35;
  parts.push({ geo: cableBetween(new THREE.Vector3(tx, postH - 0.1, 0), new THREE.Vector3(tx, 1.1, 0), 0.02), key: 'cable' });
  parts.push({ geo: boxAt(tx, 0.95, 0, 0.7, 0.12, 0.3), key: 'seat' });
  const group = assemble(parts, adventureMaterials(), 'BiidaasigeCableway', 'timber');
  return {
    group, triangles: countTris(group), lengthM, officialLengths: CABLEWAY_M.slice(), clamped,
    position: null, placementStatus: 'unplaced',
    footprintM: [lengthM, 2.5],
    source: 'City of Toronto — Recreation at Biidaasige Park: Cableway Canyon has 20 m and 40 m cableways',
    note: 'Zone-only position (Cableway Canyon). Not placed here; the caller places it when a verified position exists.',
  };
}

// Swing Hill: a timber A-frame with a line of swings. `swingCount` is a caller choice, not a mapped count.
function buildSwingHill(opts = {}) {
  const count = clamp(Math.round(Number.isFinite(opts.swingCount) ? opts.swingCount : 3), 1, 5);
  const partW = 2.4, spanW = partW * count;
  const topY = 3.0, legSpread = 2.0, beamLen = spanW + 1.4;
  const parts = [];
  // the beam + two A-frame legs at each end
  parts.push({ geo: cylAt(0, topY, 0, 0.1, 0.1, beamLen, 10).rotateZ(Math.PI / 2), key: 'timber' });
  for (const sx of [-1, 1]) {
    const ex = sx * (beamLen / 2 - 0.4);
    parts.push({ geo: beamBetween(new THREE.Vector3(ex, 0, -legSpread), new THREE.Vector3(ex, topY, 0), 0.12), key: 'timberDark' });
    parts.push({ geo: beamBetween(new THREE.Vector3(ex, 0, legSpread), new THREE.Vector3(ex, topY, 0), 0.12), key: 'timberDark' });
  }
  for (let i = 0; i < count; i++) {
    const px = -spanW / 2 + partW * (i + 0.5);
    for (const sx of [-0.28, 0.28]) parts.push({ geo: cableBetween(new THREE.Vector3(px + sx, topY, 0), new THREE.Vector3(px + sx, 0.75, 0), 0.018), key: 'metal' });
    parts.push({ geo: boxAt(px, 0.7, 0, 0.55, 0.06, 0.24), key: 'seat' });
    // a low framing hill the swing sits on
    if (i === 0) parts.push({ geo: new THREE.CylinderGeometry(2.2, 3.0, 0.24, 20).translate(0, 0.12, 0).toNonIndexed(), key: 'stone' });
  }
  const group = assemble(parts, adventureMaterials(), 'BiidaasigeSwingHill', 'timber');
  return {
    group, triangles: countTris(group), swingCount: count,
    position: null, placementStatus: 'unplaced',
    footprintM: [spanW + 1.4, legSpread * 2],
    source: 'City of Toronto — Recreation at Biidaasige Park: swings on Swing Hill',
    note: 'Zone-only position (Swing Hill). Not placed here; the caller places it when a verified position exists.',
  };
}

// The mock beaver dam: a log tangle the children hang onto. No mapped position.
function buildMockBeaverDam(opts = {}) {
  const parts = [];
  const logCount = 9;
  for (let i = 0; i < logCount; i++) {
    const a = (i / logCount) * Math.PI * 2;
    const x = Math.cos(a) * (1.1 + 0.2 * (i % 2)), z = Math.sin(a) * (1.1 + 0.2 * (i % 2));
    const y = 0.3 + 0.18 * i;
    const yaw = a + Math.PI / 2;
    const g = new THREE.CylinderGeometry(0.14, 0.16, 2.2, 8);
    g.rotateZ(Math.PI / 2);
    g.rotateY(yaw);
    g.translate(x, y, z);
    parts.push({ geo: g.toNonIndexed(), key: i % 3 === 0 ? 'timberDark' : 'wood' });
  }
  // a couple of upright snags
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    parts.push({ geo: beamBetween(new THREE.Vector3(Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6), new THREE.Vector3(Math.cos(a) * 0.7, 1.6, Math.sin(a) * 0.7), 0.12), key: 'timberDark' });
  }
  const group = assemble(parts, adventureMaterials(), 'BiidaasigeMockBeaverDam', 'wood');
  return {
    group, triangles: countTris(group), logCount,
    position: null, placementStatus: 'unplaced',
    footprintM: [2.6, 2.6],
    source: 'City of Toronto — Recreation at Biidaasige Park: a mock beaver dam play area (children hang onto the wooden supports)',
    note: 'Zone-only position (main play cluster). Not placed here; the caller places it when a verified position exists.',
  };
}

// -------------------------------------------------------------------------------------------------------------------
// The seven Dodem clan animals. The City LISTS seven (bear, beaver, eagle, turtle, otter, wolf, musky fish) but publishes
// no individual positions and (in this repository) only ONE primary photo (the eagle, captain/dodem-eagle.jpg: a low
// carved SOLID natural-wood eagle with a bold black-painted chest, a white head, a broad yellow hooked beak and brown
// wings). This build does NOT model seven finished animals. Only the eagle is modelled from its photo; the other SIX are
// EXPLICIT PLACEHOLDERS with UNKNOWN geometry (a plain carved block, no species silhouette) so nobody mistakes them for
// finished sculptures. Every one is UNPLACED (position null) and the six placeholders carry placeholder:true +
// verifiedAppearance:false. The parent worker owns the higher-fidelity follow-up once each animal has its own photo.
// -------------------------------------------------------------------------------------------------------------------
const DODEM_SPECS = {
  eagle: {
    appearance: 'low carved SOLID natural-wood eagle: bold black-painted chest, white head, broad yellow hooked beak, brown wings; a low carved form, not a mammal mascot',
    verified: true, modelled: true, evidence: 'City primary photo (captain/dodem-eagle.jpg)',
    heightM: 1.6,
  },
  bear: { appearance: 'UNKNOWN — no primary photo in this repo; placeholder block only', verified: false, modelled: false, heightM: 1.5 },
  beaver: { appearance: 'UNKNOWN — no primary photo in this repo; placeholder block only', verified: false, modelled: false, heightM: 1.0 },
  turtle: { appearance: 'UNKNOWN — no primary photo in this repo; placeholder block only', verified: false, modelled: false, heightM: 0.9 },
  otter: { appearance: 'UNKNOWN — no primary photo in this repo; placeholder block only', verified: false, modelled: false, heightM: 0.9 },
  wolf: { appearance: 'UNKNOWN — no primary photo in this repo; placeholder block only', verified: false, modelled: false, heightM: 1.4 },
  musky: { appearance: 'UNKNOWN — no primary photo in this repo; placeholder block only', verified: false, modelled: false, heightM: 1.1 },
};

function buildDodemSculpture(kind, opts = {}) {
  const k = String(kind || '').toLowerCase().replace(/[^a-z]/g, '');
  const key = k === 'muskiefish' || k === 'muskie' || k === 'muskellunge' ? 'musky' : k;
  const spec = DODEM_SPECS[key];
  if (!spec) return null;
  const group = dodemModel(key, spec);
  const placeholder = !spec.modelled;
  return {
    group, triangles: countTris(group), kind: key,
    verifiedAppearance: spec.verified,
    placeholder,                          // true for the six with UNKNOWN geometry (not finished animals)
    unverifiedAppearance: !spec.verified,
    appearance: spec.appearance,
    evidence: spec.evidence || 'UNVERIFIED: explicit placeholder (geometry unknown); needs its own primary photo',
    position: null, placementStatus: 'unplaced',
    footprintM: [spec.heightM * 0.9, spec.heightM * 0.9],
    source: 'City of Toronto — Recreation at Biidaasige Park: Dodem animal sculptures (bear, beaver, eagle, turtle, otter, wolf, musky fish)',
    note: placeholder
      ? 'EXPLICIT PLACEHOLDER: the animal\'s appearance/geometry is unknown here; this plain block is not the finished sculpture. Do not ship as final.'
      : 'Modelled from the official primary photo. Individual Dodem positions are not published; not placed here.',
  };
}

// The eagle is modelled from the official primary photo. The other six are EXPLICIT PLACEHOLDERS — a plain carved block
// on a base, deliberately with NO species silhouette, so it cannot be mistaken for a finished animal.
function dodemModel(kind, spec) {
  const parts = [];
  const H = spec.heightM;
  if (kind === 'eagle') {
    // solid low carved eagle: body mass (brown), black chest patch, white head, broad yellow hooked beak, wings
    parts.push({ geo: sphereAt(0, H * 0.42, 0, H * 0.34, H * 0.5, H * 0.3, 14), key: 'wood' }); // body (brown)
    parts.push({ geo: sphereAt(0, H * 0.30, H * 0.20, H * 0.22, H * 0.36, H * 0.14, 12), key: 'timberDark' }); // black chest
    parts.push({ geo: sphereAt(0, H * 0.82, H * 0.02, H * 0.20, H * 0.20, H * 0.20, 14), key: 'stone' }); // white head (pale)
    const beak = new THREE.ConeGeometry(H * 0.09, H * 0.22, 8);
    beak.rotateX(Math.PI / 2);
    beak.translate(0, H * 0.80, H * 0.20);
    parts.push({ geo: beak.toNonIndexed(), key: 'seat' });
    for (const sx of [-1, 1]) {
      const g = new THREE.SphereGeometry(H * 0.26, 10, 8);
      g.scale(0.3, 0.9, 1.4);
      g.rotateZ(sx * 0.5);
      g.translate(sx * H * 0.30, H * 0.46, 0);
      parts.push({ geo: g.toNonIndexed(), key: 'wood' });
    }
    parts.push({ geo: new THREE.CylinderGeometry(H * 0.34, H * 0.42, H * 0.12, 16).translate(0, H * 0.06, 0).toNonIndexed(), key: 'timber' });
  } else {
    // EXPLICIT PLACEHOLDER: a plain carved block on a base — no species silhouette (geometry unknown)
    parts.push({ geo: boxAt(0, H * 0.45, 0, H * 0.55, H * 0.8, H * 0.5), key: 'wood' });
    parts.push({ geo: new THREE.CylinderGeometry(H * 0.38, H * 0.43, H * 0.1, 16).translate(0, H * 0.05, 0).toNonIndexed(), key: 'timber' });
  }
  return assemble(parts, adventureMaterials(), `BiidaasigeDodem-${kind}`, 'wood');
}

// Every clan animal as an UNPLACED factory result. The caller places them once verified positions exist; this function
// never invents one. The eagle is photo-modelled; the other six are explicit placeholders (see above).
function buildDodemSet() {
  const out = {};
  for (const k of DODEM_ANIMALS) out[k] = buildDodemSculpture(k);
  return out;
}

// -------------------------------------------------------------------------------------------------------------------
// Small mesh assembly helpers shared by the factories
// -------------------------------------------------------------------------------------------------------------------
function assemble(parts, mats, name, fallbackKey) {
  const merged = mergeByKey(parts);
  const group = new THREE.Group();
  group.name = name;
  for (const [key, geo] of merged) {
    const mesh = new THREE.Mesh(geo, mats[key] || mats[fallbackKey] || new THREE.MeshStandardNodeMaterial({ color: 0x888888 }));
    mesh.name = `${name}-${key}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
function countTris(group) { let n = 0; group.traverse((o) => { if (o.isMesh) n += o.geometry.attributes.position.count / 3; }); return n; }
function sphereAt(x, y, z, rx, ry, rz, seg) {
  const g = new THREE.SphereGeometry(1, seg, Math.max(6, Math.floor(seg * 0.7)));
  g.scale(rx, ry, rz); g.translate(x, y, z);
  return g.toNonIndexed();
}
function beamBetween(a, b, r) {
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  const g = new THREE.CylinderGeometry(r, r, Math.max(1e-3, len), 8);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  g.translate(a.x, a.y, a.z);
  return g.toNonIndexed();
}
function cableBetween(a, b, r) { return beamBetween(a, b, r); }

// -------------------------------------------------------------------------------------------------------------------
// The cluster assembly. ONLY the Badlands Scramble is placed (it has the exact OSM footprint). The adventure factories
// and the seven Dodem animals are UNPLACED and are NOT built here: building them at startup and throwing them away wastes
// geometry, and they have no verified position. The caller builds any factory it actually needs, later, once an anchor
// is registered (C.buildCableway / C.buildSwingHill / C.buildMockBeaverDam / C.buildDodemSet).
// -------------------------------------------------------------------------------------------------------------------
function buildBiidaasigeAdventurePlay(opts = {}) {
  const badlands = buildBadlandsScramble(opts);
  const group = new THREE.Group();
  group.name = 'BiidaasigeAdventurePlay';
  if (badlands) group.add(badlands.group);
  return {
    group,
    badlands,
    triangles: badlands ? badlands.triangles : 0,
    climbable: false,
    surfaceHeightAt: (x, z, o) => (badlands ? badlands.surfaceHeightAt(x, z, o) : null),
    factories: {                  // deferred builders — nothing is constructed until the caller invokes them
      cableway: buildCableway,
      swingHill: buildSwingHill,
      mockBeaverDam: buildMockBeaverDam,
      dodem: buildDodemSet,
    },
    note: 'Only the Badlands Scramble is placed (exact OSM footprint). The cableways, swings, mock dam and seven Dodem animals are UNPLACED and NOT built here: their positions are not published. Build them from factories.* once a verified anchor exists.',
  };
}

// -------------------------------------------------------------------------------------------------------------------
// Exports
// -------------------------------------------------------------------------------------------------------------------
C.BIIDAASIGE_BADLANDS_SPEC = BADLANDS_SPEC;
C.BIIDAASIGE_CABLEWAY_M = CABLEWAY_M.slice();
C.BIIDAASIGE_DODEM_ANIMALS = DODEM_ANIMALS.slice();
C.BIIDAASIGE_DODEM_SPECS = DODEM_SPECS;
C.buildBadlandsScramble = buildBadlandsScramble;
C.buildCableway = buildCableway;
C.buildSwingHill = buildSwingHill;
C.buildMockBeaverDam = buildMockBeaverDam;
C.buildDodemSculpture = buildDodemSculpture;
C.buildDodemSet = buildDodemSet;
C.buildBiidaasigeAdventurePlay = buildBiidaasigeAdventurePlay;
// The runtime surface query. It NEVER builds geometry: it answers from the query the last build registered. If no build
// has registered one (or the frame lacks the site), it returns null — never a fallback that constructs a mesh inside a
// height query. `opts.baseY` is the player's current height and `opts.maxRise` the allowed step (see surfaceHeightAt).
C.biidaasigeAdventureSurfaceAt = (x, z, opts) => {
  const reg = C.__biidaasigeAdventureQuery;
  if (!reg || !reg.query) return null;
  return surfaceHeightAt(reg.query, x, z, opts);
};
})();
