# High Park's ground cover, understory and woods impostors

Pilot · 2026-11-06 · Epic `st-annt` (children `.1`–`.5`) · On [High Park's woods](high-park-woods.md) and
[terrain](high-park-terrain.md).

John, 2026-11-06: the black oak savanna "does not look the way it looks in real life. In real life, it's a lot
denser. Just with plants and leaf cover. Not necessarily trees." The woods data had put every tree where the lidar
has its crown, but under them the park was a flat colour: no tall grass, no shrubs, no ground plants, and the woods
open to the streets 100 m away. This pilot adds what grows under the trees, and pays for it with impostors for the
woods' far trees. It is on by default inside High Park's box only.

## 1. Reference

Nine summer photos of the park from Wikimedia Commons (CC BY 2.0 and CC BY-SA 4.0; authors, dates, GPS and links in
the evidence folder's `provenance.json`), each beside the game at the same spot. What was missing, biggest first:

1. the ground layer: the savanna's and the meadows' knee- to waist-high grass, goldenrod and other forbs, up to the
   trails' edges;
2. the shrub and sapling layer, 1–5 m: dogwood, sumac, serviceberry and young trees walling in the trails;
3. green ground plants over the woods floor's litter;
4. trails as narrow worn earth with plants to their edges.

Two more items went to John, and he took both into the pilot: the canopy's colour (deeper yellow-green, not mint)
with less even trunk spacing, and Grenadier Pond's shore (willows and shrubs down to the water, not lawn).

## 2. What it adds (`js/park-cover.js`)

### The maps

- **Habitat**, on the woods data's 4 m grid. Tall grass and forbs grow on the meadow (OpenStreetMap's wood or scrub in
  the open), and on the woodland floor where it is open: the savanna's grass under its oaks. The woods' ground plants
  grow where the floor is closed. The lidar's shrub layer (below) is folded in. Lawns, the zoo, the gardens and the
  off-island cells grow nothing.
- **Clearance**, a signed distance field at 1 m: the exact distance (to each segment or outline, not counted in cells)
  to the nearest path (the features' trails and the city's park paths, at their
  mapped widths), bed, paved area, building, court or rink, or lawn; and 2.5 m off every pond, which keeps the water
  edges' mud margin and reeds clear. Only the lawns' and kerbs' edges are rasters (a chamfer). Sampled filtered with a
  little noise, the plants' edge follows a trail's outline smoothly; near a trail a clump narrows so its card doesn't
  reach over the path, and the sprites' blades thin out and shorten towards their sides, so the clumps along an edge
  don't stack into steps.

### The shrub layer from the lidar (`tools/build-park-cover.mjs` → `js/high-park-cover-data.js`)

The tall grass is under the lidar's resolution: the meadow reads as bare ground, and the GTA 2023 flight saw no
grass. Shrubs, though, it does see. For each 4 m cell the builder takes the share of its ground under vegetation
1–5 m tall: the Digital Surface Model over the Digital Terrain Model, as the woods build reads the canopy. It stores
that share in 2 bits (under 5%, 20%, 45%, more). Of the park's 170 ha of cells:

- 23.7 ha are sparse;
- 10.4 ha have shrubs;
- 7.9 ha are thicket.

The file is 56 KB (19 KB gzipped), and the builder rewrites it byte for byte from the same tiles.

### The tall grass, forbs and ground plants

These are drawn on the GPU in rings round the viewer, after threejs-nanites' grass:

- Each ring is a grid of cells that follows the camera, snapped to whole cells, so a clump stays where it stands.
- The vertex shader decides each cell's clump from a hash of the cell and the maps: whether there is one, what it is
  (in the tall grass 66% bluestem, 22% goldenrod, 12% asters and other forbs; the woods' herbs elsewhere), how tall,
  and where it stands. Its height comes from the terrain's own grid triangles, the same ones the ground is draped on.
- A dropped clump collapses to a point, so it has no area to rasterize, and so does one behind the camera.
- Coarser cells and bigger clumps go further out, cross-faded by a dither.
- Clumps are three (near) or two crossed cards with procedural sprites, painted on a canvas at start-up. Their tops
  sway in the wind. They follow the lawn's seasons, and they receive the sun's shadows but cast none.
- Along a path they start 0.15 m from its edge and are shorter for the first 1.5 m, as where they are trodden. The
  mapped paths themselves are not moved or narrowed. The City's sidewalks on the park's islands (Centre Road's, Colborne
  Lodge Drive's) stay clear too, and along the islands' edges each metre is checked against the island, so nothing
  grows over a kerb.

### The natural trails (`js/high-park-features.js` TRAIL; `?trails=0`: as before)

The unpaved trails (OpenStreetMap's earth, dirt, ground and unsurfaced paths: surface 1) read as worn single-track
earth inside their mapped corridor. The mapped centreline and width stay the walkable corridor: walking, cycling and
collision don't change, and walking on the short grass beside the earth is fine.

- **Width:** the worn earth is narrower than the corridor.
  - It wanders between 0.45 and 0.8 times the mapped half width by a smooth field (30–70 m), narrowest in the
    meadows.
  - It is up to 0.25 wider in the woods (the woods floor) and up to 0.2 wider within 6 m of a junction (another path
    within 2.5 m).
  - Its edge is ragged by ±0.12 m and bitten into by tufts.
- **Surface:**
  - a darker compacted centre, or in stretches two worn lines a stride apart;
  - ruts along the worn lines, with puddles in them (darker and glossy);
  - lighter dusty edges;
  - mottled, cloddy colour drifting along the trail, and a fine grit close to the eye;
  - damp patches;
  - pebbles (1.5–6 cm) and some bigger stones (5–15 cm), shaded with a lit top and a dark rim;
  - in the woods, leaf litter and roots crossing the trail every few metres in stretches;
  - grass tufts in the middle where the earth is narrowest.
- **Margin:** the plants grow into the mapped corridor (their cards have no collision) to 0.1–0.3 m past the worn
  earth's edge, by a second field (6–12 m).
  - They are graded: low tufts and short grass beside the track, rising to full height over the first 0.9 m.
  - About half the stems near the track lean over it, down the clearance's slope.
  - Short trodden grass runs under them from the earth's edge.
  - The shrubs (real bulk, 0.9 m and taller) keep out of the whole mapped corridor: `js/park-cover.js` keeps a second
    clearance field for them, so cycling isn't visually blocked.
- **Width:** the edge's raggedness changes over 10–20 m, with a ±3 cm break-up on top, so the near track doesn't
  pulse in width every few metres.
- **Cost:** one ribbon per trail, cut by a mask. The width fields are sums of sines, so the shader and the CPU agree
  without a texture.
- **Phone tier:** keeps the outline, the centre and the edges, without the stones, roots, ruts, puddles and damp.
- **Unchanged:** the paved paths, boardwalks, gravel (two short compacted segments) and steps.

### The shrubs

- **Where:** the lidar's layer gives 0.3, 1.1 or 2.2 shrubs per 4 m cell. The woods' understory adds 0.22 under closed
  canopy and 0.4 in the ravines, and the woods' edges add more. A few oak sprouts and sumac stand in the savanna's
  grass.
- **What:** sumac in the open, dogwood and serviceberry masses, saplings' bigger leaves in the woods. A big one, over
  2.4 m, is a clump of two or three smaller ones. The foliage has holes and a ragged edge, and is lighter inside, so it
  reads as leaves with light between them, not as a solid lump.
- **The woods' edges:** along the park's streets, the woods within 12 m of the island's edge grow 1.1 more shrubs a
  cell, a screen like the park's own edge plantings.
- **How they are drawn:** near, a rounded shrub of 14 leaf cards over a dome, lit by the dome's normals, casting
  shadows. Further out, three crossed cards. They dissolve between the two and out at the edge, as the trees do.

### Grenadier Pond's shore (`?shore=0`: as before)

The lawn within 14 m of the pond grows the meadow's tall grass and forbs and 0.9 shrubs a cell, down to the 2.5 m
margin. Procedural willows, a leaning trunk under a weeping crown of hanging strands, stand 3.5–7 m from the water
about every 16 m, off the paths, clear of the lidar's own crowns, and leaning over the water.

### The canopy (`js/ez-trees.js`; `?canopy=0` / `?treevary=0`: as before)

The park's trees' leaves take a deep summer green in place of the models' mint, on the meshes and on the impostors.
This applies on the park's islands only: the street trees round it, the Island's and the rest keep theirs. Each tree
is its own shade: a hash of where it stands moves its value (a few dark trees, most mid) and its hue between a yellower
and a bluer green. The hash is the same on its meshes and on its impostor, so the hand-over at 45 m keeps its colour
(`impostor-handover-check.mp4` in the evidence folder). The woods' lidar trees
stand a little less evenly:

- a stem up to 1.2 m off its crown's top, never onto a path;
- a lean of up to 4 degrees;
- 10% more spread in height.

## 3. Paying for it: the woods' impostors (`js/tree-impostors.js`, `?treeimp=0`: as before)

The woods' mid trees (decimated meshes, 30–134 m) were the largest single cost of the woods walk (6.0 ms of 20.6,
[perf-pass-coo](perf-pass-coo.md#follow-up-the-high-park-woods-walk-st-usbd-2026-11-05)). In the pilot the woods' trees now hand
over from the mid mesh to a baked, lit impostor at 45 m (40 m on the middle tier, 35 m on phones), and the impostor
replaces mrdoob's crown cards from there out:

- **The bake:** each broadleaf model is baked once at start-up, seen from 0, 30, 60 and 90 degrees, into an albedo
  atlas and a normal atlas (128 x 256 tiles; 2048 x 768).
- **The quad:** each impostor is one quad facing the viewer. It cross-fades between the two baked elevations nearest
  the view, and is lit by the scene's own lights with its baked normals turned to the view.
- **Seasons:** the leaves turn and fall on it as on the meshes.
- **From the air:** the higher views are a little darker, since a crown seen from above is all sunlit leaves on the
  impostor where the mesh shades itself, and each tree takes its own shade.
- **Hand-over:** the trees' screen-door dissolve hands over to it.

### The seasons (2026-11-06)

All of this was tuned at the summer preset, and the live game follows Toronto's date. On 6 November John saw the woods
past 45 m break into squares of autumn colour with sky between them. The impostors' per-leaf key had been floored to a
22 x 41 grid over the quad, about 0.7 m of crown a cell, so in autumn `leafStays` dropped, and `autumnLeaf` turned,
whole cells at once. The impostors were off for a day (#134). The fixes:

- **Impostors:** the key is now smooth two-octave value noise at about a leaf's size (96 x 192 over the frame), as the
  meshes' is. About a third of the fallen leaves' texels stay as the dead tan-brown leaves the oaks hold through
  winter, with the twigs. A 128 px bake can't hold the bare crown's twigs, so without them a winter woods was bare
  ground with trunks from the air.
- **Shrubs and willows:** they had stayed summer-green all year. Now they are deciduous like the trees (`autumnLeaf`,
  `leafStays`): they turn yellow, orange and red, fall leaf by leaf, and are bare brown thickets in winter.
- **Cost, and its trim (same day):** the season maths runs only off full summer, behind a uniform branch, with one
  octave of noise and the haze from a cheap hash. The impostors' hand-over to the mid mesh narrowed from 24 m to 6 m:
  they now match their tree, and the wide band had left many trees at once in a stippled half-dissolve.
  - Eglinton woods walk, ABAB×3 against the shipped fix: golden summer preset 57.5 → 60.4 fps; today's autumn
    54.4 → 55.8 fps.
- **The ground cover in autumn and winter:** from the season's uniforms alone, with no noise, the bluestem goes to
  straw and copper, the goldenrod to its grey-tan seed heads, the asters brown and the woods' herbs yellow.
- **Check:** `tools/shots/park-seasons.json` holds the woods and savanna views with no time preset, so a capture's
  `?liveClock=<ISO>&liveDate=<YYYY-MM-DD>` sets the season. Run it at summer (08-22), peak colour (10-18), autumn
  (11-06) and winter (01-20) before changing the park's trees or plants.

## 4. Cost

Measured on the M4 mini, shared, so treat these as relative evidence. Headed Chromium with vsync and the frame-rate
limit off, golden hour, clouds held still, at the uncapped woods walk (`tools/shots/park-cover-walk-fps.json`, the
perf pass's `u-high-park-walk`). A is main 4c0bbe7's build, B this branch, interleaved A B A B A B. The figures are
frames per 20 s.

| Eglinton map (`?map=eglinton`) | A (main) | B (pilot) | fps |
| --- | --- | --- | --- |
| Desktop high, 1600x900 | 1058 / 1059 / 1072 | 1197 / 1188 / 1186 | 53.2 -> 59.5 (+12%) |
| Desktop high, after the shrub and canopy revision (pq8) | 1073 / 1072 / 1071 | 1171 / 1171 / 1185 | 53.6 -> 58.8 (+10%) |
| Phone tier (`quality=low`, 412x915 at 2.625, `q.maxFps=0`) | 2685 / 2659 / 2662 | 2854 / 2900 / 2890 | 133.4 -> 144.1 (+8%) |

Where it goes, desktop, the same walk. These are knockouts in the pilot's build, two runs each, so they don't add up:

| Arm | fps | vs the pilot |
| --- | --- | --- |
| The pilot | 59.3 | |
| `?parkcover=0` (no grass, shrubs or willows) | 60.5 | the cover costs ~0.3 ms |
| `?parkcover=grass` (no shrubs) | 60.0 | the shrubs ~0.2 ms |
| `?parkcover=shrubs` (no grass) | 59.9 | the grass ~0.2 ms |
| `?treeimp=0` (the woods' mid meshes and crown cards as before) | 51.8 | the impostors save ~2.5 ms |
| `?treeimpmid=55` (the first cut's hand-over) | 58.2 | |

| Other measures | Before | After |
| --- | --- | --- |
| Triangles, woods walk, desktop | 9.41 M | 8.56 M |
| Triangles, woods walk, phone | 4.31 M | 4.11 M |
| Draw calls, woods walk, desktop | 833 | 855 |
| Start-up: the cover's maps and meshes (`parkCover`) | | ~250 ms |
| Start-up: the impostor bake | | 20–70 ms |
| Data, every visit (`js/high-park-cover-data.js`) | | 56 KB (19 KB gzip) |

Outside the pilot's box nothing is drawn or changed: the Island walk, Queen St W and Parkside Drive frames are
identical to main's (`controls-outside-pilot.jpg` in the evidence folder). The trees' canopy grade reads the woods'
ground cover, which is only non-zero on High Park's islands.

## 5. Limits

- One azimuth view per model: walking round an impostor it doesn't turn (each tree is mirrored at random so
  neighbours differ).
- The ground plants are cards, not blades: up close they read as clumps.
- No leaf litter detail beyond the floor's colour.
- The demo itself could not be benchmarked on the M4 mini: its live build never reached a first frame there, in any of
  three Chromium builds, headed or headless (st-annt.1).
