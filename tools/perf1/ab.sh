#!/bin/bash
# tools/perf1/ab.sh: a before/after of a build against main (st-aeg2), on the Mac mini through gpu2. dist-main/ is a build of origin/main and
# dist-pr/ the build under test; ROUNDS alternating pages (main, pr, main, pr, ...), each page visiting every place in PLACES (frame time and
# CPU split over WINDOWS windows, a census of draws and triangles, and the screenshot: <TAG><root>-r<n>-visit-<place>.json/.png).
# usage: GPU2_LOCK_WAIT=7200 gpu2-local r3-fence -- env CAPTURE_PORT=8843 CAPTURE_CDN_CACHE=1 CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_UNCAPPED=1 CAPTURE_METRICS_MS=1 \
#   ROUNDS="1 2 3" TAG=ab- bash tools/perf1/ab.sh
set -u
TAG=${TAG:-ab-}
BASEQ="autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0"
OUT=${GPU2_OUT:-capture-out}
mkdir -p "$OUT"
page() { # <root> <label> <round> <extra query>
  local root=$1 label=$2 r=$3 q=${4:-}
  echo "=== page $label r$r $(date +%T) ==="
  node tools/perf1/make.mjs visit > "$OUT/${TAG}${label}-r${r}-shots.json" || exit 2
  env CAPTURE_ROOT="$root" CAPTURE_QUERY="?${q}${q:+&}$BASEQ" CAPTURE_TAG="${TAG}${label}-r${r}" CAPTURE_VIEWPORT=1600x900 \
    node tools/capture.mjs "$OUT/${TAG}${label}-r${r}-shots.json" || echo "page $label r$r failed (kept whatever it wrote)"
}
for r in ${ROUNDS:-1 2 3}; do
  page "${ROOTA:-dist-main}" main "$r" "${QMAIN:-}"
  page "${ROOTB:-dist-pr}" pr "$r" "${QPR:-}"
done
echo "=== done $(date +%T) ==="
