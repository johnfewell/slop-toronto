# Real building shapes from the City's 3D Massing

Epic `st-2nl`. Today every building in the detailed city is drawn as one to five boxes: `tools/geo-features.mjs` fits
the City's 3D Massing polygon with its minimum-area rectangle and, when that rectangle is less than 86% full, covers
the outline with up to five rectangles (L, T and U plans). This document plans the move to the polygons themselves.
It records what a pilot behind `?massing=1` showed for Kensington Market.

The technique is the one Slop New York uses for its surveyed buildings (mrdoob, MIT): `1daa665`, `062c4a9`,
`0073425`, `211860c`, `819a0ad`, `c4ab18f` and `28c0af7`. They pack polygon footprints and heights into a compressed
binary, merge their walls per 1 km cell, lay facades out per wall (`footprintLocal`), mark party walls and route the
shadows through stand-ins. Toronto reimplements the technique on its own data and does not cherry-pick: upstream's
`building-*.js` ES modules don't fit Toronto's classic-script tree.

## Status

| | |
|---|---|
| Pilot | **Done, flag only.** `?massing=1` loads `js/toronto-massing-pilot.js` (184 KiB, fetched only then). Its 647 Kensington Market buildings stand on their polygons; everything else, and the default page, is unchanged. |
| City-wide | Planned, in the child beads below. |

## 1. Data

### What the City publishes

[3D Massing](https://open.toronto.ca/dataset/3d-massing/) (Open Government Licence – Toronto) comes in two forms. The
build already reads both:

- **The shapefile** (`3DMassingShapefile_2025_WGS84`, 428,184 records city-wide). Its coordinates are Web Mercator,
  despite the WGS84 in the name. `tools/fetch-massing.mjs` reads it. Each record is a 2D polygon, sometimes a
  multipolygon, with several fields:
  - `MAX_HEIGHT`, `AVG_HEIGHT` and `MIN_HEIGHT`
  - `SURF_ELEV` and `HEIGHT_MSL`
  - `HEIGHT_SRC` (Lidar-Derived, 3D Model, Site Plan or Oblique Aerials)
  - `BLDG_SRC`

  A tower and its podium are separate records, so the parts already form a stepped skyline. There is no feature-ID
  column: the durable ID is the record number within the edition (`to-3dmassing-2025:<fid>[.<k>]`,
  [geodata-ids.md](geodata-ids.md)).
- **The multipatch** (`3DMassingMultipatch_2025_WGS84.gdb`), true 3D surfaces, roofs included, split into map tiles.
  `tools/fetch-landmark-massing.mjs` already cuts the landmarks out of it.

### What the pilot measured (Kensington Market, 647 buildings)

| Measure | Result |
|---|---|
| Records | 647 single polygons. None of them belong to multi-polygon records; city-wide 80 records are. |
| Courtyards | 4 holes, none under 4 m². `fetch-massing.mjs` keeps only each polygon's outer ring; the pilot tool reads the holes from the shapefile itself. |
| Ring size after 0.2 m Douglas-Peucker | median 10 corners, p90 22, max 74. 997 of 7,879 edges are under 1 m. |
| Polygon vs today's boxes (IoU, 0.25 m raster) | median 0.89, p10 0.73, min 0.30 (see below). 347 buildings are under 0.9 and 146 under 0.8. |
| Box area vs polygon area | median +0.0%, p90 +13.9%; in total the boxes cover 206,318 m² against the polygons' 214,519 m². |
| On the City's sidewalk polygons (more than 0.5 m² overlap) | polygons: 44 buildings, 277 m²; boxes: 48 buildings, 411 m² |
| Against the OSM footprint that names the building (`GEO_IDS.buildingOsm`) | 603 matched. IoU median 0.75, p90 0.89, p10 0.11; 155 are under 0.5, mostly an OSM way spanning a row of massing parts. |
| Height source | Lidar-Derived 604, Site Plan 22, 3D Model 20, Oblique Aerials 1 |
| `MAX_HEIGHT − AVG_HEIGHT` over 1.5 m | 586 of 647: pitched or stepped roofs dominate. |
| Party walls (an edge with a neighbour's mass 0.35 m outside its 15%, 50% and 85% points) | 1,036 of 7,879 outer edges |
| Parts standing on a lower part (a tower on its podium) | 10 |
| Walls on another part's wall line (overlapping or duplicated records) | 188 outer edges whose inside is another part at least as tall, as low or lower. They are left out: drawn, they flickered against the other wall (first desktop capture, Augusta Avenue). Two records of the same height and outline occur, so their roof caps are also set up to 5 cm apart. |

Notes:

- **The worst boxes.** Rectangle decomposition is skipped when either side of the fitted rectangle is 6 m or less, or
  when the rectangle is at least 86% full. A narrow L-shaped house is then a single rectangle, at an IoU as low as 0.30.
- **OSM is not a geometry source.** It is coarser than the massing (one way per terrace row) and offset from it. The
  massing is the geometry; OSM only lends type and name, as now.
- **Alignment with streets and sidewalks.** The polygons intrude onto the City's sidewalks less than the boxes do (277
  against 411 m²). Every overlap is under a metre: building faces on the lot line, where the sidewalk layer runs to
  the building face. Nothing needs moving.
- **Heights.** A row's height comes from `GEO.buildings` (its lidar maximum, or for a house the average, nearer its
  eaves). The pilot keeps that rule exactly, so each polygon stands as tall as its box did.

