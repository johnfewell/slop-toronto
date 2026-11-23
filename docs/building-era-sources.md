# Construction era for the buildings of the detail city

Investigation for bead st-ndw9.2 (brief 2026-11-14, addendum 2026-11-14). The question: exactly which open source, or
combination, can give a construction era to each of the 35,254 buildings in the detailed frame, and how many buildings
each one actually covers. A coarse era (six to eight periods) is enough; an exact year is not needed.

Every field, count, size and licence below comes from a response fetched during this task and saved under
`~/.cache/slop-toronto/raw/building-era/`; the file's path is cited beside the claim. Nothing is quoted
from memory. Where a fetch failed, the report says so and does not fill the gap.

## Summary

- **No open source gives an era, or a year, for most of the city's 35,254 buildings.** The best single per-building
  source is the City's Heritage Register: 2,153 buildings (6.1%), and it only covers the properties the City chose to
  list or designate.
- The three per-building sources together (Heritage Register, RentSafeTO apartment registrations, New Building
  permits) name **2,974 buildings, 8.4%**, and their eras barely overlap in what is missing: heritage is nearly all
  pre-1920, registration and permits nearly all the apartment and new-build classes.
- Adding OpenStreetMap `start_date` (46 buildings, 0.1%, almost all civic or named) brings it to 2,999, 8.5%. OSM is
  not worth a fetch of its own: in the frame it tags 66 of 105,315 building ways, and in seven other Ontario cities it
  tags 407 of 622,748 (0.065%).
- **Statistics Canada publishes period of construction per household, not per building.** The only openly served
  table (98-10-0242) stops at the census metropolitan area, and the profile pages that would give a dissemination area
  or census tract answered with a security check (saved). It is a city-wide shape for calibrating the model, not a
  source of eras.
- So the recommendation is **the per-building sources for the 8.5% they cover, and neighbourhood periods for the
  rest**, with the geographic shape of the Census CMA table used only as a sanity check. Section "Recommendation" says
  what share would still have no direct source (91.5%) and how far a hand-drawn map can close it.

## Table of candidates

| Candidate | Licence | Locates a building by | Records in frame | Buildings covered (of 35,254) | Share | Field holding the year/period |
|---|---|---|---|---|---|---|
| Heritage Register (`CONSTRUCTI`) | Open Government Licence – Toronto | address point, inside outline (else 15 m) | 7,855 with a year (12,332 records) | 2,153 | 6.1% | `CONSTRUCTI`, text: `1914`, `1910 (circa)`, `1873-1874` |
| Apartment Building Registration (`YEAR_BUILT`) | OGL – Toronto | point per building | 3,599 | 555 | 1.6% | `YEAR_BUILT`, `1946`..`2025` |
| Building Permits, New Building (`ISSUED_DATE`) | OGL – Toronto | street address text → address point | 1,743 placed | 516 | 1.5% | `ISSUED_DATE` year (`2018-10-31`) |
| OpenStreetMap `start_date` etc. | ODbL 1.0 | way centre | 66 | 46 | 0.1% | `start_date`: `1893`, `2003-04-01`, `~1886` |
| Statistics Canada 98-10-0242 | Statistics Canada Open Licence | CMA only | 2,247,400 households | none (share, not a record) | 0% | `Period of construction (13)` |
| Census dissemination areas (City GIS) | OGL – Toronto | area polygon | 1,104 areas | none (join unit) | 0% | none: no year in the layer |
| Property boundaries (parcels) | OGL – Toronto | parcel polygon | 48,568 polygons touching the frame | none (lot unit) | 0% | none |
| Address points | OGL – Toronto | point | 147,084 | none (a dwelling unit, not a build date) | 0% | none |
| Building Outlines (topographic) | OGL – Toronto | polygon | not counted | none | 0% | none: `DERIVED_HEIGHT` is metres |
| Zoning By-law areas | OGL – Toronto | area polygon | not counted | none | 0% | none |
| Apartment Building Evaluation (RentSafeTO) | OGL – Toronto | point per building | not counted | none | 0% | none (scores only) |

