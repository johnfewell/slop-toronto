(function () {
// js/park-woods.js — the wooded parks' trees and woodland floor from the lidar: High Park (docs/high-park-woods.md) and
// Toronto Island Park (docs/toronto-island-woods.md). Each park's data (js/<park>-woods-data.js as
// window.CITY.<PARK>_WOODS_DATA, by tools/build-park-woods.mjs) holds every crown 5 m or taller on the park's islands:
// where it stands, its height and width, whether it stands in closed woods, and its EZ-Tree model. Here, for every park
// whose data is loaded:
// - replaceTrees: the crowns as street-details.js tree sites, in place of the trees it invents on the park's islands, off
//   the park's paths, beds and buildings; ez-trees.js draws them in their own model at their own height and width, the woods' trees with
//   nearer level hand-overs than the open ones (they stand 50-70 to the hectare, and hide each other)
// - groundNode: the park lawn material's colour over the park, from a small texture over its box: woodland floor (leaf
//   litter) under closed canopy, unmown meadow in the savanna and the woods' openings (OpenStreetMap's wood & scrub),
//   the lawn as it was elsewhere. Outside the boxes the lawn's colour is exactly its own.
const C = window.CITY;
// (the parks' data, in the order explore.html loads them; ?woods=0: the parks as they were, the invented trees and the
// lawn, for A/B)
const DATA = Object.keys(C).filter((k) => /_WOODS_DATA$/.test(k)).map((k) => C[k]);
if (!DATA.length || (typeof location !== 'undefined' && new URLSearchParams(location.search).get('woods') === '0')) return;

// the ground's colours (sRGB hex, as tsl-materials.js's)
const LITTER = [0x765838, 0x8f6c40, 0x5f6634]; // oak leaf litter (mid brown), its drier ochre-brown patches, moss
// (the same litter in the high sun, which bleaches the ochre to dry sand: a deeper umber, the ochre olive-brown, more moss)
const LITTER_NOON = [0x6a5234, 0x76653e, 0x56622f];
const MEADOW = [0x5f6a32, 0x8a8547, 0x6d7a3a]; // the savanna's tall grass: olive, its seed heads, green

const stats = { crowns: 0, onPaths: 0, onFeatures: 0, woods: 0, open: 0, replaced: 0, cityPiled: 0, parks: {} };

/** One park's woods, from its data `D` */
function park(D) {
// (High Park's data predates parkNames)
const names = D.parkNames || ['High Park'], id = D.kind.replace(/-woods$/, '');
const box = D.box;
const inBox = (x, z) => x > box.x0 && x < box.x1 && z > box.z0 && z < box.z1;
const pst = { crowns: 0, onPaths: 0, onFeatures: 0, woods: 0, open: 0, cityPiled: 0 };

let crownList = null;
/** The crowns: { x, z, h, r, model, woods, ravine } */
function crowns() {
  if (crownList) return crownList;
  const bin = atob(D.crowns), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const a = new Uint16Array(u8.buffer);
  crownList = [];
  for (let i = 0; i + 4 < a.length; i += 5) {
    const code = a[i + 4];
    crownList.push({ x: box.x0 + a[i] / 10, z: box.z0 + a[i + 1] / 10, h: a[i + 2] / 10, r: a[i + 3] / 10, model: D.models[code & 15], woods: !!(code & 16), ravine: !!(code & 32) });
  }
  return crownList;
}

/** True for the park's islands, where these trees stand in place of street-details.js's invented ones */
function replacesBlock(b) {
  return names.includes(b.parkName) && inBox(b.cx, b.cz);
}

// (the park's paths: no trunk on one; GEO.parkPaths [width, x0, z0, x1, z1, ...], in 8 m cells)
let pathCells = null;
function onPath(x, z) {
  if (!pathCells) {
    pathCells = new Map();
    for (const [w, ...flat] of C.GEO.parkPaths || []) {
      for (let i = 0; i + 3 < flat.length; i += 2) {
        const ax = flat[i], az = flat[i + 1], bx = flat[i + 2], bz = flat[i + 3];
        if (!inBox(ax, az) && !inBox(bx, bz)) continue;
        const seg = [ax, az, bx, bz, w / 2 + 0.8];
        for (let cx = Math.floor((Math.min(ax, bx) - 4) / 8); cx <= Math.floor((Math.max(ax, bx) + 4) / 8); cx++) {
          for (let cz = Math.floor((Math.min(az, bz) - 4) / 8); cz <= Math.floor((Math.max(az, bz) + 4) / 8); cz++) {
            const k = cx * 100000 + cz;
            (pathCells.get(k) || pathCells.set(k, []).get(k)).push(seg);
          }
        }
      }
    }
  }
  for (const [ax, az, bx, bz, r] of pathCells.get(Math.floor(x / 8) * 100000 + Math.floor(z / 8)) || []) {
    const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    if (Math.hypot(ax + dx * t - x, az + dz * t - z) < r) return true;
  }
  return false;
}

/**
 * The crowns as tree sites for street-details.js (`y`: the island's level; ez-trees.js puts each on the ground): the
 * EZ-Tree model, height and crown radius ez-trees.js draws, and mrdoob's species and scale for the fallback trees
 */
function trees(y) {
  const out = [];
  for (const c of crowns()) {
    if (onPath(c.x, c.z)) { pst.onPaths++; continue; }
    // (nor on High Park's own paths, beds and buildings, when high-park-features.js has laid them)
    if (C.highParkFeatureAt && C.highParkFeatureAt(c.x, c.z, 1.5)) { pst.onFeatures++; continue; }
    out.push({ x: c.x, y, z: c.z, scale: c.h / 13, species: c.model.includes('ash') ? 1 : /aspen|cottonwood/.test(c.model) ? 2 : 0, tier: 0,
      model: c.model, height: c.h, width: c.r, woods: c.woods });
    if (c.woods) pst.woods++; else pst.open++;
  }
  pst.crowns = out.length;
  return out;
}

// The City's inventory piles many of the park's trees on one address point (D.cityTreePiles: [x, z, count], PILE_MIN
// or more at a point on the park's islands; 519 at High Park's Bloor Street gate). The lidar's crowns are those trees:
// ez-trees.js keeps one tree of each pile and leaves the rest out. Returns the number left out
function dropPiledCityTrees(sites) {
  const key = (x, z) => `${x.toFixed(1)},${z.toFixed(1)}`, piles = new Set((D.cityTreePiles || []).map(([x, z]) => key(x, z))), seen = new Set();
  const kept = sites.filter((t) => { if (t.tier !== 1 || !inBox(t.x, t.z)) return true; const k = key(t.x, t.z); if (!piles.has(k)) return true; if (seen.has(k)) return false; seen.add(k); return true; });
  const dropped = sites.length - kept.length;
  sites.length = 0;
  for (const t of kept) sites.push(t); // (one at a time: spreading a map-sized list into push() overflows the call stack, st-6m6l)
  pst.cityPiled = dropped;
  return dropped;
}


// --- the ground: R woodland floor, G meadow, B open (where there is floor: the canopy thin round the cell, or its crowns
// the savanna's), on the data's grid over the box (D.ground: 2 bits a cell, 0 off the park's islands, 1 lawn, 2 meadow, 3 canopy)
let cover = null;
function groundCover() {
  if (cover) return cover;
  const { cell: CELL, w: W, h: H } = D.ground;
  const bin = atob(D.ground.cells), k = new Uint8Array(W * H);
  for (let q = 0; q < W * H; q++) k[q] = (bin.charCodeAt(q >> 2) >> ((q & 3) * 2)) & 3;
  // each cell's floor: the share of canopy over it and its 8 neighbours (itself twice), eased; meadow where the cell is
  // meadow, less the floor; nothing off the park
  const smooth = (e0, e1, v) => { const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  // how open the canopy is round each cell: its share over the 7 x 7 cells round it (28 m, about the 12 m round a crown
  // the builder calls the woods), from a summed-area table; and the share of the crowns within 14 m standing in the open
  // (not woods: the savanna's scattered oaks), nearer ones counting more
  const sat = new Int32Array((W + 1) * (H + 1)), nat = new Int32Array((W + 1) * (H + 1));
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const q = j * W + i, a = (j + 1) * (W + 1) + i + 1;
    sat[a] = (k[q] === 3 ? 1 : 0) + sat[a - 1] + sat[a - W - 1] - sat[a - W - 2];
    nat[a] = (k[q] ? 1 : 0) + nat[a - 1] + nat[a - W - 1] - nat[a - W - 2];
  }
  const boxSum = (t, i0, j0, i1, j1) => t[j1 * (W + 1) + i1] - t[j0 * (W + 1) + i1] - t[j1 * (W + 1) + i0] + t[j0 * (W + 1) + i0];
  const near = new Float32Array(W * H), nearOpen = new Float32Array(W * H), RC = 14;
  for (const c of crowns()) {
    const i0 = Math.max(0, Math.floor((c.x - RC - box.x0) / CELL)), i1 = Math.min(W - 1, Math.floor((c.x + RC - box.x0) / CELL));
    const j0 = Math.max(0, Math.floor((c.z - RC - box.z0) / CELL)), j1 = Math.min(H - 1, Math.floor((c.z + RC - box.z0) / CELL));
    for (let j = j0; j <= j1; j++) {
      const dz = box.z0 + (j + 0.5) * CELL - c.z;
      for (let i = i0; i <= i1; i++) {
        const dx = box.x0 + (i + 0.5) * CELL - c.x, d2 = dx * dx + dz * dz;
        if (d2 >= RC * RC) continue;
        const wgt = 1 - Math.sqrt(d2) / RC;
        near[j * W + i] += wgt;
        if (!c.woods) nearOpen[j * W + i] += wgt;
      }
    }
  }
  const data = new Uint8Array(W * H * 4);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const q = j * W + i;
    if (!k[q]) continue;
    let n = 0, s = 0, m = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= W || jj >= H || !k[jj * W + ii]) continue;
      const wgt = di || dj ? 1 : 2, v = k[jj * W + ii];
      n += wgt; s += v === 3 ? wgt : 0; m += v === 2 ? wgt : 0;
    }
    const floor = smooth(0.35, 0.85, s / n);
    data[q * 4] = Math.round(255 * floor);
    data[q * 4 + 1] = Math.round(255 * smooth(0.2, 0.7, m / n) * (1 - floor));
    const i0 = Math.max(0, i - 3), i1 = Math.min(W, i + 4), j0 = Math.max(0, j - 3), j1 = Math.min(H, j + 4);
    const thin = 1 - smooth(0.55, 0.9, boxSum(sat, i0, j0, i1, j1) / boxSum(nat, i0, j0, i1, j1));
    data[q * 4 + 2] = Math.round(255 * Math.max(thin, near[q] ? smooth(0.3, 0.8, nearOpen[q] / near[q]) : 1) * smooth(0, 0.3, floor));
    data[q * 4 + 3] = 255;
  }
  const { THREE } = C;
  const texture = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.needsUpdate = true;
  texture.name = `GroundCover:${id}`;
  cover = { texture, data, W, H };
  return cover;
}

