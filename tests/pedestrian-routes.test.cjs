// Sidewalk detours (pedestrian-routes.js), ported from mrdoob/slop-newyork 2bcd413 with its tests, plus Toronto's
// obstacle set: the turned-box and round street furniture (`obstacles`), centre-line edges and ?peddetours=0.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../js/pedestrian-routes.js'), 'utf8');
function load() {
  const context = { window: { CITY: {} }, performance };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.CITY.createPedestrianRoutes;
}

// A 200 x 35 m curb island (z 5..40 in its own frame, turned by `angle`) along the north side of two 90 m edges whose
// sidewalk lines run at z 6.7 & 7.8; buildings stand from z 9.4 (the road network's walkable), the road is z < 5.
function fixture(blocks = [], { angle = 0, furniture = [], general = false, detours = true, onSidewalk = null } = {}) {
  const createPedestrianRoutes = load();
  const cs = Math.cos(angle), sn = Math.sin(angle);
  const world = (x, z) => ({ x: x * cs - z * sn, z: x * sn + z * cs });
  const local = (x, z) => ({ x: x * cs + z * sn, z: -x * sn + z * cs });
  const block = { poly: [world(0, 5), world(200, 5), world(200, 40), world(0, 40)] };
  const blockAt = (x, z) => { const p = local(x, z); return p.x >= 0 && p.x <= 200 && p.z >= 5 && p.z <= 40 ? block : null; };
  let queries = 0;
  const walkable = (minX, maxX, minZ, maxZ) => {
    queries++;
    const p = local((minX + maxX) / 2, (minZ + maxZ) / 2);
    const hx = (maxX - minX) / 2, hz = (maxZ - minZ) / 2;
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    return ![...blocks, [0, 200, 9.4, 40]].some(([x0, x1, z0, z1]) =>
      p.x + ex > x0 && p.x - ex < x1 && p.z + ez > z0 && p.z - ez < z1);
  };
  const nodes = Array.from({ length: 3 }, () => ({ in: [], out: [], road: [] }));
  const edges = [0, 1].map((i) => {
    const start = world(5 + i * 90, 0);
    const edge = { from: nodes[i], to: nodes[i + 1], sx: start.x, sz: start.z, dx: cs, dz: sn,
      rx: -sn, rz: cs, half: 5, len: 90, general };
    nodes[i].out.push(edge); nodes[i + 1].in.push(edge);
    return edge;
  });
  const routes = createPedestrianRoutes({ walkable, onSidewalk: onSidewalk || ((x, z) => !!blockAt(x, z)),
    obstacles: furniture.map((f) => f(world, cs, sn)), detours }, blockAt);
  return { routes, edges, block, blockAt, walkable, world, queries: () => queries };
}
// furniture in the island's frame, as world-collision.js shapes: a box turned `turn` from the street (a bench, a
// shelter, a café's railed strip), a circle (a hydrant, a bin)
const box = (x, z, hx, hz, turn = 0) => (world, cs, sn) => {
  // (obb axes u (cs, -sn) & v (sn, cs): a mesh turned by yaw has cs = cos(yaw), sn = sin(yaw))
  const c = world(x, z), yaw = -(Math.atan2(sn, cs) + turn), ocs = Math.cos(yaw), osn = Math.sin(yaw);
  const ex = Math.abs(ocs) * hx + Math.abs(osn) * hz, ez = Math.abs(osn) * hx + Math.abs(ocs) * hz;
  return { minX: c.x - ex, maxX: c.x + ex, minZ: c.z - ez, maxZ: c.z + ez, obb: { cx: c.x, cz: c.z, hx, hz, cs: ocs, sn: osn } };
};
const circle = (x, z, r) => (world) => {
  const c = world(x, z);
  return { minX: c.x - r, maxX: c.x + r, minZ: c.z - r, maxZ: c.z + r, circle: { x: c.x, z: c.z, r } };
};
// does a walker's body there, the 0.4 m half-width square the routes test (pedestrian-routes.js clear), keep off the
// shape? (its outline sampled every 2 cm, and the square's centre outside it)
function bodyClear(o, x, z) {
  const outline = [];
  if (o.circle) {
    for (let a = 0; a < Math.PI * 2; a += 0.02 / o.circle.r) outline.push([o.circle.x + Math.cos(a) * o.circle.r, o.circle.z + Math.sin(a) * o.circle.r]);
  } else {
    const { cx, cz, hx, hz, cs, sn } = o.obb, at = (u, v) => [cx + u * cs + v * sn, cz - u * sn + v * cs];
    for (let u = -hx; u <= hx + 1e-9; u += 0.02) outline.push(at(u, -hz), at(u, hz));
    for (let v = -hz; v <= hz + 1e-9; v += 0.02) outline.push(at(-hx, v), at(hx, v));
  }
  if (outline.some(([px, pz]) => Math.abs(px - x) < 0.4 - 1e-6 && Math.abs(pz - z) < 0.4 - 1e-6)) return false;
  if (o.circle) return Math.hypot(x - o.circle.x, z - o.circle.z) > o.circle.r;
  const { cx, cz, hx, hz, cs, sn } = o.obb;
  return Math.abs((x - cx) * cs - (z - cz) * sn) > hx || Math.abs((x - cx) * sn + (z - cz) * cs) > hz;
}

