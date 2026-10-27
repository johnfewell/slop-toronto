# Boarding subways and riding between stations

Design specification · 2026-10-26 · Follows [streetcar riding](streetcar-riding-spec.md)

A playable two-station slice is implemented. See [controls, implementation and remaining limits](subway-riding.md).
The assessment and estimates below describe the original design baseline. Measured underground elevations,
faithful T1/station art, streamed interiors and performance/resource budgets remain future work; the current slice
does not claim every acceptance gate in this fuller specification.

Build a complete **Castle Frank ↔ Broadview** passenger journey first: enter a station from the street, choose a
direction, wait on a platform, board, ride through tunnel and across the Don Valley on the existing viaduct, arrive
at the other station, get off and return to the street. Support both directions. This proves real travel between
stations with recognizable scenery before expanding to the rest of the in-bounds subway network.

This is a larger feature than attaching a camera to the trains already visible in the city. This document records
the broader design; the implementation notes identify what the first playable slice provides.

## What the repository actually provides

Assessment baseline: local `main` with the upstream integration `b71d97d`.

| Component | Current state | Requirement for passenger service |
| --- | --- | --- |
| `js/subway.js` | Viaduct/open cuts/portals, visible trains, parked yard trains and street entrance scenery | Keep scenery, introduce persistent trains and actual station calls |
| Train motion | Separate visible spans, extended 260 m into their portals; analytic time/headway motion at 16 m/s | Continuous station-to-station tracks with acceleration, braking, stopping and door state |
| Train records | Reused rendering records per visible span; only exposed visible trains appear in the audio list | Stable train/service IDs independent of visibility, audio and rendering slots |
| Entrances | Stair-pit visual treatment and pylons; no usable underground station or platform | Enter/exit interaction and a bounded, walkable station space |
| `js/toronto-subway.js` | OSM-derived track polylines, layers, station names/locations and street entrance locations | Explicit station/line/platform IDs, connected track topology, rail elevation and platform/door anchors |
| `js/transit.js` and generated transit data | Subway service headways by hour | Ordered station calls and run/dwell times: `tools/build-transit.mjs` currently omits subway shapes/stops from its output |
| Surface live data | `worker/live.js` decodes BusTime vehicle positions; surface vehicles consume it | Separate assessment of subway feeds; this path is not an existing subway simulation |
| Controllers/cameras/audio | Street movement, vehicle cameras and exterior transit sound | Platform grounding, passenger attachment and station/interior acoustics |

`subway.placeTrain()` is a screenshot fixture that adjusts a shared time offset; it is not a train-spawning or
boarding API. Do not build gameplay around its held scene or around `subway.cars`, which is the transient list
used for sound. The decorative trains currently disappear into portals rather than complete an underground trip.

