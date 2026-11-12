# Biidaasige Park — Badlands Scramble & adventure play

Bead: `st-bmyv.4` (child of `st-bmyv`). Module: `js/biidaasige-adventure-play.js` ·
Tests: `tests/biidaasige-adventure-play.test.mjs` · Footprint API: `js/biidaasige-park-data.js`
(owned by another worker — this module only **reads** it).

This module builds **one placed** feature — the **Badlands Scramble** on its exact OSM footprint —
and provides **unplaced** reusable factories for the rest of the adventure play cluster. It edits no
shared runtime and invents no park coordinates.

## The Badlands Scramble

| Source | Fact |
|---|---|
| City of Toronto — Recreation at Biidaasige Park (mod. 2026-09-09) | 1,600 m²; **three wavy levels**; flat stone-pavement sections; a water feature **pumped down its slopes** |
| OpenStreetMap **way/1418541993** | the mapped polygon outline (Adventure-play footprint) |

The captain's read of the official City photo (`captain/badlands.jpg`, viewed, not reproduced) gives the
material language this build follows: **warm terracotta / red-orange sculpted shotcrete**, **rounded,
rippling**, three broad wavy terraces with **flat winding cream stone channels** and paved landing
strips, embedded **rounded granite boulders**, small **stainless hoop hand-pumps / water troughs**,
grates, low stone edging and tall timber poles.

### Footprint: the mapped outline, not the official rectangle

The module takes the footprint from the **existing** park-data API —
`C.biidaasigeParkRingWorld('badlands-scramble')` (the projected OSM ring) and
`C.biidaasigeParkFeature('badlands-scramble')` (the `way/1418541993` ref and the areas). It never copies
a private ring and never edits the park-data file. The world ring is the city's own projection
(`C.worldFromLatLon`), so it is consistent with the whole city.

**Area honesty.** The mapped ring's shoelace area is ≈ **1,129 m²** (park-data records the mapped
area as ≈ **1,122 m²** and the official City area as **1,600 m²**). The two differ; this build **does
not** pretend the mapped outline is 1,600 m² and does **not** expand an unscaled rectangle to fake it.
`footprint.areaM2` is the ring, `footprint.officialAreaM2` is 1,600, `footprint.osmAreaM2` is the
mapped figure. (Reported honestly: the real play area is the published 1,600 m²; the OSM outline is
smaller and is what gets built here, awaiting a larger surveyed outline.)

### Geometry: a continuous, undulating, walkable triangle mesh

The floor is a **real triangle mesh of the OSM ring**, triangulated by **ear clipping** so the
**concave** outline is covered **exactly** (Sutherland–Hodgman clipping against the whole concave ring
would clip to the convex *kernel* and silently drop the concave bays — so it is not used). Each
triangle is then **subdivided** to a ~1.6 m cell and every vertex height sampled from the sculpted
field, so the instrumented mesh is continuous and follows the landform — **not stacked uniform boxes
and not random cones**.

The sculpted field (`buildBadlandsField`) is three **broad wavy terraces** climbing along the
footprint's long axis (a landing then a smooth slope up to each crest), with a transverse Cheltenham
ripple and a shallow meandering gully. The rendered height is:

- **blended to 0 at the OSM boundary** (over `boundaryBlend` = 2.2 m) so the walkable footing meets
  the flat ground at **y = 0** — no floating 1 mm lip, and the raised mesh is a closed solid with a
  low outer step, not a floating sheet;
- **tapered at both long-axis ends** so the crown is inset and a player can walk on and off from any
  edge;
- **clamped ≥ 0** (no negative height below the ground datum).

Ground base stays at the current runtime datum (y = 0); `baseY` is a **build-time placement offset**
baked into both the geometry and the query, not a player-height input to the query.

Accessories (all inside the footprint, none adding to the floor outside it): the **cream stone
channels** and **paved landing strips** (static **visual flow only — no water physics**), embedded
**granite boulders**, stainless **hoop hand-pumps with troughs and grates**, the **low stone edging**
following the OSM ring exactly, and **tall timber poles**. Boulder / pump / pole counts are
**representative photo estimates**, never a mapped count.

### The surface query: exact rendered-triangle height

`biidaasigeAdventureSurfaceAt(x, z, opts)` (and `result.surfaceHeightAt`) returns the **exact world
height of the rendered triangle** at `(x, z)`. Every stored triangle vertex is the mesh's own baked
world height (the `baseY` offset is already in the geometry), so the query returns what is drawn —
verified against an **independent THREE downward raycast** (< 1 cm agreement).

- It answers **only inside the rendered footprint** (point-in-OSM-ring + a triangle hit). Off the
  footprint it returns **null** — there is **no implicit global deck/plate exemption**.
- `opts.baseY` is the **player's current height** and `opts.maxRise` the **allowed step**. If the
  rendered height is **above** `playerBaseY + maxRise`, the query returns **null** (the step is too
  high to mount) — it does **not** clamp the surface to a fake step height, and repeated calls from an
  updated player height never grow the returned height. With neither option supplied it answers
  independent of any player (a plain surface sample).
