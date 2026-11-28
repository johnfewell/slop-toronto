# Start-up load: what the page fetches, what gates "ready", what changed (28 November 2026, st-tw6z)

The page is ready (the loading screen goes, the player can move) when the city is built and its first frame has been through
the GPU. On the Mac mini that is the "first frame" mark plus 0.7 s, so the two numbers below move together; "playable" is "ready".
Both come from `performance.mark('init:firstFrame')` and `init:gpu`, which `js/main.js` now sets in `markInit`.

## Method

- Tool: `tools/load-timing.mjs` with the plans `tools/load-plans-startup.json` (one build) and
  `tools/load-plans-startup-abcd.json` (four builds, interleaved: A, B, C, D, then the next round). The Mac mini (Apple M4) through
  `gpu2-local`, headless Chromium, 1600x900 (the phone profile: 412x915 at x2.625, `quality=low`, 4x CPU throttle), `liveDate=2026-11-26`,
  a fresh browser for every run.
- The test server is the site as Cloudflare serves it: `dist/_headers` decide `Cache-Control` (so `/assets/*` is `no-cache`, `/js/*`, `/css/*`
  and `/data/*` immutable), every response has an ETag and answers `If-None-Match` with 304, HTTP/2 over TLS, and only text, JS, CSS, JSON,
  SVG and wasm are brotli'd. **`.glb`, `.bin` and `.png` go out as they are** (checked on sloptoronto.ca: no `content-encoding`). The browser trusts the
  test certificate by its key hash (`--ignore-certificate-errors-spki-list`): with an ignored certificate error Chrome does not keep
  responses in its HTTP cache, so no warm run was possible until that was changed.
- Warm: one full load fills a persistent browser profile, the browser closes, and a second load from that profile is measured (a returning visitor).
- Links: "fast" no limit; "mid" 25 Mbps down, 60 ms round trip; "slow" 1.6 / 0.75 Mbps, 150 ms (the st-vky3 link).
- Every request's start, end, transfer size and decoded size is in each run's record (`all`); the waterfall below is read from it.
- The mini is shared. Runs of one round are the four builds back to back; the slow-link runs repeat to within 0.5 s of each other, so a gap of
  several seconds there is not noise. The fast-link gaps (under 0.5 s) are inside the noise.
- Builds: A = main `fabca4c` (build `15101683a9b3`, plus the two timing marks); B = A plus the early downloads; C = B plus one file per tree
  species; D = C plus the cloud textures after the models (build `ba533c59f1c3`).

## What the page does at start-up (desktop, default page, fast link, main `fabca4c`)

