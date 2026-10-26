const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// The signal plan (js/signal-plan.js) on the real geodata: no two phases of a junction ever show green or amber at
// once, every change runs through amber and all-red, and the actuated lights keep to that under any demand.
const context = vm.createContext({ window: { CITY: { DEBUG_ROADS: false } }, console });
for (const path of ['js/toronto-geodata.js', 'js/toronto-traffic-data.js', 'js/city-config.js', 'js/toronto-signal-plan.js', 'js/signal-plan.js']) {
  vm.runInContext(readFileSync(join(__dirname, '..', path), 'utf8'), context, { filename: path });
}
const { SIGNALS, SIGNAL_TIMING: T } = context.window.CITY;
const J = SIGNALS.junctions;

test("the lights are the City of Toronto's: every junction & midblock signal a City signal, crossovers on their own", () => {
  const { TRAFFIC_DATA: TD, SIGNAL_JUNCTIONS, SIGNAL_CROSSINGS, PXOS } = context.window.CITY;
  assert.ok(TD, 'js/toronto-traffic-data.js loaded (node tools/build-traffic-data.mjs)');
  const pxs = new Set(TD.signals.map((r) => r[2]));
  assert.ok(SIGNAL_JUNCTIONS.length > 400 && SIGNAL_JUNCTIONS.every((j) => pxs.has(j.px)));
  assert.ok(SIGNAL_CROSSINGS.length > 20 && SIGNAL_CROSSINGS.every((c) => pxs.has(c.px)));
  assert.ok(SIGNAL_CROSSINGS.some((c) => c.mode === SIGNALS.MODE.mps));
  assert.ok(PXOS.length > 50 && PXOS.every((o) => o.px >= 5000 && o.px < 6000));
  assert.equal(SIGNALS.lights.length, J.length + SIGNAL_CROSSINGS.length);
});

test('nobody gets the WALK while traffic crossing their path has a green or amber, and every WALK lasts 7 s (40% of a squeezed phase)', () => {
  const bad = [];
  for (const light of SIGNALS.lights) {
    const k = light.index;
    const P = light.phases;
    const walks = SIGNALS.walkWindows(k);
    for (let p = 0; p < P; p++) {
      const w = walks[p];
      if (!w) continue;
      if (w[1] - w[0] < Math.min(T.walk, SIGNALS.phaseWindows(k)[p][1] - SIGNALS.phaseWindows(k)[p][0]) * 0.4 - 1e-6) bad.push(`light ${k}: phase ${p}'s WALK only ${(w[1] - w[0]).toFixed(1)} s`);
      for (let t = 0; t < T.cycle; t += 0.25) {
        const time = 5000 * T.cycle + SIGNALS.offsets[k] + t; // (light-local time t)
        if (SIGNALS.pedState(k, p, time) === 'dont') continue;
        for (let q = 0; q < P; q++) {
          if (q !== p && SIGNALS.state(k, q, time) !== 'red') bad.push(`light ${k}: phase ${p}'s people on the ${SIGNALS.pedState(k, p, time)} while phase ${q} is ${SIGNALS.state(k, q, time)} (t ${t})`);
        }
      }
    }
  }
  assert.equal(bad.length, 0, bad.slice(0, 8).join('; '));
});

test('leading pedestrian intervals: the WALK starts 5 s before the green alongside it, where the City has one', () => {
  let lpi = 0;
  for (const j of J) {
    const L = SIGNALS.lpi(j.index);
    for (let p = 0; p < j.phases; p++) {
      if (!L[p]) continue;
      lpi++;
      const w = SIGNALS.walkWindows(j.index)[p], g = SIGNALS.windows(j.index)[p];
      if (w) assert.ok(Math.abs(g[0] - w[0] - L[p]) < 1e-6, `junction ${j.index} phase ${p}`);
    }
  }
  assert.ok(lpi > 100, `${lpi} phases with a leading interval`);
});

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
  // (and lights of every mode of control the City runs, the midblock signals among them)
  for (const mode of Object.values(SIGNALS.MODE)) {
    const light = SIGNALS.lights.find((l) => l.mode === mode && !sample.includes(l.index));
    if (light) sample.push(light.index);
  }
  const fixed = sample.filter((k) => SIGNALS.mode(k) === SIGNALS.MODE.fixed);
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
      for (let p = 0; p < SIGNALS.lights[k].phases; p++) {
        if (rand() < 0.4) SIGNALS.call(k, p);
        if (rand() < 0.05) SIGNALS.busy(k, p);
      }
    }
    SIGNALS.step(time, dt, near);
    // fixed-time lights never move off their timing
    for (const k of fixed) assert.equal(SIGNALS.shifts[k], SIGNALS.offsets[k]);
    for (const k of sample) {
      const states = Array.from({ length: SIGNALS.lights[k].phases }, (_, p) => SIGNALS.state(k, p, time));
      const lit = states.filter((s) => s !== 'red').length;
      assert.ok(lit <= 1, `junction ${k}: ${states.join(' ')} at once`);
      const g = states.indexOf('green');
      const s = last.get(k);
      if (g !== s.green) {
        const min = s.green >= 0 ? Math.min(T.minGreen[s.green], SIGNALS.windows(k)[s.green][1] - SIGNALS.windows(k)[s.green][0]) : 0;
        if (s.green >= 0 && s.seenStart) assert.ok(time - s.since >= min - 2 * dt, `junction ${k}: phase ${s.green} green only ${(time - s.since).toFixed(2)} s`);
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
  for (const k of sample) assert.ok(Math.abs(SIGNALS.shifts[k] - SIGNALS.offsets[k]) < 1e-9);
});
