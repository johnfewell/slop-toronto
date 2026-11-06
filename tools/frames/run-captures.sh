#!/bin/bash
# tools/frames/run-captures.sh — the map-scale captures (docs/map-scale-measurements.md), run on the Mac mini through
# gpu2 from the worktree root after `npm run build` and copying each frame's files into dist/frames/<name>/:
#   gpu2 <name> -- env CAPTURE_PORT=<port> bash tools/frames/run-captures.sh [frames...] [--reps N] [--tiers "high low"]
# Frames: detail (today's data), and any built frame (eglinton, city). Each frame x tier x repetition is one fresh
# browser (tools/capture.mjs: load, then the views of tools/shots/map-scale*.json with a frame-time window each).
# Desktop is ?quality=high at 1600x900; phone is ?quality=low at 412x915 with touch (the Mini, not a phone).
set -u
frames=() reps=1 tiers="high low"
while [ $# -gt 0 ]; do
  case "$1" in
    --reps) reps=$2; shift 2 ;;
    --tiers) tiers=$2; shift 2 ;;
    *) frames+=("$1"); shift ;;
  esac
done
[ ${#frames[@]} -gt 0 ] || frames=(detail eglinton city)
export CAPTURE_ROOT=dist CAPTURE_CDN_CACHE=1 CAPTURE_NAVIGATION_TIMEOUT_MS=${CAPTURE_NAVIGATION_TIMEOUT_MS:-180000}
export CAPTURE_METRICS_MS=${CAPTURE_METRICS_MS:-6000} CAPTURE_METRICS_WARMUP_MS=${CAPTURE_METRICS_WARMUP_MS:-2000}
export CAPTURE_IDLE_CHECK=1 CAPTURE_SEED=6711 CAPTURE_PROGRESS=1 CAPTURE_INIT_SCRIPT=tools/frames/ready-clock.js
out=${GPU2_OUT:-capture-out}
mkdir -p "$out"
first=${REP_START:-1}  # (REP_START=2: a later repetition keeps its own tags)
for rep in $(seq "$first" $(( first + reps - 1 ))); do
  for tier in $tiers; do
    for f in "${frames[@]}"; do
      q="?quality=$tier&autoscale=0&transit=timetable&cloudSpeed=0&memlog=1"
      [ "$f" = detail ] || q="$q&frame=$f"
      shots=tools/shots/map-scale.json
      [ "$f" = city ] && shots=tools/shots/map-scale-city.json
      tag="$f-$tier-r$rep"
      if [ "$tier" = low ]; then vp=412x915 mobile=1; else vp=1600x900 mobile=; fi
      echo "=== $tag $(date +%T)"
      t0=$(date +%s)
      for attempt in $(seq 1 "${CAPTURE_ATTEMPTS:-2}"); do
        # (a hard limit: a browser that does not close must not hold the mini's lock)
        env CAPTURE_TAG="$tag" CAPTURE_QUERY="$q" CAPTURE_VIEWPORT=$vp ${mobile:+CAPTURE_MOBILE=1} CAPTURE_READY_TIMEOUT_MS=600000 \
          perl -e 'alarm shift; exec @ARGV' "${CAPTURE_HARD_LIMIT_S:-1200}" node tools/capture.mjs "$shots" > "$out/$tag-run.log" 2>&1 && break
        echo "--- $tag attempt $attempt failed: $(tail -3 "$out/$tag-run.log" | tr '\n' ' ')"
      done
      echo "=== $tag done in $(( $(date +%s) - t0 )) s: $(grep -c '^\[metrics\]' "$out/$tag-console.log" 2>/dev/null) windows"
    done
  done
done
