// Writes the zoo's capture shot lists (docs/high-park-zoo-animals.md): node tools/zoo/make-shots.mjs
// tools/shots/zoo-animals.json: a close view of each species' paddock (golden hour and midday) and the enclosure from
// the air, after the models are in; tools/shots/zoo-seasons.json: the same views on the day's own light (run with
// ?liveClock=&liveDate=); tools/shots/zoo-approach.json: a flight in from 750 m with the frames timed around the swap
import fs from 'node:fs';
const PERP_X = 0.78, PERP_Z = -0.63, AX = [0.63, 0.78];
// (which animal of a herd, and from which side, where the first one's view is blocked)
const VIEW = { llama: [1, -1], emu: [1, -1], barbary: [0, -1], highland: [2, -1], yak: [1, -1] };
const HERDS = { // (the herds' centres and spreads, from the build: tools/zoo/herds.mjs)
  bison: [-6498.9, -1853.1, 1.7], yak: [-6488.4, -1782.3, 1.45], highland: [-6480.6, -1761.6, 1.2], llama: [-6439.1, -1732.8, 1.1],
  reindeer: [-6450.7, -1687.4, 1.1], mouflon: [-6415.5, -1619.9, 0.72], barbary: [-6370.8, -1629, 0.9], capybara: [-6373.4, -1581.5, 0.5],
  emu: [-6349, -1561.2, 1.7], peafowl: [-6282.2, -1566.8, 0.95]
};
const hud = '(() => { const b = document.getElementById("btn-toggle-hud"); if (b && !document.body.classList.contains("film")) { b.click(); document.body.classList.add("film"); } })();';
const g = 'const C = window.CITY, A = window.__CITY_APP, g = (x, z) => C.DON_VALLEY.heightAt(x, z) + (C.blockAt(x, z) ? 0.22 : 0);';
const cam = (P, L, fov = 50) => `${hud}(() => { ${g} const P = [${P[0]}, g(${P[0]}, ${P[2]}) + ${P[1]}, ${P[2]}], L = [${L[0]}, g(${L[0]}, ${L[2]}) + ${L[1]}, ${L[2]}]; A.cameraSystem.cinema = () => ({ pos: P, look: L, fov: ${fov} }); return { pos: P, look: L }; })()`;
// (along the enclosure: from past its south-east end, `back` m beyond the last herd and `up` m up, towards the middle)
const axisView = (up, back, fov) => `${hud}(() => { ${g} const P = []; A.scene.traverse((o) => { if (o.isInstancedMesh && /^HighParkZoo_/.test(o.name)) { const m = new o.matrix.constructor(); for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); P.push([m.elements[12], m.elements[14]]); } } });
  const cx = P.reduce((s, p) => s + p[0], 0) / P.length, cz = P.reduce((s, p) => s + p[1], 0) / P.length, ax = ${AX[0]}, az = ${AX[1]};
  const far = Math.max(...P.map((p) => (p[0] - cx) * ax + (p[1] - cz) * az)), px = cx + ax * (far + ${back}), pz = cz + az * (far + ${back});
  const Pc = [px, g(px, pz) + ${up}, pz], L = [cx, g(cx, cz), cz]; A.cameraSystem.cinema = () => ({ pos: Pc, look: L, fov: ${fov} }); return { pos: Pc, look: L }; })()`;
const setup = { name: 'setup', mode: 'person', x: -6560, z: -1985, heading: 3.6, js: hud, wait: 6000 };
// (waits for the models: the shot's js is awaited)
const ready = { name: 'zoo-ready', wait: 500, js: `(async () => { const t0 = performance.now(); while (performance.now() - t0 < 60000) { const Z = window.CITY.highParkZoo; if (!Z || ['models', 'failed', 'off'].includes(Z.state)) break; await new Promise((r) => setTimeout(r, 250)); } const Z = window.CITY.highParkZoo; return Z ? { state: Z.state, models: Z.models, failed: Z.failed, triangles: Z.triangles, events: Z.events } : null; })()` };
const check = { name: 'zoo-check', record: true, wait: 300, js: `(() => { const Z = window.CITY.highParkZoo, A = window.__CITY_APP, out = {}; A.scene.traverse((o) => { if (o.isInstancedMesh && /^HighParkZoo/.test(o.name)) out[o.name] = { count: o.count, visible: o.visible, tris: (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 }; }); return { zoo: Z ? { mode: Z.mode, state: Z.state, models: Z.models, failed: Z.failed, triangles: Z.triangles, events: Z.events } : null, meshes: out, features: window.CITY.highParkFeatureStats, info: A.renderer.info.render, tier: window.CITY.QUALITY.tier }; })()` };
// (a close view of one animal of each herd, from the build's own instance: three-quarters from its right side, the
// camera 2 + 4x its shoulder height off, at eye height or the animal's; the boxes' mesh when the models are off)
const close = (name, k = 0, side = 1) => `${hud}(() => { ${g} const S = A.scene.getObjectByName('HighParkZooModel_${name}') || A.scene.getObjectByName('HighParkZoo_${name}'); if (!S) return null;
  const m = new S.matrix.constructor(), k = Math.min(${k}, S.count - 1); S.getMatrixAt(k, m); const e = m.elements, x = e[12], y = e[13], z = e[14], fx = e[8], fz = e[10], fl = Math.hypot(fx, fz) || 1;
  S.geometry.computeBoundingBox(); const h = S.geometry.boundingBox.max.y, d = 2 + 4 * Math.min(h, 1.8), rx = -fz / fl * ${side}, rz = fx / fl * ${side};
  const px = x + (rx * 0.8 + fx / fl * 0.6) * d, pz = z + (rz * 0.8 + fz / fl * 0.6) * d; const P = [px, Math.max(g(px, pz) + 1.6, y + h * 0.9), pz], L = [x, y + h * 0.45, z];
  A.cameraSystem.cinema = () => ({ pos: P, look: L, fov: 45 }); return { name: S.name, instance: k, pos: P, look: L }; })()`;
