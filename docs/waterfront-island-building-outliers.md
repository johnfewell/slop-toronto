# Toronto Islands: reviewed marina tower outliers (st-sb3r.33)

Actual GPU wave-7 aerial review of the Toronto Islands exposed **three tall generic white towers** beside the Nottawa
Avenue / Ward's Island cottages. Decoded against the committed geodata, they are rows **32501, 32502, 32503** at
`1234.4, 2166.2` (h 31.9), `1212.0, 2181.4` (h 28.7) and `1215.2, 2191.0` (h 28.5), all `islandBuildingProfile === null`.
This pass corrects exactly those three rows from current OpenStreetMap data, the City 3D Massing 2025 attributes and the
captain's review of the official 2024 City orthophoto. It is a **bounded, reviewed list**, not a general heuristic.

## Why the source match missed them

The OSM/cottage matcher in `tools/build-island-buildings.mjs` is deliberately strict (mutual nearest, 6 m, size ratio,
overlap). For these rows it could not produce a confirmed low-rise profile:

- **32501** has one OSM footprint, **Way 795796083**, but it is a bare `building=yes`. It sits *outside* every mapped
  `landuse=residential` block and has no service name/amenity, so `classify()` correctly returns `null` ("skip rather
  than guess"). The committed sidecar binds it to `osm:way/795796083`, but the OSM-only path has no type to classify.
- **32502 / 32503** have **no OSM building footprint at all** (`buildingOsm` is empty). There is nothing to match, so they
  stayed at the inherited native height. An absent OSM footprint is *not* "no structure" — it only means the OSM mapper
  has not drawn one.

All three are inside the mapped **Queen City Yacht Club marina** polygon (OSM Way 193043084). Their native heights come
straight from the City 3D Massing 2025 record `MAX_HEIGHT`, which is a **LiDAR maximum** over the footprint.

## Source evidence

| Row | City record (`to-3dmassing-2025:`) | MAX / AVG / MIN (m) | OSM footprint | Native h / kind |
| --- | --- | --- | --- | --- |
| 32501 | 354314 | **31.9 / 3.3 / 16.1** | Way 795796083 (`building=yes`) | 31.9 / 2 |
| 32502 | 354315 | **28.7 / 2.8 / 9.8** | none | 28.7 / 2 |
| 32503 | 354316 | **28.5 / 2.9 / 0.4** | none | 28.5 / 2 |

- **City 3D Massing 2025** (Open Government Licence – Toronto), edition `3DMassingShapefile_2025_WGS84`, fields
  `MAX_HEIGHT / AVG_HEIGHT / MIN_HEIGHT / SURF_ELEV / HEIGHT_SRC=Lidar-Derived`. The MAX is ~4–10× the AVG on all three.
- **OpenStreetMap** current data (ODbL), OSM base timestamp 2026-11-10; `leisure=marina` Way 193043084 covers the site.
- **Official 2024 City orthophoto** (8 cm, horizontal accuracy 0.16 m, acquisition 26 Apr–30 May 2024), reviewed by the
  captain (the implementation model is text-only and does not inspect pixels):
  - **32501** is a small **low dark-grey rectangular pitched-roof marina building** beside grouped dinghies — clearly not
    a tower. The OSM `building=yes` is best read as a marina service structure, **not a cottage**.
  - **32502 / 32503** are two adjacent **pale, ground-level-looking pads** under leafless canopy, beside boat-storage
    racks. The captain saw no tall building there but could not confidently distinguish concrete pads from low flat
    structures from the image alone.

**Canopy explanation is an inference, not an established City classification.** The MAX ≫ AVG pattern plus a low AVG is
consistent with tall LiDAR returns from tree canopy over a low structure, and the orthophoto corroborates that reading
for *these three rows only*. The City massing metadata is illustrative, not a survey; the imagery is from 2024 and the
massing edition from 2025.

## The bounded correction

`tools/build-island-buildings.mjs` hard-codes a **`REVIEWED_MARINA_OUTLIERS`** map keyed by these three row indices. It is
never derived from a general rule, so no other marina row, cottage, civic building or explicit-height record is touched.

For a reviewed row the builder emits a low **`service`** rendering profile:

- `height: 4.0` m (`EST.service`) with `heightSource: "conservative island estimate"` — an explicit **estimate**, not the
  City `AVG_HEIGHT` and not a measurement.
- `kind: 1` (low-rise), `roof: null` (**keep the native roof**; OSM gives no `roof:shape`), `typology: "service"` (never
  the cottage material). Category `service (reviewed marina low structure, st-sb3r.33)`.
- Footprint, collider and `GEO` are **not changed**. There is no demolition and no construction date claimed.

### Re-checked binding (why a rebuilt row cannot inherit it)

`reviewedMarinaOutlier()` re-validates the review against the committed data before applying, and returns `null` on any
drift:

1. the massing **edition** is `3DMassingShapefile_2025_WGS84`;
2. the sidecar massing id equals the reviewed `to-3dmassing-2025:35431x`;
3. the row centre is inside marina Way 193043084;
4. the sidecar `buildingOsm` string equals the reviewed value (`osm:way/795796083` for 32501, `''` for 32502/32503 —
   **both sides are strings**, so no number/string mismatch);
5. the committed **footprint signature** (`yaw + part rectangles`) equals the reviewed `nativeFp`;
6. the **native height** equals the reviewed value;
7. the City record's own `MAX/AVG/MIN` match the reviewed values (±0.15 m).

The runtime (`js/waterfront-island-buildings.js`) additionally refuses a record whose `massing.edition` is not the
reviewed edition (`massingEditionMatches`) and, as always, refuses a reshaped footprint at the same centre
(`footprintMatches`).

`rowMassing()` returns the record's polygons as an **array**, and a `<fid>.<k>` that names a part the record no longer
has is rejected (`null`) rather than silently falling back to part 0.

### Provenance (two source streams, kept separate)

- **32501** stays in the OSM-attributed `records` array: it names `osm:way/795796083` and also carries `massing` and
  `marina` blocks.
- **32502 / 32503** live in a separate **`massingRecords`** array: `osm: null`, the City `massing` record and the marina
  way. No OSM way is fabricated for them.

The runtime lookup indexes both arrays; the profile exposes `osm` (`null` for City-only rows), `massing` and `marina`,
each copied out so callers cannot mutate the committed data.

## Reproducibility

The reviewed source values are archived in `tools/data/island-outliers.json` (trimmed copies of the captain-local
primary caches, with their SHA-256 hashes, OSM base timestamps and the massing edition). No test reads
`/tmp`, `~/.cache` or the network; the fixture test proves the committed data matches these archived values.

Rebuilding the data file (needs network or explicit cached inputs):

```sh
node tools/build-island-buildings.mjs \
  --buildings b.json --airport a.json --residential r.json --marina m.json
```

`--marina` defaults to an Overpass `way["leisure"="marina"]` query. The massing attributes are read from
`$GEO_DATA/massing.json` (or `~/.cache/slop-toronto/osm-ids/massing.json`), the output of `tools/fetch-massing.mjs`; when
it is absent the City-only rows (32502/32503) cannot be identified and are simply omitted (the OSM-only 32501 is still
corrected if its binding matches).

## Verification

```sh
node --test tests/waterfront-island-building-outliers.test.mjs
node --test tests/waterfront-island-buildings.test.mjs   # existing island suite, unchanged
npm test                                                 # full suite
```

The focused suite proves: the three rows resolve to a 4 m `service` profile with the native roof kept and no cottage
material; the committed data matches the archived fixture; a different massing edition, a reshaped footprint, a moved
centre or a mismatched OSM binding disables the override; the curated list does not leak to any other row; explicit OSM
height still wins on ordinary rows; the airport/mainland stay `null`; the same rows resolve in the Eglinton frame; and the
renderer/collider path uses `islandBuildingProfile(...).height`.

## Known limits (recorded honestly)

- **Inference, not a survey.** The canopy reading is an inference corroborated by the 2024 orthophoto for these three
  rows; it is not an established City classification. The massing metadata is illustrative.
- **32502 / 32503 function and roof are uncertain.** They may be low flat structures or pads; the model cannot tell from
  the image. No roof geometry, demolition or construction date is asserted. Both keep the native (flat) roof.
- **32501 is a marina service building, not a cottage.** Its bare `building=yes` inside the marina does not establish a
  service use for *other* buildings; a residential/civic tag or an explicit OSM height/levels still wins wherever present.
- **Estimate height.** 4.0 m is a labelled conservative estimate, not the City `AVG_HEIGHT` (3.3/2.8/2.9 m) and not a
  measurement.
- **No blanket rule.** Only these three reviewed rows are corrected. Other high marina rows, the mainland, the airport
  and the lighthouse are outside this scope and unchanged.
- **Imagery age.** The review uses 2024 imagery; the massing edition is 2025. Current conditions are not re-surveyed here.

The captain owns GPU captures, integration and tracker updates; no GPU, dev server, commit or deploy was run in this pass.

## Captain acceptance of the height correction

The captain independently compared all original 331 OSM records before/after: none changed. Exactly OSM way795796083 and two separately attributed City-only rows were added. Focused existing cottage/footprint tests passed29/29. The full suite passed **1,032 tests, zero failures, three skips (1,035 total)** in `$WATERFRONT_RESEARCH/wave7-outlier-full-tests.log`; final build `eeac13b4ce63`.

`wave7-outlier-review` desktop/high/detail and `wave7-outlier-phone` 412×915/low completed four Mac mini shots/checks each. Actual controller OBBs at all three source footprints have the corrected low total height. Street/aerial images were inspected against the prior `wave7-footprint-final` / `wave7-footprint-phone-final` captures: the unsupported towers are gone. These are functional/visual checks, not qualified performance measurements.

This accepts the bounded **height** correction, not the generic brick facades. **st-sb3r.34 remains active**: primary QCYC club gallery photographs show white paneled timber, navy doors/shutters and low service-building forms. The current visitor page identifies locker blocks south of the dinghy shed. Appearance refinements will remain photo-informed approximations where individual faces/counts cannot be verified.
