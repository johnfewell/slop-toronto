(function () {
// js/buildings.js
// Abuja's buildings from their real footprints (OpenStreetMap, much of it from the Microsoft Building Footprints
// import; see tools/geo-features.mjs): every footprint stands where it is, turned the way it is, as one or more boxes
// (L, T & U plans), as tall as mapped or estimated. Most of the city is one and two-storey houses & low blocks of
// rendered, painted concrete behind compound walls, with hipped roofs of stone-coated steel or aluminium sheets; the
// Central Business District and the Three Arms Zone rise higher, some in curtain-wall glass.
// A quadtree streams the close-up detail around the camera: fire escapes, the odd air conditioner on a side wall and
// satellite dish.

const { THREE } = window.CITY;
const { mergeGeometries } = window.CITY.Addons;
const { Fn, float, color, uv, attribute, fract, floor, smoothstep, mix, abs, select, positionWorld, normalWorldGeometry, fwidth } = window.CITY.TSL;
const { GEO, CITY_BOUNDS, nearestRoads } = window.CITY;
const { createRenderedFacadeMaterial, createCurtainWallMaterial, createFacadeBoxes, WALL_KINDS } = window.CITY;

// ---- ?massing=1 (docs/massing-buildings.md, st-2nl): every building stands on its City 3D Massing polygon
// (data/toronto-massing.bin, which main.js loads through js/massing-data.js only then, onto window.CITY.MASSING) instead
// of its L/T/U boxes. The sidecar is used only if it was built for exactly these rows; a record it rejects keeps its
// boxes.
function massingFootprints() {
  const M = window.CITY.MASSING;
  if (!M || !(M.rows instanceof Map)) return null;
  if (M.error) console.warn(`[buildings] massing: ${M.error}; the buildings stay on their boxes`);
  return M.error ? null : M;
}

// Each outer edge's treatment, from the sidecar's classification inputs (tools/build-massing.mjs): an edge another
// part's wall stands on (`hidden`) has no wall (-1); a wall a neighbour's mass covers for at least half its height
// above its own foot (`covered`: the neighbour's roof; a tower's podium below its `base` covers none of it, and a
// tower beside a low block keeps its windows) is a windowless party wall (lotLine), so are slivers under 2 m; edges
// looking onto a street within 15 m of its kerb (`street`, true
// on a main street) are street fronts: the best (longest, a main street's counting double) takes the building's front
// kind (its storefront or entrance), and on a shop every other street edge of 3 m or more is a shop front too (corner
// stores wrap round). The rest are rear.
// Returns { kinds, edges: [{ ax, az, bx, bz, nx, nz, len, kind, street }] }
function footprintEdges(outer, covered, hidden, street, frontKind, shopFront, base, h) {
  const n = outer.length;
  const edges = [];
  let best = -1, bestScore = 0;
  for (let i = 0; i < n; i++) {
    const [ax, az] = outer[i], [bx, bz] = outer[(i + 1) % n];
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1e-9;
    const e = { ax, az, bx, bz, nx: dz / len, nz: -dx / len, len, kind: WALL_KINDS.rear, street: false };
    edges.push(e);
    if (hidden.has(i)) { e.kind = -1; continue; }
    const cover = covered.has(i) ? covered.get(i) - base : 0;
    if ((cover > 0.5 && cover >= (h - base) / 2) || len < 2) { e.kind = WALL_KINDS.lotLine; continue; }
    if (!street.has(i)) continue;
    e.street = true;
    const score = len * (street.get(i) ? 2 : 1);
    if (score > bestScore) { bestScore = score; best = i; }
  }
  for (const e of edges) if (shopFront && e.street && e.len >= 3) e.kind = WALL_KINDS.shop;
  if (best >= 0) edges[best].kind = frontKind;
  return { kinds: edges.map((e) => e.kind), edges };
}

// ---- ?massing=1 cell meshes (js/massing-cells.js; docs/massing-buildings.md, st-2nl.3) ----------------------------
// Builds them in a module worker (js/massing-worker.js), so the main thread goes on with the rest of the city meanwhile;
// without workers (or ?massingWorker=0, or if it fails) on the main thread instead. Resolves to { out, where, waitMs }.
function buildMassingCellsOffThread(input) {
  const MC = window.CITY.MassingCells;
  const t0 = performance.now();
  const onMain = (why) => {
    if (why) console.warn(`[buildings] massing worker: ${why}; building the cells on the main thread`);
    return { out: MC.buildMassingCells(input), where: 'main', waitMs: performance.now() - t0 };
  };
  const off = typeof location !== 'undefined' && new URLSearchParams(location.search).get('massingWorker') === '0';
  if (typeof Worker === 'undefined' || off) return Promise.resolve().then(() => onMain(null));
  return new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker('./js/massing-worker.js', { type: 'module' });
    } catch (e) {
      resolve(onMain(e.message));
      return;
    }
    worker.onmessage = ({ data }) => {
      worker.terminate();
      resolve(data.error ? onMain(data.error) : { out: data.out, where: 'worker', waitMs: performance.now() - t0 });
    };
    worker.onerror = (event) => {
      event.preventDefault();
      worker.terminate();
      resolve(onMain(event.message || 'failed to start'));
    };
    // (copied, not transferred: the main thread keeps the input for the fallback)
    worker.postMessage({ input });
  });
}

// The near & mid tiers' limits come from the quality tier (quality.js massingLimits, x the quality net's distance
// scale), with a hysteresis band either side. ?massingTier=near|mid|far holds every cell in one tier (A/B captures)
const MASSING_LIMITS = [600, 1600];
const MASSING_BAND = 40;

/**
 * The built cells -> meshes in `group`: per block, style and tier one mesh (and a second one sharing its buffers, for
 * when the tier's cells are not one run of its index buffer). Every near mesh starts drawn whole, so the shadow
 * stand-ins (scene-culling.js, userData.shadowStandIn) and the warm-up take all of it; mid and far ones never cast
 * (the near geometry's stand-ins cast for them). Returns { update(camera) }: each frame from the warm-up on, every 500 m
 * cell picks its tier (nextTier: with hysteresis) and the meshes draw the index ranges of their cells in it.
 */
function addMassingCells(group, built, materials, stats) {
  const t0 = performance.now();
  const MC = window.CITY.MassingCells;
  const { out } = built;
  window.CITY.setFootprintTable(out.table, out.tableWidth, out.yUnit);
  const XS = MC.SNORM * MC.XZ_UNIT, YS = MC.SNORM * out.yUnit;
  const cells = out.cells.map((c) => ({ ...c, tier: -1 }));
  const cellAt = new Map(cells.map((c, i) => [`${c.sx},${c.sz}`, i]));
  const firstOf = new Map();
  const entries = [];
  let meshes = 0;
  for (const b of out.blocks) {
    // the block's tier cells in index order (TIER_ORDER), -1 where it has none
    const subs = [0, 1, 2, 3].map((s) => {
      const k = MC.TIER_ORDER.indexOf(s);
      return cellAt.get(`${b.bx * 2 + (k & 1)},${b.bz * 2 + (k >> 1)}`) ?? -1;
    });
    b.tiers.forEach((T, t) => {
      if (!T.index.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(T.position, 4, true));
      geo.setAttribute('normal', new THREE.BufferAttribute(T.normal, 4, true));
      geo.setIndex(new THREE.BufferAttribute(T.index, 1));
      // (bounds in the mesh's own units: its matrix scales x & z by XS, y by YS, and a sphere's radius by XS)
      const [cx, cy, cz, r] = T.sphere;
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3((cx - b.ox) / XS, cy / YS, (cz - b.oz) / XS), r / XS);
      const twin = new THREE.BufferGeometry();
      twin.setAttribute('position', geo.attributes.position);
      twin.setAttribute('normal', geo.attributes.normal);
      twin.setIndex(geo.index);
      twin.boundingSphere = geo.boundingSphere;
      const pair = [geo, twin].map((g, k) => {
        const m = new THREE.Mesh(g, materials[b.style]);
        m.name = `MassingBuildings_${b.style}`;
        m.position.set(b.ox, 0, b.oz);
        m.scale.set(XS, YS, XS);
        m.updateMatrix();
        m.receiveShadow = true;
        // (the near meshes cast through scene-culling.js's position-only stand-ins, as upstream c4ab18f)
        m.castShadow = t === 0 && k === 0;
        if (m.castShadow) m.userData.shadowStandIn = true;
        m.userData.massingTier = t;
        m.visible = t === 0 && k === 0;
        const key = materials[b.style];
        if (firstOf.has(key)) m.userData.sharesPipelineWith = firstOf.get(key); else firstOf.set(key, m);
        group.add(m);
        meshes++;
        return m;
      });
      entries.push({ subs, t, ranges: T.ranges, pair, drawn: null });
    });
  }
  const tierStats = out.stats.tiers;
  const bytes = tierStats.reduce((s, t) => s + t.bytes, 0) + out.table.byteLength;
  Object.assign(stats, {
    builtIn: built.where, buildMs: out.stats.ms, waitMs: Math.round(built.waitMs * 10) / 10, meshes,
    triangles: tierStats[0].triangles, vertices: tierStats[0].vertices, walls: tierStats[0].walls,
    tiers: tierStats.map((t) => ({ ...t, MiB: Math.round(t.bytes / 1048576 * 10) / 10 })),
    geometryMiB: Math.round(bytes / 1048576 * 10) / 10, bytesPerVertex: MC.BYTES_PER_VERTEX,
    boxTriangles: stats.boxesReplaced * 12, simplified: out.stats.simplified, midKept: out.stats.midKept, coveredDropped: out.stats.coveredDropped
  });
  stats.meshMs = Math.round((performance.now() - t0) * 10) / 10;
  window.CITY.massingStats = stats;
  console.info(`[buildings] massing: ${stats.buildings} buildings from their polygons (${stats.rejected} of ${stats.records} records rejected), ` +
    `${stats.courtyards} courtyards, ${stats.partyWalls} party walls, ${stats.onPodium} on a podium; ` +
    stats.tiers.map((t) => `${t.name} ${t.triangles} triangles, ${t.vertices} vertices (${t.MiB} MiB)`).join('; ') +
    ` at ${MC.BYTES_PER_VERTEX} B a vertex, ${stats.geometryMiB} MiB with the table, in ${meshes} meshes (the ${stats.boxesReplaced} boxes they replace: ` +
    `${stats.boxTriangles} triangles, instanced); built in the ${built.where === 'worker' ? 'worker' : 'main thread'} in ${stats.buildMs} ms ` +
    `(${stats.waitMs} ms after it was asked), ${stats.packMs} ms packing and ${stats.meshMs} ms making the meshes on the main thread`);

  const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const hold = MC.TIERS.indexOf(params.get('massingTier'));
  const Q = window.CITY.QUALITY || {};
  const counts = [0, 0, 0];
  stats.cellTiers = counts;
  function update(camera) {
    const p = camera.position || camera;
    const limits = (Q.massingLimits || MASSING_LIMITS).map((d) => d * (Q.dist ?? 1));
    let changed = false;
    for (const c of cells) {
      const t = hold >= 0 ? hold : MC.nextTier(c.tier, MC.cellDistance(c, p.x, p.y, p.z), limits, MASSING_BAND);
      if (t !== c.tier) { c.tier = t; changed = true; }
    }
    if (!changed) return false;
    counts.fill(0);
    for (const c of cells) counts[c.tier]++;
    for (const e of entries) {
      const runs = MC.tierRuns(e.ranges, e.subs.map((i) => (i >= 0 ? cells[i].tier : -1)), e.t);
      e.pair.forEach((m, k) => {
        m.visible = k < runs.length;
        if (m.visible) m.geometry.setDrawRange(runs[k][0], runs[k][1]);
      });
    }
    return true;
  }
  return { update, cells };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Spatial 2D Quadtree partitioning the detailed city
 * for fast O(log N) range queries around the active player/camera position.
 */
class CityQuadtree {
  constructor(bounds, capacity = 6, maxDepth = 6, depth = 0) {
    this.bounds = bounds; // { minX, maxX, minZ, maxZ }
    this.capacity = capacity;
    this.maxDepth = maxDepth;
    this.depth = depth;
    this.items = [];
    this.divided = false;
    this.nw = null;
    this.ne = null;
    this.sw = null;
    this.se = null;
  }

  containsPoint(x, z) {
    const b = this.bounds;
    return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
  }

  intersectsCircle(cx, cz, radius) {
    const b = this.bounds;
    const closestX = Math.max(b.minX, Math.min(cx, b.maxX));
    const closestZ = Math.max(b.minZ, Math.min(cz, b.maxZ));
    const dx = cx - closestX;
    const dz = cz - closestZ;
    return (dx * dx + dz * dz) <= (radius * radius);
  }

  subdivide() {
    const b = this.bounds;
    const midX = (b.minX + b.maxX) * 0.5;
    const midZ = (b.minZ + b.maxZ) * 0.5;
    const nextDepth = this.depth + 1;

    this.nw = new CityQuadtree({ minX: b.minX, maxX: midX, minZ: b.minZ, maxZ: midZ }, this.capacity, this.maxDepth, nextDepth);
    this.ne = new CityQuadtree({ minX: midX, maxX: b.maxX, minZ: b.minZ, maxZ: midZ }, this.capacity, this.maxDepth, nextDepth);
    this.sw = new CityQuadtree({ minX: b.minX, maxX: midX, minZ: midZ, maxZ: b.maxZ }, this.capacity, this.maxDepth, nextDepth);
    this.se = new CityQuadtree({ minX: midX, maxX: b.maxX, minZ: midZ, maxZ: b.maxZ }, this.capacity, this.maxDepth, nextDepth);
    this.divided = true;

    for (const item of this.items) {
      this._insertIntoChildren(item);
    }
    this.items.length = 0;
  }

