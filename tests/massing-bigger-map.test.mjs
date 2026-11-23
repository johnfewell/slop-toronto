// st-ndw9.21: the bigger desktop map draws the massing outlines (and so the building presets) inside the downtown frame.
// Its geodata (data/frames/eglinton/toronto-geodata.bin) is built from a bigger download: 140,541 building rows in another
// order, holding each of today's 35,266 rows unchanged. data/toronto-massing.bin therefore also carries each record's row in
// that list (frameRowDelta), and js/massing-data.js uses whichever list the loaded geodata is. This checks the file against
// both geodatas, record by record, and that nothing is drawn twice or dropped at the frame's edge.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { unpackGeo } from '../js/geodata-loader.js';
import { massingRows, massingId, rowCheck } from '../js/massing-data.js';
import { builtFor } from '../js/building-presets.js';
import vm from 'node:vm';
import * as CORE from '../vendor/three/three.core.js';
import * as MC from '../js/massing-cells.js';

const file = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url));
const { MASSING: M } = await unpackGeo(file('data/toronto-massing.bin'));
const { GEO: DETAIL } = await unpackGeo(file('data/toronto-geodata.bin'));
const { GEO: BIGGER } = await unpackGeo(file('data/frames/eglinton/toronto-geodata.bin'));
const onDetail = massingRows(M, DETAIL);
const onBigger = massingRows(M, BIGGER);
const F = DETAIL.frame.detail;
const inFrame = (b) => b[0] >= F.x0 && b[0] <= F.x1 && b[1] >= F.z0 && b[1] <= F.z1;

test('the sidecar carries the bigger map\'s rows, checked against the bigger geodata and no other', () => {
  assert.equal(M.frameName, 'eglinton');
  assert.equal(M.frameRows, BIGGER.buildings.length);
  assert.equal(M.frameRowCheck, rowCheck(BIGGER.buildings));
  assert.equal(M.frameRowDelta.length, M.fid.length);
  assert.equal(onDetail.error, null);
  assert.equal(onDetail.frame, 'detail');
  assert.equal(onBigger.error, null);
  assert.equal(onBigger.frame, 'eglinton');
  assert.equal(onBigger.records, onDetail.records);
  assert.equal(onBigger.rows.size, onDetail.rows.size);
  assert.equal(onBigger.rejected, 0, 'no record is off its outline on the bigger map');
  // (a geodata that is neither is refused whole, as before)
  const moved = { ...BIGGER, buildings: BIGGER.buildings.map((b, i) => (i === 9 ? [b[0] + 0.1, ...b.slice(1)] : b)) };
  assert.match(massingRows(M, moved).error, /other geodata/);
  assert.match(massingRows(M, moved).error, /eglinton/);
});

test('every record lands on the same building in both maps: same box, same outline, same neighbours, other row', () => {
  const byId = new Map();
  for (const [row, r] of onBigger.rows) byId.set(r.id, { row, r });
  assert.equal(byId.size, onBigger.rows.size);
  let sameRow = 0;
  for (const [row, r] of onDetail.rows) {
    const g = byId.get(r.id);
    assert.ok(g, `${r.id} is on the bigger map`);
    assert.deepEqual(BIGGER.buildings[g.row], DETAIL.buildings[row], `${r.id}: the box is the same row's`);
    assert.equal(g.r.index, r.index, 'the same record in the same place of the sidecar (the presets are keyed by it)');
    assert.deepEqual(g.r.rings, r.rings);
    if (g.row === row) sameRow++;
  }
  assert.ok(sameRow < onDetail.rows.size / 2, 'the rows really are another list (that is why the sidecar needs both)');
  for (const [row, r] of onBigger.rows) assert.equal(massingId(M, r.index), r.id);
});

