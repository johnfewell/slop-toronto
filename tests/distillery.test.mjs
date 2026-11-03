// The Distillery District's phase 2 (st-01vq.9; buildings.js DISTILLERY, city-grid.js's lanes), on buildings.js
// buildCityBlocks with stand-in materials (no GPU), as tests/massing.test.mjs builds it:
// - the Boiler House is two brick storeys, not the 40.8 m glass tower its massing height (its chimney's) made it
// - the two OSM chimneys stand in the Victorian brick's batch, at their mapped heights, with colliders
// - the Stone Distillery (its block & the fermenting wing) is limestone (paint.w >= 4), the rest brick, and the brick
//   is the muted range (no saturated reds)
// - the monitor roofs: on the long low warehouses only, every wall wound to face its normal
// - the lanes' paving goes on the one block that holds Trinity St, Gristmill, Tank House & Case Goods Lanes
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as CORE from '../vendor/three/three.core.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const WALL_KINDS = { shop: 0, entry: 1, rear: 2, lotLine: 3, blankStone: 4 };

function buildBlocks() {
  const anyNode = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : anyNode), apply: () => anyNode });
  class MeshStandardNodeMaterial extends CORE.MeshStandardMaterial {}
  const win = { CITY: { THREE: { ...CORE, MeshStandardNodeMaterial }, Addons: { mergeGeometries: () => new CORE.BufferGeometry() }, DEBUG_ROADS: false } };
  win.CITY.TSL = Object.fromEntries(['Fn', 'float', 'color', 'uv', 'attribute', 'fract', 'smoothstep', 'mix', 'abs'].map((n) => [n, anyNode]));
  const c = vm.createContext({ window: win, Math, JSON, Object, Array, Number, Map, Set, Float32Array, Float64Array, Uint8Array, Uint16Array, Uint32Array, WeakMap, Infinity, NaN, console, performance });
  for (const f of ['js/toronto-geodata.js', 'js/city-config.js']) vm.runInContext(read(f), c);
  const made = [];
  const batches = [];
  Object.assign(win.CITY, {
    WALL_KINDS,
    createFootprintFacades: () => ({ meshes: [], triangles: 0, walls: 0 }),
    createRenderedFacadeMaterial: (o) => { const m = new CORE.MeshBasicMaterial(); m.userData.opts = o; made.push(o); return m; },
    createCurtainWallMaterial: (o) => { const m = new CORE.MeshBasicMaterial(); m.userData.opts = o; made.push(o); return m; },
    createFacadeBoxes: (m, boxes) => { batches.push({ opts: m.userData.opts, boxes }); return new CORE.InstancedMesh(new CORE.BoxGeometry(1, 1, 1), m, boxes.length); },
    createFireEscapes: () => ({ begin() {}, add() {}, end() {} })
  });
  vm.runInContext(read('js/buildings.js'), c);
  const out = win.CITY.buildCityBlocks(new CORE.Scene());
  return { out, made, batches, CITY: win.CITY };
}

const { out, batches, CITY } = buildBlocks();
const site = CITY.LANDMARK_SITES.distillery;
const victorian = batches.find((b) => b.opts && b.opts.victorian);
const near = (b, x, z, tol) => Math.abs(b.x - x) < tol && Math.abs(b.z - z) < tol;
// sRGB HSV saturation of a linear paint
const toSRGB = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const saturation = ([r, g, b]) => { const s = [r, g, b].map(toSRGB); const mx = Math.max(...s); return mx ? (mx - Math.min(...s)) / mx : 0; };

test('the Victorian material is the arched one, and only it', () => {
  assert.ok(victorian, 'a facade batch in the victorian material');
  assert.equal(batches.filter((b) => b.opts && b.opts.victorian).length, 1);
});

test('the Boiler House is two brick storeys under its chimney, not a 40.8 m glass tower', () => {
  const glassTall = batches.filter((b) => b.opts && !b.opts.victorian).flatMap((b) => b.boxes).filter((b) => near(b, 1821.2, -82, 30) && b.h > 30);
  assert.deepEqual(glassTall.map((b) => b.h), [], 'no tall box at the Boiler House outside the Victorian batch');
  const house = victorian.boxes.filter((b) => b.faces[0] !== WALL_KINDS.lotLine && near(b, 1821.2, -82, 20));
  assert.ok(house.length >= 1, 'the Boiler House is in the Victorian batch');
  for (const b of house) assert.equal(b.h, 11);
});

