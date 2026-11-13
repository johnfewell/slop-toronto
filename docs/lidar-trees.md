# The lidar-only trees

Feature · 2026-11-12 · Beads `st-uzvg.6` (detail map), `st-uzvg.10` (Eglinton map) · Behind `?lidarTrees=1` (off by
default), desktop only, on both maps.

The city draws the City's street trees (its inventory, about 57,000 in the detail frame) and, in High Park and Toronto
Island Park, every crown the province's lidar has ([High Park's woods](high-park-woods.md),
[Toronto Island's](toronto-island-woods.md)). Everywhere else, the parks' and the yards' trees were invented by
`street-details.js`: a parkland grid every ~18 m, a tree or two per 1,100 m² of yard. With `?lidarTrees=1` those
invented trees go, and the trees the lidar actually sees come in: **65,188 trees** in the detail frame, in private yards
and in every park without a woods layer of its own.

## 1. Source

| Item | Value |
| --- | --- |
| Dataset | `trees/2` of the shared Toronto data repo: whole-City trees from the Ontario GTA 2023 lidar (1 m Digital Surface Model over Digital Terrain Model) merged with the City's Street Tree Data. Only its **lidar-only** trees (`src` 2) are used here |
| Pin | `data/shared-toronto-data-pin.json`: the dataset's manifest commit, its lidar tiles' digest, its index's SHA-256, and the SHA-256 of the baked file. No paths |
| Rights | Open Government Licence – Ontario (the lidar); Open Government Licence – Toronto (the City layers its masks come from); credited in [CREDITS.md](../CREDITS.md) |
| Builder | `TORONTO_DATA_CACHE=<the shared repo's cache root> node tools/build-lidar-trees.mjs` (or `--trees2 <folder>`) writes `js/lidar-trees-data.js` and the pin; with `--frame eglinton`, the Eglinton map's cells and index (`data/frames/eglinton/lidar-trees/`, §7) and its pin entry. Without the dataset it says what it needs and exits; the app never needs it |
| Runtime | `js/lidar-trees.js`, loaded only with `?lidarTrees=1`. On a desktop's detail map `explore.html` loads `js/lidar-trees-data.js` before it; on a desktop's Eglinton map it fetches the cells (`js/lidar-trees-cells.js`) before any city script runs. A default visit loads none of it (§6) |

What `trees/2` already did, upstream: one crown per tree top (Gaussian-smoothed canopy, a window growing with height,
a crown radius from the half-height region), the canopy over the City's building parts, water, and highway bridges and
ramps masked out, the City boundary clipped, each tile read with its neighbours (no doubles at tile edges), and every
crown within 4 m of a City street tree given to that tree (those are not lidar-only). Its stated limits carry over (§5).

## 2. The bake

`tools/build-lidar-trees.mjs`, pure parts in `tools/lidar-trees-lib.mjs` (tested in `tests/lidar-trees.test.mjs`).

**Frame.** `trees/2` is in UTM zone 17N metres on the lidar's grid. Each tree goes back to lat/lon with
`utm17ToLatLon` (`tools/terrain-pilot-lib.mjs`, the inverse of the terrain pilots' `utm17`: no datum shift, because the
buildings, curbs and street trees drawn here come from City layers, whose lon/lat behave as NAD83(CSRS)), then to the
world with the shipped projection (`city-config.js` `worldFromLatLon`), never by rotating metres. Checked against the
shared repo's own coordinate module on 400 trees spread over the whole frame: the largest difference was **0.1 mm**.
Positions are stored on a 0.25 m grid, and the rules below judge the stored position.

**What is not drawn, in order** (each tree is counted once, under the first rule that drops it):

| Rule | Test | Trees |
| --- | --- | ---: |
| Lidar-only trees of `trees/2` in the detail frame | | 95,887 |
| The woods layers' areas | on an island of a park with a woods layer (`park-woods.js` `replacesBlock`: High Park, Toronto Island Park) | 15,115 |
| Island residential canopy | within 4 m of a site of `waterfront-island-residential-canopy-data.js` (residential or marina) | 29 |
| Beside a street tree drawn here | within 4 m of a `GEO.streetTrees` position (after the piles were spread along their frontage) | 1,474 |
| Water | `waterAt` | 193 |
| Roadway | on no curb island (`blockAt` is null) | 6,874 |
| Sidewalk | on the island's mapped sidewalk (`sidewalk-polygons.js`), else in the fixed band `GEO.frame.sidewalk` from the curb | 4,065 |
| Building | within 1 m of a building box as `buildings.js` draws it (`city-config.js` `buildingBoxAt`, new: the same boxes, exactly) | 1,026 |
| Rail, modelled landmarks, trail bridges | `treeOffRail` (the test every invented tree takes) | 1,355 |
| Road deck | within 1 m of a bridge deck (`bridgeAt`) | 4 |
| Park path | within half the path's width + 0.8 m of a `GEO.parkPaths` line (`park-woods.js`'s rule) | 254 |
| Sports pitch | inside a `GEO.areas` pitch | 309 |
| **Kept** | | **65,188** |

