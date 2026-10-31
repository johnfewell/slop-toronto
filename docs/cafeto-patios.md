# CaféTO patios

Bead `st-26p.3`. The City's CaféTO sidewalk cafés and curb lane cafés stand on the streets where the City permits them.
Rules turn each permit's address point into a footprint, and a permit that cannot meet the rules is rejected and
counted, never moved somewhere else. Private property patios are never placed.

## Source

[CaféTO Locations](https://open.toronto.ca/dataset/cafeto-curb-lane-parklet-cafe-locations/), City of Toronto Open Data.
The dataset page states the Open Government Licence – Toronto; the CKAN licence field reads `notspecified`. The resource
is `Cafe TO Locations - 4326.geojson` (`aa839e97-…`), refreshed 2026-09-29, fetched 2026-10-29.
`tools/data/cafeto-20261029.json` keeps the complete source (1,636 records), its resource ID, refresh date, fetch time,
both licence fields and a SHA-256 of the download.

- `node tools/fetch-cafeto.mjs [--force]` downloads the package record and GeoJSON to `~/.cache/slop-toronto/raw/cafeto/`
  (kept unless `--force`) and writes the dated snapshot.
- `node tools/build-cafeto.mjs` writes `js/toronto-cafeto.js` (93 KB) from the newest snapshot. It projects each record with
  the city's projection and clips it to the detail frame. Only sidewalk and curb lane cafés become records; the others are
  counted. It fails on an empty snapshot, a missing or duplicate licence number, or an unknown intervention type.

## What the data is, and is not

- The fields are intervention type, licence number, operator, business address, proposed street (curb lane cafés only),
  ward, BIA, municipal address and category. `CONDITIONS` is `None` on every record.
- The geometry is the **business address point**. Projected into the game, every point lies inside the building, 10–25 m
  from the street's centre line (median 14 m past the curb for curb lane cafés). The data has no footprint, length, width,
  seating, orientation or season dates.
- Sidewalk café records have no frontage street, so the street is taken from the municipal address (`101-103 RONCESVALLES
  AVE` → `RONCESVALLES AVE`).
- The datastore's `_id` is a row number. The licence number is unique and is used as the stable ID.
- In the detail frame there are **386 sidewalk cafés, 191 curb lane cafés and 364 private property patios**; 695 records
  are outside it.

## Season and the scene date

The game's day is fixed at 22 August (`js/lighting.js`; `CITY.SCENE_DATE` once the rinks work lands, read here when
present). The 2026 guidelines require curb lane platforms to be installed by June 1 and removed between October 1 and 15,
and the dataset lists the current season's permits. `patioSeason()` shows patios from June 1 to September 30. Sidewalk
cafés follow the same window because their records carry no dates. 22 August is in season, so all are shown. Outside the
window the layer builds nothing.

## Placement rules (`js/patio-layout.js`)

Every record is matched to a game road with the same normalised name within 45 m of its address point; otherwise it is
rejected as `frontage`. From the road's centre line the code finds the address's side, the curb (the first curb island
out, to 1 cm) and the building face (the City building part on that island). The address is taken as the door. Each
footprint may slide up to 3 m either way along the frontage to clear obstacles.

**Sidewalk café** (a railed strip against the building face, 6 m long or else 4.5 m, 0.9–2.4 m deep):

| Rule | Value | Source |
| --- | --- | --- |
| Pedestrian clearway between café and curb | 2.1 m, plus 0.3 m off the curb stone | CaféTO guidelines (2.5 m downtown streets not modelled) |
| Clearway starts beyond the furniture zone | trees, hydrants, rings, bins, poles by the curb | CaféTO "continuous straight path, clear of all obstructions" |
| The game's walkers' inner line (road half width + 1.7 m) stays clear | +0.4 m body | game (`pedestrian-routes.js`) |
| On one curb island, off buildings, ≥ 80% on the City's mapped sidewalk | `js/toronto-sidewalks.js` | game / City sidewalk layer |
| Clear of the corner's curb ramps, crossings' landings, stops' boarding areas | 3 m / 4 m / 4 m along | CaféTO clearances (3 m intersection/PXO, 2.5 m stop pole, 2.4 m boarding) |
| Clear of furniture, trees, Bike Share, subway entrances | 0.6 m from each | game |
| Entrance gap at the address | 1.2 m | CaféTO (accessible entrance ≥ 1 m) |
| Corner businesses | if the address street fails, the flanking street within 22 m | 2025 aerials (e.g. 80/88 Ossington, 757 Queen W) |

