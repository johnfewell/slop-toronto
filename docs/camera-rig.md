# Interactive follow camera and Toronto two-shot

Implementation for `st-z9jy`. The supplied 10 November 2026 COO behaviour brief is
the reference; this implementation does not copy the minified COO bundles. Its
public URLs were unavailable to the browser fetcher during implementation.

## Controller and frame ownership

`js/cameras.js` owns the single `PerspectiveCamera`. Toronto uses metres, Y up and
heading zero towards **+Z**, whereas the reference uses −Z. There is no ECEF frame
or origin rebasing in this application. `js/controllers.js` owns movement, contact
and the displayed entity root. The variable-step simulation already caps ordinary
frame deltas to 50 ms; the camera also caps its own delta independently.

The existing `main.js` frame samples the gamepad once, advances player movement,
then resolves the camera before scene culling and rendering. Passenger cameras
resolve after their streetcar/subway moves. World, water and cloud passes share
that resolved camera. This change does not add another animation loop or modify
the map's canvas gestures. Pointer capture, pinch/wheel zoom, controller look,
overlays, streetcar seats, photo framing and cinematic capture keep their owners.

## Follow behaviour

Car and cyclist Chase use `FollowCameraRig` in `js/camera-rig.js`. Its
`CAMERA_TUNING` groups reference response times separately from Toronto subject
dimensions and framing. The horizontal pivot predicts with measured root velocity
and corrects at τ=.09 s; the height channel follows at τ=.18 s. Heading blends body
and forward travel direction, takes the short arc and is limited to 2.4 rad/s.
Manual orbit offsets affect framing immediately. Recentering waits .9 s after look
input, ramps over .5 s, and only runs above 1.5 m/s actual horizontal travel.

Cycling starts with a 4 m boom, 1.5 m pivot and 65° vertical lens, gaining 5° from
4–12 m/s. The car's pivot uses the sedan roof profile plus .3 m and its boom scales
from its modeled 4.5 m length. Ground views keep a level horizon; optional slip roll
and flight-only pigeon effects are omitted. Person, helicopter, Action and POV
retain their existing framing, with the shared pitch convention translated at the
legacy/POV boundary.

`?cameraRig=legacy` selects the prior Chase implementation for comparison.
`__CITY_APP.cameraSystem.setFollowRigEnabled(false/true)` changes it in a live
debug session. `?cameraMetrics=1` records bounded camera and collision-query CPU
samples; `cameraSystem.metrics({reset:true})` returns p95/p99 and clears the next
measurement window. Timing instrumentation is absent by default.

## Collision and lifecycle

`CameraCollision` queries the controller's existing 48 m/8 m static spatial hash,
including `WorldCollision.swap` proxy replacements. It sweeps an enclosing
near-plane sphere against polygon, oriented-box and circular outline prisms.
Concave courtyard voids remain open; bounds only gather candidates. Local terrain
and deck samples use `city-config.js:cameraSurfaceLayersAt`, preserving each
vertical layer and rendered flyover slab depth rather than lifting the camera onto
an overhead bridge. No scene-wide triangle raycast is added.

The internal reach contracts at τ=.06 s and opens at τ=.60 s. The displayed eye
is capped by the verified reach immediately. Recovery begins from the reach that
was actually displayed, including when a collider appears for one frame. A slim
rider whose pivot is too close to a facade for the near-plane sphere uses a bounded
local clear-eye search. Existing proxies remain resident when render detail changes.
If no local eye and no previous eye can be verified, the frame keeps the last
rendered image while movement continues, until clearance becomes available.

Teleport/mode reset releases pointers, clears follow history, seeds the destination
without old velocity and invalidates the existing cloud temporal history. Shared
ride/photo camera snapshots include the new channels and retain passenger ownership.

## Optional CN Tower Two-Shot

The camera menu separately offers **CN Tower Two-Shot**. Its ten-second smoothstep
dolly supports the cyclist or car and follows the actor–landmark axis. The aim mixes normalized directions from
the eye: 58% actor and 42% tower; it does not average world positions. The landmark
aim is 45% of modeled height, capped at 110 m above its ground.

The nominal reference lens is 25°. Toronto's full-sized actor and 553 m tower
require a wider fitted lens at some locations. Both complete silhouettes are fit
using the actual viewport aspect, with subject-size limits and a 95° ceiling.
Four deterministic side/distance alternatives are validated at start, midpoint and
end before any cut. Local sphere clearance is checked each frame; subject/tower LOS
is checked initially and periodically using bounded local spatial queries. LOS ends
at the near landmark envelope so the tower cannot reject its own interior aim point.
Missing, distant, obstructed or unframeable views return to Chase before display.
The fallback selection is reflected in the camera menu. Geometry/proxies for this
city are resident; culling changes visibility rather than asynchronously loading a
new camera tile. No fake preload or rebase system is introduced.
Subject bounds rotate with the body heading, and the sedan uses a larger distance
scale so a broadside car can fit the portrait frame.

