// st-bz1o.12: after scene-culling.js releaseCpuCopies drops a static geometry's CPU copy (the bigger map on every tier,
// the phone tiers on today's), a raycast passes the mesh by instead of reading its empty arrays as NaN vertices; its
// bounds, kept from before, stay finite.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as CORE from '../vendor/three/three.core.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

function load() {
  class MeshBasicNodeMaterial extends CORE.MeshBasicMaterial {}
  const window = { CITY: { THREE: { ...CORE, MeshBasicNodeMaterial }, QUALITY: { cull: 1, dist: 1, shadowFar: 1, staticCell: 1 },
    Addons: { mergeGeometries: () => null }, FAR_BAND: null } };
  vm.runInNewContext(read('js/scene-culling.js'), { window, Math, console, Map, Set, Object, Array, Number, Float32Array, Infinity });
  return window.CITY;
}
// a WebGPU backend stand-in on which every attribute has been uploaded
const renderer = { backend: { isWebGPUBackend: true, get: () => ({ buffer: {} }) } };

test('a released mesh is passed by raycasts (no NaN hits) and keeps finite bounds', () => {
  const C = load();
  const root = new CORE.Group();
  root.name = 'CityGround';
  const plaza = new CORE.Mesh(new CORE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new CORE.MeshStandardMaterial());
  plaza.name = 'Forecourts';
  const kept = new CORE.Mesh(new CORE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new CORE.MeshStandardMaterial());
  kept.name = 'Kept';
  kept.position.y = -1;
  root.add(plaza);
  const scene = new CORE.Scene();
  scene.add(root, kept);
  scene.updateMatrixWorld(true);
  const down = () => new CORE.Raycaster(new CORE.Vector3(60, 60, -50), new CORE.Vector3(0, -1, 0)).intersectObjects(scene.children, true);
  assert.deepEqual(down().map((h) => h.object.name), ['Forecourts', 'Kept'], 'before: both, the plaza 60 m down');
  assert.ok(C.releaseCpuCopies(renderer, [root]) >= 0);
  assert.equal(plaza.geometry.attributes.position.array.length, 0, 'the plaza\'s positions are on the GPU only');
  const hits = down();
  assert.deepEqual(hits.map((h) => h.object.name), ['Kept'], 'after: the released plaza is passed by');
  assert.ok(hits.every((h) => Number.isFinite(h.distance)), 'no NaN distance');
  const s = plaza.geometry.boundingSphere;
  assert.ok(Number.isFinite(s.radius) && [s.center.x, s.center.y, s.center.z].every(Number.isFinite), 'bounds kept, finite');
});