Three per-building sources together, de-duplicated by outline: **2,974 buildings, 8.4%**. A building can be named by
more than one; the counts below are per source, per building.

## 1. The City's Heritage Register

- **Title** Heritage Register; dataset `heritage-register`; Open Government Licence – Toronto; zipped Shapefile
  (`Heritage Register Data`, 2026-09-01 quarterly) — `~/.cache/slop-toronto/raw/building-era/ckan/pkg-heritage-register.json`
  (package `e41da515-5ad1-4bc3-85ea-18ec9e55cd33`, `metadata_modified` 2026-10-29).
- **On disk** `~/.cache/slop-toronto/raw/heritage-register/`: `shp/HRAPQ32026_OpenData.{shp,dbf}` plus
  `shp/all.geojson` (the same 12,332 records as points: `FeatureCollection` of 12,332, first property set listed).
- **Format** Shapefile; the `.dbf` has **12,332 records**, 42 fields. The field for the year is `CONSTRUCTI`, a
  254-character text (`shp/HRAPQ32026_OpenData.dbf` header, field offset 32 + 19 × 32; and `...shp.xml`, field list).
- **Values** 5,385 plain four-digit years, 1,062 "circa", 1,246 year ranges, 68 other range forms, 4,476 empty. Sample
  from the `.dbf`: `17 SALISBURY AVE -> 1914`, `16 SOHO ST -> 1888`, `4 SOUTH KINGSWAY -> 1750-1751`. (That one is implausible for a house: a 1750 construction for a Kingsway address is worth checking before any era is assigned from it.)
- **How a record is located** an address point. The register's own point geometry is in `all.geojson`; the earlier
  Slop fetch holds address points only (`~/.cache/slop-toronto/raw/heritage-register/heritage_register_address_points_wgs84.zip`,
  `..._2022.zip`).
- **Coverage** 12,332 records, 7,855 with a year; 4,393 of those have a point inside the detail frame; 4,327 match an
  outline (4,007 inside, 320 within 15 m, 66 matched nothing); **2,153 distinct outlines**. Table:
  `tools/report-building-era.mjs` → `~/.cache/slop-toronto/ntm/st-ndw9/coverage.json`.
- **Eras of the matched buildings** Victorian 1,301, Edwardian 455, Interwar 290, Postwar 46, Late postwar 36,
  New build 13, unknown 12. By class: house 565, mid-rise 851, tower 191, low-rise 370, worship 62, civic 100,
  works 10, shed 4. (A building taking several heritage records takes the earliest.)
- **What it cannot do** it is a list of properties Council chose to designate or list, not a survey of every building.
  It is biased to the old and the grand: 565 of the 16,073 house outlines, 88% of its matched buildings before 1919.
  It cannot tell a 1914 house from a 2014 one outside those 2,153.

## 2. RentSafeTO Apartment Building Registration

- **Title** Apartment Building Registration; dataset `apartment-building-registration`; OGL – Toronto; CSV datastore
  (`metadata_modified` 2026-07-05) — `~/.cache/slop-toronto/raw/building-era/ckan/pkg-apartment-building-registration.json`.
- **Fields** 62 columns; the one that matters is `YEAR_BUILT` (text), with `SITE_ADDRESS`, `LATITUDE`, `LONGITUDE`,
  `CONFIRMED_STOREYS`, `CONFIRMED_UNITS` — `~/.cache/slop-toronto/raw/building-era/ckan/ds-3ad76a8c-0518-4df2-b94e-8c747d62f8c1.json`
  (the datastore's field list; `total` 3,611 rows in the portal's page).
