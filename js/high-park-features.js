(function () {
// js/high-park-features.js
// High Park's features on its terrain (docs/high-park-features.md, bead st-5yps), from js/high-park-features-data.js
// (tools/build-high-park-features.mjs, OpenStreetMap):
// - the trails and paths: asphalt, earth, boardwalk, gravel and steps, laid on the lawn;
// - Hillside Gardens' beds, the sunken garden's three fountains in their hedges, the Maple Leaf bed, the Children's
//   Garden, the labyrinth, the allotments, the amphitheatre's terraces and the parking lots;
// - the zoo's paddocks along Deer Pen Road (worn ground, post-and-rail fences, bison, yaks, llamas, Highland cattle,
//   reindeer, capybaras), Dog Hill and the other off-leash areas (worn grass), the park's other fences and hedges;
// - Colborne Lodge (J. G. Howard's 1837 Regency picturesque cottage on its bluff: stucco, the wide three-sided bay to
//   the lake, its verandah, three chimneys) and the coach house beside it, procedural, on plinths where the ground falls;
// - the park roads closed to cars (closeHighParkRoads): the traffic keeps off them.
// The flat layers are built at the lawn's height and draped over the terrain pilot's surface (js/don-valley.js drape),
// like the park's own lawn; everything else stands on window.CITY.DON_VALLEY.heightAt. Outside High Park's box nothing
// is built or changed.
const C = window.CITY;
const F = C.HIGH_PARK_FEATURES;
if (!F) return;

const pairs = (f, from = 0) => { const p = []; for (let i = from; i + 1 < f.length; i += 2) p.push([f[i], f[i + 1]]); return p; };
const hash = (x, z, k) => { const h = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453; return h - Math.floor(h); };
const inRing = (ring, x, z) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};
const segDist = (x, z, ax, az, bx, bz) => {
  const ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L2));
  return Math.hypot(ax + ex * t - x, az + ez * t - z);
};
const bboxOf = (pts) => {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return { x0, x1, z0, z1 };
};
const areaOf = (pts) => { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };

// --- the data, unpacked
const PATHS = F.paths.map(([surf, w, ...f]) => ({ surf, w, pts: pairs(f) }));

// --- the natural trails' (surface 1, earth: OSM's dirt, ground, earth and unsurfaced paths) shape, shared by their
// material and js/park-cover.js. The mapped centreline and width stay the walkable corridor (walking, cycling and
// collision don't change); inside it the worn earth is a narrower single track, TRAIL.earth[0]-[1] times the mapped
// half width by a smooth field along the park (sums of sines, so the shader and the CPU agree to float precision),
// narrowest in the meadows, wider in the woods and at junctions (the shader's), its edge ragged. Short trodden grass
// fills the rest of the corridor, and the plants start at the corridor's edge, a margin from a tuft poking 0.15 m in
// to 0.45 m out by a second field. ?trails=0: the trails as before
const TRAIL = { on: new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('trails') !== '0', earth: [0.45, 0.8], woods: 0.25, junction: 0.2, rag: 0.12, ox: -6500, oz: -2000 };
/** 0..1, smooth over 30-70 m: how wide the worn earth runs here */
function trailWide(x, z) {
  const px = x - TRAIL.ox, pz = z - TRAIL.oz;
  const a = Math.sin(px * 0.21 + 1.3 * Math.sin(pz * 0.153)), b = Math.sin(pz * 0.17 + 1.1 * Math.sin(px * 0.137 + 0.7)), c = Math.sin((px + pz) * 0.091);
  return Math.max(0, Math.min(1, 0.5 + 0.22 * a + 0.18 * b + 0.1 * c));
}
/** 0..1, over 6-12 m: the plants' margin past the corridor's edge */
function trailMarginField(x, z) {
  const px = x - TRAIL.ox, pz = z - TRAIL.oz;
  return Math.max(0, Math.min(1, 0.5 + 0.3 * Math.sin(px * 0.71 + 1.7 * Math.sin(pz * 0.53)) + 0.2 * Math.sin(pz * 0.97 + 1.2 * Math.sin(px * 0.61))));
}
/** A natural trail's worn earth's half width (m) at (x, z) in the open, mapped width w (the woods and the junctions widen
 * it in the shader by up to TRAIL.woods + TRAIL.junction: at most 1.1 times the mapped one with its ragged edge) */
const trailHalfWidth = (x, z, w) => (w / 2) * (TRAIL.on ? TRAIL.earth[0] + (TRAIL.earth[1] - TRAIL.earth[0]) * trailWide(x, z) : 1);
/** Where the plants stop past a natural trail's centreline (m), its worn earth's half width `earthHalf` there: they grow
 * into the corridor (cards have no collision) to 0.1-0.3 m past the earth's edge, by the margin field */
const trailPlantEdge = (x, z, w, earthHalf = trailHalfWidth(x, z, w)) => (TRAIL.on ? earthHalf + 0.1 + 0.2 * trailMarginField(x, z) : w / 2 + 0.15);
/** The corridor's edge (m from the centreline): the shrubs (bulk the cyclist would see as blocking) keep out of it */
const trailCorridorEdge = (x, z, w) => w / 2 + 0.15;
// (the woods' floor under a point, as the trail material's floorAt: the woods data's ground cover, bilinear)
function floorAtCPU(x, z) {
  const PWk = C.parkWoods && C.parkWoods.parks[0];
  if (!PWk) return 0;
  const g = PWk.groundCover(), b = PWk.box;
  const fx = ((x - b.x0) / (b.x1 - b.x0)) * g.W - 0.5, fz = ((z - b.z0) / (b.z1 - b.z0)) * g.H - 0.5;
  const i = Math.max(0, Math.min(g.W - 2, Math.floor(fx))), j = Math.max(0, Math.min(g.H - 2, Math.floor(fz))), u = Math.max(0, Math.min(1, fx - i)), v = Math.max(0, Math.min(1, fz - j));
  const at = (ii, jj) => g.data[(jj * g.W + ii) * 4] / 255;
  return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
}
const sstep = (e0, e1, v) => { const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
/** A natural trail's worn earth's half width at its point k (and t of the way to k + 1), as its material draws it: the
 * open field, wider in the woods and near junctions */
function trailEarthAt(p, k, t, x, z) {
  const jn = trailJunctions(p), j = jn[k] + (jn[Math.min(jn.length - 1, k + 1)] - jn[k]) * t;
  return (p.w / 2) * (TRAIL.earth[0] + (TRAIL.earth[1] - TRAIL.earth[0]) * trailWide(x, z) + sstep(0.3, 0.8, floorAtCPU(x, z)) * TRAIL.woods + j * TRAIL.junction);
}
const JCACHE = new Map();
const trailJunctions = (p) => JCACHE.get(p) || JCACHE.set(p, junctionNear(p)).get(p);

const AREAS = F.areas.map(([kind, name, ...f]) => { const pts = pairs(f); return { kind: name === 'High Park Maple Leaf' ? 'leaf' : kind, name, pts, box: bboxOf(pts) }; });
const BARRIERS = (F.barriers || []).map(([kind, ...f]) => ({ kind, pts: pairs(f) }));
const BUILDINGS = new Map(F.buildings.map(([name, ...f]) => [name, pairs(f)]));

// --- what the park's trees keep clear of (street-details.js asks highParkFeatureAt): the buildings, the paved areas
// and beds, the fountains, the paths (each by its half width + `margin`); a 20 m grid of segments and areas
const KEEP = new Map(), KC = 20, kk = (i, j) => i * 100003 + j;
const keepAdd = (x0, x1, z0, z1, item) => {
  for (let i = Math.floor(x0 / KC); i <= Math.floor(x1 / KC); i++) for (let j = Math.floor(z0 / KC); j <= Math.floor(z1 / KC); j++) {
    const k = kk(i, j); (KEEP.get(k) || KEEP.set(k, []).get(k)).push(item);
  }
};
for (const p of PATHS) for (let i = 1; i < p.pts.length; i++) {
  const [ax, az] = p.pts[i - 1], [bx, bz] = p.pts[i], r = p.w / 2 + 3;
  keepAdd(Math.min(ax, bx) - r, Math.max(ax, bx) + r, Math.min(az, bz) - r, Math.max(az, bz) + r, { seg: [ax, az, bx, bz], r: p.w / 2 });
}
for (const a of AREAS) {
  if (!/^(bed|leaf|fountain|labyrinth|parking|amphitheatre|allotments|garden)$/.test(a.kind)) continue;
  keepAdd(a.box.x0 - 3, a.box.x1 + 3, a.box.z0 - 3, a.box.z1 + 3, { ring: a.pts, r: a.kind === 'fountain' ? 2.5 : 0.5 });
}
for (const ring of BUILDINGS.values()) { const b = bboxOf(ring); keepAdd(b.x0 - 8, b.x1 + 8, b.z0 - 8, b.z1 + 8, { ring, r: 4.5 }); }
/** Whether (x, z) is in (or within `margin` of) Colborne Lodge or its coach house (ez-trees.js: the City's inventory
 * stacks dozens of its park trees on the lodge's address point) */
function highParkBuildingAt(x, z, margin = 1) {
  for (const ring of BUILDINGS.values()) {
    if (inRing(ring, x, z)) return true;
    for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; if (segDist(x, z, a[0], a[1], b[0], b[1]) < margin) return true; }
  }
  return false;
}
/** Whether (x, z) is on (or within `margin` of) one of the park's paths, buildings, beds, fountains or paved areas */
function highParkFeatureAt(x, z, margin = 1) {
  for (const it of KEEP.get(kk(Math.floor(x / KC), Math.floor(z / KC))) || []) {
    if (it.seg) { if (segDist(x, z, ...it.seg) < it.r + margin) return true; continue; }
    if (inRing(it.ring, x, z)) return true;
    for (let i = 0; i < it.ring.length; i++) {
      const a = it.ring[i], b = it.ring[(i + 1) % it.ring.length];
      if (segDist(x, z, a[0], a[1], b[0], b[1]) < it.r + margin) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------------------
// Geometry helpers: non-indexed triangles with position, normal, uv (and colour)
// ---------------------------------------------------------------------------------------------------------------------
function makeBuf() { return { pos: [], nrm: [], uv: [], col: [] }; }
function triUp(B, a, b, c, y) {
  // a flat triangle facing up: (x, z, u, v) corners
  const cr = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
  if (Math.abs(cr) < 1e-8) return;
  const T = cr > 0 ? [a, b, c] : [a, c, b];
  for (const p of T) { B.pos.push(p[0], y, p[1]); B.nrm.push(0, 1, 0); B.uv.push(p[2] ?? p[0], p[3] ?? p[1]); }
}
function bufGeometry(B, withColor = false) {
  if (!B.pos.length) return null;
  const { THREE } = C;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nrm, 3));
  if (B.uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
  if (withColor) g.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
  g.computeBoundingSphere();
  return g;
}
// A face (3 or 4 corners, [x, y, z]) with its own flat normal and colour
function face(B, P, rgb) {
  const [a, b, c] = P;
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz);
  if (l < 1e-9) return;
  nx /= l; ny /= l; nz /= l;
  const tris = P.length === 4 ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 2]];
  for (const t of tris) for (const i of t) { B.pos.push(...P[i]); B.nrm.push(nx, ny, nz); B.uv.push(P[i][0] + P[i][2], P[i][1]); B.col.push(...rgb); }
}
const RGB = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255].map((c) => Math.pow(c, 2.2));
// A box: centre (x, y0 bottom, z), half sizes, yaw (about y)
function box(B, x, y0, z, hx, hy, hz, yaw, rgb, { top = true, bottom = false } = {}) {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const P = (u, v, w) => [x + u * cs + w * sn, y0 + v, z - u * sn + w * cs];
  const c = [P(-hx, 0, -hz), P(hx, 0, -hz), P(hx, 0, hz), P(-hx, 0, hz), P(-hx, 2 * hy, -hz), P(hx, 2 * hy, -hz), P(hx, 2 * hy, hz), P(-hx, 2 * hy, hz)];
  face(B, [c[0], c[4], c[5], c[1]], rgb); face(B, [c[1], c[5], c[6], c[2]], rgb); face(B, [c[2], c[6], c[7], c[3]], rgb); face(B, [c[3], c[7], c[4], c[0]], rgb);
  if (top) face(B, [c[4], c[7], c[6], c[5]], rgb);
  if (bottom) face(B, [c[0], c[1], c[2], c[3]], rgb);
}
// A wall between two points on the ground, from its foot (y = foot + y0) to y1, both faces when `both`
function ribbon(B, ax, az, bx, bz, ya0, ya1, yb0, yb1, rgb, both = false) {
  face(B, [[ax, ya0, az], [bx, yb0, bz], [bx, yb1, bz], [ax, ya1, az]], rgb);
  if (both) face(B, [[ax, ya0, az], [ax, ya1, az], [bx, yb1, bz], [bx, yb0, bz]], rgb);
}

