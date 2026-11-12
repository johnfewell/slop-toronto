# Biidaasige Park — public art, Indigenous placekeeping & MT35 source pass (st-bmyv.6)

Bounded (≤10 min) independent source/reconstruction pass for the remaining current-2026
public art, Indigenous placekeeping and Marine Terminal 35 heritage features. **No meshes,
no shared-file edits, no commits, no GPU/browser, no bead close.** Owned files only:

- `docs/biidaasige-placekeeping-source.md` — this file
- `tools/fixtures/biidaasige-placekeeping-source.json` — machine-readable contract

This pass does **not** repeat the already-integrated Fire Hall 30, Atlas Crane or The Drum
work in `docs/biidaasige-heritage.md`; it reconciles them only where the new sources touch them.
It also avoids the separate Dodem, fitness, dog-surface and relief research.

## Headline

- The **current Lassonde Art Trail** is represented by a published Fall 2026 route: the official
  **Fall 2026** map (PDF CreationDate **2026-09-21**) marks **17 sites / 14 titled works**,
  shown within the park diagram. The Waterfront Toronto release of **2026-07-24** names the
  western-section works and says Kent Monkman and Monira Al Qadiri were "to come this fall";
  the Fall 2026 map includes both in its current/planned route; it does not independently prove physical installation.
- The official map publishes **map-space point metadata** (marker fractions on the
  8580×5616 interactive map image, and marker-number anchors in the A3 PDF), but **no
  lat/lon, GeoJSON, KML or footprint**. No public structured source georeferences that map.
- The City of Toronto **Public Art** Open Data GeoJSON (459 features, years to 2024) contains
  **none** of these works — a clean negative.
- The **Fire Holder, Sturgeon Stones, Marker Trees/Directional Compasses, Interpretive
  Signage and MT35 fragments** are named by Waterfront Toronto but have **no public point,
  geometry or count**. The City 2026 wayfinding map labels only "Trajet (public art)" and
  "The Drum".

## Method

1. **Lassonde Art Trail site** — `https://lassondearttrail.org/` and `/art-trail/`.
   - The interactive map exposes each marker's normalised `left`/`top` fraction of the
     official base image `260514_LAT_MAP_FULL_UPSIDE-DOWN-FULLSUMMER2026.jpg` (8580×5616,
     intentionally "upside-down", i.e. not north-up). Extracted from the HTML.
   - The downloadable **Fall 2026 A3 map** (`LAT_MAP_DOWNLOAD-Fall2026.pdf`, 1 page,
     1190.55 × 841.89 pt) carries numbered markers 1–14 (3a–3d) plus a legend. Number-anchor
     coordinates were extracted with `pdftotext -bbox`; these anchor the printed number,
     not a surveyed sculpture centre.
   - Each artist page supplied the title, artist, work year, medium, on-view date and the
     artist's own location sentence.
2. **Waterfront Toronto news release** — 2026-07-24, "Toronto's largest park in a generation
   just got bigger": western-section artists, fall-2026 arrivals, Indigenous features, MT35.
3. **City 2026 wayfinding map** — the private local copy
   `$WATERFRONT_RESEARCH/biidaasige/inventory/wayfinding-2026.pdf`; text search only.
4. **City of Toronto Open Data Public Art GeoJSON** — downloaded and filtered for the works
   and for any point in the park bbox.

No image pixels were inspected. No coordinate was inferred from prose. No access barrier
was bypassed.

## Art Trail — installed 2026 condition

Positions below are **map-space**, not geographic. `webX/webY` are fractions of the official
interactive map image (origin top-left); `pdfX/pdfY` are PDF points on the A3 Fall 2026 map.
Both come from the same official publication and are retained so the Captain can georeference
or cross-check them visually.

