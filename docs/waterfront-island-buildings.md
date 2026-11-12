# Toronto Islands building profiles (st-sb3r.16)

The committed geodata rows on the Toronto Islands carry inherited generic mid/high-rise heights (many 20–35 m) over
one- and two-storey Ward's/Algonquin cottages and small park buildings. `js/buildings.js` therefore drew the island
community as 7–12-storey urban towers. This feature supplies conservative, source-matched **rendering overrides** for
those rows. It never moves, replaces or deletes a building: footprints and colliders stay exactly as committed.

## Files

| File | Role |
| --- | --- |
| `js/waterfront-island-buildings-data.js` | Generated records (one per confirmed source-matched committed row). |
| `js/waterfront-island-buildings.js` | Pure runtime lookup: `islandBuildingProfile(row, rowIndex)`. |
| `tools/build-island-buildings.mjs` | Fetches OSM, filters/matches, writes the data file. |
| `tests/waterfront-island-buildings.test.mjs` | Focused proofs (cottages, airport, mainland, lighthouse, frames, purity). |
| `tools/shots/waterfront-island-buildings.json` | GPU capture views for the captain. |
| `tools/data/island-outliers.json` | Archived source snapshot for the reviewed marina outliers (st-sb3r.33). |

## Sources and provenance

Fetched by the tool (recorded in the generated header):

- **OpenStreetMap building ways** around the islands (`43.605,-79.405,43.6345,-79.338`), including tags
  `building`, `building:levels`, `height`, `roof:shape`, `name`, `amenity`. ODbL.
- **OpenStreetMap `landuse=residential` polygons** for the Ward's/Algonquin community. A bare `building=yes` is only
  treated as a cottage inside one of these mapped blocks (or when its own name/amenity identifies a service building).
- **Billy Bishop Toronto City Airport relation 85471** (outer ring). Everything inside it is excluded; airport
  terminal/hangar/firehall rows are never overridden.
- **GEO.waterMask** (`data/toronto-geodata.bin`): the island land component is flood-filled from the frame origin, so
  the downtown shore, the Port Lands and Cherry Beach are never included (no hand-drawn island mask).
- **Excluded landmarks**: Gibraltar Point Lighthouse OSM ways **878933152** and **892934946** (bare `building=yes` tags,
  `man_made=lighthouse` / name match). They are excluded before classification and appear in no record.

Every record names its OSM way id (and version when the Overpass response carries one). Records are keyed by the
committed row's **world centre**, never by array index, so the same footprint resolves in both the detail and Eglinton
frames (they share a projection). Unsupported frames return `null`.

## Matching rules (mutual nearest, no loose pairing)

1. OSM footprint must be on the island land component and outside the airport relation.
2. Candidate committed row must also be on the island land component and outside the airport.
3. Footprint centres within **6 m**, width/depth ratio ≤ **2.0**, and axis-aligned box overlap ≥ **25 %** of the smaller
   footprint.
4. The pair must be **mutual nearest**: the OSM way's nearest row and that row's nearest OSM way must be each other.
   Ambiguous pairs are skipped and counted in the data summary.

## Height and rendering rules

- **Explicit OSM `height` wins**, then **explicit `building:levels`** (1 → 3.5 m, 2 → 6.5 m, n → 3.5 + (n−1)·3.0 m),
  with **no cap**. Levels are source values, not estimates.
- **Confirmed residential typology** (`house`, `detached`, `terrace`, `residential`, bungalow, or a small bare `yes`
  inside a mapped residential block): cottage profile, `kind = 0`, pitched roof (`roof = 1`), estimate 6.5 m.
- **Service / civic / retail / worship / apartments**: low-rise `kind` (1, 4, 6 or 7) with category-specific estimates
  (toilets 3.2 m, service 4.0 m, retail 4.5 m, civic 8.0 m, worship 9.0 m).
- **Roof**: `roof:shape` maps flat → 0, hipped/gabled/etc. → 1. When the source gives no roof shape and the typology is
  not a confirmed cottage, the record carries `roof: null`, meaning **keep the native roof**.
- `building=yes` outside a mapped residential block and without a service name/amenity or explicit height/levels is
  **skipped** rather than guessed.
