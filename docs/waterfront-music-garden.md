# Toronto Music Garden: six georeferenced Bach-movement rooms

`js/waterfront-music-garden.js` adds Toronto Music Garden (479 Queens Quay West) as source-backed geometry, laid out
from the garden's **real OpenStreetMap movement nodes**, not a guessed sequence. It is a self-contained module: the
captain loads it and calls `window.CITY.createWaterfrontMusicGarden(THREE, scene)` after the city is built (after
`city-config.js`, and alongside the other waterfront modules). This pass owns only the module, its test, this
document and the new shot in `tools/shots/waterfront-realism.json`. It does not edit `main.js`, `explore.html`,
`city-config.js`, the geodata, dependencies or other agents' files.

## The georeference (why this is not an invented layout)

The committed geodata (`js/toronto-geodata.js`) already carries the garden's six labelled movement nodes as `place`
POIs with real world coordinates inside the measured landmark. The module reads them from `GEO.pois` and anchors each
room on its node:

| # west→east | Room | Bach movement | OSM node name | World x, z |
| ---: | --- | --- | --- | --- |
| 1 | Allemande | II | `2 Allemande` | −1429.3, 569.3 |
| 2 | Prelude | I | `1 Prelude` | −1391.9, 572.3 |
| 3 | Courante | III | `3 Courante` | −1351.0, 562.8 |
| 4 | Sarabande | IV | `4 Sarabande` | −1322.7, 561.4 |
| 5 | Gigue | VI | `6 Gigue` | −1312.8, 600.1 |
| 6 | Menuett | V | `5 Menuett` | −1286.7, 564.0 |

Two facts fall out of the real data and correct an earlier proportional guess:

- **The physical west-to-east order is not the suite order.** It is Allemande, Prelude, Courante, Sarabande, Gigue,
  Menuett — Prelude is second, not first. The designer's labelled plan (Harbourfront Centre *Summer Music in the
  Garden* brochure 2024, pages 2–3) shows the same order.
- **The grass amphitheatre (Gigue) is west of the pavilion (Menuett)**, and its node sits well south of the others
  (z 600 vs ≈565), toward the harbour — the "grass steps dance down the hillside" (JMMDS). The pavilion (Menuett) is
  the easternmost node, at the garden's east/north-east edge.

The rooms **tile the measured landmark ring as nearest-node (Voronoi) cells** clipped to the OSM `leisure=park`
outline, restricted to within `roomMaxDist` (46 m) of a movement node so the far park edge stays generic park rather
than being swallowed by the nearest room. So room extents follow the mapped plan geometry and the mapped paths, not
six equal slices. `GEO.parkPaths` inside the ring are left to the city's own path geometry (the module adds only the
connecting walk between the movement nodes).

The landmark ring comes from `GEO.landmarks.musicGarden` (x −1330.3, z 569.4, w 262, d 47.9, ang −0.161, area
10,524 m²; OSM outline 10,462 m²). The Gigue node lies just outside the ring; `clampIntoRing` pulls it to the nearest
south edge, so the amphitheatre begins at the mapped edge and faces the harbour.

## What is built

One culling root (`WaterfrontMusicGarden`), twelve instanced meshes, returned as `{ group, colliders, stats }`:

| Part | Role | Notes |
| --- | --- | --- |
| Room floors | `room-beds` | one low slab per 3 m sampling cell, tinted per room ground (mulch / meadow / moss / paving / grass / pathstone) |
| Planting | `planting` | low clumps per room (wildflower meadow densest), colour by species |
| Grove trees | (exported as **sites**, not meshes) | birch / conifer / hackberry / willow per room, rendered by the shared ez-trees pipeline |
| Granite boulders | `granite-boulders` | glacier-tumbled granite throughout (JMMDS), varied greys |
| Connecting walk | `winding-path` | Catmull-Rom curve through the six nodes in physical order |
| Paving aprons | `paving-aprons` | pavilion and amphitheatre-stage discs |
| Music Pavilion | `pavilion-ironwork`, `pavilion-roof` | eight wrought-iron columns + octagonal roof, at the Menuett node |
| Grass amphitheatre | `amphitheatre-grass-steps` | grass terraces rising uphill from a lawn stage, open toward the harbour, at the Gigue node |
| Granite rim | `amphitheatre-granite-rim` | a low stone riser at the stage only |
| Water stone | `water-stone` | a still granite pool at the Sarabande node |

