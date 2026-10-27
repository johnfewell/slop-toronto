# Ride between Castle Frank and Broadview

Choose **Sights → Ride the subway across the Don Valley**, or open `explore.html#ride=subway`, to start in an eastbound
train at Castle Frank. The train departs, passes through a tunnel, crosses the existing Bloor Viaduct scenery and
stops at Broadview. Both directions are playable.

During ordinary exploration, approach the marked entrance at Castle Frank or Broadview on foot or by bicycle.
Press **E**, tap the entrance prompt, or press the gamepad's **A / bottom face button** to enter the platform.
Bicycles remain outside as a game convenience and are restored on street exit.

- Walk along the bounded platform with the ordinary walking controls. The boarding prompt appears beside the
  front car's open doors. **E**, **Board the train**, or gamepad **A** boards; a moving train or closed doors cannot.
- Drag or use the right stick to look from the seat. **V**, the camera arrows or gamepad **Y** selects the exterior
  view while the full train is on the viaduct. The camera returns to the seat before entering a tunnel.
- At arrival, **E** or **Get off** places you on the destination platform. The train holds its doors while occupied
  at the end of this supported ride. Castle Frank and Broadview are boundaries of this feature, not Line 2 termini.
- **Change to the other platform** lets you wait for the return train. **Exit to [station]** returns to that station's
  mapped street entrance. While aboard, **Return to departure station** cancels safely.
- Changing mode, searching/teleporting or resetting ends the station visit and restores surface controls. Reloading
  restores the last safe station entrance, including when saved from a seat or platform.

## Implementation

`js/subway-service.js` owns two persistent six-car trains, one per directed track. Acceleration, approach braking,
stops and opening/dwell/closing doors run independently of render visibility and quality. The final occupied stop
holds for alighting. An unoccupied train recycles into the incoming tunnel only when its departure from the previous
destination is out of the current station view. Selecting a featured ride cannot reset an occupied train.

`js/subway-ride.js` supplies platform bounds, entrance anchors, procedural station/tunnel/interior geometry, train
doors, contextual interaction and the HUD. It shares input suspension, occupied leases, camera restoration and
cleanup with streetcars through `js/transit-riding.js`. Platform walking uses an explicit interior floor and bounds;
outdoor building colliders and street grounding cannot push the player off the platform. Road traffic does not
treat the passenger/platform player as a road obstacle.

The two passenger trains replace the old analytic trains on this viaduct only. West-end open-cut and yard scenery
remain ambient. Geometry, sign materials and the passenger interior are allocated once and reused between rides.
The destination room becomes visible on approach; cancellation keeps the departure entrance as its safe anchor
until the player actually alights.

Source station and entrance positions come from the bundled OSM-derived `js/toronto-subway.js`; the path joins
those positions to the existing viaduct polyline. Castle Frank uses its existing entrance marker. Broadview gets a
marker near its source entrance on a validated sidewalk because its entrance was omitted by the scenery builder.
The small supported route manifest uses stable station/direction IDs. It is not a general network topology extractor.

`tools/build-transit.mjs` now retains subway calls and representative departure times alongside hourly service counts.
The runtime preserves GTFS stop IDs and uses the bundled Line 2 patterns for approximate headways and journey speed.
This is simulated service, not live train locations, an exact departure board or a date-aware TTC timetable.
Regeneration used the existing cached City of Toronto feed dated 2026-09-30; no new external assets or dependencies
were added. Existing OSM and Toronto open-data attribution applies.

## Current limits and remaining specification work

The station rooms and tunnels are representative procedural cells isolated on a camera layer. Their X/Z positions
connect to the mapped stations and viaduct, but their rail height stays at the existing viaduct elevation. They do
not model measured station depths, underground grades, concourses, stairs or seamless street-to-platform walking.
The six-car exterior reuses the existing stylized Rocket-like model; a faithful Line 2 T1 model remains future work.

There is one seated passenger interior, boarding at the leading car, no walking through the train, fare system,
crowds, announcements or new recorded sounds. Existing synthesized train audio is reused. The two station cells
are built and precompiled at startup rather than streamed on demand. Broader network routing, measured clearance
and grades, on-demand loading, detailed art/audio and idle-machine performance/resource budgets remain in the
[full design specification](subway-riding-spec.md). This playable slice does not claim all of those acceptance gates.

## Verification

Service tests exercise real path sampling, both directions, platform/consist fit, door and speed invariants,
occupied identity/holding, deferred recycling and retained GTFS call identities/times. Controller coverage checks
interior grounding, bounds and jump prevention independently of outdoor geometry. Shared streetcar session and
gamepad tests still apply.

Mac mini Metal WebGPU captures cover a complete Castle Frank → Broadview → Castle Frank round trip, changing
platforms, both arrivals, night lighting, viaduct seat/exterior views and mode cleanup. Phone captures use actual
touch taps for entrance/boarding/alighting, then reload the page and assert an ordinary Broadview street position.
The fixtures also assert that the destination platform is revealed before alighting. No WebGPU validation or page
errors were reported. Runs alongside production transcription are contended, so they establish functional/visual
correctness rather than performance budgets.

The existing streetcar three-stop journey was repeated after integration, including safe alighting, persistence,
night lighting, mode changes and teleport cleanup. Its touch cancel/reboard fixture checks the shared HUD layout.
Persistence captures intentionally omit `?film`, since that capture-only option disables saving and restoration.

```sh
node --test tests/subway-service.test.mjs tests/transit-riding.test.mjs tests/transit-gamepad.test.cjs tests/controllers.test.cjs tests/shader-precompile.test.cjs
GPU2_LOCK_WAIT=60 gpu2 slop-toronto-subway -- env CAPTURE_QUERY='?quality=high&autoscale=0&transit=timetable&film#ride=subway' CAPTURE_PROGRESS=1 node tools/capture.mjs tools/shots/subway-riding-journey.json
GPU2_LOCK_WAIT=60 gpu2 slop-toronto-subway -- env CAPTURE_QUERY='?quality=low&autoscale=0&transit=timetable#ride=subway' CAPTURE_VIEWPORT=412x915 CAPTURE_MOBILE=1 CAPTURE_TAG=phone CAPTURE_PROGRESS=1 node tools/capture.mjs tools/shots/subway-riding-phone.json
```

The full suite has 178 tests: 165 pass, with the same 13 pre-existing fixture/raw-geodata failures recorded before
passenger work. The static-site build also passes. These results do not mean the full suite is green.