// ---------------------------------------------------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------------------------------------------------
function materials() {
  const { THREE } = C;
  const T = C.TSL;
  const { Fn, float, vec2, vec3, color, mix, smoothstep, positionWorld, attribute, fract, floor, sin, dot, abs, length, max, min, step } = T;
  const U = C.cityUniforms;
  const snow = (c, amt = 1) => (C.snowOver ? C.snowOver(c, positionWorld.xz, float(amt)) : c);
  const grassy = (c) => (C.seasonalGrass ? C.seasonalGrass(c) : c);
  const hash2 = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));
  const noise = Fn(([p]) => {
    const i = floor(p).toVar(), f = fract(p).toVar(), u = f.mul(f).mul(float(3).sub(f.mul(2))).toVar();
    return mix(mix(hash2(i), hash2(i.add(vec2(1, 0))), u.x), mix(hash2(i.add(vec2(0, 1))), hash2(i.add(vec2(1, 1))), u.x), u.y);
  });
  const flat = (opts, colorFn, extra = {}) => {
    const m = new THREE.MeshStandardNodeMaterial({ metalness: 0, roughness: 0.92, ...opts });
    m.colorNode = Fn(colorFn)();
    m.polygonOffset = true; m.polygonOffsetFactor = extra.bias ?? -1; m.polygonOffsetUnits = extra.bias ?? -1;
    return m;
  };
  const M = {};
  // the paths: asphalt (worn grey, lighter edges), earth (packed brown with roots and grass at the edges), boardwalk
  // (planks across, along uv.x), gravel, and steps (treads every 0.32 m)
  M.paved = flat({ roughness: 0.9 }, () => {
    const wp = positionWorld.xz, n = noise(wp.mul(0.7)), m = noise(wp.mul(5.0));
    const edge = smoothstep(0.55, 1.0, abs(attribute('uv', 'vec2').y));
    return snow(mix(mix(color(0x4b4b48), color(0x5d5c57), n.mul(0.6).add(m.mul(0.4))), color(0x6b6a62), edge.mul(0.35)), 0.8);
  }, { bias: -2 });
  if (!TRAIL.on) M.earth = flat({ roughness: 0.97 }, () => {
    const wp = positionWorld.xz, n = noise(wp.mul(0.9)), m = noise(wp.mul(6.0));
    const edge = smoothstep(0.35, 1.0, abs(attribute('uv', 'vec2').y)).mul(m.mul(0.6).add(0.4));
    const soil = mix(color(0x6b5237), color(0x806648), n);
    return snow(mix(soil, grassy(vec3(0.07, 0.15, 0.05)), edge.mul(0.75)), 0.9);
  }, { bias: -2 });
  else M.earth = trailMaterial({ flat, noise, hash2, snow, grassy });
  M.boardwalk = flat({ roughness: 0.85 }, () => {
    const p = attribute('uv', 'vec2'), plank = fract(p.x.mul(1 / 0.16)), seam = smoothstep(0.0, 0.08, plank).mul(smoothstep(1.0, 0.92, plank));
    const n = hash2(floor(vec2(p.x.mul(1 / 0.16), 0)));
    return snow(mix(color(0x3d3024), mix(color(0x7a6347), color(0x917a5c), n), seam), 0.6);
  }, { bias: -2 });
  M.gravel = flat({ roughness: 0.98 }, () => {
    const wp = positionWorld.xz, g = hash2(floor(wp.mul(9.0))), n = noise(wp.mul(0.8));
    return snow(mix(mix(color(0x8c8273), color(0xa69c8b), g), color(0x7c7468), n.mul(0.4)), 0.9);
  }, { bias: -2 });
  M.steps = flat({ roughness: 0.9 }, () => {
    const p = attribute('uv', 'vec2'), t = fract(p.x.mul(1 / 0.32)), nose = smoothstep(0.82, 0.9, t);
    return snow(mix(color(0x8b867c), color(0x5a5650), nose), 0.7);
  }, { bias: -2 });
  // a bed of flowers: mulch, and flowers in 0.3 m clumps in the bed's palette while the season has them (uLeaf)
  const bedColor = (palette) => () => {
    const wp = positionWorld.xz, cell = floor(wp.mul(1 / 0.3)), h = hash2(cell), h2 = hash2(cell.add(vec2(17.0, 3.0)));
    const mulch = mix(color(0x3a2a1e), color(0x4d3826), noise(wp.mul(3.0)));
    const leaves = grassy(mix(vec3(0.05, 0.13, 0.04), vec3(0.09, 0.2, 0.06), h2));
    const bloom = palette(h);
    const on = U.uLeaf.mul(1.0); // (bare beds from late autumn to spring)
    const plant = step(0.25, h2).mul(on);
    const flower = step(0.45, h).mul(on);
    return snow(mix(mulch, mix(leaves, bloom, flower), plant), 1);
  };
  M.bed = flat({ roughness: 0.95 }, bedColor((h) => mix(mix(color(0xc8243a), color(0xf2c230), smoothstep(0.55, 0.7, h)), mix(color(0xb64aa8), color(0xf2efe6), smoothstep(0.85, 0.95, h)), smoothstep(0.75, 0.8, h))), { bias: -3 });
  // the Maple Leaf bed: one solid planting of red flowers (begonias), only a gentle variation of tone across it, bare
  // mulch out of season; and its border of clipped green edging along the leaf's outline (M.leafEdge)
  M.leaf = flat({ roughness: 0.9 }, () => {
    const wp = positionWorld.xz, n = noise(wp.mul(0.9)), m = noise(wp.mul(3.5));
    const red = mix(color(0xb3141b), color(0xd0241f), n.mul(0.6).add(m.mul(0.4)));
    return snow(mix(mix(color(0x3a2a1e), color(0x4d3826), m), red, U.uLeaf), 1);
  }, { bias: -3 });
  M.leafEdge = flat({ roughness: 0.9 }, () => {
    const m = noise(positionWorld.xz.mul(3.0));
    return snow(grassy(mix(vec3(0.06, 0.15, 0.04), vec3(0.08, 0.19, 0.05), m)), 1);
  }, { bias: -4 });
  // the gardens round the beds: clipped shrubs on mulch
  M.garden = flat({ roughness: 0.95 }, () => {
    const wp = positionWorld.xz, n = noise(wp.mul(0.9)), m = noise(wp.mul(4.0));
    const shrub = grassy(mix(vec3(0.045, 0.1, 0.035), vec3(0.08, 0.15, 0.05), m));
    return snow(mix(mix(color(0x3e2d20), color(0x4b3826), m), shrub, smoothstep(0.35, 0.55, n.mul(0.7).add(m.mul(0.3)))), 1);
  }, { bias: -2 });
  M.parking = flat({ roughness: 0.88 }, () => {
    const wp = positionWorld.xz, n = noise(wp.mul(0.5)), m = noise(wp.mul(6.0));
    return snow(mix(color(0x3f3f3d), color(0x51504c), n.mul(0.7).add(m.mul(0.3))), 1);
  }, { bias: -2 });
  // the allotments: plots of about 6 x 9 m in rows of crops or bare earth, by the season
  M.allotments = flat({ roughness: 0.96 }, () => {
    const wp = positionWorld.xz, plot = floor(vec2(wp.x.mul(1 / 6.0), wp.y.mul(1 / 9.0))), h = hash2(plot);
    const row = smoothstep(0.15, 0.45, sin(wp.y.mul(6.0).add(h.mul(6.0))).mul(0.5).add(0.5));
    const soil = mix(color(0x41372b), color(0x524636), noise(wp.mul(2.0)));
    const crop = grassy(mix(vec3(0.07, 0.17, 0.05), vec3(0.14, 0.24, 0.07), h));
    const edge = max(smoothstep(0.9, 0.97, fract(wp.x.mul(1 / 6.0))), smoothstep(0.92, 0.98, fract(wp.y.mul(1 / 9.0))));
    const grown = step(0.12, h).mul(U.uLeaf);
    return snow(mix(mix(soil, crop, row.mul(grown)), grassy(vec3(0.08, 0.16, 0.06)), edge), 1);
  }, { bias: -2 });
  // the worn ground of the paddocks and the off-leash areas: patches of bare earth and trampled grass over the lawn
  // (cut out: the lawn shows between them). The paddocks are grazed bare more than the dogs wear Dog Hill
  const worn = (cover, soilA, soilB) => {
    const m = flat({ roughness: 0.97 }, () => {
      const wp = positionWorld.xz, n = noise(wp.mul(0.27)), m2 = noise(wp.mul(1.3));
      return snow(mix(mix(color(soilA), color(soilB), noise(wp.mul(0.6))), grassy(vec3(0.11, 0.15, 0.05)), m2.mul(0.55).add(0.15)), 1);
    }, { bias: -1 });
    const wp = positionWorld.xz;
    m.maskNode = noise(wp.mul(0.27)).mul(0.65).add(noise(wp.mul(1.3)).mul(0.35)).lessThan(float(cover));
    return m;
  };
  M.zoo = worn(0.55, 0x4f3f2b, 0x66543a);
  M.dogs = worn(0.36, 0x6a5a3e, 0x7d6f4e);
  // the labyrinth (a seven-circuit path of stones in the lawn) and the amphitheatre's grassed terraces: rings round a
  // centre given per mesh
  M.rings = (cx, cz, kind) => flat({ roughness: 0.93 }, () => {
    const d = length(positionWorld.xz.sub(vec2(cx, cz)));
    if (kind === 'labyrinth') {
      const r = fract(d.mul(1 / 1.1)), line = smoothstep(0.72, 0.78, r).mul(smoothstep(0.96, 0.9, r));
      return snow(mix(grassy(vec3(0.08, 0.17, 0.06)), color(0x8f887a), line.mul(0.85)), 1);
    }
    const r = fract(d.mul(1 / 1.6)), riser = smoothstep(0.78, 0.86, r).mul(smoothstep(1.0, 0.94, r));
    return snow(mix(grassy(vec3(0.08, 0.16, 0.06)), color(0x9a9282), riser), 1);
  }, { bias: -2 });
  // the 3D pieces: vertex colours; the fences' chain-link a see-through grey; glass; the fountains' water
  M.solid = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  M.solidSnow = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
  // (roofs, hedges' tops: snow lies on what faces up)
  M.solidSnow.colorNode = Fn(() => {
    const c = attribute('color', 'vec3');
    return C.snowOver ? C.snowOver(c, positionWorld.xz, smoothstep(0.6, 0.95, T.normalWorld.y)) : c;
  })();
  M.mesh = new THREE.MeshStandardNodeMaterial({ color: 0x4a4d4f, roughness: 0.95, metalness: 0, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide });
  M.glass = new THREE.MeshStandardNodeMaterial({ color: 0x20272c, roughness: 0.12, metalness: 0.2 });
  M.water = new THREE.MeshStandardNodeMaterial({ color: 0x2f5a63, roughness: 0.06, metalness: 0.1 });
  M.spray = new THREE.MeshStandardNodeMaterial({ color: 0xe8f0f2, roughness: 0.4, transparent: true, opacity: 0.55, depthWrite: false });
  return M;
}

