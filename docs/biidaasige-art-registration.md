# Biidaasige Park — Art Trail map registration (st-bmyv.6 follow-up)

Bounded follow-up to the placekeeping source pass. This registers the **rendered official
Lassonde Art Trail Fall 2026 map** (`$WATERFRONT_RESEARCH/biidaasige/captain/lat-map-fall2026.png`,
1800×1273) onto the city world frame using Captain-read control pixels, reports the fit
honestly, and converts the PDF art-label anchors to rendered pixels.

The **primary fit uses five controls**: the original four plus the Commissioners Street Bridge
combined road-crossing centre. The **original four-control fit is retained unchanged** for
comparison. The Atlas Crane is held out of both fits.

Owned files only:

- `tools/fixtures/biidaasige-art-registration.json` — machine-readable result
- `tools/register-biidaasige-art.mjs` — reproducible fit script
- `docs/biidaasige-art-registration.md` — this file

No shared runtime, no placement, no feature snapping, no commits. The existing source fixture
`tools/fixtures/biidaasige-placekeeping-source.json` and the verified-control fixture
`tools/fixtures/biidaasige-registration.json` were read only.

## Verdict first

| Gate (5-control primary) | Value | Limit | Result |
|--------------------------|-------|-------|--------|
| Affine RMS | **13.03 m** | 30 m | pass |
| Max control residual | 19.52 m | — | — |
| Atlas Crane holdout | **32.77 m** | 50 m | pass |
| Leave-one-out max | **58.36 m** (Commissioners) | — | **still unstable** |

**Suitability: `MARGINAL-NOT-FOR-RUNTIME`.** The fifth control materially improves the
registration — holdout falls from 45.98 m to **32.77 m**, and leave-one-out max falls from
**321.74 m to 58.36 m** — but LOO is still above the 50 m holdout limit, and the 5-control RMS
(13.03 m) is slightly worse than the 4-control RMS (9.56 m). That is the expected signature of
real drawing distortion in a stylised map, not a clean affine. World/latlon values for the art
anchors remain **provisional and withheld from runtime**; map-space positions stay authoritative.
Nothing was snapped or pruned to force acceptance.

## Map space vs world space (explicit)

- **Map/PDF space** is a printed, stylised trail illustration in PDF points (A3, 1190.55 ×
  841.89 pt, created 2026-09-21). It is not an orthophoto and not a geographic datum.
- **World space** is the city tangent-plane projection used by `js/city-config.js`
  (`worldFromLatLon`), with `lat0 43.6453`, `lon0 -79.3806`, `kx 80682.4718`,
  `ky 111105.3187`, `theta -0.2895 rad`, `ox = oz = 0`.
- The affine is a **2D map-pixel → world-metre** fit. It is **not** a WGS84 datum transform,
  and the map's own drawing distortion is not modelled.

## Controls (matched by name, not by old pixels)

The new Captain pixels were matched by name to the verified WGS84 controls in
`tools/fixtures/biidaasige-registration.json`. No old pixel from that fixture was reused.

| Control | Rendered px | WGS84 | World (x, z) | 5-fit residual | In original 4 |
|---------|-------------|-------|--------------|----------------|---------------|
| `firehall_body` | 1015, 484 | 43.6458536, -79.349925 | 2389.5, 647.6 | 19.52 m | yes |
| `cherry_south_bridge` | 655, 620 | 43.6439147, -79.3522052 | 2151.7, 801.5 | 12.74 m | yes |
| `cherry_commissioners_jct` | 616, 451 | 43.6448066, -79.3536348 | 2069.4, 673.6 | 13.85 m | yes |
| `polson_cherry_jct` | 766, 824 | 43.6430687, -79.3505691 | 2251.4, 929.3 | 6.70 m | yes |
| `commissioners_bridge` | **1507, 445** | 43.6480605, -79.3463004 | 2739.8, 496.1 | 8.28 m | **no (new)** |

The Commissioners pixel is the **combined road-crossing centre of the paired arch graphics
spanning the main channel**, not one arch head.

## Primary 5-control fit

```
world.x = 0.7444822255 * px + 0.1772986989 * py + 1541.3967848
world.z = -0.1954861981 * px + 0.7452779763 * py + 466.9249190
```

- RMS **13.03 m**, max residual **19.52 m**.
- Leave-one-out: firehall 26.54 m, cherry south 18.83 m, cherry/Commissioners 44.30 m,
  Polson/Cherry 50.46 m, Commissioners **58.36 m**.
- Conditioning: the original three non-firehall controls remain nearly collinear (min angle
  6.6°), but the added Commissioners control supplies an off-line constraint. The normal-matrix
  determinant rises from 116,704,809 (4 controls) to 171,251,155,116 (5 controls), and the LOO
  max falls from 321.74 m to 58.36 m.

## Original 4-control fit (retained for comparison)

```
world.x = 0.7631475361 * px + 0.1749389200 * py + 1529.1726592
world.z = -0.1353913563 * px + 0.7376804312 * py + 427.5681190
```

- RMS **9.56 m**, max residual 15.14 m.
- Leave-one-out: firehall **321.74 m**, cherry south 24.16 m, cherry/Commissioners 39.26 m,
  Polson/Cherry 52.55 m.
