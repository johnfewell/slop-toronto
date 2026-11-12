> This is a bounded source search, not proof that an as-built survey does not exist. No usable current public surface was found in the sources checked.

# Biidaasige Park — current terrain / relief source audit (st-bmyv.11)

Bead **st-bmyv.11** (actual-terrain prerequisite for parent **st-bmyv**). Bounded primary-source
search (≤15 min) for **current (2025/2026) as-built ground relief** of the new park. This is a
**read-only source audit**: it changes no shared runtime, commits nothing, closes no bead, and
runs no GPU. Owned files: this doc and `tools/fixtures/biidaasige-relief-source.json`. Private
fetches live under `$WATERFRONT_RESEARCH/biidaasige/relief-primary/`.

> **The question this answers:** the current park base is flat and honestly described as flat.
> The real park has a **~9 m western promontory** and multi-level river banks. Do *actual current*
> elevation data (contours, DSM/DEM, as-built grading) exist that we could derive a walkable
> surface from — as opposed to inventing a hill from one design figure?

## 0. Headline (honest)

**No published 2025/2026 LiDAR, DSM, DEM, contour or as-built grading plan covers the new park.**
The only City/Provincial bare-earth and surface models over the park are **GTA 2023** (and GTA
2015) LiDAR, acquired **before the park opened** (east 2025, west 2026). The ~9 m promontory is a
**primary design fact** (MVVA) plus a **primary construction description** (Waterfront Toronto,
March 2025) — **not a surveyed surface**. No source geometry is published, so a faithful walkable
mesh **cannot** be derived from actual data yet. The single 9 m figure does **not** define a
conical hill.

## 1. What actual elevation data exists over the park

| Source | Type | Park tile / date | Resolution | Datum | Current grade? |
| --- | --- | --- | --- | --- | --- |
| Ontario DTM (Lidar-Derived) | bare-earth raster | **GTA 2023** `1km176320483302023LGTA2023_DTM` | 0.5 m | CGVD2013 | **No** — 2023, pre-park |
| Ontario DTM (Lidar-Derived) | bare-earth raster | GTA 2015 `…2015LGTA2015_DTM` | 0.5 m | CGVD2013 | **No** — 2015 |
| Ontario DSM (Lidar-Derived) | first-return surface | **GTA 2023** `1km176320483302023LGTA2023_DSM` | 0.5 m | CGVD2013 | **No** — 2023, pre-park |
| City TIN | TIN polygons (Avg_Elev, Slope, Aspect) | 2023 LiDAR-derived 2.5 m bare-earth | 2.5 m | CGVD2013 / MTM10 | **No** — 2023, pre-park |

- **Vertical datum:** EPSG **6647 = CGVD2013(CGG2013) height**, confirmed from the Ontario
  DTM/DSM ImageServer `vcsWkid` and matching the City TIN's stated datum.
- **Horizontal:** provincial tiles NAD83(CSRS) (served in EPSG:3857); City TIN NAD83(CSRS) /
  MTM zone 10 (EPSG:2952).
- **Acquisition method:** "Linear Mode Lidar", horizontal accuracy 0.3 m (GTA 2023), vertical
  accuracy class 5.

**Why these are not current grade.** The park opened in phases — eastern section summer 2025,
western section (including the promontory) in 2026. A 2023 LiDAR flight captured the site
**mid-construction** (earthworks, not the final landscape). Sampling the GTA 2023 DTM across the
park footprint on 2026-11-10 gives **≈73.9–81.6 m** (CGVD2013) — but these are 2023
construction-stage elevations, **not** the finished promontory or banks. They are recorded in the
fixture only as a **pre-park baseline**, explicitly labelled not-current.

## 2. What the primary sources actually say about the relief

**MVVA — Port Lands Flood Protection (design, primary):**
> "the Promontory, a **nine-meter landform** constructed from the excavation of the Cove, anchors
> the park's western edge and offers commanding city views."

> "The Badlands, inspired by the Cheltenham Badlands, features **dramatic topography** along with
> water pumps, cranks, and jets to invite multi-sensory water play."

**Waterfront Toronto — descriptive transcript, construction, March 2025 (primary):**
> "A construction site, with a **large retaining wall** in the centre, labeled as a
> '**promontory/overlook**', surrounded by **ground of varying elevations**."

> "The past few months have been busy with landscaping the western part of Biidaasige Park. You
> can see how we've started to build the **rock façade of the promontory**, A high point that will
> offer views of the downtown skyline."

> "in **2026**, this western section of the park will open, along with the much-anticipated
> Lassonde Art Trail."

**Waterfront Toronto — opening announcement (primary):**
> "A '**promontory**' or lookout over the new river and towards the city skyline." (a 2026 feature)

> "Creating the **new grading around the river's banks**." (flood-protection scope)