/**
 * Inside a TSL Fn: over the park's box, `out` (a vec3 var: the lawn's colour, the season applied) at world `wp` (vec2
 * x, z) becomes the park's ground; outside the box nothing more is computed. `fx`: tsl-materials.js's { seasonalGrass,
 * noise2D }; `noon`: the sun's height
 */
function groundInto(out, wp, fx, noon) {
  const { If, texture, vec2, color, mix, smoothstep, float } = C.TSL;
  const g = groundCover();
  const uv = wp.sub(vec2(box.x0, box.z0)).div(vec2(box.x1 - box.x0, box.z1 - box.z0)).toVar();
  If(uv.x.greaterThan(0.0).and(uv.x.lessThan(1.0)).and(uv.y.greaterThan(0.0)).and(uv.y.lessThan(1.0)), () => {
    const t = texture(g.texture, uv);
    const n1 = fx.noise2D(wp.mul(0.11)), n2 = fx.noise2D(wp.mul(0.9).add(17.3)), n3 = fx.noise2D(wp.mul(3.1).add(5.7));
    const L = (i) => mix(color(LITTER[i]), color(LITTER_NOON[i]), noon);
    const litter = mix(mix(L(0), L(1), n2.mul(0.6).add(n3.mul(0.4))), L(2), n1.mul(0.55));
    const meadow = fx.seasonalGrass(mix(mix(color(MEADOW[0]), color(MEADOW[1]), n2.mul(0.6).add(n3.mul(0.4))), color(MEADOW[2]), n1.mul(0.5)));
    // (grass shows through the litter in patches: most at the canopy's edges and in its clearings, where the floor's
    // weight is partial, a little under closed canopy; in the high sun, where the canopy is open, most of the ground:
    // the savanna's grass under its scattered oaks, the meadow's where it is the savanna's)
    const open = t.b.mul(noon);
    const patch = smoothstep(open.mul(-0.3).add(0.42), 0.72, n1.mul(0.55).add(n2.mul(0.45)));
    const floor = t.r.mul(float(1.0).sub(patch.mul(t.r.oneMinus().mul(0.65).add(0.2)))).mul(open.mul(-0.55).add(1.0));
    out.assign(mix(mix(out, meadow, t.g.max(open.mul(0.5))), litter, floor));
  });
}

