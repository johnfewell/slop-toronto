# Toronto Islands: Oneida / Ojibway lane-width audit (evidence + correction seam)

Bead **st-sb3r.26**. This is an **evidence-first audit and correction plan**, not an implementation. No runtime, geodata,
data, loader, camera or test file is edited here. Owned files: this doc and the read-only audit tool
`tools/audit-island-widths.mjs`. The captain owns the tracker, GPU, images and any coordinated implementation.

The question: the accepted Oneida/Ojibway paving (`js/waterfront-island-road-materials.js`) is gated to OSM ways
**13541126** and **13541122**, which inherit the default **6.4 m** width; the source photographs show a narrow,
pedestrian-scale lane. Where does that width come from, and can a real footprint be measured?

## Findings

- **6.4 m is not mapped evidence.** The current OSM ways carry **no `width` and no `surface` tag** (verified from the live
  API and the captain's saved responses). 6.4 m is a **class default** (`wSource: "estimate from living_street class"`).
- The **actual runtime road-network width is 7.4 m**, not 6.4 m: `GEO.roads` for both ways is `living_street → lanes 2 ×
  3.5 m + 0.4 m kerb` (decoded from `data/toronto-geodata.bin`). The 6.4 m is a *second*, independent default used only by
  the paint gate and the paving mask.
- A **real, authoritative footprint exists**: the City of Toronto *Topographic Mapping – Edge of Roadway* polygons. The
  lane polygons are **Oneida OBJECTID 24202** and **Ojibway OBJECTID 53745**, both ~**3.2–3.5 m** wide. This is
  reproducible from the **local cached build input** `~/.cache/slop-toronto/raw/edge-of-roadway-4326.gpkg` (not in the
  repo; the repo's `tools/fetch-roadway.mjs` reads that same cache).
- The **visible asphalt width** is set by the generated curb islands, not by either default: measured on the runtime
  binary it is **~5.7 m (Oneida)** and **~4.0 m (Ojibway)** — Oneida is ~2.4 m wider than its City footprint, Ojibway
  ~0.5 m wider.
- **Alignment is unresolved.** The OSM centre line is offset from the City polygon (it runs along a polygon edge, and the
  captain found points up to ~3.5 m outside it near Oneida's SE end). Relocating to the exact City footprint is a larger
  geometry reconciliation; a bounded **representative width centred on the existing OSM line** is the safe first step and
  must be labelled as such.

## 1. The two width origins (source audit)

| Producer | Value for Oneida/Ojibway | Where | Used by |
| --- | --- | --- | --- |
| `tools/geo-roads.mjs` (`CLASS.living_street = [0,1,2,0.4]`, `LANE_W = 3.5`) | **7.4 m** = `lanes(2) × 3.5 + kerb(0.4)` | baked into `GEO.roads` (`js/toronto-geodata.js`, `data/toronto-geodata.bin`) | `js/road-network.js` lanes, `js/road-paint.js` placement, `js/city-config.js` labels/maps, parking |
| `tools/build-island-lanes.mjs` (`laneWidth()` living_street default) | **6.4 m**, `wSource: "estimate from living_street class"` | `ISLAND_LANES_DATA.runs[41/42].w` (`js/waterfront-island-lanes-data.js`) | `js/waterfront-island-lanes.js` paint gate; `js/waterfront-island-road-materials.js` **paving mask half-width `w/2 = 3.2 m`** |

Neither is a measurement. The generator comment already states OSM carries no width on these ways
(`tools/build-island-lanes.mjs:191`).

**Visible width is a third thing.** The street level is a single full-city asphalt plane at `y = 0`
(`js/city-grid.js:944-951`, `StreetLevel`). The visible lane width is the **gap between the raised curb islands**, which
`tools/geo-blocks.mjs` rasterises from the **union of the City Edge-of-Roadway polygons and a 2 m-radius OSM connector**
(`tools/geo-blocks.mjs`, `CONNECTOR = 2.0`). Where the OSM centre line is offset from the City polygon the union is
wider than the City footprint.

## 2. OSM: no width evidence

Live API (`https://api.openstreetmap.org/api/0.6/way/<id>/full.json`), saved to
`$WATERFRONT_RESEARCH/width-audit/osm-13541126.json` and `…/osm-13541122.json`:

- `way/13541126` Oneida Avenue, v6, 2025-05-31T00:37:53Z — `highway=living_street`, `motor_vehicle=private`, `name` — **no
  width, no surface**.
- `way/13541122` Ojibway Avenue, v8, 2025-05-31T00:37:53Z — same tag set — **no width, no surface**.

`motor_vehicle=private` is a legal-access tag, not a dimension. It is not width evidence.

## 3. Authoritative source: City Edge of Roadway polygons

Catalogue: <https://open.toronto.ca/dataset/topographic-mapping-edge-of-road/>. Live layer (ArcGIS, **geometryType
Polygon**, despite the layer name "Road Line"): <https://gis.toronto.ca/arcgis/rest/services/cot_geospatial3/FeatureServer/3>.
The same dataset is the repo's roadway source (`tools/fetch-roadway.mjs` →
`~/.cache/slop-toronto/raw/edge-of-roadway-4326.gpkg`, a local cache input not in the repo); the island features carry the
**same OBJECTIDs and geometry** in the live layer and the cache, so the measurement is reproducible.

`SUBTYPE_DESC` values are `Road Edge` (1014), `Intersection` (1030), `Road Bridge`. `LAST_GEOMETRY_MAINT` is
**2021-01-01** for these features — this records a maintenance date, **not** a verified acquisition date or a 2024 survey.

The lane polygons (Road Edge, one per way):

| Way | OBJECTID | Cross-section, captain `measure-near.py` | Cross-section, `tools/audit-island-widths.mjs` | Area/perimeter width | Length |
| --- | --- | --- | --- | --- | --- |
| Oneida 13541126 | **24202** | 19 samples 2.885–3.648 m, median **3.29 m** | inside-polygon 8 samples 2.85–3.65 m, median **3.30 m** | 622.1 m² / 389.8 m → **3.19 m** | ~191 m |
| Ojibway 13541122 | **53745** | 22 samples 2.866–4.206 m, median **3.49 m** | inside-polygon 17 samples 3.00–4.25 m, median **3.45 m** | 632.1 m² / 371.7 m → **3.40 m** | ~182 m |

Two cross-section samplings and the area/perimeter approximation agree to
~0.1 m: **the City lane is ~3.2–3.5 m wide**, roughly **half** the runtime 7.4 m and the mask's 6.4 m.
`node tools/audit-island-widths.mjs` reproduces the audit numbers and validates the OBJECTID binding ([OK] `24202` /
`53745`).

Raw files: `$WATERFRONT_RESEARCH/width-audit/city-roadline-algonquin.json` (29 island features),
`city-roadline-layer.json` (metadata), `city-roadline-query.txt` (exact query), `road-edge-crosssections.json`,
`road-edge-near-crosssections.json`.

**Alignment caveat (do not ignore).** The OSM centre line does **not** run down the middle of the City polygon: it runs
along a polygon edge (min OSM-line-to-polygon-boundary distance ≈ 0.01 m Oneida, 0.24 m Ojibway), and the captain found
Oneida points lying **outside** the polygon with offsets up to ~3.5 m near the SE end. So the City polygon gives a
**width** but not a clean **centre line** to relocate to. Exact-footprint relocation needs geometry reconciliation.

## 4. Actual runtime ground width (measured on the binary)

Measured on `data/toronto-geodata.bin` (decoded with `js/geodata-loader.js`; **not** the legacy JS), perpendicular to
each `GEO.roads` centre line, gap between the raised curb islands:

| Lane | Runtime gap (finite samples) | City footprint | Excess |
| --- | --- | --- | --- |
| Oneida | 5.15–5.90 m, **median 5.7 m** | ~3.3 m | **~2.4 m** |
| Ojibway | 3.95–4.00 m, **median 4.0 m** | ~3.5 m | ~0.5 m |

So Ojibway's ground is already close to its City footprint; **Oneida's is materially too wide**, consistent with its
larger OSM/City offset. The 6.4 m paving mask (half-width 3.2 m) covers the whole visible gap on both, so the pattern is
painted across the full visible width.

## 5. What does **not** work as a measurement source

- **City physical-sidewalk polygons** (`js/toronto-sidewalks.js`): they do cover the Algonquin blocks (islands
  2908/2914/2916/2917/2918/2920 each have pieces), but they are the **walk surface**, not the lane footprint. They do not
  bound the lane and are not used here.
- **One ground photo**: a single perspective view cannot give metres. Correctly excluded.

## 6. Orthophoto (captain-owned measurement, unresolved)

Official public 2024 8 cm service:
<https://gis.toronto.ca/arcgis/rest/services/basemap/cot_ortho_2024_color_8cm/MapServer>; specs
<https://www.toronto.ca/city-government/data-research-maps/maps/purchase-maps-data/orthoimagery-specifications/> (8 cm
resolution, 0.16 m horizontal accuracy, acquired Apr 26–May 30). Captain downloaded georeferenced exports to
`$WATERFRONT_RESEARCH/width-audit/` (`oneida-ortho2024.json`, `ojibway-ortho2024.json` at 0.0636 m/px;
`*-clear-*.json` at 0.0226 m/px, **upsampled beyond native 8 cm**, not new detail). Leaf-off imagery with foliage
obstruction; clear stretches exist. **The captain owns any pixel measurement; this audit does not infer from pixels it
cannot see.** No numerical aerial width is accepted yet.

