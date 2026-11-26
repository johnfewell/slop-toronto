(function () {
'use strict';
// js/portlands-banks.js — the armour-stone river banks and the planting behind them (beads jf-li1, jf-li1.1).
//
// Redo of the first version (kept on branch feat/portlands-banks-wip), whose pale slabs and faceted pale-green blobs did not
// fit this map. Now:
//  - Stone: dark grey and tan limestone blocks, rough and irregular (jittered corners, tilted, each a different size), packed
//    thickest at the waterline and sunk into a low gravel-and-earth slope so each one sits in it rather than on the lawn; the
//    blocks thin and shrink inland. The mud-and-gravel apron and the reeds of js/water-edges.js stay as they are, on the water side.
//  - Planting: the map's own vegetation, not shapes of its own. The shrubs are js/park-cover.js's leaf-card shrubs (the
//    broadleaf, sumac and sapling foliage it paints for High Park, with the same dissolve between near and far models and the
//    same seasons as the city's trees: green, autumn colour, leaf fall to a bare thicket), the tall grass is its bluestem,
//    goldenrod and forb clumps, and the trees are the park's own (this is a new park with few big ones; the first version's
//    "whip trees" are gone). Sizes are real: shrubs 0.8-1.7 m, tall grass 0.7-1.4 m, saplings 1.8-3.2 m.
// Shape and layout rules still come from the Canoe Cove rowing world (the owner's aerial of the Don at the Commissioners
// Street bridge); the park is flat in this map's data, so the bank is a built-up slope laid on the 0.224 m park datum.
const C = window.CITY;
const K = C.PORTLANDS_KIT;

const GROUND_Y = 0.224;      // the park datum (js/biidaasige-park.js CONFIG.groundY)
const STONE_WIDTH_M = 5.2;   // the stone slope, from just inside the water's edge inland
const SLOPE_FROM_M = -0.5;   // the slope starts this far on the water side of the polygon edge (on the apron)
const STEP_M = 1;
const CELL_M = 200;
// dark grey and tan limestone, weathered: the colours of the owner's photographs of the Don's banks, not white
const TONES = ['#625c50', '#6f6757', '#7c705a', '#55514a', '#867858', '#665e4f', '#75694f', '#5c564c', '#80735a', '#4e4a42', '#97886a', '#8b8068'];
const MOSS = '#59603d', SOIL = '#5b4d3b', GRAVEL = '#7c7466';
const PLANT_CULL_M = 190;    // the planting's farthest model draws to here (dissolving over its last band)
const SHRUB_NEAR_M = 42;     // the rounded shrub is drawn within this, the crossed cards beyond
const GRASS_CULL_M = 75;     // clumps of tall grass; beyond it the lawn's own colour takes over

const drain = (steps) => { for (let r = steps.next(); ; r = steps.next()) if (r.done) return r.value; };
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const smooth01 = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash2 = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
function noise2(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a * (1 - ux) * (1 - uz) + b * ux * (1 - uz) + c * (1 - ux) * uz + d * ux * uz;
}

function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Shore chains along the water rings that run through the park: resampled every metre, each point carrying a smoothed
 * unit normal pointing inland. A chain breaks wherever the shore leaves the park, meets a bridge deck, or is not a
 * land/water edge.
 * @param {{x:number,z:number}[]} parkRing the park polygon in world metres
 * @param {Array<{pts:any[],holes?:any[]}>} bodies water bodies (C.WATER_BODIES)
 */
function collectBankChains(parkRing, bodies = C.WATER_BODIES || [], opts = {}) {
  const waterAt = opts.waterAt || C.waterAt, bridgeAt = opts.bridgeAt || C.bridgeAt || (() => false);
  const box = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const p of parkRing) { box.x0 = Math.min(box.x0, p.x); box.x1 = Math.max(box.x1, p.x); box.z0 = Math.min(box.z0, p.z); box.z1 = Math.max(box.z1, p.z); }
  const reach = 30;
  const chains = [];
  const rings = [];
  for (const w of bodies) {
    if (!w.pts || w.pts.length < 3) continue;
    rings.push(w.pts);
    for (const h of w.holes || []) if (h.pts?.length >= 3) rings.push(h.pts);
  }
  for (const pts of rings) {
    // only rings with a point near the park
    if (!pts.some((p) => p.x > box.x0 - reach && p.x < box.x1 + reach && p.z > box.z0 - reach && p.z < box.z1 + reach)) continue;
    const n = pts.length, samples = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n], L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 0.01) continue;
      const k = Math.max(1, Math.ceil(L / STEP_M));
      const tx = (b.x - a.x) / L, tz = (b.z - a.z) / L;
      for (let j = 0; j < k; j++) samples.push({ x: a.x + (b.x - a.x) * j / k, z: a.z + (b.z - a.z) * j / k, tx, tz });
    }
    const ok = samples.map((s) => {
      if (s.x < box.x0 - reach || s.x > box.x1 + reach || s.z < box.z0 - reach || s.z > box.z1 + reach) return false;
      const nx = -s.tz, nz = s.tx;
      const wa = !!waterAt(s.x + nx * 1.5, s.z + nz * 1.5), wb = !!waterAt(s.x - nx * 1.5, s.z - nz * 1.5);
      if (wa === wb) return false;
      s.nx = wa ? -nx : nx; s.nz = wa ? -nz : nz; // inland: the land side
      // the bank belongs to the park when 5 m inland lies in it; bridge decks interrupt the band
      if (!pointInRing(parkRing, s.x + s.nx * 5, s.z + s.nz * 5)) return false;
      return !bridgeAt(s.x, s.z, 5);
    });
    const m = samples.length;
    if (!m) continue;
    const allOk = ok.every(Boolean);
    let start = allOk ? 0 : ok.findIndex((v, i) => v && !ok[(i - 1 + m) % m]);
    if (start < 0) continue;
    let run = null;
    for (let t = 0; t <= m; t++) {
      const i = (start + t) % m, good = t === m ? false : ok[i];
      if (good) { if (!run) run = []; run.push(samples[i]); }
      else if (run) {
        if (run.length >= 12) chains.push(run);
        run = null;
      }
    }
  }
  return chains.map(finishChain).filter(Boolean);
}

