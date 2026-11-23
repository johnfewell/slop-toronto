#!/bin/bash
# tools/perf1/pairs.sh: before/after screenshots of look-changing cuts (st-aeg2), on the Mac mini through gpu2.
# ITEMS="id|query|runtimeArm id|query|runtimeArm ..." (a query without `?`, e.g. q.ssr=false; a runtime arm from lib.js, e.g. casc1:Trees; either may be empty).
# Each item loads the page once and screenshots each of PLACES (and records the frame time there): <TAG><id>-shot-<place>.png / .json. `base` is added first.
set -u
TAG=${TAG:-pr-}
BASEQ="${BASEPRE:+$BASEPRE&}autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0"
OUT=${GPU2_OUT:-capture-out}
mkdir -p "$OUT"
page() { # <id> <query> <arm>
  local id=$1 q=$2 arm=$3
  echo "=== pair $id $(date +%T) ==="
  ARM="$arm" node tools/perf1/make.mjs shots > "$OUT/${TAG}${id}-shots.json" || { echo "no shots for $id"; return; }
  env CAPTURE_QUERY="?${q}${q:+&}$BASEQ" CAPTURE_TAG="${TAG}${id}" CAPTURE_VIEWPORT=1600x900 \
    node tools/capture.mjs "$OUT/${TAG}${id}-shots.json" || echo "pair $id failed (kept whatever it wrote)"
}
page base "" ""
for item in $ITEMS; do
  IFS='|' read -r id q arm <<< "$item"
  page "$id" "${q//%26/&}" "${arm//+/ }"
done
echo "=== done $(date +%T) ==="
