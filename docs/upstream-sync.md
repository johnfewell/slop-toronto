# Slop New York integration — 2026-10-26

Reviewed all 74 commits on `mrdoob/slop-newyork` after our shared ancestor `0049a497`, through
[`2018076`](https://github.com/mrdoob/slop-newyork/commit/2018076). Toronto already carried manual ports of many
of these changes. This integration brings in the remaining applicable improvements while preserving its city,
transit, signals, quality tiers and custom powertrain.

This is a selective port, not a wholesale merge of New York's files. The source revision is a review checkpoint;
it does not mean every upstream change has been applied verbatim.

## Imported in this integration

| Improvement | Upstream commits | Toronto adaptation |
| --- | --- | --- |
| Mass-based, clipped-face vehicle impulses; continuous collision sweeps; persistent impact momentum and traffic chain reactions | `12dbb1d` | New classic-script `vehicle-physics.js`; retain deck-height separation, the 1,800 kg player car, crash damage, TTC routes and City signals. Snapshot player positions before each frame's movement. |
| Pedestrian anticipation, escape running, sidewalk dives and recovery | `8fbd89a`, `8492b56` | Keep the existing inline pedestrian system and ragdolls. Use Toronto's midblock crossing permissions as well as junction crossings; check deck heights, sidewalk clearance and other people before an escape. |
| Correct player brake and reverse lamps | `21f6dde` | Keep the custom handbrake's brake lights. Clear lamps when leaving or teleporting the car; prevent reverse state from selecting a police livery. |
| Struck traffic honks; fewer police cars | `febb87e`, `7540282` | Horns originate at the vehicle's actual deck height, with a shared contact cooldown; retain Toronto liveries. |
| Engine shift envelopes, softer tire/wind noise, heavier crash synthesis and sharper bicycle drivetrain clicks | `8f864af`, `2ff7cc6`, `b8ca665`, `09ee62d`, `2018076` | Keep streetcars, lake/gulls, synthesis workers, quality budgets, player skid squeal and physical engine RPM. The player engine does not get a second simulated gearbox. |
| Shared vehicle window masks and helicopter glass properties; simpler airfoil geometry | `16b5ae7`, `c74bed0` | Keep Ontario plates and Toronto paint/liveries. |
| Fire escape proxy geometry matches detailed stairs; filtered railings and grating | `596fdc4`, `dcf9dcc` | Share the existing `filteredPulse` shader. Use coverage with MSAA and a binary mask on phone FXAA tiers. |
| Spatially chunked procedural trees, stable canopy shape between LODs, simpler geometry and building clearance | `539289a`, `ae7c9a8`, `565a6c4`, `9b48bc0` | Applies to `?trees=slop` and the failed-EZ-Tree fallback. Pass Toronto's building/bridge colliders. The default EZ-Tree models stay in place. |

Small associated cleanups from these files are included where they remove duplicated calculations or unused state.

## Already present or covered by Toronto's implementation

Gamepads; player-state persistence; spatial audio and street acoustics; balanced traffic types and population
replenishment; connected pedestrian routes and conversations; vehicle bumpers/lights; initial fire escapes;
road markings through bends; building contact geometry; coasting resistance; SSR filtering; static batch culling;
the WebGL instancing fix; and skipping static world-matrix walks were already ported or separately implemented.

Toronto's six-speed powertrain, tire slip, Space handbrake, boost input, suspension and ragdolls already provide
the corresponding driving behavior. They are retained instead of replacing them with upstream's different
steering/acceleration model (`afe3170`, `9ee80eb`, `6ae28ae`, `398f9c9`, `cc6d707`). Toronto already handles the
near-zero direction-change case in its powertrain.

## Intentionally left out

- Manhattan roads, northern street coverage, Broadway plazas, Manhattan signals and Oasis camera placement.
- The native ES-module conversion and extraction of the pedestrian simulation. Toronto's additional systems use
  the classic ordered loader and `window.CITY`; moving all of them would be a separate architectural migration.
- New York page/UI changes and unused New York map/geodata changes. Toronto has its own landing page, explorer,
  map, routes and data pipeline.
- Geometry reductions for New York's globe lamps/cantilevered signals, and shaders for water towers and cast-iron
  park fences: those objects/materials have been replaced or removed in Toronto.
- Removal of upstream-only generation helpers or low-rise building code. Toronto's data and building generation
  differ, so the upstream deletion is not evidence that Toronto's code is unused.

## Validation

- At the time of this sync, the baseline suite had 124 tests: 111 passed and 13 failed before any edits. The failures
  involved stale New York / Abuja fixtures, the geodata test's unavailable raw input files, Overpass whitespace
  expectations, a smoke-texture test for a removed function, and an outdated camera fixture. Those failures have
  since been fixed: main's suite is fully green (at 35e8e84, 281 tests: 280 pass, 0 fail, 1 opt-in skip), so any
  failure now is a regression or a recorded bug.
- After integration: 158 tests, 145 passed, the same 13 baseline failures; no new failures. The 34 added cases cover
  upstream contact physics plus Toronto deck separation/damage, avoidance at midblock crossings, finite real-rig
  dive poses/recovery, player lamps, hidden dive rendering and crash-horn gating.
- `node tools/build-site.mjs` succeeds and includes `vehicle-physics.js`; `git diff --check` passes.
- Repeat the targeted suite with:

  ```sh
  node --test tests/boot.test.cjs tests/controllers.test.cjs tests/traffic.test.cjs tests/traffic-performance.test.cjs tests/vehicle-physics.test.cjs tests/pedestrian-avoidance.test.cjs tests/audio-collisions.test.cjs tests/vehicle-lights.test.cjs
  ```

- Visual checks passed on the Mac mini's Metal WebGPU renderer with `tools/shots/upstream-sync.json`: high quality
  at 1600×900, then low quality at a 412×915 touch viewport with `?trees=slop`. Both runs reached ready and captured
  cycling, driving by day/night, walking and flight without page exceptions or shader errors. The static server's
  expected `/live/vehicles` 404s exercised timetable fallback. The first run exposed a missing fire-escape helper
  import; this was fixed before the successful runs. Output names: `slop-toronto-upstream` and
  `slop-toronto-upstream-low` under the shared geo repository's `review/gpu2/`.
- These are smoke captures, not proof of every collision or avoidance animation; the targeted tests cover those
  behaviors. Contended GPU captures are visual correctness evidence only, not performance measurements.

# Tree LOD cells and road-marking cells — 2026-10-29

Ported from [`e35c06c`](https://github.com/mrdoob/slop-newyork/commit/e35c06c) (cell-hierarchical tree LOD updates)
and [`997185d`](https://github.com/mrdoob/slop-newyork/commit/997185d) (chunked, culled road markings), part of
st-wt0.19 (bead st-bav). Both are performance changes that must not change what is drawn.

| Improvement | Upstream commits | Toronto adaptation |
| --- | --- | --- |
| Tree levels resolved a whole cell at a time; only the cells straddling a level edge evaluate their trees | `e35c06c` | `trees.js` (`?trees=slop` and the fallback when the EZ-Tree models don't load) takes upstream's change, **but keeps its `scene.onBeforeRender` hook**: upstream moved the update call into its street-details update, and here nothing else would drive the fallback field. The default `ez-trees.js` gets the same technique, rewritten for its hand-over bands: 200 m cells, the bands' edges per tree class (tier × pine, street level or aloft), and a cell between two edges takes one level set per class. Its regrouping skips cells with nothing drawn and no longer allocates per instance. |
| Road markings in cells, the far ones culled; the wear noise and puddle field skipped by branch when unused | `997185d` | `road-paint.js` cuts all of Toronto's paint into 1.2 km cells: the street lines, Lake Shore's and the Gardiner's lanes on their decks, junction and midblock crossings, PXO shark's teeth, and the bikeways (lanes, crossrides, sharrows and symbols, which cycling.js used to put in meshes of their own). The paint's cells go beyond 1,650 m × the tier's cull factor, where the material has faded it out (from 79% of that). The trails' asphalt surfaces (the Martin Goodman Trail's red) are 2.4 km cells of their own, never distance culled, and drawn first as before. `scene-culling.js` culls plain meshes with `userData.cullDistance`; `cullFixed` keeps the quality net from moving the cut away from the fade. |

Left out: upstream's shore-highway builder (`city-grid.js`), since Toronto's expressways are painted from the road
network like every other street, and its explicit `treeField.update()` call (see above). The material keeps
Toronto's trail surfaces, and keeps the film from `roadWetMasks` instead of restating it.

## Validation

- `npm test`: 287 tests, 286 pass, 1 opt-in skip. New: `tests/tree-lod.test.mjs` (the EZ-Tree field against the
  per-tree rules it replaced, instance for instance, on all three tiers; the fallback field updating through the
  scene hook, chaining the previous hook and ignoring the shadow cameras) and `tests/road-paint-cells.test.mjs` (cell
  bounds, cull flags, draw order, culling with the quality net engaged).
- `node tools/benchmark-tree-lod.mjs <ez-trees.js of 35e8e84>` checks that both revisions draw identical instances at
  579 camera positions on the three tiers (also with `?lodfade=0`, `?treeshadow=320` and `?pinefar=200`), then times
  them. CPU, M5 Pro, 57,120 street trees + 33,320 stand-in park and yard trees, ms per `update()` including regrouping:
  walking Spadina 1.91 → 0.31, driving Lake Shore 0.86 → 0.06, cycling through High Park 1.94 → 0.38, flying over
  downtown 1.74 → 0.38. The fallback `trees.js` on the same trees: 0.53 → 0.19, 0.29 → 0.03, 0.66 → 0.25,
  0.45 → 0.23. Desk figures, not frame times.
- The road paint: a point-sampled comparison of the old and new `road-paint.js` over a synthetic network covering every
  path (80,000 points) found the same paint at every point.
- Captures on the Mac mini (`tools/shots/upstream-cull.json`: street level and aerial at High Park, Spadina & Richmond
  and the Exhibition / Lake Shore, and a 750 m view over downtown), the built site before (35e8e84) and after, high
  tier at 1600×900 and low tier at a 412×915 touch viewport. Output tags `base-high`, `new-high`, `base-low2`,
  `new-low2` under `review/gpu2/merge-captain-rinks/` in the shared geo repository. The frames match apart from
  traffic and pedestrians. Drawn tree instances were identical before and after at every spot on both tiers.
  Road-paint draws went from 2–9 to 5–19 on the high tier and from 2–8 to 3–9 on the low tier, while drawn paint
  triangles fell from 42k–153k to 4k–39k. Sampled whole-frame draw calls moved by −1 to +15, inside traffic noise.
  These captures ran contended (transcription and other agents), so they are functional evidence only.

# Slop New York port — 2026-10-29: pole shadow stand-ins, pedestrian shading and character culling

One of the parallel ports of the 2026-10-29 borrow assessment (st-wt0.19, UP-1), bead `st-zqz`.

| Improvement | Upstream commits | Toronto adaptation |
| --- | --- | --- |
| Opt-in coarse shadow stand-ins (`userData.shadowStandIn`: `true` or a coarser geometry) | [`c4ab18f`](https://github.com/mrdoob/slop-newyork/commit/c4ab18f) (the opt-in), [`0630114`](https://github.com/mrdoob/slop-newyork/commit/0630114) (coarser geometry, the lamp-post stand-in) | Upstream had no opt-in yet at Toronto's checkpoint, so both parts are taken. New: an opted-in chunk whose cull distance is shorter than the shadows' reach (820 m x the tier's `shadowFar`) keeps casting by itself, so a stand-in never outlives its prop (UP-2). The reach is the cascades' far plane (720 m x the quality net's `Q.dist`) plus a 100 m golden-hour shadow, both x the tier's `shadowFar`, and the guard holds down to the net's lowest distance scale (`Q.minDist`, quality.js), since the stand-ins are chosen once and `Q.dist` drops at runtime (st-a5m). With the net on (the default), the low and medium tiers' pedestrian-signal poles (culled at about 410–460 m on low) no longer qualify at its 0.5 rung and cast with their own geometry; with `?autoscale=0` nothing changes. `?standins=0` turns the opt-ins off for A/B captures. |
| Thin poles cast through a 16- (NY) / 8-triangle (Toronto) stand-in | `0630114` | Applied to Toronto's own poles instead of NY's fluted lamp posts: the mapped and procedural street poles of `street-details.js` (28,640, a 10-sided capped cylinder of 40 triangles) and the pedestrian-signal poles of `pedestrian-signals.js` (1,908, 8-sided, 32 triangles) cast through an open 4-sided shaft of 8 triangles. Its circumradius is 1.11 so the shadow's width matches the cylinder's on average (0.79–1.11 of it as the sun goes round: 2–4 cm on a 20 cm pole). The pedestrian-signal poles were drawn whole into both cascades every frame: they now form their own culling root (chunked and distance culled like the street poles); the heads, lenses and lamps stay out, because their materials read per-instance attributes by instance index, which chunks would renumber. |
| Per-body-part pedestrian shading; far LOD shaded in the vertex stage | [`1fe128d`](https://github.com/mrdoob/slop-newyork/commit/1fe128d) (`pedestrians.js`) | Material section taken as is (Toronto's material was identical apart from its seven-tone skin palette, which is kept). |
| Crowd LODs: no far-LOD shadows, a single LOD for the player and rider, empty LODs hidden after the warm-up | `1fe128d` (`pedestrians.js`) | Taken as is. The first two updates keep a degenerate person drawn, so the warm-up frame still compiles both LODs' pipelines (main.js). |
| Rig micro-optimisations | `1fe128d` (`pedestrians.js`) | Toronto's `PersonRig` predates upstream's gait rewrite (`13dd142`, not taken), so only the matching spots: the lag factors `1 - e^(-dt/τ)` computed once per frame (bit-identical) and hypot-free distance tests. |
| Inactive characters: no IK beyond 320 m, a still parked rider posed once | `1fe128d` (`controllers.js`, `main.js`) | Unlike upstream, `poseCharacters` never forces the player's root visible (transit-riding.js hides it during a ride); it only shows the helmet it hid. |

Left out: the `pedestrian-system.js` part of `1fe128d` (Toronto's crowd is inline in `traffic.js`): the hidden-ped
gait skip in `renderPed` is ported separately (agent A), and the curb/meeting micro-optimisations are left for a
later `traffic.js` port to avoid colliding with the parallel detour and WALK-delay ports. Signal heads (180
triangles), lamp heads and arms were not given stand-ins: their computed cull distances (300–740 m) fall inside the
shadows' reach, so the guard above keeps them casting themselves. The GLB street props (hydrants, bins, shelters)
are culled at 80–260 m and so cannot use the shared stand-ins either; they did not show among the larger shadow
costs at street level.

## Validation (2026-10-29)

- `npm test`: 290 tests, 289 pass, 1 opt-in skip (main had 281: 280 + 1 skip). New: `tests/shadow-stand-ins.test.mjs`
  (3: opted-in poles cast through 8-triangle stand-ins at their own transforms, on the shadow layer only; a chunk culled
  within the shadows' reach keeps its own shadow on the high and low tiers; street-details.js opts its poles in) and
  `tests/pedestrian-crowd.test.mjs` (6, upstream's tests on the classic-script loader: LODs and far-LOD shadows,
  warm-up then hidden empty LODs with no uploads, one body part per triangle, vertex-stage palette and branch-free far
  LOD, exact varying interpolation of the near LOD including Toronto's skin palette, and `poseCharacters` culling
  that never re-shows the player root).
- Shadow-pass triangles per cascade pass, measured on the Mac mini (`tools/shots/pole-shadows.json`; the `tally` shots
  wrap the WebGPU backend's draw and attribute each draw to the shadow cascade cameras or the view; 40 frames;
  `review/gpu2/claude-patios/{before,after}-{high,low}-*`). Street level, golden hour for the pole-lined streets,
  midday for the crowds:

  | Spot | High, near / far cascade | Low (412×915), near / far cascade |
  | --- | --- | --- |
  | University Ave | 1,340,865 / 1,423,796 → 1,210,504 / 1,261,427 | 662,026 / 673,286 → 575,366 / 577,970 |
  | Queen St W | 1,126,044 / 1,194,851 → 931,779 / 972,474 | 619,656 / 628,047 → 511,352 / 519,743 |
  | King & Spadina | 1,042,317 / 1,167,344 → 869,021 / 937,232 | 462,944 / 492,673 → 377,487 / 391,096 |
  | Queens Quay | 1,068,672 / 1,210,269 → 923,981 / 1,024,442 | 551,108 / 567,838 → 471,472 / 481,666 |

  That is 10–20% fewer shadow triangles per pass on both tiers. The poles' share went from 111–156k (high) and
  85–100k (low) per pass to 4–15k: the street poles were 50–95k and the pedestrian-signal poles a constant 61k. The
  far crowd LOD's 8–70k shadow triangles per pass are gone, and empty crowd LODs no longer draw a degenerate
  person: people cost 1–2 view draws and 2–4 shadow draws a frame instead of 4 and 6–8. City-wide, the
  stand-ins hold 229k triangles for the street poles (28,640 × 8) instead of the 1.15M their chunks cast with before.
  The crowds differ a little between runs (the simulation is wall-clock timed), so the people rows are indicative.
- CPU desk benchmark (node, Apple M-series laptop, not a frame-time budget): `PersonRig` for 340 rigs with 68 posed, a
  paired A/B of origin/main's and this branch's `pedestrians.js` over 12 alternating runs, median 1.34 → 1.19
  ms/frame (−11%), poses equal to 2e-12. `node tools/benchmark-pedestrians.mjs vendor/three/three.core.js` still
  verifies the deferred-pose behaviour (1.92 → 1.19 ms/frame against always solving).
- Pole shadows framed close up (`tools/shots/pole-shadow-closeups.json`: the street-light pole nearest each spot, the
  camera beside its shadow from the live sun direction, street trees moved to an unused layer so none stands in
  between), Queen St W, Queens Quay and Palmerston at golden hour and midday and University Ave at midday, each with
  `?standins=0` against the default on the same build: `cu-{high,low}-{off,on}-pole-*`. The shaft, arm and luminaire
  shadows match on both tiers. Pixel differences above 15/255 were 0–2.9% of the frame (low) and 0.06–5.7% (high),
  all traffic, the multiplayer status pill shifting the top bar, and antialiasing noise, none on a pole's shadow.
- Contended Mac mini captures, so visual and functional evidence only, not performance. No page errors in either arm
  (both arms log the same audio synthesis worker warning).
- Merged after the tree LOD and road-marking cells (st-bav): `RoadMarkings` joins `PedestrianSignalPoles` among the
  culling roots. The stand-in guard reads the cull distances of the paint's cells as well as the props' chunks, and a
  distance-culled mesh is never made a big caster's stand-in (a stand-in is never culled), so a hidden paint cell can
  never cast; `tests/shadow-stand-ins.test.mjs` covers paint cells beside the opted-in poles on both tiers.

# Take-now port: fire escapes, window clusters, horizon fog, gamepad, hidden pedestrians — 2026-10-29

Five "take now" items from the 2026-10-29 assessment of `mrdoob/slop-newyork` (st-wt0.19; bead st-5tb), one commit each.
Upstream code is MIT (mrdoob).

| Improvement | Upstream commits | Toronto adaptation |
| --- | --- | --- |
| Distant lit windows merge into filtered 1–2 px clusters at night, so towers keep a lit-window texture without twinkling | `2a369ca` | Applied as is to `evaluateApartmentInterior` (all three facade call sites). Toronto's sunset (`uInteriorGlow` 1.25) and midnight (1.55) presets cross the 0.5 gate; golden and midday do not. |
| Aerial fog samples the sky PMREM at roughness 0, matching the horizon colour | `1ce99d3` | One line in `lighting.js`. Toronto has no Blue Hour preset; the change applies to all four time presets. |
| Gamepad: in the car and on the bicycle the left stick's X axis only steers, the triggers alone drive / brake | `67ef6be` | Kept Toronto's A handbrake, X boost, transit interact and overlay input. A cyclist on a subway platform uses the same mapping; streetcar and subway passengers do not read movement input. Updated the file header; added vm tests (no controller automation exists). |
| Hidden pedestrians more than 50 m from the focus skip their gait and re-plant when seen again | `1fe128d` (the `renderPed` hunk of `pedestrian-system.js` only) | Toronto's crowd is inline in `traffic.js`. `knockDown` re-plants a skipped rig before solving the ragdoll's starting pose. The shader, controller and other crowd parts of `1fe128d` are separate work. |
| Fire escapes as one instanced mesh at every distance: masked guard and ladder planes, grated decks and flat treads lifted per storey, per-part shader branches, shadows only within 115 m, 4×4 frustum-culled far cells | `6b6a1ca`, `ab33d1b`, `00d95cb` | Upstream's final `fire-escapes.js` with Toronto's classic-script wrapper, the shared `filteredPulse` and the phone-tier binary mask (alpha to coverage only with MSAA; mask threshold 0.5 on FXAA tiers). `buildings.js` passes the focus to `begin()`. Upstream's numeric-TSL test runs through a vm harness, plus phone-mask and Toronto storey (3.4/3.6 m, 2–7 landings) tests. |

Left out: the rest of `1fe128d` (per-part pedestrian shading, far-LOD vertex colours and inactive player-rig IK, which
belong to the `pedestrians.js` port), and upstream's `tests/helpers/module.cjs` loader, which Toronto's classic scripts
do not need. Shadows of fire escapes beyond 115 m are now omitted, as upstream does; the desktop sun shadows reach
300 m at street level.

Validation: `npm test` ran 291 tests: 290 pass, 0 fail, 1 opt-in skip (10 new). `node tools/build-site.mjs` builds.
CPU desk benchmark of the pedestrian change (Apple M5 Pro, node, real `PersonRig`, 340 rigs with 68 in view, spread
over the 320 m crowd disc): median 1.34–1.38 → 0.45 ms per frame over two runs. `tools/benchmark-pedestrians.mjs` is unchanged by this
port (it measures `PersonRig` only) and still reports 2.08 → 1.38 ms for its deferred-pose comparison. These are CPU
estimates, not frame times.

GPU captures (Mac mini, Metal WebGPU, `tools/shots/upstream-take-now.json`): each shot was taken from `origin/main`
(`35e8e84`, tag `base`) and from this branch (tag `port`). The tiers were high at 1600×900 and low at a 412×915 touch
viewport, with seed 6711. Production transcription was running, so these are **contended-functional** visual evidence,
not timings. All four runs reached ready with no page exceptions or shader errors. The only console noise was the
known missing `plaza-bench.glb` (a build without `tools/prepare-bench.mjs`) and an audio-worker warning, both present
in both arms. What the frames show:

- Fire escapes look the same as before close up (golden, sunset, midnight), at 45 m, and in the far cells at 150 m
  and 300 m, on both tiers. Landings, treads, guards, the drop ladder and the wall shadows are intact.
- Night (sunset and midnight) skylines from the Island and Riverdale now show distinct lit-window clusters on
  distant towers instead of a uniform glow.
- The aerial fog at the horizon is nearly unchanged at golden and midday. At sunset it takes the sharper sun glow
  over the lake.

Outputs are in `ride-anywhere-geo/review/gpu2/merge-captain/`: the `takenow-*` and `takenow2-*` PNGs, their JSON
(the chosen escape and camera) and console logs.

# Pedestrian sidewalk detours and individual WALK reactions — 2026-10-29

Ported from [`mrdoob/slop-newyork`](https://github.com/mrdoob/slop-newyork) for st-wt0.19 (spec items UP-2 and UP-3);
bead `st-a0n`. Upstream's code is MIT (mrdoob).

| Improvement | Upstream commit | Toronto adaptation |
| --- | --- | --- |
| Cached sidewalk detours: a blocked walking line gets a bounded search round the obstacle on its curb island (a 0.6/1.2 m sidestep, else a 9-column grid 2 m by 0.6 m, ±2.4 m), cached on the edge as a chain of tracks linked by `before`/`after`, instead of being dropped | [`2bcd413`](https://github.com/mrdoob/slop-newyork/commit/2bcd413) | `js/pedestrian-routes.js` stays a classic script. The one conflicting hunk (`clear()`) keeps Toronto's `ends` exemption and `stats.blockedAt`. Centre-line (`general`) edges check the curb island and its 4 m band, not the rough curb rectangles; grid edges must also stay on the rectangles, as their straight lines do. New: `obstacles`, the solid furniture that the road network leaves out because its colliders are turned boxes or circles. Each is tested by its own shape (a separating-axis test or a circle), not its bounds. The list covers Open Data benches and info pillars, transit shelters, bins, hydrants, post boxes, Bike Share docks and kiosks, park signs, every CaféTO patio and the turned buildings, at ground level. `main.js` passes it through `createTrafficSystem`'s new fourth argument. Mapped and procedural poles were already road-network footprints. The same test applies to dodges (`canDodge`). The furniture shapes only the sidewalk lines and dodges. Crossings, corner links and midblock stubs keep the road network's test. A line with no way round its furniture runs straight on, as before (`throughFurniture`). So the furniture never costs a crossing, a link or a line. New `stats`: `lines`, `straight`, `detoured`, `detourTracks`, `lineBlocked`, `throughFurniture`, `detourMs`, `obstacles`, `detourAt`. `?peddetours=0` restores the old behaviour for A/B comparisons. `cornerClear` stops scanning the island outline at the first edge within 4 m (same result, fewer checks). |
| Individual WALK reactions: each person steps off 0.2–1.5 s (`walkDelay`) after the WALK comes on, independently of the queue and of vehicles still clearing; a new WALK resets an unfinished delay; curb rounding epsilon (`KERB + 1e-6`) | [`35b0b84`](https://github.com/mrdoob/slop-newyork/commit/35b0b84) | Upstream's `pedestrian-system.js` does not exist in Toronto (modify/delete), so this was hand-ported into `traffic.js` `walk()`. At junctions the WALK is Toronto's `walkOn` (`SIGNALS.walk` for the junction's phase), which also drives `pedestrian-signals.js`'s heads and the mapped signal poles' heads. Toronto-only cases: midblock signals use their own WALK (`SIGNALS.walk(crossingIndex(i), 1)`) with the same delay. Pedestrian crossovers have no WALK, so people there go as soon as `mayCrossMid` says the drivers have stopped. An escape from the player does not wait out the delay. `walkAt` resets on spawn, turnaround, the next leg, joining a midblock crossing and landing off one. Waiting people still call the signal, and turning traffic still yields to them. |

Not taken: upstream's ES-module test loader (Toronto's tests use the vm harness).

## Relation to st-2t9 (walking on the City's sidewalk polygons)

The detour search is the piece st-2t9 can reuse. Today a detour's points are bounded by the curb island, its 4 m
band and, on grid edges, the curb rectangles (`cornerClear(..., sidewalk)`). Once st-2t9 gives the routes a test
against the City's sidewalk polygons (`js/toronto-sidewalks.js`), that one predicate replaces the band and rectangle
checks. The same cached `before`/`after` chains then follow the real sidewalk round patios and furniture. The obstacle
grid and the WALK reactions do not change.

## Validation

- Tests: `tests/pedestrian-routes.test.cjs` has 14 cases. Four are upstream's, on the vm harness. The rest cover
  turned benches, hydrants and cafés by shape, centre-line edges, crosswalks unchanged by furniture, the straight
  fallback, `?peddetours=0` and dodges. `tests/pedestrian-walk-delays.test.cjs` has 9 cases: upstream's five, plus
  midblock signals, PXOs, escapes and resets. Mutation checks confirm both files fail when the obb test, the
  detours, the delays, the crossing rule or the fallback are removed. Full suite: 304 tests, 303 pass, 1 opt-in skip.
- GPU captures on the Mac mini (contended, so functional and visual evidence only), with `tools/shots/ped-detours.json`,
  `CAPTURE_SEED=6711` and `transit=timetable`. They ran on the high tier at 1600×900 and on the low tier at a 412×915
  touch viewport. Outputs are under the geo repository's `review/gpu2/slop-toronto-poles/`, tags `v2high-`,
  `v3phone-` and `off` (detours off). Route stats after about two minutes of walking (lines are built lazily, so
  totals differ a little between runs):

  | Run | Crosswalks built / blocked | Midblock built | Sidewalk lines | Straight | Detoured | Through furniture | Dropped |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | High, `?peddetours=0` | 2200 / 84 | 139 | 850 | 596 | – | – | 254 (30%) |
  | High, detours | 2200 / 84 | 141 | 845 | 375 | 192 | 147 | 131 (16%) |
  | Phone (low tier), detours | 2200 / 84 | 141 | 786 | 341 | 181 | 136 | 128 (16%) |

  About half of the lines that used to be dropped now detour. The walkers' furniture list has 79,849 shapes. The
  searches took about 240–300 ms in all, most of it at load, when the midblock crossings' landings are built; this is
  a contended-machine figure, not a budget. The first run, before the fix in the second commit, showed the furniture
  costing crosswalks (2200 → 1916 built). Crossings now keep the road network's test and match the A/B baseline.
- Frames: `*-detour-follow-*` follow a walker along a detoured line on College St near the CaféTO café at
  318–320 College. `*-ks-walk-*` show King & Spadina from the WALK's onset. On the high tier, six people at one
  crosswalk with delays of 0.42–1.42 s step off in turn; on the phone, two with 0.42 and 1.26 s. Each frame's
  console line lists every person's delay, waiting state and progress. No page exceptions or shader errors. The
  only console errors are the mini's unresolved multiplayer and live-data hosts.
- Seen in passing, not changed here: on College the walkers' inner line runs over the green cycle-track paint
  that lies inside the curb island. That is the curb islands' rough extent, which st-2t9's sidewalk polygons would
  correct.

# Sidewalk panels and asphalt wear — 2026-10-29

Bead `st-e6s` (under `st-wt0.19`). Ported from mrdoob/slop-newyork (MIT)
[`4a921f0`](https://github.com/mrdoob/slop-newyork/commit/4a921f0) (sidewalk flags) and
[`dcb453f`](https://github.com/mrdoob/slop-newyork/commit/dcb453f) (road asphalt wear) into `js/tsl-materials.js`,
behind a new quality knob.

## What was taken

| Upstream | Taken | Toronto adaptation |
| --- | --- | --- |
| `4a921f0` sidewalk flags | 6 mm tooled joints with rounded bump grooves, trowelled margins and joint grime; per-panel tone; paler replacement panels; heaved (tilted) panels; hairline cracks; weathering stains; trowel mottling, fine aggregate and pores; flattened chewing gum; thin kerb joints | 1.5 m panels (the City's metric panels) instead of 5 ft flags. A lighter, cooler weathered-concrete palette, with replacement panels mixed towards nearly white fresh concrete, from John's Queen East and Dundas West / Roncesvalles photos. Gum is mostly downtown (Spadina–Parliament, lake–Bloor, the same core box `city-grid.js` paves) and a fifth as dense elsewhere; overall far sparser than New York. New: salt scaling, where de-icing salt and freeze–thaw flake the surface of about one older panel in five down to the aggregate (darker, speckled, rougher, 1.5 mm down). Wear is limited to top faces, so the slab's 4 cm sides stay plain. The same material covers the City's mapped sidewalk polygons, the fallback band and the road cuts. |
| `dcb453f` asphalt wear | Rectangular utility-cut patches and trenches with tar-sealed saw-cut edges, fresh and old patch colours, potholes that hold water first, Voronoi block/alligator cracking in worn stretches, tar snakes, oil drips, exposed stone chips, binder mottling, stronger bump (swell, ripples, mid grit, raised patches, seal beads, pothole bowls, manhole rims) | Fewer patches (a bit over one 11 m cell in three rather than one in two) and oil drips (one 2.5 m cell in four). The crack network is broken into runs and darkens less, so a worn stretch reads as cracked asphalt rather than crazy paving. Patch and pothole comments name Toronto Hydro, Enbridge and Toronto Water. A lighter grey palette that sits between New York's new one and Toronto's old one; the streetcar track bed (`streetcars.js`) still reads lighter than the shaded asphalt and darker than the sunlit asphalt, so it was left unchanged. |

## Quality tiers

`quality.js` gains `surfaceWear` (`?q.surfaceWear=<n>` overrides it for A/B work):

- `2` (high): everything. The hairline crack network is traced only where a pixel is under 4 cm, and tar snakes only
  where a pixel is under 12 cm, inside `If` branches as upstream does.
- `1` (medium and low/phone): utility-cut patches and seals, potholes, and the raised-patch/pothole bump. On the
  sidewalks: tooled joints, replacement panels, heave, hairline cracks and stains. No Voronoi networks, tar snakes, oil
  drips, chips, mottling, gum, salt scaling or fine pores.
- `0`: the plain asphalt and panels, close to the previous shaders' cost (new palette and thinner joints only).

## Left out

- The dry-asphalt wet sheen change in `dcb453f` (wet-film roughness 0.38→0.68, metalness weights). Wet surfaces belong
  to `st-wt0.11`; the wet terms stay as they were, and only the dry roughness gains the patch, seal, tar and oil terms.
- Broom-finish striations. The shader doesn't know which way a walk runs, and the panels are square to the world axes
  (the downtown grid's bearing), so on off-grid streets the joints don't follow the walk either. A per-vertex
  walk-direction attribute in `city-grid.js` would be needed for both. **Done in `st-ut3`**, which replaced the New York
  panel grid with Toronto's poured walks (transverse joints along each walk, full-width repairs, broom finish,
  contractors' stamps) and the Voronoi crack networks with cracks along and across the road: see
  [Toronto's poured sidewalks](sidewalk-polygons.md#torontos-poured-sidewalks).

## Verification

- `node --test tests/*.cjs tests/*.mjs`: the suite stays green, plus `tests/surface-wear.test.cjs` (tier levels, the
  `?q.surfaceWear` override, and that the expensive nodes are only built at their level).
- Before/after captures on the Mac mini (Metal WebGPU, through `gpu2`) with `tools/shots/pave-wear.json`: close and
  medium street-level shots of a residential sidewalk (Euclid Avenue, lawn verge), a downtown sidewalk (King Street
  West) and Queen Street West's asphalt with streetcar tracks, at midday and golden hour, desktop high (1600×900) and
  low on a 412×915 touch viewport. No shader or page errors. Track bed, rails and lane paint read as before, as do the
  CaféTO curb platforms in the King Street shots (seen at a distance only); at golden hour the track bed reads lighter than the shaded asphalt and close to the sunlit asphalt.
- Cost, `tools/shots/pave-wear-metrics.json` with `?q.surfaceWear=0|1|2`. Fragment WGSL for the street level and
  the walkways (`renderer.debug.getShaderAsync`):

  | Level | Road bytes / `sin` calls | Sidewalk bytes / `sin` calls |
  | --- | --- | --- |
  | 0 | 40.2 KB / 49 | 34.6 KB / 22 |
  | 1 (medium, low) | 46.0 KB / 71 | 42.8 KB / 45 |
  | 2 (high) | 73.3 KB / 177 | 52.4 KB / 83 |

  (`sin` counts are hash evaluations; at level 2 most of the road's extra hashes sit in the crack and tar-snake
  `If` branches, which only run near the camera.) Frame intervals on the high tier at `?scale=2` (3200×1800, so the
  GPU is the limit), two alternating repeats per level, mean interval: residential close 37.2 / 37.5 / 40.2 ms for
  levels 0 / 1 / 2, King St medium 51.8 / 51.8 / 53.9 ms, Queen St from above 39.8 / 39.1 / 41.4 ms. Level 1 is within
  noise of level 0; level 2 adds about 1.5–3 ms at that resolution, roughly a quarter of that at 1600×900. The low tier
  held its 30 fps cap at levels 0 and 2 at `?scale=2`. These runs were contended (production transcription was
  running on the mini) and vsync-quantized, so they are functional evidence, not a performance budget; GPU timestamp
  queries (`?gputime=1`) gave unusable per-pass times on the mini and were not used.
