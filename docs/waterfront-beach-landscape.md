# Sugar Beach landscape: striped bedrock, plaza, grass mounds and maple-leaf fountain

`js/waterfront-beach-landscape.js` adds the landscape character of Canada's Sugar Beach that the sand pass
(`js/waterfront-beach-ground.js`) and the umbrella/chair pass (`js/waterfront-details.js`) do not own: the two
candy-striped granite bedrock outcrops, the current-supported grass mounds, the low charcoal maple-leaf water feature,
and the source-plan hardscape plaza that ties them together. It builds nothing at HTO Park (that work belongs to the
separate source-verified `waterfront-hto-landscape.js` module) and it does not duplicate the existing mapped boardwalk.

```js
const landscape = window.CITY.createWaterfrontBeachLandscape(THREE, scene);
// { group, root, colliders, stats, layout, surfaces }
```

## Source positions (fitted estimates, not survey coordinates)

The captain inspected the original ASLA / Claude Cormier + Associés site plan (not to scale) and read these normalized
image coordinates. The module fits a two-axis affine from the **committed geodata** at runtime:

| Plan anchor | Plan (x, y) | World source |
| --- | --- | --- |
| SW park/seawall corner | (.379, .89) | the Sugar Beach park ring's maximum-z vertex |
| Top of the west seawall | (.379, .22) | the park ring's minimum-x vertex |
| Corus NW building corner | (.77, .40) | the real `Corus Quay` building row's westmost footprint corner |
| Queens Quay south curb | (.14) | cross-check only; the fit predicts it within a few metres of the mapped road edge |

| Feature | Plan (x, y) | World estimate | Source size |
| --- | --- | --- | --- |
| Beach bedrock outcrop | (.472, .525) | ≈ 934.0, 504.4 | ~8 × 5 m, ~1.15 m high |
| Plaza bedrock outcrop | (.656, .585) | ≈ 967.8, 516.6 | ~12 × 8 m, ~1.8 m high |
| North grass mound (historical) | (.556, .24) | ≈ 938, 438 | large; **not built** (see below) |
| Middle grass mound | (.624, .424) | ≈ 956.4, 480.0 | ~7 × 6 m, ~1.85 m high |
| South grass mound | (.641, .505) | ≈ 962.3, 498.4 | ~6 × 5 m, ~1.5 m high |
| Maple-leaf water feature | (.598, .754) | ≈ 964.0, 555.8 | ~5.2 × 5.0 m, 0.12 m step |

The plan is **not to scale**; these are estimates with a recorded fit basis, not measured/survey positions. Two
independent checks support the fit: the beach outcrop lands in the real notch carved out of the OSM sand polygon, and
the same fit predicts the Queens Quay curb near the mapped road edge. The sand and every mapped path/furniture
placement are preserved; the module never edits the other modules' geometry.

### The third (north) mound is historical, not current

The original architect plan and the 2010/2011 ASLA photographs show three grass mounds. The newer primary evidence
shows that the northern one's plan location is now the **Waterfront Innovation Centre** (official Waterfront Toronto
page and 2021 photo; OSM building `way/943701268` and its parts). The current geodata rows `34854`–`34858` near world
944, 444 are the same building. The module therefore **keeps the north mound unbuilt with an explicit reason** rather
than deleting the building or silently moving the mound. The historical source has three mounds; the current-supported
count is two. `stats.moundsHistorical = 3`, `stats.mounds = 2`.

## What is built

- **Two low bedrock outcrops** on shared instanced geometry, scaled to the source footprints, with a slightly sloped
  rim and an irregular flat top (not vertical-sided boxes or spheres). Warm grey-brown procedural granite. Red and
  white bands are clipped from the actual rock triangles (not box slabs), lie 3 mm above the same facet, follow the
  top and sloped rim without projecting past the footprint, and use irregular widths (red 0.12–0.20 m, white
  0.20–0.40 m) and 1.5–3 m spacing. Dark quarry-seam bands are clipped to the actual side facets. Two collider OBBs
  are emitted.
- **Two current-supported grass mounds** on one shared instanced dome, smooth asymmetric mid-green grass with broad
  shoulders and a finite slope to grade. Their exact rendered triangles are exposed through the height API.
- **The maple-leaf water feature**: a flush/low-step (0.12 m) dark charcoal granite leaf inlay at the south
  beach/promenade boundary, with fine pavement joints clipped to the leaf outline and seven broadly spread vertical
  jets (0.55–1.8 m) across the leaf footprint — no floating pool.
