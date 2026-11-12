# Biidaasige dog surfaces (source correction)

Bead: `st-bmyv.5.1`. Runtime: `js/biidaasige-dog-surfaces.js`. Fixture:
`tools/fixtures/biidaasige-dog-turf-city.json` (primary geometry) and
`tools/fixtures/biidaasige-dog-turf-ortho.json` (independent visual check). Generator:
`tools/build-biidaasige-dog-surfaces.mjs`. Test: `tests/biidaasige-dog-surfaces.test.mjs`.

## What was wrong

The two dog off-leash areas are published as **1,200 m² (east)** and **800 m² (west)**. Those
are whole nominal dog-area sizes. Current OSM `dog_park` rings include the surrounding asphalt
apron, and the earlier runtime painted the whole OSM ring as turf. The Captain's dedicated 2025
City 8 cm ortho exports show the actual artificial turf is a smaller island inside the pale curb.

## What this module builds

For each area (`dogs-east-1200`, `dogs-west-800`):

- **Outer boundary** — the exact current verified OSM ring from
  `C.biidaasigeParkRingWorld(id)`. It is never expanded, rounded or replaced by a rectangle.
- **Asphalt underlay** — the whole OSM ring triangulated concave-safely with
  `THREE.ShapeUtils.triangulateShape`, at the `.224 m` ground datum. Matte dark grey
  (sRGB ≈ .15), no bright natural-grass noise.
- **Turf finish** — the current City Outdoor Recreation Area asset ring, independently overlaid on the aerial image by the captain and identified as the turf island, projected through
  `C.worldFromLatLon`, triangulated, then clipped to the OSM outer ring with a dependency-free
  Sutherland–Hodgman pass against the outer triangles. It sits at `.228 m` (`.004 m` above the
  asphalt), so the layers are physically plausible and never coplanar. Muted dark grey-green,
  matching K9 artificial turf.

The initial captain trace was superseded by the City asset geometry after a second source review. Layer 34 contains `ASSET_ID 989013` (east, `OBJECTID 1965`) and `ASSET_ID 989014` (west, `OBJECTID 3273`), created April 2026 and modified May 2026. The polygons closely match the actual turf edges in the 2025 orthophotos. Their smaller size is not evidence of an arbitrary partial footprint: it reflects turf rather than the surrounding apron. The generator preserves every published vertex and source identity, then the runtime clips only registration differences against the OSM outer ring. A conservative 3 m interpretation allowance is retained; the City does not publish survey accuracy here.

The module reports clipped and raw turf areas, visible asphalt apron area, full asphalt underlay area and source IDs separately. Published nominal whole-area dimensions remain separate.

No fence, gate, rectangle, centre point or whole-area turf is invented. `colliders` is `[]`:
both areas stay traversable and there is no interior blocking box.

## API

```js
const out = CITY.buildBiidaasigeDogSurfaces(scene, opts);
// { group, colliders: [], surfaces, sites, stats }

CITY.biidaasigeDogSurfaceAt(x, z, opts);
// { onSurface: true, kind: 'turf'|'asphalt', siteId, surfaceY } | null
// opts.kind restricts the layer; otherwise the actual highest eligible height is returned.
```

`surfaces` carries the real rendered world triangles (`{ triangle: [9], kind, siteId }`).
`CITY.biidaasigeDogSurfaceAt` answers from those triangles only; it never builds geometry,
clamps the player or applies a player height. On an invalid rebuild the published record is
replaced, so no stale answer survives. Missing projection or missing OSM rings returns an empty
group with `stats.reason` and a `null` query.

## Metadata

Each site reports:

| field | meaning |
| --- | --- |
| `nominalWholeAreaM2` | published whole dog-area size (1,200 / 800) |
| `outerAreaM2` | actual OSM enclosure area |
| `actualAsphaltAreaM2` | visible asphalt apron area (outer minus turf) |
| `actualTurfAreaM2` | clipped turf area |
| `rawTurfAreaM2` | unclipped City turf asset polygon area |
| `turfVerticesOutside` | traced vertices outside the OSM ring |
| `maxTurfVertexOutsideM` | worst outside distance |
| `traceUncertaintyM` | 3 m registration uncertainty |
| `traceToleranceM` | 0.5 m trace tolerance |
| `groundY` / `turfY` / `turfLiftM` | .224 / .228 / .004 |
| `spanM` | largest OSM bbox span (each area < 100 m) |

## Bounds and draw calls

Each area is two merged meshes (asphalt + turf), two materials, so both areas are four draw
calls total. Each area is under 100 m across.

## Generator

```sh
node tools/build-biidaasige-dog-surfaces.mjs          # rewrite the DATA block
node tools/build-biidaasige-dog-surfaces.mjs --check  # exit 1 if stale
```

The generator reads only the checked-in fixture and the module; it has no `/tmp` or network
dependency. It copies the turf rings verbatim and keeps the 3 m uncertainty and 0.5 m trace
tolerance.

## Sources

- City of Toronto 2025 orthophoto (8 cm), `cot_ortho_2025_color_8cm` MapServer, dedicated
  full-resolution exports inspected by the Captain on 2026-11-11.
- Current OpenStreetMap dog-area rings (`way/1418542004`, `way/1419966624`), ODbL 1.0.
- City of Toronto recreation page for the published 1,200 / 800 m² whole-area sizes.

The 2025 imagery is construction-stage and shows no fence or gate, so none is placed.

The primary asset layer is https://gis.toronto.ca/arcgis/rest/services/cot_geospatial13/FeatureServer/34. The checked-in response records source attributes and WGS84 rings. The earlier photo trace remains as an independent validation source, not the runtime geometry.

## Accepted runtime correction

Build `b3980a23a616` was personally reviewed in matched overhead desktop and portrait captures (`dog-clearance-desktop-dog-west-overhead.png` / `dog-clearance-phone-dog-west-overhead.png`) on the Mac mini through `gpu2`. The shared CityGround mask removes its unsourced sidewalk/forecourt overlay only inside successful dog outer footprints. The independent source park paths remain. One exact stale street-tree row inside verified turf is excluded after aerial review: `(2180.9,679.9)`, model 6, height 104 dm; neighboring inventory trees remain. The source identity and active-frame guard are tested.

The full suite passed **1,318 total / 1,315 passed / 0 failed / 3 existing skips** after these changes. These captures verify functional appearance, not an uncontended performance budget. Fence and gate geometry remains unplaced pending current evidence.