| # | Work | Artist | Work year | Installed phase | Medium | Documented location | webX / webY | pdf X / Y |
|---|------|--------|-----------|-----------------|--------|----------------------|-------------|-----------|
| 1 | Orange Functional | Alexandre Arrechea | 2022 | 2025 east | Steel, basketball nets | Main entrance plaza of Old Fire Hall 30 | 0.596816 / 0.405892 | 702.3 / 309.8 |
| 2 | Crown Act | Oluseye | 2025 | 2025 east | Accoya wood, stain, bronze | Overlook of the new Don River mouth | 0.825758 / 0.466769 | 950.8 / 352.2 |
| 3a | Stories of relics (i) | Ryan Gander | 2026 | 2026 west | Bronze, armourstone, paint | Distributed through the park | 0.514705 / 0.434673 | 599.0 / 334.0 |
| 3b | Stories of relics (ii) | Ryan Gander | 2026 | 2026 west | Bronze, armourstone, paint | Distributed through the park | 0.561785 / 0.652953 | 667.5 / 494.1 |
| 3c | Stories of relics (iii) | Ryan Gander | 2026 | 2026 west | Bronze, armourstone, paint | Distributed through the park | 0.198080 / 0.444125 | 243.9 / 335.0 |
| 3d | Stories of relics (iv) | Ryan Gander | 2026 | 2026 west | Bronze, armourstone, paint | Distributed through the park | 0.142142 / 0.382781 | 176.4 / 302.1 |
| 4 | Homing | Nadia Belerique & Tony Romano | 2026 | 2026, section unstated | Aluminum, steel | Park environment/river, bridges, picnic areas | 0.468677 / 0.645921 | 560.5 / 483.2 |
| 5 | Roman Standard | Tracey Emin | 2013 | 2025 east | Bronze, steel, wax/pigment | Park site (NGC loan) | 0.637789 / 0.588764 | 737.7 / 447.7 |
| 6 | Delicate Matter (for the birds) | Kara Hamilton | 2026 | 2026, section unstated | Cob, lime wash, brass, rammed earth, beach glass, hyssop | Park site | 0.732443 / 0.600281 | 854.8 / 456.2 |
| 7 | Trajet | Caroline Monnet & Dean Baldwin Lew | 2019 | permanent (2025 east) | Bronze | Bend of the new Don River mouth | 0.913738 / 0.407859 | 1065.6 / 313.1 |
| 8 | First Sun | Monira Al Qadiri | 2025 | 2026 fall | Cast aluminum, steel, automotive paint, brass pedestal | Park site; NYC run ended 2026-08-03 | 0.321431 / 0.376209 | 392.8 / 295.8 |
| 9 | against the wind, with the wind | Alexa Kumiko Hatanaka | 2026 | 2026 west | Ripstop nylon, ink, flagpoles | Renaturalised Don River mouth | 0.271230 / 0.430321 | 330.1 / 324.1 |
| 10 | The Colony | Kent Monkman | 2026 | 2026 fall | Bronze, steel | Shores of Ookwemin Minising | 0.099830 / 0.503278 | 133.6 / 382.1 |
| 11 | Lodestar | Lisa Hirmer | 2026 | 2026 west | Steel | Park site | 0.056084 / 0.494514 | 90.7 / 368.9 |
| 12 | Saverio and Daisy (Navel) | Hank Willis Thomas | 2018 | 2026 west | Rolled steel, enamel paint | New esplanade | 0.056084 / 0.445220 | 90.7 / 319.1 |
| 13 | Ernest and Ruth (Exuberant Pink) | Hank Willis Thomas | 2018 | 2026 west | Rolled steel, enamel paint | New esplanade | 0.056084 / 0.386744 | 90.7 / 278.0 |
| 14 | Untitled (Juniper) | Virginia Overton | 2014 | 2026 west | Mild steel, paint | Park site | 0.094093 / 0.392640 | 127.0 / 305.9 |

**Within vs near park.** Every one of the 17 markers sits inside the park on the official
Art Trail map. The only "near park" ambiguity is editorial, not geographic: the `First Sun`
artist page still says the work is "currently installed" at Doris C. Freedman Plaza in NYC
(ended 2026-08-03). The 2026-07-24 release and the Fall 2026 map establish the Toronto
installation, so it is recorded as **2026 fall**, in-park, with that discrepancy flagged.

**Installation dating.** The map is Fall 2026 and its PDF was created 2026-09-21. The
2025-east / 2026-west split follows the Waterfront Toronto release: the western expansion
opened on 2026-07-24 with works by Gander, Hatanaka, Hirmer, Overton and Hank Willis Thomas
(two works); Monkman and Al Qadiri are the two fall-2026 arrivals. Works not named in either
list (Homing, Delicate Matter) are marked "2026, section unstated" rather than guessed.

## Indigenous placekeeping — named, still unplaced

| Feature | Designer | Phase | Position |
|---------|----------|-------|----------|
| Fire Holder | Solomon King and Brook McIlroy | 2026 | none published |
| Teaching Signifier Sturgeon Stones | Solomon King and Brook McIlroy | 2026 | none published |
| Directional Compasses / Marker Trees | Two Row Architect | 2026 | none published (may be multiple) |
| Interpretive Signage | NVision Insight Group | 2026 | none published (may be multiple) |
| The Drum | Tawâw Architecture Collective | 2026 | map zone label only (already integrated) |

No public point, count, footprint, GeoJSON or KML was found. The City 2026 wayfinding map
does not label any of these. This is a bounded negative, not a placement.

## Marine Terminal 35 heritage fragments

Waterfront Toronto states that "elements of the Marine Terminal 35 building" are incorporated
into the park, but publishes **no fragment count, geometry or point**. The Atlas Crane itself
is separately mapped (`node/9521067431`) and already integrated; the surviving MT35 fragments
remain unplaced here.

## Negatives (explicit)

- No GeoJSON/KML/KMZ endpoint was found during this bounded pass on `lassondearttrail.org`; its map is a raster image,
  not georeferenced.
- City of Toronto Open Data **Public Art** GeoJSON: 459 features, dataset years to 2024.
  **Zero** matches for Biidaasige, Lassonde, or any of the 14 titles. The only features in
  the park bbox are three Distillery District pieces outside the park.
- City 2026 map text contains only "Trajet (public art)" and "The Drum" among art/heritage
  labels.
- No source converts the official Art Trail map to lat/lon, so the contract deliberately
  leaves all `lat`/`lon` null rather than fabricating coordinates.

## Source & licence note

- Lassonde Art Trail artist pages and map: rights reserved. `publicReferenceImage` URLs are
  recorded per work for the Captain's private viewing; **do not commit pixels**.
- The official map image and A3 PDF are private reference only.
- City of Toronto Open Data Public Art GeoJSON: Open Government Licence – Toronto.
- Waterfront Toronto page: © Waterfront Toronto; quoted facts only.

## Unresolved / hand-off

1. Georeference the official Art Trail map (or obtain a public lat/lon layer) to turn the 17
   map-space markers into coordinates.
2. Obtain positions/counts for the Fire Holder, Sturgeon Stones, Marker Trees/Directional
   Compasses and Interpretive Signage.
3. Obtain the MT35 fragment locations and geometry.
4. Decide whether `Homing` and `Delicate Matter` are east or west; the current public release
   does not say.
