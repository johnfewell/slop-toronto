#!/bin/bash
# tools/capture-leaf-season.sh (jf-qax): the leaf-season proof views on the Mac mini, one build and one date per run.
#   ARM before|after (dist-before/ = origin/main's build, dist/ = this branch's)   DATES="0715 1020 1128"
# usage: GPU2_LOCK_WAIT=3600 ~/.local/bin/gpu2-local leaf-season -- env CAPTURE_PORT=8893 CAPTURE_CDN_CACHE=1 CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_SEED=6711 ARMS="before after" DATES="0715 1020 1128" bash tools/capture-leaf-season.sh
set -u
q() { # <MMDD> -> query (no time preset: the page is live on that day)
  case "$1" in 0715) D=2026-07-15; Z=-04:00 ;; 1020) D=2026-10-20; Z=-04:00 ;; 1128) D=2026-11-28; Z=-05:00 ;; esac
  echo "?autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0&liveWeather=Sunny&liveDate=$D&liveClock=${D}T12:30:00$Z&liveSnow=0"
}
for D in ${DATES:-0715 1020 1128}; do
for ARM in ${ARMS:-before after}; do
  ROOTD=dist; [ "$ARM" = before ] && ROOTD=dist-before
  echo "=== $ARM $D ==="
  env CAPTURE_ROOT="$ROOTD" CAPTURE_QUERY="$(q $D)" CAPTURE_TAG="$ARM-$D-" CAPTURE_VIEWPORT=1600x900 node tools/capture.mjs tools/shots/leaf-season.json || echo "capture $ARM $D failed"
done; done
