# Toronto Islands interior lanes: source gate and road-paint centre-line filter

Bead **st-sb3r.23** (not .19). This pass replaces the rejected in-flight overlay. The earlier module drew cover quads
under the native paint and a flat wooden patch at `y = 0`; neither can remove a yellow line that is drawn above the
cover, and the flat patch contradicted the Algonquin Bridge Road deck. This revision draws **nothing**. It is a pure
gate loaded before `js/road-paint.js`; the road-paint producer simply omits the yellow centre-line geometry where the
gate says the point is a source-confirmed unmarked island lane.

Owned files: `js/waterfront-island-lanes.js`, `js/waterfront-island-lanes-data.js`,
`tools/build-island-lanes.mjs`, this doc, `tests/waterfront-island-lanes.test.mjs`,
`tools/shots/waterfront-island-lanes.json`, and the narrow island-only filter in `js/road-paint.js`. No other module is
edited. `js/main.js`, `explore.html`, `js/city-grid.js`, routing, collisions and carriageway widths are untouched.

## 1. What the sources actually say

OpenStreetMap contributors, ODbL. The lane ways were fetched in the island window
`43.615,-79.405,43.635,-79.335` on **2026-11-10** (Overpass `out tags geom`, per-way versions in `osmMeta`). The kept
ways are the mapped island cartage/living classes (`service`, `living_street`) under the island's private-vehicle regime
(`motor_vehicle=private` or `access=private`). The Billy Bishop airport relation **85471** and the mainland are hard
exclusions in the build tool.

**OSM access tags are not paint evidence.** `motor_vehicle=private` says who may drive, not whether a lane has a painted
line. It is therefore never used on its own to suppress a centre line. The data's `unmarked: 1` flag requires
primary-photo evidence recorded in `summary.sourceProfile`.

