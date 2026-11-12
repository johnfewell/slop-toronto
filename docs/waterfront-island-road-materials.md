# Toronto Islands: source-backed Oneida and Ojibway lane surface materials

Bead **st-sb3r.25**. This pass changes the **material only** of the two photographed Algonquin Island living streets. The
committed city ground (`js/city-grid.js`, mesh `StreetLevel`) already draws the true road plane at `y = 0` with the one
shared `createRoadSurfaceMaterial()` asphalt. That asphalt is correct for the asphalt lanes (Cibola, Third Street,
Lakeshore, etc.) but wrong for Oneida and Ojibway, whose primary photographs show concrete pavers and concrete slabs. This
module repaints the fragment shading inside those two mapped runs and leaves every other road byte-for-byte native.

Owned files: `js/waterfront-island-road-materials.js`, `tests/waterfront-island-road-materials.test.mjs` and this doc.
The capture shot list `tools/shots/waterfront-island-road-material-review.json` is captain-authored and is not modified here. No other module is edited. `js/city-grid.js`, `js/waterfront-island-
lanes.js`, their data/generator/tests, controllers/main/cameras/city-config/explore and `js/tsl-materials.js` are untouched.
The captain wires the exported hook into the existing StreetLevel material producer and adds the loader entry.

## 1. What the sources say (and what they do not)

The two primary photographs are the ones already recorded in `ISLAND_LANES_DATA.summary.sourceProfile.photographs`:

| Photo | Mapped row | OSM way | Commons file page |
| --- | --- | --- | --- |
| Oneida Avenue 2026 | Oneida Avenue (`living_street`) | 13541126 | https://commons.wikimedia.org/wiki/File:Oneida_Avenue_on_Algonquin_Island,_Toronto_2026.jpg |
| Ojibway Avenue 2026 | Ojibway Avenue (`living_street`) | 13541122 | https://commons.wikimedia.org/wiki/File:CN_Tower_visible_from_Ojibway_Avenue,_Algonquin_Island,_Toronto_2026.jpg |

The captain's **visual observations** (paraphrased here, not quotes) are:

- **Oneida**: dark-neutral-grey concrete rectangular pavers, approximately 2:1, in a clear 90-degree herringbone; a narrow
  flush path with garden edges. Not red clay, not running bond.
- **Ojibway**: a weathered light-neutral-grey concrete slab path with a longitudinal central joint and transverse slab
  joints; no asphalt speckle, no road lane paint, flush planted edges.

**Honest limits.** The paver size (~0.20 x 0.10 m) and slab size (~1.5 m to the central joint x 2.8 m along) are
**typology approximations, not measurements**. The lane width stays the native 6.4 m OSM living-street approximation. The
exact source-to-lane transition near the shore is not surveyed and is not painted. The grey tones are **approximate
neutral-grey choices, not sampled from the photographs**. The observations are paraphrases of the captain's visual review,
not sourced quotations.

## 2. Scope: only the two mapped runs

Only **Oneida Avenue (run 42, way 13541126)** and **Ojibway Avenue (run 41, way 13541122)** are claimed. A run is one actual
OSM way, never a concatenation across water. Unknown/service/Cibola roads and the Algonquin Bridge Road wood surface stay
native/unresolved. Mainland and the airport are excluded because the data has no run there and the mask is bounded to the
two Algonquin rows.

The two ways share endpoints with other mapped rows (Ojibway begins on Algonquin Bridge Road and ends on Seneca Avenue;
Oneida begins on Omaha Avenue and ends on Seneca/Dacotah). A plain distance tube would paint ~4 m of those other lanes'
carriageway, so the mask **excludes a point whenever another mapped island lane is inside its own half-width there and is
at least as close to its own centre line**. On a genuine Oneida/Ojibway cross-section no other row's centre line is that
close, so this removes exactly the junction wedges and nothing else. The shared vertices are therefore `null`; the lane
interiors stay Oneida/Ojibway.

## 3. The material hook

`js/waterfront-island-road-materials.js` exports:

```js
window.CITY.applyIslandLaneRoadMaterial(material) // -> the same material, composed
```

The captain calls it on the existing StreetLevel asphalt material after that material is created (the same place the
other waterfront ground hooks are applied). It:

- is **idempotent** (a second call is a no-op);
- is a **no-op** on a non-node material, when `CITY.TSL` is absent, when `ISLAND_LANES_DATA` is missing, or when the active
  frame/projection does not cover the two runs;
- composes the lane colour, roughness and normal over the material's existing `colorNode` / `roughnessNode` /
  `normalNode` with `mix(native, lane, coverage)`, so the native asphalt's wet film, patches and SSR metalness remain
  outside the lanes;
