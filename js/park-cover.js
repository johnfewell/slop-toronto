(function () {
// js/park-cover.js — High Park's ground cover and understory (docs/park-cover.md, beads st-annt, st-annt.3): what
// the black oak savanna and the woods grow under their trees, which the park had as a flat colour.
// - The tall grass and forbs: the savanna's and the meadows' big and little bluestem, goldenrod and asters, knee to
//   waist high, to the trails' edges; the woods' ground plants (broad-leaved herbs, ferns) over the litter. Drawn on
//   the GPU in rings round the viewer (after threejs-nanites' grass, MIT, Victor Zakharov: see CREDITS.md): each ring a
//   grid of cells that follows the camera, snapped to whole cells, so a clump stays where it stands; each cell's clump
//   is decided in the vertex shader from a hash of the cell and the park's maps (where it is meadow, savanna or woods
//   floor, how far from a path), its height from the terrain's own grid triangles. Coarser cells and bigger clumps
//   further out, cross-faded by a dither, out to the meadow's ground colour.
// - The shrub layer: the savanna's thickets of sumac, dogwood and serviceberry and the oak sprouts where the lidar
//   saw vegetation 1-5 m tall (js/high-park-cover-data.js, tools/build-park-cover.mjs), and the woods' understory by
//   rule (saplings and shrubs under closed canopy, more in the ravines and at the woods' edges). Instanced leaf-card
//   shrubs, a rounded mesh near and three crossed cards further out, dissolving into each other and out at the edge.
// Everything keeps off the park's paths, beds, paved areas, courts and buildings (a 1 m clearance map), and off the
// lawns, the ponds and the water edges (the woods data's ground: lawn and off-island cells grow nothing).
// The pilot: High Park's box only (ROLLOUT, as water-edges.js's). ?parkcover=0: the park as before (A/B);
// ?parkcover=grass / shrubs: only that layer. Nothing is drawn or updated while the camera is away from the box.
const C = window.CITY;
const params = new URLSearchParams(location.search);
const MODE = params.get('parkcover');
const D = C.HIGH_PARK_COVER_DATA, PW = C.parkWoods;
if (!D || !PW || MODE === '0') return;
const GRASS = MODE !== 'shrubs', SHRUBS = MODE !== 'grass';
const Q = C.QUALITY || { tier: 'high' };
const TIER = Q.tier === 'low' ? 'low' : Q.tier === 'medium' ? 'medium' : 'high';
// The rollout: the pilot's box (High Park's), [x0, z0, x1, z1]
const ROLLOUT = { 'high-park': [D.box.x0, D.box.z0, D.box.x1, D.box.z1] };
const BOX = D.box;
const NEAR_BOX = 250; // (m: the layers are on while the camera is this near the box)

// The grass rings by tier: cell (m), outer radius (m); each fades in over the last FADE of the ring inside it
const RINGS = {
  high: [{ cell: 0.42, r: 16 }, { cell: 0.84, r: 36 }, { cell: 1.68, r: 76 }, { cell: 3.36, r: 150 }],
  medium: [{ cell: 0.5, r: 14 }, { cell: 1.0, r: 32 }, { cell: 2.0, r: 66 }, { cell: 4.0, r: 120 }],
  low: [{ cell: 0.62, r: 11 }, { cell: 1.24, r: 26 }, { cell: 2.48, r: 56 }]
}[TIER];
const FADE = 0.25;
// The shrubs' hand-overs by tier (m): rounded mesh within, crossed cards out to the last
const SHRUB = { high: { near: 38, far: 190 }, medium: { near: 30, far: 150 }, low: { near: 18, far: 100 } }[TIER];
const SHRUB_BAND = [8, 30];

const hash2 = (x, z, k) => { const s = Math.sin(x * 127.1 + z * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };
const stats = { on: true, mode: MODE || 'all', tier: TIER, shrubs: 0, rings: RINGS.length, instances: 0, ms: {}, rollout: Object.keys(ROLLOUT) };

// ---------------------------------------------------------------------------------------------------------------------
// The maps: habitat (4 m, the woods data's grid) and the clearance from paths & everything off the cover (1 m)
// ---------------------------------------------------------------------------------------------------------------------
const WD = PW.parks[0];
const CELL4 = D.shrub.cell, W4 = D.shrub.w, H4 = D.shrub.h;
const W1 = Math.round(BOX.x1 - BOX.x0), H1 = Math.round(BOX.z1 - BOX.z0);
function unpack2(b64, n) {
  const bin = atob(b64), k = new Uint8Array(n);
  for (let q = 0; q < n; q++) k[q] = (bin.charCodeAt(q >> 2) >> ((q & 3) * 2)) & 3;
  return k;
}
// The distance (eighths of a metre: straight steps 8, diagonal 11) from every cell of a W1 x H1 mask to its nearest
// set cell, by a two-pass chamfer, capped at 64 m
function chamfer(mask) {
  const dist = new Uint16Array(W1 * H1);
  const BIG = 8 * 64;
  for (let k = 0; k < W1 * H1; k++) dist[k] = mask[k] ? 0 : BIG;
  for (let j = 0; j < H1; j++) for (let i = 0, k = j * W1; i < W1; i++, k++) {
    let d = dist[k], t;
    if (!d) continue;
    if (i > 0 && (t = dist[k - 1] + 8) < d) d = t;
    if (j > 0) {
      if ((t = dist[k - W1] + 8) < d) d = t;
      if (i > 0 && (t = dist[k - W1 - 1] + 11) < d) d = t;
      if (i < W1 - 1 && (t = dist[k - W1 + 1] + 11) < d) d = t;
    }
    dist[k] = d;
  }
  for (let j = H1 - 1; j >= 0; j--) for (let i = W1 - 1, k = j * W1 + i; i >= 0; i--, k--) {
    let d = dist[k], t;
    if (!d) continue;
    if (i < W1 - 1 && (t = dist[k + 1] + 8) < d) d = t;
    if (j < H1 - 1) {
      if ((t = dist[k + W1] + 8) < d) d = t;
      if (i < W1 - 1 && (t = dist[k + W1 + 1] + 11) < d) d = t;
      if (i > 0 && (t = dist[k + W1 - 1] + 11) < d) d = t;
    }
    dist[k] = d;
  }
  return dist;
}
// Rasterizers into a W1 x H1 mask: a thick segment, a polygon (scanline, plus `grow` m round its outline)
function rasterSeg(mask, ax, az, bx, bz, r) {
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r - BOX.x0)), x1 = Math.min(W1 - 1, Math.ceil(Math.max(ax, bx) + r - BOX.x0));
  const z0 = Math.max(0, Math.floor(Math.min(az, bz) - r - BOX.z0)), z1 = Math.min(H1 - 1, Math.ceil(Math.max(az, bz) + r - BOX.z0));
  const ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez || 1e-9;
  for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
    const x = BOX.x0 + i + 0.5, z = BOX.z0 + j + 0.5, t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L2));
    const dx = ax + ex * t - x, dz = az + ez * t - z;
    if (dx * dx + dz * dz <= r * r) mask[j * W1 + i] = 1;
  }
}
function rasterPoly(mask, pts, grow = 0, holes = []) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  if (x1 < BOX.x0 || x0 > BOX.x1 || z1 < BOX.z0 || z0 > BOX.z1) return;
  const i0 = Math.max(0, Math.floor(x0 - BOX.x0)), i1 = Math.min(W1 - 1, Math.ceil(x1 - BOX.x0)), j0 = Math.max(0, Math.floor(z0 - BOX.z0)), j1 = Math.min(H1 - 1, Math.ceil(z1 - BOX.z0));
  const rings = [pts, ...holes];
  for (let j = j0; j <= j1; j++) {
    const z = BOX.z0 + j + 0.5, xs = [];
    // (even-odd over the outline and its holes)
    for (const ring of rings) for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
      const [ax, az] = ring[a], [bx, bz] = ring[b];
      if ((az > z) !== (bz > z)) xs.push(ax + ((z - az) * (bx - ax)) / (bz - az));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const s0 = Math.max(i0, Math.ceil(xs[k] - BOX.x0 - 0.5)), s1 = Math.min(i1, Math.floor(xs[k + 1] - BOX.x0 - 0.5));
      for (let i = s0; i <= s1; i++) mask[j * W1 + i] = 1;
    }
  }
  if (grow > 0) for (const ring of rings) for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) rasterSeg(mask, ring[b][0], ring[b][1], ring[a][0], ring[a][1], grow);
}
// Grenadier Pond's shore (John 2026-11-06, photo 9): willows and shrubs down to the water in place of the lawn, the
// water edges' margin kept. ?shore=0: the lawn as before. Plants keep WATER_MARGIN m off every pond (the water edges'
// mud and reeds); the shore band is SHORE_BAND m deep round the park's biggest pond
const SHORE_ON = params.get('shore') !== '0';
const WATER_MARGIN = 2.5, SHORE_BAND = 14;
let maps = null, natTrails = [];
function buildMaps() {
  if (maps) return maps;
  const t0 = performance.now();
  const woods = C.HIGH_PARK_WOODS_DATA;
  const kind = unpack2(woods.ground.cells, W4 * H4); // 0 off, 1 lawn, 2 meadow, 3 canopy
  const shrub = unpack2(D.shrub.cells, W4 * H4);
  const cover = WD.groundCover(); // (RGBA: R woodland floor, G meadow, B open)
  // habitat, RGBA8 over the 4 m grid: R tall grass & forbs (the meadow, and the floor where it is open: the savanna's
  // grass under its oaks), G the woods' ground plants (the floor where it is closed), B the lidar's shrub layer, A ravine
  const hab = new Uint8Array(W4 * H4 * 4);
  for (let q = 0; q < W4 * H4; q++) {
    if (kind[q] < 2) continue;
    const floor = cover.data[q * 4] / 255, meadow = cover.data[q * 4 + 1] / 255, open = cover.data[q * 4 + 2] / 255;
    const tall = Math.max(meadow, kind[q] === 2 ? 1 : 0, floor * open);
    hab[q * 4] = Math.round(255 * Math.min(1, tall));
    hab[q * 4 + 1] = Math.round(255 * floor * (1 - open));
    hab[q * 4 + 2] = shrub[q] * 85;
  }
  // the ravines: the crowns there mark their cells (the woods data's ravine flag), smoothed by the 3 x 3 round
  const rav = new Uint8Array(W4 * H4);
  for (const c of WD.crowns()) {
    if (!c.ravine) continue;
    const i = Math.floor((c.x - BOX.x0) / CELL4), j = Math.floor((c.z - BOX.z0) / CELL4);
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < W4 && jj < H4) rav[jj * W4 + ii] = 1; }
  }
  for (let q = 0; q < W4 * H4; q++) hab[q * 4 + 3] = rav[q] ? 255 : 0;
  // the ponds (1 m), and the biggest's distance (the shore band)
  const water = new Uint8Array(W1 * H1), grenadier = new Uint8Array(W1 * H1);
  let big = null, bigA = 0;
  for (const [k, , flat] of C.GEO.areas) {
    if (k !== 'water') continue;
    const pts = []; for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
    if (!pts.some(([x, z]) => x > BOX.x0 && x < BOX.x1 && z > BOX.z0 && z < BOX.z1)) continue;
    let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    rasterPoly(water, pts);
    if (Math.abs(a) > bigA) { bigA = Math.abs(a); big = pts; }
  }
  if (big) rasterPoly(grenadier, big);
  const dWater = chamfer(water), dShore = SHORE_ON && big ? chamfer(grenadier) : null;
  // the shore band's 4 m cells (on the park's islands, its lawn too): tall grass and forbs, shrubs (shrubSites)
  const shore = new Uint8Array(W4 * H4);
  if (dShore) for (let j = 0; j < H1; j++) for (let i = 0; i < W1; i++) {
    const d = dShore[j * W1 + i];
    if (!d || d > SHORE_BAND * 8) continue;
    const q = Math.min(H4 - 1, (j / CELL4) | 0) * W4 + Math.min(W4 - 1, (i / CELL4) | 0);
    if (kind[q] >= 1) shore[q] = 1;
  }
  for (let q = 0; q < W4 * H4; q++) if (shore[q]) hab[q * 4] = Math.max(hab[q * 4], 220);

  // clearance (1 m), signed metres: how far each texel is from the nearest path, bed, paved area, building, sidewalk,
  // court, rink or pond (less the ponds' margin), negative inside one. The paths and the outlines are measured exactly
  // (each texel's distance to the segment or the polygon's edge), so the field is smooth and the plants' edge along a
  // trail follows its outline, linearly filtered, not the 1 m grid's stair steps. Only the lawns' and the kerbs' edges
  // (the woods data's 4 m cells, the islands' outlines) are rasters, by a two-pass chamfer
  const blocked = new Uint8Array(W1 * H1);
  for (let j = 0; j < H1; j++) {
    const row = Math.min(H4 - 1, (j / CELL4) | 0) * W4, o = j * W1;
    for (let ci = 0; ci < W4; ci++) if (kind[row + ci] < 2 && !(kind[row + ci] === 1 && shore[row + ci])) blocked.fill(1, o + ci * CELL4, Math.min(W1, (ci + 1) * CELL4) + o);
  }
  // (the 4 m grid's cells at the islands' edges straddle the kerbs: there each metre is asked whether it is on the
  // park's islands, so nothing grows over a kerb onto a road)
  if (C.blockAt) for (let cj = 0; cj < H4; cj++) for (let ci = 0; ci < W4; ci++) {
    const q = cj * W4 + ci;
    if (kind[q] === 0) continue;
    let edge = false;
    for (let dj = -1; dj <= 1 && !edge; dj++) for (let di = -1; di <= 1; di++) { const ii = ci + di, jj = cj + dj; if (ii >= 0 && jj >= 0 && ii < W4 && jj < H4 && kind[jj * W4 + ii] === 0) { edge = true; break; } }
    if (!edge) continue;
    for (let j = cj * CELL4; j < Math.min(H1, (cj + 1) * CELL4); j++) for (let i = ci * CELL4; i < Math.min(W1, (ci + 1) * CELL4); i++) {
      const b = C.blockAt(BOX.x0 + i + 0.5, BOX.z0 + j + 0.5);
      if (!(b && PW.replacesBlock(b))) blocked[j * W1 + i] = 1;
    }
  }
  const REACH = 6; // (m: the field is exact this far out; beyond it, it says REACH)
  // (two fields: the plants' (exG: the ground cover grows into a natural trail's corridor to its worn earth) and the
  // shrubs' (exS: the corridor kept clear of bulk); the same but for the natural trails)
  const exG = new Float32Array(W1 * H1).fill(REACH);
  let ex = exG;
  // a capsule: the segment a-b grown by r (or, for a natural trail, by rAt(x, z) <= r: its plants' edge, wandering)
  const exactSeg = (ax, az, bx, bz, r, rAt = null, ex = exG) => {
    const R = r + REACH;
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - R - BOX.x0)), i1 = Math.min(W1 - 1, Math.ceil(Math.max(ax, bx) + R - BOX.x0));
    const j0 = Math.max(0, Math.floor(Math.min(az, bz) - R - BOX.z0)), j1 = Math.min(H1 - 1, Math.ceil(Math.max(az, bz) + R - BOX.z0));
    const exx = bx - ax, ezz = bz - az, L2 = exx * exx + ezz * ezz || 1e-9;
    // (a wandering edge: sampled every 0.5 m along the segment, at its centreline, and interpolated)
    const NS = rAt ? Math.max(1, Math.ceil(Math.sqrt(L2) / 0.5)) : 0, rs = rAt ? new Float32Array(NS + 1) : null;
    for (let q = 0; q <= NS && rs; q++) rs[q] = rAt(ax + (exx * q) / NS, az + (ezz * q) / NS, q / NS);
    for (let j = j0; j <= j1; j++) {
      const z = BOX.z0 + j + 0.5;
      for (let i = i0; i <= i1; i++) {
        const x = BOX.x0 + i + 0.5;
        let t = ((x - ax) * exx + (z - az) * ezz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = ax + exx * t - x, dz = az + ezz * t - z, k = j * W1 + i;
        let d = Math.sqrt(dx * dx + dz * dz);
        if (d - r >= ex[k]) continue;
        if (rs) { const f = t * NS, q = Math.min(NS - 1, f | 0), u = f - q; d -= rs[q] + (rs[q + 1] - rs[q]) * u; } else d -= r;
        if (d < ex[k]) ex[k] = d;
      }
    }
  };
  // polygons (with holes), grown by `grow`: the exact distance to their edges, negative inside (a raster, signed)
  const ed = new Float32Array(W1 * H1), inside = new Uint8Array(W1 * H1);
  const exactPolys = (list, grow) => {
    ed.fill(1e9); inside.fill(0);
    for (const { pts, holes = [] } of list) {
      rasterPoly(inside, pts, 0, holes);
      for (const ring of [pts, ...holes]) for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
        const [ax, az] = ring[b], [bx, bz] = ring[a], R = grow + REACH;
        const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - R - BOX.x0)), i1 = Math.min(W1 - 1, Math.ceil(Math.max(ax, bx) + R - BOX.x0));
        const j0 = Math.max(0, Math.floor(Math.min(az, bz) - R - BOX.z0)), j1 = Math.min(H1 - 1, Math.ceil(Math.max(az, bz) + R - BOX.z0));
        if (i0 > i1 || j0 > j1) continue;
        const exx = bx - ax, ezz = bz - az, L2 = exx * exx + ezz * ezz || 1e-9;
        for (let j = j0; j <= j1; j++) {
          const z = BOX.z0 + j + 0.5;
          for (let i = i0; i <= i1; i++) {
            const x = BOX.x0 + i + 0.5;
            let t = ((x - ax) * exx + (z - az) * ezz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
            const dx = ax + exx * t - x, dz = az + ezz * t - z, d = Math.sqrt(dx * dx + dz * dz), k = j * W1 + i;
            if (d < ed[k]) ed[k] = d;
          }
        }
      }
    }
    for (let k = 0; k < W1 * H1; k++) {
      if (ed[k] > 1e8 && !inside[k]) continue; // (out of every outline's reach)
      const e = ed[k] > 1e8 ? -REACH : inside[k] ? -ed[k] : ed[k], d = e - grow;
      if (d < ex[k]) ex[k] = d;
    }
  };
  const ring = (flat) => { const p = []; for (let i = 0; i < flat.length; i += 2) p.push([flat[i], flat[i + 1]]); return p; };
  const near = (pts) => pts.some(([x, z]) => x > BOX.x0 - 20 && x < BOX.x1 + 20 && z > BOX.z0 - 20 && z < BOX.z1 + 20);
  const F = C.highParkFeatureShapes;
  if (F) {
    // (every other path first, then the natural trails: the plants grow to 0.1-0.3 m past their worn earth, the shrubs
    // keep out of their mapped corridor: high-park-features.js TRAIL)
    const TR = F.trail;
    for (const p of F.paths) {
      if (TR && TR.on && p.surf === 1) continue;
      for (let k = 1; k < p.pts.length; k++) exactSeg(p.pts[k - 1][0], p.pts[k - 1][1], p.pts[k][0], p.pts[k][1], p.w / 2 + 0.15);
    }
    natTrails = TR && TR.on ? F.paths.filter((p) => p.surf === 1) : [];
    exactPolys(F.areas.filter((a) => near(a.pts)).map((a) => ({ pts: a.pts })), 0.3);
    exactPolys(F.buildings.filter(near).map((pts) => ({ pts })), 4.5); // (as highParkFeatureAt keeps the trees off them)
  }
  for (const [w, ...flat] of C.GEO.parkPaths || []) for (let k = 0; k + 3 < flat.length; k += 2) {
    const ax = flat[k], az = flat[k + 1], bx = flat[k + 2], bz = flat[k + 3];
    if (Math.max(ax, bx) < BOX.x0 - 8 || Math.min(ax, bx) > BOX.x1 + 8 || Math.max(az, bz) < BOX.z0 - 8 || Math.min(az, bz) > BOX.z1 + 8) continue;
    exactSeg(ax, az, bx, bz, w / 2 + 0.15);
  }
  // (the City's sidewalks on the park's islands: Centre Road's, Colborne Lodge Drive's)
  const SW = C.SIDEWALKS && C.decodeSidewalkRing ? C.SIDEWALKS.polys : [];
  const sidewalks = [];
  for (const [, outer, ...holes] of SW) {
    const o = C.decodeSidewalkRing(outer).map((q) => [q.x, q.z]);
    if (near(o)) sidewalks.push({ pts: o, holes: holes.map((h) => C.decodeSidewalkRing(h).map((q) => [q.x, q.z])) });
  }
  exactPolys(sidewalks, 0.3);
  const courts = [];
  for (const p of (C.TENNIS && C.TENNIS.pads) || []) if (near(p.ring)) courts.push({ pts: p.ring });
  for (const r of (C.RINKS && C.RINKS.records) || []) for (const p of r.polygons || []) if (near(p.outer)) courts.push({ pts: p.outer });
  exactPolys(courts, 1.5);
  // (the ponds: the plants keep WATER_MARGIN off them, the water edges' mud margin)
  const ponds = [];
  for (const [k, , flat] of C.GEO.areas) if (k === 'water') { const pts = ring(flat); if (pts.some(([x, z]) => x > BOX.x0 && x < BOX.x1 && z > BOX.z0 && z < BOX.z1)) ponds.push({ pts }); }
  exactPolys(ponds, WATER_MARGIN);
  // the natural trails, into both fields
  const exS = exG.slice();
  for (const p of natTrails) {
    const TR = F.trail;
    for (let k = 1; k < p.pts.length; k++) {
      const [ax, az] = p.pts[k - 1], [bx, bz] = p.pts[k];
      exactSeg(ax, az, bx, bz, p.w / 2 * 1.25 + 0.45, (x, z, t) => TR.plantEdge(x, z, p.w, TR.earthAt(p, k - 1, t, x, z)), exG);
      exactSeg(ax, az, bx, bz, p.w / 2 + 0.15, null, exS);
    }
  }
  const dist = chamfer(blocked);
  // (stored as signed metres + 2, 32 a metre: -2 to 5.97 m)
  const pack = (f) => {
    const out = new Uint8Array(W1 * H1);
    for (let k = 0; k < W1 * H1; k++) { const c = dist[k] / 8 - 0.5, e = c < f[k] ? c : f[k], v = Math.round((e + 2) * 32); out[k] = v < 0 ? 0 : v > 255 ? 255 : v; }
    return out;
  };
  const clear = pack(exG), clearShrub = pack(exS);
  maps = { kind, shrub, hab, clear, clearShrub, cover, shore, dShore };
  stats.ms.maps = Math.round(performance.now() - t0);
  return maps;
}
/** The clearance (m) at (x, z): how far the nearest path, bed, building, pond's margin or lawn is (negative on one), 6 m
 * at most; `shrubs`: the shrubs' (a natural trail's whole mapped corridor kept clear), else the ground cover's */
