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

# Delivery vans, pickups and minivans — 2026-10-29

Bead `st-2m8` (from the st-wt0.19 borrow assessment, group N19). Ported from mrdoob/slop-newyork (MIT)
[`52f84db`](https://github.com/mrdoob/slop-newyork/commit/52f84db) ("Modernize vehicles and add delivery vans,
pickups and minivans") and [`9cabaeb`](https://github.com/mrdoob/slop-newyork/commit/9cabaeb) (dedicated car wheel
material). Upstream's ES-module split of the vehicles (`a540327`, `ae502df`) is not taken: Toronto keeps the classic
loader and `window.CITY`, and `9cabaeb`'s wheel material lands in `actor-models.js` instead of upstream's `cars.js`.

| Upstream | Taken | Toronto adaptation |
| --- | --- | --- |
| `52f84db` car geometry | The whole car section of `actor-models.js`: raked noses and tails closed by tip caps (body-coloured fascias instead of bumper strips), the modernised sedan, SUV and taxi tables, the pickup (tonneau cover), the high-roof delivery van (cargo box, barn doors, curb-side sliding door, step bumper), the minivan, `carTipZ` | Toronto's taxi stays a white sedan with its roof sign and no door badges. The bus and helicopter changes in the same commit (New York's bus liveries, destination atlas and fairing) are not taken; the TTC bus is unchanged. |
| `52f84db` car material | Per-part `If` branches, per-axis footprint filtering, style codes in `carState.w` (livery, metallic, chrome or blackout trim, wheel style), wheel styles, sliding-door and barn-door seams | Livery 1 is Toronto's police livery (dark blue band, red pinstripe, door lettering on white), so the older police flag (`carState.w = 1`) and multiplayer's plain remote cars (`0`) keep their meaning. New York's Boro-taxi, TLC and medallion liveries are removed. New liveries 2, 3 and 5 are compiled into the van's material only: courier vans in teal or orange (a slanted colour field over the back of the cargo box, a side band, an unreadable wordmark and a plain square mark, the lower barn doors in the same colour) and utility vans (a hi-vis yellow band with an orange pinstripe, red and yellow chevrons across the lower barn doors). The colours are made up; there are no company names or logos. |
| Plates | Front and rear plates painted from one atlas | Ontario-style: `drawOntarioPlate` draws white plates with ONTARIO, the number with a generic crown-like mark between letters and digits, and YOURS TO DISCOVER; passenger plates in blue, commercial plates in black (all vans and about half the pickups). The player's car uses the same drawing, mounted on the raked bumpers. |
| `9cabaeb` wheel material | `createCarWheelMaterial` and the shared alloy and tyre evaluation | The near cars' spinning wheels read each car's wheel style (`wheelStyle`), and the player's car uses it too, instead of a whole car material. |
| `52f84db` traffic | `CAR_KINDS` (spacing, path half width and axle, collision length and mass, engine voice), a 20-car fleet cycle, one instanced near/far pair per kind, contact shadows sized to the kind | Of every 20 cars: 4 taxis, 5 sedans, 6 SUVs, 2 delivery vans, 2 minivans and a pickup. Toronto keeps one police cruiser in a hundred, always a sedan (the light bar and livery fit its roof and sides). Palettes are Toronto's (white taxis, the earlier sedan and SUV colours plus a two-tone each); 4 vans in 10 carry a courier livery and 2 in 10 a utility livery. The unused shore-highway traffic knows the new kinds too. `audio-sources.js` picks the engine voice from the kind. |

Multiplayer: remote players' cars still build `BODY_SPECS.sedan` and write `carState.w = 0`, which stays plain
paint, so the protocol is unchanged.

## Validation

- `npm test`: 373 tests, 372 pass, 1 opt-in skip (after merging main). New `tests/vehicle-bodies.test.mjs` (14):
  the fleet mix on all three tiers (every new kind at least 4 cars on the phone tier, police sedans only), each kind's
  geometry bounds against its spacing, collider, axle and plate mounts, identical attributes for both LODs,
  triangle budgets, the style-code compatibility and the plate drawing.
