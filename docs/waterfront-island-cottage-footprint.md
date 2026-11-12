# Toronto Islands cottage footprint pilot (st-sb3r.32)

One bounded, source-correct footprint for a single confirmed cottage, with the same rectangle intended to drive its
walls, roof, trim **and** its physical/camera obstacle. It is the geometric pass the audit
([waterfront-island-cottage-footprint-audit.md](waterfront-island-cottage-footprint-audit.md), st-sb3r.30) recommended
after finding the accepted island rows are essentially 1:1 with their mapped ways, but one nearly rectangular cottage
loses most of its mapped area. This pilot changes exactly that row and nothing else; it is not a polygon rewrite.

The audit's headline was: the visible repetition is un-sourced *style* (roof/height), and the real footprint error is
moderate notch/outline loss. This pilot therefore targets the one clean geometric outlier and leaves the 158
non-rectangular cottages alone.

## What it is (and is not)

- It is a **sidecar + helper**: `js/waterfront-island-cottage-footprint-data.js` (generated) and
  `js/waterfront-island-cottage-footprint.js` (the consumer lookup). It never edits `js/buildings.js`, the colliders,
  `data/toronto-geodata.bin`, the accepted profiles, or any door/window work; the captain routes the returned parts.
- It is **source-correct**: the effective rectangle is the mapped polygon's axis-aligned min-bounds in the committed
  row's own yaw frame and native centre, projected with the generator's exact `toWorld`. No invented notch fill.
- It is **not** the `?massing=1` path. `buildings.js` gates the cottage extension with `!foot`, so activating massing
  would disable the accepted cottage siding/roofs. This pilot is a profile override on the box path.
- It is **not a visual-only overlay**: the same parts are meant for the collider, so a walker/camera cannot pass through
  the expanded wall while the old smaller collider stands (the audit explicitly rejected that).

## The pilot

| Field | Value |
| --- | --- |
| OSM way | `487167567` — 7 Nottawa Avenue, `building=detached` |
| OSM version / timestamp | v4 / `2020-04-25T21:46:19Z` (OSM API `way/487167567/full.json`) |
| Cached snapshot | `$WATERFRONT_RESEARCH/research/island-cottages/b.json` (Overpass `way["building"]` bbox query, `osm3s.timestamp_osm_base` `2026-11-10T12:45:01Z`, generator Overpass API 0.7.62.11) |
| Licence | ODbL 1.0 — © OpenStreetMap contributors |
| Committed row | `GEO.buildings[32155]`, centre `(1194.7, 2202.9)`, yaw `0.627 rad` |
| Native identity signature | `[0.627,[[-6.3,6.3,-4,4]]]` (unchanged; this is the guard) |
| Accepted profile | `js/waterfront-island-buildings-data.js`, `typology: "cottage"`, `matchM 1.8` |

Live verification: the OSM API geometry is **identical** to the cached Overpass geometry (5 vertices, max lon/lat delta
0), so the mismatch is not caused by a difference between those two OSM snapshots. This does not independently establish current on-site conditions. The native footprint is genuinely much
smaller than the mapped one.

### Old vs new, in the row's own frame

| | u extent | v extent | width × depth | area | area / source |
| --- | --- | --- | --- | --- | --- |
| Native committed part | −6.3 … 6.3 | −4 … 4 | 12.6 × 8.0 | 100.8 m² | **0.5451** |
| Source polygon (mapped) | −8.851 … 11.438 | −3.329 … 5.957 | — | 184.93 m² | 1.0 |
| Source min-area rectangle | — | — | 20.268 × 9.138 | 185.21 m² | 1.0015 |
| **Effective (this pilot)** | −8.851 … 11.438 | −3.329 … 5.957 | **20.289 × 9.286** | **188.40 m²** | **1.0188** |

The effective rectangle grows the rendered footprint to **1.87×** the native box, taking rendered/source coverage from
0.545 to ~1.0.

### The envelope is quantified, not a buffer

The source is near-axis-aligned: its long edge is **0.419°** off the row axis (short edges 0.25–0.30°), and its
rectangularity is **0.9985**. Taking the axis-aligned min-bounds therefore costs a small envelope, measured exactly:

- envelope area **+3.472 m²** over the source polygon (**+1.879 %**),
- maximum corner protrusion **0.155 m**.

That is the whole cost of not rotating the row; there is **zero added geometry buffer** beyond it. The pilot is a
min-bounds envelope of a real mapped rectangle, not a claim of a survey-grade outline.

## Guards (a row is claimed only when all hold)

1. **Projection** — every `GEO.frame.projection` parameter matches the recorded build projection (a different frame can
   reuse the same numeric centres).
