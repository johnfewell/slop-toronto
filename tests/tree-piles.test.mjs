// The City's piled street trees (st-unco, tools/geo-tree-piles.mjs): the inventory geocodes many trees to one address
// point (519 at High Park's Bloor gate, 254 in Marilyn Bell Park); the build spreads each pile along its own frontage or
// leaves out what it cannot hold, and High Park's lidar stands for the piles on its islands (park-woods.js keeps
// one of each). No point in the city draws more than MAX_PER_POINT trees.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { spreadPiles, streetStem } from '../tools/geo-tree-piles.mjs';

const MAX_PER_POINT = 1; // City trees on one 0.1 m point, off High Park's islands
const MAX_HIGH_PARK = 2; // on them, once park-woods.js has kept one of each of its piles (3 or more)

const read = (f) => fs.readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8');
function city() {
  const context = vm.createContext({ window: { CITY: {} }, addEventListener() {}, document: { addEventListener() {}, hidden: false },
    console: { info() {}, warn() {}, log() {} }, atob });
  for (const f of ['toronto-geodata', 'toronto-subway', 'toronto-subway-topology', 'high-park-data', 'don-valley', 'city-config', 'high-park-woods-data', 'toronto-island-woods-data', 'park-woods']) vm.runInContext(read(f), context);
  return context.window.CITY;
}
const key = (x, z) => `${x.toFixed(1)},${z.toFixed(1)}`;
const perPoint = (sites) => {
  const n = new Map();
  for (const t of sites) n.set(key(t.x, t.z), (n.get(key(t.x, t.z)) || 0) + 1);
  return n;
};

test(`no point off High Park's islands holds more than ${MAX_PER_POINT} City tree, nor on them more than ${MAX_HIGH_PARK} once the woods keep one of each pile`, () => {
  const C = city(), W = C.parkWoods, ST = C.GEO.streetTrees;
  const onPark = (x, z) => { const b = C.blockAt(x, z); return !!(b && W.replacesBlock(b)); };
  const sites = [];
  for (let i = 0; i < ST.length; i += 4) sites.push({ x: ST[i], z: ST[i + 1], tier: 1 });
  const before = perPoint(sites);
  const over = [...before].filter(([k, n]) => n > MAX_PER_POINT && !onPark(...k.split(',').map(Number)));
  assert.deepEqual(over.slice(0, 10), [], `${over.length} points off High Park's islands with more than ${MAX_PER_POINT} trees`);
  W.dropPiledCityTrees(sites);
  const worst = Math.max(...perPoint(sites).values());
  assert.ok(worst <= MAX_HIGH_PARK, `a point keeps ${worst} City trees in High Park`);
  // (the inventory has about 57,000 trees in the detailed city: a few thousand piled ones are left out, no more)
  assert.ok(ST.length / 4 > 54000 && ST.length / 4 < 57120, `${ST.length / 4} City trees`);
});

test('the worst piles are spread over their own island\'s frontage, not left out wholesale', () => {
  const C = city(), ST = C.GEO.streetTrees;
  // [x, z, trees the inventory piles there]: Marilyn Bell Park, Sir Casimir Gzowski Park, Moss Park, Dufferin Grove,
  // Christie Pits, 571 Dundas Street West
  const piles = [[-4385.5, 298.9, 254], [-7004.7, -906.3, 144], [1108.9, -839.1, 100], [-3725.9, -2471.1, 92], [-2468.5, -2840.8, 91], [-1313.3, -1198.9, 42]];
  for (const [px, pz, n] of piles) {
    const island = C.blockAt(px, pz);
    let at = 0, around = 0;
    for (let i = 0; i < ST.length; i += 4) {
      const x = ST[i], z = ST[i + 1], d = Math.hypot(x - px, z - pz);
      if (d < 0.05) at++;
      else if (d <= 100 && C.blockAt(x, z) === island) around++;
    }
    assert.ok(at <= MAX_PER_POINT, `${at} trees still on the point at ${px}, ${pz}`);
    assert.ok(around >= 20 && around < n + 200, `${around} trees on the island within 100 m of ${px}, ${pz} (${n} piled there)`);
  }
});