- Triangles per car body (node, `buildCarGeometry` without wheels / far proxy): sedan 2,316 / 488 (was 2,872 / 494),
  SUV 2,372 / 488 (was 3,004 / 494), taxi 2,444 / 500, minivan 2,354 / 488, pickup 2,388 / 488, van 2,221 / 469;
  the spinning wheel 279 (was 320). Draw calls: one instanced near and far mesh per kind, so up to 12 body draws
  (was 6) plus the same number of shadow-pass draws when every kind is on screen at both distances; empty meshes
  are hidden. In the captures the car bodies cost 3–11 draws (as many shadow draws) and 3k–34k triangles per pass,
  depending on how many cars were in view, on both tiers (each shot's `[vehicles]` console line has the figures).
- Captures on the Mac mini (Metal WebGPU, `tools/shots/vehicle-types.json`): the busiest stretch near Yonge &
  Dundas (midday and twilight) and King West (golden hour) from street level, the curb and parking lane at the
  Roncesvalles parking machine, and close views of a courier van, a utility van from behind, a pickup, a minivan
  and a sedan's rear plate. Desktop high at 1600×900 (tag `desk`) and low at a 412×915 touch viewport (tag
  `phone`), under `review/gpu2/slop-toronto-r3-desk/` in the shared geo repository. No page exceptions or shader
  errors; the only console errors are the static server's expected `/live/vehicles` 404s. The first run showed
  passenger and commercial plates swapped (the flipped canvas texture) and faded utility chevrons; both were fixed
  before the final run. The mini was shared, so these are functional and visual evidence, not performance numbers.

# Front-wheel steering and dodging the player — 2026-10-29

Bead `st-hde` (from the st-wt0.19 assessment, group N20). Ported from mrdoob/slop-newyork (MIT)
[`17c0973`](https://github.com/mrdoob/slop-newyork/commit/17c0973) ("Steer street traffic through the front wheels and
dodge the player") into `js/traffic.js`, by hand: the whole-commit trial conflicts in three hunks of `traffic.js`, and
Toronto's traffic has streetcars, decks, the King junction fix (#27) and pedestrian detours that New York's lacks.

| Upstream | Taken | Toronto adaptation |
| --- | --- | --- |
| Front-wheel steering (`steer`, `previewPoint`): Stanley steering for the bend a moment ahead (through the junction the way the car will cross it), its heading and its offset; wheels turned no faster than a person turns them, no further than comfortable (in a panic, than the tyres grip); the heading follows the wheels and the car drifts across its path | Yes, with the driver constants (`bMax`, `grip`, `lock`, `steerRate`) | `locate` keeps Toronto's axle-to-axle placement on the path, with the deck's height and grade; the body is now centred `dl` off its path. The approach angle is capped at Toronto's old lane-change pace (0.3 m/s at a crawl up to 1.7 m/s across; buses slower) and at 25–30° at a crawl, so a car pulling away mid lane change no longer swings on past its lane (uncapped, upstream's law overshot by up to 2.1 m in a test accelerating from 5 m/s). A stopped driver still edges over at up to 0.3 m/s, as before, so a queue on a streetcar's lane can clear into the next (#27); not into the player beside it. Knock spin now turns the heading and decays (`yawVel`) instead of springing back through `yawOffset`, as upstream. |
| `react` / `threatTime`: a driver notices the player about to hit it within 1.8 s, reacts after 0.6–1.0 s, then commits for at least 1.2 s: hard braking for its front half, flooring it for its rear half, a swerve if there is room | Yes (`AVOID_NOTICE`, `AVOID_HOLD`, `alarm`, `panicUntil`, `panicAcc`) | Not on another level (deck or ramp above or below). Upstream's swerve was 1.2 or 2.2 m wherever the road was clear (`isRoadClear`). Here the swerve is the least that clears the player, found by running the steering law forward against the player (`clearShift`, `playerClear`), and the whole way out and back must be clear (`wayRound`): over no curb, island or median; on a deck or ramp only its own lanes; across the centre line only of an undivided street; and no other vehicle (bar its followers), no streetcar or train (wider margin, 1.5 s longer: they can't steer round), and no one on foot there or coming, all the while it could be anywhere from where it is to where it steers. Otherwise it brakes. No swerve inside a junction. A panic swerve settles at its offset before steering back. |
| No turn signal for a panic swerve | Yes | Lane changes and the calm pass below still signal. |
| — | New | `passPlayer`: a driver coming up behind the player standing, walking, cycling slowly or stopped in a car in its lane steers round them, as far over as it needs to leave 0.9 m, on the left unless the player is on the left of the lane, only if the whole pass is clear (`wayRound`) and done before the end of the street. It looks again every quarter second and pulls back in if the way closes before it is alongside. A driver who can't get round stops 8 m back (`PLAYER_S0`) from a person or a bicycle, room to pull round later. |

