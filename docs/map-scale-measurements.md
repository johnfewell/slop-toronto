# How big can the playable map get? Measurements (st-6m6l)

John asked how hard it would be to let the player go further than today's frame, up to the whole GTA, and what it
would cost in performance. This is the first step: measure. Two bigger frames were built offline from the same free
sources and loaded, unchanged in design, into the game on the Mac mini, beside today's frame.

**Short answer.** The current design (the whole frame built in the browser at startup) stretches to an Eglinton-sized
map at a real cost, and does not stretch to the whole City:

- **Eglinton (2.5× the area, 4× the buildings)** loads and plays. Startup goes from 13.5 s to 53 s, the JS heap from
  1.1 to 3.1 GB, and desktop frame time from 16.7 to 33.3 ms in the aerial views. About three quarters of the extra 40 s of
  startup is one quadratic step that can be fixed, not the scale itself.
- **City of Toronto (12× the box, 12× the buildings)** loads only after fixes: stack overflows in three files, and three
  textures over WebGPU's 8192-texel limit. Then it takes 196–199 s to start and 6.0–6.4 GB of JS
  heap, and runs at 50 ms (20 fps) on the desktop tier. The phone tier loaded in only 1 of 4 attempts. No
  phone could hold this.
- **The GTA needs tiled streaming.** It also needs new data sources beyond the City's open data, which stops at the
  City boundary.

All numbers come from one shared machine (Apple M4 Mac mini, Chromium 156 WebGPU/Metal through `gpu2`) with other
processes present (`background-processes-unqualified`). They are functional evidence of how things scale, not
performance budgets.

## The frames

Frames are axis-aligned boxes in the game's world frame (metres; x along the downtown grid, z grid-south, rotated
16.6° from true north), so a box around the whole City covers more ground than the City itself.

| Frame | World box (x, z) | Box area | What it covers | File |
|---|---|---:|---|---|
| detail (today) | −7900..3700, −3000..3600 | 76.6 km² | Humber to Cherry Beach, lake to Bloor | `tools/geo-roads.mjs` FRAMES.detail |
| Eglinton | −7900..9600, −7300..3600 | 190.8 km² | Humber to Victoria Park, lake to Eglinton | `tools/frames/eglinton.json` |
| City | −16900..25400, −18100..3700 | 922.1 km² | Etobicoke Creek / Hwy 427 to the Rouge, lake to Steeles (the 630 km² City plus corners of Mississauga, Vaughan, Markham, Pickering and the lake) | `tools/frames/city.json` |

Each JSON frame has `world` (the box), `bbox` / `box` (lon/lat, 400 m beyond the box, for the OSM, massing and
roadway clips) and its area.

## 1. Offline builds (laptop CPU)

`node tools/frames/build-frame.mjs --frame tools/frames/<name>.json --out <dir>` runs the shared tools with
`--frame`, using the existing caches only: the Geofabrik Ontario extract, City 3D Massing 2025, edge-of-roadway,
sidewalks, poles, street trees, traffic and GTFS caches, and the SRTM DEM. It writes `build-report.json` with the time
and peak RSS of each step. For comparison, the detail geodata was rebuilt from its cache in 151 s (peak 2.2 GB),
byte-identical to the committed binary.

| Step | detail | Eglinton | City |
|---|---:|---:|---:|
| OSM clip from the Ontario extract (`fetch-osm`) | (cached) | 332 s, 3.6 GB | 303 s, 5.4 GB |
| Massing, roadway and poles clips | (cached) | 12 s | 9 s |
| **City database (`build-geodata`)** | **151 s, 2.2 GB** | **557 s, 3.0 GB** | **2,379 s, 8.9 GB** |
| Poles, pack, sidewalks, traffic, transit | – | 31 s | 142 s |
| Massing polygons (opt-in `?massing=1`) | – | 24 s | 59 s |
| **Total** | – | **16 min** | **48 min** |
| Build's 1 m block raster | 77 M cells | 191 M cells | 922 M cells (Int32 labels: 3.7 GB) |

