// tools/fetch-sidewalks.mjs: downloads the City of Toronto's "Topographic Mapping – Physical area of sidewalks" (polygons
// digitized from aerial photography, Open Government Licence – Toronto) through the City's CKAN API into a folder outside
// the repo: the package record (pkg-<id>.json: licence, refresh date), the WGS84 GeoPackage and source.json (which
// resource, when). tools/build-sidewalks.mjs clips it to the curb islands and writes js/toronto-sidewalks.js.
// usage: node tools/fetch-sidewalks.mjs [out dir] [--force]   (default ~/.cache/slop-toronto/raw/sidewalks)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const API = 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action';
const PACKAGE = 'topographic-mapping-physical-area-of-sidewalks';
const RESOURCE = 'Sidewalks - 4326.gpkg';
const FILE = 'sidewalks-4326.gpkg';
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const OUT = args.find((a) => !a.startsWith('--')) || path.join(os.homedir(), '.cache/slop-toronto/raw/sidewalks');
fs.mkdirSync(OUT, { recursive: true });

const get = async (url, tries = 4) => {
  for (let i = 1; ; i++) {
    const r = await fetch(url);
    if (r.ok) return r;
    // (the City's file store answers 502/503 at times)
    if (i >= tries) throw new Error(`${r.status} ${r.statusText}: ${url}`);
    await new Promise((res) => setTimeout(res, 3000 * i));
  }
};

const pkg = await (await get(`${API}/package_show?id=${PACKAGE}`)).json();
fs.writeFileSync(path.join(OUT, `pkg-${PACKAGE}.json`), JSON.stringify(pkg, null, 1));
const res = pkg.result.resources.find((r) => r.name === RESOURCE);
if (!res) throw new Error(`no "${RESOURCE}" in ${PACKAGE}: ${pkg.result.resources.map((r) => r.name).join(', ')}`);
const dest = path.join(OUT, FILE);
if (FORCE || !fs.existsSync(dest)) {
  const buf = Buffer.from(await (await get(res.url)).arrayBuffer());
  if (buf.subarray(0, 15).toString() !== 'SQLite format 3') throw new Error(`${res.url} is not a GeoPackage`);
  fs.writeFileSync(dest, buf);
  fs.writeFileSync(path.join(OUT, 'source.json'), JSON.stringify({
    package: PACKAGE,
    title: pkg.result.title,
    page: `https://open.toronto.ca/dataset/${PACKAGE}/`,
    resource: res.name,
    resourceId: res.id,
    url: res.url,
    resourceModified: res.last_modified,
    lastRefreshed: pkg.result.last_refreshed,
    fetchedAt: new Date().toISOString(),
    bytes: buf.length
  }, null, 1));
  console.log(`[sidewalks] ${dest} (${(buf.length / 1048576).toFixed(1)} MB)`);
} else console.log(`[sidewalks] kept ${dest} (--force to download again)`);
