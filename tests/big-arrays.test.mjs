// Map-sized lists are appended one at a time (st-6m6l). `list.push(...items)` passes every item as an argument, and V8
// runs out of call stack somewhere above 100,000 of them: a frame reaching Eglinton has ~200,000 tree sites, the whole
// City ~300,000 pole colliders, and the page stopped loading with "Maximum call stack size exceeded"
// (docs/map-scale-measurements.md). The tree lists and the colliders grow with the map; these keep them spread-free.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const BIG = 300000; // the City frame's pole colliders; Eglinton's tree sites are ~200,000
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('the hazard is real here: spreading a map-sized list into push() overflows the stack', () => {
  assert.throws(() => [].push(...new Array(BIG).fill(0)), RangeError);
});

test('park-woods.js keeps and replaces a map-sized list of tree sites without a spread', () => {
  const context = vm.createContext({ window: { CITY: {} }, addEventListener() {}, document: { addEventListener() {}, hidden: false },
    console: { info() {}, warn() {}, log() {} }, atob });
  for (const f of ['toronto-geodata', 'toronto-subway', 'toronto-subway-topology', 'high-park-data', 'don-valley', 'city-config',
    'high-park-woods-data', 'toronto-island-woods-data', 'park-woods']) vm.runInContext(read(`js/${f}.js`), context);
  const W = context.window.CITY.parkWoods;
  // City trees (tier 1) and invented ones (tier 0) far east of every park the woods cover: none of them is touched
  const sites = Array.from({ length: BIG }, (_, i) => ({ x: 3000 + (i % 500) * 0.4, z: -2500 + Math.floor(i / 500) * 0.4, tier: i % 2 }));
  assert.equal(W.dropPiledCityTrees(sites), 0);
  assert.equal(sites.length, BIG);
  const list = sites.slice();
  W.replaceTrees(list, 0.22);
  assert.equal(list.length, BIG + W.trees(0.22).length, 'every site kept, the parks\' lidar crowns added');
});

test('the runtime appends its tree lists, colliders and route points one at a time', () => {
  // (the lists in these files grow with the map; short fixed tuples elsewhere may still be spread)
  for (const f of ['js/main.js', 'js/park-woods.js', 'js/street-details.js', 'js/navigation.js']) {
    const lines = read(f).split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /\.push\(\s*\.\.\./.test(l) && !/^\s*\/\//.test(l));
    assert.deepEqual(lines, [], `${f}: push(...) at ${lines.map(([n]) => n).join(', ')}`);
  }
});