- There is no blanket island height clamp. Estimates are labels (`heightSource: "conservative island estimate"`), not
  measurements.

## Captain integration

The hook is already wired in the row loop of `js/buildings.js` (around the row destructure at line ~650):

```js
const profile = window.CITY.islandBuildingProfile?.(b, bi);
const [cx, cz, ang, parts, h0, kind, roof, cseed, , name] = b;
const h = profile?.height ?? h0;
const k = profile?.kind ?? kind;      // use k wherever the native kind is read
const r = profile?.roof ?? roof;      // a null roof keeps the native roof
```

Apply the values to local variables only. **Do not mutate `GEO.buildings`.** The existing native weather, facade and
building instancing paths are untouched.

`islandBuildingProfile(row, rowIndex)` returns `null` for unsupported GEO/frames, mainland rows, the airport, the
lighthouse and any row without a confirmed source match. It returns a fresh object with `{ height, kind, roof,
category, heightSource, osm, matchM, native }`; `roof` is `null` when the source does not specify one.

**Runtime identity guards.** It is not enough that a row's centre falls inside the frame bounds: the active
`GEO.frame.projection` must match the projection recorded in the data summary (`lat0, lon0, kx, ky, theta, ox, oz`),
and `row[2]`/`row[3]` (yaw + part rectangles) must reproduce the record's `fp` signature. A different projection, or a
re-cut/reshaped footprint at the same centre, is an honest no-op (`null`).

## Known gaps (recorded honestly)

- The generated set currently matches **331** committed rows from **455** island OSM candidates. **91** island OSM
  buildings have no confirmed mutual match (different segmentation or missing massing parts) and **33** generic
  footprints were skipped as unclassified.
- **26** inherited tall rows on the island still have no source-matched profile. Three formerly-unmatched marina towers
  at the Queen City Yacht Club (rows 32501/32502/32503) were resolved in **st-sb3r.33** — see
  [waterfront-island-building-outliers.md](waterfront-island-building-outliers.md). The remaining group includes the
  eastern Ward's Island strip around x≈1200–1300, z≈2160–2240, where OSM generic `yes` footprints sit outside the mapped
  residential polygons. They keep their native massing until a better source confirms them.
- Coordinator GPU review confirmed cottage scale and restored Ward park grass; full suite: 884 passed, 3 skipped, 0 failed. Final capture evidence is recorded in waterfront-realism.md.

## Verification

```sh
node --test tests/waterfront-island-buildings.test.mjs
```

The tests prove: cottages get ≤7 m / kind 0 / pitched roof; the airport terminal and firehall rows are `null`; mainland
rows are `null`; lighthouse ways are absent from the records; explicit levels win; a missing roof source returns
`null`; rows are not mutated; the same row resolves in the Eglinton frame; unsupported data/frames are no-ops.

## Ward's Island Park ground (st-sb3r.17)

GPU raycasts on the ward view hit **Walkways at 0.22 m** over **Lawns at 0.218 m** across the park (e.g. 1750,2250),
so the park was not a missing lawn or a masked sand strip: the fixed sidewalk band covered it. Cause: block 2893 is a
large concave island with no City sidewalk pieces, so `city-grid.js` built its fallback band as an `ExtrudeGeometry`
of the island outline with the inward offset (`prop`, `SW = 4.6 m`) as a *hole*. For this outline the offset
self-intersects (`ringSelfIntersects(prop) === true`), so THREE's hole triangulation filled the whole island with the
walkway top.

Minimal guarded fix in `js/city-grid.js`:

- `annulusSafeXZ(inner, prop)` checks the inner/prop rings are simple, the prop is smaller, and every prop vertex is
  inside the inner ring.
