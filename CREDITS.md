# Credits

Slop Toronto is downtown Toronto and the waterfront in 3D, in the browser. The project's own code is under the MIT
License (`LICENSE`). Third-party code, data and assets keep their own licences, listed here.

## Engine and code

- **Slop New York** by mrdoob (Ricardo Cabello): the engine this is built on. MIT.
  https://github.com/mrdoob/slop-newyork
- **Abuja Tour** (abujatour.site), the Slop New York fork this was forked from, including the landing page's layout
  and styles (`css/landing.css`). MIT, © Mr.doob.
  Later Slop New York work ported onto it (to upstream 1b54e16): gamepad controls (`js/gamepad-controls.js`),
  pedestrians' connected routes & conversations (`js/pedestrian-routes.js`), vehicle bumpers & lamps, fire escapes,
  corner collisions, bicycle coasting, restored visits, traffic that stays populated, SSR & road-marking fixes.
- **aalghooneh/slop-toronto** by aalghooneh, another Toronto fork of Slop New York: the car's powertrain, arcade
  handling & handbrake, crash damage, and the pedestrians knocked down as ragdolls (`PersonRagdoll` in
  `js/pedestrians.js`, the knock-downs in `js/traffic.js`, the driving in `js/controllers.js`). MIT, © Mr.doob & Slop
  Toronto contributors.
  https://github.com/aalghooneh/slop-toronto
- **unable12/slop-sanfrancisco** by Kamil (@unable0_), a San Francisco fork of Slop New York: the static world contact
  (`js/world-collision.js`: the car's tapered footprint with full SAT and concave outlines, circles against the
  nearest boundary), the substepped movement and wall sliding in `js/controllers.js`, the R key's road reset and the
  idea of the `?debug=collisions` review (`js/collision-debug.js`), adapted to this city. MIT, © 2026 Mr.doob & Kamil.
  https://github.com/unable12/slop-sanfrancisco
- **Later Slop New York improvements**, reviewed through mrdoob's `2018076` (2026-10-26): vehicle contact physics,
  pedestrian avoidance/dives, player lamps, audio refinements, procedural tree LODs and filtered fire escapes (MIT,
  same upstream attribution above). Adapted for Toronto's decks, crossings, quality tiers and existing driving model.
  See [the integration record](docs/upstream-sync.md) for source commits and scope.
- **City audio** (`js/audio-*.js`): mrdoob's synthesized spatial audio from Slop New York (MIT, above), with the
  player car's tyre squeal and engine revs from aalghooneh's slop-toronto fork (MIT, © Slop Toronto contributors).
  https://github.com/aalghooneh/slop-toronto. Every sound is synthesized in code; no recordings.
- **Physically based lake water** (`?water=pbr`, `js/pbr-water.js`): mrdoob's "Physically Based Estuary Water" from
  Slop New York (MIT, above), as also carried by Slop San Francisco by @unable0_ (MIT), refitted to Toronto's
  waterfront. https://github.com/unable12/slop-sanfrancisco
- **three.js**, WebGPURenderer and TSL, loaded from jsDelivr at a pinned dev-branch commit. MIT.
  https://threejs.org/
- **Stylized water** (`js/stylized-water.js`, built from `vendor/stylized-water`): John Fewell's three.js port of
  Uber Stylized Water. MIT, © MatrixRex / norio. See `vendor/stylized-water/LICENSE`.
- **three-clouds-webgpu** (`js/clouds.js`, built from `vendor/clouds/three-clouds-webgpu-0.1.0-alpha.6.tgz`): John
  Fewell's volumetric clouds for WebGPU, a port of takram's three-clouds. MIT, © Shota Matsuda & John Fewell; notice in the tarball's
  LICENSE. Built on **@takram/three-atmosphere 0.19.1+fork.7** and **@takram/three-geospatial 0.9.1+fork.7** (MIT, © takram; compatibility fixes by John Fewell).
