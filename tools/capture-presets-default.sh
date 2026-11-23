#!/bin/bash
# tools/capture-presets-default.sh — st-ndw9.19 captures, on the Mac mini through gpu2 (never the laptop).
# ?massing=1 with no presets parameter shows the drawn presets; ?massing=1&presets=0 is the old massing look.
# Since st-ndw9.21 the default desktop page (the bigger map) draws them downtown too (?presets=0 is the old look): its `def` and `mas`
# parity arms then differ from a main without that change by the sidecar and presets files; see tools/capture-drawn-default.sh.
# One job a call (the mini takes one at a time): JOB = parity | cost | costphone | costu | costuphone | bytes | frames
#   parity     request lists and frames for the default page and the old looks: main twice, this branch twice, alternating
#   cost       ?map=detail&massing=1&presets=0 (A) against ?map=detail&massing=1 (B): five alternating pairs, desktop, on
#              tools/shots/presets-default-cost.json (frame time windows, draw calls, triangles, bytes fetched, time to ready)
#   costphone  the same on the phone tier
#   frames     what the new default looks like (and the old look beside it), desktop
#
# usage (from the worktree, with dist/ built from this branch and dist-main/ from origin/main):
#   GPU2_LOCK_WAIT=3600 ~/.local/bin/gpu2-local r3-fence -- env CAPTURE_PORT=8843 CAPTURE_CDN_CACHE=1 \
#     CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_SEED=6711 CAPTURE_PROGRESS=1 JOB=parity TAG=q1- bash tools/capture-presets-default.sh
set -u
TAG=${TAG:-q-}
SH=tools/shots
BASEQ="autoscale=0&transit=timetable&film&cloudSpeed=0"
PH="CAPTURE_DPR=2.625 CAPTURE_MOBILE=1"
RB="CAPTURE_INIT_SCRIPT=tools/capture-resource-buffer.js CAPTURE_REQUEST_LOG=1" # (the page's resource-timing buffer is not a complete request list: CAPTURE_REQUEST_LOG writes the server's, <tag>requests.json)
run() { # <root> <query> <tag> <viewport> <shots> [extra env...]
  local root=$1 query=$2 tag=$3 vp=$4 shots=$5; shift 5
  echo "=== capture $tag ($root $vp $shots) ==="
  env "$@" CAPTURE_ROOT="$root" CAPTURE_QUERY="$query" CAPTURE_TAG="$tag" CAPTURE_VIEWPORT="$vp" \
    node tools/capture.mjs "$shots" || echo "capture $tag failed (kept whatever it wrote)"
}
for J in $JOB; do
case "$J" in
  parity)
    # (main and the branch alternate, twice each: the noise floor is main against main)
    for spec in "def:?$BASEQ" "defd:?map=detail&$BASEQ" "mas:?massing=1&$BASEQ" "masd:?map=detail&massing=1&$BASEQ"; do
      t=${spec%%:*}; q=${spec#*:}
      for i in 1 2; do
        run dist-main "$q" "${TAG}${t}-M${i}d-" 1600x900 $SH/building-presets-parity.json $RB
        run dist      "$q" "${TAG}${t}-B${i}d-" 1600x900 $SH/building-presets-parity.json $RB
      done
    done
    for spec in "def:?$BASEQ" "mas:?map=detail&massing=1&$BASEQ"; do
      t=${spec%%:*}; q=${spec#*:}
      for i in 1 2; do
        run dist-main "$q" "${TAG}${t}-M${i}p-" 412x915 $SH/building-presets-parity.json $RB $PH
        run dist      "$q" "${TAG}${t}-B${i}p-" 412x915 $SH/building-presets-parity.json $RB $PH
      done
    done
    # the old look on this branch (presets=0) against main's plain ?map=detail&massing=1
    for i in 1 2; do
      run dist-main "?map=detail&massing=1&$BASEQ"           "${TAG}old-M${i}d-" 1600x900 $SH/building-presets-parity.json $RB
      run dist      "?map=detail&massing=1&presets=0&$BASEQ" "${TAG}old-B${i}d-" 1600x900 $SH/building-presets-parity.json $RB
    done ;;
  cost)
    for i in 1 2 3 4 5; do
      run dist "?map=detail&massing=1&presets=0&$BASEQ&hud=0" "${TAG}A${i}d-" 1600x900 $SH/presets-default-cost.json CAPTURE_METRICS_MS=6000 $RB
      run dist "?map=detail&massing=1&$BASEQ&hud=0"           "${TAG}B${i}d-" 1600x900 $SH/presets-default-cost.json CAPTURE_METRICS_MS=6000 $RB
    done ;;
  costphone)
    for i in 1 2 3 4 5; do
      run dist "?map=detail&massing=1&presets=0&$BASEQ&hud=0" "${TAG}A${i}p-" 412x915 $SH/presets-default-cost.json CAPTURE_METRICS_MS=6000 $RB $PH
      run dist "?map=detail&massing=1&$BASEQ&hud=0"           "${TAG}B${i}p-" 412x915 $SH/presets-default-cost.json CAPTURE_METRICS_MS=6000 $RB $PH
    done ;;
  costu|costuphone)
    # (the same pairs with the vsync and frame cap lifted: a window that sits at 16.7 ms every run says nothing about the cost)
    vp=1600x900; sfx=d; extra=""; [ "$J" = costuphone ] && { vp=412x915; sfx=p; extra="$PH"; }
    for i in 1 2 3 4 5; do
      run dist "?map=detail&massing=1&presets=0&$BASEQ&hud=0" "${TAG}A${i}${sfx}-" $vp $SH/presets-default-cost.json CAPTURE_METRICS_MS=6000 CAPTURE_UNCAPPED=1 $RB $extra
      run dist "?map=detail&massing=1&$BASEQ&hud=0"           "${TAG}B${i}${sfx}-" $vp $SH/presets-default-cost.json CAPTURE_METRICS_MS=6000 CAPTURE_UNCAPPED=1 $RB $extra
    done ;;
  bytes)
    # (what a load fetches: three alternating pairs, desktop then phone, one shot that sums the resource list)
    for i in 1 2 3; do
      run dist "?map=detail&massing=1&presets=0&$BASEQ&hud=0" "${TAG}A${i}d-" 1600x900 $SH/presets-default-bytes.json $RB
      run dist "?map=detail&massing=1&$BASEQ&hud=0"           "${TAG}B${i}d-" 1600x900 $SH/presets-default-bytes.json $RB
    done
    for i in 1 2 3; do
      run dist "?map=detail&massing=1&presets=0&$BASEQ&hud=0" "${TAG}A${i}p-" 412x915 $SH/presets-default-bytes.json $RB $PH
      run dist "?map=detail&massing=1&$BASEQ&hud=0"           "${TAG}B${i}p-" 412x915 $SH/presets-default-bytes.json $RB $PH
    done ;;
  frames)
    run dist "?map=detail&massing=1&presets=0&$BASEQ&hud=0" "${TAG}old-" 1600x900 $SH/presets-default-frames.json
    run dist "?map=detail&massing=1&$BASEQ&hud=0"           "${TAG}new-" 1600x900 $SH/presets-default-frames.json ;;
  *) echo "unknown JOB $J"; exit 2 ;;
esac
done
echo "=== done $JOB ==="