These confirm the promontory is **real, built, and a retaining-wall landform with varying
elevations** — but they give **no numeric elevations, contours, sections or coordinates**. The
9 m is design intent, not a survey.

## 3. Exact negative checks (what was searched and not found)

1. **City Open Data — 2025/2026 LiDAR/DSM/DEM/contour/spot-elevation:** none. CKAN
   `package_search` for *elevation, digital surface model, contour, topographic, digital
   elevation, ground elevation, LiDAR 2025, LiDAR 2026, bare earth, spot elevation, survey
   monument* returned only the 2023-derived TIN, 3D Massing (buildings), and topographic **vector**
   layers — no 2025/2026 elevation raster.
2. **City basemap services — current-year LiDAR hillshade:** none. Only
   `cot_LiDAR_2015_Hillshade_BareEarth` and `cot_LiDAR_2015_Hillshade_FullFeature`.
3. **City 3D Massing 2025 as a ground source:** not applicable — building massing only, no
   bare-earth/ground elevation attribute.
4. **Provincial LiDAR newer than 2023 over the park:** none. The DTM/DSM package index returns
   only GTA 2023 and GTA 2015 at the park point. The "2024 LiDAR – Hydro Enforced DTM" item is
   **Washington, D.C.** (dcgis), not Toronto. `Ontario_DEM_ImageryDerived` returns **NoData** at
   the park.
5. **Waterfront Toronto grading / landscape tender / as-built / contour plan:** none published.
   Sitemap + document-library search for *grading, tender, as-built, elevation, contour, survey,
   landscape, technical* returned only precinct plans, design-review agendas/minutes, construction
   notices (boilerplate traffic/road text) and backgrounders.
6. **City Biidaasige Park page:** no elevation/contour/promontory-height text.

## 4. Georeference feasibility

- The **GTA 2023 DTM/DSM are fully georeferenced** (EPSG:3857 served, CGVD2013 vertical) and can
  be sampled — but they are **pre-park** and do not contain the final promontory/banks.
- **No georeferenced surface of the built promontory exists** in any published source. The 9 m
  figure is design intent; the March 2025 transcript confirms a retaining-wall promontory with
  "ground of varying elevations" but gives no numbers or coordinates.
- **Conclusion:** a faithful walkable mesh of the *actual current* relief **cannot** be derived
  from published actual data at this time.

## 5. Recommendation for the captain

- **Do not build a conical hill from the single 9 m design figure.** That figure describes a
  landform, not a cone, and is not a survey.
- If relief is required now, treat the promontory as an **explicit, labelled estimate** (design
  intent + construction description) with a clear uncertainty note, and keep the flat native base
  elsewhere. The honest current-grade surface is unavailable from published sources.
- **Next useful evidence:** (a) request the as-built survey / grading drawings from Waterfront
  Toronto or the landscape contractor (not published online); (b) watch for a 2025/2026 City or
  TRCA LiDAR flight over the Port Lands (none published as of 2026-11-10); (c) if a future
  City/Provincial LiDAR refresh is published, re-run the DTM/DSM identify at the park tiles and
  compare to the GTA 2023 baseline recorded in the fixture.

## 6. Sources

| Source | URL | Date / licence |
| --- | --- | --- |
| Ontario DTM (Lidar-Derived) ImageServer | https://ws.geoservices.lrc.gov.on.ca/arcgis5/rest/services/Elevation/Ontario_DTM_LidarDerived/ImageServer | GTA 2023 tile; OGL-Ontario |
| Ontario DTM package index (FeatureServer) | https://services1.arcgis.com/TJH5KDher0W13Kgo/arcgis/rest/services/Ontario_Digital_Terrain_Model_Lidar_Derived_WFL1/FeatureServer/0 | 420 tiles; OGL-Ontario |
| Ontario DSM (Lidar-Derived) ImageServer | https://ws.geoservices.lrc.gov.on.ca/arcgis5/rest/services/Elevation/Ontario_DSM_LidarDerived/ImageServer | GTA 2023 tile; OGL-Ontario |
| City TIN | https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/triangular-irregular-network-tin | 2023 LiDAR-derived 2.5 m; OGL-Toronto |
| City 3D Massing | https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/3d-massing | buildings only; OGL-Toronto |
| MVVA — Port Lands Flood Protection | https://www.mvvainc.com/projects/port-lands-flood-protection2 | design; all rights reserved (short quotes) |
| Waterfront Toronto — March 2025 construction transcript | https://www.waterfrontoronto.ca/descriptive-transcript-construction-port-lands-march-2025 | 2025; WT site |
| Waterfront Toronto — opening announcement | https://www.waterfrontoronto.ca/news/largest-park--in-a-generation-opens-on-torontos-new-island-through-transformative-port-lands-flood-protection-project | 2025; WT site |

Structured record: `tools/fixtures/biidaasige-relief-source.json`. No image pixels were
interpreted; no shared runtime was touched; no commit, deploy or bead close.
