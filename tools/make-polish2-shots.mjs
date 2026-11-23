// tools/make-polish2-shots.mjs — st-ndw9.18 second round: lane-side frames behind rows whose back wall was cut, the real mosque and temple, a real
// source-keyed sign beside blank boards, the Gothic belfry up close. Reads the cuts from tools/report-building-draw.mjs. usage: node tools/make-polish2-shots.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDraw } from './report-building-draw.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const w = (f, a) => fs.writeFileSync(path.join(ROOT, 'tools/shots', f), JSON.stringify(a, null, 1) + '\n');
const r1 = (v) => Math.round(v * 10) / 10;
const cam = (pos, look, fov = 60) => `(() => { const app = window.__CITY_APP; app.teleportTo(${r1(pos[0])}, ${r1(pos[2])}, 0); app.cameraSystem.cinema = () => ({ pos: [${pos.map(r1).join(', ')}], look: [${look.map(r1).join(', ')}], fov: ${fov} }); })()`;
const shot = (name, pos, look, fov, wait = 4500, time = 'midday') => ({ name, mode: 'person', time, wait, js: cam(pos, look, fov) });

const out = await runDraw({ cells: false });
const done = out.snap.cuts.filter((c) => !out.plans.find((p) => p.id === c.id)?.stats.depthRefused).sort((a, b) => b.cut - a.cut);
const lane = [], seen = new Set();
for (const c of done) {
  const p = out.plans.find((q) => q.id === c.id);
  if (!/row|semi/.test(p.preset) || seen.has(p.groupId) || c.cut < 5) continue;
  seen.add(p.groupId);
  const [ax, az] = p.frame.A, [tx, tz] = p.frame.t, nx = tz, nz = -tx, uc = (p.frame.u0 + p.frame.u1) / 2, zNat = p.frame.z1 + c.cut;
  const at = (u, v) => [ax + tx * u - nx * v, az + tz * u - nz * v];
  const centre = at(uc, p.frame.z1 * 0.5);
  const k = lane.length / 3 + 1;
  lane.push(shot(`lane${k}-eye`, [...at(uc, zNat + 13).slice(0, 1), 1.7, ...at(uc, zNat + 13).slice(1)], [centre[0], 4, centre[1]], 62));
  const a = at(uc, zNat + 8);
  lane.push(shot(`lane${k}-air`, [a[0], 60, a[1]], [centre[0], 0, centre[1]], 55, 6000));
  lane.push({ info: `${p.id} ${p.preset} cut ${c.cut.toFixed(1)} m` });
  if (lane.length >= 12) break;
}
w('house-polish2-lane.json', lane.filter((s) => s.name));
fs.writeFileSync(path.join(ROOT, 'tools/shots/house-polish2-lane.info.txt'), lane.filter((s) => s.info).map((s) => s.info).join('\n') + '\n');
// the real mosque and temple the data has (the named shots of the tall task point at houses): the biggest mosque nave and a Hindu-sized temple nave, street from four sides
const real = [];
for (const [preset, nm] of [['mosque', 'mosque'], ['temple', 'temple']]) {
  const list = out.plans.filter((p) => p.preset === preset && /nave/.test(p.stats.form)).sort((a, b) => b.stats.area - a.stats.area);
  for (const p of list.slice(0, 2)) {
    const k = real.length / 6 + 1 | 0;
    for (const [dx, dz, tag] of [[0, 24, 's'], [0, -24, 'n'], [24, 0, 'e'], [-24, 0, 'w']]) real.push(shot(`${nm}${p.id.slice(-5)}-${tag}`, [p.cx + dx, 1.7, p.cz + dz], [p.cx, 7, p.cz], 62, 4000));
    real.push(shot(`${nm}${p.id.slice(-5)}-air`, [p.cx, 90, p.cz + 40], [p.cx, 6, p.cz], 55, 6000));
    real.push(shot(`${nm}${p.id.slice(-5)}-air2`, [p.cx, 60, p.cz - 30], [p.cx, 6, p.cz], 55, 6000));
  }
}
w('house-polish2-real.json', real);
const tw = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/shots/building-presets-tall-worship.json'), 'utf8'));
w('house-polish2-worship.json', tw.filter((s) => /jami-mosque|ching-kwok|hindu-temple/.test(s.name)));
// real signs beside blank boards (Queen West: two long frontages with several storefronts)
w('house-polish2-signs.json', [
  shot('sign-queen-textiles-street', [-1318, 1.7, -729.4], [-1318, 3.2, -743.3], 70, 5000),
  shot('sign-queen-textiles-near', [-1331, 1.7, -735], [-1331, 3.0, -743.6], 75, 4500),
  shot('sign-affordable-textiles-street', [-1358, 1.7, -736.3], [-1358, 3.2, -722.3], 70, 5000)
]);
// the Gothic belfry up close: the gallery's church-gothic lot, the camera 9 m off its front
const g = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/shots/house-polish-worship-gallery.json'), 'utf8')).find((s) => s.name === 'church-gothic-street');
const m = g.js.match(/pos: \[([-\d.]+), ([\d.]+), ([-\d.]+)\]/), lx = +m[1], lz = +m[3];
w('house-polish2-belfry.json', [...[-9, 0, 9].map((dx, i) => shot(`belfry${i}`, [lx + dx * 0.6, 1.7, lz - 8], [lx + dx, 15, lz - 34], 75, 3500)), shot('belfry-far0', [lx, 5, lz + 14], [lx - 3, 13, lz - 30], 48, 3500), shot('belfry-far1', [lx + 14, 5, lz + 10], [lx - 4, 13, lz - 30], 45, 3500), shot('belfry-far2', [lx - 14, 5, lz + 10], [lx + 2, 13, lz - 30], 45, 3500)]);
console.log(lane.filter((s) => s.name).length, 'lane shots');
