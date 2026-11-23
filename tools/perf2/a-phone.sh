#!/bin/bash
# tools/perf2/a-phone.sh: the phone tier (?quality=low, a 412x915 touch viewport) request lists and frames, dist-main against dist-pr, twice each (st-aeg2.1)
set -u
TAG=${TAG:-phl-}
BASEQ="quality=low&autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0"
RB="CAPTURE_INIT_SCRIPT=tools/capture-resource-buffer.js CAPTURE_REQUEST_LOG=1"
for i in 1 2; do for root in dist-main dist-pr; do
  env $RB CAPTURE_DPR=2.625 CAPTURE_MOBILE=1 CAPTURE_ROOT=$root CAPTURE_QUERY="?$BASEQ" CAPTURE_TAG="${TAG}${root}-$i" CAPTURE_VIEWPORT=412x915 node tools/capture.mjs tools/shots/building-presets-parity.json || echo failed
done; done
echo "=== done"
