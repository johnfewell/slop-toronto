(function () {
// js/road-paint.js
// Road markings generated from the drivable road network (js/road-network.js), so the paint matches where traffic
// actually drives and stops, in Nigeria's white markings: dashed lane lines, a broken white centre line on two-way
// roads, and at the signalised junctions stop bars at the stop lines and zebra crossings across every approach. The
// paint rides the flyovers' decks & ramps (road-network.js edgeY).

const { THREE, CROSSWALK, createRoadPaintMaterial, edgeY } = window.CITY;

const WHITE = new THREE.Color(0xe6e2d6);
const HEIGHT = 0.012; // above the asphalt

function buildRoadPaint(scene, network) {
  const position = [];
  const side = [];
  const paint = [];
  const colors = [];
  const index = [];

  // Flat strip w wide from a (at height ay) to b (by), with a dash pattern (period, duty cycle) running along it
  function strip(ax, ay, az, bx, by, bz, w, col, period = 1, duty = 1) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) return;
    const sx = ((az - bz) / len) * w * 0.5;
    const sz = ((bx - ax) / len) * w * 0.5;
    const i = position.length / 3;
    for (const [x, y, z, s, u] of [[ax, ay, az, -1, 0], [ax, ay, az, 1, 0], [bx, by, bz, 1, len], [bx, by, bz, -1, len]]) {
      position.push(x + sx * s, y + HEIGHT, z + sz * s);
      side.push(sx * s, sz * s);
      paint.push(u, period, duty);
      colors.push(col.r, col.g, col.b);
    }
    index.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  // Edges run between stop lines; s is measured from the start one and o to the right of the centre line
  const at = (e, s, o) => [e.sx + e.dx * s + e.rx * o, edgeY(e, s), e.sz + e.dz * s + e.rz * o];
  const along = (e, o, w, col, period, duty) => strip(...at(e, 0.9, o), ...at(e, e.len - 0.9, o), w, col, period, duty);
  const across = (e, s, o0, o1, w, col, period, duty) => strip(...at(e, s, o0), ...at(e, s, o1), w, col, period, duty);

  // The one or two directed edges of each road between a pair of intersections
  const roads = new Map();
  for (const e of network.edges) {
    const key = Math.min(e.from.id, e.to.id) * 65536 + Math.max(e.from.id, e.to.id);
    if (roads.has(key)) roads.get(key).push(e);
    else roads.set(key, [e]);
  }

  for (const [e, back] of roads.values()) {
    // Lanes of both directions, measured to the right of e, left to right
    const lanes = e.lanes.map((o) => ({ o, dir: 1 }));
    if (back) for (const o of back.lanes) lanes.push({ o: -o, dir: -1 });
    lanes.sort((p, q) => p.o - q.o);

    // Dashed white between lanes going the same way, a broken white centre line between opposing ones
    // (nothing across a median or a lane closed off by an obstacle)
    for (let k = 0; k + 1 < lanes.length; k++) {
      const p = lanes[k];
      const q = lanes[k + 1];
      if (q.o - p.o > 4.5) continue;
      const mid = (p.o + q.o) / 2;
      if (p.dir === q.dir) {
        along(e, mid, 0.13, WHITE, 12, 0.25);
      } else {
        along(e, mid, 0.12, WHITE, 9, 0.35);
      }
    }

    // Stop bars across the lanes arriving at a signalised junction's stop line, from the centre line (or median) to the
    // curb
    for (const f of back ? [e, back] : [e]) {
      if (!f.to.signal) continue;
      const left = back ? Math.max(0, f.lanes[0] - 1.8) : -f.half;
      across(f, f.len - 0.35, left + 0.1, f.half - 0.1, 0.45, WHITE);
    }

    // Zebra crossings curb to curb at the signalised junctions, between the stop lines and the junction
    if (e.from.signal) across(e, -CROSSWALK / 2, -e.half, e.half, CROSSWALK - 0.3, WHITE, 1.2, 0.5);
    if (e.to.signal) across(e, e.len + CROSSWALK / 2, -e.half, e.half, CROSSWALK - 0.3, WHITE, 1.2, 0.5);
  }

  const normal = new Float32Array(position.length);
  for (let i = 1; i < normal.length; i += 3) normal[i] = 1;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('side', new THREE.Float32BufferAttribute(side, 2));
  geometry.setAttribute('paint', new THREE.Float32BufferAttribute(paint, 3));
  geometry.setIndex(index);

  const mesh = new THREE.Mesh(geometry, createRoadPaintMaterial());
  mesh.name = 'RoadMarkings';
  mesh.receiveShadow = true;
  mesh.renderOrder = -1; // under the other see-through ground effects (contact shadows, headlight beams)
  scene.add(mesh);
  return mesh;
}

Object.assign(window.CITY, { buildRoadPaint });
})();
