// Part 8: the City of Toronto's street trees (Street Tree Data, Open Government Licence – Toronto): every tree in the
// detailed city where it stands, as one of John's EZ-Tree models (js/ez-trees.js: assets/trees, from ride-anywhere's
// tools/assets/ez-tree-kit.mjs) picked by its genus's crown form and its trunk size, and as tall as its trunk says.
// GEO.streetTrees: flat [x, z, model index, height dm, ...] with TREE_MODELS below. The trees the inventory piles on one
// address point are spread along that address's frontage, or left out where it holds no more (tools/geo-tree-piles.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { toWorld, log } from './geo-base.mjs';
import { inDetail, roadLines } from './geo-roads.mjs';
import { fields } from './geo-props.mjs';
import { blocks, blockRaster, blockLabels } from './geo-blocks.mjs';
import { buildings } from './geo-features.mjs';
import { isWater } from './geo-land.mjs';
import { spreadPiles } from './geo-tree-piles.mjs';

const RAW = process.env.PROPS_DATA || path.join(process.env.HOME, '.cache/slop-toronto/raw');
// the EZ-Tree models (id, its baked height m); js/ez-trees.js loads assets/trees/<id>.glb in this order
export const TREE_MODELS = [
  ['ez-oak-small', 7], ['ez-oak-medium', 12], ['ez-oak-large', 18],
  ['ez-ash-small', 7], ['ez-ash-medium', 12], ['ez-ash-large', 18],
  ['ez-aspen-medium', 13], ['ez-aspen-large', 19],
  ['ez-pine-small-a', 8], ['ez-pine-medium-a', 13], ['ez-pine-large-a', 20]
];
const M = Object.fromEntries(TREE_MODELS.map(([id], i) => [id, i]));
// crown form by genus (the common name's first word, as the City writes it: "Maple, Norway")
const FORM = {
  broad: /^(maple|oak|linden|basswood|horsechestnut|horse|chestnut|planetree|plane|london|sycamore|tulip|mulberry|catalpa|walnut|beech|katsura|coffeetree|kentucky|hickory|buckeye|tree-of-heaven|ailanthus)/i,
  vase: /^(elm|hackberry|ash|locust|honey|honeylocust|ginkgo|zelkova|amur|cork|hornbeam|ironwood|alder|hop|larch)/i,
  column: /^(birch|poplar|aspen|willow|cottonwood|serviceberry)/i,
  conifer: /^(spruce|pine|cedar|fir|hemlock|juniper|yew|cypress|arborvitae|douglas)/i,
  small: /^(lilac|pear|cherry|apple|crab|crabapple|redbud|magnolia|hawthorn|dogwood|plum|lilac|smoketree|sumac|peach)/i
};
const formOf = (name) => {
  for (const [form, re] of Object.entries(FORM)) if (re.test(name)) return form;
  return 'broad';
};
function modelFor(form, dbh, r) {
  const size = dbh < 18 ? 0 : dbh < 45 ? 1 : 2;
  switch (form) {
    case 'conifer': return [M['ez-pine-small-a'], M['ez-pine-medium-a'], M['ez-pine-large-a']][size];
    case 'vase': return [M['ez-ash-small'], M['ez-ash-medium'], M['ez-ash-large']][size];
    case 'column': return size === 2 ? M['ez-aspen-large'] : M['ez-aspen-medium'];
    case 'small': return r < 0.5 ? M['ez-oak-small'] : M['ez-ash-small'];
    default: return [M['ez-oak-small'], M['ez-oak-medium'], M['ez-oak-large']][size];
  }
}
// height from trunk diameter at breast height (cm): about 4 m + 0.28 m per cm, small ornamentals lower
const heightOf = (form, dbh) => Math.max(3, Math.min(form === 'small' ? 9 : 26, (form === 'small' ? 2.5 : 4) + dbh * (form === 'small' ? 0.18 : 0.28)));

