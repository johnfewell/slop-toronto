#!/bin/bash
# Cost of the Rocketbox people against the same build with them off (?rocketbox=0 is what main drew), st-8p1p.6.
# Run on the Mac mini: gpu2-local rocketbox-perf -- bash tools/rocketbox/run-perf-captures.sh [high|medium|low|all]
# One fixed view (x=150 z=0, facing the crowd), frame times uncapped over an 8 s window after 2 s, arms alternating off / on,
# three rounds, CAPTURE_IDLE_CHECK=1 so the harness records what else was running. Phone tiers: 412x915, mobile emulation, DPR 1.
# The shot's own report (window.__rbWait) is in <tag>rb-perf.json: avatars drawn, files loaded, triangle counts.
Q='autoscale=0&transit=timetable&cloudSpeed=0'
export CAPTURE_PORT=5553 CAPTURE_ROOT=dist CAPTURE_CDN_CACHE=1 CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_SEED=6711
export CAPTURE_UNCAPPED=1 CAPTURE_METRICS_MS=8000 CAPTURE_METRICS_WARMUP_MS=2000 CAPTURE_IDLE_CHECK=1
export CAPTURE_INIT_SCRIPT=tools/rocketbox/shot-helper.js
tiers=${1:-all}; [ "$tiers" = all ] && tiers="high medium low"
for tier in $tiers; do
  if [ "$tier" = low ] || [ "$tier" = phone-medium ]; then export CAPTURE_VIEWPORT=412x915 CAPTURE_MOBILE=1 CAPTURE_DPR=1; else unset CAPTURE_VIEWPORT CAPTURE_MOBILE CAPTURE_DPR; fi
  q=$tier; [ "$tier" = phone-medium ] && q=medium
  for r in 1 2 3; do
    for arm in off on; do
      extra=; [ $arm = off ] && extra='&rocketbox=0'
      CAPTURE_TAG=$RBP$tier-$arm-r$r- CAPTURE_QUERY="?quality=$q&$Q$extra" timeout 300 node tools/capture.mjs tools/shots/${SHOT:-rocketbox-perf}.json 2>&1 | grep -E "\[metrics\]|\[capture\] .*(failed|ready)" | cut -c1-250
    done
  done
done
