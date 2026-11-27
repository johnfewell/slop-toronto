#!/bin/bash
# tools/perf1/run.sh: the desktop frame census (st-aeg2), on the Mac mini through gpu2 (never the laptop).
# usage (from the worktree, dist/ built):
#   GPU2_LOCK_WAIT=7200 ~/.local/bin/gpu2-local r3-fence -- env CAPTURE_ROOT=dist CAPTURE_PORT=8843 CAPTURE_CDN_CACHE=1 \
#     CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_UNCAPPED=1 CAPTURE_METRICS_MS=1 CAPTURE_SHOT_PROFILE=1 \
#     JOB="disc arms@PLACES=cab+qwa" TAG=p1- bash tools/perf1/run.sh
# JOB: space separated list of tools/perf1/make.mjs jobs, each optionally followed by @NAME=value,NAME=value (the job's environment;
# a space in a value is written +). QUERY: extra query (default: the other captures' base query), per job @QUERY=a=1 is not
# possible (use & inside the job as %26). Each job writes <TAG><job>-<place>.json (the probe's record), a screenshot and the
# console log; a profile job writes <TAG><name>-profile.txt (self time) and -profile-inclusive.txt.
set -u
TAG=${TAG:-p1-}
BASEQ="autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0"
OUT=${GPU2_OUT:-capture-out}
mkdir -p "$OUT"
for SPEC in $JOB; do
  J=${SPEC%%@*}; ENVS=""
  [ "$J" != "$SPEC" ] && ENVS=${SPEC#*@}
  JENV=(); SUF=""
  for kv in ${ENVS//,/ }; do v=${kv#*=}; JENV+=("${kv%%=*}=${v//+/ }"); SUF="$SUF-${v//[^A-Za-z0-9]/_}"; done
  Q2=${QUERY:-}; for kv in "${JENV[@]:-}"; do [ "${kv%%=*}" = Q ] && Q2=${kv#*=}; done
  Q2=${Q2//%26/&}
  echo "=== job $J$SUF $(date +%T) ==="
  env "${JENV[@]:-X=1}" node tools/perf1/make.mjs "$J" > "$OUT/${TAG}${J}$SUF-shots.json" || { echo "job $J$SUF: no shots"; continue; }
  env "${JENV[@]:-X=1}" CAPTURE_QUERY="?${Q2}${Q2:+&}$BASEQ" CAPTURE_TAG="${TAG}${J}$SUF" CAPTURE_VIEWPORT="${CAPTURE_VIEWPORT:-1600x900}" \
    node tools/capture.mjs "$OUT/${TAG}${J}$SUF-shots.json" || echo "job $J$SUF failed (kept whatever it wrote)"
done
echo "=== done $JOB $(date +%T) ==="
