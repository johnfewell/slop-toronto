# QCYC clubhouse: source audit and bounded appearance (st-sb3r.39)

This records the Queen City Yacht Club clubhouse identity audit and the bounded, source-informed appearance now applied
to **one** island row. It changes rendering only: the native footprint, the collider and the 6.5 m height are unchanged,
and the accepted shed/storage (`st-sb3r.33/.34`), canopy (`.36`) and dinghy-hull (`.38`) work is untouched.

## 1. Which row is the clubhouse (identity)

| Field | Value | Source |
| --- | --- | --- |
| Island row | **32139** (`1255.6, 2126.3`, yaw −0.983) | committed geodata (`data/toronto-geodata.bin`) |
| OSM way | **43805118** `building=yes`, name **"Queen City Yacht Club clubhouse"**, `building:levels=2` | OSM (ODbL), base 2026-11-10 |
| OSM provenance | `source=CanVec_Import_2009`, `attribution=Natural Resources Canada` | OSM tags |
| Marina | inside OSM `leisure=marina` **Way 193043084** ("Queen City Yacht Club") | OSM |
| Native footprint | `[-0.983,[[-18.7,15.3,-3.5,9.5],[-2.2,18.8,-8.5,-3.5]]]` (two-part L) | committed row `fp` |
| Rendered today (before this pass) | 6.5 m (OSM levels 2), no roof shape, no siding, no appearance → generic brown envelope | `js/waterfront-island-buildings-data.js` |

`node tools/audit-qcyc-clubhouse.mjs` reproduces this from the committed data. `tools/data/qcyc-clubhouse-osm.json` is a
**subset** (the six QCYC-cluster ways) of the captain-local primary Overpass building cache `b.json`; its recorded
`sha256` is that **original cache's** hash (provenance for where the ways came from, the same value
`island-outliers.json` archives), **not** a hash of the subset file.

**What the audit proves.** The OSM way is the named, two-level clubhouse; it lies inside the QCYC marina; exactly one
committed row carries that OSM id; and the committed `nativeFp` re-projects onto the OSM outline (centre offset ~3.2 m,
committed extent 35.8 × 35.5 m vs OSM 35.3 × 35.9 m). That is a **consistency** check of the committed binding.

