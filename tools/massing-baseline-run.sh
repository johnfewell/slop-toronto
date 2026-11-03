#!/bin/bash
# tools/massing-baseline-run.sh — one run of the ?massing=1 matched idle baseline, ON THE MAC MINI inside gpu2
# (tools/massing-baseline.sh starts it; docs/massing-buildings.md "Matched idle baseline"). Read-only host observations
# before and after the capture, never stopping anything: the busiest processes, whole-machine CPU idle, the GPU's
# utilization, browser processes and listening ports, into $GPU2_OUT/<tag>-host-{before,after}.txt.
# usage (inside gpu2's env): CAPTURE_TAG=<tag> ... bash tools/massing-baseline-run.sh <shots.json>
set -u
tag=${CAPTURE_TAG:?CAPTURE_TAG}
out=${GPU2_OUT:-gpu2-out}
mkdir -p "$out"
observe() {
  {
    echo "# $tag $1 $(date -u +%FT%TZ) on $(hostname)"
    echo "## top (whole machine)"; top -l 2 -n 0 -s 1 2>/dev/null | grep -E '^(CPU usage|Load Avg|PhysMem)' | tail -3
    echo "## busiest processes"; ps -axo pid=,ppid=,%cpu=,%mem=,etime=,comm= | sort -k3 -nr | head -25
    echo "## GPU (IOAccelerator)"; ioreg -r -c IOAccelerator -d 1 2>/dev/null | grep -oE '"(Device|Renderer|Tiler) Utilization %"=[0-9]+' | sort -u
    echo "## browsers and capture servers"; ps -axo pid=,%cpu=,comm= | grep -iE 'chrom|safari|webkit|whisper|franken|node' | grep -v grep
    echo "## listening ports"; lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR > 1 { print $1, $2, $9 }' | sort -u
  } > "$out/$tag-host-$1.txt" 2>&1
}
observe before
node tools/capture.mjs "$@"
rc=$?
observe after
exit $rc