function clearanceAt(x, z, shrubs = false) {
  const m = buildMaps(), i = Math.floor(x - BOX.x0), j = Math.floor(z - BOX.z0);
  if (i < 0 || j < 0 || i >= W1 || j >= H1) return -2;
  return (shrubs ? m.clearShrub : m.clear)[j * W1 + i] / 32 - 2;
}
function habitatAt(x, z) {
  const m = buildMaps(), i = Math.floor((x - BOX.x0) / CELL4), j = Math.floor((z - BOX.z0) / CELL4);
  if (i < 0 || j < 0 || i >= W4 || j >= H4) return [0, 0, 0, 0];
  const q = (j * W4 + i) * 4;
  return [m.hab[q] / 255, m.hab[q + 1] / 255, m.hab[q + 2] / 255, m.hab[q + 3] / 255];
}

// ---------------------------------------------------------------------------------------------------------------------
// The sprites: one procedural atlas of 512 px tiles, painted on a canvas at start-up (seeded, the same every visit):
// 0 tall grass (bluestem: blades, a few seed heads), 1 goldenrod, 2 forbs (asters, bergamot, milkweed leaves),
// 3 woodland herbs (broad leaves, a fern), 4 a broadleaf shrub's foliage (dogwood, serviceberry), 5 sumac's pinnate
// fronds, 6 a sapling's bigger leaves
// ---------------------------------------------------------------------------------------------------------------------
const TILES = 7, TPX = 256;
let atlas = null;
function paintAtlas() {
  if (atlas) return atlas;
  const { THREE } = C;
  const cv = document.createElement('canvas');
  cv.width = TPX * 8; cv.height = TPX;
  const g = cv.getContext('2d');
  let seed = 7919;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const S = TPX / 512; // (the shapes are drawn on a 512 grid)
  const tile = (t, fn) => { g.save(); g.translate(t * TPX, 0); g.scale(S, S); g.beginPath(); g.rect(0, 0, 512, 512); g.clip(); fn(); g.restore(); };
  // (each clump's blades shorter towards its card's sides: a mound, not a block with flat sides and a flat top, so the
  // clumps along a trail's edge don't stack into terraces)
  const blade = (x0, h0, w, lean, col) => {
    const u = (x0 - 256) / 256, h = h0 * (1 - 0.62 * u * u);
    // (no blade leans out of its tile: one clipped by the tile's side left a hard vertical edge on the clump, and clumps
    // in a row along a trail read as steps)
    const yb = 512, yt = 512 - h, xt = Math.max(28, Math.min(484, x0 + lean)), lean2 = xt - x0;
    lean = lean2;
    g.fillStyle = col; g.beginPath();
    g.moveTo(x0 - w / 2, yb);
    g.quadraticCurveTo(x0 - w / 2 + lean * 0.3, yb - h * 0.55, xt, yt);
    g.quadraticCurveTo(x0 + w / 2 + lean * 0.3, yb - h * 0.55, x0 + w / 2, yb);
    g.closePath(); g.fill();
  };
  const leaf = (x, y, len, wid, ang, col) => {
    g.save(); g.translate(x, y); g.rotate(ang); g.fillStyle = col; g.beginPath();
    g.moveTo(0, 0); g.quadraticCurveTo(len * 0.45, -wid, len, 0); g.quadraticCurveTo(len * 0.45, wid, 0, 0); g.fill();
    g.strokeStyle = 'rgba(30,40,10,0.35)'; g.lineWidth = Math.max(1, wid * 0.12); g.beginPath(); g.moveTo(0, 0); g.lineTo(len * 0.9, 0); g.stroke();
    g.restore();
  };
  const stem = (x0, h, lean, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x0, 512); g.quadraticCurveTo(x0 + lean * 0.2, 512 - h * 0.6, x0 + lean, 512 - h); g.stroke(); return [x0 + lean, 512 - h]; };
  const greens = ['#4f6d28', '#5e7f30', '#6f9238', '#7f9e42', '#5a7a2c', '#8aa64c', '#68883a'];
  // 0 tall grass
  tile(0, () => {
    for (let k = 0; k < 95; k++) {
      // (the roots thinning out towards the card's sides, a triangular spread: no wall of blades at its ends)
      const x = 256 + (rnd() + rnd() - 1) * 210, h = 230 + rnd() * 270, lean = (rnd() - 0.5) * 170;
      blade(x, h, 7 + rnd() * 9, lean, rnd() < 0.08 ? pick(['#a9a466', '#b4ac70']) : pick(greens));
    }
    for (let k = 0; k < 4; k++) { // (bluestem's turkey-foot seed heads)
      const x = 120 + rnd() * 270, h = 380 + rnd() * 120, lean = (rnd() - 0.5) * 80;
      const [tx, ty] = stem(x, h, lean, 3, '#6f6a3a');
      for (let f = 0; f < 3; f++) leaf(tx, ty, 50 + rnd() * 25, 5, -Math.PI / 2 + (f - 1) * 0.35, pick(['#7d7448', '#86774a', '#6f6a40']));
    }
  });
  // 1 goldenrod
  tile(1, () => {
    for (let k = 0; k < 40; k++) blade(256 + (rnd() + rnd() - 1) * 200, 120 + rnd() * 180, 7 + rnd() * 6, (rnd() - 0.5) * 120, pick(greens));
    for (let k = 0; k < 4; k++) {
      const x = 110 + rnd() * 290, h = 330 + rnd() * 160, lean = (rnd() - 0.5) * 90;
      const [tx, ty] = stem(x, h, lean, 5, '#5a6a2a');
      for (let y = 0; y < h * 0.8; y += 26) leaf(x + lean * (1 - (512 - (512 - y)) / h) * 0 + lean * (y / h), 512 - y - 20, 55 + rnd() * 25, 9, (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.5) - Math.PI / 2 + Math.PI / 2 * (rnd() < 0.5 ? 0.8 : -0.8), pick(greens));
      // the plume: arching sprays of yellow florets
      for (let a = 0; a < 4; a++) {
        const ang = -Math.PI / 2 + (a - 1.5) * 0.35, len = 40 + rnd() * 35;
        for (let s = 0; s < 1; s += 0.1) {
          const px = tx + Math.cos(ang) * len * s + s * s * 20 * Math.sign(Math.cos(ang) || 1), py = ty + Math.sin(ang) * len * s + s * s * 24;
          g.fillStyle = pick(['#c9b53a', '#d4c04a', '#bfa936']); g.beginPath(); g.arc(px, py, 3 + rnd() * 3, 0, 6.283); g.fill();
        }
      }
    }
  });
  // 2 forbs
  tile(2, () => {
    for (let k = 0; k < 30; k++) blade(256 + (rnd() + rnd() - 1) * 200, 100 + rnd() * 160, 7 + rnd() * 6, (rnd() - 0.5) * 120, pick(greens));
    for (let k = 0; k < 10; k++) {
      const x = 80 + rnd() * 350, h = 200 + rnd() * 240, lean = (rnd() - 0.5) * 80;
      const [tx, ty] = stem(x, h, lean, 4, '#55682a');
      const big = rnd() < 0.35;
      for (let y = 30; y < h * 0.85; y += big ? 55 : 30) for (const sd of [-1, 1]) leaf(x + lean * (y / h), 512 - y, big ? 70 : 42, big ? 22 : 9, -Math.PI / 2 + sd * (0.9 + rnd() * 0.4), pick(greens));
      const fc = pick(['#9b7fc0', '#b39ad6', '#e4e0d0', '#a08ac4']);
      for (let f = 0; f < 7; f++) { g.fillStyle = fc; g.beginPath(); g.arc(tx + (rnd() - 0.5) * 60, ty + (rnd() - 0.3) * 40, 5 + rnd() * 5, 0, 6.283); g.fill(); }
      g.fillStyle = '#d9b84a'; g.beginPath(); g.arc(tx, ty, 4, 0, 6.283); g.fill();
    }
  });
  // 3 woodland herbs
  tile(3, () => {
    const dk = ['#3d5a22', '#48682a', '#557530', '#3f5f28', '#5f7d35'];
    for (let k = 0; k < 26; k++) {
      const x = 70 + rnd() * 370, h = 90 + rnd() * 260, lean = (rnd() - 0.5) * 120;
      const [tx, ty] = stem(x, h, lean, 3, '#4a5a26');
      leaf(tx, ty, 70 + rnd() * 70, 24 + rnd() * 20, -Math.PI / 2 + (rnd() - 0.5) * 2.2, pick(dk));
      if (rnd() < 0.5) leaf(tx, ty + 20, 60 + rnd() * 50, 20 + rnd() * 14, -Math.PI / 2 + (rnd() - 0.5) * 2.6, pick(dk));
    }
    for (let k = 0; k < 3; k++) { // (a fern: pinnae along an arching rachis)
      const x = 120 + rnd() * 270, ang0 = -Math.PI / 2 + (rnd() - 0.5) * 1.2, len = 260 + rnd() * 120;
      for (let s = 0.1; s < 1; s += 0.06) {
        const px = x + Math.cos(ang0) * len * s, py = 512 + Math.sin(ang0) * len * s + s * s * 60;
        for (const sd of [-1, 1]) leaf(px, py, 46 * (1.1 - s), 8, ang0 + sd * 1.25, pick(dk));
      }
    }
  });
  // 4 broadleaf shrub foliage, 5 sumac, 6 sapling leaves: leaves filling a disc, gaps between them
  // (the shrubs' foliage: leaves over a disc with a few holes through it and a ragged edge, sprays reaching past it, so
  // a shrub reads as leaves and the light between them, not a solid lump)
  const foliage = (t, n, len, wid, cols, pinnate) => tile(t, () => {
    const holes = Array.from({ length: pinnate ? 0 : 6 }, () => { const a = rnd() * 6.283, r = 40 + rnd() * 140; return [256 + Math.cos(a) * r, 256 + Math.sin(a) * r, 22 + rnd() * 26]; });
    for (let k = 0; k < n; k++) {
      const out = rnd() < 0.14, a = rnd() * 6.283, r = out ? 200 + rnd() * 45 : Math.pow(rnd(), 0.6) * 205, x = 256 + Math.cos(a) * r, y = 256 + Math.sin(a) * r;
      if (holes.some(([hx, hy, hr]) => (x - hx) ** 2 + (y - hy) ** 2 < hr * hr)) continue;
      if (pinnate) {
        const ang = rnd() * 6.283, L = 120 + rnd() * 60;
        for (let s = 0.15; s < 1; s += 0.13) for (const sd of [-1, 1]) leaf(x + Math.cos(ang) * L * s, y + Math.sin(ang) * L * s, len, wid, ang + sd * 1.0, pick(cols));
        leaf(x + Math.cos(ang) * L, y + Math.sin(ang) * L, len, wid, ang, pick(cols));
      } else leaf(x, y, len * (0.8 + rnd() * 0.4), wid * (0.8 + rnd() * 0.4), rnd() * 6.283, pick(cols));
    }
  });
  foliage(4, 230, 46, 18, ['#4a6a28', '#557830', '#628636', '#73953e', '#46632a', '#809f48'], false);
  foliage(5, 26, 30, 7, ['#4f6e26', '#5c7c2c', '#6a8a33', '#48651f'], true);
  foliage(6, 150, 70, 30, ['#45652a', '#527430', '#5f8236', '#3e5b24'], false);
  // 7 a willow's hanging strands: thin whips from the top, narrow leaves all down them
  tile(7, () => {
    const cols = ['#8a9a3a', '#9aaa45', '#7d8f35', '#a5b04c', '#6f8230'];
    for (let k = 0; k < 34; k++) {
      let x = 20 + rnd() * 472, y = 0;
      const drift = (rnd() - 0.5) * 0.25;
      g.strokeStyle = '#6d6a3a'; g.lineWidth = 2;
      while (y < 500) {
        const nx = x + drift * 20 + (rnd() - 0.5) * 4, ny = y + 18;
        g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
        for (const sd of [-1, 1]) leaf(nx, ny, 30 + rnd() * 10, 4.5, Math.PI / 2 + sd * (0.35 + rnd() * 0.3), pick(cols));
        x = nx; y = ny;
        if (rnd() < 0.02) break;
      }
    }
  });
  // the mips by hand (after threejs-nanites' impostor coverage): the colour averaged over the covered texels only (no
  // dark fringes from the transparent black round each leaf), the transparent texels given their tile's mean colour,
  // and each tile's alpha at each level scaled so the share of texels over the cut-out stays the full-size tile's (a
  // far meadow kept as dense as a near one, not thinned to nothing as the blades average away)
  const W0 = cv.width, H0 = cv.height;
  const img = g.getImageData(0, 0, W0, H0).data;
  const tiles = W0 / TPX;
  let lv = { w: W0, h: H0, d: new Uint8Array(img) };
  // (the transparent texels: their tile's mean colour)
  for (let t = 0; t < tiles; t++) {
    let r = 0, gg = 0, b = 0, n = 0;
    for (let y = 0; y < H0; y++) for (let x = t * TPX; x < (t + 1) * TPX; x++) { const k = (y * W0 + x) * 4, a = lv.d[k + 3]; if (a > 127) { r += lv.d[k]; gg += lv.d[k + 1]; b += lv.d[k + 2]; n++; } }
    if (!n) continue;
    for (let y = 0; y < H0; y++) for (let x = t * TPX; x < (t + 1) * TPX; x++) { const k = (y * W0 + x) * 4; if (lv.d[k + 3] < 8) { lv.d[k] = r / n; lv.d[k + 1] = gg / n; lv.d[k + 2] = b / n; } }
  }
  const target = new Float32Array(tiles);
  for (let t = 0; t < tiles; t++) { let n = 0; for (let y = 0; y < H0; y++) for (let x = t * TPX; x < (t + 1) * TPX; x++) if (lv.d[(y * W0 + x) * 4 + 3] > 127) n++; target[t] = n / (TPX * H0); }
  const mips = [{ data: lv.d, width: W0, height: H0 }];
  let raw = Float32Array.from(lv.d, (v) => v / 255); // (the unscaled alpha carried down, the colour premultiplied below)
  let w = W0, h = H0;
  while (w > 1 || h > 1) {
    const w2 = Math.max(1, w >> 1), h2 = Math.max(1, h >> 1), nxt = new Float32Array(w2 * h2 * 4), out = new Uint8Array(w2 * h2 * 4);
    for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
      let r = 0, gg = 0, b = 0, a = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const k = (Math.min(h - 1, y * 2 + dy) * w + Math.min(w - 1, x * 2 + dx)) * 4, ak = raw[k + 3] + 0.004;
        r += raw[k] * ak; gg += raw[k + 1] * ak; b += raw[k + 2] * ak; a += ak;
      }
      const k = (y * w2 + x) * 4;
      nxt[k] = r / a; nxt[k + 1] = gg / a; nxt[k + 2] = b / a; nxt[k + 3] = (a - 0.016) / 4;
    }
    // each tile's alpha scale at this level: the share over 0.5 kept (a histogram's quantile)
    const tw = Math.max(1, w2 / tiles);
    for (let t = 0; t < tiles; t++) {
      const hist = new Uint32Array(256);
      let n = 0;
      for (let y = 0; y < h2; y++) for (let x = Math.floor(t * tw); x < Math.max(Math.floor(t * tw) + 1, Math.floor((t + 1) * tw)); x++) { hist[Math.min(255, Math.round(nxt[(y * w2 + Math.min(w2 - 1, x)) * 4 + 3] * 255))]++; n++; }
      let want = target[t] * n, acc = 0, q = 255;
      for (; q > 0; q--) { acc += hist[q]; if (acc >= want) break; }
      const scale = Math.min(8, 0.5 / Math.max(q / 255, 1 / 255));
      for (let y = 0; y < h2; y++) for (let x = Math.floor(t * tw); x < Math.max(Math.floor(t * tw) + 1, Math.floor((t + 1) * tw)); x++) {
        const k = (y * w2 + Math.min(w2 - 1, x)) * 4;
        out[k] = nxt[k] * 255; out[k + 1] = nxt[k + 1] * 255; out[k + 2] = nxt[k + 2] * 255; out[k + 3] = Math.min(255, nxt[k + 3] * scale * 255);
      }
    }
    mips.push({ data: out, width: w2, height: h2 });
    raw = nxt; w = w2; h = h2;
  }
  const tex = new THREE.DataTexture(mips[0].data, W0, H0, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.mipmaps = mips;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.flipY = false; // (row 0 the canvas's top: v 0 there)
  tex.needsUpdate = true;
  tex.name = 'ParkCoverAtlas';
  atlas = { texture: tex, canvas: cv };
  return atlas;
}

