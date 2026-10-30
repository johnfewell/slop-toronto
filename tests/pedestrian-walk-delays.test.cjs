// Individual reactions to the WALK (traffic.js walk), ported from mrdoob/slop-newyork 35b0b84 and its
// pedestrian-signals test, on Toronto's crosswalks (walkOn / mayCross), midblock signals and crossovers (mayCrossMid).
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../js/traffic.js'), 'utf8');

// Two people at the curb of one crossing, 2 m apart on their own lines, walkDelay 0.2 s and 1.2 s; `state.walk` is the
// WALK (the junction's walkOn, or a midblock signal's SIGNALS.walk), `state.clear` no vehicle holding the crossing
function crossing({ mid = null } = {}) {
  const state = { walk: false, clear: true };
  const node = mid ? null : { curb: [], walkers: [] };
  const context = {
    clock: 0, KERB: 1.6, QUEUE_GAP: 0.62, PEDESTRIAN_DIVE_DURATION: 2.5, PED_SPAWN_DISTANCE: 60,
    nearEdges: [], walkedNodes: [], nearMidSet: new Set(), CROSS_CHANCE: { signal: 0.35, pxo: 0.3 },
    pedRoutes: { next: () => null }, atCurb() {}, markMid() {}, nearView: () => true,
    clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    curbProgress: (p) => (p.dir > 0 ? p.t : p.len - p.t),
    walkOn: () => state.walk,
    mayCross: () => state.walk && state.clear,
    // a crossover's drivers stop for people waiting; a signal's crossing needs its WALK too
    mayCrossMid: (p) => (p.mid.kind !== 'signal' || state.walk) && state.clear,
    SIGNALS: { walk: () => state.walk, crossingIndex: (i) => i, call() {}, busy() {} }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  const PED_ACCEL ='), source.indexOf('  // Limit an escape to')), context);
  const fn = source.match(/ {2}function walk\([^]*?\n {2}\}/)?.[0];
  assert.ok(fn, 'walk');
  vm.runInContext(fn, context);
  const people = [0, 1].map((i) => ({
    placed: true, node, mid, side: 0, ax: i * 2, az: 0, ux: 0, uz: 1, len: 20, t: 1.6, x: i * 2, z: 1.6,
    line: i * 2, dir: 1, clx: 1, clz: 0, coord: 0, goalX: 0, goalZ: 1000, goalTime: Infinity, restTime: Infinity,
    socialTime: Infinity, walkDelay: 0.2 + i, walkAt: -1, waiting: false, speed: 1.3, v: 0, pause: 0, route: {},
    nextRoute: null, nextLeg: 0, avoidUntil: 0, avoidSpeed: 0, avoidT: 0, diveStart: -Infinity, dodge: 0,
    dodgeTarget: 0, conversation: null
  }));
  if (node) node.curb.push(...people);
  const advance = (seconds) => {
    const steps = Math.ceil(seconds / 0.05);
    for (let i = 0; i < steps; i++) {
      context.clock += seconds / steps;
      if (node) node.walkers.length = 0;
      for (const p of people) context.walk(p, seconds / steps);
    }
  };
  return { people, state, advance, context };
}

test('pedestrians waiting at WALK set off at individual times', () => {
  const { people, state, advance } = crossing();
  advance(0.1);
  assert.ok(people.every((p) => p.waiting && p.t === 1.6));
  state.walk = true;
  advance(0.35);
  assert.ok(people[0].t > 1.6 && !people[0].waiting);
  assert.equal(people[1].t, 1.6);
  assert.ok(people[1].waiting, 'still waiting at the curb (and calling the signal, crossing traffic yielding to it)');
  advance(1);
  assert.ok(people[1].t > 1.6 && !people[1].waiting);
});

test('a new WALK phase resets an unfinished reaction delay', () => {
  const { people, state, advance } = crossing();
  state.walk = true;
  advance(0.2);
  state.walk = false;
  advance(0.1);
  assert.equal(people[1].walkAt, -1);
  state.walk = true;
  advance(1.1);
  assert.equal(people[1].t, 1.6);
  advance(0.2);
  assert.ok(people[1].t > 1.6);
});

test('reverse crossings respect red and reaction delays despite curb rounding', () => {
  const { people, state, advance } = crossing();
  for (const p of people) { p.dir = -1; p.t = p.len - 1.6; p.z = p.t; }
  advance(0.2);
  assert.ok(people.every((p) => p.waiting && p.t === p.len - 1.6 && p.v === 0));
  state.walk = true;
  advance(0.35);
  assert.ok(people[0].t < people[0].len - 1.6);
  assert.equal(people[1].t, people[1].len - 1.6);
  advance(1);
  assert.ok(people[1].t < people[1].len - 1.6);
});

test('reaction delays do not bypass traffic checks or restart when a vehicle clears', () => {
  const { people, state, advance } = crossing();
  state.walk = true;
  state.clear = false;
  advance(2);
  assert.ok(people.every((p) => p.waiting && p.t === 1.6));
  state.clear = true;
  advance(0.05);
  assert.ok(people.every((p) => p.t > 1.6));
});

test('pedestrians already crossing continue when WALK ends', () => {
  const { people, advance } = crossing();
  for (const p of people) { p.t = 3; p.z = 3; p.v = p.speed; }
  advance(0.2);
  assert.ok(people.every((p) => p.t > 3 && !p.waiting));
});

// --- Toronto ---
test('a midblock signal staggers its walkers the same way', () => {
  const { people, state, advance } = crossing({ mid: { kind: 'signal', i: 3 } });
  advance(0.1);
  assert.ok(people.every((p) => p.waiting && p.t === 1.6));
  state.walk = true;
  advance(0.35);
  assert.ok(people[0].t > 1.6);
  assert.equal(people[1].t, 1.6);
  advance(1);
  assert.ok(people[1].t > 1.6);
});

test('a crossover (PXO) has no WALK to react to: people go once the drivers stop', () => {
  const { people, state, advance } = crossing({ mid: { kind: 'pxo', i: 0 } });
  state.clear = false;
  advance(0.5);
  assert.ok(people.every((p) => p.waiting && p.t === 1.6));
  state.clear = true;
  advance(0.1);
  assert.ok(people.every((p) => p.t > 1.6 && !p.waiting), 'no reaction delay');
});

test('an escape from the player does not wait out the reaction delay', () => {
  const { people, state, advance, context } = crossing();
  advance(0.1);
  state.walk = true;
  const p = people[1];
  Object.assign(p, { avoidUntil: context.clock + 5, avoidSpeed: 5, avoidT: p.t + 10 });
  advance(0.2);
  assert.ok(p.t > 1.6 && !p.waiting);
});

test('turning round or taking the next leg forgets the old WALK', () => {
  const { people, state, advance } = crossing();
  state.walk = true;
  advance(0.1);
  const p = people[1];
  assert.ok(p.walkAt > 0);
  // reaching the end of the track with nowhere further: turns round at the far curb, a fresh reaction there
  p.t = p.len - 0.01; p.v = p.speed;
  advance(0.05);
  assert.equal(p.dir, -1);
  assert.equal(p.walkAt, -1);
});
