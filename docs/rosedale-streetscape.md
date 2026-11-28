# Rosedale streetscape: from John's own photos

Bead `jf-qw7`, 2026-11-27. John's three own photographs of Rosedale (Chestnut Park on 22 October and 22 November 2020, and a Rosedale street on 2 October 2020) show what the game gets wrong there.
The photographs are private: they are not in this repository, and nothing here copies them. What they show, in words:

- **Chestnut Park, 22 October:** a narrow winding road with no painted lines, a low concrete curb, black cast-iron lamp posts about 4 m tall with a white globe on top, one on each side every 25 to 30 m; wide grass
  boulevards with a paved walk behind them; huge mature street trees (ash, maple, honey locust) arching over the whole road; clipped hedges (low boxwood along the walks and beds, tall dense hedges on the lot lines); a red
  Japanese maple in a front yard; a brick-paved drive; brown paper leaf bags standing at the curb; fallen leaves on the road and the lawns; a parked car at the end of a drive.
- **Chestnut Park, 22 November:** the same bend in snow: snow on hedges and branches, the posts and globes with snow caps, boulders (large rough reddish sandstone ones in a row, and grey granite ones) along the curb and at lawn corners and drive
  mouths, cars parked in the drives.
- **A Rosedale street, 2 October:** the road's edge is a plain concrete curb, the boulevard a wide strip of lawn with a few large grey boulders, big trees right at the curb, an ivy-covered brick house, tall clipped hedges against the
  walls and along the lot lines, small black lamp posts with globes in the distance, overhead wires.

> Part 1 (centre lines, lamp posts, boulders) shipped as PR #248; part 2 (this section's second half, "Part 2") is below it.

## PR 1: quick wins (centre lines, lamp posts, boulders)

### 1. No centre line on local streets

The page painted a yellow dashed centre line on every two-way street. `js/road-paint.js` now leaves it off a **local street**: one whose OSM class is residential, unclassified or a living street (road-network `rank` 1 or less) and whose carriageway is
under 10 m (half under 5 m). `js/road-network.js` carries `rank` into `paintEdges` (the downtown grid's own streets have none and keep their line).

Real practice: Toronto paints centre lines on its collector and arterial roads and not on local residential streets, which is why Chestnut Park's road is bare in the photographs. The City's Centreline (`FEATURE_CODE_DESC`: Local, Collector, Minor Arterial, Major Arterial)
is the source of truth for that class, but the page's road graph is OpenStreetMap's. Joining the two over 12,000 sampled points on residential roads (shared data cache, `centreline.csv`): **87% Local, 9% Collector, 4% other**; OSM tertiary roads are Collector 45%
and Minor Arterial 48%. So the OSM class is a good proxy: residential and unclassified roads lose the line, tertiary and above keep it. Crescent Rd is OSM tertiary and a City Collector, so it keeps its line; Chestnut Park, Roxborough Dr, Elm Ave's residential
stretches, Glen Rd and Rosedale Rd lose theirs. Citywide it is 6,105 residential and 228 unclassified road pieces of the Eglinton frame.

Limit: about one residential piece in ten is a City Collector, which now has no line; a per-street City class in the geodata would settle it (a data rebuild, not done here).

### 2. Rosedale's lamp posts

The City maps the lamps as ordinary "street light poles" and "pedestrian light poles" with no height or look, so nothing in its data tells Rosedale's posts from a cobra-head on a hydro pole. The rule is therefore by place: `tools/build-rosedale-zone.mjs`
makes `js/rosedale-zone.js`, a 20 m mask (4,345 cells, 2 KB) of everything within 34 m of a house in the South or North Rosedale Heritage Conservation District (1,518 houses from the shared data repo's `rosedale-houses/1`, joined to the pilot's `rosedale-houses.bin`), closed
over the street gaps. 133 of Moore Park's and Summerhill's 1,953 untagged houses lie inside the mask at its edge. A mapped street light or pedestrian light in the mask, on a street that is no more than a collector (OSM rank 2 or less), is drawn as the new look
`globe` (`js/mapped-poles.js`): a 4 m black cast-iron post (fluted base, tapering shaft, a ring, a cup) with a white opal globe that glows at night and casts a lamp pool (`street-details.js`). Where the City mapped no light in the zone the procedural fill (a tall grey pole) is now
skipped. The 9 m light and signal poles at junctions keep their shape. `?rosedaleStreet=0` keeps the old poles.

### 3. Boulders

`js/front-yards.js`: grey granite and reddish sandstone boulders in the boulevard, found by marching out from the lot line to the road's pavement edge (`edgeAt`, from `nearestRoads`' width), 0.4 m behind the curb: at the mouth of a drive (half the time each side), at the lot's
corner (30%), now and then one in the middle of the frontage, and on one lot in ten a row of three to five. Each is a 20-triangle flat-shaded icosahedron pushed about, sunk a third into the ground, drawn with the yard material (kind 12: speckle and streaks, a snow cap in
winter). A stable seed per house, so a rock is where it was on every load. Rosedale styles only.

