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
| Pilot (st-2nl.1) | **Done.** Kensington Market's 647 buildings on their polygons behind `?massing=1` (PR #34). Superseded by the city-wide data below. |
| City-wide data (st-2nl.2) | **Done, flag only.** `?massing=1` fetches `js/massing-data.js` and `data/toronto-massing.bin` (852 KiB, only then) and stands all 35,254 detailed-city buildings on their polygons. The default page loads neither and is unchanged. See [City-wide sidecar](#city-wide-sidecar-st-2nl2). |
| Compact cells and tiers (st-2nl.3) | **Code done, flag only; perf acceptance pending the quiet-mini baseline.** 16-byte vertices, a building table, near/mid/far tiers per 500 m cell, the facade styles merged into two materials, built in a worker. See [Compact cells and tiers](#compact-cells-and-tiers-st-2nl3). |
| Default on | Planned, in the child beads below: needs st-2nl.3's matched baseline first. |

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
St-2nl.2 did this: about 1.8 bytes per corner gzip'd, 2.2 with every other field (below).

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
  - `storefront-signs.js` (the source-keyed signs, on the walls `buildings.js` reports)
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

Measured since (st-2nl.2, [Cost city-wide](#cost-city-wide-input-for-st-2nl3)): 1.11 M triangles, 1.96 M vertices,
about 127 MiB at this format, 259 meshes; 0.34–0.39 s to build in the browser on the Mac mini.


- **Triangles:** about 1.2 M, about twice the boxes.
- **Geometry memory:** about 150 MiB at the pilot's vertex format, which is the real problem.
- **JS build:** about 1.4 s on a fast laptop, which is too slow for the main thread on a phone.

### The plan

St-2nl.3 has done 1 to 4 and the code for 5 ([Compact cells and tiers](#compact-cells-and-tiers-st-2nl3)); 5's
matched baseline is pending a quiet mini.

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

- **Row keys (pilot).** The pilot keyed each polygon to its `GEO.buildings` row and refused a record whose row had
  moved.
- **City-wide sidecar (st-2nl.2, done).**
  - Records are keyed by the durable massing ID (`fid`, `part`), in record order, not by row.
  - A slim ID→row index (`row`) rides along, so the page never needs the 1.9 MB `GEO_IDS`. It is valid only for the
    rows it was built for: the file carries the geodata hash (for the tools) and `rowCheck`, a hash of every row's
    centre and height. The page computes `rowCheck` itself and uses nothing on a mismatch. A geodata rebuild that
    reorders or filters rows therefore can't attach a polygon to the wrong building; it needs `tools/build-massing.mjs`
    re-run, and `tests/massing.test.mjs` fails until it is.
  - Each record is also checked on its own: its row's centre must lie within its outline's bounds (2 m margin).
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
| st-2nl.1 | Pilot: Kensington Market behind `?massing=1` (PR #34, done) | — |
| st-2nl.2 | City-wide polygon sidecar: pack all buildings' rings, holes, bases and party edges, keyed by durable ID, lazily loaded, byte-identical rebuilds (done, flag only: [below](#city-wide-sidecar-st-2nl2)) | st-2nl.1 |
| st-2nl.3 | Compact vertex format, distance tiers and worker-built cells; matched idle baseline on both tiers | st-2nl.2 |
| st-2nl.4 | Polygon consumers: courtyards in collision, acoustics, and the box consumers (signs, patios, entrances, yards, map) through one footprint accessor | st-2nl.2 |
| st-2nl.5 | Roofs from the data: straight-skeleton hips and gables from max/avg heights; multipatch roofs for complex ones | st-2nl.3 |
| st-2nl.6 | Edge faces: polygon-edge face IDs, party-wall ghost signs, storefront and photo-facade hooks (with st-wt0.15 and st-wt0.16) | st-2nl.2 |
| st-2nl.7 | Default on: remove the boxes from the detailed city once 3–6 pass; upstream-sync and credits | st-2nl.3, st-2nl.4, st-2nl.5 |

## City-wide sidecar (st-2nl.2)

### What ships, and when

`?massing=1` now stands every building of the detailed city on its polygon, not only Kensington Market's.

- **`data/toronto-massing.bin`** (852.2 KiB, written by `tools/build-massing.mjs`): every `GEO.buildings` row's 3D
  Massing outer ring and courtyards, keyed by durable massing ID, with the wall classification inputs. Format in
  `js/massing-data.js`.
- **`js/massing-data.js`** reads it. `main.js` imports it only under the flag (`import('./massing-data.js')`), and it
  fetches the file by its hash (`?v=`, set by the tool; `/data/*` is cached for good).
- **The default page** loads neither. `data/toronto-geodata.bin`, its hash and every flag-off path are unchanged:
  `buildCityBlocks` without the data gives byte-identical meshes, instance attributes and colliders to main's (one-off
  digest of everything it returns), so the CaféTO collider fingerprint holds.
- **Replaced:** `js/toronto-massing-pilot.js` and `tools/build-massing-pilot.mjs`. The tool is generalised, not
  forked; `tests/massing-pilot.test.mjs` is now `tests/massing.test.mjs`.

**Why a separate file, not a section of the geodata binary.** Packing it into `data/toronto-geodata.bin` would add
852 KiB (39%) to a 2.14 MiB file every visitor downloads and decodes at startup, for a flag. The separate file reuses
the binary's own container (`tools/geo-pack.mjs` `packGeo`, `js/geodata-loader.js` `unpackGeo`), so there is no new
encoder or decoder to maintain. If the polygons become the default (st-2nl.7), the same layer can move into the main
binary in one line of `tools/geo-bin.mjs`, or keep loading beside it.

### Format

One TGB1 layer, `MASSING`, in columns (one entry per record unless noted):

| Column | Holds |
|---|---|
| `fid`, `part` | the durable ID: `to-3dmassing-2025:<fid>`, or `.<part − 1>` for a multi-polygon record's polygon. Records are in ID order |
| `row` | the slim ID→row index into `GEO.buildings`, valid only when `rowCheck` matches |
| `base` | the roof of a lower part it stands on (a tower on its podium), else 0 |
| `holes`, `corners` | courtyards per record; corners per ring |
| `start`, `step` | per ring, its first corner (m on the decimetre grid), then each next corner as whole decimetres from the one before. Outer rings counter-clockwise in (x, z), courtyards clockwise |
| `partyN`, `partyEdge`, `partyCover` | party edges: outer edge, and how high the neighbour covers it (the page decides which are drawn windowless, below) |
| `hiddenN`, `hiddenEdge` | outer edges another part's wall stands on (no wall, no flicker) |
| `streetN`, `streetEdge` | street fronts: `edge × 2 + 1` on a main street (9 m or wider), else `edge × 2` |
| `skipRow`, `skipWhy`, `reasons` | rows left on their boxes, and why |
| `geodata`, `rows`, `rowCheck` | what it was built for: the geodata script's hash (tools), the row count and a hash of every row's centre and height (page) |

The street fronts are new: the pilot searched the roads for them at startup (`nearestRoads` per edge). The tool now
runs `js/city-config.js` and stores the result, so the page does no road lookups for the polygons. A test recomputes
them for Kensington from the roads and gets the same edges.

**Party walls are height-aware now.** The pilot drew every party edge windowless. City-wide that blanked the towers:
a tower part's probes land on its own podium (a ground-standing neighbour), so every wall of a tower on a wider
podium, and every tower wall beside a low block, came out as a blank lot line (the first city-wide captures: white
slabs on Bay Street, windowless towers in the Financial District aerial). `buildings.js footprintEdges` now draws an
edge as a party wall only when the neighbour covers at least half the wall above its own foot (`partyCover − base ≥
(h − base) / 2`, and more than 0.5 m). Of the 66,151 party edges, 12,410 are covered only below their foot and 6,388
less than half; 51,490 walls (slivers included) stay party walls. The exposed upper part of a party wall (ghost
signs) is st-2nl.6's.

**The decimetre grid.** The rings are cleaned as in the pilot (repeats dropped, points under 0.02 m apart merged,
Douglas-Peucker at 0.2 m), then snapped to 0.1 m and cleaned again (repeats and straight-through corners). The party,
hidden and street tests then run on the snapped corners, exactly what the page draws. A centimetre grid would cost 39%
more (1,204,506 bytes) to keep 8 more buildings off their boxes.

### Size and decode time

| | Bytes |
|---|---|
| Shipped (gzip -9, the file itself: Cloudflare doesn't compress `application/octet-stream`) | 872,639 (852.2 KiB) |
| Raw container | 2,684,600 |
| Brotli 11 of the container (for comparison) | 799,249 |
| Of the gzip'd payload, the ring coordinates (`start` + `step`, each column deflated alone) | 720,691, 1.8 bytes per corner |

Encodings tried for the coordinates (gzip of that column alone): absolute decimetres, deltas across the whole column,
758,486; per-ring deltas with each first corner relative to the previous ring's, 757,548; first corners in their
own column plus per-ring deltas (shipped), 722,195; first corners relative to the row's box centre, 688,267. The last
saves another 34 KB but makes the polygons meaningless without the matching geodata, so it was not used.

**Decode** (node, M5 Pro laptop, median of 8, three runs): inflate and decode 13–18 ms, then expanding the columns to
per-row rings 30–43 ms. On the Mac mini in the page: 26.5 ms and 34–41 ms (captures below). The page logs `[massing] data/toronto-massing.bin: … decoded in … ms, rows in … ms` and leaves a
`massing-decode` performance measure.

### What the build found

`node tools/build-massing.mjs` (3 s, most of it reading the 428,184-record shapefile):

| Measure | City-wide |
|---|---|
| Rows of `GEO.buildings` | 35,266 |
| Records written | 35,254 |
| Skipped (keep their boxes) | 12: 11 outer rings that cross themselves on the decimetre grid, 1 that crosses or touches itself in the source |
| Rings retried unsimplified because the simplified one crossed itself | 13 |
| Parts of multi-polygon records | 244 |
| Courtyards | 199 (3 dropped: under 4 m², or not cleanly inside the outline) |
| Parts on a podium (`base` > 0) | 1,823 |
| Outer edges | 399,144 |
| Party walls | 66,151 |
| Hidden walls (another part's wall stands on the edge) | 11,326 |
| Street fronts | 59,916 (10,187 on main streets), party edges included |
| Corners after cleaning | 400,630; median 9 per outer ring, p90 20, max 280 |

The skipped rows (`node tools/report-massing.mjs --json …` lists them with positions):

- `to-3dmassing-2025:136943.17` and `:136945.16`, two parts of multi-polygon records at (−1384, −334)
- `:137520` at (−778, −323), the one whose source ring touches itself
- `:138821`, `:139670`, `:141395`, `:170234`, `:173415`, `:361614`
- `:355128`, `:355131` and `:355132`, three neighbours at about (250, 600)

All but `:137520` are notches narrower than the grid. On a centimetre grid 4 remain skipped; 12 of 35,266 was not
worth a 39% larger file or a second grid.

### Box fit city-wide

`node tools/report-massing.mjs` compares each polygon (less its courtyards) with the union of the box parts
`buildings.js` draws (sides of 1 m or more), integrated on 0.1 m scan lines:

| | All 35,254 | Houses (16,073) | Mid-rise (9,503) | Towers (3,981) |
|---|---|---|---|---|
| IoU p10 / median / p90 | 0.731 / 0.903 / 0.983 | 0.747 / 0.899 / 0.980 | 0.725 / 0.899 / 0.982 | 0.633 / 0.936 / 0.990 |
| IoU under 0.9 / 0.8 / 0.5 | 17,089 / 6,543 / 717 | 8,116 / 2,733 / 128 | 4,798 / 1,886 / 212 | 1,577 / 854 / 249 |
| Box area vs polygon, median / p90 | +2.0% / +14.1% | +4.3% / +14.1% | +1.3% / +14.1% | +0.4% / +15.1% |

- **Totals.** Polygons 11.96 km², boxes 11.52 km². The boxes reach 0.65 km² outside the polygons (onto lanes, yards
  and neighbours) and leave 1.09 km² of the polygons uncovered. 27,964 buildings overshoot their outline by more than
  1 m².
- **More boxes fit worse.** Median IoU 0.909 with one box (29,975 buildings), 0.865 with two or three, 0.857 with four
  and 0.830 with five.
- **The worst fits** are outlines too thin for the box decomposition. It needs pieces at least 5 m across, so a thin
  L or U (a canopy, a perimeter block a few metres deep) becomes its whole rectangle: 68 m² of polygon under a
  1,487 m² box (`to-3dmassing-2025:101649`), 163 m² under 2,229 m² (`:352247`). A 142 m × 0.8 m structure
  (`:361571`, IoU 0) has no box at all, because both sides must be 1 m. Some go the other way: a 626 m² outline whose
  decomposition kept only one 48 m² piece (`:138536`).
- **Kensington Market**, for comparison, measured median 0.89 and p10 0.73 in the pilot, so the pilot area was
  typical of the city.

### Cost city-wide (input for st-2nl.3)

**Setup.** Mac mini (Apple M4, Metal WebGPU) through `gpu2` (`slop-toronto-r3-phone`), serving `dist/`, on
2026-10-31; shared machine, so functional evidence, not an idle baseline. Shots `tools/shots/massing-citywide.json`
(16): the pilot's nine Kensington views, King & Bay looking north up Bay and west along King, a Financial District
aerial, Cabbagetown's Spruce and Winchester streets and an aerial over it, and a high aerial over downtown. Desktop
1600×900 `?quality=high`; phone 412×915 at DPR 2.625, touch, `?quality=low`. Each shot logs a census over 10 frames
(the phone tier renders every other frame, so its per-frame figures are halves).

**Startup** (`[init]`, one run each):

| | Desktop off → on | Phone off → on |
|---|---|---|
| `massingData` (module, fetch, decode) | — → 92 ms | — → 92 ms |
| of which decode / rows (`[massing]` line) | 28.0 / 31.2 ms | 25.2 / 36.6 ms |
| `blocks` | 155 → 511 ms | 169 → 617 ms |
| of which the polygons (`[buildings] massing`) | 336 ms, 266 ms merging | 394 ms, 295 ms merging |
| `culling` | 229 → 450 ms | 237 → 351 ms |
| `compile` (5 more pipelines) | 1,867 → 2,034 ms | 1,945 → 1,978 ms |
| `streetProps` | the CaféTO layout runs at startup with the flag (400–425 ms instead of 23–26 ms prebuilt), as for the pilot | |

**Geometry:** 1,109,110 triangles and 1,957,846 vertices in 259 meshes (one per facade style per 1 km cell), about
127 MiB at the pilot's 17-float vertex format, replacing 43,923 instanced boxes (527,076 triangles). The JS arrays
that build it are plain number arrays, so the transient heap during the build is about twice that. Node (M5 Pro,
stand-in materials) takes 1.7–1.9 s for the polygons in `buildCityBlocks`, the browser on the mini 0.34–0.39 s.

**Per shot** (view = the main camera; buildings = the `CityBuildings` group; desktop):

| Shot | Whole view draws | Buildings view draws | Buildings view triangles | Shadow triangles |
|---|---|---|---|---|
| Kensington Ave | 397 → 414 | 28 → 45 | 401,844 → 473,650 | 1,830,217 → 1,917,619 |
| Baldwin St | 389 → 458 | 63 → 131 | 547,958 → 836,296 | 2,435,276 → 2,519,412 |
| Kensington oblique aerial | 364 → 415 | 57 → 108 | 561,492 → 848,322 | 1,112,222 → 1,255,640 |
| Bay St at King | 457 → 485 | 43 → 73 | 430,778 → 577,015 | 1,413,459 → 1,445,785 |
| King St W from Bay | 383 → 471 | 72 → 156 | 549,540 → 901,854 | 1,300,341 → 1,338,978 |
| Financial District aerial | 457 → 539 | 73 → 154 | 579,860 → 995,616 | 1,384,375 → 1,497,383 |
| Cabbagetown, Spruce St | 525 → 635 | 89 → 194 | 633,570 → 1,116,207 | 2,750,912 → 2,828,742 |
| Cabbagetown, Winchester St | 514 → 622 | 91 → 196 | 640,726 → 1,133,599 | 2,764,850 → 2,819,687 |
| Cabbagetown aerial | 456 → 507 | 54 → 106 | 549,576 → 841,661 | 1,117,227 → 1,187,751 |
| Downtown aerial | 418 → 525 | 83 → 188 | 622,584 → 1,116,257 | 847,188 → 874,830 |

- **Draws.** Up to about 100 more building draws in view (cells × facade styles), +15 to +110 for the whole frame.
  City-wide, the cells' count, not their size, is the draw cost.
- **Triangles.** +0.07 to +0.49 M in view: the polygons draw the whole 1 km cells in view at full detail, with no
  distance tier, while the boxes they replace were 12 triangles each.
- **Shadows.** +28 to +161 k stand-in triangles; shadow draws within ±40 (other systems).
- **Phone tier** (per rendered frame): −20 to +59 whole-view draws; building triangles −62 k to +181 k (the far boxes
  it already thins are gone, the near polygon cells are new); shadow −108 k to +37 k.
- **Errors:** none. Every run's only console errors are the capture server's missing `/live/vehicles` (both sides).
- **Flag off:** the prebuilt CaféTO layout is used (fingerprint ok) on both tiers, as on main.

**What the frames show** (in `/Users/johnfewell/code/ride-anywhere-geo/review/gpu2/slop-toronto-r3-phone/`:
`desk-off--*`, `desk-on2--*`, `phone-off--*`, `phone-on2--*`, each with its `console.log`):

- **Towers** keep their curtain walls and gain their real plans: chamfered and stepped towers in the Financial
  District aerial, podium steps under them.
- **Victorian streets** (Cabbagetown) look as before from the sidewalk, the rows now on their outlines.
- **The first run** (`desk-on--*`, `phone-on--*`) drew every party edge windowless and blanked many towers (Bay St:
  white slabs; Financial District: flat walls). Fixed by the height-aware rule above; `*-on2--*` are after it.
- **From high up** the polygon city reads a little lighter and flatter than the boxes: no window rows resolve on the
  far cells. A tier question for st-2nl.3.

### Running it

`?massing=1` on `explore.html` (any quality tier). Startup logs:

- `[massing] data/toronto-massing.bin: <bytes> bytes, <records> records, decoded in … ms, rows in … ms`
- `[buildings] massing: <n> buildings from their polygons (<rejected> of <records> records rejected), …; near
  <triangles> triangles, <vertices> vertices (<MiB> MiB); mid …; far … at 16 B a vertex, <MiB> MiB with the table, in
  <meshes> meshes …; built in the worker in <ms> ms (<ms> ms after it was asked), <ms> ms packing and <ms> ms making
  the meshes on the main thread` (st-2nl.3)

`window.CITY.massingStats` has the same numbers (`builtIn`: `worker` or `main`; `cellTiers`: how many 500 m cells are
in each tier now). The `[init]` line gains a `massingData` phase (the modules, the fetch and the decode) and a
`massingCells` phase (the wait for the worker before the culling setup). A sidecar built for other rows logs a warning
and the buildings stay on their boxes. `?massingTier=near|mid|far` holds every cell in one tier; `?massingWorker=0`
builds the cells on the main thread.

### Rebuilding the data

```sh
node tools/build-massing.mjs [<3DMassingShapefile_2025_WGS84.shp>]   # writes data/toronto-massing.bin, sets its ?v=
node tools/report-massing.mjs [--json report.json]                   # box fit and skips, from the committed file
```

The default shapefile path is `~/.cache/slop-toronto/raw/massing2025/`. The tool needs the committed geodata and its
IDs sidecar, and refuses a mismatched hash. Rebuild it whenever `js/toronto-geodata.js` changes:
`tests/massing.test.mjs` fails on a stale sidecar.

### Tests

`tests/massing.test.mjs` (8 tests, about 15 s) checks:

- **Lossless decode.** The decoded layer repacks to the committed bytes; `js/massing-data.js` asks for the file by
  its hash; every corner is on the grid; the columns' lengths agree.
- **Durable IDs.** Every record's ID is its row's in `js/toronto-geodata-ids.js` and resolves to that row through
  `idResolver`; IDs are unique and in record order; every row is a record or a listed skip; a sidecar for other rows
  is refused whole, and a record whose row has moved is rejected on its own.
- **Ring hygiene.** City-wide: winding, no repeats, no self-crossing outer ring, courtyards inside their outline, and
  party, hidden and street edges valid and disjoint.
- **Street fronts.** Recomputed from the roads for Kensington, they match the stored ones.
- **Geometry** (Kensington and the Financial District, 1,000-odd buildings): winding, outward walls, roof area equal
  to the footprint area, frame ranges.
- **Collision runs** (Kensington) and the **28c0af7 fixtures**, as in the pilot.
- **`buildCityBlocks`** with stand-in materials: without the data, no footprint material, mesh or polygon collider;
  with it, exactly the records' rows lose their boxes, and every footprint vertex has its normal, frame and paint.
  It prints the city-wide build cost.

`npm run test:geodata` also rebuilds the sidecar twice from the shapefile (in `PROPS_DATA/massing2025/`) and checks
both runs are byte for byte the committed file. The geodata itself still rebuilds byte for byte.

## Compact cells and tiers (st-2nl.3)

`?massing=1` now builds its buildings as compact cell meshes in three distance tiers (`js/massing-cells.js`), in a
module worker (`js/massing-worker.js`). Still behind the flag: the default page loads none of it.

### Format

One mesh per **facade material** per tier per 1 km block (was: per facade style per 1 km cell). Every vertex is 16
bytes, two `snorm16 × 4` attributes (was 17 floats, 68 bytes):

| Attribute | Holds |
|---|---|
| `position` | x and z in decimetres from the block's centre (exact: the rings are on the decimetre grid); y in 1 cm steps, read only by the CPU (shadow stand-ins, bounds); w = variant × 64 + level × 16 + kind × 2 + along |
| `normal` | the wall's edge (dx, dz) in decimetres, (0, 0) on a roof cap; the building's row in the table (15 + 15 bits) |

- **The mesh's matrix** scales the decimetres back to metres and moves the block into place, so three.js, the frustum
  and `scene-culling.js`'s stand-ins all see ordinary positions.
- **The building table**: one texture (2,048 texels a row, 1.1 MiB) with two texels per building: (height, seed +
  tone, base, cap height) and its paint. The vertex shader (`tsl-materials.js footprintVertex`) reads it:
  - the vertex's height comes from its level (base, top, cap or ground), so wall tops and the caps' 1.2 cm steps are
    exact, and `fromTop` is the height minus y
  - the normal (dz, 0, −dx) / length and the wall's width come from the edge. This is exact, where the planned
    octahedral normal would have rounded both. Rounding matters here: the window offset
    (`floor(seed + dot(normal, …))`) and the bay count (`floor(width / window + 0.5)`) jump on it. The edge costs 4
    bytes, like a 16-bit octahedral normal, and a separate width attribute is no longer needed.
  - a material hook decodes height and normal in the vertex stage (`useFootprintVertex`, as three's own instancing
    does), not a `positionNode`, because the shadow stand-ins only take materials without one.
- **Two materials instead of five.** The two rendered styles share one material and the three curtain-wall styles
  another. Each vertex names its style (`variant`). Every per-style value is still that style's own uniform, picked
  with `select` by a flat varying (`footprintStyled`), so the floats are exactly the ones each style's material had.
  This is what keeps the draw count down: a block draws two meshes a tier, not five.
  - The Distillery's Victorian style (`VICTORIAN`, #76) is the exception. Its `victorian` option picks the arched
    windows, sills and limestone when the shader is built, so it can't vary per vertex. It gets a third footprint
    material of its own (`FOOTPRINT_MATERIALS`), drawn only in the Distillery's blocks, which draw three meshes a tier.
    `createRenderedFacadeMaterial` throws if a merged material mixes Victorian and plain styles.

**Near tier = the pilot, vertex for vertex.** `tests/massing-cells.test.mjs` builds 1,159 Kensington and Financial
District buildings both ways and compares every attribute the shaders read against main's 17-float format
(`tools/massing-legacy-format.mjs`):

- positions within 0.05 mm (float32 rounding of the old absolute positions)
- heights equal
- normals within 3e-8
- wall widths within 4e-6 m
- metres-below-top within 3e-5 m (float32 at 300 m)
- along, kind, seed + tone and paint equal

The wall triangles are identical. The roof caps come from earcut 3.2.4 (`js/earcut.js`, a module worker can't reach
three's copy): the same area to 0.1 %. Three's copy and 3.2.4 both drop a zero-area triangle on six roofs with
courtyards.

### Tiers

Each 500 m cell picks its tier from its distance to the camera (to its box, from the ground to its tallest
building), with a 40 m hysteresis band at each limit (`nextTier`):

| Tier | Within (high / medium / low quality) | Geometry |
|---|---|---|
| near | 600 / 450 / 300 m | the full outline: every wall but the hidden ones, the courtyards, the cap |
| mid | 1,600 / 1,300 / 1,000 m | Douglas-Peucker at 1.25 m (to the segment, not its line). A wall replacing several takes the kind of most of their length. Walls that a neighbour as tall covers for their whole height are left out, and so are courtyards under 4 m². A simplification that crosses itself keeps the full rings (64 of 35,254). |
| far | beyond | the building's boxes (its `GEO.buildings` parts, as the default city draws them), from the ground, on the same format and materials |

- **Draw ranges, not more meshes.** Each mesh holds its block's four tier cells back to back in its index buffer.
  `tierRuns` gives the ranges for the cells now in its tier: at most two. A second mesh shares the first one's
  buffers for the second range. Only the tier cells that change move anything.
- **Limits** come from `quality.js` `massingLimits` (× the quality net's distance scale). The phone tier draws full
  outlines only within 300 m.
- **Shadows.** Only the near meshes cast, all of them, through `scene-culling.js`'s stand-ins
  (`userData.shadowStandIn`), so the shadows are those of the full outlines at every tier, as before. Mid and far
  never cast.
- **Startup.** Every near mesh is drawn whole until the first frame after the warm-up, so the stand-ins and the
  pipeline warm-up take all of it. The tiers start from that frame (`updateMassingTiers` in the frame loop).
- **`?massingTier=near|mid|far`** holds every cell in one tier (A/B captures).

### Off the main thread: a worker, not prebuilt buffers

The cells are built in a module worker. `buildings.js` falls back to the main thread when there are no workers, the
worker fails, or with `?massingWorker=0`; `CITY.massingStats.builtIn` says which ran. Why not ship prebuilt cell
buffers:

- **Size.** All three tiers come to about 75 MiB of vertices and indices, against 852 KiB for the polygons they are
  built from.
- **Runtime inputs.** A wall's kind, a building's paint, seed and facade style come from `buildings.js`'s runtime
  choices: storefront selection, nearest roads and its random stream. Prebuilt buffers would need a second copy of
  that logic in a tool, and a rebuild whenever it changes.
- **Precedent.** The codebase already builds off the main thread this way: the audio synthesis worker
  (`audio-system.js`), with a main-thread fallback. `tools/build-site.mjs` fingerprints the worker
  (`'./js/massing-worker.js'`) and its imports like any script.

The main thread keeps the per-building choices (`buildCityBlocks`), packs them into typed arrays (`packInput`, about
25–50 ms), and posts them. The worker builds every tier and transfers the buffers back. Creating the meshes takes
about 2 ms. `main.js` waits for the worker only just before the culling setup, which needs the near meshes for the
stand-ins. By then the rest of the city has been built, so the wait was 1 ms in the captures.

### What it costs (deterministic, node)

`node tools/report-massing-cells.mjs` uses buildings.js's own records, built both ways, and the frustum of every
shot in `tools/shots/massing-citywide.json`. It runs desktop 1600×900 with the high limits, and phone 412×915 with
the low limits:

| | Vertices | Triangles | Bytes/vertex | Vertex MiB | Index MiB | Meshes |
|---|---:|---:|---:|---:|---:|---:|
| pilot format (17 floats, 1 km × 5 styles) | 1,957,846 | 1,109,110 | 68 | 127.0 | 7.0 | 259 |
| near tier | 1,957,846 | 1,109,108 | 16 | 29.9 | 8.0 | 109 (+109 twins) |
| mid tier | 1,127,395 | 620,102 | 16 | 17.2 | 3.5 | 109 (+109 twins) |
| far tier | 878,460 | 439,230 | 16 | 13.4 | 2.5 | 109 (+109 twins) |

- **Geometry memory.** All three tiers stay resident: 75.7 MiB with the table, against 134.0 MiB for the pilot's one
  tier. The near tier alone is 37.9 MiB. The shadow stand-ins are unchanged: a float copy of the near triangles,
  about 38 MiB, as before.
- **Mid tier.** 251,938 of 399,144 outer corners kept. 34,923 covered party walls dropped.

The building meshes the frustum draws, and their triangles. Before: the pilot's 1 km cells, drawn whole. After: the
index runs of the cells' tiers.

| Shot | Desktop draws | Desktop triangles | Phone draws | Phone triangles |
|---|---|---|---|---|
| k1-kensington-ave-north | 35 → 24 | 315,322 → 194,116 | 16 → 16 | 136,976 → 93,333 |
| k2-augusta-north | 28 → 21 | 232,955 → 178,733 | 15 → 10 | 117,637 → 76,878 |
| k3-baldwin-west | 120 → 65 | 676,924 → 347,691 | 90 → 57 | 576,723 → 262,628 |
| k4-spadina-west-side | 82 → 49 | 312,818 → 212,530 | 37 → 27 | 161,261 → 97,601 |
| k5-bellevue-houses | 37 → 26 | 320,674 → 209,716 | 15 → 16 | 150,837 → 96,063 |
| k6-aerial-oblique-se | 96 → 54 | 686,034 → 343,408 | 35 → 34 | 298,483 → 158,420 |
| k7-aerial-overhead | 30 → 16 | 249,911 → 163,264 | 10 → 6 | 89,326 → 64,924 |
| k8-aerial-low-augusta | 58 → 29 | 475,487 → 255,998 | 17 → 15 | 171,673 → 110,741 |
| k9-aerial-market-core | 62 → 36 | 505,733 → 287,323 | 16 → 20 | 140,286 → 120,280 |
| d1-bay-north-at-king | 61 → 37 | 431,053 → 213,131 | 31 → 27 | 196,885 → 117,104 |
| d2-king-west-from-bay | 146 → 81 | 758,532 → 326,234 | 108 → 58 | 505,761 → 234,823 |
| d3-financial-district-aerial | 144 → 83 | 851,932 → 372,390 | 59 → 30 | 419,954 → 180,033 |
| c1-cabbagetown-spruce-west | 181 → 85 | 958,937 → 438,638 | 134 → 74 | 846,840 → 371,197 |
| c2-cabbagetown-winchester-west | 183 → 91 | 974,419 → 437,367 | 138 → 68 | 874,107 → 370,114 |
| c3-cabbagetown-aerial | 93 → 56 | 689,267 → 313,120 | 21 → 20 | 130,461 → 86,737 |
| a1-city-aerial-north-west | 182 → 85 | 975,893 → 391,556 | 70 → 28 | 467,337 → 190,965 |

**JS build** (node on the M5 Pro laptop, median of 3, an indication only): the pilot's merge took 320–350 ms for one
tier; `buildMassingCells` takes 330–350 ms for all three, and in the page it runs in the worker.

### Tests

`tests/massing-cells.test.mjs` (7 tests, about 4 s):

- **Near tier = the pilot format**, vertex for vertex (above).
- **Encode/decode city-wide**, all 3,963,701 vertices of the three tiers:
  - every table row is its record's values
  - near and mid vertices lie on a corner of their own rings, far ones within 7 cm of their box's corner (the
    decimetre grid)
  - a wall's edge is the difference of its two ends
  - the CPU copy of y is within half a centimetre
  - each tier cell's index range holds only its own buildings
- **Determinism.** Two builds are byte for byte the same.
- **nextTier.** 2,000 random walks of 200 steps: the plain tier outside the bands, no flip inside them, no flicker
  standing on a limit.
- **tierRuns.** Every assignment of tiers and empty cells (1,296 cases): every triangle drawn exactly once, at most
  two ranges.
- **The mid tier.** Within 1.25 m of every original corner, its corners the original's, covered walls dropped. The
  far tier is four walls and a two-triangle cap per box.
- **js/earcut.js** is the locked package's code.

`tests/massing.test.mjs` runs `buildCityBlocks` with the main-thread fallback, checks every mesh's two snorm16
attributes and painted table rows, the shadow stand-ins on the near meshes only, and the tiers following a camera.
`tests/storefronts.test.mjs` builds the footprint materials to WGSL, the merged ones included, and checks that the
vertex stage reads the table and sets the height and normal.

### A/B captures (functional, shared mini)

**Setup.** Main (`2b24480`, `dist-main/`) against this branch (`dist/`), both `?massing=1`, through gpu2
(`slop-toronto-r3-ride`) on 2026-11-01. The 16 shots of `tools/shots/massing-citywide.json`, `CAPTURE_SEED=6711`, run
on two tiers:

- desktop: 1600×900, `?quality=high`
- phone: 412×915 at DPR 2.625, touch, `?quality=low`

A third arm holds every cell in the near tier (`&massingTier=near`). The mini was shared with other agents, so these
are functional and visual evidence, not performance numbers.

**Pixels that differ by more than 8 %** (ImageMagick `compare -fuzz 8%`), main against each arm:

| Shot | Desktop: cells | Desktop: near held | Phone: cells | Phone: near held |
|---|---:|---:|---:|---:|
| a1-city-aerial-north-west | 0.350% | 0.022% | 0.198% | 0.001% |
| c1-cabbagetown-spruce-west | 0.017% | 0.034% | 0.010% | 0.016% |
| c2-cabbagetown-winchester-west | 0.005% | 0.027% | 0.025% | 0.016% |
| c3-cabbagetown-aerial | 0.109% | 0.055% | 0.051% | 0.016% |
| d1-bay-north-at-king | 1.413% | 0.691% | 0.276% | 0.249% |
| d2-king-west-from-bay | 3.122% | 3.135% | 0.260% | 0.189% |
| d3-financial-district-aerial | 0.178% | 0.157% | 0.088% | 0.087% |
| k1-kensington-ave-north | 0.005% | 0.017% | 0.002% | 0.002% |
| k2-augusta-north | 0.006% | 0.021% | 1.114% | 1.114% |
| k3-baldwin-west | 0.008% | 0.075% | 0.864% | 0.847% |
| k4-spadina-west-side | 1.778% | 1.804% | 1.519% | 4.311% |
| k5-bellevue-houses | 2.678% | 2.695% | 1.824% | 1.826% |
| k6-aerial-oblique-se | 0.045% | 0.051% | 0.015% | 0.002% |
| k7-aerial-overhead | 0.107% | 0.122% | 0.027% | 0.014% |
| k8-aerial-low-augusta | 0.032% | 0.042% | 0.011% | 0.005% |
| k9-aerial-market-core | 0.047% | 0.038% | 0.013% | 0.002% |

- **Street level.** The buildings are the same. Every difference over 0.1 % is traffic, parked cars or pedestrians,
  which move between runs (look at the diff images): the streetcar on King, a van on Bellevue, walkers on Baldwin.
- **Near tier everywhere** (the aerials with `massingTier=near`): within 0.02 % of main on the desktop's city aerial
  and 0.001 % on the phone's. The format and the merged materials change nothing visible.
- **The tiers.** With the tiers on, the city aerial differs from main by 0.35 % (desktop) and 0.2 % (phone): the far
  cells' boxes and the mid cells' simplified outlines, seen from 700 m up. No holes or stray walls in the frames. The
  shots are still frames: the hand-over between tiers while moving (a pop at 600 m and 1.6 km, no crossfade yet) is
  not judged here.
- **Errors.** None. The only warnings are the ones main has too: three's TempNode deprecation, the audio synthesis
  worker's fallback, and the CaféTO layout laid out at startup under the flag.

**WebGL2 backend** (`?webgl=1`, desktop, three shots, main and branch): the cells render the same, with no errors.
On both, the Financial District aerial shows a speckled band across the facades at golden hour. Main has it with the
flag off too, so it is not this change; it is filed as st-xirf.

**Startup** (`[init]`, one run each, contended):

| | `blocks` main → cells | `massingCells` (the wait for the worker) | `compile` main → cells |
|---|---|---|---|
| desktop | 569 → 326 ms | 1 ms | 2,129 → 1,950 ms (2 footprint pipelines, not 5) |
| phone | 532 → 333 ms | 1 ms | 2,043 → 1,924 ms |

The worker built all three tiers in 422 ms, while the main thread went on through `signage` to `controllers`.

**Census** (Cabbagetown Spruce St, per frame; the phone renders every other frame, so its counts are halves):

| | Building draws | Building triangles | Whole view draws |
|---|---|---|---|
| desktop | 181 → 87 | 958,937 → 438,315 | 636 → 540 |
| phone | 67 → 38 | 423,420 → 185,775 | 175 → 145 |

These are the node report's numbers for that shot (181 → 85, 958,937 → 438,638).

**Frames** in `/Users/johnfewell/code/ride-anywhere-geo/review/gpu2/slop-toronto-r3-ride/`:

- `ab-{desk,phone}-{main,cells,near}-*.png`, with each run's `console.log`
- the side-by-side and diff images in `massing3-ab-sheets/{desk,phone,desk-near,phone-near}/` (`<shot>-ab.png`: main
  on the left; `<shot>-diff.png`: differing pixels in red), and the table above in `*-pixel-diff.tsv`

### Matched idle baseline (pending)

The perf acceptance (frame time, draws, triangles, geometry memory and load time, on both quality tiers) needs a
quiet Mac mini. Captures on the shared mini are functional evidence only. `tools/massing-baseline.sh` runs it
unattended, by the st-wt0.2.2 / st-oiw protocol ([adoption-measurements.md](adoption-measurements.md)).

**Arms** (the same shots and settings for each):

- **main**: `dist-main/`, built from `origin/main`, with `?massing=1`
- **cells**: this branch's `dist/` with `?massing=1`
- **boxes**: `dist/` without the flag

**Each tier** (high 1600×900; low 412×915 touch at DPR 1):

- a warm-up run of main and of cells
- then three rounds, with the arms' order rotated each round
- `?autoscale=0&transit=timetable&film&cloudSpeed=0`, `CAPTURE_SEED=6711`, 2 s warm-up + 8 s windows,
  `CAPTURE_IDLE_CHECK=1`, the long-task init script

**Shots** (`tools/shots/massing-baseline.json`): the stats record, Cabbagetown Spruce St, King St W, Kensington Ave,
the Financial District aerial and the city aerial. Each logs its draw/triangle census before its window. Every run
records read-only host observations before and after (`tools/massing-baseline-run.sh`). Nothing on the mini is
stopped.

Before starting, check that the mini is quiet:

- no other gpu2 job
- production transcription idle
- no rclone, Docker Desktop or Logi Options+ busy
- GPU utilization near 0

Then, from this checkout on the laptop:

```sh
GPU2=gpu2 GPU2_NAME=slop-toronto-r3-ride GPU2_LOCK_WAIT=1800 tools/massing-baseline.sh --build
```

- **Time.** 22 runs of about three minutes each, so 70–80 minutes if nobody else queues on the mini.
- **Checked.** One short round (`PREFIX=mbcheck REPS=1 WARM=0`, two shots) ran end to end on the shared mini on
  2026-11-01. Its numbers are contended, so they are not a baseline:
  `/Users/johnfewell/code/ride-anywhere-geo/review/gpu2/slop-toronto-r3-ride/mbcheck-baseline-summary.md`.
- **Output.** `/Users/johnfewell/code/ride-anywhere-geo/review/gpu2/<GPU2_NAME>/`: every run's files (tags
  `mb-<arm>-<tier>-r<round>`), `mb-baseline-run-order.txt`, `mb-baseline-<arm>-<tier>.summary.json`
  (`tools/metrics-summary.mjs`) and `mb-baseline-summary.{json,md}` (`tools/massing-baseline-summary.mjs`). The
  summary gives, per arm, tier and shot: frame p50/p95, CPU, draws, triangles, attribute memory, and the startup
  phases (ready, `blocks`,
  `massingData`, `massingCells`, `culling`, `compile`, the worker's build).
- **Partial runs.** `--build` rebuilds `dist/` and `dist-main/` first. Without it, both must exist. `REPS`, `SHOTS`,
  `WARM=0` and `PREFIX` are for checking the script itself, not for the baseline.

## Pilot evidence

The pilot's data and tool were replaced by the city-wide ones (above); its captures stay here as the pilot's record.

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
