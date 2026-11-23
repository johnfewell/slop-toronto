# Slop New York port, November 2026: pedestrian gait, bike brakes, cheaper shaders

Spec for bringing in what is worth taking from `mrdoob/slop-newyork` after Toronto's last sync. Draft 2026-11-14, for
John's review. Beads: see "Tracking" at the end.

Reviewed: the 15 upstream commits from `e35c06c` (2026-10-29) to
[`2813185`](https://github.com/mrdoob/slop-newyork/commit/2813185) (2026-11-10), plus one older commit Toronto never
took (`13dd142`, 2026-10-28). Everything below comes from reading the diffs against Toronto's `main` at `78ffd9f`.
Nothing has been run or measured yet; each part says how it will be.

## 1. Why

- **How pedestrians walk bothers John.** Upstream has reworked walking, running, turning, jumping and landing in
  three commits, and Toronto has none of them.
- Toronto's road, sidewalk and facade shaders still compute detail that is already faded to nothing. Upstream now
  skips it with the picture unchanged.
- The bicycle has braking problems upstream has fixed.
- Two smaller items need a check before anyone decides: tall-tower shadows and the culling thresholds.

**Kept as it is: how pedestrians go down when hit.** John likes it. The ragdoll, the knock-down and the getting-up
blend are Toronto's own (from aalghooneh's fork) and no part of this work changes how they look or behave.

## 2. Parts, in order

| # | Part | Upstream commits | Size | Decision |
|---|---|---|---|---|
| A | Pedestrian gait, jump and landing | `13dd142`, `63df441`, `536a907` | Large | Do |
| B | Bicycle braking | `df5a3b9` | Small | Do |
| C | Skip faded-out shader detail | `f3635e7`, `91dc313`, `95e455c` | Medium | Do |
| D | Tall towers keep their shadows | `e17cde4` | Small | Check first, port only if the fault shows |
| E | Culling thresholds and render settings | `c8a904d` | Small | Measure, keep only what wins |
| F | Drop the storage-buffer swap for instance matrices | `21f71bd` | Small | Measure, keep only if neutral or better |

Each part is its own branch, pull request and deploy. A, B and C do not depend on each other. B is first because it
is an afternoon; A is next because it is the one John asked for.

## 3. Part A: pedestrian gait

### What upstream changed

All of it is in one class, `PersonRig` in `js/pedestrians.js`, plus the on-foot player in `js/controllers.js`.
`PersonRig` animates every person in the city: the sidewalk crowd, the player on foot, and riders.

- `13dd142`: cleaner walking gait, idle weight shifts from leg to leg, and turning at corners (the head leads, the
  body banks, the pelvis turns).
- `63df441`: walking, running and turning rebuilt around explicit foot events (`touchDown`, `liftOff`, `stanceFoot`,
  `swingFoot`), with one shared two-bone limb solver.
- `536a907`: jumping gets a short crouch before take-off (0.085 s), an airborne pose and a landing; the blob shadow
  under the player stays on the ground and shrinks with height.
- On-foot player: speed no longer builds up while pushed against a wall or the shore.

Upstream's class grows from 633 to 1,024 lines across the last two commits.

### Why this is cheaper than it looks

Toronto's `PersonRig` is almost exactly upstream's from 2026-10-26 (`065e397`): 66 differing lines out of 619. The
differences are two things only:

1. Small arithmetic speed-ups (squared distances instead of `Math.hypot`, shared easing factors from `syncEase`).
2. Two methods the ragdoll needs, `jointAt` and `blendFrom`.

So the port is: **replace Toronto's `PersonRig` with upstream's at `536a907`, then put those two things back.** It is
not a hand merge of 1,100 lines.

The pose buffer has the same layout on both sides (15 bones, two `vec4` per bone, one info `vec4`), so the crowd
shader, `jointAt` and `blendFrom` keep working on the new rig without changes to their maths.

### Toronto adaptations

- **Classic scripts.** Upstream is ES modules. Toronto keeps the ordered loader and `window.CITY`; the class is
  copied in without `import`/`export`.
- **Ragdoll hooks.** Re-add `jointAt` and `blendFrom` to the new class. `PersonRagdoll`, the knock-down code in
  `js/traffic.js` (from line 3307) and the getting-up blend (`p.rig.blendFrom`, line 3455) are not edited.
