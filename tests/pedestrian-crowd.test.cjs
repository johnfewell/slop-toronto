// People who do not walk through each other, and who wait at a curb as a group (js/pedestrian-crowd.js, st-iqsg).
// The walkers are straight tracks along x with the same state the game keeps (t, v, sep, ...), stepped with the game's
// own braking and acceleration, so what the pure logic decides is what the game does.
const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
// (the game's script, run as the browser runs it)
const context = { window: { CITY: {} } };
vm.createContext(context);
vm.runInContext(readFileSync(join(__dirname, '../js/pedestrian-crowd.js'), 'utf8'), context);
const crowd = context.window.CITY.pedCrowd;
const { TUNE } = crowd;

let nextId = 0;
// a walker on a track along +x starting at x0 (dir 1: towards +x, dir -1: towards -x), lateral line z0
function walker(x0, z0, dir, speed = 1.4, extra = {}) {
  const id = extra.id ?? nextId++;
  return {
    id, placed: true, knock: null, x: x0, z: z0, ux: 1, uz: 0, dir, v: 0, speed, t: x0, pause: 0, waiting: false, conversation: null,
    sep: 0, sepTarget: 0, sepHold: 0, sepHome: 0, sepLock: false, blockedFor: 0, ghostUntil: 0, crowdRoom: Infinity, crowdTurn: false,
    goal: dir > 0 ? 1e9 : -1e9, ...extra
  };
}
// (the track's +sideways is w = (uz, -ux) = -z here)
const lateralZ = (p) => -p.sep;

function simulate(peds, { seconds = 30, dt = 1 / 60, canSide = (p, s) => Math.abs(s) <= 0.9, canTurn = () => true, stop = null } = {}) {
  const grid = crowd.createGrid(peds.length);
  const stats = { ghosted: 0 };
  const ctx = { now: 0, dt, extra: null, stats, canSide, canTurn };
  let minDist = Infinity, overlapFrames = 0, turned = 0;
  const base = peds.map((p) => p.z);
  for (let f = 0; f < seconds / dt; f++) {
    ctx.now = f * dt;
    grid.begin();
    peds.forEach((p, i) => grid.add(i, p.x, p.z));
    peds.forEach((p, i) => {
      if (p.done) return;
      crowd.steer(p, i, peds, grid, ctx);
      if (p.crowdTurn) { p.crowdTurn = false; p.dir = -p.dir; p.pause = 0.6; p.v = 0; turned++; }
    });
    peds.forEach((p, i) => {
      if (p.done) return;
      if (p.pause > 0) p.pause = Math.max(0, p.pause - dt);
      const room = p.crowdRoom;
      let vMax = p.pause > 0 || p.waiting ? 0 : p.speed;
      vMax = Math.min(vMax, Math.sqrt(2 * 1.6 * room));
      p.v += Math.max(-3.2 * dt, Math.min(1.3 * dt, vMax - p.v));
      const move = Math.min(p.v * dt, room);
      p.t += p.dir * move;
      crowd.easeSep(p, dt, TUNE.SEP_RATE);
      p.x = p.t;
      p.z = base[i] + lateralZ(p);
      if (stop && stop(p)) p.done = true;
    });
    for (let i = 0; i < peds.length; i++) {
      for (let j = i + 1; j < peds.length; j++) {
        if (peds[i].done || peds[j].done) continue;
        const d = Math.hypot(peds[i].x - peds[j].x, peds[i].z - peds[j].z);
        if (d < minDist) minDist = d;
        if (d < TUNE.OVERLAP) overlapFrames++;
      }
    }
  }
  return { minDist, overlapFrames, turned, ghosted: stats.ghosted };
}

test('two people facing each other on one line each step to their right and pass without touching', () => {
  const a = walker(0, 0, 1, 1.4, { id: 1 }), b = walker(30, 0, -1, 1.4, { id: 2 });
  const r = simulate([a, b], { seconds: 30 });
  assert.ok(r.minDist >= 0.55, `closest ${r.minDist}`);
  assert.equal(r.turned, 0);
  assert.equal(r.ghosted, 0);
  assert.ok(a.x > 25 && b.x < 5, 'both got through');
  // the one walking +x is on its right (-w = +z): a stays at z >= 0.3 or b at z <= -0.3, i.e. opposite sides
});

