# Biidaasige Park — Dodem clan-animal sculptures

Bead `st-bmyv.4` (child of `st-bmyv`). This module is an **independent** replacement for the crude Dodem placeholders
that lived inside `js/biidaasige-adventure-play.js`. It owns only:

- `js/biidaasige-dodem.js` — the factories
- `tests/biidaasige-dodem.test.mjs` — the geometry and honesty tests
- `tools/fixtures/biidaasige/dodem-source-evidence.json` — the checked-in appearance/evidence ledger
- `docs/biidaasige-dodem.md` — this file

It does **not** edit the existing adventure module, shared data or `main.js`, and it invents no coordinates. Other
park work (Badlands, cableways, swings, the mock dam) stays where it is.

## Maker, material and the three source tiers

The **2026 City of Toronto Port Lands open-house boards** (p.5) credit the sculptures: *"Dodem animal sculptures by
APE Richter/Christian Huba in consultation with MCFN and MinoKamik Collective"*. The maker's own catalogue states they
are carved from **mountain larch (Lärche) trunks — not oak**. Both facts are carried on every factory as
`attribution`, `attributionSource` and `material`. See `docs/biidaasige-dodem-source.md` for the full source index.

The captain personally viewed the workshop Toronto photos and the City 2026 installed crop, and the appearance now
follows three distinct evidence tiers:

| Animal | `verifiedAppearance` | `appearanceConfidence` | What was actually seen |
| --- | --- | --- | --- |
| eagle | **true** | `primary-photo` | City primary eagle photo and Toronto workshop eagle photograph: squat broad folded scalloped wings, natural brown body, white head with a jagged feather edge, black chest, broad yellow hooked beak, three white tail feather tips, yellow talons around a log perch |
| bear | false | `workshop-reference` | Workshop photo "am Bär" plus the public RFO Toronto workshop video at 00:15 and 11:45: **upright/seated** massive broad brown larch body, forepaws against the belly, big rounded block muzzle, round ears, **broad connected black eye mask, black inner ears, very large faceted blunt black nose, natural larch rings around the pupils, black lower-claw accents** — **not on all fours**; ~2.4 m is a workshop estimate |
| turtle | false | `workshop-reference` | Workshop photo "Die Schildkröte" (five parts, ~1 tonne): a **broad low almost-flat** segmented larch shell (~0.45 m rise) of contiguous same-wood panels with **thin green recessed seams** (no white caps), **red band/underside**, four **very broad paddle** flippers (front pair spanning almost the whole front side) with **three turquoise claw triangles** across each outer edge, and a **huge wide oval head** (~0.75 m wide, ~0.8 m long) with a broad curved black smiling lower face and large circle-outline eyes on the topsides; ~3.3 m × 2.7 m × 0.6 m is a workshop estimate |
| wolf | false | `workshop-reference` | Workshop photo "Eine Wölfin mit ihren Jungen": **solid carved standing all-fours mother with two complete cubs under the belly**, broad continuous trunk back, **short forward head with clear pointed ears and black eyes/nose**, tapered broad wood legs; unfinished natural pale larch with no invented final paint |
| otter | false | `programme-and-partial-installed` | Richter programme otter sketch plus the City 2026 installed crop's long low form on the left on a visible **blue/green painted metal rocker/spring base** (identity not independently captioned) |
| beaver | false | `programme-and-partial-installed` | Richter programme beaver sketch (crouched upright, blunt head with two incisors, small forepaws at the chest, broad flat tail) plus the City 2026 installed crop's round form on the right on a visible **blue/green painted metal rocker/spring base** (identity not independently captioned) |
| musky | false | `partial-installed-photo` | Captain-viewed primary MVVA 4800×3600 finished-playground photo (`captain/dodem-west-three.png`): a **very long low flattened warm-brown larch oval** with a broad rounded head, two **black/teal ringed eyes on the top near the front**, and a tapering rounded tail — a moulded solid form with **no large dorsal fin, no forked tail and no pedestal**; partial installed photo only, not verified as-built |

Only the eagle is `verifiedAppearance: true`. The bear, turtle and wolf are **workshop-reference**, distinct from an
installed as-built match. The otter and beaver are **programme sketches plus a partial installed crop** (both on a
painted blue/green metal rocker/spring base), and their identities are not independently captioned, so they are not
claimed as as-built. The musky has a single captain-viewed overhead installed photo (`partial-installed-photo`), which
is not enough to mark it verified. No animal is reported as a verified
as-built reconstruction except the eagle. No Indigenous graphics or symbols are invented; expressions stay quiet and
gentle. No copyrighted pixels are shipped.

## Runtime API (`window.CITY`)

