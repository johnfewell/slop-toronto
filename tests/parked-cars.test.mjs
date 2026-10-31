// The cars parked at Toronto's curbs (docs/parked-cars.md): js/parking-layout.js's rules on a synthetic street (hydrants,
// intersections, crossings, bikeways, streetcar tracks, CaféTO platforms, the traffic lanes, the by-laws, paid parking
// on an arterial), the by-law parser, the committed data scripts against their builds, and the placed cars' invariants
// on the real city (off the traffic lanes, the tracks, the bikeways and the patios; 3 m from every hydrant; none on
// King Street between Bathurst and Jarvis, where the curb lane is the streetcar's), and the packed layer in
// data/toronto-geodata.bin decoding to exactly the cars the build placed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildParking, inForce, loadGeo, newest, parkingJs, parseBetween } from '../tools/build-parking.mjs';
import { buildParkedCars, loadParkedCodec, loadParkingWorld, packParkedCars, parkedCarsJs, parkingDeps, PARKED_JS } from '../tools/build-parked-cars.mjs';
import { unpackGeo } from '../js/geodata-loader.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

// the layout alone, in a fresh context
const L = (() => {
  const c = vm.createContext({ window: { CITY: {} } });
  vm.runInContext(read('js/parking-layout.js'), c);
  return c.window.CITY;
})();

// A straight two-way street along +x at z = 0 (the +z curb is to the right of +x, so its traffic runs toward +x), its
// curbs `half` m out, islands from x = -140 to 140 with cross streets 20 m wide beyond, lanes 1.8 m each side
function street({ half = 6.5, rank = 1, lanes = [1.8, -1.8], extra = {}, dir = 0 } = {}) {
  const blocks = [{ id: 1, median: false }, { id: 2, median: false }, { id: 3, median: false }, { id: 4, median: false }];
  const blockAt = (x, z) => {
    if (Math.abs(z) < half) return null;
    if (Math.abs(x) <= 140) return z > 0 ? blocks[0] : blocks[1];
    if (Math.abs(x) >= 160) return z > 0 ? blocks[2] : blocks[3];
    return null; // (the cross streets)
  };
  return {
    roads: [{ name: 'Test Street', w: 2 * half, dir, rank, raised: false, cls: rank >= 3 ? 'secondary' : 'residential',
      pts: [{ x: -200, z: 0 }, { x: 200, z: 0 }] }],
    blockAt, lanes: lanes.map((o) => [-200, o, 200, o]), ...extra
  };
}
const south = (r) => r.stalls.filter((s) => s.nz > 0); // the +z curb ("south": +z is south in the game's frame)
const north = (r) => r.stalls.filter((s) => s.nz < 0);
const rectDist = (r, x, z) => {
  const dx = x - r.cx, dz = z - r.cz;
  return Math.hypot(Math.max(0, Math.abs(dx * r.tx + dz * r.tz) - r.hl), Math.max(0, Math.abs(dx * r.nx + dz * r.nz) - r.hd));
};

test('a plain local street is parked on both curbs, clear of the lanes and 9 m from the intersections', () => {
  const out = L.parkingStalls(street());
  for (const side of [south(out), north(out)].map((l) => l.filter((s) => Math.abs(s.x) < 140))) {
    assert.ok(side.length >= 35 && side.length <= 41, `${side.length} stalls on a 262 m curb`);
    for (const s of side) {
      assert.ok(Math.abs(s.rect.cx) + s.rect.hl <= 140 - 9 + 1e-6, `stall at x = ${s.rect.cx.toFixed(1)} keeps 9 m from the corner`);
      for (const l of [1.8, -1.8]) assert.ok(L.parkingSegRectDist([-200, l, 200, l], s.rect) >= 1.5 - 1e-9, 'a lane centre keeps 1.5 m');
    }
  }
  assert.equal(south(out)[0].cat, 'local');
  assert.deepEqual(L.parkingStalls(street()).stalls.map((s) => [s.x, s.z]), out.stalls.map((s) => [s.x, s.z]), 'deterministic');
  // the cars face the way the curb lane's traffic runs (right-hand traffic)
  assert.ok(south(out).every((s) => s.tx > 0.99) && north(out).every((s) => s.tx < -0.99));
});