// The natural trails' worn earth (TRAIL) and the trodden grass round it, over a ribbon the width of the corridor and its
// margin: uv = (metres along, metres across), color = (the mapped half width, how near a junction 0..1). The earth: a
// darker compacted centre (two worn lines in stretches, ruts), lighter dusty edges, colour drifting along the trail,
// damp patches and puddles (darker and glossier), pebbles and stones to 15 cm, in the woods drifted litter and roots
// crossing the trail, grass tufts in the middle where it is narrowest. The phone tier keeps the outline, the centre and
// the edges, without the stones, roots, ruts and puddles
function trailMaterial({ flat, noise, hash2, snow, grassy }) {
  const T = C.TSL;
  const { float, vec2, vec3, color, mix, smoothstep, positionWorld, attribute, fract, floor, sin, abs, length, max, min, step, texture, select } = T;
  const LOW = (C.QUALITY || {}).tier === 'low';
  const wideNode = (wp) => {
    const px = wp.x.sub(TRAIL.ox), pz = wp.y.sub(TRAIL.oz);
    const a = sin(px.mul(0.21).add(sin(pz.mul(0.153)).mul(1.3))), b = sin(pz.mul(0.17).add(sin(px.mul(0.137).add(0.7)).mul(1.1))), c = sin(px.add(pz).mul(0.091));
    return a.mul(0.22).add(b.mul(0.18)).add(c.mul(0.1)).add(0.5).clamp(0, 1);
  };
  const marginNode = (wp) => {
    const px = wp.x.sub(TRAIL.ox), pz = wp.y.sub(TRAIL.oz);
    return sin(px.mul(0.71).add(sin(pz.mul(0.53)).mul(1.7))).mul(0.3).add(sin(pz.mul(0.97).add(sin(px.mul(0.61)).mul(1.2))).mul(0.2)).add(0.5).clamp(0, 1);
  };
  // (the woods' floor under the trail, park-woods.js: litter and roots only in the woods)
  const PWk = C.parkWoods && C.parkWoods.parks[0];
  const floorAt = (wp) => {
    if (!PWk) return float(0);
    const b = PWk.box, uv = wp.sub(vec2(b.x0, b.z0)).div(vec2(b.x1 - b.x0, b.z1 - b.z0));
    return texture(PWk.groundCover().texture, uv).r;
  };
  // the shape at a fragment: { s across (m, abs), h mapped half width, wide, fl woods, edgeD the earth's ragged edge,
  // plantEdge the corridor's ragged edge }
  const shape = () => {
    const wp = positionWorld.xz, uv = attribute('uv', 'vec2'), col = attribute('color', 'vec3'), h = col.x, junc = col.y;
    const wide = wideNode(wp), fl = floorAt(wp);
    const f = wide.mul(TRAIL.earth[1] - TRAIL.earth[0]).add(TRAIL.earth[0]).add(smoothstep(0.3, 0.8, fl).mul(TRAIL.woods)).add(junc.mul(TRAIL.junction));
    // (the edge's raggedness: slow, over 10-20 m, so the track doesn't pulse in width every few metres; a fine
    // ±3 cm break-up on top)
    const rag = noise(wp.mul(0.075)).mul(0.8).add(noise(wp.mul(0.19)).mul(0.2)).sub(0.5).mul(TRAIL.rag * 2).add(noise(wp.mul(9.0)).sub(0.5).mul(0.06));
    const hwE = h.mul(f), edgeD = hwE.add(rag).max(0.12);
    // (the short trodden grass round the earth, on under the low plants beside it, ragged: 0.8-1.35 m past its edge)
    const plantEdge = hwE.add(0.1).add(marginNode(wp).mul(0.2)).add(0.7).add(noise(wp.mul(3.7)).mul(0.35));
    return { wp, uv, s: abs(uv.y), along: uv.x, h, wide, fl, hwE, edgeD, plantEdge };
  };
  const m = flat({ roughness: 0.97 }, () => {
    const { wp, uv, s, along, wide, fl, hwE, edgeD } = shape();
    const t = s.div(edgeD); // (0 centre .. 1 the earth's edge)
    const n1 = noise(wp.mul(0.9)), n2 = noise(wp.mul(2.7)), drift = noise(wp.mul(0.06));
    let soil = mix(mix(color(0x5a432c), color(0x76593c), n1), mix(color(0x5c4f40), color(0x726252), n1), drift);
    // (mottled and cloddy: the trodden earth is never one colour; clods and cracks at 10-30 cm)
    const mott = noise(wp.mul(7.0)).mul(0.6).add(noise(wp.mul(17.0)).mul(0.4));
    const clod = noise(wp.mul(3.2)).mul(0.55).add(noise(wp.mul(31.0)).mul(0.45));
    soil = soil.mul(mott.sub(0.5).mul(0.3).add(1.0)).mul(clod.sub(0.5).mul(0.38).add(1.0));
    // (clods: darker lumps; grit: a 2 cm speckle, faded with distance as it would alias)
    soil = soil.mul(float(1).sub(smoothstep(0.5, 0.62, noise(wp.mul(4.3).add(9.0))).mul(0.2)));
    const grit = hash2(floor(wp.mul(45.0))).sub(0.5).mul(0.22).mul(float(1).sub(smoothstep(4.0, 12.0, length(T.cameraPosition.xz.sub(wp)))));
    soil = soil.mul(grit.add(1.0));
    // the worn, compacted centre (darker, cooler): one line, or in stretches two worn lines a stride apart
    const twin = smoothstep(0.5, 0.62, noise(wp.mul(0.045).add(3.1)));
    const wob = noise(wp.mul(0.9).add(4.0)).sub(0.5).mul(0.22);
    const single = float(1).sub(smoothstep(0.1, 0.42, t.add(wob)));
    const lines = float(1).sub(smoothstep(0.0, 0.2, abs(t.sub(0.42).add(wob))));
    const worn = mix(single, lines, twin);
    soil = mix(soil, soil.mul(vec3(0.62, 0.6, 0.62)), worn.mul(0.9));
    // the dusty edges
    soil = mix(soil, color(0x8c7656), smoothstep(0.55, 0.95, t).mul(0.5).mul(n2.mul(0.5).add(0.5)));
    let rough = float(0.97);
    if (!LOW) {
      // ruts (the worn lines sunk, darker and damper) and puddles in them, glossy
      const rut = worn.mul(smoothstep(0.45, 0.75, noise(wp.mul(0.21).add(7.0))));
      const puddle = smoothstep(0.66, 0.74, noise(wp.mul(0.5).add(1.7))).mul(worn).mul(smoothstep(0.4, 0.7, noise(wp.mul(0.11))));
      soil = mix(soil, soil.mul(vec3(0.55, 0.53, 0.52)), rut.mul(0.45));
      soil = mix(soil, vec3(0.06, 0.055, 0.05), puddle.mul(0.75));
      rough = mix(rough, 0.25, puddle).mul(float(1).sub(rut.mul(0.15)));
      // damp patches
      soil = mix(soil, soil.mul(vec3(0.8, 0.78, 0.76)), smoothstep(0.64, 0.74, noise(wp.mul(0.33))).mul(0.6));
      // stones: pebbles (0.25 m grid, 1.5-6 cm) and a few bigger ones (0.7 m grid, 5-15 cm), shaded: lit top, dark rim
      const stones = (cellM, rMin, rMax, dens, seed) => {
        const g = wp.div(cellM), cell = floor(g), hc = hash2(cell.add(seed)), hj = hash2(cell.add(vec2(7.0, 3.0)).add(seed));
        const c0 = vec2(hj, fract(hj.mul(13.7))).mul(0.5).add(0.25), off = fract(g).sub(c0).mul(cellM);
        const ang = T.atan(off.y, off.x), wb = sin(ang.mul(3.0).add(hc.mul(20.0))).mul(0.2).add(sin(ang.mul(5.0).add(hj.mul(9.0))).mul(0.1)).add(1.0);
        const r = fract(hc.mul(7.3)).pow(1.5).mul(rMax - rMin).add(rMin).mul(wb), d = length(off);
        const on = step(hc, dens);
        const body = on.mul(float(1).sub(smoothstep(r.mul(0.85), r, d)));
        const rim = on.mul(smoothstep(r.mul(0.6), r.mul(0.95), d)).mul(body);
        const lit = on.mul(smoothstep(0.0, r, off.x.add(off.y).mul(-0.7)).mul(body));
        const grey = mix(mix(color(0x5d584f), color(0x7c7568), fract(hc.mul(31.7))), color(0x6e6252), fract(hc.mul(5.1)).mul(0.5));
        return { body, c: grey.mul(rim.mul(-0.45).add(1)).mul(lit.mul(0.18).add(1)) };
      };
      const peb = stones(0.22, 0.008, 0.03, t.mul(0.3).add(0.15), vec2(0, 0));
      soil = mix(soil, peb.c, peb.body.mul(0.85));
      const big = stones(0.6, 0.025, 0.075, t.mul(0.2).add(0.14), vec2(41, 17));
      soil = mix(soil, big.c, big.body);
      // roots crossing the trail in the woods: one every 2-6 m in stretches, wavering across, raised (lit edge)
      const cellA = floor(along.div(2.5)), ha = hash2(vec2(cellA, 3.0)), hb = hash2(vec2(cellA, 9.0));
      const a0 = cellA.add(ha.mul(0.7).add(0.15)).mul(2.5);
      const rx = along.sub(a0).sub(sin(uv.y.mul(2.3).add(hb.mul(6.0))).mul(0.25)).sub(uv.y.mul(hb.sub(0.5).mul(0.8)));
      const rw = hb.mul(0.035).add(0.025);
      const rootOn = step(0.45, ha).mul(smoothstep(0.45, 0.75, fl)).mul(step(0.4, noise(wp.mul(0.09))));
      const root = rootOn.mul(float(1).sub(smoothstep(rw.mul(0.6), rw, abs(rx))));
      const rootLit = rootOn.mul(float(1).sub(smoothstep(0.0, rw.mul(0.5), abs(rx.add(rw.mul(0.35))))));
      soil = mix(soil, mix(color(0x4a3725), color(0x7a6045), rootLit.mul(0.6)), root.mul(0.9));
      // leaf litter drifted onto the trail in the woods, most at its edges
      const litter = mix(color(0x765838), color(0x8f6c40), noise(wp.mul(3.3)));
      soil = mix(soil, litter, fl.mul(smoothstep(0.2, 1.0, t).mul(0.6).add(0.1)).mul(smoothstep(0.35, 0.6, noise(wp.mul(1.6)))).mul(float(1).sub(root)));
    } else {
      soil = mix(soil, color(0x765838), fl.mul(t).mul(0.35));
    }
    soil = mix(soil, soil.mul(1.08), smoothstep(0.7, 1.0, t).mul(0.5));
    // the trodden grass: short grass, blades in streaks, the soil showing through in patches; a shade darker than the
    // open lawn (the plants' shade)
    const blades = noise(vec2(wp.x.mul(9.0), wp.y.mul(9.0)).add(n2.mul(3.0))).mul(0.6).add(noise(wp.mul(23.0)).mul(0.4));
    // (dark green and olive, dry yellower blades in streaks: the meadow's own grass, short)
    const sward0 = mix(mix(color(0x34481b), color(0x4d6526), blades), color(0x6c6c34), smoothstep(0.55, 0.9, noise(wp.mul(5.5).add(2.0))).mul(0.7));
    const sward = grassy(mix(sward0, color(0x5b6a2a), noise(wp.mul(1.3)).mul(0.35)));
    const margin = mix(sward, soil.mul(0.85), smoothstep(0.62, 0.82, noise(wp.mul(3.1))).mul(0.35));
    // the earth's edge bitten into by tufts, and tufts in the middle where it is narrowest
    const tuftE = noise(wp.mul(4.1)).mul(0.6).add(noise(wp.mul(12.0)).mul(0.4));
    const midTuft = float(1).sub(smoothstep(0.0, 0.28, wide)).mul(step(0.62, tuftE)).mul(float(1).sub(smoothstep(0.05, 0.22, s)));
    const inEarth = s.lessThan(edgeD.sub(tuftE.mul(0.1))).and(midTuft.lessThan(0.5));
    void hwE;
    return snow(select(inEarth, soil, margin), 0.9);
  }, { bias: -1 });
  if (!LOW) m.roughnessNode = T.Fn(() => {
    const { wp, s, edgeD } = shape();
    const t = s.div(edgeD), n2 = noise(wp.mul(2.7));
    const twin = smoothstep(0.5, 0.62, noise(wp.mul(0.045).add(3.1))), wob = n2.sub(0.5).mul(0.25);
    const worn = mix(float(1).sub(smoothstep(0.1, 0.42, t.add(wob))), float(1).sub(smoothstep(0.0, 0.2, abs(t.sub(0.42).add(wob)))), twin);
    const puddle = smoothstep(0.66, 0.74, noise(wp.mul(0.5).add(1.7))).mul(worn).mul(smoothstep(0.4, 0.7, noise(wp.mul(0.11)))).mul(step(t, 1.0));
    return mix(float(0.97), float(0.22), puddle);
  })();
  // (cut to the corridor's ragged edge, where the plants start)
  m.maskNode = T.Fn(() => { const { s, plantEdge } = shape(); return s.lessThan(plantEdge); })();
  m.name = 'HighParkTrailEarth';
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------
// The flat layers: paths and areas at the lawn's height, draped
// ---------------------------------------------------------------------------------------------------------------------
const SURF_NAMES = ['paved', 'earth', 'boardwalk', 'gravel', 'steps'];
// How near each point of path p is to a junction (another path's point within 2.5 m), 1 at it, 0 from 6 m along
let JGRID = null;
function junctionNear(p) {
  if (!JGRID) {
    JGRID = new Map();
    PATHS.forEach((q, qi) => q.pts.forEach(([x, z]) => { const k = Math.floor(x / 4) * 100003 + Math.floor(z / 4); (JGRID.get(k) || JGRID.set(k, []).get(k)).push([x, z, qi]); }));
  }
  const me = PATHS.indexOf(p), at = p.pts.map(([x, z]) => {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const [qx, qz, qi] of JGRID.get((Math.floor(x / 4) + a) * 100003 + Math.floor(z / 4) + b) || []) if (qi !== me && (qx - x) ** 2 + (qz - z) ** 2 < 6.25) return true;
    return false;
  });
  // (falling off along the path over 6 m from a junction)
  const along = [0]; for (let i = 1; i < p.pts.length; i++) along.push(along[i - 1] + Math.hypot(p.pts[i][0] - p.pts[i - 1][0], p.pts[i][1] - p.pts[i - 1][1]));
  const js = along.filter((_, i) => at[i]);
  return along.map((a) => { let d = Infinity; for (const j of js) d = Math.min(d, Math.abs(a - j)); return Math.max(0, 1 - d / 6); });
}
function flatLayers(group, M, top) {
  const { THREE } = C;
  const stats = { triangles: 0, meshes: 0 };
  const add = (B, mat, name) => {
    const g = bufGeometry(B);
    if (!g) return null;
    const m = new THREE.Mesh(g, mat);
    m.name = name; m.receiveShadow = true; m.castShadow = false;
    group.add(m);
    return m;
  };
  // paths: each segment a quad run on by half its width at each end (so the runs' corners close); uv: (metres along,
  // across in half widths)
  const bySurf = SURF_NAMES.map(() => makeBuf());
  for (const p of PATHS) {
    const B = bySurf[p.surf] || bySurf[0], y = top + 0.05 + (p.surf === 0 ? 0.005 : 0);
    // (a natural trail's ribbon: as wide as its worn earth can get, uv.y in metres across, its mapped half width in the
    // vertex colour: trailMaterial cuts it to the trail's outline)
    const natural = TRAIL.on && p.surf === 1, h = natural ? (p.w / 2) * 1.25 + 1.3 : p.w / 2, vs = natural ? h : 1;
    const junc = natural ? trailJunctions(p) : null;
    let along = 0;
    for (let i = 1; i < p.pts.length; i++) {
      const [ax0, az0] = p.pts[i - 1], [bx0, bz0] = p.pts[i], L = Math.hypot(bx0 - ax0, bz0 - az0);
      if (L < 0.05) continue;
      const ux = (bx0 - ax0) / L, uz = (bz0 - az0) / L, ext = i === 1 ? 0 : Math.min(h, 1.2), ext2 = i === p.pts.length - 1 ? 0 : Math.min(h, 1.2);
      const ax = ax0 - ux * ext, az = az0 - uz * ext, bx = bx0 + ux * ext2, bz = bz0 + uz * ext2;
      const a0 = along - ext, a1 = along + L + ext2;
      const q = [[ax + uz * h, az - ux * h, a0, -vs], [bx + uz * h, bz - ux * h, a1, -vs], [bx - uz * h, bz + ux * h, a1, vs], [ax - uz * h, az + ux * h, a0, vs]];
      triUp(B, q[0], q[1], q[2], y); triUp(B, q[0], q[2], q[3], y);
      if (natural) {
        // (the quad's corners: a and b ends' junction nearness; triUp wrote 6 vertices: q0 q1 q2, q0 q2 q3 in some order)
        const n0 = B.col.length / 3, ja = junc[i - 1], jb = junc[i];
        for (let v = n0; v < B.pos.length / 3; v++) {
          const vx = B.pos[v * 3], vz = B.pos[v * 3 + 2], da = (vx - ax0) ** 2 + (vz - az0) ** 2, db = (vx - bx0) ** 2 + (vz - bz0) ** 2;
          B.col.push(p.w / 2, da < db ? ja : jb, 0);
        }
      }
      along += L;
    }
  }
  bySurf.forEach((B, s) => {
    if (s === 1 && TRAIL.on && B.pos.length) {
      const g = bufGeometry(B, true), m = new C.THREE.Mesh(g, M.earth);
      m.name = 'HighParkPaths_earth'; m.receiveShadow = true; m.castShadow = false; group.add(m);
      return;
    }
    add(B, M[SURF_NAMES[s]], `HighParkPaths_${SURF_NAMES[s]}`);
  });
  // areas: triangulated outlines at their layer's height
  const LAYER = { zoo: 0.03, dogs: 0.03, garden: 0.04, allotments: 0.04, parking: 0.045, amphitheatre: 0.04, labyrinth: 0.045, bed: 0.065, leaf: 0.065 };
  const byKind = new Map();
  for (const a of AREAS) {
    if (!(a.kind in LAYER)) continue;
    const pts = areaOf(a.pts) < 0 ? a.pts.slice().reverse() : a.pts;
    const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const key = a.kind === 'labyrinth' || a.kind === 'amphitheatre' ? `${a.kind}:${byKind.size}` : a.kind;
    if (!byKind.has(key)) byKind.set(key, { B: makeBuf(), a });
    const { B } = byKind.get(key);
    // (the paddocks, off-leash areas and allotments span the park roads between the islands: their triangles split to
    // 2 m and kept on the island's lawn only, off the roadway and its sidewalks)
    const onLawn = (x, z) => { const bl = C.blockAt(x, z); return !!bl && bl.park > 0.6 && !C.waterAt(x, z); };
    const split = (p, q, r, d = 0) => {
      const L = Math.max(Math.hypot(p[0] - q[0], p[1] - q[1]), Math.hypot(q[0] - r[0], q[1] - r[1]), Math.hypot(r[0] - p[0], r[1] - p[1]));
      // (whole where it lies on the lawn throughout, sampled every 3 m; else split towards the kerb)
      const n = Math.max(1, Math.ceil(L / 3));
      let all = true;
      for (let u = 0; u <= n && all; u++) for (let v = 0; u + v <= n && all; v++) {
        const w = n - u - v;
        if (!onLawn((p[0] * u + q[0] * v + r[0] * w) / n, (p[1] * u + q[1] * v + r[1] * w) / n)) all = false;
      }
      if (all) { triUp(B, p, q, r, top + LAYER[a.kind]); return; }
      if (L <= 2.5 || d > 14) {
        if (onLawn((p[0] + q[0] + r[0]) / 3, (p[1] + q[1] + r[1]) / 3)) triUp(B, p, q, r, top + LAYER[a.kind]);
        return;
      }
      // (halve the longest edge)
      const e = [[p, q, r], [q, r, p], [r, p, q]].sort((u, v) => Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1]) - Math.hypot(u[0][0] - u[1][0], u[0][1] - u[1][1]))[0];
      const m = [(e[0][0] + e[1][0]) / 2, (e[0][1] + e[1][1]) / 2];
      split(e[0], m, e[2], d + 1); split(m, e[1], e[2], d + 1);
    };
    const crossesRoads = /^(zoo|dogs|allotments)$/.test(a.kind);
    for (const [i, j, k] of tris) {
      if (crossesRoads) split(pts[i], pts[j], pts[k]);
      else triUp(B, pts[i], pts[j], pts[k], top + LAYER[a.kind]);
    }
  }
  // the Maple Leaf's border: a 0.45 m strip along its outline (half in, half out), over the fill
  for (const a of AREAS) {
    if (a.kind !== 'leaf') continue;
    const E = makeBuf(), hw = 0.225, y = top + LAYER.leaf + 0.006;
    for (let i = 0; i < a.pts.length; i++) {
      const [ax, az] = a.pts[i], [bx, bz] = a.pts[(i + 1) % a.pts.length], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.02) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L, sx = ax - ux * hw, sz = az - uz * hw, ex = bx + ux * hw, ez = bz + uz * hw;
      const q = [[sx + uz * hw, sz - ux * hw], [ex + uz * hw, ez - ux * hw], [ex - uz * hw, ez + ux * hw], [sx - uz * hw, sz + ux * hw]];
      triUp(E, q[0], q[1], q[2], y); triUp(E, q[0], q[2], q[3], y);
    }
    add(E, M.leafEdge, 'HighPark_leafEdge');
  }
  for (const [key, { B, a }] of byKind) {
    const kind = key.split(':')[0];
    let mat = M[kind];
    if (kind === 'labyrinth') { const [cx, cz] = a.pts.reduce((s, p) => [s[0] + p[0] / a.pts.length, s[1] + p[1] / a.pts.length], [0, 0]); mat = M.rings(cx, cz, 'labyrinth'); }
    if (kind === 'amphitheatre') {
      // (the stage: the outline's lowest point; the terraces rise from it)
      let lo = a.pts[0], h = Infinity;
      for (const p of a.pts) { const g = C.DON_VALLEY.heightAt(p[0], p[1]); if (g < h) { h = g; lo = p; } }
      mat = M.rings(lo[0], lo[1], 'amphitheatre');
    }
    add(B, mat, `HighPark_${kind}`);
  }
  // drape them onto the surface, as the park's lawn
  const st = C.DON_VALLEY.drape(group);
  group.traverse((o) => { if (o.isMesh && o.visible && o.geometry) { const g = o.geometry; const n = (g.index ? g.index.count : g.attributes.position.count) / 3; if (n) { stats.triangles += n; stats.meshes++; } } });
  stats.drape = { pieces: st.pieces, source: st.triangles };
  return stats;
}