- **Values** the ArcGIS copy on disk has 3,610 records, 3,599 with a year between 1800 and 2026:
  `1 ROSEDALE RD -> 1956`, `841 MILLWOOD RD -> 1960`, `1 CLAUDE AVE -> 1960` —
  `~/.cache/slop-toronto/raw/building-era/cot/apartment-building-registration.json`
  (City GIS `cot_geospatial8/MapServer/6`, the RentSafeTO layer; the CKAN CSV of the same rows is also saved as
  `ckan/pkg-apartment-building-registration.json`'s datastore dump).
- **How a record is located** a point per building (`LATITUDE`, `LONGITUDE`), which is what the layer draws.
- **Coverage** 3,599 years; 579 points in the frame; 569 match (553 inside, 16 within 15 m); **555 outlines**, 1.6%.
  Eras: Victorian 27, Edwardian 42, Interwar 85, Postwar 83, Late postwar 177, New build 140. Classes: mid-rise 272,
  tower 163, low-rise 79, house 38, worship 3.
- **What it cannot do** it covers only apartment buildings of 3+ storeys and 10+ units behind the ABS bylaw; it cannot
  speak for a house, a shop or a small walk-up under ten units. That is the whole reason it reaches only 555.

## 3. New Building permits

- **Titles** Building Permits – Active Permits (`building-permits-active-permits`) and Building Permits – Cleared
  Permits (`building-permits-cleared-permits`), both OGL – Toronto — `ckan/pkg-building-permits-active-permits.json`,
  `ckan/pkg-building-permits-cleared-permits.json`. Datastores `6d0229af-…` (196,960 rows) and `a96c0ba4-…` (452,689
  rows): `ckan/ds-6d0229af-bc54-46de-9c2b-26759b01dd05.json`, `ckan/ds-a96c0ba4-3026-402b-b09d-5b1268b8f810.json`.
- **Fields** `PERMIT_NUM`, `PERMIT_TYPE`, `STRUCTURE_TYPE`, `STREET_NUM`, `STREET_NAME`, `STREET_TYPE`,
  `STREET_DIRECTION`, `APPLICATION_DATE`, `ISSUED_DATE`, `COMPLETED_DATE`, `DESCRIPTION`, `CURRENT_USE`,
  `PROPOSED_USE`, `DWELLING_UNITS_CREATED`, `EST_CONST_COST`, `GEO_ID` (same two field lists above).
- **Values** filter `PERMIT_TYPE = "New Building"`: 2,059 cleared rows and 2,712 active rows; the descriptive rows are
  saved in `cot/building-permits-new-building.json` (4,771 rows, fields above). `ISSUED_DATE` is the year:
  `13 175498 BLD, 2015-12-24, Apartment Building, 1483 BIRCHMOUNT RD`; `12 162633 BLD, 2012-10-31, Other, 440 UNWIN AVE`.
- **How a record is located** address text only: `STREET_NUM` + `STREET_NAME` + `STREET_TYPE` + `STREET_DIRECTION`.
  The permit tables carry no longitude or latitude. The `GEO_ID` column points at a property record; it was not
  resolved here. Placement used the City's address points (`cot/address-point-2021-in-frame.json`, 147,084 points in
  the frame, from `cot_geospatial27/MapServer/101`, pages of 2,000, count checked against
  `cot/address-point-2021-count-in-frame.json`): 1,743 permits found an exact address point, 1,230 of those are in the
  frame, 1,097 match an outline, **516 buildings**, 1.5%.
- **Eras** all in 2012–2026 except 261 without a usable issue date: New build 402, unknown 114 (by building). The
  oldest issued date read is 2015 (cleared file); cleared means "completed or closed", and the file's own note says it
  is the completed/closed set, not a cut by year
  (`ckan/pkg-building-permits-cleared-permits.json`), so a pre-2015 cleared permit can be absent. Classes: mid-rise 159,
  tower 141, low-rise 100, house 78, civic 20, works 13, worship 4, shed 1.