## 7. Minimal correction seam (for the captain to delegate)

The paved footprint and the paving pattern must agree, so the seam touches **two** producers. Ordered by scope:

**A. Paving mask + paint gate (smallest, data-only, no geodata rebuild).**
`js/waterfront-island-road-materials.js` derives its band from `run.w/2` (line 153/226/241); `js/waterfront-island-lanes.js`
derives its gate tolerance from `run.w`. Set the two runs' `w` in `tools/build-island-lanes.mjs` via a **per-way measured
override** (with provenance + a representative/uncertainty note) and regenerate `js/waterfront-island-lanes-data.js`.
Effect: the herringbone/slab band narrows from 6.4 m to the representative width. **Risk:** the visible asphalt gap is
unchanged (~5.7 / 4.0 m), so native asphalt shoulders would show beside the narrower pattern unless (B) or (C) is also
done.

**B. Visible ground width (exact, larger, geodata rebuild).**
Narrow the lane's roadway raster in `tools/geo-blocks.mjs` (use the City Edge-of-Roadway polygon instead of, or with a
smaller, OSM connector for these two ways) and set `GEO.roads` width via a per-way override in `tools/geo-roads.mjs`.
Requires regenerating `js/toronto-geodata.js`, `data/toronto-geodata.bin` and `data/frames/eglinton/toronto-geodata.bin`.
**Risk:** shared geodata; the OSM/City alignment drift means this shifts the corridor, not just narrows it; needs care not
to disturb neighbouring blocks.

