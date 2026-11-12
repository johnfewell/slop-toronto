# Toronto Islands: source-constrained representative garden cover

Trial · 2026-11-10 · Bead **st-sb3r.37**. Follows the [low-vegetation source audit](waterfront-island-low-vegetation.md)
(`.35`). Phase 1 built the candidate data and georeferenced ortho preview; the captain reviewed the actual City 2024 ortho
over all 24 candidate patches and **accepted 8** (candidate indices 1, 2, 6, 7, 10, 13, 15, 16 — **263 cells**). This phase
adds a **bounded runtime trial** that plants instanced generic rounded shrubs on **only those 263 reviewed cells** — the
same instanced approach as `js/park-cover.js`, **no per-plant meshes**. The captain's later screenshot showed the first
trial reading as identical shrubs in regular grid rows (the cells are an evidence mask, not plant positions), so this
refine gives each cell a **deterministic representative height/width/yaw/jitter** that reads as natural patches while every
crown stays inside its original 1 m cell. It is **enabled by default** after source and desktop review, with `?islandGardens=0` as an opt-out.

Files this bead owns (no change to canopy, main, loader, city-config, controllers or cameras):

- `tools/build-island-garden-cover.mjs` — the builder (candidate data + ortho preview + overlay; now enforces the fixture).
- `js/waterfront-island-garden-cover-data.js` — generated candidate data + the frozen `reviewSelection`.
- `js/waterfront-island-garden-cover.js` — the runtime builder (`buildIslandGardenCover(scene)`), with camera-distance culling.
- `tests/waterfront-island-garden-cover.test.mjs` — focused review/data/runtime/variation contract (17 tests).
- `tools/data/island-garden-review.json` — the captain's **immutable** review fixture (hash + 8 patches + 263 cells + ortho extent).
- this document.

## 0. The review is hash-bound (integrity, not security)

The captain's acceptance is bound to the **exact candidate cell set** by a sha256 in the committed fixture
`tools/data/island-garden-review.json`: `dataCellsHash` = `sha256` over `patch:x10:z10` for every candidate cell in the
data's order, plus the 8 accepted patch indices and `expectedCells = 263`. The **builder loads that fixture** and compares
the freshly built candidate hash **exactly**; on a mismatch it **throws** (no data written) and asks for a **new review** —
it never rewrites the fixture or silently re-approves changed cells. On a match it copies the **frozen** review into the
generated data. The **runtime** recomputes the same hash from the committed data and plants only when it equals the
frozen review; a missing `crypto.subtle`, a null hash, a changed cell set or a wrong frame/projection are all **strict
no-ops** (no plants) — never an unchecked pass.

## 0b. Runtime API (captain wiring)

```js
const garden = await CITY.buildIslandGardenCover(scene); // adds its hidden group to `scene`, returns a handle
// each frame:
garden?.update(camera.position);
// update handles visibility; main can omit the builder with ?islandGardens=0.
```

- **Returns** `{ group, update(cameraPosition), layout, patchBounds, dispose(), status, hash }`, or **`null`** on any
  disqualifying gate (wrong frame/projection, absent data, hash/set mismatch, no crypto, reviewed cells outside frame).
- **`update`** sets park-cover's **shared viewer uniform** from the camera (via `parkCover.updateShrubViewer`, because
  High Park's own update only sets it inside High Park's box) and uses the distance to the **nearest reviewed patch** (the
  island is ~2.5 km from the world origin, so an origin-distance test would always cull) to decide the whole layer's
  visibility within `CULL_M = 150` (+24 m hysteresis). It returns the nearest-patch distance.
- **Rounded foliage, reused from park-cover:** each shrub is the **14-card rounded crown** from
  `js/park-cover.js`'s `shrubGeometry(true)`/`shrubMaterial(true)` (the same procedural leaf atlas, near darkening and
  seasonal helper), not two flat cards. The shared `shrubGeometry`/`shrubMaterial` are exported for this reuse; nothing
  names a species (a generic `TILE 4` broadleaf foliation).
- **LOD is per-instance, not per-mesh:** near and far are **distinct** InstancedMeshes with **complementary per-instance
  `aShrubFade`** (`near = [-1e6, 1, LOD_NEAR_M, 14]`, `far = [LOD_NEAR_M, 14, CULL_M, 24]`, matching park-cover's
  `buildShrubs`). Both meshes stay `visible` inside the overall cull; the shader dithers each instance by its distance,
  so there is no hole for far patches and no hard near/far switch. One draw call each, **no per-plant mesh**.
