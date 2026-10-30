// tools/fetch-cafeto.mjs: the City of Toronto's CaféTO Locations (sidewalk cafés, curb lane cafés and private property
// patios) through the City's CKAN API. The raw package record and GeoJSON stay in ~/.cache/slop-toronto/raw/cafeto
// (kept unless --force); the dated, complete snapshot the build reads is written to tools/data/cafeto-<date>.json with
// its resource ID, refresh date, fetch time, licence fields and a SHA-256 of the download.
// usage: node tools/fetch-cafeto.mjs [--force]   then: node tools/build-cafeto.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const API = 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action';
const PACKAGE = 'cafeto-curb-lane-parklet-cafe-locations';
const RESOURCE = 'Cafe TO Locations - 4326.geojson';
const OUT = process.env.CAFETO_RAW || path.join(os.homedir(), '.cache/slop-toronto/raw/cafeto');
const FORCE = process.argv.includes('--force');

async function get(url, tries = 5) {
  for (let k = 1; ; k++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(180000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (k >= tries) throw new Error(`${url}: ${e.message}`);
      console.warn(`  retry ${k} (${e.message})`);
      await new Promise((res) => setTimeout(res, 4000 * k));
    }
  }
}

fs.mkdirSync(OUT, { recursive: true });
const pkgFile = path.join(OUT, 'pkg.json'), dataFile = path.join(OUT, 'cafe-to-locations-4326.geojson');
if (FORCE || !fs.existsSync(pkgFile)) fs.writeFileSync(pkgFile, await get(`${API}/package_show?id=${PACKAGE}`));
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).result;
const res = pkg.resources.find((r) => r.name === RESOURCE);
if (!res) throw new Error(`No "${RESOURCE}" in ${PACKAGE}`);
if (FORCE || !fs.existsSync(dataFile)) fs.writeFileSync(dataFile, await get(res.url));
const raw = fs.readFileSync(dataFile);
const geo = JSON.parse(raw);
if (geo.type !== 'FeatureCollection' || !geo.features?.length) throw new Error('Not a CaféTO FeatureCollection');
const fetchedAt = new Date(fs.statSync(dataFile).mtime).toISOString();
const snapshot = {
  source: {
    dataset: pkg.title, publisher: 'City of Toronto', page: `https://open.toronto.ca/dataset/${PACKAGE}/`,
    packageId: pkg.id, resourceId: res.id, resourceName: res.name, resourceUrl: res.url,
    resourceModified: res.last_modified, packageRefreshed: pkg.last_refreshed, refreshRate: pkg.refresh_rate,
    ckanLicence: pkg.license_id, licence: 'Open Government Licence – Toronto (stated on the dataset page; the CKAN licence field is "notspecified")',
    fetchedAt, sha256: crypto.createHash('sha256').update(raw).digest('hex'),
    scope: 'current CaféTO permits: business address points with intervention type, not patio footprints or dates'
  },
  features: geo.features.map(({ properties, geometry }) => ({ properties, geometry }))
};
const out = path.join(ROOT, `tools/data/cafeto-${fetchedAt.slice(0, 10).replace(/-/g, '')}.json`);
fs.writeFileSync(out, JSON.stringify(snapshot) + '\n');
console.log(`[cafeto] ${geo.features.length} records (${res.last_modified}) -> ${path.relative(ROOT, out)}`);
