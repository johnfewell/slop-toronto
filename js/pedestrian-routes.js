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
//
// The City's sidewalks (st-2t9, docs/sidewalk-polygons.md): `walks` (sidewalk-polygons.js sidewalkWalkIndex, a point
// test on the City's mapped walk per curb island) puts each side's two lines on the walk where its island has one,
// measured from the real curb rather than the road graph's half width, which on Toronto's side streets is often
// narrower than the curbs: on a residential street with a grass boulevard the fixed lanes ran on the grass. A line
// stops short at its ends where the walk turns a corner, follows the walk where it bends away from a straight course
// (the detours' search, held to the walk), and goes round its furniture on the walk if it can (else as before, within
// the island's band). The corners' links take a way on the walk first, then the band's as before. A side of a mapped
// island with no walk has no lines where the street has a walk across it, the fixed lanes where it has none either side
// (a laneway, a park drive); an island the City doesn't map, and `walks: null` (?pedwalks=0), keep the fixed lanes and
// everything else exactly as before. The crossings and midblock crossings are the road network's, unchanged.
function createPedestrianRoutes({ walkable: roadWalkable, onSidewalk, midCrossings = [], edges = [], obstacles = [], detours = true, walks = null }, blockAt) {
  const sidewalks = new Map(), crossings = new Map(), junctions = new Map(), connections = new WeakMap();
  const CROSSWALK = window.CITY.CROSSWALK || 2.5;
  const stats = { built: 0, offIsland: 0, blocked: 0, midBuilt: 0, midOffIsland: 0, midBlocked: 0, midNoLanding: 0, blockedAt: [],
    // the sidewalk lines (one per edge side & inset): straight, round an obstacle (`detoured`, in `detourTracks` pieces),
    // or given up (`lineBlocked`: no way round on the island); `detourMs` the time the searches took
    // (`detourAt`: the first 400 detoured lines' ends [ax, az, bx, bz], for the captures). st-2t9: the edge sides
    // whose lines are on the City's walk (`walkSides`), left out where only the other side has one (`oneSided`), on the
    // fixed lanes on an island mapped without a walk either side (`unwalkedSides`) or on an island it doesn't map
    // (`bandSides`); lines `followed` along a bending walk (in `followTracks` pieces, `followTries` searches),
    // `walkDetours` round furniture on the walk, `gapBlocked` across a laneway's mouth (no search); corner links on the
    // walk (`walkLinks`) or the band (`bandLinks`); `walkMs` & `followMs` the time it took
    lines: 0, straight: 0, detoured: 0, detourTracks: 0, lineBlocked: 0, throughFurniture: 0, detourMs: 0, obstacles: 0, detourAt: [],
    walkSides: 0, oneSided: 0, unwalkedSides: 0, bandSides: 0, followed: 0, followTries: 0, followTracks: 0, walkDetours: 0,
    gapBlocked: 0, walkLinks: 0, bandLinks: 0, walkMs: 0, followMs: 0 };

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
    if (o.polygon) return polygonHitsBox(o.polygon, minX, maxX, minZ, maxZ); // (?massing=1's buildings)
    if (o.obb) {
      // (separating axes: the world's two, already apart above, then the box's own: u (cs, -sn), v (sn, cs))
      const { cx, cz, hx, hz, cs, sn } = o.obb;
      const bx = (minX + maxX) / 2 - cx, bz = (minZ + maxZ) / 2 - cz, ex = (maxX - minX) / 2, ez = (maxZ - minZ) / 2;
      if (Math.abs(bx * cs - bz * sn) >= hx + ex * Math.abs(cs) + ez * Math.abs(sn)) return false;
      if (Math.abs(bx * sn + bz * cs) >= hz + ex * Math.abs(sn) + ez * Math.abs(cs)) return false;
    }
    return true;
  }
  // a polygon outline ([{ x, z }]) and an axis-aligned box overlap: a corner of either inside the other, or crossing edges
  function polygonHitsBox(pts, minX, maxX, minZ, maxZ) {
    const n = pts.length;
    for (const p of pts) if (p.x > minX && p.x < maxX && p.z > minZ && p.z < maxZ) return true;
    const inside = (x, z) => {
      let yes = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const a = pts[i], b = pts[j];
        if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) yes = !yes;
      }
      return yes;
    };
    if (inside((minX + maxX) / 2, (minZ + maxZ) / 2)) return true;
    const cross = (ax, az, bx, bz, cx, cz, dx, dz) => {
      const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax), d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
      const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx), d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
      return d1 * d2 < 0 && d3 * d4 < 0;
    };
    const box = [[minX, minZ, maxX, minZ], [maxX, minZ, maxX, maxZ], [maxX, maxZ, minX, maxZ], [minX, maxZ, minX, minZ]];
    for (let i = 0, j = n - 1; i < n; j = i++) {
      for (const [cx, cz, dx, dz] of box) if (cross(pts[j].x, pts[j].z, pts[i].x, pts[i].z, cx, cz, dx, dz)) return true;
    }
    return false;
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

  // --- The City's sidewalks (st-2t9): where the walk runs along one side of edge e. Cross-sections every 3 m (16 at
  // most) look out from the centre line, past the roadway and any median, onto the first curb island and along it for
  // the walk nearest the curb (gaps under 0.6 m, a tree pit, bridged). The island most of them reach is the side's;
  // where the City maps its sidewalks the side's two walking lines go a third and two thirds of the way across the
  // walk's median extent (at most 1.45 m from its curb side, 1.1 m apart: where the fixed lanes ran on a wide walk).
  // Else (an island the City doesn't cover, no island alongside) null: the fixed lanes, 1.7 & 2.8 m beyond the road's
  // half width. { block, offsets: null } is an island the City maps with no walk along this side.
  const WALK_REACH = 14, WALK_STEP = 0.2;
  function walkOffsets(e, sign) {
    const K = Math.max(3, Math.min(16, Math.ceil(e.len / 3)));
    const rx = e.rx * sign, rz = e.rz * sign;
    const seen = new Map(); // island -> { n: cross-sections, at: [[s, lo, hi]] }
    for (let k = 0; k < K; k++) {
      const s = (e.len * (k + 0.5)) / K, cx = e.sx + e.dx * s, cz = e.sz + e.dz * s;
      let island = null, curb = 0, lo = -1, hi = -1;
      // (over the roadway 0.4 m at a time, along the island 0.2 m)
      for (let o = 0; o <= e.half + WALK_REACH; o += island ? WALK_STEP : 2 * WALK_STEP) {
        const x = cx + rx * o, z = cz + rz * o, b = blockAt(x, z);
        if (!island) {
          if (!b || b.median) continue;
          island = b;
          curb = o;
          if (!walks.has(b.id)) break;
        }
        if (b !== island || o - curb > WALK_REACH) break;
        if (walks.inside(b.id, x, z)) { if (lo < 0) lo = o; hi = o; }
        else if (lo >= 0 && o - hi > 0.6) break;
      }
      if (!island) continue;
      const r = seen.get(island) || seen.set(island, { n: 0, at: [] }).get(island);
      r.n++;
      if (lo >= 0) r.at.push([s, lo - WALK_STEP / 2, hi + WALK_STEP / 2]);
    }
    let block = null, best = null;
    for (const [b, r] of seen) if (!best || r.n > best.n) { block = b; best = r; }
    if (!best || best.n < K / 2 || !walks.has(block.id)) return null;
    if (best.at.length < best.n / 2) return { block, offsets: null };
    const median = (i) => best.at.map((v) => v[i]).sort((p, q) => p - q)[best.at.length >> 1];
    const lo = median(1), hi = median(2), inner = lo + Math.min(1.45, (hi - lo) * 0.3);
    return { block, offsets: [inner, Math.min(inner + 1.1, lo + (hi - lo) * 0.7)] };
  }

  function along(e) {
    if (sidewalks.has(e)) return sidewalks.get(e);
    const result = [];
    sidewalks.set(e, result);
    // Two walking lines on each side leave room for people to pass or stop together.
    // (a side of a mapped island with no walk: none where the City maps one across the street, a street with a
    // sidewalk on one side only; the fixed lanes where it maps none either side, a laneway or a park drive)
    const w0 = performance.now();
    const sides = [-1, 1].map((sign) => ({ sign, mapped: walks ? walkOffsets(e, sign) : null }));
    stats.walkMs += performance.now() - w0;
    const walkedAcross = sides.some((side) => side.mapped?.offsets);
    for (const { sign, mapped } of sides) {
      if (!mapped) stats.bandSides++;
      else if (mapped.offsets) stats.walkSides++;
      else if (walkedAcross) { stats.oneSided++; continue; }
      else stats.unwalkedSides++;
      const insets = mapped?.offsets || [e.half + 1.7, e.half + 2.8];
      for (let j = 0; j < 2; j++) {
        const off = sign * insets[j];
        let a = { x: e.sx + e.rx * off, z: e.sz + e.rz * off };
        let b = { x: a.x + e.dx * e.len, z: a.z + e.dz * e.len };
        if (mapped?.offsets) {
          // (a walk's line stops short where it would run off the walk, round a corner or off its island, by up to a
          // quarter of its length: its ends on the walk, for the corners' links to carry on along it)
          const onIt = (s) => walks.inside(mapped.block.id, a.x + e.dx * s, a.z + e.dz * s) && blockAt(a.x + e.dx * s, a.z + e.dz * s) === mapped.block;
          let s0 = 0, s1 = e.len;
          while (s0 < e.len / 4 && !onIt(s0)) s0 += 0.5;
          while (s1 > e.len * 0.75 && !onIt(s1)) s1 -= 0.5;
          if (!onIt(s0)) s0 = 0;
          if (!onIt(s1)) s1 = e.len;
          while (s0 < e.len / 4 && blockAt(a.x + e.dx * s0, a.z + e.dz * s0) !== mapped.block) s0 += 0.5;
          while (s1 > e.len * 0.75 && blockAt(a.x + e.dx * s1, a.z + e.dz * s1) !== mapped.block) s1 -= 0.5;
          if (s0 > 0 || s1 < e.len) { b = { x: a.x + e.dx * s1, z: a.z + e.dz * s1 }; a = { x: a.x + e.dx * s0, z: a.z + e.dz * s0 }; }
        }
        const block = blockAt(a.x, a.z);
        if (!block || blockAt(b.x, b.z) !== block) continue;
        if (!e.general && (!onSidewalk(a.x, a.z) || !onSidewalk(b.x, b.z))) continue;
        stats.lines++;
        let points = [a, b];
        if (!clear(a, b, block)) {
          if (!detours) { stats.lineBlocked++; continue; }
          // (the island gives out right across the detours' reach: a laneway's mouth splitting the block. No way round,
          // so no search)
          if (gapAcross(a, b, block)) { stats.lineBlocked++; stats.gapBlocked++; continue; }
          const t0 = performance.now();
          // (a walk's line round it on the walk, else as any other line: within the island's band)
          points = mapped?.offsets ? detour(a, b, block, false, true) : [];
          if (points.length >= 2) stats.walkDetours++;
          else points = detour(a, b, block, !e.general);
          stats.detourMs += performance.now() - t0;
          if (points.length < 2) {
            // no way round: dropped where the footprints block it, as before; straight through the furniture otherwise
            // (`throughFurniture`), never fewer lines than without it
            if (cells.size && clear(a, b, block, 0, roadWalkable)) { stats.throughFurniture++; points = [a, b]; }
            else { stats.lineBlocked++; continue; }
          } else stats.detoured++;
        } else if (mapped?.offsets && !onWalk(a, b, block, 0, 0, 2)) {
          // (clear, but more than 2 m of it off the walk: the walk bends, narrows or steps out round a tree pit away from
          // the line's median course. The detours' search, held to the walk, follows it where it can)
          const t0 = performance.now();
          const way = detour(a, b, block, false, true, 4, 2);
          stats.followMs += performance.now() - t0;
          stats.followTries++;
          if (way.length > 2) { stats.followed++; stats.followTracks += way.length - 1; result.push(...chain(way, e, block, 1)); continue; }
          stats.straight++;
        } else stats.straight++;
        if (points.length > 2) {
          stats.detourTracks += points.length - 1;
          if (stats.detourAt.length < 400) stats.detourAt.push([+a.x.toFixed(1), +a.z.toFixed(1), +b.x.toFixed(1), +b.z.toFixed(1)]);
        }
        result.push(...chain(points, e, block, mapped ? (mapped.offsets ? 1 : 2) : 0));
      }
    }
    return result;
  }
  // a line's tracks through points, each linked to the next (a detour's pieces: traffic.js walks on along `after` or
  // back along `before`); `walk` 1 on a mapped walk, 2 the fixed lanes on an island the City maps without one, 0 the
  // fixed lanes elsewhere
  function chain(points, e, block, walk) {
    const out = [];
    for (let i = 1, previous = null; i < points.length; i++) {
      const track = segment(points[i - 1], points[i], { edge: e, from: e.from, to: e.to, block, walk });
      if (previous) { previous.after = track; track.before = previous; }
      out.push(track);
      previous = track;
    }
    return out;
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

  // the edges whose bounds come within 25 m of the 32 m cell (x, z) is in, in their order in `edges` (a grid of them
  // made the first time it's asked: the landings' search, which used to measure every edge for every crossing's end)
  let edgeCells = null;
  function edgesNear(x, z) {
    if (!edgeCells) {
      edgeCells = new Map();
      edges.forEach((e, i) => {
        const bx = e.sx + e.dx * e.len, bz = e.sz + e.dz * e.len;
        for (let ix = Math.floor((Math.min(e.sx, bx) - 25) / 32); ix <= Math.floor((Math.max(e.sx, bx) + 25) / 32); ix++) {
          for (let iz = Math.floor((Math.min(e.sz, bz) - 25) / 32); iz <= Math.floor((Math.max(e.sz, bz) + 25) / 32); iz++) {
            const k = cellKey(ix, iz);
            (edgeCells.get(k) || edgeCells.set(k, []).get(k)).push(i);
          }
        }
      });
    }
    return (edgeCells.get(cellKey(Math.floor(x / 32), Math.floor(z / 32))) || []).map((i) => edges[i]);
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
        const near = edgesNear(end.x, end.z).filter((e) => {
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

  // Does the line from a to b leave its island somewhere the detours (2.4 m either side) can't step round?
  function gapAcross(a, b, block) {
    const L = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / L, uz = (b.z - a.z) / L, n = Math.ceil(L);
    for (let i = 0; i <= n; i++) {
      const x = a.x + (b.x - a.x) * i / n, z = a.z + (b.z - a.z) * i / n;
      if (blockAt(x, z) === block) continue;
      let open = false;
      for (let o = -2.6; o <= 2.6 && !open; o += 0.2) open = blockAt(x - uz * o, z + ux * o) === block;
      if (!open) return true;
    }
    return false;
  }

  // (st-2t9: on the City's walk all the way, every half metre, and clear as above: the test that bounds a mapped
  // walk's detours and the corners' links between its lines in place of the island's 4 m band & the curb rectangles)
  // (`endA`, `endB`: metres at a & b let off the walk, where a link meets a crossing's end, 2 m out from the curb
  // whatever lies there)
  // (`slack`: metres of it that may be off the walk)
  function onWalk(a, b, block, endA = 0, endB = 0, slack = 0) {
    const L = Math.hypot(b.x - a.x, b.z - a.z), steps = Math.ceil(L * 2), n = steps || 1;
    let off = 0;
    for (let i = 0; i <= steps; i++) {
      if (i * L / n < endA || (n - i) * L / n < endB) continue;
      if (!walks.inside(block.id, a.x + (b.x - a.x) * i / n, a.z + (b.z - a.z) * i / n) && (off += L / n) > slack) return false;
    }
    return true;
  }
  function walkClear(a, b, block, test = roadWalkable, endA = 0, endB = 0) {
    return onWalk(a, b, block, endA, endB) && clear(a, b, block, 0, test);
  }

  // The way round whatever stands on the line from a to b (2bcd413): a sidestep 0.6 or 1.2 m either way if one
  // clears it, else the cheapest path through a grid of points 2 m apart along the line and 0.6 m apart across it,
  // up to 2.4 m either side, each step to a neighbouring column and clear. Every point & step stays on the island,
  // within 4 m of its outline and clear of the footprints and furniture (cornerClear: the road and the buildings are
  // never in it); `sidewalk` also keeps it on the mapped curb rectangles (a grid street's lines). Returns the corners
  // of the path, a .. b, or [] where there's no way round (the line is dropped, as before). Bounded: at most 9 points a
  // row, 3 steps each, once per line, cached with the edge's tracks. (st-2t9: `held` keeps every point & step on the
  // City's walk instead of the island's band & rectangles; a line following a bending walk searches rows `rowLen` 4 m
  // apart, each step up to `reach` 2 columns across.)
  function detour(a, b, block, sidewalk, held = false, rowLen = 2, reach = 1) {
    const len = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / len, uz = (b.z - a.z) / len;
    const rows = Math.max(2, Math.ceil(len / rowLen)), width = 9, middle = 4;
    const step = len / rows;
    const sidewalkClear = held ? (p, q) => walkClear(p, q, block, walkable) : (p, q) => cornerClear(p, q, block, sidewalk, walkable);
    if (!sidewalkClear(a, a) || !sidewalkClear(b, b)) return [];
    // (held to the walk: first, cheaply, is there walk in every row's reach at all?)
    if (held) {
      for (let i = 1; i < rows; i++) {
        let any = false;
        for (let j = 0; j < width && !any; j++) {
          const offset = (j - middle) * 0.6;
          any = walks.inside(block.id, a.x + ux * step * i - uz * offset, a.z + uz * step * i + ux * offset);
        }
        if (!any) return [];
      }
    }
    const lead = Math.min(8, len / 3);
    for (const offset of [0.6, -0.6, 1.2, -1.2]) {
      const c = { x: a.x + ux * lead - uz * offset, z: a.z + uz * lead + ux * offset };
      const d = { x: b.x - ux * lead - uz * offset, z: b.z - uz * lead + ux * offset };
      if (sidewalkClear(c, d) && sidewalkClear(a, c) && sidewalkClear(d, b)) return [a, c, d, b];
    }
    let previous = Array.from({ length: width }, (_, j) => j === middle ? { ...a, cost: 0, previous: null } : null);
    const candidates = [];
    for (let i = 1; i <= rows; i++) {
      const row = new Array(width).fill(null);
      for (let j = 0; j < width; j++) {
        if (i === rows && j !== middle) continue;
        const offset = (j - middle) * 0.6;
        const p = { x: a.x + ux * step * i - uz * offset, z: a.z + uz * step * i + ux * offset, cost: Infinity, previous: null };
        if (!sidewalkClear(p, p)) continue;
        // (the cheapest step that's clear: each candidate's cost first, cheapest first, ties in column order, so only
        // the steps up to the first clear one are tested)
        candidates.length = 0;
        for (let k = Math.max(0, j - reach); k <= Math.min(width - 1, j + reach); k++) {
          const q = previous[k];
          if (!q) continue;
          // (a slight cost off the line: the straightest way round)
          candidates.push({ q, cost: q.cost + Math.hypot(p.x - q.x, p.z - q.z) + Math.abs(offset) * 0.02 });
        }
        candidates.sort((u, v) => u.cost - v.cost);
        for (const { q, cost } of candidates) {
          if (!sidewalkClear(q, p)) continue;
          p.cost = cost; p.previous = q;
          break;
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

  // The way from a sidewalk line's end a, heading (ax, az), to the end b of the next track, heading (bx, bz) from it:
  // straight across, else meeting the two lines' extensions, rounding the curb instead of cutting diagonally through a
  // lot; null if neither is clear. On an island the City maps (st-2t9) a way on its walk comes first (`endA`, `endB`:
  // 1.2 m at a crossing's end may leave it), then, so no corner loses a link it had, either within the island's band.
  function corner(a, b, ax, az, bx, bz, block, endA, endB) {
    let round; // [[a, c], [c, b]] (the empty one left out), c where the lines' extensions meet ahead of both, or null
    const rounding = () => {
      const cross = ax * bz - az * bx;
      if (Math.abs(cross) < 0.2) return null;
      const t = ((b.x - a.x) * bz - (b.z - a.z) * bx) / cross;
      const c = { x: a.x + ax * t, z: a.z + az * t };
      if (t < 0 || t > 20 || (b.x - c.x) * bx + (b.z - c.z) * bz < 0 || Math.hypot(b.x - c.x, b.z - c.z) > 20) return null;
      const legs = [];
      if (t > 0.01) legs.push([a, c]);
      if (Math.hypot(b.x - c.x, b.z - c.z) > 0.01) legs.push([c, b]);
      return legs;
    };
    const band = (p, q) => cornerClear(p, q, block);
    const held = (p, q) => walkClear(p, q, block, roadWalkable, p === a ? endA : 0, q === b ? endB : 0);
    for (const ok of walks && walks.has(block.id) ? [held, band] : [band]) {
      const kind = ok === held ? 'walkLinks' : 'bandLinks';
      if (ok(a, b)) { stats[kind]++; return [[a, b]]; }
      if (round === undefined) round = rounding();
      // (a & c, or c & b, the same point: tested as one, as the band always has)
      if (round && (round.length ? round.every(([p, q]) => ok(p, q)) : ok(a, b))) { stats[kind]++; return round; }
    }
    return null;
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
        const legs = corner(a, b, track.ux * dir, track.uz * dir, next.ux * nextDir, next.uz * nextDir, block, track.node ? 1.2 : 0, next.node ? 1.2 : 0);
        if (!legs) continue;
        for (const [p, q] of legs) path.push({ track: segment(p, q), dir: 1 });
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

  return { along, across, acrossMid, next, links, stats, canDodge };
}

Object.assign(window.CITY, { createPedestrianRoutes });
})();
