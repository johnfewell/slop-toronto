// Bigger-map curb islands and frame edges (st-bz1o.9, st-bz1o.10):
//   - st-bz1o.9: fallback sidewalk synthesis from OSM footway=sidewalk + walkable road edges, and noWalk marking for
//     parks, highway loops and service-only islands so they skip the fixed 4.6 m concrete band.
//   - st-bz1o.10: real OSM GTA land use and buildings outside the Eglinton frame (Mississauga, Etobicoke, North York,
//     York Region, Scarborough) in js/toronto-surroundings-data.js + js/surroundings.js, and build-time OSM building
//     fallback in tools/geo-features.mjs for frames extending past the City of Toronto boundary.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { unpackGeo } from '../js/geodata-loader.js';
import { buildSidewalks, osmSidewalkPolicy, runtimeInset, ringArea, INSET } from '../tools/build-sidewalks.mjs';
import { packLandUse, unpackLandUse, classifyLandUse, classifyBuildingStyle, parseOsmHeight, fitFootprintBox, edgeDistBox, EGLINTON } from '../tools/build-surroundings.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const inset = runtimeInset();
const toPts = (flat) => { const p = []; for (let i = 0; i + 1 < flat.length; i += 2) p.push({ x: flat[i], z: flat[i + 1] }); return p; };
const inside = (ring, x, z) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
};
const edgeDist = (ring, x, z) => {
  let d = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i], dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1e-12;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
    d = Math.min(d, Math.hypot(a.x + dx * t - x, a.z + dz * t - z));
  }
  return d;
};

test('osmSidewalkPolicy resolves left/right/both/no/separate tags consistently', () => {
  assert.equal(osmSidewalkPolicy({ sidewalk: 'no' }, 1), 'no');
  assert.equal(osmSidewalkPolicy({ sidewalk: 'none' }, -1), 'no');
  assert.equal(osmSidewalkPolicy({ sidewalk: 'both' }, 1), 'yes');
  assert.equal(osmSidewalkPolicy({ sidewalk: 'right' }, 1), 'yes');
  assert.equal(osmSidewalkPolicy({ sidewalk: 'right' }, -1), 'no');
  assert.equal(osmSidewalkPolicy({ sidewalk: 'left' }, -1), 'yes');
  assert.equal(osmSidewalkPolicy({ sidewalk: 'left' }, 1), 'no');
  assert.equal(osmSidewalkPolicy({ 'sidewalk:left': 'no', 'sidewalk:right': 'separate' }, -1), 'no');
  assert.equal(osmSidewalkPolicy({ 'sidewalk:left': 'no', 'sidewalk:right': 'separate' }, 1), 'separate');
  assert.equal(osmSidewalkPolicy({ 'sidewalk:both': 'no' }, 1), 'no');
  assert.equal(osmSidewalkPolicy({}, 1), null);
});

test('Eglinton sidewalks synthesize plausible walks on street-bordered fallback islands and mark noWalk islands', async () => {
  const { GEO } = await unpackGeo(fs.readFileSync(path.join(ROOT, 'data/frames/eglinton/toronto-geodata.bin')));
  const ctx = { window: { CITY: { GEO } }, console };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/sidewalk-polygons.js'), 'utf8'), ctx);
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/frames/eglinton/toronto-sidewalks.js'), 'utf8'), ctx);
  const { SIDEWALKS, sidewalkBlocksKey, sidewalkPieces, sidewalkNoWalk } = ctx.window.CITY;

  assert.equal(SIDEWALKS.blocks, sidewalkBlocksKey(GEO.blocks), 'blocks key matches committed Eglinton binary');
  assert.ok(SIDEWALKS.stats.islandsWithSynthesizedSidewalks >= 100, `synthesized on ${SIDEWALKS.stats.islandsWithSynthesizedSidewalks} islands`);
  assert.ok(SIDEWALKS.stats.islandsNoSidewalk >= 200, `noWalk on ${SIDEWALKS.stats.islandsNoSidewalk} park/highway/service islands`);
  assert.equal(SIDEWALKS.stats.islandsWithSidewalks + SIDEWALKS.stats.fallbackIslands, SIDEWALKS.stats.eligibleIslands);

  const pieces = sidewalkPieces(SIDEWALKS, GEO.blocks);
  const noWalk = sidewalkNoWalk(SIDEWALKS, GEO.blocks);
  assert.equal(pieces.size, SIDEWALKS.stats.islandsWithSidewalks);
  assert.equal(noWalk.size, SIDEWALKS.stats.islandsNoSidewalk);

  // Every noWalk island must be disjoint from pieces
  for (const bid of noWalk) assert.ok(!pieces.has(bid), `island ${bid} is both walked and noWalk`);

  // Every vertex of every synthesized & City piece must lie on its island's slab (within decimetre rounding)
  let worst = 0;
  for (const [bid, list] of pieces) {
    const b = GEO.blocks[bid];
    assert.ok(b && b[5] === 0, `island ${bid} valid non-median`);
    const slab = inset(toPts(b[0]), INSET);
    for (const { outer, holes } of list) {
      for (const r of [outer, ...holes]) {
        for (const p of r) {
          if (!inside(slab, p.x, p.z)) worst = Math.max(worst, edgeDist(slab, p.x, p.z));
        }
      }
    }
  }
  assert.ok(worst <= 0.08, `vertex ${worst.toFixed(3)} m outside its island slab`);

  // Mismatched blocks reject noWalk cleanly
  assert.equal(sidewalkNoWalk(SIDEWALKS, GEO.blocks.slice(1)), null);
});

