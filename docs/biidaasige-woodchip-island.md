# Biidaasige Park — source-traced woodchip island

Bead: `st-bmyv.4.1` (child of `st-bmyv`). Module: `js/biidaasige-woodchip-island.js` ·
Builder: `tools/build-biidaasige-woodchip-island.mjs` · Tests: `tests/biidaasige-woodchip-island.test.mjs` · This file.

The actual visible **pale-curbed woodchip island** around the six inverted White Oak trunks, currently rendered as
grass. The boundary is the Captain's aerial trace of the 2025 City ortho (58 vertices), projected through the city's
own `C.worldFromLatLon` at call time. The module binds no site coordinate of its own, reads no network or image, edits
no other module, and adds no terrain system.

## What is built

| Item | Value | Status |
|---|---|---|
| Woodchip top | `y = .232 m` | source ground `.224` + an **explicit 8 mm finish choice** |
| Curb top | `y = .284 m` | `.224` ground + **explicit 0.06 m rise** (photo estimate) |
| Curb width | `0.12 m` | **explicit photo estimate**, not surveyed |
| Boundary | 58 traced vertices | Captain aerial trace, `traceErrorM 0.6`, `placementUncertaintyM 3` |
| Meshes | 2 (woodchip + curb) | one bounded root group for culling |

- The woodchip surface is the **exact traced concave polygon**, earcut by `THREE.ShapeUtils.triangulateShape` (no
  handmade ellipse/rectangle, no fan fill, no bounding-box fill). All 58 source vertices are preserved.
- The **pale concrete curb strip** follows the same concave ring. It is built as **bounded per-segment quads** (top
  face + outer wall + inner wall), never one box wall. Miter offsets are clamped finite; degenerate quads are skipped.
- The strip is centred on the traced edge (half inside, half outside), so the visible island matches the trace within
  its 0.6 m error.
- **No animal, trunk, tree, sign or furniture is placed.** The six inverted White Oak trunks are another worker's
  model (`C.buildBiidaasigeInvertedTrees`); this module only supplies the ground they stand on.

## Material

- Warm brown woodchip with **fine irregular grain**. When the resident TSL noise is available
  (`C.TSL` + `C.waterEdgeNoise`), the material composes three octaves (fine grain, mid variation, slow patch) so there
  are no large repeated flat blobs. Otherwise a deterministic per-vertex CPU colour fallback is used.
- No image, no copied texture, no per-chip scatter.
- Pale concrete curb: muted warm grey, rough matte, with a light procedural grain when TSL is available.

## Geometry contract

- Concave-safe: the traced ring is earcut by `THREE.ShapeUtils.triangulateShape`; the triangulated area equals the
  ring area (the test pins an L-shaped 20 m² control and the real ~268 m² trace).
- Long triangles are optionally midpoint-refined (bounded, `maxEdge` 2 m, `maxTris` 2000) for a finer CPU colour
  grain. Refinement stays inside the traced polygon.
- **ONE bounded root group** (`cullDistance`/`cullCell`) with **TWO meshes** (woodchip + curb). No draw call per
  triangle.
- WGS84 → world **only** through `C.worldFromLatLon` **at call time**, so it works in both real frames (the detail
  frame and the default `?map=eglinton` frame). A missing source, missing projection, degenerate ring or failed
  triangulation builds **nothing** and says why.
- `surfaces` entries are copied from the **actual rendered mesh triangles**, rewound upward (`kind: 'woodchip'` top
  and `kind: 'curb'` top). Every one is verified in the test by an **independent THREE downward raycast**.
- `colliders` is `[]` by default: a 6 cm curb is a step, not a wall. `opts.curbColliders === true` emits finite,
  bounded per-segment AABBs for the curb only.

## API

