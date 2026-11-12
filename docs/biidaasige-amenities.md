# Biidaasige: dog parks, fitness, picnic and everyday park furniture

Bead `st-bmyv.5`. Owner: amenities worker. Module `js/biidaasige-amenities.js`, tests
`tests/biidaasige-amenities.test.mjs`. This module owns the park's **everyday, directly-referenced furniture**
(`st-bmyv.5`); the play structures (`st-bmyv.3/.4`), the Fire Hall 30 / Atlas Crane / The Drum
(`st-bmyv.6`) and the paths / Canoe Cove (`st-bmyv.7`) are other workers' modules and are not touched here.

## Status of this pass

This pass implements the **reusable, relative-origin factories and the layout adapter** whose inputs are
verified source facts and **verified positions**. No positions are invented:

- The **dog off-leash areas** are the **verified OSM rings** (`dogs-west-800`, `dogs-east-1200` in the inventory,
  projected at call time), not guessed 800/1,200 m² rectangles; their source areas are the City's 800/1,200 m².
- The **picnic tables, barbecues, benches and bins** are the **verified OSM points** from the current inventory API
  (`CITY.biidaasigeParkFeatures()`), each placed at its real node. Their counts are the OSM-mapped fixtures, not an
  official total and not a synthetic scatter.
- The **picnic terraces, communal barbecues, long permanent tables, the water-bottle-filling stations**
  and the **washrooms** are real, from current City pages and City Open Data with real coordinates.
- **No synthetic layout** is generated for bike racks, gates, signs or fitness machines: the sources describe them
  but supply **no positions and no counts**, so those stay reusable **factories** and are recorded `unplaced`. The
  verified-OSM kinds (bench, picnic table, barbecue, bin, drinking water, the two dog rings) are placed from the
  current inventory API (`CITY.biidaasigeParkFeatures()` / `…ParkWorld()` / `…ParkRingWorld()`), projected through
  `window.worldFromLatLon` at call time — the earlier `BIIDAASIGE_AMENITIES.features` fixture contract never
  existed and is replaced.

**CORRECTION (captain review).** An earlier pass of this doc claimed the City does not list Outdoor Fitness
Equipment for Biidaasige. That claim was **false**. The live City Recreation page (fetched by the captain to
`$WATERFRONT_RESEARCH/biidaasige/captain/recreation-current.html`, *Date modified: September 9, 2026*) states,
under **Outdoor Fitness Equipment**: *"Fitness equipment is available west of Cableway Canyon."* The
`parks-and-recreation-facilities` Open Data amenities string is less complete; the page is the current authority.

The page publishes a **ZONE** ("west of Cableway Canyon"), not a machine list or a point. So this module now
**builds a generic fitness-station factory** (`buildFitnessStation`) and records fitness as
**listed-unplaced**: the inventory (`js/biidaasige-park-data.js`, `coverage: "Outdoor fitness … official-listed-unplaced"`)
carries it with `placement:"unverified"` and no coordinate, and the adapter never places it from an invented
point. `stats.unplaced` reports it. That is coverage without a fabricated layout or position.

## Sources (current, official)

| Source | URL | Use | Claims limit |
| --- | --- | --- | --- |
| City — Recreation at Biidaasige Park | `toronto.ca/…/biidaasige-park/recreation-at-biidaasige-park/` (fetched 2026-11-10) | the two dog off-leash areas and their features; fishing/paddling | prose, no positions/counts per item |
| City — Food & Drink at Biidaasige Park | `…/food-drink-at-biidaasige-park/` (2026-11-10, page dated 2026-09-18) | two picnic terraces, communal circular barbecue (three grills), long permanent tables seating up to 40; water stations; five washrooms | prose, no counts/positions |
| City — Biidaasige Park | `…/beaches-gardens-attractions/biidaasige-park/` (2026-11-10) | park identity, the 2026 map PDF link | — |
| City 2026 park map PDF | `…/2026/09/978c-Biidaasige-Park-map.pdf` (2026-09) | legend: Dogs off-leash area, Picnic site, Picnic Terrace ×4, Water fountain, Playground, Fire pit | **south-up** (captain-verified); scanned text-only, no published pixel georeference |
| City "owner map" basemap PNG | `…/2026/08/8dcb-OMbasemapBPW-3-scaled.png` | the dog off-leash polygon's shape | raster, no coordinates |
| Waterfront Toronto news 2026-07-24 | `waterfrontoronto.ca/news/torontos-largest-park-in-a-generation-just-got-bigger` | 2026 west opening: Canoe Cove, 3,000-person event lawn, Water's Edge Promenade, fire holder, marker trees, interpretive signage | prose; **supersedes** the stale City "Canoe Cove closed… open 2026" line |
| City Open Data — Parks Drinking Fountains | `open.toronto.ca/dataset/parks-drinking-fountains/` (row snapshot 2026-10-28, in `tools/data/`, and already projected into `js/toronto-city-facilities.js` as `CITY_FACILITIES` `kind:'water'`) | 7 real water-station points in Biidaasige Park, two of them **dog fountains**, with `LOCATION_DETAILS` | positions are City points, ± small; asset **989056 is reused** for two named locations (flagged in `docs/city-open-data-layers.md`) — never treated as one object |
| City Open Data — Parks and Recreation Facilities | `…/parks-and-recreation-facilities/` (2026-10-28) | `Biidaasige Park` amenities list; `Old Fire Hall 30` centre + washrooms | point positions; no furniture |
| City Open Data — Washroom Facilities | `…/washroom-facilities/` (2026-10-28) | 5 washrooms at Old Fire Hall 30, 31 Commissioners St (2 on the outside, 3 inside) | — |
| Captain review notes | `$WATERFRONT_RESEARCH/biidaasige/captain/review-notes.md` | south-up map; 2026 west open vs stale closed text; manufacturer pages (Owl, Raccoon, Drum); MVVA | captain-verified |

