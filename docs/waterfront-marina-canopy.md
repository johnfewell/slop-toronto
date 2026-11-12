# QCYC marina canopy (st-sb3r.36)

The accepted low QCYC service sheds (st-sb3r.33/.34) stand in the mapped Queen City Yacht Club marina, but the surrounding
ground rendered as implausibly bare lawn. The primary **2024 City of Toronto orthophoto** and the **QCYC 2019 renovation
photos** show mature canopy around the sheds. This pass adds the City of Toronto's own mapped **Tree Point** coordinates
that fall **inside the OSM QCYC marina polygon** (Way 193043084), as a scope distinct from the accepted Oneida/Ojibway
residential corridor. It is a source-mapped canopy, not a blanket scatter.

## Scope

- **Only** the OSM `leisure=marina` polygon **Way 193043084** (Queen City Yacht Club), read from
  `tools/data/island-outliers.json`'s `marinaWay` / the current OSM marina query. A point outside that polygon is never
  claimed.
- The **accepted 33 Oneida/Ojibway residential sites are unchanged** (same rows, same gates, same result). The marina
  scope is a separate `marina` block in the same data file and a separate runtime API.
- No other island block, mainland, airport or park is touched.

## Source

- **City of Toronto topographic Tree Point** layer, `cot_geospatial3/FeatureServer/10` (Open Government Licence –
  Toronto; catalogue `open.toronto.ca/dataset/topographic-mapping-physical-location-of-trees/`).
- Fields used: `OBJECTID`, `DERIVED_HEIGHT` (m), `ELEVATION` (m AMSL), `DERIVED_OWNER`, `LAST_GEOMETRY_MAINT`.
- **No species and no crown width** are in the source; every site is a generic mature deciduous (the EZ ash model family),
  and the crown radius is a documented generic estimate, never a measured width.
- **Dates:** the layer's `LAST_GEOMETRY_MAINT` for these points is **2021** (maintenance date, **not** an acquisition
  date). The orthophoto is **2024**; the gallery is **2019**. These are different vintages and are not claimed as a
  current survey.

### Why a second bounded query

The captain's saved Algonquin cache (`city-tree-algonquin.json`, bbox `-79.362,43.626,-79.356,43.630`) does **not** cover
the marina's north portion (the marina ring reaches lat 43.630436 and lon -79.357214). A single bounded official query
with the marina ring's own bbox (`-79.3597,43.6283,-79.3567,43.6309`) supplies the missing points. The builder reads the
**union** of the cached and marina sources, keyed by `OBJECTID`:

- a point present in both is counted once;
- if the same `OBJECTID` has **different coordinates** in the two files, the build **fails** rather than silently taking
  the first (a real data conflict);
- the marina source is validated for an ArcGIS `error`, `exceededTransferLimit`, `spatialReference.wkid === 4326`, a
  point geometry type, and the required fields;
- the marina polygon's every vertex is checked to lie inside the query bbox, so a future refetch cannot silently miss a
  lobe.

## Gates (a candidate stands only if all pass; rejected points are never moved)

1. **Inside the OSM marina polygon** (Way 193043084).
2. **In the built detail frame** and **not water** (the committed water polygons).
3. **Height** `DERIVED_HEIGHT` within `[4.5, 34]` m — a conservative inclusion band, not a botanical test.
4. **Effective building footprint:** the trunk is not inside a rendered building's **native** parts *or* the bounded
   pilot cottage's **effective** rectangle (`islandCottageFootprintAt`), with a `1.2 m` marina pad. This keeps trunks off
   the rendered structures only. It does **not** keep the crane/rail/boat-rack zone clear: those surfaces have **no
   mapped geometry**, so the buffer cannot stand in for them (the rail/rack clearance is a visual captain-review matter,
   not a source claim).
5. **Pavement:** the trunk is not on any mapped island lane's paved strip (the same exact segment test and representative
   widths as the residential scope, plus a `0.4 m` trunk clearance). Launch rails / crane apron / boat racks have no
   mapped lane row, so the accepted trunks' real clearance to the nearest **mapped** pavement is recorded
   (`marina.clearance.minPavedM`, currently 4.34 m); that is a distance to mapped pavement, not a claim about unmapped
   rails or racks.
6. **Street dedupe:** not within `3.5 m` of an existing City street tree (the mapped inventory wins).

## Result

