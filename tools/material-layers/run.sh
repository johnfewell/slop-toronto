#!/bin/sh
# Before/after captures of the physical material layers (jf-rcw), run on the Mac mini:
#   gpu2 slop-toronto-material-layers -- sh tools/material-layers/run.sh
# "before" is ?coat=0 (the materials as they were), "after" the default. The wet shots force the weather (a capture
# fixture: Toronto time 17:15 on 25 November, ECCC condition "Rain"; the wet night 22:00 that evening); the dry ones are
# the time-of-day presets.
# (rocketboxForce: the same three people in every run, so the sheen is compared on the same clothes)
BASE='?quality=high&autoscale=0&cloudSpeed=0&film&hud=0&rocketboxForce=male-adult-04,female-adult-06,business-male-02'
WET="$BASE&liveClock=2026-11-25T22:15:00Z&liveWeather=Rain"
WETNIGHT="$BASE&liveClock=2026-11-26T03:00:00Z&liveWeather=Rain"
run() { # <tag> <query> <shots>
  env CAPTURE_PORT=8802 CAPTURE_CDN_CACHE=1 CAPTURE_SEED=6711 CAPTURE_TAG="$1" CAPTURE_QUERY="$2" \
    CAPTURE_INIT_SCRIPT=tools/material-layers/shot-helper.js node tools/capture.mjs "$3"
}
D=tools/material-layers
run before-dry "$BASE&coat=0" $D/shots-dry.json
run after-dry "$BASE" $D/shots-dry.json
run before-wet "$WET&coat=0" $D/shots-wet.json
run after-wet "$WET" $D/shots-wet.json
run before-night "$BASE&coat=0" $D/shots-night.json
run after-night "$BASE" $D/shots-night.json
run before-wetnight "$WETNIGHT&coat=0" $D/shots-wetnight.json
run after-wetnight "$WETNIGHT" $D/shots-wetnight.json

