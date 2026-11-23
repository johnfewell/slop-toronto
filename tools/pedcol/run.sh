#!/bin/bash
# Pedestrian collision / curb group captures (st-iqsg). Run on the Mac mini through gpu2 after `npm run build`:
#   gpu2-local pedcol -- bash tools/pedcol/run.sh <corner|stepoff|pair|player|overlap|perf>
# Each mode runs the same shots with ?pedcrowd=0 (as before this change, tag before-) and the default (tag after-).
# perf: frame times from one fixed camera at high quality: the built main (dist-main) and this branch (dist), three
#       times each, alternating. CAPTURE_SOURCE_REVISION tags each report.
Q='?quality=high&autoscale=0&transit=timetable&cloudSpeed=0&pedoverlap=1&pedfull=1'
export CAPTURE_PORT=5561 CAPTURE_ROOT=dist CAPTURE_CDN_CACHE=1 CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_SEED=6711
export CAPTURE_INIT_SCRIPT=tools/pedcol/shot-helper.js
run() { # tag, query, shot list, [root]
  CAPTURE_TAG=$1 CAPTURE_QUERY=$2 CAPTURE_ROOT=${4:-dist} timeout 420 node tools/capture.mjs "$3" 2>&1 | grep -E "\[capture\]|\[metrics\]|error|failed|Error" | cut -c1-400
}
mode=${1:-corner}
case $mode in
  perf)
    export CAPTURE_UNCAPPED=1 CAPTURE_METRICS_MS=15000 CAPTURE_METRICS_WARMUP_MS=2000
    Q='?quality=high&autoscale=0&transit=timetable&cloudSpeed=0' # (the default settings: no ?pedfull, no counter)
    for r in 1 2 3; do
      run main-r$r- "$Q" tools/pedcol/fixed.json dist-main
      run branch-r$r- "$Q" tools/pedcol/fixed.json dist
      run off-r$r- "$Q&pedcrowd=0" tools/pedcol/fixed.json dist
    done ;;
  *)
    run before- "$Q&pedcrowd=0" tools/pedcol/$mode.json
    run after- "$Q" tools/pedcol/$mode.json ;;
esac