- **What it cannot do** it is **not a record of when buildings were built**. It is a record of permits issued (with
  revisions issued under the same `PERMIT_NUM`), the description text includes some non-new construction (a revision
  to a stair layout, an underground garage), and anything built before the datastore's window has no permit here. It
  says nothing about the ~34,700 buildings that were already standing when the permits were issued.

## 4. OpenStreetMap start_date

- **Title** OpenStreetMap Ontario extract; ODbL 1.0; on disk `~/.cache/slop-toronto/raw/ontario-latest.osm.pbf`
  (985 MB, `sources.json` `osm-geofabrik-ontario`). The Overpass API for the frame answered (OSM base
  `2026-11-15T03:05:07Z`) — `~/.cache/slop-toronto/raw/building-era/overpass/osm-buildings-in-frame.json`.
- **Fields, counted over every building way whose centre is in the frame** (105,315 ways): `building:levels` 15,409,
  `roof:shape` 2,502, `start_date` 62, `year_of_construction` 3, `construction_date` 1, `building:architecture` 3 —
  same file, tags pass 1 (`overpass/osm-buildings-page1-tags-qt.json`, 10,000-way first page, and the full file).
- **Values** `start_date=1893` (public), `1962` (school), `1927`; `2003-04-01` (hotel); `~1886` (church);
  `year_of_construction=1965` (apartments).
- **How a record is located** a building way; its centre (or bounds midpoint) matched to an outline.
- **Coverage** 66 tagged with a year, 53 with a centre in the frame, 48 match, **46 buildings**, 0.1%. Eras: Victorian
  4, Edwardian 8, Interwar 5, Postwar 3, Late postwar 6, New build 20. Classes: civic 11, low-rise 7, tower 10,
  mid-rise 10, worship 4, house 4.
- **What it cannot do** it is a volunteer tag, sparse, and its absence means nothing. To show the sparsity is not a
  Toronto-only accident, the same tag count was run on seven other Ontario cities (Overpass, 2026-11-15, the responses
  in `~/.cache/slop-toronto/raw/building-era/overpass/osm-*-tags.json`):

  | City (OSM relation) | Building ways | Tagged with a year | Share |
  |---|---|---|---|
  | Toronto, frame | 105,315 | 66 | 0.06% |
  | London (7485368) | 116,506 | 7 | 0.01% |
  | Windsor (7025718) | 179,211 | 271 | 0.15% |
  | Hamilton (7034910) | 155,898 | 40 | 0.03% |
  | Kingston (4145881) | 43,686 | 84 | 0.19% |
  | St Catharines (2387995) | 53,714 | 2 | 0.00% |
  | Peterborough (7473849) | 30,875 | 2 | 0.01% |
  | Barrie (6609999) | 42,858 | 1 | 0.00% |

  The nominatim lookups are saved as `ckan/nm-<city>.json`; the policy page that governs those calls is saved as
  `ckan/osm-nominatim-usage.txt`.

## 5. Statistics Canada period of construction

- **Title** "Housing indicators by tenure including presence of mortgage payments and subsidized housing, household
  size and period of construction: Canada, provinces and territories, census metropolitan areas and census
  agglomerations", product 98-10-0242, 2021 Census, 25% sample; current. WDS metadata call saved as
  `census/wds-cube-98100242.json`; the WDS table list `census/wds-cubes-list-9810.json`; the table's own metadata
  `census/98100242_MetaData.csv` (first line: `Census, 2021, 25% Sample data`).
- **Licence** Statistics Canada Open Licence (the table is served openly from `www150.statcan.gc.ca`); the full CSV
  (zip, 35,276,327 bytes, `census/98100242-content-length-headers.txt`) is `census/98100242-eng.zip`.
