# Port Lands set pieces

Tracked in `jf-li1`. Modules: `js/portlands-kit.js`, `js/portlands-landmarks.js`, `js/portlands-bridges.js`,
`js/portlands-banks.js`, `js/portlands.js` (integration). Tests: `tests/portlands.test.mjs`,
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
| **Armour-stone banks** | along the park's river shores, from the water's edge 5 m inland | Nothing: the mud and gravel apron and the reeds of `js/water-edges.js` stay on the water side |
| **Planting behind the banks** | 3.6 to 18 m inland of the water's edge, in patches | Nothing: it keeps clear of paths, play pads, buildings and bridge approaches |
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

### Banks and planting (redo, `jf-li1.1`)

The first version (pale slabs, faceted pale-green blobs; kept on branch `feat/portlands-banks-wip`) was held back on
2026-11-25 because it did not fit this map. This version, `js/portlands-banks.js`:

- **Stone.** `portLandsBankChains` walks the water rings that pass through the park (`C.WATER_BODIES`, `C.waterAt` for the land
  side), resampled every metre with a smoothed inland normal, breaking at bridge decks. Along each chain a low earth-and-gravel
  slope (toe on the apron 0.5 m inside the water's edge, crest about 0.27 m up, 1.7 to 3.4 m in, falling to the lawn by 5.2 m)
  carries six rows of irregular blocks: five-to-seven-sided, each corner and facet its own height and shade, tilted, sunk,
  with a dark contact ring where it meets the slope. The first course is biggest and closest-packed, later ones smaller, fewer
  and lower. Colours are dark grey and tan limestone (`TONES`), never white; a few waterline blocks carry moss. The mud-and-gravel
  apron and the reeds of `js/water-edges.js` stay on the water side, untouched.
- **Planting uses the map's own vegetation.** `plantingSites` places sites (pure, tested in Node): shrub beds, tall-grass and
  forb patches, a few saplings, thinning inland over 13 m, clear of paths, play pads, buildings and bridge approaches. They are
  drawn with `CITY.parkCover.shrubGeometry / shrubMaterial / updateShrubViewer` (`js/park-cover.js`): the broadleaf, sumac and
  sapling foliage and the bluestem, goldenrod and forb tiles of High Park's atlas, with the same near/far dissolve and the same
  seasons as the city's trees (autumn colour, leaf fall to a bare thicket). Sizes: shrubs 0.8 to 1.7 m, saplings 1.8 to 3.2 m,
  tall grass 0.7 to 1.5 m. There are no whip trees: this is a new park and the trees already in it stay. If park-cover is not
  loaded nothing is drawn in its place (no stand-in shapes). One near and one far instanced mesh per 200 m cell for the shrubs,
  one for the grass, switched off by distance each frame (`createPortLands(...).update`, called from `js/main.js`).
- Roughly 4.6 km of shore, 12 k blocks and 15 k plants in 200 m cells (stone about 0.6 M triangles in all, of which only the cells
  within 300 m draw, and none casts a shadow).

Limits: this map's park has no surveyed relief (`docs/biidaasige-terrain.md`), so the slope is an overlay on the 0.224 m park
datum, not graded ground, and the blocks are not in the park's footing index (a walker's feet pass through them). The stone
is still low-poly next to the city's leaf-card vegetation; a rougher block mesh is the obvious next step.

## Verification

```sh
node --test tests/portlands.test.mjs tests/biidaasige-heritage.test.mjs tests/biidaasige-runtime.test.mjs
```

Banks visual: `GPU2_LOCK_WAIT=900 gpu2 portlands-banks -- env GPU2_OUT=gpu2-out node tools/capture.mjs tools/shots/portlands-banks.json`
(`CAPTURE_QUERY='?portlands=0'` for the before frames).

Visual: `GPU2_LOCK_WAIT=900 gpu2 portlands -- env GPU2_OUT=gpu2-out node tools/capture.mjs tools/shots/portlands.json` on
the Mac mini. Captures establish look, not frame time.

## Provenance and licence

The shapes are first-party work from the Canoe Cove rowing world (the owner's private project). Nothing third-party is
copied: no code from the rowing world's MIT donors (Sakuragaoka Station, Koi Pond Garden), and none of its GLB models. Source data: OpenStreetMap contributors (ODbL), City of Toronto, Waterfront Toronto.
