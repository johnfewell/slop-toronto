// tools/frames/build-frame.mjs — builds the runtime city data for a frame other than the detail frame, offline, from
// the same raw downloads as the committed data (docs/map-scale-measurements.md). It runs the shared build tools with
// `--frame <json>` and writes everything to an output folder, never to js/ or data/:
//   toronto-geodata.js / .bin / -ids.js, toronto-poles.js, toronto-sidewalks.js, toronto-traffic-data.js,
//   toronto-transit.js, toronto-signal-plan.js, toronto-massing.bin (opt-in layer), and build-report.json (time and
//   peak memory per step).
// The layers this does not rebuild (parked cars, benches, patios, public art...) keep their detail-frame files.
// usage: node tools/frames/build-frame.mjs --frame tools/frames/eglinton.json --out <dir> [--cache <dir>]
//          [--skip <step,...>] [--heap <MB>] [--install]
//   --cache holds the frame's clipped OSM, massing and roadway inputs (default <out>/cache); a step whose output exists
//   is skipped unless --force names it. Steps: massing, osm, roadway, poles-src, geodata, poles, pack, sidewalks,
//   traffic, transit, signal-plan, subway, subway-topology, massing-bin.
//   --install copies what the page loads into the checkout (explore.html ?map=<name>): data/frames/<name>/
//   toronto-geodata.bin (and its hash into explore.html) and js/frames/<name>/ toronto-sidewalks.js,
//   toronto-traffic-data.js, toronto-transit.js, toronto-signal-plan.js, toronto-subway.js, toronto-subway-topology.js.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { alignBin, setFrameHash } from './align-buildings.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const { values: A } = parseArgs({ options: {
  frame: { type: 'string' }, out: { type: 'string' }, cache: { type: 'string' }, skip: { type: 'string' },
  force: { type: 'string' }, heap: { type: 'string' }, install: { type: 'boolean' }
} });
if (!A.frame || !A.out) throw new Error('usage: build-frame.mjs --frame <frame.json> --out <dir> [--cache <dir>]');
const FRAME = path.resolve(A.frame);
const OUT = path.resolve(A.out);
const CACHE = path.resolve(A.cache || path.join(OUT, 'cache'));
const SKIP = new Set((A.skip || '').split(',').filter(Boolean));
const FORCE = new Set((A.force || '').split(',').filter(Boolean));
const HEAP = A.heap || '16384';
const frame = JSON.parse(fs.readFileSync(FRAME, 'utf8'));
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
// the DEM is the same for every frame (it already covers the whole city and the lake shore)
for (const f of ['dem.i16', 'dem-meta.json']) {
  const dst = path.join(CACHE, f);
  if (!fs.existsSync(dst)) fs.symlinkSync(path.join(os.homedir(), '.cache/slop-toronto/osm', f), dst);
}

const reportFile = path.join(OUT, 'build-report.json');
const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : { frame, steps: {} };
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');

/** Runs a step under /usr/bin/time -l (wall time and peak RSS), unless it is skipped or its output already exists */
function step(name, outputs, cmd, args, env = {}) {
  if (SKIP.has(name)) return console.log(`--- ${name}: skipped`);
  if (!FORCE.has(name) && outputs.length && outputs.every((f) => fs.existsSync(f))) return console.log(`--- ${name}: up to date`);
  console.log(`\n=== ${name}: ${cmd} ${args.join(' ')}`);
  const t0 = Date.now();
  const r = spawnSync('/usr/bin/time', ['-l', cmd, ...args], {
    cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'inherit', 'pipe'], maxBuffer: 1 << 30
  });
  const err = r.stderr.toString();
  const rss = +(err.match(/(\d+)\s+maximum resident set size/) || [])[1] || 0;
  process.stderr.write(err.split('\n').filter((l) => !/^\s+\d+\s+[a-z]/.test(l) && !/real.*user.*sys/.test(l)).join('\n'));
  const s = { seconds: +((Date.now() - t0) / 1000).toFixed(1), peakRssMB: Math.round(rss / 1048576), status: r.status };
  report.steps[name] = s;
  save();
  console.log(`=== ${name}: ${s.status === 0 ? 'ok' : 'FAILED ' + s.status} in ${s.seconds} s, peak ${s.peakRssMB} MB`);
  if (r.status !== 0) {
    report.failed = [...new Set([...(report.failed || []), name])];
    save();
  }
  return r.status === 0;
}

// the frame's scripts the page loads in place of today's (explore.html ?map=<name>)
const FRAME_SCRIPTS = ['toronto-sidewalks.js', 'toronto-traffic-data.js', 'toronto-transit.js', 'toronto-signal-plan.js', 'toronto-subway.js',
  'toronto-subway-topology.js'];
const node = process.execPath;
const heap = `--max-old-space-size=${HEAP}`;
const geoEnv = { GEO_DATA: CACHE, SLOP_FRAME: FRAME };
const o = (f) => path.join(OUT, f);
const c = (f) => path.join(CACHE, f);