At runtime (`js/lidar-trees.js`), the hand-built areas keep what they have: a tree inside Biidaasige Park
(`biidaasigeParkInside`), the HTO Park landscape (`htoLandscapeFootprintAt`), the beach landscapes
(`waterfrontBeachLandscapeKeepoutAt`) or on a sports ground (`sportsGroundAt`) is left out (on the Mac mini: 109 and 7).
After that, `main.js` takes every tree site past the courts, rinks, Biidaasige's clearings, the Music Garden, HTO's
paving and the park signs, as for every other tree.

**The street trees.** `trees/2`'s street trees (`src` 0 and 1, including the ones it moved out of a building) are not
drawn by this layer: the city draws its own street trees from the same inventory (`tools/geo-trees.mjs`), with its own
pile spreading. In the frame that is 57,119 street trees left to that layer (30,318 street-only, 19,967 matched to a
crown, 4,954 moved to a crown, 1,880 moved to the boulevard).

**The invented trees.** With the flag, `lidar-trees.js` removes `street-details.js`'s invented park and yard trees (the
ones with no model of their own, not the street tier) in the frame, outside the hand-built areas: 19,139 on the Mac
mini. The parkettes' trees, the wooded parks' and every named tree stay.

**Model.** The lidar gives no species. `modelFor` (`tools/lidar-trees-lib.mjs`): a narrow crown (radius under a fifth
of the height, 8 m or taller) is a pine or an aspen, half each; any other crown a broadleaf, 75% oak (standing in for
Toronto's maples, as in the parks), 20% ash, 5% aspen; small under 9 m, medium under 15 m, large from there. The draw
is a hash of the stored position, so a rebuild gives the same trees. ez-trees.js draws each at its own height, its crown
spread to its width (0.75-1.35 times the model's own). The result: 48,617 oaks, 13,035 ashes, 3,352 aspens and 184
pines; heights median 8.3 m (10th percentile 3.5 m, 90th 18.8 m, tallest 44.2 m).

**Level of detail.** No new class: a tree on a park island (`GEO.blocks` park share over 0.6, 10,988 trees) takes the
parks' distances, any other the yards' (`ez-trees.js` tiers 0 and 2, as the invented trees did). The park trees standing
in closed canopy (60% or more of the ground within 12 m under a crown: 9,271) are woods trees, with the woods' nearer
hand-overs. Yard trees are never woods: `trees/2`'s crown radii merge in closed canopy, so the same test reads 73% of
the yards as woods.

**Format.** `js/lidar-trees-data.js`, 612 KB (about 380 KB gzip), 7 bytes a tree in base64: x and z as Uint16 on a
0.25 m grid from the frame's corner, height (0.2 m) and crown radius (0.1 m) as bytes, and a byte for the model, the
woods and the park. Loaded only with the flag on a desktop, so the default visit pays nothing.

## 3. Rebuild

```sh
TORONTO_DATA_CACHE=<the shared Toronto data repo's cache root> node tools/build-lidar-trees.mjs
TORONTO_DATA_CACHE=<the shared Toronto data repo's cache root> node tools/build-lidar-trees.mjs --frame eglinton
node --test tests/lidar-trees.test.mjs
```

The Eglinton bake also sets the index's hash in `explore.html` (`index.json?v=`), as the geodata's build does.
`--drop-yard-under <m>` leaves out yard trees under `<m>` m; it is off by default and off in what ships (§7).

The bake is deterministic (a rebuild from the same `trees/2` gives the same bytes; tested on a fixture). Rebuild it
when the geodata's islands, buildings, street trees or park paths change, or when the pin moves to a new `trees/2`.

## 4. Cost and looks

Mac mini (M4), shared and **contended** (a production transcription job ran alongside): relative evidence, not a
budget. Each pair ran back to back, A (`?map=detail&quality=high&autoscale=0&cloudSpeed=0&transit=timetable`) then
B (the same with `&lidarTrees=1`), twice (A B A B), uncapped (`CAPTURE_UNCAPPED=1`), 6 s windows after 2 s warm-up,
golden hour. Phone: the capture's phone preset (412 x 915 at DPR 2.625, mobile, its own tier), on the same mini, so its
frame times are not a phone's. Shot list `tools/shots/lidar-trees-ab.json`; triangles sampled over 12 frames.

| View | Desktop off → on: triangles (M), draws, tree instances, frame median | Phone off → on |
| --- | --- | --- |
| Indian Road, street level (residential) | 5.05 → 7.21, 625 → 622, 4,347 → 5,958, 17.0 → 21.2 ms | 4.43 → 6.47, 438 → 435, 3,075 → 4,337, 10.2 → 13.3 ms |
| Indian Road, 60 m up | 5.78 → 7.42, 632 → 643, 6,573 → 9,249, 22.3 → 25.5 ms | 4.88 → 6.30, 3.1 ms more |
| Trinity Bellwoods, walking | 8.99 → 8.29, 838 → 830, 5,351 → 7,420, 24.5 → 23.2 ms | 8.00 → 7.30, 16.1 → 14.9 ms |
| Trinity Bellwoods, 60 m up | 8.27 → 7.90, 702 → 702, 8,693 → 11,756, 24.5 → 23.0 ms | 6.64 → 6.18, 13.7 → 13.1 ms |
| King & Bay, street level | 4.30 → 4.59, 891 → 897, 2,490 → 3,400, 14.2 → 14.7 ms | 3.37 → 3.65, 7.7 → 8.1 ms |
| Grange Park, 70 m up (downtown) | 4.71 → 5.54, 768 → 772, 6,939 → 8,845, 15.1 → 18.2 ms | 3.73 → 4.56, 8.1 → 10.0 ms |

- **Trees in the city** (`[ezTrees]`, detail map): 87,172 → 138,023 (+65,072 lidar, −19,139 invented). Draw calls do not
  move: the lidar trees join the existing instanced meshes.
- **Load:** ready 10.8 / 11.9 s → 12.5 / 12.3 s on the desktop, 11.2 / 11.0 → 12.5 / 12.2 s on the phone preset (the
  data's 612 KB and decoding); the trees' own start-up 416 / 497 → 565 / 661 ms.
- **The cost is in the residential views:** +40% triangles and about +3 to +4 ms a frame where the yards fill in. The
  parks get a little cheaper: their lidar trees replace a denser invented grid, and closed stands take the woods'
  nearer hand-overs.
- **Seasons** (`tools/shots/lidar-trees-seasons.json`, live, `liveDate` and `liveClock`): today (12 November), summer
  (22 August) and winter (20 January). The lidar trees colour, drop their leaves and stand bare with the rest.
- **Winter, fixed (2026-11-12, phase 6b).** The first captures showed Trinity Bellwoods' closed-canopy trees, from
  the woods' card hand-over (about 130 m on the desktop) on, as solid grey-white "frosted" crowns beside bare near
  trees. The cause was the far whole-crown cards (`tsl-materials.js` `createTreeMaterial`), not this layer: a bare card
  kept a third of its leaf cells as a "twig haze", in a light grey-brown and with the leaves' sheen. Every far card did
  that, but the invented park trees reached cards only at the parks' 320 m. The woods' nearer hand-over brought it into
  view. **The same defect was live on main:** Toronto Island's woods (cards at the woods' distance) showed it in winter
  with no flag (`wA-island-near.png`). High Park's woods did not: they hand over to impostors, which season like the
  meshes. Fixed at the cause, for every far card: the haze keeps 14% of the cells, in the bark's dark brown, matte
  (`TREE_CARD_TWIGS`, tested in `tests/seasons.test.mjs`). Winter far crowns now read as dark, see-through twig crowns.
  They are still a little denser than the bare meshes, but no longer frosted. The leaves' colours in autumn and summer
  do not change: only fallen cells are affected.
- **What looks wrong, by eye:**
  - Many small (3-5 m) lidar trees read as saplings.
  - No trees on roofs, roads or decks, and no doubles beside street trees, in the views checked.
- **The quick list** (`tools/shots/check.json`), desktop and phone, flag off (default maps) and on (detail map): no
  change with the flag off; with it, the start and Island shots unchanged in kind.
- Captures: `~/.cache/slop-toronto/captures/lidar-trees-2026-11-12/` (tags `dA*`/`dB*` desktop, `pA*`/`pB*` phone,
  `s*` seasons, `q*` quick list).
- Winter-fix captures: `~/.cache/slop-toronto/captures/lidar-trees-winter-2026-11-12/`. `wA`/`wB`: before the fix,
  flag off/on, 20 January (Island, High Park, Bellwoods, Indian Road). After the fix: `xWoff`/`xWon` and `yWoff`/`yWon`
  (winter, flag off/on), `xCon` (12 November) and `xSon` (22 August), flag on.

## 5. Limits

- **No species.** Models come from height and crown shape, not from what the tree is; Toronto's maples are drawn as oaks.
- **Counts against masks, not ground truth.** The drop rules are tests against this city's layers. A real tree whose top
  stands over the roadway, a sidewalk or a building's box is dropped; a false one off them is kept.
- **Rail bridges are not masked** upstream: the CPR's bridge over the Don carries false trees (outside this frame); any
  elevated rail in the frame can too (the rail corridor test drops trees in the corridor itself).
- **Poles on fields:** light standards on open fields read as small trees in the lidar. The pitches are dropped here; a
  pole on a lawn is not.
- **Split crowns in woods:** a big crown can become several trees, so stands read denser than they are.
- **Park piles:** the City's inventory piles some parks' trees on one address point; those stay with the street-tree
  layer, and their trees are probably also among this layer's park crowns.
- **Two bakes.** Each map has its own (§7); a third map would need a third.
- **Desktop only** (John, 2026-11-12): no cap for phones yet (§6).
- **Leaf-on or leaf-off** state of the lidar is unknown; the seasons are the tree field's own.

## 6. Who loads what

`explore.html`'s loader (`cityAppScripts`) already sorts visits into a desktop and the rest: `desktop` is false on a
touch-first screen (touch points, `pointer: coarse` and `hover: none`), with `?quality=low` or `medium`, or with under 8 GB of device
memory. It also returns that answer, as `cityAppScripts.cityDesktop`.

| Visit | Loads | Trees |
| --- | --- | --- |
| Default (no flag), any device | neither `js/lidar-trees.js` nor `js/lidar-trees-data.js` | main's, exactly |
| `?lidarTrees=1`, desktop, detail map | both, the data first | the lidar's in place of the invented |
| `?lidarTrees=1`, desktop, Eglinton map (the desktop default) | `js/lidar-trees-cells.js`, the cells' index and its 128 cells (fetched before the city's scripts), and `js/lidar-trees.js` | the lidar's in place of the invented; the console line names the cells, the bytes and the time |
| `?lidarTrees=1`, a cell fails to load | as above | main's; the console says `[lidarTrees] the Eglinton map's cells did not load (…); the lidar trees stay off` |
| `?lidarTrees=1`, phone or tablet, any map | `js/lidar-trees.js` only | main's; the console says `[lidarTrees] desktop only for now (this is a phone, a tablet, ?quality=low\|medium or a machine under 8 GB); nothing changes` |

Without the flag, `window.CITY.lidarTrees` is never set, so the one call in `street-details.js` (guarded by it) never
runs. `city-config.js`'s new `buildingBoxAt` is used by the bake only, never at runtime. Tested in
`tests/boot.test.cjs` (the loader on both maps, a phone included; the desktop default visit, the Eglinton map, imports
and fetches nothing of this layer) and `tests/lidar-trees.test.mjs` (the guard, the runtime's messages, the cell
loader).


## 7. The Eglinton map (st-uzvg.10)

The desktop default map has its own bake: the same `trees/2` lidar, judged against that map's own layers (its
geodata, sidewalks and 180,124 street trees), cut into the far band's 1,200 m cells (`city-config.js`
`FAR_BAND.cell`), all fetched at start (John, 2026-11-12: load-by-distance only if start-up or memory asks for it).

**The bake** (`--frame eglinton`, 9 s, 1.0 GB peak on a laptop):

| Item | Value |
| --- | --- |
| Lidar-only trees in the frame (x −7,900…9,600, z −7,300…3,600) | 349,308 |
| Kept | **288,989** (park islands 59,552, of them woods 52,838; yards 229,437) |
| Dropped | woods layers' parks 15,115, roadway 18,295, sidewalk 12,068, rail/landmarks/trail bridges 5,187, near a street tree 5,050, building 2,509, pitch 905, water 624, park path 533, island canopy 29, road deck 4 |
| Files | 128 cells (1 to 5,884 trees, median 2,480), 27 B to 32 KB each (median 14 KB); 1.67 MB gzip'd, 2.02 MB raw; `index.json` 21 KB |
| The core (the detail box) against the detail map's bake | 65,165 in both, 73 kept only here, 23 only there (the two maps' masks differ a little) |

The cells are the same 7-byte packing as the detail file, each from its cell's corner, gzip'd (the server sends `/data/`
files as they are). `explore.html` asks for `index.json?v=<its hash>`, then every cell by its own hash, while three.js
loads, and awaits them with the geodata, so no cell can arrive after the tree field is built; a failed file leaves the
layer off with a console warning, and the city loads either way.

**The small-tree question** (kept yard trees by height, `counts.yardHeightsM`):

| Map | under 4 m | 4–5 m | 5–7 m | 7 m and over | yards | under 5 m |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Detail | 10,644 | 5,288 | 8,046 | 30,222 | 54,200 | 29.4% |
| Eglinton | 41,659 | 20,738 | 31,398 | 135,642 | 229,437 | 27.2% |

`--drop-yard-under 5` leaves them out (15,932 trees on the detail map, 62,397 on the Eglinton map); it is off in what
ships (tested). Same camera, back to back, switch off → on, two runs an arm (A B A B with a rebake between):

| View | Triangles (M) | Tree instances | Frame median (ms) |
| --- | --- | --- | --- |
| Detail, Indian Road 60 m | 7.41/7.40 → 7.25/7.24 | 9,249 → 8,665 | 25.8/25.5 → 25.6/25.5 |
| Detail, Indian Road street | 7.24/7.22 → 7.04/7.06 | 5,958 → 5,442 | 21.3/21.2 → 20.1/20.2 |
| Eglinton, Forest Hill 60 m | 10.59/10.59 → 10.33/10.33 | 14,737 → 13,981 | 24.9/24.6 → 24.5/24.5 |
| Eglinton, Forest Hill street | 12.71/12.70 → 12.49/12.49 | 8,903 → 8,183 | 28.7/28.7 → 28.2/28.3 |

By eye the frames are nearly the same: a few saplings in the nearest yards go. The small trees cost 0.2 M triangles and
up to about 1 ms where yards are in view; most of the layer's cost is the bigger trees.

**Start-up**, Mac mini (M4, contended: a production transcription job ran alongside), Eglinton map, desktop,
`?map=eglinton&quality=high&autoscale=0&cloudSpeed=0&transit=timetable`, flag off → on, A B A B:

| Measure | Off | On |
| --- | --- | --- |
| Ready | 20.9 / 21.3 s | 23.0 / 23.6 s |
| The trees' own start-up (`[init] trees`) | 837 / 978 ms | 1,453 / 1,366 ms |
| `streetDetails` phase (the replacement runs in it) | 2,062 / 2,123 ms | 3,401 / 3,443 ms |
| JS heap after ready (`?memlog=1`, after a forced GC; separate runs) | 2,031 / 2,031 MB | 2,181 / 2,181 MB |
| JS heap at its start-up peak (the culling phase) | 2,363 / 2,362 MB | 2,512 / 2,512 MB |
| Trees in the city (`[ezTrees]`) | 252,707 | 487,693 (288,873 lidar drawn; 58,384 invented replaced) |
| This layer's requests | none | 130: `js/lidar-trees-cells.js`, `index.json`, 128 cells; 1.69 MB in 313–330 ms, in parallel with the geodata |
| Failed or late cells | — | none: every run logged all 128 before the tree field (`[lidarTrees]` before `[ezTrees]`) |

The first runs were slower (ready +5.3 to +5.7 s): a CPU profile put 2.8 s in the HTO landscape's boardwalk test, which
the hand-built-area check called for every lidar tree and scanned all 798 planks each time.
`waterfront-hto-landscape.js` `boardwalkContains` now checks the planks' reach box first (the same answers; tested).
That also trimmed the detail map's start-up: ready 11.6 / 11.5 → 12.0 / 12.0 s with the flag (phase 6: +1 s).

**Frames**, the same A B A B runs (uncapped, 6 s windows, golden hour; triangles rAF-sampled; these ran before the
boardwalk fix, which changes only start-up work):

| View (Eglinton map) | Triangles (M) | Draw calls | Tree instances | Frame median (ms) |
| --- | --- | --- | --- | --- |
| Forest Hill, street level | 11.20 → 12.70 | 1,335 → 1,335 | 5,351 → 8,903 | 25.5/25.5 → 28.6/28.7 |
| Forest Hill, 60 m | 8.12 → 10.59 | 702 → 711/705 | 10,177 → 14,737 | 19.2/19.1 → 24.7/24.5 |
| Eglinton Avenue, street level | 5.93 → 6.64 | 699 → 693/690 | 2,999 → 4,524 | 18.4/18.2 → 19.4/19.5 |
| North from downtown, 180 m | 5.85 → 6.75 | 962/970 → 963/968 | 8,882 → 17,002 | 14.0/14.0 → 15.0/15.0 |
| The frame's north edge, 90 m | 3.82 → 4.58 | 499 → 496 | 3,360 → 4,853 | 11.3/11.8 → 12.8/13.1 |
| Indian Road 60 m (the core) | 6.18 → 7.83 | 607/604 → 616 | 6,573 → 9,249 | 22.8/22.9 → 28.0/27.4 |
| Trinity Bellwoods 60 m (the core) | 8.65 → 8.30 | 665 → 665/659 | 8,693 → 11,756 | 27.4/27.7 → 27.1/27.0 |

The detail map's views, measured again for comparison, match phase 6 (§4) within 0.7 ms.

**Seasons** (`tools/shots/lidar-trees-eglinton-seasons.json`, Forest Hill 60 m and Eglinton Avenue): 12 November, 22
August and 20 January with the flag, and 20 January without. The lidar trees colour, stand in leaf and go bare with the
rest; winter's far crowns are the thin dark twig crowns of §4.

**Looked at, by eye:** Forest Hill's yards and its park fill with crowns; Eglinton Avenue gains trees behind its street
trees (2,999 → 4,524 instances in view); the view north from downtown is much greener between the towers. At the frame's north edge the trees
stop where the frame does, as the street trees and buildings already do; the painted far city beyond has none. In the
overlap the Indian Road view on the Eglinton map matches the detail map's.

**Load-by-distance: not needed now.** All 128 cells arrive in about a third of a second, in parallel with the
geodata, and cost 150 MB of heap. The start-up cost (+2.1 to +2.3 s) is CPU: building twice as many tree sites,
not fetching. The frame cost is in the near views, which load-by-distance would not change: `ez-trees.js` already culls
by distance (yards 950 m, parks 3,000 m, times the quality tier's far factor). Load-by-distance would only defer the far cells' build, and would
need the tree field to add batches mid-session (with warm-up against reveal hitches).
