// tools/fetch-gtfs.mjs — downloads the TTC's timetable, "Merged GTFS - TTC Routes and Schedules" (all modes: subway,
// streetcars and buses) from City of Toronto Open Data, and unpacks it next to the zip. The raw feed (~85 MB zipped,
// ~1 GB of text) stays outside the repository: tools/build-transit.mjs reads it and writes the small js/toronto-transit.js.
// Open Government Licence – Toronto (https://open.toronto.ca/open-data-license/).
// usage: node tools/fetch-gtfs.mjs [out dir]     (default ~/.cache/slop-toronto/gtfs)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const CKAN = 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=merged-gtfs-ttc-routes-and-schedules';
const OUT = process.argv[2] || path.join(process.env.HOME, '.cache/slop-toronto/gtfs');
fs.mkdirSync(OUT, { recursive: true });

const pkg = (await (await fetch(CKAN)).json()).result;
const res = pkg.resources.find((r) => /zip/i.test(r.format) || /\.zip$/i.test(r.url));
if (!res) throw new Error('no ZIP resource in ' + pkg.name);
console.log(`[gtfs] ${pkg.title}: ${res.name}, modified ${res.last_modified}`);
const zip = path.join(OUT, path.basename(new URL(res.url).pathname));
const buf = Buffer.from(await (await fetch(res.url)).arrayBuffer());
fs.writeFileSync(zip, buf);
fs.writeFileSync(path.join(OUT, 'SOURCE.json'), JSON.stringify({ dataset: pkg.name, title: pkg.title, resource: res.name, url: res.url, modified: res.last_modified, fetched: new Date().toISOString() }, null, 2));
const dir = path.join(OUT, 'feed');
fs.mkdirSync(dir, { recursive: true });
execFileSync('unzip', ['-o', '-q', zip, '-d', dir]);
console.log(`[gtfs] ${(buf.length / 1048576).toFixed(1)} MB -> ${dir}: ${fs.readdirSync(dir).join(', ')}`);
