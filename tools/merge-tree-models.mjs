// tools/merge-tree-models.mjs — one .glb per tree species instead of one per size (st-tw6z).
//
// assets/trees held 11 models (oak, ash, pine in small, medium and large; aspen in medium and large), and each carried its
// own copy of its species' leaf-and-bark atlas (a 1280x1024 WebP, 105 to 272 KB): 1.9 MB of the 5.3 MB the page downloads
// for them was the same four pictures over again. This puts each species' sizes in one file with the atlas once:
//   ez-oak.glb  (nodes `small_near`, `small_mid`, `medium_near`, ...: three's GLTFLoader drops `/` and `.` from names), ez-ash.glb, ez-pine-a.glb, ez-aspen.glb
// The geometry is not touched: the meshopt-compressed vertex and index data are copied byte for byte (their offsets
// rebased), only the repeated image is left out and every material points at the one that stays. `--check` decodes
// the merged files and the sources and compares every accessor value, every material parameter and each node's transform.
//
// usage: node tools/merge-tree-models.mjs --from <folder of the per-size models> [--to assets/trees] [--check]
// (the per-size models are in git history: `git show fabca4c:assets/trees/ez-oak-small.glb` and the like, or any folder
// holding ez-<species>-<size>[-a].glb; the sizes keep the names GEO.treeModels uses, tools/geo-trees.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const FROM = path.resolve(opt('--from', 'assets/trees'));
const TO = path.resolve(opt('--to', 'assets/trees'));
const CHECK = args.includes('--check');
// species file -> its per-size models (the aspen has no small one; the pine's names end -a)
const SPECIES = {
  'ez-oak': ['small', 'medium', 'large'].map((s) => [s, `ez-oak-${s}`]),
  'ez-ash': ['small', 'medium', 'large'].map((s) => [s, `ez-ash-${s}`]),
  'ez-pine-a': ['small', 'medium', 'large'].map((s) => [s, `ez-pine-${s}-a`]),
  'ez-aspen': ['medium', 'large'].map((s) => [s, `ez-aspen-${s}`])
};

