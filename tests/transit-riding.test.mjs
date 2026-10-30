import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function element() {
  const handlers = new Map();
  return { hidden: true, disabled: false, textContent: '', classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(k, fn) { handlers.set(k, fn); }, removeEventListener(k) { handlers.delete(k); },
    click() { handlers.get('click')?.(); } };
}
function harness() {
  const elements = new Map();
  const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); } };
  const window = { CITY: { THREE, TSL, Addons: { mergeGeometries }, cityUniforms: { uInteriorGlow: TSL.uniform(0.48) } } };
  const context = vm.createContext({ window, document, console,
    setTimeout(fn, ms) { const timer = setTimeout(fn, ms); timer.unref(); return timer; }, clearTimeout });
  for (const name of ['world-collision', 'transit-riding', 'streetcar-ride']) {
    vm.runInContext(fs.readFileSync(new URL(`../js/${name}.js`, import.meta.url), 'utf8'), context);
  }
  const city = window.CITY;
  const entity = { type: 'person', position: new THREE.Vector3(-4, 0.22, 45.5), heading: 0, speed: 0, mesh: new THREE.Group() };
  const colliders = [];
  const controller = { activeMode: 'person', suspended: false, allowLanding: true, inputs: { forward: true },
    getActiveEntity: () => entity, resetInput() { this.inputs.forward = false; }, setMode(mode) { this.activeMode = mode; },
    isPointOnSidewalk: (x) => Math.abs(x) >= 3, getGroundHeight: () => 0.22,
    nearColliders: () => colliders,
    findTeleportPosition(x, z) { return this.allowLanding ? { x, z } : null; },
    teleportActiveTo(x, z, heading) { entity.position.set(x, 0.22, z); entity.heading = heading; entity.mesh.position.copy(entity.position); } };
  const camera = { activePresetId: 'action', orbitYawOffset: 0.7, orbitPitchOffset: 0.3, zoomMultiplier: 1.4,
    camera: new THREE.PerspectiveCamera(50, 1, 0.6, 2000), followOverride: null,
    setCameraPreset(id) { this.activePresetId = id; }, resetOrbit() { this.orbitYawOffset = 0; this.orbitPitchOffset = 0.09; },
    resetForTeleport() { this.resetOrbit(); this.activePresetId = 'chase'; } };
  const track = { pattern: { route: '504', dir: 0 }, sign: ['504B KING', 'BROADVIEW STN'], stops: [50, 100, 150],
    stopNames: ['King St West at One', 'King St West at Two', 'King St West at Three'],
    stopRecords: [50, 100, 150].map((s, i) => ({ id: `stop-${i}`, name: `Stop ${i}`, s })), len: 200 };
  const car = { id: 'test-streetcar', track, s: 50, speed: 0, k: 1, atEnd: 0, placed: true,
    sections: [6.6, 5.7, 5.4, 5.7, 6.6].map((l, k) => ({ x: 0, y: 0, z: 46.7 - k * 6, yaw: 0, pitch: 0 })) };
  city.openTransitDoors(car, 0, 8); car.doorState = 'open'; car.doorProgress = 1;
  const streetcars = { shape: { SECTIONS: [6.6, 5.7, 5.4, 5.7, 6.6], DOORS: [-1.2, 0, null, 0, 1.2], GANGWAY: 0.55, HALF_W: 1.27 },
    routes: [track], cars: [car], sample(t, s, out) { Object.assign(out, { x: 0, y: 0, z: s, yaw: 0 }); } };
  const traffic = { cars: [], buses: [], peds: [] };
  const session = city.createTransitRideSession({ controllerManager: controller, cameraSystem: camera });
  const scene = new THREE.Scene();
  let interactive = true;
  const ride = city.createStreetcarRide({ scene, streetcars, controllerManager: controller, cameraSystem: camera,
    session, trafficSystem: traffic, selectCamera: (id) => camera.setCameraPreset(id), canInteract: () => interactive });
  return { city, ride, car, track, entity, controller, camera, elements, traffic, colliders, session, scene, streetcars,
    setInteractive: (value) => { interactive = value; } };
}

