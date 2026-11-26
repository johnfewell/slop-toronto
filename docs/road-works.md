# Road works from the City's Road Restrictions

Bead `jf-w0s` (project tracker), 2026-11-26.

## Source and trust

[Road Restrictions](https://open.toronto.ca/dataset/road-restrictions/), resource "Road Restrictions (Version 3) - JSON"
(`https://secure.toronto.ca/opendata/cart/road_restrictions/v3?format=json`, Open Government Licence - Toronto). It is a live
feed of about 2,100 records. The permit applicants submit them and the City does not verify them in the field. A record has a
centre-line polyline of the stretch, start and end times, a daily schedule, a type (`CONSTRUCTION` or `ROAD_CLOSED`), a
description and "impact when reported". There is **no lane geometry**, so where barrels stand is a rule, not a survey.

## How it runs

- `worker/roadworks.js` cuts the feed to compact records inside a box round both playable frames; `worker/live.js` serves
  them at `/live/roadworks`, read from the City at most every 15 minutes (Cache API plus a module copy). A feed that is down
  or malformed is a 502.
- The page starts the request as its scripts run (`CITY.roadworksFeed`) and `js/roadworks.js` waits for it at most 2.5 s just
  before the street furniture is finished. No feed, a late one or any error: nothing is drawn and nothing is raised.
  `?roadworks=0` leaves the feature out.
- `js/roadworks-layout.js` picks the records in effect on the scene's day (the City's dates and its weekday schedule; the day
  the city opened on, today's for a preset) and places them. Which of those are at work is a matter of the scene's hour (below).
- Placement: the record's name must match the road under it ("Yonge St" is "Yonge Street"). A closed lane is a line of
  barrels along its inner edge, a taper of cones at each end and a "ROAD WORK" / "LANE CLOSED" sign; long works on arterials
  add an arrow board. A closed road gets a row of barricades (jersey barriers on arterials) kerb to kerb at each end, a "ROAD
  CLOSED" sign and cones. Nothing goes on sidewalks, junctions, crossings, streetcar tracks, parked cars, flyovers or anything
  solid. Pieces are solid to the player. Eight instanced meshes, one material over one canvas atlas, group `CityRoadworks`.
- Traffic: see "Traffic" below.
- The card (bottom-left, top on a phone) shows the City's text, dates, hours and impact, and says it is the City's report.

## Counts (feed fetched 2026-11-25 22:08 Toronto, scene day 2026-11-26)

| | phone / detail map | desktop / Eglinton map |
|---|---:|---:|
| records in the feed | 2,139 | 2,139 |
| in the playable box | 1,424 | 1,424 |
| in the loaded frame | 514 | 1,050 |
| in effect on the day | 392 | 836 |
| placed (lane / closed) | 338 (304 / 34) | 750 (636 / 114) |
| pieces drawn | 3,945 | 9,365 |

Rejected, Eglinton map: 39 records with no matching road (mostly unnamed laneways), 16 on flyovers, 31 with nothing clear.
Pieces rejected: no kerb found 2,252, streetcar track 400, overlap 246, obstruction 202, parked car 182, junction 112,
outside frame 56. 180 traffic edges closed, 155 stubs. Layout takes about 0.65 s at load.

## Traffic, buses, hours and search (jf-dqj)

**Hours.** A record's daily window ("07:00-19:00", `rec.sc`) is read against the scene's clock: `roadworks.setHour(hour)`,
called by `main.js` wherever it sets the traffic's hour (the time-of-day buttons, the live clock). Records not at work have their
instances squeezed to nothing (the meshes may have been cut into cells by scene-culling.js by then; the cells' instances are found
by where they stand), their colliders lifted out of reach, their obstacle boxes, closed edges and lane zones left out, all in
one step, so the props and the traffic switch together. A window that runs past midnight ("21:00-05:00") covers the small hours
of the next day; "00:00-23:59" is all day; a record with no schedule is always at work. The midnight preset therefore has no
07:00-19:00 works, and midday has them. On the recorded day (placed 722): 704 at work at noon (8,806 pieces, 2,647 barrels, 523
traffic edges closed with their stubs, 386 lane zones), 214 at 3 a.m. (2,729 pieces, 106 edges, 95 zones), 409 at 7:30, 303 at 18:54 and
207 at 19:06.

**Lane closures: what a driver does.** The layout puts the barrels at the inner edge of the physical kerb lane; the traffic's
own lanes (`edge.lanes`, offsets right of the centre line) are fewer, and not where the physical ones are (Bloor St W has one
modelled lane each way). `laneZoneTable` (roadworks-layout.js) finds, for each barrel, the traffic edges it stands on (same way
or opposite) and closes the lanes whose centre lies beyond the barrel line or within 1.5 m of it on the open side (a car
there would clip the barrels). One zone per record per edge: the closed lanes, from 11 m before the first barrel (the taper)
to 5 m past the last. Of 2,707 barrels on the desktop map's recorded day, 1,424 found a modelled lane they close; the rest
stand beyond the traffic's lanes. 386 zones: 41 with an open lane beside the closed one, 345 where none is open.
- *An open lane beside the closed one* (a merge zone). A driver in the closed lane starts to look for a gap 45 m before the taper
  and takes the lane towards the open one (one lane at a time), asking more room of itself and of the driver it cuts in front of as
  the taper nears and as it waits. Within 18 m of the taper still in the closed lane it brakes to a stop short of it and waits to be
  let in; after 45 s it goes on slowly rather than hold the road for ever. Nobody changes into a closed lane (traffic.js
  `laneSafe`) and nobody spawns in one. Everyone is held to 40 km/h by the taper (`zoneSpeedCap`), reached by a brake of 1.8
  m/s², not at once. Merging back is the ordinary lane choice (MOBIL) once the zone ends.
- *No open lane* (one lane each way, or the barrels leave none). Nowhere to merge to, and a closed lane that carries the traffic
  of that way is a closed road, which only a full closure is. So the drivers **pass slowly** (15 km/h by the taper) along the
  gap beside the barrels, edging 0.45 m away from them (`v.hug`, steering's target offset) instead of waiting: a wait with no
  end is a jam that never clears, and the City's lane closures on such streets are what let a car by in practice (a parking or
  bike lane, a flagger). They are slow, not stopped, and no more than a few centimetres from clipping.
- Measured on the Mac mini (tools/roadworks-traffic-measure.js, shots in tools/shots/roadworks-traffic-measure.json): the recorded
  feed at noon on 25 November 2026, 300 s of game time at each closure with the traffic round it as the City's counts give it,
  seed 1, once with the zones and once without them (the runs do not start from the same cars, so "vehicles passing" is noisy; the
  closed digits are one per lane, 1 = closed). 41 of the day's 386 zones have an open lane, 345 have none.

| road, edge | open lanes | vehicles passing | longest wait at the taper | queue back from the taper | body overlapping a barrel (samples of 1,500) | least gap to a barrel (m) |
|---|---:|---:|---:|---|---:|---:|
| Bloor St W e21519, 1 lane, closed `1`, 30 m, 527 veh/h | 0 | with zones: 26 | 0 s | 0 cars (0 m), mean 0.0, last third 0.0 | 0 | 0.62 |
| (same without zones) | | 7 | 0 s | 0 cars (0 m), mean 0.0, last third 0.0 | 0 | 0.2 |
| Harbour St e11818, 3 lanes, closed `110`, 56 m, 1055 veh/h | 1 | with zones: 25 | 32 s | 4 cars (16 m), mean 1.4, last third 1.2 | 0 | 1.21 |
| (same without zones) | | 20 | 1 s | 1 cars (4 m), mean 0.0, last third 0.0 | 32 | -0.49 |
| Overlea Blvd e11791, 1 lane, closed `1`, 43 m, 658 veh/h | 0 | with zones: 5 | 0 s | 0 cars (0 m), mean 0.0, last third 0.0 | 133 | -0.49 |
| (same without zones) | | 0 | 0 s | 0 cars (0 m), mean 0.0, last third 0.0 | 0 | None |
| Don Mills Rd e22790, 2 lanes, closed `10`, 67 m, 993 veh/h | 1 | with zones: 7 | 0 s | 18 cars (42 m), mean 7.4, last third 1.9 | 0 | 0.63 |
| (same without zones) | | 4 | 0 s | 2 cars (3 m), mean 0.6, last third 0.6 | 19 | -0.94 |
| Don Mills Rd e24339, 2 lanes, closed `10`, 48 m, 959 veh/h | 1 | with zones: 79 | 20 s | 5 cars (34 m), mean 0.7, last third 0.9 | 14 | -0.88 |
| (same without zones) | | 72 | 0 s | 10 cars (34 m), mean 1.6, last third 1.9 | 316 | -0.68 |
| Don Mills Rd e24339, 2 lanes, closed `10`, 64 m, 959 veh/h | 1 | with zones: 64 | 10 s | 7 cars (35 m), mean 1.1, last third 1.4 | 26 | -1.07 |
| (same without zones) | | 36 | 0 s | 8 cars (34 m), mean 3.4, last third 3.2 | 179 | -0.11 |

Where a driver is let in, it waits at most 32 s in these runs, and the queue it leaves is gone by the last third of the run (the
queue columns count the stopped vehicles in a line back from the taper). No vehicle stood for ever: those the run lists as standing over 60 s
were at a red signal in a queue on the street leading in. What is left of vehicles overlapping the barrels: in the crawl zones,
drivers within a few centimetres of clipping (the lane has no more room; a few at the first metres of a zone clip by up to 0.5 m
while edging over), and at a zone that starts at a junction's mouth, a driver who turned into the closed lane from a side street
slides over past the first barrels (0.4 s).

Cost. The traffic step stays at 0.3-0.9 ms a frame with the zones on or off (the same stepping, 300 s, on the same roads). Frame
time on the mini, uncapped, 20 s at a lane closure, main against this branch, two runs each, back to back: Bloor/King lane closure
median 16.4-17.0 ms against 16.4-16.7, p95 37.6-38.6 against 37.6-37.9; Queen lane closure median 14.6-14.7 against 14.6-14.7, p95
16.5-21.1 against 16.4-16.6 (a shared mini: noise). Switching the hour re-lays the closed edges and lane zones in about
75 ms on the mini (stats.trafficMs; the edges' grids, not a scan of every edge for every row).

**Buses.** An edge a full closure covers (or ends in a barricade row) is closed to every vehicle (`edge.worksClosed`), buses on
routes included: a bus whose next link is closed leaves its route and roams (traffic.js `routeMove`). `transit-buses.js`
takes each route's links round a closed stretch by the shortest way over open links when that is no longer than three times
the stretch plus 400 m (`detourRoute`, tests/roadworks-traffic.test.mjs); a closed stretch at a route's start or end is left
out; one in the middle with no way round **stays on the route** as a position (the scheduled bus passes it) and a bus on the road
leaves its route there. Not done: the TTC's own diversion notices, stops on a closed link (dropped from the route), and a bus
already on the road when the hours change goes off its route until it is recycled. On the recorded day, at noon: 12 closed stretches of bus routes taken round, 23 with no way round (left on the route), none at a route's end; at 3 a.m., with fewer works at work: 4 and 9.

**Search.** Each record placed on the scene's day is a place in the search box ("Lane closure · Bloor St W", "Road closed ·
Durie St", with its hours), found by street name or by "closure", "construction", "road works" or "detour"; picking one goes
to the nearest street in front of it, as any place does.

## Follow-ups

A driver let in at the last moment at a zone that starts at a junction's mouth can clip the barrels for a moment while it slides
over; a flagger-style alternation through the oncoming lane for one lane each way (now: a slow pass beside the barrels); the TTC's
own diversions for the routes it re-routes, and stops on a closed link; the search entries are the places, not the card's text.
