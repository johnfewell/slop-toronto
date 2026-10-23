// Part 8: the City of Toronto's street trees (Street Tree Data, Open Government Licence – Toronto): every tree in the
// detailed city where it stands, as one of John's EZ-Tree models (js/ez-trees.js: assets/trees, from ride-anywhere's
// tools/assets/ez-tree-kit.mjs) picked by its genus's crown form and its trunk size, and as tall as its trunk says.
// GEO.streetTrees: flat [x, z, model index, height dm, ...] with TREE_MODELS below.
import fs from 'node:fs';
import path from 'node:path';
import { toWorld, log } from './geo-base.mjs';
import { inDetail } from './geo-roads.mjs';
import { fields } from './geo-props.mjs';

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
{
  const lines = fs.readFileSync(path.join(RAW, 'street-trees.csv'), 'utf8').split(/\r?\n/);
  const head = fields(lines[0]);
  const NAME = head.indexOf('COMMON_NAME'), DBH = head.indexOf('DBH_TRUNK'), GEOM = head.indexOf('geometry');
  const forms = {};
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
    streetTrees.push(Math.round(x * 10) / 10, Math.round(z * 10) / 10, modelFor(form, dbh, r), Math.round(heightOf(form, dbh) * 10));
  }
  log(`street trees: ${streetTrees.length / 4} (${Object.entries(forms).map(([k, v]) => `${k} ${v}`).join(', ')})`);
}