Leaving the shot keeps the displayed eye, aim and lens on the first interactive
frame, then reanchors the follow rig from that pose. The separate optional reveal
variant is not implemented.

## Verification

`node --test tests/camera-rig.test.cjs tests/cameras.test.cjs` covers matched
30/60/120 Hz turns/recentering, yaw wrap and rate limit, immediate look, stopped
behaviour, facade approach/refinement/recovery, stacked bridge slabs, courtyard
voids, pivot overlap, teleport history, state restoration, wide/portrait two-shot
validation and obstructed-shot rejection. Controls/ride/loader/cache integration
checks also pass. GPU evidence is recorded below after the Mini runs complete.

Reproduce functional shots through `gpu2` using
`tools/shots/camera-rig-functional.json`, first at high/1600×900, then
low/412×915 with `CAPTURE_MOBILE=1`. `tools/shots/camera-rig-ab.json` runs an ABBA
comparison in the same loaded dense Toronto scene; enable `?metrics=1&cameraMetrics=1`.
Each arm preserves raw frame samples, camera/query p95/p99 and collision replacement
counts. These are camera CPU measurements and functional render evidence. A
contended Mini run cannot establish an idle GPU/frame budget or real phone behaviour.

After `node tools/build-site.mjs`,
`GPU2_LOCK_WAIT=600 gpu2 camera-review -- node tools/check-camera-rig.mjs` runs
the desktop, portrait, bridge and A/B scenarios under one lock. `CAMERA_RUNS=portrait,ab`
selects a subset. Functional film stepping yields a fresh browser animation frame
between renders, avoiding same-frame renderer caches in a batch of film steps.

### Mini results, 10 November 2026

Desktop high (1600×900) and emulated phone low (412×915) completed all six
functional shots. Both validated the full tower and rider at 0.033, 5 and 10 s,
and retained the displayed eye/lens on return to Chase. The selected clear HTO
path is near x=−800, z=650; the first four attempted locations were rejected for
framing or real proxy obstructions. The final lens widens from approximately
92.13° to 93.97° to accommodate Toronto's complete tower silhouette. The nominal
25° lens is inappropriate for this particular full-tower, near-actor composition.
Images and validation JSON: `$GPU2_REVIEW_DIR/slop-toronto-camera-final/`,
`camera-high-*` and `camera-portrait-*` (served build `291b44b7a839`).

The dense-scene stationary-subject ABBA run used build `f38dc33476ec`, identical
camera source hashes in all four arms, two seconds warmup and eight seconds per
window. Composition changes with the rig, so scene render work is not held constant.
Chromium 156.0.8078.4, Apple M4 Mini; classification
**background-processes-unqualified**. It is not an idle GPU budget result.

| Arm | Camera samples | Camera CPU p95 / p99 | Query CPU p95 / p99 | Frame p95 | Frames >20 ms |
|---|---:|---:|---:|---:|---:|
| New A1 | 480 | .4 / .5 ms | .4 / .5 ms | 16.8 ms | 0 |
| Legacy B1 | 481 | .1 / .1 ms | 0 / 0 ms | 16.8 ms | 0 |
| Legacy B2 | 480 | 0 / .1 ms | 0 / 0 ms | 16.8 ms | 0 |
| New A2 | 480 | .4 / .4 ms | .4 / .4 ms | 16.7 ms | 0 |

Zero-valued CPU samples are below the browser timer's resolution. Raw camera/query
timestamps and frame samples remain in `camera-ab-{new-A1,legacy-B1,legacy-B2,new-A2}.json`.
Proxy replacement counts stayed at 2 and Director validation counts at 0 throughout
these windows. No frame spike or refinement event occurred, so these runs cannot
quantify their correlation or the cost of a tile/detail commit. The final source
receipt (`camera-ab-ab-source-receipt.metrics.json`) records host observations,
served hashes and measurement classification. A later below-grade proxy-base fix
matches movement's existing default `minY=0` contract and has its own regression test.

The actual Gardiner underpass and forced upward-boom checks also passed on the
Mini (build `cbc3c6ecaf9d`). The rendered slab spans y=10.75–12.03 m at the test
point. Under upward orbit/2.4× zoom, the resolved eye was y=9.933 m with a .601 m
near-plane sphere, preserving clearance below the soffit. Records/images:
`camera-bridge-gardiner-{underpass,ceiling-clearance}.*` in the same review folder.
The coarse-to-refined proxy test uses the production controller spatial hash and
`WorldCollision.swap`; there is no missing-collider interval before the replacement.
