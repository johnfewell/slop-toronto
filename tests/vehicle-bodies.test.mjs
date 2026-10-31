// The street fleet's body kinds (js/traffic.js CAR_KINDS / fleetBody, after mrdoob's slop-newyork 52f84db): the mix
// handed out per quality tier, and each kind's lofted geometry (js/actor-models.js) against the sizes the traffic
// drives, spaces and collides it with. Also the shared style code and the Ontario plates.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const read = (file) => readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8');

const traffic = read('traffic.js');
const block = (re, what) => {
  const m = traffic.match(re);
  assert.ok(m, `${what} is present in traffic.js`);
  return m[0];
};
const { CAR_KINDS, FLEET_MIX, fleetBody } = vm.runInNewContext(`
  ${block(/const CAR_KINDS = \{[\s\S]*?\n\};/, 'CAR_KINDS')}
  ${block(/const FLEET_MIX = \[[\s\S]*?\];/, 'FLEET_MIX')}
  ${block(/function fleetBody\(i\) \{[\s\S]*?\n\}/, 'fleetBody')}
  ({ CAR_KINDS, FLEET_MIX, fleetBody });
`);

const window = { CITY: { THREE, TSL, Addons: { mergeGeometries, mergeVertices }, cityUniforms: {} } };
vm.runInNewContext(read('actor-models.js'), { window, Math, console });
const C = window.CITY;
const KINDS = Object.keys(CAR_KINDS);
const TIERS = Object.fromEntries([...read('quality.js').matchAll(/^ {2}(\w+): \{[\s\S]*?cars: (\d+)/gm)].map((m) => [m[1], Number(m[2])]));

const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
const bounds = (g) => {
  g.computeBoundingBox();
  return g.boundingBox;
};

test('the quality tiers are read', () => {
  assert.deepEqual(Object.keys(TIERS).sort(), ['high', 'low', 'medium']);
});

test('every fleet kind is a body spec, and the mix holds vans, minivans and pickups', () => {
  assert.deepEqual(KINDS.sort(), ['minivan', 'pickup', 'sedan', 'suv', 'taxi', 'van']);
  for (const kind of FLEET_MIX) assert.ok(CAR_KINDS[kind] && C.BODY_SPECS[kind], `${kind} is a fleet kind with a body`);
  const share = Object.fromEntries(KINDS.map((k) => [k, FLEET_MIX.filter((x) => x === k).length / FLEET_MIX.length]));
  assert.deepEqual(share, { taxi: 0.2, sedan: 0.25, suv: 0.3, van: 0.1, minivan: 0.1, pickup: 0.05 });
});

for (const [tier, cars] of Object.entries(TIERS)) {
  test(`${tier} tier (${cars} cars): every kind is on the street in about its share, police cruisers are sedans`, () => {
    const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
    let police = 0;
    for (let i = 0; i < cars; i++) {
      const { bodyType, isPolice } = fleetBody(i);
      counts[bodyType]++;
      if (isPolice) {
        police++;
        assert.equal(bodyType, 'sedan', 'police cruisers are sedans (their light bar and livery fit its roof and sides)');
      }
    }
    assert.equal(police, Math.ceil((cars - 6) / 100));
    // A kind's meshes exist even when it is short, but each new kind is really there on the phone tier too
    for (const kind of ['van', 'minivan', 'pickup']) assert.ok(counts[kind] >= 4, `${counts[kind]} ${kind}s`);
    const expected = { taxi: 0.2, sedan: 0.25, suv: 0.3, van: 0.1, minivan: 0.1, pickup: 0.05 };
    for (const kind of KINDS) {
      assert.ok(Math.abs(counts[kind] / cars - expected[kind]) <= 0.03, `${kind}: ${counts[kind]} of ${cars}`);
    }
  });
}

for (const kind of KINDS) {
  test(`${kind}: the geometry and the sizes traffic drives & collides it with agree`, () => {
    const spec = C.BODY_SPECS[kind];
    const k = CAR_KINDS[kind];
    const full = C.buildCarGeometry(spec, true);
    const near = C.buildCarGeometry(spec, false);
    const far = C.buildCarProxyGeometry(spec);
    const b = bounds(full);
    const bodyHalfL = (spec.zFront - spec.zRear) / 2;
    const bodyHalfW = Math.max(...spec.halfWidth.map((p) => p[1])) + spec.archFlare;

    // Bumper to bumper the geometry ends at the spec's tips (the step bumper of a van may stand a little proud)
    assert.ok(Math.abs(b.max.z - spec.zFront) < 0.01, `front ${b.max.z}`);
    assert.ok(b.min.z <= spec.zRear + 0.001 && b.min.z > spec.zRear - 0.1, `rear ${b.min.z}`);
    // On the road: tyres touch the ground (their 18-gon's flat bottom within a centimetre), nothing below it; a sensible
    // roof height (the van's high roof the tallest)
    assert.ok(b.min.y >= 0 && b.min.y < 0.01, `lowest point ${b.min.y}`);
    assert.ok(b.max.y > 1.4 && b.max.y < (kind === 'van' ? 2.75 : 2.05), `roof ${b.max.y}`);
    // Symmetric across, mirrors included, inside a lane
    assert.ok(Math.abs(b.max.x + b.min.x) < 1e-6);
    assert.ok(b.max.x > bodyHalfW && b.max.x < 1.3, `half width with mirrors ${b.max.x}`);

    // The collider (vehicle-physics.js: halfL x halfWidth) covers most of the body and never reaches past it
    assert.ok(k.halfL <= bodyHalfL && k.halfL >= 0.95 * bodyHalfL, `halfL ${k.halfL} vs body ${bodyHalfL}`);
    assert.ok(k.halfWidth <= bodyHalfW && k.halfWidth >= 0.85 * bodyHalfW, `halfWidth ${k.halfWidth} vs body ${bodyHalfW}`);
    // Spacing keeps at least the collider apart; the path's axle is the body's
    assert.ok(k.half >= k.halfL && k.half <= bodyHalfL + 0.1, `half ${k.half}`);
    assert.ok(Math.abs(k.axle - spec.wheelZ) < 0.05, `axle ${k.axle} vs wheelZ ${spec.wheelZ}`);
    assert.ok(k.mass >= 1500 && k.mass <= 3000);
    assert.ok(['sedan', 'suv'].includes(k.engine), 'an engine voice audio-synthesis.js has');

    // The far proxy stands where the full model does
    const fb = bounds(far);
    for (const axis of ['x', 'y', 'z']) {
      assert.ok(Math.abs(fb.max[axis] - b.max[axis]) < 0.25 && Math.abs(fb.min[axis] - b.min[axis]) < 0.25, `proxy ${axis}`);
    }
    // One material for both LODs: the same attributes
    const names = (g) => Object.keys(g.attributes).sort();
    assert.deepEqual(names(near), ['normal', 'partId', 'position', 'uv']);
    assert.deepEqual(names(far), names(near));

    // Budgets (the phone tier draws the same models): full body without wheels, the far proxy
    assert.ok(tris(near) <= 2600, `${tris(near)} near triangles`);
    assert.ok(tris(far) <= 520, `${tris(far)} proxy triangles`);

    // Plates are mounted on the (raked) tips
    for (const front of [true, false]) {
      const z = C.carTipZ(spec, spec.plates[front ? 0 : 1], front);
      assert.ok(z <= spec.zFront && z >= spec.zRear && Math.abs(z - (front ? spec.zFront : spec.zRear)) < 0.2);
    }
  });
}

test('the shared spinning wheel stays cheap', () => {
  assert.ok(tris(C.buildSteerableWheelGeo(C.BODY_SPECS.sedan, 1)) <= 300);
});

test('style codes: livery 1 is still the police flag and 0 plain paint (multiplayer remote cars)', () => {
  assert.equal(C.CAR_LIVERY.POLICE, 1);
  assert.equal(C.carStyleCode({ livery: C.CAR_LIVERY.POLICE }), 1);
  assert.equal(C.carStyleCode(), 0);
  const code = C.carStyleCode({ livery: C.CAR_LIVERY.COURIER_ORANGE, metallic: 1, trim: 2, wheel: 3 });
  assert.equal(code & 7, C.CAR_LIVERY.COURIER_ORANGE);
  assert.equal((code >> 3) & 1, 1);
  assert.equal((code >> 4) & 3, 2);
  assert.equal((code >> 6) & 3, 3);
  assert.ok(Object.values(C.CAR_LIVERY).every((v) => v >= 0 && v < 8));
  // the remote players' cars are sedans: the spec multiplayer.js builds from
  assert.ok(C.BODY_SPECS.sedan && C.buildCarGeometry(C.BODY_SPECS.sedan, true).attributes.partId);
});

test('Ontario plates: white, blue (passenger) or black (commercial) lettering, ONTARIO and a crown-like mark', () => {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (target, key) => (key in target ? target[key] : (...args) => calls.push([key, target.fillStyle, ...args])),
    set: (target, key, value) => { target[key] = value; return true; }
  });
  C.drawOntarioPlate(ctx, 0, 0, 256, 128, ['CKTR', '418']);
  const texts = calls.filter((c) => c[0] === 'fillText');
  assert.deepEqual(texts.map((c) => c[2]), ['ONTARIO', 'CKTR', '418', 'YOURS TO DISCOVER']);
  assert.ok(texts.every((c) => c[1] === '#1d3f8f'), 'blue lettering');
  assert.equal(calls.find((c) => c[0] === 'fillRect')[1], '#f6f7f4', 'white plate');
  assert.ok(calls.filter((c) => c[0] === 'arc').length === 3, 'the crown-like mark: three points with a ball each');
  calls.length = 0;
  C.drawOntarioPlate(ctx, 0, 0, 256, 128, ['AB71', '304'], { commercial: true });
  assert.ok(calls.filter((c) => c[0] === 'fillText').every((c) => c[1] === '#16181b'), 'black commercial lettering');
  const source = read('actor-models.js');
  assert.doesNotMatch(source, /NEW YORK|NYPD|TLC|Boro/, 'no New York plates or liveries left in the car code');
});
