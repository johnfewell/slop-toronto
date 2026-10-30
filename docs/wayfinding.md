# City wayfinding structures

Beads `st-26p.2` and `st-26p.2.1`. The [City inventory](https://open.toronto.ca/dataset/street-furniture-information-pillar-wayfinding-structure/) provides stable IDs, frontage, side, status and the **TO360 / Info Pillar** families. It does not provide surveyed headings, per-site sign widths or artwork. `tools/data/wayfinding-20261028.json` preserves the dated source; `node tools/build-open-data.mjs` filters Existing status and regenerates the independent fingerprinted script. There are 272 local records: 228 TO360 and 44 Info Pillars.

## Supplied narrow TO360 model

John supplied `Meshy_AI_Roncesvalles_Dundas_S_1028124006_texture.glb` and later the original June 25 photo, `/Users/johnfewell/Downloads/PXL_20260625_194137185.MP.jpg` (3072×4080). Both originals are preserved in `~/.cache/slop-toronto/props/wayfinding-pillar/`, with the mesh also in ignored `tools/prop-src/wayfinding-orig.glb`. The cache's `PROVENANCE.json` retains hashes, source paths, panorama metadata and comparisons. May 2026 Street View provided an independent shape reference; Google photography is not shipped in the game.

`tools/blender/bake_props.py wayfinding` rebuilds the source using a foot plate, tapered lower casting and straight upper panels with the source's sloped crown. It creates clean UVs, bakes emission albedo, flattens structural medians, adds soft AO and assigns material properties by face tags. This is a **clean rebuild, not decimation**. `WAYFINDING_FRONT_PHOTO` projects John's original photo onto the planar front, replacing Meshy's distorted lettering and map. The photo bake includes photographed glass reflections; the asset does not claim a relightable scan. Placement overlays replace the place-specific print with local maps at the other City sites.

| | Source | Shipped rebuild |
|---|---:|---:|
| Triangles | 49,812 | 40 |
| Materials | 1 | 1 |
| File size | 9.6 MB | 123,560 bytes |
| Textures | source atlas | 1024 albedo + 128 metallic/roughness, WebP |

Output is `assets/props/wayfinding.glb`, meshopt, SHA256 `8fef63b9712aa62e634a1c25288d1ae5192414834f5b9c912db2b0bbb7148097`. Metres, ground at zero, glTF +Z front. Overall width follows the narrow TO460 family at .460 m. The original photo showed that Meshy's proportions were too broad/short; the revised reference and rebuild are normalized independently in width and height to **.460 × 2.70 m**. Overall height is inferred using the photo proportions and the [City's published 440 × 1500 mm narrow map panel](https://www.toronto.ca/wp-content/uploads/2022/01/95f2-TSWayfinding-Map-Content-Selection-Guidelines.pdf), **not a surveyed overall measurement**. The earlier source-only 2.435 m estimate has been superseded. This representative narrow model does not establish every site's wide/narrow variant; see the [City product guide](https://www.toronto.ca/services-payments/streets-parking-transportation/sidewalk-tours-wayfinding/wayfinding/to360-wayfinding-products/).

Final compressed geometry was decoded without changing its appearance for Blender 4.5, whose importer does not support meshopt. The comparison reference preserves Meshy's geometry with the explicitly corrected proportions and John's projected front photograph; the untouched original remains separate. GPU2 comparisons passed all four views:

| View | Silhouette IoU | Aspect error | Mean / worst ΔE |
|---|---:|---:|---:|
| Front | .987 | 0% | 1.7 / 4.6 |
| Right | .938 | 0% | 8.2 / 15.7 |
| Back | .984 | 0% | 2.5 / 5.9 |
| Quarter | .982 | 0% | 3.4 / 10.2 |

All four panels and the original-photo/model side-by-side were inspected; the photo comparison is shown in the session. Artifacts: `ride-anywhere-geo/review/gpu2/slop-toronto-wayfinding/wayfinding-low/`; photo comparison: `~/.cache/slop-toronto/props/wayfinding-pillar/compare/photo-model.png`.

Rebuild with `WAYFINDING_FRONT_PHOTO=/absolute/path/to/Johns/photo.jpg` and Blender CPU baking, then the installed `gltf-transform webp --quality 90` and `gltf-transform meshopt`. The high-poly source, original photograph and intermediate bakes remain outside Git.

## Information pillar

This is a separate representative model based on the City's dimensioned [2011 InfoToGo modification drawing, attachment 1 page 6](https://www.toronto.ca/legdocs/mmis/2011/pw/bgrd/backgroundfile-39000.pdf), checked against April 2026 Street View. The drawing establishes a 3 m mast, .50 m mast width, 1.34 m overall side wing, 2.044 m wing height and .40 × 1.816 m map panel. The oval ground shoe makes the finished envelope slightly wider. The [2012 report](https://www.toronto.ca/legdocs/mmis/2012/pw/bgrd/backgroundfile-46943.pdf) explains the change from the original curved design to this slimmer design.

`tools/blender/info_pillar.py` builds clean oval mast/foot solids, map inset, elevated side-wing frame and yellow information insignia. `assets/props/info-pillar.glb` is **444 triangles, one vertex-colour material, 7.11 KB**, meshopt. It includes no downloaded advertising artwork; the broad panels remain dark. Fine production details and per-site historical variants are not surveyed. Google reference images and City drawings remain in the local cache, not the game.

## Placement and nearby maps

The first scene accepts **192 TO360** sites and **32 Info Pillars**. TO360 exclusions: 18 road, 3 sidewalk, 15 obstruction. InfoPillar exclusions: 2 road, 6 sidewalk, 4 obstruction. Source records remain available for audit; rejected points are not scattered elsewhere. Named frontage is preferred for heading inference; the InfoPillar's long wing follows the curb. Placement allows at most 1.25 m of correction, checks corners and a 1.2 m clear pedestrian strip, excludes other furniture/shelters/Bike Share and checks full sign height against static obstacles. Player colliders follow the installed body. The known Dundas/Roncesvalles `IP-00839` is accepted; its photographed “You are facing East” legend establishes the front normal toward west, checked before placement clearance; the Blue Jays Way reference site `IP-00062` is excluded by clearance checks rather than forced into place. The info-pillar scene review uses `IP-00020` at College/Spadina.

`js/wayfinding.js` preserves John's photographed front at `IP-00839` and covers the Roncesvalles print everywhere else. That site's reverse face and the other sites use generated maps. A fixed pool supplies maps for the nearest four signs within 40 m: eight front/back slots sharing **one material, one draw and one reusable atlas**. The InfoPillar uses its narrow front map only. Atlas sizes are 1024×1792 desktop and 512×896 low tier. Objects/materials exist from startup and warm below the ground; moving only updates reserved matrices and the same texture. No shader/material replacement or unbounded texture cache occurs while walking. Source geometry remains stable when map detail changes.

Each nearby face displays its frontage, heads-up local/context maps from the actual game roads/parks/water, a correctly scaled distance bar, rotated north indicator and source position marker. Labels are laid out after road strokes with overlap rejection. Signs do not take the ride/boarding interaction key; the existing map controls remain available. `CITY.wayfindingStats`, `CITY.infoPillarStats` and `CITY.wayfindingMapStats` expose source IDs, family-specific exclusions and pool activity.

## Checks

Targeted import, placement, asset-budget, map-pool, search, boot and cache tests: **28/28 pass**, including touch-panel ownership and actual phone Directions-button activation. Production build passes. Run `gpu2 slop-toronto-open-data -- node tools/check-open-data.mjs` for desktop and explicit low-tier 412×915 phone checks. Inspected street views include the TO360 map, a separate InfoPillar front/quarter view, benches and facility cards. The static capture harness retains its known `/live/vehicles` 404; the optional test-only `CAPTURE_CDN_CACHE=1` transport cache fetches the exact immutable Three.js import-map URLs, logs their byte hashes and avoids intermittent mini CDN network-change failures without changing the renderer. The final desktop/phone run has no page exceptions. Captures ran alongside production transcription and establish function/appearance, not performance budgets.