test('the two OSM chimneys stand at their mapped heights, with colliders', () => {
  for (const [x, z, H] of [[1823.0, -81.7, 35], [1751.2, -15.3, 20]]) {
    const parts = victorian.boxes.filter((b) => b.x === x && b.z === z);
    assert.equal(parts.length, 5, 'plinth, two shaft lengths, a corbel band & the cap');
    for (const p of parts) assert.deepEqual([...p.faces], [3, 3, 3, 3], 'blank brick all round');
    assert.ok(Math.abs(Math.max(...parts.map((p) => p.y + p.h / 2)) - H) < 1e-9, `${H} m tall`);
    assert.ok(Math.abs(Math.min(...parts.map((p) => p.y - p.h / 2))) < 1e-9, 'from the ground');
    assert.ok(out.colliders.some((c) => c.obb && c.obb.cx === x && c.obb.cz === z && c.maxY === H), 'solid');
  }
  assert.equal(CITY.distilleryStats.chimneys, 2);
});

test('the Stone Distillery is limestone, the rest of the district a muted brick', () => {
  const stone = victorian.boxes.filter((b) => b.paint[3] >= 4);
  assert.ok(stone.some((b) => near(b, 1741.5, -5.7, 30)) && stone.some((b) => near(b, 1697.3, -18.2, 30)), 'both its blocks');
  assert.ok(stone.every((b) => near(b, 1720, -12, 50)), 'nothing else');
  for (const b of stone) assert.ok(saturation(b.paint) < 0.2, `limestone is grey (${saturation(b.paint).toFixed(2)})`);
  const brick = victorian.boxes.filter((b) => b.paint[3] >= 2 && b.paint[3] < 4);
  assert.ok(brick.length >= 20);
  for (const b of brick) {
    const s = saturation(b.paint);
    assert.ok(s > 0.25 && s < 0.5, `a red-brown, not a saturated red (saturation ${s.toFixed(2)})`);
  }
  assert.equal(CITY.distilleryStats.stone, 2);
});

test('monitor roofs on the long low warehouses, every clerestory wall facing out', () => {
  const st = CITY.distilleryStats;
  assert.ok(st.monitor >= 3 && st.monitor <= 10, `${st.monitor} monitor roofs`);
  const roofs = out.group.children.find((o) => o.name === 'HippedRoofs');
  const pos = roofs.geometry.attributes.position.array, nor = roofs.geometry.attributes.normal.array;
  let walls = 0;
  for (let i = 0; i < pos.length; i += 9) {
    const ny = nor[i + 1];
    if (Math.abs(ny) > 0.5 || !CITY.LANDMARK_SITES || Math.hypot(pos[i] - site.x, pos[i + 2] - site.z) > 260) continue;
    const ux = pos[i + 3] - pos[i], uy = pos[i + 4] - pos[i + 1], uz = pos[i + 5] - pos[i + 2];
    const vx = pos[i + 6] - pos[i], vy = pos[i + 7] - pos[i + 1], vz = pos[i + 8] - pos[i + 2];
    const cx = uy * vz - uz * vy, cz = ux * vy - uy * vx;
    assert.ok(cx * nor[i] + cz * nor[i + 2] > 0, `wall triangle ${i / 9} wound against its normal`);
    walls++;
  }
  assert.ok(walls >= st.monitor * 20, `${walls} clerestory triangles`);
});

test('the lanes are on one block: Trinity St, Gristmill, Tank House & Case Goods Lanes (OSM)', () => {
  const block = CITY.blockAt(site.x, site.z);
  assert.ok(block && !block.median);
  for (const [x, z, lane] of [[1787, -46, 'Trinity St'], [1786.5, 10, 'Trinity St'], [1707, -33.4, 'Gristmill Lane'], [1658.6, -50.3, 'Gristmill Lane'],
    [1840, -48, 'Tank House Lane'], [1830, 8, 'Case Goods Lane']]) assert.equal(CITY.blockAt(x, z), block, `${lane} at ${x}, ${z}`);
});

test('the 13-storey block at Parliament & Mill is brick-clad (OSM building:material=brick), not curtain wall', () => {
  const at = batches.flatMap((b) => b.boxes.map((x) => ({ ...x, opts: b.opts }))).filter((b) => near(b, 1634.9, -38.7, 3) && b.h > 30);
  assert.equal(at.length, 1);
  assert.equal(at[0].opts.windowWidth, 2.4, 'the rendered office facade');
  assert.ok(at[0].paint[3] >= 2 && at[0].paint[3] < 4, 'in brick');
});
