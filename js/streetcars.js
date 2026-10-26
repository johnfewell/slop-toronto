(function () {
// js/streetcars.js
// The TTC's streetcars on the real network (OpenStreetMap's tram tracks, GEO.rails from tools/geo-rails.mjs): 501
// Queen out to the Humber Loop, 504 King, 505 Dundas, 506 College, 509 Harbourfront & 510 Spadina on their rights-of-way
// (down into the Union Station loop's tunnel), 511 Bathurst, Cherry St... Ported from aalghooneh/slop-toronto's
// js/streetcars.js (MIT) to this city's classic scripts, geodata, decks, quality tiers & culling.
// - Tracks: every main track's ways chained into continuous runs, going straight on through the junctions; each run is
//   driven the way right-hand traffic uses it (the side of the street it lies on). The rails are set into the road in
//   a concrete track bed (on the raised rights-of-way of Spadina & Queens Quay), ride the bridges' decks (the Queen St
//   & Dundas St bridges over the Don) and dip into the tunnels; the overhead contact wire hangs above them.
// - Cars: 30 m, five-section Flexity Outlook streetcars in TTC red, articulated along the curves. They dwell at the
//   real stops, wait at red lights, queue behind the traffic (traffic.js) and the player, and shove the player aside on
//   contact; traffic.js in turn keeps behind them (setObstacles).
// - Cost: the trackwork is cut into 700 m tiles hidden beyond ~1.2 km; only the cars within DRAW_RADIUS are drawn (all
//   of them run). Fleet size by quality tier (quality.js `streetcarSpacing`).

const { THREE, GEO, QUALITY, blockAt, deckHeightAt, railLiftAt, railSpanAt, SIGNALS, ROADS, cityUniforms } = window.CITY;
const { Fn, color, mix, step, smoothstep, abs, uv, positionGeometry, normalGeometry, float, vec2, texture, attribute } = window.CITY.TSL;
const { mergeGeometries } = window.CITY.Addons;

const GAUGE = 1.495; // TTC broad gauge (4 ft 10 7/8 in)
const SECTIONS = [6.6, 5.7, 5.4, 5.7, 6.6]; // module lengths, nose to tail (30.2 m with the gangways)
const DOORS = [-1.2, 0, null, 0, 1.2]; // a double door per module (local z of its centre; the cab modules behind the cab)
const GANGWAY = 0.55;
const CAR_LEN = SECTIONS.reduce((t, l) => t + l, 0) + GANGWAY * (SECTIONS.length - 1);
const HALF_W = 1.27;
const HEIGHT = 3.84;
const MAX_SPEED = 11.5; // m/s (~41 km/h, downtown)
const ACCEL = 1.1;
const DECEL = 1.4;
const DWELL = 15; // s at a stop (x 0.7-1.3)
const WIRE_Y = 5.6;
const TILE = 700; // trackwork tiles (m)
const TRACK_DRAW = 1200; // trackwork drawn within (m, x the tier's cull)
const DRAW_RADIUS = 1100; // cars drawn within (m, x the tier's cull)
const NEAR = 450; // cars within this of the camera see the traffic & are obstacles to it

const toPts = (flat) => {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ x: flat[i], z: flat[i + 1] });
  return out;
};

// ---------------------------------------------------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------------------------------------------------
// The main tracks (and the loops) chained into continuous runs: at each end, on into the way going most nearly
// straight on (within 60°). Every point keeps the flags of the way it came from (1 bridge, 2 tunnel).
function chainWays(ways) {
  const key = (p) => `${Math.round(p.x * 2)},${Math.round(p.z * 2)}`;
  const ends = new Map();
  const addEnd = (k, w, atStart) => {
    if (!ends.has(k)) ends.set(k, []);
    ends.get(k).push({ w, atStart });
  };
  ways.forEach((w, i) => {
    addEnd(key(w[0]), i, true);
    addEnd(key(w[w.length - 1]), i, false);
  });
  const used = new Set();
  const dir = (a, b) => {
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return [(b.x - a.x) / L, (b.z - a.z) / L];
  };
  function extend(chain) {
    for (;;) {
      const last = chain[chain.length - 1];
      const d = dir(chain[chain.length - 2], last);
      let best = null;
      let bd = 0.5;
      for (const c of ends.get(key(last)) || []) {
        if (used.has(c.w)) continue;
        const pts = c.atStart ? ways[c.w] : ways[c.w].slice().reverse();
        const nd = dir(pts[0], pts[1]);
        const dot = d[0] * nd[0] + d[1] * nd[1];
        if (dot > bd) {
          bd = dot;
          best = { c, pts };
        }
      }
      if (!best) return;
      used.add(best.c.w);
      chain.push(...best.pts.slice(1));
    }
  }
  const order = ways.map((w, i) => i).sort((a, b) => ways[b].length - ways[a].length);
  const chains = [];
  for (const i of order) {
    if (used.has(i) || ways[i].length < 2) continue;
    used.add(i);
    const chain = ways[i].slice();
    extend(chain);
    chain.reverse();
    extend(chain);
    chain.reverse();
    chains.push(chain);
  }
  return chains;
}

// A polyline resampled every ~2 m with arc lengths and heights: the road deck under it followed like a vehicle would
// (deckHeightAt, stepping at most 0.45 m every 2 m (the decks start 0.3 m up): up a bridge's approach ramp, never onto a flyover passing overhead), the raised
// right-of-way (a curb island), and in a tunnel a 9% dive to 7.5 m down
function makeTrack(src, step = 2) {
  const pts = [{ x: src[0].x, z: src[0].z, f: src[0].f || 0, y: 0 }];
  for (let i = 1; i < src.length; i++) {
    const a = src[i - 1];
    const b = src[i];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) pts.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n, f: b.f || 0, y: 0 });
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  let deck = 0;
  for (const p of pts) {
    deck = deckHeightAt(p.x, p.z, deck, 0.225 * step);
    p.y = Math.max(deck, blockAt(p.x, p.z) ? 0.22 : 0);
  }
  // tunnels: depth by the distance from the nearest portal along the track
  const into = pts.map(() => Infinity);
  let d = Infinity;
  for (let i = 0; i < pts.length; i++) {
    d = pts[i].f & 2 ? d + (i ? cum[i] - cum[i - 1] : 0) : 0;
    into[i] = d;
  }
  d = Infinity;
  for (let i = pts.length - 1; i >= 0; i--) {
    d = pts[i].f & 2 ? d + (i < pts.length - 1 ? cum[i + 1] - cum[i] : 0) : 0;
    into[i] = Math.min(into[i], d);
  }
  pts.forEach((p, i) => {
    if (p.f & 2) p.y = -Math.min(7.5, (Number.isFinite(into[i]) ? into[i] : 1e3) * 0.09);
  });
  return { pts, cum, len: cum[cum.length - 1], stops: [], signals: [] };
}

function sample(track, s, out) {
  const { pts, cum } = track;
  s = Math.max(0, Math.min(track.len, s));
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const a = pts[lo];
  const b = pts[hi];
  const t = (s - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo]);
  out.x = a.x + (b.x - a.x) * t;
  out.z = a.z + (b.z - a.z) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.yaw = Math.atan2(b.x - a.x, b.z - a.z);
  return out;
}

// A grid of points (stops, signalised junctions) and, per track, the nearest along it of those within `reach` m
function pointGrid(items, cell) {
  const grid = new Map();
  for (const it of items) {
    const k = Math.floor(it.x / cell) * 100000 + Math.floor(it.z / cell);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(it);
  }
  return { grid, cell };
}
function nearAlong(track, G, reach) {
  const best = new Map(); // item -> { s, d }
  const { pts, cum } = track;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const ix = Math.floor(p.x / G.cell);
    const iz = Math.floor(p.z / G.cell);
    for (let a = -1; a <= 1; a++) {
      for (let c = -1; c <= 1; c++) {
        for (const it of G.grid.get((ix + a) * 100000 + iz + c) || []) {
          const d = Math.hypot(it.x - p.x, it.z - p.z);
          if (d > reach) continue;
          const b = best.get(it);
          if (!b || d < b.d) best.set(it, { s: cum[i], d });
        }
      }
    }
  }
  return best;
}

