#!/bin/bash
# tools/perf2/b-final.sh: the final check of the lighter tree shadow casters (st-aeg2.2), on the Mac mini through gpu2: dist-main (origin/main) against
# dist-pr, both with the kerb shadows off and 2048 maps (what part A ships), 3 alternating rounds at four places (frame time, shadow triangles); then
# the before/after sheets' frames (dist-pr with ?treecastlite=0 against its default) in summer, mid-October and January; then a camera glide.
# usage: GPU2_LOCK_WAIT=7200 gpu2-local r3-fence -- env CAPTURE_PORT=8843 CAPTURE_CDN_CACHE=1 CAPTURE_NAVIGATION_TIMEOUT_MS=180000 bash tools/perf2/b-final.sh
set -u
A="q.kerbShadows=false&q.shadowTile=2048"
env CAPTURE_UNCAPPED=1 CAPTURE_METRICS_MS=1 PLACES="cab tb qwa isl" QMAIN="$A" QPR="$A" ROUNDS="1 2 3" TAG=fin- bash tools/perf1/ab.sh
OCT="liveClock=2026-10-18T17:00:00Z%26liveDate=2026-10-18"; WIN="liveClock=2027-01-20T17:00:00Z%26liveDate=2027-01-20"
env CAPTURE_ROOT=dist-pr CAPTURE_UNCAPPED=1 CAPTURE_METRICS_MS=1 PLACES="cab cabg cabc tb isl airg" BASEPRE="$A&treecastlite=0" TAG=fs- \
  ITEMS="lite|treecastlite=20| base-oct|$OCT| lite-oct|treecastlite=20%26$OCT| base-win|$WIN| lite-win|treecastlite=20%26$WIN|" bash tools/perf1/pairs.sh
env CAPTURE_ROOT=dist-pr CAPTURE_UNCAPPED=0 CAPTURE_METRICS_MS=0 TAG=fg- TIME=golden BASEPRE="$A" ARMS="base:treecastlite=0 lite:treecastlite=20" bash tools/perf2/b-glide.sh
echo "=== all done"
