(function () {
// js/sky-occlusion.js
// Sky occlusion of the city from a top-down height map: how much of the sky a point sees over the skyline around it.
// Ported from Ben Houston's enhanced Slop New York lighting (bhouston/slop-newyork, branch ssr-brdf, js/sky-occlusion.js,
// MIT; https://ben3d.ca/blog/enhanced-slop-new-york-lighting). His method, kept: the buildings are rasterised once at
// load into a height map with a max-mip pyramid; the horizon is searched in compass slices by marching outward through
// the pyramid (a far step reads a coarser mip, so it can't miss a thin tower), and the cosine-weighted share of the sky
// above the horizon is integrated per slice in closed form (the slice integral of GTAO, run over the city instead of the
// depth buffer).
//
// What differs here (docs/sky-occlusion.md):
// - Ben's runs as a half-resolution screen pass that feeds a fork of three.js's indirect-diffuse list. This repository
//   draws on stock three r187 and has no depth pre-pass, so the same integral is evaluated per fragment in the materials'
//   aoNode (tsl-materials.js canyonSkyAONode), where the height-only canyon AO used to be. aoNode scales the indirect
//   diffuse (the hemisphere light and the environment's diffuse).
// - The hidden part of the sky is filled with one bounce colour like his (the hemisphere light's ground colour, scaled
//   by the time of day's canyon bounce). aoNode is a scalar, so the fill is expressed as a share of the sky's own
//   irradiance (fillRatio, set by lighting.js) instead of a colour.
// - The map is sized to the loaded map (texels 2 to 8 m, 8-bit square-root heights, 16 to 32 MB on the desktop city),
//   and it is rasterised in plain JS from the colliders instead of a 2D canvas, so it can be tested without a browser.
// The pure functions below are what tests/sky-occlusion.test.mjs checks, against a brute-force reference.

const C = window.CITY;

// ---- the map ------------------------------------------------------------------------------------------------------
const MAX_HEIGHT = 700; // m: above the CN Tower's pod (the tallest thing the map holds is a roof or a pod, not the mast)
// a 2D canvas holds 8 bits and a half float is twice the memory, so the height is stored as its square root, rounded
// down (0.6 m steps at 20 m, 5 m at 300 m, and never above the roof)
// (offset: the metres the ground dips under the street level, for the ravines: heights are stored from -offset up to
// MAX_HEIGHT, 0 where the map has none)
const encodeHeight = (h, offset = 0) => Math.floor(255 * Math.sqrt(Math.min(Math.max(h + offset, 0), MAX_HEIGHT + offset) / (MAX_HEIGHT + offset)));
const decodeHeight = (v, offset = 0) => { const s = v / 255; return s * s * (MAX_HEIGHT + offset) - offset; };

// The smallest texel (m) that keeps the map to maxTexels texels and maxSide on its longest side
function chooseTexel(widthM, depthM, { maxTexels = 14e6, maxSide = 8192, steps = [2, 3, 4, 6, 8] } = {}) {
  for (const t of steps) {
    if (Math.ceil(widthM / t) * Math.ceil(depthM / t) <= maxTexels && Math.max(widthM, depthM) / t <= maxSide) return t;
  }
  return steps[steps.length - 1];
}

function createGrid(bounds, margin, texel, offset = 0) {
  const x0 = bounds.minX - margin, z0 = bounds.minZ - margin;
  const width = Math.ceil((bounds.maxX + margin - x0) / texel), height = Math.ceil((bounds.maxZ + margin - z0) / texel);
  return { originX: x0, originZ: z0, texel, width, height, offset, data: new Uint8Array(width * height) };
}

// ---- the ground ---------------------------------------------------------------------------------------------------
// The ground's height over the street level (terrain hills, High Park's ravines and ponds) at the lattice's nodes (a
// step of 12 m, finer than the terrain's 60 m grid and about the Don Valley grid's 10 m), and how far under the street
// level it goes (rounded up to 5 m, at most 40): the map's offset.
function groundLattice(grid0, groundAt, step = 12) {
  const { originX, originZ, texel, width, height } = grid0;
  const nx = Math.ceil(width * texel / step) + 2, nz = Math.ceil(height * texel / step) + 2;
  const values = new Float32Array(nx * nz);
  let min = 0, max = 0;
  for (let r = 0; r < nz; r++) {
    for (let c = 0; c < nx; c++) {
      const v = groundAt(originX + c * step, originZ + r * step);
      values[r * nx + c] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return { originX, originZ, step, nx, nz, values, min, max, offset: Math.min(40, Math.ceil(Math.max(0, -min - 0.25) / 5) * 5) };
}
// Draws the lattice into a grid (bilinear between its nodes). Run first: the buildings and trees keep the tallest.
function fillGround(grid, lattice) {
  const { originX, originZ, texel, width, height, data, offset } = grid;
  const { step, nx, nz, values } = lattice;
  const flat = encodeHeight(0, offset);
  data.fill(flat);
  let drawn = 0;
  for (let row = 0; row < height; row++) {
    const fz = (originZ + (row + 0.5) * texel - lattice.originZ) / step, r0 = Math.min(nz - 2, Math.max(0, Math.floor(fz))), tz = Math.min(1, Math.max(0, fz - r0));
    for (let col = 0; col < width; col++) {
      const fx = (originX + (col + 0.5) * texel - lattice.originX) / step, c0 = Math.min(nx - 2, Math.max(0, Math.floor(fx))), tx = Math.min(1, Math.max(0, fx - c0));
      const k = r0 * nx + c0, a = values[k], b = values[k + 1], d = values[k + nx], e = values[k + nx + 1];
      if (a === 0 && b === 0 && d === 0 && e === 0) continue;
      const g = (a * (1 - tx) + b * tx) * (1 - tz) + (d * (1 - tx) + e * tx) * tz;
      const v = encodeHeight(g, offset);
      if (v !== flat) { data[row * width + col] = v; drawn++; }
    }
  }
  return drawn;
}
// The lattice's height at a point (bilinear), for a tree's foot where the site gave none
function latticeAt(lattice, x, z) {
  const { step, nx, nz, values } = lattice;
  const fx = (x - lattice.originX) / step, fz = (z - lattice.originZ) / step;
  const c0 = Math.min(nx - 2, Math.max(0, Math.floor(fx))), r0 = Math.min(nz - 2, Math.max(0, Math.floor(fz)));
  const tx = Math.min(1, Math.max(0, fx - c0)), tz = Math.min(1, Math.max(0, fz - r0)), k = r0 * nx + c0;
  return (values[k] * (1 - tx) + values[k + 1] * tx) * (1 - tz) + (values[k + nx] * (1 - tx) + values[k + nx + 1] * tx) * tz;
}

// Fills a polygon (rings of {x, z}: the outline, then any holes; even-odd) with a height, keeping the tallest where
// shapes overlap. Texels are sampled at their centres.
function fillRings(grid, rings, value) {
  const { originX, originZ, texel, width, height, data } = grid;
  let zMin = Infinity, zMax = -Infinity;
  for (const r of rings) for (const p of r) { if (p.z < zMin) zMin = p.z; if (p.z > zMax) zMax = p.z; }
  const row0 = Math.max(0, Math.ceil((zMin - originZ) / texel - 0.5)), row1 = Math.min(height - 1, Math.floor((zMax - originZ) / texel - 0.5));
  const xs = [];
  for (let row = row0; row <= row1; row++) {
    const z = originZ + (row + 0.5) * texel;
    xs.length = 0;
    for (const r of rings) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const a = r[j], b = r[i];
        if ((a.z <= z) === (b.z <= z)) continue;
        xs.push(a.x + (z - a.z) / (b.z - a.z) * (b.x - a.x));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - originX) / texel - 0.5)), c1 = Math.min(width - 1, Math.floor((xs[k + 1] - originX) / texel - 0.5));
      for (let c = c0; c <= c1; c++) if (data[row * width + c] < value) data[row * width + c] = value;
    }
  }
}