step('massing', [c('massing.json')], node, [heap, 'tools/fetch-massing.mjs', '--frame', FRAME], geoEnv);
step('osm', [c('osm_roads.json'), c('osm_land.json'), c('osm_landmarks.json')], node, [heap, 'tools/fetch-osm.mjs', '--frame', FRAME], geoEnv);
step('roadway', [c('city_roadway.json')], node, [heap, 'tools/fetch-roadway.mjs', '--frame', FRAME], geoEnv);
const [w, s, e, n] = frame.bbox;
step('poles-src', [c('poles-4326.geojson')], 'ogr2ogr',
  ['-f', 'GeoJSON', c('poles-4326.geojson'), path.join(os.homedir(), '.cache/slop-toronto/poles/poles-4326.gpkg'), '-spat', w, s, e, n].map(String));
// the geodata first packs the detail poles; the frame's own are packed in once built (pack)
step('geodata', [o('toronto-geodata.js')], node, [heap, 'tools/build-geodata.mjs', '--frame', FRAME, '--out', o('toronto-geodata.js'),
  '--bin', o('toronto-geodata.detail-poles.bin'), '--ids', o('toronto-geodata-ids.js')], geoEnv);
step('poles', [o('toronto-poles.js')], node, [heap, 'tools/build-poles.mjs', '--geo', o('toronto-geodata.js'), '--geojson', c('poles-4326.geojson'),
  '--out', o('toronto-poles.js')], { SLOP_FRAME: FRAME });
step('pack', [o('toronto-geodata.bin')], node, [heap, 'tools/pack-geodata.mjs', '--geo', o('toronto-geodata.js'), '--poles', o('toronto-poles.js'),
  '--bin', o('toronto-geodata.bin')]);
step('sidewalks', [o('toronto-sidewalks.js')], node, [heap, 'tools/build-sidewalks.mjs', '--geo', o('toronto-geodata.js'),
  '--out', o('toronto-sidewalks.js')], { SLOP_FRAME: FRAME });
step('traffic', [o('toronto-traffic-data.js')], node, [heap, 'tools/build-traffic-data.mjs', '--geo', o('toronto-geodata.js'),
  '--out', o('toronto-traffic-data.js')], { SLOP_FRAME: FRAME });
step('transit', [o('toronto-transit.js')], node, [heap, 'tools/build-transit.mjs', '--geo', o('toronto-geodata.js'),
  '--out', o('toronto-transit.js')], { SLOP_FRAME: FRAME });
step('signal-plan', [o('toronto-signal-plan.js')], node, [heap, 'tools/build-signal-plan.mjs'],
  { SIGNAL_PLAN_GEO: o('toronto-geodata.js'), SIGNAL_PLAN_TRAFFIC: o('toronto-traffic-data.js'), SIGNAL_PLAN_OUT: o('toronto-signal-plan.js') });
step('subway', [o('toronto-subway.js')], node, [heap, 'tools/build-subway.mjs', o('toronto-subway.js')], geoEnv);
step('subway-topology', [o('toronto-subway-topology.js')], node, [heap, 'tools/build-subway-topology.mjs', o('toronto-subway-topology.js')],
  { SUBWAY_TOPOLOGY_SUBWAY: o('toronto-subway.js'), SUBWAY_TOPOLOGY_TRANSIT: o('toronto-transit.js') });
step('massing-bin', [o('toronto-massing.bin')], node, [heap, 'tools/build-massing.mjs', '--frame', FRAME, '--geo', o('toronto-geodata.js'),
  '--ids', o('toronto-geodata-ids.js'), '--out', o('toronto-massing.bin')], geoEnv);
console.log(`\nreport: ${reportFile}${report.failed ? ` (failed: ${report.failed.join(', ')})` : ''}`);

if (A.install) {
  if (report.failed) throw new Error(`not installing: ${report.failed.join(', ')} failed`);
  const name = frame.name;
  if (!/^[a-z0-9-]+$/.test(name || '')) throw new Error(`frame name ${name}: lower-case letters, digits and hyphens only`);
  const dataDir = path.join(ROOT, 'data/frames', name), jsDir = path.join(ROOT, 'js/frames', name);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(jsDir, { recursive: true });
  // today's buildings keep today's paint and roofs (align-buildings.mjs)
  const { file, hash, stats } = await alignBin(o('toronto-geodata.bin'));
  fs.writeFileSync(path.join(dataDir, 'toronto-geodata.bin'), file);
  for (const f of FRAME_SCRIPTS) fs.copyFileSync(o(f), path.join(jsDir, f));
  setFrameHash(path.join(ROOT, 'explore.html'), name, hash);
  console.log(`installed ${name}: data/frames/${name}/toronto-geodata.bin (v=${hash}; aligned ${JSON.stringify(stats)}), js/frames/${name}/${FRAME_SCRIPTS.join(', ')}`);
}
