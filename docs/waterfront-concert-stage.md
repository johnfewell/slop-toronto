# Harbourfront Centre Concert Stage (js/waterfront-concert-stage.js)

The open-sided, membrane-roofed outdoor stage at the south-west corner of the Harbourfront Centre campus (the John Quay
side), rebuilt in 2022 on the mapped `Concert Stage` row. This module replaces the generic pitched-roof residential
houses the city's building compiler had drawn on that footprint (bead `st-sb3r.43`, part of epic `st-sb3r`). Runtime:
`js/waterfront-concert-stage.js`; tests: `tests/waterfront-concert-stage.test.mjs`. This module owns only itself and its
doc/tests; `main.js` / `buildings.js` / `city-config.js` integration is the captain's.

The author cannot read images. The **photo-form review is the captain's**, recorded in §3, and every form attributed to
a photograph is the captain's, not this module's.

## 1. Sources

- **Structural (primary):** Blackwell Structural Engineers, "Harbourfront Centre Stage"
  (<https://blackwell.ca/portfolio/project/harbourfront-centre-stage>) — the 2022 renovation rebuilt the stage's roof as
  a **fabric membrane canopy carried wholly by the existing masts**; no new tie-downs or perimeter anchor system. Architect
  Athos Zaghi.
- **Fabrication (primary):** Cast Connex, "Harbourfront Centre Stage"
  (<https://www.castconnex.com/projects/harbourfront-centre-stage>) — a **raised, rain-protected seating deck**; Walters
  Inc., Tensile Integrity and Diablo cast-steel splices.
- **Official guide:** Harbourfront Centre 2025 accessibility/visitor guide (captain's saved copy,
  `~/.cache/waterfront-mainland-review/captain/access-2025.pdf`) — **p23**: the stage has **open sides**, **fixed**
  (unmovable) seats on a raised deck, an entrance at the **back** of the seating, and a **ramp at the centre back** to
  the accessible seats; **p4**: the campus orientation map places the stage at the south-west corner of the West Lawn,
  opening toward the water, with The Slip bistro to the east.
- **Mapped footprint:** the committed geodata row `Concert Stage`, `[-451.5, 710.7, -0.026, [[-4.9,18.6,-13.5,10],
  [-13.4,-4.9,-17,0], [5.6,18.6,10,16], [-1.4,13.6,-18,-13.5]], 7.1, ...]`, resolved by **stable identity** (name +
  world centre + mapped height + mapped yaw), never by row index.

## 2. What it builds (and what it does not)

One culling root, `WaterfrontConcertStage`; seats, masts, truss struts and stay cables are instanced or merged, never
one object per chair or strut.

| Element | Geometry | Basis |
| --- | --- | --- |
| Central canopy | broad, low, slightly arched grey-green double-sided membrane over the seating plan | captain photo |
| Space-frame | white open truss grid under the canopy (instanced) | captain photo |
| Perimeter masts | tall slender white masts, **six fanned across the open front** + two rear supports, tips above the roof with pennants | captain photo (six legible; total representative) |
| Tension stays | fine cables from each mast tip to the roof edge and the ring apex | source: masts carry the membrane; no new tie-downs |
| Scalloped ring | a **broad, almost-horizontal** lower white membrane band (≈3.5 m wide, ≈0.5 m sag) hung from the masts, with a clear **open gap** up to the higher central roof | captain photo |
| Raised seating deck | low platform slab (≈0.3 m), dark fixed seats **with pan and back**, two clear aisles | guide (raised, fixed seats) |
| Rear access | a **graded rear ramp** from the ground up to the deck at the centre back; low white perimeter wall with black guardrail, open to the water at the front and along both sides | guide (rear-centre ramp), photo |
| Footing | `C.concertStageSurfaceAt(x, z, {baseY, maxRise})` returns the rendered deck/ramp top or `null` (ground) | this module |

It deliberately does **not** draw: enclosed walls, pyramid roofs, the temporary shipping containers or event banners
seen in the photos, or any geometry outside the mapped parts.

## 3. Captain photo-form review (basis for the forms; not this module's own reading)

`~/.cache/waterfront-mainland-review/captain/stage-blackwell-9255.jpg` and `stage-blackwell-9310.jpg`: a broad, low,
slightly arched **grey-green translucent** central canopy on a **white open triangulated space-frame**; **six legible
white perimeter/front masts** with fine stays, tops projecting well above the roof with small white pennants (total
count **not** established); a **lower white scalloped ring membrane** with a clear **open gap** up to the higher central
roof; **dark fixed seats with backs** on the raised deck; a low white perimeter wall with a black guardrail; clear rear
access. The older Commons aerial (`harbourfront-centre.jpg`) predates the 2022 membrane and is **not** a shape reference.

## 4. Estimates and the movement surface

Every dimension is an estimate (metres) in `STAGE_ESTIMATES`; the 7.1 m mapped row height is a **mapping** value, not a
roof survey. The canopy roof/mast/ring heights, spans, cable and mast counts are unverified. This is a conservative
**representative typology**, not an engineering reconstruction.

The **only walkable raised surface** this module owns is the deck + ramp, exposed through
`C.concertStageSurfaceAt(x, z, { baseY = 0, maxRise = 0.42 })`:

- returns `null` outside the exact rendered deck/ramp plan (so a side walk, the rear court or a corner of the mapping
  bounding rectangle is ground — there is **no invisible full bounding rectangle**);
- inside, returns `{ h, id, pedestrianOnly }` with the **actual** rendered top height;
- the deck is a **low platform** (≈0.3 m) reached by a **graded rear ramp** (~1:17 here, estimated; the guide documents a
  ramp but publishes no grade) — the label says *photo-informed estimates*;
- a point is reported only when its rise over `baseY` is within `maxRise`, so the walker steps up the ramp a little at a
  time and cannot be teleported onto the deck;
- it is **bound to the GEO the build used**: a stale or different frame reports no footing.

The module adds **no** solid collider for the deck (it is a surface, so the walker's ground height rises onto it); the
native colliders are the slim mast posts and the low perimeter wall only.

## 5. Integration (captain)

- `window.CITY.createWaterfrontConcertStage(THREE, scene)` → `{ group, colliders, stats, layout, surface, active }`;
  group name **`WaterfrontConcertStage`**. Push `colliders` into the landmark colliders (same pattern as the sibling
  waterfront builders).
- `buildings.js`: call `window.CITY.waterfrontConcertStageExcludesBuilding(rowIndex)` in the building loop beside the
  existing `waterfrontLandmarkExcludesBuilding` / `waterfrontHarbourfrontExcludesBuilding` hooks. It is **success-gated
  and bound to the GEO the build used** — it answers `true` only for the row actually replaced in that GEO, and any
  skip/failure/rebuild **clears** the previous success, so the same row index can never be suppressed in a different
  frame.
- Movement: call `window.CITY.concertStageSurfaceAt(x, z, { baseY })` from your deck-height sampler (the captain wires
  it into the existing `waterfrontDeckAt` route). It self-gates on the active build + GEO.
- Runtime gate: `window.CITY.waterfrontConcertStageEnabled = false` or `?stage=0` disables build and both hooks.
- Culling: every mesh carries `userData.cullDistance` / `cullCell` under the one root.

## 6. Uncertainty register

- **Mast count/arrangement**: six front masts are legible in the photos; the total is not established. Six front + two
  rear supports is **representative**, not a measured count.
- **Canopy roof/mast/ring heights and spans, arch camber, cable count**: estimates. The 7.1 m mapped row height is a
  massing value.
- **Deck height (0.3 m) and ramp grade**: the guide documents a raised deck and a rear-centre ramp but publishes no
  dimensions; both are conservative estimates and are labelled **photo-informed estimates**.
- **Seating**: fixed dark seats with backs are from the guide and photos; the row/seat counts are representative
  estimates (not increased to pad the numbers), with realistic row pitch and clear aisles.
- **Colours/finish**: grey-green translucent canopy, white structure, dark seats — from the captain's review of the
  photos; no image is bundled or treated as a measured drawing.

The central canopy has a height-bounded collision proxy from its spring to its crown. It keeps the camera below the roof while leaving pedestrian headroom; it is a conservative shallow-arch bound, not a walkable rooftop.
