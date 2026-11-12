# Biidaasige Park river access

Tracked in `st-bmyv.7`, with terrain profiles separately tracked in `st-bmyv.11`.

The runtime adds four source-located features. Their footprints or centre lines come from the checked-in OSM extract (base timestamp `2026-11-10T23:24:18Z`).

| Feature | Source | Current representation | Limits |
| --- | --- | --- | --- |
| West Landing | `way/1531061648`, named gravel beach | Source polygon with a pebble material | Flat at the environment datum; no bank survey |
| North beach | `way/1414354037`, gravel beach | Source polygon with a pebble material | Flat at the environment datum; no bank survey |
| East slipway | `way/1414354028`, paving-stone slipway | Source line with an estimated 3 m width | Horizontal; source elevation and exact width unknown |
| Pier near Canoe Cove | `way/1532838053`, pier | Source line with an estimated 2.5 m width | Horizontal; material and width are estimates, not surveyed |

All default surfaces are at `.224 m`, the surrounding environment datum. They are overlays for the current flat terrain. Distance to a water edge does not establish a bank profile. An earlier inferred slope was rejected from the default after the captain reviewed the actual geometry. The experimental `deriveBankSlope` factory option is not an accepted terrain reconstruction.

The 2026 Waterfront Toronto expansion announcement confirms Canoe Cove is open; older City closure text is stale. This does not establish a paddling-course boundary or the footprint of an east launch.

## Source and placement boundaries

`tools/fixtures/biidaasige-river-access.json` preserves the source references, tags, polygon vertices and line vertices. The generator updates only the embedded data block in `js/biidaasige-river-access.js`.

Six `leisure=fishing` nodes identify fishing locations. They do not establish gravel-platform dimensions, so their pads remain candidates outside the default scene. The approximate east Canoe Cove map anchor also remains a candidate; it is not turned into a dock. A point-only slipway without a line or polygon is unplaced. South-marina piers outside the park are excluded.

The module checks the actual decoded water polygons and, when available, the active `city-config.js` water classifier. The park polygon is never treated as a waterline or as evidence that every point inside the park is dry: the park contains river and wetland water. Without the active classifier, no bank height is verified.

## Integration and physical contract

`buildBiidaasigeRiverAccess(scene, colliders, options)` returns the default group, actual rendered triangles, source metadata, candidates and unplaced records. `biidaasigeRiverAccessAt(x,z)` returns a rendered triangle height or `null`. It does not construct geometry during a frame. Traversable surfaces publish no whole-area blocking boxes.

`js/biidaasige-park.js` adds the default group to the park, puts its triangles into the shared 4 m footing index and uses the same surfaces for procedural-tree clearings. The native ground mask (`js/biidaasige-ground-mask.js`) reveals beach polygons through coarse native lawn and paving; separately mapped park paths remain separate meshes. The water pass is retained. The mask is enabled only for successfully built beach sites, composes with existing material masks, and is absent under `?biidaasige=0`.

Long beach polygons are split into meshes whose actual horizontal bounds stay within 120 m. The parent park culling root owns those meshes. Pebble grain reuses resident shoreline noise, with photo-estimated colour and scale; there is no extra collision geometry or downloaded photo texture.

## Verification

```sh
node tools/build-biidaasige-river-access.mjs --check
node --test tests/biidaasige-river-access.test.mjs
node --test tests/biidaasige-runtime.test.mjs
```

The 13 river tests verify default/candidate separation, current water classification, flat default heights, horizontal pier/slipway surfaces, actual upward triangles and independent downward ray hits, bounded meshes, both geographic frames and stale-state reset. Runtime tests assemble the modules against both actual packed geographic databases. Desktop and phone GPU captures run through `gpu2` on the Mac mini; captures establish visual behavior, not an uncontended performance budget.

The bank profile, stepped landings and promontory still require a terrain pass. The current flat overlays do not complete those features.

## Sources and licensing

- [OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright): source geometry and tags.
- [City of Toronto 2026 wayfinding map](https://www.toronto.ca/wp-content/uploads/2026/09/978c-Biidaasige-Park-map.pdf): approximate Canoe Cove neighbourhood anchors; not a dock survey.
- [Waterfront Toronto western expansion](https://www.waterfrontoronto.ca/news/torontos-largest-park-in-a-generation-just-got-bigger): current opening phase.
- [Firsthand bank photographs](https://liangmartin.com/biidaasige-park-highlights-from-torontos-latest-parkland/): captain reviewed rounded pebble/cobble beach appearance. Photographs are private references and do not ship.