const endpoint = (track, end) => ({ x: track.ax + track.ux * track.len * end, z: track.az + track.uz * track.len * end });
function touching(a, b) { assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 1e-8); }
// every 10 cm of every piece on the island and clear of the buildings (a 0.4 m body): never in the road or a lot
function assertWalkable(f, tracks, clear = () => true) {
  for (const t of tracks) {
    for (let s = 0; s <= t.len; s += 0.1) {
      const x = t.ax + t.ux * s, z = t.az + t.uz * s;
      assert.equal(f.blockAt(x, z), f.block);
      assert.ok(f.walkable(x - 0.4, x + 0.4, z - 0.4, z + 0.4));
      assert.ok(clear(x, z), `clear of the furniture at ${x.toFixed(2)}, ${z.toFixed(2)}`);
    }
  }
}

test('unobstructed sidewalk lines stay straight and reuse their cached tracks', () => {
  const f = fixture(), tracks = f.routes.along(f.edges[0]), queries = f.queries();
  assert.equal(tracks.length, 2);
  assert.ok(tracks.every((t) => t.len === 90 && !t.before && !t.after));
  assert.equal(f.routes.along(f.edges[0]), tracks);
  assert.equal(f.queries(), queries);
  assert.equal(f.routes.stats.straight, 2);
  assert.equal(f.routes.stats.detoured, 0);
});

for (const angle of [0, Math.PI / 6]) {
  test(`pedestrians bypass an obstruction within the curb island (${angle})`, () => {
    const f = fixture([[35, 42, 6.5, 8.1]], { angle }), tracks = f.routes.along(f.edges[0]);
    const starts = tracks.filter((t) => !t.before), goal = f.world(500, 7);
    assert.equal(starts.length, 2);
    assert.ok(starts.every((t) => t.after));
    for (const start of starts) {
      touching(endpoint(start, 0), f.world(5, start === starts[0] ? 6.7 : 7.8));
      let tail = start;
      for (let t = start; t; t = t.after) {
        tail = t;
        assertWalkable(f, [t]);
        for (const [dir, neighbor] of [[1, t.after], [-1, t.before]]) {
          if (!neighbor) continue;
          const plan = f.routes.next(t, dir, goal.x, goal.z);
          assert.equal(plan.length, 1);
          assert.equal(plan[0].track, neighbor);
          assert.equal(plan[0].dir, dir);
          touching(endpoint(t, dir > 0 ? 1 : 0), endpoint(neighbor, dir > 0 ? 0 : 1));
          const queries = f.queries();
          assert.equal(f.routes.next(t, dir, goal.x, goal.z), plan);
          assert.equal(f.queries(), queries);
        }
      }
      touching(endpoint(tail, 1), f.world(95, start === starts[0] ? 6.7 : 7.8));
      // off the far end of the detour: on to the next edge's lines, never back into the middle of this one
      const exit = f.routes.next(tail, 1, goal.x, goal.z);
      assert.equal(exit.at(-1).track.edge, f.edges[1]);
      assert.ok(!exit.at(-1).track.before);
    }
    assert.equal(f.routes.stats.detoured, 2);
    assert.equal(f.routes.stats.lineBlocked, 0);
  });
}

