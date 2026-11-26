// js/facade-edges.js and buildings.js footprintEdges (st-2nl.6, docs/massing-buildings.md "Facades on the real polygon edges"):
// - edge classification: street / party / exposed-party / rear (and hidden) on made-up lots (a rectangle, an L, a trapezoid, a
//   sliver) and on every real footprint of the City's 3D Massing
// - ghost signs: only on exposed party walls tall and long enough, one a building, the same walls every build, none on the
//   streets that carry none, and a believable number on the older main streets
// - resolveFaceEdge / placeOnEdge: the hook storefront signs use to stand on the real polygon edge
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as CORE from '../vendor/three/three.core.js';
import { unpackGeo } from '../js/geodata-loader.js';
import { massingRows, massingId } from '../js/massing-data.js';
import * as MC from '../js/massing-cells.js';
import * as FE from '../js/facade-edges.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const WALL = { shop: 0, entry: 1, rear: 2, lotLine: 3, blankStone: 4, ghost: 5, ghostLarge: 6 };

// buildings.js with stand-in materials (no GPU), as tests/massing.test.mjs loads it
function load(massing, opts = {}) {
  const anyNode = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : anyNode), apply: () => anyNode });
  class MeshStandardNodeMaterial extends CORE.MeshStandardMaterial {}
  const win = { CITY: { THREE: { ...CORE, MeshStandardNodeMaterial }, Addons: { mergeGeometries: () => new CORE.BufferGeometry() }, DEBUG_ROADS: false, MassingCells: MC } };
  win.CITY.TSL = Object.fromEntries(['Fn', 'float', 'color', 'uv', 'attribute', 'fract', 'smoothstep', 'mix', 'abs'].map((n) => [n, anyNode]));
  const c = vm.createContext({ window: win, Math, JSON, Object, Array, Number, Map, Set, Float32Array, Float64Array, Int16Array, Int32Array, Uint8Array, Uint16Array, Uint32Array, WeakMap, Infinity, NaN, console, performance, Promise, URLSearchParams, location: { search: opts.search || '' } });
  for (const f of ['js/toronto-geodata.js', 'js/city-config.js']) vm.runInContext(read(f), c);
  if (massing) win.CITY.MASSING = massing;
  if (opts.edges) win.CITY.FacadeEdges = FE;
  Object.assign(win.CITY, {
    WALL_KINDS: WALL, setFootprintTable: () => {},
    createRenderedFacadeMaterial: () => new CORE.MeshBasicMaterial(), createCurtainWallMaterial: () => new CORE.MeshBasicMaterial(),
    createFacadeBoxes: (m, boxes) => new CORE.InstancedMesh(new CORE.BoxGeometry(1, 1, 1), m, boxes.length), createFireEscapes: () => ({ begin() {}, add() {}, end() {} })
  });
  vm.runInContext(read('js/buildings.js'), c);
  return win;
}

const win = load(null);
const { footprintEdges } = win.CITY;
const classes = (edges) => Array.from(edges, (e) => e.cls); // (an array of this realm, not the vm context's)

// a 12 x 24 m lot, counter-clockwise in (x, z) as the sidecar stores rings: edge 0 runs along +x at z = 0 (outward normal -z)
const lot = [[0, 0], [12, 0], [12, 24], [0, 24]];

test('a rectangular lot: the street front, a party wall under its neighbour, an exposed party wall above a lower one, the rear', () => {
  // edge 0 (z = 0) faces the street; edge 1 (x = 12) a neighbour as tall as the wall (covered whole); edge 3 (x = 0) a 3-storey neighbour under a 5-storey wall
  const street = new Map([[0, true]]), covered = new Map([[1, 15], [3, 9]]);
  const { edges, kinds } = footprintEdges(lot, covered, new Set(), street, WALL.shop, true, 0, 15);
  assert.deepEqual(classes(edges), ['street', 'party', 'rear', 'exposed-party']);
  assert.equal(edges[1].exposed, 0, 'covered to its top: nothing shows');
  assert.ok(Math.abs(edges[3].exposed - 6) < 1e-9, 'the wall shows 15 - 9 m above the neighbour');
  assert.deepEqual(Array.from(kinds), [WALL.shop, WALL.lotLine, WALL.rear, WALL.lotLine]);
  assert.ok(edges[0].street && !edges[2].street);
});

