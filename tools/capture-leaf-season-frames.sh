#!/bin/bash
# tools/capture-leaf-season-frames.sh (jf-qax): paired street-level frame times, before (dist-before/) and after (dist/), alternating, 2 rounds
set -u
Q="?autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0&liveWeather=Sunny&liveDate=2026-11-28&liveClock=2026-11-28T12:30:00-05:00&liveSnow=0"
for R in 1 2; do for ARM in before after; do
  ROOTD=dist; [ "$ARM" = before ] && ROOTD=dist-before
  env CAPTURE_ROOT="$ROOTD" CAPTURE_QUERY="$Q" CAPTURE_TAG="ft-$ARM-$R-" CAPTURE_VIEWPORT=1600x900 CAPTURE_UNCAPPED=1 node tools/capture.mjs tools/shots/rosedale-streetscape-frame-times.json || echo "failed $ARM $R"
done; done
