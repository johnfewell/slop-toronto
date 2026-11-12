(function () {
// js/waterfront-island-yard-materials.js
// Source-backed YARD (private plot ground) materials for the photographed Algonquin Island cottage corridors along ONEIDA
// and OJIBWAY avenues (bead st-sb3r.29).
//
// THE PROBLEM: the committed city ground draws every curb island's private plot with ONE shared
// `createPlotGroundMaterial()` (js/tsl-materials.js, merged into the 'Yards' mesh by js/city-grid.js). That material
// paints arbitrary large-scale fbm "paved" swaths: in the photographed Oneida/Ojibway cottage yards the captain's GPU
// capture wave7-width-review-island-ojibway-paving.png shows broad white concrete patches with tree trunks emerging from
// them. The primary ground photographs show instead DENSELY PLANTED green cottage gardens/trees beside narrow public
// paths; the white swaths are procedural noise, not surveyed paths.
//
// WHAT THIS MODULE DOES — MATERIAL ONLY, COMPOSED, NO NEW DRAW CALLS: it exports `applyIslandYardMaterial(material)`, a
// composable hook the captain wires onto the EXISTING shared plot (yard) material after `createPlotGroundMaterial()` is
// created (js/city-grid.js, beside the other `applyWaterfront*GroundMask` ground hooks). It blends the native plot
// shader toward a subdued lawn/earth typology ONLY inside a bounded world-space fragment mask, using the native seasonal
// palette helpers. There is NO cover quad, NO geometry, NO new material for the batched 'Yards' mesh (the captain keeps
// one draw), NO routing/width/collider change and NO invented garden layout (no footprints, fences, flowers or
// driveways). Every mapped sidewalk, street, path and building is a different material/geometry and stays untouched.
//
// SOURCE ELIGIBILITY (strict, so nothing else changes): a block is eligible only when ALL hold —
//   1. it is a native curb island (js/city-config.js BLOCKS) whose plot is the 'plot' yard (not a median, not the park
//      lawn (park > 0.6), not open/wild land (wild > 0.5), not the downtown concrete catch);
//   2. it carries SOURCE-VALIDATED residential/cottage profiles: the committed OSM-matched `islandBuildingProfile` rows
//      (js/waterfront-island-buildings.js) give at least 3 matched buildings AND a substantial majority of them are
//      cottage/residential (>= 60 %), i.e. the same evidence test js/city-grid.js isPaved() uses (.24 classification);
//   3. it BORDERS one of the two photographed corridors: its outline comes within the bounded corridor envelope of the
//      actual Oneida (OSM way 13541126) or Ojibway (OSM way 13541122) centre lines.
// Everything else (mainland, airport, other islands, other Algonquin blocks, unverified rows) is off-mask and stays
// bit-for-bit native.
//
// BOUNDED, INTERSECTED EFFECT: the captain's scope review is explicit that a whole 38,000 m2 block is NOT a garden. The
// mask is therefore the INTERSECTION of the eligible native block geometry with a bounded envelope (12 m) of the
// photographed lane segments, plus a 1 m soft edge. Off-corridor yard keeps the original plot material. The effect is a
// bounded strip of representative lawn/earth beside the photographed lanes, sized from the same corridor the lanes module
// already binds, not a reinterpretation of a whole island in grass. The eligible block gate carries a small local SUPPORT
// MARGIN (~one texel, 1.5 m) so the raster's bilinear block-edge halo lands on the walk band/curb (a different material)
// instead of bleeding native concrete back onto the yard mesh beside the lane; beyond the margin the yard is native.
//
// HONEST LIMITS: lawn/earth typology and the 12 m envelope are source-informed APPROXIMATIONS, not a survey. No exact
// garden footprints are invented and no colour is claimed as sampled from the photographs. The 33 mapped residential
// canopy positions (js/waterfront-island-residential-canopy.js) give bounded garden context but are not a full plant
// survey. The mask is a small bounded raster of the corridor intersection (reported by islandYardMaterialLayout), NOT a
// whole-city raster and NOT thousands of per-fragment line tests. See docs/waterfront-island-yard-materials.md.

const C = window.CITY || (window.CITY = {});

const SOURCE_STATUS = 'captain-photo-reviewed-2026-11-10';

// The two photographed corridors. A run is ONE actual OSM way; `osmWay` is the committed way id, recorded so the data and
// this module cannot silently drift apart. The same two ways the lane materials module claims.
const SOURCE_RUNS = [
  { key: 'oneida', name: 'Oneida Avenue', osmWay: 13541126,
    title: 'File:Oneida Avenue on Algonquin Island, Toronto 2026.jpg',
    url: 'https://commons.wikimedia.org/wiki/File:Oneida_Avenue_on_Algonquin_Island,_Toronto_2026.jpg' },
  { key: 'ojibway', name: 'Ojibway Avenue', osmWay: 13541122,
    title: 'File:CN Tower visible from Ojibway Avenue, Algonquin Island, Toronto 2026.jpg',
    url: 'https://commons.wikimedia.org/wiki/File:CN_Tower_visible_from_Ojibway_Avenue,_Algonquin_Island,_Toronto_2026.jpg' }
];

// The bounded corridor envelope (metres from the mapped lane centre line) and its soft edge. Source-informed typology
// approximation, NOT a measured garden depth: it bounds the lawn/earth to the photographed frontage beside the lanes.
const ENVELOPE_M = 12.0;
const ENVELOPE_EDGE = 1.0;

// The bounded fragment mask raster (metres a texel), the small bilinear support pad (metres), and the local block-edge
// support margin (metres). The margin dilates ONLY the eligible block gate by ~one texel, so the raster's bilinear halo at
// the block edge falls on the walk band/curb (a different material) instead of on the yard mesh beside the lane. It is a
// documented support margin, NOT an invented footprint and NOT a broadening to other blocks (beyond it the yard is
// native). Bounded by the 12 m corridor envelope, so the lane centre and the roadway gap stay native.
const MASK = { res: 1.0, pad: 2.0, support: 1.5 };

// The source-validated residential/cottage majority gate, aligned with js/city-grid.js isPaved()'s residential branch.
const MIN_MATCHED = 3;
const RESIDENTIAL_SHARE = 0.6;

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

function finite(v) { return Number.isFinite(v); }

function pointInPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

// Distance from a point to a segment (metres).
function pointSegDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}

// The dilated block gate: a point is supported when it is inside the eligible block OR within `support` metres of its
// outline (the local support margin that removes the raster edge halo). Beyond the margin the yard is native.
function blockSupported(b, x, z, support) {
  if (x < b.minX - support || x > b.maxX + support || z < b.minZ - support || z > b.maxZ + support) return false;
  if (pointInPoly(b.poly, x, z)) return true;
  for (let i = 0; i < b.poly.length; i++) {
    const a = b.poly[i], c = b.poly[(i + 1) % b.poly.length];
    if (pointSegDist(x, z, a.x, a.z, c.x, c.z) <= support) return true;
  }
  return false;
}

// The exact segment-to-segment distance (metres). Used for the block-outline-to-corridor distance, so a long block edge
// passing near a lane vertex is measured correctly (a vertex-only test could miss it).
function segSegDist(ax, az, bx, bz, cx, cz, dx, dz) {
  const d1x = bx - ax, d1z = bz - az, d2x = dx - cx, d2z = dz - cz;
  const a = d1x * d1x + d1z * d1z, e = d2x * d2x + d2z * d2z;
  const rx = ax - cx, rz = az - cz;
  const f = d2x * rx + d2z * rz;
  let s = 0, t = 0;
  if (a <= 1e-12 && e <= 1e-12) return Math.hypot(rx, rz);
  if (a <= 1e-12) { t = clamp01(f / e); }
  else {
    const c = d1x * rx + d1z * rz;
    if (e <= 1e-12) { s = clamp01(-c / a); }
    else {
      const b = d1x * d2x + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > 1e-12 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); } else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  const px = ax + d1x * s - (cx + d2x * t), pz = az + d1z * s - (cz + d2z * t);
  return Math.hypot(px, pz);
}

// --------------------------------------------------------------------------------------------------------------------
// Data / projection guards (the same discipline as js/waterfront-island-road-materials.js and the canopy module).
// --------------------------------------------------------------------------------------------------------------------
function lanesData() { return C.ISLAND_LANES_DATA || null; }

function projectionMatches() {
  const D = lanesData();
  const expected = D && D.projection;
  const actual = C.GEO && C.GEO.frame && C.GEO.frame.projection;
  if (!expected || !actual) return false;
  for (const k of ['lat0', 'lon0', 'kx', 'ky', 'theta', 'ox', 'oz']) {
    const a = actual[k], e = expected[k];
    if (!finite(a) || !finite(e)) return false;
    if (Math.abs(a - e) > 1e-9 * Math.max(1, Math.abs(e))) return false;
  }
  return true;
}

// The two source runs resolved from ISLAND_LANES_DATA by OSM way. null when the data is absent or a way is missing (a
// no-op, so mainland-only pages and tests are unchanged).
function sourceCorridors() {
  const D = lanesData();
  if (!D || !Array.isArray(D.runs)) return null;
  const out = [];
  for (const spec of SOURCE_RUNS) {
    const run = D.runs.find((r) => r && Array.isArray(r.ways) && r.ways.includes(spec.osmWay)
      && Array.isArray(r.points) && r.points.length >= 2);
    if (!run) return null;
    out.push({ spec, run });
  }
  return out;
}

// --------------------------------------------------------------------------------------------------------------------
// Native blocks (js/city-config.js BLOCKS). The committed C.BLOCKS is used in the browser; absent it, the module derives
// the identical list from the decoded binary GEO (the same mapping city-config does), so the classifier is a pure
// function of the actual geodata. Reliable identity is the native block `id` (its index in GEO.blocks), exactly the
// identity js/city-grid.js's blockBuilt/isPaved key by.
// --------------------------------------------------------------------------------------------------------------------
let _blocks = null;
function blocksList() {
  const src = Array.isArray(C.BLOCKS) && C.BLOCKS.length ? C.BLOCKS : null;
  if (src) return src;
  if (_blocks && _blocks.geo === C.GEO) return _blocks.list;
  const G = C.GEO;
  if (!G || !Array.isArray(G.blocks)) return null;
  const list = G.blocks.map((row, id) => {
    const flat = row[0];
    const poly = [];
    for (let i = 0; i < flat.length; i += 2) poly.push({ x: flat[i], z: flat[i + 1] });
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of poly) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    let a = 0, cx = 0, cz = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const p = poly[i], q = poly[j];
      const c = q.x * p.z - p.x * q.z;
      a += c; cx += (q.x + p.x) * c; cz += (q.z + p.z) * c;
    }
    a *= 0.5;
    return {
      id, poly, rects: row[1], park: row[2], parkName: row[3], wild: row[6],
      rect: !!row[4], median: !!row[5], area: Math.abs(a),
      minX, maxX, minZ, maxZ,
      cx: a ? cx / (6 * a) : (minX + maxX) / 2,
      cz: a ? cz / (6 * a) : (minZ + maxZ) / 2
    };
  });
  _blocks = { geo: G, list };
  return list;
}

