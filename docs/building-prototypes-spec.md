# Building prototypes: about 30 configurable Toronto building types

Draft 2026-11-14, for John's review. Nothing here is built; phase 0 (the count and the era investigation) has run and its
findings are in section 7. Bead: see "Tracking" at the end.

## 1. The idea

Every building in the detailed city is given one of about 30 named **prototypes**: Victorian bay-and-gable semi,
postwar bungalow, main-street shop with flats above, glass condo tower on a podium, church, and so on. A prototype is
a preset: a set of rules for the roof, the window layout, the wall materials and the add-on parts (porch, bay window,
gable, cornice, balconies). Each rule has a range, so two buildings of the same prototype differ, and the same
building always comes out the same.

The aim is that a street reads as the kind of street it is: an Annex street of tall brick semis looks different from
an East York street of bungalows, which today it does not.

## 2. What exists today

All in `js/buildings.js` (1,660 lines) unless noted.

- **Eight building kinds** from the geodata: 0 houses, 1 low-rise, 2 mid-rise, 3 towers, 4 sheds, 5 works,
  6 worship, 7 civic. The kind comes from OpenStreetMap's building type plus height.
- **Six facade materials** (`facadeStyles`): two rendered-wall styles (houses and low blocks; offices and
  commercial), three glass curtain walls, and the Distillery's Victorian brick. The kind picks among them with a
  random draw.
- **Three roof codes:** flat, pitched (a hip over the fitted rectangle), sheet.
- **Colour** from weighted palettes (`TORONTO_MASONRY`, `TORONTO_RENDER`, `TORONTO_STONE`) and a brick share per kind.
- **Shop fronts** on buildings with a storefront sign, a retail point of interest, or on a retail strip.
- **Hand-written special cases,** each wired in separately: the Distillery, the Island cottages, three Queen City
  Yacht Club building styles. `js/fire-escapes.js` adds fire escapes to some rear walls.
- **Real outlines** (`docs/massing-buildings.md`, epic st-2nl): the City's 3D Massing polygons for 35,254 buildings,
  with party walls, street-facing edges and tower-on-podium bases already worked out. Still behind `?massing=1`;
  making it the default is st-2nl.7 and waits on a performance baseline.

So a house is currently "a rendered box with a hip roof in a random Toronto brick". There is no notion of semi,
row, era or style, and each new look has cost a new special case.

## 3. Design

### 3.1 Families, with presets inside them

Thirty independent models would mean thirty sets of geometry code. Most of the list is a handful of **families**
with different settings, so the code is written once per family:

| Family | What varies inside it |
|---|---|
| House | attachment (detached, semi, row), era, storeys, roof form, porch, bay window, cladding |
| Garage and outbuilding | size, roof, door |
| Main-street building | storeys, shop front, cornice, era |
| Walk-up apartment | storeys, entrance, balconies, era |
| Tower | slab or point, podium, balconies, cladding (brick, concrete, glass), top |
| Office and commercial | curtain wall or masonry, storeys, ground floor |
| Industrial | brick warehouse, low shed, big box |
| Civic and worship | church, school, small civic (fire hall, library), institutional block |

### 3.2 What a prototype holds

One entry in a catalogue file (proposed: `js/building-prototypes.js`, plain data):

- **Name and family.**
- **Match rule:** which buildings it applies to (§3.4).
- **Form:** storey height, roof form and pitch range, setback or podium rule.
- **Facade:** which existing facade material it draws with, window width and spacing, ground-floor treatment.
- **Palette:** weighted colours and materials (brick, stone, stucco, siding, glass).
- **Parts:** optional add-ons with a probability and size range each: porch, bay, front gable, dormer, cornice,
  chimney, balconies, rooftop mechanical box.
- **Ranges, not fixed values,** for anything that should vary.

### 3.3 Variation

