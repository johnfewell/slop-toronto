import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const config = fs.readFileSync(new URL('../js/city-config.js', import.meta.url), 'utf8');
function fn(name) {
  const start = config.indexOf(`function ${name}(`);
  const end = config.indexOf('\n}', start) + 2;
  return config.slice(start, end);
}
function fixture() {
  const C = {
    waterfrontPublicRealmEnabled: true,
    WATERFRONT_WAVEDECKS: [{ id: 'fixture', plan: [] }],
    waterfrontDeckSpanAt: (_, x) => x >= 10 && x <= 20 ? [30, 40] : null,
    waterfrontDeckSurfaceHeight: () => 1.2
  };
  const ctx = vm.createContext({ window: { CITY: C }, DECK_GRID: new Map(), DECK_CELL: 8, DV: null, WAVEDECK_BOXES: new WeakMap() });
  vm.runInContext(['waveDeckBox', 'waterfrontDeckAt', 'deckStoodOn', 'deckHeightAt', 'onDeckRun'].map(fn).join('\n'), ctx);
  return { C, ctx };
}
test('waterfront footing requires enabled geometry, exact footprint and reachable surface', () => {
  const { C, ctx } = fixture();
  assert.equal(ctx.deckHeightAt(15, 35, 0), 0);
  assert.equal(ctx.deckHeightAt(15, 35, 0.8), 1.2);
  assert.equal(ctx.deckHeightAt(9, 35, 1.2), 0);
  assert.equal(ctx.deckHeightAt(15, 41, 1.2), 0);
  assert.equal(ctx.deckStoodOn(15, 35, 4), null);
  assert.equal(ctx.deckStoodOn(15, 35, 1.2).deck.pedestrianOnly, true);
  C.waterfrontPublicRealmEnabled = false;
  assert.equal(ctx.deckHeightAt(15, 35, 1.2), 0);
  assert.equal(ctx.deckStoodOn(15, 35, 1.2), null);
});
test('a higher reachable road deck retains precedence', () => {
  const { ctx } = fixture();
  const deck = { rank: 9, pts: [{ x: 10, z: 35 }, { x: 20, z: 35 }], ws: [8, 8] };
  ctx.DECK_GRID.set(100004, [{ h: 1.5, deck }]);
  assert.equal(ctx.deckHeightAt(15, 35, 1.2), 1.5);
  assert.equal(ctx.deckStoodOn(15, 35, 1.2).deck.rank, 9);
});
test('concert footing is queried dynamically with reach limits and remains separate from the WaveDeck gate', () => {
  const { C, ctx } = fixture();
  C.waterfrontPublicRealmEnabled = false;
  let enabled = true;
  C.concertStageSurfaceAt = (x, z, { baseY, maxRise }) => {
    const h = (x - 10) * 0.2;
    return enabled && x >= 10 && x <= 16 && z >= 30 && z <= 34 && h <= baseY + maxRise ? { h } : null;
  };
  assert.equal(ctx.deckHeightAt(11, 32, 0), 0.2);
  assert.equal(ctx.deckHeightAt(16, 32, 0), 0, 'cannot teleport up to the raised deck');
  assert.ok(Math.abs(ctx.deckHeightAt(16, 32, 0.8) - 1.2) < 1e-9);
  assert.equal(ctx.deckHeightAt(16, 35, 1.2), 0, 'no footing outside the exact route');
  assert.equal(ctx.deckStoodOn(16, 32, 1.2).deck.waterfrontId, 'concert-stage');
  enabled = false;
  assert.equal(ctx.deckHeightAt(16, 32, 1.2), 0, 'no invisible surface after builder disables');
});
test('pedestrian waterfront decks exempt walkers from water but never cars', () => {
  const src = fs.readFileSync(new URL('../js/controllers.js', import.meta.url), 'utf8');
  const start = src.indexOf('const inWater =');
  const end = src.indexOf('\n};', start) + 3;
  let entry = { deck: { pedestrianOnly: true } };
  const ctx = vm.createContext({ waterAt: () => true, onDeckOverWater: () => false,
    window: { CITY: { deckStoodOn: () => entry } } });
  vm.runInContext(src.slice(start, end) + '\nglobalThis.checkWater = inWater;', ctx);
  assert.equal(ctx.checkWater(0, 0, 'pedestrian', 1), false);
  assert.equal(ctx.checkWater(0, 0, 'cyclist', 1), false);
  assert.equal(ctx.checkWater(0, 0, 'car', 1), true);
  entry = { deck: { rank: 9 } };
  assert.equal(ctx.checkWater(0, 0, 'car', 1), false);
  entry = null;
  assert.equal(ctx.checkWater(0, 0, 'pedestrian', 1), true);
});

test('a low rendered waterfront surface replaces the coarse curb, while road decks retain precedence', () => {
  const source = fs.readFileSync(new URL('../js/controllers.js', import.meta.url), 'utf8');
  const start = source.indexOf('  getGroundHeight(');
  const end = source.indexOf('\n  }', start) + 4;
  let height = 0.16;
  let entry = { h: height, deck: { pedestrianOnly: true, waterfrontId: 'hto-boardwalk' } };
  const ctx = vm.createContext({ window: { CITY: { waterfrontDeckAt: () => entry } },
    CITY_BOUNDS: { sidewalkHeight: 0.22 }, terrainHeightAt: () => 0,
    deckHeightAt: () => height });
  vm.runInContext('globalThis.Subject = class { isPointOnSidewalk() { return true; }' + source.slice(start, end) + '}', ctx);
  const subject = new ctx.Subject();
  assert.equal(subject.getGroundHeight(1, 2, 'person', 0.16), 0.16);
  assert.equal(subject.getGroundHeight(1, 2, 'cyclist', 0.16), 0.16);
  height = 1.5;
  entry = { h: 1.5, deck: { rank: 9 } };
  assert.equal(subject.getGroundHeight(1, 2, 'person', 1.5), 1.5);
  height = 0;
  entry = null;
  assert.equal(subject.getGroundHeight(1, 2, 'person', 0.22), 0.22);
});


test('built island verge ramps replace coarse curb height for ground travel while higher decks win', () => {
  const source = fs.readFileSync(new URL('../js/controllers.js', import.meta.url), 'utf8');
  const start = source.indexOf('  getGroundHeight(');
  const end = source.indexOf('\n  }', start) + 4;
  let surface = { h: 0.07 }, deck = 0;
  const ctx = vm.createContext({ window: { CITY: { islandVergeSurfaceAt: () => surface } },
    CITY_BOUNDS: { sidewalkHeight: 0.22 }, terrainHeightAt: () => 0,
    deckHeightAt: () => deck });
  vm.runInContext('globalThis.Subject = class { isPointOnSidewalk() { return true; }' + source.slice(start, end) + '}', ctx);
  const subject = new ctx.Subject();
  for (const mode of ['person', 'cyclist', 'car']) assert.equal(subject.getGroundHeight(1, 2, mode, 0.07), 0.07);
  deck = 5;
  assert.equal(subject.getGroundHeight(1, 2, 'person', 5), 5);
  deck = 0;
  surface = null;
  assert.equal(subject.getGroundHeight(1, 2, 'person', 0.22), 0.22);
  surface = { h: NaN };
  assert.equal(subject.getGroundHeight(1, 2, 'person', 0.22), 0.22);
});
