#!/usr/bin/env node
// tools/fetch-building-era.mjs — the small public records the building-era investigation needs, fetched from
// open sources into a private cache (docs/building-era-sources.md, bead st-ndw9.2). Nothing here ships or is read by
// the page. Every response is written under the cache with its source URL alongside, so the report's claims can be
// re-checked against the exact bytes that were read.
//
// Sources (Open Government Licence – Toronto or Statistics Canada open data; no login, no key):
//   building-era/cot/address-point-2021-in-frame.json            147,084 address points in the frame, 74 pages of 2,000
//                                                                (cot_geospatial27 layer 101), with a count check
//   building-era/cot/census-dissemination-area-2021.json         census dissemination areas in the frame (layer 28/2)
//   building-era/cot/apartment-building-registration.json        RentSafeTO/ABS registration points with YEAR_BUILT (8/6)
//   building-era/cot/building-permits-new-building.json          the New Building permits of both permit datastores,
//                                                                descriptive fields only (the geo fields come from the
//                                                                address points; the permit URLs stay on the portal)
//   building-era/cot/dissemination-area-2021-layer.json          the layer's field list (provenance)
//   building-era/cot/zoning-area-2021-sample.json                the Zoning Area layer's field list (no year in it)
//   building-era/ckan/property-boundaries-4326.csv                the parcel boundaries (property-boundaries), 224 MB
//   building-era/census/98100242-eng.zip                         Statistics Canada 98-10-0242, the full table (35 MB)
//   building-era/overpass/osm-buildings-in-frame.json            every building way's tags + centre in the frame
//   building-era/parcels-in-frame.json                           the parcels above, projected and clipped to the frame
//                                                                (written by this script once the CSV is present)
//
// usage: node tools/fetch-building-era.mjs [--cache DIR] [--only cot|census|heritage] [--force]
// Default cache: $BUILDING_ERA_CACHE or $HOME/.cache/slop-toronto/raw/building-era
// It skips a file that is already on disk unless --force. A response over 300 MB is refused before the download
// starts (the brief's rule), with the size printed, so a smaller route can be chosen instead.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const UA = 'SlopToronto/1.0 (+https://sloptoronto.ca)';
const LIMIT = 300 * 1024 * 1024;
const { values: opt } = parseArgs({
  options: { cache: { type: 'string' }, only: { type: 'string' }, force: { type: 'boolean', default: false } },
});
const CACHE = opt.cache || process.env.BUILDING_ERA_CACHE || path.join(process.env.HOME, '.cache/slop-toronto/raw/building-era');
const GIST = 'https://gis.toronto.ca/arcgis/rest/services';

// ArcGIS feature queries. Each is one page (resultRecordCount <= 2000) unless pages is set; the report says what each
// page holds. `check` is the smallest count the response must carry, so a silently empty or moved layer fails loudly.
const FRAME = '-79.495,43.595,-79.315,43.692';
const query = (service, layer, fields, extra = '') =>
  `${GIST}/${service}/MapServer/${layer}/query?where=1%3D1&geometry=${FRAME}&geometryType=esriGeometryEnvelope&inSR=4326` +
  `&spatialRel=esriSpatialRelIntersects&outFields=${fields}&returnGeometry=false&f=json${extra}`;

const ARCGIS = [
  { dir: 'cot', name: 'dissemination-area-2021-layer.json', url: `${GIST}/cot_geospatial28/MapServer/2?f=json` },
  { dir: 'cot', name: 'census-dissemination-area-2021.json', url: query('cot_geospatial28', 2, 'AREA_ID,AREA_LONG_CODE', '&resultRecordCount=2000') },
  { dir: 'cot', name: 'address-point-2021-count-in-frame.json', url: query('cot_geospatial27', 101, '', '&returnCountOnly=true'), check: (j) => j.count > 0 },
  { dir: 'cot', name: 'apartment-building-registration.json', url: `${GIST}/cot_geospatial8/MapServer/6/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=4000&f=json` },
  { dir: 'cot', name: 'zoning-area-2021-sample.json', url: `${GIST}/cot_geospatial11/MapServer/3/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=1&f=json` },
];

// Statistics Canada WDS: the full table CSV (zip), 35,276,327 bytes (Content-Length, census/98100242-content-length-headers.txt)
const CENSUS = [
  { dir: 'census', name: '98100242-eng.zip', url: 'https://www150.statcan.gc.ca/n1/tbl/csv/98100242-eng.zip' },
];

