// The browser three.js pin (explore.html's import map) and the uniforms that pin's material refresh rules need.
// Since three.js #35221 (in the b3396270 pin), a material with no node properties of its own (GLTF props & landmarks,
// plain MeshStandardNodeMaterials) gets only a SHARED refresh: the render & frame uniform groups upload, the default
// object group does not. Scene-wide uniforms rewritten at run time must therefore sit in renderGroup, or those materials
// keep the value they were first drawn with (the stale aerial fog after a time-of-day change).
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const read = (file) => readFileSync(join(__dirname, '..', file), 'utf8');
const PIN = 'b3396270682287470d161658ac01084d25e8dba6';
const pins = (text) => [...text.matchAll(/mrdoob\/three\.js@([0-9a-f]{40})\//g)].map((m) => m[1]);

test('explore.html, the preview tools and the cloud release record all use the one three.js pin', () => {
  const html = read('explore.html');
  const map = JSON.parse(html.match(/<script type="importmap">([^]*?)<\/script>/)[1]).imports;
  for (const key of ['three', 'three/webgpu', 'three/tsl', 'three/addons/']) {
    assert.ok(map[key].startsWith(`https://cdn.jsdelivr.net/gh/mrdoob/three.js@${PIN}/`), key);
  }
  for (const file of ['tools/prop-preview.html', 'tools/props-preview.html', 'tools/clouds-probe.html']) {
    const found = pins(read(file));
    assert.ok(found.length > 0, file);
    assert.deepEqual([...new Set(found)], [PIN], file);
  }
  assert.match(JSON.parse(read('vendor/clouds/release.json')).renderer, new RegExp(`^three@${PIN} `));
});

test('the aerial fog read through scene.fogNode uses renderGroup uniforms', () => {
  const src = read('js/lighting.js');
  assert.match(src, /this\.uFogDensity = uniform\([^;]*\)\.setGroup\(renderGroup\);/);
  assert.match(src, /this\.uFogHeight = uniform\([^;]*\)\.setGroup\(renderGroup\);/);
  // the fog node reads no other uniform of its own
  const fogNode = src.slice(src.indexOf('createAerialFogNode() {'), src.indexOf('bakeEnvironmentMap() {'));
  assert.deepEqual([...new Set(fogNode.match(/this\.u[A-Z]\w*/g))].sort(), ['this.uFogDensity', 'this.uFogHeight']);
});

test('scene-wide uniforms rewritten per frame or per time of day are renderGroup uniforms', () => {
  const lighting = read('js/lighting.js');
  for (const name of ['uSkyExposure', 'uNightFactor', 'uNightSkyColor']) {
    assert.match(lighting, new RegExp(`this\\.${name} = uniform\\([^;]*\\)\\.setGroup\\(renderGroup\\);`), name);
  }
  const materials = read('js/tsl-materials.js');
  const city = materials.slice(materials.indexOf('const cityUniforms = {'), materials.indexOf('};', materials.indexOf('const cityUniforms = {')));
  const entries = city.split('\n').filter((line) => /^\s+u\w+: uniform\(/.test(line));
  assert.ok(entries.length >= 11);
  for (const line of entries) assert.match(line, /\.setGroup\(renderGroup\),?(\s*\/\/.*)?$/, line.trim());
  const checks = [
    ['js/ez-trees.js', /return uniform\(new THREE\.Vector3\(\)\)\.setGroup\(renderGroup\);/],
    ['js/street-details.js', /const signalClock = uniform\(0\)\.setGroup\(renderGroup\);/],
    ['js/tour-guide.js', /const uAlong = uniform\(0\)\.setGroup\(renderGroup\);/],
    ['js/tour-guide.js', /const uTime = uniform\(0\)\.setGroup\(renderGroup\);/],
    ['js/sky-clouds.js', /const nightGlow = TSL\.uniform\(0\)\.setGroup\(TSL\.renderGroup\);/],
    ['js/sky-clouds.js', /const camProjInv = TSL\.uniform\([^;]*\)\.setGroup\(TSL\.renderGroup\);/],
    ['js/sky-clouds.js', /const camWorld = TSL\.uniform\([^;]*\)\.setGroup\(TSL\.renderGroup\);/]
  ];
  for (const [file, re] of checks) assert.match(read(file), re, file);
  const post = read('js/post-processing.js');
  for (const name of ['exposure', 'contrast', 'saturation', 'balance']) {
    assert.match(post, new RegExp(`const ${name} = uniform\\([^;]*\\)\\.setGroup\\(renderGroup\\);`), name);
  }
});
