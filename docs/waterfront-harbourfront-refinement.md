# The Power Plant primary-photo refinement (st-sb3r.41)

This is the Phase 2 refinement of `js/waterfront-harbourfront.js` under the Waterfront BIA realism epic (`st-sb3r`).
It replaces the generic "tan residential window box" the City massing put over The Power Plant (231 Queens Quay W)
with a source-classified industrial skin over the **eight committed mapped rows**. It changes only this module, its
focused test and this document; it does not touch shared files (`buildings.js`, `main.js`, `explore.html`,
`city-config.js`, controllers, cameras).

The previous phase (the campus identity, squares, mapped chimney node and John Quay boardwalk) is unchanged and still
documented in [waterfront-harbourfront.md](waterfront-harbourfront.md).

## Why the change was needed

The GPU baseline (`wave8-central-before-powerplant-street.png` / `-aerial.png`, `$GPU2_REVIEW_DIR/
slop-toronto-waterfront-bia/`) showed the Power Plant as a generic light-tan box with two rows of small punched
windows. Against the real photographs that is the strongest visible mismatch: the Power Plant is a brick-and-glass
gallery whose identity is a red-brown brick mass, tall industrial glazing, and the brick smokestack.

## Source photographs (inspected 2026-11-10)

All are in `.cache/waterfront-mainland-review/harbourfront/` (research only; **no source image pixels ship** — the one
new canvas is red sign lettering drawn by us, not a photo).

| File | Source URL | What it shows (inspected) |
| --- | --- | --- |
| `harbourfront-centre.jpg` | Wikimedia Commons `Harbourfront-Centre.jpg` | Aerial from the water. The **north theatre** reads as a tall grey metal volume over a sloped glazed atrium beneath; the south/low volumes are brick. |
| `powerplant-2023.jpg` | Commons `The_Power_Plant_Toronto_2023.jpg` | Ground oblique. Low brick wing (left) + taller brick block with a glass enclosure wrapping its lower portion; tall tapering brick stack with a flared ringed crown. |
| `pp-building.jpg` | Commons `The_Power_Plant_Contemporary_Art_Gallery_-_building_view.png` | Elevated oblique. Broad low red-brown brick volumes, flat parapets, grey rooftop louvre screens, black-framed glazed entry, red "THE POWER PLANT" signs with white uppercase lettering. |
| `pp-2019.jpg` | Commons `The_Power_Plant_Contemporary_Art_Gallery_September_26_2019.jpg` | Wide ground view, same frontage from farther away. |
| `powerplant-smokestack.jpg` | Commons `PowerPlant_smokestack.jpg` | Close oblique. Brick shaft, flared crown with several horizontal brick rings, dark rim, small rods above. **No steel balcony.** |
| `powerplant-smokestack-2025.jpg` | Commons `The_Power_Plant_smokestack,_Toronto_2025.jpg` | Close ground looking up. Dark red-brown brick, ringed crown, ramp and railings at the entrance. |
| `captain/powerplant-official.jpg` | Harbourfront Centre `TPP-Buidling-1024x768.jpg` (`harbourfrontcentre.com/wp-content/uploads/2021/10/`) | Captain-viewed official image: south/waterfront red-brown brick low gallery, tall industrial green/dark multipane windows, centre glazed entry with pyramidal metal roof, horizontal grey metal rooftop clerestory, small brick shaft with a blue-grey hip roof, tall brick stack, red rectangular "THE POWER PLANT" signs on the south and west facades in white uppercase. Dated exhibition banners are **not** copied. |

Claims these photographs support, and claims they do **not**:

- Support: brick massing, a taller grey metal theatre over glazing to the north, tall multipane glazing on the
  gallery, a glazed entry with a pyramidal metal roof, a red-brick stack with a flared ringed crown, red signs with
  white uppercase lettering.
- Do not support: any measured dimension, bay count, exact palette, exact posed exhibition content, or the exact
  roof plan. Everything numeric below is an **estimate**.

## The eight mapped rows and their source role

The committed geodata names eight "The Power Plant" rows (detail 33256–33263; eglinton 131123–131130 — the **same
world rows at different indices**, so the module keys them by `name + world centre + mapped height`, never by index).
Each is assigned one of two roles from the photographs:

| Detail row | Centre (x, z) | Mapped h | Role | Source reading |
| --- | --- | --- | --- | --- |
| 33256 | −318.0, 707.4 | 5.4 | brick | low south/east annex beside the gallery |
| 33257 | −317.2, 696.0 | 6.2 | brick | low brick service wing |
| 33258 | −340.2, 696.1 | 6.3 | brick | low brick west annex |
| 33259 | −331.6, 722.5 | 8.7 | **brick (south gallery)** | the source-photographed larger red-brown gallery |
| 33260 | −330.2, 702.3 | 9.2 | brick | brick gallery-to-theatre connector |
| 33261 | −327.6, 677.2 | 10.9 | theatre | north theatre lower wing (grey metal volume) |
| 33262 | −330.0, 694.2 | 11.7 | theatre | north theatre body |
| 33263 | −327.4, 677.3 | 16.5 | theatre | north theatre tallest volume |

Mapped **footprint positions and heights are preserved**; nothing is moved. The module draws a coherent industrial
skin over these rows, not decorative signs on a generic body.

## What is built (and what is not)

- **Every mapped part** gets a brick (or, for the theatre rows, grey-metal) wall to its own documented wall top, a
  parapet band and a dark flat roof, all inside its mapped footprint and mapped height.
