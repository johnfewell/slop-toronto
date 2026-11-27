#!/bin/sh
# Before/after captures of the lighting work in jf-lbb's "next" list (the ground, trees and landmarks in the sky occlusion's
# height map, and the bounce's colour), run on the Mac mini from each checkout:
#   gpu2-local <name> -- sh tools/lighting-canopy/run.sh <tag> <port>
# The presets are the classic summer day (22 August: the trees in leaf); the live runs fix the clock and the weather
# (a capture fixture) on 26 November, the trees bare: a clear noon and an overcast afternoon.
TAG=${1:-after}; PORT=${2:-8811}
BASE='?quality=high&autoscale=0&cloudSpeed=0&film&hud=0'
D=tools/lighting-canopy
run() { # <tag> <query> <shots>
  env CAPTURE_PORT=$PORT CAPTURE_CDN_CACHE=1 CAPTURE_SEED=6711 CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_TAG="$1" CAPTURE_QUERY="$2" node tools/capture.mjs "$3"
}
run "$TAG-presets" "$BASE" $D/shots-presets.json
run "$TAG-clear" "$BASE&liveClock=2026-11-26T17:00:00Z&liveWeather=Sunny&liveDate=2026-11-26" $D/shots-live.json
run "$TAG-overcast" "$BASE&liveClock=2026-11-26T20:00:00Z&liveWeather=Overcast&liveDate=2026-11-26" $D/shots-live.json
run "$TAG-summer-overcast" "$BASE&liveClock=2026-07-15T18:00:00Z&liveWeather=Overcast&liveDate=2026-07-15" $D/shots-live.json
