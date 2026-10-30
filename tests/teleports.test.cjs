const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = (path) => readFileSync(join(__dirname, '..', path), 'utf8');
const context = vm.createContext({ window: { CITY: {} } });
for (const path of ['js/toronto-geodata.js', 'js/city-config.js']) vm.runInContext(read(path), context);
const { TELEPORT_LOCATIONS, LANDMARK_SITES, CITY_BOUNDS, GEO, blockAt, nearestRoads, isOnLand, waterAt } = context.window.CITY;
const buttons = [...read('explore.html').matchAll(/data-teleport="([^"]+)"/g)].map((match) => match[1]);
const inCity = (p) => p.x > CITY_BOUNDS.minX && p.x < CITY_BOUNDS.maxX && p.z > CITY_BOUNDS.minZ && p.z < CITY_BOUNDS.maxZ;

test('every teleport button has a destination on a real roadway inside the city', () => {
  assert.ok(buttons.length >= 9, 'the Places menu lists the landmarks');
  for (const name of buttons) {
    const point = TELEPORT_LOCATIONS[name];
    assert.ok(point, `${name} has a destination`);
    assert.ok(Number.isFinite(point.heading), `${name} has a heading`);
    assert.ok(inCity(point), `${name} is inside the detailed city`);
    assert.ok(isOnLand(point.x, point.z), `${name} lands on dry ground`);
    // the Humber Bay Arch Bridge arrival is on the Martin Goodman Trail, a park path outside the street network
    if (name === 'humberArch') continue;
    assert.equal(blockAt(point.x, point.z), null, `${name} lands outside building blocks`);
    const nearby = nearestRoads(point.x, point.z, 20);
    assert.ok(nearby.some(({ road, dist }) => road.name === point.road && dist < road.w / 2), `${name} lands within ${point.road}'s width`);
  }
});

test('landmark arrivals face their landmark from a clear distance', () => {
  for (const name of buttons.filter((key) => LANDMARK_SITES[key])) {
    const point = TELEPORT_LOCATIONS[name];
    const site = LANDMARK_SITES[name];
    const distance = Math.hypot(site.x - point.x, site.z - point.z);
    assert.ok(distance > 90 && distance < 1200, `${name}: ${distance.toFixed(0)} m from the landmark`);
    const alignment = ((site.x - point.x) * Math.sin(point.heading) + (site.z - point.z) * Math.cos(point.heading)) / distance;
    assert.ok(alignment > 0.999, `${name} faces the landmark`);
  }
});

test('the CN Tower arrives on Bremner Boulevard facing the tower', () => {
  const point = TELEPORT_LOCATIONS.cnTower;
  const [tx, tz] = GEO.points.cnTower;
  assert.ok(nearestRoads(point.x, point.z, 20).some(({ road, dist }) => road.name === 'Bremner Boulevard' && dist < 1));
  const distance = Math.hypot(tx - point.x, tz - point.z);
  assert.ok(distance > 100 && distance < 220, 'leave space for the tower view');
  const alignment = ((tx - point.x) * Math.sin(point.heading) + (tz - point.z) * Math.cos(point.heading)) / distance;
  assert.ok(alignment > 0.999, 'face the tower rather than the neighbouring buildings');
});

test('the Humber Bay Arch Bridge arrival stands on the trail by the water, facing the CN Tower', () => {
  const point = TELEPORT_LOCATIONS.humberArch;
  assert.equal(point.road, 'Martin Goodman Trail');
  for (const [dx, dz] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) assert.ok(!waterAt(point.x + dx, point.z + dz), 'dry ground all round');
  const [tx, tz] = GEO.points.cnTower;
  const distance = Math.hypot(tx - point.x, tz - point.z);
  const alignment = ((tx - point.x) * Math.sin(point.heading) + (tz - point.z) * Math.cos(point.heading)) / distance;
  assert.ok(alignment > 0.999, 'the skyline ahead');
});

test('preset and map teleports share arrival resets', () => {
  const main = read('js/main.js');
  const slice = (from, to) => {
    const start = main.indexOf(from);
    const end = main.indexOf(to, start);
    assert.ok(start >= 0 && end > start, `main.js still has ${from.trim()}`);
    return main.slice(start, end);
  };
  // the map's clicks and the Places buttons both arrive through teleportTo
  assert.match(main, /new CityMapSystem\(\{[\s\S]*?onTeleport: teleportTo\b/);
  const handlers = new Map();
  const calls = [];
  const landed = { x: -305.7, z: 210 };
  let transitCancels = true;
  const environment = {
    window: { CITY: { TELEPORT_LOCATIONS } },
    cancelTransit: () => { calls.push(['cancelTransit']); return transitCancels; },
    tourGuide: { setAutoDrive: (on) => calls.push(['autoDrive', on]) },
    controllerManager: {
      teleportActiveTo: (...args) => { calls.push(['teleport', ...args]); return landed; }
    },
    touchControls: { reset: () => calls.push(['touch']) },
    gamepadControls: { reset: () => calls.push(['gamepad']) },
    cameraSystem: { resetForTeleport: () => calls.push(['camera']) },
    selectCamera: (...args) => calls.push(['selectCamera', ...args]),
    teleportButtons: buttons.map((key) => ({
      getAttribute: () => key,
      addEventListener: (_event, handler) => handlers.set(key, handler)
    })),
    closePopovers: () => calls.push(['closePopovers'])
  };
  vm.runInNewContext(`${slice('  function teleportTo(', '  let mapOverlay')}
${slice('  teleportButtons.forEach(', "  document.querySelectorAll('[data-ride]')")}
this.teleportTo = teleportTo;`, environment);
  for (const name of buttons) {
    calls.length = 0;
    handlers.get(name)();
    const point = TELEPORT_LOCATIONS[name];
    assert.deepEqual(calls, [
      ['cancelTransit'], ['autoDrive', false], ['teleport', point.x, point.z, point.heading], ['touch'], ['gamepad'], ['camera'],
      ['selectCamera', 'chase', true], ['closePopovers']
    ], name);
  }
  calls.length = 0;
  assert.deepEqual(environment.teleportTo(100, 200), landed, 'the map is given the safe position the controller chose');
  assert.deepEqual(calls.find((c) => c[0] === 'teleport'), ['teleport', 100, 200, Math.PI], 'a map teleport faces grid north');
  calls.length = 0;
  transitCancels = false;
  assert.equal(environment.teleportTo(100, 200), null, 'a ride that cannot be left keeps the rider aboard');
  assert.deepEqual(calls, [['cancelTransit']]);
});