- When the check fails (concave islands such as Ward's), `walkBandGeometryXZ(inner, prop, 0.03, SW_TOP)` builds the
  same band as per-edge quads: a top strip plus the two low side faces. It cannot flood the interior.
- Simple islands keep the original extruded annulus; no blanket grass overlay, no hard-coded Ward coordinates, no
  change to park paths, curbs or unrelated blocks.

`tests/city-grid-concave-walk-band.test.mjs` uses the committed block 2893 outline and proves the old extrusion
covers four park points while the new band leaves them as lawn and still covers every band edge midpoint; a simple
rectangular island still takes the original path.

The city-grid building-height heuristic now uses the same profiles as the renderer, preventing old tower defaults from classifying 18 cottage/park blocks as downtown paving. No yard area, road, court or native building footprint is moved.

## Cottage appearance (st-sb3r.18)

GPU review of the Ward's Street golden after st-sb3r.16 showed the height fix worked but every cottage still used the
city house path: orange/brown **brick boxes** with no entrances, and some generic pyramidal roofs. The captions and
photographs below (the captain inspected the full images; this implementation model cannot see pixels) show a different
typology: horizontal clapboard, broad white casing/fascia, a deep entry/porch, and gable or gambrel roof silhouettes.

### Photographic evidence (downloaded, not per-house attribution)

- `A_lovely_cottage_on_Ward's_Island_(27864695136).jpg`, shankar s., CC BY 2.0, Wikimedia Commons: blue horizontal
  clapboard, thick white window/door casing, a large gable dormer in a dark asphalt pitched roof, a lower porch/deck;
  the adjacent cottage is muted green with red trim and a fishscale roof.
- `125_House_on_Ward_Island.jpg`, XeresNelro, CC BY-SA 4.0, Wikimedia Commons: yellow horizontal clapboard, broad
  white fascia, a Dutch gambrel roof with projecting dormers, a deep porch roof and a chimney/flue.

These establish a **varied cottage typology**, not one uniform hip-roof form. They are not used to claim that any
specific committed row has that exact colour or roofline.

### What the profiles now carry

`tools/build-island-buildings.mjs` adds source-labelled appearance metadata to every record (the cached 331 match set
is unchanged):

| Field | Values | Provenance |
| --- | --- | --- |
| `typology` | `cottage`, `apartment`, `worship`, `civic`, `retail`, `service`, `generic` | classification, as before |
| `roofType` | `gable`, `hip`, `pyramidal`, `gambrel`, `flat`, `round`, `pitched` | explicit `roof:shape` first; otherwise a cottage gets a stable typology split (70 % gable, 30 % hip, keyed by OSM way id) |
| `roofSource` | `OSM roof:shape` / `island cottage typology approximation` | per record |
| `siding` | `clapboard`, `wood` | OSM `building:material` where present, else the labelled cottage typology |
| `sidingSource` | `OSM building:material` / `island cottage typology approximation` | per record |
| `entry` | `inset-front-porch` for cottages, `null` for service buildings | labelled typology approximation |

The record `tags` block now also copies `building:material`, `building:colour`, `roof:shape`, `roof:material` and
`roof:colour` so a reviewer can audit every value. The summary records the cottage count, the explicit roof count and
an `appearanceApproximation` note. **No per-house colour is claimed as measured.**

### Renderer extension (`js/buildings.js`, scoped)

The extension runs only when `islandBuildingProfile(...).typology === 'cottage'` and the row is on its box path. It
does not touch service buildings, the airport, the lighthouse, the mainland, the Eglinton frame's unsupported rows, the
Distillery or the `?massing=1` polygon material path.

- **Clapboard facade**: a dedicated `createIslandCottageMaterial()` wraps the existing rendered facade with broad
  punched cottage windows (~1.12 m opening on a ~2.5 m bay pitch, 2.9 m storey, tall ~1.5 m opening — see the bay-spacing
  correction below) and a horizontal
  course-shadow term at 0.22 m. The course shadow fades using the real screen-space derivative (`fwidth`) instead of a
  fixed constant. Siding colours come from a small documented palette of island clapboard tones (white, pale grey,
  muted green/blue, soft yellow/cream).
- **Varied silhouette**: an explicit OSM `gable` gets a real gable ridge (`pushGableRoof`, gable ends in the wall
  colour). `hip`/`pyramidal`/other pitched shapes use the native hipped form at a lower cottage pitch. Records without
  a source roof shape get the documented 70 % gable / 30 % hip cottage split above. Gambrel is deliberately
  approximated as a hip in this first revision.
- **Entry and trim**: one instanced white-trim draw adds corner boards, a broad eave fascia on all four walls, a door
  casing and a shallow painted door leaf with upper glass. Corner boards and the door project at most 0.2 m from the
  facade; no porch, stoop or parcel extension is claimed. The earlier inset porch was buried inside the solid wall and
  was removed after GPU review. The existing building collider is unchanged.
- **Wall proportion**: `islandCottageEaveHeight(total, w, d, estimated)` stops estimated cottage walls at about
  3–4.4 m (one/one-and-a-half storeys) and lets the roof occupy the rest of the existing 6.5 m estimate. Explicit OSM
  `height`/`building:levels` are totals too, so taller source buildings keep taller walls but still close at the
  source height.
- **Bounded cost**: one extra facade draw for cottages plus one instanced trim draw (11 small boxes per cottage).
  Roofs continue to batch into the existing hipped-roof mesh.

### Capture views

`tools/shots/waterfront-cottage-refinement.json` holds five captain views on the actual road/footpath network. Each
street camera was derived from the committed geodata (not hand-placed): the subject is a confirmed source-matched
cottage, its front face is the wall the mapped `nearestRoads` point faces, and the camera is placed 12–20 m out along
that front normal (nudged ~35 % of the distance along the wall for a three-quarter view) at 1.8 m eye height. Every
camera and both front-wall corners were checked to be **outside all building OBBs**, on land, on the road/path network
(`nearestRoads`/`blockAt`), with an **unobstructed line of sight** to the front wall.

| View | Camera (x, y, z) | Looks at | Road |
| --- | --- | --- | --- |
| `wards-third-street-fronts-golden` | 1644.72, 1.8, 2003.63 | 1632.85, 1.7, 2008.19 | Third Street |
| `wards-fifth-street-fronts-midday` | 1589.21, 1.8, 2078.31 | 1595.1, 1.7, 2067.03 | Fifth Street |
| `wards-lakeshore-fronts-golden` | 1574.27, 1.8, 2174.77 | 1566.03, 1.7, 2165.08 | Lakeshore Avenue |
| `algonquin-nottawa-fronts-midday` | 1182.35, 1.8, 2217.04 | 1189.6, 1.7, 2206.6 | Nottawa Avenue |
| `wards-aerial-midday` | 1500, 58, 1880 | 1640, 0, 2000 | (above the roofs, clear 3-D ray) |

The previous cameras (Third Street 1484,1.7,1868 and Lakeshore 1640,1.7,2070) are replaced: the first stood **inside a
building OBB** (the frame showed only an interior wall) and the second viewed the street rather than a cottage's frontal
entry. The table's targets are the shots' own look points; the test reads the shot list directly, so editing a camera
back inside a wall, off the road network, behind another building, or onto a non-cottage subject fails the suite.

### Verification and limits

```sh
node --test tests/waterfront-island-buildings.test.mjs
```

The tests still prove the airport/lighthouse/mainland no-ops, pure lookup, frame identity and explicit height/levels.
New profile proofs: every cottage record carries source-labelled siding/entry/roof metadata and exposes it through the
runtime profile; service records carry `siding: null` and `entry: null`; explicit `roof:shape` records keep their
subtype and provenance. New **geometry** proofs (js/buildings.js exports its pure helpers) measure the actual roof
vertices: base on the eave, apex at the profile total, upward slope normals, four base vertices and ridge apex per
gable end, and outward end normals; the eave helper keeps estimated walls at one/one-and-a-half storeys; every trim box
remains shallow facade relief and above ground. Roof geometry is a sealed volume: every undirected triangle edge
occurs twice, with downward-facing soffits and vertical edge fascia closing the 4 cm roof thickness. A new **camera-clearance** proof reads
`tools/shots/waterfront-cottage-refinement.json` and the committed rows: every street camera is outside all building
OBBs, on land, on the road/path network, at 1.7–2 m eye height, in front of a confirmed cottage's road-facing wall, with
a clear line of sight to that wall centre and both corners; the aerial is above the roofs with an unobstructed 3-D ray. No full-suite or laptop-GPU run was performed in this task; the captain owns integration review and gpu2
captures.

Honest limits: the model could not inspect the two JPEGs (text-only model), so the photographic reading is the
captain's; the clapboard/palette/door are typology approximations, not measurements; gambrel/gable dormers and
fishscale shingles have no geometry yet; and per-house attribution remains impossible from the current OSM tags (zero
island cottages have `building:material` in this snapshot). Wave 6 corrections also passed the captain’s `wave6-cottage-fascia` four-front GPU capture on the Mac mini.
The golden Willow Avenue view shows siding, broad white casings, the painted entry and a sealed roof edge.
Native island lane widths/curbs and per-parcel gardens remain outside this cottage-geometry pass.

### Bay-spacing correction (st-sb3r.31)

The first cottage pass read as a near-continuous white window bank: `windowWidth: 1.6` with `windowRatioX: 0.70` left
only ~0.48 m of siding between openings, so every mapped cottage looked like repeated frames rather than the sparse
punched windows on substantial clapboard wall seen in the primary Oneida Avenue photograph (Ward's/Algonquin typology).

The shared math in `createRenderedFacadeMaterial`/`facadeCell` (js/tsl-materials.js) confirms what each parameter does:
`windowWidth` is the **bay pitch** — `bays = round(wallWidth / windowWidth)`, `bayWidth = wallWidth / bays` — not the
opening width. The opening is `windowRatioX × bayWidth` wide (`halfWin(ratio) = (1 − ratio) / 2`), and `windowCasing`
metres of white casing sit outside it on each side. So the spacing correction widens the bay to ~2.5 m and takes the
reciprocal ratio: `windowWidth: 2.5, windowRatioX: 0.45`. That:

- keeps the horizontal opening at **1.12 m** (0.45 × 2.5 = 1.125 m; the first pass was 0.70 × 1.6 = 1.12 m) — no new
  narrow vertical slots or oversized glass;
- raises the siding gap between openings from **0.48 m to ~1.38 m** (~1.18 m clear of casing), giving the sparse
  punched-window rhythm;
- keeps the **tall** opening by leaving `floorHeight: 2.9` and `windowRatioY: 0.52` untouched (~1.51 m high);
- leaves white casing (`windowCasing: 0.10`), trim colour, seed, corner boards (`cornerPier`), the 0.22 m clapboard
  shadow and the door geometry unchanged.

**Floor-count nuance**: the cottage storey stays 2.9 m. Estimated walls already stop at the eaves via
`islandCottageEaveHeight` (one/one-and-a-half storeys); no extra storey is added, so taller cottages keep their
source total height and the roof still occupies the rest. Where a wall is wide enough for more bays, `round()` now
yields fewer, wider bays (more wall) at the same fixed opening — the intended effect — while a narrow wall still gets at
least one bay. Source-mapped roof shape and total height are unaffected, and this is generic documented typology, not a
per-house window count/colour/position claim. This is a reversible visual-parameter change; no constant-mirroring test
was added.

### Door-bay alignment (st-sb3r.31)

The wave7 GPU close-up exposed a real bug the spacing pass did not fix: the custom shallow door sat **in front of a
procedural window**, with the window's transom and casing visible above it and a blank bay beside it. Root cause, now
confirmed in `facadeCell` (js/tsl-materials.js): for a wall with an `entry` face, the shader removes the window from one
bay — `bays = round((wallWidth − 2·pier) / windowWidth)`, `bayWidth = (wallWidth − 2·pier) / bays`,
`chosen = min(floor(tone · bays), bays − 1)`, `pier = min(cornerPier, wallWidth · 0.2)` — and this happens **even with
`proceduralEntrances: 0`** (the cottage material draws no procedural door). Meanwhile `islandCottageTrim` placed the
custom door at the wall centre, ignoring `tone`, so the geometry and its shader-reserved opening disagreed.

The fix keeps **one source of truth** for the cottage bay metrics. `js/buildings.js` now exports
`ISLAND_COTTAGE_BAY_PITCH` (2.5 m), `ISLAND_COTTAGE_CORNER_PIER` (0.35 m), `ISLAND_COTTAGE_DOOR_CASING` (1.35 m) and
`ISLAND_COTTAGE_TONE_MIN` (0.02); `createIslandCottageMaterial` reads the pitch and pier from them, so a future spacing
change moves the shader and the door together. Two pure helpers reproduce the shader's choice:

- `islandCottageDoorBay(wallWidth, shaderTone)` returns the reserved bay's `bayWidth` and its metre-`center` along the
  wall. Crucially, the **suppression mask** (facadeCell's cornerPier branch) computes `bayIdx` from `s = along·wallWidth`
  — **unflipped** — while the *flipped* `wallS` only positions the **drawn** procedural entrance/storefront that the
  cottage suppresses (`proceduralEntrances: 0`). So the door matches the mask, and there is **no flip**: the centre is
  simply the wall's min corner plus `center` on the varying axis (±u walls vary along v, ±v walls along u, matching
  `facadeCell`'s `alongZ`).
- `islandCottageShaderTone(tone, index)` reproduces the shader's **Float32** decode of `box.w = (i·29 mod 1000) + 0.1 +
  0.8·tone` (createFacadeBoxes): the packed integer part reaches 999, so `fract(box.w)` loses precision and the shader's
  *effective* tone drifts from the raw tone by up to a few 1e-5 — enough to pick the **adjacent bay** right on a bay
  boundary. The door therefore uses the tone decoded for the largest part's actual `cottageBoxes` index (the boxes
  already emitted plus the valid parts before it), never the raw tone.

`islandCottageTrim` takes that decoded tone and lays the casing/leaf/glazing in the reserved bay:

- the door stays shallow facade relief (0.03/0.072/0.087 m outward offsets, leaf 0.02 m, glazing 0.012 m) — no porch,
  no parcel extension, the mapped footprint and collider are unchanged;
- a narrow wall clamps the casing to the reserved `bayWidth`, so the entry can never spill past the shader's opening;
- the cottage box tone is held at `≥ ISLAND_COTTAGE_TONE_MIN` (0.02): `chosen = min(floor(tone·bays), bays − 1)` has no
  *lower* clamp, so a decoded tone that Float32-rounds below 0 (raw tone ≲3e-5 at a high box index) would give
  `chosen = −1` and reserve **no** bay; the floor keeps `chosen ≥ 0` so every cottage keeps a real reserved bay.

This is a consistency fix to the **existing** tone-driven generic doorway (typology approximation), not a new mapped
entry coordinate and not a per-house doorway claim. The tone was already the same per-building value every cottage part
box carries (`cottageBoxes.push({ … tone … })`); the fix only pins it to the decoded value the shader actually uses.

**Focused proof**: `tests/waterfront-island-buildings.test.mjs` re-derives `facadeCell`'s mask bay as an independent
oracle — using the **unflipped** `s` and the Float32-decoded tone — and walks the real trim geometry's door leaf back
into it on **all four fronts**, across seven wall widths (1–6+ bays), boundary tones (each bay edge ±1e-5) and high box
indices (up to 999), over four rotations. A separate test proves the helper follows the *decoded* tone, not the raw one
(it finds the boundary cases where they disagree), and that the tone floor keeps `chosen ≥ 0`. Existing
shallow-relief/collision bounds are unchanged. Global materials and cameras are untouched; the captain owns the matched
desktop/phone captures.

### Cottage window/door review — 2026-11-10 (.31)

The photo-informed 2.5 m nominal window bay retains roughly 1.1 m openings and gives them wider clapboard separation. This is a generic cottage typology, not a surveyed window count. The shallow physical door now occupies the same unflipped bay that the facade shader suppresses, including the Float32 packed-tone decode; it no longer covers a window while leaving a different bay blank.

Captain verification: 18 focused geometry tests passed; `wave7-door-review` desktop and `wave7-door-phone` 412×915/low each completed four Mac mini captures. The close front-0 image and Oneida street were inspected, and the phone close view confirms no window above/behind the door. The subsequent integration checkpoint full suite passed 1,014 tests with zero failures and three skips (1,017 total), log `$WATERFRONT_RESEARCH/wave7-cottage-full-tests.log`. These are functional/visual results, not an idle-host performance benchmark. House-specific colors, roof forms and garden layouts remain estimates.