// The traffic's roads the streetcars run along get e.tram (John: "there shouldn't be buses on streetcar routes": the
// TTC runs streetcars there, not buses; traffic.js keeps its buses off them): most of the road's length, from 20% to 80%
// along its middle, within its half-width (+1.5 m) of a track
function markStreetcarStreets(network, tracks) {
  const pts = [];
  for (const t of tracks) for (let i = 0; i < t.pts.length; i += 2) if (t.pts[i].y > -1) pts.push(t.pts[i]);
  const G = pointGrid(pts, 20);
  const nearTrack = (x, z, reach) => {
    const ix = Math.floor(x / G.cell), iz = Math.floor(z / G.cell);
    for (let a = -1; a <= 1; a++) {
      for (let c = -1; c <= 1; c++) {
        for (const p of G.grid.get((ix + a) * 100000 + iz + c) || []) if (Math.hypot(p.x - x, p.z - z) < reach) return true;
      }
    }
    return false;
  };
  let marked = 0;
  for (const e of (network && network.edges) || []) {
    if (!(e.len > 0)) continue;
    const reach = (e.half || 6) + 1.5;
    let hits = 0;
    for (let k = 1; k <= 5; k++) {
      const s = e.len * (0.1 + 0.15 * k);
      if (nearTrack(e.sx + e.dx * s, e.sz + e.dz * s, reach)) hits++;
    }
    e.tram = hits >= 3;
    if (e.tram) marked++;
  }
  console.info(`[streetcars] ${marked} road links carry streetcars (no buses on them)`);
}

function buildTracks(network) {
  const ways = [];
  for (const [kind, service, name, flags, flat] of GEO.rails || []) {
    if (kind !== 0 || (service && !/Loop/i.test(name))) continue;
    ways.push(toPts(flat).map((p) => ({ x: p.x, z: p.z, f: flags })));
  }
  const tracks = chainWays(ways).map((w) => makeTrack(w)).filter((t) => t.len > 150);

  // Direction of travel on each track: right-hand traffic's. Where the track lies off the middle of its street (two
  // tracks), the side it lies on; on the middle (single track, loops), the way the traffic drives in the lanes it
  // shares; failing both, the real stops along it (a stop stands to the right of the track in the direction of travel)
  const tmp = { x: 0, z: 0, y: 0, yaw: 0 };
  const CELL = 50;
  const cellOf = (x, z) => Math.floor(x / CELL) * 100000 + Math.floor(z / CELL);
  const addTo = (grid, item, x0, x1, z0, z1) => {
    for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++) {
      for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++) {
        const k = ix * 100000 + iz;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(item);
      }
    }
  };
  const streetSegs = new Map();
  for (const r of ROADS) {
    if (r.raised) continue;
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < 1) continue;
      const seg = { ax: a.x, az: a.z, ux: (b.x - a.x) / L, uz: (b.z - a.z) / L, L, oneway: r.dir !== 0 };
      addTo(streetSegs, seg, Math.min(a.x, b.x) - 12, Math.max(a.x, b.x) + 12, Math.min(a.z, b.z) - 12, Math.max(a.z, b.z) + 12);
    }
  }
  const edgeGrid = new Map();
  for (const e of (network && network.edges) || []) {
    const ex = e.sx + e.dx * e.len, ez = e.sz + e.dz * e.len;
    addTo(edgeGrid, e, Math.min(e.sx, ex) - 10, Math.max(e.sx, ex) + 10, Math.min(e.sz, ez) - 10, Math.max(e.sz, ez) + 10);
  }
  const stopList = [];
  const S = GEO.tramStops || [];
  for (let i = 0; i < S.length; i += 3) stopList.push({ x: S[i], z: S[i + 1], name: S[i + 2] });
  const stopGrid = pointGrid(stopList, 20);
  const rightOf = (t, s, x, z) => {
    sample(t, s, tmp);
    return (x - tmp.x) * -Math.cos(tmp.yaw) + (z - tmp.z) * Math.sin(tmp.yaw);
  };
  for (const t of tracks) {
    let side = 0;
    let lanes = 0;
    for (let s = 10; s < t.len - 10; s += 20) {
      sample(t, s, tmp);
      const fx = Math.sin(tmp.yaw), fz = Math.cos(tmp.yaw);
      // the nearest street centre line running alongside
      let best = null, bestD = 12;
      for (const g of streetSegs.get(cellOf(tmp.x, tmp.z)) || []) {
        if (Math.abs(g.ux * fx + g.uz * fz) < 0.9) continue;
        const px = tmp.x - g.ax, pz = tmp.z - g.az;
        const a = px * g.ux + pz * g.uz;
        if (a < 0 || a > g.L) continue;
        const lat = px * -g.uz + pz * g.ux; // right of the street's way (x east, z south)
        if (Math.abs(lat) < bestD) {
          bestD = Math.abs(lat);
          best = { g, lat };
        }
      }
      if (best && !best.g.oneway && Math.abs(best.lat) > 0.8) side += Math.sign(best.lat) * Math.sign(best.g.ux * fx + best.g.uz * fz);
      for (const e of edgeGrid.get(cellOf(tmp.x, tmp.z)) || []) {
        const px = tmp.x - e.sx, pz = tmp.z - e.sz;
        const a = px * e.dx + pz * e.dz;
        if (a < 0 || a > e.len) continue;
        const lat = px * e.rx + pz * e.rz;
        if (e.lanes.some((o) => Math.abs(lat - o) < 1.6)) lanes += Math.sign(fx * e.dx + fz * e.dz);
      }
    }
    let vote = Math.abs(side) >= 3 ? side : lanes;
    if (!vote) for (const [st, { s }] of nearAlong(t, stopGrid, 14)) vote += rightOf(t, s, st.x, st.z) > 0 ? 1 : -1;
    if (vote < 0) {
      t.pts.reverse();
      t.cum = t.cum.map((c) => t.len - c).reverse();
    }
    // stops on its right, within 14 m: dwell positions
    for (const [st, { s }] of nearAlong(t, stopGrid, 14)) {
      if (s < 20 || s > t.len - 10) continue;
      if (rightOf(t, s, st.x, st.z) > 0 && !t.stops.some((q) => Math.abs(q - s) < 40)) t.stops.push(s);
    }
    t.stops.sort((a, b) => a - b);
  }

  assignSignals(tracks, network);
  return tracks;
}

