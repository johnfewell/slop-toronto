// tools/perf1/make.mjs <job> > shots.json: builds a shot list for tools/capture.mjs from the in-page probe (lib.js).
// jobs: disc (structure, census and one frame measurement at each place)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const dir = fileURLToPath(new URL('.', import.meta.url));
const lib = fs.readFileSync(dir + 'lib.js', 'utf8');
const job = process.argv[2];
const shots = [{ name: 'lib', wait: 100, metricsMs: 0, js: lib }];
const place = (name, body, o = {}) => shots.push({ name: `${job}-${name}`, wait: 200, record: true, metricsMs: 0, ...o, js: `(async () => { await __P.go(${JSON.stringify(name)}, ${o.settle || 9000}); ${body} })()` });
if (job === 'disc') {
  const names = ['cab', 'qwa', 'tb', 'fin', 'fin300', 'stj', 'out', 'isl', 'isln', 'night'];
  names.forEach((n, i) => place(n, `const R = { place: ${JSON.stringify(n)}, census: await __P.census(8), base: await __P.meas(500, 2500), treecull: __P.treeCull() };${i === 0 ? ' R.tree = __P.tree(); R.quality = __P.quality();' : ''} return R;`));
} else if (job === 'trace') {
  // the sequence of renderer.render calls (pass, scene, camera, target) over a few frames at PLACES
  const names = (process.env.PLACES || 'cab').split(' ');
  names.forEach((n) => place(n, `return { place: ${JSON.stringify(n)}, trace: await __P.trace(4) };`, { settle: 6000 }));
} else if (job === 'wb') {
  // what is written to the GPU every frame (queue.writeBuffer), at PLACES
  const names = (process.env.PLACES || 'cab').split(' ');
  names.forEach((n) => place(n, `return { place: ${JSON.stringify(n)}, wb: await __P.wb(8) };`));
} else if (job === 'arms') {
  // runtime ablations at the places in PLACES (space separated), see lib.js P.run; ROUNDS, MAXMS optional
  const names = (process.env.PLACES || 'cab').split(' ');
  const rounds = Number(process.env.ROUNDS || 3), maxMs = Number(process.env.MAXMS || 1500000);
  names.forEach((n) => place(n, `return await __P.run({ rounds: ${rounds}, maxMs: ${maxMs} });`, { wait: 300 }));
} else if (job === 'post') {
  // runtime: the post passes left out one at a time (stars sprite, clouds, SSR, bloom, shadow mask), at PLACES
  const names = (process.env.PLACES || 'cab').split(' ');
  names.forEach((n) => place(n, `return await __P.run({ rounds: 3, keep: 0, only: 'post' });`, { wait: 300, settle: 7000 }));
} else if (job === 'outside') {
  // the triangles each top-level group draws that lie outside the camera frustum (a triangle by its first vertex), at PLACES
  const names = (process.env.PLACES || 'cab').split(' ');
  names.forEach((n) => place(n, `return { place: ${JSON.stringify(n)}, outside: __P.outside() };`, { settle: 6000 }));
} else if (job === 'shots') {
  // one screenshot at each of PLACES (a page, so a reload arm is its query); ARM: a runtime arm of lib.js turned on after the move (needs P.run's arms: the named ones, the post passes, casc1:Trees ...)
  const names = (process.env.PLACES || 'cab fin fin300 night').split(' ');
  const arm = process.env.ARM || '';
  names.forEach((n) => place(n, `${arm ? `const all = [...__P.namedArms(), ...__P.postArms(), ...__P.mkArms(await __P.census(4))]; const a = all.find((x) => x.id === ${JSON.stringify(arm)}); if (!a) throw new Error('no arm ${arm}'); a.on(); await __P.sleep(2500);` : ''} const m = await __P.meas(300, 1500); return { place: ${JSON.stringify(n)}, arm: ${JSON.stringify(arm)}, ms: m.ms, cpu: m.cpu, n: m.n };`, { settle: 8000 }));
} else if (job === 'shadowonly') {
  // runtime: each group's shadow cost with every other caster off (and the sun shadow's own all / cascade arms), at PLACES
  const names = (process.env.PLACES || 'cab').split(' ');
  names.forEach((n) => place(n, `return await __P.run({ rounds: 3, keep: 0, only: 'shadowonly' });`, { wait: 300, settle: 7000 }));
} else if (job === 'ground') {
  // runtime: the ground's children hidden one at a time, at PLACES
  const names = (process.env.PLACES || 'cab').split(' ');
  names.forEach((n) => place(n, `return await __P.run({ rounds: 3, keep: 0, only: 'ground' });`, { wait: 300, settle: 7000 }));
} else if (job === 'visit') {
  // one page load, every place in PLACES: the base frame (median, CPU split) and a short census total, for the
  // reload arms (a query, see visits.sh); WINDOW ms per place
  const names = (process.env.PLACES || 'cab qwa tb fin fin300 stj out isl night').split(' ');
  const win = Number(process.env.WINDOW || 2500), settle = Number(process.env.SETTLE || 7000);
  names.forEach((n) => place(n, `__P.place = ${JSON.stringify(n)}; const R = { place: ${JSON.stringify(n)}, q: __P.quality().q.tier }; R.m = []; for (let i = 0; i < ${Number(process.env.WINDOWS || 1)}; i++) R.m.push(await __P.meas(500, ${win})); R.census = await __P.census(4); for (const k of Object.keys(R.census.passes)) { const p = R.census.passes[k]; delete p.by; delete p.by2; delete p.dist; delete p.ghost; } return R;`, { settle }));
} else if (job === 'prof') {
  // ten seconds of riding (a bike, KeyW held) from PLACES' first place, under the CPU profiler (CAPTURE_PROFILE=shots: profile.txt)
  const n = (process.env.PLACES || 'cab').split(' ')[0];
  const at = { cab: [1800, -1601, Math.PI / 2], qwa: [-1386.6, -713.6, Math.PI / 2] }[n];
  shots.length = 0;
  if (process.env.STATIC) { // the same, standing at the census camera (no input)
    const cam = { cab: [1800, -1601, [1800, 1.7, -1601], [1650, 5, -1606], 60], qwa: [-1386.6, -713.6, [-1386.6, 1.7, -713.6], [-1370.6, 6, -713.3], 65] }[n];
    shots.push({ name: `profs-${n}-m`, time: 'midday', wait: 9000, metricsMs: 0, js: `(() => { const a = window.__CITY_APP; a.teleportTo(${cam[0]}, ${cam[1]}, 0); a.cameraSystem.cinema = () => ({ pos: ${JSON.stringify(cam[2])}, look: ${JSON.stringify(cam[3])}, fov: ${cam[4]} }); return 1; })()` });
    shots.push({ name: `profs-${n}-hold`, wait: 10000, profile: true, metricsMs: 0, js: '(() => { window.__f0 = window.__CITY_APP.frameNo; window.__t0 = performance.now(); return 1; })()' });
    shots.push({ name: `profs-${n}-end`, wait: 100, record: true, metricsMs: 0, js: '(() => ({ frames: window.__CITY_APP.frameNo - window.__f0, ms: performance.now() - window.__t0 }))()' });
    process.stdout.write(JSON.stringify(shots, null, 1) + '\n'); process.exit(0);
  }
  shots.push({ name: `prof-${n}-m`, mode: 'cyclist', time: 'midday', x: at[0], z: at[1], heading: at[2], wait: 9000, metricsMs: 0,
    js: '(() => { const a = window.__CITY_APP; a.cameraSystem.cinema = null; a.controllerManager.keys.boost = false; window.__f0 = a.frameNo; window.__t0 = performance.now(); return 1; })()' });
  shots.push({ name: `prof-${n}-ride`, hold: 'KeyW', wait: 10000, profile: true, metricsMs: 0, js: '(() => { window.__f0 = window.__CITY_APP.frameNo; window.__t0 = performance.now(); return 1; })()' });
  shots.push({ name: `prof-${n}-end`, wait: 100, record: true, metricsMs: 0, js: '(() => ({ frames: window.__CITY_APP.frameNo - window.__f0, ms: performance.now() - window.__t0 }))()' });
} else throw new Error('unknown job ' + job);
process.stdout.write(JSON.stringify(shots, null, 1) + '\n');
