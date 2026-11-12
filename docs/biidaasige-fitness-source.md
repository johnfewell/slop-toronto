# Biidaasige Park — Outdoor Fitness Equipment: primary municipal source check

Bead `st-bmyv.5` (remaining FITNESS location source gap). Owner: bounded source worker.
Owned files: **this doc** and `tools/fixtures/biidaasige-fitness-source.json` only. Private
caches under `$WATERFRONT_RESEARCH/biidaasige/fitness-primary/`. No runtime, shared-file,
commit, GPU or bead-close work. Captain integrates and personally views any image.

## Question

The City Recreation page (modified 2026-09-09) says *"Fitness equipment is available west of
Cableway Canyon."* Prior passes found **zero** OSM `leisure=fitness_station` / `sport=fitness` /
`leisure=fitness_equipment` in the park bbox, and no fitness label was found in the extracted 2026 wayfinding text.
This pass asks the next bounded question: **does the City's own current asset/geodata inventory
contain an outdoor fitness equipment record for Biidaasige Park, with a point or footprint?**

## Answer (short)

**No.** The City of Toronto's current, actively-maintained **Park Amenity Point** asset layer
contains **493** `Outdoor Fitness Equipment` records city-wide — including **33 created in 2026**
(newest: Grand Avenue Park 2026-09-25, Brookdale Park 2026-09-14) — and **zero** at Biidaasige
Park. The park has **45** amenity rows in that same layer (benches, picnic tables, drinking
fountains), created 2026-04-28 and last modified 2026-05-19, but **no fitness row**. The City
Open Data "Parks and Recreation Facilities" dataset (refreshed 2026-11-01) likewise lists
Biidaasige Park with amenities *"Dog Off-Leash Area, Playground, Washroom"* and **no Fitness
Equipment**. An independent UofT outdoor-fitness study layer has **zero** points within 3 km.

The Recreation page remains affirmative evidence of existence; a firsthand July 2025 article also mentions an outdoor fitness centre, although its six photographs do not depict machines. No per-unit municipal or OSM point was found in this pass. Fitness remains
**UNPLACED**. No coordinate, footprint or machine count can be derived from these sources.

## Sources checked (all current, all primary or independent)

### 1. City Open Data — Parks and Recreation Facilities (CKAN)
- Dataset: <https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/parks-and-recreation-facilities>
- Datastore dump queried: `…/datastore/dump/e8cd0f4d-4910-42a0-81f9-cf8c2218753a`
- `metadata_modified` **2026-11-03**, `last_refreshed` **2026-11-01**, refresh rate **Monthly**.
- Licence: open data (City of Toronto Open Data Licence).
- **Biidaasige Park row** (`_id` 1056, `ASSET_ID` 988832, `LOCATIONID` 3853):
  `ASSET_NAME = BIIDAASIGE PARK`, `TYPE = Park`, `ADDRESS = 51 COMMISSIONERS ST`,
  `AMENITIES = "Dog Off-Leash Area, Playground, Washroom"`, geometry
  `Point [-79.3556437988402, 43.6434987638808]` (park-level point, not equipment).
- **No "Fitness Equipment"** in the Biidaasige amenity string. City-wide, **101** park rows do
  carry the `Fitness Equipment` amenity value — so the field is populated and meaningful; it is
  simply absent for Biidaasige.

### 2. City of Toronto — Park Amenity Point (official ArcGIS feature layer)
- AGOL service: <https://services3.arcgis.com/b9WvedVPoizGfvfD/arcgis/rest/services/COTGEO_PFR_PARK_AMENITY/FeatureServer/0>
- City mirror: `https://gis.toronto.ca/arcgis/rest/services/cot_geospatial13/FeatureServer/20`
  (Park Amenity Point) and `/52` (PFR Park Amenity) — same schema/asset IDs.
- Service description explicitly lists **"Outdoor Fitness Equipment"** among small-footprint
  amenities. Fields include `ASSET_TYPE`, `ASSET_NAME`, `ASSETCATEGORY_DESC`, `CREATION_DATE`,
  `LASTMODIFIED_DATE`, `ASSET_ID`.
