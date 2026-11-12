# Toronto Island's residential-lot canopy

Pilot · 2026-11-10 · Bead `st-sb3r.28` · Source-backed Oneida / Ojibway canopy from the City of Toronto's own tree points.

## 1. Why

The 2026 source photographs reviewed by the captain of **Oneida Avenue** and **Ojibway Avenue** on Algonquin Island show dense, mature canopy and
gardens enclosing narrow paths. The accepted scene there is sparse, with exposed repeated cottage facades. The reason is
structural, not a bug in the trees:

- `js/toronto-island-woods-data.js` (`tools/build-park-woods.mjs --park toronto-island`, [docs/toronto-island-woods.md](toronto-island-woods.md))
  keeps the Ontario GTA 2023 lidar crowns **only on blocks named "Toronto Island Park"**. Oneida and Ojibway run through
  Algonquin Island Park and unnamed residential blocks, which that build excludes.
- With no lidar crowns there, `js/street-details.js` scatters a few generic yard trees (~one per 1,100 m², clear of the
  houses), which is why the facades show between sparse trees.

Mapped street inventory existed, but the park lidar build did not fill the remaining residential canopy. The comparison that confirmed it (committed detail frame, decoded from
`data/toronto-geodata.bin` with `js/geodata-loader.js`):

| | Value |
| --- | --- |
| City Tree Point features in the Algonquin bbox | 567 |
| of those within 12 m of the Oneida or Ojibway centre line | 53 |
| after water / building / pavement / street-inventory dedupe | **33** (15 Oneida, 18 Ojibway) |
| reserved by the lidar park build on those lots | 0 |

That is a real, mapped gap, not a keyword assumption: the City points are dense along exactly the two photographed rows.

## 2. The source

The City of Toronto topographic **Tree Point** layer:

- Layer: `https://gis.toronto.ca/arcgis/rest/services/cot_geospatial3/FeatureServer/10` (geometryPoint; caption is a
  generic "Tree Point").
- Catalogue: `https://open.toronto.ca/dataset/topographic-mapping-physical-location-of-trees/`, Open Government Licence – Toronto.
- Fields used: `OBJECTID`, `SUBTYPE_DESC` ("Tree Point"), `DERIVED_HEIGHT` (m), `ELEVATION` (m AMSL), `DERIVED_OWNER`,
  `LAST_GEOMETRY_MAINT`, and the geometry (`returnGeom4326`, lon/lat).
- **No species** is identified. The builder therefore labels every tree a **generic mature deciduous** (rendered as the
  EZ ash model family) and never names a conifer, a cottonwood or anything else. No flowerbeds, fences or porches are
  invented.
- **Public, no personal resident data.** `DERIVED_OWNER` is a municipal department ("City of Toronto - Corridor",
  "...Parks, Forestry & Recreation", "...Toronto Water") or null; it is never a person's name.
- Age: `LAST_GEOMETRY_MAINT` in the sample runs 2021-01-01 to 2021-05-23 (dated, not current survey). Heights are the
  City's own `DERIVED_HEIGHT`, a lidar-derived value, not a guess.

The exact query the captain saved (`$WATERFRONT_RESEARCH/width-audit/city-tree-query.txt`) is recorded in the data:

```
.../FeatureServer/10/query?f=json&where=1%3D1&geometry=-79.362,43.626,-79.356,43.630
  &geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects
  &outFields=*&outSR=4326&returnGeometry=true&resultRecordCount=2000
```

The bbox is the Algonquin residential envelope only, not the whole island, and not the mainland.

## 3. The build

`node tools/build-island-residential-canopy.mjs --source <city-tree-algonquin.json>` writes
`js/waterfront-island-residential-canopy-data.js` reproducibly (same source → byte-identical file; a test re-runs it).
The builder reads the committed detail geodata (bin) for geometry, water and buildings, and the committed
`js/waterfront-island-lanes-data.js` for the two corridor centre lines — never the legacy `js/toronto-geodata.js` for
placement.

Gates, applied to every source point (rejected points are **counted and dropped, never moved**):

