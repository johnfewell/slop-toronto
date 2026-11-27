# Where the frame and the start-up go in the heaviest views (2026-11-26)

John asked for the top costs in the three heaviest views, fixes for them, and a paired result for each fix. Epic st-aeg2
(desktop frame rate, including st-aeg2.4 the ground) and st-tw6z (start-up bytes). Earlier work this builds on:
`docs/park-detail-loading.md` (st-nz3v), the st-aeg2 census (`~/.cache/slop-toronto/ntm/reports/st-perf1.md`) and
the st-vky3 load evidence.

## Method and what every number is

- Machine: the Mac mini (Apple M4) through `gpu2-local`, headless Chromium, 1600x900, device pixel ratio 1, uncapped
  frames (`CAPTURE_UNCAPPED=1`), `autoscale=0`, midday. The mini is shared: its load average was 3 to 5 during these
  runs (other agents' captures ran between mine; a load figure from before and after each run is in
  `~/.cache/slop-toronto/perf-heavy/`). Frame times are relative evidence, not budgets.
- Date: the scenes are captured on **26 November** with `liveDate=2026-11-26&liveClock=2026-11-26T17:00:00Z` and no season
  preset, so the trees are bare. (My first runs used the probe's own midday preset without the live clock and showed summer
  foliage; those are labelled "summer date" and only kept where a paired result was measured on them.)