test('no jitter: a side step is made once and held, not switched back and forth', () => {
  const a = walker(0, 0, 1, 1.4, { id: 1 }), b = walker(30, 0, -1, 1.4, { id: 2 });
  const grid = crowd.createGrid(2), ctx = { now: 0, dt: 1 / 60, extra: null, stats: { ghosted: 0 }, canSide: (p, s) => Math.abs(s) <= 0.9, canTurn: () => true };
  const ps = [a, b];
  let flips = 0, last = 0;
  for (let f = 0; f < 60 * 25; f++) {
    ctx.now = f / 60;
    grid.begin(); ps.forEach((p, i) => grid.add(i, p.x, p.z));
    ps.forEach((p, i) => crowd.steer(p, i, ps, grid, ctx));
    ps.forEach((p) => {
      p.v = Math.min(p.speed, p.v + 0.02); p.t += p.dir * Math.min(p.v / 60, p.crowdRoom); crowd.easeSep(p, 1 / 60, TUNE.SEP_RATE);
      p.x = p.t; p.z = -p.sep;
    });
    const s = Math.sign(Math.round(a.sepTarget * 20));
    if (s !== 0 && last !== 0 && s !== last) flips++;
    if (s !== 0) last = s;
  }
  assert.equal(flips, 0);
});

test('on a walk too narrow to step aside, one of two people facing each other turns back instead of both standing', () => {
  const a = walker(0, 0, 1, 1.4, { id: 1 }), b = walker(14, 0, -1, 1.4, { id: 2 });
  const r = simulate([a, b], { seconds: 40, canSide: () => false });
  assert.ok(r.minDist >= 0.4, `closest ${r.minDist}`);
  assert.ok(r.turned >= 1, 'the lower id turned back');
  assert.equal(a.dir, -1);
  assert.equal(b.dir, -1);
  assert.ok(a.x < -3, 'and it walked away');
});

test('where they cannot turn either, the person held up is let through after a moment: never stuck for good', () => {
  const a = walker(0, 0, 1, 1.4, { id: 1 }), b = walker(10, 0, -1, 1.4, { id: 2 });
  const r = simulate([a, b], { seconds: 40, canSide: () => false, canTurn: () => false });
  assert.ok(r.ghosted >= 1);
  assert.ok(a.x > 12 && b.x < -2, `a ${a.x} b ${b.x}`);
});

test('a person catching up with a slower one slows behind them and keeps a body length', () => {
  const slow = walker(5, 0, 1, 0.8, { id: 5 }), fast = walker(0, 0.1, 1, 1.6, { id: 6 });
  const r = simulate([slow, fast], { seconds: 20, canSide: () => false });
  assert.ok(r.minDist >= 0.5, `closest ${r.minDist}`);
  assert.ok(fast.x > 10, 'it kept walking');
});

test('someone standing still (waiting, talking) is walked round, by a step to the side with room', () => {
  const still = walker(10, 0, 1, 1.4, { id: 3, waiting: true });
  const a = walker(0, 0, 1, 1.4, { id: 4 });
  const r = simulate([still, a], { seconds: 15 });
  assert.ok(r.minDist >= 0.7, `closest ${r.minDist}`);
  assert.ok(a.x > 14);
  assert.equal(r.ghosted, 0);
});

test('someone standing still on a walk with no room to pass: the person held up walks on after a moment', () => {
  const still = walker(10, 0, 1, 1.4, { id: 3, conversation: {} });
  const a = walker(0, 0, 1, 1.4, { id: 4 });
  simulate([still, a], { seconds: 15, canSide: () => false });
  assert.ok(a.x > 12, `a ${a.x}`);
});

