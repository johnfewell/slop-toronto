// tools/build-sidewalks.mjs: writes js/toronto-sidewalks.js, the City of Toronto's physical sidewalks clipped to the curb
// islands of js/toronto-geodata.js (docs/sidewalk-polygons.md).
//
// Source: "Topographic Mapping – Physical area of sidewalks" (City of Toronto Open Data, Open Government Licence –
// Toronto; tools/fetch-sidewalks.mjs puts it in ~/.cache/slop-toronto/raw/sidewalks). Polygons digitized from aerial
// photography, +/- 30 cm. Their ELEVATION field is 0 throughout and is not a surveyed height: it is ignored.
//
// Each polygon is simplified (0.2 m, topology kept), repaired, and clipped by GEOS (GDAL's SQLite dialect with
// SpatiaLite: ogr2ogr is already a prerequisite of the geodata tools) to every island's raised slab, the island's curb
// outline 0.25 m in (city-grid.js offsetPolygonInward, taken from that file so the two can't drift apart). Medians and
// islands of 400 m² or less (the slab is all walkway there) are left out. What lies on the roadway, past the city's
// curbs, is dropped: the sidewalks only re-surface ground the city already raises, so heights, collisions and the
// walking surface stay as they are. Rings are stored in decimetres, delta-encoded (js/sidewalk-polygons.js decodes them).
//
// usage: node tools/build-sidewalks.mjs [sidewalks-4326.gpkg] [out.js]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RAW = path.join(os.homedir(), '.cache/slop-toronto/raw/sidewalks');
export const INSET = 0.25; // city-grid.js: the slab stands this far in from the curb (the kerb's top shows)
export const TOLERANCE = 0.2; // simplification (m): under the source's +/- 30 cm
const MIN_PIECE = 1.0; // m²: a piece smaller than this is a clipping sliver
const MIN_HOLE = 0.5;
const LAYER = 'Sidewalks - 4326';
const DECK_CLEAR = 3; // m: a deck this high or more is a bridge or flyover the walkers' ground runs under