The train geometry is currently a six-car Toronto Rocket-style model even on Line 2. TTC's published fleet plan
identifies T1 trains with Line 2. Use a simplified T1 family for this route, or explicitly label a temporary visual
approximation during development; the existing exterior is not evidence that a suitable interior exists.
([TTC fleet asset plan](https://www.toronto.ca/legdocs/mmis/2025/ttc/bgrd/backgroundfile-254421.pdf))

## First playable scope

The two stations are a useful first pair because their connection crosses already modeled scenery. TTC describes
both as stations with eastbound/westbound side platforms and three levels. This supports the platform layout
choice, but does not supply measured geometry or tunnel depth.
([Castle Frank station](https://www.ttc.ca/subway-stations/castle-frank-station),
[Broadview station](https://www.ttc.ca/subway-stations/broadview-station))

| Included in the first release | Later expansion |
| --- | --- |
| One validated street entrance/exit per station, clearly marked as usable | All entrances and faithfully connected concourses |
| Eastbound and westbound platform spaces at both stations | Walking the full stair/elevator network without a transition |
| Visible train arrival, braking, door opening/closing and departure | Passenger crowds and boarding queues |
| One fixed seated passenger position, free look, next-station HUD | Walking through cars and changing seats |
| Continuous ride through tunnels and the viaduct, both directions | More Line 2 stations, then Line 1 and interchanges |
| Alighting onto a platform and exiting onto the correct street | Transfers, journey planning and a network-wide service simulation |
| Bundled deterministic service; offline operation | Optional verified realtime corrections/service disruption overlays |

Use an explicit short transition from the street entrance to the selected platform. Show station and direction
before entry, then fade into the platform's safe arrival zone. An equally clear exit returns to that entrance's
safe street anchor. This avoids excavating every street/building and building all concourses to make the first
ride possible. Keep the station and train in the city's world coordinate frame so the ride across the viaduct
and the eventual return to street exploration are spatially consistent.

Do not depict the direct transition as a fully modeled accessible route or an exact station reconstruction.
Offer the same interaction without requiring stair traversal, with text/focus and reduced-motion support.
Fares, fare gates as barriers, track walking, train driving, emergency evacuation and animated elevators are
outside the first milestone.

## Passenger flow and controls

1. A usable entrance offers **Enter Castle Frank station**; decorative or unsupported entrances do not pretend to
   work. Present **Eastbound to Broadview** and **Westbound …** only when a supported service is available.
   For the two-station slice, Castle Frank eastbound and Broadview westbound are the ride departures; opposite
   platforms may be visible but must explain that onward travel is outside the current area.
2. Arrive behind the platform safety strip, facing readable direction signage. A small panel gives the next
   supported destination and a simulated wait estimate. For discovery, offer **Ride across the Don Valley** in
   Sights with a short, deterministic wait; normal street entry uses the ordinary simulated service.
3. A train arrives and stops with doors aligned to the platform. Show **Board** only beside a valid open door.
   Fade into the seat and attach the camera using the streetcar ride coordinator.
4. Display **Next: Broadview**, direction, and a simple two-station progress indication. Doors remain closed in
   motion. Subway trains serve every supported station, so **Get off at next station** sets intent rather than
   requesting a special stop. Holding the action cannot trigger repeated boarding/exiting.
5. On arrival, announce the station and offer **Get off** while the platform-side doors are open. Place the player
   behind the safety strip at the matching door's landing. The station exit then returns them to its correct street
   entrance; they can also cross through a clearly labeled transition to take the return journey.
6. At the boundary of this supported ride, hold for safe alighting and explain **This ride ends here**. Broadview
   and Castle Frank are not being represented as actual Line 2 termini. Do not silently loop the train back across
   the map or take the passenger into an unbuilt segment. Once unoccupied, recycle service out of view.

Reuse contextual `E`, touch interaction and the gamepad action introduced for streetcars. POV is the default in
tunnels; exterior chase is available on the viaduct, but should be disabled with an explanation or constrained to
valid interior space underground. Never allow orbit to reveal the city from below through missing tunnel geometry.
Mode switches/search/teleports exit through the coordinator's cancellation path and restore a safe street state.

## Data that must be generated or authored

Use stable identities throughout. Do not join stations solely by nearest coordinate or name: interchanges,
parallel platforms and renamed stations make that ambiguous.

| Record | Required fields |
| --- | --- |
| Station | Stable ID, display name, served line IDs, world location, supported entrance IDs, scene asset key |
| Entrance | Source identity, station ID, world interaction/return anchors, supported state, platform connections |
| Platform | Station/line/direction IDs, track side, extent/elevation, walkable polygon, safe arrival/exit zones, door landings |
| Track segment | Stable ID, directed connectivity, cumulative distance, world XYZ profile, tunnel/open/viaduct ranges, speed limits |
| Service pattern | Ordered platform calls, dwell/run times, headways, full destination label and supported-area boundaries |
| Train | Stable service instance ID, pattern, segment/distance, velocity, current/next call, door side/state, occupied lease |

Extend `tools/build-transit.mjs` to retain the needed subway stop sequence and representative timing, plus a service
calendar policy. The current hourly aggregation is useful for ambient density, but insufficient for exact departure
boards or stop-to-stop travel. Preserve source IDs and feed/version metadata rather than relying on generated array
indices across builds. For the first slice, a reviewed authored manifest may bridge these fields while the general
extractor is developed; that manifest must carry provenance and regenerate/validate predictably.

Connect and orient OSM track pieces explicitly, rejecting sidings/yards as passenger routes. Current OSM `layer`
values express ordering, not measured tunnel metres. Author a plausible rail-height profile from station platforms
to the known viaduct deck, then check grade, curvature, clearances and continuity. Do not infer a tunnel's elevation
by multiplying its layer number by a floor height. Validate both directions and the entire six-car consist at each
portal/curve, not just the leading car.

Retain existing OSM attribution/ODbL handling and Toronto open-data attribution. New measured/reference imagery,
textures, sounds and models need recorded provenance and suitable reuse terms. These requirements concern the
assets chosen during implementation; no new licensed asset is required to approve this spec.

## Simulation and shared architecture

Build a persistent subway service simulation separate from the existing instance renderer. Each occupied train
must continue to exist when underground, behind the camera, offscreen, or omitted from a low-quality exterior
draw. A train's visible span is a rendering choice, never its lifetime.

Use the streetcar coordinator for input ownership, seat/camera attachment, occupied-vehicle leases, HUD,
safe cancellation and restoration. A subway adapter supplies platform candidates, current train pose, door status,
station calls and alighting anchors. Share these contracts, not the streetcars' road signals, curb geometry or
Flexity articulation. Avoid a general transit engine rewrite just to support two adapters.

The train's service state should progress through approaching, braking, stopped/doors opening, doors open,
doors closing, departure and running. Dwell begins only after a complete stop. Departure requires closed doors
and no transfer in progress. Apply a bounded acceleration/braking curve and calculate approach braking distance
from current speed. Proposed initial comfortable values are 0.8–1.0 m/s² acceleration and 0.8–1.1 m/s² service
braking; these are tunable game settings, not claims about actual TTC control systems.

Respect platform-length and vehicle-clearance constraints. A following service cannot enter an occupied platform
or overlap another train on the same directed track; the first slice can use a simple block reservation. It does
not require a faithful ATC implementation. Door-side selection follows platform geometry, including reversed
direction. Timetable/time-preset changes may affect future spawns but cannot jump or retire an occupied train.

Advance the train, derive all car transforms, attach the rider, then update camera/listener. Derive trailing cars
from distance along the same track, including grade and curves. Gate the streetcar/road/highway/rail pedestrian
collision systems using explicit passenger/interior state. Platform grounding must use its walkable floor and
walls rather than the outdoor sidewalk lookup. Track access is blocked in the MVP.

Keep a last safe street anchor throughout. Reload restores there; it must not save a negative-Y seat as an ordinary
walking location. Unexpected train/asset failure returns to the last valid platform or entrance with a brief
explanation. Treat boarding/alighting and cell loading as transactions: input ownership changes only after the
target location and assets are ready. A cancelled transition must leave either the old or new valid state.

## Geometry, lighting, sound and loading

New content required: four platform spaces (two directions at two stations), train interior/working doors, track
beds, tunnel shells/portals joined to existing scenery, station signage, walls/ceilings/lighting, and entrance/exit
interaction zones. Procedural station templates with station-specific tile colours/signs are sufficient for the
first release. Exact full-building station replicas need a separate art scope.

Generate tunnels along the continuous XYZ track with consistent normals, no light leaks, and clearance for the
whole consist. Transition naturally from tunnel darkness to viaduct daylight. An occupied car needs actual views
through its windows; its current opaque exterior material cannot simply surround the passenger camera. Door
meshes, masks, platform position and boardable areas must agree.

Load the two station cells and connecting tunnel when the player approaches or selects the featured ride. Keep
the occupied interior and destination station resident until arrival; unload other interiors after exit using shared
geometry/material caches. If loading fails, keep the player at a usable entrance/platform with retry and return
options. Avoid adding the whole network to initial page startup.

Use bounded local station lights and baked/emissive detail with quality-scaled shadows. Isolate underground
lighting/fog/exposure/audio zones from outdoor daylight and lake ambience; entering a station should not globally
change how another exterior camera is rendered. Keep exterior city rendering available when it is visible from
the train over the viaduct.

Add rail rumble, restrained tunnel reverberation, door chime and station arrival text/optional original synthesized
announcements. Avoid playing both the exterior train voice at the listener and a full-volume interior duplicate.
Preload short sounds and respect existing mute/worker/voice budgets. Announcements must also be readable text;
direction and station names cannot depend on colour or sound alone.

## Realtime data is an optional follow-up

The existing BusTime vehicle-position decoder is not sufficient evidence of subway position coverage. TTC announced
GTFS improvements in June 2026, so assuming that subway realtime data does not exist would also be premature.
([TTC's announcement](https://www.ttc.ca/news/2026/June/TTC-and-Transit-app-partner-to-enhance-trip-planning))

Before enabling any live subway mode, inspect the City's current
[GTFS realtime resources](https://open.toronto.ca/dataset/ttc-gtfs-realtime-gtfs-rt/) against its
[merged schedule dataset](https://open.toronto.ca/dataset/merged-gtfs-ttc-routes-and-schedules/).
Confirm feed URLs, subway trip/stop-ID matching, timestamps, direction, prediction semantics, licensing, freshness
and coverage. The catalog API timed out during this assessment; exact subway resource contents remain unverified.
Trip predictions may inform station arrivals without providing continuous measured train locations.

If a feed gives trip updates rather than positions, interpolated motion must be identified as simulated. Cache and
decode server-side within the existing Worker pattern, with rate limits and a bundled schedule fallback. Never
allow a late update to jump the occupied train, reverse its route, close doors on a transfer or skip the player's
arrival. The first playable route must ship and work offline without this integration.

## Implementation plan and estimates

Estimates assume the streetcar coordinator and its cleanup tests have landed. They cover one contributor familiar
with the application and procedural MVP assets, not photorealistic station reconstruction.

| Phase | Reviewable result | Estimate |
| --- | --- | --- |
| 1: prove the route | Station/track manifest, timing extraction, XYZ continuity and full-consist clearance checks | 2–3 days |
| 2: persistent service | Stable trains, stops/doors, block spacing, occupied leases, integration with existing visible trains | 2–4 days |
| 3: make stations usable | Four platform cells, entrance/direction/exit flow, platform walking and signage | 3–5 days |
| 4: make the ride complete | T1-style interior/exterior adaptation, passenger adapter, tunnel/viaduct transition, HUD/audio | 3–5 days |
| 5: harden and measure | Mobile/keyboard/gamepad flows, cleanup/loading failures, regression captures and performance | 2–3 days |

Total: approximately **12–20 engineering days after streetcar riding**. The first route/asset spike may change
that estimate, especially if source track connectivity or station geometry needs manual repair. Detailed concourses,
seamless street-to-platform walking and faithful station art would add further work. More stations are data plus
assets and validation, not a configuration-only toggle. Expand along Line 2 after the two-station journey is solid;
scope Line 1/interchanges separately.

## Acceptance gates

- A player can enter at Castle Frank, board eastbound, traverse the real viaduct scenery, alight at Broadview,
  exit at its mapped street entrance, and make the return journey. Stations, direction and next-stop labels agree.
- The same stable train exists from departure to arrival. No portal disappearance, quality change, time change,
  tab suspension or optional feed update teleports or retires an occupied train. Resume uses a clamped/safe step.
- Moving trains/closed doors/opposite-side doors cannot be boarded or exited. Door landings align and the entire
  consist fits at both platforms. Repeated inputs, a blocked landing and departure during transfer are handled.
- Station walking stays on the platform and respects walls/track boundaries at negative world elevation. Exiting
  and every mode/search/reset cancellation restore valid surface control and the correct camera/input/audio state.
- Failed asset loads, offline startup, reload while aboard and a missing optional feed remain recoverable.
  No hidden dependency on the live Worker is allowed for the core journey.
- Record both complete journeys, door arrivals/departures, tunnel/viaduct transitions, day/night and phone quality
  using the Mac mini GPU runner. Verify windows, camera clipping, platform text, reduced motion, touch and gamepad.
  Automated tests should exercise service/door invariants and coordinator integration rather than only matching
  source text or screenshots.
- Establish an idle same-machine baseline before implementation. Provisional budgets: no more than 2 ms median
  additional CPU time during riding, no sustained frame-rate regression over 10% against the same visible outdoor
  scene, and at most 25 MB compressed additional MVP assets loaded on demand. Check retained resources across
  20 return trips and unload cycles; adjust budgets only from recorded measurements. Contended captures cannot
  validate timing targets.

The implementation is complete only when the player returns to ordinary Toronto exploration at the destination.
A camera following an ambient train across the bridge is a useful prototype, but does not meet these gates.