### Packing city-wide

The pilot's JSON text is about 290 bytes per building, which would be about 10 MB for all 35,266. Toronto's own
compact ring form is much smaller. `js/sidewalk-polygons.js` `encodeSidewalkRing` stores decimetres, the first point
absolute and each next point relative to the one before. In the packed geodata binary (`tools/geo-pack.mjs`, gzip),
that form is about 4 bytes per corner. Estimate:

- corners: 35k buildings × about 12 = 420k corners, about 1.7 MB raw, and well under 1 MB after gzip
- plus party-edge and base fields

The polygons should ship as their own lazily loaded sidecar. That keeps the main geodata byte-identical and its
startup payload unchanged, and the sidecar loads within the startup payload gate once the polygons become the default.

## 2. Geometry

Pilot (`tsl-materials.js` `createFootprintFacades`, `buildings.js`):

- **Walls.** A quad on every edge of the outer ring and of each courtyard. The outer ring is stored counter-clockwise
  in (x, z) and holes clockwise, so every wall's right-hand normal points away from the mass. A wall stands from its
  `base` to the row's height.
- **Bases.** A part whose corners all lie within 0.6 m of a lower part, with its centre inside it, starts at that
  part's roof (the tower on its podium). This removes the coplanar doubled walls the boxes have below the podium roof.
- **Hidden walls.** An edge with another part at least as tall just inside it (overlapping or duplicated records) gets
  no wall, so the two don't flicker. Of two equally tall parts, the later record drops its wall.
- **Roof cap.** Triangulated with `THREE.ShapeUtils.triangulateShape` (earcut), courtyards included.
- **Merging.** One indexed mesh per facade style per 1 km cell (as upstream): 5 meshes for the whole pilot.
- **Roofs** (the data allows more than this):
  - Flat (`roof 0`): the cap at the top.
  - Pitched (`roof 1`, 370 pilot buildings) and sheet roofs: the existing hipped and shed roofs, still built over
    the boxes' rectangles, with the flat cap 5 cm under them. The cap closes anything the rectangles leave open, and
    the hips' eaves (0.6 m) cover the small mismatches. This keeps the look of the street while the walls follow the
    true outline. A hip over an L-shaped outline still reads as two overlapping hips.
- **Next:**
  - **Straight-skeleton hips and gables** over arbitrary simple polygons. For houses, `MAX_HEIGHT` is the ridge and
    `AVG_HEIGHT` sits near the eaves. That gives a pitch per building, not a random 24–32°.
  - **Big or complex roofs** (stepped, sawtooth, domes): read the multipatch roof surfaces, as the landmarks do.
    Decimate them to the cell budget.
  - **Overhangs and arcades** (minimum height above zero in the multipatch): out of scope until the passage rules
    (ID-5) exist.

## 3. Collision

Each pilot building is one polygon collider (`{ minX…maxZ, maxY, polygon, massing: <ID> }`).
`world-collision.js` already handles concave outlines: SAT against convex ones, and edge by edge (never across an
edge) against concave ones, for the car; nearest boundary for walkers, riders and the helicopter. Findings:

- **Driving or walking into every pilot wall** (`tests/massing-pilot.test.mjs`): about 8,000 car runs and 8,000
  walker runs approach each wall of 2.5 m or more from 5 m out, square on or slanted. Each uses 0.1 m steps and
  four push-out passes per step, as `controllers.js solveContacts` does. None ends inside a building, and every contact
  is finite. An earlier draft placed the car deep inside notches narrower than itself. That start is unreachable in
  play, and it does produce bad pushes, so it is no measure of the colliders.
- **Upstream's NaN and through-wall fix (`28c0af7`).** Toronto's SAT is independent of upstream's code, so the
  patch itself does not apply. Its fixtures were adapted as tests:
  - a grazing tilted wall
  - a courtyard corner
  - a narrow slot
  - a sub-1e-10 m sliver
  - a single-point ring
  - an empty ring
  - NaN corners

  The sliver found a real bug. An outline whose edges are all under 1e-9 m kept no edges, and a walker inside it got
  an infinite push with a stale normal. A ring with no edges would have thrown inside a concave contact.
  `colliderShape` now drops non-finite corners, and `contact()` treats an outline with no edges as not solid.
- **Courtyards stay solid.** The collider is the outer ring: all 4 pilot courtyards are closed on every side.
  City-wide, a courtyard reachable through an opening needs a "holes" form in `colliderShape`, under the passage rules
  (ID-5).
- **The colliders' other consumers:**
  - Walkers' detours (`pedestrian-routes.js`): the turned boxes they replace were obstacles, so the polygons are too
    (`c.massing`, tested by a polygon/box overlap).
  - The road network already ignores polygon and turned colliders.
  - Sound occlusion (`audio-acoustics.js`) and the fallback-tree spacing (`trees.js`) see only the polygon's bounds.
    That is conservative, but a large concave building over-occludes. City-wide, they should read the polygon.
  - `?debug=collisions` draws the polygons as buildings.
- **Still on boxes.** Other modules place things against `GEO.buildings` box parts:
  - `city-grid.js` (yards and lots)
  - `street-details.js`
  - `signage.js` (shop signs)
  - `patio-layout.js` (CaféTO clearance)
  - `subway.js` (entrances)
  - `rail-corridor.js`
  - `navigation.js` and `city-map.js` (map drawing)
  - `yonge-dundas.js`
  - `surroundings.js`

  With a box that overshoots by up to 14% (p90), these placements agree with the polygons slightly worse than they do
  with each other. Each needs a "polygon or box" accessor before the boxes go.

## 4. Facades on non-rectangular walls

**`footprintLocal`.** `facadeCell(…, footprintLocal)` in `tsl-materials.js` is Toronto's version of mrdoob's mode.
Each wall vertex carries `facadeWall` (0..1 along the wall, metres below its top, its WALL_KINDS value) and `box`
(wall width, building height, seed plus tone). Every wall then fits whole window bays between its corner piers,
whatever its angle. "Along" runs toward the positive world axis the wall mostly follows, as the interior mapping's
view ray expects. The rendered and curtain-wall materials take `footprintLocal: true`. The pilot creates those
copies only when the flag is on: that is 5 more pipelines to compile.

**Edge kinds.** Treatments come per edge (`buildings.js footprintEdges`):

- **Party walls** are windowless lot-line walls. Their edges are sampled at build time.
- **Edges under 2 m** are windowless. Without this, digitising stair-steps would show half-windows.
- **Street fronts** are edges facing a road within 15 m of its kerb. The best one gets the building's front kind
  (storefront or entrance door). On a shop, every street edge of 3 m or more is a shop front, so corner stores wrap
  round.
- **The rest** are rear walls, with windows on every floor.

**Fire escapes and air conditioners.** Both now hang on the polygon's longest rear edge (fire escapes) or a rear edge
(air conditioners), facing out of it. They no longer stand on the box's wall, which may be a metre off the real one.

**Hooks for the facade and storefront pilots.** A polygon edge is a much better "face" than the box's compass sides:

- **Face IDs.** `faceOf(row, n|e|s|w)` in `tools/geo-ids.mjs` picks a box's whole side and refuses plans within 45°
  of the grid. City-wide, faces should become `<building ID>:e<index>`, an edge of the simplified outer ring, with
  wall-local metres from its first corner. Their ends and outward normal come from the sidecar. See section 6 on
  stability.
- **Storefronts (st-wt0.15) and facade photos (st-wt0.16)** key their records to an edge. The shader already has the
  wall frame (`wallS`, `wallW`, `fromTop`) to place a sign or a rectified photo on one wall without stretching it
  round a corner (ID-3).
