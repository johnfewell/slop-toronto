# Sky occlusion from a building height map

How much of the sky a surface sees over the skyline around it, found in a top-down height map of the city and used to
darken the sky's indirect light in narrow streets, at the foot of towers and in courtyards. Tracker issue `jf-s3b`.

Ported from Ben Houston's enhanced Slop New York lighting (bhouston/slop-newyork, branch `ssr-brdf`, `js/sky-occlusion.js`,
MIT; write-up: https://ben3d.ca/blog/enhanced-slop-new-york-lighting). Credit is in `CREDITS.md`.

## What it does

- At load, once the colliders are in (`js/main.js`, after the massing cells), the buildings are rasterised into a height
  map: one byte per texel, the square root of the roof height (rounded down, so never above the roof; 0.6 m steps at
  20 m, 5 m at 300 m), with a max-mip pyramid (a texel holds the tallest of the four under it, so a far step can't
  miss a thin tower).
- For a fragment, the horizon is searched in compass slices (Ben's 16; 8 on the high tier), steps from 4 m to 256 m (13; 10 on high) (a step of 1.41x), each
  step read at the mip whose texels are an eighth of its distance (Ben's: a quarter; an eighth was closer to the brute
  force in `tests/sky-occlusion.test.mjs`). The cosine-weighted sky above each slice's horizon is integrated in closed
  form (the slice integral of GTAO) and summed: 1 on open ground facing up, 0.5 on a wall facing open ground.
- The part of the sky the buildings hide is refilled by one bounce, like Ben's: the hemisphere light's ground colour
  times the time of day's canyon bounce. The materials' `aoNode` is a scalar, so the bounce is expressed as a share of
  the sky's own irradiance (`SkyOcclusion.setBounce`, called by `js/lighting.js` with the time of day), not a colour.
- It replaces the height-only canyon AO of the materials (`canyonSkyAONode` in `js/tsl-materials.js`: 0.7 at the street
  rising to 1 at 30 m, the same on a narrow street and a wide avenue). That function stays where the pass is off.

## Where it differs from Ben's

| | Ben's | here |
|---|---|---|
| Where it runs | a half-resolution screen pass over depth & normals, feeding the indirect-diffuse list of his three.js fork (`builtinIndirectContext`) | per fragment in `aoNode` of the city materials, on stock three r187 (no fork, no depth pre-pass in this renderer) |
| Map | 4 x 16 km (Manhattan), 2 m texels, drawn with a 2D canvas | sized to the loaded map: texel 2 to 8 m (4 m for the 191 km2 desktop map), rasterised in plain JS from the colliders |
| Specular | not occluded | not occluded (aoNode also scales the environment's specular by three's own rule) |
| Landmarks | their triangles drawn into the map | the colliders' outlines (the landmarks' are cut from their meshes) |

Not in the map: terrain (the ravines and the escarpment shade nothing), trees, props, the bridges and decks (`minY` over
3 m), and anything under 4 m.

## Cost and memory

Indicative figures only: the Mac mini (M4) through `gpu2`, shared with other runs, uncapped frame rate, median frame time
over 8 s, desktop map (Eglinton frame), high tier, `?skyocc=0` against the default in the same build:

| view | off | 8 x 10 (shipped) | 16 x 13 (Ben's counts) |
|---|---|---|---|
| King & Bay, street | 13.0 ms | 13.7 ms (+0.7) | 17.2 ms (+4.3) |
| High Park | 20.2 ms | 20.4 ms (+0.2) | 21.3 ms (+1.0) |
| Waterfront lawn | 18.6 ms | 19.0 ms (+0.4) | not measured |

Against the 16 x 13 result the 8 x 10 search differs by 0.045 in visibility on average over the synthetic block, and
the stills look the same. Load: 116 ms to rasterise 148,546 colliders into 4525 x 2875 texels of 4 m (16.5 MB with the
pyramid, in GPU memory too: about 33 MB all told). Not measured: the GPU time of the pass alone (it runs inside the
materials, so it is not a separate pass to time).

## Tiers (`js/quality.js` `skyOcclusion`)

- high: 8 slices x 10 steps, read out to 500 m from the camera (Ben's 16 x 13 cost 4 ms at King & Bay).
- medium: 6 slices x 8 steps, to 350 m, texel capped at 8 M texels.
- low (phones): off, the materials keep the height function.

`?skyocc=0` turns the pass off on any tier, for A/B captures. It is the default everywhere else.

## Tests

`tests/sky-occlusion.test.mjs`: the rasteriser (polygons with holes, turned boxes, triangles, the tallest wins), the
pyramid, the texel choice, the integral against the closed form of an infinite street canyon, against a brute-force
reference (64 slices, every texel out to 320 m) on a synthetic block, and the tier settings.
