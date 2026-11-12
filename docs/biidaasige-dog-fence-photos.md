# Biidaasige Park — Dog Fence / Gate: primary photo source pass

Bead `st-bmyv.5` (remaining DOG FENCES/GATES source gap). Owner: bounded primary-photo
worker. Owned files: **this doc** and `tools/fixtures/biidaasige-dog-fence-photos.json` only.
Private image cache under `$WATERFRONT_RESEARCH/biidaasige/dog-fence-photos/` (with
`index.json`). No meshes, shared files, runtime, GPU, browser, commits or bead-close work.
Captain integrates and personally views every image.

## Question

The City Recreation page (2026-09-09) says both off-leash areas are fenced with accessible
gates, but the City line/area asset data carries no fence/gate geometry (see
`docs/biidaasige-fence-source.md`) and the 2025 ortho predates the fence. This pass asks the
next bounded question: **is there a current (2026) primary photo — with a caption, alt text or
municipal metadata — that shows the actual Biidaasige dog-area fence/gate, and does any photo
carry GPS or municipal metadata giving an exact source position?**

## Answer (short)

**No captioned primary photo of the dog fence/gate was found in this bounded pass.** The
primary City and Waterfront Toronto pages and the MVVA project page carry **no caption or alt
text that identifies a dog fence or gate**. The only dog reference is Waterfront Toronto's
project-page prose ("Two off-leash dog areas"), with no accompanying photo. Several **2026
photos exist** (MVVA gallery, City card images, WT opening hero) but they are **uncaptioned**,
so they cannot be labeled as the dog fence/gate from source text alone. One 2026 drone photo
carries GPS, but it is a wide aerial ~500 m from the west dog area and is **AI-retouched**
(Firefly composite), so it is not a reliable fence close-up. **No fence/gate coordinate,
material, height or maker is derivable.** This is an honest negative, not proof that no photo
exists anywhere.

## Sources checked (all primary, all current)

### 1. City of Toronto — Recreation at Biidaasige Park
- <https://www.toronto.ca/explore-enjoy/parks-recreation/places-spaces/beaches-gardens-attractions/biidaasige-park/recreation-at-biidaasige-park/>
- Cached: `captain/recreation-current.html` (Date modified 2026-09-09).
- Images: banner + three amenity photos (snowy owl, Badlands Scramble, dodem eagle). **No dog
  fence/gate image, no dog caption.** The page's prose asserts the fenced OLAs; it does not
  picture them.

### 2. City of Toronto — Biidaasige Park (main park page)
- <https://www.toronto.ca/explore-enjoy/parks-recreation/places-spaces/beaches-gardens-attractions/biidaasige-park/>
- Cached: `city-park.html`.
- Images: history, placekeeping, public art, food & drink, events, rules, and two **2026-07**
  card images (`9809-2628751SOCIAL012`, `9825-2628751004`). Card labels are "Recreation" and
  "Food & Drink"; **no dog fence/gate caption or alt text.** No EXIF.

