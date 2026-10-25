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
const { Fn, float, color, uv, attribute, fract, smoothstep, mix, abs } = window.CITY.TSL;
const { GEO, CITY_BOUNDS, nearestRoads } = window.CITY;
const { createRenderedFacadeMaterial, createCurtainWallMaterial, createFacadeBoxes, WALL_KINDS } = window.CITY;

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

// Roofing: stone-coated steel tiles (rows of shingle-shaped pressed tiles every ~0.37 m up the slope) or ribbed
// long-span sheets, in the vertex colour
function createRoofMaterial(ribbed) {
  const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: ribbed ? 0.5 : 0.62, metalness: ribbed ? 0.45 : 0.15 });
  mat.colorNode = Fn(() => {
    const c = attribute('color', 'vec3');
    const t = uv();
    if (ribbed) {
      const rib = smoothstep(0.0, 0.25, abs(fract(t.x.mul(1.3)).sub(0.5)));
      return c.mul(mix(float(0.82), float(1.0), rib));
    }
    const row = fract(t.y.div(0.37));
    const shade = smoothstep(0.0, 0.85, row).mul(0.28).add(0.74);
    return c.mul(shade);
  })();
  return mat;
}

function buildCityBlocks(scene) {
  const group = new THREE.Group();
  group.name = 'CityBuildings';
  const colliders = [];
  const quadtree = new CityQuadtree({ minX: CITY_BOUNDS.minX, maxX: CITY_BOUNDS.maxX, minZ: CITY_BOUNDS.minZ, maxZ: CITY_BOUNDS.maxZ }, 8, 9);
  const allBlocks = []; // per-building detail records the quadtree streams

  // Facade materials: [0] rendered houses & low blocks, [1] rendered offices & commercial (wider windows),
  // [2..4] curtain walls: blue-green, bronze, silver-blue
  const materials = [
    createRenderedFacadeMaterial({ windowWidth: 3.1, floorHeight: 3.4, windowRatioX: 0.44, windowRatioY: 0.48, seed: 13.0 }),
    createRenderedFacadeMaterial({ windowWidth: 2.4, floorHeight: 3.6, windowRatioX: 0.6, windowRatioY: 0.56, litProbability: 0.5, warmth: 0.6, seed: 29.0, cornerPier: 0.5 }),
    // (Toronto layer: the Commons palette's glass, its hue & chroma kept at the darkness the glass shader expects, as
    // aalghooneh/slop-toronto does: blue-grey condo glass with pale slab edges, the Financial District's dark teal-grey,
    // newer grey-green condo glass with white spandrels)
    createCurtainWallMaterial({ glassTint: 0x2a3744, frameTint: 0x9a9ea0, windowWidth: 1.6, floorHeight: 3.8, litProbability: 0.5, warmth: 0.55, reflectivity: 0.92, seed: 41.0, boxLocal: true }),
    createCurtainWallMaterial({ glassTint: 0x1e2326, frameTint: 0x3a3e40, windowWidth: 1.6, floorHeight: 3.8, litProbability: 0.5, warmth: 0.6, reflectivity: 0.9, seed: 57.0, boxLocal: true }),
    createCurtainWallMaterial({ glassTint: 0x3d4245, frameTint: 0xb4b8ba, windowWidth: 1.6, floorHeight: 3.8, litProbability: 0.5, warmth: 0.5, reflectivity: 0.94, seed: 73.0, boxLocal: true })
  ];
  const buckets = materials.map(() => []);
  const roofTiles = { pos: [], nor: [], uv: [], col: [] };
  const roofSheets = { pos: [], nor: [], uv: [], col: [] };

  const stats = { buildings: 0, boxes: 0, hip: 0, sheet: 0, glass: 0 };
  for (const b of GEO.buildings) {
    const [cx, cz, ang, parts, h, kind, roof, cseed, , name] = b;
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
    // material & paint
    let mat = 0;
    if (kind === 3) mat = 2 + Math.floor(rnd() * 3);
    else if (kind === 2) mat = rnd() < 0.35 ? 2 + Math.floor(rnd() * 3) : 1;
    const shopFront = kind === 2 || (kind === 1 && rnd() < 0.25);
    const faces = [WALL_KINDS.rear, WALL_KINDS.rear, WALL_KINDS.rear, WALL_KINDS.rear];
    faces[front] = shopFront ? WALL_KINDS.shop : WALL_KINDS.entry;
    // (Toronto layer: brick or render by kind, colours from the Commons palette)
    const brick = mat < 2 && rnd() < (BRICK_SHARE[kind] || 0);
    const paintHex = kind === 4 ? weighted(RAW_BLOCK, rnd()) : kind === 5 ? 0x9b9890 : brick ? weighted(TORONTO_MASONRY, rnd())
      : kind === 6 ? weighted(TORONTO_STONE, rnd()) : weighted(TORONTO_RENDER, rnd());
    const paint = [...linear(paintHex), (kind === 5 ? 0.95 : rnd()) + (brick ? 2 : 0)];
    const tone = rnd();
    let topY = 0;
    for (const [u0, u1, v0, v1] of parts) {
      const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
      const w = u1 - u0, d = v1 - v0;
      if (w < 1 || d < 1) continue;
      const x = cx + uc * cs + vc * sn;
      const z = cz - uc * sn + vc * cs;
      buckets[mat].push({ x, y: h / 2, z, w, h, d, ry: ang, faces, tone, paint });
      stats.boxes++;
      topY = h;
      if (roof === 1 && kind !== 3) {
        pushHipRoof(roofTiles, cx, cz, ang, u0, u1, v0, v1, h, (24 + rnd() * 8) * Math.PI / 180, 0.6, linear(weighted(ROOF_PAINT, rnd())));
        stats.hip++;
      } else if (roof === 2) {
        pushShedRoof(roofSheets, cx, cz, ang, u0, u1, v0, v1, h, linear(weighted(SHEET_PAINT, rnd())));
        stats.sheet++;
      }
      // player collider: the part's turned rectangle
      const hx = w / 2, hz = d / 2;
      const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
      colliders.push({ minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, maxY: h, obb: { cx: x, cz: z, hx, hz, cs, sn } });
    }
    if (mat >= 2) stats.glass++;
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
      const wall = lenOf(back) >= 4.6 ? back : undefined; // (side walls are often party walls in a row)
      if (nf >= 3 && nf <= 8 && wall !== undefined) {
        const landings = Math.min(nf - 1, 7);
        const count = lenOf(wall) >= 15 ? 2 : 1;
        for (let k = 0; k < count; k++) {
          const t = (k + 0.5) / count;
          const [fx, fz] = wall < 2
            ? local(wall === 0 ? u0 - 0.55 : u1 + 0.55, v0 + (v1 - v0) * t)
            : local(u0 + (u1 - u0) * t, wall === 2 ? v0 - 0.55 : v1 + 0.55);
          detail.fireEscapes.push({
            x: fx, y: storey + 0.1, z: fz, h: (landings - 1) * storey + 1, storey, landings, ry: ang,
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
      for (let k = 0; k < n; k++) {
        const side = [0, 1, 2, 3].filter((f) => f !== front)[Math.floor(rnd() * 3)];
        const floors = Math.max(1, Math.round((topY - 0.6) / 3.4));
        const y = Math.min(topY - 1.0, 0.6 + Math.floor(rnd() * floors) * 3.4 + 1.6);
        const t = 0.15 + rnd() * 0.7;
        let lu, lv, rot;
        if (side < 2) { lu = side === 0 ? u0 - 0.2 : u1 + 0.2; lv = v0 + (v1 - v0) * t; rot = side === 0 ? -Math.PI / 2 : Math.PI / 2; }
        else { lu = u0 + (u1 - u0) * t; lv = side === 2 ? v0 - 0.2 : v1 + 0.2; rot = side === 2 ? Math.PI : 0; }
        const [ax, az] = local(lu, lv);
        detail.acs.push({ x: ax, y, z: az, ry: ang + rot });
      }
      if (rnd() < 0.05) { // the odd satellite dish
        const [dx, dz] = local(u0 + (u1 - u0) * (0.1 + rnd() * 0.8), v0 + (v1 - v0) * (0.1 + rnd() * 0.8));
        detail.dishes.push({ x: dx, y: topY + (roof === 1 ? 0.2 : 0), z: dz, ry: rnd() * Math.PI * 2 });
      }
    }
    if (detail.tanks.length || detail.acs.length || detail.dishes.length || detail.fireEscapes.length) {
      quadtree.insert(detail);
      allBlocks.push(detail);
    }
  }

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
    console.info(`[buildings] ${stats.buildings} buildings, ${stats.boxes} boxes, ${stats.hip} hipped & ${stats.sheet} sheet roofs, ${stats.glass} in curtain wall`);
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
  // Wrought-iron fire escapes: real stairs & landings near the camera, masked boxes further out (fire-escapes.js)
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
    fireEscapeSystem.begin();
    for (const d of near) {
      for (const fe of d.fireEscapes || []) fireEscapeSystem.add(fe, fx, fz);
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
  return { group, colliders, quadtree, allBlocks, update, getActiveBlockCount: () => activeCount };
}

Object.assign(window.CITY, { CityQuadtree, buildCityBlocks });
})();
