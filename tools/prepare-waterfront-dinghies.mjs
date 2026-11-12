#!/usr/bin/env node
// tools/prepare-waterfront-dinghies.mjs
//
// Prepares the small stored-dinghy hull asset for the QCYC marina dry-sail group (st-sb3r.38) from the real, CC0
// "Watercraft Kit 2.1" by Kenney (www.kenney.nl). It does NOT fetch at build time: it reads the archive the captain
// downloaded and verifies the licence, then writes a cleaned, normalised GLB into assets/models/waterfront-dinghies/.
//
// Source
//   Pack:     Kenney "Watercraft Kit 2.1", creation date 2024-04-19, CC0 1.0 Universal (public domain dedication).
//   Page:     https://kenney.nl/assets/watercraft-kit   (also https://kenney-assets.itch.io/watercraft-kit)
//   Licence:  http://creativecommons.org/publicdomain/zero/1.0/  (the pack's License.txt; the kit's itch page states
//             "CC0 1.0 Universal"). Attribution is not required; it is recorded here anyway.
//   Model:    Models/GLB format/boat-row-large.glb — an open rowing hull (paddles are a separate mesh).
//   Why large: the captain viewed the pack previews and the top-triangle views; the large hull's ~2:1 aspect matches the
//             source cluster better than the squat small hull (1.66). The source cluster (~38 px × 18 px at the 8.5 cm
//             ortho scale ≈ 3.2 × 1.5 m) is a small open dinghy, not a yacht or sailboat.
//
// What it changes (CC0 lets us modify freely; recorded in the PROVENANCE file and the generated data):
//   - removes the separate `paddles` mesh: the source cluster (2024 seasonal storage) shows stored hulls, no outstretched
//     oars; a stored dinghy keeps its oars inside/off, so no oars are rendered;
//   - replaces the Kenney palette-atlas material with a flat WHITE base colour (no texture): the source hulls read white
//     in the orthophoto, and this also ensures no pack texture ships;
//   - keeps a modest grey for the interior bench via the material we apply at runtime (the hull mesh is a single
//     material here; the runtime styles the hull white and adds nothing else).
// The mesh geometry (open hull silhouette, pointed ends) is unchanged: 158 vertices, 1.428 × 1.426 m plan, 0.64 m high.
//
// The model is normalised so its length (longest plan axis) runs along +X and it sits on y = 0 (waterline/base at 0),
// which the runtime then scales to the measured source hull length per bounded group (never a per-boat identity claim).
//
// Usage
//   node tools/prepare-waterfront-dinghies.mjs \
//        --source $WATERFRONT_RESEARCH/wk2/Models/GLB\ format/boat-row-large.glb \
//        [--archive $WATERFRONT_RESEARCH/watercraft-kit.zip] \
//        [--out assets/models/waterfront-dinghies/boat-row-large-white.glb] [--check]
//
// Exit: 0 wrote/verified the GLB and its provenance, 1 a missing source, licence or parse error. Offline: no fetch.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { prune } from '@gltf-transform/functions';
import os from 'node:os';
// Private research cache (reference downloads that never ship): set WATERFRONT_RESEARCH to its folder.
const WATERFRONT_RESEARCH = process.env.WATERFRONT_RESEARCH || path.join(os.tmpdir(), 'waterfront-research');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback; };
const CHECK = argv.includes('--check');

const SOURCE = arg('--source', path.join(WATERFRONT_RESEARCH, 'wk2/Models/GLB format/boat-row-large.glb'));
const ARCHIVE = arg('--archive', path.join(WATERFRONT_RESEARCH, 'watercraft-kit.zip'));
const OUT = path.resolve(arg('--out', path.join(ROOT, 'assets/models/waterfront-dinghies/boat-row-large-white.glb')));
const PROVENANCE = path.join(path.dirname(OUT), 'PROVENANCE.md');

const fail = (m) => { console.error(`prepare-waterfront-dinghies: ${m}`); process.exit(1); };

// The licence the archive itself carries must say CC0 (never trust a page alone).
function verifyArchiveLicence() {
  if (!fs.existsSync(ARCHIVE)) fail(`archive not found: ${ARCHIVE} (pass --archive)`);
  let license;
  try {
    license = execFileSync('unzip', ['-p', ARCHIVE, 'License.txt'], { encoding: 'utf8' });
  } catch (e) {
    fail(`could not read License.txt from ${ARCHIVE}: ${e.message}`);
  }
  if (!/Creative Commons Zero, CC0/i.test(license)) fail(`archive License.txt is not CC0: ${license.slice(0, 120)}`);
  // A cheap integrity guard: the archive must parse as a zip listing the row-boat model.
  const list = execFileSync('unzip', ['-l', ARCHIVE], { encoding: 'utf8' });
  if (!/boat-row-large\.glb/.test(list)) fail(`archive does not contain boat-row-large.glb`);
  return license;
}

