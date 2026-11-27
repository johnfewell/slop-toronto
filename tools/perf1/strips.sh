#!/bin/bash
# tools/perf1/strips.sh: paired reload arms of one build (jf-baa, the fitted impostor strips), on the Mac mini through gpu2. The same dist/ is
# loaded once per arm per round, each with its own query (?impstrips=N, no query for the shipped quad); each page visits every place in PLACES
# (job `visit`: frame time and CPU split over WINDOWS windows, and a screenshot). ROUNDS pages of each arm, the order rotated each round
# (arm 1 first, then arm 2 first, ...) so slow drift on the shared mini lands on every arm.
# usage: GPU2_LOCK_WAIT=3600 gpu2-local fitted-impostors -- env CAPTURE_ROOT=dist CAPTURE_PORT=8851 CAPTURE_CDN_CACHE=1 CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_UNCAPPED=1 CAPTURE_METRICS_MS=1 \
#   ARMS="off:impstrips%3D0 s8:impstrips%3D8" ROUNDS="1 2 3" PLACES="hpw hpa" DATEQ="liveDate=2026-11-26&liveClock=2026-11-26T17:00:00Z" VP=1600x900 TAG=st- bash tools/perf1/strips.sh
# An arm is id:query (a query with no `?`; %3D for =, %26 for &); a record of the mini's load before each page goes to the log.
set -u
TAG=${TAG:-st-}
BASEQ="${DATEQ:+$DATEQ&}autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0"
OUT=${GPU2_OUT:-capture-out}
mkdir -p "$OUT"
page() { # <id> <query> <round>
  local id=$1 q=${2//%3D/=}; q=${q//%26/&}; local r=$3
  echo "=== page $id r$r $(date +%T) load $(uptime | sed 's/.*load averages*: //') ==="
  JOB=visit node tools/perf1/make.mjs visit > "$OUT/${TAG}${id}-r${r}-shots.json" || exit 2
  env CAPTURE_QUERY="?${q}${q:+&}$BASEQ" CAPTURE_TAG="${TAG}${id}-r${r}" CAPTURE_VIEWPORT=${VP:-1600x900} \
    node tools/capture.mjs "$OUT/${TAG}${id}-r${r}-shots.json" || echo "page $id r$r failed (kept whatever it wrote)"
}
arms=($ARMS)
n=${#arms[@]}
for r in ${ROUNDS:-1 2 3}; do
  for ((i = 0; i < n; i++)); do
    a=${arms[$(( (i + r - 1) % n ))]}
    page "${a%%:*}" "${a#*:}" "$r"
  done
done
echo "=== done $(date +%T) ==="