## Pictures

Same camera before (origin/main `0441144`) and after, on the Mac mini, 1600 x 900, no season preset: 22 October 2026 (autumn colour) and 22 November 2026 with 6 cm of snow, the dates of John's two Chestnut Park photographs. Side-by-side sheets with his photos
are in his private review folder (`slop-toronto-updates/2026-11-27-rosedale-streetscape/`); the pictures here are the game's frames only.

![Chestnut Park, 22 October: globe posts, no painted line](images/rosedale-streetscape-chestnut-park-fall.jpg)

![Boulders and a globe post on Chestnut Park](images/rosedale-streetscape-rock-close-fall.jpg)

![Roxborough Dr in snow: the yellow line and the hydro-pole light are gone, a boulder with a snow cap](images/rosedale-streetscape-roxborough-street-snow.jpg)

![Crescent Rd (a collector: it keeps its line), globe posts](images/rosedale-streetscape-crescent-street-fall.jpg)

## Cost

Mac mini (Apple M4) through `gpu2`, shared with a production transcription job (relative, not budgets), 1600 x 900, uncapped, 20 s recordings, today's date (bare trees), origin/main `0441144` against `5396df0`, alternated
(round 2 ran "after" first). Mean / median frame interval, ms, before -> after, at street level (budget +0.5 ms):

| Place | Round 1 | Round 2 (after first) |
|---|---|---|
| Chestnut Park | 19.04 -> 19.07 (+0.04) / 19.00 -> 19.10 | 19.07 -> 19.10 (+0.03) / 19.00 -> 19.10 |
| Crescent Rd | 16.45 -> 16.22 (-0.23) / 16.40 -> 16.20 | 16.27 -> 16.23 (-0.03) / 16.20 -> 16.20 |

![Chestnut Park, round 1](images/rosedale-streetscape-frame-time-chestnut-1.png)

![Crescent Rd, round 1](images/rosedale-streetscape-frame-time-crescent-1.png)

## What is still wrong

- A City Collector that OpenStreetMap calls residential (about 1 in 10 residential road pieces) loses its centre line; a per-street City class in the geodata would settle it.
- The lamp zone is the two Heritage Conservation Districts: North Rosedale's lamps were assumed to match South Rosedale's (the photographs are of Chestnut Park, South Rosedale). The City maps no height or look, so there is no data to check against.
- Boulders are a rule (a stable seed per lot), not a survey; their number follows what the photographs show, not a count.

## Reproduce

```sh
node tools/build-rosedale-zone.mjs ~/.cache/toronto-data/derived/rosedale-houses/1/houses.csv   # js/rosedale-zone.js
node --test tests/rosedale-streetscape.test.mjs tests/road-paint-cells.test.mjs tests/front-yards.test.mjs tests/mapped-poles.test.mjs
SHOTS=tools/shots/rosedale-streetscape.json ARMS="beforeFall afterFall beforeSnow afterSnow" bash tools/capture-rosedale-streetscape.sh   # on the Mac mini through gpu2
```

## Part 2: leaf bags, fallen leaves, paver drives, red maples

