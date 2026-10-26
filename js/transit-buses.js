(function () {
// js/transit-buses.js
// The TTC's buses on their real routes (transit.js: the timetable's stopping patterns through the city): 19 Bay,
// 97 Yonge, 75 Sherbourne, 65 Parliament, 121 Esplanade-River, 114 Queens Quay East, 29 Dufferin, 63 Ossington...
// and the streetcar routes' replacement buses, each at its headway for the hour the city's clock shows.
// - Every route's line is matched once to the road network's links (traffic.js / road-network.js): the cheapest way
//   through the links lying along it, heading its way; its stops put on those links, in order.
// - The whole timetable runs as positions along the routes (the timetable's own speed, stops included); the few buses
//   traffic.js has (quality.js `buses`) take the scheduled buses nearest the player, and drive them there like any
//   traffic (lanes, signals, the cars ahead), pulling in to the curb at the stops and dwelling. Out of range, a bus goes
//   back to being a position along its route, and its bus to the next scheduled one coming near.
// - Cost: the matching at the start (a few ms a route); a frame, a step per scheduled bus.

const { TRANSIT } = window.CITY;

function createTransitBuses(traffic) {
  const pats = TRANSIT ? TRANSIT.ofType(3) : [];
  if (!traffic || !traffic.setBusRouter || !traffic.network || !pats.length) return null;
  const { edges } = traffic.network;
  const t0 = performance.now();

  // links by 40 m cells (each in every cell its length passes)
  const CELL = 40;
  const grid = new Map();
  for (const e of edges) {
    if (!(e.len > 0)) continue;
    const ex = e.sx + e.dx * e.len, ez = e.sz + e.dz * e.len;
    for (let ix = Math.floor(Math.min(e.sx, ex) / CELL); ix <= Math.floor(Math.max(e.sx, ex) / CELL); ix++) {
      for (let iz = Math.floor(Math.min(e.sz, ez) / CELL); iz <= Math.floor(Math.max(e.sz, ez) / CELL); iz++) {
        const k = ix * 100000 + iz;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(e);
      }
    }
  }

  // The route's line matched to the links. The timetable's lines are rough (points 50-150 m apart, cutting corners)
  // and the city's roads are the city's, so no link is ruled out within REACH m of the line: each costs its length,
  // more the further it strays from the line (squared), much more heading against it (the other carriageway), a little
  // more up on a deck (the Gardiner over Lake Shore); the cheapest chain of moves (Dijkstra) from a link on the line
  // near its start to one near its end, never going far back along it.
  const REACH = 120, LC = 40;
  function match(pat) {
    const S = [];
    for (let i = 0; i + 1 < pat.pts.length; i++) {
      const a = pat.pts[i], b = pat.pts[i + 1];
      const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / 6));
      for (let k = 0; k < n; k++) S.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
    }
    S.push(pat.pts[pat.pts.length - 1]);
    S.forEach((p, j) => {
      const a = S[Math.max(0, j - 2)], b = S[Math.min(S.length - 1, j + 2)];
      const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      p.dx = (b.x - a.x) / L;
      p.dz = (b.z - a.z) / L;
    });
    const SG = new Map();
    S.forEach((p, j) => {
      const k = Math.floor(p.x / LC) * 100000 + Math.floor(p.z / LC);
      if (!SG.has(k)) SG.set(k, []);
      SG.get(k).push(j);
    });
    const R = Math.ceil(REACH / LC);
    const nearest = (x, z) => {
      let bj = -1, bd = REACH;
      const ix = Math.floor(x / LC), iz = Math.floor(z / LC);
      for (let a = -R; a <= R; a++) {
        for (let c = -R; c <= R; c++) {
          for (const j of SG.get((ix + a) * 100000 + iz + c) || []) {
            const d = Math.hypot(S[j].x - x, S[j].z - z);
            if (d < bd) {
              bd = d;
              bj = j;
            }
          }
        }
      }
      return bj < 0 ? null : { j: bj, d: bd };
    };
    // the links along the line
    const cand = new Map();
    const seen = new Set();
    for (let j = 0; j < S.length; j += 3) {
      const p = S[j];
      const gx = Math.floor(p.x / CELL), gz = Math.floor(p.z / CELL);
      for (let a = -R; a <= R; a++) {
        for (let c = -R; c <= R; c++) {
          for (const e of grid.get((gx + a) * 100000 + gz + c) || []) {
            if (seen.has(e)) continue;
            seen.add(e);
            const n = Math.max(2, Math.ceil(e.len / 10));
            let sum = 0, dot = 0, hits = 0, j0 = Infinity, j1 = -1;
            for (let k = 0; k <= n; k++) {
              const s = (e.len * k) / n;
              const q = nearest(e.sx + e.dx * s, e.sz + e.dz * s);
              if (!q) {
                sum += REACH;
                continue;
              }
              hits++;
              sum += q.d;
              dot += S[q.j].dx * e.dx + S[q.j].dz * e.dz;
              j0 = Math.min(j0, q.j);
              j1 = Math.max(j1, q.j);
            }
            if (!hits) continue;
            const mean = sum / (n + 1);
            dot /= hits;
            const k = Math.min(400, 1 + (mean / 8) ** 2) * (dot < -0.2 ? 30 : dot < 0.4 ? 3 : 1) * ((e.h0 || 0) > 2 || (e.h1 || 0) > 2 ? 1.5 : 1);
            cand.set(e, { cost: e.len * k + 4, j0, j1, on: mean < 25 && dot > 0.5 });
          }
        }
      }
    }
    // Dijkstra over the moves
    const N = S.length;
    const dist = new Map(), prev = new Map();
    const heap = [];
    const push = (e, d) => {
      heap.push([d, e]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    let minJ = Infinity, maxJ = -1;
    for (const c of cand.values()) {
      if (!c.on) continue;
      minJ = Math.min(minJ, c.j0);
      maxJ = Math.max(maxJ, c.j1);
    }
    // (the line may start or end off the roads: in a station's bus bays)
    if (minJ + 12 > N / 3 || maxJ - 12 < (2 * N) / 3) {
      match.why = `${N} pts, ${cand.size} links, along ${minJ}-${maxJ}`;
      return null;
    }
    // Where the roads don't go on as the line does (a link missing from the city's network), the route is cut there
    // and goes on from the next link on the line beyond: pieces, each driven on its own
    const pieces = [];
    let from = minJ;
    while (from < maxJ - 12) {
      const startJ = from + 12, endJ = maxJ - 12;
      dist.clear();
      prev.clear();
      heap.length = 0;
      for (const [e, c] of cand) {
        if (c.on && c.j0 >= from && c.j0 <= startJ) {
          dist.set(e, c.cost);
          push(e, c.cost);
        }
      }
      let goal = null, far = null, reached = -1;
      while (heap.length) {
        const [d, e] = pop();
        if (d > dist.get(e)) continue;
        const c = cand.get(e);
        if (c.on && (c.j1 > reached || (c.j1 === reached && d < dist.get(far)))) {
          reached = c.j1;
          far = e;
        }
        if (c.on && c.j1 >= endJ) {
          goal = e;
          break;
        }
        for (const m of e.moves) {
          const f = m.to, cf = cand.get(f);
          if (!cf || cf.j1 < c.j0 - 15) continue; // (not far back along the line)
          const nd = d + cf.cost + (m.turn === 'S' ? 0 : 6);
          if (nd < (dist.get(f) ?? Infinity)) {
            dist.set(f, nd);
            prev.set(f, e);
            push(f, nd);
          }
        }
      }
      const end = goal || far;
      if (!end) break;
      const chain = [];
      for (let e = end; e; e = prev.get(e)) chain.push(e);
      chain.reverse();
      if (chain.reduce((t, e) => t + e.len, 0) > 250) pieces.push(chain);
      if (goal) break;
      // on from the next link on the line beyond the break
      let next = Infinity;
      for (const c of cand.values()) if (c.on && c.j0 > reached && c.j0 < next) next = c.j0;
      if (!Number.isFinite(next)) break;
      from = next;
    }
    if (!pieces.length) match.why = `${N} pts, ${cand.size} links, no piece`;
    return pieces;
  }

  // Each route: its links, their distances along it (a junction counted 10 m), its stops on them
  const routes = [];
  const failed = [], cut = [];
  for (const pat of pats) {
    const pieces = match(pat);
    if (!pieces || !pieces.length) {
      failed.push(`${pat.sign[0]} (${match.why})`);
      continue;
    }
    if (pieces.length > 1) cut.push(`${pat.sign[0]} (${pieces.length})`);
    for (const links of pieces) {
      const cum = [0];
      for (let i = 0; i < links.length; i++) cum.push(cum[i] + links[i].len + 10);
      const len = cum[links.length];
      const stops = [];
      let i0 = 0;
      for (const st of pat.stops) {
        let best = null, bd = 18;
        for (let i = i0; i < links.length; i++) {
          const e = links[i];
          const a = (st.x - e.sx) * e.dx + (st.z - e.sz) * e.dz;
          if (a < -5 || a > e.len + 5) continue;
          const lat = Math.abs((st.x - e.sx) * e.rx + (st.z - e.sz) * e.rz);
          if (lat < bd) {
            bd = lat;
            best = { ei: i, s: Math.max(9, Math.min(e.len - 9, a)), name: st.name };
          }
        }
        if (!best || (stops.length && best.ei === stops[stops.length - 1].ei && best.s - stops[stops.length - 1].s < 30)) continue;
        i0 = best.ei;
        stops.push(best);
      }
      routes.push({ pat, links, cum, len, stops, sign: pat.sign, signRow: 0, buses: [], clock: 0, headway: Infinity });
    }
  }
  const signs = TRANSIT.busSigns('busSign');
  for (const r of routes) r.signRow = signs ? signs.rowOf(r.sign) : 0;

  // The scheduled buses: positions along the routes, a bus each when near
  const thin = Math.max(1, 12 / Math.max(1, (window.CITY.QUALITY.buses || 12))) ** 0.5; // (the phone tiers: a little thinner)
  function setHeadways(fill) {
    for (const r of routes) {
      const H = TRANSIT.headway(r.pat) * thin;
      r.headway = H;
      if (!Number.isFinite(H)) {
        r.clock = Infinity;
        continue;
      }
      const gap = H * r.pat.speed;
      if (fill) {
        const phase = Math.random();
        for (let d = phase * gap; d < r.len; d += gap) r.buses.push({ r, d, real: null });
        r.clock = (1 - phase) * H;
      } else r.clock = Math.min(Number.isFinite(r.clock) ? r.clock : Infinity, Math.random() * H);
    }
  }
  setHeadways(true);
  TRANSIT.onHour(() => setHeadways(false));

  const near = traffic.NEAR_RADIUS || 350;
  const at = (r, d) => {
    // the link & distance along it at d along the route
    let lo = 0, hi = r.links.length;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (r.cum[mid] <= d) lo = mid;
      else hi = mid;
    }
    return { i: lo, s: d - r.cum[lo] };
  };
  const posOf = (r, d, out) => {
    const { i, s } = at(r, d);
    const e = r.links[i];
    const ss = Math.min(e.len, s);
    out.x = e.sx + e.dx * ss;
    out.z = e.sz + e.dz * ss;
    return out;
  };
  const tmp = { x: 0, z: 0 };

  // Live (transit-live.js): each bus in the TTC's feed at its spot along a route of its number (on a road link
  // heading its way within 20 m), run on from there at the schedule speed; on the road, its driver hurried or held to
  // keep up (desired speed). A route with buses in the feed runs on them alone; without a feed, the timetable.
  let liveRoutes = new Set();
  const liveBuses = new Map(); // vehicle id -> scheduled bus
  function snapLive(v) {
    let best = null, bd = 20;
    for (const r of routes) {
      if (r.pat.route !== v.route) continue;
      r.links.forEach((e, i) => {
        if (v.h && e.dx * v.h.x + e.dz * v.h.z < 0.3) return;
        const a = (v.x - e.sx) * e.dx + (v.z - e.sz) * e.dz;
        if (a < -5 || a > e.len + 5) return;
        const lat = Math.abs((v.x - e.sx) * e.rx + (v.z - e.sz) * e.rz) + (Number.isFinite(r.headway) ? 0 : 8);
        if (lat < bd) {
          bd = lat;
          best = { r, d: r.cum[i] + Math.max(0, Math.min(e.len, a)) };
        }
      });
    }
    return best;
  }
  if (TRANSIT.onLive) {
    TRANSIT.onLive((L) => {
      const now = Date.now();
      if (L.mode !== 'live') {
        for (const b of liveBuses.values()) b.live = null;
        liveBuses.clear();
        liveRoutes = new Set();
        return;
      }
      const seen = new Set(), on = new Set();
      for (const v of L.vehicles) {
        const m = snapLive(v);
        if (!m) continue;
        seen.add(v.id);
        on.add(v.route);
        let b = liveBuses.get(v.id);
        if (b && b.r !== m.r && !b.real) {
          b.r.buses.splice(b.r.buses.indexOf(b), 1);
          b = null;
        }
        if (!b) {
          b = { r: m.r, d: m.d, real: null };
          m.r.buses.push(b);
          liveBuses.set(v.id, b);
        }
        b.live = { d: m.d, at: now - Math.min(120000, Math.max(0, now - v.ts)) };
      }
      for (const [id, b] of liveBuses) {
        if (seen.has(id)) continue;
        b.live = null;
        liveBuses.delete(id);
      }
      liveRoutes = on;
      // the timetable's buses on routes now running live, not on the road: gone
      for (const r of routes) {
        if (!liveRoutes.has(r.pat.route)) continue;
        r.buses = r.buses.filter((b) => b.live || b.real);
      }
    });
  }

  // traffic.js asks for a bus to put on the road: the nearest scheduled one in range without one
  function spawn(v, jump) {
    if (v.route && v.route.sched) v.route.sched.real = null;
    const f = traffic.focus();
    let best = null, bd = near;
    for (const r of routes) {
      for (const b of r.buses) {
        if (b.real) continue;
        posOf(r, b.d, tmp);
        const d = Math.hypot(tmp.x - f.x, tmp.z - f.z);
        if (d < bd && (jump || d > 60 || b.d < 40)) {
          bd = d;
          best = b;
        }
      }
    }
    if (best) {
      const r = best.r;
      let { i, s } = at(r, best.d);
      if (s > r.links[i].len - v.half - 3 && i + 1 < r.links.length) {
        i++;
        s = v.half + 3;
      }
      const e = r.links[i];
      let k = 0;
      while (k < r.stops.length && (r.stops[k].ei < i || (r.stops[k].ei === i && r.stops[k].s < s + v.half + 2))) k++;
      v.route = { edges: r.links, i, stops: r.stops, k, sign: r.sign, signRow: r.signRow, sched: best, off: null };
      // the curb lane if it leads on along the route, else any that does
      const next = r.links[i + 1];
      const mv = next && e.moves.find((m) => m.to === next);
      let lane = e.lanes.length - 1;
      if (mv && mv.out[lane] < 0) lane = mv.out.findIndex((o) => o >= 0);
      if (lane >= 0 && traffic.placeBus(v, e, lane, s, !jump)) {
        best.real = v;
        return true;
      }
      v.route = null;
    }
    traffic.retireBus(v);
    return false;
  }

  function update(dt) {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.25);
    const now = Date.now();
    for (const r of routes) {
      // a bus enters at the route's start every headway
      if (Number.isFinite(r.clock) && !liveRoutes.has(r.pat.route)) {
        r.clock -= dt;
        if (r.clock <= 0) {
          r.buses.push({ r, d: 0, real: null });
          r.clock += r.headway;
          if (r.clock < 0) r.clock = r.headway;
        }
      }
      for (let k = r.buses.length - 1; k >= 0; k--) {
        const b = r.buses[k];
        const v = b.real;
        // live: where the feed saw it, run on at the schedule speed
        const want = b.live ? b.live.d + r.pat.speed * ((now - b.live.at) / 1000) : NaN;
        if (v) {
          // on the road: where its bus is (until traffic.js takes it for another, or it leaves the route)
          if (v.route && v.route.sched === b && !v.route.off && v.edge) {
            b.d = Math.max(b.d, r.cum[v.route.i] + Math.max(0, v.s));
            if (v.baseV0 === undefined) v.baseV0 = v.v0;
            // (live: its driver hurried or held to keep up with the feed)
            v.v0 = b.live ? Math.max(3, Math.min(15, v.baseV0 * (1 + (want - b.d) / 120))) : v.baseV0;
            continue;
          }
          if (v.baseV0 !== undefined) v.v0 = v.baseV0;
          b.real = null;
          if (v.route && v.route.sched === b) v.route.sched = null;
        }
        b.d = b.live ? Math.min(r.len, want) : b.d + r.pat.speed * dt;
        if (b.d >= r.len) {
          r.buses.splice(k, 1);
          for (const [id, lb] of liveBuses) if (lb === b) liveBuses.delete(id);
        }
      }
    }
  }

  // How often the scheduled buses pass the middle of each route over `seconds` (checking the timetable; the positions only)
  function simulate(seconds = 3600, step = 0.25) {
    const passes = new Map(routes.map((r) => [r, []]));
    for (let t = 0; t < seconds; t += step) {
      const before = new Map(routes.map((r) => [r, r.buses.map((b) => [b, b.d])]));
      update(step);
      for (const r of routes) for (const [b, d] of before.get(r)) if (d < r.len / 2 && b.d >= r.len / 2) passes.get(r).push(t);
    }
    return routes.map((r) => {
      const ts = passes.get(r), gaps = ts.slice(1).map((x, i) => x - ts[i]);
      return { route: r.sign.join(' / '), dir: r.pat.dir, len: Math.round(r.len), links: r.links.length, stops: r.stops.length, of: r.pat.stops.length, gtfsPerHour: r.pat.perHour[TRANSIT.hour], gtfsHeadway: Math.round(TRANSIT.headway(r.pat)), simPasses: ts.length, simHeadway: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null };
    });
  }

  traffic.setBusRouter({ spawn });
  const nb = routes.reduce((t, r) => t + r.buses.length, 0);
  if (cut.length) console.info(`[transit] bus routes cut where the city's roads don't go on as the TTC's do: ${cut.join(', ')}`);
  console.info(`[transit] ${routes.length} bus routes on the roads (${[...new Set(routes.map((r) => r.pat.route))].join(', ')}), ${nb} buses scheduled at ${TRANSIT.hour}:00, ${routes.reduce((t, r) => t + r.stops.length, 0)} stops; matched in ${Math.round(performance.now() - t0)} ms${failed.length ? `; not matched: ${failed.join(', ')}` : ''}`);
  return { routes, update, simulate, liveBuses };
}

Object.assign(window.CITY, { createTransitBuses });
})();