- **Ghost signs on party walls (upstream `819a0ad`)** need the exposed height above the neighbour. The pilot data has
  it (the `covered` height per party edge), but the shader does not draw them yet.

## 5. Level of detail, batching, shadows and the phone budget

### Measured offline (node, three core, the pilot's 647 buildings)

| | Boxes today | Polygons (pilot) |
|---|---|---|
| Triangles | 895 boxes × 12 = 10,740, instanced | 22,023: 15,414 in 7,707 walls (188 hidden edges have none), 6,609 in roof caps |
| Vertices | 24 per box geometry, shared | 38,723 |
| GPU geometry | 895 instances × 32 B | 2.6 MiB: 17 floats per vertex (position, normal, box, facadeWall, paint) |
| Meshes | 5 instanced meshes city-wide, cut into 1 km cells for the frustum (`scene-culling.js`) | one per facade style per 1 km cell: 5 for the pilot |
| JS build | — | about 50 ms more in `buildCityBlocks` (node harness with stub materials, M5 Pro): 26 ms of geometry, the rest the street-front lookups. The browser's `[buildings] massing pilot` line logs it. |

The hipped roofs are unchanged in both columns. GPU figures from the Mac mini are in [Pilot evidence](#pilot-evidence).

### Extrapolated to the whole detailed city (× 54.5)

- **Triangles:** about 1.2 M, about twice the boxes.
- **Geometry memory:** about 150 MiB at the pilot's vertex format, which is the real problem.
- **JS build:** about 1.4 s on a fast laptop, which is too slow for the main thread on a phone.

### The plan

1. **Compact vertices.** Store per vertex:
   - the position relative to the cell (int16 decimetres, or float16)
   - an octahedral normal (2 × int8)
   - along (float16)
   - a building index (uint16 into a per-cell building table: height, seed, tone, paint, base)

   The shader reads the building table. `fromTop` is then the height minus y. That is about 16 B per vertex, about
   35 MiB city-wide, and paint and seed are no longer repeated on every vertex.
2. **Distance tiers per 500 m cell.**
   - Near (under about 600 m): the full polygon.
   - Mid: the ring simplified at 1–1.5 m, no walls under 2 m, party walls dropped wherever both sides are covered.
     That removes about 13% of edges in Kensington.
   - Far: today's boxes, or the surroundings' flat extrusions.

   Use the tree-LOD cells' hysteresis and their reveal-hitch rules (threejs-lod-culling-perf).
3. **Build off the main thread.** Build cells in a worker, or ship the packed cell vertex buffers in the sidecar. The
   main thread then only uploads them. Stream them in by distance like the quadtree detail.
4. **Shadows.** Every cell mesh sets `userData.shadowStandIn = true` (upstream `c4ab18f`), so `scene-culling.js` casts
   it as position-only stand-ins in 500 m cells. The facade shader never runs in the shadow cascades. This holds
   today: no change was needed in `scene-culling.js`.
5. **Phone budget.** The pilot's Kensington captures on the phone tier are functional only. Before the polygons
   become the default:
   - a matched idle baseline (st-wt0.2.2 / st-oiw) must show the change in frame time, draw calls, triangles,
     geometry memory and load time on both tiers
   - the phone tier should start with the mid tier everywhere beyond a small radius

## 6. Durable IDs

- **Row keys.** The pilot keys each polygon to its `GEO.buildings` row. It refuses the record (and keeps the boxes)
  unless that row still has the same centre. It carries the row's durable ID (`to-3dmassing-2025:<fid>`) and the
  geodata hash it was built against. The test checks all three against `js/toronto-geodata-ids.js`.
- **City-wide sidecar.**
  - Key polygons by the durable massing ID, not the row. A geodata rebuild that reorders or filters rows then can't
    attach a polygon to the wrong building.
  - The loader maps IDs to rows through `GEO_IDS.buildings`. That sidecar is 1.9 MB, so ship a slim ID→row index in
    the polygon sidecar, checked against the geodata hash.
- **New editions.** A new 3D Massing edition renumbers its records, so it is a new dataset prefix (`MASSING_EDITIONS`).
  Buildings that matter (face records, storefronts, photo facades) are carried across with aliases in
  `tools/data/geo-id-aliases.json`, matched by polygon overlap (IoU over 0.8) and reviewed. Unmatched records lose
  their face records rather than re-attaching to a neighbour (`idResolver`).
- **Face IDs on edges.** These depend on the simplification. Each face record should also store the edge's
  endpoints. A changed simplification or edition then resolves the face to the edge within 0.5 m and 10° of the
  stored one, or drops the record.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Geometry memory and build time city-wide (about 150 MiB, about 1.4 s at the pilot's format) | Compact vertices, tiers, worker/prebuilt cells (section 5); flag until measured |
| Phone frame time: more triangles, more walls in view at street level | Mid tier on phones, matched idle baseline before default |
| Pipelines: 5 more facade materials to compile | One footprint material per style replacing the box ones once all buildings are polygons; until then the flag adds them |
| Pitched roofs: hips stay on box rectangles over a polygon (L-houses read as crossed hips) | Straight-skeleton roofs from max/avg heights; multipatch roofs for complex ones |
| Box consumers (signs, patios, entrances, yards) disagree slightly with the walls | Shared "footprint of row" accessor; migrate before removing boxes |
| Party-wall probe misreads a narrow gap (≤ 0.35 m) as a shared wall | Walls are kept whole (windowless only), so a misread never opens a hole |
| Coplanar walls between a tower and a podium it isn't fully on (base not found) | Same as today's boxes; the 0.6 m reach found 10 in Kensington; check the Financial District before default |
| Degenerate or self-touching rings | Tool cleans (no repeats, under 0.02 m merged, RDP 0.2 m), test asserts simple rings, collider drops degenerate outlines |
| Durable IDs move with a new edition | Edition prefixes, reviewed aliases, face records with geometry |
| Upstream drift | Technique only; record in upstream-sync.md; no shared modules |

## 8. Phases (child beads of st-2nl)

| Bead | Phase | Depends on |
|---|---|---|
| st-2nl.1 | Pilot: Kensington Market behind `?massing=1` (this PR) | — |
| st-2nl.2 | City-wide polygon sidecar: pack all buildings' rings, holes, bases and party edges, keyed by durable ID, lazily loaded, byte-identical rebuilds | st-2nl.1 |
| st-2nl.3 | Compact vertex format, distance tiers and worker-built cells; matched idle baseline on both tiers | st-2nl.2 |
| st-2nl.4 | Polygon consumers: courtyards in collision, acoustics, and the box consumers (signs, patios, entrances, yards, map) through one footprint accessor | st-2nl.2 |
| st-2nl.5 | Roofs from the data: straight-skeleton hips and gables from max/avg heights; multipatch roofs for complex ones | st-2nl.3 |
| st-2nl.6 | Edge faces: polygon-edge face IDs, party-wall ghost signs, storefront and photo-facade hooks (with st-wt0.15 and st-wt0.16) | st-2nl.2 |
| st-2nl.7 | Default on: remove the boxes from the detailed city once 3–6 pass; upstream-sync and credits | st-2nl.3, st-2nl.4, st-2nl.5 |

## Pilot evidence

### Running it

`?massing=1` on `explore.html` (any quality tier). Startup logs a `[buildings] massing pilot …` line, and
`window.CITY.massingPilotStats` has the same numbers. The `[init]` line gains a `massingData` phase for the script
load.

### Rebuilding the pilot data

```sh
node tools/build-massing-pilot.mjs [<3DMassingShapefile_2025_WGS84.shp>]
```

The default path is `~/.cache/slop-toronto/raw/massing2025/`. The tool needs the committed geodata and its IDs
sidecar, and refuses a mismatched hash. It reads the shapefile in 0.4 s.

### Tests

`tests/massing-pilot.test.mjs` (6 tests, about 7 s) checks:

- the data against the geodata and the durable IDs
- ring hygiene
- the extruded geometry: winding, outward walls, roof area equal to the footprint area, frame ranges
- the collision runs
- the 28c0af7 fixtures
- `buildCityBlocks` with stand-in materials: without the pilot data, no footprint material, mesh or polygon collider;
  with it, exactly the pilot rows lose their boxes, and every footprint vertex has its normal, frame and paint

### Captures

**Setup.** Mac mini (Apple M4, Metal WebGPU) through `gpu2` (`slop-toronto-r3-phone`), serving `dist/`, on
2026-10-30. The machine was shared, so these are functional and visual evidence only, not performance numbers.

**Shots.** `tools/shots/massing-pilot.json` has 9:

- street level: Kensington Ave, Augusta Ave, Baldwin St, Spadina's west side, Bellevue Ave
- aerial: oblique from the south-east, overhead from 330 m, low over Augusta, over the market core

**Runs.** Each shot ran before and after, at two sizes:

- desktop: 1600×900, high tier
- phone: 412×915 at DPR 2.625, touch, `?quality=low`

Each shot logs a census: draws and triangles per pass and group, over 10 frames. The phone tier renders every
other frame, so its per-frame figures are halves.

**Collision views.** `tools/shots/massing-collisions.json` uses `?debug=collisions`: a walker on Kensington Ave and
at the Augusta/Baldwin corner. The collider outlines are drawn over the city, so you can see that the walker now
meets the polygon walls, not the old boxes. Near the walker there are 11 building colliders instead of 14 box parts.

**Frames** in `/Users/johnfewell/code/ride-anywhere-geo/review/gpu2/slop-toronto-r3-phone/`:

- `desk-before-*` / `desk-after-*`
- `phone-before-*` / `phone-after-*`
- `coll-before-*` / `coll-after-*`
- each run's console log

**What they show:**

- **Aerial views.** The flat roofs now follow the stepped, notched outlines. The boxes overshot them: compare the
  overhead and market-core pairs.
- **Street level.** Walls stand where the City measured them, and the boxes' overhang onto lanes is gone. Storefront
  glazing follows the street edges: Augusta's west side now has its shop fronts.
- **Party walls.** No longer visible as windowed walls between row houses.
- **Pitched houses** keep their hips.
- **No errors.** Neither page logged an error. `[buildings] massing pilot` reports 647 buildings, 0 rejected,
  22,023 triangles in 5 meshes, 11–13 ms.
- **Spadina shot.** Street traffic differs between runs: a car and a streetcar block parts of it.

**Problems the captures found and fixed:**

- **Flickering walls.** Two overlapping records drew coplanar walls (the first Augusta frame). Their walls are now
  left out (section 2).
- **Black walls.** A commenting mistake dropped the footprint paint, and the walls came out black. A
  `buildCityBlocks` test now guards the paint.

**Cost** (view = the main camera; shadow = buildings plus their stand-ins in both cascades):

| Desktop | Buildings' view draws | Buildings' view triangles | Shadow triangles |
|---|---|---|---|
| Kensington Ave | 28 → 33 | 401,844 → 410,221 (+8,377) | 137,395 → 152,831 |
| Augusta Ave | 27 → 32 | 397,138 → 406,267 (+9,129) | 135,698 → 155,808 |
| Bellevue Ave | 29 → 32 | 400,120 → 406,827 (+6,707) | 141,507 → 164,513 |
| Oblique aerial | 57 → 62 | 561,492 → 572,339 (+10,847) | 199,640 → 219,098 |
| Overhead | 29 → 34 | 382,268 → 388,539 (+6,271) | 304,592 → 327,598 |
| Market core aerial | 41 → 46 | 493,470 → 501,847 (+8,377) | 184,937 → 205,125 |

- **Draws.** The 5 footprint meshes add 5 view draws and 22,023 triangles wherever the pilot is in view. Removing
  the replaced boxes saves 6–15k instanced triangles, so the net is about +6–11k triangles.
- **Shadows.** The stand-ins add about 13–24k shadow triangles. The shadow draw count is unchanged (±4, other
  systems).
- **Whole-frame draws** move by +1 to +6 out of 220–390.
- **Phone tier.** Same pattern, per rendered frame: +5 draws, +4–13k view triangles, +6–23k shadow triangles.
- **Build time** (`[init]`, one run each, contended):
  - desktop: `blocks` 126 → 147 ms
  - phone: `blocks` 122 → 156 ms
  - fetching and running the 184 KiB data script: 13–26 ms
  - shader compile: 1,780 → 1,840 ms on desktop and 1,684 → 1,838 ms on phone, for 5 more pipelines

  None of this is an idle baseline. Phase st-2nl.3 owns the matched measurement.

**Known after merging origin/main.** Main now ships a prebuilt CaféTO layout keyed to the colliders' fingerprint.
With `?massing=1` the colliders differ, so the page warns and lays the patios out at startup instead.
This is expected for the flag. It goes away when the polygons become the default and the patios are prebuilt
against them.
