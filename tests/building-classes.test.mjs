// tools/report-building-classes.mjs (st-ndw9.1, Phase 0a of docs/building-prototypes-spec.md; fix1): the class census
// runs on the committed data, its sums are consistent, the attachment rule reproduces the coordinator's direct count,
// the checks it reports hold, every example carries lat/lon from the frame's own inverse projection, and two runs give
// identical JSON (the seeded examples included). It changes nothing the page loads.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  run, ringArea, perimeter, orientedRect, partySides, sideStyle, groupStyle, pick, rng,
  PARTY_EDGE_MIN_M, SIDE_SAME_DOT, SIDE_MIN_M, SIDE_OPPOSITE_DOT
} from '../tools/report-building-classes.mjs';

const out = await run({ examples: 10 });
const committed = JSON.parse(fs.readFileSync(new URL('../tools/building-classes.json', import.meta.url), 'utf8'));

test('every massing record lands in exactly one class, and the record and group classes both sum to it', () => {
  assert.equal(out.city.records, 35259, 'the detailed city\'s massing records');
  assert.equal(out.checks.classSum.recordSum, out.city.records);
  assert.equal(out.checks.classSum.groupClassSum, out.city.groups.groups, 'group classes count groups');
  assert.equal(out.checks.classSum.groupClassRecords, out.city.records, 'and cover every record');
  assert.equal(out.checks.classSum.everyRecordOnce, true);
  for (const list of [out.classes, out.groupClasses]) {
    const ids = list.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, 'no class id twice');
  }
  const shareSum = out.classes.reduce((s, c) => s + c.share, 0);
  const areaSum = out.classes.reduce((s, c) => s + c.areaShare, 0);
  assert.ok(Math.abs(shareSum - 1) < 1e-3, `record count shares sum to ${shareSum}`);
  assert.ok(Math.abs(areaSum - 1) < 1e-3, `record area shares sum to ${areaSum}`);
  assert.ok(Math.abs(out.groupClasses.reduce((s, c) => s + c.share, 0) - 1) < 1e-3, 'group count shares sum to 1');
});

test('the party sides reproduce the coordinator\'s direct count, and every group style adds up', () => {
  const a = out.checks.attachments;
  // none matches exactly; the rest agree to within 0.5% of the records (a different clustering of the same edges)
  assert.equal(a.sides.none, 21292, 'none, as the coordinator counted');
  assert.equal(a.house.none, 12170, 'house none, as the coordinator counted');
  for (const k of ['none', 'one', 'both', 'corner']) {
    assert.ok(Math.abs(a.sides[k] - a.expected.sides[k]) < 0.001 * out.city.records, `sides ${k}: ${a.sides[k]} vs ${a.expected.sides[k]}`);
    assert.ok(Math.abs(a.house[k] - a.expected.house[k]) < 0.001 * out.city.records, `house ${k}: ${a.house[k]} vs ${a.expected.house[k]}`);
  }
  assert.equal(a.sidesSum, out.city.records);
  assert.equal(a.groupSum, out.city.records);
  assert.equal(a.group.detached, a.sides.none, 'none is detached');
  assert.equal(a.group.rowMiddle, a.sides.both, 'both is row middle');
  assert.equal(a.group.corner, a.sides.corner, 'corner is corner');
  assert.equal(a.group.pair + a.group.rowEnd, a.sides.one, 'one splits into pair and row end');
});

test('the party-wall total is the 66,164 in docs/massing-buildings.md, and every edge finds its neighbour', () => {
  assert.equal(out.checks.partyEdges.computed, 66164);
  assert.equal(out.checks.partyEdges.computed, out.checks.partyEdges.documented, 'the documented total');
  assert.equal(out.checks.partyEdgeNeighbours.edgesResolved, 66164);
  assert.equal(out.checks.partyEdgeNeighbours.edgesUnresolved, 0);
});

test('the joined groups: every record in one group, the group classes fold the towers', () => {
  const sizes = out.city.groups.sizeDistribution;
  const records = Object.entries(sizes).reduce((s, [size, count]) => s + Number(size) * count, 0);
  assert.equal(records, out.city.records, 'the size distribution covers every record');
  const groups = Object.values(sizes).reduce((s, v) => s + v, 0);
  assert.equal(groups, out.city.groups.groups);
  const byKind = Object.values(out.city.groups.byKind).reduce((s, v) => s + v.records, 0);
  assert.equal(byKind, out.city.records, 'the kinds cover every record');
  // towers are many records in few groups: the point of the group table
  assert.ok(out.city.groups.byKind.tower.records > out.city.groups.byKind.tower.groups * 3, 'tower records far outnumber tower groups');
});

