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
- `js/roadworks-layout.js` picks the records in effect on the scene's day (the City's dates and its weekday schedule; the
  hour of day is not used; the day the city opened on, today's for a preset) and places them.
- Placement: the record's name must match the road under it ("Yonge St" is "Yonge Street"). A closed lane is a line of
  barrels along its inner edge, a taper of cones at each end and a "ROAD WORK" / "LANE CLOSED" sign; long works on arterials
  add an arrow board. A closed road gets a row of barricades (jersey barriers on arterials) kerb to kerb at each end, a "ROAD
  CLOSED" sign and cones. Nothing goes on sidewalks, junctions, crossings, streetcar tracks, parked cars, flyovers or anything
  solid. Pieces are solid to the player. Eight instanced meshes, one material over one canvas atlas, group `CityRoadworks`.
- Traffic: a full closure's rows are boxes the cars stop behind (`setObstacles`), and edges a closure covers whole are closed
  to cars (`closeEdges`, as High Park's park roads). **Not done:** cars do not merge around a closed lane. They drive through
  it. Buses on routes still use closed edges.
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

## Follow-ups

Traffic merging around closed lanes; buses avoiding closed edges; hour-of-day schedules; the card in the search index.
