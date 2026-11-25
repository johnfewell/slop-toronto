# Port Lands set pieces

Tracked in `jf-li1`. Modules: `js/portlands-kit.js`, `js/portlands-landmarks.js`, `js/portlands-bridges.js`,
`js/portlands.js` (integration). Tests: `tests/portlands.test.mjs`,
`tests/biidaasige-heritage.test.mjs`. Capture recipe: `tools/shots/portlands.json`.

The shapes and placement come from the Port Lands modelling in the Canoe Cove rowing world, a sister project whose plan
was cut from this map (its `canoeCovePlan.json` keeps this map's axes; **plan metres + `[2250, 500]` = world metres**,
`PORTLANDS_KIT.planToWorld`). Only shapes and placement came across. Every material is this map's own lit standard
material with vertex colour (`portlandsMaterial`): there is no toon material, ink outline, or Canoe Cove material
library, and none of the rowing world's life (the crane's hoisted canoe, people at its feet, gulls, pigeons, flags, the
painter on a cradle, the climber on a rope, boats, kayaks, birds, kites). `?portlands=0` leaves all of it out (the
crane aside, which is the park's own model), for an A/B.

## What is in, and what it replaced

| Piece | World position | What it replaced |
|---|---|---|
| **Atlas Crane** | the OSM node `node/9521067431` (2009.8, 804.0), head line on compass bearing 333, world axes | The earlier four-column gantry with one boom to the ground (`js/biidaasige-heritage.js`). `buildAtlasCrane` keeps its name, return shape, estimates and labels; the shape is now the Port Lands one. The native 3.1 m massing stand-in row stays excluded as before |
| **Victory Soya Mills silos** ("St Marys Silos") | on the City massing row named "Silo", (1721.2, 298.5), angle -1.322 | That plain 42.8 m massing box (`GEO.buildings[33863]`), left out of `CityBuildings` by `portLandsExcludesBuilding` |
| **Essroc silos** (80 Ookwemin St) | on the massing row at (2075.1, 425.6), angle -1.324 | That 36.9 m two-part massing box (`GEO.buildings[34071]`) |
| **Bridge shell arches**: Commissioners Street (orange), Cherry Street South (yellow), Cherry Street North (red) | on the map's own road-bridge decks over the Don mouth at (2768.9, 488.6), (2151.5, 796.0) and (1993.6, 387.7) | Nothing: the decks, kerbs, sidewalks, driving and walking over them stay `city-config.js` `ROAD_BRIDGES` and `city-grid.js` exactly. The shell is added on top |

Fire Hall 30 and The Drum were **not** replaced. The Canoe Cove versions were compared against
`js/biidaasige-heritage.js` and the existing ones are the more detailed and better sourced (the Fire Hall is proven the
same building as the native row, moved 24 m south, and carries the real OSM footprint; the Drum is built to the
Captain's photo read and the 201 m² source footprint), so replacing them would only lose information.

### Atlas Crane

Two waterside pivot bases, each a single pin from which a pair of steep square lattice members springs to the two heads;
the heads are white pulley housings about 12 m apart tied by parallel runway beams; a separate fifth lattice member slopes
from the inland head down to its own footing, with the old hoist ropes fanned beside it. No tower, jib, cab or
counterweight. The frame's middle is 0.8 m east and 6.5 m south of the node (read from the City's 2025 aerial). Height is
the same 35 to 38 m photo estimate as before (36 m), and "300-ton" stays a mass label, not a capacity. About 10 k
triangles in three meshes (steel, footings, ropes).

### Silos

Victory: 36 bins in four rows of nine under a full-length headhouse (City heritage designation 2016), bin tops about
33 m and the headhouse ridge about 38 m (lidar). Essroc: a northern group of four darker bins with a steel frame on top,
a southern pair with lighter tops and machinery above (about 45 m), joined by an elevated conveyor gallery on a trestle.
The silos are built only when the City rows are found in the geodata (a different frame gets none), and the same rows are
what `portLandsExcludesBuilding` removes, matched by place and form. About 9 k triangles.

### Bridge shells

The Port Lands road bridges (Grimshaw / Entuitive / schlaich bergermann, 2022-2024) are one family: a white steel plate
shell that rises and falls over the deck like a ribbon, with one strong colour inside. Colours and lengths are Waterfront
Toronto's ("Port Lands Road and Bridges Backgrounder", January 2024): Commissioners Street orange and white, 152 m, two
humps; Cherry Street South yellow and white, 110 m, one arch; Cherry Street North red and white, one arch.
The rises, lean and the 83 m / 69 m hump split are the rowing world's choices, not published.

Colour placement: the rowing world paints only the underside strip of the shell's inner edge, which from beside or across a bridge
is almost all hidden and the arches read white. Here the inner rolled lip above that strip is painted too, so the family colour
shows as a band along the arch's inner rim from outside and above as well as from the deck; Cherry Street South's yellow is
`#f2b400` (the Backgrounder's yellow, a little deeper so it does not wash out against the white at midday). From some angles
(Cherry South from its south-west) the inner face still turns away from the camera and only the end of the band shows.

This map's decks are the water crossing only (the mapped road at street level, about 50 m for Commissioners), and each
bridge is mapped as several short ways, so `portLandsBridgeChains` joins them by shared ends. The shell runs the chain
plus 12 m on to the banks, and its rise is scaled by how much of the real length the deck covers (not below 55 %). Its width
is scaled to the roadway (these roads are 7.4 to 10.2 m wide in the geodata, against 24 to 34 m in the rowing world's
plan). The shell adds **no colliders**: a walker or driver passes as before. Not brought: the rowing world's raised deck,
piers and abutments (this map's deck sits at street level), lamps, name plaques, the Cherry Street North transit deck
and the footbridges (this map's own paths and bridges already cross the side arms; the one standalone footbridge over
the lap's water at 786 m has no counterpart that the rest of this map would stand on). About 14 k triangles.

### Banks and planting: not shipped

The first version also laid armour-stone banks and planting along the park's river (`js/portlands-banks.js`). John
reviewed it on 2026-11-25 and held it back: the shrubs and whips read as big pale-green faceted blobs and the armour stone as
white slabs, neither of which fits this map's look. They are **not part of what ships** and not behind a URL flag. The code is
kept on the branch `feat/portlands-banks-wip` and is being redone in the `jf-li1` child issue (this map's own lidar-crown
trees and ground cover, darker rough stone sitting in the slope).

## Verification

```sh
node --test tests/portlands.test.mjs tests/biidaasige-heritage.test.mjs tests/biidaasige-runtime.test.mjs
```

Visual: `GPU2_LOCK_WAIT=900 gpu2 portlands -- env GPU2_OUT=gpu2-out node tools/capture.mjs tools/shots/portlands.json` on
the Mac mini. Captures establish look, not frame time.

## Provenance and licence

The shapes are first-party work from the Canoe Cove rowing world (the owner's private project). Nothing third-party is
copied: no code from the rowing world's MIT donors (Sakuragaoka Station, Koi Pond Garden), and none of its GLB models. Source data: OpenStreetMap contributors (ODbL), City of Toronto, Waterfront Toronto.