// A 64 m block bucket index (the same query as js/city-config.js blockAt's fallback path): the block containing a point.
let _blockIdx = null;
function blockIndex() {
  const list = blocksList();
  if (!list) return null;
  if (_blockIdx && _blockIdx.list === list) return _blockIdx;
  const cell = 64;
  const grid = new Map();
  for (const b of list) {
    for (let ix = Math.floor(b.minX / cell); ix <= Math.floor(b.maxX / cell); ix++) {
      for (let iz = Math.floor(b.minZ / cell); iz <= Math.floor(b.maxZ / cell); iz++) {
        const k = ix * 100003 + iz;
        let l = grid.get(k);
        if (!l) grid.set(k, (l = []));
        l.push(b);
      }
    }
  }
  _blockIdx = { list, grid, cell };
  return _blockIdx;
}

function blockOf(x, z) {
  const idx = blockIndex();
  if (!idx) return null;
  const list = idx.grid.get(Math.floor(x / idx.cell) * 100003 + Math.floor(z / idx.cell));
  if (!list) return null;
  for (const b of list) {
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
    if (b.rect || pointInPoly(b.poly, x, z)) return b;
  }
  return null;
}

// --------------------------------------------------------------------------------------------------------------------
// Per-block source evidence: the same loop js/city-grid.js blockBuilt runs, using the source-matched island profiles.
// Only a profile that passed the active-frame + footprint identity guard counts (js/waterfront-island-buildings.js). One
// pass per data object, cached.
// --------------------------------------------------------------------------------------------------------------------
let _stats = null;
function blockStats() {
  if (_stats && _stats.geo === C.GEO && _stats.data === C.ISLAND_BUILDINGS_DATA) return _stats;
  const out = new Map();
  const G = C.GEO;
  if (G && Array.isArray(G.buildings) && typeof C.islandBuildingProfile === 'function') {
    for (const bl of G.buildings) {
      if (!Array.isArray(bl) || bl.length < 4 || !Array.isArray(bl[3])) continue;
      const b = blockOf(bl[0], bl[1]);
      if (!b) continue;
      let area = 0;
      for (const [u0, u1, v0, v1] of bl[3]) area += (u1 - u0) * (v1 - v0);
      const s = out.get(b.id) || { n: 0, matchedN: 0, residentialN: 0, matchedArea: 0, matchedTop: 0, top: 0 };
      s.n++;
      const prof = C.islandBuildingProfile(bl);
      if (prof) {
        s.matchedN++;
        s.matchedArea += area;
        s.matchedTop = Math.max(s.matchedTop, prof.height);
        if (prof.typology === 'cottage' || /^residential/.test(prof.category || '')) s.residentialN++;
        s.top = Math.max(s.top, prof.height);
      } else if (finite(bl[4])) {
        s.top = Math.max(s.top, bl[4]);
      }
      out.set(b.id, s);
    }
  }
  _stats = { map: out, geo: C.GEO, data: C.ISLAND_BUILDINGS_DATA };
  return _stats;
}

