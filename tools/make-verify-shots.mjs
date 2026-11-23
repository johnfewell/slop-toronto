// tools/make-verify-shots.mjs — st-ndw9.24: capture lists for checking the house polish on the real city: houses at 10 to 15 m from a front with no street
// tree in the way, the real modern churches from their door end, the five real mosques (door side first, from the plan), signs. Reads the plans from
// tools/report-building-draw.mjs. usage: node tools/make-verify-shots.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDraw } from './report-building-draw.mjs';
import { partition } from './report-building-forms.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const w = (f, a) => fs.writeFileSync(path.join(ROOT, 'tools/shots', f), JSON.stringify(a, null, 1) + '\n');
const r1 = (v) => Math.round(v * 10) / 10;
const cam = (pos, look, fov = 60) => `(() => { const app = window.__CITY_APP; app.teleportTo(${r1(pos[0])}, ${r1(pos[2])}, 0); app.cameraSystem.cinema = () => ({ pos: [${pos.map(r1).join(', ')}], look: [${look.map(r1).join(', ')}], fov: ${fov} }); })()`;
const shot = (name, pos, look, fov, wait = 4500, time = 'midday') => ({ name, mode: 'person', time, wait, js: cam(pos, look, fov) });

const P = await partition();
const out = await runDraw({ cells: false, partitioned: P });
const T = P.GEO.streetTrees; // x, z, model, seed
const nearestTree = (ax, az, bx, bz) => { // the distance from the segment a-b to the nearest street tree
  let best = Infinity;
  const x0 = Math.min(ax, bx) - 8, x1 = Math.max(ax, bx) + 8, z0 = Math.min(az, bz) - 8, z1 = Math.max(az, bz) + 8;
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
  for (let i = 0; i < T.length; i += 4) {
    const x = T[i], z = T[i + 1];
    if (x < x0 || x > x1 || z < z0 || z > z1) continue;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  }
  return best;
};

// houses: for each of three presets, the first houses whose street view (12 m out, eye height, straight on and 35 degrees along) has no tree within 3 m
const houses = [], info = [];
for (const preset of ['edwardian-semi', 'victorian-semi', 'interwar-detached', 'edwardian-detached', 'victorian-row']) {
  const list = out.plans.filter((p) => p.preset === preset && p.frame && p.frame.u1 - p.frame.u0 >= 5.5 && p.frame.u1 - p.frame.u0 <= 11 && p.stats.sills > 0);
  let n = 0;
  for (const p of list) {
    const f = p.frame, [ax, az] = f.A, [tx, tz] = f.t, nx = tz, nz = -tx, uc = (f.u0 + f.u1) / 2;
    const at = (u, d) => [ax + tx * u + nx * d, az + tz * u + nz * d]; // d metres out in front of the front line
    const face = at(uc, 0), c0 = at(uc, 12), c1 = at(uc - 8, 10);
    if (nearestTree(c0[0], c0[1], face[0], face[1]) < 3.2 || nearestTree(c1[0], c1[1], face[0], face[1]) < 3.2) continue;
    if (n >= 2) break;
    n++;
    houses.push(shot(`${preset}-${p.id.slice(-5)}-12m`, [c0[0], 1.7, c0[1]], [face[0], 2.6, face[1]], 62, 4000));
    houses.push(shot(`${preset}-${p.id.slice(-5)}-10m-side`, [c1[0], 1.7, c1[1]], [face[0], 2.8, face[1]], 62, 4000));
    info.push(`${p.id} ${preset} width ${(f.u1 - f.u0).toFixed(1)} sills ${p.stats.sills} lintels ${p.stats.lintels} columns ${p.stats.columns}`);
  }
}
w('ndw9-verify-houses.json', houses);

// the real modern churches: the door end of the nave from 24 m, eye height; and the air frame the ship run used (to compare)
const modern = [];
for (const p of out.plans.filter((q) => q.preset === 'church-modern' && /nave/.test(q.stats.form) && q.stats.door)) {
  const [dx, dz] = p.stats.door, [ox, oz] = p.stats.out;
  modern.push(shot(`modern${p.id.slice(-6)}-${p.roofForm}-door`, [dx + ox * 24, 1.7, dz + oz * 24], [dx, 6, dz], 65, 4000));
  modern.push(shot(`modern${p.id.slice(-6)}-${p.roofForm}-air`, [dx + ox * 45, 40, dz + oz * 45], [p.cx, 6, p.cz], 55, 5000));
  info.push(`modern ${p.id} ${p.roofForm} fill ${p.stats.fill.toFixed(2)} h ${p.h}`);
}
w('ndw9-verify-modern.json', modern);

// the five real mosques: the nave's door end (the plan's), from the street side, and from the air over that side
const mosques = [];
for (const p of out.plans.filter((q) => /nave/.test(q.stats.form || '') && (q.preset === 'mosque' || q.stats.religion === 'muslim'))) {
  const [dx, dz] = p.stats.door, [ox, oz] = p.stats.out, d = Math.max(24, p.stats.tw * 0.7);
  mosques.push(shot(`mosque${p.id.slice(-5)}-door`, [dx + ox * d, 1.7, dz + oz * d], [dx, 5, dz], 65, 4000));
  mosques.push(shot(`mosque${p.id.slice(-5)}-air`, [dx + ox * (d + 20), 60, dz + oz * (d + 20)], [p.cx, 6, p.cz], 55, 5000));
  info.push(`mosque ${p.id} ${p.stats.name || ''} door ${dx.toFixed(1)},${dz.toFixed(1)} out ${ox.toFixed(2)},${oz.toFixed(2)} domes ${p.stats.domes} portals ${p.stats.portals}`);
}
w('ndw9-verify-mosques.json', mosques);

// signs: Queen West at Augusta from the street and close, and from 45 degrees
w('ndw9-verify-signs.json', [
  shot('qw-augusta-street', [-1386.6, 1.7, -713.6], [-1370.6, 6, -713.3], 65, 5000),
  shot('qw-augusta-close', [-1380, 1.7, -709], [-1370.6, 4, -714.5], 65, 4000),
  shot('qw-augusta-air', [-1446.6, 90, -714.4], [-1370.6, 0, -713.3], 55, 5000)
]);
fs.writeFileSync(path.join(ROOT, 'tools/shots/ndw9-verify.info.txt'), info.join('\n') + '\n');
console.log(houses.length, 'house', modern.length, 'modern', mosques.length, 'mosque shots');
