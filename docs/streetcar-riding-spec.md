# Boarding and riding streetcars

Specification only · 2026-10-26 · First transit-riding milestone

The player walks up to a TTC streetcar stop, boards a stopped streetcar, watches Toronto pass from a passenger
seat, requests a stop, and gets off onto a safe sidewalk or platform. The streetcar keeps using the city's existing
tracks, routes, signals and traffic. The first release should make that complete journey reliable before adding
walking inside the vehicle or passenger crowds. Subway riding follows in [the subway specification](subway-riding-spec.md).

## Existing foundation and candidate work

Assessment baseline: local `main` with the upstream integration `b71d97d`.

The current application already has most of the expensive surface-transit foundation:

| Existing code | Available behavior | Change needed |
| --- | --- | --- |
| `js/streetcars.js` | Five articulated Flexity modules, rails/wire, TTC patterns, stops, braking/dwell, traffic/signal interaction, live-feed matching | Explicit boarding/door state, stop identity, a persistent occupied car, and safe alighting anchors |
| `js/transit.js`, `js/toronto-transit.js` | Pattern signs, stop coordinates/names, hourly service | Keep stable stop IDs through generation and attach each boarding location to a direction/pattern |
| `js/controllers.js`, `js/cameras.js` | Walk/cycle/car/flight, collision-aware placement, POV/chase/orbit | Passenger attachment, movement suspension and complete restoration on exit |
| `js/main.js`, input/UI/audio modules | Mode switching, saved player state, map/search, touch/gamepad, transit sounds | Central ride state and input routing; passenger HUD and interior sound mix |

An unmerged local branch, `feat/streetcar-ride` at `167edca`, contains a substantial candidate implementation
based on `4443c1c`. Its new `js/streetcar-ride.js` supplies boarding, a front-module seat, a simple interior, camera
override, a ride panel, stop requests and a featured 504 ride. Associated changes protect occupied cars from some
retirement/live-feed operations. This specification does **not** merge that branch or certify it as ready.
Review and adapt it after the upstream integration rather than rebuilding those pieces blindly.

The candidate needs particular attention: its boarding zone permits interaction on both sides of a car; its exit
search falls back to an unchecked point beside the rails; controller suspension alone does not remove the player
from all traffic/pedestrian calculations; and a route fragment's end is not necessarily a passenger terminal.
Its shot lists are useful fixtures, but do not establish that these edge cases work.

## The first complete experience

1. In walking or cycling mode, approach a validated streetcar stop. Show the route, direction/destination and
   a quiet waiting hint. Do not promise an arrival countdown without a trustworthy estimate.
2. Once the car has stopped at that stop and its passenger doors are open, show **Board the 504 …**. Activate
   with `E`, a large touch button, or a gamepad action. Choose the nearest valid door on the boarding side.
3. Use a short fade to a fixed passenger seat behind the cab, with a useful forward and side view. Keep mouse,
   touch and gamepad look controls. Offer POV and exterior chase views using the existing camera control.
4. Display route, destination, next stop and **Request stop**. Requesting while moving changes the label to
   **Stop requested**; it never teleports the rider off a moving car. Requesting again is idempotent.
5. At the next eligible stop, offer **Get off at [stop]** and hold the doors long enough to act. The player can
   stay aboard; a stop request does not force an exit. A confirmed exit restores their previous walk/cycle mode
   at a validated landing anchor, facing along the sidewalk.
6. At the final supported passenger stop, announce the end of the ride and offer exit. Prevent the occupied car
   from disappearing while this is unresolved. For a truncated route, end at the last validated stop before the
   fragment boundary rather than inside a tunnel or at an arbitrary clipped endpoint.

Include **Ride the 504 along King** in Sights as a discoverable shortcut. It should start a validated scheduled
ride near a real stop, identify the route/destination, and use the same boarding logic. If no suitable car is
available, create one through the fleet's normal spawn API after checking spacing; do not delete nearby live cars
to manufacture a clear path. Route availability comes from the bundled timetable, not a hardcoded assumption
that a particular 504 branch remains unchanged forever.

