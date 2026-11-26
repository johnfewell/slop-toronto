// tools/perf4/make4.mjs <job> > shots.json: shot lists for the ground-cost pass (st-aeg2.4). Needs tools/perf1/lib.js then lib4.js in the page.
// env: PLACES (space separated, default 'cab qwa tb fin out'), TOPS (extra ground top-level groups, comma separated), ARMS (comma separated arm specs, see lib4.js armsFor), ROUNDS
// jobs: inv (structure, shaders, layers), arms (arms measured B A B A), shots (one screenshot per place with ARMS turned on)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const dir = fileURLToPath(new URL('.', import.meta.url));
const lib = fs.readFileSync(dir + '../perf1/lib.js', 'utf8'), lib4 = fs.readFileSync(dir + 'lib4.js', 'utf8');
const job = process.argv[2];
const names = (process.env.PLACES || 'cab qwa tb fin out').split(' ');
const tops = (process.env.TOPS || '').split(',').filter(Boolean);
const arms = (process.env.ARMS || '').split(',').filter(Boolean);
const shots = [{ name: 'lib', wait: 100, metricsMs: 0, js: lib }, { name: 'lib4', wait: 100, metricsMs: 0, js: lib4 }];
const place = (name, body, o = {}) => shots.push({ name: `${job}-${name}`, wait: 200, record: true, metricsMs: 0, ...o,
  js: `(async () => { await __P.go(${JSON.stringify(name)}, ${o.settle || 9000}); __P.GROUND_TOPS.push(...${JSON.stringify(tops)}); ${body} })()` });
if (job === 'inv') {
  names.forEach((n) => place(n, `return { place: ${JSON.stringify(n)}, tops: __P.topInv(), cuts: __P.cuts(), inv: __P.inv(), bands: __P.bands(), census: await __P.census(6), order: await __P.drawOrder(), shaders: await __P.shaders({ keep: ${JSON.stringify(process.env.KEEP ? process.env.KEEP.split(',') : [])} }), overdraw: await __P.overdraw(), };`, { settle: 8000 }));
} else if (job === 'od') {
  names.forEach((n) => place(n, `return { place: ${JSON.stringify(n)}, overdraw: await __P.overdraw() };`, { settle: 8000 }));
} else if (job === 'arms') {
  names.forEach((n) => place(n, `return await __P.run4({ arms: __P.armsFor(${JSON.stringify(arms)}), rounds: ${Number(process.env.ROUNDS || 3)}, settle: ${Number(process.env.SETTLE || 600)} });`, { wait: 300, settle: 7000 }));
} else if (job === 'shots') {
  names.forEach((n) => place(n, `${arms.length ? `const A4 = __P.armsFor(${JSON.stringify(arms)}); A4.forEach((a) => a.on()); await __P.sleep(2500);` : ''} const m = await __P.meas(300, 1500); return { place: ${JSON.stringify(n)}, arms: ${JSON.stringify(arms)}, ms: m.ms, n: m.n };`, { settle: 8000 }));
} else throw new Error('unknown job ' + job);
process.stdout.write(JSON.stringify(shots, null, 1) + '\n');