// Which colliders are buildings: a roof you can't see over. Props (poles, benches, trees: circles), raised decks and
// bridges (minY) and anything under 4 m are not.
function isBuildingCollider(c) {
  if (!c || !(c.maxY >= 4) || c.prop || c.circle) return false;
  if (c.minY !== undefined && c.minY > 3) return false;
  return true;
}

function collidersToGrid(grid, colliders, accept = isBuildingCollider) {
  let used = 0;
  for (const c of colliders) {
    if (!accept(c)) continue;
    const v = encodeHeight(c.maxY, grid.offset);
    const outer = c.polygon && (c.polygon.outer || c.polygon); // (a ring of {x, z}, or { outer, holes })
    if (outer && outer.length >= 3) fillRings(grid, [outer, ...((c.polygon && c.polygon.holes) || [])], v);
    else if (c.obb) {
      const o = c.obb, ring = [];
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ring.push({ x: o.cx + sx * o.hx * o.cs + sz * o.hz * o.sn, z: o.cz - sx * o.hx * o.sn + sz * o.hz * o.cs });
      }
      fillRings(grid, [ring], v);
    } else if (c.minX !== undefined) {
      fillRings(grid, [[{ x: c.minX, z: c.minZ }, { x: c.maxX, z: c.minZ }, { x: c.maxX, z: c.maxZ }, { x: c.minX, z: c.maxZ }]], v);
    } else continue;
    used++;
  }
  return used;
}

