# Toronto Islands arrival experience (js/waterfront-island-arrivals.js)

Source-backed arrival layer at the three real Toronto Islands ferry terminals — Ward's Island, Centre Island and
Hanlan's Point (st-sb3r.9, blocked on the mainland st-sb3r.5 contract). This module is built from **actual OpenStreetMap
geometry fetched by `tools/build-island-arrivals.mjs`**, not from probing the water mask.

Revised after review: the earlier draft fabricated straight piers by probing the nearest wet cell and treated the
committed geodata's ferry-dock POIs — which are actually **Bike Share docking stations** — as berths. Both errors are
corrected below.

## 1. The real data (what was fetched, and how)

The committed geodata carries the island ferry docks only as `amenity=bicycle_rental` Bike Share POIs (for example
"Centre Island Ferry Dock" node 12966081673 is a 35-dock Bike Share station), and it omits the island footpaths. So the
terminal geometry and its approach paths were acquired from the **official OSM API** and stored locally:

- Tool: `tools/build-island-arrivals.mjs` (reproducible; network fetch).
- Output: `js/waterfront-island-arrivals-data.js` (small committed data file; world metres; keyed by OSM id).
- Source: `https://api.openstreetmap.org/api/0.6/map` + `.../{type}/{id}/full`, OpenStreetMap contributors, ODbL.
  Terminal ids cross-checked via Nominatim `amenity=ferry_terminal` (fetched 2026-11-09).

| Dock | Real OSM feature | Type | Notes |
| --- | --- | --- | --- |
| Ward's Island | way **251286976** "Ward's Island Ferry Dock" | polygon (22 pts) | `amenity=ferry_terminal, building=no, ferry=yes, wheelchair=yes` |
| Centre Island | way **1175136270** "Centre Island Ferry Terminal" | polygon (26 pts) | `amenity=ferry_terminal`, 55 Avenue of the Islands |
| Hanlan's Point | node **56794382** "Hanlan's Point Ferry Dock" | node | `amenity=ferry_terminal, public_transport=stop_position` |
| Hanlan's water taxis | way **1375105747** | polygon (5 pts) | `man_made=quay, mooring=commercial` |

The tool also extracts the **real connecting footways** within reach of each dock (footway / path / pedestrian / steps /
cycleway, plus `man_made=pier|quay`, plus any `surface=wood`), stored with their surface tags and node coordinates. The
dock approaches are **asphalt / concrete / paving-stone footways**; there is no wood/boardwalk at the immediate
approach of any of the three docks (`woodConnectors = 0` in the data), so none is drawn as timber.

## 2. Geometry

World frame: 1 unit = 1 m; x is grid east, z is grid south; ground y = 0; lake surface y = −0.7 m. Projection from the
committed geodata (`lat0 43.6453, lon0 −79.3806, kx 80682.47, ky 111105.32, theta −0.2895`).

- **Terminal decks**: the Ward's and Centre berth **polygons are drawn as raised platforms** on their exact mapped
  footprint (ear-clipped top + a 12 cm side cap). Ward's berth is concave, so the top is triangulated with
  `ShapeUtils.triangulateShape` (ear clipping), not a centre fan that spilled triangles outside the mapped outline.
  Hanlan's is a **node**, so a small estimated platform (`nodePlatform` half-size 3.2 m) is drawn at the mapped node;
  the water-taxi quay polygon is drawn too.
- **Levels (corrected)**: the generic park lawn is drawn at `CITY_BOUNDS.sidewalkHeight + 0.004` (0.224 m). The first
  draft put the deck top at **0.16 m — below the lawn**, so grass covered Centre's deck, Ward's overlapped patchily and
  Hanlan's platform was buried. The deck tops are now **0.230 m** (`sidewalkHeight + 0.01`, a 6 mm apron lip; the
  12 cm cap leaves the underside at 0.11 m — never a raised 1 m slab), and the paved footway strips sit at **0.226 m**,
  just above the lawn.
- **Arrival paths**: each real connector polyline becomes a walking strip in its **mapped surface colour**
  (asphalt `0x5a5d61`, concrete, paving_stones, …). Timber (`0x9b7b4f`) is used **only** where the OSM surface is
  `wood` (`isWood`) — none at these approaches today.