The official City guidance used for the regime statement is
[Getting Around the Island](https://www.toronto.ca/explore-enjoy/toronto-island-ferries/getting-around/): the islands
are a car-free community; private cars are prohibited, while service and emergency vehicles are authorised. That is a
traffic-regime statement and is labelled as such in the data.

### Primary photographs (captain reviewed 2026-11-10)

Ordinary resident/traveller photographs published on Wikimedia Commons, not map data. The captain can view the local
copies under `$WATERFRONT_RESEARCH/research/island-lanes/`; the Commons file page is the stable citation. The data marks
`status: "captain-photo-reviewed-2026-11-10"` after direct inspection of all five images. Oneida shows unmarked
herringbone paving; Ojibway unmarked concrete slabs; the three Cibola views show unmarked asphalt. This supports
centre-line omission for the documented class/row scope; it does not establish uniform surfacing or measured widths.

| Photo | Mapped row | Commons file page | Local copy |
| --- | --- | --- | --- |
| Oneida Avenue 2026 | Oneida Avenue (`living_street`) | https://commons.wikimedia.org/wiki/File:Oneida_Avenue_on_Algonquin_Island,_Toronto_2026.jpg | `oneida-avenue-2026.jpg` |
| Ojibway Avenue 2026 | Ojibway Avenue (`living_street`) | https://commons.wikimedia.org/wiki/File:CN_Tower_visible_from_Ojibway_Avenue,_Algonquin_Island,_Toronto_2026.jpg | `ojibway-avenue-2026.jpg` |
| Cibola Avenue, Ward's Island, 2026-09-11 | Cibola Avenue (`service`) | https://commons.wikimedia.org/wiki/File:Cibola_Avenue_on_Ward%27s_Island,_September_11_2026.jpg | `cibola-ward-2026-09.jpg` |
| Cibola Avenue, Ward's Island, 2026-02-28 | Cibola Avenue (`service`) | https://commons.wikimedia.org/wiki/File:Cibola_Avenue_on_Ward%27s_Island,_February_28_2026.jpg | `cibola-ward-2026-02.jpg` |
| Cibola Avenue near Algonquin Bridge 2026 | Cibola Avenue (`service`) | https://commons.wikimedia.org/wiki/File:Cibola_Avenue_near_Algonquin_Bridge,_Toronto_Islands_2026.jpg | `cibola-algonquin-2026.jpg` |

What the captain checks: the photographed lane cross-section (surface, kerb/green edge, and whether a yellow centre line
is actually absent). The photographs are **not** bundled into the app and are not used as textures.

### How the family is applied (conservative)

- The photographed **living-street** rows are evidence for the mapped `living_street` family (27 ways) because the
  photos show that narrow residential cross-section and the OSM class is the same across the named interior rows.
- The photographed **service row** is evidence for **Cibola Avenue only** (12 ways). Every other service lane
  (`Island Service Road`, `The Mall`, `Centre Island Park`, `Lagoon Road`, `Meades Walk`, `Terry Kimball Lane`,
  `Ward's Island Dock Line`, the west/south `Lakeshore Avenue` service rows, etc.) keeps the native paint.
- Result: **39 of 78** mapped ways are `unmarked: 1` (27 living-street + 12 Cibola service), about **7.5 km**. The
  remaining 39 runs keep the native paint, including all unphotographed service lanes.

## 2. The producer hook (the only paint change)

`js/road-paint.js` already decides yellow centre lines in one place. Immediately before each yellow `along(...)` call it
now asks:

```js
const [x, , z] = at(e, s, o);
if (!window.CITY.islandLaneCentreLineSuppressed?.(x, z)) along(...);
```

The check samples the run's 20 %, 50 % and 80 % points and omits the yellow line only if **all three** are on a
photo-evidenced unmarked island lane. Consequences:

- double-yellow (multi-lane) and broken-yellow (one-lane) centre lines are both omitted;
- white same-direction lane lines are not touched;
- a marked mainland road or an unphotographed island service lane is unchanged;
- with the gate absent (mainland-only pages, tests that do not load it) every byte of paint is unchanged;
- no cover geometry, no fake asphalt, no new kerb, no routing/width/height change.

## 3. Pure sampler and frame gate

`js/waterfront-island-lanes.js` never mutates `CITY.GEO`. `islandLanesLayout({ bounds })` accepts a non-mutating
`{ x0, x1, z0, z1 }` box; without one it reads the active detail/Eglinton frame. `islandLaneAt(x, z, { bounds })` does
the same for a point. A projection mismatch, a frame that does not cover the run, or an absent frame returns no gate:
it is a no-op.

Because the gate only answers a point question, `js/city-grid.js` needs no island lane code and `js/main.js` needs no
builder call. The earlier `createWaterfrontIslandLanes` / `islandLaneSurfaceAt` overlay APIs are gone.

### Build-tool correction

The first data build chained ways that shared an OSM node and, when growing a chain at its head, appended the next way
at the tail. That produced single straight data segments 0.8–3 km long across lagoons and the harbour (Cibola Avenue,
Island Service Road, Lakeshore Avenue and others). The rebuild writes **one run per mapped OSM way** and drops any way
whose own geometry jumps more than 1.5 km. Every run now has `maxGapM < 300 m`; the test suite proves it.

## 4. Captain wiring (explore.html only)

Load the data and gate **before** `js/road-network.js` / `js/road-paint.js` in the script list of `explore.html`, e.g.
next to the other island modules:

```html
'./js/waterfront-island-lanes-data.js',
'./js/waterfront-island-lanes.js',
```

No `js/main.js` change, no builder, no scene object. The captain runs the GPU captures. If the gates are not loaded,
the only effect is that the old yellow centre line remains.

## 4b. Flush verge: the producer edge change and the exact surface sampler

The captain's live review rejected the first verge draft: recolouring the existing raised curb green is not a flush
verge, and a distance-to-ring height formula is not geometry-exact. The revised pass builds a real ramp and stores its
exact rendered triangles.

**The ramp.** On the source-confirmed unmarked edges only, `js/city-grid.js` replaces the former 0.25 m kerb strip and
4.6 m concrete walk band with a single flush ramp from the **road at the block outline** (`roadY = 0`) to the **existing
yard at the prop inset** (`walkY = 0.22 m`). That is the full former band (~4.6 m, slope ~0.048), not the 0.22 m rise
over the 0.25 m kerb. The kerb and walk band are **not built** on those edges (only on the unflagged edges), so no
native slab side pokes through the ramp and no old curb top remains above it. At a flagged/unflagged corner the ramp's
outer vertex rises to the kerb top so it meets the native kerb. This is a **local approximate transition, not a
survey**: the native carriageway width, routing, block footprint and the 0.22 m walking floor are unchanged.

- Gate: `js/waterfront-island-lanes.js` `islandVergeEdgeMaterial(ax, az, bx, bz, nx, nz, opts)` samples three points
  along each block edge (offset outward toward the lane) and returns `'grass'` only when all three sit on a
  source-confirmed unmarked island lane. `islandVergeFlags(inner)` (city-grid) turns that into a per-edge mask. Pure;
  a mismatched projection or absent frame returns no flags, so the native ground is kept byte for byte.
- Producer: `rampGeometryXZ(poly, prop, flags, …)`, `walkBandGeometryXZEdges(inner, prop, y0, y1, keep)` and
  `kerbRingGeometryXZEdges(poly, inner, y0, y1, keep)` (all exportable and unit-tested). The ramp is drawn in the
  **same material as the yard it meets** (`geos[yard]`, resolved before the ramp: `plot`, `paved`, `lawn`, `wild` or
  `rail`), so there is no bright-lawn-against-plot-yard seam; the untouched edges keep the concrete walk (`geos.walk`)
  and stone kerb (`geos.curb`).
- **Quantized winding.** The ramp's triangle winding is chosen on the **Float32 values that are serialized**, not the
  double ones: a thin triangle can flip winding at quantization, and the front-side renderer then culls it while a
  sampler on the double values would still count it. Each triangle is normalised to face up on the quantized positions
  and a truly zero-area triangle is dropped.

**The exact surface sampler.** The producer stores the **actual rendered Float32 triangles** in a small 8 m spatial
grid and exposes:

```js
CITY.islandVergeSurfaceAt(x, z) // -> { h, kind: 'ramp' | 'yard' | 'walk' | 'kerb', id, u, v, w } | null
CITY.islandVergeRampStats()     // -> { triangles, cells }
```

The registry holds the ramp triangles **and** the native top triangles that can overlap the ramp footprint at a
concave corner: the yard's top triangles (all of them, with their actual Float32 `y`; a centroid test is not a valid
triangle-overlap test) and the kept walk-band/kerb top triangles. `islandVergeSurfaceAt` barycentric-samples those same
triangles and returns the **topmost** rendered surface, but only where a ramp triangle is present (`hasRamp` gate), so
it stays scoped to the ramp footprint and is `null` elsewhere. This is why the sampler matches the visible ground even
where the native yard floods over the ramp at a concave corner (a pre-existing native-geometry behaviour, not a new
overlay). The island ground has no terrain drape or road-cut transform, so the stored world-space triangles are the
rendered ones; a future drape would be applied before `vergeRampStore`, not sampled separately. It is `null` before a
build, on an unsupported frame, and off the ramp. It is the contract for the walker's ground hook:

**Captain hook (controllers.js / city-config.js, not wired here).** In `getGroundHeight`, after `sportsGround` and
**before** the deck query, so higher decks still win:

```js
const verge = window.CITY.islandVergeSurfaceAt?.(x, z);
if (verge) ground = verge.h;
```

**Load order.** The gate is read dynamically when `buildCityGrid` runs. Both lane scripts already load before
`main.js` invokes that builder and before `road-paint.js` consumes the gate. Their position after the city-grid function
definition is valid; no loader reorder is required. Actual GPU captures verify the active producer and sampler.

## 5. Verification

```sh
node --test tests/waterfront-island-lanes.test.mjs
node --test tests/island-lane-verge.test.mjs
node --test tests/road-paint-cells.test.mjs
```

`tests/island-lane-verge.test.mjs` (6 tests, all passing) proves: the gate is source-scoped (39 runs, 27 living-street
+ 12 Cibola service) and a mismatched frame no-ops; the ramp spans the full former band (outer at the road, inner at the
yard) and the former band/kerb are not built on flagged edges; the exact sampler matches a **raycast of the whole built
`CityGround`** (every merged mesh, not a detached ramp) on a mixed block and an all-flagged block, including the
near-corner samples and the opposite outline winding; the ramp is drawn in the same material as the yard; and the
sampler is `null` before a build, off the ramp and on an unsupported frame. The test harness uses a lenient merge
fallback only because the node_modules `mergeGeometries` is stricter than the browser's; the browser build is
unaffected.

The focused suite proves: primary-photo provenance and the explicit "OSM private is not paint evidence" rule; one run
per way with no cross-island segment; only the photographed families are unmarked and every other service lane is kept;
`islandLanesLayout({ bounds })` is pure; detail and Eglinton both resolve while a wrong projection / missing frame
no-ops; the gate is true on Oneida/Ojibway/Cibola/Third/Fifth and false on unphotographed service rows, the mainland and
the airport; the wood Algonquin Bridge Road record stays unresolved with no surface overlay API; and `road-paint.js`
removes yellow vertices under a true gate while leaving white lines and gate-absent output unchanged.

