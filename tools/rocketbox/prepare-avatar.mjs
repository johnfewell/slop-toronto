// Makes a lighter copy of a Rocketbox lod2 GLB for the game: no face shapes (morph targets), and none of the face or
// finger bones that js/rocketbox-pedestrians.js never drives. Their vertex weights fold into the nearest kept ancestor
// (Head for the face, Hand for the fingers) and are renormalised. The KTX2 textures are copied through as raw bytes.
//   node tools/rocketbox/prepare-avatar.mjs <source.glb> <output.glb>
// Needs the dev dependencies @gltf-transform/core, @gltf-transform/extensions, @gltf-transform/functions, meshoptimizer.
import fs from 'node:fs';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

// A bone goes if it is a finger, or anywhere under the head (eyes, brows, jaw, lips, tongue, hair bones if any)
const isFinger = (name) => /^Bip01 [LR] Finger\d+$/.test(name);

export async function prepareAvatar(srcPath, outPath) {
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.read(srcPath);
  const root = doc.getRoot();
  if (root.listSkins().length !== 1) throw new Error('expected exactly one skin');
  const skin = root.listSkins()[0];
  const joints = skin.listJoints();
  const head = joints.find((j) => j.getName() === 'Bip01 Head');
  if (!head) throw new Error('no Bip01 Head');

  const underHead = (n) => { for (let p = n.getParentNode(); p; p = p.getParentNode()) if (p === head) return true; return false; };
  const removed = new Set(root.listNodes().filter((n) => isFinger(n.getName()) || underHead(n)));
  for (const n of removed) {
    if (n.getMesh() || n.getSkin()) throw new Error(`removed node ${n.getName()} carries a mesh`);
    for (const c of n.listChildren()) if (!removed.has(c)) throw new Error(`kept child ${c.getName()} under removed ${n.getName()}`);
  }

  // joint index (old) -> joint index (new) of the nearest kept ancestor-or-self
  const kept = joints.filter((j) => !removed.has(j));
  const newIndex = new Map(kept.map((j, i) => [j, i]));
  const target = joints.map((j) => {
    let n = j;
    while (n && !newIndex.has(n)) n = n.getParentNode();
    if (!n) throw new Error(`no kept ancestor for ${j.getName()}`);
    return newIndex.get(n);
  });

  // weights, per vertex: add the folded weights together, keep the four largest (never more than four distinct after
  // folding, since folding only merges), renormalise, write back as normalised uint8 summing to exactly 255
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const t of prim.listTargets()) { prim.removeTarget(t); t.dispose(); }
      for (let set = 0; prim.getAttribute(`JOINTS_${set}`); set++) {
        if (set > 0) throw new Error('more than 4 influences per vertex is not handled');
        const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
        const ja = J.getArray(), wa = W.getArray();
        if (!(ja instanceof Uint8Array) || !(wa instanceof Uint8Array) || !W.getNormalized()) throw new Error('unexpected joint/weight types');
        for (let v = 0; v < J.getCount(); v++) {
          const acc = new Map();
          for (let k = 0; k < 4; k++) {
            const w = wa[v * 4 + k];
            if (w > 0) acc.set(target[ja[v * 4 + k]], (acc.get(target[ja[v * 4 + k]]) || 0) + w);
          }
          const entries = [...acc].sort((a, b) => b[1] - a[1]);
          const total = entries.reduce((s, e) => s + e[1], 0);
          if (!total) throw new Error(`vertex ${v} has no weight`);
          const q = entries.map(([, w]) => Math.floor((w / total) * 255));
          let rest = 255 - q.reduce((s, x) => s + x, 0);
          for (let i = 0; rest > 0; i = (i + 1) % q.length, rest--) q[i]++;
          for (let k = 0; k < 4; k++) {
            ja[v * 4 + k] = k < entries.length ? entries[k][0] : 0;
            wa[v * 4 + k] = k < entries.length ? q[k] : 0;
          }
        }
        J.setArray(ja);
        W.setArray(wa);
      }
    }
    mesh.setWeights([]);
    const extras = mesh.getExtras();
    if (extras && extras.targetNames) { delete extras.targetNames; mesh.setExtras(extras); }
  }

  // the skin: kept joints only, with their inverse bind matrices in the same order
  const ibm = skin.getInverseBindMatrices();
  const oldM = ibm.getArray();
  const newM = new Float32Array(kept.length * 16);
  kept.forEach((j, i) => newM.set(oldM.subarray(joints.indexOf(j) * 16, joints.indexOf(j) * 16 + 16), i * 16));
  for (const j of joints) skin.removeJoint(j);
  for (const j of kept) skin.addJoint(j);
  ibm.setArray(newM);

  for (const n of removed) n.dispose();
  await doc.transform(prune({ keepLeaves: false }));

  doc.createExtension(EXTMeshoptCompression).setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await io.write(outPath, doc);
  return { removed: [...removed].map((n) => n.getName()), joints: { before: joints.length, after: kept.length } };
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) { console.error('usage: prepare-avatar.mjs <source.glb> <output.glb>'); process.exit(2); }
  const r = await prepareAvatar(src, out);
  console.log(`${src}: bones ${r.joints.before} -> ${r.joints.after}, ${fs.statSync(src).size} -> ${fs.statSync(out).size} bytes`);
}
