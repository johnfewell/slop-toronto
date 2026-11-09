# High Park Zoo: the animals

The High Park Animal Display's animals in the zoo's paddocks along Deer Pen Road (`js/high-park-features.js`,
bead `st-0w0g`; the paddocks themselves are in [High Park's features](high-park-features.md)). Low-poly models from
[Poly Pizza](https://poly.pizza), fetched as the camera nears the zoo, with simple procedural boxes standing in until
they arrive.

## The species

The City's page for the display ([High Park Animal Display](https://www.toronto.ca/explore-enjoy/parks-recreation/places-spaces/zoos-farms/high-park-animal-display/),
last modified 2026-10-13) lists Barbary sheep, bison, capybaras, emus, llamas, mouflon sheep, peacocks (peafowl),
reindeer, West Highland cattle and yaks. The Friends of High Park Zoo's
[Meet the Animals](https://www.highparkzoo.ca/visit-the-zoo/meet-the-animals) lists the same less the reindeer. No
current source lists wallabies. Both pages say the display closed on 13 October 2026 for the Deer Pen Road works and
the Master Plan's second phase, reopening in spring 2027; the game shows the animals as on an ordinary day.

| Species | Animals | Shoulder height | Model (Poly Pizza) | Author | Licence |
| --- | --- | --- | --- | --- | --- |
| Bison | 4 | 1.7 m | [Bison](https://poly.pizza/m/9sTrha-TxdS) | Poly by Google | CC BY 3.0 |
| Yak | 3 | 1.45 m | [Bull](https://poly.pizza/m/a8PIIYwF7r), recoloured, horns lengthened | Quaternius | CC0 1.0 |
| West Highland cattle | 3 | 1.2 m | [Cow](https://poly.pizza/m/26zM1outCr), recoloured ginger, horns lengthened | Quaternius | CC0 1.0 |
| Llama | 4 | 1.1 m | [Llama](https://poly.pizza/m/5XUgcfxfBWJ) | Poly by Google | CC BY 3.0 |
| Reindeer | 3 | 1.1 m | [Stag](https://poly.pizza/m/tQdzbZ1Cmw), recoloured | Quaternius | CC0 1.0 |
| Mouflon | 2 | 0.72 m | [Ram](https://poly.pizza/m/fm86jjk4m7D) | Poly by Google | CC BY 3.0 |
| Barbary sheep | 2 | 0.9 m | [Bighorn sheep](https://poly.pizza/m/4kUChlMv8Vp), recoloured sandy | Poly by Google | CC BY 3.0 |
| Capybara | 3 | 0.5 m | [Capybara](https://poly.pizza/m/66d-mKAgF17) | Poly by Google | CC BY 3.0 |
| Emu | 2 | 1.7 m standing | [Emu](https://poly.pizza/m/dVhJSddeK67) | Poly by Google | CC BY 3.0 |
| Peafowl | 3 | 0.95 m standing | [Pheasant](https://poly.pizza/m/1wqLCnNFCgv), recoloured as a peacock, its tail lowered | Poly by Google | CC BY 3.0 |

Poly Pizza has no yak, Highland cow or peafowl. Those three, the reindeer and the Barbary sheep are near relatives
recoloured (`RECOLOUR` in the build). The credits are in [CREDITS.md](../CREDITS.md) (each model's title, author,
page, licence and what was changed) and, in short, in the home page's colophon.

## The models

`node tools/build-zoo-animals.mjs` writes `assets/zoo/<species>.glb` from the raw downloads, Poly Pizza's GLB of each
model page saved as `~/.cache/slop-toronto/zoo/downloads/models/<id>/model.glb` (`--raw` elsewhere). Each download's
SHA-256 is pinned; a changed file stops the build until its model and licence are reviewed again. For each model it:

- poses it at rest (the Quaternius models are skinned: their bind matrices) and flattens it to triangles;
- gives each triangle one colour: its texture's mean over the triangle (seven samples) or its material's colour, linear;
- faces it to +z, centres it on its feet and scales it to the species' shoulder height, measured as the highest point
  of the back over a stretch of its length (the birds: the head);
- recolours the near relatives, lowers the pheasant's tail and lengthens the cattle's horns;
- writes position, flat normal and colour only (no UVs, textures, skins or animations), welded and meshopt-compressed.

`--review <dir>` also writes a side and three-quarter software render of each, with the shoulder height marked.

The ten files are 455.6 KB together, 16-95 KB each (reindeer the largest), 548-3,667 triangles; 48.5 k triangles for
the 29 animals.

## In the game

`animals()` places the herds as before: each species in its own stretch along the enclosure's long axis, in spots
clear of the paths and fences, at a hashed angle. The boxes (`beast()`, about 50-110 triangles) are built at load as
the stand-ins. The models (`zooModels()`):

- **Trigger:** the camera within 500 m of the enclosure (`ZOO_NEAR`, the distance from the camera to the enclosure's
  box, height included, so a fly-over fetches them too). Checked each frame from the main loop after the warm-up.
- **Load:** all ten files at once through the props' `GLTFLoader` with the meshopt decoder. The attributes are turned
  back into floats. The models draw with the animals' own material (one for all ten, see Idle life below); with
  `?zooanim=0` they draw with the boxes' material and pipelines.
- **Warm:** each species' `InstancedMesh` (the boxes' instance matrices) is added hidden, two a frame, with `count = 0`
  and frustum culling off, so every pass (the view and both shadow cascades) builds its render objects and uploads its
  buffers before anything is drawn.
- **Swap:** two frames after the last, on a frame that builds nothing: the counts set, frustum culling back on, the
  boxes hidden.
- **Failure:** a species whose file fails keeps its boxes; if all fail, the boxes stay.
- **Never unloaded.** Past 900 m (`ZOO_FAR`) the models are not drawn.

`?zoo=0`: no animals. `?zoo=boxes`: the boxes only, nothing fetched. `?zoo=models`: the models (the default on every
tier). `CITY.highParkZoo` reports the state and a timeline (`events`: fetch, load, warm, swap, with the frame number).

## Idle life (st-gtnq)

The models have no skeletons. The animals move in the vertex shader instead, from weights baked into each model.

### The rig (`tools/zoo/rig.mjs`, baked by `tools/build-zoo-animals.mjs`)

Each vertex carries `_ZOOA` = (neck, head, tail, leg or ear code and weight), and the node's extras carry the hinges
(`userData.zooRig`). Everything is in the fitted model's space: facing +z, x to its left, on its feet at the origin.

- **Legs:** found from the feet. Each hoof cluster's axis runs up to the belly (a quadruped's lowest point between its
  front and back legs; a bird's body's lowest point off its legs). A vertex below the belly near an axis belongs to that
  leg. Its weight ramps from 0 just above the belly to 1 a fifth of the belly's height below it, so the thigh bends
  into the body instead of tearing. Codes: 1 front left, 2 front right, 3 back left, 4 back right. A bird's two legs are
  3 and 4. Each pair swings about a pivot in the body, straight over its hooves.
- **Neck and head:** a ramp along a direction from a hinge, set per species by eye on the review renders (`RIGS`). The
  three Quaternius models (yak, Highland cow, reindeer) use their skins' joint chains instead (Neck1 0.3, Neck2 0.62,
  Neck3 0.88, Head 1). The llama, emu and peafowl also have a head hinge, so the head stays level as the neck bends.
- **Tail:** the Quaternius models use their Tail joints. The others use a ramp from the root, limited to vertices that
  stand off the rump. The peafowl's train sways about the vertical.
- **Ears:** a box per species, where the ears separate cleanly (llama, mouflon, capybara). The other species have none.
- **Shells:** separate pieces (horns, antlers, ears, beaks) bend with the body at their root.
- **The graze pose:** angles per species: neck down, head back up, and the body pitched forward about the hips. For the
  birds that is their tip; for the grazers (bison, yak, Highland cattle, reindeer, mouflon, Barbary sheep) it is a
  shoulder drop of 5-9 degrees, the front legs bending at the top. The neck is then stretched down by up to 0.22-0.27 m,
  so a grazer's muzzle reaches the grass (1.5 cm). The llama's and capybara's stop about 6 cm above it. The peafowl's
  peck lands about 0.42 m ahead of its feet.

`node tools/zoo/rig-review.mjs <out.png>` renders each species: its weights (side and back), at rest, grazing, looking
round, and a walk cycle's quarters. It uses `pose()`, the shader's twin on the CPU.

### The shader (`zooAnimMaterial` in `js/high-park-features.js`)

One `MeshStandardNodeMaterial` serves all ten species. Its `positionNode` bends each vertex in its rest space, then adds
the offset, turned by the instance's yaw, to the instanced position. It rotates the normals the same way. The species'
hinges come from per-object uniforms (`onObjectUpdate`, from `userData.zooU`). Each instance has `zooS0` (graze share,
neck turn, stride metres, swing 0-1) and `zooS1` (seed, yaw).

The steps, in order:
1. breathing (the torso swells 1.2 % across);
2. ear flicks, now and then;
3. the legs' swing: a walk with each foot down for 0.65 of the cycle, the legs a quarter cycle apart in a lateral
   sequence (a bird's two half a cycle apart). In the stance the hoof goes back along the ground at an even speed,
   then lifts and swings forward;
4. the tail's swish, in gusts;
5. the head about the poll, then the neck about its base (down, then turned) and its reach;
6. a bird's body pitch;
7. the walk's bob.

`castShadowPositionNode` is the same bend without the normals, so the shadows follow the poses.

### The herd (`zooHerdSim`)

A deterministic timeline of acts for the 29 animals:
- graze (head down and nibbling, lifted every 7-12 s), or peck for the birds;
- stand;
- look round (head up, turned to a new bearing every few seconds; the llamas' favourite);
- rest (the capybaras, which barely move);
- turn on the spot (eased, with a few steps);
- walk (rare and slow).

Every act starts and ends in the neutral pose, so nothing jumps between them. Each act is drawn from the animal's own
seeded stream, in time order. The poses are functions of the sim time, so the same seed gives the same herd however the
frames fall.

A walk goes 2-7 m to a spot in the species' own stretch of the enclosure. It is checked every 10 cm with a 15 cm margin:
in the paddock, 3 m off the paths, 2 m off the post-and-rail fences and 2 m onto the park's islands (off Deer Pen Road).
It must also keep every other animal's place or reserved path at least the two clearances away (0.42 x body length +
0.25 m each).

The speed rises over 1.6 s to 0.25-0.6 m/s (by species), holds, and falls again. The legs' cycle advances with the
"stride distance", the integral of max(v, v_max / 2), and the swing scales with v / (v_max / 2) below half speed. So at
any speed a hoof on the ground goes back exactly as fast as the body goes forward. Only the starts and stops, as the
swing grows and dies away, settle the feet a few centimetres.

The step runs from the main loop while the models are in, nearer than 900 m and the enclosure is in the camera's
frustum. Otherwise the sim clock stands still and nothing is written. `CITY.highParkZoo.anim` exposes the clock, the
sim, `setEnabled()` (the reviews' A/B) and the step's time. `?zooanim=0` keeps the static material and never steps;
`?zooSeed=` changes the herd.

## Verification

`tests/high-park-zoo.test.mjs`: every species placed as boxes at load, 2 m clear of the street; nothing fetched at 520 m and the fetch at
480 m; after the warm-up frames one model mesh per species with the boxes' instances and material, float attributes,
the boxes hidden; not drawn past 900 m and drawn again nearer; a failed file keeps its species' boxes, all failed keep
all; `?zoo=boxes` and `?zoo=0`; each file under 300 KB (all under 2 MB), one mesh of position, normal and colour, no
textures, on the ground, as tall as the species, centred, and its page, author and licence in CREDITS.md.

Captures on the Mac mini (`tools/zoo/make-shots.mjs` writes the shot lists; the runs are in `tools/zoo/mini-runs.sh`):

- **The look** (`tools/shots/zoo-animals.json`, desktop `?quality=high`): a close view of one animal of each species at
  golden hour and midday, the enclosure along its length and from the air; `?zoo=boxes` the same for comparison.
- **The seasons** (`tools/shots/zoo-seasons.json` with `?liveClock=&liveDate=&liveWeather=Sunny`): 2026-11-08 at midday
  and golden hour (the day itself: autumn), 2026-07-15 and 2026-01-15 (`liveSnow=8`) at midday. The animals take the
  light and cast their shadows in every season; they are not snowed on.
- **The approach** (`tools/shots/zoo-approach.json`, `zoo-approach-timing.json` with `CAPTURE_UNCAPPED=1`): the camera
  comes down on the south paddocks from 640 m, each frame's time logged with the zoo's events. Capped (with the
  screencast): 2,626 frames, none over 16.8 ms; fetched at frame 1101, loaded 1103, warmed 1103-1107, swapped 1109.
  Uncapped: 4,487 frames, median 10.1 ms, p95 12.8, p99 16.3, max 40.6 (ten seconds before the fetch); the warm-up
  frames 6-10 ms and the swap frame 8 ms; one 26 ms frame (then a 1 ms one) as the ten files are parsed, 63 ms before
  the swap, inside the run's own spread (12 frames over 25 ms elsewhere in it).
- **The swap close up** (`tools/shots/zoo-swap-walk.json` with `?zooNear=15`): a walk in on a peafowl; at 500 m the
  swap is too far off to see, by design.
- **The cost** (`tools/shots/zoo-ab.json`, `CAPTURE_UNCAPPED=1 CAPTURE_METRICS_MS=8000`): boxes and models alternated in
  one page (A B A B A B, each arm checking what it drew), the enclosure seen along its length from 30 m up (the herds
  mostly under the canopy, but drawn: the view and the shadow cascades). Same draw count (one per species either way).

| Tier | Arm | Frame interval median (ms) | Render submission CPU median (ms) | Triangles a frame |
| --- | --- | --- | --- | --- |
| Desktop, high | boxes | 16.7 / 16.9 / 17.0 | 15.3 / 15.6 / 15.9 | 5.697 M |
| Desktop, high | models | 16.8 / 17.2 / 17.0 | 15.7 / 15.9 / 15.5 | 5.811 M (+115 k) |
| Phone (412 x 915, 4x CPU throttle), low | boxes | 40.9 / 37.7 / 37.8 | 13.5 / 13.1 / 12.9 | 2.918 M |
| Phone (412 x 915, 4x CPU throttle), low | models | 38.2 / 39.1 / 37.8 | 13.3 / 13.2 / 13.0 | 3.000 M (+82 k) |

The differences are inside the pairs' spread on both tiers, so the phones get the models too (the default on every
tier); `?zoo=boxes` keeps the boxes. A shared mini's numbers are relative evidence, not budgets.

### The idle life (st-gtnq)

`tests/high-park-zoo-life.test.mjs`:
- **Ground:** half an hour of the herd, stepped by irregular frames. Every animal stays on its own ground at every
  quarter second (in its species' stretch, in the paddock, off the paths and fences, 2 m onto the islands), and no
  closer to another than the two clearances (or than they started). They do wander, the capybaras least.
- **Determinism:** the same seed gives the same herd for any frame times, and another seed gives another.
- **Smoothness:** the poses change smoothly at 100 Hz, with no jumps between acts.
- **Feet:** in a walk (the CPU twin `pose()`) a hoof on the ground slides less than 3 % of the body's way at walking
  pace. Starts and stops settle each foot by less than 1.5 strides' excursion, and no toe dips more than 3 cm into the
  ground.
- **Grazing:** fully grazed (and at the nibble's deepest), every grazer's muzzle is within 3 cm of the ground, and the
  peafowl's beak pecks well ahead of its feet.

The captures on the Mac mini are `tools/shots/zoo-anim-*.json` (`node tools/zoo/make-anim-shots.mjs`):
- **Videos** (`zoo-anim-videos.json` with `?liveDate=2026-11-08&liveClock=2026-11-08T17:00:00Z`, and
  `zoo-anim-summer.json` on 2026-07-15) of each species' characteristic act. For each shot, the herd's own timeline is
  looked ahead and its clock moved on to just before that act: the bison grazing, a llama looking round, the birds
  pecking, a capybara at rest, and a large animal and an emu walking, side-on.
- **Stills** (`zoo-anim-stills.json`, a low November sun): an animal grazing with the clock held, and the same frame
  with the bend off. The shadow follows the pose.
- **The cost** (`zoo-anim-ab.json`, `CAPTURE_UNCAPPED=1 CAPTURE_METRICS_MS=8000`): the enclosure from 30 m up, as
  above, with the bend and the step off (the static material, `?zooanim=0`'s path) and on, alternated in one page.

| Tier | Arm | Frame interval median (ms) | Render submission CPU median (ms) | Herd step (ms a frame) |
| --- | --- | --- | --- | --- |
| Desktop, high | frozen | 17.1 / 17.4 / 17.7 | 15.9 / 16.3 / 16.4 | - |
| Desktop, high | animated | 17.6 / 17.5 / 17.6 | 16.1 / 16.4 / 16.5 | 0.018-0.022 |
| Phone (412 x 915, 4x CPU throttle), low, run 1 | frozen | 38.9 / 37.8 / 37.9 | 13.4 / 13.1 / 12.9 | - |
| Phone (412 x 915, 4x CPU throttle), low, run 1 | animated | 38.2 / 38.8 / 40.3 | 13.3 / 13.2 / 14.1 | 0.055-0.087 |
| Phone (412 x 915, 4x CPU throttle), low, run 2 | frozen | 38.7 / 38.0 / 37.5 | 13.5 / 13.0 / 13.1 | - |
| Phone (412 x 915, 4x CPU throttle), low, run 2 | animated | 38.4 / 38.6 / 37.9 | 13.5 / 13.4 / 13.1 | 0.071-0.114 |

The simulation CPU median is the same in both arms (1.3 ms desktop, 2.2-2.5 ms phone). The herd's step costs 0.02 ms a
frame on the desktop and about 0.1 ms on the throttled phone. Run 1's third phone pair (+1.2 ms render) did not recur in
run 2. The bend's GPU work (about 50 k vertices) is inside the
pairs' spread on both tiers, so the phones get the animation too.

## Open questions

- **The yak and the Highland cattle** are Quaternius' bull and cow recoloured, with lengthened horns: no shaggy coat,
  no yak's skirt or hump. Poly Pizza has neither species. Candidates for the paid pipeline if John approves.
- **The peafowl** is Poly's ring-necked pheasant recoloured, its tail lowered as a folded train: no crest, no fan, and
  every bird a peacock (no peahens). Poly Pizza has no peafowl.
- **Placement:** the enclosure's OpenStreetMap outline takes in Deer Pen Road, and the boxes stood on its asphalt. The
  spots now keep 2 m onto the park's islands (off the street). Otherwise the placement is as before: the bands, hashes
  and spacing (two yaks stand 4 m apart).
- **The display is closed** until spring 2027 for the Deer Pen Road works. The game shows the animals as on an open day
  (and the capybaras out in winter).
- **Credits:** CREDITS.md and the home page's colophon. The city's help panel links to them ("All credits") but names
  none itself.
