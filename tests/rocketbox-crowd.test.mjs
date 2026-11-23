// Who is which Rocketbox person, and who is drawn near the camera (js/rocketbox-pedestrians.js, st-8p1p.3)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';

globalThis.window = { CITY: { THREE } };
(0, eval)(fs.readFileSync(new URL('../js/rocketbox-pedestrians.js', import.meta.url), 'utf8'));
const { assignIdentities, selectNear, dodgeTwin, ALL_IDS, CIVILIANS, COP } = window.CITY.rocketboxCrowd;

const crowd = (n, femaleShare = 0.48) => Array.from({ length: n }, (_, i) => ({ id: i, female: ((i * 0.6180339) % 1) < femaleShare }));

test('every id is a file in assets/people/rocketbox', () => {
  assert.equal(CIVILIANS.male.length, 10);
  assert.equal(CIVILIANS.female.length, 8);
  assert.equal(ALL_IDS.length, 19);
  assert.equal(new Set(ALL_IDS).size, 19);
  for (const id of ALL_IDS) assert.ok(fs.existsSync(new URL(`../assets/people/rocketbox/${id}_lod2.glb`, import.meta.url)), id);
});

test('js/pedestrians.js dresses the far body from a table in the same person order', () => {
  const text = fs.readFileSync(new URL('../js/pedestrians.js', import.meta.url), 'utf8');
  const block = text.match(/const PERSON_LOOKS = \{.*?\n\};/s)[0];
  const ids = JSON.parse(block.match(/const PERSON_LOOKS = \{\s*ids: (\[.*?\])/s)[1]);
  assert.deepEqual(ids, ALL_IDS);
  for (const key of ['coat', 'legs', 'skin', 'hair', 'shoes', 'hairLength', 'dress', 'tailored']) {
    const row = block.match(new RegExp(`${key}: \\[(.*?)\\]`))[1].split(',');
    assert.equal(row.length, ALL_IDS.length, key);
  }
});

test('identities are stable: the same walker is the same person whatever order the list comes in', () => {
  const walkers = crowd(340);
  const a = assignIdentities(walkers);
  const b = assignIdentities([...walkers].reverse());
  const c = assignIdentities([...walkers].sort((x, y) => (x.id * 7919) % 340 - (y.id * 7919) % 340));
  for (const w of walkers) { assert.equal(a.get(w.id), b.get(w.id)); assert.equal(a.get(w.id), c.get(w.id)); }
});

test('civilians match the walker\'s gender and spread evenly over the ten men and the eight women', () => {
  const walkers = crowd(340);
  const ids = assignIdentities(walkers);
  const counts = new Map();
  for (const w of walkers) {
    const id = ids.get(w.id);
    if (id === COP) { assert.ok(!w.female); continue; }
    assert.ok(CIVILIANS[w.female ? 'female' : 'male'].includes(id));
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  for (const g of ['male', 'female']) {
    const c = CIVILIANS[g].map((id) => counts.get(id));
    assert.ok(Math.max(...c) - Math.min(...c) <= 1, `${g}: ${c}`);
  }
  assert.equal(counts.size, 18);
});

test('the person is dealt by a hash of the id, not by a cycle over the index', () => {
  const walkers = crowd(340).map((w) => ({ ...w, female: false })); // all men: the cycle would give 0,1,2,...,9,0,...
  const ids = assignIdentities(walkers, 0);
  let same = 0, cycle = 0;
  for (let i = 1; i < 340; i++) {
    if (ids.get(i) === ids.get(i - 1)) same++;
    if (ids.get(i) === CIVILIANS.male[i % 10]) cycle++;
  }
  // neighbours are the same person about one time in ten (an index cycle never would), and no run follows the cycle
  assert.ok(same > 340 * 0.04 && same < 340 * 0.2, `neighbours alike: ${same}`);
  assert.ok(cycle < 340 * 0.2, `follows the index cycle: ${cycle}`);
});

test('about one walker in a hundred is the cop, whatever the crowd size', () => {
  for (const n of [140, 220, 340, 1000]) {
    const cops = [...assignIdentities(crowd(n)).values()].filter((id) => id === COP).length;
    assert.ok(Math.abs(cops - n / 100) <= 1, `${n}: ${cops}`);
  }
  assert.equal([...assignIdentities(crowd(50).map((w) => ({ ...w, female: true }))).values()].filter((id) => id === COP).length, 0);
});

const cand = (key, dist, active = false, ok = true) => ({ key, dist, active, ok });

test('hysteresis: on inside the switch distance, off only past 1.2x', () => {
  assert.deepEqual([...selectNear([cand('a', 36)], 35, 42, 24)], []);
  assert.deepEqual([...selectNear([cand('a', 34)], 35, 42, 24)], ['a']);
  assert.deepEqual([...selectNear([cand('a', 38, true)], 35, 42, 24)], ['a']);
  assert.deepEqual([...selectNear([cand('a', 38, false)], 35, 42, 24)], []);
  assert.deepEqual([...selectNear([cand('a', 43, true)], 35, 42, 24)], []);
});

test('a walker whose file is not loaded is not chosen and takes no place', () => {
  const s = selectNear([cand('a', 5, false, false), cand('b', 20), cand('c', 30)], 35, 42, 2);
  assert.deepEqual([...s].sort(), ['b', 'c']);
});

test('the cap takes the nearest, and keeps walkers already drawn over a slightly nearer newcomer', () => {
  const cands = [cand('n1', 3), cand('n2', 6), cand('n3', 9), cand('n4', 12)];
  assert.deepEqual([...selectNear(cands, 35, 42, 2)].sort(), ['n1', 'n2']);
  // b and c are drawn; the newcomer a is nearer than both and the cap is 2: nobody swaps
  const kept = selectNear([cand('a', 10), cand('b', 20, true), cand('c', 25, true)], 35, 42, 2);
  assert.deepEqual([...kept].sort(), ['b', 'c']);
  // but a drawn walker in the band between on and off gives way to a newcomer
  const gives = selectNear([cand('a', 10), cand('b', 20, true), cand('c', 38, true)], 35, 42, 2);
  assert.deepEqual([...gives].sort(), ['a', 'b']);
});

test('a walker walking past the boundary does not flicker', () => {
  let active = false;
  const flips = [];
  for (let d = 50; d >= 20; d -= 0.5) {
    const now = selectNear([cand('w', d, active)], 35, 42, 24).has('w');
    if (now !== active) flips.push(d);
    active = now;
  }
  for (let d = 20; d <= 50; d += 0.5) {
    const now = selectNear([cand('w', d, active)], 35, 42, 24).has('w');
    if (now !== active) flips.push(d);
    active = now;
  }
  assert.deepEqual(flips, [34.5, 42]);
});

test('a walker about to be shown beside its own twin becomes somebody else of its gender; otherwise it is left alone', () => {
  const man = CIVILIANS.male[3], woman = CIVILIANS.female[2];
  assert.equal(dodgeTwin(man, false, [], 0.5), man);
  assert.equal(dodgeTwin(man, false, [CIVILIANS.male[0], woman], 0.5), man);
  for (const r of [0, 0.3, 0.99]) {
    const other = dodgeTwin(man, false, [man, CIVILIANS.male[0]], r);
    assert.ok(CIVILIANS.male.includes(other) && other !== man && other !== CIVILIANS.male[0], `man ${r}: ${other}`);
    const her = dodgeTwin(woman, true, [woman], r);
    assert.ok(CIVILIANS.female.includes(her) && her !== woman, `woman ${r}: ${her}`);
  }
  assert.equal(dodgeTwin(COP, false, [COP], 0.5), COP);
  assert.equal(dodgeTwin(man, false, CIVILIANS.male, 0.5), man); // everybody of its gender is already beside it
});

test('dodging twins as walkers are first shown brings side-by-side twins well below the plain rate', () => {
  // walkers in a row 3 m apart, shown one after another; "beside" is within 6 m (the two before)
  const walkers = crowd(2000).map((w) => ({ ...w, female: false }));
  const ids = assignIdentities(walkers, 0);
  const plain = [], dodged = [];
  walkers.forEach((w, i) => {
    plain.push(ids.get(w.id));
    dodged.push(dodgeTwin(ids.get(w.id), false, dodged.slice(Math.max(0, i - 2)), (i * 0.754877) % 1));
  });
  const twins = (a) => a.filter((id, i) => i > 0 && (id === a[i - 1] || (i > 1 && id === a[i - 2]))).length;
  assert.ok(twins(dodged) === 0, `after: ${twins(dodged)}`);
  assert.ok(twins(plain) > 200, `before: ${twins(plain)}`);
});
