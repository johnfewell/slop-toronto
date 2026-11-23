#!/bin/bash
# tools/capture-building-presets-ndw9.sh — st-ndw9.11 captures, on the Mac mini through gpu2 (never the laptop).
#
# Three jobs in one gpu2 session:
#   1. Parity for the default page (?map=detail, no massing) against main: main twice (the RMSE noise floor) and this
#      branch once, desktop and phone, on tools/shots/building-presets-parity.json; each shot logs its request list.
#   2. Parity for ?map=detail&massing=1&presets=0 (the old massing look; since st-ndw9.19 plain ?massing=1 draws the presets) the same way.
#   3. The debug view (?massing=1&presets=debug), desktop, midday: the eight top-down places, the downtown oblique and
#      the four street-level frames with the interface hidden (hud=0), then the top-down set and the oblique again with
#      the legend showing (tools/shots/building-presets-debug.json / -legend.json).
#
# usage (from the worktree, with dist/ built from this branch and dist-main/ from origin/main):
#   GPU2_LOCK_WAIT=1800 ~/.local/bin/gpu2-local r3-proto -- env CAPTURE_PORT=8841 CAPTURE_CDN_CACHE=1 \
#     CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_SEED=6711 CAPTURE_PROGRESS=1 bash tools/capture-building-presets-ndw9.sh
set -u
PARITY=tools/shots/building-presets-parity.json
DEBUG=tools/shots/building-presets-debug.json
DEBUGL=tools/shots/building-presets-debug-legend.json
Q0="?map=detail&autoscale=0&transit=timetable&film&cloudSpeed=0"
Q1="?map=detail&massing=1&presets=0&autoscale=0&transit=timetable&film&cloudSpeed=0"
QD="?map=detail&massing=1&presets=debug&autoscale=0&transit=timetable&film&cloudSpeed=0"
QDH="$QD&hud=0"

run() { # <root> <query> <tag> <viewport> <shots> [extra env...]
  local root=$1 query=$2 tag=$3 vp=$4 shots=$5; shift 5
  echo "=== capture $tag ($root $vp) ==="
  env "$@" CAPTURE_ROOT="$root" CAPTURE_QUERY="$query" CAPTURE_TAG="$tag" CAPTURE_VIEWPORT="$vp" \
    node tools/capture.mjs "$shots" || echo "capture $tag failed (kept whatever it wrote)"
}

# 1. default page parity: main twice (noise floor), branch once, desktop then phone
run dist-main "$Q0" ndw911-def-main-d1 1600x900 "$PARITY"
run dist-main "$Q0" ndw911-def-main-d2 1600x900 "$PARITY"
run dist      "$Q0" ndw911-def-branch-d1 1600x900 "$PARITY"
run dist-main "$Q0" ndw911-def-main-p1 412x915 "$PARITY" CAPTURE_DPR=2.625 CAPTURE_MOBILE=1
run dist-main "$Q0" ndw911-def-main-p2 412x915 "$PARITY" CAPTURE_DPR=2.625 CAPTURE_MOBILE=1
run dist      "$Q0" ndw911-def-branch-p1 412x915 "$PARITY" CAPTURE_DPR=2.625 CAPTURE_MOBILE=1

# 2. ?massing=1&presets=0 parity (the old look; plain ?massing=1 is presets=draw since st-ndw9.19): the same
run dist-main "$Q1" ndw911-mas-main-d1 1600x900 "$PARITY"
run dist-main "$Q1" ndw911-mas-main-d2 1600x900 "$PARITY"
run dist      "$Q1" ndw911-mas-branch-d1 1600x900 "$PARITY"
run dist-main "$Q1" ndw911-mas-main-p1 412x915 "$PARITY" CAPTURE_DPR=2.625 CAPTURE_MOBILE=1
run dist-main "$Q1" ndw911-mas-main-p2 412x915 "$PARITY" CAPTURE_DPR=2.625 CAPTURE_MOBILE=1
run dist      "$Q1" ndw911-mas-branch-p1 412x915 "$PARITY" CAPTURE_DPR=2.625 CAPTURE_MOBILE=1

# 3. the debug view, desktop, midday, interface hidden; then the legend set
run dist "$QDH" ndw911-debug 1600x900 "$DEBUG"
run dist "$QD"  ndw911-debug-legend 1600x900 "$DEBUGL"
echo "=== done ==="
