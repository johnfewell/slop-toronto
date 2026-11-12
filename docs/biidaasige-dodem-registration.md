# Biidaasige Park — Dodem photo registration (st-bmyv.4)

Bounded registration of the Captain-matched **MVVA finished-site photograph** onto the **2025
City orthophoto** and the existing city world frame, for **seven Dodem animals**: the original
four on the first timber island (fit-only) and three additional animals on the adjacent
three-animal island (source-aerial-validated). The Captain personally viewed both images; the
model did not inspect pixels.

Owned files only:

- `tools/register-biidaasige-dodem.mjs` — reproducible fit
- `tools/fixtures/biidaasige-dodem-registration.json` — machine-readable result
- `docs/biidaasige-dodem-registration.md` — this file

No runtime, no shared files, no GPU/browser, no commits, no generic search. Private photo/ortho
pixels stay outside the repo; only source facts and control coordinate pairs are recorded.

## Verdict

| Check | Value | Limit | Result |
|-------|-------|-------|--------|
| Homography RMS (8 controls) | **0.61 m** | 3 m | pass |
| Max control residual | 1.04 m | — | — |
| Leave-one-out max | **1.80 m** | — | good |
| Held-out round bench (7-control fit) | **0.79 m** | 5 m | pass |

**Fit quality: `PASS`.** Provisional data only; **not auto-placed**. Captain review required.

## Corrected mathematical statement

The earlier claim that the homography is "exactly determined" was wrong. Eight point pairs
supply **16 scalar constraints** for the **8 unknowns**, so this is an **overdetermined
least-squares fit**. The low in-sample RMS is therefore a genuine (if still in-sample) result,
and the meaningful checks remain the leave-one-out (max 1.80 m) and the held-out round bench
(0.79 m). The script, this doc and the regenerated fixture all use the corrected wording.

## Method

1. **8-DOF projective homography** from oriented photo pixels (1076×1000) to ortho image
   pixels (2500×1726), least squares via normal equations.
2. **Ortho pixel → EPSG:3857 Mercator**: `mx = xmin + (px/W)(xmax−xmin)`,
   `my = ymax − (py/H)(ymax−ymin)`.
3. **Mercator → WGS84**: `lon = mx/R·180/π`, `lat = (2·atan(exp(my/R)) − π/2)·180/π`,
   `R = 6378137`.
4. **WGS84 → existing world** via `js/city-config.js` `worldFromLatLon`.

The 2025 ortho is used **only for ground registration**. It shows a **construction ladder at
the north neck, not animals**; no aerial object was used to identify an animal. The distinctive
curbs give a valid built-site match between the finished photo and the 2025 ortho.

### Exact crop/rotate/fit transform (4800×3600 → 1076×1000)

```
oriented = Rot(+148°) · (original − [3750, 2225]) · scale + [538, 500]
scale    = 1000 / (|sin 148°|·2000 + |cos 148°|·1450) = 0.436775011483
Rot(+148°) in screen coords (y down): x' = dx·cosθ − dy·sinθ, y' = dx·sinθ + dy·cosθ
```

This reproduces the recorded raster recipe exactly; the three extra animals' derived ortho
pixels match the fixture's `projectedOrtho*` values to **< 0.005 px**.

## Homography

```
orthoPixel = H · orientedPhotoPixel
h = [0.455903353739, -0.110959171595, 1041.21781953,
     0.103670361886,  0.328304080614,  974.073641384,
     0.000054118109, -0.000064479764]
```

## Control residuals and leave-one-out (world metres)

| Control | Residual | Leave-one-out |
|---------|----------|---------------|
| north-gate-left | 0.75 m | 1.37 m |
| north-gate-right | 0.59 m | 1.22 m |
| round-bench-center | 0.35 m | 0.79 m |
| south-bulb | 0.23 m | 1.80 m |
| southeast-bulb | 0.10 m | 0.45 m |
| south-inner-notch | 1.04 m | 1.31 m |
| east-waist | 0.65 m | 1.01 m |
| west-waist | 0.65 m | 1.10 m |

Held-out round bench (dropped from the fit, predicted from the other seven): **0.79 m**.

## Seven Dodem animals (provisional, not auto-placed)

Body and head pixels come from the MVVA finished-site photograph. Heading is the body→head
vector in the existing world frame (`+Z = 0°`, `+X = +90°`).

| Animal | Set | Body lat, lon | Body world (x, z) | Heading +Z | Bearing | Uncert. | Validation | Heading uncert. |
|--------|-----|---------------|-------------------|------------|---------|---------|------------|-----------------|
| beaver | original4 | 43.6455251, -79.3509374 | 2300.8, 659.2 | +54.4° | 125.6° | 3 m | fit-only | — |
| otter | original4 | 43.6455261, -79.3509133 | 2302.7, 659.7 | +96.7° | 83.3° | 3 m | fit-only | — |
| wolf | original4 | 43.6454042, -79.3510145 | 2291.0, 670.3 | +135.2° | 44.8° | 3 m | fit-only | — |
| bear | original4 | 43.6454025, -79.3508625 | 2302.7, 674.0 | −39.6° | 219.6° | 3 m | fit-only | — |
| turtle | extra3 | 43.6456533, -79.3507083 | 2322.6, 650.9 | −45.6° | 225.6° | 4 m | source-aerial-validated | — |
| musky | extra3 | 43.6456732, -79.3507100 | 2323.1, 648.7 | −78.9° | 258.9° | 4 m | source-aerial-validated | — |
| eagle | extra3 | 43.6456641, -79.3508004 | 2315.8, 647.6 | −41.6° | 221.6° | 4 m | source-aerial-validated | **15°** |

**Validation exposure.** The original four are **fit-only**: projected from the ground
homography with no independent aerial check. The three extra animals are
**source-aerial-validated**: the Captain independently overlaid the projected centres on the
2025 City ortho and confirmed the turtle/musky/eagle forms there within about **1 m**.

**Containment.** All seven are inside their own island ring and not the other: the original four
in `inverted-oak-woodchip-island`, the three extra in `dodem-three-animal-island`.

**Extrapolation.** The three extra animals sit **15–25 m beyond the timber-island control
region**, so they carry a larger **4 m** uncertainty (the original four keep **3 m**).

**Heading uncertainty.** Only the eagle's heading is a source **head-only estimate** and is
marked **15°**. No other heading uncertainty is stated in the source.

## Policy and limits

- **No auto-placement.** Provisional anchors for Captain review, not runtime data.
- **No 3D tree-height controls**; ground homography only.
- **Height parallax**: body pixels can parallax by up to ~2.4 m; the 3 m / 4 m floors cover
  that and photo interpretation. Not surveyed.
- **Identification**: current MVVA finished-site photo only. The 2025 ortho north-neck
  construction ladder is not an animal.
- **Private pixels**: source photo, oriented crop and ortho PNG remain under
  `$WATERFRONT_RESEARCH/biidaasige/` and are not committed.

## Hand-off

1. Captain reviews the seven provisional positions and headings.
2. If accepted, the Captain integrates them; this pass touches no runtime or shared files.
3. Re-fit only if better ground controls or a surveyed island datum become available.

## Captain runtime acceptance

The captain reviewed all seven points against the finished-site photograph and independently overlaid the three extrapolated centers onto the City aerial. All points fall within their separately traced play islands. The runtime adapter now accepts these as **photo estimates**, retaining 3 m / 4 m uncertainty and approximate headings. The fit tool remains a data-only tool and never places objects itself. Accepted build/captures and checks are recorded in [Dodem runtime acceptance](biidaasige-dodem.md#accepted-source-derived-placement).
