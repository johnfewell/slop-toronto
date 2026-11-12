# Biidaasige Park — complete path network source (OSM geometry clip)

Bead `st-bmyv.7` (parent `st-bmyv`). This worker owns only the NEW files below. It does **not** edit the
three-named-path runtime (`js/biidaasige-paths.js`), the park catalog, shared geodata, `.beads`, or any renderer.

| File | Purpose |
| --- | --- |
| `tools/fixtures/biidaasige-path-network.json` | checked-in Overpass geometry source (ODbL) + the committed park polygon |
| `tools/build-biidaasige-path-network.mjs` | deterministic clip/validate generator |
| `js/biidaasige-path-network-data.js` | generated browser data + pure world projector |
| `tests/biidaasige-path-network.test.mjs` | source/product honesty tests (11/11) |
| `docs/biidaasige-path-network.md` | this file |

## Why this exists

The existing `js/biidaasige-paths.js` builds only **three named ways**. The broad inventory (`osm.json`) had
~700 path-like ways with **centre points and no geometry**, so it could not render or collide with the actual
park network. This layer fetches the full **source geometry** for every path-like way in the park bbox, clips it
to the committed park polygon, and keeps the real gate/play/fitness source positions. The Captain integrates the
geometry; this worker renders nothing.

## Source fetch (accurate outcome)

Query: every `way[highway~"^(footway|path|cycleway|steps)$"]`, every `node[barrier=gate]`, and every
`nwr[leisure~"^(fitness_station|playground)$"]` inside `43.642..43.650, -79.359..-79.341`.

```
curl -sS --max-time 90 -A 'slop-toronto-research/1.0 (contact: github.com/anomalyco)' \
  --data-urlencode 'data@query.ql' https://overpass-api.de/api/interpreter
```

- First POST to `overpass-api.de` returned **HTTP 502** (server at capacity; no data).
- Retried the same POST after 8 s: **HTTP 200, 192,615 bytes**, OSM base timestamp `2026-11-10T23:02:06Z`.
- Parsed: **317 elements = 308 way elements + 9 gate nodes**; 306 of the way elements are path ways, 2 are playground polygons; **0 fitness stations**.
- Way mix: 204 footway, 79 cycleway, 14 steps, 9 path. 17 ways carry a `bridge` tag.

The raw response is **not** stored outside the repo. The checked-in fixture is the trimmed, deterministic
source: every path way id + tags + `[lat, lon]` geometry, every gate node, every playground ring, plus the bbox query,
OSM timestamp and ODbL attribution. The raw extract (`$WATERFRONT_RESEARCH/.../osm.json`) was centre-only and
was not usable for this layer.

## Clip and counts

Ways are clipped to **`BIIDAASIGE_PARK.park.polygon`** (the committed `way/813717630` ring, 216 vertices). The
fixture carries a copy of that exact ring so the build is portable; the test asserts it is byte-identical to
`js/biidaasige-park-data.js`.

Clipping is **not** a centroid filter:

1. Insert every polygon-boundary intersection into the source polyline (planar lon/lat segment intersection).
2. Keep the original source vertices that fall inside.
3. Keep each contiguous inside run; join through shared source vertices so a line is not fragmented at a bend.
4. Drop a way only when it has no inside run. A way that merely touches the polygon at one vertex has no area of
   support and is dropped, not stretched into the park.

Native bridges are the deliberate exception: a `bridge=*` way that reaches or crosses the park keeps its **full
source line**, with its `bridge`/`layer` tags, so the connector is not cut off at the water edge and no ground
plane is invented over water.

| Result | Count |
| --- | --- |
| Source path ways in fixture | 306 (the 2 playground polygons are under `playgrounds`, not paths) |
| Kept clipped ways | **161** (13 bridge ways) |
| Dropped (no in-park support) | 145 (4 of them bridge ways that never reach the park) |
| Step ways kept | 14 |
| Ways with an explicit OSM `width` tag | 4 (`4.25` ×2, `2` ×2) |
| Ways with no published width | 157 → `widthM: null`, `widthSource: "not-published"` |
| Gate nodes kept (actual source positions) | 9, all outside the park polygon |
| Playground/play areas kept | 2 (`way/1418127159` generic west, `way/1418796674` Reaching Raccoon) |
| Fitness stations | 0 (none mapped in OSM) |

Long source segments are sampled at **≤ 20 m**. The inserted points are exact linear interpolations along the
source segment (not guessed positions), so no rendered line jumps a gap. `sourcePointCount` is kept beside
`pointCount`; the fixture still carries the untouched source geometry.

## Phase labels are estimates

`phase` is `2026` when the clipped way's centroid is west of **`-79.3525`**, else `2025`. That meridian falls
between the westernmost 2025 mapped park path and the easternmost 2026 west-expansion path; the official maps do
**not** publish the phase boundary as coordinates. Every way therefore carries
`phaseConfidence: "estimated-location"` and a `phaseBasis` string. Current split: **106 × 2025, 55 × 2026**.
This is a location label, not a construction-date fact.