| Gate | Rule | Rejected in the sample |
| --- | --- | --- |
| corridor | within **12 m** of a Oneida/Ojibway lane centre line | 514 |
| frame | inside the committed detail frame | 0 |
| water | City water polygons (with the lake's island holes), as `city-config.js` | 0 |
| height | `DERIVED_HEIGHT` in **4.5-34 m**, a conservative inclusion band (not a botanical test) | 0 |
| building | trunk ≥ 0.35 m outside a rendered building footprint (the renderer's rotated-footprint inverse) | 0 |
| pavement | trunk off a mapped lane's paved strip: the narrowed representative **3.3 m Oneida / 3.5 m Ojibway**, every other mapped island lane at its own width, plus **0.4 m** trunk clearance | 9 |
| dedupe | not within **3.5 m** of an existing City street tree (`GEO.streetTrees`) | 11 |

Placed: **33** of 567 (median 24.25 m, p10 10.26 m, p90 29.63 m). The 12 m radius is a bounded selection envelope around the residential
lots that face the lanes; a wider radius would take in the block interiors and the park, which the park's own lidar (and
the laundered lawns) already govern.

Two gates are worth spelling out:

- **Building footprints.** The committed building rows are `[cx, cz, ang, parts]`, and the renderer
  (`tools/build-island-buildings.mjs` `rowBox`) places a local `(u, v)` at `x = cx + u·cos(ang) + v·sin(ang)`,
  `z = cz − u·sin(ang) + v·cos(ang)`. The inverse is therefore `u = dx·cos(ang) − dz·sin(ang)`,
  `v = dx·sin(ang) + dz·cos(ang)` — **not** a standard rotation by `−ang`. A test places a synthetic trunk inside a
  genuinely rotated footprint and proves the builder rejects it.
- **Pavement, trunk only.** The captain's measured narrowed representative widths (3.3 m Oneida, 3.5 m Ojibway,
  [docs/waterfront-island-width-audit.md](waterfront-island-width-audit.md)) plus a 0.4 m trunk clearance keep a trunk off
  the paving; every other mapped island lane (Seneca, Algonquin Bridge Road, Omaha, …) is tested at its own width. The
  clearance is the trunk's, never the crown's: a crown may overhang the lane, as real ones do.

## 4. The runtime

`js/waterfront-island-residential-canopy.js` is a pure source, in the same shape as the lanes and road-materials modules:

- `CITY.islandResidentialCanopySites(existingSites = [])` → array of EZ-Tree sites (`{ x, y, z, height, width, model,
  species, tier, woods, residentialCanopy, oid, lane }`) inside the active frame, or `null` when the data is absent or the
  frame's projection does not match the build. `y` is the island level (0; `ez-trees.js` grounds it with `cutDown`),
  `model` is an `ez-tree` id, `width` the generic crown radius, `tier` 0 (yard/parkland), `woods` false (open-canopy
  hand-over). `existingSites` is the runtime's **raw** generated list (before conversion) plus any named/lidar sites: a
  source candidate within 3 m of a preserved named/lidar site is dropped, so the same tree is not drawn twice. Generic
  scatter does not suppress a source candidate.
- `CITY.islandResidentialCanopyLayout()` → counts, gates, height spread, `inFrame`, `supported`, `dedupeM`.
- `CITY.islandResidentialCanopyReconcile(mapped, generated, radius = 3.0)` → removes only the runtime's **generated
  generic** parkland/yard scatter a mapped point already stands for. It must run on the **raw** generated list, before
  `ez-trees.js` converts it (after conversion every site has a model, so nothing would be removable). A City inventory row
  (it carries a model index and a height), a lidar park crown (model/height/width), or any other named site is never
  removed: mapped inventory keeps its priority.

**Wiring (captain, after review — this module edits nothing else).** Load the data and module before `js/ez-trees.js`, and
let `ez-trees.js` append the sites to its `generated` list after reconciling the generic scatter, e.g.:

```js
// `generated` is the RAW list here, before ez-trees.js converts it to sites.
const canopy = window.CITY.islandResidentialCanopySites?.(generated) || [];
if (canopy.length) {
  const rec = window.CITY.islandResidentialCanopyReconcile(canopy, generated);
  generated = rec.kept.concat(canopy);
  window.CITY.islandResidentialCanopyEzStats = { added: canopy.length, generatedReconciled: rec.removedCount };
}
```

That is one small, reviewable seam in the site-assembly section of `js/ez-trees.js`, alongside the existing HTO reconcile.
Nothing in the instancing, LOD, crossfade or culling changes: these are ordinary sites in the existing field.

### Crown width is an estimate, and the data says so

The City layer carries no crown width. The runtime widens each tree's own crown with a generic mature-deciduous estimate
(`r ≈ 0.22 · height`, clamped to 1.8-6 m) so a tall mapped tree reads as a full crown rather than a sapling's. The data
records `crown.source = null` and `crown.genericDeciduous = true`, so nothing downstream mistakes it for a measured width.

## 5. Tests

`node --test tests/waterfront-island-residential-canopy.test.mjs` (11 tests, targeted). On the real data and the committed
detail/Eglinton bins, they prove:

- the data names the City Tree Point layer, catalogue and licence, and claims no species;
- every site's `OBJECTID` and `DERIVED_HEIGHT` match the saved City feature of that `OBJECTID` (so the height is the
  source's, not invented);
- the gates reconcile (`placed + rejections = 567`), exactly two lanes, both represented, and the pavement gate rejects
  a trunk on a mapped lane;
- every site is within the corridor, bounded to the Algonquin envelope, and inside the detail frame (nothing on another
  island or the mainland);
- placement is unmoved: the helper returns each row's source position rounded to 0.1 m and its source height;
- the building gate uses the renderer's rotated-footprint inverse (a synthetic trunk inside a rotated building is
  rejected);
- the api is a no-op on a mismatched projection, absent data, and (the same projection) identical on the Eglinton frame;
- each site is a known non-pine EZ model with a bounded generic width;
- the api dedupes source candidates against preserved named/lidar sites, and reconcile removes only generic scatter while
  keeping City inventory and lidar crowns;
- the layout reports the built counts and height spread;
- the committed data is byte-for-byte the builder's output on the saved source (reproducible).

## 6. Limits

- **Species.** None from the source: every tree is a generic deciduous in the ash family. A resident's actual oak or
  cottonwood is not modelled; the point and height are real, the taxon is not claimed.
- **Crown width** is a generic estimate, not surveyed (§4).
- **Source precision and date.** The City catalogue describes features visually identified in high-resolution aerial photography. These are mapped tree points, not a field survey of individual trunk centres. The records carry 2021 maintenance dates, not verified acquisition dates; later removals or planting may not be reflected.
- **Position.** Source positions are rounded to 0.1 m (the committed geodata's own coordinate precision); they are not
  relocated or invented, but they are not sub-decimetre survey points either.
- **Scope.** Only the two photographed corridors. The rest of Algonquin, Ward's and the park's lots keep their existing
  treatment (the lidar park crowns, or the generic scatter). Extending it means more saved queries and more corridor
  polygons, in the same builder.
- **Captures.** Build `b575672e854d` passed `wave7-canopy-lighting` on the Mac mini: seven checks, 33 actual source-ID additions, and 189 rendered-ground/controller samples with maximum error 1.49e-13 m. The captain inspected matching Oneida/Ojibway street views. `wave7-canopy-phone` also passed all six checks at 412×915 / DPR 2.625 / low quality; the captain inspected the Oneida portrait image. The full integrated suite passed 987 tests, zero failures and three skips (990 total). These shared-host runs establish visual/functional behavior, not performance budgets.

## 7. Attribution

Contains information licensed under the Open Government Licence – Toronto. Source: City of Toronto topographic Tree
Point layer (`cot_geospatial3/FeatureServer/10`), catalogue `open.toronto.ca/dataset/topographic-mapping-physical-location-of-trees`.
