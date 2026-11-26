// What each City-data layer holds inside each frame the page can open, counted from the committed dated snapshots
// (docs/city-open-data-layers.md, "Frame coverage"): node tools/audit-frame-coverage.mjs [--json]
// "in frame" is the number of source records whose point projects inside the frame, before each layer's own rules
// (duplicates, status, building matching, placement). The shipped counts are in each layer's file and runtime stats.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { projectPoint, furniture, feedCounts, frameBoxes } from './build-open-data.mjs';
import { parkingMeters } from './build-parking-meters.mjs';
import { cafeto } from './build-cafeto.mjs';
import { decodeGeo } from '../js/geodata-loader.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
export function frames() {
  const ctx = { window: { CITY: {} } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/toronto-geodata.js'), 'utf8'), ctx);
  return frameBoxes(ctx.window.CITY.GEO.frame, read('tools/frames/eglinton.json').world);
}
const inFrame = (frame, geometries) => geometries.filter((g) => projectPoint(g, frame)).length;
const point = (lon, lat) => ({ type: 'Point', coordinates: [lon, lat] });
export function audit() {
  const boxes = frames(), out = [];
  const add = (layer, source, fn) => out.push({ layer, source, detail: fn(boxes.detail), eglinton: fn(boxes.eglinton) });
  const feat = (f) => read(`tools/data/${f}.json`);
  add('Benches', 'street-furniture-bench, Existing', (fr) => furniture(feat('benches-20261028'), fr).records.length);
  add('Wayfinding pillars and signs (TO360)', 'wayfinding, Existing', (fr) => furniture(feat('wayfinding-20261028'), fr).records.length);
  for (const [name, key] of [['poster-structures', 'Poster columns'], ['publication-structures', 'Publication corrals'], ['litter-receptacles', 'Litter bins']]) {
    add(key, `${name}, Existing`, (fr) => feedCounts(feat(`${name}-20261126`), fr).inFrame);
  }
  add('Parking pay stations', 'TPA S5 machines, not retired', (fr) => parkingMeters(read('tools/data/parking-meters-20261028.json'), fr).records.length);
  add('CaféTO sidewalk and curb cafés', 'CaféTO Locations (private patios not placed)', (fr) => cafeto(read('tools/data/cafeto-20261029.json'), fr).records.length);
  const art = read('tools/data/public-art-20261029.json');
  add('Public art', 'public-art, all records', (fr) => inFrame(fr, art.features.map((f) => f.geometry)));
  const her = read('tools/data/heritage-register-20261029.json'), c = Object.fromEntries(her.columns.map((k, i) => [k, i]));
  add('Heritage Register places', 'heritage-register rows', (fr) => inFrame(fr, her.rows.map((r) => point(r[c.lon], r[c.lat]))));
  for (const [kind, f] of [['Washrooms', 'washroom-facilities'], ['Parks and recreation centres', 'parks-and-recreation-facilities'], ['Drinking water', 'parks-drinking-fountains'], ['Outdoor rinks (cards)', 'outdoor-artificial-ice-rinks'], ['Tennis listings (cards)', 'tennis-courts-facilities']]) {
    add(kind, `${f}, all records`, (fr) => inFrame(fr, read(`tools/data/${f}-20261028.json`).records.map((r) => r.geometry)));
  }
  // (jf-2g0) the layers hand-reviewed per site: what each map holds as geometry, counted from the committed reviews and binaries
  const rinkFeatures = [...feat('rink-footprints-20261028').features, ...feat('rink-footprints-20261126-eglinton').features];
  add('Rink polygons (City Outdoor Recreation Areas, reviewed)', 'Outdoor Recreation Area polygons of the rink inventory', (fr) => rinkFeatures.filter((f) => {
    const g = f.geometry, outer = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0];
    return projectPoint(point(outer[0][0], outer[0][1]), fr);
  }).length);
  const wayPoint = (e, fr) => projectPoint(point(e.geometry[0].lon, e.geometry[0].lat), fr);
  const tennisWays = [[feat('sports-footprints-20261023').elements, feat('tennis-review-20261028').groups], [feat('tennis-footprints-20261126-eglinton').elements, feat('tennis-review-20261126-eglinton').groups]]
    .flatMap(([elements, groups]) => { const byId = new Map(elements.map((e) => [e.id, e])); return groups.flatMap((g) => g.ways.map((id) => byId.get(id))); });
  add('Tennis court footprints (reviewed OSM courts)', 'OSM courts of the reviews, joined to City facilities', (fr) => tennisWays.filter((e) => wayPoint(e, fr)).length);
  const carsIn = (bin, fr) => { const u8 = zlib.gunzipSync(fs.readFileSync(path.join(root, bin))), L = decodeGeo(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)); return L.PARKED_CARS; };
  const carRows = Object.fromEntries([['detail', 'data/toronto-geodata.bin'], ['eglinton', 'data/frames/eglinton/toronto-geodata.bin']].map(([k, b]) => [k, carsIn(b).counts.cars]));
  out.push({ layer: 'Parked cars (by-law curb schedule, pay stations)', source: 'each map\'s packed binary (PARKED_CARS)', detail: carRows.detail, eglinton: carRows.eglinton });
  const bike = { data: read('tools/data/bike-share-stations-20261026.json').stationInformation.data };
  add('Bike Share stations', 'GBFS station_information', (fr) => inFrame(fr, bike.data.stations.filter((s) => s.capacity > 0).map((s) => point(s.lon, s.lat))));
  return out;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = audit();
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 1));
  else for (const r of rows) console.log(`${r.layer.padEnd(44)} detail ${String(r.detail).padStart(6)}   eglinton ${String(r.eglinton).padStart(6)}`);
}
