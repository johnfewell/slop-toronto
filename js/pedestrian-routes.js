(function () {
// js/pedestrian-routes.js
// Connected sidewalk routes for the pedestrians (mrdoob, Slop New York 0d5d574), built lazily per street & corner as
// people reach them: two walking lines along each side of a street, crosswalks over signalized corners, and the links
// that round each curb from one to the next, so walkers carry on round the block instead of pacing one track.
// Small, lazily connected sidewalk tracks. Junctions only connect points on the same curb island;
// crossing the roadway is a separate, signal-controlled track owned by traffic.js.
// Crosswalks have a lateral axis (clx, clz: their direction, the road's across) that traffic.js measures people's
// progress on (the grid's: x across north-south roads, z across east-west ones). Toronto's junctions are all the
// centre-line graph's: each side with a crosswalk (road-network.js n.crosswalk, from the City's Pedestrian Network)
// gets one where its zebra is painted. The midblock crossings (the City's midblock pedestrian signals & pedestrian
// crossovers, network.midCrossings) are tracks of their own (`mid`), landing on the sidewalks either side.
//
// Sidewalk detours (mrdoob, Slop New York 2bcd413): where something stands on a walking line (a patio, a bench, a
// shelter, a pole), a small bounded search finds a way round it on the same curb island, cached on the edge as a
// chain of tracks joined by `before` / `after`, instead of dropping the whole line. Toronto's sidewalks carry far more
// than New York's: the road network's footprints (buildings, the mapped & procedural poles, CaféTO cafés on the outer
// line) and `obstacles`, the solid street furniture the road network leaves out because its colliders are turned
// boxes or circles (Open Data benches & info pillars, transit shelters, bins, hydrants, Bike Share docks, every
// patio, the turned buildings), each tested by its own shape. The furniture only shapes the sidewalk lines and the
// dodges: crossings and the corners' links keep to the footprints, and a line with no way round its furniture runs
// straight on as it did, so it never costs a crossing, a link or a line. `detours: false` (?peddetours=0) keeps the
// former behaviour, the line dropped and the furniture ignored, for A/B.
function createPedestrianRoutes({ walkable: roadWalkable, onSidewalk, midCrossings = [], edges = [], obstacles = [], detours = true }, blockAt) {
  const sidewalks = new Map(), crossings = new Map(), junctions = new Map(), connections = new WeakMap();
  const CROSSWALK = window.CITY.CROSSWALK || 2.5;
  const stats = { built: 0, offIsland: 0, blocked: 0, midBuilt: 0, midOffIsland: 0, midBlocked: 0, midNoLanding: 0, blockedAt: [],
    // the sidewalk lines (one per edge side & inset): straight, round an obstacle (`detoured`, in `detourTracks` pieces),
    // or given up (`lineBlocked`: no way round on the island); `detourMs` the time the searches took
    // (`detourAt`: the first 400 detoured lines' ends [ax, az, bx, bz], for the captures)
    lines: 0, straight: 0, detoured: 0, detourTracks: 0, lineBlocked: 0, throughFurniture: 0, detourMs: 0, obstacles: 0, detourAt: [] };

  // The furniture, in 8 m cells: { minX.., circle } or { minX.., obb } (world-collision.js's shapes), or a plain box
  const CELL = 8, cells = new Map();
  const cellKey = (ix, iz) => (ix + 4096) * 8192 + iz + 4096;
  if (detours) {
    for (const o of obstacles) {
      if (!(o.maxX > o.minX) || !(o.maxZ > o.minZ)) continue;
      stats.obstacles++;
      for (let ix = Math.floor(o.minX / CELL); ix <= Math.floor(o.maxX / CELL); ix++) {
        for (let iz = Math.floor(o.minZ / CELL); iz <= Math.floor(o.maxZ / CELL); iz++) {
          const k = cellKey(ix, iz);
          (cells.get(k) || cells.set(k, []).get(k)).push(o);
        }
      }
    }
  }
  // does obstacle o stand in the box?
  function hits(o, minX, maxX, minZ, maxZ) {
    if (o.minX >= maxX || o.maxX <= minX || o.minZ >= maxZ || o.maxZ <= minZ) return false;
    if (o.circle) {
      const { x, z, r } = o.circle;
      const dx = x - Math.max(minX, Math.min(maxX, x)), dz = z - Math.max(minZ, Math.min(maxZ, z));
      return dx * dx + dz * dz < r * r;
    }
    if (o.obb) {
      // (separating axes: the world's two, already apart above, then the box's own: u (cs, -sn), v (sn, cs))
      const { cx, cz, hx, hz, cs, sn } = o.obb;
      const bx = (minX + maxX) / 2 - cx, bz = (minZ + maxZ) / 2 - cz, ex = (maxX - minX) / 2, ez = (maxZ - minZ) / 2;
      if (Math.abs(bx * cs - bz * sn) >= hx + ex * Math.abs(cs) + ez * Math.abs(sn)) return false;
      if (Math.abs(bx * sn + bz * cs) >= hz + ex * Math.abs(sn) + ez * Math.abs(cs)) return false;
    }
    return true;
  }
  function furnitureAt(minX, maxX, minZ, maxZ) {
    for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++) {
      for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) {
        for (const o of cells.get(cellKey(ix, iz)) || []) if (hits(o, minX, maxX, minZ, maxZ)) return true;
      }
    }
    return false;
  }
  const walkable = cells.size
    ? (minX, maxX, minZ, maxZ) => roadWalkable(minX, maxX, minZ, maxZ) && !furnitureAt(minX, maxX, minZ, maxZ)
    : roadWalkable;
  const point = (track, end) => ({ x: track.ax + track.ux * track.len * end, z: track.az + track.uz * track.len * end });
  const segment = (a, b, extra = {}) => {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    return { ax: a.x, az: a.z, ux: (b.x - a.x) / len, uz: (b.z - a.z) / len,
      len, node: null, side: 0, line: 0, mid: null, ...extra };
  };

  // (`ends`: metres at either end left unchecked: a crossing's ends stand among the corner's poles & signs, which
  // people step round)
  // (`test`: the walkers' own furniture too, or the road network's footprints alone: the crossings, the corners' links
  // and the midblock stubs keep to those, as before, so the furniture never costs a crosswalk or a connection)
  function clear(a, b, block = null, ends = 0, test = walkable) {
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(L), n = steps || 1; // (a point, a == b: one sample)
    let x = a.x, z = a.z;
    for (let i = 0; i <= steps; i++) {
      const nx = a.x + (b.x - a.x) * i / n, nz = a.z + (b.z - a.z) * i / n;
      if (ends && (i * L / n < ends || (steps - i) * L / n < ends)) { x = nx; z = nz; continue; }
      if (!test(Math.min(x, nx) - 0.4, Math.max(x, nx) + 0.4, Math.min(z, nz) - 0.4, Math.max(z, nz) + 0.4)) {
        if (!block && stats.blockedAt.length < 400) stats.blockedAt.push(+(i / n).toFixed(2));
        return false;
      }
      if (block && blockAt(nx, nz) !== block) return false;
      x = nx; z = nz;
    }
    return true;
  }

  function along(e) {
    if (sidewalks.has(e)) return sidewalks.get(e);
    const result = [];
    sidewalks.set(e, result);
    // Two walking lines on each side leave room for people to pass or stop together.
    for (const sign of [-1, 1]) {
      for (const inset of [1.7, 2.8]) {
        const off = sign * (e.half + inset);
        const a = { x: e.sx + e.rx * off, z: e.sz + e.rz * off };
        const b = { x: a.x + e.dx * e.len, z: a.z + e.dz * e.len };
        const block = blockAt(a.x, a.z);
        if (!block || blockAt(b.x, b.z) !== block) continue;
        if (!e.general && (!onSidewalk(a.x, a.z) || !onSidewalk(b.x, b.z))) continue;
        stats.lines++;
        let points = [a, b];
        if (!clear(a, b, block)) {
          if (!detours) { stats.lineBlocked++; continue; }
          const t0 = performance.now();
          points = detour(a, b, block, !e.general);
          stats.detourMs += performance.now() - t0;
          if (points.length < 2) {
            // no way round: dropped where the footprints block it, as before; straight through the furniture otherwise
            // (`throughFurniture`), never fewer lines than without it
            if (cells.size && clear(a, b, block, 0, roadWalkable)) { stats.throughFurniture++; points = [a, b]; }
            else { stats.lineBlocked++; continue; }
          } else stats.detoured++;
        } else stats.straight++;
        if (points.length > 2) {
          stats.detourTracks += points.length - 1;
          if (stats.detourAt.length < 400) stats.detourAt.push([+a.x.toFixed(1), +a.z.toFixed(1), +b.x.toFixed(1), +b.z.toFixed(1)]);
        }
        // (the pieces of a detour, each linked to the next: traffic.js walks on along `after` or back along `before`)
        for (let i = 1, previous = null; i < points.length; i++) {
          const track = segment(points[i - 1], points[i], { edge: e, from: e.from, to: e.to, block });
          if (previous) { previous.after = track; track.before = previous; }
          result.push(track);
          previous = track;
        }
      }
    }
    return result;
  }

  function across(n) {
    if (crossings.has(n)) return crossings.get(n);
    const result = [];
    crossings.set(n, result);
    if (!n.signal) return result;
    for (let side = 0; side < (n.general ? n.sideCount : 4); side++) {
      const road = n.road[side];
      if (!road || (n.crosswalk && !n.crosswalk[side])) continue;
      if (n.general || side >= 4) {
        // a centre-line junction's side: across its road where the zebra is painted, curb to curb plus 2 m, two lines
        const s = road.to === n ? road.len + CROSSWALK / 2 : -CROSSWALK / 2;
        const back = road.to === n ? -1 : 1; // (along the road, away from the junction)
        for (const line of [-0.75, 0.75]) {
          // both ends on a curb island, as the centre-line streets' sidewalk lines are (their curb rectangles are rough):
          // 2 m onto the sidewalk, further where the corner is cut back, and the line nudged back from the junction
          // where it must be
          let track = null;
          for (const nudge of [0, 1.5, 3]) {
            const cx = road.sx + road.dx * (s + back * nudge) + road.dx * line, cz = road.sz + road.dz * (s + back * nudge) + road.dz * line;
            const reach = (sgn) => {
              for (const L of [road.half + 2, road.half + 3, road.half + 4.5]) {
                const p = { x: cx + sgn * road.clx * L, z: cz + sgn * road.clz * L };
                if (blockAt(p.x, p.z)) return p;
              }
              return null;
            };
            const a = reach(-1), b = reach(1);
            if (a && b) { track = [a, b]; break; }
          }
          if (!track) { stats.offIsland++; continue; }
          if (!clear(track[0], track[1], null, 1.5, roadWalkable)) { stats.blocked++; continue; }
          stats.built++;
          result.push(segment(track[0], track[1], { node: n, side, line, from: n, to: n, clx: road.clx, clz: road.clz }));
        }
        continue;
      }
      const avenue = side >= 2, sign = side % 2 === 0 ? 1 : -1;
      for (const line of avenue ? [sign * 0.75] : [-0.75, 0.75]) {
        const a = { x: avenue ? road.x0 - road.half - 2 : n.x + sign * (n.hx + 1.25) + line,
          z: avenue ? n.z + sign * (n.hz + 1.25) + line : road.z0 - road.half - 2 };
        const len = road.half * 2 + 4;
        const b = { x: a.x + (avenue ? len : 0), z: a.z + (avenue ? 0 : len) };
        if (!onSidewalk(a.x, a.z) || !onSidewalk(b.x, b.z) || !clear(a, b, null, 0, roadWalkable)) continue;
        result.push(segment(a, b, { node: n, side, line, from: n, to: n, clx: avenue ? 1 : 0, clz: avenue ? 0 : 1 }));
      }
    }
    return result;
  }

  // A midblock crossing's tracks (two lines, curb to curb plus 2 m), and where each end lands on a sidewalk line of the
  // road it crosses: { track, t } on the nearest line within 1.6 m of the end
  const mids = new Map();
  function acrossMid(c) {
    if (mids.has(c)) return mids.get(c);
    const result = [];
    mids.set(c, result);
    const dx = -c.uz, dz = c.ux;
    for (const line of [-0.75, 0.75]) {
      const reach = (sgn) => {
        for (const L of [c.half + 2, c.half + 3, c.half + 4.5]) {
          const p = { x: c.x + sgn * c.ux * L + dx * line, z: c.z + sgn * c.uz * L + dz * line };
          if (blockAt(p.x, p.z)) return p;
        }
        return null;
      };
      const a = reach(-1), b = reach(1);
      if (!a || !b) { stats.midOffIsland++; continue; }
      if (!clear(a, b, null, 1.5, roadWalkable)) { stats.midBlocked++; continue; }
      const track = segment(a, b, { mid: c, node: null, side: 0, line, from: null, to: null, clx: c.ux, clz: c.uz });
      track.lands = [a, b].map((end) => {
        let best = null, bd = 4;
        // (the sidewalk lines of the streets within 25 m: the road it crosses, its pieces either side, a corner's)
        const near = edges.filter((e) => {
          const t = Math.max(0, Math.min(e.len, (end.x - e.sx) * e.dx + (end.z - e.sz) * e.dz));
          return Math.hypot(e.sx + e.dx * t - end.x, e.sz + e.dz * t - end.z) < 25;
        });
        for (const e of near) {
          for (const w of along(e)) {
            const t = (end.x - w.ax) * w.ux + (end.z - w.az) * w.uz;
            if (t < 0.5 || t > w.len - 0.5) continue;
            const d = Math.abs((end.x - w.ax) * w.uz - (end.z - w.az) * w.ux);
            if (d < bd) { bd = d; best = { track: w, t }; }
          }
        }
        if (best) return best;
        // no sidewalk line here (they break where a laneway splits the block): a stub along the curb island, up to
        // 30 m each way, to walk on & off by (traffic.js: whoever reaches its end out of sight leaves)
        const block = blockAt(end.x, end.z);
        const span = (sgn) => {
          let k = 0;
          for (; k < 15; k++) {
            const x = end.x + dx * sgn * 2 * (k + 1), z = end.z + dz * sgn * 2 * (k + 1);
            if (blockAt(x, z) !== block || !roadWalkable(x - 0.4, x + 0.4, z - 0.4, z + 0.4)) break;
          }
          return 2 * k;
        };
        const lo = span(-1), hi = span(1);
        if (lo + hi < 8) return null;
        const stub = segment({ x: end.x - dx * lo, z: end.z - dz * lo }, { x: end.x + dx * hi, z: end.z + dz * hi }, { stub: true, block });
        return { track: stub, t: lo };
      });
      if (!track.lands[0] || !track.lands[1]) { stats.midNoLanding++; continue; }
      stats.midBuilt++;
      result.push(track);
      // (the sidewalk lines know where people may turn off onto it)
      track.lands.forEach((land, end) => (land.track.offs || (land.track.offs = [])).push({ t: land.t, track, end }));
    }
    return result;
  }
  // every midblock crossing's tracks, built once at the start (a few hundred metres of lines)
  for (const c of midCrossings) acrossMid(c);

  function ports(n) {
    if (junctions.has(n)) return junctions.get(n);
    const result = [], seen = new Set();
    junctions.set(n, result);
    for (const e of [...n.in, ...n.out]) {
      if (seen.has(e)) continue;
      seen.add(e);
      // (a detour's first and last pieces meet the junction; the ones between only meet each other)
      const end = e.from === n ? 0 : 1;
      for (const track of along(e)) if (!(end ? track.after : track.before)) result.push({ track, end });
    }
    for (const track of across(n)) result.push({ track, end: 0 }, { track, end: 1 });
    return result;
  }

  // Stay in the sidewalk band even where angled building colliders are deliberately omitted from the road graph
  // (`sidewalk`: and on a mapped curb rectangle all the way, onSidewalk; a detour off a grid street keeps to it).
  function cornerClear(a, b, block, sidewalk = false, test = roadWalkable) {
    if (!clear(a, b, block, 0, test)) return false;
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)), n = steps || 1;
    for (let i = 0; i <= steps; i++) {
      const x = a.x + (b.x - a.x) * i / n, z = a.z + (b.z - a.z) * i / n;
      if (sidewalk && !onSidewalk(x, z)) return false;
      let near = false; // (within 4 m of the island's outline: any one edge will do)
      for (let j = 0, k = block.poly.length - 1; j < block.poly.length && !near; k = j++) {
        const p = block.poly[j], q = block.poly[k], dx = q.x - p.x, dz = q.z - p.z;
        const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (z - p.z) * dz) / (dx * dx + dz * dz || 1)));
        near = Math.hypot(x - p.x - dx * t, z - p.z - dz * t) <= 4;
      }
      if (!near) return false;
    }
    return true;
  }

  // The way round whatever stands on the line from a to b (2bcd413): a sidestep 0.6 or 1.2 m either way if one
  // clears it, else the cheapest path through a grid of points 2 m apart along the line and 0.6 m apart across it,
  // up to 2.4 m either side, each step to a neighbouring column and clear. Every point & step stays on the island,
  // within 4 m of its outline and clear of the footprints and furniture (cornerClear: the road and the buildings are
  // never in it); `sidewalk` also keeps it on the mapped curb rectangles (a grid street's lines). Returns the corners
  // of the path, a .. b, or [] where there's no way round (the line is dropped, as before). Bounded: at most 9 points a
  // row, 3 steps each, once per line, cached with the edge's tracks.
  function detour(a, b, block, sidewalk) {
    const len = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
    const rows = Math.max(2, Math.ceil(len / 2)), width = 9, middle = 4;
    const step = len / rows;
    const sidewalkClear = (p, q) => cornerClear(p, q, block, sidewalk, walkable);
    if (!sidewalkClear(a, a) || !sidewalkClear(b, b)) return [];
    const lead = Math.min(8, len / 3);
    for (const offset of [0.6, -0.6, 1.2, -1.2]) {
      const c = { x: a.x + ux * lead - uz * offset, z: a.z + uz * lead + ux * offset };
      const d = { x: b.x - ux * lead - uz * offset, z: b.z - uz * lead + ux * offset };
      if (sidewalkClear(c, d) && sidewalkClear(a, c) && sidewalkClear(d, b)) return [a, c, d, b];
    }
    let previous = Array.from({ length: width }, (_, j) => j === middle ? { ...a, cost: 0, previous: null } : null);
    for (let i = 1; i <= rows; i++) {
      const row = new Array(width).fill(null);
      for (let j = 0; j < width; j++) {
        if (i === rows && j !== middle) continue;
        const offset = (j - middle) * 0.6;
        const p = { x: a.x + ux * step * i - uz * offset, z: a.z + uz * step * i + ux * offset, cost: Infinity, previous: null };
        if (!sidewalkClear(p, p)) continue;
        for (let k = Math.max(0, j - 1); k <= Math.min(width - 1, j + 1); k++) {
          const q = previous[k];
          if (!q) continue;
          // (a slight cost off the line: the straightest way round)
          const cost = q.cost + Math.hypot(p.x - q.x, p.z - q.z) + Math.abs(offset) * 0.02;
          if (cost >= p.cost || !sidewalkClear(q, p)) continue;
          p.cost = cost; p.previous = q;
        }
        if (p.previous) row[j] = p;
      }
      if (!row.some(Boolean)) return [];
      previous = row;
    }
    let end = previous[middle];
    if (!end) return [];
    const points = [];
    while (end) { points.push({ x: end.x, z: end.z, previous: end.previous }); end = end.previous; }
    points.reverse();
    // the corners (collinear samples dropped), then each corner skipped where the one after it is in clear view
    const corners = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
      const p = corners[corners.length - 1], q = points[i], r = points[i + 1];
      if (Math.abs((q.x - p.x) * (r.z - q.z) - (q.z - p.z) * (r.x - q.x)) > 1e-6) corners.push(q);
    }
    corners.push(points[points.length - 1]);
    const result = [corners[0]];
    for (let i = 2; i < corners.length; i++) {
      if (!sidewalkClear(result[result.length - 1], corners[i])) result.push(corners[i - 1]);
    }
    result.push(corners[corners.length - 1]);
    return result.map(({ x, z }) => ({ x, z }));
  }

  function links(track, dir) {
    let ends = connections.get(track);
    if (!ends) connections.set(track, ends = []);
    const end = dir > 0 ? 1 : 0;
    if (ends[end]) return ends[end];
    const result = ends[end] = [];
    // (inside a detour: straight on to its next piece)
    const continuation = end ? track.after : track.before;
    if (continuation) { result.push([{ track: continuation, dir }]); return result; }
    const n = end ? track.to : track.from;
    if (!n) return result;
    const a = point(track, end), block = blockAt(a.x, a.z);
    if (!block) return result;
    for (const port of ports(n)) {
      const next = port.track, nextDir = port.end ? -1 : 1;
      if (next === track) continue;
      const b = point(next, port.end), distance = Math.hypot(b.x - a.x, b.z - a.z);
      if (distance > 32 || blockAt(b.x, b.z) !== block) continue;
      const path = [];
      if (distance > 0.01) {
        if (cornerClear(a, b, block)) {
          path.push({ track: segment(a, b), dir: 1 });
        } else {
          // Meeting the two offset sidewalk lines rounds the curb instead of cutting diagonally through a lot.
          const ax = track.ux * dir, az = track.uz * dir, bx = next.ux * nextDir, bz = next.uz * nextDir;
          const cross = ax * bz - az * bx;
          if (Math.abs(cross) < 0.2) continue;
          const t = ((b.x - a.x) * bz - (b.z - a.z) * bx) / cross;
          const c = { x: a.x + ax * t, z: a.z + az * t };
          if (t < 0 || t > 20 || (b.x - c.x) * bx + (b.z - c.z) * bz < 0 || Math.hypot(b.x - c.x, b.z - c.z) > 20) continue;
          if (!cornerClear(a, c, block) || !cornerClear(c, b, block)) continue;
          if (t > 0.01) path.push({ track: segment(a, c), dir: 1 });
          if (Math.hypot(b.x - c.x, b.z - c.z) > 0.01) path.push({ track: segment(c, b), dir: 1 });
        }
      }
      path.push({ track: next, dir: nextDir });
      result.push(path);
    }
    return result;
  }

  function next(track, dir, goalX, goalZ) {
    let best = null, bestScore = -Infinity;
    const a = point(track, dir > 0 ? 1 : 0);
    const gx = goalX - a.x, gz = goalZ - a.z, distance = Math.hypot(gx, gz) || 1;
    for (const path of links(track, dir)) {
      const last = path[path.length - 1], target = last.track;
      const ux = target.ux * last.dir, uz = target.uz * last.dir;
      const back = ux * track.ux * dir + uz * track.uz * dir < -0.8;
      const score = (ux * gx + uz * gz) / distance + Math.random() * 0.7 - (back ? 2 : 0);
      if (score > bestScore) { best = path; bestScore = score; }
    }
    return best;
  }

  function canDodge(p, offset) {
    const block = blockAt(p.x, p.z);
    const target = { x: p.ax + p.ux * p.t + p.uz * offset, z: p.az + p.uz * p.t - p.ux * offset };
    return !!block && onSidewalk(target.x, target.z) && cornerClear(p, target, block, false, walkable);
  }

  return { along, across, acrossMid, next, stats, canDodge };
}

Object.assign(window.CITY, { createPedestrianRoutes });
})();