On a square-to-the-grid street the café may stand on the walkers' outer line (+2.8 m). Its box is then given to the
road network as a pedestrian obstacle. That affects 25 cafés. `pedestrian-routes.js` used to drop the outer line along
that edge. Since the sidewalk-detour port (upstream `2bcd413`, [upstream-sync](upstream-sync.md)), the line steps in
toward the curb past the café and back out. `?peddetours=0` restores the old behaviour.

**Curb lane café** (a deck level with the sidewalk in the curb lane, 7 m long or else 5 m, 1.8 m wide, 0.1 m gutter
gap):

| Rule | Value | Source |
| --- | --- | --- |
| Width | 1.8 m | CaféTO: the average curb lane café |
| Clear of the game's traffic lanes | lane centre + 1.5 m | game (`road-network.js` lanes; `cycling.js` CAR_CLEAR) |
| Clear of streetcar tracks | 1.8 m from the track centre | game (Flexity half width + 0.5 m) |
| In a curbside bikeway's place: room to route it round the platform | the bikeway's reserve (≥ 1.2 m for cyclists + the separator) + 0.2 m between the platform and lane centre + 1.5 m, and 1.8 m from a streetcar track | CaféTO platform guideline 4 (1.2 m for cyclists to the lane line); 2025 aerials ([below](#curb-lane-cafés-in-a-bikeways-place-st-74e)) |
| Signalised intersection ahead / unsignalised ahead / any behind | 30.5 / 15 / 9 m to the cross street's curb | CaféTO roadway placement |
| Laneway or driveway (a curb gap under 8 m) | 1 m | CaféTO |
| Pedestrian crossover or midblock signal ahead / behind | 15 / 9 m | CaféTO |
| TTC stop ahead / behind (GTFS stops and OSM streetcar stops, same side) | 30 / 18 m | CaféTO |
| Hydrant | 1.2 m | CaféTO clearances |
| Benches, bins, post boxes, pay stations, Bike Share | 1.0 m | CaféTO clearances |
| Wayfinding columns / information pillars | 3.0 m | CaféTO clearances |
| Transit shelters | 5.0 m | CaféTO clearances (shelter with advertising) |
| Bike rings | not applied | CaféTO footnote: less with City approval; rings stay usable from the sidewalk, and the permit exists |
| Neighbouring platforms | may run end to end | as on Ossington in the aerials |

"Ahead" and "behind" follow the curb lane's direction of travel: right-hand traffic, or the road's one-way direction.
After the traffic network is built, `auditPatioLanes` checks every platform against the lanes actually built. Any lane
within the platform's reach plus 1.3 m is logged.

## Results (2026-10-29 snapshot)

In the browser (desktop and phone tiers alike), **70 sidewalk cafés and 130 curb lane cafés** are placed from 577
records, with 0 lane conflicts (before `st-74e`: 70 and 119). Node's test harness places 71 and 128, because it uses the source points of benches, pay
stations and wayfinding in place of the browser's placed sites. 11 sidewalk cafés use the flanking street. Rejections in
the browser:

| Reason | Count | Meaning |
| --- | --- | --- |
| narrow | 166 | the sidewalk cannot hold a 0.9 m café beside the clearway (most of Queen W, Dundas W, Bloor W, Ossington) |
| sidewalk | 102 | the footprint would sit on unmapped forecourt or in a building (set-back buildings) |
| obstruction | 32 | furniture or trees in the way along the whole slide range |
| junction | 20 | inside an intersection setback |
| frontage | 19 | no game road of that name within 45 m of the address |
| lane | 16 | the curb lane is too narrow beside the game's lane |
| bikeway | 1 | no room to route the cycle track round the platform beside the game's lane (2200 Bloor W; 13 before `st-74e`) |
| overlap / stop / streetcar | 11 / 8 / 1 | (overlap 10 before `st-74e`: 351 Danforth now meets 347) |

Validated corridors (node audit, `tools/review-cafeto.mjs`):

| Corridor | Type | Records | Placed | Main rejections |
| --- | --- | --- | --- | --- |
| Ossington Ave | curb | 29 | 18 | junction 5, overlap 3, lane 2 |
| Ossington Ave | sidewalk | 7 | 1 | narrow 6 |
| Queen St W | curb | 25 | 19 | overlap 2, lane 2 |
| Queen St W | sidewalk | 26 | 5 | narrow 18 |
| College St | curb | 27 | 18 | junction 5, obstruction 2 |
| College St | sidewalk | 34 | 10 | narrow 14, obstruction 6 |
| Dundas St W | curb | 26 | 21 | junction 3, stop 2 |
| King St W | curb | 18 | 13 | stop 2 |
| King St W | sidewalk | 24 | 8 | narrow 9, sidewalk 6 |
| Danforth Ave | sidewalk | 37 | 20 | obstruction 9, frontage 5 |
| Danforth Ave | curb | 11 | 7 | frontage 3, overlap 1 (`st-74e`; before it, 0 placed, bikeway 8) |

## Validation against the City's 2025 aerials

`node tools/review-cafeto.mjs <out> --street "OSSINGTON AVE"` (or `--type curb --placed --sample 24`) crops the City's
[2025 8 cm orthophoto](https://gis.toronto.ca/arcgis/rest/services/basemap/cot_ortho_2025_color_8cm/MapServer). It
overlays the game's curbs (yellow), building parts (magenta), the address (cyan) and the footprint (green / orange) or
the rejection. The 2025 imagery was flown in summer, so platforms, tents and umbrellas are visible. Crops and contact
sheets stay in `~/.cache/slop-toronto/raw/cafeto/` and are never committed. Review sheets for this snapshot are in
`~/.cache/slop-toronto/raw/cafeto/review-20261029/`.

- **Ossington:** placed platforms at 146, 188, 94, 136, 72, 108, 225, 217, 218, 57 and 93 Ossington coincide with
  platforms visible in the curb lane. The real ones often run continuously along a block; the game places one per
  permit. The sidewalk cafés of corner businesses (80, 88) are along the side street. Ossington's sidewalks are rejected
  as narrow, so those are not placed.
- **Queen West, Dundas West, College, King West:** curb platforms land in the curb lane beside the streetcar tracks, in
  front of the address. Some 2025 frames show parked cars there, because the imagery predates the 2026 permits. Sidewalk
  cafés placed on College, King and the Danforth sit against the building face with the clearway to the curb.
- **Danforth and Bloor:** real curb lane platforms stand against the curb in the cycle track's place, and the track is
  routed round their road side ([below](#curb-lane-cafés-in-a-bikeways-place-st-74e)). The game builds them that way
  since `st-74e`; before it, the rules rejected them (`bikeway`).
- **Address quality:** a few records are geocoded to a rear lot more than 45 m from their street (189/193 Danforth).
  They are rejected as `frontage`.

Street View was not used. The aerials are the reference for this bead.

## In the game (`js/cafeto-patios.js`)

All geometry is procedural; there are no model files and nothing goes through the Meshy pipeline.

- **Curb lane café:** a wooden deck level with the sidewalk (0.22 m), a planter barrier 0.95 m high plus 0.22 m of
  planting on its three road sides (opaque parts under CaféTO's 1.2 m), the 1 m emergency gap in the road side, white
  reflective posts at the ends, table sets, and umbrellas with the fabric at 2.2 m (CaféTO: ≥ 2.1 m) on 70% of them.
- **Sidewalk café:** a black railing with a low cane-detectable rail on the street side and ends, open at the door (a
  piece beyond the door too short for a table set is left off, collider included), and table sets (smaller tables against the wall when the café is under 1.6 m deep). Umbrellas on 60% of those 1.5 m deep
  or more.
- **Cost:** 8 InstancedMeshes in all (deck, barrier, planting, post, rail, table, chair, umbrella), with 119 / 476 / 238 /
  238 / 930 / 362 / 724 / 179 instances, about 3.3k in total. `scene-culling.js` chunks them into 60 m cells and hides
  chairs beyond 90 m, tables and rails beyond 110–120 m, and decks and barriers beyond 220 m (scaled by the tier's
  `cull`). Only barriers and umbrellas cast shadows. Layout and build took about 250 ms on the contended M4 mini at both
  tiers until the layout was prebuilt (below). The build alone now takes 22 ms on the desktop tier and 25 ms on the
  phone tier (`CITY.patioStats.ms`, same mini).
- **Colliders:** one oriented box per patio, like a bench (sidewalk café 1.0 m high, platform 1.15 m). Oriented colliders
  stay out of the road network's obstacle list. Only the 25 cafés on the walkers' outer line add a box there. Every
  patio's oriented box is also in the walkers' own furniture list, so a detour round other furniture never cuts
  through a café.
- `CITY.patioStats` holds source provenance, counts, blockers, the placed sites, instance counts, which layout was used
  (`layout`), the input fingerprint check (`fingerprint`) and, when the layout ran, every record's reason.
  `?patios=0` leaves the layer out for comparison.

## Prebuilt layout (`st-cmf`)

The page no longer runs `js/patio-layout.js` at startup. `js/toronto-patios.js` (`window.CITY.PATIOS`, generated by
`tools/build-patios.mjs`) holds what that algorithm placed, and `js/cafeto-patios.js` only builds the instances and
colliders from it. Startup no longer parses the rules script or runs about 250 ms of layout.

**Why the browser computes it.** The layout reads more than the data scripts. It also reads what exists only once the
city is built:

- the solid static colliders: buildings' oriented boxes, mapped and procedural poles, shelters, pay stations and signs,
  and landmark outlines from their meshes;
- the benches, pay stations and signs as `street-props.js` laid them out against those colliders;
- the Bike Share footprints and the City sidewalk pieces `city-grid.js` cut.

Node cannot rebuild these faithfully. In a replay with every input from data alone, 42 cafés move by the 5 cm probe
radius round building boxes, and others change with the poles and the placed furniture. So the page computes the
layout itself, on the GPU runner like any capture, and the generator records it:

```
gpu2 <name> -- env CAPTURE_TAG=patios CAPTURE_QUERY='?patios=layout' node tools/capture.mjs tools/shots/patio-layout.json
node tools/build-patios.mjs <review dir>/patios-patio-layout.json
```

The desktop and phone tiers record the same layout. The generator writes two files, the same bytes from the same record:

- `js/toronto-patios.js` (shipped): each placed site's fields, exact (`id, kind, cx, cz, tx, tz, nx, nz, length, depth,
  entrance, outerLine, flank`), merged over its CaféTO record at runtime; the rejection and blocker counts; and a
  fingerprint of the runtime inputs.
- `tools/data/patio-inputs.json` (not shipped): what node cannot rebuild. That is the colliders the layout actually
  touched (603 of them) and the laid-out furniture near the cafés (576). It also holds every
  record's rejection reason and the SHA-256 of the data scripts the layout depends on.

**Staying in sync.** Three checks fail when an input drifts:

1. `tests/cafeto.test.mjs` replays `js/patio-layout.js` in node (`tools/patio-replay.mjs`) on the committed data
   scripts, with the recorded colliders and furniture. It must reproduce every shipped site to the bit, every count and
   every reason. A change to the sidewalks, geodata, CaféTO records, stops, signals, bikeways or the rules fails here.
   The generator runs the same replay and refuses a record it does not reproduce.
2. The same suite compares the SHA-256 of the data scripts behind the runtime inputs with the recorded ones. These are
   the poles, geodata, sidewalks, benches, pay stations, wayfinding, Bike Share, transit, subway, traffic and landmarks
   data. A rebuilt `js/toronto-poles.js`, for example, fails `npm test` until the layout is rebuilt.
3. At startup, `cafeto-patios.js` fingerprints the runtime inputs near the CaféTO addresses (80 m cells). These are the
   solid colliders the layout can see, the laid-out furniture, the Bike Share footprints and the sidewalk pieces. The
   fingerprint is an order-free hash of every number to 0.1 mm. If it differs from the shipped one, for example because
   a code change moved a pole or a collider, the page warns and lays the patios out at startup as before, so the city
   stays right. `tools/shots/cafeto-patios.json`'s stats shot fails on it, and on a page that did not use the prebuilt
   layout. The check takes 19–21 ms of that on the mini, about 7 ms on an M-series laptop.

`?patios=check` also lays the patios out at startup and compares the result with the prebuilt layout
(`CITY.patioStats.check`); the stats shot then requires it to be identical. `?patios=layout` uses the runtime layout and
exposes `CITY.patioLayoutDump`, the generator's input.

## Verification (2026-10-29)

- `node --test tests/cafeto.test.mjs` (12 tests) covers:
  - snapshot provenance and counts, and that the committed layer matches the build byte for byte;
  - broken inputs, address parsing and the season;
  - synthetic-street rules: clearway, narrow rejection, the frontage street, private patios, lanes, bikeway, streetcar,
    setbacks by direction of travel, stops, hydrants and adjacency;
  - on the real city, each placed footprint's invariants, with four aerial-checked Ossington platforms asserted;
  - every café's table sets clear of the door, and the script order.
- Full `npm test`: 253 tests, 240 pass, 13 fail. The 13 match `origin/feat/sidewalk-polygons` by name (241, 228, 13).
- `npm run build` passes and fingerprints `toronto-cafeto`, `patio-layout` and `cafeto-patios`.
- gpu2 (Mac mini, Metal WebGPU; contended by production transcription, so these are **functional evidence only**) ran
  `tools/shots/cafeto-patios.json`:
  - a stats check, then aerial and walker views of Ossington 146 (curb), Queen W 874 (curb), College 611 (curb) and
    660 (sidewalk), King W 309 (sidewalk) and Danforth 494 (sidewalk);
  - three runs: high tier at 1600×900, low tier at a 412×915 mobile viewport, and high tier with `?patios=0`;
  - receipts in `ride-anywhere-geo/review/gpu2/claude-patios/` (`{desktop,phone,before-desktop}--*.png`, console logs;
    `recheck-desktop--*` re-shoots Danforth after the door-stub fix; `claude-patios-run1/` is the first run);
  - results: both tiers place 71 + 119, 0 lane conflicts and no page errors. The only error is the known 404 of the
    locally prepared, unshipped bench GLB.

**Prebuilt layout (`st-cmf`, 2026-10-29).** gpu2 runs, functional evidence only: the mini was contended. Receipts are
in `ride-anywhere-geo/review/gpu2/claude-patios/` (`before-*`, `after3-*`, `check*-*`, `gen2-*`).

- The desktop and phone recordings are byte-identical, and the prebuilt layout equals main's runtime layout in sites,
  counts, reasons and blockers.
- Before (main) against after, desktop and phone, with this file's fixture and `tools/shots/mapped-poles.json`, these
  are identical: the patio sites and colliders, every patio and street-details instance matrix and colour, all 110,657
  static colliders and the laid-out furniture.
- `?patios=check` finds the prebuilt layout identical to the live algorithm's on both tiers.
- Patio startup went from 266–269 ms to 22–25 ms.

## Curb lane cafés in a bikeway's place (`st-74e`)

The City's 2025 aerials show the Danforth's and Bloor's curb lane platforms **against the curb**, where the cycle
track normally runs. The track is routed round their road side, between the platform's barrier and the separator posts,
and the parking lane gives way there. A cyclist rides that detour at 494 Danforth
(`~/.cache/slop-toronto/raw/cafeto/review-20261029/bikeway/zoom-494-danforth-cyclist.jpg`). `st-r40` (PR #22) put the
platforms beyond the bike lane instead, because the track was built before the patios. That PR is superseded. The
layout is now prebuilt (`st-cmf`), so `js/toronto-patios.js` is loaded before `js/cycling.js`, and the track bends
round platforms that are already known.

**Placement (`js/patio-layout.js`).** A curb lane footprint that meets a mapped bikeway (`bikewayIntrusion`, the bikeways
as mapped) is no longer rejected. The platform stands against the curb as anywhere else, with the 0.1 m gutter. The
layout then needs room to route the bikeway round it:

- It scans out from the curb (0.05 m steps, every 0.5 m along) for the bikeway's reach: 2.4 m on a cycle track, made up
  of the 1.85 m track, the 0.45 m separator and 0.1 m. PR #22 wrote this scan. A bikeway reaching 3.9 m or more is not a
  curbside one, and the platform is rejected (`bikeway`).
- The routed reserve must fit between the platform's road side plus a 0.2 m gap (`detourGap`) and the game's lane centre
  plus 1.5 m. It is narrowed if need be, but never below 1.75 m. That minimum is CaféTO's 1.2 m for cyclists (platform
  guideline 4: the platform's perimeter keeps 1.2 m clear of the lane line) plus the separator and 0.1 m. A streetcar
  track beyond the detour narrows it too, to 1.8 m from the track's centre (503 College).
- The site records `bikeway`: the reserve the routed bikeway may take beside it, in metres; 0 where there is none. It
  is a new field of `js/toronto-patios.js` (`PATIO_SITE_FIELDS`).
- Every other rule applies unchanged. Every site off a bikeway is the same as before, to the bit.

**Platform.** It is the same as any curb lane café: deck, planter barrier on its three road sides, the 1 m emergency gap
in the side facing the cycle track, and reflective posts at both ends (guideline 12). The side against the sidewalk is
open, as the guidelines require. PR #22's barrier on the curb side, with its access opening, is not needed, because no
bike lane runs between this platform and the curb.

**The detour (`js/cycling.js`, `routeRoundPatios`).** At load, if the patios will be built (in season, not
`?patios=0`), every bikeway piece beside such a platform is bent:

- The band's curb line moves out to the platform's road side plus 0.2 m. It runs fully out from 0.6 m before the
  platform to 0.6 m past it, and bends out and back over 5.5 m on each side as a smooth S, as the 2025 aerial of
  494 Danforth shows (about 5–6 m). A 2 m shift averages 1 in 2.75, 1 in 1.8 at its steepest.
- Platforms on one curb less than 12.2 m apart end to end share one detour: the margin and the bend at both ends
  (`DETOUR.bridge`, 2 × (0.6 + 5.5) m). Closer than that, the track could not bend back to the curb between them, so
  it runs straight across instead of dipping part way. The shared detours are 335-341 and 347 Danforth (5.1 m apart),
  407 and 411-417 Danforth (11.1 m) and 494 and 500 Danforth (2.6 m). With the earlier 8 m bend the threshold was 16 m,
  and the same three pairs shared.
- The stretch is resampled every 0.5 m and prepared again (normals, mitres, distances, levels). Each point carries `sq`:
  how much narrower than mapped the track is there, eased in and out with the bend.
- Everything drawn from the band follows it: the green paint, symbols, separator curb, flexi-posts, their colliders,
  and the reserve that `bikeLaneShift` keeps the traffic lanes clear of. So the track stays continuous and keeps its
  separator.
- `bikewayIntrusion` still answers for the bikeways as mapped, because the layout decides where they bend.
  `routedBikewayIntrusion` answers for them as built, and the parked cars keep out of those.
- `CITY.bikeDetourStats` holds the counts, and `[cycling]` logs them, with the lane edges a detour bounds more tightly
  than the mapped bikeway.
- There are no simulated cyclists. The player's bicycle rides the bent track between the platform's collider and the
  separator curb's.

**Result.** 11 platforms stand in a bikeway's place, in 8 detours over 7 bent track pieces:

| Platform | Routed reserve beside it |
| --- | --- |
| 335-341, 347, 407 and 411-417 Danforth; 1165, 1241 and 1566 Bloor W | the whole 2.4 m |
| 456 Danforth | 1.91 m; the track narrows to 1.36 m |
| 494 and 500 Danforth | 1.94–1.98 m; the track narrows to 1.39 m |
| 503 College | 2.13 m (the streetcar track); the track narrows to 1.58 m |

Routing takes about 4 ms at load. In the browser, one 62 m edge beside 494 and 500 Danforth is bounded more tightly by
its detour than by the mapped track. Its lane moves 2 cm, from 1.80 m to 1.78 m off the centre line
(`CITY.bikeDetourStats.laneEdgesAt`); no other lane moves. 351 Danforth now overlaps 347 (`overlap`). 2200 Bloor W is rejected (`bikeway`): the game's curb there leaves no room
beside its lane. The parked cars float beyond the track and give way at each detour (docs/parked-cars.md).

**Verification (2026-10-31).** These ran on gpu2 (`merge-captain-rinks`, the Mac mini, shared). They are functional
evidence only. Receipts are in `ride-anywhere-geo/review/gpu2/merge-captain-rinks/danforth-*`:

- **Layout.** `?patios=layout` was recorded, then `tools/build-patios.mjs` was run. The `js/toronto-patios.js` it wrote
  is byte-identical to node's replay. The page reports 70 + 130 placed, 0 lane conflicts, and a fresh fingerprint.
- **Captures.** `tools/shots/danforth-bikeway.json` ran on desktop (high tier, 1600×900) and phone (low tier,
  412×915 mobile), before (main) and after. The shots are:
  - 494 Danforth, 335-341 Danforth and 1165 Bloor W, each from near-nadir and north up (about 28 m top to bottom, as
    the City's orthophoto crops), at street level from the sidewalk, and from a 7 m oblique;
  - a cyclist riding the track through 494/500 Danforth's detour.
- **The ride.** No contact in the detour. The rider passes 0.91 m or more clear of the platform's road side, on the
  narrowed track. The desktop runs log 2 contacts about 47 m past 494, where the scripted rider turns off the track at
  Logan Avenue; that happens with either bend, and the phone runs log none.
- **Errors.** No page errors.
- **The 5.5 m bends (`danforth-v2-*`).** After the bends were tightened from 8 m, `?patios=layout` was recorded again.
  `tools/build-patios.mjs` wrote both files unchanged and the fingerprint held, so the layout did not drift. The same
  shots ran on desktop and phone, with the PR's earlier `danforth-after-*` frames as the before: 8 detours as before,
  70 + 130 placed, no page errors.

## Limitations and follow-ups

- No frontage widths: lengths are fixed (7/5 m and 6/4.5 m), and real Ossington platforms that run a whole block are
  shorter here.
- A platform in a bikeway's place bends the bikeway built at startup from the prebuilt layout. If the page lays the
  patios out again (stale inputs, `?patios=layout|check`), the bikeways still follow the prebuilt sites.
- 2200 Bloor W is rejected: the game's road there is narrower than the real one, which leaves no room for the detour
  beside the game's lane.
- The 2.5 m clearway that Chapter 742 requires on some downtown streets is not modelled; 2.1 m is used everywhere.
- Doors are assumed at the address point, and neighbours' doors are unknown.
- The flank rule for corner businesses is a heuristic backed by the aerials. It is not in the data.
- The layout is prebuilt (`st-cmf`, above). Rebuilding it needs a browser run on the GPU runner, because some of its
  inputs exist only in the built city.
