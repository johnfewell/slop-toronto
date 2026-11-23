// tools/building-era-frame.mjs — the detail frame and the massing outlines, as the building-era investigation needs
// them (docs/building-era-sources.md, bead st-ndw9.2). Shared by tools/report-building-era.mjs and its test.
// The projection is the committed GEO.frame.projection (an area-preserving local frame, x = kx * dlon, z = ky * dlat,
// rotated by theta, z negated to the renderer's world frame), written the way tools/audit-qcyc-clubhouse.mjs writes it.
// Nothing here fetches or writes: the caller reads js/toronto-geodata.js and data/toronto-massing.bin.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { unpackGeo } from '../js/geodata-loader.js';
import { massingRows } from '../js/massing-data.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The committed GEO, evaluated in a sandbox (the generated script sets window.CITY.GEO) */
export function loadGeo() {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/toronto-geodata.js'), 'utf8'), ctx);
  return ctx.window.CITY.GEO;
}

/** The committed GEO_IDS (js/toronto-geodata-ids.js: each row's durable massing ID, docs/geodata-ids.md) */
export function loadIds() {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/toronto-geodata-ids.js'), 'utf8'), ctx);
  return ctx.window.CITY.GEO_IDS;
}

/** lon/lat -> world [x, z] in metres (the renderer's frame; z grows south) */
export function project(P, lon, lat) {
  const x0 = (lon - P.lon0) * P.kx;
  const z0 = (lat - P.lat0) * P.ky;
  const c = Math.cos(P.theta);
  const s = Math.sin(P.theta);
  return [x0 * c - z0 * s, -(x0 * s + z0 * c)];
}

/** world [x, z] -> [lon, lat], the exact inverse of project */
export function unproject(P, x, z) {
  const c = Math.cos(P.theta);
  const s = Math.sin(P.theta);
  const zr = -z;
  return [P.lon0 + (x * c + zr * s) / P.kx, P.lat0 + (-x * s + zr * c) / P.ky];
}

/** Point in the detail frame rectangle (GEO.frame.detail), for a world [x, z] */
export function inDetail(G, x, z) {
  const f = G.frame.detail;
  return x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1;
}

/** Even-odd point in the outer ring (courtyards are not part of the mass), for a world [x, z] */
export function inRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[j];
    const [bx, bz] = ring[i];
    if ((az > z) !== (bz > z) && x < ax + ((z - az) / (bz - az)) * (bx - ax)) inside = !inside;
  }
  return inside;
}

/** Distance from [x, z] to the closed polygon ring (0 when inside), in metres */
export function distanceToRing(ring, x, z) {
  if (inRing(ring, x, z)) return 0;
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[j];
    const [bx, bz] = ring[i];
    const dx = bx - ax;
    const dz = bz - az;
    const len = dx * dx + dz * dz;
    let t = len ? ((x - ax) * dx + (z - az) * dz) / len : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx;
    const pz = az + t * dz;
    best = Math.min(best, Math.hypot(x - px, z - pz));
  }
  return best;
}

/** The massing outlines the sidecar holds, as [{ id, row, rings }] (js/massing-data.js; `row` is the GEO.buildings row
 * the sidecar's row column points at) */
export async function loadMassing(G) {
  const { MASSING } = await unpackGeo(fs.readFileSync(path.join(ROOT, 'data/toronto-massing.bin')));
  const loaded = massingRows(MASSING, G);
  if (loaded.error) throw new Error(loaded.error);
  const ids = loadIds();
  const out = [];
  for (const [row, o] of loaded.rows) out.push({ ...o, row, key: ids.buildings[row] });
  return out;
}

