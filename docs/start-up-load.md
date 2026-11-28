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

## Reproduce

```sh
npm run build && cp -R dist .load/a        # then change something and build into .load/b ...
GPU2_LOCK_WAIT=3600 gpu2-local <name> -- env CAPTURE_PORT=<port> LOAD_ONLY=desk-slow-cold LOAD_ROUNDS=1 LOAD_TAG=<tag> \
  node tools/load-timing.mjs tools/load-plans-startup-abcd.json     # edit the plan's arms
```

`LOAD_ONLY` is a setting's name (or a name prefix), `LOAD_ROUNDS` the number of rounds, `LOAD_TAG` the results file's name. The record of every run has `marks`
(`init:firstFrame`, `init:gpu`, ...), `all` (every request: name, start, end, transfer, initiator, decoded, encoded) and a picture of the page 4 s after ready.
