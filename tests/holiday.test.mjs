// Holiday installations (js/holiday.js, docs/holiday-installations.md): the date windows, the ?holiday switch, the derived
// Distillery lane layout (strings span open lanes between walls) and a build on stand-in data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function load(extra = {}, search = '') {
  const C = { THREE, TSL, Addons: { mergeGeometries }, ...extra };
  const ctx = vm.createContext({ window: { CITY: C }, URLSearchParams, location: { search }, console: { info() {}, log() {}, warn() {} }, Math, atob: (s) => Buffer.from(s, 'base64').toString('binary') });
  for (const f of ['js/toronto-geodata.js', 'js/toronto-holiday.js', 'js/toronto-rinks.js', 'js/world-collision.js', 'js/sports-terrain.js', 'js/rinks.js', 'js/holiday.js']) vm.runInContext(read(f), ctx, { filename: f });
  return C;
}
const C0 = load();
const on = (m, d, search = '') => { const s = C0.holidaySeason({ month: m, day: d }, search); return [s.nathanPhillips, s.distillery]; };

test('windows: the Distillery 12 Nov - 3 Jan, Nathan Phillips Square 28 Nov - 7 Jan, both inclusive', () => {
  assert.deepEqual(on(11, 11), [false, false]);
  assert.deepEqual(on(11, 12), [false, true]);
  assert.deepEqual(on(11, 27), [false, true]);
  assert.deepEqual(on(11, 28), [true, true]);
  assert.deepEqual(on(12, 25), [true, true]);
  assert.deepEqual(on(1, 3), [true, true]);
  assert.deepEqual(on(1, 4), [true, false]);
  assert.deepEqual(on(1, 7), [true, false]);
  assert.deepEqual(on(1, 8), [false, false]);
});

test('the summer presets (22 August) and the rest of the year show nothing', () => {
  assert.deepEqual(on(8, 22), [false, false]);
  for (const [m, d] of [[2, 14], [4, 1], [7, 1], [10, 31], [11, 1]]) assert.deepEqual(on(m, d), [false, false], `${m}-${d}`);
});

test('?holiday=0 turns both off inside the window; ?holiday=1 previews both outside it', () => {
  assert.deepEqual(on(12, 10, '?holiday=0'), [false, false]);
  assert.deepEqual(on(8, 22, '?holiday=1'), [true, true]);
  assert.equal(C0.holidaySeason({ month: 8, day: 22 }, '?holiday=1').forced, true);
  assert.throws(() => C0.holidaySeason({ month: 'x' }));
});

test('build: nothing is added to the scene outside the window, and on a day inside it both sites stand', () => {
  const colliders = [];
  const make = (date, search = '') => {
    const C = load({ SITE_DATE: date, blockAt: () => ({}), CITY_BOUNDS: { sidewalkHeight: 0.15 }, QUALITY: {}, cityUniforms: { uInteriorGlow: { value: 1 } } }, search);
    const scene = new THREE.Scene();
    return { out: C.buildHoliday(scene, colliders), scene, C };
  };
  assert.equal(make({ month: 8, day: 22 }).out, null);
  assert.equal(make({ month: 12, day: 10 }, '?holiday=0').out, null);
  const { out, scene, C } = make({ month: 11, day: 28 });
  assert.ok(out, 'built');
  assert.equal(scene.children.length, 1);
  assert.deepEqual(out.group.children.map((g) => g.name), ['NathanPhillipsHoliday', 'DistilleryWinterVillage']);
  assert.ok(C.holidayStats.bulbs > 300 && C.holidayStats.triangles < 60000, JSON.stringify(C.holidayStats));
  assert.ok(out.colliders.length >= 20);
});

test('the Distillery layout: strings span open lanes between tall walls, stalls and the tree are in the open', () => {
  const L = C0.HOLIDAY_LANES, G = C0.GEO;
  assert.ok(L.strings.length >= 30 && L.stalls.length >= 10);
  const covered = (x, z) => G.buildings.some(([bx, bz, ang, boxes]) => {
    const c = Math.cos(ang), s = Math.sin(ang), dx = x - bx, dz = z - bz, lx = dx * c + dz * s, lz = -dx * s + dz * c;
    return boxes.some(([a, b, c0, c1]) => lx > a && lx < b && lz > c0 && lz < c1);
  });
  for (const [x0, z0, x1, z1, y] of L.strings) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    assert.ok(len >= 6 && len <= 18 && y > 3 && y <= 4.8);
    for (const t of [0.25, 0.5, 0.75]) assert.ok(!covered(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t), `string ${x0},${z0} crosses a building`);
  }
  for (const [x, z] of [...L.stalls, L.tree]) assert.ok(!covered(x, z), `${x},${z} is inside a building`);
});

test('the derived layout matches its builder (run node tools/build-holiday-lanes.mjs after a geodata change)', async () => {
  const before = read('js/toronto-holiday.js');
  const { execFileSync } = await import('node:child_process');
  try { execFileSync(process.execPath, ['tools/build-holiday-lanes.mjs'], { cwd: new URL('../', import.meta.url), stdio: 'pipe' }); assert.equal(read('js/toronto-holiday.js'), before); }
  finally { fs.writeFileSync(new URL('../js/toronto-holiday.js', import.meta.url), before); }
});

test('explore.html loads the layout and the builder after the rinks, and main.js builds them', () => {
  const html = read('explore.html'), pos = (f) => html.indexOf(`'./js/${f}'`);
  assert.ok(pos('toronto-rinks.js') > 0 && pos('toronto-holiday.js') > pos('toronto-rinks.js'));
  assert.ok(pos('holiday.js') > pos('rinks.js') && pos('holiday.js') < pos('main.js'));
  assert.match(read('js/main.js'), /buildHoliday\?\.\(scene, allColliders\)/);
  assert.match(read('js/holiday.js'), /SITE_DATE\s*\|\|\s*C\.SCENE_DATE\s*\|\|\s*\{\s*month:\s*8,\s*day:\s*22\s*\}/);
});
