// tools/fetch-massing.mjs — writes massing.json (GEO_DATA) from the City of Toronto's 3D Massing shapefile: every
// building part in the city box as a lon/lat ring with its lidar-derived heights. Tower and podium are separate parts,
// so a part list is already the stepped skyline.
// Source: City of Toronto Open Data, "3D Massing" (3dmassingshapefile_2025_wgs84.zip), Open Government Licence – Toronto.
// The shapefile's coordinates are Web Mercator (EPSG:3857) despite the WGS84 in its name.
// usage: GEO_DATA=~/.cache/slop-toronto/osm node tools/fetch-massing.mjs <path to 3DMassingShapefile_2025_WGS84.shp>
import fs from 'node:fs';
import path from 'node:path';
import { open } from 'shapefile';

const DATA = process.env.GEO_DATA;
const SHP = process.argv[2];
if (!DATA || !SHP) throw new Error('usage: GEO_DATA=<dir> node tools/fetch-massing.mjs <shp>');
// the Overpass box (tools/data/q_buildings.overpassql)
const BOX = { s: 43.595, w: -79.495, n: 43.692, e: -79.315 };
const R = 6378137;
const lonLat = ([x, y]) => [
  Math.round(((x / R) * 180) / Math.PI * 1e7) / 1e7,
  Math.round(((2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180) / Math.PI * 1e7) / 1e7
];

const src = await open(SHP);
const parts = [];
let seen = 0;
for (;;) {
  const { done, value } = await src.read();
  if (done) break;
  seen++;
  const p = value.properties;
  if (!(p.LATITUDE > BOX.s && p.LATITUDE < BOX.n && p.LONGITUDE > BOX.w && p.LONGITUDE < BOX.e)) continue;
  const polys = value.geometry.type === 'Polygon' ? [value.geometry.coordinates] : value.geometry.coordinates;
  for (const poly of polys) {
    parts.push({
      ring: poly[0].map(lonLat),
      max: Math.round(p.MAX_HEIGHT * 10) / 10,
      avg: Math.round(p.AVG_HEIGHT * 10) / 10,
      min: Math.round(p.MIN_HEIGHT * 10) / 10,
      ground: Math.round(p.SURF_ELEV * 10) / 10,
      src: p.HEIGHT_SRC
    });
  }
}
fs.writeFileSync(path.join(DATA, 'massing.json'), JSON.stringify({ source: 'City of Toronto 3D Massing 2025 (OGL – Toronto)', parts }));
const tall = parts.filter((p) => p.max > 100).length;
console.log(`[massing] ${parts.length} parts in the box (of ${seen} records); ${tall} over 100 m; tallest ${Math.max(...parts.map((p) => p.max))} m`);