// Signals along each track: the junctions of the road network with a signal the track passes through, and the phase
// there of the road the track runs along (signal-plan.js)
function assignSignals(tracks, network) {
  if (!network) return;
  const tmp = { x: 0, z: 0, y: 0, yaw: 0 };
  const sigGrid = pointGrid(network.nodes.filter((n) => n.signal), 20);
  const midGrid = pointGrid((network.midCrossings || []).filter((c) => c.kind === 'signal'), 20);
  for (const t of tracks) {
    for (const [n, { s }] of nearAlong(t, sigGrid, 9)) {
      if (s < 15) continue;
      sample(t, s, tmp);
      const fx = Math.sin(tmp.yaw);
      const fz = Math.cos(tmp.yaw);
      let p = SIGNALS.phaseForDir(n.sigJ, fx, fz);
      let best = 0.8;
      for (const e of n.in || []) {
        const dot = e.dx * fx + e.dz * fz;
        if (dot > best && e.sigP !== undefined) {
          best = dot;
          p = e.sigP;
        }
      }
      t.signals.push({ s, j: n.sigJ, p, half: Math.max(6, (n.hx || 7) + 3) });
    }
    // (and the midblock pedestrian signals it passes: the road's phase, 0; it stops 3 m short of the crossing)
    for (const [c, { s }] of nearAlong(t, midGrid, 9)) if (s >= 15) t.signals.push({ s, j: SIGNALS.crossingIndex(c.i), p: 0, half: 3 });
    t.signals.sort((a, b) => a.s - b.s);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Routes: the TTC's stopping patterns through the city (transit.js, from its GTFS) laid on the tracks
// ---------------------------------------------------------------------------------------------------------------------
// The track network as a graph: every streetcar way (main lines, loops & the junctions' curves; not the yards) cut at
// its vertices, joined where ways share a point or one ends on another; each piece both ways, but against the chained
// tracks' direction of travel (buildTracks) only at a high price, so a car keeps to the right-hand track.
function trackGraph(tracks) {
  const ways = [];
  for (const [kind, service, name, flags, flat] of GEO.rails || []) {
    if (kind !== 0 || service === 'yard') continue;
    const pts = toPts(flat);
    // (the curves & sidings aren't in the chained tracks: drawn only where a route runs on them, routeTrackwork)
    const drawn = !service || /Loop/i.test(name);
    if (pts.length > 1) ways.push({ pts, f: flags, k: drawn ? 1 : 1.4, drawn });
  }
  // the chained tracks' direction of travel, by 4 m cells
  const dgrid = new Map();
  for (const t of tracks) {
    for (let i = 0; i + 1 < t.pts.length; i++) {
      const a = t.pts[i], b = t.pts[i + 1];
      const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const k = Math.floor(a.x / 4) * 100000 + Math.floor(a.z / 4);
      if (!dgrid.has(k)) dgrid.set(k, []);
      dgrid.get(k).push({ x: a.x, z: a.z, dx: (b.x - a.x) / L, dz: (b.z - a.z) / L });
    }
  }
  const travel = (x, z, dx, dz) => {
    const ix = Math.floor(x / 4), iz = Math.floor(z / 4);
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) for (const q of dgrid.get((ix + a) * 100000 + iz + c) || []) {
      if (Math.hypot(q.x - x, q.z - z) > 1.2) continue;
      const dot = q.dx * dx + q.dz * dz;
      if (Math.abs(dot) > 0.9) return Math.sign(dot);
    }
    return 0;
  };
  // a way's end lying on another way's segment (its vertex simplified away there): split that segment
  const sgrid = new Map();
  ways.forEach((w, wi) => {
    for (let i = 0; i + 1 < w.pts.length; i++) {
      const a = w.pts[i], b = w.pts[i + 1];
      for (let ix = Math.floor(Math.min(a.x, b.x) / 10); ix <= Math.floor(Math.max(a.x, b.x) / 10); ix++) {
        for (let iz = Math.floor(Math.min(a.z, b.z) / 10); iz <= Math.floor(Math.max(a.z, b.z) / 10); iz++) {
          const k = ix * 100000 + iz;
          if (!sgrid.has(k)) sgrid.set(k, []);
          sgrid.get(k).push([wi, i]);
        }
      }
    }
  });
  const splits = ways.map((w) => w.pts.map(() => []));
  ways.forEach((w, wi) => {
    for (const p of [w.pts[0], w.pts[w.pts.length - 1]]) {
      let best = null, bd = 1.0;
      for (const [wj, i] of sgrid.get(Math.floor(p.x / 10) * 100000 + Math.floor(p.z / 10)) || []) {
        if (wj === wi) continue;
        const a = ways[wj].pts[i], b = ways[wj].pts[i + 1];
        const L2 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2 || 1;
        const t = ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / L2;
        if (t < 0 || t > 1) continue;
        const d = Math.hypot(a.x + (b.x - a.x) * t - p.x, a.z + (b.z - a.z) * t - p.z);
        if (d < bd) {
          bd = d;
          best = [wj, i, t];
        }
      }
      if (best && best[2] > 0.001 && best[2] < 0.999) splits[best[0]][best[1]].push({ t: best[2], p });
    }
  });
  const nodes = new Map();
  const nodeOf = (p) => {
    const k = `${Math.round(p.x * 5)},${Math.round(p.z * 5)}`;
    let n = nodes.get(k);
    if (!n) nodes.set(k, (n = { x: p.x, z: p.z, out: [] }));
    return n;
  };
  const arcs = [];
  ways.forEach((w, wi) => {
    const seq = [];
    w.pts.forEach((p, i) => {
      seq.push(p);
      if (i + 1 < w.pts.length) for (const sp of splits[wi][i].sort((a, b) => a.t - b.t)) seq.push(sp.p);
    });
    for (let i = 0; i + 1 < seq.length; i++) {
      const A = nodeOf(seq[i]), B = nodeOf(seq[i + 1]);
      if (A === B) continue;
      const L = Math.hypot(B.x - A.x, B.z - A.z);
      const dx = (B.x - A.x) / L, dz = (B.z - A.z) / L;
      const tv = travel((A.x + B.x) / 2, (A.z + B.z) / 2, dx, dz);
      const fwd = { a: A, b: B, len: L, dx, dz, f: w.f, k: w.k * (tv < 0 ? 25 : 1), w };
      const back = { a: B, b: A, len: L, dx: -dx, dz: -dz, f: w.f, k: w.k * (tv > 0 ? 25 : 1), w };
      fwd.rev = back;
      back.rev = fwd;
      A.out.push(fwd);
      B.out.push(back);
      arcs.push(fwd, back);
    }
  });
  return { arcs, nodes, used: new Set() };
}

// A pattern's line (along the street, from the timetable) followed through the track graph: the cheapest chain of
// pieces (Dijkstra over pieces, a turn of at most 50 degrees from one to the next) from near the line's start to near
// its end, each piece costing its length, more the further it lies from the line (squared) and much more heading
// against it. Where the tracks don't go on as the line does: cut there, on again from the next track on the line.
function routeOnTracks(G, pat) {
  const S = [];
  for (let i = 0; i + 1 < pat.pts.length; i++) {
    const a = pat.pts[i], b = pat.pts[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / 4));
    for (let k = 0; k < n; k++) S.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  S.push({ ...pat.pts[pat.pts.length - 1] });
  S.forEach((p, j) => {
    const a = S[Math.max(0, j - 3)], b = S[Math.min(S.length - 1, j + 3)];
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    p.dx = (b.x - a.x) / L;
    p.dz = (b.z - a.z) / L;
  });
  const LC = 20, REACH = 40;
  const lg = new Map();
  S.forEach((p, j) => {
    const k = Math.floor(p.x / LC) * 100000 + Math.floor(p.z / LC);
    if (!lg.has(k)) lg.set(k, []);
    lg.get(k).push(j);
  });
  const near = (x, z) => {
    let bj = -1, bd = REACH;
    const ix = Math.floor(x / LC), iz = Math.floor(z / LC);
    for (let a = -2; a <= 2; a++) for (let c = -2; c <= 2; c++) for (const j of lg.get((ix + a) * 100000 + iz + c) || []) {
      const d = Math.hypot(S[j].x - x, S[j].z - z);
      if (d < bd) {
        bd = d;
        bj = j;
      }
    }
    return bj < 0 ? null : { j: bj, d: bd };
  };
  // the pieces along the line, priced
  const info = new Map();
  let minJ = Infinity, maxJ = -1;
  for (const arc of G.arcs) {
    if (!near(arc.a.x, arc.a.z) && !near(arc.b.x, arc.b.z) && !near((arc.a.x + arc.b.x) / 2, (arc.a.z + arc.b.z) / 2)) continue;
    const n = Math.max(1, Math.ceil(arc.len / 8));
    let sum = 0, dot = 0, hits = 0, j0 = Infinity, j1 = -1;
    for (let k = 0; k <= n; k++) {
      const q = near(arc.a.x + arc.dx * (arc.len * k) / n, arc.a.z + arc.dz * (arc.len * k) / n);
      if (!q) continue;
      hits++;
      sum += q.d;
      dot += S[q.j].dx * arc.dx + S[q.j].dz * arc.dz;
      j0 = Math.min(j0, q.j);
      j1 = Math.max(j1, q.j);
    }
    if (hits < n + 1) continue;
    const mean = sum / hits;
    dot /= hits;
    const on = mean < 6 && dot > 0.7 && arc.k < 2;
    info.set(arc, { cost: arc.len * (1 + (mean / 4) ** 2) * arc.k * (dot < 0.3 ? 10 : 1), j0, j1, on });
    if (on) {
      minJ = Math.min(minJ, j0);
      maxJ = Math.max(maxJ, j1);
    }
  }
  if (!(maxJ - minJ > 40)) return [];
  const pieces = [];
  let from = minJ;
  const dist = new Map(), prev = new Map(), heap = [];
  const push = (e, d) => {
    heap.push([d, e]);
    for (let i = heap.length - 1; i > 0;) {
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
      for (let i = 0; ;) {
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
  while (from < maxJ - 8) {
    dist.clear();
    prev.clear();
    heap.length = 0;
    for (const [arc, c] of info) {
      if (c.on && c.j0 >= from && c.j0 <= from + 8) {
        dist.set(arc, c.cost);
        push(arc, c.cost);
      }
    }
    let goal = null, far = null, reached = -1;
    while (heap.length) {
      const [d, arc] = pop();
      if (d > dist.get(arc)) continue;
      const c = info.get(arc);
      if (c.on && c.j1 > reached) {
        reached = c.j1;
        far = arc;
      }
      if (c.on && c.j1 >= maxJ - 8) {
        goal = arc;
        break;
      }
      for (const nx of arc.b.out) {
        if (nx === arc.rev || nx.dx * arc.dx + nx.dz * arc.dz < 0.64) continue;
        const cn = info.get(nx);
        if (!cn || cn.j1 < c.j0 - 6) continue;
        const nd = d + cn.cost;
        if (nd < (dist.get(nx) ?? Infinity)) {
          dist.set(nx, nd);
          prev.set(nx, arc);
          push(nx, nd);
        }
      }
    }
    const end = goal || far;
    if (!end) break;
    const chain = [];
    for (let a = end; a; a = prev.get(a)) chain.push(a);
    chain.reverse();
    for (const a of chain) if (!a.w.drawn) G.used.add(a.w);
    if (chain.reduce((t, a) => t + a.len, 0) > 300) pieces.push([{ x: chain[0].a.x, z: chain[0].a.z, f: chain[0].f }, ...chain.map((a) => ({ x: a.b.x, z: a.b.z, f: a.f }))]);
    if (goal) break;
    let next = Infinity;
    for (const c of info.values()) if (c.on && c.j0 > reached && c.j0 < next) next = c.j0;
    if (!Number.isFinite(next)) break;
    from = next;
  }
  return pieces;
}

// Fallback (no way through the track graph): the line resampled every 2 m, each point moved onto the nearest track
// heading the same way within 7 m; where none lies near, 1.75 m right of the line; smoothed over 8 m.
function snapToTracks(tracks, pat) {
  const CELL = 10;
  const grid = new Map();
  for (const t of tracks) {
    const P = t.pts;
    for (let i = 0; i < P.length; i++) {
      const a = P[Math.max(0, i - 2)], b = P[Math.min(P.length - 1, i + 2)];
      const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const k = Math.floor(P[i].x / CELL) * 100000 + Math.floor(P[i].z / CELL);
      let c = grid.get(k);
      if (!c) grid.set(k, (c = []));
      c.push({ p: P[i], dx: (b.x - a.x) / L, dz: (b.z - a.z) / L });
    }
  }
  const snap = (x, z, dx, dz) => {
    let best = null, bd = 7;
    const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
    for (let a = -1; a <= 1; a++) {
      for (let c = -1; c <= 1; c++) {
        for (const q of grid.get((ix + a) * 100000 + iz + c) || []) {
          if (q.dx * dx + q.dz * dz < 0.8) continue;
          const d = Math.hypot(q.p.x - x, q.p.z - z);
          if (d < bd) {
            bd = d;
            best = q.p;
          }
        }
      }
    }
    return best;
  };
  let snapped = 0, total = 0;
  {
    // the line every 2 m
    const S = [];
    for (let i = 0; i + 1 < pat.pts.length; i++) {
      const a = pat.pts[i], b = pat.pts[i + 1];
      const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / 2));
      for (let k = 0; k < n; k++) S.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
    }
    S.push(pat.pts[pat.pts.length - 1]);
    if (S.length < 20) return null;
    const dirs = S.map((_, j) => {
      const a = S[Math.max(0, j - 4)], b = S[Math.min(S.length - 1, j + 4)];
      const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      return { dx: (b.x - a.x) / L, dz: (b.z - a.z) / L };
    });
    let own = 0;
    const on = S.map((p, j) => {
      const { dx, dz } = dirs[j];
      const q = snap(p.x, p.z, dx, dz);
      total++;
      if (q) {
        snapped++;
        own++;
        return { x: q.x, z: q.z, f: q.f || 0 };
      }
      return { x: p.x - dz * 1.75, z: p.z + dx * 1.75, f: 0 };
    });
    // smoothed, and never stepping back
    const src = [];
    for (let j = 0; j < on.length; j++) {
      let x = 0, z = 0, n = 0;
      for (let k = Math.max(0, j - 2); k <= Math.min(on.length - 1, j + 2); k++) {
        x += on[k].x;
        z += on[k].z;
        n++;
      }
      const p = { x: x / n, z: z / n, f: on[j].f };
      const last = src[src.length - 1];
      if (last && (p.x - last.x) * dirs[j].dx + (p.z - last.z) * dirs[j].dz < 0.4) continue;
      src.push(p);
    }
    if (src.length < 10) return null;
    src.onTrack = own / S.length;
    return src;
  }
}

// Each pattern's route: on the track graph (or, failing that, snapped onto the tracks), its stops (the timetable's, in
// order along it; the nose pulls up a few metres past the stop's pole) and its signals (as the tracks')
function buildRoutes(tracks, network) {
  const T = window.CITY.TRANSIT;
  const pats = T ? T.ofType(0) : [];
  if (!pats.length) return [];
  const G = trackGraph(tracks);
  const routes = [];
  const snapped = [], cut = [];
  for (const pat of pats) {
    let pieces = routeOnTracks(G, pat);
    if (!pieces.length) {
      const src = snapToTracks(tracks, pat);
      if (!src) continue;
      pieces = [src];
      snapped.push(pat.sign[0]);
    } else if (pieces.length > 1) cut.push(`${pat.sign[0]} (${pieces.length})`);
    for (const src of pieces) {
    // (every 4 m: a route is a car's path only, its rails drawn from the tracks; half the memory of 2 m)
    const t = makeTrack(src, 4);
    t.pattern = pat;
    t.sign = pat.sign;
    // its stops, in order along it
    let i0 = 0;
    for (const st of pat.stops) {
      let bi = -1, bd = 25;
      for (let i = i0; i < t.pts.length; i++) {
        const d = Math.hypot(t.pts[i].x - st.x, t.pts[i].z - st.z);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      if (bi < 0) continue;
      i0 = bi;
      const s = Math.min(t.len - 2, t.cum[bi] + 4);
      if (s > CAR_LEN + 2 && !t.stops.some((q) => Math.abs(q - s) < 30)) {
        t.stops.push(s);
        (t.stopNames || (t.stopNames = [])).push(st.name);
      }
    }
    routes.push(t);
    }
  }
  assignSignals(routes, network);
  // the curves & sidings the routes run on, to be drawn with the rest of the trackwork
  routes.extraTrack = [...G.used].map((w) => makeTrack(w.pts.map((p) => ({ x: p.x, z: p.z, f: w.f }))));
  console.info(`[streetcars] ${routes.length} routes from the TTC's timetable on the tracks (${G.arcs.length / 2} pieces of track)${cut.length ? `; cut where the tracks don't go on: ${cut.join(', ')}` : ''}${snapped.length ? `; snapped (no way through): ${snapped.join(', ')}` : ''}`);
  return routes;
}

// ---------------------------------------------------------------------------------------------------------------------
// Rails, track bed & overhead wire, in TILE x TILE m tiles
// ---------------------------------------------------------------------------------------------------------------------
// The rails: a flat steel strip each with the dark flangeway groove on its inner side (uv.x across the strip)
function createRailMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.32, metalness: 0.85 });
  const groove = smoothstep(0.52, 0.6, uv().x);
  mat.colorNode = mix(color(0xa6a29b), color(0x1c1b1a), groove);
  mat.metalnessNode = mix(float(0.85), float(0.1), groove);
  mat.roughnessNode = mix(float(0.3), float(0.9), groove);
  return mat;
}
// The track bed: the concrete slab the rails are cast in, a little lighter than the asphalt, its edges worn
function createTrackBedMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0.0 });
  const edge = smoothstep(0.0, 0.08, uv().x).mul(smoothstep(1.0, 0.92, uv().x));
  mat.colorNode = mix(color(0x3a3937), color(0x5a5854), edge);
  return mat;
}