```js
C.BIIDAASIGE_DODEM_ANIMALS   // ['bear','beaver','eagle','turtle','otter','wolf','musky']
C.BIIDAASIGE_DODEM_SPECS     // the appearance/evidence ledger
C.BIIDAASIGE_DODEM_ATTRIBUTION // the verified 2026 maker credit
C.BIIDAASIGE_DODEM_MATERIAL  // 'mountain larch (Lärche) trunks, not oak'

C.buildBiidaasigeDodemAnimal(kind)   // one sculpture; null for an unknown kind
C.buildBiidaasigeDodemSet()          // { bear, beaver, eagle, turtle, otter, wolf, musky }
```

`kind` accepts `musky`, `muskie`, `muskie fish` and `muskellunge` (all normalise to `musky`). Each factory returns:

| Field | Meaning |
| --- | --- |
| `group` | a fresh `THREE.Group`, origin at the ground contact, +Y up, 1 unit = 1 m, facing +Z; **never** added to a scene |
| `kind` | the normalised species key |
| `triangles`, `drawCalls` | bounded geometry (`drawCalls.length < 8`, one mesh per material) |
| `colliders` | one AABB `{ minX, maxX, minY, maxY, minZ, maxZ, kind, prop: true }` around the built sculpture |
| `surfaces` | always `[]` — the sculpture claims no walkable surface; `climbable: false` |
| `dimensions` | `{ heightM, lengthM, widthM, status: 'photo-estimate-not-survey' }` from the built bounding box |
| `appearance`, `appearanceConfidence`, `verifiedAppearance`, `sourceEvidence` | the honesty ledger above |
| `attribution`, `attributionSource`, `material` | the verified 2026 maker credit and mountain-larch material |
| `position`, `placementStatus` | `null`, `'unplaced'` — no coordinate is invented |

The factory never reads the network or a copyrighted image; it builds geometry from code and cites sources only.

## Geometry approach

No 99-sphere anatomy. Each animal is a **lathed/lofted contoured body** (real rings of quads, front-to-back or
bottom-to-top) plus prism, extruded and disc parts for the species features: carved ears, rounded block muzzle, paws,
flippers, shell seam lines, fins and a flat paddle beaver tail. Parts are merged **per material** so each animal is
fewer than eight meshes. Flat shading from the merged geometry, with `MeshStandardNodeMaterial` at high roughness and
zero metalness, reads as carved natural larch. The eagle carries the painted accents (black chest, white head and tail
tips, yellow beak and talons); the turtle is a broad low almost-flat same-wood shell with thin green recessed seams
(every seam vertex derives its height from the shell profile and is buried slightly, so no bar floats; there are no
white caps or plaques), a red band, four very broad paddle flippers with three turquoise claw triangles each, and a
huge wide oval head with a broad curved black mouth and large circle-outline eyes; the bear carries its RFO
workshop-video finish (broad connected black eye mask, black inner ears,
very large faceted blunt black nose, natural larch rings around the pupils, black lower-claw accents on the forepaws).
The bear's face is massive and wide with a short muzzle; the wolf is a solid carved mother with a short forward head,
pointed ears and two complete cubs (four legs, head and ears each) under the belly.

Approximate built dimensions (photo/workshop estimates, **not** surveys): bear 2.42 m tall × 1.05 m long × 1.10 m wide
(head ~0.79 m wide, black nose ~0.55 m wide × 0.30 m high with a ~0.25 m projection); turtle 3.34 m long × 2.71 m wide
× 0.59 m high (shell rise ~0.45 m, head ~0.75 m wide × 0.8 m long); wolf 2.36 m long × 0.70 m wide × 1.14 m tall;
eagle 1.27 m tall; otter 2.26 m long × 0.85 m tall (incl. a ~0.15 m steel rocker base); beaver 1.34 m long × 1.10 m
tall (incl. the steel base); musky **2.05 m long × 0.80 m wide × 0.40 m tall** (was width ~0.65 m, length ~2 m, top
height ~0.45 m photo estimate).

## What the tests prove

`node --test tests/biidaasige-dodem.test.mjs` (17/17) checks the **real built geometry**, not mirrored constants:

- all seven build; aliases resolve; unknown kinds return `null`; `buildBiidaasigeDodemSet` has all seven
- local origin: ground contact ~0, +Y up, a distinct `+Z` front, `position: null`, no walkable surface, estimate dimensions
- honesty: only the eagle is verified; the other six declare `workshop-reference` /
  `programme-and-partial-installed` / `approximate-no-individual-photo`; every animal carries the verified 2026
  attribution and the mountain-larch material; the checked-in fixture matches the module spec
- the wolf is asserted to be a **standing all-fours mother with cubs**, never a seated wolf, and the stale owl
  seated-wolf evidence is asserted gone