- never adds geometry, never moves the road plane, never changes routing, width, colliders or road paint.

There is **no builder and no cover quad**. The earlier rejected overlay approach is not reintroduced.

## 4. The bounded georeferenced mask

At build time (CPU, once) the module rasterizes a small mask over the tight bounding box of the two runs plus a 4.5 m guard
(the lane half-width 3.2 m + a 0.5 m anti-alias edge + margin, so the lane is fully inside the texture and the border
texels are 0). It is **not** a per-pixel loop over all city edges: it walks only the two runs' segments for each texel in
the small box.

One texture:

- `maskTex`: `RGBA Float32`, `NearestFilter`. `R = s` (the **unwrapped** along distance in metres over the full lane
  length), `G = t` (metres across, signed), `B = coverage` (0..1, anti-aliased), `A = signed lane id`
  (0.5 off, 1.0 Oneida, 0.0 Ojibway).

**Why NearestFilter plus a manual bilinear.** WebGPU float32 texture filtering is an **optional** feature
(`float32-filterable`), not present on every phone, so the module never asks the sampler to filter a Float32 texture. The
shader instead does an explicit manual bilinear with four `textureLoad` (nearest) fetches weighted by the fractional
coordinate. This needs no optional feature and is correct on the phone tier.

**Why `s` is unwrapped.** The pattern wants `s` modulo the 2.8 m period, but storing the value already reduced would make
the bilinear interpolate *backwards* across every wrap (2.8 -> 0), producing a wrong reverse-interpolated band at each
period. So `s` is stored unwrapped over the full bounded lane length (the lane is ~211-216 m, well inside Float32
precision), and the pattern applies modulo only **after** interpolation.

The actual generated dimensions and bytes are reported by `CITY.islandRoadMaterialLayout().texture` (currently
**331 x 383 texels, 2,028,368 bytes** for the detail frame; the Eglinton frame shares the same projection and the same
box). The mask is bounded and small; it is not a whole-city raster.

**Lane-local coordinates.** Each texel stores `s` and `t` from `laneFrameAt(run, x, z)`: the point is projected onto the
run's centre-line polyline, `s` is the distance along the way from its first vertex, and `t` is the signed perpendicular
distance (positive on the left of the direction of travel). The shader runs the paver/slab pattern in `(s, t)`, so the
pattern is aligned to the **actual mapped lane direction**, not to world X/Z. This is tested with a synthetic 30-degree
rotated segment and with the real diagonal Oneida way.

**Padded edge coordinates.** Every texel in the box gets a real `(s, t)` frame from the nearest run (coverage is 0 outside
the lane), so the bilinear interpolation near the lane edge is not distorted by zeroed coordinates.

**Anti-aliased edge.** `coverage = clamp((halfWidth + edge - d) / edge, 0, 1)` with `edge = 0.5 m`, so the lane fades
smoothly into the native asphalt instead of stepping at a texel. The outer 1-texel border is forced to **coverage 0 and
id off** (both channels, not just the id), so a clamp-to-edge sample outside the bounds is always off. The shader blends
with the float coverage, never a bool.

**CPU/GPU parity claim.** `CITY.islandRoadMaskSample(x, z)` bilinearly interpolates the *same* Float32 values the shader's
manual bilinear interpolates, so it is a meaningful parity check, not a nearest-texel approximation.

## 5. The patterns

### Oneida: exact perpendicular 2:1 herringbone

The pattern is the captain's exact domino tiling, in units of paver width `w = 0.10 m`:

```
cx = floor(u/w), cy = floor(v/w), phase = positiveModulo(cx - cy, 4)
phase 0/1: horizontal brick, start = (cx - phase, cy), local = (fract(u/w) + phase, fract(v/w)), dims (2, 1)
phase 2/3: vertical brick,   start = (cx, cy - (phase === 2 ? 1 : 0)),
                             local = (fract(u/w), fract(v/w) + (phase === 2 ? 1 : 0)), dims (1, 2)
```

This partitions the integer grid into alternating perpendicular 2:1 rectangles with diagonal staircase joints. The CPU
`islandRoadHerringboneAt(u, v)` and the TSL shader are the same maths. The tests prove both orientations, the 2:1
dimensions, no double/gap cell coverage, and the diagonal staircase (not a running bond, not a grid). The joint distance is
the distance to the nearest brick edge; the brick id is the brick's start cell and orientation, so both halves of a brick
share one tone.

### Ojibway: slabs with a central longitudinal joint

