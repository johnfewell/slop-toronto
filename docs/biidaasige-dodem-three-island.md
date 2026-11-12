# Biidaasige Park — second source-traced woodchip island (Dodem three-animal)

Bead: `st-bmyv.4.2` (child of `st-bmyv`). Module: `js/biidaasige-dodem-three-island.js` ·
Builder: `tools/build-biidaasige-dodem-three-island.mjs` · Tests: `tests/biidaasige-dodem-three-island.test.mjs` ·
This file.

The **adjacent** pale-curbed woodchip island that contains the **turtle, musky and eagle**. The boundary is the
Captain's independently source-photograph-matched aerial trace of the 2025 City ortho (65 vertices), projected through
the city's own `C.worldFromLatLon` at call time. The module binds no site coordinate of its own, reads no network or
image, edits no other module, and adds no terrain system.

## What is built

| Item | Value | Status |
|---|---|---|
| Woodchip top | `y = .232 m` | source ground `.224` + the same **explicit 8 mm finish choice** as the first island |
| Curb top | `y = .284 m` | `.224` ground + **explicit 0.06 m rise** (photo estimate) |
| Curb width | `0.12 m` | **explicit photo estimate**, not surveyed |
| Boundary | 65 traced vertices | Captain aerial trace, `traceErrorM 0.6`, `placementUncertaintyM 3` |
| Meshes | 2 (woodchip + curb) | one bounded root group for culling |

- The boundary is the **exact traced concave polygon**, earcut by the shared `THREE.ShapeUtils.triangulateShape`
  helper (no handmade ellipse/rectangle, no fan fill, no bounding-box fill). All 65 source vertices are preserved.
- The **pale concrete curb strip** follows the same concave ring as bounded per-segment quads (top face + outer wall +
  inner wall), never one box wall. Miter offsets are clamped finite; degenerate quads are skipped.
- **No animal, trunk, tree, sign or furniture is placed, and there is no absolute pose.** The turtle, musky and eagle
  are named by the source (MVVA finished-site photograph) and identified for the reader; they are not placed here.
- The Captain personally viewed the cyan trace overlay (`$WATERFRONT_RESEARCH/biidaasige/captain/three-island-trace-check.png`)
  against the actual curb; the trace matches.

## Shared helpers, distinct state

This island **shares the first island's actual helpers and materials** and keeps a **distinct record, query and state**:

- Shared: `C.biidaasigeWoodchipIslandHelpers.{triangulateFaces, refineTriangles, surfaceGeometry, curbGeometry,
  collectTriangles, buildIndex, queryAt, curbColliders, woodchipMaterial, curbMaterial}`.
- Distinct: `C.biidaasigeDodemThreeIsland` (record) and `C.biidaasigeDodemThreeIslandAt(x, z)` (query). This module
  never reads or mutates the first island's record, and the first island's query never answers for this island.

## Geometry contract

- Concave-safe: the traced ring is earcut by the shared helper; the triangulated area equals the ring area (~190 m²
  for this trace).
- Long triangles are optionally midpoint-refined (bounded, `maxEdge` 2 m, `maxTris` 2000), staying inside the polygon.
- **ONE bounded root group** (`cullDistance`/`cullCell`) with **TWO meshes** (woodchip + curb).
- WGS84 → world **only** through `C.worldFromLatLon` **at call time**, so it works in both real frames (the detail
  frame and the default `?map=eglinton` frame). A missing source, missing projection, **missing shared helpers**,
  degenerate ring or failed triangulation builds **nothing** and says why.
- `surfaces` entries are copied from the **actual rendered mesh triangles**, rewound upward (`kind: 'woodchip'` top
  and `kind: 'curb'` top). Every one is verified in the test by an **independent THREE downward raycast**.
- `colliders` is `[]` by default: a 6 cm curb is a step, not a wall. `opts.curbColliders === true` emits finite,
  bounded per-segment AABBs for the curb only.

## API

