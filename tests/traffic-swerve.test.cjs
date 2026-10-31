// st-hde: street traffic steers through its front wheels and dodges the player (after mrdoob's 17c0973), on Toronto's
// streets: within its roadway, across the centre line only where nobody is coming, never onto another deck, nor into a
// streetcar or anyone on foot; braking where there is no room. The production code of js/traffic.js is run as is
// (relateToPlayer, react and the rest of the dodge section, the steering, locate, the streetcar section's obstacleGap),
// with a straight stand-in for accelerate's other terms (the free road, the player, the streetcars ahead).
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../js/traffic.js'), 'utf8');
const inner = (name) => {
  const m = source.match(new RegExp(`\\n  function ${name}\\([^]*?\\n  \\}`));
  assert.ok(m, `${name} is present`);
  return m[0];
};
const line = (re, what) => {
  const m = source.match(re);
  assert.ok(m, `${what} is present`);
  return m[0];
};
const topConst = (name) => line(new RegExp(`^const ${name} = .*$`, 'm'), name);
const innerConst = (name) => line(new RegExp(`^  const ${name} = .*$`, 'm'), name);
const streetcarSection = (() => {
  const a = source.indexOf('  // --- Streetcars: gap to the nearest streetcar module');
  const b = source.indexOf('  // --- end streetcars ---', a);
  assert.ok(a > 0 && b > a, 'streetcar section');
  return source.slice(a, b);
})();

const FUNCTIONS = ['relateToPlayer', 'playerGap', 'brake', 'react', 'threatTime', 'passPlayer', 'slowInLane', 'clearShift',
  'playerClear', 'wayRound', 'followPlayer', 'dodgeAcc', 'drive', 'steer', 'approach', 'wheelTowards', 'previewPoint', 'lanePoint',
  'pathPoint', 'locate', 'pose'];
const TOP = ['CAR_DRIVER', 'BUS_DRIVER', 'LOOKAHEAD', 'AVOID_NOTICE', 'AVOID_HOLD', 'PASS_LOOK', 'PASS_MARGIN', 'PASS_SPEED',
  'PLAYER_S0', 'SWERVE_MAX'];
const INNER = ['freeAcc', 'laneSide', 'threat', 'DODGE_DT', 'predicted', 'playerBox', 'wayPoint', 'sweptBox', 'otherBox', 'bendA',
  'bendB', 'front', 'rear'];
const DT = 1 / 60;

