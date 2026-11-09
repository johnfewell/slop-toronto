// tools/build-zoo-animals.mjs: the High Park Zoo's animal models (js/high-park-features.js, docs/high-park-zoo-animals.md)
// from Poly Pizza's free low-poly models (CC0 / CC-BY 3.0, each credited in CREDITS.md), as assets/zoo/<species>.glb.
//
//   node tools/build-zoo-animals.mjs [--raw <dir>] [--review <dir>]
//
// The raw downloads are not in the repository: each is Poly Pizza's GLB (https://static.poly.pizza/<resource>.glb) of
// the model page below, saved as <raw>/<poly pizza id>/model.glb (default ~/.cache/slop-toronto/zoo/downloads/models).
// Each download's SHA-256 is pinned: a changed file stops the build until its model and licence are reviewed again.
// Every model becomes one mesh the way the zoo draws it (one InstancedMesh per species, the park's vertex-colour
// material): its triangles in the rest pose (skinned models posed by their bind matrices), each triangle one colour (its
// texture's mean over the triangle, or its material's colour, linear), flat normals; faced to +z, centred on its feet
// at the origin and scaled to the species' real shoulder height (birds: their standing height). Textures, UVs, skins,
// animations and the rest are dropped; the geometry is meshopt-compressed (EXT_meshopt_compression, as assets/props/).
// A few species have no model of their own on Poly Pizza and take a near relative's, recoloured (RECOLOUR below).
// --review writes a side and a three-quarter view of each built model (a small software render) for checking.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, meshopt, prune, dedup } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { computeRig } from './zoo/rig.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const RAW = arg('--raw', path.join(os.homedir(), '.cache/slop-toronto/zoo/downloads/models'));
const REVIEW = arg('--review', null);
const OUT = path.join(root, 'assets/zoo');

// The species (the zoo's, docs/high-park-zoo-animals.md) and their models. size: the real shoulder height in metres
// (birds: standing height, `stand`), measured on the model as its back's highest point between `back` (fractions of its
// length, tail 0 to nose 1); yaw turns the model to face +z
export const MODELS = {
  bison: { id: '9sTrha-TxdS', title: 'Bison', author: 'Poly by Google', licence: 'CC-BY 3.0', sha256: '6572f297c68c36a7b3654ea719b78f4c08750a351f01600d2c8f41f8a7ff1d02', size: 1.7, back: [0.3, 0.65], yaw: 0 },
  llama: { id: '5XUgcfxfBWJ', title: 'Llama', author: 'Poly by Google', licence: 'CC-BY 3.0', sha256: 'c90e91408fbd83876bdbb6c2a287d1981ab9b01f63e16410ebafa0d366903bca', size: 1.1, back: [0.25, 0.6], yaw: 0 },
  reindeer: { id: 'tQdzbZ1Cmw', title: 'Stag', author: 'Quaternius', licence: 'CC0 1.0', sha256: '3c2df7c13a3d37c8660684e46aa1e5a2bf7e91a9b279983921d48bd93d0b67ed', size: 1.1, back: [0.12, 0.38], yaw: 0 },
  capybara: { id: '66d-mKAgF17', title: 'Capybara', author: 'Poly by Google', licence: 'CC-BY 3.0', sha256: '2e39a472e4fb7b81266a9bad59c0f56f950aca4603f32990f4388c5a602bd045', size: 0.5, back: [0.25, 0.7], yaw: 0 },
  emu: { id: 'dVhJSddeK67', title: 'Emu', author: 'Poly by Google', licence: 'CC-BY 3.0', sha256: 'dee2e4800f90d2254e73dc67a8d7690be1bd18982d1ff5ba9229a65d94cc3f84', size: 1.7, stand: true, back: [0.6, 1], yaw: 0 },
  mouflon: { id: 'fm86jjk4m7D', title: 'Ram', author: 'Poly by Google', licence: 'CC-BY 3.0', sha256: 'c175aeca75eabac17f90501eca6ba03a0910a09ee5b5beedc0ac66749286bffd', size: 0.72, back: [0.2, 0.5], yaw: 0 },
  barbary: { id: '4kUChlMv8Vp', title: 'Bighorn sheep', author: 'Poly by Google', licence: 'CC-BY 3.0', sha256: '0760f438e2cd81f58407ca39925e90e2091447203eafdce1884d582058dc85a2', size: 0.9, back: [0.2, 0.5], yaw: 0 },
  highland: { id: '26zM1outCr', title: 'Cow', author: 'Quaternius', licence: 'CC0 1.0', sha256: 'aa0dfbd619bc14838b48f6db02a56c2ee96f055930d957fcc5ef63af567b21ce', size: 1.2, back: [0.25, 0.7], yaw: 0,
    horns: { stretch: 2.3, lift: 1.1 } },
  yak: { id: 'a8PIIYwF7r', title: 'Bull', author: 'Quaternius', licence: 'CC0 1.0', sha256: '545642d15d4d062efb45915ac6e776c2b5921ff89de3544f65e450bbfd16ce16', size: 1.45, back: [0.25, 0.7], yaw: 0,
    horns: { stretch: 1.8, lift: 1.6 } },
  peafowl: { id: '1wqLCnNFCgv', title: 'Pheasant', author: 'Poly by Google', licence: 'CC-BY 3.0', sha256: 'cbd5db20305855c63dd4b613b219af8672f95e73fda4b52f7b779222016d1e4c', size: 0.95, stand: true, back: [0.7, 1], yaw: 0,
    // (the pheasant's raised tail lowered to trail behind like a peacock's folded train)
    bend: { u: 0.5, h: 0.45, angle: -0.6 } }
};