// The browser's own inset (js/city-grid.js), so the build clips to exactly the slab the city draws
export function runtimeInset() {
  const src = fs.readFileSync(path.join(ROOT, 'js/city-grid.js'), 'utf8').match(/\nfunction offsetPolygonInward\(pts, d\) \{[\s\S]*?\n\}\n/);
  if (!src) throw new Error('js/city-grid.js: offsetPolygonInward(pts, d) not found');
  return vm.runInNewContext(`(${src[0].trim()})`);
}
export function loadCity(geodataPath = path.join(ROOT, 'js/toronto-geodata.js')) {
  const ctx = { window: { CITY: {} }, console };
  vm.runInNewContext(fs.readFileSync(geodataPath, 'utf8'), ctx);
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/sidewalk-polygons.js'), 'utf8'), ctx);
  return ctx.window.CITY;
}
export const ringArea = (r) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
};
const projector = ({ lat0, lon0, kx, ky, theta, ox, oz }) => {
  const c = Math.cos(theta), s = Math.sin(theta);
  return {
    toWorld: (lon, lat) => {
      const e = (lon - lon0) * kx, n = (lat - lat0) * ky;
      return [e * c - n * s - ox, -(e * s + n * c) - oz];
    },
    toLonLat: (x, z) => {
      const u = x + ox, v = z + oz;
      return [lon0 + (u * c - v * s) / kx, lat0 + (-u * s - v * c) / ky];
    }
  };
};
// The islands the sidewalks may lie on: [block index, slab outline [[x, z], ...]]
export function slabs(GEO, inset = runtimeInset()) {
  const out = [];
  GEO.blocks.forEach(([flat, , , , , median], bid) => {
    if (median) return;
    const pts = [];
    for (let i = 0; i + 1 < flat.length; i += 2) pts.push({ x: flat[i], z: flat[i + 1] });
    if (Math.abs(ringArea(pts.map((p) => [p.x, p.z]))) <= 400) return; // (city-grid.js: all walkway)
    const inner = inset(pts, INSET);
    if (inner) out.push([bid, inner.map((p) => [p.x, p.z])]);
  });
  return out;
}

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 30, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(' ')}... exited ${r.status}: ${(r.stderr || '').slice(0, 2000)}`);
  return r.stdout;
};
const features = (text) => text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l.replace(/^\x1e/, '')));
const polygonsOf = (g) => !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates
  : g.type === 'GeometryCollection' ? g.geometries.flatMap(polygonsOf) : [];

export function buildSidewalks(gpkg, CITY) {
  const GEO = CITY.GEO, D = GEO.frame.detail, P = projector(GEO.frame.projection);
  const corners = [[D.x0, D.z0], [D.x1, D.z0], [D.x1, D.z1], [D.x0, D.z1]].map(([x, z]) => P.toLonLat(x, z));
  const lons = corners.map((c) => c[0]), lats = corners.map((c) => c[1]);
  const spat = [Math.min(...lons) - 0.001, Math.min(...lats) - 0.001, Math.max(...lons) + 0.001, Math.max(...lats) + 0.001].map(String);
  const inFrame = ([x, z]) => x > D.x0 && x < D.x1 && z > D.z0 && z < D.z1;

  // 1. The City's polygons near the detailed city, in the world frame (planar metres), one feature per polygon
  const src = features(run('ogr2ogr', ['-f', 'GeoJSONSeq', '/vsistdout/', gpkg, LAYER, '-spat', ...spat]));
  const sw = [], maint = {}, elevation = {};
  for (const f of src) {
    const p = f.properties;
    for (const poly of polygonsOf(f.geometry)) {
      const rings = poly.map((r) => r.map(([lon, lat]) => P.toWorld(lon, lat)));
      if (!rings[0].some(inFrame)) continue;
      sw.push({ type: 'Feature', properties: { oid: p.OBJECTID }, geometry: { type: 'Polygon', coordinates: rings } });
      const y = String(p.LAST_GEOMETRY_MAINT || '').slice(0, 4) || 'unknown';
      maint[y] = (maint[y] || 0) + 1;
      elevation[p.ELEVATION] = (elevation[p.ELEVATION] || 0) + 1;
    }
  }
  // 2. The islands' slabs
  const slab = slabs(GEO);
  const isl = slab.map(([bid, ring]) => ({ type: 'Feature', properties: { bid }, geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] } }));
  // 3. GEOS: simplify, repair, clip to each slab (rtree prefilter) and merge each island's pieces
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slop-sidewalks-'));
  try {
    const fc = (list) => JSON.stringify({ type: 'FeatureCollection', features: list });
    fs.writeFileSync(path.join(tmp, 'sw.geojson'), fc(sw));
    fs.writeFileSync(path.join(tmp, 'isl.geojson'), fc(isl));
    const db = path.join(tmp, 'join.gpkg');
    // (no CRS: the coordinates are the world frame's planar metres, which is all GEOS needs, and a known CRS would make
    // the GeoJSON output reproject to WGS84)
    run('ogr2ogr', ['-f', 'GPKG', db, path.join(tmp, 'sw.geojson'), '-nln', 'sw', '-a_srs', 'NONE']);
    run('ogr2ogr', ['-update', db, path.join(tmp, 'isl.geojson'), '-nln', 'isl', '-a_srs', 'NONE']);
    const sql = `SELECT bid, ST_Union(g) AS geom FROM (
      SELECT i.bid AS bid, ST_Intersection(ST_MakeValid(ST_SimplifyPreserveTopology(s.geom, ${TOLERANCE})), i.geom) AS g
      FROM sw s JOIN isl i ON i.fid IN (SELECT id FROM rtree_isl_geom r WHERE r.minx <= ST_MaxX(s.geom) AND r.maxx >= ST_MinX(s.geom)
        AND r.miny <= ST_MaxY(s.geom) AND r.maxy >= ST_MinY(s.geom))
      WHERE ST_Intersects(s.geom, i.geom)) GROUP BY bid ORDER BY bid`;
    const rows = features(run('ogr2ogr', ['-f', 'GeoJSONSeq', '/vsistdout/', db, '-dialect', 'SQLite', '-sql', sql]));
    // 4. Pieces per island, in decimetres. A piece (nearly) all within the footprint of a raised deck (GEO.decks) is
    // a bridge's or a flyover's own sidewalk, which the City maps in plan: on the ground under the deck it'd be wrong.
    const decks = [];
    for (const [, w, , pts] of GEO.decks || []) {
      for (let i = 3; i + 2 < pts.length; i += 3) if (Math.min(pts[i - 1], pts[i + 2]) >= DECK_CLEAR) decks.push([w / 2, pts[i - 3], pts[i - 2], pts[i], pts[i + 1]]);
    }
    const underDeck = ([x, z]) => decks.some(([hw, ax, az, bx, bz]) => {
      if (x < Math.min(ax, bx) - hw || x > Math.max(ax, bx) + hw || z < Math.min(az, bz) - hw || z > Math.max(az, bz) + hw) return false;
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      return Math.hypot(ax + dx * t - x, az + dz * t - z) < hw;
    });
    const polys = [];
    let verts = 0, area = 0, holes = 0, dropped = 0, underDecks = 0;
    const withSidewalk = new Set();
    for (const row of rows) {
      const bid = row.properties.bid;
      for (const poly of polygonsOf(row.geometry)) {
        const [outer, ...inner] = poly.map((r) => r.slice(0, -1)); // (GeoJSON rings repeat their first point)
        const a = Math.abs(ringArea(outer));
        if (outer.length < 3 || a < MIN_PIECE) { dropped++; continue; }
        if (outer.filter(underDeck).length >= 0.8 * outer.length) { underDecks++; continue; }
        const enc = [CITY.encodeSidewalkRing(outer)];
        for (const h of inner) if (h.length >= 3 && Math.abs(ringArea(h)) >= MIN_HOLE) { enc.push(CITY.encodeSidewalkRing(h)); holes++; }
        if (enc[0].length < 6) { dropped++; continue; }
        polys.push([bid, ...enc]);
        withSidewalk.add(bid);
        verts += enc.reduce((n, r) => n + r.length / 2, 0);
        area += a - inner.reduce((n, h) => n + (h.length >= 3 && Math.abs(ringArea(h)) >= MIN_HOLE ? Math.abs(ringArea(h)) : 0), 0);
      }
    }
    const stats = {
      sourcePolygons: sw.length, eligibleIslands: slab.length, islandsWithSidewalks: withSidewalk.size,
      fallbackIslands: slab.length - withSidewalk.size, pieces: polys.length, holes, vertices: verts,
      areaM2: Math.round(area), slivers: dropped, underDecks
    };
    return { polys, stats, maint, elevation };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const gpkg = process.argv[2] || path.join(RAW, 'sidewalks-4326.gpkg');
  const OUT = process.argv[3] || path.join(ROOT, 'js/toronto-sidewalks.js');
  const srcMeta = JSON.parse(fs.readFileSync(path.join(path.dirname(gpkg), 'source.json'), 'utf8'));
  const CITY = loadCity();
  const t0 = Date.now();
  const { polys, stats, maint, elevation } = buildSidewalks(gpkg, CITY);
  const data = {
    version: 1,
    source: {
      dataset: srcMeta.title,
      publisher: 'City of Toronto',
      page: srcMeta.page,
      resource: srcMeta.resource,
      resourceId: srcMeta.resourceId,
      licence: 'Open Government Licence – Toronto (stated on the dataset page; the CKAN record\'s licence field is empty)',
      lastRefreshed: srcMeta.lastRefreshed,
      fetchedAt: srcMeta.fetchedAt,
      sha256: createHash('sha256').update(fs.readFileSync(gpkg)).digest('hex').slice(0, 16),
      geometryMaintained: maint, // polygons in the detailed city by the year their geometry was last maintained
      elevation, // the ELEVATION field's values: 0, not a surveyed height (ignored)
      accuracy: 'digitized from aerial photography, +/- 30 cm; features near tall buildings or in deep shadow may be missing'
    },
    blocks: CITY.sidewalkBlocksKey(CITY.GEO.blocks), // the islands these were clipped to (js/sidewalk-polygons.js)
    inset: INSET,
    tolerance: TOLERANCE,
    stats,
    // [island index, outer ring, holes...], rings as [x0, z0, dx, dz, ...] in decimetres (js/sidewalk-polygons.js)
    polys
  };
  fs.writeFileSync(OUT, `// js/toronto-sidewalks.js — GENERATED by tools/build-sidewalks.mjs, do not edit by hand.
// The City of Toronto's physical sidewalks (Topographic Mapping – Physical area of sidewalks, City of Toronto Open Data,
// Open Government Licence – Toronto), clipped to the curb islands of js/toronto-geodata.js. See docs/sidewalk-polygons.md.
(function () {
window.CITY = window.CITY || {};
window.CITY.SIDEWALKS = ${JSON.stringify(data)};
})();
`);
  console.log(`[sidewalks] ${JSON.stringify(stats)} in ${Date.now() - t0} ms`);
  console.log(`[sidewalks] geometry maintained ${JSON.stringify(maint)}; ELEVATION ${JSON.stringify(elevation)}`);
  console.log(`[sidewalks] wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
}
