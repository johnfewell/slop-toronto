# Biidaasige Park heritage & placekeeping — Fire Hall 30, the Atlas Crane, The Drum

Bead: `st-bmyv.6` (child of `st-bmyv`). Module: `js/biidaasige-heritage.js` · Tests:
`tests/biidaasige-heritage.test.mjs` · Sources/photos: `$WATERFRONT_RESEARCH/biidaasige/heritage/` and the Captain's
read in `$WATERFRONT_RESEARCH/biidaasige/heritage-photo-review.md` (authoritative for visual facts).

Local-origin procedural models for the park's three retained/ceremonial structures, plus small factories for the
Marine Terminal 35 heritage fragments and an interpretive sign, plus the placement helpers and the one native
building exclusion seam the captain's integration needs. **No shared runtime is edited** (no `js/buildings.js`,
`js/main.js`, `js/city-grid.js`, controllers or explore); the module reads only `js/biidaasige-park-data.js` helpers.

| Structure | Who | Source |
|---|---|---|
| Fire Hall 30 | ERA Architects (lead design, heritage) | <https://www.eraarch.ca/projects/biidaasige-park-firehall-30/> |
| Atlas Crane | Waterfront Toronto heritage restoration | <https://www.waterfrontoronto.ca/news/meet-atlas-crane-unusual-park-feature-port-lands> |
| The Drum | Tawâw Architecture Collective Inc. | <https://www.tawarc.com/all-projects/the-drum-at-biidaasige-park> |
| MT35 fragments / interpretive sign | Waterfront Toronto (fragments) | 2026 west-expansion news release |

All three models are recognisable reconstructions built to the Captain's photo read and the public source text — not
the designers' production models. Photos are **credited, never copied** into the repository (ERA photography
© Mina Markovic; Waterfront Toronto and Tawâw photos likewise).

## Fire Hall 30

- **Identity is proven, not assumed.** The native committed GEO building row at world `(2383.9, 622.4)`, angle `-1.308`
  is a single `~21.6 × 13.2 m`, `8.4 m` part. The current OSM Fire Hall ring (`way/494886782`) has the **same eight
  edges** (2.43/3.33/3.38/4.00/7.02/8.78/17.61/20.98 m; max ~3.9 m vertex residual after a pure translation) and its
  centre sits `~26.9 m` **south** of the native row — exactly ERA's "relocated 24 metres south". So the native row is
  the **same building moved**, not a second one. The old native row must be **replaced**, never doubled.
- **Geometry** (local origin at footprint centre, ground contact, front `+Z` = the Commissioners Street facade):
  two storeys of red brick (Edwardian Classical), each storey a real wall mass; a cream stone belt course between
  floors; a heavy cream cornice/gutter; a raised dark-asphalt **hip roof** to a short ridge with a brick chimney on
  the rear hip step; the upper front carries **two triads of tall openings arranged narrow/wide/narrow** with burgundy
  frames, cream flat lintels + sills and cream keystones; a broad **glazed former engine-bay entry** on the left with a
  cream stone surround and canopy and the "Old Fire Hall 30" sign band; three tall ground-floor windows to its right;
  two exterior washroom openings on the `+X` side (ERA: public washrooms accessed directly from the exterior).
- **Height:** the only source label is `building:levels = 2`; the model renders a two-storey representative height of
  **6.5 m** plus an explicit photo-estimate hip roof above it. No guessed clamp.

## Atlas Crane

The Atlas is currently in its **restored WHITE paint** (WT text) but its **form** comes from the primary Waterfront
Toronto restoration photo (`captain/atlas-wt.jpg`, `DSC07621_0.jpg`) — the Captain's read of that photo is
authoritative. It is a huge white **GANTRY / A-frame**, modelled exactly as observed:

- **Four tall square-section (~1.4 m) lattice columns** at the corners of a rectangular portal (~10 m top span ×
  ~8 m deep), standing as **two pairs** of towers, each pair leaning gently toward its partner; near-vertical, ~35–38 m.
- **Individual white anti-climb sleeves** (~4 m) around **each** foot — not one solid plinth blocking the portal.
- **Top crossbeams** joining the paired tower heads (with a black cable/hoist **track** along them), plus front/back
  ties — the A-frame head.
- **One giant square-section (~1.5 m) lattice BOOM** running from the **top** near a back corner all the way **down
  to the ground ~25 m out front**, with a **pair of black cables** parallel along it. This long downward diagonal is
  the iconic silhouette.
- Four **individual foot colliders** + the boom's ground-footing collider.

