# Biidaasige Park — Remaining Source Review (st-bmyv.4/.5)

Bounded source-discovery pass (≤15 min) for the still-unplaced features. **No implementation,
no shared-file edits, no commits, no GPU, no bead close.** Captain integrates and personally
views all images. Owned files: this doc, `remaining-source/remaining-source-review.json`,
`remaining-source/photo-index.json`, `remaining-source/photos/*`, `remaining-source/fitness-fence.ql|json`.

## Method

- **Overpass POST** query (mirrors the task's required tags: `leisure=fitness_station`,
  `sport=fitness`, `leisure=fitness_equipment`, `barrier=fence`, `barrier=wall`, `barrier=gate`)
  over the park bbox `43.638,-79.362,43.652,-79.340`. Timestamp **2026-11-10T23:38:28Z**, ODbL.
  Raw: `remaining-source/fitness-fence.json` (74 elements; 41 in-park, 33 outside).
- **One first-hand personal photo article**: `https://liangmartin.com/biidaasige-park-highlights-from-torontos-latest-parkland/`
  (Martin L, 2025-07-30). Six photos downloaded to `remaining-source/photos/`.
- **The model did not view any image.** Captions in `photo-index.json` are derived from the
  article's own prose + image ordering only. No pixel interpretation, no invented coordinates.

## What changed (net-new findings)

1. **No fitness feature was found in this OSM extract.** The Overpass query returned **zero**
   `leisure=fitness_station`, `sport=fitness`, or `leisure=fitness_equipment` elements in the
   entire bbox. The City lists it ("west of Cableway Canyon", 2026-09-09) and the liangmartin
   article independently corroborates "a outdoor fitness center" — but no queried fitness feature is mapped in this extract.
   → **stays unplaced**; only a captain ortho/map estimate is possible.
2. **Dog-area fencing is NOT mapped.** Neither off-leash area has a `barrier=fence/wall/gate`
   enclosure in OSM. The **east** area (way/1418542004) has **no** mapped barrier within 120 m.
   The **west** area (way/1419966624) has only **two short generic fence ways**
   (way/878097152, way/878097153 — a small V/L at ~43.6457,-79.3523) sitting **~72–77 m to its
   north**, not tagged as a dog enclosure and unproven. The article confirms two fenced
   off-leash areas exist ("useful for fencing off dog areas"), so the fencing is real but
   absent from OSM.
3. **In-park gates are generic.** 13 `barrier=gate` nodes fall inside the park, but **none** is a
   dog-park/off-leash gate; all are generic road/path gates. This confirms the task's warning:
   the earlier "9 gates" were outside the park, and these 13 cannot be assigned to the dog areas
   without proof. The full list is in the JSON fixture.
4. **No new Dodem appearance source.** The article neither names nor photographs the seven animal
   sculptures individually. 6 of 7 remain approximate carved-wood interpretations (only the eagle
   has a primary City photo). No confidence upgrade.
5. **No new mock-beaver-dam source.** Two nearby OSM sandpits (way/1552431731, way/1552431732)
   are still not proven to be the dam. Stays unplaced.

## Fitness / Cableway Canyon geography (for captain estimate only)

"Cableway Canyon" = the two OSM `playground=zipwire` lines:

- `cableway-20` → way/1552431730, centre **43.645411, -79.3513439**
- `cableway-40` → way/1552431733, centre **43.645159, -79.3515595**

So "**west** of Cableway Canyon" ≈ **lon < -79.3516, lat ~43.645** — the corridor between the
west dog area (centre 43.6450412, -79.3522426) and the cableways. This is a **direction hint**,
not a coordinate.

## Captain photo review

The captain personally inspected all six photographs on 2026-11-10. The article-position guesses were superseded: none of the six depicts fitness machines, dog gates or Dodem play sculptures. `IMG_5513` shows the river and smokestack; `IMG_5516` a cyclist on asphalt by Cherry Bridge; `IMG_5517` a broad pebble/cobble beach by the bridge; `IMG_5529` the bridge and wetland; `IMG_5542` children on river-edge stone blocks with the skyline behind; `IMG_5545` the river and metal bridge. These are useful river-bank/path references, but they do not unlock the missing play placements.

Private reference downloads and the original index remain under `$WATERFRONT_RESEARCH/biidaasige/remaining-source/`. The structured research record is persisted as `tools/fixtures/biidaasige-remaining-source-review.json`. No image pixels ship.

## Licence note

The liangmartin.com photos are **all rights reserved** (personal blog). They are a private
captain visual reference only and **must not be committed** to the repo.

## Honest unknowns (unchanged)

- Fitness equipment: existence confirmed, **position unknown** → unplaced.
- Dog-area gates/fencing: exist, **not in OSM** → unplaced/estimate only.
- 6 non-eagle Dodem animals: **no individual appearance source** → approximate.
- Mock beaver dam: **no source resolves the sandpits** → unplaced.

## Historical design scope warning

The May 2023 consolidated PDF titled *Destination Playground* is a 13-board design consultation for a separate three-acre destination playground. It contains a 12 m moose, Toronto Tower Lookout, Black Bear Campsite, Harbour Master Marina and Fireboat Splash Zone proposals. These are not evidence that those structures exist in the current Owl/Raccoon park. The captain checked the PDF metadata and all board titles; it must not supply current equipment counts or placements. Current photos, OSM and the 2026 wayfinding map take precedence.