- budget: fewer than eight meshes per animal, bounded triangles, finite positions/normals
- every material mesh is outward-wound with positive signed volume
- the projected plan and elevation silhouettes are measured from the built vertices and match the reported dimensions
- species anatomy from the geometry: bear upright/seated with a barrel body, a massive wide head, a very broad short
  black nose, a single connected eye mask (a triangle bridges the centre, not two squares), natural-wood paws and the
  RFO workshop finish (black inner ears, larch pupil rings, black lower-claw accents); beaver crouched
  upright with two incisors and a flat tail; eagle squat scalloped wings / white head / black chest / yellow beak /
  three white tail tips / talons; turtle a low almost-flat same-wood shell (rise < 0.5 m) with no white caps, thin
  green seams that follow the dome profile (max seam-to-shell gap asserted small, no floating bars), a red band, four
  very broad tapering paddle flippers with three turquoise claw triangles each, and a huge wide head with a broad
  curved black mouth and large circle-outline eyes; otter long low arched / raised slim neck /
  tapering tail; wolf standing all-fours with a broad trunk back, a short forward head, pointed ears, black eyes/nose,
  wood legs and two complete cubs (four feet on the ground, head and ears each) under the belly; musky a very long low
  flattened solid oval (no big fins/fork/pedestal) with a broad head, two top ringed eyes, a tapering tail and a
  warm-brown material; otter and beaver each carry a 0.12-0.2 m steel rocker base
- the no-`mergeGeometries` fallback still builds finite, grounded geometry

The eye/honesty is deliberately strict: the module must never claim a verified as-built appearance it cannot source, and
must stay a useful quality local factory in the meantime.

## Still open

- Primary/dated **installed** photos for the six non-eagle animals would let each interpretation be replaced and
  marked verified. Today the bear/turtle/wolf are workshop-reference, the otter/beaver are programme-plus-partial, and
  the musky has a single overhead installed photo (`partial-installed-photo`).
- Individual source-derived positions are now registered and integrated by the runtime adapter below. The local factories retain `position: null` by design.
- Detailed appearance remains approximate; the installed overhead photograph does not verify every face or hidden construction detail.

## Sources

| Source | URL |
| --- | --- |
| City — Recreation at Biidaasige Park (Dodem animals) | https://www.toronto.ca/explore-enjoy/parks-recreation/places-spaces/beaches-gardens-attractions/biidaasige-park/recreation-at-biidaasige-park/ |
| City — 2026 Port Lands open-house boards (p.5 maker credit) | https://www.toronto.ca/wp-content/uploads/2026/04/8e64-city-planning-port-lands-open-house-boards.pdf |
| City — 2026 map PDF (play cluster) | https://www.toronto.ca/wp-content/uploads/2026/09/978c-Biidaasige-Park-map.pdf |
| Richter — Christian Huba designer page (mountain larch) | https://www.richter-spielgeraete.de/en/our-idea/crafts-and-materials/christian-huba-441/ |
| Captain primary eagle photo | `captain/dodem-eagle.jpg` (cited, not copied into the repo) |

The full maker and reference index (including the workshop photos and the chiemgau24 maker interview) is in
`docs/biidaasige-dodem-source.md`. No copyrighted photo is copied into the repository; source facts and attribution only.

## Accepted source-derived placement

The runtime now places all seven through `js/biidaasige-dodem-placements.js`, generated from the recorded source contract and captain-reviewed photo registration. The first four use the 270.1 m² inverted-oak island; turtle, musky and eagle use the separately traced 190.9 m² island. Locations come from the finished MVVA photograph registered onto the City2025 orthophoto, not a generic animal scatter. The eight-control ground homography has 0.61 m RMS, 1.80 m maximum leave-one-out error and a 0.79 m held-out bench check. Position uncertainty remains **3 m** for the first four and **4 m** for the three extrapolated points. Headings are photo estimates.

Every pose is admitted only where the actual rendered island query returns its physical woodchip height. The integration rotates the real model collider and adds it to the same scene/culling root; the sculptures remain solid props, with no claim of a complete climbing simulation. A coarse path ribbon intruding into the second island is masked only at the traced boundary, and its hidden footing is excluded there. Distant path materials and walking heights remain intact.

The captain personally accepted build **967e81d62e19** in six desktop and six portrait views (`dodem-seven-desktop-*` / `dodem-seven-phone-*`) on the Mac mini through `gpu2`. The turtle mouth received a real downward/front ray test after the first face paint was hidden inside the nose cap. Full validation: **1,336 total / 1,333 passed / 0 failed / 3 existing skips**. Contended captures establish functional appearance, not idle performance budgets.

Regenerate poses with `node tools/build-biidaasige-dodem-placements.mjs`; `--check` verifies current output. The geographic fit and private-image provenance are described in [photo registration](biidaasige-dodem-registration.md). No source photograph or maker production model ships.
