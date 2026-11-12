# Biidaasige Park — source inventory, verified positions and phase coverage

Bead `st-bmyv.1` (child of `st-bmyv`). Owner: inventory worker. Files owned here:

- `js/biidaasige-park-data.js` — the generated browser data (`window.CITY.BIIDAASIGE_PARK` + `C.biidaasigePark*`)
- `tools/build-biidaasige-park-data.mjs` — the generator (reads checked-in fixtures)
- `tools/fixtures/biidaasige/*.json` — the checked-in OSM + official-source fixtures
- `tests/biidaasige-park-data.test.mjs` — the honesty tests
- `docs/biidaasige-park.md` — this file

The source inventory is independent of the runtime integration described below. Source records and model placements have separate confidence labels.

## Corrections after the second source review

1. **Outdoor fitness is LISTED, not "not-listed".** The current City Recreation page (modified 2026-09-09,
   saved at `captain/recreation-current.html`) says *"Outdoor Fitness Equipment — Fitness equipment is available
   west of Cableway Canyon."* It is in the catalog as `official-listed-unplaced` (no published point, so
   `lat/lon` are `null`). A worker's negative claim was not authority. It is no longer omitted.
2. **Owl identity RESOLVED by a named OSM structure.** The current Overpass extract (`captain/equipment.json`,
   query `equipment.ql`) maps `way/1418541992` — `area=yes`, `name="Snowy Owl Theatre"`, `playground=structure`,
   18 vertices — and **every one of its vertices lies inside the unnamed west play area `way/1418127159`**. That
   proves the Owl is in the western playground, west of Old Fire Hall 30. The earlier disagreement between the
   area centroid and the approximate manufacturer pin was unnecessary. The **theatre AREA** is now an exact placed
   polygon (`snowy-owl-theatre`, `osm-way`). Its centroid is **not** a body-base origin: the polygon covers stage and
   nest. The body-base point still comes from the Captain's orthophoto interpretation (outside these files). The
   Monstrum pin (`document-only`) stays as a historical claim and is still approximate/wrong as a body origin. The
   generic west play area keeps its record and was **never moved**. `sourceConflicts` now records
   `status: "resolved-by-named-osm-structure"`, preserving the historical claims.
3. **Map orientation distinguished.** The **2026 City map is NORTH-UP** (correct, current); the **August 2025 PDF is
   SOUTH-UP**. Docs and sources point at the correct 2026 PDF URL:
   `https://www.toronto.ca/wp-content/uploads/2026/09/978c-Biidaasige-Park-map.pdf`.
4. **Portable generator, one writer.** The early untracked `tools/build-biidaasige-inventory.mjs` and its
   `js/biidaasige-park-inventory.json` (which could contain hypothetical coordinates) were removed. Only
   `tools/build-biidaasige-park-data.mjs` writes `js/biidaasige-park-data.js`, from checked-in fixtures under
   `tools/fixtures/biidaasige/` (no temporary or private cache path). The builder rejects an unclosed polygon, an unplaced
   feature that carries a coordinate, a feature outside the park bounding box, duplicate ids and bad phases.

## Position policy and vocabulary

| Field | Meaning |
| --- | --- |
| `placement` | `osm-node` / `osm-way` / `osm-line` / `osm-area` for built features; `unverified` for the catalog |
| `spatialStatus` | `in-park` (inside the OSM park polygon), `adjacent` (Canoe Cove water), `context` (excluded by default) |
| `positionConfidence` | `high` (point / simple footprint), `medium` (area centroid), `none` (unverified) |
| `orientationDeg` | OSM footprint **long-axis** bearing `[0,180)`; `orientationSource: "osm-footprint-long-axis"` (polygons) or `"osm-line-endpoints"` (cableways), `orientationConfidence: "estimated"`. Never a surveyed facing. Points carry `null`. |
| `mapLineLengthM` | Endpoint-to-endpoint length of a two-endpoint cableway line. Kept **separate** from the City's published 20 m / 40 m; it is a map measurement, not a survey. |
| `phase` | `2025` (eastern, July 2025), `2026` (western, July 2026), `future` (2027+, never current) |

Built points are the real OSM nodes/ways; every one is verified **inside the park polygon** (the test does the
point-in-polygon check, not just the bounding box). Raw rings are carried verbatim and projected at runtime.

## What is verified (137 in-park + 2 context)

- **Play:** generic west playground AREA (`way/1418127159`, generic area only), **named Snowy Owl Theatre
  (`way/1418541992`, exact 18-vertex area, inside the generic area)**, Reaching Raccoon (`way/1418796674`),
  Badlands Scramble (`way/1418541993`), two **cableway** lines (`way/1552431730` short, `way/1552431733` long, both
  `playground=zipwire`), one **swing** node (`node/14124048374`, `playground=swing`, partial), two **sandpits**
  (`way/1552431731`, `way/1552431732`), and one **unnamed structure** node (`node/14124048373`, identity unresolved).