// The 'plot' yard gate for a block, mirroring js/city-grid.js: not a median, not the park lawn, not open/wild land, not
// the downtown concrete block, and — the source evidence — at least 3 matched buildings with a residential/cottage
// majority and not the validated tall-building (paved) branch.
function yardIsPlot(b, s) {
  if (!b) return false;
  if (b.median) return false;
  if (b.park > 0.6) return false;
  if (b.wild > 0.5) return false;
  if (b.cx > -1150 && b.cx < 1500 && b.cz > -2750 && b.cz < 650) return false; // the downtown concrete catch
  if (!s || s.matchedN < MIN_MATCHED || s.residentialN < s.matchedN * RESIDENTIAL_SHARE) return false;
  if (s.matchedTop >= 20 || (s.matchedTop >= 14 && s.matchedArea / s.matchedN >= 1500)) return false; // paved branch
  return true;
}

// Distance from a block outline to one run's centre-line polyline (metres).
function blockRunDistance(poly, run) {
  let best = Infinity;
  const pts = run.points;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    for (let j = 0; j + 1 < pts.length; j++) {
      const d = segSegDist(a.x, a.z, b.x, b.z, pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1]);
      if (d < best) best = d;
    }
  }
  return best;
}

function nearestCorridor(corridors, poly) {
  let best = null;
  for (const { spec, run } of corridors) {
    const d = blockRunDistance(poly, run);
    if (!best || d < best.d) best = { key: spec.key, d };
  }
  return best;
}

