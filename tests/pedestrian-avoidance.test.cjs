const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../js/traffic.js'), 'utf8');
function harness(overrides = {}) {
  const context = {
    clock: 10, pedRange: 40, PED_AVOID_INTERVAL: 0.12, PEDESTRIAN_DIVE_DURATION: 2.5,
    KERB: 1.6, QUEUE_GAP: 0.62, peds: [],
    player: { x: 0, z: 0, y: 0, fx: 0, fz: 1, vx: 0, vz: 20, halfW: 0.86, halfL: 2.18 },
    pedGround: () => 0, mayCross: () => false, mayCrossMid: () => true,
    curbProgress: p => p.dir > 0 ? p.t : p.len - p.t,
    pedRoutes: { canDodge: () => false },
    endConversation() {},
    clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    ...overrides
  };
  vm.createContext(context);
  const constants = source.slice(source.indexOf('  const PED_ACCEL ='), source.indexOf('  // Limit an escape to'));
  vm.runInContext(constants, context);
  for (const name of ['escapeRoom', 'playerContactTime', 'turnPed', 'dodgeClear', 'avoidPlayer']) {
    const fn = source.match(new RegExp(`  function ${name}\\([^]*?\\n  \\}`))?.[0];
    assert.ok(fn, name);
    vm.runInContext(fn, context);
  }
  return context;
}
function pedestrian(extra = {}) {
  return { placed: true, x: 0, z: 10, ax: -5, az: 10, ux: 1, uz: 0, t: 5, len: 10,
    dir: 1, v: 1.4, speed: 1.4, node: null, mid: {}, route: { edge: {} },
    dodge: 0, dodgeTarget: 0, diveStart: -Infinity, diveHeading: 0, diveT: 0,
    avoidUntil: 0, avoidCheck: 0, avoidSpeed: 0, avoidT: 0, resumeDir: 0,
    pause: 0, conversation: null, restTime: 0, socialTime: 0, ...extra };
}

test('prediction detects a fast approaching car and ignores a departing car', () => {
  const h = harness(), p = pedestrian();
  assert.ok(h.playerContactTime(p, p.speed, 5, false) < 0.6);
  h.player.vz = -20;
  assert.equal(h.playerContactTime(p, p.speed, 5, false), Infinity);
});

test('pedestrians escape along a permitted Toronto midblock crossing', () => {
  const h = harness(), p = pedestrian();
  h.peds.push(p);
  h.avoidPlayer(p);
  assert.ok(p.avoidUntil > h.clock);
  assert.ok(p.avoidSpeed > 0 || p.diveStart === h.clock, 'run or dive toward a checked landing');
  assert.equal(p.resumeDir, 1, 'remember the original destination');
});

test('avoidance respects the midblock curb permission and the people waiting ahead', () => {
  const h = harness({ mayCrossMid: () => false });
  const p = pedestrian({ t: 1, x: -4 });
  assert.ok(Math.abs(h.escapeRoom(p, 1) - 0.6) < 1e-9, 'stop at the midblock curb');
  h.mayCrossMid = () => true;
  h.peds.push(p, pedestrian({ x: -3, t: 2 }));
  assert.ok(h.escapeRoom(p, 1) < 0.4, 'leave room for the person ahead');
});

test('people on a bridge or already in a ragdoll do not dodge traffic below', () => {
  for (const extra of [{}, { knock: { phase: 'rag' } }]) {
    const h = harness({ pedGround: () => extra.knock ? 0 : 7.6 });
    const p = pedestrian(extra);
    h.avoidPlayer(p);
    assert.equal(p.avoidUntil, 0);
    assert.equal(p.diveStart, -Infinity);
  }
});

test('a sideways escape requires clearance for its landing and nearby people', () => {
  const h = harness(), p = pedestrian({ mid: null });
  h.peds.push(p);
  assert.equal(h.dodgeClear(p, 1.9, true), false, 'blocked sidewalk');
  h.pedRoutes.canDodge = () => true;
  assert.equal(h.dodgeClear(p, 1.9, true), true);
  h.peds.push(pedestrian({ x: 0, z: 8.5 }));
  assert.equal(h.dodgeClear(p, 1.9, true), false, 'another pedestrian occupies the landing');
});

test('real character rigs finish dives with finite poses and resume walking on their surface', async () => {
  const THREE = await import('three');
  const window = { CITY: { THREE, TSL: {}, Addons: {} } };
  vm.runInNewContext(readFileSync(join(__dirname, '../js/pedestrians.js'), 'utf8'), { window, Math });
  for (const female of [false, true]) {
    const rig = new window.CITY.PersonRig({ female });
    const ground = () => 7.6;
    for (let frame = 0; frame < 150; frame++) {
      rig.update(1 / 60, 0, Math.min(frame / 60 * 3.8, 1.9), 0, ground, null, 0, true, frame / 60);
      assert.ok(rig.pose.every(Number.isFinite), `finite pose at frame ${frame}`);
      assert.ok(rig.pelvisY >= 7.6, 'stay above the bridge deck');
    }
    assert.equal(rig.diving, true);
    rig.update(1 / 60, 0, 1.9, 0, ground);
    assert.equal(rig.diving, false);
    assert.ok(rig.pose.every(Number.isFinite));
  }
});