test('a blocked sidewalk does not send pedestrians into the road or through a lot', () => {
  const f = fixture([[35, 42, 5, 9.4]]);
  assert.equal(f.routes.along(f.edges[0]).length, 0);
  assert.equal(f.routes.stats.lineBlocked, 2);
});

test('a cached route can weave between obstacles on opposite sides of the sidewalk', () => {
  const f = fixture([[30, 36, 5, 7.35], [56, 62, 7.15, 9.4]]);
  const tracks = f.routes.along(f.edges[0]);
  assert.equal(tracks.filter((t) => !t.before).length, 2);
  assert.ok(tracks.length >= 6);
  assertWalkable(f, tracks);
});

// --- Toronto: the street furniture the road network leaves out, each by its own shape ---
for (const angle of [0, 0.29]) {
  test(`lines step round a turned bench, a hydrant and a sidewalk café (${angle})`, () => {
    // a 1.8 x 0.8 m bench across the outer line, turned 0.4 rad off the street; a hydrant on the inner line; a café's
    // railed strip from the building face (z 9.4) out to z 7.1, over the outer line only
    const furniture = [box(30, 7.8, 0.9, 0.4, 0.4), circle(50, 6.7, 0.3), box(70, 8.25, 3, 1.15)];
    const f = fixture([], { angle, furniture }), tracks = f.routes.along(f.edges[0]);
    assert.equal(tracks.filter((t) => !t.before).length, 2, 'both lines kept');
    assert.ok(tracks.length > 2, 'detoured');
    const shapes = furniture.map((g) => g(f.world, Math.cos(angle), Math.sin(angle)));
    // (each 10 cm sample's 0.4 m body clear of every piece of furniture)
    assertWalkable(f, tracks, (x, z) => shapes.every((o) => bodyClear(o, x, z)));
    assert.equal(f.routes.stats.obstacles, 3);
    assert.equal(f.routes.stats.detoured, 2);
  });
}

test('furniture off the walking lines leaves them straight', () => {
  // a bench against the building and a hydrant out at the curb
  const f = fixture([], { furniture: [box(30, 9.0, 0.9, 0.3), circle(50, 5.3, 0.25)] });
  const tracks = f.routes.along(f.edges[0]);
  assert.equal(tracks.length, 2);
  assert.ok(tracks.every((t) => t.len === 90 && !t.after));
});

test('a turned box is tested by its shape, not its bounds', () => {
  // a café's 6 x 1.2 m strip along a street at 45 degrees, over the outer line: its world bounds (5.1 m square) would
  // take in the inner line too, which the strip itself leaves clear
  const f = fixture([], { angle: Math.PI / 4, furniture: [box(70, 8.4, 3, 0.6)] });
  const tracks = f.routes.along(f.edges[0]);
  const starts = tracks.filter((t) => !t.before);
  assert.equal(starts.length, 2);
  assert.ok(starts.some((t) => t.len === 90 && !t.after), 'the inner line stays straight');
  assert.ok(starts.some((t) => t.after), 'the outer line goes round');
});

test('a centre-line street detours on its island without the rough curb rectangles', () => {
  // (Toronto's centre-line edges: onSidewalk is unreliable there, so the island & its outline bound the detour)
  const f = fixture([[35, 42, 6.5, 8.1]], { general: true, onSidewalk: () => false });
  const tracks = f.routes.along(f.edges[0]);
  assert.equal(tracks.filter((t) => !t.before).length, 2);
  assert.ok(tracks.some((t) => t.after));
  assertWalkable(f, tracks);
  // a grid street's detour, though, keeps to the mapped rectangles: none round the obstacle here, so no way round
  const g = fixture([[35, 42, 6.5, 8.1]], { onSidewalk: (x, z) => x < 30 || x > 50 });
  assert.equal(g.routes.along(g.edges[0]).length, 0);
});

