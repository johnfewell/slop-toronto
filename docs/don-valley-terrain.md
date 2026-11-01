# Don Valley terrain pilot: datum and surface migration contract

Design, contract and pilot · 2026-10-30, lidar 2026-10-31 · Beads `st-wt0.20` (design), `st-wt0.21` (pilot),
`st-wt0.21.4` (lidar floor, Rosedale ravine), `st-wt0.21.2` (ramp profiles), `st-wt0.21.1` (arrivals), `st-wt0.21.3` (between points), `st-051` (river) · Spec
§11 TE (an internal planning document, not published here)

Without a valley, the Prince Edward Viaduct crosses flat ground. Its road deck is a 22.5 m flyover, and Castle Frank and
Broadview stations sit at the deck's level ([subway topology](subway-topology.md#station-depths-and-levels)). This pilot
puts the real Don Valley under the viaduct from the province's 2023 lidar. The road deck is level with the street, the
subway's lower deck hangs 5.8 m under it, and both stations' platforms are below the street at depths derived from the
lidar.

**It is behind a flag.** `explore.html?donvalley=1` loads `js/don-valley-data.js` and `js/don-valley.js` before
`city-config.js`. Without the flag neither script is fetched and every code path below reduces to the code on `main`
(`tests/don-valley.test.mjs`, `tests/boot.test.cjs`). It is a developer pilot, not a production region.

## 1. Sources, frame and datum (TE-1)

| Item | Value |
| --- | --- |
| Source | Ontario Elevation Mapping Program, **GTA 2023 lidar, Digital Terrain Model (bare earth)**, 0.5 m, 16 one-km tiles from the Ontario GeoHub image service `Elevation/Ontario_DTM_LidarDerived` (`tools/fetch-don-valley-dtm.mjs`, into `~/.cache/slop-toronto/raw/ontario-dtm-gta2023`, with a SHA-256 manifest) |
| Rights | Open Government Licence – Ontario; credited in [CREDITS.md](../CREDITS.md). No Kazan, Swiss or Spanish height data. |
| Horizontal frame | The geodata's world frame: a WGS84 tangent plane at Union Station, turned −16.59° (`GEO.frame.projection`); x east along the grid, z south. The DTM's NAD83(CSRS) / UTM zone 17N (EPSG:2958) is reached through `latLonFromWorld` and a UTM projection; NAD83(CSRS) and the OpenStreetMap frame differ by about 1.5 m, under the 10 m grid |
| DTM vertical datum | Metres above CGVD2013 (EPSG:6647). A constant offset from any other datum cancels in DTM − T |
| Game vertical datum | Metres above the **local street datum** T(x, z). The flat city's y = 0 is T everywhere. |
| Grid | 10 m, 121 × 193 samples over x 1600…2800, z −3800…−1880; aligned with `terrain.js`'s 60 m grid. Each node is the mean of the lidar's pixels in its 10 m cell (100 one-metre sub-samples) |

**Choice of source.** In the brief's order:

1. **City of Toronto Open Data** has no raster DTM. Its "Triangular Irregular Network (TIN)"
   (`triangular-irregular-network-tin`, Open Government Licence – Toronto, NAD83(CSRS) MTM 10, CGVD2013) is derived
   from the same 2023 lidar at 2.5 m. It is a 188 MB city-wide shapefile of polygons that carry only an average
   elevation. That is coarser, and stepped, where the provincial raster is the lidar at its full resolution. The
   City's topographic layers (contours, spot heights) are not published openly.
2. **Ontario Elevation Mapping Program**: the GTA 2023 project covers the whole pilot at 0.5 m, bare earth, in 1 km
   tiles (horizontal accuracy 0.3 m). It is used.
3. **NRCan HRDEM** (1–2 m, Open Government Licence – Canada) re-serves provincial and municipal lidar. It was not needed.

The SRTM build it replaces (AWS Terrain Tiles, about 20 m, a surface model) made the valley about 4 m shallower
(35.1 m under the deck, against 39.5 m now). It read trees and the viaduct's own deck as ground, and blurred the
river and the Parkway's bench.

**Mapping.** The game height is the DTM elevation minus the street datum:

```text
y(x, z) = DTM(x, z) − T(x, z)
T = DTM, opened over 30 m (narrow bumps removed), closed over 400 m (the valley filled
    from the tableland either side), box-blurred twice over 150 m
```

T follows the tableland: 114.3 m above CGVD2013 at both of the viaduct's ends. The Don under the viaduct is 75.2 m in
the lidar, so it lies 39.1 m below the street. A constant offset could not give both rims y = 0 while the tableland
falls toward the lake. T does, by construction.

Across the tableland as a whole, T sits on the ground (the median of T − DTM is −0.1 m). Beside the valley it rides
the rims' upper envelope, about 0.8 m over Bloor Street at the viaduct's ends and 1.4 m over Castle Frank's corner.
The shallow knee (§1 rules) flattens that to the street. So the game's deck, 0.4 m over T, is about 0.6 m higher
over the river than the lidar's (§6).

**Raw and conditioned stay separate.** `js/don-valley-data.js` keeps four grids:

- `raw`: the DTM as sampled (the cell mean);
- `datumGrid`: T;
- `unconditioned`: the DTM minus T;
- `height`: the conditioned surface the game uses.

`alterations` records every conditioning rule, the number of samples it changed and the largest change.
`diagnostics` holds the review numbers in §6. `node tools/build-don-valley.mjs` rebuilds the data file byte for byte
from the tiles (`DON_VALLEY_DTM`, default `~/.cache/slop-toronto/raw/ontario-dtm-gta2023`). It refuses a tile whose
SHA-256 differs from the manifest, and the rebuild is tested when the tiles are present. `tools/tiff-f32.mjs` reads
the tiles: float32 GeoTIFF, LZW or Deflate, with no dependency.

