// The High Park Zoo's animals (docs/high-park-zoo-animals.md, st-0w0g): every species placed as boxes at load (off the
// road), its Poly
// Pizza model fetched only within 500 m of the enclosure, warmed hidden and swapped in for the boxes on one frame; a
// model that fails keeps its boxes; ?zoo=0|boxes; the models' files fitted, small, rigged (st-gtnq) and credited
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const root = new URL('..', import.meta.url);
const read = (f) => fs.readFileSync(new URL(`js/${f}.js`, root), 'utf8');
const SPECIES = ['bison', 'yak', 'highland', 'llama', 'reindeer', 'mouflon', 'barbary', 'capybara', 'emu', 'peafowl'];
// (the loader in node: the real GLTFLoader and meshopt decoder on the committed files; `fail` names models that 404)
function city(search = '', fail = []) {
  class Loader {
    setMeshoptDecoder() { return this; }
    async loadAsync(url) {
      const name = url.match(/zoo\/([a-z]+)\.glb$/)[1];
      if (fail.includes(name)) throw new Error('404');
      const buf = fs.readFileSync(new URL(`assets/zoo/${name}.glb`, root));
      return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
    }
  }
  const context = vm.createContext({ window: { CITY: { THREE, TSL, Addons: { mergeGeometries, GLTFLoader: Loader, MeshoptDecoder }, DEBUG_ROADS: false, QUALITY: { surfaceWear: 2, storefronts: 2 } }, addEventListener() {} },
    document: { addEventListener() {}, hidden: false }, location: { search }, URLSearchParams, Intl, performance, console: { info() {}, warn() {}, log() {} }, atob });
  for (const f of ['toronto-geodata', 'toronto-subway', 'toronto-subway-topology', 'high-park-data', 'don-valley', 'city-config', 'tsl-materials', 'high-park-features-data', 'high-park-features']) vm.runInContext(read(f), context);
  const C = context.window.CITY;
  return { C, built: C.buildHighParkFeatures(new THREE.Scene()) };
}
const herds = (group, prefix) => {
  const out = {};
  group.traverse((o) => { if (o.isInstancedMesh && o.name.startsWith(prefix)) out[o.name.slice(prefix.length)] = o; });
  return out;
};
// (frames until the models are in or have failed)
async function drive(Z, at) {
  for (let i = 0; i < 200 && !['models', 'failed'].includes(Z.state); i++) { Z.update(at); await new Promise((r) => setTimeout(r, 0)); }
}

test('every species is placed as boxes at load, nothing fetched until the camera is within 500 m', async () => {
  const { C, built } = city();
  const boxes = herds(built.group, 'HighParkZoo_');
  assert.deepEqual(Object.keys(boxes).sort(), [...SPECIES].sort());
  assert.equal(built.stats.animals, Object.values(boxes).reduce((s, m) => s + m.count, 0));
  // (every animal on the park's ground, 2 m clear of Deer Pen Road: off the islands is the street)
  const m4 = new THREE.Matrix4();
  for (const m of Object.values(boxes)) for (let i = 0; i < m.count; i++) {
    m.getMatrixAt(i, m4);
    const x = m4.elements[12], z = m4.elements[14];
    assert.ok([[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]].every(([dx, dz]) => C.blockAt(x + dx, z + dz)), `${m.name} ${i} off the road`);
  }
  const Z = built.zoo;
  assert.equal(Z, C.highParkZoo);
  assert.equal(Z.state, 'boxes');
  const zoo = C.HIGH_PARK_FEATURES.areas.find((a) => a[0] === 'zoo');
  const f = zoo.filter((v) => typeof v === 'number');
  let x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i + 1 < f.length; i += 2) { x1 = Math.max(x1, f[i]); z0 = Math.min(z0, f[i + 1]); z1 = Math.max(z1, f[i + 1]); }
  const zm = (z0 + z1) / 2;
  for (let i = 0; i < 5; i++) Z.update({ x: x1 + 520, y: 20, z: zm });
  assert.equal(Z.state, 'boxes', 'still boxes 520 m east of the enclosure');
  await drive(Z, { x: x1 + 480, y: 20, z: zm });
  assert.equal(Z.state, 'models');
  assert.match(Z.events[0].what, /^fetch at 4[0-9][0-9] m$/);
  // the models: one InstancedMesh a species, the boxes' instances, the boxes hidden, the park's material and its floats
  const models = herds(built.group, 'HighParkZooModel_');
  assert.deepEqual(Object.keys(models).sort(), [...SPECIES].sort());
  for (const s of SPECIES) {
    const m = models[s], b = boxes[s];
    assert.equal(m.count, b.count, `${s}: every box an animal`);
    assert.deepEqual(Array.from(m.instanceMatrix.array), Array.from(b.instanceMatrix.array), `${s}: in the boxes' places`);
    assert.ok(!b.visible && m.visible && m.frustumCulled && m.castShadow, s);
    // (the animals' own material, bent in the vertex stage, one for all ten; the shadow pass bends with it)
    assert.equal(m.material.name, 'HighParkZooAnimals', `${s}: the animals' material`);
    assert.equal(m.material, models.bison.material, `${s}: one material for every species`);
    assert.ok(m.material.positionNode && m.material.castShadowPositionNode, `${s}: bent, its shadow too`);
    assert.equal(m.userData.zooU.length, 6, `${s}: its hinges`);
    for (const a of ['position', 'normal', 'color', '_zooa']) assert.ok(m.geometry.attributes[a].array.constructor.name === 'Float32Array' && !m.geometry.attributes[a].normalized, `${s}: ${a} as floats`);
    for (const a of ['zooS0', 'zooS1']) assert.ok(m.geometry.attributes[a].isInstancedBufferAttribute && m.geometry.attributes[a].count === m.count, `${s}: ${a} per instance`);
  }
  // (warmed before the swap: added hidden over several frames, then swapped two frames later)
  const warm = Z.events.filter((e) => /^warm/.test(e.what)).length;
  assert.ok(warm >= 4, `${warm} warm-up frames`);
  assert.equal(Z.events.at(-1).what, 'swap');
  // (not drawn past 900 m, drawn again nearer; never unloaded, the boxes stay hidden)
  Z.update({ x: x1 + 950, y: 20, z: zm });
  assert.ok(Object.values(models).every((m) => !m.visible) && Object.values(boxes).every((m) => !m.visible));
  Z.update({ x: x1 + 100, y: 20, z: zm });
  assert.ok(Object.values(models).every((m) => m.visible) && Z.state === 'models');
});

