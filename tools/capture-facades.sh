#!/bin/bash
# tools/capture-facades.sh: before/after shots of the facades on the real footprint edges and the party-wall ghost signs (st-2nl.6)
# on the Mac mini, in the real late-November season (liveDate=2026-11-26, no season preset, bare trees).
#   JOB=street  the party-wall shots (tools/shots/facades-party-walls.json): Queen St W and Spadina from street level and from above
#   JOB=perf    the same shots, uncapped, with frame metrics (run once on ROOT=dist-before and once on dist)
# usage: GPU2_LOCK_WAIT=1800 ~/.local/bin/gpu2-local <name> -- env CAPTURE_ROOT=dist CAPTURE_PORT=88xx CAPTURE_CDN_CACHE=1 \
#   CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_SEED=6711 JOB="street" TAGP=before- ROOT=dist-before bash tools/capture-facades.sh
set -u
BASEQ="autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0&liveWeather=Sunny&liveDate=2026-11-26&liveClock=2026-11-26T12:30:00-05:00"
run() { # <query> <tag> <shots>
  env CAPTURE_ROOT="${ROOT:-dist}" CAPTURE_QUERY="$1" CAPTURE_TAG="${TAGP:-}$2" CAPTURE_VIEWPORT=1600x900 node tools/capture.mjs "$3" || echo "capture $2 failed"
}
for J in $JOB; do
case "$J" in
  street) run "?$BASEQ" street- tools/shots/facades-party-walls.json ;;
  perf)   CAPTURE_METRICS_MS=8000 CAPTURE_UNCAPPED=1 TAGP= run "?$BASEQ" "perf-${PERFTAG:-x}-" tools/shots/facades-party-walls.json ;;
esac
done