// --- colour helpers (linear <-> sRGB, HSL in sRGB)
const toS = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const toL = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const hex = (h) => [toL(((h >> 16) & 255) / 255), toL(((h >> 8) & 255) / 255), toL((h & 255) / 255)];
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const mixc = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
// (a colour of the same lightness as c, in the hue of `to`: keeps the model's shading and markings)
const tint = (c, to, keep = 0) => { const k = lum(c) / Math.max(1e-4, lum(to)); return mixc(to.map((v) => Math.min(1, v * k)), c, keep); };

// The near relatives, recoloured to the species (f: the triangle's centre, u along the body tail 0 to nose 1, h up 0-1
// of the height, s across -1..1; c its colour, linear). Each is the model's own markings, re-hued
export const RECOLOUR = {
  // the Quaternius stag as a reindeer: a greyer brown coat, the pale neck & rump kept, velvet-brown antlers
  reindeer: (c, f) => (f.h > 0.62 && f.u > 0.6 && lum(c) < 0.05 ? tint(c, hex(0x6b5442)) : lum(c) > 0.25 ? tint(c, hex(0xe8e0d0)) : tint(c, hex(0x6e5c4a), 0.25)),
  // the Bighorn as a Barbary sheep (aoudad): sandy tawny all over and paler, the horns kept
  barbary: (c) => (lum(c) > 0.3 ? c : tint(c, hex(0xb49c7c)).map((v) => Math.min(1, v * 3.2))),
  // Quaternius' cow as a West Highland cow: the brown coat red-ginger, the pale face too, the horns paler & longer-looking
  highland: (c, f, m) => (m === 'Horns' ? hex(0xddd2b8) : m === 'Main' ? tint(c, hex(0xa65a2c)) : m === 'Main_Light' ? hex(f.h < 0.35 ? 0x7a4626 : 0xb8703e) : m === 'Muzzle' ? hex(0x5a3a2a) : c),
  // Quaternius' bull as a yak: black-brown, the face & a band of the flank white like the zoo's piebald yaks
  yak: (c, f, m) => (m === 'Horns' ? hex(0xd8d0c0) : m === 'Main' ? (f.u > 0.82 && f.h > 0.45 ? hex(0xe2dccf) : hex(0x2b2420)) : m === 'Main_Light' ? hex(0x3a322c) : c),
  // the Poly ring-necked pheasant as a peacock: the head, neck & breast iridescent blue, the back bronze-green, the long
  // tail (a peacock's train, folded) green with darker bands
  peafowl: (c, f) => {
    if (f.u < 0.55) return mixc(hex(0x2c5434), hex(0x6a6a2c), Math.min(1, lum(c) * 1.5)); // the train
    if (f.u > 0.78 && f.h > 0.45) return lum(c) > 0.6 ? c : tint(c, hex(0x1d4fa8)); // head & neck (the eye-ring white kept)
    if (f.h < 0.2) return c; // the legs
    return tint(c, hex(0x5b6b38), 0.2); // the body
  }
};