function finishChain(run) {
  const n = run.length;
  const px = new Float64Array(n), pz = new Float64Array(n), nx = new Float64Array(n), nz = new Float64Array(n);
  let len = 0;
  for (let i = 0; i < n; i++) {
    px[i] = run[i].x; pz[i] = run[i].z;
    if (i > 0) len += Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1]);
  }
  const span = 5;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - span), b = Math.min(n - 1, i + span);
    const tx = px[b] - px[a], tz = pz[b] - pz[a], l = Math.hypot(tx, tz) || 1;
    let ax = -tz / l, az = tx / l;
    if (ax * run[i].nx + az * run[i].nz < 0) { ax = -ax; az = -az; } // (signed like the sample's own inland normal)
    nx[i] = ax; nz[i] = az;
  }
  return len >= 12 ? { px, pz, nx, nz, lengthM: len } : null;
}

/** World position of band coordinates (u along the chain, v inland from the shore edge). */
function bandPoint(c, u, v) {
  const per = c.lengthM / (c.px.length - 1);
  const f = Math.max(0, Math.min(c.px.length - 1.000001, u / per));
  const i = Math.floor(f), t = f - i;
  const x = c.px[i] + (c.px[i + 1] - c.px[i]) * t, z = c.pz[i] + (c.pz[i + 1] - c.pz[i]) * t;
  let nx = c.nx[i] + (c.nx[i + 1] - c.nx[i]) * t, nz = c.nz[i] + (c.nz[i + 1] - c.nz[i]) * t;
  const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
  return [x + nx * v, z + nz * v];
}


