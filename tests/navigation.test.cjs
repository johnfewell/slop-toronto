const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

// The committed Toronto geodata, the city & the guide's search and routing, loaded as the page loads them
const read = (path) => readFileSync(join(__dirname, '..', path), 'utf8');
globalThis.window = { CITY: { DEBUG_ROADS: false } };
for (const path of ['js/toronto-geodata.js', 'js/city-config.js', 'js/navigation.js']) new Function(read(path))();
const C = window.CITY;
const N = C.Navigation;
const landmark = (id) => C.CITY_LANDMARKS.find((l) => l.id === id);
const MOTORWAYS = new Set(C.ROADS.filter((r) => r.cls === 'motorway').map((r) => r.name));

test('search finds landmarks, streets, districts and places by the words people type', () => {
  const top = (q) => N.searchPlaces(q, { near: { x: 0, z: 0 } })[0];
  assert.equal(top('cn tower').name, 'CN Tower');
  assert.equal(top('cn tower').kind, 'landmark');
  assert.equal(top('st lawrence market').name, 'St. Lawrence Market');
  assert.equal(top('king st w').kind, 'street');
  assert.equal(top('lake shore blvd w').name, 'Lake Shore Boulevard West', 'street abbreviations');
  assert.equal(top('queens quay w').name, 'Queens Quay West', 'street abbreviations');
  assert.equal(top('royal ontaro museum').name, 'Royal Ontario Museum', 'a typo forgiven');
  assert.equal(top('trinty bellwoods').name, 'Trinity Bellwoods Park', 'a typo forgiven');
  assert.equal(top('kensington market').kind, 'district');
  assert.equal(top('pharmacy').cat, 'health', 'a kind of place answers with places of that kind');
  assert.equal(top('hotel').cat, 'hotel');
  assert.deepEqual(N.searchPlaces('qqqqzzzz'), []);
});

test('districts are the mapped neighbourhoods, not the wards around them', () => {
  // OpenStreetMap's neighbourhood boundaries (admin_level 10, the City's 158 neighbourhoods) contain each of these points;
  // each also lies inside a much larger city ward (admin_level 9, named after its federal riding). The neighbourhood
  // wins (st-c5a), and a compound neighbourhood ('Harbourfront-CityPlace', 'High Park-Swansea') answers with the
  // short name of its nearest district point, as people say it.
  assert.equal(C.districtAt(-1360.5, -1554.5), 'Kensington Market');
  assert.equal(C.districtAt(landmark('rom').x, landmark('rom').z), 'University');
  assert.equal(C.districtAt(landmark('cnTower').x, landmark('cnTower').z), 'CityPlace');
  assert.equal(C.districtAt(landmark('highPark').x, landmark('highPark').z), 'High Park');
  // a ward (Spadina—Fort York, University—Rosedale...) is not a neighbourhood, and never labels a landmark
  for (const l of C.CITY_LANDMARKS) assert.doesNotMatch(l.district, /—/, `${l.name} is labelled with a ward: ${l.district}`);
});

test('a drive follows the streets, obeys one-way streets and names every turn', () => {
  const from = landmark('unionStation'), to = landmark('cityHall');
  const r = N.findRoute(from, to, 'car');
  assert.ok(r && !r.approximate, 'a route on the mapped streets');
  const straight = Math.hypot(from.x - to.x, from.z - to.z);
  assert.ok(r.distance >= straight && r.distance < straight * 3, `${r.distance.toFixed(0)} m for ${straight.toFixed(0)} m as the crow flies`);
  assert.equal(r.steps[0].type, 'depart');
  assert.match(r.steps[0].text, /^Head (north|northeast|east|southeast|south|southwest|west|northwest) on /);
  assert.equal(r.steps.at(-1).type, 'arrive');
  for (const s of r.steps.slice(1, -1)) assert.match(s.text, /^(Turn|Keep|Continue|Make a U-turn)/);
  // consecutive route points are a road's length apart at most, and the route ends at the destination's street
  for (let i = 1; i < r.points.length; i++) assert.ok(r.cum[i] >= r.cum[i - 1]);
  const end = r.points.at(-1);
  assert.ok(Math.hypot(end[0] - r.end.x, end[2] - r.end.z) < 1);
});

