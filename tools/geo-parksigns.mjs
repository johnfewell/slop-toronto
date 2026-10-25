// Part 7b: the City's park name signs ("A CITY WITHIN A PARK", js/park-signs.js): one at the main entrance of every named
// City park in the detailed city, with the park's name and its address (OpenStreetMap addr:housenumber / addr:street).
// The sign stands where a park path meets the street: just inside the park, beside the path, square to the park's edge
// and facing out to the street. Its entrance: the path crossing the park's edge nearest the addressed street, else the
// edge nearest that street, else the path crossing (or the edge) nearest any street. Each sign keeps clear of the
// sidewalk & verge (SIDEWALK in from the curb), the paths, driveways and the other street props.
// Output: [[x, z, yaw (rad: the model's +z, its face, turned toward the street), name, house number, street], ...]
import { load, log, osmRoads, pointInRing, toWorld } from './geo-base.mjs';
import { inDetail, ways } from './geo-roads.mjs';
import { elemRings } from './geo-land.mjs';
import { blocks, SIDEWALK } from './geo-blocks.mjs';

const HALF_W = 1.05; // half the sign's width, posts & collars included (m)
// (trees: GEO.streetTrees' flat [x, z, model, height, ...])
const r2 = (v) => Math.round(v * 100) / 100;

// Not City parks (or not ones that get a park sign): private & institutional grounds, courtyards, traffic islands
const NOT_CITY = /\b(quad|courtyard|backyard|campus|community garden|healing garden|diversity garden|children's garden|traffic island|church park|burying ground|martonmere)\b|^the pasture$|^the park at |^(canada|ontario) square$|crescent$/i;
function cityPark(t) {
  if (!t.name || t.leisure !== 'park') return false;
  if (t.access === 'private' || t.ownership === 'private' || t['operator:type'] === 'private') return false;
  if (t.operator && !/city of toronto/i.test(t.operator)) return false;
  return !NOT_CITY.test(t.name);
}

// --- segment grids -----------------------------------------------------------------------------------------------------
const CELL = 40;
function segGrid(lines) { // lines: [{ pts, ...}] -> Map(cell -> [[line, i]])
  const g = new Map();
  for (const l of lines) {
    for (let i = 0; i + 1 < l.pts.length; i++) {
      const [ax, az] = l.pts[i], [bx, bz] = l.pts[i + 1];
      for (let ix = Math.floor(Math.min(ax, bx) / CELL); ix <= Math.floor(Math.max(ax, bx) / CELL); ix++) {
        for (let iz = Math.floor(Math.min(az, bz) / CELL); iz <= Math.floor(Math.max(az, bz) / CELL); iz++) {
          const k = ix * 100003 + iz;
          if (!g.has(k)) g.set(k, []);
          g.get(k).push([l, i]);
        }
      }
    }
  }
  return g;
}
function segDist(px, pz, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / L2));
  return Math.hypot(a[0] + t * dx - px, a[1] + t * dz - pz);
}
// nearest segment within r of (x, z) among the grid's lines that pass `keep`
function nearest(g, x, z, r, keep = () => true) {
  let best = Infinity, line = null;
  for (let ix = Math.floor((x - r) / CELL); ix <= Math.floor((x + r) / CELL); ix++) {
    for (let iz = Math.floor((z - r) / CELL); iz <= Math.floor((z + r) / CELL); iz++) {
      for (const [l, i] of g.get(ix * 100003 + iz) || []) {
        if (!keep(l)) continue;
        const d = segDist(x, z, l.pts[i], l.pts[i + 1]);
        if (d < best) { best = d; line = l; }
      }
    }
  }
  return { d: best, line };
}
function crossing(p0, p1, q0, q1) { // the point where segments p and q cross, with its parameter along q
  const rx = p1[0] - p0[0], rz = p1[1] - p0[1], sx = q1[0] - q0[0], sz = q1[1] - q0[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q0[0] - p0[0]) * sz - (q0[1] - p0[1]) * sx) / den;
  const u = ((q0[0] - p0[0]) * rz - (q0[1] - p0[1]) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [p0[0] + t * rx, p0[1] + t * rz, u] : null;
}