What the photographs show that part 1 did not touch, and what was done (`js/front-yards.js`, `js/front-yard-material.js`; the yard mesh, drawn within 250 m, so the cost is the yards' own):

| In the photographs | Now |
|---|---|
| Brown paper leaf bags standing at the curb, two or three together | `leafBag`: a kraft-paper bag (a body 0.46 x 0.3 m that bellies out, the top gathered in and folded, 26 triangles) in a group of two or three beside a drive's mouth or on the frontage, on 38% of Rosedale lots (42% of the grand ones; 8 to 15% elsewhere). **Seasonal in the material** (kind 14): there from the autumn colour's peak (mid October) to the first of December, none under snow, so a date change is uniform writes only |
| Leaves lying on the grass and the boulevard | The lawn kind has fallen leaves in it, and each lot's boulevard (lot line to curb, found as for the boulders) has a ragged patch of them (kind 16): two layers of oriented elliptical leaves on jittered cells, yellow, orange, brown and the odd red, thicker in patches, from the colour's peak until the snow or the first of December. Not on the road: the road is another shared material |
| Drives in interlocking pavers | A drive is paved (kind 13) on 55% of Rosedale lots (70% of the grand ones): a running bond of 20 x 10 cm blocks along the house's own axes, joints, a tone a block (charcoal, grey, brown-grey, terracotta), snow on top, a mean colour past a few metres |
| Red Japanese maples in front yards in autumn | The ornamental tree is more often there (0.2 and 0.26 a lot, was 0.1 and 0.14) and nine times in seventeen a Japanese maple (was 4 in 12); its leaf cards (kind 15) are deep red in summer, **crimson in autumn**, then bare |

Pictures (same camera before and after, 22 October 2026): see the sheets in John's review folder (`slop-toronto-updates/2026-11-27-rosedale-streetscape/part2/`).

![Boulders, bags and leaves on Chestnut Park](images/rosedale-streetscape-p2-bags-close-fall.jpg)

![Roxborough Dr](images/rosedale-streetscape-p2-roxborough-street-fall.jpg)

![Chestnut Park boulevard](images/rosedale-streetscape-p2-chestnut-park-boulevard-fall.jpg)

### Cost of part 2

Mac mini (Apple M4) through `gpu2`, shared with a production transcription job (relative figures), 1600 x 900, uncapped, 20 s recordings at street level, main `fd070ee` (part 1 live) against part 2, alternated. Mean / median frame interval, ms, before -> after (budget +0.5 ms):

| Place | Date | Round 1 | Round 2 (after first) |
|---|---|---|---|
| Chestnut Park | 26 Nov (bare) | 19.13 -> 19.09 (-0.04) / 19.10 -> 19.10 | 19.10 -> 19.15 (+0.05) / 19.10 -> 19.20 |
| Crescent Rd | 26 Nov (bare) | 16.47 -> 16.33 (-0.15) / 16.50 -> 16.40 | 16.31 -> 16.34 (+0.03) / 16.30 -> 16.40 |
| Chestnut Park | 22 Oct (bags, leaves, maples) | 18.05 -> 18.07 (+0.02) / 18.00 -> 18.00 | |
| Crescent Rd | 22 Oct | 15.71 -> 15.81 (+0.10) / 15.70 -> 15.90 | |

![Chestnut Park, 22 October](images/rosedale-streetscape-p2-frame-time-chestnut-fall.png)

![Crescent Rd, 22 October](images/rosedale-streetscape-p2-frame-time-crescent-fall.png)

### Looked at and left

- **Street trees.** The page sizes a City street tree from its trunk diameter: 4 m + 0.28 m a centimetre, capped at 26 m, and the EZ-Tree model scales to that. Chestnut Park: 131 trees within 22 m of the road; 27 stand at the 26 m cap (diameter 79 cm or more), the median is about 16 m. In the frames they arch over the road as in the photographs; nothing changed. (The cap, not the scale, is what a 100 cm oak runs into; the data has no tree higher than 26 m.)
- **Hedges.** The lidar hedges (docs/front-yards.md) already put tall clipped hedges on lot lines; nothing changed.
- **Ivy on house walls**, **cars parked in drives** and **leaves on the road** were not done: ivy needs a per-house facade colour that follows the season (green in summer, red then bare), a parked car in a drive needs a place in the parked-car layout, and the road's leaves live in the shared road material another agent is changing.
- Snow on hedges and branches is already there (evergreens take a snow cap, deciduous shrubs and trees go bare and take snow on top).

## Part 3: the road's colour, the lawns, fallen leaves on the road (bead `jf-bv3`)

John's four complaints after part 2, with the two he chose first (the road and the lawns) done here; the lot lines and the road's shape are in the next section. The photographs are private and not in this repository.

### 1. Why the road was near black

Measured on the same Chestnut Park frame (22 October, overcast), the mean of a 400 x 200 patch of roadway: **John's photograph (83, 78, 78)** (a soft mid grey, lighter and a little patchy, leaves on it), the game **(11, 12, 14)**, Crescent Rd's road in the game (76, 82, 89).
So it is not the asphalt's albedo (a mid grey, `js/tsl-materials.js` `createRoadSurfaceMaterial`), and it is not wetness either: with the road's wetness set to 0.05 the patch went from 16 to 11 (a dry road is less glossy, not lighter). Turning the tree crowns out of the sky-occlusion map (`SkyOcclusion.setLeaf(0)`) took it to **53**.

The cause is `js/sky-occlusion.js`: while the trees are in leaf (`uLeaf` 0.5 or more) each crown is a solid disc in the height map reaching `CROWN_SHARE` = 0.65 of the tree's height. A 16 m street tree is a ceiling 10 m up over the road, and a road lined with them sees almost no sky: the same
reason the concrete walks under such trees came out near black (the boulevard frame). Trying shares of 0.65, 0.45, 0.3 and 0.2 on the same frame (road patch 11, 21 to 29, 44 to 46, 53) and radius scales of 0.7 and 1, the share is now **0.25**, about the height of a crown's underside:
the leaves still shade the street, but a roadway under them reads as a grey road (58, 65, 74 on the frame, from 11, 12, 14). The asphalt's two tones are also a few percent lighter (`0x4b4946` and `0x777571`, were `0x474542` and `0x716f6b`) and its patchy mottling a little stronger.
Downtown and the arterials have no crowns over them and move only by that lightening (see the pictures).

### 2. Fallen leaves on the road

Leaves lie on the asphalt from the colour's peak until the snow or the end of November (`leafFallSeason` in `js/tsl-materials.js`: a third of the year's fall while the crowns are still full, all of it once they are bare), oriented elliptical leaves in yellow, orange, brown and the odd red, a few on any street and
thicker under the trees. "Under the trees" is read from a new **crown cover** map (`crownCoverGrid`, `crownCoverNode` in `js/sky-occlusion.js`): the same 245,766 crowns as the sky occlusion's, as a soft 0 to 1 cover on a texel of 8 m, 3.3 MB, one texture sample; the road, the lawns and
the yards share it. The leaves are skipped outright beyond 30 m (45 m on a lawn), by a uniform test first, so a summer or a bare winter road pays nothing for them.

