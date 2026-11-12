# Waterfront beach ground: real sand at Sugar Beach and HTO Park

`js/waterfront-beach-ground.js` draws the actual sand surface of Toronto's two harbourfront beaches on the verified OSM
`natural=beach` polygons, and masks the generic park lawn beneath them (preserving mapped paths). It owns only the *ground*: the umbrella
and chair furniture is `js/waterfront-details.js`, and the parks, paths, bikes lanes and trees are the city's own
modules. It is self-contained and does not run until the captain calls it.

```js
const beach = window.CITY.createWaterfrontBeachGround(THREE, scene);
// { group, colliders, stats, layout }   (colliders is always [])
```

## Why this module exists

The furniture pass placed the pink umbrellas and white chairs correctly on the OSM sand rings, but there was **no sand
mesh** in the app: the beaches were the city's generic park lawn (`createParkLawnMaterial`) with its paving and
procedural grass noise, so the GPU captures showed grey pavement and green/white strips across the sand. This module
adds the missing sand and removes the generic lawn under it.

## What it builds

- **Two sand meshes**, one per beach, flat and upward-facing, on the exact OSM sand polygons.
- **A reusable ground mask** so the park lawn/pavement does not show through the sand.

It never fills the whole park: only the `natural=beach` ring is sand. The grass, plaza, promenade and paths around each
ring stay the city's geometry, and the mapped paths and trees are not moved, cut or removed.

**There is no existing sand anywhere in the city.** The two beaches are `GEO.areas` of `kind === 'park'` (`HTO Park`,
`Sugar Beach`) drawn as the generic park lawn (`createParkLawnMaterial`); `js/city-grid.js` has no beach/sand area kind
or material. That missing surface is exactly what this module adds.

## Verified sand polygons (not invented)

The sand rings are the **shared export** `window.CITY.WATERFRONT_SAND_RINGS` (set by `js/waterfront-details.js`), so the
ground and the furniture always use the same polygon — there is no second copy to drift.

| Beach | OSM way | Tag | Mapped area (this build) | Official / source area |
| --- | --- | --- | ---: | ---: |
| Canada's Sugar Beach | `way/172728993` | `natural=beach`, `surface=sand` | ~3,194 m² | ~3,190 m² (OSM) |
| HTO Park | `way/189306980` | `natural=beach` | ~1,336 m² | ~1,330 m² (OSM) |

The OSM polygons are a few percent smaller than the maintained beaches; the OSM outline is used and the difference is
recorded, not padded.

## Level and parity with the furniture

The beaches are flat at the harbour shore (no road cuts there), so the sand surface is the **park lawn level**:
`CITY_BOUNDS.sidewalkHeight + 0.004 = 0.224 m`. That is exactly where the furniture module's own `groundAt()` puts
umbrella and chair feet (`sidewalkHeight + 0.004 + cutAt`, and `cutAt` is 0 on the flat shore). So the chairs stand on
the sand, not hovering or sunk:

- `waterfrontSandHeightAt(x, z)` returns `0.224` inside a built sand ring and `null` elsewhere — the height a foot on
  the sand should use.
- The sand **mesh** is drawn 2 mm above that (`sandMeshY = sandY + 0.002`) purely to beat depth-fighting; it is masked
  away from the lawn beneath, so the 2 mm is invisible and the walking height stays `0.224`.

## Ground mask (removing the generic lawn under the sand, preserving the paths)

`applyWaterfrontBeachGroundMask(mat)` composes a discard into `mat.maskNode` for world points that are **inside a sand
ring AND not within a mapped path corridor**, exactly as `js/city-grid.js` composes its water and road-cut masks. It:

- `and`s with an existing `maskNode` (water mask, road-cut mask) instead of replacing it;
- is idempotent (marked with `mat.userData.waterfrontBeachMask`);
- is a no-op off-frame (no sand in the active frame) and on a non-node material, returning the material untouched.

**Apply it to exactly ONE material: the park lawn's.** In `js/city-grid.js` the derived park lawns are merged into
`lawnMat` (mesh `Lawns`); that is the only material carrying generic grass over the beach. Park paths are a different
material — `createForecourtMaterial()` (mesh `Forecourts`) at `SW_TOP + 0.008` — so leaving the forecourt material
unmasked already preserves every path. Do not mask the whole `city-grid` group and do not mask `walkMat`, `plotMat`,
the forecourt/path material, the water or the kerbs:

```js
// js/city-grid.js, right after `const lawnMat = createParkLawnMaterial(false);`
window.CITY.applyWaterfrontBeachGroundMask?.(lawnMat);
```

**Mapped paths are preserved on two independent levels:**

1. Material scope — paths are the forecourt material, which is not masked.
2. Corridor exemption — the mask itself keeps any point within a mapped `GEO.parkPaths` corridor (the row's own
   `[fullWidth, ...]` half-width + 5 cm) even if the mask is applied to the path material by mistake.

