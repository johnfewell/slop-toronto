#!/bin/sh
# Just the "after" arms of run.sh (the before pictures stand), for re-checks after a tuning change:
#   gpu2 slop-toronto-material-layers -- sh tools/material-layers/run-after.sh
BASE='?quality=high&autoscale=0&cloudSpeed=0&film&hud=0&rocketboxForce=male-adult-04,female-adult-06,business-male-02'
WET="$BASE&liveClock=2026-11-25T22:15:00Z&liveWeather=Rain"
WETNIGHT="$BASE&liveClock=2026-11-26T03:00:00Z&liveWeather=Rain"
run() { # <tag> <query> <shots>
  env CAPTURE_PORT=8802 CAPTURE_CDN_CACHE=1 CAPTURE_SEED=6711 CAPTURE_TAG="$1" CAPTURE_QUERY="$2" \
    CAPTURE_INIT_SCRIPT=tools/material-layers/shot-helper.js node tools/capture.mjs "$3"
}
D=tools/material-layers
run after-wet "$WET" $D/shots-wet.json
run after-night "$BASE" $D/shots-night.json
run after-wetnight "$WETNIGHT" $D/shots-wetnight.json