// ---------------------------------------------------------------------------------------------------------------------
// GPU inputs: the terrain's grid (exact: the drawn ground's own triangles), the habitat and the clearance
// ---------------------------------------------------------------------------------------------------------------------
let gpu = null;
function gpuInputs() {
  if (gpu) return gpu;
  const { THREE } = C;
  const m = buildMaps();
  const HD = C.HIGH_PARK_DATA, DV = C.DON_VALLEY;
  const tb = HD.box, nx = HD.nx, nz = HD.nz, S = tb.step;
  const h = new Float32Array(nx * nz);
  for (let r = 0; r < nz; r++) for (let c = 0; c < nx; c++) h[r * nx + c] = DV ? DV.heightAt(tb.x0 + c * S + 1e-4, tb.z0 + r * S + 1e-4) : 0;
  const hTex = new THREE.DataTexture(h, nx, nz, THREE.RedFormat, THREE.FloatType);
  hTex.minFilter = hTex.magFilter = THREE.NearestFilter; hTex.needsUpdate = true; hTex.name = 'ParkCoverHeights';
  const habTex = new THREE.DataTexture(m.hab, W4, H4, THREE.RGBAFormat, THREE.UnsignedByteType);
  habTex.minFilter = habTex.magFilter = THREE.LinearFilter; habTex.needsUpdate = true; habTex.name = 'ParkCoverHabitat';
  const clrTex = new THREE.DataTexture(m.clear, W1, H1, THREE.RedFormat, THREE.UnsignedByteType);
  clrTex.minFilter = clrTex.magFilter = THREE.LinearFilter; clrTex.needsUpdate = true; clrTex.name = 'ParkCoverClearance';
  for (const t of [hTex, habTex, clrTex]) { t.flipY = false; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; }
  gpu = { hTex, habTex, clrTex, tb, nx, nz, S };
  return gpu;
}

