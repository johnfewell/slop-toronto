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
const { Fn, float, color, uv, attribute, fract, smoothstep, mix, abs, positionWorld, normalWorldGeometry } = window.CITY.TSL;
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
function pushHipRoof(A, cx, cz, ang, u0, u1, v0, v1, y, pitch, eave, rgb) {
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
  for (const i of [0, 1, 2, 0, 2, 3]) {
    A.pos.push(s[i][0], s[i][1], s[i][2]);
    A.nor.push(0, -1, 0);
    A.uv.push(0, 0);
    A.col.push(rgb[0] * 0.6, rgb[1] * 0.6, rgb[2] * 0.6);
  }
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
// whose row no longer holds the building it was compiled for is ignored (js/storefront-signs.js skips it too)
function signedWalls(data = window.CITY.STOREFRONTS) {
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

  const stats = { buildings: 0, boxes: 0, hip: 0, sheet: 0, glass: 0, storefronts: 0, strip: 0, signed: 0, victorian: 0, stone: 0, monitor: 0, monitorTris: 0, chimneys: 0 };
  const retail = storefrontSelection();
  const signWalls = signedWalls();
  const facades = new Map(); // building row -> { mat, floorHeight, front } for the signed buildings
  // (a building on High Park's relief stands on the highest ground under it, js/don-valley.js buildingBase; its plinth
  // down to the lowest is the pilot's. Everywhere else every building stands at y 0)
  const PILOT = window.CITY.DON_VALLEY || null;
  const baseOf = PILOT && PILOT.buildingBase ? PILOT.buildingBase : () => 0;
  for (let bi = 0; bi < GEO.buildings.length; bi++) {
    const b = GEO.buildings[bi];
    const [cx, cz, ang, parts, h0, kind, roof, cseed, , name] = b;
    const fixH = nearAny(DISTILLERY.height, cx, cz, 2); // (Toronto layer: a massing height that is a chimney's)
    const h = fixH && inDistillery(cx, cz) ? fixH[2] : h0;
    const y0 = baseOf(cx, cz);
    const foot = massing ? massing.rows.get(bi) : null;
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
    if (shopFront) stats.storefronts++;
    const faces = [WALL_KINDS.rear, WALL_KINDS.rear, WALL_KINDS.rear, WALL_KINDS.rear];
    faces[front] = shopFront ? WALL_KINDS.shop : WALL_KINDS.entry;
    if (signed) { for (const w of signed) faces[w] = WALL_KINDS.shop; stats.signed++; }
    // (Toronto layer: brick or render by kind, colours from the Commons palette)
    let brick = mat < 2 && rnd() < (BRICK_SHARE[kind] || 0);
    let paintHex = kind === 4 ? weighted(RAW_BLOCK, rnd()) : kind === 5 ? 0x9b9890 : brick ? weighted(TORONTO_MASONRY, rnd())
      : kind === 6 ? weighted(TORONTO_STONE, rnd()) : weighted(TORONTO_RENDER, rnd());
    // (the Distillery District's heritage blocks: its Victorian brick, whatever the draws above said)
    const victorian = h <= DISTILLERY.maxH && inDistillery(cx, cz);
    const stone = victorian && !!nearAny(DISTILLERY.stone, cx, cz);
    if (victorian) { mat = VICTORIAN; brick = true; paintHex = weighted(stone ? DISTILLERY.limestone : DISTILLERY.brick, rnd()); }
    else if (nearAny(DISTILLERY.brickTowers, cx, cz) && inDistillery(cx, cz)) { mat = 1; brick = true; paintHex = weighted(DISTILLERY.brick, rnd()); }
    // (paint.w: the glass style in the fraction, + 2 on brick, + 4 on the Distillery's limestone)
    const paint = [...linear(paintHex), (kind === 5 ? 0.95 : rnd()) + (brick ? 2 : 0) + (stone ? 2 : 0)];
    if (signed) facades.set(bi, { mat, floorHeight: FLOOR_HEIGHTS[mat], front });
    const tone = rnd();
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
    for (const [u0, u1, v0, v1] of parts) {
      const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
      const w = u1 - u0, d = v1 - v0;
      if (w < 1 || d < 1) continue;
      const x = cx + uc * cs + vc * sn;
      const z = cz - uc * sn + vc * cs;
      if (!foot) {
        buckets[mat].push({ x, y: y0 + h / 2, z, w, h, d, ry: ang, faces, tone, paint });
        stats.boxes++;
      }
      topY = h;
      if (victorian) {
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
    const [u0, u1, v0, v1] = parts[0];
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
    console.info(`[buildings] ${stats.buildings} buildings, ${stats.boxes} boxes, ${stats.hip} hipped & ${stats.sheet} sheet roofs, ${stats.glass} in curtain wall, ${stats.victorian} in the Distillery's brick (${stats.stone} limestone, ${stats.monitor} monitor roofs, ${stats.chimneys} chimneys); ${stats.storefronts} storefronts (${stats.strip} on retail strips, ${stats.signed} signed)`);
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

Object.assign(window.CITY, { CityQuadtree, buildCityBlocks, storefrontSelection, signedWalls });
})();