test('walking may use either direction of a one-way street, never the expressways', () => {
  for (const [a, b] of [['unionStation', 'cityHall'], ['cnTower', 'stLawrence']]) {
    const from = landmark(a), to = landmark(b);
    const walk = N.findRoute(from, to, 'walk');
    const drive = N.findRoute(from, to, 'car');
    assert.ok(walk && drive, `${a} to ${b}`);
    assert.ok(walk.distance <= drive.distance + 1, 'on foot is never longer than by car');
    assert.ok(walk.duration > drive.duration, 'but slower');
    for (const s of walk.steps) assert.ok(!MOTORWAYS.has(s.street), `walking ${a} to ${b} uses ${s.street}`);
  }
  assert.ok(MOTORWAYS.has('Gardiner Expressway') && MOTORWAYS.has('Don Valley Parkway'), 'the expressways are mapped as motorways');
});

test('progress along a route follows the traveller', () => {
  const r = N.findRoute(landmark('unionStation'), landmark('cityHall'), 'car');
  const k = Math.floor(r.points.length / 2);
  const p = N.progressOnRoute(r, r.points[k][0], r.points[k][2], 0);
  assert.ok(Math.abs(p.along - r.cum[k]) < 1);
  assert.ok(p.offRoute < 0.5);
});

test('compass directions are true bearings (the street grid is turned about 17° west of north)', () => {
  assert.equal(C.GEO.frame.bearingDeg, -16.59);
  assert.ok(Math.abs(N.trueBearing(1, 0) - 73.41) < 1e-9); // grid east: along King & Queen, 73.41°
  assert.equal(N.compassWord(N.trueBearing(1, 0)), 'east');
  assert.ok(Math.abs(N.trueBearing(0, -1) - 343.41) < 1e-9); // grid north: up Yonge, 343.41°
  assert.equal(N.compassWord(N.trueBearing(0, -1)), 'north');
  assert.equal(N.compassWord(N.trueBearing(-1, -1)), 'northwest'); // 298.41°, nearer 315° than 270°
  assert.equal(N.formatDistance(1234), '1.2 km');
  assert.equal(N.formatDuration(3720), '1 h 2 min');
});

test('a real GPS fix lands where the city was built from, and says whether it is in Toronto', () => {
  // the projection the data was built with: Union Station (Front Street) at the origin, the CN Tower on its mapped point
  assert.equal(C.GEO.frame.origin, 'Union Station (Front Street)');
  const o = C.worldFromLatLon(C.GEO.frame.lat, C.GEO.frame.lon);
  assert.ok(Math.hypot(o.x, o.z) < 0.1);
  const [cx, cz] = C.GEO.points.cnTower;
  const cn = C.worldFromLatLon(43.642566, -79.387057);
  assert.ok(Math.hypot(cn.x - cx, cn.z - cz) < 0.2);
  const back = C.latLonFromWorld(1234, -567);
  const p = C.worldFromLatLon(back.lat, back.lon);
  assert.ok(Math.hypot(p.x - 1234, p.z + 567) < 1e-6, 'round trip');

  const kensington = N.locateReal(43.6547, -79.4004);
  assert.equal(kensington.status, 'city');
  assert.equal(kensington.district, C.districtAt(kensington.x, kensington.z));
  assert.match(kensington.label, /Kensington Ave/);
  assert.equal(N.locateReal(43.7764, -79.2318).status, 'fct', 'Scarborough Town Centre: in the City of Toronto, outside the 3D city');
  assert.equal(N.locateReal(43.6205, -79.5132).status, 'fct', 'Etobicoke: in the City of Toronto, outside the 3D city');
  assert.equal(N.locateReal(43.589, -79.6441).status, 'away', 'Mississauga is not Toronto');
  const montreal = N.locateReal(45.5019, -73.5674);
  assert.equal(montreal.status, 'away');
  assert.ok(Math.abs(montreal.distance - 504000) < 10000, `${(montreal.distance / 1000).toFixed(0)} km from Union Station`);
  assert.equal(N.inFCT(43.7, -79.4), true, 'North York is in the City of Toronto');
  assert.equal(N.inFCT(43.589, -79.6441), false, 'Mississauga is not');
});
