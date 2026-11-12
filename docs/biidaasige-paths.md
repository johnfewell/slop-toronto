# Biidaasige Park — paths and promenade

Bead **st-bmyv.7** (parent `st-bmyv`). This pass owns only:

- `js/biidaasige-paths.js` — the runtime adapter and the pure prefab factories
- `tests/biidaasige-paths.test.mjs` — the honesty tests
- `docs/biidaasige-paths.md` — this file

No shared runtime, `.beads` export, GPU capture or commit is touched here. The Captain integrates. The play structures
(`st-bmyv.3/.4`), the Fire Hall / Atlas Crane / The Drum (`st-bmyv.6`) and the everyday furniture (`st-bmyv.5`) are
other workers' modules.

## What the runtime builds — exactly three named paths

The adapter `C.buildBiidaasigePaths(scene, allColliders)` draws **only** the three paths current OpenStreetMap maps with
a name inside the intra-park OSM extract the inventory worker (`st-bmyv.1`) clipped and verified. Each is projected
through the city's own `C.worldFromLatLon` (never a private projection) and drawn as a flat ribbon at the park lawn
(`CITY_BOUNDS.sidewalkHeight` ≈ 0.22 m) plus a **0.030 m** lift, above the generic `parkPaths` lift (+0.008 m) and the
waterfront sand (+0.004 m), so nothing z-fights.

| Path | OSM way | Tag | Mapped length | Width drawn |
| --- | --- | --- | --- | --- |
| Biidaasige Park Main Path | `way/1352429162` | `highway=cycleway`, `surface=asphalt`, `foot=bicycle=designated` | ≈ 511 m | 3.0 m (estimate) |
| Don Greenway Trail Loop | `way/1414354033` | `highway=cycleway`, `surface=asphalt`, `foot=bicycle=designated` | ≈ 574 m | 3.0 m (estimate) |
| Water's Edge Promenade | `way/1013210805` | `highway=footway` (the 2026 western section, >250 m) | ≈ 239 m | 2.2 m (estimate) |

**This is an inventory subset, not "all the park's paths".** OpenStreetMap's broad Overpass extract also carries River
Trail North, River Trail South, Wetland Trail Loop, Lower East Don Trail and the Martin Goodman Trail, but their geometry
is **not** clipped to the park here — clipping them is the next (map-registration) worker's job. They are **not** placed
by this module; they are reported `unplaced` (`trails-other-named`).

The widths are **estimates** (OSM carries no widths here). Lengths are the projected polyline length of the exact source
way. Every built ribbon vertex is tested **outside every water ring** and **on the park** (within the ribbon's
half-width of the mapped park edge, since a mapped centreline can graze the boundary).

## What is deliberately NOT built (captain's paths review, 2026-11-10 — authoritative)

1. **No landings of any kind.** A path coming near water is **not** evidence that a 3.2 × 2.4 m pebble apron, a fishing
   platform or a kayak launch exists there. River Bend Landing, East Landing and West Landing are named by official City
   sources but have **no registered current-map position**; they stay **unplaced** until the map-registration worker
   supplies a current official-map anchor with its stated error. The pure factories remain for that worker.
2. **No Canoe Cove marker.** OSM `node/10893913022` is a `natural=bay` **centre** point that lies in the cove water
   (`spatialStatus: adjacent`, ~8 m outside the mapped land polygon). A sign post cannot stand there; **no marker is
   built**. The cove's water is the city's own water polygons, not this module's.
3. **No bridge.** `way/1211500112` is the **whole arch ROAD bridge** (Commissioners Street Bridge, 2024, Cherubiní,
   `man_made=bridge`, `layer=1`) — the committed city already carries a level-correct road bridge. A flat ribbon at park
   ground level would be wrong, so this module does not touch it and draws no bridge plane.
4. **No steps placed.** The source map's Steps symbol is representative and unlocated. On the flat native datum there is
   no measured rise on these paths, so no stair is placed. The `terrazzoSteps` factory is available for a terrain build
   that has a real, measured rise.

## Factories (pure, unplaced)

`C.biidaasigePathsFactories` builds pieces at local origin, 1 unit = 1 m, Y-up, footprint centred — the repo prop
convention — for a later anchor-aware worker to place:

- `boardwalk(THREE, opts)` — a timber deck apron with rails and posts
- `terrazzoSteps(THREE, opts)` — a terrazzo stair block with nosing, cheeks and handrails
- `riverLanding(THREE, opts)` — a pebble/cobblestone apron with a low stepped water edge
- `fishingEdge(THREE, opts)` — a low timber fishing platform with a rail casting gap
- `kayakLaunch(THREE, opts)` — a sloped paddle-craft launch apron with guide rails
- `ribbonGeometry(THREE, samples, halfWidth, y)` — a flat path ribbon from a polyline

The factory **sizes are estimates** recorded in `C.BIIDAASIGE_PATH_SIZES`; the shapes are recognisable, not surveyed.

## Height query (exact triangles, single owner)

The native park ground is **flat** (street y = 0; `docs/biidaasige-terrain.md` §5). This module does **not** invent a
promontory/badland heightfield (the MVVA ~9 m western promontory has no published extent).

- `C.biidaasigePathsTriangles()` returns this module's **own published path triangles** (`{ x0,y0,z0, … , pathId }`).
- `C.biidaasigePathsSurfaceAt(x, z)` returns `{ onPath, surfaceY, pathId } | null` — `surfaceY` is the triangle's **own
  vertex height** at that point (already the lawn + lift). It **never** adds a caller `baseY` and **never** clamps to a
  world height, and returns `null` height off the built paths. Another module that adds relief must own its **own**
  height query over its **own** triangles; this module never adds a base to another system's surface.

## Integration contract (for the Captain)

- `C.buildBiidaasigePaths(scene, allColliders)` → `{ group, colliders, surfaces, unplaced, duplicates, stats } | null`.
- `colliders` are flat, walkable `{ …, surface: true, kind: 'path', pathId }` boxes (one per sample pair so a bend's box
  follows the bend) — **not** walls; a player is never blocked by a path.
- `duplicates` reports any named path running within `DUPLICATE_OVERLAP_M` (3 m) of a generic `GEO.parkPath`. The
  generic runs are **preserved** — this module never masks or deletes them; a shared corridor is reported, not hidden.
- A path wholly outside the active `GEO` frame is reported `unplaced` with the reason, never built.
- Missing projection or missing `BIIDAASIGE_PARK` data → builds nothing and reports the reason in `stats.reason`. No
  fabricated path is ever returned.

## Sources (current)

| Source | Use |
| --- | --- |
| OpenStreetMap Overpass extract, 2026-11-10 (ODbL), clipped by `st-bmyv.1` | ways `/1352429162`, `/1414354033`, `/1013210805`; node `/10893913022` |
| City of Toronto — Biidaasige Park 2026 map (NORTH-UP) `toronto.ca/wp-content/uploads/2026/09/978c-Biidaasige-Park-map.pdf` | trail/Steps symbols are representative, no positions |
| City Recreation page (2026-09-09) | River Bend / East / West Landings and the Steps symbol are named, unlocated |
| Waterfront Toronto 2026-07-24 news | 2026 western section open; Water's Edge Promenade >250 m; Canoe Cove open |
| Captain's paths review, 2026-11-10 | no landings from proximity; no water marker; no bridge; exact-triangle height |

Data © OpenStreetMap contributors (ODbL); City of Toronto; Waterfront Toronto. No images reproduced.

## Regenerate / verify

```sh
node --test tests/biidaasige-paths.test.mjs     # 10/10
```
