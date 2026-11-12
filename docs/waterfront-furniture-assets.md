# Waterfront beach chairs: the accepted HTO Adirondack

This note records the search for a real, freely licensed low-poly **Adirondack/Muskoka** chair to replace the procedural
beach chair in `js/waterfront-details.js`, the candidates actually downloaded and compared, the real match found, and
what ships.

## Outcome

- **Sugar Beach**: 150 warm-white chairs with **3 horizontal back slats** (Loll 3-slat Adirondack) — procedural, unchanged.
- **HTO Park**: 76 multicolour chairs — the **Innerscene "Cape – Adirondack Chair"** (`assets/props/waterfront-hto-adirondack.glb`),
  a genuine, real-scale Adirondack with broad fan arms, separate reclined seat slats and a tall fan of vertical back
  slats. The captain inspected the standalone 3D preview and the full HTO beach scene and **accepted it as the default**
  (much better than the procedural fan chair).

The accepted model is the **default HTO seat**; normal users need no opt-in. An explicit comparison override keeps the
procedural HTO chair for side-by-side review: `window.CITY.waterfrontChairTrial = false` or `?waterfrontChairTrial=0`
before the city builds. The procedural chair is also the synchronous fallback if the GLB fails to load.

## The rejected first pass (recorded so it is not repeated)

The first pass trialled a Poly/Google "Beach chair" and inferred its shape from bounding-box ratios and a coarse ASCII
projection made from mesh *vertices*, concluding it was an Adirondack. **The captain viewed it and rejected it: it is a
fabric-sling folding deck chair** (no armrests, two long diagonal side rails, a cloth panel, an A-frame rear support).
Vertex-projection ASCII does not capture thin cloth panels or the absence of arms. That asset has been **removed from the
repository and archived outside it**; it is not shipped or referenced.

**Ratios and vertex projections are not a substitute for looking at the render or the photo.** The rendered orthographic
silhouettes and the captain's visual inspection are the reliable evidence. The current match was confirmed from the
source's named part meshes and the real-scale bounding box, not from ratios.

## Candidates actually downloaded and measured

All were fetched as GLB and parsed (bounding boxes, triangle counts, armrest structure, rendered orthographic
silhouettes saved to `$WATERFRONT_RESEARCH/furniture/renders/`).

| model | source / licence | W/H | D/H | reads as | Adirondack? |
|---|---|---|---|---|---|
| **Innerscene "Cape – Adirondack Chair"** | **Innerscene, CC0** | **0.80** | **0.95** | **real Adirondack: fan arms, reclined slat seat, fan/vertical-slat back, 4 legs** | **yes — accepted, HTO default** |
| Poly Pizza "Beach chair" (Poly/Google) | CC BY 3.0 | 0.83 | 1.37 | **fabric-sling folding deck chair** (no arms) | **no — rejected by captain, removed** |
| Polyfork striped-deck-chair-70b506 | CC BY 4.0 / Polyfork | 0.68 | 0.98 | reclined sling deck chair | no |
| Polyfork porch-rocking-chair-89b2d7 | CC BY 4.0 / Polyfork | 0.60 | 0.80 | rocking chair on runners | no |
| Polyfork folding-lawn-chair-b7ddbe | CC BY 4.0 / Polyfork | 0.65 | 0.67 | tubular folding lawn chair | no |
| Polyfork bistro-chair-7c354d | CC BY 4.0 / Polyfork | 0.52 | 0.64 | cafe chair | no |
| Polyfork folding-camp-chair-2fc7d1 | CC BY 4.0 / Polyfork | 0.71 | 0.66 | camp/sling chair | no |
| Polyfork lounge-armchair-5a72ca | CC BY 4.0 / Polyfork | 0.95 | 0.95 | upholstered lounge armchair | close, not slatted |
| PolyPizza "Wooden Arm Chair" (Zsky) | CC BY | 1.06 | 1.07 | wooden armchair | possible, unconfirmed |
| PolyPizza "Chair" (Quaternius) | Public Domain | 0.54 | 0.61 | narrow arm chair | no (too upright/narrow) |
| PolyPizza "Chair" (CMHT Oculus) | CC BY | 1.41 | 1.36 | bulky recliner | possible, high-poly, unconfirmed |

