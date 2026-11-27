#!/bin/bash
# tools/capture-rosedale.sh (jf-boq, jf-abm; docs/rosedale-spike.md): Rosedale-Moore Park captures on the Mac mini through gpu2, in the real
# late-November season (liveDate=2026-11-26, no season preset, bare trees). Every arm is the same build; the arms differ by address only.
#   ARM before   the City's heights and boxes: ?rosedaleHeights=0&rosedalePilot=0
#   ARM heights  the lidar box heights (jf-boq): ?rosedalePilot=0
#   ARM after    the default page (the pilot, jf-abm)
# usage: GPU2_LOCK_WAIT=3600 ~/.local/bin/gpu2-local rosedale-pilot -- env CAPTURE_ROOT=dist CAPTURE_PORT=8871 CAPTURE_CDN_CACHE=1 \
#   CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_SEED=6711 JOB="views" ARMS="before after" bash tools/capture-rosedale.sh
#   JOB=views   the 14 street and aerial views (tools/shots/rosedale-now.json): about 4 minutes an arm
#   JOB=houses  six houses (from 30 m along the street and from across it) and four streets (tools/shots/rosedale-views.json)
#   JOB=night   three of those views at 21:30 (the houses' windows lit, the porches and the roofs against the dark): tools/shots/rosedale-night.json
#   JOB=frames  frame-time recordings for tools/frame-time-chart.mjs --overlay (tools/shots/rosedale-frame-times.json), FT_SECONDS (default 20)
set -u
BASEQ="autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0&liveWeather=Sunny&liveDate=2026-11-26&liveClock=2026-11-26T12:30:00-05:00"
SH=tools/shots
BEFORE="rosedaleHeights=0&rosedalePilot=0"
run() { # <query> <tag> <shots> [extra env...]
  local query=$1 tag=$2 shots=$3; shift 3
  echo "=== capture $tag ($query) ==="
  env "$@" CAPTURE_ROOT="${ROOT:-dist}" CAPTURE_QUERY="$query" CAPTURE_TAG="$tag" CAPTURE_VIEWPORT=1600x900 CAPTURE_REQUEST_LOG=1 \
    node tools/capture.mjs "$shots" || echo "capture $tag failed (kept whatever it wrote)"
}
NIGHTQ="autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0&liveWeather=Sunny&liveDate=2026-11-26&liveClock=2026-11-26T21:30:00-05:00"
q() { case "$1" in before) echo "?$BEFORE&$BASEQ" ;; heights) echo "?rosedalePilot=0&$BASEQ" ;; after) echo "?$BASEQ" ;; esac; }
for J in $JOB; do
for ARM in ${ARMS:-before after}; do
case "$J" in
  views)  run "$(q $ARM)" "$ARM-" $SH/rosedale-now.json ;;
  houses) run "$(q $ARM)" "h$ARM-" $SH/rosedale-views.json ;;
  night)  run "?$NIGHTQ" "n$ARM-" $SH/rosedale-night.json ;;
  frames) run "$(q $ARM)" "ft-$ARM-" $SH/rosedale-frame-times.json CAPTURE_UNCAPPED=1 CAPTURE_FT_SECONDS=${FT_SECONDS:-20} ;;
esac
done
done
