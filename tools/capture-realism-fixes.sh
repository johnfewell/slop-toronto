#!/bin/bash
# tools/capture-realism-fixes.sh: shots for the 2026-11-26 realism fixes (jf-gdw rink, jf-dr1 black roof, jf-lu7 Eglinton light) on the Mac mini.
#   JOB=state   dump the lights, fog, exposure and sky occlusion of the default (bigger, Eglinton) map and ?map=detail (same date and time)
#   JOB=roof    the five restored buildings (late November, bare trees)
#   JOB=rink    Nathan Phillips Square, with the arches
#   JOB=light   the same view in the default (bigger) map and on ?map=detail; Eglinton Ave W and Queen St W
# usage: GPU2_LOCK_WAIT=1800 ~/.local/bin/gpu2-local <name> -- env CAPTURE_ROOT=dist CAPTURE_PORT=88xx CAPTURE_CDN_CACHE=1 \
#   CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_SEED=6711 JOB="state roof" TAGP=before- bash tools/capture-realism-fixes.sh
set -u
BASEQ="autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0&liveWeather=Sunny&liveDate=2026-11-26&liveClock=2026-11-26T12:30:00-05:00"
NATQ="autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0&liveDate=2026-11-26&liveClock=2026-11-26T12:30:00-05:00" # (no weather override: the capture's own)
run() { # <query> <tag> <shots>
  env CAPTURE_ROOT="${ROOT:-dist}" CAPTURE_QUERY="$1" CAPTURE_TAG="${TAGP:-}$2" CAPTURE_VIEWPORT=1600x900 node tools/capture.mjs "$3" || echo "capture $2 failed"
}
for J in $JOB; do
case "$J" in
  state)
    run "?$BASEQ" default- tools/shots/realism-light-state.json
    run "?map=detail&$BASEQ" detailmap- tools/shots/realism-light-state.json ;;
  roofab) # the first restored building under variants, to find what blacks its roof
         for V in "roofs=0" "presets=0" "presets=debug" "skyocc=0" "q.shadows=false"; do run "?$V&$BASEQ" "ab-${V//[=.]/_}-" tools/shots/realism-roof-b1.json; done
         SUM=${BASEQ//2026-11-26/2026-08-22}; run "?${SUM/-05:00/-04:00}" ab-summer- tools/shots/realism-roof-b1.json ;;
  albedo) run "?map=detail&$BASEQ" alb- tools/shots/realism-roof-albedo.json ;;
  roofwinter) W=${BASEQ//2026-11-26/2027-01-15}; run "?${W}" winter- tools/shots/realism-roof-b1.json
         run "?${BASEQ//2026-11-26/2026-10-15}" oct- tools/shots/realism-roof-b1.json ;;
  night) N=${BASEQ/12:30:00/20:30:00}; run "?$N" night- tools/shots/realism-rink.json ;;
  perfb1|perfb2) ROOT=dist-before CAPTURE_METRICS_MS=8000 CAPTURE_UNCAPPED=1 TAGP= run "?$BASEQ" "$J-" tools/shots/realism-perf.json ;; # (dist-before: the build of origin/main; A/B back to back)
  perfa1|perfa2) CAPTURE_METRICS_MS=8000 CAPTURE_UNCAPPED=1 TAGP= run "?$BASEQ" "$J-" tools/shots/realism-perf.json ;;
  roofsummer) run "?${BASEQ//2026-11-26/2026-08-22}" summer- tools/shots/realism-roof-b1.json ;;
  probe) run "?map=detail&$BASEQ" probe- tools/shots/realism-roof-probe.json ;;
  roof)  run "?$BASEQ" roof- tools/shots/road-medians-followup.json ;;
  rink)  run "?$BASEQ" rink- tools/shots/realism-rink.json ;;
  light) run "?$BASEQ" light- tools/shots/realism-light.json
         run "?map=detail&$BASEQ" light-detailmap- tools/shots/realism-light.json ;;
  twilight) # the real sun at 2 degrees (about 16:50 on 26 November) and 30 minutes later, same views as JOB=light
         for T in 16:50 17:20; do run "?${BASEQ/12:30:00/$T:00}" "tw${T/:/}-" tools/shots/realism-light.json; done ;;
  twstate) for T in 12:30 16:50 17:20; do run "?${BASEQ/12:30:00/$T:00}" "tws${T/:/}-" tools/shots/realism-light-state.json; done
         run "?time=twilight&autoscale=0&film&cloudSpeed=0&hud=0&liveWeather=Sunny&liveDate=2026-08-22" twpreset- tools/shots/realism-light-state.json ;;
  lightnat) run "?$NATQ" lightnat- tools/shots/realism-light.json ;;
esac
done
