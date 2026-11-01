const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(require('node:path').join(__dirname, '../js/main.js'), 'utf8');
const precompile = source.match(/  async function precompileShaders\(\) \{[\s\S]*?\n  \}/)[0];

test('shader preparation never interleaves renderer node builds across async yields', async () => {
  const meshes = Array.from({ length: 5 }, (_, i) => ({ isMesh: true, receiveShadow: i === 0, frustumCulled: true,
    visible: true, children: [], userData: {} }));
  meshes[2].userData.sharesPipelineWith = meshes[1];
  meshes[4].userData.shadowProxy = true;
  const scene = { visible: true, traverseVisible(fn) { meshes.filter((m) => m.visible).forEach(fn); } };
  let active = 0, peak = 0;
  const renderer = {
    setRenderTarget() {}, setMRT() {},
    async compileAsync(object, camera, targetScene, onProgress) {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setImmediate(resolve)); // Three yields between node-building stages.
      onProgress?.({ loaded: 1, total: 1 });
      active--;
    }
  };
  const run = vm.runInNewContext(`${precompile}\nprecompileShaders`, { scene, renderer, renderPipeline: { render() {} },
    scenePass: { renderTarget: {} }, sceneMRT: {}, cameraSystem: { camera: { layers: { mask: 1, set(layer) { this.mask = 1 << layer; } } } }, subwayRide: { warmGraphics() {} }, loadingStatus: {},
    markInit() {}, setLoadingProgress() {}, visualGate: { compiling: false, pending: null }, console });
  await run();
  assert.equal(peak, 1, 'material references must belong to a single build across its yields');
  assert.ok(meshes.every((m) => m.visible && m.frustumCulled), 'temporary compile visibility/culling is restored');
});

// Bead st-eyy2: on a real open Pearson's reading has usually arrived while the city builds, so its handler (a re-apply
// of the live sky, whose environment re-bake renders the sky dome six times) runs at the startup's first await, inside
// the precompile. Rendering there drew the sky under the scene pass's MRT ("struct OutputType {}", six invalid command
// buffers) and built its shader in the middle of another material's build. The change must wait for the end.
const applyVisual = source.match(/  function applyVisualTime\(timeId\) \{[\s\S]*?\n  \}/)[0];
test('a sky change that comes in during the shader precompile is applied after it, not inside it', async () => {
  const mesh = { isMesh: true, receiveShadow: true, frustumCulled: true, visible: true, children: [], userData: {} };
  const scene = { visible: true, traverseVisible(fn) { fn(mesh); } };
  const events = [];
  let compiling = 0, mrt = null, reading = null;
  const renderer = {
    setRenderTarget() {}, setMRT(m) { mrt = m; },
    async compileAsync() {
      compiling++;
      // the reading's handler: already resolved, so it runs at this first await (a microtask)
      if (reading) { const r = reading; reading = null; await Promise.resolve(); r(); }
      await new Promise((resolve) => setImmediate(resolve));
      compiling--;
    }
  };
  const lightingSystem = {
    activePresetId: 'golden',
    applyLive() { events.push({ bake: 'live', compiling, mrt }); return { id: 'midnight', weights: { midnight: 1 }, hemiIntensity: 0.3 }; },
    applyPreset(id) { events.push({ bake: id, compiling, mrt }); }
  };
  const context = vm.createContext({ scene, renderer, renderPipeline: { render() {} }, scenePass: { renderTarget: {} },
    sceneMRT: { scene: 'mrt' }, cameraSystem: { camera: { layers: { mask: 1, set(layer) { this.mask = 1 << layer; } } } },
    subwayRide: null, loadingStatus: null, markInit() {}, setLoadingProgress() {}, console,
    visualGate: { compiling: false, pending: null }, shaderTimeHold: null, rideSession: { held: false }, lightingSystem,
    liveWeather: () => ({ look: { saturation: 1, exposure: 1 } }), liveNow: () => new Date(), liveSky: {},
    colorGrade: { applyPreset() {} }, skyClouds: { setWeather() {} }, precipitation: { set() {} }, applySeason() {},
    timeButtons: [], renderLiveButton() {}, liveBtn: null, document: { getElementById: () => null } });
  const { precompileShaders, applyVisualTime } = vm.runInContext(`${precompile}\n${applyVisual}\n({ precompileShaders, applyVisualTime })`, context);
  applyVisualTime('live'); // (the first sky, before the precompile: applied at once)
  reading = () => applyVisualTime('live');
  await precompileShaders();
  assert.equal(reading, null, 'the reading landed during the precompile');
  assert.deepEqual(events.map((e) => [e.bake, e.compiling, e.mrt]), [['live', 0, null], ['live', 0, null]],
    'the second apply ran once, after the compile, with no MRT left on the renderer');
  assert.equal(context.visualGate.compiling, false);
  assert.equal(context.visualGate.pending, null);
  applyVisualTime('midday'); // (and after it, changes apply at once again)
  assert.deepEqual(events.at(-1), { bake: 'midday', compiling: 0, mrt: null });
});
