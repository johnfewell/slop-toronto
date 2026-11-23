// tools/make-house-city-shots.mjs — st-ndw9.15: writes tools/shots/building-presets-houses-city.json (and -golden, -parta): cameras
// in the city for every house and shop preset that is drawn. Per preset the two places with the most drawn houses (1.5 km apart
// at least): from the street in front of a house, and from 150 m up; a third shot at golden hour; and the named Part A places
// (Cabbagetown, Kensington Market, North Riverdale) from the street, from the lane behind and from 150 m. Every camera is checked
// against every building outline (outside) and the street cameras to be within 14 m of a road.
// usage: node tools/make-house-city-shots.mjs
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
const byId = new Map();
for (const foot of rows.rows.values()) byId.set(foot.id, foot);
const polys = [...rows.rows.entries()].map(([bi, f]) => { const r = f.rings[0]; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [x, z] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { r, x0, x1, z0, z1, h: GEO.buildings[bi][4] }; });
const inRing = (r, x, z) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > z) !== (r[j][1] > z) && x < (r[j][0] - r[i][0]) * (z - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; return c; };
const inside = (x, z, y) => polys.some((p) => x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1 && p.h > y - 1 && inRing(p.r, x, z));
const roadNear = (x, z) => { const r = nearestRoads(x, z, 40)[0]; return r ? r.dist : Infinity; };
const r1 = (v) => Math.round(v * 10) / 10;

const plansOf = new Map();
for (const pl of out.plans) { if (!pl.frame) continue; (plansOf.get(pl.preset) || plansOf.set(pl.preset, []).get(pl.preset)).push(pl); }
const geom = (pl) => {
  const f = pl.frame, t = f.t, n = [t[1], -t[0]], uc = (f.u0 + f.u1) / 2;
  const C = [f.A[0] + t[0] * uc, f.A[1] + t[1] * uc];
  return { C, n, d: f.z1, centre: [C[0] - n[0] * f.z1 / 2, C[1] - n[1] * f.z1 / 2] };
};
const cam = (pos, look, fov = 60) => `(() => { const app = window.__CITY_APP; app.teleportTo(${r1(pos[0])}, ${r1(pos[2])}, 0); app.cameraSystem.cinema = () => ({ pos: [${pos.map(r1).join(', ')}], look: [${look.map(r1).join(', ')}], fov: ${fov} }); })()`;
// the three views of one house: from the street across (about 14 m from the front), from the lane behind, from 150 m
function views(pl, name, time = 'midday') {
  const g = geom(pl), res = {};
  for (const dist of [14, 10, 18, 22, 8]) {
    const p = [g.C[0] + g.n[0] * dist, g.C[1] + g.n[1] * dist];
    if (!inside(p[0], p[1], 2) && roadNear(p[0], p[1]) < 14) { res.street = { name: `${name}-street`, mode: 'person', time, wait: 3500, js: cam([p[0], 1.7, p[1]], [g.centre[0], 4.5, g.centre[1]]) }; break; }
  }
  for (const dist of [10, 14, 7, 18]) {
    const p = [g.C[0] - g.n[0] * (g.d + dist), g.C[1] - g.n[1] * (g.d + dist)];
    if (!inside(p[0], p[1], 3)) { res.lane = { name: `${name}-lane`, mode: 'person', time, wait: 3500, js: cam([p[0], 2.6, p[1]], [g.centre[0], 4.5, g.centre[1]]) }; break; }
  }
  const a = [g.C[0] + g.n[0] * 90, g.C[1] + g.n[1] * 90];
  if (!inside(a[0], a[1], 150)) res.air = { name: `${name}-air`, mode: 'person', time, wait: 4500, js: cam([a[0], 150, a[1]], [g.centre[0], 0, g.centre[1]]) };
  return res;
}
const near = (pl, x, z) => { const g = geom(pl); return Math.hypot(g.centre[0] - x, g.centre[1] - z); };
const shots = [], golden = [], parta = [], places = {};
for (const [preset, list] of plansOf) {
  // the densest 150 m cells
  const cells = new Map();
  for (const pl of list) { const g = geom(pl), k = `${Math.floor(g.centre[0] / 150)},${Math.floor(g.centre[1] / 150)}`; (cells.get(k) || cells.set(k, []).get(k)).push(pl); }
  const ranked = [...cells.values()].sort((a, b) => b.length - a.length);
  const chosen = [];
  for (const c of ranked) {
    const cg = geom(c[0]).centre;
    if (chosen.every((o) => Math.hypot(cg[0] - o.cg[0], cg[1] - o.cg[1]) > 1500)) {
      // the house nearest the cell's mean position
      const mx = c.reduce((s, p) => s + geom(p).centre[0], 0) / c.length, mz = c.reduce((s, p) => s + geom(p).centre[1], 0) / c.length;
      const pl = [...c].sort((a, b) => near(a, mx, mz) - near(b, mx, mz)).find((p) => views(p, 'x').street && views(p, 'x').air);
      if (pl) chosen.push({ cg, pl, n: c.length });
    }
    if (chosen.length === 2) break;
  }
  places[preset] = chosen.map((c, i) => ({ id: c.pl.id, x: r1(geom(c.pl).centre[0]), z: r1(geom(c.pl).centre[1]), houses: c.n }));
  chosen.forEach((c, i) => {
    const v = views(c.pl, `${preset}-p${i + 1}`);
    for (const k of ['street', 'lane', 'air']) if (v[k]) shots.push(v[k]);
    if (i === 0) { const gv = views(c.pl, `${preset}-p1g`, 'golden'); if (gv.street) golden.push(gv.street); if (gv.air) golden.push(gv.air); }
  });
}
// Part A: the named places
const NAMED = [['cabbagetown', 1785, -1868, ['victorian-semi', 'victorian-row']], ['kensington', -1252, -1290, ['victorian-row', 'victorian-semi']], ['riverdale', 3100, -2700, ['edwardian-detached']]];
for (const [name, x, z, presets] of NAMED) {
  for (const preset of presets) {
    const list = (plansOf.get(preset) || []).filter((p) => near(p, x, z) < 600).sort((a, b) => near(a, x, z) - near(b, x, z));
    const pl = list.find((p) => { const v = views(p, 'x'); return v.street && v.lane && v.air; });
    if (!pl) continue;
    places[`${name}:${preset}`] = { id: pl.id, x: r1(geom(pl).centre[0]), z: r1(geom(pl).centre[1]) };
    const v = views(pl, `${name}-${preset}`);
    for (const k of ['street', 'lane', 'air']) parta.push(v[k]);
  }
}
const w = (f, a) => fs.writeFileSync(path.join(ROOT, 'tools/shots', f), JSON.stringify(a, null, 1) + '\n');
w('building-presets-houses-phone.json', shots.filter((x) => /-p1-street$/.test(x.name)));
w('building-presets-houses-city.json', shots); w('building-presets-houses-golden.json', golden); w('building-presets-houses-parta.json', parta);
fs.writeFileSync(path.join(ROOT, 'docs/building-presets-houses-places.json'), JSON.stringify(places, null, 1) + '\n');
console.log(shots.length, golden.length, parta.length);
