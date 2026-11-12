import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));

// The geodata build reads the raw downloads (tools/fetch-*.mjs: the OSM extract, City of Toronto Open Data, terrain), which
// are not in the repository. It runs only when GEO_DATA (the osm_*.json, massing, roadway & DEM folder, with the source
// IDs of docs/geodata-ids.md) and PROPS_DATA (the raw Open Data folder) name them: `npm run test:geodata` uses
// ~/.cache/slop-toronto/{osm-ids,raw}.
const GEO_DATA = process.env.GEO_DATA;
const PROPS_DATA = process.env.PROPS_DATA;
const missing = [
  !GEO_DATA && 'GEO_DATA is not set',
  GEO_DATA && !fs.existsSync(path.join(GEO_DATA, 'osm_roads.json')) && `GEO_DATA has no osm_roads.json (${GEO_DATA})`,
  !PROPS_DATA && 'PROPS_DATA is not set',
  PROPS_DATA && !fs.existsSync(PROPS_DATA) && `PROPS_DATA does not exist (${PROPS_DATA})`
].filter(Boolean);
const skip = missing.length ? `needs the raw geodata downloads (${missing.join('; ')}): run npm run test:geodata` : false;

test('geodata builds with default paths in a checkout containing spaces and non-ASCII characters, byte for byte the committed files', { skip, timeout: 600000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'Toronto Tkaronto 東京 '));
  try {
    fs.mkdirSync(path.join(dir, 'tools'));
    fs.mkdirSync(path.join(dir, 'js'));
    for (const name of fs.readdirSync(path.join(root, 'tools'))) {
      if (name.endsWith('.mjs')) fs.copyFileSync(path.join(root, 'tools', name), path.join(dir, 'tools', name));
    }
    // the default input folder is tools/data/ next to the build scripts
    fs.symlinkSync(path.resolve(GEO_DATA), path.join(dir, 'tools/data'), 'dir');
    // the mapped poles (tools/build-poles.mjs, from their own download) and the parked cars (tools/build-parked-cars.mjs)
    // are packed into the binary as they are committed
    for (const rel of ['js/toronto-poles.js', 'js/toronto-parked-cars.js']) fs.copyFileSync(path.join(root, rel), path.join(dir, rel));
    const env = { ...process.env };
    delete env.GEO_DATA;
    const result = spawnSync(process.execPath, ['--max-old-space-size=8192', path.join(dir, 'tools/build-geodata.mjs')], {
      encoding: 'utf8', env, timeout: 600000
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    // every landmark tools/landmark-defs.mjs lists is found (st-bz1o.8)
    assert.doesNotMatch(result.stdout + result.stderr, /landmark (not found|without outline)/);
    const context = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(dir, 'js/toronto-geodata.js'), 'utf8'), context);
    const GEO = context.window.CITY.GEO;
    assert.equal(GEO.frame.origin, 'Union Station (Front Street)');
    assert.ok(GEO.roadGraph.links.length > 0);
    assert.ok(GEO.blocks.length > 0);
    assert.ok(GEO.buildings.length > 0);
    assert.ok(GEO.points.cnTower);
    // reproducible: the same inputs give the same bytes (the site's binary with the poles & parked cars packed in, the tools' script and
    // its ID sidecar, keyed to that script's hash)
    for (const rel of ['js/toronto-geodata.js', 'data/toronto-geodata.bin', 'js/toronto-geodata-ids.js']) {
      assert.ok(fs.readFileSync(path.join(dir, rel)).equals(fs.readFileSync(path.join(root, rel))), `${rel} differs from the rebuild`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The massing sidecar (data/toronto-massing.bin, tools/build-massing.mjs, docs/massing-buildings.md) from the 3D Massing
// shapefile in PROPS_DATA: twice, byte for byte the committed file both times
const SHP = PROPS_DATA && path.join(PROPS_DATA, 'massing2025/3DMassingShapefile_2025_WGS84.shp');
const skipMassing = !PROPS_DATA ? 'PROPS_DATA is not set: run npm run test:geodata'
  : !fs.existsSync(SHP) ? `needs the 3D Massing shapefile (${SHP})` : false;
test('the massing sidecar rebuilds byte for byte from the shapefile', { skip: skipMassing, timeout: 300000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'massing '));
  try {
    for (const run of [1, 2]) {
      const out = path.join(dir, `massing-${run}.bin`);
      const result = spawnSync(process.execPath, [path.join(root, 'tools/build-massing.mjs'), SHP, '--out', out], { encoding: 'utf8', timeout: 300000 });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.ok(fs.readFileSync(out).equals(fs.readFileSync(path.join(root, 'data/toronto-massing.bin'))), `run ${run}: data/toronto-massing.bin differs from the rebuild`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