- Returns `{ id: 'badlands', x, z, y, h, terrace, meshDatum }` on a hit.
- **It never builds geometry.** It answers from the query the last build **registered**; before any
  build (or when the frame lacks the site) it returns **null** — no fallback that constructs a mesh
  inside a height query.

## Unplaced adventure factories

The rest of the cluster has only published **zones** (cableways, Swing Hill, mock beaver dam) or
**no** published individual positions (the seven Dodem animals). This module therefore **never places
them**: every factory returns `position: null`, `placementStatus: 'unplaced'`, and a group that is not
added to any scene.

| Factory | Source | Output |
|---|---|---|
| `buildCableway({ lengthM })` | Cableway Canyon has **20 m and 40 m** cableways | posts + taut cable of the official length; an unofficial length **clamps** to the nearest official one (`clamped: true`) |
| `buildSwingHill({ swingCount })` | swings on **Swing Hill** | a timber A-frame with a chosen swing count |
| `buildMockBeaverDam()` | the **mock beaver dam** play area | a log tangle on a low base |
| `buildDodemSculpture(kind)` / `buildDodemSet()` | the **seven** Dodem clan animals (bear, beaver, eagle, turtle, otter, wolf, musky fish) | see below |

### The seven Dodem animals — only the eagle is modelled

The City **lists** seven clan animals but this repository has only **one** primary photo — the
**eagle** (`captain/dodem-eagle.jpg`: a low carved **solid natural-wood** eagle with a bold black
painted chest, a white head, a broad yellow hooked beak and brown wings). So this build models **only
the eagle** from its photo. The other **six are EXPLICIT PLACEHOLDERS with unknown geometry** (a plain
carved block on a base, deliberately with **no species silhouette**) — not six finished animals. Each
placeholder carries `placeholder: true`, `verifiedAppearance: false`. The parent worker owns the
higher-fidelity follow-up once each animal has its own photo.

## API

```js
const C = window.CITY;                 // needs C.THREE, C.worldFromLatLon, and the park-data API
const b = C.buildBadlandsScramble({ baseY });   // placed on way/1418541993 (or null off-frame)
b.group; b.triangles; b.drawCalls; b.colliders;  // colliders = solid props only (poles), not a terrain box
b.footprint;                                     // { ring, areaM2, officialAreaM2, osmAreaM2, way }
b.surfaceHeightAt(x, z, { baseY, maxRise });     // exact rendered-triangle height | null

const c20 = C.buildCableway({ lengthM: 20 });    // unplaced
const swing = C.buildSwingHill({ swingCount: 3 });// unplaced
const dam  = C.buildMockBeaverDam();             // unplaced
const dodem = C.buildDodemSet();                 // unplaced; eagle modelled, six placeholders
const cluster = C.buildBiidaasigeAdventurePlay();// builds ONLY the Badlands; factories deferred
```

No-claim guards baked in: `climbable: false` (movement/footing is the captain's), `waterPhysics: false`
(the channels are visual), no boulder/pump/pole count is a mapped count, and the Terrain is **not** a
collider box (only tall timber poles are solid props).

## What the tests prove (from the real rendered geometry)

`tests/biidaasige-adventure-play.test.mjs` (14 tests) loads the **actual** park-data API + this module
with the real city projection and checks: `buildBadlandsScramble()` is **non-null** on the **actual**
way/1418541993 ring; null without the projection or off-frame; the floor XZ area equals the ring (ear
clipping, no convex-kernel loss) and is bounded/finite; the boundary height is ~0 with no sub-datum
dip; `{baseY}` bakes into geometry **and** query; the query matches an **independent THREE raycast**
(< 1 cm) and answers only inside the footprint; the `playerBaseY + maxRise` gate returns **null** for a
too-high step (no clamp, no growth on repeat); the global query **never builds** (null until a build
registers); the cableways are the official 20/40 m and clamp elsewhere; Swing Hill and the mock dam are
unplaced; the seven Dodem are unplaced with the eagle modelled and the six explicit placeholders; the
cluster builds **only** the Badlands; and the no-`mergeGeometries` fallback still builds.

## Sources & limits

City Recreation page (1,600 m²; three wavy levels; flat stone pavement; pumped water; Cableway Canyon
20 m + 40 m; Swing Hill; mock beaver dam; seven Dodem clan animals); OSM way/1418541993 (ODbL); the
captain's authoritative read of the primary City photos (`captain/badlands.jpg`,
`captain/dodem-eagle.jpg`) in `$WATERFRONT_RESEARCH/biidaasige/`. No copyrighted photo is copied into
the repository — cited only. The real play area is the published 1,600 m²; the OSM mapped outline is
smaller (≈1,129 m²) and is what this build constructs, pending a larger surveyed outline. The six
non-eagle Dodem animals are placeholders, not finished sculptures.
