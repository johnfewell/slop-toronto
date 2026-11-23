#!/bin/bash
# tools/perf1/visits.sh: the reload arms of the census (st-aeg2): settings that are built at load (SSR, bloom, MSAA, clouds, shadow
# map size, ...). Each page load visits every place in PLACES once (job `visit`); pages run B A A A B A A A ... (B = the default page,
# A = one arm's query), ROUNDS times, so a base page sits within three pages of every arm page.
# usage: same as run.sh, with ARMS="id:query id:query ..." (a query with no `?`), ROUNDS=3, ORDER=<round number to run, default all>
set -u
TAG=${TAG:-v-}
BASEQ="${BASEPRE:+$BASEPRE&}autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0"
OUT=${GPU2_OUT:-capture-out}
mkdir -p "$OUT"
page() { # <id> <query> <round>
  local id=$1 q=${2//%26/&} r=$3
  echo "=== page $id r$r $(date +%T) ==="
  JOB=visit node tools/perf1/make.mjs visit > "$OUT/${TAG}${id}-r${r}-shots.json" || exit 2
  env CAPTURE_QUERY="?${q}${q:+&}$BASEQ" CAPTURE_TAG="${TAG}${id}-r${r}" CAPTURE_VIEWPORT=1600x900 \
    node tools/capture.mjs "$OUT/${TAG}${id}-r${r}-shots.json" || echo "page $id r$r failed (kept whatever it wrote)"
}
set -- $ARMS
for r in ${ROUNDS:-1}; do
  n=0
  for a in "$@"; do
    if [ $((n % ${PER:-3})) -eq 0 ]; then page base "" "$r.$((n / ${PER:-3}))"; fi
    page "${a%%:*}" "${a#*:}" "$r"
    n=$((n + 1))
  done
  page base "" "$r.end"
done
echo "=== done $(date +%T) ==="
