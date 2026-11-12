# Biidaasige Park — source-matched timber play infrastructure & ground finishes

Bead: `st-bmyv.9` (child of `st-bmyv`). Module: `js/biidaasige-play-infrastructure.js` ·
Tests: `tests/biidaasige-play-infrastructure.test.mjs` · This file.

This module builds the **timber play infrastructure** and its **ground finishes** for the eastern (play) park,
matched to the sources the captain inspected. It is a **pure CPU geometry module**: it binds no site coordinates,
reads no network or image, edits no other worker's file, and places nothing in a scene unless the captain's
anchor plugin does it.

## What is a FACT and what is an ESTIMATE

Facts are kept apart from photo estimates, and both are labelled in the returned `facts` / `estimates` objects.

| Kind | Item |
|---|---|
| **FACT** | Cableway Canyon has **20 m and 40 m** cableways (City of Toronto, Recreation at Biidaasige Park). |
| **FACT** | The 2025 City 8 cm ortho shows **two separate, offset cableway corridors** (short 20 m, long 40 m) and **two adjacent Swing Hill pads** with separate swing frames — recorded in `tools/fixtures/biidaasige-play-ortho-anchors.json` (read, never edited here). |
| **FACT** | The timber play structures were made by **WholeTrees** — oversized White Oak **inverted-trident trees** with log circuits, balancing and beam structures (manufacturer press release, Blue Medium). |
| **PHOTO** (captain's read of `captain/cableway-csla.jpg`, CSLA case study — viewed, never reproduced) | Rustic **natural grey timber** A-frames ~4 m high, legs ~0.23 m diameter, foot spread ~4 m at both ends; a steel cable between the apexes with a **black trolley** and a hanging **round rubber seat**; a curved, elongated **red-terracotta + cream rubber corridor ~5 m wide** with a slight bowl and wavy mound ends; curved stone edging; **boulders clustered at the entry**; an adjacent woodchip area behind a **low pale-chestnut picket fence ~0.65 m** on two thin wire strands with a wide open entry. |
| **PHOTO** (captain, WholeTrees primary photo + 2025 City 8 cm ortho) | **SIX** tall pale weathered White Oak **inverted-trident** trunks, ~**5–6 m** high. A slender upper trunk (**~0.35–0.45 m**) runs from a fork at **~2.3 m** up to an irregular flat cut top at **~5.4 m**. **THREE** thick tapering flared lower branches reach the ground ~3 m across and form walk-through arches. **No** solid central trunk from 0 to the fork (the central arch stays clear). Six units in a compact staggered line ~5 m across × ~8 m along on the woodchip island west of the shade canopies / Owl. |
| **ESTIMATE** | Every other dimension: pole section beyond 0.23 m, seat/chain sizes, rubber thickness and band count, corridor curve, mound amplitude, boulder sizes and counts, fence geometry, log tangle width ("~2.5 m"), log-beam counts, swing counts and seat kinds, and the **six-unit staggered layout with individual heights/yaws**. Explicitly labelled; not surveyed or mapped counts. |

The City publishes **only** the 20 m / 40 m lengths; the model **refuses any other `lengthM`** (a `RangeError`
naming the accepted lengths) rather than clamping to an unsourced length.

## The local axis contract

The ortho contract fixes the **long axis to +X, origin at the corridor centre**. The parent computes yaw from each
fixture's `endpointsLatLon` bearing and places the local-origin group. The built ground sits with its **low edge at
y = 0**; the parent uses the existing **0.224 m lawn datum** as the group's `y`, so the raised ground tops out at
**~0.224 + 0..0.45 m** — the "raised ground only 0–0.45 m photo estimate" the captain asked to preserve. The module
records `raisedGroundMaxM` (the measured highest corridor triangle, kept ≤ 0.45 m).

## API

```js
const C = window.CITY;                       // needs C.THREE (and C.Addons.mergeGeometries, optional)

const c20 = C.buildBiidaasigeCableway(20);    // or 40 — other lengths throw a RangeError
c20.group;                                    // THREE.Group, local origin, long axis +X, NOT added to a scene
c20.surfaces;                                 // [{ triangle:[x,y,z,...9], kind }] — exact rendered ground-top triangles
c20.surfaceHeightAt(x, z, { baseY, maxRise });// exact rendered triangle height | null (never an analytic sample)
c20.colliders;                                // solid A-frame legs only (prop:true) — the corridor is clear
c20.raisedGroundMaxM;                         // the measured raised-ground top (≤ 0.45 m)
c20.lengthM; c20.longAxis; c20.placementStatus;// 20|40, 'x', 'unplaced'

const swingN = C.buildBiidaasigeSwingSet({ seats: ['flat'], pad: 'north' });
const swingS = C.buildBiidaasigeSwingSet({ seats: ['flat', 'basket'], pad: 'south' });

const cluster = C.buildBiidaasigeInvertedTrees();          // the SIX-unit identifiable cluster (default photo-estimated layout)
const cluster2 = C.buildBiidaasigeInvertedTrees({ layout: [{ x, z, yaw, heightM }, ...] }); // caller-supplied 6 units
const preview = C.buildBiidaasigeTimberPlay();              // LOCAL PREVIEW aggregate: cluster + generic log circuit + mock dam
```

### Returned shape (all three factories)

Every factory returns `{ group, colliders, surfaces, triangles, surfaceHeightAt, ... }`.

- **`surfaces`** is the repo format: `[{ triangle: [x0,y0,z0, x1,y1,z1, x2,y2,z2], kind }]` in **local**
  coordinates (parent transforms: `CITY.biidaasigeAddModel`). Only **walk-on ground finishes** are listed (the
  rubber + cream corridor bands and stone edging for the cableway; the woodchip apron for the swing frame); cables,
  chains, boulders and timber are not walkable. Every entry is a **real upward (+Y) wound rendered triangle**, so an
  independent downward ray hits it and `surfaceHeightAt` reads it directly.
- **`surfaceHeightAt(x, z, opts)`** returns the **exact rendered triangle height** (barycentric over `surfaces`),
  never an analytic approximation; `null` off the surfaces. With `opts.baseY` + `opts.maxRise` it returns `null` for a
  too-high step instead of clamping.
- **`colliders`** are **solid props only**, a `prop: true` box per A-frame/swing leg, per lower-branch/foot and per
  upper trunk (inverted trees), or the log bundle. The **corridor centre line is clear**, each tree's **central arch
  below the fork is clear**, there is **no group AABB**, and a ground finish is never a collider.
- Meshes are **merged by material** to **< 10 draw calls per setup**.

### Cableway (`buildBiidaasigeCableway(lengthM, opts)`)

Two **rustic natural grey timber A-frames** (bowing legs from a bolted apex + a ground sill log) at `x = ±lengthM/2`,
a **steel cable** sagging between the apexes, a **black trolley** and a hanging **round rubber seat**, on a curved
**red/cream rubber corridor** (bowl cross-section, wavy mound ends, real skirt thickness) with **stone edging** and
**entry boulder clusters**. `opts.spec` overrides the estimate table.

### Swing Set (`buildBiidaasigeSwingSet(opts)`)

A timber A-frame swing set for **one Swing Hill pad**. `opts.pad` is `'north'` or `'south'` (the ortho shows two
adjacent pads; the parent places one frame per pad). `opts.seats` is an array of seat kinds (`'flat'` belt / `'basket'`
toddler bucket) — its length is the swing count (1–3), or pass `opts.swingCount`. The **seat arrangement is
ESTIMATED** (`swingCountBasis`), not an official total. A woodchip apron finishes the ground.

### Inverted trees (`buildBiidaasigeInvertedTrees(opts)`) — the identifiable cluster

The **SIX** WholeTrees inverted-trident White Oak units, matched to the captain's primary photo and the 2025 City ortho.
`opts.layout` is an array of `{ x, z, yaw, heightM }` (local origin at the cluster centre); the **default is the
photo-estimated staggered 6-unit layout** (individual heights/yaws are explicit ESTIMATES). Each unit builds:

1. a **slender pale upper trunk** (~0.35–0.45 m) from the fork (~2.3 m) to an **irregular slanted cut top** (~5.4 m),
   naturally **curved and leaned** (the upper-stem centre drifts/leans **~0.15–0.35 m** with height, one or two narrow
   knots at ~10–20 % radius) — a weathered sawn oak stem, not a straight pipe;
2. **three thick tapering flared lower branches**, each a **smooth 5-segment curve** (not a sharp 2-segment A-frame) from
   the fork down to flared feet ~3 m across, with natural asymmetry (foot angles and lengths vary ~10–15 %), leaving a
   ~2 m walk-through arch;
3. **no solid central trunk** from 0 to the fork — the central arch space is preserved empty.

Materials are the **weathered pale cream-grey** White Oak family (`paleOak` / `paleOakShade` / `paleOakEnd`), merged to a
**few draw calls** (~4). The only solid colliders are the **lower-branch/foot segments** and the **upper trunk above the
fork** (a small box per stem segment, so the colliders **follow the bent stem** rather than spanning the empty space
beside the lean) — no cylinder in the central arch, no group AABB. Each unit reports its actual `upperTop`, so a ray/CPU
check aims at the real (leaned) top, not the original base centre. The returned `surfaces` are the **woodchip island ground
finish** only (the cluster is **not** a pretend floor at each tree). This function builds **only** the identifiable site;
generic log-circuit and mock-dam parts are not dragged in.

### Local preview (`buildBiidaasigeTimberPlay(opts)`)

A **local-preview aggregate** (the park's own count/layout is unknown and **not claimed**): inverted-trident units plus
a low log circuit and a mock-dam log tangle, from real parts. The captain builds the identifiable cluster with
`buildBiidaasigeInvertedTrees` and places it at the City ortho cluster anchor.

## What the tests prove (from the real rendered geometry)

`tests/biidaasige-play-infrastructure.test.mjs` loads the **actual** module and checks, from the built THREE geometry:

1. **Only 20 m / 40 m** are accepted; `undefined`, `0`, `10`, `21`, `33`, `39`, `50`, `'twenty'`, `NaN` are **refused**.
2. The long axis is **+X**; the A-frames stand at **±length/2**; the corner legs are at the ~4 m foot spread; the apex
   is ~4 m.
3. The raised ground is a real, bounded **0..0.45 m**; boulders/cables/timber are **not** walkable surfaces.
4. Every surface triangle is **upward-wound**, and the query equals an **independent three.js downward raycast**
   (< 2 cm) over the corridor.
5. The legs are **solid props**, but **no collider covers the corridor centre line**, and **no giant corridor-wide box**
   exists.
6. Power: two **Swing Hill pad variants** (north/south), 1/2 seats and a **basket variant**, marked estimated.
7. The **six-unit** cluster builds as tall **~5–6 m** pale trunks with **empty central arches** (a horizontal ray crosses below the fork clear; a downward ray hits the tall trunk), **slender bounded colliders** (branch/feet + upper trunk only, no cylinder in the arch), and the **~0.35–0.45 / ~3 / ~2 m** photo proportions.
8. The no-`mergeGeometries` fallback still builds, and every setup stays **under 10 draw calls**.
9. `surfaceHeightAt` is exact on the query, `null` off the surfaces, and **never clamps** a too-high step.

## Placement & integration (the captain/parent owns it)

Nothing is placed here. When the parent integrates, it should:

1. Read the fixture `tools/fixtures/biidaasige-play-ortho-anchors.json` (do not edit it): `cableway-20`, `cableway-40`,
   `swing-hill-north`, `swing-hill-south` carry interpreted centres, `endpointsLatLon` bearings and a **conservative
   3 m** interpretation error.
2. Project each centre with `C.worldFromLatLon`, compute **yaw** from the matching `endpointsLatLon`, and place the
   group at `{ ...centre, y: CONFIG.groundY (0.224), yaw }`.
3. Transform the returned `surfaces` and `colliders` with the same pose (`CITY.biidaasigeAddModel` does this) so the
   rendered ground-top triangles and post colliders land in world space, and keep the published **20/40 m** length
   authoritative (do not stretch the model to the photo pixels).

## Sources & limits

- City of Toronto — Recreation at Biidaasige Park (Cableway Canyon 20/40 m; Swing Hill zone).
- City of Toronto **2025 8 cm orthophoto** (two offset cableway corridors; two Swing Hill pads) — via the checked-in
  fixture; the captain's full-resolution read is authoritative.
- WholeTrees / Blue Medium manufacturer press release (inverted-trident White Oak trees, log circuits, balancing and beam
  structures).
- CSLA Port Lands Flood Protection Program, Biidaasige Park photograph — the captain's read of `captain/cableway-csla.jpg`;
  **no copyrighted photo is copied into the repository**.

The 20/40 m lengths and the two-corridor/two-pad facts are authoritative. Everything dimensional that is not the
20/40 m length is a **photo/ortho estimate** recorded in `estimates`. The park's own timber-part count and layout are
**unknown** and are not claimed; this module composes real parts, it does not reconstruct the whole play forest.
