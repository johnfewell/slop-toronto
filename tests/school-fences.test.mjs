// The schoolyard fences (docs/school-fences.md, st-ndw9.14): the rules on small hand-made grounds (the front stays open,
// a wall on the boundary removes the fence, a crossing road makes a gap, a mapped fence is kept), the committed data and
// its pin, and that the layer loads on every desktop (?schoolFences=0 and the phone tier get none of it). None of it needs the shared Toronto data repo:
// the committed file is read here and the hand-made grounds are written here.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { RULES, planFenceRuns, simplifyOpen, simplifyRing, quantile, ringPerimeter, pointInRing } from '../tools/school-fences-lib.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const DATA_FILE = 'js/school-fences-data.js';
const PIN_FILE = 'data/shared-toronto-data-pin.json';

function loadData() {
  const ctx = { window: { CITY: {} }, console: { info() {} } };
  vm.createContext(ctx);
  vm.runInContext(read(DATA_FILE), ctx);
  return ctx.window.CITY.SCHOOL_FENCES;
}
const data = loadData();
const pin = JSON.parse(read(PIN_FILE)).datasets['school-grounds/1'];

// A 100 x 100 m square grounds; the main building near the bottom edge; the street below it.
const SQUARE = [[0, 0], [100, 0], [100, 100], [0, 100]];
const BASE = { building: { x: 50, z: 20, width: 30 }, street: { x: 50, z: -50 } };
const frontBand = (x, z) => z > 0 && z < 20 && Math.abs(x - 50) <= 19;

test('the front stays open: the boundary across the main building\'s street side is not fenced', () => {
  const plan = planFenceRuns(SQUARE, BASE);
  assert.equal(plan.runs.length, 1, 'a square with one opening is one run');
  assert.ok(plan.openingWidthsM.length >= 1);
  const opening = plan.openingWidthsM.reduce((a, b) => a + b, 0);
  assert.ok(opening > 34 && opening < 42, `${opening} m opening`);
  // (no kept point lies along the bottom edge in the front band)
  for (const run of plan.runs) for (const [x, z] of run) assert.ok(!frontBand(x, z) || Math.abs(z) > 1, `fence at ${x}, ${z}`);
  // (the opening is the only removal: the fence is the rest of the perimeter)
  assert.ok(Math.abs(plan.metres - (ringPerimeter(SQUARE) - opening)) < 6, `${plan.metres} m fenced`);
  assert.ok(plan.removedM.front > 0);
});

test('the front opening is bounded by the building\'s street frontage, not its whole mass', () => {
  // (a 40 m frontage across the way to the street: the opening is the frontage plus the 4 m margins, ~48 m)
  const frontage = { x: 50, z: 20, ux: 0, uz: -1, px: 1, pz: 0, minP: -20, maxP: 20, len: 40 };
  const plan = planFenceRuns(SQUARE, { frontage, street: { x: 50, z: -50 } });
  const opening = plan.openingWidthsM.reduce((a, b) => a + b, 0);
  assert.ok(opening > 44 && opening < 52, `${opening} m for a 40 m frontage`);
  // (a narrow 10 m frontage opens a narrow stretch)
  const narrow = planFenceRuns(SQUARE, { frontage: { x: 50, z: 20, ux: 0, uz: -1, px: 1, pz: 0, minP: -5, maxP: 5, len: 10 }, street: { x: 50, z: -50 } });
  const o2 = narrow.openingWidthsM.reduce((a, b) => a + b, 0);
  assert.ok(o2 > 14 && o2 < 22, `${o2} m for a 10 m frontage`);
  // (the fallback, centred on the building's width, still works when no frontage is known)
  const fallback = planFenceRuns(SQUARE, BASE);
  assert.ok(fallback.openingWidthsM.reduce((a, b) => a + b, 0) > 34 && fallback.openingWidthsM.reduce((a, b) => a + b, 0) < 42);
});

test('a wall on the boundary removes the fence', () => {
  const plan = planFenceRuns(SQUARE, { ...BASE, nearWall: (x, z) => z > 99.5 });
  assert.ok(plan.removedM.wall > 90, `${plan.removedM.wall} m removed by the wall`);
  for (const run of plan.runs) for (const [x, z] of run) assert.ok(z < 99.5, `fence on the wall at ${x}, ${z}`);
  assert.ok(plan.metres < planFenceRuns(SQUARE, BASE).metres - 90);
});

