// The waterfront beach chairs: Sugar Beach keeps the procedural 3-horizontal-slat Loll Adirondack; HTO Park's DEFAULT
// seat is the downloaded Innerscene "Cape - Adirondack Chair" (CC0), a real fan-arm, reclined-slat, vertical-slat
// Adirondack the captain accepted. These tests pin: the accepted model is the default for HTO, the procedural chair is
// the synchronous fallback and the explicit comparison override, the HTO colliders enclose the real model, the actual
// transformed geometry sits inside every HTO collider and on the sand, and the licence/provenance wording is honest.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ROOT = new URL('..', import.meta.url).pathname;
const MODEL = 'assets/props/waterfront-hto-adirondack.glb';
const MODEL_ABS = path.join(ROOT, MODEL);
const PROV = 'assets/props/waterfront-hto-adirondack.PROVENANCE.md';

class LocalLoader {
  loadAsync(url) {
    const buf = fs.readFileSync(path.resolve(ROOT, url));
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
  }
}

function city({ loader = LocalLoader, procedural = false, query = '' } = {}) {
  const Addons = { mergeGeometries };
  if (loader) Addons.GLTFLoader = loader;
  const CITY = { THREE, Addons, CITY_BOUNDS: { sidewalkHeight: 0.22 } };
  if (procedural) CITY.waterfrontChairTrial = false;
  const ctx = { window: { CITY }, console, performance, setTimeout, Promise };
  if (query) ctx.window.location = { search: query };
  vm.runInNewContext(read('js/toronto-geodata.js'), ctx);
  vm.runInNewContext(read('js/waterfront-details.js'), ctx);
  return ctx.window.CITY;
}
const tick = () => new Promise((r) => setTimeout(r, 300));
const chairMeshes = (out) => out.group.children.filter((m) => /_Chairs$/.test(m.name));
const bySite = (meshes, id) => meshes.find((m) => m.name.includes(id));
const inRing = (ring, x, z) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};

async function loadTrialGeometry() {
  const buf = fs.readFileSync(MODEL_ABS);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
  const geos = [];
  gltf.scene.updateWorldMatrix(true, true);
  gltf.scene.traverse((o) => { if (o.isMesh) geos.push(o.geometry); });
  return { gltf, geos };
}

test('the accepted chair model exists, is a glTF binary, and is a real single-mesh Adirondack at real scale', async () => {
  assert.ok(fs.existsSync(MODEL_ABS), 'asset exists');
  assert.equal(fs.readFileSync(MODEL_ABS).toString('utf8', 0, 4), 'glTF');
  assert.ok(fs.statSync(MODEL_ABS).size < 60_000, 'baked low-poly asset is small');

  const { gltf, geos } = await loadTrialGeometry();
  assert.equal(geos.length, 1, 'one merged mesh');
  const geo = geos[0];
  const tris = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
  assert.ok(tris > 1500 && tris < 2600, `simplified but faithful (${tris} tris)`);
  geo.computeBoundingBox();
  const size = new THREE.Vector3(); geo.boundingBox.getSize(size);
  // real published Adirondack scale: 85 W x 101 D x 106 H cm
  assert.ok(Math.abs(size.x - 0.849) < 0.02, `width ${size.x.toFixed(3)}`);
  assert.ok(Math.abs(size.y - 1.06) < 0.01, `height ${size.y.toFixed(3)}`);
  assert.ok(Math.abs(size.z - 1.012) < 0.02, `depth ${size.z.toFixed(3)}`);
  assert.ok(Math.abs(geo.boundingBox.min.y) < 0.01, 'base sits at y=0');

  // front +z: the tall back is at negative z, the seat/arms extend toward +z
  const pos = geo.attributes.position;
  let backZ = 0, backN = 0;
  for (let i = 0; i < pos.count; i++) { if (pos.getY(i) > 0.9) { backZ += pos.getZ(i); backN++; } }
  assert.ok(backN > 0 && backZ / backN < -0.2, 'back is at -z (front faces +z)');

  // white paintable material, no textures
  let mat = null;
  gltf.scene.traverse((o) => { if (o.isMesh && !mat) mat = o.material; });
  assert.ok(mat, 'has a material');
  assert.ok(!mat.map && !mat.normalMap && !mat.roughnessMap, 'textures stripped');
  const c = mat.color;
  assert.ok(Math.abs(c.r - 1) < 1e-6 && Math.abs(c.g - 1) < 1e-6 && Math.abs(c.b - 1) < 1e-6, 'white base colour');
});

