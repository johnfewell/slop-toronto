# HTO Park East: pale plaza, sodded berms and the timber boardwalk

`js/waterfront-hto-landscape.js` adds the designed landscape of HTO Park East and West, not another beach: the
expansive pale concrete plazas, the isolated low sodded berms and the East timber boardwalk on the mapped south shore. It is a self-contained
module: the captain loads it and calls `window.CITY.createWaterfrontHtoLandscape(THREE, scene)` after the city is built,
alongside the other waterfront modules. It owns only its module, test, this document and its shot list. The beach
umbrellas, chairs and sand remain `js/waterfront-details.js` / `js/waterfront-beach-ground.js`.

```js
const hto = window.CITY.createWaterfrontHtoLandscape(THREE, scene);
// { group, root, colliders, stats, layout, berms, boardwalk }
```

The builder is a no-op in a frame that does not cover HTO Park East: it returns `null`, sets
`CITY.waterfrontHtoLandscapeEnabled = false` and records the reason in `CITY.waterfrontHtoLandscapeError`.

## Source registration (no image pixels as metres)

The primary ASLA plan's four corners are used as **four separate corners**, preserving the slanted north and south
plan edges:

| Plan corner | Plan u, v | Mapped HTO Park ring corner |
| --- | --- | --- |
| NW | 0.512, 0.437 | −892, 564.7 |
| NE | 0.812, 0.416 | −757.8, 562.9 |
| SE | 0.812, 0.894 | −757.8, 695.8 |
| SW | 0.512, 0.827 | −879.3, 677.5 |

A four-point projective homography maps all four plan corners to the mapped ring corners exactly (corner residual 0 m).
This is the correction that removed the earlier 9.3 m error: the first pass fed a rectangle (NW/NE at v .437,
SW/SE at v .894), discarding the plan's angled shoreline edges. The mapped fireboat building
("Toronto Fire and Marine Station 334 EMS station 36", centre ≈ −868.2, 627.6) is a validation control and a hard
obstacle; its plan centre (.567, .647) maps about 7.2 m away, consistent with the plan being an earlier design. Berm
extents are therefore estimates, but they are clipped to the actual mapped lawn, paths, sand, water and buildings.

The boardwalk is not fitted from the plan. The longest mapped south-shore footway (the OSM path running along the
SW→SE park edge, 2 m wide) is the source alignment. The deck is offset from that path centreline, so its exact footprint
does not invent a parallel route. The checked south segment is about 128.7 m; the earlier “190 m” figure was wrong.

## What is built

One culling root (`WaterfrontHtoLandscape`), shared bounded materials, merged and instanced geometry:

| Part | Role | Notes |
| --- | --- | --- |
| Pale concrete plaza | `paved-apron` | the mapped East park ring, with the OSM sand ring and the boardwalk footprint cut out as holes; 0.5 mm above the lawn |
| Sodded berms | `sodded-berms` | 16 credible East ellipses + **9 derived whole-West native path faces**, roughly 1.0–1.45 m high (source range 0.7–1.5 m), broad shoulders blended to grade, one natural turf base with subtle continuous world-space variation |
| Berm edging | `berm-concrete-edging` | a low pale concrete ring at each berm perimeter |
| Boardwalk subdeck | `boardwalk-subdeck`, `boardwalk-seawall-fascia` | dark timber band and seawall fascia under the boards |
| Timber planks | `timber-boardwalk` | 798 instance-coloured boards, planks perpendicular to the local shoreline |
| Seawall rail | `WaterfrontHtoLandscape-RailPosts`, `-Rails` | gray tubular posts and two horizontal rails at the lake edge |
| Slab benches | `WaterfrontHtoLandscape-Benches` | exactly **5** long dark slab benches, the source count, on the mapped promenade apron |

Representative detail-frame build: 24 berms (16 East + 8 derived West faces), 33 paving triangles, 798 planks,
58 rail posts, 5 benches, 9 meshes, about 59,000 triangles, 63 colliders. The boardwalk deck is **lower** than the mapped promenade (timber top at
`sidewalkHeight − 0.06`); the exact-footprint boardwalk mask is what keeps it visible over the mapped city ground.

## Pure APIs for integration (safe before the builder runs)

City-grid is built before the waterfront builder, so all mask and ground predicates use one pure cached layout keyed by
`CITY.GEO`; they do **not** depend on `CITY.waterfrontHtoLandscapeEnabled` or the runtime result.

