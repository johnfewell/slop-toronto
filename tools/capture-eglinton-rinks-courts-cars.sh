#!/bin/bash
# tools/capture-eglinton-rinks-courts-cars.sh: jf-2g0 captures on the Mac mini through gpu2-local (dist/ is this branch's build,
# dist-main/ the build of origin/main it is compared with). One job a call (several, space separated, run in order):
#   nov    the rinks, tennis courts and a parked-car street outside the detail map, in the real late-November season
#          (liveDate=2026-11-26, no season preset, trees bare), tools/shots/eglinton-rinks-courts-cars.json
#   jan    the same rinks in the ice season (liveDate=2027-01-15), tools/shots/eglinton-rinks-ice.json
#   quick  the default shot list (the start views) on the default desktop page and on a phone, and a phone on ?map=eglinton (its tier's share of the cars)
#   patios the parked cars against the café platforms in summer (?patios=check: the prebuilt layout still matches the runtime's)
#   perf   load time, heap and frame time, dist-main against dist, alternating, on the Eglinton map
# usage: GPU2_LOCK_WAIT=1800 ~/.local/bin/gpu2-local <name> -- env CAPTURE_PORT=<port> CAPTURE_CDN_CACHE=1 \
#   CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_SEED=6711 JOB="nov jan perf" bash tools/capture-eglinton-rinks-courts-cars.sh
set -u
SH=tools/shots
BASEQ="autoscale=0&transit=timetable&cloudSpeed=0"
run() { # <root> <query> <tag> <viewport> <shots> [extra env...]
  local root=$1 query=$2 tag=$3 vp=$4 shots=$5; shift 5
  echo "=== capture $tag ($root $vp $shots) ==="
  env "$@" CAPTURE_ROOT="$root" CAPTURE_QUERY="$query" CAPTURE_TAG="$tag" CAPTURE_VIEWPORT="$vp" \
    node tools/capture.mjs "$shots" || echo "capture $tag failed (kept whatever it wrote)"
}
for J in $JOB; do
case "$J" in
  nov) run dist "?map=eglinton&$BASEQ&liveDate=2026-11-26&liveClock=2026-11-26T17:00:00Z&film&hud=0" nov- 1600x900 $SH/eglinton-rinks-courts-cars.json ;;
  jan) run dist "?map=eglinton&$BASEQ&liveDate=2027-01-15&liveClock=2027-01-15T17:00:00Z&film&hud=0" jan- 1600x900 $SH/eglinton-rinks-ice.json ;;
  quick)
    run dist "?$BASEQ" quick-desk- 1600x900 ""
    run dist "?$BASEQ" quick-phone- 412x915 "" CAPTURE_DPR=2.625 CAPTURE_MOBILE=1
    run dist "?map=eglinton&$BASEQ&time=midday" quick-phone-egl- 412x915 $SH/eglinton-parked-patios.json CAPTURE_DPR=2.625 CAPTURE_MOBILE=1 ;;
  patios) run dist "?map=eglinton&$BASEQ&time=midday&patios=check" patios- 1600x900 $SH/eglinton-parked-patios.json ;;
  perf)
    for i in 1 2 3 4 5; do
      run dist-main "?map=eglinton&$BASEQ&memlog=1" "A${i}-" 1600x900 $SH/eglinton-rinks-courts-cars-perf.json CAPTURE_METRICS_MS=6000 CAPTURE_UNCAPPED=1 CAPTURE_INIT_SCRIPT=tools/frames/ready-clock.js
      run dist "?map=eglinton&$BASEQ&memlog=1" "B${i}-" 1600x900 $SH/eglinton-rinks-courts-cars-perf.json CAPTURE_METRICS_MS=6000 CAPTURE_UNCAPPED=1 CAPTURE_INIT_SCRIPT=tools/frames/ready-clock.js
    done ;;
esac
done