- **Field** `Period of construction (13)`: Total, `1920 or before`, `1921 to 1945`, `1946 to 1960`, `1961 to 1970`,
  `1971 to 1980`, `1981 to 1990`, `1991 to 1995`, `1996 to 2000`, `2001 to 2005`, `2006 to 2010`, `2011 to 2015`,
  `2016 to 2021` (`wds-cube-98100242.json`, dimension 4).
- **Geography** the title's own list: Canada, provinces, CMAs and CAs. The dimension has 166 members
  (`wds-cube-98100242.json`); Toronto appears as `Toronto (CMA), Ont.`. **There is no dissemination area or census
  tract in this table.**
- **Values, Toronto CMA** (`census/toronto-cma-period-of-construction.json`, all 2,247,400 households): 1920 or before
  102,765 (4.6%), 1921–45 90,425 (4.0%), 1946–60 216,105 (9.6%), 1961–70 247,230 (11.0%), 1971–80 300,290 (13.4%),
  1981–90 297,440 (13.2%), 1991–95 123,575 (5.5%), 1996–2000 155,055 (6.9%), 2001–05 192,575 (8.6%), 2006–10 175,365
  (7.8%), 2011–15 170,915 (7.6%), 2016–21 175,675 (7.8%).
- **What it cannot do** it is a share of households in an area, not a record for a building. It cannot place an era on
  one house, and at CMA scale it cannot even say that a neighbourhood is old: the whole of the old City of Toronto and
  the whole of Mississauga 1965 sprawl are in one row.
- **The per-area route that would fix this was tried and is not open:** the 2021 profile page
  (`www12.statcan.gc.ca/.../page.cfm?DGUIDList=2021S05123520005`) and the 98-401 download link both answered with a
  security-check page (`census/BLOCKED-profile-pages.txt`, and the blocked HTML was seen then discarded); the WDS
  series endpoint refused the coordinates tried (`census/wds-series-*.json`: "One or more co-ordinate(s) provided is
  not valid"); no WDS table for a dissemination area or census tract with period of construction exists in the 8,282
  cube list (`wds-cubes-list-9810.json` filtered on "period of construction": only the CMA/CA table 98-10-0242 and a
  residence-ownership set 33-10-0003 / 39-10-0045 / 46-10-00xx, of which the Toronto CMA one is by property type, not
  by area). A City GIS dissemination-area layer exists (1,104 areas intersect the frame,
  `cot/census-dissemination-area-2021.json`) and would be the join unit, but the per-area numbers are behind the
  blocked portal.

## 6. What can be attached to a building but is not a year

- **Building Outlines (topographic)** `topographic-mapping-building-outlines`, OGL – Toronto, 557,694 datastore rows
  (`ckan/ds-8c8cf295-9b2c-4d51-96c2-b276767902d8.json`). Fields `SUBTYPE_DESC`, `ELEVATION`, `DERIVED_HEIGHT` (text),
  `LAST_GEOMETRY_MAINT`, `LAST_ATTRIBUTE_MAINT`, `geometry`; the City GIS copy adds `BUILDINGID`
  (`cot/building-outline-topographic-sample.json`). There is **no construction year**. The first URL tried for
  the CSV (resource 41372651 with an incomplete id) answered 403/404 (`ckan/topo-outlines-headers.txt`); the full
  resource URL in the package resolves to a 273,631,677-byte CSV (`content-range` header in the same file). It was not
  downloaded: the field list shows no construction year, and 273.6 MB is close to the 300 MB rule for no gain. The
  six-row field sample is `cot/building-outline-topographic-sample.json`.
- **Zoning By-law** `zoning-by-law`, OGL – Toronto; the Zoning Area layer's fields are `ZN_*` (frontage, area, unit
  count, densities) — `cot/zoning-area-2021-sample.json`. **No year.**
- **Apartment Building Evaluation (RentSafeTO)** `apartment-building-evaluation`, OGL – Toronto; datastores
  `244f7a02-…` and `b987be09-…` (`ckan/pkg-apartment-building-evaluation.json`). Scores, no `YEAR_BUILT`
  (the registration above has it).