// --- the source, posed and flattened to triangles with a colour each
const mat4mul = (a, b) => { const o = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k]; return o; };
const xf = (m, v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
async function decodeTexture(tex) {
  const { data, info } = await sharp(Buffer.from(tex.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}
const sampleTex = (T, u, v) => {
  const x = ((Math.floor((u - Math.floor(u)) * T.w) % T.w) + T.w) % T.w, y = ((Math.floor((v - Math.floor(v)) * T.h) % T.h) + T.h) % T.h;
  const i = (y * T.w + x) * 4;
  return [toL(T.data[i] / 255), toL(T.data[i + 1] / 255), toL(T.data[i + 2] / 255)];
};
// barycentric samples over a triangle: the centre, three towards the corners, three edge midpoints
const BARY = [[1 / 3, 1 / 3, 1 / 3], [2 / 3, 1 / 6, 1 / 6], [1 / 6, 2 / 3, 1 / 6], [1 / 6, 1 / 6, 2 / 3], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5]];

export async function flatten(doc) {
  const tris = []; // { p: [[x,y,z]x3], c: [r,g,b], m: material name }
  const texCache = new Map();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const skin = node.getSkin();
    const world = node.getWorldMatrix();
    let jointMats = null;
    if (skin) {
      const ibm = skin.getInverseBindMatrices();
      jointMats = skin.listJoints().map((j, k) => mat4mul(j.getWorldMatrix(), Array.from(ibm.getElement(k, []))));
    }
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      const P = prim.getAttribute('POSITION'), UV = prim.getAttribute('TEXCOORD_0'), COL = prim.getAttribute('COLOR_0');
      const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
      const mat = prim.getMaterial(), factor = mat ? mat.getBaseColorFactor() : [1, 1, 1, 1];
      const texRef = mat && mat.getBaseColorTexture();
      let T = null;
      if (texRef && UV) { if (!texCache.has(texRef)) texCache.set(texRef, await decodeTexture(texRef)); T = texCache.get(texRef); }
      // (a skinned model's joints by name, for each corner: tools/zoo/rig.mjs bends its neck and tail by them)
      const names = skin ? skin.listJoints().map((jn) => jn.getName()) : null;
      const bones = (i) => {
        if (!skin || !J || !W) return null;
        const j = J.getElement(i, []), w = W.getElement(i, []), o = {};
        for (let k = 0; k < 4; k++) if (w[k]) o[names[j[k]]] = (o[names[j[k]]] || 0) + w[k];
        return o;
      };
      const pos = (i) => {
        const v = P.getElement(i, []);
        if (!skin || !J || !W) return xf(world, v);
        const j = J.getElement(i, []), w = W.getElement(i, []);
        const o = [0, 0, 0];
        for (let k = 0; k < 4; k++) if (w[k]) { const q = xf(jointMats[j[k]], v); o[0] += q[0] * w[k]; o[1] += q[1] * w[k]; o[2] += q[2] * w[k]; }
        return o;
      };
      const idx = prim.getIndices();
      const n = idx ? idx.getCount() : P.getCount();
      for (let t = 0; t + 2 < n; t += 3) {
        const ia = [0, 1, 2].map((k) => (idx ? idx.getScalar(t + k) : t + k));
        let c = [factor[0], factor[1], factor[2]];
        if (T) {
          const uv = ia.map((i) => UV.getElement(i, []));
          const s = [0, 0, 0];
          for (const b of BARY) { const q = sampleTex(T, b[0] * uv[0][0] + b[1] * uv[1][0] + b[2] * uv[2][0], b[0] * uv[0][1] + b[1] * uv[1][1] + b[2] * uv[2][1]); s[0] += q[0]; s[1] += q[1]; s[2] += q[2]; }
          c = c.map((v, k) => (v * s[k]) / BARY.length);
        } else if (COL) {
          const s = [0, 0, 0];
          for (const i of ia) { const q = COL.getElement(i, []); s[0] += q[0]; s[1] += q[1]; s[2] += q[2]; }
          c = c.map((v, k) => (v * s[k]) / 3);
        }
        tris.push({ p: ia.map(pos), c, m: mat ? mat.getName() : '', ...(skin ? { bw: ia.map(bones) } : {}) });
      }
    }
  }
  return tris;
}