The geodata build grows faster than the area: 3.7× for 2.5× the area, and 16× for 12×. It runs on one thread.
The City's OSM step overlapped the Eglinton geodata step, and the City's geodata step overlapped the detail rebuild,
so those two are slightly pessimistic.

### Runtime data files

These are the files the page loads (the first five) or packs into the binary (poles), plus the node-side script and
the opt-in massing. Sizes are in MB, raw / gzip -9.

| File | detail | Eglinton | City |
|---|---|---|---|
| `toronto-geodata.bin`: the city database, already gzip; inflated size in brackets | 2.23 (8.4) | 5.32 (20.7) | 16.74 (62.2) |
| `toronto-sidewalks.js` | 0.61 / 0.23 | 1.78 / 0.67 | 6.14 / 2.34 |
| `toronto-traffic-data.js` | 0.37 / 0.10 | 0.83 / 0.23 | 2.14 / 0.59 |
| `toronto-transit.js` | 0.18 / 0.05 | 0.52 / 0.16 | 2.10 / 0.58 |
| **Frame-dependent download, gzip** | **2.6** | **6.4** | **20.3** |
| `toronto-poles.js` (packed into the binary) | 0.57 / 0.21 | 1.53 / 0.57 | 4.85 / 1.78 |
| `toronto-geodata.js` (tools and tests only) | 10.6 / 3.3 | 25.2 / 7.8 | 80.0 / 25.2 |
| `toronto-geodata-ids.js` | 1.9 / 0.24 | 7.0 / 0.84 | 20.5 / 2.4 |
| `toronto-massing.bin` (`?massing=1`) | 0.87 | 2.81 | 8.32 |

The whole page decodes 24.9 MB of same-origin resources for detail, 29.8 for Eglinton and 47.6 for City, as served
uncompressed by the capture server.

### Counts

| | detail | Eglinton | City |
|---|---:|---:|---:|
| Buildings (3D Massing) | 35,266 | 140,541 | 423,092 |
| Street trees in the inventory / placed | 57,120 / 55,851 | 183,006 / 180,124 | 688,247 / 673,410 |
| OSM road ways / road-graph nodes / links | 16,571 / 4,349 / 5,464 | 28,564 / 11,375 / 15,113 | 104,807 / 43,519 / 57,420 |
| Curb islands (blocks) | 2,969 | 7,508 | 27,658 |
| Traffic signals (OSM) | 2,940 | 5,496 | 12,789 |
| Mapped poles | 38,534 | 100,739 | 305,067 |
| Transit routes / patterns / stops | 36 / 96 / 919 | 98 / 249 / 2,774 | 206 / 641 / 8,990 |
| Streetcar / heavy rail | 136 / 108 km | 199 / 214 km | 216 / 803 km |
| Hydrants / transit shelters | 4,187 / 561 | 12,513 / 1,572 | 42,527 / 5,444 |
| Curb islands with the City's sidewalk polygons / with the fixed 4.6 m band | 2,386 / 182 | 6,042 / 544 | 16,142 / 5,989 |

## 2. Loading a frame in the game

The runtime already reads its frame from the data: `GEO.frame.detail` sets `CITY_BOUNDS`, the walls of the world, the
street level, the quadtree and the culling. So the smallest change that loads another frame is in the page:
`explore.html?frame=<name>` loads the geodata binary, sidewalks, traffic data and transit from `frames/<name>/`
beside the page instead of `data/` and `js/`. That folder is gitignored, and the build does not copy it. Everything
else, including the detail-only layers, loads as today.

That flag and the patches below live on the experiment branch `exp/map-scale-runtime` (not for merging). This PR
carries the doc and the tooling.

Patches the bigger frames needed to load at all:

1. **Stack overflows (Eglinton and City).** `array.push(...big)` passes every element as an argument, and V8 runs
   out of stack somewhere above 100 k elements. Eglinton's ~200 k tree sites broke it in
   `high-park-woods.js` `dropPiledCityTrees` and `replaceTrees`. The City's trees broke it in `street-details.js`
   (the rail-corridor filter). The City's ~300 k pole colliders also pass through `main.js`'s collider and tree merges, so
   all 16 of those were converted too. All of these became plain loops. They are real bugs for any growth, worth a small separate fix on `main`.
   About 60 more `push(...x)` remain in the runtime; most take short arrays.