**C. Runtime ground treatment (captain's suggestion; no rebuild, new material logic).**
Keep the plane; extend the gated island-lane material so that, within the tightly gated corridor, the excess asphalt
outside the source footprint is recoloured to the yard/grass material **at the existing `y = 0` plane** (a shader mask on
`StreetLevel`, not a cover quad), while preserving `islandVergeSurfaceAt` / the ramp query. **Risk:** it is a real ground
material change, must not read as a floating patch, and must stay gated to the two rows.

**Recommendation.** Ship **A + C** as a bounded, coordinated pair: a representative width (**Oneida ≈ 3.3 m, Ojibway ≈
3.5 m**, from the City polygons) centred on the existing OSM line, labelled **representative — City alignment unresolved**;
do **not** claim the exact City footprint. Keep **B** as the exact-but-larger follow-up if the captain wants the ground
itself relocated. Any implementation is the captain's to sequence.

**Status.** The representative-width refinement (A + C, widths 3.3/3.5 m, grass on the existing plane) is being
implemented separately under bead **st-sb3r.27** (owner: the road-materials module/test/doc only). This audit does not
edit those files. Full-footprint reconciliation (B) stays open future work.

## 8. Honest limits

- The City Edge of Roadway metadata records maintenance on **2021-01-01**; its acquisition date is unverified. The ±0.16 m accuracy of the separate 2024 ortho does not apply to these polygons.
- The width is **variable** along each lane (Oneida 2.9–3.6 m, Ojibway 2.9–4.2 m); a single representative value is a
  visual refinement, not a survey.
- The OSM centre line is **offset** from the City polygon; the corrected lane would be centred on the OSM line, so its
  alignment to the City footprint stays unresolved and must be stated in any data/doc provenance.
- No runtime/geodata/data/loader/camera/test file was edited; no commit, push or deploy; no laptop GPU. The widths are a
  bounded visual refinement; the exact City-footprint relocation (B) remains open.
