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
  const names = (process.env.PLACES || 'cab qwa tb fin fin300 stj out isl isln night').split(' ');
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
} else if (job === 'groundmats') {
  // the ground's drawn meshes (CityGround, visible, in the view) by material: count, triangles, material class and name, shadow flags, what it casts/receives; at PLACES
  const names = (process.env.PLACES || 'egl').split(' ');
  names.forEach((n) => place(n, `const T = window.CITY.THREE, A = window.__CITY_APP, cam = A.cameraSystem.camera; cam.updateMatrixWorld();
    const fr = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse), cam.coordinateSystem, cam.reversedDepth);
    const sp = new T.Sphere(), by = {}, vis = (o) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
    for (const top of A.scene.children.filter((c) => (c.name || c.type) === 'CityGround')) top.traverse((m) => {
      if (!m.isMesh || !vis(m)) return; const g = m.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); sp.copy(g.boundingSphere).applyMatrix4(m.matrixWorld); if (!fr.intersectsSphere(sp)) return;
      const mat = Array.isArray(m.material) ? m.material[0] : m.material, tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
      let anc = m.parent, path = []; while (anc && anc !== top) { path.unshift(anc.name || anc.type); anc = anc.parent; }
      const k = (mat.name || '') + '|' + mat.type + '|' + path.slice(0, 2).join('/') + '|rs' + (m.receiveShadow ? 1 : 0) + 'cs' + (m.castShadow ? 1 : 0) + '|' + (mat.transparent ? 'T' : 'O') + (mat.maskNode ? 'M' : '') + (mat.alphaTest ? 'A' : '') + (mat.side === 2 ? 'D' : '');
      const e = by[k] ||= { meshes: 0, tris: 0, attrs: Object.keys(g.attributes).join(',') }; e.meshes++; e.tris += tris; });
    return { place: ${JSON.stringify(n)}, by: Object.entries(by).sort((a, b) => b[1].tris - a[1].tris).slice(0, 30) };`, { settle: 7000 }));
} else if (job === 'ft') {
  // every frame's interval for FTSECONDS (default 20) at each of PLACES, in the shape tools/frame-time-chart.mjs draws (tools/shots/frame-times.json's recorder)
  const ftjs = JSON.parse(fs.readFileSync(dir + '../shots/frame-times.json', 'utf8'))[0].js;
  const names = (process.env.PLACES || 'hpw egl').split(' ');
  names.forEach((n) => place(n, `window.__captureShot = { ftSeconds: ${Number(process.env.FTSECONDS || 20)} }; const R = await (${ftjs}); R.place = ${JSON.stringify(n)}; return R;`, { settle: Number(process.env.FTSETTLE || 8000) }));
} else if (job === 'groundx') {
  // the ground's cost by cause, at PLACES: every visible CityGround mesh given a flat unlit material (the shader), made invisible (shader + geometry),
  // and its shadow off, each against the frame measured before and after (3 rounds)
  const names = (process.env.PLACES || 'egl').split(' ');
  names.forEach((n) => place(n, `const T = window.CITY.THREE, A = window.__CITY_APP; const vis = (o) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
    const ms = []; for (const top of A.scene.children.filter((c) => (c.name || c.type) === 'CityGround')) top.traverse((m) => { if (m.isMesh && vis(m)) ms.push(m); });
    const flat = new T.MeshBasicNodeMaterial({ color: 0x555555 });
    const arms = { flat: { on: () => { for (const m of ms) { m.__mat = m.material; m.material = flat; } }, off: () => { for (const m of ms) m.material = m.__mat; } },
      hidden: { on: () => { for (const m of ms) { m.__vis = m.visible; m.visible = false; } }, off: () => { for (const m of ms) m.visible = m.__vis; } },
      noshadow: { on: () => { for (const m of ms) { m.__cs = m.castShadow; m.castShadow = false; } }, off: () => { for (const m of ms) m.castShadow = m.__cs; } } };
    const res = { place: ${JSON.stringify(n)}, meshes: ms.length, tris: ms.reduce((s, m) => s + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3, 0), arms: {} };
    let prev = await __P.meas(300, 1500);
    for (let r = 0; r < 3; r++) for (const [k, a] of Object.entries(arms)) { a.on(); await __P.sleep(1500); const x = await __P.meas(300, 1500); a.off(); await __P.sleep(400); const b = await __P.meas(300, 1500); (res.arms[k] ||= []).push(+(x.ms - (prev.ms + b.ms) / 2).toFixed(2)); prev = b; }
    return res;`, { settle: 7000 }));
} else if (job === 'shadowfreq') {
  // the sun shadows redrawn less often, at PLACES: every 2nd frame (QUALITY.shadowEvery), the far cascade alone every 2nd or 4th frame, each against the frame before and after (3 rounds)
  const names = (process.env.PLACES || 'egl').split(' ');
  names.forEach((n) => place(n, `const A = window.__CITY_APP, Q = window.CITY.QUALITY;
    const arms = { 'all-every2': { on: () => { Q.shadowEvery = 2; }, off: () => { Q.shadowEvery = 1; } },
      'casc1-every2': { on: () => { __P.skipFn = (l) => l === 'shadow1' && (A.frameNo & 1); }, off: () => { __P.skipFn = null; } },
      'casc1-every4': { on: () => { __P.skipFn = (l) => l === 'shadow1' && (A.frameNo & 3); }, off: () => { __P.skipFn = null; } },
      'casc0-every2': { on: () => { __P.skipFn = (l) => l === 'shadow0' && (A.frameNo & 1); }, off: () => { __P.skipFn = null; } } };
    const res = { place: ${JSON.stringify(n)}, arms: {} };
    let prev = await __P.meas(300, 1500);
    for (let r = 0; r < 3; r++) for (const [k, a] of Object.entries(arms)) { a.on(); await __P.sleep(800); const x = await __P.meas(300, 1500); a.off(); await __P.sleep(400); const b = await __P.meas(300, 1500); (res.arms[k] ||= []).push(+(x.ms - (prev.ms + b.ms) / 2).toFixed(2)); prev = b; }
    return res;`, { settle: 7000 }));
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
