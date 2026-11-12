# HTO East firehall: two-storey primary-source replacement mass

`js/waterfront-hto-firehall.js` corrects an inherited geodata error. The committed building row named **Toronto Fire and
Marine Station 334 EMS station 36** carries a generic 28.5 m tower height, but the primary contractor confirms a **two
storey, 13,000 sq ft** harbourfront fire station. This module draws the correct low mass at the same mapped part
footprint and exposes a per-row exclusion predicate so the captain can skip that one named row in `js/buildings.js`.
It never mutates GEO, never deletes another building, and places no boats or unsourced props.

```js
const hall = window.CITY.createWaterfrontHtoFirehall(THREE, scene);
// { group, root, colliders, stats, layout, replacedRow, replacedName }
C.htoFirehallReplacesBuilding(row)    // identity test for the one named mapped row
C.htoFirehallExclusionAt(x, z, margin) // true only after a successful build, inside that row's parts
```

The predicate is false before the builder succeeds, in an unsupported frame, or when the named row is missing. The
original row therefore stays visible unless the replacement is actually present and correct.

## Source-backed mass

| Fact | Value | Source |
| --- | --- | --- |
| Storeys | **2** (primary fact) | MJ Dixon project page, "two storey" |
| Floor area | **13,000 sq ft** | MJ Dixon project page |
| Lower flat volume | ~5.0 m | Captain's photo read of the side view (roof terrace) |
| Recessed upper block | ~8.5 m **photo estimate** | Captain's photo read; clearly not a primary dimension |
| Facade | pale gray large panels | Photo `hto-firehall.jpg` |
| Doors | tall glazed garage bays | Photo `hto-firehall.jpg` |
| Signage | dark blue-gray TORONTO Fire & Marine Station 334 / EMS Station 36 | Photo `hto-firehall.jpg` |
| Upper strip | corrugated panel band | Photo `hto-firehall.jpg` |
| Roof | rectangular white flat roof | ASLA aerial `hto-photo-2.webp` |
| Footprint/colliders | the named GEO row's three mapped parts, unchanged | committed geodata |

The module builds a pale-gray lower mass on every mapped part, a flat roof slab, a recessed upper block on the largest
part, three glazed garage bays and a dark sign band on its east facade, narrow vertical glazing and a corrugated strip on
the upper block, and a dark horizontal roof-terrace rail on the lower volume. These are bounded shared-material meshes
(8 meshes, ~1,650 triangles, 3 lower-volume colliders). The ~8.5 m upper height is a documented estimate; two storeys
is the primary fact. No lettering geometry is fabricated (the dark blue-gray sign band marks the source sign location).

## Integration

The captain wires `buildings.js` to skip the named row when `htoFirehallReplacesBuilding(row)` is true. This module does
not edit `buildings.js`, `GEO`, or another module. It builds in the detail and Eglinton frames and returns `null` with a
direct error in any frame that does not cover the mapped row.

## Sources (recorded 2026-11-10)

- **MJ Dixon, Harbourfront Fire Station, Toronto** — two storey, 13,000 sq ft:
  <https://mjdixon.ca/project/harbourfront-fire-station-toronto/>.
  Exterior photo: <https://mjdixon.ca/wp-content/uploads/2019/09/Harbourfront-Fire-Station_1.jpg>.
  Local captain-inspected copies: `$WATERFRONT_RESEARCH/research/hto-firehall.jpg`,
  `$WATERFRONT_RESEARCH/research/hto-firehall-side.jpg`.
- **ASLA 2009 Professional Awards, HtO** — aerial white rectangular roof:
  <https://www.asla.org/awards-events-main-landing/honors-awards/pro-student-awards/2009-professional-awards/518>
  (`$WATERFRONT_RESEARCH/research/hto-photo-2.webp`).
- **Committed OSM/geodata** — the named building row and its three mapped parts; read only.

## Verification

Focused test: `node --test tests/waterfront-hto-firehall.test.mjs`.

It asserts the two-storey/13,000 sq ft facts, the 5 m lower and 8.5 m upper heights, the mapped three-part footprint,
the eight mesh roles and finite bounded geometry, unchanged GEO and other rows, the exclusion predicate true only after
a successful build and only inside the named row, the unsupported-frame no-op, and the real Eglinton frame build.