test('inside the downtown frame every bigger-map row is a record, a listed skip, or one of the few edge buildings that keep their boxes; nothing is twice', () => {
  const drawn = new Set(onBigger.rows.keys());
  const skip = new Set();
  // today's skipped rows, found again by content in the bigger list
  const key = (b) => JSON.stringify(b);
  const bigRows = new Map(); BIGGER.buildings.forEach((b, i) => { const k = key(b); (bigRows.get(k) || bigRows.set(k, []).get(k)).push(i); });
  // (each of today's rows is a record or a skip, test/massing.test.mjs; a skip keeps its box on the bigger map as here)
  const dk = new Map(); DETAIL.buildings.forEach((b, i) => { const k = key(b); (dk.get(k) || dk.set(k, []).get(k)).push(i); });
  for (const r of M.skipRow) { const k = key(DETAIL.buildings[r]); const n = dk.get(k).indexOf(r); skip.add(bigRows.get(k)[n]); }
  let inside = 0, edge = 0, boxes = 0;
  BIGGER.buildings.forEach((b, i) => {
    if (!inFrame(b)) { assert.ok(!drawn.has(i), 'nothing outside the frame has an outline'); return; }
    inside++;
    if (drawn.has(i)) return;
    if (skip.has(i)) { boxes++; return; }
    edge++;
    assert.ok(b[0] < F.x0 + 10 || b[0] > F.x1 - 10 || b[1] < F.z0 + 10 || b[1] > F.z1 - 10, `row ${i} keeps its box and stands ${b[0]},${b[1]}, more than 10 m from the frame's edge`);
  });
  assert.equal(inside, drawn.size + boxes + edge);
  assert.equal(boxes, M.skipRow.length);
  assert.equal(edge, 18, 'the bigger download keeps 18 buildings on the frame\'s line that today\'s map clipped');
  assert.equal(drawn.size, M.fid.length);
});

test('the presets files are accepted for either map\'s rows, because they are keyed by the sidecar\'s records', () => {
  assert.equal(builtFor(onDetail, DETAIL), M.rowCheck);
  assert.equal(builtFor(onBigger, BIGGER), M.rowCheck, 'the bigger map is checked against the rows the presets were built for');
  assert.equal(builtFor(null, BIGGER), rowCheck(BIGGER.buildings), 'with no sidecar it is the geodata\'s own');
});

// buildings.js buildCityBlocks on the bigger map's own geodata, with stand-in materials (no GPU), as tests/massing.test.mjs does for
// the detail map: exactly the records' rows lose their boxes, each is one polygon building with one collider, and every other
// building (outside the frame, the 18 on its line, the skipped rows) keeps its box
function buildBlocks(massing) {
  const anyNode = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : anyNode), apply: () => anyNode });
  class MeshStandardNodeMaterial extends CORE.MeshStandardMaterial {}
  const win = { CITY: { THREE: { ...CORE, MeshStandardNodeMaterial }, Addons: { mergeGeometries: () => new CORE.BufferGeometry() }, DEBUG_ROADS: false, MassingCells: MC } };
  win.CITY.TSL = Object.fromEntries(['Fn', 'float', 'color', 'uv', 'attribute', 'fract', 'smoothstep', 'mix', 'abs'].map((n) => [n, anyNode]));
  const c = vm.createContext({ window: win, Math, JSON, Object, Array, Number, Map, Set, Float32Array, Float64Array, Int16Array, Int32Array, Uint8Array, Uint16Array, Uint32Array, WeakMap, Infinity, NaN, isFinite, console, performance, URLSearchParams, location: { search: '' }, Worker: undefined, document: undefined, navigator: {} });
  win.CITY.GEO = structuredClone(BIGGER);
  for (const f of ['js/world-collision.js', 'js/city-config.js']) vm.runInContext(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'), c);
  if (massing) win.CITY.MASSING = massing;
  const made = [];
  Object.assign(win.CITY, {
    WALL_KINDS: { shop: 0, entry: 1, rear: 2, lotLine: 3, blankStone: 4 }, setFootprintTable: () => {},
    createRenderedFacadeMaterial: (o) => { made.push(o); return new CORE.MeshBasicMaterial(); },
    createCurtainWallMaterial: (o) => { made.push(o); return new CORE.MeshBasicMaterial(); },
    createFacadeBoxes: (m, boxes) => new CORE.InstancedMesh(new CORE.BoxGeometry(1, 1, 1), m, boxes.length),
    createFireEscapes: () => ({ begin() {}, add() {}, end() {} })
  });
  vm.runInContext(fs.readFileSync(new URL('../js/buildings.js', import.meta.url), 'utf8'), c);
  const out = win.CITY.buildCityBlocks(new CORE.Scene());
  return (out.massingReady || Promise.resolve()).then(() => ({ out, stats: win.CITY.massingStats }));
}

