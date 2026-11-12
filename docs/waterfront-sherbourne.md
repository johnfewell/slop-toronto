# Sherbourne Common public art (js/waterfront-sherbourne.js)

Source- and photo-grounded public art for **Sherbourne Common**, East Bayfront (Lower Sherbourne Street, both sides of
Queens Quay East; 1.47 ha, Lake Ontario to Lake Shore Blvd). Follow-up `st-sb3r.11`. This pass adds only the two
source-georeferenced art features missing from the city's massing, and does not duplicate what exists.

## Corrected silhouettes (from the coordinator's inspection of the official photos)

Earlier drafts modelled **wrong** forms (an upright glass rectangle for Light Showers; a 3.5 m square tube for the arch).
Corrected below from `research/light-showers.jpg` and `research/unfinished-arch.jpg`.

### 'Light Showers' — Jill Anholt (three elements, north side, equally spaced)
Each element is a **squared-shepherd-hook pair of broad leaning cantilever arms**, not an upright rectangle:
- a wide **CONCRETE** leg that leans across the channel and bends into a long **horizontal upper beam whose top is
  8.9 m** (the fact-sheet height);
- a second, lower, **rounded METAL-CLAD** leg that bends into a **horizontal spout beam at ~6 m**;
- thin **vertical suspension cables** from the upper beam down to the lower beam;
- a broad vertical **WATER curtain** falling from the lower beam into the **raised pool** (no opaque panel to the
  ground); it is **broad along X (the beam run) and thin along Z**, so its face reads from the oblique side view;
- the base is on the **SIDE of the long raised pool**, not mid-channel.

The photo shows the motif repeating along the channel. Elements are placed at the two mapped OSM nodes
(`node/3049761651` at world (1205.7, 335.3) and a second at (1191.5, 246.9)) and their **equal-spacing midpoint**
(1198.6, 291.1); spacing ≈ 44.8 m each. **The mapped POI node centres the art, not the leg base**, so each base is
placed at the channel's **west edge** (derived per node from the mapped water polygon) — recorded offsets ≈ 3.0 / 4.1 /
5.1 m west of the nodes; the arms then cantilever east across the channel. They stand in/over the channel, so water at
the mapped node is expected.

Cross-section estimates read from the coordinator-marked photo (`SHOWER_PROFILE`): upper 1.3 m wide × 0.9 m thick,
reach 4.6 m; lower 1.1 m wide × 0.7 m thick, reach 4.0 m; 3 cables; curtain 1.1 m wide × 0.1 m thick; pool surface
0.4 m.

### 'Unfinished Arch' — Rafael Lozano-Hemmer (opened 1 June 2026)
A **SILVER reflective broad flat RIBBON (~2 m wide, ~0.4 m thick)**, not a square tube. One vertical foot rises,
curves round the apex (**9 m**), and leans down to a free tip whose **main edge is ~2.4 m above ground** (an adult
reaches overhead); a narrower **hanging touch piece (~1.8 m)** sits under it. It cantilevers **14 m** from a **single
ground point**. Modelled as **one continuous indexed swept ribbon mesh** (21 cross-section stations, shared vertices,
smooth normals, closed ends) — **no per-segment gaps or air seams** — plus the touch piece. The broad face normal is the
constant horizontal plane normal, so the ribbon reads broadside from an oblique side view.

**Site**: the southeast **lawn** of the south park, just north of the Water's Edge Promenade and west of the eastern
path/buildings (construction notice #4). The **38 × 30 m red box on the site plan is the construction fence, not the
sculpture footprint**; the base is an estimate on dry land inside the actual SE park corner (no surveyed claim).

## What it deliberately does NOT build (verified before adding)
- **Paul Quarrington rink / splash pad** — already modelled by `js/toronto-rinks.js` (City asset `43569`). Not rebuilt.
- **240 m water channel** — already in the geodata as water polygons and covered by `CITY.waterAt`; **no fake pit cut**.
- **Zinc Pavilion (Teeple)** — no mapped building exists in either park ring, so **not invented**.

## Geometry conventions
1 unit = 1 m; world x grid east, z grid south; ground y = 0. Park rings come from the loaded geodata **filtered by name**
(`GEO.areas`, `kind==='park'`, `name==='Sherbourne Common'`, split north/south by centroid z) — **never by index**. Call
`createWaterfrontSherbourne(THREE, scene)` → `{ group, colliders, stats }`; builds only when the frame covers the park;
deterministic; every instance matrix finite. One culling root; 7 instanced meshes (upper arms, lower arms, footings,
cables, curtains, arch ribbon, arch touch piece); `cullDistance`/`cullCell`. Cross-sections are swept as box segments
along the profile curves (parametric bent profiles).

### Unique guard
Exports **`waterfrontSherbourneSupported`** and does **not** define/export `supportedCityFrame`.

## Sources (retrieved 2026-11-09)
- Waterfront Toronto, Sherbourne Common: <https://www.waterfrontoronto.ca/our-projects/sherbourne-common>
- Waterfront Toronto, Sherbourne Common Fact Sheet (THREE 8.9 m sculptures; north side, equally spaced; 238.5 m channel;
  crossings A–E; pavilion at the 200 mm narrowest):
  <https://www.waterfrontoronto.ca/sites/default/files/documents/sherbourne-common-fact-sheet-1.pdf>
- Jill Anholt Studio, Light Showers: <https://www.jillanholt.ca/Light-Showers>
- Waterfront Toronto, Unfinished Arch opens (1 June 2026):
  <https://www.waterfrontoronto.ca/news/incomplete-design-rafael-lozano-hemmers-unfinished-arch-opens-at-sherbourne-common>
- Waterfront Toronto, Construction Notice #4 (9 m high, 14 m cantilever, southeast corner of the south park, single-point
  ground contact): <https://www.waterfrontoronto.ca/construction-notice-4-unfinished-arch-sherbourne-common>