```js
C.htoLandscapeLayout()                 // pure layout: { supported, frame, berms, boardwalk, skipped, ... }
C.htoLandscapeSupported()
C.htoLandscapeGroundMaskPolygons()     // [{ id: 'hto-east-paved-apron', rings: [eastRing, sandHole] }]
C.htoLandscapeBoardwalkMaskPolygon()   // 4–20 vertex exact deck footprint on the mapped footway
C.htoLandscapePavedAt(x, z)            // pure: exposed pale plaza, false on sand/berm/deck/buildings
C.applyWaterfrontHtoLandscapeGroundMask(material)   // main plaza lawn mask
C.applyWaterfrontHtoBoardwalkGroundMask(material)   // separate exact deck mask
```

`applyWaterfrontHtoLandscapeGroundMask` is the **lawn-only** main plaza mask (the captain wires it to the city-grid
lawn). `applyWaterfrontHtoBoardwalkGroundMask` is the separate exact deck mask for all city ground materials that are not
water/lake; it substitutes only the boardwalk footprint so the lower boards are visible and every other path keeps its
native material. Both compose with an existing `material.maskNode` instead of replacing it.

## Exact surface API

`C.htoLandscapeSurfaceAt(x, z)` returns the highest module-owned walkable surface at a point after the builder runs:

```js
{ h, id, kind: 'berm' | 'boardwalk', pedestrianOnly: true, bermId?, offset?, along? }
```

It returns `null` off all module surfaces or when the module is not built. The berm sampler is not an analytic dome
mirror: it point-in-triangle tests the **exact rendered XZ triangles** and barycentrically interpolates their Y. The
test suite loads the real Three renderer and raycasts downward at the centre, an off-centre triangle and a near-edge
triangle of every berm; each hit agrees with the API within 1e-4 m, and every rendered triangle winds upward.

Other predicates:

```js
C.htoLandscapeBermAt(x, z)            // { id, height, surface, plan, shift } or null (runtime-gated)
C.htoLandscapeFootprintAt(x, z, m)    // berm grass or deck footprint (runtime-gated)
C.htoLandscapeKeepoutAt(x, z, m)      // deck and hard furniture, not a broad berm keepout (runtime-gated)
```

The berm surfaces are intended for tree rooting and walking; the keepout is deliberately limited to the deck and hard
furniture so the captain does not erase the real tree inventory around berm edges.

## Placement rules

- Berm centres come from the plan. Only a small fit correction up to 2 m is allowed; a centre that falls in the mapped
  Peter Slip notch or on a blocked feature is **skipped**, not relocated. Berm 11 is therefore skipped explicitly (the
  plan centre is outside the mapped lawn at that notch), leaving 16 credible berms; no 12 m fabricated shift is used.
- Each berm is ray-marched in 48 sectors against the mapped park ring, OSM sand, water, mapped park/cycling paths,
  mapped building parts, and earlier berms. The sector limits truncate the grass at those obstacles, so a berm bends
  around a path or the fireboat building rather than covering it.
- The mapped paths, the sand polygon and the fireboat building are never moved, masked or re-drawn. The boardwalk
  overlaps the mapped shore footway by design; the separate exact-footprint mask is applied to that deck only.
- HTO West uses its own four-corner homography to the mapped West ring: east quay north (.373,.430)→(−952.5,570.7),
  north-west (.245,.430)→(−1006.7,566.3), south-west (.116,.697)→(−1027.5,648.7), east quay south
  (.373,.765)→(−952.5,661.7). Corner residual is **0 m**, and no plan centre is nudged more than 1 m.
- **West is now built from the whole-peninsula native path topology, not plan ellipses.** A 0.5 m grid marks the mapped
  paths (2 m corridors plus clearance), the mapped buildings and the park edge; every cell not reachable from the grid
  boundary is an enclosed clear face. Faces at or above the explicit **120 m²** threshold become the final West grass
  footprints (a dense grid mesh over the face cells, with height rising from zero at the face edge to a broad crown),
  and the perimeter is then relaxed inward by up to half a cell to round the 0.5 m cell staircase (never onto a mapped
  path or the quay; see the second-revision note above).
  This derived **8** West faces in the committed data (aerial ≈9), rather than forcing the plan's 10. Boundary faces
  whose corners leave the mapped ring are skipped (quay-side setback), so no grass vertex is off-park.
