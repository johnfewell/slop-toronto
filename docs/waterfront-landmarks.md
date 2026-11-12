# Waterfront landmarks: Queen's Quay Terminal and Redpath Sugar

Source-backed distinctive massing for the two Waterfront BIA landmarks whose silhouettes the generic City 3D Massing
flattens into anonymous boxes (epic `st-sb3r`, beads `.4` Queen's Quay Terminal and `.6` Redpath Sugar). The runtime is
`js/waterfront-landmarks.js`; the tests are `tests/waterfront-landmarks.test.mjs`; the capture list is
`tools/shots/waterfront-landmarks.json`. This module owns only itself — `main.js` / `buildings.js` / `city-config.js`
integration (calling the builder, consuming the exclusion hook, registering labels) is the captain's.

Model evidence is source text and the committed geodata, not images. The image URLs recorded here are references for the
coordinator to inspect; the module never reads an image and no pixel statistics were used.

## 1. What is built and where it stands

Every solid the module draws is a committed geodata footprint part. Components are located by a **stable key** (mapped
name + world centre + mapped height), not by row index, because the default desktop frame is **eglinton**, whose building
table is a different size and order from the detail map (see §4).

### Queen's Quay Terminal — 207 Queens Quay W (bead `.4`)

The 1926-27 Toronto Terminal Warehouse, by Moores & Dunford: the main storage building was **420 × 200 ft (128 × 61 m),
eight storeys**, one of Canada's largest buildings (poured concrete, rail sidings, 1,000,000 ft² of floor space). The
southwest **cold-storage wing was demolished** (it is Canada Square now) and is **not modelled**. In 1983 Zeidler Roberts
added **four residential levels on top of the original eight**, under a **green-patina metal roof** (like Union Station
and the Royal York), with **Art Deco entrances** and the historic **clock tower**, for a total **43 m**. Source:
[Wikipedia, Queen's Quay Terminal](https://en.wikipedia.org/wiki/Queen%27s_Quay_Terminal); the addition is described in
the [CMHC case study NH17-253/1997](https://publications.gc.ca/collections/collection_2022/schl-cmhc/NH17-253-1997-eng.pdf).

The module stands on the committed "Queen's Quay Terminal" rows (the mapped neighbourhood takes a family of named rows):

| Element | Committed footprint | Modelled from |
| --- | --- | --- |
| Warehouse block | 140 × 61.4 m, **31 m**, long axis on the harbour | the mapped row, as a **simplified rectangle** (the geodata's own shape; not a survey drawing) |
| 1983 addition | three mapped parts at **43 m**: two long perimeter bands (~120 / ~112 × 10 m) + an end band (~11.5 × 24 m) | the mapped parts **as they split**, enclosing an **open courtyard / lightwell** — NOT one inset box |
| Penthouses / stair cores | small ~5-7 m mapped structures at 43-46 m | their mapped centres |
| Green-patina cornice | — | a band at the warehouse eaves (period detail) |
| Art Deco entrances | Queens Quay (north) face | three entrance piers (period detail) |
| **Clock tower** | the mapped rooftop structure nearest the north face (row 33212 in detail: x -188.9, z 679.4, 46 m) | genuine QQT (see §3): ribbed cream shaft, flat stepped parapet, two black round clock faces, flagpole — **no pyramidal cap** |

The strong reads are the long lakefront warehouse face along the harbour and the set-back residential bands with the open
courtyard between them; the clock tower marks the north (Queens Quay) frontage.

### Redpath Sugar Refinery — Queens Quay E at Jarvis St (bead `.6`)

Opened 1958: **Building 1 (eight floors)**, a **chimney stack**, **Building 2 (five floors, the museum)** and the **Raw
Sugar Shed** that stockpiles each fall's cane, whose **north face carries the Wyland whale mural** and whose **west side
carries the "Redpath Sugar" sign**; raw sugar arrives by freighter alongside the quay. Source:
[Wikipedia, Redpath Sugar Refinery](https://en.wikipedia.org/wiki/Redpath_Sugar_Refinery);
[waterfront view](https://commons.wikimedia.org/wiki/File:Waterfront_view_of_the_Redpath_Sugar_Refinery.jpg);
[shed and freighter](https://commons.wikimedia.org/wiki/File:RedpathSugarRefinery3.JPG).

The refinery stands on the committed `zone:industrial Redpath Sugar Refinery` zone. The module claims **every large
mapped structure inside that zone** — not only the named halls — because the wave-3 acceptance capture showed the
unclaimed annexes as the "huge blank tan generic boxes" the user rejected. All are real mapped plant (rows
34614–34623); their footprints are the committed rows, never synthesised. The module builds:

| Element | Placement |
| --- | --- |
| Mapped halls + annexes | every mapped part of rows **34614** (long 166.8 × 47.4 m hall), **34623** (L-plan raw-sugar shed), **34619 / 34622** (tall plants), the annexes **34615, 34617, 34618, 34620, 34621**, and the quay utility tower rows **34612 / 34613**, each mapped part extruded to its mapped height |
| **Big raw-store pitched roof (wave-6 correction)** | the major long hall **34614** is now `kind: 'rawstore'` and gets a **large steep gable roof** on its exact mapped footprint. The captain's primary crane photo shows this large pitched roof directly behind the green unloader on the Jarvis Slip; the classification is a **photo/geospatial inference, not a text-confirmed building-function record**. The mapped **16 m total height is kept as the ridge**; the walls rise only to the eaves (~6.0 m) and the gable fits under it, so no roof is stacked above the known height. The rise (~9.8 m) is an explicit **estimate** from the photo width proportion (`min(0.42 × half-depth, 0.62 × total)`). The small 34623 shed keeps its pitched roof under the same height rule; the tall process blocks keep flat caps |
| **Roof complexity** | pitched roofs carry a light-metal **ridge cap**, both **eave fascias**, and **corrugated seam ribs** up both slopes at ~4 m pitch (one merged roof mesh). The roof is **weathered light metal** (low metalness, neutral grey), not a blue reflective surface |
| **Quay utility tower** | rows **34612 / 34613** (two stacked 7.0 × 6.2 m rows, h 22.5 / 21.5) are claimed and modelled as a plain concrete/metal industrial shaft with dark vertical seams, pale banding and a dark cap — **no window grid**, so the generic residential shader cannot make it a "condo". Its function (connector/elevator/utility) is **unresolved**, and it is **not** labelled a chimney |
| **Material segmentation** | separate merged materials instead of one shell: **pale-grey brick** `..._Halls` (base `0xa7aaa4` with a TSL running-bond course/head-joint/weathering colorNode — see §1b), light-grey corrugated `..._ShedWalls`, weathered light-grey `..._Roof`, pale-grey `..._Trim` (parapets + pilasters), dark `..._Plinth`, dark-glass `..._Windows`, gray `..._Hoods`, gray `..._PipeRack` |
| **Structural bays** | pale pilaster ribs at ~9.5 m centres on the long ±v faces of every solid process block; **windows only on the lower two storeys** (no full-height office grid) plus **sparse gray metal hoods/vents** (one band, 2–5 per long face) |
| **Pipe / rack assembly** | a prominent pipe/rack assembly on the tall plant's north face, between the tall process blocks (3 posts on the ground + 3 pipe runs); a source detail from the BIA photo |
| **Corrugated shed cladding** | vertical light-grey ribs at ~3 m centres on every mapped face of the shed/annex walls (410 ribs at the detail frame, including the long raw store) |
| Whale mural (north face) | a **plain muted-blue plate** on the shed's **north (−u)** face. The location is sourced; the Wyland artwork itself is **not** reproduced |
| "REDPATH SUGAR" sign (west face) | **one line of red/burgundy raised block capitals** set directly on the **tall plant's west (−u)** pale-brick wall near the top, with **transparent** ink so the brick shows through (a `CanvasTexture` drawn at build time, no runtime fetch). No signboard, cream lettering, border or second line |
| **Ship unloader** | a **bright-green articulated hydraulic material handler** (Sennebogen-type) standing on the dock at the zone edge that **actually abuts the mapped "Jarvis Slip" water polygon**; its articulated boom reaches out over the slip. Not a generic yellow gantry/cable crane |

**Sign / face correction (wave 6).** The captain inspected the primary photos
(`acotoronto.ca/.../RedpathSugarRefinery4.jpg`, saved `research/redpath-west-sign.jpg`) and **rejected** the wave-3
invented art direction: there is **no maroon signboard, no cream lettering, no border and no two-line layout**. The real
sign is **one line of red/burgundy raised sans-serif block capitals, "REDPATH SUGAR", on a pale-brick wall near the
top**, with three shallow vertical seams and significant whitespace below. The sign is anchored to the **tallest mapped
plant part** (34622, 28 m; the photo shows a tall plant, not the shed), whose mapped **−u** normal points **west (−x)**.
The shed's own **−u** normal points **north (−z)**, where the whale mural sits. A second BIA photo shows a red **cursive
underlined "Redpath"** logo on another pale wall; that facade is not confidently matched to a row, so it is reported
**unresolved** rather than placed by guess.

The handler's identity (from the manufacturer photos below): a **bright-green articulated boom + stick**, a **counterweight
opposite the boom**, a **white grille machinery box**, a **projecting tinted-glass cab**, all on a **black cylindrical
pedestal** above a **dark-grey A-frame wheel gantry**. Source figures: cab ≈ **30 ft (9.1 m) above the dock**, reaches
≈ **19 ft (5.8 m) from the swing centre**, dock ≈ **30 ft (9.1 m) wide**, **20 ft² hopper**; the photo is dated 2012.
Proportions beyond those are estimates. Source photos (coordinator-inspected):
<https://sennebogen-na.com/wp-content/uploads/2012/07/IMG_9451-1.jpg> and
<https://sennebogen-na.com/wp-content/uploads/2012/07/IMG_9453-1024x768.jpg> (saved as `research/redpath-crane-wide.jpg`,
`research/redpath-crane.jpg`).

**Reported unresolved (not invented):** the **barrel-silo battery** and the **chimney stack** are described in the source
but have **no mapped footprint** in the committed geodata and no verifiable position this text model can confirm from a
photo. Per the realism rule ("do not invent placements") they are **not built** and are listed in
`layout.redpath.unresolved`. If a mapped structure that anchors them is later identified, they can be added on it.

### Geography correction

Canada's Sugar Beach is **east** of the refinery, across the mapped **Jarvis Slip** water polygon (Jarvis Slip centroid
≈ world 883, 519; Redpath zone centroid ≈ 722, 512; the slip ring runs from x 834 east). The refinery therefore reads
from Sugar Beach across that slip. An earlier internal note that placed the slip to the west was wrong; the module uses
the actual mapped water polygon, so no code depended on the error.

## 1a. Facade material and articulation (GPU wave-3 fix)

The first GPU capture showed the QQT warehouse as a near-black uniform facade with generic windows, and the rooftop
additions and the Redpath halls as blank white shells. Two causes and the fixes:

- **Black/blank walls**: the facade skin's per-instance `paint` attribute was omitted, so the rendered-facade shader read
  its `paint` default (0,0,0,0) and drew the wall near-black; the big extruded shells were a single flat albedo, so
  uncovered surfaces read as featureless white. Every skin box now carries a real `paint` (linear rgb + style w; `w < 1.5`
  = render, `w ≥ 2` = brick) and the shells use warm weathered base colours instead of pale white.
- **Articulation**: the module now uses the repo's bounded, shared facade system — `createRenderedFacadeMaterial` +
  `createFacadeBoxes` (instanced boxes with per-window shader bands; **no per-window objects**), one instanced mesh per
  material:
  - QQT **warehouse**: warm cream render, tall warehouse window bays (the source's cream piers + dark rectangular windows;
    `wrap` 3.2 m window / 4.2 m floor).
  - QQT **addition bands**: lighter render, regular residential punched-window bands (2.0 m window / 3.0 m floor).
  - Redpath **halls**: this wave-3 note is superseded for the refinery by the wave-6 pass (§1, "Sign / face correction"):
    the captain's photos show **pale cream/white brick with sparse industrial openings**, so the Redpath facade shader is
    **removed** and replaced with explicit pale-brick fields, lower two-storey window bands, gray metal hoods, pilaster
    bays and a pipe/rack assembly. The sloped sugar-shed roof stays its **own light-grey** mesh (`..._Redpath_Roof`),
    separate from the walls.

The skins are all thin volumes on the exact mapped footprints (proud ~0.035 m) and share one instanced mesh per material;
the merged shells carry the roof, clock, cornice, gable and entrances.

### Residual generic buildings (reported to the captain, not suppressed)

With the QQT-named rooftop slivers (rows **33207, 33208**), the five Redpath annexes and the quay tower rows
(**34612 / 34613**) now claimed, the remaining nearby generic structures are **separate buildings**, not duplicates of
the two landmarks, so they are intentionally **not** excluded:
- Near QQT, along the harbour edge: unnamed rows **33213, 33214** (43 × 4.4 m, h10, lakefront side) and the small
  **33215–33221** cluster — these are not named "Queen's Quay Terminal" and have no source tying them to the terminal.
- Inside the Redpath zone: the only unclaimed mapped row is **34616** (5.4 × 4.0 m, h3), a tiny low block; it is left as
  native geometry rather than invented into machinery. The source-described stack and silo battery still have no
  verifiable mapped footprint.
If the captain has source evidence that 33213/33214 belong to the terminal, add their keys and they will be claimed the
same way.

## 1b. Plant wall is real pale-grey brick, not a washed-white shell (GPU wave-7 fix)

The wave-6 GPU review of the west-sign frame came back a blank white wall with no lettering. Part of that was the camera
(§1c), but the plant skin itself was also reading as a **featureless near-white shell**: the `..._Redpath_Halls` material
was a flat `MeshStandardMaterial` at `0xd6cfc0`, and under the midday sun it washed out with no visible joint or course.

The plant wall is now built as **pale-grey brick**, base colour **`0xa7aaa4`** (the captain's target, from the BIA photo's
light grey brick with noticeable joints — clearly darker than the old near-white). On the WebGPU path the wall's material
is a `MeshStandardNodeMaterial` whose `colorNode` is a TSL graph keyed to the extruded wall's own metre-scale UVs
(`u` = metres along the wall, `v` = metres up from its foot — the `ExtrudeGeometry` uv contract):

- **Fine source-photo brick (not cinder blocks)**: the captain's close inspection of the west-sign photo shows very
  subtle brick coursing, so the running-bond beds are **~0.08-0.10 m** high and the bricks **~0.24-0.30 m** long (default
  `0.095 × 0.27 m`), with a **~8 mm** mortar joint — the old 0.28 × 0.62 m blocks read as oversized high-contrast
  cinder block and are removed. Every alternate course is staggered by half a brick. The joint lines are
  **filter-width anti-aliased with `fwidth`** (the same technique the repo's pre-war brick facade uses), so the fine
  coursing fades out wherever a course sub-tends less than a pixel: it neither shimmers at grazing angles nor muddies
  into flat white in the distance.
- **Subtle contrast**: the mortar only darkens the base by **~0.08** (was 0.30), plus faint vertical weathering streaks
  keyed to world XZ, bounded so they calm at distance.
- **Bounded shading only**: every effect is a multiplicative *darkening* of the base (`shade ≤ 1`), so the wall can never
  be driven above the pale-grey base to pure white.

The TSL node functions live on `window.CITY.TSL` (the imported `three/tsl` module), not on `THREE`. When the node
material class or `CITY.TSL` is absent (plain-WebGL fallback, or the Node test harness) `brickMaterial` returns a flat
`MeshStandardMaterial` still at the darker **`0xa7aaa4`** base — no canvas is created and nothing is fetched. The
`..._Trim` (parapets/pilasters) was also dropped from `0xd2ccbe` to a quieter `0xc0bdb2` so the pale brick field, not the
trim, is the wall's read.

## 1c. Cameras are CPU-verified before a GPU run (GPU wave-7 fix)

The wave-6 west-sign capture was **entirely blank**: the camera stood inside / behind an unmapped building and could not
see the sign. A hand-guessed camera is not evidence. The module now exposes a **pure CPU verifier** so every shipped
camera is checked against the actual mapped geometry before a GPU frame is spent:

- `waterfrontLandmarkOBBs(layout)` — the CPU occupancy model: one oriented bounding box (OBB) per built landmark solid
  (every hall to its eaves, the quay tower, the QQT warehouse / addition bands / penthouses / clock, the unloader
  chassis), in world metres.
- `waterfrontLandmarkVerifyCamera({x,y,z}, target)` — returns `{ ok, inside, clear, blockedBy, dist }`: `ok` only if the
  camera is **outside every solid** and has **direct line-of-sight** (a per-OBB slab segment test) to `target`.
- `waterfrontLandmarkSignCenter(layout)` / `waterfrontLandmarkMuralCenter(layout)` — the exact world points of the raised
  sign / mural planes (the builder's own placement), so a sign camera is verified against the real face.

This proves the wave-6 camera wrong: the old `{x:636,y:16,z:520}` is rejected (it is occluded by the mid-plant blocks
`34620/34621` and cannot see the sign centre). The shipped refinement cameras were chosen by sweeping the map for
positions that pass the verifier, then checked end-to-end against the sign/mural centres. Every camera in
`tools/shots/waterfront-redpath-refinement.json` now passes `ok` in the test suite; the west-sign face camera stands
**in front of** the west wall (outward of the sign plane) at a verified clear line to the sign. An added **elevated west**
view (from over the north park, ~70 m, aimed at the sign) shows the full signed tower plus industrial context, and an
added **north Queens Quay street** view gives the refinery its public-edge character. The GPU capture and human review
remain the captain's; the CPU verifier only guarantees the camera is not blank-by-construction.

## 2. Fidelity rules

- Every wall, roof and detail sits inside the exact mapped footprint of the building (or inside the mapped refinery
  zone) the City already stands on. The module never moves a building off its surveyed outline.
- Where the source gives no measured size (unloader reach/height, the mural band, the clock top) the figure used is
  recorded as an explicit estimate in the spec.
- The QQT warehouse is described honestly as the geodata's **simplified rectangle** of the 420 × 200 ft block — not a
  survey outline. The addition is the geodata's own three-part split, not a synthesised inset box.
- Barrel silos and the chimney are **unresolved**, not invented.

## 3. Clock tower

The clock tower is **genuine QQT**; the coordinator visually inspected the Zeidler architectural photograph
(hosted image `https://torontosocietyofarchitects.ca/wp-content/uploads/2022/08/queens-quay-terminal-01-toronto-society-architects-zeidler.jpg`,
saved as `research/qqt-zeidler.jpg`) and described it: a cream tower of **narrow Art Deco vertical ribs**, a **flat
stepped parapet**, **two black round clock faces near the top** and a flagpole above — **no pyramidal cap**. The photo is
a 1983 historical image, so its landscaping is not current evidence, but the architectural form is. The module models it
on the mapped rooftop structure nearest the north (Queens Quay) face, with ribbed faces, a flat stepped parapet, round
clock discs and a cresting/flagpole — no pyramid.

## 4. Frames: detail vs eglinton (the default desktop map)

The default desktop frame is **eglinton** (`explore.html`), served from `data/frames/eglinton/toronto-geodata.bin`. It
shares the world projection and the building **centres** with the detail map, but its building table is a different size
and order: the QQT rows are **131069..131079** in eglinton vs **33202..33212** in detail. So the module resolves each
component from its key (mapped name + centre + height) in the active frame and caches the remap per GEO. It never uses a
raw detail-frame row index in the active frame, and it can therefore never suppress an unrelated building.

The integration test loads the **real unpacked eglinton bin** (`unpackGeo`) and the **real** `city-grid.js`
`createExtrudedPolygonMesh` helper (which returns a `Mesh`, not a geometry) to assert both the row remap and the
merge path.

## 5. Integration (captain)

- The builder returns `{ group, colliders, stats }`; `main.js` calls `window.CITY.createWaterfrontLandmarks(THREE, scene)`
  after the city is built and pushes `colliders` into the landmark colliders (same pattern as `waterfront-details.js`
  and `waterfront-public-realm.js`).
- To drop the generic City boxes under these landmark footprints, `buildings.js` calls
  `window.CITY.waterfrontLandmarkExcludesBuilding(rowIndex)` in its building loop (resolved for the active frame). The
  module publishes `window.CITY.waterfrontLandmarkExcludedRows` (the resolved set) and the predicate.
- Labels: `window.CITY.WATERFRONT_LANDMARKS` carries `{ id, name, short, address, source, sourceUrls }` for the two
  landmarks; `city-config.js` can register them in `LANDMARK_LABELS` / `TELEPORT_TARGETS` if desired. The module does not
  edit those files.
- Culling: every mesh carries `userData.cullDistance` / `cullCell` (`scene-culling.js`) and the root is a single group.

## 6. Captures

`tools/shots/waterfront-landmarks.json` (1600 × 900 default, `cinema` override cameras): QQT from Queens Quay, from the
harbour, an aerial and a clock-tower closeup; Redpath from Sugar Beach (east across the slip), from the harbour, an
aerial and the unloader. `tools/shots/waterfront-redpath-refinement.json` is the focused list for this identity pass: a
harbour wide, a **close roof-profile from the slip**, a **close unloader+roof** view, the **west sign face** (now a
CPU-verified camera on the sign's own outward side, §1c), an **elevated west** view showing the full signed tower +
industrial context, a **north Queens Quay street** view, the east (slip/Sugar Beach) face, a northeast silhouette, the
pitched roof, the unloader and a long-hall bay view. Every camera in this list passes the CPU verifier
(`waterfrontLandmarkVerifyCamera`) in the test suite. Run on the Mac mini through `gpu2` (never the laptop GPU):

```sh
GPU2_LOCK_WAIT=600 gpu2 waterfront-landmarks -- env \
  CAPTURE_QUERY='?quality=high&autoscale=0&transit=timetable&film&cloudSpeed=0&map=detail' \
  CAPTURE_PROGRESS=1 CAPTURE_TAG=wlm \
  node tools/capture.mjs tools/shots/waterfront-landmarks.json
```

The refinement list runs the same way with `CAPTURE_TAG=redpath` and
`node tools/capture.mjs tools/shots/waterfront-redpath-refinement.json`.

Captures are functional/visual evidence, not a performance budget. This module was verified in Node with the real
geodata (both frames) and the real city-grid helper; GPU capture and human visual review are the captain's.

## 7. Uncertainty register

- Warehouse block: the committed footprint is a simplified rectangle of the 128 × 61 m, 8-storey building; the mapped
  height is 31 m (the 43 m is the post-1983 total). The rectangle's orientation in the massing is the geodata's, not
  reoriented.
- Addition: modelled from the geodata's three parts (two bands + end band); the CMHC text describes "two perimeter
  blocks ... open courtyards". The exact parapet step profile is not measured.
- Clock tower: form from the 1983 Zeidler photo; its top height and flagpole are estimates at the mapped 46 m rooftop height.
- Redpath silos and chimney: no mapped footprint — unresolved, not placed. The coordinator confirms the plant's key
  features are the **shed roof and the crane**, which are enough; a fabricated silo table is not wanted.
- Long raw store (34614): its identification as the major raw-sugar warehouse is a **photo/geospatial inference** from
  the large pitched roof visible behind the unloader on the Jarvis Slip; no text source names the building's function.
  The gable **rise (~9.8 m) is an estimate** and the mapped 16 m total height is kept as the ridge, with the eaves
  lowered to fit; the geodata roof code is flat (0).
- Small pitched shed (34623): kept pitched under the same rule (ridge = mapped 8 m, eaves lower); its roof is not
  independently measured.
- Quay utility tower (34612/34613): the mapped 7.0 × 6.2 m, h 22.5 structure is zone-confirmed industrial, but its
  **function is unresolved**; it is modelled without windows or chimney identity, not called a stack/silo.
- Ship unloader: anchored to the real Jarvis Slip frontage; the machine form (green articulated boom, white grille body,
  counterweight, cab, dark A-frame) is from the 2012 manufacturer photos; its reach, heights and the A-frame/wheel detail
  ("five-wheel races" simplified to one bogie per corner) are estimates.
- Facade segmentation (wave 6): the material **split** (pale-grey brick plant, corrugated shed, dark plinth, pale
  parapet, dark glass, gray hoods) is a reading of the captain's photos, not a measured paint schedule. The rib/pilaster
  **spacings** (corrugation ~3 m, pilasters ~9.5 m) and the panel thicknesses are explicit estimates; the footprints and
  mapped heights are not. The pipe/rack assembly is placed on the tall plant's north face from the BIA photo; its exact
  size and pipe count are estimates.
- Brick material: the plant wall's **base tone `0xa7aaa4`** is the captain's target from the BIA photo's light grey
  brick; the **course (~0.08-0.10 m), brick length (~0.24-0.30 m), joint (~8 mm) and joint contrast (~0.08)** are the
  source-photo **typology proportions**, estimated from the west-sign image rather than measured on site (the exact
  dimensions are not surveyed). The running-bond pattern, head-joint stagger and weathering are a plausible brick read,
  not a survey; the point is that the wall reads as fine, subtle pale-grey brick and never washes to featureless white or
  oversized cinder block.
- Cameras (wave 6): every shipped refinement camera is CPU-verified **clear** against the module's own OBB occupancy
  model (outside all landmark solids, direct line-of-sight to its target). The verifier models only the landmark's own
  solids, not the surrounding generic city, so a camera it passes can still be occluded by an unrelated building the
  model does not own; the GPU frame is the final check. The elevated west and north street cameras are chosen to read the
  signed tower and the captured longitude rather than to reproduce a specific photographed viewpoint.
- Sign / mural: the **face** (west) and the wording ("REDPATH SUGAR") are sourced. The sign is anchored to the **tallest
  mapped plant part (34622, h 28 m)**; if the captain's photo shows the other tall block (34619) instead, that is a
  one-key change in `REDPATH.keys`. The sign's proportions follow the **source photo**: a short, wide **~15.6 × 2.0-2.3 m**
  one-line band (letters ≈ 0.09 of the ~28 m wall, broad natural-aspect capitals with a kept word gap) held **~1.5-2 m
  of brick below the roof line** — not the oversized ~4.4 m panel that stretched the text tall. The height/placement are
  derived from a single shared helper (`signDim`) so the builder, the layout and the LOS `signCenter` cannot drift. The
  ink hex, one-line block-capital form and transparent treatment remain an approximation of the real painted/raised
  lettering, not a measured reproduction; the exact typeface is unknown. The whale mural is a **plain blue plate at its sourced location**
  — the Wyland artwork is not reproduced. The cursive underlined "Redpath" logo on the second BIA photo's facade is
  **unresolved** (row not confidently matched).
- Annexes: rows 34615/34617/34618/34620/34621 are claimed by mapped centre+height; their internal use is not sourced, so
  they get the same industrial language rather than invented signage or machinery.


GPU review caught two issues beyond the CPU material checks: the deferred TSL callback mixed a THREE.Color with a shader node, and the gable sheet winding pointed down. Both were repaired; a geometry regression now computes actual triangle cross products for every large sloped roof sheet and requires upward normals. The CPU material test constructs a node graph; it does not compile GPU shaders. Final rendered roof acceptance is recorded in the captain report.
