#!/bin/bash
# tools/perf1/parity.sh: frame parity of a build against main (st-aeg2), on the Mac mini through gpu2: the five default-page places, six aerials and a
# 22-frame bike sequence, for each root in ROOTS (e.g. "dist-main dist-pr dist-main": the two main runs are the noise floor).
# Outputs <TAG><n>-<root>-<set>-<shot>.png; compare them with tools/perf1/compare.py-style RMSE on the laptop.
set -u
TAG=${TAG:-par-}
BASEQ="autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0"
SH=tools/shots
n=0
for root in ${ROOTS:-dist-main dist-pr dist-main}; do
  n=$((n + 1))
  for set in default-cost air bike; do
    echo "=== parity $n $root $set $(date +%T) ==="
    env CAPTURE_ROOT="$root" CAPTURE_QUERY="?$BASEQ" CAPTURE_TAG="${TAG}${n}-${root}-${set}" CAPTURE_VIEWPORT=1600x900 \
      node tools/capture.mjs "$SH/drawn-${set}.json" || echo "parity $n $root $set failed (kept whatever it wrote)"
  done
done
echo "=== done $(date +%T) ==="