// --- fit: yaw to +z, the model's up kept (+y), on its feet at the origin, scaled to the species' size
export function fit(tris, spec) {
  const cs = Math.cos(spec.yaw), sn = Math.sin(spec.yaw);
  for (const t of tris) t.p = t.p.map(([x, y, z]) => [x * cs + z * sn, y, -x * sn + z * cs]);
  const bounds = () => {
    const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
    for (const t of tris) for (const [x, y, z] of t.p) { b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); b.z0 = Math.min(b.z0, z); b.z1 = Math.max(b.z1, z); }
    return b;
  };
  let bb = bounds();
  if (spec.bend) {
    // (everything behind the pivot turned about it, across the body's axis)
    const { u, h, angle } = spec.bend, pz = bb.z0 + (bb.z1 - bb.z0) * u, py = bb.y0 + (bb.y1 - bb.y0) * h, c = Math.cos(angle), s = Math.sin(angle);
    for (const t of tris) t.p = t.p.map(([x, y, z]) => (z >= pz ? [x, y, z] : [x, py + (y - py) * c - (z - pz) * s, pz + (y - py) * s + (z - pz) * c]));
    bb = bounds();
  }
  const L = bb.z1 - bb.z0;
  // (the back's highest point in its stretch of the body; a bird's head's)
  let measure = 0;
  for (const t of tris) for (const [, y, z] of t.p) { const u = (z - bb.z0) / L; if (u >= spec.back[0] && u <= spec.back[1]) measure = Math.max(measure, y - bb.y0); }
  const k = spec.size / measure;
  // (centred on its feet: the footprint's middle across, the legs' middle along: the lowest tenth's extent)
  let fx0 = Infinity, fx1 = -Infinity, fz0 = Infinity, fz1 = -Infinity;
  const foot = bb.y0 + (bb.y1 - bb.y0) * 0.1;
  for (const t of tris) for (const [x, y, z] of t.p) if (y < foot) { fx0 = Math.min(fx0, x); fx1 = Math.max(fx1, x); fz0 = Math.min(fz0, z); fz1 = Math.max(fz1, z); }
  const ox = (fx0 + fx1) / 2, oz = (fz0 + fz1) / 2;
  for (const t of tris) {
    // (where the triangle is on the body, for the recolouring)
    const cx = (t.p[0][0] + t.p[1][0] + t.p[2][0]) / 3, cy = (t.p[0][1] + t.p[1][1] + t.p[2][1]) / 3, cz = (t.p[0][2] + t.p[1][2] + t.p[2][2]) / 3;
    t.f = { u: (cz - bb.z0) / L, h: (cy - bb.y0) / (bb.y1 - bb.y0), s: (2 * (cx - bb.x0)) / (bb.x1 - bb.x0) - 1 };
    t.p = t.p.map(([x, y, z]) => [(x - ox) * k, (y - bb.y0) * k, (z - oz) * k]);
  }
  return { k, measure, bb, size: { w: (bb.x1 - bb.x0) * k, h: (bb.y1 - bb.y0) * k, l: L * k } };
}

