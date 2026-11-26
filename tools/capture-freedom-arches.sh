#!/bin/bash
# tools/capture-freedom-arches.sh: the Freedom Arches shots on the Mac mini through gpu2-local (dist/ is this branch's build).
#   JOB=shots   the arches by day and at night inside the Cavalcade window (28 Nov 2026), and outside it (22 August: plain concrete)
#   JOB=tree    the Distillery tree at night (tools/shots/holiday.json)
# usage: GPU2_LOCK_WAIT=1800 ~/.local/bin/gpu2-local freedom-arches -- env CAPTURE_ROOT=dist CAPTURE_PORT=8871 CAPTURE_CDN_CACHE=1 \
#   CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_SEED=6711 JOB=shots bash tools/capture-freedom-arches.sh
set -u
BASEQ="autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0&liveWeather=Sunny"
run() { # <query> <tag> <shots>
  env CAPTURE_ROOT=dist CAPTURE_QUERY="$1" CAPTURE_TAG="$2" CAPTURE_VIEWPORT=1600x900 node tools/capture.mjs "$3" || echo "capture $2 failed"
}
for J in $JOB; do
case "$J" in
  shots)
    run "?liveDate=2026-11-28&liveClock=2026-11-28T12:30:00-05:00&$BASEQ" nov-day- tools/shots/freedom-arches.json
    run "?liveDate=2026-11-28&liveClock=2026-11-28T20:30:00-05:00&$BASEQ" nov-night- tools/shots/freedom-arches.json
    run "?liveDate=2026-08-22&liveClock=2026-08-22T12:30:00-04:00&$BASEQ" aug-day- tools/shots/freedom-arches.json
    run "?liveDate=2026-08-22&liveClock=2026-08-22T21:30:00-04:00&$BASEQ" aug-night- tools/shots/freedom-arches.json ;;
  tree)
    run "?liveDate=2026-11-28&liveClock=2026-11-28T20:30:00-05:00&$BASEQ" tree-night- tools/shots/holiday.json ;;
esac
done
