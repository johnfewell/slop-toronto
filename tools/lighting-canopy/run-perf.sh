#!/bin/sh
# Frame times for the lighting work (jf-lbb), uncapped, high tier, at the three places: run from each checkout on the mini,
#   gpu2-local <name> -- sh tools/lighting-canopy/run-perf.sh <tag> <port>
# then draw them: node tools/frame-time-chart.mjs --overlay --label before --label after out.png <before json> <after json>
TAG=${1:-after}; PORT=${2:-8811}
env CAPTURE_PORT=$PORT CAPTURE_CDN_CACHE=1 CAPTURE_UNCAPPED=1 CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_TAG="$TAG" \
  'CAPTURE_QUERY=?quality=high&autoscale=0&cloudSpeed=0&hud=0' node tools/capture.mjs tools/lighting-canopy/shots-frame-times.json