test('furniture with no way round never costs a line: it stays straight, as without the furniture', () => {
  // a 4 m bus shelter from the curb to the building line, and a grid street's narrow mapped sidewalk: no detour
  const f = fixture([], { furniture: [box(40, 7.2, 2, 2.2)] });
  const tracks = f.routes.along(f.edges[0]);
  assert.equal(tracks.length, 2);
  assert.ok(tracks.every((t) => t.len === 90 && !t.after));
  assert.equal(f.routes.stats.throughFurniture, 2);
  assert.equal(f.routes.stats.lineBlocked, 0);
  // ...while the road network's own footprints across it still drop it
  const g = fixture([[35, 42, 5, 9.4]], { furniture: [box(40, 7.2, 2, 2.2)] });
  assert.equal(g.routes.along(g.edges[0]).length, 0);
  assert.equal(g.routes.stats.throughFurniture, 0);
});

test('crosswalks keep to the road network as before: the furniture never costs a crossing', () => {
  // a signalized centre-line junction at x 100 on a 10 m road along x, curb islands both sides (|z| 5..40); a bench
  // and a hydrant stand at the curbs, across the crosswalk's lines just inside the part it checks (1.5 m from each end)
  const blocks = [{ poly: [] }, { poly: [] }];
  const blockAt = (x, z) => (z >= 5 && z <= 40 ? blocks[0] : z <= -5 && z >= -40 ? blocks[1] : null);
  const node = { general: true, signal: true, sideCount: 5, in: [], out: [], road: [], crosswalk: null };
  const road = { to: node, sx: 0, sz: 0, dx: 1, dz: 0, len: 98, half: 5, clx: 0, clz: 1 };
  node.road[4] = road;
  const obstacles = [box(99.25, 5.2, 0.9, 0.4), circle(100, -5.3, 0.3)].map((g) => g((x, z) => ({ x, z }), 1, 0));
  const build = (list) => load()({ walkable: () => true, onSidewalk: () => true, obstacles: list }, blockAt);
  const without = build([]).across(node), routes = build(obstacles), withFurniture = routes.across(node);
  assert.equal(without.length, 2);
  assert.equal(JSON.stringify(withFurniture.map((t) => [t.ax, t.az, t.len])), JSON.stringify(without.map((t) => [t.ax, t.az, t.len])));
  assert.equal(routes.stats.obstacles, 2);
});

test('?peddetours=0 keeps the former behaviour: blocked lines dropped, furniture ignored', () => {
  const f = fixture([[35, 42, 6.5, 6.9]], { detours: false, furniture: [box(30, 7.8, 0.9, 0.4)] });
  const tracks = f.routes.along(f.edges[0]);
  assert.equal(tracks.length, 1, 'the inner line is dropped, the outer one runs through the bench');
  assert.ok(Math.abs(tracks[0].az - 7.8) < 1e-9 && tracks[0].len === 90 && !tracks[0].after);
  assert.equal(f.routes.stats.obstacles, 0);
  assert.equal(f.routes.stats.lineBlocked, 1);
});

test('dodges keep clear of the furniture too', () => {
  const f = fixture([], { furniture: [circle(30, 8.4, 0.3)] });
  const p = { x: 30, z: 6.7, ax: 5, az: 6.7, ux: 1, uz: 0, t: 25 };
  assert.equal(f.routes.canDodge(p, -0.6), true, 'into the free sidewalk');
  assert.equal(f.routes.canDodge(p, -1.7), false, 'onto the hydrant');
});