Photo URLs handed to the captain for a contact sheet are listed in
`$WATERFRONT_RESEARCH/biidaasige/amenities/source-photos-urls.txt`. The two usable amenity photos are the
**Raccoon Picnic Terrace tables** hero and the **"Vegetables on a grill"** (communal barbecue) image. No
official photo of an individual park bench, bike rack, dog gate, fence or dog fountain was found; those are
**generic City standard furniture** and are modelled to standard proportions with the estimate recorded
below, not to a photographed specimen.

## What the sources actually say (verbatim substance)

**Dogs.** "There are two dogs off-leash areas, and each has: seating; K-9 rated artificial turf; accessible
pathways and gates; water fountains; waste bins." "One off-leash area is **800 square metres** and is west of
Cableway Canyon (Adventure Playground). … One off-leash area is **1,200 square metres** and is located east
of Old Fire Hall 30." Off-leash dogs are not allowed elsewhere in the park. Asphalt is fresh at this new
park.

**Food & drink.** "There are two picnic and BBQ terraces: **Raccoon Picnic Terrace** and the **River View
Picnic Terrace**." "Both areas have picnic tables and barbecues. … Each barbecue is **circular, with three
separate grills**. The picnic tables are **long, permanent structures that seat up to 40 people**." Raccoon
terrace is "about a one-minute walk eastward from Old Fire Hall 30" and holds the Reaching Raccoon; River
View terrace is "about a three-minute walk eastward from Old Fire Hall 30 and at the east end of the Picnic
Lawn", overlooking River Bend Landing. No on-site vending. Water fountains/bottle stations are throughout the
park, seasonal. Five accessible washrooms at Old Fire Hall 30.

## Positions: what is real, what is not

Real, machine-readable points used by this module: the City Open Data water stations (from `CITY.CITY_FACILITIES`)
and the verified OSM features (from `CITY.biidaasigeParkFeatures()`), cross-checked in `st-bmyv.1`'s inventory:

| Feature | Source position (game frame x, z) | Evidence |
| --- | --- | --- |
| West dog-OLA dog fountain | 2218.82, 670.93 | water asset 989015, "in the west dog off-leash area" |
| East dog-OLA dog fountain | 2417.73, 633.88 | water asset 989016, "in the east dog off-leash area" |
| East picnic-terrace water station / dog fountain | 2633.54, 609.06 | water asset 989056, "west end of the picnic terrace" |
| Raccoon picnic-terrace water station | 2493.92, 597.17 | water asset 989055, "on the pathway north of the Reaching Racoon" |
| Badlands water station | 2323.57, 686.72 | water asset 989053 |
| North Riverside water station | 2315.74, 693.50 | water asset 989054 |
| South River Lawn water station | 2496.11, 780.08 | asset 989056 (reused id; flagged) |
| Five washrooms | ~2391.87–2393.04, 644–651 | Old Fire Hall 30 washroom records (`st-bmyv.6` owns the building) |

The **dog-OLA boundary polygons** are the verified OSM rings; the **individual benches, picnic tables, barbecues and
bins** are verified OSM nodes. **The gates, turf panels, the per-area seating, bike racks, signs and fitness machines
have no verified position** and are therefore returned as factories, not placed. The module refuses to distribute a
count along a shape: the dog-OLA areas are 800 / 1,200 m² (areas, not layouts) and the picnic terraces seat up to 40
(a capacity, not a table count). Inventing a layout from those would be fabrication, which the assignment forbids.

## Model proportions (estimates, recorded honestly)

All models are built **1 unit = 1 m, Y-up, local origin at the ground contact point (y = 0), footprint
centred on x/z** — the repo prop convention (`docs/city-open-data-layers.md`). Each factory returns a
`THREE.Group`; the layout adapter positions instances of the shared geometries.

