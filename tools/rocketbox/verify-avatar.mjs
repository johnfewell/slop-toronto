// Checks a prepared avatar (tools/rocketbox/prepare-avatar.mjs) against its source GLB, loading the output the way the
// game does (three's GLTFLoader + MeshoptDecoder; the KTX2 textures are stubbed, since Node has no GPU).
//   node tools/rocketbox/verify-avatar.mjs <source.glb> <output.glb>
import fs from 'node:fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { Texture } from 'three';

globalThis.self ??= globalThis; // (GLTFLoader reads self.URL)

const [srcPath, outPath] = process.argv.slice(2);
if (!srcPath || !outPath) { console.error('usage: verify-avatar.mjs <source.glb> <output.glb>'); process.exit(2); }

async function load(p) {
  await MeshoptDecoder.ready;
  const stub = { load: (url, ok) => ok(new Texture()), loadAsync: async () => new Texture(), setWorkerLimit() {}, detectSupport() { return this; }, dispose() {}, parse: async () => new Texture() };
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(stub);
  const buf = fs.readFileSync(p);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const raw = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
  return { gltf: await loader.parseAsync(ab, ''), raw };
}
function summary(g) {
  const nodes = new Map(); let tris = 0, morphs = 0; const meshes = [];
  g.scene.traverse((o) => {
    nodes.set(o.name, o.parent ? o.parent.name : null);
    if (o.isSkinnedMesh) {
      meshes.push(o);
      const geo = o.geometry;
      tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      morphs += Object.keys(geo.morphAttributes || {}).length;
    }
  });
  return { nodes, tris, morphs, meshes };
}
const a = await load(srcPath), b = await load(outPath);
const sa = summary(a.gltf), sb = summary(b.gltf);
let failed = 0;
const expect = (ok, label) => { if (!ok) failed++; console.log(`  ${ok ? 'pass' : 'FAIL'}  ${label}`); };
const boneCount = (s) => [...s.nodes.keys()].filter((n) => /^Bip01_/.test(n) || n === 'Bip01').length;
console.log(`${outPath}: ${fs.statSync(srcPath).size} -> ${fs.statSync(outPath).size} bytes`);
console.log(`  bones in skin ${sa.meshes[0].skeleton.bones.length} -> ${sb.meshes[0].skeleton.bones.length}; Bip01 nodes ${boneCount(sa)} -> ${boneCount(sb)}`);
expect(sb.tris === sa.tris, `triangles unchanged (${sa.tris} -> ${sb.tris})`);
expect(sb.morphs === 0 && sb.meshes.every((m) => !m.geometry.morphAttributes.position), `no morph targets (source had ${a.raw.meshes.reduce((n, m) => n + m.primitives.reduce((k, p) => k + (p.targets ? p.targets.length : 0), 0), 0)} primitive targets)`);
expect(b.raw.meshes.every((m) => m.primitives.every((p) => !p.targets)), 'no targets in the file JSON');
const missing = [...sb.nodes.keys()].filter((n) => !sa.nodes.has(n));
expect(!missing.length, `no node that the source lacks (${missing.join(', ')})`);
const reparented = [...sb.nodes].filter(([n, p]) => sa.nodes.get(n) !== p);
expect(!reparented.length, `every surviving node keeps its parent (${reparented.map((x) => x.join('<')).join(', ')})`);
const gone = [...sa.nodes.keys()].filter((n) => !sb.nodes.has(n));
expect(gone.every((n) => /Finger|Eye|Brow|Cheek|Mouth|Lip|Jaw|Nose|Tongue|Caninus|Masseter|Blink|Hair/i.test(n) || /^Bip01_\w+$/.test(n) && !/Pelvis|Spine|Neck|Head|Clavicle|UpperArm|Forearm|Hand|Thigh|Calf|Foot|Toe/.test(n)), `removed nodes are all face or finger bones (${gone.length} removed)`);
const need = ['Pelvis', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'L_Clavicle', 'L_UpperArm', 'L_Forearm', 'L_Hand', 'R_Clavicle', 'R_UpperArm', 'R_Forearm', 'R_Hand',
  'L_Thigh', 'L_Calf', 'L_Foot', 'L_Toe0', 'R_Thigh', 'R_Calf', 'R_Foot', 'R_Toe0'].map((n) => `Bip01_${n}`);
expect(need.every((n) => sb.nodes.has(n)), 'the 22 body bones the game relies on are present');
// weights
let worst = 0, badIdx = 0, verts = 0;
for (const m of sb.meshes) {
  const j = m.geometry.attributes.skinIndex, w = m.geometry.attributes.skinWeight, n = m.skeleton.bones.length;
  for (let v = 0; v < w.count; v++, verts++) {
    worst = Math.max(worst, Math.abs(w.getX(v) + w.getY(v) + w.getZ(v) + w.getW(v) - 1));
    for (const k of [j.getX(v), j.getY(v), j.getZ(v), j.getW(v)]) if (k >= n) badIdx++;
  }
}
expect(worst < 1e-6 && badIdx === 0, `skin weights sum to 1 over ${verts} vertices (worst error ${worst.toExponential(1)}), ${badIdx} bad joint indices`);
// geometry untouched
let dpos = 0, duv = 0, dnor = 0;
sa.meshes.forEach((m, i) => {
  const o = sb.meshes[i];
  for (const [name, set] of [['position', (d) => (dpos = Math.max(dpos, d))], ['uv', (d) => (duv = Math.max(duv, d))], ['normal', (d) => (dnor = Math.max(dnor, d))]]) {
    const x = m.geometry.attributes[name], y = o.geometry.attributes[name];
    if (x.array.length !== y.array.length) set(Infinity);
    for (let k = 0; k < x.array.length; k++) set(Math.abs(x.array[k] - y.array[k]));
  }
});
expect(dpos === 0 && duv === 0 && dnor === 0, `positions, uvs and normals bit-identical (max stored-value diff ${dpos}, ${duv}, ${dnor})`);
expect(b.raw.textures.length === a.raw.textures.length && b.raw.images.every((im, i) => im.mimeType === a.raw.images[i].mimeType), `${b.raw.images.length} KTX2 images kept (${b.raw.images[0].mimeType})`);
{
  const bytes = (file, raw, im) => {
    const buf = fs.readFileSync(file);
    const jsonLen = buf.readUInt32LE(12), binStart = 20 + jsonLen + 8;
    const bv = raw.bufferViews[im.bufferView];
    return buf.subarray(binStart + (bv.byteOffset || 0), binStart + (bv.byteOffset || 0) + bv.byteLength);
  };
  const same = a.raw.images.every((im, i) => Buffer.compare(bytes(srcPath, a.raw, im), bytes(outPath, b.raw, b.raw.images[i])) === 0);
  expect(same, 'the KTX2 texture bytes are identical to the source');
}
console.log(failed ? `  ${failed} check(s) FAILED` : '  all checks pass');
process.exit(failed ? 1 : 0);
