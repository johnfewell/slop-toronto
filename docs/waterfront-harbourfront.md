# Harbourfront Centre campus (js/waterfront-harbourfront.js)

Source-backed identity and public-realm structure for Harbourfront Centre, 235 Queens Quay West — the 10-acre
waterfront community campus for arts, culture, learning and recreation. This is a narrow follow-up under the Waterfront
BIA realism epic (`st-sb3r.8`). It adds only what primary/mapped sources support: the campus and square identity, The
Power Plant's chimney at its mapped OSM node, and the documented John Quay boardwalk. It deliberately does **not**
invent square furniture, marina slips or piers.

## What it builds (and what it does not)

- **Campus footprint and identity** — the loaded landmark ring (`GEO.landmarks.harbourfront`, ~86,138 m², west x −713
  to east x −152, north z 563 to south z 793) is the placement outline. It is **not drawn as a fence**. Exposed as
  `campusFootprintAt(x, z, margin)` for identity/membership queries — not to strip the city's generic trees across the
  campus.
- **The three named public squares** — **Canada Square** (7,625 m²), **Ontario Square** (3,038 m²) and **Ann Tindal
  Park** (4,293 m²) are real mapped park polygons on the campus (the Waterfront Toronto page records a Harbourfront
  parking lot became new public squares). They are exposed as identity data (`campusSquareAt`, `campusLayout().squares`)
  with their mapped outlines. **The module adds no furniture and no pad over them**: the city's own park layer already
  draws the lawn, and a mapped polygon alone does not justify a planting or bench layout — that would need a primary
  designer plan or survey, which is not available. No trees, benches, lights or square pads are built.
- **The Power Plant chimney** — The Power Plant (231 Queens Quay West) is the 1926 powerhouse for the Toronto Terminal
  Warehouse, opened as a gallery in 1987 and, per Wikipedia, "easily recognized by its smokestack". The stack is a
  **mapped OSM `man_made=chimney` node (historic=yes), node 555405453, at 43.6383998, −79.3818476** (Natural Resources
  Canada CanVec), which projects to world ≈ (−315.3, 706.0) — inside the campus, ~31 m from the tallest Power Plant
  block and ~3 m from the block at (−318, 707.4). The module places a tapered brick stack at **that mapped node**,
  rising from the ground to an estimated height, with a steel balcony cap; it is **not** placed at a building centroid
  and is **not** a roof-height + offset. The mapped massing carries no chimney, so this is the only stack geometry. The
  stack is solid to the player (one collider).
- **The John Quay boardwalk** — Harbourfront Centre Marine describes John Quay as a linear boardwalk on the Inner
  Harbour just outside Marina Four. The module draws short deck slabs chained along the campus ring's mapped waterline
  on the west harbour front (x −713…−382, z ≈ 700…758). **No marina slips or boats are drawn.** No Marina Four floating
  pier is mapped in OSM — the two mapped piers (ways 26594650 "West Pier", 26594651 "East Pier") are outer-harbour docks
  at z 754–838, **outside the campus ring** — so none is invented. Only the documented boardwalk structure is added.

## Geometry conventions