test('buildCityBlocks on the bigger map: the records\' rows are polygon buildings with a collider each and lose their boxes, nothing else does', { timeout: 300000 }, async () => {
  const plain = await buildBlocks(null), poly = await buildBlocks(onBigger);
  const boxes = (r) => r.out.group.children.filter((o) => /^Buildings_/.test(o.name)).reduce((s, o) => s + o.count, 0);
  assert.equal(plain.stats, undefined);
  assert.equal(poly.stats.buildings, onBigger.rows.size);
  assert.equal(boxes(plain) - boxes(poly), poly.stats.boxesReplaced, 'exactly the records\' rows lose their boxes');
  assert.ok(boxes(poly) > 100000, `the 105,000 buildings outside the frame keep their boxes (${boxes(poly)})`);
  const colliders = poly.out.colliders.filter((c) => c.massing);
  assert.equal(colliders.length, onBigger.rows.size);
  assert.equal(new Set(colliders.map((c) => c.massing)).size, colliders.length, 'one collider for each building, none twice');
  assert.equal(plain.out.colliders.filter((c) => c.polygon).length, 0);
});

test('the massing meshes carry their geometry box from the worker\'s pass, equal to the one three.js would compute (st-ndw9.21: scene-culling asked for it again, +0.6 s of load)', { timeout: 300000 }, async () => {
  const poly = await buildBlocks(onBigger);
  const meshes = poly.out.group.children.filter((o) => /^MassingBuildings_/.test(o.name));
  assert.ok(meshes.length > 100);
  for (const m of meshes) {
    const g = m.geometry, given = g.boundingBox;
    assert.ok(given, `${m.name} has its box`);
    const fresh = new CORE.Box3().setFromBufferAttribute(g.attributes.position);
    for (const k of ['x', 'y', 'z']) { assert.ok(Math.abs(given.min[k] - fresh.min[k]) < 1e-6 && Math.abs(given.max[k] - fresh.max[k]) < 1e-6, `${m.name} ${k}`); }
  }
});

test('fastBounds (the roofs\' box and sphere from one pass, st-ndw9.21) gives exactly what three.js computes', () => {
  const win = { CITY: { THREE: CORE, Addons: {}, TSL: {} } };
  const anyNode = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : anyNode), apply: () => anyNode });
  class MeshStandardNodeMaterial extends CORE.MeshStandardMaterial {}
  win.CITY.THREE = { ...CORE, MeshStandardNodeMaterial };
  win.CITY.TSL = Object.fromEntries(['Fn', 'float', 'color', 'uv', 'attribute', 'fract', 'smoothstep', 'mix', 'abs'].map((n) => [n, anyNode]));
  const c = vm.createContext({ window: win, Math, JSON, Object, Array, Number, Map, Set, Float32Array, Float64Array, Int16Array, Int32Array, Uint8Array, Uint16Array, Uint32Array, WeakMap, Infinity, NaN, isFinite, console, performance, URLSearchParams, location: { search: '' } });
  win.CITY.GEO = structuredClone(BIGGER);
  for (const f of ['js/world-collision.js', 'js/city-config.js']) vm.runInContext(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'), c);
  Object.assign(win.CITY, { WALL_KINDS: { shop: 0, entry: 1, rear: 2, lotLine: 3, blankStone: 4 }, createRenderedFacadeMaterial: () => new CORE.MeshBasicMaterial(), createCurtainWallMaterial: () => new CORE.MeshBasicMaterial(), createFacadeBoxes: () => null, createFireEscapes: () => null, setFootprintTable() {} });
  vm.runInContext(fs.readFileSync(new URL('../js/buildings.js', import.meta.url), 'utf8'), c);
  let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let t = 0; t < 20; t++) {
    const n = 3 * (50 + Math.floor(rnd() * 2000)), arr = new Float32Array(n * 3);
    for (let i = 0; i < arr.length; i++) arr[i] = (rnd() - 0.5) * 14000;
    const a = new CORE.BufferGeometry(); a.setAttribute('position', new CORE.BufferAttribute(arr, 3));
    const b = new CORE.BufferGeometry(); b.setAttribute('position', new CORE.BufferAttribute(arr, 3));
    a.computeBoundingBox(); a.computeBoundingSphere(); win.CITY.fastBounds(b);
    assert.deepEqual(b.boundingBox.min.toArray(), a.boundingBox.min.toArray());
    assert.deepEqual(b.boundingBox.max.toArray(), a.boundingBox.max.toArray());
    assert.deepEqual(b.boundingSphere.center.toArray(), a.boundingSphere.center.toArray());
    assert.equal(b.boundingSphere.radius, a.boundingSphere.radius);
  }
});