// ---------------------------------------------------------------------------------------------------------------------
// Fences, railings, hedges and walls, standing on the ground
// ---------------------------------------------------------------------------------------------------------------------
function barriers(group, M, top) {
  const { THREE } = C;
  const solid = makeBuf(), green = makeBuf(), mesh = makeBuf();
  const GALV = RGB(0x8d9092), WOOD = RGB(0x6b5136), RAIL = RGB(0x2f3233), HEDGE = RGB(0x4f7a3c), HEDGE_TOP = RGB(0x5f8c45), STONE = RGB(0x8d877b);
  let posts = 0;
  for (const b of BARRIERS) {
    // the line in pieces of at most `step` m, each end on the ground
    const step = b.kind === 4 ? 2.6 : b.kind === 2 || b.kind === 3 ? 2 : 3.5;
    const pts = [];
    for (let i = 1; i < b.pts.length; i++) {
      const [ax, az] = b.pts[i - 1], [bx, bz] = b.pts[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
      for (let k = i === 1 ? 0 : 1; k <= n; k++) pts.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
    }
    const g = pts.map(([x, z]) => top(x, z) - 0.03);
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i], y = g[i];
      const yaw = i + 1 < pts.length ? Math.atan2(pts[i + 1][0] - x, pts[i + 1][1] - z) : i > 0 ? Math.atan2(x - pts[i - 1][0], z - pts[i - 1][1]) : 0;
      // (the metal posts' caps are a few square centimetres: left out)
      if (b.kind === 0) { box(solid, x, y, z, 0.03, 0.62, 0.03, yaw, GALV, { top: false }); posts++; }
      else if (b.kind === 1) { box(solid, x, y, z, 0.025, 0.52, 0.025, yaw, RAIL, { top: false }); posts++; }
      else if (b.kind === 4) { box(solid, x, y, z, 0.07, 0.75, 0.07, yaw, WOOD); posts++; }
      if (i === 0) continue;
      const [ax, az] = pts[i - 1], ya = g[i - 1];
      if (b.kind === 0) {
        ribbon(solid, ax, az, x, z, ya + 1.18, ya + 1.24, y + 1.18, y + 1.24, GALV, true);
        ribbon(mesh, ax, az, x, z, ya + 0.02, ya + 1.2, y + 0.02, y + 1.2, GALV);
      } else if (b.kind === 1) {
        for (const h of [0.5, 0.98]) ribbon(solid, ax, az, x, z, ya + h, ya + h + 0.05, y + h, y + h + 0.05, RAIL, true);
      } else if (b.kind === 4) {
        for (const h of [0.35, 0.8, 1.25]) ribbon(solid, ax, az, x, z, ya + h, ya + h + 0.14, y + h, y + h + 0.14, WOOD, true);
        ribbon(mesh, ax, az, x, z, ya + 0.02, ya + 1.4, y + 0.02, y + 1.4, GALV);
      } else {
        // a hedge (0.9 m, 0.7 m wide) or a low stone wall (0.55 m, 0.4 m): a box along the piece
        const hw = b.kind === 2 ? 0.35 : 0.2, H = b.kind === 2 ? 0.9 : 0.55, B = b.kind === 2 ? green : solid, side = b.kind === 2 ? HEDGE : STONE, topc = b.kind === 2 ? HEDGE_TOP : STONE;
        const L = Math.hypot(x - ax, z - az) || 1, nx = (z - az) / L * hw, nz = -(x - ax) / L * hw;
        const A0 = [ax + nx, ya, az + nz], A1 = [ax - nx, ya, az - nz], B0 = [x + nx, y, z + nz], B1 = [x - nx, y, z - nz];
        const up = (p, h) => [p[0], p[1] + h, p[2]];
        face(B, [B0, A0, up(A0, H), up(B0, H)], side);
        face(B, [A1, B1, up(B1, H), up(A1, H)], side);
        face(B, [up(A0, H), up(A1, H), up(B1, H), up(B0, H)], topc);
        if (i === 1) face(B, [A0, A1, up(A1, H), up(A0, H)], side);
        if (i === pts.length - 1) face(B, [B1, B0, up(B0, H), up(B1, H)], side);
      }
    }
  }
  const out = [];
  for (const [B, mat, name, cast] of [[solid, M.solid, 'HighParkFences', false], [green, M.solidSnow, 'HighParkHedges', true], [mesh, M.mesh, 'HighParkFenceMesh', false]]) {
    const g = bufGeometry(B, true);
    if (!g) continue;
    const m = new THREE.Mesh(g, mat);
    m.name = name; m.castShadow = cast; m.receiveShadow = true;
    m.userData.cullDistance = name === 'HighParkHedges' ? 900 : 650;
    group.add(m); out.push(m);
  }
  return { posts, meshes: out };
}

