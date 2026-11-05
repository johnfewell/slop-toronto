// Toronto Island Park's woods (docs/toronto-island-woods.md), the second park park-woods.js takes from the lidar: its
// data, its trees on its own islands beside High Park's, both parks' ground in the one lawn hook, and the build (one
// entry in tools/park-woods-parks.mjs) reproducible from the tiles
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const read = (f) => fs.readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8');
function city(woods) {
  const context = vm.createContext({ window: { CITY: { THREE, Addons: { mergeGeometries }, DEBUG_ROADS: false }, addEventListener() {} }, document: { addEventListener() {}, hidden: false },
    console: { info() {}, warn() {}, log() {} }, atob });
  for (const f of ['toronto-geodata', 'toronto-subway', 'toronto-subway-topology', 'high-park-data', 'don-valley', 'city-config', ...woods, 'park-woods']) vm.runInContext(read(f), context);
  return context.window.CITY;
}
const C = city(['high-park-woods-data', 'toronto-island-woods-data']), W = C.parkWoods, D = C.TORONTO_ISLAND_WOODS_DATA;
const HP = city(['high-park-woods-data']).parkWoods;

test('the island\'s data names its source and its park, and every crown stands on Toronto Island Park\'s islands', () => {
  assert.equal(D.kind, 'toronto-island-woods');
  assert.deepEqual([...D.parkNames], ['Toronto Island Park']);
  assert.match(D.source.dataset, /GTA 2023 lidar/);
  assert.ok(D.source.tiles.every((t) => /^[0-9a-f]{64}$/.test(t.sha256) && /_DSM$/.test(t.tile)));
  assert.deepEqual([...W.parks.map((p) => p.id)], ['high-park', 'toronto-island']);
  const isl = W.parks[1], crowns = isl.crowns(), models = new Set([...C.GEO.treeModels.map(([id]) => id), 'ez-cottonwood-medium', 'ez-cottonwood-large']);
  assert.ok(crowns.length > 6000 && crowns.length < 12000, `${crowns.length} crowns`);
  for (const c of crowns) {
    const b = C.blockAt(c.x, c.z);
    assert.ok(b && b.parkName === 'Toronto Island Park', `a crown off the island's park at ${c.x}, ${c.z}`);
    assert.ok(c.h >= 5 && c.h <= 45 && c.r >= 2 && c.r < 12 && models.has(c.model), `${c.h} m, ${c.r} m, ${c.model}`);
    assert.ok(c.h < 40, `a mast at ${c.x}, ${c.z}`); // (the masts and light standards, 40-45 m and 2 m wide, are left out)
  }
  // (a lakeshore's woods: the cottonwoods, the aspen's form in their own bark, above all; then the ash, for the willows
  // and maples; ez-trees.js draws the cottonwoods as its variants of the aspens)
  const n = (s) => crowns.filter((c) => c.model.includes(s)).length;
  assert.ok(n('cottonwood') > n('ash') && n('ash') > n('oak') && !n('aspen'), `${n('cottonwood')} cottonwoods, ${n('ash')} ashes, ${n('oak')} oaks`);
  assert.match(read('ez-trees'), /\['ez-cottonwood-large', 'ez-aspen-large', 'ez-ash-large', cottonwoodBark\]/);
  assert.ok(D.diagnostics.canopyShare > 0.2 && D.diagnostics.canopyShare < 0.5, `canopy ${D.diagnostics.canopyShare}`);
});

test('both parks\' trees replace their own islands\' invented ones, High Park\'s as when it is alone', () => {
  const hp = W.parks[0].crowns(), isl = W.parks[1].crowns();
  assert.equal(JSON.stringify(hp), JSON.stringify(HP.crowns()));
  assert.equal(W.crowns().length, hp.length + isl.length);
  const tb = C.worldFromLatLon(43.6476, -79.4137); // (Trinity Bellwoods Park)
  const list = [
    { x: hp[0].x + 1, y: 0.22, z: hp[0].z, scale: 1, species: 0, tier: 0 }, // invented, in High Park: out
    { x: isl[0].x + 1, y: 0.22, z: isl[0].z, scale: 1, species: 0, tier: 0 }, // invented, on the island: out
    { x: tb.x, y: 0.22, z: tb.z, scale: 1, species: 1, tier: 0 } // invented, in another park: stays
  ];
  W.replaceTrees(list, 0.22);
  assert.equal(W.stats.replaced, 2);
  assert.deepEqual({ ...list[0] }, { x: tb.x, y: 0.22, z: tb.z, scale: 1, species: 1, tier: 0 });
  assert.equal(list.length - 1, W.stats.crowns);
  assert.equal(W.stats.crowns, W.stats.parks['high-park'].crowns + W.stats.parks['toronto-island'].crowns);
  assert.ok(W.stats.parks['toronto-island'].crowns > 6000);
});

test('the island\'s ground: woodland floor under its canopy, on its islands only; the lawn takes both parks in one hook', () => {
  const g = W.groundCover(1), { cell, w, h } = D.ground;
  assert.equal(g.W, w); assert.equal(g.H, h);
  let floor = 0;
  for (let j = 0; j < h; j += 2) for (let i = 0; i < w; i += 2) {
    const o = (j * w + i) * 4;
    if (!g.data[o + 3]) { assert.equal(g.data[o] + g.data[o + 1] + g.data[o + 2], 0); continue; }
    floor += (4 * g.data[o]) / 255;
  }
  const ha = (floor * cell * cell) / 1e4;
  assert.ok(ha > 40 && ha < 120, `woodland floor ${ha.toFixed(1)} ha`);
  // (High Park's cover is the same with the island loaded beside it)
  assert.ok(Buffer.from(W.groundCover(0).data).equals(Buffer.from(HP.groundCover(0).data)));
  assert.match(read('park-woods'), /for \(const p of parks\) p\.groundInto\(out, wp, fx, noon\);/);
});

test('one park more is an entry: the builder reads it from tools/park-woods-parks.mjs', async () => {
  const { PARKS } = await import('../tools/park-woods-parks.mjs');
  for (const [id, p] of Object.entries(PARKS)) {
    assert.equal(p.id, id);
    assert.ok(fs.existsSync(new URL(`../${p.out}`, import.meta.url)), p.out);
  }
  const html = fs.readFileSync(new URL('../explore.html', import.meta.url), 'utf8');
  for (const p of Object.values(PARKS)) assert.ok(html.indexOf(`'./${p.out}'`) > 0 && html.indexOf(`'./${p.out}'`) < html.indexOf('\'./js/park-woods.js\''), `${p.out} before park-woods.js`);
});

const tiles = path.join(process.env.DON_VALLEY_DTM || path.join(os.homedir(), '.cache/slop-toronto/raw/ontario-dtm-gta2023'), 'manifest-toronto-island-dsm.json');
test('the island\'s build is reproducible from the lidar tiles', { skip: !fs.existsSync(tiles) && 'no surface model tiles (node tools/fetch-don-valley-dtm.mjs --region toronto-island --product dsm)' }, () => {
  const out = path.join(os.tmpdir(), `toronto-island-woods-data-${process.pid}.js`);
  execFileSync(process.execPath, [new URL('../tools/build-park-woods.mjs', import.meta.url).pathname, '--park', 'toronto-island', '--out', out], { stdio: 'pipe' });
  assert.equal(fs.readFileSync(out, 'utf8'), read('toronto-island-woods-data'));
  fs.rmSync(out);
});
