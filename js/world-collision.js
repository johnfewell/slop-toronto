(function () {
// js/world-collision.js
// Static world contact: the player's body against the city's colliders, as pure geometry (no scene, no game state but
// a cache of shapes). After unable12/slop-sanfrancisco's js/world-collision.js (MIT, © 2026 Mr.doob & Kamil @unable0_),
// a sibling fork of the same engine. A collider's bounds (and the controllers' spatial hash) only gather candidates;
// what is solid is its outline: its polygon (the landmarks', cut from their rendered meshes: footprintColliders), its
// turned box (obb) or its bounds. The car is one tapered convex footprint (the sedan's own outline), against convex
// outlines by full SAT and against concave ones edge by edge (never pushed across an edge, into the inside); walking,
// cycling and flying are circles against the nearest boundary. A contact gives the push-out normal, its depth and the
// touching point. The height filter stays the caller's (minY / maxY: tunnels, underpasses, decks & the road cuts).
// Shapes are cached by collider identity: a collider must not change once used (swap() replaces one).

const EPS = 1e-9, SKIN = 0.002;

// The sedan (actor-models.js BODY_SPECS.sedan: 4.5 m long, 0.93 m half width plus its wheel arches' flare), its bumper
// corners tapered (as Slop San Francisco's, the same car); mirrors don't collide
const CAR_FOOTPRINT = [
  [-0.70, 2.25], [0.70, 2.25], [0.88, 2.13], [0.95, 1.50], [0.95, -1.50], [0.88, -2.14],
  [0.72, -2.25], [-0.72, -2.25], [-0.88, -2.14], [-0.95, -1.50], [-0.95, 1.50], [-0.88, 2.13]
];
const CAR_REACH = Math.max(...CAR_FOOTPRINT.map(([x, z]) => Math.hypot(x, z)));
// its edges' outward normals in the car's frame (x across, z forward), parallel ones once
const CAR_AXES = [];
for (let i = 0; i < CAR_FOOTPRINT.length; i++) {
  const [ax, az] = CAR_FOOTPRINT[i], [bx, bz] = CAR_FOOTPRINT[(i + 1) % CAR_FOOTPRINT.length];
  const l = Math.hypot(bx - ax, bz - az);
  const n = [(bz - az) / l, -(bx - ax) / l];
  if (!CAR_AXES.some((q) => Math.abs(q[0] * n[0] + q[1] * n[1]) > 1 - 1e-9)) CAR_AXES.push(n);
}

// ---- the player's bodies (reused objects: one of each per caller is enough)
function carShape(x, z, heading, padding = 0, out = null) {
  const s = out || { car: true, points: CAR_FOOTPRINT.map(() => ({ x: 0, z: 0 })), axes: CAR_AXES.map(() => ({ x: 0, z: 0 })), lo: new Float64Array(CAR_AXES.length), hi: new Float64Array(CAR_AXES.length) };
  const cs = Math.cos(heading), sn = Math.sin(heading);
  s.x = x; s.z = z; s.heading = heading;
  s.reach = CAR_REACH + padding * 1.42;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < CAR_FOOTPRINT.length; i++) {
    let [lx, lz] = CAR_FOOTPRINT[i];
    lx += Math.sign(lx) * padding; lz += Math.sign(lz) * padding;
    const p = s.points[i];
    p.x = x + lx * cs + lz * sn;
    p.z = z - lx * sn + lz * cs;
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.z < z0) z0 = p.z; if (p.z > z1) z1 = p.z;
  }
  s.minX = x0; s.maxX = x1; s.minZ = z0; s.maxZ = z1;
  for (let i = 0; i < CAR_AXES.length; i++) {
    const [ax, az] = CAR_AXES[i], n = s.axes[i];
    n.x = ax * cs + az * sn;
    n.z = -ax * sn + az * cs;
    let lo = Infinity, hi = -Infinity;
    for (const p of s.points) { const v = p.x * n.x + p.z * n.z; if (v < lo) lo = v; if (v > hi) hi = v; }
    s.lo[i] = lo; s.hi[i] = hi;
  }
  return s;
}
function circleShape(x, z, radius, out = null) {
  const s = out || {};
  s.x = x; s.z = z; s.radius = radius; s.reach = radius;
  s.minX = x - radius; s.maxX = x + radius; s.minZ = z - radius; s.maxZ = z + radius;
  return s;
}