**Size.** `js/don-valley-data.js` is 277,253 bytes (109,847 gzipped, 87,764 with Brotli). The lidar build was 222,000
(87,012 and 71,314), the SRTM build 190,308 (80,377 and 64,772). The ramps' profiles (rule 8) add about 20 KB, and
extending the box 300 m north adds about 30 KB.

### Conditioning rules, in order

| Rule | What it does | Recorded |
| --- | --- | --- |
| bridge | Not needed. The DTM is bare earth: the lidar's ground class has no viaduct deck, so the floor under the viaduct is surveyed (or the survey's own interpolation under the deck). | 0 samples |
| shallow | Depths under 1 m are street level, full depth from 6 m (a smooth knee). The tableland's relief under the smoothed T is not the valley. | (in `unconditioned` vs `height`) |
| cover | The Line 2 tunnels west and east of the viaduct keep their cover (held at street level within 10 m), and so do both stations (within 90 m). | 302 samples |
| ravine | The Rosedale ravine leaves the box under the subway's covered Rosedale Valley bridge. The flat city keeps that bridge at street level over Rosedale Valley Road's 7.2 m road cut. Beyond the bridge, on the valley's side, the ground (with the cut) goes no deeper than the cut's floor plus 5% of the distance from the bridge. This fades out 300–450 m away. On the flat city's side the ground stays at street level (§4). | 128 held, 455 capped, up to 24.4 m |
| roads | Each road on the valley's ground gets a profile smoothed along it (60 m window). The roadway is level across and blends back over 12 m. Where corridors meet, their profiles blend. Ramps are decks and do not shape the ground. | 2,064 samples, up to 17.1 m |
| portals | The ground in front of the two tunnel portals is lowered below the portal floor (y −6.0). | 6 samples, up to 6.2 m |
| boundary | The surface tapers to 0 at the box's edges (§4). | taper distances |
| river | Rule 9: the Don's water level for each row of the grid, from the city's edge south: one level across, 0.7 m under the channel's lowest ground, never falling going south, and the flat city's −0.7 m at the box's south edge. | 113 rows, −40.4 m to −0.7 m, steepest rise 7.9% |
| decks | The ramps down the valley's sides get vertical profiles from the 0.5 m lidar along their OpenStreetMap alignment (§6). Where the 10 m grid's ground stands above a ramp's profile, it is cut down to 0.35 m under it. The viaduct's Rosedale section is level with the street, and the flat city's flyovers that climbed onto it are back at the street. | 21 ramps, 306 samples cut, up to 4.7 m; 5 flyovers flattened; 8 junctions recorded |

**Footing (TE-5).** Buildings keep their street-level base (y = 0) and their colliders. Where the valley falls away
under a footprint, the runtime adds a concrete plinth from the lowest ground under it up to the base. Nothing is
terraced, so the slope stays the DTM's. There are 20 plinths, the deepest 10.2 m. The SRTM build had 65 plinths, as
deep as 16.8 m: its blurred slopes ran under the blocks on the west rim. No multipart building gets a base from an
unrelated part.

## 2. One surface for drawing and sampling (TE-2)

`DON_VALLEY.heightAt(x, z)` (`js/don-valley.js`) is the only height function. It interpolates the grid on triangles,
splitting each 10 m cell along its b–d diagonal exactly as `terrain.js` does (`terrainNearHeightAt`).

- **Sampling.** `city-config.js` folds it into `cutAt`. The old road cuts stay available as `roadCutAt`, the
  semantic test for trees, rail bridges, the subway's covered box and the cut geometry. Every `cutAt` reader follows
  the valley: the walking floor (`getGroundHeight`), street props, mapped poles, street lights, trees, pedestrians'
  walking heights, Bike Share, tennis, rinks, wayfinding, public art and patios.
- **Drawing.** `drape()` splits each static ground triangle in the box along the grid's column, row and diagonal
  lines. Each piece lies in one grid triangle, so the drawn surface equals `heightAt` exactly. The test bounds the
  disagreement at under 0.001 m; TE-3's limit is 0.03 m. Normals are sheared with the surface. Vertical faces are
  split along their length too, so kerbs and walls stay on the valley. A triangle over only the box's flat cells (all
  four corners at 0, 37% of the cells) is left whole. `heightAt` is exactly 0 there, so nothing needs splitting
  (`reliefUnder`, a summed-area table).
- **Decks are separate from bare earth.** `deckHeightAt` keeps its grid and its yHint/step reach. In the pilot a deck
  may lie under the street level, and 0 still means none.

### Surface contract as built, against the spec's `SurfaceQuery`