test('a narrow two-way street has no room beside its lanes; a one-way street with its lane in the middle has', () => {
  const narrow = L.parkingStalls(street({ half: 4 }));
  assert.equal(narrow.stalls.length, 0);
  assert.ok(narrow.rejected.lane > 0);
  const oneWay = L.parkingStalls(street({ half: 4, lanes: [0], dir: 1 }));
  assert.ok(south(oneWay).length > 30 && north(oneWay).length > 30, 'a 3.9 m one-way lane leaves both curbs (Euclid, Palmerston)');
});

test('3 m from a hydrant, clear of crossings by the direction of travel, and of a CaféTO platform', () => {
  const hydrants = [{ x: 0, z: 6.7 }];
  const h = L.parkingStalls(street({ extra: { hydrants } }));
  assert.ok(h.rejected.hydrant > 0);
  for (const s of south(h)) assert.ok(rectDist(s.rect, 0, 6.7) >= 3, `stall ${s.rect.cx.toFixed(1)} is 3 m from the hydrant`);
  // a crossover at x = 40: 15 m clear approaching it (the +z curb's traffic runs toward +x), 9 m beyond
  const c = L.parkingStalls(street({ extra: { crossings: [{ x: 40, z: 0 }] } }));
  for (const s of south(c)) {
    const ahead = 40 - (s.rect.cx + s.rect.hl), behind = (s.rect.cx - s.rect.hl) - 40;
    assert.ok(ahead >= 15 || behind >= 9, `stall at ${s.rect.cx.toFixed(1)} keeps clear of the crossover`);
  }
  for (const s of north(c)) { // (the other curb's traffic runs toward -x: 15 m clear on the +x side of the crossing)
    const ahead = (s.rect.cx - s.rect.hl) - 40, behind = 40 - (s.rect.cx + s.rect.hl);
    assert.ok(ahead >= 15 || behind >= 9);
  }
  const patio = { cx: 60, cz: 5.4, tx: 1, tz: 0, nx: 0, nz: 1, length: 7, depth: 1.8 };
  const p = L.parkingStalls(street({ extra: { patios: [patio] } }));
  assert.ok(p.rejected.patio > 0);
  for (const s of south(p)) assert.ok(Math.abs(s.rect.cx - 60) >= s.rect.hl + 3.5 + 1, 'a metre from the platform');
});

test('never on a bikeway or a streetcar track, nor in a TTC stop zone', () => {
  const bike = L.parkingStalls(street({ extra: { bikewayAt: (x, z) => z > 4.8 } }));
  assert.equal(south(bike).length, 0, 'a curbside bike lane holds no parked car');
  assert.ok(north(bike).length > 30);
  // the streetcar in the curb lane (King, Queen): a track 3.5 m out leaves no room
  const rail = L.parkingStalls(street({ extra: { railDist: (x, z) => Math.abs(z - 3.5) } }));
  assert.equal(south(rail).length, 0);
  assert.ok(rail.rejected.streetcar > 0 && north(rail).length > 30);
  const stop = L.parkingStalls(street({ extra: { stops: [{ x: 0, z: 8 }] } }));
  for (const s of south(stop)) {
    const ahead = 0 - (s.rect.cx + s.rect.hl), behind = (s.rect.cx - s.rect.hl) - 0;
    assert.ok(ahead >= 30 || behind >= 18, 'the stop zone: 30 m approaching, 18 m beyond');
  }
});

test('beside a curbside cycle track: floating beyond it on the listed streets only, the curb clear elsewhere', () => {
  // a 2.4 m cycle track reserve (track, separator and 0.1 m) against the +z curb, 9 m out
  const track = (x, z) => z > 9 - 2.4 && z < 9;
  const extra = { bikewayAt: track, trackAt: track };
  assert.ok(!L.PARKING_RULES.floatingStreets.includes('Test Street'));
  assert.deepEqual([...L.PARKING_RULES.floatingStreets], ['Danforth Avenue', 'Bloor Street West', 'Bloor Street East']);
  const off = L.parkingStalls(street({ half: 9, extra }));
  assert.equal(south(off).length, 0, 'an unlisted street: no stall beside its cycle track');
  assert.ok(off.rejected.bikeway > 0 && north(off).length > 30);
  const on = L.parkingStalls(street({ half: 9, extra: { ...extra, rules: { floatingStreets: ['Test Street'] } } }));
  assert.ok(south(on).length > 30, `${south(on).length} floating stalls`);
  for (const s of south(on)) {
    assert.ok(Math.abs(s.track - 2.4) < 0.06, `the track's reach ${s.track}`);
    // the stall's curb side 0.1 m beyond the track's reserve
    assert.ok(Math.abs(s.rect.cz + s.rect.hd - (9 - s.track - 0.1)) < 1e-6);
  }
  assert.equal(on.stats.floating, south(on).length);
  assert.deepEqual(north(on).map((s) => s.x), north(off).map((s) => s.x), 'the far curb unchanged');
});