- **Property Boundaries** (addendum, section 7) and **Address Points** (same), OGL – Toronto.

## 7. How many dwellings or lots one outline covers (addendum)

The house outlines are **16,073** (kind 0 in `GEO.buildings`, of 35,254 outlines: house 16,073, low-rise 3,672,
mid-rise 9,503, tower 3,981, shed 328, works 88, worship 300, civic 1,309). 12,136 of the house outlines (75.5%) have
no party wall and their median narrower bounding side is 9.30 m — `tools/house-outline-width.mjs`,
result saved at `~/.cache/slop-toronto/raw/building-era/house-outlines-party-wall.json` (party walls
are the massing sidecar's `partyN` column, `js/massing-data.js`).

**Address points** – `~/.cache/slop-toronto/raw/building-era/cot/address-point-2021-in-frame.json`
(City GIS `cot_geospatial27/MapServer/101`; 147,084 points in the frame, matched exactly to the portal's count in
`cot/address-point-2021-count-in-frame.json`). Fields: `ADDRESS_POINT_ID`, `ADDRESS_FULL`, `LONGITUDE`, `LATITUDE`
(and the CKAN resource's full 32-field list in `ckan/ds-field-0b3756af-9caf-4f0f-ac28-9c6617adede4.json`; OGL –
Toronto). 57,438 points fall inside the frame rectangle. **Address points inside each house outline:**

| Address points in the outline | House outlines | Share |
|---|---|---|
| 0 | 1,988 | 12.4% |
| 1 | 7,958 | 49.5% |
| 2 | 4,769 | 29.7% |
| 3 | 702 | 4.4% |
| 4 | 317 | 2.0% |
| 5 or more | 339 | 2.1% |

**6,127 house outlines (38.1%) hold two or more address points**: consistent with the City drawing both halves of a
semi, and often a row of houses, as one outline (the addendum's hypothesis), though an address point can also be a
second unit in one house.

**Property (parcel) boundaries** – `property-boundaries`, OGL – Toronto, CKAN datastore CSV `property-boundaries-4326.csv`,
**224,739,799 bytes** (content-range header in `ckan/property-boundaries-4326.csv.source.txt`; noted before the
download, under the 300 MB rule). Fields: `PARCELID` (7 digits, e.g. `5126707`), `FEATURE_TYPE` (`COMMON`), `STATEDAREA`
(`18544.72 sq.m`), `OBJECTID`, `geometry` (`ckan/ds-field-4270614e-0b5e-4b54-a2bb-18ef92237646.json`; 498,477 rows).
48,568 parcel polygons have a bounding box touching the frame, projected to metres and kept in
`~/.cache/slop-toronto/raw/building-era/parcels-in-frame.json` (median 5 corners). **Parcels whose
centre lies inside each house outline:**

| Parcels crossed (centre inside) | House outlines | Share |
|---|---|---|
| 0 | 7,077 | 44.0% |
| 1 | 5,829 | 36.3% |
| 2 | 2,576 | 16.0% |
| 3 | 348 | 2.2% |
| 4 | 139 | 0.9% |
| 5 or more | 104 | 0.6% |

The two point opposite ways: of the 6,127 house outlines with two or more address points only **2,975 (48.5%)** also
cross two or more parcels, and of the 1,988 with no address point **1,669 (84.0%)** still cross at least one parcel.
The **44% with no parcel centre inside** are not "no lot": the City's parcels include many kinds (`COMMON`, lane, road,
park, stratified lots; `FEATURE_TYPE` was not tallied per house here) and a parcel whose centre lies under a
neighbouring building can still cover this house's lot, while a road parcel's centre falls in the outline of the
buildings that front it. Address points are the better dwelling count of the two: they are the City's own civic
addresses. Where neither settles it, the party-wall count and the 9.3 m width remain the best signals of a semi or a
row.

## Recommendation

1. **Use the three per-building sources for what they cover**, keyed by the durable massing ID
   (`to-3dmassing-2025:<fid>`): Heritage Register `CONSTRUCTI` (2,153 buildings, nearly all pre-1920; the whole Victorian
   and Edwardian house family can lean on it), RentSafeTO `YEAR_BUILT` (555, the interwar to 1990 apartment classes),
   and New Building permits for the 516 new builds (2012 on). Together: **2,974 buildings, 8.4%**; with OSM, 2,999, 8.5%.
2. **For the other 32,280 (91.5%) there is no open per-building record.** Draw era by neighbourhood: a hand-drawn map of
   "mostly built in" periods, using three things we already hold — the six-era split of the Census CMA table as the
   city-wide check that the map's totals land in the right decades, the address-point count per outline (section 7) to
   mark infill, and the roof and footprint signals in the prototype spec. The map is an estimate, not a record; its
   per-neighbourhood accuracy should be spot-checked against the 2,153 heritage years before it is trusted (they are
   all old, so they check the Victorian/Edwardian edge, not the postwar one).
3. **Do not build a fetcher for the Census profile pages or the WDS series API** for this purpose until the
   security-check block is lifted or a DLI account exists; the openly served table is CMA-only and cannot be joined to
   a building.

The fallback is honest either way: a building with no source keeps today's look, and the era map can be revised
neighbourhood by neighbourhood without touching geometry.

## Limits

- **Matching method.** A record matches an outline when its point (or way centre, or address point) lies inside the
  outer ring, else when the nearest ring edge is within 15 m. 66 heritage records, 10 registration points, 133 permit
  placements and 5 OSM ways matched nothing. The 15 m rule can attach a record to the building next door where a row
  is tight; it is the same rule the brief allows for the nearest-outline case and is applied to all four sources alike.
- **Heritage year forms.** `CONSTRUCTI` carries ranges (`1873-1874`) and "circa"; a range takes its later year. 68
  range forms with trailing "circa" (`1903-1913 (circa)`) were counted with the plain ranges; the era split does not
  change for any range inside one era.
- **Permits.** The permit tables have no coordinates; 1,743 of 4,771 New Building permits found an exact address point.
  A permit on an address the point layer does not hold (a new address not yet in the repository, or a unit address)
  was dropped rather than guessed. The 516 buildings are the permits, not necessarily the final building: a permit
  building the addition to an older structure still yields the permit's year.
- **Statistics Canada.** Only the CMA table could be read; a per-dissemination-area or per-tract table was looked for
  in the 8,282-table WDS list and is not there. The 1,104 dissemination areas intersecting the frame are the join unit
  for later, but no open per-area numbers were found to join.
- **Not measured.** The Census tract (`CT`) table of period of construction was not fetched (blocked portal); the
  2016 or earlier censuses were not tried; the `GEO_ID` of the permit table was not resolved to a property or a
  building; `FEATURE_TYPE` of the parcels was not tallied per house; the property-boundary file's own note says its
  boundaries are for general planning only and are not to be used as a legal survey
  (`ckan/pkg-property-boundaries.json`).
- **Timing of the numbers:** all figures are 2026-11-15 fetches of editions that change (permits daily, heritage
  quarterly). Re-run `tools/fetch-building-era.mjs` then `tools/report-building-era.mjs` to refresh them;
  `~/.cache/slop-toronto/ntm/st-ndw9/coverage.json` holds the machine-readable result.

## Scripts

- `tools/building-era-frame.mjs` — the frame projection, point in
  outline, the 15 m nearest-outline match, the per-outline counters.
- `tools/report-building-era.mjs` — every number above.
- `tools/fetch-building-era.mjs` — the fetches into the private cache.
- `tools/house-outline-width.mjs` — the house party-wall and width count
  (section 7).
- `tests/building-era.test.mjs` — the geometry and parser tests.