test('the front opening is trimmed to the frontage plus the two margins (fix 1)', () => {
  // (a 200 m street side with only a 100 m frontage: the opening is capped at 100 + 8 m, not the whole side)
  const ring = [[0, 0], [200, 0], [200, 60], [0, 60]];
  const frontage = { x: 100, z: 30, ux: 0, uz: -1, px: 1, pz: 0, minP: -50, maxP: 50, len: 100 };
  const plan = planFenceRuns(ring, { frontage, street: { x: 100, z: -50 }, frontageM: 100 });
  const opening = plan.openingWidthsM.reduce((a, b) => a + b, 0);
  assert.ok(opening <= 108.6, `${opening} m capped at 108`);
  assert.ok(opening > 100, `${opening} m`);
});

test('a road crossing the boundary makes a gap a little wider than the road', () => {
  // (a road 8 m wide crossing the right edge at z = 60, only there)
  const line = { ax: 100, az: 60, bx: 110, bz: 60, width: 8 };
  const plan = planFenceRuns(SQUARE, { ...BASE, crossings: [line] });
  assert.ok(plan.removedM.cross > 10 && plan.removedM.cross < 13, `${plan.removedM.cross} m gap`);
  for (const run of plan.runs) for (const [x, z] of run) assert.ok(Math.abs(x - 100) > 0.5 || Math.abs(z - 60) > 5.5, `fence in the gap at ${x}, ${z}`);
  // (a road that only runs alongside the boundary makes no gap)
  const beside = planFenceRuns(SQUARE, { ...BASE, crossings: [{ ax: 101, az: 0, bx: 101, bz: 100, width: 8 }] });
  assert.ok(Math.abs(beside.metres - planFenceRuns(SQUARE, BASE).metres) < 0.01);
});

test('where OpenStreetMap maps a fence on the boundary it is kept, even across the front opening', () => {
  const mapped = [];
  for (let x = 40; x < 60; x += 2) mapped.push({ ax: x, az: 0, bx: x + 2, bz: 0 });
  const plan = planFenceRuns(SQUARE, { ...BASE, fenceSegments: mapped });
  assert.ok(plan.mappedKeptM > 15, `${plan.mappedKeptM} m mapped`);
  assert.ok(plan.metres > ringPerimeter(SQUARE) - 20, `${plan.metres} m fenced`);
  assert.ok(plan.runs.some((run) => run.some(([x, z]) => frontBand(x, z) || Math.abs(z) < 1)), 'the mapped fence across the front is drawn');
});

test('runs shorter than 3 m are dropped, and the outline is simplified first', () => {
  // (a ring with a 2 m stub: the stub cannot survive the 3 m minimum once it is a run of its own)
  const plan = planFenceRuns([[0, 0], [100, 0], [100, 100], [0, 100]], {
    building: { x: 50, z: 20, width: 10 }, street: { x: 50, z: -50 },
    nearWall: (x, z) => x < 3 && z > 50 && z < 52
  });
  for (const run of plan.runs) {
    let d = 0;
    for (let i = 1; i < run.length; i++) d += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
    assert.ok(d >= RULES.minRunM - 1e-6, `${d} m run`);
  }
  // (decimetre zigzag goes: a 100 m straight edge drawn every 0.5 m with a 10 cm jitter simplifies to a few points)
  const jitter = [];
  for (let i = 0; i <= 200; i++) jitter.push([i * 0.5, (i % 2) * 0.1]);
  assert.ok(simplifyOpen(jitter, RULES.simplifyTolM).length <= 3, `${simplifyOpen(jitter, RULES.simplifyTolM).length} points`);
  assert.ok(simplifyRing([[0, 0], [50, 0.1], [100, 0], [100, 50], [100, 100], [50, 99.9], [0, 100], [0, 50]], RULES.simplifyTolM).length <= 8);
  assert.ok(plan.removedM.short >= 0);
});

