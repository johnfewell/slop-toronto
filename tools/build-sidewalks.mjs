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
import { unpackGeo } from '../js/geodata-loader.js';

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
export async function loadCityAny(geodataPath = path.join(ROOT, 'js/toronto-geodata.js')) {
  if (!geodataPath.endsWith('.bin')) return loadCity(geodataPath);
  const { GEO } = await unpackGeo(fs.readFileSync(geodataPath));
  const ctx = { window: { CITY: { GEO } }, console };
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

const ARTERIAL_ROAD = /^(primary|secondary|tertiary)$/;
const LOCAL_ROAD = /^(residential|unclassified)$/;
const RIM_CLEAR = 3.5; // m from the frame boundary: cut edge, not a street curb

function gridAdd(grid, x0, z0, x1, z1, cell, item) {
  const ix0 = Math.floor(x0 / cell), ix1 = Math.floor(x1 / cell);
  const iz0 = Math.floor(z0 / cell), iz1 = Math.floor(z1 / cell);
  for (let ix = ix0; ix <= ix1; ix++) {
    for (let iz = iz0; iz <= iz1; iz++) {
      const k = ix * 100000 + iz;
      let arr = grid.get(k);
      if (!arr) grid.set(k, (arr = []));
      arr.push(item);
    }
  }
}

export function osmSidewalkPolicy(tags, sideDot) {
  if (!tags) return null;
  const side = sideDot > 0 ? 'right' : 'left';
  const specific = tags[`sidewalk:${side}`] || tags['sidewalk:both'] || '';
  if (specific === 'no' || specific === 'none') return 'no';
  if (specific === 'yes') return 'yes';
  if (specific === 'separate') return 'separate';
  const sw = tags.sidewalk || '';
  if (sw === 'no' || sw === 'none') return 'no';
  if (sw === 'both' || sw === 'yes') return 'yes';
  if (sw === side) return 'yes';
  if ((sw === 'left' && side === 'right') || (sw === 'right' && side === 'left')) return 'no';
  if (sw === 'separate') return 'separate';
  return null;
}

// Build plausible sidewalk candidates (OSM mapped footway=sidewalk buffers + road-edge strips) for curb islands
// that have no City sidewalk polygon (st-bz1o.9). All candidates are clipped to the island's slab in GEOS.
export function buildFallbackCandidates(GEO, fallbackSlabs, osmElements, P) {
  const D = GEO.frame.detail;
  const RCELL = 64;
  // 1. Spatial index of at-grade roads from GEO.roads
  const roadGrid = new Map();
  for (const r of GEO.roads || []) {
    const [name, w, , , , raised, flat, cls] = r;
    if (raised || !flat || flat.length < 4) continue;
    for (let i = 0; i + 3 < flat.length; i += 2) {
      const ax = flat[i], az = flat[i + 1], bx = flat[i + 2], bz = flat[i + 3];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.2) continue;
      const seg = { ax, az, bx, bz, ux: (bx - ax) / len, uz: (bz - az) / len, len, cls: cls || '', name: name || '', w: w || 7 };
      gridAdd(roadGrid, Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), RCELL, seg);
    }
  }
  // 2. Spatial index of OSM footway=sidewalk polylines & road sidewalk=* tags
  const fwGrid = new Map();
  const osmTagGrid = new Map();
  for (const e of osmElements || []) {
    const t = e.tags || {};
    if (!e.geometry || e.geometry.length < 2) continue;
    if (t.tunnel === 'yes' || t.bridge === 'yes' || (t.layer && t.layer !== '0')) continue;
    if (t.highway === 'footway' && t.footway === 'sidewalk') {
      const pts = e.geometry.map((g) => P.toWorld(g.lon, g.lat));
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of pts) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      if (x1 < D.x0 || x0 > D.x1 || z1 < D.z0 || z0 > D.z1) continue;
      const rawW = parseFloat(t.width || '');
      const width = Number.isFinite(rawW) ? Math.max(1.2, Math.min(4.5, rawW)) : 1.8;
      gridAdd(fwGrid, x0 - width, z0 - width, x1 + width, z1 + width, RCELL, { pts, width, x0, x1, z0, z1 });
    } else if (t.highway && (t.sidewalk || t['sidewalk:left'] || t['sidewalk:right'] || t['sidewalk:both'])) {
      const pts = e.geometry.map((g) => P.toWorld(g.lon, g.lat));
      for (let i = 0; i + 1 < pts.length; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.2) continue;
        const seg = { ax, az, bx, bz, dx: (bx - ax) / len, dz: (bz - az) / len, len, tags: t };
        gridAdd(osmTagGrid, Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), RCELL, seg);
      }
    }
  }
  // 3. Spatial index of buildings (for residential boulevard setback clearance)
  const bldGrid = new Map();
  for (const b of GEO.buildings || []) {
    const cx = b[0], cz = b[1], parts = b[3] || [];
    let rad = 6;
    for (const [u0, u1, v0, v1] of parts) rad = Math.max(rad, Math.hypot(Math.max(Math.abs(u0), Math.abs(u1)), Math.max(Math.abs(v0), Math.abs(v1))));
    gridAdd(bldGrid, cx - rad, cz - rad, cx + rad, cz + rad, RCELL, { cx, cz, rad });
  }
  const hasBuildingNear = (x, z, clearance) => {
    const ix0 = Math.floor((x - clearance) / RCELL), ix1 = Math.floor((x + clearance) / RCELL);
    const iz0 = Math.floor((z - clearance) / RCELL), iz1 = Math.floor((z + clearance) / RCELL);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        for (const b of bldGrid.get(ix * 100000 + iz) || []) {
          if (Math.hypot(b.cx - x, b.cz - z) < b.rad + clearance) return true;
        }
      }
    }
    return false;
  };
  const nearestInGrid = (grid, x, z, maxD, ux, uz, outX, outZ) => {
    let best = null, bd = maxD;
    const ix0 = Math.floor((x - maxD) / RCELL), ix1 = Math.floor((x + maxD) / RCELL);
    const iz0 = Math.floor((z - maxD) / RCELL), iz1 = Math.floor((z + maxD) / RCELL);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        for (const s of grid.get(ix * 100000 + iz) || []) {
          const sx = s.ux ?? s.dx, sz = s.uz ?? s.dz;
          if (Math.abs(ux * sx + uz * sz) < 0.35) continue;
          const t = Math.max(0, Math.min(1, ((x - s.ax) * sx + (z - s.az) * sz) / s.len));
          const px = s.ax + sx * t * s.len, pz = s.az + sz * t * s.len;
          const d = Math.hypot(px - x, pz - z);
          if (d >= bd) continue;
          // road must lie on the outward side of the curb (not across the interior of the island)
          const toRoad = (px - (x - outX * 4)) * outX + (pz - (z - outZ * 4)) * outZ;
          if (toRoad < -1.5) continue;
          bd = d;
          best = { seg: s, d, px, pz };
        }
      }
    }
    return best;
  };

  const lineCandidates = []; // { bid, hw, pts } (OSM footway=sidewalk)
  const polyCandidates = []; // { bid, ring } (road-edge strips)
  const livingOnlyBids = new Set();

  for (const [bid, ring] of fallbackSlabs) {
    const blk = GEO.blocks[bid];
    const park = blk[2] || 0, wild = blk[6] || 0;
    const isGreen = park > 0.6 || wild > 0.5;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of ring) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    // Collect overlapping OSM footway=sidewalk lines for this fallback island
    const seenFw = new Set();
    const islandFws = [];
    const ix0 = Math.floor((x0 - 4) / RCELL), ix1 = Math.floor((x1 + 4) / RCELL);
    const iz0 = Math.floor((z0 - 4) / RCELL), iz1 = Math.floor((z1 + 4) / RCELL);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        for (const fw of fwGrid.get(ix * 100000 + iz) || []) {
          if (seenFw.has(fw)) continue;
          seenFw.add(fw);
          if (fw.x1 < x0 - 3 || fw.x0 > x1 + 3 || fw.z1 < z0 - 3 || fw.z0 > z1 + 3) continue;
          islandFws.push(fw);
          lineCandidates.push({ bid, hw: fw.width / 2, pts: fw.pts });
        }
      }
    }
    const nearIslandFw = (x, z, r = 7) => islandFws.some((fw) => {
      if (x < fw.x0 - r || x > fw.x1 + r || z < fw.z0 - r || z > fw.z1 + r) return false;
      for (let i = 0; i + 1 < fw.pts.length; i++) {
        const [ax, az] = fw.pts[i], [bx, bz] = fw.pts[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        if (Math.hypot(ax + dx * t - x, az + dz * t - z) < r) return true;
      }
      return false;
    });

    // Walk slab outline edges to synthesize plausible road-edge sidewalk strips
    const sign = ringArea(ring) > 0 ? 1 : -1;
    let sawLiving = false, sawWalkableStreet = false;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      if (L < 1.0) continue;
      const ux = dx / L, uz = dz / L;
      const inX = sign * (-uz), inZ = sign * ux;
      const outX = -inX, outZ = -inZ;
      const steps = Math.max(1, Math.ceil(L / 10));
      for (let s = 0; s < steps; s++) {
        const t0 = s / steps, t1 = (s + 1) / steps;
        const p0x = a[0] + dx * t0, p0z = a[1] + dz * t0;
        const p1x = a[0] + dx * t1, p1z = a[1] + dz * t1;
        const mx = (p0x + p1x) / 2, mz = (p0z + p1z) / 2;
        if (mx <= D.x0 + RIM_CLEAR || mx >= D.x1 - RIM_CLEAR || mz <= D.z0 + RIM_CLEAR || mz >= D.z1 - RIM_CLEAR) continue;
        const probeX = mx + outX * 4, probeZ = mz + outZ * 4;
        const hit = nearestInGrid(roadGrid, probeX, probeZ, 16, ux, uz, outX, outZ);
        if (!hit) continue;
        const cls = hit.seg.cls;
        if (cls === 'living_street') { sawLiving = true; continue; }
        const isArt = ARTERIAL_ROAD.test(cls), isLoc = LOCAL_ROAD.test(cls);
        if (!isArt && !isLoc) continue;
        sawWalkableStreet = true;

        // Check OSM road sidewalk=* tag on this side
        let policy = null;
        const tagHit = nearestInGrid(osmTagGrid, probeX, probeZ, 16, ux, uz, outX, outZ);
        if (tagHit) {
          const ts = tagHit.seg;
          const sideDot = (mx - ts.ax) * (-ts.dz) + (mz - ts.az) * ts.dx;
          policy = osmSidewalkPolicy(ts.tags, sideDot);
        }
        if (policy === 'no') continue;
        if (isGreen && !isArt && policy !== 'yes') continue;
        if (policy === 'separate' && nearIslandFw(mx, mz, 8)) continue;
        if (nearIslandFw(mx, mz, 4.5)) continue;

        const width = isArt ? 2.1 : 1.8;
        const setback = isArt ? 0.0 : (hasBuildingNear(mx + inX * 2.2, mz + inZ * 2.2, 2.0) ? 0.0 : 1.0);
        const s0 = setback, s1 = setback + width, ext = 0.6;
        const q0x = p0x - ux * ext, q0z = p0z - uz * ext;
        const q1x = p1x + ux * ext, q1z = p1z + uz * ext;
        polyCandidates.push({
          bid,
          ring: [
            [q0x + inX * s0, q0z + inZ * s0],
            [q1x + inX * s0, q1z + inZ * s0],
            [q1x + inX * s1, q1z + inZ * s1],
            [q0x + inX * s1, q0z + inZ * s1],
            [q0x + inX * s0, q0z + inZ * s0]
          ]
        });
      }
    }
    if (sawLiving && !sawWalkableStreet) livingOnlyBids.add(bid);
  }
  return { lineCandidates, polyCandidates, livingOnlyBids };
}

