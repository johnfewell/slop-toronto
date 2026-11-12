# Toronto Islands: source-backed Oneida/Ojibway cottage-yard materials

Bead **st-sb3r.29**. This pass changes the **material only** of the private cottage-yard ground (the `Yards` mesh) on the
three native residential blocks that border the photographed Algonquin Island living streets. The committed city ground
(`js/city-grid.js`) draws every curb island's plot with the one shared `createPlotGroundMaterial()`. That material is right
for a general city yard, but its arbitrary large-scale fbm "paved" swaths are wrong for the photographed Oneida/Ojibway
cottage frontages: the captain's GPU capture `wave7-width-review-island-ojibway-paving.png` shows broad white concrete
patches with tree trunks emerging from them, while the primary ground photographs show densely planted green cottage
gardens/trees beside narrow public paths. This module repaints the fragment shading of those yards toward a subdued
lawn/earth typology and leaves every other yard byte-for-byte native.

Implementation: `js/waterfront-island-yard-materials.js`, its focused tests, a loader entry in `explore.html`, and one composition hook on `plotMat` in `js/city-grid.js`. The existing batched ground geometry and mapped public paths are reused.

## 1. What the sources support (and what they do not)

The two photographed corridors are the ones already recorded in `ISLAND_LANES_DATA.summary.sourceProfile.photographs`:

| Photo | Mapped row | OSM way |
| --- | --- | --- |
| Oneida Avenue 2026 | Oneida Avenue (`living_street`) | 13541126 |
| Ojibway Avenue 2026 | Ojibway Avenue (`living_street`) | 13541122 |

The captain's visual observation is that these frontages are **densely planted green cottage gardens and trees beside
narrow public paths** (paraphrase, not a quote). The white concrete swaths in the capture are therefore a procedural
artifact of the shared plot material, not a surveyed path.

**Eligibility is evidence-gated.** A block is claimed only when all hold:

1. it is a native curb island (`js/city-config.js` `BLOCKS`; the module derives the identical list from the decoded binary
   `GEO.blocks` when `CITY.BLOCKS` is absent) whose yard is the `plot` category — not a median, not the park lawn
   (`park > 0.6`), not open/wild land (`wild > 0.5`), not the downtown-concrete catch;
2. it carries **source-validated residential/cottage profiles**: the committed OSM-matched `islandBuildingProfile` rows
   (`js/waterfront-island-buildings.js`, which enforces the active-frame + footprint + projection identity guards) give at
   least **3 matched buildings** and a **substantial residential/cottage majority (≥ 60 %)** — the same test
   `js/city-grid.js` `isPaved()` uses for its `.24` residential branch;
3. it **borders a photographed corridor**: its outline comes within the bounded corridor envelope of the actual Oneida or
   Ojibway centre line.

**Classifier counts** (binary geodata, `data/toronto-geodata.bin`; see §7). Eligible: **3 blocks — 2914, 2916, 2918**
(matched profiles 24/24/26, of which 23/24/26 residential; all matched heights 6.5 m; nearest corridor distances ≈ 1.7–1.8
m). Excluded near the lanes: **2908** (park/wild, 0 residential) and **2917** (a single matched profile, 41 % park). The
other twelve source-matched residential blocks on the islands do not border Oneida/Ojibway and are untouched.

**Honest limits.** The lawn/earth typology and the 12 m envelope are **source-informed approximations, not a survey**. No
exact garden footprints, fences, flowerbeds, driveways or species are invented. The colours are the native seasonal
palette helpers, not sampled from the photographs. The 33 mapped residential-canopy positions
(`js/waterfront-island-residential-canopy.js`) give bounded garden context (29 fall inside the effect region) but are not
a plant survey.

## 2. Scope: one bounded, intersected strip — never a whole block in grass

A whole Algonquin block is *not* a garden. The effect is therefore the **intersection** of the eligible native block
geometry with a bounded **12 m corridor envelope** of the photographed lane segments, plus a 1 m soft edge:

```
coverage(x, z) = insideEligibleBlockOrEdgeSupport(x, z) · clamp01(0.5 + (12 m − distanceToCorridor(x, z)) / 1 m)
```

- the **lane centre is roadway** (a different material/geometry): coverage is 0 there, so the street paving and the mapped
  sidewalks/paths stay exactly native;
