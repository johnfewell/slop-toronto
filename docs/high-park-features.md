# High Park's features

2026-11-03 · Bead `st-5yps` (found in the High Park audit, `st-us0w`) · On the [High Park terrain](high-park-terrain.md)

The terrain pilot put High Park on its real ground, but the park itself was one even lawn: `GEO.parkPaths` draws only the
parkettes' paths, so none of High Park's trails were there; Colborne Lodge had no building (it is not in the City's
massing); and the gardens, the zoo's paddocks, Dog Hill, the labyrinth, the allotments, the amphitheatre and the parking
lots were not modelled. The traffic drove West Road and the middle of Colborne Lodge Drive, closed to cars since 2023.
This adds them, all inside the park's box, on its terrain.

| File | What |
| --- | --- |
| `tools/build-high-park-features.mjs` | Builds the data from OpenStreetMap: the raw downloads the geodata build reads (`GEO_DATA`) and an Overpass extract of the park (`HIGH_PARK_OSM`, default `~/.cache/slop-toronto/raw/high-park/osm-features.json`, fetched with `bash tools/overpass.sh <file> tools/data/q_high_park_features.overpassql`) for the shapes the downloads lack (the zoo's enclosure, the labyrinth, the fences) |
| `js/high-park-features-data.js` | The data (75 KB, 25 KB gzip): paths, areas, barriers, the two buildings' footprints, the closed roads, in the world frame |
| `js/high-park-features.js` | The runtime: `buildHighParkFeatures(scene)` (main.js, after the rinks, before the park's trees), `closeHighParkRoads(network)` (main.js, after the traffic), `highParkFeatureAt(x, z, margin)` (street-details.js keeps the park's trees off what it covers) |
| `tests/high-park-features.test.mjs` | The data in the park, the layers on the lawn, the lodge on its bluff, the trees' keep-out, the shaders, the closures |
| `tools/shots/high-park-features.json` | The Mac mini captures: each feature at ground level and from the air, golden hour and midday, views outside the box, and a recorded check |

## What is in it

- **Paths and trails** (277 runs, 29 km): OpenStreetMap's footways, paths, pedestrian ways, steps and cycleways in the
  park, not the sidewalks along its roads, the crossings or the bridges, cut to its curb islands 0.6 m in from the kerb
  and off the water. By surface: asphalt (the paved paths, Cherry Hill Trail, Spring Road's car-free stretch), earth (the
  Western Ravines', the east ravine's and the savanna's trails; a `path` with no surface is a trail), boardwalk (Spring
  Creek Trail, planked across), gravel, and steps (treads). Widths from the map, else 4.5 m for a pedestrian way, 2 m a
  footway, 1.4 m a trail.
- **Gardens:** Hillside Gardens' 17 flowerbeds and the sunken garden's three fountains (stone basins, water, a jet) in their
  hedge rings; the Maple Leaf bed in red; the Children's Garden and the landscaped beds as clipped shrubs on mulch. The
  beds bloom with the season (`uLeaf`): bare mulch from late autumn to spring, as now.
- **The labyrinth** (seven rings of stone in the lawn), **the amphitheatre** (grassed terraces rising from its stage), **the
  allotments** (6 × 9 m plots in rows of crops, bare in winter), **the parking lots** (asphalt).
- **The zoo's paddocks** along Deer Pen Road: the enclosure's ground worn bare in patches, OpenStreetMap's paddock fences as
  post-and-rail with wire mesh, and 29 animals, each species in its own stretch of the enclosure: bison, yaks, Highland
  cattle, llamas, reindeer, mouflon, Barbary sheep, capybaras, emus and peafowl. Low-poly models from Poly Pizza, fetched
  as the camera comes within 500 m, with simple boxes standing in until then ([the zoo's animals](high-park-zoo-animals.md)).
- **Dog Hill** and the park's other nine off-leash areas: the grass worn in patches.
- **Fences and hedges** (97, 8.5 km): the ravines' and the pitches' chain-link (galvanized posts, a top rail and a
  see-through mesh), railings, the sunken garden's hedges, low walls.
- **Colborne Lodge**, procedural, on the OpenStreetMap footprint (w156278826): J. G. Howard's 1837 Regency picturesque
  cottage, two storeys of cream stucco with a wide three-sided bay to the south (the lake), its verandah round the bay and
  down both sides on slender trellised posts under a green tin roof, tall ground-floor windows with green shutters, a
  hipped shingle roof with deep eaves, the lower kitchen wing behind, three brick chimneys, steps down from the front door.
  **The coach house** (w156278825, the museum's washrooms) beside it: stucco, hipped roof, carriage doors, a cupola. Both
  stand on the highest ground under them, on stone plinths down to the lowest (the lodge's floor 13.3 m over the street
  level, its ridge 23.0 m), and are solid to the player. Its look is from descriptions (stucco, the verandah, three
  chimneys, the three-sided bay): no paid tools or generated assets.

Everything flat (paths and areas) is built at the lawn's height (the curb island's 0.22 m) plus a few centimetres and
draped over the terrain like the lawn (`DON_VALLEY.drape`), with a depth bias; everything standing (fences, basins, the
buildings, the animals) stands on `DON_VALLEY.heightAt`. The park's generated trees (`street-details.js`) keep 2 m off
the paths, beds, fountains, paved areas and buildings. (The woods themselves are `st-8g3r`.)

## The car-free roads

The City's **High Park Movement Strategy** (City Council, 11 May 2023; first changes August 2023) closed **West Road and
portions of Colborne Lodge Drive** to cars seven days a week (over 1.7 km), kept the **whole park closed to vehicles on
Saturdays, Sundays and statutory holidays** (only authorized vehicles), and kept access to the Spring Road parking lot.
On weekdays private vehicles enter from Parkside Drive, Spring Road and Colborne Lodge Drive and leave by the Bloor Street
gates (the City's park page, 2026). OpenStreetMap carries this: `motor_vehicle=private` on West Road, Colborne Lodge
Drive's middle (between the Grenadier Café and the lodge), a short stretch of Spring Road and Howard Park Avenue's spur, and
`motor_vehicle:conditional=no @ Sa-Su` (or `private @ Sa-Su`) on the rest of the park's roads.

The traffic now keeps off them (`closeHighParkRoads`): each traffic edge along a closed road becomes **bus-only**, which
traffic.js already honours (no car appears on one or turns onto one; the TTC's buses on their routes still may, the
"authorized vehicles"); then every edge in the park's box that the open roads no longer reach both ways is closed too, so
no car is trapped in a stub. Which roads:

- **Always:** West Road and Colborne Lodge Drive's middle (and the two short private spurs): 60 edges, 1 stub.
- **On a weekend:** the whole park (Colborne Lodge Drive, Centre Road, Deer Pen Road, Spring Road, High Park Boulevard
  inside it): 124 edges, 4 stubs.

The day is the one the load-built scenery stands on (`seasons.js` `CITY.SITE_DATE`, as the rinks and patios use): a city
opened live is car-free on a Toronto Saturday or Sunday; one opened on a time preset (and every automated capture without
a date fixture) keeps the classic weekday look, which matches the City's weekday traffic counts and the TTC's weekday
service the traffic is drawn from. `?parkroads=weekend` or `?parkroads=weekday` overrides it. Statutory holidays are not
counted. The parked cars (`parked-cars.js`, placed from the City's by-laws) are unchanged.

Why: the roads are closed in reality, permanently for West Road and the lodge stretch; cars driving them on a walk
through the park were wrong. The weekend closure follows the real day like the sky and seasons do, rather than making the
park car-free always (it is open to cars on weekdays).

## Cost

Measured on the Mac mini while it was shared (functional evidence, not a budget): `tools/shots/high-park-features.json`'s
`check` (the park aerial at midday, `renderer.info`) and the console's startup line; before is main `182034a`, after this
branch, both from `npm run build`'s `dist/`, `CAPTURE_SEED=6711`.

| | Desktop before | Desktop after | Phone before | Phone after |
| --- | --- | --- | --- | --- |
| Triangles per frame (the park aerial) | 4.164 M | 4.255 M (+91 k) | 3.013 M | 3.099 M (+87 k) |
| Draw calls (same frame) | 479 | 524 (+45) | 217 | 253 (+36) |
| Ready after | 12.7 s | 13.4 s | 12.4 s | 13.0 s |
| Features built in (on the mini) | | 136 ms | | 120 ms |

The features are 35 meshes, 99 k triangles: the draped paths and areas 52 k (the paths 38 k: 29 km of ribbons cut by the
10 m grid), the fences and hedges 48 k (2,762 posts), Colborne Lodge and the coach house 1.4 k, the animals 2 k. The
startup difference (+0.6 s) is within the shared mini's spread between runs (the build itself is 0.12 s); the scripts
add 43 KB gzip. The draw calls are one per material and kind; the fences, hedges, basins, animals and buildings are
culled with distance (`userData.cullDistance`, 500-1600 m).

## Verification

`tests/high-park-features.test.mjs`: the data's sources and kinds, every path point on the park's islands and off the
water, the lodge where OpenStreetMap's node for it is, the closures (West Road and Colborne Lodge Drive always; Centre,
Deer Pen, Spring Road and Colborne Lodge Drive on weekends); the build in the park's box only, every draped vertex within
3 cm of its layer's height over the lawn; the lodge and coach house on the highest ground, plinths to the lowest, solid;
the trees' keep-out; every material built to WGSL; the closures on the real street graph (West Road's edges bus-only,
Centre Road open on a weekday and closed on a weekend, nothing outside the box changed, and every open edge in the box
still able to leave it). `npm test`: 607 tests, 605 pass, 2 skipped (main: 601, 599, 2).

Captures (`tools/shots/high-park-features.json`, the Mac mini, desktop `?quality=high` and phone `?quality=low` at 412 ×
915, golden hour and midday): the park from the air, Colborne Lodge from the lawn, its front and from the air, Hillside
Gardens' sunken garden from the lawn and the air, the Maple Leaf bed, the zoo's paddocks (the bison, the Highland cattle)
and from the air, Dog Hill from the lawn and the air, the labyrinth, the amphitheatre and allotments, a western ravine
trail, West Road (empty), and two views outside the box. In the park 91-96 cars on the desktop and 36-38 on the phone at
the run's end, none on a closed road; `?parkroads=weekend` closes 124 edges. Outside the box (100 m clear of it) the
static scene is identical to main's, desktop and phone: each of its 358 (146) meshes' vertices and instances counted
and summed; only the moving trains, streetcars and vehicles differ, as they do between two moments of one run.

## Open questions

- **Weekends.** The park is car-free on a Toronto Saturday or Sunday when the city opens live, open to cars on weekdays
  and on every preset. Making it car-free always (most visits are walks) is one line.
- **Colborne Lodge's look** is from descriptions, not measured drawings: the proportions follow the footprint, the
  storeys, verandah, bay and chimneys are as described. A photo pass could tune the colours and the verandah's roof.
- **The City's stacked trees:** the tree inventory puts dozens of park trees on single points (36 on the lodge's address,
  519 at the Bloor gate); this keeps them out of the lodge, the woods keep one of each pile (`high-park-woods.md`) and
  the geodata build spreads the piles outside the park along their frontage (`tools/geo-tree-piles.mjs`, `st-unco`).
- **The animals** are Poly Pizza's low-poly models (boxes until they arrive), static: see
  [the zoo's animals](high-park-zoo-animals.md#open-questions).
