#!/bin/sh
# GPU time per pass (timestamp queries, ?gputime=1) with the layers off and on, three alternating pairs:
#   gpu2 slop-toronto-material-layers -- sh tools/material-layers/run-gpu.sh
BASE='?quality=high&autoscale=0&cloudSpeed=0&film&hud=0&gputime=1'
WET="$BASE&liveClock=2026-11-25T22:15:00Z&liveWeather=Rain"
D=tools/material-layers
run() { # <tag> <query> <shots>
  env CAPTURE_PORT=8802 CAPTURE_CDN_CACHE=1 CAPTURE_SEED=6711 CAPTURE_TAG="$1" CAPTURE_QUERY="$2" node tools/capture.mjs "$3"
}
for r in 1 2 3; do
  run gpu-off-dry-$r "$BASE&coat=0" $D/shots-gpu.json
  run gpu-on-dry-$r "$BASE" $D/shots-gpu.json
  run gpu-off-wet-$r "$WET&coat=0" $D/shots-gpu-wet.json
  run gpu-on-wet-$r "$WET" $D/shots-gpu-wet.json
done
