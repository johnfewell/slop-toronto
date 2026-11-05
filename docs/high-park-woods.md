# High Park's woods

Feature · 2026-11-03 · Bead `st-8g3r` (found in the High Park audit, `st-us0w`) · On the
[High Park terrain](high-park-terrain.md), whose box, lidar project and machinery it shares.

High Park is mostly woods: black oak savanna on the plateau, oak woodland, and red oak, black cherry and white ash in
its ravines. The model had one bright lawn over every island, with invented trees on an 18 m grid (at most 700 an
island), so the park read as an even lawn of lollipop trees. Now every tree on the park's islands stands where the
province's lidar has its crown, at that crown's height and width. The ground under closed canopy is woodland floor
(leaf litter), the savanna and the woods' clearings are unmown meadow, and the lawns stay where the lidar has no
canopy and OpenStreetMap maps no wood (the north lawn, the sports fields, the slopes round Grenadier Pond).

## 1. Source

| Item | Value |
| --- | --- |
| Source | Ontario Elevation Mapping Program, **GTA 2023 lidar**: the **Digital Surface Model** over the **Digital Terrain Model** (bare earth), both 0.5 m, the same 16 one-km tiles as the terrain (`node tools/fetch-don-valley-dtm.mjs --region high-park` and `... --product dsm`, into `~/.cache/slop-toronto/raw/ontario-dtm-gta2023`; manifests `manifest-high-park.json` and `manifest-high-park-dsm.json`, with SHA-256s) |
| Rights | Open Government Licence – Ontario; credited in [CREDITS.md](../CREDITS.md) |
| Also | OpenStreetMap's `natural=wood` and `natural=scrub` outlines (the meadow), the City's street tree inventory (its trees stay) |
| Builder | `node tools/build-high-park-woods.mjs` (High Park's entry in `tools/build-park-woods.mjs`, `tools/park-woods-parks.mjs`) writes `js/high-park-woods-data.js` byte for byte (tested when the tiles are present) |

## 2. The trees

`tools/build-park-woods.mjs` (High Park's entry):

| Step | Rule |
| --- | --- |
| Canopy height | DSM − DTM, the highest of the four 0.5 m pixels in each 1 m cell |
| Where | The park's islands (`GEO.blocks` named High Park), 1 m in from the kerbs, off the ponds, buildings (1.5 m round), tennis courts, rinks and pitches |
| Crowns | The local maxima of the canopy smoothed over ~1 m, in a window growing with the height (radius 1.2 + 0.11 h m, 2–6 m), 5 m or taller, placed between the 1 m cells by the canopy's curvature; a top in the outer half of a taller one's window counts if the canopy dips 12% of its height (1.5 m at least) between them |
| Clumps | A crown 2.5 times as long one way as across (12 m long or more), with no saddle along it, is two crowns merged into one dome: a second stem stands on its long side, at the canopy's height there, 2.5 m clear of any other top |
| Width | Each of 8 ways, where the canopy falls under 60% of the top or reaches the saddle towards a neighbour's (it rises 0.5 m again), the mean; reaching no further towards another top than its share of the way, 0.8 between two of a height, more for the taller |
| The City's trees | Each City inventory tree takes the crown it stands under (within 4 m of its top or 80% of its width, its height within 40%): that crown is left out, the City's record stays |
| Woods / open | In the woods when 60% or more of the ground within 12 m is under canopy 5 m or taller |
| Ravine | Woods on a slope over 25% or under the street level (the relief before the terrain's conditioning) |
| Model | By habitat (oak / ash / aspen): open 90 / 8 / 2%, woods 80 / 15 / 5%, ravine 55 / 40 / 5%; the ash stands in for black cherry too (no cherry model; its dark bark is closer than the aspen's white); small, medium or large by height (9 and 15 m) |

The park's ground (128.5 ha off its ponds, buildings and courts) is 75% under canopy 5 m or taller. The builder finds
7,805 crowns (501 of them a clump's second stem). Of those, 61 are the City's own inventory trees, which stay as the
City records them. That leaves **7,744**:

- 1,159 in the open, 3,749 in the woods and 2,836 in the ravines;
- heights: median 19.7 m, 10th percentile 10.8 m, 90th percentile 26.8 m, tallest 35.7 m;
- widths: 5.1 m mean radius in the woods, 4.1 m in the open;
- models: 5,635 oaks, 1,767 ashes, 342 aspens.

**Not orchard rows** (`st-w050`). The first build (7,237 crowns) read as an orchard in closed woods. The positions were
real, but three things made them look regular:

- 84% of the woods' crowns had the width the nearest neighbour left them (0.8 of the way to it). In closed canopy the
  canopy never falls to 60%, so every crown filled its share of the spacing, and the sizes followed the spacing.
- No two tops stood nearer than the window (none under 3 m, 5% under 4.5 m).
- Every top stood on a 1 m cell's centre, on a grid square to the world's axes. Nearest neighbours lay along the axes
  half as often again as along the diagonals.

The crowns' edges now come from the canopy's own saddles (28% of the woods' crowns still meet a neighbour's limit).
The tops sit between the cells, and the merged domes give clumps. The woods' nearest-neighbour distance is now 7.9 m
(was 8.4): 5% under 4.0 m, one in a hundred under 3 m. The spread of the woods' crown widths (coefficient of variation)
went from 0.27 to 0.34. The nearest-neighbour directions are even.

**The City's piled trees.** The inventory puts many of the park's trees on one address point: 519 at the Bloor Street
gate, 151 by Parkside Drive, 112 at the Grenadier Café, 30 such piles (3 or more at one point) and 1,296 trees on the
park's islands. The lidar's crowns are those trees, so `ez-trees.js` keeps one tree of each pile and leaves the other
1,266 out (`dropPiledCityTrees`). The geodata build leaves the piles on the park's islands to it and spreads every other
pile in the city along its own frontage (`tools/geo-tree-piles.mjs`, `st-unco`), Rennie Park's beside the box among them.

At runtime (`js/park-woods.js`, since `st-w050` shared with [Toronto Island Park](toronto-island-woods.md)), `street-details.js` hands its tree sites over once it has placed them all
(`replaceTrees`). The invented parkland trees on the park's islands go, and the lidar's trees come in. A trunk on one of
the park's paths, beds or buildings is left out (`GEO.parkPaths`, and `highParkFeatureAt` when
`high-park-features.js` has laid them). `ez-trees.js` draws each tree in its named model, at its height, with its
crown spread to its width (0.75–1.35 times the model's own). The tennis courts, rinks and park signs clear the trees
round them as before.

**Level of detail.** The woods stand 50–70 trees to the hectare and hide each other, so their trees are a class of
their own in `ez-trees.js`. They hand over from the full mesh to the decimated one, and from that to mrdoob's
whole-crown cards, at 0.55 and 0.42 of the street trees' distances, the second times the tier's `treeFar` on the
lighter tiers (desktop 30 and 134 m, the middle tier 25 and 89 m, phone 19 and 53 m). The decimated mesh's shadow
ends at half the usual distance, times `treeFar` too. Trees in the open (the savanna's big oaks, the lawns' trees)
keep the parks' distances.

## 3. The ground

The builder writes a 4 m grid over the box: off the park, lawn, meadow (OpenStreetMap's wood or scrub, in the open) or
canopy (half the cell or more under canopy 5 m or taller). `js/park-woods.js` turns it into a small texture:

- the woodland floor is the canopy's share over each cell and its neighbours, eased; leaf litter in mid browns and
  drier ochre-brown with moss, the lawn's grass showing through it in patches (most at the canopy's edges and in its
  clearings);
- the meadow is meadow cells less the floor;
- how open the floor is (`st-xk79`): where the canopy round the cell is thin (under 55-90% of the 28 m round it) or
  the crowns within 14 m mostly stand in the open (the builder's savanna and lawn trees, not the woods'), nothing where
  there is no floor;
- anything off the park's islands is nothing (the box holds the streets and gardens round the park too).

The park lawn material (`createParkLawnMaterial`) mixes in leaf litter (mid brown, ochre-brown and moss) and meadow (olive grass with
its seed heads, through the seasons as the lawn's) by it. The mix happens only inside High Park's box, in a branch;
outside it the lawn's colour is exactly its own and nothing more is computed.

**The high sun.** At golden hour the litter reads as warm brown, but under a midday sun its ochre bleached to dry sand
in the savanna and under the scattered oaks. The floor follows the sun's height (`uSkySunDir`, 0 at golden hour's
10 degrees up, 1 from about 40): the litter takes a deeper umber, its ochre an olive-brown and a little more moss; and
where the floor is open, up to 55% less litter and more grass patches show through, half the savanna's meadow grass.
Under closed canopy (43,000 of the 62,000 canopy cells) only the tint moves; at golden hour nothing changes. The
openness is worked out once, with the cover texture (about 7 ms more on a laptop's CPU at start-up); per pixel it is
a uniform and a few mixes, and no triangles or draws.

## 4. Cost

Mac mini, shared (functional evidence, not a budget; `tools/shots/high-park-woods.json`). Before is `?woods=0` on the
same build, which is main's park.

| | Before | After |
| --- | --- | --- |
| Data (`js/high-park-woods-data.js`, every visit) | | 153 KB (75 KB gzip) |
| Trees in the city (`[ezTrees]`) | 77,985 | 81,626 (+7,237 lidar, −2,339 invented, −1,266 piled) |
| Triangles per frame, park aerial, desktop / phone | 4.19 / 3.02 M | 4.53 / 3.36 M |
| Triangles per frame, in the woods, desktop / phone | 9.06 / 4.71 M | 10.50 / 5.39 M |
| Draw calls, same views | 509, 485 / 230, 242 | 503, 501 / 230, 235 |
| Trees' start-up (`trees`), desktop / phone | 375 / 275 ms | 396 / 388 ms |
| Ready, desktop / phone | 12.5 / 12.2 s | 12.4 / 12.9 s (noisy, shared) |
| Trinity Bellwoods (control, outside the box) | 18,201 tree instances, 6.51 M tree triangles | identical |

The woods' own hand-over distances keep the walk in the woods to +16% on the desktop and +14% on the phone. The first
cut, with the phone's mid level at 76 m, had been +25% there. From just over the canopy the woods' far cards read a
little paler than their mid meshes.

## 5. Limits and open questions

- **Species.** The lidar gives where, how tall and how wide, not what. The models are chosen by habitat from the City's
  descriptions of the savanna and the ravines. The City publishes no inventory of the park's own trees, and the EZ-Tree
  set has no cherry, so the ash stands in for black cherry. No pines: the planted conifers can't be told apart in this
  data.
- **The rest of the city's woods.** Toronto Island Park is the second park ([its pilot](toronto-island-woods.md),
  `st-w050`); the rest are as before. That page sizes a rollout to the rest.
- **Undergrowth.** Crowns under 5 m are not drawn; the woodland floor is a colour, with no shrubs.
- **Trails.** The park's trails come with `st-5yps` (`high-park-features.js`). The trees keep off them through
  `highParkFeatureAt`.
