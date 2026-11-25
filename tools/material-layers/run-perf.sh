#!/bin/sh
# Cost of the physical material layers (jf-rcw): frame times with the layers off (?coat=0) and on, three alternating
# pairs, uncapped (no vsync, so the ms show), and the start-up's shader compile ("[init] ... compile Nms" in each
# run's console log). On the Mac mini, through gpu2: busy-machine numbers are indicative, not budgets.
#   gpu2 slop-toronto-material-layers -- sh tools/material-layers/run-perf.sh
BASE='?quality=high&autoscale=0&cloudSpeed=0&film&hud=0'
WET="$BASE&liveClock=2026-11-25T22:15:00Z&liveWeather=Rain"
D=tools/material-layers
run() { # <tag> <query> <shots>
  env CAPTURE_PORT=8802 CAPTURE_CDN_CACHE=1 CAPTURE_SEED=6711 CAPTURE_UNCAPPED=1 CAPTURE_TAG="$1" CAPTURE_QUERY="$2" \
    CAPTURE_METRICS_MS=8000 CAPTURE_METRICS_WARMUP_MS=2000 CAPTURE_IDLE_CHECK=1 CAPTURE_INIT_SCRIPT=tools/capture-longtasks.js node tools/capture.mjs "$3"
}
for r in 1 2 3; do
  run perf-off-dry-$r "$BASE&coat=0" $D/shots-perf-dry.json
  run perf-on-dry-$r "$BASE" $D/shots-perf-dry.json
  run perf-off-wet-$r "$WET&coat=0" $D/shots-perf-wet.json
  run perf-on-wet-$r "$WET" $D/shots-perf-wet.json
done
