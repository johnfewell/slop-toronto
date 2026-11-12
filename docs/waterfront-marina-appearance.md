# Toronto Islands: reviewed QCYC marina appearance (st-sb3r.34)

The st-sb3r.33 correction removed three phantom towers at the Queen City Yacht Club marina but they then rendered as
generic **brown-brick flat boxes with home windows**. An actual GPU capture (`wave7-outlier-review-qcyc-marina-shed.png`)
rejected that look. This pass gives only those **three already-reviewed rows** a bounded, photo-informed appearance. It
keeps the native footprint, the profile total height (4 m) and the collider envelope unchanged.

## Scope (exactly three rows)

| Row | Centre (x, z) | Appearance | Roof |
| --- | --- | --- | --- |
| **32501** | 1234.4, 2166.2 | `qcyc-shed` — white paneled plywood/timber walls, navy doors/shutter | pitched, dark, closed gable ends |
| **32502** | 1212.0, 2181.4 | `qcyc-storage` — neutral pale panel, no windows | native flat envelope (no new roof) |
| **32503** | 1215.2, 2191.0 | `qcyc-storage` — neutral pale panel, no windows | native flat envelope (no new roof) |

No other row changes. The styling is gated on `islandBuildingProfile(...).appearance.style`, which only these three
records carry; it is never a general service/island rule.

## Primary sources (dates)

- **Official 2024 City of Toronto orthophoto** (8 cm GSD; horizontal accuracy 0.16 m; **acquisition 26 Apr–30 May 2024**),
  georeferenced export reviewed by the captain: row 32501 is a small low dark-gray pitched-roof marina building beside
  grouped dinghies; rows 32502/32503 are pale ground-level-looking pads under leafless canopy beside boat-storage racks.
- **Official QCYC visitor page** (`qcyc.ca/about-us/visitors`, current), which places locker blocks south of the dinghy
  shed / drysail crane — corroborating a low storage context for the marina, not an exact per-door match.
- **Official QCYC 2019 renovation gallery** (`qcyc.ca/node/9459`, photos Ron Mazza; downloaded 2026-11-10), viewed by the
  captain: **white paneled plywood/timber exterior walls, dark navy doors/shutters/trim, low eaves, a shallow overhang
  and a timber deck during renovation**. Not brick, not residential home windows.

The reference photographs are **not bundled** (copyright); only colour/form observations are used.

## Appearance (representative, not measured)

- **Shed (32501).** White paneled wall (`0xf2f0ea`), dark navy doors/shutters/trim (`0x1b2a44`), dark pitched roof
  (`0x3a3d42`). The wall is a painted panel with a soft **panel seam** measured *along the wall's horizontal tangent*
  (not a world x+z diagonal), so a rotated building keeps a true ~1.22 m (4 ft) plywood pitch; the seam fades by
  screen-space derivative and is suppressed on roof/soffit. **No home windows** (window ratio 0 → zero-width openings).
- **Storage (32502/32503).** A plain neutral pale panel, **no windows and no invented roof** — the native flat envelope
  is kept because the function and roof of these pads are uncertain.
- **Doors/shutters** are the **navy trim**: two representative door leaves on the +v long wall and one shutter on the +u
  gable end. **Door count/positions are an approximation**, not a surveyed count (the exact faces/count cannot be tied to
  the three rows).
- **Subtle 12 mm relief.** The door/shutter panels' outer face sits only `MARINA_TRIM_RELIEF = 0.012 m` (12 mm) proud of
  the opaque wall, so they are visible instead of buried inside the solid box. This is a **visual relief only**: it does
  not change the movement footprint or add a platform. The visible panel fits within `footprint + 0.03 m` and does not imply a walkable/operating door.

## Height and roof (envelope preserved)

- Height stays the reviewed **`EST.service` = 4.0 m** labelled estimate.
- Shed eaves are `marinaShedEaveHeight(4) = 2.45 m` (a ~2 m door plus a short header): the walls stop at the low eave and
  the **pitched roof occupies the rest** of the 4 m total, so eaves + roof never stack above the collider. The roof is the
  existing sealed `pushGableRoof` (closed vertical gable ends in the wall colour, sealed soffit/fascia volume). The only
  geometric addition is the shallow `0.32 m` roof overhang past the wall; the **collider stays the mapped footprint and
  the 4 m total**.
