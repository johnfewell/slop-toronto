# Queen's Quay Terminal refinement — green frame + glass typology (bead `st-sb3r.40`)

Focused, source-grounded refinement of the Queen's Quay Terminal (QQT) portion of
`js/waterfront-landmarks.js`. Scope is **the Terminal only**; Redpath Sugar, the shared
city/buildings/controller/camera files, and the Harbourfront module are untouched. The mapped
footprints, heights, open courtyard/lightwell, clock tower and colliders are all preserved.

## 1. Why this pass

The first build gave the warehouse a plain cream massing box with the shared residential-style
punched-window facade shader, and merged a "green-patina cornice" box into the cream shell. On the
captain's GPU wave-8 central-after capture (`$GPU2_REVIEW_DIR/slop-toronto-waterfront-bia`,
before frame `wave8-central-before-terminal-aerial.png`) the result read as a **bland white window
grid** with no green — the landmark's identity was lost.

The captain inspected the historical Zeidler photograph and described the actual building: a
**cream structural frame with strong green / dark multi-pane glazing**; **pale-green projecting
residential glazing / balconies at the four upper levels**; a **flat green roof edge**. So the real
1983 building is a **green-frame-and-glass building set in a cream frame**, not a cream box and not
a blanket green solid tower.

## 2. Sources (primary, captain-inspected)

| Source | URL | Use here | Claims-limit |
| --- | --- | --- | --- |
| Zeidler architectural photograph (historical) | TSA page `https://torontosocietyofarchitects.ca/buildings/queen-quay-terminal/`, credits **ZeidlerArchitecture**, hosted image `.../2022/08/queens-quay-terminal-01-...-zeidler.jpg` | the **visual form**: cream frame + green/dark multi-pane glazing, pale-green projecting upper glazing/balcony banks, flat green roof edge | photo **date unknown**; form is evidence, but the visible site/landscaping is not current evidence |
| Wikipedia, *Queen's Quay Terminal* | `https://en.wikipedia.org/wiki/Queen%27s_Quay_Terminal` | text facts: 1926-27, Moores & Dunford, 420 × 200 ft main block, 8 storeys, 1983 Zeidler Roberts rebuild adding **four** residential levels | text only; no pixel measurements |
| Waterfront BIA listing | `https://www.waterfrontbia.com/listing/queens-quay-terminal` | ownership/identity confirmation | marketing copy |
| CMHC case study NH17-253/1997 | `https://publications.gc.ca/collections/collection_2022/schl-cmhc/NH17-253-1997-eng.pdf` (cited in the module record; the PDF endpoint served an HTML redirect shell at review time, not fetched as evidence) | citations already in the module | not re-used as a new claim here |

Local reference copies downloaded for a vision-capable reviewer live **outside the shipped tree** in
`.cache/waterfront-mainland-review/terminal/` (Zeidler jpg, two Wikimedia Commons CC images:
`commons-2009-exterior.jpg` CC BY-SA 2.0 Sam Chan, `commons-2005-exterior.jpg` CC BY-SA 3.0 SimonP).
**No reference photo is shipped in the repo.** The `.cache/` copies are gitignored review aids.

The typology below is implemented from a written visual description of the Zeidler photo; the
rendered frames were checked against the photos by eye.

## 3. What changed (bounded, merged geometry only)

All of this is thin proud panels on the **exact mapped** warehouse walls / addition bands, merged
into a handful of meshes (no per-window objects), each with culling metadata.

### 3a. Warehouse — green frame + dark glass over cream piers
- **Cream piers / spandrels** (`WaterfrontLandmarks_QQT_Cream`, own cream material): the structural
  verticals between the glass bays and the horizontal spandrel band between storeys, built as their
  own merged cream geometry so they are actually in the scene. The warehouse no longer rides the
  shared `createRenderedFacadeMaterial` / `createFacadeBoxes` punched-window skin (the captain
  rejected that "bland white window grid").
- **Green mullion/transom grid** (`WaterfrontLandmarks_QQT_GreenFrame`, own green material): vertical
  mullions at each bay edge plus a transom at every floor line, on all four warehouse faces.
  Green-dominant (`0x3f7a5c`-family, estimated).
- **Dark multi-pane glazing** (`WaterfrontLandmarks_QQT_Glazing`, own dark material): a recessed dark
  green-tinted glass cell per bay per storey (estimated `0x1d3730`), so the wall reads as dark glass
  set in a green frame between cream piers — not a pale window grid.

