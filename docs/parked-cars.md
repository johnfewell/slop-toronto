# Parked cars

Bead `st-0x9` (related: `st-2m8`, the vehicle bodies from PR #30). Cars stand parked at the curbs where Toronto allows it.
They use the traffic's own bodies (sedans, SUVs, minivans, pickups and delivery vans), its Ontario plates and its paint,
with every lamp off. They are solid, and the traffic keeps out of their way. Where they go is decided offline, by rules,
from the City's data. Every visitor sees the same cars in the same places.

## Sources

| Data | What it gives | Where |
| --- | --- | --- |
| [Traffic and Parking By-Law Schedules](https://open.toronto.ca/dataset/traffic-and-parking-by-law-schedules/) (City of Toronto, OGL – Toronto) | Municipal Code Chapter 950's curb schedules: 950-13 No Parking, 950-14 No Stopping, 950-16 No Standing, 950-15 Parking for Restricted Periods, and the reserved curbs (taxi stands, loading zones, bus and delivery zones, car share, EV charging) | `tools/data/parking-bylaws-20261030.json` |
| [On-Street Permit Parking Area Maps](https://open.toronto.ca/dataset/on-street-permit-parking-area-maps/) (City of Toronto, OGL – Toronto) | the permit parking areas' outlines | `tools/data/permit-parking-20261030.json` |
| Toronto Parking Authority pay stations ([parking-meters.md](parking-meters.md)) | paid parking: each machine's payment zone | `js/toronto-parking-meters.js` |
| The city's own data | curbs, the traffic lanes, streetcar tracks, bikeways, hydrants, TTC stops, crossings, signals, Bike Share and the CaféTO platforms | the committed data scripts |

`node tools/fetch-parking.mjs [--force]` downloads both datasets to `~/.cache/slop-toronto/raw/parking/`. The by-law file
is about 800 MB in one JSON, so it is fetched in ranged pieces and parsed record by record. The script keeps the curb
schedules' records that are in force (not repealed) and on a street the game has. It writes those 6,741 records, and the
53 permit areas reaching into the frame, to the dated snapshots with their resource IDs, dates, licence and SHA-256.

`node tools/build-parking.mjs` resolves the by-laws onto the game's streets and writes `js/toronto-parking.js` (247 KB,
build input only, not loaded by the page):

- **The stretch.** A record's "Between" text names two ends. An end can be a cross street, a point so many metres north,
  south, east or west of one, a point "further" on, a street's end, or "the lane first south of" a street. A lane is taken
  as 40 m past the street, because the game has no laneways. A cross street becomes the point where the two streets'
  centre lines meet in the game. When the game has no such point, the City's own `geoData` intersection is used instead.
  An offset moves along the highway's own direction. The game's frame follows Toronto's grid, so "north" is -z.
- **The side.** The record's side (North, South, East, West, Both, or a pair of them).
- **In force?** The cars stand all day, so a rule counts if it is in force on the game's day (22 August), taken as a
  weekday, at any time between 7 a.m. and 7 p.m. That makes a rush-hour no-stopping rule keep the curb clear. These
  rules do not count: winter-only rules (December to March), dated event closures, the "1st to 15th of the month" half
  of alternate-side parking, rules for weekends only, and night-only rules.
- Result: 4,654 rules (3,572 no parking, 685 parking allowed, 397 reserved). 436 records are not in force. Some records
  are left unresolved and counted by reason, never guessed:
  - 990 have an end the game cannot place, mostly streets outside the frame
  - 441 lie outside the frame
  - 206 have text the parser does not understand (for example "Northwest and southeast corners of York Street")
  - 14 have an implausible length

## Placement rules (`js/parking-layout.js`)

Each side of every named street (residential, living street, unclassified, tertiary, secondary, primary; not raised) is
walked stall by stall. A stall is 6.4 m along the curb (Toronto's marked on-street stalls run 6 to 6.7 m) and 2.0 m out
from it, with a 0.2 m gutter. Where a stall fails, the next one is tried 1 m further on. A stall is kept only if all of
these hold:

| Rule | Value | Source |
| --- | --- | --- |
| On the roadway, against one curb island that runs straight (curb within 0.6 m along the stall, at most 12 m from the centre line) | | game |
| A traffic lane's centre line keeps clear of the stall | 1.5 m | game (as the CaféTO platforms: a bus's half width and a little) |
| A streetcar track's centre line keeps clear | 1.8 m | game (a Flexity's half width + 0.5 m) |
| Not on a bike lane or cycle track, as built (routed round the CaféTO platforms in their place), nor a car's 0.35 m overhang past its stall | `routedBikewayIntrusion` | game / City cycling network |
| Beside a cycle track at the curb, on the Danforth and Bloor only (`FLOATING_STREETS`): floating beyond it, against its separator, 0.1 m off its reserve; the track along the whole stall at one width (not where it ends or bends out round a platform). Elsewhere a cycle track keeps its curb clear | | City (the Danforth's and Bloor's cycle tracks, 2025 aerials) |
| Hydrant | 3 m | City: no parking within 3 m of a hydrant |
| Intersection: the cross street's curb | 9 m (15 m approaching a signal) | City general rule (9 m); 15 m at signals is a game choice |
| Laneway or driveway (a curb gap under 8 m) | 1 m | City (driveways and laneways) |
| Pedestrian crossover or midblock signal ahead / behind | 15 / 9 m | game (as the CaféTO platforms) |
| TTC stop on that side, ahead / behind | 30 / 18 m | game (as the CaféTO platforms; the stops' own no-stopping zones are often in the by-laws too) |
| CaféTO curb lane platform | 1 m | game |
| Bike Share station | its footprint | game |
| Not in a road cut, not over a deck | | game |
| By-law: no parking, stopping or standing in force, or a reserved curb | | Chapter 950 (above) |

"Ahead" and "behind" follow the curb lane's direction of travel: right-hand traffic, or the street's one-way direction.
A car faces that way too.

Then **why parking is allowed** there:

1. **Paid:** a Toronto Parking Authority payment zone covers it. A zone's machines on one street span a stretch from the
   first machine to the last, plus 60 m beyond each end. A lone machine covers 60 m around it.
2. **Restricted:** a 950-15 by-law allows parking for a restricted period (1 hour, 3 hours...).
3. **Arterials** (OpenStreetMap secondary and primary: Spadina, University, Bay, Yonge, King, Queen, Dundas, College...)
   with neither of the above are **left clear**: these are the rush-hour routes. On these streets the City's pay stations
   and by-laws are the evidence that parking is allowed.
4. **Local streets** (tertiary and below) are parked on unless a by-law says not. This is Toronto's default: parking
   is allowed where it is not signed otherwise. A stall inside a permit parking area counts as `permit`, else `local`.

A prohibition always wins over an allowance (for example, a restricted-period stretch that is also a rush-hour
no-stopping zone).

## The cars (`tools/build-parked-cars.mjs` → `data/toronto-geodata.bin`)

Every legal stall is filled or left empty from a seed of its own position (an FNV hash of its coordinates). The share of
stalls filled depends on why parking is allowed there:

| Why parking is allowed | Share of stalls filled |
| --- | --- |
| Paid | 0.72 |
| Restricted | 0.70 |
| Permit | 0.82 |
| Local | 0.62 |

The car is drawn from the same seed:

- **Body:** sedan 36, SUV 38, minivan 12, pickup 7, van 7 in every 100. Vans are twice as likely on paid and restricted
  curbs (deliveries). There are no taxis or police cruisers.
- **Paint:** white, black, grey and silver about three in four. A 6% shade jitter varies each plate, because the
  material picks the plate from the paint.
- **Placement:** against the curb (0.15–0.35 m off), up to 0.25 m forward or back, and up to 1.4° askew.

The build's output is a row `[x, z, yaw, kind, paint, style, cat, order]` per car, positions in 1 cm and yaw in 1e-4 rad.
`order` is a seeded rank: a tier that shows fewer cars keeps the lowest ones. The rows are not what ships
([Packed](#packed)).

Results (2026-10-30 snapshots, with the floating parking of `st-74e`, below): **14,857 legal stalls and 11,012 parked
cars** (14,522 and 10,775 before).

| Category | Cars |
| --- | --- |
| Permit | 5,108 |
| Paid | 2,322 |
| Restricted | 2,099 |
| Local | 1,483 |

| Body | Cars |
| --- | --- |
| SUV | 4,105 |
| Sedan | 3,881 |
| Minivan | 1,271 |
| Van | 1,020 |
| Pickup | 735 |

Layout takes about 16 s in node. The streets the brief asked about:

- **Euclid** and **Palmerston** (residential, mostly 3.9 m one-way lanes with the curb lanes free): 162 and 98 stalls,
  on the side the by-laws leave open.
- **Roncesvalles** (paid): 117 stalls along its payment zones. The east curb's stalls fail the streetcar clearance in the
  game's geometry, where the track runs east of the roadway's middle.
- **King Street between Bathurst and Jarvis:** none. There are no pay stations, the by-laws prohibit stopping, and the
  streetcar holds the curb lane. West of Bathurst and east of Jarvis, King has paid parking where its machines are.
- **Spadina** and **University:** only along their payment zones. Their by-laws keep the rest, near intersections and
  stops, clear.
- **Bay, Yonge, Jarvis:** none.

Rejections, counted stall by stall: in the curb island 211,696; in a lane 160,579; by-law 109,745; arterial 18,659;
junction 11,574; bikeway 11,408; hydrant 3,445; stop 2,963; reserved 2,395; crossing 409; patio 371; streetcar 844.

## The surveyed Port Lands streets (`st-d9i6`)

The rebuilt Cherry and Commissioners Streets have no street parking. Along every surveyed way, the City's 2025
orthophoto shows no lay-by and no car parked at the kerb. Each chain in `tools/fixtures/road-surfaces.json` says what
was seen (`parking`, `parkingSeen`), and `parkingDeps` turns the surfaces marked `"none"` into `noParkingAt`. A stall
whose kerb-side point lies on one is rejected as `surveyed`. Ookwemin Street (old Cherry), where cars stand along both
kerbs, is marked `"kerbside"` and keeps its 47 stalls.

The effect, checked stall by stall and car by car against the build before it: 34 stalls and 28 cars go, all on
surveyed Cherry Street between Lake Shore and Polson. No other street's stalls or cars changed, and none was added.
The surveyed Commissioners stretch held no stall before either: the lanes and the kerb islands left no room.

## Floating parking beside the cycle tracks (`st-74e`)

On the Danforth and Bloor the parking lane sits outside the cycle track: curb, track, separator with posts, parked
cars, traffic. The rule applies only to the streets in `js/parking-layout.js` `FLOATING_STREETS` (Danforth Avenue,
Bloor Street West and Bloor Street East), the ones checked against the City's 2025 aerials. Every other mapped cycle
track keeps its curb clear, as before `st-74e`. A street is added to the list after its aerials show cars parked beyond
the track. On a listed street, where a stall's curb has a cycle track (`trackAt`: kinds `track` and `track2`, as built), the layout scans
out from the curb for the track's reach, as `js/patio-layout.js` does. The stall then floats beyond it, 0.1 m off the
track's reserve, and every other rule applies to it there. The track must run from the curb along the whole stall at
one width (within 0.3 m at the stall's ends and middle). Where it ends, or bends out round a CaféTO platform standing
in its place (`js/cycling.js` `routeRoundPatios`, docs/cafeto-patios.md), the stall is rejected (`bikeway`). So the
detour takes the parking lane there, as in the City's 2025 aerials, and no car stands in it. Painted bike lanes keep
their curbs clear as before. Parking beyond them would stand in the traffic.

Legality is unchanged: an arterial is parked on only along a pay station's zone or a by-law's restricted-period
stretch. Of the Danforth's long curbs, only those parts qualify. The cars, by street:

| Street | Stalls before → after (floating) | Cars before → after |
| --- | --- | --- |
| Danforth Avenue | 2 → 78 (76) | 1 → 54 |
| Bloor Street West | 25 → 281 (256) | 18 → 206 |
| Bloor Street East | 0 → 6 (6) | 0 → 5 |

The detours' 5.5 m bends (docs/cafeto-patios.md) leave the Danforth two stalls more than the earlier 8 m ones did.
Every other street keeps main's stalls, except where the car's 0.35 m overhang now meets a bikeway at a stall's end:
University Avenue (112 → 110 stalls, 93 → 87 cars, the stalls after them shifting along the curb) and Villiers Street
(175 → 174, 111 → 108). Applied everywhere, the rule would have parked beside Shuter, Gerrard East, Commissioners,
Saulter South, Hoskin, Mill, Harbord and others: about 340 stalls and 240 cars on streets nobody has checked.

## Packed

The cars ship inside `data/toronto-geodata.bin`, as the `PARKED_CARS` layer beside `GEO` and `POLES`
(`tools/geo-bin.mjs`), so the page has no script of its own for them and they arrive with the rest of the city.
`js/toronto-parked-cars.js` is build-only, like `js/toronto-poles.js`: `explore.html` does not list it, so
`tools/build-site.mjs` does not ship it. It is 260 KB, and `tools/pack-geodata.mjs` repacks it without the raw downloads.
`tools/build-parked-cars.mjs` repacks after writing it, as `tools/build-poles.mjs` does.

Nearly everything in a car's row is noise from its stall's hash: the body, the paint and its shade, the jitter on the
stall, the skew and the tier order. Noise does not compress, so storing those fields directly cost about 89 KB however
they were arranged. So the layer stores the stalls instead, and the page draws the cars again. `drawParkedCar` in
`js/parked-cars.js` is the one function that does this: the build places the cars with it, and `decodeParkedCars` calls
it for each stall, with the same seeds. Only what no seed gives is stored, one integer per car in each column:

| Column | Holds |
| --- | --- |
| `cat` | why parking is allowed (it weights the vans) |
| `heading` | the curb's direction, 1e-4 rad |
| `side` | which side of that direction the curb is on |
| `major`, `minor` | the stall's position in cm, as a step from the stall before: along the axis the heading nearly runs on, then across it less what the heading predicts |
| `cx`, `cz`, `cy` | corrections to x, z (cm) and yaw (1e-4 rad): the stall's position and direction are rounded here, so the placed car can come out a unit off |

The 3.5 MB by-law snapshot in `tools/data` and `js/toronto-parking.js` stay build input and never ship.

| Encoding | Added to the gzip'd binary |
| --- | --- |
| The rows as they were (`[x, z, yaw, ...]`) | 221.6 KB |
| The fields as columns | 113.2 KB |
| Palette index, shade step and heading-predicted steps | 89.0 KB |
| The stalls, with the cars drawn from their seeds | **36.8 KB** |

**Decoding** takes 2.8 ms in the page on the mini (2.3 ms in the phone-sized run, which is not CPU-throttled; both from a
shared mini, so indicative only). `CITY.parkedStats.decodeMs` records it. In node on the laptop it takes 9 ms for the
first run and about 1 ms once warm. It runs in `buildParkedCars`, after the binary's own `geodata-decode`, which the
layer barely adds to.

**Exactness.** `tools/build-parked-cars.mjs` throws if the decoded rows are not exactly the rows placed.
`decodeParkedCars` uses only `+ - * /`, `Math.round` and `Math.imul`, which every engine computes alike. It has its own
polynomial sine and cosine, because `Math.sin` and `Math.atan2` may differ by an ulp between browsers, and a test keeps
those functions out of it.

The packed section changes `data/toronto-geodata.bin` and its `?v=` in `explore.html`. It never changes
`js/toronto-geodata.js`, so the ID sidecar stays valid ([geodata-ids.md](geodata-ids.md)). Two branches that each repack
the binary conflict in that file: resolve by taking either side and rerunning `node tools/pack-geodata.mjs`.

## In the game (`js/parked-cars.js`)

- **Audit.** After the traffic network is built (`main.js`), each car is checked against the lanes `road-network.js`
  actually built (`edges[].lanes`). A lane's centre must stay 1.35 m from the car's body, a bus's half width and a
  little. On a local street (rank 1 or below, no bus contraflow) the gap is 1.15 m, a van's half width and a little. A
  car closer than that is left out and counted (`CITY.parkedStats.laneDropped`, split by `laneDroppedBy`). The node
  layout uses the road graph's own lanes; the browser's differ in places: chords between junctions, nodes merged at
  junctions, lanes shifted off a bikeway (`bikeLaneShift`). With a single 1.3 m gap everywhere, 389 of 10,775 cars (3.6%)
  were dropped on the desktop tier. Nearly all were on 3.9 m one-way local streets (Havelock, Bellwoods, Markham,
  Palmerston, Henry), plus 65 beside bikeways. With the gaps above: 225 on the desktop tier (2.1%; 181 on streets, 44 beside bikeways) and 110 of 5,000 on the phone tier. Cars on a CaféTO
  platform the page built are dropped too; there are 0 with the prebuilt patio layout.
- **Colliders.** One turned box per car, the body's length and width, as tall as the body (1.45–2.4 m), `kind:
  'parkedCar'`. The player's car stops against it, and walkers and cyclists meet it with their slim bodies. The
  helicopter flies over it, as over all street furniture. Pedestrians walk the sidewalks and crosswalks, which the stalls
  keep clear (9 m from intersections, the crossings' setbacks).
- **Traffic.** The cars keep to their lanes, which the stalls clear by construction and the audit checks. When a driver
  swerves round the player, `traffic.js` `wayRound` now tests `network.parkedAt` as well as the curbs, so a swerve never
  goes into a parked car.
- **Rendering.** For each body kind there is a full model (`buildCarGeometry` with its wheels) and the ~250-triangle
  stand-in (`buildCarProxyGeometry`). Both use the traffic's cached car material (`createLoftedCarMaterial`), so they
  share its pipelines. Each instance carries the traffic's `paintColor` and `carState`. The style code has a new parked
  bit (256), which turns every lamp off (`lampsOn` in `actor-models.js`). There is a contact shadow under each car
  within 60% of the far distance.
- **Culling.** Cars are kept in 64 m cells. When the camera has moved 2 m or turned, the cells in the view frustum within
  the far distance are re-picked: the full model within `Q.parkedNear`, the stand-in out to `Q.parkedFar` (both x
  `Q.dist`, the quality net's scale), and nothing further.

| Tier | Cars | Full model within | Stand-in to | Shadows |
| --- | --- | --- | --- | --- |
| high | all (≤ 12,000) | 70 m | 260 m | the full models cast |
| medium | 7,000 | 50 m | 200 m | the full models cast |
| low (phone) | 5,000 | 30 m | 140 m | none |

- **Multiplayer.** Unaffected: placement is static and seeded, and nothing is sent.
- `?parked=0` leaves the cars out (the before captures). `CITY.parkedStats` holds the counts, the drops, the instances
  drawn, the build time (35–46 ms on the mini) and the time to decode the packed stalls.

## CaféTO patios

The patio layout's drift checks (docs/cafeto-patios.md) did **not** trip. The parked cars are built after the patios
and after the traffic network, so their colliders are not among the inputs the patio fingerprint covers. The patios'
data-script hashes are also unchanged: the new scripts are not among the layout's sources. So the layout was not
re-recorded at first. `?patios=check` on the mini then found the prebuilt layout identical to the runtime layout (189
sites). The layout was also re-recorded per [cafeto-patios.md](cafeto-patios.md) (`?patios=layout`, then
`tools/build-patios.mjs`). That gave byte-identical `js/toronto-patios.js` and `tools/data/patio-inputs.json`, so **no patio
changed**. The parked cars avoid the 119 curb lane platforms by 1 m.

## Verification (2026-10-30)

**Captures.** These ran on the Mac mini through gpu2 (`slop-toronto-r3-desk`), with `tools/shots/parked-cars.json` on
the built site. The mini was shared, so they are functional evidence only. They are in
`ride-anywhere-geo/review/gpu2/slop-toronto-r3-desk/`:

- `parked-{before,after}-{desk,phone}--*`; the before shots use `?parked=0`
- the shots cover Euclid (street, aerial, midnight), Palmerston, Roncesvalles (street, aerial) and King at John (street,
  aerial)

What they showed:

- **Desktop:** 10,550 cars kept and 225 dropped by the audit. The build took 35–46 ms.
- **Phone tier:** 4,890 kept and 110 dropped.
- **Colliders:** one per car.
- **Errors:** no page errors. The only 404 is the static server's `/live/vehicles`.
- **Midnight:** the parked cars' lamps are dark.
- **King between Bathurst and Jarvis:** no parked car in its curb lanes.
- **Patios:** `?patios=check` found the layout identical (`parked-patiocheck-desk--*`), and the re-recorded layout came
  out byte-identical (`parked-patios--patio-layout.json`).

**From the binary (2026-10-31).** The cars were moved into `data/toronto-geodata.bin` after the captures above and
captured again with the same shots and flags, tagged `parked-bin-{desk,phone}--*`, plus `parked-bin-patiocheck--*`:

- **Rows:** all 10,775 decode to the same doubles as the previous `js/toronto-parked-cars.js`, every field of every car.
- **Desktop:** 10,550 kept and 225 dropped, with the same drops, kinds, categories and colliders as `parked-after-desk`.
- **Phone tier:** 4,890 kept and 110 dropped, likewise matching `parked-after-phone`.
- **Frames:** the parked cars match the earlier frames, and the instance counts per shot are the same. What differs is
  moving traffic (a van on Palmerston, a sedan on Roncesvalles) and the top bar's multiplayer pill, which showed in
  these runs and not the earlier ones.
- **Errors:** no page errors. The three 404s and the audio worker's warning are in the earlier run too.
- **Patios:** `?patios=check` found the layout identical (189 sites), and the fingerprint is not stale, so nothing was
  re-recorded.

**Tests.** `node --test tests/parked-cars.test.mjs` runs 14 tests:

- **Synthetic street:**
  - both curbs, lanes, 9 m from the corners, direction of travel
  - a narrow two-way street against a one-way one
  - hydrant 3 m, crossings by direction, CaféTO platform
  - bikeway, streetcar track in the curb lane, TTC stop
  - by-laws: no parking, reserved, an arterial kept clear, paid zone, restricted vs no stopping
- **Parser:** the by-law times and texts.
- **Committed data scripts:** both are their builds, byte for byte.
- **The binary:** its parked cars decode to exactly the generator's rows, every field of every car, and the decode uses
  no engine-dependent maths. `tests/geodata-binary.test.mjs` checks the packed layer against the script, and the
  committed binary against the three scripts packed.
- **Real city:**
  - clear of the lanes, hydrants, tracks, bikeways and patios; no overlaps
  - Euclid, Palmerston and Roncesvalles parked; King between Bathurst and Jarvis not
- **Load order and tiers:** the script order, the tier settings and the lamps-off style bit.

## Limitations

- Driveways appear only as curb gaps: the City's curb islands are cut at OpenStreetMap's service roads. Private
  driveways that OpenStreetMap does not map are not known.
- The pay station layer is the 2026 S5 rollout, not a complete inventory. Some paid streets (Roncesvalles south of its
  zones, much of the Danforth) are left clear for want of evidence.
- Floating parking (`st-74e`) is limited to the Danforth and Bloor. It follows the cycle track as mapped and built. The track's own gaps (driveways, loading
  zones) are not in the data, so stalls run on past them where the other rules allow.
- The by-laws are resolved onto centre lines by rule. Offsets move along the street's direction at the cross street,
  which is approximate on curves. "The lane first south of" is taken as 40 m.
- Parked cars are static: a rush-hour ban keeps the curb clear all day, and the cars do not leave at night.
