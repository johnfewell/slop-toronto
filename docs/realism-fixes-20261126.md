# Realism fixes of 2026-11-26

Three small items found by the day's agents (beads `jf-gdw`, `jf-dr1`, `jf-lu7`). Captures: `tools/capture-realism-fixes.sh` on the Mac mini through `gpu2-local`, in the real late-November season (`liveDate=2026-11-26`, no season preset, trees bare, `liveWeather=Sunny` so the cloud cover is the same in every frame).

## 1. Nathan Phillips Square pool (jf-gdw): the outline was right; the TORONTO sign was missing

The City's polygon for the rink and pool (asset `43599`, 54.6 × 30 m) is not too small. The "about 76 × 41 m" in the orthophoto was a Web Mercator reading (stretched by 1/cos 43.65° = 1.38); in world metres the pool corners read from the 2025 orthophoto are within 0.4 m of the polygon. Nothing about the ice, pool, boards or lights changed; the arches' feet stand 4 to 5 m beyond the pool's long edges, as the orthophoto shows. Details and the pinning test: [freedom-arches.md](freedom-arches.md), `tests/toronto-sign.test.mjs`.

The 3D TORONTO sign does stand at the square now (City page, 2026), so it is drawn: [toronto-sign.md](toronto-sign.md).

## 2. The black roof (jf-dr1)

**Cause.** `createRoofMaterial` (js/buildings.js: every hipped, sheet and flat tar roof the buildings code draws as roof triangles) set `vertexColors: true` and also read the vertex colour in its `colorNode`. three's node material multiplies the colour by the vertex colour when that flag is set, so every roof's colour was squared. The restored building at (−1858.6, 139.9) (massing 100832, a hipped house roof) drew the charcoal `0x2c2d30` of the roof palette: 0.025 linear, squared 0.0006, which is black. Checked on the Mac mini: the roof's vertex colour read back as 0.025, 0.026, 0.030, its normals point up and its geometry is right, and replacing the material's colour in the page with a mid grey (0.3) only lifted the roof from 12/255 to 25/255 instead of to a mid grey, which is what a second multiplication does. Under the low November sun the darkest of the palette read pure black; in August's high sun the same roof reads dark slate. The other four restored buildings were not black but were darkened by the same squaring: the flat tar roofs of 103837 and 105149 came out dark green and dark grey, and now show the tar palette's pale greys.
**Fix.** The material no longer sets `vertexColors`, so every roof shows its palette colour once. Every hipped, sheet and flat tar roof in the city is lighter and less saturated than before (compare `after-roof--*` with `before-roof--*`); the charcoal roof is now a dark slate with its shingle rows showing. `tests/roof-material.test.mjs` pins the material and that no roof paint is near black.

**Same pattern elsewhere (fixed afterwards, jf-xql).** `js/high-park-features.js` `M.solidSnow` (roofs and hedge tops of the High Park features) and the palm trunk material in `js/street-details.js` had the same `vertexColors` plus `colorNode` pair; both are fixed, with a test over every material in `js/`: [material-colours.md](material-colours.md).

## 3. The Eglinton frame "dim and overcast" (jf-lu7): not a real difference

On 2026-11-26 12:30 (sun 25° up) the default page (the bigger, Eglinton map) and `?map=detail` have identical exposure (1), tone mapping, fog, environment, sun, hemisphere light, and sky occlusion settings (`tools/shots/realism-light-state.json`); the same view of Sugar Beach in both is the same picture. The sky occlusion height map covers the Eglinton frame (4525 × 2875 texels of 4 m, 148,559 colliders, from x −7900 to 9600 and z −7300 to 3600; the furniture agent's corral at z −6957 is inside it). Standing on Eglinton Avenue West and on Queen Street West with the same view and the same weather, the mean luminance of the frames is 0.43 and 0.44, and the shading, shadows and sky look alike. What looked overcast in the furniture agent's captures is the cloud field at that spot and moment (the clouds are one world-positioned field; the capture did not pin the weather), plus a view whose sun was behind a building. Nothing was changed. To compare maps, pin `liveWeather=Sunny` and use the same camera.

## Twilight (looked at, not changed)

At 16:50 on 26 November (sun 1.8° below the horizon) the page uses the `twilight` preset almost unchanged (hemisphere 0.85, sun 3.1 held 3° up, so it grazes every roof: the horizontal surfaces get only the hemisphere light, 11 times less light than at midday, 3.5 stops). At 17:20 (7° below) the moon from 55° up lights them, so the roofs are brighter than half an hour earlier. The darkness is the preset's art direction (docs/live-sky.md), the values are as written, and nothing in it is a bug, so it was left; if twilight should read lighter, the sunset preset's hemisphere intensity or the moon's lead-in are the two numbers to move.
