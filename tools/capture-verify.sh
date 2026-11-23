#!/bin/bash
# tools/capture-verify.sh — st-ndw9.24 captures on the Mac mini through gpu2 (never the laptop). JOB words, in order:
#   look      before (dist-main) and after (dist): houses, signs, lanes, mosques, gallery (the audio warning); after only: modern churches
#   calls     triangles and draw calls at the cost shots, dist-main then dist, two runs each
#   loads     five repeat loads of the default page, dist
#   parity    phone default and ?presets=0 request lists and frames, dist-main against dist, twice
# usage (from the worktree): GPU2_LOCK_WAIT=7200 gpu2-local r3-draw -- env CAPTURE_PORT=8842 CAPTURE_CDN_CACHE=1 CAPTURE_NAVIGATION_TIMEOUT_MS=180000 JOB="look" TAG=v1- bash tools/capture-verify.sh
set -u
TAG=${TAG:-v-}
SH=tools/shots
BASEQ="autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0"
PH="CAPTURE_DPR=2.625 CAPTURE_MOBILE=1"
RB="CAPTURE_INIT_SCRIPT=tools/capture-resource-buffer.js CAPTURE_REQUEST_LOG=1"
run() { # <root> <query> <tag> <viewport> <shots> [extra env...]
  local root=$1 query=$2 tag=$3 vp=$4 shots=$5; shift 5
  echo "=== capture $tag ($root $vp $shots) $(date +%T) ==="
  env "$@" CAPTURE_ROOT="$root" CAPTURE_QUERY="$query" CAPTURE_TAG="$tag" CAPTURE_VIEWPORT="$vp" node tools/capture.mjs "$shots" || echo "capture $tag failed (kept whatever it wrote)"
}
for J in $JOB; do
case "$J" in
  look)
    for pair in "dist-main:M" "dist:A"; do
      root=${pair%%:*}; t=${pair##*:}
      run $root "?$BASEQ" "${TAG}${t}-sig-" 1600x900 $SH/ndw9-verify-signs.json
      run $root "?$BASEQ" "${TAG}${t}-hou-" 1600x900 $SH/ndw9-verify-houses.json
      run $root "?$BASEQ" "${TAG}${t}-lan-" 1600x900 $SH/house-polish2-lane.json
      run $root "?$BASEQ" "${TAG}${t}-mos-" 1600x900 $SH/ndw9-verify-mosques.json
      run $root "?gallery=presets&$BASEQ" "${TAG}${t}-gal-" 1600x900 $SH/ndw9-verify-gallery.json
    done
    run dist "?$BASEQ" "${TAG}A-mod-" 1600x900 $SH/ndw9-verify-modern.json ;;
  retry)
    run dist "?$BASEQ" "${TAG}A-ret-" 1600x900 $SH/ndw9-verify-retry.json ;;
  calls)
    for i in 1 2; do
      run dist-main "?$BASEQ" "${TAG}callsM${i}-" 1600x900 $SH/drawn-default-cost.json
      run dist      "?$BASEQ" "${TAG}callsA${i}-" 1600x900 $SH/drawn-default-cost.json
    done ;;
  loads)
    for i in 1 2 3 4 5; do run dist "?$BASEQ" "${TAG}load${i}-" 1600x900 $SH/drawn-default-load.json $RB; done ;;
  parity)
    for i in 1 2; do
      for q in "?$BASEQ" "?presets=0&$BASEQ"; do
        t=$([ "${q#*presets=0}" = "$q" ] && echo def || echo p0)
        run dist-main "$q" "${TAG}${t}-M${i}p-" 412x915 $SH/building-presets-parity.json $PH $RB
        run dist      "$q" "${TAG}${t}-B${i}p-" 412x915 $SH/building-presets-parity.json $PH $RB
      done
    done ;;
  *) echo "unknown job $J" ;;
esac
done
