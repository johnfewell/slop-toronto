#!/bin/bash
# tools/capture-material-colours.sh: before/after shots for the materials whose colour was applied twice (jf-xql) on the Mac mini.
#   JOB=nov     Colborne Lodge's roof and a High Park hedge in the real late-November season (liveDate=2026-11-26, no season preset, bare trees)
#   JOB=winter  the same in mid-January with 15 cm of snow on the ground (liveSnow=15)
#   JOB=audit   record every material in the loaded scene that is vertex-coloured and also reads the colour attribute in its colorNode
#   JOB=perf    the frame-time shots, run once on dist-before and once on dist (A/B back to back)
# usage: GPU2_LOCK_WAIT=1800 ~/.local/bin/gpu2-local <name> -- env CAPTURE_ROOT=dist CAPTURE_PORT=88xx CAPTURE_CDN_CACHE=1 \
#   CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_SEED=6711 JOB="nov winter audit" TAGP=before- bash tools/capture-material-colours.sh
set -u
BASEQ="autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0&liveWeather=Sunny&liveDate=2026-11-26&liveClock=2026-11-26T12:30:00-05:00"
run() { # <query> <tag> <shots>
  env CAPTURE_ROOT="${ROOT:-dist}" CAPTURE_QUERY="$1" CAPTURE_TAG="${TAGP:-}$2" CAPTURE_VIEWPORT=1600x900 node tools/capture.mjs "$3" || echo "capture $2 failed"
}
for J in $JOB; do
case "$J" in
  nov)    run "?$BASEQ" nov- tools/shots/material-colours.json ;;
  winter) W=${BASEQ//2026-11-26/2027-01-15}; run "?${W}&liveSnow=15" winter- tools/shots/material-colours.json ;;
  audit)  run "?$BASEQ" audit- tools/shots/material-colours-audit.json ;;
  perf)   CAPTURE_METRICS_MS=8000 CAPTURE_UNCAPPED=1 TAGP= run "?$BASEQ" "perf-${PERFTAG:-x}-" tools/shots/material-colours.json ;;
esac
done