The central longitudinal joint is at `t = 0` (the mapped lane centre line), not a global world-X modulo. Transverse joints
are at `s = k * 2.8 m`. The slab tone varies per slab; the central joint is the darkest line (the photo's most legible
cue). The tests prove the central joint is at `t = 0` and the transverse joints are at the slab period.

### Detail fade

Fine joint detail fades with the pixel footprint (`fwidth(positionWorld.xz)`) so it cannot alias at grazing angles or from
the air. The large-scale weathering mottle is also faded. The base colour is blended by the anti-aliased coverage, so the
lane edge does not step.

## 6. TSL types

Comparisons produce bool nodes, so the lane id choice uses `select()` and the coverage blend uses `mix()` with the float
coverage. A bool is never fed to `mix`. The graph is built with the vendored `three/tsl` and is exercised in the test suite
with the real node system (not only a stub). Graph construction does not evaluate every deferred shader function; actual GPU rendering is required.

**Absent-channel fallback (no off-mask changes).** The hook always mixes each channel against the material's **real native
default**: its own `colorNode` / `roughnessNode` / `normalNode` when present, otherwise the engine's `materialColor` /
`materialRoughness` / `materialNormal`. A material that never set an optional channel therefore stays native wherever the
coverage is 0; the lane is never applied to the whole city. A regression test builds a bare `MeshStandardNodeMaterial`
with no channels and asserts the composed graph references the native defaults.

**Float32 filtering.** The mask is Float32 and `NearestFilter`; the shader does a manual bilinear with `textureLoad`, so no
optional `float32-filterable` feature is required. **Only an actual GPU compile can prove the final shader**; the captain
runs that.

## 7. Verification

```sh
node --test tests/waterfront-island-road-materials.test.mjs
```

The focused suite (16 tests) proves: the two source runs bind to the correct per-way OSM ways and only those two are
claimed; the CPU mask hits Oneida/Ojibway with lane-local `s`/`t` and is null on the mainland, airport, Cibola and every
other island lane; the shared endpoints are excluded; detail and Eglinton both resolve while a wrong projection or absent
frame is a no-op; the Oneida pattern is the exact perpendicular 2:1 domino tiling (both orientations, 2:1 dims, no
double/gap, diagonal staircase); the Ojibway central joint is at `t = 0`; the lane-local frame follows a rotated segment;
the coverage is anti-aliased on a manual-bilinear mask and zero outside the bounds; a node material without original channels stays native off-mask; the actual texture dimensions/bytes are reported; both palettes
are approximate neutral greys with no clay red and the provenance does not claim sampled colours; the hook is a no-op
without TSL, on a non-node material, without the source data, and is idempotent; and the material graph builds with the
**real** `three/tsl` node system.

No full suite, laptop GPU, commit or deploy was run in this task.

## 8. Runtime integration and visual acceptance

The module is loaded after the island-lane data/helper in `explore.html`. The actual StreetLevel material receives
`CITY.applyIslandLaneRoadMaterial(streetMat)` in `js/city-grid.js`; no cover geometry is added.

Captain GPU review repaired deferred vector-return and lane-ID selection errors, replaced an unavailable normal helper
with the project's local derivative-based normal formulation, and made the weathering noise local instead of silently
falling back to a constant. `wave6-surface-final` desktop/high passed five checks on build **e64e2cbd562f**: Oneida and
Ojibway street/close views plus proof that the actual scene material has the bounded source layer. The captain inspected
the rendered herringbone, slab joints, lighting and source photographs. `wave6-surface-phone` also passed all five checks at 412×915/low; the captain inspected the portrait Oneida paving view.

The integrated full suite passed **969 tests, zero failures and three skips (972 total)**; the final shader adjustment
also passed all **16 focused material tests**. These functional captures do not establish a shared-host performance budget.

## 9. Deliberately not done / honest limits

- **Material only.** No cover quad, no raised geometry, no routing/width/collider change, no road-paint change. The true
  road plane is unchanged.
- **Only the two source runs change.** Every other lane, including the unphotographed service lanes and the Algonquin
  Bridge Road wood surface, stays native/unresolved.
- **Typology, not survey.** Paver and slab sizes are approximations; the lane width is the native OSM approximation; the
  shoreline transition is unresolved.
- **Approximate tones.** The greys are hand-picked neutral greys, not sampled from the photographs.
- **The mask is bounded and small.** It is not a whole-city raster and does not loop over all city edges per pixel.
- **Procedural approximation.** Photographed paving types and mapped lane identities are grounded in evidence; exact aggregate, wear and colour are not scanned materials.
