# Subway topology, station depths and the second ride

Design and data contract · 2026-10-29 · Extends [subway riding](subway-riding.md) and its
[specification](subway-riding-spec.md)

The first ride (Castle Frank ↔ Broadview) used a hand-built two-station manifest. This document records the general
contract the rides now share:

- stable identities for stations, platforms, directions, track segments and entrances, joined to their sources;
- validated track connectivity between consecutive platforms;
- sourced station facts, with depths that are stated assumptions where nothing is published;
- the rules a station pair must pass before it becomes rideable.

The second ride, **Queen ↔ King on Line 1**, is built only from this contract. It is the first one walked from the
street.

It is a contract and its validation, not a whole-network implementation. Two rides are supported. The other 52
continuous segments are known and checked, but are not rideable.

## Files

| File | Role |
| --- | --- |
| `tools/geo-subway.mjs` → `js/toronto-subway.js` | OpenStreetMap ways, stations and street entrances, now with each record's OSM id appended (way id, station or entrance node id) |
| `tools/subway-station-facts.mjs` | Authored station facts with sources, the supported rides, and the game's profile limits |
| `tools/subway-topology.mjs` | The topology as a pure function of its inputs |
| `tools/build-subway-topology.mjs` → `js/toronto-subway-topology.js` | The generated contract (`window.CITY.SUBWAY_TOPOLOGY`), 56 KB |
| `js/subway-service.js` | Track ride paths with depth profiles, and station walks (`buildSubwayTrackPaths`, `stationWalkLayout`, `createStationWalk`) |
| `js/subway-ride.js` | Both rides: stations, trains, HUD and walking |

Regenerate the topology after the OSM download or the GTFS changes:

```sh
GEO_DATA=~/.cache/slop-toronto/osm-ids node tools/build-subway.mjs   # js/toronto-subway.js (needs the raw OSM cache)
node tools/build-subway-topology.mjs                                  # js/toronto-subway-topology.js (committed inputs only)
```

The topology build reads only committed files. `tests/subway-topology.test.mjs` rebuilds it and requires the
committed file byte for byte. It also rebuilds it from shuffled ways, stations, entrances and GTFS patterns and
requires the same result. With the raw cache, `build-subway.mjs` reproduces the committed `js/toronto-subway.js`
exactly.

## Identities

None is an array index. Each comes from a source name or id that survives a rebuild.

| Record | ID | Source and rule |
| --- | --- | --- |
| Line | `L1`, `L2` | OSM `Line N …` way names, and GTFS `route_short_name` N |
| Direction | `L1-0`, `L1-1`, `L2-0`, `L2-1` | Line plus GTFS `direction_id`. `L1-0` runs toward Vaughan Metropolitan Centre, `L1-1` toward Finch, `L2-0` toward Kennedy and `L2-1` toward Kipling. The GTFS headsign is kept as `sign`. |
| Station | `queen`, `queens-park`, `st-george`, `bloor-yonge` | A slug of the OSM station name. The OSM node id is kept as `osm`. A duplicated slug is refused, not merged. GTFS station names are matched by their whole name: `Queen Station` never matches `Queen's Park Station`. GTFS `Bloor` and `Yonge` are aliases of `bloor-yonge`. |
| Platform | `queen/L1-0` | Station and direction, with the GTFS stop id (`13811`) and the TTC's compass name from the GTFS stop name (`Southbound`) |
| Segment | `L1-0:queen>king` | The directed track between consecutive calls of a direction |
| Entrance | `osm-node/3697981902` | The OSM node of a street-level `railway=subway_entrance` |
| Ride | `l1-queen-king` | Authored in `SUPPORTED_RIDES` |

GDAL's OSM extract has no node ids for way vertices; `tools/fetch-osm.mjs` numbers them by coordinate in fetch
order, so those numbers are not stable and are not kept. Track connectivity uses the shared end points instead:
`rdp()` simplification keeps both ends, and ways that share an OSM node share the exact end coordinate.

## Track connectivity

A passenger track is a line's ways with no `service` tag: no sidings, crossovers, yard tracks or unnamed wye tracks.
Ways are joined into chains where one ends at the next one's start and the track continues within 35°. Processing
in OSM id order makes the joins independent of input order.

For each GTFS direction, each call is placed on its line's track:

1. Project the OSM station node onto every chain of that line within 30 m. If none is that close, use the GTFS stop
   instead. Spadina's Line 2 platforms are the only case; its OSM node marks the Line 1 platforms.
2. Of the candidate tracks, take the one on the right of travel toward the next call.
3. Check that choice against the data instead of assuming it. The track counts as `right-hand` only when the other
   direction's track is on the left and 3–12 m away.