test('doors complete opening, full dwell and closing before departure', () => {
  const { city } = harness();
  const car = {};
  city.openTransitDoors(car, 2, 20);
  for (let i = 0; i < 6; i++) assert.equal(city.stepTransitDoors(car, 0.1), true);
  assert.equal(car.doorState, 'opening');
  for (let i = 0; i < 3; i++) city.stepTransitDoors(car, 0.1);
  assert.equal(car.doorState, 'open');
  assert.ok(car.dwell > 19.7, 'opening does not spend the dwell window');
  car.dwell = 0;
  city.stepTransitDoors(car, 0.1);
  assert.equal(car.doorState, 'closing');
  while (car.doorState !== 'closed') assert.equal(city.stepTransitDoors(car, 0.1), true);
  assert.equal(car.doorState, 'closed');
  assert.equal(city.stepTransitDoors(car, 0.1), false);
});

test('the last supported stop stays open until the occupied lease is released', () => {
  const { city, car } = harness();
  car.ridden = true; car.lastPassengerStop = 0; car.dwell = 0;
  for (let i = 0; i < 200; i++) city.stepTransitDoors(car, 0.1);
  assert.equal(car.doorState, 'open');
  car.ridden = false; car.dwell = 0;
  city.stepTransitDoors(car, 0.1);
  assert.equal(car.doorState, 'closing');
});

test('board from a safe door-side stop and restore passenger ownership exactly once', () => {
  const h = harness();
  const { ride, car, controller, camera, session, entity } = h;
  assert.equal(ride.boardable(), car);
  assert.equal(ride.board(car), true);
  assert.equal(ride.board(car), false);
  assert.equal(controller.suspended, true);
  assert.equal(entity.mesh.visible, false);
  assert.equal(controller.inputs.forward, false);
  assert.equal(session.savedGround('person').x, -4);
  assert.equal(car.lastPassengerStop, 2);
  ride.update(0.1);
  assert.ok(camera.followOverride);
  assert.equal(ride.exit({ cancel: true }), true);
  assert.equal(ride.exit({ cancel: true }), false);
  assert.equal(controller.suspended, false);
  assert.equal(car.ridden, false);
  assert.equal(car.hideBody, false);
  assert.equal(entity.mesh.visible, true);
  assert.equal(camera.followOverride, null);
  assert.equal(camera.activePresetId, 'action');
  assert.equal(camera.orbitYawOffset, 0.7);
  assert.equal(camera.zoomMultiplier, 1.4);
  assert.equal(camera.camera.near, 0.6);
  assert.equal(session.savedGround('person'), null);
});

test('moving, closed, opposite-side and wrong-deck cars cannot be boarded', () => {
  const { ride, car, entity, setInteractive } = harness();
  car.speed = 1; assert.equal(ride.boardable(), null); car.speed = 0;
  car.doorState = 'closed'; assert.equal(ride.board(car), false); car.doorState = 'open';
  entity.position.x = 4; assert.equal(ride.boardable(), null); entity.position.x = -4;
  entity.position.y = 6; assert.equal(ride.boardable(), null); entity.position.y = 0.22;
  setInteractive(false); assert.equal(ride.action(), false);
});

test('a collision across the boarding corridor rejects the transfer', () => {
  const { ride, car, colliders } = harness();
  colliders.push({ minX: -2.4, maxX: -1.8, minZ: 30, maxZ: 65, minY: 0, maxY: 3 });
  assert.equal(ride.board(car), false);
});

test('all four open passenger doors accept street boarding, including the rear door', () => {
  for (const module of [0, 1, 3, 4]) {
    const { ride, car, entity, streetcars } = harness();
    entity.position.set(-4, 0.22, car.sections[module].z + streetcars.shape.DOORS[module]);
    assert.equal(ride.boardable(), car, `door on module ${module}`);
    assert.equal(ride.action(), true);
  }
});