- Atlas Crane holdout **45.98 m**.

The 4-control fit has a lower in-sample RMS but a catastrophic firehall lever-arm; the
5-control fit trades a little in-sample fit for a much more stable holdout and LOO. Neither is
survey grade.

## Held-out Atlas Crane

Captain pixel `[458, 553]` was **not** used in either fit. Against the actual OSM point
`node/9521067431` (43.6435284, -79.3538817; world 2009.8, 804.0):

| Fit | Predicted world | Error |
|-----|-----------------|-------|
| 5-control (primary) | 1980.4, 789.5 | **32.77 m** |
| 4-control (comparison) | 1975.4, 773.5 | 45.98 m |

Both pass the 50 m gate; the 5-control fit is clearly better.

## Art label anchors → rendered pixels

Scale used exactly as instructed: `1800 / 1190.55 = 1.5119063` for both axes (the rendered
height ratio 1273/841.89 differs by ~0.01% and was ignored). These are **text anchors of the
printed marker numbers, not the actual sculpture dot centres**; the Captain must verify them.
World/latlon below are from the **5-control** fit; the JSON also carries the 4-control values.

| # | Work | Artist | Rendered px | World (x, z) | Provisional lat, lon |
|---|------|--------|-------------|--------------|----------------------|
| 1 | Orange Functional | Alexandre Arrechea | 1061.8, 468.4 | 2414.9, 608.4 | 43.646257, -79.349761 |
| 2 | Crown Act | Oluseye | 1437.5, 532.5 | 2706.0, 582.8 | 43.647226, -79.346395 |
| 3a | Stories of relics (i) | Ryan Gander | 905.6, 505.0 | 2305.2, 666.2 | 43.645476, -79.350861 |
| 3b | Stories of relics (ii) | Ryan Gander | 1009.2, 747.0 | 2425.2, 826.4 | 43.644403, -79.348869 |
| 3c | Stories of relics (iii) | Ryan Gander | 368.8, 506.5 | 1905.7, 772.3 | 43.643535, -79.355230 |
| 3d | Stories of relics (iv) | Ryan Gander | 266.7, 456.8 | 1820.9, 755.2 | 43.643464, -79.356298 |
| 4 | Homing | Nadia Belerique & Tony Romano | 847.4, 730.5 | 2301.8, 845.7 | 43.643919, -79.350266 |
| 5 | Roman Standard | Tracey Emin | 1115.3, 676.9 | 2491.8, 753.4 | 43.645204, -79.348336 |
| 6 | Delicate Matter (for the birds) | Kara Hamilton | 1292.4, 689.7 | 2625.8, 728.3 | 43.645764, -79.346832 |
| 7 | Trajet | Caroline Monnet & Dean Baldwin Lew | 1611.1, 473.4 | 2824.8, 504.8 | 43.648204, -79.345260 |
| 8 | First Sun | Monira Al Qadiri | 593.9, 447.2 | 2062.8, 684.1 | 43.644699, -79.353676 |
| 9 | against the wind, with the wind | Alexa Kumiko Hatanaka | 499.1, 490.0 | 1999.8, 734.6 | 43.644102, -79.354246 |
| 10 | The Colony | Kent Monkman | 202.0, 577.7 | 1794.2, 858.0 | 43.642509, -79.356252 |
| 11 | Lodestar | Lisa Hirmer | 137.1, 557.7 | 1742.4, 855.8 | 43.642395, -79.356875 |
| 12 | Saverio and Daisy (Navel) | Hank Willis Thomas | 137.1, 482.4 | 1729.0, 799.7 | 43.642845, -79.357232 |
| 13 | Ernest and Ruth (Exuberant Pink) | Hank Willis Thomas | 137.1, 420.3 | 1718.0, 753.4 | 43.643216, -79.357527 |
| 14 | Untitled (Juniper) | Virginia Overton | 192.0, 462.5 | 1766.3, 774.1 | 43.643161, -79.356880 |

All 17 anchors are marked `provisional: true` and `withheldFromRuntime: true` in the JSON.

## Correction to the earlier source doc

`docs/biidaasige-placekeeping-source.md` said the Fall 2026 map "proves" the works are
installed. That is too strong and is corrected here:

- The Fall 2026 map is a **published current/planned trail route**, not independent proof of
  on-site installation.
- The `First Sun` artist page still says the work is currently installed at **Doris C.
  Freedman Plaza, NYC** (run ended 2026-08-03). The Toronto installation is therefore **not
  independently verified** by a dated primary opening source in this pass.
- Map markers are **approximate source positions only**.

The old doc was not edited because this pass owns only the three new files; this section is
the authoritative correction. The Captain will correct the main fixture/doc after this pass.

## Hand-off

1. Captain verifies the rendered pixels and the text-anchor offsets.
2. The 5-control fit is better but still not runtime-grade (LOO 58.36 m). If a runtime
   placement is ever wanted, add more well-spread controls or obtain a georeferenced vector
   layer; do not force acceptance.
3. Do not use the provisional lat/lon as surveyed positions.
