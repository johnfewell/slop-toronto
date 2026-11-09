// Writes the zoo animals' idle-life capture shot lists (docs/high-park-zoo-animals.md, st-gtnq):
//   node tools/zoo/make-anim-shots.mjs
// tools/shots/zoo-anim-videos.json: screencasts (run with ?liveDate=&liveClock=): the herd along the enclosure from the
//   path, the bison and a llama close from the fence, the emus and peafowl pecking, and an animal walking side-on (the
//   herd's own timeline looked ahead for its next amble, the sim's clock moved on to just before it)
// tools/shots/zoo-anim-summer.json: the herd, the bison and a walk, for a summer day; zoo-anim-birds.json: the birds
// tools/shots/zoo-anim-stills.json: an animal grazing (the clock held) and the same moment with the bend off: its shadow
//   follows its pose; and the debug check of the sim and the shader's inputs
// tools/shots/zoo-anim-contact.json: each grazer's muzzle on the grass (a still each), the graze and peck videos
// tools/shots/zoo-anim-ab.json: the cost, the bend and the herd's step on and off in one page (A B A B A B), uncapped
import fs from 'node:fs';

const hud = '(() => { const b = document.getElementById("btn-toggle-hud"); if (b && !document.body.classList.contains("film")) { b.click(); document.body.classList.add("film"); } })();';
// (clear(P, L): nothing of the scene's but the animals between the camera P and the point L: no city building's footprint
// on the sight line (nor within 2 m of the camera), and a raycast against the meshes whose bounds the line passes through)
const pre = `const C = window.CITY, A = window.__CITY_APP, Z = C.highParkZoo, Zs = Z.anim, g = (x, z) => C.DON_VALLEY.heightAt(x, z) + (C.blockAt(x, z) ? 0.22 : 0);
  const bAt = C.__zooBuildingAt || (C.__zooBuildingAt = C.buildingIndex ? C.buildingIndex(C.GEO) : () => false);
  const clear = (P, L) => { for (let k = 0; k <= 40; k++) { const x = P[0] + ((L[0] - P[0]) * k) / 40, z = P[2] + ((L[2] - P[2]) * k) / 40; if (bAt(x, z) || [[2, 0], [-2, 0], [0, 2], [0, -2]].some(([dx, dz]) => k === 0 && bAt(x + dx, z + dz))) return false; }
    const T = C.THREE, a = new T.Vector3(...P), b = new T.Vector3(...L), d = a.distanceTo(b), rc = new T.Raycaster(a, b.clone().sub(a).normalize(), 0.3, d - 0.8), objs = [];
    // (the park's shrubs are placed on the GPU: their middles from aShrub, kept 2 m off the sight line)
    let shrub = false;
    A.scene.traverse((o) => { const S = o.isInstancedMesh && o.geometry && o.geometry.attributes.aShrub; if (!S || shrub) return; for (let i = 0; i < o.count; i++) { const x = S.array[4 * i + 1], z = S.array[4 * i + 3]; if (Math.abs(x - P[0]) < d + 3 && Math.abs(z - P[2]) < d + 3) { const ex = L[0] - P[0], ez = L[2] - P[2], t = Math.max(0, Math.min(1, ((x - P[0]) * ex + (z - P[2]) * ez) / (ex * ex + ez * ez))); if (Math.hypot(P[0] + ex * t - x, P[2] + ez * t - z) < 2) { shrub = true; break; } } } });
    if (shrub) return false;
    A.scene.traverse((o) => { if (!o.isMesh || !o.visible || !o.geometry || /^HighParkZoo|ParkCover|Grass|Rain|Cloud|Sky|Water/i.test(o.name)) return; if (o.isInstancedMesh && !o.boundingSphere) o.computeBoundingSphere(); const bs = o.isInstancedMesh ? o.boundingSphere : (o.geometry.boundingSphere || (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere)); if (!bs || bs.radius > 3000) return; const sph = bs.clone().applyMatrix4(o.matrixWorld); if (sph.center.distanceTo(a) < sph.radius + d && rc.ray.intersectsSphere(sph)) objs.push(o); });
    return rc.intersectObjects(objs, false).length === 0; };`;
