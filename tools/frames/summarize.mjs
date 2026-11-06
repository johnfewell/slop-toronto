// tools/frames/summarize.mjs — tables from tools/frames/run-captures.sh's outputs (docs/map-scale-measurements.md):
// per run tag (<frame>-<tier>-r<n>), the load (the [init] phases, ready since navigation, JS heap at ready), and per
// view the frame interval, the CPU, the triangles and draw calls per frame, the systems' CPU and the actors.
// usage: node tools/frames/summarize.mjs <capture dir> [tag...] [--json out.json]
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const jsonIdx = args.indexOf('--json');
const jsonOut = jsonIdx >= 0 ? args.splice(jsonIdx, 2)[1] : null;
const dir = args.shift();
const tags = args.length ? args : [...new Set(fs.readdirSync(dir).map((f) => f.match(/^([a-z]+-(?:high|low)-r\d+)-console\.log$/)?.[1]).filter(Boolean))].sort();
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } };
const rows = [];
for (const tag of tags) {
  const log = fs.existsSync(path.join(dir, `${tag}-console.log`)) ? fs.readFileSync(path.join(dir, `${tag}-console.log`), 'utf8') : '';
  const init = (log.match(/\[init\] (.*)/) || [])[1] || '';
  const phases = Object.fromEntries([...init.matchAll(/(\w+) (\d+)ms(?: \((\d+) MB\))?/g)].map((m) => [m[1], { ms: +m[2], heapMB: m[3] ? +m[3] : null }]));
  const ready = +(log.match(/\[capture\] ready after (\d+) ms/) || [])[1] || null;
  const errCount = new Map();
  for (const m of log.matchAll(/^\[(?:error|pageerror)\] (.*)$/gm)) { const k = m[1].slice(0, 220); errCount.set(k, (errCount.get(k) || 0) + 1); }
  const errors = [...errCount].map(([k, n]) => `${n}x ${k}`);
  const views = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.startsWith(`${tag}-`) && f.endsWith('-record.json')).sort()) {
    const view = f.slice(tag.length + 1, -'-record.json'.length);
    const r = read(f), m = read(`${tag}-${view}.metrics.json`);
    views.push({ view, player: r?.player, frameMs: m && { median: m.frames.frameIntervalMs.median, p95: m.frames.frameIntervalMs.p95, mean: m.frames.frameIntervalMs.mean },
      cpuMs: m && { sim: m.frames.simulationCpuMs.median, render: m.frames.renderSubmissionCpuMs.median, total: m.frames.totalSubmissionCpuMs.median, totalP95: m.frames.totalSubmissionCpuMs.p95 },
      triangles: r?.triangles, drawCalls: r?.drawCalls, infoTrianglesAtRaf: r?.infoTrianglesAtRaf, systems: r?.systemCpuMsPerFrame, counts: r?.counts,
      heapMB: r?.heapMB, rendererMiB: r?.renderer?.total ? +(r.renderer.total / 1048576).toFixed(0) : null, readyAtMs: r?.readyAtMs, nav: r?.nav });
  }
  const sum = Object.values(phases).reduce((s, p) => s + p.ms, 0);
  rows.push({ tag, readyAfterGotoMs: ready, readyAtMs: views[0]?.readyAtMs ?? null, initPhasesMs: sum, phases, errors, views });
}
const fmt = (n) => (n == null ? '–' : n >= 1e6 ? (n / 1e6).toFixed(2) + ' M' : n >= 1e3 ? (n / 1e3).toFixed(0) + ' k' : String(n));
for (const r of rows) {
  const top = Object.entries(r.phases).sort((a, b) => b[1].ms - a[1].ms).slice(0, 5).map(([k, v]) => `${k} ${(v.ms / 1000).toFixed(1)} s`).join(', ');
  console.log(`\n## ${r.tag}: ready ${(r.readyAtMs / 1000).toFixed(1)} s after navigation (init phases ${(r.initPhasesMs / 1000).toFixed(1)} s; ${top}); heap at ready ${r.phases.gpu?.heapMB ?? '–'} MB${r.errors.length ? `; errors: ${r.errors.join(' | ')}` : ''}`);
  console.log('| view | frame p50/p95 ms | CPU sim+render p50 ms | tris/frame (view) | draws (view) | systems ms/frame | cars/peds/streetcars | heap MB | renderer MiB |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const v of r.views) {
    const sys = v.systems ? Object.values(v.systems).reduce((s, x) => s + x, 0).toFixed(2) : '–';
    console.log(`| ${v.view} | ${v.frameMs?.median}/${v.frameMs?.p95} | ${v.cpuMs?.sim}+${v.cpuMs?.render} | ${fmt(v.triangles?.median)} (${fmt(v.triangles?.viewMedian)}) | ${v.drawCalls?.median} (${v.drawCalls?.viewMedian}) | ${sys} | ${v.counts?.cars}/${v.counts?.peds}/${v.counts?.streetcars} | ${v.heapMB} | ${v.rendererMiB} |`);
  }
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(rows, null, 1) + '\n');
