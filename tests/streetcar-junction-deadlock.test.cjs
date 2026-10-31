// st-wfq: at King St West & Atlantic Ave a car or bus turning left from Atlantic and an eastbound 504 waiting at its red
// could each wait for the other for good. The junction's mouth on King is wide (King's lanes end 22 m short of its
// centre), so the streetcar's signal stop (10 m short of the centre) is inside it, across the left turn's curve. The
// production code is run as is: traffic.js's streetcar section (obstacleGap and the rest), road-network.js's curves and
// streetcars.js's blockedAhead, on the junction's real geometry (the road network and 504 track as built, read off the
// running city with a capture).
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = (f) => readFileSync(join(__dirname, '..', f), 'utf8');
const trafficSrc = read('js/traffic.js');
const networkSrc = read('js/road-network.js');
const streetcarSrc = read('js/streetcars.js');
const topLevel = (src, name) => src.match(new RegExp(`\\nfunction ${name}\\([^]*?\\n\\}`))[0];
const inner = (src, name) => src.match(new RegExp(`\\n  function ${name}\\([^]*?\\n  \\}`))[0];
// traffic.js's streetcar section, from obstacleGap to its end marker (whatever helpers it holds)
const section = (() => {
  const a = trafficSrc.indexOf('  // --- Streetcars: gap to the nearest streetcar module');
  const b = trafficSrc.indexOf('  // --- end streetcars ---', a);
  assert.ok(a > 0 && b > a, 'traffic.js streetcar section');
  return trafficSrc.slice(a, b);
})();

const SECTIONS = [6.6, 5.7, 5.4, 5.7, 6.6];
const GANGWAY = 0.55;
const HALF_W = 1.27;
const DECEL = 1.4;
const ACCEL = 1.1;
const MAX_SPEED = 11.5;
const DT = 1 / 30;

function edge(dx, dz, x, z, len, lanes, atEnd) {
  const l = Math.hypot(dx, dz);
  dx /= l;
  dz /= l;
  const sx = atEnd ? x - dx * len : x;
  const sz = atEnd ? z - dz * len : z;
  return { dx, dz, rx: -dz, rz: dx, sx, sz, len, lanes };
}
// King & Atlantic (road network nodes 5812, 7635 and 8154; the eastbound 504's track there)
const atlanticNorth = edge(0.02, -1, -3306.58, -380.49, 60, [1.8], true);
const kingWest = edge(-1, -0.02, -3328.9, -390.95, 100, [1.8], false);
const kingEast = edge(0.95, 0.31, -3302, -389.06, 30, [0], false);
const EB_TRACK = [-3790.5, -398.2, -3752.6, -398, -3391, -390.6, -3317.3, -389.1, -3273.9, -387.4, -3076.2, -383.7];
const STOP_NOSE_X = -3315.46; // where the 504 waits for its red (signal s 984.6, half 10)

function harness() {
  const network = vm.createContext({ edgeY: () => 0 });
  vm.runInContext(`${topLevel(networkSrc, 'makeCurve')}\n${topLevel(networkSrc, 'curvePoint')}`, network);
  const movers = [];
  const traffic = vm.createContext({ movers, LOOKAHEAD: 70, curvePoint: network.curvePoint, edgeY: () => 0,
    connector: (e, i, f, j) => network.makeCurve(e, i, f, j) });
  vm.runInContext(`${inner(trafficSrc, 'lanePoint')}\n${section}
    this.api = { obstacleGap, sweepGap: typeof sweepGap === 'function' ? sweepGap : null,
      wayThrough: typeof wayThrough === 'function' ? wayThrough : null };`, traffic);
  const streetcar = vm.createContext({ HALF_W, SECTIONS, GANGWAY, CAR_LEN: 32.2, cars: [], tmp: {},
    wayThrough: traffic.api.wayThrough || undefined });
  vm.runInContext(`${topLevel(streetcarSrc, 'sample')}\n${inner(streetcarSrc, 'blockedAhead')}`, streetcar);
  const pts = [];
  for (let i = 0; i < EB_TRACK.length; i += 2) pts.push({ x: EB_TRACK[i], z: EB_TRACK[i + 1], y: 0 });
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const track = { pts, cum, len: cum[cum.length - 1] };
  const at = (s) => streetcar.sample(track, s, {});
  let stopS = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].x >= STOP_NOSE_X) {
      stopS = cum[i - 1] + (STOP_NOSE_X - pts[i - 1].x) / (pts[i].x - pts[i - 1].x) * (cum[i] - cum[i - 1]);
      break;
    }
  }
  return { network, traffic, streetcar, movers, track, at, stopS, api: traffic.api };
}