export function readGlb(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a GLB`);
  const jl = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jl).toString('utf8'));
  const binOff = 20 + jl;
  const bin = b.readUInt32LE(binOff + 4) === 0x004e4942 ? b.subarray(binOff + 8, binOff + 8 + b.readUInt32LE(binOff)) : Buffer.alloc(0);
  return { json, bin };
}

export function writeGlb(file, json, bin) {
  const pad = (buf, byte) => (buf.length % 4 ? Buffer.concat([buf, Buffer.alloc(4 - (buf.length % 4), byte)]) : buf);
  const j = pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20), p = pad(bin, 0);
  const head = Buffer.alloc(12 + 8);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + 8 + p.length, 8);
  head.writeUInt32LE(j.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  const binHead = Buffer.alloc(8);
  binHead.writeUInt32LE(p.length, 0); binHead.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(file, Buffer.concat([head, j, binHead, p]));
}

/** Merges the parsed per-size models ([[size, {json, bin}]...]) into one { json, bin } */
export function merge(models) {
  const out = { asset: models[0][1].json.asset, extensionsUsed: [], extensionsRequired: [], buffers: [], bufferViews: [], accessors: [], images: [], textures: [], samplers: [], materials: [], meshes: [], nodes: [], scenes: [{ nodes: [] }], scene: 0 };
  const chunks = []; let binLen = 0, fallbackLen = 0;
  const imageByHash = new Map(); // image bytes -> the image index that keeps them
  const textureByKey = new Map(), samplerByKey = new Map();
  const push = (arr, v) => { arr.push(v); return arr.length - 1; };
  const union = (dst, src = []) => { for (const e of src) if (!dst.includes(e)) dst.push(e); };
  let bufferTemplate = null;
  for (const [size, { json, bin }] of models) {
    union(out.extensionsUsed, json.extensionsUsed); union(out.extensionsRequired, json.extensionsRequired);
    // the buffers: 0 is the GLB's own chunk (the compressed data and the image), 1 the uncompressed fallback that has no data
    if (json.buffers.length !== 2 || json.buffers[1].extensions?.EXT_meshopt_compression?.fallback !== true) throw new Error(`${size}: expected a meshopt model with a fallback buffer`);
    bufferTemplate ||= json.buffers;
    const base = binLen, fbBase = fallbackLen;
    const take = (offset, length) => { // copies a byte range into the merged chunk (4-aligned), returns its new offset
      const at = binLen; chunks.push(bin.subarray(offset, offset + length)); binLen += length;
      const padLen = (4 - (binLen % 4)) % 4; if (padLen) { chunks.push(Buffer.alloc(padLen)); binLen += padLen; }
      return at;
    };
    // the images: kept once by their bytes
    const imageMap = json.images.map((img) => {
      const bv = json.bufferViews[img.bufferView];
      if (bv.buffer !== 0 || bv.extensions) throw new Error(`${size}: an image that is not a plain view of the chunk`);
      const bytes = bin.subarray(bv.byteOffset, bv.byteOffset + bv.byteLength);
      const key = createHash('sha256').update(bytes).digest('hex');
      if (!imageByHash.has(key)) {
        const view = push(out.bufferViews, { buffer: 0, byteOffset: take(bv.byteOffset, bv.byteLength), byteLength: bv.byteLength });
        imageByHash.set(key, push(out.images, { mimeType: img.mimeType, bufferView: view }));
      }
      return imageByHash.get(key);
    });
    // the vertex and index views (the compressed bytes are copied whole, the views' offsets into the fallback buffer moved on)
    const imageViews = new Set(json.images.map((i) => i.bufferView));
    const viewMap = new Map();
    json.bufferViews.forEach((bv, i) => {
      if (imageViews.has(i)) return;
      const ext = bv.extensions?.EXT_meshopt_compression;
      if (!ext || ext.buffer !== 0) throw new Error(`${size}: bufferView ${i} is not a meshopt view`);
      const moved = { ...bv, buffer: 1, byteOffset: fbBase + bv.byteOffset, extensions: { EXT_meshopt_compression: { ...ext, byteOffset: take(ext.byteOffset, ext.byteLength) } } };
      viewMap.set(i, push(out.bufferViews, moved));
    });
    fallbackLen += json.buffers[1].byteLength;
    const accessorBase = out.accessors.length;
    for (const a of json.accessors) out.accessors.push({ ...a, bufferView: viewMap.get(a.bufferView) });
    const samplerMap = (json.samplers || []).map((s) => { const k = JSON.stringify(s); if (!samplerByKey.has(k)) samplerByKey.set(k, push(out.samplers, s)); return samplerByKey.get(k); });
    const extOf = (t) => ({ ...t, extensions: t.extensions && Object.fromEntries(Object.entries(t.extensions).map(([name, v]) => [name, { ...v, source: imageMap[v.source] }])) });
    const textureMap = (json.textures || []).map((t) => {
      const nt = extOf(t); if (nt.source !== undefined) nt.source = imageMap[nt.source]; if (nt.sampler !== undefined) nt.sampler = samplerMap[nt.sampler];
      const k = JSON.stringify(nt); if (!textureByKey.has(k)) textureByKey.set(k, push(out.textures, nt)); return textureByKey.get(k);
    });
    const mapTexInfo = (o) => (o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === 'index' ? textureMap[v] : mapTexInfo(v)])) : o);
    const materialBase = out.materials.length;
    for (const m of json.materials) out.materials.push(mapTexInfo(m));
    const meshBase = out.meshes.length;
    for (const m of json.meshes) out.meshes.push({ ...m, name: `${size}_${m.name}`, primitives: m.primitives.map((p) => ({ ...p, attributes: Object.fromEntries(Object.entries(p.attributes).map(([k, v]) => [k, v + accessorBase])), indices: p.indices === undefined ? undefined : p.indices + accessorBase, material: p.material === undefined ? undefined : p.material + materialBase })) });
    const nodeBase = out.nodes.length;
    for (const n of json.nodes) out.nodes.push({ ...n, name: `${size}_${n.name}`, mesh: n.mesh === undefined ? undefined : n.mesh + meshBase, children: n.children && n.children.map((c) => c + nodeBase) });
    for (const root of json.scenes[json.scene ?? 0].nodes) out.scenes[0].nodes.push(root + nodeBase);
    if (json.skins?.length || json.animations?.length || json.cameras?.length) throw new Error(`${size}: skins, animations and cameras are not handled`);
  }
  out.buffers = [{ byteLength: binLen }, { ...bufferTemplate[1], byteLength: fallbackLen }];
  if (!out.extensionsRequired.length) delete out.extensionsRequired;
  if (!out.samplers.length) delete out.samplers;
  return { json: JSON.parse(JSON.stringify(out)), bin: Buffer.concat(chunks) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  fs.mkdirSync(TO, { recursive: true });
  let before = 0, after = 0;
  for (const [file, sizes] of Object.entries(SPECIES)) {
    const models = sizes.map(([size, name]) => { const f = path.join(FROM, `${name}.glb`); before += fs.statSync(f).size; return [size, readGlb(f)]; });
    const { json, bin } = merge(models);
    const out = path.join(TO, `${file}.glb`);
    writeGlb(out, json, bin);
    after += fs.statSync(out).size;
    console.log(`${file}.glb: ${sizes.length} models ${models.reduce((t, [, m]) => t + m.bin.length, 0)} -> ${fs.statSync(out).size} bytes, ${json.images.length} image`);
  }
  console.log(`total ${before} -> ${after} bytes (${before - after} fewer)`);
  if (CHECK) {
    // every vertex attribute and index of every mesh, decoded (meshopt) and hashed, per size: the sources against the merged files
    const merged = {}, source = {};
    for (const [file, sizes] of Object.entries(SPECIES)) {
      Object.assign(merged, await decodedDigests(path.join(TO, `${file}.glb`), (n) => `${file}:${n}`));
      for (const [size, name] of sizes) Object.assign(source, await decodedDigests(path.join(FROM, `${name}.glb`), (n) => `${file}:${size}_${n}`));
    }
    const keys = Object.keys(source);
    const bad = keys.filter((k) => merged[k] !== source[k] || merged[k] === undefined);
    if (bad.length || Object.keys(merged).length !== keys.length) { console.error('MISMATCH', bad, Object.keys(merged).length, keys.length); process.exit(1); }
    console.log(`check: ${keys.length} decoded arrays (positions, normals, uvs, indices, material parameters, node transforms) identical`);
    if (opt('--digests')) fs.writeFileSync(opt('--digests'), JSON.stringify(source, null, 1) + '\n');
  }
}

/** { 'name/primitive/ATTRIBUTE': sha256 of its decoded values, '.../material': ..., '.../node': ... }, every name through `named` (a per-size source's names get their species and size put in front) */
export async function decodedDigests(file, named) {
  const { NodeIO } = await import('@gltf-transform/core');
  const { EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP } = await import('@gltf-transform/extensions');
  const { MeshoptDecoder } = await import('meshoptimizer');
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization, EXTTextureWebP]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(file);
  const sha = (x) => createHash('sha256').update(typeof x === 'string' ? x : Buffer.from(x.buffer, x.byteOffset, x.byteLength)).digest('hex');
  const out = {};
  for (const mesh of doc.getRoot().listMeshes()) mesh.listPrimitives().forEach((p, i) => {
    for (const sem of p.listSemantics()) { const a = p.getAttribute(sem); out[`${named(mesh.getName())}/${i}/${sem}`] = sha(a.getArray()) + `:${a.getComponentType()}:${a.getNormalized()}:${a.getType()}`; }
    out[`${named(mesh.getName())}/${i}/indices`] = sha(p.getIndices().getArray());
    const m = p.getMaterial();
    out[`${named(mesh.getName())}/${i}/material`] = sha(JSON.stringify([m.getBaseColorFactor(), m.getAlphaMode(), m.getAlphaCutoff(), m.getDoubleSided(), m.getRoughnessFactor(), m.getMetallicFactor(), m.getEmissiveFactor(), m.getBaseColorTexture() && sha(m.getBaseColorTexture().getImage()), m.getBaseColorTexture() && m.getBaseColorTextureInfo().getTexCoord()]));
  });
  for (const node of doc.getRoot().listNodes()) out[`${named(node.getName())}/node`] = sha(JSON.stringify([node.getMesh() && node.getMesh().getName() && true, node.getTranslation(), node.getRotation(), node.getScale()]));
  return out;
}