// Draws one triangle (world x, z in metres; y the height) into the grid, keeping the tallest: for models whose colliders
// are coarser than they are. Parts thinner than a texel are missed (sampled at centres).
function fillTriangle(grid, ax, az, ay, bx, bz, by, cx, cz, cy) {
  const { originX, originZ, texel, width, height, data } = grid;
  const area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  if (Math.abs(area) < 1e-9) return; // a wall seen edge-on
  const c0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - originX) / texel - 0.5)), c1 = Math.min(width - 1, Math.floor((Math.max(ax, bx, cx) - originX) / texel - 0.5));
  const r0 = Math.max(0, Math.ceil((Math.min(az, bz, cz) - originZ) / texel - 0.5)), r1 = Math.min(height - 1, Math.floor((Math.max(az, bz, cz) - originZ) / texel - 0.5));
  for (let r = r0; r <= r1; r++) {
    const pz = originZ + (r + 0.5) * texel;
    for (let c = c0; c <= c1; c++) {
      const px = originX + (c + 0.5) * texel;
      const wb = ((px - ax) * (cz - az) - (pz - az) * (cx - ax)) / area;
      const wc = ((bx - ax) * (pz - az) - (bz - az) * (px - ax)) / area;
      if (wb < 0 || wc < 0 || wb + wc > 1) continue;
      const v = encodeHeight(ay * (1 - wb - wc) + by * wb + cy * wc, grid.offset);
      if (v > data[r * width + c]) data[r * width + c] = v;
    }
  }
}

// Draws a disc (a tree's crown) at a height, keeping the tallest where it overlaps. At least the texel under its centre.
function fillDisc(grid, cx, cz, r, value) {
  const { originX, originZ, texel, width, height, data } = grid;
  const c0 = Math.max(0, Math.floor((cx - r - originX) / texel)), c1 = Math.min(width - 1, Math.floor((cx + r - originX) / texel));
  const r0 = Math.max(0, Math.floor((cz - r - originZ) / texel)), r1 = Math.min(height - 1, Math.floor((cz + r - originZ) / texel));
  const rr = Math.max(r, texel * 0.5) ** 2;
  for (let row = r0; row <= r1; row++) {
    const dz = originZ + (row + 0.5) * texel - cz;
    for (let col = c0; col <= c1; col++) {
      const dx = originX + (col + 0.5) * texel - cx;
      if (dx * dx + dz * dz <= rr && data[row * width + col] < value) data[row * width + col] = value;
    }
  }
}

// A leaf-on tree stops part of the sky, not all of it, and the map holds one height per texel: the crown is drawn as a
// solid reaching this share of the tree's height (a street tree of 12 m: 8 m), and only while the trees are in leaf
const CROWN_SHARE = 0.65;
const MIN_TREE = 4; // m: shrubs and saplings are left out
// crowns: { count, data: Float32Array of x, foot y, z, height, crown radius per tree }. The foot is raised to the ground
// where the site's y is under it.
function treesToGrid(grid, crowns, groundAt = null) {
  const { data, count } = crowns;
  let drawn = 0;
  for (let i = 0; i < count; i++) {
    const x = data[i * 5], z = data[i * 5 + 2], h = data[i * 5 + 3], r = data[i * 5 + 4];
    if (!(h >= MIN_TREE)) continue;
    const foot = Math.max(data[i * 5 + 1], groundAt ? groundAt(x, z) : -Infinity);
    fillDisc(grid, x, z, r, encodeHeight(foot + h * CROWN_SHARE, grid.offset));
    drawn++;
  }
  return drawn;
}

// The max-mip pyramid: a texel holds the tallest of the four below it
function buildPyramid(grid) {
  const levels = [{ data: grid.data, width: grid.width, height: grid.height }];
  let { data: level, width: w, height: h } = levels[0];
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1), next = new Uint8Array(nw * nh);
    for (let y = 0; y < nh; y++) {
      const r0 = Math.min(2 * y, h - 1) * w, r1 = Math.min(2 * y + 1, h - 1) * w;
      for (let x = 0; x < nw; x++) {
        const x0 = Math.min(2 * x, w - 1), x1 = Math.min(2 * x + 1, w - 1);
        const a = level[r0 + x0], b = level[r0 + x1], c = level[r1 + x0], d = level[r1 + x1];
        next[y * nw + x] = Math.max(a, b, c, d);
      }
    }
    levels.push({ data: next, width: nw, height: nh });
    level = next; w = nw; h = nh;
  }
  return levels;
}