  _insertIntoChildren(item) {
    if (this.nw.containsPoint(item.cx, item.cz)) return this.nw.insert(item);
    if (this.ne.containsPoint(item.cx, item.cz)) return this.ne.insert(item);
    if (this.sw.containsPoint(item.cx, item.cz)) return this.sw.insert(item);
    if (this.se.containsPoint(item.cx, item.cz)) return this.se.insert(item);
    return false;
  }

  insert(item) {
    if (!this.containsPoint(item.cx, item.cz)) return false;

    if (!this.divided) {
      if (this.items.length < this.capacity || this.depth >= this.maxDepth) {
        this.items.push(item);
        return true;
      }
      this.subdivide();
    }
    return this._insertIntoChildren(item);
  }

  queryRange(cx, cz, radius, found = []) {
    if (!this.intersectsCircle(cx, cz, radius)) return found;

    const rSq = radius * radius;
    if (!this.divided) {
      for (let i = 0; i < this.items.length; i++) {
        const item = this.items[i];
        const dx = item.cx - cx;
        const dz = item.cz - cz;
        if (dx * dx + dz * dz <= rSq) {
          found.push(item);
        }
      }
      return found;
    }

    this.nw.queryRange(cx, cz, radius, found);
    this.ne.queryRange(cx, cz, radius, found);
    this.sw.queryRange(cx, cz, radius, found);
    this.se.queryRange(cx, cz, radius, found);
    return found;
  }
}

// Paint (sRGB hex, weight): walls, hipped roofs, curtain-wall glass
// --- Toronto layer: the walls' colours measured from ~430 freely licensed photos of Toronto on Wikimedia Commons
// (tools/commons-palette.py -> tools/data/commons_palette.json, every photo credited in tools/data/commons_photos.md;
// after aalghooneh/slop-toronto, MIT), weighted by how often each turned up: red-brown, dark brown, orange-red
// Victorian & buff ("white") brick. Brick buildings are flagged to the facade shader by paint.w >= 2 (tsl-materials.js)
const TORONTO_MASONRY = [[0x7c6154, 37], [0x5a463f, 26], [0x9c7a62, 21], [0xae987e, 14], [0xc07e55, 2]];
// rendered, painted & precast walls (the palette's pale concrete #9ca0a2, stucco & painted siding)
const TORONTO_RENDER = [[0xcfccc4, 4], [0xe6e1d6, 3], [0x9ca0a2, 3], [0xb9b4aa, 2], [0xae987e, 1]];
// stone for the churches (Credit Valley sandstone & grey limestone)
const TORONTO_STONE = [[0xae987e, 3], [0x9c9a92, 2], [0x7d6f60, 1]];
// share of each kind of building in brick: 0 houses, 1 low-rise, 2 mid-rise (its non-glass ones), 6 worship, 7 civic
const BRICK_SHARE = { 0: 0.85, 1: 0.65, 2: 0.4, 6: 0.55, 7: 0.7 };
// hipped roofs: asphalt shingles, charcoal, grey & brown (not Abuja's coloured steel)
const ROOF_PAINT = [[0x3b3b3d, 5], [0x2c2d30, 4], [0x4e4035, 3], [0x6a6762, 2], [0x5a2f27, 1]];
// --- end Toronto layer ---
const SHEET_PAINT = [[0x9aa0a3, 3], [0x8a5a3c, 2], [0x6e7275, 2], [0x2f4f78, 1]]; // corrugated sheets: galvanised, rusted, painted
const RAW_BLOCK = [[0xa29c90, 3], [0x8f897d, 2], [0xb3a993, 1]]; // unpainted sandcrete blockwork (huts, sheds)
const weighted = (table, r) => {
  let total = 0;
  for (const [, w] of table) total += w;
  let t = r * total;
  for (const [v, w] of table) { t -= w; if (t < 0) return v; }
  return table[table.length - 1][0];
};
const linear = (hex) => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

/**
 * Hipped roof over a rectangle (local u0..u1 x v0..v1 turned by yaw `ang` about (cx, cz)) with `eave` overhang,
 * pitched at `pitch`; pushes flat-shaded triangles (+ the eave soffit) into the accumulator with per-vertex colour.
 * uv = (metres along the eave, metres up the slope).
 */
// Close the thin roof edge between the upper surface and the underside. Without this fascia,
// a four-centimetre daylight slit remains visible behind the overhang even with correct soffit winding.
function pushRoofEdgeFascia(A, corners, rgb) {
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4];
    const ad = [a[0], a[1] - 0.04, a[2]], bd = [b[0], b[1] - 0.04, b[2]];
    const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz);
    for (const p of [a, b, bd, a, bd, ad]) {
      A.pos.push(...p); A.nor.push(dz / L, 0, -dx / L); A.uv.push(0, 0);
      A.col.push(rgb[0] * 0.8, rgb[1] * 0.8, rgb[2] * 0.8);
    }
  }
}

function pushHipRoof(A, cx, cz, ang, u0, u1, v0, v1, y, pitch, eave, rgb, closeSoffit = false) {
  u0 -= eave; u1 += eave; v0 -= eave; v1 += eave;
  const W = u1 - u0, D = v1 - v0;
  const alongU = W >= D;
  const half = (alongU ? D : W) / 2;
  const rise = half * Math.tan(pitch);
  const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const P = (u, v, h) => [cx + u * cs + v * sn, y + h, cz - u * sn + v * cs];
  const r0 = alongU ? P(u0 + half, vc, rise) : P(uc, v0 + half, rise);
  const r1 = alongU ? P(u1 - half, vc, rise) : P(uc, v1 - half, rise);
  const c00 = P(u0, v0, 0), c10 = P(u1, v0, 0), c11 = P(u1, v1, 0), c01 = P(u0, v1, 0);
  const tri = (a, b, c) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; [b, c] = [c, b]; }
    // uv: along the eave (the triangle's horizontal extent) & up the slope (height / sin(pitch))
    for (const p of [a, b, c]) {
      A.pos.push(p[0], p[1], p[2]);
      A.nor.push(nx, ny, nz);
      A.uv.push(p[0] * -nz + p[2] * nx, (p[1] - y) / Math.max(0.2, Math.sin(pitch)));
      A.col.push(rgb[0], rgb[1], rgb[2]);
    }
  };
  if (alongU) {
    tri(c00, c10, r1); tri(c00, r1, r0); // -v slope
    tri(c11, c01, r0); tri(c11, r0, r1); // +v slope
    tri(c01, c00, r0); // -u hip
    tri(c10, c11, r1); // +u hip
  } else {
    tri(c10, c11, r1); tri(c10, r1, r0);
    tri(c01, c00, r0); tri(c01, r0, r1);
    tri(c00, c10, r0);
    tri(c11, c01, r1);
  }
  // soffit under the eaves
  const s = [c00, c01, c11, c10].map((p) => [p[0], p[1] - 0.04, p[2]]);
  for (const i of (closeSoffit ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3])) {
    A.pos.push(s[i][0], s[i][1], s[i][2]);
    A.nor.push(0, -1, 0);
    A.uv.push(0, 0);
    A.col.push(rgb[0] * 0.6, rgb[1] * 0.6, rgb[2] * 0.6);
  }
  if (closeSoffit) pushRoofEdgeFascia(A, [c00, c10, c11, c01], rgb);
}
// Mono-pitch sheet roof (huts, sheds, shop extensions): a thin sloped plane falling along local v
function pushShedRoof(A, cx, cz, ang, u0, u1, v0, v1, y, rgb) {
  u0 -= 0.35; u1 += 0.35; v0 -= 0.45; v1 += 0.45;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const P = (u, v, h) => [cx + u * cs + v * sn, y + h, cz - u * sn + v * cs];
  const fall = Math.min(0.6, (v1 - v0) * 0.08);
  const q = [P(u0, v0, fall), P(u1, v0, fall), P(u1, v1, 0), P(u0, v1, 0)];
  const L = Math.hypot(v1 - v0, fall);
  const ny = (v1 - v0) / L, nh = fall / L; // normal tilts toward +v
  const n = [sn * nh, ny, cs * nh];
  for (const [i, uu, vv] of [[0, 0, 0], [3, 0, 1], [2, 1, 1], [0, 0, 0], [2, 1, 1], [1, 1, 0]]) {
    A.pos.push(q[i][0], q[i][1], q[i][2]);
    A.nor.push(n[0], n[1], n[2]);
    A.uv.push(uu * (u1 - u0), vv * L * 3.0); // corrugations across the fall
    A.col.push(rgb[0], rgb[1], rgb[2]);
  }
  for (const [i] of [[0], [1], [2], [0], [2], [3]]) {
    A.pos.push(q[i][0], q[i][1] - 0.03, q[i][2]);
    A.nor.push(0, -1, 0);
    A.uv.push(0, 0);
    A.col.push(rgb[0] * 0.5, rgb[1] * 0.5, rgb[2] * 0.5);
  }
}

// Shared cottage facade metrics. These are the SAME numbers the cottage facade material uses
// (createIslandCottageMaterial → createRenderedFacadeMaterial → facadeCell), so the custom door geometry and the
// shader's reserved, window-free doorway bay can never drift apart if the spacing changes again.
const ISLAND_COTTAGE_BAY_PITCH = 2.5;    // m: the facade's bay pitch = createIslandCottageMaterial windowWidth
const ISLAND_COTTAGE_CORNER_PIER = 0.35; // m: the facade's corner pier = createIslandCottageMaterial cornerPier
const ISLAND_COTTAGE_DOOR_CASING = 1.35; // m: the painted door casing span (fits the reserved bay)
// The cottage box tone is held just above 0: facadeCell's chosen = min(floor(tone·bays), bays−1) has NO lower clamp, so a
// decoded tone that Float32-rounds below 0 (raw tone ≲3e-5 at a high box index) gives chosen = −1 and the mask reserves
// no bay. Keeping the cottage tone ≥ 0.02 keeps chosen ≥ 0, so the door always has a real reserved bay to sit in.
const ISLAND_COTTAGE_TONE_MIN = 0.02;

// The exact bay facadeCell reserves for the entrance, so the custom door lands where the shader has already removed the
// window instead of over one. facadeCell (js/tsl-materials.js): pier = min(cornerPier, wallWidth·0.2);
// bays = max(round((wallWidth − 2·pier) / pitch), 1); bayWidth = (wallWidth − 2·pier) / bays;
// chosen = min(floor(tone · bays), bays − 1). `center` is the metre offset of that bay's middle along the wall in the
// facade's OWN, UNFLIPPED sense: the suppression mask computes bayIdx from s = along·wallWidth (facadeCell line 619–621,
// the cornerPier branch) — NOT from the flipped wallS the drawn procedural entrance uses. The cottage suppresses that
// drawn entrance (proceduralEntrances: 0), so the mask is the only thing the door must match. `shaderTone` must be the
// effective tone the shader decodes (islandCottageShaderTone), not the raw tone.
function islandCottageDoorBay(wallWidth, shaderTone) {
  const W = Math.fround(wallWidth); // the box attribute is Float32 (createFacadeBoxes)
  const pier = Math.min(ISLAND_COTTAGE_CORNER_PIER, W * 0.2);
  const inner = Math.max(W - 2 * pier, 0);
  const bays = Math.max(Math.floor(inner / ISLAND_COTTAGE_BAY_PITCH + 0.5), 1);
  const bayWidth = inner / bays;
  const chosen = Math.min(Math.floor(shaderTone * bays), bays - 1);
  return { bays, bayWidth, chosen, center: pier + (chosen + 0.5) * bayWidth };
}

// createFacadeBoxes packs each box's tone into a Float32 box.w = (i·29 mod 1000) + 0.1 + 0.8·tone (line 1684), and
// facadeCell decodes it as (fract(box.w) − 0.1) / 0.8. Because the packed value's integer part reaches 999, the Float32
// rounding of its fraction is not exact: the shader's EFFECTIVE tone drifts from the raw tone by up to a few 1e-5 and,
// right on a bay boundary, picks the ADJACENT bay. This reproduces the shader's Float32 encode/decode for a box's
// instance index, so the custom door matches the bay the shader actually reserves (index = the largest part's position
// in the cottageBoxes array).
function islandCottageShaderTone(tone, index) {
  const packed = Math.fround(((index * 29) % 1000) + 0.1 + 0.8 * tone);
  const frac = Math.fround(packed - Math.floor(packed));
  return Math.fround(Math.fround(frac - 0.1) / 0.8);
}

// The cottage walls stop at a documented one/one-and-a-half-storey eave (about 3–4.4 m for an estimated 6.5 m total);
// the roof takes the rest of the profile's TOTAL height. Explicit OSM height/levels are totals too, so the same rule
// keeps their apex at the source height rather than stacking a second roof-height on top.
function islandCottageEaveHeight(totalH, w, d, estimated) {
  const half = Math.max(1.2, Math.min(w, d) / 2);
  const eaveTarget = totalH - half * Math.tan(30 * Math.PI / 180);
  const eaveMax = estimated ? Math.min(4.4, totalH - 1.2) : totalH - 1.1;
  return Math.max(2.4, Math.min(eaveTarget, eaveMax, totalH - 0.6));
}

