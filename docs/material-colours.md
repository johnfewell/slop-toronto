# A material's colour is applied once (jf-xql)

## The rule

three r187's node material (`node_modules/three/src/materials/nodes/NodeMaterial.js`, `setupDiffuseColor`) builds a material's colour like this:

1. `colorNode` when it is set; otherwise `color` times `map` (`materialColor`). So with a `colorNode`, `color` and `map` are ignored unless the node reads `materialColor` itself.
2. times the geometry's `color` attribute **when `vertexColors` is true** and the geometry has one.
3. times `instanceColor` whenever the mesh has one (and the batch colour for a batched mesh).

So a `colorNode` that reads the `color` attribute (`attribute('color', 'vec3')`, `vertexColor()`) must not be on a material that also sets `vertexColors: true`: the vertex colour is multiplied in twice, and a colour of 0.2 draws as 0.04. This is how the roofs went black (jf-dr1, [realism-fixes-20261126.md](realism-fixes-20261126.md)). A `colorNode` that does not read the attribute and multiplies a grain, a stripe or a tint on the vertex colour is the intended use (the turf, the road paint, the timber finish).

`tests/material-colour-once.test.mjs` pins it: it reads every `js/` file and fails when a material that sets `vertexColors: true` (in its constructor, or by `m.vertexColors = true`) later gets a `colorNode` that reads the colour attribute, when a `CanvasTexture` has no `colorSpace`, and when a hex colour three already converts to linear is converted again by hand. `tools/shots/material-colours-audit.json` (run by `JOB=audit` of `tools/capture-material-colours.sh`) lists, from the live scene graph in the page, every material that sets `vertexColors` and also has a `colorNode` (the candidates, to be read against the source: a `Fn(() => ...)` body only exists once the shader is built, so the page cannot see into it), every instanced mesh whose `colorNode` reads `instanceColor`, and every material whose `colorNode` samples its own `map`.

## What the audit found

All materials in `js/` that set `vertexColors` (22 sites), all `colorNode`s (163), every `instanceColor` / `setColorAt` use, every texture and every colour conversion were read.

| # | Where | Before | After |
|---|---|---|---|
| 1 | `js/high-park-features.js` `M.solidSnow`: the High Park hedges and the roofs of Colborne Lodge and its coach house (colours from the file's own `RGB()`, hex to linear once) | `vertexColors: true` plus a `colorNode` reading `attribute('color')`: every colour squared. The lodge roof (`SHINGLE` 0x5f5650, 0.11 linear) drew as 0.012, near black; the hedges (0x4f7a3c) drew a near-black green; the walls beside them (`M.solid`, one multiplication) were right | `vertexColors` removed: the lodge roof is the shingle grey-brown. The hedge palette had been chosen against the squaring: once drawn right, 0x4f7a3c and 0x5f8c45 read as a bright lime, so the hedges (and their tops) are now a clipped evergreen, `HEDGE` 0x2f5230 and `HEDGE_TOP` 0x3a6035. In snow the up-facing roof and hedge tops are still covered by `snowOver` |
| 2 | `js/street-details.js` the palm trunk (`trunkMat`) | the same pattern: trunk grey squared | the same fix. Not visible: `palms.length = 0` in the Toronto build (the Abuja verges' royal palms), so the mesh is never created; fixed so it cannot come back if palms are used |

Checked and **not** a bug (so left alone):

- `js/waterfront-hto-landscape.js` `turfMaterial` (`vertexColors` plus a grain `colorNode` that does not read the colour attribute), `js/tsl-materials.js` the road paint (`vertexColors` times a wear `colorNode`), `js/biidaasige-woodchip-island.js` (`vertexColors` only in the branch with no `colorNode`), `js/landmarks.js` Ontario Place pods (reads `attribute('color')` with no `vertexColors` flag: once).
- `instanceColor` with a `colorNode`: the island cottage trim, the tanks, the cafe patios, the deck planks, the boroughs' crowns and the trees' tints all let three multiply the instance colour and none reads it again. The trees' `colorNode` (`seasonNodes`, `fadeMaterial`) takes `materialColor` once; the texture node it also reads is only for the greenness test.
- `color` / `map` next to a `colorNode`: `colorNode` replaces them (rule 1), so nothing is multiplied twice; the places that want the map call `materialColor` once (`seasonNodes`, `cottonwoodBark`).
- Colour conversion: `RGB()` in high-park-features, `toLinear` in boroughs, `lin()` in storefront-signs (a `THREE.Color`), `srgbToLinear` in stylized-water and `** 2.2` in mapped-poles each convert once, into attributes or uniforms that three does not convert again. No `setHex` is followed by `convertSRGBToLinear`.
- Textures: every `CanvasTexture` that holds a picture is `SRGBColorSpace`; the `NoColorSpace` ones are data (the tree leaf atlas's channels are brightness, hue jitter and twig mask, the storefront atlas's are coverage masks with the colours passed as linear attributes, the park signs' masks, the foam and water normals).

## Captures

Mac mini through `gpu2-local`, `tools/capture-material-colours.sh`, the real late-November season (`liveDate=2026-11-26`, no season preset, bare trees, `liveWeather=Sunny`) and mid-January with 15 cm lying (`liveDate=2027-01-15&liveSnow=15`), the same camera before and after.

Results: before and after pairs are kept outside the repo in the 2026-11-26-material-colours folder of the slop-toronto-updates screenshots (`BEFORE-*` and `AFTER-*`). The lodge roof goes from near black to the shingle grey-brown; in snow the roof, which drew dark grey even under 15 cm (the snow white was multiplied by the roof's vertex colour a second time), now carries the snow like the ground does; the hedges go from near-black green to a clipped-evergreen green, with snow on their tops. The wall, verandah and ground are the same pixels. Frame time is unchanged: four runs back to back (before, after, after, before), mean frame interval 17.46 / 17.46 / 17.50 / 17.52 ms in the lodge view and 17.05 / 17.27 / 17.36 / 17.58 ms at the hedge, mean CPU submission 17.0 ms in each (the mini's frames are paced, so these are relative, not budgets).