// ---- a collider's outline (cached)
const cache = new WeakMap();
function colliderShape(c) {
  let shape = cache.get(c);
  if (shape) return shape;
  let points = c.polygon;
  if (!points) {
    const o = c.obb || { cx: (c.minX + c.maxX) / 2, cz: (c.minZ + c.maxZ) / 2, hx: (c.maxX - c.minX) / 2, hz: (c.maxZ - c.minZ) / 2, cs: 1, sn: 0 };
    points = [[-o.hx, -o.hz], [o.hx, -o.hz], [o.hx, o.hz], [-o.hx, o.hz]].map(([u, v]) => ({ x: o.cx + u * o.cs + v * o.sn, z: o.cz - u * o.sn + v * o.cs }));
  }
  const n = points.length;
  let area = 0;
  for (let i = 0; i < n; i++) { const a = points[i], b = points[(i + 1) % n]; area += a.x * b.z - b.x * a.z; }
  const ccw = area >= 0;
  // convex: every turn the same way
  let sign = 0, convex = true;
  for (let i = 0; i < n && convex; i++) {
    const a = points[i], b = points[(i + 1) % n], d = points[(i + 2) % n];
    const cross = (b.x - a.x) * (d.z - b.z) - (b.z - a.z) * (d.x - b.x);
    if (Math.abs(cross) < 1e-12) continue;
    if (sign && Math.sign(cross) !== sign) convex = false;
    sign = Math.sign(cross);
  }
  // the edges' outward normals (and, convex, the distinct axes)
  const edges = [], axes = [];
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
    if (l < 1e-9) continue;
    const nx = (ccw ? dz : -dz) / l, nz = (ccw ? -dx : dx) / l;
    edges.push({ a, b, nx, nz, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) });
    if (convex && !axes.some((q) => Math.abs(q.x * nx + q.z * nz) > 1 - 1e-9)) axes.push({ x: nx, z: nz });
  }
  shape = { points, edges, axes, convex };
  cache.set(c, shape);
  return shape;
}

function inside(x, z, points) {
  let yes = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) yes = !yes;
  }
  return yes;
}
// the nearest point of an outline's boundary
const _near = { x: 0, z: 0, distance: 0, edge: null };
function nearest(x, z, edges) {
  _near.distance = Infinity;
  for (const e of edges) {
    const dx = e.b.x - e.a.x, dz = e.b.z - e.a.z;
    const t = Math.max(0, Math.min(1, ((x - e.a.x) * dx + (z - e.a.z) * dz) / (dx * dx + dz * dz)));
    const px = e.a.x + t * dx, pz = e.a.z + t * dz, d = Math.hypot(x - px, z - pz);
    if (d < _near.distance) { _near.distance = d; _near.x = px; _near.z = pz; _near.edge = e; }
  }
  return _near;
}

