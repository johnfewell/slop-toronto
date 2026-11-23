#!/bin/bash
# tools/perf2/b-ride.sh: a short ride (bike, KeyW held, a frame every 1.2 s) down the Cabbagetown house street and along Queen West at Trinity
# Bellwoods, once per arm in ARMS ("id:query ..." as in visits.sh; `base:` is the plain page), on the Mac mini through gpu2 (st-aeg2.2).
# Outputs <TAG><id>-<place>-<nn>.png: compare the same frame of two arms for pops, and a frame with its neighbour for a switch line.
set -u
TAG=${TAG:-ride-}
BASEQ="${BASEPRE:+$BASEPRE&}autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0"
OUT=${GPU2_OUT:-capture-out}
mkdir -p "$OUT"
for a in ${ARMS:-base: }; do
  id=${a%%:*}; q=${a#*:}; q=${q//%26/&}
  for place in cab tb; do
    case $place in cab) at="1800 -1601 1.5707963" ;; tb) at="-2700 -757 1.5707963" ;; esac
    set -- $at
    node -e '
const [x, z, h, name, time] = process.argv.slice(1);
const shots = [{ name: `${name}-00`, mode: "cyclist", time, x: +x, z: +z, heading: +h, wait: 9000, js: "(() => { const a = window.__CITY_APP; a.cameraSystem.cinema = null; return 1; })()" }];
for (let i = 1; i <= 12; i++) shots.push({ name: `${name}-${String(i).padStart(2, "0")}`, hold: "KeyW", wait: 1200 });
process.stdout.write(JSON.stringify(shots));' "$1" "$2" "$3" "$place" "${TIME:-golden}" > "$OUT/${TAG}${id}-${place}-shots.json"
    echo "=== ride $id $place $(date +%T) ==="
    env CAPTURE_QUERY="?${q}${q:+&}$BASEQ" CAPTURE_TAG="${TAG}${id}" CAPTURE_VIEWPORT=1600x900 node tools/capture.mjs "$OUT/${TAG}${id}-${place}-shots.json" || echo "ride $id $place failed"
  done
done
echo "=== done $(date +%T) ==="
