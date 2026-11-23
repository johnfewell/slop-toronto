// The sun's shadow cascades and the tallest casters (js/lighting.js liftSunCascadeCeiling; bead st-iq0v.4, after
// mrdoob's Slop New York e17cde4). three's SunLightShadow only draws casters up to `shadow.camera.far` past the highest
// corner of the view along the sun ray, so the upper part of the CN Tower dropped out of its own shadow. These checks run
// the REAL SunLightShadow of the installed three (r187, the build the game loads) with the REAL lighting.js wrapper:
//   1. the constant is the tallest caster in the game's data,
//   2. over sun elevations 15-80 deg, headings, spots and heights, the top of the tallest tower and of a 290 m tower is in
//      front of the cascade's near plane (inside its frustum) whenever its shadow lands inside that cascade's footprint,
//      and the stock cascades do miss some of them (so the check can fail),
//   3. the shift does not accumulate over 100 updates, nor with the shadow range changing each frame (altitude, quality),
//   4. a SunLightShadow without the internals leaves the stock behaviour with one warning.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import * as T from 'three';
import { SunLightShadow } from 'three/examples/jsm/lights/SunLightShadow.js';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
function loadLighting(warn = () => {}) {
  const window = { CITY: { THREE, TSL, Addons: { SkyMesh: class {}, SunLight: class {}, SunLightNode: class {} }, cityUniforms: {},
    GEO: { frame: { lat: 43.6453, lon: -79.3806, bearingDeg: -16.8 } } } };
  const ctx = vm.createContext({ window, console: { info() {}, log() {}, warn }, Date, Intl, URLSearchParams });
  vm.runInContext(read('js/live-sky.js'), ctx);
  vm.runInContext(read('js/lighting.js'), ctx);
  return window.CITY;
}
const C = loadLighting();

const rad = Math.PI / 180;
const sunAt = (elevDeg, azDeg) => new T.Vector3(Math.cos(elevDeg * rad) * Math.sin(azDeg * rad), Math.sin(elevDeg * rad), Math.cos(elevDeg * rad) * Math.cos(azDeg * rad));
// the game's view camera (js/cameras.js): 56 deg, near .35, far 60000
function viewFrom(x, y, z, headingDeg, pitchDeg = 0, reversed = true) {
  const cam = new T.PerspectiveCamera(56, 16 / 9, 0.35, 60000);
  cam.coordinateSystem = T.WebGPUCoordinateSystem;
  cam._reversedDepth = reversed;
  cam.updateProjectionMatrix();
  cam.position.set(x, y, z);
  cam.rotation.order = 'YXZ';
  cam.rotation.set(pitchDeg * rad, headingDeg * rad, 0);
  cam.updateMatrixWorld(true);
  return cam;
}
function makeShadow({ lift, far = 300 } = {}) {
  const shadow = new SunLightShadow();
  shadow.mapSize.set(3072, 3072);
  shadow.camera.near = 0.5;
  shadow.camera.far = far;
  shadow.camera.coordinateSystem = T.WebGPUCoordinateSystem;
  shadow.camera._reversedDepth = true;
  if (lift) assert.equal(C.liftSunCascadeCeiling(shadow), true);
  return shadow;
}
function sunLight(dir) {
  const light = new T.Object3D();
  light.position.copy(dir).multiplyScalar(1000);
  light.updateMatrixWorld(true);
  return light;
}

test('the ceiling constant is the tallest caster in the game\'s data', () => {
  const ctx = { window: { CITY: {} } };
  vm.runInNewContext(read('js/toronto-geodata.js'), ctx);
  const { landmarks, buildings } = ctx.window.CITY.GEO;
  const tallestLandmark = Math.max(...Object.values(landmarks).map((s) => s.h || 0));
  assert.equal(tallestLandmark, 553, 'the CN Tower');
  const tallestBuilding = Math.max(...buildings.map((b) => b[4]));
  assert.ok(tallestBuilding < tallestLandmark, `no mapped building (${tallestBuilding} m) is taller than the CN Tower`);
  assert.ok(C.TALLEST_CASTER_TOP >= tallestLandmark + 0.22, 'the mast tip stands on the 0.22 m sidewalk');
  assert.ok(C.TALLEST_CASTER_TOP <= tallestLandmark + 2, 'and the constant is not a loose guess');
  assert.ok(/CN Tower/.test(read('js/lighting.js').split('const TALLEST_CASTER_TOP')[0].slice(-900)), 'its comment says where it comes from');
});