test('every example carries lat and lon from the frame projection, and the origin comes out at lat0, lon0', () => {
  assert.equal(out.projection.ok, true, 'the inverse projection gives the frame origin');
  assert.ok(Math.abs(out.projection.origin.lat - 43.6453) < 1e-6 && Math.abs(out.projection.origin.lon + 79.3806) < 1e-6);
  const all = [...out.classes.flatMap((c) => c.examples), ...out.checks.pairNeighbours, ...out.checks.isolatedHouses.examples];
  assert.ok(all.length > 100, 'positive control: examples were found');
  for (const e of all) {
    assert.equal(typeof e.lat, 'number', `${e.id}: lat`);
    assert.equal(typeof e.lon, 'number', `${e.id}: lon`);
    assert.ok(Math.abs(e.lat - 43.6453) < 0.2 && Math.abs(e.lon + 79.3806) < 0.3, `${e.id}: in the frame (${e.lat}, ${e.lon})`);
    assert.equal(e.lat, +e.lat.toFixed(6), `${e.id}: six decimals`);
    assert.equal(e.lon, +e.lon.toFixed(6), `${e.id}: six decimals`);
  }
});

test('the isolated-house measurement reports its numbers and 20 seeded 9 to 12 m examples', () => {
  const ih = out.checks.isolatedHouses;
  assert.equal(ih.records, 12138, 'house records with no party wall');
  assert.ok(ih.shorterMedian > 5 && ih.shorterMedian < 15);
  assert.equal(ih.examples.length, 20);
  for (const e of ih.examples) assert.ok(e.shorter >= 9 && e.shorter < 12, `${e.id}: shorter side ${e.shorter}`);
  assert.equal(ih.shorterHistogram.counts.reduce((s, v) => s + v, 0), ih.records);
  assert.equal(ih.areaHistogram.counts.reduce((s, v) => s + v, 0), ih.records);
});

test('the checks block is consistent, and the seeded examples are stable', () => {
  assert.equal(out.checks.kensington.buildings, 647, 'the pilot\'s Kensington Market');
  assert.equal(Object.values(out.checks.kensington.sides).reduce((s, v) => s + v, 0), 647);
  assert.equal(out.checks.pairNeighbours.length, 20, 'the twenty seeded pairs');
  for (const p of out.checks.pairNeighbours) {
    assert.equal(p.group, 2, `${p.id}: a joined group of 2`);
    assert.equal(p.neighbours.length, 1, `${p.id}: one neighbour`);
  }
  const th = out.checks.outbuildingThresholds;
  assert.ok(th['area+20%'].count >= th.base.count && th['area-20%'].count <= th.base.count);
  assert.ok(th['height+20%'].count >= th.base.count && th['height-20%'].count <= th.base.count);
  // examples are seeded: pick and rng are deterministic
  assert.deepEqual(pick([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, 7), pick([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, 7));
  const a = rng(123), b = rng(123);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
  assert.equal(JSON.stringify(out), JSON.stringify(committed), 'tools/building-classes.json matches a fresh run');
});

test('a second run in this process gives the same bytes as the committed file', async () => {
  const again = await run({ examples: 10 });
  assert.equal(JSON.stringify(again), JSON.stringify(out));
  assert.equal(fs.readFileSync(new URL('../tools/building-classes.json', import.meta.url), 'utf8'), JSON.stringify(out, null, 2) + '\n');
});

test('the geometry helpers agree with hand arithmetic', () => {
  const square = [[0, 0], [4, 0], [4, 3], [0, 3]];
  assert.equal(ringArea(square), 12);
  assert.equal(perimeter(square), 14);
  const r = orientedRect(square);
  assert.deepEqual([r.w, r.d].sort((a, b) => a - b), [3, 4], 'every square edge gives the same-area rectangle');
  // a party edge on the square's east side (edge 1, corner (4,0)->(4,3)) faces +x; 3 m of it is exactly SIDE_MIN_M
  const p = partySides(square, new Map([[1, 10]]));
  assert.equal(p.sides.length, 1);
  assert.ok(Math.abs(p.sides[0].nx - 1) < 1e-9 && Math.abs(p.sides[0].nz) < 1e-9);
  assert.equal(p.sides[0].len, 3);
  assert.equal(sideStyle(p), 'one');
  // opposite sides are two sides, and opposite (dot -1 under SIDE_OPPOSITE_DOT): both
  assert.equal(sideStyle(partySides(square, new Map([[1, 10], [3, 10]]))), 'both');
  // two perpendicular sides are a corner
  assert.equal(sideStyle(partySides(square, new Map([[1, 10], [0, 10]]))), 'corner');
  // a sliver under PARTY_EDGE_MIN_M is no side, and a 1 m side under SIDE_MIN_M is not kept
  const short = [[0, 0], [1, 0], [1, 0.5], [0, 0.5]];
  assert.equal(sideStyle(partySides(short, new Map([[1, 10]]))), 'none');
  const thin = [[0, 0], [4, 0], [4, 1], [0, 1]];
  assert.equal(sideStyle(partySides(thin, new Map([[1, 10]]))), 'none', 'a 1 m side is under SIDE_MIN_M');
  assert.equal(groupStyle('one', { size: 2 }), 'pair');
  assert.equal(groupStyle('one', { size: 5 }), 'rowEnd');
  assert.equal(groupStyle('none', { size: 1 }), 'detached');
  assert.equal(groupStyle('both', { size: 9 }), 'rowMiddle');
  // the thresholds the fix note named
  assert.equal(PARTY_EDGE_MIN_M, 1.5);
  assert.equal(SIDE_SAME_DOT, 0.8);
  assert.equal(SIDE_MIN_M, 3);
  assert.equal(SIDE_OPPOSITE_DOT, -0.7);
});
