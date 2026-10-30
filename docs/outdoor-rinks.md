# Mapped outdoor rinks and skate trails

Bead `st-26p.6`. The City's [Outdoor Artificial Ice Rinks](https://open.toronto.ca/dataset/outdoor-artificial-ice-rinks/) inventory supplies 17 local records: names, parent parks, pad/trail type, dimensions in feet, boards and lighting. It does not supply outlines or orientation. The existing discovery cards keep those source facts, and their feet-to-metres conversion, unchanged.

## Geometry source and review

`tools/build-rinks.mjs` joins every inventory record by `ASSET_ID` to the City's public **Outdoor Recreation Area** polygons ([cot_geospatial13 MapServer layer 34](https://gis.toronto.ca/arcgis/rest/services/cot_geospatial13/MapServer/34), fetched 2026-10-28). `tools/data/rink-footprints-20261028.json` keeps the query and the complete source features. The builder fails on unmatched, duplicate, expired, non-polygon or out-of-frame features and on an incomplete snapshot. Polygons keep their source curves and holes, such as the trail islands at Rennie Park and College Park. No rectangle is inferred from a point or from the inventory dimensions.

`tools/data/rink-review-20261028.json` records a manual check of every location against the City's [2025 8 cm aerial imagery](https://gis.toronto.ca/arcgis/rest/services/basemap/cot_ortho_2025_color_8cm/MapServer). It retains the export requests, extents and image hashes. The images remain under `~/.cache/slop-toronto/props/rinks/refs/` and none ships with the game. The review decides three things:

- **Boards.** These follow the aerial evidence. High Park's two source flags disagree with it: the aerial shows boards on the north hockey pad (`43587`, source `No`) and none on the south open pad (`14282`, source `Yes`). The scene follows the aerial. The cards still show the source values, and `CITY.RINKS.audit` lists both disagreements.
- **Gates.** Each boarded pad has a reviewed access side. The scene leaves a representative 2 m opening there. The hinge and hardware positions are not surveyed.
- **Off-season appearance.** Nathan Phillips Square and the TMU Square rink are reflecting pools outside the season (`pond`). Every other record is pavement.

Dufferin Grove keeps the City's 2024 geometry: one long boarded hockey rink (`970547`) and the irregular western pleasure pad and plaza without boards (`970567`). The hockey rink is not split at its slab seam; the City's 2019 redesign presentation and DTAH's 2024 completion report confirm the arrangement.

## Season

The scene is lit on one calendar day, 22 August (`CITY.SCENE_DATE`, `js/lighting.js`). `rinkSeason()` applies the game's rule to that date. **Ice runs from 1 December to 15 March inclusive; every other day is off-season.** This is a game approximation of the usual winter season, not an operational claim. Real openings depend on weather and City schedules. So the default scene shows:

- off-season concrete for the pads (boarded hockey pads keep faded centre-red and blue lines),
- paved surfaces for the skate trails,
- dark reflecting water at Nathan Phillips Square and TMU Square.

`?rinks=ice` or `?rinks=off` previews either state without changing the scene date. The place cards never show an open or closed status. They say what the city draws, mention the dated scene, explain any aerial board override and add a reminder that rinks are seasonal and weather-dependent.

## Rendering, floors and collisions

`js/rinks.js` runs once at start-up, after tennis (`js/main.js`). It never moves a footprint. A record is rejected and reported in `CITY.rinkStats.rejected` in any of these cases:

- a 2 m interior sample or an outline vertex falls on another curb island or road;
- the prepared ground differs by more than 15 cm across the footprint;
- more than 1 m² of the footprint lies under a building, landmark or prop collider between ankle and head height.

What it draws:

- **One surface mesh** holds every pad, trail, pool and painted line. It uses one material with per-vertex roughness: ice and water are smooth, concrete is rough. The surface sits 2.4 cm above the walking floor and above the tennis paving (1.6 cm), so the small Rennie Park overlap with the hand-traced tennis pavement shows the City rink.
- **One board mesh** draws 1.07 m white dasher boards with a dark cap rail. Outlines are simplified to within 5 cm and the reviewed gate is left open. Each board run gets a thin oriented player collider. Boards cast sun shadows on desktop. On the phone tier they follow the kerb rule (`kerbShadows: false`) and do not.
- **Terrain.** The coarse 60 m `TerrainNear` grid is clipped out of each accepted footprint (`js/sports-terrain.js`). Footprints are split into convex pieces first: earcut triangles merged with Hertel–Mehlhorn, with holes preserved. Footprints are bucketed into 64 m cells so the clipper only tests nearby pieces. Where the grid stands above the slab, for example on Withrow Park's bank, a concrete retaining edge closes the cut. `CITY.terrainNearHeightAt` reproduces the grid's drawn triangles for this. Edges higher than a 45 cm step also get a collider.
- **Walking floors.** Every footprint registers its prepared floor as a sports ground provider, as tennis does. The hill is replaced inside the outline. Holes keep the original ground, and interiors and raised decks still take precedence.
- **Trees.** Procedural park and yard trees within 1 m of a footprint are removed. The City street-tree inventory is untouched.
- **Lighting.** In the ice season, rinks whose source lists `Lighting: Yes` glow under floodlight at night. This uses an emissive term on the night ramp the window glow already uses. No light poles are invented, because their positions are not mapped (`st-26p.9`). In the off-season scene, the pads are not lit.

