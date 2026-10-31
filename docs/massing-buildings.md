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
| Default on | Planned, in the child beads below: the vertex format, tiers and build cost (st-2nl.3) come first. |

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
- `[buildings] massing: <n> buildings from their polygons (<rejected> of <records> records rejected), …; <triangles>
  triangles, <vertices> vertices (~<MiB> MiB) in <meshes> meshes …; <ms> ms (<ms> ms merging)`

`window.CITY.massingStats` has the same numbers, and the `[init]` line gains a `massingData` phase (the module, the
fetch and the decode). A sidecar built for other rows logs a warning and the buildings stay on their boxes.

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
