// js/city-grid.js blockStandsDowntown: a house block with one tree-inflated or tall box is not downtown concrete (jf-aru). The function is read from the source (city-grid.js is a classic script).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const src = fs.readFileSync(new URL('../js/city-grid.js', import.meta.url), 'utf8');
const body = src.match(/function blockStandsDowntown\(s\) \{[\s\S]*?\n\}/)[0];
const blockStandsDowntown = new Function(`${body}; return blockStandsDowntown;`)();

test('Crescent Road\'s block (41 houses, the City\'s heights up to 30 m under tree crowns) keeps its yards', () => {
  assert.equal(blockStandsDowntown({ n: 41, area: 9288, top: 30.2, tallArea: 230, towerArea: 0 }), false);
});
test('a block of offices and mid-rises is downtown', () => {
  assert.equal(blockStandsDowntown({ n: 8, area: 9000, top: 38, tallArea: 7000, towerArea: 0 }), true);
});
test('a tower among low rows still paves the block when it covers 6% of the footprint', () => {
  assert.equal(blockStandsDowntown({ n: 30, area: 9000, top: 95, tallArea: 600, towerArea: 600 }), true);
  assert.equal(blockStandsDowntown({ n: 30, area: 9000, top: 95, tallArea: 300, towerArea: 300 }), false);
});
test('big footprints at 14 m are a block of warehouses or slabs', () => {
  assert.equal(blockStandsDowntown({ n: 4, area: 8000, top: 15, tallArea: 0, towerArea: 0 }), true);
});
