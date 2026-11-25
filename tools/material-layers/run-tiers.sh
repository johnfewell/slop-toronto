#!/bin/sh
# The other tiers with the layers on (medium: the coat reflects the environment only, no SSR) and the phone tier (low:
# layers off, the old materials), to check they draw & log no errors; then medium with the layers off, the control for
# any error the first run logs:
#   gpu2 slop-toronto-material-layers -- sh tools/material-layers/run-tiers.sh
D=tools/material-layers
run() { # <tag> <query>
  env CAPTURE_PORT=8802 CAPTURE_CDN_CACHE=1 CAPTURE_SEED=6711 CAPTURE_TAG="$1" CAPTURE_QUERY="$2&autoscale=0&cloudSpeed=0&film&hud=0" \
    CAPTURE_INIT_SCRIPT=$D/shot-helper.js node tools/capture.mjs $D/shots-tiers.json
}
run tier-medium '?quality=medium'
run tier-low '?quality=low'
run tier-medium-off '?quality=medium&coat=0'
