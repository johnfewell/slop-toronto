# Cloud library alpha.6

The app uses the supplied `three-clouds-webgpu-0.1.0-alpha.6.tgz` release archive, SHA-256
`40d314508339a81d254bdb00a6d95320b36aa5a6fca95a1f06778fb68c53f280`.
`vendor/clouds/release.json` records the archive and dependency provenance. npm resolves one copy each of clouds,
Three.js and the two takram packages. The atmosphere and geospatial dependencies are pinned to fork release 7,
including through transitive dependencies; the npm releases lack the markers and fixes required by alpha.6.

`tools/build-clouds.mjs` now uses the installed, locked package. It previously bypassed `package.json` and unpacked
a separate custom r187 archive from a cache. The build also copies the release's four baked textures and uses native
TSL from the page's renderer. The old struct shim is no longer used. `npm run build` regenerates this module before
fingerprinting and assembling the site, so a package change cannot silently retain the older generated module.

## Renderer boundary

The public library declares Three.js `>=0.184.0 <0.187.0` and qualifies stock 0.185.1/0.186.1 with fork release 7.
This city retains its existing pinned r187 renderer, commit `e27dfa95ae7f453b5d7a9a36ffdb563f7c9b529b`.
An attempted switch to stock 0.186.1 stalled at shader precompilation and did not reach ready within 240 seconds.
It was not shipped. No library guard was removed or dependency source patched to keep r187.

The evidence here qualifies this specific app/renderer combination. It does not extend the library's advertised
support range or establish arbitrary r187 compatibility. The app's npm Three.js 0.186.1 remains its build/test peer;
the browser uses the explicit pinned import map, as before this upgrade.

## Verification

- Archive checksum matches the supplied SHA256SUMS. The generated module imports and constructs a context in Node;
  the atmosphere exposes fork release 7 with `r186Kernels: true`. npm reports all relevant dependencies deduplicated.
- The full suite has 185 tests: 172 pass and the same 13 pre-existing fixture/raw-geodata failures. The focused boot,
  cache, controller, streetcar and subway suite passes all 51 tests. The fingerprinted production site builds.
- Mac mini Metal WebGPU runs reach ready with alpha.6. Captures cover golden hour, midday, sunset, night, moving
  vehicles, walking/flight, and streetcar/subway interiors. Both desktop and 412×915 touch views pass. The phone run
  explicitly requests the cloud library's low preset. Assertions verify active frame/time updates and all four loaded
  textures, including the 128³ shape volume. No page exceptions, shader compilation errors or WebGPU validation
  errors appear in the successful capture logs. Existing `THREE.TempNode` deprecation warnings remain.
- Captures run alongside production transcription and are marked contended. They verify startup, rendering and
  interaction, not a performance budget or before/after benchmark.

```sh
npm ci
npm run build
node --test tests/boot.test.cjs tests/site-cache.test.mjs tests/controllers.test.cjs tests/transit-riding.test.mjs tests/subway-service.test.mjs
GPU2_LOCK_WAIT=60 gpu2 slop-toronto-alpha6 -- env CAPTURE_ROOT=dist CAPTURE_QUERY='?quality=high&autoscale=0&transit=timetable&film' CAPTURE_PROGRESS=1 node tools/capture.mjs tools/shots/clouds-release.json
```

The Mac mini's Tailscale SSH route timed out during this run; the same machine was reached over its local-network
hostname while preserving the known SSH host-key identity. Captures remain on that machine, not the laptop GPU.

## Published release

Published on 2026-10-27 to `https://slop-toronto.cloud6711.workers.dev` using Wrangler, preserving existing variables.
Cloudflare version: `26c0cc29-b0a5-490e-a625-f39fad732807`. Deployed source: `b942b0b`; site build: `8e97f0daa6f5`.
The live manifest matches the tested build and `js/clouds.8ade1946424a.js` matches its local bytes by full SHA-256.
Live HTML returns `Cache-Control: no-cache`, fingerprinted code returns a year of immutable caching, and the TTC
vehicle endpoint returns HTTP 200 with its existing 15-second cache. A Mac mini capture against the public URL
reaches ready, loads the fingerprinted scripts and reports no page/shader/WebGPU validation errors.