// A road heading +z from z = 0 (its right is -x): lanes at `lanes` m right of its centre line (x = 0), curbs at
// x = -right and x = left (isRoadClear), optionally a deck at height `y`
function world({ lanes = [1.8], right = 3.6, left = 3.6, y = 0, divided = false, opposite = true, len = 400,
  isRoadClear = null } = {}) {
  const edge = { sx: 0, sz: 0, dx: 0, dz: 1, rx: -1, rz: 0, len, lanes, h0: y, h1: y, divided,
    opposite: opposite ? {} : null };
  const context = {
    clock: 0, vehicles: [], peds: [], movers: [],
    player: { active: true, entity: null, mode: 'person', x: 0, y, z: 0, vx: 0, vz: 0, fx: 0, fz: 1, halfW: 0.32, halfL: 0.32 },
    network: { isRoadClear: isRoadClear || ((x) => x >= -right && x <= left) },
    clamp: (x, lo, hi) => Math.max(lo, Math.min(hi, x)),
    edgeY: () => y, connector() { throw new Error('no junction'); }, curvePoint() { throw new Error('no curve'); },
    changeLanes() {}, enter() {}, leave() {}
  };
  vm.createContext(context);
  vm.runInContext([...TOP.map(topConst), ...INNER.map(innerConst)].join('\n').replace(/^\s*const /gm, 'var '), context);
  vm.runInContext(`${streetcarSection}\n${FUNCTIONS.map(inner).join('\n')}
    // (accelerate's other terms: the free road, and keeping behind the streetcars ahead)
    function accelerate(v) {
      v.gap = Infinity;
      let worst = followPlayer(v);
      const og = obstacleGap(v);
      if (og.gap < LOOKAHEAD) {
        worst = Math.min(worst, brake(v, Math.max(0.1, og.gap), og.speed));
        if (og.gap < v.gap) { v.gap = og.gap; v.leaderSpeed = og.speed; }
      }
      v.acc = clamp(freeAcc(v) + worst, -9, v.driver.a);
      dodgeAcc(v);
    }`, context);
  const car = (s, speed, extra = {}) => {
    const v = { bus: false, half: 2.25, halfWidth: 0.86, axle: 1.38, driver: context.CAR_DRIVER, v0: 12, edge, lane: 0,
      s, speed, acc: 0, gap: Infinity, leaderSpeed: 0, move: { out: [], to: null, turn: 'S' }, conn: null, cs: 0,
      trail: null, commit: null, wait: 0, laneTimer: 1e9, dl: 0, dlv: 0, blink: 0, dodge: 0, evade: 0, alarm: 0,
      panicUntil: 0, panicAcc: 0, reaction: 0.8, passCheck: 0, passSpeed: 6, x: 0, z: 0, tx: 0, tz: 1, nose: 0, yaw: 0,
      yawRate: 0, steer: 0, delta: 0, pitch: 0, roll: 0, pitchVel: 0, rollVel: 0, vx: 0, vz: 0, yawOffset: 0, yawVel: 0,
      impactTime: 0, pAhead: Infinity, pRight: 0, pSpeed: 0, ...extra };
    context.locate(v);
    v.prevX = v.x;
    v.prevZ = v.z;
    context.vehicles.push(v);
    return v;
  };
  // An oncoming car at z, keeping on at `speed` in the lane `x` (it doesn't steer: it is only in the way)
  const oncoming = (z, speed, x = 1.8) => {
    const o = { edge: {}, lane: 0, conn: null, s: 0, x, y, z, yaw: Math.PI, yawOffset: 0, speed, half: 2.25, halfWidth: 0.86,
      move: () => { o.z -= o.speed * DT; } };
    context.vehicles.push(o);
    return o;
  };
  // A five-module streetcar, one box, on the track at x heading +z (dir 1) or -z
  const streetcar = (z, speed, x = -1.8, dir = 1) => {
    const o = { x, y, z, yaw: dir > 0 ? 0 : Math.PI, halfW: 1.27, halfL: 15.3, speed };
    context.movers.push(o);
    return o;
  };
  // Someone on foot, walking at (vx, vz)
  const ped = (x, z, vx = 0, vz = 0) => {
    const speed = Math.hypot(vx, vz);
    const p = { placed: true, knock: null, x, z, ux: speed ? vx / speed : 0, uz: speed ? vz / speed : 1, dir: 1, v: speed };
    context.peds.push(p);
    return p;
  };
  const setPlayer = (mode, x, z, heading = 0, speed = 0) => {
    const P = context.player;
    Object.assign(P, { mode, x, z, fx: Math.sin(heading), fz: Math.cos(heading), vx: Math.sin(heading) * speed,
      vz: Math.cos(heading) * speed });
    P.halfW = mode === 'cyclist' ? 0.35 : mode === 'person' ? 0.32 : 0.86;
    P.halfL = mode === 'cyclist' ? 0.85 : mode === 'person' ? 0.32 : 2.18;
    P.heading = heading;
    P.speed = speed;
  };
  // Separating-axis distance between two boxes; < 0: they overlap
  const box = (x, z, yaw, halfL, halfW) => ({ x, z, tx: Math.sin(yaw), tz: Math.cos(yaw), halfL, halfW });
  const separation = (a, b) => context.moverSeparation(a, a.halfL, a.halfW, b, b.tx, b.tz);
  const carBox = (v) => box(v.x, v.z, v.yaw, v.half, v.halfWidth);
  const playerBox = () => box(context.player.x, context.player.z, context.player.heading || 0, context.player.halfL, context.player.halfW);
  // One frame, as update() runs the traffic: the player, the others and the streetcars move on first
  const step = (v) => {
    const P = context.player;
    P.x += P.vx * DT;
    P.z += P.vz * DT;
    for (const o of context.vehicles) if (o.move instanceof Function) o.move();
    for (const o of context.movers) {
      o.x += Math.sin(o.yaw) * o.speed * DT;
      o.z += Math.cos(o.yaw) * o.speed * DT;
    }
    for (const p of context.peds) {
      p.x += p.ux * p.dir * p.v * DT;
      p.z += p.uz * p.dir * p.v * DT;
    }
    context.clock += DT;
    v.prevX = v.x;
    v.prevZ = v.z;
    context.relateToPlayer(v);
    context.react(v, DT);
    context.drive(v, DT);
    context.locate(v);
    context.pose(v, DT);
  };
  // Run v for `seconds`, recording the closest it came to the player, the others, the streetcars and people on foot,
  // how far out it went (body edges, x) and whether it swerved or steered round the player
  const run = (v, seconds, record = {}) => {
    const r = Object.assign({ player: Infinity, others: Infinity, streetcars: Infinity, peds: Infinity, minX: Infinity,
      maxX: -Infinity, dodges: new Set(), maxY: -Infinity, minY: Infinity }, record);
    for (let k = 0; k < seconds * 60; k++) {
      step(v);
      const b = carBox(v);
      r.player = Math.min(r.player, separation(b, playerBox()));
      for (const o of context.vehicles) if (o !== v) r.others = Math.min(r.others, separation(b, box(o.x, o.z, o.yaw, o.half, o.halfWidth)));
      for (const o of context.movers) r.streetcars = Math.min(r.streetcars, separation(b, box(o.x, o.z, o.yaw, o.halfL, o.halfW)));
      for (const p of context.peds) r.peds = Math.min(r.peds, separation(b, box(p.x, p.z, 0, 0.3, 0.3)));
      // (the body's corners across the road)
      const ex = Math.abs(Math.cos(v.yaw)) * v.halfWidth + Math.abs(Math.sin(v.yaw)) * v.half;
      r.minX = Math.min(r.minX, v.x - ex);
      r.maxX = Math.max(r.maxX, v.x + ex);
      if (v.dodge) r.dodges.add(v.dodge);
    }
    return r;
  };
  return { context, edge, car, oncoming, streetcar, ped, setPlayer, run, step, separation, carBox, playerBox };
}