## Steps are real source lines, not 0 m risers

The 14 `highway=steps` ways keep their real OSM geometry (lat/lon only). Where OSM tags `step_count`, it is
copied (`6` ways); the other `8` stay `null` with `stepCountSource: "not-tagged"`. Every step way carries:

- `riserProfile: null`
- `stepHeightStatus: "unknown-do-not-assume-zero"`

No elevation ordinate is written. The source extract does not publish the riser/tread profile or the elevation
change, so a flat `y=0` must never be treated as the real stair.

## Gates are source positions, not park gates

All 9 `barrier=gate` nodes are real OSM nodes in the fetch bbox, but **none lies inside the park polygon**
(shortest boundary distance **97.3 m**, longest **506.8 m**). They are kept with `insidePark: false`,
`distanceToParkM`, and `spatialStatus: "context"`. They are surrounding-street/greenway gates, not mapped park
entrances; none is moved onto the park. `unresolved` records this explicitly.

## Output API

`C.BIIDAASIGE_PATH_NETWORK` (lat/lon source):

```js
{
  version, source, sourceUrl, osmBaseTimestamp, fetchedOn,
  license: "ODbL-1.0", licenseUrl, attribution, bbox, query,
  park: { ref: "way/813717630", polygon: [[lat, lon], …] },
  diagnostics: { sourceWays, keptWays, droppedWays, bridgeWays, stepWays,
                 gates, gatesInsidePark, fitness, playEquipment, phases,
                 maxPointGapM, phaseWestBoundaryLon },
  ways: [{
    id: "way/1352429162", sourceurl, tags, name, highway, surface,
    phase, phaseConfidence, phaseBasis,
    bridge, layer, widthM, widthSource,
    stepCount, stepCountSource, riserProfile, stepHeightStatus,
    polyline: [[lat, lon], …],       // clipped + ≤20 m sampled, source line
    sourcePointCount, pointCount, lengthM, maxPointGapM
  }, …],
  gates: [{ id, sourceurl, lat, lon, tags, phase, spatialStatus, insidePark, distanceToParkM }, …],
  fitness: [],
  playEquipment: [{ id, sourceurl, tags, name, phase, geometryType: "polygon",
                    insidePark, centroid, areaM2, polyline: [[lat, lon], …] }, …],
  unresolved: [{ id, kind, count, ids?, reason, source? }, …]
}
```

`C.biidaasigePathNetworkWorld()` is **pure** and projects through the **active `C.worldFromLatLon` at call
time** (detail frame or `?map=eglinton`). It returns `null` when that projection is absent — never fabricated
coordinates. It returns new objects and does not mutate `C.BIIDAASIGE_PATH_NETWORK`:

```js
{
  available: true, attribution, license,
  ways: [{ …same fields, projected, polyline: [{ x, z }, …] }],
  gates: [{ …, x, z, projected }],
  fitness: [], playEquipment: [{ …, ring: [{ x, z }, …], projected }],
  unresolved: [ … ]
}
```

`C.biidaasigePathNetworkProjectionAvailable()` is the guard.

## Unresolved / Captain handoff

- **Widths.** Only 4 ways publish `width` (`4.25` or `2` m). The other 159 are `widthM: null`; the Captain
  supplies any visual estimate. This module never guesses.
- **Steps risers.** `step_count` is recorded where tagged; riser/tread height is unknown. Use the existing
  `terrazzoSteps` factory only where a real measured rise exists.
- **Phase boundary.** The `-79.3525` meridian is an estimate. Replace it if the Captain registers the official
  2025/2026 boundary.
- **Park gates.** No mapped gate is inside the park polygon. If the Captain registers entrance anchors, add
  them; the 9 context gates must not be treated as park gates.
- **Fitness.** The City lists outdoor fitness west of Cableway Canyon, but OSM has no `fitness_station` here.
  Nothing is placed.
- **Integration.** This layer only publishes source geometry. Do not edit `js/biidaasige-paths.js` here; the
  Captain decides how to render/collide the network.

## Regenerate / verify

```bash
node tools/build-biidaasige-path-network.mjs          # write js/biidaasige-path-network-data.js
node tools/build-biidaasige-path-network.mjs --check   # exit 1 if stale
node --test tests/biidaasige-path-network.test.mjs     # 11/11
```

The generator reads only the checked-in fixture; the fixture polygon is asserted equal to the committed park
polygon. It is deterministic (stable id-sorted output) and does not touch `/tmp`.

## Attribution

Data © OpenStreetMap contributors, **ODbL 1.0** — https://www.openstreetmap.org/copyright.
The fixture and the generated data both carry the license and attribution strings. City of Toronto and
Waterfront Toronto sources are referenced in `docs/biidaasige-park.md`; no image or map scan is embedded here.
