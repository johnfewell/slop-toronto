// The subway rides' passenger flow (js/subway-ride.js) with real three.js objects, a stub DOM and a minimal
// controller: both rides build; the Line 1 ride is entered from its street stairway, walked, boarded, ridden and left
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// (the ride's objects come from the vm's realm: compare them as JSON)
const same = (actual, expected, message) => assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
function harness() {
  const els = {};
  const el = () => ({ hidden: true, disabled: false, textContent: '', classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {} });
  const document = { getElementById: (id) => (els[id] ||= el()), createElement: () => ({ getContext: () => ({ fillRect() {}, fillText() {} }) }) };
  const window = { CITY: { THREE: { ...THREE, CanvasTexture: class extends THREE.Texture {} }, TSL, Addons: { mergeGeometries } } };
  const context = vm.createContext({ window, document, console: { info() {}, warn() {} }, setTimeout, clearTimeout });
  for (const f of ['toronto-subway', 'toronto-subway-topology', 'toronto-transit', 'transit', 'transit-riding', 'subway-service']) {
    vm.runInContext(fs.readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8'), context);
  }
  const C = window.CITY;
  Object.assign(C, { SUBWAY_VIADUCTS: [{ pts: [{ x: 2006.6, z: -2806.3 }, { x: 2240, z: -2800 }, { x: 2474.2, z: -2794 }], railY: 16.3 }],
    createSubwayCarGeometry: () => new THREE.BoxGeometry(3, 3, 23), createSubwayCarMaterial: () => new THREE.MeshBasicNodeMaterial() });
  vm.runInContext(fs.readFileSync(new URL('../js/subway-ride.js', import.meta.url), 'utf8'), context);
  // js/subway.js's stairways at the listed entrances (King A1, Queen south-west), going down toward the station
  const site = (osm, name, st, x, z) => {
    const s = C.GEO_SUBWAY.stations.find((q) => q[2] === st), dz = Math.sign(s[1] - z) || 1;
    return { kind: 'stair', osm, entranceName: name, name: st, x, z: z + dz * 3.2, tx: 0, tz: dz, pylon: { x: x - 2, z } };
  };
  const sites = [site(3697981902, 'Yonge / King Southwest corner', 'King', 300.5, -341.7), site(3555231357, 'Yonge / Queen Southwest Corner', 'Queen', 301.2, -714.3),
    { kind: 'stair', name: 'Castle Frank', x: 1846.2, z: -2765.1, tx: 1, tz: 0, pylon: { x: 1846, z: -2768 } },
    { kind: 'stair', name: 'Broadview', x: 2691, z: -2841.1, tx: 1, tz: 0, pylon: { x: 2691, z: -2844 } }];
  const person = { position: new THREE.Vector3(), heading: 0, speed: 0, mesh: new THREE.Group() };
  const controller = { activeMode: 'person', interiorSpace: null, suspended: false, entities: { person }, colliders: [],
    getActiveEntity: () => person, isPointOnSidewalk: () => true, setMode(m) { this.activeMode = m; }, resetInput() {},
    findTeleportPosition(x, z, h, y) { return this.interiorSpace ? this.interiorSpace.constrain({ x, z, y }, 0.5) : { x, z }; },
    getGroundHeight(x, z, mode, y) { return this.interiorSpace ? (this.interiorSpace.floorAt ? this.interiorSpace.floorAt(x, z, y) : this.interiorSpace.floor) : 0.22; },
    teleportActiveTo(x, z, heading, y) {
      const d = this.findTeleportPosition(x, z, heading, y);
      person.position.set(d.x, this.getGroundHeight(d.x, d.z, 'person', y ?? person.position.y), d.z); person.heading = heading;
    },
    // a step of walking as js/controllers.js moveBody does inside an interior
    walk(dx, dz) {
      const p = person.position, at = this.interiorSpace.constrain({ x: p.x + dx, z: p.z + dz, y: p.y }, 0.5);
      p.set(at.x, this.interiorSpace.floorAt(at.x, at.z, p.y), at.z);
    } };
  const camera = { camera: new THREE.PerspectiveCamera(), activePresetId: 'chase', followOverride: null, resetForTeleport() {},
    setCameraPreset(id) { this.activePresetId = id; } };
  const session = C.createTransitRideSession({ controllerManager: controller, cameraSystem: camera });
  const scene = new THREE.Scene();
  const ride = C.createSubwayRide({ scene, subway: { entrances: { sites }, passengerRoutes: new Set() }, controllerManager: controller,
    cameraSystem: camera, session, selectCamera: (id) => { camera.activePresetId = id; } });
  return { C, ride, controller, person, camera, session, scene, els };
}
// walk toward (x, z) in 0.4 m steps, as far as the walls allow
function walkTo(h, q, max = 2000) {
  for (let i = 0; i < max; i++) {
    const p = h.person.position, d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < 0.3) return true;
    const s = Math.min(0.4, d);
    h.controller.walk(((q.x - p.x) / d) * s, ((q.z - p.z) / d) * s);
    h.ride.update(0.05);
  }
  return false;
}
// waypoints through consecutive cells, each in the overlap of a cell and the next (both convex: straight walks)
function route(cells) {
  const clamp = (c, p) => {
    const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw), dx = p.x - c.cx, dz = p.z - c.cz;
    const u = Math.max(-c.hx + 0.2, Math.min(c.hx - 0.2, dx * cs - dz * sn)), v = Math.max(-c.hz + 0.2, Math.min(c.hz - 0.2, dx * sn + dz * cs));
    return { x: c.cx + cs * u + sn * v, z: c.cz - sn * u + cs * v };
  };
  const out = [];
  for (let i = 0; i + 1 < cells.length; i++) out.push(clamp(cells[i], clamp(cells[i + 1], { x: cells[i].cx, z: cells[i].cz })));
  return out;
}