- **Getting up into the new gait.** `blendFrom` blends from the pose the ragdoll left into whatever the rig is
  doing. The new rig has more state (`standY`, pelvis yaw and roll, lean, foot stance). After a ragdoll the rig must
  be `reset` at the body's position so it does not step from stale footprints. This is the one place the two systems
  touch and gets its own test.
- **Escape dives.** Upstream replaced `solveDiveLimb` with the shared `limb` solver and retuned `DIVE_POSES`. Take
  upstream's, then confirm Toronto's dive checks (deck heights, sidewalk clearance, other people) still call it the
  same way.
- **Far pedestrians.** Toronto stops posing far characters (`updatePose` flag, commit `f5f4b9f`) and skips hidden
  ones. The new `update` keeps that parameter; confirm the early exit still skips the new foot planning as well as the
  pose solve.
- **Riders.** `ride()` (cyclists, and anyone seated) is unchanged upstream apart from its solver calls. Check a
  cyclist and a Bike Share rider.
- **Footstep sounds.** `js/audio-sources.js` reads `rig.phase`, `rig.speed` and `rig.feet[0..1]`. Upstream changed
  seven lines there for the new foot fields; port those.
- **Player on foot.** Port the jump crouch, airborne flag, shadow and the blocked-speed fix into Toronto's
  `ThirdPersonControllerManager`. Toronto's `resolveHorizontalCollision` and `getGroundHeight` differ (bridge decks,
  the islands, park terrain), so the logic is ported by hand, not copied. Jumping off a bridge sidewalk and walking
  down the High Park slope are the cases to watch.
- **Tests.** Upstream has `tests/pedestrians.test.cjs` (1,054 lines) and 212 more lines in
  `tests/controllers.test.cjs`. Toronto has no rig test file. Bring both over, adapted to the classic loader.

### Acceptance

- `npm test` passes, including the ported rig tests and a new one: knock a pedestrian down, let them get up, and the
  pose is finite and continuous through the blend (no jump larger than a set distance per frame at any joint).
- Captures on the Mac mini (through `gpu2`), same camera before and after, as short clips, because gait cannot be
  judged from stills:
  - crowd walking on a busy sidewalk, including a corner turn and a WALK-signal start;
  - player walking, running, turning on the spot, jumping and landing;
  - a pedestrian hit by the car, lying, and getting up; this clip must look the same as today up to the moment they
    stand;
  - an escape dive and recovery;
  - a cyclist.
- `node tools/benchmark-pedestrians.mjs vendor/three/three.core.js` before and after. The new rig does more per
  person; record the cost per frame. If the crowd costs more than 15% extra, bring back Toronto's arithmetic speed-ups
  first, then look at posing fewer people at full detail.
- John watches the clips. The gait is the point, so his eye is the gate.

### Risks

- The rig is larger and may cost more on phones. The benchmark above decides; the phone tier can keep a lower
  crowd count if needed.
- Upstream tuned stride and timing on flat Manhattan streets. Toronto has slopes (High Park, the Don Valley) and
  stairs to bridge sidewalks. Feet are planted by sampling the ground, as before, but the slope walk is in the capture
  list for this reason.

## 4. Part B: bicycle braking

Upstream `df5a3b9`. Toronto's `BICYCLE_DRIVE` in `js/controllers.js` (line 71) still has the old values.

- Space brakes the bike (it only did so for the car).
- S brakes at full strength while moving forward, then holds at zero for 0.25 s before backing up, so holding S
  stops cleanly.
- Speed stops building while the bike is pushed against a wall or the shore.
- New drive numbers: acceleration 9 to 6.5, coasting drag 0.2 to 0.45, brake 7.5 to 10.5, and a power limit above
  38 km/h. These change how the bike feels and are John's call; port them as upstream has them, and they are four
  numbers to change back.
- The freewheel sound stops while braking; the controls hint gains "Space: Brake".

Toronto keeps its own boost input and its powertrain for the car, which this does not touch.

Acceptance: upstream's added controller tests ported and passing; John rides it.

## 5. Part C: skip faded-out shader detail

Upstream `f3635e7`, `91dc313`, `95e455c`, all in `js/tsl-materials.js`. The picture is meant to be identical; only
the cost changes.

- **Apartment interiors.** The room behind each window is raycast for every facade pixel, walls and roofs included.
  Upstream runs it only where the glazing mask is above zero. Upstream measured a median 0.6 ms off the frame at
  1440x900 on an M1. Toronto has neither `apartmentInteriorBehind` nor the drape-footprint helper.