// --- st-2t9: the walking lines on the City's sidewalk polygons (js/sidewalk-polygons.js's point test) ---
// A crossroads at the origin: four 84 m streets out of it along the axes (their stop lines 8 m out), a curb island in
// each quadrant from the curbs at |x|, |z| >= 5 out to 100 m, buildings (the road network's footprints) from `lot`, and
// on each island the walk `walk(lo, hi)` metres from the streets' centre lines, an L round the corner, with its inside
// corner cut back diagonally by `cut` (the walk sweeping round it, as the City maps a residential corner). `half` is
// the streets' half width as the road graph has it (on Toronto's one-way side streets narrower than the curbs).
const walkIndexOf = () => {
  const context = { window: { CITY: {} }, console };
  vm.createContext(context);
  vm.runInContext(readFileSync(join(__dirname, '../js/sidewalk-polygons.js'), 'utf8'), context);
  return context.window.CITY.sidewalkWalkIndex;
};
function crossroads({ half = 5, lo, hi, lot, cut = 0, mapped = [true, true, true, true], walkSides = null, signal = false, furniture = [] }) {
  const createPedestrianRoutes = load();
  const quads = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  const blocks = quads.map(([qx, qz], id) => ({ id, qx, qz, poly: [[5, 5], [100, 5], [100, 100], [5, 100]].map(([x, z]) => ({ x: x * qx, z: z * qz })) }));
  const blockAt = (x, z) => blocks.find((b) => Math.abs(x) >= 5 && Math.abs(x) <= 100 && Math.abs(z) >= 5 && Math.abs(z) <= 100 && Math.sign(x) === b.qx && Math.sign(z) === b.qz) || null;
  // (the L in the first quadrant, mirrored into the others; `walkSides` [along x, along z] leaves an arm out)
  const pieces = new Map();
  blocks.forEach((b, id) => {
    if (!mapped[id]) return;
    const [ax, az] = walkSides ? walkSides[id] : [true, true];
    const rings = [];
    if (ax && az) rings.push(cut ? [[lo, 100], [lo, lo + cut], [lo + cut, lo], [100, lo], [100, hi], [hi + cut, hi], [hi, hi + cut], [hi, 100]]
      : [[lo, 100], [lo, lo], [100, lo], [100, hi], [hi, hi], [hi, 100]]);
    else if (ax) rings.push([[lo, lo], [100, lo], [100, hi], [lo, hi]]);
    else if (az) rings.push([[lo, lo], [hi, lo], [hi, 100], [lo, 100]]);
    else rings.push([[60, 60], [70, 60], [70, 70], [60, 70]]); // (mapped, but no walk along either street)
    pieces.set(id, rings.map((r) => ({ outer: r.map(([x, z]) => ({ x: x * b.qx, z: z * b.qz })), holes: [] })));
  });
  const walks = walkIndexOf()(pieces);
  const lots = quads.map(([qx, qz]) => [Math.min(lot * qx, 100 * qx), Math.max(lot * qx, 100 * qx), Math.min(lot * qz, 100 * qz), Math.max(lot * qz, 100 * qz)]);
  const walkable = (minX, maxX, minZ, maxZ) => !lots.some(([x0, x1, z0, z1]) => maxX > x0 && minX < x1 && maxZ > z0 && minZ < z1);
  const n = { x: 0, z: 0, general: true, signal, sideCount: 4, in: [], out: [], road: [], crosswalk: null };
  const edges = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([dx, dz], side) => {
    const far = { x: dx * 100, z: dz * 100, in: [], out: [], road: [] };
    const e = { from: n, to: far, sx: dx * 8, sz: dz * 8, dx, dz, rx: -dz, rz: dx, half, len: 84, general: true, clx: Math.abs(dz), clz: Math.abs(dx) };
    n.out.push(e); far.in.push(e); n.road[side] = e;
    return e;
  });
  const build = (w) => createPedestrianRoutes({ walkable, onSidewalk: (x, z) => !!blockAt(x, z), edges,
    obstacles: furniture.map((f) => f((x, z) => ({ x, z }), 1, 0)), walks: w }, blockAt);
  return { routes: build(walks), band: build(null), walks, blockAt, walkable, edges, n, blocks };
}
const onWalkAt = (f, x, z) => { const b = f.blockAt(x, z); return !!b && f.walks.inside(b.id, x, z) === true; };
// metres of track t (every 10 cm) off the walk, past `skip` m at either end
function offWalk(f, t, skip = 0) {
  let off = 0;
  for (let s = skip; s <= t.len - skip + 1e-9; s += 0.1) if (!onWalkAt(f, t.ax + t.ux * s, t.az + t.uz * s)) off += 0.1;
  return off;
}
// the lateral offset of a track along the x street (its z) or the z street (its x)
const lateral = (t) => (Math.abs(t.ux) > 0.9 ? t.az : t.ax);

