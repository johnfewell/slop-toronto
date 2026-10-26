// tools/build-geodata.mjs — writes js/toronto-geodata.js (see geo-base.mjs for the frame and the data sources)
// usage: node --max-old-space-size=8192 tools/build-geodata.mjs [out.js]
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { geo, toWorld, toLonLat, log, load, osmRoads, pointInRing, bbox, centroid } from './geo-base.mjs';
import { DETAIL, buildRoadGraph, deckOut, roadLines, roadCutOut } from './geo-roads.mjs';
import { areas, streams, walls, isWater, waterRings, islandRings, lake } from './geo-land.mjs';
import { Raster } from './geo-base.mjs';
import { blocks, SIDEWALK, blockRaster, blockLabels } from './geo-blocks.mjs';
import { buildings, districts, districtBounds, landmarks } from './geo-features.mjs';
import { buildTerrain } from './geo-terrain.mjs';
import { props } from './geo-props.mjs';
import { streetTrees, TREE_MODELS } from './geo-trees.mjs';
import { parkSigns } from './geo-parksigns.mjs';
import { rails, tramStops, railLifts, railFills } from './geo-rails.mjs';
import { cycling } from './geo-cycling.mjs';

const inRing = (x, z, r) => {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const waterAt = isWater;
const OUT = process.argv[2] || fileURLToPath(new URL('../js/toronto-geodata.js', import.meta.url));
const q = (v) => Math.round(v * 10) / 10;
const flat = (pts) => pts.flatMap(([x, z]) => [q(x), q(z)]);

// a turnaround at the edge of the city may cross roadway & medians, never a plot
const medianLabels = new Set(blocks.filter((b) => b.median).map((b) => b._lab));
const roadGraph = buildRoadGraph((x, z) => {
  const R = blockRaster;
  const i = Math.floor((x - R.x0) / R.res), j = Math.floor((z - R.z0) / R.res);
  if (i < 0 || j < 0 || i >= R.w || j >= R.h) return false;
  const L = blockLabels[j * R.w + i];
  return L === 0 ? R.d[j * R.w + i] === 0 && !waterAt(x, z) : medianLabels.has(L);
});
const terrain = buildTerrain();
// Traffic signals as mapped (OpenStreetMap highway=traffic_signals: at junctions, or on a signalised pedestrian crossing)
const signals = load('osm_signals.json').elements.map((e) => {
  const [x, z] = toWorld(e.lon, e.lat);
  return [q(x), q(z), e.tags.crossing === 'traffic_signals' && e.tags.highway !== 'traffic_signals' ? 1 : 0];
}).filter(([x, z]) => x > DETAIL.x0 && x < DETAIL.x1 && z > DETAIL.z0 && z < DETAIL.z1);
log(`${signals.length} traffic signals mapped (${signals.filter((s) => s[2]).length} on pedestrian crossings)`);
// Named places (OpenStreetMap POIs & named buildings): [x, z, name, category, index of the building it's in (-1: none)]
const CATS = [
  ['hotel', (t) => /^(hotel|motel|guest_house|hostel|apartment)$/.test(t.tourism || '')],
  ['bank', (t) => /^(bank|atm|bureau_de_change)$/.test(t.amenity || '')],
  ['food', (t) => /^(restaurant|fast_food|cafe|bar|pub|ice_cream|food_court|nightclub)$/.test(t.amenity || '')],
  ['worship', (t) => t.amenity === 'place_of_worship' || /^(mosque|church|cathedral)$/.test(t.building || '')],
  ['fuel', (t) => t.amenity === 'fuel'],
  ['health', (t) => /^(hospital|clinic|pharmacy|doctors|dentist)$/.test(t.amenity || '') || !!t.healthcare],
  ['education', (t) => /^(school|university|college|kindergarten|library)$/.test(t.amenity || '')],
  ['market', (t) => t.amenity === 'marketplace' || /^(mall|supermarket|department_store)$/.test(t.shop || '')],
  ['shop', (t) => !!t.shop],
  ['government', (t) => !!t.government || !!t.diplomatic || /^(townhall|courthouse|police|embassy|public_building)$/.test(t.amenity || '') || t.office === 'government'],
  ['office', (t) => !!t.office],
  ['leisure', (t) => !!t.leisure || /^(attraction|museum|gallery|viewpoint|zoo|theme_park)$/.test(t.tourism || '') || !!t.historic || /^(cinema|theatre|arts_centre)$/.test(t.amenity || '')],
  ['transport', (t) => /^(bus_station|taxi|ferry_terminal)$/.test(t.amenity || '')]
];
const bGrid = new Map();
buildings.forEach((b, i) => {
  const k = `${Math.floor(b[0] / 50)},${Math.floor(b[1] / 50)}`;
  (bGrid.get(k) || bGrid.set(k, []).get(k)).push(i);
});
const buildingAt = (x, z) => {
  let best = -1, bd = 1e9;
  for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) {
    for (const i of bGrid.get(`${Math.floor(x / 50) + a},${Math.floor(z / 50) + c}`) || []) {
      const [cx, cz, ang, parts] = buildings[i];
      const cs = Math.cos(ang), sn = Math.sin(ang), dx = x - cx, dz = z - cz;
      const u = dx * cs - dz * sn, v = dx * sn + dz * cs;
      for (const [u0, u1, v0, v1] of parts) {
        const d = Math.hypot(Math.max(u0 - u, 0, u - u1), Math.max(v0 - v, 0, v - v1));
        if (d < bd) { bd = d; best = i; }
      }
    }
  }
  return bd < 3 ? best : -1;
};
const pois = [];
for (const e of load('osm_pois.json').elements) {
  const t = e.tags || {};
  const lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat;
  if (lon === undefined || !t.name) continue;
  const [x, z] = toWorld(lon, lat);
  if (!(x > DETAIL.x0 && x < DETAIL.x1 && z > DETAIL.z0 && z < DETAIL.z1)) continue;
  const name = t.name.trim();
  if (pois.some((p) => p[2] === name && Math.hypot(p[0] - x, p[1] - z) < 60)) continue;
  const cat = (CATS.find(([, f]) => f(t)) || ['place'])[0];
  pois.push([q(x), q(z), name, cat, buildingAt(x, z)]);
}
log(`${pois.length} named places (${pois.filter((p) => p[4] >= 0).length} in a mapped building)`);
// The City of Toronto's boundary (OpenStreetMap), as [lat, lon, ...]: is a GPS fix in Toronto?
const fct = (() => {
  const e = load('osm_fct.json').elements[0];
  const parts = e.members.filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry.map((g) => [g.lat, g.lon]));
  const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
  let ring = parts.shift();
  while (parts.length) {
    const i = parts.findIndex((p) => same(p[0], ring[ring.length - 1]) || same(p[p.length - 1], ring[ring.length - 1]));
    if (i < 0) break; // disjoint outer rings (a lake shore, the Islands): keep the first
    const p = parts.splice(i, 1)[0];
    ring = ring.concat(same(p[0], ring[ring.length - 1]) ? p.slice(1) : p.reverse().slice(1));
  }
  return ring.slice(0, -1).flatMap(([lat, lon]) => [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5]);
})();
log(`City of Toronto boundary: ${fct.length / 2} points`);
// Water mask over the detailed city (4 m cells): the street level drops its asphalt where it is set (city-grid.js),
// so Lake Ontario & the other water show through. Row runs, alternating dry / wet starting dry, as base64 Uint16.
const waterMask = (() => {
  const M = new Raster(DETAIL.x0, DETAIL.z0, DETAIL.x1, DETAIL.z1, 4);
  if (lake) M.fillRing(lake.ring, 1);
  for (const r of islandRings) M.fillRing(r, 0);
  for (const r of waterRings) if (!lake || r !== lake.ring) M.fillRing(r, 1);
  const runs = [];
  for (let j = 0; j < M.h; j++) {
    let v = 0, n = 0;
    for (let i = 0; i < M.w; i++) {
      const c = M.d[j * M.w + i];
      if (c === v) { n++; continue; }
      runs.push(n); v = c; n = 1;
    }
    runs.push(n);
    if (v === 1) runs.push(0); // every row ends dry, so the next row starts dry
  }
  const buf = Buffer.from(new Uint16Array(runs).buffer);
  log(`water mask ${M.w} x ${M.h} at 4 m: ${runs.length} runs, ${(buf.length / 1024).toFixed(0)} KB`);
  return { x0: M.x0, z0: M.z0, res: 4, w: M.w, h: M.h, runs: buf.toString('base64') };
})();
const [olon, olat] = toLonLat(0, 0);
const cnTower = toWorld(-79.387057, 43.642566);