Cycling mode may be suspended and restored without rendering a bicycle inside the first interior. This is an
explicit game convenience, not a representation of TTC bicycle rules. Driving and flying modes do not offer
boarding prompts. Paid fares, driving the streetcar, free movement between modules, passenger AI and animated
boarding crowds are later work.

## State and ownership

Use one small ride coordinator that can later host subway passengers. Keep streetcar-specific selection, stop
placement and rendering in a streetcar adapter. Proposed interfaces below are design contracts, not implemented APIs.

| State | Entry/exit rule |
| --- | --- |
| `free` | Normal controller ownership; compute at most one valid nearby boarding candidate |
| `boarding` | Atomically revalidate car, stop, door and landing; acquire an occupied-car lease; clear held input |
| `riding` | Vehicle owns passenger transform; player locomotion/collision participation is disabled |
| `exitRequested` | Latch request against the next eligible stop; allow cancelling through an explicit HUD action |
| `alighting` | Revalidate landing and door state; transfer ownership only after placement succeeds |
| `free` after exit | Restore mesh, camera, input, mode and audio; release lease exactly once |

Store the occupied vehicle's stable ID, route/pattern and stop ID, seat/module transform, prior mode/camera,
pending request and last safe exit. A ride is separate from `activeMode`; do not create a second controllable car
or treat the passenger as a pedestrian on the road. Repeated action presses and failed boarding attempts must
leave state consistent. `dispose`/cancel paths must be idempotent.

The streetcar adapter should expose candidate lookup, boarding validation, vehicle retention/release, passenger
pose, stop/door status, next-stop information and a safe exit result. An unsuccessful exit result must carry a
reason rather than returning an unchecked coordinate. The coordinator owns input/HUD/camera restoration.

Update order must be explicit: collect actions, advance vehicle simulation, derive the rider from the current
module pose, then update the passenger camera and listener. The current loop updates cameras before streetcars;
inserting a ride attachment after that point would produce a one-frame lag. Separate vehicle simulation from
render preparation if needed; do not advance the fleet twice.

## Stop geometry, doors and exits

Current `track.stops` are distances along a resampled route, with a parallel `stopNames` array. The generator
and runtime must retain a stable source stop ID and attach a boarding record: route direction, stop distance,
door side, door position, surface elevation, landing polygon/anchor, and whether it is a supported passenger stop.
Check the local track orientation rather than assuming a world-axis offset. Keep names and distances together
as records so filtering/sorting cannot detach them.

Proposed starting tolerances, to tune in captures: speed below 0.1 m/s, nose within 1 m of the stop target,
player within 4 m of a boarding anchor, and matching walking surface within 0.6 m. Stops with a curb lane between
sidewalk and door need a deliberately authored interaction zone and a fade across that gap. The player must not
board through a building, fence, opposite carriageway, bridge deck, or the vehicle's closed left side.

Door state must mean `closed`, `opening`, `open`, or `closing`, attached to an actual serviced stop. A red-light
pause or queue is not a boarding opportunity. Board/alight only during the open state and hold departure until
the transfer completes. Use a minimum usable open window of 8 seconds for nearby players, while preserving
longer existing scheduled dwell; do not globally shorten the current timetable's dwell to that minimum.

At exit, validate the player's footprint against static colliders, the correct walking elevation and nearby
moving traffic, cyclists and streetcars. Prefer a platform/sidewalk anchor on the door side. If temporarily blocked,
keep the rider aboard and the doors open briefly, then offer the next stop; never eject into a traffic lane.
Exclude unsupported underground loops from ordinary boarding until an actual platform/landing is built.

## Fleet, rendering and application integration

- An occupied vehicle must keep a stable identity and fresh module poses regardless of culling, quality thinning,
  time-preset changes, feed loss, route changes, or disappearance from a live update. Retirement must defer while
  occupied. A disconnected live vehicle finishes its safe local trip as simulated service.
