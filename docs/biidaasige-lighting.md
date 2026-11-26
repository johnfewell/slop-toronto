# Biidaasige: source-located lighting, wayfinding and bollards

Bead `st-bmyv.10` (child of `st-bmyv`). Owner: lighting worker. Module `js/biidaasige-lighting.js`, tests
`tests/biidaasige-lighting.test.mjs`, source record `tools/fixtures/biidaasige-lighting.json`, build check
`tools/build-biidaasige-lighting.mjs`. This module owns the park's **lighting, wayfinding and bollards**; the play
structures, the Fire Hall / Atlas / Drum, the paths, the amenities and the heritage elements are other workers'
modules and are not touched here.

## Status of this pass

This pass implements the **reusable, local-origin factories** and the **layout adapter** whose inputs are verified
source facts and **verified positions**. No positions are invented:

- **Street lamps: 0 mapped inside the park.** The bbox query returns 47 `highway=street_lamp` nodes, but every one is
  **outside** the committed park polygon (the surrounding streets and the Don trail). They are recorded as context and
  are **never repurposed** as park lamps. The distinctive timber luminaire is built as a **factory** and stays
  **unplaced**.
- **Wayfinding: 3 mapped guideposts inside the park.** The bbox query returns 3 `tourism=information` +
  `information=guidepost` nodes, and all 3 are **inside** the committed park polygon. They are the only mapped
  wayfinding points, and the adapter places a generic **blank** guidepost at each.
- **Bollards: 0 mapped inside the park.** The bbox query returns 1 `barrier=bollard` node, and it is **outside** the
  committed park polygon. It is recorded as context and is **never placed**. The bollard is built as a **factory** and
  stays **unplaced**.

The park photos show a **distinctive fixture**: a slim round weathered natural timber post about **5–6 m** high,
diameter about **.12–.16 m**; a short dark charcoal horizontal arm about **.7 m** long near the top with a small flat
downward luminaire; the top of the timber continues about **.3 m** above the arm. It is **not** an ornate highway lamp
or a generic metal streetlight. That fixture is modelled as `buildTimberLuminaire` with a small **emissive** head for
night — **never a point light per pole**.

## Timber luminaire positions: second pass (2026-11-26)

Result: **0 verified positions, so 0 timber luminaires placed.** What was tried:

| Source | Finding |
| --- | --- |
| OSM `highway=street_lamp` | 0 inside the polygon; 47 outside (unchanged). 29 of the 47 sit in two lines north-west of the park and are newer than the City's pole layer; they are road or trail lights, not park lights. |
| City of Toronto, Topographic Mapping - Poles (`js/toronto-poles.js`, 2026-10-29) | 36 poles lie inside the polygon (31 street light, 5 carrying a signal). 22 are 12 m or more from any road, 9 are roadside, 5 carry signals (`node tools/build-biidaasige-timber-poles.mjs`). Drawn on the City's 2025 8 cm orthophoto, the 33 checked by eye stand in the river and its basins (11), on bare ground or planting (8) or on the Cherry Street bridge deck (9, bridge road lights); 3 were not checked. The layer was digitised before the park's built form existed. **None is used.** The record is `tools/fixtures/biidaasige-timber-poles.json`. |
| 2025 orthophoto, pole shadows | The photo was taken with a low sun and every tall post throws a long thin shadow. An automatic line search over the whole polygon returned about 340 candidates along paths. Play-structure masts, the Commissioners Street lights and the timber luminaires cannot be told apart from the shadow alone, and the base end of a shadow is not certain, so none is accepted. A shadow with a base read to 2 m needs a photograph of the pole beside it. |
| Waterfront Toronto / City drawings, John's photos | Not in the repository or the shared data folder; the earlier captain photo folder is no longer on disk. |

What is wired and ready, so a confirmed site only needs adding:

- `TIMBER_SITES` in `js/biidaasige-lighting.js` (empty) takes `{ id, lat, lon, uncertaintyM }`; `opts.extraSites` with `kind: 'timberLuminaire'` does the same. Each is checked against the polygon, projected, placed as an instanced timber pole with its arm turned towards the nearest mapped path, given a pole-sized collider, and added to the **street light pool** (`addLampSites` from `js/street-details.js`): the nearest luminaires around the camera share the pool's 40 spot lights, so no pole carries a light of its own.
- The lens glow follows `uInteriorGlow` like the street lights' lenses, so it is off by day.
- Generic lights on the same paths: the generic layer drew 20 of those City poles (the ones on a sidewalk block) as 9 m lights, including poles that stand in the river on the photograph. `js/mapped-poles.js` now skips the 19 poles the photograph shows are not there (`BIIDAASIGE_STALE_CITY_POLE_IDS`, only while the park is on). The 9 bridge-deck lights and the 3 unchecked poles stay generic.