test('a neighbour that covers less than half the wall leaves its windows: not a party wall (the rule John approved, 2026-10-31)', () => {
  const { edges } = footprintEdges(lot, new Map([[1, 5]]), new Set(), new Map(), WALL.entry, false, 0, 15);
  assert.equal(edges[1].cls, 'rear');
  assert.equal(edges[1].kind, WALL.rear);
  assert.equal(edges[1].neighbour, 5);
});

test('hidden edges have no wall, and a tower on a podium keeps its windows over the podium roof', () => {
  const hidden = footprintEdges(lot, new Map(), new Set([2]), new Map(), WALL.entry, false, 0, 15);
  assert.equal(hidden.edges[2].cls, 'hidden');
  assert.equal(hidden.kinds[2], -1);
  // a podium 5 m high under a 40 m tower whose base is the podium roof: the podium covers none of the tower's wall
  const tower = footprintEdges(lot, new Map([[1, 5]]), new Set(), new Map(), WALL.entry, false, 5, 40);
  assert.equal(tower.edges[1].cls, 'rear');
});

test('an irregular lot: a trapezoid with a slanted street front, a notch and a sliver', () => {
  // a trapezoid (the street runs at an angle) with a 1.2 m jog on its east side
  const trap = [[0, 0], [14, 3], [14, 10], [15.2, 10], [15.2, 11], [13, 26], [-2, 24]];
  const street = new Map([[0, true]]);
  const covered = new Map([[6, 6], [5, 4]]);
  const { edges } = footprintEdges(trap, covered, new Set(), street, WALL.shop, true, 0, 14);
  assert.equal(edges.length, trap.length);
  assert.equal(edges[0].cls, 'street');
  assert.ok(Math.abs(edges[0].nx - 3 / Math.hypot(14, 3)) < 1e-9 && edges[0].nz < 0, 'the slanted front faces out of the lot');
  const len = (i) => edges[i].len;
  assert.ok(len(2) < 2 && len(3) < 2, 'the jog has slivers under 2 m');
  for (let i = 0; i < edges.length; i++) if (edges[i].len < 2) assert.equal(edges[i].kind, WALL.lotLine, `edge ${i}: a sliver under 2 m is windowless`);
  // the 6 m neighbour on edge 6 (a 25 m wall of 14): half its height is not covered, so it keeps windows; edge 5 is the shorter, higher-covered one
  assert.equal(edges[6].cls, 'rear');
  assert.equal(edges[5].cls, 'rear');
  // street edges are the ones the sidecar named
  assert.deepEqual(edges.map((e, i) => e.street === street.has(i)), edges.map(() => true));
});

test('an L-shaped lot: the inner corner edges are rear walls, the long outer edge the street front', () => {
  const L = [[0, 0], [20, 0], [20, 8], [8, 8], [8, 20], [0, 20]];
  const { edges } = footprintEdges(L, new Map([[5, 12]]), new Set(), new Map([[0, true]]), WALL.entry, false, 0, 12);
  assert.deepEqual(classes(edges), ['street', 'rear', 'rear', 'rear', 'rear', 'party']);
  assert.equal(edges[5].exposed, 0);
});

// every real footprint
const { MASSING: M } = await unpackGeo(fs.readFileSync(new URL('../data/toronto-massing.bin', import.meta.url)));
const geo = win.CITY.GEO;
const loaded = massingRows(M, geo);
const records = [...loaded.rows].map(([row, r]) => ({ row, ...r }));