- **The earlier white holes stay grass.** The reviewed whitespace points (−991,629), (−980,598), (−1008,641) and
  (−987,600) stay inside the derived grass footprint and are never paved. After edge rounding a boundary node can fall
  on the receded sliver, so `htoLandscapeSurfaceAt` may return `null` there while `htoLandscapeFootprintAt` and
  `htoLandscapePavedAt` still report grass/not-paved. The exact path node (−993,615) remains the mapped path between
  the two enclosures; both adjacent enclosures are grass.
- Mapped paths and the promenade are preserved (faces stop at the path corridor edge), and mapped building footprints
  are excluded. West mound heights remain estimates; the 8-face count is a documented derivation threshold, not a
  measured count.
- The aerial reads about nine separated mounds, matching the **9** derived faces; the count is a documented threshold
  derivation, not a measured figure. The plan's west boundary follows the condominium frontage (u .245 north to .116
  south-west), and boundary faces are clipped/skipped at the quay edge.
- Named adjacent building control: the committed geodata has **no named building row bordering the West peninsula**.
  The only nearby named row, Maple Leaf Quay, is north at z ≈ 503, not a West-edge control. The adjacent unnamed
  condominium row is used as a hard clip/validation, not as a named corner control. This is recorded in
  `layout.west.adjacentBuildingNote`.

## Surface realism and planting (2026-11-10 revision)

The first GPU review found the East aerial reading as pale, flat, smooth grass pads with sparse tree structure and an
overly white broad hardscape. This revision changes materials and documented planting only; the source-registered ring,
paths, sand, berm meshes, boardwalk footprint and tree inventory do not move.

**Measured reference tones.** Dominant colours sampled from the local primary photographs (k-means over
`$WATERFRONT_RESEARCH/research/hto-photo-2.webp`, `hto-photo-7.webp`, `hto-photo-9.webp` and `hto-city.jpg`):

| Surface | Sampled tones | Use |
| --- | --- | --- |
| East concrete paving | `#E0DDD9`, `#D5DAD9`, `#D3D7D7`, warm shadows `#AB9F95`, `#B2AA9B` | panel face palette, set a little deeper in-engine so the plaza stops reading as flat white |
| Sodded berms | `#758920`, `#5D6C1E`, `#889630`, straw `#969E54` | sunlit sod is olive; the in-engine base is the darker ASLA-aerial turf (`#37552A`) |

These are sampled photograph colours, not surveyed paint specifications. The paving joint spacing (4.2 m × 3.0 m,
12 mm saw-cut) is a procedural approximation of large cast-in-place panels; no joint layout was measured.

**Second GPU revision (2026-11-10, after the wave6-hto draft review).** The captain rejected the first draft: the turf
read as a pale yellow/lime smooth carpet, the West edge showed a gross 0.5 m grid staircase, and the mapped path
ribbons stood out as flat white strips. This revision addresses those three points:

