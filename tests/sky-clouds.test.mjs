// The sky on the WebGL2 backend (js/sky-clouds.js): three's WebGPURenderer runs on WebGL2 with ?webgl=1 and, on its
// own, in a browser without WebGPU. The cloud library refuses that backend (its pass threw while building and the whole
// frame came out black), so the sky goes without volumetric clouds there and keeps the atmosphere. Real library module
// (js/clouds.js) and three.js, a stand-in renderer per backend.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

const source = fs.readFileSync(new URL('../js/sky-clouds.js', import.meta.url), 'utf8');
const load = () => import('../js/clouds.js');

function harness(search = '') {
  const warnings = [];
  const window = { CITY: { THREE, TSL, QUALITY: { clouds: 'medium', cloudScale: 0.5 },
    cityUniforms: { uSkySunDir: { value: new THREE.Vector3(0, 1, 0) } },
    GEO: { frame: { lon: -79.3806, lat: 43.6453, elevation: 76, projection: { theta: 0.3 } } } } };
  const context = vm.createContext({ window, location: { search }, URLSearchParams,
    console: { warn: (...a) => warnings.push(a.join(' ')), info() {}, log() {} } });
  vm.runInContext(source, context);
  return { C: window.CITY, warnings };
}
// what three's WebGPURenderer has after init(): the backend it chose
const renderer = (backend) => ({ initialized: true, contextNode: null,
  backend: backend === 'webgpu' ? { isWebGPUBackend: true } : { isWebGLBackend: true } });

test('the cloud library runs on the WebGPU backend and is refused on WebGL2', async () => {
  const { C } = harness();
  const { Clouds } = await load();
  const gpu = C.cloudsSupported(Clouds, renderer('webgpu'));
  assert.equal(gpu.ok, true); assert.equal(gpu.backend, 'webgpu');
  const gl = C.cloudsSupported(Clouds, renderer('webgl'));
  assert.equal(gl.ok, false); assert.equal(gl.backend, 'webgl2');
  assert.match(gl.reason, /WebGL2 backend/);
});

test('on WebGL2 the sky keeps the atmosphere without building the cloud pass', async () => {
  const { C, warnings } = harness();
  const r = renderer('webgl');
  const sky = await C.setupClouds(r, { load });
  assert.ok(sky, 'the atmosphere stays');
  assert.equal(sky.atmosphereEnabled, true);
  assert.equal(sky.cloudsEnabled, false);
  assert.equal(sky.backend, 'webgl2');
  assert.equal(sky.pass, null);
  assert.equal(sky.context, null);
  // the renderer's TSL context carries the atmosphere and no clouds (nothing asks the library for its pass)
  const value = r.contextNode.value;
  assert.equal(typeof value.getAtmosphere, 'function');
  assert.equal(value.getClouds, undefined);
  assert.ok(warnings.some((w) => w.startsWith('[clouds] volumetric clouds off')), warnings.join('\n'));
  // the per-frame update and the composite run without a cloud pass
  const camera = new THREE.PerspectiveCamera();
  const lighting = { sky: new THREE.Object3D(), scene: new THREE.Scene(), activePresetId: 'golden',
    activePreset: { id: 'golden', fogDensity: 0.001 }, bakeEnvironmentMap() {}, applyPreset() {} };
  sky.attach(camera, lighting);
  sky.update(1 / 60);
  sky.resetHistory();
  const colour = TSL.vec4(1, 0, 0, 1);
  assert.equal(sky.composite(colour), colour);
});

test('on WebGL2 with the atmosphere off too there is no sky module at all', async () => {
  const { C } = harness('?atmosphere=0');
  assert.equal(await C.setupClouds(renderer('webgl'), { load }), null);
});
