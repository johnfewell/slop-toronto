#!/bin/bash
# tools/perf2/b-glide.sh: a camera glide along a street, a frame every 0.75 m, once per arm in ARMS ("id:query ...", as visits.sh), on the Mac mini
# through gpu2 (st-aeg2.2). The same camera positions in every arm, so a frame of one arm sets beside the same frame of another, and a frame
# beside its neighbour in one arm shows a shadow that pops (a caster changing at a distance) as a change the other arm does not have.
# Outputs <TAG><id>-<place>-<nn>.png. TIME: the preset (default golden).
set -u
TAG=${TAG:-gl-}
BASEQ="${BASEPRE:+$BASEPRE&}autoscale=0&transit=timetable&film&cloudSpeed=0&hud=0"
OUT=${GPU2_OUT:-capture-out}
mkdir -p "$OUT"
for a in ${ARMS:-base: }; do
  id=${a%%:*}; q=${a#*:}; q=${q//%26/&}
  for place in cab tb; do
    node -e '
const place = process.argv[1], time = process.argv[2];
const at = { cab: { x: 1800, z: -1601, dx: -0.75, dz: 0, look: [-150, 3.3, -5] }, tb: { x: -2700, z: -757, dx: -0.75, dz: 0, look: [-250, 0, -3] } }[place];
const shots = [];
for (let i = 0; i < 16; i++) {
  const x = at.x + at.dx * i, z = at.z + at.dz * i;
  shots.push({ name: `${place}-${String(i).padStart(2, "0")}`, time, wait: i === 0 ? 9000 : 900,
    js: `(() => { const app = window.__CITY_APP; ${i === 0 ? `app.teleportTo(${x}, ${z}, 0);` : ""} app.cameraSystem.cinema = () => ({ pos: [${x}, 1.7, ${z}], look: [${x + at.look[0]}, ${at.look[1]}, ${z + at.look[2]}], fov: 60 }); })()` });
}
process.stdout.write(JSON.stringify(shots));' "$place" "${TIME:-golden}" > "$OUT/${TAG}${id}-${place}-shots.json"
    echo "=== glide $id $place $(date +%T) ==="
    env CAPTURE_QUERY="?${q}${q:+&}$BASEQ" CAPTURE_TAG="${TAG}${id}-${place}-" CAPTURE_VIEWPORT=1600x900 node tools/capture.mjs "$OUT/${TAG}${id}-${place}-shots.json" || echo "glide $id $place failed"
  done
done
echo "=== done $(date +%T) ==="
