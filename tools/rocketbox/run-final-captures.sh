#!/bin/bash
# Night, winter and busy-crowd frames for the Rocketbox people (st-8p1p.7), on the downtown sidewalk at x=130 z=-345.
# Run on the Mac mini: gpu2-local rocketbox-final -- bash tools/rocketbox/run-final-captures.sh
# Live clocks (the preset times are always summer): today = the real date's season, winter = 20 January with 8 cm of snow.
# The cop is not met by chance in a short view (1 walker in 100), so a debug frame forces him (?rocketboxForce) beside a woman.
Q='?quality=high&autoscale=0&transit=timetable&cloudSpeed=0'
export CAPTURE_PORT=5555 CAPTURE_ROOT=dist CAPTURE_CDN_CACHE=1 CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_SEED=6711
export CAPTURE_INIT_SCRIPT=tools/rocketbox/shot-helper.js
run() { CAPTURE_TAG=$1 CAPTURE_QUERY="$2" timeout 300 node tools/capture.mjs "$3" 2>&1 | grep -E "\[capture\]|\[error\].*(rocketbox|ktx|glb)" | cut -c1-250; }
S=tools/shots/rocketbox-final.json
run today-day- "$Q&liveClock=${TODAY:-2026-11-22}T17:00:00Z" $S
run today-night- "$Q&liveClock=${TODAY2:-2026-11-23}T02:00:00Z" $S
run winter-day- "$Q&liveClock=2027-01-20T17:00:00Z&liveSnow=8" $S
run winter-night- "$Q&liveClock=2027-01-21T02:00:00Z&liveSnow=8" $S
run cop- "$Q&liveClock=2026-11-22T17:00:00Z&rocketboxForce=police-male-03,female-adult-08" tools/shots/rocketbox-people-a.json