- **Dogs:** east 1,200 m² (`way/1418542004`), west 800 m² (`way/1419966624`).
- **Buildings / identity:** Old Fire Hall 30 (`way/494886782`), Atlas Crane (`node/9521067431`).
- **2026 west:** Event Lawn (`way/1545116131`), West Habitat Cove (`way/1013210804`), Water's Edge Promenade
  (`way/1013210805`), Canoe Cove (`node/10893913022`, adjacent water).
- **Paths / bridges:** Main Path (`way/1352429162`), Don Greenway Trail Loop (`way/1414354033`), Commissioners
  Street Bridge (`way/1211500112`), Cherry Street South Bridge (`way/1157772737`); bascule bridge is `context`.
- **Artwork:** 19 Lassonde Art Trail works mapped by OSM inside the park (phase inferred from east/west, flagged).
- **Furniture (OSM, subset):** 9 drinking-water points, 7 barbecues, 18 picnic tables, 4 washrooms, 38 benches,
  18 waste bins, 1 fire pit, 1 bike-share station.

## What is deliberately NOT placed (23 catalog, `lat=null`)

The mock beaver dam (two mapped sandpits are nearby but not proven to be it), the 7 Dodem animals, **Outdoor
Fitness Equipment** (listed west of Cableway Canyon, no point), River Bend Landing, East/West Landings, the picnic
terraces, The Drum, the promontory, the MT35 heritage elements, the Canoe Cove paddling course, the Fire Holder, the
Sturgeon Stones, the marker trees, interpretive signage, Indigenous plantings, the five other named trails, the
**Snowy Owl maker pin** (document-only, approximate, not a body origin), and the future acres / 2027 art. The named
Owl **structure area** and the cableway lines and swing node are now placed; the cableway/swing coverage is marked
**partial**. `coverage` (38 entries) lists every requested category.

Notes on the new records: the cableways carry measured map-line lengths (short ≈ 22.9 m vs published 20 m, long
≈ 36.1 m vs published 40 m) as estimates, not surveys. The swing node is a *partial* source — the orthophoto shows
two swing pads/frames, so one mapped node does not prove one total seat. The unnamed `node/14124048373` is an
identity-unresolved structure inside Badlands; it is **not** a Dodem animal and **not** a beaver dam. The two
sandpits preserve generic identities and are not assigned to the mock beaver dam without proof.

The Captain can register missing map labels later; this pass does not hold the verified subset back.

## Runtime API (`window.CITY`)

Helpers project through `C.worldFromLatLon` at call time (works in the detail and `?map=eglinton` frames) and
return `null` when the frame is absent — never a fabricated point.

```js
C.biidaasigeParkFeatures()                          // verified in-park only; unverified/context excluded
C.biidaasigeParkFeatures({ includeUnverified: true, includeContext: true })
C.biidaasigeParkFeature('reaching-raccoon')         // any tier, identity preserved
C.biidaasigeParkWorld('atlas-crane')                // { id, lat, lon, x, z, placement } | null
C.biidaasigeParkRingWorld('snowy-owl-theatre')       // [{ x, z }, …] | null (exact theatre area)
C.biidaasigeParkPose('reaching-raccoon')            // world + orientation/placement metadata
C.biidaasigeParkMakerPin('snowy-owl-maker-pin')     // the documented maker pin (document-only) | null
C.biidaasigeParkProjectionAvailable()
C.biidaasigeParkDiagnostics()
C.biidaasigeParkSourceConflicts()
```

**Default = verified only.** Unverified features never appear unless `{ includeUnverified: true }`.
The Owl maker pin is document-only: `C.biidaasigeParkWorld('snowy-owl-maker-pin')` is `null`; with
`{ includeUnverified: true }` it returns the approximate point labelled `placement: "maker-pin"`. It is **not** used to place the Owl model; the orthophoto-derived body origin is used instead.

## Models

`js/biidaasige-play-landmarks.js` builds the Snowy Owl (`buildOwlPlayTheatre`) and Reaching Raccoon
(`buildReachingRaccoon`). The Raccoon has a verified OSM polygon anchor. The Owl now has a verified OSM **theatre
AREA** (`way/1418541992`), but that polygon covers stage and nest, so the model must still be placed/oriented to the
Captain's orthophoto body-base point rather than the polygon centroid. The maker pin is not used for the body origin.
Model dimensions remain explicit photo estimates (`dimensionsStatus: "photo-estimate-not-survey"`).

## Regenerate / verify

```bash
node tools/build-biidaasige-park-data.mjs          # write js/biidaasige-park-data.js
node tools/build-biidaasige-park-data.mjs --check   # exit 1 if stale
node --test tests/biidaasige-park-data.test.mjs     # 12/12
```