// the City's park name signs at the parks' entrances, clear of the street props & the City's trees (tools/geo-parksigns.mjs)
props.parkSign = parkSigns(props, streetTrees);

// The paths through the small parks (the parkettes on islands that are mostly not park: city-grid.js lays their lawns
// and these paths on the islands' yards). OpenStreetMap's footways, paths & pedestrian ways (not the sidewalks or the
// crossings), cut to each park's outline: [width, x, z, ...] per run inside a park
const parkPaths = (() => {
  const byLab = new Map(blocks.map((b) => [b._lab, b]));
  const R = blockRaster;
  const blockOf = (x, z) => {
    const i = Math.floor((x - R.x0) / R.res), j = Math.floor((z - R.z0) / R.res);
    return i < 0 || j < 0 || i >= R.w || j >= R.h ? null : byLab.get(blockLabels[j * R.w + i]) || null;
  };
  const small = areas.filter((a) => a.kind === 'park' && a.area < 60000 && [centroid(a.ring), ...a.ring].some(([x, z]) => {
    const b = blockOf(x, z);
    return b && !b.median && (b.park || 0) <= 0.6;
  })).map((a) => ({ ring: a.ring, b: bbox(a.ring) }));
  const out = [];
  for (const e of osmRoads.elements) {
    const t = e.tags || {};
    if (!/^(footway|path|pedestrian)$/.test(t.highway || '') || t.area === 'yes' || !e.geometry || e.geometry.length < 2) continue;
    if (/^(sidewalk|crossing|traffic_island)$/.test(t.footway || '') || t.tunnel === 'yes' || t.bridge === 'yes' || t.layer && t.layer !== '0') continue;
    const w = Math.min(5, parseFloat(t.width) || (t.highway === 'pedestrian' ? 4 : t.highway === 'path' ? 1.6 : 2));
    const pts = e.geometry.map((g) => toWorld(g.lon, g.lat));
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (const { ring, b } of small) {
      if (x1 < b.x0 || x0 > b.x1 || z1 < b.z0 || z0 > b.z1) continue;
      let run = [];
      const flush = () => { if (run.length >= 2) out.push([w, ...run.flatMap(([x, z]) => [q(x), q(z)])]); run = []; };
      for (let s = 0; s + 1 < pts.length; s++) {
        const a = pts[s], c = pts[s + 1];
        // the segment's crossings of the outline, in order along it; a piece is in the park if its midpoint is
        const ts = [0, 1];
        for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) {
          const p = ring[j], r = ring[k];
          const rx = c[0] - a[0], rz = c[1] - a[1], sx = r[0] - p[0], sz = r[1] - p[1];
          const den = rx * sz - rz * sx;
          if (Math.abs(den) < 1e-9) continue;
          const u = ((p[0] - a[0]) * sz - (p[1] - a[1]) * sx) / den, v = ((p[0] - a[0]) * rz - (p[1] - a[1]) * rx) / den;
          if (u > 0 && u < 1 && v >= 0 && v <= 1) ts.push(u);
        }
        ts.sort((m, n) => m - n);
        const at = (u) => [a[0] + (c[0] - a[0]) * u, a[1] + (c[1] - a[1]) * u];
        for (let k = 0; k + 1 < ts.length; k++) {
          if (ts[k + 1] - ts[k] < 1e-6) continue;
          const [mx, mz] = at((ts[k] + ts[k + 1]) / 2);
          if (!pointInRing(mx, mz, ring)) { flush(); continue; }
          const p0 = at(ts[k]), p1 = at(ts[k + 1]);
          const last = run[run.length - 1];
          if (!last || Math.hypot(last[0] - p0[0], last[1] - p0[1]) > 0.05) { flush(); run.push(p0); }
          run.push(p1);
        }
      }
      flush();
    }
  }
  log(`park paths: ${out.length} runs through ${small.length} small parks`);
  return out;
})();