- **Turf darkened, straw reduced.** The base moved from `#6B8038` to `#37552A` (the captain's trial tone) and the
  dry/straw weight was cut from a 0.90 ceiling to 0.52, so the crowns are not a dry-patch claim. The world-space
  streaks/mottle/grain remain.
- **West edge rounded.** `relaxFaceBoundary` relaxes the 0.5 m cell perimeter: only boundary vertices move, only
  inward, only while the moved point stays inside the original allowed mask cells (never onto a mapped path, the quay
  or off-park), with a triangle-inversion guard. Triangulation, vertex count and the exact surface sampler are
  unchanged; boundary perimeter shortens 3–6.5 % per face and no triangle folds. Because the edge recedes by up to half
  a cell, a reviewed boundary whitespace node can now fall just outside the rendered mesh: the footprint and
  `htoLandscapePavedAt` contracts still report grass, and `htoLandscapeSurfaceAt` returns the grass surface where the
  mesh covers and `null` on the receded sliver. The outer-quay exclusion and tree-root basis are unchanged.
- **Path ribbons.** city-grid owns the mapped path geometry and material; this module does not edit core. It now exposes
  `C.htoLandscapePathMaskPolygons()` and a composable `C.applyWaterfrontHtoLandscapePathTone(mat)` so the captain can
  give the path/forecourt material the apron's joints and grain inside the two rings, matching the concrete family
  without moving any footprint or walk height. It is idempotent and a no-op off-frame or on a non-node material; it is
  **not wired here** — wiring is a captain integration decision.

**What the material nodes do** (world-space, so the angled mapped edges have no UV seam):

| Material | Detail |
| --- | --- |
| `paved-apron` | shallow control joints, per-panel tone drift, broad weathering drift and fine aggregate grain; slightly deeper tone than the sunlit photo highlight |
| `sodded-berms` | keeps the single olive vertex-colour base, then multiplies elongated grass streaks, medium mottling and a dry/straw crown tint; no per-blade geometry and no radial per-vertex palette |
| `berm-concrete-edging` | now a shallow bevel (its inner lip is 16 mm above the outer reveal) with an `aEdge` shader attribute: pale lip, shaded outer reveal and fine grain |
| `timber-boardwalk` | the four sampled board tones remain; a neutral weathered grain multiplier stops the deck reading as four flat colour bands |

The node-material path is used only when `CITY.TSL` and a node material are available; otherwise the same meshes fall
back to the plain standard materials. Nothing is added off the supported HTO frames.

**Planting: mapped inventory.** `C.htoLandscapePlantingInventory()` returns the mapped City tree points inside the East
and West rings (4 East + 3 West in the committed frame), with their mapped model and height. The source brief records
**106 trees** across both sections, **25 shrubs** and **3 grass types**, with golden weeping willow, silver maple and
serviceberry, and the ASLA materials text names sod and long grasses. These mapped trunks are never removed or duplicated.

**Planting: ASLA plan tree symbols (st-sb3r.21).** The 2009 ASLA plan does carry explicit tree-symbol circles. The captain
digitized **91 symbol centres** from `$WATERFRONT_RESEARCH/research/hto-plan.webp` (62 East, 29 West); the pixels,
image size (1600 × 1014) and provenance are stored in `C.HTO_PLAN_TREE_POINTS` (same JSON basis:
`$WATERFRONT_RESEARCH/research/hto-plan-tree-points.json`). They are **historical design positions, not current
inventory** — digitizing uncertainty 3–5 px plus the plan's existing ≈7.2 m fireboat registration residual.

Registration and clipping (`C.htoLandscapePlanTreeLayout()`, pure and safe before the builder):

1. Each plan pixel `(px, py)` becomes `(u, v) = (px/1600, py/1014)` and is mapped with the **module's existing East/West
   plan homographies** — the same transforms as the berms, so no new registration is invented.
2. Rejected, never moved: `frame` (side not in this GEO frame), `outside-ring`, `sand`, `water`, `building`, `path`
   (< 0.4 m clear of a mapped path), `city-trunk` (< 5.5 m from a mapped City trunk), `duplicate-plan` (< 2 m from an
   already accepted symbol), and `not-on-east-berm` / `not-on-west-berm` when the point is not on an **exact rendered
   berm triangle** above the paving lip.
3. Accepted points take the rendered berm height from `bermSurface` (the same triangles the mesh draws), a generic
   deciduous model (`ez-oak-medium`), and a bounded photographic **typology estimate** (height 7.8–11.0 m, crown
   2.1–3.0 m). No species is claimed per point.

In the committed frame this yields **68 accepted / 23 rejected** (East 52, West 16): rejections are 10 path, 6
not-on-west-berm, 5 outside-ring, 1 city-trunk, 1 not-on-east-berm. The rejected transform keeps its registered
coordinate so nothing is silently relocated. The density stays a plausible plan read, not a 245-tree gap-fill.

**Runtime/EZ integration (narrow, `js/ez-trees.js` only).** The module sets
`C.waterfrontHtoLandscapePlanTreesEnabled` only after the supported builder runs; `C.htoLandscapePlanTreeSites()` then
returns the accepted sites with the builder-gate. `js/ez-trees.js`, after it collects the City and generated trees and
before its footing lift and final keepouts, appends these sites to the **same shared EZ instancing field** (no
standalone per-tree geometry). Generated HTO scatter within 2.5 m of an accepted plan tree is reconciled away through
`C.htoPlanTreeReconcileGenerated`; mapped City trunks are never removed. Out-of-HTO sites, the deck/garden keepouts and
the rest of the tree pipeline are unchanged.

New public helpers: `C.htoLandscapePlantingInventory()`, `C.htoLandscapePlantingProposals()`,
`C.htoLandscapePlanTreeLayout()`, `C.htoLandscapePlanTreeSites()`, `C.htoPlanTreeReconcileGenerated()`,
`C.HTO_PLAN_TREE_POINTS`. `C.HTO_PAVING_DETAIL` exposes the panel/joint approximation used by the shader.

## Sources (recorded 2026-11-10)

- **ASLA 2009 Professional Awards, HtO** (primary plan and photographs):
  <https://www.asla.org/awards-events-main-landing/honors-awards/pro-student-awards/2009-professional-awards/518>.
  Local primary copies in `$WATERFRONT_RESEARCH/research/`: `hto-asla.html`, `hto-plan.webp`, `hto-gallery.json`,
  `hto-photo-2.webp` (aerial), `hto-photo-7.webp` (boardwalk and slab bench), `hto-photo-9.webp` (sodded berm).
- **Landscape Architecture Foundation, HTO Park**: fine white sand, 25 mounds, 106 trees, boardwalk:
  <https://www.landscapeperformance.org/case-study-briefs/hto-park>.
- **OpenStreetMap / committed geodata**: HTO Park ring, HTO Park West ring, Peter Slip, the south-shore and promenade
  paths, mapped trees, and the fireboat building row. The HTO sand ring is the shared
  `window.CITY.WATERFRONT_SAND_RINGS.htoPark` export (OSM way 189306980).

Uncertainties are explicit: the plan is an earlier design (building residual ≈7.2 m), berm heights and individual
extents are estimates, the five bench positions are evenly spaced along the mapped promenade within the source count
ceiling. West mound heights are estimates and the 8-face count follows the explicit 120 m² derivation threshold, not
  a measured count.

## Verification

Focused test: `node --test tests/waterfront-hto-landscape.test.mjs`.

It asserts the four actual plan UVs (not a rectangle), the zero corner residual, the pure pre-build lawn and boardwalk
masks, 16 East berms whose triangle vertices stay on the mapped lawn and off sand/buildings/paths, the whole-West
derived native face count (threshold and boundary-face setback, all West face vertices clear of the 2 m mapped paths
and buildings), grass coverage at every reviewed whitespace point, exact barycentric surface matching real Three
downward raycasts with upward winding, one natural turf colour base with subtle continuous variation (no per-vertex
random palette fan), the plaza with sand/deck holes, 5 benches, plank perpendicularity, the mapped shore-footway
alignment, untouched tree/path inventory, the unsupported-frame no-op, the real detail and Eglinton frames, and bounded
finite geometry with culling metadata. The 2026-11-10 revision adds checks that the paving, turf, edging and timber are
node materials with procedural colour nodes, that the edging bevel has its inner lip above the outer reveal, that the
source counts and 128.7 m deck are unchanged, and that planting inventory points exist in the mapped tree array while
the densification proposal carries no invented coordinate. The second revision adds: the West edge rounds inward by at
most half a cell with no folded triangle, unchanged height, vertices still inside the mapped ring and clear of mapped
paths, a shorter boundary perimeter, and all eight faces preserved; and the path-tone hook returns an idempotent
composable node and touches no geometry. The plan-tree work (st-sb3r.21) adds: all 91 digitized symbols accounted for as
accepted+rejected, every accepted point on an exact rendered berm triangle (a Three raycast agrees with the registered
height within 1 mm), off paving/beach/building/water, clear of City trunks (>= 5.5 m) and of each other (>= 2 m),
rejected points retaining their registered coordinate, the gate off before the builder and on after, generated-scatter
reconciliation removing only the generated duplicate, identical accepted positions on the detail and Eglinton frames,
and a clean no-op on an unsupported frame. It does not run the full suite.

Shot definitions are in `tools/shots/waterfront-hto-landscape.json` (aerial, boardwalk street, berm walk, plaza aerial)
and `tools/shots/waterfront-hto-refinement.json` for the material pass (paving joints, berm edge, West paving/mound, with
the existing East and West aerials kept for before/after comparison). Run both at the high desktop and low phone tiers.

GPU review excluded the long outer quay component: despite its 411 m² area, its maximum interior radius is only 2.5 m. The source aerial shows this continuous lake-edge apron paved. A 3 m minimum interior-radius filter retains eight grass faces (the smallest has a 4.5 m radius); the source aerial suggests about nine original mounds, so this is a mapped-topology approximation, not an exact count.