2. **Frame** — the row's world centre is inside **both** the recorded (built) detail frame **and** the active
   `GEO.frame.detail` bounds. The active frame can be cropped tighter than the built frame while sharing the same
   projection (the detail/Eglinton variants), so a built-only test would wrongly claim a row outside the active view;
   requiring both only ever refuses more, never widens.
3. **Original identity** — the committed row still carries the recorded `nativeFp` (yaw + native parts). A re-cut, moved
   or reshaped row is refused, so the pilot can never be applied to the wrong footprint.
4. **Source binding + cottage typology** — the accepted island profile (`js/waterfront-island-buildings.js`) resolves
   *this* row as `typology === "cottage"` and names the same OSM way `487167567`.

Any failure is a no-op: the helper returns `null` and the caller keeps the native parts.

## Overlap checks (source vs the real committed world)

Run by the builder at build time against the committed geodata; a real conflict fails the build (the other object is
never nudged or deleted to force a fit).

| Checked against | Inside the effective rectangle | Nearest |
| --- | --- | --- |
| Other committed building footprints (drawn parts, separating-axis rectangle intersection) | **0** | nearest other row centre 15.3 m (no overlap) |
| `GEO.streetTrees` (flat `[x, z, model, heightDm]`) | **0** | 8.92 m |
| Accepted island residential-canopy points (`-data.js` rows) | **0** | 85.12 m |

No conflict, so the pilot proceeds. The preliminary "0 intersections / 0 trunks" probe (bead note) is confirmed here
with the corrected `GEO.streetTrees` stride of **4**, not 3.

## Consumers of building footprints (enumerated)

The pilot changes one row's effective parts. Consumers that read footprint geometry city-wide are unaffected far from
the island; the ones near it are:

- **Rendering / collision (captain-owned, `js/buildings.js`)** — the wall boxes, cottage roof/trim and the per-part OBB
  collider (`colliders.push({ …, obb })`) must all read the same effective parts. `main.js` passes those colliders to
  `js/controllers.js` and the camera rig (`js/camera-rig.js`, `js/world-collision.js`).
- **Tree keep-outs** — `js/city-grid.js` `clearOfHouses(x, z)` now resolves the same effective parts and keeps generated park trees 2.5 m clear. Mapped trees remain at their source positions.
- **Yard classification** — `js/city-grid.js` `blockBuilt` and `js/waterfront-island-yard-materials.js` `blockStats`
  read the accepted profile for **height/typology** (not footprint positions), so they are unchanged by the pilot.
- **Line-of-sight** — `js/city-config.js` (`BUILT`/`lineIsClear`, arrival teleports) and `js/surroundings.js` (`tall`)
  retain their existing native centre/radius approximation. They are not the movement or camera collision path; this pilot does not claim exact arrival-route line-of-sight.
- **Others reading parts** — `js/mapped-poles.js`, `js/patio-layout.js`, `js/rail-corridor.js`, `js/york-dundas.js`
  operate on downtown/rail rows, far from this cottage.

For the geometry-sensitive consumers, the helper exposes a **source-guarded** point test so a caller can route
`GEO.buildings` through one function and only the pilot row differs:

```js
// true inside the effective footprint for the pilot cottage, else inside that row's own native parts.
if (window.CITY.islandCottageFootprintAt(row, x, z)) { /* keep out */ }
```

