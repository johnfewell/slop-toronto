(function () {
// js/road-paint.js
// Road markings generated from the drivable road network (js/road-network.js), so the paint matches where traffic
// actually drives and stops, in Ontario's markings: dashed white lane lines, a yellow centre line between opposing
// traffic (broken on two-lane streets, a solid double yellow on the multi-lane arterials), and at the signalised
// junctions white stop bars at the stop lines and zebra crossings across every approach. The
// paint rides the flyovers' decks & ramps (road-network.js edgeY). It covers every street as built (the network's
// paintEdges, dead ends included), and a line carries on through a street's bends, joined at a bounded mitre with its
// dashes in phase (mrdoob's 30096be).

const { THREE, CROSSWALK, createRoadPaintMaterial, edgeY } = window.CITY;

const WHITE = new THREE.Color(0xe6e2d6);
const YELLOW = new THREE.Color(0xe0b12e); // Ontario's centre lines: yellow between opposing traffic
const HEIGHT = 0.012; // above the asphalt

function buildRoadPaint(scene, network) {
  const position = [];
  const side = [];
  const paint = [];
  const colors = [];
  const index = [];
  const lines = [];
  const bends = new Map();

  // Flat strip w wide from a (at height ay) to b (by), with a dash pattern (period, duty cycle) running along it from
  // `phase` (flow -1: the dashes run back from b to a)
  function strip(ax, ay, az, bx, by, bz, w, col, period = 1, duty = 1, phase = 0, flow = 1) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) return;
    const sx = ((az - bz) / len) * w * 0.5;
    const sz = ((bx - ax) / len) * w * 0.5;
    const i = position.length / 3;
    const end = phase + len * flow;
    for (const [x, y, z, s, u] of [[ax, ay, az, -1, phase], [ax, ay, az, 1, phase], [bx, by, bz, 1, end], [bx, by, bz, -1, end]]) {
      position.push(x + sx * s, y + HEIGHT, z + sz * s);
      side.push(sx * s, sz * s);
      paint.push(u, period, duty);
      colors.push(col.r, col.g, col.b);
    }
    index.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  // Edges run between stop lines; s is measured from the start one and o to the right of the centre line
  const at = (e, s, o) => [e.sx + e.dx * s + e.rx * o, edgeY(e, s), e.sz + e.dz * s + e.rz * o];
  // (lines along a road are gathered first: where a street bends they join the next piece's, see below)
  const along = (e, o, w, col, period = 1, duty = 1) => {
    const start = (e.sx - e.x0) * e.dx + (e.sz - e.z0) * e.dz;
    const ends = [at(e, e.from.shape ? -start : 0.9, o), at(e, e.to.shape ? e.span - start : e.len - 0.9, o)];
    lines.push({ e, o, w, col, period, duty, ends, joins: [] });
  };
  const across = (e, s, o0, o1, w, col, period, duty) => strip(...at(e, s, o0), ...at(e, s, o1), w, col, period, duty);
  // a wide gap between opposing lanes that is open road all along (no median or island) still gets its centre line
  const clearCentre = (e, o) => {
    if (!network.isRoadClear) return false;
    const steps = Math.max(1, Math.ceil((e.len - 1.8) / 2.5));
    for (let i = 0; i <= steps; i++) {
      const s = 0.9 + (e.len - 1.8) * i / steps;
      for (const offset of [o - 0.12, o + 0.12]) {
        const [x, , z] = at(e, s, offset);
        if (!network.isRoadClear(x, z, 0.15)) return false;
      }
    }
    return true;
  };

  // The one or two directed edges of each road between a pair of intersections
  const roadsOf = (edges) => {
    const roads = new Map();
    for (const e of edges) {
      const key = Math.min(e.from.id, e.to.id) * 65536 + Math.max(e.from.id, e.to.id);
      if (roads.has(key)) roads.get(key).push(e);
      else roads.set(key, [e]);
    }
    return roads.values();
  };

  // Lines along every street as built (the network's paintEdges)
  for (const [e, back] of roadsOf(network.paintEdges || network.edges)) {
    const firstLine = lines.length;
    // Lanes of both directions, measured to the right of e, left to right
    const lanes = e.lanes.map((o) => ({ o, dir: 1 }));
    if (back) for (const o of back.lanes) lanes.push({ o: -o, dir: -1 });
    lanes.sort((p, q) => p.o - q.o);

    // Dashed white between lanes going the same way; between opposing ones yellow, broken where each way has one lane
    // and a solid double yellow on the wider roads (nothing across a median or a lane closed off by an obstacle)
    const multiLane = lanes.filter((l) => l.dir === 1).length > 1 || lanes.filter((l) => l.dir === -1).length > 1;
    for (let k = 0; k + 1 < lanes.length; k++) {
      const p = lanes[k];
      const q = lanes[k + 1];
      const mid = (p.o + q.o) / 2;
      if (q.o - p.o > 4.5 && (p.dir === q.dir || !clearCentre(e, mid))) continue;
      if (p.dir === q.dir) {
        along(e, mid, 0.13, WHITE, 12, 0.25);
      } else if (multiLane) {
        along(e, mid - 0.11, 0.1, YELLOW);
        along(e, mid + 0.11, 0.1, YELLOW);
      } else {
        along(e, mid, 0.12, YELLOW, 9, 0.35);
      }
    }

    for (const [end, node] of [[0, e.from], [1, e.to]]) {
      if (!node.shape) continue;
      if (!bends.has(node.id)) bends.set(node.id, []);
      bends.get(node.id).push({ e, end, lines: lines.slice(firstLine) });
    }
  }

  // Stop bars and crossings where the traffic stops: the routed network's edges and stop lines (the streets routing
  // dropped would paint second crossings over the same corners)
  for (const [e, back] of roadsOf(network.edges)) {
    // Stop bars across the lanes arriving at a signalised junction's stop line, from the centre line (or median) to the
    // curb
    for (const f of back ? [e, back] : [e]) {
      if (!f.to.signal) continue;
      const left = back ? Math.max(0, f.lanes[0] - 1.8) : -f.half;
      across(f, f.len - 0.35, left + 0.1, f.half - 0.1, 0.45, WHITE);
    }

    // Zebra crossings curb to curb at the signalised junctions, between the stop lines and the junction, on the sides
    // with a crosswalk (road-network.js n.crosswalk: the City's Pedestrian Network)
    const zebra = (n, side) => n.signal && (!n.crosswalk || n.crosswalk[side]);
    if (zebra(e.from, e.outSide)) across(e, -CROSSWALK / 2, -e.half, e.half, CROSSWALK - 0.3, WHITE, 1.2, 0.5);
    if (zebra(e.to, e.inSide)) across(e, e.len + CROSSWALK / 2, -e.half, e.half, CROSSWALK - 0.3, WHITE, 1.2, 0.5);
  }

  // The midblock crossings (network.midCrossings): a zebra curb to curb; at a pedestrian crossover the yield line of
  // "shark's teeth" across each approach a few metres before it, and at a midblock signal a stop bar
  for (const c of network.midCrossings || []) {
    const e = c.stops[0].e;
    const s = c.stops[0].s;
    across(e, s, -c.half, c.half, CROSSWALK - 0.3, WHITE, 1.2, 0.5);
    for (const st of c.stops) {
      const f = st.e;
      const left = f.lanes.length && f.lanes[0] > 1 ? Math.max(0, f.lanes[0] - 1.8) : -f.half;
      if (c.kind === 'pxo') across(f, st.s - CROSSWALK / 2 - 3.5, left + 0.1, f.half - 0.1, 0.6, WHITE, 0.9, 0.55);
      else across(f, st.s - CROSSWALK / 2 - 1.0, left + 0.1, f.half - 0.1, 0.45, WHITE);
    }
  }

  // At a simple bend, corresponding offset lines meet at a bounded mitre, without an intersection-sized gap
  // (line ends are [x, y, z])
  for (const roadsAtBend of bends.values()) {
    if (roadsAtBend.length !== 2) continue;
    const [a, b] = roadsAtBend;
    const sign = a.end === b.end ? -1 : 1;
    if ((a.e.dx * b.e.dx + a.e.dz * b.e.dz) * sign < 0.5) continue;
    for (const p of a.lines) {
      let q = null;
      let distance = 0.5;
      for (const line of b.lines) {
        const d = Math.abs(p.o - line.o * sign);
        if (!line.joins[b.end] && line.col === p.col && line.w === p.w && line.period === p.period &&
          line.duty === p.duty && d < distance) {
          q = line;
          distance = d;
        }
      }
      if (!q) continue;
      const A = p.ends[a.end];
      const B = q.ends[b.end];
      const dx = B[0] - A[0];
      const dz = B[2] - A[2];
      const cross = a.e.dx * b.e.dz - a.e.dz * b.e.dx;
      let join;
      if (Math.abs(cross) < 0.001) {
        if (Math.hypot(dx, dz) > 0.5) continue;
        join = [(A[0] + B[0]) * 0.5, (A[1] + B[1]) * 0.5, (A[2] + B[2]) * 0.5];
      } else {
        const t = (dx * b.e.dz - dz * b.e.dx) / cross;
        const u = (dx * a.e.dz - dz * a.e.dx) / cross;
        const limit = Math.min(6, a.e.span * 0.25, b.e.span * 0.25);
        if (Math.abs(t) > limit || Math.abs(u) > limit) continue;
        join = [A[0] + a.e.dx * t, (A[1] + B[1]) * 0.5, A[2] + a.e.dz * t];
      }
      p.ends[a.end] = q.ends[b.end] = join;
      p.joins[a.end] = [q, b.end];
      q.joins[b.end] = [p, a.end];
    }
  }

  // Continue the same dash phase around bends, even when adjacent road edges point in opposite directions
  for (const line of lines) {
    // an unmatched marking keeps its original gap instead of extending towards a curb at a sharp bend
    for (const end of [0, 1]) {
      if (!line.joins[end]) line.ends[end] = at(line.e, end ? line.e.len - 0.9 : 0.9, line.o);
    }
    line.len = Math.hypot(line.ends[1][0] - line.ends[0][0], line.ends[1][2] - line.ends[0][2]);
  }
  for (const root of lines) {
    if (root.phase !== undefined) continue;
    root.phase = 0;
    root.flow = 1;
    const stack = [root];
    while (stack.length) {
      const line = stack.pop();
      for (let end = 0; end < 2; end++) {
        if (!line.joins[end]) continue;
        const [next, nextEnd] = line.joins[end];
        if (next.phase !== undefined) continue;
        next.flow = line.flow * (end === nextEnd ? -1 : 1);
        next.phase = line.phase + end * line.len * line.flow - nextEnd * next.len * next.flow;
        next.phase = ((next.phase % next.period) + next.period) % next.period;
        stack.push(next);
      }
      strip(...line.ends[0], ...line.ends[1], line.w, line.col, line.period, line.duty, line.phase, line.flow);
    }
  }

  // A band along a polyline P (cycling.js: points with their normal n, mitre m & distance s) between offsets o0 < o1
  // along n, dashed as strip's are (duty over 1: a surface, see createRoadPaintMaterial)
  // (o0 & o1 may also be arrays, an offset per point)
  function ribbon(P, o0, o1, col, period = 1, duty = 1) {
    if (!P || P.length < 2) return;
    const i = position.length / 3;
    for (let k = 0; k < P.length; k++) {
      const p = P[k];
      const a = Array.isArray(o0) ? o0[k] : o0, b = Array.isArray(o1) ? o1[k] : o1;
      const half = (b - a) / 2;
      for (const [o, sgn] of [[a, -1], [b, 1]]) {
        position.push(p.x + p.nx * o * p.m, p.y + HEIGHT, p.z + p.nz * o * p.m);
        side.push(p.nx * half * sgn * p.m, p.nz * half * sgn * p.m);
        paint.push(p.s, period, duty);
        colors.push(col.r, col.g, col.b);
      }
    }
    // facing up: n is the right normal of the way P runs (strip's winding), or the left
    for (let k = 0; k + 1 < P.length; k++) {
      const a = i + 2 * k;
      if (P.nRight) index.push(a, a + 1, a + 3, a, a + 3, a + 2);
      else index.push(a, a + 3, a + 1, a, a + 2, a + 3);
    }
  }
  // Toronto's bikeways: lanes, tracks, crossrides & symbols, the trails' surfaces (cycling.js)
  const roadVerts = position.length / 3;
  const material = createRoadPaintMaterial();
  if (window.CITY.bikePaint) window.CITY.bikePaint({ strip, ribbon, WHITE, YELLOW, material, scene, height: HEIGHT });
  console.info(`[roadPaint] ${position.length / 3} vertices (${position.length / 3 - roadVerts} the bikeways')`);

  const normal = new Float32Array(position.length);
  for (let i = 1; i < normal.length; i += 3) normal[i] = 1;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('side', new THREE.Float32BufferAttribute(side, 2));
  geometry.setAttribute('paint', new THREE.Float32BufferAttribute(paint, 3));
  geometry.setIndex(index);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'RoadMarkings';
  mesh.receiveShadow = true;
  mesh.renderOrder = -1; // under the other see-through ground effects (contact shadows, headlight beams)
  scene.add(mesh);
  return mesh;
}

Object.assign(window.CITY, { buildRoadPaint });
})();
