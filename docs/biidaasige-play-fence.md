# Biidaasige Park — reusable local playground fence factory

Bead: `st-bmyv.4.3` (child of `st-bmyv.4`). Module: `js/biidaasige-play-fence.js` ·
Tests: `tests/biidaasige-play-fence.test.mjs` · This file.

This module builds the **pale natural chestnut-style narrow picket fence** seen at the Biidaasige
playgrounds, as a **reusable local ring/run factory**. It binds no park coordinates, reads no
network or images, edits no other worker's file, and places nothing in a scene. The captain
integrates it by supplying the source island perimeters (and any photo-confirmed openings) later.

## What is a FACT and what is an ESTIMATE

There is **no public product sheet, manufacturer, spec or survey** for this fence. The only
evidence is visual: the captain personally viewed the City's 2026 installed-Dodem ground photo and
the actual MVVA **4800×3600** finished overhead. The maker is **unknown**; no manufacturer,
contractor or product is asserted.

| Kind | Item |
|---|---|
| **PHOTO (captain-read)** | Pale natural **chestnut-style narrow wood pales ~0.9 m above ground**. |
| **PHOTO** | **Thin round / irregular flattened pales, 0.04–0.05 m wide**, with **small uneven pointed tops**. |
| **PHOTO** | **Two thin horizontal metal wire ties** at **~0.3 m and ~0.65 m**. |
| **PHOTO** | **Thicker wood posts every ~2 m**. |
| **ESTIMATE** | Every other dimension: pale spacing, post diameter/section, wire gauge, the deterministic height irregularity, collider thickness. |
| **NOT IDENTIFIED** | The photo maker. The Biidaasige **dog-area** fences were **not** identified in the sources reviewed here — this is a **distinct construct** and must not be merged with them. |

**All physical dimensions above are photo ESTIMATES, not a survey.** They are exposed in the
returned `sourceConfidence` and `stats.estimates` objects so a caller and a reviewer can see exactly
what is sourced visually and what is assumed.

## What this module does NOT do

- It does **not** decide where gaps are. `opts.gaps` carries **caller-confirmed** absolute
  arc-length openings; without them the run is built complete. The factory invents **no** gap
  location or caption.
- It does **not** assume the perimeter is closed. `opts.closed: false` builds an open run.
- It does **not** place the fence on the default scene or on any island. It returns an unplaced
  local group.
- It contains **no art or cultural graphics**; the geometry is plain wood and wire.

## API

```js
const C = window.CITY; // needs C.THREE (optional at load; required at call time)

const fence = C.buildBiidaasigePlayFence(
  [[0, 0], [30, 0], [30, 20], [0, 20]],    // ordered [x, z] ring vertices, metres
  {
    closed: true,                          // default; false = open run
    groundY: 0.224,                        // number or (x, z) => number; default 0
    gaps: [{ startM: 50, endM: 10 }],      // caller-confirmed absolute arc-length openings (may wrap on a ring)
  }
);

fence.group;            // fresh THREE.Group, unplaced, local origin, +Y up, 1 unit = 1 m
fence.colliders;        // slim oriented proxy boxes, per <= 2 m segment, clipped at gaps
fence.stats;            // lengthM, instanceCount, triangles, meshes, bounds, gaps, estimates, limits...
fence.sourceConfidence; // the source/estimate record above
```

### Input contract

- `points`: a finite ordered array of `[x, z]` (or `{x, z}`) vertices in metres. Consecutive
  duplicate vertices and a repeated closing vertex are dropped. A closed ring needs at least **3**
  distinct vertices; an open run needs **2**. Non-finite coordinates throw a `TypeError`.
- `opts.groundY`: a number (all pales/posts/colliders rest on it) or a function `(x, z) => number`.
  Default **0**. The caller supplies the site datum; the factory stores no world or park offset.
- `opts.gaps`: absolute arc-length intervals `{ startM, endM }` measured along the run from the first
  vertex. On a closed ring an interval whose end is before its start **wraps the seam** (e.g.
  `95 → 5`); it is reported as two linear intervals in `stats.gaps`. Negative or reversed inputs
  are normalized into `[0, L)` rather than producing `NaN`. A non-finite interval is ignored.

### Output contract

- **Geometry**: pure CPU. **`InstancedMesh` only** — at most **3 draw calls per run**
  (`play-fence-pales`, `play-fence-posts`, `play-fence-wire-ties`). There is **no mesh per picket**.
