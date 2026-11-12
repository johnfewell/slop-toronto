# Waterfront public realm: the Spadina, Rees and Simcoe WaveDecks

`js/waterfront-public-realm.js` adds the central waterfront's three timber WaveDecks as source-backed public realm
geometry. It is a self-contained module: the captain loads it and calls
`window.CITY.createWaterfrontPublicRealm(THREE, scene)` after the city is built. This pass owns only the module, its
tests and this document. It does not edit `main.js`, `explore.html`, `city-config.js`, the geodata, dependencies or
other agents' files.

## What is built

Three decks under one culling root (`WaterfrontPublicRealm`), 13 meshes (instanced repeated parts, plus continuous
ribbon meshes for the fascia, the accessible-corridor ramps and the sealed underside):

| Deck | OSM footprint | Official area | OSM outline | Walking surface | Notes |
| --- | --- | ---: | ---: | --- | --- |
| Spadina WaveDeck | `way/683024654` | 630 m² | 613.8 m² | 0.22 m arrival band, two swells to 1.02 m; east ramp to 0.04 m | 4 m accessible corridor |
| Rees WaveDeck | `way/407154122` (centre line; depth estimated) | 480 m² | 457 m² | 0.22 m arrival band; a landing that steps **below** the promenade to −0.28 m | the "dip toward the water" |
| Simcoe WaveDeck | `way/798912556` | 650 m² | 621.5 m² | two swells, top 1.90 m; 2.60 m above the lake | 7 m accessible corridor |

Builder totals: about 5,900 flat timber boards (the terraces, outside the corridors), a continuous fascia ribbon, two
smooth accessible-corridor ramp ribbons, a sealed soffit under every footprint, 1,494 rail segments, 73 rail posts, 90
low toe-rail pieces, 27 stainless-steel accessible-route discs, 201 tactile edge dots, 54 timber bearers, 15 steel
piles, the stainless step nosings at Simcoe/Rees, the backless benches, 13 meshes, about 125,000 triangles, 15 returned
pile colliders.

### The three fixed visual faults of the first pass

The first GPU pass showed three faults, now corrected:

- **The accessible ramp was invisible (a black void with beams and floating discs).** Its two triangles were wound so
  their normal pointed *down*; a downward-facing top is back-face culled. The ramp is now wound to face up (every ramp
  triangle normal has a clear +Y), and each quad corner is evaluated at its **own** `(x, z)` — the walking height
  depends on `z`, so a shared per-quad midpoint misplaced the ramp under the query.
- **Gray pavement showed under the decks (and Rees could not dip below the promenade).** The city's street level,
  sidewalks and plots ran right up under the footprints; the old clamp forced every board to stay 4 cm above that
  pavement. The caller now removes the ground under each footprint through `applyWaterfrontDeckGroundMask`
  (see Integration), so the deck can step below Queens Quay.
- **A black void appeared once the ground was removed.** Beneath the street level there is no terrain plane, so the
  masked hole showed black. The deck is now a sealed suspended structure: its fascia skirt drops to a **soffit** just
  above the lake, closing the underside in dark timber.

### Surface, ramps and ramps-vs-boards

The surface is a terraced timber deck whose landward edge is level with the Queens Quay promenade (0.22 m). It rises
inland/southward into the wave. Boards run north–south across the deck and are deep enough that their own sides close
each terrace riser; every board's top is exactly `waterfrontDeckSurfaceHeight(deck, x, z)`, the value the captain's
walking hooks use.

The **east barrier-free corridor is a smooth ramp**, not stairs (accessible routes are ramps): its walking top follows
the continuous profile and it is drawn as a fine ramp ribbon instead of stepped boards, so a wheelchair route never
meets a riser and the mesh matches the query at every vertex. The ramp/terrace boundary is snapped to a board-column
edge, so no flat board straddles the two surfaces.

