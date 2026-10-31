// tools/fetch-parking.mjs: where Toronto lets people park on the street, from the City of Toronto's Open Data
// (docs/parked-cars.md):
// - Traffic and Parking By-Law Schedules (Municipal Code Chapter 950): every schedule's records as one JSON (~800 MB).
//   Only the curb ones are kept: 950-13 No Parking, 950-14 No Stopping, 950-16 No Standing, 950-15 Parking for
//   Restricted Periods, and the reserved curbs (taxi stands, loading zones, car share, EV charging...), in force (not
//   repealed), on a street the game has.
// - On-Street Permit Parking Area Maps: the permit areas' polygons, those reaching into the detail frame.
// The raw downloads stay in ~/.cache/slop-toronto/raw/parking (kept unless --force; the big file is fetched in ranged
// pieces, as the server drops a long transfer); the dated snapshots the build reads are written to
// tools/data/parking-bylaws-<date>.json and tools/data/permit-parking-<date>.json, each with its resource, dates,
// licence and the SHA-256 of the download.
// usage: node tools/fetch-parking.mjs [--force]   then: node tools/build-parking.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const API = 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action';
const BYLAWS = { pkg: 'traffic-and-parking-by-law-schedules', resource: 'Traffic and parking by-law schedules', file: 'bylaw-schedules.json' };
const PERMITS = { pkg: 'on-street-permit-parking-area-maps', resource: 'On-Street Permit Parking Area Map Data - 4326.geojson', file: 'permit-parking-areas-4326.geojson' };
const OUT = process.env.PARKING_RAW || path.join(os.homedir(), '.cache/slop-toronto/raw/parking');
const FORCE = process.argv.includes('--force');
// The curb schedules: what each says about parking at the curb
export const CURB_SCHEDULES = {
  '950-13': 'noParking', '950-14': 'noStopping', '950-16': 'noStanding', '950-15': 'restricted',
  '950-05': 'taxiStand', '950-06': 'loading', '950-07': 'loading', '950-08': 'busParking', '950-09': 'loading',
  '950-10': 'loading', '950-37': 'loading', '950-43': 'carShare', '950-44': 'evCharging'
};

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
// a large file in 64 MB ranges, resumed where a piece broke off
async function getLarge(url, file) {
  const part = file + '.part';
  const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(60000) });
  const size = Number(head.headers.get('content-length')) || 0;
  let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  for (let tries = 0; !size || have < size; ) {
    const end = size ? Math.min(size, have + 64 * 2 ** 20) - 1 : '';
    try {
      const r = await fetch(url, { headers: { Range: `bytes=${have}-${end}` }, signal: AbortSignal.timeout(300000) });
      if (r.status !== 206 && !(r.status === 200 && have === 0)) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      fs.appendFileSync(part, buf);
      have += buf.length;
      if (!size) break;
      tries = 0;
    } catch (e) {
      if (++tries > 6) throw new Error(`${url}: ${e.message}`);
      console.warn(`  retry at ${have} bytes (${e.message})`);
      await new Promise((res) => setTimeout(res, 3000 * tries));
    }
  }
  fs.renameSync(part, file);
}

async function resource({ pkg: id, resource: name, file }, large = false) {
  const pkgFile = path.join(OUT, `${id}.pkg.json`), dataFile = path.join(OUT, file);
  if (FORCE || !fs.existsSync(pkgFile)) fs.writeFileSync(pkgFile, await get(`${API}/package_show?id=${id}`));
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).result;
  const res = pkg.resources.find((r) => r.name === name);
  if (!res) throw new Error(`No "${name}" in ${id}`);
  if (FORCE || !fs.existsSync(dataFile)) {
    if (large) await getLarge(res.url, dataFile);
    else fs.writeFileSync(dataFile, await get(res.url));
  }
  const raw = fs.readFileSync(dataFile);
  const fetchedAt = new Date(fs.statSync(dataFile).mtime).toISOString();
  return {
    raw,
    source: {
      dataset: pkg.title, publisher: 'City of Toronto', page: `https://open.toronto.ca/dataset/${id}/`,
      packageId: pkg.id, resourceId: res.id, resourceName: res.name, resourceUrl: res.url,
      resourceModified: res.last_modified, packageRefreshed: pkg.last_refreshed, refreshRate: pkg.refresh_rate,
      ckanLicence: pkg.license_id, licence: pkg.license_title, fetchedAt,
      sha256: crypto.createHash('sha256').update(raw).digest('hex')
    }
  };
}

// The game's street names and frame (js/toronto-geodata.js, city-config.js's projection)
function loadCity() {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/toronto-geodata.js'), 'utf8'), context);
  return context.window.CITY.GEO;
}
// a parsed object without its null fields
const compact = (o) => (Array.isArray(o) ? o.map(compact) : o && typeof o === 'object'
  ? Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null).map(([k, v]) => [k, compact(v)])) : o);