// ---- the integral (the CPU twin of the shader below, and the brute-force reference) ---------------------------------
const SLICES = 16, STEP_COUNT = 13, NEAR = 4, FAR = 256; // Ben's: 16 compass slices, 13 steps from 4 m to 256 m
const TEXELS_PER_STEP = 8; // a step reads the mip whose texels are an eighth of its distance (Ben's: a quarter; 0.069 -> 0.048 mean error against the brute force here)
const WALL_CLEARANCE = 0.5; // of the distance: the slices along a wall are turned outward by this
const HEIGHT_BIAS = 0.5; // m
const stepDistance = (i, count = STEP_COUNT) => NEAR * Math.pow(FAR / NEAR, i / (count - 1));

// The tallest roof (m) in the texel of a pyramid level at a world position, bilinear within the level like the GPU's
function heightAt(pyramid, grid, x, z, level = 0) {
  // (between two levels the GPU blends them, trilinear: so does this)
  const l0 = Math.min(Math.floor(level), pyramid.length - 1), l1 = Math.min(l0 + 1, pyramid.length - 1), t = level - Math.floor(level);
  if (t > 0 && l1 !== l0) return (1 - t) * heightAtLevel(pyramid, grid, x, z, l0) + t * heightAtLevel(pyramid, grid, x, z, l1);
  return heightAtLevel(pyramid, grid, x, z, l0);
}
function heightAtLevel(pyramid, grid, x, z, level) {
  const L = pyramid[level];
  const size = grid.texel * (grid.width / L.width);
  const fx = (x - grid.originX) / size - 0.5, fz = (z - grid.originZ) / size - 0.5;
  const x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0;
  const at = (xi, zi) => decodeHeightRaw(L.data[Math.min(L.height - 1, Math.max(0, zi)) * L.width + Math.min(L.width - 1, Math.max(0, xi))]);
  const v = (1 - tz) * ((1 - tx) * at(x0, z0) + tx * at(x0 + 1, z0)) + tz * ((1 - tx) * at(x0, z0 + 1) + tx * at(x0 + 1, z0 + 1));
  return v * v * (MAX_HEIGHT + grid.offset) - grid.offset;
}
// (the GPU filters the square-root code, then squares it: the same here)
const decodeHeightRaw = (v) => v / 255;

// The share of the cosine-weighted irradiance of an open sky that reaches a surface at (px, py, pz) facing n: 1 on an open
// field facing up, 0.5 on a wall facing open ground.
function visibility(pyramid, grid, p, n, { slices = SLICES, steps = STEP_COUNT, bias = 0 } = {}) {
  const px = p[0] + n[0] * grid.texel, py = p[1] + n[1] * grid.texel, pz = p[2] + n[2] * grid.texel;
  const floor = py + HEIGHT_BIAS + bias;
  let sum = 0;
  for (let s = 0; s < slices; s++) {
    const phi = (s + 0.5) * Math.PI * 2 / slices, dx = Math.cos(phi), dz = Math.sin(phi);
    const rx = dx + n[0] * WALL_CLEARANCE, rz = dz + n[2] * WALL_CLEARANCE, rl = Math.hypot(rx, rz);
    let tanH = 0;
    for (let k = 0; k < steps; k++) {
      const dist = stepDistance(k, steps);
      const lod = Math.log2(Math.max(1, dist / TEXELS_PER_STEP / grid.texel));
      const h = heightAt(pyramid, grid, px + rx * dist, pz + rz * dist, lod);
      tanH = Math.max(tanH, (h - floor) / (rl * dist));
    }
    const tH = Math.atan(tanH), cosH = Math.cos(tH);
    const slice = n[1] * cosH * cosH * 0.5 + (n[0] * dx + n[2] * dz) * (Math.PI / 4 - tH * 0.5 - Math.sin(2 * tH) * 0.25);
    sum += Math.max(slice, 0);
  }
  return Math.min(sum * 2 / slices, 1);
}

// The same integral by brute force: 64 slices, the horizon found texel by texel out to 320 m (level 0 to 64 m, then
// level 1, then level 2: every step reads one texel of the level whose texels are at most 4x its spacing)
function visibilityReference(pyramid, grid, p, n) {
  const px = p[0] + n[0] * grid.texel, py = p[1] + n[1] * grid.texel, pz = p[2] + n[2] * grid.texel;
  const floor = py + HEIGHT_BIAS, S = 64;
  const near = (x, z) => { const L = pyramid[0]; const c = Math.floor((x - grid.originX) / grid.texel), r = Math.floor((z - grid.originZ) / grid.texel); return (c < 0 || r < 0 || c >= L.width || r >= L.height) ? 0 : decodeHeight(L.data[r * L.width + c], grid.offset); };
  let sum = 0;
  for (let s = 0; s < S; s++) {
    const phi = (s + 0.5) * Math.PI * 2 / S, dx = Math.cos(phi), dz = Math.sin(phi);
    let tanH = 0;
    for (let dist = grid.texel; dist <= 320; dist += grid.texel * (dist < 64 ? 1 : 2)) {
      tanH = Math.max(tanH, (near(px + dx * dist, pz + dz * dist) - floor) / dist);
    }
    const tH = Math.atan(tanH), cosH = Math.cos(tH);
    const slice = n[1] * cosH * cosH * 0.5 + (n[0] * dx + n[2] * dz) * (Math.PI / 4 - tH * 0.5 - Math.sin(2 * tH) * 0.25);
    sum += Math.max(slice, 0);
  }
  return Math.min(sum * 2 / S, 1);
}