// --- The decision: when, which way, how far ---

test('drivers notice a player about to hit them only shortly before, and react later still (17c0973)', () => {
  const w = world({ right: 8, left: 8 });
  const v = w.car(10, 12);
  w.setPlayer('cyclist', -1.8, 10 + 60, Math.PI, 14); // head-on, 2.1 s off
  for (let k = 0; k < 0.3 * 60; k++) { w.context.player.z -= 14 * DT; v.z += 12 * DT; w.context.react(v, DT); w.context.clock += DT; }
  assert.equal(v.alarm, 0, 'not noticed yet');
  for (let k = 0; k < 0.7 * 60; k++) { w.context.player.z -= 14 * DT; v.z += 12 * DT; w.context.react(v, DT); w.context.clock += DT; }
  assert.ok(v.alarm > 0 && v.panicUntil === 0, 'noticed, not reacting yet');
  for (let k = 0; k < 0.2 * 60; k++) { w.context.player.z -= 14 * DT; v.z += 12 * DT; w.context.react(v, DT); w.context.clock += DT; }
  assert.ok(v.panicUntil > 0, 'reacting, about a second before impact');
  assert.equal(v.panicAcc, -1, 'braking: the player would hit its front');
});

test('a player passing in the next lane, or going away, is no threat', () => {
  const w = world();
  const v = w.car(10, 12);
  w.setPlayer('car', 1.8, 0, 0, 20); // overtaking in the next lane
  assert.equal(w.context.threatTime(v), Infinity);
  w.setPlayer('car', -1.8, 30, 0, 20); // ahead in its lane, pulling away
  assert.equal(w.context.threatTime(v), Infinity);
  w.setPlayer('person', -1.8, 30, 0, 0); // standing in its lane, but on a deck above
  w.context.player.y = 8;
  assert.equal(w.context.threatTime(v), Infinity);
});

