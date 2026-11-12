# Jack Layton Ferry Terminal (js/waterfront-ferries.js)

Source-backed model of the City of Toronto's mainland island-ferry terminal at **9 Queens Quay West**, foot of Bay
Street (st-sb3r.5). This is the mainland half of the ferry work; the islands arrival docks belong to st-sb3r.9, which
this module feeds a reusable route-endpoint table.

Retrieved 2026-11-09. The module is a procedural, source-backed model, not a survey reconstruction or an as-built
drawing. Dimensions marked "measured" come from the committed OpenStreetMap-derived geodata; "estimated" figures are
recorded in `ESTIMATES` and in the uncertainty register below.

## 1. What was sourced, and what was not

| Fact | Source | Used how |
| --- | --- | --- |
| Three routes: Centre Island, Hanlan's Point, Ward's Island | City ferry page; Waterfront BIA listing | Route names + colours in the directory |
| 9 Queens Quay W, foot of Bay St, behind Westin Harbour Castle, by Harbour Square Park | Wikipedia; BIA | Location only (already world-positioned) |
| Main passenger gates; ticket booths "north of the original entrance, partially covered by a canopy" | Wikipedia | The ticket block and its canopy, placed north of the building (provisional anchor, see §2.4) |
| **Four paired-counter ticket booths** (visible counter labels 8, 6, 4, 3, 2; pairs 8/7, 6/5, 4/3, 2/1 inferred), compact round/polygonal cabin fronts, saturated civic-blue upper fascia and lower panels, clear glass from waist to head height, silver curbs/frames; a shallow light-grey corrugated canopy on silver round columns with dark-blue steel beams, carrying the raised terminal name **JACK LAYTON FERRY TERMINAL** | City of Toronto 2025 terminal plan, background file 254999, **p.10** (coordinator-inspected; local copy `research/ferry-access-10.png`) | The modelled glazed booth block, canopy and title |
| Visitor maps, overhead queue and gate signage at the terminal | City ferry ticket/passenger information page (see §7) | Confirms wayfinding exists; route names are trusted, panel placement is an estimate |
| Terminal building footprint, angle, 4.5 m height (three-part plan) | OSM geodata (`GEO.buildings`, name match) | The modelled building and its colliders |
| Two mapped land fingers projecting south into the harbour, water channels either side | OSM harbour water outline (water mask) | Finger piers + kerbs; unassigned berth channels |
| Island docks: Centre `-608.1, 2524.9`; Hanlan's `-1207, 1659.2`; Ward's `1318.9, 2005.3` | OSM `ferry_dock` nodes | Route endpoints for the islands wave |
| Driving directions / schedule / fares / timetables / berth gates | — | **Not modelled** (no live prices or times invented) |

**Deliberately not invented:** the module does **not** assign a slip, gate or berth to a route, and draws no
per-slip canopies or gangways. No reviewed source states the physical slip-to-route arrangement, and the coordinator
instruction is explicit: do not infer physical architecture from terminal function, and do not assume one slip per
route. The three routes are represented by a single directory sign, the way a real terminal directory works.

## 2. Geometry

World frame: 1 unit = 1 m; world x is grid east, z is grid south; ground y = 0; lake surface y = −0.7 m
(`CITY_BOUNDS.waterLevel`).

### 2.1 Terminal building (measured)

From the geodata record `[cx, cz, ang, parts, h, …]` with `parts` as local `[u0, u1, v0, v1]` rectangles and
`x = cx + u·cos + v·sin`, `z = cz − u·sin + v·cos` (the `buildings.js` convention):

- centre `cx 230.7, cz 624.3`; angle `−0.549 rad`; height `4.5 m`; **three parts**.
- world bbox ≈ x 189.6–288.7, z 570.2–663.9; the whole footprint is dry land.
- Each part becomes one modelled box and one solid collider; a dark roof band (estimated 0.7 m) sits under the
  parapet. `buildingReplacedAt(x, z)` returns true across the three parts (plus an optional margin) so the captain can
  suppress the generic geodata massing where this building is drawn.
