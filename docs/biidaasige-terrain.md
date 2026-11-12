# Biidaasige Park: current terrain, river and native-data compatibility audit

> **Later integration note (2026-11-10):** This document records the original native-data audit, before the park layer was integrated. Its unresolved-building and missing-path findings are historical. Every one of the nine candidate rows was subsequently inspected at its own georeferenced centre in the City 2025 orthophoto; the source decisions are in `tools/fixtures/biidaasige-native-identities.json`. Seven obsolete rows are individually keyed out, and the old Fire Hall / crane rows are replaced only after their source-located models build successfully. No water polygon is suppressed. The separate source-clipped path network is now rendered by `js/biidaasige-paths.js`. The native datum remains flat outside the real triangle surfaces supplied by the park layer; the promontory and general bank relief remain unfinished. See [live integration](biidaasige-park.md#live-runtime-integration-2026-11-10).

Audit · 2026-11-10 · bead **st-bmyv.2** (parent st-bmyv; inventory st-bmyv.1) · records **what the committed Toronto
geodata currently carries** over **Biidaasige Park** (Ookwemin Minising, formerly the Lower Don Lands / Port Lands), and
**what is still uncertain**. This is a **read-only CPU audit**: it changes no shared runtime (`city-grid.js`,
`city-config.js`, `controllers.js`, `main.js`, `explore.html` untouched), deletes nothing, suppresses nothing, and
approves no replacement data. Its one new data file is a neutral, read-only inventory of the **current** committed
features (park ring, the water rings the data already draws inside the park, the `zone:*` land that overlaps it, the
building **candidates** inside it, and the two river centrelines) — never a guessed rectangle, never a deletion list.

> **This audit distinguishes measurement from interpretation.** Every number below is measured from the committed
> binary; every *conclusion* is marked with its uncertainty. It does **not** claim the water geometry is stale, that the
> in-park buildings are obsolete, or that the real park is flat.

Reproduce every number here:

```sh
node tools/audit-biidaasige-ground.mjs             # JSON report + a text summary
node tools/audit-biidaasige-ground.mjs --json       # machine-readable only
node tools/audit-biidaasige-ground.mjs --emit-data  # rewrite js/biidaasige-ground-data.js from the committed geodata
```

It decodes the **same two packed files the page loads** — `data/toronto-geodata.bin` (the *detail* frame) and
`data/frames/eglinton/toronto-geodata.bin` (the default desktop frame) — through the page's own decoder
(`js/geodata-loader.js`, `decodeGeo`), never a guessed source. It cross-checks the park ring and surrounding land against
the raw Overpass cache (`~/.cache/slop-toronto/osm/osm_land.json`) when present, and reads the inventory worker's current
OSM extract under `$WATERFRONT_RESEARCH/biidaasige/inventory/`.

## 0. Summary: what is proved, and what is not

**Proved (measured from the committed binary):**

- The committed geodata **has the park** as a named `park` area; its ring is the **same ring current OpenStreetMap
  carries** (way/813717630, opened 2025-07-19), vertices within **0.82 m** (mean 0.12 m).
- Park **ring** box: world **x 1700…2963, z 303…944**, WGS84 **43.6415…43.6503 N, −79.3571…−79.3443 E**. Ring area
  **309,906 m² ≈ 76.6 acres**. **Caution:** 76.6 ac is the *ring* the data carries, which includes water (the river and
  wetlands) and later-phase land — it is **not** the same as the ~60 acres of park *opened* by 2026. Do not conflate them.
- **Both** the detail and the Eglinton frames **cover the park** and carry it identically (Eglinton shares the detail
  projection).
- The **new renaturalised Don River is present**: the committed **Don River** centreline already swings its south end
  west into the park to about **(1765, 912)** — this is the new mouth, not the old straight channel.
- **Water polygons are drawn inside the park** (the new river and wetland coves): four polygons totalling **111,373 m²**
  whose vertices fall inside the ring. Sampling the game's own water mask over the footprint gives **≈22.9 % wet** (a
  *fraction of samples*, not a defect count).
- **9 City 3D-Massing building rows** have their centroid inside the park ring (tallest 26.1 m).
- `zone:*` land the committed data keeps **overlaps** the park ring (`brownfield` 74,332 m², `construction`
  "Lower Don Lands Redevelopment" 39,462 m²).
- The **native runtime ground is flat** (street datum y = 0) and the Don Valley terrain pilot's box
  (x 1600…2800, z −3800…−1880) does **not** reach the park (z 303…944), so the two do not interact.

**Not proved / uncertain — do not act on these as if settled:**