// (the whole enclosure: every herd's centre, from across its long axis, high and low)
const overview = (up, off, fov) => `${hud}(() => { ${g} let sx = 0, sz = 0, n = 0; A.scene.traverse((o) => { if (o.isInstancedMesh && /^HighParkZoo_/.test(o.name)) { const m = new o.matrix.constructor(); for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); sx += m.elements[12]; sz += m.elements[14]; n++; } } });
  const cx = sx / n, cz = sz / n, px = cx + ${PERP_X} * ${off}, pz = cz + ${PERP_Z} * ${off}; const P = [px, g(px, pz) + ${up}, pz], L = [cx, g(cx, cz), cz]; A.cameraSystem.cinema = () => ({ pos: P, look: L, fov: ${fov} }); return { pos: P, look: L }; })()`;
const shots = (times) => [setup, ready, check,
  ...times.flatMap((time) => [...Object.keys(HERDS).map((n) => ({ name: `zoo-${n}${time ? `-${time}` : ''}`, ...(time ? { time } : {}), js: close(n, ...(VIEW[n] || [])), wait: 2500 })),
    { name: `zoo-wide${time ? `-${time}` : ''}`, ...(time ? { time } : {}), js: axisView(30, 40, 50), wait: 3500 },
    { name: `zoo-aerial${time ? `-${time}` : ''}`, ...(time ? { time } : {}), js: overview(140, 40, 60), wait: 3500 }])];
fs.writeFileSync('tools/shots/zoo-animals.json', JSON.stringify(shots(['golden', 'midday']), null, 1) + '\n');
fs.writeFileSync('tools/shots/zoo-seasons.json', JSON.stringify(shots([null]), null, 1) + '\n');
// The approach: the camera comes down on the south paddocks (the mouflon, Barbary sheep, capybaras and emus) from
// 640 m up to 110 m, at 13 m/s, looking steeply down over the trees with a long lens that widens as it nears, so the
// swap at 500 m can be seen; every frame's time logged from the setup on, with the zoo's events (fetch, warm, swap) on
// the same clock
const fly = `${hud}(() => { ${g} const T = [-6372, -1592], O = [T[0] + 60, T[1] - 90], ty = g(T[0], T[1]); let t0 = null;
  window.__zooFrames = []; const tick = (t) => { window.__zooFrames.push(t); if (window.__zooFrames.length < 20000) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  A.cameraSystem.cinema = (e) => { if (t0 === null) t0 = e; const y = ty + Math.max(110, 640 - (e - t0) * 13), x = T[0] + (O[0] - T[0]) * (y - ty) / 640, z = T[1] + (O[1] - T[1]) * (y - ty) / 640, d = Math.hypot(T[0] - x, T[1] - z, ty - y);
    return { pos: [x, y, z], look: [T[0], ty, T[1]], fov: Math.min(40, 2 * Math.atan(32 / d) * 180 / Math.PI) }; };
  return { start: [O[0], ty + 640, O[1]] }; })()`;
const report = { name: 'approach-frames', record: true, wait: 200, js: `(() => { const F = window.__zooFrames || [], Z = window.CITY.highParkZoo; const dt = F.slice(1).map((t, i) => +(t - F[i]).toFixed(1));
  const near = (t, w) => F.map((f, i) => [f, dt[i - 1]]).filter(([f, d]) => d !== undefined && Math.abs(f - t) <= w).map(([f, d]) => [Math.round(f - t), d]);
  const ev = (Z && Z.events) || []; const swap = ev.find((e) => e.what === 'swap'), fetch = ev.find((e) => /^fetch/.test(e.what));
  const sorted = [...dt].sort((a, b) => a - b), pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { frames: F.length, p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: sorted[sorted.length - 1], over50: dt.filter((d) => d > 50).length, over100: dt.filter((d) => d > 100).length,
    events: ev, aroundFetch: fetch ? near(fetch.t, 500) : null, aroundSwap: swap ? near(swap.t, 500) : null, start: F[0], dt }; })()` };
fs.writeFileSync('tools/shots/zoo-approach.json', JSON.stringify([
  { name: 'setup', mode: 'person', x: -6470, z: -2600, heading: 3.1, js: hud, wait: 8000 },
  { name: 'approach', js: fly, wait: 1500, screencastMs: 42000, screencastQuality: 85 },
  report, check
], null, 1) + '\n');
console.log('wrote tools/shots/zoo-animals.json, zoo-seasons.json, zoo-approach.json');