// streets (named, at grade, not service roads) & every carriageway (driveways included, for the clearance)
const streets = ways.filter((w) => w.name && !w.bridge && !w.tunnel && w.cls !== 'service');
const streetGrid = segGrid(streets);
const carGrid = segGrid(ways.filter((w) => !w.bridge && !w.tunnel));
// park paths (an entrance) and every walkway (kept clear of)
const walks = [];
for (const e of osmRoads.elements) {
  const t = e.tags || {};
  if (!/^(footway|path|pedestrian|cycleway|steps|bridleway)$/.test(t.highway || '') || !e.geometry || e.geometry.length < 2) continue;
  if (t.area === 'yes') continue;
  const pts = e.geometry.map((g) => toWorld(g.lon, g.lat));
  walks.push({ pts, path: /^(footway|path|pedestrian)$/.test(t.highway) && !/^(sidewalk|crossing|traffic_island)$/.test(t.footway || ''), wide: t.highway === 'pedestrian' });
}
const walkGrid = segGrid(walks);

// curb islands by a coarse grid: the one under a point, and how far in from its curb the point is
const BCELL = 200, blockGrid = new Map();
for (const b of blocks) {
  const [x0, x1, z0, z1] = b.bbox;
  for (let ix = Math.floor(x0 / BCELL); ix <= Math.floor(x1 / BCELL); ix++) {
    for (let iz = Math.floor(z0 / BCELL); iz <= Math.floor(z1 / BCELL); iz++) {
      const k = ix * 100003 + iz;
      if (!blockGrid.has(k)) blockGrid.set(k, []);
      blockGrid.get(k).push(b);
    }
  }
}
function curbDepth(x, z) { // metres in from the curb, or -1 off the blocks
  for (const b of blockGrid.get(Math.floor(x / BCELL) * 100003 + Math.floor(z / BCELL)) || []) {
    const [x0, x1, z0, z1] = b.bbox;
    if (x < x0 || x > x1 || z < z0 || z > z1 || !pointInRing(x, z, b.poly)) continue;
    let d = Infinity;
    for (let i = 0, j = b.poly.length - 1; i < b.poly.length; j = i++) d = Math.min(d, segDist(x, z, b.poly[j], b.poly[i]));
    return d;
  }
  return -1;
}

