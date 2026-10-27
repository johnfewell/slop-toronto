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

- The baseline suite had 124 tests: 111 passed and 13 failed before any edits. The failures involve stale New York /
  Abuja fixtures, the geodata test's unavailable raw input files, Overpass whitespace expectations, a smoke-texture
  test for a removed function, and an outdated camera fixture.
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
