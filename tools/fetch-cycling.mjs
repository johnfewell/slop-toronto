// tools/fetch-cycling.mjs — downloads the City of Toronto's "Cycling Network" (Toronto Open Data, Open Government
// Licence – Toronto) into the raw downloads folder: every bikeway segment (cycle tracks, bike lanes, buffered &
// contra-flow lanes, sharrows, multi-use trails, park roads, signed routes) as WGS84 GeoJSON. The geodata build
// (tools/geo-cycling.mjs) reads it from there; the file stays out of the repository.
// usage: node tools/fetch-cycling.mjs [out dir]   (default ~/.cache/slop-toronto/raw, or $PROPS_DATA)
import fs from 'node:fs';
import path from 'node:path';

const CKAN = 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=cycling-network';
const OUT = process.argv[2] || process.env.PROPS_DATA || path.join(process.env.HOME, '.cache/slop-toronto/raw');
const FILE = 'cycling-network-4326.geojson';

const pkg = (await (await fetch(CKAN)).json()).result;
// the WGS84 GeoJSON file (not the datastore dump, which has no geometry type per feature, nor the 2952 projection)
const res = pkg.resources.find((r) => /4326\.geojson$/i.test(r.url));
if (!res) throw new Error(`no 4326 GeoJSON among: ${pkg.resources.map((r) => r.name).join(', ')}`);
const body = await (await fetch(res.url)).text();
const n = JSON.parse(body).features.length;
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, FILE), body);
console.log(`[cycling] ${pkg.title}, refreshed ${pkg.last_refreshed}: ${n} segments -> ${path.join(OUT, FILE)}`);
