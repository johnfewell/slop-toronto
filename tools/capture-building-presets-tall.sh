#!/bin/bash
# tools/capture-building-presets-tall.sh — st-ndw9.20 captures, on the Mac mini through gpu2 (never the laptop).
# One job a call (the mini takes one at a time): JOB = gallery | city | golden | phone | gallery-phone | parity | calls | perf | repeat (words, several in one call)
#
# usage (from the worktree, with dist/ built from this branch and dist-main/ from origin/main):
#   GPU2_LOCK_WAIT=3600 gpu2-local r3-draw -- env CAPTURE_PORT=8845 CAPTURE_CDN_CACHE=1 CAPTURE_NAVIGATION_TIMEOUT_MS=180000 \
#     CAPTURE_SEED=6711 CAPTURE_PROGRESS=1 JOB="gallery city" TAG=t1- bash tools/capture-building-presets-tall.sh
set -u
TAG=${TAG:-t-}
BASEQ="autoscale=0&transit=timetable&film&cloudSpeed=0"
SH=tools/shots
run() { # <root> <query> <tag> <viewport> <shots> [extra env...]
  local root=$1 query=$2 tag=$3 vp=$4 shots=$5; shift 5
  echo "=== capture $tag ($root $vp $shots) ==="
  env "$@" CAPTURE_ROOT="$root" CAPTURE_QUERY="$query" CAPTURE_TAG="$tag" CAPTURE_VIEWPORT="$vp" \
    node tools/capture.mjs "$shots" || echo "capture $tag failed (kept whatever it wrote)"
}
PH="CAPTURE_DPR=2.625 CAPTURE_MOBILE=1"
CITYQ="?map=detail&massing=1&presets=draw&hud=0&$BASEQ"
for J in $JOB; do
case "$J" in
  gallery) run dist "?gallery=presets&hud=0&$BASEQ" "${TAG}gal-" 1600x900 $SH/building-presets-tall-gallery.json ;;
  gothic) run dist "?gallery=presets&hud=0&$BASEQ" "${TAG}goth-" 1600x900 $SH/building-presets-tall-gothic.json ;;
  gallery-worship) run dist "?gallery=presets&hud=0&$BASEQ" "${TAG}galw-" 1600x900 $SH/building-presets-tall-gallery-worship.json ;;
  worship) run dist "$CITYQ" "${TAG}wor-" 1600x900 $SH/building-presets-tall-worship.json ;;
  gallery-phone) run dist "?gallery=presets&hud=0&$BASEQ" "${TAG}galp-" 412x915 $SH/building-presets-tall-gallery.json $PH ;;
  city) run dist "$CITYQ" "${TAG}city-" 1600x900 $SH/building-presets-tall-city.json ;;
  city-base) run dist "?map=detail&massing=1&hud=0&$BASEQ" "${TAG}citybase-" 1600x900 $SH/building-presets-tall-city.json ;;
  golden) run dist "$CITYQ" "${TAG}gold-" 1600x900 $SH/building-presets-tall-golden.json ;;
  phone) run dist "$CITYQ" "${TAG}ph-" 412x915 $SH/building-presets-tall-phone.json $PH ;;
  perf2) # frame time where it can show: Cabbagetown (above 16.7 ms) and the tower shots, desktop and phone; A no flag, B flag with 16 styles, C flag with the styles forced back to 8 (dist-8)
    for i in 1 2 3; do
      for vp in d p; do
        extra=""; size=1600x900; [ $vp = p ] && { extra="$PH"; size=412x915; }
        for f in $SH/building-presets-houses-perf.json $SH/building-presets-tall-perf.json; do
          n=$(basename $f .json)
          run dist "?map=detail&massing=1&$BASEQ&hud=0" "${TAG}A$i$vp-$n-" $size $f $extra
          run dist "?map=detail&massing=1&presets=draw&$BASEQ&hud=0" "${TAG}B$i$vp-$n-" $size $f $extra
          run dist-8 "?map=detail&massing=1&presets=draw&$BASEQ&hud=0" "${TAG}C$i$vp-$n-" $size $f $extra
        done
      done
    done ;;
  parity)
    for q in "?map=detail&$BASEQ" "?map=detail&massing=1&$BASEQ"; do
      t=$([ "${q#*massing}" = "$q" ] && echo def || echo mas)
      for vp in d p; do
        extra=""; size=1600x900; [ $vp = p ] && { extra="$PH"; size=412x915; }
        for i in 1 2; do
          run dist-main "$q" "${TAG}${t}-M$i$vp-" $size $SH/building-presets-parity.json $extra
          run dist      "$q" "${TAG}${t}-B$i$vp-" $size $SH/building-presets-parity.json $extra
        done
      done
    done ;;
  calls)
    for i in 1 2; do
      run dist "?map=detail&massing=1&$BASEQ&hud=0" "${TAG}callsA$i-" 1600x900 $SH/building-presets-tall-calls.json
      run dist "?map=detail&massing=1&presets=draw&$BASEQ&hud=0" "${TAG}callsB$i-" 1600x900 $SH/building-presets-tall-calls.json
    done ;;
  perf)
    for i in 1 2 3; do
      run dist "?map=detail&massing=1&$BASEQ&hud=0" "${TAG}perfA$i-" 1600x900 $SH/building-presets-tall-perf.json
      run dist "?map=detail&massing=1&presets=draw&$BASEQ&hud=0" "${TAG}perfB$i-" 1600x900 $SH/building-presets-tall-perf.json
    done ;;
  repeat)
    for i in 1 2 3 4 5 6 7 8 9 10; do
      run dist "?gallery=presets&hud=0&$BASEQ" "${TAG}repG$i-" 1600x900 $SH/building-presets-tall-rep-gallery.json
      run dist "$CITYQ" "${TAG}repC$i-" 1600x900 $SH/building-presets-tall-rep-city.json
    done ;;
  *) echo "unknown job $J" ;;
esac
done