test('both rides build; the viaduct ride keeps its identities and level', () => {
  const { ride, C } = harness();
  same(ride.pairs.map((p) => p.id), ['l2-castle-frank-broadview', 'l1-queen-king']);
  same(ride.cars.map((c) => c.id), ['subway-line2-0', 'subway-line2-1', 'subway-l1-queen-king-0', 'subway-l1-queen-king-1']);
  same(ride.routes.map((r) => r.id), ['line2-0', 'line2-1']);
  for (const r of ride.routes) assert.equal(r.profile, undefined);
  assert.equal(ride.featured(), true);
  assert.equal(ride.car.id, 'subway-line2-0'); assert.equal(ride.car.sections[0].y, 16.3);
  assert.equal(ride.exit({ cancel: true }), true);
  assert.equal(ride.inside, false);
  // the walked stations reach both platforms from their stairway
  for (const station of ride.pairs[1].stations) {
    assert.ok(station.walk && station.anchor, station.id);
    assert.equal(station.walk.layout.underStairs, false, `${station.id}: no corridor runs under the street stairway`);
    assert.equal(station.group.name, `SubwayPlatform_${station.id}`);
  }
  assert.equal(C.SUBWAY_TOPOLOGY.rides.length, 2);
});

test('Line 1: enter from the street stairway, walk down, board, ride to King, walk up and leave by the stairs', () => {
  const h = harness(), { ride, controller, person, camera, session, els } = h;
  const queen = ride.pairs[1].stations[0], king = ride.pairs[1].stations[1];
  // at the stairway's head on the street: the entrance prompt
  const e = queen.entrances[0];
  person.position.set(e.prompt.x - e.opening.tx, 0.22, e.prompt.z - e.opening.tz);
  ride.update(0.05);
  assert.equal(ride.hasEntranceCandidate, true);
  assert.match(els['ride-prompt-text'].textContent, /Enter Queen station · Line 1/);
  assert.equal(ride.action(), true);
  assert.equal(ride.inside, true); assert.equal(ride.onPlatform, false);
  // a second action at once (a touch can deliver its tap twice) does not walk straight back out
  ride.update(0.05); ride.action();
  assert.equal(ride.inside, true, 'arriving at the stairway top never leaves at once');
  assert.equal(camera.camera.layers.mask, 1 << 2, 'underground: the interior layer only');
  const top = queen.walk.layout.top;
  assert.ok(Math.hypot(person.position.x - top.x, person.position.z - top.z) < 0.05 && Math.abs(person.position.y - top.y) < 0.01);
  ride.update(0.05);
  assert.match(els['ride-route'].textContent, /Line 1 · Queen station/);
  // walk down: stairway, landing, corridors, mezzanine, the southbound platform's stair, the platform's front door
  const cells = queen.walk.layout.cells, k = (kind, dir) => cells.find((c) => c.kind === kind && (dir === undefined || c.dir === dir));
  const path = [k('entrance'), k('landing'), ...cells.filter((c) => c.kind === 'corridor'), k('mezzanine'), k('stair', 0), k('platform', 0)];
  let lowest = Infinity;
  for (const q of [...route(path), queen.walk.platforms[0].landing]) {
    assert.ok(walkTo(h, q), `reached ${JSON.stringify(q)} from ${JSON.stringify(person.position)}`);
    lowest = Math.min(lowest, person.position.y);
  }
  assert.equal(ride.onPlatform, true); assert.equal(person.position.y, -9.5); assert.equal(lowest, -9.5);
  assert.match(els['ride-route'].textContent, /Southbound → King/);
  // the southbound train: wait, board at the front doors
  for (let i = 0; i < 6000 && els['ride-status'].disabled !== false; i++) ride.update(0.1);
  assert.equal(els['ride-status'].textContent, 'Board the train');
  assert.equal(ride.action(), true); assert.equal(ride.active, true);
  const id = ride.car.id;
  assert.equal(id, 'subway-l1-queen-king-0');
  assert.equal(ride.canChase, false, 'no exterior view underground');
  // ride: the camera stays underground, the train keeps its identity, the doors stay shut while it moves
  for (let i = 0; i < 3000 && !(ride.car.stopIndex === 1 && ride.car.doorState === 'open'); i++) {
    ride.update(0.1);
    assert.equal(ride.car.id, id); assert.equal(camera.camera.layers.mask, 1 << 2);
    if (ride.car.speed > 0.1) assert.equal(ride.car.doorState, 'closed');
  }
  assert.equal(ride.car.track.destination.id, 'king');
  assert.equal(king.group.visible, true, 'the arrival station shows before alighting');
  same(ride.savedGround('person'), { ...queen.anchor }, 'until alighting, the departure entrance is the safe anchor');
  assert.equal(ride.action(), true);
  assert.equal(ride.active, false); assert.equal(ride.onPlatform, true); assert.equal(session.active, false);
  assert.equal(person.position.y, -9.5);
  same(ride.savedGround('person'), { ...king.anchor });
  ride.update(0.05);
  assert.match(els['ride-route'].textContent, /Southbound · Ride ends here/);
  // King: up the stairs to the street
  const kc = king.walk.layout.cells, kk = (kind, dir) => kc.find((c) => c.kind === kind && (dir === undefined || c.dir === dir));
  const up = [kk('platform', 0), kk('stair', 0), kk('mezzanine'), ...kc.filter((c) => c.kind === 'corridor').reverse(), kk('landing'), kk('entrance')];
  for (const q of [...route(up), king.walk.layout.top]) assert.ok(walkTo(h, q), `reached ${JSON.stringify(q)}`);
  ride.update(0.05);
  assert.match(els['ride-prompt-text'].textContent, /Exit to the street · Yonge \/ King Southwest corner/);
  assert.equal(ride.action(), true);
  assert.equal(ride.inside, false); assert.equal(controller.interiorSpace, null); assert.equal(camera.camera.layers.mask, 1);
  assert.ok(Math.hypot(person.position.x - king.anchor.x, person.position.z - king.anchor.z) < 0.01);
});