test('real footprints (35,254 City 3D Massing outlines): every edge is in exactly one class, and the classes mean what they say', () => {
  const count = { street: 0, party: 0, 'exposed-party': 0, rear: 0, hidden: 0 };
  let irregular = 0;
  for (const r of records) {
    const h = geo.buildings[r.row][4], base = Math.min(r.base, h - 0.5);
    const { edges } = footprintEdges(r.rings[0], r.covered, r.hidden, r.street, WALL.shop, true, base, h);
    assert.equal(edges.length, r.rings[0].length);
    if (r.rings[0].length > 6) irregular++;
    edges.forEach((e, i) => {
      assert.ok(e.cls in count, `${r.id} edge ${i}: ${e.cls}`);
      count[e.cls]++;
      if (e.cls === 'hidden') assert.ok(r.hidden.has(i) && e.kind === -1);
      if (e.cls === 'street') assert.ok(r.street.has(i) && e.street && e.kind !== WALL.lotLine);
      if (e.cls === 'party' || e.cls === 'exposed-party') {
        assert.ok(r.covered.has(i) && e.kind === WALL.lotLine, `${r.id} edge ${i}: a party wall is covered and windowless`);
        assert.ok(e.exposed >= 0 && Math.abs(e.exposed - (h - r.covered.get(i))) < 1e-9 || e.exposed === 0);
        assert.equal(e.cls === 'exposed-party', e.exposed >= 3, `${r.id} edge ${i}: exposed ${e.exposed}`);
      }
      if (e.cls === 'rear') assert.ok(e.kind === WALL.rear || e.kind === WALL.lotLine && e.len < 2 || e.kind === WALL.shop || e.kind === WALL.entry, `${r.id} edge ${i}: rear kind ${e.kind}`);
      assert.ok(Number.isFinite(e.nx) && Number.isFinite(e.nz) && Math.abs(Math.hypot(e.nx, e.nz) - 1) < 1e-6);
    });
  }
  console.log(`# edge classes over ${records.length} footprints (${irregular} with more than 6 corners): ${JSON.stringify(count)}`);
  for (const k of ['street', 'party', 'exposed-party', 'rear']) assert.ok(count[k] > 1000, `${k}: ${count[k]}`);
  assert.ok(irregular > 5000, 'irregular lots are in the sample');
});

// ---- ghost signs -------------------------------------------------------------------------------------------------------------
const ring = [[0, 0], [30, 0], [30, 14], [0, 14]];
const base = { id: 'to-3dmassing-2025:1', ring, top: 14, chance: 1 };

test('ghostKinds: one exposed party wall that is tall and long enough takes a sign, sized by what it can hold', () => {
  const kinds = [WALL.shop, WALL.lotLine, WALL.rear, WALL.rear];
  const wide = [WALL.lotLine, WALL.rear, WALL.rear, WALL.rear];
  const small = FE.ghostKinds({ ...base, kinds: wide, cover: [8, NaN, NaN, NaN] });
  assert.equal(small.edge, 0);
  assert.equal(small.kinds[0], WALL.ghost, '6 m showing: the small panel');
  assert.deepEqual(wide, [WALL.lotLine, WALL.rear, WALL.rear, WALL.rear], 'the input is not touched');
  const large = FE.ghostKinds({ ...base, kinds: wide, cover: [4, NaN, NaN, NaN] });
  assert.equal(large.kinds[0], WALL.ghostLarge, '10 m showing: the large panel');
  assert.equal(FE.ghostKinds({ ...base, kinds: wide, cover: [10.5, NaN, NaN, NaN] }).edge, -1, 'under 4.4 m showing: no panel fits');
  assert.equal(FE.ghostKinds({ ...base, ring: [[0, 0], [9, 0], [9, 14], [0, 14]], kinds: wide, cover: [3, NaN, NaN, NaN] }).edge, -1, 'a 9 m wall is too short for any panel');
  assert.equal(FE.ghostKinds({ ...base, kinds, cover: [NaN, 3, NaN, NaN] }).edge, 1, 'a 14 m wall holds a small one');
  assert.equal(FE.ghostKinds({ ...base, kinds: wide, cover: [NaN, NaN, NaN, NaN] }).edge, -1, 'no neighbour: nothing exposed');
  assert.equal(FE.ghostKinds({ ...base, kinds: [WALL.rear, WALL.rear, WALL.rear, WALL.rear], cover: [3, 3, 3, 3] }).edge, -1, 'only a windowless party wall takes one');
  assert.equal(FE.ghostKinds({ ...base, chance: 0, kinds: wide, cover: [4, NaN, NaN, NaN] }).edge, -1, 'a street that takes none');
});