test('a model that fails to load keeps its boxes; ?zoo=boxes and ?zoo=0', async () => {
  const { built } = city('', ['yak', 'emu']);
  await drive(built.zoo, { x: -6400, y: 5, z: -1700 });
  assert.equal(built.zoo.state, 'models');
  assert.deepEqual([...built.zoo.failed].sort(), ['emu', 'yak']);
  const boxes = herds(built.group, 'HighParkZoo_'), models = herds(built.group, 'HighParkZooModel_');
  for (const s of SPECIES) assert.equal(boxes[s].visible, ['yak', 'emu'].includes(s), `${s} boxes`);
  assert.ok(!models.yak && !models.emu && models.bison);
  // (all failing: the boxes stay)
  const none = city('', SPECIES).built;
  await drive(none.zoo, { x: -6400, y: 5, z: -1700 });
  assert.equal(none.zoo.state, 'failed');
  assert.ok(Object.values(herds(none.group, 'HighParkZoo_')).every((m) => m.visible));
  // ?zoo=boxes: the boxes only, nothing to fetch; ?zoo=0: no animals
  const b = city('?zoo=boxes').built;
  assert.equal(b.zoo, null);
  assert.equal(Object.keys(herds(b.group, 'HighParkZoo_')).length, SPECIES.length);
  const z = city('?zoo=0').built;
  assert.equal(z.zoo, null);
  assert.equal(z.stats.animals, 0);
  assert.equal(Object.keys(herds(z.group, 'HighParkZoo')).length, 0);
});

test('the models: fitted to the species (on their feet, along z, real size), small, credited', async () => {
  const credits = fs.readFileSync(new URL('CREDITS.md', root), 'utf8');
  const { MODELS } = await import(new URL('tools/build-zoo-animals.mjs', root));
  let total = 0;
  for (const s of SPECIES) {
    const file = new URL(`assets/zoo/${s}.glb`, root), size = fs.statSync(file).size;
    total += size;
    assert.ok(size < 300 * 1024, `${s}: ${size} B`);
    const buf = fs.readFileSync(file);
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
    const meshes = [];
    gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
    assert.equal(meshes.length, 1, `${s}: one mesh`);
    const g = meshes[0].geometry;
    assert.deepEqual(Object.keys(g.attributes).sort(), ['_zooa', 'color', 'normal', 'position'], `${s}: nothing unused`);
    // (the rig's hinges with it: tools/zoo/rig.mjs)
    for (const k of ['neck', 'tail', 'hipF', 'hipB', 'exc', 'graze', 'reach', 'belly']) assert.ok(meshes[0].userData.zooRig && k in meshes[0].userData.zooRig, `${s}: rig ${k}`);
    assert.equal(gltf.parser.json.images, undefined, `${s}: no textures`);
    meshes[0].updateWorldMatrix(true, false);
    const bb = new THREE.Box3().setFromObject(meshes[0]);
    assert.ok(Math.abs(bb.min.y) < 0.01, `${s}: on the ground (${bb.min.y})`);
    const spec = MODELS[s];
    assert.ok(bb.max.y >= spec.size * 0.98 && bb.max.y < spec.size * 1.8, `${s}: ${bb.max.y.toFixed(2)} m tall for ${spec.size} m`);
    assert.ok(bb.max.z - bb.min.z > bb.max.x - bb.min.x, `${s}: long along z`);
    assert.ok(Math.abs((bb.min.x + bb.max.x) / 2) < 0.15, `${s}: centred across`);
    // credited: the model's page, its author and licence
    assert.ok(credits.includes(`https://poly.pizza/m/${spec.id}`), `${s}: ${spec.id} in CREDITS.md`);
    assert.ok(credits.includes(spec.author) && credits.includes(spec.licence.replace('CC-BY', 'CC BY')), `${s}: ${spec.author}, ${spec.licence}`);
  }
  assert.ok(total < 2 * 1024 * 1024, `${total} B in all`);
});
