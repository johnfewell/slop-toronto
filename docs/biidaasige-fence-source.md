# Biidaasige Park — Dog Fence / Gate: municipal line & area asset check

Bead `st-bmyv.5` (remaining DOG FENCES/GATES source gap). Owner: bounded source worker.
Owned files: **this doc** and `tools/fixtures/biidaasige-fence-source.json` only. Private
caches under `$WATERFRONT_RESEARCH/biidaasige/fence-primary/`. No runtime, amenity, dog-surface,
shared-file, GPU, full-suite, commit or bead-close work. Captain integrates.

## Question

The City Recreation page (2026-09-09) says **both** off-leash areas are fenced with accessible
gates. OSM has the whole OLA boundaries (`dogs-east-1200` way/1418542004, `dogs-west-800`
way/1419966624) but no usable enclosure fence/gate. The 2025 ortho shows pre-opening construction
(turf/apron, no installed fence). This pass asks: **does the City's distinct line/area asset
dataset (not the point layer) carry actual fence lines, gate points, material/height, or a
fenced flag for the Biidaasige OLAs?**

## Answer (short)

**No usable fence/gate geometry was found — but this is an honest negative, not proof of absence.**
The City's line/area asset services were inspected. The area layer confirms both OLAs exist as
polygons but leaves the `FENCED_OR_BOARDED_IND` flag **null**. The fence **line** layer is
demonstrably incomplete (only **24** fences city-wide) and has **no** Biidaasige fence. The gate
**point** layer is well-populated (**4,917** gates city-wide) but has **zero** Biidaasige gates.
No material, height, width or gate geometry is published for the park. **Do not assert the fences
do not exist** — the Recreation page and the first-hand blog assert they do; the asset data simply
does not record them.

## Services inspected

### A. `COTGEO_PFR_PARK_AMENITY` FeatureServer (the point service)
- <https://services3.arcgis.com/b9WvedVPoizGfvfD/arcgis/rest/services/COTGEO_PFR_PARK_AMENITY/FeatureServer>
- Contains **only one layer**: `0 Park Amenity Point` (esriGeometryPoint). **No line or area
  layers.** So the point service is *not* the line/area dataset; the line/area assets live in the
  City mirror below.

### B. City mirror `cot_geospatial13` FeatureServer (line & area layers)
- <https://gis.toronto.ca/arcgis/rest/services/cot_geospatial13/FeatureServer>
- Relevant layers:
  - **25 / 28 / 29 — Infrastructure** (esriGeometryPolyline). `ASSET_TYPE` values: Bridge,
    **Fence**, Pathway, Recreational Trail, Retaining Structure, Stairs. Fields include
    `SURFACE_MATERIAL`, `Shape__Length`.
  - **34 — Outdoor Recreation Area** (esriGeometryPolygon). Fields include
    **`FENCED_OR_BOARDED_IND`**, `PLAYGROUND_SURF_MAT_TYPE`, `LIGHTING_IND`. `ASSET_TYPE` values
    include **Off Leash Area**, **Outdoor Fitness Equipment Area**, Playground, etc.
  - **22 / 52 — Park Amenity** (esriGeometryPoint). `ASSET_TYPE` includes **Gate**.
- No dedicated Fence/Gate layer exists in the other `cot_geospatial*` services (scanned 2, 3,
  10–12, 16–20).

## Findings

### 1. Outdoor Recreation Area (layer 34) — OLAs exist, fenced flag null
Query `ASSET_NAME LIKE '%BIIDAASIGE%'` → **2** polygons:

| Asset | Created | `FENCED_OR_BOARDED_IND` | City polygon area | OSM mapped | Published |
|---|---|---|---|---|---|
| BIIDAASIGE PARK - Off Leash Area (West) | 2026-04-13 | **null** | ~229 m² (30×18 m) | 540 m² | 800 m² |
| BIIDAASIGE PARK - Off Leash Area (East) | 2026-04-24 | **null** | ~492 m² (38×37 m) | 787 m² | 1,200 m² |

- The flag is **null (not populated)**, not "No". It cannot be read as "unfenced".
- **Captain correction:** dedicated orthophoto overlays show that these smaller polygons follow the actual artificial-turf islands. They are useful current turf geometry, not evidence of a generic partial boundary. The OSM rings include the surrounding asphalt apron; neither source publishes the fence line or a gate point. The dog-surface generator now uses the City turf polygons and keeps the OSM outer apron rings separate.
- **No** `Outdoor Fitness Equipment Area` polygon exists at Biidaasige (consistent with the
  separate fitness negative).

### 2. Infrastructure Fence lines (layer 25) — sparse, none at Biidaasige
- `ASSET_TYPE='Fence'` → **24** lines **city-wide** (Wexford, Scarden, Roundhouse, Gerrard–Carlaw,
  Alexandra, Riverdale West, Joyce Trimmer, TRCA, Farlinger Ravine, Treverton, Chatsworth Ravine,
  Linkwood, Charles Sauriol, 45 Dalhousie). This is a **partial/legacy inventory**, not a complete
  park-fence dataset.
- Within the park bbox (43.638,−79.362,43.652,−79.340): **1** fence — `TRCA LANDS (51) - Fence (2)`
  at lat 43.651–43.653, **north of the park**, not the OLA.
- **Zero** Biidaasige fence lines. Because the layer is only 24 city-wide, this absence is **not**
  evidence of no fence.

### 3. Gate points (layers 22 / 52) — well-populated, none at Biidaasige
- `ASSET_TYPE='Gate'` → **4,917** points city-wide (layer 52). The gate inventory is real and
  large.
- Within the park bbox: **8** gates, all `CHERRY BEACH …` / `JENNIFER KATERYNA KOVAL'S'KYJ PARK`.
- **Zero** Biidaasige gates. No gate geometry, material or width is published for the park.

## Honest conclusion

- The City line/area asset dataset **does not** supply usable fence/gate geometry, material,
  height, width or a positive fenced flag for the Biidaasige OLAs.
- **Dataset currency ≠ completeness.** The gate layer is large and current, but the fence line
  layer is a 24-feature legacy subset; absence in either is not proof. The Recreation page and the
  first-hand blog assert the fences and accessible gates exist, so the correct status is
  **"exists per City prose, geometry not in the asset data"** — not "no fence".
- The OLA polygons in layer 34 are a partial footprint; use the OSM rings for the whole boundary.
- **No coordinate, fence line, gate point, material or height is derivable** from these sources.
  Fence/gate placement stays **unplaced** pending a current photo, a construction/as-built record,
  or a populated `FENCED_OR_BOARDED_IND` / fence-line feature.

## What would change the answer

- A populated `FENCED_OR_BOARDED_IND = Yes` on the layer-34 OLA polygons.
- A `Fence` line feature (layer 25) or `Gate` point (layer 52) with `ROLLUP_TO` = BIIDAASIGE PARK.
- A City construction/as-built or capital record with fence spec (material/height) and gate
  locations.
- A current (2026) photo with GPS EXIF showing the installed fence and gate.

None were found in this bounded pass.

## Licence / provenance

City of Toronto open data (ArcGIS feature services). No image pixels ship. Raw query caches remain
private under `$WATERFRONT_RESEARCH/biidaasige/fence-primary/`. Structured record:
`tools/fixtures/biidaasige-fence-source.json`.