test('the by-laws decide: a no-parking side, a reserved curb, an arterial kept clear unless paid or restricted parking', () => {
  const parking = (rules) => ({ names: ['Test Street'], rules, permitAreas: [] });
  // no parking anytime on the south side (bit 2) all along
  const deny = L.parkingStalls(street({ extra: { parking: parking([[0, 2, -200, 0, 200, 0, 0, '950-13']]) } }));
  assert.equal(south(deny).length, 0);
  assert.ok(north(deny).length > 30 && deny.rejected.bylaw > 0);
  const reserved = L.parkingStalls(street({ extra: { parking: parking([[2, 15, -20, 0, 20, 0, 0, '950-06']]) } }));
  assert.ok(reserved.rejected.reserved > 0);
  for (const s of reserved.stalls) assert.ok(Math.abs(s.rect.cx) > 20, 'a loading zone holds no parked car');
  // an arterial: clear by default (the rush-hour routes)...
  assert.equal(L.parkingStalls(street({ rank: 3 })).stalls.length, 0);
  // ...parked on a Toronto Parking Authority zone's stretch (machines at x = -30 and 30: 60 m beyond them)...
  const paid = L.parkingStalls(street({ rank: 3, extra: { payStations: [{ x: -30, z: 8, zone: '1' }, { x: 30, z: -8, zone: '1' }], nearestRoad: () => 'Test Street' } }));
  assert.ok(paid.stalls.length > 20 && paid.stalls.every((s) => s.cat === 'paid' && Math.abs(s.x) < 90 + 3.2));
  // ...or where a by-law allows restricted-period parking, unless a prohibition covers it too
  const restricted = L.parkingStalls(street({ rank: 3, extra: { parking: parking([[1, 15, -100, 0, 100, 0, 0, '950-15'], [0, 1, -100, 0, 100, 0, 0, '950-14']]) } }));
  assert.ok(south(restricted).length > 20 && south(restricted).every((s) => s.cat === 'restricted'));
  assert.equal(north(restricted).length, 0, 'no stopping (bit 1, north) wins over restricted-period parking');
});

test('the by-law text: in force on a weekday 7 a.m.-7 p.m. on 22 August, and the stretch between its two ends', () => {
  assert.equal(inForce('Anytime'), true);
  assert.equal(inForce('7:30 a.m. to 9:30 a.m. and 3:30 p.m. to 6:30 p.m., Mon. to Fri., except public holidays'), true, 'rush hour');
  assert.equal(inForce('2:00 a.m. to 4:00 a.m.'), false, 'overnight only');
  assert.equal(inForce('Anytime, from Dec. 1 of one year to Mar. 31 of the next following year, inclusive'), false, 'winter');
  assert.equal(inForce('First day to the 15th day of each month, from Apr. 1 to Nov. 30, inclusive'), false, 'alternate side');
  assert.equal(inForce('16th day to the last day of each month, from Apr. 1 to Nov. 30, inclusive'), true);
  assert.equal(inForce('Anytime from Fri. Aug. 19, 2022 to Mon. Sept. 5, 2022, inclusive'), false, 'a dated event');
  assert.equal(inForce('12:00 noon to 6:00 p.m., Sat. and Sun.'), false, 'weekends only');
  assert.deepEqual(parseBetween('A point 45.7 metres north of Robinson Street and a point 76.2 metres north'),
    [{ type: 'offset', dist: 45.7, further: false, dir: 'north', ref: 'Robinson Street' }, { type: 'offset', dist: 76.2, further: false, dir: 'north', ref: null }]);
  assert.deepEqual(parseBetween('Bloor Street West and the lane first south of Bloor Street West'),
    [{ type: 'street', ref: 'Bloor Street West' }, { type: 'lane', dir: 'south', ref: 'Bloor Street West' }]);
  assert.deepEqual(parseBetween('Dell Park Avenue (east intersection) and Bathurst Street'),
    [{ type: 'street', ref: 'Dell Park Avenue', qual: 'east' }, { type: 'street', ref: 'Bathurst Street' }]);
  assert.deepEqual(parseBetween('A point 50 metres south of King Street to Adelaide Street West')[1], { type: 'street', ref: 'Adelaide Street West' });
});

