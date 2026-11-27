#!/bin/sh
# The medium tier (the sky occlusion's coloured bounce at 6 slices x 8 steps) and the phone profile (the pass off: the
# materials keep the height function) with the lighting work, on the mini: gpu2-local <name> -- sh tools/lighting-canopy/run-tiers.sh <tag> <port>
TAG=${1:-tiers}; PORT=${2:-8813}
env CAPTURE_PORT=$PORT CAPTURE_CDN_CACHE=1 CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_TAG="$TAG-medium" 'CAPTURE_QUERY=?quality=medium&autoscale=0&cloudSpeed=0&hud=0' node tools/capture.mjs tools/lighting-canopy/shots-tiers.json
env CAPTURE_PORT=$PORT CAPTURE_CDN_CACHE=1 CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_VIEWPORT=412x915 CAPTURE_DPR=2.625 CAPTURE_MOBILE=1 CAPTURE_CPU_THROTTLE=4 CAPTURE_TAG="$TAG-phone" 'CAPTURE_QUERY=?quality=low&autoscale=0&hud=0' node tools/capture.mjs tools/lighting-canopy/shots-tiers.json