### 3. Waterfront Toronto — 2026 west-expansion news
- <https://www.waterfrontoronto.ca/news/torontos-largest-park-in-a-generation-just-got-bigger>
- Cached: `wt-news.html` (dated **July 24, 2026**).
- Images: one opening **hero aerial** ("Aerial perspective of Toronto's waterfront and skyline
  from Biidaasige Park") plus related-item thumbnails. **No dog/fence/gate mention in the
  article text or captions.** No EXIF.

### 4. Waterfront Toronto — Biidaasige Park project page
- <https://www.waterfrontoronto.ca/our-projects/biidaasige-park>
- Cached: `wt-project.html`.
- Prose lists "**Two off-leash dog areas**" among park features, but the page has **no dog
  photo, no fence/gate caption, no gallery**. Images are the opening hero and related items.

### 5. MVVA — Biidaasige Park at the Port Lands (design lead)
- <https://www.mvvainc.com/projects/port-lands-flood-protection2>
- Cached: `mvva-portlands.html`.
- A 19-image project gallery, including **2026** photos. **None has a caption or alt text**
  (the only captioned figure is the 2021 seed-germination image). The page text has **no
  dog/fence/gate mention**. Filenames identify playground, snowy-owl stage area, Badlands/
  Cableway, and wide aerials — **not** a dog fence.

## Photo metadata (exact source positions, no invented coordinates)

Only one cached image carries a real capture position:

| File | Date | GPS (capture position) | Notes |
|---|---|---|---|
| `mvva-biidaasige-park-5.jpg` | **2026-07-19 07:49** | **43.643138272, −79.357514022** (XMP `drone-dji:GpsLatitude/GpsLongitude`) | DJI drone aerial; **AI-retouched** (`compositeWithTrainedAlgorithmicMedia`, "Uses Firefly"); ~500 m SW of the west dog-area centroid (43.64504, −79.35222) |

- The GPS is the **drone's capture position**, not a fence or gate position. It must not be
  read as a fence coordinate.
- `mvva-dsc08769.jpg` is a genuine **2026-07-23** camera photo (Sony ILCE-7SM3) but has **no
  GPS** in EXIF.
- `mvva-dsc05430-topaz.jpg` has a GPS IFD but **no latitude/longitude**, and is **2025-09-09**.
- City card images and the WT hero have **no EXIF** (upload path only, 2026-07).
- No image carries a caption, headline, keyword or IPTC description naming a dog fence/gate.

## Distinguishing dog fence from other fences

- `mvva-playground.jpg` is a **playground** image (filename); do not treat it as the dog fence.
- `mvva-badlands-cableway.jpg` is the **Badlands Scramble / Cableway Canyon**; not the dog area.
- `mvva-snowy-owl-stage-area.jpg` is the **Snowy Owl stage area**; not the dog area.
- No cached image is captioned as a construction fence, and none is captioned as the dog fence.

## Honest conclusion

- **No primary photo with a caption/alt text identifying the Biidaasige dog fence or gate was
  found** in the City recreation page, City park page, WT 2026 news, WT project page, or MVVA
  project page.
- **No fence/gate coordinate, material, height, gate width or maker/contractor is derivable**
  from these sources. The only exact position is a drone capture point, not a fence point.
- The 2026 photos are real and current but **uncaptioned**; identifying a dog fence in them is
  **captain pixel interpretation only**, not a source fact.
- This is a **bounded negative** (≈8 min, five primary endpoints). It does not prove no such
  photo exists on social media, in a contractor portfolio, or in a City capital record.

## What would change the answer

- A City/WT/MVVA photo with a caption or alt text naming the dog off-leash area fence or gate.
- A 2026 photo with GPS EXIF taken inside a dog area (west 43.64504, −79.35222; east 43.64621,
  −79.34943) showing the installed fence/gate.
- A contractor/as-built record naming the fence material, height and gate locations.
- A populated `FENCED_OR_BOARDED_IND = Yes` or a `Fence`/`Gate` asset feature (see
  `docs/biidaasige-fence-source.md`).

## Licence / provenance

City of Toronto and Waterfront Toronto pages are public web pages; MVVA images are the
designer's published project photography. **No image pixels are committed to the repo.** The
private cache and `index.json` live under
`$WATERFRONT_RESEARCH/biidaasige/dog-fence-photos/` for the captain to view. Structured
record: `tools/fixtures/biidaasige-dog-fence-photos.json`.

## Captain visual review: additional play-source evidence

The captain inspected the full contact sheet and the MVVA `mvva-badlands-cableway.jpg` (4,800 × 3,600). It shows the finished eastern playground, including the seven Dodem animal forms across two neighboring woodchip islands. The timber island has a bear in its southeast bulb, a wolf with cubs in its southwest bulb, and the beaver/otter pair at its northern neck; the adjacent western island contains turtle, fish and eagle forms. These are captain visual identifications supported by the separate maker photographs and City installed Dodem photograph. They do not identify dog fences.

The pale curbs match the City2025 aerial trace, allowing a local ground-photo registration. Actual animal pixels are being registered separately; the 2025 construction ladder in the north neck must not be misidentified as an animal. No copyrighted pixels ship. This is a useful positive result for play-structure coverage despite the bounded dog-fence negative.
