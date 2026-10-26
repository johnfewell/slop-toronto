// tools/fetch-opendata.mjs: City of Toronto Open Data for the signals, crosswalks & traffic volumes (Open Government
// Licence - Toronto), downloaded through the City's CKAN API into a folder outside the repo.
// usage: OPENDATA=~/.cache/slop-toronto/opendata node tools/fetch-opendata.mjs [--force]
// then:  node tools/build-traffic-data.mjs   (writes js/toronto-traffic-data.js from these files)
//
// Each dataset's package_show record is saved next to its files (pkg-<id>.json: its licence, its refresh date), and a
// file already there is kept unless --force.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const API = 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action';
const OUT = process.env.OPENDATA || path.join(os.homedir(), '.cache/slop-toronto/opendata');
const FORCE = process.argv.includes('--force');

// dataset id -> the resources (by name) to fetch, and the file each is saved as (a name list: the first that downloads;
// the City's file store answers 502 at times, its datastore dump of the same table then serves it as CSV)
const WANT = {
  'traffic-signals-tabular': {
    'Traffic Signal - 4326.geojson': 'traffic-signal-4326.geojson',
    'Pedestrian Crossover - 4326.csv|Pedestrian Crossover - 4326.geojson': 'pedestrian-crossover-4326.csv',
    'Traffic Beacon - 4326.csv|Traffic Beacon - 4326.geojson': 'traffic-beacon-4326.csv',
    'Traffic Signal Tabular Readme': 'traffic-signal-tabular-readme.xlsx'
  },
  'traffic-signal-timing': { 'Traffic Signal Timing': 'traffic-signals-timing.zip' },
  'pedestrian-network': { 'Pedestrian Network Data - 4326.geojson': 'pedestrian-network-4326.geojson' },
  'traffic-volumes-at-intersections-for-all-modes': {
    'tmc_most_recent_summary_data.csv': 'tmc_most_recent_summary_data.csv',
    'tmc_raw_data_2020_2029.csv': 'tmc_raw_data_2020_2029.csv' // (88 MB: 15-minute turning movements & crossings)
  },
  'traffic-volumes-midblock-vehicle-speed-volume-and-classification-counts': {
    'svc_most_recent_summary_data.csv': 'svc_most_recent_summary_data.csv',
    'svc_data_dictionary.xlsx': 'svc_data_dictionary.xlsx',
    'svc_raw_data_volume_2020_2024': 'svc_raw_data_volume_2020_2024.csv' // (15-minute volumes round the clock)
  },
  'traffic-signal-vehicle-and-pedestrian-volumes': {
    'traffic-signal-vehicle-and-pedestrian-volumes-data': 'traffic-signal-vehicle-and-pedestrian-volumes.xlsx',
    'traffic-signal-vehicle-and-pedestrian-volumes-readme': 'traffic-signal-vehicle-and-pedestrian-volumes-readme.xls'
  }
};

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

fs.mkdirSync(OUT, { recursive: true });
const failed = [];
for (const [id, files] of Object.entries(WANT)) {
  const pkgFile = path.join(OUT, `pkg-${id}.json`);
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).result;
    if (FORCE) throw new Error('refresh');
  } catch {
    const buf = await get(`${API}/package_show?id=${id}`);
    fs.writeFileSync(pkgFile, buf);
    pkg = JSON.parse(buf).result;
  }
  console.log(`${id}: ${pkg.title} (refreshed ${pkg.last_refreshed || '?'})`);
  for (const [names, file] of Object.entries(files)) {
    const dest = path.join(OUT, file);
    if (!FORCE && fs.existsSync(dest) && fs.statSync(dest).size > 0) { console.log(`  ${file}: kept`); continue; }
    let done = false;
    for (const name of names.split('|')) {
      const res = pkg.resources.find((r) => r.name === name);
      if (!res) { console.warn(`  missing resource "${name}"`); continue; }
      try {
        const buf = await get(res.url);
        fs.writeFileSync(dest, buf);
        console.log(`  ${file}: ${(buf.length / 1048576).toFixed(1)} MB`);
        done = true;
        break;
      } catch (e) {
        console.warn(`  ${name}: ${e.message}`);
      }
    }
    if (!done) failed.push(file);
  }
}
console.log(`-> ${OUT}`);
if (failed.length) {
  console.error(`not downloaded (run again later): ${failed.join(', ')}`);
  process.exitCode = 1;
}
