// tools/lidar-trees-lib.mjs — the pure parts of tools/build-lidar-trees.mjs (docs/lidar-trees.md), shared with its tests:
// the shared Toronto data repo's `trees/2` positions (UTM zone 17N, the lidar's grid) to this city's world frame, the
// model a tree gets from its height and crown, the woods flag, and the packed format js/lidar-trees.js reads.
import { utm17ToLatLon } from './terrain-pilot-lib.mjs';

/** UTM 17N (E, N) to world { x, z }: back to lat/lon with no datum shift, then the shipped projection (C.worldFromLatLon) */
export function worldFromUtm(C, E, N) {
  const [lat, lon] = utm17ToLatLon(E, N);
  return C.worldFromLatLon(lat, lon);
}

/** A stable 0..1 hash of a position quantised to 0.25 m: the same tree gets the same draw on every rebuild */
export function hashPos(x, z, salt = 0) {
  let h = Math.imul(Math.round(x * 4) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(z * 4) | 0, 0x165667b1) ^ Math.imul(salt + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// The EZ-Tree models a lidar-only tree may take (assets/trees). The lidar gives no species: a narrow crown (radius under
// a fifth of the height, 8 m or taller) is a pine or an aspen's column, half each; any other crown a broadleaf, 75% oak
// (the stand-in for Toronto's maples, as in the parks), 20% ash, 5% aspen. Small under 9 m, medium under 15 m, large
// from there (the parks' breaks; the aspen has no small model).
export const MODELS = ['ez-oak-small', 'ez-oak-medium', 'ez-oak-large', 'ez-ash-small', 'ez-ash-medium', 'ez-ash-large',
  'ez-aspen-medium', 'ez-aspen-large', 'ez-pine-small-a', 'ez-pine-medium-a', 'ez-pine-large-a'];
export function modelFor(h, r, x, z) {
  const size = h < 9 ? 0 : h < 15 ? 1 : 2;
  const u = hashPos(x, z, 7);
  let kind;
  if (h >= 8 && r < 0.2 * h) kind = u < 0.5 ? 'pine' : 'aspen';
  else kind = u < 0.75 ? 'oak' : u < 0.95 ? 'ash' : 'aspen';
  const id = kind === 'aspen' ? (size === 2 ? 'ez-aspen-large' : 'ez-aspen-medium')
    : kind === 'pine' ? ['ez-pine-small-a', 'ez-pine-medium-a', 'ez-pine-large-a'][size]
      : `ez-${kind}-${['small', 'medium', 'large'][size]}`;
  return MODELS.indexOf(id);
}

/**
 * The woods flag, as the parks' woods (tools/build-park-woods.mjs): a tree stands in woods when canopy covers 60% or more
 * of the ground within 12 m. The canopy is the union of the crowns (each a disc of its radius round its top), on a 2 m
 * grid. `all`: every lidar crown, drawn or not ({ x, z, r }). Returns a function (x, z) -> boolean.
 */
export function woodsTest(all, R = 12, share = 0.6, cell = 2) {
  // (the covered cells on a byte grid over the crowns' extent: a Set of them passes V8's 2^24 entries on the Eglinton map)
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  for (const c of all) {
    const r = Math.max(0, c.r);
    i0 = Math.min(i0, Math.floor((c.x - r) / cell)); i1 = Math.max(i1, Math.floor((c.x + r) / cell));
    j0 = Math.min(j0, Math.floor((c.z - r) / cell)); j1 = Math.max(j1, Math.floor((c.z + r) / cell));
  }
  const W = all.length ? i1 - i0 + 1 : 0, H = all.length ? j1 - j0 + 1 : 0, grid = new Uint8Array(W * H);
  const has = (i, j) => i >= i0 && i <= i1 && j >= j0 && j <= j1 && grid[(j - j0) * W + (i - i0)] === 1;
  for (const c of all) {
    const r = Math.max(0, c.r);
    for (let i = Math.floor((c.x - r) / cell); i <= Math.floor((c.x + r) / cell); i++) {
      for (let j = Math.floor((c.z - r) / cell); j <= Math.floor((c.z + r) / cell); j++) {
        const dx = (i + 0.5) * cell - c.x, dz = (j + 0.5) * cell - c.z;
        if (dx * dx + dz * dz <= r * r) grid[(j - j0) * W + (i - i0)] = 1;
      }
    }
  }
  const ring = [];
  const n = Math.ceil(R / cell);
  for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) if ((a * cell) ** 2 + (b * cell) ** 2 <= R * R) ring.push([a, b]);
  return (x, z) => {
    const x0 = Math.floor(x / cell), z0 = Math.floor(z / cell);
    let s = 0;
    for (const [a, b] of ring) if (has(x0 + a, z0 + b)) s++;
    return s / ring.length >= share;
  };
}

/** Points within `r` of one another: a grid of `cell` m over [x, z] pairs; returns (x, z) -> boolean */
export function nearIndex(points, r) {
  const cell = Math.max(r, 4), grid = new Map();
  for (const [x, z] of points) {
    const k = Math.floor(x / cell) * 100000 + Math.floor(z / cell);
    (grid.get(k) || grid.set(k, []).get(k)).push(x, z);
  }
  return (x, z) => {
    const i0 = Math.floor(x / cell), j0 = Math.floor(z / cell);
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
      const l = grid.get(i * 100000 + j);
      if (l) for (let q = 0; q < l.length; q += 2) if ((l[q] - x) ** 2 + (l[q + 1] - z) ** 2 <= r * r) return true;
    }
    return false;
  };
}