- OSM: Light Showers nodes; park/channel geometry is the loaded City geodata (OpenStreetMap contributors, ODbL).

## Image references (inspected by the coordinator; not bundled)
- **Light Showers primary:** <https://www.waterfrontoronto.ca/sites/default/files/2023-08/DSC_5872-sherbourne-common_0.jpg>
- **Unfinished Arch primary:** <https://www.waterfrontoronto.ca/sites/default/files/2026-06/Unfinished%20Arch%20-%20Media%20Launch%20-%20June%201%2C%202026-1280.jpg>
- **Unfinished Arch site plan** (red box = construction fence): <https://www.waterfrontoronto.ca/sites/default/files/2026-01/Unfinished%20Arch%20Site%20Map%20V2_1280.png>
- Unfinished Arch southern view: <https://www.waterfrontoronto.ca/sites/default/files/2026-01/Unfinished%20Arch%20Southern%20View_1280.jpg>
- Sherbourne Common south lawn (pavilion + splash pad): <https://www.waterfrontoronto.ca/sites/default/files/styles/contextual_banner_sm/public/2022-05/2f.%20Sherbourne%20Common%20south%20lawn%20after-1300-crop.jpg>
- Light Showers artist page: <https://www.jillanholt.ca/Light-Showers>

## Estimated dimensions (explicit; unverified)
| Element | Source | Model |
| --- | --- | --- |
| Light Showers upper beam top | 8.9 m (fact sheet) | 8.9 m |
| Light Showers lower spout beam top | ~6 m (photo) | 6.0 m |
| Light Showers arm width/thickness, reach | photo (marked) | upper 1.3×0.9 m, reach 4.6 m; lower 1.1×0.7 m, reach 4.0 m |
| Light Showers base offset west of node | derived (channel west edge) | 3.0 / 4.1 / 5.1 m |
| Arch apex / cantilever | 9 m / 14 m (notice) | 9.0 m / 14.0 m |
| Arch ribbon width / thickness | photo | 2.0 m / 0.4 m |
| Arch free-edge / touch-piece height | photo | 2.4 m / 1.8 m |

## Uncertainty register
- **Light Showers**: two of three elements are individually OSM-mapped; the third is the documented equal-spacing
  midpoint. Exact cross-sections and the arm profile are read from the coordinator-marked photo (estimates). The base
  offset to the channel west edge is derived, not surveyed; the POI node centres the artwork.
- **Unfinished Arch**: the documented location is the SE lawn just north of the promenade and west of the eastern path;
  the base is an estimate on dry land (the site plan's red box is the construction fence, not the footprint). The ribbon
  profile/tip heights are read from the photo; the 9 m and 14 m dimensions are as published.
- **Pavilion**: intentionally not modelled (no mapped building). Rink and channel intentionally not rebuilt.
- **Image content**: photos are research references; the visual inspection was done by eye against them. Proportions are estimated from the marked photos, not measured drawings.

## Verification
- `node --test tests/waterfront-sherbourne.test.mjs` — 11 focused checks: the two park polygons resolve by name; **THREE**
  Light Showers (two exact OSM anchors + equal-spacing midpoint; equal spacing; inside the north ring); **bases on the
  channel's west edge with recorded offsets**; the **two-arm silhouette** (upper beam top 8.9 m, curved lower beam ~6 m,
  cables, water curtain, no old scrim/glass rectangle); the **ribbon arch** (2 m × 0.4 m, apex 9 m, ~2.4 m free edge,
  1.8 m touch piece, single ground contact, 14 m reach, curved profile); **all geometry finite**; no rink/channel/pavilion
  duplication; instancing + culling; unique guard; frame guard; sources/determinism; and exactly three elements.
- GPU captures: `tools/shots/waterfront-sherbourne.json` (street + aerial) on the Mac mini via `gpu2`, never the laptop.
  The two Light Showers acceptance cameras are close, on land, and oblique along the profile normal (view·Z ≈ 0.92) so
  the cantilever hook, cables and water curtain read; the arch street camera is on land and broadside to the ribbon
  (view·plane-normal ≈ 0.99).