Simcoe has **two large swells**; its crest is **2.6 m above the lake** (`CITY_BOUNDS.waterLevel = -0.7 m`), so the
highest walking surface is **1.90 m**. Rees is the deck that steps **down** to the water: its water-side route drops to
a landing at **−0.28 m**, below the promenade.

### The surface and the two Simcoe swells

The surface is a terraced timber deck whose landward edge is level with the Queens Quay promenade (0.22 m). It rises
inland/southward into the wave; the east barrier-free corridor stays a low, finely stepped route toward the water.
Boards run north–south across the deck and are deep enough that their own sides close each terrace riser. The top of
every board is exactly `waterfrontDeckSurfaceHeight(deck, x, z)`, which is the value the captain's walking hooks use.

Simcoe has **two large swells** (the official description), not one invented sinusoid. Its crest is **2.6 m above the
lake** (`CITY_BOUNDS.waterLevel = -0.7 m`), so the highest walking surface is **1.90 m** in the app frame. The profile
is based on `sin²(2πu)` with a saddle at the middle; the exact crest positions, saddle width and terrace count are
estimates from the plan outline and the official photographs, not surveyed points.

### Access, steps and safety details

- **Landward access:** the first 2.4–2.7 m of every deck is a level arrival band at sidewalk height, so the promenade
  never meets a 2 m wall. The high swells start inland of that band.
- **Barrier-free route:** Simcoe and Rees have a 7 m east-side barrier-free corridor (Spadina 4 m), a **smooth ramp**
  from the promenade down toward the water, marked by a **stainless-steel disc pathway**. Rees's ramp lands below the
  promenade (the "dip toward the lake").
- **Rails:** full stainless rails follow the actual water edge and the end edges, but they leave the east opening
  clear; a low toe rail marks that edge instead, so the accessible route is not trapped. No rail crosses the level
  landward band.
- **Tactile dots:** raised dots mark the deck edge outside the openings.
- **Step nosing:** Simcoe and Rees steps carry a stainless-steel nosing with a white edge strip at the top of each step.
- **Backless benches:** a 57 m bench at Spadina and a 30 m bench at Simcoe, from the official page, sit on the
  promenade beside their decks (Rees has none specified).
- **Substructure:** timber bearers every ~3.2 m over concrete/steel piles, with a **sealed soffit** just above the lake
  closing the underside; the surroundings stay open, following the source's habitat and suspended-deck description. Each
  bearer rides **below the minimum walking surface over its whole footprint** (not the mid-deck height), clamped just
  above the soffit, so no bearer pokes up through the deck — including the low entry and the accessible ramp, where the
  surface is much lower than at mid-deck. The rendered bearer top is never above the deck surface under any part of it.
- **Continuous fascia:** a single smooth timber ribbon (not a stepped row of per-column boxes) follows the whole
  perimeter, its top at the true surface and its bottom at the soffit.

## Verified locations and footprints

World coordinates are metres in the app frame: x = grid east, z = grid south, street level y = 0, sidewalk top
0.22 m, Lake Ontario -0.7 m (`js/city-config.js`, `CITY_BOUNDS`). Lat/lon were converted with
`CITY.worldFromLatLon` (the same projection as `js/city-config.js`).

| Deck | Published point | World centre | Plan source |
| --- | --- | --- | --- |
| Spadina | 43.63753, -79.39164 | x -1099.7, z 573.8 | real OSM area, 613.8 m² |
| Rees | 43.63849, -79.38732 | x -735.6, z 572.0 | OSM centre line, 9.4 m depth estimated |
| Simcoe | 43.63898, -79.38462 | x -511.3, z 582.8 | real OSM area, 621.5 m² |

The official areas (630/650/480 m²) supersede the Wikipedia figures where they disagree. The OSM outlines are 2–5%
smaller (mapped outline vs maintained deck); the tests require the OSM area to be above 92% of the official area and
never above it.

