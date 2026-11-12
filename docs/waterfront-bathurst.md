# Canada Malting Silos: the western BIA gateway

Source-backed massing for the Canada Malting Complex at 5 Eireann Quay (Bathurst Quay Common), the western Waterfront BIA
gateway the central/eastern realism wave did not cover (epic `st-sb3r`, bead `.12`). The runtime is
`js/waterfront-bathurst.js`; the tests are `tests/waterfront-bathurst.test.mjs`; the capture list is
`tools/shots/waterfront-bathurst.json`. This module owns only itself — `main.js` / `buildings.js` / `explore.html`
integration (calling the builder, consuming the exclusion hook) is the captain's.

Model evidence is source text and the committed geodata plus the OpenStreetMap relation; the module reads no image. The
**photo-form review was made by the captain, not this module's author** (this model cannot read images) and is recorded
in §3 as the basis for the headhouse / marine-leg heights and the concrete finish, which are therefore estimates.

## 1. What is built and where it stands

Every solid stands on a committed footprint: the two silo batteries on their OpenStreetMap relation rings, the
headhouses and the marine leg on the mapped `Canada Malting Silos` rows. Nothing is scattered in open space, and the
neighbouring Corleck Building is not claimed.

| Element | Footprint | Height | Source |
| --- | --- | --- | --- |
| **South silos (1929)** | OSM relation 21646938, way 43806399 (the scalloped ring) | **30.48 m** (100 ft) | City heritage report: 15 circular bins in three rows, **exposed cylinders** |
| **North silos (1944)** | OSM relation 21646938, way 1568011088 (the flat ring) | **38.1 m** (125 ft) | City heritage report: 14 circular bins in two rows, **concealed by flat walls** |
| 1929 headhouse | mapped row key `southHeadhouse` | **44 m** (photo estimate) | mapped row; photo-form review |
| 1944 headhouse | mapped row key `northHeadhouse` | **48 m** (photo estimate) | mapped row; photo-form review |
| Marine leg | mapped row key `marineLeg` | **55 m** (photo estimate) | mapped row; photo-form review |

The two batteries are drawn from the **real OpenStreetMap outer rings** (relation `21646938`, ways `43806399` and
`1568011088`, © OpenStreetMap contributors, ODbL, fetched 2026-11-09), embedded in the module as world-metre contours:

- The **south ring's eastern edge is a chain of arcs** — the exposed circular bins. The module locates the outermost
  point of each arc, derives the measured bin diameter from their mean spacing (≈ **7.9 m**), and lays the documented
  **3 rows × 5 columns = 15 touching cylinders** inward from the exposed face. Every centre is checked to lie inside the
  mapped ring, so no cylinder is a guessed free-yard object. The battery is capped by its **flat connecting roof**.
- The north ring is extruded as a **single flat-walled block**; the documented **2 rows × 7 = 14 bins** are concealed, so
  **no north cylinders are drawn** — only the count is reported. A thin top **clerestory row** of dark rectangular
  windows runs along the east and west facades.
- The **"CANADA MALTING CO. LIMITED" lettering** is placed on the north block's **east and west** facades (City heritage
  report: east side; ERA restoration: east and west), near the upper top, drawn into a canvas texture (browser) with a
  plain concrete-toned band as the Node/no-canvas fallback. A blank band is never used as the letters themselves.
- The **marine leg** carries its three square dark windows on the water (east) face.

## 2. Sources

Primary:

- City of Toronto staff report, "5 Eireann Quay – Intention to Designate under Part IV, Section 29 of the Ontario
  Heritage Act", 2009-03-10 —
  <https://www.toronto.ca/legdocs/mmis/2009/pb/bgrd/backgroundfile-19569.pdf>. The Reasons for Designation give the two
  silo heights (**100 ft / 30.48 m** and **125 ft / 38.1 m**), the bin counts and rows (**15 circular bins in three
  rows**; **14 circular bins in two rows**, flat walls concealing them), the headhouses and the marine leg, reinforced
  concrete construction, the 1929 John Metcalf south silos and the 1944 T. Pringle and Son / E.C. Miller north silos, and
  the "Canada Malting Co. Limited" lettering on the east side.
- ERA Architects, "Canada Malting Silo" — <https://www.eraarch.ca/projects/canada-malting-silo/>. The 2020-2024
  restoration of the two grain elevators (1929 and 1944) and the **signage lettering on the east and west facades**,
  within the new Bathurst Quay Common park.
- City of Toronto news release, 2024-10-04, "City of Toronto unveils Bathurst Quay Common: A new waterfront oasis" —
  <https://www.toronto.ca/news/city-of-toronto-unveils-bathurst-quay-common-a-new-waterfront-oasis/>. The opened park at
  the western harbour gateway, the restored heritage buildings and Ireland Park.

Geodata / mapped outlines:

- Committed geodata (`js/toronto-geodata.js`, and the default desktop frame `data/frames/eglinton/toronto-geodata.bin`):
  seven rows named **"Canada Malting Silos"** (detail `33097..33103`, eglinton `130964..130970`). Their City of Toronto
  3D Massing **LIDAR maxima are 50.6–65.6 m** — the tops of the marine leg and headhouses — and are **not** the
  measured silo-bin heights, so the bins use the heritage figures.
