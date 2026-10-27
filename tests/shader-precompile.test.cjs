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
    scenePass: { renderTarget: {} }, sceneMRT: {}, cameraSystem: { camera: {} }, loadingStatus: {},
    markInit() {}, setLoadingProgress() {}, console });
  await run();
  assert.equal(peak, 1, 'material references must belong to a single build across its yields');
  assert.ok(meshes.every((m) => m.visible && m.frustumCulled), 'temporary compile visibility/culling is restored');
});