test('the shift: the ceiling height along the sun, clamped at 14.5 deg', () => {
  assert.equal(C.sunCascadeShift(1), 554);
  assert.equal(C.sunCascadeShift(0.5), 1108);
  assert.equal(C.sunCascadeShift(0.25), 2216);
  assert.equal(C.sunCascadeShift(Math.sin(10 * rad)), 2216, 'a low sun is held at the clamp');
  assert.equal(C.sunCascadeShift(Math.sin(2 * rad)), 2216);
  assert.equal(C.sunCascadeShift(-0.2), 2216, 'a sun below the horizon never divides by ~0');
});

// A tower's top is in front of a cascade's near plane when its shadow falls in that cascade's ground footprint: the
// ground point under the top, along the sun (G), is inside the cascade's frustum (the lifted one has the stock far plane)
function check(shadow, ref, light, view, label, results) {
  shadow.updateMatrices(light, view);
  if (ref !== shadow) ref.updateMatrices(light, view);
  const sun = new T.Vector3().setFromMatrixPosition(light.matrixWorld).normalize();
  const baseSpots = [[0, 0], [60, 20], [-150, 90], [300, -40], [-40, -420], [700, 300], [-900, -250]];
  for (const [height, name] of [[C.TALLEST_CASTER_TOP, 'CN'], [290, 'FCP']]) {
    for (const [bx, bz] of baseSpots) {
      // (the tower's foot offsets from the view in the world frame, so some are behind the camera)
      const top = new T.Vector3(view.position.x + bx, height, view.position.z + bz);
      const ground = top.clone().addScaledVector(sun, -top.y / sun.y);
      for (let i = 0; i < shadow.getViewportCount(); i++) {
        if (!ref.getFrustum(i).containsPoint(ground)) continue; // its shadow lands elsewhere
        results.push({ label, name, i, inside: shadow.getFrustum(i).containsPoint(top), base: [bx, bz] });
      }
    }
  }
}
function sweep(lift) {
  const results = [];
  for (const elev of [15, 20, 30, 45, 60, 80]) {
    for (const az of [0, 90, 200, 300]) {
      const dir = sunAt(elev, az);
      const light = sunLight(dir);
      for (const [x, y, z, farRange] of [[0, 1.7, 0, 300], [500, 1.7, -300, 300], [-2000, 12, 800, 300], [0, 150, 0, 440], [0, 700, 200, 720]]) {
        const shadow = makeShadow({ lift, far: farRange });
        const ref = lift ? shadow : makeShadow({ lift: true, far: farRange });
        for (const heading of [0, 45, 90, 180, 270, 333]) {
          for (const pitch of [0, -35]) {
            check(shadow, ref, light, viewFrom(x, y, z, heading, pitch), `el${elev} az${az} @${x},${y},${z} h${heading} p${pitch}`, results);
          }
        }
      }
    }
  }
  return results;
}

test('with the lift, the top of the tallest tower and of a 290 m tower is inside every cascade its shadow lands in (sun 15-80 deg)', () => {
  const results = sweep(true);
  assert.ok(results.length > 1000, `a real sample (${results.length})`);
  const missed = results.filter((r) => !r.inside);
  assert.equal(missed.length, 0, `${missed.length} of ${results.length} tops clipped, first: ${JSON.stringify(missed[0])}`);
});