test('swerving clear of a player coming straight at it: to the right, through the front wheels', () => {
  const w = world({ lanes: [1.8, 5.4], right: 7.2, left: 7.2, opposite: false });
  const v = w.car(10, 12);
  w.setPlayer('cyclist', -1.8, 60, Math.PI, 8);
  const r = w.run(v, 3);
  assert.ok(r.dodges.has(1), 'swerved');
  assert.ok(r.player > 0.1, `kept clear of the player (${r.player.toFixed(2)} m)`);
  assert.ok(r.minX < -3.5, 'to its right');
  assert.ok(r.minX > -7.2 && r.maxX < 7.2, 'on the road');
});

test('the swerve goes no further than it needs: within its lane for a player at the edge of it', () => {
  const w = world({ lanes: [1.8, 5.4], right: 7.2, left: 7.2, opposite: false });
  const v = w.car(10, 12, { lane: 1 }); // the curb lane, centre x = -5.4
  w.setPlayer('cyclist', -4.0, 40, Math.PI, 6); // riding the wrong way along the lane's left edge
  w.context.locate(v);
  w.context.relateToPlayer(v);
  const t = w.context.threatTime(v);
  assert.ok(t < w.context.AVOID_NOTICE);
  const shift = w.context.clearShift(v, 1, true); // right, away from it
  assert.ok(shift > 0 && shift <= 1.2, `a short swerve (${shift})`);
  assert.ok(v.dl + shift + v.halfWidth <= 1.8 + 0.4, 'its body stays (all but) within its lane');
});

test('swerving behind a player crossing its way', () => {
  const w = world({ lanes: [1.8, 5.4], right: 7.2, left: 7.2, opposite: false });
  const v = w.car(10, 11);
  // a cyclist crossing from the left (+x) to the right at 6 m/s, due at the same spot
  w.setPlayer('cyclist', 10, 10 + 11 * 2.0, -Math.PI / 2, 6);
  const r = w.run(v, 3);
  assert.ok(r.dodges.has(1), 'swerved');
  assert.ok(v.evade > 0 || r.maxX > 0, 'left, behind the player');
  assert.ok(r.player > 0.05, `missed (${r.player.toFixed(2)} m)`);
});

test('no room either side: only braking, never over the curb', () => {
  const w = world({ lanes: [1.8], right: 3.0, left: 0.6, opposite: false }); // one 3.6 m lane between curbs
  const v = w.car(10, 12);
  w.setPlayer('cyclist', -1.8, 55, Math.PI, 6);
  const r = w.run(v, 2.5);
  assert.ok(!r.dodges.has(1), 'no swerve');
  assert.ok(v.panicAcc === -1 || v.speed < 1, 'braked');
  assert.ok(r.minX >= -3.0 - 0.05 && r.maxX <= 0.6 + 0.05, `kept between the curbs (${r.minX.toFixed(2)}..${r.maxX.toFixed(2)})`);
});

test('no swerve across a divided road\'s median, nor off a deck\'s lanes', () => {
  const div = world({ lanes: [1.8], right: 3.6, left: 9, divided: true });
  const v = div.car(10, 12);
  div.setPlayer('cyclist', -2.6, 45, Math.PI, 6); // coming at its right half: left is the way away, over the median
  div.context.locate(v);
  assert.equal(div.context.wayRound(v, -2.2, true), false, 'not over the median');
  // on the Gardiner's deck: the ground below is all buildings (isRoadClear false), the deck is the lanes
  const deck = world({ lanes: [1.8, 5.4], y: 8, isRoadClear: () => false, opposite: false });
  const d = deck.car(10, 14, { y: 8 });
  deck.context.locate(d);
  assert.equal(deck.context.wayRound(d, 2.4, true), true, 'over into its other lane on the deck (right)');
  assert.equal(deck.context.wayRound(d, -2.4, true), false, 'not off the deck\'s edge (left)');
});

// --- Steering ---