const cellKey = (x, z) => Math.floor(x / CELL_M) + ',' + Math.floor(z / CELL_M);
function cellList(map, x, z) {
  const k = cellKey(x, z);
  if (!map.has(k)) map.set(k, []);
  return map.get(k);
}
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** The slope's height above the park datum at v metres inland of the polygon edge: a low earth-and-gravel bank under the stone. */
function slopeHeight(v) {
  if (v <= SLOPE_FROM_M) return 0;
  const up = smooth01(SLOPE_FROM_M, 1.7, v), down = smooth01(3.4, STONE_WIDTH_M, v);
  return 0.24 * up * (1 - down) + 0.03 * up;
}

/** The gravel-and-earth slope under the stone, as strips along the chain (the toe on the apron, the crest 1.7-3.4 m in). */
function* buildSlopeSteps(chains, rand, isLand, cells, T) {
  let n = 0;
  const vs = [SLOPE_FROM_M, 0, 0.6, 1.2, 1.8, 2.6, 3.4, 4.3, STONE_WIDTH_M];
  let tris = 0;
  for (const chain of chains) {
    for (let u = 0; u < chain.lengthM - 1; u += 1.5) {
      if ((++n & 15) === 0) yield 'banks-slope';
      const u1 = Math.min(u + 1.5, chain.lengthM);
      const pos = [], col = [];
      const vert = (uu, v) => {
        const [x, z] = bandPoint(chain, uu, v);
        const n = noise2(x * 0.7, z * 0.7);
        const c = mix3(new T.Color(GRAVEL).toArray(), new T.Color(SOIL).toArray(), 0.25 + 0.7 * n);
        const wet = 1 - smooth01(-0.5, 0.9, v) * 0.45; // darker at the waterline
        return [x, GROUND_Y + slopeHeight(v) + 0.012, z, c[0] * wet, c[1] * wet, c[2] * wet];
      };
      for (let k = 0; k + 1 < vs.length; k++) {
        const a = vert(u, vs[k]), b = vert(u1, vs[k]), c = vert(u1, vs[k + 1]), d = vert(u, vs[k + 1]);
        if (vs[k + 1] > 0.2 && ![a, b, c, d].slice(vs[k] > 0.2 ? 0 : 2).every((q) => isLand(q[0], q[2]))) continue;
        // (each triangle faces up, whichever way round the chain runs)
        for (const [p0, p1, p2] of [[a, d, c], [a, c, b]]) {
          const up = (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2]);
          for (const q of up >= 0 ? [p0, p1, p2] : [p0, p2, p1]) { pos.push(q[0], q[1], q[2]); col.push(q[3], q[4], q[5]); }
        }
      }
      if (!pos.length) continue;
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      const [cx, cz] = bandPoint(chain, u, 2);
      cellList(cells.stone, cx, cz).push(g);
      tris += pos.length / 9;
    }
  }
  return tris;
}
const buildSlope = (...a) => drain(buildSlopeSteps(...a));

/**
 * One rough block: a polygon of five to seven irregular sides, its top a ring of facets rising to a raised middle (so the
 * light breaks across it), its sides leaning in to a base sunk in the slope. Every facet gets its own shade and every
 * corner its own, flat-shaded: weathered limestone, not a slab. Returns a vertex-coloured BufferGeometry in world space.
 */