// ---------------------------------------------------------------------------------------------------------------------
// The sunken garden's fountains: a stone basin (its rim over the highest ground round it), water, and a jet
// ---------------------------------------------------------------------------------------------------------------------
function fountains(group, M, top, colliders) {
  const { THREE } = C;
  const stone = makeBuf(), water = makeBuf(), spray = makeBuf();
  const RIM = RGB(0xa49d8e), INNER = RGB(0x6f6a60);
  let n = 0;
  for (const a of AREAS) {
    if (a.kind !== 'fountain') continue;
    const pts = areaOf(a.pts) < 0 ? a.pts.slice().reverse() : a.pts;
    let hi = -Infinity, lo = Infinity, cx = 0, cz = 0;
    for (const [x, z] of pts) { hi = Math.max(hi, top(x, z)); lo = Math.min(lo, top(x, z)); cx += x / pts.length; cz += z / pts.length; }
    const rimY = hi + 0.45, wY = rimY - 0.14, foot = lo - 0.1;
    // (the rim: 0.3 m wide, outside the outline)
    const out = pts.map(([x, z]) => { const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz) || 1; return [x + (dx / l) * 0.3, z + (dz / l) * 0.3]; });
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length, [ax, az] = pts[i], [bx, bz] = pts[j], [ox, oz] = out[i], [px, pz] = out[j];
      face(stone, [[px, foot, pz], [ox, foot, oz], [ox, rimY, oz], [px, rimY, pz]], RIM); // (outer face)
      face(stone, [[ax, rimY, az], [bx, rimY, bz], [px, rimY, pz], [ox, rimY, oz]], RIM); // (coping)
      face(stone, [[ax, wY - 0.5, az], [bx, wY - 0.5, bz], [bx, rimY, bz], [ax, rimY, az]], INNER); // (inner face)
    }
    const B = makeBuf();
    for (let i = 1; i + 1 < pts.length; i++) triUp(B, pts[0], pts[i], pts[i + 1], wY);
    water.pos.push(...B.pos); water.nrm.push(...B.nrm); water.uv.push(...B.uv);
    // the jet: a tapering column of spray and its fall
    const jet = new THREE.CylinderGeometry(0.05, 0.16, 1.6, 8, 1, true).translate(cx, wY + 0.8, cz).toNonIndexed();
    const fall = new THREE.ConeGeometry(0.7, 0.5, 12, 1, true).translate(cx, wY + 0.3, cz).toNonIndexed();
    for (const g of [jet, fall]) { spray.pos.push(...g.attributes.position.array); spray.nrm.push(...g.attributes.normal.array); spray.uv.push(...g.attributes.uv.array); }
    const bb = bboxOf(out);
    colliders.push({ minX: bb.x0, maxX: bb.x1, minZ: bb.z0, maxZ: bb.z1, maxY: rimY, polygon: out.map(([x, z]) => ({ x, z })) });
    n++;
  }
  for (const [B, mat, name, col] of [[stone, M.solid, 'HighParkFountainBasins', true], [water, M.water, 'HighParkFountainWater', false], [spray, M.spray, 'HighParkFountainJets', false]]) {
    const g = bufGeometry(B, col);
    if (!g) continue;
    const m = new THREE.Mesh(g, mat);
    m.name = name; m.receiveShadow = true; m.castShadow = name === 'HighParkFountainBasins';
    m.userData.cullDistance = 500;
    group.add(m);
  }
  return n;
}