// a city of one 100 x 60 m island (curb at its edge), a building in it, a pond and a street along its north side
function toyCity() {
  const lab = (x, z) => (x > 0 && x < 100 && z > 0 && z < 60 ? 7 : 0);
  const block = { _lab: 7, poly: [[0, 0], [100, 0], [100, 60], [0, 60]], parkName: '' };
  const hp = { _lab: 9, poly: [[200, 0], [260, 0], [260, 60], [200, 60]], parkName: 'High Park' };
  const labelAt = (x, z) => (x > 200 && x < 260 && z > 0 && z < 60 ? 9 : lab(x, z));
  return {
    labelAt,
    blockAt: (x, z) => ({ 7: block, 9: hp })[labelAt(x, z)] || null,
    buildingNear: (x, z, r) => x > 40 - r && x < 60 + r && z > 0 - r && z < 20 + r,
    isWater: (x, z) => Math.hypot(x - 80, z - 55) < 6,
    streetAt: (x, z) => (z < 30 ? 'Queen Street West' : 'Bathurst Street')
  };
}

test('spreadPiles: a pile goes along its own street\'s frontage, GAP apart, clear of the building and the pond; the rest are left out', () => {
  const C = toyCity();
  const trees = [{ x: 30, z: 10, street: 'Seaton Way', pos: 1 }];
  for (let i = 0; i < 40; i++) trees.push({ x: 50, z: 10, street: 'QUEEN ST W', pos: 10 * (i + 1) }); // (in the building)
  for (let i = 0; i < 3; i++) trees.push({ x: 230, z: 30, street: 'PARKSIDE DR', pos: 9999 });
  const { kept, stats } = spreadPiles(trees, C, { REACH: 60 });
  assert.equal(stats.piles, 2);
  assert.equal(stats.left, 1); // (High Park's)
  assert.equal(kept.filter((t) => t.x === 230 && t.z === 30).length, 3);
  const spread = kept.filter((t) => t.street === 'QUEEN ST W');
  assert.ok(spread.length >= 8 && spread.length < 40, `${spread.length} kept`);
  assert.equal(stats.moved + stats.stayed, spread.length);
  assert.equal(stats.dropped, 40 - spread.length);
  const all = kept.filter((t) => t.x < 150);
  for (const t of spread) {
    assert.equal(C.blockAt(t.x, t.z)?._lab, 7);
    assert.ok(!C.buildingNear(t.x, t.z, 1.5) && !C.isWater(t.x, t.z), `${t.x}, ${t.z}`);
    const edge = Math.min(t.x, 100 - t.x, t.z, 60 - t.z);
    assert.ok(edge >= 1.5 && edge <= 3.5, `${edge} m from the curb`);
    for (const o of all) if (o !== t) assert.ok(Math.hypot(o.x - t.x, o.z - t.z) >= 7 - 1e-9);
  }
  // (Queen Street's frontage, the island's south side by the point, fills before Bathurst's: no spot on its boulevard is
  // left that a tree could take)
  assert.ok(spread.some((t) => t.z > 30));
  for (let x = 3; x <= 97; x++) {
    if (C.buildingNear(x, 3, 1.5) || Math.hypot(x - 50, 3 - 10) > 60) continue;
    assert.ok(all.some((t) => Math.hypot(t.x - x, t.z - 3) < 7), `a free spot on Queen at ${x}, 3`);
  }
  // reproducible
  const again = [{ x: 30, z: 10, street: 'Seaton Way', pos: 1 }];
  for (let i = 0; i < 40; i++) again.push({ x: 50, z: 10, street: 'QUEEN ST W', pos: 10 * (i + 1) });
  assert.deepEqual(spreadPiles(again, C, { REACH: 60 }).kept.map((t) => [t.x, t.z, t.pos]), kept.filter((t) => t.x < 150).map((t) => [t.x, t.z, t.pos]));
});

test('streetStem: the inventory\'s street names and OpenStreetMap\'s compare by the words before the type', () => {
  assert.equal(streetStem('LAKE SHORE BLVD W'), streetStem('Lake Shore Boulevard West'));
  assert.equal(streetStem('BAYVIEW AVE TO, EY, NY'), streetStem('Bayview Avenue'));
  assert.equal(streetStem('ST JAMES AVE'), streetStem('St. James Avenue'));
  assert.notEqual(streetStem('QUEENS QUAY W'), streetStem('Queen Street West'));
});
