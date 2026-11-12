# Toronto Islands ferry-to-beach access and mapped amenity identity (js/waterfront-island-access.js)

Bead `st-sb3r.9`, the island pass after the arrival layer. `js/waterfront-island-arrivals.js` draws the three REAL ferry
terminals and their immediate OSM footways. This module adds the next sourced link: the exact beach polygons, the short
REAL access spurs where a mapped path reaches the sand, the dock -> beach walk (drawing only the pieces the native city
does not already carry), and the exact mapped amenity clusters at the beaches and terminals.

It owns its own files: `js/waterfront-island-access.js`, `js/waterfront-island-access-data.js`,
`tools/build-island-access.mjs`, `tests/waterfront-island-access.test.mjs`, this doc and
`tools/shots/waterfront-island-access.json`. The arrival module, its data and its helpers are untouched.

## 1. Sources (exact OSM ids, versions and fetch date)

OpenStreetMap contributors, ODbL. Beach and building elements fetched through the official API
(`https://api.openstreetmap.org/api/0.6`) and the island amenities/walk graph through Overpass
(`https://overpass-api.de/api/interpreter`) on **2026-11-10**; the data file records `source`, `fetched`, `via`,
`projection` and `osmMeta` (`version`, `timestamp` for every beach relation/way and every sourced way amenity and the
bridge).

| Beach | OSM element | v / last edit | Surface | Mapped area |
| --- | --- | --- | --- | --- |
| Manitou Beach (Centre Island beach) | relation **1463388** | v5 / 2023-07-26 | sand | 23,138 m² |
| Ward's Island Beach | relation **1463389** | v4 / 2023-07-26 | sand | 11,777 m² |
| Hanlan's Point Beach (west shore) | relation **16086110** | v18 / 2026-02-03 | sand | 5,459 m² |
| Gibraltar Point Beach | way **104254897** | v18 / 2025-08-12 | sand | 20,167 m² |

Building amenities fetched for identity:

| Element | OSM | v | Use |
| --- | --- | --- | --- |
| Gibraltar Point Washrooms | way **176885369** | v11 | already drawn by the committed geodata; identity only |
| Hanlan's Pavilion Washrooms | way **638632056** | v6 | real building missing from the geodata; added from its ring |
| Hanlan's Pavilion Showers | way **1375105746** | v2 | real building missing from the geodata; added from its ring |
| Centre Island toilets | way **334837421** | v6 | real toilet building missing from the geodata; added from its ring |
| Avenue Of The Islands bridge | way **10427151** | v10 | the mapped bridge span the Centre route keeps |

