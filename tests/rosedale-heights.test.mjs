// jf-boq: Rosedale-Moore Park's lidar box heights (js/rosedale-heights.js, tools/build-rosedale-heights.mjs, data/frames/eglinton/rosedale-heights.bin)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { unpackGeo } from '../js/geodata-loader.js';
import { massingRows } from '../js/massing-data.js';
import { applyRosedaleHeights, rosedaleCheck, ROSEDALE_HEIGHTS_URL } from '../js/rosedale-heights.js';

const file = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url));
const load = async () => {
  const { GEO } = await unpackGeo(file('data/frames/eglinton/toronto-geodata.bin'));
  const { ROSEDALE_HEIGHTS: H } = await unpackGeo(file('data/frames/eglinton/rosedale-heights.bin'));
  return { GEO, H };
};
const rowsOf = (H) => { let r = 0; return Array.from({ length: H.rows }, (_, i) => (r += H.rowDelta[i])); };

test('the page asks for the file by its hash', () => {
  const hash = createHash('sha256').update(file('data/frames/eglinton/rosedale-heights.bin')).digest('hex').slice(0, 12);
  assert.ok(ROSEDALE_HEIGHTS_URL.endsWith(`rosedale-heights.bin?v=${hash}`), ROSEDALE_HEIGHTS_URL);
});

test('the heights were built for the Eglinton map geodata and apply once', async () => {
  const { GEO, H } = await load();
  assert.equal(H.dataset, 'rosedale-roofs/1');
  assert.equal(H.geodata, createHash('sha256').update(file('data/frames/eglinton/toronto-geodata.bin')).digest('hex').slice(0, 16));
  assert.equal(rosedaleCheck(GEO.buildings, rowsOf(H)), H.check);
  const before = GEO.buildings.map((b) => b[4]);
  const out = applyRosedaleHeights(GEO.buildings, H);
  assert.equal(out.error, null);
  assert.equal(out.applied, H.rows);
  assert.ok(out.applied > 3000, `${out.applied} rows`);
  // only height changes, only on the listed rows
  const rows = new Set(rowsOf(H));
  GEO.buildings.forEach((b, i) => { if (!rows.has(i)) assert.equal(b[4], before[i], `row ${i} moved`); });
  // the second application is refused and changes nothing
  const snapshot = GEO.buildings.map((b) => b[4]);
  assert.match(applyRosedaleHeights(GEO.buildings, H).error, /other geodata|already/);
  assert.deepEqual(GEO.buildings.map((b) => b[4]), snapshot);
});

test('the other map (the detail map) refuses the file', async () => {
  const { H } = await load();
  const { GEO } = await unpackGeo(file('data/toronto-geodata.bin'));
  assert.ok(applyRosedaleHeights(GEO.buildings, H).error);
});

test('no row the default page draws from its outline is touched, and the box heights fall', async () => {
  const { GEO, H } = await load();
  const { MASSING } = await unpackGeo(file('data/toronto-massing.bin'));
  const drawn = massingRows(MASSING, GEO);
  assert.equal(drawn.error, null);
  const rows = rowsOf(H);
  for (const r of rows) assert.ok(!drawn.rows.has(r), `row ${r} is drawn from its outline`);
  const was = rows.map((r) => GEO.buildings[r][4]);
  applyRosedaleHeights(GEO.buildings, H);
  const now = rows.map((r) => GEO.buildings[r][4]);
  assert.ok(now.every((h) => h >= 2.5 && h < 150), 'heights in range');
  const flat = rows.filter((r) => GEO.buildings[r][6] === 0);
  const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  assert.ok(median(rows.map((_, i) => now[i] - was[i])) < -1.5, 'the median box is lower');
  assert.ok(flat.length > 1000);
  assert.ok(median(now) < median(was) - 3, 'the median height falls by metres');
});
