# Sidewalk polygons

Bead `st-26p.8`. The walkways on the curb islands now follow the City of Toronto's mapped sidewalks instead of a fixed
4.6 m band in from every curb. The 4.6 m band remains the fallback for islands the City's layer doesn't cover.

## Source

[Topographic Mapping – Physical area of sidewalks](https://open.toronto.ca/dataset/topographic-mapping-physical-area-of-sidewalks/),
City of Toronto Open Data, Open Government Licence – Toronto (stated on the dataset page; the CKAN record's licence field
is empty). Resource `Sidewalks - 4326.gpkg`, refreshed 2026-02-20, fetched 2026-10-29. `js/toronto-sidewalks.js` records
the resource ID, refresh date, fetch time and a SHA-256 prefix of the download.

Schema, as downloaded: one layer, 14,116 multipolygons citywide, one subtype (`3001 Sidewalk`), `ELEVATION`,
`LAST_GEOMETRY_MAINT`, `LAST_ATTRIBUTE_MAINT`, `OBJECTID`. In the detailed city there are 1,562 polygons (about
1.98 km² of sidewalk, 1,847 holes, 629k vertices); their geometry was last maintained in 2021 (1,548), 2022 (2) or
2023 (12). `ELEVATION` is `0` everywhere (one null). It is not a surveyed height, and the build ignores it.

The City describes the layer as digitized from aerial photography, +/- 30 cm, with features near tall buildings or in
deep shadow possibly missing. The separate Sidewalk Inventory dataset is an older presence layer and is not used.

## Fit with the city

Measured against the shipped curb islands (`GEO.blocks`, which already follow the City's Edge of Roadway):

- 92.4% of the sidewalk area lies on curb islands, 0.3% on medians, 7.3% on what the build treats as roadway. Of that
  7.3%, 82% is within 1 m of an island (the islands are traced from a 1 m raster) and 93% within 2 m; only about 0.5% of
  all sidewalk area lies more than 4 m from any island.
- Checked against the City's 2025 8 cm orthophoto at King & Spadina, King & Bay (deep tower shadow: still mapped),
  Harbord & Bathurst, Queens Quay at Rees and a residential side street: the polygons and the shipped curbs agree to well
  under a metre. Downtown the polygons run curb to building face; on residential streets they are the 1.5–2 m walk with
  a grass boulevard between it and the curb, which the old band painted as concrete.
- Gaps: 182 of 2,568 eligible islands have no City sidewalk at all. Most are parks, the Port Lands, the Islands and rail
  land, but some are newer development the 2021 mapping predates, e.g. the blocks on Fort York Boulevard west of
  Bathurst. Those islands keep the fixed band. Within a covered island, a side the City didn't map shows the yard
  surface up to the curb: realistic where a street has a sidewalk on one side only, wrong where the mapping missed one.

## Pipeline

1. `node tools/fetch-sidewalks.mjs` downloads the package record and the GeoPackage to
   `~/.cache/slop-toronto/raw/sidewalks/` (kept unless `--force`), with `source.json`. Nothing raw goes in git.
2. `node tools/build-sidewalks.mjs` reads `js/toronto-geodata.js` for the frame, projection and islands, takes the
   polygons in the detail frame, and with GEOS (GDAL's SQLite dialect with SpatiaLite, i.e. the `ogr2ogr` the other
   geodata tools already need) simplifies each one (0.2 m, topology preserved), repairs it, clips it to every island's
   raised slab (the curb outline 0.25 m in, computed by `offsetPolygonInward` read out of `js/city-grid.js`, so build and
   browser agree) and unions each island's pieces. Medians and islands of 400 m² or less (all walkway already) are left
   out. A piece that lies at least 80% within the footprint of a deck 3 m or more up (`GEO.decks`) is a bridge's own
   sidewalk mapped in plan and is dropped (2 pieces). Slivers under 1 m² and holes under 0.5 m² are dropped.
3. The output: 3,512 pieces with 1,001 holes and 84k vertices on 2,386 islands, about 1.64 km². Rings are stored in
   decimetres, delta-encoded: 599 KB, 234 KB gzip, 210 KB brotli. The build is deterministic (same inputs, same bytes)
   and takes about 3 s.

`js/toronto-sidewalks.js` names the islands it was clipped to by `blocks`, a key of their count and an FNV-1a hash of
their outlines at 1 dm (`js/sidewalk-polygons.js`, shared by the build and the browser). If the geodata's islands change
without a sidewalk rebuild, the browser logs a warning and every island keeps the fixed band; `tests/sidewalks.test.mjs`
fails until it is rebuilt.

## In the browser

`js/sidewalk-polygons.js` decodes the pieces per island. In `js/city-grid.js`, an island with pieces gets:

- its slab's sides in the walkway's concrete (the 4 cm step above the kerb's top),
- its top in the island's yard material (paved forecourt downtown and wherever there are towers, front lawn among
  houses, park lawn, open land or the rail bed), out to the slab's edge: the verges, front yards and forecourts,
- the City's sidewalks over it, 6 mm up, in the walkway material: over the small parks' lawns (+4 mm), under their paths
  (+8 mm) and tree beds (+11 mm).

An island without pieces is drawn as before. `?sidewalks=0` draws the fixed band everywhere, for comparison.

Only the surface changes. The slab, its height (`CITY_BOUNDS.sidewalkHeight`) and therefore `blockAt`, the walking floor,
collisions and every prop's ground height are exactly as before, and nothing is drawn off the islands. Benches, hydrants,
pay stations, wayfinding signs and the like still stand where the City maps them, on the island top; they may now stand on
a grass boulevard beside the walk, which is where many of them are.

The former fixed-width assumption is still used, unchanged, by:

- the fallback band above, and the small parks' extent (cut to the 4.6 m property line),
- build time: the lot rectangles (`tools/geo-blocks.mjs`), park-sign placement (`tools/geo-parksigns.mjs`) and the road
  cuts' half widths (`tools/geo-roads.mjs`), all baked into `js/toronto-geodata.js`,
- the subway entrances' stair placement (`js/subway.js`), the rectangular sidewalk cover that traffic and pedestrians
  query (`blockSidewalks`/`roadSidewalks`, lot rects grown 4.4 m), the rail spans' sidewalk clearance
  (`js/city-config.js`), and the pedestrians' walking lines where an island has no City sidewalk (see
  [Pedestrians on the walks](#pedestrians-on-the-walks-st-2t9)).
- CaféTO's placement rule that keeps "the walkers' inner line" clear (`js/patio-layout.js` `walkerLines`) still means
  the fixed lanes. The walkers' lines on a mapped walk can now cross a café; every café is one of their obstacles, so
  the line goes round it on the walk where it can.

## Merging with other work

- **PR #4 (durable geodata IDs):** no shared files except `README.md` prose. That PR keys its sidecar by a hash of the
  `js/toronto-geodata.js` file; this one is keyed by the islands' values, so it is unaffected by either.
- **perf/binary-geodata:** the sidewalks are a separate script and do not touch `js/toronto-geodata.js` or
  `tools/build-geodata.mjs`. Keep both new entries in the city script list (`./js/toronto-sidewalks.js` after the
  geodata, `./js/sidewalk-polygons.js` before `./js/city-grid.js`); the sidewalks are only read when `buildCityGrid`
  runs, so an asynchronously decoded binary GEO works as long as it is in place by then. If `js/toronto-geodata.js`
  stops being generated, `loadCity()` in `tools/build-sidewalks.mjs` must read the islands from the binary instead; the
  key survives the format change as long as the island coordinates round to the same decimetres.
- Rebuild the sidewalks (`node tools/build-sidewalks.mjs`) after any geodata rebuild that changes the islands.

## Verification (2026-10-29)

- `tests/sidewalks.test.mjs` (5): the committed sidewalks name the committed geodata's islands and keep their
  provenance; every one of the 84,215 vertices lies on its island's slab (within the 5 cm of decimetre rounding), never
  on a median or a small all-walkway island; a changed or missing island set, or no data, falls back to the band; the
  ring encoding round-trips; and a synthetic GEOS run keeps a hole while dropping the part on the roadway and a median's
  sidewalk.
- Full `npm test`: 241 tests, 228 pass, 13 fail: the same 13 failures by name as a clean `origin/main` (6868522: 236,
  223, 13). `npm run build` passes and fingerprints both new scripts.
- gpu2 (Mac mini, Metal WebGPU; the lock was shared, so **contended: functional evidence only**), `tools/shots/sidewalks.json`
  at Queen West, King & Spadina, a residential street (Euclid Avenue), Queens Quay West, the Queen Street East approach
  to the Don and Fort York Boulevard, each as an oblique aerial and a walker's view, at the high tier (1600 x 900) and
  the low tier with a phone viewport (412 x 915, mobile), before (`?sidewalks=0`) and after. Receipts:
  `ride-anywhere-geo/review/gpu2/claude-sidewalks/` (`{before,after}-{high,low}--<site>-{aerial,pov}.png`, console logs).
  - Both tiers log `City sidewalks on 2386 islands (79092 triangles, 30–35 ms), the fixed 4.6 m band on 182`; the
    browser's island key matches the data's. Startup to ready was 12.5 s after / 12.0 s before at high and 11.8 s /
    14.7 s at low: within the contention noise.
  - Residential: the 4.6 m concrete band becomes the mapped ~1.5 m walk at the curb with the lawn beside it, on one side
    only where the City maps one side. Downtown (King & Spadina, Queen West, Queens Quay) the City's walk runs curb to
    building face and looks as before. Fort York Boulevard's narrow planted island, solid concrete before, shows its
    boulevard and walk. At the Queen Street East approach nothing is laid under a deck.
  - `tools/shots/sidewalks-wide.json` adds 75 m oblique views: the Euclid Avenue grid shows the narrower walks and lawn
    beside them at both tiers; the King & Spadina one lands inside a tower (as did the 28 m one there), so downtown rests
    on the walker's views.
  - Hydrants, bike rings, signs, poles and trees stand on the island top as before; nothing floats or sinks (no height
    changed). The Polyfork bench model 404s in both arms (the locally prepared, unshipped `plaza-bench.glb` was absent
    from the synced worktree), so benches were not visible in these captures; their placement code is unchanged.

## Pedestrians on the walks (st-2t9)

The walkers' lines used to run 1.7 and 2.8 m beyond each road's half width in the road graph. On Toronto's side streets
that half width is often narrower than the curbs (a one-way street's 1.95 or 3.7 m against curbs 4–6 m out). So the
lines fell in the road and were dropped, or landed on the front lawns or the grass boulevard beside the City's walk.
`js/pedestrian-routes.js` now takes them from the polygons (`walks`, `sidewalkWalkIndex` in `js/sidewalk-polygons.js`:
an even-odd point test over each island's pieces and holes, bucketed in 1 m rows and built per island on first use):

- **Where the lines go.** Every 3 m along an edge (16 cross-sections at most), the search looks out from the centre line,
  past the roadway and any median, onto the first curb island. Along it, it finds the walk nearest the curb, bridging
  gaps under 0.6 m. The side's island is the one most cross-sections reach. Its two lines go a third and two thirds of
  the way across the walk's median extent: at most 1.45 m from the walk's curb side and 1.1 m apart. On a wide downtown
  walk that matches the old lanes, measured from the real curb.
- **Ends and bends.** A line stops short of its ends where it would leave the walk at a corner or leave its island, by
  up to a quarter of its length. A straight line that still has more than 2 m off the walk follows it instead. That uses
  the detours' search held to the walk (rows 4 m apart, steps up to 1.2 m across).
- **Furniture.** A blocked line first looks for a detour on the walk. If there is none, it detours within the island's
  band as before, else runs through the furniture or is dropped as before. A line that leaves its island right across
  the detours' reach (a laneway's mouth) is dropped without a search.
- **Corners.** A corner link takes a way on the walk first: straight, or meeting the two lines' extensions. The last
  1.2 m to a crossing's end may leave the walk. Then it takes the island's band as before, so no corner loses a link.
- **Fallbacks.**
  - On a mapped island, a side with no walk gets no lines where the City maps one across the street (one-sided
    sidewalks).
  - Where neither side has a walk (laneways, park drives), the side keeps the fixed lanes.
  - An island the City doesn't map keeps the fixed lanes exactly.
  - `?pedwalks=0` restores the old behaviour everywhere. In node, it gives the same lines, crossings, landings and corner
    links as `main`'s code on every edge.
- **Not changed.** Crossings, midblock crossings and WALK reactions stay the road network's. Dodges also still use the
  island and its curb rectangles.

The midblock crossings' landing search now uses a 32 m grid of edges instead of measuring every edge for every
crossing end. It gives the same landings, in the same order. It saves more start-up time than the walks cost (below).

### Verification (2026-10-29)

- **Whole network, in node.** `createPedestrianRoutes` ran on every edge of the committed geodata, with the curb
  rectangles and the building colliders as the walkers' obstacles. The browser's furniture was not included.

  | | Lines | km | On the City's walk | On grass | Off the walk, paved | Unmapped island |
  | --- | --- | --- | --- | --- | --- | --- |
  | Fixed lanes (`?pedwalks=0`, = `main`) | 14,051 | 699 | 37.7% | 21.6% | 36.9% | 3.8% |
  | This change | 27,370 | 1,493 | 90.3% | 3.4% | 4.6% | 1.6% |

  - Of the 27,370 lines, 25,063 follow a mapped walk: 97.4% on it, 0.9% on grass. Another 1,726 lines are the fixed
    lanes on islands mapped without a walk on either side: 46% grass. The remaining 581 lines are on unmapped islands.
  - By edge side: 14,763 sides are on the walk, 823 are left out (one-sided streets), 1,430 have no walk either side
    and 1,678 are on unmapped islands. 1,081 lines follow a bending walk and 337 detour round furniture on the walk.
  - Line count roughly doubles. The old lanes were mostly in the roadway and were dropped; Huron Street had none.
  - Corner links: 98.4% of line ends now link to another track, up from 95.5%. 86.1% of link length is on the walk, up
    from 46.5%.
  - Unchanged: 2,284 crossings, 164 midblock crossings and no crossing without a landing.
- **Start-up, in node.** Building the routes went from 1.1 s on `main` to 0.35 s with `?pedwalks=0` (the landing grid)
  and 0.74 s with the walks.
- **Tests.**
  - `tests/pedestrian-routes.test.cjs` adds a Euclid-style residential street (3 m grass boulevard, 1.5 m walk, road
    graph narrower than the curbs) and its corner, where the walk sweeps round the lawn.
  - It also adds one-sided and unwalked streets and unmapped islands. The last case gives the same lines as without the
    walks.
  - It adds a King & Spadina-style downtown corner: curb-to-building walks keep the old lines, the crossings are
    identical, the links stay on the walk and a patio is detoured round on it.
  - `tests/sidewalks.test.mjs` checks the point test against a plain even-odd test at about 95,000 points.
  - Mutation checks fail the new tests when walk links, one-sided sides, walk detours or end trimming are removed.
- **gpu2 (Mac mini).** The runs shared the mini lock, so these are functional evidence only. Shot list:
  `tools/shots/ped-sidewalks.json`, Winchester Street (Cabbagetown, 2.3–2.5 m grass boulevard) and King & Spadina.
  Each site was captured at the high tier (1600 x 900) and on a phone (412 x 915, low tier), after and before
  (`?pedwalks=0`). Files: `ride-anywhere-geo/review/gpu2/slop-toronto-poles/st2t9-{after,before}-{high,phone}-*`.
  - Walkers on Winchester walk on the concrete between the boulevard and the lawns.
  - At King & Spadina they keep to the walks and queue at the crossings as before.
  - Load-time route stats (high tier): 1,282 lines with the walks against 561 with the fixed lanes. Crossings were
    2,200 built and 84 blocked in both runs. With the walks, 145 midblock crossings were built (6 without a landing),
    against 141 (10).
  - Walker census, 16 samples over 8 s within 90 m: no walker on grass in either run at either site. The census
    counted walkers at these two sites only.
    - The only off-walk samples are one walker at Winchester, stepping aside on a 0.5 m mapped walk on Metcalfe Street.
      It is the same in both runs.
    - With the fixed lanes, King & Spadina had 8–10 samples on an unmapped island; with the walks it had none at the
      high tier.
  - Start-up phase `traffic`, high tier: 665 ms with the fixed lanes, 823 ms with the walks. On the phone: 632 ms and
    837 ms. Ready at 11.9 s and 12.6 s (high) and 11.6 s and 12.1 s (phone). These timings are contended.

## Toronto's poured sidewalks

Bead `st-ut3` (after `st-e6s`, the New York slab port in PR #19). John's review of that port: "that's not how Toronto does
sidewalks". Toronto's walks are poured in place, not laid in flags, and now look like it.

### What Toronto does (sources)

- **City of Toronto TS 3.70, Construction Specification for Concrete Sidewalks** (Sep 2023,
  [PDF](https://www.toronto.ca/wp-content/uploads/2024/10/9582-ecs-specs-roadas-TS-3.70-Sep2023.pdf)): contraction joints
  saw-cut 5 mm wide and t/4 deep; full-depth 12 mm bituminous-fibre expansion joints at most 6 m apart; one longitudinal
  joint, parallel to and 1.5 m from the curb, only where the slab is 3 m or wider (07.11.01); a light broom or swirl-float
  finish; formed edges finished with a 5 mm rounded edge and a smooth band up to 50 mm wide, contraction joints *not*
  tooled (07.09); a contractor's stamp with the contractor's full name and the year of construction at each end of the
  work and at every tenth bay (07.10).
- **Standard drawings** T-310.010-1 (joints, "2 m (TYP)",
  [PDF](https://www.toronto.ca/wp-content/uploads/2017/11/97d5-ecs-specs-roadwd-T-310.010-1_Rev2_Nov2016.pdf)),
  T-310.010-2 (2.1 m minimum width, 1.8 m on local roads,
  [PDF](https://www.toronto.ca/wp-content/uploads/2017/11/975f-ecs-specs-roadwd-T-310.010-2_Rev4_Sep2017.pdf)),
  T-310.010-6 (the stamp centred across the slab, 50 mm from a transverse joint, its text parallel to the joint,
  [PDF](https://www.toronto.ca/wp-content/uploads/2017/11/8f8e-ecs-specs-roadwd-T-310.010-6_Rev2_Nov2014.pdf)) and
  T-310.010-7 (the stamp: a 225 × 130 mm rounded rectangle in a 3 mm groove, the name arcing across the top in 25 mm
  Gothic letters, the year in 40 mm digits in the middle, a word along the bottom,
  [PDF](https://www.toronto.ca/wp-content/uploads/2024/10/957e-ecs-specs-roadwd-T-310.010-7-Rev4-Sep2024.pdf)).
- **Streetscape Manual User Guide** ([PDF](https://www.toronto.ca/wp-content/uploads/2019/05/906c-city-planning-streetscape-manual-user-guide.pdf)):
  joints or saw cuts divide the walk "into 1200 mm to 1600 mm bays" (the 1.5 m used here, which is also John's
  observation; the construction drawing's typical is 2 m), and the decorative paver band by the curb (below).
- Stamps' history: blogTO ([2013](https://www.blogto.com/city/2013/03/these_sidewalk_stamps_date_the_ground_under_your_feet),
  [2021](https://www.blogto.com/city/2021/03/where-oldest-sidewalk-stamp-toronto/): stamping since the 1930s, old ones
  worn to faint relief) and Spacing ([2007](https://spacing.ca/toronto/2007/05/11/obsessing-about-sidewalk-stamps/)).
  What pre-modern stamps looked like isn't documented; the ovals before 1985 here follow John's description.
- Asphalt: City TS 3.90 ([PDF](https://www.toronto.ca/wp-content/uploads/2017/11/9911-ecs-specs-roadspecs-TS_3.90_Sep2017.pdf)):
  minor cracks (20 mm or less) routed and sealed with hot-poured rubberized asphalt (OPSS 341 / 1212); Ontario's cold
  cracks asphalt across the road (thermal cracking, [TRID](https://trid.trb.org/View/100217)) and along it at the paving
  lanes' joints and wheel paths.
- John's photos: Dundas Street West at Roncesvalles (June 2026, the wayfinding pillar,
  `~/.cache/slop-toronto/props/wayfinding-pillar/photos/`) and Roncesvalles Avenue (October 2026, the parking machines,
  `~/.cache/slop-toronto/props/parking-meter/photos/`): stripes across the walk, a fresh pale full-width repair beside
  the old grey walk with a stamp by its joint, the broom texture and smooth edges, a neutral grey roadway (overcast, about
  0.8 of the old walk's brightness) with thin cracks along and across it.

### How it is drawn

- **The walk frame** (`js/sidewalk-sections.js`, used by `js/city-grid.js`): each island's curb (its slab outline, 0.25 m
  in) is split into straight runs (vertices within 0.35–0.9 m of the chord, so the 1 m raster's jogs don't break a run).
  Every walk triangle gets the frame of the run it lies along: `walkFrame` (direction, curb line, seed × 2 + downtown) and
  `walkSpan` (how far in from the curb the walk runs there, by a ray across the City's polygon; snapped to the run's typical
  span when within 35 cm, so a straight walk's stamps don't jump). A triangle that spans a corner (runs more than ~20°
  apart) is cut along the line where the two curb lines are equally near, unless one part would be a sliver. The fallback
  band and the road cuts' walks get frames too. Cost on the M4: 213 ms at startup for the 2,386 islands; the walkways go
  from 79k to 131k triangles, and two vertex attributes are added (uv dropped).
- **Sections** (`sidewalkSection`, mirrored hash for hash in the shader by an integer hash, so tests and tools see what is
  drawn): 1.5 m bays from a phase per run; every 4th joint an expansion joint; the lengthwise joint on slabs ≥ 3 m. A repair
  is a run of 1–3 whole sections in a group of 4 (about a quarter of groups among houses, a third downtown), so it spans
  the walk from curb to property line. The original pour has one year per run (1952–1991 among houses, 1976–2013
  downtown); repairs 1998–2025. The concrete's shade follows its year (new repairs pale), sections before 2000 have tooled
  joints with smooth margins, newer ones plain saw cuts; the formed edges always have the 50 mm band.
- **Stamps**: one at each end of a repair (its first section) and every tenth bay of the original pour, 50 mm from the
  joint, centred across the walk (pre-1975 ones drift towards an edge), the text along the joint and reading from inside
  the section. A 1536 × 1120 R8 atlas, drawn on a canvas at startup, holds one stamp per year 1950–2025; it is pressed
  4 mm in (worn shallower on old ones) and faded out by 1.4 cm a pixel. The names are clearly fictional, as John chose:
  SLOP CONCRETE LIMITED, SLOP PAVING COMPANY, SLOP & SONS CONTRACTORS, SLOP CEMENT WORKS LIMITED, SLOPWAY CURB COMPANY.
  No real contractor's name is used. `window.CITY.findSidewalkStamp(x, z, r)` finds one in the built city.
- **Forecourts**: the paved yards between the City's walk and the building face (downtown and wherever there are towers)
  were a 1.5 m world-aligned flag grid, which looked like New York beside the new walks; they are now plain concrete a
  shade darker than the walk.
- **Tiers** (`surfaceWear`): 2 (high) everything; 1 (medium, phone) joints, expansion and lengthwise joints, full-width
  repairs with their years' shades, margins, heave and stains, no stamps, broom, cracks, gum or scaling; 0 the plain walk
  with its transverse joints.

### Not done (follow-ups)

- **Unit pavers & granite bands downtown.** The Streetscape Manual's "typical Toronto sidewalk" has a decorative band of
  concrete or granite pavers, 400–1200 mm wide, next to the curb on main streets, and assigns each street a type on its
  [Streetscape Manual Map](https://www.toronto.ca/city-government/planning-development/official-plan-guidelines/design-guidelines/streetscape-manual/streetscape-manual-map/).
  None of our data says which blocks have one, so none is drawn; importing that map's street types would tie it to data.
- Corners are split along the bisector between two runs; real corners have a ramp and radial joints.
- The curb material's joints are still square to the world axes.

### Verification (2026-10-29)

- `npm test`: 338 tests, 337 pass, 1 opt-in skip (as `main`). New `tests/sidewalk-sections.test.mjs`: the joints run across
  the walk on a rectangle turned to Dundas Street West's 48.6° and round its corners, with the walk's area kept exactly;
  the City's walk on Dundas at Roncesvalles gets Dundas's bearing; repairs are whole sections (1–3, the same across the
  walk); the years; stamp placement (each end of the work and every tenth bay, 50 mm from a joint, centred, inside the
  walk, none under 0.6 m); the shader's hash constants and pinned hash values. `tests/surface-wear.test.cjs` checks the
  tier gating (stamps, broom, gum, cracks and the road-direction field only at level 2).
- Fragment WGSL (`renderer.debug.getShaderAsync`, `?q.surfaceWear=0|1|2` on the high tier), before (`main`) → after:

  | Level | Road bytes / `sin` | Walkway bytes / `sin` |
  | --- | --- | --- |
  | 0 | 40.2 KB / 49 → 40.1 KB / 49 | 34.6 KB / 22 → 34.6 KB / 21 |
  | 1 (medium, phone) | 46.0 KB / 71 → 45.6 KB / 71 | 42.8 KB / 45 → 41.8 KB / 29 |
  | 2 (high) | 73.3 KB / 177 → 63.7 KB / 137 | 52.4 KB / 83 → 59.5 KB / 78 |

  The phone's level 1 costs less than before. The walkway adds integer-hash work (no `sin`), one texture fetch at level 2
  (the stamp atlas, in a pixel-size branch) and 5 vertex varyings; the road one texture fetch at level 2 (the direction
  field).
- gpu2 (Mac mini, Metal WebGPU, contended: functional evidence only), `tools/shots/toronto-sidewalks.json` (made by
  `tools/shots/make-toronto-sidewalks.mjs`): Euclid Avenue, Dundas Street West at Roncesvalles, King Street West, two
  stamps, Queen Street West's roadway with its tracks and the CaféTO patio on College, midday and golden hour, at high
  (1600 × 900) and low on a 412 × 915 touch viewport, before and after. Receipts in
  `ride-anywhere-geo/review/gpu2/claude-sidewalks/` (`tsw-before-*`, `tsw-after-*`, and `tsw-final-high-*` for the
  roads after the tar-seam loops were removed). No page or shader errors; walk frames 214–235 ms at startup.