// ---------------------------------------------------------------------------------------------------------------------
// Hipped roofs: over a convex eave outline, each plane rising at `pitch` from its edge; the roof is their lower envelope,
// so each plane's facet is the outline clipped by the half-planes where it is the lowest (exact for any convex outline)
// ---------------------------------------------------------------------------------------------------------------------
function hipRoof(B, ring, y0, pitch, rgb) {
  const P = areaOf(ring) < 0 ? ring.slice().reverse() : ring; // (counter-clockwise in (x, z): the inside is to the left)
  const planes = P.map((a, i) => {
    const b = P[(i + 1) % P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L; // (inward normal for a counter-clockwise ring in x, z... see below)
    return { a, nx, nz };
  });
  // (make each normal point into the polygon: the centroid must be at a positive distance)
  const cx = P.reduce((s, p) => s + p[0], 0) / P.length, cz = P.reduce((s, p) => s + p[1], 0) / P.length;
  for (const pl of planes) if ((cx - pl.a[0]) * pl.nx + (cz - pl.a[1]) * pl.nz < 0) { pl.nx = -pl.nx; pl.nz = -pl.nz; }
  const h = (pl, x, z) => ((x - pl.a[0]) * pl.nx + (z - pl.a[1]) * pl.nz) * pitch;
  const clipHalf = (poly, f) => { // keep f(x, z) <= 0, f linear
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], fp = f(p[0], p[1]), fq = f(q[0], q[1]);
      if (fp <= 0) out.push(p);
      if ((fp <= 0) !== (fq <= 0)) { const t = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
    return out;
  };
  let ridge = 0;
  for (const pl of planes) {
    let poly = P.slice();
    for (const o of planes) if (o !== pl) poly = clipHalf(poly, (x, z) => h(pl, x, z) - h(o, x, z));
    if (poly.length < 3) continue;
    for (let i = 1; i + 1 < poly.length; i++) {
      const A = poly[0], Bq = poly[i], Cq = poly[i + 1];
      const corner = (p) => { const y = y0 + h(pl, p[0], p[1]); ridge = Math.max(ridge, y); return [p[0], y, p[1]]; };
      // (face up: counter-clockwise seen from above)
      const cr = (Bq[1] - A[1]) * (Cq[0] - A[0]) - (Bq[0] - A[0]) * (Cq[1] - A[1]);
      face(B, cr > 0 ? [corner(A), corner(Bq), corner(Cq)] : [corner(A), corner(Cq), corner(Bq)], rgb);
    }
  }
  // the soffit under the overhang is left open (the walls' tops close the eaves from below)
  return { ridge, heightAt: (x, z) => y0 + Math.min(...planes.map((pl) => h(pl, x, z))) };
}
// An outline offset outward by d (a convex or mildly concave ring; mitred corners)
function offsetRing(ring, d) {
  const P = areaOf(ring) < 0 ? ring.slice().reverse() : ring, n = P.length;
  return P.map((p, i) => {
    const a = P[(i - 1 + n) % n], b = P[(i + 1) % n];
    const e1 = [p[0] - a[0], p[1] - a[1]], e2 = [b[0] - p[0], b[1] - p[1]], l1 = Math.hypot(...e1), l2 = Math.hypot(...e2);
    // (outward normals of a counter-clockwise ring in (x, z), with z down the screen: (dz, -dx))
    const n1 = [e1[1] / l1, -e1[0] / l1], n2 = [e2[1] / l2, -e2[0] / l2];
    const m = [n1[0] + n2[0], n1[1] + n2[1]], ml = Math.hypot(...m) || 1, k = d / Math.max(0.35, (m[0] * n1[0] + m[1] * n1[1]) / ml);
    return [p[0] + (m[0] / ml) * k, p[1] + (m[1] / ml) * k];
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Colborne Lodge and the coach house
// ---------------------------------------------------------------------------------------------------------------------
const STUCCO = RGB(0xdccfae), TRIM = RGB(0xf1eee6), SHUTTER = RGB(0x2e4636), SHINGLE = RGB(0x5f5650), TIN = RGB(0x56635a), BRICK = RGB(0x86513c), PLINTH = RGB(0x8e8778), DECK = RGB(0x7d7466), DOOR = RGB(0x2b3f31);
// Walls of a ring from y0 to y1 (outward faces), and windows on them: `win(edge, i, n)` decides
function walls(B, ring, y0, y1, rgb) {
  const P = areaOf(ring) < 0 ? ring.slice().reverse() : ring;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    // (counter-clockwise in (x, z) seen with z down: the outward face winds a -> b along the bottom)
    face(B, [[b[0], y0, b[1]], [a[0], y0, a[1]], [a[0], y1, a[1]], [b[0], y1, b[1]]], rgb);
  }
  return P;
}
// A window (or door) on the wall a -> b of a counter-clockwise ring, centred at t along it, sill at y, w x h: the glass
// just proud of the stucco, a frame round it, green shutters either side
function opening(B, G, a, b, t, y, w, h, door = false) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
  const ox = uz, oz = -ux; // (outward)
  const c = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const P = (u, v, o) => [c[0] + ux * u + ox * o, y + v, c[1] + uz * u + oz * o];
  const hw = w / 2;
  face(door ? B : G, [P(hw, 0, 0.03), P(-hw, 0, 0.03), P(-hw, h, 0.03), P(hw, h, 0.03)], door ? DOOR : [0, 0, 0]);
  const f = 0.09;
  for (const [u0, u1, v0, v1] of [[-hw - f, hw + f, h, h + f], [-hw - f, hw + f, -f, 0], [-hw - f, -hw, 0, h], [hw, hw + f, 0, h]]) face(B, [P(u1, v0, 0.05), P(u0, v0, 0.05), P(u0, v1, 0.05), P(u1, v1, 0.05)], TRIM);
  if (!door) for (const s of [-1, 1]) { const u0 = s * (hw + f), u1 = s * (hw + f + w * 0.5); face(B, s > 0 ? [P(u1, 0, 0.06), P(u0, 0, 0.06), P(u0, h, 0.06), P(u1, h, 0.06)] : [P(u0, 0, 0.06), P(u1, 0, 0.06), P(u1, h, 0.06), P(u0, h, 0.06)], SHUTTER); }
}
function chimney(B, x, z, y0, y1, yaw) {
  box(B, x, y0, z, 0.45, (y1 - y0) / 2, 0.6, yaw, BRICK);
  box(B, x, y1, z, 0.55, 0.08, 0.7, yaw, PLINTH);
  for (const s of [-0.25, 0.25]) box(B, x + Math.cos(yaw) * s, y1 + 0.16, z - Math.sin(yaw) * s, 0.11, 0.2, 0.11, yaw, RGB(0x8a5a42));
}
// The footing: the plinth from the lowest ground under a ring up to the floor
function plinth(B, ring, floor, lowest) {
  if (floor - lowest < 0.05) return;
  walls(B, offsetRing(ring, 0.15), lowest - 0.2, floor, PLINTH);
}
function lodge(group, M, top, colliders) {
  const { THREE } = C;
  const ring = BUILDINGS.get('colborne-lodge');
  if (!ring) return null;
  const B = makeBuf(), G = makeBuf(), R = makeBuf();
  // the footprint's parts (OpenStreetMap w156278826, walls square to the world's axes to within a degree): the main
  // block with the wide three-sided bay to the south (the lake) and the lower kitchen wing behind it
  const bb = bboxOf(ring);
  const east = ring.filter((p) => p[0] > bb.x1 - 0.6), zSplit = Math.min(...east.map((p) => p[1]));
  const sideZ = ring.filter((p) => (p[0] < bb.x0 + 0.6 || p[0] > bb.x1 - 0.6) && p[1] > zSplit + 1).map((p) => p[1]);
  const zBay = Math.max(...sideZ), bayPts = ring.filter((p) => p[1] > zBay + 0.5).sort((p, q) => q[0] - p[0]);
  const main = [[bb.x1, zSplit], [bb.x1, zBay], ...bayPts, [bb.x0, zBay], [bb.x0, zSplit]];
  const wingX1 = Math.max(...ring.filter((p) => p[1] < zSplit - 1).map((p) => p[0]));
  const wing = [[bb.x0, bb.z0], [wingX1, bb.z0], [wingX1, zSplit], [bb.x0, zSplit]];
  // standing on the highest ground under it, 0.5 m up (the lodge stands on its bluff); a plinth to the lowest
  let hi = -Infinity, lo = Infinity;
  for (let x = bb.x0 - 3; x <= bb.x1 + 3; x += 1.5) for (let z = bb.z0; z <= bb.z1 + 3; z += 1.5) { const g = top(x, z); hi = Math.max(hi, g); lo = Math.min(lo, g); }
  const F0 = hi + 0.5;
  const E1 = F0 + 6.4, E2 = F0 + 4.2; // (the main block's eaves: two storeys; the wing's)
  plinth(B, main, F0, lo); plinth(B, wing, F0, lo);
  // the walls, the cornice band, the roofs (hipped, 0.45 pitch, 0.6 m eaves)
  const mainP = walls(B, main, F0, E1, STUCCO);
  const wingP = walls(B, wing, F0, E2, STUCCO);
  walls(B, offsetRing(main, 0.05), E1 - 0.35, E1, TRIM);
  walls(B, offsetRing(wing, 0.05), E2 - 0.3, E2, TRIM);
  const mainRoof = hipRoof(R, offsetRing(main, 0.6), E1, 0.45, SHINGLE);
  const wingRoof = hipRoof(R, offsetRing(wing, 0.5), E2, 0.5, SHINGLE);
  // eaves' soffits: flat undersides of the overhang
  for (const [r, e] of [[main, E1], [wing, E2]]) {
    const o = offsetRing(r, r === main ? 0.6 : 0.5), P = areaOf(r) < 0 ? r.slice().reverse() : r;
    for (let i = 0; i < P.length; i++) { const j = (i + 1) % P.length; face(B, [[P[i][0], e, P[i][1]], [o[i][0], e, o[i][1]], [o[j][0], e, o[j][1]], [P[j][0], e, P[j][1]]], TRIM); }
  }
  // the windows: tall ones on the ground floor (to the verandah), shorter above; the front door in the bay's middle face
  const front = (a, b) => (a[1] + b[1]) / 2 > zBay + 0.3; // (the bay's faces)
  for (let i = 0; i < mainP.length; i++) {
    const a = mainP[i], b = mainP[(i + 1) % mainP.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if ((a[1] + b[1]) / 2 < zSplit + 0.3) continue; // (the north wall: the wing)
    const n = Math.max(1, Math.floor(L / 3.3));
    const mid = front(a, b) && Math.abs(a[1] - b[1]) < 0.5 && L > 4; // (the bay's south face)
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      opening(B, G, a, b, t, F0 + (mid && k === Math.floor(n / 2) ? 0 : 0.35), mid && k === Math.floor(n / 2) ? 1.3 : 1.15, mid && k === Math.floor(n / 2) ? 2.5 : 2.2, mid && k === Math.floor(n / 2));
      opening(B, G, a, b, t, F0 + 3.9, 1.0, 1.5);
    }
  }
  for (let i = 0; i < wingP.length; i++) {
    const a = wingP[i], b = wingP[(i + 1) % wingP.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if ((a[1] + b[1]) / 2 > zSplit - 0.3) continue;
    const n = Math.max(1, Math.floor(L / 3.6));
    for (let k = 0; k < n; k++) opening(B, G, a, b, (k + 0.5) / n, F0 + 0.8, 0.9, 1.4);
  }
  // the verandah: round the bay and down the main block's sides, 2.4 m deep, on slender trellised posts, its roof a
  // shallow bell of green-painted tin from under the upper windows
  const V0 = F0 + 3.45, V1 = F0 + 2.9, D = 2.4;
  const wallLine = [[bb.x1, zSplit + 1.2], [bb.x1, zBay], ...bayPts, [bb.x0, zBay], [bb.x0, zSplit + 1.2]];
  // (offset outward: away from the main block's centre line)
  const mcx = (bb.x0 + bb.x1) / 2, mcz = (zSplit + zBay) / 2;
  const outer = wallLine.map((p, i) => {
    const a = wallLine[Math.max(0, i - 1)], b = wallLine[Math.min(wallLine.length - 1, i + 1)];
    let nx = (b[1] - a[1]), nz = -(b[0] - a[0]); const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    if ((p[0] - mcx) * nx + (p[1] - mcz) * nz < 0) { nx = -nx; nz = -nz; }
    const turn = i > 0 && i < wallLine.length - 1 ? 1 / Math.max(0.6, Math.cos(Math.acos(Math.max(-1, Math.min(1, ((p[0] - a[0]) * (b[0] - p[0]) + (p[1] - a[1]) * (b[1] - p[1])) / ((Math.hypot(p[0] - a[0], p[1] - a[1]) * Math.hypot(b[0] - p[0], b[1] - p[1])) || 1)))) / 2)) : 1;
    return [p[0] + nx * D * turn, p[1] + nz * D * turn];
  });
  for (let i = 1; i < wallLine.length; i++) {
    const a = wallLine[i - 1], b = wallLine[i], c = outer[i - 1], d = outer[i];
    // the roof (top and underside), the deck, the fascia
    face(R, [[a[0], V0, a[1]], [b[0], V0, b[1]], [d[0], V1, d[1]], [c[0], V1, c[1]]], TIN);
    face(R, [[a[0], V0, a[1]], [c[0], V1, c[1]], [d[0], V1, d[1]], [b[0], V0, b[1]]], TIN);
    face(B, [[a[0], F0 - 0.05, a[1]], [c[0], F0 - 0.05, c[1]], [d[0], F0 - 0.05, d[1]], [b[0], F0 - 0.05, b[1]]], DECK);
    face(B, [[a[0], F0 - 0.05, a[1]], [b[0], F0 - 0.05, b[1]], [d[0], F0 - 0.05, d[1]], [c[0], F0 - 0.05, c[1]]], DECK);
    ribbon(B, c[0], c[1], d[0], d[1], V1 - 0.22, V1, V1 - 0.22, V1, TRIM, true);
    ribbon(B, c[0], c[1], d[0], d[1], lo - 0.2, F0 - 0.05, lo - 0.2, F0 - 0.05, PLINTH, true);
    // posts every ~2.2 m along the outer edge, a trellis of thin diagonals between each pair
    const L = Math.hypot(d[0] - c[0], d[1] - c[1]), n = Math.max(1, Math.round(L / 2.2));
    for (let k = 0; k <= n; k++) {
      if (k === 0 && i > 1) continue;
      const x = c[0] + ((d[0] - c[0]) * k) / n, z = c[1] + ((d[1] - c[1]) * k) / n;
      box(B, x, F0 - 0.05, z, 0.07, (V1 - F0) / 2, 0.07, Math.atan2(d[0] - c[0], d[1] - c[1]), TRIM);
      if (k > 0) {
        const px = c[0] + ((d[0] - c[0]) * (k - 1)) / n, pz = c[1] + ((d[1] - c[1]) * (k - 1)) / n;
        // (the trellis: two thin crossing laths and a rail)
        ribbon(B, px, pz, x, z, V1 - 0.6, V1 - 0.55, V1 - 0.32, V1 - 0.27, TRIM, true);
        ribbon(B, px, pz, x, z, V1 - 0.32, V1 - 0.27, V1 - 0.6, V1 - 0.55, TRIM, true);
        ribbon(B, px, pz, x, z, F0 + 0.8, F0 + 0.86, F0 + 0.8, F0 + 0.86, TRIM, true);
      }
    }
  }
  // the steps down from the verandah in front of the door
  const bayMid = [(bayPts[0][0] + bayPts[bayPts.length - 1][0]) / 2, Math.max(...bayPts.map((p) => p[1])) + D];
  const stepsN = Math.max(1, Math.ceil((F0 - top(bayMid[0], bayMid[1] + 1)) / 0.18));
  for (let s = 0; s < Math.min(stepsN, 12); s++) box(B, bayMid[0], F0 - 0.05 - (s + 1) * 0.18, bayMid[1] + s * 0.3, 1.2, 0.09, 0.15, 0, PLINTH);
  // three chimneys: two on the main block's ridge, one on the wing
  const ch = (x, z, r) => chimney(B, x, z, r.heightAt(x, z) - 0.4, r.heightAt(x, z) + 1.6, 0);
  ch(mcx - 3.2, (zSplit + zBay) / 2 + 0.4, mainRoof); ch(mcx + 3.2, (zSplit + zBay) / 2 + 0.4, mainRoof);
  ch((bb.x0 + wingX1) / 2, (bb.z0 + zSplit) / 2, wingRoof);
  const meshes = [];
  for (const [buf, mat, name] of [[B, M.solid, 'ColborneLodge'], [R, M.solidSnow, 'ColborneLodgeRoof'], [G, M.glass, 'ColborneLodgeGlass']]) {
    const g = bufGeometry(buf, true);
    if (!g) continue;
    const m = new THREE.Mesh(g, mat);
    m.name = name; m.castShadow = name !== 'ColborneLodgeGlass'; m.receiveShadow = true;
    m.userData.cullDistance = 1600;
    group.add(m); meshes.push(m);
  }
  for (const [r, top1] of [[main, mainRoof.ridge], [wing, wingRoof.ridge]]) {
    const b = bboxOf(r);
    colliders.push({ minX: b.x0, maxX: b.x1, minZ: b.z0, maxZ: b.z1, maxY: top1, polygon: r.map(([x, z]) => ({ x, z })) });
  }
  const vb = bboxOf(outer);
  return { floor: F0, ridge: mainRoof.ridge, box: vb, meshes };
}
function coachHouse(group, M, top, colliders) {
  const { THREE } = C;
  const ring = BUILDINGS.get('coach-house');
  if (!ring) return null;
  const B = makeBuf(), G = makeBuf(), R = makeBuf();
  // (its footprint has a notch for a porch: the walls follow it, the roof covers its convex hull)
  const hull = (() => { const P = ring.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo = [], up = []; for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); } for (const p of P.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); } return lo.slice(0, -1).concat(up.slice(0, -1)); })();
  let hi = -Infinity, lo = Infinity;
  for (const [x, z] of ring) { const g = top(x, z); hi = Math.max(hi, g); lo = Math.min(lo, g); }
  const F0 = hi + 0.15, E = F0 + 4.6;
  plinth(B, hull, F0, lo);
  const P = walls(B, hull, F0, E, STUCCO);
  walls(B, offsetRing(hull, 0.05), E - 0.3, E, TRIM);
  const roof = hipRoof(R, offsetRing(hull, 0.5), E, 0.62, SHINGLE);
  const o = offsetRing(hull, 0.5);
  for (let i = 0; i < P.length; i++) { const j = (i + 1) % P.length; face(B, [[P[i][0], E, P[i][1]], [o[i][0], E, o[i][1]], [o[j][0], E, o[j][1]], [P[j][0], E, P[j][1]]], TRIM); }
  // carriage doors on the long side facing the lodge (south), windows elsewhere; a small cupola on the ridge
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 3) continue;
    const south = (a[1] + b[1]) / 2 > (bboxOf(hull).z0 + bboxOf(hull).z1) / 2 + 3 && Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]);
    const n = Math.max(1, Math.floor(L / 4));
    for (let k = 0; k < n; k++) opening(B, G, a, b, (k + 0.5) / n, F0 + (south ? 0 : 1), south ? 2.4 : 0.9, south ? 3.0 : 1.3, south);
  }
  const cb = bboxOf(hull), cx = (cb.x0 + cb.x1) / 2, cz = (cb.z0 + cb.z1) / 2;
  box(B, cx, roof.heightAt(cx, cz) - 0.3, cz, 0.6, 0.65, 0.6, 0, TRIM);
  hipRoof(R, [[cx - 0.8, cz - 0.8], [cx + 0.8, cz - 0.8], [cx + 0.8, cz + 0.8], [cx - 0.8, cz + 0.8]], roof.heightAt(cx, cz) + 1.0, 0.9, TIN);
  chimney(B, cx + 3, cz - 4, roof.heightAt(cx + 3, cz - 4) - 0.3, roof.heightAt(cx + 3, cz - 4) + 1.2, 0);
  for (const [buf, mat, name] of [[B, M.solid, 'ColborneCoachHouse'], [R, M.solidSnow, 'ColborneCoachHouseRoof'], [G, M.glass, 'ColborneCoachHouseGlass']]) {
    const g = bufGeometry(buf, true);
    if (!g) continue;
    const m = new THREE.Mesh(g, mat);
    m.name = name; m.castShadow = name !== 'ColborneCoachHouseGlass'; m.receiveShadow = true;
    m.userData.cullDistance = 1400;
    group.add(m);
  }
  colliders.push({ minX: cb.x0, maxX: cb.x1, minZ: cb.z0, maxZ: cb.z1, maxY: roof.ridge, polygon: hull.map(([x, z]) => ({ x, z })) });
  return { floor: F0 };
}

