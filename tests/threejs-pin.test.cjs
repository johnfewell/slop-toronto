// The browser three.js pin (explore.html's import map) and the uniforms that pin's material refresh rules need.
// The pin is the stock r187 release (tag r187), the same build as npm three 0.187.0, which the tests, tools and the
// cloud library (three-clouds-webgpu 0.1.0-alpha.7, peer >=0.187.0 <0.188.0) use: one three for page, tools and tests.
// Since three.js #35221 (in r187), a material with no node properties of its own (GLTF props & landmarks,
// plain MeshStandardNodeMaterials) gets only a SHARED refresh: the render & frame uniform groups upload, the default
// object group does not. Scene-wide uniforms rewritten at run time must therefore sit in renderGroup, or those materials
// keep the value they were first drawn with (the stale aerial fog after a time-of-day change).
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const read = (file) => readFileSync(join(__dirname, '..', file), 'utf8');
const PIN = '7e89746a687bb88271253698fa108b1dd59825d0';
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

test('npm, vendor/three and the cloud release are the r187 release the page pins, one copy each', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.devDependencies.three, '0.187.0');
  const lock = JSON.parse(read('package-lock.json')).packages;
  const copies = (name) => Object.entries(lock).filter(([key]) => key === `node_modules/${name}` || key.endsWith(`/node_modules/${name}`));
  const expected = {
    three: '0.187.0',
    'three-clouds-webgpu': '0.1.0-alpha.7',
    '@takram/three-atmosphere': '0.19.1+fork.8',
    '@takram/three-geospatial': '0.9.1+fork.8'
  };
  for (const [name, version] of Object.entries(expected)) {
    const found = copies(name);
    assert.equal(found.length, 1, `${name}: ${found.map(([key]) => key).join(', ')}`);
    assert.equal(found[0][1].version, version, name);
  }
  const release = JSON.parse(read('vendor/clouds/release.json'));
  assert.equal(release.version, expected['three-clouds-webgpu']);
  assert.equal(pkg.dependencies['three-clouds-webgpu'], `file:vendor/clouds/${release.tarball}`);
  for (const name of ['@takram/three-atmosphere', '@takram/three-geospatial']) {
    assert.equal(release.dependencies[name].version, expected[name], name);
    assert.equal(pkg.dependencies[name], release.dependencies[name].url, name);
    assert.equal(pkg.overrides[name], `$${name}`, name); // (the fork builds reach the clouds' own peer dependencies too)
  }
  // vendor/three is the stock build, unpatched
  assert.match(read('vendor/three/three.core.js'), /const REVISION = '187';/);
  assert.doesNotMatch(read('vendor/three/three.tsl.js') + read('vendor/three/three.webgpu.js'), /slop-toronto/);
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
