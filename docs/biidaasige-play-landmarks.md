# Biidaasige Park play landmarks — Snowy Owl Play Theatre & Reaching Raccoon

Bead: `st-bmyv.3` (child of `st-bmyv`). Module: `js/biidaasige-play-landmarks.js` ·
Tests: `tests/biidaasige-play-landmarks.test.mjs`.

The two signature structures of Biidaasige Park (Port Lands) as reusable, **local-origin
procedural models**, for the captain to place once `js/biidaasige-park-data.js` provides exact
positions. It invents no park coordinates and edits no shared runtime.

| Structure | Maker | Source |
|---|---|---|
| Snowy Owl Play Theatre | Monstrum | <https://monstrum.dk/en/playground/snowy-owl-play-theatre> |
| Reaching Raccoon | Earthscape | <https://www.earthscapeplay.com/fr/projects/biidaasige-park-raccoon-playground/> |

Recognisable reconstructions, not the makers' production models. Every dimension is an explicit
**photo estimate** (`estimates` on each result, `BIIDAASIGE_*_SPEC`).

## Rework after the captain's GPU review

The first build was **rejected**: the owl read as a black prison barrel with a separate floating
sphere head, and the raccoon as a tiny grey box with a sealed pipe. This rebuild follows the
captain's corrected source observations (authoritative; see `play-review.md`):

**Owl** — the body is ~85–95 % **white** (measured: **90.9 %**), built as fitted, continuous slat
surfaces (not thin rods) with sparse deliberate black slots and pastel accents; official height
**9.0 m**. One **continuous body→shoulder→rounded-crown** silhouette with a forward pitch — no
separate ball head, no neck gap — with eye masks mounted **flush** on the continuous front (less
protruding). Two large **swept slatted wing panels** (a fan of overlapping white slats with black
feather slots) taper down and back on both sides. Eye masks are radial white disks with a dark ring
and a **mesh pupil** (not solid black discs). The lower front is a **red, recessed stage OPENING**
(red liner + arch, a dark floor set back) — a real recess, not an opaque black door — with separate
**natural curved timber nest tiers**. The dark backing is a clearly **inset** wall, not an opaque
outer cylinder. (The captain's `fittedShell` angular fix and merged-backing changes are preserved.)

**Raccoon** — the torso is a broad **FACETED timber volume**: alternating cream / reddish-red
boards (with a slight step-proud facet) that tile the torso as a closed volume — not bare posts and
not a grey box — over a slim inner core. A **broad triangular white/black masked face** with pointed
ears sits ON the torso (a timber head/neck, not a detached floating head). Wide curved striped
timber arms grip the cattle posts; a hollow ringed timber tail sweeps back. The huge leaf is a
**pointed organic almond leaf with vein ribs** (broadest mid-leaf, pointed at base and tip), not a
green rectangle, over green cattail posts with brown capsules and blue/white dragonfly accents. Logs
and net pegs ring the base; the metal slide is an **open U-shaped polished chute** (half-pipe, not a
sealed tube). Overall ~5.9 m. The palette is timber/cream/red/timberDark/pale/darkMask/leaf/leafVein/
greenPost/cattail/dragonfly/metal — never grey fur.

## API

```js
const C = window.CITY;                 // needs C.THREE and (optionally) C.Addons.mergeGeometries
const owl = C.buildOwlPlayTheatre({ spec?, scene? });
const raccoon = C.buildReachingRaccoon({ spec?, scene? });
const both = C.buildBiidaasigePlayLandmarks(scene?);
```

Each builder returns `group` (a `THREE.Group` **not added to any scene** unless passed; origin at
the ground contact, ground at y = 0, +Y up, 1 unit = 1 m, +Z facing), `colliders` (the structure's
own opaque boxes only, tagged `owl-*` / `raccoon-*`; no hidden generic house collision),
`surfaces` (walkable triangles from real geometry — the owl deck; empty for the raccoon),
`climbable` (**always false** until movement/footing is integrated), `triangles`, `drawCalls`,
`estimates`, `source`, `attribution`.

No-claim guards baked in: the raccoon slide is a visual half-pipe — **not** a surface and **not** a
collider, and no ground height is guessed.

## Metrics (this build, CPU)

Combined **~14,830 triangles, 25 draws** (owl 10,372 / 10 draws; raccoon 4,458 / 15) — merged by
material. Owl **white coverage 90.9 %**, height 9.0 m; raccoon height ~5.9 m.

## What the tests prove (from real geometry, not constants)

`tests/biidaasige-play-landmarks.test.mjs` (15 tests, including the captain's radial-raycast exterior-coverage test) builds the real model in a Node VM and checks:
white board **coverage 85–96 %** and an inset (not outer) dark backing; a **continuous** white
shell with **no empty vertical band** (no head/neck gap) and a forward-leaning crown; **two** wing
panels on both sides reaching low and wide; small pupils vs the white shell (not black discs); a red
belly and **curved** timber tiers at several radii; finite transforms, ground at 0, Y-up, sizes and
bounded budgets; outward-wound horizontal deck triangles; **open** slatted timber torso (no `fur`)
with an inner backing and the full leaf/cattail/dragonfly palette; the slide's real **open
half-pipe** area being below a sealed cylinder's and more than a flat plate; honest `climbable:false`
and no chute collider/surface; the assembly/source/attribution and scene-only-when-passed contract;
and the no-`mergeGeometries` concat fallback.

## Sources & limits

Source URLs and the captain's authoritative visual read are in
`$WATERFRONT_RESEARCH/biidaasige/play/SOURCES.md`; captain copies at
`$WATERFRONT_RESEARCH/biidaasige/captain/{owl-front,owl-back,raccoon-overview,raccoon-slide}.png`.
No copyrighted maker photo is copied into the repository — only cited. Dimensions are photo
estimates, the structures are not claimed climbable, and no park coordinates are invented here;
exact placement waits on the inventory worker's data.
