# Road medians: the holes in the City's road-surface polygons (st-ceg7, jf-4v9)

The City's "Topographic Mapping – Edge of Roadway" polygons have holes where a median or a traffic island stands inside
a road. `tools/fetch-roadway.mjs` kept only each polygon's outer ring, so those islands were drawn as road. Now it
keeps the holes, and the geodata build draws them (st-ceg7). The follow-up (jf-4v9, below) restored the holes that are
whole blocks, and gave each median a material: planted lawn, concrete, or paint.

## What changed (st-ceg7)

- **`tools/fetch-roadway.mjs`** writes `city_roadway.json` with each polygon as `[kind, outer, holes?]`. The third
  element is there only for a polygon that has holes, so the file is otherwise byte for byte what it was, and a reader
  that takes `[kind, ring]` (the road-widths tools, the retire list) is unchanged.
- **`tools/geo-blocks.mjs`** fills each polygon less its holes (`fillSurface`, `tools/road-surfaces.mjs`). A hole stays
  land unless another polygon covers it. The land is labelled like any other, so a hole becomes a curb island.
- **The coverage test of the road-width rule** (docs/road-widths.md) uses the same fill, so a median inside a polygon is
  no longer "mapped surface" for a centre line beside it.

The City has 316 holes in the detail box (150 in Road Edge polygons, 160 in Intersection, 6 in Lane Edge) and 3 more
in Highway Edge polygons, which this layer leaves out. The Eglinton map's box has 538.

## The follow-up (jf-4v9)

### 1. The fat holes are back

st-ceg7 kept a hole only when it passed the curb-island builder's median test (mean width under 9 m, area under
60,000 m²: `isMedianRing`). The other 18 holes of the detail map (32 of the Eglinton map's 538) are whole blocks inside
laneway polygons, and they were left as road. They are kept now: every hole is land, and a fat one is a block like any
other, with its lots.

| | Detail map | Eglinton map |
|---|---:|---:|
| Buildings | 35,266 → 35,271 | 140,541 → 140,548 |
| Blocks (before the paint step below) | +9 | |

The five restored buildings on the detail map are the City 3D Massing records 100832, 103837, 105149, 137504 and
137506 (rows 9123, 12042, 13354, 17803 and 17805 of `GEO.buildings`). The Eglinton map gets the same five and two more.

**Row numbers.** The rows after each new one move up by one. The data keyed by row was rebuilt, and the tests that pin a
row use the new one:

- **Rebuilt by their tools:** `js/toronto-storefronts.js`, `js/toronto-heritage.js`, `js/toronto-public-art.js`
  (geodata hash and rows), the massing sidecar (`data/toronto-massing.bin`: `row`, `rowCheck` and the Eglinton
  `frameRows`), `tools/data/building-inputs.json`, the building presets and their debug file, `tools/building-forms.json`
  and `tools/building-classes.json` (with their documents), the lidar trees, the three CaféTO layouts, and the sidewalks.
- **Pinned by hand, shifted:** the Toronto Island building data (`js/waterfront-island-buildings-data.js`,
  `tools/data/island-outliers.json`, `tools/build-island-buildings.mjs`), and the tests of the Queen's Quay Terminal,
  the Power Plant, the Bathurst silos, the marina sheds and the Queen City clubhouse. A row at or after 17,806 moves up
  by five on the detail map. The Eglinton map's rows move by their own count (seven rows were added there, and the
  silos' 130964–130970 became 130971–130977); the modules resolve the Eglinton rows by identity (name, centre and
  height), and the literal rows the tests quote moved with the rebuilt map.
- **Identity, not row:** everything keyed by the City massing id (the massing sidecar's records, the presets, the
  heritage cards) is unaffected. `docs/geodata-ids.md` has the id forms. The Eglinton map's patio layout and the
  storefront signs re-check each building's centre before use.

### 2. What each median is made of

Three materials. The City's data does not say: Edge of Roadway has no surface for a hole; Physical Area of Sidewalk has
one subtype ("Sidewalk") and none of the islands checked lies on one; the 2018 land cover is 1,812 neighbourhood-sized
polygons. The 2025 orthophoto does, and `tools/classify-medians.mjs` reads it.