Every random choice for a building is drawn from a number seeded by its durable ID (`to-3dmassing-2025:<fid>`,
`docs/geodata-ids.md`). A building then looks the same on every load and after every data rebuild, and changing one
prototype does not reshuffle the others. Today's draws come from one shared sequence, so adding a draw for one
building can change its neighbours.

Neighbours should also agree where real ones do: the two halves of a semi share a roof and mirror each other, and a
row shares its cornice line. The party-wall data says which buildings are joined.

### 3.4 Assigning a prototype to each building

This is the hard part. A script run once on the build machine classifies every footprint and writes one small number
per building (the prototype) into the building data the page already loads. Nothing is classified in the browser.

Inputs we already have, per building:

| Input | Gives |
|---|---|
| Party walls (count and which sides) | detached, semi, row |
| Height, and maximum minus average height | storeys; pitched or flat roof |
| Footprint area, frontage width, depth | house versus block versus tower; garage |
| Position on the lot (behind another building, on a lane) | garage or outbuilding |
| Street-facing edges, main street or not | main-street building versus side-street house |
| Tower standing on a podium | podium tower |
| OpenStreetMap building type and name (the current kind) | worship, civic, school, industrial |
| Storefront signs and retail points of interest | shop front |

**Era is the gap.** Nothing we hold says a house is from 1890 rather than 2015, and era is what separates most of
the house presets. Candidates to check, none verified for this purpose:

- the City's Heritage Register (already fetched as address points for the place cards);
- City building permit records (for new builds);
- the City's apartment building registration data (for apartment blocks);
- OpenStreetMap `start_date` tags (expected to be sparse);
- failing those, era by neighbourhood: a hand-drawn map of "mostly built in" periods, which is how the city
  actually developed, plus the roof and footprint signals above to pick out the newer infill.

This needs a data investigation with a record in the shared Toronto data repo's `registry/investigations/`,
per the repo rules. I searched the registry for year-built and zoning sources and found none recorded yet.

**Overrides.** A small file keyed by durable ID (or by a drawn area) forces a prototype where the rules get it
wrong. The Distillery, Island cottage and yacht club cases can move into this later; they stay as they are for now.

**Fallback.** A building that matches nothing keeps today's look, so the city is never worse than now, and the
share of fallbacks is the measure of progress.

### 3.5 Drawing them without slowing the city down

- Prototypes feed the existing merged geometry (one mesh per facade material per cell). **No new material or draw
  call per prototype.** Per-building settings ride in the per-building table the compact massing cells already
  have.
- Add-on parts (porches, bays, gables) are extra triangles in the same merged meshes, **near tier only**, with a
  triangle budget per cell agreed before building them.
- Roofs for semis and rows need a ridge along the row and gables on the street side. That overlaps the
  "straight-skeleton hips and gables" item already planned in `docs/massing-buildings.md`.
- **Dependency:** prototypes need the polygon outlines. The fitted boxes cannot express a semi or a row. So this
  work sits on `?massing=1` and ships to everyone only when st-2nl.7 does.
- Performance is measured on the Mac mini against a matched baseline, as for the massing work.

### 3.6 A page to look at them

A gallery view (proposed `?prototypes=1`) that stands one of each prototype in a row, with a few seeds each, and
lets a setting be changed and seen. This is where a prototype is tuned and where John reviews them, without hunting
for an example in the city.

## 4. The list (first draft; superseded by section 7.8)

This is my starting guess from knowing Toronto, **not from data.** Phase 0 counts the real footprints and the list
is redrawn from that. I expect garages and outbuildings to be the largest single class by count, and about a dozen
presets to cover over 90% of buildings.

**House (13)**
1. Victorian bay-and-gable semi
2. Victorian bay-and-gable row
3. Victorian mansard-roofed row
4. Worker's cottage (one and a half storeys)
5. Edwardian detached, full-width porch
6. Edwardian semi
7. Interwar brick detached
8. Wartime one-and-a-half-storey house
9. Postwar bungalow
10. Postwar two-storey or split-level
11. New-build detached infill (flat roof, large glazing)
12. Large replacement house (stone and stucco, 2000s)
13. Modern townhouse row

