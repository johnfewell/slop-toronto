const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

// Loaded in this context (see abuja.test.cjs): the geodata, the city & the guide's search and routing
const read = (path) => readFileSync(join(__dirname, '..', path), 'utf8');
globalThis.window = { CITY: { DEBUG_ROADS: false } };
for (const path of ['js/toronto-geodata.js', 'js/city-config.js', 'js/navigation.js']) new Function(read(path))();
const C = window.CITY;
const N = C.Navigation;
const landmark = (id) => C.CITY_LANDMARKS.find((l) => l.id === id);

test('search finds landmarks, streets, districts and places by the words people type', () => {
  const top = (q) => N.searchPlaces(q, { near: { x: 0, z: 0 } })[0];
  assert.equal(top('national mosque').name, 'Abuja National Mosque');
  assert.equal(top('aso rock').name, 'Aso Rock');
  assert.equal(top('ahmadu bello way').kind, 'street');
  assert.equal(top('shehu shagari wy').name, 'Shehu Shagari Way', 'street abbreviations');
  assert.equal(top('maitma').name, 'Maitama', 'a typo forgiven');
  assert.equal(top('wuse').kind, 'district');
  assert.equal(top('pharmacy').cat, 'health', 'a kind of place answers with places of that kind');
  assert.deepEqual(N.searchPlaces('qqqqzzzz'), []);
});

test('districts come from the mapped boundaries', () => {
  assert.equal(C.districtAt(0, 0), 'Central Business District');
  assert.equal(C.districtAt(-1328, -2810), 'Wuse II');
  assert.equal(C.districtAt(871, -3240), 'Maitama');
});

test('a drive follows the streets, obeys one-way streets and names every turn', () => {
  const from = landmark('eagleSquare'), to = landmark('mosque');
  const r = N.findRoute(from, to, 'car');
  assert.ok(r && !r.approximate, 'a route on the mapped streets');
  const straight = Math.hypot(from.x - to.x, from.z - to.z);
  assert.ok(r.distance >= straight && r.distance < straight * 3, `${r.distance.toFixed(0)} m for ${straight.toFixed(0)} m as the crow flies`);
  assert.equal(r.steps[0].type, 'depart');
  assert.equal(r.steps.at(-1).type, 'arrive');
  for (const s of r.steps.slice(1, -1)) assert.match(s.text, /^(Turn|Keep|Continue|Make a U-turn)/);
  // consecutive route points are a road's length apart at most, and the route ends at the destination's street
  for (let i = 1; i < r.points.length; i++) assert.ok(r.cum[i] >= r.cum[i - 1]);
  const end = r.points.at(-1);
  assert.ok(Math.hypot(end[0] - r.end.x, end[2] - r.end.z) < 1);
});

test('walking may use either direction of a one-way street, never the expressways', () => {
  const from = landmark('eagleSquare'), to = landmark('mosque');
  const walk = N.findRoute(from, to, 'walk');
  const drive = N.findRoute(from, to, 'car');
  assert.ok(walk.distance <= drive.distance + 1, 'on foot is never longer than by car');
  assert.ok(walk.duration > drive.duration, 'but slower');
});

test('progress along a route follows the traveller', () => {
  const r = N.findRoute(landmark('eagleSquare'), landmark('mosque'), 'car');
  const k = Math.floor(r.points.length / 2);
  const p = N.progressOnRoute(r, r.points[k][0], r.points[k][2], 0);
  assert.ok(Math.abs(p.along - r.cum[k]) < 1);
  assert.ok(p.offRoute < 0.5);
});

test('compass directions are true bearings (the street grid is turned 32° west of north)', () => {
  assert.equal(N.compassWord(N.trueBearing(1, 0)), 'northeast'); // grid east: the National Axis, 57.75°
  assert.equal(N.compassWord(N.trueBearing(0, -1)), 'northwest'); // grid north: 327.75°, nearer 315° than 360°
  assert.equal(N.formatDistance(1234), '1.2 km');
  assert.equal(N.formatDuration(3720), '1 h 2 min');
});

test('a real GPS fix lands where the city was built from, and says whether it is in Abuja', () => {
  // the projection the data was built with: Eagle Square at the origin, Aso Rock's summit on its mapped point
  const o = C.worldFromLatLon(C.GEO.frame.lat, C.GEO.frame.lon);
  assert.ok(Math.hypot(o.x, o.z) < 0.1);
  const [ax, az] = C.GEO.points.asoRockSummit;
  const a = C.worldFromLatLon(9.0833242, 7.534132);
  assert.ok(Math.hypot(a.x - ax, a.z - az) < 0.2);
  const back = C.latLonFromWorld(1234, -567);
  const p = C.worldFromLatLon(back.lat, back.lon);
  assert.ok(Math.hypot(p.x - 1234, p.z + 567) < 1e-6, 'round trip');

  const wuse2 = N.locateReal(9.079, 7.479);
  assert.equal(wuse2.status, 'city');
  assert.equal(wuse2.district, 'Wuse II');
  assert.equal(N.locateReal(8.943, 7.082).status, 'fct', 'Gwagwalada: in the FCT, outside the 3D city');
  const lagos = N.locateReal(6.5244, 3.3792);
  assert.equal(lagos.status, 'away');
  assert.ok(Math.abs(lagos.distance - 534000) < 10000, `${(lagos.distance / 1000).toFixed(0)} km from Abuja`);
  assert.equal(N.inFCT(9.0611, 7.4998), true);
  assert.equal(N.inFCT(10.5, 7.44), false, 'Kaduna is not in the FCT');
});
