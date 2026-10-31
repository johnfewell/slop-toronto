# Adoption measurement instrumentation

Implementation for `st-wt0.2` (M0i). The adoption spec (an internal planning document, not published here) defines the proposed budgets. This collector supplies evidence for those gates; it does not establish that the gates pass or that photo capture is implemented.

## Available diagnostics

Add `?metrics=1` to load an enabled bounded frame collector. Ordinary exploration has no frame samples or extra per-frame CPU timing calls unless this or the existing CPU profiler is enabled. The owned-resource API is available for new feature allocations without scanning the entire city.

```js
const app = window.__CITY_APP;
app.measurements.start({ label: 'skyline-high', warmupMs: 2000 });
// Let the actual city loop run for the intended measurement interval.
const frames = app.frameTimes({ raw: true, stop: true });
const resources = app.resourceSnapshot();
```

The stop precedes screenshots, readbacks and resource inspection. Restarting begins a new window; old data is not mixed with the next shot. At most 4,096 samples are retained. An overwritten or empty window is marked invalid and capture tooling preserves its raw report before failing. Warm-up, reset/visibility boundaries, fixed film steps, startup and invalid/nonfinite readings are counted as exclusions. A hidden-tab discontinuity discards the first resumed frame rather than reporting hidden time as a slow frame.

Distributions use nearest-rank median/p95. Retained raw arrays contain frame intervals, simulation/preparation CPU, synchronous render submission CPU and relative sample timestamps. The CPU envelope ends immediately after renderer submission; it excludes later HUD updates and asynchronous GPU completion. The frame interval is wall time between **rendered** frames, including the low-tier limiter/vsync. It is not GPU execution time, and the simulation's 50 ms clamp does not clamp slow-frame diagnostics.

The existing optional GPU timestamp profiler remains separate and reports pass averages. Its intervals may overlap; do not sum them as exclusive GPU cost or call them p95. No GPU-completion wait was added to ordinary frame submission.

## Owned resources

```js
const lease = app.resources.track({
  owner: 'photo', kind: 'renderTarget', label: 'final image', resource: target,
  cpuBytes: 0, gpuBytes: knownAllocationEstimate
});
lease.update({ cpuBytes: retainedReadbackByteLength });
target.dispose(); // an existing dispose event releases the ledger entry
lease.release();  // idempotent accounting fallback for non-event allocations
```

Kinds are buffer, geometry, texture, renderTarget, canvas and image. Register each unique allocation once; shared resources must have one designated owner. A second registration of the same object is rejected. Supply byte estimates from the actual allocation descriptor, including format, dimensions, samples and mip levels where relevant. Omitted/null CPU or GPU bytes are reported as unknown. Known zero is explicit. This module does not infer a texture format or pretend `renderer.info.memory` counts are byte sizes.

The ledger records current/peak estimated CPU/GPU bytes, live/allocated/released counts and per-owner/kind totals. Peaks are since ledger creation. It holds at most 1,024 live entries, removes dispose listeners on release and does not retain released resource objects. `release()` changes accounting; owners still free/dispose the real allocation. Browser callbacks that fail or cancel must release their own allocations. The new collector has **not** registered all existing city/cloud allocations: an empty owned ledger does not mean the renderer uses no memory. `resourceSnapshot()` includes separate renderer counts for that reason.

## Capture recipe and evidence

`tools/capture.mjs` accepts `CAPTURE_METRICS_MS` and `CAPTURE_METRICS_WARMUP_MS`. It adds the metrics query safely, settles the shot, opens a bounded window, stops it before image export and writes per-shot `.metrics.json` plus an aggregate `metrics.json`. Reports include initial/final settings, browser/machine, import map, optional source revision, actual served document/main/cloud/wrapper/capture-clock/measurement code hashes, exclusions and raw samples. A source revision can describe a dirty candidate; the served hashes identify the actual integration code. These receipts do not claim to hash every geographic asset.

Use the existing `gpu2` lock and the idle-machine rules of `st-oiw`; never benchmark on the laptop. Example, from the repository root after `node tools/build-site.mjs`:

```sh
GPU2_LOCK_WAIT=60 gpu2 slop-toronto-adoption-metrics -- env CAPTURE_ROOT=dist CAPTURE_QUERY='?quality=high&autoscale=0&transit=timetable&film&cloudSpeed=0' CAPTURE_METRICS_MS=8000 CAPTURE_METRICS_WARMUP_MS=2000 CAPTURE_IDLE_CHECK=1 CAPTURE_SEED=6711 CAPTURE_TAG=high CAPTURE_PROGRESS=1 node tools/capture.mjs tools/shots/adoption-metrics.json
```

Repeat with `quality=low`, `CAPTURE_VIEWPORT=412x915`, `CAPTURE_MOBILE=1` and `CAPTURE_TAG=low`. The Mini's phone layout is not actual phone hardware. `cloudSpeed=0` holds cloud evolution, and `transit=timetable` excludes changing live vehicle positions. The seed fixes initial `Math.random`; wall-clock-driven simulation is not deterministic replay. Retain the shot list, startup time, counts and initial/final settings with each run.

`CAPTURE_IDLE_CHECK=1` records possible browser/compute processes **before** opening its browser, without stopping any of them. The wrapper's `CONTENDED.txt` or a visibly active matching process marks the run `contended-functional`. Dormant matching processes yield `background-processes-unqualified`; absence of observed contenders yields `no-observed-contention`, not proof of complete GPU idleness. No check yields `unqualified`. Inspect wrapper ownership, production transcription, other browser trees/listening ports and raw host observations before calling a result an idle baseline. A contended/unqualified timing is functional evidence only.

For a qualified baseline, reserve a quiet lock interval; record read-only process/port/production state before and after; warm both tiers; collect at least three repeated windows of the same shot, with identical served hashes, quality, dimensions, seed and environment. Preserve raw runs and run order. Report median/p95, spread and exclusions without discarding slow runs. Future candidate/baseline comparisons should alternate paired arms close in time. Missing clock-state probes or scene-state differences limit the claim and must be stated; this initial collector does not normalize GPU clock frequency.

## Current verification

- Initial suite before edits: 185 tests, 172 pass, 13 fail.
- With the new logic tests: 193 tests, 180 pass, the same 13 failures by name. They are existing navigation/teleport/geodata/Overpass/smoke issues; no assertions were weakened.
- Targeted measurement, loader and build/cache tests pass. They cover retained slow frames, warm-up/visibility/fixed-step exclusions, ring overflow, atomic byte updates, unknown bytes, actual Three.js disposal and 20 allocation/release cycles. A separate actual-TSL test verifies shader time/delta remain held across advancing renderer frames and restore update callbacks on success/error.
- `node tools/build-site.mjs` and syntax/diff checks pass. GPU functional/baseline receipts are recorded below when available; this document does not label pending captures as passed.

### Mini functional receipts, 28 October 2026

Both tiers booted and exported valid windows, raw distributions, renderer/owned snapshots and served-content identities. Production transcription was active (`CONTENDED.txt`), so every result below is **contended-functional**. These are collector validation results, not an idle baseline or a passed frame-time budget.

| Scenario | Samples | Frame interval median / p95 |
|---|---:|---:|
| High, 1600×900, skyline | 479 | 16.7 / 16.7 ms |
| High, 1600×900, street | 392 | 16.7 / 33.4 ms |
| Low, 412×915, skyline | 239 | 33.3 / 33.4 ms |
| Low, 412×915, street | 239 | 33.3 / 33.4 ms |

Receipts: `/Users/johnfewell/code/ride-anywhere-geo/review/gpu2/slop-toronto-adoption-metrics/`, `high-metrics.json`, `low-metrics.json`, per-shot JSON/PNGs and console logs. Browser 156.0.8078.4, WebGPU Metal on the Mini; high MSAA and low FXAA were recorded in the metadata. Main `86ffc0d76030…` and cloud `8ade1946424a…` hashes match between these runs. The high collector was `4479f9f14998…`; the low collector was `a2de94b9244f…` after tightening interrupted-window validity. Consequently these are **not a matched cross-tier performance comparison**. Future idle runs must use identical candidate code.

