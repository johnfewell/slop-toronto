# Road medians: the holes in the City's road-surface polygons (st-ceg7)

The City's "Topographic Mapping – Edge of Roadway" polygons have holes where a median or a traffic island stands inside
a road. `tools/fetch-roadway.mjs` kept only each polygon's outer ring, so those islands were drawn as road. Now it
keeps the holes, and the geodata build draws the thin ones as medians.

## What changed

- **`tools/fetch-roadway.mjs`** writes `city_roadway.json` with each polygon as `[kind, outer, holes?]`. The third
  element is there only for a polygon that has holes, so the file is otherwise byte for byte what it was, and a reader
  that takes `[kind, ring]` (the road-widths tools, the retire list) is unchanged.
- **`tools/geo-blocks.mjs`** fills each polygon less its holes (`fillSurface`, `tools/road-surfaces.mjs`). A hole stays
  land unless another polygon covers it. The land is labelled like any other, so a hole becomes a curb island.
- **The coverage test of the road-width rule** (docs/road-widths.md) uses the same fill, so a median inside a polygon is
  no longer "mapped surface" for a centre line beside it.

## Which holes

The City has 316 holes in the detail box (150 in Road Edge polygons, 160 in Intersection, 6 in Lane Edge) and 3 more
in Highway Edge polygons, which this layer leaves out. The Eglinton map's box has 538. The build keeps a hole only when it is a median by the test the
curb-island builder already uses: a mean width (2 × area / perimeter) under 9 m and an area under 60,000 m²
(`isMedianRing`, `MEDIAN_WIDTH`, `MEDIAN_AREA`).

The fat holes (18 of 316 on the detail map, 32 of 538 on the Eglinton map) are left as road, as before. Each is a whole block inside a laneway polygon. Restoring them brings back
buildings that stand there (five on the detail map: massing ids 100832, 103837, 105149, 137504 and 137506), which adds
five rows to the building list and so moves every row number the building, massing, preset and patio data and their
tests pin. That is a separate, larger change: st-ceg7's follow-up bead.

## How a median is drawn

A median is a curb island the builder already knows (`median: true`, `js/city-grid.js`): a raised curb, and inside it
lawn (planted), or paved for a streetcar median. Nothing new was written for the renderer. It is also what the existing
medians, the gaps between two City polygons, already get. Ground-level paint (a painted island, a gore) is not a hole in
the City's data, so it stays road.

What this does not do: a concrete traffic island is drawn as lawn, as the existing medians are. The City layer has no
surface for a hole, and a classifier from the 2025 orthophoto was tried (the share of green pixels in each new island)
and was not reliable: shaded trees read as grey. Left as a follow-up.

## Effect, measured on the committed build against the one before

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

The buildings (35,266), the road graph's nodes and links, and the street list are unchanged on both maps. The street
trees and the cycling lines (`GEO.streetTrees`, `GEO.cycling`) are placed against the islands, so they change with them.

The streets that gain the most island area (new islands only; roads OpenStreetMap has no name for are listed by class):

| Detail map | m² (islands) | Eglinton map | m² (islands) |
|---|---:|---|---:|
| Lakeshore Avenue (the Island) | 804 (4) | primary links | 1,570 (9) |
| secondary links | 705 (5) | service roads | 1,263 (11) |
| primary links | 638 (5) | secondary links | 1,219 (9) |
| Lake Shore Boulevard East | 558 (3) | Chaplin Crescent | 808 (4) |
| Front Street West | 450 (4) | Lakeshore Avenue | 804 (4) |
| River Street | 407 (2) | Lake Shore Boulevard East | 558 (3) |
| service roads | 378 (3) | Old Forest Hill Road | 451 (2) |
| Shaw Street | 323 (1) | Front Street West | 450 (4) |
| Remembrance Drive | 239 (2) | River Street | 407 (2) |
| Wabash Avenue | 168 (1) | Gateway Boulevard | 376 (1) |

## Drawn widths against the orthophoto

Cross-sections of the drawn roadway (the gaps between curb islands, perpendicular to the road) at 12 divided roads,
before and after. The orthophoto is the City's 2025 8 cm layer (`cot_ortho_2025_color_8cm`); the outlines were drawn on
it and looked at, not copied into the repository. Widths are metres, a road on each side of the median.

| Road | Drawn before | Drawn after | Orthophoto |
|---|---|---|---|
| Shaw Street | 13.7 | 5.0 + median 3.5 + 5.2 | tree-lined planted strip: agrees |
| River Street | 19.9 | 7.5 + 3.6 + 8.8 | planted wedge between the carriageways: agrees |
| Cherry Street | 13.0 | 5.4 + 2.3 + 5.3 | brick-paved strip with trees: agrees (drawn as lawn) |
| Canada Boulevard | 33.3 | 10.0 + 8.2 + 15.1 | raised planted island: agrees |
| Lynd Avenue | 28.4 | 7.8 + 13.1 + 7.5 | planted triangle: agrees |
| Colborne Lodge Drive | 26.6 | 11.5 + 8.7 + 6.4 | grass triangle: agrees |
| Lakeshore Avenue (Island) | 13.7 | 4.6 + 4.2 + 4.9 | grass strip between the lane and the path: agrees |
| Riverside Drive | 25.6 | 13.8 + 7.4 + 4.4 | a raised concrete verge at the kerb: partly agrees |
| Front Street West (Trinity) | 22.1 | 8.8 + 5.0 + 8.3 | a parking lane's edge: the island is narrower than drawn |
| Front Street West (Princes' Gates) | 12.1 | 5.0 + 2.5 + 4.6 | a paved plaza island: drawn as lawn |
| Remembrance Drive | 21.9 | 7.7 + 6.9 + 7.3 | painted gore on a car park: not a raised island |
| Lake Shore Boulevard East (Cherry) | 31.3 | 13.3 + 11.3 + 6.7 | a concrete apron with a crosswalk: drawn as lawn |

So eight of the twelve match the orthophoto on position and width (within about 0.5 m where the kerb is clear), and
four do not match in kind: a painted gore, a concrete apron, a plaza and a narrower island are drawn as raised lawn.

**Not fixed by this: the bead's own example.** Lake Shore Boulevard East at the Don (OSM way 22942636, 300 m) has no
hole in the City's polygons there. Its cross-section is a 6.5 m polygon, a 1 m gap and a 17 m polygon, with or without
holes. The 25.6 m is not a median the layer records, so it needs the surveyed-surface route of docs/road-widths.md.

## Block numbers moved again

A block's id is its place in the build's list, so 46 more islands renumber the ones after them (docs/road-widths.md).
The tests that pin Toronto Island blocks by number use the new numbers: 2874 → 2913, 2880 → 2919, 2881 → 2920,
2889 → 2928, 2895 → 2934, 2901 → 2940, 2903 → 2942, 2904 → 2943, 2905 → 2944. The island docs
(`docs/waterfront-island-*.md`) still quote the earlier numbers.

## Rebuilt

After `tools/geo-blocks.mjs`: the detail geodata, the Eglinton frame (`tools/frames/build-frame.mjs … --install`),
`tools/build-sidewalks.mjs`, the lidar trees, `tools/build-high-park.mjs`, `tools/build-high-park-woods.mjs`,
`tools/build-park-woods.mjs --park toronto-island`, the massing sidecar, the parked cars, and all three CaféTO patio
layouts, recorded on the Mac mini (the sites are 200, 200 and 209 as before).

## Not done

- **Fat holes** (a whole block inside a lane polygon): left as road. See above.
- **Concrete and painted islands**: drawn as lawn.
- **Highway Edge polygons** (three holes): this layer does not read that kind.