- **Water inside the park is expected, not evidence of stale geometry.** The new river and wetlands *are* park features.
  The audit found **no exact pre-2025 "old channel" polygon** whose removal would be correct; the committed water looks
  like the current river/wetlands. **No demonstrated river bug.** Each structure still needs its **own** water-clearance
  check at its own footprint; the 22.9 %/111,373 m² totals prove nothing about any individual prop and are **not** a
  reason to mask water or publish a water suppression list.
- **The 9 in-park buildings are candidates, not proven obsolete sheds.** At least one is native to the park — the old
  **Fire Hall** at world ≈ **(2384, 622)** (current OSM shows the relocated Fire Hall near 2390.9, 645.9) — and one near
  the **Atlas Crane** vicinity (≈1998, 782). Each needs its **own** source identity and a 2025/2026 photo before any
  judgment. Height alone proves nothing. **No broad 9-building suppression.**
- **"Native ground flat" ≠ "the real park is flat."** The primary MVVA flood-protection design
  (<https://www.mvvainc.com/projects/port-lands-flood-protection2>) puts a **~9 m western promontory** in the park, plus
  badland levels and ramps. The committed runtime base is flat; the **actual** park has real relief. A future build would
  need a **walkable triangle mesh** of that relief — the flat native base is *not* evidence that no height work is ever
  needed.
- **`zone:*` classification inside the park may be spurious**, but it must be checked against the **actually rendered
  ground/blocks** before re-tagging: the polygons also include land **outside** the park (still-active industry). Keep
  future-phase/brownfield projects separate from the opened park.

**Net for the captain:** the park ring, frame coverage and the new river are in place; there is **no proven
deletion/suppression to make**. The open work is **per-feature verification** (each structure's water clearance and each
in-park building's identity vs. a photo), plus an **actual-relief walkable mesh** decision — all later, with exact source
corrections only.

## 1. Frame coverage and native geometry state (measured)

| | detail frame | eglinton frame |
| --- | --- | --- |
| `GEO.frame.detail` box | x −7900…3700, z −3000…3600 | x −7900…9600, z −7300…3600 |
| projection | lat0 43.6453, lon0 −79.3806, kx 80682.47, ky 111105.32, θ −0.28950 rad | identical (Eglinton is the detail projection, a superset) |
| covers the park audit box (x 1500…3150, z 150…1150) | **yes** | **yes** |
| `park` area named "Biidaasige Park" | **yes** — 133-pt ring, 309,906 m², ring 76.6 acres | **yes** — identical ring |
| `streams` through the audit box | Don River (89 pts, width 14), Keating Channel (10 pts, width 14) | identical |

Both frames agree on the park (Eglinton shares the detail projection and the same committed features there). A
Biidaasige module guarded on "does the active `GEO` carry this ring" builds in both and in neither elsewhere — the
`js/waterfront-beach-ground.js` frame-guard pattern. **The park ring is current:** `osmCrossCheck.ringMatch` = mean
0.12 m, **max 0.82 m** deviation of the OSM way's vertices from the committed ring (way/813717630,
`opening_date=2025-07-19`, `operator=City of Toronto`, `wikidata=Q135583813`).

**Ring area vs opened acres.** The data's ring is **76.6 acres (309,906 m²)** and **includes the river/wetland water and
later-phase land**. The park **opened ≈60 acres** (≈50 in 2025 + 10 in 2026) with **5 future acres** (Waterfront Toronto:
60 now, +5 future). These are different measures; **do not equate them**.

## 2. Water (recorded; water-in-park is expected)

**The new river is present.** The committed **Don River** centreline ends its south run at about **(1765, 912)** — swung
west into the park, the renaturalised mouth — and the **Keating Channel** centreline runs its straight dredged line
(10 pts, (2745, 197)→(1679, 504)). The game's water *polygons* inside the ring (measured, `waterRingsInPark`):

| Water ring inside the park | area (m²) | what the current data draws |
| --- | --- | --- |
| 172-pt polygon, world bbox 1758…2794 / 192…944 | **88,172** | the renaturalised **Don River mouth / spillway** |
| 37-pt polygon, bbox 2255…2492 / 706…848 | **5,847** | the south **wetland** (OSM way/1352429165) |
| 16-pt polygon, bbox 2156…2260 / 711…756 | **2,453** | the small **wetland/pond** (OSM way/1370683359) |
| 36-pt polygon, bbox 2789…2902 / 673…881 | **14,901** | the east river/cove arm |
| **total** | **111,373** | — |

Game water-mask sampling over the park footprint at 8 m spacing: **1,110 / 4,847 ≈ 22.9 % wet** — a fraction of samples,
**not** a defect count. **Interpretation (uncertain):** these are the park's own new river and wetlands; they are
**expected**, not stale. The audit found **no exact old-channel polygon** that provably should be removed — the committed
water matches the current renaturalised river. **Therefore there is no demonstrated river bug, and no water polygon is a
suppression candidate.** Any structure still needs an individual **footprint water-clearance** check (is *this* prop's
ground dry at *its* coordinates?), independent of these totals.

Also present near/inside the park: **West Habitat Cove** (OSM wetland way/1013210804, ≈ world (1738, 623)) and
**Canoe Cove** (OSM node/10893913022, ≈ world (1899, 774), a point, not a polygon).

## 3. Buildings in the park (candidates, not proven obsolete)

**9 City 3D-Massing rows have their centroid inside the ring** (probe `buildingsInPark`, field
`buildingCandidatesInPark` in the data). Recorded as **candidates**; **no building is judged obsolete here**:

| x | z | height (m) | note (uncertain) |
| --- | --- | --- | --- |
| 2678 | 630 | 26.1 | largest; identity to verify |
| 2848 | 624 | 12.6 | identity to verify |
| 2887 | 756 | 12.1 | identity to verify |
| 1781 | 758 | 11.3 | west edge; identity to verify |
| 2189 | 885 | 10.4 | identity to verify |
| 2384 | 622 | 8.4 | **old Fire Hall** (native to the park; current OSM relocated ≈2390.9, 645.9) |
| 2487 | 687 | 4.3 | identity to verify |
| 2422 | 608 | 3.6 | identity to verify |
| 1998 | 782 | 3.1 | **near the Atlas Crane** vicinity |

At least the Fire Hall is a **real, native** park structure and a crane-adjacent base near (1998, 782) is plausibly
equipment, not a shed. **Each** row needs its own source identity (City permit / 3D Massing record / construction photo)
and a **2025/2026 photo** before any decision. **No broad 9-centre suppression is approved; the count proves nothing
about "all obsolete."**

## 4. Land cover over the park (recorded; classification may be spurious)

Land cover that **overlaps** the park ring (measured; `zoneAreasOverlappingPark` in the data):

| land over the park footprint (non-water) | area (m²) |
| --- | --- |
| `zone:brownfield` (unnamed) | **74,332** |
| `zone:construction` "Lower Don Lands Redevelopment" | **39,462** |
| `park` (small in-park pieces incl. "Event Lawn") | ≈ 21,000 across pieces |
| `scrub` | 2,232 |

**Uncertain:** whether these `zone:*` polygons actually render as non-park ground **inside** the opened park, or cover land
**outside** it / still-active industry. This must be verified against the **actually rendered ground/blocks** before any
re-tagging. **Keep future-phase/brownfield projects separate** from the opened park. (The build keeps `zone:*` only above
20,000 m², and the raw Overpass source still carries 12 `zone:*`/related areas near the park — an **inventory**, not a
verdict; `osmCrossCheck.zoneAreasNearPark`.)

## 5. Ground height (native flat ≠ actual flat)

**The native runtime ground is flat** (street datum y = 0) and the Don Valley pilot box does not reach the park — so no
terrain pilot currently shapes it and *in the committed runtime* a prop grounds at y = 0. **But the real park is not
flat:** the primary MVVA flood-protection design puts a **~9 m western promontory** in the park, plus **badland levels and
ramps**. So:

- **Flat native ground** (a fact about the current runtime) is **not** "the park is flat" (a false claim about reality);
- a future faithful build needs an **actual walkable triangle mesh** of the promontory/badlands/ramps — this audit does
  **not** create that mesh and does not claim the park needs no height work.

## 6. Paths and the west cove (parity gap, not a standing blocker)

- The park has **> 5 km of trails** (inventory `trailNetwork`); the committed geodata has only **3 generic `parkPaths`
  runs** crossing the box. The named park paths (`Biidaasige Park Main Path` way/1352429162, `Don Greenway Trail Loop`
  way/1414354033) are **not** in `GEO.parkPaths`. So "preserve existing paths" currently means "don't cut the 3 generic
  paths"; the real path network is **not yet present** (a parity gap to fill from exact source, not a guessed line).
- **West Habitat Cove** (wetland, ≈ world (1738, 623)) and **Canoe Cove** (point, ≈ world (1899, 774)) are present as
  current features.

## 7. Integration seam (proposed, NOT implemented, NOT approved)

Nothing in shared runtime is changed or approved. **When** the captain decides to act, the safe shape is a
**frame-guarded data overlay** like `js/waterfront-beach-ground.js`, built on **exact source** (not a rectangle) and on
**per-feature verification**:

1. `js/biidaasige-ground-data.js` (this audit) already holds the **read-only inventory**: `parkRing`,
   `waterRingsInPark`, `zoneAreasOverlappingPark`, `buildingCandidatesInPark`, `rivers`. It is explicitly **not**
   replacement data and **not** a suppression list. Regenerate any time with `--emit-data`.
2. Any future module reads that inventory **only after** each feature is confirmed against its own source and photo —
   keeping the new river/wetlands (park features), identifying each candidate building individually, and re-tagging
   `zone:*` only where the rendered ground proves it. It must preserve the existing 3 generic paths and the bridges.
3. Hook points, **for the captain to choose later** (not touched here): an `applyBiidaasigeGroundMask?.()` call in
   `js/city-grid.js`'s material setup (like `applyWaterfrontBeachGroundMask`), and a build-time building filter in
   `js/buildings.js`. Both are shared runtime owned by others.

## 8. Per-zone status (facts + open verification)

| Zone | Measured state | Proven blocker? | Open verification before any change |
| --- | --- | --- | --- |
| Park ring / frame coverage | ✅ 76.6 ac ring, = OSM way/813717630, both frames | none | none |
| New river / wetlands | ✅ present; 111,373 m² water rings in park, 22.9 % wet samples | **no** — expected park features | per-prop footprint water-clearance check |
| East park buildings | ⚠️ tall candidates (26.1 m etc.) inside the ring | **no** — identities unknown | per-building source identity + 2025/26 photo (1 is the Fire Hall) |
| West edge / cove | ⚠️ West Habitat Cove wetland at (1738, 623) | **no** — a park feature | confirm cove's water level |
| Paths | ⚠️ 3 generic `parkPaths`; named trails absent | **no** | add exact path geometry from source |
| Native ground height | ✅ flat (y = 0), no pilot overlap | **no** (native) | real park has ~9 m promontory/badlands → needs an actual walkable mesh if built |
| `zone:*` land cover | ⚠️ brownfield 74,332 + construction 39,462 m² overlap | **no** — may be spurious/outside/active | verify against rendered ground/blocks |

## 9. What this audit changed

- **New:** `tools/audit-biidaasige-ground.mjs` (read-only probe; deterministic — two runs byte-identical).
- **New:** `js/biidaasige-ground-data.js` (neutral read-only inventory of current features; nothing loads it).
- **New:** `tests/biidaasige-ground.test.mjs` (CPU test: data is exact-source, not a rectangle; water/zone recorded, not
  judged; buildings are candidates with no pre-judgment; counts match the committed geodata).
- **New:** `docs/biidaasige-terrain.md` (this file).
- **Not touched:** any shared runtime, the parent's `js/biidaasige-park-data.js` / `docs/biidaasige-park.md`, or the
  committed geodata. **No commit, no deploy; no deletion/suppression.** CPU tests only.

## 10. Sources

- Committed geodata: `data/toronto-geodata.bin` (detail), `data/frames/eglinton/toronto-geodata.bin`, decoded by
  `js/geodata-loader.js`.
- Current OpenStreetMap (ODbL), 2026-11-10: **way/813717630** (Biidaasige Park), way/1352429162 (Main Path),
  way/1414354033 (Don Greenway Trail Loop), way/1013210804 (West Habitat Cove), node/10893913022 (Canoe Cove) — from the
  inventory worker's `$WATERFRONT_RESEARCH/biidaasige/inventory/osm_geom.json`.
- Waterfront Toronto, [Biidaasige Park](https://www.waterfrontoronto.ca/our-projects/biidaasige-park): 60 acres now,
  +5 future; opened in phases (≈50 ac 2025, 10 ac 2026).
- **MVVA, [Port Lands Flood Protection](https://www.mvvainc.com/projects/port-lands-flood-protection2)**: the western
  promontory (~9 m), badland levels and ramps — the actual relief the native flat base does not model.
- City of Toronto, [Biidaasige Park](https://www.toronto.ca/explore-enjoy/parks-recreation/places-spaces/beaches-gardens-attractions/biidaasige-park/)
  (address the OSM way carries: 39 Commissioners Street).
- Prior art read for the seam, not edited: `js/waterfront-beach-ground.js`, `docs/don-valley-terrain.md`,
  `tools/build-geodata.mjs` (schema), `tools/geo-land.mjs` (classifier copied verbatim into the probe).
