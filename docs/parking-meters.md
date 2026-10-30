# Parking pay stations

Implemented in the `feat/parking-meters` worktree, tracked by `st-26p.17` and asset
subtask `st-26p.17.1`.

## Model

John supplied `Meshy_AI_Graffiti_Parking_Mete_1028124634_texture.glb` and four photos
from `Downloads/Photos-1-001` (`PXL_20261027_132130871.MP.jpg`, `132139520`,
`132134977` and `132126126`). He specified six feet overall, including the solar
hood: **1.8288 m**. Width/depth follow the supplied source; these are not surveyed
manufacturer dimensions.

The street-prop-pipeline rebuild uses straight cabinet panels, bevels, a tapered
support and inclined solar hood, clean packed UVs, selected-to-active emission
baking, light AO and tagged roughness/metallic. It does not decimate the source.
Photo comparison caught the source's incorrect solar orientation; the high-poly
bake reference and rebuild both correct the assembly by 90 degrees. The original
GLB is preserved. The front cabinet is projected from John's photo to replace
Meshy's invented front logo and payment-panel detail.

- Original: 127,460 triangles, 9,826,328 bytes.
- Rebuild: 128 triangles, one opaque material, 1024-pixel albedo and 128-pixel MR.
- Delivery: WebP and meshopt GLB, about 48 KB; ground origin, glTF +Z front.
- The remaining side graffiti/stickers retain the source bake. Their artwork is
  decorative and does not dynamically print each site's payment-zone number.

Originals, photos, Street View references, bake products and `PROVENANCE.json`
remain outside Git at `~/.cache/slop-toronto/props/parking-meter/`; working copies
are in the ignored `tools/prop-src/`. Street View imagery was from 2023 and is
historical context; John's October 2026 photos define the current appearance.

Rebuild with Blender and the supplied original/photo:

```sh
PARKING_METER_FRONT_PHOTO=/path/to/PXL_20261027_132130871.MP.jpg \
  /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 \
  --python tools/blender/bake_props.py -- parking-meter /path/to/original.glb \
  tools/prop-src/parking-meter-low.glb /path/to/work
npx --no-install gltf-transform webp tools/prop-src/parking-meter-low.glb tools/prop-src/parking-meter-webp.glb
npx --no-install gltf-transform meshopt tools/prop-src/parking-meter-webp.glb assets/props/parking-meter.glb
```

## Location source and limits

The CKAN Green P dataset describes parking lots. This implementation instead uses
TPA's public [2026 On-Street Machines Update](https://www.arcgis.com/home/item.html?id=723d820cbadb44958803713d3cb9652a),
published by `tsimpson_GreenP` in the verified **Toronto Parking Authority** ArcGIS
organization `UM5d08UVAsJVg3zk`. The S5 install and DG4 decommission point layers
have machine identifiers, addresses, payment-zone IDs and rollout phases. They
are not a complete live operational inventory. The source data's last edit was
2026-06-17; it was fetched on 2026-10-28. No operational status is inferred from a
phase number. These points represent the matching S5 cabinet, not single-space
meters or every older DG4 machine.

The committed snapshot retains source URLs and dates. Its item licence field is
empty; it is not relabelled as an OGL CKAN dataset. The importer refuses incomplete
downloads or invalid coordinates, quarantines conflicting duplicate IDs, excludes
decommission matches and clips to the exact current city projection/detail bounds.
It keeps physical hardware IDs separate from shared payment-zone IDs. The known
`5019-1022` point at **460 Roncesvalles / zone 5008** matches John's photos.

The snapshot has 1,021 S5 rows. Six rows have three conflicting reused machine IDs,
one row matches a decommission record, and 238 are outside the detailed map. The
result is **776** candidate points. The runtime accepts **669**: 10 road/deck
rejections, 37 sidewalk rejections and 60 obstructions in the tested city. It can
step at most 1.25 m away from the road to account for simplified curbs; it rejects
unsafe points instead of moving them arbitrarily. It checks the cabinet corners,
other street furniture, shelter clearances, Bike Share and building/landmark
colliders. Placement and inferred road-facing orientation are approximate; only
representative sites have been visually checked.

The layer uses the existing instanced prop/culling pipeline and bounded light
system. Cabinets add player colliders. There is no payment or parking-rule UI.
Regenerate the separate layer without rebuilding all geodata:

```sh
node tools/build-parking-meters.mjs
node --test tests/parking-meters.test.mjs tests/site-cache.test.mjs tests/boot.test.cjs
```

## Verification

Mac mini Metal captures cover front/right/back/three-quarter comparisons against
the explicitly solar-corrected high-poly reference, plus daytime, night transition
and downtown placement on desktop and 412×915 touch. The photographed Roncesvalles
point is asserted directly. All four comparison silhouettes exceed 0.93 IoU and
aspect errors stay below 3%; mean colour delta E stays below 10, worst below 20.
The front texture intentionally follows the real photo rather than Meshy's logo.

The eight focused data/placement/cache/boot tests and the production build pass.
No page, shader or WebGPU validation errors were reported in the city captures.
Captures ran alongside transcription and do not establish a performance budget.
Results are in `ride-anywhere-geo/review/gpu2/slop-toronto-parking-meters/`.

```sh
GPU2_LOCK_WAIT=60 gpu2 slop-toronto-parking-meters -- env CAPTURE_QUERY='?quality=high&autoscale=0&transit=timetable&film' CAPTURE_TAG=desktop node tools/capture.mjs tools/shots/parking-meters.json
GPU2_LOCK_WAIT=60 gpu2 slop-toronto-parking-meters -- env CAPTURE_QUERY='?quality=low&autoscale=0&transit=timetable&film' CAPTURE_VIEWPORT=412x915 CAPTURE_MOBILE=1 CAPTURE_TAG=phone node tools/capture.mjs tools/shots/parking-meters.json
```