// (Quaternius' cattle have stubby horns: a Highland cow's and a yak's sweep out and up. Each horn's vertices are
// pushed out across the head by `stretch` times their distance from the horn's root, and lifted with its square)
export function stretchHorns(tris, { stretch, lift }) {
  const horn = tris.filter((t) => t.m === 'Horns');
  const root = { '-1': Infinity, 1: Infinity };
  for (const t of horn) for (const [x] of t.p) { const s = Math.sign(x) || 1; root[s] = Math.min(root[s], Math.abs(x)); }
  for (const t of horn) t.p = t.p.map(([x, y, z]) => { const s = Math.sign(x) || 1, d = Math.abs(x) - root[s]; return [s * (root[s] + d * stretch), y + lift * d * d * stretch, z]; });
}

// --- the output: one mesh, POSITION / NORMAL (flat) / COLOR_0, welded, meshopt
async function writeGlb(tris, file, name, rig) {
  const pos = new Float32Array(tris.length * 9), nrm = new Float32Array(tris.length * 9), col = new Float32Array(tris.length * 9);
  const anim = new Float32Array(tris.length * 12);
  tris.forEach((t, i) => {
    const [a, b, c] = t.p;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (let k = 0; k < 3; k++) { pos.set(t.p[k], i * 9 + k * 3); nrm.set([nx, ny, nz], i * 9 + k * 3); col.set(t.c.map((v) => Math.min(1, Math.max(0, v))), i * 9 + k * 3); anim.set(rig.attr[i][k], i * 12 + k * 4); }
  });
  const doc = new Document();
  const buf = doc.createBuffer();
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buf))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buf))
    .setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(col).setBuffer(buf))
    // (the rig's weights, tools/zoo/rig.mjs, 0-1: quantized like the colours, to 12 bits)
    .setAttribute('_ZOOA', doc.createAccessor().setType('VEC4').setArray(anim).setBuffer(buf))
    .setMaterial(doc.createMaterial(name).setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.85).setMetallicFactor(0));
  // (the rig's hinges and gait, metres and radians, as the node's extras: the loader's userData.zooRig)
  const round = (v) => (Array.isArray(v) ? v.map(round) : typeof v === 'number' ? +v.toFixed(4) : v);
  const zooRig = Object.fromEntries(Object.entries(rig.params).map(([k, v]) => [k, round(v)]));
  doc.createScene().addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)).setExtras({ zooRig }));
  await doc.transform(weld(), dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  await io.write(file, doc);
  return fs.statSync(file).size;
}