The sand *mesh* also drops any triangle wholly inside a path corridor, so the boardwalk (drawn 2 mm above at
`SW_TOP + 0.008`) is not buried under sand geometry; edge triangles are kept (the path quad covers the seam). On the
committed data **HTO Park's sand is crossed by mapped paths (9 in the detail frame, 10 in Eglinton); Sugar Beach's is
not.**

## Frame guard (shared world projection)

The module builds a beach only when the active `GEO.frame.detail` actually covers its sand ring, and reports
`skipped: [{ id, reason }]` otherwise. It reads the sand rings from the shared export and never falls back to hardcoded
downtown coordinates, and there are no hardcoded row indices anywhere in the module.

**Both committed frames contain the beaches and both build them** (verified by decoding the real
`data/toronto-geodata.bin` and `data/frames/eglinton/toronto-geodata.bin`):

| Frame | World bounds (x0..x1, z0..z1) | Beaches built |
| --- | --- | --- |
| `data/toronto-geodata.bin` (detail) | −7900..3700, −3000..3600 | Sugar + HTO |
| `data/frames/eglinton/toronto-geodata.bin` | −7900..9600, −7300..3600 | Sugar + HTO |

Eglinton is the detail projection extended north to Eglinton Avenue and east to Victoria Park Avenue — a **superset** of
the detail frame in the same world projection, so it genuinely contains both beaches. (My earlier note that Eglinton is
a "different, non-overlapping area" was wrong; corrected here and in the tests, which now decode both real bins.)

## Exports

| Export | Purpose |
| --- | --- |
| `waterfrontBeachGroundLayout(opts)` | pure: `{ sites, skipped }`, each site `{ id, name, osm, sandRing, sandBox, sandY, sandMeshY, area }` |
| `waterfrontSandHeightAt(x, z)` | the sand surface height (`0.224`) on a built sand ring, else `null` |
| `waterfrontBeachKeepoutAt(x, z, margin)` | point keep-out test for open sand (excludes mapped path corridors) |
| `waterfrontBeachPathAt(x, z)` | true if (x, z) is on a mapped path corridor crossing a sand ring |
| `waterfrontBeachExclusionPolygons()` | `[{ id, plan, paths }]`, the sand rings and their path corridors, for CPU callers |
| `applyWaterfrontBeachGroundMask(mat)` | the TSL ground mask hook |
| `createWaterfrontBeachGround(THREE, scene)` / `buildWaterfrontBeachGround` | build `{ group, colliders:[], stats, layout }` |

## Integration

1. Load `js/waterfront-beach-ground.js` after `js/waterfront-details.js` (it reads `WATERFRONT_SAND_RINGS`).
2. In `js/city-grid.js`, apply `applyWaterfrontBeachGroundMask` ONLY to `lawnMat` (the `Lawns` mesh) — not to the
   forecourt/path material, walkways, plots, water or kerbs.
3. In `main.js`, after the furniture, call `createWaterfrontBeachGround(THREE, scene)` (it adds its own root). It adds
   no colliders.
4. If the furniture grounding is updated, use `waterfrontSandHeightAt` so feet stay exactly on the sand.

## Sources (recorded 2026-11-10)

- OpenStreetMap contributors, ODbL: `natural=beach` ways `172728993` (Sugar Beach) and `189306980` (HTO Beach), read
  through the committed GEO projection and the shared `WATERFRONT_SAND_RINGS` export.
- Waterfront Toronto, Canada's Sugar Beach — <https://www.waterfrontoronto.ca/our-projects/canadas-sugar-beach> —
  8,500 m², 225 m shoreline, pink umbrellas, candy-striped granite beside the sand.
- Landscape Architecture Foundation, HTO Park — <https://www.landscapeperformance.org/case-study-briefs/hto-park> — fine
  white sand, mounds, boardwalk.
- `docs/waterfront-details.md` and `docs/waterfront-realism.md` for the established furniture placement, counts and
  levels.

## Uncertainties and limits

- **Sand colour** is procedural and art-directed from the photographs (a pale beige at Sugar, a fine near-white at HTO);
  no sampled colour values are published, and no texture dependency was added.
- **Sand extent** is exactly the OSM `natural=beach` outline; where OSM and the maintained beach differ, OSM is used.
- **Level** is the flat park lawn level (0.224 m); the beaches have no topographic relief modelled.
- No GPU capture was run here (laptop); visual acceptance is the captain's `gpu2` pass.

## Verification

`node --test tests/waterfront-beach-ground.test.mjs` → 8 pass, 0 fail. Covered: the exact shared OSM rings, inside the
detail frame, at the park level; sand is a strict part of each park (never the whole rectangle); the sand height equals
the furniture feet and covers every interior sample; keep-out and exclusion polygons match the rings; the built mesh is
flat, upward-facing, correctly wound (not back-face culled) and on the rings; the mask hook composes/idempotent/no-ops;
the shared-world frame guard (both real decoded bins build both beaches); mapped-path preservation (HTO's corridors are exempt from the mask and cut from the mesh); recorded sources and deterministic siting. `waterfront-details`
tests still pass (16/16 across both). Per instructions, the full suite was not run.