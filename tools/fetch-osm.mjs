// tools/fetch-osm.mjs — writes the osm_*.json inputs of the geodata build (GEO_DATA) from a Geofabrik .osm.pbf extract,
// in the shape Overpass returns (`out body geom`), so the build reads them exactly as it reads Overpass answers. Used
// when Overpass is down or too slow; tools/overpass.sh + tools/data/q_*.overpassql remain the other way in.
// Needs GDAL's ogr2ogr (OSM driver) and tools/osmconf.ini (every tag as JSON).
// usage: GEO_DATA=~/.cache/slop-toronto/osm node --max-old-space-size=12288 tools/fetch-osm.mjs <ontario-latest.osm.pbf>
// (ONLY=rails | lake | postboxes writes just that file)
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DATA = process.env.GEO_DATA;
const PBF = process.argv[2];
if (!DATA || !PBF) throw new Error('usage: GEO_DATA=<dir> node tools/fetch-osm.mjs <extract.osm.pbf>');
const CONF = fileURLToPath(new URL('osmconf.ini', import.meta.url));
// [west, south, east, north]: the city box (tools/data/q_*.overpassql), a wider one for place names, all of Toronto
const CITY = [-79.505, 43.585, -79.305, 43.7];
const WIDE = [-79.6, 43.55, -79.2, 43.75];
const TORONTO = [-79.64, 43.58, -79.11, 43.86];
// the lake shore out to the horizon: about 35 km each way along it
const SHORE = [-79.85, 43.25, -78.9, 43.9];

function ogr(layer, box, clip) {
  return new Promise((resolve, reject) => {
    const args = ['-f', 'GeoJSONSeq', '/vsistdout/', PBF, layer, '-spat', ...box.map(String), '-oo', `CONFIG_FILE=${CONF}`];
    if (clip) args.push('-clipsrc', 'spat_extent');
    const p = spawn('ogr2ogr', args, { stdio: ['ignore', 'pipe', 'inherit'] });
    const out = [];
    readline.createInterface({ input: p.stdout }).on('line', (l) => {
      if (l.trim()) out.push(JSON.parse(l.replace(/^\x1e/, '')));
    });
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`ogr2ogr ${layer} exited ${code}`))));
  });
}
const tagsOf = (f) => {
  const t = f.properties.all_tags;
  return typeof t === 'string' ? JSON.parse(t) : t || {};
};
// GDAL gives no OSM node ids; a shared node has the same coordinates in every way, so ids from coordinates join the
// same ways (the road graph and the bridge test need them)
const nodeIds = new Map();
const nodeId = ([lon, lat]) => {
  const k = `${lon.toFixed(7)},${lat.toFixed(7)}`;
  if (!nodeIds.has(k)) nodeIds.set(k, nodeIds.size + 1);
  return nodeIds.get(k);
};
const geom = (coords) => coords.map(([lon, lat]) => ({ lat: Math.round(lat * 1e7) / 1e7, lon: Math.round(lon * 1e7) / 1e7 }));
const inBox = (lon, lat, [w, s, e, n]) => lon > w && lon < e && lat > s && lat < n;

// OGR features -> Overpass elements
function nodes(features) {
  return features.map((f) => ({ type: 'node', id: +f.properties.osm_id, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], tags: tagsOf(f) }));
}
function ways(features) {
  const out = [];
  for (const f of features) {
    if (!f.geometry) continue;
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
    for (const c of lines) out.push({ type: 'way', id: +f.properties.osm_id, tags: tagsOf(f), nodes: c.map(nodeId), geometry: geom(c) });
  }
  return out;
}
function areas(features) {
  const out = [];
  for (const f of features) {
    if (!f.geometry) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    if (!polys.length) continue;
    const t = tagsOf(f);
    const wayId = f.properties.osm_way_id;
    if (wayId && polys.length === 1 && polys[0].length === 1) {
      out.push({ type: 'way', id: +wayId, tags: t, geometry: geom(polys[0][0]) });
    } else {
      const members = [];
      for (const [outer, ...inner] of polys) {
        members.push({ type: 'way', ref: 0, role: 'outer', geometry: geom(outer) });
        for (const r of inner) members.push({ type: 'way', ref: 0, role: 'inner', geometry: geom(r) });
      }
      out.push({ type: 'relation', id: +(f.properties.osm_id || wayId), tags: t, members });
    }
  }
  return out;
}
const center = (e) => {
  const g = e.geometry || (e.members || []).filter((m) => m.role === 'outer').flatMap((m) => m.geometry);
  if (!g || !g.length) return null;
  return { lat: g.reduce((a, p) => a + p.lat, 0) / g.length, lon: g.reduce((a, p) => a + p.lon, 0) / g.length };
};
const write = (name, elements) => {
  fs.writeFileSync(path.join(DATA, name), JSON.stringify({ version: 0.6, generator: 'tools/fetch-osm.mjs (Geofabrik extract via GDAL)', elements }));
  console.log(`[osm] ${name}: ${elements.length} elements`);
};

