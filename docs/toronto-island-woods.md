# Toronto Island's woods

Pilot · 2026-11-04 · Bead `st-w050` · The second park to get [High Park's woods](high-park-woods.md): the lidar's
crowns and the woodland floor, built by the same builder from one more entry.

## 1. Why this park

The pilot goes to one more park before any city-wide rollout. It was chosen by OpenStreetMap's wood and scrub on the
city's park islands (`GEO.areas` over `GEO.blocks` with a `parkName`), by where players see it, and by the GTA 2023
lidar's coverage:

| Park | Wood + scrub on its islands | Its islands | Seen from | Lidar (DTM / DSM tiles) |
| --- | --- | --- | --- | --- |
| High Park (done, #85) | 94.9 ha | 170 ha | | 16 / 16 |
| **Toronto Island Park** | **72.8 ha** (61.2 wood) | 263 ha | the whole waterfront from Humber Bay to Sugar Beach, the CN Tower, every aerial of downtown | 23 / 23 |
| Tommy Thompson Park | 42.6 ha | 59 ha (the rest is past the city's edge) | Cherry Beach, far from downtown | 12 / 12 |
| Cherry Beach / Clarke Beach | 14.1 ha | 69 ha | the Port Lands | 6 / 6 |
| Riverdale Park East + West | 12.8 ha | 57 ha | the Don Valley, the Bloor Viaduct | 9 / 9 |
| Ward's Island Park | 8.8 ha | 15 ha | | |

Toronto Island Park has 27% of the wood on the city's park islands that High Park doesn't, and it is the most visible
park after High Park. The candidates named first, Sunnybrook, Wilket Creek, Taylor Creek and the Rouge, are outside
the modelled city. The 574 ha of wood off the park islands (the Don and Humber valleys, the Leslie Spit's outer
parts) stand on terrain the city doesn't model as islands, so the runtime has nothing to replace there.

## 2. The build

`node tools/build-park-woods.mjs --park toronto-island` writes `js/toronto-island-woods-data.js`. It runs the same
rules as High Park's (docs/high-park-woods.md §2) from the park's entry in `tools/park-woods-parks.mjs`:

| Entry | Value |
| --- | --- |
| Islands | the blocks named Toronto Island Park (30, Hanlan's Point to Centre Island, Olympic and Snake islands; Ward's and Algonquin are their own parks) |
| Box | x −2440 to 1600, z 900 to 3500 (the islands and about 10 m round) |
| Tiles | `node tools/fetch-don-valley-dtm.mjs --region toronto-island` and `... --product dsm`: 23 one-km tiles of each, none over the open lake (`lake: true`: no tile there is no canopy) |
| Relief | the DTM's own slope (there is no terrain pilot here); nothing is under the street level |
| Species | a lakeshore's woods: eastern cottonwood above all (`ez-cottonwood-*`: the aspen's form, a poplar too, in its own bark), willows and silver and Manitoba maples (the ash), a few planted oaks; oak / ash / cottonwood 25 / 35 / 40% in the open, 10 / 40 / 50% in the woods (`modelNames`) |

Two rules came from this park and change nothing in High Park's (they were added while High Park's data still rebuilt byte for byte):

- Lake Ontario's outline is skipped as a pond. The city data keeps no holes, so the lake's ring holds the islands.
- A top over 30 m and no wider than 2.5 m is a mast or a light standard, not a tree. That leaves out 11 on the islands.

The result:

- ground on the park's islands: 249.7 ha, 30.5% of it under canopy 5 m or taller (High Park's: 74.7%);
- 9,289 crowns found (549 of them a clump's second stem, high-park-woods.md §2), 24 of them the City's own inventory
  trees, leaving **9,265** (8,712 before the orchard-rows fix): 4,200 in the open, 5,064 in the woods;
- heights: median 15 m, 10th percentile 8.2 m, 90th percentile 24.4 m;
- widths: 4.5 m mean radius in the woods, 3.9 m in the open;
- models: 4,262 cottonwoods, 3,504 ashes, 1,499 oaks;
- no piles of the City's trees on one point: the geodata build spreads the island's along their frontage (`st-unco`,
  `tools/geo-tree-piles.mjs`). Before that it had 5 piles, 147 trees.

The park's islands include the lawns round the airport's fence and the Centre Island lawns. They have no canopy, so
they stay lawn and lose the invented trees the parkland grid had put on them.

## 3. The runtime

`js/park-woods.js` (formerly `js/high-park-woods.js`) takes every `window.CITY.*_WOODS_DATA` that `explore.html` has
loaded before it. Each park replaces the invented trees on its own islands, drops the City's piled trees in its own
box, and gets its own cover texture and its own branch of the lawn material: a box test, then High Park's floor
(including `st-xk79`'s midday grass). Outside the boxes the lawn is exactly its own. Adding a park means:

1. an entry in `tools/park-woods-parks.mjs`;
2. its region in `tools/fetch-don-valley-dtm.mjs`;
3. its data file's script tag before `js/park-woods.js` in `explore.html`.

## 4. Cost

Mac mini, shared (functional evidence, not a budget; `tools/shots/toronto-island-woods.json`, `CAPTURE_QUERY=?quality=low` for the phone).
Before is the same build without the island's data (`st-xk79`'s branch); triangles are rAF-sampled, the most over 60
frames.

The first column is without the island's data (`st-xk79`'s branch). The second is the first cut (8,712 crowns). The
third is with the orchard-rows fix (high-park-woods.md §2) and the cottonwood bark, which is High Park's woods'
current cost too.

