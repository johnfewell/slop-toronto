# Road widths: roads the City's layer does not map, and the Port Lands streets

Bead st-d9i6, 2026-11-13. The roads around Biidaasige Park were drawn about 4 m wide, far narrower than they are.

## Why

The road surface is the gap between the raised curb islands, and `tools/geo-blocks.mjs` cuts it from two things:

- the City's Edge of Roadway polygons (`city_roadway.json`, `tools/fetch-roadway.mjs`);
- the OSM centre lines, which only carved a 2 m-either-side connector (`CONNECTOR = 2.0`) for every road, so that a
  line inside a City street would not widen it.

Where the City maps no surface, a road was therefore a 4 m strip. The City's layer predates the rebuilt Port Lands
streets. Its newest geometry anywhere is 2024-11-26, and it still has the pre-2024 grid: old Cherry Street runs through
what is now Biidaasige Park and the new river mouth, and old Commissioners Street runs across the new river valley.

**Is there a newer edition?** No (checked 2026-11-13). The portal's package (`topographic-mapping-edge-of-road`) was
last refreshed 2026-02-20, which is the edition in the cache. The City's live layer
(`gis.toronto.ca/arcgis/rest/services/cot_geospatial3/FeatureServer/3`) returns the same 146 polygons in the park's box,
with the same OBJECTIDs, the newest from 2023-01-18.

## Fix 1: a road with no mapped surface is drawn at its own width

