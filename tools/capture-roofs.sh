#!/bin/bash
# tools/capture-roofs.sh — st-2nl.5 captures (roofs from the City's heights), on the Mac mini through gpu2 (never the laptop).
# dist-main/ is a build of origin/main (the roofs on the boxes' rectangles), dist/ a build of this branch. Both load the default page
# (the bigger map with the drawn buildings); ?roofs=0 on dist/ is the old look from the new code.
#   JOB=shots  the six places (Palmerston Avenue and Markham Street from the street and from 55 m up, College Street from the street
#              and from 70 m up) before (dist-main) and after (dist), late November and summer (liveDate)
#   JOB=loads  N alternating loads of before and after (each leaves its console log: the [init] line, the roofs line, the census)
# usage (from the worktree):
#   GPU2_LOCK_WAIT=1800 ~/.local/bin/gpu2-local roofs-st2nl5 -- env CAPTURE_PORT=8851 CAPTURE_CDN_CACHE=1 \
#     CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_SEED=6711 CAPTURE_PROGRESS=1 JOB=shots TAG=r1 bash tools/capture-roofs.sh
set -u
TAG=${TAG:-r}
SH=tools/shots
BASEQ="autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0"
NOV="liveDate=2026-11-25"
NOVC="liveDate=2026-11-25&liveClock=2026-11-25T17:00:00Z"
JUL="liveDate=2026-07-15"
run() { # <root> <query> <tag> <shots> [extra env...]
  local root=$1 query=$2 tag=$3 shots=$4; shift 4
  echo "=== capture $tag ($root) ==="
  env "$@" CAPTURE_ROOT="$root" CAPTURE_QUERY="$query" CAPTURE_TAG="$tag" CAPTURE_VIEWPORT=1600x900 \
    node tools/capture.mjs "$shots" || echo "capture $tag failed (kept whatever it wrote)"
}
for J in $JOB; do
case "$J" in
  shots)
    for season in nov jul; do
      q=$NOV; [ "$season" = jul ] && q=$JUL
      run dist-main "?$q&$BASEQ" "${TAG}-before-${season}" $SH/roofs-st2nl5.json
      run dist      "?$q&$BASEQ" "${TAG}-after-${season}"  $SH/roofs-st2nl5.json
    done ;;
  close)
    run dist-main "?$NOVC&$BASEQ" "${TAG}-before-novclock" $SH/roofs-st2nl5-close.json
    run dist      "?$NOVC&$BASEQ" "${TAG}-after-novclock"  $SH/roofs-st2nl5-close.json
    run dist-main "?$JUL&$BASEQ" "${TAG}-before-jul" $SH/roofs-st2nl5-close.json
    run dist      "?$JUL&$BASEQ" "${TAG}-after-jul"  $SH/roofs-st2nl5-close.json ;;
  loads)
    for i in $(seq 1 ${N:-4}); do
      run dist-main "?$NOV&$BASEQ" "${TAG}-L${i}-before" $SH/roofs-st2nl5-load.json
      run dist      "?$NOV&$BASEQ" "${TAG}-L${i}-after"  $SH/roofs-st2nl5-load.json
    done ;;
esac
done