// The eligible native cottage blocks: source-validated residential/cottage 'plot' yards that border a photographed
// corridor within the bounded envelope. Pure (no THREE, no scene, no mutation). null when the source data is absent.
function eligibleBlocks() {
  const corridors = sourceCorridors();
  const list = blocksList();
  if (!corridors || !list || !projectionMatches()) return null;
  const st = blockStats();
  const out = [];
  for (const b of list) {
    if (!yardIsPlot(b, st.map.get(b.id))) continue;
    const near = nearestCorridor(corridors, b.poly);
    if (!near || near.d > ENVELOPE_M) continue;
    const s = st.map.get(b.id);
    out.push({
      id: b.id, block: b, nearest: near.key, distanceM: near.d,
      matchedN: s.matchedN, residentialN: s.residentialN, matchedTop: s.matchedTop
    });
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

// --------------------------------------------------------------------------------------------------------------------
// The bounded fragment mask. It is the intersection of the eligible native block outlines with the corridor envelope,
// rasterized once at build time over the small intersection bounding box. R = coverage (0..1, soft 1 m corridor edge);
// the block edge is hidden under the native walk band, so it is a hard gate. Float32 RGBA + NearestFilter, sampled with
// an explicit manual bilinear in the shader (no optional float32-filterable feature needed).
// --------------------------------------------------------------------------------------------------------------------
function corridorBox(corridors, pad) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const { run } of corridors) {
    for (const p of run.points) {
      if (p[0] < x0) x0 = p[0];
      if (p[0] > x1) x1 = p[0];
      if (p[1] < z0) z0 = p[1];
      if (p[1] > z1) z1 = p[1];
    }
  }
  if (![x0, x1, z0, z1].every(finite)) return null;
  return { x0: x0 - pad, x1: x1 + pad, z0: z0 - pad, z1: z1 + pad };
}