// Lake Ontario: one natural=water multipolygon (the islands are its inner rings), cut to the shore box
const lakeOut = async () => write('osm_lake.json', areas(await ogr('multipolygons', SHORE, true)).filter((e) => e.tags.name === 'Lake Ontario' && e.tags.natural === 'water'));
// Canada Post boxes (amenity=post_box): not in the City's data
const postBoxesOut = (pts) => write('osm_postboxes.json', pts.filter((e) => e.tags.amenity === 'post_box' && inBox(e.lon, e.lat, CITY)));
if (process.env.ONLY === 'postboxes') {
  postBoxesOut(nodes(await ogr('points', CITY)));
  process.exit(0);
}
// Railways: the streetcar tracks (railway=tram), the heavy-rail lines of the Union Station Rail Corridor (GO, VIA,
// UP Express) and the streetcar stops (railway=tram_stop & the TTC's platforms on the right-of-way)
const railsOut = async () => {
  const L = ways(await ogr('lines', CITY)).filter((e) => /^(tram|rail|light_rail|subway)$/.test(e.tags.railway || ''));
  const P = nodes(await ogr('points', CITY)).filter((e) => e.tags.railway === 'tram_stop' || (e.tags.public_transport === 'stop_position' && e.tags.tram === 'yes'));
  write('osm_rails.json', [...L, ...P]);
};
if (process.env.ONLY === 'rails') {
  await railsOut();
  process.exit(0);
}
if (process.env.ONLY === 'lake') {
  await lakeOut();
  process.exit(0);
}
console.log('[osm] reading the extract (five passes)...');
const [pts, lines, polys] = [nodes(await ogr('points', WIDE)), ways(await ogr('lines', CITY)), areas(await ogr('multipolygons', CITY, true))];
const polysToronto = areas(await ogr('multipolygons', TORONTO)).filter((e) => (e.tags.boundary === 'administrative'));
const cityPt = (e) => e.type === 'node' && inBox(e.lon, e.lat, CITY);

write('osm_roads.json', lines.filter((e) => e.tags.highway));
write('osm_buildings.json', polys.filter((e) => e.tags.building));
const LAND_AMENITY = /^(parking|place_of_worship|university|school|hospital|fuel|marketplace)$/;
write('osm_land.json', [
  ...polys.filter((e) => e.tags.landuse || e.tags.leisure || e.tags.natural || e.tags.man_made || LAND_AMENITY.test(e.tags.amenity || '')),
  ...lines.filter((e) => e.tags.waterway || e.tags.man_made || e.tags.natural || e.tags.barrier === 'wall')
]);
await lakeOut();
await railsOut();
const PLACE_AMENITY = /^(townhall|courthouse|fountain|ferry_terminal)$/;
const placeLike = (t) => t.place === 'square' || t.tourism || t.historic || (t.name && (PLACE_AMENITY.test(t.amenity || '') || t.landuse || t.leisure || /^(tower|pier|breakwater)$/.test(t.man_made || '')));
write('osm_places.json', [
  ...pts.filter((e) => e.tags.place),
  ...pts.filter((e) => cityPt(e) && placeLike(e.tags)),
  ...polys.filter((e) => placeLike(e.tags))
]);
const poiLike = (t) => t.name && (t.amenity || t.shop || t.office || t.tourism || t.leisure || t.healthcare || t.historic || t.government || t.diplomatic || t.building);
write('osm_pois.json', [
  ...pts.filter((e) => cityPt(e) && poiLike(e.tags)),
  ...polys.filter((e) => poiLike(e.tags)).map((e) => ({ type: e.type, id: e.id, center: center(e), tags: e.tags })).filter((e) => e.center)
]);
postBoxesOut(pts);
write('osm_signals.json', pts.filter((e) => cityPt(e) && (e.tags.highway === 'traffic_signals' || e.tags.crossing === 'traffic_signals')));
const toronto = polysToronto.filter((e) => e.tags.name === 'Toronto' && /^(6|8)$/.test(e.tags.admin_level)).sort((a, b) => +a.tags.admin_level - +b.tags.admin_level);
write('osm_fct.json', toronto.slice(0, 1).map((e) => ({ ...e, type: 'relation' })));
write('osm_districts.json', polysToronto.filter((e) => /^(9|10)$/.test(e.tags.admin_level || '')).map((e) => ({ ...e, type: 'relation' })));