**Garage and outbuilding (2)**
14. Lane garage
15. Laneway or garden suite

**Main street (3)**
16. Shop with flats above (two to three storeys, brick, cornice)
17. One-storey retail strip
18. New mid-rise with shops at grade (six to twelve storeys)

**Apartments and towers (5)**
19. Interwar walk-up apartment
20. Co-op or social-housing low-rise block
21. Postwar slab tower with balconies
22. Concrete condo tower, 1970s to 1980s
23. Glass condo tower on a podium

**Office, commercial, industrial (5)**
24. Brick-and-beam warehouse
25. Dark curtain-wall office tower
26. Contemporary glass office
27. Low industrial shed
28. Big-box store or supermarket

**Civic and worship (4)**
29. Church
30. School
31. Small civic building (fire hall, library, community centre)
32. Institutional block (hospital, university)

Landmarks stay hand-modelled and are not prototypes.

## 5. Phases

| Phase | What | Done when |
|---|---|---|
| 0a. Count | Script that classifies every massing footprint by attachment, storeys, area, lot position and current kind, and prints the counts | A table of classes with counts and share; §4 redrawn from it |
| 0b. Era investigation | Check the candidate sources in §3.4 | Registry record written, including if nothing usable is found; era method chosen |
| 1a. Skeleton | Catalogue file, assignment script and per-building preset, era by neighbourhood with per-building years, a debug view that paints each building its preset's colour, fallback (st-ndw9.10, `docs/building-presets.md`) | `?massing=1` draws the same city as before; `?massing=1&presets=debug` reads as a map of the assignment; every building has a preset |
| 1b. Gallery page | `?gallery=presets` (st-ndw9.13; the spec's first name was `?prototypes=1`) stands every preset in a row of six, from the same code that draws the city, to tune and review | A prototype reviewed in captures |
| 2. House family | Presets 1 to 13, joined roofs for semis and rows, porches and bays | One Victorian area and one postwar area reviewed in captures; cell triangle budget held. **Drawn (`?massing=1&presets=draw`): st-ndw9.13 the Victorian bay-and-gable semi, the Edwardian detached house and the Victorian row; st-ndw9.15 the other ten house presets (Victorian detached, Edwardian semi and row, interwar detached and semi, postwar detached and semi, recent detached and semi, modern townhouse row).** A drawn house has a composed front and the City's real back (section 8, decision 8) and a joined row has one roof (decision 9). See `docs/massing-buildings.md` |
| 3. Garages, main street, walk-ups | Presets 14 to 20 | A main street and its lanes reviewed. **Drawn so far (st-ndw9.15): the two main-street shop presets** (the early brick shop with a cornice and tall narrow upper windows, the later plain one): the page's own shop fronts and signs stay as they are, the storeys above, a cornice and a parapet are drawn. Garages and walk-ups are not drawn |
| 4. Towers, office, industrial | Presets 21 to 28 | Downtown and one tower cluster reviewed. **Drawn so far (st-ndw9.20, `?massing=1&presets=draw`): walk-up apartment, mid-rise block, slab tower, glass tower on a podium, dark curtain-wall tower, contemporary glass, the untagged tower, the low masonry block and the plain low block** (`js/building-draw-tall.js`: walls to whole storeys in a style of the rendered or curtain-wall material, a tar roof, parapet, cornice, mechanical penthouse or stepped crown and balcony bands in the roof batch; a podium and its tower take different styles; a mid-rise on a group footprint under 300 m2 keeps today's look). Industrial presets are not drawn |
| 5. Civic and worship | Presets 29 to 32 | Reviewed against the named OSM buildings. **Worship drawn (st-ndw9.20): the six worship presets** (`js/building-draw-worship.js`: a gable along the nave with a tower and spire, a porch and bellcote, a dome and a minaret, twin towers and a round window, a tiered, stepped or domed temple, by the group's religion and tradition). Civic presets are not drawn |
| 6. Tuning | Overrides, neighbourhood palettes, moving the old special cases in | Fallback share under the target |

## 6. Acceptance

- At least 90% of buildings carry a non-fallback prototype (target to confirm once the counts are in).
- A spot check of assignment against Street View for a sample in each phase's area, with the hit rate recorded.
- The default page is unchanged until st-2nl.7 ships; behind the flag, no added draw calls and frame time within
  the agreed margin of the matched baseline on the Mac mini.
- Every phase ends with captures, not a description.

## 7. What phase 0 found (2026-11-14)

Two workers ran phases 0a and 0b. Sources: `docs/building-classes.md` and `tools/building-classes.json` (PR #153),
`docs/building-era-sources.md` (PR #154), neither merged yet. "Checked" means the coordinator recounted it from the
raw files; the rest is the workers' own run.

### 7.1 A massing record is not a building

- **Big buildings are many records.** The 35,254 records join through shared walls into 22,855 groups. The 967
  groups whose tallest part is a tower hold 6,804 records. Tower, mid-rise, civic and worship prototypes must apply
  to a group of parts, not to a record. (Checked in outline: 2,848 of 3,981 tower records have shared walls on two
  opposite sides.)
- **Many semis are one record.** 12,168 of the 16,073 house records have no shared wall (checked), and their
  narrow side has a median of 9.1 m. Of those with no shared wall, 3,961 contain two City address points (checked).
  So shared walls alone cannot tell a semi from a detached house; **address points per outline can.**

  | Address points inside a house outline | Outlines | Share |
  |---|---|---|
  | 0 | 1,918 | 12% |
  | 1 | 7,983 | 50% |
  | 2 | 4,800 | 30% |
  | 3 or more | 1,372 | 9% |

- **Shared walls, all records** (checked, to within 66 records): none 21,289; one side 4,916; two opposite sides
  7,273; corner 1,776. Houses only: none 12,168; one side 2,472; two opposite sides 971; corner 462.

### 7.2 Today's "kind" comes from height and mislabels houses

`tools/geo-features.mjs` sets the kind from the height: five storeys' worth of height (about 17 m) makes a
mid-rise, ten makes a tower, and a house must be three storeys or less. The height is the lidar maximum. Records
under 250 m² of footprint: 6,284 of the 9,503 mid-rise records and 1,965 of the 3,672 low-rise ones (checked).
Some are parts of larger buildings, but the seeded examples of "mid-rise with no shared wall" are 180 to 310 m²
outlines on residential streets. So the real share of houses is probably well above 16,073, and the prototype
assignment should not start from the kind. **Not yet measured:** how many of these are houses. The massing file
has an average height as well as a maximum, which would show it.

### 7.3 Garages are not a class

Small, low records with no street edge: 265 (0.75%). The guess in section 4 that garages would be the largest class
was wrong; presets 14 and 15 drop out unless a later source adds them.

### 7.4 Era: no source covers the city

| Source | Buildings | Share | Bias |
|---|---|---|---|
| City Heritage Register, construction year | 2,153 | 6.1% | 88% before 1919 |
| RentSafeTO apartment registration, year built | 555 | 1.6% | apartment blocks |
| New-building permits | 516 | 1.5% | 2012 to 2026 |
| OpenStreetMap start dates | 46 | 0.1% | |
| All four, de-duplicated | 2,999 | 8.5% | |

Statistics Canada's period-of-construction table was reachable only for the whole metropolitan area; the
small-area pages answered with a security check, so census shares by neighbourhood are untested, not ruled out.
The other 91.5% needs the "mostly built in" map by neighbourhood (section 3.4), checked against the 2,153 heritage
years. Registry record: `registry/investigations/slop-building-era.md` in the shared Toronto data repo.

### 7.5 The bigger desktop map

It has 140,541 building records and drew boxes only. Checked on 2026-11-17 (st-ndw9.21): its geodata holds each of
today's 35,266 rows unchanged, in another order (only 2,216 sit at the same row number), so the detail map's outline file
was refused there ("built for other geodata": `row` and `rowCheck` are for the detail map's list). Every one of the
35,254 outline records is on the bigger map, found by its durable ID and by the row's contents alike; the file now also
carries each record's row in the bigger map's list, so the same outlines and the same presets serve both maps. Inside
the downtown frame the bigger map has 35,284 buildings: the 35,266 of today's map and 18 that stand on the frame's line
and that today's map clipped (they keep their boxes). Outside the frame there are no outlines yet.

### 7.6 What this changes in the design

1. Assignment works on **groups** for anything that is not a house, and on **outline plus address count** for houses.
2. Add the City address points as an input to the assignment script (147,084 in the frame, already fetched).
3. Replace the height-only kind with a rule that uses footprint size, average height and address count.
4. The list in section 4 is redrawn in section 7.8 from the recount (section 7.7).
5. The recount's inputs now come from the shared `buildings/3` dataset through `data/shared-toronto-data-pin.json`: `tools/build-building-inputs.mjs` joins it to the massing sidecar, and `tools/report-building-forms.mjs` reads only that file (st-ndw9.5).

### 7.7 The recount (2026-11-15): 22,855 buildings, 70% of them houses

`docs/building-forms.md` and `tools/building-forms.json` (PR #155, bead st-ndw9.3) redo the classing per building
with two new inputs: City address points inside each outline and the massing file's average height. A record is
house-scale when its footprint is under 250 m², its average height is under 11 m and OpenStreetMap does not tag it
as business, civic, worship, apartments, industrial or a shed. Checked by the coordinator: 19,638 house-scale
records, exactly the worker's figure; 4,037 of the 9,503 "mid-rise" records and 1,393 of the 3,672 "low-rise" ones
are house-scale. The rest of this table is the worker's run, rolled up by the coordinator from its 438 forms.

| Buildings | Share | What |
|---|---|---|
| 9,050 | 39.6% | House, detached (one dwelling, no shared wall; includes 1,939 house-scale outlines with no address point, less any of those in pairs or rows) |
| 5,745 | 25.1% | House, semi (two dwellings: one outline with two address points, or a joined pair) |
| 1,300 | 5.7% | House, row (three or more dwellings in one outline or chain) |
| 1,722 | 7.5% | 3 to 5 storeys by maximum height, side street, no OpenStreetMap use tag |
| 1,326 | 5.8% | 5 to 13 storeys by maximum height, side street, no use tag |
| 887 | 3.9% | 3 to 13 storeys, main street, no use tag |
| 1,034 | 4.5% | Tagged apartments (286 at 3 to 5 storeys, 358 at 5 to 13, 370 at 13 or more, 20 lower) |
| 566 | 2.5% | Tagged business (shops, offices, hotels): 235 at 3 to 5 storeys, 133 at 5 to 13, 126 at 13 or more, 72 lower |
| 672 | 2.9% | 13 storeys or more, any use (216 of them on a podium); overlaps the two rows above |
| 402 | 1.8% | Civic (323) and schools (79) |
| 125 | 0.5% | Worship |
| 146 | 0.6% | Sheds (98) and industrial (48) |

What it means:

- **Three house forms are 70% of the city's buildings** but only 20% of its footprint area. With era they become
  most of the preset list: detached, semi and row, each in four or five periods.
- **The biggest unknown is 3,048 untagged side-street buildings of 3 to 13 storeys** (13%), median footprint about
  300 m². Their height band uses the lidar maximum, so many may be large houses, or houses under trees. Nobody has
  looked at them. They need a visual spot check before a preset is designed for them.
- **The thresholds matter.** Moving the average-height limit from 11 m to 8.8 m drops house buildings from 16,095
  to 13,366; to 13.2 m raises them to 16,554. The 250 m² limit moves them between 14,131 and 16,947.
- **Tall buildings are few:** 672 of 13 storeys or more. They are a large share of what is seen from a distance, so
  they keep their presets despite the count.
- The worker's "suggested preset" column in `docs/building-forms.md` is not useful (it names one preset for almost
  every non-house form) and should be ignored.

### 7.8 The list, redrawn from the second count (superseded by section 7.9)

| Family | Presets | Buildings covered |
|---|---|---|
| House, detached | by period: Victorian, Edwardian, interwar, wartime and postwar, new build | 9,050 |
| House, semi | by period: Victorian bay-and-gable, Edwardian, interwar, postwar, new build | 5,745 |
| House, row | Victorian row, mansard row, modern townhouse row | 1,300 |
| Large house or small block, side street | to be defined after the spot check | 3,048 |
| Main-street building | shop with flats above; one-storey strip; new mid-rise with shops | 887 untagged, plus tagged shops |
| Apartments | walk-up; mid-rise block; slab tower; glass tower on a podium | 1,034 |
| Office and commercial | masonry low-rise; dark curtain-wall tower; contemporary glass | 566 |
| Civic | school; small civic; institutional block | 402 |
| Worship | church | 125 |
| Industrial | brick warehouse; low shed | 146 |

That is about 29 presets, 13 or 14 of them houses. Garages, big-box stores and the one-and-a-half-storey worker's
cottage as separate presets drop out of the first list; the cottage becomes a setting of the detached house.

### 7.9 Where phase 0 ended (2026-11-15): the shared dataset, the spot check, the final counts

Sections 7.1 to 7.8 are the record of how the measurements went; this section is where they ended up.

- **The facts moved to a shared dataset.** John decided the per-building facts belong in the shared Toronto data
  repo, with Slop keeping its prototype catalogue and a pin. The dataset is `buildings/3`: one row per City massing
  part, city-wide, with address points, heights, shared walls, joined groups, a use class from OpenStreetMap,
  house-scale, dwellings, form and a construction year where a source has one. Slop reads it through
  `data/shared-toronto-data-pin.json` into `tools/data/building-inputs.json`.
- **A visual spot check changed the house test.** The coordinator read 84 seeded examples from the City's 2025
  aerial imagery. Of 48 buildings the recount called "3 to 13 storeys, side street", 39 were houses, semis or rows
  and none was a mid-rise: the City's lidar heights include tree canopy, and several dwellings drawn as one outline
  failed a 250 m² limit. `buildings/3` tests footprint per address point (under 250 m², total under 800 m²) and a
  canopy-robust height (under 11 m). It accepts 66 of the 71 houses read (34 before) and rejects 8 of 10
  non-houses. Twelve examples per form, read from above only: enough to choose between rules, not a measured rate.

**Downtown buildings by form** (`docs/building-forms.md`, from `buildings/3`):

| Form | Buildings | Share |
|---|---|---|
| House, detached | 9,168 | 40.3% |
| House, semi | 6,291 | 27.7% |
| House, row | 2,950 | 13.0% |
| Garage or shed | 95 | 0.4% |
| Everything else | 4,233 | 18.6% |
| All | 22,737 | |

**Everything else, by use tag and height** (coordinator's count over the dataset; height from the lidar maximum):

| Use tag | 1 to 2 storeys | 3 to 5 | 6 to 12 | 13 to 39 | 40 or more | Total |
|---|---|---|---|---|---|---|
| No specific use | 77 | 1,066 | 518 | 133 | 52 | 1,846 |
| Apartments | 7 | 368 | 318 | 298 | 85 | 1,076 |
| Business | 39 | 317 | 110 | 118 | 48 | 632 |
| Civic | 21 | 163 | 172 | 43 | 8 | 407 |
| Worship | 2 | 68 | 48 | 8 | 0 | 126 |
| Shed | 28 | 43 | 19 | 5 | 2 | 97 |
| Industrial | 8 | 26 | 16 | 1 | 1 | 52 |

772 of them have a shop and 384 stand on a podium. For the 1,846 with no specific use, the preset has to come from
height, footprint, shop fronts and whether the building faces a main street.

**Era.** No source dates most buildings (section 7.4). The City's Neighbourhood Profiles give census period of
construction per neighbourhood, but their oldest band is "1960 or before". The coordinator drafted a split of
house periods (Victorian, Edwardian, interwar, postwar, recent) for the 31 neighbourhoods in the frame; it is
judgement, not measurement, and lives in the shared data repo as `build/neighbourhood-era/downtown-era-draft-1.json`.

**The preset list, from these numbers** (replaces section 7.8):

| Family | Presets | Buildings |
|---|---|---|
| House, detached | Victorian, Edwardian, interwar, postwar, recent | 9,168 |
| House, semi | Victorian bay-and-gable, Edwardian, interwar, postwar, recent | 6,291 |
| House, row | Victorian row, Edwardian row, modern townhouse row | 2,950 |
| Apartments | walk-up (3 to 5 storeys), mid-rise block, slab tower, glass tower on a podium | 1,076 |
| Business | low masonry block, dark curtain-wall tower, contemporary glass | 632 |
| Untagged block | main-street shop with flats above (early, later), plain low block, mid-rise block, tower | 1,846 |
| Civic | school, small civic, institutional block | 407 |
| Worship | Gothic church with a tower, plain brick chapel, modern church, mosque, synagogue, temple | 159 in the frame take a worship preset (plus 9 congregations in a house that keep a house preset) |
| Industrial and sheds | brick warehouse, low shed | 149 |

About 33 presets, 13 of them houses. The rare recognisable types stay regardless of count (John's decision). The six
worship presets replace the single `church` (st-ndw9.16, section 8); the counts are in `docs/building-presets.md`.

**Main-street buildings (st-ndw9.11).** The main-street shop preset splits by era —
`main-street-shop-early` (Victorian & Edwardian) and `main-street-shop-later` (interwar on) — and a building of five
storeys or fewer is a main-street building when Slop's own shop-front rule (a source-keyed sign, a mapped retail
place, or a retail strip on the street it fronts) gives it a shop front, whatever its form or use class, ahead of the
house and use-class rules; worship, civic and schools keep their own presets. Phase 1a's rule asked for an
OpenStreetMap shop tag and a main street and found 38; the shop-front rule finds 1,227 (946 early, 281 later), and 941
taller buildings with a shop front keep their other preset. `docs/building-presets.md` has the counts and the
seeded examples.

**Known weak spots.** From above, a gap under a metre between houses cannot be seen, so about a third of the
detached-or-attached readings in the spot check were uncertain. Nobody has read the City's definition of
`MIN_HEIGHT`, which the canopy-robust height relies on where it exists. Heights of the non-house buildings are
still lidar maximums.

## 8. Decisions

Decided by John, 2026-11-15:

1. **Which map:** the downtown frame first. The bigger desktop map follows once its outline file is built.
2. **Detail level:** right from a bike and the air first (roof forms, massing, colour, window rhythm) for every
   type; porches, bays and gables on the house family afterwards, near the camera only.
3. **Era:** a "mostly built in" map by neighbourhood, with per-building years used where they exist. Draft 1 is
   used as it is; John corrects neighbourhoods when they look wrong in the city.
4. **Where the facts live:** the shared Toronto data repo (now `buildings/4`), with Slop's wall rule, a use class
   from OpenStreetMap and garages separated. Slop keeps the catalogue and a pin.
5. **Build order:** prototypes are built behind `?massing=1` now, while the outline default (st-2nl.7) waits.
6. **The gallery page:** an internal tool behind a flag (`?prototypes=1`), not a public page.
7. **List size:** by the counts, plus a small fixed set of rare but recognisable types (church, school, small
   civic, warehouse).
8. **Places of worship look like what they are (John, 2026-11-15; bead st-ndw9.16).** About six looks: one each for a
   mosque, a synagogue and a temple, and three for churches — an older Gothic church with a tower, a plain brick
   chapel and a modern church — chosen by tradition and construction year. The shared dataset `buildings/4` adds, on
   worship groups, `religion` (christian, muslim, jewish, buddhist, hindu, sikh, other, unknown), `tradition` for
   Christian ones (roman catholic, anglican, united, presbyterian, baptist, lutheran, orthodox, pentecostal and
   evangelical, other, unknown) and the raw values, plus the `school` a part stands on. `tools/build-building-presets.mjs`
   assigns the six presets ahead of the main-street, house and use-class rules: muslim gives `mosque`, jewish gives
   `synagogue`, buddhist, hindu or sikh give `temple`, and every other religion (christian, or one the data does not
   name) gives a church by year and size — built before 1930 is `church-gothic` when the footprint is at least 400 m²
   or the tradition is roman catholic, anglican, presbyterian or orthodox, else `church-chapel`; 1930 to 1959 is
   `church-chapel`; 1960 on is `church-modern`. A congregation in a house keeps its house preset. Drawing the six is
   the next phase; `docs/building-presets.md` has the counts, the thresholds and the examples.

Decided by John, 2026-11-15, after looking at the first three drawn presets (st-ndw9.13):

8. **Clean front, real back.** The street side of a drawn house stays a clean composed front (gables, bays, porch,
   door). Behind it the house follows the City's real outline, so a rear wing or an extension shows from the lane and
   from the air. The rule that was built (`js/building-draw.js`, st-ndw9.15): the front line is the front edge's line;
   what the outline has in front of it (an old bay, a porch) is dropped; the main block is a rectangle as wide as the
   outline through its first 7 m and as deep as the outline keeps that width (within 0.9 m a side); what lies behind
   it is the rear wing, the real outline there, one storey lower (at most two) under its own flat roof, a record of its
   own in every tier; the block's rear wall stands above it. A front edge that does not fit is replaced by the next
   street or road-facing edge, longest first, up to three.
9. **One roof per joined row.** Houses that share walls are one terrace: a continuous roof (a mansard or a run of
   gables, or one side gable) and one cornice line, with no seam or step at a shared wall. Built as: a joined group
   shares its roof form, colour, pitch, cornice height and ridge height (a run of gables has one ridge level whatever
   its houses' widths; a mansard's deck has one height whatever its depth); a hip never stands against a party wall (the
   group's roof carries on as a side gable); a party side has no overhang and no end; and the houses of a joined run stand on one
   front line, the run's median, for every house within 1.5 m of it (a house further out is a real step in the City's outlines).

Decided by John, 2026-11-17 ("I don't want to launch, just launch things. Don't hide them behind these URL query
parameters"), by dialog:

10. **The school fence is on for everyone on desktop, no parameter.** `?schoolFences=0` is the off switch and a comparison
    aid; the phone tier has no fence and fetches no fence file.
11. **Drawn buildings downtown on the default page now.** The default desktop page (the bigger map) shows the drawn
    presets wherever the outline and presets data exist (the downtown frame) and today's boxes outside it. Extending the
    outlines outward comes later. `?presets=0` is the old look everywhere.
12. **Desktop first.** Phones keep today's page (no outlines, no presets files) until the cost is measured on a real phone.

## Tracking

Epic st-ndw9. It depends on the massing polygons (st-2nl; default-on is st-2nl.7). Children st-ndw9.1 to st-ndw9.9 cover
phase 0 (the counts, the era investigation, the shared dataset and its checks).