## Inventory limitations and later integration

- The Owl body origin is now interpreted from the City 2025 orthophoto, with a conservative 3 m uncertainty; see `tools/fixtures/biidaasige-play-ortho-anchors.json`. The theatre centroid and manufacturer pin are not used as body origins.
- The remaining **partial** items: the Swing Hill full install (only one node mapped; two pads on the ortho), and the
  second cableway lengths should be reconciled with the published 20 m / 40 m before any surveyed-length claim.
- The unplaced official features above (mock beaver dam, Drum, terraces, landings, fitness, marker trees …) need a
  registered map-label/ortho anchor before placement.
- The separate path-network generator now clips the broader OSM foot/cycle network to the park and excludes private, construction, bridge and stair segments from flat ground rendering. See `docs/biidaasige-path-network.md` and the generated `js/biidaasige-path-network-data.js`.

## Sources (current, official)

| Source | URL |
| --- | --- |
| City — Biidaasige Park | https://www.toronto.ca/explore-enjoy/parks-recreation/places-spaces/beaches-gardens-attractions/biidaasige-park/ |
| City — Recreation at Biidaasige Park (2026-09-09) | …/biidaasige-park/recreation-at-biidaasige-park/ |
| City — Food & Drink at Biidaasige Park | …/biidaasige-park/food-drink-at-biidaasige-park/ |
| City — 2026 map PDF (NORTH-UP) | https://www.toronto.ca/wp-content/uploads/2026/09/978c-Biidaasige-Park-map.pdf |
| Waterfront Toronto — 2026 western expansion news | https://www.waterfrontoronto.ca/news/torontos-largest-park-in-a-generation-just-got-bigger |
| August 2025 map PDF (SOUTH-UP) | https://www.waterfrontoronto.ca/sites/default/files/2025-08/Biidaasige_Park_Map_August_7%2C_2025_FINAL-ua.pdf |
| Monstrum maker page | https://monstrum.dk/en/playground/snowy-owl-play-theatre |
| Monstrum public MyMaps KML | https://www.google.com/maps/d/kml?mid=1gfp9OLYyXoItVLbHmM0_YExttfDXkvD4&forcekml=1 |
| OpenStreetMap (Overpass, 2026-11-10, ODbL) | https://www.openstreetmap.org/copyright |
| OpenStreetMap playground=* equipment extract (Overpass, base 2026-11-10T23:10:06Z, ODbL) — `tools/fixtures/biidaasige/osm-equipment.json` | https://www.openstreetmap.org/copyright |
| Lassonde Art Trail | https://lassondearttrail.org/ |

No map scan or maker photo is embedded; only source facts, coordinates and attribution. Data © OpenStreetMap
contributors (ODbL); City of Toronto; Waterfront Toronto.

## Live runtime integration (2026-11-10)

Open `http://localhost:5530/explore.html?map=detail#park=biidaasige&mode=walk`, or choose **Sights → Biidaasige Park**. The same route accepts `mode=cycle`. `?biidaasige=0` disables the park layer for comparison.

`js/biidaasige-park.js` owns assembly. It places the two signature play structures, two cableways, two swing frames, six inverted White Oak timber units, Badlands, play-pad footprints, Fire Hall 30, Atlas Crane, The Drum and the source-clipped ground paths. The amenity adapter places source-mapped benches, tables, barbecues, bins, fountains and two dog-area turf footprints. Three source-mapped guideposts are added after deduplication against existing rendered wayfinding. Two source-footprinted beaches, one source-line slipway and one source-line pier are now assembled; line widths and finish materials are explicit estimates, and banks remain at the current datum pending terrain work. Six fishing nodes and the unverified east launch remain candidate-only. The current park furniture and unique structures are procedural meshes; some generic furniture proportions follow existing repository props. Replacing suitable generic props with licensed downloaded low-poly assets remains part of the broader realism work. These are approximate visual models, not surveyed replicas.

The Owl, cableways, swing frames and inverted timber cluster use City 2025 8 cm orthophoto interpretation. The timber cluster centre has 4 m uncertainty; individual unit heights and compact staggered layout are photo estimates. Fire Hall uses its current OSM footprint. The Drum uses a registered 2026 map estimate (15–25 m uncertainty), rather than being presented as an exact OSM point. Its inventory record deliberately remains unplaced because the source tiers are independent. The 20 m / 40 m cableway lengths follow the official description; source line lengths remain separately recorded. Swing seat arrangement is a photo estimate.