```js
const C = window.CITY;                         // needs C.THREE, C.worldFromLatLon and the first island's shared helpers

const out = C.buildBiidaasigeDodemThreeIsland(scene, opts); // scene optional
out.group;      // THREE.Group, added to `scene` only when passed
out.surfaces;   // [{ triangle: [x,y,z, x,y,z, x,y,z], kind: 'woodchip'|'curb' }] — exact rendered top triangles
out.ringWorld;  // [[x,z],...] projected traced ring (all 65 vertices)
out.footprint;  // alias of ringWorld, for the Captain's shared footing
out.source;     // { schema, bead, featureId, sourceUrl, sourceDate, sourceExport, traceErrorM, placementUncertaintyM, ... }
out.finish;     // { groundY: .224, woodchipY: .232, curbWidthM: .12, curbRiseM: .06 }
out.colliders;  // [] by default; bounded curb AABBs only with opts.curbColliders === true
out.stats;      // { meshes, triangles, woodchipTriangles, curbTriangles, areaM2, vertices, sharedHelpers, ... }
out.skipped;    // [] (a single source trace; a missing source is reported in stats.reason)

C.biidaasigeDodemThreeIslandAt(x, z); // { onIsland:true, kind, surfaceY } | null
```

`C.biidaasigeDodemThreeIslandAt` reads a **4 m cell index** built from THIS build's published triangles, so it returns
the **actual physical surface** (`surfaceY`/`kind`, never a floating name-only answer), never scans the full triangle
set per frame, and never answers from a stale build. An invalid rebuild clears the record and the query.

## Estimates vs sources

| Kind | Item |
|---|---|
| **FACT** | The boundary is the Captain's 65-vertex aerial trace of the 2025 City ortho, projected through the city's own projection, and personally checked against the actual curb. |
| **FACT** | Source ground `y = .224 m`; woodchip top `y = .232 m` (explicit +8 mm finish choice). |
| **STYLE ESTIMATE** | Curb width `0.12 m`, rise `0.06 m`, pale concrete colour, woodchip colour/grain — photo estimates, not surveyed. |
| **SOURCE IDENTITY** | The turtle, musky and eagle are named by the MVVA finished-site photograph; the source photo identifies animals, not construction objects. |
| **UNCERTAINTY** | Trace error `0.6 m`; whole-trace placement uncertainty `3 m`, not surveyed. |
| **NOT DONE** | No animal/absolute-pose placement, no per-chip scatter, no copied texture, no global fill. |

## Regenerate / verify

```bash
node tools/build-biidaasige-dodem-three-island.mjs          # inject the fixture DATA into the module
node tools/build-biidaasige-dodem-three-island.mjs --check  # exit 1 if the module is stale
node --test tests/biidaasige-dodem-three-island.test.mjs    # 8/8 focused CPU checks
```

The fixture `tools/fixtures/biidaasige-dodem-three-island.json` is **READONLY** here; the Captain owns it and the
integration (`explore.html` script ordering). This worker does not edit the page.

## Sources

- City of Toronto 2025 ortho (`cot_ortho_2025_color_8cm`), aerial trace by the Captain, 2026-11-11.
- MVVA finished-site overhead photograph — animal identities (turtle, musky, eagle) and island arrangement.
- City of Toronto / Waterfront Toronto — Biidaasige Park, 2026 (see `docs/biidaasige-park.md`).
- Material colours and curb dimensions are photo-read style estimates, documented above; no image is embedded.

## Runtime acceptance

The 190.9 m² source footprint is integrated alongside the first island, with matching actual triangles in the shared 4 m footing grid. The captain verified and masked six coarse path triangles intruding into the photographed island; hidden source-path footing no longer overrides its visible .232 m woodchip surface. Only local path material clones are masked; distant shared materials remain intact. Build `967e81d62e19` passed six desktop and six portrait views on the Mac mini (`dodem-seven-*`). Full suite: 1,333 passed, zero failed, three existing skips. Turtle, musky and eagle are positioned by the separate reviewed photo adapter, not this surface factory.