Along the way the yards' leaf code was fixed: it hashed the leaf cell's number whole, and at Rosedale's world coordinates (cells numbered in the millions) the GPU's sine returned something close to a constant for one of its two layers, so every cell of that layer held a small yellow dot: **a regular lattice of yellow dots over the lawns and the boulevard patches** (in the part 2 frames, and on the snow
frame before this PR). The one function, `leafScatter`, now serves the road, the plot ground, the lawns and the yards' litter, with the cell wrapped before it is hashed; its leaves are also bigger (about 10 to 17 cm long, they were 6 to 9) so they read at street level.

### 3. Lawns

`groundLawn` (`js/tsl-materials.js`) is the one lawn colour, used by the plot ground (the verges, boulevards and yards, `createPlotGroundMaterial`) and by the yards' lawn patches (`js/front-yard-material.js` kind 3), so a lawn and the ground beside it are one grass. It was two noises of the same two greens and read as a flat saturated green. Now:

- patches a few metres across, a little lighter or darker (a 0.77 to 1.23 factor), and sun-dried yellow patches;
- faint mowing stripes (4.5%, a 1.16 m wavelength, their direction changing from lot to lot), close up only (they fade out by 60 m);
- under a crown, while the trees are in leaf: 32% darker, and thin, a patch of the ground showing through (a brown);
- the autumn's leaves lying on it, thickest under the trees;
- the season's colours as before (`seasonalGrass`: dormant turf, spring's yellow-green), snow over all of it.

The crown map is read only while the trees are in leaf or the leaves lie (a uniform branch), so the bare winter lawn pays for the patches and stripes only.