function blockGeometry(T, cx, cz, topY, a, b, hgt, yaw, tilt, tone, rand, mossy, groundY) {
  const n = 5 + Math.floor(rand() * 3);
  const base = rand() * 6.283, cos = Math.cos(yaw), sin = Math.sin(yaw);
  const angles = [];
  for (let i = 0; i < n; i++) angles.push(base + ((i + (rand() - 0.5) * 0.55) / n) * 6.283);
  const rim = [], inner = [], bot = [];
  for (let i = 0; i < n; i++) {
    const k = 0.78 + rand() * 0.42, ca = Math.cos(angles[i]), sa = Math.sin(angles[i]);
    const lx = ca * a * 0.5 * k, lz = sa * b * 0.5 * k;
    const wx = lx * cos - lz * sin, wz = lx * sin + lz * cos, tiltY = tilt[0] * lx + tilt[1] * lz;
    rim.push([cx + wx, topY - 0.03 - rand() * 0.1 + tiltY, cz + wz]);
    inner.push([cx + wx * (0.5 + rand() * 0.25), topY + 0.01 + rand() * 0.1 + tiltY * 0.8, cz + wz * (0.5 + rand() * 0.25)]);
    const sk = 0.7 + rand() * 0.15;
    bot.push([cx + wx * sk, topY - hgt, cz + wz * sk]);
  }
  const mid = [cx, topY + 0.05 + rand() * 0.1, cz];
  const base3 = new T.Color(tone).toArray();
  const pos = [], col = [];
  const shade = (c, k) => { const j = k * (0.86 + rand() * 0.26); return [c[0] * j, c[1] * j, c[2] * j]; };
  const topC = mossy ? mix3(base3, new T.Color(MOSS).toArray(), 0.5) : base3;
  const tri = (p, q, r, cc) => {
    // (outward-facing whichever way round: sides by their direction from the middle, the top by its height)
    for (const v of [p, q, r]) { pos.push(v[0], v[1], v[2]); col.push(cc[0], cc[1], cc[2]); }
  };
  const faces = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push([mid, inner[i], inner[j], shade(topC, 0.92), 'up']);
    faces.push([inner[i], rim[i], rim[j], shade(topC, 0.82), 'up'], [inner[i], rim[j], inner[j], shade(topC, 0.86), 'up']);
    faces.push([rim[i], bot[i], bot[j], shade(base3, 0.62), 'out'], [rim[i], bot[j], rim[j], shade(base3, 0.66), 'out']);
  }
  // (a dark ring of shade where the block meets the slope: it sits in it, not on it)
  const shadow = [0.045, 0.036, 0.028];
  const sh = rim.map((v) => [cx + (v[0] - cx) * 1.2, groundY, cz + (v[2] - cz) * 1.2]);
  for (let i = 0; i < n; i++) faces.push([[cx, groundY, cz], sh[i], sh[(i + 1) % n], shadow, 'up']);
  for (const [p, q, r, cc, kind] of faces) {
    const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const out = kind === 'up' ? ny > 0 : nx * ((p[0] + q[0] + r[0]) / 3 - cx) + nz * ((p[2] + q[2] + r[2]) / 3 - cz) > 0;
    if (out) tri(p, q, r, cc); else tri(p, r, q, cc);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * The armour stone: rows of blocks from the waterline inland, the first course the biggest and the closest-packed (half in
 * the water's edge apron), the later ones smaller, fewer and more sunk, so the stone thins out into the slope's crest.
 */
function* buildArmourSteps(chains, rand, isLand, cells, T) {
  let stones = 0, tris = 0, n = 0;
  const rows = [
    { v: 0.1, size: 1.15, skip: 0.02, rise: 0.08 },
    { v: 0.95, size: 1.05, skip: 0.06, rise: 0.13 },
    { v: 1.9, size: 0.95, skip: 0.14, rise: 0.17 },
    { v: 2.85, size: 0.75, skip: 0.26, rise: 0.17 },
    { v: 3.8, size: 0.62, skip: 0.45, rise: 0.07 },
    { v: 4.7, size: 0.55, skip: 0.7, rise: 0.03 }
  ];
  for (const chain of chains) {
    for (const row of rows) {
      for (let u = rand() * 0.6; u < chain.lengthM; ) {
        const size = row.size * (0.62 + rand() * 0.8);
        const a = size * (1 + rand() * 0.45), b = size * (0.75 + rand() * 0.4);
        u += a * 0.5;
        const v = row.v + (rand() - 0.5) * 0.5;
        const [x, z] = bandPoint(chain, u, v);
        const next = u + a * 0.5 + 0.03 + rand() * 0.1;
        if (rand() < row.skip || !isLand(x, z)) { u = next; continue; }
        const [x2, z2] = bandPoint(chain, u + 0.5, v);
        const yaw = Math.atan2(z2 - z, x2 - x) + (rand() - 0.5) * 0.7; // (loosely along the shore, each its own way)
        const topY = GROUND_Y + slopeHeight(v) + row.rise * (0.4 + rand() * 0.9) + 0.06;
        const tone = TONES[Math.floor(rand() * TONES.length)];
        if ((++n & 15) === 0) yield 'banks-armour';
        const g = blockGeometry(T, x, z, topY, a, b, 0.55 + rand() * 0.35, yaw, [(rand() - 0.5) * 0.22, (rand() - 0.5) * 0.22], tone, rand, row.v < 1.2 && rand() < 0.12, GROUND_Y + slopeHeight(v) + 0.02);
        cellList(cells.stone, x, z).push(g);
        stones++; tris += g.getAttribute('position').count / 3;
        u = next;
      }
    }
  }
  return { stones, triangles: tris };
}
const buildArmour = (...a) => drain(buildArmourSteps(...a));

// ---------------------------------------------------------------------------------------------------------------------
// Planting: where the plants stand (pure: no rendering), then drawn with js/park-cover.js's own models
/**
 * Sites for shrubs and tall grass behind the stone, in patches (one kind per ~20 m, as a new park's planting beds read from
 * the air), thinning inland; and the grass that spills onto the stone slope's back. Each { x, z, h, r, tile, yaw } with
 * tile as js/park-cover.js's atlas: 0 bluestem, 1 goldenrod, 2 forbs, 4 broadleaf shrub, 5 sumac, 6 sapling.
 */
function* plantingSitesSteps(chains, rand, clear) {
  const shrubs = [], grass = [];
  let n = 0;
  const DEPTH = 13;
  for (const chain of chains) {
    // tall grass and forbs
    for (let u = 0; u < chain.lengthM; u += 1.25) {
      if ((++n & 7) === 0) yield 'banks-sites';
      for (let v = 3.6; v < STONE_WIDTH_M + DEPTH; v += 1.25) {
        const [x, z] = bandPoint(chain, u + (rand() - 0.5) * 1.1, v + (rand() - 0.5) * 1.1);
        if (!clear(x, z)) continue;
        const inland = smooth01(STONE_WIDTH_M + 2, STONE_WIDTH_M + DEPTH, v), edge = 1 - smooth01(3.6, STONE_WIDTH_M + 0.8, v);
        const patch = noise2(x / 21 + 3.1, z / 21 - 1.7);
        const density = (patch > 0.3 ? 0.62 : 0.2) * (1 - inland * 0.85) * (0.3 + 0.7 * smooth01(3.6, STONE_WIDTH_M + 1.6, v)) + edge * 0.12;
        if (rand() > density) continue;
        const k = rand(), tile = k < 0.62 ? 0 : k < 0.82 ? 1 : 2;
        grass.push({ x, z, h: (tile === 1 ? 0.95 : 0.7) + rand() * 0.55, r: 0.5 + rand() * 0.4, tile, yaw: rand() * 6.283 });
      }
    }
    // shrubs and saplings
    for (let u = 0; u < chain.lengthM; u += 2.1) {
      if ((++n & 7) === 0) yield 'banks-sites';
      for (let v = STONE_WIDTH_M + 0.6; v < STONE_WIDTH_M + DEPTH; v += 2.1) {
        const [x, z] = bandPoint(chain, u + (rand() - 0.5) * 1.8, v + (rand() - 0.5) * 1.8);
        if (!clear(x, z)) continue;
        const bed = noise2(x / 24 - 8.3, z / 24 + 2.9);
        const inland = smooth01(STONE_WIDTH_M + 3, STONE_WIDTH_M + DEPTH, v);
        const density = (bed < 0.38 ? 0.55 : bed < 0.62 ? 0.14 : 0.04) * (1 - inland * 0.75);
        if (rand() > density) continue;
        const k = rand();
        if (k < 0.1 + (bed > 0.62 ? 0.25 : 0)) shrubs.push({ x, z, h: 1.8 + rand() * 1.4, r: 0.65 + rand() * 0.3, tile: 6, yaw: rand() * 6.283 });
        else if (k < 0.3) shrubs.push({ x, z, h: 1.0 + rand() * 0.7, r: 0.6 + rand() * 0.35, tile: 5, yaw: rand() * 6.283 });
        else shrubs.push({ x, z, h: 0.8 + rand() * 0.9, r: 0.6 + rand() * 0.5, tile: 4, yaw: rand() * 6.283 });
      }
    }
  }
  return { shrubs, grass };
}
const plantingSites = (...a) => drain(plantingSitesSteps(...a));

// The shared atlas models are unit-size: the shrub's rounded model has radius ~0.636 and height ~1.118 (near), the crossed cards
// are 1 wide and 1 tall (far, and the grass)
const NEAR_R = 0.636, NEAR_H = 1.118, FAR_R = 0.5, FAR_H = 1;

/**
 * Draws the sites with js/park-cover.js's shrub geometry and material (CITY.parkCover): one near and one far instanced mesh per
 * 200 m cell for the shrubs, one crossed-card mesh per cell for the grass. Nothing is drawn if park-cover is not loaded (no
 * stand-in shapes). Returns { group, update(cameraPosition), counts } or null.
 */
function buildPlantingMeshes(sites, T) {
  const pk = C.parkCover;
  if (!pk?.shrubGeometry || !pk.shrubMaterial || !pk.updateShrubViewer) return null;
  const nearMat = pk.shrubMaterial(true), farMat = pk.shrubMaterial(false);
  const cells = new Map();
  const get = (x, z) => { const k = cellKey(x, z); if (!cells.has(k)) cells.set(k, { shrubs: [], grass: [], cx: (Math.floor(x / CELL_M) + 0.5) * CELL_M, cz: (Math.floor(z / CELL_M) + 0.5) * CELL_M }); return cells.get(k); };
  for (const s of sites.shrubs) get(s.x, s.z).shrubs.push(s);
  for (const s of sites.grass) get(s.x, s.z).grass.push(s);
  const group = new T.Group();
  group.name = 'PortLandsPlanting';
  const m = new T.Matrix4(), q = new T.Quaternion(), p = new T.Vector3(), sc = new T.Vector3(), UP = new T.Vector3(0, 1, 0);
  const entries = [];
  const makeMesh = (geo, mat, list, tile0, fade, radius, height, name, shadow) => {
    const n = list.length;
    const aShrub = new T.InstancedBufferAttribute(new Float32Array(n * 4), 4), aFade = new T.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    geo.setAttribute('aShrub', aShrub); geo.setAttribute('aShrubFade', aFade);
    const mesh = new T.InstancedMesh(geo, mat, n);
    list.forEach((s, i) => {
      q.setFromAxisAngle(UP, s.yaw);
      p.set(s.x, GROUND_Y, s.z);
      sc.set(s.r / radius, s.h / height, s.r / radius);
      m.compose(p, q, sc);
      mesh.setMatrixAt(i, m);
      aShrub.setXYZW(i, s.tile, s.x, GROUND_Y + s.h * 0.5, s.z);
      aFade.setXYZW(i, ...fade);
    });
    void tile0;
    mesh.instanceMatrix.needsUpdate = true; aShrub.needsUpdate = true; aFade.needsUpdate = true;
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    mesh.name = name;
    mesh.computeBoundingSphere();
    return mesh;
  };
  let nShrubs = 0, nGrass = 0, meshes = 0;
  for (const [key, c] of cells) {
    const entry = { cx: c.cx, cz: c.cz, shrub: [], grass: [] };
    if (c.shrubs.length) {
      const near = makeMesh(pk.shrubGeometry(true), nearMat, c.shrubs, 4, [-1e6, 1, SHRUB_NEAR_M, 14], NEAR_R, NEAR_H, `PortLandsPlanting-shrub-near-${key}`, true);
      const far = makeMesh(pk.shrubGeometry(false), farMat, c.shrubs, 4, [SHRUB_NEAR_M, 14, PLANT_CULL_M, 30], FAR_R, FAR_H, `PortLandsPlanting-shrub-far-${key}`, false);
      group.add(far, near); entry.shrub.push(near, far); meshes += 2; nShrubs += c.shrubs.length;
    }
    if (c.grass.length) {
      const gm = makeMesh(pk.shrubGeometry(false), farMat, c.grass, 0, [-1e6, 1, GRASS_CULL_M, 25], FAR_R, FAR_H, `PortLandsPlanting-grass-${key}`, false);
      group.add(gm); entry.grass.push(gm); meshes++; nGrass += c.grass.length;
    }
    entries.push(entry);
  }
  const reach = Math.hypot(CELL_M, CELL_M) / 2;
  function update(pos) {
    if (!pos) return;
    pk.updateShrubViewer(pos);
    for (const e of entries) {
      const d = Math.hypot(pos.x - e.cx, pos.z - e.cz) - reach;
      for (const mesh of e.shrub) mesh.visible = d < PLANT_CULL_M + 40;
      for (const mesh of e.grass) mesh.visible = d < GRASS_CULL_M + 40;
    }
  }
  update({ x: 1e9, y: 0, z: 1e9 }); // (everything off until a camera says otherwise)
  return { group, update, counts: { shrubs: nShrubs, grass: nGrass, meshes } };
}

/**
 * Builds the armour-stone banks and the planting for the park's shores. Returns { group, update, stats } (group null when
 * the park's water edges are not found: another frame, or ?portlands=0).
 */
// (a generator, a `yield` after each phase, for main.js's late build; buildPortLandsBanks runs it through at once)
function* buildPortLandsBanksSteps(options = {}) {
  const T = C.THREE;
  const parkRing = options.parkRing;
  if (!parkRing?.length || typeof C.waterAt !== 'function') return { group: null, stats: { chains: 0 } };
  const isLand = (x, z) => !C.waterAt(x, z) && !(C.bridgeAt?.(x, z, 1.5));
  const chains = options.chains || collectBankChains(parkRing, options.bodies, options);
  const rand = mulberry32(0x70727469);
  const cells = { stone: new Map() };
  yield 'banks-chains';
  const slopeTris = yield* buildSlopeSteps(chains, rand, isLand, cells, T);
  yield 'banks-slope';
  const armour = yield* buildArmourSteps(chains, rand, isLand, cells, T);
  yield 'banks-armour';
  const clear = (x, z) => !C.waterAt(x, z) && !C.bridgeAt?.(x, z, 7) && !C.biidaasigeParkClearAt?.(x, z) && (typeof C.blockAt !== 'function' || !C.blockAt(x, z)?.building);
  const sites = yield* plantingSitesSteps(chains, rand, clear);
  yield 'banks-sites';
  const group = new T.Group();
  group.name = 'PortLandsBanks';
  let triangles = slopeTris + armour.triangles, meshes = 0;
  for (const [key, list] of cells.stone) {
    yield 'banks-merge'; // (one cell's stones a step)
    const geo = C.Addons.mergeGeometries(list, false);
    for (const g of list) g.dispose();
    if (!geo) continue;
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    group.add(K.meshOf(geo, 'stone', `PortLandsBanks-armour-${key}`, { cullDistance: 300, cullCell: CELL_M, castShadow: false }));
    meshes++;
  }
  yield 'banks-stone';
  const planting = options.planting === false ? null : buildPlantingMeshes(sites, T);
  if (planting) group.add(planting.group);
  return {
    group: meshes || planting ? group : null, chains, sites, update: planting?.update || null,
    stats: { chains: chains.length, bankLengthM: Math.round(chains.reduce((s, c) => s + c.lengthM, 0)), stones: armour.stones, shrubSites: sites.shrubs.length, grassSites: sites.grass.length, planted: !!planting, ...(planting?.counts || {}), triangles, meshes }
  };
}

const buildPortLandsBanks = (options = {}) => drain(buildPortLandsBanksSteps(options));

Object.assign(C, { buildPortLandsBanks, buildPortLandsBanksSteps, portLandsBankChains: collectBankChains, portLandsPlantingSites: plantingSites, PORTLANDS_BANK_CONFIG: { STONE_WIDTH_M, GROUND_Y, CELL_M } });
})();
