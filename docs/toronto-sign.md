# The TORONTO sign (Nathan Phillips Square)

Bead `jf-gdw`. `js/toronto-sign.js` draws the 3D TORONTO sign on the north coping of the reflecting pool: seven pastel letters on a low plinth, facing south across the water, lit from inside (a quiet glow by day, the full colour at night on the windows' night ramp). It stands all year. Slop draws the word only: no maple leaf, no medicine wheel, no vinyl wrap, nothing else.

## Is it there now?

Yes. The City of Toronto's [Toronto Sign page](https://www.toronto.ca/city-government/awards-tributes/tributes/toronto-sign/) (read 2026-11-26, with the 2026 commemorative lighting schedule on it) says a new 3D TORONTO sign was installed at Nathan Phillips Square in September 2020, a more durable replica of the July 2015 original, illuminated, three metres tall. TorontoToday reported days before 2026-11-26 that it had changed its vinyl wrap (the fourth) to a design by an Indigenous artist; the sign itself was not replaced. The 2025 orthophoto (below) shows it.

## Where the numbers come from

- **Place**: the City's 2025 orthophoto of the square ([cot_ortho_2025_color_8cm](https://gis.toronto.ca/arcgis/rest/services/basemap/cot_ortho_2025_color_8cm/MapServer), 8 cm, read 2026-11-26). The sign's pastel tops and a long shadow run along the pool's north edge, 3 m beyond it. Projected into the world frame, the whole sign (with its wheel and leaf) runs from x −22.3 to 8.5 at z −821.7. The Wikipedia coordinate (43°39′9″N 79°23′1″W) is a whole-second rounding and falls about 14 m off, on empty paving, so the orthophoto is the position.
- **Letters**: a photograph from the pool side ([Wikimedia Commons, 3DTorontoSignSept2020.jpg](https://commons.wikimedia.org/wiki/File:3DTorontoSignSept2020.jpg)) gives the order of the colours (T blue, O green, R pink, O lilac, N green, T pink, O blue), that the face looks south, that the word reads west to east, and the proportions: the wheel at the west end and the leaf at the east end take about 9 m of the 31 m, so the letters run x −19.7 to 1.9 (21.6 m; Wikipedia gives 22 m long).
- **Size**: 3 m tall in all (City). The model is a 0.45 m plinth with letters 2.6 m high, 0.9 m deep, with 0.55 m strokes; each letter is a flat outline extruded (`letterPieces`), about 900 triangles and one draw call plus the plinth.

## Not done

- The letters' exact widths and stroke are from the photograph by eye, not a survey, and the sign's coloured wrap is not drawn. A person can climb on the real letters; here the plinth and letters are one solid collider along the pool's edge.
- Slop does not draw the 2026 wrap, the maple leaf or the medicine wheel.

## Checks

```sh
node --test tests/toronto-sign.test.mjs
```

Captures: `tools/capture-realism-fixes.sh` (`JOB=rink`), the square by day and at night in the real late-November season.