Representative build (Toronto detail frame): 933 floor cells, 393 planting clumps, 37 grove trees, 36 boulders,
120 path slabs, 32 iron members, 60 grass terraces, 15 granite rim pieces, 1 water stone, 12 meshes, ~26,000
triangles, 8 pavilion-column colliders. Counts are bounded by the grid and the fixed per-room maxima.

### Supplied trees: sites for the shared realistic tree pipeline (no balloon crowns)

The module renders **no tree crowns or trunks**. Instead it exports deterministic supplemental tree **sites** for the
existing ez-trees pipeline, so the groves use the same realistic branch/leaf inventory as every other tree in the
city:

```js
C.waterfrontMusicGardenTreeSites   // === result.treeSites, unique
// each site: { x, z, y:0, height, width, species:0|1|2, model, scale, tier:0, room }
```

- `model` is a real id from the committed manifest `GEO.treeModels` (`ez-aspen-medium` for the birch Allemande,
  `ez-pine-medium-a` for the conifer Sarabande, `ez-oak-medium` for hackberry/willow, `ez-ash-medium` for mixed) —
  never an invented name. `species` (0 oak / 1 ash / 2 aspen) and `scale` are the fallback for `createTreeField`.
- `height` is 6–10 m (finite, varied); `scale = height / slopTreeHeight()` so the fallback tree renders at that
  height too (`slopTreeHeight()` measures the shared procedural geometry when present, else the documented ~11 m).
- Sites are **unique** (nothing within 2 m), inside the garden, clear of the City street-tree inventory
  (`treeClearance` 5 m) and clear of the structure keep-outs.
- Granite boulders remain module-rendered, coloured from `GRANITE_PALETTE` (varied neutral greys, no white default);
  the pavilion iron is a dark charcoal at low metalness (`0.22`) so it shows form instead of crushing to black.

The captain appends `result.treeSites` to `streetDetails.treePositions` before
`buildEzTrees(scene, streetDetails.treePositions)` (`main.js:192`); `streetDetails.addFallbackTrees` uses the same
list. Tests assert the sites are exported and unique, their heights are finite 6–10 m, their models are real manifest
ids, and they are clear of the inventory and the structure keep-outs.

### Materials that track the primary sources

- **Gigue steps are GRASS**, not granite: JMMDS describes "wide grass steps dance down the hillside into an
  amphitheatre-like space." Granite appears only as the glacier-tumbled boulders through the garden and a low rim at
  the stage.
- **Menuett Pavilion** is the wrought-iron arch by **Tom Tollefson** over a concert stage (JMMDS, City of Toronto).
- **Allemande** birch forest with "squirrel trails"; **Courante** Maypole at two spiraling paths; **Sarabande** shady
  conifer corner with a water-filled stone and anemones; **Prelude** curving entry with granite boulders and an
  "eddy" into the Allemande.

## Estimated dimensions (not surveyed)

The design does not publish measured room or feature footprints. These are estimates, recorded so they can be
replaced when the designer's dimensioned plan is available:

- connecting walk width 2.4 m; sampling/tiling grid 3 m; room extent limited to 46 m from a movement node;
- Music Pavilion ≈7 m across (`pavilionRadius` 3.4 m), 3.3 m tall;
- grass amphitheatre ≈18 m across (radius 9 m), 4 terraces, 0.35 m rise / 1.1 m run;
- water stone ≈3 m across; boulders ≈1.1 m.

The room **cell extents** are map-derived (nearest-node within the ring), but the exact planted footprints of each
movement still need the designer's plan to confirm.

## Walking surface (so avatars do not sink through the grass steps)

The Gigue grass terraces rise to 1.40 m, so the module exposes the rendered walking height:

```js
C.waterfrontMusicGardenSurfaceAt(x, z)
// → { h: 1.05, id: 'music-garden-gigue', pedestrianOnly: true }  at a terrace, or null elsewhere
```

