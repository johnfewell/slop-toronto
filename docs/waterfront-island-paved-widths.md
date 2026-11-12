# Toronto Islands: source-informed paved widths for Oneida and Ojibway

Bead **st-sb3r.27**. This pass narrows the **visible paved strip** of the two photographed Algonquin Island living streets
to a representative, source-informed width and turns the former asphalt outside that strip (but inside the original
bounded lane mask) into **grass shoulders on the same physical `StreetLevel` plane**. It is a material/visual refinement,
not a geometry, routing or City-footprint change.

Owned files: `js/waterfront-island-road-materials.js`, `tests/waterfront-island-road-materials.test.mjs`, this doc and the
small source receipt `data/waterfront/island-paved-widths.json`. No other module, data, camera, controller, city-grid,
lane helper, explore loader, global material or the existing width-audit doc/script is edited.

## 1. Source evidence

The captain fetched the official City of Toronto **Topographic Mapping – Edge of Road** polygons:

- Feature service: <https://gis.toronto.ca/arcgis/rest/services/cot_geospatial3/FeatureServer/3> (the layer is named
  "Road Line" but its `geometryType` is `esriGeometryPolygon`).
- Catalogue: <https://open.toronto.ca/dataset/topographic-mapping-edge-of-road/> under the Open Government Licence – Toronto.
- Geometry maintenance date: **2021-01-01**. This is **not** a current survey-grade guarantee.

Perpendicular cross-sections through the mapped OSM ways, intersected with the Road Edge polygons (EPSG:3857 lengths
scaled by `cos(lat)` to ground metres), give:

| Lane | OSM way | Road Edge object | Samples | Range (m) | Median (m) |
| --- | --- | --- | --- | --- | --- |
| Oneida Avenue | 13541126 | 24202 | 19 nearby | 2.885 – 3.648 | 3.29 |
| Ojibway Avenue | 13541122 | 53745 | 22 nearby | 2.866 – 4.206 | 3.492 |

The native source module's **6.4 m** is the OSM `living_street` class default, not a measured width. The actual binary
geodata road rows/blocks may differ; changing a GEO width would not by itself change the built blocks. The captain also
viewed the official 2024 leaf-off orthophoto and the 2026 ground photographs, which are consistent with narrower paved
paths.

## 2. Decision

Implement a bounded **representative visual paved width** of **3.3 m (Oneida)** and **3.5 m (Ojibway)**, centred on the
existing OSM lane frame. This is honest source-informed typology, **not** an exact City Road Edge footprint relocation.
The OSM alignment drift remains documented and unresolved. The existing physical `StreetLevel` plane at ground `y = 0`
stays; grass shoulders on that same plane replace the former asphalt outside the new paved strip, inside the original
bounded lane mask **and** a slightly broader bounded cleanup envelope (6.0 m half) that removes the residual asphalt
ribbon where the real visible corridor is wider than the 6.4 m OSM gate. There are no new quads, no floating geometry, no
routing/metadata width/collider/ground-height changes, and the existing ramps remain the accepted physical source.

This supersedes the earlier material doc's statement that the lane width stays the native 6.4 m **for the visible paved
strip only**. The native metadata width is still 6.4 m and is deliberately not changed.

## 3. Implementation

The module keeps the same bounded Float32 mask and the same `applyIslandLaneRoadMaterial(material)` hook. The mask channels
are unchanged in meaning:

- `R = s` — unwrapped along distance (m).
- `G = t` — signed across distance (m).
- `B = outer corridor coverage` — the original native-half-width gate with a 0.5 m anti-aliased edge.
- `A = signed lane id` — 0.5 off, 1.0 Oneida, 0.0 Ojibway.

A **second** Float32 RGBA texture (`grassTex`) carries the bounded **grass cleanup envelope** coverage in its red channel.
Two textures are used because Float32 RGBA is the portable float layout (RGBA16F/`RGBAFormat` with `FloatType` needs no
optional `float32-filterable` feature), and the envelope is a distinct coverage from the strict corridor. The mask is
**337 × 390 texels, 2,102,880 bytes each, 4,205,760 bytes total** (RGBA Float32, `NearestFilter` + manual bilinear).

**The inner paved edge is analytic, not baked into the coarse mask.** After the shader (and the CPU sampler) bilinearly
interpolates the continuous lane-local `t`, the representative paved cover is

```
pavement = clamp(0.5 + (pavedHalf - abs(t)) / 0.12, 0, 1) * strictOuterCorridor
```

with `pavedHalf = 1.65 m` (Oneida) or `1.75 m` (Ojibway). The 0.5-coverage contour is therefore exactly the representative
half-width, so the visible width is sub-texel faithful and does **not** depend on the 0.6 m mask texel size. This avoids
rasterizing a 0.12 m edge into 0.6 m pixels (which would blur/vary the width) and avoids a ~0.2 m / ~18 MB mask. The paved
strip is always clamped to the strict corridor, so the grass envelope never widens it.

The composition is:

1. native surface → grass shoulder by the **grass cover** `max(strict corridor, bounded cleanup envelope)`;
2. grass shoulder → pavers/slabs by the analytic paved cover (`pavement <= strict corridor <= grass cover`, so the strip
   always wins where it exists);
3. native metalness → 0, native road AO → 1 and native road emissive → 0 across the shoulder and strip (grass and concrete
   are dielectric and are lit like the adjacent lawn, not the asphalt); off-mask they are the untouched native defaults.

