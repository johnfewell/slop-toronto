#!/bin/bash
# tools/capture-building-presets.sh — st-ndw9.10 captures, on the Mac mini through gpu2 (never the laptop).
#
# Two jobs in one gpu2 session:
#   1. Parity for ?massing=1&presets=0 (the old look; since st-ndw9.19 plain ?massing=1 draws the presets): two runs of the same build (the RMSE noise floor) against one run of
#      the other, desktop and phone, on tools/shots/building-presets-parity.json; each shot also logs its request list
#      (`[requests] ...`) so the two builds' fetch sets can be compared.
#   2. The debug view (?massing=1&presets=debug), desktop, midday, on tools/shots/building-presets-debug.json: the
#      nine places the brief names.
#
# usage (from the worktree, with dist/ built from this branch and dist-main/ from origin/main):
#   gpu2_local=... ; NAME=r3-proto PORT=8841 \
#   $gpu2_local $NAME -- env GPU2_LOCK_WAIT=1800 CAPTURE_PORT=$PORT CAPTURE_CDN_CACHE=1 \
#     CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_SEED=6711 CAPTURE_PROGRESS=1 \
#     bash tools/capture-building-presets.sh
set -u
Q="?map=detail&massing=1&presets=0&autoscale=0&transit=timetable&film&cloudSpeed=0"
QD="?map=detail&massing=1&presets=debug&autoscale=0&transit=timetable&film&cloudSpeed=0"
PARITY=tools/shots/building-presets-parity.json
DEBUG=tools/shots/building-presets-debug.json

run() { # <root> <query> <tag> <viewport> [extra env...]
  local root=$1 query=$2 tag=$3 vp=$4; shift 4
  echo "=== capture $tag ($root $vp) ==="
  env "$@" CAPTURE_ROOT="$root" CAPTURE_QUERY="$query" CAPTURE_TAG="$tag" CAPTURE_VIEWPORT="$vp" \
    node tools/capture.mjs "$SHOTS" || echo "capture $tag failed (kept whatever it wrote)"
}

# 1. desktop parity: main twice (noise floor), branch once
SHOTS=$PARITY
run dist-main "$Q" main-d1 1600x900
run dist-main "$Q" main-d2 1600x900
run dist      "$Q" branch-d1 1600x900
# 2. phone parity
run dist-main "$Q" main-p1 412x915 CAPTURE_DPR=2.625 CAPTURE_MOBILE=1
run dist-main "$Q" main-p2 412x915 CAPTURE_DPR=2.625 CAPTURE_MOBILE=1
run dist      "$Q" branch-p1 412x915 CAPTURE_DPR=2.625 CAPTURE_MOBILE=1
# 3. the debug view, desktop, midday
SHOTS=$DEBUG
run dist "$QD" debug 1600x900
echo "=== done ==="