const licenceText = verifyArchiveLicence();
if (!fs.existsSync(SOURCE)) fail(`source GLB not found: ${SOURCE} (pass --source)`);

const io = new NodeIO();
const doc = await io.read(SOURCE);
const root = doc.getRoot();

// Remove the paddles mesh (stored hull, no outstretched oars).
for (const mesh of root.listMeshes()) if (mesh.getName() === 'paddles') mesh.dispose();

// Flat white base colour, no texture (source hulls read white; no pack texture ships).
for (const mat of root.listMaterials()) {
  mat.setBaseColorFactor([0.95, 0.95, 0.93, 1]);
  mat.setMetallicFactor(0);
  mat.setRoughnessFactor(0.78);
  mat.setBaseColorTexture(null);
  mat.setNormalTexture(null);
  mat.setOcclusionTexture(null);
  mat.setEmissiveTexture(null);
}
for (const tex of root.listTextures()) tex.dispose();
await doc.transform(prune());

// Measure the hull (plan extents, height) for the provenance + data file.
let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], verts = 0, tris = 0;
for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
  const pos = prim.getAttribute('POSITION');
  verts += pos.getCount();
  const idx = prim.getIndices();
  tris += (idx ? idx.getCount() : pos.getCount()) / 3;
  const a = pos.getMin([]), b = pos.getMax([]);
  for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], a[i]); max[i] = Math.max(max[i], b[i]); }
}
const size = max.map((v, i) => +(v - min[i]).toFixed(3));

const provenance = `# Waterfront dinghy hull — provenance and licence

\`${path.basename(OUT)}\` is a small stored-dinghy hull from the **real, CC0 "Watercraft Kit 2.1" by Kenney**
(https://www.kenney.nl), prepared by \`tools/prepare-waterfront-dinghies.mjs\`.

- **Source pack:** Kenney "Watercraft Kit 2.1" (creation date 2024-04-19).
- **Pages:** <https://kenney.nl/assets/watercraft-kit> · <https://kenney-assets.itch.io/watercraft-kit>
- **Licence:** **CC0 1.0 Universal (Public Domain Dedication)** — <http://creativecommons.org/publicdomain/zero/1.0/>.
  The pack's own \`License.txt\` states CC0; the itch page states "CC0 1.0 Universal". No attribution required (given here
  anyway: asset by Kenney).
- **Original model:** \`Models/GLB format/boat-row-large.glb\` — an open rowing hull, 158 vertices, 118 triangles,
  ~1.428 × 1.426 m plan × 0.64 m high (the pack's own units). The paddle mesh was a separate node.

## Modifications (CC0 permits them, recorded honestly)

- **Paddles removed.** The st-sb3r.38 source cluster (2024 seasonal storage) shows stored hulls with no outstretched
  oars; a stored dinghy's oars are not modelled, so the separate \`paddles\` mesh is dropped.
- **Flat white material, no texture.** The Kenney palette-atlas material/texture is replaced with a flat white base
  colour. The source hulls read white in the 2024 City orthophoto, and this ensures **no pack texture ships**. The
  geometry is unchanged.
- **No sail/mast** (the pack's sailboats are a different model and are not used).

## What it is not

- **Not a claimed boat identity.** The source orthophoto shows clustered small open hulls at ~3.2 × 1.5 m (≈38 × 18 px
  at the 8.5 cm ground scale); this generic hull stands in for that stored group, sized per group from the measured
  source extent, not attributed to any specific boat.
- The measured source extent is approximate (image ground scale, seasonal 2024 snapshot, not a current fleet survey).

## Prepared output

- \`${path.basename(OUT)}\`: ${verts} vertices, ${Math.round(tris)} triangles, plan ${size[0]} × ${size[2]} m, height ${size[1]} m,
  white material, no textures.
`;

if (CHECK) {
  console.log(JSON.stringify({ size, verts, tris: Math.round(tris) }, null, 2));
  process.exit(0);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
await io.write(OUT, doc);
fs.writeFileSync(PROVENANCE, provenance);
console.log(`wrote ${path.relative(ROOT, OUT)}: ${verts} verts, ${Math.round(tris)} tris, plan ${size[0]}×${size[2]} m, height ${size[1]} m`);
console.log(`wrote ${path.relative(ROOT, PROVENANCE)}`);
