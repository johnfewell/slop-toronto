// Shader work that is skipped where its result is already multiplied by zero (st-iq0v.3, after mrdoob/slop-newyork
// f3635e7, 91dc313, 95e455c). js/tsl-materials.js needs a browser (window.CITY.TSL), so these read the source: the
// helpers exist, the facade materials use them, and the derivative inputs are taken before the branch.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../js/tsl-materials.js', import.meta.url), 'utf8');
const between = (from, to) => {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `${from} is in tsl-materials.js`);
  const b = src.indexOf(to, a + from.length);
  assert.ok(b > a, `${to} follows ${from}`);
  return src.slice(a, b);
};

test('the apartment interior is raycast only where the glazing is, with both derivatives taken before the branch', () => {
  const helper = between('function apartmentInteriorBehind(', '/**\n * Treatment of each wall');
  assert.match(helper, /interiorDrapeFootprint\(winUV\)/, 'the drape footprint is taken outside the branch');
  assert.match(helper, /const fwv = vec2\(fw\)\.toVar\(\)/);
  assert.match(helper, /const drapeFw = float\(drapeFootprint\)\.toVar\(\)/);
  assert.match(helper, /If\(coverage\.add\(fwidth\(coverage\)\)\.greaterThan\(0\.0\)/, 'the branch also runs where a quad neighbour has glazing');
  assert.ok(helper.indexOf('toVar') < helper.indexOf('If('), 'the variables are declared before the If');
  const interior = between('const evaluateApartmentInterior = Fn(', 'const interiorDrapeFootprint');
  assert.doesNotMatch(interior, /fwidth\(/, 'no screen-space derivative is left inside the interior itself');
  assert.match(interior, /drapeFwNode/);
});

test('every facade material asks for its room through apartmentInteriorBehind', () => {
  assert.doesNotMatch(src.replace(/function apartmentInteriorBehind[\s\S]*?\n}\n/, ''), /= evaluateApartmentInterior\(/,
    'only the helper calls evaluateApartmentInterior');
  assert.equal((src.match(/const aptRoom = apartmentInteriorBehind\(/g) || []).length, 3, 'curtain wall, pre-war and rendered facades');
  for (const [from, to, what] of [
    ['function createCurtainWallMaterial', 'function createPreWarBuildingMaterial', 'curtain wall'],
    ['function createPreWarBuildingMaterial', 'function createRenderedFacadeMaterial', 'pre-war'],
    ['function createRenderedFacadeMaterial', 'function createCarPaintMaterial', 'rendered facade']]) {
    assert.match(between(from, to), /const aptRoom = apartmentInteriorBehind\(/, what);
  }
  assert.match(between('function createCurtainWallMaterial', 'function createPreWarBuildingMaterial'),
    /apartmentInteriorBehind\(isGlassPane,/, 'the curtain wall branches on its glass pane mask');
  assert.match(between('function createPreWarBuildingMaterial', 'function createRenderedFacadeMaterial'),
    /apartmentInteriorBehind\(windowOpening,/, 'the pre-war facade branches on its window opening');
  assert.match(between('function createRenderedFacadeMaterial', 'function createCarPaintMaterial'),
    /apartmentInteriorBehind\(masks\(\)\.opening,/, 'the rendered facade branches on its opening mask');
});

test('road detail layers branch on their own fade (fadedDetail), potholes and oil drips on their cell', () => {
  const helper = between('function fadedDetail(', '/**\n * Wear & repairs of the asphalt');
  assert.match(helper, /const out = float\(flat\)\.toVar\(\)/);
  assert.match(helper, /If\(active, \(\) => \{\s*out\.assign\(detail\(\)\);/);
  const road = between('function createRoadSurfaceMaterial', 'function createRoadPaintMaterial');
  // each layer, with the pixel footprint (or the camera distance) taken into a variable first
  assert.equal((road.match(/const px = float\(pixelSize\)\.toVar\(\)/g) || []).length, 5, 'chips, oil drips, colour, roughness and normal take the footprint once');
  for (const layer of [/microAggregate = fadedDetail\(px\.lessThan\(0\.06\)/, /fineGrain = fadedDetail\(px\.lessThan\(0\.4\)/,
    /oilyStain = fadedDetail\(camDist\.lessThan\(240\.0\)/, /microRough = fadedDetail\(px\.lessThan\(0\.08\)/,
    /coarseGrit = fadedDetail\(px\.lessThan\(wearLite \? 0\.12 : 0\.08\)/, /fineGrit = fadedDetail\(px\.lessThan\(0\.02\)/,
    /ripples = fadedDetail\(px\.lessThan\(0\.3\)/, /midGrit = fadedDetail\(px\.lessThan\(0\.035\)/,
    /fadedDetail\(px\.lessThan\(0\.03\), 0\.035/, /fadedDetail\(hash2D\(oilCell\.add\(vec2\(7\.7, 3\.3\)\)\)\.greaterThanEqual\(0\.75\), 0\.0/]) {
    assert.match(road, layer);
  }
  assert.match(road, /const camDist = length\(positionWorld\.sub\(cameraPosition\)\)\.toVar\(\)/);
  const wear = between('const roadWear = Fn(', 'const roadCracks');
  assert.match(wear, /const px = float\(pxIn\)\.toVar\(\)/, 'the footprint is a variable before the pothole branch');
  assert.match(wear, /If\(hash2D\(hCell\.add\(vec2\(8\.8, 0\.3\)\)\)\.greaterThanEqual\(float\(0\.975\)\.sub\(worn\.mul\(0\.12\)\)/);
  assert.match(road, /If\(tsDist\.greaterThan\(0\.0\)/, 'the neon tint only near its centre');
});

test('sidewalk and curb detail branch on their own fade; the gum and the stamp already did', () => {
  const walk = between('function createSidewalkMaterial', 'function createCurbMaterial');
  assert.equal((walk.match(/const px = float\(pixelSize\)\.toVar\(\)/g) || []).length, 3, 'brush, colour and normal take the footprint once');
  for (const layer of [/grit = fadedDetail\(px\.lessThan\(0\.07\)\.and\(camDist\.lessThan\(190\.0\)\)/, /mottle = fadedDetail\(px\.lessThan\(0\.15\)/,
    /aggregate = fadedDetail\(px\.lessThan\(0\.02\)/, /brush = Fn\(/, /fadedDetail\(px\.lessThan\(0\.012\), 0\.0, \(\) =>\s*noise2D\(vec2\(sAlong/,
    /grain = fadedDetail\(camDist\.lessThan\(140\.0\)/, /pores = fadedDetail\(px\.lessThan\(0\.012\)/]) {
    assert.match(walk, layer);
  }
  assert.match(walk, /const scaled = float\(scaling\)\.toVar\(\)/, 'a node the colour also uses is a variable before the branch');
  assert.match(walk, /const edge = float\(margin\)\.toVar\(\)/);
  const curb = between('function createCurbMaterial', 'Tileable wind-wave texture');
  assert.match(curb, /speckle = fadedDetail\(camDist\.lessThan\(180\.0\)/);
  assert.match(curb, /grain = fadedDetail\(camDist\.lessThan\(120\.0\)/);
  assert.match(src, /const sidewalkGum = Fn\([\s\S]*?If\(px\.lessThan\(0\.04\)\.and\(density\.greaterThan\(0\.001\)/, 'the gum was already traced only where it shows');
});