Also: `changeLanes` holds off while a driver dodges; `tests/vehicle-physics.test.cjs` gets upstream's `steer` stub and
`nose` field; `placeVehicle` is exported for the capture below. Nothing of 17c0973 was left out.

## Validation

- `npm test`: 383 tests, 382 pass, 1 opt-in skip (main had 366). New: `tests/traffic-swerve.test.cjs`, 17 cases on the
  production code (relateToPlayer, react and the rest of the dodge section, steer, locate, the streetcar section's
  obstacleGap) with a stand-in for accelerate's other terms. They cover:
  - upstream's timing: noticed 1.8 s out, acted on after the reaction time;
  - which way it swerves, and the least swerve that clears the player (within its lane for a player at its edge);
  - braking only between close curbs; no swerve over a median or off a deck's lanes;
  - the steering limits: wheel rate, tyre grip; a standing car doesn't turn but still edges over;
  - on a side street: steering round a standing person over the centre line, waiting while an oncoming car goes by,
    never round the player into someone on foot;
  - on a King-like street: keeping off the track while a streetcar comes up behind a slow cyclist, then passing; a
    swerve onto the track only when no streetcar is beside it, braking instead when one is;
  - on a deck; and 160 seeded random cases (people walking, cycling and driving towards, along and across the car's
    lane, streetcars on either track, oncoming cars, people on foot in the next lane) in which no swerve or pass ever
    puts the car into a streetcar or a pedestrian. 3,000 more seeded cases offline found none either.
  The random case caught a real fault during the work: a return to the lane through someone standing in the oncoming
  lane, after a panic look ahead too short to cover the way back (now AVOID_HOLD + 2 s).
- Lane-change overshoot of the steering law, in the same harness: at most 0.21 m, from standing, 3, 5, 8 or 12 m/s, and
  pulling away to 12 m/s from 0.5–5 m/s; panic swerves 0.08–0.32 m past their offset.
- Captures on the Mac mini (`tools/shots/traffic-swerve.json`, film-mode frame stepping so the frames are
  deterministic, seed 6711, midday, `transit=timetable`): high tier at 1600×900 and the low tier on a 412×915 touch
  viewport. Each scene places a car behind the player on the road network and logs, at every phase, the car's speed,
  offset, wheel angle and dodge state, and the closest it came to the player, streetcars, people on foot and other
  traffic. Outputs are under the geo repository's `review/gpu2/slop-toronto-rinks/`:
  - Palmerston Boulevard, a person standing in the lane (`swerve3-{high,phone}--side-*`): planned 34 m back, out over
    the centre line at 6 m/s with the wheels turned and the left signal on, past and back in its lane. Closest 0.92 m
    (high) / 1.16 m (phone), no other traffic within 15 m.
  - Palmerston Boulevard, the person stepping off the curb into the lane (`swerve4-{high,phone}--cross-*`): noticed and
    reacted 1.7 s in, swerved 1 m right, behind them, braking to 3.5 m/s; closest 1.6 m.
  - King Street West west of Spadina, a cyclist stopped in the lane (`swerve6-{high,phone}--king-*`): round them over
    the streetcar track with no streetcar within 60 m, closest 0.91 m / 1.2 m.
  - No page errors. The only console warning is the known audio-synthesis worker warning.
  - Contended mini, so these are functional and visual evidence only.