// ---- the quality tier's setting & the runtime -------------------------------------------------------------------------
const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
// { slices, steps } or null (off: the materials keep their height-only canyon AO). ?skyocc=0 turns it off, for A/B.
const SETTING = (() => {
  if (params.get('skyocc') === '0') return null;
  const Q = C.QUALITY;
  const s = Q ? Q.skyOcclusion : { slices: SLICES, steps: STEP_COUNT };
  return s || null;
})();

const state = {
  setting: SETTING, active: false, stats: null,
  // lighting.js sets these with the time of day: the bounce's share of the sky's irradiance (0 to 1)
  fillRatio: null
};

let runtime = null; // the TSL nodes, once there is a map to bind

// The nodes the materials call (tsl-materials.js canyonSkyAONode). The height map's texture is a 1x1 placeholder until
// attach() swaps the real one in before the first render; until then (and on tiers with the pass off) the node reads 1.
function createNodes() {
  const TSL = C.TSL, THREE = C.THREE;
  if (!TSL || !SETTING || runtime) return runtime;
  const { Fn, Loop, If, float, vec2, vec3, vec4, uniform, texture, max, min, atan, sin, cos, dot, log2, exp2, positionWorld, cameraPosition, length, smoothstep, mix, renderGroup } = TSL;
  const placeholder = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
  placeholder.needsUpdate = true;
  const map = texture(placeholder);
  // (renderGroup: one upload per render, not per object, like the other city-wide uniforms)
  const frame = uniform(vec4(0, 0, 1, 1)).setGroup(renderGroup); // origin x, z, 1 / width m, 1 / depth m
  const texelM = uniform(4).setGroup(renderGroup);
  const offsetM = uniform(0).setGroup(renderGroup); // m: how far under the street level the map's ground goes
  const on = uniform(0).setGroup(renderGroup);
  const fill = uniform(0.3).setGroup(renderGroup);
  // The bounce's colours (setBounce): the light a hidden slice of sky is made up with, as irradiance over pi (what a
  // material's albedo is multiplied by), from the walls the sun lights (warm) and from those in shade (cool); where the
  // sun is (a unit vector on the ground plane, and how far up it is); how much the sun lights the walls at all
  const warmColor = uniform(new THREE.Color(0, 0, 0)).setGroup(renderGroup);
  const coolColor = uniform(new THREE.Color(0, 0, 0)).setGroup(renderGroup);
  const sunXZ = uniform(new THREE.Vector2(1, 0)).setGroup(renderGroup);
  const sunLit = uniform(0).setGroup(renderGroup);
  const slices = SETTING.slices, steps = SETTING.steps;
  const stepLog2 = Math.log2(FAR / NEAR) / (steps - 1);
  const RANGE = SETTING.range || 700; // m from the camera past which the fragment is left open (faded over the last 30%)

  const heightNode = (xz, level) => {
    const v = map.sample(xz.sub(frame.xy).mul(frame.zw)).level(level).r;
    return v.mul(v).mul(offsetM.add(MAX_HEIGHT)).sub(offsetM);
  };

  // The sky the fragment sees (x), and how much of what it can't see is hidden by walls the sun lights (y: sunward of the
  // fragment's slices turned away from the sun) and by walls in shade (z), as shares of the hemisphere (x + y + z = 1)
  const visibilityOf = Fn(([positionWorldN, normalWorldN]) => {
    const n = normalWorldN.toVar();
    const p = positionWorldN.add(n.mul(texelM)).toVar();
    const floorY = p.y.add(HEIGHT_BIAS).toVar();
    const sum = float(0).toVar();
    const warm = float(0).toVar();
    const lostSum = float(0).toVar();
    Loop(slices, ({ i: s }) => {
      const phi = float(s).add(0.5).mul(Math.PI * 2 / slices);
      const d = vec2(cos(phi), sin(phi));
      const reach = d.add(n.xz.mul(WALL_CLEARANCE)).toVar();
      const reachLength = length(reach);
      const tanH = float(0).toVar();
      Loop(steps, ({ i: k }) => {
        const dist = exp2(float(k).mul(stepLog2)).mul(NEAR);
        const lod = log2(max(dist.div(TEXELS_PER_STEP).div(texelM), 1));
        tanH.assign(max(tanH, heightNode(p.xz.add(reach.mul(dist)), lod).sub(floorY).div(reachLength.mul(dist))));
      });
      const tH = atan(tanH).toVar();
      const cosH = cos(tH);
      const along = dot(n.xz, d);
      const slice = max(n.y.mul(cosH).mul(cosH).mul(0.5)
        .add(along.mul(float(Math.PI / 4).sub(tH.mul(0.5)).sub(sin(tH.mul(2)).mul(0.25)))), 0);
      sum.addAssign(slice);
      // what this slice lost to the buildings, against the open sky (a horizon at 0): a wall that faces us from
      // the sunward side is in shade, one on the far side from the sun has the sun on it
      const lost = max(max(n.y.mul(0.5).add(along.mul(Math.PI / 4)), 0).sub(slice), 0);
      lostSum.addAssign(lost);
      warm.addAssign(lost.mul(smoothstep(-0.3, 0.3, dot(d, sunXZ).negate())));
    });
    const visible = min(sum.mul(2 / slices), 1);
    const covered = visible.oneMinus();
    const litShare = warm.mul(2 / slices);
    const lostShare = min(lostSum.mul(2 / slices), covered);
    // (what the slices don't account for, the half of a wall's hemisphere under the horizon, is the ground: the sunlit
    // street, the warm side)
    const ground = covered.sub(lostShare);
    // (no sun on the walls: half and half)
    const warmShare = mix(lostShare.mul(0.5), litShare, sunLit).add(ground).min(covered);
    return vec3(visible, warmShare, covered.sub(warmShare));
  });

  // What aoNode gets: the share of the sky's irradiance that reaches the fragment, with the hidden part refilled by the
  // bounce, and left open past RANGE from the camera (where the fragment is a few pixels and the haze has taken it)
  const aoAt = Fn(([positionWorldN, normalWorldN]) => {
    const ao = float(1).toVar();
    const dist = length(positionWorldN.sub(cameraPosition));
    If(on.greaterThan(0.5).and(dist.lessThan(RANGE)), () => {
      const vis = visibilityOf(positionWorldN, normalWorldN).x;
      const covered = vis.oneMinus().mul(smoothstep(RANGE, RANGE * 0.7, dist));
      ao.assign(float(1).sub(covered.mul(float(1).sub(fill))));
    });
    return ao;
  });

  // The same, with the bounce's colour: (the sky's share, the share hidden by sunlit walls, by walls in shade), the
  // hidden shares faded out like the sky's
  const lightAt = Fn(([positionWorldN, normalWorldN]) => {
    const out = vec3(1, 0, 0).toVar();
    const dist = length(positionWorldN.sub(cameraPosition));
    If(on.greaterThan(0.5).and(dist.lessThan(RANGE)), () => {
      const v = visibilityOf(positionWorldN, normalWorldN);
      const fade = smoothstep(RANGE, RANGE * 0.7, dist);
      out.assign(vec3(float(1).sub(v.x.oneMinus().mul(fade)), v.y.mul(fade), v.z.mul(fade)));
    });
    return out;
  });

  runtime = { map, frame, texelM, offsetM, on, fill, warmColor, coolColor, sunXZ, sunLit, aoAt, lightAt, visibilityOf, heightNode, placeholder, THREE };
  return runtime;
}

