// tools/fetch-roadway.mjs — writes city_roadway.json (GEO_DATA): the City of Toronto's road surface inside the city box,
// from "Topographic Mapping – Edge of Roadway" (polygons, Open Government Licence – Toronto): road edges, intersections,
// laneways and road bridges as lon/lat outer rings. The geodata build (tools/geo-blocks.mjs) draws them as the roadway, so
// the curbs and sidewalks stand where the City's do. Elevated highways & ramps stay with the deck code (geo-roads.mjs).
// usage: GEO_DATA=~/.cache/slop-toronto/osm node tools/fetch-roadway.mjs <edge-of-roadway-4326.gpkg>
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';

const [GPKG] = process.argv.slice(2);
const DATA = process.env.GEO_DATA;
if (!GPKG || !DATA) throw new Error('usage: GEO_DATA=<dir> node tools/fetch-roadway.mjs <edge-of-roadway-4326.gpkg>');
const KEEP = new Set(['Road Edge', 'Intersection', 'Lane Edge', 'Road Bridge']);
const out = { source: 'City of Toronto, Topographic Mapping – Edge of Roadway (OGL – Toronto)', polygons: [] };
const counts = {};
await new Promise((resolve, reject) => {
  const p = spawn('ogr2ogr', ['-f', 'GeoJSONSeq', '/vsistdout/', GPKG, '-spat', '-79.505', '43.585', '-79.305', '43.7'], { stdio: ['ignore', 'pipe', 'ignore'] });
  readline.createInterface({ input: p.stdout }).on('line', (l) => {
    if (!l.trim()) return;
    const f = JSON.parse(l.replace(/^\x1e/, ''));
    const kind = f.properties.SUBTYPE_DESC;
    if (!KEEP.has(kind) || !f.geometry) return;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) out.polygons.push([kind, poly[0].map(([lon, lat]) => [Math.round(lon * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7])]);
    counts[kind] = (counts[kind] || 0) + 1;
  });
  p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ogr2ogr exited ${code}`))));
});
fs.writeFileSync(path.join(DATA, 'city_roadway.json'), JSON.stringify(out));
console.log('[roadway]', counts, `${out.polygons.length} rings`);
