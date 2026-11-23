#!/bin/bash
# Stride on the Rocketbox body (st-8p1p.5): a side-on camera on one near walker at a walk and at a run, with the step
# length measured from the ankles. Run on the Mac mini: gpu2-local rocketbox-stride -- bash tools/rocketbox/run-stride-captures.sh [walk|flee|both]
# RBP=<prefix> puts a prefix on the output names; RBQ=<extra query> adds query parameters (for example &rocketbox=0).
Q='?quality=high&autoscale=0&transit=timetable&cloudSpeed=0'
export CAPTURE_PORT=5549 CAPTURE_ROOT=dist CAPTURE_CDN_CACHE=1 CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_SEED=6711
cat tools/rocketbox/shot-helper.js tools/ped-gait-helper.js tools/rocketbox/stride-helper.js > tools/rocketbox/.init-all.js
export CAPTURE_INIT_SCRIPT=tools/rocketbox/.init-all.js
mode=${1:-both}
for m in ${RBMODES:-walk flee}; do
  if [ "$mode" = both ] || [ "$mode" = $m ] || [ "$mode" = flee ]; then
    CAPTURE_TAG=$RBP CAPTURE_QUERY="$Q$RBQ" timeout 400 node tools/capture.mjs tools/shots/rocketbox-stride-$m.json 2>&1 | grep -E "\[capture\]|rocketbox\]|\[error\]" | cut -c1-300
  fi
done
rm -f tools/rocketbox/.init-all.js