- **Deck anchors**: the name posts and colliders stand on the **dry centroid** of each berth (`deckAnchor`), robust to a
  concave berth whose vertex-centroid falls in a water channel (Ward's).
- **Surface contract**: `CITY.islandArrivalSurfaceAt(x, z)` returns `{ h: deckTop=0.230, dockId, routeName }` on a
  terminal deck, else `null` — the same value the deck top is rendered at.
- **Name boards**: a legible canvas **atlas** (fixed 1024×128, the three route names drawn once; per-board UV cell) so
  the names are readable and bounded. Each board now gets its **own copied geometry** (the first draft shifted one
  shared UV set inside the loop, so the second and third names sampled wrong, cumulatively shifted cells) and is turned
  to face inland, along the approach (`d.boardFacing`), so a front camera on the walkway reads the name rather than its
  mirrored back. Without a DOM canvas (headless), a documented **colour-panel fallback** is used and
  `stats.nameAtlas = false`.

### 2.2 Ground masking (the generic lawn under the aprons)

`applyWaterfrontIslandGroundMask(lawnMat)` composes a discard into the park-lawn material for world points inside the
**exact** mapped terminal rings, the estimated Hanlan's platform square, the mapped taxi quay, or a drawn OSM footway
corridor (the same width the renderer uses). It mirrors `js/waterfront-beach-ground.js`: it `and`s with an existing
`maskNode`, is idempotent (`mat.userData.waterfrontIslandMask`), and is a no-op on a non-node material, **before the
builder has run in a supported frame**, or when the active frame does not cover the docks. Nothing is buffered: the
masked area is the real aprons (a few thousand m²), so the nearby shore and grass are never broadly erased. Native
mapped park paths (`GEO.parkPaths`) that cross a covered area are exempt, so they stay clear.

`islandArrivalsGroundLayout()` returns the exact `{ areas, corridors, exemptions, skipped }`, and
`islandArrivalGroundExclusionPolygons()` exposes the same plans for a CPU caller.

### 2.1 Frame independence (detail vs Eglinton)

Verified by decoding both committed bins with `js/geodata-loader.js`: the two frames share an **identical**
`GEO.frame.projection` but have different bboxes and building counts (35,266 vs 140,541) and therefore different
building indices. The dock data is stored in **world metres keyed by OSM id** (never a geodata index), so the module is
identical in both frames. A test builds it against each frame's water mask and asserts equal dock/pier/connector counts.

## 3. What was deliberately NOT built

- **No probed fake pier, no straight ray to nearest water.** The terminals and their approach paths are mapped geometry.
  Where a terminal is a node (Hanlan's) a small platform is drawn at the node and marked `estimated`.
- **No bike-station-as-berth.** The geodata Bike Share POIs are not used; the real `amenity=ferry_terminal` features are.
- **No invented boardwalk.** Timber only where `surface=wood` (none at these dock approaches). No path crosses water.
- **No invented kiosks / seating / snack stands / buildings.** Centre's real "Lockers & Snack Shop" and "HK Lions Club
  Pavilion" remain the generic geodata buildings.

## 4. Build and integration

Call `createWaterfrontIslandArrivals(THREE, scene)`; it returns `{ group, colliders, stats, layout,
islandArrivalSurfaceAt, islandBuildingReplacedAt }` and sets `CITY.waterfrontIslandArrivals`. It only builds when
`js/waterfront-island-arrivals-data.js` is loaded and the active frame covers the dock footprints
(`supportedCityFrame`).

| Stat | Value |
| --- | --- |
| docks / piers | 3 / 3 |
| connectorsRendered / woodConnectors | 26 / 0 |
| nameAtlas / nameBoards | false (no DOM) / 3; true with a DOM |
| meshes / triangles | 3 / 396 |
| colliders | 3 (one name-post per dock, bounded) |
| deckTop / lawnTop / walkTop | 0.230 / 0.224 / 0.226 m |
| groundAreas / groundCorridors | 4 / 26 (Ward + Centre rings, Hanlan platform + quay; one corridor per drawn footway) |

**Captain integration checklist:**
1. `<script src="js/waterfront-island-arrivals-data.js"></script>` then
   `<script src="js/waterfront-island-arrivals.js"></script>` after `city-config.js` and the geodata (and
   `waterfront-ferries.js` if you want the shared `FERRY_ROUTES`).
2. Call the builder in the island build path (both frames).
3. **Wire the ground mask (the captain's one edit):** in `js/city-grid.js`, right after
   `const lawnMat = createParkLawnMaterial(false);`, add `window.CITY.applyWaterfrontIslandGroundMask?.(lawnMat);`
   (beside the existing beach-ground call). Apply it to the **lawn material only** — never the forecourt/path, walk,
   plot, water or kerb materials. It no-ops until the builder has run.
4. **Ground/stand:** if `CITY.islandArrivalSurfaceAt(x, z)` returns a height, treat the point as on that terminal deck
   (as with `waterfrontDeckSurfaceHeight`). The sampler is gated on `CITY.waterfrontIslandArrivalsEnabled`, so it does
   nothing until the builder has run in a supported frame.
5. Optional massing suppression on the dock footprints: `CITY.islandBuildingReplacedAt(x, z)`.

No other file was edited by this module's author (the generated data file is produced by the tool).

## 5. Capture shots

`tools/shots/waterfront-island-arrivals.json`: HUD-hide warm-up, street + aerial (golden) of each of the three docks, an
overview, a **walker shot on each deck** (`ward/centre/hanlans-deck-walk-nameboard-midday`, mode `person`, teleported to
the deck anchor, asserting `controllerManager.getGroundHeight(...) == ISLAND_ARRIVAL_ESTIMATES.deckTop` and framing the
name board from its front), and a functional check. Run on the Mac mini via `gpu2` (never the laptop GPU), once
`map=detail` and once `map=eglinton`:

```sh
GPU2_LOCK_WAIT=600 gpu2 waterfront-island-arrivals -- env \
  CAPTURE_QUERY='?quality=high&autoscale=0&transit=timetable&film&cloudSpeed=0&map=detail' \
  CAPTURE_PROGRESS=1 CAPTURE_TAG=ia \
  node tools/capture.mjs tools/shots/waterfront-island-arrivals.json
```

The `arrivals-check-enabled` shot throws if arrivals are disabled, a deck anchor is water, a surface mismatches the deck
top, connectors/boards are missing, or the surface is not gated off when disabled.

## 6. Uncertainty register

- **Hanlan's platform**: the terminal is a node with no berth polygon; the platform size/height are estimated at the
  mapped node. A photographed berth could refine it.
- **Deck height / board sizes / platform thickness**: estimated; the deck top is the render/ground contract value
  (0.230 m). The 6 mm apron lip above the lawn is chosen to beat the lawn without reading as a wall; the exact OSM
  berth polygon is used, so the apron is only as big as the real dock.
- **Name-board facing**: the board faces the nearest mapped approach node (`boardFacing`). It is a cosmetic yaw, not a
  surveyed orientation; no board is placed outside the deck anchor.
- **Paths**: only the real OSM connectors near each dock are drawn; their width is from `width` tag where present, else
  an estimated 2.2–2.4 m. Any island trail absent from OSM is not drawn.
- **Wood/boardwalk**: none at these approaches per OSM today; the module will draw timber automatically if a wood
  connector appears.
- **Ferry vessels / schedules / animations**: out of scope.

## 7. Sources

- OpenStreetMap contributors, ODbL — the terminal ways/nodes, footways, piers and quay listed in §1 (fetched 2026-11-09
  from the official OSM API into `js/waterfront-island-arrivals-data.js`).
- City of Toronto, Island Ferries — <https://www.toronto.ca/explore-enjoy/toronto-island-ferries/>
- City of Toronto, Getting Around the Island — <https://www.toronto.ca/explore-enjoy/toronto-island-ferries/getting-around/>
- Cross-references: [docs/waterfront-realism.md](waterfront-realism.md) §8–9; [docs/waterfront-ferries.md](waterfront-ferries.md);
  [docs/toronto-island-woods.md](toronto-island-woods.md).