Every located platform passes that check, apart from Bay's two. At Bay, the Lower Bay tracks overlap the line: their
nearest track is 0.1–0.3 m away, so the platforms are `ambiguous`. Track spacing is 4.0–4.9 m at side-platform
stations and about 10 m at Union, St Andrew, Osgoode, St Patrick, Queen's Park, Museum, St George and Bloor-Yonge
(Line 2). That spacing suggests centre platforms or separate levels, but the topology does not claim either.

A segment is continuous when both of its platforms lie on one chain. Of 57 segments, 54 are continuous, with lengths
from 360 to 973 m. The other three are reported, not bridged: `L2-0:bay>bloor-yonge`, `L2-1:bloor-yonge>bay` and
`L2-1:bay>st-george`. Ways meet at a three-way junction at the east end of Bay and at the Lower Bay connection, so
those platforms fall on different chains. Each segment lists its OSM ways in travel order, its structure (`tunnel`,
`tunnel+viaduct` or `tunnel+open`) and its GTFS scheduled run time.

## Station depths and levels

No published source gives these stations' depths below the street. The TTC station pages give levels, platform type
and accessibility. Transit Toronto describes the 1954 Yonge subway's cut-and-cover construction, gives no depths, and
says that King has a single mezzanine fare area.

| Station | TTC levels | Platforms | Accessible | Modelled depth (world metres; street 0) | Basis |
| --- | --- | --- | --- | --- | --- |
| King | 3: street, two concourses, platforms | side | no | concourse floor −4.5 (range −6 to −3.5); platform floor −9.5 (−12 to −8); rail top −10.6 | **assumed** |
| Queen | 4: street, concourses, platforms, underpass below the platforms | side | yes (4 elevators) | as King; the underpass is not modelled | **assumed** |
| Castle Frank | 3 | side | — | rail on the viaduct deck, 16.3 m | world datum: viaduct |
| Broadview | 3 | side | — | as Castle Frank | world datum: viaduct |

The King and Queen depths assume two storeys under Yonge Street. The concourse floor is one storey (3 m clear) plus
the slab and street cover below the street. The platform floor is a second storey below that, under the platform
ceiling and the concourse slab. Rail top is the platform floor less the passenger model's 1.1 m platform height,
which is also not sourced.

The fact file holds each depth as `{ value, range, basis: 'assumed' }`. The topology build refuses a track ride
without a platform depth. A measured depth (from TTC drawings or a City structure record) replaces the value and
changes `basis`; nothing else needs to change.

**Castle Frank and Broadview keep the viaduct level.** This deliberately keeps their placeholder.

- The city is flat at street level. The Don Valley is not dug out, so the Prince Edward Viaduct's lower deck stands
  16.3 m above the street around both stations.
- In Toronto the lower deck is a few metres below the road deck, about level with the stations.
- A real depth below the flat street would need a 24 m climb in the 160 m between a platform end and the viaduct.
  That is a 15% grade; the game's limit is 4%.

Putting these stations underground needs a valley in the terrain, which is outside this work. Until then their
platforms are representative cells on the deck's level, entered through the explicit transition. The Bloor Viaduct
ride is unchanged.

## Ride rules

A ride is two consecutive stations of one line, ridden both ways. Both stations are boundaries: the train holds there
for alighting, and neither is presented as a terminus. `buildSubwayTopology` marks a ride `supported` only when all
of these hold:

- Both directions have the pair as consecutive GTFS calls, with a continuous segment.
- Every platform of the line at both stations is `right-hand` checked.
- Both stations have facts. A track ride needs platform depths; a viaduct ride needs the viaduct datum.
- Each walk entrance listed for a station is one of that station's OSM street entrances.
- A track ride's track runs at least 400 m before the departure platform and 220 m past the arrival. A recycled train
  starts wholly inside the approach tunnel.
- The depth profile's grade is within 4%: level platforms ±80 m around each centre, with a constant grade between.
- Each platform is straight enough for a six-car train: the track deviates from its chord by under 0.6 m over 141 m.

Each failed rule is reported in `problems`; nothing is guessed. The tests check that a non-consecutive pair
(Queen–Union) and a station without facts (King–Union) are refused.

### Adding another pair

For each new station:

1. Add its facts (levels, platform type and accessibility from its TTC page) and its depths with their basis and
   range.
2. List one or more of its OSM street entrance node ids, in order of preference.

Then add the ride to `SUPPORTED_RIDES` and run `node tools/build-subway-topology.mjs`. The ride appears in
`summary.rides` only if every rule passes. Its geometry, trains, stations, walk and HUD then come from the contract
without new code, as long as:

- both stations have side platforms (the walk layout's assumption);
- at least one listed entrance gets a stairway on the street from `js/subway.js`, not a sign-only site.

Centre platforms, interchanges and stations deeper than one concourse level need new walk layouts.

## Why Queen ↔ King

The pair was chosen for what it validates:

- **Untested paths.** It is the first ride on Line 1, entirely in tunnel, at negative world elevation, with GTFS
  compass names (Southbound/Northbound) instead of the viaduct ride's hard-coded labels. That covers the specification
  gate for walking at negative world elevation and checks the depth profile, interior-only camera and clearance paths
  the viaduct ride never used.
- **Clean, consistent data.** Both stations are side-platform, cut-and-cover boxes with the same structure. OSM gives
  two parallel tracks 4.3–4.5 m apart and straight through both platforms (0.2 m sag at most). GTFS gives consecutive
  calls both ways: 74 s southbound and 78 s northbound over 461 m. The flat city agrees with reality here, unlike at
  the valley stations.
- **Usable street entrances.** Both stations have mapped stairways at the Yonge corners. At King, `js/subway.js`
  places no stairway for A1, so the walk uses the next listed entrance, B2 at the south-east
  corner. At Queen it uses the south-west corner.
- **A busy part of the map.** It is in the most-visited downtown core, beside the 504 King and 501 Queen streetcars.

Other candidates were set aside:

- **Union–King** crosses Union's loop, where the platform spacing is about 10 m and needs its own layout.
- **Line 2 west of Broadview** (Sherbourne–Castle Frank) has the same world-datum conflict as Castle Frank, with the
  Rosedale Valley's covered bridge at street level between them.

## The walk from the street

At King and Queen the player walks from a street entrance down to either platform:

- **Entrance stairway.** It continues the mapped stairway's slope from its street opening (`js/subway.js` places the
  opening) down to the concourse. The walk begins 2.3 m below the street, out of the street's sight; above that the
  steps lead up to daylight.
- **Concourse.** A landing and a corridor at the concourse level, L-shaped in the station frame, lead to a mezzanine
  across the tracks at the end of the platforms nearer the entrance.
- **Platform stairs.** From the mezzanine, one stair goes down to each side platform, with signs giving the direction
  and destination.

The walkable space is a set of rectangles. Each has a floor that is level or rises evenly, with level ends where it
meets the next one, so a stair never jumps. The controllers ask the space for the floor under the walker
(`floorAt`). The space only lets a walker onto rectangles near their own floor height, so a corridor over a platform
never drops them onto it. Walls are generated wherever no other room carries on.

The layout is schematic: published sources give the levels, not the plans. The concourse and corridor positions are
not King's or Queen's real ones; they connect the mapped entrance to the real tracks at the assumed depth. Queen's
elevators and underpass are not modelled.

- **Shortcuts.** **Change to the other platform**, **Go to a platform** and **Exit to [station]** offer every move
  without the stairs: they serve accessibility and touch.
- **Street exit.** At the top of the stairway, **E**, the prompt or gamepad **A** leads back to the street. Reloading
  restores the last safe street position.

## Verification

- `tests/subway-topology.test.mjs`:
  - deterministic build against the committed file;
  - order independence under three shuffles;
  - stable ids, GTFS stop ids and compass names;
  - right-hand checks and the reported gaps;
  - siding exclusion, ride validation and refusals.
- `tests/subway-service.test.mjs`:
  - the Line 1 routes: below the street throughout, level platforms 9.5 m down, right-hand tracks, never "outside";
  - an occupied train each way: identity kept, doors shut while moving, every car below the street, the consist at
    the platform, the hold;
  - walk connectivity from the street stairway to both platforms through level-matched cells;
  - floor continuity on the stairs, platform walls and no drop from the mezzanine.
- `tools/shots/subway-line1-journey.json` (desktop) and `tools/shots/subway-line1-phone.json` (touch, reload) cover the
  ride on the Mac mini. On 2026-10-30 the desktop journey passed every step:
  - seated at Queen, through the tunnel to King;
  - King's southbound platform, up its stairs, across the mezzanine and up the street stairway to the street;
  - back in from the street stairway, down to the northbound platform;
  - the northbound train to Queen, then out to the street;
  - mode cleanup.

  Captures run alongside production transcription, so they are functional evidence, not timings.
- `tools/shots/subway-riding-journey.json` still covers the viaduct ride. Every step through the round trip and street
  exit gives the same train ids and positions as on `main`. Its last step (restart, then switch to the car) fails on
  `main` too, at the same place, so the failure predates this work.
