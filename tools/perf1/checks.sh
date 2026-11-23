#!/bin/bash
# tools/perf1/checks.sh: the checks for a change (st-aeg2): phone request lists and a frame pair (dist-main against dist-pr, twice each), and
# ten repeat loads of the default page on dist-pr (console logs: page errors, time to ready).
set -u
TAG=${TAG:-chk-}
BASEQ="autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0"
SH=tools/shots
RB="CAPTURE_INIT_SCRIPT=tools/capture-resource-buffer.js CAPTURE_REQUEST_LOG=1"
for i in 1 2; do for root in dist-main dist-pr; do
  env $RB CAPTURE_DPR=2.625 CAPTURE_MOBILE=1 CAPTURE_ROOT=$root CAPTURE_QUERY="?$BASEQ" CAPTURE_TAG="${TAG}phone-${root}-$i" CAPTURE_VIEWPORT=412x915 node tools/capture.mjs $SH/building-presets-parity.json || echo failed
done; done
for i in $(seq 1 10); do
  env CAPTURE_ROOT=dist-pr CAPTURE_QUERY="?$BASEQ" CAPTURE_TAG="${TAG}load-pr-$i" CAPTURE_VIEWPORT=1600x900 node tools/capture.mjs $SH/drawn-default-load.json || echo failed
  [ $i -le 3 ] && env CAPTURE_ROOT=dist-main CAPTURE_QUERY="?$BASEQ" CAPTURE_TAG="${TAG}load-main-$i" CAPTURE_VIEWPORT=1600x900 node tools/capture.mjs $SH/drawn-default-load.json
done
echo "=== done"
