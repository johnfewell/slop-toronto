# Activity and overlay coordination

Implementation for `st-wt0.4` (M0b), 28 October 2026. Extends `createTransitRideSession` in place; [photo capture evidence](photo-capture-spike.md) remains the renderer prerequisite.

The coordinator reserves one locomotion owner. Streetcar passengers acquire automatically through the existing `begin` contract. A subway visit reserves `subway` on entry, attaches a train while aboard, and keeps the reservation when alighting onto its platform. Its safe-ground hook always resolves to the current supported station entrance. Ending a blocked transfer preserves the owner. Mode change, teleport, reset, pagehide and device loss use centralized cancellation; reload still uses the single `savePlayerState` writer.

One overlay lease sets `CITY.uiOverlay`. A hold overlay additionally sets `CITY.presentationHeld`. Keyboard, synthetic touch/gamepad input, touch controls, gamepad routing, camera pointer controls and both transit interaction adapters consult that gate. Release clears input and pointer captures; an already-held keyboard auto-repeat or gamepad button cannot become a new movement/boarding action. Map/help use the same gate and cannot open over photo framing. Short boarding/alighting fades block overlay acquisition. Film stepping and overlays cannot both acquire presentation.

Overlay camera snapshots include layers, near/far, FOV, preset, orbit/zoom, cinema/follow state, positions and smoothing state. Return restores the occupied camera instead of applying its preset again and losing custom projection values. Existing passengers keep their vehicle lease and safe reload anchor throughout an overlay.

The held render loop skips actor/controller simulation, traffic, transit, dwell, Tour Drive, audio emissions and adaptive-quality decisions entirely. It advances camera presentation, matrices/culling and cloud sampling with a fixed cloud phase. It never calls the world with `dt = 0`. Shared shader time is held during drawing and resumes with the paused wall interval removed. `applyVisualTime` changes lighting/grade only; held `selectTime` calls use that seam. Closing the overlay restores its prior visual preset without traffic/headway updates.

TTC responses can refresh the cache while held, but subscribers receive only the latest sample after release, with stale data falling back to the timetable. Bike Share queues one completed response, applies its counts after release, and checks freshness at apply time. Audio is suspended without changing the mute preference; gesture/visibility handlers cannot resume it during the hold.

## Verification

CPU: 71 targeted tests pass across ride ownership, subway service, keyboard/touch/gamepad, audio, shared clocks and the actual TTC polling/publishing boundary. The full suite at M0b verification was 201 tests: 188 pass, the same 13 baseline failures. No fixture assertions were weakened. The stale camera/navigation fixture repairs remain separate work.

Both high 1600×900/MSAA and low 412×915/FXAA passed `tools/shots/adoption-ownership.json` through `gpu2`, served build `02b27cbfc485`. Fixtures in `tools/experience-fixtures.js` replace network responses in a fresh browser context; the actor systems, render loop, cameras and ride adapters are real. Cases cover:

- A ten-second hold with unchanged actor poses and simulation/shader/cloud phase; resume has finite actors and no ten-second catch-up.
- Completed TTC/Bike Share responses cached during hold and applied after release; visual time changes/restoration make zero traffic-hour/transit-time calls.
- Twenty overlay cycles from each streetcar/subway seat, preserving projection, vehicle identity, suspension and resource counts.
- Actual subway service advancement to an arrival, alighting while retaining station ownership, then a safe surface exit.
- Safe-ground persistence and reload, map/help gating, and rejection of competing overlay/film ownership.

Artifacts and console receipts: `/Users/johnfewell/code/ride-anywhere-geo/review/gpu2/slop-toronto-adoption-metrics/owner-{high,low}-*`. Production transcription was active: these validate function and rendering, not frame-time budgets or real-phone performance. The full idle-baseline gate remains `st-wt0.2.2` / `st-oiw`.

Reproduce after building the site:

```sh
GPU2_LOCK_WAIT=900 gpu2 slop-toronto-adoption-metrics -- env CAPTURE_ROOT=dist CAPTURE_QUERY='?quality=high&autoscale=0&metrics=1&sound=0' CAPTURE_INIT_SCRIPT=tools/experience-fixtures.js CAPTURE_LOAD_TIMEOUT_MS=120000 CAPTURE_TAG=owner-high CAPTURE_PROGRESS=1 node tools/capture.mjs tools/shots/adoption-ownership.json
```

For low, use `quality=low`, `CAPTURE_VIEWPORT=412x915`, `CAPTURE_MOBILE=1` and tag `owner-low`. This seam exposes developer overlay controls; the [opt-in photo/download/album interface](photo-mode.md) now builds on it. Real native sharing remains its own device-compatibility task.