```js
const C = window.CITY;                         // needs C.THREE and C.worldFromLatLon

const out = C.buildBiidaasigeWoodchipIsland(scene, opts); // scene optional
out.group;      // THREE.Group, added to `scene` only when passed
out.surfaces;   // [{ triangle: [x,y,z, x,y,z, x,y,z], kind: 'woodchip'|'curb' }] — exact rendered top triangles
out.ringWorld;  // [[x,z],...] projected traced ring (all 58 vertices)
out.footprint;  // alias of ringWorld, for the Captain's shared footing
out.source;     // { schema, bead, sourceUrl, sourceDate, sourceExport, traceErrorM, placementUncertaintyM, ... }
out.finish;     // { groundY: .224, woodchipY: .232, curbWidthM: .12, curbRiseM: .06 }
out.colliders;  // [] by default; bounded curb AABBs only with opts.curbColliders === true
out.stats;      // { meshes, triangles, woodchipTriangles, curbTriangles, areaM2, vertices, ... }
out.skipped;    // [] (a single source trace; a missing source is reported in stats.reason)

C.biidaasigeWoodchipIslandAt(x, z); // { onIsland:true, kind, surfaceY } | null
```

`C.biidaasigeWoodchipIslandAt` reads a **4 m cell index** built from THIS build's published triangles, so it never
scans the full triangle set per frame and never answers from a stale build. An invalid rebuild clears the record and
the query. It returns `null` (never a clamped/global height) off the island and in the concave notch.

Pure helpers for a consumer/test, without a scene:
`C.biidaasigeWoodchipIslandHelpers.{pointInRing, signedArea, ringArea, dedupeRing, triangulateFaces, refineTriangles,
surfaceGeometry, curbGeometry, collectTriangles, buildIndex, queryAt, curbColliders}`.

## Estimates vs sources

| Kind | Item |
|---|---|
| **FACT** | The boundary is the Captain's 58-vertex aerial trace of the 2025 City ortho, projected through the city's own projection. |
| **FACT** | Source ground `y = .224 m`; woodchip top `y = .232 m` (explicit +8 mm finish choice). |
| **STYLE ESTIMATE** | Curb width `0.12 m`, rise `0.06 m`, pale concrete colour, woodchip colour/grain — photo estimates, not surveyed. |
| **UNCERTAINTY** | Trace error `0.6 m`; whole-trace placement uncertainty `3 m` (northeast construction edge less certain). |
| **NOT DONE** | No animal/trunk/tree placement, no per-chip scatter, no copied texture, no global fill. |

## Regenerate / verify

```bash
node tools/build-biidaasige-woodchip-island.mjs          # inject the fixture DATA into the module
node tools/build-biidaasige-woodchip-island.mjs --check  # exit 1 if the module is stale
node --test tests/biidaasige-woodchip-island.test.mjs    # 8/8 focused CPU checks
```

The fixture `tools/fixtures/biidaasige-woodchip-island.json` is **READONLY** here; the Captain owns it. The module is
wired into the page by the Captain's integration pass (`explore.html` script ordering); this worker does not edit it.

## Sources

- City of Toronto 2025 ortho (`cot_ortho_2025_color_8cm`), aerial trace by the Captain, 2026-11-11.
- City of Toronto / Waterfront Toronto — Biidaasige Park, 2026 (see `docs/biidaasige-park.md`).
- Material colours and curb dimensions are photo-read style estimates, documented above; no image is embedded or
  reproduced.

## Runtime acceptance

The captain integrated this exact traced footprint into `createBiidaasigePark`, the common 4 m footing index and the successful-footprint native-ground mask. The point-object / point-array adapter is covered on actual node materials in the detail and Eglinton runtime checks. The layer contains 270.1 m², two meshes and 1,047 triangles including curb sides. Source path triangles and City street trees have no overlap with the traced island.

Captain accepted build `d9601d3939ba` in matched desktop views `woodchip-before-desktop-*` / `woodchip-fixed-desktop-*` and portrait `woodchip-final-phone-*`, captured on the Mac mini with `gpu2`; the initial `1bea2e30ed64` run failed the adapter and is explicitly rejected. The 8 module tests and 4 runtime tests passed. Full suite after integration: **1,327 total / 1,324 passed / 0 failed / 3 existing skips**. Captures verify functional appearance, not uncontended performance budgets. No animal placements are implied by this accepted surface.
