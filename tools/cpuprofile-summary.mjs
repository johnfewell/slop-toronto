// tools/cpuprofile-summary.mjs: where a start-up's main-thread time goes, from a V8 sampling profile that tools/load-timing.mjs
// wrote (setting.profile: true -> <tag>-<setting>-r<round>-<arm>.cpuprofile) and the run's init marks (the results file's `marks`).
// usage: node tools/cpuprofile-summary.mjs <profile.cpuprofile> <results.json> <setting> <round> <arm> [--min <ms>] [--top <n>]
// Output (markdown): one block per start-up phase of at least --min ms (default 200): the phase's wall time, the main thread's busy time in it
// (everything but idle), the functions with most inclusive time ("who the phase's time is in") and the ones with most self time.
import fs from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, d) => { const i = args.indexOf(name); if (i < 0) return d; const v = Number(args[i + 1]); args.splice(i, 2); return v; };
const minMs = flag('--min', 200), top = flag('--top', 6);
const [profFile, resultsFile, setting, round, arm] = args;
const prof = JSON.parse(fs.readFileSync(profFile, 'utf8'));
const results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
const run = results.find((r) => r.setting === setting && String(r.round) === String(round) && r.arm === arm && !r.error);
if (!run) throw new Error('no such run in the results');
const marks = Object.entries(run.marks).sort((a, b) => a[1] - b[1]);

const nodes = new Map(prof.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);
// sample times in the page's clock: the profile ends at pageNowAtStop
const t = []; let acc = prof.startTime;
for (const d of prof.timeDeltas) { acc += d; t.push(acc); }
const endUs = acc; const toPage = (us) => prof.pageNowAtStop - (endUs - us) / 1000;
const label = (n) => {
  const f = n.callFrame;
  const url = (f.url || '').replace(/^https?:\/\/[^/]+/, '').replace(/\.[a-f0-9]{8,}\.js$/, '.js');
  return `${f.functionName || '(anonymous)'} ${url || '(native)'}:${f.lineNumber + 1}`;
};
const phases = []; let prevEnd = 0;
for (const [name, at] of marks) { phases.push({ name: name.replace('init:', ''), from: prevEnd, to: at }); prevEnd = at; }
const rows = phases.map((p) => ({ ...p, busy: 0, idle: 0, incl: new Map(), self: new Map() }));
let pi = 0;
for (let i = 0; i < prof.samples.length; i++) {
  const ms = toPage(t[i]); const dt = (prof.timeDeltas[i + 1] ?? prof.timeDeltas[i]) / 1000;
  while (pi < rows.length - 1 && ms >= rows[pi].to) pi++;
  const row = rows[pi]; if (ms < row.from - 1000 || ms > row.to + 1000) continue;
  const n = nodes.get(prof.samples[i]); const fn = n.callFrame.functionName;
  if (fn === '(idle)') { row.idle += dt; continue; }
  row.busy += dt;
  const sl = label(n); row.self.set(sl, (row.self.get(sl) || 0) + dt);
  const seen = new Set();
  for (let id = n.id; id !== undefined; id = parent.get(id)) {
    const l = label(nodes.get(id)); if (seen.has(l)) continue; seen.add(l);
    row.incl.set(l, (row.incl.get(l) || 0) + dt);
  }
}
const SKIP_INCL = /^(\(root\)|\(program\)|\(idle\)|initApp|\(anonymous\) \/explore\.html|async\b)/;
const f = (v) => Math.round(v);
console.log(`# ${setting} r${round} ${arm}: ready ${run.readyMs} ms, first frame ${run.marks['init:firstFrame']} ms\n`);
for (const r of rows) {
  const wall = r.to - r.from; if (wall < minMs) continue;
  console.log(`## ${r.name}: ${f(wall)} ms wall, ${f(r.busy)} ms main thread busy, ${f(r.idle)} ms idle`);
  const incl = [...r.incl].filter(([l]) => !SKIP_INCL.test(l)).sort((a, b) => b[1] - a[1]).slice(0, top);
  console.log('  inclusive: ' + incl.map(([l, v]) => `${f(v)} ms ${l}`).join('; '));
  const self = [...r.self].sort((a, b) => b[1] - a[1]).slice(0, top);
  console.log('  self: ' + self.map(([l, v]) => `${f(v)} ms ${l}`).join('; ') + '\n');
}