The tests also re-derive the shore relationship from the real city data: at every deck cross-section the north edge
is dry land and the water is within 2 m of the south edge (95%+ of samples). That keeps the decks on the mapped
shoreline rather than floating in the lake or sitting inland.

## Sources (recorded 2026-11-09)

- Waterfront Toronto, **Wavedecks**: <https://www.waterfrontoronto.ca/our-projects/wavedecks> — the three decks at the
  heads of the Spadina, Rees and Simcoe slips; West 8 + DTAH; 630/650/480 m²; Spadina first in 2008; Simcoe's two
  large swells rising 2.6 m above the lake and slender stainless railings following the wave; Rees dipping toward the
  water; accessible from all sides; the stainless-steel disc pathway; large barrier-free zones at the east sides of
  Simcoe and Rees with a route toward the water; tactile dots at the deck edge; textured stainless step nosing and a
  white step edge at Simcoe and Rees; Spadina's 57 m and Simcoe's 30 m backless benches; 1,780 m² of new fish habitat.
- Waterfront BIA, About: <https://www.waterfrontbia.com/about-waterfront-bia> and the City of Toronto 2021 accessible
  Waterfront BIA map <https://www.toronto.ca/wp-content/uploads/2021/10/97b2-edc-Waterfront-BIA-map2021-accessible.pdf>
  — scope (Stadium/Bathurst to Cherry Street, Lake Shore south including the Islands).
- West 8, Toronto Central Waterfront: <https://www.west8.com/projects/toronto-central-waterfront/> — timber structures
  articulating the level change between Queens Quay and Lake Ontario, gateways to the water, suspended decks and the
  habitat beneath.
- Wikipedia, WaveDecks: <https://en.wikipedia.org/wiki/WaveDecks> — dates, Spadina's 3,564 planks, the stepped levels
  with a widthwise stepless route, the 2009 Toronto Urban Design Award. Its older yellow-disc wording is superseded by
  the official stainless-steel disc pathway.
- OpenStreetMap contributors, ODbL: `way/683024654`, `way/407154122`, `way/798912556`, fetched 2026-11-09.
- Dezeen, "A-Zdvent calendar: WaveDecks by West 8":
  <https://www.dezeen.com/2015/12/23/dezeen-a-z-advent-calendar-wavedeck-west-8-toronto-central-waterfront/> —
  background imagery.
- `docs/waterfront-realism.md` (the parallel evidence dossier) for the official dimensions and image references.

## Frame guard (no downtown geometry in another map)

`supportedCityFrame()` requires all three deck footprints to lie inside the active `GEO.frame.detail`, the active city
to have roads and land-cover areas, and the real land/water beside every deck to match the mapped shore (dry at the
north edge, water at the south). If the frame or the mapped coverage does not match, the builder:

- does not add anything to the scene;
- leaves `window.CITY.waterfrontPublicRealmEnabled = false`;
- returns `null` (the captain's optional call handles this).

This is a guard on the loaded frame, not a hardcoded downtown fallback. When it builds, it sets
`waterfrontPublicRealmEnabled = true`; the captain's `city-config.js` deck lookups use the exported
`WATERFRONT_WAVEDECKS`, `waterfrontDeckSpanAt` and `waterfrontDeckSurfaceHeight` only when that flag is true.

## Uncertainties and limits

- **Rees depth.** OSM maps Rees only as a footway centre line. The 9.4 m depth is an estimate chosen to match the two
  measured decks and the shore strip; it is the largest single uncertainty.
- **Profiles and board pitch.** The official facts are the areas, the two swells, the 2.6 m above-lake crest, the
  steps/nosing/discs and the bench lengths. Exact crest positions, saddle width, board pitch and terrace count are not
  published; they are art-directed estimates from the plan outlines and photographs. Spadina's installed 3,564 planks
  are not the model's board count.
- **OSM vs official area.** The mapped outlines are 2–5% smaller than the maintained decks; the module uses the OSM
  outline and records the official area separately.
- **Deck surfaces and collision.** The boards are the walking surface through the captain's deck lookup; the module
  returns colliders for the support piles only. There is no deck-edge barrier collision, so a player can still walk off
  an unrailed edge.
- **Materials.** Timber and steel colours are art-directed approximations; no new textures or dependencies were added.

## Integration

1. Load `js/waterfront-public-realm.js` after `js/city-config.js` (captain-owned `explore.html` already does).
2. **Ground mask (required for the below-promenade decks).** In `js/city-grid.js`, apply the mask to every ground
   material (street level, sidewalks, plots, lawns) after they are created, but **not** the lake/water materials:
   ```js
   if (m !== waterMat && m !== lakeMat) window.CITY.applyWaterfrontDeckGroundMask?.(m);
   ```
   This is a minimal, composable hook: it `and`s a point-in-polygon discards with any existing `maskNode` (the water
   mask, the road-cut mask), is idempotent, and is a no-op in an unsupported frame or on a non-node material. It never
   touches the water, so the lake and its shoreline are preserved. (The working tree already has this at
   `city-grid.js`'s ground `group.traverse`.)
3. Call `window.CITY.createWaterfrontPublicRealm?.(THREE, scene)` after the city/landmarks are built (captain-owned
   `main.js` already does) and push `result.colliders` if the result is non-null. The builder reads
   `window.CITY.waterfrontDeckGroundMasked()` — if the mask was applied it lets the decks step below the promenade; if
   not, it keeps them 4 cm above the pavement (the old safe behaviour), so the render always agrees with the surface
   query.
4. Keep `WaterfrontPublicRealm` in the culling-root list and keep the `city-config.js` deck lookups behind
   `waterfrontPublicRealmEnabled` (both captain-owned, already present in the working tree).
5. No URL flag is needed; the module does not read `location`.

## Verification

- `node --test tests/waterfront-public-realm.test.mjs` → 11 pass, 0 fail (~5 s).
- Covered: official areas/OSM outline tolerances and published coordinates; real-shore placement; Simcoe's two swells
  and 2.60 m above-lake crest; level landward band; the barrier-free ramp that only descends, holds the deck floor and
  ends above the lake; Rees descending below the promenade; board tops exactly matching the walking-surface query; the
  **corridor ramp mesh matching the query at every vertex and across each triangle interior**; **every ramp triangle
  normal pointing up**; **no support bearer protruding above the walking surface anywhere under its footprint**; the
  fascia and soffit geometry; rails left open at the accessible corridor with a low toe rail;
  tactile dots, step nosings, backless benches; shared instanced geometry and culling metadata; the **ground-exclusion
  polygons and the ground-mask hook** (composes with an existing mask, idempotent, no-op for a non-node material and in
  an unsupported frame); the unsupported-frame guard returning `null` with the flag false; recorded sources and
  deterministic placement.
- GPU verification is the captain's `gpu2` Mac mini pass (no laptop GPU). A useful shot list: Simcoe from the west and
  from Queens Quay (both swells, railings, eastern barrier-free ramp), Rees from HTO Park (the low landing), Spadina
  from the Music Garden side, and a low-angle substructure view (soffit, not void). Contended captures prove
  function/visual behaviour, not a performance budget.
- Per the review instruction, the full `npm test` suite was not rerun in this repair pass.

## Changed files in this repair

- `js/waterfront-public-realm.js`
- `tests/waterfront-public-realm.test.mjs`
- `docs/waterfront-public-realm.md`

No other files were edited by this repair.

## Integration review

The walking query samples the same flat board cell as the mesh, including its narrow joints. The lowest timber is
kept 4 cm above the existing mapped pavement to avoid depth fighting. This leaves the low access route level;
accurate below-promenade Rees landings need the underlying pavement remeshed and remain an explicit limitation.
Generic tree placements are excluded only inside supported deck footprints plus 25 cm trunk clearance.