City guidance used for the beach identities: [Getting Around the Island](https://www.toronto.ca/explore-enjoy/toronto-island-ferries/getting-around/)
and the City beach pages (Manitou / Ward's / Hanlan's). The airport (Billy Bishop) is **outside** this pass: no airport
geometry, water or aircraft is touched.

The committed geodata is **not** pathless on the island: it carries a subset of the footways as `GEO.parkPaths` (128
rows in the detail frame, 185 in Eglinton) cut to the small parks. It carries **no** `natural=beach` polygon and no
service-road or bridge geometry for the island walks, so the beach surfaces and the missing walk pieces are sourced from
OSM here. The arrival layer's own dock connectors are also counted as native coverage.

## 2. What is drawn

- **Sand**: a flat upward mesh on each exact OSM beach ring at the rendered sand height (`sandMeshY = 0.227 m`,
  `sidewalkHeight + 0.004 + 0.003`); paved access/route-gap links sit at `walkTop + 0.004 = 0.230 m`. No invented
  coastline; the source ring is the boundary.
- **Access spurs**: only the contiguous pieces of a real `footway`/`path`/`service` way within **15 m of the beach
  ring** (22 spurs, 0 wood today). Their surface colour is the OSM tag (`sand`, `asphalt`, `concrete`, `paving_stones`,
  `ground`); timber is used only for a real `surface=wood` / `highway=boardwalk`. There is no wood access at these
  beaches today, so no boardwalk is invented. The real wooden `Lakeshore Avenue` boardwalk elsewhere is not on these
  dock->beach routes and is not claimed here.
- **Missing route pieces**: the data carries each dock -> beach route as its full-resolution mapped OSM edges, with
  surface, width and **bridge flag**. At build time the runtime tests each edge against the active frame's native
  `GEO.parkPaths`, `GEO.roads`, the arrival layer's rendered connectors and the module's own spurs, and draws only the
  uncovered pieces. This is the evidence-backed "actual ferry-to-beach visual walk" without a duplicated whole overlay.
- **Amenities**, at exact mapped nodes or footprints:
  - benches (150), picnic tables/sites (36), drinking fountains (20), BBQs (3) as instanced meshes;
  - toilets / shower-change buildings / shelters / information boards as legible **opaque** text panels on posts, plus
    the real building massing only where the geodata lacks it;
  - beach-access identity panels at the actual mapped access point, labelled with the beach name and mapped walk length.

  Furniture is deduplicated against `GEO.props` and the Open Data bench layout (`CITY.benchStats.sites`); the island
  has none of these today, but the guard is in place. A building already in the geodata keeps its own body; the panel
  goes on its sourced front edge, so no pole stands inside a wall.

## 3. Routes and honest coverage

Computed by Dijkstra over the mapped walkable OSM graph (footway/path/pedestrian/steps/cycleway/service/track/bridleway;
bridges are walkable). No arbitrary connector line is created.

| Dock | Local beach | Route | Native coverage | Drawn gap | Status |
| --- | --- | --- | --- | --- | --- |
| Centre Island | Manitou | 871 m, 12 ways | 133 m covered (15%) | 738 m | fully mapped walk |
| Hanlan's Point | Hanlan's Point Beach | 1,648 m, 13 ways | 135 m covered (8%) | 1,513 m | fully mapped walk |
| Ward's Island | Ward's Island Beach | 444 m, 8 ways | 0 m covered | 444 m | partial |

**Two fully mapped routes + one honest partial.** Ward's beach sand footways are a separate OSM component today. The
route ends at the nearest reachable mapped path point, `(1501, 2283.5)`, and the final **44 m** to the beach ring
`(1532.6, 2253)` is recorded as `finalApproach = { kind: 'informal-unmapped-beach-approach', gapM: 44, wetM: 0, dry: true }`.
It is open beach/grass with **no OSM walkable way tagged**; no boardwalk or connector is drawn across it. The route is
reported as `connected: false`, not as a third fully mapped walk.

Water topology: the Centre route keeps one real mapped bridge — OSM way **10427151** "Avenue Of The Islands"
(`highway=pedestrian`, `bridge=yes`, `surface=concrete`, width 7 m, 50 m span). The tests classify every wet sample: wet
length on a `bridge=yes` edge is allowed and bounded; wet length off a mapped bridge must be under 5 m per route (actual:
0 m). No long unbridged open-water crossing exists.

Rendered gap totals: **2,681 m / 159 mapped edges / 12 runs**; native route length kept: 268 m. Because coverage is
computed per frame, Eglinton draws a slightly different subset (its `GEO.parkPaths` has more island rows); both frames
are tested.

## 4. Footing contract (captain wiring)

- `islandBeachSurfaceAt(x, z)` — sand only, returns `{ h: sandMeshY, beachId, name }`; gated on the builder having run.
- `islandAccessSurfaceAt(x, z)` — **exact rendered footprint** of the sand, access spurs and drawn route-gap pieces;
  returns `{ h, kind, beachId, dockId, pedestrianOnly: true, source: 'osm' }`. Gated on the builder. Use it for
  **person/walker** grounding only (never cars): the beach and the walked links are not roads.
- The captain should wire `islandAccessSurfaceAt` (not only the sand sampler) into the pedestrian ground path so a
  player walking the new ferry->beach pieces has the exact mesh height.

## 5. Lawn mask (bounded, pre-builder lifecycle)

The sand mesh hides the grass visually, but the generic lawn under each exact ring is discarded with
`applyWaterfrontIslandAccessGroundMask(lawnMat)`.

- It is a **bounded DataTexture mask** (one 1-byte texture over the beaches' shared box, ≤2048 texels on the long axis,
  about 1.8 m per texel), not a shader unrolled from hundreds of ring edges. Native `GEO.parkPaths` corridors that cross a
  beach are cleared back into the mask, so a real path is never erased. It only touches the lawn material; water,
  roads and the shoreline are untouched. The visible sand boundary remains the exact source mesh.
- Lifecycle: it is gated on **data + supported frame**, not on the builder, because `js/city-grid.js` builds the lawn
  before this module. It works on a cold context (tested).
- Captain wiring: beside the existing calls in `js/city-grid.js` (after `const lawnMat = createParkLawnMaterial(false);`):
  `window.CITY.applyWaterfrontIslandAccessGroundMask?.(lawnMat);`
- Material check: `js/park-woods.js` tints the **same** `createParkLawnMaterial` colour through its `groundNode`; it does
  not swap in a separate island ground material. So the lawn material hook above is sufficient for the island. If a
  future island floor uses a different material, it needs the same one-line call.

## 6. Build and stats

`createWaterfrontIslandAccess(THREE, scene)` returns `{ group, colliders, stats, layout, surfaces, islandBeachSurfaceAt,
islandAccessSurfaceAt, islandAccessRoute, applyWaterfrontIslandAccessGroundMask }` and sets
`CITY.waterfrontIslandAccess` / `CITY.waterfrontIslandAccessEnabled`. Root name `WaterfrontIslandAccess`; children are
`IslandAccess-Sand`, `-Spurs`, `-RouteGaps`, `-Furniture`, `-Signs`, `-Buildings`. Builds only when the active frame
covers every beach (detail and Eglinton both do).

| Stat | Value |
| --- | --- |
| beaches / sand triangles | 4 / 300 |
| access spurs / wood spurs | 22 / 0 |
| route gap / segments / runs | 2,681 m / 159 / 12 |
| native route covered | 268 m |
| route bridge segments / metres | 1 / 50 (way 10427151) |
| routes connected | 2 of 3 (Ward's partial, 44 m dry untagged approach) |
| amenities | 248 (150 benches, 36 picnic, 20 water, 3 BBQ, 8 toilets, 2 showers, 6 shelters, 23 information) |
| signs / labels | 43 / 23 unique (one bounded atlas with a DOM) |
| buildings added / native kept | 3 / 5 |
| meshes / triangles / colliders | 66 / 11,058 / 215 |

Name/label atlas is a fixed 4-column canvas (≤2048 px), each panel samples its own cell; the panel is mounted a few cm
in front of its own post on the facing side. Without a DOM canvas the documented opaque colour-panel fallback is used.

## 7. Deliberately NOT built

- No invented path, pier, boardwalk or connector. Every route edge is a real OSM way; every bridge is tagged.
- No boardwalk where none is mapped; the Ward's 44 m final approach is labelled unmapped open beach/grass.
- No duplicate building where the geodata already draws it (Gibraltar Point Washrooms).
- No airport/water changes; no mainland beach furniture moved.
- No long route overlay: only gaps not already native are drawn.
- No bench/table/water feature duplicated over an existing native prop.

## 8. Uncertainty register

- **Ward's 44 m final approach**: dry per the authoritative water mask (`city-config.waterAt`), but it has no OSM
  walkable way tag. It is reported as an informal unmapped approach, not a mapped path, and not drawn as boardwalk.
- **Amenity orientation**: benches face the nearest beach point and signs face the nearest ferry dock; this is an inferred
  yaw, recorded in code, not a surveyed orientation.
- **Building heights**: mapped `height` / `building:levels` where present; otherwise an explicit estimate
  (washrooms 3.2 m, showers 3.0 m, other 3.4 m, flagged `heightEstimated`).
- **Node-only facilities** (toilets/showers with no footprint, shelters, information boards) get an identity panel at the
  exact node, not an invented building footprint.
- **Coastline water sampling**: `waterAt` is a raster approximation; the bridge classification and the <5 m unbridged
  wet budget make the topology claim explicit and testable.
- **Route width** where OSM has no `width`: 3.4 m service, 2.4 m footway, 1.8 m path, 2.0 m sand — estimates, recorded.

## 9. Capture shots

`tools/shots/waterfront-island-access.json` (run by the captain on the Mac mini via `gpu2`, never the laptop GPU; once
`map=detail` and once `map=eglinton`):

```sh
GPU2_LOCK_WAIT=600 gpu2 waterfront-island-access -- env \
  CAPTURE_QUERY='?quality=high&autoscale=0&transit=timetable&film&cloudSpeed=0&map=detail' \
  CAPTURE_PROGRESS=1 CAPTURE_TAG=ia \
  node tools/capture.mjs tools/shots/waterfront-island-access.json
```

Shots: HUD-hide warm-up; street/aerial of the three beach-access panels (Manitou, Ward's, Hanlan's); a route-gap walker
on the Centre and Hanlan's missing pieces asserting `islandAccessSurfaceAt(...).h == controllerManager.getGroundHeight`;
a **Ward final-approach camera + walker** at the mapped endpoint looking across the 44 m dry approach; and a functional
check that fails if the beaches/routes/gap/bridge/atlas/sampler state is wrong.

## 10. Sources

- OpenStreetMap contributors, ODbL — relations 1463388, 1463389, 16086110; ways 104254897, 176885369, 638632056,
  1375105746, 10427151 and the island amenity/walk elements (fetched 2026-11-10; versions in `osmMeta`).
- City of Toronto — [Getting Around the Island](https://www.toronto.ca/explore-enjoy/toronto-island-ferries/getting-around/),
  [Toronto Island Ferries](https://www.toronto.ca/explore-enjoy/toronto-island-ferries/) and the beach pages.
- Cross-references: [docs/waterfront-island-arrivals.md](waterfront-island-arrivals.md),
  [docs/toronto-island-woods.md](toronto-island-woods.md), [docs/waterfront-beach-ground.md](waterfront-beach-ground.md).