test('DEFAULT: with a GLTFLoader present and no override, HTO uses the accepted model and Sugar keeps the procedural chair', async () => {
  const C = city({ loader: LocalLoader });
  const out = C.createWaterfrontDetails(THREE, new THREE.Scene());
  const before = chairMeshes(out).map((m) => m.geometry.attributes.position.count);
  await tick();
  const after = chairMeshes(out);
  assert.ok(out.stats.chairModel, 'the accepted model loads by default');
  assert.deepEqual(Array.from(out.stats.chairModel.styles), ['vertical'], 'the model matches the HTO (vertical) chair');
  assert.ok(Array.from(out.stats.chairModel.sites).some((n) => n.includes('htoPark')), 'HTO chairs use it');
  assert.ok(!Array.from(out.stats.chairModel.sites).some((n) => n.includes('sugarBeach')), 'Sugar chairs keep the procedural chair');
  const hto = bySite(after, 'htoPark');
  const sugar = bySite(after, 'sugarBeach');
  assert.equal(hto.geometry, out.stats.chairModel.geometry, 'HTO uses the downloaded Adirondack');
  assert.notEqual(sugar.geometry, out.stats.chairModel.geometry, 'Sugar keeps its procedural 3-horizontal-slat chair');
  assert.notEqual(before[after.indexOf(hto)], hto.geometry.attributes.position.count, 'HTO geometry actually swapped');
  // the InstancedMesh bounds are recomputed from the real model, not the smaller procedural geometry
  assert.ok(hto.boundingBox, 'HTO instanced bounds recomputed');
  assert.ok(Math.abs((hto.boundingBox.max.y - hto.boundingBox.min.y) - 1.06) < 0.02, 'HTO bounds enclose the 1.06 m chair');
});

test('colliders: HTO uses the real model footprint synchronously; Sugar keeps the procedural footprint', () => {
  const C = city({ procedural: true }); // no loader needed: colliders are synchronous
  const out = C.createWaterfrontDetails(THREE, new THREE.Scene());
  const chairs = out.colliders.filter((c) => c.kind === 'chair');
  assert.equal(chairs.length, 226);
  const hto = out.layout.sites.find((s) => s.id === 'htoPark');
  const sugar = out.layout.sites.find((s) => s.id === 'sugarBeach');
  const htoColliders = chairs.filter((c) => hto.chairs.some((p) => Math.abs(p.x - c.obb.cx) < 1e-9 && Math.abs(p.z - c.obb.cz) < 1e-9));
  const sugarColliders = chairs.filter((c) => sugar.chairs.some((p) => Math.abs(p.x - c.obb.cx) < 1e-9 && Math.abs(p.z - c.obb.cz) < 1e-9));
  assert.equal(htoColliders.length, 76);
  assert.equal(sugarColliders.length, 150);
  for (const c of htoColliders) {
    // the real model's bbox is 0.8493 x 1.0120 x 1.06 m; the collider must enclose it (not the old 0.66 x 0.99 x 0.95)
    assert.ok(c.obb.hx >= 0.4246 && c.obb.hx < 0.43, `HTO real half width ${c.obb.hx}`);
    assert.ok(c.obb.hz >= 0.5060 && c.obb.hz < 0.51, `HTO real half depth ${c.obb.hz}`);
    assert.ok(Math.abs((c.maxY - c.minY) - 1.06) < 1e-9, 'HTO real height');
  }
  for (const c of sugarColliders) {
    assert.ok(Math.abs(c.obb.hx - 0.33) < 1e-9 && Math.abs(c.obb.hz - 0.47) < 1e-9, 'Sugar procedural half extents');
    assert.ok(Math.abs((c.maxY - c.minY) - 0.95) < 1e-9, 'Sugar procedural height');
  }
});

