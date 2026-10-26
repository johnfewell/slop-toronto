// tools/build-signal-plan.mjs: the green-wave offsets of every signalised junction, written to js/toronto-signal-plan.js
// usage: node tools/build-signal-plan.mjs   (re-run after the geodata changes: js/signal-plan.js warns when it must
// plan the offsets at load instead)
//
// Starts from js/signal-plan.js's own plan (each corridor's band timed from its distance at the progression speed),
// then improves it by coordinate descent: each junction in turn takes the offset (to the second) that gives the least
// total delay to a car driving every corridor through it, both ways (one-way streets their way), from every start
// time in the cycle, at the progression speed with 3 s lost to every stop. A corridor's delay counts by its road's class
// (OpenStreetMap rank). Junctions no named corridor passes keep their own offset.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ctx = vm.createContext({ window: { CITY: { DEBUG_ROADS: false, SIGNAL_PLAN_BUILD: true } }, console });
for (const f of ['js/toronto-geodata.js', 'js/toronto-traffic-data.js', 'js/city-config.js', 'js/signal-plan.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
const { SIGNALS, SIGNAL_TIMING: T, SIGNAL_CROSSINGS } = ctx.window.CITY;
const J = SIGNALS.junctions;
const C = T.cycle, V = SIGNALS.V_PROG, LOST = 3;
const mod = (t, m) => ((t % m) + m) % m;
const off = J.map((j) => j.offset);
const STARTS = Array.from({ length: 14 }, (_, i) => i * 5);
// the other way's delay counts half the main band's: of the weights tried (1, 0.75, 0.5, 0.25) the one with the least
// delay both ways, as well as the strongest main bands (SIGNAL_REVERSE_WEIGHT=1: both ways alike)
const REVERSE = Number(process.env.SIGNAL_REVERSE_WEIGHT ?? 0.5);
const OUT = process.env.SIGNAL_PLAN_OUT || path.join(ROOT, 'js/toronto-signal-plan.js');

// every corridor both ways (one-way streets their way): its junctions in travel order, the phase it runs in at each
const runs = [];
for (const [name, info] of SIGNALS.corridors) {
  const js = SIGNALS.plan.corridors.get(name).junctions;
  if (js.length < 2) continue;
  const along = js.map((j) => ({ j, u: (j.x - info.mx) * info.ux + (j.z - info.mz) * info.uz })).sort((a, b) => a.u - b.u);
  let d = 0;
  const fwd = along.map((p, i) => {
    if (i) d += Math.hypot(p.j.x - along[i - 1].j.x, p.j.z - along[i - 1].j.z);
    const W = SIGNALS.windows(p.j.index)[SIGNALS.phaseForDir(p.j.index, info.ux, info.uz)]; // (each light's own split)
    return { k: p.j.index, gs: W[0], ge: W[1], d };
  });
  const back = fwd.slice().reverse().map((q) => ({ ...q, d: d - q.d }));
  const weight = Math.max(1, SIGNALS.plan.corridors.get(name).rank);
  // (the main band runs the way the corridor's own plan chose: info.s)
  for (const seq of info.oneWay === 1 ? [fwd] : info.oneWay === -1 ? [back] : [fwd, back]) {
    const dir = seq === fwd ? 1 : -1;
    runs.push({ name, seq, weight: weight * (info.oneWay || dir === info.s ? 1 : REVERSE), dir });
  }
}
const runsAt = J.map(() => []);
for (const r of runs) for (const q of r.seq) if (!runsAt[q.k].includes(r)) runsAt[q.k].push(r);

// mean delay (s) of a car driving run r from every start time
function delay(r) {
  let total = 0;
  for (const t0 of STARTS) {
    let t = t0, x = 0;
    for (const q of r.seq) {
      t += (q.d - x) / V;
      x = q.d;
      const tt = mod(t - off[q.k], C);
      if (tt < q.gs || tt >= q.ge) {
        const w = mod(q.gs - tt, C) + LOST;
        t += w;
        total += w;
      }
    }
  }
  return total / STARTS.length;
}
const cost = (k) => runsAt[k].reduce((a, r) => a + r.weight * delay(r), 0);
const totalCost = () => runs.reduce((a, r) => a + r.weight * delay(r), 0);

const t0 = Date.now();
const start = totalCost();
const order = J.map((j) => j.index).filter((k) => runsAt[k].length).sort((a, b) => runsAt[b].reduce((s, r) => s + r.weight, 0) - runsAt[a].reduce((s, r) => s + r.weight, 0));
for (let sweep = 0; sweep < 4; sweep++) {
  let changed = 0;
  for (const k of order) {
    let best = off[k], bv = cost(k);
    const keep = off[k];
    for (let o = 0; o < C; o++) {
      off[k] = o;
      const v = cost(k);
      if (v < bv - 1e-6) { bv = v; best = o; }
    }
    off[k] = best;
    if (best !== keep) changed++;
  }
  console.log(`[signal-plan] sweep ${sweep + 1}: ${changed} offsets changed, weighted delay ${totalCost().toFixed(0)} (from ${start.toFixed(0)})`);
  if (!changed) break;
}

// both ways alike, every corridor by its class: the figure the weights above trade
console.log(`[signal-plan] delay both ways (by road class): ${runs.reduce((a, r) => a + Math.max(1, SIGNALS.plan.corridors.get(r.name).rank) * delay(r), 0).toFixed(0)}`);

// the report: corridors' delay both ways, the old single clock (every light switching at once, the major road first)
// against the plan
const report = ['King Street', 'Queen Street', 'Dundas Street', 'College Street', 'Front Street', 'Bloor Street', 'Yonge Street', 'Bay Street', 'University Avenue', 'Spadina Avenue', 'Lake Shore Boulevard', 'Strachan Avenue'];
for (const name of report) {
  const rs = runs.filter((r) => r.name === name);
  console.log(`  ${name.padEnd(22)} ${rs.map((r) => `${r.dir > 0 ? 'E/S' : 'W/N'} ${delay(r).toFixed(0)} s over ${r.seq.length} lights`).join(', ')}`);
}

const keyOf = SIGNALS.plan.keyOf;
const junctions = {}, crossings = {};
J.forEach((j, k) => { junctions[keyOf(j.x, j.z)] = Math.round(off[k] * 10) / 10; });
SIGNAL_CROSSINGS.forEach((c, i) => { crossings[keyOf(c.x, c.z)] = Math.round(SIGNALS.crossingShift[i] * 10) / 10; });
const out = `// js/toronto-signal-plan.js — GENERATED by tools/build-signal-plan.mjs, do not edit by hand.
// The green-wave offsets (s into the ${C} s cycle) of Toronto's signalised junctions and mid-block crossings, keyed by
// their position (x, z in decimetres); js/signal-plan.js reads them.
(function () {
window.CITY.SIGNAL_OFFSETS = ${JSON.stringify({ cycle: C, junctions, crossings })};
})();
`;
fs.writeFileSync(OUT, out);
console.log(`[signal-plan] ${J.length} junctions, ${SIGNAL_CROSSINGS.length} crossings, ${runs.length} corridor runs, ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${path.relative(ROOT, OUT)} (${(out.length / 1024).toFixed(0)} KB)`);