export function parkSigns(props, trees = []) {
  // the other street props, kept 1.5 m clear of, and the City's trees (their trunks 2.5 m)
  const others = new Map(), trunks = new Map();
  for (let i = 0; i + 1 < trees.length; i += 4) {
    const k = Math.floor(trees[i] / 10) * 100003 + Math.floor(trees[i + 1] / 10);
    if (!trunks.has(k)) trunks.set(k, []);
    trunks.get(k).push([trees[i], trees[i + 1]]);
  }
  for (const pts of Object.values(props)) {
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const k = Math.floor(pts[i] / 10) * 100003 + Math.floor(pts[i + 1] / 10);
      if (!others.has(k)) others.set(k, []);
      others.get(k).push([pts[i], pts[i + 1]]);
    }
  }
  const nearProp = (x, z, r, g = others) => {
    for (let ix = Math.floor((x - r) / 10); ix <= Math.floor((x + r) / 10); ix++) {
      for (let iz = Math.floor((z - r) / 10); iz <= Math.floor((z + r) / 10); iz++) {
        for (const [px, pz] of g.get(ix * 100003 + iz) || []) if (Math.hypot(px - x, pz - z) < r) return true;
      }
    }
    return false;
  };

  // one park per name: the polygon with an address, else the biggest
  const parks = new Map();
  for (const e of load('osm_land.json').elements) {
    const t = e.tags || {};
    if (!cityPark(t)) continue;
    const rings = elemRings(e);
    if (!rings.length || !rings.some((r) => r.some(([x, z]) => inDetail(x, z, -20)))) continue;
    const area = rings.reduce((s, r) => s + Math.abs(r.reduce((a, p, i) => a + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0) / 2), 0);
    const prev = parks.get(t.name);
    const score = (t['addr:street'] ? 1e12 : 0) + area;
    if (!prev || score > prev.score) parks.set(t.name, { t, rings, score });
  }

  const out = [];
  const placed = [];
  let fallbacks = 0, skipped = [];
  for (const [name, { t, rings }] of parks) {
    const street = (t['addr:street'] || '').split(';')[0].trim();
    const number = (t['addr:housenumber'] || '').split(';')[0].trim();
    const isStreet = street ? (l) => l.name.toLowerCase() === street.toLowerCase() : null;
    // entrances: [x, z, ring, edge index, how good (lower first), path]
    const cands = [];
    for (const ring of rings) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      const seen = new Set();
      for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++) {
        for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++) {
          for (const [w, i] of walkGrid.get(ix * 100003 + iz) || []) {
            if (!w.path || seen.has(w)) continue;
            seen.add(w);
            for (let s = 0; s + 1 < w.pts.length; s++) {
              const a = w.pts[s], b = w.pts[s + 1];
              for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) {
                const c = crossing(ring[j], ring[k], a, b);
                if (!c) continue;
                const ex = ring[k][0] - ring[j][0], ez = ring[k][1] - ring[j][1], el = Math.hypot(ex, ez) || 1;
                const fx = b[0] - a[0], fz = b[1] - a[1], fl = Math.hypot(fx, fz) || 1;
                if (Math.abs(ex * fz - ez * fx) / (el * fl) < 0.5) continue; // runs along the edge, not into the park
                const named = isStreet ? nearest(streetGrid, c[0], c[1], 40, isStreet).d : Infinity;
                const any = nearest(streetGrid, c[0], c[1], 40).d;
                const rank = named <= 25 ? named : !street && any <= 25 ? 100 + any : 300 + any;
                cands.push([c[0], c[1], ring, j, rank, w.wide ? 3.2 : 2.4]);
              }
            }
          }
        }
      }
      // the park's edge, every 2 m: the point nearest the addressed street, then nearest any street
      for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) {
        const ex = ring[k][0] - ring[j][0], ez = ring[k][1] - ring[j][1], el = Math.hypot(ex, ez);
        for (let s = 1; s < el; s += 2) {
          const x = ring[j][0] + (ex * s) / el, z = ring[j][1] + (ez * s) / el;
          const named = isStreet ? nearest(streetGrid, x, z, 60, isStreet).d : Infinity;
          const any = nearest(streetGrid, x, z, 40).d;
          if (named <= 60) cands.push([x, z, ring, j, 200 + named, 0]);
          else if (any <= 40) cands.push([x, z, ring, j, 400 + any, 0]);
        }
      }
    }
    cands.sort((a, b) => a[4] - b[4]);
    let site = null;
    for (const [cx, cz, ring, j, rank, side] of cands.slice(0, 80)) {
      const k = (j + 1) % ring.length;
      const ex = ring[k][0] - ring[j][0], ez = ring[k][1] - ring[j][1], el = Math.hypot(ex, ez) || 1;
      const tx = ex / el, tz = ez / el;
      let nx = -tz, nz = tx; // the edge's normal, turned to point into the park
      if (!pointInRing(cx + nx * 0.6, cz + nz * 0.6, ring)) { nx = -nx; nz = -nz; }
      const offs = side ? [side, -side, side + 1, -side - 1, side + 2.5, -side - 2.5] : [0, 1.5, -1.5, 3, -3, 5, -5];
      for (const depth of [1.0, 1.5, 2.5, 3.5, 5, 7]) {
        for (const off of offs) {
          const x = cx + nx * depth + tx * off, z = cz + nz * depth + tz * off;
          const pts = [[x, z], [x - tx * HALF_W, z - tz * HALF_W], [x + tx * HALF_W, z + tz * HALF_W]];
          if (!pts.every(([px, pz]) => inDetail(px, pz) && pointInRing(px, pz, ring))) continue;
          if (!pts.every(([px, pz]) => curbDepth(px, pz) >= SIDEWALK + 0.5)) continue;
          if (pts.some(([px, pz]) => nearest(walkGrid, px, pz, 2).d < 1.2)) continue;
          if (pts.some(([px, pz]) => nearest(carGrid, px, pz, 4).d < 3.5)) continue; // driveways
          if (pts.some(([px, pz]) => nearProp(px, pz, 1.5) || nearProp(px, pz, 2.5, trunks)) || placed.some(([qx, qz]) => Math.hypot(qx - x, qz - z) < 4)) continue;
          site = [x, z, Math.atan2(-nx, -nz), rank];
          break;
        }
        if (site) break;
      }
      if (site) break;
    }
    if (!site) { skipped.push(name); continue; }
    if (site[3] >= 200) fallbacks++;
    placed.push(site);
    const nice = name.replace(/\bpark$/, 'Park');
    out.push([r2(site[0]), r2(site[1]), Math.round(site[2] * 1000) / 1000, nice, number, street]);
  }
  out.sort((a, b) => a[3].localeCompare(b[3]));
  log(`park signs: ${out.length} of ${parks.size} named City parks (${out.length - fallbacks} at a path entrance, ${fallbacks} on the edge nearest the street); no clear spot: ${skipped.join(', ') || 'none'}`);
  return out;
}