- **The source plaza apron**: the mapped park ring plus a north-plaza envelope derived from the plan, drawn as warm
  medium-grey fine pavers with subtle rectangular joints. The sand mesh and the two grass mounds sit above it, so the
  mounds read as grass islands in a hard plaza instead of blobs on the generic bright lawn.

## Integration hooks

1. **Ground mask** — apply to the park lawn material only, in `js/city-grid.js` next to the other beach masks:

   ```js
   const lawnMat = createParkLawnMaterial(false);
   window.CITY.applyWaterfrontBeachGroundMask?.(lawnMat);
   window.CITY.applyWaterfrontBeachLandscapeGroundMask?.(lawnMat);
   ```

   The hook composes with an existing `maskNode`, is idempotent, and is a no-op off-frame or on a non-node material.
   Do not apply it to the path/forecourt material (paths remain above the plaza and are preserved).

2. **Furniture keepout** — pure and available **before** the details builder runs, so the published chair/umbrella
   counts can be preserved on the remaining open sand without deleting anything:

   ```js
   window.CITY.waterfrontBeachLandscapeKeepoutAt(x, z, 0.4); // true on an outcrop or the leaf footprint
   ```

   The current furniture pass has no chair inside either outcrop; the nearest chair centre to the beach outcrop is
   5.8 m, and the keepout reports the exact footprint for future layout changes.

3. **Walking height** — `window.CITY.waterfrontBeachLandscapeHeightAt(x, z)` returns the exact rendered surface height
   (world y) from the built triangle soup (barycentric interpolation, including the mound mesh's ground offset), or
   `null` off the raised surfaces / when the module is disabled or unsupported. The captain can hook this into
   walking, trees and clamped props. `waterfrontBeachLandscapeGroundAt` returns the base ground when the sampler is
   null.

4. **Build** — call `createWaterfrontBeachLandscape(THREE, scene)` after the sand/furniture passes. It adds its own
   root (`WaterfrontBeachLandscape`), returns `{ group, root, colliders, stats, layout, surfaces }`, and is a no-op on
   frames that do not contain the Sugar Beach anchors.

## Sources (retrieved 2026-11-10)

- ASLA 2012 Honor Award, Canada's Sugar Beach — <https://www.asla.org/2012awards/036.html>; original site plan and
  gallery images, including the red/white thermoplastic stripes masking quarry cut lines, the two outcrops, the
  maple-leaf fountain and the three grass mounds.
- Waterfront Toronto, Canada's Sugar Beach — <https://www.waterfrontoronto.ca/our-projects/canadas-sugar-beach> —
  8,500 m², 225 m shoreline, 36 pink umbrellas, 150 chairs, fountain in a granite maple leaf, three grass mounds,
  boardwalk level with the sand.
- Waterfront Toronto, Waterfront Innovation Centre — <https://www.waterfrontoronto.ca/our-projects/waterfront-innovation-centre>
  and its 2021 photo — the current building on the historical northern plaza.
- OpenStreetMap contributors, ODbL: Sugar Beach `leisure=park` ring; `natural=beach` way/172728993 (the shared sand
  ring); Corus Quay building row; Waterfront Innovation Centre `way/943701268` and its parts; mapped roads and park
  paths, read through the committed GEO projection.
- `docs/waterfront-details.md`, `docs/waterfront-beach-ground.md`, `docs/waterfront-realism.md` for the established
  sand, furniture counts, levels and integration.

## Verification and limits

`node --test tests/waterfront-beach-landscape.test.mjs` → 10 pass, 0 fail. The focused test covers: the two outcrops,
two current-supported mounds of three historical, the fountain, the skip reason for the Waterfront Innovation Centre,
the real park/Corus georeference anchors, the sand-notch and beach/promenade cross-checks, the pre-build keepout, the
finite instanced build (no HTO/boardwalk duplication), exact sampler-vs-`THREE.Raycaster` agreement at mound centres and
off-centre points plus the leaf, upward rock top hits, every candy-stripe vertex inside a rock footprint and within
1 cm of the rock surface, the mask hook, and both real decoded frames (detail + Eglinton)
with an unrecognized-frame no-op. No GPU capture was run here (laptop); visual acceptance remains the captain's `gpu2`
pass. Full suite was not run.

Not modelled: the north mound (current building), the HTO knolls/boardwalk (separate module), the exact cobble maple-
leaf mosaic pattern, and any furniture/camera changes. Dimensions for the mounds, rocks and fountain are source-photo /
plan estimates, recorded above.
