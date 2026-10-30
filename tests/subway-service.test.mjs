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