// Called by tsl-materials.js while it builds its materials. Null when the tier has no pass.
function aoNode(positionN, normalN) {
  const r = createNodes();
  return r ? r.aoAt(positionN, normalN) : null;
}

// The coloured version, for the materials that add the bounce (tsl-materials.js canyonLight): { ao, bounce(albedo) }, both
// reading one search of the height map. ao is the sky's share alone (no refill); bounce is what the refill is, as light:
// the albedo times the warm and cool colours by how much of the sky each hides. Null on tiers with the pass off.
function lightNode(positionN, normalN) {
  const r = createNodes();
  if (!r) return null;
  const occ = r.lightAt(positionN, normalN).toVar();
  return { ao: occ.x, bounce: (albedo) => albedo.mul(r.warmColor.mul(occ.y).add(r.coolColor.mul(occ.z))) };
}

// Builds the map from the loaded city and switches the nodes on. colliders: everything solid in the map; bounds: the
// loaded map's extent ({ minX, maxX, minZ, maxZ }). Optional: meshRoots, models drawn as they are (landmarks);
// groundAt(x, z), the ground's height over the street level (terrain, High Park's ravines); crowns, the trees
// (treesToGrid), drawn while the trees are in leaf (setLeaf).
function attach(colliders, bounds, { meshRoots = [], groundAt = null, crowns = null, leaf = 0 } = {}) {
  const r = createNodes();
  if (!r) return null;
  const t0 = performance.now();
  const margin = 300; // m: the buildings just outside the map still shade its edge
  const texel = chooseTexel(bounds.maxX - bounds.minX + 2 * margin, bounds.maxZ - bounds.minZ + 2 * margin, SETTING.texel || {});
  let grid = createGrid(bounds, margin, texel);
  let lattice = null;
  if (groundAt) {
    lattice = groundLattice(grid, groundAt);
    grid = createGrid(bounds, margin, texel, lattice.offset);
    fillGround(grid, lattice);
  }
  const tGround = performance.now();
  const used = collidersToGrid(grid, colliders);
  const tRaster = performance.now();
  let triangles = 0;
  if (meshRoots.length) triangles = rasterMeshes(grid, meshRoots);
  const tMeshes = performance.now();
  const pyramid = buildPyramid(grid);
  state.active = true;
  state.grid = grid;
  state.lattice = lattice;
  state.crowns = crowns;
  state.groundAt = lattice ? (x, z) => latticeAt(lattice, x, z) : null;
  state.variants = { bare: { grid, pyramid }, leaf: null };
  state.which = 'bare';
  r.frame.value.set(grid.originX, grid.originZ, 1 / (grid.width * texel), 1 / (grid.height * texel));
  r.texelM.value = texel;
  r.offsetM.value = grid.offset;
  // The nodes hold the placeholder texture by reference (a texture node's sample() copies the node, not the texture), so
  // the real map goes into it: before its first upload the 1x1 is replaced as is; later it would be disposed & re-made
  r.placeholder.dispose();
  showVariant(r, 'bare');
  r.on.value = 1;
  let bytes = 0;
  for (const l of pyramid) bytes += l.data.byteLength;
  const flat = encodeHeight(0, grid.offset);
  let covered = 0;
  for (let i = 0; i < grid.data.length; i++) if (grid.data[i] > flat) covered++;
  state.stats = {
    texel, width: grid.width, height: grid.height, megabytes: +(bytes / 1048576).toFixed(1), colliders: used, triangles,
    offset: grid.offset, groundMin: lattice ? +lattice.min.toFixed(1) : 0, groundMax: lattice ? +lattice.max.toFixed(1) : 0, crowns: crowns ? crowns.count : 0,
    builtUp: +(covered / grid.data.length).toFixed(3),
    ms: { ground: Math.round(tGround - t0), raster: Math.round(tRaster - tGround), meshes: Math.round(tMeshes - tRaster), total: Math.round(performance.now() - t0) }
  };
  console.info(`[skyOcclusion] ${grid.width}x${grid.height} texels of ${texel} m, ${state.stats.megabytes} MB, ${used} colliders, ground ${state.stats.groundMin}..${state.stats.groundMax} m, ${state.stats.ms.total} ms (${SETTING.slices} slices x ${SETTING.steps} steps)`);
  if (leaf) setLeaf(leaf);
  return state.stats;
}

