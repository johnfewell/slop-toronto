#!/bin/bash
# The Rocketbox people's captures (st-jfzf, st-8p1p.3). Run on the Mac mini through gpu2 after `npm run build`:
#   gpu2-local rocketbox -- bash tools/rocketbox/run-trial-captures.sh [views|people|cross|out|perf]
# views: the street crowd at midday and midnight (with the in-game joint self-checks), and a walker walking toward the
#        (`people` frames: ?rocketboxForce=<ids>, debug only, makes the nearest walkers those people: the cop and other women)
#        camera across the switch distance, and one walking away (a fixed camera that only turns to look at it).
#        (`cross` runs only the last two)
# new:   (st-8p1p.3, eighteen people) the crowd frames, the eight new people forced into view, the walking-away crossing;
# twins: the crowd frames only, with and without the twin dodge (?rocketboxTwin=0), for the twin rate
# RBP=<prefix> puts a prefix on the output tags (so an earlier run's files are not overwritten)
# perf:  frame times from one fixed camera, ?rocketbox=0 and the default, three times each, alternating.
Q='?quality=high&autoscale=0&transit=timetable&cloudSpeed=0'
export CAPTURE_PORT=5547 CAPTURE_ROOT=dist CAPTURE_CDN_CACHE=1 CAPTURE_NAVIGATION_TIMEOUT_MS=180000 CAPTURE_SEED=6711
export CAPTURE_INIT_SCRIPT=tools/rocketbox/shot-helper.js
run() { # tag, query, shot list
  CAPTURE_TAG=$RBP$1 CAPTURE_QUERY=$2 timeout 300 node tools/capture.mjs "$3" 2>&1 | grep -E "\[capture\]|\[metrics\]|rocketbox\]|\[error\].*(rocketbox|ktx|basis|glb)" | cut -c1-300
}
mode=${1:-views}
if [ "$mode" = perf ]; then
  :
elif [ "$mode" = new ]; then
  run crowd- "$Q&rocketboxChecks=1" tools/shots/rocketbox-crowd.json
  run peopleC- "$Q&rocketboxForce=business-female-01,sports-female-02,female-adult-17,male-adult-15,male-adult-04" tools/shots/rocketbox-people-c.json
  run peopleD- "$Q&rocketboxForce=business-male-02,male-adult-08,business-male-04,female-adult-17" tools/shots/rocketbox-people-d.json
elif [ "$mode" = new2 ]; then
  run peopleE- "$Q&rocketboxNear=60&rocketboxForce=sports-female-02,male-adult-04,business-male-02" tools/shots/rocketbox-people-e.json
  run peopleF- "$Q&rocketboxNear=60&rocketboxForce=male-adult-08,business-male-04,business-female-01" tools/shots/rocketbox-people-f.json
  run peopleG- "$Q&rocketboxNear=60&rocketboxForce=male-adult-15" tools/shots/rocketbox-people-g.json
elif [ "$mode" = solo ]; then
  run solo0- "$Q&rocketboxNear=60&rocketboxForce=business-female-01" tools/shots/rocketbox-solo-business-female-01.json
  run solo1- "$Q&rocketboxNear=60&rocketboxForce=sports-female-02" tools/shots/rocketbox-solo-sports-female-02.json
  run solo2- "$Q&rocketboxNear=60&rocketboxForce=female-adult-17" tools/shots/rocketbox-solo-female-adult-17.json
  run solo3- "$Q&rocketboxNear=60&rocketboxForce=male-adult-04" tools/shots/rocketbox-solo-male-adult-04.json
  run solo4- "$Q&rocketboxNear=60&rocketboxForce=business-male-02" tools/shots/rocketbox-solo-business-male-02.json
  run solo5- "$Q&rocketboxNear=60&rocketboxForce=male-adult-08" tools/shots/rocketbox-solo-male-adult-08.json
  run solo6- "$Q&rocketboxNear=60&rocketboxForce=business-male-04" tools/shots/rocketbox-solo-business-male-04.json
elif [ "$mode" = solo2 ]; then
  run solo4- "$Q&rocketboxNear=60&rocketboxForce=business-male-02" tools/shots/rocketbox-solo-business-male-02.json
  run solo5- "$Q&rocketboxNear=60&rocketboxForce=male-adult-08" tools/shots/rocketbox-solo-male-adult-08.json
elif [ "$mode" = twins ]; then
  for r in 1 2 3; do
    run twin$r- "$Q" tools/shots/rocketbox-crowd.json
    run notwin$r- "$Q&rocketboxTwin=0" tools/shots/rocketbox-crowd.json
  done
elif [ "$mode" = out2 ]; then
  run out- "$Q" tools/shots/rocketbox-cross-out.json
elif [ "$mode" = away ]; then
  run away- "$Q" tools/shots/rocketbox-away.json
  run away2- "$Q" tools/shots/rocketbox-away.json
else
  if [ "$mode" = views ]; then run crowd- "$Q&rocketboxChecks=1" tools/shots/rocketbox-crowd.json; fi
  if [ "$mode" = views ] || [ "$mode" = people ]; then
    run peopleA- "$Q&rocketboxForce=police-male-03,female-adult-08" tools/shots/rocketbox-people-a.json
    run peopleB- "$Q&rocketboxForce=female-adult-06,business-female-03,male-adult-03" tools/shots/rocketbox-people-b.json
  fi
  if [ "$mode" = views ] || [ "$mode" = cross ]; then run in- "$Q" tools/shots/rocketbox-cross-in.json; fi
  if [ "$mode" = views ] || [ "$mode" = cross ] || [ "$mode" = out ]; then run out- "$Q" tools/shots/rocketbox-cross-out.json; fi
fi
if [ "$mode" = perf ]; then
  export CAPTURE_UNCAPPED=1 CAPTURE_METRICS_MS=8000 CAPTURE_METRICS_WARMUP_MS=2000
  for r in 1 2 3; do
    run perf-off-r$r- "$Q&rocketbox=0" tools/shots/rocketbox-perf.json
    run perf-default-r$r- "$Q" tools/shots/rocketbox-perf.json
  done
fi