stats.parks[id] = pst;
return { id, names, box, inBox, crowns, replacesBlock, trees, dropPiledCityTrees, groundCover, groundInto, stats: pst };
}

const parks = DATA.map(park);

/** Every park's crowns: { x, z, h, r, model, woods, ravine } */
const crowns = () => parks.flatMap((p) => p.crowns());
/** True for a park's islands, where its trees stand in place of street-details.js's invented ones */
const replacesBlock = (b) => parks.some((p) => p.replacesBlock(b));
const inBox = (x, z) => parks.some((p) => p.inBox(x, z));
/** Every park's crowns as street-details.js tree sites (`y`: the island's level) */
function trees(y) {
  const out = parks.flatMap((p) => p.trees(y));
  for (const k of ['crowns', 'onPaths', 'onFeatures', 'woods', 'open']) stats[k] = parks.reduce((t, p) => t + p.stats[k], 0);
  return out;
}

/**
 * street-details.js's tree sites with the parks' own: the trees it invented on the parks' islands (tier 0, the parkland
 * grid) out, the lidar's crowns in (`y`: the island's level). In place; returns the list
 */
function replaceTrees(list, y) {
  const kept = list.filter((t) => { const b = t.tier === 0 && inBox(t.x, t.z) ? C.blockAt(t.x, t.z) : null; return !(b && replacesBlock(b)); });
  stats.replaced = list.length - kept.length;
  list.length = 0;
  for (const t of kept) list.push(t); // (one at a time: spreading a map-sized list into push() overflows the call stack, st-6m6l)
  for (const t of trees(y)) list.push(t);
  for (const p of parks) console.info(`[parkWoods] ${p.id}: ${p.stats.crowns} trees from the lidar (${p.stats.woods} in the woods, ${p.stats.open} in the open); ${p.stats.onPaths + p.stats.onFeatures} left off paths, beds and buildings`);
  console.info(`[parkWoods] ${stats.crowns} trees from the lidar in ${parks.length} parks, in place of ${stats.replaced} invented`);
  return list;
}

