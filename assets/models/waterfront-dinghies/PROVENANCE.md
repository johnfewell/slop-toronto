# Waterfront dinghy hull — provenance and licence

`boat-row-large-white.glb` is a small stored-dinghy hull from the **real, CC0 "Watercraft Kit 2.1" by Kenney**
(https://www.kenney.nl), prepared by `tools/prepare-waterfront-dinghies.mjs`.

- **Source pack:** Kenney "Watercraft Kit 2.1" (creation date 2024-04-19).
- **Pages:** <https://kenney.nl/assets/watercraft-kit> · <https://kenney-assets.itch.io/watercraft-kit>
- **Licence:** **CC0 1.0 Universal (Public Domain Dedication)** — <http://creativecommons.org/publicdomain/zero/1.0/>.
  The pack's own `License.txt` states CC0; the itch page states "CC0 1.0 Universal". No attribution required (given here
  anyway: asset by Kenney).
- **Original model:** `Models/GLB format/boat-row-large.glb` — an open rowing hull, 158 vertices, 118 triangles,
  ~1.428 × 2.852 m plan × 0.64 m high (the pack's own units). The paddle mesh was a separate node.

## Modifications (CC0 permits them, recorded honestly)

- **Paddles removed.** The st-sb3r.38 source cluster (2024 seasonal storage) shows stored hulls with no outstretched
  oars; a stored dinghy's oars are not modelled, so the separate `paddles` mesh is dropped.
- **Flat white material, no texture.** The Kenney palette-atlas material/texture is replaced with a flat white base
  colour. The source hulls read white in the 2024 City orthophoto, and this ensures **no pack texture ships**. The
  geometry is unchanged.
- **No sail/mast** (the pack's sailboats are a different model and are not used).

## What it is not

- **Not a claimed boat identity.** The source orthophoto shows eight small open hulls; the corrected oriented
  measurements are 3.63–4.27 m long and 1.72–1.81 m wide. This generic model is scaled to each measured
  footprint, without attribution to a specific boat.
- The measured source extent is approximate (image ground scale, seasonal 2024 snapshot, not a current fleet survey).

## Prepared output

- `boat-row-large-white.glb`: 158 vertices, 118 triangles, plan 1.428 × 2.852 m, height 0.64 m,
  white material, no textures.
