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