test('Line 1: the northbound return, changing platforms, and cancelling aboard', () => {
  const h = harness(), { ride, person, els } = h;
  assert.equal(ride.featured('king'), true);
  assert.equal(ride.car.id, 'subway-l1-queen-king-1'); assert.equal(ride.car.track.compass, 'Northbound');
  // cancelling aboard returns to the departure entrance's street anchor
  assert.equal(ride.exit({ cancel: true }), true);
  assert.equal(ride.inside, false);
  const king = ride.pairs[1].stations[1];
  assert.ok(Math.hypot(person.position.x - king.anchor.x, person.position.z - king.anchor.z) < 0.01);
  // at Queen, the platform shortcut and back
  const queen = ride.pairs[1].stations[0];
  assert.equal(ride.enterStation('queen'), true);
  ride.update(0.05);
  assert.equal(els['subway-other-platform'].textContent, 'Go to a platform');
  assert.equal(ride.changePlatform(), true); assert.equal(ride.onPlatform, true);
  assert.equal(person.position.y, -9.5);
  ride.update(0.05);
  assert.match(els['ride-route'].textContent, /Southbound → King/);
  assert.equal(ride.changePlatform(), true); ride.update(0.05);
  assert.match(els['ride-route'].textContent, /Northbound · Ride ends here/);
  assert.equal(ride.station, queen);
  assert.equal(ride.exit({ cancel: true }), true);
});
