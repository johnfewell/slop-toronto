// The OpenStreetMap tennis footprints of a frame, read from the Geofabrik Ontario extract through GDAL, as the elements
// tools/build-tennis.mjs joins to the City's tennis facilities: node tools/fetch-tennis-footprints.mjs --frame eglinton [<ontario.osm.pbf>]
// Needs GDAL's ogr2ogr and tools/osmconf.ini (every tag as JSON). Writes tools/data/tennis-footprints-<YYYYMMDD>-<frame>.json
// (the extract is the cached 2026-10-23 one the detail map's sports-footprints-20261023.json came from; it is a processing date,
// not an OSM edit date, and the extract's own timestamp was not recorded).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { frameArgs } from './frame-geo.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const { frame, rest } = frameArgs();
if (frame === 'detail') throw new Error('--frame <name>: the detail map has sports-footprints-20261023.json');
const pbf = rest[0] || path.join(process.env.HOME, '.cache/slop-toronto/raw/ontario-latest.osm.pbf');
const [w, s, e, n] = JSON.parse(fs.readFileSync(path.join(root, `tools/frames/${frame}.json`), 'utf8')).bbox;
const r = spawnSync('ogr2ogr', ['-f', 'GeoJSONSeq', '/vsistdout/', pbf, 'multipolygons', '-spat', w, s, e, n, '-oo', `CONFIG_FILE=${path.join(root, 'tools/osmconf.ini')}`,
  '-where', "all_tags LIKE '%tennis%'"].map(String), { encoding: 'utf8', maxBuffer: 1 << 30 });
if (r.status !== 0) throw new Error(`ogr2ogr failed: ${r.stderr}`);
const round = (v) => Math.round(v * 1e7) / 1e7;
const elements = [];
for (const line of r.stdout.split('\n')) {
  if (!line.trim()) continue;
  const f = JSON.parse(line.replace(/^\x1e/, ''));
  const tags = typeof f.properties.all_tags === 'string' ? JSON.parse(f.properties.all_tags) : f.properties.all_tags || {};
  if (!/tennis/.test(tags.sport || '') || !f.properties.osm_way_id || f.geometry?.type !== 'MultiPolygon') continue;
  const polys = f.geometry.coordinates;
  if (polys.length !== 1 || polys[0].length !== 1) continue; // a closed way, not a relation with holes
  elements.push({ type: 'way', id: +f.properties.osm_way_id, tags, geometry: polys[0][0].map(([lon, lat]) => ({ lat: round(lat), lon: round(lon) })) });
}
elements.sort((a, b) => a.id - b.id);
const source = { name: 'OpenStreetMap contributors, Geofabrik Ontario extract through GDAL', url: 'https://download.geofabrik.de/north-america/canada/ontario.html',
  localExtractProcessedAt: '2026-10-23', extractTimestamp: 'not recorded by the existing cache', sourceFileSha256: crypto.createHash('sha256').update(fs.readFileSync(pbf)).digest('hex'),
  frame, bbox: [w, s, e, n], query: "multipolygons layer, all_tags LIKE '%tennis%', sport tagged tennis, closed ways only", licence: 'ODbL 1.0' };
const out = path.join(root, `tools/data/tennis-footprints-20261126-${frame}.json`);
fs.writeFileSync(out, JSON.stringify({ source, elements }));
console.log(`[tennis footprints] ${elements.length} closed ways with sport=tennis in the ${frame} box -> ${path.relative(root, out)}`);