test('ghostKinds: the choice is the building\'s ID and nothing else, and a degenerate input never throws', () => {
  const wide = [WALL.lotLine, WALL.rear, WALL.rear, WALL.rear], cover = [4, NaN, NaN, NaN];
  let took = 0;
  for (let i = 0; i < 2000; i++) {
    const a = FE.ghostKinds({ ...base, id: `x:${i}`, chance: 0.45, kinds: wide, cover }), b = FE.ghostKinds({ ...base, id: `x:${i}`, chance: 0.45, kinds: wide, cover });
    assert.equal(a.edge, b.edge);
    if (a.edge >= 0) took++;
  }
  assert.ok(took > 800 && took < 1000, `a chance of 0.45 took ${took} of 2000`);
  for (const bad of [{ ring: null }, { kinds: null }, { cover: null }, { top: NaN }, { chance: NaN }, { ring: [] }, { ring: [[NaN, NaN]], kinds: [3], cover: [1] }]) {
    assert.doesNotThrow(() => FE.ghostKinds({ ...base, kinds: wide, cover, ...bad }));
  }
});

test('ghostChanceFor: the older main streets most, nothing for a street no one named', () => {
  for (const n of ['Queen Street West', 'Queen Street East', 'Dundas Street West', 'King Street East', 'Spadina Avenue']) assert.equal(FE.ghostChanceFor(n), FE.GHOST_CHANCE.oldMain, n);
  for (const n of ['Church Street', 'Augusta Avenue']) assert.equal(FE.ghostChanceFor(n), FE.GHOST_CHANCE.oldSide, n);
  for (const n of ['Elm Street', '', null, undefined]) assert.equal(FE.ghostChanceFor(n), FE.GHOST_CHANCE.other, String(n));
  assert.ok(FE.GHOST_CHANCE.oldMain > FE.GHOST_CHANCE.oldSide && FE.GHOST_CHANCE.oldSide > FE.GHOST_CHANCE.other);
});

test('buildCityBlocks on the real footprints: the ghost walls are exposed party walls, one a building, the same every build', { timeout: 180000 }, async () => {
  const build = async (opts) => {
    const w = load(loaded, opts);
    const out = w.CITY.buildCityBlocks(new CORE.Scene());
    await (out.massingReady || Promise.resolve());
    return w.CITY.massingStats;
  };
  const a = await build({ edges: true }), b = await build({ edges: true });
  const off = await build({ edges: true, search: '?ghostsigns=0' }), plain = await build({ edges: false });
  assert.equal(off.ghostSigns, 0, '?ghostsigns=0 leaves them out');
  assert.equal(plain.ghostSigns, 0, 'without the module: none');
  assert.ok(a.ghostSigns > 40 && a.ghostSigns < 400, `${a.ghostSigns} ghost signs`); // (the glass towers' walls take none: only rendered facades carry paint)
  assert.equal(a.ghostWalls.length, a.ghostSigns);
  assert.equal(JSON.stringify(a.ghostWalls), JSON.stringify(b.ghostWalls), 'the same walls every build');
  assert.equal(new Set(a.ghostWalls.map((g) => g.id)).size, a.ghostWalls.length, 'at most one a building');
  for (const g of a.ghostWalls) {
    assert.ok(g.kind === WALL.ghost || g.kind === WALL.ghostLarge);
    assert.ok(g.len >= FE.GHOST_PANEL.small.minLength && g.top >= FE.GHOST_PANEL.small.minExposed, `${g.id}: ${g.len} m long, ${g.top} m high`);
    if (g.kind === WALL.ghostLarge) assert.ok(g.len >= FE.GHOST_PANEL.large.minLength && g.top >= FE.GHOST_PANEL.large.minExposed);
    assert.ok(Math.abs(Math.hypot(g.nx, g.nz) - 1) < 1e-6);
  }
  // the older main streets carry them: Queen West, Spadina and Dundas West each have some
  const near = (x0, z0, r) => a.ghostWalls.filter((g) => Math.hypot(g.x - x0, g.z - z0) < r).length;
  assert.ok(near(-1509, -711, 2500) > 0 && near(-1143, -616, 2500) > 0);
  console.log(`# ghost signs: ${a.ghostSigns} (${a.ghostWalls.filter((g) => g.kind === WALL.ghostLarge).length} large) of ${a.buildings} drawn buildings`);
});

