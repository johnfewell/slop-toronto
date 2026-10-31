// tools/fetch-art-heritage.mjs: the City of Toronto's Public Art and Heritage Register datasets (Open Government
// Licence - Toronto), downloaded through the City's CKAN API into a folder outside the repo, then cut to the detail
// frame (with a 100 m margin) as the dated snapshots the build reads (tools/data/public-art-<date>.json,
// tools/data/heritage-register-<date>.json).
// usage: node tools/fetch-art-heritage.mjs [--force] [--date YYYYMMDD]
//        (ART_HERITAGE_DATA=<dir>, default ~/.cache/slop-toronto/raw; needs GDAL's ogr2ogr and unzip)
// then:  node tools/build-art-heritage.mjs
//
// Raw downloads (the citywide GeoJSON, the Shapefile zip, each package_show record) stay in the cache with their
// SHA-256 in the snapshot. Public Art keeps every original field. The Heritage Register snapshot keeps the fields the
// cards and identities use (HERITAGE_FIELDS); the dropped ones (OBJECTID, roll number, MTM coordinates, postal code,
// address parts) remain in the cached Shapefile.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const API = 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action';
const OUT = process.env.ART_HERITAGE_DATA || path.join(os.homedir(), '.cache/slop-toronto/raw');
const FORCE = process.argv.includes('--force');
const dateArg = process.argv.indexOf('--date');
const DATE = dateArg > 0 ? process.argv[dateArg + 1] : new Date().toISOString().slice(0, 10).replaceAll('-', '');
export const HERITAGE_FIELDS = ['Folder_Row', 'CEN', 'YR', 'SEQUENCE', 'SEC', 'REV', 'STATUS', 'IN_DATE', 'LISTED', 'DESIGNATED',
  'EASEMENT_A', 'BUILDING_T', 'DESCRIPTIO', 'BYLAW_NO', 'HTG_CONSER', 'OMB_DATE', 'REASON', 'List_', 'CONSTRUCTI', 'ARCHITECT_',
  'YEAR_DEMOL', 'Property_R', 'ADDRESS', 'ADDRESS_TY', 'WARD', 'HEA_DATE'];

async function get(url, tries = 6) {
  for (let k = 1; ; k++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(600000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (k >= tries) throw new Error(`${url}: ${e.message}`);
      console.warn(`  retry ${k} (${e.message})`);
      await new Promise((res) => setTimeout(res, 5000 * k));
    }
  }
}
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// The detail frame's corners in lon/lat (the inverse of build-open-data.mjs projectPoint), with a margin: a coarse
// pre-filter for inFrame below
export function frameBox(frame, margin = 100) {
  const p = frame.projection, b = frame.detail, c = Math.cos(p.theta), s = Math.sin(p.theta);
  const pts = [[b.x0 - margin, b.z0 - margin], [b.x1 + margin, b.z0 - margin], [b.x0 - margin, b.z1 + margin], [b.x1 + margin, b.z1 + margin]].map(([x, z]) => {
    const X = x + p.ox, Z = -(z + p.oz);
    const e = X * c + Z * s, n = -X * s + Z * c;
    return [p.lon0 + e / p.kx, p.lat0 + n / p.ky];
  });
  return { minLon: Math.min(...pts.map((q) => q[0])), maxLon: Math.max(...pts.map((q) => q[0])), minLat: Math.min(...pts.map((q) => q[1])), maxLat: Math.max(...pts.map((q) => q[1])) };
}
const inBox0 = (box, [lon, lat]) => lon >= box.minLon && lon <= box.maxLon && lat >= box.minLat && lat <= box.maxLat;
// In the (rotated) detail frame, with a margin: the bounding box above only pre-filters
export function inFrame(frame, [lon, lat], margin = 100) {
  const p = frame.projection, b = frame.detail;
  const e = (lon - p.lon0) * p.kx, n = (lat - p.lat0) * p.ky;
  const x = e * Math.cos(p.theta) - n * Math.sin(p.theta) - p.ox, z = -(e * Math.sin(p.theta) + n * Math.cos(p.theta)) - p.oz;
  return x > b.x0 - margin && x < b.x1 + margin && z > b.z0 - margin && z < b.z1 + margin;
}
const firstCoord = (g) => (g.type === 'MultiPoint' ? g.coordinates[0] : g.coordinates);

