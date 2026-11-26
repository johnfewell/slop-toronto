// st-1aqy: a live streetcar the TTC runs off its scheduled pattern (504s on King, where the pinned schedule has only
// Queen) is drawn on the tracks it is on; one not on any track is still not drawn. The production matcher is run as is.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const src = readFileSync(join(__dirname, '..', 'js/streetcars.js'), 'utf8');
const code = src.match(/\nconst OFF_PATTERN_M[^]*?\nfunction snapLiveVehicle\([^]*?\n\}\n/)[0];
const snapLiveVehicle = new Function(`${code}; return snapLiveVehicle;`)();

const LG = 25;
// an east-west run along z = `z` from x = 0 to 400, every 4 m, heading +x (or -x when `west`)
function run(route, dir, z, west, headway = 300) {
  const pts = [], cum = [];
  for (let i = 0; i <= 100; i++) {
    pts.push({ x: west ? 400 - i * 4 : i * 4, y: 0, z });
    cum.push(i * 4);
  }
  return { pattern: { route, dir }, pts, cum, headway, signRow: route === '504' ? (dir ? 7 : 6) : route === '501' ? 3 : 1 };
}
function gridOf(runs) {
  const g = new Map();
  for (const t of runs) for (let i = 1; i + 1 < t.pts.length; i++) {
    const k = Math.floor(t.pts[i].x / LG) * 100000 + Math.floor(t.pts[i].z / LG);
    if (!g.has(k)) g.set(k, []);
    g.get(k).push({ t, i });
  }
  return g;
}
const queenE = run('501', 0, 0, false), queenW = run('501', 1, 0, true);
const own504E = run('504', 0, 0, false), own504W = run('504', 1, 0, true);
const kingE = run('501', 0, 60, false); // King: only another route's pattern runs there
const runsAll = [queenE, queenW, own504E, own504W, kingE];
const runsOf = (r) => runsAll.filter((t) => t.pattern.route === r);
const east = { x: 1, z: 0 };
const veh = (o) => ({ id: '4447', route: '504', dir: 0, h: east, ...o });

test('a car on its own route\'s pattern is placed there, with the track\'s own sign', () => {
  const m = snapLiveVehicle(veh({ x: 200, z: 2 }), gridOf(runsAll), LG, runsOf);
  assert.equal(m.t, own504E);
  assert.equal(m.sign, undefined);
});

test('a 504 on King, where only a 501 pattern runs: drawn on that track, heading its way, with the 504 sign', () => {
  const m = snapLiveVehicle(veh({ x: 200, z: 61.5 }), gridOf(runsAll), LG, runsOf);
  assert.equal(m.t, kingE);
  assert.equal(m.s, 200);
  assert.equal(m.sign, 6);
  const w = snapLiveVehicle(veh({ x: 200, z: 61.5, dir: -1, h: { x: -1, z: 0 } }), gridOf([...runsAll, run('501', 1, 60, true)]), LG, runsOf);
  assert.equal(w.t.pts[1].x < w.t.pts[0].x, true, 'the westbound track');
  assert.equal(w.sign, 7);
});

test('a car running the wrong way along off-pattern track is not matched to it', () => {
  assert.equal(snapLiveVehicle(veh({ x: 200, z: 60, h: { x: 0.2, z: -0.1 } }), gridOf([kingE]), LG, runsOf), null);
  assert.equal(snapLiveVehicle(veh({ x: 200, z: 60, h: { x: -1, z: 0 } }), gridOf([kingE]), LG, runsOf), null);
});

test('a car not on any track is not drawn: off every pattern by more than a few metres, or a tunnel track', () => {
  assert.equal(snapLiveVehicle(veh({ x: 200, z: 30 }), gridOf(runsAll), LG, runsOf), null);
  assert.equal(snapLiveVehicle(veh({ x: 200, z: 68 }), gridOf(runsAll), LG, runsOf), null);
  const tunnel = run('501', 0, 60, false);
  for (const p of tunnel.pts) p.y = -8;
  assert.equal(snapLiveVehicle(veh({ x: 200, z: 60 }), gridOf([tunnel]), LG, runsOf), null);
});

test('its own route wins over another\'s track close by', () => {
  const m = snapLiveVehicle(veh({ x: 200, z: 3 }), gridOf([own504E, queenE]), LG, runsOf);
  assert.equal(m.t, own504E);
});

test('a bus of the same route number (504C on King) is never drawn as a streetcar, on or off its pattern', () => {
  assert.equal(snapLiveVehicle(veh({ id: '3271', x: 200, z: 61.5 }), gridOf(runsAll), LG, runsOf), null);
  assert.equal(snapLiveVehicle(veh({ id: '3271', x: 200, z: 1 }), gridOf(runsAll), LG, runsOf), null);
  assert.equal(snapLiveVehicle(veh({ id: '4400', x: 200, z: 1 }), gridOf(runsAll), LG, runsOf).t, own504E);
  assert.equal(snapLiveVehicle(veh({ id: '4699', x: 200, z: 1 }), gridOf(runsAll), LG, runsOf).t, own504E);
  assert.equal(snapLiveVehicle(veh({ id: '4700', x: 200, z: 1 }), gridOf(runsAll), LG, runsOf), null);
});

// freeRuns: the track no timetable pattern runs on becomes runs of its own (makeTrack stubbed to the polyline)
const freeCode = src.match(/\nfunction freeRuns\([^]*?\n\}\n/)[0];
const freeRuns = new Function('makeTrack', `${freeCode}; return freeRuns;`)((poly) => ({ pts: poly.map((p) => ({ ...p, y: 0 })), len: 0, stops: [], signals: [] }));
function graphOf(chain) {
  const nodes = chain.map(([x, z]) => ({ x, z, out: [] })), arcs = [];
  for (let i = 0; i + 1 < nodes.length; i++) {
    const A = nodes[i], B = nodes[i + 1], L = Math.hypot(B.x - A.x, B.z - A.z);
    const fwd = { a: A, b: B, len: L, dx: (B.x - A.x) / L, dz: (B.z - A.z) / L, f: 0, k: 1, w: { drawn: true } };
    const back = { a: B, b: A, len: L, dx: -fwd.dx, dz: -fwd.dz, f: 0, k: 25, w: fwd.w };
    fwd.rev = back; back.rev = fwd;
    A.out.push(fwd); B.out.push(back); arcs.push(fwd, back);
  }
  return { arcs, nodes: new Map(), used: new Set() };
}

test('free track: a King-like street no pattern covers becomes one run, Queen (covered) does not', () => {
  // King: z = 100, x 0..200 every 20 m, travel +x; Queen: z = 0 the same, covered by a pattern run
  const king = Array.from({ length: 11 }, (_, i) => [i * 20, 100]), queen = Array.from({ length: 11 }, (_, i) => [i * 20, 0]);
  const G = graphOf(king);
  const q = graphOf(queen);
  G.arcs.push(...q.arcs);
  const pattern = { pts: Array.from({ length: 51 }, (_, i) => ({ x: i * 4, z: 0, y: 0 })) };
  const runs = freeRuns(G, [pattern]);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].pts[0].z, 100);
  assert.equal(runs[0].pts[0].x, 0);
  assert.equal(runs[0].pts[runs[0].pts.length - 1].x, 200);
  assert.equal(runs[0].pattern.route, '');
  assert.equal(runs[0].pattern.perHour.every((n) => n === 0), true, 'nothing scheduled on it');
});
