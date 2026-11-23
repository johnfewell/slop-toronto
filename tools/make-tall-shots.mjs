// tools/make-tall-shots.mjs — st-ndw9.20: writes the capture shot lists for the apartment, tower, office, low-block and worship presets:
// the gallery rows (building-presets-tall-gallery.json, from the same layout the page builds) and the named places in the city
// (building-presets-tall-city.json, -golden, -phone). A street camera is searched for round the place: outside every building, within
// 12 m of a road; a far camera (150 m, 300 m for the Financial District) outside every building. usage: node tools/make-tall-shots.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { partition } from './report-building-forms.mjs';
import { unpackGeo } from '../js/geodata-loader.js';
import { massingRows } from '../js/massing-data.js';
import { PROTOTYPES } from '../js/building-prototypes.js';
import { DRAWN_PRESETS, syntheticLot } from '../js/building-draw.js';
import * as G from '../js/building-gallery.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const r1 = (v) => Math.round(v * 10) / 10;
const cam = (pos, look, fov = 60) => `(() => { const app = window.__CITY_APP; app.teleportTo(${r1(pos[0])}, ${r1(pos[2])}, 0); app.cameraSystem.cinema = () => ({ pos: [${pos.map(r1).join(', ')}], look: [${look.map(r1).join(', ')}], fov: ${fov} }); })()`;
const w = (f, a) => fs.writeFileSync(path.join(ROOT, 'tools/shots', f), JSON.stringify(a, null, 1) + '\n');

// ---- the gallery rows of this task's presets
const MINE = new Set(['walk-up-apartment', 'mid-rise-block', 'slab-tower', 'glass-tower-podium', 'dark-curtain-wall-tower', 'contemporary-glass', 'tower', 'low-masonry-block', 'plain-low-block',
  'church-gothic', 'church-chapel', 'church-modern', 'mosque', 'synagogue', 'temple']);
const layout = G.galleryLayout(PROTOTYPES.map((p) => p.id), {}, new Set(DRAWN_PRESETS), G.makeGalleryLot(syntheticLot));
const gallery = [];
for (const row of layout.rows.filter((r) => MINE.has(r.preset))) {
  const lots = layout.lots.filter((l) => l.preset === row.preset && !/:(podium|tower)$/.test(l.foot.id));
  const tall = row.h > 30, church = row.preset.startsWith('church') || ['mosque', 'synagogue', 'temple'].includes(row.preset);
  const L = (i) => lots[i];
  const d1 = church ? 16 : tall ? 20 : 15;
  const a = L(1), b = L(3), c = L(4);
  // street: from the gap in front of lot 1 and lot 3 (the far lots stand behind the previous row's lots, which are as tall as these)
  gallery.push({ name: `${row.preset}-street`, mode: 'person', time: 'midday', wait: 3500, js: cam([a.x, 1.7, r1(row.front + d1)], [a.x, tall ? row.h * 0.45 : 4.5, r1(row.front - row.d / 2)], tall ? 75 : 62) });
  gallery.push({ name: `${row.preset}-street2`, mode: 'person', time: 'midday', wait: 3000, js: cam([r1(b.x + (church ? 10 : 16)), 1.7, r1(row.front + d1 - 3)], [r1(b.x - 4), tall ? row.h * 0.4 : 5, r1(row.front - row.d / 2)], tall ? 78 : 68) });
  gallery.push({ name: `${row.preset}-air`, mode: 'person', time: 'midday', wait: 3500, js: cam([c.x, tall ? row.h * 1.1 + 25 : 40, r1(row.front + (tall ? 70 : 34))], [c.x, tall ? row.h * 0.3 : 0, r1(row.front - row.d * 0.5)], 62) });
  gallery.push({ name: `${row.preset}-corner`, mode: 'person', time: 'midday', wait: 3000, js: cam([r1(a.x + a.w / 2 + (church ? 12 : 22)), 1.7, r1(row.front - row.d / 2 + 24)], [a.x, tall ? row.h * 0.4 : 5, r1(row.front - row.d / 2)], tall ? 78 : 66) });
}
for (const row of layout.rows.filter((r) => MINE.has(r.preset) && (r.preset.startsWith('church') || ['mosque', 'synagogue', 'temple'].includes(r.preset)))) {
  const lots = layout.lots.filter((l) => l.preset === row.preset && !/:(podium|tower)$/.test(l.foot.id)), a = lots[0];
  gallery.push({ name: `${row.preset}-side`, mode: 'person', time: 'midday', wait: 3000, js: cam([r1(a.x + a.w / 2 + 14), 2.0, r1(row.front - row.d * 0.2)], [r1(a.x), 6, r1(row.front - row.d * 0.5)], 70) });
}
w('building-presets-tall-gallery.json', gallery);
w('building-presets-tall-gallery-worship.json', gallery.filter((g) => /^church|^mosque|^synagogue|^temple/.test(g.name)));