export const streetTrees = [];
export let treePiles = null; // what spreadPiles did (its stats)
// the island (curb) raster, the buildings and the streets' names, for the piles' frontage
const city = (() => {
  const R = blockRaster, byLab = new Map(blocks.map((b) => [b._lab, b]));
  const labelAt = (x, z) => {
    const i = Math.floor((x - R.x0) / R.res), j = Math.floor((z - R.z0) / R.res);
    return i < 0 || j < 0 || i >= R.w || j >= R.h ? 0 : blockLabels[j * R.w + i];
  };
  // (each building in every 50 m cell its plan, 2 m out, covers; its plan rects in its own frame, as
  // tools/build-geodata.mjs buildingAt)
  const BC = 50, bGrid = new Map(), cellKey = (i, j) => i * 100000 + j;
  buildings.forEach(([cx, cz, ang, parts], n) => {
    const cs = Math.cos(ang), sn = Math.sin(ang);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [u0, u1, v0, v1] of parts) for (const u of [u0, u1]) for (const v of [v0, v1]) {
      const x = cx + u * cs + v * sn, z = cz - u * sn + v * cs;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    for (let i = Math.floor((x0 - 2) / BC); i <= Math.floor((x1 + 2) / BC); i++) for (let j = Math.floor((z0 - 2) / BC); j <= Math.floor((z1 + 2) / BC); j++) {
      const k = cellKey(i, j);
      (bGrid.get(k) || bGrid.set(k, []).get(k)).push(n);
    }
  });
  const buildingNear = (x, z, r) => { // (r up to 2 m)
    for (const i of bGrid.get(cellKey(Math.floor(x / BC), Math.floor(z / BC))) || []) {
      const [cx, cz, ang, parts] = buildings[i];
      const cs = Math.cos(ang), sn = Math.sin(ang), dx = x - cx, dz = z - cz, u = dx * cs - dz * sn, v = dx * sn + dz * cs;
      for (const [u0, u1, v0, v1] of parts) if (Math.hypot(Math.max(u0 - u, 0, u - u1), Math.max(v0 - v, 0, v - v1)) < r) return true;
    }
    return false;
  };
  const SC = 30, sGrid = new Map(), sKey = cellKey;
  for (const [name, , , , , raised, pts] of roadLines) {
    if (!name || raised) continue;
    for (let p = 0; p + 3 < pts.length; p += 2) {
      const x0 = Math.min(pts[p], pts[p + 2]), x1 = Math.max(pts[p], pts[p + 2]), z0 = Math.min(pts[p + 1], pts[p + 3]), z1 = Math.max(pts[p + 1], pts[p + 3]);
      for (let i = Math.floor(x0 / SC); i <= Math.floor(x1 / SC); i++) for (let j = Math.floor(z0 / SC); j <= Math.floor(z1 / SC); j++) {
        const k = sKey(i, j);
        (sGrid.get(k) || sGrid.set(k, []).get(k)).push([name, pts[p], pts[p + 1], pts[p + 2], pts[p + 3]]);
      }
    }
  }
  const streetAt = (x, z) => {
    let best = '', bd = Infinity;
    const i0 = Math.floor(x / SC), j0 = Math.floor(z / SC);
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) for (const [name, ax, az, bx, bz] of sGrid.get(sKey(i0 + a, j0 + c)) || []) {
      const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L));
      const d = Math.hypot(ax + t * dx - x, az + t * dz - z);
      if (d < bd) { bd = d; best = name; }
    }
    return best;
  };
  return { labelAt, blockAt: (x, z) => byLab.get(labelAt(x, z)) || null, buildingNear, isWater, streetAt };
})();
{
  const lines = fs.readFileSync(path.join(RAW, 'street-trees.csv'), 'utf8').split(/\r?\n/);
  const head = fields(lines[0]);
  const NAME = head.indexOf('COMMON_NAME'), DBH = head.indexOf('DBH_TRUNK'), GEOM = head.indexOf('geometry');
  const STREET = head.indexOf('STREETNAME'), POS = head.indexOf('TREE_POSITION_NUMBER');
  const forms = {};
  const trees = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = fields(lines[i]);
    const g = /\[\s*\[?\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/.exec(f[GEOM] || '');
    if (!g) continue;
    const [x, z] = toWorld(+g[1], +g[2]);
    if (!inDetail(x, z)) continue;
    const name = f[NAME] || '';
    const dbh = +f[DBH] || 20;
    const form = formOf(name.trim());
    forms[form] = (forms[form] || 0) + 1;
    const r = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
    trees.push({ x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, model: modelFor(form, dbh, r), h: Math.round(heightOf(form, dbh) * 10), street: f[STREET] || '', pos: f[POS] || '' });
  }
  const { kept, stats: s } = spreadPiles(trees, city);
  treePiles = s;
  for (const t of kept) streetTrees.push(t.x, t.z, t.model, t.h);
  log(`street trees: ${trees.length} in the inventory (${Object.entries(forms).map(([k, v]) => `${k} ${v}`).join(', ')}); ` +
    `${s.piles} piles of ${s.trees} on one point: ${s.stayed} stay, ${s.moved} moved along their frontage, ${s.dropped} left out` +
    ` (${s.left} piles, ${s.leftTrees} trees, on High Park's islands: its lidar's); ${streetTrees.length / 4} drawn`);
}