- **Ground:** the instance origin Y is `CITY.islandVergeSurfaceAt(x, z)?.h` when available (the committed rendered
  surface), else 0; the material's centre attribute includes that ground Y. **No ground height is changed.**
- **Representative variation, inside the original cell:** the raster cells are an **evidence mask**, not individual plant
  positions. A first trial planted one fixed height/width at each cell centre, which the captain's screenshot showed
  reading as identical shrubs in a regular grid. Now each accepted cell gets a **deterministic, stable-hash representative
  figure** — a height in `0.65–1.2 m`, a crown radius in `0.24–0.4 m`, a secondary width scale `0.78–1.0` and a full
  yaw — plus a small within-cell jitter (`≤ 0.09 m`). The four draws come from independent hash channels, so adjacent
  cells differ like a natural patch (measured mean adjacent `|Δheight| ≈ 0.185 m`, close to the independent-uniform
  `range/3`), not a plantation. Nothing here invents species or flowers: it is the same generic `TILE 4` broadleaf
  foliation, only sized/placed with real variation.
- **Inside the original 1 m cell:** the mounted crown's **true** horizontal reach is measured from the geometry's real
  vertices after this cell's scale and yaw, then added to the jitter: `jitter + reach ≤ cellInradiusM (0.5 m)` for every
  placed shrub (measured worst case 0.472–0.479 m). So a varied crown never spills into an unapproved cell or a path, and
  the **approved cells / placement mask / hash are unchanged** — variation changes only each shrub's figure within its
  own cell. A patch is still never filled as a bbox.
- **Footprint vs clearance:** the largest possible per-cell footprint (`maxCrownRadiusM 0.4 + maxJitterM 0.09 = 0.49 m`)
  stays inside the coarse 1 m cell half-width (0.5 m) and the reviewed cells' clearance (audit excluded pavement +0.6 m
  and buildings +1 m; min remaining paved-edge clearance over the 263 cells is 0.97 m).
- **Deterministic rebuild:** the per-cell figure is derived only from each cell's stable integer hash, so **every rebuild
  places the same shrubs** — no per-rebuild randomness. The build also **measures** the placed reach (real geometry verts)
  and exposes `maxCellOffsetM` on the handle; the focused tests assert `≤ 0.5 m` on the real build.
- **Idempotent**: a second call returns the same live handle; `dispose()` detaches, disposes **this trial's own** near/far
  materials (each `shrubMaterial` call makes a new one) and geometries, leaves the shared atlas texture to park-cover,
  and clears the handle so a later build is fresh.
- **No collider, no path/routing/width change.**

## 1. What is and is not claimed

- **Generic low vegetation, explicitly a photo-informed approximation.** NOT species, NOT hedges, NOT flowerbeds.
- **No understory inferred from tall returns.** A first-return DSM cannot see the ground under a closed ≥ 5 m canopy; the
  builder rejects any cell with a tall or nodata sub-sample instead of folding it in. So the candidate set is only what
  the lidar positively saw at low height, never a canopy extrapolation.
- **Surface band, not botany.** The 1–5 m band is a height above bare earth; it is a support/where-hint, not a plant ID.
- **Plant height/shape is an explicit approximation** (the data carries no measured plant height; the runtime uses a
  representative height band `0.65–1.2 m` and crown radius `0.24–0.4 m` per cell — an explicit approximation, never an
  observed 1–5 m plant's exact height/shape, and never a lidar-measured plant).
- **Variation is not new data.** The per-cell height/width/yaw/jitter is a deterministic representative read of the
  evidence mask; it does not claim that a shrub exists at a specific jittered point, only that a varied generic cover mass
  is drawn inside the reviewed cell.

## 2. Scope (bounded, photographed frontage only)

The candidate grid is sampled only where **all** hold, checked at **every** sub-sample of a 1 m cell footprint (not just
its centre):

- inside the **three accepted source-validated yard blocks 2914 / 2916 / 2918** (`js/waterfront-island-yard-materials.js`
  `islandYardCoverageAt`), and
- within **12 m** of the mapped **Oneida or Ojibway** centre line, and
- **outside** every actual OSM building polygon AND every **rendered** building footprint plus **1 m**, and
- **off** every mapped lane's paved strip (narrowed Oneida 3.3 m / Ojibway 3.5 m, else the lane's own width) plus **0.6 m**
  clearance, and