// ---- contacts
function circleContact(a, b) {
  const q = nearest(a.x, a.z, b.edges), within = inside(a.x, a.z, b.points);
  if (!within && q.distance >= a.radius - EPS) return null;
  let nx, nz;
  if (q.distance > 1e-6) {
    nx = (a.x - q.x) / q.distance; nz = (a.z - q.z) / q.distance;
    if (within) { nx = -nx; nz = -nz; }
  } else { nx = q.edge.nx; nz = q.edge.nz; }
  return { depth: within ? a.radius + q.distance : a.radius - q.distance, nx, nz, x: q.x, z: q.z };
}
function projectPoints(points, nx, nz) {
  let lo = Infinity, hi = -Infinity;
  for (const p of points) { const v = p.x * nx + p.z * nz; if (v < lo) lo = v; if (v > hi) hi = v; }
  _proj[0] = lo; _proj[1] = hi;
  return _proj;
}
const _proj = [0, 0];
// the car against a convex outline: the least push out along any of both shapes' axes
function convexContact(a, b) {
  let best = null, bestDepth = Infinity, bnx = 0, bnz = 0;
  const test = (nx, nz, al, ah) => {
    const [bl, bh] = projectPoints(b.points, nx, nz);
    if (ah <= bl + EPS || bh <= al + EPS) return false;
    const plus = bh - al, minus = ah - bl;
    const depth = Math.min(plus, minus), s = plus < minus ? 1 : -1;
    if (depth < bestDepth) { bestDepth = depth; bnx = nx * s; bnz = nz * s; }
    return true;
  };
  for (let i = 0; i < a.axes.length; i++) if (!test(a.axes[i].x, a.axes[i].z, a.lo[i], a.hi[i])) return null;
  for (const n of b.axes) {
    const [al, ah] = projectPoints(a.points, n.x, n.z);
    if (!test(n.x, n.z, al, ah)) return null;
  }
  best = { depth: bestDepth, nx: bnx, nz: bnz };
  return best;
}
// the car against one edge of a concave outline: the least push to its outer side (along the edge's normal or any of the
// car's axes leaning outward), so the car never ends up across an edge, inside
function edgeContact(a, e) {
  let bestDepth = Infinity, bnx = 0, bnz = 0;
  // along the edge's own normal: the car's lowest point onto the edge's line
  const s0 = e.a.x * e.nx + e.a.z * e.nz;
  const [al0, ah0] = projectPoints(a.points, e.nx, e.nz);
  // (the car must reach across the edge's line, and overlap the edge along each of its own axes)
  if (al0 >= s0 - EPS || ah0 <= s0 + EPS) return null;
  bestDepth = s0 - al0; bnx = e.nx; bnz = e.nz;
  for (let i = 0; i < a.axes.length; i++) {
    let nx = a.axes[i].x, nz = a.axes[i].z, al = a.lo[i], ah = a.hi[i];
    const p0 = e.a.x * nx + e.a.z * nz, p1 = e.b.x * nx + e.b.z * nz, bl = Math.min(p0, p1), bh = Math.max(p0, p1);
    if (ah <= bl + EPS || bh <= al + EPS) return null;
    // only the outward-leaning direction
    const out = nx * e.nx + nz * e.nz;
    if (Math.abs(out) < 0.05) continue;
    const depth = out > 0 ? bh - al : ah - bl;
    if (out < 0) { nx = -nx; nz = -nz; }
    if (depth < bestDepth) { bestDepth = depth; bnx = nx; bnz = nz; }
  }
  return { depth: bestDepth, nx: bnx, nz: bnz };
}
function concaveContact(a, b) {
  // deep inside (dropped there): straight out across the nearest edge
  if (inside(a.x, a.z, b.points)) {
    const q = nearest(a.x, a.z, b.edges);
    return { depth: q.distance + a.reach, nx: q.edge.nx, nz: q.edge.nz };
  }
  let best = null;
  for (const e of b.edges) {
    if (e.maxX < a.minX || e.minX > a.maxX || e.maxZ < a.minZ || e.minZ > a.maxZ) continue;
    const hit = edgeContact(a, e);
    if (hit && (!best || hit.depth > best.depth)) best = hit;
  }
  return best;
}
// Shape `a` (carShape / circleShape) against collider `c`: { depth, nx, nz, x, z } (push `a` by n * depth), or null
function contact(a, c) {
  if (a.maxX < c.minX || a.minX > c.maxX || a.maxZ < c.minZ || a.minZ > c.maxZ) return null;
  const b = colliderShape(c);
  const hit = a.radius !== undefined ? circleContact(a, b) : b.convex ? convexContact(a, b) : concaveContact(a, b);
  if (hit && hit.x === undefined) {
    // the touching point: the car's deepest corner(s), carried onto the outline
    let sx = 0, sz = 0, count = 0, min = Infinity;
    for (const p of a.points) {
      const d = p.x * hit.nx + p.z * hit.nz;
      if (d < min - 1e-6) { min = d; sx = p.x; sz = p.z; count = 1; } else if (Math.abs(d - min) <= 1e-6) { sx += p.x; sz += p.z; count++; }
    }
    const q = nearest(sx / count + hit.nx * hit.depth, sz / count + hit.nz * hit.depth, b.edges);
    hit.x = q.x; hit.z = q.z;
  }
  return hit;
}