- The boxes are yawed by the record's own `ang` (a box's local +x then maps exactly onto the part's local u and its
  +z onto v, verified against the mapped corners). An earlier draft negated the angle, which mirrored the non-square
  parts; this wave corrects that so the drawn massing matches the measured footprint and the booths/canopy line up
  with it.

### 2.2 Mapped finger piers (measured, not guessed)

The OSM harbour water outline shows two land fingers projecting south from the quay into the harbour, read from the
water mask at z ≈ 676–696:

| Finger | x range | z range |
| --- | --- | --- |
| west-finger | 288–295 | 676–694 |
| east-finger | 319–327 | 676–696 |

Each is drawn as a low concrete quay finger with a kerb set just inside its landward water edge. These are the mapped
land features; the module does **not** claim a particular number of ferry berths beyond what the outline shows.

### 2.3 Water channels (measured, unassigned)

`ferryLayout().berths` samples the water mask at z = 684 south of the terminal and records the channels between and
beside the fingers (e.g. west basin, central slip, east slip). Each channel has `route: null` — it is **not** assigned
to a route. This is the honest state pending a labelled terminal plan or imagery.

### 2.4 Ticket block + canopy (front furniture, photo-grounded)

The Wikipedia account says the newer, larger ticket booths sit **north of the original entrance, partially covered by
a canopy**. The City's 2025 terminal plan (background file 254999, p.10) shows the actual entry: **four paired-counter
booths** with the counter labels 8, 6, 4, 3, 2 visible and the pairs 8/7, 6/5, 4/3, 2/1 inferred. The module therefore
draws **four** compact cabins (the plan's fronts read as round/polygonal; modelled as compact glazed boxes with silver
corner mullions), not the sixteen solid boxes a plain frontage division (`floor(frontage / 7)`) produced.

**Placement (source-backed north; anchor is a documented estimate).** The Wikipedia source puts the booths *north of
the original entrance*, and they are modelled on the north side with their glazed counters and canopy title facing
north (toward the entrance/Queens Quay). The exact entrance point is **not resolvable** from the merged geodata: the
terminal is three mapped parts, and the north front beside the old centre anchor is occupied by other mapped buildings
(the Westin Harbour Castle podium/tower rows), so four booths + their canopy overlap them there. A bounded search over
the real mapped parts finds the only clear north courtyard wide enough for the block at the **west end**; the block is
anchored there (`FERRY_BOOTH_ANCHOR`, local `u −52.0, v −28.0`) and a test asserts no booth or canopy part overlaps
any non-terminal geodata building. **This anchor is a documented estimate, not a survey** — see the register. Each
cabin is built as a distinct glazed booth:

| Part | Material / colour | Height (estimated) |
| --- | --- | --- |
| silver curb + plinth | brushed silver | 0.12 m |
| lower panel | saturated civic blue (`0x1f4f8f`) | 0.75 m (counter height) |
| silver counter lip | brushed silver | 0.14 m |
| **clear glazing** (waist to head) | tinted transparent glass, four silver corner mullions + centre mullion | 1.02 m band |
| silver head rail | brushed silver | 0.12 m |
| upper fascia | saturated civic blue | 0.36 m |
| dark roof plate | dark grey | 0.10 m |

Counter labels are recorded on `stats.boothPairs` / `stats.counterLabels` (`[8,7][6,5][4,3][2,1]`); the plan's visible
5-of-8 labels are the evidence, and the pairs are the inferred reading. **All sizes and spacing are photo-estimated**
from the plan, not surveyed.

The **canopy** is a light-grey corrugated sheet with a shallow fall toward the entrance (≈5.6° over a 5.6 m depth), on
four **silver round columns**, carried by **dark-blue steel beams** (one at each bay edge plus two purlins), with a
**cream fascia beam** on the north edge. The fascia carries the real name **JACK LAYTON FERRY TERMINAL** in raised cream
lettering (`ESTIMATES` + `TERMINAL_NAME`). The north edge is verifiably the low edge; all cabin and canopy parts are dry
land north of the building.

### 2.5 Route directory (legible names)

