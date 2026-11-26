#!/bin/bash
# tools/capture-biidaasige-lighting.sh (st-bmyv.10): the park's lighting shots on the Mac mini through gpu2-local.
# dist-main/ is a build of origin/main, dist/ a build of this branch.
#   JOB=shots   the guidepost at midday, twilight and midnight, the probe and a midnight park view, late November and summer
#   JOB=metrics  as frames, with CAPTURE_METRICS_MS=8000 in the environment (frame time p50/p95 per shot)
#   JOB=frames  alternating before/after frame-time runs at the park (A/B pairs back to back)
# usage: GPU2_LOCK_WAIT=1800 ~/.local/bin/gpu2-local biidaasige-lighting -- env CAPTURE_PORT=8861 CAPTURE_CDN_CACHE=1 \
#   CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_SEED=6711 JOB=shots bash tools/capture-biidaasige-lighting.sh
set -u
BASEQ="autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0"
run() { # <root> <query> <tag> <shots>
  env CAPTURE_ROOT="$1" CAPTURE_QUERY="$2" CAPTURE_TAG="$3" CAPTURE_VIEWPORT=1600x900 node tools/capture.mjs "$4" || echo "capture $3 failed"
}
for J in $JOB; do
case "$J" in
  shots)
    run dist "?liveDate=2026-11-26&liveClock=2026-11-26T17:00:00Z&$BASEQ" nov- tools/shots/biidaasige-lighting.json
    run dist "?liveDate=2026-07-15&liveClock=2026-07-15T17:00:00Z&$BASEQ" jul- tools/shots/biidaasige-lighting.json ;;
  frames)
    for i in 1 2 3; do
      run dist-main "?liveDate=2026-11-26&liveClock=2026-11-26T17:00:00Z&$BASEQ" "fr${i}-before-" tools/shots/biidaasige-lighting.json
      run dist "?liveDate=2026-11-26&liveClock=2026-11-26T17:00:00Z&$BASEQ" "fr${i}-after-" tools/shots/biidaasige-lighting.json
    done ;;
  metrics)
    for i in 1 2 3; do
      run dist-main "?liveDate=2026-11-26&liveClock=2026-11-26T17:00:00Z&$BASEQ" "m${i}-before-" tools/shots/biidaasige-lighting-frame.json
      run dist "?liveDate=2026-11-26&liveClock=2026-11-26T17:00:00Z&$BASEQ" "m${i}-after-" tools/shots/biidaasige-lighting-frame.json
    done ;;
  season)
    # live mode (no preset): a preset is always summer, so the real late-November trees need ?liveClock= and ?liveDate=
    for c in "midday 2026-11-26T17:00:00Z" "twilight 2026-11-26T21:50:00Z" "midnight 2026-11-27T05:00:00Z"; do
      set -- $c
      run dist "?liveDate=2026-11-26&liveClock=$2&liveWeather=Sunny&$BASEQ" "live-nov-$1-" tools/shots/biidaasige-lighting-live.json
    done
    run dist "?liveDate=2026-07-15&liveClock=2026-07-15T17:00:00Z&liveWeather=Sunny&$BASEQ" "live-jul-midday-" tools/shots/biidaasige-lighting-live.json ;;
esac
done