- **EZ-Tree** by Dan Greenheck: procedural trees. MIT. https://github.com/dgreenheck/ez-tree
- **lil-gui** (loaded only for the `?waterTune` tuning panel). MIT.
- **Umami** (https://umami.is), self-hosted at umami.cloud6711.workers.dev: privacy-friendly page analytics, counted
  only on sloptoronto.ca; no cookies. MIT.
- **aalghooneh/slop-toronto** by aalghooneh, another Toronto fork of Slop New York. MIT.
  https://github.com/aalghooneh/slop-toronto. Ported from it, adapted to this city's scripts and data:
  - the TTC streetcars (`js/streetcars.js`: track chaining & direction of travel, stops, signals, queuing, the Flexity
    Outlook model & livery) and the traffic keeping behind them (the streetcars block in `js/traffic.js`), the paved
    rights-of-way (`js/city-grid.js`);
  - the Union Station Rail Corridor's ballast and rails (`js/rail-corridor.js`; the GO trains are this project's own);
  - the rest of Toronto around the detailed city (`js/surroundings.js`): the procedural ground on the terrain, the
    land-use map, the far house rows, mid-rise & high-rise clusters, the Hearn's stack, Casa Loma, Gibraltar Point's
    lighthouse;
  - the facade colours measured from Wikimedia Commons photos: `tools/commons-palette.py`,
    `tools/data/commons_palette.json` (used in `js/buildings.js`) and the photo credits below.

## Map and city data