- **Road.** Grit, aggregate, stone chips, fine relief and oil stains branch on their own fade; potholes and oil drips
  only run in the cells that have one. Toronto's road material has diverged (it has `wearLite` and `wearFull` quality
  switches from the asphalt-wear port), so the helper `fadedDetail` is ported and applied layer by layer to Toronto's
  version.
- **Sidewalk and curb.** Same treatment. Toronto's sidewalks are the City's polygons with their own panel shader, so
  again by hand.

One rule from upstream to keep: anything that takes a screen-space derivative (`fwidth`) must be computed before the
branch, or the edges of the branch show.

Not taken: the neon tint branch for Times Square.

Acceptance:
- Before and after stills from the existing lists (`tools/shots/upstream-take-now.json`, `sidewalks.json`,
  `toronto-sidewalks.json`, a night facade view), compared pixel for pixel. Differences beyond noise are a bug.
- `?gputime=1` pass times before and after on the Mac mini, same session, interleaved. Report the number honestly,
  including if it is within noise.

## 6. Part D: tall towers keep their shadows (check first)

Upstream `e17cde4`. The sun's shadow cameras only reach 220 to 300 m above the cascade, so a tower taller than that
has the top of its shadow cut off several blocks away. Upstream moves each cascade camera back along the sun.

Toronto uses the same `SunLight` with no such correction (`js/lighting.js`, far plane 300 to 720 m scaled by quality).
The CN Tower is 553 m and First Canadian Place 298 m.

Step 1 is a capture: low sun, looking at the ground several blocks down-sun of the CN Tower and of the Financial
District. If the shadows are whole, close this part with the pictures. If they are cut, port the camera shift with
Toronto's tallest height in place of upstream's 550, and bring upstream's `tests/lighting-shadow.test.cjs`.

## 7. Part E: culling thresholds and render settings (measure)

Upstream `c8a904d` is a set of numbers. Toronto still has the old ones in `js/scene-culling.js` (lines 387 to 390,
489, 498).

| Setting | Toronto now | Upstream now | Note |
|---|---|---|---|
| Smallest instanced batch split into cells | 64 instances, 40,000 triangles | 32 instances, 8,000 triangles | More batches culled by cell |
| Batch radius that qualifies | 1,500 m | 800 m | |
| Merged mesh size that gets culled | 20,000 triangles | 8,000 | |
| Shadow source radius | 600 m | 350 m | |
| Bloom resolution | 0.5 | 0.35 | Toronto: try on lower tiers only |
| Shadow tile | by quality tier, up to 3072 | fixed 2048 | Toronto keeps its tiers |
| Firefox | multisampling on | off | Toronto's phone tiers already use other smoothing |

Splitting more batches means more draw calls for less drawn geometry; whether that wins depends on the scene. Run
`tools/shots/upstream-cull.json` and the uncapped walk lists before and after, one change at a time, and keep only
the ones that win outside noise. Toronto's bigger desktop frame (190 km²) makes this more likely to pay than it did.

## 8. Part F: instance matrices (measure)

Upstream `21f71bd`. On WebGPU Toronto swaps every instanced mesh's matrices into storage buffers
(`js/main.js`, line 475) to avoid re-uploading them. Three r187 now uploads them only when flagged, and upstream
measured no difference with the swap removed (14.8 against 14.9 ms).

Toronto is on r187. Remove the swap and the `DynamicDrawUsage` flag on fire escapes, and measure buffer upload per
frame with `?compilelog=1`. `js/scene-culling.js` (line 944) has a check that knows about storage attributes; it must
still gate empty instances correctly. If the numbers are equal, keep the removal because there is less code.

## 9. Not taken

| Upstream change | Why not |
|---|---|
| Storefront sign and spotlight heights (`6b191ee`) | Toronto does not have the affected code |
| three.js r187 (`16d6782`) | Toronto is already on it |
| One loading bar (`737b769`), no traffic dots on the minimap (`343a0f9`) | New York page choices |
| OpenStreetMap importer (`196578b`), porting guide (`2813185`) | Toronto builds from City data |

## 10. After each part

Add a section to `docs/upstream-sync.md` with the commits, the Toronto adaptation and the measured result, as the
earlier ports did. The checkpoint for "reviewed through" becomes `2813185`.

## Tracking

Parent bead `st-iq0v`. One child per part: A `st-iq0v.1`, B `st-iq0v.2`, C `st-iq0v.3`, D `st-iq0v.4`,
E `st-iq0v.5`, F `st-iq0v.6`.