test('js/toronto-parking.js is the build of the dated by-law and permit area snapshots', () => {
  const bylaws = JSON.parse(fs.readFileSync(newest('parking-bylaws-'), 'utf8'));
  const permits = JSON.parse(fs.readFileSync(newest('permit-parking-'), 'utf8'));
  assert.ok(bylaws.source.sha256 && bylaws.source.licence && bylaws.records.length > 5000);
  assert.ok(permits.areas.length > 40);
  const PARKING = buildParking({ bylaws, permits, GEO: loadGeo() });
  assert.equal(parkingJs(PARKING), read('js/toronto-parking.js'), 'rebuild: node tools/build-parking.mjs');
  assert.ok(PARKING.rules.length > 4000 && PARKING.counts.noParking > 3000 && PARKING.counts.allowed > 500);
});

// the real city: built once for the tests below
let built = null;
const city = () => (built ||= (() => {
  const world = loadParkingWorld();
  const placed = buildParkedCars(world);
  return { world, placed, PARKED: placed.PARKED, stalls: placed.stalls, deps: parkingDeps(world.CITY) };
})());

test('js/toronto-parked-cars.js is the build of the committed data scripts', () => {
  const { PARKED, placed } = city();
  assert.equal(parkedCarsJs(packParkedCars(placed)), read(PARKED_JS), 'rebuild: node tools/build-parked-cars.mjs');
  const n = PARKED.counts;
  assert.ok(n.cars > 8000 && n.cars < 14000, `${n.cars} parked cars`);
  for (const cat of ['paid', 'restricted', 'permit', 'local']) assert.ok(n.carsBy[cat] > 500, `${cat}: ${n.carsBy[cat]}`);
  for (const kind of ['sedan', 'suv', 'minivan', 'pickup', 'van']) assert.ok(n.kinds[kind] > 300, `${kind}: ${n.kinds[kind]}`);
});

test('the binary\'s parked cars decode to exactly the cars the build placed, and only the stalls are stored', async () => {
  const { PARKED } = city();
  const { PARKED_CARS } = await unpackGeo(fs.readFileSync(new URL('../data/toronto-geodata.bin', import.meta.url)));
  const { decodeParkedCars } = loadParkedCodec();
  const cars = decodeParkedCars(PARKED_CARS);
  assert.equal(cars.length, PARKED.cars.length);
  // the same doubles, every field of every car: the same placement, on every tier (order decides a tier's share)
  assert.equal(JSON.stringify(cars), JSON.stringify(PARKED.cars));
  // the comparison sees a change: one car's correction, and the seeded draw behind it
  const moved = { ...PARKED_CARS, cx: PARKED_CARS.cx.map((v, i) => (i === 123 ? v + 1 : v)) };
  assert.notEqual(JSON.stringify(decodeParkedCars(moved)[123]), JSON.stringify(PARKED.cars[123]));
  const shifted = { ...PARKED_CARS, cat: PARKED_CARS.cat.map((v) => (v + 1) % 4) };
  assert.notEqual(JSON.stringify(decodeParkedCars(shifted)), JSON.stringify(PARKED.cars));
  // the layer is the stalls: what a seed gives (kind, paint, style, order) is not in it
  assert.deepEqual(Object.keys(PARKED_CARS), ['generator', 'counts', 'cat', 'heading', 'side', 'major', 'minor', 'cx', 'cz', 'cy']);
  for (const col of ['cx', 'cz']) assert.ok(PARKED_CARS[col].every((v) => Math.abs(v) <= 2), `${col}: corrections of a cm or two`);
});

test('decoding parked cars never touches Math.sin & co, which may differ by an ulp between browsers', () => {
  const src = read('js/parked-cars.js');
  const codec = src.slice(src.indexOf('const KINDS = '), src.indexOf('const { THREE, BODY_SPECS'));
  assert.ok(codec.includes('function decodeParkedCars'));
  assert.doesNotMatch(codec, /Math\.(sin|cos|tan|asin|acos|atan2?|exp|log\d*|pow|hypot|cbrt)\b/);
});

