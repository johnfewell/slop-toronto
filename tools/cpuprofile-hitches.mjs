// tools/cpuprofile-hitches.mjs: what the main thread was doing in each slow frame after ready, from a run of tools/load-timing.mjs with
// setting.tailSec (the result's `frames`, the .tail.cpuprofile beside it).
// usage: node tools/cpuprofile-hitches.mjs <tail.cpuprofile> <results.json> <setting> <round> <arm> [--over <ms>] [--top <n>]
import fs from 'node:fs';
const args = process.argv.slice(2);
const flag = (name, d) => { const i = args.indexOf(name); if (i < 0) return d; const v = Number(args[i + 1]); args.splice(i, 2); return v; };
const over = flag('--over', 50), top = flag('--top', 5);
const [profFile, resultsFile, setting, round, arm] = args;
const prof = JSON.parse(fs.readFileSync(profFile, 'utf8'));
const run = JSON.parse(fs.readFileSync(resultsFile, 'utf8')).find((r) => r.setting === setting && String(r.round) === String(round) && r.arm === arm && !r.error);
const nodes = new Map(prof.nodes.map((n) => [n.id, n])), parent = new Map();
for (const n of prof.nodes) for (const c of n.children || []) parent.set(c, n.id);
const t = []; let acc = prof.startTime;
for (const d of prof.timeDeltas) { acc += d; t.push(acc); }
const toPage = (us) => prof.pageNowAtStop - (acc - us) / 1000;
const label = (n) => { const f = n.callFrame; return `${f.functionName || '(anonymous)'} ${(f.url || '(native)').replace(/^https?:\/\/[^/]+/, '').replace(/\.[a-f0-9]{8,}\.js$/, '.js').replace(/.*build\//, 'three/')}:${f.lineNumber + 1}`; };
console.log(`# ${setting} r${round} ${arm}: ready ${run.readyMs} ms; frames over ${over} ms after ready (frame end = page ms; the frame's interval)`);
for (const [end, dt] of run.frames) {
  if (dt <= over || end < run.readyMs) continue;
  const incl = new Map(), self = new Map(); let busy = 0;
  for (let i = 0; i < t.length; i++) {
    const ms = toPage(t[i]); if (ms < end - dt || ms > end) continue;
    const n = nodes.get(prof.samples[i]); if (n.callFrame.functionName === '(idle)') continue;
    const d = (prof.timeDeltas[i + 1] || 0) / 1000; busy += d;
    const sl = label(n); self.set(sl, (self.get(sl) || 0) + d);
    const seen = new Set();
    for (let id = n.id; id !== undefined; id = parent.get(id)) { const l = label(nodes.get(id)); if (seen.has(l)) continue; seen.add(l); incl.set(l, (incl.get(l) || 0) + d); }
  }
  const SKIP = /^(\(root\)|\(program\)|\(idle\))/;
  const f = (m) => [...m].filter(([l]) => !SKIP.test(l)).sort((a, b) => b[1] - a[1]).slice(0, top).map(([l, v]) => `${Math.round(v)} ms ${l}`).join('; ');
  console.log(`\n## frame ending at ${end} ms (${Math.round(end - run.readyMs)} ms after ready): ${dt} ms, main thread busy ${Math.round(busy)} ms\n  inclusive: ${f(incl)}\n  self: ${f(self)}`);
}