// A uniform grid over the detail rectangle: each outline is added to every cell its bounding box touches, so a query
// tests a handful of rings rather than 35,000.
const CELL = 50;
export function ringGrid(G, rings) {
  const f = G.frame.detail;
  const nx = Math.ceil((f.x1 - f.x0) / CELL) + 1;
  const nz = Math.ceil((f.z1 - f.z0) / CELL) + 1;
  const cells = new Map();
  const key = (ix, iz) => ix * nz + iz;
  for (const item of rings) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of item.ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const ix0 = Math.max(0, Math.floor((x0 - f.x0) / CELL)), ix1 = Math.min(nx - 1, Math.floor((x1 - f.x0) / CELL));
    const iz0 = Math.max(0, Math.floor((z0 - f.z0) / CELL)), iz1 = Math.min(nz - 1, Math.floor((z1 - f.z0) / CELL));
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const k = key(ix, iz);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(item);
    }
  }
  const lookup = (x, z) => {
    const ix = Math.floor((x - f.x0) / CELL);
    const iz = Math.floor((z - f.z0) / CELL);
    return cells.get(key(ix, iz));
  };
  return {
    /** ring-holding items whose bounding box touches the cell holding [x, z] (may include items that miss the point) */
    near(x, z) { return lookup(x, z) || []; },
    /** every ring-holding item within `r` metres: the 3x3 cells when r <= CELL, else a square of cells, then the distance */
    within(x, z, r) {
      const reach = Math.ceil(r / CELL);
      const ix = Math.floor((x - f.x0) / CELL), iz = Math.floor((z - f.z0) / CELL);
      const out = [];
      for (let a = ix - reach; a <= ix + reach; a++) for (let b = iz - reach; b <= iz + reach; b++) {
        const list = cells.get(key(a, b));
        if (!list) continue;
        for (const item of list) if (distanceToRing(item.ring, x, z) <= r) out.push(item);
      }
      return out;
    },
  };
}

/**
 * Match each point (an { id, x, z } record, any extra fields kept) to a massing outline: a point inside an outline
 * takes that outline, the lowest row when outlines overlap; otherwise the nearest outline whose edge is within 15 m.
 * Returns { matches: Map(point -> { id, row, how: 'inside'|'within-15m', distance }), matched, inside, within, unmatched }.
 */
export function matchToMassing(G, outlines, points) {
  const grid = ringGrid(G, outlines.map((o) => ({ ...o, ring: o.rings[0] })));
  const matches = new Map();
  let inside = 0, within = 0;
  for (const p of points) {
    let best = null;
    for (const o of grid.near(p.x, p.z)) {
      if (inRing(o.ring, p.x, p.z) && (!best || o.row < best.row)) best = { id: o.id, row: o.row, how: 'inside', distance: 0 };
    }
    if (!best) {
      for (const o of grid.within(p.x, p.z, 15)) {
        const d = distanceToRing(o.ring, p.x, p.z);
        if (!best || d < best.distance) best = { id: o.id, row: o.row, how: 'within-15m', distance: d };
      }
    }
    if (best) { matches.set(p, best); if (best.how === 'inside') inside++; else within++; }
  }
  return { matches, matched: matches.size, inside, within, unmatched: points.length - matches.size };
}

/** Mean of a ring's corners */
export function centroid(ring) {
  let x = 0, z = 0;
  for (const [a, b] of ring) { x += a; z += b; }
  return [x / ring.length, z / ring.length];
}

/**
 * Count, for each outline, the points of `points` (each an { x, z } record) inside its outer ring, and among
 * overlapping outlines the one whose centre is nearest the point (so a shared wall or a duplicated record does not
 * take its neighbour's addresses). Each outline here must carry a unique `key`. Returns Map(key -> count).
 */
export function countInside(G, outlines, points) {
  const grid = ringGrid(G, outlines.map((o) => ({ ...o, ring: o.rings[0] })));
  const counts = new Map(outlines.map((o) => [o.key, 0]));
  for (const p of points) {
    let best = null, bestD = Infinity;
    for (const o of grid.near(p.x, p.z)) {
      if (!inRing(o.ring, p.x, p.z)) continue;
      const [cx, cz] = centroid(o.ring);
      const d = Math.hypot(cx - p.x, cz - p.z);
      if (d < bestD) { bestD = d; best = o; }
    }
    if (best) counts.set(best.key, counts.get(best.key) + 1);
  }
  return counts;
}

/**
 * Count, for each outline, the polygons of `polygons` (each { ring }) whose centre lies inside the outline, nearest
 * centre winning as in countInside. Returns Map(key -> count).
 */
export function countPolygonsCentredInside(G, outlines, polygons) {
  const grid = ringGrid(G, outlines.map((o) => ({ ...o, ring: o.rings[0] })));
  const counts = new Map(outlines.map((o) => [o.key, 0]));
  for (const poly of polygons) {
    const [x, z] = centroid(poly.ring);
    let best = null, bestD = Infinity;
    for (const o of grid.near(x, z)) {
      if (!inRing(o.ring, x, z)) continue;
      const [cx, cz] = centroid(o.ring);
      const d = Math.hypot(cx - x, cz - z);
      if (d < bestD) { bestD = d; best = o; }
    }
    if (best) counts.set(best.key, counts.get(best.key) + 1);
  }
  return counts;
}
