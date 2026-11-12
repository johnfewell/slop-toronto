const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = (name) => readFileSync(join(__dirname, '..', name), 'utf8');
function harness({ type = 'cyclist', aspect = 16 / 9, colliders = [], surface = null } = {}) {
  const C = { terrainHeightAt: () => 0, LANDMARK_SITES: { cnTower: { x: 0, z: 700, h: 553, w: 52, d: 52 } } };
  if (surface) C.cameraSurfaceLayersAt = surface;
  vm.runInNewContext(source('js/world-collision.js') + source('js/camera-rig.js'), { window: { CITY: C }, performance });
  const controller = { nearColliders: () => colliders };
  const collision = new C.CameraCollision(controller), rig = new C.FollowCameraRig(collision);
  const vector = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { Object.assign(this, { x, y, z }); } });
  const system = { camera: { fov: 65, aspect, near: .35 }, zoomMultiplier: 1, orbitYawOffset: 0, orbitPitchOffset: -.2,
    isDragging: false, userOrbitTimer: 0, currentPos: vector(), currentLookAt: vector(), collision, discontinuities: [], onDiscontinuity(reason) { this.discontinuities.push(reason); } };
  const entity = { type, position: { x: 0, y: 0, z: 0 }, heading: 0, speed: 0, chaseDistance: 4.3, cameraTargetOffset: { y: 1.5 } };
  return { C, controller, collision, rig, system, entity, colliders, step(dt) { rig.update(entity, system, dt); } };
}
const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} vs ${expected} (tolerance ${tolerance})`);

test('straight travel follows measured root with no steady horizontal lag; stopped input stays where placed', () => {
  const h = harness(); h.step(1 / 60);
  for (let i = 0; i < 180; i++) { h.entity.position.z += 6 / 60; h.step(1 / 60); near(h.rig.pivot.z, h.entity.position.z); }
  near(h.rig.speed, 6);
  h.system.orbitYawOffset = 1; h.system.orbitPitchOffset = -.5; h.rig.idle = 0;
  const yaw = h.rig.yaw; h.step(1 / 60);
  near(h.rig.yaw, yaw);
  near(Math.atan2(h.rig.pivot.x - h.system.currentPos.x, h.rig.pivot.z - h.system.currentPos.z), yaw + 1);
  for (let i = 0; i < 240; i++) h.step(1 / 60);
  near(h.system.orbitYawOffset, 1); near(h.system.orbitPitchOffset, -.5);
});

function corner(hz) {
  const h = harness(), dt = 1 / hz; h.step(dt);
  const samples = [];
  for (let i = 1; i <= hz * 4; i++) {
    const t = i * dt;
    h.entity.heading = t < 1 ? 0 : t < 2 ? (t - 1) * .9 : .9;
    h.entity.position.x += Math.sin(h.entity.heading) * 7 * dt;
    h.entity.position.z += Math.cos(h.entity.heading) * 7 * dt;
    if (i === hz * 2) { h.system.orbitYawOffset = .8; h.rig.idle = 0; }
    h.step(dt);
    if (i % hz === 0) samples.push({ yaw: h.rig.yaw, offset: h.system.orbitYawOffset, pivotX: h.rig.pivot.x - h.entity.position.x });
  }
  return samples;
}
test('the same corner and timed recenter agree at 30, 60 and 120 Hz', () => {
  const a = corner(30), b = corner(60), c = corner(120);
  for (let i = 0; i < a.length; i++) {
    near(a[i].yaw, c[i].yaw, .012); near(b[i].yaw, c[i].yaw, .005);
    near(a[i].offset, c[i].offset, .025); near(a[i].pivotX, 0);
  }
});
test('yaw follows the short arc across both pi boundaries and obeys its angular limit', () => {
  for (const sign of [-1, 1]) {
    const h = harness(); h.entity.heading = sign * (Math.PI - .01); h.step(1 / 60);
    h.entity.heading = sign * (-Math.PI + .01);
    const previous = h.rig.yaw; h.step(1 / 60);
    const delta = h.C.cameraWrapAngle(h.rig.yaw - previous);
    assert.ok(Math.abs(delta) < .003); assert.equal(Math.sign(delta), sign);
    h.entity.heading = 0; const before = h.rig.yaw; h.step(1 / 60);
    assert.ok(Math.abs(h.C.cameraWrapAngle(h.rig.yaw - before)) <= 2.4 / 60 + 1e-10);
  }
});
test('manual orbit is immediate; recenter waits .9 seconds and ramps only during actual travel', () => {
  const h = harness(); h.step(.01); h.system.orbitYawOffset = .8; h.rig.idle = 0;
  for (let i = 0; i < 89; i++) { h.entity.position.z += .06; h.step(.01); }
  near(h.system.orbitYawOffset, .8);
  for (let i = 0; i < 150; i++) { h.entity.position.z += .06; h.step(.01); }
  assert.ok(h.system.orbitYawOffset < .1);
});
test('facade approach hard-caps the displayed sphere immediately, then opens slowly after removal/refinement', () => {
  const wall = { minX: -20, maxX: 20, minZ: -3, maxZ: -2.5, minY: 0, maxY: 20 };
  const h = harness(); h.step(1 / 60);
  h.colliders.push(wall); h.step(1 / 60);
  const radius = h.collision.radius(h.system.camera);
  assert.ok(h.system.currentPos.z >= wall.maxZ + radius, 'near plane stops in front of facade despite lagged reach');
  const contracted = h.system.currentPos.z;
  h.colliders.length = 0; h.step(1 / 60);
  assert.ok(h.system.currentPos.z < contracted);
  assert.ok(h.system.currentPos.z > -3, 'opening does not pop immediately to the full boom');
  for (let i = 0; i < 180; i++) h.step(1 / 60);
  assert.ok(h.system.currentPos.z < -3.8);
});
test('height slabs distinguish underpasses, the overhead ceiling and the bridge deck', () => {
  const surface = (x, z, out) => { out.length = 0; if (z < -1) out.push({ bottom: 4, top: 5 }); return out; };
  const h = harness({ surface });
  const below = h.collision.sweep({ x: 0, y: 2, z: 0 }, { x: 0, y: 2, z: -5 }, .5);
  near(below, 1);
  assert.ok(h.collision.sweep({ x: 0, y: 3, z: 0 }, { x: 0, y: 4.5, z: -5 }, .5) < 1);
  near(h.collision.sweep({ x: 0, y: 6, z: 0 }, { x: 0, y: 6, z: -5 }, .5), 1);
});
test('a near-plane sphere overlapping the rider pivot escapes to a verified clear local eye', () => {
  const h = harness({ colliders: [{ minX: .4, maxX: 10, minZ: -20, maxZ: 20, minY: 0, maxY: 20 }] });
  h.step(1 / 60);
  const radius = h.collision.radius(h.system.camera);
  assert.equal(h.collision.sweep(h.rig.pivot, h.rig.pivot, radius), 0);
  assert.equal(h.collision.sweep(h.system.currentPos, h.system.currentPos, radius), 1);
});
test('an entirely enclosed subject rejects the pose instead of publishing an unverified eye', () => {
  const h = harness({ colliders: [{ minX: -30, maxX: 30, minZ: -30, maxZ: 30, minY: 0, maxY: 20 }] });
  assert.equal(h.rig.update(h.entity, h.system, 1 / 60), false);
  near(h.system.currentPos.x, 0); near(h.system.currentPos.y, 0);
});
test('polygon courtyard stays open and rotated boxes use their own outlines', () => {
  const h = harness();
  h.colliders.push({ minX: -5, maxX: 5, minZ: -5, maxZ: 5, minY: 0, maxY: 10,
    polygon: [{ x: -5, z: -5 }, { x: 5, z: -5 }, { x: 5, z: 5 }, { x: 2, z: 5 }, { x: 2, z: -2 }, { x: -2, z: -2 }, { x: -2, z: 5 }, { x: -5, z: 5 }] });
  near(h.collision.sweep({ x: 0, y: 2, z: 4 }, { x: 0, y: 2, z: 0 }, .5), 1);
  assert.ok(h.collision.sweep({ x: 0, y: 2, z: 4 }, { x: 0, y: 2, z: -4 }, .5) < 1);
});
test('the production spatial index retains the coarse proxy until an atomic model refinement swap', () => {
  const h = harness();
  vm.runInNewContext(source('js/controllers.js'), { window: { CITY: h.C } });
  const controller = Object.create(h.C.ThirdPersonControllerManager.prototype);
  const coarse = { minX: -5, maxX: 5, minZ: -4, maxZ: -2, maxY: 20 };
  const fine = { minX: 3, maxX: 4, minZ: -4, maxZ: -2, maxY: 20 };
  controller.colliders = [coarse];
  h.collision.controller = controller;
  const a = { x: 0, y: 2, z: 0 }, b = { x: 0, y: 2, z: -5 };
  assert.ok(h.collision.sweep(a, b, .5) < 1);
  assert.ok(h.collision.sweep(a, b, .5) < 1, 'coarse geometry stays solid while the replacement is prepared');
  h.C.WorldCollision.swap([coarse], [fine]);
  assert.equal(h.collision.sweep(a, b, .5), 1, 'the refined opening is usable on the next query');
  assert.ok(h.collision.sweep({ x: 3.5, y: 2, z: 0 }, { x: 3.5, y: 2, z: -5 }, .5) < 1, 'the refined solid remains indexed');
});
test('teleport clears velocity/pivot history and emits one temporal discontinuity; snapshots restore channels', () => {
  const h = harness(); h.step(.02);
  h.entity.position.z = .14; h.step(.02);
  const state = h.rig.snapshot();
  h.entity.position.x = 900; h.entity.position.z = 300; h.entity.position.y = 20; h.step(.02);
  near(h.rig.pivot.x, 900); near(h.rig.pivot.y, 21.5); near(h.rig.velocity.x, 0);
  assert.deepEqual(h.system.discontinuities, ['camera-jump']);
  h.rig.restore(state); near(h.rig.pivot.z, .14); near(h.rig.velocity.z, 7);
});
test('dt discontinuities are capped and nonfinite deltas cannot contaminate channel state', () => {
  const h = harness(); h.step(.01); h.entity.heading = 2;
  h.step(10); assert.ok(Math.abs(h.rig.yaw) <= .12 + 1e-10);
  h.step(NaN); assert.ok(Number.isFinite(h.system.currentPos.x));
});
test('vehicle framing scales to the sedan while cycling keeps its compact boom and lower speed lens onset', () => {
  for (const type of ['cyclist', 'car']) {
    const h = harness({ type }); h.step(.02);
    for (let i = 0; i < 200; i++) { h.entity.position.z += .18; h.step(.02); }
    const horizontal = Math.hypot(h.system.currentPos.x - h.rig.pivot.x, h.system.currentPos.z - h.rig.pivot.z);
    if (type === 'cyclist') { near(h.rig.pivot.y, 1.5); assert.ok(horizontal > 3.8 && horizontal < 4); near(h.system.camera.fov, 68.125, .01); }
    else { near(h.rig.pivot.y, 1.745); assert.ok(horizontal > 6 && horizontal < 7); near(h.system.camera.fov, 60.9, .01); }
  }
});
test('street-datum proxy bases do not become infinitely deep camera walls below grade', () => {
  const h = harness({ colliders: [{ minX: -10, maxX: 10, minZ: -4, maxZ: -2, maxY: 10 }] });
  h.C.terrainHeightAt = () => -10;
  near(h.collision.sweep({ x: 0, y: -3, z: 0 }, { x: 0, y: -3, z: -6 }, .5), 1);
});
for (const aspect of [16 / 9, 412 / 915]) test(`director validates start/mid/end silhouettes at aspect ${aspect}`, () => {
  const h = harness({ aspect }), director = new h.C.TorontoCameraDirector(h.system);
  assert.equal(director.prepare(h.entity), true, director.reason);
  assert.equal(director.report.checks.length, 3);
  for (const check of director.report.checks) assert.equal(check.valid, true);
  assert.ok(director.fov >= 25 && director.fov <= 95);
  const a = director.coordinates(director.head);
  assert.ok(Math.abs(a.x / (a.z * Math.tan(director.fov * Math.PI / 360) * aspect)) < 1);
});
test('director rejects a blocked landmark before cutting and does not mutate displayed pose during preparation', () => {
  const h = harness({ colliders: [{ minX: -100, maxX: 100, minZ: 50, maxZ: 60, minY: 0, maxY: 300 }] });
  const director = new h.C.TorontoCameraDirector(h.system), before = { ...h.system.currentPos };
  assert.equal(director.prepare(h.entity), false); assert.match(director.reason, /obstructed/);
  assert.equal(h.system.currentPos.x, before.x); assert.equal(h.system.currentPos.y, before.y);
});
test('portrait director fits the actual rotated sedan extent and rejects unsupported subject types', () => {
  const h = harness({ type: 'car', aspect: 412 / 915 }); h.entity.heading = Math.PI / 2;
  const director = new h.C.TorontoCameraDirector(h.system);
  assert.equal(director.prepare(h.entity), true, director.reason);
  assert.ok(director.distanceScale >= 2, 'Toronto vehicle scale leaves room for the broadside sedan');
  h.entity.type = 'helicopter';
  const unsupported = new h.C.TorontoCameraDirector(h.system);
  assert.equal(unsupported.prepare(h.entity), false);
  assert.match(unsupported.reason, /requires a cyclist or car/);
});