Camera set in `tools/shots/waterfront-island-lanes.json`: along-lane views on Third Street, Fifth Street, Lakeshore
Avenue, Oneida Avenue, Ojibway Avenue, Ward's Cibola Avenue, the Cibola/Algonquin Bridge approach, an aerial overview,
and a producer check that the gate resolves the photographed rows and that no rejected overlay API exists.

## 6. Deliberately not done / honest limits

- **Only the source-confirmed edges change; width and routing do not.** The flush ramp replaces the kerb strip and walk
  band on the photographed edges (section 4b); the carriageway width, routing, block footprint and the 0.22 m walking
  floor are unchanged, and the ramp is a **local approximate transition, not a survey** (no measured width is invented;
  the native band width is the limit). The interior road surface material stays as built; only the yellow centre line
  is omitted.
- **The walker follows the ramp through the captain's controller seam.** `islandVergeSurfaceAt` is the exact contract;
  the captain wired it into `getGroundHeight` after `sportsGround` and before the deck query (so higher decks still
  win), with the movement tests covering coarse-curb replacement, missing/NaN fallback and deck precedence. This module
  does not edit controllers.js.
- **The native yard can flood over the ramp at a concave corner.** That is pre-existing native geometry (the inward
  offset self-crosses on these narrow blocks), not a new overlay. The sampler stores the native top triangles and
  returns the **topmost** rendered surface there, so the walker matches what is drawn; the ramp is not claimed to be
  visible under a flooded yard.
- **Unphotographed service lanes keep the paint and the concrete walk.** They are not silently made pedestrian;
  service access remains.
- **Algonquin Bridge Road wood remains recorded, not drawn.** The OSM way is `surface=wood` + `bridge=yes`; its deck
  height is a separate layer this module does not claim, so no flat `y = 0` patch is drawn. The record is in the data
  and the layout's `woodKeptUnresolved`.
- **Geodata beyond the mapped OSM row.** Where the committed geodata's centre line extends past the end of a
  photographed OSM row (for example the far-east end of Lakeshore Avenue near Ward's dock), the gate does not claim the
  extra metres: that piece keeps the native line. The run is omitted only when all three samples are on the mapped row.
- **Captain photo review completed.** The family and row list remain a conservative reading of the linked photographs; the
  captain can trim `FAMILY_LIVING_STREET` / `ROW_PHOTO` in `tools/build-island-lanes.mjs` and rerun the tool.
- **Mainland and airport are excluded** by the build tool and re-checked in tests; no airport gate is touched.
- No full suite, laptop GPU, commit or deploy was run in this task.


### Captain integration checkpoint

Both lane scripts are loaded in `explore.html` after the island-building modules and before `road-paint.js`. The captain
directly inspected all five source photographs on 2026-11-10 and updated the generated provenance status. The corrected
source gate passes all eight focused tests; the integrated suite passes 935 tests with three skips.

**Follow-up (flush verge, 2026-11-10).** The captain's live review (green curb is not a flush verge; the distance
formula is not exact) is implemented as section 4b: a real full-band ramp, the topmost native/ramp triangle registry,
quantized winding, and yard-material continuity. The captain wired `islandVergeSurfaceAt` into the controller ground seam
(after `sportsGround`, before the deck query) with movement tests, and the focused whole-built-ground raycast suite
(6 tests) passes on the detail frame.

Final acceptance: build **ef71e94e099c**, `wave6-verge-final` high/detail and `wave6-verge-phone` 412×915/low both
exit 0; the captain inspected the matched street images. Desktop checked **582 actual rendered-ground raycasts and
controller heights**, maximum difference **4.44e-16 m**; phone checked the same 582 points in all three ground modes,
maximum difference zero. Phone/Eglinton intentionally release CPU mesh arrays, so raycast verification uses high/detail.
The full integrated suite passes **948 tests, zero failures, three skips (951 total)**. Known offline live-vehicle 404s
and the existing signal-phase warning remain baseline logs, not a new regression. Shared-host captures do not establish
performance budgets. No commit or deployment.

Residual source-to-edge coverage (the left curb on Third Street) and native concrete-yard classification beside Oneida
remain visible and are tracked separately in **st-sb3r.24**, now active. Native road widths, merged building footprints
and per-parcel gardens are still approximations; this is not a claim of complete parcel reconstruction.
