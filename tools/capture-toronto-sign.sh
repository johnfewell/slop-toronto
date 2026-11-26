#!/bin/bash
# tools/capture-toronto-sign.sh: the TORONTO sign shots (jf-icu) on the Mac mini through gpu2-local; dist/ is this branch's build.
#   JOB=summer-night  22 Aug 2026 21:30: the fountain on, the pool water, the sign's colours
#   JOB=winter-night  12 Dec 2026 20:30: the rink (ice), no fountain, the holiday lights
#   JOB=summer-day    22 Aug 2026 12:30: the pale daytime letters and the jets
#   JOB=perfb|perfa   frame time with 8 s of metrics, summer night, uncapped: perfb on dist-before (origin/main's build), perfa on dist; run A/B back to back
# usage: GPU2_LOCK_WAIT=1800 ~/.local/bin/gpu2-local <name> -- env CAPTURE_ROOT=dist CAPTURE_PORT=88xx CAPTURE_CDN_CACHE=1 \
#   CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_SEED=6711 JOB="summer-night winter-night summer-day" bash tools/capture-toronto-sign.sh
set -u
BASEQ="autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0&liveWeather=Sunny"
run() { # <query> <tag> <shots>
  env CAPTURE_ROOT=dist CAPTURE_QUERY="$1" CAPTURE_TAG="$2" CAPTURE_VIEWPORT=1600x900 node tools/capture.mjs "$3" || echo "capture $2 failed"
}
for J in $JOB; do
case "$J" in
  summer-night) run "?liveDate=2026-08-22&liveClock=2026-08-22T21:30:00-04:00&$BASEQ" summer-night- tools/shots/toronto-sign.json ;;
  winter-night) run "?liveDate=2026-12-12&liveClock=2026-12-12T20:30:00-05:00&$BASEQ" winter-night- tools/shots/toronto-sign.json ;;
  perfb|perfa) R=dist; [ "$J" = perfb ] && R=dist-before
         env CAPTURE_ROOT=$R CAPTURE_METRICS_MS=8000 CAPTURE_UNCAPPED=1 CAPTURE_QUERY="?liveDate=2026-08-22&liveClock=2026-08-22T21:30:00-04:00&$BASEQ" CAPTURE_TAG="$J-" CAPTURE_VIEWPORT=1600x900 node tools/capture.mjs tools/shots/toronto-sign-perf.json ;;
  summer-day)   run "?liveDate=2026-08-22&liveClock=2026-08-22T12:30:00-04:00&$BASEQ" summer-day- tools/shots/toronto-sign.json ;;
esac
done
