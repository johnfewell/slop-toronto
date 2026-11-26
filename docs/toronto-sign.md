# The TORONTO sign (Nathan Phillips Square)

Beads `jf-gdw` (the word) and `jf-icu` (the wheel, the leaf, the night colours, the fountain). `js/toronto-sign.js` draws the 3D TORONTO sign on the north coping of the reflecting pool, facing south across the water: the First Nations medicine wheel at the west end, the seven letters, and the maple leaf at the east end, on a low plinth, lit from inside (a quiet glow by day, the full colour at night on the windows' night ramp, bright enough for the bloom). It stands all year. The City's vinyl wrap is not drawn.

- **Letters**: thick extruded block capitals with visible side returns (a paler, dimmer edge). By day they read pale with a tint of their colour; at night they glow in the colours of John's night photograph, the sign's default: T cyan, O violet, R magenta, O red, N orange, T yellow, O white. The City's sign changes colour (it is a lit, programmable sign); the model holds the one palette.
- **Medicine wheel**: a disc as tall as the letters (3.2 m with its thin silver rim), four quarters, white top left, yellow top right, red bottom right, black bottom left, lit from inside (the black quarter stays dark).
- **Maple leaf**: an 11-point leaf outline (the top point and five a side) a little taller than the letters (3.3 m), red, with a thin silver rim, lit at night.
- **Water season** (the pool is water, not the rink's ice): the sign's colours run down the water in front of each letter (a soft glow quad each, no reflection pass), and a row of 40 water jets, 0.9 to 2 m, stands 9 m out from the pool's north edge (in the photograph the jets stand well out in the pool, the letters' reflections on the water between), each with a soft lit base in the colour of the letter behind it. The jets are 40 pairs of crossed quads in one mesh (480 triangles with the bases, one draw call each) that rise and breathe with a time node in the shader; no instancing or compute. In the ice season (1 December to 15 March, the rink) the jets and the glow are not built.
- **Fountain months**: the City's park page for Nathan Phillips Square says the square "features a fountain" in spring, summer and fall and that in winter it becomes the ice rink ([toronto.ca facility 1089](https://www.toronto.ca/data/parks/prd/facilities/complex/1089/index.html)). No operating dates are published, so the jets run in April to October (an assumption) and the water glow all the time the pool is water; `?rinks=off` shows the jets in any month. The City's [UrbanToronto 2012 note](https://urbantoronto.ca/news/2012/09/illuminated-fountains-add-colourful-splash-nathan-philips-square) on the redesign shows the fountains are lit.
- **Collision**: one solid box from the wheel's west edge to the leaf's east edge, as tall as the leaf; the jets are not solid.

## Is it there now?

Yes. The City of Toronto's [Toronto Sign page](https://www.toronto.ca/city-government/awards-tributes/tributes/toronto-sign/) (read 2026-11-26, with the 2026 commemorative lighting schedule on it) says a new 3D TORONTO sign was installed at Nathan Phillips Square in September 2020, a more durable replica of the July 2015 original, illuminated, three metres tall. TorontoToday reported days before 2026-11-26 that it had changed its vinyl wrap (the fourth) to a design by an Indigenous artist; the sign itself was not replaced. The 2025 orthophoto (below) shows it.

## Where the numbers come from

- **Place**: the City's 2025 orthophoto of the square ([cot_ortho_2025_color_8cm](https://gis.toronto.ca/arcgis/rest/services/basemap/cot_ortho_2025_color_8cm/MapServer), 8 cm, read 2026-11-26). The sign's pastel tops and a long shadow run along the pool's north edge, 3 m beyond it. Projected into the world frame, the whole sign (with its wheel and leaf) runs from x −22.3 to 8.5 at z −821.7: the model's wheel starts at x −22.3, the letters at −18.6 (22.3 m long, 0.4 m gaps) and the leaf ends at 8.1. The Wikipedia coordinate (43°39′9″N 79°23′1″W) is a whole-second rounding and falls about 14 m off, on empty paving, so the orthophoto is the position.
- **Letters**: a photograph from the pool side ([Wikimedia Commons, 3DTorontoSignSept2020.jpg](https://commons.wikimedia.org/wiki/File:3DTorontoSignSept2020.jpg)) gives the order of the colours (T blue, O green, R pink, O lilac, N green, T pink, O blue), that the face looks south, that the word reads west to east, and the proportions: the wheel at the west end and the leaf at the east end take about 9 m of the 31 m, and John's 2026 night photograph, measured against the 31 m, puts the letters at about 22 m and the wheel and leaf at 3 to 4 m each, so the letters run x −18.6 to 3.7 (Wikipedia gives 22 m long).
- **Size**: 3 m tall in all (City). The model is a 0.45 m plinth with letters 3.0 m high (City: three metres tall), 0.9 m deep, with 0.62 m strokes; each element is a flat outline extruded (`letterPieces`, `wheelPieces`, `leafPieces`), one merged mesh and the plinth.

## Not done

- The letters' exact widths and stroke are from the photographs by eye, not a survey, and the sign's coloured wrap is not drawn. A person can climb on the real letters; here the plinth and letters are one solid collider along the pool's edge.
- The sign holds the photograph's night palette; the City's colour changes (it follows the City's lighting schedule) are not animated.
- The fountain's months are an assumption (above); its jets are a shader effect, not a water simulation, and the glow on the water is not a real reflection.

## Checks

```sh
node --test tests/toronto-sign.test.mjs
```

Captures: `tools/capture-toronto-sign.sh` (summer night with the fountain, 12 December night with the rink and the holiday lights, summer day), the same view as the photograph from the pool's south side.