const GEO = {
  version: 1,
  city: 'Toronto',
  frame: {
    bearingDeg: Math.round((geo.THETA * 180) / Math.PI * 100) / 100, // grid north's bearing (the avenues run 90° from it)
    origin: 'Union Station (Front Street)',
    lat: Math.round(olat * 1e6) / 1e6,
    lon: Math.round(olon * 1e6) / 1e6,
    elevation: terrain.baseAtOrigin, // street level at the origin, metres above sea level
    units: 'm',
    detail: DETAIL,
    sidewalk: SIDEWALK,
    // The exact projection (WGS84 lat / lon -> world x, z): x = u - ox, z = v - oz, with e = (lon - lon0) kx,
    // n = (lat - lat0) ky (metres east / north on the tangent plane) and u = e cos t - n sin t, v = -(e sin t + n cos t)
    projection: { lat0: geo.LAT0, lon0: geo.LON0, kx: geo.KX, ky: geo.KY, theta: geo.THETA, ox: geo.ORIGIN[0], oz: geo.ORIGIN[1] }
  },
  // [name, width, dir (1: along the points, -1: against, 0: both), lanes, rank, raised, flat x, z..., OSM class]
  roads: roadLines,
  // Street graph (at grade & on the flyovers): nodes [x, z, ...], raised [node, height, ...], links [a, b, name index,
  // width, lanes, dir, inner shape [x, z...], rank, inner heights [h...] (0 when the link lies on the ground)]
  roadGraph,
  // Traffic signals as mapped: [x, z, 1 on a pedestrian crossing / 0 at a junction]
  signals,
  // Named places: [x, z, name, category, building index (-1: not in a mapped building)]
  pois,
  // The City of Toronto's boundary: [lat, lon, ...]
  fct,
  // Flyover decks & their ramps: [name, width, rank, [x, z, height, ...]]
  decks: deckOut,
  // Road cuts, streets dipping under the railway (tools/geo-roads.mjs): [name, half width (carriageways & sidewalks),
  // [x, z, height, ...] the street's axis at each break of slope (heights below street level)]
  roadCuts: roadCutOut,
  // Curb islands: [outline, lot rects [x0, x1, z0, z1], park share, park name, rectangular, median, wild share]
  blocks: blocks.map((b) => [flat(b.poly), b.rects.map((r) => r.map(q)), b.park || 0, b.parkName || '', b.rect ? 1 : 0, b.median ? 1 : 0, b.wild || 0]),
  // Land cover: [kind, name, outline, holes (Lake Ontario's islands) [outline, ...]]
  // The paths through the small parks: [width, x, z, ...] (see parkPaths above)
  parkPaths,
  areas: areas.filter((a) => !a.kind.startsWith('zone') || a.area > 20000).map((a) => (a.holes ? [a.kind, a.name, flat(a.ring), a.holes.map(flat)] : [a.kind, a.name, flat(a.ring)])),
  // Streams & rivers: [name, channel width, kind, centre line]; compound walls mapped: [height, line]
  streams: streams.map((s) => [s.name, s.w, s.kind, flat(s.pts)]),
  walls: walls.map((w) => [w.h, flat(w.pts)]),
  // Buildings: [cx, cz, yaw, plan rects in the building's frame [[u0, u1, v0, v1], ...], height, kind, roof, colour seed,
  // height estimated (1) or mapped (0), name]
  buildings,
  districts,
  // District boundaries as mapped: [name, outline]
  districtBounds: districtBounds.map((d) => [d.name, flat(d.ring)]),
  landmarks,
  // The City's street trees: [x, z, model index, height dm, ...] and the EZ-Tree models they index (tools/geo-trees.mjs)
  streetTrees,
  treeModels: TREE_MODELS.map(([id, h]) => [id, h]),
  // Street props where they stand: { hydrant, bikeRing, postBox: [x, z, ...] } (tools/geo-props.mjs)
  props,
  // Railways (tools/geo-rails.mjs): streetcar & heavy-rail tracks [kind 0 tram / 1 rail, service, name, flags
  // (1 bridge, 2 tunnel), [x, z, ...]] and the streetcar stops [x, z, name, ...]
  rails,
  tramStops,
  // Grade separation (tools/geo-rails.mjs): the streets the tracks bridge [deck height, half width, x0, z0, x1, z1, the
  // street's height under it] and
  // the embankments between them [deck height, four corners x, z]
  railLifts,
  railFills,
  // Toronto's cycling network (tools/geo-cycling.mjs; City of Toronto, sides from OpenStreetMap): { kinds, bands:
  // [kind, flags (1 curb on the riders' left, 2 through a junction, 4 contra-flow), curb line x, z...], trails: [width,
  // surface, level (1 on a curb island), x, z...], map: [kind, x, z...] }
  cycling,
  // Water under the street level (see waterMask above)
  waterMask,
  // Relief above the local plain (decimetres, Int16 little-endian, base64), rows of z from z0, columns of x from x0
  terrain,
  points: {
    cnTower: [q(cnTower[0]), q(cnTower[1]), 553.3] // the tower's centre and its height (m)
  }
};

const json = JSON.stringify(GEO);
const header = `// js/toronto-geodata.js — GENERATED by tools/build-geodata.mjs, do not edit by hand.
// Real Toronto geography in the simulation's world frame: 1 unit = 1 m, x = grid east (along Queen & King Streets),
// z = grid south (toward the lake), origin at Union Station, axes turned ${GEO.frame.bearingDeg}° from true north (downtown's
// street grid). Polygons & polylines are flat [x0, z0, x1, z1, ...] arrays.
// Sources: City of Toronto Open Data, 3D Massing (Open Government Licence – Toronto): buildings and their heights;
// Cycling Network (Open Government Licence – Toronto): the bikeways;
// © OpenStreetMap contributors (ODbL): streets, land, water, places; terrain from AWS Terrain Tiles (SRTM-derived).
`;
fs.writeFileSync(OUT, `${header}(function () {\nwindow.CITY = window.CITY || {};\nwindow.CITY.GEO = ${json};\n})();\n`);
log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
for (const [k, v] of Object.entries(GEO)) log(`  ${k}: ${(JSON.stringify(v).length / 1024).toFixed(0)} KB`);