2. **Textures over WebGPU's default 8192 limit.** WebGPU's default `maxTextureDimension2D` is 8192. The M4
   supports 16384 if requested, phones vary. Three textures broke it, and the invalid texture then invalidated whole
   command buffers: in the first City capture only the sky drew, at a meaningless 16.7 ms frame time.
   - The street level's **water mask** (`GEO.waterMask`, 4 m cells over the frame) is 10,576 × 5,451 in the City.
     Patched: coarser cells when wider than 8192.
   - The **TTC destination-sign atlas** (`transit.js`) is one 73-px row per distinct sign: 512 × 13,286 for
     Eglinton, 512 × 35,770 for City. Patched: rows capped, so later signs show the first sign's text.
   - The **park-sign atlas** (`park-signs.js`) is 4 cells wide: 2048 × 13,440 for the City's parks. Patched:
     square-ish.
3. **Transit build review gate (City).** `build-transit.mjs` stops when GTFS shapes of one stopping pattern take
   different paths until someone reviews them in `tools/data/transit-variants.json`. Three City patterns (165 d0, and
   96 d0 twice) tripped it. For measurement it ran from a scratch copy with the gate as a warning. A real build needs
   the reviews.

### Where the runtime and the build assume the detail frame

| Where | Assumption | Eglinton | City |
|---|---|---|---|
| `city-config.js` `LOOKUP`: block id per 4 m cell over the frame (Uint16) | dense, frame-sized | 4,376 × 2,726, 24 MB | 10,576 × 5,451, 115 MB; Uint16 caps blocks at 65,534 (City has 27,658; the GTA would not fit) |
| `GEO.waterMask`: 4 m texture over the frame | under 8192 texels | 4,376 × 2,726 | 10,576 × 5,451: over the limit (patched) |
| `GEO.terrain` (`geo-terrain.mjs` TERRAIN) | fixed 52 km square at 60 m, centred on Union | fits | box edge x 25.4 km vs grid edge 26 km: no room beyond the City |
| `surroundings.js` land-use map | fixed ±16 km | fits | the frame runs past it east and north |
| Build: `geo-blocks.mjs` 1 m raster | dense, frame-sized | 191 M cells | 922 M cells, 8.9 GB peak; the GTA (~7,000 km²) would not fit in memory |
| `buildings.js` quadtree | depth 9 over the frame | cells 34 m | cells 82 m |
| `controllers.js` | helicopter roams 12 km past the frame | – | – |
| Prebuilt layouts | `js/toronto-patios.js` and `js/toronto-signal-plan.js` are keyed to the detail data | rebuilt at startup (patios) and planned at startup (signals) | same |
| Detail-only layers | subway, parked cars, parking meters, benches, wayfinding, CaféTO, public art, heritage, storefronts, tennis, rinks, city facilities, the High Park and Don Valley terrain | not extended | not extended |
| `build-transit.mjs` | variants reviewed for the detail routes | passed | 3 unreviewed patterns |
| Data coverage | City of Toronto sources stop at the City boundary | – | the box corners outside the City get OSM roads and land use but no buildings (they come from the City's 3D Massing), street trees, sidewalks or poles; 27% of curb islands have no sidewalk polygon (Eglinton 8%, detail 7%) |

Also seen in both bigger frames but not in detail: 4 GPU validation errors ("binding size is zero", an empty buffer)
and 3 geometries with NaN positions. One Eglinton capture showed a Line 5 light-rail train at street level at
Yonge & Eglinton, where the line runs underground; that wants a check of how the build handles tunnelled light rail.

Not a scale problem, though first listed as one: the build logged "landmark not found" for Ontario Place, Sugar Beach,
Centre Island and Kensington Market in every frame, today's detail rebuild included (st-bz1o.8). OpenStreetMap carries
them differently from the names the build looked for: Sugar Beach as "Sugar Beach", Centre Island as a place=island
multipolygon and Kensington Market as a neighbourhood boundary (both filtered out of the inputs), Ontario Place as a
node only. Since 2026-11-10 the build also finds a landmark by its Wikidata ID (`tools/landmark-defs.mjs`,
`osm_landmarks.json` from `tools/fetch-osm.mjs`), and all 23 are found in the detail, Eglinton and City extracts.

**Since these measurements** (epic st-bz1o, Eglinton desktop-first): the push spreads were fixed on main (#102), the
street-prop placement checks use spatial grids (#104; today's map: ready 13 s → 9 s, identical placements) and the
sign atlases run on in columns under 8192 texels (#105).

## 3. Measurements on the Mac mini

Run: `tools/frames/run-captures.sh` through `gpu2`, from `exp/map-scale-runtime` on main 99bb411; shots in `tools/shots/map-scale.json` and
`tools/shots/map-scale-city.json` (`tools/frames/make-shots.mjs`); per-shot records in `tools/frames/probe.js`;
tables in `tools/frames/summarize.mjs`.

- **Desktop:** `?quality=high&autoscale=0&transit=timetable&cloudSpeed=0&memlog=1` at 1600×900.
- **Phone:** `?quality=low` at 412×915, touch.
- **Settings:** golden hour, seed 6711, each view held 6 s, then a 2 s warm-up and a 6 s frame-time window.
- **Triangles and draw calls:** summed over every draw between two animation frames (`renderer.backend.draw`
  wrapped), so the phone tier reads true values instead of the 0 a single `info.render` read can give.
- **Load times:** measured to `__CITY_APP.ready`, which the app sets once the first frame has drawn and the GPU has
  finished it. Time to first frame and time to playable are therefore the same moment here (within 0.1–0.9 s). Data is
  served from a local disk, so network time is not included.
- **Repetitions:** each frame and tier ran twice, 14:40–16:00 on 4 November. The frame-time percentiles, triangles
  and draw calls repeated within 1%, and CPU within 5%. The tables give ranges for the load and run 1 for the views,
  except where marked. The City phone tier produced one run.

### Load

| | detail desktop | detail phone | Eglinton desktop | Eglinton phone | City desktop | City phone |
|---|---:|---:|---:|---:|---:|---:|
| Ready (first frame, playable) after navigation | 13.1–13.5 s | 12.8–13.1 s | 51.0–53.2 s | 48.9–49.6 s | 198.3–199.2 s | 195.9 s* |
| of which street props and furniture placement (`streetProps`) | 4.1–4.2 s | 4.0–4.2 s | 32.8–34.7 s | 31.4–32.1 s | 118.5–119.5 s | 115.0 s |
| city ground (`cityGrid`) / traffic setup | 0.8 / 0.9 s | 0.8 / 0.8 s | 2.4 / 3.3 s | 2.3 / 3.4 s | 22.6 / 17.2 s | 22.6 / 18.8 s |
| Geodata decode | 67 ms | 81 ms | 152 ms | 149 ms | 439 ms | 423 ms |
| JS heap at ready (phase log, before GC) | 1,069–1,073 MB | 985–1,001 MB | 3,107–3,112 MB | 2,870–3,213 MB | 6,366–6,371 MB | 6,052 MB |
| Renderer memory estimate (`info.memory`, street view) | 842 MiB | 555 MiB | 1,155 MiB | 855 MiB | 2,480 MiB | 2,072 MiB |
| Frame-dependent download (gzip) | 2.6 MB | | 6.4 MB | | 20.3 MB | |

\* The City phone tier loaded in 1 of 4 attempts over the two runs. The other three ended with the page or browser
crashing 10–28 s into the load, before the city was built. The mini has 16 GB of RAM, and the desktop tier's City heap
alone is 6.4 GB.

**Why `streetProps` explodes.** A CPU profile of the Eglinton desktop load (`CAPTURE_PROFILE=1`) puts 12.9 s in
`WorldCollision.contact` and about 18 s in `street-props.js` `obstruction` / `blocked`. These are the startup
placements of parking meters, benches and wayfinding signs. Each candidate scans every static collider and every
street prop linearly, and both lists grow with the frame. The cost therefore grows with candidates × colliders,
although the candidates come from the detail frame's data. A spatial grid on those checks should bring it back
near detail's 4 s. If it does, the estimate is about 23 s ready for Eglinton and about 85 s for the City.
The CaféTO patios also lay themselves out at startup, because the prebuilt layout does not match the new colliders.

### Steady frame time, CPU, triangles

The frame interval is p50 / p95 in ms; it includes vsync and the phone tier's 30 fps limit. CPU is simulation +
synchronous render submission p50 in ms (no GPU wait). Triangles and draw calls are per frame, view pass first and
all passes, shadows included, in brackets.

**Desktop (high, 1600×900)**

| View | detail | Eglinton | City |
|---|---|---|---|
| Downtown street (King & Bay) | 16.7 / 33.4 ms · CPU 1.6 + 7.0 · 4.6 M (5.9 M) tris · 499 (870) draws | 33.3 / 33.4 · 1.9 + 9.8 · 7.4 M (9.7 M) · 876 (1,244) | 50.0 / 66.7 · 3.6 + 24.9 · 19.1 M (26.3 M) · 2,361 (2,742) |
| Aerial over the core (220 m) | 16.7 / 33.3 · 1.0 + 5.6 · 3.3 M (4.0 M) · 416 (575) | 33.3 / 33.4 · 1.2 + 8.7 · 6.3 M (8.0 M) · 855 (1,028) | 50.0 / 66.7 · 2.4 + 22.0 · 17.9 M (24.4 M) · 2,271 (2,454) |
| New-area street: Yonge & Eglinton | (frame edge at Bloor) 16.7 / 16.8 · 1.0 + 3.7 · 3.4 M (5.3 M) · 178 (368) | 16.7 / 33.4 · 1.7 + 4.6 · 5.7 M (7.5 M) · 202 (459) | 50.0 / 50.1 · 3.2 + 14.1 · 16.7 M (23.5 M) · 1,098 (1,401) |
| High aerial (380 m, over the lake) | 16.7 / 33.4 · 1.0 + 5.9 · 3.1 M (3.7 M) · 457 (635) | 33.3 / 33.4 · 1.2 + 9.6 · 6.3 M (7.9 M) · 992 (1,187) | 50.1 / 66.7 · 2.5 + 23.7 · 18.1 M (24.6 M) · 2,540 (2,745) |
| Borough Drive, Scarborough Centre (run 2) | – | – | 33.3 / 50.0 · 3.0 + 9.8 · 13.0 M (19.3 M) · 612 (844) |

**Phone tier (low, 412×915)**

| View | detail | Eglinton | City |
|---|---|---|---|
| Downtown street | 33.3 / 33.4 ms · CPU 2.1 + 4.8 · 3.0 M (3.5 M) tris · 204 (381) draws | 33.3 / 33.4 · 2.2 + 4.6 · 5.4 M (6.1 M) · 272 (453) | 33.3 / 33.4 · 2.1 + 6.3 · 15.6 M (16.5 M) · 473 (647) |
| Aerial over the core | 33.3 / 33.4 · 1.5 + 5.5 · 2.6 M (2.9 M) · 215 (295) | 33.3 / 33.4 · 1.8 + 5.0 · 5.1 M (5.5 M) · 289 (373) | 33.3 / 33.4 · 1.5 + 5.5 · 15.3 M (15.9 M) · 480 (560) |
| Yonge & Eglinton | 33.3 / 33.4 · 1.7 + 6.0 · 2.8 M (3.7 M) · 129 (248) | 33.3 / 33.4 · 2.3 + 4.9 · 4.5 M (5.0 M) · 148 (294) | 33.3 / 33.4 · 2.0 + 5.0 · 14.7 M (15.4 M) · 316 (460) |
| High aerial | 33.3 / 33.4 · 1.2 + 5.9 · 2.7 M (2.9 M) · 251 (333) | 33.3 / 33.4 · 1.7 + 5.1 · 5.2 M (5.5 M) · 332 (418) | 33.3 / 33.4 · 1.5 + 5.7 · 15.3 M (15.9 M) · 523 (605) |

On the M4 the phone tier holds its 30 fps limit in all three frames, but its triangle count grows about 5× from detail
to City. A real phone GPU is much slower than the M4; these runs do not show that a phone could hold 30 fps.

Desktop high tier, mean frame interval (all views): detail 16.7–22.4 ms, Eglinton 20.6–29.7 ms, City 33.8–57.6 ms.
At the desktop street view, render submission CPU grows 7.0 → 9.8 → 24.9 ms. That is the cost of walking a scene
3× larger and submitting 1.4–3× the draws every frame, and it is CPU-side.

### CPU of traffic, crowds and transit

The probe times each system's `update` over 90 frames.

| System, ms per frame (desktop street view) | detail | Eglinton | City |
|---|---:|---:|---:|
| Traffic and pedestrians (`trafficSystem`) | 0.70 | 0.81 | 1.43 |
| Streetcars | 0.15 | 0.19 | 0.24 |
| Rail corridor (GO trains) | 0.06 | 0.15 | 0.36 |
| Buses / highway / subway | ≤ 0.01 each | ≤ 0.01 | ≤ 0.06 |
| Simulation total (measurements p50) | 1.6 | 1.9 | 3.6 |
| Pooled cars / pedestrians (fixed caps); streetcars running | 200 / 340 / 88 | 200 / 340 / 129 | 200 / 340 / 141 |

The traffic and the crowds are local: actors spawn within 250 m and retire beyond 380 m, so their counts do not grow
with the map. What grows is the lookup structures they query. Network-wide simulation does grow: streetcars run on
49 → 58 → 61 routes, GO trains on 7× the heavy-rail track, and bus routes go 52 → 208 → 809. That is still ≤ 0.4 ms each. The
simulation is not the problem; the render submission and the startup are.

Captures: `$GPU2_REVIEW_DIR/slop-toronto-r3-base/` (`<frame>-<tier>-r<n>-<view>.png`, `.metrics.json`,
`-record.json`, `-console.log`, and `prof-eglinton-high-profile.txt`).

## 4. What tiled streaming would need

Everything is built at startup today, then culled. The measurements say the cost is in building and holding
everything: startup, heap, and per-frame scene walk and submission. Drawing pixels is not the cost. Streaming
replaces "the frame" with a ring of tiles around the player.

- **Tile size: 1 km × 1 km**, on the world grid. That is about 920 tiles for the City box (about 630 with land in the
  City), and a 4 × 4 ring, 2 km each way, holds 16 tiles. A tile is 1/77 of the detail frame: about 30–100 KB gzip of
  geodata in the core, under 30 KB in the suburbs (the City averages 22 KB/km² for its 20 MB). Startup costs about
  80 ms of main thread per km² in all three frames, excluding the props step and shader compiles. That makes a tile
  about 0.1–0.3 s on the M4 and perhaps 0.5–1.5 s on a phone, so tile building has to go to a worker or be
  time-sliced, as the massing cells already are.
- **Per tile:** curb islands and their 4 m `LOOKUP` raster (250 × 250 Uint16, 125 KB), water mask, roads and the road
  graph's links in the tile, buildings, trees, poles, props, sidewalks, signals, colliders, terrain detail and the
  street paint. Each tile is a group the culling already understands (`scene-culling.js` chunks per 500 m to 1 km).
- **Global, loaded once:** transit routes, stops and shapes (2.1 MB raw for the City), the live-vehicle feed (positions
  only; draw near ones), the subway, landmarks, district and place names for the map and search, the lake, the far
  terrain (the 60 m grid, extended), and a far LOD: building boxes merged per 4–8 km super-tile for the skyline beyond
  the ring. The road graph's topology for navigation can be global (57 k links for the City is small) while lanes and
  geometry are per tile.
- **Phone memory cap:** keep the phone near today's detail numbers, about 1 GB of JS heap at ready and 555 MiB of
  renderer memory. That means a resident ring of about 9–16 tiles (9–16 km², a fifth of today's frame) plus the far
  LOD, with least-recently-used eviction, and the dense per-frame structures replaced by per-tile ones.
- **Fly speed vs load:** the helicopter tops out at 52 m/s with boost (32 m/s without; cars 19 m/s). At 52 m/s a
  new 1 km row of 3–5 tiles is needed every 19 s, about one tile every 4–6 s: roughly 25 KB/s of download, trivial,
  and a few hundred ms of worker CPU per tile. The ring radius has to cover what can be seen. From 380 m the high
  aerial looks across the whole core, so the far LOD has to carry that view while the detailed ring stays at 1–2 km.
  Prefetch along the heading.
- **Build side:** the geodata build has to work per tile, or at least in bands. A single 1 m raster over the GTA
  (about 7 billion cells) cannot be held. Per-tile builds also parallelize across cores, where today's build runs on
  one thread for 40 min for the City. Stable IDs already exist (`docs/geodata-ids.md`), so tiles can cross-reference.

## 5. Recommendation, staged

1. **Eglinton without streaming (about 1–2 weeks).** It already loads and plays. Before shipping it:
   - Make the street-props obstruction checks spatial: about 1 day, which should take startup from 53 s to about 23 s.
   - Rebuild the patios and signal plan for the frame, and fix the destination-sign atlas into a grid.
   - Review the transit variants, fix the push spreads, the NaN geometry and the empty buffer.
   - Extend the detail-only layers that matter, starting with the subway north to Eglinton.

   The costs that remain are measured: 2.5× the download (6.4 MB), about 3× the heap (3.1 GB desktop), and the desktop
   aerials at 33 ms instead of 17 ms. The heap is the risk for phones. Today's 1 GB is already heavy, so ship
   Eglinton on desktop first, or keep the phone tier on the detail frame until streaming lands.
2. **City with streaming (about 6–10 weeks).** The City frame proves the data exists and the runtime can draw it, but
   not at startup: 199 s, 6.4 GB, 20 fps on an M4, and a phone crash. Streaming as in section 4 is the route:
   - per-tile build output
   - a tile loader and LRU
   - the dense per-frame grids (`LOOKUP`, water mask, quadtree, terrain) made per tile
   - a far-LOD skyline
   - the startup-only layouts (props, patios, signal plans) moved into the build

   The City's data gaps are small (unreviewed transit variants, sidewalk polygons missing on 27% of curb islands).
3. **The GTA after that (open-ended).** The engine work is the same as stage 2. The data work is new for every
   municipality: see below.

## 6. Beyond the City (the 905): what is free

The engine needs buildings with heights, roads, curbs, trees, transit and terrain. A quick survey found the following
(links checked in November 2026; a gap means nothing was found, not that nothing exists):

- **Buildings.**
  - Mississauga publishes an LOD2 3D massing model built from lidar.
  - Burlington's footprints carry eave and peak heights; Oakville has 3D buildings derived from lidar.
  - Brampton (CC BY 4.0), Caledon/Peel, York Region, Durham, Pickering and Hamilton publish footprints without heights.
  - StatCan's Open Database of Buildings has a height field where its sources do. Microsoft's Canadian footprints
    (ODbL) have no heights. Overture merges both. Google Open Buildings does not cover Canada.
  - Heights for most of the 905 would come from lidar (a DSM minus DTM per footprint), not from a published field.
- **OSM buildings:** no published completeness figure for the 905. The Canada building import stalled, so coverage
  is uneven. Comparing counts against the municipal footprints is the cheap check.
- **Lidar (Open Government Licence – Ontario):**
  - The GTA 2023 project, the source of the DTM the High Park terrain uses (5,255 km², leaf-off), covers
    spot-checked points in Brampton, Caledon, Vaughan, Markham, Richmond Hill, Pickering, Ajax, Oakville, Burlington
    and Milton.
  - Central Mississauga is GTA 2015 only. Oshawa and Whitby are CLOCA 2018 and Central East 2025. Hamilton is
    Hamilton–Niagara 2021.
  - NRCan's HRDEM (1 m DTM and DSM) fills in.
- **Street trees:** Mississauga, Oakville (with height and crown), Burlington, Ajax and Hamilton publish inventories.
  York Region publishes regional roads only. Nothing found for Brampton, Vaughan, Markham or Pickering; those would
  need canopy-derived trees.
- **Curbs and sidewalks:** Brampton (curbs and sidewalks), Oakville (sidewalks with widths) and Hamilton (road edge)
  publish them, all as lines, not the polygons the City publishes. Nothing found for York, Peel, Mississauga or
  Durham. The 905 would use the fixed sidewalk band the build already falls back to.
- **Transit GTFS:** MiWay, Brampton Transit, YRT/Viva, Durham Region Transit, Burlington, Oakville and HSR all have
  open feeds. GO Transit's licence is contradictory: OGL–Ontario on the Metrolinx open-data page, and a custom
  revocable agreement on the developer page. Check before using it.
- **Traffic:** AADT counts from Peel, Durham, Burlington and Hamilton, and signal locations from Brampton and
  Hamilton. York Region's counts are fee-based.

So a 905 build is feasible from free data. It needs one pipeline per municipality, with OSM plus lidar heights as the
common fallback, and its streets would be plainer than the City's: no curb polygons, fewer trees, approximate heights.

## The Eglinton frame in the page (st-bz1o)

`explore.html?map=eglinton` loads the Eglinton frame's own city data: `data/frames/eglinton/toronto-geodata.bin` and,
in `js/frames/eglinton/`, its sidewalks, traffic data, transit, signal plan, subway and subway topology, in place of
today's. Every other script stays today's (the parked cars, benches, patios and the like cover the detail frame; the
CaféTO patios lay themselves out at startup there, about half a second). A default visit fetches none of it
(tests/eglinton-frame.test.mjs). The flag is for testing only; desktops default to it only once John says go.

**The far band.** Downtown, the Eglinton map costs what today's does: the city beyond today's (north of Bloor, east
of the Don) is a far band (city-config.js `FAR_BAND`). Its city-wide meshes are cut at today's edge, the band in 1 km
cells hidden beyond 2 km of the camera, where today's far city stands in (surroundings.js's buildings in the same
cells, the terrain's painted ground just under the street level). `?band=<m>` sets the distance, `?band=0` turns it
off. Measured on the mini (desktop high, today's map vs Eglinton, before the band in brackets): King & Bay 53.0 vs
51.4 (39.4) fps, the core and high aerials 60 vs 60 (35, 34).

Rebuild after the raw downloads or the build tools change:
`node tools/frames/build-frame.mjs --frame tools/frames/eglinton.json --out <dir> --skip massing-bin --install`
(about 8 minutes from a filled cache, 16 from an empty one; it rewrites the files above and the binary's hash in
explore.html). The 2026-11-10 rebuild (st-bz1o.8) used `--out ~/.cache/slop-toronto/frames/eglinton`, which keeps its
clipped inputs in `cache/` there for the next one.

## Reproduce

```sh
node tools/frames/build-frame.mjs --frame tools/frames/eglinton.json --out <dir>       # ~16 min
node tools/frames/build-frame.mjs --frame tools/frames/city.json --out <dir> --heap 36864   # ~48 min
node --expose-gc tools/frames/boot-cost.mjs <dir>/toronto-geodata.bin                  # decode + city-config in node
```

The experiment branch `exp/map-scale-runtime` adds the `?frame=` loader and the patches. On that branch, copy
`toronto-geodata.bin`, `toronto-sidewalks.js`, `toronto-traffic-data.js` and `toronto-transit.js` into
`frames/<name>/` and `dist/frames/<name>/`, run `npm run build`, then
`gpu2 <name> -- env CAPTURE_PORT=<port> bash tools/frames/run-captures.sh detail eglinton city`. Summarize with
`node tools/frames/summarize.mjs $GPU2_REVIEW_DIR/<name>`.

In node on the laptop (`boot-cost.mjs`), `city-config.js` alone takes 1.3 s for detail, 3.6 s for Eglinton and 17 s
for the City, with 89, 207 and 692 MB of heap after it. Most of that is the 4 m `LOOKUP` raster and the per-cell
indexes.
