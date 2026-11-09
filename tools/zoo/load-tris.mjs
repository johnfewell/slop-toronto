// Loads a zoo species' triangles as tools/build-zoo-animals.mjs builds them (posed, fitted, recoloured), for the rig's
// review renders (tools/zoo/rig-review.mjs)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { MODELS, RECOLOUR, flatten, fit, stretchHorns } from '../build-zoo-animals.mjs';
export async function loadTris(species, raw = path.join(os.homedir(), '.cache/slop-toronto/zoo/downloads/models')) {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const spec = MODELS[species];
  const tris = await flatten(await io.readBinary(new Uint8Array(fs.readFileSync(path.join(raw, spec.id, 'model.glb')))));
  fit(tris, spec);
  if (spec.horns) stretchHorns(tris, spec.horns);
  const re = RECOLOUR[species];
  if (re) for (const t of tris) t.c = re(t.c, t.f, t.m);
  return { tris, spec };
}