async function pkg(id, dir) {
  const file = path.join(dir, `pkg-${id}.json`);
  if (FORCE || !fs.existsSync(file)) fs.writeFileSync(file, await get(`${API}/package_show?id=${id}`));
  return JSON.parse(fs.readFileSync(file, 'utf8')).result;
}
async function resource(p, name, dir, file) {
  const res = p.resources.find((r) => r.name === name);
  if (!res) throw new Error(`${p.name}: no resource "${name}"`);
  const dest = path.join(dir, file);
  if (FORCE || !fs.existsSync(dest) || !fs.statSync(dest).size) fs.writeFileSync(dest, await get(res.url));
  const buf = fs.readFileSync(dest);
  console.log(`  ${file}: ${(buf.length / 1048576).toFixed(2)} MB, sha256 ${sha256(buf).slice(0, 16)}`);
  return { res, dest, sha: sha256(buf) };
}
const source = (p, res, sha, extra) => ({
  package: p.name, url: `https://open.toronto.ca/dataset/${p.name}/`, resourceId: res.id, resourceName: res.name,
  fetchedAt: `${DATE.slice(0, 4)}-${DATE.slice(4, 6)}-${DATE.slice(6)}`, updatedAt: res.last_modified, refreshRate: p.refresh_rate,
  licence: p.license_id || 'not stated in CKAN', licenceUrl: 'https://open.toronto.ca/open-data-license/', sha256: sha, ...extra
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ctx = { window: { CITY: {} } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/toronto-geodata.js'), 'utf8'), ctx);
  const frame = ctx.window.CITY.GEO.frame, box = frameBox(frame);
  const inBox = (b, c) => inBox0(b, c) && inFrame(frame, c);

  // Public Art: the citywide 4326 GeoJSON
  const artDir = path.join(OUT, 'public-art');
  fs.mkdirSync(artDir, { recursive: true });
  const artPkg = await pkg('public-art', artDir);
  console.log(`public-art: ${artPkg.title} (refreshed ${artPkg.last_refreshed})`);
  const art = await resource(artPkg, 'Public Art - 4326.geojson', artDir, 'public-art-4326.geojson');
  const artAll = JSON.parse(fs.readFileSync(art.dest, 'utf8'));
  const artFeatures = artAll.features.filter((f) => inBox(box, firstCoord(f.geometry)));
  fs.writeFileSync(path.join(ROOT, `tools/data/public-art-${DATE}.json`), JSON.stringify({
    source: source(artPkg, art.res, art.sha, { citywideTotal: artAll.features.length, clip: 'detail frame + 100 m', fields: 'all original fields' }),
    total: artFeatures.length, features: artFeatures
  }) + '\n');
  console.log(`  ${artFeatures.length} of ${artAll.features.length} records in the detail frame (+100 m)`);

  // Heritage Register: the current address-point Shapefile (WGS84), converted by GDAL
  const herDir = path.join(OUT, 'heritage-register');
  fs.mkdirSync(herDir, { recursive: true });
  const herPkg = await pkg('heritage-register', herDir);
  console.log(`heritage-register: ${herPkg.title} (refreshed ${herPkg.last_refreshed})`);
  const her = await resource(herPkg, 'Heritage Register Data', herDir, 'heritage_register_address_points_wgs84.zip');
  const shpDir = path.join(herDir, 'shp');
  fs.rmSync(shpDir, { recursive: true, force: true });
  execFileSync('unzip', ['-o', '-q', her.dest, '-d', shpDir]);
  const shp = fs.readdirSync(shpDir).find((f) => f.endsWith('.shp'));
  if (!shp) throw new Error('no .shp in the Heritage Register zip');
  const geojson = path.join(shpDir, 'all.geojson');
  execFileSync('ogr2ogr', ['-f', 'GeoJSON', '-lco', 'RFC7946=YES', geojson, path.join(shpDir, shp)]);
  const herAll = JSON.parse(fs.readFileSync(geojson, 'utf8'));
  // One row per record, [lon, lat, ...HERITAGE_FIELDS] (null where the Shapefile has none): a third of the GeoJSON's size
  const herRows = herAll.features.filter((f) => inBox(box, firstCoord(f.geometry)))
    .map((f) => [...firstCoord(f.geometry).map((v) => Math.round(v * 1e7) / 1e7), ...HERITAGE_FIELDS.map((k) => f.properties[k] ?? null)]);
  fs.writeFileSync(path.join(ROOT, `tools/data/heritage-register-${DATE}.json`), JSON.stringify({
    source: source(herPkg, her.res, her.sha, { shapefile: shp, citywideTotal: herAll.features.length, clip: 'detail frame + 100 m',
      notice: 'Dataset not intended for legal purposes without reference to council decision documents and City by-laws (City of Toronto).' }),
    total: herRows.length, columns: ['lon', 'lat', ...HERITAGE_FIELDS], rows: herRows
  }) + '\n');
  console.log(`  ${herRows.length} of ${herAll.features.length} records in the detail frame (+100 m)`);
}
