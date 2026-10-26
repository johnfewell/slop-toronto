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
function createPedestrianRoutes({ walkable, onSidewalk, midCrossings = [], edges = [] }, blockAt) {
  const sidewalks = new Map(), crossings = new Map(), junctions = new Map(), connections = new WeakMap();
  const CROSSWALK = window.CITY.CROSSWALK || 2.5;
  const stats = { built: 0, offIsland: 0, blocked: 0, midBuilt: 0, midOffIsland: 0, midBlocked: 0, midNoLanding: 0, blockedAt: [] };
  const point = (track, end) => ({ x: track.ax + track.ux * track.len * end, z: track.az + track.uz * track.len * end });
  const segment = (a, b, extra = {}) => {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    return { ax: a.x, az: a.z, ux: (b.x - a.x) / len, uz: (b.z - a.z) / len,
      len, node: null, side: 0, line: 0, mid: null, ...extra };
  };

  // (`ends`: metres at either end left unchecked: a crossing's ends stand among the corner's poles & signs, which
  // people step round)
  function clear(a, b, block = null, ends = 0) {
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(L));
    let x = a.x, z = a.z;
    for (let i = 0; i <= steps; i++) {
      const nx = a.x + (b.x - a.x) * i / steps, nz = a.z + (b.z - a.z) * i / steps;
      if (ends && (i * L / steps < ends || (steps - i) * L / steps < ends)) { x = nx; z = nz; continue; }
      if (!walkable(Math.min(x, nx) - 0.4, Math.max(x, nx) + 0.4, Math.min(z, nz) - 0.4, Math.max(z, nz) + 0.4)) {
        if (!block && stats.blockedAt.length < 400) stats.blockedAt.push(+(i / steps).toFixed(2));
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
        if (!block || blockAt(b.x, b.z) !== block || !clear(a, b, block)) continue;
        if (!e.general && (!onSidewalk(a.x, a.z) || !onSidewalk(b.x, b.z))) continue;
        result.push(segment(a, b, { edge: e, from: e.from, to: e.to, block }));
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
          if (!clear(track[0], track[1], null, 1.5)) { stats.blocked++; continue; }
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
        if (!onSidewalk(a.x, a.z) || !onSidewalk(b.x, b.z) || !clear(a, b)) continue;
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
      if (!clear(a, b, null, 1.5)) { stats.midBlocked++; continue; }
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
            if (blockAt(x, z) !== block || !walkable(x - 0.4, x + 0.4, z - 0.4, z + 0.4)) break;
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
      for (const track of along(e)) result.push({ track, end: e.from === n ? 0 : 1 });
    }
    for (const track of across(n)) result.push({ track, end: 0 }, { track, end: 1 });
    return result;
  }

  // Stay in the sidewalk band even where angled building colliders are deliberately omitted from the road graph.
  function cornerClear(a, b, block) {
    if (!clear(a, b, block)) return false;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
    for (let i = 0; i <= steps; i++) {
      const x = a.x + (b.x - a.x) * i / steps, z = a.z + (b.z - a.z) * i / steps;
      let distance = Infinity;
      for (let j = 0, k = block.poly.length - 1; j < block.poly.length; k = j++) {
        const p = block.poly[j], q = block.poly[k], dx = q.x - p.x, dz = q.z - p.z;
        const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (z - p.z) * dz) / (dx * dx + dz * dz || 1)));
        distance = Math.min(distance, Math.hypot(x - p.x - dx * t, z - p.z - dz * t));
      }
      if (distance > 4) return false;
    }
    return true;
  }

  function links(track, dir) {
    let ends = connections.get(track);
    if (!ends) connections.set(track, ends = []);
    const end = dir > 0 ? 1 : 0;
    if (ends[end]) return ends[end];
    const result = ends[end] = [];
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

  return { along, across, acrossMid, next, stats };
}

Object.assign(window.CITY, { createPedestrianRoutes });
})();
