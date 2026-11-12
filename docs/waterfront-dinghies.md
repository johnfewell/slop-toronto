# QCYC stored dinghies: a CC0 hull, source-georef placement, and runtime trial (st-sb3r.38)

The reviewed QCYC marina sheds (st-sb3r.33/.34/.36) stand in a mapped marina whose apron the 2024 City orthophoto shows
holding eight open dinghies. Phase 1 identified a real, freely licensed low-poly hull and traced the eight source hulls
from the georeferenced orthophoto with **PCA-oriented bounds** (each bright component is one individual diagonal hull). The
captain viewed the corrected placement preview (`$WATERFRONT_RESEARCH/dinghy-preview/placement.png`) and **approved these
exact 8 placements**. The runtime module `js/waterfront-dinghies.js` is integrated before controller construction,
with eight colliders and a static culling root. It is enabled by default; `?dinghies=0` disables it.

## Runtime API (`js/waterfront-dinghies.js`, phase 2)

```js
const d = await window.CITY.buildWaterfrontDinghies(THREE, scene);
d.group      // the InstancedMesh hull group (one draw); the captain may add a culling root
d.colliders  // 8 oriented-footprint colliders {minX,maxX,minZ,maxZ,minY,maxY, prop:true, kind:'dinghy', obb}
d.ready      // true when the real GLB loaded and the 8 instances were built
d.layout     // { count, placements, source, acquisition, licence, asset, hullLengthM, hullWidthM, geometry, frame, reason }
d.hulls      // per-instance { x, z, y, yaw, lengthM, widthM, height }
```

- **One InstancedMesh, one shared geometry, one shared material** (the real prepared white GLB, loaded once and merged to
  a single `BufferGeometry`). Real bound boxes/spheres are computed for culling.
- **Placement:** the 8 approved PCA placements (length 3.63–4.27 m, width 1.72–1.81 m), each hull scaled per instance
  (long axis → measured length, short axis → measured width).
- **Ground (no sidewalk hover):** each hull base sits at `CITY.islandVergeSurfaceAt(x,z).h` (the exact rendered/native
  surface the walkers use) when available, otherwise the marina's **flat ground y = 0** plus `CITY.cutAt`. It is **not**
  the raised mainland sidewalk offset (+0.22 m), which would hover the hulls ~22 cm. `d.hulls[i].y` exposes the ground
  height for the captain's ground probe.
- **Colliders:** each hull's real oriented footprint (the measured plan) with `minY` at the hull's ground y and `maxY`
  within the visual hull height (≤ 0.64 m), as ordinary `prop` colliders (the shared physics is untouched).
- **Missing asset / no placements is honest:** no GLTFLoader, no loader, no data, a mismatched frame projection, or
  **zero valid placements in the active frame** resolves to `{ ready:false, ... }` with an **empty group and no colliders**
  and a `reason` — and **no asset load** — **no invented/procedural fallback hull**; the scene stays exactly as it was.
- **Idempotent:** the build promise is cached, so repeated calls (or a repeat `scene.add`) reuse the same group/colliders
  and load the GLB once. Main calls it once; the guard only makes a repeat harmless.
- **Exact frame gate:** the data's recorded detail projection must match the active frame; a different projection is a
  no-op.
- A synchronous `waterfrontDinghiesLayout()` is provided for audits/tests (placements with no load and no scene).

`main.js` awaits the builder after ground construction and before controllers, appends its colliders,
and includes `WaterfrontDinghies` in static scene culling.

## Source

- **City of Toronto 2024 orthophoto** (8 cm colour, acquisition **26 Apr – 30 May 2024**), reference only, from the
  captain's georeferenced export (`nottawa-outliers-ortho2024.png/.json`): a 140 m × 140 m square at 1200 px
  (≈ 0.0845 ground m/px). The open dinghies cluster **east/south-east of the reviewed shed** (shed centre ≈ pixel
  807,368; hulls around pixels 843–938 × 396–486). This is a **2024 seasonal storage snapshot, not a current fleet**;
  **no exact boat identity** is claimed.
- The orthophoto is **reference only**: nothing from its pixels ships. The placement preview embeds the image for review and lives outside the repository under
  `$WATERFRONT_RESEARCH/dinghy-preview/`; the site build never ships it.

## The asset (real, CC0)

- **Kenney "Watercraft Kit 2.1"** (creation date 2024-04-19), **CC0 1.0 Universal** (public-domain dedication). The pack's
  own `License.txt` says CC0; the itch page states "CC0 1.0 Universal". No attribution required (given anyway).
- Model used: `Models/GLB format/boat-row-large.glb` — an **open rowing hull**. The captain viewed the pack's previews
  and top-triangle views: the large hull's near-2:1 aspect matches the source better than the squat small hull (1.66).