// Puts one of the two maps (without the trees, with them) in the texture
function showVariant(r, which) {
  const { grid, pyramid } = state.variants[which];
  const map = r.placeholder;
  map.image = { data: pyramid[0].data, width: grid.width, height: grid.height };
  map.mipmaps = pyramid;
  map.generateMipmaps = false;
  map.magFilter = r.THREE.LinearFilter;
  map.minFilter = r.THREE.LinearMipmapLinearFilter;
  map.needsUpdate = true;
  state.which = which;
}

// The trees' season (cityUniforms.uLeaf, 0 bare to 1 in leaf): in leaf (half or more) their crowns are in the map. The
// leaf map is made the first time it is wanted (the bare one stays), then swapped in: a texture upload
function setLeaf(leaf) {
  const r = runtime;
  if (!r || !state.active || !state.crowns || !state.crowns.count) return state.which;
  const want = leaf >= 0.5 ? 'leaf' : 'bare';
  if (want === state.which) return want;
  if (want === 'leaf' && !state.variants.leaf) {
    const t0 = performance.now();
    const bare = state.variants.bare.grid;
    const grid = { ...bare, data: bare.data.slice() };
    const drawn = treesToGrid(grid, state.crowns, state.groundAt);
    state.variants.leaf = { grid, pyramid: buildPyramid(grid) };
    state.stats.leafMs = Math.round(performance.now() - t0);
    state.stats.treesDrawn = drawn;
    console.info(`[skyOcclusion] leaf map: ${drawn} crowns, ${state.stats.leafMs} ms`);
  }
  showVariant(r, want);
  return want;
}