`st-wt0.2.1` records completed functional instrumentation acceptance. `st-wt0.2.2` retains the idle-baseline work, coordinated with `st-oiw`; M0i and performance release gates remain open. The capture spike may consume the verified instrumentation while those measurements wait.

Capture experiment: [M0a report and selected policy](photo-capture-spike.md). Both final export paths/tiers passed their image screens; only the narrower evidence in that report is certified.

## Idle-baseline attempt, 29 October 2026 (`st-wt0.2.2`, `st-oiw`)

**Classification: contended, not a qualified idle baseline.** Production transcription was idle for every run, and nothing else was using the GPU before the runs (IOAccelerator device utilization 0–2 %). The CPU was not idle, though. Three things that aren't ours ran throughout: an `rclone copy` that had been going for about 2.5 days (22–37 % of one core), the Logi Options+ agent and updater (24–37 %), and a Docker Desktop VM (7–14 %). Spotlight (`mds_stores`/`mds`, up to 112 %) also spiked during runs, probably from indexing our own synced files and screenshots. Across the 15 runs, whole-machine CPU idle had a median of 74 % (range 37–85 %), including our own Chromium. The rclone job would not have finished within the hour we could wait, and nothing was stopped. To get a qualified baseline, pause rclone, quit Logi Options+ and Docker Desktop, then rerun the same commands. `capture.mjs` itself classified the runs as `background-processes-unqualified`: dormant Safari/WebKit helpers. In one run (`transit-low-run2`) it classified the run as `contended-functional` because a WebKit content process was at 1.3 % CPU.

These numbers are consistent from run to run, and they are the best current evidence. Treat them as provisional until a quiet rerun reproduces them.

### Protocol as run

- Candidate: `main` 0127bbd (live), `npm ci && npm run build`, served from `dist` (build `4e3b19779eda`). Served `main.js` is `5179e451bab9…`, `measurements.js` is `a2de94b9244f…` and `clouds.js` is `8ade1946424a…`. All three are identical in every run. Headless Chromium 156 with WebGPU on Metal, Apple M4 Mac mini.
- Matched settings: `?quality={high|low}&autoscale=0&transit=timetable&film&cloudSpeed=0`, `CAPTURE_SEED=6711`, 2 s warm-up and 8 s window per shot, `CAPTURE_IDLE_CHECK=1`, `CAPTURE_CDN_CACHE=1` and `CAPTURE_PORT=8801`. High runs at 1600×900, desktop; low at 412×915 with `CAPTURE_MOBILE=1`, DPR 1.
- Run order, alternating tiers: adoption warm-up high and low, then H1 L1 H2 L2 H3 L3, 02:49–02:57 UTC. Next came a transit shakedown (`transit-high-r1`, excluded from the pools because the lifecycle shot changed after it). Finally, transit L1 H1 L2 H2 L3 H3, 03:01–03:20 UTC. Read-only host observations were taken before and after every run and every ~15 s during each.
- New capture tooling only; served app code is unchanged. `CAPTURE_INIT_SCRIPT=tools/capture-longtasks.js` attaches Long Task and Long Animation Frame entries inside each post-warm-up window to the report. `tools/shots/transit-idle-budget.json` is the transit scenario list. `tools/metrics-summary.mjs` recomputes nearest-rank p50/p95/p99 from the raw samples and pools the three runs.

Command (repeat with the low settings and `CAPTURE_TAG`s as above):

```sh
GPU2_LOCK_WAIT=600 gpu2 slop-toronto-adoption-metrics -- env CAPTURE_ROOT=dist CAPTURE_PORT=8801 CAPTURE_CDN_CACHE=1 CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_QUERY='?quality=high&autoscale=0&transit=timetable&film&cloudSpeed=0' CAPTURE_METRICS_MS=8000 CAPTURE_METRICS_WARMUP_MS=2000 CAPTURE_IDLE_CHECK=1 CAPTURE_SEED=6711 CAPTURE_TAG=idle-high-r1 CAPTURE_PROGRESS=1 CAPTURE_INIT_SCRIPT=tools/capture-longtasks.js node tools/capture.mjs tools/shots/adoption-metrics.json
```

