// tools/fetch-poles.mjs: the City of Toronto's "Topographic Mapping - Poles" (Open Government Licence - Toronto), into a
// folder outside the repo, then cut to the detail frame's bounding box with GDAL (the citywide file is 69 MB).
// usage: POLES=~/.cache/slop-toronto/poles node tools/fetch-poles.mjs [--force]
// then:  node tools/build-poles.mjs   (writes js/toronto-poles.js)
//
// The GeoPackage resource is pinned by id and SHA-256: a refreshed upstream file fails the check until it is reviewed
// (compare the type counts, re-check a few streets against the aerials) and PINNED_SHA256 is updated.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const API = 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action';
export const PACKAGE = 'topographic-mapping-poles';
export const RESOURCE_ID = '5504d484-1bd6-4330-b43c-d562b74a175d'; // "Poles - 4326.gpkg"
export const PINNED_SHA256 = '1b4722aadff160569874c587ce918469850831e86ea72765f119689c4557b8ec'; // last_modified 2026-02-20
const OUT = process.env.POLES || path.join(os.homedir(), '.cache/slop-toronto/poles');
const FORCE = process.argv.includes('--force');

async function get(url, tries = 5) {
  for (let k = 1; ; k++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(900000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (k >= tries) throw new Error(`${url}: ${e.message}`);
      console.warn(`  retry ${k} (${e.message})`);
      await new Promise((res) => setTimeout(res, 5000 * k));
    }
  }
}

// The detail frame's corners back in degrees (the inverse of the build's projection), for GDAL's -spat
export function frameBounds(frame) {
  const p = frame.projection, b = frame.detail;
  const corners = [[b.x0, b.z0], [b.x1, b.z0], [b.x0, b.z1], [b.x1, b.z1]].map(([x, z]) => {
    const X = x + p.ox, Z = -(z + p.oz);
    const e = X * Math.cos(p.theta) + Z * Math.sin(p.theta), n = -X * Math.sin(p.theta) + Z * Math.cos(p.theta);
    return [p.lon0 + e / p.kx, p.lat0 + n / p.ky];
  });
  const lon = corners.map((c) => c[0]), lat = corners.map((c) => c[1]);
  return [Math.min(...lon) - 1e-4, Math.min(...lat) - 1e-4, Math.max(...lon) + 1e-4, Math.max(...lat) + 1e-4];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(OUT, { recursive: true });
  const pkgFile = path.join(OUT, `pkg-${PACKAGE}.json`);
  if (FORCE || !fs.existsSync(pkgFile)) fs.writeFileSync(pkgFile, await get(`${API}/package_show?id=${PACKAGE}`));
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).result;
  const res = pkg.resources.find((r) => r.id === RESOURCE_ID);
  if (!res) throw new Error(`Resource ${RESOURCE_ID} is no longer in ${PACKAGE}`);
  const gpkg = path.join(OUT, 'poles-4326.gpkg');
  if (FORCE || !fs.existsSync(gpkg)) {
    console.log(`[poles] downloading ${res.name} (${(res.size / 1e6).toFixed(0)} MB)`);
    fs.writeFileSync(gpkg, await get(res.url));
  }
  const sha = createHash('sha256').update(fs.readFileSync(gpkg)).digest('hex');
  if (sha !== PINNED_SHA256) throw new Error(`poles-4326.gpkg SHA-256 ${sha} is not the reviewed ${PINNED_SHA256}`);
  fs.writeFileSync(path.join(OUT, 'poles-4326.gpkg.json'), JSON.stringify({ package: PACKAGE, resourceId: res.id,
    name: res.name, url: res.url, lastModified: res.last_modified, sha256: sha, fetchedAt: new Date(fs.statSync(gpkg).mtime).toISOString().slice(0, 10) }, null, 2));
  const context = { window: { CITY: {} } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/toronto-geodata.js'), 'utf8'), context);
  const bbox = frameBounds(context.window.CITY.GEO.frame).map((v) => v.toFixed(5));
  const out = path.join(OUT, 'poles-detail-4326.geojson');
  fs.rmSync(out, { force: true });
  execFileSync('ogr2ogr', ['-f', 'GeoJSON', '-spat', ...bbox, '-lco', 'COORDINATE_PRECISION=7', out, gpkg, 'Poles - 4326'], { stdio: 'inherit' });
  console.log(`[poles] ${out}`);
}