- **City of Toronto Open Data**, under the Open Government Licence – Toronto
  (https://open.toronto.ca/open-data-license/): 3D Massing, Topographic Mapping – Edge of Roadway, Street Tree Data,
  Water Hydrants, Bicycle Parking, Street Furniture – Transit Shelter, Street Furniture – Litter Receptacle, Cycling
  Network (the bike lanes, cycle tracks, sharrows & multi-use trails: `tools/fetch-cycling.mjs`, `js/cycling.js`).
  Contains information licensed under the Open Government Licence – Toronto.
- **City of Toronto Open Data, traffic & pedestrians**, under the Open Government Licence – Toronto
  (https://open.toronto.ca/open-data-license/): Traffic Signals Tabular (the traffic signals, pedestrian crossovers and
  flashing beacons, their modes of control, pedestrian walking speeds and leading pedestrian intervals), Pedestrian
  Network (the crosswalks), Traffic Volumes – Multimodal Intersection Turning Movement Counts, Traffic Volumes –
  Midblock Vehicle Speed, Volume and Classification Counts, and Traffic Signal Vehicle and Pedestrian Volumes; Traffic
  Signal Timing was read but not used (it carries no cycle lengths or splits). `js/toronto-traffic-data.js` is built
  from them by `tools/fetch-opendata.mjs` and `tools/build-traffic-data.mjs`. It is keyed to the OpenStreetMap road graph
  below (each street's volume, the junctions each signal controls), so like `js/toronto-geodata.js` it is also made
  available under the ODbL 1.0. Contains information licensed under the Open Government Licence – Toronto.
- **City of Toronto Open Data, sidewalks**: "Topographic Mapping – Physical area of sidewalks"
  (https://open.toronto.ca/dataset/topographic-mapping-physical-area-of-sidewalks/), under the Open Government Licence –
  Toronto as stated on the dataset page (its CKAN record's licence field is empty). `js/toronto-sidewalks.js` (by
  `tools/build-sidewalks.mjs`, fetched by `tools/fetch-sidewalks.mjs`) keeps the polygons simplified and clipped to the
  curb islands of `js/toronto-geodata.js`, and records the resource, refresh date and download hash it was built from.
  Because it is clipped to and indexed by those islands, like `js/toronto-traffic-data.js` it is also made available
  under the ODbL 1.0. Contains information licensed under the Open Government Licence – Toronto.
- **City of Toronto Open Data, Topographic Mapping – Poles**, under the Open Government Licence – Toronto
  (https://open.toronto.ca/dataset/topographic-mapping-poles/): resource "Poles - 4326.gpkg"
  (`5504d484-1bd6-4330-b43c-d562b74a175d`, updated 2026-02-20, SHA-256 `1b4722aa…57b8ec`; the CKAN package's licence
  field is empty, as for some other City packages; the portal's terms are the OGL – Toronto). The street light, light & signal and traffic signal poles
  inside the detail frame are `js/toronto-poles.js` (`tools/fetch-poles.mjs`, `tools/build-poles.mjs`); street-details.js
  stands the city's poles and signal heads on them. Contains information licensed under the Open Government Licence –
  Toronto.
- **TTC timetable**: "Merged GTFS – TTC Routes and Schedules" (the Toronto Transit Commission's GTFS, all modes) from
  City of Toronto Open Data, under the Open Government Licence – Toronto
  (https://open.toronto.ca/dataset/merged-gtfs-ttc-routes-and-schedules/). `js/toronto-transit.js` (by
  `tools/build-transit.mjs`, fetched by `tools/fetch-gtfs.mjs`) keeps only the routes' stopping patterns through the
  city, their stops and trips per hour on a weekday; the streetcars, buses and Line 2 trains run at those headways.
  Contains information licensed under the Open Government Licence – Toronto.
- **TTC live vehicle positions**: "TTC BusTime Real-Time Next Vehicle Arrival (NVAS)", the Toronto Transit Commission's
  GTFS-Realtime vehicle positions (https://bustime.ttc.ca/gtfsrt/vehicles) from City of Toronto Open Data, under the
  Open Government Licence – Toronto (https://open.toronto.ca/dataset/ttc-bustime-real-time-next-vehicle-arrival-nvas/).
  The site's Worker (`worker/live.js`) reads it at most every 15 s; the streetcars and buses run where the TTC's are
  (`js/transit-live.js`). Contains information licensed under the Open Government Licence – Toronto.
- **Bike Share Toronto** (Toronto Parking Authority): the stations' places, sizes and live bike counts come from its
  GBFS feeds (station_information, baked into `js/bike-share-stations.js` by `tools/geo-bikeshare.mjs`; station_status,
  read by the browser once a minute), as published through the City of Toronto's Open Data "Bike Share Toronto" dataset
  under the Open Government Licence – Toronto. https://open.toronto.ca/dataset/bike-share-toronto/
- **Toronto Parking Authority machine locations**: the public GreenP ArcGIS organization's
  [2026 On-Street Machines Update](https://www.arcgis.com/home/item.html?id=723d820cbadb44958803713d3cb9652a),
  specifically its S5 install points and DG4 decommission points, downloaded 2026-10-28.
  These are a dated machine rollout snapshot, not live availability or parking-zone centroids.
  The source item's licence field is empty; this layer is recorded separately from the OGL-labelled CKAN sources above.
  Snapshot, source links and filtering are preserved in `tools/data/parking-meters-20261028.json`;
  `tools/build-parking-meters.mjs` writes `js/toronto-parking-meters.js`.
- **OpenStreetMap**: streets, places, water and land use, the streetcar & railway tracks and the streetcar stops, and
  which side of the street each bikeway is on (cycleway tags). © OpenStreetMap contributors, under the Open Database
  License (ODbL). https://www.openstreetmap.org/copyright
  The city database built from it, `data/toronto-geodata.bin` and `js/toronto-geodata.js` (by `tools/build-geodata.mjs`), is a derivative database
  and is made available under the ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/), not the MIT License.
- **AWS Terrain Tiles** (Mapzen "terrarium" tiles, SRTM-derived elevation). https://registry.opendata.aws/terrain-tiles/
- **Wikimedia Commons photos** of Toronto's buildings: the facade base colours (`tools/data/commons_palette.json`) were
  measured from 384 freely licensed photos (CC0, public domain, CC BY, CC BY-SA). The photos are not in this
  repository; each is credited with its author, licence and link in
  [`tools/data/commons_photos.md`](tools/data/commons_photos.md).

## Models and textures

- **Poly Haven** textures (CC0): `brick_wall_07` (the ROM's heritage brick, warmed to buff) and other Poly Haven
  surfaces in the ROM model. https://polyhaven.com/
- **Street props** (hydrant, mailbox, bike ring, transit shelter, litter & recycling bin: `assets/props/`) by John
  Fewell, simplified for the city (meshoptimizer, textures cut to 512–1024 px).
- **Parking pay station** (`assets/props/parking-meter.glb`): John Fewell's Meshy source and his
  2026-10-27 Roncesvalles photographs, rebuilt as clean geometry and baked by `tools/blender/bake_props.py`.
  Height is John's requested six feet; the solar orientation and front payment panel were corrected against his photos.
  Green P and Flowbird markings depict the physical machine. See `docs/parking-meters.md` for provenance and verification.
- **Park name sign** (`assets/props/park-sign.glb`, `assets/props/park-sign-face.webp`): the City of Toronto's "A City
  Within a Park" sign, modelled in Blender from John Fewell's photo of the Ritchie Avenue Parkette sign
  (`tools/blender/bake_props.py park-sign`); its blank face is his photo straightened, the name and address painted out
  with Nano Banana Pro (Gemini) and flattened. The sign's design, its pet icons and the Toronto logo are the City of
  Toronto's. Each park's name and address (drawn on the face in the browser) are from OpenStreetMap.
- **TTC subway pylon** (`assets/props/ttc-pylon.glb`, `assets/props/ttc-logo.webp`): the TTC's insignia pylon with
  its entry ID sign at the subway entrances, modelled in Blender from the City/TTC drawing ("Insignia Pylon, w/ Entry
  ID Sign") and Street View (`tools/blender/bake_props.py ttc-pylon`). TTC logo and subway signage design: Toronto
  Transit Commission (trademark), used to depict the real street signage; logo file supplied by John. The station
  names, lines and accessibility are from OpenStreetMap.
- **Bike Share Toronto station** (`assets/props/bike-share-dock.glb`, `bike-share-kiosk.glb`, `bike-share-bike.glb`):
  the dock, the pay station and the PBSC "Iconic" city bike in the system's 2026 orange, modelled in Blender from
  measured Street View references (Queens Quay & Yonge, York & Queens Quay, Fort York & Capreol, Euclid & Bloor) and
  Nano Banana Pro (Gemini) reference views (`tools/blender/bikeshare_props.py`), without the sponsor's lettering. Dock,
  kiosk and bike design: PBSC Urban Solutions / Bike Share Toronto, depicted as they stand in the street.
- **TTC subway lantern** (`assets/props/ttc-lantern.glb`): the TTC's older square lit "TTC" lantern on its stainless
  pole (on the pole's top, or hung from an arm), at the entrances that still have one, modelled in Blender from
  measured Street View references (Osgoode, Chester, St Patrick; `tools/blender/bake_props.py ttc-lantern`), printed at
  runtime with the TTC logo above. Lantern and logo design: Toronto Transit Commission (trademark), used to depict the
  real street signage. Which entrances have one: a Street View survey, its evidence in `tools/geo-subway.mjs`
  (LANTERNS); the entrances themselves from OpenStreetMap.
- **CN Tower model** (`assets/landmarks/cn-tower.glb`): "CN Tower low poly model base mesh" by C.J..Goldman
  (https://sketchfab.com/C.J..Goldman),
  https://sketchfab.com/3d-models/cn-tower-low-poly-model-base-mesh-da7bbf4926de434cb5ef8d0e0bea9d59, licensed CC BY 4.0
  (https://creativecommons.org/licenses/by/4.0/). Modified: display plinth removed, scaled to 553.3 m, glass made opaque
  dark glass, compressed (`tools/blender/export_cn_tower.py`).
- **Royal Ontario Museum model** (`assets/landmarks/rom.glb`): from John Fewell's rom-heist project, a SketchUp shell
  re-textured in Blender (`tools/blender/export_rom.py`), with SketchUp library materials and a Flag of Canada image.
  It is not covered by this project's MIT License.
- **Cloud noise textures** (`assets/shape.bin`, `assets/shape_detail.bin`, `assets/turbulence.png`,
  `assets/local_weather.png`) come with three-clouds-webgpu / takram (MIT).
- **Star catalogue** (`assets/atmosphere/stars.bin`, the `?atmosphere=1` night sky) comes with @takram/three-atmosphere
  (MIT, © takram): the 9,096 stars of the Yale Bright Star Catalog version 5 (public domain) as directions, magnitudes and
  colours.
- **Water textures** (`assets/water/`) come with Uber Stylized Water (MIT, © MatrixRex / norio).

## Not affiliated

Slop Toronto is a fan project. It is not affiliated with or endorsed by the City of Toronto, the landmarks shown or
their owners. Name boards show places' names, not their trademarked logos. The screenshots on the landing page are
from the app itself.
# City Open Data additions

Street bench locations, washroom information and park/recreation amenity records: City of Toronto Open Data, dated 2026-10-28 snapshots, under the source packages' Open Government Licence – Toronto. Dataset/resource IDs and dates are preserved in `tools/data/*-20261028.json`; see [the layer documentation](docs/city-open-data-layers.md).

Drinking-water, outdoor rink and tennis discovery metadata: City of Toronto Open Data's Parks Drinking Fountains, Outdoor Artificial Ice Rinks and Tennis Courts Facilities datasets, dated active datastore snapshots under Open Government Licence – Toronto. Related park links preserve outlet types, reported status dates, dimensions and public/club distinctions; see the same layer documentation.

Tennis court footprints: OpenStreetMap contributors, ODbL 1.0, from the existing Geofabrik Ontario cache processed October 23, 2026. Facility associations, counts and pavement boundaries were checked against City of Toronto 2025 aerial imagery; reference images are not shipped. Court markings follow the ITF 2026 Rules of Tennis. Game geometry is original. See [court sources, disagreements and checks](docs/tennis-courts.md).

Outdoor rink and skate-trail footprints: City of Toronto, Outdoor Recreation Area polygons from the City's public GIS service (cot_geospatial13 layer 34, fetched October 28, 2026), joined by asset ID to the Open Data rink inventory. Boards, gates and off-season appearance were reviewed against City of Toronto 2025 aerial imagery and the City's 2019 Dufferin Grove Park presentation; reference images are not shipped. Game geometry is original. See [rink sources, season rule and checks](docs/outdoor-rinks.md).

CaféTO patios: City of Toronto Open Data, [CaféTO Locations](https://open.toronto.ca/dataset/cafeto-curb-lane-parklet-cafe-locations/), a dated 2026-10-29 snapshot (resource refreshed 2026-09-29) under the Open Government Licence – Toronto as stated on the dataset page (the CKAN licence field reads "notspecified"). Resource ID, refresh date, fetch time and SHA-256 are kept in `tools/data/cafeto-20261029.json`. Placement rules follow the City's 2026 CaféTO Curb Lane Café Guidelines; placements were checked against City of Toronto 2025 aerial imagery, which is not shipped. Patio decks, barriers, railings, tables, chairs and umbrellas are original procedural game geometry. See [CaféTO patios](docs/cafeto-patios.md).

Cast-Iron Plaza Bench by [Polyfork](https://polyfork.dev/asset/cast-iron-plaza-bench-b4096d), selected by John. Core bench extracted and meshopt compressed, used under the [Polyfork licence](https://polyfork.dev/licensing). Included inside the game; the standalone model is not distributed in this repository.

TO360 model: John's supplied Meshy Roncesvalles/Dundas sign, rebuilt with clean geometry and a front print projected from John's June 25, 2026 photograph. Information pillar: original game geometry based on the City of Toronto's dimensioned InfoToGo drawings. Wayfinding locations: City Open Data. Local sign maps use the existing OpenStreetMap-derived city geography. Google Street View was used for local reference only; no Google imagery ships in these props. See [wayfinding provenance and validation](docs/wayfinding.md).