### Adoption shots: frame time, CPU and long tasks (3 runs pooled)

The frame interval is the wall time between rendered frames, so it includes vsync and the low-tier 30 fps limiter. ">20 ms" counts missed 60 Hz vsyncs; ">40 ms" counts missed 30 fps slots. CPU is simulation plus synchronous render submission, not GPU time.

| Tier | Shot | Samples | Frame p50 / p95 / p99 (ms) | Mean fps | Frames >20 / >40 ms | Per-run p95 | CPU p50 / p95 / p99 (ms) | Long tasks | LoAF |
|---|---|---:|---|---:|---:|---|---|---:|---:|
| high | skyline-golden | 1347 | 16.7 / 33.3 / 33.4 | 56.2 | 90 / 0 | 33.3, 33.3, 33.3 | 6.3 / 7.2 / 7.9 | 0 | 0 |
| high | street-golden | 1116 | 16.7 / 33.4 / 33.4 | 46.7 | 319 / 0 | 33.4, 33.4, 33.4 | 7.8 / 8.6 / 9.4 | 0 | 0 |
| low | skyline-golden | 717 | 33.3 / 33.4 / 33.4 | 30.0 | 717 / 0 | 33.4, 33.4, 33.4 | 6.8 / 8.5 / 9.3 | 0 | 0 |
| low | street-golden | 717 | 33.3 / 33.4 / 33.4 | 30.0 | 717 / 0 | 33.4, 33.4, 33.4 | 6.6 / 8.5 / 10.5 | 0 | 0 |

Startup to `__CITY_APP.ready`, median of the measured runs: about 12.0 s high and 11.5 s low (ranges 11.8–12.2 s and 11.3–11.8 s). The first, cold high warm-up took 32.0 s.

**Finding:** desktop high at 1600×900 misses the 60 fps target on the Mini. About 7 % of skyline frames and 29 % of street frames take two vsyncs, which puts p95 at 33.4 ms. CPU submission stays at 6–9 ms, so the limit is GPU-side. Phone low holds its 30 fps limiter, with no missed slot in any adoption window. The 28 October contended receipts show the same pattern.

### Owned GPU/CPU resources

The owned-resource ledger is **empty in every window** (0 live entries, 0 CPU/GPU bytes), because no feature registers allocations yet. The renderer's own counts (`renderer.info.memory`) are below; its byte figures are estimates, not physical VRAM. They were identical across the three runs.

| Tier | Shot | Geometries | Textures | Programs | Render targets | Attributes MiB | Storage MiB | Textures MiB | Total MiB |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| high | skyline-golden | 8365 | 135 | 331 | 24 | 142.9 | 39.4 | 2002.1 | 2196.6 |
| high | street-golden | 8454 | 138 | 331 | 24 | 152.3 | 41.4 | 2022.1 | 2228.4 |
| low | skyline-golden | 5264 | 129 | 329 | 23 | 129.6 | 25.6 | 689.9 | 855.6 |
| low | street-golden | 5324 | 130 | 329 | 23 | 135.2 | 28.5 | 696.5 | 871.1 |

### Transit budgets (`st-oiw`, 3 runs pooled per tier)

The shots run in order in one session, all in real time; the film fast-forwards finish before each window starts. First comes a street reference at the 504 boarding point near Exhibition Place, then seated 504 riding, the chase camera, the exit to the street and 40 board/exit cycles. Then come a seated subway at Castle Frank, the viaduct seat, the viaduct chase view, the Broadview platform after alighting, the exit to the Broadview street and 40 board/exit cycles.

