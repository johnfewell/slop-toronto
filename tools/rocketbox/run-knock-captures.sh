#!/bin/bash
# Knocked-down Rocketbox walkers (st-8p1p.4): the car and the bicycle hit a walker drawn as an avatar; the avatar's joints are
# compared with the game's ragdoll every 50 ms. Run on the Mac mini: gpu2-local rocketbox-knock -- bash tools/rocketbox/run-knock-captures.sh [car|bike|both]
# RBP=<prefix> prefixes the output names; RBQ=<extra query>.
Q='?quality=high&autoscale=0&transit=timetable&cloudSpeed=0'
export CAPTURE_PORT=5551 CAPTURE_ROOT=dist CAPTURE_CDN_CACHE=1 CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_SEED=6711
cat tools/rocketbox/shot-helper.js tools/ped-gait-helper.js tools/rocketbox/knock-helper.js > tools/rocketbox/.init-knock.js
export CAPTURE_INIT_SCRIPT=tools/rocketbox/.init-knock.js
mode=${1:-both}
for m in car bike; do
  if [ "$mode" = both ] || [ "$mode" = $m ]; then
    CAPTURE_TAG=$RBP CAPTURE_QUERY="$Q$RBQ" timeout 400 node tools/capture.mjs tools/shots/rocketbox-knock-$m.json 2>&1 | grep -E "\[capture\]|rocketbox\]|\[error\]|gait-setup" | cut -c1-300
  fi
done
rm -f tools/rocketbox/.init-knock.js