// ---- the face hook -------------------------------------------------------------------------------------------------------------
test('resolveFaceEdge: a record\'s wall point and normal find the polygon edge within 1.5 m and 15 degrees, or none', () => {
  const edges = FE.edgesOfRing(lot, new Set([2]));
  assert.equal(edges.length, 4);
  assert.deepEqual([edges[0].nx, edges[0].nz], [0, -1], 'edge 0 faces -z, out of the lot');
  assert.equal(edges[2].kind, -1);
  // a box face compiled 0.8 m off the real wall, a few degrees turned
  const hit = FE.resolveFaceEdge(edges, { x: 6, z: -0.8, nx: 0.05, nz: -0.9988 });
  assert.equal(hit.index, 0);
  assert.ok(Math.abs(hit.dist - 0.8) < 1e-9 && Math.abs(hit.s - 6) < 1e-9);
  assert.equal(FE.resolveFaceEdge(edges, { x: 6, z: -2, nx: 0, nz: -1 }), null, '2 m off: dropped');
  assert.equal(FE.resolveFaceEdge(edges, { x: 6, z: 0, nx: 0.5, nz: -0.866 }), null, '30 degrees turned: dropped');
  assert.equal(FE.resolveFaceEdge(edges, { x: 6, z: 24, nx: 0, nz: 1 }), null, 'the hidden edge has no wall');
  assert.equal(FE.resolveFaceEdge(edges, { x: NaN, z: 0, nx: 0, nz: -1 }), null);
  assert.equal(FE.resolveFaceEdge(null, { x: 0, z: 0, nx: 0, nz: -1 }), null);
  const placed = FE.placeOnEdge(hit, { x: 6, z: -0.8 }, 20);
  assert.ok(Math.abs(placed.width - 11.7) < 1e-9, 'a board wider than the wall is cut to it');
  assert.deepEqual([placed.nx, placed.nz], [0, -1]);
  assert.ok(Math.abs(placed.z) < 1e-9 && placed.x >= 6 - 1e-9, 'on the wall line');
  const narrow = FE.placeOnEdge(FE.resolveFaceEdge(edges, { x: 1, z: -0.2, nx: 0, nz: -1 }), { x: 1, z: -0.2 }, 4);
  assert.ok(Math.abs(narrow.x - 2.15) < 1e-9, 'a board near the corner stays inside the wall');
});

test('resolveFaceEdge on the real outlines: a face compiled from the box side resolves to the edge it nearly lies on', () => {
  let n = 0, found = 0;
  for (const r of records) {
    if (r.rings[0].length < 4 || r.rings[0].length > 12) continue;
    const edges = FE.edgesOfRing(r.rings[0], r.hidden);
    const long = edges.map((e, i) => [e, i]).filter(([e]) => e.kind >= 0 && e.len >= 6)[0];
    if (!long) continue;
    const [e, i] = long;
    n++;
    // the face as the box side would give it: the edge's middle pushed 0.4 m off along the normal
    const hit = FE.resolveFaceEdge(edges, { x: (e.ax + e.bx) / 2 + e.nx * 0.4, z: (e.az + e.bz) / 2 + e.nz * 0.4, nx: e.nx, nz: e.nz });
    if (hit && hit.index === i) found++;
    if (n >= 4000) break;
  }
  assert.ok(n > 2000 && found / n > 0.97, `${found} of ${n}`);
});