Checks (2026-11-26): `npm test` 1,692 tests, 0 fail. On the Mac mini (`tools/capture-biidaasige-lighting.sh`): with the park on, 31 City street light poles lie inside the polygon, 20 were drawn as generic lights before and 9 are now (19 skipped as stale, `poleStats.rejected.stale`); frame time before and after is identical (median 16.7 ms, p95 16.7 to 33.3 ms in three alternating pairs, contended mini); late-November frames (`?liveDate=2026-11-26&liveClock=...`, no preset, which is summer) show bare trees at midday, twilight and midnight, and a July frame shows leaves. A preset always renders summer, so season checks must use `liveClock`.

Open: a photograph of a luminaire with a position (or a lamp schedule from Waterfront Toronto), and the placement of the three unchecked City poles.

## Sources (current, official)

| Source | URL | Use | Claims limit |
| --- | --- | --- | --- |
| OpenStreetMap Overpass API | `overpass-api.de/api/interpreter` (fetched 2026-11-10, base timestamp `2026-11-10T23:24:18Z`) | `highway=street_lamp`, `tourism=information`, `barrier=bollard` in the park bbox | ODbL; mapped points only, no official total |
| Committed park polygon | `js/biidaasige-park-data.js` `BIIDAASIGE_PARK.park.polygon` (OSM `way/813717630`) | the exact point-in-polygon test | the polygon is the committed park boundary |
| City of Toronto — Parks and Recreation Facilities | `tools/data/parks-and-recreation-facilities-20261028.json` (row snapshot 2026-10-28) | checked for a lighting asset | the Biidaasige row lists only `Dog Off-Leash Area, Playground, Washroom`; **no lighting asset** |
| Captain photo observations | `$WATERFRONT_RESEARCH/biidaasige/captain/cableway-csla.jpg`, `inverted-timber.png`, `raccoon-overview.png` (captain viewed) | the distinctive timber fixture's proportions | written observations; photo estimates, not surveyed |
| City 2025 orthophoto export | `captain/ortho2025-play-highres.png` + `ortho2025-play-highres-export.json` | a possible future source for pole bases | **not used** in this pass (see below) |

The bbox query is:

```overpassql
[out:json][timeout:45];
(
  node[highway=street_lamp](43.642,-79.359,43.650,-79.341);
  node[information](43.642,-79.359,43.650,-79.341);
  node[barrier=bollard](43.642,-79.359,43.650,-79.341);
  way[barrier=bollard](43.642,-79.359,43.650,-79.341);
);
out geom tags;
```

## What the sources actually map (verbatim substance)

- **47 street lamps** in the bbox, **all outside** the park polygon. They are the surrounding street/trail lighting,
  not park luminaires.
- **3 guideposts** (`tourism=information`, `information=guidepost`) **inside** the park polygon:
  `osm-node-14071202397` (43.6453419, -79.3477229), `osm-node-14071241307` (43.6446681, -79.3486716) and
  `osm-node-14071243053` (43.6438325, -79.350529).
- **1 bollard** in the bbox, **outside** the park polygon.

The City parks asset row for Biidaasige lists no lighting asset, so there is no City lamp point to add.

## Positions: what is real, what is not

Real, machine-readable points used by this module: the **3 mapped guideposts** inside the park polygon, projected
through `window.CITY.worldFromLatLon` at call time. The adapter re-verifies each against the committed park polygon
before placing it.

**Not placed, on purpose:**

- **No lamp.** No mapped lamp lies inside the park. The factory is exported; the source sites stay unplaced. A count
  is **not** invented along a path.
- **No bollard.** No mapped bollard lies inside the park. The factory is exported; the source site stays unplaced.
- **No fabricated park map or artist/cultural text.** The guideposts are **blank** finger boards. The module does not
  invent a park map, a place name or interpretive copy.

### Orthophoto pole bases: a request, not a guess