// Cottage facade relief: white corner boards/eave fascia and a shallow painted door with casing.
// No porch or parcel extension is inferred from the mapped solid footprint.
function islandCottageTrim(out, cx, cz, ang, u0, u1, v0, v1, h, front, y0, shaderTone) {
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const pt = (u, v, y) => [cx + u * cs + v * sn, y, cz - u * sn + v * cs];
  const box = (u, v, y, w, d, hh, tint) => { const [x, , z] = pt(u, v, y); out.push({ x, y, z, w, d, h: hh, ry: ang, color: tint }); };
  const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2, wU = u1 - u0, wV = v1 - v0;
  // Corner boards (white painted, as in the Ward's Island photographs)
  for (const [u, v] of [[u0 + 0.02, v0 + 0.02], [u1 - 0.02, v0 + 0.02], [u1 - 0.02, v1 - 0.02], [u0 + 0.02, v1 - 0.02]]) {
    box(u, v, y0 + h / 2, 0.14, 0.14, h);
  }
  // Broad white eave fascia along every wall
  const fy = y0 + h - 0.09;
  box(u0 + 0.05, vc, fy, 0.10, wV + 0.06, 0.18);
  box(u1 - 0.05, vc, fy, 0.10, wV + 0.06, 0.18);
  box(uc, v0 + 0.05, fy, wU + 0.06, 0.10, 0.18);
  box(uc, v1 - 0.05, fy, wU + 0.06, 0.10, 0.18);
  // Shallow front entry: casing, painted leaf and upper glazing, in the EXACT bay the shader reserves for the entrance.
  // The ±u walls vary along v, the ±v walls along u (facadeCell's alongZ). The reserved bay comes from the UNFLIPPED
  // s = along·wallWidth of facadeCell's suppression mask, so the door centre is simply the wall's min corner plus that
  // centre — no flip. (facadeCell's flipped wallS only positions the DRAWN procedural entrance/storefront, which the
  // cottage suppresses with proceduralEntrances: 0.)
  const uWall = front < 2;                      // front 0/1 are ±u walls (their width is v0..v1), 2/3 are ±v (u0..u1)
  const W = uWall ? wV : wU;                    // the wall width the facade material actually lays its bays across
  const { bayWidth, center } = islandCottageDoorBay(W, shaderTone);
  const varAt = (uWall ? v0 : u0) + center;     // the door's centre on the wall's varying axis
  const outU = front === 0 ? -1 : front === 1 ? 1 : 0;
  const outV = front === 2 ? -1 : front === 3 ? 1 : 0;
  const dU = uWall ? (front === 0 ? u0 : u1) : varAt; // door's fixed u (on ±u walls) or its place along u (on ±v walls)
  const dV = uWall ? varAt : (front === 2 ? v0 : v1);
  // Fit the reserved bay: a narrow wall clamps the casing so the entry never spills past the shader's opening.
  const casing = Math.min(ISLAND_COTTAGE_DOOR_CASING, bayWidth);
  const leaf = casing * (1.05 / 1.35), glass = casing * (0.65 / 1.35);
  const doorH = Math.min(2.1, Math.max(1.7, h - 0.35));
  const put = (delta, w, d, y, hh, tint) => box(dU + outU * delta, dV + outV * delta, y, w, d, hh, tint);
  put(0.03, uWall ? 0.06 : casing, uWall ? casing : 0.06, y0 + doorH / 2, doorH); // door casing
  // The door leaf and its upper glazing sit just in front of the casing plane. The foundation stays mapped;
  // centimetres of facade relief keep the entry visible instead of burying it in the solid building box.
  put(0.072, uWall ? 0.02 : leaf, uWall ? leaf : 0.02, y0 + (doorH - 0.12) / 2, doorH - 0.12, 0x355a58);
  put(0.087, uWall ? 0.012 : glass, uWall ? glass : 0.012, y0 + doorH * 0.70, 0.65, 0x26393e);
  // No invented porch extension: the mapped solid carries only a shallow door and casing.

}

// Gable roof over a rectangle (island cottages): a ridge along the longer axis, two slopes, and the two gable end
// triangles drawn in the wall colour (`endRgb`) so the ends read as siding, not shingle. `eave` overhangs all round.
function pushGableRoof(A, cx, cz, ang, u0, u1, v0, v1, y, pitch, eave, rgb, endRgb) {
  u0 -= eave; u1 += eave; v0 -= eave; v1 += eave;
  const W = u1 - u0, D = v1 - v0;
  const alongU = W >= D; // ridge runs along u when the block is wider than deep
  const half = (alongU ? D : W) / 2;
  const rise = half * Math.tan(pitch);
  const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const P = (u, v, h) => [cx + u * cs + v * sn, y + h, cz - u * sn + v * cs];
  const r0 = alongU ? P(u0, vc, rise) : P(uc, v0, rise);
  const r1 = alongU ? P(u1, vc, rise) : P(uc, v1, rise);
  const c00 = P(u0, v0, 0), c10 = P(u1, v0, 0), c11 = P(u1, v1, 0), c01 = P(u0, v1, 0);
  // Raw triangle: the winding (and so the normal) is explicit. Gable ends are vertical, so they must not be "flipped
  // upward" like a slope: that is what left the first pass with missing/inward end triangles and an open roof.
  const triRaw = (a, b, c, col) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const p of [a, b, c]) {
      A.pos.push(p[0], p[1], p[2]);
      A.nor.push(nx, ny, nz);
      A.uv.push(p[0] * -nz + p[2] * nx, (p[1] - y) / Math.max(0.2, Math.sin(pitch)));
      A.col.push(col[0], col[1], col[2]);
    }
  };
  // Roof slopes: keep the normal upward (swapping b/c if the numeric winding came out downward).
  const tri = (a, b, c, col) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const ny = uz * vx - ux * vz;
    if (ny < 0) [b, c] = [c, b];
    triRaw(a, b, c, col);
  };
  const end = endRgb || [rgb[0] * 0.92, rgb[1] * 0.92, rgb[2] * 0.92];
  if (alongU) {
    tri(c00, c10, r1, rgb); tri(c00, r1, r0, rgb); // -v slope
    tri(c11, c01, r0, rgb); tri(c11, r0, r1, rgb); // +v slope
    triRaw(c00, c01, r0, end);                     // -u gable end (outward)
    triRaw(c11, c10, r1, end);                     // +u gable end (outward)
  } else {
    tri(c10, c11, r1, rgb); tri(c10, r1, r0, rgb);
    tri(c01, c00, r0, rgb); tri(c01, r0, r1, rgb);
    triRaw(c10, c00, r0, end);                     // -v gable end (outward)
    triRaw(c01, c11, r1, end);                     // +v gable end (outward)
  }
  // soffit under the eaves (darker, as pushHipRoof does)
  const s = [c00, c01, c11, c10].map((p) => [p[0], p[1] - 0.04, p[2]]);
  for (const i of [0, 2, 1, 0, 3, 2]) {
    A.pos.push(s[i][0], s[i][1], s[i][2]);
    A.nor.push(0, -1, 0);
    A.uv.push(0, 0);
    A.col.push(rgb[0] * 0.6, rgb[1] * 0.6, rgb[2] * 0.6);
  }
  pushRoofEdgeFascia(A, [c00, c10, c11, c01], rgb);
}

// Monitor roof (the Distillery's long warehouses): a hipped roof with a raised monitor along its ridge, low glazed walls
// (a clerestory: dark panes between painted mullions every ~1.6 m) under their own small hipped cap. Into the hipped
// roofs' batch: no draw of its own. Returns the triangles pushed.
function pushMonitorRoof(A, cx, cz, ang, u0, u1, v0, v1, y, pitch, eave, rgb, glassRgb, frameRgb) {
  pushHipRoof(A, cx, cz, ang, u0, u1, v0, v1, y, pitch, eave, rgb);
  let tris = 8;
  const W = u1 - u0 + 2 * eave, D = v1 - v0 + 2 * eave;
  const alongU = W >= D;
  const half = (alongU ? D : W) / 2;
  const ridgeLen = (alongU ? W : D) - 2 * half; // (the hips take a half span off each end)
  const mw = Math.min(2.4, half * 0.22); // the monitor's half width
  const len = ridgeLen - 3;
  if (len < 6) return tris;
  const rise = half * Math.tan(pitch);
  const foot = y + rise - mw * Math.tan(pitch); // where the slope meets the monitor's walls
  const top = y + rise + 1.3;
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
  // (s along the ridge, t across it) -> world
  const P = (s, t, yy) => {
    const u = alongU ? uc + s : uc + t, v = alongU ? vc + t : vc + s;
    return [cx + u * cs + v * sn, yy, cz - u * sn + v * cs];
  };
  // (wound to face along n, the way out of the monitor)
  const quad = (a, b, c, d, n, col) => {
    const cr = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const cz2 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const out = cr * n[0] + cz2 * n[2] >= 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
    for (const p of out) {
      A.pos.push(p[0], p[1], p[2]);
      A.nor.push(n[0], n[1], n[2]);
      A.uv.push(0, 0.3); // (a flat shade in the roof material's tile rows)
      A.col.push(col[0], col[1], col[2]);
    }
    tris += 2;
  };
  // the long walls, as panes and mullions
  const panes = Math.max(2, Math.round(len / 1.6));
  const step = len / panes, mull = Math.min(0.28, step * 0.2);
  for (const side of [-1, 1]) {
    const t = side * mw;
    const n = P(0, side, 0), o = P(0, 0, 0);
    const nrm = [n[0] - o[0], 0, n[2] - o[2]];
    for (let k = 0; k < panes; k++) {
      const s0 = -len / 2 + k * step, s1 = s0 + step - mull, s2 = s0 + step;
      const seg = (a, b, col) => quad(P(a, t, foot), P(a, t, top), P(b, t, top), P(b, t, foot), nrm, col);
      seg(s0, s1, glassRgb);
      seg(s1, s2, frameRgb);
    }
  }
  // the end walls, in the frame colour
  for (const end of [-1, 1]) {
    const s = end * len / 2;
    const n = P(end, 0, 0), o = P(0, 0, 0);
    const nrm = [n[0] - o[0], 0, n[2] - o[2]];
    quad(P(s, -mw, foot), P(s, -mw, top), P(s, mw, top), P(s, mw, foot), nrm, frameRgb);
  }
  // its cap: a low hipped roof over the monitor, in the main roof's slate
  const [m0, m1, n0, n1] = alongU ? [uc - len / 2, uc + len / 2, vc - mw, vc + mw] : [uc - mw, uc + mw, vc - len / 2, vc + len / 2];
  pushHipRoof(A, cx, cz, ang, m0, m1, n0, n1, top, 0.38, 0.3, rgb);
  return tris + 8;
}

// Roofing: stone-coated steel tiles (rows of shingle-shaped pressed tiles every ~0.37 m up the slope) or ribbed
// long-span sheets, in the vertex colour
// (Toronto: lying snow on the slopes in winter, tsl-materials.js snowOver: a 20-35 degree pitch holds it, the hips' steep
// ends and the gable-less eaves less)
function createRoofMaterial(ribbed) {
  const { snowOver } = window.CITY;
  const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: ribbed ? 0.5 : 0.62, metalness: ribbed ? 0.45 : 0.15 });
  mat.colorNode = Fn(() => {
    const c = attribute('color', 'vec3');
    const t = uv();
    const holds = smoothstep(0.55, 0.85, normalWorldGeometry.y).mul(0.85);
    if (ribbed) {
      const rib = smoothstep(0.0, 0.25, abs(fract(t.x.mul(1.3)).sub(0.5)));
      return snowOver(c.mul(mix(float(0.82), float(1.0), rib)), positionWorld.xz, holds);
    }
    const row = fract(t.y.div(0.37));
    const shade = smoothstep(0.0, 0.85, row).mul(0.28).add(0.74);
    return snowOver(c.mul(shade), positionWorld.xz, holds);
  })();
  return mat;
}

// --- Toronto layer: which ground floors are storefronts (bead st-sz0, after mrdoob's 09d27e0 "Limit storefronts to
// selected buildings", adapted: NYC's survey has no use data and picks retail at random; Toronto selects from data).
// A storefront front goes on a building that holds a mapped shop, restaurant, bank, market or clinic (GEO.pois), or that
// fronts a retail strip: two or more of those on the same street within 30 m of its front wall (a main street's row,
// where not every shop is mapped), for low & mid-rise buildings whose front is on the street. Every other street front
// is a residential/office front: windows down to the ground and one entrance (tsl-materials.js createBuildingEntrance).
// Source-keyed signs (js/toronto-storefronts.js) always make their wall a storefront.
const RETAIL_CATEGORIES = new Set(['shop', 'food', 'bank', 'market', 'health']);
function storefrontSelection(pois = GEO.pois || []) {
  const own = new Set();
  const grid = new Map(); // 50 m cells of retail places, with the street each is on
  for (const [x, z, , cat, b] of pois) {
    if (!RETAIL_CATEGORIES.has(cat)) continue;
    if (b >= 0) own.add(b);
    const road = nearestRoads(x, z, 40)[0];
    const k = Math.floor(x / 50) * 100003 + Math.floor(z / 50);
    (grid.get(k) || grid.set(k, []).get(k)).push({ x, z, road: road ? road.road.name : null });
  }
  // retail places on `street` within `r` m of (x, z)
  const count = (x, z, street, r) => {
    let n = 0;
    for (let i = Math.floor((x - r) / 50); i <= Math.floor((x + r) / 50); i++) {
      for (let j = Math.floor((z - r) / 50); j <= Math.floor((z + r) / 50); j++) {
        for (const p of grid.get(i * 100003 + j) || []) if (p.road === street && (p.x - x) ** 2 + (p.z - z) ** 2 <= r * r) n++;
      }
    }
    return n;
  };
  return { own, onStrip: (x, z, street) => count(x, z, street, 30) >= 2 };
}
// The source-keyed signs by building row: the walls (createFacadeBoxes order: -u, +u, -v, +v) that carry one. A record
// whose row no longer holds the building it was compiled for (after another frame's rows are matched up by centre:
// js/storefront-signs.js rebindStorefrontRows) is ignored (js/storefront-signs.js skips it too)
function signedWalls(data = window.CITY.STOREFRONTS) {
  if (window.CITY.rebindStorefrontRows) window.CITY.rebindStorefrontRows(data, GEO.buildings, GEO.pois); // (storefront-signs.js)
  const walls = new Map();
  for (const s of data?.signs || []) {
    const b = GEO.buildings[s.b];
    if (!b || Math.abs(b[0] - s.bc[0]) > 0.05 || Math.abs(b[1] - s.bc[1]) > 0.05) continue;
    (walls.get(s.b) || walls.set(s.b, new Set()).get(s.b)).add(s.wall);
  }
  return walls;
}
const FLOOR_HEIGHTS = [3.4, 3.6, 3.8, 3.8, 3.8, 4.6]; // the facade materials' storeys (buildCityBlocks `materials`)