It is built from the **exact rotated instance boxes** of the grass terraces (and any apron raised above the ground),
returning the maximum rendered top where several overlap, so it agrees with what is drawn. It returns `null` when the
garden has not been built in this frame — no ghost floor. The captain folds this into the generic waterfront surface
(`city-config.js` `deckHeightAt`/`deckStoodOn`); the module does not edit that shared file.

## Foliage keep-out (structures only, not the whole park)

```js
C.gardenStructureKeepoutAt(x, z, margin) // → true on the pavilion apron/columns, amphitheatre stage + grass
                                         //   terraces, and the connecting path slabs; false in open planted park
```

This is deliberately narrow: it covers the garden's **actual hard footprints and path slabs** so generic foliage does
not overlap the pavilion, amphitheatre or walk — it does **not** erase mapped trees across the park.
`C.gardenFootprintAt(x, z)` still marks the whole ring for lawn/tree suppression where the city wants it, and
`C.gardenRoomAt(x, z)` resolves the nearest room.

### Source tree inventory

Tree sites are kept clear of the committed City street-tree inventory (`GEO.streetTrees`, stride 4): no site is
placed within `treeClearance` (5 m) of a mapped tree, so the garden adds to the real trees rather than replacing them.

## Scene integration (captain)

1. Load `js/waterfront-music-garden.js` after `js/city-config.js` in `explore.html`.
2. Call `CITY.createWaterfrontMusicGarden(THREE, scene)` after the city is built, and push `result.colliders` into the
   landmark colliders list (the realm's pattern).
3. Add `'WaterfrontMusicGarden'` to the culling roots.
4. Fold `CITY.waterfrontMusicGardenSurfaceAt` into `deckHeightAt`/`deckStoodOn` (respect `pedestrianOnly`), and call
   `CITY.gardenStructureKeepoutAt` from the foliage scatter so nothing overlaps the pavilion/amphitheatre/walk.
5. Append `result.treeSites` (=== `CITY.waterfrontMusicGardenTreeSites`) to `streetDetails.treePositions` before
   `buildEzTrees(scene, streetDetails.treePositions)` at `main.js:192`, so the groves use the shared realistic trees.

## Shots

`tools/shots/waterfront-music-garden.json` is a focused three-shot list for this module: a street-level close on the
pavilion (`music-garden-pavilion-street-midday`), an aerial down the room sequence
(`music-garden-rooms-aerial-golden`), and a walker check standing on the highest Gigue grass step
(`music-garden-walker-gigue-steps-midday`, which reads the surface height from `waterfrontMusicGardenSurfaceAt`).

## Evidence

- Designer: <https://jmmds.com/portfolio/the-toronto-music-garden/> (JMMDS; overview plan photo).
- Labelled plan: Harbourfront Centre, *Summer Music in the Garden* brochure 2024, pages 2–3:
  <https://harbourfrontcentre.com/wp-content/uploads/2024/07/HC-Summer-Music-in-the-Garden-Brochure-2024.pdf>.
- City of Toronto public gardens:
  <https://www.toronto.ca/explore-enjoy/parks-recreation/places-spaces/beaches-gardens-attractions/gardens-and-horticulture/public-gardens/>
- Movement nodes and ring: OpenStreetMap contributors, ODbL (in `js/toronto-geodata.js`).
- Test: `tests/waterfront-music-garden.test.mjs` (16 tests: node coordinates, physical order, Gigue-west-of-pavilion,
  ring tiling, path order, grass-vs-granite, the walkable-surface sampler matching every rendered terrace top and
  corner, no ghost floor in an unsupported frame, the narrow structure keep-out, the supplemental tree-site export
  (unique / finite 6-10 m / real manifest models), site clearance of the City street-tree inventory, boulder colour,
  shared geometry, footprint predicate, frame guard + no API collision, sources + determinism).
- Shot: `tools/shots/waterfront-music-garden.json` (pavilion street, rooms aerial, walker on the Gigue steps), plus
  the three `music-garden-*` shots in `tools/shots/waterfront-realism.json`.
