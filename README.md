# Slop Toronto

Downtown Toronto and the waterfront in 3D, in the browser: walk, cycle, drive or fly from the Humber Bay Arch Bridge
along the lake to Sugar Beach, past the CN Tower and through downtown. Built with [three.js](https://threejs.org/)
WebGPURenderer and TSL on the engine of [Slop New York](https://github.com/mrdoob/slop-newyork) by mrdoob, by way of
its fork Abuja Tour. Needs a WebGPU browser (recent Chrome or Edge).

**Live: https://sloptoronto.ca/explore**

![A Line 2 subway train crossing the Don Valley on the Bloor Viaduct's lower deck at golden hour](docs/images/hero-bloor-viaduct.jpg)

## What's in it

- **The TTC subway:** six-car trains cross the Don Valley on the Bloor Viaduct's lower deck and run through
  the open cuts in the west end (Runnymede to High Park, Keele past Vincent Yard). 27 stations have their stairways on
  the street and the TTC insignia pylon at 86 entrances, each with the station's name, lines and accessibility.
- **Ride a streetcar:** choose **Ride the 504 along King** in Sights, or walk/cycle to an open streetcar at a stop and press **E**. Use **V** for seat/chase views, and **E** to request a stop or get off with the doors open. Touch and gamepad controls work too.
- **Ride the subway:** choose **Ride the subway across the Don Valley** in Sights, or enter at Castle Frank or Broadview. Board, cross the viaduct, get off at the other station and return to the street. Change platforms for the return journey. The first route has procedural station and train interiors.
- **Streetcars and GO trains:** TTC streetcars on the real streetcar network (no buses on streetcar routes), and GO
  trains on real bridges and embankments over the streets, from OpenStreetMap. Union Station has an open train shed
  over its platforms, and Strachan Avenue dips under the tracks in a cutting.
- **Toronto's cycling network:** the City's bike lanes, cycle tracks (Bloor, Richmond & Adelaide, Sherbourne,
  University...) behind their curbs & flexi-posts, green crossrides, sharrows, and the multi-use trails, the Martin
  Goodman Trail's red asphalt past Sugar Beach among them, from City of Toronto Open Data; the traffic keeps out of
  them, and both maps show them.
- **Street furniture from the City's data:** the City of Toronto's park name signs at 240 parks, each with its own
  name and address, plus hydrants, bike rings, transit shelters, litter bins and post boxes where the City says they stand.
- **CaféTO patios:** the summer's curb lane platforms and sidewalk cafés on Ossington, Queen West, College, Dundas West,
  King West, the Danforth and more, placed from the City's CaféTO permits by its own clearance rules
  ([how they are placed](docs/cafeto-patios.md)).
- **Sky and sound:** volumetric clouds with golden hour, sunset and night, and a city that sounds like one: traffic,
  streetcars, the lake.

![The Osgoode pylon at dusk, a park sign at Trinity Bellwoods, Strachan Avenue's underpass, Line 2 by Vincent Yard](docs/images/grid.jpg)

## Run it

No build step for development: `npm run dev` (or `node tools/dev-server.mjs`) and open
`http://127.0.0.1:5530/` (landing page) or `/explore.html` (the city).

The dev server sends `Cache-Control: no-store` and automatically reloads open tabs when app HTML, JS or CSS changes.
The city saves its safe player location on reload. Use this server rather than Python's generic file server; the
latter does not disable caching or notify already-open tabs. A tab opened before the dev server change needs one
reload to load the live-reload client.

Passenger travel: [streetcar controls and implementation notes](docs/streetcar-riding.md),
[subway controls and implementation notes](docs/subway-riding.md), and the full
[streetcar](docs/streetcar-riding-spec.md) and [subway](docs/subway-riding-spec.md) designs. The latest engine integration is recorded in
[the upstream sync notes](docs/upstream-sync.md).

Developer diagnostics: [bounded frame measurements and owned-resource accounting](docs/adoption-measurements.md),
including the `gpu2` capture recipe and the distinction between functional captures and an idle performance baseline.

## Test

`npm test` runs the default suite (`node --test tests/*.cjs tests/*.mjs`). It needs only a clean `npm ci`: the tests
use the committed Toronto geodata, stub the network (the Overpass downloader is tested against a fake `curl`) and
never read the raw downloads in `~/.cache/slop-toronto` or `tools/data/`. Tests with an external prerequisite report
as skipped, with the reason, when it is missing:

- **Raw geodata:** `npm run test:geodata` rebuilds the city database from the raw downloads into a temporary
  checkout and checks that `js/toronto-geodata.js`, `data/toronto-geodata.bin` and `js/toronto-geodata-ids.js` come
  out byte for byte the committed files (about a minute). It reads `GEO_DATA` (default `~/.cache/slop-toronto/osm-ids`)
  and `PROPS_DATA` (default `~/.cache/slop-toronto/raw`); `npm test` skips it unless both are set.
- **Headless browser UI:** the photo and postcard UI tests run in Playwright's Chromium with the GPU disabled. They
  skip until it is installed (`npx playwright install chromium`).
- **WebGPU:** rendering and capture checks are not part of `npm test`; run them on the Mac mini through `gpu2` (see
  [the capture recipe](docs/adoption-measurements.md)).

A failing test is a regression or a recorded bug: the suite does not mark known failures as skipped.

## Publish

The site is static. `npm run build` regenerates the cloud module from the locked installed packages, then writes
`dist/`: the two pages, assets and only
the scripts they load, followed through their imports. JS and CSS receive automatic SHA-256 content fingerprints
such as `js/main.012345abcdef.js`. The build rewrites page, lazy-import and debug-script URLs; a dependency change
also invalidates its importer's filename. Identical builds keep identical URLs, and unchanged geodata stays cached
across unrelated code edits. `dist/asset-manifest.json` records the source-to-output mapping and build ID.

These are fingerprinted individual files, preserving the existing ordered scripts and lazy modules. The build does
not combine the app into one bundle. Manual `?v=` bumps are no longer needed. HTML, the manifest and unhashed media
revalidate on each use; fingerprinted code is immutable and cacheable for a year. Those policies are explicit in
`dist/_headers`, following [Cloudflare's static-asset header rules](https://developers.cloudflare.com/workers/static-assets/headers/).
Cloudflare serves `dist/` as a Worker's static assets (`wrangler.jsonc`):

- **Production** is deployed from `main` (since 2026-10-29; the old `release` branch is retired). The Cloudflare
  Worker is deployed manually with Wrangler; its dashboard has no Git build connected, so merging alone does not
  publish the site. It serves sloptoronto.ca and www; the old workers.dev address redirects its pages there.
- Deploy, from a clean checkout of `main`: `npm ci && npm run build && npx wrangler@4 deploy`. The multiplayer rooms
  are a separate Worker (`rooms/wrangler.jsonc`); deploy them only when `rooms/` changes.
- `node tools/build-site.mjs` alone assembles the already-generated scripts without installing or rebuilding dependencies.

Cloud library: [alpha.6 integration and verification](docs/clouds-alpha6.md).

Cache regression checks: `node --test tests/site-cache.test.mjs tests/boot.test.cjs`. The GPU runner also verifies
that editing CSS reloads the real city and preserves the player (`GPU2_LOCK_WAIT=60 gpu2 slop-toronto-subway -- node tools/check-dev-reload.mjs`).

## License and data

The project code is open source under the [MIT License](LICENSE). Data, models and third-party code keep their own
licences: see [CREDITS.md](CREDITS.md). In short: City of Toronto Open Data (Open Government Licence – Toronto),
© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL; the built city database
`data/toronto-geodata.bin` / `js/toronto-geodata.js` is ODbL too), AWS Terrain Tiles (SRTM). The ROM model is not under the MIT License.

## Rebuild the city data

`node tools/build-geodata.mjs` rebuilds the city database from the raw downloads (`tools/fetch-*.mjs`: OSM via
the Geofabrik Ontario extract and GDAL, the City of Toronto Open Data sets, AWS terrain tiles), with `GEO_DATA`
pointing at the downloaded folder (`~/.cache/slop-toronto/osm-ids`, see [docs/geodata-ids.md](docs/geodata-ids.md#raw-data-cache)).
It writes `data/toronto-geodata.bin`, which the site loads (a lossless packed binary, 2.2 MB, read by
`js/geodata-loader.js` into the same `window.CITY.GEO`; it sets the file's hash in `explore.html`),
`js/toronto-geodata.js`, the same object as a script for the node tools and tests, and `js/toronto-geodata-ids.js`, the
durable source IDs of its places and buildings ([docs/geodata-ids.md](docs/geodata-ids.md);
`tools/check-geodata-ids.mjs` proves they survive shuffled inputs). `--out <file.js>` writes elsewhere, with the binary
and the IDs beside it and `explore.html` untouched; `--bin` and `--ids` name those two separately. A rebuild from the
same inputs is byte-identical (`npm run test:geodata`); `tests/geodata-binary.test.mjs` checks the binary and the
script agree on every value.
The City's physical sidewalks are their own file too: `node tools/fetch-sidewalks.mjs` caches the City's polygons in
`~/.cache/slop-toronto/raw/sidewalks`, then `node tools/build-sidewalks.mjs` clips them to the curb islands and writes
`js/toronto-sidewalks.js` (GDAL's `ogr2ogr` with SpatiaLite; rebuild it whenever the geodata's islands change, see
[sidewalk polygons](docs/sidewalk-polygons.md)).
The subway (lines, stations, street entrances) is its own file: `node tools/build-subway.mjs` writes
`js/toronto-subway.js` (`tools/fetch-osm.mjs` with `ONLY=rails` and `ONLY=subway` fetch its inputs).