- Probe: `tools/perf1/lib.js` (in-page; the same renderer wrapper as the st-aeg2 census) with three new places, run by
  `tools/perf1/make.mjs` jobs `disc` (draw calls and triangles by pass, frame time, CPU split), `arms` (a thing switched off,
  three alternating rounds, base frame measured on both sides), `ft` (every frame's interval for 20 s) and
  `groundmats` (ground meshes by material). Paired builds: `tools/perf1/ab.sh`.
- Frame time is the mean frame interval over a window. **GPU time per pass is not measurable here**: `?gputime=1`
  timestamp queries again gave sums far beyond the frame (about 100 to 270 ms per frame), as the st-aeg2 census found. The
  split by pass below is therefore by removal: each pass or group is switched off and the frame measured with it off
  ("saves X ms"). Those savings are marginal and not additive.
- "CPU" below is the page's own measurement: simulation CPU per frame, and renderer submission CPU, which includes time
  the main thread waits on the GPU process (`writeBuffer`, `setVertexBuffer`, `createCommandEncoder`), so it is not all work.
- Builds: baseline main 161462b (build b4620d2fe8e1) and, for the `ft`/`disc` runs, the same tree plus start-up marks (build
  75e857701a40, db485a3ed8cb). After the first fix: main f7365c4 (build 3555f9fbd18e).

## Views

| Short name | Page | Camera |
|---|---|---|
| High Park woods | default page (`?map=eglinton`), 26 Nov | on foot in the densest woods, -6240, -2350, looking NE (`hpw`); and from 70 m (`hpa`) |
| Downtown street / aerial | `?map=detail` | King and Bay street level (`fin`); 300 m above (`fin300`) |
| Eglinton street | default page | Eglinton Avenue at Yonge, looking east (`egl`) |

## Frame: top three costs per view (baseline main, 1600x900, mean ms, 26 Nov unless noted)

Frame, draw calls and triangles per frame (all passes, `disc` run), and what a frame is made of:

| View | Frame ms | sim CPU | draws, triangles (main / sun shadow far / near) | nothing drawn |
|---|---|---|---|---|
| High Park woods | 21.3 | 1.5 | 634 and 5.65 M / 192 and 0.77 M / 99 and 0.60 M | 4.0 |
| High Park from 70 m | 18.4 | 1.5 | 472 and 4.45 M / 192 and 0.44 M / 79 and 0.21 M | |
| Eglinton street | 15.5 to 16.5 | 1.7 | 408 and 3.27 M / 250 and 0.80 M / 191 and 0.66 M | 4.1 |
| Downtown street | 13.4 | 1.7 | 501 and 3.49 M / 264 and 0.53 M / 167 and 0.34 M | 3.9 |
| Downtown aerial 300 m | 18.1 | 1.9 | 454 and 3.30 M / 400 and 0.83 M / 105 and 0.30 M | 3.6 |

(Draw calls and triangles are corrected to one count per frame: the stars sprite is a second render through the main
camera and no longer counts as a frame in the probe.) CPU: simulation 1.5 to 1.9 ms a frame everywhere; hiding the
traffic simulation saves 0.3 to 0.7 ms; the rest of the 11 to 19 ms submission figure is the main thread waiting on the GPU
(`writeBuffer` 4.5 to 8.5 ms at High Park, `createCommandEncoder` 2 to 3.5 ms).

Savings by removal (ms the frame gets shorter when this is switched off; spread over three rounds in brackets):

| View | 1st | 2nd | 3rd |
|---|---|---|---|
| High Park woods (21.3) | **Trees 5.1** (spread 7, so 4 to 5; the near large oak model alone 1.75) | **Sun shadows 3.2 to 5.0** (nat. measure 21.3 to 16.9; far cascade 2.0; shadow cost split: shadow proxies 2.5, ground 2.2, buildings 2.2, street props 2.0, signals 2.0, street details 1.9, trees 1.1) | **Ground 2.2** (High Park lawns 1.0), then clouds, SSR and bloom together 2.6 |
| Eglinton street (15.5) | **Ground 4.7** (its merged bands 3.6, walkways 0.5) | **Sun shadows 3.6** (ground 2.0, street props 1.8, proxies 1.8, signals 1.7, buildings 1.6) | **Buildings 2.0**, then clouds, SSR, bloom 2.0 |
| Downtown street (13.4, summer date) | **Buildings 2.0** | **Clouds, SSR and bloom 1.8** | **Sun shadows 1.6** (ground 1.3) |
| Downtown aerial (18.2, summer date) | **Ground 5.3** | **Sun shadows 2.9** | **Clouds, SSR, bloom 2.0** (buildings 2.0) |

Reading: render scale 0.5 saves 4.1 to 5.9 ms, so only about a quarter of the frame depends on resolution; the rest is
geometry, shadow passes and per-draw cost. Under all of it a frame with nothing drawn is 3.6 to 4.1 ms (the sky, clouds
and post chain). Charts, one per view: `baseline-hpw.png`,
`baseline-egl.png`, `baseline-fin.png`, `baseline-fin300.png` (every frame's interval for 20 s on main).

The ground is the largest single item in the two views where it is large (Eglinton street, the aerial), and it is not
about triangles: the ground draws 0.37 to 0.65 M triangles in 7 to 15 big meshes with road-cut masks and a heavy asphalt
fragment shader (`groundmats` job: `js/tsl-materials.js` `createRoadSurfaceMaterial`, wear and puddles), under
`CityGroundBand` and the whole-city street-level mesh.

## Start-up: top three costs (time to ready, split by the page's own phases)

Time to ready on the mini, three loads each, the default pages with `liveDate=2026-11-26&liveClock=...`, from the
`tools/load-timing.mjs` plan `tools/load-plans-heavy.json` (HTTP/2 over TLS with brotli, fresh browser, performance.now() when
`__CITY_APP.ready` first reads true):

| Setting | Ready | Requests | Transferred |
|---|---|---|---|
| Desktop 1600x900, Eglinton page, no network limit | 26.5 s (26.5 to 29.6) | 294 | 26.3 MB |
| Desktop, `?map=detail`, no limit | 12.1 s | 271 | 21.2 MB |
| Phone low tier (412x915 at x2.625), 4x CPU throttle, no limit | 43.4 s | 269 | 21.0 MB |
| Desktop, Eglinton page, 150 ms RTT, 1.6/0.75 Mbps | 128.1 s | 272 | 19.7 MB |
| Phone low tier, 4x CPU, same slow link | 111.4 s | 247 | 14.5 MB |

Phases from the page's `[init]` line (ms; Eglinton desktop, phone low tier in brackets): compile shaders 9,750 (3,230),
city ground 4,410 (2,840), landmarks 2,600 (900), street details 3,000 (3,050), traffic 2,700 (2,130), trees 1,880
(1,050), streetcar layer 2,160 (1,000, with buses 900, rail corridor 710, subway 280), park cover 1,340 (380), the Don
valley 1,220 (430), culling 1,060 (1,800), warm-up frame 2,330 (1,180). These add up to more than the measured ready time on
the desktop (about 39 s against 26 s): I did not find why, so use them as relative sizes only.

Top three: **(1) compiling the shaders and render pipelines** (9.8 s of the 26.5 s on desktop Eglinton; 3.2 s of 43 s on the phone
tier, where the CPU throttle is the cost elsewhere); **(2) the ground build** (4.4 s desktop, 2.8 s phone; st-wa52 is the
open bead for caching its mask); **(3) the streetcar and transit layer** (2.2 s streetcars plus 0.9 s buses on Eglinton).
On a slow link the order changes: ready is gated by bytes and by the order the build asks for them. The 14.5 MB the phone
fetches are: scripts and data 5.6 MB (geodata 2.2, scripts 3.3), the 11 tree models 5.5 MB (asked for only when the build
reaches the trees, at about 46 s on that link, and then 33 s of download), the cloud shape 2.0 MB, the ROM model 6.1 MB,
weather 0.7 MB. Per-asset records of every request (start, end, bytes) are in the `all` field of
`$GPU2_REVIEW_DIR/heavyperf/hv-load-base-results.json`.

## Fixes

| PR | What | Result (paired, mini, relative) | Status |
|---|---|---|---|
| #211 | Ground masks run only inside their footprint boxes (`guardedInside`; the earlier st-aeg2.4 branch, merged with main and re-measured) | High Park woods 21.3 to 19.8 ms (-1.56; 4 of 4 pairs), Eglinton street 15.8 to 14.6 (-1.17), downtown aerial 18.1 to 15.1 (-2.99, 4 of 4), downtown street 13.5 to 12.9 (-0.47; one pair -0.02). Draw calls and triangles unchanged; the only pixel differences are moving traffic and people. | merged f7365c4, live version 2d31320d-11b2-4893-ada6-7313c70843c2 |
| #212 | Fetch the ROM model's 6.1 MB after the city is ready | ready on the slow link: desktop Eglinton 128.1 to 119.0 s (-9.1), phone 111.4 to 106.2 s (-5.1); fast link phone 41.0 to 40.1 s. **Costs a 0.3 to 0.4 s stall just after ready** (longest frame 324 and 427 ms against 112 and 130), because the collider outline is built from the 6 MB mesh in one go. | open, not merged: a trade-off for John |

Charts: `after-ground-hpw.png` and `after-ground-egl.png` (before and after, frame intervals over 20 s, p50 21.3 to 19.7 and
15.7 to 14.8 ms), `rom-hitch-overlay.png` in John's `slop-toronto-updates/2026-11-26-perf/` folder.

Also tried and dropped: asking for the 11 tree models at low priority from the page head (`<link rel="preload"
as="fetch" fetchpriority="low">`): -2.2 s on the phone link and -1.5 s on desktop, but the scripts then finish 25 s later.

## What is left, in order

1. **The ground, still the largest item**: Eglinton street 4.7 ms before the fix (its merged bands 3.6 ms), 5.3 ms in the
   aerial; the road shader's wear, puddle and crack channels run per fragment over the whole street surface. A cheaper
   shader beyond about 60 m (`surfaceWear` 1 there), or a baked road-detail texture, would change how far roads look worn; it
   needs a before/after look. Measure `surfaceWear` 1 against 2 (quality.js) first.
2. **Trees in the woods**: 4 to 5 ms at High Park, 1.75 of it the near large oak (22k triangles each).
3. **Sun shadows**: 3 to 5 ms in the woods and on Eglinton; the cost does not follow triangles, so a cache of near-static
   casters across frames is the route.
4. **Start-up**: build the ROM collider outline in slices so #212 has no stall; start the tree models' fetch when the page
   starts (a long-link win of 20 to 30 s if the scripts are not slowed); the compile phase (st-vky3 and `compileAsync` are
   already serialised for correctness).
5. Not done: the downtown winter ablation (the downtown rows above are summer date), a per-system CPU profile, and a repeat
   of these on a quiet mini.

## Later the same day: what shipped and what did not pay

Shipped: #212 (ROM model fetched after ready, warmed a mesh a frame, collider built a stage a frame, swap into the built collider cells; live 3f51720c-c727-4d96-b4e3-49e90c979cf0, main 123803d; paired 3 rounds, no frame from it over 45 ms) and #232 (High Park woods: full-detail trees within 0.35 of the near distance, not 0.55; -0.8 ms on foot at 26 Nov, -0.64 in July, none from 70 m; live 483aeeef-543d-4f93-aa64-866fdae9268f, main ae74324; before and after frames in John's `slop-toronto-updates/2026-11-26-perf/` folder, `woods-near-*.png`). `?woodsnear=0.55` brings the old share back.

Not shipped, measured (Mac mini, relative, 26 Nov):
- **The road shader's wear is not the ground's cost.** Ground, main f7365c4 or later: hiding it saves 3.5 to 4.8 ms at the Eglinton street, and giving every ground mesh a flat unlit material saves 3.2 to 4.1 of that (a flat lit, shadow-receiving material saves the same, so lighting and shadow lookups are not it; making ground meshes stop receiving shadows saves nothing; removing the road-cut mask saves 0 at Eglinton and 0.8 from 300 m). Inside the asphalt shader, paired reload A/B at Eglinton: `q.surfaceWear=1` -0.58 ms, `=0` -0.87, no clear coat (`coat=0`) -0.09, and bisecting the nodes (`?roadx=`, a working switch not merged): sky ambient occlusion -0.36, colour -0.22, roughness -0.11, normal map 0, clear coat and SSR 0.06. At High Park `surfaceWear=1` is 0.0. They add up to under 1 ms, so the rest of the ground's 3 to 4 ms is in something the flat material also removes: the other ground materials (sidewalks, kerbs, lawns) or ground layers stacked over each other and shaded more than once. Next step: a per-mesh flat test by material, and an overdraw view.
- **Sun shadows drawn less often do not pay.** Skipping the far cascade every 2nd or 4th frame, or the near one every 2nd, changed the frame by -0.2 to +0.1 ms (noise); `QUALITY.shadowEvery = 2` for both cascades made it 1.4 to 1.7 ms slower. Caching static casters across frames is therefore not worth building on this evidence.

Probe additions in `tools/perf1`: `groundx` (flat, lit-flat, hidden, no-mask, no-receive arms per mesh set), `shadowfreq`, `ft`, `groundmats`, and `ab.sh` takes `ROOTA` and `ROOTB`.