// --- a small software render for review: orthographic, lambert under a sun, the shoulder height as a red line
export async function render(tris, spec, file) {
  const W = 960, H = 400, half = W / 2;
  const img = new Float32Array(W * H * 3).fill(0), zb = new Float32Array(W * H).fill(Infinity);
  for (let i = 0; i < W * H; i++) { const y = Math.floor(i / W); img.set(y > H * 0.82 ? [0.12, 0.16, 0.08] : [0.42, 0.5, 0.58], i * 3); }
  let ext = 0;
  for (const t of tris) for (const [x, y, z] of t.p) ext = Math.max(ext, Math.abs(x), Math.abs(z), y);
  const scale = (H * 0.72) / Math.max(ext * 1.1, spec.size * 1.3);
  const sun = (() => { const v = [0.4, 0.8, 0.45]; const l = Math.hypot(...v); return v.map((c) => c / l); })();
  const views = [(p) => [p[2], p[1], -p[0]], (p) => { const a = -0.75; const x = p[0] * Math.cos(a) + p[2] * Math.sin(a), z = -p[0] * Math.sin(a) + p[2] * Math.cos(a); return [x, p[1] * 0.97 - z * 0.12, -z]; }];
  views.forEach((view, vi) => {
    const ox = vi * half + half / 2, oy = H * 0.82;
    for (const t of tris) {
      const [a, b, c] = t.p;
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
      const d = Math.abs((nx * sun[0] + ny * sun[1] + nz * sun[2]) / l);
      const shade = t.c.map((v) => v * (0.25 + 0.85 * d));
      const q = t.p.map((p) => { const r = view(p); return [ox + r[0] * scale, oy - r[1] * scale, r[2]]; });
      const minx = Math.max(vi * half, Math.floor(Math.min(q[0][0], q[1][0], q[2][0]))), maxx = Math.min(vi * half + half - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0])));
      const miny = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1]))), maxy = Math.min(H - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1])));
      const area = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]);
      if (Math.abs(area) < 1e-9) continue;
      for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((q[1][0] - px) * (q[2][1] - py) - (q[2][0] - px) * (q[1][1] - py)) / area;
        const w1 = ((q[2][0] - px) * (q[0][1] - py) - (q[0][0] - px) * (q[2][1] - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * q[0][2] + w1 * q[1][2] + w2 * q[2][2], i = y * W + x;
        if (z < zb[i]) { zb[i] = z; img.set(shade, i * 3); }
      }
    }
    // the species' shoulder height (or standing height)
    const ly = Math.round(oy - spec.size * scale);
    for (let x = vi * half + 10; x < vi * half + half - 10; x += 2) img.set([0.8, 0.05, 0.05], (ly * W + x) * 3);
  });
  const out = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H * 3; i++) out[i] = Math.round(255 * toS(Math.min(1, img[i])));
  await sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toFile(file);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  fs.mkdirSync(OUT, { recursive: true });
  if (REVIEW) fs.mkdirSync(REVIEW, { recursive: true });
  const only = arg('--only', null);
  let total = 0;
  const report = {};
  for (const [species, spec] of Object.entries(MODELS)) {
    if (only && !only.split(',').includes(species)) continue;
    const src = path.join(RAW, spec.id, 'model.glb');
    if (!fs.existsSync(src)) throw new Error(`${species}: ${src} missing; download https://poly.pizza/m/${spec.id} (its GLB) there`);
    const bytes = fs.readFileSync(src), sha = createHash('sha256').update(bytes).digest('hex');
    if (spec.sha256 && sha !== spec.sha256) throw new Error(`${species}: ${src} changed (${sha}); review the model and its licence before updating the pin`);
    const tris = await flatten(await io.readBinary(new Uint8Array(bytes)));
    const fitted = fit(tris, spec);
    if (spec.horns) stretchHorns(tris, spec.horns);
    const re = RECOLOUR[species];
    if (re) for (const t of tris) t.c = re(t.c, t.f, t.m);
    const file = path.join(OUT, `${species}.glb`);
    const rig = computeRig(tris, species);
    const size = await writeGlb(tris, file, `zoo-${species}`, rig);
    total += size;
    report[species] = { tris: tris.length, bytes: size, sha256: sha, rig: rig.stats, ...Object.fromEntries(Object.entries(fitted.size).map(([k, v]) => [k, +v.toFixed(2)])), scale: +fitted.k.toFixed(5) };
    console.log(`[zoo] ${species}: ${spec.title} by ${spec.author} (${spec.licence}), ${tris.length} triangles, ${(size / 1024).toFixed(1)} KB, ${fitted.size.l.toFixed(2)} m long, ${fitted.size.h.toFixed(2)} m tall, ${fitted.size.w.toFixed(2)} m wide${spec.sha256 ? '' : `, sha256 ${sha}`}`);
    if (REVIEW) await render(tris, spec, path.join(REVIEW, `${species}.png`));
  }
  console.log(`[zoo] ${Object.keys(report).length} models, ${(total / 1024).toFixed(1)} KB`);
  if (REVIEW) fs.writeFileSync(path.join(REVIEW, 'build.json'), JSON.stringify(report, null, 1));
}