function rasterMeshes(grid, roots) {
  const THREE = C.THREE, v = new THREE.Vector3(), matrix = new THREE.Matrix4();
  let triangles = 0;
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    root.traverse((mesh) => {
      if (!mesh.isMesh || mesh.isInstancedMesh || !mesh.visible || (mesh.material && mesh.material.transparent) || !mesh.geometry.attributes.position) return;
      const position = mesh.geometry.attributes.position, index = mesh.geometry.index;
      matrix.copy(mesh.matrixWorld);
      const pts = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i++) { v.fromBufferAttribute(position, i).applyMatrix4(matrix); pts[i * 3] = v.x; pts[i * 3 + 1] = v.y; pts[i * 3 + 2] = v.z; }
      for (let t = 0, n = index ? index.count : position.count; t + 2 < n; t += 3) {
        const a = (index ? index.getX(t) : t) * 3, b = (index ? index.getX(t + 1) : t + 1) * 3, c = (index ? index.getX(t + 2) : t + 2) * 3;
        fillTriangle(grid, pts[a], pts[a + 2], pts[a + 1], pts[b], pts[b + 2], pts[b + 1], pts[c], pts[c + 2], pts[c + 1]);
        triangles++;
      }
    });
  }
  return triangles;
}

// The time of day's bounce as a share of the sky's irradiance: the hemisphere light's ground colour x its canyon bounce
// over its sky colour (luminances), what refills the part of the sky the buildings hide. lighting.js calls this.
// sun: { dir (a unit vector toward the sun, world frame), color (hex), intensity, nightFactor }, for the coloured bounce.
function setBounce(hemiLight, canyonBounce, sun = null) {
  if (!runtime) return;
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const sky = Math.max(lum(hemiLight.color), 1e-4);
  const ratio = Math.min(0.65, lum(hemiLight.groundColor) * canyonBounce / sky);
  state.fillRatio = ratio;
  runtime.fill.value = ratio;
  const lit = sun ? sunLitness(sun.intensity, sun.nightFactor) : 0;
  const c = bounceColours(hemiLight.color, hemiLight.groundColor, hemiLight.intensity, canyonBounce, sun ? sun.color : 0xffffff, lit);
  runtime.warmColor.value.setRGB(...c.warm);
  runtime.coolColor.value.setRGB(...c.cool);
  if (sun && sun.dir) {
    const h = Math.hypot(sun.dir.x, sun.dir.z) || 1;
    runtime.sunXZ.value.set(sun.dir.x / h, sun.dir.z / h);
  }
  runtime.sunLit.value = lit;
  state.bounce = { ...c, sunLit: lit };
}

// How much the sun is on the city's walls: nothing under the moon or a heavy overcast, all of it from a clear day's sun
// (sunIntensity 6 at midday, 3 at the last light)
function sunLitness(intensity, nightFactor = 0) {
  const t = Math.min(1, Math.max(0, (intensity - 2) / 3));
  return t * t * (3 - 2 * t) * (1 - Math.min(1, Math.max(0, nightFactor)));
}

// The bounce's two colours, as the light a material's albedo is multiplied by (the hemisphere light's irradiance over pi:
// what its indirect diffuse is). Walls the sun lights bounce warm, the colour of the hemisphere light's ground (the sunlit
// masonry & pavement), a little toward the sun's; walls in shade only the sky's, more of the ground's the less it is
// blue. Together they hold the luminance the single bounce had: the ground's times the canyon bounce, over pi.
function bounceColours(sky, ground, intensity, canyonBounce, sunHex, sunLit) {
  const k = intensity * canyonBounce / Math.PI;
  const sunRGB = [((sunHex >> 16) & 255) / 255, ((sunHex >> 8) & 255) / 255, (sunHex & 255) / 255];
  // (the sun's colour is in sRGB; the tint is a nudge, not a calculation)
  const lin = (v) => Math.pow(v, 2.2);
  const g = [ground.r, ground.g, ground.b], s = [sky.r, sky.g, sky.b];
  const warm = g.map((v, i) => k * 1.2 * (v * (1 - 0.25 * sunLit) + lin(sunRGB[i]) * 0.25 * sunLit * (ground.r + ground.g + ground.b) / 3));
  const cool = g.map((v, i) => k * 0.7 * (s[i] * 0.65 + v * 0.35));
  return { warm, cool };
}

C.SkyOcclusion = {
  MAX_HEIGHT, SLICES, STEP_COUNT, NEAR, FAR,
  encodeHeight, decodeHeight, chooseTexel, createGrid, fillRings, fillTriangle, fillDisc, isBuildingCollider, collidersToGrid, buildPyramid,
  groundLattice, fillGround, latticeAt, treesToGrid, CROWN_SHARE,
  heightAt, visibility, visibilityReference, stepDistance,
  aoNode, lightNode, attach, setBounce, setLeaf, bounceColours, sunLitness, state, get runtime() { return runtime; }
};
})();
