# Don Valley terrain pilot: datum and surface migration contract

Design, contract and pilot · 2026-10-30 · Beads `st-wt0.20` (design) and `st-wt0.21` (pilot) · Spec
§11 TE (an internal planning document, not published here)

Without a valley, the Prince Edward Viaduct crosses flat ground. Its road deck is a 22.5 m flyover, and Castle Frank and
Broadview stations sit at the deck's level ([subway topology](subway-topology.md#station-depths-and-levels)). This pilot
puts the real Don Valley under the viaduct from the DEM the city build already uses. The road deck is level with the
street, the subway's lower deck hangs 5.8 m under it, and both stations' platforms are below the street.

**It is behind a flag.** `explore.html?donvalley=1` loads `js/don-valley-data.js` and `js/don-valley.js` before
`city-config.js`. Without the flag neither script is fetched and every code path below reduces to the code on `main`
(`tests/don-valley.test.mjs`, `tests/boot.test.cjs`). It is a developer pilot, not a production region.

## 1. Sources, frame and datum (TE-1)

| Item | Value |
| --- | --- |
| Source | AWS Terrain Tiles (terrarium, SRTM-derived), `dem.i16` / `dem-meta.json` from `tools/fetch-dem.mjs`, 0.000185° (≈20 m N–S, 15 m E–W) |
| Rights | Public domain (SRTM); already credited in [CREDITS.md](../CREDITS.md). No Kazan, Swiss or Spanish height data. |
| Horizontal frame | The geodata's world frame: a WGS84 tangent plane at Union Station, turned −16.59° (`GEO.frame.projection`); x east along the grid, z south |
| DEM vertical datum | Metres above mean sea level (SRTM, EGM96 geoid) |
| Game vertical datum | Metres above the **local street datum** T(x, z). The flat city's y = 0 is T everywhere. |
| Grid | 10 m, 103 × 163 samples over x 1780…2800, z −3500…−1880; aligned with `terrain.js`'s 60 m grid |

**Mapping.** The game height is the DEM elevation minus the street datum:

```text
y(x, z) = DEM(x, z) − T(x, z)
T = DEM, opened over 30 m (trees and buildings in the surface model removed), closed over 400 m (the valley filled
    from the tableland either side), box-blurred twice over 150 m
```

T follows the tableland: 111.7 m above sea level at the viaduct's west end and 113.4 m at its east end. The Don under
the viaduct is about 76 m, so it lies about 35 m below the street. A constant offset could not give both rims y = 0
while the tableland falls about 25 m toward the lake. T does, by construction. The real deck is commonly cited as
about 40 m above the river. The game's 35.1 m comes from the DEM's coarse floor and is not surveyed.

**Raw and conditioned stay separate.** `js/don-valley-data.js` keeps four grids:

- `raw`: the DEM as sampled;
- `datumGrid`: T;
- `unconditioned`: the opened DEM minus T;
- `height`: the conditioned surface the game uses.

`alterations` records every conditioning rule, the number of samples it changed and the largest change.
`diagnostics` holds the review numbers in §6. `node tools/build-don-valley.mjs` rebuilds the data file byte for byte
from the cache (`GEO_DATA`, default `~/.cache/slop-toronto/osm-ids`; tested when the cache exists).

### Conditioning rules, in order

| Rule | What it does | Recorded |
| --- | --- | --- |
| bridge | The DEM is a surface model: it carries the viaduct's deck across the valley, blurred about 60 m either side. Samples within 70 m are replaced by interpolation across it. | 716 samples, up to 25.9 m |
| shallow | Depths under 1 m are street level, full depth from 6 m (a smooth knee). The tableland's ±3 m noise is not relief. | (in `unconditioned` vs `height`) |
| cover | The Line 2 tunnels west and east of the viaduct keep their cover (held at street level within 10 m), and so do both stations (within 90 m). | 175 samples |
| roads | Each road on the valley's ground gets a profile smoothed along it (60 m window). The roadway is level across and blends back over 12 m. Where corridors meet, their profiles blend. Ramps are decks and do not shape the ground. | 2506 samples, up to 14.9 m |
| portals | The ground in front of the two tunnel portals is lowered below the portal floor (y −6.0). Needed nowhere in this build. | 0 samples |
| boundary | The surface tapers to 0 at the box's edges (§4). | taper distances |