- **18** marina sites placed from **581** union source points (557 outside the marina polygon, 3 on a building, 3 on
  mapped pavement, 0 water/height/street-tree). Heights 4.92–30.69 m (median 26.85 m).
- Recorded clearance: nearest mapped pavement **4.34 m**, nearest building edge **1.35 m** (provenance, not a move).
- The 33 residential sites are byte-for-byte unchanged.

## Runtime

`js/waterfront-island-residential-canopy.js` gains a distinct `islandMarinaCanopySites(existingSites, residentialSites)`
API (the residential `islandResidentialCanopySites` is unchanged). Both scopes:

- dedupe against the **same** preserved mapped trees (City inventory, lidar crowns, named sites);
- dedupe against **each other**, so a tree in both scopes is drawn once;
- only remove generic generated scatter where a source candidate is **actually accepted** (the existing
  `islandResidentialCanopyReconcile` runs on the combined accepted list).

`js/ez-trees.js` calls both scopes and feeds the combined list into the existing EZ instanced LOD field — no new
pipeline, no per-tree mesh, same culling/shadows. Absent data or a mismatched frame is a no-op.

## Committed source fixture and manual full audit

`tools/data/island-marina-canopy-source.json` is the portable primary fixture: all **24** City Tree Points inside the
QCYC polygon (the 18 accepted + 3 building rejects + 3 pavement rejects) plus **one outside control**, with unchanged
source attributes/coordinates, the genuine source SHA-256 hashes, the CRS (wkid 4326), the field schema and the OSM
marina ring. The identity/gate/clearance tests read only this committed fixture — no `/tmp` cache, no network, no skips.

The full-union rebuild (581 points across both source files) is a **manual, cache-backed audit**, not part of the
default suite:

```sh
node tools/build-island-residential-canopy.mjs --source /path/to/city-tree-algonquin.json --marina-source /path/to/city-tree-marina-qcyc.json --marina-rings /path/to/m.json --check   # reads the /tmp source caches; documents the 581-union numbers
```

## Verification

```sh
node --test tests/waterfront-marina-canopy.test.mjs
node --test tests/waterfront-island-residential-canopy.test.mjs
```

The marina suite proves: the data names the City layer, the OSM marina polygon and no species; every site is a real
source point (OBJECTID + DERIVED_HEIGHT), unmoved, inside the marina polygon; no accepted trunk is on a mapped paved
strip; the gates reconcile to the source count and re-running the builder reproduces the committed file; the API dedupes
against preserved mapped trees and the residential scope; a mismatched frame/absent data is a no-op; every site is a
valid generic EZ-Tree site. The residential suite (13 tests) still passes with the 33 sites unchanged.

## Remaining limitations (honest)

- **Source points, not surveyed trunks.** The City layer is a topographic tree point; positions are rounded to 0.1 m and
  heights are `DERIVED_HEIGHT`. The 2021 maintenance date is not an acquisition date.
- **Generic, not species.** No species or crown width is in the source; the model family and crown radius are generic
  deciduous estimates.
- **No understory, no invented planting.** Only mapped points inside the marina polygon are added; no shrubs, flowerbeds
  or extra trees are invented.
- **Pavement/rail coverage.** Launch rails and the crane apron have no mapped lane row; the pavement gate rejects mapped
  lanes/paths, and the recorded clearance documents the real spacing. A trunk near an unmapped rail is not claimed to be
  clear of it.
- **Imagery vintages differ** (orthophoto 2024, gallery 2019, tree maintenance 2021); current conditions are not
  re-surveyed here.

No dev-server restart, GPU run, commit or deploy was performed by the implementation model; the captain owns the matched
desktop/phone captures and the managed full-suite log.

## Captain acceptance, 2026-11-10

Desktop `wave7-marina-canopy-final` and phone `wave7-marina-canopy-phone` each passed seven captures/runtime checks, exit 0. Matched close views were inspected: mature canopy and shadows surround the low service shed, with visible trunks off the launch rails and path in these views. Runtime checks prove 51 unique source identities (33 residential + 18 marina) at unchanged source positions/heights. This visual review does not establish survey clearance for every unmapped apron.

Managed full suite: **1,056 pass, 0 fail, 3 skip / 1,059 total** (`$WATERFRONT_RESEARCH/wave7-marina-canopy-full-tests.log`). After replacing external-cache-dependent tests with the committed primary fixture, focused canopy suites passed **20/20, no skips**. No performance budget is claimed from these contended GPU captures. User devserver remained untouched.
