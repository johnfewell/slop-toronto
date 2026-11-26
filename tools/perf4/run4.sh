#!/bin/bash
# tools/perf4/run4.sh: ground-cost jobs on the Mac mini through gpu2 (st-aeg2.4). JOBS="inv arms ..." with per job env after @ (NAME=value,NAME=value; + is a space, ; separates arms inside ARMS)
# usage: GPU2_LOCK_WAIT=7200 ~/.local/bin/gpu2-local r3-fence -- env CAPTURE_ROOT=dist-main CAPTURE_PORT=8843 CAPTURE_CDN_CACHE=1 CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_UNCAPPED=1 CAPTURE_METRICS_MS=1 TAG=g4- JOBS="inv@PLACES=cab" bash tools/perf4/run4.sh
set -u
TAG=${TAG:-g4-}
BASEQ="autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0"
OUT=${GPU2_OUT:-capture-out}
mkdir -p "$OUT"
for SPEC in $JOBS; do
  J=${SPEC%%@*}; ENVS=""; [ "$J" != "$SPEC" ] && ENVS=${SPEC#*@}
  JENV=(); SUF=""
  for kv in ${ENVS//,/ }; do v=${kv#*=}; v=${v//;/,}; JENV+=("${kv%%=*}=${v//+/ }"); [ "${kv%%=*}" = ID ] && SUF="-$v"; done
  Q2=${QUERY:-}; for kv in "${JENV[@]:-}"; do [ "${kv%%=*}" = Q ] && Q2=${kv#*=}; done; Q2=${Q2//%26/&}
  echo "=== job $J$SUF $(date +%T) ==="
  env "${JENV[@]:-X=1}" node tools/perf4/make4.mjs "$J" > "$OUT/${TAG}${J}$SUF-shots.json" || { echo "no shots"; continue; }
  env CAPTURE_QUERY="?${Q2}${Q2:+&}$BASEQ" CAPTURE_TAG="${TAG}${J}$SUF" CAPTURE_VIEWPORT=1600x900 node tools/capture.mjs "$OUT/${TAG}${J}$SUF-shots.json" || echo "job $J$SUF failed (kept whatever it wrote)"
done
echo "=== done $(date +%T) ==="