function blockUnionBox(elig) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const e of elig) {
    if (e.block.minX < x0) x0 = e.block.minX;
    if (e.block.maxX > x1) x1 = e.block.maxX;
    if (e.block.minZ < z0) z0 = e.block.minZ;
    if (e.block.maxZ > z1) z1 = e.block.maxZ;
  }
  if (![x0, x1, z0, z1].every(finite)) return null;
  return { x0, x1, z0, z1 };
}

// The mask box: the intersection of the eligible block union box (expanded by the support margin, so the dilated edge is
// inside the raster) and the corridor envelope box, plus the bilinear pad.
function maskBoxInfo() {
  const corridors = sourceCorridors();
  const elig = eligibleBlocks();
  if (!corridors || !elig || !elig.length) return null;
  const cb = corridorBox(corridors, ENVELOPE_M);
  const bb = blockUnionBox(elig);
  if (!cb || !bb) return null;
  const s = MASK.support;
  const x0 = Math.max(cb.x0, bb.x0 - s) - MASK.pad, x1 = Math.min(cb.x1, bb.x1 + s) + MASK.pad;
  const z0 = Math.max(cb.z0, bb.z0 - s) - MASK.pad, z1 = Math.min(cb.z1, bb.z1 + s) + MASK.pad;
  if (!(x1 > x0 && z1 > z0)) return null;
  return { x0, x1, z0, z1, blocks: elig.map((e) => e.block), corridors };
}