// The modules traffic.js is handed (streetcars.js: one box per module, following the track behind the nose)
function placeModules(h, car) {
  h.movers.length = 0;
  let back = car.s;
  for (const len of SECTIONS) {
    const a = h.at(back), b = h.at(back - len);
    h.movers.push({ x: (a.x + b.x) / 2, y: 0, z: (a.z + b.z) / 2, yaw: Math.atan2(a.x - b.x, a.z - b.z),
      halfL: len / 2 + GANGWAY / 2, halfW: HALF_W, speed: car.speed });
    back -= len + GANGWAY;
  }
}

const VEHICLES = { car: { half: 2.25, halfWidth: 0.86, axle: 1.38 }, bus: { half: 6, halfWidth: 1.3, axle: 3.6, bus: true } };
// a vehicle on the left turn from Atlantic into King, `cs` m along its curve (traffic.js locate: its body between its
// axles, along the curve and the lanes either side)
function turner(h, kind, cs, to = kingWest) {
  const c = h.network.makeCurve(atlanticNorth, 0, to, 0);
  const v = { ...VEHICLES[kind], y: 0, speed: 0, edge: atlanticNorth, lane: 0, conn: c, cs, out: 0, s: 0,
    yielding: false, yieldAt: -1, commit: null, move: { to, turn: to === kingWest ? 'L' : 'R', out: [0] } };
  place(h, v);
  return v;
}
function point(h, v, s) {
  const c = v.conn, out = {};
  if (s < 0) return { x: atlanticNorth.sx + atlanticNorth.dx * (atlanticNorth.len + s) + atlanticNorth.rx * 1.8,
    z: atlanticNorth.sz + atlanticNorth.dz * (atlanticNorth.len + s) + atlanticNorth.rz * 1.8 };
  const f = v.move.to;
  if (s > c.len) return { x: f.sx + f.dx * (s - c.len) + f.rx * f.lanes[0], z: f.sz + f.dz * (s - c.len) + f.rz * f.lanes[0] };
  return h.network.curvePoint(c, s, out);
}
function place(h, v) {
  const f = point(h, v, v.cs + v.axle), r = point(h, v, v.cs - v.axle);
  v.x = (f.x + r.x) / 2;
  v.z = (f.z + r.z) / 2;
  v.yaw = Math.atan2(f.x - r.x, f.z - r.z);
}
// how far apart a vehicle's body and a module are (separating axes; < 0: overlapping)
function separation(v, o) {
  const boxes = [{ x: v.x, z: v.z, yaw: v.yaw, hl: v.half, hw: v.halfWidth }, { x: o.x, z: o.z, yaw: o.yaw, hl: o.halfL, hw: o.halfW }];
  const axes = boxes.flatMap((b) => [[Math.sin(b.yaw), Math.cos(b.yaw)], [Math.cos(b.yaw), -Math.sin(b.yaw)]]);
  let best = -Infinity;
  for (const [ax, az] of axes) {
    const ext = (b) => b.hl * Math.abs(Math.sin(b.yaw) * ax + Math.cos(b.yaw) * az) + b.hw * Math.abs(Math.cos(b.yaw) * ax - Math.sin(b.yaw) * az);
    best = Math.max(best, Math.abs((o.x - v.x) * ax + (o.z - v.z) * az) - ext(boxes[0]) - ext(boxes[1]));
  }
  return best;
}

