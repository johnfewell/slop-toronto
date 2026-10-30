# Ride Toronto's streetcars

Choose **Sights → Ride the 504 along King** for a passenger seat on a King streetcar. A direct link is
`explore.html#ride=504`. The car follows its normal tracks, traffic signals and stopping pattern.

To board during ordinary exploration, walk or cycle to any of the four open passenger doors at a stop, on the
door-side sidewalk or a clear road-level boarding area beside the door.
Press **E**, tap **Board**, or press the gamepad's **A / bottom face button**. The prompt appears only for a stopped
car serving that stop, with a clear transfer corridor and a supported stop still ahead. A red-light pause is not
boarding service. Bicycles are suspended during the ride and restored on exit as a game convenience.

While aboard:

- Drag or use the right stick to look around. **V**, the camera arrows or gamepad **Y** switch between the seat and
  exterior chase view. The HUD shows route, destination and current/next stop.
- **E**, the action button or gamepad **A** requests the next stop while moving. A second press cancels the request.
  The rider remains aboard until they choose **Get off** with the doors open.
- Exiting searches the correct sidewalk, checking height, buildings, the transfer corridor and nearby vehicles and
  people. If blocked, the rider stays aboard and may retry or continue to the next stop.
- **Return to where I boarded** ends a ride at its original safe boarding location. Changing mode, resetting or
  teleporting also releases the passenger state cleanly. Reloading restores a ground position rather than a seat
  on a vanished car.

The first implementation uses one reusable five-module interior, explicit door opening/dwell/closing, stable car
IDs, an occupied-car lease and a shared passenger session in `js/transit-riding.js`. The occupied vehicle is exempt
from live-feed jumps/retirement and offscreen pose skipping. Traffic, highway, streetcar and railway collision checks
receive no road player while they are aboard. The camera and listener follow the current simulated pose.

Stop records retain generated GTFS stop IDs and names with their distance along the route. Regenerating the bundled
transit data from the cached source changed only the addition of those IDs. The local prototype `167edca` supplied
the interior and initial UI/camera integration; boarding, exits, stop requests, persistence, controls, dwell/doors and
spawn behavior were revised against the [design specification](streetcar-riding-spec.md).

Two integration fixes were needed during verification. Startup now uses the existing `fix/label-shader` change
(`0128b46`), which serializes node builds to avoid shared material references generating incorrect shaders.
Drivers also include streetcars in lane evaluation and may leave a blocked shared tram lane for a clear, legal
straight-through lane while stopped. Lane safety still rejects other vehicles/trams and illegal turn lanes.

## Verification

Production-module tests cover the door lifecycle, holding the final supported stop open, correct-side boarding,
wrong-deck/closed/moving rejection, blocked transfer corridors and exits, request/cancel without forced alighting,
passenger cleanup, live correction/retirement guards, input resets, gamepad interaction and repeated interior reuse.
Separate checks cover shader-build concurrency and drivers safely yielding out of shared tram lanes.
Regression coverage includes all four boarding doors, road-level boarding with traffic checks, and mode changes
that retain the current location/heading, stop carried motion and preserve elevated decks. A phone GPU fixture
uses the normal fleet rather than the featured ride: it boards a stopped 510 through the rear door by tapping the
prompt, then changes mode beside the same stop (`tools/shots/mode-and-boarding.json`).
The desktop companion (`tools/shots/mode-and-boarding-keyboard.json`) boards an ordinary 501/504 through a rear
door from a clear roadway position using the keyboard's **E** handler. Both GPU fixtures passed after the fixes.

Mac mini Metal WebGPU captures exercise desktop and low-quality touch views. The complete journey fixture checks
three successive King stops, station text, retained service identity, stop intent, safe alighting, ground-state
persistence, night lighting, mode changes and teleport cleanup. The page hide is its own shot on the night ride, after the
journey: `pagehide` saves the safe boarding position (not the seat) and ends the ride through the shared
cancellation, returning the rider to that position (st-4sy). The journey can stall in west King traffic: a left- or
right-turning car or bus stopped inside a junction and the streetcar wait for each other (King & Atlantic, and
once behind a queue near Dufferin). On 2026-10-29 that stalled 3 of 4 desktop runs and 0 of 2 low-tier runs (st-wfq),
so retry a stalled run before treating it as a riding failure. Touch checks use actual Playwright taps on the cancel
and boarding buttons and assert that the ride panel fits below search.

```sh
node --test tests/transit-riding.test.mjs tests/transit-gamepad.test.cjs tests/transit-traffic.test.cjs tests/shader-precompile.test.cjs tests/controllers.test.cjs tests/boot.test.cjs
GPU2_LOCK_WAIT=60 gpu2 slop-toronto-riding -- env CAPTURE_QUERY='?quality=high&autoscale=0&transit=timetable#ride=504' CAPTURE_PROGRESS=1 node tools/capture.mjs tools/shots/streetcar-riding-journey.json
GPU2_LOCK_WAIT=60 gpu2 slop-toronto-riding -- env CAPTURE_QUERY='?quality=low&autoscale=0&transit=timetable&film#ride=504' CAPTURE_VIEWPORT=412x915 CAPTURE_MOBILE=1 CAPTURE_TAG=touch CAPTURE_PROGRESS=1 node tools/capture.mjs tools/shots/streetcar-riding-phone.json
```

After the controls/boarding fixes the full suite has 183 tests: 170 pass and the same 13 baseline failures involving stale fixtures/raw geodata. These were recorded before
riding work; validation must compare against them rather than claim a green full suite. GPU runs alongside production
transcription are marked contended and establish visual/function correctness, not a performance benchmark.

## Current limits

This is seated riding, with an approximate procedural interior. Walking between seats, passenger crowds and fares
are future work. Underground streetcar loops need actual platform geometry before boarding/alighting can be enabled;
the ride ends at the last supported surface stop and holds for exit. All routes use the same validation, but individual
stops across the entire network have not been manually inspected.

Traffic can still delay rides. The HUD indicates a closed-door wait and offers a return to the boarding location.
Occupied cars are not teleported through queues. The performance budgets in the design await idle-machine measurement.