- **off** committed water (the lake's land holes respected).

## 3. The strict low-support rule

A candidate coarse cell is 1.0 m (a 2×2 cluster of the 0.5 m lidar samples). It qualifies only when:

- **≥ 3 of 4 sub-samples** are in the 1–5 m low band (a strict majority — 2 of 4 can never pass), and
- **no** sub-sample is tall (≥ 5 m) and **no** sub-sample is nodata.

The whole footprint (all four sub-samples) must also pass the corridor, eligible-block and exclusion gates. This is the
fix from the captain's midway review: `MAJORITY = 0.5` with `>=` admitted 2-of-4 and 2-tall cells; it is now `≥ 3 of 4`,
with any tall/nodata sub-sample rejecting the cell.

## 4. Candidate result (fresh run on the cached tiles)

Corridor box sampled = **52,430** coarse cells. Gated to the corridor: 10,817; to the accepted yard blocks: 8,472.
Excluded: **87** building (+1 m), **1,340** pavement (+0.6 m clearance), 0 water. Of the rest: **459 low**,
5,676 tall (rejected — no understory), 910 below, 0 nodata.

After grouping into patches (3 m link) and keeping only patches of **≥ 4 cells (≥ 4 m²)**:

| | Value |
| --- | --- |
| candidate cells | **419** (each 1.0 m²) |
| candidate area | **419 m²** |
| patches | **24** |
| cells per patch | 4–94 |
| Oneida / Ojibway cells | 210 / 209 |

A patch carries **no plant rectangle**: its `extentX/extentZ` are review metadata only. The **accepted cells are the exact
plantable set** — a gap, path, building or water cut inside a patch's bounding box stays bare because the renderer plants
the cells, never the rectangle.

## 5. The georeferenced ortho preview (captain review)

`tools/build-island-garden-cover.mjs --ortho` requests the City of Toronto **2024 8 cm colour orthophoto** for the corridor
box *as `f=json`* and honours the **returned** extent (this is the important fix): ArcGIS silently **expands** the returned
extent when the requested bbox is not square for a 1024² image. Requesting `f=image` and assuming the requested bbox was the
image's extent was off by about **11 m ground per side** here (≈ 15 m in Mercator on each side). The builder now:

1. requests `f=json`,
2. reads the server's **actual `extent`** and `width`/`height`,
3. downloads the returned **`href`** image,
4. maps every world point through `world → lat/lon → Web Mercator → pixel` in that **actual** extent, and
5. reports **true ground metres per pixel** = Mercator metres × cos(latitude) at the image centre (**0.2901 m/px** here,
   not the ~0.386 naive value).

Outputs (under `/tmp`, not in the repo):

- `$WATERFRONT_RESEARCH/island-garden-cover-ortho-preview.png` — the returned 2024 ortho (897,748 B).
- `$WATERFRONT_RESEARCH/island-garden-cover-ortho-preview.svg` — the same image with each **accepted cell** drawn as a
  ~0.5 m box (Oneida cyan, Ojibway amber) and each **patch labelled `P0…P23`**, in the actual-extent pixel space.
- `$WATERFRONT_RESEARCH/island-garden-cover-preview.json` — the manifest: counts, budget, patch list, the request URL,
  **requested vs actual extent**, returned size, ground m/px, and the pixel coordinate of every accepted cell.

Source dates and rights are recorded in the preview JSON and in the data file: lidar GTA 2023 (Open Government Licence –
Ontario), ortho 2024 City of Toronto 8 cm (acquisition 26 Apr–30 May 2024, horizontal accuracy 0.16 m), OSM buildings
2026-11-10 (ODbL).

**The captain reviews these actual images** (the ortho PNG and the SVG overlay) and rejects any patch that is visibly a
roof, deck, shed, furniture or other structure. Only patches that survive that review may be kept for a runtime trial.

## 6. Reproduce

```sh
export DON_VALLEY_DTM=$WATERFRONT_RESEARCH/vegetation-cache
# data only (no network); byte-identical to js/waterfront-island-garden-cover-data.js
node tools/build-island-garden-cover.mjs --check
# data + ortho preview (fetches the City 2024 ortho f=json, honours the returned extent)
node tools/build-island-garden-cover.mjs --ortho
```

The lidar cache carries 23 DSM + 23 DTM tiles; `openDtm` verifies each against its manifest SHA-256. Recorded manifest
hashes, this run: DSM `7c1d5631cabc76b2b35d378c1d19978231c12855cee8cca0b87cd33c9e6ab619`, DTM
`afa491aca646ab03abe917f4d8803d1cd4d1e838ae22d61cecadc795b163ce5d` (also in the data file's
`source.lidar.manifestSha256`). The committed data file's SHA-256 is
`530198df7bd2c5b2608ac66e139a97cdf46dac9e65fd5ab4050f1cf6e20e9d09`; the ortho preview PNG's is
`6d55f2dfad564cdc8cee25181d34928e3b55efaf03e441f02005823dca4bc2b5`.

Focused tests:

```sh
node --test tests/waterfront-island-garden-cover.test.mjs   # 17 tests, pass (fast, no lidar cache needed)
```

They run on the **real** data and helper and prove: the data carries the **frozen** review (hash + 8 patches + 263
cells); the helper recomputes the hash and plants **only** the 263 reviewed cells; a **changed cell set is rejected** (no
silent re-approval) — a portable regression that needs no lidar cache; missing crypto / a null hash is a strict no-op; the
projection gate requires **every value finite** (a missing `ox` cannot coerce to 0 and match); a **wrong frame is a no-op**
and reviewed cells must be inside **both** the built and active frames; the LOD/culling distance is to the **nearest
reviewed patch** (not the origin); the render footprint stays inside the reviewed-cell clearance (no path/building spill);
the per-cell representative figure is **deterministic** across rebuilds and **varies** (heights/widths/yaws) so it reads
as natural patches; **every placed crown + jitter (measured on the real rounded geometry) stays inside the 0.5 m cell
half-width**, including the **measured `maxCellOffsetM`** on a real build; the raster cells stay the plant mask (**263
cells / hash unchanged**); neighbouring cells do **not** share one height; and a **real three.js build**
(`three/webgpu`) creates both InstancedMeshes with **distinct** near/far fade attributes, one instance per accepted cell,
**per-cell differing matrices** (not 263 copies), correct ground-Y placement and a shared-viewer set to the camera.

**Full regeneration is a manual audit step**, not a test: `node tools/build-island-garden-cover.mjs [--ortho]` needs the
lidar cache (`DON_VALLEY_DTM`) and takes ~45 s; it enforces the frozen fixture hash and throws on any cell-set change.
The committed data is verified by a separate `--check` run when the cache is present; the focused tests do **not**
require it.

## 7. Integration and limitations

The loader includes the data and helper. Main awaits the builder after ground construction and updates it with the
actual camera position every frame. Two instanced LOD meshes reuse the existing rounded foliage geometry and atlas;
there are no per-plant draw calls. Shared viewer uniforms are updated outside High Park as well.

The exact reviewed mask remains unchanged, but height, width, orientation and within-cell offsets are representative.
They are not measured individual plants or species. No hidden understory is inferred from tall lidar returns, no
flowers are invented, and the sixteen withheld candidate patches remain unplanted. Scope remains three reviewed
blocks along the two photographed lanes, not every island garden or the entire BIA.

Desktop `wave7-garden-natural` passed five views/checks. Captain inspected lane views and closeups after rejecting
the flat-card first draft and the identical-grid second draft. This is a stylized approximation with source-constrained
coverage, not a surveyed garden reconstruction. Runtime validation proves 263 accepted cells, camera-relative
visibility and far culling. Phone/default integration and final suite are recorded in the acceptance checkpoint below.

### Accepted checkpoint — 2026-11-10

Desktop `wave7-garden-natural` and default-enabled phone `wave7-garden-phone` each passed five views/checks;
closeups and lane views inspected. Phone used 412×915 CSS pixels, DPR 2.625, low quality. Final full suite:
**1,089 pass, 0 fail, 3 skip (1,092 total)**; focused garden 17/17. No performance budget is inferred from these captures.
Known `/live/vehicles`404 remains unrelated. No devserver restart, commit, push or deployment.