// ---------------------------------------------------------------------------------------------------------------------
// The grass rings
// ---------------------------------------------------------------------------------------------------------------------
// (the view camera's position and level forward direction, set by update(); made with the first material)
let viewerU = null, forwardU = null;
function viewUniforms() {
  if (!viewerU) { const { uniform } = C.TSL; viewerU = uniform(new C.THREE.Vector3()); forwardU = uniform(new C.THREE.Vector3(0, 0, -1)); }
}

// One clump: three upright cards at 60 degrees round its foot (a star), each 1 wide and 1 tall; aCard = (u, v)
function clumpGeometry(cards) {
  const { THREE } = C;
  const pos = [], uvA = [], idx = [];
  for (let k = 0; k < cards; k++) {
    const a = (k / cards) * Math.PI + 0.3, cx = Math.cos(a) * 0.5, cz = Math.sin(a) * 0.5;
    const o = pos.length / 3;
    pos.push(-cx, 0, -cz, cx, 0, cz, cx, 1, cz, -cx, 1, -cz);
    uvA.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nrm = new Float32Array(pos.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1; // (lit from above, like the reeds)
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('aCard', new THREE.Float32BufferAttribute(uvA, 2));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return g;
}

/** The terrain's height at world xz (a TSL vec2) on its grid triangles, + the island's level, inside a Fn */
function groundY(p) {
  const T = C.TSL, { hTex, tb, nx, nz, S } = gpuInputs();
  const { textureLoad, ivec2, float, clamp, select, vec2 } = T;
  const f = p.sub(vec2(tb.x0, tb.z0)).div(S);
  const c = clamp(f.x.floor(), 0, nx - 2), r = clamp(f.y.floor(), 0, nz - 2);
  const tx = f.x.sub(c), tz = f.y.sub(r);
  const ci = T.int(c), ri = T.int(r);
  const ha = textureLoad(hTex, ivec2(ci, ri)).x, hb = textureLoad(hTex, ivec2(ci.add(1), ri)).x;
  const hd = textureLoad(hTex, ivec2(ci, ri.add(1))).x, he = textureLoad(hTex, ivec2(ci.add(1), ri.add(1))).x;
  const lower = ha.add(hb.sub(ha).mul(tx)).add(hd.sub(ha).mul(tz));
  const upper = he.add(hd.sub(he).mul(float(1).sub(tx))).add(hb.sub(he).mul(float(1).sub(tz)));
  return select(tx.add(tz).lessThanEqual(1), lower, upper).add(C.CITY_BOUNDS.sidewalkHeight);
}

function grassMaterial(ring, k) {
  viewUniforms();
  const { THREE } = C;
  const T = C.TSL;
  const { Fn, attribute, instanceIndex, uniform, float, vec2, vec3, vec4, texture, smoothstep, mix, clamp, fract, sin, dot, cos, max, abs,
    varying, time, select, step, dFdx, dFdy, log2 } = T;
  const { habTex, clrTex } = gpuInputs();
  const tex = paintAtlas().texture;
  const N = ring.n, cell = ring.cell;
  const inner = k ? RINGS[k - 1].r : 0, outer = ring.r;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  mat.name = `ParkCoverGrass_${k}`;
  ring.origin = uniform(new THREE.Vector2());
  const card = attribute('aCard', 'vec2');
  const vUv = varying(vec2(0), 'vPcUv'), vTint = varying(vec3(1), 'vPcTint'), vTile = varying(float(0), 'vPcTile'), vV = varying(float(0), 'vPcV');
  const h1 = (p, s) => fract(sin(dot(p, vec2(127.1 + s, 311.7 - s))).mul(43758.5453));
  mat.positionNode = Fn(() => {
    const i = float(instanceIndex);
    const ix = i.mod(N), iz = i.div(N).floor();
    const gcell = ring.origin.add(vec2(ix, iz)); // (the cell's integer world coordinates, in cells)
    const ra = h1(gcell, 0), rb = h1(gcell, 1.7), rc = h1(gcell, 3.1), rd = h1(gcell, 5.3), re = h1(gcell, 7.9);
    const p = gcell.add(vec2(ra, rb)).mul(cell);
    // (the distance counts the camera's height over the park, ~10 m: from the air the rings are empty)
    const up = viewerU.y.sub(10).max(0);
    const d = p.sub(viewerU.xz).length().pow(2).add(up.mul(up)).sqrt();
    // (the ring's share by distance, a dither by the cell's hash: the inner ring hands over to this one across the
    // last FADE of its radius, this one to the next across the last FADE of its own)
    const fin = k ? smoothstep(inner * (1 - FADE), inner, d) : float(1);
    const fout = float(1).sub(smoothstep(outer * (1 - FADE), outer, d));
    const share = k === RINGS.length - 1 ? fout : fout;
    const keepRing = rc.lessThan(fin).and(rc.greaterThanEqual(float(1).sub(share)).or(share.greaterThanEqual(1)));
    // the maps: habitat (R tall grass, G woods' herbs) and clearance (m)
    const uvH = p.sub(vec2(BOX.x0, BOX.z0)).div(vec2(BOX.x1 - BOX.x0, BOX.z1 - BOX.z0));
    const inBox = uvH.x.greaterThan(0).and(uvH.x.lessThan(1)).and(uvH.y.greaterThan(0)).and(uvH.y.lessThan(1));
    const hab = texture(habTex, uvH);
    // (signed metres, filtered between the texels: a smooth field; a little noise along the edge, so it reads as plants
    // stopping at a trodden edge, not a ruled line)
    const edgeNoise = sin(p.x.mul(1.7).add(sin(p.y.mul(1.3)))).mul(0.06).add(h1(gcell, 11.3).sub(0.5).mul(0.18));
    const clr = texture(clrTex, uvH).x.mul(255 / 32).sub(2).add(edgeNoise);
    // (the plants reach the paths' edges: in from 0.15 m, shorter for the first metre and a half, as where they're trodden)
    const edge = smoothstep(-0.2, 0.15, clr);
    const tall = hab.x, herb = hab.y;
    // patches: a slow noise thins the woods' herbs into drifts and lets the meadow's grass vary in height
    const pn = sin(p.x.mul(0.083).add(sin(p.y.mul(0.061)).mul(2.1))).mul(0.5).add(0.5);
    const pTall = tall.mul(0.97), pHerb = herb.mul(smoothstep(0.25, 0.75, pn).mul(0.4).add(0.55));
    const pick = rd.mul(pTall.add(pHerb).max(1e-3));
    const isTall = pick.lessThan(pTall);
    const keep = keepRing.and(inBox).and(re.lessThan(pTall.add(pHerb).min(1).mul(edge)));
    // the species: in the tall grass 80% grass, 10% goldenrod, 10% forbs; the herbs are the woods' plants
    const sp = h1(gcell, 9.2);
    const tile = select(isTall, select(sp.lessThan(0.8), float(0), select(sp.lessThan(0.9), float(1), float(2))), float(3));
    vTile.assign(tile);
    // height (m): the grass 0.55-1.15, taller in the moister lows of the noise, goldenrod to 1.3, the herbs 0.25-0.6,
    // all lower along the paths' first 1.5 m
    const hBase = select(isTall, mix(float(0.55), float(1.15), pn.mul(0.6).add(ra.mul(0.4))).mul(select(tile.equal(1), float(1.15), float(1))), mix(float(0.35), float(0.8), rb));
    // (graded at an edge: low tufts and short grass beside a path, rising to full height over the first 0.9 m)
    const hgt = hBase.mul(smoothstep(-0.05, 0.9, clr).mul(0.68).add(0.32)).mul(mix(float(0.8), float(1.2), re));
    // (no card reaches over the trail: near it a clump is narrower, at most twice its clearance across, so the plants'
    // edge is the clumps' own ragged outline along the trail, not their cards' sides)
    const wid = float(cell * 2.1).mul(mix(float(0.85), float(1.2), rc)).mul(select(isTall, float(1), float(1.05))).min(clr.add(0.5).mul(1.6).max(0.4));
    // (behind the camera, beyond 3 m: collapsed, nothing to raster)
    const toP = p.sub(viewerU.xz);
    const ahead = dot(toP, forwardU.xz).greaterThan(-3).or(toP.length().lessThan(6));
    const on = keep.and(ahead);
    const yaw = rb.mul(6.2832);
    const cs = cos(yaw), sn = sin(yaw);
    const lp = T.positionLocal;
    // the wind: the tops sway, each clump on its own phase, the gusts rolling across the meadow
    const ph = ra.mul(6.283).add(p.x.mul(0.07)).add(p.y.mul(0.05));
    const sway = sin(time.mul(1.3).add(ph)).mul(0.6).add(sin(time.mul(2.7).add(ph.mul(1.9))).mul(0.25)).mul(card.y.mul(card.y)).mul(hgt).mul(0.09);
    const local = vec3(lp.x.mul(cs).sub(lp.z.mul(sn)).mul(wid), lp.y.mul(hgt), lp.x.mul(sn).add(lp.z.mul(cs)).mul(wid));
    // (some stems near a path lean over it: down the clearance's slope, more the nearer, by the card's height squared)
    const cl = (o) => texture(clrTex, p.add(o).sub(vec2(BOX.x0, BOX.z0)).div(vec2(BOX.x1 - BOX.x0, BOX.z1 - BOX.z0))).x;
    const grad = vec2(cl(vec2(0.6, 0)).sub(cl(vec2(-0.6, 0))), cl(vec2(0, 0.6)).sub(cl(vec2(0, -0.6))));
    const toPath = grad.negate().div(grad.length().max(1e-4));
    const leanAmt = hgt.mul(0.4).mul(float(1).sub(smoothstep(0.25, 1.3, clr))).mul(step(h1(gcell, 13.1), 0.5)).mul(step(1e-4, grad.length()));
    const lean = vec3(toPath.x, 0, toPath.y).mul(leanAmt).mul(lp.y.mul(lp.y));
    const world = vec3(p.x, groundY(p).sub(0.03), p.y).add(local).add(lean).add(vec3(sway, 0, sway.mul(0.6)));
    vUv.assign(card);
    vV.assign(card.y);
    vTint.assign(vec3(mix(float(0.86), float(1.1), ra), mix(float(0.9), float(1.08), re), mix(float(0.85), float(1.05), rd)));
    return select(on, world, vec3(p.x, -500, p.y));
  })();
  // the sprite: tile `vTile` of the atlas; coverage kept with distance (its mips average thin blades away)
  const uvA = vec2(vTile.add(vUv.x.clamp(0.01, 0.99)).div(8), vUv.y.oneMinus().clamp(0.005, 0.995)); // (the canvas's top at v 0)
  const s = texture(tex, uvA);
  mat.maskNode = s.a.greaterThan(0.5); // (the atlas's mips keep the coverage: paintAtlas)
  mat.colorNode = Fn(() => {
    // (the grass follows the lawn's seasons; the base darker, in its own shade)
    const base = s.rgb.mul(vTint);
    const seasonal = C.seasonalGrass ? C.seasonalGrass(base) : base;
    const c0 = select(vTile.lessThan(0.5), seasonal, mix(seasonal, base, 0.6));
    // (autumn into winter, from the season's uniforms alone, no noise: the bluestem goes to straw and copper, the
    // goldenrod to its grey-tan seed heads, the asters brown, the woods' herbs yellow; each clump a little apart, by
    // its tint)
    const U = C.cityUniforms;
    const dry = U ? U.uDormant.mul(1.4).add(U.uAutumn.mul(0.45)).clamp(0, 1).mul(mix(float(0.75), float(1.0), vTint.x.sub(0.86).mul(4.1).clamp(0, 1))) : float(0);
    const dryCol = select(vTile.lessThan(0.5), mix(T.color(0xa8894e), T.color(0x9a5f34), vTint.y.sub(0.9).mul(5.5).clamp(0, 1).mul(0.6)),
      select(vTile.lessThan(1.5), T.color(0x8e8063), select(vTile.lessThan(2.5), T.color(0x6a5236), T.color(0x8a7f3c))));
    const c = mix(c0, dryCol.mul(T.dot(c0, vec3(0.3, 0.59, 0.11)).div(0.16).clamp(0.55, 1.4)), dry.mul(0.78));
    // (a little deeper and more saturated than the sprite: in the high sun the sward read as washed-out pale green)
    const deep = mix(vec3(T.dot(c, vec3(0.3, 0.59, 0.11))), c, 1.2).max(0).mul(0.86);
    return vec4(deep.mul(mix(float(0.5), float(1.0), smoothstep(0.0, 0.55, vV))), 1);
  })();
  return mat;
}

function buildGrass(group) {
  const { THREE } = C;
  const geo3 = clumpGeometry(3), geo2 = clumpGeometry(2);
  const meshes = RINGS.map((ring, k) => {
    ring.n = Math.ceil((ring.r * 2) / ring.cell) + 2;
    const geo = (k < 2 ? geo3 : geo2).clone();
    geo.instanceCount = ring.n * ring.n;
    const mesh = new THREE.Mesh(geo, grassMaterial(ring, k));
    mesh.name = `ParkCoverGrass_${k}`;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    group.add(mesh);
    stats.instances += ring.n * ring.n;
    return mesh;
  });
  return meshes;
}

// ---------------------------------------------------------------------------------------------------------------------
// The shrubs
// ---------------------------------------------------------------------------------------------------------------------
// A rounded shrub: CARDS leaf cards over a dome (radius 0.5, 1 tall), their normals from the dome's centre (soft,
// rounded light); the far one three upright crossed cards. aCard = (u, v, tile offset 0..2)
function shrubGeometry(near) {
  const { THREE } = C;
  const pos = [], nrm = [], uvA = [], idx = [];
  const quad = (c, ux, uy, n, t) => {
    const o = pos.length / 3;
    for (const [a, b] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      pos.push(c[0] + ux[0] * a + uy[0] * b, c[1] + ux[1] * a + uy[1] * b, c[2] + ux[2] * a + uy[2] * b);
      nrm.push(...n);
      uvA.push(a + 0.5, b + 0.5, t);
    }
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  };
  let sd = 3;
  const r = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  if (near) {
    const CARDS = 14;
    for (let k = 0; k < CARDS; k++) {
      const a = k * 2.39996, el = Math.acos(1 - (k + 0.5) / CARDS) * 0.95; // (a hemisphere's even spread, golden angle)
      const dir = [Math.cos(a) * Math.sin(el), Math.cos(el), Math.sin(a) * Math.sin(el)];
      const c = [dir[0] * 0.33, 0.45 + dir[1] * 0.42, dir[2] * 0.33];
      // card: facing out along the dome, turned randomly about that, sized ~0.7
      const s = 0.62 + 0.25 * r(), tw = r() * 6.283;
      let ux = [-dir[2], 0, dir[0]]; const ul = Math.hypot(ux[0], ux[2]) || 1; ux = [ux[0] / ul, 0, ux[2] / ul];
      const uy = [dir[1] * ux[2] - dir[2] * 0, dir[2] * ux[0] - dir[0] * ux[2], dir[0] * 0 - dir[1] * ux[0]];
      const cu = Math.cos(tw), su = Math.sin(tw);
      const rx = ux.map((v, i) => (v * cu + uy[i] * su) * s), ry = ux.map((v, i) => (-v * su + uy[i] * cu) * s);
      quad(c, rx, ry, dir, 0);
    }
    for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI; quad([0, 0.45, 0], [Math.cos(a) * 0.85, 0, Math.sin(a) * 0.85], [0, 0.9, 0], [Math.cos(a + 1.57), 0.6, Math.sin(a + 1.57)], 0); }
  } else {
    for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI + 0.4; quad([0, 0.5, 0], [Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [0, 1, 0], 0); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm.map((v, i) => v), 3));
  g.normalizeNormals();
  g.setAttribute('aCard', new THREE.Float32BufferAttribute(uvA, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// The shrubs' and willows' seasons, as the trees' (tsl-materials.js autumnLeaf, leafStays): the leaves turn by the
// plant's own key and fall leaf by leaf; about a third of the fallen ones stay as a twig colour, so a bare shrub is a
// brown-grey thicket, not nothing. `rgb` the leaf colour, `plant` 0..1 per plant, `q` a vec2 over the card (leaf-scale
// noise). Returns { color, keep }
function deciduous(rgb, plant, q) {
  const T = C.TSL, { fract, sin, dot, vec2, vec3, mix, select, float, Fn, If } = T;
  const U = C.cityUniforms;
  if (!C.autumnLeaf || !U) return { color: rgb, keep: null };
  // (one octave of value noise, and the haze from the same value: the season costs a quarter of what it did; and only
  // off full summer, behind a uniform branch, so summer costs nothing; 2026-11-06)
  const vn = (r) => {
    const i = r.floor(), f = r.fract(), w = f.mul(f).mul(f.mul(-2.0).add(3.0));
    const h = (o) => fract(sin(dot(i.add(o), vec2(127.1, 311.7))).mul(43758.5453));
    return mix(mix(h(vec2(0, 0)), h(vec2(1, 0)), w.x), mix(h(vec2(0, 1)), h(vec2(1, 1)), w.x), w.y);
  };
  const inSeason = U.uLeaf.lessThan(0.999).or(U.uAutumn.greaterThan(0.001)).or(U.uSpring.greaterThan(0.001));
  const out = Fn(() => {
    const c = vec3(rgb).toVar(), k = float(1).toVar();
    If(inSeason, () => {
      const leafRnd = vn(q);
      const turned = C.autumnLeaf(rgb, plant, leafRnd);
      if (!C.leafStays) { c.assign(turned); return; }
      const stays = C.leafStays(leafRnd.mul(0.75).add(plant.mul(0.25)));
      const twig = mix(vec3(0.06, 0.038, 0.02), vec3(0.12, 0.078, 0.042), leafRnd); // (linear: dead brown leaves and twigs)
      c.assign(select(stays, turned, twig));
      // (the haze kept per fine cell, a cheap hash: the noise's own contours made rings)
      k.assign(select(stays.or(fract(sin(dot(q.mul(2.3).floor().add(plant.mul(17.0)), vec2(12.9898, 78.233))).mul(43758.5453)).lessThan(0.34)), float(1), float(0)));
    });
    return T.vec4(c, k);
  })();
  return { color: out.rgb, keep: out.a.greaterThan(0.5) };
}

function shrubMaterial(near) {
  viewUniforms();
  const { THREE } = C;
  const T = C.TSL;
  const { attribute, vec2, vec3, vec4, float, texture, distance, clamp, fract, dot, sin, screenCoordinate, mix, smoothstep, max, abs, dFdx, dFdy, log2, uv } = T;
  const tex = paintAtlas().texture;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  mat.name = near ? 'ParkCoverShrubNear' : 'ParkCoverShrubFar';
  const card = attribute('aCard', 'vec3');
  const kind = attribute('aShrub', 'vec4'); // (tile 4-6, origin x, y, z: its middle)
  const fade = attribute('aShrubFade', 'vec4'); // (edge in, band in, edge out, band out), as ez-trees.js's aLodFade
  const d = distance(vec3(kind.y, kind.z, kind.w), viewerU);
  const h = fract(float(52.9829189).mul(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715)))));
  const share = (edge, band) => clamp(d.sub(edge.sub(band.mul(0.5))).div(band), 0.0, 1.0);
  const lodKeep = h.lessThan(share(fade.x, fade.y)).and(h.greaterThanEqual(share(fade.z, fade.w)));
  const uvA = vec2(kind.x.add(card.x.clamp(0.01, 0.99)).div(8), card.y.oneMinus().clamp(0.005, 0.995));
  const s = texture(tex, uvA);
  const cut = s.a.greaterThan(0.5);
  // (the seasons: a shrub's key from where it stands, the leaves' over its card)
  const plantRnd = fract(sin(dot(vec2(kind.y, kind.w), vec2(12.9898, 78.233))).mul(43758.5453));
  const dec = deciduous(s.rgb, plantRnd, card.xy.mul(vec2(14, 14)).add(plantRnd.mul(31)));
  mat.maskNode = dec.keep ? cut.and(lodKeep).and(dec.keep) : cut.and(lodKeep);
  mat.maskShadowNode = dec.keep ? cut.and(lodKeep).and(dec.keep) : cut.and(lodKeep);
  // (darker inside and low down: the light the foliage itself keeps out)
  const y = attribute('position', 'vec3').y; // (the model's own height, 0-1: positionLocal is the instance's here)
  const shade = mix(float(0.72), float(1.05), smoothstep(0.0, 0.85, y));
  mat.colorNode = vec4(dec.color.mul(shade), 1);
  return mat;
}

/** The shrubs' sites: { x, y, z, h, w, tile, yaw } */
function shrubSites() {
  const m = buildMaps();
  const out = [];
  const DV = C.DON_VALLEY;
  for (let j = 0; j < H4; j++) for (let i = 0; i < W4; i++) {
    const q = j * W4 + i;
    if (m.kind[q] < 2 && !m.shore[q]) continue;
    const tall = m.hab[q * 4] / 255, herb = m.hab[q * 4 + 1] / 255, layer = m.shrub[q], ravine = m.hab[q * 4 + 3] > 0;
    const floor = m.cover.data[q * 4] / 255;
    // per 4 m cell: the lidar's layer (0, 0.3, 1.1, 2.2 shrubs), the woods' understory (closed floor: 0.8, 1.2 in the
    // ravines), more at the woods' edges (the floor partial), a few oak sprouts and sumac in the savanna's grass
    // (Grenadier Pond's shore band: shrubs down to the water's margin, 0.9 a cell)
    // (the woods' edges along the park's streets: a screen of shrubs and saplings within 12 m of the island's edge, as the
    // park's own edge plantings, so the woods' trails don't see straight through to Parkside Drive and Bloor Street)
    let edge = false;
    if (floor > 0.3) for (let dj = -3; dj <= 3 && !edge; dj++) for (let di = -3; di <= 3; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < W4 && jj < H4 && m.kind[jj * W4 + ii] === 0 && !m.shore[jj * W4 + ii]) { edge = true; break; } }
    let n = [0, 0.3, 1.1, 2.2][layer] + herb * (ravine ? 1.2 : 0.8) + (floor > 0.25 && floor < 0.8 ? 0.35 : 0) + tall * 0.06 + (m.shore[q] ? 0.9 : 0) + (edge ? 1.1 : 0);
    const cx = BOX.x0 + i * CELL4, cz = BOX.z0 + j * CELL4;
    for (let k = 0; k < 4 && n > 0; k++, n -= 1) {
      if (hash2(cx, cz, k * 3.1) >= Math.min(1, n)) continue;
      const x = cx + hash2(cx, cz, k * 5.7 + 1) * CELL4, z = cz + hash2(cx, cz, k * 7.3 + 2) * CELL4;
      const r1 = hash2(x, z, 11), r2 = hash2(x, z, 13), r3 = hash2(x, z, 17);
      // height (m): the lidar's thickets 1.4-3.6, the woods' understory 0.9-2.6
      const ht = layer >= 2 ? 1.4 + 2.2 * r1 : 0.9 + 1.7 * r1;
      const wd = ht * (0.8 + 0.6 * r2);
      if (clearanceAt(x, z, true) < 0.35 + wd * 0.3) continue;
      // the kind: sumac in the open (the savanna's thickets), dogwood & serviceberry masses, saplings in the woods
      const tile = tall > 0.5 && r3 < 0.45 ? 5 : herb > 0.4 && r3 < 0.35 ? 6 : 4;
      const y = (DV ? DV.heightAt(x, z) : 0) + C.CITY_BOUNDS.sidewalkHeight - 0.05;
      // (a big one is a clump of two or three smaller ones, not one dome 4-5 m across)
      if (ht > 2.4) {
        const parts = r3 < 0.5 ? 2 : 3;
        for (let p = 0; p < parts; p++) {
          const a = r2 * 6.283 + (p * 6.283) / parts, o = wd * 0.3, px = x + Math.cos(a) * o, pz = z + Math.sin(a) * o;
          if (clearanceAt(px, pz, true) < 0.35 + wd * 0.18) continue;
          out.push({ x: px, y, z: pz, h: ht * (0.62 + 0.25 * hash2(x, z, 20 + p)), w: wd * 0.6, tile, yaw: (r2 + p * 0.37) * 6.283, tint: hash2(z, x, 30 + p) });
        }
        continue;
      }
      out.push({ x, y, z, h: ht, w: wd, tile, yaw: r2 * 6.283, tint: r3 });
    }
  }
  return out;
}