// The packed trees: N x as Uint16 (0.25 m from x0), N z as Uint16 (0.25 m from z0), N heights as Uint8 (0.2 m), N crown
// radii as Uint8 (0.1 m), N codes as Uint8 (bits 0-3 the model, 4 woods, 5 park). 7 bytes a tree, base64.
export const Q = { xz: 0.25, h: 0.2, r: 0.1 };
export function pack(trees, x0, z0) {
  return Buffer.from(packBytes(trees, x0, z0)).toString('base64');
}
/** The same packing as raw bytes (the Eglinton map's cell files, data/frames/eglinton/lidar-trees/) */
export function packBytes(trees, x0, z0) {
  const N = trees.length, buf = new Uint8Array(N * 7), dv = new DataView(buf.buffer);
  trees.forEach((t, i) => {
    dv.setUint16(i * 2, Math.round((t.x - x0) / Q.xz), true);
    dv.setUint16(N * 2 + i * 2, Math.round((t.z - z0) / Q.xz), true);
    buf[N * 4 + i] = Math.min(255, Math.round(t.h / Q.h));
    buf[N * 5 + i] = Math.min(255, Math.round(t.r / Q.r));
    buf[N * 6 + i] = (t.model & 15) | (t.woods ? 16 : 0) | (t.park ? 32 : 0);
  });
  return buf;
}
export function unpack(b64, N, x0, z0) {
  const buf = typeof b64 === 'string' ? Uint8Array.from(Buffer.from(b64, 'base64')) : Uint8Array.from(b64), dv = new DataView(buf.buffer), out = [];
  for (let i = 0; i < N; i++) {
    const code = buf[N * 6 + i];
    out.push({ x: x0 + dv.getUint16(i * 2, true) * Q.xz, z: z0 + dv.getUint16(N * 2 + i * 2, true) * Q.xz,
      h: buf[N * 4 + i] * Q.h, r: buf[N * 5 + i] * Q.r, model: code & 15, woods: !!(code & 16), park: !!(code & 32) });
  }
  return out;
}

/**
 * The drop rules, in order (docs/lidar-trees.md). `t`: a lidar crown in world { x, z, src }; `k`: the keep-outs, each a
 * function (x, z) or a value. Returns the name of the first rule that drops it, or null to keep it.
 */
export const RULES = ['notLidarOnly', 'outsideFrame', 'woodsLayer', 'islandCanopy', 'nearStreetTree', 'water', 'roadway',
  'sidewalk', 'building', 'railLandmarkTrailBridge', 'roadDeck', 'parkPath', 'pitch'];
export function dropReason(t, k) {
  if (t.src !== 2) return 'notLidarOnly';
  if (!k.inFrame(t.x, t.z)) return 'outsideFrame';
  if (k.woodsLayer(t.x, t.z)) return 'woodsLayer';
  if (k.islandCanopy(t.x, t.z)) return 'islandCanopy';
  if (k.nearStreetTree(t.x, t.z)) return 'nearStreetTree';
  if (k.water(t.x, t.z)) return 'water';
  if (k.roadway(t.x, t.z)) return 'roadway';
  if (k.sidewalk(t.x, t.z)) return 'sidewalk';
  if (k.building(t.x, t.z)) return 'building';
  if (k.offRail(t.x, t.z)) return 'railLandmarkTrailBridge';
  if (k.roadDeck(t.x, t.z)) return 'roadDeck';
  if (k.parkPath(t.x, t.z)) return 'parkPath';
  if (k.pitch(t.x, t.z)) return 'pitch';
  return null;
}

/** The kept yard trees (not on a park island) by height, for the small-tree question (docs/lidar-trees.md) */
export function yardHeights(trees) {
  const out = { under4: 0, from4to5: 0, from5to7: 0, from7: 0 };
  for (const t of trees) {
    if (t.park) continue;
    if (t.h < 4) out.under4++; else if (t.h < 5) out.from4to5++; else if (t.h < 7) out.from5to7++; else out.from7++;
  }
  const n = out.under4 + out.from4to5 + out.from5to7 + out.from7;
  return { ...out, yards: n, shareUnder5: n ? Math.round(((out.under4 + out.from4to5) / n) * 1000) / 1000 : 0 };
}

/** The 1,200 m cell of the far band's grid (city-config.js FAR_BAND.cell, scene-culling.js's keys) a position is in */
export const CELL_M = 1200;
export const cellOf = (x, z) => [Math.floor(x / CELL_M), Math.floor(z / CELL_M)];