## Pictures (part 3)

Same cameras before (origin/main `aca2514`) and after, on the Mac mini, 1600 x 900, no season preset: 22 October 2026 and 22 November 2026 with 6 cm of snow. Side-by-side sheets with John's photographs are in his private review folder (`slop-toronto-updates/2026-11-27-rosedale-streetscape-3/partA/`);
the pictures here are the game's frames only.

![Chestnut Park, 22 October: the road is a grey road under the trees, with leaves on it](images/rosedale-streetscape-p3-chestnut-park-fall.jpg)

![Leaves on the road, a lawn with patches and the shade of the crowns](images/rosedale-streetscape-p3-road-leaves-fall.jpg)

![A boulevard: the walk is no longer black under the trees, the dots are gone](images/rosedale-streetscape-p3-boulevard-fall.jpg)

![Roxborough Dr](images/rosedale-streetscape-p3-roxborough-fall.jpg)

![Chestnut Park, 22 November, snow](images/rosedale-streetscape-p3-chestnut-park-snow.jpg)

![Mount Pleasant Rd (an arterial) is unchanged](images/rosedale-streetscape-p3-arterial-fall.jpg)

### Cost of part 3 (road colour, lawns, leaves on the road)

Mac mini (Apple M4) through `gpu2`, shared with a production transcription job (relative figures, not budgets), 1600 x 900, uncapped, 20 s recordings at street level (the first 15% of each dropped), origin/main `aca2514` against this branch, alternated (every second run had "after" first).
Mean / median frame interval, ms, before -> after (budget +0.5 ms at street level):

| Place | Date | Run | Mean | Median |
|---|---|---|---|---|
| Chestnut Park | 22 Oct | 7 | 18.13 -> 18.26 (+0.13) | 18.10 -> 18.20 (+0.10) |
| Chestnut Park | 22 Oct | 8 (after first) | 18.08 -> 18.23 (+0.15) | 18.10 -> 18.30 (+0.20) |
| Crescent Rd | 22 Oct | 7 | 15.98 -> 16.00 (+0.03) | 16.00 -> 16.00 (+0.00) |
| Crescent Rd | 22 Oct | 8 (after first) | 15.79 -> 15.99 (+0.20) | 15.80 -> 16.00 (+0.20) |
| Chestnut Park | 26 Nov (bare) | 5 | 19.08 -> 19.31 (+0.24) | 19.10 -> 19.30 (+0.20) |
| Chestnut Park | 26 Nov (bare) | 6 (after first) | 19.14 -> 19.33 (+0.19) | 19.10 -> 19.30 (+0.20) |
| Crescent Rd | 26 Nov (bare) | 5 | 16.40 -> 16.50 (+0.11) | 16.30 -> 16.50 (+0.20) |
| Crescent Rd | 26 Nov (bare) | 6 (after first) | 16.35 -> 16.47 (+0.12) | 16.30 -> 16.40 (+0.10) |

Those are the final build. An earlier build of the same change (the crown map read on every lawn fragment, even in a bare winter) measured +0.13 to +0.20 in October and, in one of two bare-date runs, +1.1 and +0.7 (the other of that pair +0.2 and +0.1): the crown map
and the shade are now behind a uniform test that is false when the trees are bare and no leaves lie (`crownsMatter` in `groundLawn`). The extra ground work is one texture sample and about four noise lookups on a lawn fragment, and on a road fragment only the uniform test out of season.

![Chestnut Park, 22 October](images/rosedale-streetscape-p3-frame-time-chestnut-fall.png)

![Crescent Rd, 22 October](images/rosedale-streetscape-p3-frame-time-crescent-fall.png)

![Chestnut Park, 26 November (bare)](images/rosedale-streetscape-p3-frame-time-chestnut-bare.png)

### Reproduce

```sh
node --test tests/sky-occlusion.test.mjs tests/ground-mask-guard.test.mjs
SHOTS=tools/shots/rosedale-streetscape-3.json ARMS="beforeFall afterFall beforeSnow afterSnow" bash tools/capture-rosedale-streetscape.sh   # on the Mac mini through gpu2
FT=1 ROUND=1 ARMS="beforeFall afterFall" bash tools/capture-rosedale-streetscape.sh                                                  # frame times
```