Rendered walkable triangles are indexed in 4 m cells and queried through `C.biidaasigeParkSurfaceAt` from `waterfrontDeckAt`. Solid props publish finite vertical colliders; open interiors and dog-area turf are not blocked by whole-area boxes. Nine obsolete native massing rows are replaced or removed only after individual orthophoto identity checks (`tools/fixtures/biidaasige-native-identities.json`). Procedural trees are cleared over rendered paths and model bounds, while the City street-tree inventory is retained except one exact stale tree inside the source-verified dog turf. Park assembly, amenities and guideposts each register their culling root.

This does **not** complete all requested coverage. The surrounding park remains at the environment's ground datum, so the actual promontory, stairs and multi-level river banks require a terrain pass. Dog gates/fencing, fitness equipment, mock beaver dam, several Indigenous placekeeping/heritage features and accurate landing geometry remain under source review. Local factories without verified placements stay out of the world. Current work is tracked under `st-bmyv`; the epic stays open.

Verification: all 133 park tests passed together after runtime integration, including both shipped geographic frames, physical triangle/raycast checks and source-generation checks. Eight matched desktop and portrait-phone views plus actual unmodified arrival views have been captured. The arrival was moved back after the phone review showed the Owl eyes underneath the interface. GPU reviews run on the Mac mini through `gpu2`; screenshots establish visual behavior, not uncontended performance budgets. Captures are under `$GPU2_REVIEW_DIR/slop-toronto-biidaasige/`.

## Accepted runtime review evidence

Build `f2538a274eb1` passed the final six affected desktop and portrait-phone views (`accepted-additions-desktop-*` / `accepted-additions-phone-*`), including actual unmodified arrival, inverted timber trees, guidepost, both beaches and pier. The earlier eight core views are `park-final-desktop-*` / `park-final-phone-*`; matched baseline captures are `before-*` / `before-phone-*`. All captures use the Mac mini through `gpu2`. The captain personally inspected the captures. The accepted beach finish is an approximate flat overlay; real bank relief is still open.

Full validation: `npm test` reported **1,305 total / 1,302 passed / 0 failed / 3 existing skips** in 85.7 s. All five park generators reported current output. The subsequent pebble-grain material uses the existing shoreline noise and was shader-compiled and captured in the final GPU pass. Capture consoles retain the baseline `live/vehicles` 404 and the baseline audio-synthesis-worker warning; no park boot/shader error was observed. These contended captures are not performance-budget measurements.

Open work remains in `st-bmyv`: terrain profiles and stairs (`st-bmyv.11`), fitness and dog enclosures, mock dam, remaining Indigenous placekeeping/heritage, unplaced lighting and further surface realism. Source inventory, native compatibility audit, Owl/Raccoon models and timber infrastructure have individually passed their bounded acceptance criteria. The epic is not complete.

### Dog-area source correction

Build `b3980a23a616` replaces whole-area dog turf with the current City turf asset polygons (989013 East / 989014 West), independently checked against the 2025 aerial image. The surrounding OSM footprint is asphalt. A source-specific ground mask removes the generic native white walkway across the turf, and one individually reviewed stale tree is omitted. Matched overhead desktop and portrait captures are `dog-clearance-desktop-dog-west-overhead.png` and `dog-clearance-phone-dog-west-overhead.png`. Full validation after this correction: **1,318 total / 1,315 passed / 0 failed / 3 existing skips**. Detailed evidence: [dog surfaces](biidaasige-dog-surfaces.md).

### Inverted-oak woodchip island

The 270.1 m² woodchip island now follows the visible curb traced from the City2025 aerial image, with 3 m placement uncertainty. The pale curb and finish have matching walking triangles; no source path or City street-tree point overlaps the footprint. Accepted build `d9601d3939ba`, desktop and portrait captures: `woodchip-fixed-desktop-*` and `woodchip-final-phone-*`. Full suite: **1,324 passed / 0 failed / 3 existing skips**. See [source and acceptance](biidaasige-woodchip-island.md). The new MVVA finished-site photograph supplies further Dodem appearance and placement evidence; registration and individual placements remain a separate review.

### Seven Dodem animals: accepted placed models

All seven Dodem animals are now in the live park on their two source-traced woodchip islands, using reviewed photo-derived positions with 3–4 m uncertainty. The source arrangement was recovered from an actual finished MVVA playground photograph and checked against the City2025 aerial. They are original low-poly approximations with artist credit, not the maker’s production models or surveyed replicas. The two islands have matched walking surfaces and finite solid-prop colliders. Only source-footprint intrusions from a coarse path ribbon are masked, with matching physical-height handling.

Accepted build `967e81d62e19`: six desktop and six portrait captures, `dodem-seven-desktop-*` / `dodem-seven-phone-*`. Full suite: **1,333 passed / 0 failed / 3 existing skips**. See [source, modelling and acceptance](biidaasige-dodem.md). The park epic remains open for terrain, fences, fitness, mock dam, remaining cultural/heritage infrastructure and other source gaps.