**A. Dog off-leash area** (`buildDogOla` — a *group* factory, not an instance; the boundary is not one of the
two shapes we are allowed to invent, so this builds the parts, not a scattered layout):

- **Turf: ONE triangulated polygon** of the verified ring (`THREE.ShapeUtils.triangulateShape`, wound up), so the
  K-9 turf covers the **interior** of the area and concave rings are handled (no triangle spills outside the mapped
  outline). It is not perimeter boxes.
- **Local origin:** the ring is re-centred on its centroid and the group's `position` carries the world offset, so no
  vertex holds a million-unit world coordinate.
- **Fence merged per material:** one posts mesh, one pickets mesh, one rails mesh (≤3 draw calls for the whole
  perimeter), 1.2 m high (City dog-OLA standard; **estimate**), pickets at 0.10 m centres, posts every 2.4 m.
- **Accessibility:** the fence is built **only when at least one verified gate exists**, and it splits at each gate
  opening. With **no verified gate the ring gets no perimeter fence at all** (`openEntry: true`), because an unbroken
  fence would seal the park with no way in. A gate is a 1.5 m clear opening (**estimate**) with a swing leaf.
- Seating / waste bin / dog fountain inside an area: **not placed from the ring itself.** The City says each area has
  seating, bins and a fountain but publishes no per-area point; benches, bins and water stations are placed only from
  their own verified OSM/City points (with `renderedSites` dedupe). **Nothing is scattered inside the ring from the
  800/1,200 m² figure.**
- The adapter never seals an area (see accessibility above) and the dog-OLA collider is the **fence perimeter only**,
  not the whole bounding box, so the interior stays walkable.

**B. Picnic tables** (`buildPicnicTable`), placed one per verified OSM `picnic-table` node (18 in the current data):

- Long permanent table: **6.0 × 0.76 × 0.90 m** (length × height × width) with two attached benches
  (**estimate**). "Long … seats up to 40" implies a bank of tables, so a single table cannot be scaled to 40;
  the factory builds one standard long table and the adapter places as many as the fixture provides. Table
  top 0.76 m, bench seat 0.45 m.
- Communal barbecue: **circular, 1.6 m diameter, three separate grills** (source-fact: three grills; diameter
  an **estimate**), 0.9 m high, on a post and base.
- Trash bin, drinking fountain: separate factories; placed from their own verified OSM/City points.

**C. Bench** (`buildParkBench`): 1.8 × 0.96 × 0.80 m — the **existing, already-reviewed** City street-bench
proportion used by `assets/props/plaza-bench.glb` (`docs/city-open-data-layers.md`), so the park bench and
the street bench read as the same City standard.

**G. Outdoor fitness station** (`buildFitnessStation`): a generic pull-up/balance stand — two 2.3 m posts, a top
bar and a 0.4 m balance beam, 0.05 m tube (**estimates**; the City publishes a zone, not a machine list). Built as a
factory; never placed from an invented point (listed-unplaced).

**E. Drinking fountain / bottle-filling station** (`buildDrinkingFountain`): 1.0 m tall post on a 0.4 m base,
a bottle spout, a drinking bubbler and a **dog bowl at 0.25 m** (source-fact for the dog fountains; the
bowl height is an **estimate**). Used at all 7 real water points.

**F. Dog fountain**: E with the bowl, used at the two dog-OLA dog-fountain points.

**G. Signage** (`buildInterpretiveSign`): a low **0.9 × 1.1 m** tilted reader on two posts, **1.2 m** overall
(estimate). The indigenous interpretive-signage and marker-tree content is `st-bmyv.6`'s; here it is a plain
sign blank the layout adapter may use only if the fixture supplies a point.

Existing GLBs (`assets/props/`) that this module reuses rather than duplicates are declared in
`REUSED_ASSETS` and **not** re-instanced here: `plaza-bench.glb`, `litter-bin.glb`, `bike-ring.glb`,
`park-sign.glb`, `wayfinding.glb`, `info-pillar.glb`, `hydrant.glb`. Where the parent module already places
those by Open Data (`js/street-props.js`), the park furniture must not double up — the layout adapter accepts
a `skipAssets` predicate so mapped props are not duplicated.

## Licence and provenance of any downloaded asset

No new model was downloaded for this pass. The module builds **procedural geometry** for every piece it can
position honestly, and **does not add a Polyfork / PolyPizza / Kenney pack** because the required Toronto
picnic table, dog-OLA fence/gate and bike rack are **custom City standard furniture with no verified
free/licensed matching GLB**, and the assignment forbids downloading random packs or shipping unverified
source. If a specific downloadable model is later selected, it must record its exact licence and provenance
here (as `docs/waterfront-furniture-assets.md` does for the Adirondack chair) before it ships.

## Runtime contract