test('OVERRIDE: window.CITY.waterfrontChairTrial = false keeps the procedural HTO chair for comparison', async () => {
  const C = city({ loader: LocalLoader, procedural: true });
  const out = C.createWaterfrontDetails(THREE, new THREE.Scene());
  const before = chairMeshes(out).map((m) => m.geometry.attributes.position.count);
  await tick();
  const after = chairMeshes(out);
  assert.equal(out.stats.chairModel, undefined, 'override: the downloaded model is never swapped in');
  assert.deepEqual(after.map((m) => m.geometry.attributes.position.count), before, 'procedural geometry kept');
  const sugar = bySite(after, 'sugarBeach');
  const hto = bySite(after, 'htoPark');
  assert.notEqual(sugar.geometry, hto.geometry, 'the two beaches keep their own procedural chair slats');
});

test('OVERRIDE: ?waterfrontChairTrial=0 also keeps the procedural HTO chair', async () => {
  const C = city({ loader: LocalLoader, query: '?waterfrontChairTrial=0' });
  const out = C.createWaterfrontDetails(THREE, new THREE.Scene());
  await tick();
  assert.equal(out.stats.chairModel, undefined, 'query override: the downloaded model is never swapped in');
  const hto = bySite(chairMeshes(out), 'htoPark');
  assert.ok(hto.geometry.attributes.position.count > 0, 'procedural HTO geometry kept');
});

test('actual transformed HTO geometry sits inside every HTO collider and on the sand (not a constant mirror)', async () => {
  const C = city({ loader: LocalLoader });
  const out = C.createWaterfrontDetails(THREE, new THREE.Scene());
  await tick();
  const htoSite = out.layout.sites.find((s) => s.id === 'htoPark');
  const htoMesh = bySite(chairMeshes(out), 'htoPark');
  assert.equal(htoMesh.geometry, out.stats.chairModel.geometry, 'the real model is in the scene');
  const geo = htoMesh.geometry;
  const pos = geo.attributes.position;
  const chairColliders = out.colliders.filter((c) => c.kind === 'chair');
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  let checked = 0;
  for (let i = 0; i < htoMesh.count; i++) {
    m.fromArray(htoMesh.instanceMatrix.array, i * 16);
    const px = m.elements[12], pz = m.elements[14];
    const collider = chairColliders.find((c) => Math.abs(c.obb.cx - px) < 1e-3 && Math.abs(c.obb.cz - pz) < 1e-3);
    assert.ok(collider, `HTO instance ${i} has a collider`);
    for (let k = 0; k < pos.count; k++) {
      v.fromBufferAttribute(pos, k).applyMatrix4(m);
      const dx = v.x - collider.obb.cx, dz = v.z - collider.obb.cz;
      const localX = dx * collider.obb.cs - dz * collider.obb.sn;
      const localZ = dx * collider.obb.sn + dz * collider.obb.cs;
      assert.ok(Math.abs(localX) <= collider.obb.hx + 1e-6, `instance ${i} vertex ${k} inside collider x`);
      assert.ok(Math.abs(localZ) <= collider.obb.hz + 1e-6, `instance ${i} vertex ${k} inside collider z`);
      assert.ok(v.y >= collider.minY - 1e-6 && v.y <= collider.maxY + 1e-6, `instance ${i} vertex ${k} inside collider y`);
      assert.ok(inRing(htoSite.sandRing, v.x, v.z), `instance ${i} vertex ${k} on the sand`);
      checked++;
    }
  }
  assert.ok(checked > 76 * 1000, `checked every transformed vertex (${checked})`);
});

test('the accepted asset is honestly described (real CC0 Innerscene Adirondack) with no false claim', () => {
  const prov = read(PROV);
  assert.match(prov, /Adirondack/i);
  assert.match(prov, /Innerscene/);
  assert.match(prov, /CC0/);
  assert.match(prov, /innerscene\.com\/tools\/library\/3d-parts\/cape-adirondack-chair-0356dfce/);
  assert.doesNotMatch(prov, /incompatible-compatible/i, 'no false licence phrase');
  assert.doesNotMatch(prov, /deck chair/i, 'this asset is not a deck chair');

  const doc = read('docs/waterfront-furniture-assets.md');
  assert.match(doc, /Innerscene/);
  assert.match(doc, /CC0/);
  assert.match(doc, /CC0 1\.0/);
  assert.match(doc, /HTO/);
  assert.doesNotMatch(doc, /incompatible-compatible/i);
  assert.match(doc, /rejected/i);
});
