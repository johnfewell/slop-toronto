# Browser photo capture spike

28 October 2026 · `st-wt0.3` (M0a)

**Decision:** use held-canvas JPEG export (path A) for the first photo implementation. Select **128 independently rendered cold-settling samples** for the tested golden-hour skyline. Both quality tiers pass the export and repeated-allocation checks. This closes the capture experiment; visitor ownership, restoration, album and sharing remain subsequent work. The idle-performance gate remains open.

## Implementation and controls

`__CITY_APP.film.renderHeld()` renders without calling the world simulation. It holds shared TSL time/delta through `js/capture-clock.js`, keeps cloud physical time fixed, advances cloud sampling, and waits for a fresh browser animation frame before rendering. The ordinary exploration loop gains no GPU-completion waits. The existing film `step()` still advances simulation normally.

Stopping the application's animation callback alone did not freeze the renderer's shared shader clock. Water and trees use that clock. Also, several fast low-tier renders within one browser frame skipped FRAME node updates. Earlier diagnostic runs exposed those defects and are excluded from acceptance. The final runner checks actual renderer frame IDs: **512 distinct frames per 512 samples**, cloud ordinals 0–511, constant simulation/shader/cloud time, and a second cold reset at the same ordinal. Both final reset comparisons have **zero lossless RGB difference**. Each run also shows a nonzero first-sample/late-sample difference, so the measurement detects settling.