**Deliberately absent** (this is the correction after the Captain's photo review): the earlier invented rotating
turret, mid-height operator cab, upward jib, hook hanging from an imaginary jib tip, invented counterweight block, and
any TMU student observation platform / stairs / lift. None exist as a mesh (the tests assert this).

**Labels:** the structure's own height is an **explicit photo-estimate, 35–38 m** (default 36 m); WT's "40 m / 140 ft"
is the **restoration scaffolding** (a different property). **`300-ton` is the structure's mass label** as the source
states it ("300-ton Atlas Crane") — **no lifting capacity is published, so none is claimed** (there is no
`capacityTons` field). Built of white-painted steel with the black hoist track and black boom cables.

## The Drum

- **An open circular shade structure**, per the Captain's read of the built Tawâw photos: a central **open oculus**
  (~half the overall diameter), a salmon-red **triangulated roof annulus** with a **white perimeter** edge and radial
  white trusses, a ring of **paired cream diagonal V-timber struts** on grey concrete feet, red-orange **curved panel
  walls** at some intervals with generous open-gap entrances, and a grey circular ground apron.
- **Source footprint** 2,164 ft² / **201 m²** (the modelled equivalent circle is ~16 m diameter). Completed **2026**,
  North Picnic Play Lawn. **No moon or cultural graphic is invented** — every material is flat (the test asserts no
  texture / map on any Drum mesh).
- **Never placed from this module:** the source publishes no point. `drumPlacement()` always returns `null`; the factory
  is built at local origin until a site is source-verified.

## Marine Terminal 35 fragments + interpretive sign

Small honest factories (marine bollard on a pad, a short retained rail section, a plaque plinth, an interpretive
reader; and a separate interpretive-sign factory). Waterfront Toronto states surviving MT35 heritage elements are
incorporated into the western section, but **no published point** exists, so both are returned **unplaced** and carry
`placement: "unverified …"`. No artwork or future amenity is invented.

## API (`window.CITY`)

```js
const C = window.CITY;                 // needs C.THREE and (optionally) C.Addons.mergeGeometries
C.buildFireHall30({ width?, depth?, height? });  // -> { group, colliders, triangles, drawCalls, footprint, heights, … }
C.buildAtlasCrane({ height? });
C.buildTheDrum({ radius?, roofHeight?, posts?, panelArcs?, oculusRadius? });
C.buildHeritageFragments();            // MT35 fragments, UNPLACED
C.buildInterpretiveSign();
C.buildBiidaasigeHeritage(scene?, opts?);        // the five together (UNPLACED); returns `place` for the verified two

C.BIIDAASIGE_HERITAGE_FACTORIES.fireHall30Placement();  // { x, z, ring, yaw, widthM, depthM, sourceRef, … } | null
C.BIIDAASIGE_HERITAGE_FACTORIES.atlasCranePlacement();  // { x, z, sourceRef, … } | null
C.BIIDAASIGE_HERITAGE_FACTORIES.drumPlacement();        // always null (no published point)
C.BIIDAASIGE_HERITAGE_FACTORIES.projectionAvailable();

// the native-row seam for the captain's integration (does NOT edit js/buildings.js)
C.heritageFireHallReplaced(result?);                                  // true only after a real replacement exists
C.heritageFireHallExclusionAt(x, z, margin?, result?);               // inside the CURRENT OSM ring only
C.heritageFireHallReplacesNative(x, z, h, angle, parts, result?);    // TRUE for the ONE documented native row
```

Every builder returns `group` (**not added to any scene** unless passed; ground contact at origin, `+Y` up,
1 unit = 1 m), its own `colliders` (tagged), `surfaces: []`, `climbable: **false**`, `triangles`, `drawCalls` (one per
merged material — bounded-ish frustum culling via `cullDistance`/`cullCell`), `footprint`, `heights` (each label with
its source), `source`, `photos` (credited), `attribution`. Geometry is merged by material; no external image, network
or texture is read.

## The native Fire Hall identity seam

`heritageFireHallReplacesNative(x, z, heightM, angle, parts, result)` is intentionally narrow and **fails closed**:
`true` only when (a) a replacement result was built successfully, (b) the native row is a single-part low mass near
`(2383.9, 622.4)`, (c) its long/short footprint matches (`~21.6 × ~13.2 m ± 2.5`), (d) its orientation matches
(`±0.35 rad`), and (e) it sits the documented `24 m ± 14` south of the current OSM anchor. A tower at the spot, a
multi-part block, a small shed, or any of the other **eight native park buildings** returns `false` — this is the
**only** excluded row, not a blanket "all park buildings are obsolete" rule. Nothing is deleted; the captain decides
where to apply it. Before a real replacement exists, all three predicates return `false`.

## Metrics (this build, CPU; `node --test`)

| Structure | Triangles | Material draws |
|---|---|---|
| Fire Hall 30 | ~728 | 8 |
| Atlas Crane (gantry) | ~6,452 | 5 |
| The Drum | ~3,976 | 6 |
| MT35 fragments | ~188 | 4 |
| Interpretive sign | ~48 | 2 |

## What the tests prove (from real geometry, not constants)

`tests/biidaasige-heritage.test.mjs` (7 tests) builds each model in a Node VM and checks: the Fire Hall base on
`y=0`, built to the OSM `~21.5 × 13.5 m` footprint, roof above two storeys, a real red-brick + cream-stone palette,
framed glazing and the adapted entry, and the credited ERA/OSM sources; the current OSM ring matching the native
row **edge-for-edge** with the documented **south 24 m** displacement; the crane's actual **gantry form** (four lattice columns in two leaning pairs, top beams + hoist track, one long boom
to the ground, pair of black cables) with **no cab / counterweight / hook / turret / stairs / platform** and no lifting-
capacity claim (`300-ton` is the structure mass label); the Drum's **open oculus** (a downward ray at the centre hits no roof, but a mid-radius
ray hits the annulus), ~201 m² footprint, all five palette buckets, and **no texture anywhere**; the fail-closed
placement (no frame → all null; with a frame the Fire Hall and Atlas place from the verified OSM helpers, the Drum
never does, the fragments/sign stay unplaced); and the identity predicate accepting only the one documented native
row while rejecting each other building, a tower height, a multi-part block and a small shed.

## Limits & asks for the Captain

- **Fire Hall visual check** is still owed: the geometry follows the source text + photo read, but a Mini GPU capture
  against `captain/firehall-era-front.jpg` / `…-back.jpg` would confirm the triad proportions and roof pitch.
- **Atlas and Drum visual checks** likewise (no laptop render here). The Drum's exact oculus ratio and eave height and
  the crane's jib length are explicit photo-estimates.
- **Drum placement** waits on a registered map-label / ortho anchor; **MT35 fragments** and the **interpretive signage**
  wait on a source-verified site. This module deliberately does not guess them.