test('a lane change is steered: the car turns only as fast as its wheels let it, and settles in its lane', () => {
  const w = world({ lanes: [1.8, 5.4], right: 7.2, left: 7.2 });
  w.context.player.active = false;
  const v = w.car(10, 12, { dl: 3.6 });
  let yawRate = 0, wheelRate = 0;
  for (let k = 0; k < 6 * 60; k++) {
    const { yaw, delta } = v;
    w.step(v);
    yawRate = Math.max(yawRate, Math.abs(v.yaw - yaw) / DT);
    wheelRate = Math.max(wheelRate, Math.abs(v.delta - delta) / DT);
  }
  assert.ok(wheelRate <= w.context.CAR_DRIVER.steerRate + 1e-9, `wheel turned at ${wheelRate}`);
  assert.ok(yawRate * 12 <= 1.3 * w.context.CAR_DRIVER.aLat + 0.05, `turned at ${yawRate} rad/s`);
  assert.ok(Math.abs(v.dl) < 0.1 && Math.abs(v.yaw) < 0.02, 'in its lane, heading down it');
  assert.equal(v.steer, v.delta, 'the wheels drawn as steered');
});

test('a panicking driver yanks the wheel, but the car turns only as fast as the tyres grip', () => {
  const w = world({ lanes: [1.8, 5.4], right: 7.2, left: 7.2 });
  w.context.player.active = false;
  const v = w.car(10, 12, { dodge: 1, evade: -2.2, panicUntil: 1e9 });
  let yawRate = 0, wheelRate = 0;
  for (let k = 0; k < 1.5 * 60; k++) {
    const { yaw, delta } = v;
    w.context.drive(v, DT);
    w.context.locate(v);
    yawRate = Math.max(yawRate, Math.abs(v.yaw - yaw) / DT);
    wheelRate = Math.max(wheelRate, Math.abs(v.delta - delta) / DT);
  }
  assert.ok(wheelRate <= 2.5 * w.context.CAR_DRIVER.steerRate + 1e-9);
  assert.ok(yawRate * 12 <= w.context.CAR_DRIVER.grip + 0.05, `turned at ${yawRate} rad/s`);
  assert.ok(v.dl < -1.5, 'well out of the way after 1.5 s');
});

test('a standing car does not turn, though stopped half way into a lane change it still edges over', () => {
  const w = world({ lanes: [1.8, 5.4], right: 7.2, left: 7.2 });
  w.context.player.active = false;
  const v = w.car(10, 0, { dl: 2, v0: 0.0001 });
  v.driver = { ...v.driver, a: 0 };
  for (let k = 0; k < 2 * 60; k++) w.step(v);
  assert.equal(v.yaw, 0);
  assert.ok(v.dl < 2 && v.dl > 2 - 0.3 * 2 - 1e-9, `edged over at no more than 0.3 m/s (dl ${v.dl})`);
});

// --- Steering round the player on Toronto's streets ---

test('a side street: a car steers round a person standing in its lane, over the centre line with nobody coming', () => {
  const w = world(); // a two-way street, one lane each way, 7.2 m curb to curb
  const v = w.car(10, 10);
  w.setPlayer('person', -1.8, 60);
  const r = w.run(v, 14);
  assert.ok(r.dodges.has(2), 'steered round');
  assert.ok(!r.dodges.has(1), 'no panic');
  assert.ok(r.player > w.context.PASS_MARGIN - 0.25, `gave the person room (${r.player.toFixed(2)} m)`);
  assert.ok(v.z > 75, 'got past');
  assert.ok(Math.abs(v.dl) < 0.25 && v.dodge === 0, 'and back in its lane');
  assert.ok(r.minX >= -3.6 && r.maxX <= 3.6, 'between the curbs');
});