The pinned [Three.js timer](https://github.com/mrdoob/three.js/blob/e27dfa95ae7f453b5d7a9a36ffdb563f7c9b529b/src/nodes/utils/Timer.js) and [internal animation loop](https://github.com/mrdoob/three.js/blob/e27dfa95ae7f453b5d7a9a36ffdb563f7c9b529b/src/renderers/common/Animation.js) explain why a null application callback leaves shader time advancing. The clock helper restores the real update callbacks even after a rendering exception; an actual-TSL CPU test covers this.

## Final-image result

Apple M4 Mini, Metal WebGPU, Chromium 156.0.8078.4; high/MSAA at 1600×900 and low/FXAA at 412×915 (`outputColorTransform=false`). Each method exports 20 JPEGs per tier at quality 0.88.

| Tier / method | Image screens passed | Maximum RGB mean error / p95 channel error |
|---|---:|---:|
| High / held canvas | 20/20 | 1.853 / 7 |
| High / explicit target | 20/20 | 1.874 / 7 |
| Low / held canvas | 20/20 | 1.405 / 5 |
| Low / explicit target | 20/20 | 1.455 / 5 |

Errors use decoded 8-bit RGB codes, not HDR or perceptual error. The fixed JPEG screen is nonblack fraction >5%, mean error ≤4 and p95 channel error ≤12. Images were also inspected visually: orientation, city/cloud content and color are correct, with no HUD. There are no page, GPU-validation or stale-cloud-frame errors; existing Three TempNode deprecation warnings remain in the receipts.

Path A's DevTools reference follows its encoded canvas without another city render. Path B uses a canvas-size RGBA8 target with no second output color conversion, asynchronous readback and a 2D encoding canvas. Its on-screen reference is the next held-scene sample after restoring the output target. That comparison includes a sampling difference and does **not** certify exact-ordinal pixel equivalence for B. A is selected for its direct reference and simpler allocation lifetime; B remains an investigated alternative, not a universally certified fallback.

## Settling policy

The cloud Bayer cycle is 16 frames and the bundled jitter volume is 64 slices. Compare ordinals separated by 256 to match both phases, rather than treat changing sample noise as convergence drift. Fixed regions are the top 35% (sky) and bottom 30% (water) of this fixture. The settling screen requires whole-frame mean ≤0.5/p95 ≤2, sky mean ≤1/p95 ≤4, and water mean ≤0.1/p95 ≤1. These are experiment thresholds, not a proof of infinite-sample convergence.

| Early → later sample | High whole-frame mean / sky p95 | High screen | Low whole-frame mean / sky p95 | Low screen |
|---|---:|---|---:|---|
| 24 → 280 | 0.815 / 12 | Fail | 0.283 / 3 | Pass |
| 90 → 346 | 0.360 / 5 | Fail | 0.135 / 1 | Pass |
| 128 → 384 | 0.219 / 3 | Pass | 0.089 / 1 | Pass |
| 256 → 512 | 0.050 / 1 | Pass | 0.020 / 0 | Pass |

128 is the smallest tested common passing bound. At 128, water comparison error is zero on both tiers. The lifecycle JPEG runs follow the 512-sample control; the 128-sample choice derives from lossless checkpoint comparisons and must be exercised in M1's actual visitor flow. The current diagnostic loop awaits GPU completion per sample: 128 samples took **4,253.7 ms high / 2,365.2 ms low**, excluding checkpoint screenshot overhead. Production transcription was active, so these are contended functional observations. The former three-second target is **not established**. M0b/M1 must validate a wall timeout and other authored views/time presets against the idle baseline; do not silently substitute 24 or 90 samples or claim the current diagnostic loop meets that target.

## Lifetime and timing evidence

Every cycle returned to zero owned entries/known bytes. Each tier recorded 60 explicit allocations and 60 releases for the target path. Renderer memory fields were identical across the 20 post-cleanup snapshots within each method. First target use adds a stable two-uniform-buffer renderer cache: 688 reported bytes high, 112 low. Geometry, texture, render-target and readback-buffer counts return to baseline. These are accounting observations, not whole-device VRAM measurements.

The target path peaks at 11,520,000 known CPU / 5,760,000 known GPU bytes high and 3,015,840 / 1,507,920 low. The ledger explicitly leaves browser-managed canvas/readback GPU backing unknown. Encoder internals, diagnostic PNG decoding and transport strings are outside that estimate; **the complete 64 MiB photo budget is not certified**.

| Tier / method | Synchronous render median | Queue/read wait median | Encoding wall median | Whole capture median / p95 |
|---|---:|---:|---:|---:|
| High / canvas | 6.35 ms | 19.95 ms | 13.30 ms | 49.75 / 54.90 ms |
| High / target | 6.55 ms | 19.70 ms | 12.25 ms | 50.45 / 83.50 ms |
| Low / canvas | 4.65 ms | 9.55 ms | 4.90 ms | 34.05 / 46.20 ms |
| Low / target | 4.80 ms | 10.25 ms | 5.95 ms | 35.60 / 53.30 ms |

Whole capture includes waiting for a fresh browser frame and excludes FileReader transport to the runner. Queue/read and encoding durations are wall times, not exclusive GPU execution or main-thread CPU measurements. Methods ran sequentially, not as a randomized performance comparison. No performance budget is passed by this table.

## Receipts and remaining acceptance

The versioned raw reports are kept with the internal research captures, not published here. Both served app builds are `f8c7ef17b28b`: main `e2a4aca4ef98…`, cloud wrapper `bdf554cbbca2…`, shader clock `a7a5ee4857ee…`, measurements `a2de94b9244f…`, cloud bundle `8ade1946424a…`; the browser import map pins Three.js `e27dfa95…`. Each report includes full hashes, runtime settings, per-cycle counters, sample states and runner hash. Low boot was retried after a 30-second page-load timeout; the successful retry uses a 120-second load timeout against the same app build.

All JPEGs, lossless references, checkpoints and diagnostic attempts remain in `/Users/johnfewell/code/ride-anywhere-geo/review/gpu2/slop-toronto-photo-spike/`. Reproduce with the `gpu2` lock, `CAPTURE_ROOT=dist PHOTO_TAG=phase-matched PHOTO_SETTLE_FRAMES=512 PHOTO_TIER=high PHOTO_REPEATS=20 node tools/check-photo-capture.mjs`, then low. The tool refuses to run outside `gpu2`.

Validation: 193 tests, 180 pass, the same 13 baseline failures by name; 12 targeted clock/measurement/loader/cache tests pass; production build and syntax/diff checks pass. See [measurement protocol](adoption-measurements.md). Idle evidence remains `st-wt0.2.2`, coordinated with `st-oiw`.

This experiment covers one golden-hour skyline on Mini Chromium. M0b still implements activity/overlay ownership, full camera restoration, live-response holding, input cancellation and environment-only changes. M1 must test other compositions, interior seats, lifecycle failures, resizing and supported real devices. Download/album/share/UI are not implemented by this spike.
