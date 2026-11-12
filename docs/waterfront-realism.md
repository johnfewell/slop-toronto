# Waterfront BIA realism reference

Living source dossier for the Waterfront BIA realism pass (epic `st-sb3r`). It records the official study extent, the
world-frame position of each place, observed dimensions and materials, the original baseline gap audit, and the current
state of the integrated implementation waves.

This document changes no application code. It distinguishes two things clearly:

- **Baseline gap audit (2026-11-09 snapshot)** — what the runtime looked like before the width-of-the-BIA pass. These
  paragraphs are history, not a description of the current build.
- **Reviewed procedural implementation** — modules integrated, tested on both shipped maps, and inspected in desktop
  and phone GPU captures (§10–§11). This does not claim every BIA parcel is surveyed or photorealistic.

Retrieved 2026-11-09. Dimensions marked "OSM measured" are shoelace areas / bounding boxes computed from the
OpenStreetMap geometry at retrieval time; they include the mapped outline, not necessarily the maintained property
boundary, so treat them as cross-checks. "Uncertain" means not confirmed by an official measured figure.

## 1. Scope

The official City of Toronto BIA map (May 2019) is the authoritative boundary. It includes the **mainland from
Stadium Road in the west** through the Queens Quay corridor to **Cherry Street in the east**, the Lake Shore south
edge, and the **Toronto Islands** (the map labels Toronto Islands, Olympic Island Pk, Algonquin Island, the
Toronto–Centre Island Ferry Route, South Island and Ward's Island Ferry Route), **except the Billy Bishop Toronto
City Airport lands**. The BIA's prose summary, "the Queens Quay corridor between Bathurst and Cherry St", is a
short-hand for the business corridor; it does not exclude Stadium Road or the Islands.

- BIA page: <https://www.waterfrontbia.com/about-waterfront-bia>
- BIA boundary map (PDF, May 2019): <https://www.toronto.ca/wp-content/uploads/2021/10/97b2-edc-Waterfront-BIA-map2021-accessible.pdf>
- Waterfront Toronto central waterfront (Bathurst to Lower Jarvis; context for the public realm):
  <https://www.waterfrontoronto.ca/our-projects/scope-scale/central-waterfront>

For this realism pass the **study area is the official BIA map extent**: Stadium Road / Bathurst Quay west,
Cherry Street east, Lake Shore south, and the Toronto Islands except the airport. Island references below are
therefore in scope, not an extension beyond membership.

## 2. World-frame positions

The app maps latitude/longitude to world metres with `GEO.frame.projection` (`lat0 43.6453`, `lon0 -79.3806`,
`theta -0.2895 rad`, `kx 80682.47`, `ky 111105.32`; `js/city-config.js` `worldFromLatLon`). Ground is `y = 0`, the lake
surface is `y = -0.7` (`CITY_BOUNDS.waterLevel`), and heading `0` faces grid south (+z). The `detail` and `eglinton`
frames share this projection; only their bbox and building indices differ.

| Place | Approx. world x, z | Source of position |
| --- | --- | --- |
| Sugar Beach sand | 941, 521 | OSM `natural=beach`, centre |
| Sugar Beach park | 997, 504 | OSM `leisure=park`, centre |
| HTO Park East | -838, 615 | OSM `leisure=park`, centre |
| HTO Park West | -992, 598 | OSM `leisure=park`, centre |
| HTO Beach | -826, 666 | OSM `natural=beach`, centre |
| Toronto Music Garden | -1335, 578 | OSM `leisure=park`, centre |
| Harbourfront Centre | -389, 630 | OSM building, centre |
| Spadina WaveDeck | -1106, 573 | OSM `highway=pedestrian`, centre |
| Simcoe WaveDeck | -518, 584 | OSM `highway=pedestrian`, centre |
| Rees WaveDeck | -742, 572 | OSM `highway=pedestrian`, centre |
| Jack Layton Ferry Terminal (building) | 230.7, 624.3 | OSM building record, centre |
| Ward's Island ferry terminal | ≈1319, 2005 | **OSM `amenity=ferry_terminal` way 251286976**, ring centroid |
| Centre Island ferry terminal | ≈-543, 2496 | **OSM `amenity=ferry_terminal` way 1175136270**, ring centroid |
| Hanlan's Point ferry terminal | -1207, 1659.2 | **OSM `amenity=ferry_terminal` node 56794382** |
| Centre Island north shore | -492, 2613 | camera preset reference |
| Centre Island south beach | -608, 3376 | existing water-edge capture |
| Ward's Island beach | 1400, 1970 | OSM beach relation, centre |

### 2.1 Corrected island terminal points (important)

The positions used in the original baseline audit for the island docks were **not ferry terminals**. The geodata
labels them `"Centre Island Ferry Dock"`, `"Ward's Island Ferry Dock"`, `"Hanlan's Point Ferry Dock"`, but those
features are **Bike Share Toronto docking stations** (`amenity=bicycle_rental`) — e.g. node 12966081673 "Centre Island
Ferry Dock" is a 35-dock bike station, and the old Centre point `-608.1, 2524.9` sits ~65 m inland of open water.

The real terminals were acquired from the official OSM API (`tools/build-island-arrivals.mjs` →
`js/waterfront-island-arrivals-data.js`) and are used by `js/waterfront-island-arrivals.js`:

| Dock | Real OSM feature | Corrected world point |
| --- | --- | --- |
| Ward's Island | way **251286976** "Ward's Island Ferry Dock" (22-pt polygon, `wheelchair=yes`) | ring centroid ≈ 1319, 2005 |
| Centre Island | way **1175136270** "Centre Island Ferry Terminal" (26-pt polygon) | ring centroid ≈ -543, 2496 |
| Hanlan's Point | node **56794382** `amenity=ferry_terminal` (+ taxi quay way **1375105747**) | -1207, 1659.2 |

The mainland ferry module's route-endpoint table is being reconciled to these real terminal points by the ferry owner
(see §9); the OSM source ids above are authoritative.

`js/cameras.js` places the Sugar Beach scenic camera at 43.6421, -79.3662 (world ≈ 1012, 672), which is **over the
harbour / Jarvis Slip, not on the mapped sand**; treat it as an offshore camera, not a ground position. `TELEPORT_LOCATIONS.start`
is at 970.7, 575.9 on Sugar Beach's lawn, not on the sand.

## 3. Wavedecks (Spadina, Simcoe, Rees)

Official design/numbers (Waterfront Toronto, "Wavedecks"):

- Three urban docks at the heads of the **Spadina, Rees and Simcoe slips**, Queens Quay; designed by **West 8 + DTAH**,
  built by Somerville; opened late 2008 / early 2009; owned/operated by the City.
- **Spadina**: 630 m²; first deck (2008); 57 m backless bench; amphitheatre steps; links the Music Garden and HTO Park.
- **Simcoe**: 650 m²; curves rise **2.6 m** above the lake; 30 m backless bench; two large swells; slender stainless
  steel railings following the wave form.
- **Rees**: 480 m²; completed 2009; dips toward the water; removable toe rail at the centre for small-boat boarding.
- Materials/accessibility: timber deck and stairs; **stainless steel nosing** with grip texture and a white edge strip
  at Simcoe and Rees; raised tactile dots at deck edges; a **stainless steel disc pathway** marking the accessible
  route; large barrier-free zones at Simcoe and Rees.
- Habitat: the decks created **1,780 m²** of new fish habitat (riverstone shoals, tree logs, embankments).

Source: <https://www.waterfrontoronto.ca/our-projects/wavedecks>

OSM cross-check (measured from current geometry):

| Deck | OSM area | OSM bbox | Official |
| --- | ---: | --- | --- |
| Spadina | 610 m² | 59.5 × 26.7 m | 630 m² |
| Simcoe | 618 m² | 62.0 × 27.5 m | 650 m² |
| Rees | open way, 43.5 × 13.4 m bbox | not closable | 480 m² |

The OSM tags are `highway=pedestrian` (Spadina) and `highway=pedestrian` + `surface=wood` (Simcoe); Rees is split into
a node/way. This is consistent with official areas within a few percent, and is enough to place a deck footprint and
its long axis. Treat the exact edge curves as approximate.

Official image references: [Simcoe at dusk](https://www.waterfrontoronto.ca/sites/default/files/styles/contextual_banner_sm/public/2022-05/01.Simcoe_DSC_3498-crop.jpg),
[Spadina](https://www.waterfrontoronto.ca/sites/default/files/2022-05/Spadina_DSC_3437.jpg),
[Simcoe](https://www.waterfrontoronto.ca/sites/default/files/2022-05/Simcoe_DSC_1537.jpg),
[Rees](https://www.waterfrontoronto.ca/sites/default/files/2025-01/Rees%20wavedeck%201280.jpg).

**Baseline gap (2026-11-09 snapshot):** no file built a wavedeck; the three decks were not rendered as raised timber
landforms, railings or stairs. The Queens Quay public-realm palette (2-tone red/grey granite maple-leaf pavers, 4-7 m
promenade, 3.6-4 m Martin Goodman Trail, ipe/cedar decking & benches, brushed stainless railings, timber + aluminum
light poles) was documented but not modelled as a waterfront-specific set.

**Implemented procedural pass:** `js/waterfront-public-realm.js` builds the three decks from their OSM footprints with the
official areas as budget (Spadina 630 / Rees 480 / Simcoe 650 m², Simcoe swells to 1.90 m deck top = 2.60 m above the
lake), timber terraces, fascia, accessible corridors, railings and tactile discs. See
[docs/waterfront-public-realm.md](waterfront-public-realm.md). The Rees support bearer was lowered below the
minimum rendered surface; accepted desktop/phone captures and the Simcoe walking check are in §10.

Sources for the public realm: <https://www.waterfrontoronto.ca/our-projects/queens-quay-west>,
<https://www.waterfrontoronto.ca/our-projects/scope-scale/central-waterfront>

## 4. Canada's Sugar Beach

Official numbers (Waterfront Toronto, "Canada's Sugar Beach"):

- Address **11 Dockside Drive**, foot of Lower Jarvis Street on the east edge of **Jarvis Slip**, south of Queens
  Quay, next to the Redpath Sugar factory and Corus Quay. Opened **9 August 2010**.
- **8,500 m² (2 acres)** park; **225 m** shoreline frontage; **57 trees**; **150 beach chairs** and **36 pink
  umbrellas**. The ASLA award narrative identifies the chairs as white, three-slat, recycled-plastic Loll Adirondack
  chairs.
- Design by **Claude Cormier + Associés** with The Planning Partnership. Three components: urban beach, plaza, and a
  tree-lined diagonal promenade.
- Materials/details: fine beach sand; candy-pink umbrellas; oversized **granite outcroppings** sliced into **1.5 m**
  pieces, from northern Quebec, with candy-coloured **thermoplastic** stripes. The beach rock is **over 6 m long and
  wide and about 1 m high**; the plaza rock is more than double that. A **granite maple-leaf water feature** sits by
  the beach. The promenade uses **granite and tumbled concrete cobblestones in a maple-leaf mosaic**; three grass
  mounds formed the original plaza/performance space. The historical north mound conflicts with the later Waterfront
  Innovation Centre; the current pass preserves that building and models only the two supported remaining mounds.
  A boardwalk level with the sand reaches some umbrellas and chairs.
- The umbrellas are specified as all-season and hurricane-wind capable.

Source: <https://www.waterfrontoronto.ca/our-projects/canadas-sugar-beach>

OSM cross-check:

| Feature | OSM area | OSM bbox |
| --- | ---: | --- |
| Sugar Beach park | 9,898 m² | 278.5 × 149.3 m |
| Mapped sand (`natural=beach`, `surface=sand`) | 3,169 m² | 104.7 × 121.9 m |
| Sugar Beach North | 1,297 m² | 60.2 × 71.7 m |

The OSM park is larger than the official 8,500 m², likely because it includes the adjoining promenade/plaza edges.
The sand polygon is the useful shape for a beach patch.

Official image references: [banner](https://www.waterfrontoronto.ca/sites/default/files/styles/contextual_banner_sm/public/2022-01/Waterfront%20Spaces%20-%20Sugar%20Beach.JPG),
[dusk looking north](https://www.waterfrontoronto.ca/sites/default/files/styles/carousel_with_bleeding_image_sm/public/2024-07/Waterfront%20Spaces%20-%20Canada%27s%20Sugar%20Beach%20-%20looking%20north%20after%20%28dusk%29%201280.jpg),
[sand/rocks/umbrellas](https://www.waterfrontoronto.ca/sites/default/files/styles/carousel_with_bleeding_image_sm/public/2022-03/dsc_1721_1.jpg),
[splash pad](https://www.waterfrontoronto.ca/sites/default/files/styles/carousel_with_bleeding_image_sm/public/2022-05/dsc_1242_1-1280-crop.jpg).

**Baseline gap (snapshot):** `GEO.areas` had only `park` polygons for Sugar Beach (no `beach` kind); the mapped sand
was not drawn (not in `SHORES.beaches`, and the harbour north shore is classified as a crisp dock wall); no sugarBeach
landmark/teleport; generic lawn/paving/trees with a scenic camera and hand-placed start.

**Implemented procedural pass:** `js/waterfront-details.js` places the 36 pink umbrellas and 150 white slat chairs;
`js/waterfront-beach-ground.js` draws the actual OSM sand surface and masks the generic lawn beneath it (paths
preserved), exposing `waterfrontSandHeightAt`. See [docs/waterfront-details.md](waterfront-details.md) and
[docs/waterfront-beach-ground.md](waterfront-beach-ground.md). The landscape pass adds the two striped granite
outcrops, two supported grass mounds, maple-leaf splash pad and a bounded paved plaza. Positions and dimensions are
plan/photo estimates; the exact cobble maple-leaf mosaic is not reproduced. See
[waterfront-beach-landscape.md](waterfront-beach-landscape.md).

## 5. HTO Park

Official / Landscape Performance Series data:

- Location **339 Queens Quay West**; opened **2007**; designed by **Janet Rosenberg & Studio**, **Claude Cormier
  Architectes Paysagistes** and **Hariri Pontarini Architects**.
- Size **5.7 acres (≈2.3 ha)**; the same source calls it a "6-acre park and public beach". Budget $10.5M.
- Two sections on the former **Maple Leaf Quay** and **Peter Street Slip**: HTO Park West and HTO Park East; the
  quays are 1920s concrete infill completed by 1929.
- **106 trees**, 25 shrubs, 3 grass types, including golden weeping willow, silver maple and serviceberry; the
  landforms are seeded with a mix including red switch grass.
- Water edge: a **fine white sand beach**, **38 custom-made yellow all-season umbrellas**, 5 large precast slab
  benches, and a **624 ft (≈190 m) boardwalk cantilevered 33 ft (≈10 m)** over the water, creating **19,160 ft²
  (≈1,780 m²)** of fish habitat. The knolls are LED-lit at night.
- Name is H2O + TO.

Sources: <https://www.landscapeperformance.org/case-study-briefs/hto-park>,
<https://en.wikipedia.org/wiki/HTO_Park>.

OSM cross-check:

| Feature | OSM area | OSM bbox |
| --- | ---: | --- |
| HTO Park East | 13,101 m² | 165.9 × 143.8 m |
| HTO Park West | 5,890 m² | 87.0 × 98.6 m |
| HTO Beach | 1,322 m² | 106.7 × 34.3 m |

The two park polygons plus beach are ≈20,300 m², short of the official 23,000 m², so the maintained park boundary is
wider than the mapped `leisure=park` polygons. Use the official area for labels and the OSM beach for the sand patch.

Image references: [beach](https://www.landscapeperformance.org/sites/default/files/styles/lightbox/public/10-HtO%20Park-Beach.jpg),
[visitors](https://www.landscapeperformance.org/sites/default/files/styles/lightbox/public/08-HtO%20Park-Visitors.jpg),
[winter boardwalk](https://www.landscapeperformance.org/sites/default/files/styles/lightbox/public/12-HtO%20Park-Winter%20Boardwalk.jpg),
[site plan](https://www.landscapeperformance.org/sites/default/files/styles/lightbox/public/03-HtOPark-New%20Site%20Plan.jpg),
[rolling islands](https://www.landscapeperformance.org/sites/default/files/styles/lightbox/public/07-HtO%20Park-Rolling%20Islands.jpg).

**Baseline gap (snapshot):** `HTO Beach` sand was in shore data but the hard-zone rule kept the HTO shore crisp; no
white-sand surface, boardwalk deck, cantilever, slab benches or LED knolls; no HTO landmark/teleport.

**Implemented procedural pass:** `js/waterfront-details.js` places 38 yellow perforated-aluminium umbrellas and ~76
multicolour rounded-slat chairs; `js/waterfront-beach-ground.js` adds the OSM sand surface. The landscape pass adds
16 East source-plan berms and eight West grass faces derived from the actual mapped paths, their paved courts,
the mapped south-shore timber footway (~129 m, not the entire published 190 m network), and five slab benches
with approximate spacing. The source-confirmed two-storey fire station replaces the inherited generic tower.
The exact cantilever profile and LED lighting remain outside this delivered geometry. See [waterfront-hto-landscape.md](waterfront-hto-landscape.md) and
[waterfront-hto-firehall.md](waterfront-hto-firehall.md).

## 6. Harbourfront Centre

Official facts:

- Address **235 Queens Quay West**; **10-acre campus** at the heart of the central waterfront; registered charitable
  not-for-profit; founded as a crown corporation in 1972, non-profit since 1991; **6.3 million annual visitors**;
  seating capacity 2,000.
- The campus holds the waterfront's arts/cultural buildings, public squares, marina and the lake promenade. The
  Waterfront Toronto central-waterfront page records that a Harbourfront Centre parking lot was turned into new
  public squares and a new promenade stretch at the Portland Slip.
- The central-waterfront public realm palette is the same as Queens Quay: granite paving, cedar/ipe decking and
  benches, brushed stainless steel railings, timber + aluminum light poles.

Sources: <https://harbourfrontcentre.com/about-us/>,
<https://www.waterfrontoronto.ca/our-projects/scope-scale/central-waterfront>,
<https://en.wikipedia.org/wiki/Harbourfront_Centre>.

OSM cross-check: Harbourfront Centre main building centre ≈ -389, 630; the campus polygons span the Queens Quay
frontage between roughly -710 and -150 on x. The exact 10-acre boundary is not a single OSM polygon, so use the
official 10-acre figure for labels and OSM building footprints for massing.

Image references: [campus](https://upload.wikimedia.org/wikipedia/commons/0/0a/Harbourfront-Centre.jpg),
[Queens Quay at Ann Tindal Park](https://upload.wikimedia.org/wikipedia/commons/a/a0/Queens_Quay_at_Ann_Tindal_Park.jpg),
[Waterfront Toronto Queens Quay overview](https://www.waterfrontoronto.ca/our-projects/queens-quay-west).

**Baseline gap (snapshot):** the generated landmark meshes contained only 10 City landmarks (Harbourfront not among
them); it drew as generic massing/OSM footprints with no campus identity, squares or marina edge.

**Implemented procedural pass:** `js/waterfront-harbourfront.js` gives the campus identity footprint, the three named public
squares (Canada 7,625 / Ontario 3,038 / Ann Tindal 4,293 m²) as identity data, The Power Plant chimney at its mapped
`man_made=chimney` node (555405453) and the documented John Quay boardwalk. It deliberately adds no invented square
furniture or marina slips. See [docs/waterfront-harbourfront.md](waterfront-harbourfront.md).

## 7. Toronto Music Garden

Official / design references:

- Address **479 Queens Quay West**; opened **1999**; a **Cultural Garden** inspired by **Bach's Cello Suite No. 1 in
  G Major (BWV 1007)**, conceived with cellist **Yo-Yo Ma** and landscape architect **Julie Moir Messervy**; the
  City credits native and ornamental perennials, grasses, flowering shrubs and wrought-iron amenities.
- Six movements become six garden rooms: **Prelude** (curving path, granite boulders, hackberry), **Allemande**
  (birch grove), **Courante** (wildflower meadow), **Sarabande** (conifer grove with a water-filled stone), **Menuett**
  (wrought-iron Music Pavilion, attributed to Tom Tollefson), **Gigue** (grass-step amphitheatre under a willow).
- A free summer concert series uses the Gigue amphitheatre.

Sources: City of Toronto public gardens list
<https://www.toronto.ca/explore-enjoy/parks-recreation/places-spaces/beaches-gardens-attractions/gardens-and-horticulture/public-gardens/>,
Waterfront Toronto central waterfront <https://www.waterfrontoronto.ca/our-projects/scope-scale/central-waterfront>,
design summary <https://www.blogto.com/city/2019/05/toronto-music-garden-serene-bach-inspired-park-waterfront/>.

OSM cross-check:

| Feature | OSM area | OSM bbox |
| --- | ---: | --- |
| Toronto Music Garden | 10,462 m² | 261.6 × 78.3 m |

This is the most reliable measured footprint: the long, narrow band matches the geodata landmark record
(`x -1330.3, z 569.4, w 262, d 47.9, ang -0.161, area 10,524 m²`). The park is commonly described as **about 3 acres
(≈1.2 ha)**; that figure is **uncertain** here because no official measured area was found. Use the OSM / geodata
10.5k m² unless a City figure is supplied.

Image references: [Wikimedia](https://upload.wikimedia.org/wikipedia/commons/5/53/Toronto_-_ON_-_Toronto_Music_Garden.jpg),
[Commons category](https://commons.wikimedia.org/wiki/Category:Toronto_Music_Garden).

**Baseline gap (snapshot):** `musicGarden` had a label but no custom massing — generic lawn, paths and trees.

**Implemented procedural pass:** `js/waterfront-music-garden.js` anchors the six rooms on the garden's real OSM movement
nodes and builds distinct planting beds, the Music Pavilion, grass-step amphitheatre, the water stone and a winding
room-to-room path. The garden uses the existing shared tree renderer with source-informed species/height sites;
the earlier white procedural crowns have been replaced. See [docs/waterfront-music-garden.md](waterfront-music-garden.md)
and the accepted desktop/phone captures in §10.

## 8. Toronto Islands

Official / reference facts:

- A chain of **15 small islands** in Lake Ontario south of downtown, sheltering Toronto Harbour; home to Toronto
  Island Park, Billy Bishop Toronto City Airport, yacht clubs, Centreville, a public marina and a year-round
  car-free residential community (the largest urban car-free community in North America). The official BIA map
  includes the islands in scope **except the airport lands**; the airport is shown but is not part of the BIA.
- Public ferries run year-round from **Jack Layton Ferry Terminal**; the airport has a pedestrian tunnel but the
  airport is a secure area not connected to the parks.
- Main beach is the south shore of Centre Island; Hanlan's Point beach is clothing-optional; Ward's, Gibraltar
  Point and others are mapped beaches. The islands are a major view target from the whole waterfront.
- The park's wooded islands are modelled by [docs/toronto-island-woods.md](toronto-island-woods.md) (263 ha of park
  islands; 249.7 ha ground; 9,265 crowns).

Sources: <https://en.wikipedia.org/wiki/Toronto_Islands>,
City of Toronto Island & Ferries <https://www.toronto.ca/explore-enjoy/toronto-island-ferries/>,
[docs/toronto-island-woods.md](toronto-island-woods.md).

OSM cross-check (selected beaches, measured):

| Beach | OSM area | OSM bbox |
| --- | ---: | --- |
| Centre Island main beach (unnamed OSM way 1152559419) | 10,623 m² | 168.7 × 479.3 m |
| Hanlan's Point Nude Beach | relation, not closed here | — |
| Ward's Island Beach | relation, not closed here | — |
| Gibraltar Point Beach | relation, not closed here | — |

Use the island beaches and lagoon polygons as the sand/edge reference; the exact maintained beach width is not
published.

Image references: [aerial](https://upload.wikimedia.org/wikipedia/commons/1/11/Toronto_Islands_2025-05-08.jpg),
[City map](https://www.toronto.ca/explore-enjoy/toronto-island-ferries/toronto-island-map/),
[things to do](https://www.toronto.ca/explore-enjoy/toronto-island-ferries/things-to-do-on-toronto-island/).

**Baseline gap (snapshot):** no island landmark/teleport; only the woods pilot and shore aprons; no arrival
docks/boardwalks/beach access, and the mapped "dock" POIs were actually Bike Share stations (see §2.1).

**Implemented procedural pass:** `js/waterfront-island-arrivals.js` builds the three real terminals from actual OSM geometry
(Ward's way 251286976, Centre way 1175136270, Hanlan's node 56794382 + taxi quay 1375105747) with their mapped
connecting footways drawn in their real surface colours, a bounded name atlas, and a gated `islandArrivalSurfaceAt`.
See [docs/waterfront-island-arrivals.md](waterfront-island-arrivals.md). The three arrival areas passed GPU and actual walking checks (§10); boardwalks are timber only where OSM says `surface=wood` (none at these approaches today).

## 9. Current implementation inventory

Working tree, reviewed broad pass. Each row has source notes, tests, and inspected GPU captures.
Acceptance is for the documented procedural scope, not survey-level fidelity.

| Area | Delivered module | Evidence / doc | Status |
| --- | --- | --- | --- |
| Sugar Beach & HTO sand | `js/waterfront-beach-ground.js` (sand on OSM rings, lawn masked) | [waterfront-beach-ground.md](waterfront-beach-ground.md) | reviewed procedural scope |
| Sugar/HTO furniture | `js/waterfront-details.js` (36 pink + 150 chairs; 38 yellow + ~76 chairs) | [waterfront-details.md](waterfront-details.md) | reviewed procedural scope |
| Wavedecks (Spadina/Rees/Simcoe) | `js/waterfront-public-realm.js` | [waterfront-public-realm.md](waterfront-public-realm.md) | reviewed procedural scope |
| Queen's Quay Terminal | `js/waterfront-landmarks.js` (1926 warehouse + 4 set-back residential levels, green-patina roof, clock tower) | [waterfront-landmarks.md](waterfront-landmarks.md) | reviewed procedural scope |
| Redpath Sugar | `js/waterfront-landmarks.js` (refinery halls, pitched sugar-shed roof) | [waterfront-landmarks.md](waterfront-landmarks.md) | reviewed procedural scope |
| Music Garden | `js/waterfront-music-garden.js` (6 rooms, pavilion, amphitheatre, water stone) | [waterfront-music-garden.md](waterfront-music-garden.md) | reviewed procedural scope |
| Harbourfront Centre | `js/waterfront-harbourfront.js` (campus identity, squares, Power Plant chimney, John Quay boardwalk) | [waterfront-harbourfront.md](waterfront-harbourfront.md) | reviewed procedural scope |
| Mainland ferry terminal | `js/waterfront-ferries.js` (building, ticket booths + canopy, masthead, finger piers, route directory) | [waterfront-ferries.md](waterfront-ferries.md) | reviewed procedural scope |
| Island arrivals | `js/waterfront-island-arrivals.js` + sourced data | [waterfront-island-arrivals.md](waterfront-island-arrivals.md) | reviewed procedural scope |
| Sherbourne Common art | `js/waterfront-sherbourne.js` (Light Showers, Unfinished Arch) | [waterfront-sherbourne.md](waterfront-sherbourne.md) | reviewed procedural scope |
| Canada Malting silos | `js/waterfront-bathurst.js` (15 exposed south bins; flat north block, headhouses and marine leg) | [waterfront-bathurst.md](waterfront-bathurst.md) | reviewed procedural scope |
| Sugar landscape | `js/waterfront-beach-landscape.js` (striped outcrops, supported mounds, fountain, paved plaza) | [waterfront-beach-landscape.md](waterfront-beach-landscape.md) | Desktop, walking and phone reviewed |
| HTO landscape / firehall | `js/waterfront-hto-landscape.js`, `js/waterfront-hto-firehall.js` | [waterfront-hto-landscape.md](waterfront-hto-landscape.md) | Desktop, walking and phone reviewed |
| Island beaches / access | `js/waterfront-island-access.js` + sourced data | [waterfront-island-access.md](waterfront-island-access.md) | GPU reviewed; mapped routes and dry final approach verified |

**Remaining fidelity gaps:** fine facade ornament and planting layouts remain approximations; Sugar Beach's exact
cobble maple-leaf mosaic is absent. HTO mound heights and the West path-face approximation are not surveyed;
the complete 190 m boardwalk network, exact cantilever and LED lighting are not claimed. Ward's final beach approach
has an untagged gap in OSM, retained as an explicit source limitation rather than invented timber. The wider
waterfront public-realm palette is not a survey-level reconstruction.

Beads under `st-sb3r` record the reviewed scopes and evidence. Wave 4 covers `.9` island beach access, `.13` Sugar
landscape, `.14` HTO berms/boardwalk and `.15` firehall massing. Wave 5 adds `.16` source-matched island building
profiles and `.17` the concave sidewalk-band repair that restores Ward's Island Park lawn.

## 10. Reviewed implementation and verification

The broad pass now includes Sugar/HTO furniture and sand, three walkable wavedecks, Queens Quay Terminal,
Redpath, Music Garden, Harbourfront chimney/quay, mainland ferry entrance, three island arrival areas,
Sherbourne public art, and Canada Malting silos at Bathurst Quay. Primary reference photos were inspected by eye,
the modules integrated, rendered images reviewed, and incorrect drafts rejected.

Final CPU suite: **832 passed, 0 failed, 3 skipped (835 total)**. The runtime test builds all waterfront modules
with real geometry helpers and both shipped `detail` and `eglinton` databases. It checks finite geometry,
replacement boundaries, and the raised walking-surface hooks.

Reviewed Mac mini (`gpu2`, Apple M4) captures:

| Tag | Map / quality | Evidence |
| --- | --- | --- |
| `wave3-acceptance` | detail / high | 14 views; corrected QQT/Redpath facade attributes, Rees support clearance, actual Simcoe walker, island ground masks; exit 0 |
| `wave3-walking` | eglinton / high | 9 views; actual walkers on all three island decks and the Gigue terraces, shared detailed garden trees, Light Showers; exit 0 |
| `wave3-west-ferry` | detail / high | 13 views; measured silo silhouette, north-entry ferry booths, smooth arch, opaque island name panels; exit 0; build `0f411c10a7e3` |
| `wave3-phone` | detail / low, 412×915 | 12 representative views across the pass; exit 0; same build |

Shot lists are in `tools/shots/waterfront-{acceptance,walking-review,west-ferry-review,phone-review}.json`.
Artifacts are under the sibling `$GPU2_REVIEW_DIR/slop-toronto-waterfront-bia/` directory.
The `wave3-phone` batch also passed: 12 views at 412×915, mobile/low quality, detail map, exit 0.
The coordinator inspected Sugar/HTO furniture, ferry booths and the corrected opaque island sign in phone captures. Reported frame rates in these contended, capped captures
are functional observations, not a performance budget or benchmark.

Review corrections included the missing facade `paint` attributes, missing garden crown colours (then replacing
those primitive crowns with the shared EZ-Tree pipeline), island lawn obscuring aprons, deck bearers protruding
through ramps, incorrect ferry endpoint POIs, an unsupported south-side booth relocation, segmented arch joints,
and obstructed acceptance cameras. Research photographs are not shipped as application textures.

This is a verified procedural realism pass, **not a surveyed or photoreal reconstruction of every BIA parcel**.
The uncertainty register and the remaining items in section 9 still apply.

### Further landscape and island validation (2026-11-10)

Wave 4 added the source-plan Sugar Beach landforms and fountain, HTO East berms and mapped shore boardwalk,
the corrected two-storey fire station, and four island beaches with mapped access paths and amenities.
`wave4-island-draft` (8 desktop views) and `wave4-terrain-walking` (7 default-frame views) exited 0 on gpu2.
The latter exercised the real controller ground lookup on Sugar/HTO slopes, the lower timber boardwalk, and
Centre/Hanlan/Ward rendered access corridors; coordinator image review confirmed feet meet the surfaces.
`wave4-phone` added 8 views at 412×915, low quality, detail frame on build **4ef626c0925e** (301 files,
151 fingerprinted scripts), exit 0. Fire-station and striped-rock phone images were inspected.

The first full-suite run exposed a new low-boardwalk regression: calling the generic standing-deck lookup from
all ground queries reached unrelated coarse deck records. The correction uses the waterfront-only surface
lookup while retaining higher road-deck precedence. All **21 movement and High Park tests passed** afterward;
the final full suite passed **884 tests, 3 skipped, 0 failed** after all application changes settled.

Island route additions retain source surfaces and actual bridge tags: no wooden boardwalk is invented where
none is mapped. Centre and Hanlan routes reach their beaches; Ward has an explicit **44 m dry, untagged final
approach**. The original all-three-connected acceptance remains open for that source gap. Island GPU review
also exposed inherited cottage towers. The source-matched correction covers **331 building records**, including
**236 inherited high-rise defaults**; 29 other tall rows remain unchanged where the source match is not sufficiently
confident. Explicit source heights/levels win, and airport buildings, both lighthouse records, changed footprints
and other map projections are excluded. Eighteen residential blocks also stop inheriting downtown paving from
those old tower heights. A separate invalid sidewalk-annulus repair restores Ward's park lawn while preserving
its courts, paths and perimeter curb. See `st-sb3r.16` and `st-sb3r.17`.

## 11. Visual reference review

Coordinators inspected the official City BIA map, the HTO park photo, and the linked Simcoe and Rees photographs
(plus, for later modules, the City ferry terminal plan p.10, the JMMDS Music Garden plan, and the Sherbourne
Light Showers / Unfinished Arch photos). HTO's City photo establishes mixed red, blue, green and yellow chairs with
vertical backs; Simcoe shows two sculpted swells, silver rails and timber fascia; Rees shows broad, shallow timber
terraces. Reference photographs are research only and are not bundled into the application. Pixel colour statistics
alone were not used as acceptance evidence. Procedural profiles and furniture arrangements remain approximations.

## 12. Uncertainty register

- **BIA boundary geometry**: the official PDF is a map, not a machine-readable polygon; the exact lot-level boundary
  still needs the PDF or City BIA data.
- **HTO area**: 5.7 acres official vs 6-acre prose; OSM polygons ≈20,300 m² vs ≈23,000 m² official. Use official for
  labels.
- **Music Garden area**: OSM/geodata 10.5k m² is solid; the common "3 acres" is unverified. Room positions are
  design-derived / OSM-node anchored, not survey-measured.
- **Deck areas and curves**: official areas are round numbers; Rees is not a closed OSM polygon. Exact wave profiles
  and railing lines need the Waterfront Toronto drawings or a field survey.
- **Island terminals**: the real terminals are the OSM `amenity=ferry_terminal` way/node ids in §2.1; the old geodata
  "Ferry Dock" POIs were Bike Share stations. Hanlan's is a node (no berth polygon), so its platform is estimated.
- **Landmark facades**: QQT/Redpath window rhythm and weathering are procedural approximations. Unmapped refinery
  silo/chimney arrays were not invented. QQT clock height is 46 m. Canada Malting bin heights/counts come from the
  City heritage report; its headhouse and marine-leg details remain photo-estimated.
- **Materials**: official text names granite, thermoplastic stripes, ipe/cedar, stainless steel, fine white sand,
  pink/yellow umbrellas, wrought iron. Exact colours, finishes and dimensions beyond those quoted are uncertain.
- **Beach widths and dune profiles**: not published; OSM outlines give plan area only, not cross-section.
- **Image content**: image URLs are references; no image was treated as a measured drawing.

## 13. Source list

Official / primary:

- <https://www.waterfrontbia.com/about-waterfront-bia>
- <https://www.waterfrontbia.com/listing/queens-quay-terminal>
- <https://www.waterfrontbia.com/listing/jack-layton-ferry-terminal>
- <https://www.toronto.ca/wp-content/uploads/2021/10/97b2-edc-Waterfront-BIA-map2021-accessible.pdf>
- <https://www.waterfrontoronto.ca/our-projects/wavedecks>
- <https://www.waterfrontoronto.ca/our-projects/canadas-sugar-beach>
- <https://www.waterfrontoronto.ca/our-projects/queens-quay-west>
- <https://www.waterfrontoronto.ca/our-projects/scope-scale/central-waterfront>
- <https://www.landscapeperformance.org/case-study-briefs/hto-park>
- <https://www.asla.org/2012awards/036.html>
- <https://harbourfrontcentre.com/about-us/>
- <https://www.toronto.ca/explore-enjoy/parks-recreation/places-spaces/beaches-gardens-attractions/gardens-and-horticulture/public-gardens/>
- <https://www.toronto.ca/explore-enjoy/toronto-island-ferries/>
- <https://www.toronto.ca/explore-enjoy/toronto-island-ferries/ferry-routes-schedules/>
- <https://www.toronto.ca/explore-enjoy/toronto-island-ferries/getting-around/>

Secondary / cross-checks:

- <https://en.wikipedia.org/wiki/HTO_Park>
- <https://en.wikipedia.org/wiki/Toronto_Music_Garden>
- <https://en.wikipedia.org/wiki/Toronto_Islands>
- <https://en.wikipedia.org/wiki/Harbourfront_Centre>
- OpenStreetMap contributors, ODbL — park/beach areas, the island ferry terminals (way 251286976, way 1175136270, node
  56794382, quay way 1375105747) and footways via the official OSM API (fetched 2026-11-09).
- Waterfront Toronto PDF map text extract (`pdftotext -raw`; labels include Stadium Rd, Toronto Islands, Olympic
  Island Pk, Algonquin Island, Toronto–Centre Island Ferry Route, South Island).

## Subordinate module documents

- [waterfront-public-realm.md](waterfront-public-realm.md) — the three WaveDecks
- [waterfront-details.md](waterfront-details.md) — Sugar Beach and HTO furniture
- [waterfront-beach-ground.md](waterfront-beach-ground.md) — real sand at Sugar Beach and HTO
- [waterfront-music-garden.md](waterfront-music-garden.md) — six Bach-movement rooms
- [waterfront-harbourfront.md](waterfront-harbourfront.md) — Harbourfront Centre campus
- [waterfront-landmarks.md](waterfront-landmarks.md) — Queen's Quay Terminal and Redpath Sugar
- [waterfront-ferries.md](waterfront-ferries.md) — mainland Jack Layton Ferry Terminal
- [waterfront-island-arrivals.md](waterfront-island-arrivals.md) — island terminal arrivals
- [waterfront-sherbourne.md](waterfront-sherbourne.md) — Sherbourne Common public art
- [waterfront-bathurst.md](waterfront-bathurst.md) — Canada Malting silos, measured bins and restored silhouette
- [toronto-island-woods.md](toronto-island-woods.md) — island tree cover
- [waterfront-beach-landscape.md](waterfront-beach-landscape.md) — Sugar outcrops, current-supported mounds and fountain
- [waterfront-hto-landscape.md](waterfront-hto-landscape.md) — HTO East/West berms, paved courts and south boardwalk
- [waterfront-hto-firehall.md](waterfront-hto-firehall.md) — source-confirmed two-storey fire station
- [waterfront-island-access.md](waterfront-island-access.md) — island beach polygons, amenities and mapped route additions

- [waterfront-island-buildings.md](waterfront-island-buildings.md) — source-matched low-rise profiles and Ward park sidewalk repair

## Wave 5 integrated verification (2026-11-10)

Build `2a6577a0b649` passed the full Node suite: **884 passed, 0 failed,
3 skipped** (887 total). The focused real Ward park concave-ring regression
also passed all three tests after final review. `git diff --check` is clean.

Mac mini `gpu2` final batches `wave5-walking` (3 captures, high-detail Eglinton
frame) and `wave5-phone` (12 view captures plus HUD setup, 412×915 low-detail
frame) both exited 0. Reviewed outputs include HTO West's eight grassy interiors
and retained paved quay, Ward/Algonquin low-rise profiles, island beach access,
and Ward park's restored lawn. These supplement the earlier accepted mainland,
terrain-walking and phone batches; they do not establish a performance budget.
Outputs are in `$GPU2_REVIEW_DIR/slop-toronto-waterfront-bia/`.

`wave5-walking-ward-unmapped-approach-walk.json` records 181 real-controller
collision/ground samples over the final 44 m dry Ward approach, with zero
collision correction. The path remains **unmapped and unrendered** there:
walkability is verified, but no boardwalk or surface geometry was invented.
The earlier task wording assumed continuous boardwalks; source inspection instead
supports mapped paths, the actual mapped bridge, and this dry open-land approach.

Two earlier broad capture attempts stopped at an unreliable runtime lawn raycast
assertion. Direct checks of actual geometry ruled out an additional missing-lawn
defect, so the speculative lawn change was reverted. The retained repair targets
the demonstrated self-intersecting sidewalk annulus; its CPU regression and GPU
before/after views agree. The final capture checks visible ground and actual
movement rather than that unreliable raycast.

This completed the initial broad source-backed procedural pass, not survey-grade or
photorealistic reconstruction. In particular, 29 unmatched tall native island
rows remain unchanged pending stronger footprint identification; fine facade
materials, exact planting, the full historical HTO boardwalk and the Ward mapping
gap remain explicit fidelity limits.


## Wave 6 active refinement (2026-11-10)

Visual work continued after review of the wave 5 captures. Source photographs and GPU captures are inspected by eye
and integration defects repaired; a text-only claim does not constitute visual acceptance.

Accepted HTO refinement (`st-sb3r.20`, `.21`): darker turf and paving detail, inward smoothing of West grass boundaries,
and 68 retained tree symbols from 91 manually digitized points in the ASLA 2009 plan. Current mapped tree inventory wins;
conflicts are rejected, never relocated. Shared EZ instancing represents generic deciduous trees, not identified species.
Nineteen focused tests passed, including actual mesh raycasts, both supported frames and exact ground heights. Mac mini
`wave6-planting-draft` high and `wave6-hto-phone` 412×915 low captures both passed; the captain inspected aerial/path views
and actual berm walking. Plan registration uncertainty and historical/current differences remain documented in the module dossier.

Cottage geometry now has source-gated siding, cottage-scale eaves within total heights, gable/hip roofs, broad white
window casings and shallow painted doors. GPU review removed buried fake porch components, duplicate shader doors and
an open soffit gap. `wave6-cottage-fascia` four verified frontal captures and `wave6-cottage-phone` two low phone views passed;
15 focused tests pass, including sealed
roof volumes and camera clearance. Appearance is a typology approximation, not per-house colour/entry reconstruction.
A separate active task addresses unsupported motor-road styling in island residential lanes.

Redpath now has a photo-informed pitched raw-store silhouette, industrial annexes, visible red block lettering on pale
brick, sparse industrial windows and cladding. GPU review caught a deferred shader node error and downward-wound roof
planes; these were repaired and the actual sloped-triangle winding is covered by the focused geometry test. The `wave6-redpath-photo` four-view GPU rerender passed and was inspected alongside the source photographs;
25 focused tests pass. Roof geometry and fine brick/short-wide sign proportions are accepted as a procedural refinement. Exact sign-block assignment, cursive logo and mural artwork remain unresolved.

Furniture sourcing and default integration are accepted (`st-sb3r.22`). Actual Polyfork and Poly Pizza GLBs were downloaded and inspected. The Google
“Beach chair” was rejected after the captain viewed its preview: it is a fabric sling deck chair, not an Adirondack.
Rejected comparison assets were kept outside the shipping tree. An original CC0 Innerscene Adirondack model passed both a standalone GPU silhouette preview and an HTO scene trial.
It is now the HTO default, with a procedural loading fallback, real-size colliders, refreshed culling bounds and shadows.
Every transformed vertex of all 76 HTO instances is tested inside its collider and the sand polygon. Sugar Beach retains
its distinct horizontal-slat chair. The default model passed `wave6-final-details` desktop/high and `wave6-final-phone`
412×915/low captures (six checks each, exit 0); the captain inspected the close views, including the real slat/arm silhouette and shadow.

The earlier wave 5 suite result is historical. Wave 6's intermediate full run had 899 passes, one failed new HTO precision
assertion and three skips; the assertion now uses the documented millimetre serialization bound and its focused suite
passes. The settled lane/furniture/roof integration subsequently passed **935 tests, zero failures and three skips**
(938 total; `wave6-integrated-full-tests.log`). Combined default-chair and unmarked-lane desktop/phone captures passed.
The flush island verge producer is accepted (`st-sb3r.23`): actual ramps replace confirmed curb/walk-band edges, with
Float32 winding and a topmost native/ramp triangle query that matches the visible ground. `wave6-verge-final`
(high/detail) and `wave6-verge-phone` (412×915/low) both passed and were visually inspected on build **ef71e94e099c**.
Desktop verified 582 rendered-ground/controller samples to 4.44e-16 m; phone verified 582 movement samples exactly.
The final integrated suite passes **948 tests, zero failures and three skips (951 total)** in
`wave6-final-full-tests.log`. These are visual/functional checks, not shared-host performance claims.

The residual left curb on Third Street and native concrete yard beside Oneida are refined in **st-sb3r.24**. Per-edge
surveyed-sidewalk exclusion preserves actual City paths while allowing confirmed lane edges on the same block to become
flush; validated cottage profiles prevent an unmatched inherited tall row from paving a residential yard. Build
**9b9ff034c285** passed `wave6-residual-draft` desktop/high and `wave6-residual-phone` 412×915/low. The captain inspected
matching Oneida/Third street views: the reported curb and concrete-yard artifacts are removed. Desktop checked 865
rendered-ground/controller samples (maximum error 4.44e-16 m), and phone checked 865 movement samples (zero error).
All 37 focused island geometry/profile/path tests pass; this scope is accepted.

**st-sb3r.25** adds source-photographed Oneida herringbone paving and Ojibway concrete slabs to the actual road material,
with lane-relative joints and a bounded mask. Build **e64e2cbd562f** passed `wave6-surface-final` desktop/high and
`wave6-surface-phone` 412×915/low (five checks each); the captain inspected close views and compared the source photographs.
Final integration fixes corrected deferred shader returns, normals, lane selection and unwrapped interpolation.
The integrated suite passed **969 tests, zero failures and three skips (972 total)** in
`wave6-residual-surface-full-tests.log`; the final material adjustment also passed all 16 focused tests. Source coverage, native widths, merged building
footprints, repeated facade typologies and exact gardens remain explicit limits; the broader epic remains open.
No deployment or commit.

Wave 7 accepts **st-sb3r.26–.28**: an official City Road Edge audit, representative 3.3 m Oneida / 3.5 m Ojibway paving with grass shoulders, and 33 additional City Tree Point canopy sites in those photographed corridors. The source-maintenance dates, OSM/City alignment drift, generic tree crowns/species, and procedural material approximations remain explicit. Build **b575672e854d** passed `wave7-canopy-lighting` desktop/high/detail (seven checks) and `wave7-canopy-phone` 412×915/low (six checks), both visually inspected. Desktop checked 189 rendered-ground/controller samples to 1.49e-13 m. The integrated suite passed **987 tests, zero failures, three skips (990 total)** in `wave7-full-tests.log`.

**st-sb3r.29 is accepted**: eliminate conspicuous invented concrete swaths from the generic yard shader only in source-validated cottage blocks bordering those photographed corridors. Actual mapped paths and all other blocks remain outside that material refinement. Exact City-edge road geometry, merged cottage footprints, individual facades and garden layouts remain further realism limits. No commit, deployment or server restart.

The yard refinement on build **caaf38d94c91** passed `wave7-yard-final` desktop/high/detail (eight checks) and `wave7-yard-phone` 412×915/low (seven checks), visually inspected. The generic concrete swaths and mask-edge halos are removed only from the photographed, source-validated frontages; actual mapped paths remain. Final suite: **1,001 pass, zero failures, three skips (1,004 total)** in `wave7-yard-final-full-tests.log`. **st-sb3r.30 is accepted**: its reproducible source audit binds all 331 profiles and distinguishes moderate footprint approximation from shared facade/roof styling. Cottage axis error averages 0.1°; sampled footprint IoU averages 0.722. Broad merged-cottage claims are unsupported. **st-sb3r.31 is accepted**: photo-informed window rhythm and physical-door/shader consistency passed desktop/phone inspection. **st-sb3r.32 is accepted**: one guarded OSM footprint pilot now drives the same walls, roof, trim and physical/camera collider, with exact rectangle-overlap validation and generated-tree keepout. Build `cb7879a302d6` passed desktop/phone three-check captures and **1,021 tests, zero failures, three skips (1,024 total)**. The new aerial exposed three unprofiled tall Nottawa buildings; **st-sb3r.33 remains active** for source-based correction. No whole-BIA photorealism claim.

The follow-up **st-sb3r.33 height correction is accepted**: exactly three reviewed Queen City Yacht Club source rows no longer become unsupported 28–32 m towers. All prior 331 OSM profiles remain unchanged; one OSM and two separately attributed City-only profiles were added. City 2024 orthophoto, the mapped marina, and 2025 massing attributes support a low rendering treatment, while 4 m remains an explicit estimate and canopy contamination an inference. Build `eeac13b4ce63` passed **1,032 tests, zero failures, three skips (1,035 total)** and four desktop/phone shots/checks each. Actual collider heights were checked.

**st-sb3r.34 remains active** to replace the reviewed marina structures' generic brick/window appearance with bounded primary-photo-informed forms/materials; official club photos show white panels/timber, navy doors and low service structures. **st-sb3r.35 remains active** to assess defensible low vegetation evidence on the photographed residential frontages. First-return lidar cannot establish understory beneath canopy, so its low returns will not be treated as automatic proof of shrubs or flowerbeds. Neither new scope is accepted yet.

### Reviewed QCYC service appearance (.34)

The three corrected low marina structures now use a source-informed white paneled shed with visible navy doors and dark closed pitched roof, plus neutral flat storage envelopes. Only three reviewed identities change; estimated 4 m total height and colliders remain. See [source dates, approximations and acceptance](waterfront-marina-appearance.md). Desktop `wave7-marina-review` and phone `wave7-marina-phone`: six views/checks each, exit 0, inspected. Full suite: 1,041 pass / 0 fail / 3 skip. Marina landscape remains sparse; source-mapped canopy continues in `.36`, and low understory evidence is audited separately in `.35`.

### QCYC mapped canopy and garden evidence (.35/.36)

Added 18 City Tree Points inside the mapped QCYC marina, retaining the 33 accepted residential points. Exact source positions/heights, generic deciduous crown shapes, mixed imagery vintages: [scope and verification](waterfront-marina-canopy.md). Desktop/phone seven-check runs passed and were inspected; full suite 1,056 pass / 0 fail / 3 skip. Portable focused source tests pass20/20.

The [low-vegetation audit](waterfront-island-low-vegetation.md) found 10.25% low surfaces and71.72% tall returns in the photographed corridors; it cannot identify hidden understory or classify every low surface as vegetation. A disabled source-constrained representative garden trial continues under `.37`; no exact garden reconstruction is claimed.

### Source-constrained gardens and licensed marina hulls (.37/.38)

Eight reviewed garden patches (263 one-metre source cells) now carry bounded representative rounded foliage,
with varied dimensions and offsets contained inside the reviewed mask. Lidar low returns were checked against
City 2024 imagery; sixteen ambiguous patches remain unplanted. This does not identify plant species or hidden
understory. [Garden evidence and limitations](waterfront-island-garden-cover.md).

Eight actual Kenney CC0 open hulls use source-measured positions, oriented plan dimensions and ground-aligned
colliders at QCYC. The 2024 seasonal storage snapshot is not a current fleet or exact boat identity.
[Asset provenance and source comparison](waterfront-dinghies.md).

Both additions are enabled by default; `?islandGardens=0` and `?dinghies=0` provide opt-outs. Desktop/phone
garden 5 checks each and dinghy 4 checks each passed; images inspected. Final suite 1,092 total: 1,089 pass, 0 fail, 3 skip.
No commit, push, deployment or devserver restart. Remaining generic building forms and garden species/understory
are approximations; this checkpoint does not claim photorealism across the entire BIA.

### QCYC clubhouse identity and exterior (.39)

One source-bound row (32139, OSM way43805118) now has a white two-storey exterior, dark stepped hip roofs and
off-white balcony detailing on the exposed waterfront edges of its L-shaped footprint. The original footprint and
6.5 m level-derived collision height remain. Official club imagery supports the overall character; detailed dimensions
and glazing rhythm are representative. [Source audit and matched capture evidence](waterfront-qcyc-clubhouse.md).

Final desktop and phone four-check captures passed and were inspected. Final suite: 1,100 total, 1,097 pass, 0 fail,
3 skip. No commit, push, deployment or server restart. This closes the latest scoped exterior correction while the
broader BIA dossier continues to distinguish source-supported details from generic or unmodelled areas.
