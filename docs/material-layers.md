# Physical material layers (jf-rcw)

Ben Houston's enhanced Slop New York lighting
(https://ben3d.ca/blog/enhanced-slop-new-york-lighting, code at https://github.com/bhouston/slop-newyork, branch
`ssr-brdf`, MIT) moves its reflective materials to `MeshPhysicalNodeMaterial` and gives each layer its own lobe. This
is the same idea on stock three.js r187, with none of his three.js fork (no `builtinIndirectContext`, no outermost-lobe
pre-pass, no indirect light providers). Credit: `CREDITS.md`.

`QUALITY.coat` (`js/quality.js`) turns it on: **high and medium on, low (the phone tier) off**. `?coat=0` / `?coat=1`
force it either way, which is also how the before/after captures are made. With it off every material is exactly what it
was.

## What each layer is

| Surface | Before | Now |
|---|---|---|
| Car paint (`createLoftedCarMaterial`, `js/actor-models.js`: traffic, parked cars, the player's taxi, police) | a glossy semi-metal (metalness 0.32-0.42, roughness 0.11-0.16), whose metalness also set SSR's weight | a slightly rough coloured dielectric (roughness 0.5, 0.4 metallic finishes), never a metal, under a clear coat (roughness 0.08, a bit more on the sills where road film dulls it). The glass, seals, mirror glass, lamps, trim and wheels have no coat |
| TTC bus livery (`createLoftedBusMaterial`) | semi-metal, roughness 0.3 | rough paint (0.5) under a coat (0.1); glass, lamps, seals, trim and roof pods bare |
| TTC streetcars (`createStreetcarMaterial`, `js/streetcars.js`) | semi-metal, roughness 0.38 | rough paint (0.5) under a coat (0.1); glass band, door glass, windscreen, door seams and the black skirt bare |
| Wet roads (`createRoadSurfaceMaterial`, `js/tsl-materials.js`) | water's gloss through roughness and a Fresnel-weighted metalness, plus an emissive painted copy of the sky and a Times Square neon tint | the asphalt keeps its dry roughness; water is a clear coat over it: whole in the puddles (roughness 0.1), 0.35 on the damp stains, 0.15 in the wet film (roughness 0.38-0.6) |
| Wet sidewalks (`createSidewalkMaterial`) | as the roads | clear coat 1 in the puddles (roughness 0.2), 0.3 of the wet film (0.55) |
| Pedestrians, procedural near LOD (`createPersonMaterial`, `js/pedestrians.js`) | matte | a sheen lobe (roughness 0.5) in the cloth's own colour on coat, trousers and sleeves; none on skin, hair or shoes. The far LOD is a few pixels and stays plain |
| Pedestrians, Rocketbox avatars (`js/rocketbox-pedestrians.js`) | glTF standard material | the `*_body` and `*_equpiment` materials become physical with sheen 1 (roughness 0.5) in the texture's own colour (`sheenColorMap`); head, hair and lashes unchanged |

## Where SSR comes in

The scene pass writes metalness and roughness for SSR, and SSR skips metalness 0. A coated dielectric is metalness 0, so
each coated material writes its own pair (`coatSSR()`, `material.mrtNode`, merged over main.js's): the weight is the coat's
Fresnel (F0 0.04) times the coat strength times a gain of 3, and the roughness is the coat's. The gain is not physical:
SSR is added to the frame at the pass's intensity of 0.5, and the physical 4% face-on left the street out of the paint.
The road's weight is boosted a further 2.1x (the film is only 0.15 of a coat, so that the lit signs mirrored in a wet
night road, which SSR drew before, still draw). All of it is dropped by main.js on the tiers with no SSR.

## What the coats reflect, honestly

- **The sky and the environment**: the scene's PMREM environment (`lighting.js`), through three's own clear-coat IBL,
  attenuated by each material's `aoNode` (the canyon sky occlusion the road already had). This part needs no SSR, so
  the medium tier gets it.
- **The street**: only what the existing SSR sees, which is Toronto's (half resolution, 42 m rays, one frame, no
  accumulation). Ben's fork traces 150 m and accumulates 16 frames. There is no hero cube-map probe here, so a car's coat
  does not mirror the buildings behind the camera, and anything off screen is missing from a puddle.
- **Environment reflection in a canyon is still the sky's**: the coat is attenuated by the canyon AO, which is the
  hemisphere term's. The sky-occlusion work in progress should darken it where the skyline hides the sky; this change
  deliberately does not touch it.

## Painted-in reflections removed

- The wet road's emissive copy of the sky and the Times Square neon tint (a New York leftover) are gone where the
  coat is on: the coat mirrors the environment and SSR mirrors the lit street instead. Kept on, the painted sky made a blue sheet
  of the wet road in the rain at night (capture `noglint-wetnight`, jf-rcw, 25 November).
- The cars' paint had no painted-in sky (its reflections were its metalness); that metalness is gone.
- **Not touched**: `createCarPaintMaterial` (bicycle frames: it paints a sky blend into the colour; a bicycle frame is not
  a car, and the cost of leaving it was nil), the storefront and curtain-wall glazing, the water.

## Not done

- **Lake, harbour and rivers**. The default water is John's stylized shader, which copies the frame mid-pass for its
  refraction and has its own night skyline reflection; `?water=pbr` is mrdoob's estuary water, not this repository's
  default. A water-IOR dielectric would replace working systems for no gain; skipped.
- **Helicopters, bike frames, police light bars**: not named, and none is a driving or walking sight at street level.

## Cost

Measured on the Mac mini (M4) through `gpu2`, which other agents were also using: indicative, not budgets.

- **Shader compile** (the `[init] ... compile` line, 6 loads each way): 4648 ms off, 4681 ms on (+33 ms, inside the
  spread of 4516-4833). The number of materials, and so of pipelines, is unchanged: each physical material replaces a standard
  one; the Rocketbox body material is swapped for a physical copy of itself.
- **Frame time** (uncapped, three alternating pairs, 8 s windows): street at golden hour 16.54 -> 16.68 ms mean, skyline
  15.11 -> 15.20, wet street (forced rain) 16.03 -> 16.00. The frame is CPU-bound here (render submission 12-14 ms), and the layers
  add no draw calls, so this says the CPU is unchanged; it cannot see a GPU cost under 16.7 ms.
- **GPU time**: the per-pass timestamp queries (`?gputime=1`) were too noisy to read on the shared mini, with swings of
  +/-40% between runs of the same arm; no number is claimed.
- **Phones**: `low` keeps the standard materials (nothing added). `medium` gets the coat without SSR.

Scripts: `tools/material-layers/` (`run.sh` the pictures, `run-perf.sh` frame time, `run-gpu.sh`, `run-tiers.sh`, the shot
lists and `shot-helper.js`). Run with `gpu2 slop-toronto-material-layers -- sh tools/material-layers/run.sh`.
