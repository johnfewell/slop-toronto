# Live sky: Toronto's real time of day and weather

Bead `st-z3e`. `/explore` now opens with the sun where it really stands over Toronto, under the sky Pearson reports
right now. The four time presets stay as manual overrides. Captures and tests never start live mode on their own.

## What the engine already had

- **Time of day.** There are four art-directed presets in `js/lighting.js` (`TIME_PRESETS`): golden hour, midday,
  sunset (`twilight`) and night (`midnight`). Each is a full set of values: sun direction, colour and intensity,
  hemisphere fill, fog colour and density, the Preetham sky dome's turbidity and exposure (it bakes the image-based light
  and the fog colour), window glow, road wetness and the night factor. Each preset also has a colour grade in
  `js/post-processing.js`. The sun directions come from NOAA's solar position equations for a fixed day, 22 August.
  At night the streets are lit from a fixed "moon" direction, while the physical sky gets the real 23:00 sun.
- **Sky.** On WebGPU, takram's physical atmosphere draws the sky and the aerial perspective (`js/sky-clouds.js`),
  with John's `three-clouds-webgpu` volumetric clouds on top, on every quality tier (low and medium march at lower
  resolution). Stars and moonlit clouds appear at night. On WebGL2 there are no volumetric clouds; the dome's painted
  clouds are used instead.
