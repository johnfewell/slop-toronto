# Freedom Arches

Bead `jf-6p1`. The three concrete arches that span the reflecting pool at Nathan Phillips Square. They are part of Viljo Revell's 1965 design for the square, stand all year, and are what the City lights for the Cavalcade of Lights. `js/freedom-arches.js` draws them; `js/holiday.js` adds the Cavalcade's bulb lines inside the window ([holiday-installations.md](holiday-installations.md)).

## Where the numbers come from

The City of Toronto's [3D Massing 2025](https://open.toronto.ca/dataset/3d-massing/) multipatch (Open Government Licence – Toronto) holds the arches as one separate feature (1,195 faces). `node tools/measure-freedom-arches.mjs <3DMassingMultipatch_2025_WGS84.gdb>` re-derives these numbers from it:

| | |
| --- | --- |
| Arches | 3, running across the pool's short side, 8.4 to 8.5 m apart; centre lines 12.18, 20.67 and 29.06 m east of the world origin |
| Span | 38.56 m between the outer feet (z −823.20 to −784.64, centre z −803.92) |
| Rise | 9.14 m at the crown; the underside is 8.64 m, so the arch is 0.5 m deep at the crown |
| Width | 1.55 m (x) |
| Shape | the top and the underside are both very nearly half ellipses (a half span and a rise each); the model uses 19.28 × 9.14 m outside and 18.08 × 8.64 m inside, which makes the feet about 1.2 m thick |
| Feet | a 1.9 m square footing block, 0.35 m high, at each foot (seen in the City's 2025 orthophoto; the massing has them as ground-level faces) |

Cross-checks:

- The City's 2025 orthophoto of the square ([cot_ortho_2025_color_8cm](https://gis.toronto.ca/arcgis/rest/services/basemap/cot_ortho_2025_color_8cm/MapServer), an 8 cm export of the pool, read 2026-11-26) shows three plain concrete arches across the pool's east part, their feet on the paving just beyond the pool's coping and a long shadow of each across the water. Their count, spacing and span match the massing.
- The arches were part of Revell's original scheme with the pool; they were named the Freedom Arches after the Berlin Wall fell in 1989 and were first installed as aesthetic structures and tracks for lighting ([Wikipedia: Nathan Phillips Square](https://en.wikipedia.org/wiki/Nathan_Phillips_Square), [UrbanToronto](https://urbantoronto.ca/news/2014/11/photo-day-freedom-arches.14290)). No published source was found for their dimensions, so the massing is the only measured source.

### Over the rink and pool polygon

The City's rink polygon for the square (asset `43599`) is 54.6 m (x) by 30 m (z), centred on z −803.9, the same as the arches' span. The three arches stand inside its length (x −19 to 36) and cross its width, with their feet 4 to 5 m beyond its long edges, on the paving (the City's polygon is smaller than the pool the orthophoto shows, about 76 × 41 m, so the arches' feet sit at the pool's real edge). The rink boards run along the polygon's edge; the soffit is 4.8 m above it, so nothing touches them. There is no TORONTO sign model in the scene to clash with.

## What is drawn

- One merged mesh in warm light-grey concrete (`0xd4d0c6`, the City Hall massing's concrete look), three arches of 48 segments and six footing blocks, about 1,300 triangles, one draw call, casting and receiving shadows. It does not change with the season.
- Colliders: six boxes, one at each foot, from the foot to where the underside reaches 2.3 m. People walk and skate under the span between them. `tests/freedom-arches.test.mjs` checks that the leg boxes stand beyond the rink polygon's edges and that none crosses the middle of the span.

## The Cavalcade of Lights (28 Nov to 7 Jan)

Inside the window each arch carries two bulb lines: one along the crown (every 0.9 m) and one under the soffit (every 1.0 m), 3 × about 105 bulbs. They use the holiday bulb instances: warm white on the first and third arches, cool white on the middle one, with a gold bulb every ninth. By day they show at about a third of their colour; at night they glow on the windows' ramp with the gentle per-bulb twinkle. The generic hoops PR #196 drew as a stand-in are gone. Outside the window, or with `?holiday=0`, the arches are plain concrete.

## Checks

```sh
node --test tests/freedom-arches.test.mjs tests/holiday.test.mjs
node tools/measure-freedom-arches.mjs <3DMassingMultipatch_2025_WGS84.gdb>   # prints the numbers above
```

Captures (`tools/capture-freedom-arches.sh`, `tools/shots/freedom-arches.json`, Mac mini via `gpu2-local`): day and night inside the window (`liveDate=2026-11-28`, the street trees are bare), and 22 August (plain arches).