A single directory sign in the entrance courtyard beside the block carries three panels, one per route, ordered
Ward's / Centre / Hanlan's.
It is a terminal directory, not a per-slip gate sign. `stats.routeSignPoints` carries the three
`{routeId, name, x, z, y}`. Unlike the earlier colour-only boxes, each panel now carries its **route name drawn into a
bounded `CanvasTexture` atlas** (one 1024 px-wide texture, four rows: the canopy title + the three routes) and shown on
a transparent plane. The atlas is built once and never updated per frame. With no `document` (tests/workers) the atlas
is null and the planes are omitted; the coloured panels still stand and nothing throws. The route names are sourced;
the directory's physical placement is an **estimate**.

## 3. Route endpoint table (for the islands wave, st-sb3r.9)

`C.FERRY_ROUTES` / `ferryLayout().routes` carry `{id, name, short, color, endpoint}` only. Each `endpoint` also carries
`{osmType, osmId, source}` so the islands wave can cross-check the contract; they carry no slip/berth/gate fields —
tests assert this.

### 3.1 The endpoints are the real OSM island terminals (bike-POI bug corrected)

The earlier draft used bike-share-station coordinates for Centre and narrated a non-existent "inland duplicate" for
Ward. This wave replaces both with the **actual OSM island ferry terminals** fetched by the islands work into
`js/waterfront-island-arrivals-data.js`:

| Route | OSM feature | Endpoint (world x, z) | Anchor |
| --- | --- | --- | --- |
| Ward's Island | way `251286976` | `1318.936, 2005.305` | polygon vertex centroid |
| Centre Island | way `1175136270` | `−542.688, 2496.308` | polygon vertex centroid |
| Hanlan's Point | node `56794382` | `−1207, 1659.2` | the node point |

The values are **static** in the mainland module, so there is no dependency on the island-data load order (the captain
builds the island module after this one). A focused test loads `waterfront-island-arrivals-data.js` and asserts each
endpoint equals that feature's `centroid`/`point`, that its `osmType`/`osmId` match, that it is `amenity=ferry_terminal`
(not `bicycle_rental`), and that it lies within 70 m of harbour water. The invented `rejected` node and its narrative
are removed.

## 4. Build and integration

Call `createWaterfrontFerries(THREE, scene)`; it returns `{ group, colliders, stats, layout, routeByName,
buildingReplacedAt }` and sets `CITY.waterfrontFerries`. It only builds when the active frame really covers the mapped
terminal and the harbour water/fingers (`supportedCityFrame`): the building is dry, harbour water lies within ~40 m
south of the front, and both fingers are land.

| Stat | Typical value |
| --- | --- |
| terminalBoxes | 3 (one per mapped part) |
| ticketBooths / ticketCounters / ticketCanopies | **4 / 8 / 1** |
| boothPairs (`counterLabels`) | `[8,7][6,5][4,3][2,1]` |
| directoryPanels / textTextures | 3 / 1 (0 without a `document`) |
| fingerPiers / fingerKerbs | 2 / 4 |
| berths (unassigned channels) | 3 |
| meshes / triangles | ~19 / ~1,120 (headless; +4 label planes with a document) |
| colliders | 3 (the building parts) |

The group is one culling root; repeated parts are instanced; meshes carry `scene-culling.js` `cullDistance`/`cullCell`.

**Captain integration:** add `<script src="js/waterfront-ferries.js"></script>` after `city-config.js` and the geodata,
call the builder in the waterfront build path, and — if the generic geodata massing should not double-draw the
terminal — skip any `GEO.buildings` row whose centre satisfies `CITY.buildingReplacedAt(x, z)`. No other file in this
repo was edited by this module's author.

## 5. Capture shots

`tools/shots/waterfront-ferries.json` has a HUD-hide warm-up and street, lake, aerial (two times of day) and
finger-pier views plus a functional check. The **street close-ups are now derived from the geodata at run time**: an
**oblique view from the north courtyard** (`FERRY_BOOTH_ANCHOR` + a few metres, looking at the north booth facade),
inside the clear pocket beside the block — not the old fixed world point, not the blocked straight-on Queens Quay
view, and not a relocation of the source objects. Run on the Mac mini through `gpu2` (never the laptop GPU):