- OpenStreetMap relation `21646938` "Canada Malting Silos", ways `43806399` (south) and `1568011088` (north), ©
  OpenStreetMap contributors, ODbL — <https://www.openstreetmap.org/relation/21646938>.

## 3. Photo-form review (captain; the module author cannot read images)

The captain inspected the ERA restoration photograph (east across Portland Slip) and described: the **five exposed south
cylinders** under a flat connecting roof; a **narrow tall headhouse** with small vertical windows; the **flat 38.1 m
north block** in restored pale greige concrete with a **thin top clerestory row of dark rectangular windows** and the
**"CANADA MALTING CO. LIMITED"** lettering just below; a **very narrow marine leg (~55 m)** with **three square dark
windows**; faint horizontal formwork / weathering; **no industrial corrugation**; and the coast trees (a separate
inventory) left in place. Those are the forms implemented. The 44 / 48 / 55 m headhouse and marine-leg heights are
**estimates from that review**, since the heritage report measures only the silos.

## 4. Frames: detail vs eglinton (the default desktop map)

The default desktop frame is **eglinton** (`explore.html`), whose building table is a different size and order: the
silos are rows **130964..130970** there vs **33097..33103** in detail. The module resolves each row from its **stable
key** (mapped name + world centre + mapped height) in the active frame and caches the remap per GEO, so it never uses a
raw detail-frame index and can never suppress an unrelated building. The integration test loads the **real unpacked
eglinton bin** (`unpackGeo`) and a faithful **Mesh-returning** `createExtrudedPolygonMesh` shim, and asserts both the row
remap and the merge path (the city-grid helper returns a `Mesh`, so its `.geometry` is taken).

## 5. Integration (captain)

- The builder returns `{ group, colliders, stats }`; group name **`WaterfrontBathurst`**. `main.js` should call
  `window.CITY.createWaterfrontBathurst(THREE, scene)` after the city is built and push `colliders` into the landmark
  colliders (the same pattern as `waterfront-landmarks.js` / `waterfront-details.js`).
- To drop the generic City boxes under the silos, `buildings.js` should call
  `window.CITY.waterfrontBathurstExcludesBuilding(rowIndex)` in its building loop, beside the existing
  `waterfrontLandmarkExcludesBuilding` call. It resolves the active frame on its own (before the builder runs) and
  publishes `window.CITY.waterfrontBathurstExcludedRows`.
- **Runtime gate:** the replacement is optional — `window.CITY.waterfrontBathurstEnabled` (default true) or `?bathurst=0`
  disables both the build and the exclusion predicate (`setWaterfrontBathurstEnabled(false)` in code).
- Labels: `window.CITY.WATERFRONT_BATHURST` / `CANADA_MALTING_SILOS` carries `{ id, name, short, address, source,
  sourceUrls }` for `city-config.js` to register if desired.
- Culling: every mesh carries `userData.cullDistance` / `cullCell` (`scene-culling.js`) under one root group.

## 6. Captures

`tools/shots/waterfront-bathurst.json` (1600 × 900 default, `cinema` override cameras): from Ireland Park / Portland
Slip (the exposed east face), from Bathurst Quay Common, an aerial, from the lake, the marine leg, and the east lettering.
Run on the Mac mini through `gpu2` (never the laptop GPU):

```sh
GPU2_LOCK_WAIT=600 gpu2 waterfront-bathurst -- env \
  CAPTURE_QUERY='?quality=high&autoscale=0&transit=timetable&film&cloudSpeed=0&map=detail' \
  CAPTURE_PROGRESS=1 CAPTURE_TAG=wtb \
  node tools/capture.mjs tools/shots/waterfront-bathurst.json
```

Captures are functional/visual evidence, not a performance budget, and are the captain's to run and judge.

## 7. Uncertainty register

- **Silo-bin heights** are the heritage-measured 100 ft / 125 ft (30.48 / 38.1 m). The committed LIDAR maxima (50.6–65.6
  m) are higher because they include the marine leg and headhouses; they are not used for the bins.
- **Bin diameter** (≈7.9 m) is **OSM-measured** from the south ring's arc spacing, not a published figure; the north
  block's concealed spacing (≈7.4 m) follows the same 7-column split of its mapped length.
- **Headhouse and marine-leg heights** (44 / 48 / 55 m) are **photo estimates** (captain review); the heritage report
  does not measure them. Their footprints are the committed mapped rows, so the placement is source-backed.
- **Square / irregular south bins**: the heritage report names them; the module fills the ring end not occupied by the
  round bins with the mapped massing, and does not claim a surveyed plan for the square bins.
- **Lettering**: text and the east/west faces are from the sources; the glyph style, size and exact height on the wall
  are estimates. Mirroring of the text on the west face was not verified without a render.
- **Marine leg position**: anchored on the mapped `marineLeg` row (the narrow tall massing at the north block's water
  edge); it is not a separately mapped OSM footprint.
- The module's author could not inspect any photograph; every form attributed to the photo review is the captain's.