- the **far block interior** (centroid) and every **non-eligible block** (including the park block 2908) are 0;
- off the corridor the yard keeps the original plot material.

The raster support covers a bounded strip: **≈ 9,520 m²** across the three blocks (whose combined area is ≈ 46,349 m²), i.e.
well under a quarter of the eligible block area. This is mask support area, including the sampling margin; actual rendered replacement is its intersection with the existing `Yards` meshes, not a measured garden area. This is the captain's scope review: bound the fragment effect to the
photographed frontage, do not reinterpret a whole island as garden.

### Block-edge support margin (fix for the thin native seam)

The first draft's block gate was a **hard binary** raster edge; sampled with the mask's manual bilinear it left a ~1 texel
partial-coverage halo exactly at the yard/curb boundary, so the native arbitrary concrete bled back as a thin
white/stippled triangular seam beside the lane (the captain's `wave7-yard-draft` review). The gate now carries a small
local **support margin of 1.5 m (~one texel)** on the eligible block outline only: the coverage stays 1 across the yard
mesh edge and a little beyond, so the bilinear halo lands on the walk band/curb (a different material) instead of the
yard. This is a documented raster-support margin, **not** an invented footprint and **not** a broadening to other blocks —
beyond the margin the yard is native, and the lane centre and the roadway gap between blocks stay 0. The support margin is
reported as `supportM` by `CITY.islandYardMaterialLayout()`.

## 3. The material hook (composed, no new draw calls)

`js/waterfront-island-yard-materials.js` exports:

```js
window.CITY.applyIslandYardMaterial(material) // -> the same material, composed
```

The captain calls it on the **existing shared plot material** right after it is created
(js/city-grid.js, beside the other `applyWaterfront*GroundMask` ground hooks):

```js
const plotMat = createPlotGroundMaterial();          // js/city-grid.js
window.CITY.applyIslandYardMaterial?.(plotMat);      // <- the captain's one-line seam
```

It:

- is **idempotent** (a second call is a no-op);
- is a **no-op** on a non-node material, when `CITY.TSL` is absent, when `ISLAND_LANES_DATA`/`ISLAND_BUILDINGS_DATA` is
  missing, when the source builds were not made in the active frame/projection, or when no block is eligible;
- composes the yard colour, roughness and normal over the material's existing `colorNode` / `roughnessNode` /
  `normalNode` with `mix(native, yard, coverage)`, so off-mask the native plot material is untouched and a material that
  never set an optional channel stays native (the engine `materialColor` / `materialRoughness` / `materialNormal` defaults
  are the fallback);
- **never** sets `maskNode`, adds geometry, moves the ground plane, or changes routing, widths, colliders or road paint.

Because the captain keeps the single batched `Yards` mesh and the single shared `plotMat`, there are **no extra draw
calls** and no new material library variant.

## 4. The bounded fragment mask

At build time (CPU, once) the module rasterizes a small `Float32` RGBA texture over the **intersection box** of the
eligible-block union and the corridor envelope box, plus a 2 m pad. Each texel stores the coverage field of §2 in `R`.
The mask is bounded and small — the actual dimensions and bytes are reported by `CITY.islandYardMaterialLayout().texture`
(currently **218 × 249 texels, 868,512 bytes**).

- **NearestFilter + manual bilinear.** WebGPU `float32` texture filtering is an optional feature, so the shader never asks
  the sampler to filter the `Float32` texture. It samples four nearest texels with `textureLoad` and weights them by the
  fractional coordinate, exactly as `js/waterfront-island-road-materials.js` does.
- **CPU/GPU parity.** `CITY.islandYardMaskSample(x, z)` bilinearly interpolates the *same* `Float32` values the shader's
  manual bilinear interpolates, so it is a meaningful parity check, not a nearest-texel approximation.
- **Bounded, not thousands of per-fragment line tests.** The classifier and the intersection are resolved once on the CPU
  into the small mask; the fragment shader runs only the bilinear texture fetch. This follows the captain's guidance.

## 5. The yard shading

The composed yard colour is built on the **native plot palette** so it belongs to the same family as the adjacent native
lawns: lawn `mix(0x4f7a2c, 0x6f8a38)` and beds `mix(0x4a3524, 0x5c4430)` through a local value-noise idiom, mostly lawn
with a little bare earth, then the shared `seasonalGrass` and `snowOver` helpers (when loaded) so the yard follows the
season and lying snow. The normal is a gentle turf relief that fades with the pixel footprint. No flowerbed, fence,
driveway or per-house colour is drawn.

## 6. TSL types

Comparisons produce bool nodes; the coverage blend uses `mix()` with the float coverage (a bool is never fed to `mix`).
The graph is built with the vendored `three/tsl` and is exercised in the test suite with the **real** node system. Graph
construction does not evaluate the deferred shader; **only an actual GPU compile proves the final shader**, which the
captain runs.

## 7. Verification

```sh
node --test tests/waterfront-island-yard-materials.test.mjs
```

The focused suite (14 tests, all passing) proves, on the real generated lane data, the real source-matched building
profiles and the committed **binary** geodata:

- the two corridors bind to the correct per-way Oneida/Ojibway OSM ways, and only those two;
- the classifier claims **exactly blocks 2914, 2916, 2918** (each ≥ 3 matched, residential majority, cottage height,
  bordering a corridor within the envelope) and excludes the weak park block **2917** and the park/wild block **2908** —
  identical whether the module derives the blocks from the binary `GEO.blocks` or reads the browser's `CITY.BLOCKS`;
- the effect is the **intersection**: the lane centre (roadway) is 0, the eligible yard beside the lane is ~1, the far
  block interior and the park block and the mainland are 0;
- the **block-edge support margin** fills the raster halo: the block boundary (and a probe just *outside* it, on the gap
  side within the margin) is fully covered, while a point beyond the support margin toward the roadway and a point inside
  the block but beyond the 12 m corridor envelope are 0 (native);
- the replaced area is a bounded strip (< ¼ of the eligible blocks, < 20,000 m²);
- the mask is small and its real dims/bytes are reported; the sampler is null outside the mask box;
- a projection mismatch, an unsupported frame, absent lanes data or absent source profiles is a strict no-op;
- the hook is a no-op without TSL / on a non-node material, composes against the real native channels with the **real**
  `three/tsl` node system, records its application, is idempotent, never sets `maskNode`, and authors no geometry;
- the 33 mapped residential-canopy points give bounded garden context inside the effect region (≥ 25 covered).

The focused suite passes all 14 tests. Final integrated `npm test` passes 1,001 tests, zero failures and three skips (1,004 total), recorded in `$WATERFRONT_RESEARCH/wave7-yard-final-full-tests.log`. No commit or deployment was made.

## 8. Runtime integration (the captain's seam)

1. Load `js/waterfront-island-yard-materials.js` in `explore.html` after `js/waterfront-island-lanes-data.js` /
   `js/waterfront-island-buildings.js` and after `js/tsl-materials.js` (so `CITY.TSL`, `createPlotGroundMaterial`,
   `seasonalGrass` and `snowOver` exist).
2. In `js/city-grid.js`, call `window.CITY.applyIslandYardMaterial?.(plotMat)` immediately after
   `const plotMat = createPlotGroundMaterial();` (line 1022). No geometry, bucket or merged-material change; the same
   batched `Yards` mesh and `plotMat` are reused.

Build `caaf38d94c91` passed `wave7-yard-final` desktop/high/detail (eight checks) and `wave7-yard-phone` at 412×915 / DPR 2.625 / low quality (seven checks), both on the Mac mini. The captain inspected matching Oneida/Ojibway desktop views and the Ojibway portrait: the false concrete swaths and raster-edge halos are removed. Desktop retains the 189-point rendered-ground check, maximum error 1.49e-13 m, and verifies actual Yards material binding and the three eligible blocks. Shared-host captures establish visual/functional behavior, not performance budgets.

## 9. Deliberately not done / honest limits

- **Material only.** No cover quad, no raised geometry, no routing/width/collider change, no road-paint change, no new
  draw call.
- **Only the three source-validated blocks change, and only within 12 m of the two photographed lanes.** Every other
  yard, block, island, the mainland and the airport stay native.
- **Typology, not survey.** The lawn/earth read and the 12 m envelope are approximations; no garden footprints, fences,
  flowers or driveways are invented and no colour is claimed as sampled.
- **Bounded mask.** A small corridor-intersection raster (~0.83 MB), not a whole-city raster and not thousands of
  per-fragment line tests.
- **Procedural approximation.** The block identities, the source-matched residential/cottage majority and the corridor
  binding are grounded in evidence; the exact garden composition is not surveyed.
