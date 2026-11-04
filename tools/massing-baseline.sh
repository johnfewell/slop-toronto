#!/bin/bash
# tools/massing-baseline.sh — the ?massing=1 matched idle baseline (st-2nl.3; the st-wt0.2.2 / st-oiw protocol in
# docs/adoption-measurements.md), unattended, from the laptop through gpu2 on the Mac mini. Run it only on a quiet mini
# (docs/massing-buildings.md "Matched idle baseline" says what to check); it never stops anything there.
#
# Three arms, served from two builds in this checkout:
#   main   dist-main/ (MAIN_REF, default origin/main) with ?massing=1: the pilot's 17-float format, 1 km x 5 styles
#   cells  dist/ (this branch) with ?massing=1: the compact cells, tiers and worker build
#   boxes  dist/ without the flag: the default city's boxes (what default-on, st-2nl.7, would replace)
# Both tiers: high (1600x900 desktop, ?quality=high) and low (412x915 touch, ?quality=low, DPR 1), the protocol's
# settings (?autoscale=0&transit=timetable&film&cloudSpeed=0, CAPTURE_SEED=6711, 2 s warm-up + 8 s windows,
# CAPTURE_IDLE_CHECK=1, the long-task init script). Order: a warm-up run of main and cells per tier, then REPS rounds,
# each tier in turn, the arms rotated each round (main cells boxes, cells boxes main, boxes main cells) so no arm is
# always first. Every run's shots are tools/shots/massing-baseline.json (the stats record, then three streets and two
# aerials, each with its draw/triangle census before its window), with read-only host observations before and after
# it (tools/massing-baseline-run.sh). Nothing is discarded: a failed run is retried once under <tag>b, both kept.
#
# usage: tools/massing-baseline.sh [--build]
#   --build    first build dist/ (npm run build) and dist-main/ (MAIN_REF exported with git archive, built the same way
#              with this checkout's node_modules); without it both must exist already
# env: GPU2 (the gpu2 wrapper, default gpu2), GPU2_NAME (default slop-toronto-r3-ride), CAPTURE_PORT (8834),
#      REPS (3), MAIN_REF (origin/main), GPU2_LOCK_WAIT (1800), SHOTS (tools/shots/massing-baseline.json), WARM (1; 0
#      skips the warm-up runs: only for checking the script itself), PREFIX (mb: the runs' tag prefix), RESULTS (default
#      $GPU2_REVIEW_DIR/$GPU2_NAME; GPU2_REVIEW_DIR is the folder gpu2 copies the mini's output back to, and one of
#      RESULTS or GPU2_REVIEW_DIR must be set)
# Output in $RESULTS: mb-baseline-run-order.txt, every run's <tag>-metrics.json, <tag>-console.log, shot PNGs and
# host observations (tags mb-<arm>-<tier>-r<round>), then mb-baseline-<arm>-<tier>.summary.json
# (tools/metrics-summary.mjs, per arm and tier) and mb-baseline-summary.{json,md} (tools/massing-baseline-summary.mjs:
# frame time, CPU, draws, triangles, geometry memory, startup phases, per arm and tier).
set -u
cd "$(git rev-parse --show-toplevel)"
GPU2=${GPU2:-gpu2}
NAME=${GPU2_NAME:-slop-toronto-r3-ride}
PORT=${CAPTURE_PORT:-8834}
REPS=${REPS:-3}
SHOTS=${SHOTS:-tools/shots/massing-baseline.json}
WARM=${WARM:-1}
PREFIX=${PREFIX:-mb}
MAIN_REF=${MAIN_REF:-origin/main}
if [ -z "${RESULTS:-}" ]; then
  [ -n "${GPU2_REVIEW_DIR:-}" ] || { echo "massing-baseline: set GPU2_REVIEW_DIR (the folder gpu2 copies runs back to) or RESULTS"; exit 2; }
  RESULTS=$GPU2_REVIEW_DIR/$NAME
fi
export GPU2_LOCK_WAIT=${GPU2_LOCK_WAIT:-1800}

