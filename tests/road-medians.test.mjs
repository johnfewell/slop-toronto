// The holes in the City's road-surface polygons, drawn as medians (docs/road-medians.md, st-ceg7): the fill and the
// median test on made-up data, fetch-roadway.mjs keeping the holes, and the committed city's medians.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { MEDIAN_AREA, MEDIAN_WIDTH, fillSurface, isMedianRing } from '../tools/road-surfaces.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Just enough of tools/geo-base.mjs's Raster (which loads the OSM extract on import): even-odd scanline fill on a grid */
class Raster {
  constructor(x0, z0, x1, z1, res) {
    this.res = res;
    this.x0 = Math.floor(x0 / res) * res;
    this.z0 = Math.floor(z0 / res) * res;
    this.w = Math.ceil((x1 - this.x0) / res) + 1;
    this.h = Math.ceil((z1 - this.z0) / res) + 1;
    this.d = new Uint8Array(this.w * this.h);
  }
  fillRing(ring, val = 1) {
    for (let j = 0; j < this.h; j++) {
      const z = this.z0 + (j + 0.5) * this.res;
      for (let i = 0; i < this.w; i++) {
        const x = this.x0 + (i + 0.5) * this.res;
        let ins = false;
        for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
          const [xa, za] = ring[a], [xb, zb] = ring[b];
          if ((za > z) !== (zb > z) && x < ((xb - xa) * (z - za)) / (zb - za) + xa) ins = !ins;
        }
        if (ins) this.d[j * this.w + i] = val;
      }
    }
  }
  at(x, z) { return this.d[Math.floor((z - this.z0) / this.res) * this.w + Math.floor((x - this.x0) / this.res)]; }
}
const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

test('isMedianRing: a long thin island is a median, a block and a huge strip are not', () => {
  assert.ok(isMedianRing(rect(0, 0, 60, 3)), '3 x 60 m');
  assert.ok(isMedianRing(rect(0, 0, 400, 8)), '8 x 400 m: mean width 2 x area / perimeter = 7.8 m');
  assert.ok(!isMedianRing(rect(0, 0, 40, 40)), 'a 40 m square is a block');
});

test('isMedianRing: the test is the curb-island builder\'s own (mean width under MEDIAN_WIDTH, area under MEDIAN_AREA)', () => {
  assert.equal(MEDIAN_WIDTH, 9);
  assert.equal(MEDIAN_AREA, 60000);
  assert.ok(!isMedianRing(rect(0, 0, 20000, 4)), '80,000 m2 is too large however thin');
  assert.ok(isMedianRing(rect(0, 0, 100, 4.4)), 'mean width 8.4 m');
  assert.ok(!isMedianRing(rect(0, 0, 100, 40)), 'mean width 28.6 m');
});

test('fillSurface: a polygon fills less its holes, and the holes keep what the raster had', () => {
  const r = new Raster(0, 0, 40, 20, 1);
  r.d.fill(1); // land
  fillSurface(r, { ring: rect(5, 2, 35, 18), holes: [rect(10, 8, 30, 12)] }, 0); // a road with a median
  assert.equal(r.at(7, 5), 0, 'road');
  assert.equal(r.at(20, 10), 1, 'the median is still land');
  assert.equal(r.at(20, 5), 0);
  assert.equal(r.at(2, 10), 1, 'outside the polygon');
});

test('fillSurface: a hole covered by another polygon is road, whichever polygon is filled first', () => {
  const holed = { ring: rect(5, 2, 35, 18), holes: [rect(10, 8, 30, 12)] };
  const plug = { ring: rect(18, 6, 24, 14) }; // an intersection polygon over part of the hole
  for (const order of [[holed, plug], [plug, holed]]) {
    const r = new Raster(0, 0, 40, 20, 1);
    r.d.fill(1);
    for (const s of order) fillSurface(r, s, 0);
    assert.equal(r.at(21, 10), 0, 'under the plug: road');
    assert.equal(r.at(12, 10), 1, 'the rest of the hole: median');
    assert.equal(r.at(28, 10), 1);
  }
});

test('fillSurface: a polygon without holes is the plain fill, and one at the raster\'s edge does not run off it', () => {
  const r = new Raster(0, 0, 20, 20, 1);
  fillSurface(r, { ring: rect(-5, -5, 8, 8), holes: [rect(1, 1, 3, 3)] }, 1);
  assert.equal(r.at(5, 5), 1);
  assert.equal(r.at(2, 2), 0, 'a hole that is inside the raster');
  const p = new Raster(0, 0, 20, 20, 1);
  fillSurface(p, { ring: rect(2, 2, 6, 6) }, 1);
  assert.equal(p.at(4, 4), 1);
  assert.equal(p.at(8, 8), 0);
});