// ---- the landmarks' outlines from their rendered meshes
// World triangles of an object's meshes, as a flat [ax, ay, az, bx, by, bz, cx, cy, cz, ...] array
function meshTriangles(objects) {
  const out = [];
  const T = window.CITY.THREE, v = new T.Vector3(), m = new T.Matrix4();
  for (const object of Array.isArray(objects) ? objects : [objects]) {
  object.updateMatrixWorld(true);
  object.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position || o.visible === false) return;
    const pos = o.geometry.attributes.position, idx = o.geometry.index, n = idx ? idx.count : pos.count;
    const mats = [];
    if (o.isInstancedMesh) for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); mats.push(m.clone().premultiply(o.matrixWorld)); }
    else mats.push(o.matrixWorld);
    for (const mw of mats) {
      for (let i = 0; i + 2 < n; i += 3) {
        for (let k = 0; k < 3; k++) {
          v.fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(mw);
          out.push(v.x, v.y, v.z);
        }
      }
    }
  });
  }
  return out;
}
// Where the triangles cross height y: segments [ax, az, bx, bz, ...]
function sliceTriangles(tris, y, out = []) {
  for (let i = 0; i < tris.length; i += 9) {
    let k = 0, sx = 0, sz = 0;
    for (let e = 0; e < 3; e++) {
      const a = i + e * 3, b = i + ((e + 1) % 3) * 3;
      const ya = tris[a + 1], yb = tris[b + 1];
      if ((ya - y) * (yb - y) >= 0) continue;
      const t = (y - ya) / (yb - ya), x = tris[a] + (tris[b] - tris[a]) * t, z = tris[a + 2] + (tris[b + 2] - tris[a + 2]) * t;
      if (k === 0) { sx = x; sz = z; k = 1; } else { out.push(sx, sz, x, z); k = 2; break; }
    }
  }
  return out;
}
// A slice's open ends joined up: a mesh missing a wall face (the City's massing has some) leaves its slice open there,
// and the outside would flood in. Each end that meets no other segment is joined to the nearest other loose end (closest
// pairs first, up to `reach` m apart): a straight wall where the missing one stood. Appends to `out`
function closeSlice(segs, out, reach = 50) {
  const ends = new Map();
  const key = (x, z) => Math.round(x * 100) + ',' + Math.round(z * 100);
  for (let i = 0; i < segs.length; i += 4) {
    for (const [x, z] of [[segs[i], segs[i + 1]], [segs[i + 2], segs[i + 3]]]) {
      const k = key(x, z), e = ends.get(k);
      if (e) e.n++; else ends.set(k, { x, z, n: 1 });
    }
    out.push(segs[i], segs[i + 1], segs[i + 2], segs[i + 3]);
  }
  const loose = [...ends.values()].filter((e) => e.n % 2);
  if (loose.length < 2 || loose.length > 400) return out;
  const pairs = [];
  for (let a = 0; a < loose.length; a++) for (let b = a + 1; b < loose.length; b++) {
    const d = Math.hypot(loose[a].x - loose[b].x, loose[a].z - loose[b].z);
    if (d <= reach) pairs.push([d, a, b]);
  }
  pairs.sort((p, q) => p[0] - q[0]);
  const used = new Uint8Array(loose.length);
  for (const [, a, b] of pairs) {
    if (used[a] || used[b]) continue;
    used[a] = used[b] = 1;
    out.push(loose[a].x, loose[a].z, loose[b].x, loose[b].z);
  }
  return out;
}
// Douglas-Peucker on a closed ring (its two farthest-apart points kept)
function simplifyRing(pts, tol) {
  if (pts.length < 8) return pts;
  const keep = new Uint8Array(pts.length);
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[0].x, pts[i].z - pts[0].z); if (d > fd) { fd = d; far = i; } }
  keep[0] = keep[far] = 1;
  const stack = [[0, far], [far, pts.length]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const a = pts[i0], b = pts[i1 % pts.length];
    let best = -1, bd = tol;
    for (let i = i0 + 1; i < i1; i++) {
      const p = pts[i], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0;
      const d = Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([i0, best], [best, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// The solid outline(s) of `tris` between heights: their slices at `heights`, rasterised into `cell`-sized squares as
// walls, the outside flooded in from the edge and what it doesn't reach is solid (so duplicate or crossing faces & any
// winding don't matter, and enclosed courtyards fill), traced, simplified and laid back on the walls drawn
// The roof (from `roofFrom` m up to 150 m above it: not a tower's pod overhead) seen from above makes up for a mesh whose
// walls are too broken to close: where the outline traced covers under 60 % of what the roof does, or over 115 % (an
// open end joined to the wrong one closed off open ground), what the roof covers is the outline.
function footprintRings(tris, heights, cell = 0.15, tolerance = 0.1, roofFrom = Infinity) {
  const segs = [];
  for (const y of heights) closeSlice(sliceTriangles(tris, y), segs);
  if (segs.length < 12) return [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < tris.length; i += 3) { x0 = Math.min(x0, tris[i]); x1 = Math.max(x1, tris[i]); z0 = Math.min(z0, tris[i + 2]); z1 = Math.max(z1, tris[i + 2]); }
  cell = Math.max(cell, Math.max(x1 - x0, z1 - z0) / 1600);
  x0 -= cell * 3; z0 -= cell * 3;
  const W = Math.ceil((x1 - x0) / cell) + 7, H = Math.ceil((z1 - z0) / cell) + 7;
  const grid = new Uint8Array(W * H); // 1 wall, 2 outside
  const stack = new Int32Array(W * H);
  const fill = (roof, walls = true) => {
    grid.fill(0);
    // the walls: every cell a segment passes through (sampled at a third of a cell)
    if (walls) for (let i = 0; i < segs.length; i += 4) {
      const ax = (segs[i] - x0) / cell, az = (segs[i + 1] - z0) / cell, bx = (segs[i + 2] - x0) / cell, bz = (segs[i + 3] - z0) / cell;
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) * 3));
      for (let k = 0; k <= n; k++) grid[Math.floor(az + ((bz - az) * k) / n) * W + Math.floor(ax + ((bx - ax) * k) / n)] = 1;
    }
    if (roof) for (let i = 0; i < roof.length; i++) if (roof[i]) grid[i] = 1;
    // the outside, flooded from the border
    let sp = 0;
    const push = (i) => { if (grid[i] === 0) { grid[i] = 2; stack[sp++] = i; } };
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
    for (let z = 0; z < H; z++) { push(z * W); push(z * W + W - 1); }
    while (sp) {
      const i = stack[--sp], x = i % W;
      if (x > 0) push(i - 1);
      if (x < W - 1) push(i + 1);
      if (i >= W) push(i - W);
      if (i < W * (H - 1)) push(i + W);
    }
    let n = 0;
    for (let i = 0; i < grid.length; i++) if (grid[i] !== 2) n++;
    return n;
  };
  const solidCells = fill(null);
  if (roofFrom < Infinity) {
    // the roof's cover: (nearly) level faces from roofFrom up, rasterised at the cells' centres
    const roof = new Uint8Array(W * H);
    let roofCells = 0;
    for (let i = 0; i < tris.length; i += 9) {
      const ax = tris[i], ay = tris[i + 1], az = tris[i + 2], bx = tris[i + 3], by = tris[i + 4], bz = tris[i + 5], cx = tris[i + 6], cy = tris[i + 7], cz = tris[i + 8];
      if (Math.min(ay, by, cy) < roofFrom || Math.max(ay, by, cy) > roofFrom + 150) continue;
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
      if (l < 1e-9 || Math.abs(ny) / l < 0.3) continue;
      const gx0 = Math.floor((Math.min(ax, bx, cx) - x0) / cell), gx1 = Math.floor((Math.max(ax, bx, cx) - x0) / cell);
      const gz0 = Math.floor((Math.min(az, bz, cz) - z0) / cell), gz1 = Math.floor((Math.max(az, bz, cz) - z0) / cell);
      for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
        const k = gz * W + gx;
        if (roof[k]) continue;
        const px = x0 + (gx + 0.5) * cell, pz = z0 + (gz + 0.5) * cell;
        const d1 = (bx - ax) * (pz - az) - (bz - az) * (px - ax), d2 = (cx - bx) * (pz - bz) - (cz - bz) * (px - bx), d3 = (ax - cx) * (pz - cz) - (az - cz) * (px - cx);
        if ((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)) { roof[k] = 1; roofCells++; }
      }
    }
    if (solidCells < 0.6 * roofCells || (solidCells > 1.15 * roofCells && roofCells > 0.4 * solidCells)) fill(roof, false);
  }
  const solid = (x, z) => x >= 0 && z >= 0 && x < W && z < H && grid[z * W + x] !== 2;
  // the boundary's directed edges, solid on the left: corner -> next corners
  const V = W + 1, next = new Map();
  const add = (a, b) => { const l = next.get(a); if (l) l.push(b); else next.set(a, [b]); };
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    if (!solid(x, z)) continue;
    if (!solid(x, z - 1)) add(z * V + x, z * V + x + 1);
    if (!solid(x + 1, z)) add(z * V + x + 1, (z + 1) * V + x + 1);
    if (!solid(x, z + 1)) add((z + 1) * V + x + 1, (z + 1) * V + x);
    if (!solid(x - 1, z)) add((z + 1) * V + x, z * V + x);
  }
  // the walls drawn, bucketed, to lay the traced corners back onto
  const SB = 2, buckets = new Map();
  for (let i = 0; i < segs.length; i += 4) {
    const bx0 = Math.floor(Math.min(segs[i], segs[i + 2]) / SB), bx1 = Math.floor(Math.max(segs[i], segs[i + 2]) / SB);
    const bz0 = Math.floor(Math.min(segs[i + 1], segs[i + 3]) / SB), bz1 = Math.floor(Math.max(segs[i + 1], segs[i + 3]) / SB);
    for (let bx = bx0; bx <= bx1; bx++) for (let bz = bz0; bz <= bz1; bz++) {
      const k = bx * 100003 + bz;
      const l = buckets.get(k);
      if (l) l.push(i); else buckets.set(k, [i]);
    }
  }
  const snap = (p) => {
    let best = cell * 1.6, bx = p.x, bz = p.z;
    const cx = Math.floor(p.x / SB), cz = Math.floor(p.z / SB);
    for (let a = cx - 1; a <= cx + 1; a++) for (let b = cz - 1; b <= cz + 1; b++) {
      for (const i of buckets.get(a * 100003 + b) || []) {
        const ax = segs[i], az = segs[i + 1], dx = segs[i + 2] - ax, dz = segs[i + 3] - az, l2 = dx * dx + dz * dz || 1e-12;
        const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / l2));
        const qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(qx - p.x, qz - p.z);
        if (d < best) { best = d; bx = qx; bz = qz; }
      }
    }
    return { x: bx, z: bz };
  };
  const rings = [];
  const turn = (a, b, c) => { // >0 left, <0 right (corner indices)
    const ax = a % V, az = Math.floor(a / V), bx = b % V, bz = Math.floor(b / V), cx = c % V, cz = Math.floor(c / V);
    return (bx - ax) * (cz - bz) - (bz - az) * (cx - bx);
  };
  for (const start of [...next.keys()]) {
    while (next.has(start) && next.get(start).length) {
      const ring = [];
      let prev = -1, at = start;
      for (let guard = 0; guard < 4e6; guard++) {
        const outs = next.get(at);
        if (!outs || !outs.length) break;
        // at a pinch (two solids touching corner to corner) keep turning right: they stay apart
        let k = 0;
        if (outs.length > 1 && prev >= 0) k = turn(prev, at, outs[0]) < turn(prev, at, outs[1]) ? 0 : 1;
        const to = outs.splice(k, 1)[0];
        if (!outs.length) next.delete(at);
        ring.push(at);
        prev = at;
        at = to;
        if (at === start) break;
      }
      if (ring.length < 4) continue;
      // corners only (where the trace turns), in metres
      const pts = [];
      for (let i = 0; i < ring.length; i++) {
        const a = ring[(i + ring.length - 1) % ring.length], b = ring[i], c = ring[(i + 1) % ring.length];
        if (turn(a, b, c) !== 0) pts.push({ x: x0 + (b % V) * cell, z: z0 + Math.floor(b / V) * cell });
      }
      let area = 0;
      for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a.x * b.z - b.x * a.z; }
      if (area / 2 < Math.max(0.04, cell * cell * 2)) continue; // (a hole's trace runs the other way round: none here)
      let ring2 = simplifyRing(pts, tolerance).map(snap);
      ring2 = simplifyRing(ring2, tolerance * 0.5);
      if (ring2.length >= 3) rings.push(ring2);
    }
  }
  return rings;
}
// Convex hull (monotone chain) of [{x, z}]
function hull(points) {
  const p = points.slice().sort((a, b) => a.x - b.x || a.z - b.z);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
// The convex hulls of what the triangles hold in each band of `step` metres from y0 up to top (their corners inside a
// band, their edges' crossings of its bottom & top), in one sweep: [{ y0, y1, ring }]
function bandHulls(tris, y0, top, step) {
  const n = Math.max(0, Math.ceil((top - y0) / step - 1e-6));
  const pts = Array.from({ length: n }, () => []);
  for (let i = 0; i < tris.length; i += 9) {
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < 3; k++) { const y = tris[i + k * 3 + 1]; if (y < lo) lo = y; if (y > hi) hi = y; }
    const b0 = Math.max(0, Math.floor((lo - y0) / step)), b1 = Math.min(n - 1, Math.floor((hi - y0) / step));
    for (let b = b0; b <= b1; b++) {
      const ya = y0 + b * step, yb = Math.min(top, ya + step), out = pts[b];
      for (let k = 0; k < 3; k++) {
        const a = i + k * 3, c = i + ((k + 1) % 3) * 3, y = tris[a + 1], yc = tris[c + 1];
        if (y >= ya && y <= yb) out.push({ x: tris[a], z: tris[a + 2] });
        for (const h of [ya, yb]) {
          if ((y - h) * (yc - h) < 0) {
            const t = (h - y) / (yc - y);
            out.push({ x: tris[a] + (tris[c] - tris[a]) * t, z: tris[a + 2] + (tris[c + 2] - tris[a + 2]) * t });
          }
        }
      }
    }
  }
  return pts.map((p, b) => ({ y0: y0 + b * step, y1: Math.min(top, y0 + (b + 1) * step), ring: p.length >= 3 ? hull(p) : [] }));
}
function polygonCollider(points, minY, maxY) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of points) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  const c = { minX: x0, maxX: x1, minZ: z0, maxZ: z1, maxY, polygon: points };
  if (minY !== undefined) c.minY = minY;
  return c;
}
// A landmark's colliders from what is drawn: up to GROUND_TOP above the street (where anyone on the ground can touch it)
// its exact outline(s), sliced at four heights (so arches, colonnades & columns stay open between their piers); above
// that (the helicopter, the decks) the convex hull of each BAND metres of it
const GROUND_TOP = 3.0, BAND = 8;
// (roof: false for what stands on columns, its roofs overhead: see footprintRings)
function footprintColliders(objects, { ground = 0, cell = 0.15, roof = true } = {}) {
  const tris = meshTriangles(objects);
  if (tris.length < 27) return [];
  let top = -Infinity;
  for (let i = 1; i < tris.length; i += 3) top = Math.max(top, tris[i]);
  const out = [];
  const heights = [0.37, 1.07, 1.83, 2.71].map((h) => ground + h);
  for (const ring of footprintRings(tris, heights, cell, 0.1, roof ? ground + GROUND_TOP : Infinity)) out.push(polygonCollider(ring, undefined, ground + GROUND_TOP));
  for (const b of bandHulls(tris, ground + GROUND_TOP, top, BAND)) if (b.ring.length >= 3) out.push(polygonCollider(b.ring, b.y0, b.y1));
  return out;
}

// Colliders replaced after the controllers have them (a model that loads later): the controllers apply `changes` from
// where they last read
const changes = [];
function swap(remove, add) {
  changes.push({ remove, add });
  for (const c of remove) cache.delete(c);
}

window.CITY.WorldCollision = {
  CAR_FOOTPRINT, CAR_REACH, SKIN,
  carShape, circleShape, colliderShape, contact, inside,
  footprintColliders, footprintRings, polygonCollider, meshTriangles, hull,
  swap, changes
};
})();
