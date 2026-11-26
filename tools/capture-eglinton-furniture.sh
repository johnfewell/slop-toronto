#!/bin/bash
# tools/capture-eglinton-furniture.sh: jf-e8y captures on the Mac mini through gpu2-local (dist/ is this branch's build, dist-main/
# the build of origin/main it is compared with). One job a call (several, space separated, run in order):
#   patios   record the Eglinton map's two CaféTO layouts (boxes and drawn buildings), docs/cafeto-patios.md
#   stats    each layer's counts on the Eglinton map, and the shots of tools/shots/eglinton-furniture.json (real late-November season)
#   perf     load time (the city ready), heap and frame time, dist-main against dist, alternating, on the Eglinton map
# usage: GPU2_LOCK_WAIT=1800 ~/.local/bin/gpu2-local <name> -- env CAPTURE_PORT=<port> CAPTURE_CDN_CACHE=1 \
#   CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_SEED=6711 JOB=patios bash tools/capture-eglinton-furniture.sh
set -u
SH=tools/shots
BASEQ="autoscale=0&transit=timetable&cloudSpeed=0"
NOV="liveDate=2026-11-26&liveClock=2026-11-26T17:00:00Z"
run() { # <root> <query> <tag> <viewport> <shots> [extra env...]
  local root=$1 query=$2 tag=$3 vp=$4 shots=$5; shift 5
  echo "=== capture $tag ($root $vp $shots) ==="
  env "$@" CAPTURE_ROOT="$root" CAPTURE_QUERY="$query" CAPTURE_TAG="$tag" CAPTURE_VIEWPORT="$vp" \
    node tools/capture.mjs "$shots" || echo "capture $tag failed (kept whatever it wrote)"
}
for J in $JOB; do
case "$J" in
  patios)
    run dist "?patios=layout&map=eglinton&presets=0" patios-egl- 1600x900 $SH/patio-layout.json CAPTURE_METRICS_MS=0
    run dist "?patios=layout&map=eglinton" patios-drawn- 1600x900 $SH/patio-layout.json CAPTURE_METRICS_MS=0 ;;
  stats)
    run dist "?map=eglinton&$BASEQ&$NOV" stats- 1600x900 $SH/eglinton-furniture-stats.json CAPTURE_METRICS_MS=0
    run dist "?map=eglinton&$BASEQ&$NOV&film&hud=0" shots- 1600x900 $SH/eglinton-furniture.json ;;
  perf)
    for i in 1 2 3 4 5; do
      run dist-main "?map=eglinton&$BASEQ&memlog=1" "A${i}-" 1600x900 $SH/eglinton-furniture-perf.json CAPTURE_METRICS_MS=6000 CAPTURE_UNCAPPED=1 CAPTURE_INIT_SCRIPT=tools/frames/ready-clock.js
      run dist "?map=eglinton&$BASEQ&memlog=1" "B${i}-" 1600x900 $SH/eglinton-furniture-perf.json CAPTURE_METRICS_MS=6000 CAPTURE_UNCAPPED=1 CAPTURE_INIT_SCRIPT=tools/frames/ready-clock.js
    done ;;
esac
done
