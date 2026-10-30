// The City's physical sidewalks (js/toronto-sidewalks.js, tools/build-sidewalks.mjs, js/sidewalk-polygons.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSidewalks, loadCity, runtimeInset, ringArea, INSET } from '../tools/build-sidewalks.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CITY = loadCity();
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/toronto-sidewalks.js'), 'utf8'), { window: { CITY }, console });
const { GEO, SIDEWALKS } = CITY;
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

test('the sidewalks were clipped to the islands of the committed geodata', () => {
  assert.equal(SIDEWALKS.blocks, CITY.sidewalkBlocksKey(GEO.blocks));
  assert.equal(SIDEWALKS.inset, INSET);
  assert.ok(SIDEWALKS.polys.length > 1000, `${SIDEWALKS.polys.length} pieces`);
  assert.match(SIDEWALKS.source.page, /topographic-mapping-physical-area-of-sidewalks/);
  assert.match(SIDEWALKS.source.licence, /Open Government Licence – Toronto/);
  assert.ok(SIDEWALKS.source.fetchedAt && SIDEWALKS.source.sha256, 'provenance kept');
  assert.equal(SIDEWALKS.stats.islandsWithSidewalks + SIDEWALKS.stats.fallbackIslands, SIDEWALKS.stats.eligibleIslands);
});

test('every piece lies on its island\'s slab, never on a median, the roadway or a small all-walkway island', () => {
  const pieces = CITY.sidewalkPieces(SIDEWALKS, GEO.blocks);
  assert.ok(pieces && pieces.size === SIDEWALKS.stats.islandsWithSidewalks);
  let n = 0, worst = 0;
  for (const [bid, list] of pieces) {
    const b = GEO.blocks[bid];
    assert.ok(b, `island ${bid}`);
    assert.equal(b[5], 0, `island ${bid} is a median`);
    const poly = toPts(b[0]);
    assert.ok(Math.abs(ringArea(poly.map((p) => [p.x, p.z]))) > 400, `island ${bid} is all walkway`);
    const slab = inset(poly, INSET);
    for (const { outer, holes } of list) {
      assert.ok(outer.length >= 3);
      for (const r of [outer, ...holes]) for (const p of r) {
        n++;
        if (!inside(slab, p.x, p.z)) worst = Math.max(worst, edgeDist(slab, p.x, p.z));
      }
    }
  }
  // (rings are stored at 1 dm: a vertex on the slab's edge may round to 5 cm past it)
  assert.ok(worst <= 0.08, `a vertex ${worst.toFixed(3)} m outside its slab`);
  assert.ok(n === SIDEWALKS.stats.vertices, `${n} vertices`);
});

test('other islands, or no data, keep the fixed band', () => {
  const warn = console.warn;
  const warned = [];
  console.warn = (m) => warned.push(m);
  try {
    const moved = GEO.blocks.map((b, i) => (i === 7 ? [b[0].map((v, k) => (k === 0 ? v + 1 : v)), ...b.slice(1)] : b));
    assert.equal(CITY.sidewalkPieces(SIDEWALKS, moved), null);
    assert.equal(CITY.sidewalkPieces(SIDEWALKS, GEO.blocks.slice(1)), null);
    assert.equal(warned.length, 2);
  } finally {
    console.warn = warn;
  }
  assert.equal(CITY.sidewalkPieces(undefined, GEO.blocks), null);
  assert.equal(CITY.sidewalkPieces({ polys: null }, GEO.blocks), null);
});

test('rings survive the decimetre delta encoding', () => {
  const ring = [[10.04, -3.26], [12.5, -3.26], [12.5, 0.01], [10, 0]];
  const back = JSON.parse(JSON.stringify(CITY.decodeSidewalkRing(CITY.encodeSidewalkRing(ring))));
  assert.deepEqual(back, [{ x: 10, z: -3.3 }, { x: 12.5, z: -3.3 }, { x: 12.5, z: 0 }, { x: 10, z: 0 }]);
});

test('GEOS clipping keeps holes, drops the roadway & medians', { skip: spawnSync('ogr2ogr', ['--version']).status !== 0 && 'no GDAL' }, () => {
  // A synthetic city: one 60 x 40 m island, a median, and a sidewalk ring round the island's edge that spills 3 m onto
  // the roadway, with a hole (the island's middle), plus a sidewalk on the median
  const frame = { projection: { lat0: 43.65, lon0: -79.38, kx: 80682.47, ky: 111105.32, theta: 0, ox: 0, oz: 0 }, detail: { x0: -500, x1: 500, z0: -500, z1: 500 } };
  const island = [0, 0, 60, 0, 60, 40, 0, 40];
  const median = [0, 60, 60, 60, 60, 64, 0, 64];
  const sub = { GEO: { frame, blocks: [[island, [], 0, '', 1, 0, 0], [median, [], 0, '', 1, 1, 0]] } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/sidewalk-polygons.js'), 'utf8'), { window: { CITY: sub }, console });
  const ll = ([x, z]) => [frame.projection.lon0 + x / frame.projection.kx, frame.projection.lat0 - z / frame.projection.ky];
  const ring = (pts) => [...pts, pts[0]].map(ll);
  const fc = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { OBJECTID: 1, ELEVATION: '0', LAST_GEOMETRY_MAINT: '2021-01-01' },
      geometry: { type: 'Polygon', coordinates: [ring([[-3, -3], [63, -3], [63, 43], [-3, 43]]), ring([[3, 3], [3, 37], [57, 37], [57, 3]])] } },
    { type: 'Feature', properties: { OBJECTID: 2, ELEVATION: '0', LAST_GEOMETRY_MAINT: '2021-01-01' },
      geometry: { type: 'Polygon', coordinates: [ring([[5, 61], [50, 61], [50, 63], [5, 63]])] } }
  ] };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sidewalks-test-'));
  try {
    fs.writeFileSync(path.join(tmp, 'sw.geojson'), JSON.stringify(fc));
    const gpkg = path.join(tmp, 'sw.gpkg');
    const r = spawnSync('ogr2ogr', ['-f', 'GPKG', gpkg, path.join(tmp, 'sw.geojson'), '-nln', 'Sidewalks - 4326']);
    assert.equal(r.status, 0, String(r.stderr));
    const { polys, stats } = buildSidewalks(gpkg, sub);
    assert.equal(polys.length, 1, 'one piece, on the island');
    const [bid, outer, ...holes] = polys[0];
    assert.equal(bid, 0);
    assert.equal(holes.length, 1, 'the hole is kept');
    const o = sub.decodeSidewalkRing(outer), h = sub.decodeSidewalkRing(holes[0]);
    const xs = o.map((p) => p.x), zs = o.map((p) => p.z);
    // the outer edge is the slab's (0.25 m in from the curb), not the source's 3 m out on the roadway
    for (const v of [Math.min(...xs), Math.min(...zs)]) assert.ok(Math.abs(v - INSET) <= 0.06, `outer edge at ${v}`);
    assert.ok(Math.abs(Math.max(...xs) - (60 - INSET)) <= 0.06 && Math.abs(Math.max(...zs) - (40 - INSET)) <= 0.06);
    const hx = h.map((p) => p.x), hz = h.map((p) => p.z);
    assert.deepEqual([Math.min(...hx), Math.max(...hx), Math.min(...hz), Math.max(...hz)], [3, 57, 3, 37]);
    assert.equal(stats.eligibleIslands, 1);
    assert.equal(stats.islandsWithSidewalks, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