- Live corrections may ease speed within normal acceleration/braking limits. They must never jump an occupied
  car's distance, skip its requested stop, hurry door dwell, or swap it onto another route. Keep collision avoidance,
  traffic signals and following distance authoritative. Do not change all unoccupied service to achieve this.
- Explicitly remove the suspended player from traffic contacts, pedestrian avoidance/knockdowns, highway/rail
  collision checks and the host streetcar's `blockedAhead`/`pushPlayer` logic. Otherwise the rider can obstruct
  their own car or be struck at their old sidewalk position after the upstream collision changes.
- Build one detailed occupied interior, following all five modules' transforms. Exterior paint currently represents
  opaque glass; suppress or replace the occupied car's conflicting surfaces so the view is clear. Restore them on
  exit. Keep windows, roof, gangways and seat geometry from clipping in tight bends, grades and either camera mode.
- Keep chase cameras clear of overhead wire and nearby walls. Restore near plane, camera selection and orbit
  state on exit/cancel. Offer reduced motion with a stable seat and optional fade; a short fade does not require
  head bob or a forced camera pan.
- Keep existing traction sounds; add a quieter interior mix, door chime and short stop text/optional announcement.
  Avoid doubling the host car's audio. Respect mute, visibility suspension and quality voice limits. Use original
  synthesized/recorded-with-permission sounds rather than assuming TTC recordings are reusable.
- Resolve `E` contextually: helicopter ascent keeps its existing binding. Touch interaction needs a separate button
  from the look/drive zones, a minimum 44 CSS px target and proper focus/ARIA labels. Add a gamepad interaction
  callback after checking existing bindings; `Y` already cycles cameras. Do not fire on held buttons after focus,
  map, mode or pad changes.
- Search teleport, Sights selection, reset, mode changes and page teardown all cancel the ride through one cleanup
  path before taking their own action. Ordinary persistence saves the last safe ground state; reloading must not
  strand the player at a vanished vehicle's seat coordinates. Restoring an in-progress service is a later feature.

## Delivery sequence and effort

Engineering estimates for one contributor familiar with this code, excluding any production deployment:

| Step | Deliverable | Estimate |
| --- | --- | --- |
| 1 | Audit/rebase the candidate; route/stop IDs and supported stops; coordinator/lease | 1–2 days |
| 2 | Board, seat/cameras, request/alight, safe landing and complete cancellation | 2–3 days |
| 3 | Interior/doors/audio/HUD, touch/gamepad, featured 504 route | 1–2 days |
| 4 | Lifecycle regressions and desktop/phone visual checks | 1–2 days |

Total: roughly **5–9 engineering days** for a reliable first release. A short prototype may be faster because
the branch exists; its current completeness and asset quality are not verified enough to promise a one-night build.
The overnight deliverable requested here is this specification. No riding code is included with it.

## Acceptance gates

Automate state/lease transitions and real integration boundaries: board only at an open serviced stop, moving
action latches once, safe exit rejects collisions/wrong deck, feed changes never retire/teleport an occupied car,
and every cancellation restores control with no held input or duplicate mesh. Include the new upstream traffic
and pedestrian systems in passenger-exclusion regression checks.

On the Mac mini GPU runner, record a complete 504 trip across at least three stops, a bend, a traffic signal and
night lighting, using both cameras. Repeat key boarding/exiting flows on a phone viewport and the low quality tier.
Verify route direction/name, window visibility, module articulation, camera continuity, stop request text, a blocked
exit, live-to-timetable fallback, time changes, mode/teleport cancellation, reload and gamepad disconnect.

Measure before/after on the same idle machine and scene. Provisional budgets: at most 1 ms additional median
CPU frame time for one rider, no sustained frame-rate regression over 5%, one resident detailed interior, and no
growing resources after 20 board/exit cycles. Contended GPU captures are visual evidence only. Ship only once
the full journey and cleanup work; boarding alone is not completion.
