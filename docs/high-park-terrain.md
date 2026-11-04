# High Park terrain pilot

Pilot · 2026-11-02 · On by default since 2026-11-03 · Bead `st-6w4r` (found in the High Park audit, `st-us0w`) · Builds on the
[Don Valley pilot](don-valley-terrain.md), whose machinery it shares.

The detailed city is one flat street level, so High Park was flat: Grenadier Pond (since PR #78) lay 0.9 m under its
lawn inside a brown earth wall, and the 60 m SRTM terrain grid poked 3–21 m canopy mounds through the lawn as grey-green
blotches. This pilot puts the park on its real ground from the province's 2023 lidar: the plateau, the slope down to
Grenadier Pond, the Spring Creek and Wendigo ravines, each pond at its own level, and the park's roads, buildings,
traffic, walkers and players on it. The streets round the park stay at the street level.

**It is on by default, with no URL flag** (John's call, 2026-11-03). `explore.html` always loads
`js/high-park-data.js` and the pilots' runtime `js/don-valley.js` before `city-config.js`; `?donvalley=1` adds the Don
Valley's data before them. Outside the park's box every code path reduces to the flat city's: `tests/high-park.test.mjs`
holds the city round it to the flat city to the bit (ground, cuts, decks, the walking floor in every mode, arrivals,
the traffic's edges, the City's poles), and `tests/boot.test.cjs` the scripts loaded (§3).

## 1. Source, frame and datum

| Item | Value |
| --- | --- |
| Source | Ontario Elevation Mapping Program, **GTA 2023 lidar, Digital Terrain Model (bare earth)**, 0.5 m, 16 one-km tiles (`node tools/fetch-don-valley-dtm.mjs --region high-park`, into `~/.cache/slop-toronto/raw/ontario-dtm-gta2023`, manifest `manifest-high-park.json` with SHA-256s) |
| Rights | Open Government Licence – Ontario; credited in [CREDITS.md](../CREDITS.md) |
| Box | x −7200…−5760, z −2940…−1080 (Ellis Avenue to Parkside Drive, Bloor Street to the Queensway), aligned to `terrain.js`'s 60 m near grid |
| Grid | 10 m, 145 × 187 nodes; each node the mean of the lidar's pixels in its 10 m cell |
| Game height | y = DTM − T, metres over the local street datum T |

**The datum.** The flat city's y = 0 has to be every street round the park, and those streets are not level: Bloor
Street at the north gate is 111–113 m above CGVD2013, the Queensway at the south gate 77 m, Parkside Drive 95–110 m,
Ellis Avenue 78–95 m. So the park's 37 m fall from Bloor to the Queensway cannot show (it is in the datum, as the whole
flat city's fall to the lake is). T is:

- outside the park: the DTM itself (y = 0: every street, kerb and house round the park unchanged);
- inside it: the smoothest surface meeting those streets, a membrane (Laplace's equation, solved by over-relaxation,
  residual 1e-4 m), with the DTM round the park as its boundary;
- held level across each pond (a pond is one node of the membrane): a pond near the streets round the park takes the
  lowest of them within 80 m (so no shore rises higher than it really does), with every pond's water at least 0.3 m
  under it; ponds within 250 m and 2 m of each other's level share one datum, so their real difference is kept and
  water never stands higher downstream (Grenadier and Wendigo; the Upper and Lower Duck Ponds; Howard and Ridout).

What the player sees is the park's relief over the streets round it. The DTM's numbers at reference places, and the
game's heights:

| Place | DTM (m) | Game y (m) |
| --- | --- | --- |
| Bloor Street at the Colborne Lodge Drive gate | 111.2 | 0 |
| The plateau: the pool and rink / Dog Hill / the Grenadier Café | 107.8 / 104.2 / 105.0 | +16.7 / +17.4 / +23.5 |
| Grenadier Pond's water (lidar, hydro-flattened) | 75.8 | −1.6 |
| The east slope above the pond | 91.5 | +12.2 |
| The Spring Creek ravine's floor (east of Centre Road) | 85.1 | −4.9 |
| Howard Pond / Ridout Pond (by Parkside Drive) | 86.4 / 85.2 | −13.7 / −14.9 |
| Upper / Lower Duck Pond (by the Queensway) | 76.1 / 75.6 | −1.6 / −2.2 |
| Colborne Lodge | 90.0 | +12.2 |
| The Queensway at Colborne Lodge Drive | 77.1 | 0 |

The slope from the café down to Grenadier Pond is 25 m in the game, 29 m in reality; the ravines are 15–30 m under the
plateau beside them. The plateau stands up to 26.6 m over the street level and the lowest ground, the Spring Creek
ravine by Howard Pond, 16.4 m under it.

`js/high-park-data.js` keeps the grids apart, as the Don Valley's does: `raw` (the DTM), `datumGrid` (T),
`unconditioned` (DTM − T in the park) and `height` (what the game uses), with every rule in `alterations` and the
review numbers in `diagnostics`. `node tools/build-high-park.mjs` rebuilds it byte for byte from the tiles (tested when
they are present).

### Conditioning rules, in order

| Rule | What it does | Recorded |
| --- | --- | --- |
| park | The park's curb islands (`GEO.blocks` named High Park: 239, 240, 325, 383, 393, 752, 755, 857, 864, 989) and the houses' own island inside Grenadier Heights' loop (1006), on a 2 m raster, closed over 12 m (the park roads between them), with whatever they enclose (a traffic island in Colborne Lodge Drive); and Catfish Pond (OpenStreetMap's West Pond, two parts) with 40 m round it on Rennie Park's island across Ellis Avenue. The houses on the islands (OpenStreetMap's residential land: the strip between Ellis Avenue and Grenadier Pond, Ellis Park Road, the flats by Bloor Street) are on the terrain | 182 ha, 10.6 ha of it houses, 5.1 ha round Catfish Pond |
| datum | The membrane above, the ponds level. Then the bluff: along Ellis Avenue the houses stand on a ridge 20 m over Grenadier Pond, level with the street, and under the membrane alone the datum there rode Ellis Avenue's height (the bluff came out 5–8 m). Among the houses within 220 m of the pond the datum comes 70% of the way down to the pond's, so the bluff stands 13–15 m over the water (its real 20 m, less the 30%) and the houses step up to it from Ellis Avenue | 297 sweeps; 1,511 nodes brought down; pond groups and their datums |
| edge | The relief fades in from the park's kerbs: 0 for 8 m (the sidewalk and verge), full from 45 m (smoothstep); among the houses (by their share within 60 m) full from 110 m, so they step up from Ellis Avenue over the width of the strip | |
| shores | Each pond's grid nodes at its level (its bed 1.5 m under, a 15 m shelf at the waterline inside its outline, so the drawn ground meets the water at the outline); the ground within 60 m (fading to 100 m) never under its water, and within 30 m no steeper than a 35% bank up from it (no earth wall over the water) | 854 samples filled up to 6.3 m, 158 cut up to 4.8 m |
| pads | The tennis courts and pads, the rinks, and the ball diamonds level at their mean; pads within 15 m of each other (a club's courts, the rink's two pads) at one level. Every node within 14.5 m of a pad takes it, so the pad is exactly level (any grid triangle reaching into it has its nodes that close), blending back over the next 12 m; the roads leave those nodes alone. Without it the slopes rejected 3 of the park's tennis courts and 2 of its rink pads (`grade`) | 23 pads in 5 levels, up to 6.5 m |
| roads | Each park road's profile from the 0.5 m lidar along its centreline (the median of three pixels across it) over the datum, smoothed over 45 m; its roadway level across, blending back over 12 m; the nodes of every grid triangle reaching the roadway or its kerbs (to 1 m past the road's half width) at the profile of their nearest point on it, so the kerbs run straight, and the ground round a node so held that moved laid back to no steeper than 70% (a cut bank above the road, a fill below it); then the grid fitted to it under each station away from junctions and the edge (by 2 m at most a node). The 10 m grid's cell means take in the banks beside a road cut into a hillside: they had made Colborne Lodge Drive 20% where the lidar says 7%. Among the houses (the strip along Ellis Avenue) only the blend, as first built | 39 roads, 966 nodes held to the kerbs, 50 laid back (up to 7.1 m), fit within 0.19 m |
| footing | Each building on the relief stands on the highest ground under its footprint, a concrete plinth down to the lowest | 158 buildings (the strip's houses among them), 143 plinths, deepest 6.0 m |

## 2. One surface, two pilots

The Don Valley pilot's runtime (`js/don-valley.js`) now carries any number of pilots, each with its own box and grid,
and publishes one surface as `window.CITY.DON_VALLEY` (the name every reader already asks for). `heightAt`,
`gradientAt`, `inBox`, `reliefUnder`, `lowestAround` and the new `highestAround` answer for whichever pilot's box
(x, z) is in. The Don Valley's decks, ramps, river, platforms and terrain patch are its own; High Park has no decks, so
a raised road in its box (the Gardiner, the Queensway's ramps) keeps its height (`decksAt`). With `?donvalley=1` each
surface is exactly what it is alone (tested).

| Consumer | How it follows the park |
| --- | --- |
| Street level, curb islands, kerbs, walks, lawns, park paths, streams, road markings (`CityGround`) | `drape()`: each pilot splits the static ground along its own grid; exact (tested under 1 mm). With `?donvalley=1` the Don Valley drapes first and High Park then drapes its pieces in its box. The output is indexed. A face lying flat (a lawn, the street level) is lit by the surface's smooth slope (each node's by central differences, interpolated over the grid's triangles), so the 10 m facets and the seams between them are gone; its pieces that fill a grid half cell between them (one plane: one height and every attribute the same affine function of x and z) are drawn as that half cell, one triangle whose corners its neighbours share. A half cell lying wholly inside a source triangle is taken whole without clipping. Kerbs, walls and other faces keep their own sheared normals. The Don Valley's drape gets the same |
| Ponds | `city-grid.js` asks `pondLevel(w)`: a pilot pond is drawn level at its own height (`PilotPond`, not draped) and gets no brown wall; the pilot draws a low earth bank from the ground at its outline down under the water (`HighParkPondBanks`). The shores rule makes the ground meet the water, so a few centimetres show where the flat city showed 0.9 m |
| Walking floor, cycling, driving | `getGroundHeight`: in a pilot's box the pilot's ground counts over the street level too (High Park's plateau); out of it as before |
| SRTM canopy mounds | Gone: `terrain.js` leaves High Park's box out of its near grid (and sinks it in `terrainNearHeightAt`, so the rinks build no retaining walls to a mound), and `terrainHeightAt` is 0 there |
| Traffic, buses, routes, arrivals | The street graph's node heights (`roadHeight`) and `edgeY` follow the ground between nodes (the Don Valley's `edgeSurface`); `streetArrival` lands on a park road at its ground |
| Pedestrians | `cutAt` per foot, as before |
| Trees (City and generated), poles, lights, benches, signs, Bike Share, tennis, rinks, public art, patios | `cutAt`. Trees and the cycle tracks had clamped it to 0 or under (`Math.min(0, cutAt)`): no longer (`roadCutAt` is never over 0, so nothing changes without a pilot) |
| Buildings | `buildings.js` stands each on `buildingBase(x, z)` (its boxes, roofs, colliders, fire escapes, air conditioners, dishes; the massing polygons too); `storefront-signs.js` lifts its signs with it; the plinths are the pilot's (`HighParkPlinths`) |
| Parked cars | A car where the ground leaves the street level (over or under it) is left out, as in the Don Valley |

## 3. On by default

The pilot was first built behind `?highpark=1`, with the recommendation to keep it there until John had seen the datum
(§4) and the cost (§5). On 2026-11-03 John had it shipped on by default, with no flag (PR #79), and the Grenadier
Pond west bank at its 13–15 m (§4). Smoother lawns and the Ellis Avenue bluff's full height stay follow-ups, with the
woods (`st-8g3r`); the park's features (`st-5yps`) are [their own](high-park-features.md).

With the pilot's runtime always loaded, `window.CITY.DON_VALLEY` always exists, so every reader that asked only
whether a pilot was on was checked for what it did outside the box. Four did something city-wide, and now keep the
flat city's path outside High Park's box (with `?donvalley=1`, as before, city-wide):

- `streetArrival` (`city-config.js`): with any pilot it scored the nearest streets by `cutAt` and returned `y = 0` for
  the street level instead of `null`. Outside the box it is now the flat city's arrival (1,326 of 2,000 sampled
  arrivals had changed).
- `deckHeightAt` (`city-config.js`): a deck under the street level counts only with the Don Valley's pilot (High Park
  has no decks of its own).
- The wire spans between the City's poles (`mapped-poles.js wireSpanMatrix`) shear to the second pole's foot only for
  a span with a pole in a pilot's box (or with `?donvalley=1`, every span, as before): elsewhere a span across a road
  cut's step stays level, as it was.
- The bikeways (`cycling.js prepare`): with any pilot every line's posts, separators and paint took the ground at their
  own spot (`yAt`) rather than along the line, which moved them on road cuts' banks across the city. Now only a line
  reaching a pilot's box does.

The rest read the surface through `inBox`, `heightAt` (0 outside the boxes), `clearsTerrainAt`, `pondLevel` or
`buildingBase` (both `null`/0 off the park), and the drape works only in the box. On the Mac mini the static scene
outside the box (100 m clear of it) is identical to main `954d923`'s, desktop and phone: every mesh's triangles, area
and heights, every instance's matrix (2.1 M triangles and 306 k instances on desktop); only the moving trains,
streetcars and traffic differ. The CaféTO patios' prebuilt layout
still holds with the pilot on (its fingerprint is unchanged: "prebuilt layout" at startup, not the runtime layout).

## 4. Limits and open questions

- **The regional fall is not shown.** Every street round the park is y = 0, so Bloor Street (111 m) and the Queensway
  (77 m) are level with each other. The park's plateau, in reality 5–9 m under Bloor and 25–30 m over the Queensway,
  stands 0–5 m over the street level near Bloor and up to 26 m over it towards the Queensway. Showing the fall needs
  terrain in the neighbourhoods round the park (a larger pilot, or the city as a whole).
- **Edges.** Where the park's slopes meet a street, the edge band steepens them (up to twice the lidar's own slope): the
  Wendigo ravine's head under Bloor Street, the west rim of the Spring Creek ravine along Parkside Drive. Sidewalks on
  the park's side of a perimeter street lie within 0.35 m of the street level (0.7 m beside Lower Duck Pond, which lies
  2.2 m under the Queensway just inside its kerb).