- **Pales**: one shared 5-sided pointed-prism geometry (20 triangles each), instanced. The base sits
  on `groundY`, the body is a **real volume** (not a flat quad), and a single apex narrows the top to
  a point. Height irregularity is deterministic, **height only, ±0.03 m** (a photo-estimate "visible
  irregularity", never a width or spacing randomisation).
- **Posts**: instanced cylinders every `postSpacingM` (~2 m), skipped at gaps, one at each closed
  ring's seam and at an open run's two ends.
- **Wire ties**: instanced 6-sided cylinders at the two tie heights, split at every gap so no tie
  spans an opening.
- **`colliders`**: **slim oriented proxy boxes**, one per `colliderSegmentM` (≤ 2 m) of run, clipped
  at gaps. Each carries `{ obb:{cx,cz,hx,hz,cs,sn}, minY = groundY, maxY ≈ groundY + 0.94 m,
  prop:true, proxy:true, claimsExactPicketGaps:false }`. There is **no whole-island box**: the proxy
  deliberately does **not** claim to resolve the exact picket gaps below player width; it is a
  continuous run guard.
- **`stats`**: actual `instanceCount`, actual `triangles`, `meshes`/`drawCalls`, `bounds`, `gaps`,
  `estimates`, and `limits`. All geometry is finite (checked by the tests).
- **Bounding metadata**: `group.userData.boundingBox`, plus `cullDistance` / `cullCell`
  metadata on the group and on each instanced mesh, matching the other props.

### Guards (refused before any large allocation)

| Guard | Value | Behaviour |
|---|---|---|
| Max run length | **500 m** | `RangeError` |
| Max instances | **5000** | `RangeError`; the estimate is checked **before** arrays are allocated, so an absurdly small `paleSpacingM` is refused rather than expanded |
| Triangles per 100 m | ≤ 40 000 (budget) | The default pale/post/wire set builds **~18 500 tris / 100 m** (a 100 m ring is ~18 460), well under budget |

Geometry budgets: ~18 500 tris per 100 m (≈9.3 pales/m × 20 + ~0.5 posts/m × ~30 + 1 wire/m × 2 tiers × 12).
A 500 m run (4 107 instances ≈ 81 000 tris) is permitted; the ≤ 40 000/100 m figure is a per-100 m
rate the default configuration satisfies with headroom.

## Local axis contract

1 unit = 1 m, **+Y up**, local origin at the first supplied vertex (the ring/run is used as given;
there is no implicit recentring). The caller rotates/positions the group onto its source island.
`stats.sourceUnits` and `stats.localOffset` record that these are caller-supplied metres, not park
coordinates.

## Compat, errors and graceful absence

- `C.THREE` is optional at module load: if `THREE` is absent the module still defines the factory.
  Calling the factory without `THREE` throws a clear error (`set C.THREE or pass opts.THREE`).
- `opts.THREE` may be passed explicitly (a test realm, or a different renderer build).
- Duplicate points, a repeated closing vertex, and negative/reversed gaps are all handled without
  `NaN`. Over-length input and an absurd spacing are **rejected, not clamped**.

## Sources

- City of Toronto — Biidaasige Park (2026) open-house park pages, and the installed-Dodem ground
  photo the captain viewed.
- MVVA project page: <https://www.mvvainc.com/projects/port-lands-flood-protection2> (the 4800×3600
  finished overhead the captain viewed).
- Context on the **distinct** dog-area fence search (honest negatives):
  `docs/biidaasige-dog-fence-photos.md`, `docs/biidaasige-fence-source.md`.

**No copyrighted image pixels or production model ship in the repository.** Every dimension in the
code is a labelled photo estimate.

## Where the fences go (placement, st-bmyv.4.3)

Module: `js/biidaasige-play-fence-runs.js` · Tests: `tests/biidaasige-play-fence-runs.test.mjs` · Shots:
`tools/shots/biidaasige-play-fence.json`. It is on by default: `js/biidaasige-park.js` builds one fence round each of the
two source-traced play islands (the six-oak woodchip island, 270.1 m², and the three-animal Dodem island, 190.9 m²)
using their traced rings, resting on the woodchip top (.232 m). Nothing sits behind a URL flag.

**Openings are derived from the mapped OpenStreetMap footways, not read from a photo.** The photo sources are only
described in this repo (no image pixels ship), so the run positions below are a rule, and a photo check can still move
them:

- Where a mapped footway crosses a ring, or ends within 2.5 m of it, the fence stops for a 2.4 m opening (estimate).
  Openings that would leave less than 1.5 m of fence between them are merged into one.
- If no footway reaches a ring, it gets one 2.4 m opening where its nearest footway (within 6 m) comes closest, so no
  island is sealed.
- Result: the three-animal island has two openings, where footway way/1419036047 ends (arc 33.9 to 36.3 m) and where it
  crosses the ring (arc 42.1 to 46.6 m). The six-oak island has one, nearest footway way/1419036049 (arc 70.5 to 72.9 m).
  No gate count or maker is asserted.

The cableway area's own lower (~0.65 m) fence with a wide open entry, described in `docs/biidaasige-play-infrastructure.md`,
is a different construct and is not built here.