// ---- the places in the city
const P = await partition();
const { GEO, nearestRoads } = P;
const { MASSING } = await unpackGeo(fs.readFileSync(path.join(ROOT, 'data/toronto-massing.bin')));
const rows = massingRows(MASSING, GEO);
const polys = [...rows.rows.entries()].map(([bi, f]) => {
  const r = f.rings[0]; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const [x, z] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return { r, x0, x1, z0, z1, h: GEO.buildings[bi][4] };
});
const inRing = (r, x, z) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > z) !== (r[j][1] > z) && x < (r[j][0] - r[i][0]) * (z - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; return c; };
const inside = (x, z, y) => polys.some((p) => x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1 && p.h > y - 1 && inRing(p.r, x, z));
const roadNear = (x, z) => { const r = nearestRoads(x, z, 40)[0]; return r ? r.dist : Infinity; };

// Each place: name, x, z of the building group, the height to look at, and its cameras: { kind: 'ground' | 'far' | 'high', dist (m of ground
// distance), y (camera height), pref (preferred direction in radians: 0 east, pi / 2 south, pi west, -pi / 2 north) }. A camera is kept only if
//   (1) no building taller than the camera stands within 20 m of it, and it is not inside one;
//   (2) a ray from it to the target meets no building that is nearer than the target's own group (the last 25 m are the target's);
// the candidates are tried from the preferred direction round, at the distance and then 0.8, 1.25 and 1.6 times it. `ground` and `far`
// cameras look horizontally at the target's middle; `high` ones look down at it (at 45 degrees when the distance equals the height).
const S = Math.PI / 2;
const PLACES = [
  ['stjames-town', 1333, -2405, 30, [{ kind: 'ground', dist: 45, y: 1.7, pref: 0 }, { kind: 'ground', dist: 60, y: 1.7, pref: S }, { kind: 'far', dist: 600, y: 30, pref: 0 }, { kind: 'far', dist: 450, y: 25, pref: 0.5 }]],
  ['fd', 60, -420, 130, [{ kind: 'far', dist: 900, y: 35, pref: S }, { kind: 'high', dist: 400, y: 400, pref: S }, { kind: 'ground', dist: 80, y: 1.7, pref: S }]],
  ['cityplace', -1370, 172, 40, [{ kind: 'far', dist: 600, y: 25, pref: S }, { kind: 'ground', dist: 60, y: 1.7, pref: S }]],
  ['annex-walkup', -1212, -2982, 8, [{ kind: 'ground', dist: 28, y: 1.7, pref: S }, { kind: 'high', dist: 120, y: 120, pref: S }]],
  ['parkdale-walkup', -4836, -779, 7, [{ kind: 'ground', dist: 28, y: 1.7, pref: S }, { kind: 'high', dist: 120, y: 120, pref: S }]],
  ['annex-midrise', -735, -2974, 20, [{ kind: 'ground', dist: 45, y: 1.7, pref: S }, { kind: 'high', dist: 150, y: 150, pref: S }]],
  ['contemporary', -1053, -105, 18, [{ kind: 'ground', dist: 45, y: 1.7, pref: S }, { kind: 'high', dist: 150, y: 150, pref: S }]],
  ['stjames-cathedral', 676, -406, 25, [{ kind: 'ground', dist: 70, y: 6, pref: S }, { kind: 'ground', dist: 35, y: 1.7, pref: S }, { kind: 'high', dist: 150, y: 150, pref: S }]],
  ['stmichaels', 575, -952, 28, [{ kind: 'ground', dist: 60, y: 4, pref: S }, { kind: 'high', dist: 150, y: 150, pref: S }]],
  ['metropolitan-united', 575, -828, 22, [{ kind: 'ground', dist: 60, y: 4, pref: S }, { kind: 'high', dist: 150, y: 150, pref: S }]],
  ['knox-spadina', -1142, -2343, 14, [{ kind: 'ground', dist: 50, y: 3, pref: S }, { kind: 'high', dist: 150, y: 150, pref: S }]],
  ['kiever', -1458, -1421, 8, [{ kind: 'ground', dist: 28, y: 1.7, pref: S }, { kind: 'high', dist: 120, y: 120, pref: S }]],
  ['anshei-minsk', -1172, -1409, 8, [{ kind: 'ground', dist: 28, y: 1.7, pref: S }, { kind: 'high', dist: 120, y: 120, pref: S }]],
  ['jami-mosque', -5458, -2562, 10, [{ kind: 'ground', dist: 40, y: 2, pref: S }, { kind: 'high', dist: 120, y: 120, pref: S }]],
  ['ching-kwok', -1771, -1167, 9, [{ kind: 'ground', dist: 32, y: 1.7, pref: S }, { kind: 'high', dist: 120, y: 120, pref: S }]],
  ['hindu-temple', -4791, -1494, 9, [{ kind: 'ground', dist: 32, y: 1.7, pref: S }, { kind: 'high', dist: 120, y: 120, pref: S }]],
  ['chapel', -897, -2871, 8, [{ kind: 'ground', dist: 30, y: 1.7, pref: S }, { kind: 'high', dist: 120, y: 120, pref: S }]],
  ['modern-church', 30, -2441, 10, [{ kind: 'ground', dist: 35, y: 1.7, pref: S }, { kind: 'high', dist: 120, y: 120, pref: S }]]
];
const nearBuildings = (x, z, r) => polys.filter((p) => x >= p.x0 - r && x <= p.x1 + r && z >= p.z0 - r && z <= p.z1 + r);
function camOk(pos, tx, tz, ty, ground) {
  for (const p of nearBuildings(pos[0], pos[2], ground ? 0 : 20)) {
    if (p.h <= pos[1] - 1) continue;
    if (inRing(p.r, pos[0], pos[2])) return false;
    if (ground) continue; // (a street camera is in a street: only 'not inside a building' and the ray)
    // within 20 m: any vertex or edge point close
    for (let i = 0; i < p.r.length; i++) { const a = p.r[i], b = p.r[(i + 1) % p.r.length]; for (let k = 0; k <= 4; k++) { const x = a[0] + (b[0] - a[0]) * k / 4, z = a[1] + (b[1] - a[1]) * k / 4; if (Math.hypot(x - pos[0], z - pos[2]) < 20) return false; } }
  }
  const len = Math.hypot(tx - pos[0], tz - pos[2]), dy = ty - pos[1], n = Math.ceil(Math.hypot(len, dy) / 3);
  for (let i = 1; i < n; i++) {
    const t = i / n, x = pos[0] + (tx - pos[0]) * t, z = pos[2] + (tz - pos[2]) * t, y = pos[1] + dy * t;
    if (Math.hypot(x - tx, z - tz) < 25) break; // (the last 25 m are the target's own)
    for (const p of nearBuildings(x, z, 0)) if (p.h > y && inRing(p.r, x, z)) return false;
  }
  return true;
}
function place([name, x, z, ly, cams], time = 'midday') {
  const out = [];
  cams.forEach((c, ci) => {
    let found = null;
    for (const yf of c.kind === 'far' ? [1, 2, 3.5] : [1]) for (const f of [1, 0.8, 1.25, 1.6]) {
      if (found) break;
      for (let k = 0; k < 24 && !found; k++) {
        const a = c.pref + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 12), d = c.dist * f;
        const pos = [x + Math.cos(a) * d, c.y * yf, z + Math.sin(a) * d];
        if (camOk(pos, x, z, ly, c.kind === 'ground')) found = { pos, a, d };
      }
    }
    if (!found) { console.warn('no camera for', name, c.kind, c.dist); return; }
    const look = c.kind === 'high' ? [x, 0, z] : [x, ly * (c.kind === 'far' ? 0.6 : 0.5), z];
    const fov = c.kind === 'far' ? 42 : c.kind === 'high' ? 55 : ly > 20 ? 72 : 62;
    out.push({ name: `${name}-${c.kind}${ci}`, mode: 'person', time, wait: c.kind === 'ground' ? 4500 : 6000, js: cam(found.pos, look, fov) });
  });
  return out;
}
const city = PLACES.flatMap((p) => place(p)), golden = PLACES.flatMap((p) => place(p, 'golden'));
w('building-presets-tall-city.json', city);
w('building-presets-tall-golden.json', golden);
const WORSHIP = /^(stjames-cathedral|stmichaels|metropolitan-united|knox-spadina|kiever|anshei-minsk|jami-mosque|ching-kwok|hindu-temple|chapel|modern-church)-/;
w('building-presets-tall-worship.json', city.filter((s) => WORSHIP.test(s.name)));
w('building-presets-tall-phone.json', city.filter((s) => /^(stjames-town-ground0|cityplace-ground1|stjames-cathedral-ground1)$/.test(s.name)));
console.log(gallery.length, 'gallery shots', city.length, 'city shots', golden.length, 'golden');