test('on the real city: clear of the lanes, tracks, bikeways, hydrants and patios, and of each other', () => {
  const { stalls, deps, PARKED } = city();
  const F = Object.fromEntries(PARKED.fields.map((k, i) => [k, i]));
  // lanes: the stall 1.5 m from every lane centre, each car's body 1.3 m (what the page's audit asks)
  const LG = 24, grid = new Map();
  for (const s of deps.lanes) {
    for (let i = Math.floor((Math.min(s[0], s[2]) - 4) / LG); i <= Math.floor((Math.max(s[0], s[2]) + 4) / LG); i++) {
      for (let j = Math.floor((Math.min(s[1], s[3]) - 4) / LG); j <= Math.floor((Math.max(s[1], s[3]) + 4) / LG); j++) {
        const k = i * 100003 + j;
        (grid.get(k) || grid.set(k, []).get(k)).push(s);
      }
    }
  }
  const lanesAt = (x, z) => grid.get(Math.floor(x / LG) * 100003 + Math.floor(z / LG)) || [];
  for (const s of stalls) {
    for (const l of lanesAt(s.x, s.z)) assert.ok(L.parkingSegRectDist(l, s.rect) >= 1.5 - 1e-9, `stall at ${s.x.toFixed(1)}, ${s.z.toFixed(1)} is in a lane's way`);
    for (const h of deps.hydrants) if (Math.abs(h.x - s.x) < 8 && Math.abs(h.z - s.z) < 8) assert.ok(rectDist(s.rect, h.x, h.z) >= 3, 'a hydrant 3 m clear');
    assert.ok(deps.railDist(s.x, s.z) >= 1.8, 'off the streetcar tracks');
    assert.ok(!deps.bikewayAt(s.x, s.z), 'off the bikeways');
  }
  const BODY = { sedan: [2.25, 0.95], suv: [2.34, 0.97], minivan: [2.59, 0.97], pickup: [2.84, 1.0], van: [2.94, 0.98] };
  const cars = PARKED.cars.map((c) => {
    const [hl, hw] = BODY[PARKED.kinds[c[F.kind]]];
    return { cx: c[F.x], cz: c[F.z], tx: Math.sin(c[F.yaw]), tz: Math.cos(c[F.yaw]), nx: Math.cos(c[F.yaw]), nz: -Math.sin(c[F.yaw]), hl, hd: hw };
  });
  let near = 0;
  for (const c of cars) for (const l of lanesAt(c.cx, c.cz)) near = Math.min(near || Infinity, L.parkingSegRectDist(l, c));
  assert.ok(near >= 1.3, `the closest car body is ${near.toFixed(2)} m from a lane centre`);
  // the CaféTO curb lane platforms (1 m clear)
  for (const p of deps.patios) {
    for (const c of cars) {
      if (Math.abs(c.cx - p.cx) > 12 || Math.abs(c.cz - p.cz) > 12) continue;
      const d = Math.abs((c.cx - p.cx) * p.tx + (c.cz - p.cz) * p.tz) - p.length / 2 - c.hl;
      assert.ok(d >= 0.5 || Math.abs((c.cx - p.cx) * p.nx + (c.cz - p.cz) * p.nz) > p.depth / 2 + c.hd + 0.5, 'clear of a CaféTO platform');
    }
  }
  // no two cars overlap (separating axes)
  const cell = new Map();
  for (const c of cars) { const k = Math.floor(c.cx / 16) * 100003 + Math.floor(c.cz / 16); (cell.get(k) || cell.set(k, []).get(k)).push(c); }
  const overlaps = (a, b) => [[a.tx, a.tz], [a.nx, a.nz], [b.tx, b.tz], [b.nx, b.nz]].every(([ax, az]) => {
    const ra = a.hl * Math.abs(a.tx * ax + a.tz * az) + a.hd * Math.abs(a.nx * ax + a.nz * az);
    const rb = b.hl * Math.abs(b.tx * ax + b.tz * az) + b.hd * Math.abs(b.nx * ax + b.nz * az);
    return Math.abs((b.cx - a.cx) * ax + (b.cz - a.cz) * az) <= ra + rb;
  });
  for (const a of cars) {
    for (let i = Math.floor(a.cx / 16) - 1; i <= Math.floor(a.cx / 16) + 1; i++) for (let j = Math.floor(a.cz / 16) - 1; j <= Math.floor(a.cz / 16) + 1; j++) {
      for (const b of cell.get(i * 100003 + j) || []) if (a !== b) assert.ok(!overlaps(a, b), 'two parked cars overlap');
    }
  }
});

