#!/bin/bash
# tools/capture-rosedale-streetscape.sh (jf-qw7; docs/rosedale-streetscape.md): the Rosedale streetscape captures on the Mac mini through gpu2. Every arm is a build of the page; the arms differ by build and date:
#   before* origin/main's build, in dist-before/ (npm run build in a worktree of origin/main, copied here)      after* this branch's build, dist/
#   *Fall   22 October 2026, overcast, autumn leaves (John's Chestnut Park photo is of 22 October 2020)       *Snow   22 November 2026 with 6 cm of snow (his second photo is 22 November 2020)
#   *Bare   today's date in the shot list's own dates: 26 November, bare trees, no snow                       *Jul    15 July (summer)
# SHOTS=<file> the shot list (default tools/shots/rosedale-streetscape.json); FT_SECONDS the length of a frame-time recording (default 20)
# usage: GPU2_LOCK_WAIT=3600 ~/.local/bin/gpu2-local rosedale-streetscape -- env CAPTURE_PORT=8881 CAPTURE_CDN_CACHE=1 CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_SEED=6711 SHOTS=tools/shots/rosedale-streetscape.json ARMS="beforeFall afterFall" bash tools/capture-rosedale-streetscape.sh
set -u
BASE="autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0"
FALL="$BASE&liveWeather=Cloudy&liveDate=2026-10-22&liveClock=2026-10-22T11:30:00-04:00&liveSnow=0"
SNOW="$BASE&liveWeather=Cloudy&liveDate=2026-11-22&liveClock=2026-11-22T10:30:00-05:00&liveSnow=6"
BARE="$BASE&liveWeather=Sunny&liveDate=2026-11-26&liveClock=2026-11-26T12:30:00-05:00"
JUL="$BASE&liveWeather=Sunny&liveDate=2026-07-15&liveClock=2026-07-15T12:30:00-04:00&liveSnow=0"
run() { # <root> <query> <tag> <shots> [extra env...]
  local root=$1 query=$2 tag=$3 shots=$4; shift 4
  echo "=== capture $tag ($root $query) ==="
  env "$@" CAPTURE_ROOT="$root" CAPTURE_QUERY="$query" CAPTURE_TAG="$tag" CAPTURE_VIEWPORT=1600x900 CAPTURE_REQUEST_LOG=1 \
    node tools/capture.mjs "$shots" || echo "capture $tag failed (kept whatever it wrote)"
}
for ARM in ${ARMS:-beforeFall afterFall}; do
  case "$ARM" in before*) ROOTD=dist-before ;; *) ROOTD=dist ;; esac
  case "$ARM" in *Fall) Q="?$FALL" ;; *Snow) Q="?$SNOW" ;; *Bare) Q="?$BARE" ;; *Jul) Q="?$JUL" ;; *) echo "unknown arm $ARM"; continue ;; esac
  if [ "${FT:-0}" = "1" ]; then
    run "$ROOTD" "$Q" "ft${ROUND:-}-$ARM-" "${SHOTS:-tools/shots/rosedale-streetscape-frame-times.json}" CAPTURE_UNCAPPED=1 CAPTURE_FT_SECONDS=${FT_SECONDS:-20}
  else
    run "$ROOTD" "$Q" "$ARM-" "${SHOTS:-tools/shots/rosedale-streetscape-3.json}"
  fi
done