- **Grenadier Pond's west bank** stands 13–15 m over the water (the real bluff is 20 m from the ridge the houses stand
  on). Ellis Avenue is at the street level, so the houses step up 10–12 m from it to the bluff's top over the strip's
  width (their streets, Grenadier Heights and Woodland Heights, climb at up to 20%; the lidar's own 10–16%).
- **Spring Creek runs uphill** in the game's frame: Howard and Ridout Ponds by Parkside Drive are 14 m under the street
  level, the Duck Ponds by the Queensway 2 m under it, because the datum falls 22 m between them and the creek only 10 m
  (the Don's problem too, `st-051`). The stream ribbons are draped on the ravine's floor.
- **Steep cells.** The steepest 10 m cells are 93% (the lidar's own reach 66% there): the plateau's west edge above the
  pond and beside the roads' levelled corridors.
- **Kerbs on the slopes** (`st-eki4`). Held level only to 2 m past its kerbs, a road crossing the 10 m grid aslant on a
  hillside had its kerbs in triangles that took the bank's nodes in proportions changing cell by cell: Colborne Lodge
  Drive's kerb on its climb from the Queensway waved by up to 1.9 m over 10 m, 0.8 m off the roadway's level. Every
  triangle reaching a kerb is now level with the road, so the road has a level shoulder of up to one cell (0–14 m) and its
  bank begins beyond it, laid back to 70% at most (62 nodes moved over 2 m, the most 8.6 m on the plateau's edge by the
  café, where Colborne Lodge Drive runs along the top of the slope to Grenadier Pond). The park roads' kerbs now keep
  within 0.04 m of their roadway's level, except where a pad holds the ground beside the road (the rink and pool's pads,
  1.4 m under the service drive beside them), and on the houses' streets in the Ellis Avenue strip, left as they were
  (Grenadier Heights' kerb stands up to 0.8 m off its roadway, `tests/high-park.test.mjs`).
- **Steep connectors** (`diagnostics.roads`, review over 12%): Howard Park Avenue's spur into the park (12.6%, its own
  3.8% in the lidar), Colborne Lodge Drive's climb from the Queensway (12.6%, the lidar's own 12.0%).
- **Not modelled:** the creeks' channels (the 10 m grid smooths them) and the woods (`st-8g3r`). Catfish Pond is in,
  at its own level beside Grenadier Pond's; the rest of Rennie Park's island stays at the street level.

## 5. Cost

Measured on the Mac mini while it was shared (functional evidence, not a budget; `tools/shots/high-park-terrain.json`
`check` and the console's drape line). Three builds: the flat city (`fix/high-park`, flag off), the pilot as first
opened in PR #79 (`6b6727d`, `?highpark=1`), and this revision (`?highpark=1`, the park 16 ha larger: the strip along
Ellis Avenue and Catfish Pond):

| | Flat city | PR #79 first | This revision |
| --- | --- | --- | --- |
| Data (`js/high-park-data.js`, loaded on every visit) | | 302 KB (120 KB gzip) | 307 KB (126 KB gzip, 84 KB Brotli) |
| Drape: pieces cut | | 329,779 | 142,592 |
| Drape: triangles / vertices drawn | | 794,492 / (not recorded) | 234,331 / 403,621 |
| Drape time, desktop / phone | | 537 / 500 ms | 358–409 / 408 ms |
| Ready after, desktop / phone | 11.9 / 11.6 s | 12.6 / 12.2 s | 12.3 / 12.2 s |
| Triangles per frame (the park in view), desktop | 7.21 M | 8.77 M (+1.56 M) | 7.63 M (+0.43 M) |
| Triangles per frame, phone | 3.70 M | 4.45 M (+0.76 M) | 3.90 M (+0.21 M) |
| JS heap, desktop / phone (noisy: one sample after the shots) | 1,056 / 982 MB | 1,144 / 1,046 MB | 1,028 / 809 MB |

What cut it:

- **Flat layers by the half cell.** A lawn's or the street level's pieces that fill a grid half cell between them are
  one triangle there, its corners shared with its neighbours' (47,872 whole half cells).
- **Hidden layers left out.** A flat layer's half cell under another opaque layer's whole one a little over it is not
  drawn: the street level under the curb islands, the kerbs' top caps under the islands' lawns (57,792 half cells).
- **Undersides left out.** The kerbs' and slabs' bottom faces at the ground, facing down, which nothing can see on the
  relief (1,718 source triangles, which had made most of the kerbs' pieces).
- A half cell lying wholly inside a source triangle (the street level's big triangles) is taken whole, without
  clipping; the pieces are indexed.

The rest is the islands' edges (pieces along every kerb and lawn outline) and the vertical faces.

## 6. Verification

`tests/high-park.test.mjs`: the source and grids; the datum at Bloor, the Queensway and the café; the relief (plateau,
slope, ravine, Colborne Lodge); the edges (every perimeter street's roadway at 0, its sidewalks, the transition no
steeper than twice the lidar); the ponds (each matched, the real order of neighbours, under the streets, shores never
under the water); drawn = sampled; both pilots at once; `cutAt`, the walking floor in every mode, arrivals and routes;
the canopy mounds gone; traffic lanes and turns within 0.1 m of the ground; trees, cycling and parked cars; buildings
and plinths and pond banks; road grades; a byte-identical rebuild; outside the box, the flat city's ground, cuts,
decks, walking floor, arrivals, traffic edges and poles to the bit. `tests/boot.test.cjs`: the scripts, High Park's
always and the Don Valley's with its flag.

Captures (`tools/shots/high-park-terrain.json`, the Mac mini, desktop and phone, golden hour and midday; before is
`fix/high-park`, PR #78, after is this branch with `?highpark=1`): an aerial from the south and a lower one, Grenadier
Pond from its east slope, the Spring Creek ravine's floor, Colborne Lodge Drive climbing from the Queensway, the Bloor
Street gate, the Queensway edge, and the player on the slope. All steps pass on both. On the slopes 23–26 park cars are
within 0.11 m of the ground (the worst a body between two axles on Colborne Lodge Drive's crest), walkers' feet on it,
the player on the slope at its ground (11.2 m), the café's ground 23.7 m, the ravine's −4.7 m, both gates 0. All 43
tennis courts and 16 rink pads place (without the pads rule the slopes rejected 3 and 2). Without the pilot, ground,
cuts, decks and arrivals were identical to `fix/high-park` at 20,000 random points; on by default, the same
holds outside the box against main `954d923` (20,000 points, every traffic edge and pole there, and the scene's static
geometry: §3).