- Known gap: no capture of a panic swerve on King, nor of a streetcar on King holding a car back.
  - The scripted King crossing (`swerve6-*--kingcross-*`) put the person across before the car came up, so the car
    never reacted.
  - Placing scenes on King took four runs. A latitude/longitude lookup (`worldFromLatLon(43.6455, -79.395)`) landed on
    Adelaide and Richmond, which also carry track.
  - King's segments near Spadina are 47–94 m long, under the 120 m the scene wanted, and have one lane each way with
    the track in it.
  - Doing this properly needs a hand-picked segment ID. The node tests cover the streetcar cases instead.

# Surveyed-building technique on the City's 3D Massing (pilot) — 2026-10-29

Epic `st-2nl`, pilot `st-2nl.1`; plan and evidence in [massing-buildings.md](massing-buildings.md). The technique of
mrdoob/slop-newyork's (MIT) surveyed buildings is reimplemented on Toronto's own data. No upstream commit is
cherry-picked: its `building-*.js` ES modules don't fit the classic-script tree.

| Upstream | Taken | Toronto adaptation |
| --- | --- | --- |
| `1daa665`, `062c4a9` polygon footprints in a compressed binary, per-1 km-cell merged walls | the cell merge and the `footprintLocal` facade frame (`facadeWall`, `box`) | The polygons are the City's 3D Massing 2025 records, already the source of `GEO.buildings`. A pilot sidecar (`js/toronto-massing-pilot.js`, Kensington Market) is keyed to rows and durable IDs, loaded only with `?massing=1`. `tsl-materials.js createFootprintFacades` merges one mesh per facade style per 1 km cell. The rendered (paint) and curtain-wall materials take `footprintLocal`. |
| `819a0ad` party walls and ghost signs | party walls (windowless lot-line walls) | Sampled at build time (0.35 m outside each edge). Ghost signs are not taken yet (`st-2nl.6`). |
| `0073425` surveyed detail placement | fire escapes and AC units on polygon edges | On the longest rear edge (not a street front or a party wall). |
| `211860c` reuse surveyed centres when batching | yes | Cells keyed by the row centre. |
| `c4ab18f` surveyed cells cast through the shadow stand-ins | yes | `userData.shadowStandIn = true` on each cell mesh. Toronto's `scene-culling.js` already supports it. |
| `28c0af7` NaN and through-wall contacts in polygon collision | its fixtures | Toronto's `world-collision.js` is an independent SAT. The sliver fixture found that an outline with no edges gave an infinite push, so `colliderShape` now drops NaN corners and `contact()` ignores an edgeless outline. |

# three.js pin b3396270 — 2026-10-29