test('a clear roadway boarding area beside an open door works, but nearby traffic blocks boarding', () => {
  const { ride, car, entity, traffic } = harness();
  entity.position.x = -2;
  assert.equal(ride.boardable(), car, 'the player need not stand on the sidewalk behind the open door');
  traffic.cars.push({ x: -2, z: entity.position.z, y: 0, half: 2, halfWidth: 0.9 });
  assert.equal(ride.boardable(), null);
  traffic.cars.length = 0;
  assert.equal(ride.action(), true);
});

test('blocked sidewalk exit keeps the rider aboard and moving exits are rejected', () => {
  const { ride, car, traffic, entity } = harness();
  assert.equal(ride.board(car), true);
  const landing = ride.exitPoint(car);
  traffic.buses.push({ x: landing.x, z: landing.z, y: 0, half: 20, halfWidth: 20 });
  assert.equal(ride.exit(), false);
  assert.equal(ride.active, true);
  traffic.buses.length = 0;
  car.speed = 2; assert.equal(ride.exit(), false); car.speed = 0;
  assert.ok(ride.exit());
  assert.ok(entity.position.x < -3);
});

test('requesting the next stop never forces an exit and can be cancelled', () => {
  const { ride, car, city, elements } = harness();
  ride.board(car);
  car.doorState = 'closed'; car.dwell = 0; car.s = 70; car.speed = 4;
  ride.action(); ride.update(0.1);
  assert.match(elements.get('ride-status').textContent, /Stop requested/);
  ride.action(); ride.update(0.1);
  assert.equal(elements.get('ride-status').textContent, 'Request next stop');
  ride.action();
  car.s = 100; car.k = 2; city.openTransitDoors(car, 1, 15);
  car.doorState = 'open'; car.doorProgress = 1;
  for (let i = 0; i < 40; i++) ride.update(0.1);
  assert.equal(ride.active, true, 'passenger decides when to get off');
  assert.match(elements.get('ride-status').textContent, /Get off/);
  assert.equal(ride.action(), true);
  assert.equal(ride.active, false);
});

test('lost service cancels to a safe ground position and repeated rides reuse the interior', () => {
  const h = harness();
  const { ride, car, streetcars, scene } = h;
  const count = scene.children.length;
  for (let i = 0; i < 20; i++) {
    car.doorState = 'closed'; ride.update(0.2); car.doorState = 'open';
    assert.equal(ride.board(car), true);
    assert.equal(ride.exit({ cancel: true }), true);
  }
  assert.equal(scene.children.length, count);
  car.doorState = 'closed'; ride.update(0.2); car.doorState = 'open';
  assert.equal(ride.board(car), true);
  streetcars.cars.length = 0;
  ride.update(0.1);
  assert.equal(ride.active, false);
  assert.equal(h.entity.position.x, -4);
  ride.dispose();
  assert.equal(scene.children.length, 0);
});

test('live corrections and retirement preserve an occupied streetcar identity', () => {
  const source = fs.readFileSync(new URL('../js/streetcars.js', import.meta.url), 'utf8');
  const retire = source.match(/  function retire\(car\) \{[\s\S]*?\n  \}/)[0];
  const target = source.match(/  function liveTarget\(car, t, now\) \{[\s\S]*?\n  \}/)[0];
  const car = { ridden: true, s: 50, k: 1, liveId: 'real-123', live: { s: 900, at: 0 }, sections: [{}, {}, { x: 0, z: 0 }] };
  const track = { len: 1000, schedSpeed: 3, cruise: 8, stops: [50, 100], cars: [car] }; car.track = track;
  const cars = [car], liveCars = new Map([['real-123', car]]);
  const api = vm.runInNewContext(`${retire}\n${target}\n({ retire, liveTarget })`, { cars, liveCars, camX: 5000, camZ: 5000, CAR_LEN: 32.2, MAX_SPEED: 11.5 });
  const speed = api.liveTarget(car, track, 1000);
  assert.equal(car.s, 50); assert.equal(car.k, 1); assert.ok(speed <= 10 && speed >= 6.4);
  api.retire(car); assert.equal(cars[0], car); assert.equal(liveCars.get('real-123'), car);
  car.ridden = false; api.retire(car); assert.equal(cars.length, 0); assert.equal(track.cars.length, 0); assert.equal(liveCars.size, 0);
});