function buildTrackwork(group, tracks) {
  const tiles = new Map(); // key -> { rail: [], bed: [], wire: [] }
  const tileOf = (x, z) => {
    const k = Math.floor(x / TILE) * 100000 + Math.floor(z / TILE);
    let t = tiles.get(k);
    if (!t) tiles.set(k, (t = { rail: [], railUv: [], bed: [], bedUv: [], wire: [], x: (Math.floor(x / TILE) + 0.5) * TILE, z: (Math.floor(z / TILE) + 0.5) * TILE }));
    return t;
  };
  // a flat strip from a to b, `half` wide either side, uv.x 0..1 across (flipped: uv.x 1 on the left)
  const strip = (pos, uvs, ax, ay, az, bx, by, bz, half, flip) => {
    const L = Math.hypot(bx - ax, bz - az) || 1;
    const nx = (-(bz - az) / L) * half;
    const nz = ((bx - ax) / L) * half;
    const u0 = flip ? 1 : 0, u1 = flip ? 0 : 1;
    // (wound counter-clockwise seen from above)
    pos.push(ax - nx, ay, az - nz, bx + nx, by, bz + nz, bx - nx, by, bz - nz, ax - nx, ay, az - nz, ax + nx, ay, az + nz, bx + nx, by, bz + nz);
    uvs.push(u0, 0, u1, 1, u0, 1, u0, 0, u1, 0, u1, 1);
  };
  // the contact wire, dropped to clear the soffit where the street passes under a rail bridge (King & Queen St W...)
  const wireY = (p) => (railSpanAt(p.x, p.z) ? Math.min(p.y + WIRE_Y, railLiftAt(p.x, p.z) - 1.6) : p.y + WIRE_Y);
  for (const t of tracks) {
    const P = t.pts;
    for (let i = 0; i + 1 < P.length; i++) {
      const a = P[i];
      const b = P[i + 1];
      if ((a.f & 2) && (b.f & 2)) continue; // in the tunnel
      const T = tileOf((a.x + b.x) / 2, (a.z + b.z) / 2);
      const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const rx = -(b.z - a.z) / L;
      const rz = (b.x - a.x) / L;
      strip(T.bed, T.bedUv, a.x, a.y + 0.006, a.z, b.x, b.y + 0.006, b.z, 1.3, false);
      // grooves on the inner side of each rail
      for (const [o, flip] of [[-GAUGE / 2, true], [GAUGE / 2, false]]) {
        strip(T.rail, T.railUv, a.x + rx * o, a.y + 0.016, a.z + rz * o, b.x + rx * o, b.y + 0.016, b.z + rz * o, 0.06, flip);
      }
      if (i % 4 === 0) {
        const c = P[Math.min(P.length - 1, i + 4)];
        T.wire.push(a.x, wireY(a), a.z, c.x, wireY(c), c.z);
      }
    }
  }
  const railMat = createRailMaterial();
  const bedMat = createTrackBedMaterial();
  const wireMat = new THREE.LineBasicNodeMaterial({ color: 0x1a1a1a });
  const first = {};
  const out = [];
  const mesh = (Kind, pos, uvs, mat, name) => {
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (uvs) {
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      const nor = new Float32Array(pos.length);
      for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    }
    g.computeBoundingSphere();
    const m = new Kind(g, mat);
    m.name = name;
    m.receiveShadow = true;
    // shader precompile: the first tile compiles the pipeline every tile shares (main.js)
    if (first[name]) m.userData.sharesPipelineWith = first[name];
    else first[name] = m;
    group.add(m);
    return m;
  };
  for (const T of tiles.values()) {
    const meshes = [
      mesh(THREE.Mesh, T.bed, T.bedUv, bedMat, 'StreetcarTrackBed'),
      mesh(THREE.Mesh, T.rail, T.railUv, railMat, 'StreetcarRails'),
      mesh(THREE.LineSegments, T.wire, null, wireMat, 'StreetcarWire')
    ].filter(Boolean);
    out.push({ x: T.x, z: T.z, meshes });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// The Flexity Outlook: five modules (the end ones with the raked cab), TTC red with the black window band
// ---------------------------------------------------------------------------------------------------------------------
// uv: x = local z from the module's door centre (far off: no door), y = height
function moduleGeometry(len, nose, door) {
  const g = new THREE.BoxGeometry(HALF_W * 2, HEIGHT - 0.32, len, 1, 4, 4).translate(0, 0.32 + (HEIGHT - 0.32) / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    const y = p.getY(i);
    let z = p.getZ(i);
    // rounded roof edges
    if (y > HEIGHT - 0.05) x *= 0.86;
    if (nose && z > len / 2 - 0.01) {
      // the cab: a raked windscreen and a rounded nose in plan
      const k = Math.max(0, (y - 1.0) / (HEIGHT - 1.0));
      z -= k * k * 1.05;
      x *= 1 - 0.12 * Math.min(1, Math.max(0, (y - 0.3) / 3.5));
    }
    p.setXYZ(i, x, y, z);
  }
  const u = g.attributes.uv;
  for (let i = 0; i < p.count; i++) u.setXY(i, door === null ? 50 : p.getZ(i) - door, p.getY(i));
  g.computeVertexNormals();
  return g;
}
// `lamp`: the cab end's lamps, white headlamps (the leading cab) or red tail lamps (the trailing one, turned round);
// `atlas`: the destination signs (transit.js signAtlas), each car's row its instance's signRow
function createStreetcarMaterial(lamp = 0xfff1d6, atlas = null) {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.38, metalness: 0.25 });
  const y = positionGeometry.y;
  const dz = abs(uv().x);
  const side = step(0.6, abs(normalGeometry.x));
  const roof = step(0.6, normalGeometry.y);
  const front = step(0.55, normalGeometry.z); // the cab's end (the gangways hide the inner modules' ends)
  const band = smoothstep(1.02, 1.06, y).mul(float(1.0).sub(smoothstep(2.6, 2.64, y)));
  const whiteLine = smoothstep(0.92, 0.94, y).mul(float(1.0).sub(smoothstep(0.98, 1.0, y)));
  const skirt = float(1.0).sub(smoothstep(0.42, 0.46, y));
  // the double door: dark seams round the leaves & between them, glazed down to the waist
  const doorZone = step(dz, 0.72).mul(step(0.36, y)).mul(float(1.0).sub(step(2.62, y))).mul(side);
  const seams = doorZone.mul(float(1.0).sub(smoothstep(0.02, 0.035, dz)).add(smoothstep(0.66, 0.68, dz))).min(1.0);
  const doorGlass = doorZone.mul(smoothstep(1.0, 1.04, y));
  // the cab end: the black windscreen, the destination sign over it, the lamps low at both corners
  const lx = abs(positionGeometry.x);
  const screen = front.mul(smoothstep(1.22, 1.28, y)).mul(float(1.0).sub(smoothstep(3.0, 3.04, y))).mul(float(1.0).sub(smoothstep(0.98, 1.03, lx)));
  const sign = front.mul(smoothstep(3.1, 3.13, y)).mul(float(1.0).sub(smoothstep(3.47, 3.5, y))).mul(step(lx, 0.8));
  const col = Fn(() => {
    let c = mix(color(0xc81f27), color(0x101215), band);
    c = mix(c, color(0xf2f2ee), whiteLine.mul(float(1.0).sub(doorZone)));
    c = mix(c, color(0x0f1012), doorGlass);
    c = mix(c, color(0x2a0b0d), seams);
    c = mix(c, color(0x1d1e20), skirt);
    c = mix(c, color(0xc9cbcc), roof);
    c = mix(c, color(0x0d0f12), screen.max(sign).mul(float(1.0).sub(roof)));
    return c;
  })();
  mat.colorNode = col;
  const glassy = band.max(doorGlass).max(screen);
  mat.roughnessNode = mix(float(0.38), float(0.08), glassy);
  mat.metalnessNode = mix(float(0.25), float(0.7), glassy);
  // lit saloon after dusk, the cab end's lamps (always on, brighter at night)
  const night = smoothstep(0.6, 1.15, cityUniforms.uInteriorGlow); // (as the vehicles' lamps, actor-models.js)
  const lampMask = smoothstep(0.6, 0.63, y).mul(float(1.0).sub(smoothstep(0.76, 0.79, y))).mul(front).mul(smoothstep(0.8, 0.84, lx)).mul(float(1.0).sub(smoothstep(1.06, 1.1, lx)));
  // the sign: the route & destination in amber LEDs (without an atlas, a plain amber line)
  const led = atlas
    ? texture(atlas.tex, vec2(positionGeometry.x.div(1.6).add(0.5), attribute('signRow', 'float').add(float(3.47).sub(y).div(0.34).clamp(0.02, 0.98)).div(atlas.rows))).rgb.mul(sign).mul(1.6)
    : color(0xffa020).mul(sign.mul(smoothstep(3.22, 3.25, y)).mul(float(1.0).sub(smoothstep(3.36, 3.39, y))).mul(step(lx, 0.62)));
  mat.emissiveNode = color(0xffe2b0).mul(band.max(doorGlass).mul(float(1.0).sub(front)).mul(0.55).mul(night))
    .add(color(lamp).mul(lampMask).mul(night.mul(2.2).add(0.25)))
    .add(led.mul(night.mul(1.2).add(0.6)));
  return mat;
}