- **South gallery (row 33259):**
  - red-brown brick walls (muted medium red-brown, not dark saturated burgundy);
  - tall industrial multipane windows — dark-green glass with a dark frame grid — on the south (5 bays) and west
    (4 bays) facades, sized and spaced by estimate;
  - a centre glazed entry with a pyramidal metal roof, projecting just outside the mapped south face (recorded as an
    estimate);
  - red rectangular "THE POWER PLANT" signs on the south and west facades, white uppercase on the canvas (its aspect
    matches the plane, ~6.9:1; broad caps, not compressed). The canvas draws our own lettering; no photo pixels ship.
- **North theatre (the tallest row 33263 and its lower wings):** grey metal upper/screened band over a sloped glazed
  atrium band where that band is actually exposed above its neighbours.
- **Chimney:** now a tapered brick shaft with a **flared, horizontally ringed brick crown**, a dark rim and small rods
  above — the steel-balcony cap is gone. Still at the mapped OSM node (555405453), solid to the player.
- **Not built:** no furniture, no craft, no unmapped piers, no new mass off any mapped footprint. No dated exhibition
  banners. The John Quay boardwalk and campus identity are unchanged.

### Exposure rule (the buried-detail fix)

A guessed low rooftop detail (the horizontal clerestory band, the small shaft) is drawn **only if its candidate top
clears every other mapped part that covers its footprint** by a margin (`exposedTop`/`admitDetail`). The gallery's
north band is under the taller connector row, so those details are placed on the exposed **south** band, where they
rise above the 8.7 m gallery volume. The stats record `clerestory`/`shaft` admitted-or-not so a later reader can see
what was admitted, not merely attempted. The north theatre's glazed atrium band is gated the same way.

### Instance colour (the double-multiply fix)

Every instanced batch except the timber boardwalk carries a **white instance tint**; the colour lives on the shared
material. This stops a coloured instance tint multiplying an already-coloured material into dark burgundy. The brick
material's RED-BROWN base (0x9a6350) is therefore what renders.

### Brick pattern scale (the stretched-course fix)

An `InstancedMesh` scales one unit `BoxGeometry` to tens of metres, so a UV-based brick period would stretch each
course enormously. `brickMaterial` derives the course/head-joint pattern from **world metres** — `positionWorld.y`
up the wall and the horizontal world axis chosen by the face normal — with `fwidth` anti-aliasing preserved at any
instance scale. Courses are ~0.075 m, ~0.24 m long, ~8 mm joint, subtle contrast (bounded darkening, never white).

## Estimated dimensions (all unverified)

Recorded in `POWER_PLANT_ESTIMATES`. None is a published measurement.

| Element | Estimate |
| --- | ---: |
| Gallery brick wall top (mapped 8.7 m includes the rooftop clerestory) | 6.9 m |
| Other rows' wall top | 0.9 × mapped height, ≥ 2.0 m |
| Parapet band | 0.22 m |
| Gallery window width / height / sill | 3.2 / 3.4 / 1.1 m |
| Gallery entry width / height / depth / pyramid roof | 6.0 / 4.4 / 1.2 / 1.4 m |
| Theatre glazed atrium depth / height | 2.4 / 3.2 m |
| Sign width / height / centre height | 9.0 / 1.3 / 6.0 m |

## Exclusion hook for the captain

After a **successful build** the module installs `CITY.waterfrontHarbourfrontExcludesBuilding(rowIndex, GEO?)`. It
answers **by stable identity** (`matchesKey`: name + world centre + mapped height of the eight rows), not by a stored
index, so the same stored index in another frame is never wrongly excluded. Any unsupported frame, missing key or
no-build path calls `clearPowerPlantExclusion()` first; the predicate then still exists and returns `false`, so stale
state can never suppress a building. Only rows actually drawn are named. This module does **not** edit
`js/buildings.js`; the captain's shared hook is already inserted there.

## Native part colliders

The module returns one collider per drawn mapped part (kind `power-plant`), sized to that part's footprint and its
**mapped** height, so dropping the generic City body under those rows loses no collision. The chimney keeps its
single collider.

## Verification

`node --test tests/waterfront-harbourfront.test.mjs` — eighteen focused checks:

- the campus identity, squares, chimney node, boardwalk and unique guard checks from the previous phase (unchanged);
- the eight Power Plant rows resolve **by identity in both shipped frames** (detail 33256–33263 and eglinton
  131123–131130), never by index, and a broken key resolves nothing;
- the mapped parts/heights are preserved (one drawn part per mapped part, no extra mass);
- the south gallery carries the source features (≥8 multipane windows, glazed entry, two broad signs,
  aspect > 5);
- the chimney is a flared brick crown, with no steel-balcony mesh;
- the brick batch tints are white (no double multiply) and the brick pattern is world-metre (no unit-uv attribute);
- the theatre rows are grey metal and the low annexes brick (roles), with the theatre metal band built;
- the exclusion hook is identity-keyed, only after a build, and clears on an unsupported frame;
- the build is one culling root, deterministic, finite, bounded.

GPU captures: `tools/shots/waterfront-harbourfront.json` (street + aerial) run on the Mac mini via `gpu2`, never the
laptop GPU; the captain inspects the images and accepts. **This issue is not closed before GPU acceptance.**

## Uncertainty register

- All dimensions, bay counts and the palette are estimates; a survey or the gallery's drawings would replace them.
- Which mapped row is the theatre is a photographic classification, not a text record; the north theatre's atrium and
  its exposure are approximations.
- The signs are our own red/white lettering, not the real sign artwork or any exhibition content.
- Fine facade masonry, roof plan and interior are not modelled.
- This is a procedural, source-classified refinement — **not** a survey-grade or photoreal reconstruction.

Captain photo review: the small hip-roof brick shaft belongs near the chimney. Its height among overlapping mapped parts remains unresolved, so that decorative detail is omitted rather than moved to an exposed southeast corner. The mapped building volumes remain intact.
