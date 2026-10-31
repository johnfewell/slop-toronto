# City street benches and facility information

Beads: `st-26p.1`, `st-26p.5`, `st-26p.16`. Snapshots fetched 2026-10-28.

## Benches

[City street-furniture benches](https://open.toronto.ca/dataset/street-furniture-bench/) supply stable IDs, asset type, frontage, side and Existing status. `tools/data/benches-20261028.json` preserves the complete source and resource/date/licence metadata. Run `node tools/build-open-data.mjs` to regenerate `js/toronto-benches.js`: 315 Existing points inside the detail frame. Temporarily removed assets are excluded. This inventory covers the coordinated street-furniture program, not every park bench.

John selected [Polyfork's Cast-Iron Plaza Bench](https://polyfork.dev/asset/cast-iron-plaza-bench-b4096d). The pinned source SHA256 is `06b9cc8850203a3c8acc06bfc96488c4abce99ce6d8e0e454cd2a5aee332040b`. `tools/prepare-bench.mjs` downloads the public GLB, retains only the closed `bench` node, prunes candles/flowers/papel/animation, and applies meshopt. The result is **13,796 bytes, one mesh/material**, at the source's approximately **1.8 × .96 × .8 m** scale. Runtime centers the footprint and grounds its base. Its +Z front faces the curb. No external model code or second Three.js runtime is used.

The [Polyfork licence](https://polyfork.dev/licensing) permits commercial games and modification but restricts standalone redistribution, including modified assets. The GLB is therefore **gitignored**, cached under `~/.cache/slop-toronto/props/plaza-bench/source.glb`, and shipped inside the built game. `npm run dev` and `npm run build` prepare it automatically. If a network client cannot download it, download the public `.glb` in a browser and run `node tools/prepare-bench.mjs /absolute/download/path.glb`. A changed upstream file fails the SHA check and requires review.

Placement matches the named frontage where possible; headings are inferred, not surveyed. It allows at most 1.25 m of correction away from the road, keeps the full seat and a 1.2 m walking strip on one curb island, and checks buildings, other furniture, boarding shelters and Bike Share. Nearby source duplicates are rejected. The initial scene accepts **258** sites and rejects 14 without a suitable road, 4 without sidewalk clearance, and 39 with obstructions. It adds oriented player colliders, uses existing instancing/culling and never scatters synthetic benches. `CITY.benchStats` exposes source IDs and rejection counts for inspection.

## Washrooms, parks and recreation centres

Sources are [Washroom Facilities](https://open.toronto.ca/dataset/washroom-facilities/) and [Parks and Recreation Facilities](https://open.toronto.ca/dataset/parks-and-recreation-facilities/). Complete datastore snapshots, including source resource IDs, dates and licence IDs, live under `tools/data/*-20261028.json`. Run `node tools/build-city-facilities.mjs` to regenerate the separate fingerprinted layer.

The import retains **78 local washrooms** and **276 parks/centres**. It suppresses one exact duplicate City park row and fails on conflicting identities or incomplete downloads. It matches 62 washroom points to a unique existing building footprint; park matching requires both a matching normalized name and point inside the existing park polygon. Recreation-centre matches additionally require the building name. In this washroom/park subset, 257 records match existing geometry; **97 remain unmatched** (16 washrooms, 81 facilities) and stay source-location search entries. Full IDs and match evidence/unmatched IDs remain in `CITY.CITY_FACILITIES.audit`. No source point causes a duplicate building, playground or court mesh.

Search indexes facility names, amenity lists and accessibility features. City records enrich same-name nearby OSM results without discarding distinct washroom asset IDs. Place cards display source addresses, hours, accessibility and location notes; status uses the City's 0/1/2 closed/open/service-alert coding **with its reported date**, never a claim of live availability. Related records link by City location ID. External details links accept only HTTPS City domains and open with `noopener noreferrer`; source strings use text nodes, not HTML. Existing directions/map actions remain available.

## Dedicated park discovery records

The same place cards now cross-link **248 drinking-water records, 17 outdoor rink records and 11 tennis access listings** to their City parks/centres. These use complete dated active datastores from [Parks Drinking Fountains](https://open.toronto.ca/dataset/parks-drinking-fountains/), [Outdoor Artificial Ice Rinks](https://open.toronto.ca/dataset/outdoor-artificial-ice-rinks/) and [Tennis Courts Facilities](https://open.toronto.ca/dataset/tennis-courts-facilities/). Their snapshots retain all original fields and resource/licence/date metadata. There are 630 local discovery records across the five kinds; 341 do not match existing rendered geometry. That is a discovery audit, not a count of physical models created.

Water uses the active **802-row** source, not the incompatible static export containing washrooms. Only the eight supported water-type combinations are accepted. Identity includes **asset ID and sorted outlet types**. Source asset ID `989056` is reused for two named/located combinations in Biidaasige Park; both source records remain distinct and are flagged in `audit.reusedWaterAssetIds`. The source's names, coordinates, type, dated status and notes remain available without treating the shared number as proof of one physical object.

Tennis `ID` identifies a facility. Public and club rows are separate access listings, so identity is facility ID plus access type. The 11 local rows describe **10 facilities**. High Park reports seven courts in each of its public and club rows; these are retained separately and **never summed to fourteen physical courts**. The card displays club name, access type, lighting, listed count and winter-play information; club listings explicitly direct visitors to check access arrangements. City facility IDs provide cross-links. No source point establishes individual court outlines.

Rink dimensions are converted with **1 ft = .3048 m**. Missing and zero dimensions stay unknown; skate trails receive no invented rectangular dimensions. For example, Trinity Bellwoods' 180 × 80 ft entry displays 54.86 × 24.38 m. Boards, lighting and pad/trail type remain source facts. Source rows without operational status do not gain an open/closed claim.

These additions complete park amenity **discovery and cross-links** (`st-26p.16`). Physical water props remain in progress in `st-26p.4`. [Rink geometry](outdoor-rinks.md) draws all 17 City Outdoor Recreation Area polygons, joined by asset ID, in the scene date's season; rink cards say what the city draws. [Tennis geometry](tennis-courts.md) now uses 43 reviewed individual OSM footprints, independently joined to the ten City facilities; inventory points alone never spawn a court.

## Verification

`node --test tests/open-data.test.mjs tests/parking-meters.test.mjs tests/boot.test.cjs tests/site-cache.test.mjs` passes **16/16**. The production build passes and fingerprints the new scripts; the bench GLB is copied into the game and retains the site's revalidation policy.

Phone regression `st-hua`: place cards independently block/reset touch movement controls while open, so long cards do not put the joystick above Directions. Closing a card respects any remaining map/ride disable state. Including `tests/touch-controls.test.cjs` gives **28/28** targeted tests. The phone capture asserts the button's actual hit target, taps Directions with Playwright's touchscreen and verifies that the directions panel opens.

Run `gpu2 slop-toronto-open-data -- node tools/check-open-data.mjs` from this worktree. Desktop and explicit low-tier 412×915 phone captures verify bench orientation/scale, the indoor Trinity washroom card, park cross-links, a dated water card, rink units and High Park's club listing. Captures inspected at `ride-anywhere-geo/review/gpu2/slop-toronto-open-data/open-data-{desktop,phone}-*.png`. There were no page exceptions. The static harness's pre-existing `/live/vehicles` 404 remains because it does not run the live Worker. The mini was contended by production transcription; these runs establish function/appearance, not performance budgets. An earlier capture with the launch-film query was invalid for visual review and was replaced by the current captures without that query.

## Mapped streetlight and traffic-signal poles

Bead: `st-26p.9`. Source: [Topographic Mapping – Poles](https://open.toronto.ca/dataset/topographic-mapping-poles/),
GeoPackage resource `5504d484-1bd6-4330-b43c-d562b74a175d` (updated 2026-02-20, SHA-256 pinned in
`tools/fetch-poles.mjs`). The row preview and CSV sample failed during research. The 69 MB GeoPackage downloads
normally. `node tools/fetch-poles.mjs` caches it in `~/.cache/slop-toronto/poles/`, verifies the hash and uses GDAL to
cut it to the detail frame's bounding box. `node tools/build-poles.mjs` then writes `js/toronto-poles.js` and repacks
`data/toronto-geodata.bin` (`tools/pack-geodata.mjs`), which carries the same object to the site (see below).

**Schema:** `_id`, `SUBTYPE_CODE`, `SUBTYPE_DESC`, `ELEVATION` (ground, m ASL), `DERIVED_HEIGHT`, `LAST_GEOMETRY_MAINT`,
`LAST_ATTRIBUTE_MAINT` and `OBJECTID`, one point each. `DERIVED_HEIGHT` is `None` on every record in the frame, and every
maintenance date reads 2021-01-01. **Heights and headings are therefore inferred**, not surveyed.

| Code | Type | In the detail frame | Rendered as |
| --- | --- | ---: | --- |
| 6006 | Street Light Pole | 26,375 | a 9 m galvanized single-arm light reaching toward the nearest road; 11 m with two arms on a median; 5,505 on wooden hydro poles and 25 Distillery lantern posts (see *Looks*) |
| 6005 | Street Light and Traffic Signal Pole | 1,566 | a 9 m pole with the same light; carries signal heads where a junction approach snaps to it |
| 6008 | Traffic Signal Pole | 1,518 | a 6.2 m signal pole; carries the heads of the approaches and crosswalks that snap to it |
| 6004 | Pedestrian Light Pole | 1,901 | a lamp post: 789 heritage lanterns, 366 waterfront promenade posts, 746 park lamps (see *Looks*) |
| 6003 | Miscellaneous Pole | 7,171 | **not rendered**: utility, trolley-wire and other poles without a model |
| 6001 | Circular Hydro Tower | 3 | **not rendered** |

The overlays in `~/.cache/slop-toronto/props/poles/refs/` compare the points with the City's 2025 8 cm aerials at Queen &
Spadina, University & Dundas, Palmerston Blvd and Queens Quay & York. Points sit on the poles' bases and shadows
within the stated ±30 cm. The type split reads correctly: combined poles are on the corners, signal-only poles stand in
the Spadina and University medians and streetlights run along the curbs. Near towers, the aerial is not a true
orthophoto, so building lean can make a ground point appear to fall on a roof.

**Placement** (`js/mapped-poles.js`): a point off a curb island is moved straight away from the road by at most 1.5 m.
If that fails, the point is rejected; points under or on flyover decks are also rejected. This places 27,714 of 29,459
shipped poles. Of the rest, 1,225 are off-curb (mostly laneway, park and rail-land lights away from any modelled curb)
and 520 are under the Gardiner and other decks. Arms point toward the nearest at-grade road. Points more than 40 m from
any road get a stable hashed heading. Mapped poles have player colliders and street-furniture footprints.

**Signals:** every mapped 6005/6008 pole is drawn. Before searching for its own corner spot, each junction approach
looks within 10 m for a mapped pole on the approach's right side. Corner poles may carry heads for both streets.
`pedestrian-signals.js` mounts crosswalk and midblock heads on a mapped signal pole within 3.5 or 4 m. If no mapped pole
fits, the previous procedural pole is used, kept clear of the mapped ones. This avoids duplicate poles at mapped
corners.

**Fallback and lights:** procedural median and roadside lights are added only where no mapped light stands within
30 or 25 m. This fills real gaps, such as poles missed beside tall buildings or in deep shadow. Night light pools use
the existing bounded pool (`40 × QUALITY.lightPool` spotlights nearest the camera), not one light per pole. The geometry
uses the existing instanced meshes, so it adds no draw calls before `scene-culling.js` splits it into spatial chunks.
`?mappedpoles=0` turns the layer off for an A/B with the procedural layout. `CITY.poleStats` reports counts, rejections,
fallback and signal snapping.

**Looks** (beads `st-er2`, `st-m3t`; `tools/build-poles.mjs` `poleLooks`, written into the layer as `looks`, OBJECTID
deltas per look). The source has no material or style field, and OSM's power poles and street lamps in the frame are
too sparse to help (301 `power=pole` nodes, 56 tagged wood). So the looks are documented rules on positions, roads and
the City's neighbourhoods:

- **Wooden hydro poles (5,505 lights).** Toronto Hydro hangs the older residential streets' lights on the cedar poles of
  the overhead line (it owns about 96,000 wooden poles), one pole every 25–35 m down one side of the street. Streets
  with buried services have steel or concrete standards, usually on both sides. A light is wooden when its nearest
  at-grade street (within 14 m) is local (residential, unclassified, living street, tertiary or service) and named.
  The street's lights within 90 m (at least 3) must also stand ≥ 80% on its side. Lights in the rebuilt core and
  waterfront neighbourhoods are excluded: Financial District, Yonge-Bay Corridor, Wellington Place,
  Harbourfront-CityPlace, St Lawrence-East Bayfront-The Islands, Downtown Yonge East, Bay-Cloverhill, Fort
  York-Liberty Village, Regent Park, University and Humber Bay Shores. Euclid (59 of 72), Manning, Montrose, Clinton
  and Logan come out mostly wooden. Palmerston Boulevard's ornamental standards, Queens Quay, the Esplanade, Harbord
  and the arterials come out with none. The City's 2025 aerials confirm the one-sided layout on Euclid, Manning and
  Montrose and the two-sided layout on Palmerston. At 8 cm, a nadir view cannot show the pole's material. The
  model is a 10.7 m weathered cedar pole with a 2.4 m crossarm and three insulators. About one in five has a pole-top
  transformer. The LED head hangs at 7.9 m on a galvanized bracket. On the high tier, three wires run from each pole to
  the next wooden pole ahead on the same side of the street, 12–48 m away (`woodSpans`, 4,323 spans). They are
  culled at 180 m.
- **Lantern posts:** a 4.55 m black heritage post with a fluted base and a four-sided lantern. It is used for the
  pedestrian lights that are not on the waterfront or in a park (Old Town, St. James Town, Cabbagetown, Moss Park and
  the Danforth). It is also used for the street lights in the Distillery District's lanes: Parliament to Cherry, south
  of Mill Street's curb. Mill, Parliament, Cherry and Front stay steel.
- **Promenade posts:** a 5.85 m slim charcoal post with a flat round LED head. It is used for pedestrian lights within
  250 m of Queens Quay or in Harbourfront-CityPlace, Fort York-Liberty Village, Humber Bay Shores, Wellington Place and
  Regent Park.
- **Park lamps:** a 4.5 m dark green post with an acorn globe. It is used for pedestrian lights inside a park, pitch,
  golf course or cemetery.

1,872 of the 1,901 pedestrian lights are placed. The rest are off the curb islands or under a deck. Each model is one
instanced geometry with vertex colours: 64 triangles for the wooden pole, 96 with a transformer, and 64–108 for the
lamp posts. All models share one material. Its `glow` vertex attribute lights the lamp glass at night, as the
streetlights' lenses are lit. Each model has a player collider and a street-furniture footprint, as the steel poles
do. Each also has a coarse sun-shadow stand-in in `scene-culling.js`: 10 triangles for the wooden pole and its
crossarm, and 16 for a post and its head. The wooden poles are culled at 1.5 km, like the steel ones, and the lamp
posts at 900 m. Both are scaled by the tier's cull factor and stay beyond the shadows' reach on every tier. The lamp
posts' night pools use the same bounded spotlight pool, aimed straight down. Their strength is 0.3–0.45 times a 9 m
streetlight's because they are lower. `QUALITY.poleWires` turns the wires on for the high tier only; use
`?q.poleWires=false` for an A/B. `CITY.poleStats.looks` counts what was drawn.

The layer is 482 KB as a script, about 128 KB with Brotli (438 KB and 116 KB before the pedestrian lights and looks).
Since `st-mf8` the site no longer loads that script: `window.CITY.POLES` arrives packed in `data/toronto-geodata.bin`
beside `GEO` (`tools/geo-bin.mjs`; `js/geodata-loader.js` puts both on `window.CITY` before the classic scripts run),
where it cost 95.6 KB of the gzip'd file before the pedestrian lights and looks. The script stays the node tools' and
tests' copy; `tests/geodata-binary.test.mjs` checks the packed object equals it value for value and that the committed
binary is the committed scripts packed. Tests: `node --test tests/mapped-poles.test.mjs tests/geodata-binary.test.mjs`.
GPU captures: run `gpu2 <name> -- env CAPTURE_PORT=… node tools/check-poles.mjs <tag>` for desktop and low-tier phone
captures, day and midnight, at Queen West, University Ave, Palmerston Blvd and Queens Quay. For the looks, run
`node tools/check-poles.mjs looks tools/shots/pole-looks.json`. It captures Euclid Avenue (with an aerial),
Queens Quay at Spadina, the Distillery's Distillery Lane and Allan Gardens.