```sh
GPU2_LOCK_WAIT=600 gpu2 waterfront-ferries -- env \
  CAPTURE_QUERY='?quality=high&autoscale=0&transit=timetable&film&cloudSpeed=0&map=detail' \
  CAPTURE_PROGRESS=1 CAPTURE_TAG=ff \
  node tools/capture.mjs tools/shots/waterfront-ferries.json
```

Outputs copy to `$GPU2_REVIEW_DIR/waterfront-ferries/`. These are functional/visual evidence, not a performance budget.
The `ferry-terminal-check-enabled` shot throws if the terminal is disabled, the block is not exactly four booths /
eight counters / one canopy, the canopy or directory or fingers are missing, the title is wrong, any instanced
transform is non-finite, the Ward endpoint is not at water, or the central channel is not water. These are functional
checks only; **visual acceptance requires an actual GPU capture** (not claimed here).

## 6. Uncertainty register

- **Slip→route assignment:** not sourced. Not modelled. Needs a labelled City/terminal plan or ground imagery.
- **Slip count / berth layout:** the water mask shows two land fingers and three channels; the mapping between a
  channel and a boarding berth is not established. Not asserted.
- **Booth count is sourced; sizes, spacing, cabin shape and canopy span are estimated.** The City's 2025 plan (p.10)
  fixes four paired-counter booths (visible labels 8, 6, 4, 3, 2; pairs inferred); every dimension and the spacing are
  photo-estimated, not surveyed. **The exact entrance/booth location is unresolved**, so the block keeps the
  source-backed **north** orientation but sits at a **provisional anchor** in the only clear north courtyard; it is not
  at a per-slip gate, and it is not a survey position. A test forbids overlap with the adjacent geodata buildings.
- **Directory placement:** the route names are sourced; the directory's physical position and orientation are an
  estimate. No per-slip gate sign is modelled.
- **Canopy corrugation:** drawn as shallow ribs on a light-grey sheet; the exact profile is not in the source.
- **Fares/timetables:** deliberately not invented.
- **Terminal internal layout, waiting areas, bridges, ramps:** not sourced; not modelled.
- **Ferry vessels, schedules, animations:** out of scope for this task (a static moored ferry could be added later only
  if source-backed).
- **Island endpoints:** static OSM terminal centroid/point with `osmType`/`osmId` (see §3.1), cross-checked against
  js/waterfront-island-arrivals-data.js; the earlier draft's bike-station coordinates and invented "rejected" node are gone.
- **Roof detail:** the measured footprint/height are used; the roof band and cornice are an estimated read, not as-built.

## 7. Sources

- City of Toronto, Island Ferries — <https://www.toronto.ca/explore-enjoy/toronto-island-ferries/ferry-routes-schedules/>
- City of Toronto, Jack Layton Ferry Terminal access plan (2025), background file 254999, p.10 — the four
  paired-counter booths, glazed cabin fronts, shallow canopy and raised terminal name:
  <https://www.toronto.ca/legdocs/mmis/2025/di/bgrd/backgroundfile-254999.pdf> (local: `research/ferry-access-10.png`)
- City of Toronto, ferry ticket & passenger information (visitor maps, overhead queue and gate signage):
  <https://www.toronto.ca/explore-enjoy/toronto-island-ferries/ferry-ticket-passenger-information/>
- City of Toronto, Getting Around the Island — <https://www.toronto.ca/explore-enjoy/toronto-island-ferries/getting-around/>
- Waterfront BIA, Jack Layton Ferry Terminal — <https://www.waterfrontbia.com/listing/jack-layton-ferry-terminal>
- Wikipedia, Jack Layton Ferry Terminal — <https://en.wikipedia.org/wiki/Jack_Layton_Ferry_Terminal>
- OpenStreetMap contributors, ODbL — terminal building, terminal POI, harbour water outline, island ferry-dock nodes
  (fetched 2026-11-09 into the committed geodata).
- Cross-reference: [docs/waterfront-realism.md](waterfront-realism.md) §8–9.
