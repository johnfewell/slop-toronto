// jf-qw7 (docs/rosedale-streetscape.md): the Rosedale streetscape from John's own photos: the zone of Rosedale's street furniture (js/rosedale-zone.js), the black globe lamp post
// (js/mapped-poles.js look 'globe', drawn by js/street-details.js), and the rule that puts it on the City's mapped street lights there and nowhere else
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as CORE from '../vendor/three/three.core.js';
import { mergeGeometries } from '../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const world = (search = '') => {
  const ctx = { window: { CITY: { TSL: {} } }, location: { search }, URLSearchParams };
  vm.runInNewContext(read('js/rosedale-zone.js'), ctx);
  vm.runInNewContext(read('js/mapped-poles.js'), ctx);
  return ctx.window.CITY;
};

test('the zone holds South and North Rosedale and not Moore Park, Summerhill, the Annex or downtown', () => {
  const C = world();
  // (world metres; the City's mapped lights on Chestnut Park, Crescent Rd and Roxborough Dr stand in it)
  for (const [x, z, name] of [[684, -3694, 'Chestnut Park'], [756, -3547, 'Crescent Rd'], [1508, -3875, 'Roxborough Dr'], [802, -3693, 'Chestnut Park east']]) assert.ok(C.rosedaleZoneAt(x, z), name);
  for (const [x, z, name] of [[2120, -5536, 'Moore Park'], [2662, -5375, 'Welland Ave'], [541, -4615, 'Summerhill'], [348, -2864, 'Yonge and Bloor'], [0, 0, 'Union Station'], [-4000, -900, 'High Park']]) assert.ok(!C.rosedaleZoneAt(x, z), name);
  assert.ok(C.ROSEDALE_ZONE.w * C.ROSEDALE_ZONE.h < 12000, 'a small mask');
});

test('a street light on a street of Rosedale up to a collector is a globe post; the arterials, the old poles outside and ?rosedaleStreet=0 are not', () => {
  const P = (type, x, z) => ({ type, x, z });
  const data = { shipped: [6006, 6004, 6005], types: { 6006: { ids: [1, 1, 1], xz: [6840, -36940, 7560, -35470, 3480, -28640] }, 6004: { ids: [10], xz: [8020, -36930] }, 6005: { ids: [20], xz: [6845, -36935] } }, looks: {} };
  const sites = (C, rank) => C.mappedPoleSites(data, {
    blockAt: () => ({}), nearestRoads: (x, z) => [{ road: { rank, raised: false, w: 7.4 }, dist: 5, px: x, pz: z - 5, dx: 1, dz: 0 }]
  }).sites;
  const C = world();
  const s = sites(C, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(s.map((q) => [q.type, q.look]))), [[6006, 'globe'], [6006, 'globe'], [6006, 'steel'], [6004, 'globe'], [6005, 'steel']], 'lights in Rosedale: globes; downtown: steel; the signal pole is the signal pole');
  assert.ok(sites(C, 2).slice(0, 2).every((q) => q.look === 'globe'), 'a collector (tertiary) too');
  assert.ok(sites(C, 3).slice(0, 2).every((q) => q.look === 'steel'), 'an arterial keeps the tall pole');
  assert.ok(sites(world('?rosedaleStreet=0'), 1).every((q) => q.look !== 'globe'), 'the switch');
  // a wooden pole in the zone becomes the globe post too (the City's lights on the hydro line are Rosedale's lights as well)
  const woody = { ...data, looks: { wood: [1, 1, 1] } };
  assert.equal(C.mappedPoleSites(woody, { blockAt: () => ({}), nearestRoads: (x, z) => [{ road: { rank: 1, raised: false, w: 7.4 }, dist: 5, px: x, pz: z - 5, dx: 1, dz: 0 }] }).sites[0].look, 'globe');
});

test('the globe post is about 4 m, black cast iron with a lit white globe, and has its sun-shadow stand-in', () => {
  const C = world();
  const M = C.poleModels;
  assert.ok(M.PED_LAMPS.globe.h > 3.6 && M.PED_LAMPS.globe.h < 4.4, 'about 4 m');
  const g = M.pedLampGeometry(CORE, mergeGeometries, 'globe');
  g.computeBoundingBox();
  assert.ok(Math.abs(g.boundingBox.min.y) < 0.02 && g.boundingBox.max.y > 3.8 && g.boundingBox.max.y < 4.2, `height ${g.boundingBox.max.y}`);
  assert.ok(g.boundingBox.max.x < 0.4 && g.boundingBox.min.x > -0.4, 'slim');
  const glow = g.attributes.glow, col = g.attributes.color;
  let lit = 0, dark = 0;
  for (let i = 0; i < glow.count; i++) {
    if (glow.getX(i) > 0.5) { lit++; assert.ok(col.getX(i) > 0.5 && g.attributes.position.getY(i) > 3.25, 'the glass is pale and at the top'); } else { dark++; assert.ok(col.getX(i) < 0.01, 'the iron is black'); }
  }
  assert.ok(lit > 40 && dark > 60, `lit ${lit}, iron ${dark}`);
  const stand = M.shadowStandIn(CORE, mergeGeometries, 'globe');
  stand.computeBoundingBox();
  assert.ok(stand.boundingBox.max.y > 3.8 && stand.boundingBox.max.y < 4.2);
  assert.ok(stand.attributes.position.count < 60, 'a coarse stand-in');
  // street-details draws it (a model, its lamp pool, its collider) and the procedural fill leaves Rosedale alone
  const sd = read('js/street-details.js');
  assert.match(sd, /globe: \(\) => PM\.pedLampGeometry\(THREE, mergeGeometries, 'globe'\)/);
  assert.match(sd, /s\.look === 'lantern' \|\| s\.look === 'globe'/);
  assert.match(sd, /rosedaleOnly\(px, pz\)/);
});