test('where Toronto parks: residential Euclid and Palmerston, paid Roncesvalles, and not King between Bathurst and Jarvis', () => {
  const { stalls } = city();
  const on = (name, f = () => true) => stalls.filter((s) => s.road === name && f(s));
  assert.ok(on('Euclid Avenue').length > 50 && on('Palmerston Avenue').length > 30);
  assert.ok(on('Roncesvalles Avenue', (s) => s.cat === 'paid').length > 40);
  // King Street from Bathurst (x -1727) to Jarvis (x 876): the streetcar's curb lanes (the King Street transit priority
  // corridor: no pay stations, the by-laws' no stopping) hold no parked car
  assert.equal(on('King Street West', (s) => s.x > -1727 && s.x < 876).length + on('King Street East', (s) => s.x < 876).length, 0);
  // the arterials: University and Spadina only where the City's pay stations say so; Bay and Yonge none
  assert.ok(on('University Avenue').every((s) => s.cat === 'paid' || s.cat === 'restricted'));
  assert.ok(on('Spadina Avenue').every((s) => s.cat === 'paid' || s.cat === 'restricted'));
  assert.equal(on('Bay Street').length + on('Yonge Street').length, 0);
});

test('the parked cars load after the traffic; their data comes in the binary; the layout itself never runs in the page; the tiers scale them', () => {
  const html = read('explore.html');
  const i = (f) => html.indexOf(`'./js/${f}'`);
  assert.equal(i('toronto-parked-cars.js'), -1, 'packed in data/toronto-geodata.bin');
  assert.ok(i('parked-cars.js') > i('actor-models.js') && i('parked-cars.js') > i('world-collision.js') && i('parked-cars.js') > i('traffic.js'));
  assert.equal(i('parking-layout.js'), -1);
  assert.equal(i('toronto-parking.js'), -1, 'the by-laws are build input only');
  const q = read('js/quality.js');
  const tier = (t) => Object.fromEntries([...q.match(new RegExp(`\\n  ${t}: \\{[\\s\\S]*?\\n  \\}`))[0].matchAll(/(parked\w+): (\w+)/g)].map((m) => [m[1], m[2]]));
  const [hi, mid, lo] = ['high', 'medium', 'low'].map(tier);
  assert.ok(+hi.parkedCars >= 10775 && +mid.parkedCars < +hi.parkedCars && +lo.parkedCars < +mid.parkedCars, 'fewer on the phone tiers');
  assert.ok(+lo.parkedFar < +hi.parkedFar && +lo.parkedNear < +hi.parkedNear);
  assert.equal(lo.parkedShadows, 'false', 'no parked car shadows on the phone tier');
  assert.match(read('js/main.js'), /buildParkedCars\(scene, trafficSystem\.network/);
  assert.match(read('js/traffic.js'), /network\.parkedAt && network\.parkedAt\(x, z/);
});

test('a parked car\'s lamps are off: the style code\'s parked bit, beside the livery, finish, trim and wheels', () => {
  const window = { CITY: { THREE, TSL, Addons: { mergeGeometries, mergeVertices }, cityUniforms: {} } };
  vm.runInNewContext(read('js/actor-models.js'), { window, Math, console });
  const { carStyleCode } = window.CITY;
  const s = { livery: 4, metallic: 1, trim: 2, wheel: 3 };
  assert.equal(carStyleCode({ ...s, parked: true }), carStyleCode(s) + 256);
  assert.ok(carStyleCode(s) < 256, 'the moving fleet never sets it');
  // the material decodes the wheel style modulo the parked bit, and multiplies the lamps by lampsOn
  const src = read('js/actor-models.js');
  assert.match(src, /floor\(fract\(floor\(wCode\.div\(64\.0\)\.add\(0\.01\)\)\.mul\(0\.25\)\)\.mul\(4\.0\)\.add\(0\.5\)\)/);
  assert.match(src, /mat\.emissiveNode = emissiveFn\(\)\.mul\(lampsOn\)/);
});

void ROOT;
