# Biidaasige Park — source-footprint play ground surfacing

Bead: `st-bmyv.9` (child of `st-bmyv`). Module: `js/biidaasige-play-pads.js` ·
Tests: `tests/biidaasige-play-pads.test.mjs` · This file.

A small **ground layer**: two flat, source-footprinted play surfaces drawn on the generic lawn, from the current
OpenStreetMap polygons the parent inventory worker (`st-bmyv.1`) already carries. It binds no site coordinate of its
own, reads no network or image, edits no other module, and adds no terrain system.

## What is built (exactly two footprints)

| Pad id | Source (current OSM) | Material | Top |
|---|---|---|---|
| `reaching-raccoon` | `way/1418796674` — the actual Reaching Raccoon structure footprint (~137 m²) | muted **sage/grey poured rubber** | `y = .224 m` |
| `snowy-owl-playground` | `way/1418127159` — a **generic west playground area** (~7069 m²) | muted **brown woodchip/gravel base** | `y = .224 m` |

- The western pad's **id is legacy**: it is the general west play bed, **not** a claim that its centroid is the Snowy
  Owl structure. A separate worker is adding the exact Snowy Owl Theatre polygon; this module does not race that data.
- The pad top is **exactly `.224 m`** — the CITY sidewalk lawn datum (`.22`) + `.004`, the same base the main model pads
  use. It is flat (a ground pad, not a heightfield).
- **The western base material is a representative reconstruction** of the mixed woodchip/gravel surfacing seen in the
  maker/City photos. The individual woodchip islands are **not surveyed**, so the bed is drawn as **one muted base
  tone**; no per-island scatter, no invented counts.

## What this layer is not

- It fills **neither the whole park nor a river**. A source polygon whose interior contains a water-ring vertex is
  **refused** (reported in `skipped`), never bridged.
- It does **not** raise, move or suppress the other workers' surfaces. The **path layer**
  (`js/biidaasige-paths.js`, `y = lawn + 0.030`) and the **rubber cableway corridors**
  (`js/biidaasige-play-infrastructure.js`, raised ground `0..0.45`) sit **above** this pad. The named **Badlands**
  polygon is another worker's raised surface whose terracotta geometry overlays this base.
- No global fill, no gates, no fence layout, no invented polygon across the river.

## Geometry contract

- Concave-safe: the source rings are earcut by `THREE.ShapeUtils.triangulateShape` (**no fan fill**). The triangulated
  area equals the ring area (the test pins the ~137 m² and ~7116 m² footprints and an L-shaped 20 m² control).
- **ONE merged mesh per source footprint** (two draw calls), Node/`MeshStandardNodeMaterial` with rough matte finishes
  (`roughness` 0.96 / 0.98, `metalness` 0).
- WGS84 → world **only** through `C.worldFromLatLon` **at call time**, so it works in both real frames (the detail
  frame and the default `?map=eglinton` frame). A missing source, a missing projection, a degenerate ring or a
  water-spanning ring builds **nothing** and says why.
- `surfaces` entries are copied from the **actual rendered mesh triangles**, rewound upward. Every one is verified in
  the test by an **independent THREE downward raycast** (`winding` is real, not just an assigned normal).
- `colliders` is `[]` — a ground pad is never a collider.

## API

```js
const C = window.CITY;                         // needs C.THREE and C.BIIDAASIGE_PARK

const out = C.buildBiidaasigePlayPads(scene, allColliders); // scene optional; allColliders untouched
out.group;      // THREE.Group, added to `scene` only when passed
out.surfaces;   // [{ triangle: [x,y,z, x,y,z, x,y,z], kind }] — exact rendered top triangles, world coords
out.areas;      // [{ id, ref, ring:[[x,z],...], areaM2, y, material, sourceRef, sourceStatus, triangles, ... }]
out.colliders;  // [] — never a collider
out.skipped;    // [{ id, reason }] for any footprint refused (e.g. missing source / water span)
out.stats;      // { meshes, triangles, padCount, colliders, topY, material, estimates:true, source, reason? }

C.biidaasigePlayPadAt(x, z); // { onPad:true, kind, padId, surfaceY } | null — exact-triangle height, null off the pads
```

`C.biidaasigePlayPadAt` is **rebuilt on every successful build** and reads only the current `C.biidaasigePlayPads`
record, so an invalid rebuild clears the stale pads instead of answering from them. It returns `null` (never a
clamped/global height) off the pads.

Pure helpers for a consumer/test, without a scene:
`C.biidaasigePlayPadHelpers.{padGeometry, pointInRing, ringArea, dedupeRing, makeTriangleQuery, queryAt}`.

## Estimates vs sources

| Kind | Item |
|---|---|
| **FACT** | The two footprints are the current OSM polygons (`way/1418796674` merged structure, `way/1418127159` west area), projected through the city's own projection. |
| **FACT** | Pad top `y = .224 m` (CITY lawn datum `.22` + `.004`), the base the main model pads use. |
| **STYLE ESTIMATE** | Rubber colour (muted sage/grey `0x8f9489`) and roughness — no published RGB. |
| **STYLE ESTIMATE** | Western base colour (muted brown `0x8a6f52`) — a **representative reconstruction** of mixed woodchip/gravel; individual islands not surveyed. |
| **NOT DONE** | No global fill, no gates/fences, no individual woodchip islands, no per-chip scatter. |

## Regenerate / verify

```bash
node --test tests/biidaasige-play-pads.test.mjs    # 8/8 focused CPU checks
```

The module is wired into the page by the captain's integration pass (`explore.html` script ordering); this worker does
not edit it.

## Sources

- Current OpenStreetMap contributors (ODbL), 2026-11-10 — `way/1418796674`, `way/1418127159`.
- City of Toronto / Waterfront Toronto — Recreation at Biidaasige Park, 2026 map (see `docs/biidaasige-park.md`).
- Material colours are photo-read style estimates, documented above; no image is embedded or reproduced.
