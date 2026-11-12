# Waterfront beach details: Sugar Beach & HTO Park

`js/waterfront-details.js` adds the two details that make Toronto's waterfront beaches recognizable in the city:
Canada's Sugar Beach's pink umbrellas and white chairs, and HTO Park's yellow perforated-aluminium umbrellas and
multicolour rounded-slat chairs. It builds them from code (no model files), adds them as a single culling-friendly
group, and does not run until `main.js` calls it.

```js
const details = window.CITY.createWaterfrontDetails(THREE, scene);
// { group, colliders, layout, stats, sites }
```

`createWaterfrontDetails()` also works once `window.CITY.THREE` is set. Call it once.

## What is built

| Place | Address | Umbrellas | Chairs |
|---|---|---|---|
| Canada's Sugar Beach | 11 Dockside Dr | 36 pink canopies | 150 warm-white, 3 horizontal-slat chairs |
| HTO Park | 339 Queens Quay W | 38 yellow perforated aluminium canopies | 76 multicolour (red/yellow/blue/green) rounded vertical-slat chairs |

Published counts are used when the real sand can fit them. When clearance does not fit a published count, the layout
builds fewer and records `counts` beside `published`; it never pads the count onto grass or the promenade. The current
committed geodata fits both published counts on the sand.

## Sources

Recorded 2026-11-09/10.

- **Waterfront Toronto, Canada's Sugar Beach** — <https://www.waterfrontoronto.ca/our-projects/canadas-sugar-beach> —
  36 umbrellas, 150 chairs, 8,500 m², 225 m shoreline, opened 2010-08-09; "brightly coloured pink beach umbrellas";
  image alt text "pink umbrellas, white Muskoka chairs"; candy-striped granite.
- **ASLA 2012 Honor Award, Canada's Sugar Beach** — <https://www.asla.org/2012awards/036.html> — designer Claude
  Cormier + Associés: "soft confection-like pink of the umbrellas"; 150 white Loll 3-slat Adirondack chairs.
- **Landscape Architecture Foundation, HTO Park** — <https://www.landscapeperformance.org/case-study-briefs/hto-park> —
  fine white sand, 38 custom vibrant yellow all-season umbrellas (Landscape Forms Solstice), 25 mounds, 106 trees,
  boardwalk, 5 precast benches, 2007.
- **Nelson Architectural Metal Designs, HTO Park** —
  <https://nelsonamd.com/projects/decorative-grilles-screens/hto-park-toronto> — 108-inch (2.7432 m) diameter
  perforated aluminium umbrellas on 3-inch (76.2 mm) stainless posts. This corrects the earlier 3.9 m estimate.
- **City of Toronto, HTO Park page and current photo** —
  <https://www.toronto.ca/explore-enjoy/parks-recreation/places-spaces/parks-and-recreation-facilities/location/?id=1663&title=HTO-Park>,
  photo <https://www.toronto.ca/ext/pfr/img/1663/5.jpg> — current appearance: multicolour red/yellow/blue/green chairs.
