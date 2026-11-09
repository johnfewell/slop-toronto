// Prints a GLB's nodes, meshes, materials and textures: node tools/zoo/inspect-glb.mjs <file.glb>...
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'draco3d.decoder': await draco3d.createDecoderModule() });
for (const file of process.argv.slice(2)) {
  const doc = await io.read(file);
  const r = doc.getRoot();
  console.log(`== ${file}`);
  console.log(`  extensions: ${r.listExtensionsUsed().map((e) => e.extensionName).join(', ') || '-'}; anims ${r.listAnimations().length}, skins ${r.listSkins().length}`);
  for (const n of r.listNodes()) console.log(`  node ${n.getName() || '-'} mesh=${n.getMesh()?.getName() ?? '-'} t=${n.getTranslation().map((v) => v.toFixed(2))} r=${n.getRotation().map((v) => v.toFixed(2))} s=${n.getScale().map((v) => v.toFixed(3))} kids=${n.listChildren().length}`);
  for (const m of r.listMeshes()) for (const p of m.listPrimitives()) {
    const pos = p.getAttribute('POSITION');
    console.log(`  prim ${m.getName()} mode=${p.getMode()} verts=${pos.getCount()} idx=${p.getIndices()?.getCount() ?? '-'} attrs=${p.listSemantics().join(',')} mat=${p.getMaterial()?.getName() ?? '-'} min=${pos.getMin([]).map((v) => v.toFixed(2))} max=${pos.getMax([]).map((v) => v.toFixed(2))}`);
  }
  for (const m of r.listMaterials()) console.log(`  mat ${m.getName()} base=${m.getBaseColorFactor().map((v) => v.toFixed(2))} tex=${m.getBaseColorTexture() ? m.getBaseColorTexture().getMimeType() + ' ' + m.getBaseColorTexture().getSize()?.join('x') : '-'} emis=${m.getEmissiveFactor().map((v) => v.toFixed(2))} alpha=${m.getAlphaMode()}`);
  for (const t of r.listTextures()) console.log(`  tex ${t.getName()} ${t.getMimeType()} ${t.getSize()?.join('x')} ${t.getImage()?.byteLength} B`);
}