function buildShrubs(group) {
  const { THREE } = C;
  const sites = shrubSites();
  stats.shrubs = sites.length;
  const levels = [{ geo: shrubGeometry(true), mat: shrubMaterial(true), name: 'ParkCoverShrubs_near', shadow: true },
    { geo: shrubGeometry(false), mat: shrubMaterial(false), name: 'ParkCoverShrubs_far', shadow: false }];
  const N = sites.length;
  const meshes = levels.map((L) => {
    const geo = L.geo;
    geo.setAttribute('aShrub', new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4));
    geo.setAttribute('aShrubFade', new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4));
    const mesh = new THREE.InstancedMesh(geo, L.mat, Math.max(1, N));
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, N) * 3), 3);
    mesh.name = L.name; mesh.count = 0; mesh.frustumCulled = false;
    mesh.castShadow = L.shadow; mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  });
  const mats = new Float32Array(N * 16), tints = new Float32Array(N * 3);
  const dummy = new THREE.Object3D(), col = new THREE.Color();
  sites.forEach((s, i) => {
    dummy.position.set(s.x, s.y, s.z); dummy.rotation.set(0, s.yaw, 0); dummy.scale.set(s.w, s.h, s.w * (0.85 + 0.3 * s.tint)); dummy.updateMatrix();
    dummy.matrix.toArray(mats, i * 16);
    col.setRGB(0.85 + 0.25 * s.tint, 0.9 + 0.15 * hash2(s.x, s.z, 3), 0.85 + 0.2 * hash2(s.z, s.x, 5));
    tints.set([col.r, col.g, col.b], i * 3);
  });
  // cells of 32 m: each update tests the cells, then the shrubs of the cells in reach
  const CELLS = new Map();
  sites.forEach((s, i) => { const k = Math.floor(s.x / 32) * 100000 + Math.floor(s.z / 32); (CELLS.get(k) || CELLS.set(k, []).get(k)).push(i); });
  const cellList = [...CELLS.entries()].map(([k, list]) => { const s = sites[list[0]]; return { x: (Math.floor(s.x / 32) + 0.5) * 32, z: (Math.floor(s.z / 32) + 0.5) * 32, list }; });
  const last = new THREE.Vector3(Infinity, 0, 0);
  const fadeNear = [-1e6, 1, SHRUB.near, SHRUB_BAND[0]], fadeFar = [SHRUB.near, SHRUB_BAND[0], SHRUB.far, SHRUB_BAND[1]];
  function update(cam) {
    if (cam.distanceToSquared(last) < 25) return;
    last.copy(cam);
    const counts = [0, 0];
    const reach = SHRUB.far + SHRUB_BAND[1] / 2 + 23;
    for (const c of cellList) {
      if (Math.abs(c.x - cam.x) > reach || Math.abs(c.z - cam.z) > reach) continue;
      for (const i of c.list) {
        const s = sites[i], d = Math.hypot(s.x - cam.x, s.y + s.h / 2 - cam.y, s.z - cam.z);
        for (let L = 0; L < 2; L++) {
          const f = L ? fadeFar : fadeNear;
          if (d < f[0] - f[1] / 2 - 4 || d > f[2] + f[3] / 2 + 4) continue;
          const mesh = meshes[L], n = counts[L]++;
          mesh.instanceMatrix.array.set(mats.subarray(i * 16, i * 16 + 16), n * 16);
          mesh.instanceColor.array.set(tints.subarray(i * 3, i * 3 + 3), n * 3);
          const a = mesh.geometry.attributes;
          a.aShrub.array.set([s.tile, s.x, s.y + s.h / 2, s.z], n * 4);
          a.aShrubFade.array.set(f, n * 4);
        }
      }
    }
    meshes.forEach((mesh, L) => {
      const n = counts[L], a = mesh.geometry.attributes;
      for (const attr of [mesh.instanceMatrix, mesh.instanceColor, a.aShrub, a.aShrubFade]) { attr.clearUpdateRanges(); attr.addUpdateRange(0, Math.max(1, n) * attr.itemSize); attr.needsUpdate = true; }
      mesh.count = n;
      mesh.visible = n > 0;
    });
    stats.shrubsDrawn = counts.slice();
  }
  return { update, meshes, sites };
}