| Spec field | Pilot |
| --- | --- |
| x, z | `heightAt(x, z)`, `cutAt`, `deckHeightAt(x, z, y, step)` |
| yHint / previous surface | `getGroundHeight(x, z, mode, y)`: a deck counts only within the step (0.6 m walking, 0.9 m driving) of y. Under the viaduct you stay on the valley floor; on it you stay on the deck. |
| kind | ground (draped), roadDeck (`DECKS`), railDeck (subway lower deck, ride profile), platform (interior spaces), water (river patch) |
| normal | `gradientAt(x, z)` (the surface's triangle) |
| arrival (yHint unknown) | in the box, the street level (y 0) is the hint. So a teleport lands on a deck that is level with the street (the viaduct's two sections) or below it (a ramp), not on the floor under it. Any arrival meant for the floor carries its y: `streetArrival` for search results and map spots, the navigation graph's heights for routes and Tour Drive (§3). |
| surfaceId, connection, quality | **Not built.** Connectivity comes from yHint, not IDs (§7). |

## 3. Migration inventory: every consumer and how it migrates

| Surface or consumer | How it follows the valley | Status |
| --- | --- | --- |
| Street level (roads are its asphalt), curb islands, kerbs, walks, City sidewalks, lawns, plots, park paths, streams, mapped walls (`CityGround`) | `drape()` after the world is built (`main.js`) | done, exact |
| Heavy-rail track beds (Bala Subdivision, Rosedale Siding) | `drape()` of `RailTracks`; GO trains add `heightAt` to their route points (`rail-corridor.js`) | done; trains are interpolated every 4 m |
| Road markings, bike paint, trail surfaces | `road-paint.js`: strips and ribbons on the valley's ground follow it in 2 m parts | done, approximate (cm) |
| Traffic, buses | the street graph's node heights (`road-network.js`, `roadHeight`): ground nodes on the valley, Bloor's nodes on the deck. Between them, `edgeY` follows each edge's own surface: the valley under the lane's own point (`heightAt`) or a ramp's profile (`rampAt`), plus the ends' offsets from it (a road cut's depth). The turns through junctions follow it too (`curvePoint`); the viaduct's level deck keeps its straight line | done (`st-wt0.21.3`): lanes and turns within 0.05 m of the surface; a straight line between nodes was up to 2.5 m off |
| Bloor Street / Danforth Avenue over the valley | `deckHeight`: the deck at y 0.4, ramped to the street within 10 m of where the ground comes up | done |
| Ramps down the valley's sides (Bayview–Bloor, Royal Drive, the DVP links) | their lidar profiles (`D.decks.ramps`, every 4 m or less), standing 0.35 m or more over the ground cut under them; slab faces, and piers where a ramp bridges something (`city-grid.js`); `rampAt` gives the road graph's raised nodes their height | done (§6) |
| Bloor Street over the Rosedale ravine (the viaduct's Rosedale section) | level with the street at y 0.4, like the Don's deck; the flat city's 7.5 m flyover onto it from Parliament Street and Bloor west of the box is the street again (`D.decks.flattened`, `roadHeight`) | done |
| Other decks in the box over shallow ground (Drumsnab, Castle Frank Road, McKenzie Avenue) | 0.35 m over their own ground | done |
| Other flyovers in the box that only climbed to the 22.5 m deck | 0: the street again | done |
| Walking floor, cycling, driving | `getGroundHeight` = street/island + `cutAt` (valley) or a deck in reach | done |
| Colliders | viaduct piers and abutments stand on the valley (`subway.js`); flyover piers from their ground; buildings keep their 2D colliders | done |
| Props and furniture (hydrants, rings, post boxes, poles, lights, signals, benches, Bike Share, park signs, trees) | `cutAt` (park signs: `heightAt`) | done |
| Hydro poles and their wires | poles `cutAt`, like the other mapped poles; a span between poles at different heights is sheared to the far pole (`wireSpanMatrix`, flag only) | done |
| Parked cars | stalls laid out on the flat city, drawn at y 0: a car where the ground under it falls more than 5 cm below the street level is left out (`parked-cars.js`, flag only; 8 of the 89 in the box on the high tier) | excluded, not migrated |
| Patios | `cutAt`; the prebuilt layout's collider fingerprint changes, so with the flag on it lays out at startup (same 70 sidewalk + 119 curb cafés) | fallback accepted; flag off: fingerprint ok |
| Prince Edward Viaduct | deck 0.4, soffit −0.85, lower-deck rails −5.8, piers from the valley floor, arches clear 6.5 m of the highest ground under each span, abutments and portals in the valley's sides | done |
| Subway ride Castle Frank ↔ Broadview | route depth profile; platform cells and walking floor at depth (§5) | done |
| Water | the Don, where the street level opens over the river: one level across the river for each 10 m row (`D.river`, rule 9), at least 0.7 m under its channel's lowest ground. Earth banks run down to it from the ground round the open cells. Streams are draped | levelled (`st-051`); see §7 for the direction |
| Terrain beyond the city (north of z −3000) | a 10 m patch on the same grid: `terrainRawAt` + valley. `terrain.js` leaves its cells in the box out. | done |
| Surroundings beyond the city | `groundAt` adds the valley | done |
| Bayview Extension, DVP | ground roads: draped asphalt, conditioned profiles, traffic on the valley | done; DVP lanes not separately graded |
| Buildings | plinths (§1) | done |
| Navigation route points, `findTeleportPosition`, `teleportToPlace` | `getGroundHeight` with y unknown arrives at the street level, so a teleport onto either viaduct section lands on its deck and one onto a ramp lands on the ramp. `streetArrival` (`city-config.js`) picks the street in front of a search result or map spot, now including the box's decks, and returns its surface's y. The navigation graph (`navigation.js`) takes `roadHeight` like the traffic, so a route across the viaduct is at 0.4 m, one along Bayview Avenue under it is on the floor, and Tour Drive's hops keep the route's y | done (`st-wt0.21.1`) |
| Separator curbs, flexi-posts, bike lanes and trails (cycling) | `cycling.js`: where a line crosses relief it gets points every 2 m, and the separators' corners, the posts and `at()` take the surface where they stand (`P.yAt`). A bikeway on a road takes Bloor's deck where the deck is level with the street | done (`st-wt0.21.3`): separators and posts within 0.01 m of the surface |
| Pedestrians, crowd | each foot and the body take `cutAt` where they are (`traffic.js` pedGround, the rig's ground function), not a line between points | done (always was) |
| Shadows | draped meshes keep their cast/receive flags; scene-culling stand-ins are built after the drape | done (visual) |

## 4. The pilot area and its boundary (TE-4)

The box runs from the subway's Rosedale Valley bridge, west of Castle Frank, to Broadview: x 1600…2800. The SRTM
build stopped at x 1780, at Castle Frank. North–south it runs from 800 m beyond the city's north edge (z −3800,
terrain only, outside the playable city) to 900 m south of the viaduct (z −1880). The lidar build stopped at z −3500.
There, the north taper crossed the Bayview–Bloor and Parkway interchange, which OpenStreetMap maps to about z −3570, so
its ramps and roads climbed the taper at 14–24%. Now the taper lies beyond them. The surface is 0 on every edge, so no
seam, wall, wheel step or water dam can form there. The tapers are smooth (smoothstep):

| Edge | Taper | Notes |
| --- | --- | --- |
| West | 80 m | The Rosedale ravine's seam is the subway's bridge, not the edge (below) |
| East | 80 m | The tableland is at 0 there anyway |
| North | 280 m, outside the playable city | The valley's floor rises to the plain 520–800 m beyond the edge, seen from the viaduct as the valley's end |
| South | 700 m (z −2580…−1880) | The transition: Bayview, the DVP, the river and the rail climb back to the flat city at 5–7% |

**The Rosedale ravine.** In the lidar the ravine runs from Park Road east to the Don. It is about 26 m deep where the
subway crosses it on its covered Rosedale Valley bridge (the bridge's roof at 108.4 m, Rosedale Valley Road under it
at 86.8 m). The road falls gently, about 1.5%, all the way to Bayview. The flat city cannot hold that ravine west of
the pilot. There it keeps Rosedale Valley Road at street level and dips it 7.2 m under the subway's box in a
road cut (`GEO.roadCuts`).

The SRTM build ended the ravine at the box's west edge, so the road climbed from the Don's floor to the flat city at
15.5%. Now the seam is the bridge:

- **The flat city's side** (north-west of the bridge, inside x < 1780): street level, as before. The cut, its banks
  and the subway's box are unchanged.
- **The valley's side.** The ground (and the cut, where it climbs out east of the bridge) goes no deeper than the cut's
  7.2 m floor plus 5% of the distance from the bridge. Rosedale Valley Road runs down from the cut's floor at about 4%
  to meet the ravine's real floor about 400 m east of the bridge, then follows the lidar to Bayview. The ravine's
  sides near the bridge are filled up to that grade. Nearest the subway's box they stand like an embankment under it,
  where the real bridge spans 20 m of air.
- **Grades** (§6): Rosedale Valley Road is at most 9.0% over any 20 m in the playable city, where the cut's 10% climb
  out meets the valley. From 150 m past the bridge it is at most 6.4% (where the rule fades out); the old boundary
  climb was 15.1%.

The playable city ends at z −3000, where the draped city meets the terrain patch on identical grid heights. The
stations and tunnels at either end are held at street level, so their entrances, the covered bridge over Rosedale
Valley Road and the existing road cut are unchanged.

## 5. Castle Frank and Broadview at depth

`tools/subway-station-facts.mjs` gives each station its own `depth.donValley` (basis **derived**, with a confidence);
the flat city keeps `worldDatum: 'viaduct'`. No published source gives either depth. The TTC's station pages and
Transit Toronto give levels, and OpenStreetMap has no `ele` or `step_count` tags there. Each depth is derived from the
lidar (`DON_VALLEY_EVIDENCE`) and the viaduct's design drawing:

| Evidence | Value | Source |
| --- | --- | --- |
| Top of rail on the lower deck | 6.57 m (21'-6¾") below the road at the kerb; 4.95 m (16'-3") clear to the steelwork; the road "nearly level" | T. Taylor, "The Bloor Street Viaduct", *Journal of the Engineering Institute of Canada*, July 1919, Fig. 2 ([scan](https://historicbridges.org/ontario/bloorstreetprinceedwardviaduct/articles.pdf)) |
| Road deck surface | 113.3 m (west end), 114.1 m (mid-span), 113.6 m (east end) | GTA 2023 lidar surface model |
| Lower deck's rail | about 106.7 m (west end), 107.0 m (east end) | the two above |
| Covered Rosedale Valley bridge's roof, just west of Castle Frank | 108.4 m | the surface model |
| Street at the stations | Castle Frank 112.9 m, Broadview 114.5 m | the DTM (10 m cell means) |
| Levels | Castle Frank: street, concourse, platforms; elevators from the street to each platform. Broadview: street (with the bus and streetcar platforms), concourse, subway platforms; OpenStreetMap puts the platforms at `layer=-2` under a `layer=-1` concourse | TTC station pages; OpenStreetMap ways 745459353 and 745459354 |
| Maximum grade | 3.5% on running structure, 0.3% minimum at stations ("TTC Design Manual", as quoted by Metrolinx's Relief Line EPR, Appendix 2-3) | secondary copy; the manual itself was not found |

| Station | Platform floor | Rail top | Range | Confidence | Derivation |
| --- | --- | --- | --- | --- | --- |
| Castle Frank | **−8.8 m** | −9.9 m | −9.6 to −8.0 | medium | Its platforms start at the bridge's east end. Rail level with the bridge's: the roof 108.4 m less 5.4 m (4.95 m clear plus a 0.45 m roof; 5.1–5.8 m allowed) is 103.0 m, 9.9 m under the street. The real climb to the lower deck's 106.7 m over the ~150 m to the west abutment is 2.5%, within 3.5%. A rail below 101.5 m would break 3.5%. |
| Broadview | **−7.5 m** | −8.6 m | −9.5 to −6.5 | low | Nothing measures its rail. It has two levels under the street, as shallow as a concourse allows (two storeys, about 7.5 m). The track falls 1.1 m (0.6%) from the east abutment's 107.0 m over ~185 m. Bounds: two storeys at least; 3.5% would allow down to −12.9 m. |

The rail top is the platform floor less the passenger model's 1.1 m platform height (not sourced). Both depths replace
the earlier assumed −9.0 m. Castle Frank's is close to it; Broadview's is shallower.

**In the ride.** The lower deck carries the rails 5.8 m under the street datum. That is 6.2 m under the game's deck,
against Taylor's 6.57 m; the viaduct's geometry is unchanged. Each route's depth profile is level 80 m either side of
each platform's centre, level from 31 m inside each abutment across the viaduct, with an even grade between. The
climbs are 3.4% at Castle Frank (4.1 m over 119 m) and 1.8% at Broadview (2.8 m over 158 m), both within the TTC's
3.5%. The game's grade is steeper than the real 2.5% because the profile's level platform and abutment sections are
longer than the real ones. The platform cells, the walking floor and the tunnel boxes follow the profile. The trains
enter and leave the abutments' portals in the valley's sides at −5.8 m.

## 6. Diagnostics and review triggers (TE-3)

Initial triggers: road grade over 12%, curb or road step over 0.15 m, rendered-versus-sampled height over 0.03 m.

- **Rendered versus sampled:** 0 by construction for draped meshes (tested under 0.001 m). Paint, trains and graph
  edges are interpolated and so approximate.
- **Viaduct:** the deck's top is 39.5 m over the deepest point under it (−39.1 m, the Don at 75.2 m). The lidar's
  road deck at mid-span (114.1 m) stands 38.9 m over the same river. Taylor's 1919 paper gives "130 feet above the
  river" (39.6 m), and the commonly cited figure is 40 m. The SRTM build had 35.1 m. The ground is −4.4 m at the
  west portal and −4.5 m at the east one; the portal rule lowers the 6 samples in front of them below the portal
  floor (−6.0 m).
- **Road grades (`diagnostics.roads`: the steepest 20 m of each road in the box; review over 12%, not suppressed).**
  Each road is measured on its own surface. A ground road's is the valley plus the flat city's road cut. A raised
  road's is its deck: a ramp's profile or a viaduct section's deck, not the ground under it. Two entries are left over
  12%, each with its recorded resolution. `playableMaxPct` is the steepest 20 m inside the playable city.

| Road | SRTM | Lidar (#43) | Profiles (this revision) | Note |
| --- | --- | --- | --- | --- |
| Bayview–Bloor Ramp (deck), playable city | 38.3% | 10.5% | 6.9% | its lidar profile |
| Royal Drive (deck) | 13.8% | 14.3% | 8.5% | its lidar profile; the 8.5% is the last 20 m into the valley's ground road (below) |
| Ramp and Parkway link stubs north of the city's edge (decks) | | up to 42% | up to 9.7%, one junction 14% | the north taper moved beyond them (§4) |
| Ground roads north of the city's edge | | up to 24% | up to 7.4% | the same |
| Drumsnab Road (deck) | 22.3% | 0 | 0 | the lidar has no valley under it |
| Rosedale Valley Road | 15.1% | 9.0% | 9.0% | the cut's climb out meeting the valley (§4); 6.7% at most from 150 m past the bridge |
| Bayview Avenue | 9.7% | 7.3% | 7.3% | |
| Don Valley Parkway | 6.9% | 4.8% | 4.8% | |
| Unnamed service lane down the ravine's side (1732, −2459) | 15% | 16.6% | 16.2% | **review**, its own slope: 17.1% in the 0.5 m lidar along its centreline (`lidarPct`); left as surveyed |
| Unnamed service lane (2131, −2317) | | 18.6% | 10.0% | under 12% over 20 m (the #43 figure was over 5 m) |
| Bayview–Bloor Ramp junction north of the edge (2233, −3367) | | | 14.0% | **review**, `junction`: OpenStreetMap's ground way goes on over the ramp's bridge, where the 10 m grid's road lies 6.8 m under the lidar's |

### The ramps' profiles (rule 8, `st-wt0.21.2`)

The ramps used to be decks hugging the 10 m grid 0.35 m up. They took its grade, and the grid is not the road. Near
the rim, the shallow rule zeroes depths under 1 m and keeps only part of those under 6 m. So Royal Drive's ramp stayed
level for 50 m from Danforth Avenue, then fell at 14%. The real road starts down at the street. Each ramp now gets a
profile of its own (`tools/build-don-valley.mjs`, rule 8):

1. **Stations every 2 m** along its OpenStreetMap alignment. Ramps that meet are joined into one graph, which links
   the interchange's 21 decks.
2. **The lidar's road** under each station: the median of three 0.5 m DTM pixels across it, less the datum, tapered
   like the ground. Near the rim the datum rides 0.5–1.4 m over the real street (§1), so each ramp is measured from its
   own street: the lidar's bias at its street-level end, faded out from 1 m to 6 m deep.
3. **Bridges.** Where a ramp crosses a road or the river, the bare earth falls away under it. A closing along the graph
   (the highest within 30 m, then the lowest of those) spans dips up to 60 m long.
4. **Pins.** Each free end meets what it joins: a viaduct section's deck, the street, or 0.35 m over the valley's
   ground road.
5. **The profile** is the smooth line through the pins nearest the lidar's road, a membrane over about 15 m.
6. **The ground** under it is cut to 0.35 m under the deck, level across the roadway and 1.5 m beyond, blending out
   over 8 m. Then any grid triangle still above a station comes down by the difference. Over lower ground a ramp
   stands on its piers.

On grade, the profiles lie within 0.47 m RMS of the province's 2023 lidar surface model (485 points where it was
fetched). The worst are the ends pinned to a ground road and the top's bias correction. Eight ends meet a ground road
more than 1.5 m from the lidar's road (`alterations.ramps.junctions`). The 10 m grid's roads run low along the valley's
sides. In the playable city that is only Royal Drive's foot, 2.0 m, which makes its 8.5% over the last 20 m.

**Real ramp grades.** In the lidar the Bayview–Bloor ramp and Royal Drive fall at 5.8% and 8.1% over their steepest 20
m. That fits highway practice. NCDOT's *Roadway Design Manual* (§8-4, "Maximum ramp grades") keeps desirable ramp
grades to 5% at 50 mph and 6% at 40 mph. It allows "as steep as 10%" for "loops and urban area ramps", limited to
"minor ramps with low volumes"
([PDF](https://connect.ncdot.gov/projects/Roadway/Roadway%20Design%20Manual/08.%20Interchanges.pdf)). Ontario municipal
road standards cap road grades at 8% ([Pickering](https://pickering.ca/media/0evdypkt/roads.pdf)). Not quoted:

- TAC's *Geometric Design Guide for Canadian Roads* (§10.6) has its own ramp tables, but they are not openly available.
- No grade limit was found in Toronto's published design guidelines.

**The Rosedale section.** Bloor Street crosses the Rosedale ravine on the Prince Edward Viaduct's Rosedale section,
beside the subway's covered bridge. The flat city raised it as a generic 7.5 m flyover. The lidar build then dropped
that flyover 0.35 m over the ravine's fill, up to 9 m down, and left a 4.7 m step where the flyover's approach from
Parliament Street met the box's edge. The section is now level with the street at y 0.4, like the Don's. The five
approach decks outside the box are at the street (`decks.flattened`), and their road graph nodes are too.

**The deck joint over the ravine (`st-qfx`).** OpenStreetMap splits Bloor Street at x 1714.1, z −2668.7, mid-span,
where its 6-lane, 22 m way meets its 4-lane, 15 m continuation. city-grid.js drew each deck on its own, with square-cut
ends. That left a 3.5 m step in both parapets and the wider deck's end open. Every flyover is now drawn as a run
(`DECK_RUNS`, city-config.js `deckRuns`). A run joins decks of one name that carry straight on at a shared end no
other deck meets. The joint is one mitred vertex, so the slab, its faces and both parapets go on unbroken. Where the
width changes, the deck tapers over the narrower piece, from the joint. Here it narrows from 22 m to 15 m over 22.8 m
(80% of that piece; the rule asks for 6 m per metre of change, capped at 40 m). The 6-lane carriageway keeps its full
deck to the joint, and the player's deck grid follows the taper. The rule is city-wide, flag on or off: 120 runs join
two or more decks, and 35 taper. A few narrow pieces under 10 m long taper steeply, under 45°. Each original deck keeps
its piers' spacing. The markings on a deck had been painted 1.2 cm over its line while the deck's asphalt lies 3 cm
over it, so the deck hid them; road-paint.js now lifts paint on a raised edge to the deck's top, and the centre line runs
on across the joint (double yellow on the 6-lane piece, broken on the 4-lane one; the two outer lane lines end at the
joint, where the lanes drop). Tests: `tests/don-valley.test.mjs` (st-qfx). Captures (`tools/shots/bloor-deck-seam.json`,
desktop and phone, flag on): `ride-anywhere-geo/review/gpu2/slop-toronto-r3-phone/seam-before-*` and `seam-after-*`.

## 7. Risks and limits

- **Dev pilot.** The surface has no IDs or connectivity. A deck is chosen by yHint and step alone, and an arrival
  without a y takes the street level as its hint. A map click exactly over the viaduct lands on the deck. To land on the
  floor under it, an arrival needs a y: a route, a search result in the valley or a saved place. This is not
  production-ready, and the spec's connected-surface contract is not built.
- **Grid resolution.** The lidar is 0.5 m, but the pilot keeps a 10 m grid (cell means): kerbs, the river's channel
  and retaining walls are smoothed, and the steepest slopes read as 10 m facets. A finer grid would cost about four
  times the data and the draping.
- **The datum's rim envelope.** Beside the valley T rides 0.8–1.4 m over the real street (§1). The deck stands 0.6 m
  higher over the river than the lidar's, and the stations' depths are quoted from their own street, not T.
- **Rendering cost.** Draping splits the box's ground into pieces (about 0.5 s at startup on the mini in the SRTM
  build), plus plinths. The box is 17% larger now, but the flat cells are skipped. This is not measured on an idle
  machine. Production replacement needs the idle-machine comparison the spec requires.
- **The Rosedale seam** (§4) fills the ravine up to the flat city's cut near the subway's bridge, like an embankment
  under the box. The real 26 m ravine and bridge need the flat city west of the pilot to have terrain.
- **Grades** (§6). One service lane down the ravine's side is 16% (its real slope). One ramp junction north of the
  city's edge is 14%: the 10 m grid's ground roads run up to 2 m (once 7 m) under the lidar's road along the valley's
  sides, and a ramp's end meets them there.
- **Water: the direction (st-051, open).** The river is now one level across, and it never falls going south. Through
  the south transition it can't fall either: it climbs at up to 7.9% to the flat city's −0.7 m at the box's edge.
  - In the game's frame (heights over a street datum that falls towards the lake), the real Don rises. The lidar has it
    level, 74.7–75.2 m above CGVD2013, through the whole box, while T falls from 114.9 m to 99.8 m. So even under the
    viaduct the water rises 0.9 m going south.
  - The taper then lifts the floor 39 m to the flat city's level.
  - The Don flows south, so a surface that falls downstream and still meets the flat city's water at the edge would
    need a step (a dam, which TE-4 forbids).
  - What there is now is the nearest plausible water: level across, no bumps, pools that stay level until the floor
    lifts them, banks closing the open cells, and a clean, step-free join with the flat city's water. It reads as a
    river rising through rapids towards the city.
  - Making it fall downstream needs a decision: extend the pilot along the lower Don to the lake, where the valley's
    depth runs out, or accept a weir.
- **Patios** fall back to the startup layout with the flag on, about 0.3 s.
- **Under the viaduct** the lidar's ground class is interpolated by the survey where the deck hid the ground; the
  pilot no longer interpolates it itself.
- **Station depths** are derived, not measured (§5). Castle Frank's rests on the bridge roof and an assumed 5.4 m from
  roof to rail. Broadview's is a plausible shallowest layout.
- **Not every consumer is migrated:** parked cars stay off the slopes (§3).

## 8. Verification

- `tests/don-valley.test.mjs`:
  - the declared source (the GTA 2023 DTM, its licence, its tiles' SHA-256s), frame and datum, with separate grids;
  - datum mapping at the river (DTM ≈ 75 m, T ≈ 114 m, y ≈ −39 m), and the street at the viaduct's ends;
  - the deck to floor height: the lidar's 38.9 m, and the game's within 1 m of it (38–41 m);
  - max grades on each road's own surface: Rosedale Valley Road (under 10%, under 7% down the ravine), the Bayview–Bloor
    ramp and Royal Drive on their profiles under 10% (the stubs under 14.5%), and every review recorded with its lidar
    slope or junction;
  - the ramps: profiles every 4 m or less, standing at least 0.35 m over the drawn ground, the road graph on them,
    Royal Drive from the street to the valley; the Rosedale section level with the street and its approaches flattened;
  - grid nodes, continuity, and the box edges and stations at 0;
  - a monotone south transition;
  - draped geometry lying on `heightAt` to under 1 mm, with tilted normals;
  - `cutAt` = `roadCutAt` + valley, and decks over and under the viaduct;
  - ramps over their ground, the road graph's heights, and nothing changed without the flag;
  - a byte-identical rebuild from the lidar tiles;
  - the station depths: their derived facts and confidences, the shipped lidar's street at each station, and the
    derivation's grades within the TTC's 3.5%;
  - the ride: profiles within 3.5%, platform cells at −9.9 m and −8.6 m, the walking floor at −8.8 m (Castle Frank)
    and −7.5 m (Broadview), and a seated crossing from −9.9 m up to −5.8 m and down to −8.6 m.
- `tests/don-valley.test.mjs`, arrivals:
  - in every mode, a teleport lands on the Don's deck and on the Rosedale section, and with a floor y it lands under them;
  - a teleport onto a ramp lands on the ramp;
  - search results and map spots land on Bloor's deck over the valley and on Bayview's floor;
  - routes cross the viaduct at 0.4 m and run along Bayview at −34 m;
  - without the flag the street level and the old arrival are unchanged.
- `tests/don-valley.test.mjs`, between points:
  - on the valley's ground edges every lane, sampled each metre, and every turn through a junction lie within 0.1 m of
    `cutAt`, where a straight line between the nodes was up to 2.5 m off;
  - the viaduct's deck keeps its straight line, and without the flag `edgeY` is unchanged;
  - separator corners, posts and trail points lie on their surface, the trails with points 2 m apart over relief;
  - walkers take `cutAt` per foot.
- `tests/don-valley.test.mjs`, the river:
  - every row of the water patch is level across, and the levels never fall going south;
  - it rises at most 8%, and stays nearly level under the viaduct, around −40 m;
  - it is never above its channel's ground;
  - it is at the flat city's −0.7 m at the box's south edge, and the banks are there.
- `tests/boot.test.cjs`: the two scripts load only with `?donvalley=1`, just before `city-config.js`.
- `tools/shots/don-valley.json` (the Mac mini, flag on and off, desktop and phone) covers:
  - the walking floor and the patio fingerprint;
  - an aerial view;
  - the viaduct from the valley floor;
  - the view down from the deck, and walking on the deck;
  - Castle Frank's and Broadview's platforms and their street exits;
  - Rosedale Valley Road in its ravine and an aerial of the ravine;
  - the seated crossing and the train from outside;
  - the ride's end.
- `tools/shots/subway-riding-journey.json` runs with the flag on up to its last step. That step's failure is known on
  `main` (`st-fcm`).

### Results on 2026-10-31, follow-ups (Mac mini, contended: functional evidence, not timings)

Captures are in `ride-anywhere-geo/review/gpu2/slop-toronto-r3-ride/`: `fu3-*` from
`tools/shots/don-valley-followups.json`, and `fu2-*` from it, `don-valley.json` and the journey.

- **Arrivals, flag on, desktop and phone** (`fu-teleport-viaduct`, `fu-search-*`, `fu-rosedale-deck`):
  - a teleport onto the viaduct lands on the deck at 0.4 m, with the floor at −37.0 m under it;
  - a map or search spot on the viaduct (driving) lands at 0.4 m;
  - a spot in the valley lands on Bayview's floor at −35.2 m;
  - a teleport onto the Rosedale section lands at 0.4 m over the ravine's −8.5 m.
- **River** (`fu-river-*`): level across, rising from −38.6 m at z −2600 to −0.7 m at the edge, with banks. The black
  band between the box's south edge and the flat city's water is the flat city's own: it is there with the flag off
  too (`st-w1l`).
- **Ramps** (`fu-bayview-bloor-ramp`, `fu-royal-drive`, `fu-aerial-north`): both ramps run on their profiles down the
  valley's sides. North of the city's edge the interchange is clear of the taper.
- **Traffic and walkers on the slopes** (`fu-traffic-slope*`, `fu-walkers-slope*`). Each sample counts 54–58 cars in
  the box's valley:
  - nearly all are within 0.05 m of their surface;
  - the worst were 0.14 m and 0.12 m, both on Bayview by the steep service lanes. That is the car's body centre, between
    two axles that stand on the surface either side of a crease in the 10 m grid. The wheels are on the ground;
    `tests/don-valley.test.mjs` holds the lanes themselves within 0.05 m.
  - every walker's feet are on the ground.
- **`don-valley.json`, flag on:** every step passes. The walking floor is 0.4 m on the deck and −37.0 m under it,
  Castle Frank's platform −8.8 m and Broadview's −7.5 m, both exits 0.22 m. The seated crossing runs from −9.9 m to
  −5.8 m. Draping takes about 0.46 s, with 21 plinths.
- **Flag off, desktop and phone:** every step passes. The patio fingerprint is ok. The platforms and the train are at
  17.4 m and 16.3 m, and arrivals are as on `main`.
- **`subway-riding-journey.json`, flag on:** every step passes through the round trip. Only the known last step
  (`st-fcm`) fails.

### Results on 2026-10-31, lidar (Mac mini, contended: functional evidence, not timings)

Captures are in `ride-anywhere-geo/review/gpu2/slop-toronto-r3-ride/` (`dv6-*`).

**Desktop and phone, flag on.** Every `don-valley.json` step passes.

- **Walking floor:**
  - −36.2 m on Bayview Avenue under the viaduct, −37.0 m just under the deck, 0.4 m on it;
  - −19.2 m on Rosedale Valley Road in the ravine and −7.2 m in its cut under the subway's bridge;
  - the street at Castle Frank and Broadview.
- **Platforms:** Castle Frank at −8.8 m and Broadview at −7.5 m. Both street exits are at 0.22 m.
- **Seated crossing:** the train climbs from −9.9 m to the lower deck at −5.8 m.
- **Draping:** 24 meshes, 20,203 triangles into 229,455 pieces, 20 plinths, in about 0.47 s. The SRTM build made
  about 260,000 pieces in a smaller box.
- **Patios** fall back to the startup layout (`stale: colliders`) with the same 70 + 119 cafés.

**Desktop, flag off.** Every step passes. The platforms and the train are at 17.4 m and 16.3 m, as on `main`. The
patio fingerprint is ok (the prebuilt layout).

**`subway-riding-journey.json`, flag on.** Every step passes through the round trip:

- the seat, the viaduct and the exterior;
- the Broadview arrival and platform (−7.5 m);
- the return;
- the Castle Frank arrival and platform (−8.8 m);
- the street exit (0.22 m).

Only the last step (restart, then switch to the car: "Mode cleanup failed") fails, as it does on `main` (`st-fcm`).

### Results on 2026-10-30, SRTM (Mac mini, contended: functional evidence, not timings)

Captures are in `ride-anywhere-geo/review/gpu2/slop-toronto-r3-ride/` (`dv3-*`, `dv4-*`, `dv5-*`).

**Desktop and phone, flag on:**

- Every `don-valley.json` step passes.
- The walking floor is −33.8 m on Bayview Avenue under the viaduct and 0.4 m on the deck; at Castle Frank and
  Broadview it is the street.
- The platform is at −9.0 m and the street exit at 0.22 m.
- Seated, the train climbs from −10.1 m to the lower deck at −5.8 m.
- Draping takes about 0.5 s.
- The patios fall back to the startup layout (`stale: colliders`) with the same 70 + 119 cafés.

**Desktop and phone, flag off:**

- Every step passes. The platform and the train are at 17.4 m and 16.3 m, as on `main`.
- The patio fingerprint is ok (prebuilt layout).

**`subway-riding-journey.json`, flag on:** every step passes through the round trip:

- seat, viaduct and exterior;
- the Broadview arrival and platform (−9.0 m);
- the return;
- the Castle Frank arrival and platform (−9.0 m);
- the street exit.

Only the last step (restart, then switch to the car) fails, as it does on `main` (`st-fcm`).

**`subway-line1-journey.json`, flag on:** every step passes.

## 9. Remaining work (child beads of `st-wt0.21`)

- `st-wt0.21.1`: done in this revision. Teleport, navigation and search arrivals get a surface (deck versus ground)
  and a y (§2, §3).
- `st-wt0.21.2`: done in this revision (§6). The ramps follow their lidar profiles, and the box reaches past the
  interchange. A service lane at its real 16% and one junction north of the edge are recorded.
- `st-wt0.21.3`: done in this revision (§3). Traffic lanes and turns, cycling separators, posts and paint follow the
  surface between their points. Walkers always took it per foot.
- `st-wt0.21.4`: the lidar floor and the Rosedale ravine boundary are done.
- `st-051`: the river is level across, step-free and meets the flat city's water (rule 9). It can't fall downstream
  through the south transition in this frame, so a decision is needed (§7).
- `st-wt0.21.5`: an idle-machine resource comparison before any production use. It depends on the other four.