/** The City's piled trees on the parks' islands, one of each pile kept (ez-trees.js). Returns the number left out */
function dropPiledCityTrees(sites) {
  stats.cityPiled = parks.reduce((t, p) => t + p.dropPiledCityTrees(sites), 0);
  return stats.cityPiled;
}

/** Park `i`'s ground cover (0: the first loaded, High Park's) */
const groundCover = (i = 0) => parks[i].groundCover();

/**
 * The lawn colour `lawn` (a TSL vec3, the season applied) at world `wp` (vec2 x, z) over the parks' ground; outside
 * their boxes exactly `lawn`, and nothing more computed there. `fx`: tsl-materials.js's { seasonalGrass, noise2D }
 */
function groundNode(lawn, wp, fx) {
  const { Fn, vec3, smoothstep, normalize } = C.TSL;
  // (the sun's height: 0 at golden hour, 10 degrees up, to 1 from about 40 degrees, the midday look)
  const noon = smoothstep(0.25, 0.65, normalize(C.cityUniforms.uSkySunDir).y);
  return Fn(() => {
    const out = vec3(lawn).toVar();
    for (const p of parks) p.groundInto(out, wp, fx, noon);
    // (the far meadow, past the grass rings: park-cover.js)
    if (C.parkCoverGroundInto) C.parkCoverGroundInto(out, wp, fx);
    return out;
  })();
}

C.parkWoods = { parks, crowns, replacesBlock, inBox, trees, replaceTrees, dropPiledCityTrees, groundCover, groundNode, stats };
})();