test('the stock cascades do clip them (so the check above can fail)', () => {
  const results = sweep(false);
  const missed = results.filter((r) => !r.inside);
  if (process.env.SWEEP) console.log('stock clipped', missed.length, 'of', results.length);
  assert.ok(missed.length > results.length * 0.05, `${missed.length} of ${results.length} clipped without the lift`);
  assert.ok(missed.some((r) => r.name === 'CN') && missed.some((r) => r.name === 'FCP'));
});

test('the shift is moved on the fitted cameras only: the same fit shifted by the same distance, never accumulating', () => {
  const dir = sunAt(40, 130);
  const light = sunLight(dir);
  const stock = makeShadow({});
  const lifted = makeShadow({ lift: true });
  const view = viewFrom(-400, 1.7, 250, 20);
  stock.updateMatrices(light, view);
  lifted.updateMatrices(light, view);
  const extra = C.sunCascadeShift(dir.y);
  const shot = (s) => [0, 1].map((i) => { const c = s.getCamera(i); return { p: c.position.clone(), far: c.far, near: c.near, w: c.right }; });
  const first = shot(lifted);
  shot(stock).forEach((s, i) => {
    assert.ok(Math.abs(first[i].far - (s.far + extra)) < 1e-6, 'far grows by the shift');
    assert.ok(Math.abs(first[i].p.distanceTo(s.p) - extra) < 1e-6, 'moved back along the sun by the shift');
    assert.ok(first[i].p.clone().sub(s.p).normalize().distanceTo(dir) < 1e-9, 'toward the sun');
    assert.equal(first[i].near, s.near); assert.equal(first[i].w, s.w);
  });
  for (let n = 0; n < 100; n++) {
    // the game moves the shadow range every frame (altitude, the quality net), the view too
    lifted.camera.far = 300 + (n % 7) * 60;
    stock.camera.far = lifted.camera.far;
    const v = viewFrom(-400 + n, 1.7, 250, 20 + n);
    lifted.updateMatrices(light, v);
    stock.updateMatrices(light, v);
    shot(stock).forEach((s, i) => {
      const l = shot(lifted)[i];
      assert.ok(Math.abs(l.far - (s.far + extra)) < 1e-6, `update ${n}: far`);
      assert.ok(Math.abs(l.p.distanceTo(s.p) - extra) < 1e-6, `update ${n}: position`);
    });
  }
  // and the matrices & frustums follow the moved cameras: a point just in front of the moved near plane is inside
  for (let i = 0; i < 2; i++) {
    const cam = lifted.getCamera(i);
    const inFront = cam.position.clone().addScaledVector(dir, -(cam.near + 1));
    assert.ok(lifted.getFrustum(i).containsPoint(inFront));
    const behind = cam.position.clone().addScaledVector(dir, 1);
    assert.ok(!lifted.getFrustum(i).containsPoint(behind));
    const m = lifted.getMatrix(i).clone();
    const clip = inFront.clone().applyMatrix4(m);
    assert.ok(clip.z >= 0 && clip.z <= 1, `the shadow matrix maps depth into [0,1] (${clip.z})`);
  }
});

test('a shadow without the internals keeps the stock behaviour and warns once; a missing view camera is a no-op', () => {
  const warns = [];
  const L = loadLighting((m) => warns.push(m));
  const calls = [];
  const fake = { updateMatrices(light, view) { calls.push([light, view]); }, getCamera: () => ({}), getViewportCount: () => 2 };
  assert.equal(L.liftSunCascadeCeiling(fake), true);
  for (let i = 0; i < 5; i++) fake.updateMatrices('l', 'v');
  assert.equal(calls.length, 5, 'the original always runs');
  assert.equal(warns.length, 1, 'one warning, not one per frame');
  assert.match(warns[0], /tall-tower shadow lift unavailable/);
  assert.equal(L.liftSunCascadeCeiling(null), false);
  assert.equal(L.liftSunCascadeCeiling({}), false);
  assert.equal(warns.length, 3);
  // a real shadow asked with no view camera does nothing (the stock method returns early too)
  const real = makeShadow({ lift: true });
  assert.doesNotThrow(() => real.updateMatrices(sunLight(sunAt(40, 0)), undefined));
});
