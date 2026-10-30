// tools/check-geodata-ids.mjs — proves the durable IDs (docs/geodata-ids.md) don't hang on input order: rebuilds the
// geodata from shuffled place, footprint and 3D Massing inputs and the transit from a shuffled GTFS feed, then resolves
// every ID of the committed sidecars in the rebuild and checks it names the same geometry (and every face the same wall).
// Needs the raw downloads, so it is not part of npm test (tests/geodata-ids.test.mjs covers what runs without them).
// usage: GEO_DATA=~/.cache/slop-toronto/osm-ids node --max-old-space-size=12288 tools/check-geodata-ids.mjs [gtfs feed dir] [seed]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { faceOf, FACE_SIDES } from './geo-ids.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = process.env.GEO_DATA;
const FEED = process.argv[2] || path.join(os.homedir(), '.cache/slop-toronto/gtfs/feed');
const SEED = +(process.argv[3] || 20261028);
if (!DATA) throw new Error('usage: GEO_DATA=<dir> node tools/check-geodata-ids.mjs [gtfs feed dir] [seed]');
const log = (...a) => console.log('[ids]', ...a);

// seeded Fisher-Yates
let s = SEED >>> 0;
const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const city = (file) => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  return context.window.CITY;
};
const run = (args) => {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, GEO_DATA: tmpData }, maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`${args.join(' ')} failed:\n${r.stderr}${r.stdout.slice(-4000)}`);
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'geodata-ids-'));
const tmpData = path.join(tmp, 'data'), tmpFeed = path.join(tmp, 'feed');
let failures = 0;
const fail = (msg) => { failures++; if (failures <= 20) log('FAIL', msg); };
try {
  // --- geodata from shuffled inputs
  fs.mkdirSync(tmpData);
  const SHUFFLED = { 'osm_pois.json': 'elements', 'osm_buildings.json': 'elements', 'massing.json': 'parts' };
  for (const f of fs.readdirSync(DATA)) {
    const src = fs.realpathSync(path.join(DATA, f));
    if (!SHUFFLED[f]) { fs.symlinkSync(src, path.join(tmpData, f)); continue; }
    const j = JSON.parse(fs.readFileSync(src, 'utf8'));
    shuffle(j[SHUFFLED[f]]);
    fs.writeFileSync(path.join(tmpData, f), JSON.stringify(j));
  }
  log(`rebuilding the geodata from shuffled ${Object.keys(SHUFFLED).join(', ')} (seed ${SEED})`);
  const out = path.join(tmp, 'toronto-geodata.js');
  // --out: the binary and the ID sidecar land beside it (out.bin, out-ids.js), and explore.html is left alone
  run(['--max-old-space-size=12288', path.join(ROOT, 'tools/build-geodata.mjs'), '--out', out]);
  const A = city(path.join(ROOT, 'js/toronto-geodata.js')).GEO, AI = city(path.join(ROOT, 'js/toronto-geodata-ids.js')).GEO_IDS;
  const B = city(out).GEO, BI = city(out.replace(/\.js$/, '-ids.js')).GEO_IDS;
  const check = (what, ids, rows, ids2, rows2, cmp = (r) => JSON.stringify(r)) => {
    const at = new Map(ids2.map((id, i) => [id, i]));
    let resolved = 0;
    ids.forEach((id, i) => {
      if (!id) return;
      const j = at.get(id);
      if (j === undefined) return fail(`${what} ${id} is missing from the shuffled build`);
      if (cmp(rows[i]) !== cmp(rows2[j])) return fail(`${what} ${id} names other geometry: ${cmp(rows[i])} vs ${cmp(rows2[j])}`);
      resolved++;
    });
    log(`${what}: ${resolved} of ${ids.filter(Boolean).length} IDs resolve to the same row`);
  };
  check('place', AI.pois, A.pois, BI.pois, B.pois, ([x, z, name, cat]) => JSON.stringify([x, z, name, cat]));
  check('building', AI.buildings, A.buildings, BI.buildings, B.buildings);
  // a place's building, by ID (the row index itself may move)
  check('place building', AI.pois, A.pois.map((p) => AI.buildings[p[4]] || ''), BI.pois, B.pois.map((p) => BI.buildings[p[4]] || ''));
  check('building footprint', AI.buildings, AI.buildingOsm, BI.buildings, BI.buildingOsm);
  {
    const at = new Map(BI.buildings.map((id, i) => [id, i]));
    let faces = 0;
    AI.buildings.forEach((id, i) => {
      const j = at.get(id);
      if (j === undefined) return;
      for (const side of FACE_SIDES) {
        if (JSON.stringify(faceOf(A.buildings[i], side)) !== JSON.stringify(faceOf(B.buildings[j], side))) fail(`face ${id}:${side} resolves to another wall`);
        else faces++;
      }
    });
    log(`faces: ${faces} resolve to the same wall`);
  }
  if (JSON.stringify(AI.landmarks) !== JSON.stringify(BI.landmarks)) fail('landmark sources differ');
  if (JSON.stringify(AI.poiAliases) !== JSON.stringify(BI.poiAliases)) fail('duplicate-place aliases differ');
  const same = fs.readFileSync(out, 'utf8') === fs.readFileSync(path.join(ROOT, 'js/toronto-geodata.js'), 'utf8');
  log(`shuffled geodata ${same ? 'is byte-identical to' : 'differs from'} the committed file`);
  const sameBin = fs.readFileSync(out.replace(/\.js$/, '.bin')).equals(fs.readFileSync(path.join(ROOT, 'data/toronto-geodata.bin')));
  log(`shuffled binary geodata ${sameBin ? 'is byte-identical to' : 'differs from'} data/toronto-geodata.bin`);

  // --- transit from a shuffled feed (rows, not headers)
  fs.mkdirSync(tmpFeed);
  for (const f of fs.readdirSync(FEED)) {
    const src = path.join(FEED, f);
    if (!/^(trips|stop_times|shapes)\.txt$/.test(f)) { fs.symlinkSync(src, path.join(tmpFeed, f)); continue; }
    const [head, ...rows] = fs.readFileSync(src, 'utf8').split('\n').filter(Boolean);
    fs.writeFileSync(path.join(tmpFeed, f), [head, ...shuffle(rows)].join('\n') + '\n');
  }
  log('rebuilding the transit from a shuffled trips, stop_times & shapes');
  const tout = path.join(tmp, 'toronto-transit.js');
  run([path.join(ROOT, 'tools/build-transit.mjs'), tmpFeed, tout]);
  const TA = city(path.join(ROOT, 'js/toronto-transit.js')).GEO_TRANSIT, TB = city(tout).GEO_TRANSIT;
  const geom = (T) => (p) => JSON.stringify([T.routes[p.r][0], p.d, p.t, p.pts, p.stops.map((i) => T.stopIds[i])]);
  check('pattern', TA.patterns.map((p) => p.id), TA.patterns.map(geom(TA)), TB.patterns.map((p) => p.id), TB.patterns.map(geom(TB)));
  if (TB.patterns.length !== TA.patterns.length) fail(`${TB.patterns.length} patterns, not ${TA.patterns.length}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
log(failures ? `${failures} failures` : 'every ID resolves to the same geometry');
process.exit(failures ? 1 : 0);
