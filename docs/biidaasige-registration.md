# Biidaasige Park — source identity & georegistration (bounded)

Beads `st-bmyv.2` / `st-bmyv.8` · owner: identity/georegistration worker · 2026-11-10

This registers the **current 2026 City wayfinding map** onto WGS84 / the city world projection using **stable OSM control
points only**, then reads **approximate** map anchors for the named features. It is a bounded source-identity pass; it
owns and writes only these files:

- `tools/fixtures/biidaasige-registration.json` — the machine-readable anchors, controls, fit and building policy
- `tools/biidaasige-registration.mjs` — re-derives the fit from the fixture and validates it (read-only; writes nothing)
- `docs/biidaasige-registration.md` — this file

It does **not** touch the inventory worker's data/fixtures (`js/biidaasige-park-data.js`,
`tools/build-biidaasige-park-data.mjs`, `tools/fixtures/biidaasige/*`), any shared runtime, `.beads`, GPU or a commit.
The parent integrates the registered anchors separately and labels them approximate.

## The map is a diagram, not an orthophoto

The 2026 map is **NORTH-UP** (Lake Shore top, Ship Channel bottom) at 2319×3000 px; the August 2025 PDF is **SOUTH-UP**
and must not be used with these pixels. Labels and relief are placed for legibility, so **every feature anchor read from
the map is approximate** and carries an explicit error. Do not report these as surveyed or precise.

## Registration (5 stable controls, no Owl)

Only features with a known identity are controls:

| Control | Map px (x,y) | OSM identity | Residual |
| --- | --- | --- | --- |
| Fire Hall body | (1309, 1752) | `way/494886782` @ 43.6458536,−79.349925 | **18.8 m** |
| Cherry St South bridge (road crossing) | (825, 1903) | `way/1157772737` road centre | 8.2 m |
| Commissioners St bridge (road crossing) | (1895, 1660) | `way/1211500112` road centre | 8.8 m |
| Cherry × Commissioners junction | (741, 1677) | derived OSM way intersection | 8.3 m |
| Polson × Cherry junction | (931, 2182) | derived OSM way intersection | 4.8 m |

Least-squares **affine** fit (`world = A·[px,py,1]` per axis): **RMS 10.9 m, max 18.8 m**; scale 0.598 / 0.576 m/px;
axes orthogonal to 89.5°. The unmodified **leave-one-out** errors spread to ~54 m — normal for a 5-point affine across a
~300 m span, and evidence that this is a **~15–25 m approximate** registration, not survey grade. Controls are **not
pruned** to force a small RMS.

**The unnamed OSM west-playground area centroid is deliberately NOT a control**, and the Owl graphic is not a control.
Fitting on either would assume the very identity this file has to test (`world = self`). As a held-out witness, the Owl
base anchor is **80.6 m** from that centroid — the false identity is rejected, not recycled.

Independent held-out check: the **Atlas Crane** OSM node (`node/9521067431`, 43.6435284,−79.3538817) registers to **6.5 m**
from the map foot pixel — the fit is sane even though the crane jib illustration is displaced above its foot.

## Resolved feature anchors (approximate)