// (the k-th animal of a species in the herd sim)
const idx = (name, k = 0) => `(Zs.inputs.animals.findIndex((a) => a.species === '${name}') + ${k})`;
const setup = { name: 'setup', mode: 'person', x: -6560, z: -1985, heading: 3.6, js: hud, wait: 6000 };
const ready = { name: 'zoo-ready', wait: 500, js: `(async () => { const t0 = performance.now(); while (performance.now() - t0 < 60000) { const Z = window.CITY.highParkZoo; if (!Z || ['models', 'failed', 'off'].includes(Z.state)) break; await new Promise((r) => setTimeout(r, 250)); } const Z = window.CITY.highParkZoo; return Z ? { state: Z.state, models: Z.models, failed: Z.failed, anim: Z.anim && { enabled: Z.anim.enabled, t: Z.anim.t, seed: Z.anim.seed } } : null; })()` };
const check = { name: 'zoo-anim-check', record: true, wait: 300, js: `(() => { ${pre} const out = {}; A.scene.traverse((o) => { if (o.isInstancedMesh && /^HighParkZooModel/.test(o.name)) out[o.name] = { count: o.count, visible: o.visible, material: o.material.name, rig: !!o.userData.zooU, attrs: Object.keys(o.geometry.attributes) }; });
  return { state: Z.state, anim: { enabled: Zs.enabled, t: Zs.t, steps: Zs.steps, msPerStep: Zs.steps ? Zs.ms / Zs.steps : null, active: Zs.active }, meshes: out, acts: Zs.sim.animals.map((a) => a.act.kind), tier: C.QUALITY.tier }; })()` };
// (a camera standing at P looking at the animal k as it moves, at height `ly` on it)
const follow = (P, k, ly, fov) => `A.cameraSystem.cinema = () => { const S = Zs.sim.state(${k}, Zs.t); return { pos: ${P}, look: [S.x, g(S.x, S.z) + ${ly}, S.z], fov: ${fov} }; };`;
// (the clock moved on to 1.5 s before the animal's next act of that kind, the herd's own timeline looked ahead)
const toAct = (kind) => (kind ? `{ const Lk = C.zooHerdSim({ ...Zs.inputs, seed: Zs.seed }); let at = null; for (let t = Zs.t; t < Zs.t + 3600 && at === null; t += 0.5) { Lk.advance(t); const a = Lk.animals[i].act; if (a.kind === '${kind}' && a.t0 > Zs.t + 2 && a.d > 9) at = a.t0; } if (at !== null) { Zs.t = at - 1.5; Zs.write(Zs.t); } }` : '');
// a close view of one animal from outside it: three-quarters from the side away from the enclosure's middle, d m off,
// at a standing person's eye height (or the animal's); `act`: wait (on the sim's clock) for its next act of that kind;
// `inward`: from the side towards the enclosure's middle instead (the emus' paddock backs onto a building)
const close = (name, k, d, ly, fov = 40, act = null, inward = false) => `${hud}(() => { ${pre} const i = ${idx(name, k)}; ${toAct(act)} const S = Zs.sim.state(i, Zs.t), B = Z.box, mx = (B.x0 + B.x1) / 2, mz = (B.z0 + B.z1) / 2;
  const fx = Math.sin(S.yaw), fz = Math.cos(S.yaw); let best = null;
  const at = [S.x, g(S.x, S.z) + ${ly}, S.z];
  for (const side of [1, -1, 0.5, -0.5, 0, 2, -2]) for (const dd of [${d}, ${d} * 0.7]) { const dx = -fz * 0.85 * side + fx * 0.5, dz = fx * 0.85 * side + fz * 0.5, l = Math.hypot(dx, dz), px = S.x + (dx / l) * dd, pz = S.z + (dz / l) * dd, cam = [px, g(px, pz) + 1.6, pz];
    const out = Math.hypot(px - mx, pz - mz) * ${inward ? -1 : 1} + (clear(cam, at) ? 1e6 : 0); if (!best || out > best.out) best = { px, pz, out }; }
  const P = [best.px, g(best.px, best.pz) + 1.6, best.pz]; ${follow('P', 'i', ly, fov)} return { i, species: '${name}', pos: P, t: Zs.t }; })()`;