// The Distillery District: the Gooderham & Worts distillery's Victorian industrial buildings (1859 to the 1920s, the
// largest such collection in North America) on their lanes off Mill St. The City's massing gives them as plain blocks
// like any other, so inside the district's outline (LANDMARK_SITES.distillery) the low ones (the heritage buildings: the
// new condo towers over 30 m keep their glass) take the district's own look: red Victorian brick (a warmer, redder
// range than the city's measured masonry), a facade of tall narrow windows in a close, regular rhythm under tall
// industrial storeys, deep piers at the corners, and pitched slate roofs where the block is low enough to have had one.
// One more facade material (one draw call); the roofs go into the hipped roofs' batch.
// Phase 2 (st-01vq.9): segmental-arched window heads over stone sills & sash bars (the material's `victorian` option);
// the Stone Distillery in Kingston limestone with square windows and the round iron tie plates between them; monitor
// roofs on the long low warehouses; the two brick chimneys OpenStreetMap maps (man_made=chimney: 35 m at the Boiler
// House, 20 m by the Stone Distillery) as boxes in this material's batch; the brick a quieter, weathered red-brown
// (phase 1's read too saturated). Buildings are picked by their centres (a few metres' tolerance), not by row numbers.
const VICTORIAN = 5; // its facade style (buildCityBlocks `facadeStyles`)
// ?massing=1: the facade styles each footprint material draws (by facade kind: the rendered ones, the Distillery's
// Victorian, then the curtain walls), and each style's [material, variant] there. The Victorian style has its own: its
// `victorian` option picks the shader's arched windows and limestone at build time, so it can't share a material with
// the plain rendered styles (the only blocks that draw it are the Distillery's)
const FOOTPRINT_MATERIALS = [[0, 1], [VICTORIAN], [2, 3, 4]];
const FOOTPRINT_STYLE = [];
FOOTPRINT_MATERIALS.forEach((ids, m) => ids.forEach((id, v) => { FOOTPRINT_STYLE[id] = [m, v]; }));
const DISTILLERY = {
  maxH: 30,
  pitchedUpTo: 19, // a pitched roof on blocks up to this height (the warehouses & the mill), flat parapets above
  maxRise: 5.5, // (the wide blocks' roofs pitched lower: the Stone Distillery is 30 m deep)
  brick: [[0x7c5044, 4], [0x6e473c, 3], [0x87594a, 2], [0x5e4038, 2]],
  slate: [[0x4b4e52, 3], [0x55504b, 2], [0x404346, 1]], // (a slate grey: phase 1's read black in low sun)
  // the Stone Distillery (1859; warm grey limestone from Kingston, ON): the five-storey block and its one-storey
  // fermenting wing to the west ("The Fermenting Cellar", building:material=stone in OSM)
  stone: [[1741.5, -5.7], [1697.3, -18.2]],
  limestone: [[0x878175, 3], [0x7d776d, 2], [0x918b80, 1]],
  // the Boiler House's massing height is its chimney's (40.8 m: drawn as a glass tower); OSM gives it two storeys
  height: [[1821.2, -82.0, 11.0]],
  // a 13-storey block at Parliament & Mill that OSM gives as red brick (building:material=brick): the rendered office
  // facade in the district's brick, not curtain wall
  brickTowers: [[1634.9, -38.7]],
  // OSM man_made=chimney (material=brick, colour=red), [x, z, height]
  chimneys: [[1823.0, -81.7, 35], [1751.2, -15.3, 20]],
  chimneyBrick: 0x6a4438,
  // monitor roofs: the long, low warehouses (a part at least this long and this much longer than deep, up to maxH)
  monitor: { maxH: 12.5, minLen: 30, minAspect: 1.6, glass: 0x22282a, frame: 0x34402f }
};
const nearAny = (list, x, z, tol = 3) => list.find(([px, pz]) => Math.abs(px - x) < tol && Math.abs(pz - z) < tol);
const distilleryRing = (() => {
  const s = window.CITY.LANDMARK_SITES && window.CITY.LANDMARK_SITES.distillery;
  return s && s.ring && s.ring.length >= 6 ? s.ring : null;
})();
function inDistillery(x, z) {
  const r = distilleryRing;
  if (!r) return false;
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], zi = r[i + 1], xj = r[j], zj = r[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
// --- end Toronto layer ---

// ---------------------------------------------------------------------------------------------------------------------
// Toronto Islands cottages (st-sb3r.18): the confirmed Ward's/Algonquin cottages are wood-frame, clad in horizontal
// clapboard, with a front entry/porch and a gable or hipped roof. The native renderer drew every island row through
// the city's brick house path, so the community read as orange/brown brick boxes. This scoped extension (only for
// `islandBuildingProfile(...).typology === 'cottage'`) gives those rows a small punched-window clapboard facade, white
// casing/fascia, a shallow front door and a gable (or hipped) roof. It never runs for service buildings, the airport,
// the lighthouse or any row without a confirmed source match; those keep the native material paths unchanged.
//
// Approximation note: the clapboard shader, the siding palette, the white trim and the entry are documented
// island cottage TYPOLOGY (public Ward's Island cottage photographs), not per-house measurements. Where OSM tags a
// roof:shape the source subtype is used; no per-house colour is claimed as measured.
const ISLAND_COTTAGE_PAINT = [0xd9d4c4, 0xb9bdb8, 0x8f9a92, 0xa7b6bd, 0xd8c793, 0xc9c2b2, 0x9aa7a0, 0xcdd2cc];
const ISLAND_COTTAGE_TRIM = 0xece7dc; // white painted casing and fascia (the photographs' broad white trim)
const ISLAND_COTTAGE_CLAPBOARD = 0.22; // m: one course of horizontal clapboard

// The cottage facade: the rendered facade's windows/door/lighting, but with small punched cottage windows, a low
// storey, corner boards and a horizontal clapboard shading term over the whole wall (the siding course shadow).
function createIslandCottageMaterial() {
  const mat = createRenderedFacadeMaterial({
    // Sparse punched cottage windows, photo-informed (Oneida Ave/Algonquin cottages: tall single openings with
    // substantial clapboard wall between, not a near-continuous window bank). facadeCell treats windowWidth as the
    // BAY PITCH (bays = round(wallWidth / windowWidth)), and the opening is windowRatioX × bayWidth, so a wider ~2.5 m
    // bay with the reciprocal ratio keeps the ~1.12 m opening the first pass had. ratioY × floorHeight keeps the tall
    // ~1.5 m opening. This is documented generic cottage typology, not per-house counts/layout.
    windowWidth: ISLAND_COTTAGE_BAY_PITCH, floorHeight: 2.9, windowRatioX: 0.45, windowRatioY: 0.52,
    litProbability: 0.32, warmth: 0.72, seed: 151.0, cornerPier: ISLAND_COTTAGE_CORNER_PIER,
    groundFloorBars: 0, windowFrameTint: ISLAND_COTTAGE_TRIM, windowCasing: 0.10,
    proceduralEntrances: 0, slabBands: 0
  });
  const wall = mat.colorNode; // createRenderedFacadeMaterial already returns an evaluated color node.
  // Clapboard courses: a soft shadow at the bottom of each 0.22 m board. Fade it with the actual screen-space derivative
  // of the course coordinate (not a fixed strength), so distant cottages do not shimmer or turn into stripe noise.
  const course = fract(positionWorld.y.div(ISLAND_COTTAGE_CLAPBOARD));
  const seam = smoothstep(0.0, 0.04, course).mul(float(1.0).sub(smoothstep(0.04, 0.16, course)));
  const coursePx = fwidth(positionWorld.y.div(ISLAND_COTTAGE_CLAPBOARD));
  const fade = float(1.0).sub(smoothstep(0.35, 0.9, coursePx));
  mat.colorNode = wall.mul(float(1.0).sub(seam.mul(0.16).mul(fade)));
  return mat;
}

// --- Reviewed QCYC marina structures (st-sb3r.34) -------------------------------------------------------------------
// Three reviewed island rows (`islandBuildingProfile(...).appearance`) at the Queen City Yacht Club marina. The primary
// sources (the captain's 2024 City orthophoto review and the official 2019 renovation gallery) show:
//   * 32501: a small low shed with WHITE paneled plywood/timber walls, DARK NAVY doors/shutters/trim, low eaves, a
//     shallow overhang and a dark pitched roof.
//   * 32502 / 32503: pale low storage under leafless canopy; function and roof uncertain, so a neutral flat-envelope
//     storage treatment (no invented brick or home windows).
// These are representative typology colours and forms, not per-row measurements; door counts/positions are
// approximations. The total height stays the profile's (4 m) envelope, so the eaves and roof never stack above the
// collider. Cost: one facade draw for the shed walls, one for the storage walls, one instanced trim draw and the roof
// tiles batch into the existing hipped-roofs mesh — no per-door mesh, same group for culling and shadows.
const MARINA_SHED_STYLE = 'qcyc-shed';
const MARINA_STORAGE_STYLE = 'qcyc-storage';
const MARINA_CLUBHOUSE_STYLE = 'qcyc-clubhouse';
const MARINA_SHED_BLUE = 0x1b2a44; // dark navy doors/shutters/trim
const MARINA_SHED_WALL = 0xf2f0ea; // white paneled plywood/timber
const MARINA_SHED_ROOF = 0x3a3d42; // dark pitched roof
const MARINA_SHED_EAVES = 2.45;    // m: eave height for a ~2 m door plus a short header (low eaves)
const MARINA_SHED_OVERHANG = 0.32; // m: shallow roof overhang past the walls
// The gallery shows solid navy storage doors/shutters, not home windows. A zero ratio makes facadeCell's opening
// zero-width (halfWin = 0.5), so both marina walls are plain panel; doors are the shallow trim relief below.
const MARINA_PANEL_WINDOW_RATIO_X = 0;
const MARINA_PANEL_WINDOW_RATIO_Y = 0;
const MARINA_TRIM_RELIEF = 0.012; // m: thin panel outer face just outside the wall (visual relief only)

// The shed's wall height: low eaves, always below the profile total so the pitched roof occupies the rest of the
// envelope (never stacked above the collider).
function marinaShedEaveHeight(total) {
  return Math.min(total - 0.45, MARINA_SHED_EAVES);
}

// The shed facade: paint-free rendered facade with panel seams on the wall (vertical plywood joints) and painted
// openings. Windows are sparse and blue-framed; the trim colour is the paint so the door/glazing read navy.
function createMarinaShedMaterial() {
  const mat = createRenderedFacadeMaterial({
    // Solid painted panel: no windows (the primary photo shows navy storage doors, not home glazing). The panel seams
    // and the navy doors carry the detail.
    windowWidth: 2.2, floorHeight: 2.6, windowRatioX: MARINA_PANEL_WINDOW_RATIO_X, windowRatioY: MARINA_PANEL_WINDOW_RATIO_Y,
    litProbability: 0, warmth: 0, seed: 211.0, cornerPier: 0.25,
    groundFloorBars: 0, windowFrameTint: MARINA_SHED_BLUE, windowCasing: 0,
    proceduralEntrances: 0, slabBands: 0
  });
  const wall = mat.colorNode;
  // Panel seams: a soft vertical shadow along the panel pitch (4 ft plywood ~1.22 m), measured ALONG the wall face
  // (the horizontal tangent of the wall normal), so a rotated building keeps the true pitch instead of a diagonal
  // world-x+z drift. Faded by the screen-space derivative so distant sheds do not shimmer; no seams on the roof/soffit.
  const panel = 1.22;
  const n = normalWorldGeometry;
  const along = positionWorld.x.mul(n.z.negate()).add(positionWorld.z.mul(n.x));
  const panelCoord = along.div(panel);
  const seamU = fract(panelCoord);
  const seam = smoothstep(0.0, 0.03, seamU).mul(float(1.0).sub(smoothstep(0.03, 0.10, seamU)));
  const seamPx = fwidth(panelCoord);
  const fade = float(1.0).sub(smoothstep(0.3, 0.8, seamPx)).mul(float(1.0).sub(abs(n.y)));
  mat.colorNode = wall.mul(float(1.0).sub(seam.mul(0.12).mul(fade)));
  return mat;
}

// The storage facade: a plain neutral wall (no windows, no brick) for the two uncertain pads.
function createMarinaStorageMaterial() {
  // Plain neutral panel with NO windows (the uncertain pads are not given invented home glazing).
  return createRenderedFacadeMaterial({
    windowWidth: 3.0, floorHeight: 3.0, windowRatioX: MARINA_PANEL_WINDOW_RATIO_X, windowRatioY: MARINA_PANEL_WINDOW_RATIO_Y,
    litProbability: 0, warmth: 0, seed: 233.0, cornerPier: 0.15,
    groundFloorBars: 0, windowFrameTint: 0xdad5c8, windowCasing: 0,
    proceduralEntrances: 0, slabBands: 0
  });
}

// --- Reviewed QCYC clubhouse (st-sb3r.39) ---------------------------------------------------------------------------
// Row 32139 / OSM Way 43805118, `Queen City Yacht Club clubhouse`. The official club homepage hero shows a white
// two-storey envelope with a dark grey pitched/hip roof, a waterfront balcony/terrace and repeated bays. The image's
// acquisition date is unknown, so this is a representative appearance, not a survey: the balcony/roof/bay layout is
// photo-informed and the water side is resolved from the mapped marina geometry (never the photo's orientation).
// Footprint, collider and the 6.5 m OSM-levels height are unchanged; the roof rises from the low eave to that total so
// eaves + roof never stack above the collider, and the balcony is a shallow decorative ledge (not a walkable surface).
const MARINA_CLUBHOUSE_WALL = 0xf4f2ec;    // white cladding
const MARINA_CLUBHOUSE_TRIM = 0xe8e5dc;    // off-white trim (the balcony railing/ledges read light, not black)
const MARINA_CLUBHOUSE_ROOF = 0x4a4d52;    // dark grey roof
// The building is TWO storeys in a 6.5 m total (OSM building:levels=2): two window bands below a low eave, and a shallow
// pitched roof occupying only the remainder. A 2026-11-10 captain review corrected the first draft (a 3.25 m eave left
// one storey + a huge roof). These are representative, approximation-labelled proportions, not measured.
const MARINA_CLUBHOUSE_FLOOR = 2.55;        // m: storey height -> two bands (2 x 2.55 = 5.10 m to the eave)
const MARINA_CLUBHOUSE_EAVES = 5.15;        // m: wall head (two storeys), leaving ~1.3 m of roof under the 6.5 m total
const MARINA_CLUBHOUSE_ROOF_RISE = 1.15;    // m: representative pitched-roof rise above the eave (clamped to the total)
const MARINA_CLUBHOUSE_OVERHANG = 0.35;     // m: roof overhang past the walls
const MARINA_CLUBHOUSE_BALCONY_DEPTH = 0.85; // m: shallow decorative ledge, PROJECTING past the wall (not inside it)
const MARINA_CLUBHOUSE_POST_PITCH = 1.9;    // m: representative railing-post spacing (not a surveyed count)

// The clubhouse wall height: the two-storey eave, but never above the profile total minus a thin roof so the roof can
// close within the envelope. For a 6.5 m row this is 5.15 m (roof ~1.35 m); a shorter building clamps to total - 0.35.
function marinaClubhouseWallHeight(total) {
  return Math.min(total - 0.35, MARINA_CLUBHOUSE_EAVES);
}

// The white clubhouse facade: two storeys of regularly spaced bays, painted trim, no brick; the balcony/railing reads
// as the trim. Detail stays in the facade shader and the shallow ledge, so there is no per-window mesh.
function createMarinaClubhouseMaterial() {
  const mat = createRenderedFacadeMaterial({
    // floorHeight = the storey height, so the facade lays exactly two window bands below the ~5.15 m eave. windowRatioX
    // 0.62 gives a representative ~1.18 m opening (wide-glazing rhythm), not a narrow slot.
    windowWidth: 1.9, floorHeight: MARINA_CLUBHOUSE_FLOOR, windowRatioX: 0.62, windowRatioY: 0.52,
    litProbability: 0.18, warmth: 0.35, seed: 241.0, cornerPier: 0.35,
    groundFloorBars: 0, windowFrameTint: MARINA_CLUBHOUSE_TRIM, windowCasing: 0.06,
    proceduralEntrances: 0, slabBands: 0
  });
  const wall = mat.colorNode;
  // Horizontal siding seams (thin painted boards): measured along the wall's vertical, faded by the screen-space
  // derivative so the clubhouse does not shimmer at distance and shows no seams on the roof/soffit.
  const board = 0.24;
  const coord = positionWorld.y.div(board);
  const seamU = fract(coord);
  const seam = smoothstep(0.0, 0.12, seamU).mul(float(1.0).sub(smoothstep(0.12, 0.4, seamU)));
  const seamPx = fwidth(coord);
  const fade = float(1.0).sub(smoothstep(0.35, 0.85, seamPx));
  mat.colorNode = wall.mul(float(1.0).sub(seam.mul(0.05).mul(fade)));
  return mat;
}

// The clubhouse's water-facing side is a SOURCE/CAPTAIN-VERIFIED fact recorded in the reviewed profile
// (`islandProfile.appearance.waterV`, st-sb3r.39): the captain's baseline GPU shows the QCYC basin on the row's local
// -v, and the native wing (parts[1] v -8.5..-3.5) protrudes toward the water. There is deliberately NO runtime water
// detector here: the profile is already gated by the committed footprint fingerprint and the exact projection, so a
// different frame or a moved/reshaped row receives no profile and therefore no balcony. Do not generalise this to other
// buildings.

// The exposed waterfront segments of the clubhouse's L plan: for the water side, walk every u breakpoint of the native
// parts, take the OUTERMOST v at each sample (min v for waterV -1, max for +1), and merge adjacent equal-v runs. A
// balcony rail only lives on these exposed runs, so it never sits buried inside the overlapping/opaque wing.
// Returns [{u0, u1, v}] where v is the outermost water-side edge of the union over [u0,u1].
function clubhouseFrontageSegments(parts, waterV) {
  if (!waterV) return [];
  const us = Array.from(new Set(parts.flatMap((p) => [p[0], p[1]]))).sort((a, b) => a - b);
  const frontage = (u) => parts
    .filter((p) => u >= Math.min(p[0], p[1]) && u <= Math.max(p[0], p[1]))
    .map((p) => (waterV < 0 ? p[2] : p[3]))
    .reduce((best, v) => (waterV < 0 ? Math.min(best, v) : Math.max(best, v)), waterV < 0 ? Infinity : -Infinity);
  const segs = [];
  for (let i = 0; i < us.length - 1; i++) {
    const a = us[i], b = us[i + 1];
    if (b - a < 1e-6) continue;
    const v = frontage((a + b) / 2); // the outermost water-side v over this interval
    if (!Number.isFinite(v)) continue;
    const last = segs[segs.length - 1];
    if (last && Math.abs(last.v - v) < 1e-3 && Math.abs(last.u1 - a) < 1e-3) last.u1 = b; // merge a continuous run
    else segs.push({ u0: a, u1: b, v });
  }
  return segs;
}

// The clubhouse silhouette detail: a projecting balcony ledge and railing along the EXPOSED water-facing frontage (never
// inside another part), plus a capped pitched roof over every part. The walls rise to the two-storey eave and the roof
// closes within the 6.5 m profile total, so eaves + roof never stack above the collider. The ledge/railing PROJECT past
// the wall (not inside the mapped footprint, not walkable): the collider stays the native mapped footprint. `trim`
// boxes join the instanced trim draw; roof triangles join the shared hipped-roofs batch — no new draw.
function marinaClubhouseDetail(trim, parts, cx, cz, ang, total, waterV, roofTiles, y0) {
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const wallH = marinaClubhouseWallHeight(total);
  const roofRise = Math.max(0, total - wallH);
  const push = (u, v, y, w, d, hh, tint) => trim.push({ x: cx + u * cs + v * sn, y, z: cz - u * sn + v * cs, w, d, h: hh, ry: ang, color: tint });
  // One capped hip roof per part, on the same two-storey eave, so the L plan reads as one stepped mass, not a single
  // roof over the main block with an unroofed wing. Pitch is clamped so each part's apex stays within the profile total.
  if (roofRise > 0.35) {
    for (const [u0, u1, v0, v1] of parts) {
      const half = Math.max(1.2, Math.min(u1 - u0, v1 - v0) / 2) + MARINA_CLUBHOUSE_OVERHANG;
      const pitch = Math.atan2(roofRise, half);
      pushHipRoof(roofTiles, cx, cz, ang, u0, u1, v0, v1, y0 + wallH, pitch, MARINA_CLUBHOUSE_OVERHANG, linear(MARINA_CLUBHOUSE_ROOF));
    }
  }
  // Projecting balcony on the exposed water-side frontage ONLY. Posts are pitched at a representative ~1.9 m; the ledge
  // and rails read in the off-white trim, not black metal.
  const segs = clubhouseFrontageSegments(parts, waterV);
  if (!segs.length) return;
  const LE = 0.12; // m: the railing's own thickness, just outside the ledge edge
  const depth = MARINA_CLUBHOUSE_BALCONY_DEPTH;
  const floorH = Math.max(MARINA_CLUBHOUSE_FLOOR, wallH * 0.52); // the second storey's floor (the terrace level)
  const railH = 1.02; // m: representative guard height, below the eave
  const dir = waterV < 0 ? -1 : 1;
  for (const { u0, u1, v } of segs) {
    const W = u1 - u0;
    if (W < 0.5) continue;
    const ledgeV = v + dir * depth / 2;             // ledge centre, outside the wall
    const railV = v + dir * (depth + LE / 2);       // rail face, just outside the ledge edge
    push((u0 + u1) / 2, ledgeV, y0 + floorH, W, depth, 0.12, MARINA_CLUBHOUSE_TRIM);
    push((u0 + u1) / 2, railV, y0 + floorH + railH, W, LE, 0.06, MARINA_CLUBHOUSE_TRIM);
    const n = Math.max(1, Math.round(W / MARINA_CLUBHOUSE_POST_PITCH)); // ~1.9 m post pitch, scaled to the run length
    const POST = 0.05, INSET = POST / 2 + 0.02; // keep end posts off the shared segment breakpoint (in the next part)
    for (let k = 0; k <= n; k++) {
      const u = u0 + INSET + (W - 2 * INSET) * (k / n);
      push(u, railV, y0 + floorH + railH / 2, POST, LE, railH, MARINA_CLUBHOUSE_TRIM);
    }
  }
}

// Shed trim: navy door leaves on the long ±v walls (a representative pair, not a surveyed count) plus a navy shutter on
// one gable end. All shallow relief inside the mapped footprint; the trim draw is instanced.
function marinaShedTrim(out, cx, cz, ang, u0, u1, v0, v1, h, y0) {
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const pt = (u, v, y) => [cx + u * cs + v * sn, y, cz - u * sn + v * cs];
  const box = (u, v, y, w, d, hh, tint) => { const [x, , z] = pt(u, v, y); out.push({ x, y, z, w, d, h: hh, ry: ang, color: tint }); };
  const uc = (u0 + u1) / 2, wU = u1 - u0, wV = v1 - v0;
  const doorW = 1.15, doorH = Math.min(2.05, h - 0.35);
  const R = MARINA_TRIM_RELIEF;
  // Thin door leaves whose outer face sits just proud of the opaque wall (a 12 mm visual relief; it does not extend the
  // footprint or imply a walkable/opening platform).
  for (const uu of [u0 + wU * 0.32, u0 + wU * 0.68]) {
    box(uu, v1 + R / 2, y0 + doorH / 2, doorW, R, doorH, MARINA_SHED_BLUE);
    // a slim white stile between the doors reads as a panel split, a hair proud of the leaf
    box(uu, v1 + R + 0.004, y0 + doorH * 0.5, 0.05, 0.008, doorH * 0.96, MARINA_SHED_WALL);
  }
  // A navy shutter on the +u gable end, outer face just proud of the wall
  const shutH = Math.min(1.6, h - 0.4), shutW = Math.min(1.1, wV * 0.5);
  box(u1 + R / 2, (v0 + v1) / 2, y0 + shutH / 2, R, shutW, shutH, MARINA_SHED_BLUE);
}

function buildCityBlocks(scene) {
  const group = new THREE.Group();
  group.name = 'CityBuildings';
  const colliders = [];
  const quadtree = new CityQuadtree({ minX: CITY_BOUNDS.minX, maxX: CITY_BOUNDS.maxX, minZ: CITY_BOUNDS.minZ, maxZ: CITY_BOUNDS.maxZ }, 8, 9);
  const allBlocks = []; // per-building detail records the quadtree streams

  // Facade materials: [0] rendered houses & low blocks, [1] rendered offices & commercial (wider windows),
  // [2..4] curtain walls: blue-green, bronze, silver-blue
  const facadeStyles = [
    [createRenderedFacadeMaterial, { windowWidth: 3.1, floorHeight: 3.4, windowRatioX: 0.44, windowRatioY: 0.48, seed: 13.0 }],
    [createRenderedFacadeMaterial, { windowWidth: 2.4, floorHeight: 3.6, windowRatioX: 0.6, windowRatioY: 0.56, litProbability: 0.5, warmth: 0.6, seed: 29.0, cornerPier: 0.5 }],
    // (Toronto layer: the Commons palette's glass, its hue & chroma kept at the darkness the glass shader expects, as
    // aalghooneh/slop-toronto does: blue-grey condo glass with pale slab edges, the Financial District's dark teal-grey,
    // newer grey-green condo glass with white spandrels)
    [createCurtainWallMaterial, { glassTint: 0x2a3744, frameTint: 0x9a9ea0, windowWidth: 1.6, floorHeight: 3.8, litProbability: 0.5, warmth: 0.55, reflectivity: 0.92, seed: 41.0, boxLocal: true }],
    [createCurtainWallMaterial, { glassTint: 0x1e2326, frameTint: 0x3a3e40, windowWidth: 1.6, floorHeight: 3.8, litProbability: 0.5, warmth: 0.6, reflectivity: 0.9, seed: 57.0, boxLocal: true }],
    [createCurtainWallMaterial, { glassTint: 0x3d4245, frameTint: 0xb4b8ba, windowWidth: 1.6, floorHeight: 3.8, litProbability: 0.5, warmth: 0.5, reflectivity: 0.94, seed: 73.0, boxLocal: true }],
    // [5] the Distillery District's Victorian brick (VICTORIAN): tall narrow windows close together, tall storeys
    [createRenderedFacadeMaterial, { windowWidth: 2.7, floorHeight: 4.6, windowRatioX: 0.36, windowRatioY: 0.64, litProbability: 0.38, warmth: 0.95, seed: 97.0, cornerPier: 1.0, victorian: true }]
  ];
  const materials = facadeStyles.map(([create, opts]) => create(opts));
  const buckets = materials.map(() => []);
  // ?massing=1: the polygon buildings (js/massing-cells.js builds their cell meshes, in their own footprintLocal
  // materials, made only then)
  const massing = massingFootprints();
  const footRecords = [];
  const footSeeds = materials.map(() => 0); // (each style's records numbered as before, for their seeds)
  const massingStats = massing && { buildings: 0, records: massing.records, rejected: massing.rejected, courtyards: 0, partyWalls: 0, onPodium: 0, boxesReplaced: 0, ms: 0 };
  const roofTiles = { pos: [], nor: [], uv: [], col: [] };
  const roofSheets = { pos: [], nor: [], uv: [], col: [] };
  const cottageBoxes = []; // (island cottages: their own clapboard facade material, one draw)
  const cottageTrim = [];  // (island cottages: white corner boards, fascia and inset entry, one instanced draw)
  const marinaShedBoxes = []; // (reviewed QCYC shed: white paneled walls, one draw)
  const marinaClubhouseBoxes = []; // (reviewed QCYC clubhouse: white two-storey walls, one draw)
  const marinaStorageBoxes = []; // (reviewed QCYC storage pads: neutral walls, one draw)
  const marinaTrim = []; // (reviewed QCYC shed: navy doors/shutters, one instanced draw)

  const stats = { buildings: 0, boxes: 0, hip: 0, sheet: 0, glass: 0, storefronts: 0, strip: 0, signed: 0, victorian: 0, stone: 0, monitor: 0, monitorTris: 0, chimneys: 0, cottages: 0, marinaShed: 0, marinaStorage: 0, marinaClubhouse: 0 };
  const retail = storefrontSelection();
  const signWalls = signedWalls();
  const facades = new Map(); // building row -> { mat, floorHeight, front } for the signed buildings
  // (a building on High Park's relief stands on the highest ground under it, js/don-valley.js buildingBase; its plinth
  // down to the lowest is the pilot's. Everywhere else every building stands at y 0)
  const PILOT = window.CITY.DON_VALLEY || null;
  const baseOf = PILOT && PILOT.buildingBase ? PILOT.buildingBase : () => 0;
  for (let bi = 0; bi < GEO.buildings.length; bi++) {
    const b = GEO.buildings[bi];
    // Replacement builders run before CityBuildings and opt in only when their
    // mapped footprint exists in the active frame.
    if (window.CITY.waterfrontLandmarkExcludesBuilding?.(bi)) continue;
    if (window.CITY.waterfrontHarbourfrontExcludesBuilding?.(bi)) continue;
    if (window.CITY.waterfrontMainBuildingExcludesBuilding?.(bi)) continue;
    if (window.CITY.waterfrontConcertStageExcludesBuilding?.(bi)) continue;
    if (window.CITY.biidaasigeParkExcludesBuilding?.(bi)) continue;
    if (window.CITY.waterfrontBathurst?.stats.meshes > 0 && window.CITY.waterfrontBathurstExcludesBuilding?.(bi)) continue;
    if (window.CITY.waterfrontFerriesEnabled && b[9] === 'Jack Layton Ferry Terminal') continue;
    if (window.CITY.htoFirehallReplacesBuilding?.(b)) continue;
    const [cx, cz, ang, parts, sourceHeight, sourceKind, sourceRoof, cseed, , name] = b;
    // Source-matched island profiles correct urban defaults while retaining the
    // native footprint, renderer batching and source row identity.
    const islandProfile = window.CITY.islandBuildingProfile?.(b, bi);
    const h0 = islandProfile?.height ?? sourceHeight;
    const kind = islandProfile?.kind ?? sourceKind;
    const roof = islandProfile?.roof ?? sourceRoof;
    const fixH = nearAny(DISTILLERY.height, cx, cz, 2); // (Toronto layer: a massing height that is a chimney's)
    const h = fixH && inDistillery(cx, cz) ? fixH[2] : h0;
    const y0 = baseOf(cx, cz);
    const foot = massing ? massing.rows.get(bi) : null;
    // Scoped island cottage extension: only confirmed source-matched cottages, only on their box path (the ?massing=1
    // polygon path keeps the native footprint material untouched).
    const cottage = !!(islandProfile && islandProfile.typology === 'cottage' && !foot && !inDistillery(cx, cz));
    // Reviewed QCYC marina structures (st-sb3r.34): only the three source-reviewed rows carry an `appearance` from
    // `islandBuildingProfile`; the material approach is scoped exactly to those rows' appearance style, never a general
    // service/island rule. `shed` is the photo-informed white paneled shed; `storage` is the two uncertain neutral pads.
    const marinaStyle = !foot && !inDistillery(cx, cz) && islandProfile?.appearance ? islandProfile.appearance.style : null;
    const marinaShed = marinaStyle === MARINA_SHED_STYLE;
    const marinaStorage = marinaStyle === MARINA_STORAGE_STYLE;
    const marinaClubhouse = marinaStyle === MARINA_CLUBHOUSE_STYLE;
    const roofType = islandProfile?.roofType || (cottage ? 'gable' : null);
    // The source-correct effective footprint for the bounded pilot cottage (js/waterfront-island-cottage-footprint.js),
    // or the native parts for every other row. This is resolved from the ORIGINAL committed row `b` (its nativeFp is the
    // identity guard), and the SAME parts drive the walls, roof, trim and the OBB collider below. A guarded null keeps
    // the native box, so this is a no-op everywhere else and on a cropped/mismatched frame.
    const partsEff = (cottage && window.CITY.islandCottageFootprintParts?.(b, bi)) || parts;
    // Reviewed QCYC clubhouse (st-sb3r.39): the marina's water-facing side, resolved from mapped geometry rather than the
    // photo's orientation. The mapped marina polygon (OSM Way 193043084) is in COMMITTED_DATA.marinas; the runway that
    // touches the clubhouse's own footprint tells the landward (airport) side, so water = the other side of the ridge.
    // CAPTAIN baseline GPU (2026-11-10): the water side is the clubhouse's local -v, the wing's v-negative face; the
    // landward side is +v. If the footprint sample cannot find the water side, no balcony is drawn (fail closed: never a
    // balcony on the landward face).
    // The water side comes from the already-validated reviewed profile, never from geometry at runtime (st-sb3r.39).
    const clubhouseWaterV = marinaStyle === MARINA_CLUBHOUSE_STYLE ? (islandProfile.appearance.waterV | 0) : 0;
    const rnd = mulberry32((cseed * 7919) ^ Math.round(cx * 13 + cz * 7));
    const cs = Math.cos(ang), sn = Math.sin(ang);
    // which wall looks onto the street: the nearest road, seen in the building's frame
    let front = 3; // +z
    const near = nearestRoads(cx, cz, 90);
    if (near.length) {
      const toRoadX = near[0].px - cx, toRoadZ = near[0].pz - cz;
      const lu = toRoadX * cs - toRoadZ * sn; // world -> the building's frame
      const lv = toRoadX * sn + toRoadZ * cs;
      front = Math.abs(lu) > Math.abs(lv) ? (lu < 0 ? 0 : 1) : (lv < 0 ? 2 : 3);
    }
    // (a signed building fronts the street its sign is on: its rear, for the fire escapes, is the other side)
    const signed = signWalls.get(bi);
    if (signed && !signed.has(front)) front = [...signed][0];
    // material & paint
    let mat = 0;
    if (kind === 3) mat = 2 + Math.floor(rnd() * 3);
    else if (kind === 2) mat = rnd() < 0.35 ? 2 + Math.floor(rnd() * 3) : 1;
    // (Toronto layer: storefronts on selected buildings only, storefrontSelection above. The draw that used to pick
    // a quarter of the low-rise as shops is still made, so every building keeps its colours)
    if (kind === 1) rnd();
    let shopFront = !!signed || (retail.own.has(bi) && kind !== 4 && kind !== 5 && kind !== 6); // (not sheds, works or churches)
    if (!shopFront && kind <= 2 && near.length) {
      // the front wall's middle, and whether it is on the street (not set back behind a yard or forecourt)
      const [pu0, pu1, pv0, pv1] = [0, 1, 2, 3].map((k) => (k % 2 ? Math.max : Math.min)(...parts.map((p) => p[k])));
      const fu = front === 0 ? pu0 : front === 1 ? pu1 : (pu0 + pu1) / 2, fv = front === 2 ? pv0 : front === 3 ? pv1 : (pv0 + pv1) / 2;
      const fx = cx + fu * cs + fv * sn, fz = cz - fu * sn + fv * cs;
      const street = nearestRoads(fx, fz, 22).find((r) => r.road.name === near[0].road.name);
      if (street && retail.onStrip(fx, fz, street.road.name)) { shopFront = true; stats.strip++; }
    }
    if (cottage) shopFront = false; // (the cottage extension gives it a native entrance, not a city storefront)
    if (shopFront) stats.storefronts++;
    const faces = [WALL_KINDS.rear, WALL_KINDS.rear, WALL_KINDS.rear, WALL_KINDS.rear];
    faces[front] = shopFront ? WALL_KINDS.shop : WALL_KINDS.entry;
    if (signed) { for (const w of signed) faces[w] = WALL_KINDS.shop; stats.signed++; }
    // (an island cottage always gets the native entrance on its road/walk-facing wall, never a city storefront)
    if (cottage) { shopFront = false; faces[front] = WALL_KINDS.entry; }
    // (Toronto layer: brick or render by kind, colours from the Commons palette)
    let brick = mat < 2 && rnd() < (BRICK_SHARE[kind] || 0);
    let paintHex = kind === 4 ? weighted(RAW_BLOCK, rnd()) : kind === 5 ? 0x9b9890 : brick ? weighted(TORONTO_MASONRY, rnd())
      : kind === 6 ? weighted(TORONTO_STONE, rnd()) : weighted(TORONTO_RENDER, rnd());
    // (the Distillery District's heritage blocks: its Victorian brick, whatever the draws above said)
    const victorian = h <= DISTILLERY.maxH && inDistillery(cx, cz);
    const stone = victorian && !!nearAny(DISTILLERY.stone, cx, cz);
    if (victorian) { mat = VICTORIAN; brick = true; paintHex = weighted(stone ? DISTILLERY.limestone : DISTILLERY.brick, rnd()); }
    else if (nearAny(DISTILLERY.brickTowers, cx, cz) && inDistillery(cx, cz)) { mat = 1; brick = true; paintHex = weighted(DISTILLERY.brick, rnd()); }
    // (the island cottages: clapboard siding, never the city's brick; a small documented typology palette, not a
    // per-house colour claim. The facade material is the dedicated cottage style below.)
    if (cottage) { mat = 0; brick = false; paintHex = ISLAND_COTTAGE_PAINT[Math.floor(rnd() * ISLAND_COTTAGE_PAINT.length)]; }
    // (the reviewed QCYC rows: their own material path below, never the city's brick/render; keep paint neutral)
    if (marinaShed) { brick = false; paintHex = islandProfile.appearance.wall; }
    else if (marinaStorage) { brick = false; paintHex = islandProfile.appearance.wall; }
    else if (marinaClubhouse) { brick = false; paintHex = islandProfile.appearance.wall; }
    // (paint.w: the glass style in the fraction, + 2 on brick, + 4 on the Distillery's limestone)
    const paint = [...linear(paintHex), (kind === 5 ? 0.95 : rnd()) + (brick ? 2 : 0) + (stone ? 2 : 0)];
    if (signed) facades.set(bi, { mat, floorHeight: FLOOR_HEIGHTS[mat], front });
    const tone = cottage ? Math.max(rnd(), ISLAND_COTTAGE_TONE_MIN) : rnd();
    let topY = 0;
    // ?massing=1: the polygon instead of the boxes; the pitched & sheet roofs stay on the boxes' rectangles over it (a
    // flat cap under them closes whatever the rectangles leave open), its collider is the polygon itself
    let edges = null;
    if (foot) {
      const tf = performance.now();
      const fr = footprintEdges(foot.rings[0], foot.covered, foot.hidden, foot.street, faces[front], shopFront, Math.min(foot.base, h - 0.5), h);
      edges = fr.edges;
      const pitched = victorian ? h <= DISTILLERY.pitchedUpTo : (roof === 1 && kind !== 3) || roof === 2;
      const boxes = [];
      for (const [u0, u1, v0, v1] of parts) {
        const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
        if (u1 - u0 >= 1 && v1 - v0 >= 1) boxes.push([cx + uc * cs + vc * sn, cz - uc * sn + vc * cs, u1 - u0, v1 - v0, ang]);
      }
      const [style, variant] = FOOTPRINT_STYLE[mat];
      footRecords.push({
        // (its material: the rendered or the curtain-wall facades, which merge their styles; variant: its style there)
        cx, cz, style, variant, rings: foot.rings, base: y0 + Math.min(foot.base, h - 0.5), h: y0 + h, kinds: fr.kinds,
        cover: foot.rings[0].map((_, i) => (foot.covered.has(i) ? foot.covered.get(i) : NaN)),
        // (overlapping records of one height: their roofs a little apart, not flickering)
        capY: y0 + (pitched ? h - 0.05 : h) - (bi % 5) * 0.012, tone, seed: footSeeds[mat]++ * 29, paint,
        boxes, faces // (the far tier: the boxes this polygon replaces)
      });
      const outer = foot.rings[0];
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of outer) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      // (`massing`: the walkers' lines step round it like the turned boxes it replaces, main.js)
      colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, maxY: y0 + h, polygon: outer.map(([x, z]) => ({ x, z })), massing: foot.id });
      massingStats.buildings++;
      massingStats.courtyards += foot.rings.length - 1;
      massingStats.partyWalls += fr.edges.filter((e, i) => e.kind === WALL_KINDS.lotLine && foot.covered.has(i)).length;
      if (foot.base > 0) massingStats.onPodium++;
      massingStats.boxesReplaced += parts.filter(([u0, u1, v0, v1]) => u1 - u0 >= 1 && v1 - v0 >= 1).length;
      massingStats.ms += performance.now() - tf;
    }
    // The profile `height` is the TOTAL building height. A cottage's walls stop at the eaves; the roof occupies the
    // rest of that total instead of stacking another 2–4 m on top (the first GPU pass's oversized, floating roofs).
    let cottageWallH = h;
    if (cottage) {
      let mp = partsEff[0];
      for (const p of partsEff) if ((p[1] - p[0]) * (p[3] - p[2]) > (mp[1] - mp[0]) * (mp[3] - mp[2])) mp = p;
      const estimated = islandProfile?.heightSource === 'conservative island estimate';
      cottageWallH = islandCottageEaveHeight(h, mp[1] - mp[0], mp[3] - mp[2], estimated);
      // The shader decodes each box's tone from its Float32 box.w, whose integer part depends on the box's instance
      // index (createFacadeBoxes). The door must match the bay of the LARGEST part's box, so reproduce that box's
      // effective tone: its index is the boxes already emitted plus the valid parts before it (the parts loop skips
      // parts under 1 m, exactly as the box emission does below).
      const mpIdx = partsEff.indexOf(mp);
      let boxesBefore = 0;
      for (let k = 0; k < mpIdx; k++) { const [a0, a1, b0, b1] = partsEff[k]; if (a1 - a0 >= 1 && b1 - b0 >= 1) boxesBefore++; }
      const shaderTone = islandCottageShaderTone(tone, cottageBoxes.length + boxesBefore);
      islandCottageTrim(cottageTrim, cx, cz, ang, mp[0], mp[1], mp[2], mp[3], cottageWallH, front, y0, shaderTone);
      stats.cottages = (stats.cottages || 0) + 1;
    }
    // Reviewed QCYC shed: the profile total is the envelope; the walls stop at the low eaves and the pitched roof
    // occupies the rest, so eaves + roof never stack above the 4 m collider total.
    let marinaShedWallH = h;
    if (marinaShed) {
      let mp = partsEff[0];
      for (const p of partsEff) if ((p[1] - p[0]) * (p[3] - p[2]) > (mp[1] - mp[0]) * (mp[3] - mp[2])) mp = p;
      marinaShedWallH = marinaShedEaveHeight(h);
      marinaShedTrim(marinaTrim, cx, cz, ang, mp[0], mp[1], mp[2], mp[3], marinaShedWallH, y0);
      stats.marinaShed++;
    }
    if (marinaStorage) stats.marinaStorage++;
    // Reviewed QCYC clubhouse: keep the 6.5 m envelope; two storeys stop at the representative eave and a capped hip
    // roof over EVERY part occupies the rest. Its water-facing wall carries the projecting balcony/railing (never the
    // landward face; the side is the reviewed profile's `waterV`, not a runtime guess).
    let marinaClubhouseWallH = h;
    if (marinaClubhouse) {
      marinaClubhouseWallH = marinaClubhouseWallHeight(h);
      marinaClubhouseDetail(marinaTrim, partsEff, cx, cz, ang, h, clubhouseWaterV, roofTiles, y0);
      stats.marinaClubhouse = (stats.marinaClubhouse || 0) + 1;
    }
    for (const [u0, u1, v0, v1] of partsEff) {
      const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
      const w = u1 - u0, d = v1 - v0;
      if (w < 1 || d < 1) continue;
      const x = cx + uc * cs + vc * sn;
      const z = cz - uc * sn + vc * cs;
      if (!foot) {
        if (cottage) cottageBoxes.push({ x, y: y0 + cottageWallH / 2, z, w, h: cottageWallH, d, ry: ang, faces, tone, paint });
        else if (marinaShed) marinaShedBoxes.push({ x, y: y0 + marinaShedWallH / 2, z, w, h: marinaShedWallH, d, ry: ang, faces, tone, paint });
        else if (marinaStorage) marinaStorageBoxes.push({ x, y: y0 + h / 2, z, w, h, d, ry: ang, faces, tone, paint });
        else if (marinaClubhouse) marinaClubhouseBoxes.push({ x, y: y0 + marinaClubhouseWallH / 2, z, w, h: marinaClubhouseWallH, d, ry: ang, faces, tone, paint });
        else buckets[mat].push({ x, y: y0 + h / 2, z, w, h, d, ry: ang, faces, tone, paint });
        stats.boxes++;
      }
      topY = cottage ? cottageWallH : marinaShed ? marinaShedWallH : marinaClubhouse ? marinaClubhouseWallH : h;
      if (marinaShed) {
        // Dark pitched roof with closed gable ends, base on the low eave and apex at the profile total. The shallow
        // overhang is a roof detail; the collider below stays the mapped footprint and the total envelope.
        const rgb = linear(MARINA_SHED_ROOF);
        const half = Math.max(1.2, Math.min(w, d) / 2);
        const pitch = Math.atan2(Math.max(0.5, h - marinaShedWallH), half + MARINA_SHED_OVERHANG);
        pushGableRoof(roofTiles, cx, cz, ang, u0, u1, v0, v1, y0 + marinaShedWallH, pitch, MARINA_SHED_OVERHANG, rgb, linear(MARINA_SHED_WALL));
        stats.hip++;
      } else if (marinaClubhouse) {
        // The hip roof is pushed once by marinaClubhouseDetail (above), over the largest part only, so a second part does
        // not stack a duplicate roof. Nothing to push here.
      } else if (marinaStorage) {
        // Native flat envelope: the box top is the roof; no invented pitched roof for the uncertain pads.
      } else if (victorian) {
        if (h <= DISTILLERY.pitchedUpTo) {
          const M = DISTILLERY.monitor;
          const pitch = Math.min((32 + rnd() * 6) * Math.PI / 180, Math.atan(DISTILLERY.maxRise / (Math.min(w, d) / 2 + 0.35)));
          const slate = linear(weighted(DISTILLERY.slate, rnd()));
          if (!stone && h <= M.maxH && Math.max(w, d) >= M.minLen && Math.max(w, d) >= M.minAspect * Math.min(w, d)) {
            stats.monitorTris += pushMonitorRoof(roofTiles, cx, cz, ang, u0, u1, v0, v1, y0 + h, pitch, 0.35, slate, linear(M.glass), linear(M.frame));
            stats.monitor++;
          } else pushHipRoof(roofTiles, cx, cz, ang, u0, u1, v0, v1, y0 + h, pitch, 0.35, slate);
          stats.hip++;
        }
      } else if (cottage && roof !== 0 && roof !== 2) {
        // Source-supported varied silhouette. The roof base sits on the eave and rises only to the profile's TOTAL
        // height, so gable ends are sealed against the wall and the roof cannot float above the box.
        const rgb = linear(weighted(ROOF_PAINT, rnd()));
        const half = Math.max(1.2, Math.min(w, d) / 2);
        const pitch = Math.atan2(Math.max(0.5, h - cottageWallH), half + 0.45);
        if (roofType === 'gable') pushGableRoof(roofTiles, cx, cz, ang, u0, u1, v0, v1, y0 + cottageWallH, pitch, 0.45, rgb, linear(paintHex));
        else pushHipRoof(roofTiles, cx, cz, ang, u0, u1, v0, v1, y0 + cottageWallH, pitch, 0.45, rgb, true);
        stats.hip++;
      } else if (roof === 1 && kind !== 3) {
        pushHipRoof(roofTiles, cx, cz, ang, u0, u1, v0, v1, y0 + h, (24 + rnd() * 8) * Math.PI / 180, 0.6, linear(weighted(ROOF_PAINT, rnd())));
        stats.hip++;
      } else if (roof === 2) {
        pushShedRoof(roofSheets, cx, cz, ang, u0, u1, v0, v1, y0 + h, linear(weighted(SHEET_PAINT, rnd())));
        stats.sheet++;
      }
      if (foot) continue;
      // player collider: the part's turned rectangle
      const hx = w / 2, hz = d / 2;
      const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
      colliders.push({ minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, maxY: y0 + h, obb: { cx: x, cz: z, hx, hz, cs, sn } });
    }
    if (mat >= 2 && mat !== VICTORIAN) stats.glass++;
    if (victorian) stats.victorian++;
    if (stone) stats.stone++;
    stats.buildings++;

    // Close-up detail for the quadtree: overhead water tank (on flat roofs; on a stand in the yard beside a hipped
    // house), split-AC condensers on the side walls, a satellite dish
    const [u0, u1, v0, v1] = partsEff[0];
    const local = (u, v) => [cx + u * cs + v * sn, cz - u * sn + v * cs];
    const detail = { cx, cz, tanks: [], acs: [], dishes: [], fireEscapes: [], ry: ang };
    // --- Fire escapes (js/fire-escapes.js, mrdoob's 8c17250): on the older brick walk-ups and main-street blocks of
    // 3 to 8 storeys, about two in five, on the rear wall (the lane side), never the street front; a landing per floor
    // from the 2nd up, one escape per 15 m of wall
    if ((kind === 1 || kind === 2) && mat < 2 && rnd() < 0.42) {
      const storey = mat === 1 ? 3.6 : 3.4; // the facade's floor height (materials above)
      const nf = Math.round(h / storey);
      const back = front === 3 ? 2 : front === 2 ? 3 : front === 0 ? 1 : 0;
      const lenOf = (f) => (f < 2 ? v1 - v0 : u1 - u0); // (walls of the main part, parts[0])
      const wall = lenOf(back) >= 4.6 && !signed?.has(back) ? back : undefined; // (side walls are often party walls in a row)
      // ?massing=1: on the polygon's longest rear wall (not a street front nor a party wall), its +z out of the wall
      const rear = edges && edges.filter((e) => e.kind === WALL_KINDS.rear && !e.street && e.len >= 4.6).sort((p, q) => q.len - p.len)[0];
      if (edges && nf >= 3 && nf <= 8 && rear) {
        const landings = Math.min(nf - 1, 7);
        const count = rear.len >= 15 ? 2 : 1;
        for (let k = 0; k < count; k++) {
          const t = (k + 0.5) / count;
          detail.fireEscapes.push({
            x: rear.ax + (rear.bx - rear.ax) * t + rear.nx * 0.55, y: y0 + storey + 0.1, z: rear.az + (rear.bz - rear.az) * t + rear.nz * 0.55,
            h: (landings - 1) * storey + 1, storey, landings, ry: Math.atan2(rear.nx, rear.nz), facing: 0
          });
        }
      } else if (!edges && nf >= 3 && nf <= 8 && wall !== undefined) {
        const landings = Math.min(nf - 1, 7);
        const count = lenOf(wall) >= 15 ? 2 : 1;
        for (let k = 0; k < count; k++) {
          const t = (k + 0.5) / count;
          const [fx, fz] = wall < 2
            ? local(wall === 0 ? u0 - 0.55 : u1 + 0.55, v0 + (v1 - v0) * t)
            : local(u0 + (u1 - u0) * t, wall === 2 ? v0 - 0.55 : v1 + 0.55);
          detail.fireEscapes.push({
            x: fx, y: y0 + storey + 0.1, z: fz, h: (landings - 1) * storey + 1, storey, landings, ry: ang,
            facing: [-Math.PI / 2, Math.PI / 2, Math.PI, 0][wall] // the module's +z faces out of the wall
          });
        }
      }
    }
    // --- end fire escapes
    if (kind <= 2 || kind === 6 || kind === 7) {
      // (no overhead water tanks: they were Abuja's, polyethylene drums on stands; Toronto's buildings have none.
      // John: "Toronto doesn't really have water towers")
      // an air conditioner on a side wall (not the street front), at the upper floors: in Toronto a few, not Abuja's
      // split units on every wall
      const n = rnd() < 0.2 ? 1 : 0;
      const sides = edges && edges.filter((e) => e.kind === WALL_KINDS.rear && e.len >= 3);
      for (let k = 0; k < n && sides; k++) { // (?massing=1: on one of the polygon's rear walls)
        const e = sides[Math.floor(rnd() * sides.length)];
        if (!e) break;
        const floors = Math.max(1, Math.round((topY - 0.6) / 3.4));
        const y = Math.min(topY - 1.0, 0.6 + Math.floor(rnd() * floors) * 3.4 + 1.6);
        const t = 0.15 + rnd() * 0.7;
        detail.acs.push({ x: e.ax + (e.bx - e.ax) * t + e.nx * 0.2, y: y0 + y, z: e.az + (e.bz - e.az) * t + e.nz * 0.2, ry: Math.atan2(e.nx, e.nz) });
      }
      for (let k = 0; k < n && !sides; k++) {
        const side = [0, 1, 2, 3].filter((f) => f !== front)[Math.floor(rnd() * 3)];
        const floors = Math.max(1, Math.round((topY - 0.6) / 3.4));
        const y = Math.min(topY - 1.0, 0.6 + Math.floor(rnd() * floors) * 3.4 + 1.6);
        const t = 0.15 + rnd() * 0.7;
        let lu, lv, rot;
        if (side < 2) { lu = side === 0 ? u0 - 0.2 : u1 + 0.2; lv = v0 + (v1 - v0) * t; rot = side === 0 ? -Math.PI / 2 : Math.PI / 2; }
        else { lu = u0 + (u1 - u0) * t; lv = side === 2 ? v0 - 0.2 : v1 + 0.2; rot = side === 2 ? Math.PI : 0; }
        const [ax, az] = local(lu, lv);
        if (!signed?.has(side)) detail.acs.push({ x: ax, y: y0 + y, z: az, ry: ang + rot }); // (never on a signed shopfront)
      }
      if (rnd() < 0.05) { // the odd satellite dish
        const [dx, dz] = local(u0 + (u1 - u0) * (0.1 + rnd() * 0.8), v0 + (v1 - v0) * (0.1 + rnd() * 0.8));
        detail.dishes.push({ x: dx, y: y0 + topY + (roof === 1 ? 0.2 : 0), z: dz, ry: rnd() * Math.PI * 2 });
      }
    }
    // The reviewed clubhouse uses only source-supported exterior detail. Consume the generic random
    // draws above so other buildings remain stable, then omit unsourced rooftop/wall accessories here.
    if (marinaClubhouse) { detail.acs.length = 0; detail.dishes.length = 0; detail.fireEscapes.length = 0; }
    if (detail.tanks.length || detail.acs.length || detail.dishes.length || detail.fireEscapes.length) {
      quadtree.insert(detail);
      allBlocks.push(detail);
    }
  }

  // ?massing=1: the polygons, as compact cell meshes in three distance tiers (js/massing-cells.js), built in a worker;
  // `massingReady` settles once their meshes are in the group (main.js waits for it before the culling setup)
  let massingReady = null, massingTiers = null;
  if (massing) {
    const tm = performance.now();
    // three footprint materials, each drawing all its styles (tsl-materials.js footprintStyled): a block is two draws a
    // tier (three at the Distillery), not six
    const footMaterials = FOOTPRINT_MATERIALS.map((ids) => ids.map((i) => facadeStyles[i])).map((list) => {
      if (list.some(([create]) => create !== list[0][0])) throw new Error('massing: a footprint material mixes facade kinds');
      return list[0][0]({ footprintLocal: true, styles: list.map(([, opts]) => opts) });
    });
    const input = window.CITY.MassingCells.packInput(footRecords);
    massingStats.packMs = Math.round((performance.now() - tm) * 10) / 10;
    massingStats.ms = Math.round((massingStats.ms + performance.now() - tm) * 10) / 10;
    massingReady = buildMassingCellsOffThread(input).then((built) => {
      massingTiers = addMassingCells(group, built, footMaterials, massingStats);
      return massingStats;
    });
  }
  // The Distillery's brick chimneys (OSM man_made=chimney): a plinth, a shaft stepping in once, a corbelled band & a
  // cap, as blank-walled boxes in the Victorian brick's batch (its coping lines are the corbel courses). No draw of their own.
  if (distilleryRing) {
    const blank = [WALL_KINDS.lotLine, WALL_KINDS.lotLine, WALL_KINDS.lotLine, WALL_KINDS.lotLine];
    for (const [x, z, H] of DISTILLERY.chimneys) {
      const s = Math.max(2.0, H * 0.075); // (slender: the shaft about 13 times as tall as it is wide)
      const paint = [...linear(DISTILLERY.chimneyBrick), 2.5];
      for (const [k, y0, y1] of [[1.3, 0, 0.16], [1.0, 0.16, 0.62], [0.88, 0.62, 0.9], [1.06, 0.9, 0.935], [0.94, 0.935, 1]]) {
        buckets[VICTORIAN].push({ x, y: (y0 + y1) / 2 * H, z, w: s * k, h: (y1 - y0) * H, d: s * k, faces: blank, tone: 0.5, paint });
      }
      const r = s * 0.65;
      colliders.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, maxY: H, obb: { cx: x, cz: z, hx: r, hz: r, cs: 1, sn: 0 } });
      stats.chimneys++;
    }
  }
  window.CITY.distilleryStats = { victorian: stats.victorian, stone: stats.stone, monitor: stats.monitor, monitorTris: stats.monitorTris, chimneys: stats.chimneys };
  buckets.forEach((items, i) => {
    if (!items.length) return;
    const inst = createFacadeBoxes(materials[i], items);
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.name = `Buildings_${i}`;
    group.add(inst);
  });
  // The island cottages: one clapboard facade draw, plus one instanced white-trim draw (corner boards, fascia, entry)
  if (cottageBoxes.length) {
    const inst = createFacadeBoxes(createIslandCottageMaterial(), cottageBoxes);
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.name = 'Buildings_IslandCottages';
    group.add(inst);
  }
  // Reviewed QCYC marina structures: one paneled-shed draw, one neutral-storage draw, and their navy trim joins the
  // existing instanced trim draw (no per-door mesh). Same group, so culling and shadows are unchanged.
  if (marinaShedBoxes.length) {
    const inst = createFacadeBoxes(createMarinaShedMaterial(), marinaShedBoxes);
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.name = 'Buildings_MarinaShed';
    group.add(inst);
  }
  if (marinaStorageBoxes.length) {
    const inst = createFacadeBoxes(createMarinaStorageMaterial(), marinaStorageBoxes);
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.name = 'Buildings_MarinaStorage';
    group.add(inst);
  }
  if (marinaClubhouseBoxes.length) {
    const inst = createFacadeBoxes(createMarinaClubhouseMaterial(), marinaClubhouseBoxes);
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.name = 'Buildings_MarinaClubhouse';
    group.add(inst);
  }
  if (marinaTrim.length) cottageTrim.push(...marinaTrim);
  if (cottageTrim.length) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const trimMat = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.0 });
    const inst = new THREE.InstancedMesh(geo, trimMat, cottageTrim.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    cottageTrim.forEach((t, i) => {
      q.setFromAxisAngle(up, t.ry);
      inst.setMatrixAt(i, m4.compose(pos.set(t.x, t.y, t.z), q, sc.set(t.w, t.h, t.d)));
      inst.setColorAt(i, new THREE.Color(t.color ?? ISLAND_COTTAGE_TRIM));
    });
    inst.castShadow = inst.receiveShadow = true;
    inst.name = 'IslandCottageTrim';
    group.add(inst);
  }
  for (const [A, ribbed, name] of [[roofTiles, false, 'HippedRoofs'], [roofSheets, true, 'SheetRoofs']]) {
    if (!A.pos.length) continue;
    // split into ~1 km strips so the frustum can skip what's behind
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(A.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(A.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(A.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(A.col, 3));
    const m = new THREE.Mesh(g, createRoofMaterial(ribbed));
    m.castShadow = m.receiveShadow = true;
    m.name = name;
    group.add(m);
  }
  if (window.CITY.DEBUG_ROADS !== false) {
    console.info(`[buildings] ${stats.buildings} buildings, ${stats.boxes} boxes, ${stats.hip} hipped & ${stats.sheet} sheet roofs, ${stats.glass} in curtain wall, ${stats.victorian} in the Distillery's brick (${stats.stone} limestone, ${stats.monitor} monitor roofs, ${stats.chimneys} chimneys); ${stats.storefronts} storefronts (${stats.strip} on retail strips, ${stats.signed} signed); ${stats.cottages} island cottages`);
  }

  // ===================================================================================================================
  // Quadtree-streamed close-up detail
  // ===================================================================================================================
  const MAX_TANKS = 2600, MAX_ACS = 5000, MAX_DISHES = 2200;
  const dummy = new THREE.Object3D();
  // Overhead water tank: a ribbed polyethylene cylinder with a dome lid, on a four-leg steel stand (unit height,
  // scaled to the stand's height per instance: two meshes)
  const tankGeo = (() => {
    const body = new THREE.CylinderGeometry(0.68, 0.68, 1.55, 16);
    body.translate(0, 0.775, 0);
    const lid = new THREE.SphereGeometry(0.68, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    lid.scale(1, 0.32, 1);
    lid.translate(0, 1.55, 0);
    return mergeGeometries([body.toNonIndexed(), lid.toNonIndexed()], false);
  })();
  const standGeo = (() => {
    const parts = [];
    for (const [x, z] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) {
      const g = new THREE.BoxGeometry(0.08, 1, 0.08);
      g.translate(x, 0.5, z);
      parts.push(g);
    }
    const deck = new THREE.BoxGeometry(1.4, 0.06, 1.4);
    deck.translate(0, 0.97, 0);
    parts.push(deck);
    for (const y of [0.35, 0.7]) {
      for (const [w, d, x, z] of [[1.3, 0.05, 0, -0.6], [1.3, 0.05, 0, 0.6], [0.05, 1.3, -0.6, 0], [0.05, 1.3, 0.6, 0]]) {
        const g = new THREE.BoxGeometry(w, 0.05, d);
        g.translate(x, y, z);
        parts.push(g);
      }
    }
    return mergeGeometries(parts.map((g) => g.toNonIndexed()), false);
  })();
  const tankMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0.0 });
  const TANK_COLS = [0x15171a, 0x1f4f8f, 0xe7e2d4, 0xb3a07a].map((h) => new THREE.Color(h)); // black, blue, white, beige
  const standMat = new THREE.MeshStandardNodeMaterial({ color: 0x3b3f42, roughness: 0.5, metalness: 0.6 });
  const tankInst = new THREE.InstancedMesh(tankGeo, tankMat, MAX_TANKS);
  const standInst = new THREE.InstancedMesh(standGeo, standMat, MAX_TANKS);
  for (let i = 0; i < MAX_TANKS; i++) tankInst.setColorAt(i, TANK_COLS[i % TANK_COLS.length]);
  // Split-AC outdoor unit: white casing, round fan grille on the front (uv-mapped box)
  const acGeo = new THREE.BoxGeometry(0.82, 0.55, 0.3);
  const acMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.6 });
  acMat.colorNode = Fn(() => {
    const t = uv();
    const d = t.sub(0.42).mul(float(1.0)).length();
    const grille = smoothstep(0.3, 0.27, d).mul(smoothstep(0.02, 0.0, abs(fract(d.mul(14.0)).sub(0.5)).sub(0.3)));
    return mix(color(0xe8e8e3), color(0x55585b), grille.mul(0.8));
  })();
  const acInst = new THREE.InstancedMesh(acGeo, acMat, MAX_ACS);
  // Satellite dish: a shallow dish on a short arm
  const dishGeo = (() => {
    const dish = new THREE.SphereGeometry(0.45, 14, 4, 0, Math.PI * 2, 0, 0.55);
    dish.rotateX(-Math.PI / 2 + 0.6);
    dish.translate(0, 0.75, 0);
    const arm = new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6);
    arm.translate(0, 0.4, 0);
    return mergeGeometries([dish.toNonIndexed(), arm.toNonIndexed()], false);
  })();
  const dishMat = new THREE.MeshStandardNodeMaterial({ color: 0xd9d9d4, roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide });
  const dishInst = new THREE.InstancedMesh(dishGeo, dishMat, MAX_DISHES);
  for (const m of [tankInst, standInst, acInst, dishInst]) {
    m.castShadow = m.receiveShadow = true;
    m.frustumCulled = false;
    m.count = 0;
    group.add(m);
  }
  // Wrought-iron fire escapes: one instanced escape at every distance, nearby ones casting shadows (fire-escapes.js)
  const fireEscapeSystem = window.CITY.createFireEscapes(group);

  let lastX = Infinity, lastZ = Infinity, activeCount = 0;
  const STREAM_RADIUS = 420;
  function flagRange(attribute, count) {
    if (count === 0) return;
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, count * attribute.itemSize);
    attribute.needsUpdate = true;
  }
  function update(fx, fz, force = false) {
    if (!force && (fx - lastX) ** 2 + (fz - lastZ) ** 2 < 324) return;
    lastX = fx;
    lastZ = fz;
    const near = quadtree.queryRange(fx, fz, STREAM_RADIUS);
    near.sort((a, b) => (a.cx - fx) ** 2 + (a.cz - fz) ** 2 - ((b.cx - fx) ** 2 + (b.cz - fz) ** 2));
    activeCount = near.length;
    let nt = 0, na = 0, nd = 0;
    fireEscapeSystem.begin(fx, fz);
    for (const d of near) {
      for (const fe of d.fireEscapes || []) fireEscapeSystem.add(fe);
      for (const t of d.tanks) {
        if (nt >= MAX_TANKS) break;
        dummy.rotation.set(0, d.ry, 0);
        dummy.position.set(t.x, t.y, t.z);
        dummy.scale.set(1, t.stand, 1);
        dummy.updateMatrix();
        standInst.setMatrixAt(nt, dummy.matrix);
        dummy.position.set(t.x, t.y + t.stand, t.z);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        tankInst.setMatrixAt(nt, dummy.matrix);
        tankInst.setColorAt(nt, TANK_COLS[t.col]);
        nt++;
      }
      for (const a of d.acs) {
        if (na >= MAX_ACS) break;
        dummy.rotation.set(0, a.ry, 0);
        dummy.position.set(a.x, a.y, a.z);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        acInst.setMatrixAt(na++, dummy.matrix);
      }
      for (const s of d.dishes) {
        if (nd >= MAX_DISHES) break;
        dummy.rotation.set(0, s.ry, 0);
        dummy.position.set(s.x, s.y, s.z);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        dishInst.setMatrixAt(nd++, dummy.matrix);
      }
    }
    tankInst.count = standInst.count = nt;
    acInst.count = na;
    dishInst.count = nd;
    flagRange(tankInst.instanceMatrix, nt);
    flagRange(standInst.instanceMatrix, nt);
    if (tankInst.instanceColor) flagRange(tankInst.instanceColor, nt);
    flagRange(acInst.instanceMatrix, na);
    flagRange(dishInst.instanceMatrix, nd);
    fireEscapeSystem.end();
  }
  update(0, 0, true);

  scene.add(group);
  window.CITY.storefrontBuildingStats = { storefronts: stats.storefronts, strip: stats.strip, signed: stats.signed };
  return {
    group, colliders, quadtree, allBlocks, update, getActiveBlockCount: () => activeCount, facadeOf: (row) => facades.get(row) || null,
    massingReady, updateMassingTiers: (camera) => massingTiers && massingTiers.update(camera)
  };
}

