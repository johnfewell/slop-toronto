# Public art and the Heritage Register

Beads `st-26p.10` (public art discovery and selected modelled works) and `st-26p.15` (Heritage Register discovery and
facade references). Snapshots fetched 2026-10-29.

## Sources and rebuild

| Layer | City dataset | Resource used | Snapshot |
| --- | --- | --- | --- |
| Public art | [Public Art](https://open.toronto.ca/dataset/public-art/) | `Public Art - 4326.geojson` (`6bcc0225-…`, refreshed 2026-05-13) | `tools/data/public-art-20261029.json`: every original field of the 314 records in the detail frame (+100 m); the citywide file has 459 |
| Heritage | [Heritage Register](https://open.toronto.ca/dataset/heritage-register/) | `Heritage Register Data` Shapefile (`108b1080-…`, `HRAPQ32026_OpenData`, 2026-09-01, quarterly) | `tools/data/heritage-register-20261029.json`: 7,700 of 12,332 records as compact rows of the 26 fields the cards and identities use |

Both packages state the Open Government Licence – Toronto. Each snapshot records the package, resource ID and name,
refresh date, fetch date, licence, citywide count and the SHA-256 of the raw download.

1. `node tools/fetch-art-heritage.mjs [--date YYYYMMDD]` (needs `unzip` and GDAL's `ogr2ogr`). It caches the raw
   downloads and package records in `~/.cache/slop-toronto/raw/{public-art,heritage-register}/`, then writes the
   snapshots.
2. `node tools/build-art-heritage.mjs` writes:
   - `js/toronto-public-art.js`
   - `js/toronto-heritage.js`
   - `tools/data/heritage-facade-shortlist-20261029.json`

The Heritage Register fields that are dropped (OBJECTID, roll number, MTM coordinates, postal code, address parts)
stay in the cached Shapefile.

## Public art

**Identity.** `SOURCE_ID` is a program or file number shared by a development's works: 98069 covers 19 works. 34
records have no source ID. The durable key is therefore `SOURCE_ID:title-slug`. A repeat of the same content is
suppressed and audited; a key collision with different content fails the build. This snapshot has 308 records in the
frame and no repeats. One title and artist pair, *Warm By Night*, appears at two different places with different
source IDs, and both are kept.

**Visibility.** A mapped record does not prove that a work is outdoors. Each record is classed from its point:

| Class | Records | Rule | In the 3D city |
| --- | ---: | --- | --- |
| `outdoor-point` | 210 | The point lies outside every City massing footprint and every building-type landmark outline. | A stand-in marker |
| `in-building` | 95 | The point lies inside a building: the work may be indoors, in a lobby or on the facade. | Search and card only |
| `reviewed` | 3 | Hand-checked; see below. | Two modelled monuments and one landmark link |

Cards state the class in plain words. They never claim that a work is visible.

**OpenStreetMap places.** 60 OSM places that name the same work become aliases of the City record. Matching uses an
exact name within 150 m, or the distinctive words of one name contained in the other within 60 m. Parks, streets,
stations and buildings named after the same person are refused. The search shows one result, which also answers to
OSM's shorter name: "the archer" finds Henry Moore's *Three Way Disk No. 2*. The marker stands on OSM's point, which
mappers put on the work itself; the City's point is often a street address. Landmark data is unchanged. The
*Princes' Gates* record links to the existing `princesGates` landmark rather than adding a second model.

**Markers.** Each marker is a 1.15 m dark post with a bronze reading plate and a thin warm band: 60 triangles in one
instanced mesh with one vertex-coloured material. Marker meshes do not cast shadows and are culled beyond 130 m.

- **Placement:** each marker must stand on a curb island, plaza or park and be clear of anything solid. If the point
  fails, it tries spots up to 2 m away; otherwise the work stays search-only.
- **Result:** 168 markers stand in the running city. 40 City points lie on a roadway, mostly intersection addresses,
  and stay search-only rather than being moved to a guessed corner. One point is crowded out by street furniture, and
  one marker is shared by two works at one spot.
- **Collisions:** markers have slim colliders. Walkers' detours and the café layout keep clear of them.
- **Counts:** `CITY.publicArtStats` reports the counts. `?publicart=0` turns the layer off.

**Modelled works and how they were chosen.** The game models a work only if it meets three conditions:

- it is in the public domain in Canada (its authors died before 1972, under the old life + 50 rule);
- its form is simple enough that procedural massing is an honest simplification rather than a likeness;
- it stands outdoors in public view.

Two works qualify (`tools/data/public-art-review-20261029.json`):

- **Old City Hall Cenotaph** (W. M. Ferguson, died 1956, and T. C. Pomphrey, died 1966; 1925):
  - **Form:** three granite steps, a plinth, a slightly tapered shaft, a cornice, a capping block and a wreath ring on
    two faces. Inscriptions and carving are not reproduced.
  - **Height:** about 9.5 m, inferred from accounts that it is "about the same size" as the Whitehall Cenotaph. It was
    not surveyed.
  - **Position:** OSM node 555437359, on the plaza in front of the clock tower. The City's point lies in the Queen and
    Bay intersection.
- **Fort Rouillé obelisk** (Langley & Burke, 1887; Exhibition Place):
  - **Form:** a stepped pedestal with a dark plaque panel, and an obelisk with a pyramidion.
  - **Height:** about 7.5 m, estimated. The cannon, mortar and plaque text are not modelled.
  - **Date:** the City record's 1878 is the year of the earlier boulder cairn.

Every other outdoor work gets the neutral marker. Most of these works are modern and in copyright (life + 70 for
authors who died from 1972 on), including Moore's *Archer*, Nemon's *Churchill* and Oppenheim's *Still Dancing*.
Many are figurative. A procedural imitation would misrepresent these works and copy protected expression; a marker
and a card do neither. The South African War Memorial (Allward, died 1955) is in the public domain. It is left as a
marker because its bronze figure group is not a simple form.

**Cards.** Each card shows the title, artist, year, type, medium, a "Find it" address, the program, the
commissioning body and the City's description (trimmed). Two further lines say what the 3D city shows and how
visible the work is. Links go to the City's dataset and, where the record has one, its toronto.ca page. Images and
photo credits are not carried: linked artwork photographs have their own terms, so none are fetched or shipped.

## Heritage Register

**Schema and identity.** The current Shapefile is WGS84 points with these fields:

- register number parts `CEN`/`YR`/`SEQUENCE`/`SEC`/`REV` and `Folder_Row`;
- `STATUS` (Part IV, Part V, Listed);
- `LISTED` and `DESIGNATED` dates, `BYLAW_NO`, `HTG_CONSER` (district) and `EASEMENT_A`;
- `DESCRIPTIO`, `CONSTRUCTI` and `ARCHITECT_`;
- `BUILDING_T` and `REASON`;
- `ADDRESS` and `ADDRESS_TY`.

`Folder_Row` is unique in this edition. The only older export, the 2022 resource, has a different schema with no
`Folder_Row`, so whether `Folder_Row` stays stable across editions is not proven. Places are keyed by the City's
address instead: `heritage:<address-slug>`. Where one address is mapped at points more than 30 m apart (61 Front St W),
the second place gets a `~2` suffix.

**Deduplication.**

- 44 entries repeat another entry's content, address and point under a different `Folder_Row`. Each pair is kept once
  and listed in `audit.duplicateEntries`.
- Entries at one address and point form one place: 7,416 entries make 7,241 places, and 120 places have several
  entries. Exhibition Place's 2 Strachan Ave has 22.
- The snapshot holds 4,407 Part V, 1,085 Part IV and 1,924 Listed entries.

**Buildings.** Each place is matched by its address point to a City 3D Massing footprint:

- If the point is inside a footprint, that building is used. Where a podium and a tower overlap, the lower part is
  used, because that is the street wall a facade reference is about.
- Otherwise, the nearest footprint within 6 m is used.
- The place stores the row and its durable ID, `to-3dmassing-2025:<record>` (`docs/geodata-ids.md`), plus `geodata`,
  the sidecar hash it was built against.
- Results: 7,027 places match a building and 6 match a landmark outline. 208 have no match and stay search-only.
- A test checks every stored ID against `js/toronto-geodata-ids.js`, so a geodata rebuild without a heritage rebuild
  fails.

**Cards and legal status.** A heritage card lists, for up to six entries at the address:

- the status in words, the conservation district, the by-law, the designation and listing dates;
- the year built, the architect, the building type, the reasons and any easement;
- the City's register note.

The card says what the city draws there: City massing or a landmark, never a historic facade. It quotes the City's
caution that the dataset is not a legal status determination. Links go to the City's Heritage Register page and the
dataset. No facade photographs are fetched or shipped. The City record is the facade reference.

**Phone cost.** `js/toronto-heritage.js` is about 3.1 MB raw and 223 KB with Brotli. It is not a startup script: it
loads the first time any search box gets focus (`discovery.js`), and open results refresh when it arrives. A phone
that never searches never downloads it. Public art loads with the city: 196 KB raw, 39 KB with Brotli. Neither layer
adds textures.

## Facade shortlist

`tools/data/heritage-facade-shortlist-20261029.json` lists 60 candidates for later facade work, best first. It
contains no images and is not shipped. It is a planning ranking, not a heritage assessment:

| Criterion | Points |
| --- | ---: |
| Part IV (individual designation) | +4 |
| Heritage easement | +2 |
| Part V (conservation district) | +1 |
| Built before 1900 | +1 |
| Public, religious, financial or commercial building | +1 |
| Named building | +1 |

A place must score at least 6 and stand in a matched building. Each entry names a durable face ID
(`<building ID>:n|e|s|w`), the side facing its address's street (else the nearest street), which is what facade and
storefront manifests key on. At the top are St. James Cathedral (`to-3dmassing-2025:360952:s`, King St E), the YWCA
Laughlin Centre, RioCan Hall, the Daniel Brooke Building, the Church of the Redeemer and the Hudson's Bay store at
Queen and Yonge. Matches are by point, so a candidate's name comes from the massing footprint and needs checking
before any facade work.

## Checks

- **Unit tests:** `node --test tests/art-heritage.test.mjs`. They cover:
  - that each generated layer equals its builder's output;
  - durable key uniqueness and duplicate, conflict and incomplete-snapshot failures;
  - the reviewed works and the landmark link;
  - the visibility classes and OSM merges;
  - address grouping and building IDs against the sidecar;
  - search by title, artist and OSM name;
  - lazy heritage indexing;
  - marker placement on land, clear of solids and of each other;
  - card wording and geometry budgets.
- **GPU captures:** `gpu2 <name> -- env CAPTURE_ROOT=dist CAPTURE_PORT=… CAPTURE_CDN_CACHE=1 node tools/check-art-heritage.mjs`
  takes desktop and low-tier phone captures. They show search results, the cenotaph and its card, The Archer's marker
  at Nathan Phillips Square, Still Dancing at the Distillery, the Fort Rouillé obelisk, a Harbourfront marker and the
  heritage cards.
