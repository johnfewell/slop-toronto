// tools/fix-glb-textures.mjs — drops material references to textures with no image (SketchUp textures Blender could not
// find when exporting), which three's GLTFLoader cannot load; those materials keep their base colour. Rewrites the GLB.
// usage: node tools/fix-glb-textures.mjs <file.glb>
import fs from 'node:fs';

const file = process.argv[2];
const b = fs.readFileSync(file);
const jsonLen = b.readUInt32LE(12);
const j = JSON.parse(b.subarray(20, 20 + jsonLen).toString('utf8'));
const bad = new Set((j.textures || []).map((t, i) => (t.source === undefined && !Object.values(t.extensions || {}).some((e) => e.source !== undefined) ? i : -1)).filter((i) => i >= 0));
let dropped = 0;
const scrub = (o) => {
  if (!o || typeof o !== 'object') return;
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object' && typeof v.index === 'number' && /Texture$/.test(k) && bad.has(v.index)) { delete o[k]; dropped++; } else scrub(v);
  }
};
for (const m of j.materials || []) scrub(m);
let json = Buffer.from(JSON.stringify(j), 'utf8');
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const rest = b.subarray(20 + jsonLen);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + rest.length, 8);
const chunk = Buffer.alloc(8);
chunk.writeUInt32LE(json.length, 0); chunk.writeUInt32LE(0x4e4f534a, 4);
fs.writeFileSync(file, Buffer.concat([header, chunk, json, rest]));
console.log(`[glb] ${file}: ${bad.size} textures without an image, ${dropped} material references dropped`);
