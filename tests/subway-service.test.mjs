import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import * as THREE from 'three';
function harness(options = {}) {
  const window = { CITY: { THREE } }, context = vm.createContext({ window });
  for (const f of ['transit-riding', 'subway-service']) vm.runInContext(fs.readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8'), context);
  const C = window.CITY;
  const stations = [{ id: 'castle-frank', name: 'Castle Frank', x: 1787.8, z: -2736.5 }, { id: 'broadview', name: 'Broadview', x: 2736, z: -2859.4 }];
  const bridge = { railY: 16.3, pts: [{ x: 2006.6, z: -2806.3 }, { x: 2240, z: -2800 }, { x: 2474.2, z: -2794 }] };
  const routes = C.buildSubwayRidePaths(stations, bridge);
  return { C, routes, service: C.createSubwayRideService(routes, options) };
}

test('continuous directed tracks join the stations and viaduct with room for six cars', () => {
  const { C, routes } = harness();
  for (const route of routes) {
    assert.ok(route.calls[0] > 141 && route.calls[1] + 70 < route.len);
    assert.ok(route.open0 > route.calls[0] && route.open1 < route.calls[1]);
    assert.ok(route.calls[1] - route.calls[0] > 900);
    for (let s = 0; s <= route.len; s += 5) {
      const p = C.sampleSubwayRide(route, s);
      assert.ok([p.x, p.y, p.z, p.yaw].every(Number.isFinite));
      assert.equal(p.y, 16.3);
    }
    for (const index of [0, 1]) {
      const platform = C.subwayRidePlatform(route, index), station = index ? route.destination : route.origin;
      assert.ok(Math.hypot(platform.centre.x - station.x, platform.centre.z - station.z) < 3);
      const point = platform.constrain(platform.landing, 0.5);
      assert.ok(Math.hypot(point.x - platform.landing.x, point.z - platform.landing.z) < 0.01);
      const edge = platform.constrain({ x: 1e6, z: -1e6 }, 0.5);
      assert.ok(Math.hypot(edge.x - platform.centre.x, edge.z - platform.centre.z) < 81);
    }
  }
  assert.equal(routes[0].origin.id, routes[1].destination.id);
});

test('occupied trains serve the next station, keep doors open and never recycle underneath a rider', () => {
  const { service } = harness({ headway: () => 1 });
  const train = service.cars[0], id = train.id;
  train.ridden = true;
  let previous = train.s, arrived = false;
  for (let i = 0; i < 4000; i++) {
    service.update(0.1);
    assert.ok(train.s >= previous); previous = train.s;
    if (train.doorState !== 'closed') assert.equal(train.speed, 0);
    if (train.stopIndex === 1 && train.doorState === 'open') { arrived = true; break; }
  }
  assert.equal(arrived, true);
  const at = train.s;
  assert.equal(service.prepare(0), null, 'featured rides cannot reset an occupied train');
  for (let i = 0; i < 1000; i++) service.update(0.1);
  assert.equal(train.id, id); assert.equal(train.s, at); assert.equal(train.doorState, 'open');
});

test('an unoccupied return service approaches the platform from its tunnel and defers visible recycling', () => {
  let visible = true;
  const { service } = harness({ headway: () => 1, canRecycle: () => !visible });
  const train = service.cars[1];
  for (let i = 0; i < 3000; i++) service.update(0.1);
  assert.equal(train.k, 2); assert.equal(train.run, 0);
  visible = false;
  for (let i = 0; i < 3; i++) service.update(0.1);
  assert.equal(train.k, 0); assert.equal(train.run, 1);
  assert.ok(train.s < train.track.calls[0] - 150);
  assert.ok(train.s - 141 > 0, 'the entire train starts inside the incoming tunnel');
});

test('bundled Line 2 calls preserve source stop IDs, direction and representative journey times', () => {
  const window = { CITY: { THREE } }, context = vm.createContext({ window, console: { info() {} } });
  for (const f of ['toronto-transit', 'transit']) vm.runInContext(fs.readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8'), context);
  const patterns = window.CITY.TRANSIT.ofType(1).filter((p) => p.route === '2');
  for (const dir of [0, 1]) {
    const pattern = patterns.find((p) => p.dir === dir);
    assert.ok(pattern);
    const from = dir === 0 ? 'Castle Frank' : 'Broadview', to = dir === 0 ? 'Broadview' : 'Castle Frank';
    const a = pattern.stops.findIndex((s) => s.name.includes(from));
    const b = pattern.stops.findIndex((s) => s.name.includes(to));
    assert.ok(a >= 0 && b === a + 1, 'the supported stations are consecutive in both directions');
    assert.ok(pattern.stops[b].time > pattern.stops[a].time);
    assert.ok(/^\d+$/.test(pattern.stops[a].id));
    assert.notEqual(pattern.stops[a].id, pattern.stops[b].id);
  }
});

// The Line 1 track ride (js/toronto-subway-topology.js): Queen ↔ King under Yonge, walked from a street entrance
function trackHarness() {
  const window = { CITY: { THREE } }, context = vm.createContext({ window });
  for (const f of ['toronto-subway-topology', 'transit-riding', 'subway-service']) vm.runInContext(fs.readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8'), context);
  const C = window.CITY, T = C.SUBWAY_TOPOLOGY;
  const ride = T.rides.find((r) => r.id === 'l1-queen-king');
  const stations = ride.stations.map((id) => { const s = T.stations.find((x) => x.id === id); return { id, name: s.name, x: s.x, z: s.z }; });
  const routes = C.buildSubwayTrackPaths(ride, stations);
  return { C, T, ride, stations, routes };
}
// A stairway's opening on the street a few metres from (x, z), going down toward the station
function stairway(station, x, z) {
  const dx = station.x - x, dz = station.z - z, l = Math.hypot(dx, dz);
  return { x, z, tx: dx / l, tz: dz / l };
}

test('the Line 1 ride runs both ways under the street on the mapped track, with its platforms level', () => {
  const { C, routes, stations } = trackHarness();
  assert.equal(routes.length, 2);
  assert.equal(JSON.stringify(routes.map((r) => [r.origin.id, r.destination.id, r.compass])), JSON.stringify([['queen', 'king', 'Southbound'], ['king', 'queen', 'Northbound']]));
  for (const route of routes) {
    assert.ok(route.calls[0] - 141 > 170, 'a recycled train starts wholly in the approach tunnel');
    assert.ok(route.calls[1] + 70 < route.len);
    for (let s = 0; s <= route.len; s += 5) {
      const p = C.sampleSubwayRide(route, s);
      assert.ok([p.x, p.y, p.z, p.yaw].every(Number.isFinite));
      assert.ok(p.y < -10 && p.y > -11, 'rail top 10.6 m below the street the whole way');
    }
    for (const index of [0, 1]) {
      const platform = C.subwayRidePlatform(route, index), station = index ? route.destination : route.origin;
      assert.ok(Math.abs(platform.floor + 9.5) < 1e-9, 'platform floor 9.5 m below the street');
      assert.ok(Math.hypot(platform.centre.x - station.x, platform.centre.z - station.z) < 4, 'the platform is at the station');
    }
    // never in the open: the camera stays on the interior layer, no exterior view underground
    assert.ok(!(route.calls[0] > route.open0 && route.calls[0] < route.open1));
  }
  // right-hand running: the southbound track lies west (smaller x) of the northbound at both stations
  for (const index of [0, 1]) {
    const sb = C.subwayRidePlatform(routes[0], index).centre, nb = C.subwayRidePlatform(routes[1], 1 - index).centre;
    assert.ok(sb.x < nb.x && Math.hypot(sb.x - nb.x, sb.z - nb.z) > 4 && Math.hypot(sb.x - nb.x, sb.z - nb.z) < 5);
  }
  assert.equal(stations[0].id, 'queen');
});

test('an occupied Line 1 train keeps its identity from Queen to King, doors shut while moving, and holds there', () => {
  const { C, routes } = trackHarness();
  for (const dir of [0, 1]) {
    const service = C.createSubwayRideService(routes, { headway: () => 1, duration: () => 74, idPrefix: 'subway-l1-queen-king' });
    const train = service.cars[dir], id = train.id;
    assert.equal(id, `subway-l1-queen-king-${dir}`);
    train.ridden = true;
    let previous = train.s, arrived = false;
    for (let i = 0; i < 4000; i++) {
      service.update(0.1);
      assert.ok(train.s >= previous); previous = train.s;
      if (train.doorState !== 'closed') assert.equal(train.speed, 0);
      for (const section of train.sections) assert.ok(section.y < -10, 'every car stays below the street');
      if (train.stopIndex === 1 && train.doorState === 'open') { arrived = true; break; }
    }
    assert.ok(arrived, `direction ${dir} arrives`);
    assert.equal(train.id, id);
    // the whole consist stands at the destination platform
    const platform = C.subwayRidePlatform(train.track, 1);
    for (const section of train.sections) assert.ok(Math.hypot(section.x - platform.centre.x, section.z - platform.centre.z) < 71);
    for (let i = 0; i < 500; i++) service.update(0.1);
    assert.equal(train.doorState, 'open'); assert.equal(service.prepare(dir), null);
  }
});

test('a walked station joins the street stairway to both platforms through level-matched cells', () => {
  const { C, routes, stations } = trackHarness();
  for (const [index, station] of stations.entries()) {
    const platforms = [0, 1].map((dir) => C.subwayRidePlatform(routes[dir], routes[dir].origin === station ? 0 : 1));
    // a stairway 35 m off the tracks (a corner of the intersection), as js/subway.js places the mapped ones
    const p0 = platforms[0].centre, side = { x: Math.cos(p0.yaw), z: -Math.sin(p0.yaw) };
    const along = { x: Math.sin(p0.yaw), z: Math.cos(p0.yaw) }, k = index ? -1 : 1;
    const opening = { x: p0.x - side.x * 35 + along.x * 20 * k, z: p0.z - side.z * 35 + along.z * 20 * k, tx: along.x * k, tz: along.z * k };
    const layout = C.stationWalkLayout({ platforms, entrance: opening, concourse: -4.5 });
    const space = C.createStationWalk(layout.cells, { floor: platforms[0].floor, platforms });
    assert.equal(layout.underStairs, false);
    // the cells form one connected walk: neighbours overlap where their floors meet (within a step)
    const cells = layout.cells, n = cells.length, linked = Array.from({ length: n }, () => []);
    const probe = (c, u, v) => ({ x: c.cx + Math.cos(c.yaw) * u + Math.sin(c.yaw) * v, z: c.cz - Math.sin(c.yaw) * u + Math.cos(c.yaw) * v });
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const a = cells[i];
      // (a probe in i that cell j also covers, its floor within a step of i's there)
      const b = cells[j], nu = 8, nv = Math.ceil(a.hz / 0.1);
      search: for (let iu = 0; iu <= nu; iu++) for (let iv = 0; iv <= nv; iv++) {
        const u = -a.hx + (2 * a.hx * iu) / nu, v = -a.hz + (2 * a.hz * iv) / nv;
        const p = probe(a, u, v), ya = C.stationCellFloor(a, v);
        const lu = (p.x - b.cx) * Math.cos(b.yaw) - (p.z - b.cz) * Math.sin(b.yaw), lv = (p.x - b.cx) * Math.sin(b.yaw) + (p.z - b.cz) * Math.cos(b.yaw);
        if (Math.abs(lu) > b.hx + 1e-6 || Math.abs(lv) > b.hz + 1e-6) continue;
        const yb = C.stationCellFloor(b, lv);
        if (Math.abs(yb - ya) < 0.35) { linked[i].push(j); break search; }
      }
    }
    const reached = new Set([cells.findIndex((c) => c.kind === 'entrance')]), queue = [...reached];
    while (queue.length) for (const j of linked[queue.shift()]) if (!reached.has(j)) { reached.add(j); queue.push(j); }
    assert.equal(reached.size, n, `${station.id}: every cell reachable from the street stairway`);
    for (const dir of [0, 1]) assert.ok([...reached].some((i) => cells[i].kind === 'platform' && cells[i].dir === dir));
    // the top of the walk is below the street; the floors run from there down to the platforms
    assert.ok(layout.top.y < -2 && layout.top.y > -3);
    assert.ok(Math.abs(space.floorAt(layout.top.x, layout.top.z, layout.top.y) - layout.top.y) < 0.05);
    for (const p of platforms) {
      assert.equal(space.floorAt(p.landing.x, p.landing.z, p.floor), p.floor);
      assert.equal(space.platformAt(p.landing.x, p.landing.z, p.floor), platforms.indexOf(p));
      const kept = space.constrain({ x: p.landing.x + 50, z: p.landing.z, y: p.floor });
      assert.ok(Math.abs(space.floorAt(kept.x, kept.z, p.floor) - p.floor) < 0.01, 'walls hold a walker on the platform');
    }
    // a walker on the concourse level is never dropped onto a platform under it, nor through the floor
    const mezz = cells.find((c) => c.kind === 'mezzanine');
    const above = space.constrain({ x: mezz.cx, z: mezz.cz, y: -4.5 });
    assert.equal(space.floorAt(above.x, above.z, -4.5), -4.5);
    // a stair rises evenly: no step taller than a riser between 10 cm apart
    const st = cells.find((c) => c.kind === 'stair');
    let last = null;
    for (let v = -st.hz; v <= st.hz; v += 0.1) {
      const p = probe(st, 0, v), y = space.floorAt(p.x, p.z, last ?? st.y0);
      if (last !== null) assert.ok(Math.abs(y - last) < 0.1, `${station.id} stair at ${v.toFixed(2)}: ${last} -> ${y} (${st.y0} to ${st.y1} over ${2 * st.hz} m)`);
      last = y;
    }
  }
});