**What it does not prove.** It does not re-run the builder's massing↔OSM matcher, it does not prove no other OSM way
anywhere could tie (the committed fixture holds only the cluster's ways), and it makes no dimensional claim — the name
and `building:levels` are an NRCan CanVec import, not a QCYC survey.

## 2. Primary exterior reference (appearance)

- [Official QCYC homepage hero](https://qcyc.ca/sites/all/themes/QCYC2017/images/hero_home/queen-city-yacht-club-toronto-island-lt-1920.jpg)
  (1920×1080), Last-Modified **2021-12-09**. **Acquisition date
  unknown**; the current homepage is not a current-dated survey. Reference only — **not** bundled or shipped (copyright).
- [2024 City of Toronto orthophoto service](https://gis.toronto.ca/arcgis/rest/services/basemap/cot_ortho_2024_color_8cm/MapServer)
  (8 cm, acquisition 26 Apr–30 May 2024): the low clubhouse mass in the marina.
- [QCYC 2019 renovation gallery](https://qcyc.ca/node/9459) supports the white panel/navy trim palette used on the sheds.

The hero shows: a **white two-storey envelope**, a **dark grey pitched/hip roof**, **repeated window bays**, and a
**waterfront balcony/terrace**. Window counts, bay counts, roof pitch and balcony size are **representative
approximations, not surveyed**.

## 3. Water side (orientation)

The captain's baseline GPU capture fixes the QCYC basin on the clubhouse's **local −v** side (camera 1290,4,2120 looking
1255,3,2126 is the water view; 1222,5,2145 is landward). The native wing `[-2.2,18.8,-8.5,-3.5]` protrudes toward the
water (−v). This is recorded as `appearance.waterV = -1` on the reviewed profile. **There is no runtime water detector**:
the profile is already gated by the committed footprint fingerprint and the exact projection, so any other frame or a
moved/reshaped row receives no profile and therefore no balcony.

## 4. What was changed (bounded)

`tools/build-island-buildings.mjs`:

- New `REVIEWED_CLUBHOUSE` entry (row 32139, OSM 43805118, `nativeFp`, `nativeHeight 9.4`, `levels 2`, `waterV −1`),
  re-checked with `reviewedClubhouse()` — fails closed on any drift (massing edition, OSM binding string, footprint
  signature, native height). It is **not** a general rule.
- `MARINA_APPEARANCE.clubhouse` (white cladding / trim, dark roof, `waterV −1`). `applyClubhouseAppearance()` copies the
  appearance onto the row's ordinary classification. **Base height, kind and roof metadata retain their classified values** (6.5 m from
  OSM levels 2, no invented OSM pitch).

`js/buildings.js` (its own batched draw + shared batches; no per-mesh):

- `Buildings_MarinaClubhouse` — one facade draw (`createMarinaClubhouseMaterial`, two window bands at
  `floorHeight = 2.55 m`).
- Two-storey proportions: eave `5.15 m` (`marinaClubhouseWallHeight`), so **two window bands sit below the eave** and the
  **shallow roof remainder is ~1.35 m**, all inside the unchanged 6.5 m total (the collider maxY).
- A capped hip roof over **every** part of the L plan (the wing is roofed, not left a grey cap); each apex is clamped to
  ≤ 6.5 m.
- A **projecting** balcony ledge and railing, below the eave, on the **exposed water (−v) frontage only**: from the
  union of native parts it takes the outermost water-side `v` per `u` interval and places rails only on the exposed runs
  (`[-18.7,-2.2]` at `v −3.5`, `[-2.2,18.8]` at `v −8.5`) — so **no rail is buried inside the other part**. It **projects
  past the wall** (not inside the mapped footprint, not walkable); the collider stays the native mapped footprint.
  Railing posts are pitched at a representative ~1.9 m (not a fixed count across the whole wall) and read in the
  off-white trim, not black metal. The railing reuses the instanced trim draw; the roofs join the shared hipped-roofs batch.
- Glazing: `windowRatioX 0.62` gives a representative ~1.18 m opening (wide-glazing rhythm) in two storeys.

`js/waterfront-island-buildings-data.js` is regenerated (332 matched rows; `clubhouseAppearances: 1`). Everything else
is byte-identical to the prior file apart from the clubhouse record and the new summary fields.

## 5. Verification (focused, no full suite / GPU / server)

```sh
node --test tests/waterfront-qcyc-clubhouse.test.mjs
node tools/audit-qcyc-clubhouse.mjs
node --test tests/waterfront-island-building-outliers.test.mjs tests/waterfront-island-buildings.test.mjs
```

`tests/waterfront-qcyc-clubhouse.test.mjs` proves: exactly one row carries the appearance (and the water side is −v); the
reviewed-profile gate refuses a reshaped footprint and a moved centre (fail closed → no clubhouse facade elsewhere); the
wall height holds **two storeys** and the roof remainder is shallow (not one storey + a big roof); every L part is roofed
and every apex ≤ 6.5 m; the frontage is exactly the two exposed water-side segments; every balcony/railing sample lies
**outside** the native footprint union, projects past the wall and stays below the eave, with none on the landward face;
and the shed/storage height, footprint and appearance are unchanged.

## 6. Known limits (honest)

- **Representative, not measured.** White cladding, dark hip roof, two-storey band heights, bay count and balcony depth
  are photo-informed approximations; none is a surveyed dimension. The native footprint and 6.5 m height are unchanged.
- **Image age unknown.** The hero's acquisition date is unknown; the orthophoto is 2024. Not a current survey.
- **Balcony is decorative.** It projects past the wall for silhouette fidelity only; there is no walkable surface and no
  change to the collider.
- **Orientation is source-pinned, not detected.** `waterV = -1` is the captain-verified fact for this row; there is no
  generic water-side detection for any other building.

No `main.js`/controllers/camera/explore edits, no dev-server restart, no GPU run, no full suite, no commit.

The final renderer omits generic random satellite dishes, AC units and fire escapes on this reviewed clubhouse.
It still consumes their random draws before omitting them, preserving the layout of unrelated buildings.
Reference images were archived outside the repository; no source photo is shipped.

## Accepted checkpoint — 2026-11-10

Matched baseline `wave7-clubhouse-before` and final `wave7-clubhouse-final` desktop views were inspected against the
official aerial. Final desktop and phone `wave7-clubhouse-phone` each passed four views/checks. Runtime verifies
one two-part clubhouse facade batch, exactly the original two footprint colliders, 6.5 m collider height and the
reviewed water-facing side. The phone run uses 412×915 CSS pixels, DPR 2.625, low quality.

Focused clubhouse/marina tests: **17/17 pass**. Final full suite: **1,100 total, 1,097 pass, 0 fail, 3 skip**
(`$WATERFRONT_RESEARCH/wave7-clubhouse-final-full-tests.log`). Syntax and diff checks pass. These captures establish
visual/function behavior, not a performance budget. Known `/live/vehicles`404 is unchanged.

Only the white two-storey character, roof type and waterfront detailing are source-informed; individual bay counts,
exact doors, balcony size and roof pitch remain representative or unmodelled. No surveyed reconstruction is claimed.
No commit, push, deployment or development-server restart.