In `tools/geo-blocks.mjs`, for each run of a road (a way's stretch at grade, or on a deck):

- **Sampling.** The centre line is sampled every metre (`SAMPLE`).
- **Open samples.** A sample is *open* when no mapped surface lies within the road's own half width plus
  `COVER_TOL = 1.5` m. A mapped surface is a City polygon or a surveyed one (fix 2). The tolerance covers the City
  layers' offset from OSM: they are NAD83(CSRS) coordinates labelled WGS84, about 1 m from true WGS84 here.
- **Widths.**
  - Open samples are drawn at the road's own half width: lanes × 3.5 m plus its class's kerb allowance, or its OSM
    `width` tag.
  - Samples `TAPER = 8` m or more along the line from any open sample keep the connector.
  - Between the two, the width tapers in a straight line, so a road running into a mapped junction or a mapped stretch
    of itself narrows over 8 m rather than in a step.
- **Junctions.** Two unmapped roads meeting are both drawn at their own width, and the union of their capsules is the
  junction. An unmapped road meeting a mapped one takes the mapped junction.
- **Kept on the connector**, as before:
  - **Decks.** The ground under a flyover is not its carriageway.
  - **Service roads.** Their 5 m is a default; most are private drives, yards and parking lots.
  - **Living streets.** Their 7.4 m is a two-lane default, and Toronto's include the Island's car-free lanes, which
    are 3–4 m wide (`docs/waterfront-island-paved-widths.md`).
- **Off-raster samples.** A sample off the block raster counts as covered: it is never drawn.

`node tools/report-road-widths.mjs` (with `GEO_DATA`) prints what the rule does to a frame: km by class, the streets,
the stretches under a deck, and the stretches with a City polygon just out of reach (a possibly offset polygon).

### Effect on the detail map

21.8 km of road is now drawn at its own width instead of 4 m.

| Class | km | | Class | km |
|---|---:|---|---|---:|
| motorway | 11.5 | | residential | 2.7 |
| motorway_link | 3.5 | | primary_link | 0.7 |
| primary | 2.9 | | unclassified | 0.4 |
| | | | tertiary | 0.1 (the Port Lands streets are surveyed: fix 2) |

The streets that change most:

| Street | km | Width now |
|---|---:|---|
| Gardiner Expressway, at grade west of the Exhibition | 6.4 | 12 / 15.5 m |
| Don Valley Parkway | 5.0 | 12 / 15.5 m (ramps 5 / 8.5) |
| Lake Shore Boulevard West, under the Gardiner | 2.2 | 11.5 / 15 m |
| Lake Shore Boulevard East, under the Gardiner west of Cherry | 0.7 | 11.5 m |
| Harbour Square | 0.4 | |
| St James Avenue | 0.3 | |
| Royal Drive (DVP ramp) | 0.3 | |

After those come Oak, Station, John M. Tinsley, White Squirrel Way, Swansea Mews, Phipps, Mariner Terrace, Downes and
Pardee: private or new residential streets of 0.1–0.2 km each.

These roads have no City polygon because the City maps expressways and the road under the elevated Gardiner as
"Highway Edge", which `tools/fetch-roadway.mjs` leaves out.

Of main's 2,969 curb islands, 2,765 are unchanged in shape (most renumbered, see below); there are now 2,956.

**Specks.** Land islands under 40 m² are dropped and drawn as asphalt: 556 on main, 711 now (`report-road-widths`
lists them). Matched by position, 232 are new and 77 have gone. Of the new ones, 181 are under 5 m². 223 lie beside a
widened road or its taper; three are at the surveyed Cherry and Lake Shore junction; six are just beyond a widened
road's reach. By the nearest widened road: the DVP 111, the Gardiner 51, Lake Shore West 34, ramps 26, Cherry 5,
Lake Shore East 2 and three residential streets 1 each. None lies in a retired polygon's place. The 1.5 m tolerance's own share was not
separated out: it decides only where a road counts as covered, so its specks are among those beside the widened roads. Plotted against main's islands (13 of them across the causes), they are of two kinds:

- **The leftovers of a paved median.** Most specks lie in a line between a dual road's two carriageways. On main each
  one-way carriageway was a 4 m strip, with a thin island between them. Each is now drawn at its own width, so the two
  overlap and only single raster cells of the island survive. A speck is asphalt inside asphalt, so a visitor cannot
  see it.
- **Raster corners.** These are cells of 1–4 m² where a widened stretch or its taper meets a City polygon or another road
  at an angle.

The specks are harmless. What is not harmless is the medians themselves: 26 thin islands of main's, 27,000 m², are now
road.

- **The DVP** (two stretches, 11,700 and 3,400 m²). The 2025 orthophoto shows only a concrete barrier between the
  carriageways, so main's 8–9 m grass islands were wrong and the paved road is closer.
- **Lake Shore West and East under and beside the Gardiner** (20 islands of 250–1,600 m²). They have real medians,
  about 1–3 m of concrete, and these are now road. This is worse than before.

The rule is not changed here. Restoring a median needs its real width, and the City's Highway Edge polygons have it
for the expressways and Lake Shore under the Gardiner. That is the separate bead for the expressway polygons.

**Widened where it perhaps should not be:**

- **Under a deck.** 2.0 km sits under a deck, all of it Lake Shore and its links under the Gardiner, a real road.
- **City polygon just out of reach.** 1.6 km has a City polygon within 6 m past its reach. Most is the at-grade
  Gardiner beside Lake Shore and ramps beside their mainline. One case was checked on the orthophoto: Market Street by
  St Lawrence Market.
- **Harbour Square.** One of its ways is mapped along a planted strip, so the widened road takes the strip's trees.
  This is where the lidar-trees test found a tree on the roadway. Rebuilt, the detail map's lidar layer drops 37 more
  trees as on the roadway than main's (6,911 against 6,874).
- **Harbour Square Tunnel** (0.1 km). This tunnel is cut at the surface as before, now 7.4 m instead of 4 m.

**Sidewalks** beside an unmapped road:

- **Before.** The island's edge was 2 m from the centre line. The City's sidewalk polygons are from 2021 and have none
  of the new streets, so islands without them got city-grid's fallback walk band along the 2 m edge: on top of the
  real carriageway.
- **Now.** The island's edge is the road's own (or surveyed) kerb, and the same band follows it. The City's sidewalk
  polygons are clipped to the new islands: `tools/build-sidewalks.mjs`, 3,500 pieces.

### Effect on the Eglinton map

The same rule, plus the same surveyed surfaces and retired polygons, gives:

- 45.7 km drawn at its own width (the build's own log line);
- 7,504 curb islands (from main's 7,508);
- 69 fewer lidar trees (288,920 kept against 288,989).

### Other effects of the rebuild

- **Parked cars.** The surveyed streets say what the orthophoto shows about parking (`parking`, `parkingSeen` on each
  chain). Cherry and Commissioners have none; Ookwemin is parked along both kerbs. `js/parking-layout.js` rejects a
  stall on a `"none"` surface (`docs/parked-cars.md`). Against the first pass, 34 stalls and 28 cars on Cherry are
  removed; every other stall and car is identical. The surveyed Commissioners stretch held no stall before either.
- **CaféTO patios.** Node's replay of the patio layout (tests/cafeto.test.mjs) places one more sidewalk patio,
  R57-5517291 on Bremner Boulevard, next to Harbour Square's redrawn islands. The browser-recorded layouts are 200
  sites on both maps.
- **Road graph.** Its gap-joining step asks whether a join would cross a curb island, so the detail graph has one
  more link (5,465) and 72 U-turn ends at the city's edge instead of 74.

## Fix 2: the Port Lands streets, surveyed

`tools/fixtures/road-surfaces.json` holds the measured road surfaces where the City's layer is out of date. It is
written by `node tools/build-road-surfaces.mjs` (with `GEO_DATA`; `--check` says whether it is current) from its own
`stations`, and holds:

- **`stations`.** 30 cross-sections on the City's 2025 orthophoto (8 cm). At each one a 30 × 8 m strip is resampled
  at 5 cm across the OSM centre line, and the kerb offsets are read from the image and its per-column median brightness
  (asphalt about 200–230, kerb and concrete 245–255, planting 130–170). They are good to about ±0.25 m an edge where
  both kerbs are clear.
- **`surfaces`.** 27 ribbons, one per OSM way of each `chain`, with the offsets interpolated along the chain. Each is a
  carriageway or a bridge deck, in lon/lat, with its source and date. The `datum` field states the frame: the City's
  NAD83(CSRS) coordinates labelled WGS84, the frame of the orthophoto and of `city_roadway.json`.
- **`bridges`.** The measured carriageway width of the three new bridges, which `tools/geo-roads.mjs` uses as the
  ways' width. `js/city-config.js` lays the deck over the water from it: Cherry North 10.2 m, Cherry South 7.4 m,
  Commissioners 7.4 m (OSM's defaults gave 7.8, 7.8 and 11.3).
- **`ground`.** Grass inside a City polygon that is otherwise right, filled back to ground after the City roadway (the
  surveyed roadway is filled again over it). There is one strip, south of Commissioners' eastbound lane at the
  carriageway split. It runs from the lane's measured kerb (+3.1 to +3.4 m at 80, 95, 104, 108 and 111 m along way
  1418441608) 16 m out, from 74 m to the way's end. It cuts the western tail of City polygon 56694 (maintained
  2023-01-16), which is old Commissioners Street; the orthophoto shows grass, a pylon, then the cycle track and
  sidewalk there. East of the merge the polygon's south edge is the real kerb, and it is kept.
- **`retire`.** Three City polygons the orthophoto shows are no longer road. The build drops each by kind, a point
  inside and its area, and refuses to build if one matches anything but exactly one polygon:
  - 19174: old Cherry Street through the park and the river mouth. Its north part, today's Ookwemin Street, is
    surveyed instead.
  - 38247 and 38597: old Commissioners Street across the new river valley.
- **`unsurveyed`.**
  - **The Don Roadway.** The orthophoto shows a construction site under its centre line, so it stays as drawn.
  - **Commissioners' westbound lane where the carriageways split.** It is drawn from the City polygon.
  - **Lake Shore East**, which is City-mapped.
  - **Villiers and Munition**, which are City-mapped and unchanged.

The surveyed surfaces are drawn as roadway, and they count as mapped surface for fix 1. Cycle tracks (kerbed, beside
the carriageway) and the grass strips held for transit are not roadway, matching the City's Edge of Roadway.

**What was built**, from the City's own reports:

- One lane each way on Cherry and Commissioners, with painted medians and turn lanes. A 4.0 m two-way cycle track and a
  3.0 m sidewalk run on Cherry's west side, and a grass strip on the east side is held for future transit
  ([2023 Road Openings and Closures in the Port Lands](https://www.toronto.ca/legdocs/mmis/2023/ie/bgrd/backgroundfile-239931.pdf),
  2023-10-12; [2025 report](https://www.toronto.ca/legdocs/mmis/2025/te/bgrd/backgroundfile-251768.pdf), 2024-12-18).
- No transit way is built.
- The 2018 design decks give road decks of 13.7–14.0 m between barriers. The measured carriageways sit inside them.
- The City's documents are under its copyright, so only facts are quoted, and no imagery is copied.

### Drawn width against measured width

Drawn width is the gap between curb islands across the centre line at the station, before (main) and after (this
branch). For a bridge over water it is the road's deck width (the islands are on the shore).

| Street | Station (OSM way @ m) | Measured | Before | After |
|---|---|---:|---:|---:|
| Cherry, near Lake Shore | 1013210801@40 | 13.0 | 4.1 | 12.9 |
| Cherry | 1013210801@110 | 10.35 | 4.0 | 10.6 |
| Cherry | 1013210801@180 | 10.4 | 4.5 | 10.5 |
| Cherry North bridge (deck) | 913974673@13 | 10.2 | 7.8 | 10.2 |
| Cherry, Villiers Island | 1242949363@30 | 9.85 | 3.8 | 10.1 |
| Cherry, Villiers Island | 1242949363@95 | 10.2 | 4.1 | 10.4 |
| Cherry | 1013210802@40 | 10.2 | 4.1 | 9.8 |
| Cherry, at Commissioners | 1013210802@100 | 10.55 | 4.1 | 10.4 |
| Cherry, south of Commissioners | 1101486833@40 | 12.1 | 4.3 | 12.1 |
| Cherry South bridge (deck) | 1352972088@25 | 7.65 | 7.8 | 7.4 |
| Cherry, south of the bridge | 1083107387@90 | 10.2 | 4.2 | 10.5 |
| Commissioners | 26171361@40 | 10.75 | 3.9 | 11.0 |
| Commissioners | 26171361@110 | 10.0 | 4.0 | 10.3 |
| Commissioners | 1412502193@40 | 9.5 | 4.3 | 9.3 |
| Commissioners | 1418542003@35 | 8.65 | 3.8 | 9.1 |
| Commissioners, bridge approach | 1216895564@110 | 7.15 | 4.1 | 7.8 |
| Commissioners bridge (deck) | 1211500111@25 | 7.5 | 11.3 | 7.4 |
| Commissioners, east of the bridge | 1418441606@35 | 8.0 | 4.1 | 8.2 |
| Commissioners, single roadway | 1033412778@100 | 12.7 | 4.1 | 12.7 |
| Commissioners eastbound, at the split | 1418441608@95 | 4.5 | 4.8 | 5.5 (16 in the first pass) |
| Ookwemin (old Cherry) | 551965781@60 | 15.5 | 17.9 (City) | 15.8 |
| Lake Shore East, under the Gardiner | 218787177@150 | 16.2 (shadowed) | 4.2 | 14.0 |
| Lake Shore East, City-mapped | 22942636@300 | 9.75 | 25.6 | 25.6 |
| Villiers, City-mapped | 24382119@100 | 11.25 | 8.5 | 8.5 |

All measurements are from the City of Toronto 2025 orthophoto. The full table of all 34 stations is in the handoff.

**Where the table and the city disagree:**

- **Lake Shore East at 22942636@300.** It is drawn 25.6 m both before and after: the City polygon there spans both
  carriageways and the median. `tools/fetch-roadway.mjs` keeps only each polygon's outer ring, so City medians become
  road everywhere. This is not changed here.
- **Villiers.** The City's polygon is about 2.75 m narrower than the orthophoto.
- **The Commissioners eastbound lane where the carriageways split** (1418441608@95) was drawn 16 m in the first pass
  against 4.5 m measured. The grass island between the carriageways was drawn all along (a median, −7 to −2.5 m). The
  extra width was south of the lane: City polygon 56694's western tail, old Commissioners Street, now grass. On main a
  sliver of island separated it from the 4 m connector (4.8 m drawn). The surveyed lane reaches its real kerb, which
  is where the tail starts, so the two joined. The `ground` strip above cuts the tail back to ground: drawn 5.5 m on the
  1 m raster. A corner of about 5 × 6 m of the tail is left at the merge itself.
- **The Cherry South bridge's north abutment** (1033412779@25), listed as 15.9 m in the handoff's full table, has a
  different cause, and the road is right: across it the city has road from −2.0 to +5.0 m (7 m against 7.15 m
  measured), then the river under the bridge. The table's march to the first island counted the water.

## What the captures show (second pass)

Main's site and this branch's, back to back on the Mac mini, 13 November 2026 at 12:30 pm Toronto, blue sky. Shot lists:
`tools/shots/road-widths-eglinton.json` (the default desktop map, `map=eglinton`), `tools/shots/road-widths-pass2.json`
(the detail map) and `tools/shots/road-widths-phone.json` (the phone preset, 412 × 915).

- **The Eglinton map** (the desktop default).
  - The Port Lands look as on the detail map: full-width Cherry and Commissioners, with no cars parked on them.
  - The Gardiner at Jameson: before, traffic drove across a grass band; now there are two carriageways with grass
    between.
  - The DVP north of the detail map: before, it had a concrete walk band down its middle; now there are two
    carriageways and a thin green line.
  - The Bayview–Bloor ramp and Allen Road are clearly wider.
  - Village Station Road is a little wider.
  - Brickworks Lane is hidden by buildings in that view.
- **Commissioners along the park, re-framed** (r02b, from 20 m over the north kerb). Before, a concrete walk band
  covered most of the real road. Now the road is full width, then the kerb, the walk band and the park's grass.
- **Walk level on the park side** (r07b, on the park walk looking east). The road is now full width beside the grass
  verge, and the park ground runs to the kerb.
  - **Worse than before (fixed in the third pass):** a line of white posts stood on the asphalt, about 1.5 m inside the
    park-side kerb. They were the City cycle track's flexi-posts, drawn inside the measured carriageway; see below.
- **Specks in frames** (DVP, Lake Shore West under the Gardiner, Lake Shore at Cherry, the Gardiner at Strachan,
  Cherry at Polson). No speck can be told from the road around it.
  - The DVP's grass strip between its carriageways is now paved, which the orthophoto supports.
  - Under the Gardiner at York, one grass strip is now road; the piers still stand on the remaining strip.
  - **Worse than before (fixed in the third pass):** at Cherry and Polson, the red cycle track on Cherry's west side was
    gone. The cause given here then (a widened taper) was wrong: the City's trail line lies inside the surveyed
    carriageway. See below.
- **Phone** (detail map). Cherry and Commissioners are full width at the junction, with no parked cars.

## Cycle tracks beside the measured and widened roads (third pass)

**The cause.** `tools/geo-cycling.mjs` draws the City's on-street bikeways ("Cycle Track", "Bike Lane") as bands inside
the road, from the curb it finds on the curb islands, with a separator and white flexi-posts about 2.1 m out. The City's
trails are drawn along the City's own lines. Nothing was keyed to an old edge.

- **What went wrong.** A surveyed carriageway is measured kerb to kerb for the traffic only, and on Cherry and
  Commissioners the real tracks are kerbed outside it. So a band drawn inside it took a traffic lane: the posts in r07b.
  The same holds for a road drawn at its own width, which is its traffic lanes plus a kerb allowance.
- **At Cherry and Polson** the cause was neither the end of the surveyed stretch nor a taper. The City's Waterfront
  Recreational Trail line runs along Cherry's west edge, inside the measured carriageway; the real two-way track
  (OpenStreetMap's cycleway) is just outside the kerb. On main, Cherry was a 4 m strip, so the line happened to fall on
  a curb island.
- **The green marking by the Bike Share dock on Commissioners** was the band's green paint on the approach to a junction.
  It is visible on main and was gone in the second pass.

**The rule.**

- **In `tools/geo-cycling.mjs`.** A City bikeway along the kerb of a surveyed carriageway, or of a road drawn at its own
  width, is left out:
  - the band samples whose curb is that kerb (tested 1 m into the road; sharrows stay);
  - the trail samples that lie on a surveyed carriageway.

  In their place, OpenStreetMap's cycleways within 9 m of where they were, off the carriageway and not alongside a City
  trail already drawn, are drawn as tracks on the ground: their mapped width, cut at the curbs as trails are.
  - **Detail map:** 1,744 m of band and 830 m of trail are left out, and 2,173 m of 22 OSM cycleways are drawn instead.
  - **Tests:** no band remains in a surveyed carriageway; Commissioners has a track each side, on the ground; the Polson
    trail is on the ground.
- **In `tools/geo-blocks.mjs`, a guard.** The own-width widening stops at the near edge of a cycleway running alongside,
  within 0.8 cosine of the road's direction, so a crossing doesn't count. It held back no sample on the detail map and
  one on the Eglinton map.

**Captures.** Main, the second pass and now, back to back on the Mac mini at 12:30 pm Toronto, blue sky
(`tools/shots/road-widths-pass3.json`):

- **r07b.** No posts in the lane. The park-side track runs beside the walk, on the ground.
- **r02b.** The road is clear, and the track is beside it. Main's green junction paint is not drawn (above).
- **s05 and t2 (Cherry and Polson from above).** The red track is back at the junction's west corner and runs beside
  Cherry's kerb on the ground.
- **t1 (Commissioners from above).** Tracks beside both kerbs, and no posts in the road.

**What it changes.**

- **Flexi-posts.** 11,780 → 11,516 on the detail map, and 18,436 → 18,174 on the Eglinton map.
  - None now stands in a surveyed carriageway or inside a widened road's own width, on either map.
  - The ones removed: Cherry and Commissioners along the surveyed kerbs, and 6 on Commissioners east of the split. Main
    had 7 of those last.
- **The green junction paint** by the dock is not drawn now. That track is now an off-road track beside the kerb, and
  tracks are drawn as plain asphalt.

**Proof that nothing else is covered: the Port Lands.** For every hand-built surface, path, track and dock in the box
x 1850–3150, z 100–1150, I compared the area on a curb island (drawn as ground) in main's city and now, on 0.25 m
samples.

- **Gained or kept ground:** the dog areas, the woodchip and three-island surfaces, the Bike Share docks, the small-park
  paths and the park as a whole.
- **Cycle tracks drawn on ground:** 9,534 m² on main, 13,279 m² now. In-road bands: 2,558 m on main, 767 m now.
- **Lost ground**, eleven items:
  - Nearly all of it is inside a surveyed carriageway: paths crossing or meeting the real road, and the 4.25 m bridge
    trails whose OSM lines run within a metre of the measured deck.
  - Outside one: slivers of 1–3 m² at kerb edges, and up to 4 m² in any 10 m stretch of the park ring's edge (the 1 m
    raster).

**Beside every widened road, both maps.** OpenStreetMap's cycleways within 20 m of a widened road: on ground in main's
city against now.

- **Detail map:** 28 run beside a widened road, and 8 lost more than 0.5 m² of ground.
- **Eglinton map:** 37 run beside one, and 10 lost more than 0.5 m²: the same 8 plus Thyra Avenue (4.5 m²) and a
  primary link (1.1 m²).
- **The worst ten:**
  - The Humber River Trail, 93 m², where it crosses Lake Shore West and its ramps at about 45°. The roads are wider, so
    more of the crossing is on road.
  - The rest lost 1–9 m² each at kerb edges: the Waterfront trail by Trinity Boulevard 9.1, Downes Street 7.1,
    Munition 6.4, Harbour Square 5.1 and 2.6, Thyra Avenue 4.5, Commissioners 3.9, Lake Shore East 1.3, and the
    primary link 1.1.

**Not fixed: the 5 × 6 m corner** of City polygon 56694 at the Commissioners merge. It is still road; the cycle-track
work does not touch it.

## Curb islands are renumbered

A block's id is its place in the build's list, so any change to the islands renumbers the ones after it. Three tests
pin Toronto Island blocks by number; they now use the new numbers. Each island is identical in shape to main's:
2893 → 2880, 2894 → 2881, 2902 → 2889, 2908 → 2895, 2914/2916/2917/2918 → 2901/2903/2904/2905. The island docs
(`docs/waterfront-island-*.md`) now quote the new numbers, with a note that ids change on any rebuild. The second
pass's ground strip changed one island's shape (the park's) and renumbered none.

## Rebuilding

After `node tools/build-geodata.mjs`, in this order:

1. `tools/build-sidewalks.mjs`
2. `tools/build-traffic-data.mjs`, `tools/build-signal-plan.mjs` and `tools/build-transit.mjs` (with
   `TORONTO_DATA_CACHE`)
3. `tools/build-lidar-trees.mjs` (with `TORONTO_DATA_CACHE`; also `--frame eglinton`)
4. `tools/build-massing.mjs`
5. `tools/build-storefront-signs.mjs` and `tools/build-art-heritage.mjs`
6. The Eglinton frame (`tools/frames/build-frame.mjs … --install`)
7. Both CaféTO patio layouts, recorded on the Mac mini (`docs/cafeto-patios.md`)
8. `tools/build-parking.mjs` and `tools/build-parked-cars.mjs`, which repack `data/toronto-geodata.bin`

After step 6, `tools/build-high-park.mjs` too: its data records the park's island numbers.

`tests/road-widths.test.mjs` checks:

- the rule's pieces;
- the fixture's contract;
- that its surfaces are roadway in the committed city;
- that the retired polygons' ground is back;
- that the at-grade Gardiner is drawn at its width;
- with `GEO_DATA`, that the fixture is what its stations give.
