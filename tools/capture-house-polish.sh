#!/bin/bash
# tools/capture-house-polish.sh — st-ndw9.18 captures, on the Mac mini through gpu2 (never the laptop).
# One job a call (the mini takes one at a time); JOB is words, run in order:
#   (ROOT=src serves the source files without a build: for look rounds; the budget and parity jobs use built roots)
#   gallery | worship-gallery | tower-gallery | city | towers | worship | golden   frames: ROOT (dist = this branch, dist-main = origin/main), TAG
#   cost       budget shots (tools/shots/drawn-default-cost.json), A dist-main against B dist, three alternating pairs, uncapped
#   calls      triangles and draw calls at the same shots, A then B, two runs each
#   lane | worship2 | signs | belfry   second round (tools/make-polish2-shots.mjs)
#   loads      five repeat loads of the default page (leave their console logs)
#   parity     phone default and ?presets=0 request lists and a frame pair, dist-main against dist
# usage (from the worktree):
#   GPU2_LOCK_WAIT=7200 ~/.local/bin/gpu2-local r3-draw -- env CAPTURE_PORT=8842 CAPTURE_CDN_CACHE=1 CAPTURE_NAVIGATION_TIMEOUT_MS=180000 \
#     CAPTURE_SEED=6711 CAPTURE_PROGRESS=1 ROOT=dist JOB="gallery city" TAG=a1- bash tools/capture-house-polish.sh
set -u
TAG=${TAG:-p-}
ROOT=${ROOT:-dist}
SH=tools/shots
BASEQ="autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0"
PH="CAPTURE_DPR=2.625 CAPTURE_MOBILE=1"
RB="CAPTURE_INIT_SCRIPT=tools/capture-resource-buffer.js CAPTURE_REQUEST_LOG=1"
run() { # <root> <query> <tag> <viewport> <shots> [extra env...]
  local root=$1 query=$2 tag=$3 vp=$4 shots=$5; shift 5
  echo "=== capture $tag ($root $vp $shots) ==="
  local rootenv="CAPTURE_ROOT=$root"; [ "$root" = src ] && rootenv="CAPTURE_SRC=1" # (src: the source files as they are, no build, for the look rounds)
  env "$@" "$rootenv" CAPTURE_QUERY="$query" CAPTURE_TAG="$tag" CAPTURE_VIEWPORT="$vp" \
    node tools/capture.mjs "$shots" || echo "capture $tag failed (kept whatever it wrote)"
}
CITYQ="?map=detail&massing=1&presets=draw&$BASEQ"
for J in $JOB; do
case "$J" in
  gallery) run "$ROOT" "?gallery=presets&$BASEQ" "${TAG}gal-" 1600x900 $SH/house-polish-gallery.json ;;
  worship-gallery) run "$ROOT" "?gallery=presets&$BASEQ" "${TAG}galw-" 1600x900 $SH/house-polish-worship-gallery.json ;;
  tower-gallery) run "$ROOT" "?gallery=presets&$BASEQ" "${TAG}galt-" 1600x900 $SH/house-polish-tower-gallery.json ;;
  city) run "$ROOT" "$CITYQ" "${TAG}city-" 1600x900 $SH/house-polish-city.json ;;
  towers) run "$ROOT" "$CITYQ" "${TAG}tow-" 1600x900 $SH/house-polish-towers.json ;;
  worship) run "$ROOT" "$CITYQ" "${TAG}wor-" 1600x900 $SH/house-polish-worship.json ;;
  golden) run "$ROOT" "$CITYQ" "${TAG}gold-" 1600x900 $SH/house-polish-golden.json ;;
  lane) run "$ROOT" "$CITYQ" "${TAG}lane-" 1600x900 $SH/house-polish2-lane.json ;;
  real) run "$ROOT" "$CITYQ" "${TAG}real-" 1600x900 $SH/house-polish2-real.json ;;
  worship2) run "$ROOT" "$CITYQ" "${TAG}wor2-" 1600x900 $SH/house-polish2-worship.json ;;
  signs) run "$ROOT" "$CITYQ" "${TAG}sig-" 1600x900 $SH/house-polish2-signs.json ;;
  belfry) run "$ROOT" "?gallery=presets&$BASEQ" "${TAG}bel-" 1600x900 $SH/house-polish2-belfry.json ;;
  gallery-phone) run "$ROOT" "?gallery=presets&$BASEQ" "${TAG}galp-" 412x915 $SH/house-polish-gallery.json $PH ;;
  cost)
    for i in 1 2 3; do
      run dist-main "?$BASEQ" "${TAG}A${i}-" 1600x900 $SH/drawn-default-cost.json CAPTURE_METRICS_MS=6000 CAPTURE_UNCAPPED=1 $RB
      run dist      "?$BASEQ" "${TAG}B${i}-" 1600x900 $SH/drawn-default-cost.json CAPTURE_METRICS_MS=6000 CAPTURE_UNCAPPED=1 $RB
    done ;;
  calls)
    for i in 1 2; do
      run dist-main "?$BASEQ" "${TAG}callsA${i}-" 1600x900 $SH/drawn-default-cost.json
      run dist      "?$BASEQ" "${TAG}callsB${i}-" 1600x900 $SH/drawn-default-cost.json
    done ;;
  loads)
    for i in 1 2 3 4 5; do
      run dist "?$BASEQ" "${TAG}load${i}-" 1600x900 $SH/drawn-default-load.json $RB
    done ;;
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