test('one coordinator reserves a station and retains its safe surface anchor while attached to a train', () => {
  const { session, controller, entity } = harness();
  const anchor = { x: 50, y: 0.22, z: 80, heading: 1 };
  const station = session.reserve('subway', { surfaceMode: 'cyclist', savedGround: (mode) => ['person', 'cyclist'].includes(mode) ? anchor : null });
  assert.ok(station);
  assert.equal(session.reserve('taxi'), false);
  assert.equal(session.begin({}, { type: 'streetcar' }), false);
  assert.equal(session.begin({}, { type: 'subway' }), true);
  assert.equal(session.owner, 'subway');
  assert.equal(session.surfaceMode, 'cyclist');
  assert.equal(session.savedGround('person'), anchor, 'reload does not persist the hidden seat or platform');
  assert.equal(station.release(), false, 'a station reservation cannot release an attached train');
  assert.equal(session.begin({}, { type: 'subway' }), false);
  assert.equal(session.end(), true);
  assert.equal(controller.suspended, false); assert.equal(entity.mesh.visible, true);
  assert.equal(session.owner, 'subway', 'alighting keeps the station reservation');
  assert.equal(station.release(), true); assert.equal(station.release(), false);
  assert.equal(session.owner, null);
});

test('seat photo overlay restores full camera state without ending or replacing the passenger lease', () => {
  const { session, controller, entity, camera } = harness();
  let releases = 0;
  assert.equal(session.begin({}, { type: 'streetcar' }, () => releases++), true);
  camera.camera.layers.set(7); camera.camera.near = 0.12; camera.camera.fov = 71; camera.camera.far = 4000;
  const cinema = () => null; camera.cinema = cinema;
  const passenger = camera.followOverride;
  const photo = session.openOverlay('photo', { hold: true });
  assert.ok(photo); assert.equal(session.held, true);
  assert.equal(session.openOverlay('album'), false);
  assert.equal(session.reserve('taxi'), false);
  assert.equal(session.end(), false);
  camera.camera.layers.set(0); camera.camera.near = 0.35; camera.camera.fov = 44; camera.camera.far = 60000;
  camera.cinema = () => null; camera.followOverride = null; camera.orbitYawOffset = 9;
  assert.equal(photo.release(), true); assert.equal(photo.release(), false);
  assert.equal(camera.camera.layers.mask, 1 << 7); assert.equal(camera.camera.near, 0.12);
  assert.equal(camera.camera.fov, 71); assert.equal(camera.camera.far, 4000);
  assert.equal(camera.cinema, cinema); assert.equal(camera.followOverride, passenger);
  assert.equal(camera.orbitYawOffset, 0.7);
  assert.equal(controller.suspended, true); assert.equal(entity.mesh.visible, false);
  assert.equal(releases, 0); assert.equal(session.end(), true); assert.equal(releases, 1);
});

test('blocked cancellation preserves the owner and transition/error cleanup is idempotent', () => {
  const { session, controller } = harness();
  const finish = session.beginTransition();
  assert.equal(session.openOverlay('photo', { hold: true }), false);
  finish(); finish(); assert.equal(session.transitioning, false);
  const photo = session.openOverlay('photo', { hold: true, onClose() { throw new Error('overlay failed'); } });
  assert.throws(() => photo.release(), /overlay failed/);
  assert.equal(session.overlay, null); assert.equal(session.held, false);
  assert.equal(session.begin({}, { type: 'streetcar' }), true);
  controller.allowLanding = false;
  assert.equal(session.cancel(), false); assert.equal(session.active, true); assert.equal(session.owner, 'streetcar');
  controller.allowLanding = true;
  assert.equal(session.cancel(), true); assert.equal(session.active, false); assert.equal(session.owner, null);
});