20.7 MB over 305 requests: scripts 4.7 MB (brotli), data files 9.2 MB (the city database 5.36 MB, the cloud shape 2.1 MB, the massing boxes 0.88 MB, the Rosedale
houses 0.57 MB), `.glb` models 5.9 MB (the 11 tree models 5.3 MB), images 0.95 MB. The phone profile fetches 14.9 MB (the detail map's city database is 2.24 MB).

**On a fast link ready is the build, not the download.** 26.5 s ready, in the page's own phases: shaders compile 3.8 s and warm-up 1.2 s, city grid 2.8 s,
blocks 3.3 s, street details 2.9 s, traffic 2.1 s, culling 2.0 s, streetcars 1.0 s, buses 1.0 s, trees 1.2 s, landmarks 0.9 s. A warm start (everything in the HTTP cache,
0.01 MB over the wire) is ready at 26.1 s: the bytes cost 0.3 s on a fast link. Nothing in the fetches pays there; the CPU phases are the cost
(and are another agent's: the compile is st-z1g5, the ground is st-wa52, the crossings st-1pxn).

**On a slow link ready is the bytes, in an order the build sets.** The city database (5.36 MB) alone takes 52 s with the scripts beside it; the build cannot
start before it is in, and each asset after it (the massing boxes, the trees, the street props, the cloud textures) is asked for when the build reaches it. On the slow desktop run
the tree models were asked for at 78 s and arrived at 104 s, the cloud textures went from 58 s to 81 s, and ready came at 123 s. Every megabyte not downloaded
before the build's last wait is 5 to 8 s.

## What changed

| Change | What | Slow desktop | Slow phone | Mid desktop | Fast |
|---|---|---|---|---|---|
| Early downloads | The start-up `.glb` files (trees, street props, bike share, park sign, TTC pylons, the CN Tower, the beach chairs) are asked for when the app starts (`js/early-models.js`, `earlyModels.want` in each module, `start()` at the top of `initApp`), not when the build reaches them; the module takes the bytes with `parseAsync` | -1.3 s | **-10.4 s** | -0.7 s | none |
| One file per tree species | `assets/trees`: 4 files instead of 11; each species' sizes in one file with its leaf atlas once (`tools/merge-tree-models.mjs`): 1.27 MB (24%) less | **-9.5 s** | -2.4 s | -0.5 s | none |
| Cloud textures after the models | The four cloud textures (2.8 MB: they gate nothing, the sky fills in when they arrive) are asked for once the start-up models are in (`sky-clouds.js`, `earlyModels.settled()`) | **-6.4 s** | **-7.9 s** | -0.1 s | none |
| **All three** | | **123.1 to 105.9 s (-17.2 s, 14%)** | **106.9 to 86.3 s (-20.7 s, 19%)** | 32.2 to 31.0 s (-1.2 s) | desktop 27.6 to 26.5 s (runs 26.3 to 28.1 s: inside the noise); phone 40.1 to 40.0 s |

(Medians; slow desktop 3 rounds, slow phone 4, mid desktop 4, fast desktop and phone 3. Warm, fast link: desktop 26.15 to 26.10 s, phone 39.7 to 39.9 s: nothing, as the bytes are not the cost there. Time to first frame is the ready time less 0.7 to 0.9 s in every run.) Bytes over the wire: desktop 20.7 to 19.4 MB, phone 14.9 to 13.6 MB.

The early downloads do nothing for the slow desktop because the link is full from the first second to the last; they help the phone
because its build (4x slower CPU) reaches the trees at 46 s, long after the link has gone idle for lack of requests.

### Tried and not shipped

- **Cloud textures at low fetch priority** (`fetch(url, { priority: 'low' })`, handed on as blob URLs): no change at all (121.96 s against 122.2 s). The test server's HTTP/2
  does not honour priorities, so this could not be shown either way here; Cloudflare does, but a claim that cannot be measured is not shipped. The version that waits
  for the models is measured, and works on any server.
- **Compressing the data**: the city database is already gzip'd inside; brotli level 11 of the same bytes is 4.90 MB against 5.36 MB (9%), not worth a decoder. The `.glb` models are
  already meshopt-compressed (gzip 0.8 of that); the `.bin` and `.png` files do not compress at the edge (Cloudflare skips them), the cloud shape would be 1.64 MB gzip'd (2.1 MB now).
- **Immutable caching for `/assets/*`** (they are `no-cache`, so a returning visitor revalidates about 60 files with 304s): the warm start-up on a fast link is within 0.3 s of cold, so
  it would save a round trip or two. It needs every reference to carry a content hash (the names are built in code: `./assets/trees/${id}.glb`); not done.

### What is left

- The fast-link start-up is 26 to 27 s of CPU: the shader compile (3.8 s) and warm-up, the ground and city grid (2.8 + 3.3 s), street details (2.9 s), traffic (2.1 s), the transit layer
  (streetcars, buses, rail, subway: 2.5 s together), culling (2.0 s). The transit layer and traffic are not needed to draw the first frame, but they share colliders,
  the traffic network and the audio with the rest of the build in `js/main.js`; deferring them past the first frame is a project of its own (compare the ROM model's, st-tw6z / PR 212).
- The city database (5.36 MB on the default page) gates the whole build on a slow link and is the largest single file; streaming it by region would be the next byte win.
- `rosedale-houses.bin` (0.57 MB) and the massing boxes (0.88 MB) are fetched at the top and needed at the build's `blocks` phase.
- A pre-existing hitch: at the downtown street, about 20 to 25 s after the city is ready, three or four frames of 100 to 150 ms in a row. It is in the build before this work
  as well (5 of 8 runs of main `fabca4c`, 13 of 14 of the builds with this work, with `?earlyModels=0&cloudsFirst=1` too: the difference is inside what 22 runs on a shared mini can show), and it is not a pipeline compile (the compile log after ready is empty). Unexplained.

## Frame time

Downtown street and High Park woods (`tools/shots/load-frame-times.json`), 20 s of frame intervals each, three rounds, before (main) and after, same mini, alternating:
p50 downtown 15.6 to 15.8 ms before and 15.5 to 15.7 after; High Park 17.1 to 17.2 before and 17.1 to 17.3 after (one before round at 18.8, mini load). p95 and p99 the same except the
hitch above. The charts: `docs/images/load-time-frame-downtown.png`, `load-time-frame-highpark.png`, `load-time-frame-downtown-hitch-in-before.png`.
Both views were also captured with the live date (26 November, bare trees): the species files draw the same trees (`tools/shots/load-stills.json`).

## After the deploy: the live site, cold (28 November, Mac mini, its own connection to Cloudflare)

`tools/load-plans-live.json` (`liveOrigin`: the real site, a fresh browser each run), version `a8f64fdd-47eb-4e67-b406-dd4173f2c8b2`, build `e68eeec8ccb4`.
Ready, three runs each: desktop 34.7, 29.8 and 30.2 s (20.2 MB over 280 requests, 0.8 MB of it three.js from jsDelivr); phone profile 43.4, 42.0 and 43.6 s (14.4 to 14.6 MB);
desktop on the 25 Mbps / 60 ms link 32.0, 31.5 and 31.7 s. The pages ask for the four tree species files and none of the old eleven. These are not set beside the earlier
tables: the live site also loads three.js, fonts, analytics and the live feeds, and was not measured before the deploy. The first desktop run was 4 to 5 s slower than the others
(not looked into). On a fast link the deploy changes little, as above.

## Reproduce

```sh
npm run build && cp -R dist .load/a        # then change something and build into .load/b ...
GPU2_LOCK_WAIT=3600 gpu2-local <name> -- env CAPTURE_PORT=<port> LOAD_ONLY=desk-slow-cold LOAD_ROUNDS=1 LOAD_TAG=<tag> \
  node tools/load-timing.mjs tools/load-plans-startup-abcd.json     # edit the plan's arms
```

`LOAD_ONLY` is a setting's name (or a name prefix), `LOAD_ROUNDS` the number of rounds, `LOAD_TAG` the results file's name. The record of every run has `marks`
(`init:firstFrame`, `init:gpu`, ...), `all` (every request: name, start, end, transfer, initiator, decoded, encoded) and a picture of the page 4 s after ready.

## Start-up CPU: where the 26 s go (28 November 2026, jf-xgi, jf-2vn)

The fast-link start-up is CPU on one thread. This section says which steps it is, whether each is needed for the first view, what could move, and what was cut.

### Profile method

- `tools/load-timing.mjs` with `profile: true` in a setting runs the V8 sampling profiler (CDP `Profiler`, 0.5 ms) from the navigation to ready and writes
  `<tag>-<setting>-r<round>-<arm>.cpuprofile`; `tools/cpuprofile-summary.mjs <profile> <results.json> <setting> <round> <arm> [--min <ms>] [--top <n>]` prints each of the
  page's own `[init]` phases (they are performance marks, so the profile is cut at them) with the main thread's busy time, the functions with most inclusive time and the ones with most self
  time. `tailSec` records every frame interval for that many seconds after ready (and a second profile of that stretch); `tools/cpuprofile-hitches.mjs` says what the main thread did in
  each frame over 50 ms; `readyJs` runs a page expression once ready (the teleport downtown the frame-time shots use); `probe` puts a page expression's value in the result (to compare what two builds made).
  Plans: `tools/load-plans-profile.json`, `tools/load-plans-startup-pr.json` (the paired runs), `tools/load-plans-hitch.json`.
- The Mac mini through `gpu2-local`, headless Chromium, 1600x900 (the phone profile: 412x915 at x2.625, `quality=low`, 4x CPU throttle), fast link, `liveDate=2026-11-26`, a fresh browser each run,
  served as Cloudflare serves it (`realHeaders`). Main at `4842d7bd` (build `e68eeec8ccb4`) against the changed build, A then B inside each job, three jobs (rounds) each.
  The profiler adds a few percent: the profile runs give the table below, the paired timing runs (no profiler) the totals.

### The steps over 200 ms (main `4842d7bd`, profiled cold start, ms)

"First view" is whether the first picture needs the step's output; "could" says how it could leave the start-up (after the first frame, in a worker, by distance on demand, or ahead of time into a file).

| Step (`[init]` phase) | Desktop | Phone | In the first view? | Could it move? |
|---|---|---|---|---|
| module scripts and the city's lookup tables (`renderer`: `city-config.js`, geodata decode, `subway.js`) | 1028 | 1583 | yes (everything reads them) | tables ahead of time into a file (st-wa52's pattern); 0.4 s is `city-config.js` building its rasters |
| ground, curb islands, sidewalks (`cityGrid`) | 2968 | 4479 | yes | far ground by distance on demand; the road mask ahead of time (st-wa52). Another agent's area |
| landmarks (`landmarks`) | 973 | 2897 | the pictures yes; the colliders no | colliders: the generator that traces them (`footprintCollidersSteps`) can run after the first frame in slices, with the site's box until then (0.35 s desktop, 1.3 s phone were the outline tracing) |
| buildings (`blocks`) | 3690 | 1217 | yes | far blocks by distance on demand; the house drawing is the presets' (st-ndw9) |
| tennis, rinks, poles, park trees, High Park features (`streetDetails`) | 3089 | 3156 | yes (poles, trees); tennis and rinks only where they stand | tennis and rinks by distance on demand |
| trees (`trees`) | 1210 | 1934 | yes | far trees by distance on demand |
| street props, signs (`streetProps`) | 479 | 843 | yes | |
| road network, pedestrian routes, traffic (`traffic`) | 2122 | 2588 | cars and people appear in the first frames; the network itself no | the crossings' sidewalk lines (0.8 s desktop, 1.0 s phone: `acrossMid`, st-1pxn) on demand, but the pedestrian signals ask for every crossing's tracks at the start |
| streetcars (`streetcarCars`) | 853 | 2105 | on its routes | route matching: `near` was 0.4 s desktop, 1.15 s phone |
| buses (`transitBuses`) | 938 | 852 | on its routes | route matching: `nearest` was 0.7 s / 0.6 s |
| rail corridor (`railCorridor`) | 559 | 703 | only near Union | mesh building (0.2 s of it garbage collection); by distance on demand |
| Don Valley drape (`donValley`) | 467 | 1262 | yes (it moves the ground) | |
| High Park ground cover (`parkCover`) | 371 | 1365 | no (round the viewer, 6 km from the start) | by distance on demand |
| culling (`culling`) | 2004 | 993 | yes | the far band's cutting (1.2 s desktop) in a worker; the perf pass's |
| shader compile (`compile`) and warm-up (`warmup`) | 3760 + 1269 | 9625 + 2331 | yes | st-z1g5 |
| sky occlusion, controllers, UI, post effects, subway, road paint (each 150 to 430 ms) | | | yes | |

Totals: 27.7 s (desktop), 40.8 s (phone) from the page's first script to ready. The compile and the warm-up are 5.0 s desktop and 11.9 s phone of that.

The cost is spread over some forty builders, none over 15%. The surprise is how much of it was a scan that an index answers with the same result.

### What was cut (PR 1: indexes for the linear scans, jf-2vn)

Every change gives the same answer as the scan it replaces (unit tests below, and the start-up's console record is the same line for line apart from the counts the page draws at random: buses and streetcars on the road).

| Where | What it was | Now | Phase it shows in (profiled run, desktop / phone, ms) |
|---|---|---|---|
| `js/tennis.js`, `js/rinks.js` | every court and rink tested against every collider in the city (`staticColliders.some`, `.filter`): ~150 courts and pads, ~60 rinks, ~150,000 colliders | a 64 m grid of the colliders (`WorldCollision.colliderGrid`) | `streetDetails` 3089 to 1532 / 3156 to 2653 |
| `js/transit-buses.js` `nearest`, `js/streetcars.js` `near` | the nearest point of the route's line, over a `Map` of arrays with `Math.hypot` on every point; every track piece asked about every route | the line's points in typed arrays in a dense grid, a squared-distance test before `Math.hypot` (the same cells in the same order), track pieces far from the line turned away by the grid's bounds and an occupied-cell map | `streetcarCars` 853 to 511 / 2105 to 1196, `transitBuses` 938 to 545 / 852 to 602 |
| `js/park-detail.js` `query`, `js/city-config.js` `nearestRoads` | `new URLSearchParams(location.search)` on every call (one per building and per tree); `Math.hypot` for every road segment in reach | parsed once a turn of the event loop; a squared-distance test first | `blocks` 3690 to 3161 / 1217 to 885, `trees` 1210 to 944 / 1934 to 1678 |
| `js/street-details.js` | the park tree spots tested with `pointInPoly` over the park outline's hundreds of points, a hundred thousand times | the outline cut into 8 m bands of z (`pointInBlock`: the same crossings, the same answer) | in `streetDetails` |
| `js/world-collision.js` `roofCover` | the landmark outlines' roof raster tested every cell of each roof face's box | each row only the cells that can pass the face's three half-plane tests | `landmarks` 973 to 826 / 2897 to 2354 |
| `js/scene-culling.js` bounds | `computeBoundingBox` and `computeBoundingSphere` through `Vector3.fromBufferAttribute` a vertex at a time, on every geometry the cells and `releaseCpuCopies` handle; the second is the 400 ms freeze at the moment the loading screen goes | read straight off the float array, the same min, max, centre and radius | `culling` 2004 to 1611 / 993 to 966; the main thread's block at ready, 400 to 90 ms |

(Phase numbers are one profiled run each, a few percent apart from run to run; the paired totals below are the proof.)

Tests: `tests/tennis.test.mjs` (the grid answers as the whole list does), `tests/world-collision-roof-cover.test.mjs` (the same cells as the face-box scan, slivers and near-collinear faces among them), `tests/scene-culling-fast.test.mjs`
(the bounds bit for bit). `[tennis]` and `[rinks]` records: the same courts placed and rejected, in the page's own `probe`.

Paired cold runs, Mac mini, fast link, interleaved (A = main `4842d7bd`, B = this branch), three each, ready in ms and the first frame:

| | A ready | B ready | Gain | A first frame | B first frame |
|---|---|---|---|---|---|
| Desktop | 26,464 (26,356 to 26,476) | 23,111 (22,989 to 23,137) | **-3.35 s (12.7%)** | 25,794 | 22,734 |
| Phone profile | 39,662 (39,554 to 39,678) | 36,898 (36,882 to 36,964) | **-2.76 s (7.0%)** | 38,784 | 36,567 |

(The first frame is the ready time less 0.4 to 0.9 s: ready waits for the GPU to finish it.) The bytes are the same (19.4 MB desktop, 13.6 MB phone).

Frame time after the change (downtown street and High Park woods, 20 s of frame intervals each, three rounds, main against this branch, alternating, same mini): p50 downtown 15.6 / 15.7 / 15.6 ms before and 15.6 / 15.7 / 15.7 after, High Park 17.1 before and after; p95 and p99 within 1 ms.
The charts, both builds named: `docs/images/start-up-scans-frame-downtown.png`, `start-up-scans-frame-highpark.png`, `start-up-scans-frame-downtown-stutter-in-before.png`. Stills from above of three rinks and three tennis courts (`tools/shots/start-up-stills.json`) match to the
pixels that move (cars, people: 0.01 to 0.2% of channel values, 1.7% at one court beside a street); the `[rinks]` record (36 placed, the one rejected and its overlap of 1142.75 m2) and the placed courts (155 desktop, 43 phone: `probe`) are the same. `tools/check-tier-shaders.mjs`: clean on all four tiers.

### The stutter at the downtown street

At the downtown street, three or four frames of 100 to 150 ms in a row, once, 15 to 55 s after ready (the capture's frame-time shot sees it 11 to 20 s into its 20 s recording).

**What it is: V8's major garbage collection of a 3 to 4 GB JS heap.** Found with `tools/load-timing.mjs` (`tailSec`, `profile`, the uncapped-frames flags of the capture tool in `args`: the stutter does not show at the browser's capped 30 fps) and `tools/cpuprofile-hitches.mjs`: each of the four
frames has about 90 ms of `(garbage collector)` and 20 to 25 ms of the page's own work (the render loop, no pipeline compile, no page script of any size), and the browser's long-animation-frame record names only the render
loop's `requestAnimationFrame` callback. The heap at ready is 3.1 to 4.1 GB (`performance.memory`) of which the sampling heap profiler (`setting.heap`, `tools/heapprofile-summary.mjs`) finds 1.15 GB live, by the script that allocated it: three's node and material caches 0.30 GB, `city-config.js` and the geodata loader 0.15 GB, the buildings, drawing plans and massing rows 0.2 GB, the road network, pedestrian routes, street details and streetcars 0.12 GB; the rest is garbage the start-up made that V8 has not yet collected. The collection comes when the old generation reaches its limit.

Six runs (three pairs, 75 s each after ready, uncapped frames, same mini, main `4842d7bd` and this PR), the time after ready of the four slow frames: main 40.0, 15.5, 30.7 s; this PR 54.0, 46.5, 38.7 s. Each run has exactly one such group. The PR makes the start-up allocate less (it no longer builds a URL parser object per building and tree, a map of arrays per route, a vector per vertex: not measured one by one), so
the limit is reached later (17 s later on average here); it does not remove the collection. In the capture's 20 s window the stutter was in 3 of 3 runs of main and 0 of 3 of this PR, for that reason and no other.
Other frames over 50 ms in these runs are 50 to 55 ms ones scattered through the minute, about 20 of 4,500 frames, the same in main and in the PR, and the ones below.

**Not fixed, because there is no cheap fix.** A smaller heap is the cure (the building plans, the tree and node caches, the colliders as objects), or building less at the start; both are projects. What does not help: building it behind the first frame (it is the heap, not one step).

Frames over 50 ms in the first 10 s after ready are another thing and are the page's own work (the same trace): the first sidewalk line of each street worked out as people spawn after a teleport (50 ms a frame, PR 2), the Biidaasige Park and Port Lands being built a few milliseconds a frame (steps of 50 to 100 ms:
`buildBiidaasigeRiverAccess` `distToRing` 55 ms, the trees' `retire` 30 ms and `biidaasigeParkClearAt` 30 ms when it is shown; the park's own area), and GPU stalls of 1 s with the main thread idle at 1.3, 3.7 and 5 s on the contended mini (pipelines the GPU process builds).

### What is left

- **The transit layer and traffic after the first frame (jf-xgi) was not done, and the numbers say why.** It was 4.6 s (streetcars, buses, rail, subway 2.5 s and traffic 2.1 s on desktop). The scans above took 0.7 s off the transit part (streetcars and buses 1.8 s to 1.1 s together;
  the rail corridor 0.55 s and the subway 0.16 s are mesh building). What remains cannot go behind the first frame without a hitch: the builders are single calls of 0.15 to 0.8 s (`createTrafficSystem` 2.1 s of road network and pedestrian routes), so one frame would
  take that long unless each is rewritten as a generator that yields (the landmark outlines already are: `footprintCollidersSteps`), and the road network, the colliders and the audio they share would have to tolerate arriving late.
  A rewrite per builder, each 0.2 to 2 s: the crossings' sidewalk lines (`acrossMid`, 0.8 s desktop, 1.0 s phone, st-1pxn: the pedestrian signals ask for every crossing's tracks at the start, so they need a cheaper "would it have tracks" answer first), the landmark colliders
  (0.35 s desktop, 1.3 s phone), tennis and rinks, High Park's ground cover (0.4 s, 1.4 s phone) and the rail corridor by distance on demand.
- Not mine, in the table: the shader compile and warm-up (5.0 s desktop, 11.9 s phone: st-z1g5), the ground (`cityGrid` 3.0 s, 4.5 s phone: st-wa52), the culling's far band (1.2 s: the perf pass), the building drawing (`blocks` 3.2 s: the presets).
- The 1.7 s of garbage collection inside the start-up and the 3 to 4 GB heap behind the stutter: the cure for both is allocating less (the building plans, the node caches, the colliders as objects).
- The city database by region (jf-qet): untouched; it is a slow-link win.

### PR 146 (module preloading): closed, not merged (st-vky3)

Measured on main `4842d7bd` (which already fetches the models early), `tools/load-plans-modulepreload.json`, A = main, B = main plus the PR's `tools/build-site.mjs` change (32 `modulepreload` links), one to two cold runs per setting, ready in ms:

| Setting | main | + PR 146 |
|---|---|---|
| Desktop, fast link | 26,512 / 27,089 | 26,518 / 26,463 |
| Phone profile, fast link | 39,868 | 40,459 |
| Desktop, 25 Mbps / 60 ms | 31,037 | 31,085 |
| Phone profile, 25 Mbps / 60 ms | 42,599 | 42,587 |
| Desktop, 1.6 / 0.75 Mbps / 150 ms | 105,990 | 106,345 |

The last module arrives earlier (phone on the 25 Mbps link: 4.2 s against 1.8 s) and ready does not move: the page does not wait for modules, it waits for its own CPU and its data. Differences are inside the 0.6 s spread. Closed.

### A teleport's crowd (tried, not shipped)

On a teleport (`jump` in `js/traffic.js` `update`) every pedestrian is placed in one frame, and the first sidewalk line of each street is worked out then: about 50 ms of the 130 to 150 ms frame 0.6 s after a teleport downtown. Spreading the placement over the next frames
(5 ms a frame, the jump's rules kept, only once the page is ready) took the worst frame in the 19 s after the teleport from 136 / 141 / 134 ms to 130 / 112 / 116 ms and one of the two frames over 100 ms in each run, with the rest of that frame (the new area's first render, 55 ms) still there. Three pairs, uncapped frames
(`tools/load-plans-teleport-crowd.json`). Not worth a change in how a crowd appears; the change is in the notes of jf-qet if the new area's first render ever goes.