// the herd along the enclosure from inside its end (the paddocks' woods hide it from outside): the camera `up` m over
// the end spot of the `from` species' stretch (the lowest, end -1, or highest, end 1, along the enclosure's axis),
// looking at the `at` species' middle, along Deer Pen Road's fence
const wide = (from, end, at, up, fov) => `${hud}(() => { ${pre} const ax = 0.63, az = 0.78, A0 = Zs.inputs.animals.findIndex((a) => a.species === '${from}'), R = Zs.inputs.regions[A0];
  const sp = R.reduce((b, p) => (b === null || (p[0] * ax + p[1] * az) * ${end} > (b[0] * ax + b[1] * az) * ${end} ? p : b), null);
  const want = ${JSON.stringify(at)}, T = Zs.inputs.animals.filter((a) => want.includes(a.species)), tx = T.reduce((s, a) => s + a.x, 0) / T.length, tz = T.reduce((s, a) => s + a.z, 0) / T.length;
  const Pc = [sp[0], g(sp[0], sp[1]) + ${up}, sp[1]], L = [tx, g(tx, tz) + 0.6, tz]; A.cameraSystem.cinema = () => ({ pos: Pc, look: L, fov: ${fov} }); return { pos: Pc, look: L, t: Zs.t }; })()`;
// (the camera above the summer's tall grass and goldenrod, 1.3 m: from inside it a card fills the view)
// the next walk of one of these species (the herd's own timeline looked ahead), the clock moved on to 3 s before its
// turn, the camera side-on to the path 7 m off on the side away from the enclosure's middle, following it
const walk = (species, minDist = 3.5, d = 7, up = 1.9) => `${hud}(() => { ${pre} const Lk = C.zooHerdSim({ ...Zs.inputs, seed: Zs.seed }); const want = ${JSON.stringify(species)}; let found = null;
  // (the camera side-on to the path with a clear sight of its start, middle and end, on the side away from the
  // enclosure's middle if both are)
  const B = Z.box, cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2;
  const view = (q) => { const mx = (q.ax + q.bx) / 2, mz = (q.az + q.bz) / 2, L = Math.hypot(q.bx - q.ax, q.bz - q.az), nx = -(q.bz - q.az) / L, nz = (q.bx - q.ax) / L;
    const sides = [1, -1].map((s) => ({ px: mx + nx * ${d} * s, pz: mz + nz * ${d} * s })).filter((c) => { const cam = [c.px, g(c.px, c.pz) + ${up}, c.pz]; return [[q.ax, q.az], [mx, mz], [q.bx, q.bz]].every(([x, z]) => clear(cam, [x, g(x, z) + 0.6, z])); }).sort((a, b) => Math.hypot(b.px - cx, b.pz - cz) - Math.hypot(a.px - cx, a.pz - cz));
    return sides[0] || null; };
  for (let t = Zs.t; t < Zs.t + 3600 && !found; t += 0.5) { Lk.advance(t); Lk.animals.forEach((a, k) => { const q = a.queue[0]; if (!found && a.act.kind === 'turn' && q && q.kind === 'walk' && a.act.t0 > Zs.t + 2 && want.includes(a.species) && Math.hypot(q.bx - q.ax, q.bz - q.az) >= ${minDist}) { const c = view(q); if (c) found = { k, species: a.species, t0: a.act.t0, turn: a.act.d, walk: q.d, ax: q.ax, az: q.az, bx: q.bx, bz: q.bz, ...c }; } }); }
  if (!found) return null; Zs.t = found.t0 - 3;
  const px = found.px, pz = found.pz, P = [px, g(px, pz) + ${up}, pz]; ${follow('P', 'found.k', 0.6, 38)} return found; })()`;
const VIDEO = 26000;
const videos = [setup, ready,
  { name: 'video-wide', record: true, js: wide('bison', -1, ['bison', 'yak', 'highland'], 3, 36), wait: 2500, screencastMs: VIDEO, screencastQuality: 85 },
  { name: 'video-bison', js: close('bison', 1, 7, 1.0, 40, 'graze'), wait: 1000, screencastMs: VIDEO, screencastQuality: 85 },
  { name: 'video-llama', js: close('llama', 0, 6, 1.1, 40, 'look'), wait: 1000, screencastMs: VIDEO, screencastQuality: 85 },
  { name: 'video-emu', js: close('emu', 0, 6, 0.9, 40, 'peck', true), wait: 1000, screencastMs: VIDEO, screencastQuality: 85 },
  { name: 'video-peafowl', js: close('peafowl', 0, 4, 0.4, 38, 'peck'), wait: 1000, screencastMs: VIDEO, screencastQuality: 85 },
  { name: 'video-capybara', js: close('capybara', 0, 3.5, 0.3, 40), wait: 1000, screencastMs: 16000, screencastQuality: 85 },
  { name: 'video-walk', record: true, js: walk(['bison', 'highland', 'yak', 'llama', 'reindeer']), wait: 1500, screencastMs: 22000, screencastQuality: 85 },
  { name: 'video-walk-bird', record: true, js: walk(['emu'], 3, 6, 1.8), wait: 1500, screencastMs: 20000, screencastQuality: 85 },
  check];