```
window.CITY.buildBiidaasigeAmenities(scene, allColliders, { skipAssets, renderedWaterIds, renderedSites }) -> { group, colliders, stats } | null
window.CITY.biidaasigeAmenityDedupe({ waterStations, renderedWaterIds, skipAssets }) -> { waterStations, ... }
```

Mirrors `createWaterfrontDetails`: adds its `Group` to the scene, pushes world-space **AABB colliders**
(`prop:true`) whose footprint is read from the **merged geometry itself** (not a mirrored constant), tags every
`InstancedMesh` with `userData.cullDistance` / `userData.cullCell` for `scene-culling.js`, and gives each a real
bounding sphere/box. It never throws: a missing inventory API or GLB degrades the output and is reported in
`stats.unplaced`. The adapter reads `CITY.biidaasigeParkFeatures()` / `…ParkWorld()` / `…ParkRingWorld()` **after**
the park data module runs, so it only ever reads verified points.

**Bounded geometry.** Each factory's many boxes are merged once **per material** (`mergeFactory`) and then
instantiated, so a bench with six boxes and two materials is **two draw calls for all benches of that kind**, not
six per bench. The dog-OLA fence is likewise merged to one mesh per material (≤3), and its turf is one triangulated
mesh — **not one mesh per picket**. `stats.materials[kind]` records the merged material-part count and the tests pin
it ≤ 2 (furniture) and ≤ 5 meshes (a dog-OLA group).

**Dedupe contract (two layers).**
1. `dedupe()` / `renderedWaterIds` filters the City water stations **by record id** so a station another layer already
   draws is never duplicated, and restricts furniture to `placement:"osm…"` features.
2. **Spatial `renderedSites`.** The captain integrates this **after `js/street-props.js`** and passes the already
   rendered sites as `[{ x, z, kind }]`. A mapped OSM bench/bin/water point **within 1.5 m** (`BIIDAASIGE_AMENITY_DEDUPE_RADIUS`)
   of an already-rendered site **of the same kind** is skipped, so the park furniture never double-stacks a native
   street-prop bench, bin or fountain. Different kinds never dedupe each other.
3. `skipAssets` still skips a whole shared GLB family where asked.

**Reuse vs new geometry.** This pass adds **no downloaded model**. Where a genuine licensed GLB already exists in the
repo (`assets/props/plaza-bench.glb` etc.) the factories match its **proportions** so the park and street furniture
read as one family; the picnic table, barbecue, bin, fountain, rack, sign, fitness and dog-OLA parts are **honest
procedural geometry matched to the source description**, not a claimed download. A future downloaded model must record
its licence here before it ships.

## Verification

`node --test tests/biidaasige-amenities.test.mjs` (**11/11**) — factory geometry is finite, sized and on y = 0
(including the corrected fitness station); merged geometry is bounded (a six-box bench → ≤2 material parts); the
adapter reads the **current** `BIIDAASIGE_PARK` API and places **all 18** real `picnic-table` nodes (the hyphenated
kind matched), every instance inside its own collider; **draw calls are bounded** (one InstancedMesh per material per
furniture kind; a dog-OLA is ≤5 merged meshes, never one per picket; local vertices stay under 200 m, world offset in
the group position); the **dog-OLA is accessible** — `openEntry` with no verified gate, fence merged and gate-split when
there is one, and the turf polygon covers the concave interior without spilling; `renderedSites` spatial dedupe skips a
same-kind site within 1.5 m and never a different kind; the City water stations dedupe by record id; the fitness
correction is honoured (factory exists, catalog listed-unplaced, nothing placed); a real glTF binary (`plaza-bench.glb`)
loads through `GLTFLoader`/`MeshoptDecoder` and matches the factory's bench; the layer degrades honestly without the
inventory API.

`tests/biidaasige-park-data.test.mjs` test 11 (the inventory generator's `--check`) currently reports
`js/biidaasige-park-data.js is stale` in this shared checkout; that file and its generator belong to `st-bmyv.1`, are
not edited by this bead, and the other 10 tests pass. Re-running `node tools/build-biidaasige-park-data.mjs` is the
inventory owner's call.

Note on the dog-fountain count. The Open Data `TYPE` field types **three** of the park's water stations with a
"Dog Fountain" (the two dog-OLA stations and the east picnic terrace's, `989056`); the recreation page's prose
pairs a fountain with each of the two dog areas. The module follows the `TYPE` field (3 typed dog stations, 4
plain), since it is a structured source, and this paragraph records the nuance rather than hiding it.

Open, for the parent/captain: captain's contact-sheet review of the two amenity photos; confirmation that any future
downloaded furniture model has a checked licence before it ships; whether the parent wants this layer's OSM benches
suppressed where `js/street-props.js` already places City benches (pass `skipAssets: ['benches']`); and the
inventory owner's `--check` staleness above.
