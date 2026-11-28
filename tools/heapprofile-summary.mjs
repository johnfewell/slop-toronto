// tools/heapprofile-summary.mjs: what holds the JS heap, from a .heapprofile tools/load-timing.mjs wrote (setting.heap: true).
// usage: node tools/heapprofile-summary.mjs <file.heapprofile> [--top <n>]
// Output: the total live size the sampler saw, then the allocation sites (function, script, line) by the size still alive, and the same summed by script.
import fs from 'node:fs';
const args = process.argv.slice(2);
const ti = args.indexOf('--top'), top = ti >= 0 ? Number(args[ti + 1]) : 25;
const prof = JSON.parse(fs.readFileSync(args[0], 'utf8'));
const sites = new Map(), scripts = new Map(); let total = 0;
const walk = (n) => {
  const f = n.callFrame, url = (f.url || '(native)').replace(/^https?:\/\/[^/]+/, '').replace(/\.[a-f0-9]{8,}\.js$/, '.js').replace(/.*build\//, 'three/');
  if (n.selfSize) {
    const k = `${f.functionName || '(anonymous)'} ${url}:${f.lineNumber + 1}`;
    sites.set(k, (sites.get(k) || 0) + n.selfSize); scripts.set(url, (scripts.get(url) || 0) + n.selfSize); total += n.selfSize;
  }
  for (const c of n.children || []) walk(c);
};
walk(prof.head);
const mb = (b) => (b / 1048576).toFixed(1);
console.log(`live heap the sampler saw: ${mb(total)} MB\n\nby allocation site:`);
for (const [k, v] of [...sites].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`  ${mb(v)} MB  ${k}`);
console.log('\nby script:');
for (const [k, v] of [...scripts].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`  ${mb(v)} MB  ${k}`);