// Both sides' own rules, frame by frame: the vehicle drives along its curve no further than its gap to a streetcar
// module (traffic.js drive: never into it), held where it is while people cross its way out for `pedsFor` s; the
// streetcar keeps to its red (until `redFor` s) and to blockedAhead's room, braking and accelerating as streetcars.js
// does. Returns what happened in `seconds`.
function run(h, v, car, { pedsFor, redFor, seconds }) {
  const c = v.conn;
  let minSep = Infinity, cleared = null, through = null;
  for (let t = 0; t < seconds; t += DT) {
    placeModules(h, car);
    for (const o of h.movers) minSep = Math.min(minSep, separation(v, o));
    // the vehicle
    if (v.conn && t >= pedsFor) {
      const og = h.api.obstacleGap(v);
      const ds = Math.min(5 * DT, Math.max(0, og.gap - 0.3));
      v.speed = ds / DT;
      v.cs += ds;
      if (v.cs > c.len + v.half + 5) {
        v.conn = null; // out of the junction and on along King
        cleared ??= t;
      }
      if (v.conn) place(h, v);
    } else v.speed = 0;
    // the streetcar
    const nose = h.at(car.s);
    let stopD = Infinity;
    if (t < redFor && car.s < h.stopS + 1) stopD = h.stopS - car.s;
    stopD = Math.min(stopD, h.streetcar.blockedAhead(car, 75, v.conn ? [v] : [], null) - 4);
    const target = Math.min(MAX_SPEED, Math.sqrt(2 * DECEL * Math.max(0, stopD)));
    if (car.speed < target) car.speed = Math.min(target, car.speed + ACCEL * DT);
    else car.speed = Math.max(target, car.speed - (stopD < 3 ? DECEL * 3 : DECEL * 1.6) * DT);
    car.s += car.speed * DT;
    if (nose.x > -3290) {
      through ??= t;
      if (cleared !== null) break;
    }
  }
  return { minSep, cleared, through, vehicle: { cs: v.cs, conn: !!v.conn }, nose: h.at(car.s).x };
}

test('the junction geometry is King & Atlantic as built', () => {
  const h = harness();
  const c = h.network.makeCurve(atlanticNorth, 0, kingWest, 0);
  for (const [k, want] of Object.entries({ x0: -3304.78, z0: -380.46, x1: -3304.66, z1: -386.97, x2: -3315.45, z2: -392.48, x3: -3328.86, z3: -392.75 })) {
    assert.ok(Math.abs(c[k] - want) < 0.1, `left turn curve ${k}: ${c[k]} vs ${want}`);
  }
  assert.ok(Math.abs(h.at(h.stopS).z + 389.03) < 0.05, 'the 504 waits for its red on the eastbound track');
  assert.ok(h.stopS > 0);
});

for (const kind of ['car', 'bus']) {
  test(`a ${kind} turning left from Atlantic and a 504 pulling up to its red don't hold each other for good`, () => {
    const h = harness();
    // the vehicle has turned in, short of the track, and waits for people crossing its way out; the streetcar comes up
    // to its red behind them, 60 m off at 8 m/s
    const v = turner(h, kind, 6);
    const car = { track: h.track, s: h.stopS - 60, speed: 8 };
    const r = run(h, v, car, { pedsFor: 12, redFor: 20, seconds: 120 });
    assert.ok(r.cleared !== null, `the ${kind} clears the junction: ${JSON.stringify(r)}`);
    assert.ok(r.through !== null, `the streetcar goes on through it on its green: ${JSON.stringify(r)}`);
    assert.ok(r.through > 20, 'not before its green');
    assert.ok(r.minSep > 0, `no part of the ${kind} goes through the streetcar: ${r.minSep}`);
  });

  test(`a ${kind} already inside the junction stops short of a 504 standing in its way, never through it`, () => {
    const h = harness();
    const v = turner(h, kind, 2);
    // standing at its red the whole time
    const car = { track: h.track, s: h.stopS, speed: 0 };
    const r = run(h, v, car, { pedsFor: 0, redFor: Infinity, seconds: 30 });
    assert.equal(r.cleared, null);
    assert.ok(r.minSep > 0, `stops before it: ${r.minSep}`);
  });
}