// The objects of the JSON array that follows `marker` in buf, parsed one at a time (the file is too big for one string)
function jsonArrayItems(buf, marker) {
  let i = buf.indexOf(marker);
  if (i < 0) throw new Error(`No ${marker} in the download`);
  i += Buffer.byteLength(marker);
  const out = [];
  let depth = 0, start = -1, inStr = false;
  for (; i < buf.length; i++) {
    const c = buf[i];
    if (inStr) {
      if (c === 0x5c) i++; // backslash: skip the escaped byte
      else if (c === 0x22) inStr = false;
      continue;
    }
    if (c === 0x22) inStr = true;
    else if (c === 0x7b) { if (depth++ === 0) start = i; }
    else if (c === 0x7d) { if (--depth === 0) out.push(JSON.parse(buf.toString('utf8', start, i + 1))); }
    else if (c === 0x5d && depth === 0) return out;
  }
  throw new Error('The by-law download ends inside its array: incomplete');
}
export function project(frame, lat, lon) {
  const P = frame.projection;
  const e = (lon - P.lon0) * P.kx, n = (lat - P.lat0) * P.ky, c = Math.cos(P.theta), s = Math.sin(P.theta);
  return { x: e * c - n * s - P.ox, z: -(e * s + n * c) - P.oz };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.mkdirSync(OUT, { recursive: true });
  const GEO = loadCity();
  const names = new Set(GEO.roads.map((r) => r[0]).filter(Boolean));
  const D = GEO.frame.detail, PAD = 200;
  const inFrame = ({ x, z }) => x > D.x0 - PAD && x < D.x1 + PAD && z > D.z0 - PAD && z < D.z1 + PAD;

  // 1. The by-law schedules: the curb ones in force on the game's streets
  const by = await resource(BYLAWS, true);
  const all = jsonArrayItems(by.raw, '"value":[');
  if (all.length < 10000) throw new Error(`Only ${all.length} by-law records: an incomplete download?`);
  const kept = [];
  const counts = { total: all.length, curb: 0, repealed: 0, otherStreet: 0, outside: 0, kept: 0 };
  for (const r of all) {
    if (!CURB_SCHEDULES[r.templateId]) continue;
    counts.curb++;
    if (r.latestRegulationActionByStatus === 'Repealed') { counts.repealed++; continue; }
    const field = (k) => (r.tableData || []).find((t) => t.key === k)?.value ?? null;
    const highway = field('Highway');
    if (!highway || !names.has(highway.replace(/\s*\((?:NY|ET|SC|EY|TOR|YK)\)\s*$/, ''))) { counts.otherStreet++; continue; }
    const geo = (r.geoData || []).map((g) => ({ from: g.from, to: g.to, lat: g.lat, lon: g.lon }));
    if (geo.length && !geo.some((g) => inFrame(project(GEO.frame, g.lat, g.lon)))) { counts.outside++; continue; }
    const parsed = (r.parsedTableData || []).find((p) => p.key === 'Between' || p.key === 'Location')?.value || null;
    kept.push({
      id: r.id, schedule: r.templateId, status: r.latestRegulationActionByStatus || null, bylaw: r.latestRegulationActionByLaw || null,
      fields: Object.fromEntries((r.tableData || []).map((t) => [t.key, t.value])),
      parsed: parsed ? { type: parsed.SuperType, match: parsed.Match, object: compact(parsed.ParsedObject) } : null,
      geo
    });
  }
  counts.kept = kept.length;
  kept.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const date = by.source.fetchedAt.slice(0, 10).replace(/-/g, '');
  const byOut = path.join(ROOT, `tools/data/parking-bylaws-${date}.json`);
  fs.writeFileSync(byOut, JSON.stringify({
    source: { ...by.source, scope: 'Chapter 950 curb schedules (no parking / stopping / standing, restricted periods, reserved curbs), in force, on streets the game has; the rest of the 950 schedules left out' },
    schedules: CURB_SCHEDULES, counts, records: kept
  }) + '\n');
  console.log(`[parking] by-laws: ${JSON.stringify(counts)} -> ${path.relative(ROOT, byOut)}`);

  // 2. The permit parking areas reaching into the frame
  const pm = await resource(PERMITS);
  const fc = JSON.parse(pm.raw);
  if (fc.type !== 'FeatureCollection' || !fc.features?.length) throw new Error('Not a permit area FeatureCollection');
  const areas = fc.features.filter((f) => {
    const polys = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates];
    return polys.some((poly) => poly[0].some(([lon, lat]) => inFrame(project(GEO.frame, lat, lon))));
  }).map((f) => ({ area: f.properties.AREA_NAME, geometry: f.geometry }));
  const pmOut = path.join(ROOT, `tools/data/permit-parking-${pm.source.fetchedAt.slice(0, 10).replace(/-/g, '')}.json`);
  fs.writeFileSync(pmOut, JSON.stringify({ source: { ...pm.source, scope: 'permit parking areas reaching into the detail frame' }, total: fc.features.length, areas }) + '\n');
  console.log(`[parking] permit areas: ${areas.length} of ${fc.features.length} -> ${path.relative(ROOT, pmOut)}`);
}
