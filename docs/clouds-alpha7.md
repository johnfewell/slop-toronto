# Cloud library alpha.7 on stock three.js r187

The app uses the published `three-clouds-webgpu-0.1.0-alpha.7.tgz` release archive
([v0.1.0-alpha.7](https://github.com/johnfewell/three-clouds-webgpu/releases/tag/v0.1.0-alpha.7), tag commit
`0fefeeb11c4cd1e149b18538d4378af4ee902a14`), SHA-256
`2c767eaacaf1276c59b0e6994f94d95963fb95e1f1a34e083f6127101e61666f`, which matches the release's `SHA256SUMS` and
`public-candidate-record.json`. `vendor/clouds/release.json` records the archive and dependency provenance. It
supersedes alpha.6 (`docs/clouds-alpha6.md` before this change, bead `st-43w2`).

| Package | Version | Source |
| --- | --- | --- |
| `three` | 0.187.0 (npm) | the browser loads the same build from the r187 release commit, see below |
| `three-clouds-webgpu` | 0.1.0-alpha.7 | `vendor/clouds/three-clouds-webgpu-0.1.0-alpha.7.tgz` |
| `@takram/three-atmosphere` | 0.19.1+fork.8 | the `fork-release-8` release of `johnfewell/three-geospatial` |
| `@takram/three-geospatial` | 0.9.1+fork.8 | the same |

The clouds declare Three.js `>=0.187.0 <0.188.0` and vendor the two takram fork builds; their README says to install
the fork archives and the `overrides` together. `package.json` takes both archives from the
[`fork-release-8`](https://github.com/johnfewell/three-geospatial/releases/tag/fork-release-8) release on
`johnfewell/three-geospatial` (tag at `cecb98ca`, branch `fork/r187-types`, one commit on `fork-release-7`), as it took
`fork-release-7` before. They are byte-identical to the archives the clouds release vendors at its tag commit `0fefeeb`,
which the city loaded from `raw.githubusercontent.com` until that release was published. The `overrides` pin both
packages, including where the clouds name them as peers. Their SHA-256s match the clouds release record and the
release's asset digests (`829ec23b…` atmosphere, `10127715…` geospatial), and the lockfile carries their integrity.
npm resolves one copy each of `three`, the clouds and the two takram packages; `tests/threejs-pin.test.cjs` checks the
lockfile for it.

Fork 8 against fork 7 changes types only (r187's typed `UniformNode<'vec3', …>`, `AtmosphereLightNode`'s return
types) and the `forkBuild.release` marker (7 to 8). The built JavaScript is otherwise byte-identical, including
`@takram/three-geospatial`'s `isFloatLinearSupported()` that picks the atmosphere tables' precision.

Alpha.7 against alpha.6: `CloudsPassNode` and `CloudEnvironmentNode` extend `Node` instead of the deprecated
`TempNode`, so three of the nine `THREE.TempNode` deprecation warnings at startup go (six remain, from
the takram geospatial fork's nodes), an opt-in `createQualityGovernor` and
`writeQualityPresetValues` are new, and the light registration follows r187. The city's calls into the library
(`vendor/clouds/entry.js`, `js/sky-clouds.js`) needed no change.

`tools/build-clouds.mjs` bundles the installed, locked package into `js/clouds.js` (three external, from the page's
import map) and copies the release's four baked textures. `npm run build` regenerates it before fingerprinting. The
bundled `EXRLoader` now comes from npm three 0.187.0.

## Renderer

The browser no longer runs a three.js dev build. `explore.html`'s import map (and `tools/prop-preview.html`,
`tools/props-preview.html`, `tools/clouds-probe.html`) loads the stock r187 release from jsDelivr at the `r187` tag's
commit, [`7e89746a687bb88271253698fa108b1dd59825d0`](https://github.com/mrdoob/three.js/tree/r187) (30 October
2026). It stays a commit URL so the address is immutable and `tools/capture.mjs`'s CDN cache keeps working.
`build/three.webgpu.js`, `three.tsl.js` and `three.core.js` at that commit are byte-identical to npm `three@0.187.0`
(the SHA-256 of `three.webgpu.js` is `eafead31…` in both), so the page, the tests, the tools and the cloud library's
qualification all use the same three. `vendor/three/` is now that stock build, unpatched: the struct adapter
`tools/vendor-three.mjs` used to add for the npm takram builds is gone, because the fork builds read either struct shape.

r187 is 34 commits past the previous pin `b3396270` (`st-ary`). What the city relies on:

- **Precompile** (`compileAsync`, `main.js` `precompileShaders()`): r187 snapshots the MRT with the render target, and
  each queued item now compiles with the state of the render call that queued it (a nested render into another target,
  such as the environment bake, no longer inherits the scene pass's target and MRT). The city's own guard
  (`visualGate`, bead `st-eyy2`) stays; it is still right not to interleave node builds. No call change.
- **Internal animation loop** (#35278, #35279): it now starts on the first `render()` or `setAnimationLoop(fn)`,
  not in `init()`. The city's first render is `precompileShaders()`'s empty frame, so nothing reads the node clock
  before then. `setAnimationLoop(null)` still leaves the internal loop (and the shared shader clock) running, which is
  what `js/capture-clock.js` expects.
- **Drawing pipelines** (#35191): the scene walk moved from `Renderer._projectObject` into a
  `StandardDrawingPipeline`, with the same culling. The city does not patch the walk (`js/scene-culling.js` culls its
  own objects before the render).
- **Reversed depth** (#35264): the reversed-depth function map no longer swaps `Always`/`Never` and
  `Equal`/`NotEqual`. The city uses `reversedDepthBuffer: true`, but no material in the city or the libraries sets
  `depthFunc`, so nothing changes. #35276 ignores a logarithmic depth buffer under a reversed one (not used).
- **`ClusteredLightsNode`** (#35271): its cache key is now its node id and version, so it no longer changes when the
  cluster grid is first allocated (the street, traffic and highway light clusters).
- **SSR** (#35240, #35266, #35242): the desktop tier's `ssr()` (non-stochastic, `binaryRefine`) now clips its rays to
  the viewport and refines coarse hits. Same options; reflections at the screen edges may differ slightly.
- `RendererUtils.resetRendererState()`/`restoreRendererState()`, which the cloud passes call, and the TSL exports are
  unchanged between `b3396270` and r187. `ProxyNodeMaterial` is renamed `NodeMaterialInstance` (#35269); nothing here
  uses it.
- Test harness only: r187's renderer declares its bind-group cache `null` until `init()`, and the WGSL builder only
  skips shared bind groups when it is `undefined`, so `tests/seasons.test.mjs` and `tests/storefronts.test.mjs` (which
  build WGSL with an uninitialised renderer) set it back to `undefined`.

An earlier attempt at stock 0.186.1 stalled at shader precompilation (no ready within 240 seconds). r187 contains every
commit of the old dev pin, so it is not that combination; startup on r187 is checked on both tiers below.

## WebGL2 backend

Three's `WebGPURenderer` runs on its WebGL2 backend with `?webgl=1`, and also on its own when the browser has no
WebGPU: `renderer.init()` falls back to the WebGL backend when the WebGPU one cannot start. The cloud library refuses
that backend (alpha.7 still does): its cloud pass throws while building (`assertWebGPUBackend`), which left the whole
frame black (`st-osz`). `js/sky-clouds.js` asks the library itself (`Clouds.assertWebGPUSupported`) once the renderer
has initialised, so the flag and a real fallback take the same path. On WebGL2 it builds no cloud pass and logs
`[clouds] volumetric clouds off: ...`; the takram atmosphere stays (it builds its tables with WebGL render targets
there), so that sky has the physical atmosphere, sun, moon and stars without volumetric clouds. `tests/sky-clouds.test.mjs`
covers the decision with the real library module.

The atmosphere picks its tables' precision with `backend.hasFeature('float32-filterable')`. r187's WebGL backend still
has no mapping for that name, and fork 8 picks the precision exactly as fork 7 did, so on WebGL2 the tables are
half-float unless the city says otherwise: `floatTablesOnWebGL` (PR #73, `st-xirf`) reports the feature when
three has enabled `OES_texture_float_linear` and `EXT_color_buffer_float`. On r187 with fork 8 the Financial District
golden aerial on WebGL2 shows the speckle band without it and none with it, as on the old pin.

The crowds skin from a storage buffer on WebGPU; on `webgl2` (`window.CITY.RENDER_BACKEND`) `js/pedestrians.js` keeps
the poses in a float texture instead (`tests/pedestrian-crowd.test.mjs`). `tools/capture-no-webgpu.js` (a
`CAPTURE_INIT_SCRIPT`) removes `navigator.gpu` before the page loads. `tools/shots/webgl-fallback.json` asserts the
WebGL2 backend and fails on any WebGL error from a draw call.

```sh
gpu2 <name> -- env CAPTURE_ROOT=dist CAPTURE_CDN_CACHE=1 CAPTURE_QUERY='?webgl=1&quality=high&autoscale=0' CAPTURE_PROGRESS=1 node tools/capture.mjs tools/shots/webgl-fallback.json
gpu2 <name> -- env CAPTURE_ROOT=dist CAPTURE_CDN_CACHE=1 CAPTURE_QUERY='?autoscale=0' CAPTURE_INIT_SCRIPT=tools/capture-no-webgpu.js CAPTURE_PROGRESS=1 node tools/capture.mjs tools/shots/webgl-fallback.json
```

## Verification

- The archive matches the release's `SHA256SUMS`; both fork archives match the release's
  `public-candidate-record.json`. A fresh `npm ci` with an empty cache resolves one copy each of `three`, the clouds and
  the two takram packages.
- `npm test`: 546 tests, 544 pass, 2 skipped (main: 545, 543, 2). `npm run build` passes.
- PR #73 (`floatTablesOnWebGL`) merges cleanly onto this change and its tests pass with the fork.8 LUT node.
- Mac mini (`slop-toronto-r3-desk`, shared, so functional and visual evidence only), main `93736f1` before and this
  change after. Each run used the quick lists `upstream-take-now`, `upstream-cull`, `ped-detours` and `pave-wear`,
  plus golden and twilight aerials with volumetric clouds over the lake, the east side and the Financial District.
  All eight runs reached ready, with no page, shader or WebGPU validation errors and no WebGL draw errors. The consoles
  match main apart from the TempNode warnings (9 to 6 on WebGPU):

  | Run | Ready, before / after |
  | --- | --- |
  | desktop WebGPU `?quality=high` | 11.7 s / 13.8 s |
  | desktop WebGL2 `?webgl=1&quality=high` | 11.5 s / 12.2 s |
  | phone WebGPU `?quality=low`, 412×915 | 11.3 s / 11.4 s |
  | phone WebGL2 `?webgl=1&quality=low`, 412×915 | 11.3 s / 14.0 s |

  The frames match main. The cloud shapes differ only as far as the clouds evolve (their clock is wall time). On
  WebGL2 the sky has the atmosphere without volumetric clouds, as before.
- Release URLs (3 November 2026): the `fork-release-8` assets are byte-identical to the `raw.githubusercontent.com`
  archives the city loaded before (same SHA-256s and lockfile `integrity`). A fresh `npm ci` with an empty cache fetches
  them from the release. `npm test`: 601 tests, 599 pass, 2 skipped (main the same), and `dist/` is byte-identical to
  main's build. On the Mac mini (`tools/shots/clouds-r187.json`, golden and midday, `cloudSpeed=0`) WebGPU and
  `?webgl=1`, desktop and phone, all reached ready with no errors, and the frames match main apart from moving foliage,
  traffic and billboards.

## History

- Alpha.6 (27 October 2026, fork release 7) ran on the dev pins `e27dfa95` and then `b3396270` (`st-ary`), outside
  its declared `>=0.184.0 <0.187.0` range, with npm three 0.186.1 for tests and a struct-patched 0.186.1 in
  `vendor/three/`. It was published on 27 October 2026 (Cloudflare version `26c0cc29-b0a5-490e-a625-f39fad732807`,
  source `b942b0b`, site build `8e97f0daa6f5`).