test('fetch-roadway keeps the holes: [kind, outer, holes], and no third element without any', { skip: spawnSync('ogr2ogr', ['--version']).status !== 0 && 'needs GDAL (ogr2ogr)' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadway-holes-'));
  const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
  const feature = (kind, rings) => ({ type: 'Feature', properties: { SUBTYPE_DESC: kind }, geometry: { type: 'Polygon', coordinates: rings } });
  const gj = path.join(dir, 'in.geojson');
  fs.writeFileSync(gj, JSON.stringify({ type: 'FeatureCollection', features: [
    feature('Road Edge', [sq(-79.4, 43.65, -79.399, 43.651), sq(-79.3996, 43.6504, -79.3994, 43.6506)]),
    feature('Intersection', [sq(-79.398, 43.65, -79.397, 43.651)]),
    feature('Highway Edge', [sq(-79.396, 43.65, -79.395, 43.651)])
  ] }));
  const gpkg = path.join(dir, 'in.gpkg');
  assert.equal(spawnSync('ogr2ogr', ['-f', 'GPKG', gpkg, gj]).status, 0);
  const r = spawnSync(process.execPath, [path.join(root, 'tools/fetch-roadway.mjs'), gpkg], { env: { ...process.env, GEO_DATA: dir }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(fs.readFileSync(path.join(dir, 'city_roadway.json'), 'utf8'));
  assert.equal(out.polygons.length, 2, 'Highway Edge is left out, as before');
  const [road, junction] = out.polygons;
  assert.equal(road[0], 'Road Edge');
  assert.equal(road[1].length, 5);
  assert.equal(road[2].length, 1, 'the median');
  assert.equal(road[2][0].length, 5);
  assert.equal(junction.length, 2, 'no third element when there is no hole');
  assert.match(r.stdout, /1 holes kept/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- the committed city -------------------------------------------------------------------------------------------------

let GEO = null;
const geo = () => {
  if (!GEO) {
    const c = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'js/toronto-geodata.js'), 'utf8'), c);
    GEO = c.window.CITY.GEO;
  }
  return GEO;
};
const flatIn = (f, x, z) => {
  let ins = false;
  for (let i = 0, j = f.length - 2; i < f.length; j = i, i += 2) {
    const xi = f[i], zi = f[i + 1], xj = f[j], zj = f[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
};
const blockAt = (x, z) => geo().blocks.find((b) => flatIn(b[0], x, z));

// Places where the City's road polygon has a hole and the orthophoto shows a median: world x, z of the island's middle
// and what it is made of there (docs/road-medians.md): 'lawn' and 'concrete' are raised islands (block rows 1 and 2), 'paint'
// is a gore on the road (no island, an outline in GEO.gores)
const MEDIANS = [
  { name: 'Shaw Street', x: -2776, z: -830.5, kind: 'lawn' },
  { name: 'River Street', x: 2343.5, z: -1533.5, kind: 'lawn' },
  { name: 'Front Street West at the Princes\' Gates (a paved plaza island)', x: -45, z: -41.5, kind: 'concrete' },
  { name: 'Remembrance Drive (a painted gore on a car park)', x: -3093, z: 765, kind: 'paint' },
  { name: 'Cherry Street (a brick-paved strip)', x: 1990, z: -29, kind: 'concrete' },
  { name: 'Lake Shore Boulevard East at Cherry (a concrete apron with a crosswalk)', x: 2002.7, z: 127.5, kind: 'concrete' }
];

test('the committed city has each of these medians made of what the orthophoto shows', () => {
  for (const m of MEDIANS) {
    const b = blockAt(m.x, m.z);
    if (m.kind === 'paint') {
      assert.ok(!b, `${m.name}: no raised island`);
      assert.ok(geo().gores.some((g) => flatIn(g, m.x, m.z)), `${m.name}: a painted gore at ${m.x}, ${m.z}`);
      continue;
    }
    assert.ok(b, `${m.name}: a curb island at ${m.x}, ${m.z}`);
    assert.equal(b[5], m.kind === 'lawn' ? 1 : 2, `${m.name}: ${m.kind}`);
    assert.ok(b[0].length >= 8, `${m.name}: it has an outline`);
  }
});

test('a median splits the carriageway it was drawn across: two roadways, not one 14-22 m road (Shaw Street)', () => {
  // across Shaw Street at the median: land (the median) between two roadways, each under 6 m wide
  const m = MEDIANS[0]; // (Shaw Street)
  const dirs = [[0, 1], [1, 0]]; // the road runs roughly east-west here: walk north-south
  let best = null;
  for (const [dx, dz] of dirs) {
    const runs = [];
    let road = 0;
    for (let o = -12; o <= 12; o += 0.25) {
      const onLand = !!blockAt(m.x + dx * o, m.z + dz * o);
      if (!onLand) road += 0.25; else if (road) { runs.push(road); road = 0; }
    }
    if (road) runs.push(road);
    if (!best || runs.length > best.length) best = runs;
  }
  assert.ok(best.length >= 2, 'a roadway on each side of the island');
  assert.ok(Math.max(...best) < 8, `no roadway is wider than a lane pair: ${best.join(', ')}`);
});

test('the build\'s road polygons with holes: every one of the 446 medians of the detail map is an island or a gore', () => {
  const islands = geo().blocks.filter((b) => b[5] > 0).length;
  assert.equal(islands + geo().gores.length, 446, `${islands} islands and ${geo().gores.length} painted gores (399 medians before the holes were kept, 445 with them)`);
});

test('the fat holes are back: five buildings stood inside whole blocks of laneway polygons', () => {
  const ids = (() => {
    const c = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'js/toronto-geodata-ids.js'), 'utf8'), c);
    return c.window.CITY.GEO_IDS.buildings;
  })();
  assert.equal(ids.length, 35271);
  for (const id of [100832, 103837, 105149, 137504, 137506]) {
    const row = ids.indexOf(`to-3dmassing-2025:${id}`);
    assert.ok(row >= 0, `massing ${id} is a building row`);
    const b = geo().buildings[row];
    const near = [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5]].some(([dx, dz]) => blockAt(b[0] + dx, b[1] + dz));
    assert.ok(near, `massing ${id} stands on a block (within 5 m of ${b[0]}, ${b[1]})`);
  }
});