## The match: Innerscene "Cape – Adirondack Chair"

- Source page: <https://www.innerscene.com/tools/library/3d-parts/cape-adirondack-chair-0356dfce>
- Licence: **CC0 1.0** (public domain dedication), no account, no fee, no conditions.
- Source: 4,700 triangles, 25 named part meshes (back uprights, 7 fan back boards, front legs, rear supports, 7 reclined
  seat slats, 3 cross rails, 2 wide fan arms), one PBR teak material with 3 textures.
- Published and measured size: **85 W × 101 D × 106 H cm** — the downloaded GLB measures 0.849 × 1.012 × 1.060 m.
- The part names and the silhouette settle the structure directly: broad arms, a separate slat seat, and a reclined fan
  of vertical back slats. This is the broad-arm, reclined-slat Adirondack the earlier passes were looking for.

The baked low-poly asset is `assets/props/waterfront-hto-adirondack.glb`: **2,132 triangles**, one white-material mesh,
front +z, base y=0, centred x/z, 1.06 m tall, no textures (so the painted per-instance palette tints it). See its
`PROVENANCE.md` for the exact modifications.

## Integration (only `js/waterfront-details.js` edited)

- The module stays **synchronous**: it builds the procedural chair, then swaps the accepted model in for the HTO-style
  (`vertical`) chairs by default. Sugar's 3-horizontal-slat Loll chairs keep the procedural geometry. The swap is
  in-place (instance matrices, colours, name, cull metadata preserved); each replaced procedural geometry is disposed only
  after a successful load; on failure the procedural chairs remain.
- The `InstancedMesh` bounding box/sphere are **recomputed after the async swap** from the real geometry and instance
  matrices, so culling and raycasts use the accepted chair's true extent (the procedural bounds were smaller).
- HTO colliders are built **synchronously** from the real model footprint (half extents 0.425 × 0.507 m, 1.06 m tall) so
  the collider encloses the asset even before/without the GLB; Sugar keeps the procedural footprint (0.33 × 0.47 m,
  0.95 m tall). `main.js`'s `pushAll()` is correct on the same tick.
- HTO chair placement uses the real half-diagonal (0.6605 m): a **0.67 m sand margin**, **1.321 m chair spacing** and
  **0.6986 m umbrella separation**, so the whole chair stays on the sand and clear of other chairs and poles. Counts stay
  76 HTO / 150 Sugar; no chair is moved onto a path or grass.
- The HTO chair mesh casts shadows (`castShadow = true`) so the chairs sit on the sand instead of floating; Sugar is
  unchanged (no global render change).
- No Meshy generation, no other-owner files touched.

## Licence / provenance

`assets/props/waterfront-hto-adirondack.PROVENANCE.md` records the model ("Cape – Adirondack Chair" by Innerscene,
**CC0 1.0**), the modifications (world-transform bake, merge to one mesh, real-scale normalisation, texture strip, white
material, weld + meshopt simplify to 2,132 triangles) and the honest finding that it is a real Adirondack matching HTO.
`CREDITS.md` carries the narrow source/model/modifications entry.

## Tests

```sh
node --test tests/waterfront-furniture-assets.test.mjs
```

Pins the contract: the asset exists and loads; the **default** swaps only the HTO-style chairs to the accepted model and
preserves instances/colours/cull metadata; the explicit override keeps the procedural chair; the HTO colliders enclose
the real model; every transformed HTO vertex sits inside its collider and on the sand; and the provenance/docs describe a
real CC0 Innerscene Adirondack at real scale with no false licence claim.

## Shots

`tools/shots/waterfront-furniture-assets.json` frames both beaches' chairs for the captain's GPU read (HTO now shows the
accepted model by default). `tools/shots/waterfront-furniture-hto.json` frames the HTO chairs for the final GPU phone
check. `tools/shots/waterfront-asset-preview.json` previews the downloaded GLB in isolation and now loads
`./assets/props/waterfront-hto-adirondack.glb`.

Accepted default-model captures: `wave6-final-details` (desktop/high) and `wave6-final-phone` (412×915/low), six checks each, exit 0. The captain visually inspected the matching close views. These are functional/visual checks on the shared GPU host, not performance measurements.