| Material | Drawn as |
|---|---|
| **lawn** | a raised kerb and planted lawn: as every median was |
| **concrete** | a raised kerb, paved top (the streetcar medians' treatment, `GEO.blocks[i][5] === 2`) |
| **paint** | no island: the road, with a white edge line and 45° hatching (`GEO.gores`, `js/road-paint.js`) |

**The classifier** (`tools/median-material.mjs`) samples the pixels of a median in the City's 2025 8 cm orthophoto
(`cot_ortho_2025_color_8cm`), leaving out the pixels near the outline (the City's layers sit about a metre off the
imagery) and the very dark ones:

- **Planted:** the share of pixels that are green by excess green, (2G − R − B) / max channel above 0.07, is 15% or more,
  or the median is 0.04 greener on average than the road in a band 1.5 to 4.5 m round it. This is what the earlier
  attempt lacked: it read shaded grass as grey, but a shaded lawn is dark green, and excess green is normalised by the
  brightness.
- **Paint:** not planted, no wider than 8 m (2 × area / perimeter), and within 14 grey levels of the road's own grey in
  that band. A gore painted on the asphalt is the asphalt; paving, brick and concrete are paler or darker.
- **Concrete:** the rest of the unplanted ones.
- A median that is a lot on a lane (a building on it or within its footprint's reach) or one of the streetcars' own
  medians is not painted: the first keeps the lawn it had, the second is paved whatever the classifier says.

The leaf-off 2024 orthophoto (`cot_ortho_2024_color_8cm`) was tried first and is not used. It cannot decide: Remembrance
Drive's gore is a lawn island in 2024 and plain paving in 2025. The City's layers year by year disagree on the ground
(`registry/investigations/slop-road-medians-followup.md` in the shared data repo).

The result is `tools/fixtures/median-materials.json`: a point inside each median and its kind, for the medians that are
not lawn (lawn is the default). It is keyed by that point, not by a block number, so a build that renumbers the blocks
still finds it. `node tools/classify-medians.mjs <geodata.js> …` rewrites it from built geodata; it downloads the crops,
so it is run by hand, not by the build. Entries marked `"by": "eye"` were judged on the orthophoto and are never
overwritten.

**Counts** (medians by material, after the build):

| | Detail map | Eglinton map |
|---|---:|---:|
| Medians | 446 | 1,032 |
| lawn | 193 | 513 |
| concrete | 99 | 254 |
| paint (a gore, left as road) | 154 | 265 |
| Blocks | 2,857 (3,002 before) | 7,374 (7,622 before) |

A painted gore is back to road: the cells of the island are road in the block raster, so no island stands there, and
walkers, cars and the traffic network see what they always saw. The 154 gores cover 7.9 ha of the detail map.

**Checked against the orthophoto**, at the four known misses of st-ceg7 and nine more (the world coordinates are the
island's middle; the classifier agreed with my reading of the orthophoto at 26 of the 33 islands I judged by eye while building it, and
disagreed at seven, which are listed below; two of the four concrete ones it agreed on are the eye entries):

| Island | x, z | The orthophoto shows | Drawn now |
|---|---|---|---|
| Remembrance Drive | −3093, 765 | a painted gore on a car park (the 2025 photograph; a lawn island in 2024) | paint |
| Lake Shore Blvd E at Cherry | 2003, 128 | a concrete apron with a crosswalk | concrete (by eye) |
| Front St W, Princes' Gates plaza | −67, −41 | a paved plaza island with planters | concrete (by eye) |
| Front St W, strip beside the parking lane | −106, −42 | a paved strip, narrower than drawn (the island is the strip) | concrete (by eye) |
| Cherry Street | 1990, −28 | a brick-paved strip with trees | concrete |
| Shaw Street | −2775, −866 | a tree-lined planted strip | lawn |
| Lake Shore Blvd E at the Don | 2001, 154 | lane lines through the island: the road | paint |
| Lake Shore Blvd W | −1880, 269 | a gore on the carriageway | paint |
| A road gore at 43.6657, −79.3562 | 2536, −1607 | a gore | paint |
| Spadina Avenue | −2540, 523 | a pale concrete apron | concrete |
| An island at the map's west side | −4128, −44 | a grass island | lawn |
| A triangle, south of the Gardiner | −384, 3226 | trees on grass | lawn |

**Known errors.** The classifier looks at the road's grey, so it cannot tell a shaded concrete apron from a painted
gore in the same shade, or brick from darker asphalt. The seven islands I judged by eye and it got wrong: a tree pit
in a plaza read as paint; two gores read as concrete (one in shade); two gores beside a building's reach, left as lawn
on purpose; a concrete wedge between two lawns read as lawn; and a gravel triangle read as paint. The four Front Street
West islands and the Lake Shore apron are set by eye in the fixture (`"by": "eye"`).

### 3. Lake Shore Boulevard East at the Don: not fixed

The bead's own example is OSM way 22942636 at 300 m (about −79.3441, 43.6524), drawn 25.6 m wide where the carriageway
is 9.75 m. It cannot be fixed with a surveyed surface (docs/road-widths.md, fix 2), and the reason is in the
orthophoto, not the code. The City's two polygons there (a 6.5 m one, a 1 m gap, a 17 m one) and the OSM line between
them lie on a **new roadway under construction**: a pale bare base, with a planted strip and young trees along its
north side. The traffic is on the old Lake Shore, a separate asphalt road to the south. There is no carriageway kerb to
survey, so a surveyed carriageway placed there would be a guess, and the road stays as the City maps it. When the road opens, its polygon will have holes of its
own: kept by this build.

### 4. Block numbers moved again

A block's id is its place in the build's list, so the nine new blocks and the 154 gores renumber the ones after them.
The tests that pin Toronto Island blocks by number use the new numbers, and `docs/waterfront-island-*.md` quote them
(the earlier numbers are in docs/road-widths.md and, before that, in the island docs themselves):

| Before st-ceg7 | After st-ceg7 | Now |
|---|---|---|
| 2874 | 2913 | 2768 |
| 2880 | 2919 | 2774 |
| 2881 | 2920 | 2775 |
| 2889 | 2928 | 2783 |
| 2893 / 2894 | 2932 / 2933 | 2787 / 2788 |
| 2895 | 2934 | 2789 |
| 2901 / 2902 / 2903 / 2904 / 2905 | 2940 / 2941 / 2942 / 2943 / 2944 | 2795 / 2796 / 2797 / 2798 / 2799 |
| 2907 / 2908 | 2946 / 2947 | 2801 / 2802 |
| 2914 / 2916 / 2917 / 2918 | 2953 / 2955 / 2956 / 2957 | 2808 / 2810 / 2811 / 2812 |

Ids change on any rebuild: find an island by its outline or its centre, as the island yard classifier does.

## Effect of st-ceg7, measured on the committed build against the one before

The same inputs and code, with and without the holes (`GEO_DATA` builds of the detail map and, with
`tools/frames/build-frame.mjs`, the Eglinton map):

| | Detail map | Eglinton map |
|---|---:|---:|
| Curb islands | 2,956 → 3,002 | 7,504 → 7,622 |
| Medians among them | 399 → 445 | 910 → 1,028 |
| New islands (all medians) | 46, 5,971 m² | 118, 16,062 m² |
| Existing islands that changed shape | 7, net +29 m² | 20, net +758 m² |
| Road area removed from the drawn roadway | 6,000 m² | 16,820 m² |
| Holes in the City's polygons, kept as medians | 298 of 316 | 506 of 538 |

The street trees and the cycling lines (`GEO.streetTrees`, `GEO.cycling`) are placed against the islands, so they change
with them. The streets that gained the most island area were Lakeshore Avenue on the Island, the Lake Shore links, Front
Street West, River Street, Shaw Street and Remembrance Drive.

## Drawn widths against the orthophoto (st-ceg7)

Cross-sections of the drawn roadway (the gaps between curb islands, perpendicular to the road) at 12 divided roads,
before and after the holes. The orthophoto is the City's 2025 8 cm layer; the outlines were drawn on it and looked at,
not copied into the repository. Widths are metres, a road on each side of the median.

| Road | Drawn before | Drawn after | Orthophoto |
|---|---|---|---|
| Shaw Street | 13.7 | 5.0 + median 3.5 + 5.2 | tree-lined planted strip: agrees |
| River Street | 19.9 | 7.5 + 3.6 + 8.8 | planted wedge between the carriageways: agrees |
| Cherry Street | 13.0 | 5.4 + 2.3 + 5.3 | brick-paved strip with trees: agrees (now drawn paved) |
| Canada Boulevard | 33.3 | 10.0 + 8.2 + 15.1 | raised planted island: agrees |
| Lynd Avenue | 28.4 | 7.8 + 13.1 + 7.5 | planted triangle: agrees |
| Colborne Lodge Drive | 26.6 | 11.5 + 8.7 + 6.4 | grass triangle: agrees |
| Lakeshore Avenue (Island) | 13.7 | 4.6 + 4.2 + 4.9 | grass strip between the lane and the path: agrees |
| Riverside Drive | 25.6 | 13.8 + 7.4 + 4.4 | a raised concrete verge at the kerb: partly agrees |
| Front Street West (strip) | 22.1 | 8.8 + 5.0 + 8.3 | a parking lane's edge: the island is narrower than drawn (now paved) |
| Front Street West (Princes' Gates) | 12.1 | 5.0 + 2.5 + 4.6 | a paved plaza island (now paved) |
| Remembrance Drive | 21.9 | 7.7 + 6.9 + 7.3 | painted gore on a car park (now paint: the road again) |
| Lake Shore Boulevard East (Cherry) | 31.3 | 13.3 + 11.3 + 6.7 | a concrete apron with a crosswalk (now paved) |

## Rebuilt

After `tools/geo-blocks.mjs` (in the order of docs/road-widths.md, "Rebuilding"): the detail geodata, the sidewalks,
the Eglinton frame (`tools/frames/build-frame.mjs … --install`), the massing sidecar, `tools/build-building-inputs.mjs`,
the lidar trees (both maps), the storefront signs, the art and heritage cards, `tools/build-high-park.mjs`, the High Park
and Toronto Island woods, the parking and parked cars, the building forms, classes and presets reports, and the three
CaféTO layouts, recorded on the Mac mini (the sites are 200, 209 and 209; the Eglinton boxes' layout placed 200 before:
the painted gores are road again, so the islands that held nine cafés back no longer do).

## Not done

- **Highway Edge polygons** (three holes): this layer does not read that kind.
- **The Don Roadway and the new Lake Shore at the Don:** construction sites; see above.
- **Concrete vs paint is a heuristic.** The orthophoto cannot show a kerb. A better source would be the City's
  lidar height (a raised island stands 15 cm up), which needs the 2023 lidar at the median scale.