// ---------------------------------------------------------------------------------------------------------------------
// The zoo's animals: simple procedural beasts (boxes) in the paddocks, each species in its own stretch of the enclosure
// ---------------------------------------------------------------------------------------------------------------------
const SPECIES = [
  // [name, count, body length, shoulder height, colour, head colour, extras]
  ['bison', 4, 2.6, 1.7, 0x3d2a1c, 0x2a1d14, { hump: 0.45 }],
  ['yak', 3, 2.2, 1.45, 0x2b2622, 0xe9e2d6, { horns: 0xd8d0c0 }],
  ['highland', 3, 2.0, 1.2, 0xa2582b, 0xa2582b, { horns: 0xd9cdb4, shaggy: true }],
  ['llama', 4, 1.3, 1.1, 0xe2d6c0, 0xd8cbb2, { neck: 0.9 }],
  ['reindeer', 3, 1.6, 1.1, 0x6e5a47, 0xe6ddcf, { antlers: 0x8c7a62 }],
  ['sheep', 4, 1.1, 0.75, 0xd9d1c2, 0x2a2622, {}],
  ['capybara', 3, 1.0, 0.5, 0x7a5a3c, 0x6a4c33, { short: true }]
];
function beast(spec) {
  const [, , len, sh, body, head, ex] = spec;
  const B = makeBuf(), bc = RGB(body), hc = RGB(head), dark = RGB(0x1e1a17);
  const legH = ex.short ? sh * 0.35 : sh * 0.55, bodyH = sh - legH + (ex.hump || 0) * 0.3;
  // (built facing +z: legs, body, hump, neck and head)
  for (const [x, z] of [[-0.22, -0.4], [0.22, -0.4], [-0.22, 0.4], [0.22, 0.4]]) box(B, x * len * 0.8, 0, z * len * 0.9, 0.07 * Math.max(1, len / 1.6), legH / 2, 0.07 * Math.max(1, len / 1.6), 0, dark);
  box(B, 0, legH, 0, len * 0.22, (sh - legH) / 2, len * 0.5, 0, bc);
  if (ex.hump) box(B, 0, sh - 0.1, len * 0.18, len * 0.2, ex.hump / 2, len * 0.22, 0, bc);
  if (ex.shaggy) box(B, 0, legH - 0.12, 0, len * 0.24, 0.1, len * 0.48, 0, bc);
  let hy = sh - 0.2, hz = len * 0.55;
  if (ex.neck) { box(B, 0, sh - 0.15, len * 0.45, 0.1, ex.neck / 2, 0.12, 0, bc); hy = sh + ex.neck - 0.25; hz = len * 0.5; }
  box(B, 0, hy - 0.15, hz, len * 0.08 + 0.05, 0.16, len * 0.12 + 0.08, 0, hc);
  if (ex.horns) for (const s of [-1, 1]) box(B, s * (len * 0.1 + 0.08), hy + 0.05, hz - 0.05, 0.12, 0.03, 0.03, s * 0.4, RGB(ex.horns));
  if (ex.antlers) for (const s of [-1, 1]) { box(B, s * 0.12, hy + 0.12, hz - 0.08, 0.02, 0.25, 0.02, 0, RGB(ex.antlers)); box(B, s * 0.2, hy + 0.45, hz - 0.08, 0.1, 0.02, 0.02, 0, RGB(ex.antlers)); }
  // (a tail)
  if (!ex.short) box(B, 0, sh - 0.6, -len * 0.5, 0.03, 0.25, 0.03, 0, bc);
  return bufGeometry(B, true);
}
function animals(group, M, top) {
  const { THREE } = C;
  const zoo = AREAS.find((a) => a.kind === 'zoo');
  if (!zoo) return 0;
  // spots in the enclosure clear of the paths through it (Deer Pen Road's footway) and of the fences
  const spots = [];
  const { x0, x1, z0, z1 } = zoo.box;
  for (let x = x0; x < x1; x += 3) for (let z = z0; z < z1; z += 3) {
    const px = x + (hash(x, z, 1) - 0.5) * 2.6, pz = z + (hash(x, z, 2) - 0.5) * 2.6;
    if (!inRing(zoo.pts, px, pz) || highParkFeatureAt(px, pz, 3)) continue;
    if (BARRIERS.some((b) => b.kind === 4 && b.pts.some((p, i) => i > 0 && segDist(px, pz, b.pts[i - 1][0], b.pts[i - 1][1], p[0], p[1]) < 2))) continue;
    spots.push([px, pz]);
  }
  if (!spots.length) return 0;
  // (the enclosure's long axis: the species in order along it, a herd each)
  const cx = spots.reduce((s, p) => s + p[0], 0) / spots.length, cz = spots.reduce((s, p) => s + p[1], 0) / spots.length;
  let sxx = 0, sxz = 0, szz = 0;
  for (const [x, z] of spots) { sxx += (x - cx) ** 2; sxz += (x - cx) * (z - cz); szz += (z - cz) ** 2; }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), ax = Math.cos(ang), az = Math.sin(ang);
  spots.sort((p, q) => ((p[0] - cx) * ax + (p[1] - cz) * az) - ((q[0] - cx) * ax + (q[1] - cz) * az));
  const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(1, 1, 1);
  let placed = 0;
  SPECIES.forEach((spec, si) => {
    const band = spots.slice(Math.floor((si * spots.length) / SPECIES.length), Math.floor(((si + 1) * spots.length) / SPECIES.length));
    const picks = [];
    for (let k = 0; k < band.length && picks.length < spec[1]; k++) {
      const p = band[Math.floor(hash(si, k, 7) * band.length)];
      if (picks.some((o) => Math.hypot(o[0] - p[0], o[1] - p[1]) < spec[2] * 1.4)) continue;
      picks.push(p);
    }
    if (!picks.length) return;
    const geo = beast(spec), mesh = new THREE.InstancedMesh(geo, M.solid, picks.length);
    picks.forEach(([x, z], i) => {
      qt.setFromAxisAngle(up, hash(x, z, 3) * Math.PI * 2);
      m4.compose(new THREE.Vector3(x, top(x, z) - 0.02, z), qt, sc);
      mesh.setMatrixAt(i, m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.name = `HighParkZoo_${spec[0]}`; mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh); placed += picks.length;
  });
  return placed;
}

// ---------------------------------------------------------------------------------------------------------------------
// The park roads closed to cars (the High Park Movement Strategy, City Council 2023): West Road and the middle of
// Colborne Lodge Drive at all times; on weekends and holidays the whole park's roads (only authorized vehicles: the
// TTC's buses on their routes still may). The traffic's edges along them become bus-only (traffic.js keeps every other
// vehicle off a bus-only edge: it neither appears nor turns onto one), then every edge in the park's box that the open
// roads no longer reach both ways (a stub only a closed road leads out of) closes too, so no car is trapped.
// The day is the one the load-built scenery stands on (seasons.js CITY.SITE_DATE, as the rinks and patios): a city opened
// live (or on a capture's ?liveDate= / ?liveClock=) on Toronto's date, so on a Saturday or Sunday the park is car-free; one
// opened on a preset on the classic weekday look (the City's weekday counts, the TTC's weekday service).
// ?parkroads=weekend|weekday overrides it. (Statutory holidays are not counted.)
// ---------------------------------------------------------------------------------------------------------------------
function torontoWeekend(now = new Date()) {
  const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('parkroads') : null;
  if (q === 'weekend') return true;
  if (q === 'weekday') return false;
  const site = C.SITE_DATE;
  if (!site || site.source === 'preset') return false;
  const year = site.year || Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric' }).format(now));
  const dow = new Date(Date.UTC(year, site.month - 1, site.day)).getUTCDay();
  return dow === 0 || dow === 6;
}
function closeHighParkRoads(network, { weekend = torontoWeekend() } = {}) {
  const t0 = performance.now();
  const DV = C.DON_VALLEY;
  const lines = F.closures.filter(([when]) => when === 0 || weekend).map(([, name, ...f]) => ({ name, pts: pairs(f) }));
  const nearClosed = (x, z) => lines.some((l) => l.pts.some((p, i) => i > 0 && segDist(x, z, l.pts[i - 1][0], l.pts[i - 1][1], p[0], p[1]) < 4.5));
  const edges = network?.edges || [];
  const inPark = (e) => DV && DV.inBox(e.sx, e.sz) && DV.inBox(e.sx + e.dx * e.len, e.sz + e.dz * e.len);
  let closed = 0;
  for (const e of edges) {
    if (!inPark(e) || e.busOnly) continue;
    // (the edge's points at a quarter, half and three quarters along: all on a closed road)
    if ([0.25, 0.5, 0.75].every((t) => nearClosed(e.sx + e.dx * e.len * t, e.sz + e.dz * e.len * t))) { e.busOnly = true; e.parkClosed = true; closed++; }
  }
  // the open edges that still reach, and are reached from, the city outside the box (iterated to a fixed point)
  const open = edges.filter((e) => !e.busOnly);
  const reach = (forward) => {
    const seen = new Set(open.filter((e) => !inPark(e)));
    const into = new Map();
    if (!forward) for (const e of open) for (const m of e.moves || []) if (!m.to.busOnly) (into.get(m.to) || into.set(m.to, []).get(m.to)).push(e);
    const stack = [...seen];
    while (stack.length) {
      const e = stack.pop();
      const next = forward ? (e.moves || []).map((m) => m.to).filter((f) => !f.busOnly) : into.get(e) || [];
      for (const f of next) if (!seen.has(f)) { seen.add(f); stack.push(f); }
    }
    return seen;
  };
  const from = reach(true), to = reach(false);
  let stubs = 0;
  for (const e of open) if (inPark(e) && !(from.has(e) && to.has(e))) { e.busOnly = true; e.parkClosed = true; stubs++; }
  const stats = { weekend, closures: lines.length, closed, stubs, ms: Math.round(performance.now() - t0) };
  console.info(`[high-park] park roads closed to cars (${weekend ? 'weekend: the whole park' : 'weekday: West Road and the middle of Colborne Lodge Drive'}): ${closed} traffic edges, ${stubs} stubs left without a way out, in ${stats.ms} ms`);
  C.highParkRoadStats = stats;
  return stats;
}

// ---------------------------------------------------------------------------------------------------------------------
function buildHighParkFeatures(scene) {
  const DV = C.DON_VALLEY;
  if (!DV || !DV.highPark) return null;
  const { THREE } = C;
  const t0 = performance.now();
  const SWH = C.CITY_BOUNDS.sidewalkHeight;
  // the lawn's top at (x, z): the curb island's 0.22 m over the pilot's ground (the street level off the islands)
  const top = (x, z) => (C.blockAt(x, z) ? SWH : 0) + DV.heightAt(x, z);
  const M = materials();
  const root = new THREE.Group(); root.name = 'HighParkFeatures';
  const ground = new THREE.Group(); ground.name = 'HighParkFeatureGround';
  root.add(ground); scene.add(root);
  const colliders = [];
  const flatStats = flatLayers(ground, M, SWH);
  const fences = barriers(root, M, top);
  const nFountains = fountains(root, M, top, colliders);
  const L = lodge(root, M, top, colliders);
  coachHouse(root, M, top, colliders);
  const nAnimals = animals(root, M, top);
  let tris = 0, draws = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.visible || !o.geometry) return;
    const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3;
    if (!n) return;
    draws++; tris += n * (o.isInstancedMesh ? o.count : 1);
  });
  const stats = { paths: PATHS.length, areas: AREAS.length, barriers: BARRIERS.length, posts: fences.posts, fountains: nFountains, animals: nAnimals, lodge: !!L, flat: flatStats, triangles: tris, draws, ms: Math.round(performance.now() - t0) };
  C.highParkFeatureStats = stats;
  console.info(`[high-park] features: ${stats.paths} path runs, ${stats.areas} areas, ${stats.barriers} fences & hedges (${stats.posts} posts), ${nFountains} fountains, ${nAnimals} animals, Colborne Lodge ${L ? `(floor ${L.floor.toFixed(1)} m, ridge ${L.ridge.toFixed(1)} m)` : 'missing'}: ${draws} meshes, ${tris} triangles (${flatStats.triangles} draped), in ${stats.ms} ms`);
  return { group: root, colliders, stats };
}

// (the shapes, for js/park-cover.js: its ground cover keeps off the paths, beds, paved areas and buildings)
const highParkFeatureShapes = { paths: PATHS, areas: AREAS, buildings: [...BUILDINGS.values()], trail: { ...TRAIL, halfWidth: trailHalfWidth, plantEdge: trailPlantEdge, corridorEdge: trailCorridorEdge, earthAt: trailEarthAt, wide: trailWide } };
Object.assign(C, { buildHighParkFeatures, closeHighParkRoads, highParkFeatureAt, highParkBuildingAt, highParkTorontoWeekend: torontoWeekend, highParkFeatureShapes });
})();