test('the committed data: this frame, sane runs, the documented counts, no home-folder path', () => {
  assert.equal(data.kind, 'school-fences');
  assert.ok(data.frame && Number.isFinite(data.frame.x0) && data.frame.x1 > data.frame.x0);
  assert.equal(data.source.dataset, 'school-grounds/1');
  assert.match(data.source.indexSha256, /^[0-9a-f]{64}$/);
  assert.ok(data.schools.length > 100, `${data.schools.length} schools`);
  assert.ok(data.counts.schoolsWithFence === data.schools.length);
  const skipped = Object.values(data.counts.skipped).reduce((a, b) => a + b, 0);
  assert.equal(data.counts.schoolsWithFence + skipped, data.counts.downtown, 'every downtown school is fenced or skipped');
  assert.ok(data.counts.downtown >= 200 && data.counts.downtown <= 300, `${data.counts.downtown} downtown schools`);
  assert.ok(data.counts.runs > 0 && data.counts.metres > 1000);
  let runs = 0, metres = 0;
  for (const s of data.schools) {
    assert.ok(Array.isArray(s.runs) && s.runs.length >= 1, `${s.id}: runs`);
    for (const run of s.runs) {
      assert.ok(run.length >= 4 && run.length % 2 === 0, `${s.id}: a run is [x, z] pairs`);
      let d = 0;
      for (let i = 0; i < run.length; i += 2) {
        assert.ok(Number.isFinite(run[i]) && Number.isFinite(run[i + 1]), `${s.id}: finite point`);
        assert.ok(run[i] >= data.frame.x0 - 1 && run[i] <= data.frame.x1 + 1, `${s.id}: x in the frame`);
        assert.ok(run[i + 1] >= data.frame.z0 - 1 && run[i + 1] <= data.frame.z1 + 1, `${s.id}: z in the frame`);
        assert.equal(run[i], Math.round(run[i] * 10) / 10, `${s.id}: decimetre grid`);
        assert.equal(run[i + 1], Math.round(run[i + 1] * 10) / 10, `${s.id}: decimetre grid`);
        if (i) d += Math.hypot(run[i] - run[i - 2], run[i + 1] - run[i - 1]);
      }
      assert.ok(d >= RULES.minRunM - 0.11, `${s.id}: ${d.toFixed(2)} m run is at least ${RULES.minRunM} m`);
      runs++; metres += d;
    }
  }
  assert.equal(runs, data.counts.runs);
  assert.ok(Math.abs(metres - data.counts.metres) < 2, `${metres.toFixed(1)} vs ${data.counts.metres} m`);
  assert.ok(fs.statSync(path.join(ROOT, DATA_FILE)).size < 150 * 1024, 'the data file is under 150 KB');
  assert.ok(!JSON.stringify(data).includes(['', 'Users', ''].join('/')), 'no home-folder path in the file');
  // (the front opening widths came out somewhere plausible for real grounds)
  const o = data.openingWidthsM;
  assert.ok(o.n > 100 && o.p10 > 0 && o.p50 > o.p10 && o.p90 >= o.p50);
});

test('the pin names the shared dataset, the committed file and its hash, with no path', () => {
  assert.ok(pin, 'school-grounds/1 in data/shared-toronto-data-pin.json');
  assert.deepEqual(pin.bakedInto, [DATA_FILE]);
  assert.equal(pin.dataSha256, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, DATA_FILE))).digest('hex'));
  assert.equal(pin.indexSha256, data.source.indexSha256);
  assert.equal(pin.manifestCommit, data.source.manifestCommit);
  assert.equal(pin.manifestGenerated, data.source.manifestGenerated);
  assert.equal(pin.schools, data.counts.schoolsWithFence);
  assert.equal(pin.runs, data.counts.runs);
  assert.ok(!JSON.stringify(pin).includes(['', 'Users', ''].join('/')), 'no path in the pin');
});

test('without the shared cache the builder refuses to rebuild and says why', () => {
  const none = spawnSync(process.execPath, [path.join(ROOT, 'tools/build-school-fences.mjs')], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, TORONTO_DATA_CACHE: '' } });
  assert.equal(none.status, 1);
  assert.match(none.stderr, /TORONTO_DATA_CACHE/);
  assert.match(none.stderr, /school-grounds\/1/);
});