- **Chair chronology** (documented, not blended): an earlier manufacturer photo shows natural-wood chairs
  (<https://nelsonamd.com/images/assets/projects/hto/hto_1250.jpg>); the contractor's later page shows white chairs
  (<https://www.somervillecc.ca/hto-park>); the City's current photo shows multicolour chairs. This module follows the
  dated current City appearance. Exact paint codes and chair manufacturer are not published; the palette is an
  approximation from the photo.
- **OpenStreetMap beach geometry** — `natural=beach` ways 172728993 (Sugar Beach, `surface=sand`, ~3,190 m²) and
  189306980 (HTO Beach, ~1,330 m²), converted to world metres through the committed GEO frame projection. The
  committed `GEO.areas` park rings, `GEO.streetTrees`, `GEO.props` (including nested `parkSign` rows), `GEO.parkPaths`
  and `GEO.cycling` are read from `js/toronto-geodata.js`.
- **Waterfront BIA** — <https://www.waterfrontbia.com/about-waterfront-bia> and the 2021 accessible BIA map
  <https://www.toronto.ca/wp-content/uploads/2021/10/97b2-edc-Waterfront-BIA-map2021-accessible.pdf>.

A source conflict remains: the Waterfront BIA's Sugar Beach listing currently says "yellow umbrellas"; the designer
(ASLA), Waterfront Toronto's project page and its image captions all say pink. Implemented pink per the primary
designer/operator sources.

## Placement: verified sand, not the park

The OSM park polygons include grass, plaza and the diagonal promenade. The umbrella and chair layouts are therefore
clipped to the two mapped `natural=beach` sand polygons, not to the parks:

| | Sugar Beach sand | HTO Beach sand |
|---|---|---|
| OSM way | 172728993 | 189306980 |
| Area | ~3,190 m² | ~1,330 m² |
| Centre rule | umbrella ≥ canopy radius + 0.35 m inside the sand; chair ≥ 0.62 m (the chair's half-diagonal) | same |
| Footprint rule | the full canopy or chair footprint stays on sand; candidates on grass/promenade are rejected | same |
| Other blockers | mapped trees, hydrants, bike rings, shelters, bins, post boxes, park signs, park paths, cycling bands, mapped scrub/wood and explicit shrubs | same |

`GEO.props.parkSign` is a **nested record** (`[x, z, angle, name, house number, street, ...]`, as city-grid.js and
park-signs.js read it); the blocker reader handles both that shape and the flat `[x, z, x, z, ...]` layers. This was a
real bug in the first pass.

Arrangement is a deterministic farthest-point spread on the sand, so the published count is distributed evenly without
being tied to a park-wide grid. Umbrella spacing is `2 × canopy radius + a small gap` (0.6 m at Sugar Beach, 0.25 m at
HTO where the canopies nearly touch); chairs are spaced ≥ 1.0 m and cluster under the canopies first, then fill the
rest of the sand.

The module **no-ops** when the active GEO frame does not include the sand, and when the matching park area is absent:
it does not fall back to hardcoded downtown coordinates at runtime. This is what keeps `?map=eglinton` (and any other
frame) from receiving beaches it did not map. The embedded park rings and sand rings are available only through an
explicit `waterfrontLayout({ fixtures: true })` opt-in used by tests/tools.

## Geometry and rendering

- Sugar Beach chairs: shared geometry with **3 horizontal back slats** (Loll 3-slat Adirondack appearance), 150
  instances, warm white.
- HTO chairs: a separate shared geometry with **rounded vertical slats** (six capsules), 76 instances, four colours
  assigned round-robin. The two chair meshes are separate because the slat direction and colour treatment differ.
- Umbrellas: shared pole + shared canopy per site. Sugar uses an 8-sided fabric canopy; HTO uses a 12-sided metal
  canopy with a heavier rim. HTO canopy diameter is 2.7432 m and the stainless post radius is 0.0381 m, both from the
  manufacturer. Canopy and post heights remain estimates (rim 2.45 m, apex 2.90 m, post 2.7 m) because the
  manufacturer publishes diameter and post size, not height.
- **Six InstancedMeshes**: Sugar poles, Sugar canopies, HTO poles, HTO canopies, Sugar chairs, HTO chairs.
- **Ground**: city-grid.js draws the parks' lawns at `CITY_BOUNDS.sidewalkHeight + 0.004` (0.224 m). There is no
  separate sand mesh in the app today (`js/water-edges.js` keeps this harbour shore crisp), so the furniture stands on
  the existing lawn/park surface at that level — it does not hover over the generic ground.
- **Culling**: `userData.cullDistance` (750 m poles, 900 m canopies, 420 m chairs) and `userData.cullCell` (120 m,
  90 m chairs), with computed bounding spheres. Root group `WaterfrontDetails`.
- **Shadows**: umbrella poles/canopies cast; chairs receive only.
- **Colliders**: 300 — one small pole collider per umbrella and one oriented box per chair, in the app's
  `minX/maxX/minZ/maxZ/minY/maxY/obb` shape.

The whole pass is roughly 47k triangles in six instanced draws before culling; layout is ~150–200 ms in node.

## Integration

`main.js` calls it once after the city, trees and colliders are built:

```js
const waterfront = window.CITY.createWaterfrontDetails
  ? window.CITY.createWaterfrontDetails(THREE, scene)
  : null;
if (waterfront) pushAll(allColliders, waterfront.colliders);
```

The builder adds its root to `scene` itself. `explore.html` / `main.js` are captain-owned and were not edited here.

## Tests

```sh
node --test tests/waterfront-details.test.mjs
```

8 focused tests, all passing. They cover: no build on load; the verified sand way ids; published counts fitting the
sand; every centre **and clearance footprint** on sand; chair spacing and water-facing; tree and real nested-parkSign
avoidance; a synthetic promenade path and shrub patch reducing counts rather than padding grass; unsupported frame and
missing areas yielding empty output; fixtures only by explicit opt-in; six instanced meshes at the lawn height with
culling metadata and 300 colliders; HTO's 2.7432 m canopy, 76.2 mm post, rounded vertical slats and four chair colours;
Sugar's pink canopies and warm-white chairs.

No GPU capture was run; captain `gpu2` verification is still the acceptance step (visual read of pink/yellow umbrellas,
multicolour HTO chairs, no furniture on grass or the promenade, and culling chunks behaving).
