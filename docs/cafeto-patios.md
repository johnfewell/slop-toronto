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
| Not over a mapped bikeway | `bikewayIntrusion` | CaféTO cycling clearance; layouts beyond a curbside bikeway not modelled |
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

In the browser (desktop and phone tiers alike), **71 sidewalk cafés and 119 curb lane cafés** are placed from 577
records, with 0 lane conflicts. Node's test harness places 71 and 118, because it uses the source points of benches, pay
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
| bikeway | 13 | a curbside bikeway (Danforth, Bloor, College) |
| overlap / stop / streetcar | 10 / 8 / 1 | |

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
| Danforth Ave | curb | 11 | 0 | bikeway 8, frontage 3 |

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
- **Danforth:** real curb lane cafés sit beyond the curbside cycle track (tents outside the bike lane). The rules reject
  them (`bikeway`) rather than invent a layout around the cycle track.
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

## Limitations and follow-ups

- No frontage widths: lengths are fixed (7/5 m and 6/4.5 m), and real Ossington platforms that run a whole block are
  shorter here.
- Danforth/Bloor curb cafés beyond a curbside cycle track are rejected. Modelling them needs the cycle track's real
  position and a platform outside it.
- The 2.5 m clearway that Chapter 742 requires on some downtown streets is not modelled; 2.1 m is used everywhere.
- Doors are assumed at the address point, and neighbours' doors are unknown.
- The flank rule for corner businesses is a heuristic backed by the aerials. It is not in the data.
- The layout is prebuilt (`st-cmf`, above). Rebuilding it needs a browser run on the GPU runner, because some of its
  inputs exist only in the built city.