Object.assign(window.CITY, {
  CityQuadtree, buildCityBlocks, storefrontSelection, signedWalls,
  // (pure geometry helpers, exported for the focused island-cottage geometry tests)
  pushGableRoof, islandCottageTrim, islandCottageEaveHeight, islandCottageDoorBay, islandCottageShaderTone,
  ISLAND_COTTAGE_BAY_PITCH, ISLAND_COTTAGE_CORNER_PIER, ISLAND_COTTAGE_DOOR_CASING, ISLAND_COTTAGE_TONE_MIN,
  // (pure geometry helpers for the focused marina-appearance tests, st-sb3r.34)
  marinaShedTrim, marinaShedEaveHeight, createMarinaShedMaterial, createMarinaStorageMaterial,
  MARINA_SHED_STYLE, MARINA_STORAGE_STYLE,
  MARINA_SHED_EAVES, MARINA_SHED_OVERHANG, MARINA_SHED_BLUE, MARINA_SHED_WALL, MARINA_SHED_ROOF,
  MARINA_PANEL_WINDOW_RATIO_X, MARINA_PANEL_WINDOW_RATIO_Y, MARINA_TRIM_RELIEF,
  // (pure geometry helpers for the focused QCYC clubhouse tests, st-sb3r.39)
  createMarinaClubhouseMaterial, marinaClubhouseDetail, marinaClubhouseWallHeight, clubhouseFrontageSegments,
  MARINA_CLUBHOUSE_STYLE, MARINA_CLUBHOUSE_EAVES, MARINA_CLUBHOUSE_ROOF_RISE, MARINA_CLUBHOUSE_BALCONY_DEPTH,
  MARINA_CLUBHOUSE_POST_PITCH, MARINA_CLUBHOUSE_WALL, MARINA_CLUBHOUSE_TRIM, MARINA_CLUBHOUSE_ROOF
});
})();
