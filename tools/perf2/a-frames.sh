#!/bin/bash
# tools/perf2/a-frames.sh: the frames for the kerb-shadow and 2048-map cut (st-aeg2.1), on the Mac mini through gpu2:
# tools/shots/perf2-frames-a.json (house street, Queen West at Trinity Bellwoods, Financial District, golden hour, shadow edges from 3 m)
# and tools/shots/perf2-bike-golden.json (a bike sequence at golden hour) for each root in ROOTS (default: dist-main dist-pr dist-main,
# the two main runs are the noise floor). Outputs <TAG><n>-<root>-<set>-<shot>.png.
set -u
TAG=${TAG:-pf-}
BASEQ="autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0"
n=0
for root in ${ROOTS:-dist-main dist-pr dist-main}; do
  n=$((n + 1))
  for set in frames-a bike-golden; do
    echo "=== frames $n $root $set $(date +%T) ==="
    env CAPTURE_ROOT="$root" CAPTURE_QUERY="?$BASEQ" CAPTURE_TAG="${TAG}${n}-${root}-${set}" CAPTURE_VIEWPORT=1600x900 \
      node tools/capture.mjs "tools/shots/perf2-${set/frames-a/frames-a}.json" || echo "frames $n $root $set failed (kept whatever it wrote)"
  done
done
echo "=== done $(date +%T) ==="