test('Euclid-style residential street: the lines move off the grass boulevard onto the mapped walk', () => {
  // a one-way side street whose road graph half width (3.5 m) is narrower than its curbs (5 m), a 3 m grass boulevard,
  // the City's 1.5 m walk 8 - 9.5 m from the centre line, the front lawns and then the houses from 14 m
  const f = crossroads({ half: 3.5, lo: 8, hi: 9.5, lot: 14, cut: 4 });
  const east = f.edges[0];
  // before (the fixed lanes, 1.7 & 2.8 m beyond the half width): both of the north side's lines on the boulevard
  const before = f.band.along(east).filter((t) => t.az > 0);
  assert.equal(before.length, 2);
  for (const t of before) {
    assert.ok(Math.abs(offWalk(f, t) - t.len) < 0.2, 'the fixed lane is on the grass all the way');
    assert.ok(t.az > 5 && t.az < 8);
  }
  // after: two lines on the walk, a third and two thirds across it, every 10 cm on it and the island
  const after = f.routes.along(east).filter((t) => t.az > 0);
  assert.equal(after.length, 2);
  assert.ok(after.every((t) => t.walk === 1 && !t.after && !t.before));
  const zs = after.map(lateral).sort((p, q) => p - q);
  assert.ok(zs[0] > 8.2 && zs[0] < 8.8 && zs[1] > 8.7 && zs[1] < 9.3 && zs[1] - zs[0] > 0.4, zs.join(', '));
  for (const t of after) assert.equal(offWalk(f, t), 0);
  // both sides of all four streets: 16 lines on the walks, none on the lawns
  const all = f.edges.flatMap((e) => f.routes.along(e));
  assert.equal(all.length, 16);
  assert.ok(all.every((t) => offWalk(f, t) === 0));
  assert.equal(f.routes.stats.walkSides, 8);
  assert.equal(f.routes.stats.bandSides, 0);
});

test('Euclid-style residential corner: the link round it follows the walk where it sweeps round the lawn', () => {
  const f = crossroads({ half: 3.5, lo: 8, hi: 9.5, lot: 14, cut: 4 });
  const east = f.routes.along(f.edges[0]).filter((t) => t.az > 0), north = f.routes.along(f.edges[1]).filter((t) => t.ax > 0);
  for (const t of east) {
    // walking west along the east street's north side to the corner, then up the north street's east side
    const ways = f.routes.links(t, -1).filter((path) => north.includes(path.at(-1).track));
    assert.equal(ways.length, 2, 'linked to both of the north street\'s lines');
    for (const path of ways) {
      const legs = path.slice(0, -1);
      assert.ok(legs.length >= 1);
      for (const leg of legs) assert.equal(offWalk(f, leg.track), 0, 'every leg on the walk, round its cut corner');
      // the legs join up, from the line's end to the next line's
      touching(endpoint(legs[0].track, 0), endpoint(t, 0));
      touching(endpoint(legs.at(-1).track, 1), endpoint(path.at(-1).track, path.at(-1).dir > 0 ? 0 : 1));
    }
  }
  assert.ok(f.routes.stats.walkLinks > 0);
  // the fixed lanes' link cut across the corner lot's lawn (its band): the walk's way is the one taken now
  const bandEast = f.band.along(f.edges[0]).filter((t) => t.az > 0);
  const bandLegs = f.band.links(bandEast[0], -1).flatMap((path) => path.slice(0, -1));
  assert.ok(bandLegs.length && bandLegs.every((leg) => offWalk(f, leg.track) > 0));
});