if [ "${1:-}" = "--build" ]; then
  npm run build || exit 1
  tmp=$(mktemp -d "${TMPDIR:-/tmp}/massing-main.XXXXXX")
  git archive "$MAIN_REF" | tar -x -C "$tmp" && ln -s "$PWD/node_modules" "$tmp/node_modules" && (cd "$tmp" && npm run build) || exit 1
  [ -e dist-main ] && mv dist-main "$tmp/dist-main.previous"
  mv "$tmp/dist" dist-main || exit 1
  echo "built dist/ ($(git rev-parse --short HEAD)) and dist-main/ ($(git rev-parse --short "$MAIN_REF")); the export stays in $tmp"
fi
for d in dist dist-main; do [ -f "$d/explore.html" ] || { echo "massing-baseline: $d/ is missing (run with --build)"; exit 2; }; done
grep -q 'massing-cells' dist/asset-manifest.json || { echo "massing-baseline: dist/ is not a build of the cells branch"; exit 2; }
if grep -q 'massing-cells' dist-main/asset-manifest.json; then echo "massing-baseline: dist-main/ already has the cells: not main"; exit 2; fi

mkdir -p "$RESULTS"
ORDER="$RESULTS/$PREFIX-baseline-run-order.txt"
REV="$(git rev-parse --short HEAD) main=$(git rev-parse --short "$MAIN_REF")"
echo "# massing baseline $(date -u +%FT%TZ): $REV, dist $(sed -n 's/.*"build": "\(.*\)".*/\1/p' dist/asset-manifest.json), dist-main $(sed -n 's/.*"build": "\(.*\)".*/\1/p' dist-main/asset-manifest.json), reps $REPS" >> "$ORDER"

COMMON="CAPTURE_PORT=$PORT CAPTURE_CDN_CACHE=1 CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_METRICS_MS=8000 CAPTURE_METRICS_WARMUP_MS=2000 CAPTURE_IDLE_CHECK=1 CAPTURE_SEED=6711 CAPTURE_PROGRESS=1 CAPTURE_INIT_SCRIPT=tools/capture-longtasks.js"
BASEQ='autoscale=0&transit=timetable&film&cloudSpeed=0'
run() { # <arm> <tier> <tag>
  local arm=$1 tier=$2 tag=$3 root=dist flag='&massing=1' size
  [ "$arm" = main ] && root=dist-main
  [ "$arm" = boxes ] && flag=''
  if [ "$tier" = high ]; then size='CAPTURE_VIEWPORT=1600x900'; else size='CAPTURE_VIEWPORT=412x915 CAPTURE_DPR=1 CAPTURE_MOBILE=1'; fi
  for attempt in "$tag" "${tag}b"; do
    echo "run $attempt $arm $tier start $(date -u +%FT%TZ)" >> "$ORDER"
    "$GPU2" "$NAME" -- env CAPTURE_ROOT=$root $COMMON $size CAPTURE_TAG="$attempt" CAPTURE_SOURCE_REVISION="$arm:$REV" \
      CAPTURE_QUERY="?quality=$tier&$BASEQ$flag" bash tools/massing-baseline-run.sh "$SHOTS"
    local rc=$?
    echo "run $attempt $arm $tier end $(date -u +%FT%TZ) rc=$rc" >> "$ORDER"
    [ $rc -eq 0 ] && return 0
    [ $rc -eq 75 ] && { echo "massing-baseline: the mini lock timed out; stopping (run order in $ORDER)"; exit 75; }
  done
}

[ "$WARM" = 0 ] || for tier in high low; do for arm in main cells; do run $arm $tier "$PREFIX-$arm-$tier-warm"; done; done
ROT=(main cells boxes)
for r in $(seq 1 "$REPS"); do
  for tier in high low; do
    for k in 0 1 2; do arm=${ROT[$(( (k + r - 1) % 3 ))]}; run $arm $tier "$PREFIX-$arm-$tier-r$r"; done
  done
done

for arm in main cells boxes; do for tier in high low; do
  files=$(ls "$RESULTS"/$PREFIX-$arm-$tier-r*-metrics.json 2>/dev/null)
  [ -n "$files" ] && node tools/metrics-summary.mjs $files > "$RESULTS/$PREFIX-baseline-$arm-$tier.summary.json"
done; done
node tools/massing-baseline-summary.mjs "$RESULTS" "$PREFIX"
echo "massing-baseline: done; $RESULTS/$PREFIX-baseline-summary.md"