function createStreetcars(scene, trafficSystem) {
  const group = new THREE.Group();
  group.name = 'Streetcars';
  const network = trafficSystem && trafficSystem.network;
  const tracks = buildTracks(network);
  const trackGroup = new THREE.Group();
  trackGroup.name = 'StreetcarTracks';
  markStreetcarStreets(network, tracks);
  const routes = buildRoutes(tracks, network);
  const trackTiles = buildTrackwork(trackGroup, [...tracks, ...(routes.extraTrack || [])]);
  group.add(trackGroup);

  // The fleet. With the TTC's timetable (transit.js): its routes, each car entering at the start of its route's
  // stretch through the city at the route's headway for the hour (main.js selectTime -> transit.js), stopping at its
  // stops, and gone at the end (out of sight). Without it: one car per `streetcarSpacing` m of track (quality.js),
  // spread out along the tracks, round and round.
  const routed = routes.length > 0;
  const T = window.CITY.TRANSIT;
  // (the phone tiers: fewer cars, the headways stretched by their spacing)
  const thin = Math.max(1, (QUALITY.streetcarSpacing || 500) / 500);
  const cars = [];
  const newCar = (track, s) => {
    const car = { track, route: track.pattern || null, s, speed: MAX_SPEED * 0.6, dwell: 0, k: 0, atEnd: 0, sections: SECTIONS.map(() => ({ x: 0, y: 0, z: 0, yaw: 0 })) };
    while (car.k < track.stops.length && track.stops[car.k] < s - 0.5) car.k++;
    cars.push(car);
    return car;
  };
  // A route's run through the city at the TTC's own schedule speed (its timetable's stop-to-stop times over the
  // distance, stops included: 2.2-3.5 m/s downtown), so as many cars are out on the street as the TTC has there: each
  // route gets its cruising speed & dwell to take that long. The time a run takes here, as driven (calibrated with
  // simulate() below): its length at 0.9 of the cruise, each stop the dwell plus ~9 s slowing & pulling away, each
  // light ~6 s on average.
  const runTime = (t, cruise, dwell) => t.len / (cruise * 0.9) + t.stops.length * (dwell + 9) + t.signals.length * 6;
  for (const t of routes) {
    const v = Math.min(5, Math.max(2.2, t.pattern.speed || 3)); // (short turns' figures can be odd)
    const want = t.len / v;
    // a longer dwell first (20 s), then a lower cruise (down to 6 m/s, ~22 km/h), then the dwell again (up to 40 s)
    let dwell = 20;
    const left = want - t.stops.length * (dwell + 9) - t.signals.length * 6;
    const cruise = Math.min(MAX_SPEED, Math.max(6, left > 0 ? t.len / (0.9 * left) : 6));
    dwell = Math.min(40, Math.max(DWELL, (want - t.len / (cruise * 0.9) - t.signals.length * 6) / Math.max(1, t.stops.length) - 9));
    Object.assign(t, { cruise, dwell, schedSpeed: v });
  }
  const runSpeed = (t) => (t.cruise ? t.len / runTime(t, t.cruise, t.dwell) : t.len / runTime(t, MAX_SPEED, DWELL));
  function setHeadways(fill) {
    for (const t of routes) {
      const H = T.headway(t.pattern) * thin;
      t.headway = H;
      if (fill) {
        // the cars already on their way, as if the route had been running
        if (!Number.isFinite(H)) {
          t.clock = Infinity;
          continue;
        }
        const gap = H * runSpeed(t), phase = Math.random();
        for (let s = CAR_LEN + 1 + phase * gap; s < t.len - 20; s += gap) newCar(t, s);
        t.clock = (1 - phase) * H;
      } else {
        t.clock = Number.isFinite(H) ? Math.min(Number.isFinite(t.clock) ? t.clock : Infinity, Math.random() * H) : Infinity;
      }
    }
  }
  if (routed) {
    setHeadways(true);
    T.onHour(() => setHeadways(false));
  } else {
    const spacing = QUALITY.streetcarSpacing || 500;
    for (const t of tracks) {
      const n = Math.max(1, Math.round(t.len / spacing));
      for (let k = 0; k < n; k++) newCar(t, ((k + 0.5) / n) * t.len);
    }
  }

  const bodyMat = createStreetcarMaterial(0xfff1d6);
  // the destination signs: route number, name & destination (transit.js), front & back
  const atlas = routed ? T.signAtlas(routes.map((t) => t.sign), 1.6 / 0.34) : null;
  for (const t of routes) t.signRow = atlas.rowOf(t.sign);
  const headMat = atlas ? createStreetcarMaterial(0xfff1d6, atlas) : bodyMat;
  const tailMat = createStreetcarMaterial(0xff2a1c, atlas);
  const noseGeo = moduleGeometry(SECTIONS[0], true, DOORS[0]);
  const tailGeo = atlas ? noseGeo.clone() : noseGeo;
  const midGeos = SECTIONS.map((l, k) => moduleGeometry(l, false, DOORS[k]));
  const gangwayGeo = new THREE.BoxGeometry(HALF_W * 1.9, HEIGHT - 0.6, GANGWAY + 0.2).translate(0, 0.4 + (HEIGHT - 0.6) / 2, 0);
  // the pantograph & its roof pod on the middle module
  const pantoGeo = mergeGeometries([
    new THREE.BoxGeometry(1.4, 0.25, 1.6).translate(0, 0.12, 0),
    new THREE.BoxGeometry(0.06, 1.3, 0.06).rotateX(0.5).translate(0, 0.85, 0.3),
    new THREE.BoxGeometry(1.5, 0.05, 0.08).translate(0, 1.5, 0.62)
  ].map((g) => g.toNonIndexed()));
  // (drawn at once: those within DRAW_RADIUS; a timetabled fleet comes and goes, so room for the most there could be)
  const count = Math.max(1, routed ? 160 : cars.length);
  const signRows = atlas ? [noseGeo, tailGeo].map((g) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(count), 1);
    g.setAttribute('signRow', a);
    return a;
  }) : [];
  const head = new THREE.InstancedMesh(noseGeo, headMat, count);
  const tail = new THREE.InstancedMesh(tailGeo, tailMat, count);
  const mids = midGeos.slice(1, 4).map((g) => new THREE.InstancedMesh(g, bodyMat, count));
  const gangways = new THREE.InstancedMesh(gangwayGeo, new THREE.MeshStandardNodeMaterial({ color: 0x1b1c1e, roughness: 0.9 }), count * 4);
  const pantos = new THREE.InstancedMesh(pantoGeo, new THREE.MeshStandardNodeMaterial({ color: 0x2a2b2d, roughness: 0.5, metalness: 0.6 }), count);
  const bodies = [head, tail, ...mids, gangways, pantos];
  for (const m of bodies) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.count = 0;
    group.add(m);
  }
  scene.add(group);

  // Obstacles handed to traffic.js: one box per module of every car near the camera
  const obstacles = [];
  const dummy = new THREE.Object3D();
  const tmp = { x: 0, z: 0, y: 0, yaw: 0 };

  function phaseAhead(car, elapsed) {
    for (const sg of car.track.signals) {
      const d = sg.s - sg.half - car.s;
      if (d < -1 || d > 60) continue;
      if (d < 50) SIGNALS.call(sg.j, sg.p); // its light's detector sees it coming
      const ph = SIGNALS.state(sg.j, sg.p, elapsed);
      if (ph === 'red' || (ph === 'amber' && d > 12)) return d;
    }
    return Infinity;
  }
  // Distance to the nearest thing standing in the way within `reach` m ahead of the nose: traffic, the player
  function blockedAhead(car, reach, others, playerEnt) {
    const t = car.track;
    sample(t, car.s, tmp);
    let best = Infinity;
    const fx = Math.sin(tmp.yaw);
    const fz = Math.cos(tmp.yaw);
    const y = tmp.y;
    const test = (x, z, half, halfW) => {
      const dx = x - tmp.x;
      const dz = z - tmp.z;
      const ahead = dx * fx + dz * fz;
      if (ahead < -1 || ahead > reach + half) return;
      const side = Math.abs(dz * fx - dx * fz);
      if (side > HALF_W + halfW + 0.35) return;
      best = Math.min(best, ahead - half);
    };
    for (const v of others) if (v.edge && Math.abs((v.y || 0) - y) < 2.5) test(v.x, v.z, v.half || 2.3, v.halfWidth || 0.9);
    // other routes' cars on the same tracks (504A & 504B along King...), module by module
    for (const o of cars) {
      if (o === car || o.track === t || !o.placed) continue;
      const m = o.sections[2];
      if (Math.abs(m.x - tmp.x) > reach + CAR_LEN || Math.abs(m.z - tmp.z) > reach + CAR_LEN || Math.abs(m.y - y) > 2.5) continue;
      for (const sec of o.sections) test(sec.x, sec.z, SECTIONS[0] / 2 + GANGWAY, HALF_W);
    }
    if (playerEnt && Math.abs(playerEnt.position.y - y) < 2.6) test(playerEnt.position.x, playerEnt.position.z, 2.3, 1.0);
    return best;
  }

  const cull = QUALITY.cull || 1;
  // the car ahead on the same track (or route), by distance along it
  function followAhead(car) {
    let best = Infinity;
    for (const o of car.track.cars || cars) {
      if (o === car || o.track !== car.track) continue;
      const d = o.s - CAR_LEN - car.s;
      if (d > -1 && d < best) best = d;
    }
    return best;
  }
  let camX = 0, camZ = 0;
  // (the timetable: each route's cars, for following & spawning)
  for (const t of routed ? routes : tracks) t.cars = [];
  for (const car of cars) car.track.cars.push(car);
  function spawn(t, dt) {
    if (!Number.isFinite(t.clock)) return;
    t.clock -= dt;
    if (t.clock > 0) return;
    // the start clear of the last car in, and out of sight close by (not where it would appear from nothing), or
    // waited long enough
    const p0 = t.pts[0];
    const seen = p0.y > -3 && Math.hypot(p0.x - camX, p0.z - camZ) < 220 && t.clock > -30;
    if (seen || t.cars.some((o) => o.s < CAR_LEN * 2 + 8)) return;
    t.cars.push(newCar(t, CAR_LEN + 1));
    t.clock += t.headway;
    if (t.clock < 0) t.clock = t.headway * 0.5;
  }
  function retire(car) {
    const i = cars.indexOf(car);
    if (i >= 0) cars.splice(i, 1);
    const j = car.track.cars.indexOf(car);
    if (j >= 0) car.track.cars.splice(j, 1);
  }

  function update(dt, elapsed, camera, playerEnt, activeMode) {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.1);
    const others = trafficSystem ? [...(trafficSystem.cars || []), ...(trafficSystem.buses || [])] : [];
    const ground = playerEnt && activeMode !== 'helicopter' ? playerEnt : null;
    camX = camera ? camera.position.x : 0;
    camZ = camera ? camera.position.z : 0;
    const drawR = DRAW_RADIUS * cull;
    const farR = Math.max(drawR, NEAR) + 150;
    obstacles.length = 0;
    if (routed) for (const t of routes) spawn(t, dt);
    let n = 0;
    for (let ci = cars.length - 1; ci >= 0; ci--) {
      const car = cars[ci];
      const t = car.track;
      // where the car must stop: a stop to dwell at, a red light, the car ahead, whatever stands in the way; the end of
      // its route
      let target = t.cruise || MAX_SPEED;
      let stopD = Infinity;
      sample(t, car.s, tmp);
      const near = Math.abs(tmp.x - camX) < NEAR + 50 && Math.abs(tmp.z - camZ) < NEAR + 50;
      if (car.dwell > 0) {
        car.dwell -= dt;
        target = 0;
      } else {
        const next = t.stops[car.k];
        if (next !== undefined) {
          const d = next - car.s;
          if (d < 0.6 && car.speed < 1.0) {
            car.dwell = (t.dwell || DWELL) * (0.7 + Math.random() * 0.6);
            car.k++;
            car.speed = 0;
          } else if (d < -1) car.k++; // (ran past it)
          else stopD = Math.min(stopD, d);
        }
        stopD = Math.min(stopD, phaseAhead(car, elapsed), followAhead(car) - 4);
        if (routed) stopD = Math.min(stopD, t.len - car.s);
        if (near) stopD = Math.min(stopD, blockedAhead(car, 75, others, ground) - 4);
      }
      if (stopD < Infinity) target = Math.min(target, Math.sqrt(Math.max(0, 2 * DECEL * Math.max(0, stopD))));
      if (car.speed < target) car.speed = Math.min(target, car.speed + ACCEL * dt);
      else car.speed = Math.max(target, car.speed - (stopD < 3 ? DECEL * 3 : DECEL * 1.6) * dt);
      car.s += car.speed * dt;
      if (car.s > t.len - 1) {
        if (routed) {
          // the end of its run through the city: gone once out of sight (in a tunnel, far off, or after a layover)
          car.s = Math.min(car.s, t.len);
          car.atEnd += dt;
          if (tmp.y < -3 || Math.hypot(tmp.x - camX, tmp.z - camZ) > 250 || car.atEnd > 90) {
            retire(car);
            continue;
          }
        } else if (car.s > t.len) {
          // off the end of the run: back in at its start
          car.s = CAR_LEN;
          car.k = 0;
        }
      }
      // far from the camera (not drawn, no obstacle, out of earshot) the modules stay where they were: placing them
      // is 11 track lookups a car, a frame (the nose, sampled above, tells)
      car.placed = false;
      if (Math.abs(tmp.x - camX) > farR || Math.abs(tmp.z - camZ) > farR) continue;
      car.placed = true;
      // the modules follow the track behind the nose
      let back = car.s;
      for (let k = 0; k < SECTIONS.length; k++) {
        const sec = car.sections[k];
        sample(t, back, tmp);
        const ax = tmp.x, ay = tmp.y, az = tmp.z;
        sample(t, Math.max(0, back - SECTIONS[k]), tmp);
        sec.x = (ax + tmp.x) / 2;
        sec.y = (ay + tmp.y) / 2;
        sec.z = (az + tmp.z) / 2;
        sec.yaw = Math.atan2(ax - tmp.x, az - tmp.z);
        sec.pitch = Math.atan2(ay - tmp.y, SECTIONS[k]);
        back -= SECTIONS[k] + GANGWAY;
      }
      const mid = car.sections[2];
      const dCam = Math.hypot(mid.x - camX, mid.z - camZ);
      // obstacles for the traffic & contact with the player
      if (dCam < NEAR) {
        for (let k = 0; k < SECTIONS.length; k++) {
          const sec = car.sections[k];
          obstacles.push({ x: sec.x, y: sec.y, z: sec.z, yaw: sec.yaw, halfW: HALF_W, halfL: SECTIONS[k] / 2 + GANGWAY / 2, speed: car.speed });
        }
        if (ground) pushPlayer(car, ground, activeMode);
      }
      // draw: the cab modules (the tail one turned round), the inner ones, the gangways, the pantograph mid-roof;
      // only near the camera, and not deep in a tunnel
      if (dCam > drawR || mid.y < -HEIGHT - 0.5 || n >= count) continue;
      car.sections.forEach((sec, k) => {
        dummy.position.set(sec.x, sec.y, sec.z);
        dummy.rotation.set(0, sec.yaw + (k === SECTIONS.length - 1 ? Math.PI : 0), 0, 'YXZ');
        dummy.rotateX(k === SECTIONS.length - 1 ? sec.pitch : -sec.pitch);
        dummy.updateMatrix();
        if (k === 0) head.setMatrixAt(n, dummy.matrix);
        else if (k === SECTIONS.length - 1) tail.setMatrixAt(n, dummy.matrix);
        else mids[k - 1].setMatrixAt(n, dummy.matrix);
        if (k === 2) {
          dummy.position.y = sec.y + HEIGHT;
          dummy.updateMatrix();
          pantos.setMatrixAt(n, dummy.matrix);
        }
        if (k < SECTIONS.length - 1) {
          const nx = car.sections[k + 1];
          dummy.position.set((sec.x + nx.x) / 2, (sec.y + nx.y) / 2, (sec.z + nx.z) / 2);
          dummy.rotation.set(0, (sec.yaw + nx.yaw) / 2, 0);
          dummy.updateMatrix();
          gangways.setMatrixAt(n * 4 + k, dummy.matrix);
        }
      });
      for (const a of signRows) a.array[n] = t.signRow || 0;
      n++;
    }
    for (const m of [head, tail, ...mids, pantos]) m.count = n;
    gangways.count = n * 4;
    for (const m of bodies) {
      if (!m.count) continue;
      m.instanceMatrix.clearUpdateRanges();
      m.instanceMatrix.addUpdateRange(0, m.count * 16);
      m.instanceMatrix.needsUpdate = true;
    }
    for (const a of signRows) {
      if (!n) continue;
      a.clearUpdateRanges();
      a.addUpdateRange(0, n);
      a.needsUpdate = true;
    }
    if (trafficSystem && trafficSystem.setObstacles) trafficSystem.setObstacles(obstacles);
    // the trackwork within reach
    const trackR = TRACK_DRAW * cull + TILE * 0.7;
    for (const T of trackTiles) {
      const vis = Math.hypot(T.x - camX, T.z - camZ) < trackR;
      for (const m of T.meshes) m.visible = vis;
    }
  }

  // The timetable over `seconds` of simulated time, the camera far out over the lake (no traffic, no player): how often
  // each route's cars pass the middle of its stretch, against the timetable (for checking; holds the page meanwhile)
  function simulate(seconds = 3600, step = 0.1) {
    const cam = { position: { x: 0, y: 500, z: 20000 } };
    const passes = new Map(routes.map((t) => [t, []]));
    const prev = new Map();
    const seen = new Map(); // car -> [time, s] when first seen
    const speeds = new Map(routes.map((t) => [t, []]));
    let time = 0;
    const t0 = performance.now();
    for (; time < seconds; time += step) {
      prev.clear();
      for (const c of cars) prev.set(c, c.s);
      update(step, 1e5 + time, cam, null, 'helicopter');
      // (the cars gone this step: their run's speed, if seen from near its start)
      const now = new Set(cars);
      for (const [c] of prev) {
        const f = seen.get(c);
        if (!now.has(c) && f && f[1] < CAR_LEN + 20 && speeds.has(c.track)) speeds.get(c.track).push((c.track.len - f[1]) / Math.max(1, time - f[0]));
      }
      for (const c of cars) {
        if (!seen.has(c)) seen.set(c, [time, c.s]);
        const mid = c.track.len / 2, p = prev.get(c);
        if (p !== undefined && p < mid && c.s >= mid && passes.has(c.track)) passes.get(c.track).push(time);
      }
    }
    const rows = routes.map((t) => {
      const ts = passes.get(t);
      const gaps = ts.slice(1).map((x, i) => x - ts[i]);
      const mean = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : NaN;
      return { route: t.sign.join(' / '), dir: t.pattern.dir, len: Math.round(t.len), stops: t.stops.length, gtfsPerHour: t.pattern.perHour[T.hour], gtfsHeadway: Math.round(T.headway(t.pattern)), simPasses: ts.length, simHeadway: Math.round(mean), simSpeed: speeds.get(t).length ? Math.round((speeds.get(t).reduce((a, b) => a + b, 0) / speeds.get(t).length) * 10) / 10 : null, gtfsSpeed: t.pattern.speed, estSpeed: Math.round(runSpeed(t) * 10) / 10, cruise: Math.round((t.cruise || 0) * 10) / 10, dwell: Math.round(t.dwell || 0) };
    });
    console.info(`[streetcars] simulated ${seconds} s at ${T.hour}:00 in ${Math.round(performance.now() - t0)} ms`);
    return rows;
  }
  // A streetcar shoves the player (on foot, by bike or car) out of its modules along the shallower side
  function pushPlayer(car, ground, activeMode) {
    const r = activeMode === 'car' ? 1.6 : activeMode === 'cyclist' ? 0.8 : 0.45;
    for (let k = 0; k < SECTIONS.length; k++) {
      const sec = car.sections[k];
      if (Math.abs(ground.position.y - sec.y) > 2.6) continue;
      const dx = ground.position.x - sec.x;
      const dz = ground.position.z - sec.z;
      const c = Math.cos(sec.yaw), sn = Math.sin(sec.yaw);
      const lx = dx * c - dz * sn; // across
      const lz = dx * sn + dz * c; // along
      const px = HALF_W + r - Math.abs(lx);
      const pz = SECTIONS[k] / 2 + r - Math.abs(lz);
      if (px <= 0 || pz <= 0) continue;
      if (px < pz) {
        const s = Math.sign(lx) || 1;
        ground.position.x += c * px * s;
        ground.position.z -= sn * px * s;
      } else {
        const s = Math.sign(lz) || 1;
        ground.position.x += sn * pz * s;
        ground.position.z += c * pz * s;
      }
      if (ground.speed) ground.speed *= 0.3;
    }
  }

  const km = Math.round(tracks.reduce((t, k) => t + k.len, 0) / 100) / 10;
  const runs = routed ? routes : tracks;
  console.info(`[streetcars] ${tracks.length} track runs, ${km} km, ${cars.length} streetcars on ${runs.length} ${routed ? `TTC routes at ${T.hour}:00 (${[...new Set(routes.map((t) => t.pattern.route))].join(', ')})` : 'runs'}, ${runs.reduce((t, k) => t + k.stops.length, 0)} stops, ${runs.reduce((t, k) => t + k.signals.length, 0)} signals, ${trackTiles.length} track tiles`);
  return { group, update, cars, tracks, routes, sample, simulate };
}

Object.assign(window.CITY, { createStreetcars });
})();