**Bounded grass cleanup envelope (rendering envelope, not a lane width).** The actual visible corridor at some points is
the union of the City's offset pavement and the OSM connector, broader than the 6.4 m source gate, so a bare 3.2 m half
left a residual asphalt ribbon outside the old mask. A bounded **6.0 m half-width + 0.5 m edge** cleanup envelope (grass
only) removes that leftover asphalt. It is **not** a measured lane width and **not** an expansion of the claimed paved
area: `islandRoadLaneAt` keeps its strict native half-width semantics, and the 3.3/3.5 m paved strip is unchanged. The
envelope is gated by the same junction/other-lane exclusion (a wider slack) so it cannot bleed onto another lane, the
mainland, the airport, Cibola or the Algonquin Bridge Road surface.

The grass shoulder follows the **native plot lawn palette** (`mix(0x4f7a2c, 0x6f8a38)`, the same colours
`createPlotGroundMaterial` uses) through the shared `CITY.seasonalGrass` helper, with only subtle local value-noise
variation, so it does not read as a dark ribbon against the adjacent bright yards. It does not reuse
`createPlotGroundMaterial` wholesale (which carries random concrete patches), and it does not fake a brighter green to
compensate for the inherited road lighting: the inherited road canyon AO and wet-film emissive are removed locally on the
grass cover instead, which is the actual cause of the dark ribbon. The lane normal and the grass normal both use the
module's local derivative-based bump helper; the global material module does not export its `bumpNormal`/`noise2D`, so the
module keeps its own (the captain's accepted fix).

All existing exclusions are preserved: only Oneida and Ojibway are claimed; the shared fishbone junctions, every other
island lane, the mainland, the airport, Cibola and the Algonquin Bridge Road wood surface stay native. A missing source
data set, a wrong projection or an off-frame page is a strict no-op. The native channels are always the mix base, so an
absent optional channel stays native off-mask.

## 4. Verification

```sh
node --test tests/waterfront-island-road-materials.test.mjs
```

The focused suite (21 tests) proves, on the pure CPU side and with the real `three/tsl` node system:

- the two source runs bind to the correct per-way OSM ways and only those two are claimed;
- the CPU mask hits Oneida/Ojibway and is null on the mainland, airport, Cibola and every other island lane;
- the shared endpoints are excluded;
- the visible paved strip measures **3.300 m** (Oneida) and **3.500 m** (Ojibway) at every clear segment station, centred
  on the mapped lane frame (0.000 m centre offset), strictly narrower than the native 6.4 m corridor;
- grass shoulders exist between the strip and the outer corridor (`corridor > 0.95`, `pavement = 0`, `shoulder > 0.9`);
- a real lateral **4.5 m** point at a clear station is covered by the grass cleanup envelope (`grass > 0.5`) while the
  strict corridor and pavement are **0** (the regression for the `min(half, grassHalf)` bug), and the envelope is bounded
  (native beyond ~6.5 m);
- `s` stays unwrapped and continuous along each run;
- the mask coverage is anti-aliased at the outer edge and zero outside its bounds; the actual texture dimensions/bytes
  (including the two-texture total) and the grass-inside count are reported;
- the hook is a no-op without TSL, on a non-node material, without the source data, and is idempotent;
- the material graph builds with the real `three/tsl` node system, including the metalness, AO and emissive channels and
  the absent-channel native fallbacks.

No full suite, laptop GPU, commit or deploy was run in this task. The captain runs the high/phone GPU captures and the
ground checks.

## 5. Deliberately not done / honest limits

- **Representative width, not a City footprint.** The 3.3/3.5 m strips are centred on the existing OSM frame. The City
  Road Edge polygons are offset from the OSM centre line in places (up to ~3.5 m near the SE end of Oneida), and that
  alignment drift is **not** resolved here.
- **No routing/width/collider/ground-height change.** The native metadata width stays 6.4 m; the physical plane stays at
  `y = 0`; the accepted ramps are unchanged. This is a visible material refinement only.
- **No new geometry.** Grass shoulders are shading on the existing `StreetLevel` plane, not cover quads or raised ground.
- **The grass envelope is not a lane width.** The 6.0 m cleanup envelope is a rendering bound that removes leftover
  asphalt where the real visible corridor exceeds the OSM gate; it does not widen the claimed paved area, routing or
  metadata. It is gated by the same junction/other-lane exclusion as the strict corridor.
- **Bounded road-lighting removal, not colour correction.** The inherited road canyon AO and wet-film emissive are removed
  locally on the grass cover only (AO → 1, emissive → 0), which is why the shoulder no longer reads as a dark ribbon. The
  grass colour itself is the native plot lawn palette; it is not brightened to hide a lighting mismatch.
- **Source age.** The Road Edge geometry is maintained to 2021-01-01, not a current survey. The widths are source-informed
  typology, not a survey measurement.
- **Not photorealism.** The paving typology, tones and grass are procedural approximations; exact aggregate, wear, colour
  and the shoreline transition are not scanned or surveyed.
- **Provenance audit.** The accepted source audit is recorded in [waterfront-island-width-audit.md](waterfront-island-width-audit.md).

## Accepted integration

Build `b575672e854d` passed `wave7-canopy-lighting` desktop/high/detail (seven checks) and `wave7-canopy-phone` 412×915/low (six checks). The captain inspected Oneida and Ojibway views: the leftover asphalt and inherited road-AO stripe are removed. Desktop verified 189 actual StreetLevel raycasts against all three movement modes, maximum error 1.49e-13 m. The full integrated suite passed 987 tests, zero failures and three skips (990 total). This establishes bounded visual/functional behavior, not a performance budget or surveyed alignment.
