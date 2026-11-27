#!/bin/bash
# tools/capture-front-yards.sh (jf-ugq; docs/front-yards.md): the front-yard captures on the Mac mini through gpu2. Every arm is a build of the page; the arms differ by build and date:
#   ARM before   origin/main's build, in dist-before/ (npm run build in a worktree of origin/main, copied here)      WINTER: today's date, bare trees
#   ARM after    this branch's build, dist/                                                                       WINTER
#   ARM beforeSnow / afterSnow   WINTER with 8 cm of snow on the ground (?liveSnow=8)
#   ARM beforeJul / afterJul   the same two builds on 2026-07-15 (summer: leaves, flowers, lawns)
# JOB=ground  the ground pictures (jf-aru: tools/shots/front-yards-ground*.json, four Rosedale streets and the Annex and Cabbagetown)
# JOB=framesC  frame times at Crescent Rd's street level only (winter and, with the *Jul arms, July), ROUND=<n> in the file names
# JOB=rosedale  the six houses' sidewalk and bike views (tools/shots/front-yards-rosedale.json, from the walls shot list); JOB=others  the four other neighbourhoods
# (tools/shots/front-yards-others.json); JOB=frames  frame-time recordings (tools/shots/front-yards-frame-times.json), FT_SECONDS (default 20)
# usage: GPU2_LOCK_WAIT=3600 ~/.local/bin/gpu2-local front-yards -- env CAPTURE_PORT=8881 CAPTURE_CDN_CACHE=1 CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_SEED=6711 JOB="rosedale" ARMS="before after" bash tools/capture-front-yards.sh
set -u
WINTER="autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0&liveWeather=Sunny&liveDate=2026-11-26&liveClock=2026-11-26T12:30:00-05:00"
JULY="autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0&liveWeather=Sunny&liveDate=2026-07-15&liveClock=2026-07-15T12:30:00-04:00&liveSnow=0"
SH=tools/shots
run() { # <root> <query> <tag> <shots> [extra env...]
  local root=$1 query=$2 tag=$3 shots=$4; shift 4
  echo "=== capture $tag ($root $query) ==="
  env "$@" CAPTURE_ROOT="$root" CAPTURE_QUERY="$query" CAPTURE_TAG="$tag" CAPTURE_VIEWPORT=1600x900 CAPTURE_REQUEST_LOG=1 \
    node tools/capture.mjs "$shots" || echo "capture $tag failed (kept whatever it wrote)"
}
arm() { case "$1" in
  afterSnow) echo "dist|?$WINTER&liveSnow=8" ;; beforeSnow) echo "dist-before|?$WINTER&liveSnow=8" ;;
  afterOff) echo "dist|?$WINTER&frontYards=0" ;; before) echo "dist-before|?$WINTER" ;; after) echo "dist|?$WINTER" ;; beforeJul) echo "dist-before|?$JULY" ;; afterJul) echo "dist|?$JULY" ;; esac; }
for J in $JOB; do
for ARM in ${ARMS:-before after}; do
  IFS='|' read -r ROOTD Q <<< "$(arm $ARM)"
  SUF=""; case "$ARM" in *Jul) SUF="-jul" ;; esac # (July: the shots call seasons.inject('07-15', 0) first, so no snow lies)
  case "$J" in
    rosedale) run "$ROOTD" "$Q" "$ARM-" $SH/front-yards-rosedale$SUF.json ;;
    find)     run "$ROOTD" "$Q" "find$ARM-" $SH/front-yards-others-find.json ;;
    others)   run "$ROOTD" "$Q" "o$ARM-" $SH/front-yards-others$SUF.json ;;
    ground)   run "$ROOTD" "$Q" "g$ARM-" $SH/front-yards-ground$SUF.json ;;
    look)     run "$ROOTD" "$Q" "l$ARM-" $SH/front-yards-look$SUF.json ;;
    debug)    run "$ROOTD" "$Q" "dbg$ARM-" $SH/front-yards-debug.json ;;
    framesO)  run "$ROOTD" "$Q" "fto${ROUND:-}-$ARM-" $SH/front-yards-frame-times-others.json CAPTURE_UNCAPPED=1 CAPTURE_FT_SECONDS=${FT_SECONDS:-20} ;;
    framesC)  run "$ROOTD" "$Q" "ftc${ROUND:-}-$ARM-" $SH/front-yards-frame-times-crescent.json CAPTURE_UNCAPPED=1 CAPTURE_FT_SECONDS=${FT_SECONDS:-20} ;;
    frames)   run "$ROOTD" "$Q" "ft${ROUND:-}-$ARM-" $SH/front-yards-frame-times.json CAPTURE_UNCAPPED=1 CAPTURE_FT_SECONDS=${FT_SECONDS:-20} ;;
  esac
done
done