test('two streams of walkers on one sidewalk all get through, side by side, with nobody touching for more than a moment', () => {
  const peds = [];
  for (let k = 0; k < 14; k++) {
    peds.push(walker(-5 - k * 3.1, 0.1 * (k % 3), 1, 1.3 + (k % 4) * 0.1));
    peds.push(walker(70 + k * 2.7, -0.1 * (k % 3), -1, 1.3 + (k % 4) * 0.1));
  }
  const r = simulate(peds, { seconds: 70, canSide: (p, s) => Math.abs(s) <= 0.75 });
  const frames = 70 * 60;
  assert.ok(r.overlapFrames < frames * 0.02 * 28, `overlap frames ${r.overlapFrames}`);
  for (const p of peds) assert.ok(p.dir > 0 ? p.x > 30 : p.x < 40, `stuck at ${p.x} (${p.dir})`);
});

test('the player is steered round like anyone else: a walker coming at them steps aside', () => {
  const w = walker(0, 0, 1, 1.4, { id: 7 });
  const player = { id: -1, placed: true, knock: null, x: 12, z: 0, ux: -1, uz: 0, dir: 1, v: 1.5, waiting: false, conversation: null, pause: 0 };
  const grid = crowd.createGrid(1), ps = [w];
  const ctx = { now: 0, dt: 1 / 60, extra: player, stats: { ghosted: 0 }, canSide: () => true, canTurn: () => true };
  let closest = Infinity, widest = 0;
  for (let f = 0; f < 60 * 12; f++) {
    ctx.now = f / 60;
    grid.begin(); grid.add(0, w.x, w.z);
    crowd.steer(w, 0, ps, grid, ctx);
    w.v = Math.min(w.speed, w.v + 0.02); w.t += Math.min(w.v / 60, w.crowdRoom); crowd.easeSep(w, 1 / 60, TUNE.SEP_RATE);
    w.x = w.t; w.z = -w.sep;
    player.x -= 1.5 / 60;
    closest = Math.min(closest, Math.hypot(player.x - w.x, player.z - w.z));
    widest = Math.max(widest, Math.abs(w.sepTarget));
  }
  assert.ok(widest > 0.2, 'it stepped aside');
  assert.ok(closest >= 0.5, `closest ${closest}`);
});

// ---- the group at a curb -------------------------------------------------------------------------------------------
// facing +z (the road), +w across along x; the crossing's middle 0.75 m to the side of the walker's own line
function spots(count, seed, { cs = 0.75, hw = 2.1, maxDepth = 1.5, ok = null } = {}) {
  const base = { x: 0, z: 0, hx: 0, hz: 1, wx: 1, wz: 0, dir: 1, cs, hw, maxDepth };
  const px = new Float64Array(32), pz = new Float64Array(32);
  const out = [];
  const o = { sep: 0, depth: 0, x: 0, z: 0, face: 0, found: false, gap: 0 };
  const h = (i, salt) => { const v = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453; return v - Math.floor(v); };
  for (let i = 0; i < count; i++) {
    crowd.pickSpot(base, px, pz, i, h((i + seed) * 17, 11), h((i + seed) * 17, 12), h((i + seed) * 17, 13), o, ok);
    px[i] = o.x; pz[i] = o.z;
    out.push({ ...o });
  }
  return out;
}

test('people waiting at a curb: every place is inside the corner area (the crossing plus a metre each side, back from the curb), and the people face the far side, a neighbour or down the street, never backwards', () => {
  for (let seed = 0; seed < 200; seed++) {
    for (const s of spots(14, seed * 7)) {
      assert.ok(s.found);
      assert.ok(s.sep >= 0.75 - 2.1 - 1e-9 && s.sep <= 0.75 + 2.1 + 1e-9, `sep ${s.sep}`);
      assert.ok(s.depth >= TUNE.SPOT_MIN_DEPTH - 1e-9 && s.depth <= 1.5 + 1e-9, `depth ${s.depth}`);
      assert.ok(Math.abs(s.face) <= 1.31, `face ${s.face}`);
      assert.ok(Math.abs(s.x - s.sep) < 1e-9 && Math.abs(s.z + s.depth) < 1e-9);
    }
  }
});