**Reviewed, no physical mismatch at this site.** An independent test (not the builder's own check) scans the committed
geodata and asserts **no** other building part, `GEO.streetTree` or accepted canopy point lies inside the effective
rectangle; the builder already refuses to write otherwise. The physical mismatch that mattered — a walker/camera
passing through the expanded wall while the native collider stands — is closed by the OBB collider now sharing the same
parts (integration regression). The remaining consumers are height/typology readers (yard classification, unaffected) or
downtown/rail systems far from the island (`mapped-poles`, `patio-layout`, `rail-corridor`, `subway`, `city-config`
line-of-sight, `surroundings`). One procedural consumer, `js/street-details.js`'s 4 m building-occupancy for yard trees,
still indexes the native parts; it is safe here (its 4 m cells plus one neighbour already cover most of the added
envelope, and no mapped tree/canopy/building is in it), but a caller wanting belt-and-braces can route it through
`islandCottageFootprintAt`.

## Runtime integration (js/buildings.js + explore.html)

The door/window worker released `js/buildings.js`, so the integration is now in place (surgical; camera/controller
modules untouched):

- `js/buildings.js`, in the `buildCityBlocks` row loop, resolves the effective parts from the **original** committed row
  `b` (so the `nativeFp` identity guard and the accepted-profile lookup still run on the native row):

  ```js
  const partsEff = (cottage && window.CITY.islandCottageFootprintParts?.(b, bi)) || parts;
  ```

- The **same** `partsEff` then drives, for that row only:
  - the cottage eave main-part selection and `islandCottageTrim(...)`,
  - the per-part wall box push (cottage clapboard batch),
  - the per-part cottage gable/hip roof push,
  - the per-part **OBB collider** push (`colliders.push({ …, obb: { cx, cz, hx, hz, cs, sn } })`),
  - the quadtree close-up detail anchor (`partsEff[0]`).
- For every other row `partsEff === parts`, so nothing else changes.
- `explore.html` loads `js/waterfront-island-cottage-footprint-data.js` and `js/waterfront-island-cottage-footprint.js`
  right after `js/waterfront-island-buildings.js` (the source binding this reads), before `buildCityBlocks` runs.

The integration regression (`tests/waterfront-island-cottage-footprint.test.mjs`) builds the real `buildCityBlocks`
twice and asserts the emitted **wall box and OBB collider are the same effective rectangle** (centre, half-extents,
yaw), that both are absent in the native build, and that the old 12.6 × 8 collider is not retained beside the expanded
wall.

## Reproduce

```sh
# build the sidecar (cached source only, or add --way for the live version/timestamp cross-check)
node tools/build-island-cottage-footprint-pilot.mjs --way $WATERFRONT_RESEARCH/way-osmapi.json

# validate without writing
node tools/build-island-cottage-footprint-pilot.mjs --dry-run --json

# the pilot's own tests
node --test tests/waterfront-island-cottage-footprint.test.mjs
```

The builder fails loudly on a missing/malformed input, a guard failure, an overlap, or live/cache geometry drift; it
never writes a partial sidecar. Given the recorded input polygon and projection it reproduces the effective parts
exactly (asserted in the test).

## Integration snippet for the captain (js/buildings.js)

The committed row `b` must still be passed to `islandBuildingProfile` **unchanged** (its `nativeFp` is the guard).
Then use the effective parts everywhere the cottage's footprint is drawn or collided:

```js
const islandProfile = window.CITY.islandBuildingProfile?.(b, bi);
// ... unchanged identity/profile logic ...
const cottage = !!(islandProfile && islandProfile.typology === 'cottage' && !foot && !inDistillery(cx, cz));
// The source-correct effective parts for the pilot cottage, or the native parts for every other row:
const partsEff = (cottage && window.CITY.islandCottageFootprintParts?.(b, bi)) || parts;
// Then, for the cottage and its collider only, read `partsEff` instead of `parts`:
//   - the cottage eave main part (the `let mp = parts[0]` selection),
//   - the per-part wall box push and the cottage roof push,
//   - the per-part OBB collider push (`colliders.push({ …, obb: { cx: x, cz: z, hx, hz, cs, sn } })`).
// The shop-front/detail code that uses `parts` for non-cottage city buildings can stay on `parts`.
```

## Limits

- Geometry comparison of the committed OSM snapshot (ODbL), not a survey; OSM outlines can lag or simplify a building.
- The effective rectangle is an axis-aligned envelope of a near-axis-aligned mapped rectangle; the ~1.9 % envelope and
  0.155 m corner overhang are the measured cost of keeping the row's native yaw.
- No per-house roof/colour/height is claimed: the cached snapshot carries no residential `roof:shape`, `height` or
  `building:material` for this way, so the accepted typology approximations stand.
- Read-only w.r.t. the source: the tool never edits or moves another mapped building or tree.

## Captain visual/physical acceptance — 2026-11-10

Build `cb7879a302d6` passed `wave7-footprint-final` desktop/high/detail and `wave7-footprint-phone-final` 412×915/low, three checks each. Street and aerial images were inspected. The capture checks the actual `Buildings_IslandCottages` instance dimensions against the emitted controller OBB, confirms a contact in the newly expanded region, and confirms that the shared movement/camera broadphase includes that collider. The generated-tree keepout also resolves the effective parts. Earlier phone street viewpoints were obstructed and are not acceptance images.

The final CPU suite passed **1,021 tests, zero failures, three skips (1,024 total)** in `$WATERFRONT_RESEARCH/wave7-pilot-final-full-tests.log`. Exact overlap tests use committed inputs and do not require the research `/tmp` cache. The source generator's manual dry run also found zero building, street-tree or accepted canopy conflicts. These contended captures establish functional/visual behavior, not a performance budget.

The aerial comparison against `wave7-footprint-before-nottawa-source-aerial.png` shows the intended footprint correction. It also exposed three neighboring unprofiled tall buildings; these remain a separate active source audit, **st-sb3r.33**, rather than being hidden or included in this pilot's completion claim.
