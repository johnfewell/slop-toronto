// tests/building-era.test.mjs — the matching behind docs/building-era-sources.md (bead st-ndw9.2): the detail frame's
// projection and inverse, point-in-outline, the 15 m nearest-outline rule, the per-outline counters, the era windows
// and the construction-year and address parsers. Pure geometry on planted cases, plus one check against the committed
// massing outlines so a broken sidecar or frame fails here.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadGeo, loadMassing, project, unproject, inDetail, inRing, distanceToRing, matchToMassing,
  countInside, countPolygonsCentredInside, centroid,
} from '../tools/building-era-frame.mjs';
import { ERAS, eraOf, hYear, osYear, addressKey } from '../tools/report-building-era.mjs';

const G = loadGeo();
const P = G.frame.projection;

test('the projection round-trips the origin and a far corner', () => {
  for (const [lon, lat] of [[P.lon0, P.lat0], [-79.3, 43.65], [-79.4, 43.7]]) {
    const [x, z] = project(P, lon, lat);
    const [lo, la] = unproject(P, x, z);
    assert.ok(Math.abs(lo - lon) < 1e-9 && Math.abs(la - lat) < 1e-9, `${lon},${lat} came back ${lo},${la}`);
  }
  assert.deepEqual(project(P, P.lon0, P.lat0).map((v) => Math.round(v * 1e6) / 1e6 || 0), [0, 0]);
});

test('the detail frame is a rectangle in the world frame', () => {
  const f = G.frame.detail;
  assert.equal(inDetail(G, 0, 0), true);
  assert.equal(inDetail(G, f.x0, f.z0), true);
  assert.equal(inDetail(G, f.x1 + 1, 0), false);
  assert.equal(inDetail(G, 0, f.z1 + 1), false);
});

const square = [[0, 0], [10, 0], [10, 10], [0, 10]];

test('inside, outside and distance to a square', () => {
  assert.equal(inRing(square, 5, 5), true);
  assert.equal(inRing(square, 15, 5), false);
  assert.equal(distanceToRing(square, 5, 5), 0);
  assert.equal(distanceToRing(square, 15, 5), 5);
  assert.equal(distanceToRing(square, 13, 13), Math.hypot(3, 3));
});

test('an outline is matched inside first, then the nearest edge within 15 m only', () => {
  const outlines = [
    { key: 'a', id: 'a', row: 0, rings: [square] },
    { key: 'b', id: 'b', row: 1, rings: [[[100, 0], [110, 0], [110, 10], [100, 10]]] },
  ];
  const near = matchToMassing(G, outlines, [{ id: 'in', x: 5, z: 5 }, { id: 'edge', x: 12, z: 5 }, { id: 'far', x: 60, z: 5 }]);
  assert.equal(near.matches.get(near.matches.keys().next().value).id, 'a');
  assert.equal(near.inside, 1);
  assert.equal(near.within, 1);
  assert.equal(near.unmatched, 1);
});

test('two overlapping outlines: the lower row wins a point inside both', () => {
  const outlines = [
    { key: 'b', id: 'b', row: 9, rings: [square] },
    { key: 'a', id: 'a', row: 3, rings: [[[2, 2], [12, 2], [12, 12], [2, 12]]] },
  ];
  const r = matchToMassing(G, outlines, [{ id: 'p', x: 5, z: 5 }]);
  const m = [...r.matches.values()][0];
  assert.equal(m.row, 3);
});

test('countInside counts points per outline and gives a shared point to the nearest centre', () => {
  const outlines = [
    { key: 'a', row: 0, rings: [square] },
    { key: 'b', row: 1, rings: [[[6, 0], [16, 0], [16, 10], [6, 10]]] },
  ];
  const counts = countInside(G, outlines, [{ x: 1, z: 5 }, { x: 2, z: 5 }, { x: 14, z: 5 }, { x: 50, z: 50 }]);
  assert.equal(counts.get('a'), 2);
  assert.equal(counts.get('b'), 1);
});

test('countPolygonsCentredInside counts a polygon once, at its centre', () => {
  const outlines = [{ key: 'a', row: 0, rings: [square] }];
  const crossing = { ring: [[-20, 4], [30, 4], [30, 6], [-20, 6]] }; // centre 5,5: inside
  const outside = { ring: [[40, 40], [50, 40], [50, 50], [40, 50]] };
  const counts = countPolygonsCentredInside(G, outlines, [crossing, outside]);
  assert.equal(counts.get('a'), 1);
  assert.deepEqual(centroid(square), [5, 5]);
});

test('the committed massing sidecar matches the geodata and the frame', async () => {
  const outlines = await loadMassing(G);
  assert.equal(outlines.length, 35254);
  assert.ok(outlines.every((o) => o.key && o.rings[0].length >= 3));
  const r = matchToMassing(G, outlines, G.buildings.map((b, i) => ({ id: i, x: b[0], z: b[1] })));
  assert.ok(r.matched > 35200, `only ${r.matched} row centres matched an outline`);
  assert.equal(r.inside / r.matched > 0.98, true);
});

test('the era windows are six and contiguous from 1834 to 2100', () => {
  for (let i = 1; i < ERAS.length; i++) assert.equal(ERAS[i].from, ERAS[i - 1].to + 1);
  assert.equal(eraOf(1880), 'Victorian');
  assert.equal(eraOf(1910), 'Edwardian');
  assert.equal(eraOf(1935), 'Interwar');
  assert.equal(eraOf(1951), 'Postwar');
  assert.equal(eraOf(1972), 'Late postwar');
  assert.equal(eraOf(2019), 'New build');
  assert.equal(eraOf(null), 'unknown');
});

test('a construction string gives its later year; an OSM date its first', () => {
  assert.equal(hYear('1914'), 1914);
  assert.equal(hYear('1910 (circa)'), 1910);
  assert.equal(hYear('1873-1874'), 1874);
  assert.equal(hYear('1903-1913 (circa)'), 1913);
  assert.equal(hYear(''), null);
  assert.equal(hYear('unknown'), null);
  assert.equal(osYear('1893'), 1893);
  assert.equal(osYear('2003-04-01'), 2003);
  assert.equal(osYear('2018-04'), 2018);
  assert.equal(osYear('~1886'), 1886);
  assert.equal(osYear(null), null);
});

test('an address key folds the full street name to the permit fields', () => {
  assert.equal(addressKey('4434', 'Kingston Road'), addressKey('4434', 'KINGSTON RD'));
  assert.equal(addressKey('286', 'Finch Avenue West'), addressKey('286', 'FINCH AVE W'));
  assert.notEqual(addressKey('4434', 'Kingston Road'), addressKey('4436', 'Kingston Road'));
});
