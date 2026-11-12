# Harbourfront Centre Main Building

`js/waterfront-main-building.js` replaces the generic City facade on the ten mapped City 3D Massing rows named
**"Harbourfront Centre Main Building"** (235 Queens Quay West) with the source-grounded institutional envelope the
official photographs show. Before this pass those rows were drawn as anonymous residential windows by `js/buildings.js`;
the real building is a dark three-storey institutional volume with wide white-framed window ribbons, full-height ground
glazing and a black entrance canopy.

## Scope and ownership

- **This module only.** New file `js/waterfront-main-building.js`; a focused test `tests/waterfront-main-building.test.mjs`;
  this document. It does **not** edit `js/waterfront-harbourfront.js` (The Power Plant worker's file) or
  `js/waterfront-landmarks.js` (the Terminal worker's file).
- **Integration is the captain's.** `explore.html` already lists `./js/waterfront-main-building.js`. The captain adds the
  builder to the `main.js` waterfront loop alongside the siblings and lets `js/buildings.js` call the exclusion hook:

  ```js
  // main.js: add window.CITY.createWaterfrontMainBuilding to the waterfront builders array
  for (const build of [ ..., window.CITY.createWaterfrontHarbourfront, window.CITY.createWaterfrontMainBuilding, ... ]) { ... }
  ```

  `js/buildings.js` already has the analogous guard for the other waterfront modules; the captain adds one line:

  ```js
  if (window.CITY.waterfrontMainBuildingExcludesBuilding?.(bi)) continue;
  ```

  The predicate exists from load (returning `false`) and only excludes rows after a successful build, so the guard is
  safe to call before the builder runs.

## The ten mapped rows (detail frame, st-sb3r.42)

| row  | mapped centre (x, z) | height m | role        | treatment |
|------|----------------------|----------|-------------|-----------|
| 33246 | -407.0, 590.4        | 5.3      | low-wing    | light-gray cladding, long-face window ribbon |
| 33247 | -387.9, 632.5        | 6.8      | long-hall   | light-gray cladding, wide window ribbons (the broad hall) |
| 33248 | -386.5, 669.8        | 7.1      | north-wing  | light-gray cladding |
| 33249 | -374.8, 593.3        | 7.3      | low-wing    | light-gray cladding |
| 33250 | -371.4, 666.8        | 10.0     | north-wing  | light-gray cladding |
| 33251 | -378.3, 589.7        | 11.6     | south-wing  | light-gray cladding |
| **33252** | **-376.4, 627.2** | **14.0** | **main-volume** | **dark charcoal east face: ground glazing, two window ribbons, black fascia (white "Harbourfront Centre"), black entrance canopy (white "235")** |
| 33253 | -370.5, 657.7        | 14.5     | roof-core   | plain charcoal volume (hidden mechanical) |
| 33254 | -377.8, 623.9        | 14.5     | roof-core   | plain charcoal volume |
| 33255 | -373.2, 598.1        | 15.1     | roof-core   | plain charcoal volume |

Rows are resolved by **mapped name + block centre + mapped height**, never by row index, so the module also resolves
them in any other active frame and never suppresses an unrelated building. A row that does not resolve is neither built
nor excluded.

## Sources (retrieved 2026-11-10)

- Harbourfront Centre, **Venue and Accessibility Guide 2025** (official PDF):
  <https://harbourfrontcentre.com/wp-content/uploads/2025/04/04142025_hc_accessibility_guide_2025-compressed.pdf>
  - p.4: "Harbourfront Centre's Main Building is located at 235 Queens Quay West, on the south side of Queens Quay West,
    where Lower Simcoe Street ends." — the east entrance photograph is captioned "the main entrance on the east side
    of the Harbourfront Centre's Main Building, and it is what you will see from the street."
  - p.10: "There is a wheelchair-accessible entrance at the northeast corner of the Main Building, which you can see
    from the street. There is a set of stairs (3 steps) and a ramp with railings on both sides. The entry doors are
    automatic." and "The entrance to the main building is through the North East doors."
- Harbourfront Centre, **Accessibility**: <https://harbourfrontcentre.com/accessibility/>
- Harbourfront Centre, **Plan your visit**: <https://harbourfrontcentre.com/plan-your-visit/>
- Harbourfront Centre, **Fall 2025 site map** (official PDF):
  <https://harbourfrontcentre.com/wp-content/uploads/2025/10/Fall_2025_hc_site_map_v1.0.0.pdf>
- Commons aerial reference `.cache/waterfront-mainland-review/harbourfront/harbourfront-centre.jpg` — a **dated
  historical** photograph (a surface parking lot and a pond that no longer exist). It is used only for the broad roof and
  hall reading; the obsolete parking/pond is **not** replicated and it is **not** used as a site plan.

### Captain's verified photograph reading (east entrance face, guide p.4)

- THREE-STOREY **dark charcoal** smooth horizontal panel spandrels with a rounded corner.
- Wide **white/silver-framed multipane horizontal rectangular window groups** at the upper two levels.
- **Full-height ground glazing.**
- A **black rectangular entrance canopy** labelled "235"; "Harbourfront Centre" white text branding on the top fascia.
- **Not** brick and **not** uniform white corrugation.
- The adjacent larger main hall (Commons aerial) has a gray broad flat roof and lighter-gray long side cladding with a
  wide window ribbon — so the dark three-storey east face is distinguished from the broad gray hall; hidden walls are
  kept conservative.

The module's author cannot read images (this model has no image input); the envelope is built from the official text
plus the captain's written photograph observations above.

## What is modelled, and what is an explicit estimate

Every volume is a **committed mapped footprint part** of its row, at the mapped height. Nothing is moved off its
surveyed outline, and no roof mast, furniture or site change is invented. The roof is a flat gray cap inset 0.3 m from
each mapped edge.

Explicit estimates (unverified figures; recorded as `MAIN_BUILDING_ESTIMATES`):

| estimate | value | note |
|----------|-------|------|
| storeys (east face) | 3 | photographed |
| storey height | 4.6 m | 14 m mapped main volume ÷ 3 |
| ground glazing top | 4.1 m | full-height glazing |
| window ribbon height | 1.8 m | the wide horizontal group |
| ribbon inset | 1.6 m | from each end of the east face |
| mullion spacing | 3.2 m | white/silver verticals; count is not measured |
| canopy width / depth / height | 8.0 / 3.0 / 0.5 m | the black entrance canopy |
| canopy sign width / height | 3.0 / 0.3 m | the white "235" plane, kept inside the canopy plan and height |
| canopy from north end | 6.0 m | near the northeast entrance |
| fascia height | 0.8 m | the black branding band |
| fascia lettering band | 14.0 m wide | bounded sign band centred on the fascia, not the whole ~46 m face |

**Lettering (now modelled).** The top fascia is **black** and carries white **"Harbourfront Centre"**; the canopy is
**black** and carries a small white **"235"**. Both are drawn as simple canvas lettering planes — white source wording on
a black field, no copied photo pixels — with a natural aspect ratio (the canvas keeps the plane's aspect so letters are
never stretched) and two bounded shared `CanvasTexture`s (≤ 1 K px on the long side each). Fonts are system sans-serif.
Where no canvas exists (a DOM-less runtime such as the Node tests) the black panels still stand, plain, and `stats`
reports `lettering: { fascia: false, canopy: false }`.

**Simplified, not modelled:** the rounded corner (a committed massing part is a rectangle; cutting the corner would
leave the surveyed footprint), and the entrance stairs/ramp (the mapped massing carries no stair/ramp footprint — they
extend beyond the building and would be invented site changes). The exact panel/window/lettering counts and the canopy
dimensions are estimates; hidden walls are kept conservative.

## East face and the face-align fix

The east face is the face of the main volume whose **outward normal points nearest +x (grid east)** — the official
caption places the entrance on the east side and the mapped orientation supplies which face that is. Every face panel
derives its yaw from the face's own along vector, `atan2(-along.z, along.x)`, **never** one yaw for all four faces (the
Terminal face-alignment bug). The test `every wall/roof/glazing vertex projects inside its mapped part` checks this:
a panel with the wrong yaw would project outside its part at ±45° of the wall.

## API

```js
window.CITY.createWaterfrontMainBuilding(THREE, scene) -> { group, colliders, stats, layout }
```

- `group` — one culling root named `WaterfrontMainBuilding`; each material is a single merged mesh
  (`WaterfrontMainBuilding-charcoal|cladding|glass|frame|canopy|roof|fascia`) plus two lettering planes when a canvas
  exists (`WaterfrontMainBuilding-FasciaText`, `WaterfrontMainBuilding-CanopyText`), `cullDistance` 900 / `cullCell` 120.
- `colliders` — one per mapped part: `{ minX, maxX, minZ, maxZ, minY, maxY, prop:false, kind:'main-building',
  obb:{ cx, cz, hx, hz, cs, sn } }`, the native mapped footprint and mapped height.
- `stats` — `{ supported, rows, parts, meshes, triangles, colliders, excludedRows, unresolved, ribbons,
  groundMullions, canopy, lettering, estimates, ms }`.
- `window.CITY.waterfrontMainBuildingExcludesBuilding(index)` — the exclusion predicate. It exists from load (returns
  `false`) and excludes only the rows actually drawn, only **after** a successful build. **Stale-safe:** it captures the
  `GEO` it was built against (`window.CITY.waterfrontMainBuildingBuiltGEO`); if the active frame is later swapped, the
  same row indices name different buildings, so the predicate returns `false`. An unsupported/rebuild path clears the
  excluded rows, `BuiltGEO`, and the predicate to the fail-closed default first. Unresolved rows stay generic.

Other exports: `MAIN_BUILDING_ROWS`, `MAIN_BUILDING_ESTIMATES`, `waterfrontMainBuildingLayout(G)`,
`waterfrontMainBuildingSupported(G)`, `waterfrontMainBuildingResolveRows(G)`, `buildWaterfrontMainBuilding` (alias).

## Verification

`node --test tests/waterfront-main-building.test.mjs` builds real THREE geometry against the committed mapped rows.
**This module's own test file: 16/16 passing.** It checks: nothing is built on load; all ten rows resolve; the east face
normal points +x with its own along-vector yaw; the colliders are the native mapped parts; the exclusion hook covers
exactly the drawn rows; every wall/roof/glazing vertex projects inside its mapped part (the face-yaw bug); volumes reach
the mapped heights; the east face carries the glazing, ribbons and black fascia; the separate mapped northeast strip carries the open entrance canopy; the black fascia/canopy
lettering planes exist with natural-aspect canvas textures where a canvas exists (plain panels otherwise); the "235" sign
does not float beyond the canopy plan; a second build is deterministic; and a frame swap to an unrelated/reordered `GEO`
suppresses nothing (stale-safe exclusion).

Integrated desktop and phone visual review completed. See [central acceptance](waterfront-central-acceptance.md) for captures, final full-suite results and remaining source approximations.

## Final entrance correction

The unnamed mapped strip at (-359.7, 591.6), height 4.3 m, is interpreted as the northeast entrance canopy using the 2025 accessibility guide photos (pp. 4 and 10). This is a photo/map inference, not an OSM canopy tag. Its thin roof, underside beams and posts replace only that exact strip when the named main complex also resolves. The middle remains open to walking; the roof has a height-bounded collision proxy. No invented awning remains on the middle of the three-storey east facade. The unresolved west strip at (-397.2, 627.1) is retained.

Captain review corrected the lettering planes to stand in front of their fascia surfaces. Tests now exercise actual canvas textures in their VM realm and transform lettering vertices into world coordinates before checking their mapped bounds. The three source entrance steps and ramp are not surveyed here; the approach remains simplified ground.