// The cost: boxes and models at the zoo, the same view, alternating in one page (A B A B A B), each window's frame
// times uncapped (CAPTURE_UNCAPPED=1 CAPTURE_METRICS_MS=8000); every arm asserts what it drew
const arm = (boxes) => `(() => { const A = window.__CITY_APP; let b = 0, m = 0; A.scene.traverse((o) => { if (!o.isInstancedMesh) return; if (/^HighParkZoo_/.test(o.name)) { o.visible = ${boxes}; if (o.visible) b += o.count; } else if (/^HighParkZooModel_/.test(o.name)) { o.visible = !${boxes}; if (o.visible) m += o.count; } }); return { arm: '${boxes ? 'boxes' : 'models'}', boxes: b, models: m, state: window.CITY.highParkZoo && window.CITY.highParkZoo.state }; })()`;
const abView = { name: 'ab-view', js: axisView(30, 40, 50), wait: 3000, metricsMs: 0 };
const abShots = [];
for (let i = 1; i <= 3; i++) for (const boxes of [true, false]) abShots.push({ name: `ab-${boxes ? 'boxes' : 'models'}-${i}`, record: true, js: arm(boxes), wait: 1500 });
// (the triangles drawn a frame, sampled over two seconds of frames: a phone's own record can read 0)
const sample = (boxes) => ({ name: `tris-${boxes ? 'boxes' : 'models'}`, record: true, metricsMs: 0, wait: 300, js: `(async () => { const r = ${arm(boxes)}; const A = window.__CITY_APP, s = []; await new Promise((done) => { const t0 = performance.now(); const f = () => { s.push(A.renderer.info.render.triangles); if (performance.now() - t0 < 2000) requestAnimationFrame(f); else done(); }; requestAnimationFrame(f); }); s.sort((a, b) => a - b); return { ...r, trianglesMedian: s[s.length >> 1], samples: s.length }; })()` });
fs.writeFileSync('tools/shots/zoo-ab.json', JSON.stringify([setup, ready, { ...check, metricsMs: 0 }, abView, ...abShots, sample(true), sample(false)].map((s) => (s.name === 'setup' || s.name === 'zoo-ready' ? { ...s, metricsMs: 0 } : s)), null, 1) + '\n');
console.log('wrote tools/shots/zoo-ab.json');
// (the approach without the screencast, for frame times uncapped: CAPTURE_UNCAPPED=1)
const approach = JSON.parse(fs.readFileSync('tools/shots/zoo-approach.json', 'utf8'));
fs.writeFileSync('tools/shots/zoo-approach-timing.json', JSON.stringify(approach.map((s) => (s.name === 'approach' ? { name: s.name, js: s.js, wait: 44000 } : s)), null, 1) + '\n');
console.log('wrote tools/shots/zoo-approach-timing.json');

// The swap close up (run with ?zooNear=15): of every animal's three-quarter view line (as the close views), the one that
// leaves the enclosure's box soonest; the camera walks in along it from 45 m outside the box at 4 m/s, 2.2 m up, so the
// boxes change to the models 15 m out with the animal in view
const walk = `${hud}(() => { ${g} const B = window.CITY.highParkZoo.box; let best = null;
  A.scene.traverse((S) => { if (!S.isInstancedMesh || !/^HighParkZoo_/.test(S.name)) return; const m = new S.matrix.constructor();
    for (let i = 0; i < S.count; i++) { S.getMatrixAt(i, m); const e = m.elements, x = e[12], z = e[14], fl = Math.hypot(e[8], e[10]) || 1, fx = e[8] / fl, fz = e[10] / fl;
      for (const side of [1, -1]) { const dx = -fz * 0.8 * side + fx * 0.6, dz = fx * 0.8 * side + fz * 0.6;
        const tx = dx > 0 ? (B.x1 - x) / dx : (B.x0 - x) / dx, tz = dz > 0 ? (B.z1 - z) / dz : (B.z0 - z) / dz, out = Math.min(tx, tz);
        if (!best || out < best.out) best = { name: S.name, x, z, dx, dz, out }; } } });
  const { x, z, dx, dz, out } = best; let t0 = null;
  window.__zooFrames = []; const tick = (t) => { window.__zooFrames.push(t); if (window.__zooFrames.length < 20000) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  A.cameraSystem.cinema = (el) => { if (t0 === null) t0 = el; const d = Math.max(8, out + 45 - (el - t0) * 4), px = x + dx * d, pz = z + dz * d; return { pos: [px, g(px, pz) + 2.2, pz], look: [x, g(x, z) + 0.6, z], fov: 40 }; };
  return best; })()`;
fs.writeFileSync('tools/shots/zoo-swap-walk.json', JSON.stringify([setup, { name: 'walk', js: walk, wait: 1000, screencastMs: 26000, screencastQuality: 85 }, report, check], null, 1) + '\n');
console.log('wrote tools/shots/zoo-swap-walk.json');