| Tier | Shot | Frame p50 / p95 / p99 (ms) | Mean fps | Frames >20 / >40 ms | CPU p50 / p95 / p99 (ms) | Long tasks | LoAF | Renderer total MiB / geometries |
|---|---|---|---:|---:|---|---:|---:|---|
| high | 504 street reference | 16.7 / 33.4 / 33.4 | 42.3 | 424 / 0 | 8.6 / 9.8 / 11.1 | 0 | 0 | 2249.3 / 8463 |
| high | 504 seat | 16.7 / 33.4 / 33.4 | 45.9 | 338 / 0 | 8.1 / 8.8 / 9.5 | 0 | 0 | 2253.2 / 8478 |
| high | 504 chase | 33.2 / 33.4 / 33.4 | 40.0 | 478 / 0 | 8.4 / 9.2 / 9.9 | 0 | 0 | 2253.2 / 8479 |
| high | 504 exit to street | 16.7 / 33.4 / 33.4 | 44.2 | 376 / 1 | 8.3 / 9.1 / 10.5 | 0 | 1 (51 ms) | 2253.2 / 8479 |
| high | after 40 streetcar cycles | 16.7 / 33.4 / 33.4 | 44.0 | 382 / 0 | 8.3 / 9.2 / 9.7 | 0 | 0 | 2253.2 / 8479 |
| high | subway seat, Castle Frank | 16.7 / 16.8 / 16.8 | 60.0 | 0 / 0 | 3.5 / 5.1 / 6.3 | 0 | 0 | 2253.3 / 8479 |
| high | subway viaduct seat | 16.7 / 16.8 / 16.8 | 59.2 | 14 / 5 | 6.2 / 7.1 / 8.8 | 0 | 3 (58–76 ms) | 2260.7 / 8615 |
| high | subway viaduct chase | 16.7 / 16.8 / 33.4 | 58.1 | 45 / 0 | 5.5 / 6.3 / 7.1 | 0 | 0 | 2260.8 / 8630 |
| high | Broadview platform | 16.7 / 16.7 / 16.8 | 60.0 | 0 / 0 | 3.7 / 4.9 / 5.4 | 0 | 0 | 2261.7 / 8644 |
| high | Broadview street | 16.7 / 16.8 / 16.8 | 59.8 | 3 / 1 | 6.9 / 7.6 / 8.6 | 0 | 0 | 2264.7 / 8680 |
| high | after 40 subway cycles | 16.7 / 16.8 / 16.8 | 60.0 | 0 / 0 | 6.8 / 7.5 / 8.0 | 0 | 0 | 2266.0 / 8717 |
| low | 504 street reference | 33.3 / 33.4 / 33.4 | 30.0 | – / 0 | 6.9 / 8.8 / 11.1 | 0 | 0 | 905.4 / 5325 |
| low | 504 seat | 33.3 / 33.4 / 33.4 | 30.0 | – / 0 | 6.9 / 8.8 / 9.6 | 0 | 0 | 907.9 / 5333 |
| low | 504 chase | 33.3 / 33.4 / 33.5 | 30.0 | – / 0 | 6.8 / 9.1 / 9.8 | 0 | 0 | 907.9 / 5333 |
| low | 504 exit to street | 33.3 / 33.4 / 33.4 | 30.0 | – / 0 | 7.0 / 8.9 / 10.1 | 0 | 0 | 907.9 / 5333 |
| low | after 40 streetcar cycles | 33.3 / 33.4 / 33.4 | 30.0 | – / 0 | 7.0 / 8.5 / 9.7 | 0 | 0 | 912.8 / 5344 |
| low | subway seat, Castle Frank | 33.3 / 33.4 / 33.5 | 29.6 | – / 2 | 5.5 / 7.5 / 8.5 | 0 | 1 (88 ms) | 912.8 / 5344 |
| low | subway viaduct seat | 33.3 / 33.4 / 33.4 | 30.0 | – / 0 | 7.0 / 8.9 / 9.9 | 0 | 0 | 916.3 / 5414 |
| low | subway viaduct chase | 33.3 / 33.4 / 33.4 | 30.0 | – / 0 | 7.1 / 9.1 / 10.0 | 0 | 0 | 916.4 / 5425 |
| low | Broadview platform | 33.3 / 33.4 / 33.5 | 30.0 | – / 0 | 5.2 / 7.2 / 7.8 | 0 | 0 | 916.5 / 5436 |
| low | Broadview street | 33.3 / 33.4 / 33.4 | 30.0 | – / 0 | 7.0 / 8.5 / 9.1 | 0 | 0 | 917.5 / 5473 |
| low | after 40 subway cycles | 33.3 / 33.4 / 33.4 | 30.0 | – / 0 | 7.3 / 9.0 / 9.9 | 0 | 0 | 919.1 / 5492 |