fs.writeFileSync('tools/shots/zoo-anim-videos.json', JSON.stringify(videos, null, 1) + '\n');
// (the birds alone: the emus and peafowl pecking, an emu walking)
fs.writeFileSync('tools/shots/zoo-anim-birds.json', JSON.stringify(videos.filter((s) => ['setup', 'zoo-ready', 'video-emu', 'video-peafowl', 'video-walk-bird'].includes(s.name)), null, 1) + '\n');
// (summer: the herd, the bison and a walk)
fs.writeFileSync('tools/shots/zoo-anim-summer.json', JSON.stringify(videos.filter((s) => ['setup', 'zoo-ready', 'video-wide', 'video-bison', 'video-walk'].includes(s.name)), null, 1) + '\n');

// The shadows: an animal's next graze (looked ahead), the clock moved into it and held; the same camera with the bend on
// and off. (a low November sun: run with ?liveDate=2026-11-08&liveClock=2026-11-08T20:00:00Z)
const graze = (name, k, d) => `${hud}(() => { ${pre} const i = ${idx(name, k)}; const Lk = C.zooHerdSim({ ...Zs.inputs, seed: Zs.seed }); let at = null;
  for (let t = Zs.t; t < Zs.t + 3600 && at === null; t += 0.25) { Lk.advance(t); if (Lk.state(i, t).g > 0.97) at = t; }
  if (at === null) return null; Zs.t = at; Zs.write(at); Zs.paused = true; const S = Zs.sim.state(i, at);
  const B = Z.box, mx = (B.x0 + B.x1) / 2, mz = (B.z0 + B.z1) / 2, fx = Math.sin(S.yaw), fz = Math.cos(S.yaw); let best = null;
  for (const side of [1, -1]) { const px = S.x - fz * ${d} * side + fx * 2, pz = S.z + fx * ${d} * side + fz * 2, out = Math.hypot(px - mx, pz - mz); if (!best || out > best.out) best = { px, pz, out }; }
  const P = [best.px, g(best.px, best.pz) + 3.2, best.pz];
  A.cameraSystem.cinema = () => ({ pos: P, look: [S.x, g(S.x, S.z) + 0.3, S.z], fov: 46 }); return { i, t: at, g: S.g }; })()`;
const stills = [setup, ready];
for (const [name, k, d] of [['bison', 0, 7], ['llama', 1, 6], ['highland', 0, 6]]) {
  stills.push({ name: `shadow-${name}-posed`, js: graze(name, k, d), wait: 2500 });
  stills.push({ name: `shadow-${name}-rest`, js: '(() => { const Zs = window.CITY.highParkZoo.anim; Zs.setEnabled(false); return Zs.enabled; })()', wait: 2500 });
  stills.push({ name: `shadow-${name}-reset`, js: '(() => { const Zs = window.CITY.highParkZoo.anim; Zs.setEnabled(true); Zs.paused = false; return Zs.enabled; })()', wait: 300 });
}
stills.push(check);
fs.writeFileSync('tools/shots/zoo-anim-stills.json', JSON.stringify(stills, null, 1) + '\n');

// The muzzle on the grass (tools/shots/zoo-anim-contact.json): each grazer at its next moment fully down (a peafowl at a
// peck's bottom), the clock held, the camera low and side-on to its head 4 m off, on a side with a clear sight of it;
// then the graze and peck videos again
const contact = (name, k, kind, d = 4) => `${hud}(() => { ${pre} const i = ${idx(name, k)}; const Lk = C.zooHerdSim({ ...Zs.inputs, seed: Zs.seed }); let at = null;
  for (let t = Zs.t + 2; t < Zs.t + 3600 && at === null; t += 0.02) { Lk.advance(t); if (Lk.animals[i].act.kind === '${kind}' && Lk.state(i, t).g > 0.99) at = t; }
  if (at === null) return null; Zs.t = at; Zs.write(at); Zs.paused = true; const S = Zs.sim.state(i, at), len = Zs.inputs.animals[i].len;
  const fx = Math.sin(S.yaw), fz = Math.cos(S.yaw), hx = S.x + fx * len * 0.5, hz = S.z + fz * len * 0.5, H = [hx, g(hx, hz) + 0.15, hz];
  let best = null;
  for (const side of [1, -1, 0.6, -0.6]) { const l = Math.hypot(1, side), px = hx + ((-fz * side + fx * 0.25) / l) * ${d}, pz = hz + ((fx * side + fz * 0.25) / l) * ${d}, cam = [px, g(px, pz) + 0.45, pz]; if (clear(cam, H)) { best = cam; break; } if (!best) best = cam; }
  A.cameraSystem.cinema = () => ({ pos: best, look: H, fov: 32 }); return { i, species: '${name}', t: at, g: S.g, pos: best, look: H }; })()`;