Bead `st-ary`. The browser three.js dev build moves from
[`e27dfa95`](https://github.com/mrdoob/three.js/tree/e27dfa95ae7f453b5d7a9a36ffdb563f7c9b529b) (23 October) to
[`b3396270`](https://github.com/mrdoob/three.js/tree/b3396270682287470d161658ac01084d25e8dba6) (28 October), as Slop
New York did in [`c36373c`](https://github.com/mrdoob/slop-newyork/commit/c36373c). That is 51 three.js commits, still
`REVISION = '187dev'`. John approved it on 29 October; the adoption spec's preserve-the-pin rule carries the amendment
(§2 of that internal planning document, not published here). Upstream's intermediate steps (`a3c478a`, `1a1cfd8`,
`c9c1900`) are superseded.

## Where the pin lives

- `explore.html`'s import map (`three`, `three/webgpu`, `three/tsl`, `three/addons/`): the runtime.
- `tools/prop-preview.html`, `tools/props-preview.html` and `tools/clouds-probe.html` (`?three=city`; `?three=e27`
  still works) use the same commit. `vendor/clouds/release.json` records the renderer alpha.6 runs on.
- Unchanged: `package.json`'s `three` 0.186.1 and `vendor/three/` stay the npm build that tests and tools use (the
  pin is not on npm). `tools/build-clouds.mjs` keeps three external and bundles only `EXRLoader` from npm, which none
  of the 51 commits touch, so `js/clouds.js` regenerates byte-identical.
- `tests/threejs-pin.test.cjs` checks that every one of these uses the one commit.

## The paired uniform fix (three.js #35221)

#35221 reverts #34996's `fogNode`/`environmentNode` tracking in `NodeMaterialObserver`. At the new pin a material with
no node properties of its own (GLTF props and landmarks, plain `MeshStandardNodeMaterial`s) gets a SHARED refresh each
frame, which uploads the render and frame uniform groups but not the default object group. Upstream's own fog examples
moved their uniforms to `renderGroup` in the same change. Toronto now does the same for every scene-wide uniform that
is rewritten at run time:

| File | Uniforms | Rewritten |
| --- | --- | --- |
| `js/lighting.js` | `uFogDensity`, `uFogHeight` (read through `scene.fogNode`) | per time of day; `sky-clouds.js` scales the density |
| `js/lighting.js` | `uSkyExposure`, `uNightFactor`, `uNightSkyColor` (sky dome, baked into the environment) | per time of day |
| `js/tsl-materials.js` | all of `cityUniforms` (sun colour, intensity and direction, sky colours, interior glow, road wetness, canyon bounce, water knobs) | per time of day, `?waterTune` |
| `js/ez-trees.js` | `viewer` (LOD hand-over distance) | every render, in `scene.onBeforeRender` |
| `js/street-details.js` | `signalClock` (also read by `pedestrian-signals.js`) | every frame |
| `js/tour-guide.js` | `uAlong`, `uTime` (route ribbon) | every frame |
| `js/sky-clouds.js` | `nightGlow`, `camProjInv`, `camWorld` | per time of day, every frame |
| `js/post-processing.js` | `exposure`, `contrast`, `saturation`, `balance` (grade) | per time of day |

`tests/threejs-pin.test.cjs` checks each of them and that the fog node reads no other uniform of its own.

Checked and left in the object group:

- Per-object or per-material state: `actor-models.js` `stateUniform` (one fixed-colour car material), `subway-ride.js`
  `opened` (one per train).
- `uniformArray`s uploaded every frame (`street-details.js` `signalShifts`, `pedestrian-signals.js` `shifts` and
  `active`): read only by materials with node properties, which still get a full refresh.
- Generated or vendored modules: `js/stylized-water.js` (`time`, `sunDirection`, `radiance`; built from
  `vendor/stylized-water`, a node material) and `js/clouds.js`/takram (the libraries' own passes).
- Debug-only knobs (`pbr-water.js` under `?water=pbr&waterTune`) and per-material constants (facade seeds, tints).

**What the captures showed.** A negative control (the new pin without the `renderGroup` change) did not reproduce
stale fog. Two reasons were confirmed. First, every time-of-day preset also changes `scene.environmentIntensity`, and
`NodeMaterialObserver.equals()` turns that into a full refresh. Second, even a fog-only change (the density set by hand,
no preset change) reached the GLTF CN Tower in the control. So in Toronto's current scene those materials still get a
full refresh; the likely path is their lighting context, but this was not traced. The `renderGroup` uniforms are
therefore the correct form, not a visible fix. They keep the fog right if that path changes, and upload once per render
rather than once per object.

## Other changes in the 51 commits, for Toronto

- #35232 (alpha-tested shadow casters no longer re-key every frame) and #35203 (the shadow pass skips scene matrix
  walks): no visible change. Toronto's alpha-tested casters already use nodes, and `main.js` manages
  `matrixWorldAutoUpdate`. No Toronto code moves objects during the shadow pass.
- #35238 and #35243 (SSR): Toronto uses blur mode with `binaryRefine`, so only the refined-hit validation applies,
  on the desktop tier. `mirrorBias` only affects stochastic SSR.
- #35233: `resetRendererState()` also saves and resets `autoClear*`, `opaque` and `transparent`. The cloud passes call
  it; clouds and the atmosphere render as before on both tiers.
- #35245 removes `Node.before()`, #35251 moves the swizzle cache off `node._cache`, and #35230 renames
  `getProjectionDepth()`. Nothing in Toronto, `js/clouds.js` or `js/stylized-water.js` uses them.
- #35204/#35226/#35222/#35193: render-target initialisation, bind-group cache keys, WebGL-fallback shared uniform
  blocks, and GLTF KTX2 images. These are latent fixes; Toronto loads no KTX2.

## Verification (2026-10-29/30)

- `npm test`: 362 tests, 361 pass, 1 opt-in skip. `npm run build` passes and `js/clouds.js` is byte-identical.
- Mac mini (Metal WebGPU, `gpu2`), with `tools/shots/threejs-pin.json` (sky, the CN Tower from Centre Island through
  live switches golden → midday → twilight → midnight → golden, a forced fog-only change, water, a 504 streetcar ride).
  It ran at desktop high (1600×900) and phone low (412×915 touch) for main `5c74d5f` (before) and this branch (after).
  The pin without the fog change was also run on desktop. The photo-mode runner and `tools/check-open-data.mjs` ran
  for both builds. Same-machine frames match by eye and by sampled region means, apart from the cloud noise. Photo
  JPEGs (skyline night, market midday and the rest) match. Open-data shots pass on both tiers for both builds.
- Console, before and after alike: 9 × `THREE.TempNode: This module has been deprecated. Extend Node instead.` (from
  the cloud and atmosphere bundle's `TempNode` subclasses, already on main at `e27dfa95`). There is also one
  `[audio] synthesis worker` destructuring warning, and in the open-data runs, 404s for `/live/vehicles` because the
  static capture server has no Worker. No page errors and no WebGPU validation or shader errors.
- One run failed on a transient jsDelivr 403 for `CSMFrustum.js`, so clouds did not load in that run. It was rerun.
  The rerun's twilight ride frame is lit differently only because its streetcar had reached the next stop.
- `?webgl=1` (the WebGL2 fallback) renders a black scene before and after alike: the cloud library throws "the WebGL2
  backend of WebGPURenderer is not yet verified" while building the pipeline. That is a pre-existing problem, and it
  does not test the `renderGroup` change on WebGL2 (where #35222 fixes shared uniform blocks).
  Captures from the shared mini are functional evidence, not performance numbers.

# Generated storefronts and entrances — 2026-10-29

Bead `st-sz0` (fallback layer under the source-keyed signs of `st-wt0.15`; see [storefronts](storefronts.md)). Ported
by hand from mrdoob/slop-newyork (MIT) into `js/tsl-materials.js` and `js/buildings.js`. None of these commits was
cherry-picked.

| Upstream | Taken | Toronto adaptation |
| --- | --- | --- |
| [`59be218`](https://github.com/mrdoob/slop-newyork/commit/59be218) storefronts on surveyed ground floors | The idea only | Its one change switches on `footprintLocal`, which only NYC's surveyed-building commit `1daa665` defines; applied here it cherry-picks cleanly, passes the old tests and then throws when the shader is built. Toronto has no surveyed footprint walls: every building wall is a `createFacadeBoxes` box, whose existing bottom-storey rule is unchanged. |
| [`8d88e41`](https://github.com/mrdoob/slop-newyork/commit/8d88e41) storefront glazing, interiors and signs | `createStorefront`: one shop per ~7.5 m of a shop wall's ground floor, door to one side, display window, transom, parallax interior (shelves, stock, counter, ceiling lamps, back light), lit/unlit shops, glass fresnel, plus `boxCoverage` | Box-local only (`wallS`/`wallW`). Heights follow Toronto's 3.4–3.8 m storeys (fascia 12 cm under the floor above, 55 cm deep, display and transom below it) rather than NYC's fixed 2.96–3.56 m sign band. **The generated fascia is blank**: upstream's eight invented labels (`CORNER MARKET`, `PIZZA`...) are not drawn; real names come only from source-keyed records. Replaces Toronto's older 2D shop glass in the rendered and curtain-wall materials. The parallax interior is behind a new quality knob (`storefronts`: 2 on high/medium, 1 = a flat lit interior on the phone tier). |
| [`09d27e0`](https://github.com/mrdoob/slop-newyork/commit/09d27e0) limit storefronts to selected buildings | Selection | NYC picks 35% of surveyed buildings at random. Toronto selects from data (`storefrontSelection`): buildings holding a mapped shop/restaurant/bank/market/clinic (`GEO.pois`), low and mid-rise buildings fronting a retail strip (two or more such places on the same street within 30 m of the front wall), and walls carrying a source-keyed sign. Every other street front keeps Toronto's residential/office front (windows to the ground and one entrance), which was already "solid" in upstream's sense: no shop glazing. Before this port every mid-rise and a quarter of the low-rise had shopfronts. |
| [`633ecd0`](https://github.com/mrdoob/slop-newyork/commit/633ecd0) increase storefront coverage | No | A probability tweak for NYC's random selection; Toronto's is data-driven. |
| [`26bb9fe`](https://github.com/mrdoob/slop-newyork/commit/26bb9fe) procedural building entrances | `createBuildingEntrance`: trimmed recess, panelled leaf glazed above the lock rail, handle, single or double doors, glass fresnel, a faint warm glow | Placed in the entrance bay Toronto's facade already picks per residential front (`facadeCell`'s `door`) instead of every 28 m, replacing the flat steel door of the rendered facade; double doors on walls ≥ 18 m (≥ 12 m for curtain walls, `modern`). Towers' entry walls gain an entrance for the first time. |
| [`dbaf5f9`](https://github.com/mrdoob/slop-newyork/commit/dbaf5f9) keep entrances off storefronts | Yes | Holds by construction: the entrance mask is the `door` bay, which only exists on `entry` walls. |
| [`cfce077`](https://github.com/mrdoob/slop-newyork/commit/cfce077) stable awning signs | N/A | Toronto's `buildings.js` has no awnings. |

`createPreWarBuildingMaterial` was not changed: nothing in Toronto uses it.

## Validation

- `tests/storefronts.test.mjs` builds the rendered, curtain-wall and sign materials to WGSL with the vendored three.js
  (a `WGSLNodeBuilder` with a stub device: generation, not a GPU compile) at both storefront detail levels, and checks
  that no survey-only identifier is used, that the generated fascia draws no text and that entrances only use the
  entry walls' door bay. The full suite: 369 tests, 368 pass, 1 opt-in skip.
- Fragment WGSL sizes (rendered facade / curtain wall): main 46.1 / 34.7 KB, now 66.5 / 60.8 KB on high and 56.6 /
  50.9 KB on the phone tier. The storefront and entrance work sits in `If` branches that only run on shop ground floors
  and entrance bays.
- gpu2 captures: see [storefronts](storefronts.md#verification).