test('nobody goes into the junction while a 504 stands in the way of their turn; the way the curve clears is open', () => {
  const h = harness();
  assert.ok(h.api.sweepGap, 'traffic.js tests the way through a junction');
  const left = h.network.makeCurve(atlanticNorth, 0, kingWest, 0);
  const right = h.network.makeCurve(atlanticNorth, 0, kingEast, 0);
  for (const kind of ['car', 'bus']) {
    const v = { ...VEHICLES[kind], y: 0 };
    placeModules(h, { s: h.stopS, speed: 0 });
    const way = (c, f) => h.api.sweepGap(v, atlanticNorth, 0, c, f, 0, -v.half, c.len + v.half).gap;
    assert.ok(way(left, kingWest) < left.len, `${kind}: the 504 at its red stands across the left turn`);
    assert.equal(way(right, kingEast), Infinity, `${kind}: the right turn passes in front of it`);
    placeModules(h, { s: h.stopS - 40, speed: 0 });
    assert.equal(way(left, kingWest), Infinity, `${kind}: 40 m back it is out of the way`);
  }
});

test('a vehicle still waiting at its line does not hold a streetcar; one inside holds it short of its way', () => {
  const h = harness();
  const car = { track: h.track, s: h.stopS - 30, speed: 8 };
  const waiting = turner(h, 'car', -VEHICLES.car.half);
  waiting.conn = null; // at the line, not committed: the streetcar has priority over it as before
  waiting.s = atlanticNorth.len - waiting.half;
  assert.equal(h.streetcar.blockedAhead(car, 75, [waiting], null), Infinity);
  const inside = turner(h, 'car', 4);
  const room = h.streetcar.blockedAhead(car, 75, [inside], null);
  const crossing = h.at(car.s).x;
  assert.ok(room < Infinity && crossing + room < -3312, `holds short of where its curve crosses the track: ${room}`);
});

test('a 504 already through its light is not held by a vehicle turning in ahead of it that waits for it', () => {
  // (a capture: the right turn from Atlantic onto King east ends in the streetcar's lane, just ahead of a 504 that had
  // gone on past its signal stop. The turner held for the streetcar, so the streetcar must not hold for the turner's way
  // up to it: it goes, then the turner)
  const h = harness();
  const v = turner(h, 'car', 4, kingEast);
  let s = h.stopS;
  while (h.at(s).x < -3304.3) s += 0.05;
  const car = { track: h.track, s, speed: 0 };
  const r = run(h, v, car, { pedsFor: 0, redFor: 0, seconds: 90 });
  assert.ok(r.through !== null && r.cleared !== null, `both go on: ${JSON.stringify(r)}`);
  assert.ok(r.through < r.cleared, 'the streetcar first');
  assert.ok(r.minSep > 0, `the car never goes into it: ${r.minSep}`);
});

test('a 504 already across the way of a turner held for it goes on first, rather than waiting for its way', () => {
  // (a capture, at the next junction west: a 504 had run up to its red with its nose across the curve of a car turning
  // left inside the junction; the car waited for the streetcar and the streetcar for the car's way)
  for (const [kind, cs] of [['car', 4], ['bus', -4]]) {
    const h = harness();
    const v = turner(h, kind, cs); // (just in, short of the track)
    const car = { track: h.track, s: h.stopS, speed: 0 };
    const r = run(h, v, car, { pedsFor: 0, redFor: 0, seconds: 90 });
    assert.ok(r.through !== null && r.cleared !== null, `${kind}: both go on: ${JSON.stringify(r)}`);
    assert.ok(r.through < r.cleared, `${kind}: the streetcar first`);
    assert.ok(r.minSep > 0, `${kind}: never into it: ${r.minSep}`);
  }
});
