// tools/report-row-steps.mjs — st-ndw9.18: finds the joined houses of a run (side by side, parallel, their blocks touching) whose roofs still step
// where one row has one roof: the ridge or the eave line of a house is not on its neighbour's. Reads committed data only (runDraw).
// usage: node tools/report-row-steps.mjs [--json <path>]
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { runDraw } from './report-building-draw.mjs';

const rad = (d) => d * Math.PI / 180;
export function rowSteps(plans, { tolRidge = 0.25, tolLine = 0.3 } = {}) {
  const byGroup = new Map();
  for (const p of plans) if (p.frame && p.roof && p.groupId != null) (byGroup.get(p.groupId) || byGroup.set(p.groupId, []).get(p.groupId)).push(p);
  const pairs = [];
  for (const m of byGroup.values()) {
    for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) {
      const a = m[i], b = m[j], fa = a.frame, fb = b.frame, nx = fa.t[1], nz = -fa.t[0];
      const dot = fb.t[0] * fa.t[0] + fb.t[1] * fa.t[1];
      if (dot < Math.cos(rad(3))) continue;
      const bu = (fb.A[0] - fa.A[0]) * fa.t[0] + (fb.A[1] - fa.A[1]) * fa.t[1], bv = -((fb.A[0] - fa.A[0]) * nx + (fb.A[1] - fa.A[1]) * nz);
      const cb = bu + dot * (fb.u0 + fb.u1) / 2, ca = (fa.u0 + fa.u1) / 2;
      const gap = Math.abs(cb - ca) - ((fa.u1 - fa.u0) + (fb.u1 - fb.u0)) / 2;
      if (Math.abs(gap) > 0.9 || Math.abs(bv) > Math.max(fa.z1, fb.z1)) continue;
      // outward positions of the roof's lines in a's frame: the front line's own offset, minus the roof's v (v is into the building)
      const q = (p, off, v) => off - v;
      const offA = 0, offB = (fb.A[0] - fa.A[0]) * nx + (fb.A[1] - fa.A[1]) * nz;
      const ra = a.roof, rb = b.roof;
      const d = { ids: [a.id, b.id], preset: a.preset, form: ra.form === rb.form ? ra.form : `${ra.form}/${rb.form}`,
        dEave: Math.abs(ra.y - rb.y), dRidge: Math.abs(ra.ridge - rb.ridge),
        dFront: Math.abs(q(a, offA, ra.vF) - q(b, offB, rb.vF)), dBack: Math.abs(q(a, offA, ra.vB) - q(b, offB, rb.vB)), dRidgeLine: Math.abs(q(a, offA, ra.vc) - q(b, offB, rb.vc)) };
      pairs.push(d);
    }
  }
  const sameRoof = (d) => /^(sideGable|crossGable|hip|hipGable|mansard|flat)$/.test(d.form); // (one roof carries over the run: not a gable a house)
  const groupOf = new Map(plans.map((p) => [p.id, p.groupId]));
  const stepping = pairs.filter((d) => sameRoof(d) && (d.dEave > tolRidge || d.dRidge > tolRidge || d.dFront > tolLine || d.dBack > tolLine || d.dRidgeLine > tolLine));
  const rows = new Set(pairs.map((d) => groupOf.get(d.ids[0]))), rowsStepping = new Set(stepping.map((d) => groupOf.get(d.ids[0])));
  return { pairs, stepping, rows: rows.size, rowsStepping: rowsStepping.size };
}

if (process.argv[1] && process.argv[1].endsWith('report-row-steps.mjs')) {
  const { values } = parseArgs({ options: { json: { type: 'string' }, main: { type: 'boolean' } } });
  // (--main: the rule of main: fronts within 1.5 m, no common back line)
  const out = await runDraw({ cells: false, snapArgs: process.argv.includes('--main') ? [1.5, -1, -1] : [] });
  const { pairs, stepping, rows, rowsStepping } = rowSteps(out.plans);
  const byForm = {};
  for (const d of pairs) { const e = (byForm[d.form] ||= { pairs: 0, stepping: 0 }); e.pairs++; }
  for (const d of stepping) byForm[d.form].stepping++;
  const med = (k) => { const a = stepping.map((d) => d[k]).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : 0; };
  const summary = { rule: process.argv.includes('--main') ? 'main' : 'branch', snap: out.snap, pairs: pairs.length, stepping: stepping.length, rows, rowsStepping, byForm, medianStep: { eave: med('dEave'), ridge: med('dRidge'), front: med('dFront'), back: med('dBack'), ridgeLine: med('dRidgeLine') } };
  console.log(JSON.stringify(summary, null, 1));
  if (values.json) fs.writeFileSync(values.json, JSON.stringify({ summary, stepping }));
}
