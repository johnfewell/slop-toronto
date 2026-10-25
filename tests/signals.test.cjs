const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// The signal plan (js/signal-plan.js) on the real geodata: no two phases of a junction ever show green or amber at
// once, every change runs through amber and all-red, and the actuated lights keep to that under any demand.
const context = vm.createContext({ window: { CITY: { DEBUG_ROADS: false } }, console });
for (const path of ['js/toronto-geodata.js', 'js/city-config.js', 'js/toronto-signal-plan.js', 'js/signal-plan.js']) {
  vm.runInContext(readFileSync(join(__dirname, '..', path), 'utf8'), context, { filename: path });
}
const { SIGNALS, SIGNAL_TIMING: T } = context.window.CITY;
const J = SIGNALS.junctions;

test('the precomputed offsets cover every junction (else re-run tools/build-signal-plan.mjs)', () => {
  assert.equal(SIGNALS.plan.planned, 'table');
});

test('phase layouts leave amber and all-red between greens, and every green its minimum', () => {
  const problems = SIGNALS.checkLayouts();
  assert.equal(problems.length, 0, problems.join('; '));
});

test('roads crossing at a junction run in different phases', () => {
  const split = Math.cos(30 * Math.PI / 180), crossing = Math.cos(60 * Math.PI / 180);
  const conflicts = [];
  for (const j of J) {
    for (const a of j.arms) {
      for (const b of j.arms) {
        if (a.road === b.road || Math.abs(a.ux * b.ux + a.uz * b.uz) > crossing) continue; // same road, or not across
        if (SIGNALS.phaseForDir(j.index, a.ux, a.uz) === SIGNALS.phaseForDir(j.index, b.ux, b.uz)) conflicts.push(`${a.road} / ${b.road} at ${Math.round(j.x)}, ${Math.round(j.z)}`);
      }
    }
  }
  // (a fourth direction at one junction can't have a phase of its own: only those may share)
  const four = J.filter((j) => j.arms.some((a) => j.axes.every(([x, z]) => Math.abs(x * a.ux + z * a.uz) < split)));
  const allowed = new Set(four.map((j) => `${Math.round(j.x)}, ${Math.round(j.z)}`));
  const bad = conflicts.filter((c) => !allowed.has(c.split(' at ')[1]));
  assert.equal(bad.length, 0, bad.join('; '));
});

test('actuated lights under random demand: one phase at a time, clearance kept, minimum greens, back in step', () => {
  const sample = [0, 7, 42, 99, 150, 233, 301, 402].filter((k) => k < J.length);
  for (const k of J.keys()) if (J[k].phases === 3) { sample.push(k); break; }
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const dt = 1 / 30;
  const last = new Map(sample.map((k) => [k, { green: -2, since: 0, lastEnd: -Infinity }])); // (-2: not seen yet)
  let time = 1000;
  const clearance = T.amber + T.allRed;
  for (let i = 0; i < 3600 / dt; i++) {
    time += dt;
    const near = i < 2400 / dt ? sample : [];
    for (const k of near) {
      for (let p = 0; p < J[k].phases; p++) {
        if (rand() < 0.4) SIGNALS.call(k, p);
        if (rand() < 0.05) SIGNALS.busy(k, p);
      }
    }
    SIGNALS.step(time, dt, near);
    for (const k of sample) {
      const states = Array.from({ length: J[k].phases }, (_, p) => SIGNALS.state(k, p, time));
      const lit = states.filter((s) => s !== 'red').length;
      assert.ok(lit <= 1, `junction ${k}: ${states.join(' ')} at once`);
      const g = states.indexOf('green');
      const s = last.get(k);
      if (g !== s.green) {
        if (s.green >= 0 && s.seenStart) assert.ok(time - s.since >= T.minGreen[s.green] - 2 * dt, `junction ${k}: phase ${s.green} green only ${(time - s.since).toFixed(2)} s`);
        if (s.green >= 0) s.lastEnd = time;
        if (g >= 0) assert.ok(time - s.lastEnd >= clearance - 2 * dt, `junction ${k}: phase ${g} green ${(time - s.lastEnd).toFixed(2)} s after the last green`);
        s.seenStart = s.green !== -2;
        s.green = g;
        s.since = time;
      }
    }
  }
  // twenty minutes after the player left, every light is back on its coordinated timing
  for (const k of sample) assert.ok(!SIGNALS.tracked.has(k), `junction ${k} still off its timing`);
  for (const k of sample) assert.ok(Math.abs(SIGNALS.shifts[k] - J[k].offset) < 1e-9);
});