- Storage rows keep the native flat box (top = roof).

## Batching and phone verification

- One **paneled-shed** facade draw (`Buildings_MarinaShed`).
- One **neutral-storage** facade draw (`Buildings_MarinaStorage`).
- The navy doors/shutter join the **existing instanced trim draw** used by the island cottages (`IslandCottageTrim`) — no
  per-door mesh.
- Roof tiles batch into the existing **hipped-roofs** mesh.
- All of it is added to the same `CityBuildings` group, so culling, shadows and frustum handling are unchanged. Materials
  are merged by style; the three reviewed rows add a handful of instances, not new per-building meshes.

## Data fields

`tools/build-island-buildings.mjs` writes an `appearance` block on each reviewed record:

```json
{ "style": "qcyc-shed", "wall": 15921386, "trim": 1780292, "roof": 3816770,
  "roofType": "gable", "source": "...", "note": "representative…" }
```

`js/waterfront-island-buildings.js` exposes it as `profile.appearance` (copied out, never a live reference). The
`qcyc-shed` record sets `roof: 1`; the `qcyc-storage` records keep `roof: null`.

## Verification

```sh
node --test tests/waterfront-marina-appearance.test.mjs
node --test tests/waterfront-island-building-outliers.test.mjs tests/waterfront-island-buildings.test.mjs
```

Focused source + appearance suites pass. `tests/waterfront-marina-appearance.test.mjs` proves, on the real vendored
`three/tsl` node system (not source grep): the committed/runtime appearance exists on exactly the three rows; the shed
eave is low and below the total; the shed roof is a sealed volume from the eave to the total with closed gable ends; the
navy trim is a thin panel whose outer face is **just outside** the opaque wall (≥ 5 mm proud, ≤ 3 cm from the footprint,
no platform); the storage rows keep the native flat envelope; the material builders compile and **generate WGSL** with
zero home windows and tangent-based panel seams.

## Actual GPU acceptance (captain)

Desktop and phone actual GPU captures each passed **6 views/checks, exit 0** (`wave7-marina-review` and
`wave7-marina-phone`, in `$GPU2_REVIEW_DIR/slop-toronto-waterfront-bia/`). The captain viewed both: a close white paneled shed
with visible navy doors and a dark pitched closed roof, and no tall colliders on the three rows.

## Remaining limitations (honest)

- **Representative typology, not measurements.** Colours and forms come from the primary photos; door counts/positions
  and the exact side each door sits on are approximations, not surveyed.
- **Inference, not a survey.** The three rows' low-structure reading (canopy-inflated MAX_HEIGHT, low AVG) is an inference
  corroborated by the 2024 orthophoto; the massing metadata is illustrative.
- **32502 / 32503 function and roof uncertain.** They are treated as neutral flat storage pads; no demolition, use or roof
  type is asserted. Both keep the native flat envelope.
- **32501 is a marina service shed, not a cottage.** Its bare `building=yes` inside the marina does not make other
  buildings service; explicit OSM height/levels and existing residential/civic profiles are unaffected.
- **Estimate height.** 4.0 m is a labelled conservative estimate, not the City `AVG_HEIGHT` (3.3/2.8/2.9 m) and not a
  measurement.
- **Imagery ages differ.** The orthophoto is 2024; the massing edition is 2025; the gallery is 2019. Current conditions
  are not re-surveyed here.

No dev-server restart, GPU run, commit or deploy was performed by the implementation model; the captain owns the final
managed full-suite log and tracker close.

Captain final verification (2026-11-10): managed `npm test` completed **1,041 pass, 0 fail, 3 skip / 1,044 total**, log `$WATERFRONT_RESEARCH/wave7-marina-final-full-tests.log`. Desktop and phone six-shot runs both exited 0; phone long-side image was also inspected. Baseline live-vehicles 404 remains. These captures establish visual/functional behavior, not a performance budget.
