// Measures each Rocketbox avatar's real colours from its own textures (st-8p1p.3): what the procedural walker should
// wear so it reads as the same person on both sides of the switch distance.
//   node tools/rocketbox/sample-colours.mjs [work-dir]      (needs `basisu` on the PATH to unpack the KTX2 textures)
// For each assets/people/rocketbox/<id>_lod2.glb: the KTX2 images are cut out of the file and unpacked to PNG, then every
// triangle of the body mesh is assigned to a region by the bone that moves its vertices most (torso, sleeves, legs, hands,
// feet, head), the region's texels are sampled at the triangle's UVs, and the region's colour is the average of the texels
// near its most common colour (so a hoodie with a white panel reads as its blue, not as grey). The hair mesh gives the hair
// colour and how far it hangs. Prints the table that js/pedestrians.js (PERSON_LOOKS) holds, and writes <work-dir>/looks.json.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import * as THREE from 'three';
globalThis.self ??= globalThis; // (GLTFLoader reads self.URL)
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');

const root = new URL('../../assets/people/rocketbox/', import.meta.url).pathname;
const work = process.argv[2] ? path.resolve(process.argv[2]) : fs.mkdtempSync(path.join(os.tmpdir(), 'rbcolours-'));
fs.mkdirSync(work, { recursive: true });
const IDS = ['male-adult-01', 'male-adult-03', 'male-adult-10', 'male-adult-12', 'male-adult-17', 'male-adult-04', 'male-adult-15',
  'business-male-02', 'male-adult-08', 'business-male-04', 'female-adult-06', 'female-adult-08', 'female-adult-09', 'female-adult-11',
  'business-female-03', 'business-female-01', 'sports-female-02', 'female-adult-17', 'police-male-03']; // (js/rocketbox-pedestrians.js ALL_IDS order)

const hex = (c) => '0x' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

// the average of the texels near the most common colour (4 bits a channel bins)
function dominant(px) {
  if (!px.length) return [128, 128, 128];
  const bins = new Map();
  for (const p of px) {
    const k = (p[0] >> 4) * 256 + (p[1] >> 4) * 16 + (p[2] >> 4);
    bins.set(k, (bins.get(k) || 0) + 1);
  }
  let best = -1, n = 0;
  for (const [k, c] of bins) if (c > n) { n = c; best = k; }
  const mid = [(best >> 8) * 16 + 8, ((best >> 4) & 15) * 16 + 8, (best & 15) * 16 + 8];
  const near = px.filter((p) => Math.hypot(p[0] - mid[0], p[1] - mid[1], p[2] - mid[2]) < 44);
  const sum = [0, 0, 0];
  for (const p of near) { sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; }
  return sum.map((v) => v / near.length);
}

// the average of every texel (a striped shirt reads as its mean, not as its white stripe)
function mean(px) {
  const sum = [0, 0, 0];
  for (const p of px) { sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; }
  return sum.map((v) => v / Math.max(1, px.length));
}
const DRESS = new Set(['female-adult-11', 'business-female-03', 'female-adult-06', 'male-adult-15']); // (male-adult-15: a long kurta)
const HEAD_COVERING = new Set(['female-adult-06']); // (a white headscarf: the 'hair' is the head texture's colour) // (skirt or dress: the walker's coat reaches lower)
const TAILORED = new Set(['male-adult-03', 'business-female-03', 'police-male-03', 'business-female-01', 'business-male-02', 'business-male-04']); // (a jacket with lapels)
// Looked at by eye where the sampling cannot tell (hair cards sit on a black ground, so blonde and brown hair sample as black;
// male-adult-04's hands sample as black; business-male-04 is bald, so his 'hair' is his head's colour)
const HAIR_BY_EYE = { 'female-adult-17': [0xc8, 0xa4, 0x68], 'male-adult-08': [0x4a, 0x34, 0x24], 'business-male-04': [0xc1, 0x83, 0x67] };
const SKIN_BY_EYE = { 'male-adult-04': [0x9a, 0x6a, 0x4a] };
const FEMALE = (id) => /^(female|business-female|sports-female)/.test(id);

