#!/bin/bash
# tools/capture-building-presets-houses.sh — st-ndw9.15 captures, on the Mac mini through gpu2 (never the laptop).
# One job a call (the mini takes one at a time): JOB = gallery | city | golden | parta | partab | phone | parity | perf
#
# usage (from the worktree, with dist/ built from this branch and dist-main/ from origin/main):
#   GPU2_LOCK_WAIT=1800 ~/.local/bin/gpu2-local r3-draw -- env CAPTURE_PORT=8845 CAPTURE_CDN_CACHE=1 \
#     CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_SEED=6711 CAPTURE_PROGRESS=1 JOB=gallery TAG=h2- bash tools/capture-building-presets-houses.sh
set -u
TAG=${TAG:-h-}
BASEQ="autoscale=0&transit=timetable&film&cloudSpeed=0"
SH=tools/shots
run() { # <root> <query> <tag> <viewport> <shots> [extra env...]
  local root=$1 query=$2 tag=$3 vp=$4 shots=$5; shift 5
  echo "=== capture $tag ($root $vp $shots) ==="
  env "$@" CAPTURE_ROOT="$root" CAPTURE_QUERY="$query" CAPTURE_TAG="$tag" CAPTURE_VIEWPORT="$vp" \
    node tools/capture.mjs "$shots" || echo "capture $tag failed (kept whatever it wrote)"
}
PH="CAPTURE_DPR=2.625 CAPTURE_MOBILE=1"
for J in $JOB; do
case "$J" in
  gallery) run dist "?gallery=presets&hud=0&$BASEQ" "${TAG}gal-" 1600x900 $SH/building-presets-houses-gallery.json ;;
  gallery-phone) run dist "?gallery=presets&hud=0&$BASEQ" "${TAG}galp-" 412x915 $SH/building-presets-houses-gallery.json $PH ;;
  city) run dist "?map=detail&massing=1&presets=draw&hud=0&$BASEQ" "${TAG}city-" 1600x900 $SH/building-presets-houses-city.json ;;
  golden) run dist "?map=detail&massing=1&presets=draw&hud=0&$BASEQ" "${TAG}gold-" 1600x900 $SH/building-presets-houses-golden.json ;;
  parta) run dist "?map=detail&massing=1&presets=draw&hud=0&$BASEQ" "${TAG}pa-" 1600x900 $SH/building-presets-houses-parta.json ;;
  parta-before) run dist-main "?map=detail&massing=1&presets=draw&hud=0&$BASEQ" "${TAG}pb-" 1600x900 $SH/building-presets-houses-parta.json ;;
  phone) run dist "?map=detail&massing=1&presets=draw&hud=0&$BASEQ" "${TAG}ph-" 412x915 $SH/building-presets-houses-phone.json $PH ;;
  shops) run dist "?map=detail&massing=1&presets=draw&hud=0&$BASEQ" "${TAG}shop-" 1600x900 $SH/building-presets-houses-shops.json ;;
  shops-base) run dist "?map=detail&massing=1&presets=0&hud=0&$BASEQ" "${TAG}shopbase-" 1600x900 $SH/building-presets-houses-shops.json ;;
  shops-golden) run dist "?map=detail&massing=1&presets=draw&hud=0&$BASEQ" "${TAG}shopg-" 1600x900 $SH/building-presets-houses-shops-golden.json ;;
  shops-phone) run dist "?map=detail&massing=1&presets=draw&hud=0&$BASEQ" "${TAG}shopp-" 412x915 $SH/building-presets-houses-shops.json $PH ;;
  parta-golden) run dist "?map=detail&massing=1&presets=draw&hud=0&$BASEQ" "${TAG}pag-" 1600x900 $SH/building-presets-houses-parta-golden.json ;;
  phone2) run dist "?map=detail&massing=1&presets=draw&hud=0&$BASEQ" "${TAG}ph2-" 412x915 $SH/building-presets-houses-phone2.json $PH ;;
  shops-nopar) run dist-nopar "?map=detail&massing=1&presets=draw&hud=0&$BASEQ" "${TAG}nopar-" 1600x900 $SH/building-presets-houses-shops.json ;;
  calls)
    for i in 1 2; do
      run dist "?map=detail&massing=1&presets=0&$BASEQ&hud=0" "${TAG}callsA$i-" 1600x900 $SH/building-presets-houses-calls.json
      run dist "?map=detail&massing=1&presets=draw&$BASEQ&hud=0" "${TAG}callsB$i-" 1600x900 $SH/building-presets-houses-calls.json
    done ;;
  repeat)
    for i in 1 2 3 4 5; do
      run dist "?gallery=presets&hud=0&$BASEQ" "${TAG}repG$i-" 1600x900 $SH/building-presets-houses-rep-gallery.json
      run dist "?map=detail&massing=1&presets=draw&hud=0&$BASEQ" "${TAG}repC$i-" 1600x900 $SH/building-presets-houses-rep-city.json
    done ;;
  walk) run dist "?gallery=presets&$BASEQ" "${TAG}walk-" 1600x900 $SH/building-presets-houses-walk.json ;;
  walk-phone) run dist "?gallery=presets&$BASEQ" "${TAG}walkp-" 412x915 $SH/building-presets-houses-walk.json $PH ;;
  perf)
    for i in 1 2 3; do
      run dist "?map=detail&massing=1&presets=0&$BASEQ&hud=0" "${TAG}perfA$i-" 1600x900 $SH/building-presets-houses-perf.json
      run dist "?map=detail&massing=1&presets=draw&$BASEQ&hud=0" "${TAG}perfB$i-" 1600x900 $SH/building-presets-houses-perf.json
    done ;;
  parity)
    for q in "?map=detail&$BASEQ" "?map=detail&massing=1&presets=0&$BASEQ"; do
      t=$([ "${q#*massing}" = "$q" ] && echo def || echo mas)
      for vp in d p; do
        extra=""; size=1600x900; [ $vp = p ] && { extra="$PH"; size=412x915; }
        for i in 1 2; do
          run dist-main "$q" "${TAG}${t}-M$i$vp-" $size $SH/building-presets-parity.json $extra
          run dist      "$q" "${TAG}${t}-B$i$vp-" $size $SH/building-presets-parity.json $extra
        done
      done
    done ;;
  *) echo "unknown JOB $J"; exit 2 ;;
esac
done
echo "=== done $JOB ==="