For the low tier, "–" means the >20 ms count doesn't apply: every frame is paced at 33.3 ms by the 30 fps limiter. Renderer columns are from run 1; the other runs agree within 1.2 MiB. Per-run p95 is 33.4 ms for every high streetcar shot and 16.7–16.8 ms for high subway shots. The one exception is a 33.2 ms p95 in one viaduct-chase run.

The design specs give budgets as differences from a pre-feature build. No pre-feature build was measured, so the closest same-session comparison is riding against the nearby street without riding:

| Budget (spec) | Measurement | Result |
|---|---|---|
| Streetcar: ≤1 ms added median CPU for one rider | High: seat 8.1 ms and chase 8.4 ms, against 8.6 ms for the street reference and 8.3 ms after the exit. Low: 6.9 / 6.8 against 6.9 / 7.0 ms. | Within budget: riding adds no measurable CPU |
| Streetcar: no sustained frame-rate regression >5 % | Low is locked at 30 fps. High: the seat reaches 45.9 fps against 42.3 for the reference. The chase camera reaches 40.0 fps, 5.4 % below the reference and 9.5 % below the exit-street window, but it looks at a different scene along King St. | Seat is within budget. Chase is borderline and not filed as a regression; recheck on a quiet machine with a matched view. |
| Streetcar: no growing resources after 20 board/exit cycles | Control (150 frames without boarding): no change. First 20 cycles: +0 to +13 geometries (+0 to +4.9 MiB). Second 20 cycles: no change in any run or tier. Owned ledger stayed at 0. | Within budget: a bounded one-time warm-up, not monotonic |
| Streetcar: one resident detailed interior | Not instrumented | Unverified |
| Subway: ≤2 ms added median CPU during riding | High: viaduct seat 6.2 ms and chase 5.5 ms, against 6.9 ms on Broadview street. Station cells use 3.5–3.7 ms. Low: 7.0 / 7.1 against 7.0 ms. | Within budget |
| Subway: no sustained frame-rate regression >10 % against the same outdoor scene | High: viaduct 59.2 / 58.1 fps against 59.8 on the street (−1 % to −3 %). Low: all 30 fps. | Within budget |
| Subway: ≤25 MB compressed added on-demand assets | Station cells are procedural and built at startup; no network accounting | Not measured |
| Subway: retained resources across 20 return trips / unload cycles | The control showed no change. First 20 board/cancel cycles: +19 to +37 geometries (+1.3 to +1.6 MiB). Second 20: no change. A full subway session adds +10 programs and about 13 MiB of renderer estimate. These were board/cancel cycles plus one full trip per run, not 20 complete return trips. | Within budget for unload cycles; full return trips untested |

The few long animation frames (51–88 ms, five in total) and the 50–66 ms frame maxima fall in the first windows after boarding, alighting or exiting. They are one-off hitches, not sustained cost. No Long Task entries were recorded inside any window. The Long Animation Frame observer did record entries, which shows the instrumentation was live.

### Receipts

- In the repo, under [perf/idle-baseline-2026-10-29](perf/idle-baseline-2026-10-29/): `adoption-summary.json` and `transit-summary.json` (summarizer output, one row per run and shot, plus pools), `raw-metrics.tar.gz` (every aggregate `metrics.json` with raw samples, the 40-cycle lifecycle records and console logs) and `run-order.txt`. The host observations for each run (load, GPU utilization and capture output) are kept internally, not published here.
- On the laptop: per-shot JSON and PNG files are in `/Users/johnfewell/code/ride-anywhere-geo/review/gpu2/slop-toronto-adoption-metrics/` (`idle-*`, `transit-*-run*`).