- **Positive control:** `ASSET_TYPE LIKE '%Fitness%'` → **493** rows city-wide, each a real
  per-unit point (e.g. `SALLY BIRD PARK - Outdoor Fitness Equipment (2)`,
  `JULIUS DEUTSCH PARK - Outdoor Fitness Equipment (5)`).
- **Currency control:** **33** fitness rows have `CREATION_DATE >= 2026-01-01`; newest
  `GRAND AVENUE PARK - Outdoor Fitness Equipment` created **2026-09-25**. The layer is actively
  updated with new installations. This establishes dataset currency, but does not prove complete registration of every Biidaasige asset.
- **Biidaasige query:** `ASSET_NAME LIKE 'BIIDAASIGE%'` → **45** rows, all Bench / Picnic Table /
  Drinking Fountain (e.g. `BIIDAASIGE PARK - Bench (16)`, `… - Picnic Table (8)`,
  `… - Drinking Water Source (Badlands)`), created **2026-04-28**, modified **2026-05-19**.
  **Zero** rows with `ASSET_TYPE`/`ASSETCATEGORY_DESC` containing Fitness.
- **Proximity query:** 1500 m around park centroid (43.6435, −79.3556) → 1046 amenity rows,
  **zero** fitness/exercise.
- **Name query:** fitness rows matching `BIIDAASIGE|PORT LANDS|VILLIERS|CHERRY|SHIP CHANNEL|DON`
  → only `DONALDA PARK` / `KENNEDY - MARGDON` (substring false positives). **No Port Lands /
  Biidaasige fitness record under any naming variant.**

### 3. Independent UofT study — Outdoor Fitness Equipment in Toronto
- Service: <https://services1.arcgis.com/9NvE8jKNWWlDGsUJ/arcgis/rest/services/JS_Senior_Accessibility_to_Outdoor_Fitness_Equipment_in_Toronto_WFL1/FeatureServer/0>
- 95 fitness points city-wide; **zero** within 3 km of the park. Independent corroboration of
  the City negative.

### 4. City Recreation page (existence + direction only)
- `https://www.toronto.ca/explore-enjoy/parks-recreation/places-spaces/beaches-gardens-attractions/biidaasige-park/`
  (captain cache `captain/recreation-current.html`, *Date modified: September 9, 2026*).
- Under **Outdoor Fitness Equipment**: *"Fitness equipment is available west of Cableway Canyon."*
  No point, no count, no machine list, no vendor.

### 5. Local design / wayfinding / map text (no fitness)
- `inventory/design-2023.txt`, `inventory/wayfinding.txt`, `inventory/map-2025.txt`,
  `inventory/page1-words.tsv`: **no** `fitness|exercise|gym|workout` match. The extracted 2026 wayfinding
  text has no fitness label (consistent with the registration fixture's `outdoor-fitness`
  `status: unplaced`).

### 6. Press (no fitness)
- CP24 (2026-07-27), toronto.com, Waterfront Toronto news page: **no** fitness/exercise mention.

## What this means for placement

- The Recreation page and the firsthand July 2025 article assert that equipment exists. The City gives a direction ("west of Cableway Canyon"), not a per-unit location.
- The City's own asset system — which *does* record new 2026 fitness installations elsewhere —
  has **no** Biidaasige fitness record. Plausible explanations, none proven: (a) equipment not
  yet installed at inventory time; (b) installed but not yet asset-registered; (c) the page is
  forward-looking/aspirational. **Do not pick one.**
- **No coordinate, footprint, machine count or vendor is derivable.** Fitness stays `unplaced`.
  A captain ortho/map estimate is the only remaining option, and it would be an estimate, not a
  source point.

## What would change the answer

- A City Park Amenity Point row for Biidaasige with `ASSET_TYPE = Outdoor Fitness Equipment`
  (would give an exact per-unit point).
- A City capital/procurement record naming a fitness vendor and installation date for the park.
- A current photo with GPS EXIF showing the machines.
- A vendor case study (Earthscape / WholeTrees / etc.) naming Biidaasige with a plan or photo.

None of these were found in this bounded pass.

## Licence / provenance

All City Open Data and ArcGIS layers are City of Toronto open data. OSM (prior pass) is ODbL.
No image pixels ship. Raw query caches remain private under
`$WATERFRONT_RESEARCH/biidaasige/fitness-primary/`. Structured record:
`tools/fixtures/biidaasige-fitness-source.json`.