test('the layer loads on every desktop, and ?schoolFences=0, a phone and a low tier get none of it', () => {
  const html = read('explore.html');
  const iife = html.match(/const cityAppScripts = (\(\(\) => \{[\s\S]*?\}\)\(\));/)[1];
  const listFor = (search, phone = false) => [...vm.runInContext(iife, vm.createContext({
    URLSearchParams, location: { search },
    ...(phone ? { navigator: { maxTouchPoints: 5 }, matchMedia: () => ({ matches: true }) } : {})
  }))];
  for (const q of ['', '?map=detail', '?map=eglinton', '?lidarTrees=1', '?schoolFences=1']) {
    const l = listFor(q);
    assert.ok(l.includes('./js/school-fences.js') && l.includes('./js/school-fences-data.js'), q || 'desktop default');
    assert.equal(l.indexOf('./js/school-fences-data.js') + 1, l.indexOf('./js/school-fences.js'), q);
    assert.ok(l.indexOf('./js/school-fences.js') < l.indexOf('./js/main.js'), q);
  }
  for (const [q, phone] of [['?schoolFences=0', false], ['?schoolFences=0&map=detail', false], ['', true], ['?map=detail', true], ['?quality=low', false]]) {
    const l = listFor(q, phone);
    assert.ok(!l.includes('./js/school-fences.js') && !l.includes('./js/school-fences-data.js'), `${q || 'default'} ${phone ? '(phone)' : '(off / low)'}`);
  }
  // (the runtime itself is inert with ?schoolFences=0, whatever the loader does)
  const inert = vm.createContext({ window: { CITY: {} }, console: { info() {}, warn() {} }, URLSearchParams, location: { search: '?schoolFences=0' } });
  vm.runInContext(read('js/school-fences.js'), inert);
  assert.equal(typeof inert.window.CITY.buildSchoolFences, 'function');
  assert.equal(inert.window.CITY.buildSchoolFences(), null);
  // (and by default it is armed; the data script is what the page loads before it; a phone's loader says cityDesktop false)
  const armed = vm.createContext({ window: { CITY: {} }, console: { info() {}, warn() {} }, URLSearchParams, location: { search: '' }, cityAppScripts: { cityDesktop: true } });
  vm.runInContext(read('js/school-fences.js'), armed);
  assert.equal(typeof armed.window.CITY.buildSchoolFences, 'function');
});

test('the rule constants and quantiles behave as the document says', () => {
  assert.equal(RULES.fenceTolM, 3);
  assert.equal(RULES.minRunM, 3);
  assert.equal(RULES.wallClearM, 0.5);
  assert.deepEqual(RULES.campusKinds, ['University', 'College']);
  assert.equal(quantile([5, 1, 3, 2, 4], 0.5), 3);
  assert.equal(quantile([], 0.5), null);
  assert.ok(pointInRing(50, 50, SQUARE) && !pointInRing(-1, 50, SQUARE));
});
test('the fence bays (st-ndw9.17): a post every 2.4 m, thick terminal and corner posts, one end post, the committed data plans cleanly', () => {
  const ctx = vm.createContext({ window: { CITY: {} }, console: { info() {}, warn() {} }, URLSearchParams, location: { search: '' } });
  vm.runInContext(read('js/school-fences.js'), ctx);
  const plan = ctx.window.CITY.schoolFencesPlan;
  // a straight 24 m run: ten bays of 2.4 m and the end post (a 1 mm bay); the first and last posts are terminal (1.7), the rest line posts
  const straight = plan([{ runs: [[0, 0, 24, 0]] }], () => 0);
  assert.equal(straight.length, 11);
  assert.deepEqual(Array.from(straight, (b) => b.post), [1.7, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.7]);
  assert.ok(Math.abs(straight[0].dx - 2.4) < 1e-9 && straight[10].dx > 0 && straight[10].dx < 0.002, 'the end post is a bay of length 0.001');
  // a right-angle corner makes a corner post; a 10 degree bend does not
  const bent = plan([{ runs: [[0, 0, 12, 0, 12, 12]] }], () => 0);
  assert.equal(bent.filter((b) => b.post > 1).length, 3, 'two terminals and one corner');
  const gentle = plan([{ runs: [[0, 0, 12, 0, 24, Math.tan(10 * Math.PI / 180) * 12]] }], () => 0);
  assert.equal(gentle.filter((b) => b.post > 1).length, 2, 'a 10 degree bend stays a line post');
  // the bays follow the ground: a 1:4 slope gives the bay a rise
  const slope = plan([{ runs: [[0, 0, 2.4, 0]] }], (x) => x / 4);
  assert.ok(Math.abs(slope[0].dy - 0.6) < 1e-9 && Math.abs(slope[0].ay) < 1e-9);
  // every committed run plans into finite, bounded bays
  const bays = plan(data.schools, () => 0);
  assert.ok(bays.length > 20000);
  for (const b of bays) {
    assert.ok([b.ax, b.ay, b.az, b.dx, b.dy, b.dz].every(Number.isFinite));
    assert.ok(Math.hypot(b.dx, b.dz) <= 4, 'no bay is longer than the culling sphere allows');
  }
});