## Part 3B: where the lot line is, and the curbs' bends (bead `jf-bv3`)

### 3. Walls and fences stood close to the curb

The yard's lot line was put **8.2 m from the OSM road's centreline** (`yd = distance to the centreline - 8.2` in `js/building-draw.js`). The kerb the page draws is the City's Edge of Roadway, not the OSM line, and the two are not on top of each other: along the
ray from the centreline to each of 3,382 Rosedale houses the kerb is a median **4.1 m** out (p10 2.5, p90 5.5), so a house's wall stood a median 4.1 m behind the kerb, **within 2 m of it on 5.6% of houses and within 1 m on 3.2%**.
The City's parcels say where the line really is (`build/rosedale-houses/lot-lines.py` in the shared data repo, registry record `slop-rosedale-lot-lines`): for the 2,568 houses whose line to the kerb leaves their parcel, the parcel's front line is a median **5.8 m behind the kerb**
(p5 3.1, p25 5.1, p75 6.5, p95 8.9, none under 0 and 1.8% under 2 m), and the house stands a median 5.4 m back from it.

What the page does now:

- **Rosedale houses** carry `lotYd`, the metres from the house to its parcel's front line (the houses file's new column, `tools/build-rosedale-houses.mjs`; +2.8 KB gzip), and `planHouse` puts the lot line there. A house whose line never leaves its parcel (476, lots that run to the kerb) takes its kerb distance less 5.8 m.
- **Every other house** (the citywide yards) has no parcel in the page; its lot line is 5.8 m behind the edge of its curb island, found by walking out from the front wall to the island's edge (`inp.onIsland`, `blockAt`), where it was 8.2 m from a centreline. A frame with no island under the house keeps the old rule.
- **Streets without a sidewalk get open lawn to the curb already:** of the 100 curb islands that carry Rosedale houses, 98 have City sidewalk polygons (the walk is drawn where the City maps one, the yard material runs to the kerb everywhere else), 1 is a verified no-walk island and 1 keeps the
  fixed 4.6 m band. Nothing was changed there.

![Chestnut Park, 22 November: the wall and fence, before and after](images/rosedale-streetscape-p3b-chestnut-park-snow.jpg)

![Walls and hedges pulled back from the kerb (aerial, bare trees)](images/rosedale-streetscape-p3b-lot-lines-aerial.jpg)

![Roxborough Dr: a hedge on the lot line, behind the boulevard](images/rosedale-streetscape-p3b-roxborough-street.jpg)

### 4. Road width and shape

**Width.** The road surface the page draws is the City's Edge of Roadway (the gap between the curb islands), not the OSM width, so the widths were already the real ones. Measured across the page's own islands every 6 m along each street's centreline, curb to curb: **Chestnut Park median 7.2 m** (p10 6.4;
183 samples), Roxborough Dr 7.6 m, Crescent Rd 7.5 m, Elm Ave 8.2 m, Glen Rd 8.5 m; the 90th percentiles are the junction mouths. John's "about 6 to 7.5 m" is what the data gives. Nothing was widened or narrowed.

**Shape.** The curbs were the problem: a curb island's outline is the City's polygon traced from a 1 m raster and simplified, so a bend is a chain of straight pieces. Around Chestnut Park (8 islands, 92 points) the median piece is **9.4 m** (p10 4.3 m, p90 26 m) and the turn at a joint a median **15 degrees** (p90 29), which read at
street level as a polyline. The OSM centreline there is 2 or 3 points a piece and would not help (it is a chord across the bend).

`js/curb-smooth.js` puts a curve through the same points for the islands of the Rosedale pilot's box (x 240 to 2380, z -4680 to -2900): a cubic Hermite piece between each pair of neighbours, the tangent at a point along the bisector of the two pieces that meet there (half the piece's length, so a curve through points 20 m apart sags by
a few decimetres), cut into pieces of 3 m at most. It passes through every original point, keeps a corner (a turn of 50 degrees or more) sharp, leaves straight stretches alone, leaves a piece over 28 m as traced (those are park and ravine outlines), and never strays more than 1 m from the City's outline (the 114 islands of
the box: 3,937 outline points become 11,600). `city-config.js` smooths `BLOCKS` only, so everything that reads the island (the ground, `blockAt`, the walkers' floor, the kerbs, the yards' curb walk) agrees; the raw `GEO.blocks` stay as the City's, which the sidewalk polygons' key is made from. `?smoothCurbs=0` keeps the traced outline.

