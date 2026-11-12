# Waterfront HTO beach chair — provenance and licence

`waterfront-hto-adirondack.glb` is a **real Adirondack chair** and the **DEFAULT HTO Park seat** in
`js/waterfront-details.js`. The captain inspected the standalone 3D preview and the full HTO beach scene and accepted it
as a much better match than the procedural fan chair. Sugar Beach keeps its procedural 3-horizontal-slat Loll chair.

An explicit comparison override keeps the procedural HTO chair for side-by-side review:
`window.CITY.waterfrontChairTrial = false` or `?waterfrontChairTrial=0` before the city builds. Normal users get the
accepted model with no opt-in.

## What this model actually is

The **Innerscene "Cape – Adirondack Chair"** is a genuine Adirondack: broad flat/fan arms, a separate reclined seat made of
parallel slats, a tall fan-shaped back of vertical slats, and four legs. It matches the **HTO Park** chair silhouette
(rounded fan/vertical-slat back). It does **not** match Sugar Beach's Loll 3-horizontal-slat chair, so it is used only for
the HTO-style (`vertical`) chairs; Sugar keeps its procedural 3-horizontal-slat chair.

This is the match the previous pass failed to find. An earlier pass trialled a fabric-sling folding chair that the captain
correctly rejected as the wrong chair; that asset has been removed from the repository and archived outside it. It is not
referenced here or shipped.

## Source

- **Model:** "Cape – Adirondack Chair" by **Innerscene** (original Innerscene model).
- **Model page:** <https://www.innerscene.com/tools/library/3d-parts/cape-adirondack-chair-0356dfce>
- **Innerscene library terms:** <https://www.innerscene.com/tools/library/terms>
- **Download (as fetched):** `innerscene-adirondack.glb` (1,184,696 bytes; 4,700 triangles, 25 named part meshes, one
  PBR teak material with base-colour/normal/roughness textures).
- **Published size:** 85 × 101 × 106 cm (W × D × H), modelled in metres at real-world scale.

Named parts in the source (from the GLB node names): `back upright` ×2, `fan-shaped back board` ×7, `front leg` ×2,
`long rear support` ×2, `reclined seat slat` ×7, `structural cross rail` ×3, `wide fan arm` ×2.

## Licence

- **CC0 1.0 Universal (Public Domain Dedication)** — <https://creativecommons.org/publicdomain/zero/1.0/>.
- The model page states: *"Public domain (CC0). Free to use, modify and redistribute for any purpose, including
  commercially, with no conditions."* No account, no fee, no attribution required. Attribution is given here anyway.

## Modifications (this repository)

Baked from the downloaded GLB (source kept outside the repo at
`$WATERFRONT_RESEARCH/furniture/innerscene-adirondack.glb`) with `@gltf-transform` + `meshoptimizer`:

1. Baked every node's world transform into one merged mesh (the source is 25 separate part meshes).
2. Uniformly scaled to the published **1.06 m height**, centred on x/z, base at **y = 0**, front facing **+z** (the repo
   prop convention). Proportions are preserved: **0.849 W × 1.060 H × 1.012 D m**.
3. Stripped the three teak textures (base colour, normal, roughness) and set a **white** base colour, metallic 0,
   roughness 0.85, double-sided, so the painted per-instance palette (red/yellow/blue/green at HTO) tints it cleanly. The
   source wood grain was useful for recognising the model in the preview; the painted chairs are the target.
4. Welded duplicate vertices and simplified with `meshopt` to **2,132 triangles** (from 4,700), preserving the silhouette
   and the real-scale bounding box. Each source part is a beveled box (~188 triangles); this is a controlled simplify, not
   a blind decimate.

Resulting asset: **40,628 bytes, 2,132 triangles, 1 primitive, 1 material, no textures.**
Bounding box: W 0.849 m × H 1.060 m × D 1.012 m.

## Integration (default HTO seat)

- `js/waterfront-details.js` builds the procedural chair synchronously, then swaps this model in for the HTO-style chairs
  by default. The swap is in place (instance matrices, colours, names, cull metadata preserved) and recomputes the
  `InstancedMesh` bounding box/sphere from the real geometry so culling and raycasts use the accepted chair's extent.
- HTO colliders are built **synchronously** from the real model footprint (half extents 0.425 × 0.507 m, 1.06 m tall) so
  the collider encloses the asset even before/without the GLB; Sugar keeps the procedural footprint (0.33 × 0.47 m,
  0.95 m tall).
- HTO chair placement uses the real half-diagonal (0.6605 m): a 0.67 m sand margin, 1.321 m chair spacing and 0.6986 m
  umbrella separation, so the whole chair stays on the sand and clear of other chairs and poles. Counts stay 76 HTO /
  150 Sugar.
- The HTO chair mesh casts shadows (`castShadow = true`) so the chairs sit on the sand instead of floating; Sugar is
  unchanged.
- If the GLB fails to load, the procedural chair remains; loading never throws.

## Verification

```sh
node --test tests/waterfront-furniture-assets.test.mjs
```

Pins: the asset exists and loads as a real glTF; it is a single white-material mesh at real Adirondack scale (front +z,
base y=0); the default swaps only the HTO-style chairs and preserves instances/colours/cull metadata; the explicit
override keeps the procedural chair; the HTO colliders enclose the real model; every transformed HTO vertex sits inside
its collider and on the sand; provenance/docs state CC0, Innerscene, and the real Adirondack (not the rejected folding
chair).