test('people waiting at a curb: a place is always on ground a person can stand on', () => {
  const ok = (x, z) => z <= -0.3 && z >= -1.5 && x > -1 && x < 3;
  for (let seed = 0; seed < 100; seed++) for (const s of spots(10, seed, { ok })) { assert.ok(s.found); assert.ok(ok(s.x, s.z)); }
});

test('people waiting at a curb: places keep their distance, are scattered and not a file or a row, and nobody shares a point', () => {
  let tooClose = 0, shared = 0, total = 0, rows = 0, cvLow = 0, groups = 0;
  for (let seed = 0; seed < 200; seed++) {
    const ss = spots(9, seed * 13);
    groups++;
    for (let i = 0; i < ss.length; i++) {
      let nn = Infinity;
      for (let j = 0; j < ss.length; j++) {
        if (i === j) continue;
        const d = Math.hypot(ss[i].x - ss[j].x, ss[i].z - ss[j].z);
        if (d < nn) nn = d;
        if (j < i) { total++; if (d < 0.45) tooClose++; if (d < 0.05) shared++; }
      }
    }
    const depths = ss.map((s) => s.depth), seps = ss.map((s) => s.sep);
    const sd = (a) => { const m = a.reduce((x, y) => x + y) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
    if (sd(depths) < 0.2 || sd(seps) < 0.5) rows++; // a row has no depth spread, a file no sideways spread
    // the distances to the nearest neighbour vary (an arranged grid would have none)
    const nns = ss.map((s, i) => Math.min(...ss.filter((_, j) => j !== i).map((q) => Math.hypot(s.x - q.x, s.z - q.z))));
    if (sd(nns) / (nns.reduce((a, b) => a + b) / nns.length) < 0.06) cvLow++;
  }
  assert.equal(shared, 0);
  assert.ok(tooClose / total < 0.03, `${tooClose} of ${total} pairs closer than 0.45 m`);
  assert.ok(rows < groups * 0.03, `${rows} of ${groups} groups were a row or a file`);
  assert.ok(cvLow < groups * 0.1, `${cvLow} of ${groups} groups had even spacing`);
});

test('people waiting at a curb: denser at the curb than at the back', () => {
  let near = 0, far = 0;
  for (let seed = 0; seed < 200; seed++) for (const s of spots(6, seed * 5)) { if (s.depth < 0.9) near++; else far++; }
  assert.ok(near > far * 1.3, `${near} near the curb, ${far} further back`);
});

test('the same people at the same corner choose the same places', () => {
  const a = spots(8, 21), b = spots(8, 21);
  assert.deepEqual(a.map((s) => [s.x, s.z, s.face]), b.map((s) => [s.x, s.z, s.face]));
});

test('the places are varied: facings differ from person to person, a few turn to a neighbour or down the street', () => {
  let faces = new Set(), sideways = 0, total = 0;
  for (let seed = 0; seed < 100; seed++) for (const s of spots(8, seed * 3)) { faces.add(Math.round(s.face * 20)); total++; if (Math.abs(s.face) > 0.5) sideways++; }
  assert.ok(faces.size > 20);
  assert.ok(sideways / total > 0.1 && sideways / total < 0.4, `${sideways} of ${total}`);
});

test('the spatial hash finds everyone within a cell, over several frames, with no stale chains', () => {
  const grid = crowd.createGrid(6);
  grid.begin();
  for (let i = 0; i < 6; i++) grid.add(i, i * 0.5, 0);
  const found = [];
  for (let j = grid.first(0, 0); j >= 0; j = grid.next[j]) found.push(j);
  assert.deepEqual(found.sort(), [0, 1, 2, 3, 4, 5]);
  grid.begin();
  grid.add(2, 1, 1);
  const again = [];
  for (let j = grid.first(0, 0); j >= 0; j = grid.next[j]) again.push(j);
  assert.deepEqual(again, [2]);
});