const out = {};
for (const id of (process.env.ONLY ? process.env.ONLY.split(',') : IDS)) {
  const glb = fs.readFileSync(`${root}${id}_lod2.glb`);
  const jl = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jl).toString());
  const binStart = 20 + jl + 8;
  // unpack the images
  const pngs = json.images.map((im, i) => {
    const bv = json.bufferViews[im.bufferView];
    const f = path.join(work, `${id}_img${i}.ktx2`);
    fs.writeFileSync(f, glb.subarray(binStart + (bv.byteOffset || 0), binStart + (bv.byteOffset || 0) + bv.byteLength));
    execFileSync('basisu', ['-unpack', '-no_ktx', f], { cwd: work, stdio: 'ignore' });
    return path.join(work, `${id}_img${i}_unpacked_rgb_BC7_RGBA_level_0_face_0_layer_0000.png`);
  });
  const imageOf = (mat) => json.textures[mat.pbrMetallicRoughness.baseColorTexture.index].extensions.KHR_texture_basisu.source;
  const textures = new Map();
  const texel = async (mi, u, v) => {
    const img = imageOf(json.materials[mi]);
    if (!textures.has(img)) {
      const { data, info } = await sharp(pngs[img]).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      textures.set(img, { data, w: info.width, h: info.height });
    }
    const t = textures.get(img);
    const x = Math.min(t.w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * t.w)));
    const y = Math.min(t.h - 1, Math.max(0, Math.floor((v - Math.floor(v)) * t.h)));
    const o = (y * t.w + x) * 3;
    return [t.data[o], t.data[o + 1], t.data[o + 2]];
  };

  // geometry only: the textures are measured above
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  loader.setKTX2Loader({ load: (u, onLoad) => onLoad(new THREE.Texture()), loadAsync: () => Promise.resolve(new THREE.Texture()), detectSupport() { return this; } });
  const gltf = await new Promise((res, rej) => loader.parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', res, rej));
  const regions = { top: [], sleeves: [], legs: [], hands: [], feet: [], head: [], hair: [] };
  let hairLow = Infinity, headTop = -Infinity, neckY = null;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((m) => {
    if (m.isBone && /Neck$/.test(m.name) && neckY === null) neckY = new THREE.Vector3().setFromMatrixPosition(m.matrixWorld).y;
  });
  const jobs = [];
  gltf.scene.traverse((m) => {
    if (!m.isSkinnedMesh) return;
    const g = m.geometry, pos = g.attributes.position, uv = g.attributes.uv, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const mat = m.material;
    const mi = json.materials.findIndex((x) => x.name === mat.name);
    const isHair = /opacity|hair/i.test(mat.name);
    const bones = m.skeleton.bones;
    const region = (vi) => {
      let best = '', w = 0;
      for (let k = 0; k < 4; k++) {
        const bw = sw.getComponent(vi, k);
        if (bw > w) { w = bw; best = bones[si.getComponent(vi, k)].name; }
      }
      return best;
    };
    const kind = (name) => (/Head|Neck|HeadNub/.test(name) ? 'head' : /Hand|Finger/.test(name) ? 'hands' : /Toe|Foot/.test(name) ? 'feet'
      : /Thigh|Calf/.test(name) ? 'legs' : /UpperArm|Forearm/.test(name) ? 'sleeves' : /Spine|Clavicle|Pelvis/.test(name) ? 'top' : 'top');
    const index = g.index;
    const n = index ? index.count : pos.count;
    const v = new THREE.Vector3();
    for (let t = 0; t < n; t += 3) {
      const a = index ? index.getX(t) : t, b = index ? index.getX(t + 1) : t + 1, c = index ? index.getX(t + 2) : t + 2;
      if (isHair) {
        for (const i of [a, b, c]) { v.fromBufferAttribute(pos, i); hairLow = Math.min(hairLow, v.y); headTop = Math.max(headTop, v.y); }
      }
      const reg = isHair ? 'hair' : /head/i.test(mat.name) ? 'head' : kind(region(a));
      for (const [wa, wb, wc] of [[1 / 3, 1 / 3, 1 / 3], [0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6], [0.45, 0.45, 0.1], [0.1, 0.45, 0.45]]) {
        jobs.push([mi, reg, uv.getX(a) * wa + uv.getX(b) * wb + uv.getX(c) * wc, uv.getY(a) * wa + uv.getY(b) * wb + uv.getY(c) * wc]);
      }
    }
  });
  for (const [mi, reg, u, v] of jobs) regions[reg].push(await texel(mi, u, v));
  const colours = {};
  for (const k of Object.keys(regions)) colours[k] = dominant(regions[k]);
  for (const k of ['top', 'legs']) colours[k] = dominant(regions[k]).map((v, i) => (v + mean(regions[k])[i]) / 2);
  colours.sleeves = colours.top;
  // (the avatars with no hair mesh have their hair painted on the head texture: dark)
  const hairColour = HEAD_COVERING.has(id) ? colours.head : regions.hair.length ? colours.hair : [26, 20, 16];
  if (HAIR_BY_EYE[id]) Object.assign(hairColour, HAIR_BY_EYE[id]);
  if (SKIN_BY_EYE[id]) colours.hands = SKIN_BY_EYE[id];
  const hairLen = headTop - hairLow;
  const w = HEAD_COVERING.has(id) ? 1 : FEMALE(id) ? (hairLen > 0.4 ? 1 : hairLen > 0.15 ? 0.7 : 0.3) : 0.25;
  out[id] = { top: hex(colours.top), sleeves: hex(colours.sleeves), legs: hex(colours.legs), skin: hex(colours.hands),
    feet: hex(colours.feet), hair: hex(hairColour), hairW: w, dress: DRESS.has(id), tailored: TAILORED.has(id), head: hex(colours.head), hairLow: regions.hair.length ? +(hairLow).toFixed(3) : null,
    samples: Object.fromEntries(Object.entries(regions).map(([k, v]) => [k, v.length])) };
  console.log(id, JSON.stringify(out[id]));
}
fs.writeFileSync(path.join(work, 'looks.json'), JSON.stringify(out, null, 2));
// the table js/pedestrians.js holds (PERSON_LOOKS), in the order of IDS
const col = (k) => `[${IDS.map((id) => out[id][k]).join(', ')}]`;
const num = (k) => `[${IDS.map((id) => out[id][k]).join(', ')}]`;
fs.writeFileSync(path.join(work, 'looks.js'), `const PERSON_LOOKS = {
  ids: ${JSON.stringify(IDS)},
  coat: ${col('top')},
  legs: ${col('legs')},
  skin: ${col('skin')},
  hair: ${col('hair')},
  shoes: ${col('feet')},
  hairLength: ${num('hairW')},
  dress: [${IDS.map((id) => (out[id].dress ? 1 : 0)).join(', ')}],
  tailored: [${IDS.map((id) => (out[id].tailored ? 1 : 0)).join(', ')}]
};
`);
console.log('wrote', path.join(work, 'looks.json'));
