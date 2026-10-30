const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// The asphalt & sidewalk wear (ported from mrdoob/slop-newyork 4a921f0 & dcb453f) is gated by quality.js `surfaceWear`:
// everything on high, the cheap part on medium & the phone tier, and ?q.surfaceWear=<n> sets it for A/B measurements.
const qualitySource = readFileSync(join(__dirname, '../js/quality.js'), 'utf8');
function quality(search) {
  const window = { CITY: {}, matchMedia: () => ({ matches: false }) };
  vm.runInNewContext(qualitySource, {
    window, location: { search }, URLSearchParams, console: { info() {} },
    navigator: { maxTouchPoints: 0, hardwareConcurrency: 8 }, screen: { width: 1600, height: 900 }
  });
  return window.CITY.QUALITY;
}

test('quality tiers set the surface wear level', () => {
  assert.equal(quality('?quality=high').surfaceWear, 2);
  assert.equal(quality('?quality=medium').surfaceWear, 1);
  assert.equal(quality('?quality=low').surfaceWear, 1);
  assert.equal(quality('').surfaceWear, 2); // the default desktop tier is high
  assert.equal(quality('?quality=low&q.surfaceWear=0').surfaceWear, 0);
  assert.equal(quality('?quality=high&q.surfaceWear=1').surfaceWear, 1);
});

test('the road & sidewalk shaders read the wear level and keep the expensive work behind it', () => {
  const src = readFileSync(join(__dirname, '../js/tsl-materials.js'), 'utf8');
  assert.match(src, /const SURFACE_WEAR = window\.CITY\.QUALITY\?\.surfaceWear \?\? 2;/);
  const body = (name) => {
    const start = src.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    return src.slice(start, src.indexOf('\n}\n', start));
  };
  // the body of the first `if (<flag>) {` block after `from` in `text`
  const block = (text, flag, from = 0) => {
    const at = text.indexOf(`if (${flag}) {`, from);
    assert.ok(at >= 0, `if (${flag})`);
    let depth = 0;
    for (let i = text.indexOf('{', at); i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}' && --depth === 0) return text.slice(at, i + 1);
    }
    return text.slice(at);
  };

  const road = body('createRoadSurfaceMaterial');
  // patches & potholes from level 1; the cracks (and the road-direction field they follow) only at level 2
  assert.match(road, /const wear = wearLite \? roadWear\(/);
  assert.match(road, /const cracks = wearFull \? \(\(\) => \{\s*const F = roadDirectionField\(\);[\s\S]*?roadCracks\(/);
  assert.doesNotMatch(src, /voronoiBorder|roadTarSnakes/, "New York's Voronoi crack networks are gone");
  // the hairline cracks are traced in a pixel-size branch, the sealant further out than the hairlines
  const cracksFn = src.slice(src.indexOf('const roadCracks = Fn('), src.indexOf('function createRoadSurfaceMaterial('));
  assert.match(cracksFn, /If\(px\.lessThan\(0\.14\)/);
  assert.match(cracksFn, /const hairFade = smoothstep\(0\.05, 0\.015, px\)/);

  const sidewalk = body('createSidewalkMaterial');
  // every level lays its joints across the walk from the walk frame city-grid.js stores (no world-axis grid)
  assert.match(sidewalk, /const frame = attribute\('walkFrame', 'vec4'\);/);
  assert.match(sidewalk, /const BAY = SW\.bay;/);
  assert.doesNotMatch(sidewalk, /gridLine\(|positionWorld\.x, PANEL/);
  // level 1: the full-width repairs by section, their years, the tooled margins; no stamps or fine detail
  const lite = block(sidewalk, 'wearLite');
  assert.match(lite, /repair = /);
  assert.match(sidewalk, /const margin = wearLite\s*\?/);
  assert.doesNotMatch(lite, /sidewalkStampAtlas|sidewalkGum|sAlong\.mul\(110/);
  // level 2 only: the contractors' stamps (atlas, in a pixel-size branch), the broom finish, cracks, scaling, gum
  const fullBlocks = [];
  for (let at = sidewalk.indexOf('if (wearFull) {'); at >= 0; at = sidewalk.indexOf('if (wearFull) {', at + 1)) fullBlocks.push(block(sidewalk, 'wearFull', at));
  const full = fullBlocks.join('\n');
  assert.match(full, /const atlas = sidewalkStampAtlas\(\);[\s\S]*If\(pixelSize\.lessThan\(0\.014\)/);
  assert.match(full, /brush = noise2D\(vec2\(sAlong\.mul\(110\.0\)/);
  assert.match(full, /sidewalkGum\(/);
  for (const name of ['sidewalkStampAtlas()', 'sidewalkGum(', 'sAlong.mul(110']) {
    const outside = sidewalk.split(name).length - 1 - (full.split(name).length - 1);
    assert.equal(outside, 0, `${name} only at level 2`);
  }
});
