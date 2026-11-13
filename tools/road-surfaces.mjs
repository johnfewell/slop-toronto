// tools/road-surfaces.mjs — the surveyed road surfaces of tools/fixtures/road-surfaces.json and the helpers the road
// build (tools/geo-blocks.mjs, tools/geo-roads.mjs) and its tests share. No data is loaded at import; no dependencies.
// See docs/road-widths.md.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const FIXTURE = fileURLToPath(new URL('fixtures/road-surfaces.json', import.meta.url));
/** The kinds of surveyed surface drawn as roadway; the others (cycle track, median) stay kerbside ground */
export const ROADWAY_KINDS = new Set(['carriageway', 'transit way', 'bridge deck']);
export const KINDS = new Set([...ROADWAY_KINDS, 'cycle track', 'median']);

/** The fixture: `surfaces` (each with a lon/lat `ring` and `roadway` set from its kind), `retire` (City polygons the
 *  2025 orthophoto shows are no longer road), `bridges` (measured deck widths, by OSM way) and `ground` (strips of a
 *  City polygon the orthophoto shows are grass, each with a lon/lat `ring`) */
export function loadRoadSurfaces(file = FIXTURE) {
  const f = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    surfaces: (f.surfaces || []).map((s) => ({ ...s, roadway: ROADWAY_KINDS.has(s.kind) })),
    retire: f.retire || [],
    bridges: f.bridges || [],
    ground: f.ground || []
  };
}

/** OSM way id -> measured carriageway width (m) of the road bridges in the fixture */
export function bridgeWidths(fixture) {
  const m = new Map();
  for (const b of fixture.bridges || []) for (const id of b.ways) m.set(id, b.width);
  return m;
}

/** Area (m²) of a lon/lat ring, on a local flat projection: good to well under 1% over a city block */
export function lonLatArea(ring) {
  const lat0 = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110574;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * kx * ring[i][1] * ky - ring[i][0] * kx * ring[j][1] * ky;
  }
  return Math.abs(a / 2);
}

/** Whether [lon, lat] lies inside the ring (even-odd) */
export function inRing([x, z], r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** City polygons [kind, lon/lat ring] less the retired ones. Each retired entry must match exactly one polygon: same
 *  kind, its `point` inside, its `area` (m²) within 5%. Throws otherwise, so a new City edition cannot silently keep
 *  or drop the wrong road. */
export function retireCityRoadway(polys, retire) {
  if (!retire.length) return polys;
  const drop = new Set();
  for (const r of retire) {
    const hits = [];
    polys.forEach(([kind, ring], i) => {
      if (kind === r.kind && inRing(r.point, ring) && Math.abs(lonLatArea(ring) - r.area) <= 0.05 * r.area) hits.push(i);
    });
    if (hits.length !== 1) throw new Error(`road-surfaces.json: retired City polygon ${r.objectId} matches ${hits.length} polygons`);
    drop.add(hits[0]);
  }
  return polys.filter((_, i) => !drop.has(i));
}

/** Whether a raster ({ res, x0, z0, w, h, d }) has a set cell within `reach` metres of (x, z) */
export function surfaceNear(raster, x, z, reach) {
  const { res, x0, z0, w, h, d } = raster;
  const ci = Math.floor((x - x0) / res), cj = Math.floor((z - z0) / res);
  if (ci >= 0 && cj >= 0 && ci < w && cj < h && d[cj * w + ci]) return true;
  const n = Math.ceil(reach / res), r2 = reach * reach;
  for (let j = Math.max(0, cj - n); j <= Math.min(h - 1, cj + n); j++) {
    const dz = z0 + (j + 0.5) * res - z;
    for (let i = Math.max(0, ci - n); i <= Math.min(w - 1, ci + n); i++) {
      const dx = x0 + (i + 0.5) * res - x;
      if (dx * dx + dz * dz <= r2 && d[j * w + i]) return true;
    }
  }
  return false;
}

/**
 * The road-width rule along one run of a road (docs/road-widths.md). `samples` are points along its centre line
 * ([x, z, along]), `open[i]` says sample i has no mapped surface within reach. Returns each sample's half width: the
 * road's own (`own`) where open, the connector (`thin`) from TAPER metres along the line from any open sample, and a
 * straight taper between.
 */
export function widthProfile(samples, open, own, thin, taper) {
  const gap = samples.map(() => Infinity);
  let last = -Infinity;
  for (let i = 0; i < samples.length; i++) { if (open[i]) last = samples[i][2]; gap[i] = samples[i][2] - last; }
  last = Infinity;
  for (let i = samples.length - 1; i >= 0; i--) { if (open[i]) last = samples[i][2]; gap[i] = Math.min(gap[i], last - samples[i][2]); }
  return gap.map((g) => (g >= taper ? thin : own - ((own - thin) * g) / taper));
}

/** The mapped cycle tracks the own-width rule must not spread over: OpenStreetMap's cycleways (and paths designated
 *  for bikes), not their crossings, bridges or tunnels, as segments in world metres with their half width, in a grid.
 *  `ways`: [{ tags, pts: [[x, z], ...] }] */
export function cycleTrackIndex(ways, cell = 32) {
  const grid = new Map();
  let n = 0;
  for (const { tags: t = {}, pts } of ways) {
    const bike = t.highway === 'cycleway' || (/^(path|footway)$/.test(t.highway || '') && t.bicycle === 'designated');
    if (!bike || /crossing/.test(t.cycleway || '') || /crossing/.test(t.footway || '') || t.bridge === 'yes' || t.tunnel === 'yes') continue;
    const tagged = parseFloat(t.width);
    const half = (tagged > 0 && tagged < 8 ? tagged : t.oneway === 'yes' ? 2 : 3) / 2;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.5) continue;
      const seg = { ax, az, bx, bz, tx: (bx - ax) / L, tz: (bz - az) / L, L, half };
      n++;
      for (let gx = Math.floor((Math.min(ax, bx) - 16) / cell); gx <= Math.floor((Math.max(ax, bx) + 16) / cell); gx++) {
        for (let gz = Math.floor((Math.min(az, bz) - 16) / cell); gz <= Math.floor((Math.max(az, bz) + 16) / cell); gz++) {
          const k = gx + ',' + gz;
          (grid.get(k) || grid.set(k, []).get(k)).push(seg);
        }
      }
    }
  }
  return { grid, cell, segments: n };
}

/** The widest a road may be drawn at (x, z), running along (tx, tz), without covering a mapped cycle track beside it:
 *  the distance to the near edge of the nearest track running alongside (within PARALLEL of the road's direction, so a
 *  track crossing the road does not count), or Infinity */
export const PARALLEL = 0.8;
export function trackClearance(index, x, z, tx, tz) {
  let best = Infinity;
  for (const s of index.grid.get(Math.floor(x / index.cell) + ',' + Math.floor(z / index.cell)) || []) {
    if (Math.abs(s.tx * tx + s.tz * tz) < PARALLEL) continue;
    let t = ((x - s.ax) * s.tx + (z - s.az) * s.tz);
    if (t < 0 || t > s.L) continue; // (beside the track, not off its end)
    const d = Math.abs((x - s.ax) * s.tz - (z - s.az) * s.tx) - s.half;
    if (d < best) best = d;
  }
  return best;
}

