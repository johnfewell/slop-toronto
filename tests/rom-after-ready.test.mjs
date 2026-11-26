// The ROM model's 6 MB are fetched once the city is ready, not during the start-up (st-tw6z): on a slow link they
// shared the line with the tree models the first frame waits for. The outline collider stays in the start-up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../js/landmarks.js', import.meta.url), 'utf8');
const block = src.slice(src.indexOf("if (S.rom && window.CITY.Addons.GLTFLoader)"));

test('the ROM model is fetched after the city is ready', () => {
  const wait = block.indexOf('afterReady()');
  const load = block.indexOf("loadAsync('./assets/landmarks/rom.glb')");
  assert.ok(wait > 0 && load > wait, 'afterReady() comes before the glb request');
  assert.match(block, /window\.__CITY_APP\.ready/);
});

test('the ROM outline collider is still added at build time', () => {
  const box = block.indexOf('boxCollider(s.x, s.z');
  assert.ok(box >= 0 && box < block.indexOf('afterReady()'));
});

test('the ROM model is warmed and its collider built a stage a frame, not in one frame', () => {
  assert.match(block, /requestAnimationFrame/);
  assert.match(block, /footprintCollidersSteps\(rom\)/);
  assert.ok(block.indexOf('setDrawRange(0, 0)') > 0, 'meshes drawn at nothing while they warm');
});