### 3b. Addition — pale-green projecting glazing / balcony banks
- On each mapped `additionParts` band's outward faces, **four** glazed banks
  (`WaterfrontLandmarks_QQT_ResGlazing`, `..._ResFrame`, `..._ResRail`) with dark glazing set between
  pale sea-green mullions (`0x8fb59a`-family, estimated) and a thin green top rail, reflecting
  "pale-green projecting residential glazing/balconies at four upper levels".
- The banks **project ~0.55 m** past the band faces (estimate) and sit between the warehouse roof
  (31 m) and the mapped 43 m. The band **solids and the open courtyard/lightwell between them are
  unchanged** — no geometry fills the courtyard.

### 3c. Flat green roof edge
- The eaves band is now **its own green material** (`WaterfrontLandmarks_QQT_Cornice`,
  `0x3f7a5c`-family), not merged into the cream shell — fixing the old "green lost in cream" bug.
  It is a **flat** roof-edge / parapet band, not a sloped green-patina cap.

Nothing was moved off its surveyed outline; placements stay on the committed geodata rows
(33202 warehouse, 33204 addition bands, and the clock tower on the north-front rooftop structure
row 33203 — a photo/map inference, not an OSM clock tag). The former clock row 33212 is an east
mid-roof core and is retained as a penthouse/stair core, not the clock shaft.

## 4. Estimates (labelled, not surveyed)

The green **form** is photo-sourced; every number below is an **estimate fit to the photo's
proportions**, with **no measured paint schedule or window survey**:

- `frame.cream 0xcfc6b0`, `frame.frameGreen 0x3f7a5c`, `frame.glass 0x1d3730`,
  `frame.resGreen 0x8fb59a`, `frame.roofEdge 0x3f7a5c` — colour estimates from the captain's read.
- `bayWindowW 3.6 m`, `bayFloorH 3.9 m`, `frameBarT 0.11 m`, `pierW 1.0 m` — warehouse bay / mullion
  / pier widths are proportional estimates.
- `resLevels 4` (this one is **text-sourced**: four added residential floors), `resProud 0.55 m`,
  `resGlassH 2.05 m`, `resSoffitH 0.32 m` — bank projection / glazed-band / soffit heights are
  estimates.

## 5. Unresolved / intentionally not done

- **Exact glass tint, mullion spacing, and balcony projection are not surveyed**; they are the
  captain's photo reading plus proportional estimates. If the captain's detailed photo inspection
  gives measured ratios, they are one-line constant changes in `QQT.frame`.
- **Historical photo does not justify old parking / site plan** — none was modelled (unchanged).
- **No blanket green solid tower** — the green is confined to frame bars, glass, the flat roof edge
  and the upper banks; the massing stays the cream+mapped shells.
- Redpath, the Harbourfront module, and the shared city files are out of scope and unchanged.

## 6. Verification

- `node --test tests/waterfront-landmarks.test.mjs` — **30 pass** (focused tests include the
  green-frame warehouse read, the addition balcony banks + courtyard preserved, the green roof edge
  as its own material, the bounded culling geometry under one root, and the real-material /
  non-black / bounded-geometry facade invariants). Geometry/material checks use the real `three`
  module, not stubs.
- `node --test tests/waterfront-runtime.test.mjs tests/waterfront-movement.test.mjs` — pass.
- Built-scene sanity: QQT reads as ten merged meshes; the explicit green-frame typology is
  ~44.5k triangles (86 warehouse bays × 8 storeys of glass cells + green mullions/transoms + cream
  spandrels/piers, plus four residential levels of glass/mullions/rails on each addition band) —
  real architecture merged into a handful of meshes, not per-window objects. The tallest collider is
  46 m (the mapped penthouse cores); the clock tower top is the mapped 43.4 m. Captures
  (immediately before/after) and the GPU frame are the captain's; this pass made no
  runtime/GPU/server change.

Captain visual follow-up: fitted all eight warehouse levels inside the mapped height (the initial fixed pitch omitted the top row), enlarged the estimated cream spandrels, and reduced the estimated dial radius so it fits below the shaft parapet. Dials now stand clear of the projecting ribs; minute hands rotate in the face plane. Focused geometry tests cover both previously visible failures. These remain photo-proportional details, not surveyed dimensions.