**Footing (TE-5).** Buildings keep their street-level base (y = 0) and their colliders. Where the valley falls away
under a footprint, the runtime adds a concrete plinth from the lowest ground under it up to the base. Nothing is
terraced, so the slope stays the DEM's. There are 65 plinths, the deepest 16.8 m: the large multi-part blocks on the
west slope south of Bloor. No multipart building gets a base from an unrelated part.

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
  split along their length too, so kerbs and walls stay on the valley.
- **Decks are separate from bare earth.** `deckHeightAt` keeps its grid and its yHint/step reach. In the pilot a deck
  may lie under the street level, and 0 still means none.

### Surface contract as built, against the spec's `SurfaceQuery`

| Spec field | Pilot |
| --- | --- |
| x, z | `heightAt(x, z)`, `cutAt`, `deckHeightAt(x, z, y, step)` |
| yHint / previous surface | `getGroundHeight(x, z, mode, y)`: a deck counts only within the step (0.6 m walking, 0.9 m driving) of y. Under the viaduct you stay on the valley floor; on it you stay on the deck. |
| kind | ground (draped), roadDeck (`DECKS`), railDeck (subway lower deck, ride profile), platform (interior spaces), water (river patch) |
| normal | `gradientAt(x, z)` (the surface's triangle) |
| surfaceId, connection, quality | **Not built.** Connectivity comes from yHint, not IDs (§7). |

## 3. Migration inventory: every consumer and how it migrates

| Surface or consumer | How it follows the valley | Status |
| --- | --- | --- |
| Street level (roads are its asphalt), curb islands, kerbs, walks, City sidewalks, lawns, plots, park paths, streams, mapped walls (`CityGround`) | `drape()` after the world is built (`main.js`) | done, exact |
| Heavy-rail track beds (Bala Subdivision, Rosedale Siding) | `drape()` of `RailTracks`; GO trains add `heightAt` to their route points (`rail-corridor.js`) | done; trains are interpolated every 4 m |
| Road markings, bike paint, trail surfaces | `road-paint.js`: strips and ribbons on the valley's ground follow it in 2 m parts | done, approximate (cm) |
| Traffic, buses | the street graph's node heights (`road-network.js`, `roadHeight`): ground nodes on the valley, Bloor's nodes on the deck | done; edges interpolate linearly between OSM nodes |
| Bloor Street / Danforth Avenue over the valley | `deckHeight`: the deck at y 0.4, ramped to the street within 10 m of where the ground comes up | done |
| Ramps down the valley's sides (Bayview–Bloor, Royal Drive, DVP links, Drumsnab, Castle Frank Road) | decks 0.35 m over their own ground, slab faces and piers from the ground (`city-grid.js`) | done; steep (§6) |
| Other flyovers in the box that only climbed to the 22.5 m deck | 0: the street again | done |
| Walking floor, cycling, driving | `getGroundHeight` = street/island + `cutAt` (valley) or a deck in reach | done |
| Colliders | viaduct piers and abutments stand on the valley (`subway.js`); flyover piers from their ground; buildings keep their 2D colliders | done |
| Props and furniture (hydrants, rings, post boxes, poles, lights, signals, benches, Bike Share, park signs, trees) | `cutAt` (park signs: `heightAt`) | done |
| Hydro poles and their wires | poles `cutAt`, like the other mapped poles; a span between poles at different heights is sheared to the far pole (`wireSpanMatrix`, flag only) | done |
| Parked cars | stalls laid out on the flat city, drawn at y 0: a car where the ground under it falls more than 5 cm below the street level is left out (`parked-cars.js`, flag only; 8 of the 89 in the box on the high tier) | excluded, not migrated |
| Patios | `cutAt`; the prebuilt layout's collider fingerprint changes, so with the flag on it lays out at startup (same 70 sidewalk + 119 curb cafés) | fallback accepted; flag off: fingerprint ok |
| Prince Edward Viaduct | deck 0.4, soffit −0.85, lower-deck rails −5.8, piers from the valley floor, arches clear 6.5 m of the highest ground under each span, abutments and portals in the valley's sides | done |
| Subway ride Castle Frank ↔ Broadview | route depth profile; platform cells and walking floor at depth (§5) | done |
| Water | the Don: a water surface 0.7 m under the valley floor where the street level opens over the river; streams draped | done (no flow conditioning) |
| Terrain beyond the city (north of z −3000) | a 10 m patch on the same grid: `terrainRawAt` + valley. `terrain.js` leaves its cells in the box out. | done |
| Surroundings beyond the city | `groundAt` adds the valley | done |
| Bayview Extension, DVP | ground roads: draped asphalt, conditioned profiles, traffic on the valley | done; DVP lanes not separately graded |
| Buildings | plinths (§1) | done |
| Navigation route points, `findTeleportPosition`, `teleportToPlace` | `getGroundHeight` with y unknown lands on the ground, so a teleport onto the viaduct lands under it unless given y | **not migrated** |
| Separator curbs and flexi-posts (cycling) | vertices on `cutAt`, not split along the grid | **partial** |
| Pedestrian walk lines, crowd | `cutAt` at their points; long lines interpolate | **partial** |
| Shadows | draped meshes keep their cast/receive flags; scene-culling stand-ins are built after the drape | done (visual) |

## 4. The pilot area and its boundary (TE-4)

The box runs from Castle Frank to Broadview, x 1780…2800. North–south it runs from 500 m beyond the city's north edge
(z −3500, terrain only, outside the playable city) to 900 m south of the viaduct (z −1880). The surface is 0 on every
edge, so no seam, wall, wheel step or water dam can form there. The tapers are smooth (smoothstep):

| Edge | Taper | Notes |
| --- | --- | --- |
| West | 80 m; 220 m where the Rosedale ravine runs out of the box (z −2720…−2250) | Rosedale Valley Road climbs from the Don's floor to the city plane at up to 15.5% (§6) |
| East | 80 m | the tableland is at 0 there anyway |
| North | 280 m, outside the playable city | the valley's floor rises to the plain 300–500 m beyond the edge, seen from the viaduct as the valley's end |
| South | 700 m (z −2580…−1880) | the transition: Bayview, the DVP, the river and the rail climb back to the flat city at 5–7% |

The playable city ends at z −3000, where the draped city meets the terrain patch on identical grid heights. The
stations and tunnels at either end are held at street level, so their entrances, the covered bridge over Rosedale
Valley Road and the existing road cut are unchanged.

## 5. Castle Frank and Broadview at depth

`tools/subway-station-facts.mjs` gives both stations `depth.donValley`:

- platform floor −9.0 m (range −9.5 to −7, basis **assumed**);
- rail top −10.1 m;
- the flat city keeps `worldDatum: 'viaduct'`.

No source gives the depth. It assumes three TTC levels (street, concourse, platforms) like the Yonge stations, and
is bounded by the ride's 4% limit:

- The lower deck carries the rails 5.8 m under the street datum.
- The platforms' level sections end 119 m (Castle Frank) and 158 m (Broadview) short of the abutments.
- At 4% the rails can be at most 10.6 m down. At 10.1 m the climb is 3.6% at Castle Frank and 2.7% at Broadview.

The ride's routes get a depth profile: level 80 m either side of each platform's centre, level from 31 m inside each
abutment across the viaduct, an even grade between. The platform cells, the walking floor and the tunnel boxes follow
the profile. The trains enter and leave the abutments' portals in the valley's sides at −5.8 m.

## 6. Diagnostics and review triggers (TE-3)

Initial triggers: road grade over 12%, curb or road step over 0.15 m, rendered-versus-sampled height over 0.03 m.

- **Rendered versus sampled:** 0 by construction for draped meshes (tested under 0.001 m). Paint, trains and graph
  edges are interpolated and so approximate.
- **Viaduct:** the deck is 35.1 m over the deepest point under it (−34.7 m). The ground is −6.8 m at the west portal
  and −7.9 m at the east portal, both below the portal floor (−6.0 m).
- **Grades over 12% (`diagnostics.roads`, 19 entries; review, not suppressed):**

| Road | Grade | Note |
| --- | --- | --- |
| Bayview–Bloor Ramp and the unnamed DVP and Bayview links | up to 41% | Decks hugging the DEM's slope. The real ramps are longer structures than the OSM stubs in the box. They need a profile of their own (child bead). |
| Drumsnab Road | 27% | Its short deck near the west rim |
| Rosedale Valley Road | 15.5% | At the west boundary, where it climbs to the flat city instead of continuing up the Rosedale ravine |
| Bayview Avenue | 14% | Outside the playable city (z −3368) |
| Royal Drive ramp | 15% | Deck |

Inside the playable city, the valley's ground roads (Bayview under the viaduct, the DVP) stay under 12% except
Rosedale Valley Road's boundary climb.

## 7. Risks and limits

- **Dev pilot.** The surface has no IDs or connectivity; a deck is chosen by yHint and step alone. A teleport or
  search arrival onto the viaduct without y lands on the valley floor. This is not production-ready, and the spec's
  connected-surface contract is not built.
- **DEM resolution.** SRTM at about 20 m blurs the river channel and the DVP's bench. It reads trees and buildings as
  ground, which the opening removes only partly. The deck stands 35 m over the floor, against the commonly cited 40 m.
- **Rendering cost.** Draping adds about 260,000 pieces (about 0.5 s at startup on the mini) and plinths. This is not
  measured on an idle machine. Production replacement needs the idle-machine comparison the spec requires.
- **Steep ramps and boundary grades** (§6).
- **Water.** The river surface follows the valley floor down the south transition. Water "flows" with the taper, and
  nothing levels it.
- **Patios** fall back to the startup layout with the flag on, about 0.3 s.
- **The bridge rule** reconstructs the valley under the viaduct by interpolation. The ground directly under the deck is
  inferred, not measured.
- **Not every consumer is migrated:** navigation and teleport heights, cycling separators, walk lines, parked cars (§3).

## 8. Verification

- `tests/don-valley.test.mjs`:
  - the declared source, frame and datum, with separate grids;
  - datum mapping at the river (DEM ≈ 76 m, T ≈ 112 m, y ≈ −35 m);
  - grid nodes, continuity, and the box edges and stations at 0;
  - a monotone south transition;
  - draped geometry lying on `heightAt` to under 1 mm, with tilted normals;
  - `cutAt` = `roadCutAt` + valley, and decks over and under the viaduct;
  - ramps hugging their ground, the road graph's heights, and nothing changed without the flag;
  - a byte-identical rebuild from the cache;
  - the stations' facts, the ride's profile within 4%, the platform cells at −10.1 m, the walking floor at −9 m, and
    a seated crossing from −10.1 m up to −5.8 m and down.
- `tests/boot.test.cjs`: the two scripts load only with `?donvalley=1`, just before `city-config.js`.
- `tools/shots/don-valley.json` (the Mac mini, flag on and off, desktop and phone) covers:
  - the walking floor and the patio fingerprint;
  - an aerial view;
  - the viaduct from the valley floor;
  - the view down from the deck, and walking on the deck;
  - Castle Frank's platform and its street exit;
  - the seated crossing and the train from outside;
  - the ride's end.
- `tools/shots/subway-riding-journey.json` runs with the flag on up to its last step. That step's failure is known on
  `main` (`st-fcm`).

### Results on 2026-10-30 (Mac mini, contended: functional evidence, not timings)

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

- `st-wt0.21.1`: teleport, navigation and search arrivals get a surface (deck versus ground) and a y.
- `st-wt0.21.2`: the ramps get their own profiles (Bayview–Bloor, Royal Drive, DVP links) instead of hugging the DEM.
- `st-wt0.21.3`: traffic, cycling separators and posts, and pedestrian walk lines follow the valley between their
  points, using shape nodes or a split along the grid. The DVP's lanes are graded.
- `st-wt0.21.4`: a better floor from the City's DTM or lidar, levelled water, and the Rosedale ravine boundary.
- `st-wt0.21.5`: an idle-machine resource comparison before any production use. It depends on the other four.