1 unit = 1 m; world x is grid east, z is grid south; ground y = 0, the lake at `CITY_BOUNDS.waterLevel` (−0.7). A mapped
building block's part centre uses the city's own convention (as `js/buildings.js` `pushHipRoof` and `js/city-grid.js`
`clearOfHouses`): `world = (cx + u·cos + v·sin, cz − u·sin + v·cos)` for a local part centre `(u, v)`; see
`buildingPartWorldCentre(block)`. (The earlier reversed `(cx + u·cos − v·sin, cz + u·sin + v·cos)` was a bug and is
fixed; it was latent only because the tallest block's angle is ≈ 0.)

Call `createWaterfrontHarbourfront(THREE, scene)`; it returns `{ group, colliders, stats, layout }` and only builds when
the active frame covers the mapped campus. The group is one culling root, repeated parts are instanced, and meshes carry
`scene-culling.js`'s `cullDistance` / `cullCell`. The build is deterministic (no `Math.random`).

### Unique guard

This module exports its own **`waterfrontHarbourfrontSupported`** and does **not** define or export `supportedCityFrame`.
Four other modules (`waterfront-ferries`, `waterfront-landmarks`, `waterfront-public-realm`, `waterfront-music-garden`)
also used the global name `supportedCityFrame`; exporting it here clobbered theirs via `Object.assign`. This module
keeps a module-scoped `waterfrontHarbourfrontSupported` instead.

## Sources (retrieved 2026-11-09)

- Harbourfront Centre, About Us (10-acre campus; 235 Queens Quay W; 6.3M annual visitors; 1972 Crown corporation /
  not-for-profit since 1991): <https://harbourfrontcentre.com/about-us/>
- Harbourfront Centre, Marine/Marinas (John Quay linear boardwalk on the Inner Harbour just outside Marina Four; Marina
  Four at historic Pier 4 under the City of Amsterdam pedestrian bridge; berth #248; entrance 43 38.261 N, 79 23.016 W):
  <https://harbourfrontcentre.com/program/harbourfront-centre-marine/>
- The Power Plant (1926 powerhouse for the Toronto Terminal Warehouse; "easily recognized by its smokestack"; opened
  1987; 231 Queens Quay W): <https://en.wikipedia.org/wiki/The_Power_Plant>, <https://www.thepowerplant.org/>
- Waterfront Toronto, central waterfront (a Harbourfront Centre parking lot became new public squares and a new
  promenade stretch): <https://www.waterfrontoronto.ca/our-projects/scope-scale/central-waterfront>
- Campus landmark ring and the square park polygons: the loaded City geodata from OpenStreetMap contributors, ODbL.
- The chimney node: **OpenStreetMap node 555405453**, `man_made=chimney`, `historic=yes` (Natural Resources Canada
  CanVec), 43.6383998, −79.3818476. The two mapped piers (OSM ways 26594650 "West Pier", 26594651 "East Pier") are
  outer-harbour docks outside the campus and are intentionally not used.

## Image references (official; not bundled, not treated as measured drawings)

- Campus: <https://upload.wikimedia.org/wikipedia/commons/0/0a/Harbourfront-Centre.jpg>
- Queens Quay at Ann Tindal Park: <https://upload.wikimedia.org/wikipedia/commons/a/a0/Queens_Quay_at_Ann_Tindal_Park.jpg>
- The Power Plant 2023: <https://upload.wikimedia.org/wikipedia/commons/8/80/The_Power_Plant_Toronto_2023.jpg>
- Waterfront Toronto Queens Quay overview: <https://www.waterfrontoronto.ca/our-projects/queens-quay-west>

## Estimated dimensions (unverified)

Recorded in `HARBOURFRONT_ESTIMATES`. The stack geometry would benefit from a survey or the gallery's own drawings.

| Element | Estimate |
| --- | ---: |
| Power Plant stack height (above ground) / base radius / taper | 30.0 m / 1.5 m / 0.74 |
| John Quay boardwalk deck width | 4.5 m |

## Uncertainty register

- **Campus boundary geometry**: the landmark ring (~86,138 m²) is larger than the official 10 acres (40,469 m²); the
  ring includes adjoining mapped frontage and the harbour-edge public realm. It is a placement/identity outline, not a
  legal boundary.
- **Squares**: the three named squares are mapped park polygons; their identity and outlines are exact, but the module
  draws no furniture over them. A source-backed planting/bench layout would need a primary designer plan or survey.
- **Power Plant stack**: its **position** is the mapped OSM node (authoritative). Its **height, radius and taper are not
  published** and are estimated from photographs; `baseY = 0` is a modelling choice (the stack rises from the ground
  beside the Power Plant, not from the mapped roof). The adjacent mapped block is recorded for provenance.
- **Marina**: only the documented John Quay boardwalk is drawn. No Marina Four floating pier is mapped in OSM, so none is
  invented; the boardwalk follows the mapped waterline, not a surveyed deck edge.
- **Ann Tindal Park** has one mapped vertex ~0.6 m outside the campus landmark ring (a notch); the park polygon is kept
  whole as the source.
- **Image content**: image URLs are references; no image was treated as a measured drawing.

## Verification

- `node --test tests/waterfront-harbourfront.test.mjs` — eighteen focused checks against the loaded land, buildings,
  water and the mapped chimney node: frame/area; squares dry and on-campus; **no invented furniture/piers meshes**; the
  stack at the OSM node with an estimated height and an adjacent block (not the tallest-block centroid); the corrected
  building-part rotation; the boardwalk on land with no piers; the unique `waterfrontHarbourfrontSupported` guard (and
  no `supportedCityFrame`); the frame guard; determinism; plus the Power Plant primary-photo refinement (see
  [waterfront-harbourfront-refinement.md](waterfront-harbourfront-refinement.md)).
- GPU captures: `tools/shots/waterfront-harbourfront.json` (street + aerial) run on the Mac mini via `gpu2`, never the
  laptop GPU; captain reviews the images.

The Power Plant's industrial exterior (red-brown brick gallery, multipane windows, glazed entry, flared crown,
grey-metal theatre) is refined against primary photographs in
[waterfront-harbourfront-refinement.md](waterfront-harbourfront-refinement.md).

This is a source-backed identity + structure pass, not a survey reconstruction. No createdAt of the module changes an
existing file; the captain owns `main.js` / `explore.html` / `city-config.js` integration.
