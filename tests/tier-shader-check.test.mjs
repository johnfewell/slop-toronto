// tools/check-tier-shaders.mjs: its console filter recognises the medium-tier water bug and ignores known noise
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gpuErrors } from '../tools/check-tier-shaders.mjs';

const BUG = [
  '[error] THREE.WebGPURenderer: Render pipeline creation failed (renderPipeline_ShoreShallows_630): [Invalid ShaderModule "fragment_ShoreShallows"] is invalid due to a previous error.',
  '[error] THREE.WebGPURenderer: Uncaptured WebGPU GPUValidationError: Error while parsing WGSL: :12:8 error: structures must have at least one member',
  '[warning] [Invalid RenderPipeline "renderPipeline_ShoreShallows_630"] is invalid due to a previous error.',
  '[error] THREE.WebGPURenderer [renderPipeline_ShoreShallows_630 / fragment error] at line 12:8: structures must have at least one member'
];
const NOISE = [
  '[info] [quality] medium: ?quality',
  '[http 404 error] http://127.0.0.1:8892/live/roadworks',
  '[error] Failed to load resource: the server responded with a status of 404 (Not Found)',
  '[warning] THREE.TempNode: This module has been deprecated. Extend Node instead.',
  '[warning] Calling [RenderPassEncoder (unlabeled)].Draw with an index count of 0 is unusual.'
];

test('every line of the medium-tier water bug is an error', () => assert.deepEqual(gpuErrors(BUG.join('\n')), BUG));
test('known noise is ignored', () => assert.deepEqual(gpuErrors(NOISE.join('\n')), []));
test('a page error counts', () => assert.equal(gpuErrors('[pageerror] TypeError: x is not a function\n    at f').length, 1));
test('the shot list has the three views', () => {
  const shots = JSON.parse(fs.readFileSync(new URL('../tools/shots/tier-shader-check.json', import.meta.url), 'utf8'));
  assert.deepEqual(shots.map((s) => s.name), ['view-downtown', 'view-shoreline', 'view-high-park']);
});
