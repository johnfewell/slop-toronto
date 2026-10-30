import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildPoles, SHIPPED } from '../tools/build-poles.mjs';

const context = { window: { CITY: { TSL: {} } }, location: { search: '' } };
for (const file of ['toronto-geodata', 'toronto-traffic-data', 'city-config', 'toronto-poles', 'mapped-poles'])
  vm.runInNewContext(fs.readFileSync(new URL(`../js/${file}.js`, import.meta.url), 'utf8'), context);
const C = context.window.CITY;
const { LIGHT, LIGHT_SIGNAL, SIGNAL } = C.POLE_TYPES;

const feature = (OBJECTID, code, desc, [lat, lon]) => ({ type: 'Feature',
  properties: { OBJECTID, SUBTYPE_CODE: code, SUBTYPE_DESC: desc, DERIVED_HEIGHT: 'None' },
  geometry: { type: 'MultiPoint', coordinates: [[lon, lat]] } });

test('the pole build keeps the modelled types, counts the rest and clips to the detail frame', () => {
  const fixture = { features: [
    feature(7, 6006, 'Street Light Pole', [43.6487, -79.3959]),
    feature(3, 6006, 'Street Light Pole', [43.6488, -79.3960]),
    feature(9, 6004, 'Pedestrian Light Pole', [43.6400, -79.3800]),
    feature(11, 6008, 'Traffic Signal Pole', [43.7700, -79.2000]) // Scarborough: outside the frame
  ] };
  const data = buildPoles(fixture, C.GEO.frame, { package: 'x' });
  assert.deepEqual(JSON.parse(JSON.stringify(data.counts)), { 6006: 2, 6004: 1 });
  assert.deepEqual(data.shipped, SHIPPED);
  assert.deepEqual(data.types[6006].ids, [3, 4]); // ascending OBJECTIDs as deltas
  assert.equal(data.types[6006].xz.length, 4);
  assert.equal(data.types[6008].ids.length, 0);
  assert.throws(() => buildPoles({ features: [fixture.features[0], fixture.features[0]] }, C.GEO.frame, {}), /duplicate/);
  assert.throws(() => buildPoles({ features: [feature(1, 6002, 'Mystery Pole', [43.6487, -79.3959])] }, C.GEO.frame, {}), /Unknown pole subtype/);
  assert.throws(() => buildPoles({ features: [feature(1, 6006, 'Traffic Signal Pole', [43.6487, -79.3959])] }, C.GEO.frame, {}), /Unknown pole subtype/);
});

test('the shipped layer is the reviewed 2026-02-20 snapshot with its provenance', () => {
  const P = C.POLES;
  assert.equal(P.source.resourceId, '5504d484-1bd6-4330-b43c-d562b74a175d');
  assert.equal(P.source.sha256, '1b4722aadff160569874c587ce918469850831e86ea72765f119689c4557b8ec');
  assert.equal(P.source.licence, 'open-government-licence-toronto');
  assert.deepEqual(JSON.parse(JSON.stringify(P.counts)), { 6001: 3, 6003: 7171, 6004: 1901, 6005: 1566, 6006: 26375, 6008: 1518 });
  for (const code of SHIPPED) assert.equal(P.types[code].xz.length, 2 * P.counts[code]);
  // pedestrian lights, utility poles and hydro towers have no model: not shipped
  assert.deepEqual(Object.keys(P.types).map(Number).sort(), [LIGHT_SIGNAL, LIGHT, SIGNAL].sort());
});

test('mapped poles stand on the curb islands, off the flyovers, their arms towards the road', () => {
  const { sites, rejected, nudged } = C.mappedPoleSites(C.POLES, C);
  const shipped = SHIPPED.reduce((n, c) => n + C.POLES.counts[c], 0);
  assert.equal(sites.length + rejected.roadway + rejected.deck, shipped);
  assert.ok(sites.length > shipped * 0.9, `${sites.length} of ${shipped} placed`);
  assert.ok(nudged < shipped * 0.12);
  assert.equal(new Set(sites.map((s) => `${s.type}:${s.id}`)).size, sites.length);
  for (const s of sites) {
    assert.ok(C.blockAt(s.x, s.z), `pole ${s.id} off the curb`);
    assert.ok(C.deckHeightAt(s.x, s.z, 1000) <= 1);
    assert.ok(Math.abs(Math.hypot(s.ax, s.az) - 1) < 1e-6);
    if (s.road && !s.median && s.toRoad > 0.3) assert.ok((s.road.px - s.x) * s.ax + (s.road.pz - s.z) * s.az > 0);
  }
  // Queen & Spadina (aerial-checked 2025): the combined light & signal poles on its corners
  const qs = C.worldFromLatLon(43.64867, -79.39592);
  const corner = sites.filter((s) => s.type === LIGHT_SIGNAL && Math.hypot(s.x - qs.x, s.z - qs.z) < 35);
  assert.ok(corner.length >= 3, `${corner.length} light & signal poles at Queen & Spadina`);
});

test('the pole index answers the nearest pole of the wanted types, honouring the filter', () => {
  const idx = C.poleIndex([{ id: 1, type: LIGHT, x: 0, z: 0 }, { id: 2, type: SIGNAL, x: 3, z: 0 }, { id: 3, type: SIGNAL, x: -2, z: 0 }]);
  assert.equal(idx.nearest(0.5, 0, 5).id, 1);
  assert.equal(idx.nearest(0.5, 0, 5, [SIGNAL]).id, 3);
  assert.equal(idx.nearest(0.5, 0, 5, [SIGNAL], (s) => s.x > 0).id, 2);
  assert.equal(idx.nearest(40, 0, 5), null);
});