| | Before | First cut | Now |
| --- | --- | --- | --- |
| Data (`js/toronto-island-woods-data.js`, every visit) | | 332 KB (100 KB gzip) | 340 KB (104 KB gzip) |
| Cover texture (GPU) / its start-up (laptop CPU) | | 1010 × 650 RGBA8, 2.6 MB / ~14 ms | same |
| Trees in the city (`[ezTrees]`) | 81,068 | 87,226 | 88,248 |
| Triangles, island woods walk, desktop / phone | 5.16 / 3.38 M | 9.52 / 4.90 M | 9.90 / 4.99 M |
| Triangles, island aerial (190 m over the lagoons), desktop / phone | 3.16 / 2.48 M | 3.79 / 2.95 M | 3.82 / 2.99 M |
| Triangles, High Park woods walk, desktop / phone | 9.95 / 5.21 M | 9.95 / 5.21 M | 10.58 / 5.62 M |
| Triangles, High Park aerial, desktop / phone | 4.60 / 3.43 M | 4.60 / 3.43 M | 4.63 / 3.46 M |
| Triangles, Harbourfront at HTO Park looking at the island, desktop / phone | 5.450 / 3.634 M | 5.454 / 3.634 M | |
| Trees' start-up (`trees`), desktop / phone | 377 / 278 ms | 402 / 457 ms | 425 / 415 ms (shared, noisy) |
| Ready, desktop / phone | 13.1 / 12.8 s | 13.1 / 13.2 s | 13.1 / 12.4 s |

In the woods the island costs about what High Park's woods do. The clumps' second stems (about 500 in each park) add
4-8% in a walk through either park's woods, 1% from the air. From the city's side of the harbour, where most players
look at the island, nothing measurable changes: the island is 1.5 km off, all whole-crown cards. What the island adds is
start-up work (about 7,000 more trees to place and instance, a second cover texture) and the data file.

## 5. A city-wide rollout

The model's park islands total 1,203 ha in 112 parks. High Park and Toronto Island Park are 433 ha of that (36%),
and 168 of the 268 ha of OpenStreetMap wood and scrub on park islands. The rest of the wood is spread thin: Tommy
Thompson Park 42.6 ha (its islands mostly past the city's edge), Cherry Beach 14.1, Riverdale Park East and West 12.8,
Ward's Island 8.8, Rennie Park 5.0, Algonquin Island 4.0, Humber Marshes 3.5, and under 3 ha each after that.

- **Wooded parks only** (the 8 parks above with 3 ha or more of wood): about 330 ha of islands. At the island's 37
  crowns a hectare of ground, that is **about 12,000 more crowns**, a few more than the island added. Each walk in
  those woods would cost what High Park's and the island's do.
- **Every park island** (770 ha more): about **28,000-30,000 crowns** at the island's density. Many of them stand where
  the City's inventory trees already stand (Trinity Bellwoods, Riverdale), and those take the crowns. That would be about
  a third more trees city-wide, which is start-up and memory more than per-frame cost.
- **Lidar:** free, the same GTA 2023 project covers all of it. It is roughly 40-60 more 1 km tiles of each model
  (about 1 GB raw, outside the repository).
- **What would have to change first:**
  - one data file per park, loaded on every visit, does not scale; it needs per-island ground grids instead of a box
    that is mostly lake, and a lazy load by distance (`st-yjnt`);
  - the lawn material's per-park branches would want to become one atlas;
  - the islands' trails are not in the geodata (`GEO.parkPaths` has none on the island), so trees can stand on them,
    as the invented ones did (`st-0tjn`).

## 6. Limits

- **Species.** As in High Park, the lidar gives where, how tall and how wide, not what. The cottonwoods take the
  aspen's form, a poplar too, in a cottonwood's bark rather than the aspen's white: the ash model's own bark texture,
  greyed, paled and warmed a little, its furrows deepened, fully rough (`ez-trees.js` `cottonwoodBark`, the
  `ez-cottonwood-*` variants; no new assets). Up close it reads as a grey-brown furrowed trunk, though the ash
  texture's furrows are finer than an old cottonwood's deep ridges. The willows stand in as ashes. The EZ-Tree set
  has no willow.
- **The data file** is 340 KB (104 KB gzipped) on every visit, against High Park's 160 KB (`st-yjnt`). Most of it is the 4 m ground
  grid over a box that is largely lagoon and lake. A rollout wants per-island grids or a lazy load.
