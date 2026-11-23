#!/bin/bash
# tools/capture-ped-gait.sh — st-iq0v.1.1 pedestrian gait before-clips
# Runs on Mac mini via gpu2:
#   gpu2-local <name> -- bash tools/capture-ped-gait.sh
set -e
export CAPTURE_PORT=8851 CAPTURE_ROOT=dist CAPTURE_CDN_CACHE=1 CAPTURE_NAVIGATION_TIMEOUT_MS=180000
export CAPTURE_INIT_SCRIPT=tools/ped-gait-helper.js
OUT="${GPU2_OUT:-capture-out}"

echo "=== Running pedestrian gait captures ==="
node tools/capture.mjs tools/shots/ped-gait.json

echo "=== Extracting gait state logs ==="
node tools/extract-gait-logs.mjs "$OUT"

echo "=== Encoding screencasts to MP4 ==="
node tools/zoo/encode-screencast.mjs --all "$OUT" --rm

echo "=== Done capturing in $OUT ==="
