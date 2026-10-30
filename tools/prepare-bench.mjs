// Polyfork permits use inside games, but not standalone asset redistribution.
// Keep source/output out of Git. A fresh build downloads the pinned public GLB.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const root = fileURLToPath(new URL('..', import.meta.url));
const cache = path.join(os.homedir(), '.cache/slop-toronto/props/plaza-bench/source.glb');
const url = 'https://polyfork.dev/dl/cast-iron-plaza-bench-b4096d.glb';
const expected = '06b9cc8850203a3c8acc06bfc96488c4abce99ce6d8e0e454cd2a5aee332040b';
let bytes;
try { bytes = await fs.readFile(process.argv[2] || cache); }
catch {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Bench download failed (${response.status}). Download ${url} in a browser, then run node tools/prepare-bench.mjs /absolute/path/to/download.glb`);
  bytes = new Uint8Array(await response.arrayBuffer());
}
if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Bench source changed: review the model and licence before updating its pinned SHA256.');
await fs.mkdir(path.dirname(cache), { recursive: true });
await fs.writeFile(cache, bytes);
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.readBinary(bytes);
// The base bench is closed beneath the candle, flowers and papel decorations.
const bench = doc.getRoot().listNodes().find((n) => n.getName() === 'bench');
if (!bench?.getMesh()) throw new Error('Expected closed base bench node missing');
for (const scene of doc.getRoot().listScenes()) {
  for (const child of scene.listChildren()) scene.removeChild(child);
  scene.addChild(bench);
}
await doc.transform(prune(), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
const output = path.join(root, 'assets/props/plaza-bench.glb');
await io.write(output, doc);
console.log(`[bench] core model: ${(await fs.stat(output)).size} bytes; ${doc.getRoot().listMeshes().length} mesh, ${doc.getRoot().listMaterials().length} material`);
