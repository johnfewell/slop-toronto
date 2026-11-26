import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { chartSvg, normalizeRun, parseArgs } from '../tools/frame-time-chart.mjs';

const run = (extra = {}) => ({ series: [[0, 8], [100, 120], [200, 9], [300, 250]], marks: [{ name: 'park', t: 100 }, { name: 'late', t: 99999 }], ...extra });

test('normalizeRun computes missing statistics and reads both mark formats', () => {
  const r = normalizeRun(run());
  assert.equal(r.stats.over100, 2);
  assert.equal(r.stats.max, 250);
  const legacy = normalizeRun({ result: run({ startedAtRel: -50, p50: 7.5, p95: 49, max: 245, over100: 13, marks: ['scripts 147ms', 'warm 246 11046ms'] }) });
  assert.deepEqual(legacy.marks, [{ name: 'scripts', t: 97 }, { name: 'warm', t: 10996 }]);
  assert.equal(legacy.stats.over100, 13);
  assert.throws(() => normalizeRun({ series: [] }, 'x.json'), /x\.json: no series/);
});

test('chartSvg draws one panel per input, or one overlay panel, with only the named marks', () => {
  const items = [{ label: 'before', json: run() }, { label: 'after', json: run() }];
  const stacked = chartSvg(items).svg;
  assert.equal((stacked.match(/<polyline/g) || []).length, 2);
  assert.ok(stacked.includes('>park<') && !stacked.includes('>late<'), 'in-range marks only');
  assert.ok(chartSvg(items, { marks: ['nothing'] }).svg.indexOf('>park<') < 0);
  const o = chartSvg(items, { overlay: true, title: 'A vs B' });
  assert.equal((o.svg.match(/<polyline/g) || []).length, 2);
  assert.equal((o.svg.match(/>park</g) || []).length, 1, 'the same event in both runs is labelled once');
  assert.ok(o.svg.includes('before vs after') && o.svg.includes('A vs B'));
  assert.ok(o.height < chartSvg(items).height, 'an overlay is one panel');
  assert.throws(() => chartSvg([items[0]], { overlay: true }), /two or more/);
});

test('parseArgs reads options, labels and files, and rejects bad usage', () => {
  const o = parseArgs(['--overlay', '--label', 'a', '--label', 'b', '--marks', 'x, y', '--max-ms', '300', 'out.png', 'a.json', 'b.json']);
  assert.deepEqual([o.overlay, o.labels, o.marks, o.maxMs, o.files], [true, ['a', 'b'], ['x', 'y'], 300, ['out.png', 'a.json', 'b.json']]);
  assert.throws(() => parseArgs(['out.png']), /usage/);
  assert.throws(() => parseArgs(['--nope', 'a', 'b']), /unknown option/);
  assert.throws(() => parseArgs(['--max-ms', '0', 'a', 'b']), /positive/);
});

test('the frame-times capture shot is valid JSON, records its result and reads marks from the page hook', () => {
  const shots = JSON.parse(fs.readFileSync(new URL('../tools/shots/frame-times.json', import.meta.url), 'utf8'));
  assert.equal(shots[0].record, true);
  assert.match(shots[0].js, /__ftMarks/);
  const capture = fs.readFileSync(new URL('../tools/capture.mjs', import.meta.url), 'utf8');
  assert.match(capture, /window\.__ftMark = /);
});