const release = { name: 'release', js: '(() => { window.CITY.highParkZoo.anim.paused = false; return true; })()', wait: 200 };
const contactShots = [setup, ready];
for (const [name, k, kind, d] of [['bison', 1, 'graze'], ['yak', 0, 'graze'], ['highland', 0, 'graze'], ['reindeer', 0, 'graze'], ['mouflon', 0, 'graze'], ['barbary', 0, 'graze'], ['peafowl', 0, 'peck', 3]])
  contactShots.push({ name: `contact-${name}`, record: true, js: contact(name, k, kind, d), wait: 2500 }, { ...release, name: `release-${name}` });
contactShots.push(videos.find((v) => v.name === 'video-bison'),
  { name: 'video-highland', record: true, js: close('highland', 0, 6, 0.8, 40, 'graze'), wait: 1000, screencastMs: 26000, screencastQuality: 85 },
  videos.find((v) => v.name === 'video-peafowl'), check);
fs.writeFileSync('tools/shots/zoo-anim-contact.json', JSON.stringify(contactShots, null, 1) + '\n');

// The cost: the enclosure along its length from 30 m up (as tools/shots/zoo-ab.json), the bend and the step off
// (frozen: the park's static material, no step: ?zooanim=0's path) and on, alternated; each arm reports the step's own
// time over its window
const axisView = `${hud}(() => { ${pre} const P = Zs.inputs.animals.map((a) => [a.x, a.z]); const cx = P.reduce((s, p) => s + p[0], 0) / P.length, cz = P.reduce((s, p) => s + p[1], 0) / P.length, ax = 0.63, az = 0.78;
  const far = Math.max(...P.map((p) => (p[0] - cx) * ax + (p[1] - cz) * az)), px = cx + ax * (far + 40), pz = cz + az * (far + 40); const Pc = [px, g(px, pz) + 30, pz], L = [cx, g(cx, cz), cz]; A.cameraSystem.cinema = () => ({ pos: Pc, look: L, fov: 50 }); return { pos: Pc }; })()`;
const arm = (on) => `(() => { const Z = window.CITY.highParkZoo, Zs = Z.anim, prev = { steps: Zs.steps, ms: Zs.ms }; Zs.setEnabled(${on}); Zs.steps = 0; Zs.ms = 0; let mats = new Set(); window.__CITY_APP.scene.traverse((o) => { if (o.isInstancedMesh && /^HighParkZooModel/.test(o.name) && o.visible) mats.add(o.material.name); }); return { arm: '${on ? 'animated' : 'frozen'}', enabled: Zs.enabled, materials: [...mats], previousArm: { steps: prev.steps, msPerStep: prev.steps ? prev.ms / prev.steps : 0 } }; })()`;
const ab = [{ ...setup, metricsMs: 0 }, { ...ready, metricsMs: 0 }, { name: 'ab-view', js: axisView, wait: 2000, metricsMs: 0 },
  // (both materials' pipelines built before the windows)
  { name: 'ab-warm-off', js: arm(false), wait: 1500, metricsMs: 0 }, { name: 'ab-warm-on', js: arm(true), wait: 1500, metricsMs: 0 }];
for (let i = 1; i <= 3; i++) for (const on of [false, true]) ab.push({ name: `ab-${on ? 'animated' : 'frozen'}-${i}`, record: true, js: arm(on), wait: 1500 });
ab.push({ name: 'ab-last', record: true, metricsMs: 0, wait: 200, js: arm(true) }, { ...check, metricsMs: 0 });
fs.writeFileSync('tools/shots/zoo-anim-ab.json', JSON.stringify(ab, null, 1) + '\n');
console.log('wrote tools/shots/zoo-anim-videos.json, zoo-anim-summer.json, zoo-anim-birds.json, zoo-anim-stills.json, zoo-anim-contact.json, zoo-anim-ab.json');