test('a side street: with a car coming the other way it waits behind the person, then goes round', () => {
  const w = world();
  const v = w.car(10, 10);
  w.setPlayer('person', -1.8, 60);
  const o = w.oncoming(110, 9);
  let passedOncoming = false;
  let waitedAt = -Infinity;
  for (let k = 0; k < 20 * 60; k++) {
    w.step(v);
    if (!passedOncoming && o.z < v.z) passedOncoming = true;
    assert.ok(w.separation(w.carBox(v), { x: o.x, z: o.z, tx: 0, tz: -1, halfL: 2.25, halfW: 0.86 }) > 0.3, 'never near the oncoming car');
    assert.ok(w.separation(w.carBox(v), w.playerBox()) > 0, 'never into the person');
    if (!passedOncoming) assert.ok(v.x - v.halfWidth > -1.8 - 0.86 - 0.5 || v.x + v.halfWidth < 0.1, 'kept its side of the road');
    if (!passedOncoming && v.speed < 1.5) waitedAt = Math.max(waitedAt, v.z);
  }
  assert.ok(waitedAt > 0, 'held back behind the person while the car went by');
  assert.ok(60 - waitedAt - v.half - 0.32 >= w.context.PLAYER_S0 - 1.5, 'well back from them');
  assert.ok(v.z > 75 && v.dodge === 0, 'then went round');
});

test('a side street: never round the player into someone on foot in the road', () => {
  const w = world();
  const v = w.car(10, 10);
  w.setPlayer('person', -1.8, 60);
  w.ped(1.5, 62); // someone standing in the other lane, beside the player
  const r = w.run(v, 12);
  assert.ok(r.peds > 0.3, `kept clear of them (${r.peds.toFixed(2)} m)`);
  assert.ok(r.player > 0, 'and of the player');
  assert.ok(v.z < 60, 'waited behind');
});

test('King Street: a car behind a slow cyclist in the curb lane keeps off the tracks while a streetcar comes up', () => {
  // King St W: two lanes each way, the streetcar track in the inner lane (x = -1.8), the curb lane at x = -5.4
  const w = world({ lanes: [1.8, 5.4], right: 7.2, left: 7.2 });
  const v = w.car(20, 10, { lane: 1 });
  w.setPlayer('cyclist', -5.4, 70, 0, 2.5);
  const sc = w.streetcar(-30, 11, -1.8); // coming up behind in the track lane
  let onTrackBesideStreetcar = false;
  const r = w.run(v, 4);
  for (let k = 0; k < 18 * 60; k++) {
    w.step(v);
    const b = w.carBox(v);
    r.streetcars = Math.min(r.streetcars, w.separation(b, { x: sc.x, z: sc.z, tx: 0, tz: 1, halfL: sc.halfL, halfW: sc.halfW }));
    r.player = Math.min(r.player, w.separation(b, w.playerBox()));
    if (v.dodge) r.dodges.add(v.dodge);
    if (v.x + v.halfWidth > -1.8 - 1.27 && Math.abs(v.z - sc.z) < sc.halfL + 10) onTrackBesideStreetcar = true;
  }
  assert.ok(r.streetcars > 0.5, `never near the streetcar (${r.streetcars.toFixed(2)} m)`);
  assert.ok(!onTrackBesideStreetcar, 'never on the track near it');
  assert.ok(r.player > 0, 'never into the cyclist');
  assert.ok(r.dodges.has(2), 'went round the cyclist once the streetcar had gone by');
  assert.ok(v.z > w.context.player.z + 5, 'and got past');
});

test('King Street: a swerve from a player stepping out never goes onto the tracks beside a streetcar', () => {
  // the player steps out from between the lanes towards the curb, due at the car 2 s on: behind them is the track
  const scene = (withStreetcar) => {
    const w = world({ lanes: [1.8, 5.4], right: 7.2, left: 7.2 });
    const v = w.car(20, 11, { lane: 1 });
    w.setPlayer('person', -3.0, 20 + 11 * 2, -Math.PI / 2, 1.2);
    if (withStreetcar) w.streetcar(15, 11, -1.8); // alongside, in the track lane
    return { v, r: w.run(v, 3) };
  };
  const clear = scene(false);
  assert.ok(clear.r.dodges.has(1) && clear.r.maxX > -3.0, 'with the track clear: left, onto it, behind the player');
  assert.ok(clear.r.player > 0.3, 'missing the player');
  const busy = scene(true);
  assert.ok(busy.r.streetcars > 0.5, `kept off the streetcar (${busy.r.streetcars.toFixed(2)} m)`);
  assert.ok(busy.r.maxX < -1.8 - 1.27 - 0.5, 'never onto its track');
  assert.ok(busy.r.minX >= -7.2 - 0.05, 'nor over the curb');
  assert.ok(busy.v.speed < 0.5 && busy.r.player > 0.3, 'it braked instead, short of the player');
});