- Prepared by `tools/prepare-waterfront-dinghies.mjs` into `assets/models/waterfront-dinghies/boat-row-large-white.glb`:
  - **paddles removed** — the source storage cluster shows stored hulls with no outstretched oars;
  - **flat white material, no texture** — the source hulls read white, and this ensures **no pack texture ships**;
  - **no sail/mast** (the pack's sailboats are a different model, unused).
  - Prepared mesh: 158 vertices, 118 triangles, plan 1.428 × 2.852 m, height 0.64 m. Image of the pack start geometry and
    the provenance are recorded in `assets/models/waterfront-dinghies/PROVENANCE.md`.

The generic model is scaled to each source hull’s measured oriented dimensions (3.63–4.27 × 1.72–1.81 m),
without attributing it to a specific boat.

## Placement (measured from the source)

`tools/build-waterfront-dinghies.mjs` scans the captain-identified storage band, clusters the bright (white) hull tops,
measures each cluster's ground extent from the image's **own** ground scale, and rejects any cluster on water, a building
footprint, a mapped lane, or of implausible size. Rejected clusters are **dropped, never moved**.

- **8 bright components → 8 individual hulls.** Each component is a **single visible hull, lying diagonally** — not a
  merged storage row. An axis-aligned bounding box would inflate its width and lose the length/width split, so the
  builder measures each component with **PCA (principal eigenvector of the pixel scatter)**: the oriented extents along
  the principal axis and across it estimate the visible **length and width**, and the centroid of the oriented box gives the
  centre. This yields realistic open-dinghy dimensions, **length 3.6–4.3 m × width 1.7–1.8 m** (median ≈ 4.1 m), at a
  **diagonal orientation** (pixel principal axis ≈ 0.65, 0.76), matching the source cluster.
- **World yaw** comes from projecting a point along the *pixel* principal axis through `pixelToWorld` and measuring the
  world heading — not from the screen axes alone.
- **Full oriented-hull clearance:** the builder samples the hull's own oriented footprint (not just its centre) and
  requires every sample clear of buildings (≥ 0.3 m), mapped lanes (≥ 1.2 m), street trees (≥ 0.8 m) and water. Any hull
  that overhangs water or a lane is **rejected and counted, never nudged**. All 8 clear every gate and fall inside the
  OSM marina polygon (Way 193043084).

The plan is recorded in `js/waterfront-dinghies-data.js` (rows: `[x(dm), z(dm), yaw(mrad, world long-axis heading),
length(cm), width(cm), srcPxX, srcPxY, pixelAxisX, pixelAxisY]`), with the source counts, gates, asset plan and the
recorded marina way. `yaw` is the world heading (used by any future runtime); the pixel-axis columns drive the reference
preview only.

## Preview for review

The builder writes a reference preview **outside the repository** (default
`$WATERFRONT_RESEARCH/dinghy-preview/placement.svg/.png`): the source orthophoto dimmed, with each placed hull drawn as an
**outline-only** ellipse at its measured centre and **pixel** orientation (so the source hull stays visible inside), sized
from the oriented length/width. The PNG is rendered with **`rsvg-convert`** (ImageMagick's SVG renderer mis-rotates
ellipses). It embeds the copyright orthophoto, so it is **never committed and never shipped** to `dist/`.

## Verification

```sh
node --test tests/waterfront-dinghies.test.mjs
```

The suite is **portable** (no `/tmp`, no network, no silent skip): it loads the committed GLB through the real three.js
`GLTFLoader` and proves the data names the CC0 Kenney pack, the prepared white GLB and the 2024 City orthophoto; the 8
PCA placements are 3.6–4.3 m × 1.7–1.8 m with a diagonal pixel axis (unchanged); the GLB is a real white open hull with
**no paddles and no textures**; `buildWaterfrontDinghies` builds **one InstancedMesh of 8** with one shared
geometry/material, real bounds and **8 oriented colliders** whose `maxY` is within the visual hull; each transformed
instance sits on the ground and inside its collider; and a missing asset / loader / data / frame is a `ready:false` no-op
with **no invented fallback**. A manual source-backed audit (`node tools/build-waterfront-dinghies.mjs --out /tmp/x.js`)
reproduces the committed data byte-for-byte when the captain's `/tmp` ortho export is present (outside the default suite).

## Remaining limitations (honest)

- **Reference, not a survey.** The source is a 2024 seasonal storage snapshot; the cluster positions and plan dimensions are estimated
  from an 8 cm orthophoto at ~0.085 m/px; the 0.64 m height comes from the generic asset. No current fleet, exact boat model or per-boat identity is claimed.
- **Generic hull.** The Kenney hull is a stand-in for a stored open dinghy; it is not the specific boats in the photo, and
  the white/paddles-removed treatment is a documented CC0 adaptation, not a reconstruction.
- **Visual approximation.** The asset remains deliberately low polygon; source placement accuracy does not make its
  hull shape or the surrounding marina a surveyed reconstruction. Captures establish visual/function behavior, not a performance budget.

No dev-server restart, GPU run, commit or deploy was performed by the implementation model.

## Accepted capture checkpoint (2026-11-10)

Captain inspected source-overlay, desktop close/aerial/ground and phone close views. Desktop
`wave7-dinghy-tree` and default-enabled phone `wave7-dinghy-phone` each passed four captures/checks.
Runtime proves eight loaded hulls, eight registered colliders, and matching ground heights. Tree audit:
zero generic trunks removed and zero mapped conflicts; the apparent aerial sapling intersection was
foreground perspective overlap, not a trunk inside a hull. No surrounding trees were erased.

The focused portable suite passes 16/16. The full suite at the integrated garden/dinghy checkpoint
passed 1084, failed 0, skipped 3; the subsequent default-on gate change passed its focused suite.
Captured phone quality is low at 412×915 CSS pixels and DPR2.625; this is visual/function evidence,
not a frame-time budget. Known `/live/vehicles`404 remains unrelated.