The captain's 2025 City orthophoto export (`captain/ortho2025-play-highres.png` +
`ortho2025-play-highres-export.json`) could in principle supply pole-base pixels. This pass does **not** interpret
them: the model cannot visually verify pixels, and long shadows or map-label positions are **not** evidence. If the
captain supplies **candidate lamp-base pixels** (with the export extent and a stated error), the parent can register
them as further source points and the `buildTimberLuminaire` factory can be placed at them. Until then the lamps stay
unplaced.

## Geometry contract

- **1 unit = 1 m, Y-up, local origin at the ground contact point** (the post base), front +z. The arm/boards overhang
  +z; the post base is the ground contact.
- **Node materials** (`MeshStandardNodeMaterial` when present, else `MeshStandardMaterial`), rough matte timber, dark
  charcoal metal, and an **emissive** lens for the luminaire head.
- **Bounded draw calls:** each factory is merged per material and instanced once per material per kind. The pole
  factories stay **< 5 meshes/materials** (the luminaire is 4 meshes / 3 materials; the guidepost 3 / 2; the bollard
  2 / 2).
- **Bounded cull cells:** every instanced mesh carries `userData.cullCell = 60` and a finite `cullDistance`.
- **No per-pole lights, no heavy shaders, no unbounded dynamic shadows.** The night glow is an emissive material, not a
  light object.
- **Individual solid pole collider only:** each placed site gets a small **circle** collider at the post base
  (`circle: { x, z, r }`, `r ≤ .12 m`), never a path-blocking box. The path stays clear.
- WGS84 → world **only** through `C.worldFromLatLon` at call time. A missing park polygon, a missing projection or a
  source point outside the polygon builds **nothing** and says why.

## API

```js
const C = window.CITY;                         // needs C.THREE, C.BIIDAASIGE_PARK, C.worldFromLatLon

const out = C.buildBiidaasigeLighting(scene, allColliders, { renderedSites, extraSites });
out.group;        // THREE.Group, added to `scene` only when passed
out.colliders;    // [{ minX, maxX, minZ, maxZ, minY, maxY, circle:{x,z,r}, prop:true, kind, source:'osm', featureId }]
out.sourceSites;  // every verified in-park source site, with id, kind, lat, lon, x, z
out.placedSites;  // the sites actually placed (after dedupe), with id, kind, x, z, y, yaw
out.stats;        // { counts, meshes, materials, colliders, unplaced, skipped, source, projected, cullCell, dedupeRadius, reason? }

C.biidaasigeLightingFactories.buildTimberLuminaire(THREE);   // pure factory, local origin
C.biidaasigeLightingFactories.buildWayfindingGuidepost(THREE);
C.biidaasigeLightingFactories.buildBollard(THREE);
C.biidaasigeLightingDedupe({ sourceSites, renderedSites, radius }); // { kept, skipped }
```

### Registering further image points later

`opts.extraSites` is an array of `{ id, kind, lat, lon, ... }` the parent can pass to register further
image-interpreted points (for example, captain-supplied lamp-base pixels) **without editing this module**. Each extra
site is re-verified against the committed park polygon and projected exactly like an embedded site; an outside point
is refused and reported in `stats.skipped`. This is the hook for the orthophoto request above.

### Dedupe contract

`opts.renderedSites` is an array of `{ x, z, kind }` already rendered by another layer. A source site is placed only
when **no already-rendered same-kind site** lies within `C.BIIDAASIGE_LIGHTING_DEDUPE_RADIUS` (1.5 m) of it. A
different kind, or a site farther than 1.5 m, does not dedupe. `out.sourceSites` exposes every source site with its ID
so the parent can register further image points later.

## Fixture and build check

`tools/fixtures/biidaasige-lighting.json` is the checked-in source record: the raw Overpass elements, the query, the
bbox, the OSM base timestamp, the ODbL licence and attribution, the derived `sourceSites`, `unplaced`, `context` and
`classification`, and the orthophoto export extent. The module embeds the verified sites so the browser never reads
`tools/`.

```sh
node tools/build-biidaasige-lighting.mjs          # rewrite the fixture's derived fields
node tools/build-biidaasige-lighting.mjs --check  # exit 1 if the committed fixture is stale
```

The build check re-runs the ray-cast point-in-polygon test against the committed park polygon; it does not fetch the
network, render, or invent a lamp/bollard.

## Attribution

Data © OpenStreetMap contributors, ODbL 1.0 — <https://www.openstreetmap.org/copyright>. City of Toronto orthophoto
and parks asset data © City of Toronto. Photo observations from the captain's written review.