test('on a deck the swerve stays on the deck\'s own lanes', () => {
  const w = world({ lanes: [1.8, 5.4], y: 8, isRoadClear: () => false, opposite: false });
  const v = w.car(10, 14, { lane: 0, y: 8 });
  w.setPlayer('cyclist', -1.8, 60, Math.PI, 6);
  const r = w.run(v, 3);
  assert.ok(r.dodges.has(1), 'swerved');
  assert.ok(r.player > 0.05, 'missed the player');
  assert.ok(r.minX >= -1.8 - 3.6 - 0.6 - 0.86 - 0.05 && r.maxX <= 0, `on the deck's lanes (${r.minX.toFixed(2)}..${r.maxX.toFixed(2)})`);
});

// --- No car ends up inside a streetcar or a pedestrian ---

test('randomised: no swerve or pass ever puts a car into a streetcar or anyone on foot', () => {
  let seed = 1234567;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  let swerves = 0, passes = 0, cases = 0;
  for (let n = 0; n < 160; n++) {
    const king = rand() < 0.5;
    const w = king ? world({ lanes: [1.8, 5.4], right: 7.2, left: 7.2 }) : world();
    const lane = king && rand() < 0.6 ? 1 : 0;
    const laneX = -(king ? [1.8, 5.4][lane] : 1.8);
    const v = w.car(20, 6 + rand() * 7, { lane });
    const mode = ['person', 'cyclist', 'car'][Math.floor(rand() * 3)];
    const kind = rand();
    if (kind < 0.4) w.setPlayer(mode, laneX + (rand() - 0.5) * 2, 45 + rand() * 30, 0, mode === 'car' ? 0 : rand() * 3);
    else if (kind < 0.7) w.setPlayer(mode, laneX + (rand() - 0.5) * 2, 60 + rand() * 40, Math.PI, 2 + rand() * 6);
    else w.setPlayer(mode, laneX + (rand() < 0.5 ? -8 : 8), 40 + rand() * 20, rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2, 2 + rand() * 4);
    if (w.context.player.vx * (w.context.player.x - laneX) > 0) { w.context.player.vx *= -1; w.context.player.fx *= -1; w.context.player.heading *= -1; }
    // others where only a swerve or a pass could take the car: streetcars on the inner track or the other way's, people
    // on foot in the next lane or beside the player
    if (king) {
      // (on its own track only beside a car in the curb lane: a streetcar coming up behind a car on its track is the
      // streetcar's to stop for, streetcars.js)
      if (lane === 1 && rand() < 0.8) w.streetcar(rand() * 120 - 40, rand() < 0.3 ? 0 : 6 + rand() * 5, -1.8, 1);
      if (rand() < 0.5) w.streetcar(rand() * 200, 6 + rand() * 5, 1.8, -1);
    } else if (rand() < 0.4) {
      w.oncoming(80 + rand() * 80, 6 + rand() * 6);
    }
    const otherLane = king ? (lane === 1 ? -1.8 : -5.4) : 1.8;
    for (let k = rand() * 3; k >= 1; k--) w.ped(otherLane + (rand() - 0.5) * 2, 30 + rand() * 60, 0, rand() < 0.5 ? 0 : (rand() - 0.5) * 2.4);
    const r = w.run(v, 8);
    assert.ok(r.streetcars > 0.05, `case ${n}: into a streetcar (${r.streetcars.toFixed(2)})`);
    assert.ok(r.peds > 0.05, `case ${n}: into someone on foot (${r.peds.toFixed(2)})`);
    if (r.dodges.has(1)) swerves++;
    if (r.dodges.has(2)) passes++;
    cases++;
  }
  assert.ok(swerves >= 5 && passes >= 10, `exercised (${swerves} swerves, ${passes} passes of ${cases})`);
});