// ---------------------------------------------------------------------------------------------------------------------
// Grenadier Pond's willows: a leaning trunk and a weeping crown of hanging strand cards (1 unit = the tree's height);
// aCard = (u, v, 0 bark / 1 leaves)
// ---------------------------------------------------------------------------------------------------------------------
function willowGeometry() {
  const { THREE } = C;
  const pos = [], nrm = [], uvA = [], idx = [];
  // the trunk: 7 sides, tapering, to 0.55 up, leaning 0.08 along +x (the instance turns it to the water)
  const SIDES = 7, R0 = 0.045, R1 = 0.022, TOP = 0.56, LEAN = 0.09;
  for (let k = 0; k <= SIDES; k++) {
    const a = (k / SIDES) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
    pos.push(c * R0, 0, sn * R0, LEAN + c * R1, TOP, sn * R1);
    nrm.push(c, 0, sn, c, 0, sn); uvA.push(k / SIDES, 0, 0, k / SIDES, 1, 0);
  }
  for (let k = 0; k < SIDES; k++) { const o = k * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
  // the crown: hanging cards from a dome round (LEAN, 0.7), each 0.2 wide, 0.42 long
  let sd = 11;
  const r = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  const CARDS = 46;
  for (let k = 0; k < CARDS; k++) {
    const a = k * 2.39996, el = Math.acos(1 - (k + 0.5) / CARDS) * 1.05;
    const dir = [Math.cos(a) * Math.sin(el), Math.cos(el), Math.sin(a) * Math.sin(el)];
    const top = [LEAN + dir[0] * 0.36, 0.66 + dir[1] * 0.22, dir[2] * 0.36];
    const len = 0.32 + 0.16 * r(), w = 0.16 + 0.08 * r();
    const side = [-dir[2], 0, dir[0]], sl = Math.hypot(side[0], side[2]) || 1;
    const sx = (side[0] / sl) * w * 0.5, sz = (side[2] / sl) * w * 0.5;
    const out = 0.06 + 0.05 * r(); // (the strands hang out a little from the dome)
    const bot = [top[0] + dir[0] * out, top[1] - len, top[2] + dir[2] * out];
    const o = pos.length / 3;
    pos.push(top[0] - sx, top[1], top[2] - sz, top[0] + sx, top[1], top[2] + sz, bot[0] + sx, bot[1], bot[2] + sz, bot[0] - sx, bot[1], bot[2] - sz);
    const n = [dir[0], 0.35 + dir[1] * 0.5, dir[2]];
    for (let v = 0; v < 4; v++) nrm.push(...n);
    uvA.push(0, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 1);
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.normalizeNormals();
  g.setAttribute('aCard', new THREE.Float32BufferAttribute(uvA, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
function willowMaterial() {
  viewUniforms();
  const { THREE } = C;
  const T = C.TSL;
  const { attribute, vec2, vec3, vec4, float, texture, mix, select, sin, time, positionLocal, max, abs, dFdx, dFdy, log2, color, instanceIndex, fract } = T;
  const tex = paintAtlas().texture;
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  mat.name = 'ParkCoverWillow';
  const card = attribute('aCard', 'vec3');
  const leafy = card.z.greaterThan(0.5);
  // (the strands sway at their tips)
  const ph = float(instanceIndex).mul(1.7);
  // (positionLocal is the instance's here, in metres)
  const sway = select(leafy, card.y.oneMinus().mul(sin(time.mul(0.9).add(ph).add(positionLocal.x.mul(0.7))).mul(0.15)), float(0));
  mat.positionNode = positionLocal.add(vec3(sway, 0, sway.mul(0.7)));
  const s = texture(tex, vec2(float(7).add(card.x.clamp(0.01, 0.99)).div(8), card.y.oneMinus().clamp(0.005, 0.995)));
  const cut = s.a.greaterThan(0.5);
  const wRnd = fract(float(instanceIndex).mul(0.6180339));
  const dec = deciduous(s.rgb, wRnd, card.xy.mul(vec2(6, 14)).add(wRnd.mul(23)));
  mat.maskNode = dec.keep ? leafy.not().or(cut.and(dec.keep)) : leafy.not().or(cut);
  mat.maskShadowNode = dec.keep ? leafy.not().or(cut.and(dec.keep)) : leafy.not().or(cut);
  const leaf = dec.color;
  mat.colorNode = vec4(select(leafy, leaf.mul(mix(float(0.6), float(1.05), card.y)), color(0x5a4c3a).rgb.mul(mix(float(0.8), float(1.1), card.x))), 1);
  return mat;
}
/** Willows along Grenadier Pond, 3.5-7 m from the water, ~16 m apart, off the paths and clear of the lidar's crowns */
function willowSites() {
  const m = buildMaps();
  if (!m.dShore) return [];
  const out = [], G = 16;
  const crowns = WD.crowns();
  const grid = new Map(), gk = (x, z) => Math.floor(x / 8) * 100000 + Math.floor(z / 8);
  for (const c of crowns) (grid.get(gk(c.x, c.z)) || grid.set(gk(c.x, c.z), []).get(gk(c.x, c.z))).push(c);
  const nearCrown = (x, z, r) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const c of grid.get(gk(x, z) + a * 100000 + b) || []) if (Math.hypot(c.x - x, c.z - z) < r) return true; return false; };
  const DV = C.DON_VALLEY;
  for (let gz = BOX.z0; gz < BOX.z1; gz += G) for (let gx = BOX.x0; gx < BOX.x1; gx += G) {
    if (hash2(gx, gz, 21) > 0.62) continue;
    // (the cell's best spot: the first of 10 tries 3.5-7 m from the water, with room off the paths)
    for (let t = 0; t < 10; t++) {
      const x = gx + hash2(gx, gz, 30 + t) * G, z = gz + hash2(gz, gx, 40 + t) * G;
      const i = Math.floor(x - BOX.x0), j = Math.floor(z - BOX.z0);
      if (i < 1 || j < 1 || i >= W1 - 1 || j >= H1 - 1) continue;
      const d = m.dShore[j * W1 + i] / 8;
      if (d < 3.5 || d > 7 || clearanceAt(x, z, true) < 2.5 || nearCrown(x, z, 5)) continue;
      // lean to the water: down the distance's slope
      const gxd = m.dShore[j * W1 + i + 1] - m.dShore[j * W1 + i - 1], gzd = m.dShore[(j + 1) * W1 + i] - m.dShore[(j - 1) * W1 + i];
      const yaw = Math.atan2(gzd, -gxd); // (the trunk leans along local +x: towards falling distance)
      const h = 10 + 5 * hash2(x, z, 51);
      out.push({ x, z, y: (DV ? DV.heightAt(x, z) : 0) + C.CITY_BOUNDS.sidewalkHeight - 0.05, h, yaw, w: 0.9 + 0.25 * hash2(z, x, 52) });
      break;
    }
  }
  return out;
}
function buildWillows(group) {
  const { THREE } = C;
  const sites = willowSites();
  stats.willows = sites.length;
  if (!sites.length) return null;
  const mesh = new THREE.InstancedMesh(willowGeometry(), willowMaterial(), sites.length);
  const dummy = new THREE.Object3D();
  sites.forEach((s, i) => { dummy.position.set(s.x, s.y, s.z); dummy.rotation.set(0, s.yaw, 0); dummy.scale.set(s.h * s.w, s.h, s.h * s.w); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); });
  mesh.name = 'ParkCoverWillows'; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  group.add(mesh);
  return mesh;
}

// ---------------------------------------------------------------------------------------------------------------------
function buildParkCover(scene) {
  const { THREE } = C;
  const t0 = performance.now();
  buildMaps();
  const group = new THREE.Group();
  group.name = 'ParkCover';
  const rings = GRASS ? buildGrass(group) : [];
  const shrubs = SHRUBS ? buildShrubs(group) : null;
  if (SHRUBS && SHORE_ON) buildWillows(group);
  scene.add(group);
  stats.ms.build = Math.round(performance.now() - t0);
  const fwd = new THREE.Vector3();
  let near = true;
  function update(camera) {
    const p = camera.position;
    const inReach = p.x > BOX.x0 - NEAR_BOX && p.x < BOX.x1 + NEAR_BOX && p.z > BOX.z0 - NEAR_BOX && p.z < BOX.z1 + NEAR_BOX && p.y < BOX_TOP(p);
    if (inReach !== near) { near = inReach; group.visible = inReach; }
    if (!inReach) return;
    viewUniforms();
    viewerU.value.copy(p);
    camera.getWorldDirection(fwd); fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    forwardU.value.copy(fwd.normalize());
    for (const ring of RINGS) if (ring.origin) ring.origin.value.set(Math.floor(p.x / ring.cell) - (ring.n >> 1), Math.floor(p.z / ring.cell) - (ring.n >> 1));
    if (shrubs) shrubs.update(p);
  }
  // (above 600 m the whole layer is off: from there the shrubs are sub-pixel; the rings count the height themselves)
  const BOX_TOP = () => 600;
  // the start view's state, so the shader warm-up sees the meshes
  const start = (C.TELEPORT_LOCATIONS || {}).start || { x: 0, z: 0 };
  if (shrubs) {
    shrubs.update(new THREE.Vector3((BOX.x0 + BOX.x1) / 2, 2, (BOX.z0 + BOX.z1) / 2));
    shrubs.meshes.forEach((m) => { m.visible = true; if (!m.count) m.count = 1; });
  }
  near = true;
  void start;
  C.parkCoverStats = stats;
  console.info(`[parkCover] High Park: ${stats.instances} grass cells in ${rings.length} rings, ${stats.shrubs} shrubs, ${stats.willows || 0} willows on Grenadier Pond, maps ${stats.ms.maps} ms, build ${stats.ms.build} ms (${TIER})`);
  return { group, update, stats };
}

Object.assign(C, { buildParkCover, parkCover: { clearanceAt, habitatAt, shrubSites, willowSites, ROLLOUT, stats, paintAtlas } });
})();
