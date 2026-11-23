#!/bin/bash
# tools/capture-school-fences.sh — st-ndw9.17 captures, on the Mac mini through gpu2 (never the laptop).
# One job a call (the mini takes one at a time): JOB = cost | defcost | coverage | phone | parity | frames | closer
#   cost    what the fence costs: draw calls, triangles and frame time, three alternating rounds of four arms on
#           tools/shots/school-fences-cost.json: O ?schoolFences=0 (the off switch; the fence has been on by default since
#           2026-11-17), F the default page, N the default with no sun shadow (?schoolFenceShadow=0), M ?schoolFences=1 on
#           dist-main (whatever fence that build draws). JOB=defcost is the default page against ?schoolFences=0 only
#           (st-ndw9.21), (it records the time to ready too)
#   parity  the default page (no flag) against origin/main: request lists and frames, main twice and this branch twice
#   closer  the same schools straight down from 90 and 60 m, and 3 m from the run
#   frames  the six schools from 8 m, along a run, from 35 m and 90 m up, midday and golden hour, on this build
#
# usage (from the worktree, with dist/ built from this branch and dist-main/ from origin/main):
#   GPU2_LOCK_WAIT=3600 ~/.local/bin/gpu2-local r3-fence -- env CAPTURE_PORT=8843 CAPTURE_CDN_CACHE=1 \
#     CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_SEED=6711 CAPTURE_PROGRESS=1 JOB=cost TAG=fc bash tools/capture-school-fences.sh
set -u
TAG=${TAG:-sf}
SH=tools/shots
B="hud=0&autoscale=0&transit=timetable&film&cloudSpeed=0"
RB="CAPTURE_INIT_SCRIPT=tools/capture-resource-buffer.js CAPTURE_REQUEST_LOG=1"
run() { # <root> <query> <tag> <viewport> <shots> [extra env...]
  local root=$1 query=$2 tag=$3 vp=$4 shots=$5; shift 5
  echo "=== capture $tag ($root $vp $shots) ==="
  env "$@" CAPTURE_ROOT="$root" CAPTURE_QUERY="$query" CAPTURE_TAG="$tag" CAPTURE_VIEWPORT="$vp" \
    node tools/capture.mjs "$shots" || echo "capture $tag failed (kept whatever it wrote)"
}
for J in $JOB; do
case "$J" in
  cost)
    for i in 1 2 3; do
      run dist      "?schoolFences=0&$B"                        "${TAG}O$i" 1600x900 $SH/school-fences-cost.json CAPTURE_METRICS_MS=4000 CAPTURE_UNCAPPED=1
      run dist      "?$B"                                       "${TAG}F$i" 1600x900 $SH/school-fences-cost.json CAPTURE_METRICS_MS=4000 CAPTURE_UNCAPPED=1
      run dist      "?schoolFenceShadow=0&$B"                   "${TAG}N$i" 1600x900 $SH/school-fences-cost.json CAPTURE_METRICS_MS=4000 CAPTURE_UNCAPPED=1
      run dist-main "?schoolFences=1&$B"                        "${TAG}M$i" 1600x900 $SH/school-fences-cost.json CAPTURE_METRICS_MS=4000 CAPTURE_UNCAPPED=1
    done ;;
  defcost)
    # the default page (fence on) against ?schoolFences=0, five alternating pairs, uncapped, four shots, with the time to ready
    for i in 1 2 3 4 5; do
      run dist "?schoolFences=0&$B" "${TAG}A${i}" 1600x900 $SH/school-fences-defcost.json CAPTURE_METRICS_MS=4000 CAPTURE_UNCAPPED=1 $RB
      run dist "?$B"                "${TAG}B${i}" 1600x900 $SH/school-fences-defcost.json CAPTURE_METRICS_MS=4000 CAPTURE_UNCAPPED=1 $RB
    done ;;
  coverage)
    # the fence at the six fix-1 schools and two near the edge of its coverage, on the default page
    run dist "?$B" "${TAG}cov" 1600x900 $SH/school-fences-coverage.json ;;
  phone)
    # the phone tier gets no fence and no fence file: request lists (the server's complete list) of the phone, the phone asked for the
    # fence by hand, a low-tier desktop, and the desktop default and ?schoolFences=0 for contrast
    PH="CAPTURE_DPR=2.625 CAPTURE_MOBILE=1"
    run dist "?$B"                  "${TAG}ph-"      412x915 $SH/school-fences-load.json $RB $PH
    run dist "?schoolFences=1&$B"   "${TAG}ph1-"     412x915 $SH/school-fences-load.json $RB $PH
    run dist "?quality=low&$B"      "${TAG}low-"     1600x900 $SH/school-fences-load.json $RB
    run dist "?map=detail&$B"       "${TAG}det-"     1600x900 $SH/school-fences-load.json $RB ;;
  parity)
    for i in 1 2; do
      run dist-main "?autoscale=0&transit=timetable&film&cloudSpeed=0" "${TAG}M${i}d" 1600x900 $SH/building-presets-parity.json $RB
      run dist      "?autoscale=0&transit=timetable&film&cloudSpeed=0" "${TAG}B${i}d" 1600x900 $SH/building-presets-parity.json $RB
    done
    for i in 1 2; do
      run dist-main "?autoscale=0&transit=timetable&film&cloudSpeed=0" "${TAG}M${i}p" 412x915 $SH/building-presets-parity.json $RB CAPTURE_DPR=2.625 CAPTURE_MOBILE=1
      run dist      "?autoscale=0&transit=timetable&film&cloudSpeed=0" "${TAG}B${i}p" 412x915 $SH/building-presets-parity.json $RB CAPTURE_DPR=2.625 CAPTURE_MOBILE=1
    done ;;
  frames)
    run dist "?$B" "${TAG}a" 1600x900 $SH/school-fences-chainlink-a.json
    run dist "?$B" "${TAG}g" 1600x900 $SH/school-fences-chainlink-g.json ;;
  closer)
    # straight down from 90 and 60 m (d) and 3 m from the run (c), midday
    run dist "?$B" "${TAG}d" 1600x900 $SH/school-fences-chainlink-d.json
    run dist "?$B" "${TAG}c" 1600x900 $SH/school-fences-chainlink-c.json ;;
  *) echo "unknown JOB $J"; exit 2 ;;
esac
done
echo "=== done $JOB ==="