test('a side the City maps without a walk: none where the street has one across it, the fixed lanes where neither side does', () => {
  // the north-east island's walk runs along the north street only; the south-east one along both streets
  const f = crossroads({ half: 3.5, lo: 8, hi: 9.5, lot: 14, walkSides: [[false, true], [true, true], [true, true], [true, true]] });
  const east = f.routes.along(f.edges[0]);
  assert.ok(east.every((t) => t.az < 0), 'only the south side, which has the walk');
  assert.equal(east.length, 2);
  assert.equal(f.routes.stats.oneSided, 1);
  // a street the City maps no walk along at all (a laneway) keeps the fixed lanes both sides
  const g = crossroads({ half: 3.5, lo: 8, hi: 9.5, lot: 14, walkSides: [[false, true], [true, true], [true, true], [false, true]] });
  const lane = g.routes.along(g.edges[0]);
  assert.equal(lane.length, 4);
  assert.ok(lane.every((t) => t.walk === 2));
  assert.equal(JSON.stringify(lane.map((t) => +lateral(t).toFixed(6)).sort((p, q) => p - q)), '[-6.3,-5.2,5.2,6.3]');
  // an island without the City's sidewalks keeps the fixed lanes exactly
  const h = crossroads({ half: 5, lo: 8, hi: 9.5, lot: 14, mapped: [false, true, true, false] });
  const both = (r) => JSON.stringify(r.along(h.edges[0]).map((t) => [t.ax, t.az, t.len]));
  assert.equal(both(h.routes), both(h.band));
  assert.ok(h.routes.along(h.edges[0]).every((t) => t.walk === 0));
});

test('a downtown corner: curb-to-building walks keep the lines, crossings and links as they were, round the furniture on the walk', () => {
  // King & Spadina style: the walk from the curb (5.25 m, the slab's edge) to the building face at 10.25 m, the
  // buildings from 10.4 m; a signalized junction with a crosswalk over each street; a patio's railed strip on the east
  // street's outer line
  const patio = box(40, 7.9, 3, 0.7);
  const f = crossroads({ half: 5, lo: 5.25, hi: 10.25, lot: 10.4, signal: true, furniture: [patio] });
  // the lines where the fixed lanes ran (half width + 1.7 & 2.8 m), within the walk's 0.2 m sampling
  for (const e of f.edges.slice(1)) {
    const now = f.routes.along(e).map(lateral).sort((p, q) => p - q), was = f.band.along(e).map(lateral).sort((p, q) => p - q);
    assert.equal(now.length, 4);
    now.forEach((v, i) => assert.ok(Math.abs(v - was[i]) < 0.15, `${v} for ${was[i]}`));
  }
  // the crossings are the road network's, exactly as without the walks
  const crossings = (r) => JSON.stringify(r.across(f.n).map((t) => [t.ax, t.az, t.len, t.side, t.line]));
  assert.equal(f.routes.across(f.n).length, 8);
  assert.equal(crossings(f.routes), crossings(f.band));
  // the outer line goes round the patio on the walk, clear of it
  const east = f.routes.along(f.edges[0]).filter((t) => t.az > 0);
  assert.ok(east.some((t) => t.after), 'detoured');
  const shape = patio((x, z) => ({ x, z }), 1, 0);
  for (const t of east) {
    assert.equal(offWalk(f, t), 0);
    assertWalkable({ blockAt: f.blockAt, block: f.blocks[0], walkable: f.walkable }, [t], (x, z) => bodyClear(shape, x, z));
  }
  assert.ok(f.routes.stats.walkDetours >= 1);
  // from the east street's inner line at the corner: on to the north street's lines and both crosswalks' ends there,
  // on the walk (bar the last 1.2 m to a crossing's end)
  const start = east.find((t) => !t.before && Math.abs(t.az - 6.7) < 0.2);
  const ways = f.routes.links(start, -1);
  const north = f.routes.along(f.edges[1]).filter((t) => t.ax > 0);
  assert.ok(ways.some((p) => north.includes(p.at(-1).track)), 'round the corner');
  assert.equal(ways.filter((p) => p.at(-1).track.node).length, 4, 'onto both crossings\' lines over each street');
  for (const path of ways) {
    for (const leg of path.slice(0, -1)) assert.ok(offWalk(f, leg.track, 1.2) < 1e-9);
  }
});
