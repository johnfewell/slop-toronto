# Perf pass: what applies from coo.mx's renderer and streaming

Bead `st-z51b`. John pasted an outside analysis of [coo.mx](https://coo.mx), a bounded, comic-style Toronto city game
with a stutter-free feel. It was written as advice for a different project (a photogrammetry rowing/cycling world), so
this pass checks each of its ideas against Slop Toronto's code and against measurements on the Mac mini. It is an
assessment, not a rewrite. One small fix that the census turned up is in its own draft PR (see
[The one fix taken](#the-one-fix-taken)).

**Measurement status: contended-functional.** Every number here comes from the shared Mac mini (Apple M4, Chromium
156, WebGPU on Metal) while the map-scale agent was also queueing captures on it. The two agents took turns through
gpu2's FIFO lock, so no capture overlapped another, but the machine was not idle and the CPU had the usual background
load (`docs/adoption-measurements.md`). Every comparison is paired: the base and the arm ran back to back in one lock
hold, the base again after it, with fresh browser loads. Read the numbers as relative and functional, not as budgets.

## Summary

**Status, 2026-11-05:** all six recommended changes have shipped (#101, #107–#111; see [Outcomes](#outcomes-shipped-one-at-a-time-johns-go-of-2026-11-04)), and the [uncapped frame rate](#uncapped-frame-rate-live-main-17f8b29-build-190dcbd57234) was measured on live main afterwards. The analysis below is as written before the changes, at 3fb0614.


- **No hitches; the stutter is sustained GPU load.** On a cold start, a fast drive, a 126 km/h flight down King St,
  rapid turns and an aerial flyover, no desktop frame took longer than one missed vsync (33.4 ms). There were no Long
  Tasks, no Long Animation Frames and no render pipeline built after the loading screen. The desktop frame sits just
  over 16.7 ms of GPU work (CPU 7–9 ms), so 13–41 % of frames miss a vsync. Every millisecond of GPU removed turns
  33 ms frames back into 17 ms ones. The phone tier held its 30 fps cap on every frame.
- **The shader warm-up coo.mx built a loading screen for, we already have** (`compileAsync` plus a warm-up frame).
  So the lessons that apply are about GPU cost per frame, not about scheduling.
- **The biggest GPU cost we found is trees.** Queen St W beside Trinity Bellwoods is the slowest view measured:
  26.2 ms (57 % missed), 11 M triangles. Hiding the trees takes it to a steady 60. The LOD crossfade's double-drawn
  bands cost about 2.9 ms there, and the trees' shadows about 2.3 ms.
- **Pixels are the next lever.** Rendering at 0.75 scale brings every city view to a steady 60; 1.5 adds 9–10 ms.
  MSAA 4× is the single most expensive full-screen setting at the Skyline view (20.2 → 16.7 ms without it). Volumetric
  clouds, the atmosphere, SSR and the shadows each cost 1–2 ms in the views where they matter.
- **One bug, fixed in a separate draft PR:** the flexi-posts and CaféTO patios were never culled. Fixing that saves
  0.42 M triangles and 0.4–0.6 ms everywhere.
- **What not to copy:** coo.mx's toon path drops volumetric clouds; ours are the look. Its huge merged batches were
  the problem here, not a solution. Streaming lessons go to the map-scale work.

## How it was measured

- **Builds.** `main` 3fb0614 built with `npm run build` and served from `dist/` (build `8290c9c9cb90`); the fix's build
  is `fc6401962656`. Desktop: high tier at 1600×900. Phone tier: `?quality=low` at a 412×915 touch viewport, DPR 1.
  This is the low tier's settings on the M4, not phone hardware.
- **Fixed settings.** `autoscale=0&transit=timetable&film&cloudSpeed=0&time=golden&mp=0` with `CAPTURE_SEED=6711`:
  the quality net held, timetable transit, clouds held still, golden hour, no multiplayer room.
- **Hitch route** (`tools/shots/perf-pass-route.json`), vsync-paced as shipped, with `?compilelog=1`. Five 10 s
  windows: the first 10 s after the loading screen (cold start), a boosted car drive east along Queen St W from Shaw,
  a camera flying east along King St W at 35 m/s (126 km/h) at eye height, rapid camera turns at King & Bay (3 rad/s,
  a full turn every 2.1 s), and an aerial flyover at 320 m moving 80 m/s. `tools/capture-hitches.js` attaches the Long
  Tasks, the Long Animation Frames with their scripts, and the compile log's shader builds, pipelines and buffer uploads
  that fall inside each window. Then a triangle census at three views.
- **Pass costs** (`tools/shots/perf-pass-views.json`): one setting changed per page load through the existing
  `?q.<key>=` profiling knobs, `?clouds=0`, `?atmosphere=0` and `?scale=`, interleaved with base loads
  (`tools/perf-pass-batch.sh`). Each load measures fixed camera views for 5 s each: King & Bay looking west (street),
  320 m above Wellington St (aerial), Queen St W at Trinity Bellwoods (trees), and the Skyline camera from the lake.
  The lake, the trees and three city-wide meshes are also hidden within a load, between two measurements of the same
  view. The measure is the frame interval with vsync on, as shipped: its mean, and the share of frames that missed a
  vsync. Every arm and base also loaded `?gputime=1` (three's timestamp queries), but on Metal those totals proved
  unusable (see [Pass costs](#pass-costs)).
- **Triangles**: a census hook counts every draw call's triangles for one frame (three's `info.update`, which counts
  instances and draw ranges), split into the main view, the sun's shadow cascades and the full-screen passes. It
  matches `renderer.info.render` to within the census's own six draws.

A first round of knockouts ran with vsync off (`CAPTURE_UNCAPPED=1`). Headless Chromium then paced frames in clusters
around 6, 13, 18 and 55 ms, so medians of the same view moved by up to 7 ms between identical base loads. Those runs
(`k1-*`) are kept but not used for any number below.

## Hitch profile

Desktop high, 1600×900, vsync-paced as shipped; two runs pooled (`r1-desk`, `r2-desk`, which agree within 0.1 ms of mean and 1 point of missed frames). Frame interval is the wall time between
rendered frames; CPU is the frame's simulation plus three's synchronous render submission.

| Window (10 s) | Frames | p50 / p95 / p99 / max (ms) | Mean | Missed a vsync (>20 ms) | >33 ms / >50 ms | CPU sim p50 / submit p50 (ms) |
|---|---:|---|---:|---:|---:|---|
| Cold start (first 10 s) | 1199 | 16.7 / 16.8 / 16.8 / 16.8 | 16.7 | 0 % | 0 / 0 | 1.2 / 5.9 |
| Car drive, Queen St W | 847 | 16.7 / 33.4 / 33.4 / 33.5 | 23.5 | 41 % | 0 / 0 | 1.5 / 7.1 |
| Fly along King St W, 35 m/s | 982 | 16.7 / 33.4 / 33.4 / 33.4 | 20.3 | 22 % | 0 / 0 | 1.5 / 6.7 |
| Rapid turns, King & Bay | 1063 | 16.7 / 33.3 / 33.4 / 33.4 | 18.8 | 13 % | 0 / 0 | 1.5 / 6.5 |
| Aerial flyover, 80 m/s | 961 | 16.7 / 33.4 / 33.4 / 33.5 | 20.8 | 25 % | 0 / 0 | 1.3 / 7.0 |

- **No hitches.** No frame on the route took over one missed vsync (33.4 ms max). There were no Long Tasks and no Long
  Animation Frames over 50 ms. The compile log recorded no render pipeline built after the loading screen. During the
  King St flight it recorded three node builds for tree shadow materials in each run (1.1–1.3 ms each: tree models
  that first reach the shadow pass mid-flight, which the warm-up frame could also cover), and 24–41 vertex buffer
  uploads per window, all under 0.4 MB and 0.1 ms. The rapid turns recorded nothing.
- **The stutter that does exist is sustained GPU load.** The desktop frame sits just above 16.7 ms of GPU work, so it
  alternates 16.7 and 33.4 ms frames: p95 is exactly one missed vsync. 13–41 % of frames miss, worst in the car's chase
  view on Queen St. The CPU side is 7–9 ms (simulation about 1.5 ms, render submission 6–7 ms), so the frame is
  GPU-bound. Every millisecond of GPU removed turns 33 ms frames back into 17 ms frames; nothing needs a hitch hunt.
- **Cold start.** The loading screen comes down after 13 s (`[init]`: street props 4.0 s, compile 2.2 s, warm-up
  frame 0.8 s, streetcars 1.0 s, traffic 0.9 s). The first 10 s after it held 16.7 ms on every frame in both runs (1,199 frames).
  The loading screen already absorbs the shader and pipeline work (see the shader compilation row).
- Phone tier, low at 412×915 (`rl1-low`): every frame of every window was 33.3–33.5 ms. The 30 fps cap held throughout, no frame missed its slot, and there were no Long Tasks. The CPU split was simulation 1.7–2.2 ms and render submission 4.8–5.1 ms per frame on the M4. The loading screen came down after 12.8 s.

## Pass costs

Each arm changes one setting per page load; its base is the mean of the base loads either side of it. **Frame mean** is
the mean frame interval with vsync on, and **missed** is the share of frames over 20 ms (a missed 60 Hz vsync). A pass
that takes the frame under 16.7 ms shows as 16.7 / 0 %, so a knockout's gain is capped there: the table says whether
a change brings the view to a steady 60, not its exact GPU milliseconds. The timestamp totals (`?gputime=1`) moved in
the same direction but summed to 60–170 ms per frame against a 17–26 ms frame, because Metal's pass intervals overlap.
They are recorded in the reports and not used here.

Desktop high, 1600×900, frame mean in ms (missed %). Each cell: its bracketing bases → the arm, ×pairs. Every arm and base loaded `?gputime=1`.

| Change | King & Bay | 320 m aerial | Skyline from the lake | Queen St W (trees) |
|---|---|---|---|---|
| Volumetric clouds off (`?clouds=0`) | 17.9 (7 %) → **16.7 (0 %)** ×2 | 20.0 (20 %) → **18.7 (12 %)** ×2 | 20.2 (21 %) → **17.9 (7 %)** ×2 | 26.3 (58 %) → **24.7 (48 %)** ×1 |
| Clouds at half resolution (`?q.cloudScale=0.5`) | 17.8 (7 %) → **17.1 (3 %)** ×2 | 19.9 (20 %) → **19.7 (18 %)** ×2 | 20.0 (20 %) → **19.0 (14 %)** ×2 | 26.3 (58 %) → **25.9 (55 %)** ×2 |
| Atmosphere and aerial perspective off (`?atmosphere=0`) | 17.9 (7 %) → **16.7 (0 %)** ×2 | 20.0 (20 %) → **17.8 (7 %)** ×2 | 20.2 (21 %) → **18.6 (12 %)** ×2 | 26.3 (58 %) → **24.2 (45 %)** ×1 |
| Sun shadows off (`?q.shadows=false`) | 17.9 (7 %) → **16.7 (0 %)** ×2 | 20.0 (20 %) → **18.5 (11 %)** ×2 | 20.2 (21 %) → **19.4 (17 %)** ×2 | 26.3 (58 %) → **22.8 (37 %)** ×1 |
| Shadow tiles 2048² (`?q.shadowTile=2048`) | 17.9 (7 %) → **17.0 (2 %)** ×2 | 19.9 (19 %) → **19.8 (19 %)** ×2 | 20.0 (20 %) → **19.9 (20 %)** ×2 | 26.4 (58 %) → **25.7 (54 %)** ×2 |
| Kerb shadows off (`?q.kerbShadows=false`) | 17.9 (7 %) → **16.7 (0 %)** ×2 | 19.9 (19 %) → **19.7 (18 %)** ×2 | 20.0 (20 %) → **19.9 (20 %)** ×2 | 26.4 (58 %) → **25.7 (54 %)** ×2 |
| SSR off (`?q.ssr=false`) | 17.9 (7 %) → **16.8 (1 %)** ×2 | 19.9 (20 %) → **19.1 (15 %)** ×2 | 20.2 (21 %) → **18.2 (9 %)** ×2 | 26.3 (58 %) → **25.2 (51 %)** ×1 |
| Bloom off (`?q.bloom=false`) | 17.9 (7 %) → **16.7 (0 %)** ×2 | 19.9 (20 %) → **19.2 (15 %)** ×2 | 20.2 (21 %) → **19.4 (17 %)** ×2 | 26.3 (58 %) → **25.6 (54 %)** ×1 |
| MSAA 4× off (`?q.aa=none`) | 17.9 (7 %) → **16.8 (1 %)** ×2 | 19.9 (20 %) → **18.1 (9 %)** ×2 | 20.2 (21 %) → **16.7 (0 %)** ×2 | 26.3 (58 %) → **24.8 (49 %)** ×1 |
| Render scale 0.75 (`?scale=0.75`, 0.81 MP) | 17.8 (7 %) → **16.7 (0 %)** ×2 | 19.9 (20 %) → **16.7 (0 %)** ×2 | 20.0 (20 %) → **16.7 (0 %)** ×2 | 26.3 (58 %) → **23.1 (39 %)** ×2 |
| Render scale 1.5 (`?scale=1.5`, 3.24 MP) | 17.8 (7 %) → **26.4 (58 %)** ×2 | 19.9 (20 %) → **29.7 (78 %)** ×2 | 20.0 (20 %) → **29.8 (79 %)** ×2 | 26.3 (58 %) → **36.0 (100 %)** ×2 |
| Posts, patios and pylons hidden (same load) | 17.9 (7 %) → **17.4 (4 %)** ×12 | – | – | – |
| Lake hidden (same load) | – | – | 20.1 (21 %) → **19.6 (18 %)** ×12 | – |
| Trees hidden (same load) | – | – | – | 26.3 (58 %) → **16.7 (0 %)** ×9 |

- **Biggest levers on the M4:** the cells above are each one setting changed on a GPU-bound frame. They are conditional marginals and do not add up. At King & Bay the frame is so close to 16.7 ms that any one of them gets it there. The views that separate them: MSAA is the most expensive full-screen setting at the Skyline view (−3.5 ms); trees dominate at Queen St W (−9.6 ms or more), and so do their shadows (all sun shadows off: −3.5 ms there). From the air, the atmosphere (−2.2 ms) and MSAA (−1.8 ms) lead. Clouds cost about 2.3 ms where the sky fills the frame, and half-resolution clouds keep a little under half of that. The frame scales with pixels: 0.75 scale fixes every city view, and 1.5 adds 9–10 ms. Bloom (−0.7 ms) and the lake (−0.5 ms) are small.
- **Phone tier:** on the M4 the low tier at 412×915 ran every view at a steady 60 fps (16.7 ms, 0 % missed) with the
  30 fps cap lifted. No knockout could move it, so the M4 cannot rank the phone's pass costs. Its CPU split was
  simulation about 1 ms and render submission 3–4.5 ms. Per-pass phone costs need the phone itself (`?fps=1&q.<key>=`
  on John's phone, as for the Pixel 8 measurements in `js/quality.js`).

## Triangles, against coo.mx's accounting

One frame, all passes, counted per draw call (instances and draw ranges included). The coo.mx figure was 8.6–8.9 M
triangles in 838–925 draws at about 2.73 MP.

| View (1600×900 = 1.44 MP) | Main view | Shadow cascades | Full-screen passes | Total |
|---|---|---|---|---|
| King & Bay, street level | 4.38 M, 460 draws | 1.25 M, 279 draws | 0.02 M, 22 draws | **5.64 M, 761 draws** |
| Richmond St W, street level | 4.66 M, 422 | 1.44 M, 313 | 0.02 M, 22 | **6.11 M, 757** |
| 320 m above Wellington St | 4.27 M, 359 | 1.19 M, 413 | 0.02 M, 22 | **5.49 M, 794** |
| Skyline camera, from the lake | 3.42 M, 422 | 0.62 M, 76 | 0.02 M, 22 | **4.06 M, 520** |
| Queen St W at Trinity Bellwoods | 8.18 M, 462 | 2.85 M, 291 | 0.02 M, 22 | **11.04 M, 775** |

- We draw fewer triangles than coo.mx in the city views at about half its pixels, and more at Trinity Bellwoods, where
  the park's trees alone are 5.0 M triangles in the view and 2.0 M in the shadow maps. Draw counts are similar.
- The shadow cascades are 0.6–2.9 M, 15–26 % of the total. The kerbs alone are 0.44 M of that at every view,
  because their merged meshes span the city and pass every cascade's frustum test. Removing them measured
  King & Bay 17.9 → 16.7 ms and Queen St W 26.4 → 25.7 ms (two pairs), with no change from the air or the lake.
- **View-independent meshes** were the useful find. The flexi-posts (319k), the patios (130k) and the TTC pylons (122k)
  drew the same count from the street, from the air and from the lake. The first two are fixed in the separate PR. The
  pylons are deliberately city-wide (`js/ttc-pylons.js:256`); chunking them for the frustum alone would drop most of
  their 122k without changing their reach.
- Phone tier, low at 412×915: 3.1–3.8 M triangles in 285–453 draws (main view 2.9–3.3 M, shadows 0.19–0.48 M) at 0.38 MP. The tier's shorter shadow and prop distances cut the shadow pass to a third and the main view by about a quarter.

## Evidence table

"What we do now" cites the code at `main` 3fb0614. Gains are on the M4 at 1600×900 unless stated.

| # | coo.mx idea | What we do now | Applies? | Measurement | Expected gain | Effort | Risk to the look |
|---|---|---|---|---|---|---|---|
| 1 | Count triangles across all passes, shadows included (8.6–8.9 M, 838–925 draws) | `renderer.info.render` already counts every pass per frame (shown by `?fps=1`, `js/quality.js:203-206`); the census hook in `tools/shots/perf-pass-*.json` splits it by pass and root | Yes, as a yardstick | 4.1–5.6 M triangles and 520–800 draws in the city views; 11.0 M at Trinity Bellwoods; 3.1–3.8 M on the phone tier | None by itself; it located the two problems below | Done | None |
| 2 | Staged streaming: fetch, decode, prepare, reveal; one shared frame budget; versioned, cancellable jobs | The whole city is built at startup (`js/main.js:98-371`); one massing worker (`js/buildings.js:62-91`); no per-frame budgets | Partly, for the map-scale work, not today's city | Not measured here (map-scale agent). Load is 13 s, 4.0 s of it street props | Hitch-free tile reveals when the map grows | L (map-scale) | None if reveals are warmed |
| 3 | Different representations near/mid/far, with complementary dithered crossfades | Buildings: boxes per facade material plus streamed close-up detail (`js/buildings.js:883-911`); `?massing=1` tiers at 600 m / 1.6 km pop (`js/buildings.js:180-197`, st-t3wr). Trees: near/mid/cards with a complementary dither in colour and shadow (`js/ez-trees.js:10-13`, `:34-37`) | Partly: trees already do it; massing is opt-in | Trees' crossfade bands (14/50/80 m, both levels drawn across each) cost 2.9 ms at Queen St W: `?lodfade=0` 26.2 → 23.3 ms, 2 pairs | Up to ~3 ms in tree-heavy views by narrowing the bands | S | Medium: shorter dissolves may read as pops; judge in motion |
| 4 | LOD distances measured to bounds, including height | Trees regroup by 200 m cells after 4 m of travel, by the camera's height band (`js/ez-trees.js:464-466`, `:513-521`); props cull by bounding sphere in 250–600 m cells (`js/scene-culling.js:264-306`) | Already in place | – | – | – | – |
| 5 | Static meshes with `matrixAutoUpdate` off | Big static roots frozen and the scene walked once a frame (`js/main.js:363-368`, `:1544`, `:1563`) | No: already done | `scene.updateMatrixWorld()` 0.08 ms a frame; the largest unfrozen root 0.015 ms | < 0.1 ms CPU | S | None |
| 6 | Byte-packed normals and colours; shared materials and texture arrays | Massing uses 16-byte vertices (st-2nl.3); elsewhere float attributes. Instanced meshes share materials per kind | Partly: memory, not frame time | Not measured; the frame is GPU-bound on pixels, not bandwidth of vertex fetch | Memory only | M | None |
| 7 | Huge merged batches cut draws but weaken culling | Small props chunked into culling cells (`js/scene-culling.js:16-21`); but BikePosts, CafeTOPatios and TtcPylons sat outside the culling roots, and the kerbs are city-wide merges | Yes, as a warning: it was our bug | Posts 319k, patios 130k, pylons 122k triangles drawn from every view; kerbs 0.44 M in the shadow pass from every view. Fix (#101): −0.42 M triangles, −0.4 to −0.6 ms at all 4 views, 3 pairs. Kerb shadows off: King & Bay 17.9 → 16.7 ms, Queen W −0.7 ms (two pairs) | 0.4–0.6 ms everywhere (done); about another 0.5–1 ms for the pylons and kerb casters | S | Low: posts beyond 110 m stop drawing |
| 8 | Texture lifecycle: bounded residency, controlled uploads, compressed formats | Everything resident; no KTX2 (searched); the sign atlas is uploaded once (`js/storefront-signs.js:66-70`, `:171-177`); the phone tiers drop CPU copies after the first frame (`js/scene-culling.js:607-650`, `js/main.js:1588-1600`) | Partly: matters for the bigger map and for phone memory, not for frame time | Renderer estimate about 2.0 GB of textures on high, 0.7 GB on low (`docs/adoption-measurements.md`); no upload over 0.4 MB in play on the route | Memory headroom on phones | M–L | Low |
| 9 | Compile shaders behind the loading screen, exercising the real passes | One `compileAsync` over the scene, a shadow receiver first, station interiors on layer 2 (`js/main.js:1272-1348`), then a warm-up frame with frustum culling off for the shadow passes (`js/main.js:1547-1563`); `?compilelog=1` logs anything built later | No: already done | Compile 2.2 s, warm-up 0.8 s of the 13 s load; on the route, 0 pipelines and 3 tree shadow node builds (1.1–1.3 ms) after the loading screen, 0 Long Tasks | – | – | – |
| 10 | A gate that skips a draw until its new pipeline has compiled | None needed today | No (yes later, for streamed tiles) | Nothing compiles in play | – | M | Delayed appearance |
| 11 | Shadow cascades: count, size, refresh cadence; a separate skyline map | Two cascades in one atlas, 3072² each on high, 2048 medium, 1024 low; far 300–720 m by altitude; both re-rendered every frame on every tier (`js/lighting.js:306-321`, `:440-448`; `shadowEvery` 1, `js/quality.js:129`) | Partly | Shadows off: King & Bay 17.9 → 16.7, aerial 19.9 → 18.5, Skyline 20.2 → 19.4 ms; Queen St W 26.3 → 22.8 (mostly the trees'). 2048² tiles: King & Bay 17.9 → 17.0, others within 0.1–0.7 ms (two pairs) | ≤1.4 ms; refreshing the far cascade every 2nd frame might save about half | M (subclass SunShadowNode: a cleared viewport per cascade, frozen matrices) | Low–medium: lag in far shadows when the sun or camera moves |
| 12 | Simplified shadow hulls; caster distance separate from visual distance | Shadow stand-ins in 500 m cells for big casters and opt-ins (`js/scene-culling.js:308-477`); trees' mid shadows only within 130 m (`js/ez-trees.js:23`), people within 34 m, fire escapes 115 m, highway cars LOD 0 | Yes, mostly in place; trees are the outlier | Tree shadows off (in-session): Queen St W 26.2 → 23.9 ms; near trees put 1.1 M and mid trees 0.85 M triangles into the cascades. Mid-tree shadows within 65 m instead of 130 m (`?treeshadow=65`): Queen St W 26.2 → 25.2 ms (one pair), with the mid trees' shadow triangles going from 0.85 M to 0.09 M | 1–2 ms in tree-heavy views | S | Medium: tree shade on the street |
| 13 | The default look skips expensive passes (no volumetric clouds, no painterly filter) | Volumetric clouds at the library's medium preset and full resolution on high (`js/sky-clouds.js:97-102`), takram atmosphere and aerial perspective on by default (`js/sky-clouds.js:9`, `:29-33`), SSR (`js/main.js:420-437`), bloom, PBR lake water | Partly: measure, don't drop | Clouds off: Skyline 20.2 → 17.9, aerial 20.0 → 18.7 ms. Atmosphere off: aerial 20.0 → 17.8, Skyline 20.2 → 18.6. SSR off: Skyline 20.2 → 18.2. Bloom off: −0.7 to −0.8 ms. Lake hidden: Skyline 20.1 → 19.6 | See half-res rows | – | High if dropped: they are the look |
| 14 | Half-resolution expensive passes; half-float scene target | SSR at 0.5 (`js/main.js:429`), bloom at 0.5 (`js/post-processing.js:37`), the scene pass HalfFloat (three's `PassNode` default); clouds at 1.0 on high, 0.75 medium, 0.5 low (`js/quality.js:29`, `:69`, `:78`) | Yes, for the clouds on high | `q.cloudScale=0.5` on high: Skyline 20.0 → 19.0 ms, a little under half of the clouds' whole cost; King & Bay 17.8 → 17.1 (two pairs) | ~1 ms where the sky is in view | S | Low–medium: softer cloud edges against towers |
| 15 | Quality tiers: max pixel ratio, MSAA samples | Render scale 1 of CSS pixels on every tier, i.e. DPR 1 (`js/main.js:76`); MSAA 4× on high and medium, FXAA on low (`js/quality.js:25`, `:69`, `:78`); the safety net has no rungs on high and never changes resolution (`js/quality.js:151-153`) | Yes | Scale 0.75: every city view to 16.7 ms (0 % missed), Queen W 26.3 → 23.1; scale 1.5: +9–10 ms. MSAA off: Skyline 20.2 → 16.7, aerial 19.9 → 18.1, King & Bay 17.9 → 16.8 | 2–4 ms (AA); up to 3 ms on demand (resolution) | S–M | Medium: edges and softness |
| 16 | Traffic on a fixed 30 Hz tick, extrapolated between ticks | Variable-step update every frame, dt clamped to 50 ms (`js/main.js:1474`, `:1489-1497`); per-vehicle work every frame (`js/traffic.js:3571-3583`); instanced draws with CPU frustum tests | No | Whole simulation 1.2–1.5 ms per frame on desktop, 1.7–2.2 ms on the phone tier (all systems) | < 1 ms CPU on a GPU-bound frame | M | Low |
| 17 | Pedestrian pose LOD by distance (every frame / 2nd / 3rd / off-screen 6th) | GPU-skinned crowd, one instanced draw per LOD (`js/pedestrians.js:1004-1018`); hidden people within 50 m advance their gait but skip the bone solve, beyond that skip the rig (`js/traffic.js:3282-3303`) | No | Included in the 1.2–2.2 ms above | Negligible | M | Low |
| 18 | Trees, props, vehicles and birds instanced or batched | All instanced (`js/ez-trees.js:289-293`, `js/traffic.js:434-449`, `js/parked-cars.js`) | Already in place | Draws 520–800 a frame; CPU render submission 6–7 ms | – | – | – |
| 19 | Independent detail policies for rendering, animation, AI, collision and shadows | Separate distances already: traffic retire radii (`js/traffic.js:96-98`), streetcar draw/obstacle radii (`js/streetcars.js:37-38`), tree/people/car shadow cut-offs above | Already in place | – | – | – | – |
| 20 | Camera smoothing with `alpha = 1 − exp(−dt/τ)`, speed-dependent chase and FOV | Chase cameras use `1 − exp(−dt·8.5)` (τ ≈ 0.12 s) and a speed pull-back with τ ≈ 0.33 s (`js/cameras.js:226-235`, `:395`, `:404`); controllers use `min(1, dt·k)` lerps (`js/controllers.js:1342`, `:1417`, `:1513-1516`); fixed FOV; no camera collision | Partly: feel, not frame time | Not measured; the `min(1, dt·k)` lerps differ from exponential by up to ~25 % at 30 fps (k = 14, 33 ms) | Feel on the 30 fps phone tier | S | Low |
| 21 | Frame-gap p50/p95/p99, frames over 33/50 ms, uploads, long tasks, GPU timings | `?metrics=1` frame distributions and CPU split (`js/measurements.js`), `?gputime=1`, `?cputime=1`, `?compilelog=1`, `tools/capture-longtasks.js`, `tools/metrics-summary.mjs`; this pass adds `tools/capture-hitches.js` (LoAF scripts, compile log and GPU timestamps per window) | Yes, done | This document | – | Done | – |

## Top 5

Ranked by measured gain against effort and risk to the look. All the numbers are desktop high on the M4 at
1600×900, vsync-paced: mean frame interval in ms, with the share of frames that missed a vsync in brackets.

1. **Trees: pay less for the ones nobody sees.** At Queen St W beside Trinity Bellwoods, trees cost the whole gap to
   60 fps: hiding them takes 26.2 ms (57 %) to 16.7 (0 %). Yet only a few street trees are in the frame. The park's
   trees stand behind the buildings, and their mid mesh alone is 3.9 M triangles in the view, plus 2.0 M in the
   shadow cascades. Three measured levers:
   - The crossfade bands draw both levels across 14/50/80 m. The hard swap (`?lodfade=0`) measured 23.3 ms, two
     pairs, so narrower bands recover part of that 2.9 ms.
   - Tree shadows cost 2.3 ms there (all tree casting off: 23.9). Halving the mid trees' shadow reach to 65 m (`?treeshadow=65`) measured 25.2 ms (one pair). The near trees' 1.1 M shadow triangles are most of the rest.
   - The mid level reaches 320 m; beyond it the trees become crown cards. At 180 m (`?q.treeMid=180`, the low tier's value), Queen St W measured 23.6–23.8 ms (two pairs, 42 % missed), and the mid trees' triangles fell from 3.9 M to 1.8 M. Hiding the trees' shadows on top of that gave 21.3 ms.

   **Change:** narrow `BAND` in `js/ez-trees.js:36` (for example 14/50/80 → 8/24/40 m). At street level (camera under
   40 m, which the code already tracks as `low`), hand the mid level over sooner. **Verify:** the `t-queen-west`
   pairs in `tools/shots/perf-pass-trees.json`, plus a High Park and Toronto Island view. The dissolve must be judged in
   motion: record a drive past Trinity Bellwoods and a walk in High Park before and after.
   **Expected:** 2–4 ms in park-side views. **Effort:** S. **Risk:** medium, because a shorter dissolve can read as a pop.
2. **Finish the city-wide mesh clean-up.** Merge draft PR #101 (posts and patios culled as written): 0.42 M
   triangles and 0.4–0.6 ms at all four views, three pairs, every fix run faster than every base run. Then:
   - Chunk `TtcPylons` for the frustum only (122k triangles from every view).
   - Cut the kerb shadow casters into cells, so each cascade culls them. Today it is 0.44 M triangles in the shadow
     pass from every view. Dropping kerb shadows entirely took King & Bay 17.9 → 16.7 ms and Queen W 26.4 → 25.7 (two pairs).

   **Verify:** the census (`census-*` shots) shows the pylons and kerbs changing with the view, and the `cc-*`-style
   pairs. **Effort:** S. **Risk:** low.
3. **Desktop anti-aliasing: MSAA 4× is the most expensive full-screen setting.** Without it: Skyline 20.2 → 16.7 ms
   (21 % → 0 %), aerial 19.9 → 18.1, King & Bay 17.9 → 16.8 (two pairs; Queen St W 26.3 → 24.8, one pair). WebGPU offers only 1 or 4 samples, so
   coo.mx's 2× isn't available. **Change:** try SMAA (`three/addons/tsl/display/SMAANode.js`) or the low tier's FXAA
   on high in place of MSAA. Or keep MSAA and let the safety net (item 5) drop it under load. **Verify:** paired runs
   at these views, plus 2× crops of the overhead wires, flexi-posts and tower edges for crawl in motion. **Effort:** S–M,
   because the water's mid-pass frame copy relies on the stored multisampled colour (`js/main.js:394`). **Risk:**
   medium on thin lines.
4. **Clouds at a lower resolution on high.** Clouds cost 2.3 ms at the Skyline view (off: 20.2 → 17.9).
   `?q.cloudScale=0.5` keeps a little under half of that saving: 20.0 → 19.0 ms (two pairs). King & Bay went 17.8 → 17.1. **Change:**
   `cloudScale` 1 → 0.75 (medium's) or 0.5 on high, `js/quality.js:29`; the library upscales temporally. **Verify:**
   Skyline and aerial pairs at golden and midday, with side-by-side frames of cloud edges against the towers.
   **Effort:** S. **Risk:** low–medium, a softer cloud edge.
5. **Give desktop high a resolution rung in the safety net.** Today high has no net at all (`js/quality.js:151-153`).
   Render scale 0.75 brought every city view to a steady 60 (Queen W 26.3 → 23.1), and 1.5 adds 9–10 ms, so the
   frame scales with pixels. coo.mx's tiers cap the pixel ratio for the same reason; ours already render at CSS
   pixels, so the next step is dynamic. **Change:** for high, a rung at 0.85 then 0.75 entered only after sustained
   slow windows, as the medium and low nets do with distances. The resize reallocates every full-screen target, which
   crashed the Pixel 8; check that on desktops first. **Verify:** `?autoscale=1` runs on the drive route, a count of
   rung changes, and frames at each rung. **Effort:** M. **Risk:** medium, a softer image while it is engaged.

Not in the top 5:
- The shadows' far-cascade refresh cadence (coo.mx's 1/2/3/6 frames). Both cascades re-render every frame. All sun
  shadows cost 0.8–1.5 ms in the city views (3.5 ms at Queen St W, mostly the trees', which item 1 covers), so a
  half-rate far cascade is worth well under 1 ms. It needs a `SunShadowNode` subclass
  that clears one viewport and freezes that cascade's matrices.
- The atmosphere's 2 ms from the air (aerial perspective is the look).

## Doesn't apply: what not to copy

- **The toon path's dropped passes.** coo.mx's default mode turns volumetric clouds and the painterly filter off. Our
  volumetric clouds, the takram atmosphere and the golden-hour grade are the look John chose. They cost 1–2.3 ms each
  where they matter (clouds at the Skyline view, the atmosphere from the air). Make them cheaper (half-res clouds, below)
  rather than drop them. Its ink outline and AO are passes we don't have and shouldn't add for speed.
- **Huge merged batches.** coo.mx merges far geometry into 1024 m blocks to save draws, and its own analysis notes
  that this weakens culling. Here, city-wide single meshes were the bug. The posts, patios and pylons drew 570k
  triangles from everywhere, and the kerbs' city-wide merges put 0.44 M triangles into every shadow cascade from every
  view. We are GPU-bound with 7–9 ms of CPU, so draws are not our constraint: keep the culling cells (and fix the
  outliers) rather than merge further.
- **MSAA 2×.** coo.mx's medium tier uses 2 samples. WebGPU allows only 1 or 4, so our choice is 4× or a post-process AA.
- **A pixel-ratio cap.** We already render at CSS pixels, a device pixel ratio of 1 on every tier (`js/main.js:76`,
  `js/quality.js:24`). That is below coo.mx's medium cap of 1.5; a Retina laptop draws a quarter of its native pixels.
- **A 30 Hz traffic tick with extrapolation, or pose LOD for the crowd.** The whole simulation is 1–2 ms of CPU per frame
  on the M4, against 6–7 ms of render submission and a GPU-bound frame. Pedestrians already skip the bone solve when
  hidden (`js/traffic.js:3292`), and only near people cast shadows (34 m, `js/pedestrians.js:1004`). A fixed tick would
  add interpolation code and save nothing measurable here. Revisit only if a CPU-bound phone shows simulation in its
  profile.
- **Freezing more static transforms** (`matrixAutoUpdate = false`). The big static roots are already frozen
  (`js/main.js:363-368`) and the scene walk runs once a frame (`js/main.js:1544`, `:1563`). The whole
  `scene.updateMatrixWorld()` measured 0.08 ms a frame.
- **A shader-compile gate in play** (skip a draw until its pipeline is ready). Nothing compiles in play on our route, so
  there is nothing to gate. It belongs to streamed tiles (see below), not to today's city.
- **Byte-packed normals and colours, compressed sign atlases**: these save memory, not frame time, for a bounded city
  whose textures are uploaded once. They matter for map-scale residency, not here.

## For the map-scale work (streaming)

Not measured here; tiled streaming is the map-scale agent's job (`docs/map-scale-measurements.md` on `exp/map-scale`).
Today the whole city is built at startup (`js/main.js:98-371`): street props alone take 4.0 s of the 13 s load. Only the
massing cells use a worker (`js/buildings.js:62-91`). Nothing streams except the building close-up detail
(`js/buildings.js:979`), the parked-car cells and the lazily built pedestrian routes. The coo.mx ideas that should feed
that work:

1. **Separate the stages**: fetch, decode, build geometry and collision in a worker, create GPU resources, compile,
   then reveal. Keep the coarser representation drawn until the new tile is ready, then swap on a frame that builds
   nothing (the threejs-lod-culling-perf skill's warm-then-reveal pattern).
2. **Compile before reveal.** Our loading-screen `compileAsync` (`js/main.js:1272-1348`) and warm-up frame
   (`js/main.js:1547-1563`) cover a city that exists at startup. A streamed tile's new materials, and every new
   InstancedMesh (three's render-object cache key includes the mesh), will not be warmed. Warm them hidden
   (`count = 0` or off-screen) and include a shadow-map pass before reveal. Keep `?compilelog=1` as the check that
   the reveal frame builds nothing.
3. **One shared frame budget** for every subsystem's main-thread integration, not one budget each that add up. Track
   integration time separately from the GPU upload, which costs at the next submit, not where the JS ran.
4. **Versioned, cancellable jobs prioritised by distance**, and bounded residency (CPU data, GPU buffers, textures,
   pending jobs). Our city has no texture or geometry eviction today; the renderer's own estimate is about 2.0 GB of
   textures on high and 0.7 GB on low (`docs/adoption-measurements.md`). A bigger map needs explicit caps.
5. **Shadow casters are part of the tile.** The shadow stand-ins (`js/scene-culling.js:308-477`) are built once for
   the whole city in 500 m cells. Streamed tiles need their stand-ins built with them and released with them.

## The one fix taken

Draft PR #101 (branch `exp/perf-cull-city-wide`): the flexi-posts and the CaféTO patios join the culling roots
they were written for. It saves 0.42–0.44 M main-pass triangles at every view, 0.4–0.6 ms of mean frame interval
and 2–3 points of missed vsyncs at all four views (three interleaved pairs; every fix run beat every base run).
On the phone tier it removes 0.41 M main-pass triangles at every view, 12–14 % of that tier's main pass (two pairs;
the M4 runs that tier at 60 fps either way). Posts beyond their authored 110 m cull distance stop drawing; John to
judge the Richmond crop.

## Outcomes (shipped one at a time, John's go of 2026-11-04)

| # | Change | PR | Merge | Measured on the M4 mini (paired) | Status |
|---|---|---|---|---|---|
| 1 | Cull the flexi-posts and CaféTO patios as written | #101 | 0b3271d | −0.42 M main-pass triangles at every view; −0.4 to −0.6 ms mean frame, 3 pairs | Live (build 497af6796200) |
| 2 | Cull the TTC pylons by view; cut masked shadow casters (the kerbs) into 1 km cells | #107 | 6faf7a6 | −0.55 to −0.64 M triangles at every view (kerbs in the shadow pass 438k → 58–93k; pylons 122k → 14–61k), +32–64 draws; −0.3 to −0.8 ms mean frame, 3 pairs; pixel parity at six views within the base-vs-base control | Live (build ff7fffdf8304) |
| 3 | SMAA in place of MSAA 4× on high | #108 | aed4e5a | Skyline 20.3 → 16.7 ms, aerial 19.9 → 18.5, Richmond 19.0 → 18.3, Queen W 26.3 → 25.2; FXAA 0.1–0.25 ms cheaper but breaks the overhead wires and smears the CN Tower's edge | Live (build 97b181902f3c) |
| 4 | Volumetric clouds at 0.75 on high | #109 | 7b133a8 | 0.4–0.8 ms where the sky is in view; 0.5 only 0.2–0.3 ms more and visibly softer | Live (build 7ec7bec437f0) |
| 5 | Desktop high: x0.75 render scale while frames run long | #110 | a8610d7 | Queen W 25.7 → 24.0 ms over the window, drive 23.3 → 19.7–20.9; recovers at King & Bay; 3 steps per run, no frame over 34 ms; on the merged build a 4 s hold after each resize keeps the slow seconds after stepping up from stepping straight back down; each resolution change costs one 50–67 ms frame | Live (build d4a1e9432b04) |
| 6 | Tree LOD: bands 8/24/40 m, mid trees to 180 m from street level, mid shadows 65 m | #111 | 17f8b29 | Queen W 25.8 → 21.7 ms (55 → 30 % missed), 10.7 → 7.5 M triangles, 3 pairs | Live (build 190dcbd57234), after John reviewed the drive video |

## Uncapped frame rate (live main 17f8b29, build 190dcbd57234)

How fast the game runs without the 60 fps vsync cap. This was measured on 2026-11-05 on the Mac mini (Apple M4) in **headed** Chromium 156 (a real window on the mini's desktop, `CAPTURE_HEADED=1`), with `--disable-gpu-vsync --disable-frame-rate-limit` (`CAPTURE_UNCAPPED=1`).

**Settings:**
- Dynamic resolution is off (`?autoscale=0`) for desktop high, which is otherwise as shipped (SMAA, clouds at 0.75). The ×0.75 column forces `?scale=0.75`.
- The phone tier ran at 412×915 with its 30 fps cap lifted (`?q.maxFps=0`).
- Golden hour, clouds held still, timetable transit, no multiplayer.

**Method:**
- Each view: 3 s of warm-up, then 20 s of measurement.
- 3 runs per view and tier, interleaved high, ×0.75, phone, then again.
- Each cell is the median fps across the runs, with min–max, and the mean frame interval.
- fps is frames over measured time, from rAF intervals. In most views 86–99 % of frames came in under 16.6 ms, so the frames really are faster than 60.
- The mini was shared, so these are functional numbers, not budgets.

| View | Desktop high, 1600×900 | Desktop high ×0.75 (1200×675) | Phone tier, 412×915, cap lifted |
|---|---|---|---|
| King & Bay street | 72 fps (72–72), 13.8 ms ×3 | 90 fps (89–91), 11.1 ms ×3 | 170 fps (169–170), 5.9 ms ×3 |
| Queen St W at Trinity Bellwoods | 55 fps (55–55), 18.2 ms ×3 | 68 fps (67–68), 14.7 ms ×3 | 120 fps (120–120), 8.3 ms ×3 |
| Skyline | 85 fps (85–85), 11.8 ms ×3 | 99 fps (99–99), 10.1 ms ×3 | 177 fps (177–177), 5.6 ms ×3 |
| Core aerial (320 m) | 67 fps (66–67), 15.0 ms ×3 | 85 fps (85–85), 11.8 ms ×3 | 176 fps (175–176), 5.7 ms ×3 |
| High aerial (900 m) | 75 fps (74–75), 13.3 ms ×3 | 90 fps (89–90), 11.2 ms ×3 | 170 fps (169–171), 5.9 ms ×3 |
| High Park woods walk | 49 fps (49–49), 20.3 ms ×3 | 61 fps (61–61), 16.5 ms ×3 | 134 fps (133–134), 7.5 ms ×3 |
| Toronto Island walk | 58 fps (58–59), 17.1 ms ×3 | 69 fps (69–69), 14.4 ms ×3 | 139 fps (139–139), 7.2 ms ×3 |

**Reading it:**
- **Headed runs are reliable.** The vsync-off headless runs earlier in this pass clustered at 6, 13, 18 and 55 ms. Headed, the same view repeats within about 1 fps across runs, so the GPU timestamps (which overlap on Metal) weren't needed as a ceiling.
- **The woods walks and Queen St W are the only desktop views under 60:** High Park 49 fps, Queen St W 55, the Island 58. These are the frames the dynamic-resolution rung exists for: at ×0.75 they reach 61, 68 and 69 fps.
- **The city views have 12–40 % headroom** over 60 at full resolution, and the Skyline view the most.
- **The phone tier's settings run at 120–177 fps on the M4.** That says nothing about a phone GPU, but its frame (5.4–8.3 ms) is close to the CPU's simulation plus render submission, so on the M4 that tier is CPU-bound.

**Can a player see the uncapped rate?**
- **Not from the page.** A page can't lift the browser's vsync. `requestAnimationFrame` runs at the display's rate, so a 120 Hz display (ProMotion) already runs the game up to 120 fps; the high tier has no frame cap.
- **To see more:** start Chrome with `--disable-gpu-vsync --disable-frame-rate-limit`. On macOS, quit Chrome first, then run `open -a "Google Chrome" --args --disable-gpu-vsync --disable-frame-rate-limit`.
- **Readouts:** both the `?fps=1` readout (fps and ms from wall-clock frame times, the tier, the canvas size, draws and triangles) and the help panel's fps counter then show the uncapped rate.
- **Headroom under vsync (st-olaf, shipped):** the `?fps=1` readout's second line is `late N% (>16.7 ms, 5 s)  step x1.00`.
  - `late` is the share of the last 5 s of frames that took longer than a 60 Hz frame, with 1 ms of slack for the pacing's jitter. Paced at 60 Hz, a frame that misses shows as 33 ms, so 0 % means every frame fit. A few percent means the machine is at the edge, and more means the 60 isn't holding.
  - `step` is desktop high's resolution step: x0.75 while the safety net has the frame at 0.75. It reads `held` under `?autoscale=0`.
  - A `?uncapped=1` URL switch can't work, because the cap is the browser's.

Receipts: `$GPU2_REVIEW_DIR/slop-toronto-r3-desk/uc-r{1,2,3}-{high,h075,low}-u-*.metrics.json` and frames; `tools/shots/perf-pass-uncapped.json`; the view sheet `perf-pass-artifacts/uncapped/uncapped-views-desktop.jpg`.

## Follow-up: the High Park woods walk (st-usbd, 2026-11-05)

The woods walk was the slowest desktop view uncapped: 49 fps at full resolution. Measured on the M4 mini, desktop high
at 1600x900, headed Chromium with vsync and the frame-rate limit off, golden hour, clouds held still.

**Where the time went.** These are in-page knockouts at a parked point on the walk (45 m in), base 20.6 ms (48.6 fps).
Each cell is the frame time saved by switching one thing off in the same load. These are conditional marginals, so
they don't add up.

| Knocked out | Saved (ms) | Notes |
|---|---:|---|
| All trees | 11.6 | 8.6 ms at a second point, 15 m in |
| Mid trees (decimated EZ-Tree meshes, 30-134 m in the woods) | 6.0 | 3.2 at the first point; ~480 mid trees, 1.6 M triangles, drawn all round the camera |
| Crown cards (beyond 134 m) | 2.8 | ~12,100 cards, 0.9 M triangles, all round the camera |
| Near trees (within 30 m) | 1.7 | 27 trees, 0.55 M triangles |
| The trees' shadow casting | 1.8 | 2.5 at the first point |
| All sun shadows | 3.6 | |
| Volumetric clouds | 1.6 | |
| Atmosphere and aerial perspective | ~1.2 | |
| SSR | 0.6 | |
| The woods floor (terrain hidden) | ~0 | |

The tree meshes are never frustum-culled (`ez-trees.js`: the per-tree levels pick by distance only). So the mid trees
and cards behind the camera were transformed every frame, and the alpha-tested leaves were shaded in whatever order
the 200 m cells happened to come in.

**What changed (`js/ez-trees.js`, identical frames):**
- **A view cone for the levels that cast no shadow.** These are the mid mesh beyond its shadow distance and the crown
  cards. They draw only the cells inside a cone round the camera frustum. The cone is the cone round the frustum's
  corners plus 0.5 rad, and each cell's sphere is grown by 25 m for the crowns. It is re-cut after the camera turns
  by 0.3 rad, moves 4 m or zooms. Shadow casters still draw all round, so no shadow changes. `?treecull=0` turns it off.
- **Front to back.** Each level's instances go into their mesh nearest first, using a counting sort in 4 m steps.
  The leaves of the trees behind then fail the depth test before their alpha-tested shading, not after it.
  `?treesort=0` turns it off.

**Result.** On today's map, frames per 20 s, three interleaved runs, base = main 6cd4295:

| View | Base | Cone only | Cone + front to back | fps base -> after |
|---|---|---|---|---|
| High Park woods walk | 970 / 975 / 974 | 1014 / 1015 / 1013 | 1130 / 1131 / 1134 | 48.7 -> 56.6 |
| Toronto Island walk | 1154 / 1156 / 1159 | 1187 / 1182 / 1174 | 1200 / 1214 / 1203 | 57.8 -> 60.3 |
| Queen St W at Trinity Bellwoods | 1106 / 1095 / 1091 | 1166 / 1177 / 1160 | 1173 / 1180 / 1174 | 54.8 -> 58.8 |
| King & Bay | 1428 / 1425 / 1414 | 1457 / 1460 / 1450 | 1478 / 1462 / 1443 | 71.3 -> 73.0 |

- **On the Eglinton map** (desktops' default since #119), against main 6e24e5a, 2 base and 3 after runs, frames per 20 s:

  | View | Base | After | fps |
  |---|---|---|---|
  | High Park woods walk | 924 / 930 | 1061 / 1062 / 1062 | 46.4 -> 53.1 |
  | Toronto Island walk | 1101 / 1090 | 1129 / 1126 / 1133 | 54.8 -> 56.5 |
  | Queen St W | 1010 / 1015 | 1078 / 1090 / 1086 | 50.6 -> 54.3 |
  | King & Bay | 1251 / 1264 | 1216 / 1296 / 1293 | 62.9 -> 64.7 |

- **Frames.** At six views, the new build differs from main by no more than main differs from itself. The views are
  two woods points, the woods looking back, the Island walk, the High Park aerial and Queen St W, at golden hour,
  midday and on the phone tier. The remaining differences are cloud and leaf-edge noise.
- **Turns.** Rapid turns in the woods (3 rad/s, vsync as shipped) re-cut the cone about 9 times a second, at
  0.7-1.4 ms of CPU per regroup. No frame went over 33.4 ms, against 33.4 ms on main, and the window ran 467 frames
  against main's 429.

**Not done; it would change the look:** the woods' mid trees handing over to the cards nearer than 134 m (the mid
level is still the largest single cost), or the near trees' shadows reaching less far.

Receipts: `$GPU2_REVIEW_DIR/slop-toronto-r3-desk/` `k2-*` (tree knockouts), `kp2-*` (pass knockouts), `ws1-3-*`
(the A/B), `wp-*`, `ws-*`, `wf*` (frames), `wt*`/`wts-*` (turns), `wm*` (the Eglinton-map A/B and frames), `qk-*` (quick shots); `tools/shots/woods-knockouts.json`,
`woods-static.json`, `woods-parity.json`, `woods-turns.json`, `uncapped-walks.json`, `film-woods.json`.

## Receipts

- Crops, sheets and the tree videos for John: `$GPU2_REVIEW_DIR/slop-toronto-r3-desk/perf-pass-artifacts/` (aa, clouds, cull, dynres, trees, ship).
- Mini outputs: `$GPU2_REVIEW_DIR/slop-toronto-r3-desk/`. `r1-desk-*` and `r2-desk-*` are the desktop route,
  `rl1-low-*` is the phone-tier route, `m1-*` to `m4-*` are the desktop knockouts, `m5-*` and `m6-*` the tree arms (m5 runs 4–6
  excluded: another process loaded the mini mid-run and `capture.mjs` flagged them contended), `n1-*` is the phone-tier
  knockouts, `cc-*` and `cl-*` are the fix A/B, and `k1-*` and `cd-*` are the discarded uncapped round. Each window
  has a `.metrics.json` (raw samples, hitch attribution, GPU timestamps) and a `.png`.
- Tools, on this branch: `tools/capture-hitches.js` (init script: Long Animation Frames with their scripts, the
  compile log and GPU timestamps per window), `tools/perf-pass-batch.sh` (several arms in one gpu2 lock, optionally
  from different build folders), per-shot `metricsMs` / `metricsWarmupMs` in `tools/capture.mjs`, and
  `tools/shots/perf-pass-route.json`, `perf-pass-views.json`, `perf-pass-trees.json` and `perf-pass-cull.json`.
- Command shape (desktop knockouts; the phone tier adds `CAPTURE_VIEWPORT=412x915 CAPTURE_MOBILE=1` and
  `quality=low&q.maxFps=0`):

  ```sh
  GPU2_LOCK_WAIT=1800 gpu2 slop-toronto-r3-desk -- env CAPTURE_ROOT=dist CAPTURE_PORT=8831 CAPTURE_CDN_CACHE=1 \
    CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_IDLE_CHECK=1 CAPTURE_SEED=6711 CAPTURE_INIT_SCRIPT=tools/capture-hitches.js \
    CAPTURE_METRICS_MS=5000 CAPTURE_METRICS_WARMUP_MS=1500 bash tools/perf-pass-batch.sh tools/shots/perf-pass-views.json \
    'm1-01-base=?quality=high&autoscale=0&transit=timetable&film&cloudSpeed=0&time=golden&mp=0&gputime=1' \
    'm1-02-clouds0=?quality=high&autoscale=0&transit=timetable&film&cloudSpeed=0&time=golden&mp=0&gputime=1&clouds=0' ...
  ```