// The parcel boundaries: the CKAN datastore CSV, 224,739,799 bytes (content-range header in the cache's .source.txt)
const PROPERTY = [
  { dir: '.', name: 'ckan/property-boundaries-4326.csv', url: 'https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/1acaa8b0-f235-4df6-8305-02025ccdeb07/resource/23d1f792-018f-4069-ac5d-443e932e1b78/download/property-boundaries-4326.csv' },
];

const FILES = { cot: ARCGIS, census: CENSUS, property: PROPERTY };

async function get(url, out) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > LIMIT) throw new Error(`refused: ${len} bytes is over the 300 MB limit (a smaller route is needed)`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buf);
  return { bytes: buf.length, res };
}

const job = async ({ dir, name, url, check }) => {
  const out = path.join(CACHE, dir, name);
  if (fs.existsSync(out) && !opt.force) return console.log(`skip   ${out}`);
  try {
    const { bytes, res } = await get(url, out);
    fs.writeFileSync(`${out}.source.txt`, `${url}\n${new Date().toISOString()}\n` +
      [...res.headers].filter(([k]) => ['date', 'last-modified', 'content-type', 'content-length', 'etag'].includes(k))
        .map(([k, v]) => `${k}: ${v}`).join('\n') + '\n');
    let note = '';
    if (check) {
      const j = JSON.parse(fs.readFileSync(out, 'utf8'));
      note = check(j) ? ' ok' : ' CHECK FAILED';
    }
    console.log(`fetch  ${bytes} B  ${out}${note}`);
  } catch (e) {
    console.log(`FAIL   ${out}: ${e.message}`);
  }
};

const which = opt.only ? [opt.only] : Object.keys(FILES);
for (const group of which) {
  if (!FILES[group]) throw new Error(`unknown --only ${group} (cot|census|property)`);
  for (const f of FILES[group]) await job(f);
}

// The address points: pages of 2,000 (the service's cap) into one file, checked against the portal's own count
const addrOut = path.join(CACHE, 'cot/address-point-2021-in-frame.json');
if ((!opt.only || opt.only === 'cot') && !fs.existsSync(addrOut)) {
  const expected = JSON.parse(fs.readFileSync(path.join(CACHE, 'cot/address-point-2021-count-in-frame.json'), 'utf8')).count;
  const seen = new Map();
  for (let offset = 0; offset < expected; offset += 2000) {
    const url = query('cot_geospatial27', 101, 'ADDRESS_POINT_ID,ADDRESS_FULL,LONGITUDE,LATITUDE', `&resultOffset=${offset}&resultRecordCount=2000`);
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    const j = await res.json();
    if (!j.features) throw new Error(`address points at ${offset}: ${j.error?.message || 'no features'}`);
    for (const f of j.features) seen.set(f.attributes.ADDRESS_POINT_ID, f.attributes);
  }
  if (seen.size !== expected) throw new Error(`${seen.size} address points, the portal's count says ${expected}`);
  fs.writeFileSync(addrOut, JSON.stringify({ count: seen.size, source: 'cot_geospatial27 MapServer/101, pages of 2000', elements: [...seen.values()] }));
  console.log(`fetch  ${seen.size} address points  ${addrOut}`);
}

// The parcels: the CSV read, each polygon projected, and only those whose bounding box touches the detail frame kept
const parcelsOut = path.join(CACHE, 'parcels-in-frame.json');
if ((!opt.only || opt.only === 'property') && !fs.existsSync(parcelsOut)) {
  const { loadGeo, project } = await import('./building-era-frame.mjs');
  const G = loadGeo();
  const f = G.frame.detail;
  const lines = fs.readFileSync(path.join(CACHE, 'ckan/property-boundaries-4326.csv'), 'utf8').split('\n').map((l) => l.replace(/\r$/, ''));
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const mi = line.indexOf(',"');
    if (mi < 0) continue;
    const meta = line.slice(0, mi).split(',');
    let geo;
    try { const g = line.slice(mi + 1); geo = JSON.parse(g.slice(1, -1).replace(/""/g, '"')); } catch { continue; }
    const polys = geo.type === 'Polygon' ? [geo.coordinates] : geo.coordinates;
    for (const poly of polys) {
      const ring = poly[0].map(([lon, lat]) => project(G.frame.projection, lon, lat));
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      if (x1 < f.x0 || x0 > f.x1 || z1 < f.z0 || z0 > f.z1) continue;
      out.push({ id: meta[1], type: meta[2], ring: ring.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]) });
    }
  }
  fs.writeFileSync(parcelsOut, JSON.stringify(out));
  console.log(`kept   ${out.length} parcel polygons  ${parcelsOut}`);
}
