#!/bin/bash
# tools/capture-ghost-signs-rinks.sh: shots of the faded ghost signs and of the six formerly rejected rink sites on the Mac mini,
# in the real late-November season (liveDate=2026-11-26, no season preset, so the trees are bare: the shots carry no "time").
# usage: GPU2_LOCK_WAIT=1800 ~/.local/bin/gpu2-local <name> -- env CAPTURE_PORT=88xx CAPTURE_CDN_CACHE=1 \
#   CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_SEED=6711 ROOT=dist-before TAGP=before- bash tools/capture-ghost-signs-rinks.sh
set -u
BASEQ="autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0&liveWeather=Sunny&liveDate=2026-11-26&liveClock=2026-11-26T12:30:00-05:00"
env CAPTURE_ROOT="${ROOT:-dist}" CAPTURE_QUERY="?$BASEQ" CAPTURE_TAG="${TAGP:-}" CAPTURE_VIEWPORT=1600x900 node tools/capture.mjs tools/shots/ghost-signs-rinks.json || echo "capture failed"
