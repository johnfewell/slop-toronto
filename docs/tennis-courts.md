# Mapped tennis courts

Bead `st-26p.7`, with terrain overlap bug `st-amv`. The City [Tennis Courts Facilities inventory](https://open.toronto.ca/dataset/tennis-courts-facilities/) supplies facility identities, counts, lighting metadata and public/club listings, not individual court polygons. The existing discovery cards retain those values and their source dates.

`tools/build-tennis.mjs` joins a reviewed set of **43 individual OpenStreetMap courts at ten City facilities**. It uses the existing October 23 Ontario/Geofabrik cache; the cache did not record the original extract timestamp, so this is a processing date, not an asserted OSM edit date. `sports-footprints-20261023.json` retains the source geometry/tags and original cache hash. A whitelist in `tennis-review-20261028.json` records the City association and the aerial review. It excludes the nearby private Boulevard Club and three High Park enclosure polygons that would otherwise duplicate the courts inside them.

Every included cluster was checked against the City's [2025 8 cm aerial imagery service](https://gis.toronto.ca/arcgis/rest/services/basemap/cot_ortho_2025_color_8cm/MapServer). Export requests, image hashes and manual pavement traces are retained in the review manifest. The images remain under `~/.cache/slop-toronto/props/tennis/refs/`; no aerial raster is shipped. Traces are approximate pavement boundaries, not surveyed property or access boundaries. Canopy-obscured corners are explicitly recorded. High Park's three mapped enclosures are used as pavement references, not extra playing courts.

| City facility | Mapped courts | Source interpretation |
|---|---:|---|
| Lakeshore Boulevard Parklands / Marilyn Bell Park | 4 | Public listing |
| Jimmie Simpson Park | 2 | Public listing |
| Moss Park | 2 | Aerial/OSM show two; City listing says one |
| Rennie Park | 4 | Club listing |
| Trinity Bellwoods Park | 8 | Public listing |
| Stanley Park South | 2 | Public listing |
| Withrow Park | 2 | Public listing |
| Riverdale Park East | 7 | Public listing |
| Sorauren Avenue Park | 2 | Public listing |
| High Park | 10 | Seven east and three west; two City seven-court public/club listings remain separate |

Access remains facility metadata. The model does not assign a High Park court to public or club use from its position, sum the two listings to fourteen, or imply that a court is currently open. `TENNIS.audit` preserves both count disagreements. The City lighting fields also remain metadata; this layer does not invent individual light poles or allocate a real light per court.

## Geometry and placement

The [ITF 2026 rules, Rule 1](https://www.itftennis.com/media/7221/2026-rules-of-tennis-english.pdf) establish the 23.77 × 10.97 m doubles rectangle, 8.23 m singles width, 6.40 m service lines, net posts .914 m beyond each doubles sideline, and 1.07 / .914 m net heights at posts / centre. The renderer uses those nominal dimensions with the mapped centre and long-axis heading. Source quadrilaterals must be closed, nearly rectangular and within 8% length / 5% width of those dimensions; the three shorter mapped High Park courts are normalized to the same nominal court length after aerial review. These are representative game markings, not a survey of painted line positions.

`js/tennis.js` shares one 464-triangle court model for lines, coarse net weave and posts, plus a rectangle for the surface. The net has a physical thin oriented collider; the surface remains part of the existing walking ground. Court corners and net reach must stay on the same curb island, with consistent ground height and no building/landmark overlap. Rejected geometry is never moved to another location. Fifteen surrounding pavement candidates have source-backed outlines; **14 pass placement**, with Withrow's wider pavement rejected for a game building/landmark obstruction while its two clear courts remain. Pavement sits above the old procedural mulch beds, without covering adjacent paths. Unsupported fence/gate positions are omitted, so no invented fence closes a park path. Future mapped pole work remains in `st-26p.9`.

Only procedural park/yard trees are removed from accepted play/pavement footprints. The City street-tree inventory remains intact. Court instances use the existing spatial culler, share materials and are built before shader warm-up. There is no runtime geometry rebuilding, per-court texture cache or additional update loop.

## Coarse terrain overlap

The first GPU review found `TerrainNear` at y=.531 m over a Trinity Bellwoods court whose established walking ground is y=.22 m. `js/sports-terrain.js` subtracts accepted court/pavement footprints from overlapping terrain triangles. It interpolates the original height, normal and UV along cut edges, retains indexed original vertices elsewhere and preserves the surrounding hill. It does not raise the courts above the walking ground or flatten the park. The operation runs once before culling and shader warm-up.

The expanded audit also found four courts where the controller's separate coarse-height lookup returned .29–1.26 m. Accepted sports footprints now register their prepared floor with the controller. Interiors and occupied raised decks retain precedence; outside the footprints, the original hill height remains. GPU checks assert the actual controller floor at every one of the 43 court centres, in addition to the rendered terrain check.

## Rebuild and checks

```sh
node tools/build-tennis.mjs
node --test tests/controllers.test.cjs tests/tennis.test.mjs tests/open-data.test.mjs tests/parking-meters.test.mjs tests/touch-controls.test.cjs tests/boot.test.cjs tests/site-cache.test.mjs
gpu2 slop-toronto-open-data -- node tools/check-tennis.mjs
```

The targeted suite passes **64/64**, including source identities/count disagreements, duplicate enclosure rejection, private-source exclusion, dimensions, pavement containment, rotated collision clearance, terrain area conservation, height interpolation and controller floor/deck/interior precedence. GPU checks pass on desktop and explicit low-tier 412×915 phone views of Sorauren, Trinity Bellwoods, High Park and Moss Park, including all 43 controller floors, overview, real walking/net collision and night views. The production build passes. The static harness's `/live/vehicles` 404 remains a known limitation. Runs alongside production transcription establish function/appearance, not idle-machine performance budgets.
