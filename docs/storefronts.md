# Storefronts: source-keyed signs and generated shopfronts

Beads `st-wt0.15` (M6 source-keyed storefront signs, adoption spec
ID-1, ID-2, ID-4, ID-7; the spec is an internal planning document, not published here) and `st-sz0` (generated storefronts and entrances, the fallback layer under the signs; ported
from Slop New York, see [upstream-sync](upstream-sync.md#generated-storefronts-and-entrances--2026-10-29)).

Two layers:

1. **Generated storefronts** on selected ground floors everywhere in the detailed city: glazing, a door, a transom, a
   lit shop interior and a blank fascia. Other street fronts keep a residential or office front with one proper
   entrance. Nothing here names a business.
2. **Source-keyed signs** on the pilot corridor, **Queen Street West from Ossington Avenue to Spadina Avenue**: a fascia
   board with the business's name over its own stretch of frontage, keyed by its OpenStreetMap ID and its building face.

## Status and what John needs to decide

- **The 107 signs carry automated evidence only** (`review.status: "rules"`). The spec asks for a person to review
  labels before release. [The review sheet](storefront-signs-review.md) lists every sign, its evidence and IDs, and every
  candidate the rules turned down. Disable a record with `"enabled": false`, or correct its `name` and add a `note`,
  then run `node tools/build-storefront-signs.mjs`.
- **Scope differs from the spec's pilot.** The spec proposed at most 20 names on a 300–500 m Spadina corridor. The brief
  for this work asked for Queen West, Ossington to Spadina (1.9 km), so the manifest covers that and ships every record
  the rules accept. To cut back to a smaller pilot, disable records; the IDs, evidence and review fields are unchanged.
- `st-wt0.15` is still blocked in the tracker by `st-wt0.5` (photo M1). Photo-export validation of the signs waits for it.

## Sources, licences and evidence

| Source | Use | Licence |
| --- | --- | --- |
| OpenStreetMap POIs (Geofabrik Ontario extract, 2026-10-23, the geodata's own extract) | Name, `shop`/`amenity`, address, `level`, `check_date`; the place's position | ODbL 1.0, © OpenStreetMap contributors. The manifest is a derived database and stays ODbL. |
| City of Toronto CaféTO Locations (2026-10-29 snapshot, `tools/data/cafeto-20261029.json`) | Corroboration only: a current-season permit at the same municipal address with a matching operator name. Nothing from the permit is drawn. | Open Government Licence – Toronto |
| Identity sidecar `js/toronto-geodata-ids.js` ([geodata IDs](geodata-ids.md)) | `osm:<type>/<id>` place IDs, `to-3dmassing-2025:<record>:<n/e/s/w>` face IDs, `idResolver` | (derived) |

No Street View, Google or other provider imagery was used. The City's business licence data was considered and not
used: most retail needs no City licence, and its records name sole proprietors. CaféTO already covers the restaurants
and cafés, which are the places most likely to have changed hands.

### The rules (`tools/build-storefront-signs.mjs --propose`)

A place on the corridor (within 35 m of the Queen Street West centre line) becomes a sign only if all of these hold:

- It is a storefront business: any `shop=*` except `vacant`, `erotic` and `magic_mushrooms`, or `amenity` restaurant,
  fast food, café, bar, pub, ice cream, bank, pharmacy, dentist, doctors, clinic, veterinary, internet café or bureau de
  change. (Offices, upper-floor studios, transit, parks and so on are not candidates.)
- Its `addr:street` is Queen Street West and it has a house number. No `level` other than 0.
- It is inside a mapped building (the geodata's own match, within 3 m), and that building has a face whose outward
  normal points at the street (cosine ≥ 0.75), whose real wall at the place's position is within 26 m of the centre line,
  and which is at least 3.6 m tall. The wall is found part by part (`wallAt`), so a recessed part of an L or U plan is
  never skipped over; a gap in the plan rejects the place. **A sign never goes on a rear wall or on the nearest wall by
  default.**
- **Current-tenant evidence:** an OpenStreetMap `check_date` (a mapper confirmed the shop on the ground) on or after
  2024-01-01, or a CaféTO permit at the same address naming the same business. Confidence is `high` for a check in 2025
  or later or a permit, else `medium`. 106 of the 107 are `high`.
- **No contradiction:** a restaurant, café, bar or pub whose address holds a CaféTO permit naming an operator that no
  place at that address matches is left generic (a likely change of tenant: 5 places, e.g. 745 Queen W, mapped as Harlem
  Underground, permitted as Agave Azul).
- **Address order:** house numbers on one side of the street must run the same way as position. A place out of order
  with a neighbour more than 2 m away is uncertain, and so is that neighbour: both stay generic (13 places).
- **Frontage:** every candidate on a wall, signed or not, owns the wall to the midpoints with its neighbours, at most
  5.5 m either side of itself and on its own part's wall. Less than 2.4 m (two tenants on one shopfront) stays generic.

Result for the 2026-10-23 extract: **107 signs; 247 candidates left generic** (no survey date or permit 172, address on
another street 45, out of order 13, upper level 7, CaféTO conflict 5, gap in the plan 2, set back 1, too low 1, no
building 1).

## IDs and the manifest (`tools/data/storefront-signs.json`, ID-1, ID-2)

Each record:

| Field | Meaning |
| --- | --- |
| `id` | the place's OSM ID, e.g. `osm:node/1193713289` |
| `face` | the building face ID, e.g. `to-3dmassing-2025:136615:n` |
| `name`, `sourceName` | the name drawn, and OpenStreetMap's. They differ only for a reviewed correction, which needs a `note`. |
| `category`, `address` | e.g. `shop=clothes`, `481 Queen Street West` |
| `span` | the sign's frontage in metres from the face's end `a` (wall-local extents) |
| `evidence`, `confidence` | see above |
| `source`, `rights` | dataset, extract and licence; "plain lettering, no logo or trade dress" |
| `enabled`, `review` | per-record disable; `{ status: "rules" \| "reviewed", by, date, note }` |
| `style` (optional) | `fascia`, `fasciaSerif`, `lightbox` or `colour`, overriding the default |

Re-running `--propose` keeps every existing record's `enabled`, corrected `name`, `review`, `note` and `style`, and
lists records whose place no longer qualifies under `droppedSinceLastProposal`.

`node tools/build-storefront-signs.mjs` compiles the enabled records using only committed files. Each ID goes through
`idResolver`. A record is dropped, never moved, if its place or face doesn't resolve, if its extent is off the face or
not on one wall, or if the place isn't behind that stretch of wall. The output `js/toronto-storefronts.js` (33 KB) names
the geodata hash it was compiled against. Each sign keeps its building row together with that building's centre, and
`js/buildings.js` and `js/storefront-signs.js` re-check the centre before using the row. Rebuilding the geodata without
recompiling fails `tests/storefronts.test.mjs`. The compile also writes [the review sheet](storefront-signs-review.md).

## Drawing the signs (`js/storefront-signs.js`)

- **One draw.** All boards are one `InstancedMesh` of thin boxes (7 cm deep, 2 cm off the wall). They cast no shadows and
  carry no collider.
- **Where.** Over the middle of the record's frontage, on the real wall, with the board's top 12 cm under the first
  floor (the storefront's fascia, so 2.73–3.28 m up on a 3.4 m storey). Boards are 0.55 m tall and 1.6–7.2 m wide.
- **Lettering.** Drawn with `fillText` only (names are data, never markup), in the actual spelling: no case change and no
  truncation. `layoutSign` sets one line if it fits the frontage, squeezing it sideways by up to 18%. Otherwise it
  breaks the name into two lines at the word break that balances them. Otherwise it uses smaller letters, whichever
  gives the tallest letters. Accents and curly apostrophes are kept (Nadège, Köz Bingöl, Uncle Terry’s).
- **Styles** (picked by a hash of the OSM ID and the kind of place, never from a brand's colours): a painted fascia
  with sans lettering, a heritage serif fascia with a gilt line, a backlit light box (takeout, convenience, pharmacy,
  bank), and a coloured board.
- **Night.** Light boxes glow through their panel; the other boards' lettering is lit as if by a gooseneck lamp.
- **Atlas and budget (ID-4).** The lettering is a coverage mask, so four boards share each 1024×128 cell, one per RGBA
  channel, with board and ink colours as per-instance attributes. The atlas is two cells wide and only as tall as
  needed: 2048×1792 for 107 signs, 18.7 MiB with mips on high and medium (ceiling 24 MiB) and 4.7 MiB at half
  resolution on the phone tier (ceiling 8 MiB). It is halved again, down to a quarter, if a larger set would exceed
  its ceiling. It is mipmapped (anisotropy 8), so distant boards settle to their average colour. The atlas is
  registered in the owned-resource ledger (`__CITY_APP.resourceSnapshot()`, owner `storefront-signs`), and the phone
  tiers' CPU copy is released once on screen.
- `?storefronts=0` leaves the signs out; the generated storefronts stay.
- **The map's place card** for a signed place says so ("Storefront sign: “…” (OpenStreetMap)"), as plain text.
- **No duplicate boards.** `js/signage.js` puts no generic name board on a building that has storefront signs.

## Generated storefronts (`js/tsl-materials.js`, `js/buildings.js`)

**Which buildings** (`storefrontSelection`): a building holding a mapped shop, restaurant, bank, market or clinic
(`GEO.pois` categories shop, food, bank, market, health), except sheds, works and places of worship. Also a low or
mid-rise building whose front wall is on its street (within 22 m) and which has two or more of those places on the
same street within 30 m: a main street's row, where not every shop is mapped. Every wall carrying a sign is a
storefront too. Before this change every mid-rise and a random quarter of the low-rise had shopfronts; residential
side streets lose them, and main streets keep them. The random draw that used to pick low-rise shops is still made, so
no building changes colour. A signed building's front is its signed wall, so fire escapes go on the opposite (lane)
side and wall air conditioners never land on a signed wall.

**The shopfront** (`createStorefront`, from upstream `8d88e41`): one shop per ~7.5 m of wall, its door to one side, a
display window on a riser, a transom, painted joinery (dark green, brown, charcoal), a blank fascia and a small
cornice. Behind the glass is a parallax interior with rear shelves of stock, a counter nearer the glass that shifts at
a different rate as you pass, ceiling lamps and a back light, lit or unlit per shop. Detail fades to the average before
it gets smaller than a pixel. On the phone tier (`quality.js` `storefronts: 1`) the interior is flat, but the glazing,
door and fascia are the same.

**Entrances** (`createBuildingEntrance`, from upstream `26bb9fe`/`dbaf5f9`): on residential and office fronts, in the
bay the facade already reserves for the door. A trimmed recess holds a panelled door, glazed above the lock rail, single
or double on wide walls. Curtain-wall towers get a modern dark-framed entrance. Entrances never appear on storefront
walls.

## Coexistence

- **CaféTO patios** stand on the sidewalk and curb lane. An umbrella's canopy is about 2.8 m up at its pole and slopes
  to about 2.4 m at its rim, which is the part nearest a wall. The sign boards start at 2.73 m, flush with the wall,
  so they don't meet.
- **Open Data furniture** (benches, bins, poles, wayfinding) is on the sidewalk, and the signs are on walls above head
  height. Nothing in the patio or furniture placement reads the building faces' treatment.
- Fire escapes (rear walls) and wall AC units are kept off signed walls.

## Verification

- `tests/storefronts.test.mjs` (10 tests, no raw data):
  - The committed runtime file and review sheet are the compile of the committed manifest, for the committed geodata.
  - Every record has its IDs, provenance, evidence, confidence, review and rights.
  - Every sign stands on its own building's face toward Queen Street West, on the real wall.
  - No two signs on a wall overlap.
  - Unresolvable, foreign-face, duplicate, malformed and disabled records are dropped or refused, and a correction
    applies.
  - The evidence rules hold: house numbers, address order, names and categories.
  - `layoutSign` never truncates and fits the cell and frontage.
  - The atlas fits both ceilings, and the code has no HTML sinks.
  - Building selection works.
  - The rendered, curtain-wall and sign shaders build to WGSL at both detail levels, with no `footprintLocal`, no
    fascia text, and entrances only in entry bays.
- Full suite (`npm test`): 369 tests, 368 pass, 1 opt-in skip.
- gpu2 captures, 2026-10-29 (`tools/shots/storefronts.json`, 9 views × midday/twilight, desktop high 1600×900 and the
  phone layout, low tier, 412×915; before = origin/main `5c74d5f`, after = this branch). These are contended functional
  captures, not performance numbers. Outputs are in `ride-anywhere-geo/review/gpu2/claude-sidewalks/` (`sf-before-*`,
  `sf-after-*`, side-by-side in `sf-compare/`).
  - No shader, pipeline or page errors on either tier. The one console warning, the audio synthesis worker's
    `createSynthResources`, also appears on origin/main.
  - Browser counts: 4,242 storefront buildings (1,140 of them on retail strips, 61 signed); all 107 signs placed. The
    atlas is 2048×1792 (18.7 MiB) on high and 1024×896 (4.7 MiB) on the phone tier.
  - Queen West: signs read clearly at 4 m ("Allwyn's", "Kinton Ramen") and at 20 m across the street ("Frankie's
    Diner", "Anne Sportun"). Each board sits on its own shop's wall over the generated shopfront. At twilight the
    shop interiors and the lit lettering carry the street.
  - Kensington Market and King West, which have no signs: generated shopfronts replace the old flat glazing. The
    parallax interior (shelves, counter, lamps) is visible through the glass on high; the phone tier shows the flat
    interior.
  - Light-box boards were too glossy in the first smoke run (the sky washed out their lettering at midday); they are
    now matte.
## Follow-ups

- A person's review of the 107 records (the review sheet), then `review.status: "reviewed"`.
- More corridors (Spadina, Kensington Market, Ossington, King West) with the same rules: they need only a corridor
  entry and a propose run. Kensington's Augusta and Kensington Avenues have many unsurveyed places.
- City-wide, `js/signage.js` still puts an unverified name board on every building with a named place, on the nearest
  street's face. These boards predate the adoption spec, which they do not meet. Retiring them, or limiting them to
  landmarks, is a separate decision.
- Photo-export validation of the boards once M1 (`st-wt0.5`) lands.