test('synthetic fallback synthesis: residential road-edge strip, OSM footway=sidewalk, sidewalk=no exclusion, and park noWalk',
  { skip: spawnSync('ogr2ogr', ['--version']).status !== 0 && 'no GDAL' }, () => {
  const frame = { projection: { lat0: 43.65, lon0: -79.38, kx: 80682.47, ky: 111105.32, theta: 0, ox: 0, oz: 0 }, detail: { x0: -500, x1: 500, z0: -500, z1: 500 } };
  const ll = ([x, z]) => [frame.projection.lon0 + x / frame.projection.kx, frame.projection.lat0 - z / frame.projection.ky];
  // Block 0: residential block bordered on south (z=40) by a residential street (z=45) and on north (z=0) by a sidewalk=no street (z=-5)
  const blkRes = [0, 0, 60, 0, 60, 40, 0, 40];
  // Block 1: pure park island bordered only by a service drive -> should become noWalk
  const blkPark = [100, 0, 160, 0, 160, 40, 100, 40];
  // Block 2: plaza block with an OSM footway=sidewalk running across its west edge
  const blkOsm = [200, 0, 260, 0, 260, 40, 200, 40];
  const roads = [
    ['South St', 8, 0, 2, 1, 0, [0, 45, 60, 45], 'residential'],
    ['NoWalk St', 8, 0, 2, 1, 0, [0, -5, 60, -5], 'residential'],
    ['Park Drive', 6, 0, 1, 0, 0, [100, 45, 160, 45], 'service']
  ];
  const osmRoads = [
    { type: 'way', id: 1, tags: { highway: 'residential', sidewalk: 'no' }, geometry: [[0, -5], [60, -5]].map(ll).map(([lon, lat]) => ({ lon, lat })) },
    { type: 'way', id: 2, tags: { highway: 'footway', footway: 'sidewalk', width: '2.0' }, geometry: [[202, 2], [202, 38]].map(ll).map(([lon, lat]) => ({ lon, lat })) }
  ];
  const sub = {
    GEO: {
      frame,
      roads,
      buildings: [],
      decks: [],
      blocks: [
        [blkRes, [], 0, '', 1, 0, 0],
        [blkPark, [], 1, 'Test Park', 1, 0, 0],
        [blkOsm, [], 0, '', 1, 0, 0]
      ]
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/sidewalk-polygons.js'), 'utf8'), { window: { CITY: sub }, console });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-synth-'));
  try {
    // Empty City sidewalks gpkg (all three islands are fallback islands)
    fs.writeFileSync(path.join(tmp, 'empty.geojson'), JSON.stringify({ type: 'FeatureCollection', features: [] }));
    const gpkg = path.join(tmp, 'empty.gpkg');
    const r = spawnSync('ogr2ogr', ['-f', 'GPKG', gpkg, path.join(tmp, 'empty.geojson'), '-nln', 'Sidewalks - 4326', '-nlt', 'MULTIPOLYGON']);
    assert.equal(r.status, 0, String(r.stderr));
    const { polys, noWalk, stats } = buildSidewalks(gpkg, sub, { synthesize: true, osmRoads });
    assert.equal(stats.islandsWithCitySidewalks, 0);
    assert.equal(stats.islandsWithSynthesizedSidewalks, 2, 'residential + OSM footway islands synthesized');
    assert.deepEqual(noWalk, [1], 'park island with only service road marked noWalk');
    const byBid = new Map();
    for (const [bid, outer] of polys) byBid.set(bid, sub.decodeSidewalkRing(outer));
    assert.ok(byBid.has(0) && byBid.has(2));
    // Block 0: synthesized walk lies on the south side (z near 36..39, inset from z=40), NOT on the north sidewalk=no side (z < 10)
    const zs0 = byBid.get(0).map((p) => p.z);
    assert.ok(Math.min(...zs0) > 35 && Math.max(...zs0) <= 39.8, `south walk z range ${Math.min(...zs0)}..${Math.max(...zs0)}`);
    // Block 2: OSM footway=sidewalk buffered around x=202
    const xs2 = byBid.get(2).map((p) => p.x);
    assert.ok(Math.min(...xs2) >= 200.2 && Math.max(...xs2) <= 204, `OSM footway x range ${Math.min(...xs2)}..${Math.max(...xs2)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('toronto-surroundings-data.js carries real GTA OSM land use and outer buildings with valid provenance', () => {
  const ctx = { window: { CITY: {} } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/toronto-surroundings-data.js'), 'utf8'), ctx);
  const D = ctx.window.CITY.SURROUNDINGS_DATA;
  assert.ok(D && D.version === 1);
  assert.match(D.source.licence, /ODbL/);
  assert.equal(D.landUse.size, 256);
  assert.equal(D.landUse.minX, -26000);
  assert.equal(D.landUse.maxX, 26000);
  const bytes = Buffer.from(D.landUse.data, 'base64');
  assert.equal(bytes.length, 256 * 256);
  const rgba = unpackLandUse(bytes);
  let parks = 0, ind = 0, res = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i] > 80) parks++;
    if (rgba[i + 1] > 80) ind++;
    if (rgba[i + 2] > 60) res++;
  }
  assert.ok(parks > 1000 && ind > 500 && res > 1000, `land-use cells park=${parks} ind=${ind} res=${res}`);

  // Buildings: 7-tuples, all outside Eglinton frame, spanning Mississauga, Etobicoke, North York, York Region, Scarborough
  assert.equal(D.buildings.length % 7, 0);
  assert.ok(D.buildings.length / 7 > 2000, `${D.buildings.length / 7} buildings`);
  for (const reg of ['mississauga', 'etobicoke', 'northYork', 'yorkRegion', 'scarborough']) {
    assert.ok(D.stats.tallByRegion[reg] > 20, `${reg}: ${D.stats.tallByRegion[reg]} tall buildings`);
  }
  for (let i = 0; i < D.buildings.length; i += 7) {
    const [x, z, w, d, h, rot, st] = D.buildings.slice(i, i + 7);
    assert.ok(Number.isFinite(x) && Number.isFinite(z) && w >= 8 && d >= 8 && h >= 3 && Number.isFinite(rot));
    assert.ok(st >= 0 && st <= 4);
    assert.ok(edgeDistBox(x, z, EGLINTON) >= 20, `building (${x},${z}) lies outside Eglinton frame`);
  }
});

test('land-use pack/unpack and OSM tag helpers behave deterministically', () => {
  const park = new Uint8Array([1, 1, 1, 1]), ind = new Uint8Array([0, 0, 1, 1]), leaf = new Uint8Array([1, 0, 0, 0]);
  const packed = packLandUse(park, ind, leaf, 1, 2);
  const rgba = unpackLandUse(packed);
  assert.equal(rgba[0], 255);
  assert.ok(rgba[1] > 100 && rgba[1] < 160);
  assert.ok(rgba[2] > 40 && rgba[2] < 80);
  assert.equal(classifyLandUse({ leisure: 'park' }), 0);
  assert.equal(classifyLandUse({ aeroway: 'runway' }), 1);
  assert.equal(classifyLandUse({ landuse: 'residential' }), 2);
  assert.equal(parseOsmHeight({ height: '48.5 m' }), 48.5);
  assert.equal(parseOsmHeight({ 'building:levels': '10' }), 30);
  assert.equal(parseOsmHeight({ 'building:levels': '20' }), 60);
  assert.equal(classifyBuildingStyle({ building: 'office' }, 45, 500, 30, 25), 1);
  assert.equal(classifyBuildingStyle({ building: 'apartments' }, 60, 1973, 99, 20), 3);
  assert.equal(classifyBuildingStyle({ building: 'apartments' }, 90, 1100, 40, 28), 1);
  assert.equal(classifyBuildingStyle({ building: 'warehouse' }, 10, 3000, 80, 40), 2);
  const fitted = fitFootprintBox({ w: 99, d: 34 }, 1973);
  assert.ok(fitted.d < 22 && fitted.d > 18, `cranked slab depth fitted to ${fitted.d.toFixed(1)} m`);
});