![Chestnut Park's bend from 55 m up, bare trees: the curb is a curve](images/rosedale-streetscape-p3b-bend-aerial-chestnut-park.jpg)

### Pictures (part 3B)

Same cameras before (origin/main `6b748c5`, part 3A live) and after, 1600 x 900 on the Mac mini; the sheets with John's photographs are in his private review folder (`slop-toronto-updates/2026-11-27-rosedale-streetscape-3/partB/`).

### What is still wrong (part 3)

- The lot line is the parcel's front line toward the nearest road polygon; for a corner lot that can be the side street, and the wall still follows the street the house faces.
- Which lots have a wall, a fence or a hedge on the line at all is the style rule's draw (no data exists); John's photographs show many open lawns where the rule draws a stone wall.
- Only the Rosedale pilot's curbs are smoothed; the rest of the city's bends are still chains of straight pieces.
- The road's tint under overcast is cooler than the photograph's (the sky's ambient); the wheel paths are not drawn.

### Cost of part 3B (lot lines, smooth curbs)

Mac mini (Apple M4) through `gpu2`, shared with a production transcription job (relative figures), 1600 x 900, uncapped, 20 s recordings at street level (the first 15% dropped), origin/main `6b748c5` (part 3A live) against this branch, alternated (runs 2 and 4 had "after" first).
Mean / median frame interval, ms, before -> after (budget +0.5 ms at street level):

| Place | Date | Run | Mean | Median |
|---|---|---|---|---|
| Chestnut Park | 22 Oct | 1 | 18.21 -> 18.45 (+0.24) | 18.20 -> 18.40 (+0.20) |
| Chestnut Park | 22 Oct | 2 | 18.35 -> 18.54 (+0.19) | 18.40 -> 18.50 (+0.10) |
| Crescent Rd | 22 Oct | 1 | 16.37 -> 16.37 (+0.00) | 16.40 -> 16.40 (+0.00) |
| Crescent Rd | 22 Oct | 2 | 16.59 -> 16.43 (-0.16) | 16.50 -> 16.40 (-0.10) |
| Chestnut Park | 26 Nov (bare) | 3 | 19.55 -> 19.49 (-0.06) | 19.60 -> 19.50 (-0.10) |
| Chestnut Park | 26 Nov (bare) | 4 | 19.32 -> 19.48 (+0.16) | 19.30 -> 19.45 (+0.15) |
| Crescent Rd | 26 Nov (bare) | 3 | 16.66 -> 16.92 (+0.26) | 16.70 -> 17.00 (+0.30) |
| Crescent Rd | 26 Nov (bare) | 4 | 16.45 -> 16.93 (+0.47) | 16.50 -> 16.90 (+0.40) |

Every pair is inside the budget; Crescent Rd on the bare date is the nearest to it (+0.26 and +0.47). The new work is the smoothed curbs' extra ground triangles (the 114 islands' outlines go from 3,937 points to 11,600, once at load) and, per house, a walk of up to 60 steps of `blockAt` at plan time.

![Chestnut Park, 22 October](images/rosedale-streetscape-p3b-frame-time-chestnut-fall.png)

![Crescent Rd, 26 November (bare), after first](images/rosedale-streetscape-p3b-frame-time-crescent-bare.png)

### Reproduce (3B)

```sh
uv run --with numpy --with shapely --with pyproj python3 build/rosedale-houses/lot-lines.py   # in the shared data repo: lot-lines.json
node tools/build-rosedale-houses.mjs "$TORONTO_DATA_CACHE/derived/rosedale-roofs/1/roofs.json" "$TORONTO_DATA_CACHE/derived/rosedale-houses/1/houses.csv"   # data/frames/eglinton/rosedale-houses.bin
node --test tests/rosedale-lot-lines.test.mjs tests/curb-smooth.test.mjs
SHOTS=tools/shots/rosedale-streetscape-3b.json ARMS="beforeBare afterBare beforeSnow afterSnow" bash tools/capture-rosedale-streetscape.sh   # on the Mac mini through gpu2
```
