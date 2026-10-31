// CAPTURE_INIT_SCRIPT=tools/capture-no-webgpu.js: the page as a browser without WebGPU sees it. navigator.gpu is gone
// before any page script runs, so explore.html finds no adapter (quality.js) and three's WebGPURenderer falls back to
// its WebGL2 backend on its own in renderer.init(), with no ?webgl=1 (js/sky-clouds.js then leaves the clouds out)
Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined, configurable: true });