export function buildSidewalks(gpkg, CITY, opts = {}) {
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
    const withCity = new Set();
    const withSidewalk = new Set();
    const pushRows = (rowList, targetSet) => {
      let addedPieces = 0;
      for (const row of rowList) {
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
          if (targetSet) targetSet.add(bid);
          addedPieces++;
          verts += enc.reduce((n, r) => n + r.length / 2, 0);
          area += a - inner.reduce((n, h) => n + (h.length >= 3 && Math.abs(ringArea(h)) >= MIN_HOLE ? Math.abs(ringArea(h)) : 0), 0);
        }
      }
      return addedPieces;
    };
    pushRows(rows, withCity);

    // 5. Fallback islands with no City sidewalk polygon (st-bz1o.9): synthesize plausible sidewalks from OSM
    // footway=sidewalk ways and bordering walkable road edges, clipped to the island's slab; islands verified to have
    // no walkable street (parks, cemeteries, highway loops, service yards) go in noWalk so they skip the 4.6 m band.
    const withSynth = new Set();
    let synthPieces = 0;
    let noWalk = [];
    const fallbackSlabs = slab.filter(([bid]) => !withCity.has(bid));
    if (opts.synthesize && fallbackSlabs.length) {
      const { lineCandidates, polyCandidates, livingOnlyBids } = buildFallbackCandidates(GEO, fallbackSlabs, opts.osmRoads || [], P);
      const synthGeo = [];
      for (const c of polyCandidates) synthGeo.push({ type: 'Feature', properties: { bid: c.bid, hw: 0 }, geometry: { type: 'Polygon', coordinates: [c.ring] } });
      for (const c of lineCandidates) synthGeo.push({ type: 'Feature', properties: { bid: c.bid, hw: c.hw }, geometry: { type: 'LineString', coordinates: c.pts } });
      if (synthGeo.length) {
        fs.writeFileSync(path.join(tmp, 'fb.geojson'), fc(synthGeo));
        run('ogr2ogr', ['-update', db, path.join(tmp, 'fb.geojson'), '-nln', 'fb', '-a_srs', 'NONE']);
        const fbSql = `SELECT bid, ST_SimplifyPreserveTopology(ST_Union(g), ${TOLERANCE}) AS geom FROM (
          SELECT i.bid AS bid, ST_Intersection(
            CASE WHEN f.hw > 0 THEN ST_Buffer(f.geom, f.hw, 4) ELSE ST_MakeValid(f.geom) END,
            i.geom
          ) AS g
          FROM fb f JOIN isl i ON i.bid = f.bid
          WHERE ST_Intersects(CASE WHEN f.hw > 0 THEN ST_Buffer(f.geom, f.hw, 4) ELSE f.geom END, i.geom)
        ) GROUP BY bid ORDER BY bid`;
        const fbRows = features(run('ogr2ogr', ['-f', 'GeoJSONSeq', '/vsistdout/', db, '-dialect', 'SQLite', '-sql', fbSql]));
        synthPieces = pushRows(fbRows, withSynth);
        polys.sort((a, b) => a[0] - b[0]);
      }
      noWalk = fallbackSlabs.map(([bid]) => bid).filter((bid) => !withSidewalk.has(bid) && !livingOnlyBids.has(bid)).sort((a, b) => a - b);
    }

    const stats = {
      sourcePolygons: sw.length, eligibleIslands: slab.length, islandsWithSidewalks: withSidewalk.size,
      islandsWithCitySidewalks: withCity.size, islandsWithSynthesizedSidewalks: withSynth.size,
      synthesizedPieces: synthPieces, islandsNoSidewalk: noWalk.length,
      fallbackIslands: slab.length - withSidewalk.size, pieces: polys.length, holes, vertices: verts,
      areaM2: Math.round(area), slivers: dropped, underDecks
    };
    return { polys, noWalk, stats, maint, elevation };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const geoIdx = process.argv.indexOf('--geo');
  const geoPath = geoIdx >= 0 && geoIdx + 1 < process.argv.length ? process.argv[geoIdx + 1] : path.join(ROOT, 'js/toronto-geodata.js');
  const outIdx = process.argv.indexOf('--out');
  const osmIdx = process.argv.indexOf('--osm');
  const osmPath = osmIdx >= 0 && osmIdx + 1 < process.argv.length ? process.argv[osmIdx + 1] : (process.env.GEO_DATA ? path.join(process.env.GEO_DATA, 'osm_roads.json') : null);
  const synthesize = process.argv.includes('--synthesize') || Boolean(osmPath && fs.existsSync(osmPath));
  const nonOptionArgs = process.argv.slice(2).filter((arg, i, arr) => !arg.startsWith('--') && (i === 0 || !arr[i - 1].startsWith('--') || arr[i - 1] === '--synthesize'));
  const gpkg = nonOptionArgs[0] || (fs.existsSync(path.join(RAW, 'sidewalks-4326.gpkg')) ? path.join(RAW, 'sidewalks-4326.gpkg') : path.join(os.homedir(), '.cache/slop-toronto/raw/sidewalks-4326.gpkg'));
  const OUT = (outIdx >= 0 && process.argv[outIdx + 1]) || nonOptionArgs[1] || path.join(ROOT, 'js/toronto-sidewalks.js');
  const metaPath = path.join(path.dirname(gpkg), 'source.json');
  const srcMeta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : { title: 'Topographic Mapping – Physical area of sidewalks', page: '', resource: '', resourceId: '', lastRefreshed: '', fetchedAt: '' };
  const CITY = await loadCityAny(geoPath);
  const osmRoads = osmPath && fs.existsSync(osmPath) ? JSON.parse(fs.readFileSync(osmPath, 'utf8')).elements : [];
  const t0 = Date.now();
  const { polys, noWalk, stats, maint, elevation } = buildSidewalks(gpkg, CITY, { synthesize, osmRoads });
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
      accuracy: 'digitized from aerial photography, +/- 30 cm; features near tall buildings or in deep shadow may be missing',
      ...(synthesize ? { fallbackSynthesis: 'OpenStreetMap footway=sidewalk ways and walkable road edges (ODbL 1.0) on islands without City polygons; parks, highway loops and service-only islands marked noWalk' } : {})
    },
    blocks: CITY.sidewalkBlocksKey(CITY.GEO.blocks), // the islands these were clipped to (js/sidewalk-polygons.js)
    inset: INSET,
    tolerance: TOLERANCE,
    stats,
    // [island index, outer ring, holes...], rings as [x0, z0, dx, dz, ...] in decimetres (js/sidewalk-polygons.js)
    polys,
    ...(noWalk.length ? { noWalk } : {})
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
