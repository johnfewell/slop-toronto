# Holiday installations

Bead `jf-hcu`. Toronto's holiday-season installations appear in the scene only on their real dates. They follow the scene's day the way the rinks do (`CITY.SITE_DATE`, `js/seasons.js` `siteDay()`; see [docs/live-sky.md](live-sky.md#seasons)): Toronto's date when the city opens live, the presets' 22 August on a `?time=<preset>` open or an unconfigured automated capture, and a capture fixture's `?liveDate=` (else `?liveClock=`) day. The day is chosen once at load, like the rinks, so a preset picked later does not add or remove them. On the summer presets nothing shows.

`?holiday=0` turns every installation off. `?holiday=1` shows both on any date, as a preview. `CITY.holidayStats` reports what was built.

## What is drawn, and where the dates come from

| Installation | Dates | Source |
| --- | --- | --- |
| Nathan Phillips Square: the holiday tree and light arches over the reflecting pool | **28 Nov 2026 to 7 Jan 2027** | City of Toronto, [Cavalcade of Lights](https://www.toronto.ca/explore-enjoy/festivals-events/cavalcade-of-lights/) ("November 28 to January 7", opening night Saturday 28 November, tree lighting 6:30 p.m.); the City's [sponsor page](https://www.toronto.ca/business-economy/partnerships-sponsorships-donations/sponsor/major-festivals-events/cavalcade-of-lights/) gives the same range; the City's [news release](https://www.toronto.ca/news/cavalcade-of-lights-to-brighten-nathan-phillips-square-this-holiday-season/) says the lighting elements and select installations stay until 7 January |
| Distillery District Winter Village (Toronto Christmas Market): its tree, overhead light strings over the lanes, stalls | **12 Nov 2026 to 3 Jan 2027** | The organiser, [thedistillerywintervillage.com](https://thedistillerywintervillage.com/) ("will run from November 12, 2026 to January 3, 2027", tree lighting Thursday 12 November, 6 p.m.); the same dates in [NOW Toronto](https://nowtoronto.com/news/toronto-distillery-winter-village-2026/) and [To-Do Canada](https://www.todocanada.ca/distillery-district-sets-dates-for-2026-season-of-iconic-toronto-christmas-market/) |

The windows are month-day ranges that run over the new year (`HOLIDAY_WINDOWS` in `js/holiday.js`). **Only the 2026-27 dates are published.** For any other year the game reuses the same days, which is an assumption (the festival's date moves with the calendar; the 2025 Village ran 13 November to 4 January). Opening night, tree lighting times and a Christmas Day closure are not modelled: an installation stands for its whole window.

### What the sources do not say

- The City page names illuminated art installations at the Square (ECHO and Ripples in Time) and the tree and Square lighting. It does **not** describe light arches. The arches over the pool are a generic stand-in for the Cavalcade's lit installations, drawn as plain hoops of steel and bulbs. They copy no artwork and nothing is claimed about the real installations' form.
- No source places the tree at either site, and no source maps the village's stalls or light strings. The Square's tree stands just beyond the east end of the City's mapped rink and pool polygon (asset `43599`), on the open paving. The Village's tree stands in the open spot with 7 m clear all round nearest the district's centre. Its height is a game choice (17 m and 9 m).
- No source gives the stall count. Stalls (32) and the overhead strings (45) are a game layout derived from the mapped building footprints inside the district's outline (`tools/build-holiday-lanes.mjs` writes `js/toronto-holiday.js`): a string spans an open gap of 6 to 18 m between walls at least 5.5 m high, and stalls hug the walls of lanes beside those strings.

### Considered, not drawn

Lights on the trees in Yorkville and the Bloor-Yorkville BIA, the Eaton Centre / Yonge-Dundas Square tree, and BIA streetlight wreaths. No source was checked for their dates and locations in this pass, and the wreaths need the streetlight positions the scene does not map for each BIA. They are optional in the brief and were left out rather than guessed.

## Look and cost

- Low poly. One merged mesh per site (tree tiers, trunk, arch bars, wires, stall bodies and gabled roofs, vertex-coloured) and one `InstancedMesh` per bulb colour (warm, cool, red, green, gold). No lights are created per bulb.
- Bulbs are emissive. By day they show at about a third of their colour, readable but not glowing. At night they use the same ramp as the windows (`cityUniforms.uInteriorGlow`, as the rinks' floodlit ice does) and a gentle per-bulb twinkle driven by `time` and the instance index.
- Colours are a restrained warm white, cool white, red, green and gold. There are no logos, brand marks or artwork.
- The trees are evergreens; the surrounding street trees follow the season and are bare on these dates.
- The tree trunks and stalls have colliders (`obb` footprints, as the rinks' boards do); the string and arch bulbs and wires do not.
- When off, nothing is built (no meshes, no materials). When on, about 6 draw calls per site, about 1,500 bulbs and about 39,000 triangles in all.

## Checks

```sh
node --test tests/holiday.test.mjs
node tools/build-holiday-lanes.mjs     # after a geodata change
```

`tests/holiday.test.mjs` covers the window edges (11 Nov off, 12 Nov Village on, 27 Nov Village only, 28 Nov both, 3 Jan Village's last day, 4 Jan Square only, 7 Jan Square's last day, 8 Jan off), the summer preset and other off-season days, `?holiday=0` and `?holiday=1`, that a summer or `?holiday=0` scene gets nothing added and an in-window day builds both groups, that strings, stalls and the tree stand in the open between mapped buildings, that the committed layout equals its builder's output, and the script order in `explore.html`.

Captures (`tools/shots/holiday.json`, Mac mini via `gpu2-local`), with `CAPTURE_QUERY` as `?liveClock=2026-11-28T12:30:00-05:00&liveDate=2026-11-28` (day), `T20:30:00-05:00` (night) and the same with `2026-08-22` (outside the window, nothing shown). `tools/shots/holiday-perf.json` is the on/off pair: the same night scene on 5 December with and without `&holiday=0`. On the shared Mac mini both were capped near the display rate (48, 53 fps on against 48, 48 off), so frame time is unchanged within noise; these are functional, not performance numbers.
