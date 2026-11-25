'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// The physical material layers (jf-rcw; after Ben Houston's Slop New York lighting): which tiers draw them, the
// ?coat override, and that every material that gets a layer keeps its old path for the tiers that do not
const root = join(__dirname, '..');
const read = (f) => readFileSync(join(root, f), 'utf8');

function quality(search) {
  const window = { CITY: {}, matchMedia: () => ({ matches: false }), innerWidth: 1600, innerHeight: 900 };
  vm.runInNewContext(read('js/quality.js'), {
    window, location: { search }, URLSearchParams, console: { info() {} },
    navigator: { maxTouchPoints: 0, hardwareConcurrency: 8 }, screen: { width: 1600, height: 900 },
    document: { hidden: false, createElement() {}, body: { appendChild() {} } }
  });
  return window.CITY.QUALITY;
}

test('the layers are drawn on high & medium, not on the phone tier; ?coat overrides either way', () => {
  assert.equal(quality('?quality=high').coat, true);
  assert.equal(quality('?quality=medium').coat, true);
  assert.equal(quality('?quality=low').coat, false);
  assert.equal(quality('?quality=high&coat=0').coat, false);
  assert.equal(quality('?quality=low&coat=1').coat, true);
});

test('each layered material is physical only under COAT and keeps its standard path otherwise', () => {
  const cars = read('js/actor-models.js');
  assert.match(cars, /COAT \? new THREE\.MeshPhysicalNodeMaterial\(\) : new THREE\.MeshStandardNodeMaterial\(\)/);
  assert.match(cars, /mat\.clearcoatNode = clearcoatFn\(\)/);
  assert.match(cars, /mat\.clearcoatNode = one\.sub\(max\(max\(glass, max\(headLamp, tailCol\)\)/); // the bus livery
  const tsl = read('js/tsl-materials.js');
  assert.equal((tsl.match(/mat\.mrtNode = coatSSR\(/g) || []).length, 2, 'the road & the sidewalk write their coat to SSR');
  assert.match(tsl, /mat\.clearcoatNode = max\(puddle, max\(damp\.mul\(0\.35\), film\.mul\(0\.15\)\)\)/);
  assert.match(read('js/streetcars.js'), /COAT \? new THREE\.MeshPhysicalNodeMaterial/);
  assert.match(read('js/pedestrians.js'), /mat\.sheenNode = mat\.colorNode\.mul\(cloth\)/);
  assert.match(read('js/rocketbox-pedestrians.js'), /_\(body\|equpiment\)\$/);
});

test('Ben Houston is credited for the layers', () => {
  const credits = read('CREDITS.md');
  assert.match(credits, /Ben Houston/);
  assert.match(credits, /bhouston\/slop-newyork/);
});