- **Weather.** The cloud library has six cloud-type presets: `fairWeatherCumulus` (the app's only sky until now),
  `stratocumulusDeck`, `overcastSheet`, `highCirrus`, `groundFog` and `mixedSky`, plus a `coverage` value. Three of
  them (fair-weather cumulus, stratocumulus, overcast) have the same graph shape: one lane, shadowing, no exponential
  term. Switching between them only writes uniforms. `highCirrus` drops the shadow, `groundFog` adds an exponential
  term and `mixedSky` adds lanes, and each of those rebuilds the cloud march, which means a compile hitch.
- **Fog and haze.** The city has its own height fog with the sky's colour (`uFogDensity`, the aerial fog node). With
  the atmosphere on, only twilight and night keep part of it. The atmosphere's aerosol haze is fixed when it is built
  and can't be changed later.
- **Wet roads.** `cityUniforms.uRoadWetness` drives the damp stains, the wet film and the puddles on roads and
  sidewalks.
- **Not available:** falling rain or snow, snow cover on the ground, lightning, wind on the trees, and seasonal foliage.
  The scenery stayed at 22 August whatever the date (`SCENE_DATE`); see [Seasons](#seasons) for what follows the date
  now.

## Design

`js/live-sky.js` holds the pure logic and is tested in node. `js/lighting.js`, `js/sky-clouds.js`,
`js/post-processing.js`, `js/precipitation.js` and `js/main.js` apply it.

**Time (continuous).** `solarPosition(date, 43.65, -79.38)` uses the same NOAA equations as the presets; they now live
in one place, and the presets come out identical. In live mode, `lighting.applyLive(date, look)` blends **all four
presets** by the sun's elevation. The anchors are night at -9° or below, sunset light at -1°, golden hour at 10° and
midday from 32° up, with smoothstep cross-fades in between. Every number and colour is blended, and so is the colour
grade. `activePresetId` becomes the preset with the largest weight, so the parts of the city keyed to a preset (audio,
TTC headways, photo mode) keep working. Traffic volumes use the real Toronto hour.

The sun's direction is the real one, with three adjustments:

- The city is never lit from below the horizon. The light is held at least 3° up, then turns into the presets'
  moonlight as the sun goes from 0.5° to 9° down.
- The physical sky's sun is lifted up to 2.5° through dusk and dawn. Without that, the sky went black minutes after the
  real sunset, because its exposure is tuned for daylight.
- Stars come in with the square of the night weight, and a live overcast hides them.

**Advancing.** While live, the sun is re-placed **every minute** with the real clock, and again when the tab comes
back into view, so it does not only change on reopen. Each re-placement re-bakes the environment map (one small PMREM
bake a minute). The reading is fetched again every 30 minutes; ECCC observes hourly.

**Weather.** The landing page's feed, parsing and `sessionStorage` cache are reused: the key `slop-toronto:weather`
and the `{ at, data }` shape, kept 10 minutes. The fetch starts as the app boots and never blocks: it times out after
4 s, and the sky starts with the default look. When the reading arrives, the weather is applied. Any failure, a
non-Pearson station, an unparseable payload or a reading **over 3 hours old** falls back to the real time under the
default fair sky. That is the same fair-weather cumulus at 0.32 coverage the presets use.

| ECCC condition (first match wins) | Kind | Clouds (type, coverage) | Light | Fog floor | Wet roads | Falling |
| --- | --- | --- | --- | --- | --- | --- |
| Thunderstorm, lightning, funnel cloud | thunderstorm | overcast sheet 0.99 | sun ×0.10 | 0.0006 | 1.0 | rain, heavy |
| Freezing rain/drizzle, ice pellets, sleet, hail | freezingRain | overcast sheet 0.97 | sun ×0.15 | 0.0006 | 0.95 | rain |
| Snow, flurries, snow showers, blowing snow, ice crystals, rain and snow | snow | overcast sheet 0.96 | sun ×0.20 | 0.0009 | 0.35 | snow |
| Showers, rainshower | showers | stratocumulus 0.78 | sun ×0.45 | 0.0003 | 0.8 | rain, lighter |
| Drizzle | drizzle | overcast sheet 0.95 | sun ×0.18 | 0.0005 | 0.75 | rain, light |
| Rain, precipitation | rain | overcast sheet 0.97 | sun ×0.15 | 0.0006 | 0.92 | rain |
| Fog, fog patches | fog | overcast sheet 0.95 | sun ×0.18 | 0.0022 | 0.35 | — |
| Mist | mist | stratocumulus 0.80 | sun ×0.40 | 0.0008 | 0.3 | — |
| Haze, smoke, dust | haze | fair cumulus 0.28 | sun ×0.80 | 0.00045 | — | — |
| Cloudy, overcast | overcast | overcast sheet 0.95 | sun ×0.22 | 0.00028 | — | — |
| Mostly cloudy, increasing cloudiness | mostlyCloudy | stratocumulus 0.62 | sun ×0.60 | — | — | — |
| Partly cloudy, cloudy periods, sunny periods | partlyCloudy | fair cumulus 0.42 | sun ×0.92 | — | — | — |
| Mainly sunny/clear, a few clouds | mainlyClear | fair cumulus 0.26 | — | — | — | — |
| Sunny, clear | clear | fair cumulus 0.16 | — | — | — | — |
| None, stale, "Not observed", unknown | (fair) | fair cumulus 0.32 | — | — | — | — |

"Light" and "Heavy" scale the amount of rain or snow. Under cloud, the sky fill rises, and the light, sky dome and fog
colours go toward neutral grey. The grade loses a little saturation and gains exposure on a grey day (up to ×1.4 in
fog), as a camera would expose for it; at night the exposure stays as it is. All of these are uniform writes. Only the
three single-lane cloud types are used, so no weather change rebuilds the cloud march.

**Rain and snow** (`js/precipitation.js`). Both live in a box that follows the camera. Each drop moves in the vertex
shader (seed, shader clock, camera position), with no per-drop CPU work, one draw call, no shadow and no depth write.
Drops fade out at the box's edge, so none pops as it wraps, and right in front of the lens; a drizzle shows fewer.

- Rain is 60,000 one-pixel line segments (`LineSegments`, the cheapest primitive) in a 40 × 20 × 40 m box. Each
  streak is the drop's blur over a 1/18 s exposure: bright at its head, fading to nothing at its tail. Each drop
  falls at its own speed, 8.5 m/s give or take a third (a drizzle's drops fall slower), and leans with the wind.
  live-sky.js reads no wind yet, so the default is a modest westerly breeze, about 12° off vertical; `look.wind`
  (`[x, z]` in m/s) takes a reading's wind when there is one. The colour is the fog's (the sky's light a drop
  refracts), a little darker. Under a bright grey noon sky (the fog's luminance) the streaks go darker still and a
  little more opaque, so they read as thin grey lines against pale walls. At night the lit city adds a faint glow,
  and the four streetlights nearest the camera (street-details.js's spot pool, nearest first) light the drops within
  10 m of them.
- Snow is soft swaying camera-facing discs.

The mesh is built the first time a reading needs it, so a dry sky has no mesh, no draw call and no shader. It is
hidden inside the subway and in a seat inside a streetcar. Drops: 60,000 rain or 4,500 snow on high, 60 % of that on
medium, 35 % on low (phones). `__CITY_APP.precipitation` is the module, for captures.

**Modes and overrides.** The toolbar has a **Live** button before the four presets. While live it is highlighted,
shows "Live · 4:12 pm" with a red dot, and its tooltip gives Pearson's condition. Choosing a preset is a manual
override: you get the classic art-directed look, with its own clouds, no rain and no weather, and a toast says to
press Live to get Toronto's sky back. Pressing Live returns to it. Live is not remembered across reloads; each open
starts live. Photo mode and overlays that hold time restore live when they close. On a phone the toolbar is now kept to the
screen, and the time buttons scroll sideways inside it. On main, at 412 px, it already ran 30 px off the left edge.

**Determinism.** `resolveStartup()` decides the opening mode:

- `?time=golden|midday|twilight|midnight` opens on that preset. `?time=live` asks for live.
- Under automation (`navigator.webdriver`, which covers every Playwright capture and browser test), the app opens at
  golden hour exactly as before, whatever the clock or the weather. Every existing shot list is unchanged, and a test
  checks that none of them turns live on.
- A capture can opt in with a fixed fake clock and condition: `?liveClock=<ISO instant>&liveWeather=<ECCC text>`, or
  `__CITY_APP.liveSky.inject(clock, condition)` from a shot's `js`. Both are honoured only under automation. A faked
  sky is frozen; it does not advance or fetch. `__CITY_APP.liveSky.state()` reports the mode, sun, weights, weather,
  clouds, fog and wetness. `tools/shots/live-sky.json` covers clear noon, overcast late afternoon, fog in the morning,
  rain, snow, dusk and night, each from the lake and from the street.
- `?liveReading=1` with a fixture holds its condition back: the city opens live under the default sky, and the
  condition goes through the startup's reading handler, already resolved, the way Pearson's reading does on a real
  open. `node tools/check-live-sky-startup.mjs` (on the mini, after `npm run build`) runs it on desktop and on the
  phone tier with `tools/shots/live-sky-startup.json`, and fails on any WebGPU error in the console or if the reading
  never landed.

**Startup order (bead `st-eyy2`).** The reading's fetch has usually finished by the time the city is built, so its
handler runs at the startup's first await, which is inside the shader precompile (`precompileShaders()` in
`js/main.js`). Re-applying the sky there re-baked the environment map in the middle of the precompile: the six cube
faces were drawn under the scene pass's render target and MRT, which the precompile leaves on the renderer across its
awaits, and the sky's shader was built in the middle of another material's build. That gave "struct OutputType {}"
WGSL errors for two materials and six invalid command buffers, once per real open (fixtures never re-applied). Now a
sky change that comes in during the precompile is kept and applied as the precompile ends, before the warm-up frame,
so the first frame on screen already has the reading's weather. At any other time a change applies at once, as before.

## Seasons

Bead `st-59jl`. While live, the scenery follows Toronto's real date the way the sky follows its real time and weather:
autumn colour in October, sparse and then bare broadleaf trees from late November to April, spring's fresh green,
the grass's tone through the year, and snow lying on the ground. A time preset is still the classic summer of 22 August,
and nothing about the choice is remembered (every open starts live). Captures and tests keep golden hour in summer.

**Design.** `js/seasons.js` holds the pure logic and is tested in node (`tests/seasons.test.mjs`). `main.js`
(`applySeason`, called from the same `applyVisualTime` that applies the sky) writes five render-group uniforms in
`tsl-materials.js` `cityUniforms`, and the shaders read them:

| Uniform | Means | 22 August | Driven by |
| --- | --- | --- | --- |
| `uLeaf` | leaves on the broadleaf trees, 1 full .. 0 bare | 1 | 0 to 15 April, 1 from 12 May to 22 October, 0.55 on 6 November, 0 from 24 November |
| `uAutumn` | autumn colour of the leaves still on | 0 | from 12 September, every tree turned by 16 October; 0 again from 1 January |
| `uSpring` | spring's fresh, yellower green | 0 | from 8 April, full 25 April to 20 May, gone by 15 June |
| `uDormant` | dormant grass, tan and olive | 0 | 1 to 25 March, green by 28 April, dormant again from 20 October to 1 December |
| `uSnow` | snow lying on grass, open ground and roofs | 0 | Pearson's condition and ECCC's snow-on-ground record (below) |

Between keyframes the values are smoothstepped by day of the year (29 February counts as the 28th). At 22 August
every one is the identity of the shaders that read it, so the presets look exactly as before.

- **Broadleaf trees** (`ez-trees.js` `seasonNodes`). The EZ-Tree atlases have the leaf spray on the left (u < 0.8) and
  the bark on the right. On the spray, leaves are the green texels and stalks and twigs the brown ones (relative
  greenness: leaves 0.25-0.65, twigs under 0.1). Each leaf has a key: smooth noise over the spray plus a per-tree hash
  of where the tree stands (`aLodOrigin`). Leaves turn by it (`autumnLeaf`: mostly yellow, some orange, a few red, oaks
  brown, each tree on its own schedule) and fall by it (`leafStays`: discarded in colour and in the shadow maps). The
  twigs on the cards stay, as the bare crown's tracery. Pines are built without these nodes and stay green.
- **Far crowns** (mrdoob's whole-crown cards, `createTreeMaterial`; also the fallback trees). These turn and fall the
  same way, keyed on the atlas's per-leaf random channel. A bare far crown keeps a third of its texels as a grey-brown
  haze of twigs, because a leafless tree seen from a distance is not empty.
- **Grass** (`seasonalGrass`): park lawns, front yards, the wild ground, the rail embankments, and the far land's parks
  and canopy (`surroundings.js`, where the canopy also turns and goes bare grey-brown).
- **Snow** (`snowOver`): lawns, yards and beds (shovelled walks and driveways keep little), the open ground (rock
  less), the flat roofs of all three facade materials, the hipped and shed roofs (on the slopes that hold it), and the
  far land and its roofs. It is patchy while thin and a full cover from `uSnow` 1. Streets and sidewalks stay clear
  (Toronto ploughs and salts them). No new geometry.

**Snow on the ground.** `seasons.js` `snowCover` takes the larger of:

- falling snow now: Pearson's condition is snow. That gives 0.9, thinning to 0.35 as the temperature rises above
  freezing, because wet snow melts as it lands.
- what lies on the ground: ECCC's daily climate record for Toronto Pearson (climate ID 6158731,
  `api.weather.gc.ca/collections/climate-daily`, keyless, with CORS). Its `SNOW_ON_GROUND` (cm, read each morning)
  gives 0.5 at 1 cm and a full cover from 10 cm. Without a depth, 1 cm or more of `TOTAL_SNOW` over the last three
  days, with highs of 3 °C or less, gives a thin cover. Above 4 °C what lies thins out (to a third by 14 °C). A
  record more than three days old counts for nothing.

The record is asked for only from 15 October to 30 April, while live, at most every 3 hours. It is cached for an hour
under `slop-toronto:snow` in `sessionStorage`. It never blocks: it times out after 4 s, and any failure means no
lying snow. The record runs a day behind at best. Falling snow shows at once.

**Determinism.** As with the sky, automation opens at golden hour, which is summer. Two capture-only parameters are
honoured exactly where `?liveClock=` and `?liveWeather=` are (under `navigator.webdriver`) and ignored otherwise:

- `?liveDate=YYYY-MM-DD` (or `MM-DD`) sets the scenery's day while live, whatever the fixture's clock says. The same
  light can then be compared across seasons.
- `?liveSnow=<cm>` stands in for the morning's snow-on-ground record.

From a shot's `js`, `__CITY_APP.seasons.inject(date, snowCm)` does the same and `__CITY_APP.seasons.state()` reports
the day, phase and uniform values. `inject` doesn't turn live on; `liveSky.inject` does. `tools/shots/live-sky-seasons.json`
captures Trinity Bellwoods from the street and from 95 m up: the summer preset, 15 October (from the run's
`?liveDate=2026-10-15`), 5 December clear, 15 January snowing, and 16 January sunny with 15 cm on the ground.

**Cost.** A date change is a few uniform writes, only when a value changes (the minute's live tick recomputes them).
No material is rebuilt and no shader recompiles: the test builds every seasonal shader's WGSL in summer and in deep
winter and checks they are byte for byte the same. Per frame on a static day:

- the broadleaf trees evaluate one small value noise and a hash per leaf texel, plus the colour mixes (the pines
  nothing);
- the grass shaders evaluate a few mixes;
- lying snow costs nothing on a snowless day, and nothing on walls. It is behind a branch on `uSnow` × the surface's
  amount, and inside it are two value noises.

The phone tier runs the same shaders. Like the sky's, the captures are functional, not performance numbers.

**The scenery built at load** (bead `st-1m40`). The rinks (`rinks.js`), the CaféTO patios (`cafeto-patios.js`) and
the bikeways bent round the patios' platforms (`cycling.js`) are geometry, colliders and routes, not uniforms. They
follow the day the city **opens** on, chosen once before any of them is built: `seasons.js` `siteDay()` sets
`CITY.SITE_DATE` (`explore.html` loads `live-sky.js` and `seasons.js` before `cycling.js` for this).

| The city opens | `CITY.SITE_DATE` | Rinks (ice 1 Dec - 15 Mar) | Patios and bent bikeways (1 Jun - 30 Sep) |
| --- | --- | --- | --- |
| live, a real visit | Toronto's date at load | ice in their season | built in their season |
| on a preset (`?time=<preset>`) | 22 August | off-season | built |
| automated, no fixture (every existing shot list) | 22 August | off-season | built |
| automated, `?liveClock=` (and `?liveDate=`) | the `?liveDate=` day, else the `?liveClock=` day | by that day | by that day |

The day is not revisited. A visit rarely crosses a season's edge (1 June, 1 October, 1 December, 16 March), and the
patios can't be taken away mid-visit for nothing: their colliders, the walkers' detours round the sidewalk cafés and
the bikeways' bends are all laid at startup. So a preset chosen later turns the trees back to summer but leaves the
rinks and patios of the opening day, and `seasons.inject()` doesn't move them either; a capture sets the day in the
URL (`?liveClock=…&liveDate=…`). `?rinks=ice|off` and `?patios=0` still override. `__CITY_APP.seasons.state().sites`
reports the day, its source and what was built.

**Cost.** Out of season the patios return before their fingerprint check (nothing built, nothing routed: the patio
phase drops from about 20 ms to nothing). In season the page takes the same prebuilt layout as before
(`js/toronto-patios.js`, st-hue6), whose inputs don't depend on the date. The rinks' season only picks their surface
colours. Out of season the parked cars keep their prebuilt places, which leave the patios' curb lane stretch empty
and stand clear of the bikeways as mapped as well as bent (`tests/bikeway-detours.test.mjs`).
`tools/shots/live-sky-season-sites.json` captures Nathan Phillips Square's rink, 146 Ossington and 494 Danforth on
each day given by the run's query.

Conifers carry no snow, and neither do the branches.

## Cost

- **Clear or fair sky:** nothing extra per frame. The only cost is the minute's environment re-bake: one PMREM bake of
  the sky dome, the same work a preset change does.
- **Cloudy, overcast, fog or haze:** uniform writes and a cloud history reset when the weather changes. The cloud type
  doesn't change the march's cost, though more coverage means more marching samples hit cloud; this was not measured.
  Fog uses the city's existing fog node.
- **Rain or snow:** one extra transparent draw: 60k one-pixel lines (120k vertices) of rain, or 4.5k quads (18k
  vertices) of snow, on high; 21k lines or 1.6k quads on the phone tier. The vertex maths is simple and a line covers
  only its own pixels, so the fill cost is small. It also compiles one shader the first time it appears. The rain's
  uncapped A/B at King & Bay is in bead st-560z; a real phone measurement is a follow-up.

## Follow-ups (not in this change)

- Distant rain shafts under cells (`experimental.rainShafts`) and lightning flashes (`experimental.lightning`). Both
  rebuild the cloud graph, so they would need to be chosen at startup.
- Wet facades.
- Wind (ECCC reports it) driving the cloud drift and the rain's slant.
- Precipitation under bridges and the Union Station train shed (it is only hidden in the subway and inside streetcars).
