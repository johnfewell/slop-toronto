// tools/make-shop-shots.mjs — st-ndw9.15: cameras for the two main-street shop presets (they have no front frame, so
// tools/make-house-city-shots.mjs skips them). Writes tools/shots/building-presets-houses-shops.json: Queen Street West at Augusta,
// College at Clinton, Roncesvalles at Fermanagh (street level on the road, looking at the nearest drawn shop, and from 150 m), and for each
// shop preset its densest two places, street and air, plus a golden-hour street view. Every camera is outside every building outline.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { partition } from './report-building-forms.mjs';
import { unpackGeo } from '../js/geodata-loader.js';
import { massingRows } from '../js/massing-data.js';
import { runDraw } from './report-building-draw.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const P = await partition();
const { GEO, nearestRoads } = P;
const { MASSING } = await unpackGeo(fs.readFileSync(path.join(ROOT, 'data/toronto-massing.bin')));
const rows = massingRows(MASSING, GEO);
const out = await runDraw({ partitioned: P, cells: false });
const byId = new Map(); for (const f of rows.rows.values()) byId.set(f.id, f);
const polys = [...rows.rows.values()].map((f) => { const r = f.rings[0]; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [x, z] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { r, x0, x1, z0, z1 }; });
const inRing = (r, x, z) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > z) !== (r[j][1] > z) && x < (r[j][0] - r[i][0]) * (z - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; return c; };
const inside = (x, z) => polys.some((p) => x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1 && inRing(p.r, x, z));
const r1 = (v) => Math.round(v * 10) / 10;
const cam = (pos, look, fov = 60) => `(() => { const app = window.__CITY_APP; app.teleportTo(${r1(pos[0])}, ${r1(pos[2])}, 0); app.cameraSystem.cinema = () => ({ pos: [${pos.map(r1).join(', ')}], look: [${look.map(r1).join(', ')}], fov: ${fov} }); })()`;
const centre = (f) => { let sx = 0, sz = 0; for (const [x, z] of f.rings[0]) { sx += x; sz += z; } return [sx / f.rings[0].length, sz / f.rings[0].length]; };
const shops = out.plans.filter((p) => p.preset.startsWith('main-street-shop')).map((p) => ({ ...p, c: centre(byId.get(p.id)) }));
// intersections by road name: the closest points of two named roads
const roads = GEO.roads;
const ptsOf = (name) => roads.filter((r) => r[0] === name).flatMap((r) => { const o = []; for (let i = 0; i + 3 < r[6].length; i += 2) { const [x0, z0, x1, z1] = [r[6][i], r[6][i + 1], r[6][i + 2], r[6][i + 3]], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 4)); for (let k = 0; k <= n; k++) o.push({ x: x0 + (x1 - x0) * k / n, z: z0 + (z1 - z0) * k / n }); } return o; });
function crossing(a, b) {
  const A = ptsOf(a), B = ptsOf(b); let best = null;
  for (const p of A) for (const q of B) { const d = Math.hypot(p.x - q.x, p.z - q.z); if (!best || d < best.d) best = { d, x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 }; }
  return best;
}
const shots = [], golden = [], places = {};
const viewsFor = (name, shop, time = 'midday') => {
  const [sx, sz] = shop.c, rd = nearestRoads(sx, sz, 80)[0];
  const res = [];
  if (rd) {
    const dx = rd.px - sx, dz = rd.pz - sz, L = Math.hypot(dx, dz) || 1;
    // on the road, 9 m further out than the road's centre, looking back at the shop; try a few distances until it is outside
    for (const k of [0, 6, 10, 14]) {
      const p = [rd.px + dx / L * k, rd.pz + dz / L * k];
      if (!inside(p[0], p[1])) { res.push({ name: `${name}-street`, mode: 'person', time, wait: 3500, js: cam([p[0], 1.7, p[1]], [sx, 6, sz], 65) }); break; }
    }
    const a = [rd.px + dx / L * 60, rd.pz + dz / L * 60];
    res.push({ name: `${name}-air`, mode: 'person', time, wait: 4500, js: cam([a[0], 150, a[1]], [sx, 0, sz]) });
  }
  return res;
};
for (const [name, a, b] of [['queen-augusta', 'Queen Street West', 'Augusta Avenue'], ['college-clinton', 'College Street', 'Clinton Street'], ['roncesvalles-fermanagh', 'Roncesvalles Avenue', 'Fermanagh Avenue']]) {
  const c = crossing(a, b);
  if (!c || c.d > 40) { console.log('no crossing', name, c && c.d); continue; }
  const near = shops.filter((s) => Math.hypot(s.c[0] - c.x, s.c[1] - c.z) < 90).sort((p, q) => Math.hypot(p.c[0] - c.x, p.c[1] - c.z) - Math.hypot(q.c[0] - c.x, q.c[1] - c.z));
  places[name] = { crossing: [r1(c.x), r1(c.z)], gap: r1(c.d), shopsWithin90m: near.length };
  if (near[0]) { shots.push(...viewsFor(`shops-${name}`, near[0])); places[name].shop = near[0].id; }
}
for (const preset of ['main-street-shop-early', 'main-street-shop-later']) {
  const list = shops.filter((s) => s.preset === preset), cells = new Map();
  for (const s of list) { const k = `${Math.floor(s.c[0] / 150)},${Math.floor(s.c[1] / 150)}`; (cells.get(k) || cells.set(k, []).get(k)).push(s); }
  const chosen = [];
  for (const c of [...cells.values()].sort((p, q) => q.length - p.length)) {
    const mx = c.reduce((s, p) => s + p.c[0], 0) / c.length, mz = c.reduce((s, p) => s + p.c[1], 0) / c.length;
    if (chosen.every((o) => Math.hypot(mx - o.mx, mz - o.mz) > 1500)) chosen.push({ mx, mz, shop: [...c].sort((p, q) => Math.hypot(p.c[0] - mx, p.c[1] - mz) - Math.hypot(q.c[0] - mx, q.c[1] - mz))[0], n: c.length });
    if (chosen.length === 2) break;
  }
  places[preset] = chosen.map((c) => ({ id: c.shop.id, x: r1(c.shop.c[0]), z: r1(c.shop.c[1]), shops: c.n }));
  chosen.forEach((c, i) => { shots.push(...viewsFor(`${preset}-p${i + 1}`, c.shop)); if (i === 0) golden.push(...viewsFor(`${preset}-p1g`, c.shop, 'golden').slice(0, 1)); });
}
const w = (f, a) => fs.writeFileSync(path.join(ROOT, 'tools/shots', f), JSON.stringify(a, null, 1) + '\n');
w('building-presets-houses-shops.json', shots); w('building-presets-houses-shops-golden.json', golden);
fs.writeFileSync(path.join(ROOT, 'docs/building-presets-houses-shop-places.json'), JSON.stringify(places, null, 1) + '\n');
console.log(shots.length, golden.length, JSON.stringify(places).slice(0, 600));