| Feature | px | world (x,z) | lat, lon | approx err | status |
| --- | --- | --- | --- | --- | --- |
| Snowy Owl Play Theatre (base) | (1231, 1758) | 2361.6, 653.4 | 43.645732, −79.350236 | ~20 m | map-registered candidate |
| Old Fire Hall 30 | (1309, 1752) | 2389.5, 647.6 | 43.6458536, −79.349925 | control | verified (OSM) |
| The Drum | (1732, 1742) | 2649.7, 570.1 | 43.647190, −79.347108 | ~15 m | map-registered candidate |
| Badlands Scramble (marker) | (1165, 1802) | 2329.9, 687.7 | 43.645355, −79.350491 | ~20 m | map + OSM polygon check |
| Cableway Canyon (label) | (1057, 1742) | 2258.4, 670.3 | 43.645321, −79.351402 | ~25 m | map-registered candidate |
| Swing Hill (label) | (1183, 1742) | 2331.4, 651.6 | 43.645670, −79.350601 | ~20 m | map-registered candidate |
| Raccoon Picnic Terrace | (1497, 1740) | 2513.2, 603.9 | 43.646548, −79.348610 | ~20 m | terrace marker (not the Raccoon) |
| Canoe Cove east launch | (527, 1783) | 1957.2, 771.7 | 43.643672, −79.354621 | ~25 m | map-registered candidate |
| Canoe Cove west landing | (250, 1784) | 1796.7, 813.4 | 43.642900, −79.356380 | ~25 m | map-registered candidate |
| West Promontory | (60, 1742) | 1680.3, 818.2 | 43.642560, −79.357745 | ~30 m | coarse landform centre |
| Atlas Crane (foot) | (608, 1855) | 2014.8, 799.8 | 43.643578, −79.353838 | ~10 m | verified (OSM holdout) |
| Outdoor Fitness | — | — | — | — | **unplaced** (listed, no point) |

**Owl identity, resolved to a bounded answer.** On the NORTH-UP 2026 map the Owl theatre is drawn **west of the Fire Hall**,
~46.8 m west of its body, inside the unnamed OSM west playground. The maker/published pin `43.6462889,−79.3496804` is
**~76 m** from the registered Owl base and lies **north-east**, so it is an **approximate maker location, not the structure
footprint** — the Captain's pixel read is the better anchor. This is a *candidate* identity with ~20 m error, not a
surveyed occupancy.

**Outdoor Fitness stays unplaced.** The City page says it is west of Cableway Canyon but publishes no point and the map
gives it no icon; no coordinate is derived from the cableway label.

## Building identity (no blanket suppression)

- **Old Fire Hall 30** is a real park building. Current OSM `way/494886782` (world **2389.5, 647.6**) shows the committed
  native 3D-massing row at **(2384, 622)** is the **same building at its pre-relocation position** — a **~26 m** displacement
  (mostly south). Identity confirmed; the row needs a **position update**, not removal.
- The other in-park rows are **candidates, not proven obsolete**. In particular the **26.1 m row at (2678, 630)** is
  recorded `identity-unverified`: it is neither proven an old warehouse nor proven a greenfield render error and needs a
  current 2025/2026 photo plus a City record before any decision. The (2422, 608) row happens to project near the Owl
  maker pin but the registered Owl base is ~46 m west — do **not** equate the low row with the theatre without a photo.
  The (1998, 782) row sits ~18 m from the Atlas Crane foot and is plausibly crane equipment, not a shed.

## Regenerate / verify

```sh
node tools/biidaasige-registration.mjs          # re-derives the fit, checks residuals/holdouts, exit 1 on failure
node tools/biidaasige-registration.mjs --json   # machine-readable report
```

## Open / bounded unknowns

- The Owl structure extent and exact centroid are not published; only an approximate ~20 m anchor is offered.
- Cableway Canyon / Swing Hill are drawn as zones; their anchors are cluster centres with ≥20 m error.
- Outdoor Fitness, the 7 Dodem animals and the paddling-course extent remain unplaced (no published point).
- Building identities beyond the Fire Hall are unresolved and must not be suppressed from height or proximity alone.

## Sources

City of Toronto 2026 wayfinding map (<https://www.toronto.ca/wp-content/uploads/2026/09/978c-Biidaasige-Park-map.pdf>);
OpenStreetMap (Overpass 2026-11-10, ODbL — `way/494886782`, `way/1157772737`, `way/1211500112`, `node/9521067431`,
`way/1418127159`, `way/1418541993`, `way/1418796674`); Monstrum Snowy Owl page + public MyMaps pin; Tawar — The Drum;
Waterfront Toronto 2026 expansion; MVVA Port Lands flood protection. Data © OpenStreetMap contributors (ODbL); City of
Toronto; Waterfront Toronto.