The whole layer adds two draw calls and no per-frame work. Triangle and collider counts are listed under Verification.

## Rebuild and checks

```sh
node tools/build-rinks.mjs
node --test tests/rinks.test.mjs tests/tennis.test.mjs tests/open-data.test.mjs tests/controllers.test.cjs
gpu2 slop-toronto-rinks -- node tools/check-rinks.mjs
```

`tests/rinks.test.mjs` covers:

- reproducing the builder output exactly, with provenance;
- the High Park audit and the unsplit Dufferin hockey rink;
- unit conversion, and no invented trail dimensions;
- the failure modes listed above;
- the season boundaries and the preview override;
- exact area for the convex pieces of all 17 footprints;
- terrain clipping that keeps a trail island and interpolates the original hill heights;
- board runs with the gate opening, including a gate on the ring's start;
- the long axis of a rotated pad;
- placement rejection without relocation;
- the card text.

`tools/check-rinks.mjs` captures the default scene on desktop and on the explicit low tier at 412×915. It then captures the `?rinks=ice` preview, with overviews of Dufferin Grove, High Park, Nathan Phillips Square, Riverdale Park East and Withrow Park, a night view and the High Park card. It asserts:

- the source count;
- the controller floor at an interior point of every placed rink;
- no `TerrainNear` surface above any rink after clipping;
- a real walk into the Trinity Bellwoods boards that stops inside the rink;
- the card's cross-link text.

## Verification (29 October 2026)

- `tests/rinks.test.mjs`: 7/7 pass. The targeted suite (rinks, tennis, open-data, controllers, boot, site-cache, touch-controls, worker-redirect) passes 71/71.
- The full `npm test` run: 241 tests, 228 pass, and 13 fail. Those 13 are the same failures, by name, as clean `origin/main` (234 tests, 221 pass, 13 fail): the navigation, teleport, geodata path, Overpass and smoke-cache baseline (`st-6rk`).
- `npm run build` passes and fingerprints `rinks.js` and `toronto-rinks.js`.
- The Mac mini runs (`tools/check-rinks.mjs`) used desktop 1600×900, explicit `quality=low` at 412×915 mobile, and the `?rinks=ice` preview. All checks passed with no page exceptions. The only error is the static harness's existing `/live/vehicles` 404.
  - **16 of 17 records are drawn.** TMU Square (`43574`) is rejected: about 97 m² of its City outline lies under a game building or landmark collider. It is reported, not moved.
  - **Geometry:** 588 terrain pieces, 4 coarse terrain triangles cut, 1,894 surface triangles and 3,242 board triangles.
  - **Boards and walls:** 9 boarded pads with a 2 m gate each, 347 colliders, and 43 retaining-edge segments, all at Withrow (up to 3.9 m on its bank).
  - **Floors and terrain:** every controller floor is 0.22 m, and 118 raycasts found no terrain above any rink.
  - **Collisions:** the Trinity Bellwoods walk stopped at the boards, 11.7 m out from the centre against a 12.2 m half-width, still inside the rink.
  - **Card:** the High Park card shows the cross-link and the aerial board override.
- The production transcription job was running, so frame rates are **contended-functional** evidence only.
- Captures are in `ride-anywhere-geo/review/gpu2/slop-toronto-rinks/rinks-{desktop,phone,ice}--*.png`. They were compared with the aerial references for Dufferin Grove (one long hockey rink, with the pleasure pad to the west), High Park (boards on the north pad only), Nathan Phillips Square (the pool), Riverdale Park East (rink beside the tennis courts) and Withrow Park (rink cut into the bank).
- The first capture pass made the off-season concrete too bright, so it read as ice. The concrete was darkened and recaptured.