// The coverage at (x, z): 1 where the point is inside an eligible native block (or within the local support margin of its
// edge) AND inside the corridor envelope, a soft 1 m edge at the envelope, 0 elsewhere. The support margin removes the
// raster's bilinear block-edge halo; beyond it the yard is native. This is the CPU twin of the shader mask (the sampler
// bilinearly interpolates the rasterized field; this exact function is what generated it).
function coverageAt(x, z, info) {
  if (!finite(x) || !finite(z)) return 0;
  const box = info || maskBoxInfo();
  if (!box) return 0;
  if (x < box.x0 || x > box.x1 || z < box.z0 || z > box.z1) return 0;
  let inBlock = false;
  for (const b of box.blocks) {
    if (blockSupported(b, x, z, MASK.support)) { inBlock = true; break; }
  }
  if (!inBlock) return 0;
  let d = Infinity;
  for (const { run } of box.corridors) {
    const pts = run.points;
    for (let i = 0; i + 1 < pts.length; i++) {
      const dd = segSegDist(x, z, x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      if (dd < d) d = dd;
    }
  }
  return clamp01(0.5 + (ENVELOPE_M - d) / ENVELOPE_EDGE);
}

let _maskCache = null;

function buildMask({ THREE = C.THREE, force = false } = {}) {
  const info = maskBoxInfo();
  if (!info) return null;
  if (_maskCache && !force && _maskCache.info.x0 === info.x0 && _maskCache.info.x1 === info.x1
      && _maskCache.info.z0 === info.z0 && _maskCache.info.z1 === info.z1
      && _maskCache.geo === C.GEO && _maskCache.data === C.ISLAND_BUILDINGS_DATA
      && (!!_maskCache.tex === !!THREE)) return _maskCache;
  const res = MASK.res;
  const w = Math.max(2, Math.ceil((info.x1 - info.x0) / res));
  const h = Math.max(2, Math.ceil((info.z1 - info.z0) / res));
  const px = (info.x1 - info.x0) / w, pz = (info.z1 - info.z0) / h;
  const data4 = new Float32Array(w * h * 4);
  let inside = 0;
  for (let j = 0; j < h; j++) {
    const z = info.z0 + (j + 0.5) * pz;
    for (let i = 0; i < w; i++) {
      const x = info.x0 + (i + 0.5) * px;
      const cov = coverageAt(x, z, info);
      if (cov > 0) { data4[(j * w + i) * 4] = cov; inside++; }
    }
  }
  let tex = null;
  if (THREE) {
    tex = new THREE.DataTexture(data4, w, h, THREE.RGBAFormat, THREE.FloatType);
    tex.flipY = false;
    tex.magFilter = THREE.NearestFilter; // Float32 filtering is optional; the shader does the bilinear manually
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
  }
  _maskCache = {
    info, res, w, h, px, pz, data4, tex, inside,
    bytes: w * h * 16, // RGBA Float32 (16 B) a texel
    geo: C.GEO, data: C.ISLAND_BUILDINGS_DATA,
    eligible: info.blocks.map((b) => b.id)
  };
  return _maskCache;
}

// The pure CPU sampler at (x, z): { coverage } or null outside the mask. It bilinearly interpolates the SAME Float32
// values the shader's manual bilinear interpolates, so it is a meaningful parity check, not a nearest-texel guess.
function sampleMask(x, z, opts = {}) {
  const m = buildMask(opts);
  if (!m) return null;
  const fx = (x - m.info.x0) / m.px - 0.5, fz = (z - m.info.z0) / m.pz - 0.5;
  if (!(fx >= -0.5 && fx <= m.w - 0.5 && fz >= -0.5 && fz <= m.h - 0.5)) return null;
  const i0 = Math.floor(fx), j0 = Math.floor(fz);
  const tx = fx - i0, tz = fz - j0;
  const readAt = (i, j) => (i < 0 || j < 0 || i >= m.w || j >= m.h) ? 0 : m.data4[(j * m.w + i) * 4];
  const v00 = readAt(i0, j0), v10 = readAt(i0 + 1, j0), v01 = readAt(i0, j0 + 1), v11 = readAt(i0 + 1, j0 + 1);
  const coverage = v00 * (1 - tx) * (1 - tz) + v10 * tx * (1 - tz) + v01 * (1 - tx) * tz + v11 * tx * tz;
  if (!(coverage > 0)) return null;
  return { coverage };
}

// A pure audit (no THREE, no scene, no mutation): which blocks are eligible and why, the bounded mask dims/bytes, and
// the classifier counts. Reports the ACTUAL texture size and the replaced area.
function islandYardMaterialLayout({ force = false } = {}) {
  const corridors = sourceCorridors();
  if (!corridors) return { supported: false, reason: 'no matching ISLAND_LANES_DATA source runs' };
  if (!projectionMatches()) return { supported: false, reason: 'projection does not match the source build' };
  const elig = eligibleBlocks();
  if (!elig || !elig.length) return { supported: false, reason: 'no eligible source-validated cottage blocks in the corridor envelope' };
  const m = buildMask({ force });
  if (!m) return { supported: false, reason: 'no corridor-intersection mask box' };
  return {
    supported: true,
    status: SOURCE_STATUS,
    corridors: corridors.map(({ spec, run }) => ({ key: spec.key, name: spec.name, osmWay: spec.osmWay, ways: run.ways, cls: run.cls })),
    envelopeM: ENVELOPE_M,
    supportM: MASK.support,
    eligible: elig.map((e) => ({ id: e.id, nearest: e.nearest, distanceM: e.distanceM, matchedN: e.matchedN, residentialN: e.residentialN, matchedTop: e.matchedTop })),
    box: { ...m.info, blocks: undefined, corridors: undefined },
    res: m.res, w: m.w, h: m.h, inside: m.inside,
    texture: { width: m.w, height: m.h, bytes: m.bytes, format: 'RGBA Float32, NearestFilter + manual bilinear' },
    counts: {
      eligibleBlocks: elig.length,
      matchedResidentialBlocks: blockStatsResidentialCount(),
      replacedAreaM2: Math.round(m.inside * m.res * m.res)
    }
  };
}

function blockStatsResidentialCount() {
  const st = blockStats();
  let n = 0;
  for (const s of st.map.values()) {
    if (s.matchedN >= MIN_MATCHED && s.residentialN >= s.matchedN * RESIDENTIAL_SHARE) n++;
  }
  return n;
}

// Whether the mask is relevant to the active frame: the mask box is entirely inside the frame's detail box, so a frame
// that excludes it is a no-op.
function activeFrameCovers() {
  const box = maskBoxInfo();
  const f = C.GEO && C.GEO.frame && (C.GEO.frame.detail || C.GEO.frame);
  if (!box || !f) return false;
  return finite(f.x0) && finite(f.x1) && finite(f.z0) && finite(f.z1)
    && box.x0 >= f.x0 && box.x1 <= f.x1 && box.z0 >= f.z0 && box.z1 <= f.z1;
}

// --------------------------------------------------------------------------------------------------------------------
// TSL layer. Runs only in the browser (C.TSL is the three/tsl namespace). The exported hook COMPOSES a subdued
// lawn/earth subgraph onto the existing plot material's colorNode / roughnessNode / normalNode. Off-mask (coverage 0)
// every channel is the native plot material; there is no whole-city change.
// --------------------------------------------------------------------------------------------------------------------
function maskUV(m) {
  const { vec2 } = C.TSL;
  return C.TSL.positionWorld.xz.sub(vec2(m.info.x0, m.info.z0)).div(vec2(m.w * m.px, m.h * m.pz));
}

// One manual-bilinear sample of the Float32 mask texture at the fragment (four nearest textureLoad fetches).
function manualBilinearTex(tex, m) {
  const T = C.TSL;
  const { Fn, float, vec2, vec4, ivec2, floor, fract, clamp, textureLoad, mix } = T;
  const W = float(m.w), H = float(m.h);
  const UV = maskUV(m);
  return Fn(() => {
    const g = UV.mul(vec2(W, H)).sub(vec2(0.5, 0.5));
    const i0 = floor(g.x), j0 = floor(g.y);
    const tx = fract(g.x), ty = fract(g.y);
    const fetch = (i, j) => textureLoad(tex, ivec2(clamp(i, float(0.0), W.sub(1.0)), clamp(j, float(0.0), H.sub(1.0))));
    const c00 = fetch(i0, j0), c10 = fetch(i0.add(1.0), j0), c01 = fetch(i0, j0.add(1.0)), c11 = fetch(i0.add(1.0), j0.add(1.0));
    const bilerp = (a, b, c, d) => mix(mix(a, b, tx), mix(c, d, tx), ty);
    return vec4(bilerp(c00.r, c10.r, c01.r, c11.r), bilerp(c00.g, c10.g, c01.g, c11.g),
      bilerp(c00.b, c10.b, c01.b, c11.b), bilerp(c00.a, c10.a, c01.a, c11.a));
  })();
}

function yardCoverage(m) { return manualBilinearTex(m.tex, m).r; }

// A local value-noise idiom (the global material module does not export its noise2D/fbm2 helpers).
function localValueNoise(p) {
  const T = C.TSL;
  const { vec2, mix, fract, floor, sin } = T;
  const value = (freq) => {
    const q = p.mul(freq), cell = floor(q), f = fract(q);
    const blend = f.mul(f).mul(vec2(3).sub(f.mul(2)));
    const hash = (v) => fract(sin(v.dot(vec2(127.1, 311.7))).mul(43758.5453));
    return mix(mix(hash(cell), hash(cell.add(vec2(1, 0))), blend.x),
      mix(hash(cell.add(vec2(0, 1))), hash(cell.add(vec2(1, 1))), blend.x), blend.y);
  };
  return value;
}

// The subdued lawn/earth colour, built on the NATIVE plot palette (js/tsl-materials.js createPlotGroundMaterial: lawn
// mix(0x4f7a2c, 0x6f8a38), beds mix(0x4a3524, 0x5c4430)) and the shared seasonal helpers, so it belongs to the same
// family as the adjacent native lawns. Mostly lawn, a little bare earth: no invented flowerbeds, fences or driveways.
function islandYardColor() {
  const T = C.TSL;
  const { Fn, float, mix, color, smoothstep } = T;
  return Fn(() => {
    const p = T.positionWorld.xz;
    const value = localValueNoise(p);
    const macro = value(float(0.028)), mid = value(float(0.25)), micro = value(float(1.9));
    const lawn = mix(color(0x4f7a2c), color(0x6f8a38), macro.mul(0.6).add(mid.mul(0.4)));
    const earth = mix(color(0x4a3524), color(0x5c4430), macro.mul(0.7).add(micro.mul(0.3)));
    const bare = smoothstep(float(0.66), float(0.84), mid).mul(0.4); // subdued: mostly lawn
    let g = mix(lawn, earth, bare).mul(micro.mul(0.08).add(0.96));
    if (typeof C.seasonalGrass === 'function') g = C.seasonalGrass(g);
    if (typeof C.snowOver === 'function') g = C.snowOver(g, p, float(1.0));
    return g;
  })();
}

// A local derivative-based bump normal (the global material module does not export bumpNormal; this is the same accepted
// formulation as js/waterfront-island-road-materials.js).
function localBumpNormal() {
  const T = C.TSL;
  return T.Fn(([height]) => {
    const h = T.float(height).toVar();
    const dx = T.positionView.dFdx(), dy = T.positionView.dFdy();
    const r1 = dy.cross(T.normalView), r2 = T.normalView.cross(dx);
    const det = dx.dot(r1);
    const grad = det.sign().mul(h.dFdx().mul(r1).add(h.dFdy().mul(r2)));
    return det.abs().mul(T.normalView).sub(grad).normalize();
  });
}

// A gentle turf relief, faded with the pixel footprint so it cannot alias at grazing angles or from the air.
function islandYardNormal() {
  const T = C.TSL;
  const { Fn, float, smoothstep, length, sin } = T;
  const bumpNormal = localBumpNormal();
  return Fn(() => {
    const p = T.positionWorld.xz;
    const pxSize = length(T.fwidth(p));
    const fade = smoothstep(0.5, 0.12, pxSize);
    const turf = sin(p.x.mul(7.1)).mul(sin(p.y.mul(6.3)).mul(sin(p.x.add(p.y).mul(3.7)))).mul(0.0045).mul(fade);
    return bumpNormal(turf);
  })();
}

// The exported hook: compose the lawn/earth subgraph onto the material's existing channels, blended by the bounded mask
// coverage. ALWAYS mix against the real native default of each channel (the material's own node when present, otherwise
// the engine's materialColor/materialRoughness/materialNormal), so off-mask the yard stays native and a material that
// never set a channel is never painted everywhere. Idempotent; a no-op off-frame, on a projection mismatch, without the
// source data, or on a non-node material.
function applyIslandYardMaterial(mat, { THREE = C.THREE } = {}) {
  if (!mat) return mat;
  if (mat.userData && mat.userData.islandYardMaterial) return mat; // idempotent
  const T = C.TSL;
  if (!T || !mat.isNodeMaterial) return mat;                        // never touch a non-node material
  if (!projectionMatches() || !activeFrameCovers()) return mat;     // off-frame / mismatched projection: no-op
  const m = buildMask({ THREE });
  if (!m || !m.tex) return mat;
  try {
    const cover = yardCoverage(m);
    const yardCol = islandYardColor();
    const yardNormal = islandYardNormal();
    const nativeColor = mat.colorNode || T.materialColor;
    const nativeRough = mat.roughnessNode || T.materialRoughness;
    const nativeNormal = mat.normalNode || T.materialNormal;
    mat.colorNode = T.mix(nativeColor, yardCol, cover);
    mat.roughnessNode = T.mix(nativeRough, T.float(0.95), cover);
    mat.normalNode = T.mix(nativeNormal, yardNormal, cover);
    if (!mat.userData) mat.userData = {};
    mat.userData.islandYardMaterial = {
      source: SOURCE_STATUS,
      envelopeM: ENVELOPE_M,
      supportM: MASK.support,
      blocks: m.eligible
    };
    mat.userData.islandYardMaterialInfo = islandYardMaterialLayout();
  } catch (err) {
    console.warn('[waterfrontIslandYardMaterials] material graph not applied:', err && err.message);
  }
  return mat;
}

Object.assign(C, {
  ISLAND_YARD_MATERIALS_STATUS: SOURCE_STATUS,
  ISLAND_YARD_MATERIALS_SOURCES: SOURCE_RUNS,
  ISLAND_YARD_ENVELOPE_M: ENVELOPE_M,
  ISLAND_YARD_SUPPORT_M: MASK.support,
  ISLAND_YARD_MASK: MASK,
  islandYardSourceCorridors: sourceCorridors,
  islandYardEligibleBlocks: eligibleBlocks,
  islandYardCoverageAt: coverageAt,
  islandYardMaskBuild: buildMask,
  islandYardMaskSample: sampleMask,
  islandYardMaterialLayout,
  applyIslandYardMaterial
});
})();
