(function () {
// js/subway.js
// The TTC subway where you can see it from the street (window.CITY.GEO_SUBWAY, js/toronto-subway.js from
// tools/build-subway.mjs; the tunnels, stations & platforms underground are not built):
// - Line 2 on the Prince Edward Viaduct: Bloor Street's deck over the Don (city-grid.js, a flyover deck) gets the
//   lower deck the subway runs on, an open steel truss hung under the road with its tracks, carried on tall concrete
//   piers and steel arches in place of the flyover's plain T piers (city-grid.js asks subwayKeepsClear()), and solid
//   abutments at either end, where the tracks run into their tunnel portals (Castle Frank in the west, Broadview in the
//   east). Toronto Rocket trains (six stainless cars, black window band, red accents) cross it both ways, coming out
//   of one portal and gone into the other.
// - Line 2 out in the open in the west end (Runnymede to High Park, Keele to Dundas West beside Vincent Yard): the
//   flat city puts it in open cuts, concrete-walled trenches with the streets crossing on decks at grade (Clendenan
//   Ave, Indian Rd) and tunnel portals at their ends (and at Keele station's building over the tracks), a chain-link
//   fence on the walls' upstand round the top; the street level is masked out over them (city-grid.js
//   maskRoadCuts). Trains run both ways through them, two more stand on Vincent Yard's sidings.
// - The covered bridge over the Rosedale Valley west of Castle Frank: an enclosed concrete box over Rosedale Valley
//   Road on blade piers, between grassed mounds (the valley's sides, which the flat city leaves out).
// - Every station's street entrances (OpenStreetMap railway=subway_entrance, or the station's node where none is
//   mapped): a stairway going down, set along the street on its sidewalk (beyond the sidewalk where the node lies in
//   open ground; else against the building line, clear of the inner walking line), its low walls & rail round it, and
//   the TTC's insignia pylon at the curb abreast of its open end (js/ttc-pylons.js draws them: the insignia, the entry
//   ID sign with the station's name & lines). An entrance in a building gets the pylon alone, at the curb. The stairs are a flat decal at the sidewalk drawn as a pit
//   (the view ray traced through the stairwell in the shader): the sidewalk itself stays whole.
// - Colliders for the player (the piers & abutments, the cuts' fences & the decks' parapets, the covered bridge's
//   piers & mounds, the stair walls & pylons); the trains sound like the
//   streetcars (window.CITY.Audio.addStreetcars: whine, rolling, joint clacks).
// - Cost: a few merged static meshes per structure, two instanced meshes for the cars; quality.js `subway` (x trains
//   per hour).

const { THREE, GEO, QUALITY, ROADS, blockAt, deckHeightAt, waterAt, nearestRoads, CITY_BOUNDS, cityUniforms } = window.CITY;
const { Fn, color, mix, step, smoothstep, abs, fract, floor, positionWorld, positionGeometry, normalGeometry, float, vec2, vec3, sin, dot, attribute, cameraPosition, select, min, max, exp, uv, texture } = window.CITY.TSL;
const S = window.CITY.GEO_SUBWAY || { ways: [], stations: [], entrances: [] };

// Viaduct
const ABUT = 30; // an abutment's length along the line, past the viaduct's end
const TUNNEL = ABUT - 1.5; // how far its tunnel lining runs in (a black end beyond: the cars are hidden past it)
const DECK_SLAB = 1.25; // the road deck's slab (city-grid.js: its soffit 1.25 m under the road)
const BOX_HALF = 4.8; // the lower deck's trusses, centre to side
const TRACK_HALF = 2.0; // track centres 4 m apart
const SPAN = 66; // the arches' target span
const EXT = 260; // the routes run on this far into the tunnels (out of sight)
// Toronto Rocket
const CAR_LEN = 23.0, CAR_W = 3.1, CAR_H = 3.65, CAR_GAP = 0.6, CARS = 6;
const TRAIN_LEN = CARS * CAR_LEN + (CARS - 1) * CAR_GAP;
const SPEED = 16; // m/s over the viaduct (~58 km/h)
const HEADWAY = 110; // s between trains each way (x quality.js `subway`)
// Entrances
const ST_HALF = 1.2; // a stairway's walls, centre to outer face (2 m clear between them)
const ST_IN = 1.0;
const ST_LEN = 6.4; // the open stairwell
const WALL_T = 0.2, WALL_H = 0.95;
const PYLON_CURB = 0.75; // a pylon's pole, in from the curb
const RISE = 0.17, TREAD = 0.28, SLOPE = RISE / TREAD;

const toPts = (flat) => {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ x: flat[i], z: flat[i + 1] });
  return out;
};
const lenOf = (P) => P.reduce((t, p, i) => (i ? t + Math.hypot(p.x - P[i - 1].x, p.z - P[i - 1].z) : 0), 0);
function at(P, s) {
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    if (s <= L || i === P.length - 1) {
      const t = L ? s / L : 0;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx: (b.x - a.x) / (L || 1), tz: (b.z - a.z) / (L || 1) };
    }
    s -= L;
  }
  return { x: P[0].x, z: P[0].z, tx: 1, tz: 0 };
}
function segDist(x, z, a, b) {
  const ex = b.x - a.x, ez = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1)));
  return Math.hypot(a.x + ex * t - x, a.z + ez * t - z);
}

// ---------------------------------------------------------------------------------------------------------------------
// The viaducts (OpenStreetMap bridge=viaduct): each pair of tracks' centre line, the road deck over it, the heights
// ---------------------------------------------------------------------------------------------------------------------
const VIADUCTS = (() => {
  const ways = S.ways.filter((w) => w[1] & 8).map((w) => toPts(w[4])).filter((P) => P.length > 1);
  const groups = [];
  for (const P of ways) {
    const g = groups.find((q) => q.some((o) => [P[0], P[P.length - 1]].some((p) => [o[0], o[o.length - 1]].some((e) => Math.hypot(e.x - p.x, e.z - p.z) < 20))));
    if (g) g.push(P);
    else groups.push([P]);
  }
  const out = [];
  for (const g of groups) {
    // every way the same way round as the first, then their mean, resampled every ~10 m
    const ref = g[0];
    const ws = g.map((P) => (Math.hypot(P[0].x - ref[0].x, P[0].z - ref[0].z) > Math.hypot(P[P.length - 1].x - ref[0].x, P[P.length - 1].z - ref[0].z) ? P.slice().reverse() : P));
    const L = Math.max(...ws.map(lenOf));
    const n = Math.max(1, Math.round(L / 10));
    const pts = [];
    for (let k = 0; k <= n; k++) {
      let x = 0, z = 0;
      for (const P of ws) {
        const p = at(P, (lenOf(P) * k) / n);
        x += p.x / ws.length;
        z += p.z / ws.length;
      }
      pts.push({ x, z });
    }
    const len = lenOf(pts);
    // the road deck over it (Bloor's: 22.5 m) and the heights hung from it
    let deck = 0;
    for (let k = 0; k <= 8; k++) {
      const p = at(pts, (len * k) / 8);
      deck = Math.max(deck, deckHeightAt(p.x, p.z, 200, 200));
    }
    if (deck < 12) continue; // (no deck to hang from: not one of ours)
    const soffit = deck - DECK_SLAB;
    const railY = soffit - 4.95;
    const a = at(pts, 0), b = at(pts, len);
    // the line from the far end of one abutment to the far end of the other
    const ends = [{ x: a.x - a.tx * ABUT, z: a.z - a.tz * ABUT }, ...pts, { x: b.x + b.tx * ABUT, z: b.z + b.tz * ABUT }];
    out.push({ pts, len, deck, soffit, railY, floorTop: railY - 0.2, floorBot: railY - 0.9, ends });
  }
  return out;
})();

// ---------------------------------------------------------------------------------------------------------------------
// The open cuts: Line 2 out of its tunnels in the west end (OpenStreetMap: its ways neither in a tunnel, covered nor on
// the viaduct, inside the city). There the real line runs at grade or bridges the streets in their valleys; the city
// is flat, so it runs in a trench instead and the streets cross it on decks at grade (the mapped crossings: Clendenan
// Ave between Runnymede & High Park, Indian Rd by Vincent Yard). Each trench lies along its main tracks' principal
// axis (t metres along, l across: l = -dx uz + dz ux, as city-config.js cutAt) and is cut, metre by metre, into
// open spans (concrete walls at the outermost tracks + CUT_CLEAR, the street level masked out over them, city-grid.js
// maskRoadCuts), decks (a street over it) and covered stretches (a building over the tracks, Keele station's: the
// trench ends in a tunnel portal at its face, as it does where the tunnels go on).
// ---------------------------------------------------------------------------------------------------------------------
const CUT_RAIL = -6.2; // rail top under the street level
const CUT_FLOOR = CUT_RAIL - 0.55; // the ballast floor between the tracks
const CUT_FOOT = CUT_FLOOR - 0.1;
const CUT_CLEAR = 2.6; // an outer track's centre to its wall (the car's side 1.55 m out, a walkway beyond)
const CUT_WALL = 0.4;
const CUT_UPSTAND = 0.6; // the walls' concrete top over the ground, the chain-link fence on it
const CUT_FENCE = 1.5;
const CUT_DECK = -1.15; // a street deck's soffit
const CUT_LINING = 24; // a portal's tunnel lining (a black end beyond: the cars are hidden past it)
const CUT_MIN_OPEN = 25; // a shorter open stretch stays in the tunnel
const CUT_HOLE_TOP = CUT_RAIL + 4.6;
const GAUGE_HALF = 0.7475; // the TTC's 1495 mm gauge

// True if polyline P comes within d of polyline Q
function polyNear(P, Q, d) {
  for (const p of P) for (let i = 1; i < Q.length; i++) if (segDist(p.x, p.z, Q[i - 1], Q[i]) < d) return true;
  return false;
}
// Ways end to end into the longest runs, going straight on at a junction (as rail-corridor.js chain)
function chainWays(ways) {
  const key = (p) => `${Math.round(p.x)},${Math.round(p.z)}`;
  const ends = new Map();
  ways.forEach((w, i) => {
    for (const [k, atStart] of [[key(w[0]), true], [key(w[w.length - 1]), false]]) (ends.get(k) || ends.set(k, []).get(k)).push({ w: i, atStart });
  });
  const used = new Set();
  const dir = (a, b) => {
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return [(b.x - a.x) / L, (b.z - a.z) / L];
  };
  const extend = (c) => {
    for (;;) {
      const d = dir(c[c.length - 2], c[c.length - 1]);
      let best = null, bd = 0.8;
      for (const e of ends.get(key(c[c.length - 1])) || []) {
        if (used.has(e.w)) continue;
        const pts = e.atStart ? ways[e.w] : ways[e.w].slice().reverse();
        const nd = dir(pts[0], pts[1]);
        if (d[0] * nd[0] + d[1] * nd[1] > bd) { bd = d[0] * nd[0] + d[1] * nd[1]; best = { e, pts }; }
      }
      if (!best) return;
      used.add(best.e.w);
      c.push(...best.pts.slice(1));
    }
  };
  const out = [];
  for (const i of ways.map((w, j) => j).sort((a, b) => lenOf(ways[b]) - lenOf(ways[a]))) {
    if (used.has(i)) continue;
    used.add(i);
    const c = ways[i].slice();
    extend(c);
    c.reverse();
    extend(c);
    out.push(c.reverse());
  }
  return out;
}
// A polyline in a cut's frame ({t, l}) clipped to ta <= t <= tb (it runs along t)
function clipT(Q, ta, tb) {
  const out = [];
  const lerp = (a, b, t) => ({ t, l: a.l + ((b.l - a.l) * (t - a.t)) / (b.t - a.t || 1) });
  for (let i = 0; i < Q.length; i++) {
    const p = Q[i];
    const inside = p.t >= ta && p.t <= tb;
    if (i > 0) {
      const a = Q[i - 1];
      for (const edge of [ta, tb]) if ((a.t - edge) * (p.t - edge) < 0) out.push(lerp(a, p, edge));
    }
    if (inside) out.push(p);
  }
  return out.sort((a, b) => a.t - b.t);
}

const SUBWAY_CUTS = (() => {
  const B = CITY_BOUNDS;
  const SWW = (GEO.frame && GEO.frame.sidewalk) || 4.6;
  const inCity = (P) => P.every((p) => p.x > B.minX + 30 && p.x < B.maxX - 30 && p.z > B.minZ + 30 && p.z < B.maxZ - 30);
  const ways = S.ways.filter((w) => !(w[1] & (2 | 4 | 8))).map((w) => ({ service: w[3], P: toPts(w[4]) })).filter((w) => w.P.length > 1 && inCity(w.P));
  // the ways in groups (within 30 m of one another)
  const groups = [];
  for (const w of ways) {
    const hits = groups.filter((g) => g.some((o) => polyNear(o.P, w.P, 30) || polyNear(w.P, o.P, 30)));
    const g = [w];
    for (const h of hits) {
      g.push(...h);
      groups.splice(groups.indexOf(h), 1);
    }
    groups.push(g);
  }
  const out = [];
  for (const g of groups) {
    const mains = g.filter((w) => !w.service);
    const pts = mains.flatMap((w) => w.P);
    if (pts.length < 2) continue;
    // the axis: the main tracks' principal direction, pointing east
    let cx = 0, cz = 0;
    for (const p of pts) { cx += p.x / pts.length; cz += p.z / pts.length; }
    let sxx = 0, sxz = 0, szz = 0;
    for (const p of pts) { sxx += (p.x - cx) ** 2; sxz += (p.x - cx) * (p.z - cz); szz += (p.z - cz) ** 2; }
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    let ux = Math.cos(ang), uz = Math.sin(ang);
    if (ux < 0) { ux = -ux; uz = -uz; }
    let tA = Infinity, tB = -Infinity;
    for (const p of pts) { const t = (p.x - cx) * ux + (p.z - cz) * uz; tA = Math.min(tA, t); tB = Math.max(tB, t); }
    const ox = cx + ux * tA, oz = cz + uz * tA, len = tB - tA;
    const local = (p) => ({ t: (p.x - ox) * ux + (p.z - oz) * uz, l: -(p.x - ox) * uz + (p.z - oz) * ux });
    const world = (t, l) => ({ x: ox + ux * t - uz * l, z: oz + uz * t + ux * l });
    // the main tracks end to end (one each way: the south one eastbound, as the TTC keeps right), the yard's sidings
    // & crossovers
    const chains = chainWays(mains.map((w) => w.P)).map((P) => {
      let Q = P.map(local);
      if (Q[0].t > Q[Q.length - 1].t) { P = P.slice().reverse(); Q = Q.reverse(); }
      return { P, Q, l: Q.reduce((s, q) => s + q.l, 0) / Q.length };
    }).filter((c) => c.Q[c.Q.length - 1].t - c.Q[0].t > 50).sort((a, b) => a.l - b.l);
    if (chains.length < 2) continue;
    const tracks = [...chains.map((c) => ({ Q: c.Q, main: true })), ...chainWays(g.filter((w) => w.service).map((w) => w.P)).map((P) => {
      const Q = P.map(local);
      return { Q: Q[0].t > Q[Q.length - 1].t ? Q.reverse() : Q, main: false };
    })];
    // every metre along: the outermost tracks either side
    const N = Math.ceil(len);
    const lo = new Float64Array(N + 1).fill(Infinity), hi = new Float64Array(N + 1).fill(-Infinity);
    for (const tr of tracks) {
      for (let i = 1; i < tr.Q.length; i++) {
        const a = tr.Q[i - 1], b = tr.Q[i];
        for (let k = Math.max(0, Math.ceil(Math.min(a.t, b.t))); k <= Math.min(N, Math.floor(Math.max(a.t, b.t))); k++) {
          const l = a.t === b.t ? a.l : a.l + ((b.l - a.l) * (k - a.t)) / (b.t - a.t);
          lo[k] = Math.min(lo[k], l);
          hi[k] = Math.max(hi[k], l);
        }
      }
    }
    for (let k = 0; k <= N; k++) if (!Number.isFinite(lo[k])) { lo[k] = k ? lo[k - 1] : chains[0].Q[0].l; hi[k] = k ? hi[k - 1] : chains[chains.length - 1].Q[0].l; }
    // covered where a building stands over the trench (its walls & a margin)
    const mid = world(len / 2, 0);
    const near = (GEO.buildings || []).filter((b) => Math.hypot(b[0] - mid.x, b[1] - mid.z) < len / 2 + 150).map(([bx, bz, a, parts]) => ({ bx, bz, cs: Math.cos(a), sn: Math.sin(a), parts })).filter((b) => {
      const q = local({ x: b.bx, z: b.bz });
      return q.t > -60 && q.t < len + 60 && Math.abs(q.l) < 90;
    });
    const inBuilding = (x, z) => {
      for (const { bx, bz, cs, sn, parts } of near) {
        const dx = x - bx, dz = z - bz, u = dx * cs - dz * sn, v = dx * sn + dz * cs;
        for (const [u0, u1, v0, v1] of parts) if (u > u0 - 0.4 && u < u1 + 0.4 && v > v0 - 0.4 && v < v1 + 0.4) return true;
      }
      return false;
    };
    const kind = new Uint8Array(N + 1); // 0 open, 1 deck, 2 covered
    for (let k = 0; k <= N; k++) {
      const a = lo[k] - CUT_CLEAR - CUT_WALL, b = hi[k] + CUT_CLEAR + CUT_WALL;
      for (let l = a; l < b + 0.999; l += 1) {
        const p = world(k + 0.5, Math.min(l, b));
        if (inBuilding(p.x, p.z)) { kind[k] = 2; break; }
      }
    }
    // the streets crossing it (at grade), each on a deck: its carriageway & sidewalks, skewed across the trench
    const decks = [];
    for (const r of ROADS) {
      if (r.raised) continue;
      for (let i = 1; i < r.pts.length; i++) {
        const a = local(r.pts[i - 1]), b = local(r.pts[i]);
        if (a.l * b.l > 0 || a.l === b.l) continue;
        const tc = a.t + ((b.t - a.t) * a.l) / (a.l - b.l);
        if (tc < 0 || tc > len) continue;
        const L = Math.hypot(b.t - a.t, b.l - a.l) || 1;
        const sn = Math.abs(b.l - a.l) / L, cs = Math.abs(b.t - a.t) / L;
        if (sn < 0.35) continue; // (running along it: not a crossing)
        const k = Math.round(tc);
        const W = Math.max(Math.abs(lo[k]), Math.abs(hi[k])) + CUT_CLEAR + CUT_WALL;
        const half = (r.w / 2 + SWW + 0.6) / sn + (cs / sn) * W;
        decks.push({ name: r.name, tc, t0: tc - half, t1: tc + half });
        for (let j = Math.max(0, Math.floor(tc - half)); j <= Math.min(N, Math.ceil(tc + half) - 1); j++) if (kind[j] !== 2) kind[j] = 1;
      }
    }
    // runs of a kind; the open stretches between covered ones (a deck at an end of one stays covered)
    const runs = [];
    for (let k = 0; k <= N; k++) {
      const r = runs[runs.length - 1];
      if (r && r.k === kind[k]) r.t1 = Math.min(len, k + 1);
      else runs.push({ k: kind[k], t0: k, t1: Math.min(len, k + 1) });
    }
    const opens = [];
    let cur = [];
    for (const r of [...runs, { k: 2 }]) {
      if (r.k !== 2) { cur.push(r); continue; }
      while (cur.length && cur[0].k === 1) cur.shift();
      while (cur.length && cur[cur.length - 1].k === 1) cur.pop();
      if (cur.filter((s) => s.k === 0).reduce((t, s) => t + s.t1 - s.t0, 0) >= CUT_MIN_OPEN) opens.push(cur);
      cur = [];
    }
    if (!opens.length) continue;
    const spans = (G) => {
      const sp = G.map((r) => {
        let l0 = Infinity, l1 = -Infinity;
        for (let k = r.t0; k < r.t1 && k <= N; k++) { l0 = Math.min(l0, lo[k] - CUT_CLEAR); l1 = Math.max(l1, hi[k] + CUT_CLEAR); }
        return { deck: r.k === 1, t0: r.t0, t1: r.t1, l0, l1 };
      });
      sp.forEach((s, i) => {
        if (!s.deck) return;
        s.l0 = Math.min(s.l0, sp[i - 1].l0, sp[i + 1].l0);
        s.l1 = Math.max(s.l1, sp[i - 1].l1, sp[i + 1].l1);
        s.name = (decks.find((d) => d.tc > s.t0 && d.tc < s.t1) || {}).name || '';
      });
      return sp;
    };
    const cut = {
      ox, oz, ux, uz, len, local, world, chains, tracks,
      groups: opens.map((G) => ({ t0: G[0].t0, t1: G[G.length - 1].t1, spans: spans(G) }))
    };
    cut.rects = cut.groups.flatMap((G) => G.spans.filter((s) => !s.deck).map((s) => ({ x0: ox + ux * s.t0, z0: oz + uz * s.t0, ux, uz, len: s.t1 - s.t0, l0: s.l0, l1: s.l1 })));
    out.push(cut);
  }
  return out;
})();
// The open spans' footprints, for the street level's mask (city-grid.js maskRoadCuts): { x0, z0, ux, uz, len, l0, l1 }
const SUBWAY_CUT_RECTS = SUBWAY_CUTS.flatMap((c) => c.rects);

// ---------------------------------------------------------------------------------------------------------------------
// The covered bridges (OpenStreetMap covered=yes bridges off the viaduct: Line 2's crossing of the Rosedale Valley west
// of Castle Frank, an enclosed concrete box over Rosedale Valley Road). The valley isn't in the flat city (Bloor St
// crosses it on a flyover deck beside it): the box stands on blade piers between two grassed mounds, the valley's
// sides, each faced with a concrete headwall where the box goes in. Nothing of the trains shows.
// ---------------------------------------------------------------------------------------------------------------------
const CB_SOFFIT = 4.9; // over the road
const CB_H = 5.0;
const CB_HALF = 4.9;
const CB_ABUT = 10; // a mound's flat top behind its headwall
const CB_SLOPE = 1.6; // its grassed sides: out per metre up
const COVERED = (() => {
  const B = CITY_BOUNDS;
  const ways = S.ways.filter((w) => (w[1] & 5) === 5 && !(w[1] & 10)).map((w) => toPts(w[4])).filter((P) => P.length > 1 && P.every((p) => p.x > B.minX && p.x < B.maxX && p.z > B.minZ && p.z < B.maxZ));
  const groups = [];
  for (const P of ways) {
    const g = groups.find((q) => q.some((o) => polyNear(o, P, 20)));
    if (g) g.push(P);
    else groups.push([P]);
  }
  return groups.map((g) => {
    // its tracks' centre line, resampled every ~10 m
    const ref = g[0];
    const ws = g.map((P) => (Math.hypot(P[0].x - ref[0].x, P[0].z - ref[0].z) > Math.hypot(P[P.length - 1].x - ref[0].x, P[P.length - 1].z - ref[0].z) ? P.slice().reverse() : P));
    const L = Math.max(...ws.map(lenOf));
    const n = Math.max(1, Math.round(L / 10));
    const pts = [];
    for (let k = 0; k <= n; k++) {
      let x = 0, z = 0;
      for (const P of ws) {
        const p = at(P, (lenOf(P) * k) / n);
        x += p.x / ws.length;
        z += p.z / ws.length;
      }
      pts.push({ x, z });
    }
    const len = lenOf(pts);
    const top = CB_SOFFIT + CB_H;
    const W = CB_HALF + 0.6, Sp = top * CB_SLOPE;
    // each end: its point, the way out (away from the valley), the mound's footprint
    const ends = [0, 1].map((end) => {
      const e = at(pts, end ? len : 0);
      const d = end ? 1 : -1;
      return { x: e.x, z: e.z, tx: e.tx * d, tz: e.tz * d };
    });
    return { pts, len, top, W, Sp, ends };
  }).filter((c) => c.len > 30);
})();
// (x, z) in an end's frame: a metres out from its headwall, c across
const endLocal = (e, x, z) => ({ a: (x - e.x) * e.tx + (z - e.z) * e.tz, c: -(x - e.x) * e.tz + (z - e.z) * e.tx });

/** True if (x, z) lies over a subway structure at grade, `m` metres round: a trench (its open spans, & its decks
 *  unless `decks` is false: they carry the streets; walls included) or a covered bridge (its box & mounds) */
function subwayCutAt(x, z, m = 0, decks = true) {
  for (const C of SUBWAY_CUTS) {
    const { t, l } = C.local({ x, z });
    if (t < -m - 30 || t > C.len + m + 30) continue;
    for (const G of C.groups) for (const s of G.spans) if ((decks || !s.deck) && t > s.t0 - m && t < s.t1 + m && l > s.l0 - CUT_WALL - m && l < s.l1 + CUT_WALL + m) return true;
  }
  for (const V of COVERED) {
    for (let i = 1; i < V.pts.length; i++) if (segDist(x, z, V.pts[i - 1], V.pts[i]) < CB_HALF + 0.5 + m) return true;
    for (const e of V.ends) {
      const { a, c } = endLocal(e, x, z);
      if (a > -0.5 - m && a < CB_ABUT + V.Sp + m && Math.abs(c) < V.W + V.Sp + m) return true;
    }
  }
  return false;
}

/** True where the flyover decks' plain piers (city-grid.js) must not stand: under a subway viaduct or its abutments */
function subwayKeepsClear(x, z) {
  for (const V of VIADUCTS) {
    const P = V.ends;
    for (let i = 1; i < P.length; i++) if (segDist(x, z, P[i - 1], P[i]) < 11.5) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------------------
// Geometry & materials
// ---------------------------------------------------------------------------------------------------------------------
// A quad p0 p1 p2 p3 (in order round its edge) facing (fx, fy, fz)
function quad(pos, p0, p1, p2, p3, fx, fy, fz) {
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2], vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
  const flip = (uy * vz - uz * vy) * fx + (uz * vx - ux * vz) * fy + (ux * vy - uy * vx) * fz < 0;
  const P = flip ? [p0, p3, p2, p1] : [p0, p1, p2, p3];
  for (const i of [0, 1, 2, 0, 2, 3]) pos.push(P[i][0], P[i][1], P[i][2]);
}
// A box in a local frame: origin (ox, oz), along (tx, tz), across (-tz, tx); a0..a1 along, c0..c1 across, y0..y1 up.
// `faces`: which to emit (default all six)
function obox(pos, ox, oz, tx, tz, a0, a1, c0, c1, y0, y1, faces = 63) {
  const nx = -tz, nz = tx;
  const P = (a, c, y) => [ox + tx * a + nx * c, y, oz + tz * a + nz * c];
  if (faces & 1) quad(pos, P(a0, c0, y1), P(a1, c0, y1), P(a1, c1, y1), P(a0, c1, y1), 0, 1, 0);
  if (faces & 2) quad(pos, P(a0, c0, y0), P(a1, c0, y0), P(a1, c1, y0), P(a0, c1, y0), 0, -1, 0);
  if (faces & 4) quad(pos, P(a0, c0, y0), P(a1, c0, y0), P(a1, c0, y1), P(a0, c0, y1), -nx, 0, -nz);
  if (faces & 8) quad(pos, P(a0, c1, y0), P(a1, c1, y0), P(a1, c1, y1), P(a0, c1, y1), nx, 0, nz);
  if (faces & 16) quad(pos, P(a0, c0, y0), P(a0, c1, y0), P(a0, c1, y1), P(a0, c0, y1), -tx, 0, -tz);
  if (faces & 32) quad(pos, P(a1, c0, y0), P(a1, c1, y0), P(a1, c1, y1), P(a1, c0, y1), tx, 0, tz);
}
// A beam of square section `w` from point A to point B ([x, y, z]), its sides turned with the frame (tx, tz)
function beam(pos, A, B, w, tx, tz) {
  const h = w / 2;
  const nx = -tz, nz = tx;
  const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
  const L = Math.hypot(dx, dy, dz) || 1;
  // a side vector across the frame, and one perpendicular to both
  const s = [nx * h, 0, nz * h];
  const ux = (dy * s[2] - dz * s[1]) / L, uy = (dz * s[0] - dx * s[2]) / L, uz = (dx * s[1] - dy * s[0]) / L;
  const c = (p, a, b) => [p[0] + s[0] * a + ux * b, p[1] + s[1] * a + uy * b, p[2] + s[2] * a + uz * b];
  for (const [a0, b0, a1, b1] of [[1, 1, 1, -1], [1, -1, -1, -1], [-1, -1, -1, 1], [-1, 1, 1, 1]]) {
    const fa = (a0 + a1) / 2, fb = (b0 + b1) / 2;
    quad(pos, c(A, a0, b0), c(A, a1, b1), c(B, a1, b1), c(B, a0, b0), s[0] * fa + ux * fb, s[1] * fa + uy * fb, s[2] * fa + uz * fb);
  }
}
function meshOf(pos, mat, name, { cast = true, receive = true, extra = null } = {}) {
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (extra) for (const [k, [arr, size]] of Object.entries(extra)) g.setAttribute(k, new THREE.Float32BufferAttribute(arr, size));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat);
  m.name = name;
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}
const hash2 = (p, k) => fract(sin(dot(floor(p), vec2(12.9898 * k, 78.233))).mul(43758.5453));

// The piers & abutments: pale poured concrete in 1.5 m lifts, darker toward the ground
function createConcreteMaterial(base = 0xb7b0a4, y0 = 0) {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
  mat.colorNode = Fn(() => {
    const p = positionWorld;
    const n = hash2(p.xz.mul(1.3).add(p.y.mul(0.7)), 1);
    const lift = smoothstep(0.0, 0.03, fract(p.y.div(1.5)));
    const grime = smoothstep(y0, y0 + 5.0, p.y);
    const streak = fract(sin(floor(p.x.add(p.z).mul(1.1)).mul(91.7)).mul(437.5)).mul(0.08);
    return color(base).mul(mix(float(0.7), float(1.0), grime)).mul(n.mul(0.06).add(0.94)).mul(lift.mul(0.12).add(0.88)).sub(streak.mul(float(1).sub(grime)));
  })();
  return mat;
}
// A trench's retaining walls: board-formed concrete in 6 m bays, weathered: rain streaks down from the coping, a dark
// splash band along the foot, the bays' tones a little apart
function createCutWallMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
  mat.colorNode = Fn(() => {
    const p = positionWorld;
    const h = p.x.add(p.z);
    const bay = fract(sin(floor(h.div(6.0)).mul(57.31)).mul(4375.85));
    const joint = smoothstep(0.0, 0.012, fract(h.div(6.0))).mul(float(1).sub(smoothstep(0.988, 1.0, fract(h.div(6.0)))));
    const board = smoothstep(0.0, 0.06, fract(p.y.div(0.3))).mul(0.04).add(0.96);
    // (soft mottling: two waves, not a blocky hash)
    const n = sin(h.mul(0.83).add(sin(p.y.mul(0.61)).mul(2.0))).mul(sin(p.y.mul(0.97).add(sin(h.mul(0.37)).mul(2.0)))).mul(0.5).add(0.5);
    // the streaks: thin & thick, longer under the coping's drips
    const s1 = fract(sin(floor(h.mul(1.7)).mul(91.7)).mul(437.5));
    const s2 = fract(sin(floor(h.mul(0.45)).mul(13.3)).mul(271.9));
    const fromTop = float(CITY_BOUNDS.sidewalkHeight + CUT_UPSTAND).sub(p.y).max(0);
    const streak = smoothstep(0.55, 1.0, s1).mul(float(1).sub(smoothstep(0.0, mix(float(1.5), float(5.5), s2), fromTop))).mul(0.22);
    const foot = float(1).sub(smoothstep(CUT_FOOT, CUT_FOOT + 1.6, p.y)).mul(0.3);
    const base = mix(color(0x6f685d), color(0x847c70), bay.mul(0.7).add(n.mul(0.3)));
    return base.mul(board).mul(joint.mul(0.16).add(0.84)).mul(float(1).sub(streak).sub(foot)).add(color(0x1a2410).mul(foot.mul(0.25)));
  })();
  return mat;
}
// The lower deck's steelwork: painted, weathered grey-green
function createSteelMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.62, metalness: 0.35 });
  mat.colorNode = Fn(() => {
    const p = positionWorld;
    const n = hash2(p.xz.mul(0.9).add(p.y), 2);
    return mix(color(0x4d5753), color(0x5f6a65), n);
  })();
  return mat;
}
// Track bed: dark concrete with the sleepers every 0.6 m (uv.y metres along, uv.x across)
function createBedMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
  mat.colorNode = Fn(() => {
    const u = abs(uv().x.sub(0.5));
    const sleeper = step(fract(uv().y.div(0.6)), 0.4).mul(step(u, 0.4));
    return mix(color(0x3f3b37), color(0x2a2724), sleeper);
  })();
  return mat;
}

// The Toronto Rocket's car: a stainless body over its dark skirt & bogies (origin at the rail top, +z ahead); a cab
// car's front slopes back above the anticlimber
function carGeometry(cab) {
  const g = new THREE.BoxGeometry(CAR_W, CAR_H - 0.35, CAR_LEN, 1, 5, cab ? 8 : 1).translate(0, 0.35 + (CAR_H - 0.35) / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), z = p.getZ(i), x = p.getX(i);
    // the roof's curve
    if (y > CAR_H - 0.5) p.setX(i, x * 0.9);
    if (cab && z > CAR_LEN / 2 - 0.01) {
      if (y > 1.6) p.setZ(i, z - Math.min(1, (y - 1.6) / 2.0) * 0.55);
      p.setX(i, x * 0.97);
    }
  }
  g.computeVertexNormals();
  return g;
}
function createCarMaterial(cab) {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.34, metalness: 0.55 });
  const y = positionGeometry.y, z = positionGeometry.z;
  const side = step(0.5, abs(normalGeometry.x));
  const front = step(0.35, normalGeometry.z).mul(cab ? 1 : 0);
  const roof = step(0.6, normalGeometry.y);
  const skirt = float(1.0).sub(smoothstep(1.02, 1.06, y));
  // the black window band down each side, broken by the doors (four a side, 1.6 m wide); the door leaves stainless
  // below their windows with a red edge
  const band = smoothstep(1.86, 1.9, y).mul(float(1.0).sub(smoothstep(2.82, 2.86, y)));
  const dz = fract(z.div(CAR_LEN / 4)).sub(0.5).mul(CAR_LEN / 4); // metres from the nearest door's centre
  const door = step(abs(dz), 0.8);
  const doorEdge = step(abs(abs(dz).sub(0.8)), 0.06).mul(step(y, 2.9)).mul(step(1.05, y));
  const doorWin = door.mul(smoothstep(1.5, 1.54, y)).mul(float(1.0).sub(smoothstep(2.6, 2.64, y))).mul(step(abs(abs(dz).sub(0.4)), 0.3));
  const stripe = smoothstep(1.62, 1.65, y).mul(float(1.0).sub(smoothstep(1.74, 1.77, y))).mul(float(1.0).sub(door));
  const glass = band.mul(float(1.0).sub(door)).max(doorWin).mul(side);
  // the cab's front: a black mask round the windscreen, a red apron under it, the headlights
  const lx = abs(positionGeometry.x);
  const mask = front.mul(smoothstep(1.55, 1.6, y)).mul(float(1.0).sub(smoothstep(3.2, 3.25, y)));
  const apron = front.mul(smoothstep(1.05, 1.1, y)).mul(float(1.0).sub(smoothstep(1.5, 1.55, y)));
  const lamp = front.mul(smoothstep(1.25, 1.28, y)).mul(float(1.0).sub(smoothstep(1.42, 1.45, y))).mul(smoothstep(0.95, 1.0, lx)).mul(float(1.0).sub(smoothstep(1.3, 1.35, lx)));
  const red = color(0xc8102e);
  let c = mix(color(0xd6dadd), color(0xb8bdc2), roof);
  c = mix(c, red, stripe.mul(side).max(doorEdge.mul(side)).max(apron));
  c = mix(c, color(0x0e1013), glass.max(mask));
  c = mix(c, color(0x2a2c2e), skirt);
  mat.colorNode = c;
  mat.roughnessNode = mix(float(0.34), float(0.08), glass.max(mask));
  mat.metalnessNode = mix(float(0.4), float(0.1), glass.max(mask).max(skirt));
  const night = smoothstep(0.6, 1.15, cityUniforms.uInteriorGlow);
  mat.emissiveNode = color(0xeef3ff).mul(glass).mul(night.mul(0.55).add(0.05)).add(color(0xfff4dc).mul(lamp).mul(night.mul(2.5).add(0.4)));
  return mat;
}

// ---------------------------------------------------------------------------------------------------------------------
// The viaduct's lower deck, piers, arches & abutments
// ---------------------------------------------------------------------------------------------------------------------
function buildViaduct(V, group, colliders) {
  const concrete = [], steel = [], bed = [], bedUv = [], rails = [], lining = [], dark = [];
  const { pts, len, soffit, railY, floorTop, floorBot } = V;
  // ground under it: streets, tracks & water must stay clear of a pier
  // (only what lies within 80 m of it)
  const near = (a, b) => V.ends.some((p, i) => i && Math.min(segDist(a.x, a.z, V.ends[i - 1], p), segDist(b.x, b.z, V.ends[i - 1], p)) < 80 + Math.hypot(b.x - a.x, b.z - a.z));
  const groundSegs = [];
  for (const r of window.CITY.ROADS) {
    if (r.raised) continue;
    for (let i = 0; i + 1 < r.pts.length; i++) if (near(r.pts[i], r.pts[i + 1])) groundSegs.push([r.pts[i], r.pts[i + 1], r.w / 2]);
  }
  for (const r of GEO.rails || []) {
    if (r[0] !== 1 || r[3] & 2) continue;
    const P = toPts(r[4]);
    for (let i = 1; i < P.length; i++) if (near(P[i - 1], P[i])) groundSegs.push([P[i - 1], P[i], 5.5]); // (room for a train's width & the arch over it)
  }
  const clearOf = (x, z, m) => {
    for (const [a, b, hw] of groundSegs) if (segDist(x, z, a, b) < hw + m) return false;
    return !waterAt(x, z);
  };
  const pierClear = (s) => {
    const p = at(pts, s);
    for (const a of [-2.5, 0, 2.5]) for (const c of [-11, -8.25, -5.5, -2.75, 0, 2.75, 5.5, 8.25, 11]) if (!clearOf(p.x + p.tx * a - p.tz * c, p.z + p.tz * a + p.tx * c, 1.0)) return false;
    return true;
  };
  // Piers: about every SPAN, each moved up to 14 m along to stand clear of what's under it (or left out)
  const n = Math.max(1, Math.round(len / SPAN));
  const supports = [0];
  for (let i = 1; i < n; i++) {
    const s0 = (len * i) / n;
    let s = null;
    for (const d of [0, 3, -3, 6, -6, 9, -9, 12, -12, 14, -14]) if (pierClear(s0 + d)) { s = s0 + d; break; }
    if (s !== null) supports.push(s);
  }
  supports.push(len);
  const PIER_HALF = 2.0; // along
  for (let k = 1; k < supports.length - 1; k++) {
    const s = supports[k];
    const p = at(pts, s);
    // the shaft (wider at its foot), and its two heads either side of the lower deck, up to the road's slab
    const foot = 11.2, top = 10.4;
    const nx = -p.tz, nz = p.tx;
    for (const [a0, a1] of [[-PIER_HALF, PIER_HALF]]) {
      // a tapered block: quads by hand
      const P = (a, c, y) => [p.x + p.tx * a + nx * c, y, p.z + p.tz * a + nz * c];
      const w = (y) => foot + ((top - foot) * y) / floorBot;
      const y0 = -0.5, y1 = floorBot;
      quad(concrete, P(a0, -w(y0), y0), P(a1, -w(y0), y0), P(a1, -w(y1), y1), P(a0, -w(y1), y1), -nx, 0, -nz);
      quad(concrete, P(a0, w(y0), y0), P(a1, w(y0), y0), P(a1, w(y1), y1), P(a0, w(y1), y1), nx, 0, nz);
      quad(concrete, P(a0, -w(y0), y0), P(a0, w(y0), y0), P(a0, w(y1), y1), P(a0, -w(y1), y1), -p.tx, 0, -p.tz);
      quad(concrete, P(a1, -w(y0), y0), P(a1, w(y0), y0), P(a1, w(y1), y1), P(a1, -w(y1), y1), p.tx, 0, p.tz);
      // its cap (a cornice band) and the heads
      obox(concrete, p.x, p.z, p.tx, p.tz, a0 - 0.3, a1 + 0.3, -top - 0.3, top + 0.3, floorBot - 0.6, floorBot, 63);
      obox(concrete, p.x, p.z, p.tx, p.tz, a0, a1, -top, -BOX_HALF - 0.3, floorBot, soffit, 63);
      obox(concrete, p.x, p.z, p.tx, p.tz, a0, a1, BOX_HALF + 0.3, top, floorBot, soffit, 63);
    }
    const hx = foot, hz = PIER_HALF, cs = p.tz, sn = p.tx;
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    colliders.push({ minX: p.x - ex, maxX: p.x + ex, minZ: p.z - ez, maxZ: p.z + ez, maxY: soffit, obb: { cx: p.x, cz: p.z, hx, hz, cs, sn } });
  }
  // Arches: two steel ribs under the lower deck's trusses in every span, their spandrel posts up to the floor
  for (let k = 0; k + 1 < supports.length; k++) {
    const sA = supports[k] + (k === 0 ? 0 : PIER_HALF), sB = supports[k + 1] - (k + 1 === supports.length - 1 ? 0 : PIER_HALF);
    const L = sB - sA;
    const rise = Math.min(L * 0.19, floorBot - 6.5); // (springing 6.5 m up: clear of the trucks & trains under it)
    const spring = floorBot - rise;
    const yAt = (t) => spring + rise * 4 * t * (1 - t);
    const N = Math.max(8, Math.round(L / 3));
    for (const c of [-BOX_HALF + 0.2, BOX_HALF - 0.2]) {
      for (let i = 0; i < N; i++) {
        const t0 = i / N, t1 = (i + 1) / N;
        const p0 = at(pts, sA + L * t0), p1 = at(pts, sA + L * t1);
        // the rib: 0.9 m deep, 0.7 m wide
        const A = (p, t, dy) => [p.x - p.tz * c, yAt(t) + dy, p.z + p.tx * c];
        const nx = -p0.tz * 0.35, nz = p0.tx * 0.35;
        const a0 = A(p0, t0, -0.45), a1 = A(p0, t0, 0.45), b0 = A(p1, t1, -0.45), b1 = A(p1, t1, 0.45);
        const off = (q, sg) => [q[0] + nx * sg, q[1], q[2] + nz * sg];
        quad(steel, off(a1, -1), off(b1, -1), off(b1, 1), off(a1, 1), 0, 1, 0);
        quad(steel, off(a0, -1), off(b0, -1), off(b0, 1), off(a0, 1), 0, -1, 0);
        quad(steel, off(a0, 1), off(b0, 1), off(b1, 1), off(a1, 1), nx, 0, nz);
        quad(steel, off(a0, -1), off(b0, -1), off(b1, -1), off(a1, -1), -nx, 0, -nz);
      }
      // spandrel posts every ~5.5 m
      const m = Math.max(2, Math.round(L / 5.5));
      for (let i = 1; i < m; i++) {
        const t = i / m;
        const y = yAt(t) + 0.45;
        if (floorBot - y < 0.4) continue;
        const p = at(pts, sA + L * t);
        beam(steel, [p.x - p.tz * c, y, p.z + p.tx * c], [p.x - p.tz * c, floorBot, p.z + p.tx * c], 0.4, p.tx, p.tz);
      }
    }
    // a brace across between the two ribs at each quarter
    for (const t of [0.25, 0.5, 0.75]) {
      const p = at(pts, sA + L * t);
      const y = yAt(t);
      beam(steel, [p.x + p.tz * (BOX_HALF - 0.2), y, p.z - p.tx * (BOX_HALF - 0.2)], [p.x - p.tz * (BOX_HALF - 0.2), y, p.z + p.tx * (BOX_HALF - 0.2)], 0.35, p.tz, -p.tx);
    }
  }
  // The lower deck: floor slab, plate girders along its edges, Warren trusses up to the road's slab, track beds & rails
  const PANEL = 5.5;
  const nPanels = Math.max(1, Math.round(len / PANEL));
  for (let i = 0; i < nPanels; i++) {
    const s0 = (len * i) / nPanels, s1 = (len * (i + 1)) / nPanels;
    const p0 = at(pts, s0), p1 = at(pts, s1);
    const C = (p, c, y) => [p.x - p.tz * c, y, p.z + p.tx * c];
    // floor slab (its top hidden under the beds) & its soffit
    quad(concrete, C(p0, -BOX_HALF, floorBot), C(p1, -BOX_HALF, floorBot), C(p1, BOX_HALF, floorBot), C(p0, BOX_HALF, floorBot), 0, -1, 0);
    quad(concrete, C(p0, -BOX_HALF, floorTop), C(p1, -BOX_HALF, floorTop), C(p1, BOX_HALF, floorTop), C(p0, BOX_HALF, floorTop), 0, 1, 0);
    for (const sg of [-1, 1]) {
      const c = BOX_HALF * sg, ci = (BOX_HALF - 0.25) * sg;
      // the plate girder: outer & inner faces, its top
      quad(steel, C(p0, c, floorBot), C(p1, c, floorBot), C(p1, c, railY + 0.75), C(p0, c, railY + 0.75), -p0.tz * sg, 0, p0.tx * sg);
      quad(steel, C(p0, ci, floorTop), C(p1, ci, floorTop), C(p1, ci, railY + 0.75), C(p0, ci, railY + 0.75), p0.tz * sg, 0, -p0.tx * sg);
      quad(steel, C(p0, ci, railY + 0.75), C(p1, ci, railY + 0.75), C(p1, c, railY + 0.75), C(p0, c, railY + 0.75), 0, 1, 0);
      // the truss: top chord under the road slab, a vertical at each panel point, one diagonal per panel (a Warren
      // truss: alternating)
      const cm = (BOX_HALF - 0.12) * sg;
      const top = soffit - 0.25;
      beam(steel, C(p0, cm, top), C(p1, cm, top), 0.36, p0.tx, p0.tz);
      beam(steel, C(p0, cm, railY + 0.75), C(p0, cm, top), 0.3, p0.tx, p0.tz);
      if (i % 2) beam(steel, C(p0, cm, railY + 0.75), C(p1, cm, top), 0.26, p0.tx, p0.tz);
      else beam(steel, C(p0, cm, top), C(p1, cm, railY + 0.75), 0.26, p0.tx, p0.tz);
    }
  }
  // the tracks, on through the abutments' tunnels
  const trackRun = [{ x: V.ends[0].x, z: V.ends[0].z }, ...pts, V.ends[V.ends.length - 1]];
  const TL = lenOf(trackRun);
  for (const o of [-TRACK_HALF, TRACK_HALF]) {
    const m = Math.max(1, Math.ceil(TL / 3));
    for (let i = 0; i < m; i++) {
      const p0 = at(trackRun, (TL * i) / m), p1 = at(trackRun, (TL * (i + 1)) / m);
      const C = (p, c, y) => [p.x - p.tz * (o + c), y, p.z + p.tx * (o + c)];
      const s0 = (TL * i) / m, s1 = (TL * (i + 1)) / m;
      bed.push(...C(p0, -1.4, floorTop + 0.08), ...C(p1, 1.4, floorTop + 0.08), ...C(p1, -1.4, floorTop + 0.08), ...C(p0, -1.4, floorTop + 0.08), ...C(p0, 1.4, floorTop + 0.08), ...C(p1, 1.4, floorTop + 0.08));
      bedUv.push(0, s0, 1, s1, 0, s1, 0, s0, 1, s0, 1, s1);
      for (const g of [-0.7175, 0.7175]) {
        const a = C(p0, g, railY), b = C(p1, g, railY);
        quad(rails, [a[0], railY - 0.15, a[2]], [b[0], railY - 0.15, b[2]], [b[0], railY, b[2]], [a[0], railY, a[2]], -p0.tz, 0, p0.tx);
        quad(rails, [a[0] - p0.tz * 0.035, railY, a[2] + p0.tx * 0.035], [b[0] - p0.tz * 0.035, railY, b[2] + p0.tx * 0.035], [b[0] + p0.tz * 0.035, railY, b[2] - p0.tx * 0.035], [a[0] + p0.tz * 0.035, railY, a[2] - p0.tx * 0.035], 0, 1, 0);
      }
    }
  }
  // Abutments: a solid block under the road from the ground to its slab, ABUT m along, its portal facing the valley
  const HOLE = { c: BOX_HALF - 0.3, y0: floorTop, y1: railY + 4.45 };
  for (const end of [0, 1]) {
    const e = at(pts, end ? len : 0);
    const dir = end ? 1 : -1; // outward, away from the valley
    const tx = e.tx * dir, tz = e.tz * dir;
    const W = 10.6;
    const roadAt = (a) => deckHeightAt(e.x + tx * a, e.z + tz * a, 200, 200) - DECK_SLAB;
    const nA = 6;
    const nx = -tz, nz = tx;
    const P = (a, c, y) => [e.x + tx * a + nx * c, y, e.z + tz * a + nz * c];
    for (let i = 0; i < nA; i++) {
      const a0 = (ABUT * i) / nA, a1 = (ABUT * (i + 1)) / nA;
      const h0 = Math.min(soffit, roadAt(a0)), h1 = Math.min(soffit, roadAt(a1));
      for (const c of [-W, W]) quad(concrete, P(a0, c, -0.5), P(a1, c, -0.5), P(a1, c, h1), P(a0, c, h0), nx * Math.sign(c), 0, nz * Math.sign(c));
      quad(concrete, P(a0, -W, h0), P(a1, -W, h1), P(a1, W, h1), P(a0, W, h0), 0, 1, 0);
      // the tunnel lining inside
      if (a0 < TUNNEL) {
        const b1 = Math.min(a1, TUNNEL);
        for (const sg of [-1, 1]) quad(lining, P(a0, HOLE.c * sg, HOLE.y0), P(b1, HOLE.c * sg, HOLE.y0), P(b1, HOLE.c * sg, HOLE.y1), P(a0, HOLE.c * sg, HOLE.y1), -nx * sg, 0, -nz * sg);
        quad(lining, P(a0, -HOLE.c, HOLE.y1), P(b1, -HOLE.c, HOLE.y1), P(b1, HOLE.c, HOLE.y1), P(a0, HOLE.c, HOLE.y1), 0, -1, 0);
        quad(lining, P(a0, -HOLE.c, HOLE.y0), P(b1, -HOLE.c, HOLE.y0), P(b1, HOLE.c, HOLE.y0), P(a0, HOLE.c, HOLE.y0), 0, 1, 0);
      }
    }
    // its back face (under the road ramp) and the tunnel's dark end
    const hb = Math.min(soffit, roadAt(ABUT));
    quad(concrete, P(ABUT, -W, -0.5), P(ABUT, W, -0.5), P(ABUT, W, hb), P(ABUT, -W, hb), tx, 0, tz);
    quad(dark, P(TUNNEL, -HOLE.c, HOLE.y0), P(TUNNEL, HOLE.c, HOLE.y0), P(TUNNEL, HOLE.c, HOLE.y1), P(TUNNEL, -HOLE.c, HOLE.y1), -tx, 0, -tz);
    // the valley face, round the portal (its top at the road's slab)
    const hf = soffit;
    quad(concrete, P(0, -W, -0.5), P(0, W, -0.5), P(0, W, HOLE.y0), P(0, -W, HOLE.y0), -tx, 0, -tz);
    quad(concrete, P(0, -W, HOLE.y0), P(0, -HOLE.c, HOLE.y0), P(0, -HOLE.c, hf), P(0, -W, hf), -tx, 0, -tz);
    quad(concrete, P(0, HOLE.c, HOLE.y0), P(0, W, HOLE.y0), P(0, W, hf), P(0, HOLE.c, hf), -tx, 0, -tz);
    quad(concrete, P(0, -HOLE.c, HOLE.y1), P(0, HOLE.c, HOLE.y1), P(0, HOLE.c, hf), P(0, -HOLE.c, hf), -tx, 0, -tz);
    // a portal frame standing proud of the face, and a cornice under the road
    obox(concrete, e.x, e.z, tx, tz, -0.5, 0, -HOLE.c - 0.9, -HOLE.c, HOLE.y0, HOLE.y1 + 0.9, 63 - 32);
    obox(concrete, e.x, e.z, tx, tz, -0.5, 0, HOLE.c, HOLE.c + 0.9, HOLE.y0, HOLE.y1 + 0.9, 63 - 32);
    obox(concrete, e.x, e.z, tx, tz, -0.5, 0, -HOLE.c, HOLE.c, HOLE.y1, HOLE.y1 + 0.9, 63 - 32);
    obox(concrete, e.x, e.z, tx, tz, -0.4, ABUT, -W - 0.4, W + 0.4, hf - 0.7, hf, 1 | 2 | 4 | 8 | 16);
    // the player's collider (the whole block; its top under the road)
    const cx = e.x + (tx * ABUT) / 2, cz = e.z + (tz * ABUT) / 2;
    const hx = W, hz = ABUT / 2, cs = tz, sn = tx;
    const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
    colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, maxY: Math.min(hb, soffit) - 0.5, obb: { cx, cz, hx, hz, cs, sn } });
  }

  const mats = { concrete: createConcreteMaterial(), steel: createSteelMaterial(), bed: createBedMaterial(), rails: new THREE.MeshStandardNodeMaterial({ color: 0x8e8a84, roughness: 0.35, metalness: 0.85 }), lining: new THREE.MeshStandardNodeMaterial({ color: 0x1d1e20, roughness: 0.96 }), dark: new THREE.MeshBasicNodeMaterial({ color: 0x000000 }) };
  const out = [
    meshOf(concrete, mats.concrete, 'SubwayViaductConcrete'),
    meshOf(steel, mats.steel, 'SubwayViaductSteel'),
    meshOf(bed, mats.bed, 'SubwayTrackBed', { cast: false, extra: { uv: [bedUv, 2] } }),
    meshOf(rails, mats.rails, 'SubwayRails', { cast: false }),
    meshOf(lining, mats.lining, 'SubwayTunnelLining', { cast: false }),
    meshOf(dark, mats.dark, 'SubwayTunnelEnd', { cast: false, receive: false })
  ].filter(Boolean);
  for (const m of out) group.add(m);
  return { supports: supports.length - 2 };
}

// Train routes over a viaduct: each track (on the right, as the TTC runs) from EXT m inside one tunnel to EXT m inside
// the other, and the stretch out in the open (between the tunnel linings' ends)
function viaductRoutes(V) {
  const a = at(V.pts, 0), b = at(V.pts, V.len);
  const line = [{ x: a.x - a.tx * EXT, z: a.z - a.tz * EXT }, ...V.pts, { x: b.x + b.tx * EXT, z: b.z + b.tz * EXT }];
  const routes = [];
  for (const dirn of [1, -1]) {
    const P = dirn > 0 ? line : line.slice().reverse();
    const off = P.map((p, i) => {
      const q0 = P[Math.max(0, i - 1)], q1 = P[Math.min(P.length - 1, i + 1)];
      const L = Math.hypot(q1.x - q0.x, q1.z - q0.z) || 1;
      const tx = (q1.x - q0.x) / L, tz = (q1.z - q0.z) / L;
      return { x: p.x - tz * TRACK_HALF, z: p.z + tx * TRACK_HALF }; // the right-hand track
    });
    const cum = [0];
    for (let i = 1; i < off.length; i++) cum.push(cum[i - 1] + Math.hypot(off[i].x - off[i - 1].x, off[i].z - off[i - 1].z));
    const len = cum[cum.length - 1];
    routes.push({ pts: off, cum, len, y: V.railY, show0: EXT - TUNNEL + 0.5, show1: len - EXT + TUNNEL - 0.5, phase: dirn > 0 ? 0 : 0.47 });
  }
  return routes;
}
function sample(route, s, out) {
  const { pts, cum } = route;
  s = Math.max(0, Math.min(route.len, s));
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const a = pts[lo], b = pts[hi];
  const t = (s - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo]);
  out.x = a.x + (b.x - a.x) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// The open cuts: walls, floor & tracks, the decks under the streets, the portals, the fence round the top
// ---------------------------------------------------------------------------------------------------------------------
// A collider for the player: a box `halfAlong` either side of (cx, cz) along (tx, tz), `halfAcross` across it
function obbCollider(colliders, cx, cz, tx, tz, halfAlong, halfAcross, maxY) {
  const hx = halfAcross, hz = halfAlong, cs = tz, sn = tx;
  const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
  colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, maxY, obb: { cx, cz, hx, hz, cs, sn } });
}
// Chain-link, galvanised: the diamond mesh cut out of a plane (uv in metres), its wires thickening with distance so
// it keeps its weight far off
function createChainLinkMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.45, metalness: 0.75, side: THREE.DoubleSide });
  mat.alphaTest = 0.5;
  const s = 0.075;
  const p = uv();
  const d = positionWorld.sub(cameraPosition).length();
  const k = min(max(d.mul(0.006), float(0.09)), float(0.3));
  const f1 = fract(p.x.add(p.y).div(s)), f2 = fract(p.x.sub(p.y).div(s));
  const w1 = step(min(f1, float(1).sub(f1)), k), w2 = step(min(f2, float(1).sub(f2)), k);
  mat.colorNode = color(0x8f9599);
  mat.opacityNode = max(w1, w2);
  return mat;
}

function buildCut(C, parent, colliders, mats) {
  const group = new THREE.Group();
  group.name = 'SubwayCut';
  parent.add(group);
  const SWH = CITY_BOUNDS.sidewalkHeight;
  const TOP = SWH + CUT_UPSTAND; // the walls' top
  const { ox, oz, ux, uz } = C;
  const nx = -uz, nz = ux;
  const P = (t, l, y) => [ox + ux * t + nx * l, y, oz + uz * t + nz * l];
  const box = (A, t0, t1, l0, l1, y0, y1, faces) => obox(A, ox, oz, ux, uz, t0, t1, l0, l1, y0, y1, faces);
  const concrete = [], floor = [], bed = [], bedUv = [], rails = [], lining = [], dark = [], fence = [], steel = [];
  const fenceAlong = (t0, t1, l) => {
    // along the trench, on a wall's top from t0 to t1
    quad(fence, P(t0, l, TOP), P(t1, l, TOP), P(t1, l, TOP + CUT_FENCE), P(t0, l, TOP + CUT_FENCE), nx, 0, nz);
    box(steel, t0, t1, l - 0.025, l + 0.025, TOP + CUT_FENCE - 0.05, TOP + CUT_FENCE, 1 | 2 | 4 | 8);
    const n = Math.max(1, Math.round((t1 - t0) / 3));
    for (let i = 0; i <= n; i++) {
      const t = t0 + ((t1 - t0) * i) / n;
      box(steel, t - 0.03, t + 0.03, l - 0.03, l + 0.03, TOP, TOP + CUT_FENCE + 0.04, 1 | 4 | 8 | 16 | 32);
    }
    const c = P((t0 + t1) / 2, l, 0);
    obbCollider(colliders, c[0], c[2], ux, uz, (t1 - t0) / 2 + 0.1, 0.35, TOP + CUT_FENCE + 1);
  };
  const fenceAcross = (t, l0, l1) => {
    quad(fence, P(t, l0, TOP), P(t, l1, TOP), P(t, l1, TOP + CUT_FENCE), P(t, l0, TOP + CUT_FENCE), ux, 0, uz);
    box(steel, t - 0.025, t + 0.025, l0, l1, TOP + CUT_FENCE - 0.05, TOP + CUT_FENCE, 1 | 2 | 16 | 32);
    const n = Math.max(1, Math.round((l1 - l0) / 3));
    for (let i = 0; i <= n; i++) {
      const l = l0 + ((l1 - l0) * i) / n;
      box(steel, t - 0.03, t + 0.03, l - 0.03, l + 0.03, TOP, TOP + CUT_FENCE + 0.04, 1 | 4 | 8 | 16 | 32);
    }
    const c = P(t, (l0 + l1) / 2, 0);
    obbCollider(colliders, c[0], c[2], nx, nz, (l1 - l0) / 2 + 0.1, 0.35, TOP + CUT_FENCE + 1);
  };
  const trackLAt = (Q, t) => {
    for (let i = 1; i < Q.length; i++) if ((Q[i - 1].t - t) * (Q[i].t - t) <= 0 && Q[i].t !== Q[i - 1].t) return Q[i - 1].l + ((Q[i].l - Q[i - 1].l) * (t - Q[i - 1].t)) / (Q[i].t - Q[i - 1].t);
    return null;
  };
  const stats = { decks: [], portals: 0 };
  for (const G of C.groups) {
    const S0 = G.spans[0], S1 = G.spans[G.spans.length - 1];
    // Walls, floor & decks, span by span
    G.spans.forEach((s, i) => {
      const yTop = s.deck ? CUT_DECK : TOP;
      box(concrete, s.t0, s.t1, s.l0 - CUT_WALL, s.l0, CUT_FOOT, yTop, s.deck ? 8 : 1 | 4 | 8);
      box(concrete, s.t0, s.t1, s.l1, s.l1 + CUT_WALL, CUT_FOOT, yTop, s.deck ? 4 : 1 | 4 | 8);
      quad(floor, P(s.t0, s.l0, CUT_FLOOR), P(s.t1, s.l0, CUT_FLOOR), P(s.t1, s.l1, CUT_FLOOR), P(s.t0, s.l1, CUT_FLOOR), 0, 1, 0);
      if (!s.deck) {
        fenceAlong(s.t0, s.t1, s.l0 - CUT_WALL / 2);
        fenceAlong(s.t0, s.t1, s.l1 + CUT_WALL / 2);
        return;
      }
      // a street's deck: its soffit, a parapet at either end (its outer face the deck's fascia, down to the soffit),
      // and where the trench is wider under it, the step in the walls below the soffit
      box(concrete, s.t0, s.t1, s.l0 - CUT_WALL, s.l1 + CUT_WALL, CUT_DECK, -0.02, 2);
      for (const [ta, tb] of [[s.t0, s.t0 + 0.35], [s.t1 - 0.35, s.t1]]) {
        box(concrete, ta, tb, s.l0 - CUT_WALL, s.l1 + CUT_WALL, CUT_DECK, SWH + 0.85, 1 | 4 | 8 | 16 | 32);
        const tm = (ta + tb) / 2;
        box(steel, tm - 0.04, tm + 0.04, s.l0 - CUT_WALL, s.l1 + CUT_WALL, SWH + 1.3, SWH + 1.36, 1 | 2 | 16 | 32);
        for (let l = s.l0 - CUT_WALL + 0.1; l < s.l1 + CUT_WALL; l += 1.6) box(steel, tm - 0.03, tm + 0.03, l - 0.03, l + 0.03, SWH + 0.85, SWH + 1.3, 4 | 8 | 16 | 32);
        const c = P((ta + tb) / 2, (s.l0 + s.l1) / 2, 0);
        obbCollider(colliders, c[0], c[2], nx, nz, (s.l1 - s.l0) / 2 + CUT_WALL + 0.1, 0.3, SWH + 3);
      }
      for (const [nb, t, f] of [[G.spans[i - 1], s.t0, -1], [G.spans[i + 1], s.t1, 1]]) {
        if (nb.l0 > s.l0 + 0.01) quad(concrete, P(t, s.l0, CUT_FOOT), P(t, nb.l0, CUT_FOOT), P(t, nb.l0, CUT_DECK), P(t, s.l0, CUT_DECK), ux * f, 0, uz * f);
        if (nb.l1 < s.l1 - 0.01) quad(concrete, P(t, nb.l1, CUT_FOOT), P(t, s.l1, CUT_FOOT), P(t, s.l1, CUT_DECK), P(t, nb.l1, CUT_DECK), ux * f, 0, uz * f);
      }
      stats.decks.push(s.name);
    });
    // Portals at the trench's ends: a headwall round the opening over the main tracks, a frame standing proud of it,
    // the tunnel lining and its dark end; the fence along the headwall's top
    for (const [s, t, f] of [[S0, G.t0, 1], [S1, G.t1, -1]]) {
      // f: the way into the trench
      const ls = C.chains.map((c) => trackLAt(c.Q, t)).filter((v) => v !== null);
      const h0 = Math.max(s.l0 + 0.2, Math.min(...ls) - 2.3), h1 = Math.min(s.l1 - 0.2, Math.max(...ls) + 2.3);
      const back = t - f * 0.8;
      const fx = ux * f, fz = uz * f;
      const W0 = s.l0 - CUT_WALL, W1 = s.l1 + CUT_WALL;
      quad(concrete, P(t, W0, CUT_FOOT), P(t, h0, CUT_FOOT), P(t, h0, TOP), P(t, W0, TOP), fx, 0, fz);
      quad(concrete, P(t, h1, CUT_FOOT), P(t, W1, CUT_FOOT), P(t, W1, TOP), P(t, h1, TOP), fx, 0, fz);
      quad(concrete, P(t, h0, CUT_HOLE_TOP), P(t, h1, CUT_HOLE_TOP), P(t, h1, TOP), P(t, h0, TOP), fx, 0, fz);
      quad(concrete, P(t, W0, TOP), P(t, W1, TOP), P(back, W1, TOP), P(back, W0, TOP), 0, 1, 0);
      // the frame (its sides & lintel 0.6 m wide, 0.35 m proud) and a cornice along the top
      const fr = t + f * 0.35;
      const tA = Math.min(t, fr), tB = Math.max(t, fr), ends = f > 0 ? 1 | 4 | 8 | 32 : 1 | 4 | 8 | 16;
      box(concrete, tA, tB, h0 - 0.6, h0, CUT_FLOOR, CUT_HOLE_TOP + 0.6, ends);
      box(concrete, tA, tB, h1, h1 + 0.6, CUT_FLOOR, CUT_HOLE_TOP + 0.6, ends);
      box(concrete, tA, tB, h0, h1, CUT_HOLE_TOP, CUT_HOLE_TOP + 0.6, ends | 2);
      box(concrete, tA, tB, W0, W1, TOP - 0.45, TOP, ends | 2);
      // the lining
      const e = t - f * CUT_LINING;
      const a0 = Math.min(t, e), a1 = Math.max(t, e);
      box(lining, a0, a1, h0 - 0.3, h0, CUT_FLOOR - 0.02, CUT_HOLE_TOP + 0.3);
      box(lining, a0, a1, h1, h1 + 0.3, CUT_FLOOR - 0.02, CUT_HOLE_TOP + 0.3);
      box(lining, a0, a1, h0, h1, CUT_HOLE_TOP, CUT_HOLE_TOP + 0.3);
      box(lining, a0, a1, h0, h1, CUT_FLOOR - 0.3, CUT_FLOOR - 0.02, 1);
      quad(dark, P(e, h0, CUT_FLOOR - 0.02), P(e, h1, CUT_FLOOR - 0.02), P(e, h1, CUT_HOLE_TOP), P(e, h0, CUT_HOLE_TOP), fx, 0, fz);
      fenceAcross(t - f * 0.4, W0, W1);
      stats.portals++;
    }
    // Tracks: the main ones on through the portals into the linings, the yard's sidings & crossovers within the
    // trench (a buffer stop where one ends short of a headwall)
    for (const tr of C.tracks) {
      let Q = tr.Q;
      if (tr.main) Q = [{ t: Math.min(Q[0].t, 0) - CUT_LINING, l: Q[0].l }, ...Q, { t: Math.max(Q[Q.length - 1].t, C.len) + CUT_LINING, l: Q[Q.length - 1].l }];
      const ta = tr.main ? G.t0 - CUT_LINING + 4 : G.t0 + 0.5, tb = tr.main ? G.t1 + CUT_LINING - 4 : G.t1 - 4;
      const R = clipT(Q, ta, tb);
      if (R.length < 2) continue;
      const W = R.map((q) => C.world(q.t, q.l));
      const TL = lenOf(W);
      const m = Math.max(1, Math.ceil(TL / 3));
      const yBed = CUT_FLOOR + (tr.main ? 0.14 : 0.12);
      for (let i = 0; i < m; i++) {
        const s0 = (TL * i) / m, s1 = (TL * (i + 1)) / m;
        const p0 = at(W, s0), p1 = at(W, s1);
        const Cn = (p, c, y) => [p.x - p.tz * c, y, p.z + p.tx * c];
        bed.push(...Cn(p0, -1.4, yBed), ...Cn(p1, 1.4, yBed), ...Cn(p1, -1.4, yBed), ...Cn(p0, -1.4, yBed), ...Cn(p0, 1.4, yBed), ...Cn(p1, 1.4, yBed));
        bedUv.push(0, s0, 1, s1, 0, s1, 0, s0, 1, s0, 1, s1);
        for (const g of [-GAUGE_HALF, GAUGE_HALF]) {
          const a = Cn(p0, g, CUT_RAIL), b = Cn(p1, g, CUT_RAIL);
          quad(rails, [a[0], CUT_RAIL - 0.17, a[2]], [b[0], CUT_RAIL - 0.17, b[2]], [b[0], CUT_RAIL, b[2]], [a[0], CUT_RAIL, a[2]], -p0.tz, 0, p0.tx);
          quad(rails, [a[0] - p0.tz * 0.035, CUT_RAIL, a[2] + p0.tx * 0.035], [b[0] - p0.tz * 0.035, CUT_RAIL, b[2] + p0.tx * 0.035], [b[0] + p0.tz * 0.035, CUT_RAIL, b[2] - p0.tx * 0.035], [a[0] + p0.tz * 0.035, CUT_RAIL, a[2] - p0.tx * 0.035], 0, 1, 0);
        }
      }
      if (!tr.main && tr.Q[tr.Q.length - 1].t > tb - 0.5) {
        const e = at(W, TL);
        obox(steel, e.x, e.z, e.tx, e.tz, -0.3, 0.3, -1.0, 1.0, CUT_RAIL - 0.2, CUT_RAIL + 1.1);
      }
    }
  }
  // uv from the positions (quad() may wind a face either way): the floor's (shoulder, metres along), the fence's
  // (metres along its line, metres up)
  const uvOf = (pos, f) => {
    const out = [];
    for (let i = 0; i < pos.length; i += 3) {
      const dx = pos[i] - ox, dz = pos[i + 2] - oz;
      out.push(...f(dx * ux + dz * uz, dx * nx + dz * nz, pos[i + 1]));
    }
    return out;
  };
  const floorUv = uvOf(floor, (t) => [1, t]), fenceUv = uvOf(fence, (t, l, y) => [t + l, y]);
  const out = [
    meshOf(concrete, mats.cutConcrete, 'SubwayCutWalls'),
    meshOf(floor, mats.ballast, 'SubwayCutFloor', { cast: false, extra: { uv: [floorUv, 2] } }),
    meshOf(bed, mats.ballast, 'SubwayCutTrackBed', { cast: false, extra: { uv: [bedUv, 2] } }),
    meshOf(rails, mats.rails, 'SubwayCutRails', { cast: false }),
    meshOf(lining, mats.lining, 'SubwayCutTunnelLining'),
    meshOf(dark, mats.dark, 'SubwayCutTunnelEnd', { cast: false, receive: false }),
    meshOf(fence, mats.chainLink, 'SubwayCutFence', { cast: false, extra: { uv: [fenceUv, 2] } }),
    meshOf(steel, mats.fenceSteel, 'SubwayCutFenceSteel')
  ].filter(Boolean);
  for (const m of out) group.add(m);
  return stats;
}

// A covered bridge: the box (pilasters every 6 m, a cornice), blade piers clear of the road under it, and at each end
// a concrete headwall with its wing walls holding a grassed mound
function buildCovered(V, parent, colliders, mats) {
  const group = new THREE.Group();
  group.name = 'SubwayCoveredBridge';
  parent.add(group);
  const concrete = [], grass = [];
  const { pts, len, top, W, Sp } = V;
  const y0 = CB_SOFFIT;
  // the box, every ~6 m
  const n = Math.max(1, Math.round(len / 6));
  for (let i = 0; i < n; i++) {
    const s0 = (len * i) / n, s1 = (len * (i + 1)) / n;
    const p0 = at(pts, s0), p1 = at(pts, s1);
    const C = (p, c, y) => [p.x - p.tz * c, y, p.z + p.tx * c];
    quad(concrete, C(p0, -CB_HALF, top), C(p1, -CB_HALF, top), C(p1, CB_HALF, top), C(p0, CB_HALF, top), 0, 1, 0);
    quad(concrete, C(p0, -CB_HALF, y0), C(p1, -CB_HALF, y0), C(p1, CB_HALF, y0), C(p0, CB_HALF, y0), 0, -1, 0);
    for (const sg of [-1, 1]) quad(concrete, C(p0, CB_HALF * sg, y0), C(p1, CB_HALF * sg, y0), C(p1, CB_HALF * sg, top), C(p0, CB_HALF * sg, top), -p0.tz * sg, 0, p0.tx * sg);
    // a pilaster at each bay's joint, the cornice along the top, a drip band along the soffit
    if (i) for (const sg of [-1, 1]) obox(concrete, p0.x, p0.z, p0.tx, p0.tz, -0.3, 0.3, sg > 0 ? CB_HALF : -CB_HALF - 0.18, sg > 0 ? CB_HALF + 0.18 : -CB_HALF, y0 - 0.25, top, sg > 0 ? 1 | 2 | 8 | 16 | 32 : 1 | 2 | 4 | 16 | 32);
    obox(concrete, p0.x, p0.z, p0.tx, p0.tz, 0, s1 - s0, -CB_HALF - 0.35, CB_HALF + 0.35, top, top + 0.45, 1 | 2 | 4 | 8);
    obox(concrete, p0.x, p0.z, p0.tx, p0.tz, 0, s1 - s0, -CB_HALF - 0.12, CB_HALF + 0.12, y0 - 0.25, y0, 2 | 4 | 8);
  }
  // piers about every 30 m, each moved along (up to 10 m) to stand clear of the streets under it, else left out
  const roads = ROADS.filter((r) => !r.raised && r.pts.some((p) => pts.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < len + 40)));
  const clear = (x, z) => {
    for (const r of roads) for (let i = 1; i < r.pts.length; i++) if (segDist(x, z, r.pts[i - 1], r.pts[i]) < r.w / 2 + 2.5) return false;
    return true;
  };
  const m = Math.max(1, Math.round(len / 30));
  let piers = 0;
  for (let i = 1; i < m; i++) {
    for (const d of [0, 3, -3, 6, -6, 10, -10]) {
      const p = at(pts, (len * i) / m + d);
      if (![-4.4, 0, 4.4].every((c) => [-0.8, 0.8].every((a) => clear(p.x + p.tx * a - p.tz * c, p.z + p.tz * a + p.tx * c)))) continue;
      obox(concrete, p.x, p.z, p.tx, p.tz, -0.7, 0.7, -4.2, 4.2, -0.3, y0 - 0.25, 4 | 8 | 16 | 32);
      obox(concrete, p.x, p.z, p.tx, p.tz, -1.0, 1.0, -4.8, 4.8, y0 - 0.85, y0 - 0.25, 1 | 2 | 4 | 8 | 16 | 32);
      obbCollider(colliders, p.x, p.z, p.tx, p.tz, 0.8, 4.3, y0);
      piers++;
      break;
    }
  }
  // the ends: headwall (its cornice), wing walls, the mound
  for (const e of V.ends) {
    const P = (a, c, y) => [e.x + e.tx * a - e.tz * c, y, e.z + e.tz * a + e.tx * c];
    const Ht = top + 0.2, A = CB_ABUT;
    quad(concrete, P(0, -W - 0.4, -0.3), P(0, W + 0.4, -0.3), P(0, W + 0.4, Ht + 0.5), P(0, -W - 0.4, Ht + 0.5), -e.tx, 0, -e.tz);
    obox(concrete, e.x, e.z, e.tx, e.tz, -0.45, 0.3, -W - 0.4, W + 0.4, Ht + 0.5, Ht + 0.85, 1 | 2 | 4 | 8 | 16 | 32);
    for (const sg of [-1, 1]) {
      // the wing wall, stepping down beside the mound's side, its face toward the valley
      const c0 = (W + 0.4) * sg, c1 = (W + Sp) * sg;
      quad(concrete, P(0, c0, -0.3), P(0, c1, -0.3), P(0, c1, 0.4), P(0, c0, Ht + 0.5), -e.tx, 0, -e.tz);
      obox(concrete, e.x, e.z, e.tx, e.tz, 0, 0.45, Math.min(c0, c1), Math.max(c0, c1), -0.3, 0.4, 1 | 4 | 8);
      quad(concrete, P(0.45, c0, Ht + 0.5), P(0.45, c1, 0.4), P(0, c1, 0.4), P(0, c0, Ht + 0.5), 0, 1, 0);
      // the mound's side
      quad(grass, P(0.45, W * sg, Ht), P(A, W * sg, Ht), P(A, (W + Sp) * sg, 0), P(0.45, (W + Sp) * sg, 0), -e.tz * sg, 1, e.tx * sg);
      // its corner
      const tri = [P(A, W * sg, Ht), P(A + Sp, W * sg, 0), P(A, (W + Sp) * sg, 0)];
      quad(grass, tri[0], tri[1], tri[2], tri[2], e.tx - e.tz * sg, 1, e.tz + e.tx * sg);
    }
    quad(grass, P(0.45, -W, Ht), P(A, -W, Ht), P(A, W, Ht), P(0.45, W, Ht), 0, 1, 0);
    quad(grass, P(A, -W, Ht), P(A, W, Ht), P(A + Sp, W, 0), P(A + Sp, -W, 0), e.tx, 1, e.tz);
    // the player's collider: the mound out to where it's ~1 m high
    const R = A + Sp * 0.88;
    obbCollider(colliders, e.x + (e.tx * R) / 2, e.z + (e.tz * R) / 2, e.tx, e.tz, R / 2, W + Sp * 0.88, Ht + 1);
  }
  for (const m2 of [meshOf(concrete, mats.coveredConcrete, 'SubwayCoveredBridge'), meshOf(grass, mats.mound, 'SubwayCoveredMounds')].filter(Boolean)) group.add(m2);
  return { piers };
}

// Train routes through a trench: on the main tracks (eastbound on the south one), EXT m on into the tunnels at
// either end; shown between the outermost portals' tunnel linings
function cutRoutes(C, k) {
  const routes = [];
  const T0 = Math.min(...C.groups.map((G) => G.t0)), T1 = Math.max(...C.groups.map((G) => G.t1));
  for (const [c, dirn] of [[C.chains[C.chains.length - 1], 1], [C.chains[0], -1]]) {
    const a = c.P[0], b = c.P[c.P.length - 1];
    let line = [{ x: a.x - C.ux * EXT, z: a.z - C.uz * EXT }, ...c.P, { x: b.x + C.ux * EXT, z: b.z + C.uz * EXT }];
    if (dirn < 0) line = line.reverse();
    const cum = [0];
    for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].z - line[i - 1].z));
    const len = cum[cum.length - 1];
    // route distance at trench position t (the chain runs along t)
    const sAt = (t) => (dirn > 0 ? EXT + t - c.Q[0].t : EXT + c.Q[c.Q.length - 1].t - t);
    const [o0, o1] = [sAt(T0), sAt(T1)].sort((p, q) => p - q);
    routes.push({ pts: line, cum, len, y: CUT_RAIL, show0: o0 - CUT_LINING + 0.5, show1: o1 + CUT_LINING - 0.5, open0: o0, open1: o1, phase: (0.23 + 0.31 * k + (dirn > 0 ? 0 : 0.5)) % 1 });
  }
  return routes;
}
// Trains laid up in the yard: on its longest sidings, nosed up to the buffer stops at the trench's east end
function parkedTrains(C) {
  const out = [];
  const G = C.groups[C.groups.length - 1];
  const sidings = C.tracks.filter((tr) => !tr.main).map((tr) => clipT(tr.Q, G.t0 + 0.5, G.t1 - 4)).filter((R) => R.length > 1).map((R) => R.map((q) => C.world(q.t, q.l))).filter((W) => lenOf(W) > TRAIN_LEN + 8).sort((a, b) => lenOf(b) - lenOf(a));
  for (const W of sidings.slice(0, 2)) {
    const TL = lenOf(W);
    const cars = [];
    for (let i = 0; i < CARS; i++) {
      const front = TL - 3 - i * (CAR_LEN + CAR_GAP), back = front - CAR_LEN;
      const A = at(W, front), Bk = at(W, back);
      cars.push({ x: (A.x + Bk.x) / 2, z: (A.z + Bk.z) / 2, yaw: Math.atan2(A.x - Bk.x, A.z - Bk.z) + (i === CARS - 1 ? Math.PI : 0), cab: i === 0 || i === CARS - 1 });
    }
    out.push(cars);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Station entrances
// ---------------------------------------------------------------------------------------------------------------------
// The stairwell, traced in the shader: from the decal's point at the sidewalk the view ray runs down into a box
// ST_IN wide either side & ST_LEN long whose floor is the flight of stairs (RISE / TREAD) and whose far wall opens into
// the dark passage to the station. Treads & risers, the yellow nosings, tiled walls with their handrails
function createStairwellMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -2;
  const frame = attribute('stairFrame', 'vec4'); // the opening's middle (x, z) & the way down (tx, tz)
  const albedo = Fn(() => {
    const tx = frame.z, tz = frame.w;
    const rel = positionWorld.xz.sub(frame.xy);
    const u0 = rel.y.mul(tx).sub(rel.x.mul(tz));
    const v0 = rel.x.mul(tx).add(rel.y.mul(tz));
    const d = positionWorld.sub(cameraPosition).normalize();
    const du0 = d.z.mul(tx).sub(d.x.mul(tz));
    const dv0 = d.x.mul(tx).add(d.z.mul(tz));
    const du = select(abs(du0).lessThan(1e-4), float(1e-4), du0);
    const dv = select(abs(dv0).lessThan(1e-4), float(1e-4), dv0);
    const dy = min(d.y, float(-1e-4));
    const tS = select(du.greaterThan(0), float(ST_IN), float(-ST_IN)).sub(u0).div(du).max(0);
    const tV = select(dv.greaterThan(0), float(ST_LEN), float(0)).sub(v0).div(dv).max(0);
    const den = dy.add(dv.mul(SLOPE));
    const tF = select(den.lessThan(-1e-4), v0.mul(SLOPE).div(den.negate()), float(1e4));
    const t = min(min(tS, tV), tF);
    const hu = u0.add(du.mul(t)), hv = v0.add(dv.mul(t)), hy = dy.mul(t);
    const isFloor = step(tF, min(tS, tV).add(1e-3));
    const isEnd = float(1).sub(isFloor).mul(step(tV, tS));
    // the stairs
    const k = fract(hv.div(TREAD));
    const stairs = mix(mix(color(0x8a8780), color(0x5c5a55), step(0.72, k)), color(0xd9b000), step(k, 0.07));
    // tiled walls (TTC cream), the grout every 0.3 m, the handrail 0.9 m over the stairs
    const along = select(isEnd.greaterThan(0.5), hu, hv);
    const grout = step(0.94, fract(along.div(0.3))).max(step(0.92, fract(hy.div(0.15))));
    const rail = step(abs(hy.add(hv.mul(SLOPE)).sub(0.9)), 0.04).mul(float(1).sub(isEnd));
    let walls = mix(mix(color(0xb9b09a), color(0x8a8474), grout), color(0x8d9398), rail);
    // the far wall opens into the dark below 2.3 m over the bottom step
    const depthEnd = float(ST_LEN * SLOPE);
    walls = mix(walls, color(0x050505), isEnd.mul(step(hy, depthEnd.negate().add(2.3))));
    const c = mix(walls, stairs, isFloor);
    // darker going down, out of the daylight
    return c.mul(exp(hy.mul(0.62)).mul(0.78).add(0.06));
  })();
  mat.colorNode = albedo;
  const night = smoothstep(0.6, 1.15, cityUniforms.uInteriorGlow);
  mat.emissiveNode = albedo.mul(night.mul(0.7));
  return mat;
}
function buildEntrances(group, colliders) {
  const SW = (GEO.frame && GEO.frame.sidewalk) || 4.6;
  const SWH = CITY_BOUNDS.sidewalkHeight;
  const inCity = (x, z) => x > CITY_BOUNDS.minX && x < CITY_BOUNDS.maxX && z > CITY_BOUNDS.minZ && z < CITY_BOUNDS.maxZ;
  // what a stairway must keep clear of: buildings, the street trees & the City's street furniture
  const bGrid = new Map();
  (GEO.buildings || []).forEach((b, i) => {
    const k = Math.floor(b[0] / 50) * 100000 + Math.floor(b[1] / 50);
    (bGrid.get(k) || bGrid.set(k, []).get(k)).push(b);
  });
  const inBuilding = (x, z, m) => {
    const cx0 = Math.floor(x / 50), cz0 = Math.floor(z / 50);
    for (let a = -2; a <= 2; a++) for (let c = -2; c <= 2; c++) {
      for (const [bx, bz, ang, parts] of bGrid.get((cx0 + a) * 100000 + cz0 + c) || []) {
        const cs = Math.cos(ang), sn = Math.sin(ang), dx = x - bx, dz = z - bz;
        const u = dx * cs - dz * sn, v = dx * sn + dz * cs;
        for (const [u0, u1, v0, v1] of parts) if (u > u0 - m && u < u1 + m && v > v0 - m && v < v1 + m) return true;
      }
    }
    return false;
  };
  const pGrid = new Map();
  const addP = (x, z, r) => {
    const k = Math.floor(x / 8) * 100000 + Math.floor(z / 8);
    (pGrid.get(k) || pGrid.set(k, []).get(k)).push(x, z, r);
  };
  const ST = GEO.streetTrees || [];
  for (let i = 0; i < ST.length; i += 4) addP(ST[i], ST[i + 1], 1.0);
  for (const [key, list] of Object.entries(GEO.props || {})) {
    if (!Array.isArray(list)) continue;
    const r = key === 'shelter' ? 2.2 : 0.6;
    for (let i = 0; i + 1 < list.length; i += 2) addP(list[i], list[i + 1], r);
  }
  const nearProp = (x, z, m) => {
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) {
      const L = pGrid.get((Math.floor(x / 8) + a) * 100000 + Math.floor(z / 8) + c);
      for (let i = 0; L && i < L.length; i += 3) if (Math.hypot(L[i] - x, L[i + 1] - z) < L[i + 2] + m) return true;
    }
    return false;
  };
  const placed = [];
  // A stairway centred at (cx, cz), along (tx, tz): wholly on one curb island, clear of buildings, trees, furniture &
  // the other entrances
  const fits = (cx, cz, tx, tz) => {
    const blk = blockAt(cx, cz);
    if (!blk) return false;
    const nx = -tz, nz = tx;
    for (const a of [-0.5, -0.25, 0, 0.25, 0.5]) {
      for (const c of [-1, 0, 1]) {
        const x = cx + tx * a * (ST_LEN + 0.6) + nx * c * (ST_HALF + 0.1), z = cz + tz * a * (ST_LEN + 0.6) + nz * c * (ST_HALF + 0.1);
        if (blockAt(x, z) !== blk || inBuilding(x, z, 0.3) || subwayCutAt(x, z, 1)) return false;
        if (c === 0 && nearProp(x, z, 1.4)) return false;
      }
    }
    for (const p of placed) if (Math.hypot(p.x - cx, p.z - cz) < ST_LEN + 1) return false;
    return true;
  };
  const stations = S.stations.filter(([x, z]) => inCity(x, z));
  const stationOf = (x, z) => {
    let best = null, bd = 450;
    for (const s of stations) {
      const d = Math.hypot(s[0] - x, s[1] - z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  };
  // The street an entrance belongs to: the nearest named at-grade one, its direction, where its curb is on this side
  const streetOf = (x, z) => {
    for (const r of nearestRoads(x, z, 45)) {
      if (r.road.raised) continue;
      let dx = r.dx, dz = r.dz;
      const side = Math.sign((x - r.px) * -dz + (z - r.pz) * dx) || 1;
      const nx = -dz * side, nz = dx * side; // toward the entrance
      let curb = null;
      for (let t = 0; t <= 30; t += 0.25) if (blockAt(r.px + nx * t, r.pz + nz * t)) { curb = t; break; }
      if (curb === null) continue;
      return { ...r, nx, nz, curb, lat: r.dist };
    }
    return null;
  };
  const sites = [];
  const todo = S.entrances.filter(([x, z]) => inCity(x, z)).map(([x, z, st, colour, name]) => ({ x, z, st, colour, name }));
  for (const s of stations) {
    if (!todo.some((e) => e.st === s[2] && Math.hypot(e.x - s[0], e.z - s[1]) < 400)) todo.push({ x: s[0], z: s[1], st: s[2], colour: s[3], name: '', fromStation: true });
  }
  let stairs = 0, signs = 0, skipped = 0;
  for (const e of todo) {
    const st = e.st ? stations.find((s) => s[2] === e.st) || stationOf(e.x, e.z) : stationOf(e.x, e.z);
    const name = (st && st[2]) || e.st;
    if (!name) { skipped++; continue; }
    const colour = e.colour || (st && st[3]) || 'yellow';
    const R = streetOf(e.x, e.z);
    if (!R) { skipped++; continue; }
    // the way down: toward the station along the street
    let tx = R.dx, tz = R.dz;
    if (st && (st[0] - e.x) * tx + (st[1] - e.z) * tz < 0) { tx = -tx; tz = -tz; }
    const insideBuilding = !e.fromStation && inBuilding(e.x, e.z, -0.6); // (well inside: one on its outline may be stairs on the sidewalk)
    const beyond = R.curb + SW + 0.25 + ST_HALF;
    const onWalk = R.curb + SW - ST_HALF - 0.05;
    const lats = insideBuilding ? [] : R.lat > R.curb + SW + 0.3 ? [Math.max(beyond, Math.min(R.lat, beyond + 6)), beyond, onWalk] : [onWalk, beyond];
    let site = null;
    for (const lat of lats) {
      for (const d of [0, 2, -2, 4, -4, 6, -6, 9, -9, 12, -12]) {
        const cx = R.px + R.nx * lat + tx * d, cz = R.pz + R.nz * lat + tz * d;
        if (fits(cx, cz, tx, tz)) { site = { x: cx, z: cz, tx, tz, kind: 'stair' }; break; }
      }
      if (site) break;
    }
    if (!site) {
      // the sign alone, at the curb in front (an entrance in a building, or no room for the stairs)
      const lat = R.curb + 0.65;
      for (const d of [0, 1.5, -1.5, 3, -3, 5, -5]) {
        const x = R.px + R.nx * lat + tx * d, z = R.pz + R.nz * lat + tz * d;
        if (blockAt(x, z) && !nearProp(x, z, 0.4) && !inBuilding(x, z, 0.3) && !subwayCutAt(x, z, 0.5) && !placed.some((p) => Math.hypot(p.x - x, p.z - z) < 3)) { site = { x, z, tx, tz, kind: 'sign' }; break; }
      }
    }
    if (!site) { skipped++; continue; }
    // the pylon: at the curb abreast of the stairway's open end (a sign-only site's own spot), clear of the street's
    // furniture & the other pylons; else beside the opening
    if (site.kind === 'stair') {
      const a0 = (site.x - R.px) * tx + (site.z - R.pz) * tz - ST_LEN / 2 - 0.4, lat = R.curb + PYLON_CURB;
      for (const d of [0, -1, 1, -2, 2, -3, 3]) {
        const x = R.px + R.nx * lat + tx * (a0 + d), z = R.pz + R.nz * lat + tz * (a0 + d);
        if (blockAt(x, z) && !nearProp(x, z, 0.5) && !inBuilding(x, z, 0.4) && !placed.some((p) => p.pylon && Math.hypot(p.pylon.x - x, p.pylon.z - z) < 2.5)) { site.pylon = { x, z }; break; }
      }
      if (!site.pylon) {
        const sd = Math.sign(-R.nx * -tz + -R.nz * tx) || 1; // (the stairway's curb side)
        site.pylon = { x: site.x - tx * (ST_LEN / 2 + 0.35) - tz * sd * (ST_HALF + 0.4), z: site.z - tz * (ST_LEN / 2 + 0.35) + tx * sd * (ST_HALF + 0.4) };
      }
    } else site.pylon = { x: site.x, z: site.z };
    site.y = blockAt(site.x, site.z) ? SWH : 0;
    site.name = name;
    site.colour = colour;
    site.curbSide = { x: -R.nx, z: -R.nz };
    placed.push(site);
    if (site.kind === 'stair') stairs++;
    else signs++;
  }

  // Geometry
  const walls = [], metal = [], pit = [], pitFrame = [];
  const pylons = [];
  for (const p of placed) {
    const { tx, tz, y } = p;
    const nx = -tz, nz = tx;
    if (p.kind === 'stair') {
      const ox = p.x - tx * (ST_LEN / 2), oz = p.z - tz * (ST_LEN / 2); // the opening's middle
      // the stairwell decal
      const P = (a, c) => [ox + tx * a + nx * c, y + 0.012, oz + tz * a + nz * c];
      quad(pit, P(0, -ST_IN), P(ST_LEN, -ST_IN), P(ST_LEN, ST_IN), P(0, ST_IN), 0, 1, 0);
      for (let i = 0; i < 6; i++) pitFrame.push(ox, oz, tx, tz);
      // its walls (both sides & the far end) with their stainless rail on short posts
      obox(walls, ox, oz, tx, tz, 0, ST_LEN + WALL_T, -ST_HALF, -ST_IN, y - 0.05, y + WALL_H);
      obox(walls, ox, oz, tx, tz, 0, ST_LEN + WALL_T, ST_IN, ST_HALF, y - 0.05, y + WALL_H);
      obox(walls, ox, oz, tx, tz, ST_LEN, ST_LEN + WALL_T, -ST_IN, ST_IN, y - 0.05, y + WALL_H);
      for (const c of [-(ST_IN + WALL_T / 2), ST_IN + WALL_T / 2]) {
        obox(metal, ox, oz, tx, tz, 0.05, ST_LEN + WALL_T - 0.05, c - 0.03, c + 0.03, y + WALL_H + 0.2, y + WALL_H + 0.26);
        for (let a = 0.1; a < ST_LEN + 0.1; a += 1.6) obox(metal, ox, oz, tx, tz, a, a + 0.05, c - 0.025, c + 0.025, y + WALL_H, y + WALL_H + 0.2, 4 | 8 | 16 | 32);
      }
      obox(metal, ox, oz, tx, tz, ST_LEN + WALL_T / 2 - 0.03, ST_LEN + WALL_T / 2 + 0.03, -ST_HALF + 0.1, ST_HALF - 0.1, y + WALL_H + 0.2, y + WALL_H + 0.26);
      const hx = ST_HALF, hz = (ST_LEN + WALL_T) / 2, cx = ox + tx * hz, cz = oz + tz * hz, cs = tz, sn = tx;
      const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
      colliders.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, maxY: y + WALL_H + 0.26, obb: { cx, cz, hx, hz, cs, sn } });
    }
    // the pylon (js/ttc-pylons.js), its faces along the street, its entry ID sign (the model's +x) reaching away from
    // the curb over the sidewalk; its pole & base the rider's collider (the signs overhead clear a rider)
    const { x: px, z: pz } = p.pylon;
    const py = blockAt(px, pz) ? SWH : 0;
    let yaw = Math.atan2(tx, tz);
    if (Math.cos(yaw) * -p.curbSide.x - Math.sin(yaw) * -p.curbSide.z < 0) yaw += Math.PI;
    pylons.push({ x: px, y: py, z: pz, yaw, station: p.name, colour: p.colour });
    colliders.push({ minX: px - 0.3, maxX: px + 0.3, minZ: pz - 0.3, maxZ: pz + 0.3, maxY: py + 4.0 });
  }
  const wallMat = createConcreteMaterial(0x8f8a83);
  const metalMat = new THREE.MeshStandardNodeMaterial({ color: 0x9aa0a5, roughness: 0.3, metalness: 0.85 });
  const out = [
    meshOf(walls, wallMat, 'SubwayEntranceWalls'),
    meshOf(metal, metalMat, 'SubwayEntranceMetal'),
    meshOf(pit, createStairwellMaterial(), 'SubwayStairwells', { cast: false, extra: { stairFrame: [pitFrame, 4] } })
  ].filter(Boolean);
  for (const m of out) group.add(m);
  return { stairs, signs, skipped, sites: placed, pylons };
}

// ---------------------------------------------------------------------------------------------------------------------
function createSubway(scene) {
  const group = new THREE.Group();
  group.name = 'Subway';
  const colliders = [];
  let piers = 0;
  for (const V of VIADUCTS) piers += buildViaduct(V, group, colliders).supports;
  // the open cuts in the west end
  const cutMats = {
    cutConcrete: createCutWallMaterial(),
    ballast: window.CITY.createBallastMaterial ? window.CITY.createBallastMaterial() : createBedMaterial(),
    rails: new THREE.MeshStandardNodeMaterial({ color: 0x8e8a84, roughness: 0.35, metalness: 0.85 }),
    lining: new THREE.MeshBasicNodeMaterial({ color: 0x0e0f10 }),
    dark: new THREE.MeshBasicNodeMaterial({ color: 0x000000 }),
    chainLink: createChainLinkMaterial(),
    fenceSteel: new THREE.MeshStandardNodeMaterial({ color: 0x7d8387, roughness: 0.4, metalness: 0.8 })
  };
  const cutStats = SUBWAY_CUTS.map((C) => buildCut(C, group, colliders, cutMats));
  // the covered bridge over the Rosedale Valley
  const coveredMats = { coveredConcrete: createConcreteMaterial(0xa9a295), mound: window.CITY.createEmbankmentGrassMaterial ? window.CITY.createEmbankmentGrassMaterial() : new THREE.MeshStandardNodeMaterial({ color: 0x44552c, roughness: 0.95 }) };
  const coveredStats = COVERED.map((V) => buildCovered(V, group, colliders, coveredMats));
  const ent = buildEntrances(group, colliders);
  scene.add(group);

  // The trains: over the viaduct, through the cuts, and laid up in Vincent Yard
  const routes = [...VIADUCTS.flatMap(viaductRoutes), ...SUBWAY_CUTS.flatMap((C, k) => cutRoutes(C, k))];
  const parked = SUBWAY_CUTS.map((C) => ({ C, mid: C.world(C.len / 2, 0), trains: parkedTrains(C) })).filter((p) => p.trains.length);
  const nParked = parked.reduce((t, p) => t + p.trains.length, 0);
  const k = QUALITY.subway ?? 1;
  const headway = HEADWAY / Math.max(0.1, k);
  const cabs = new THREE.InstancedMesh(carGeometry(true), createCarMaterial(true), Math.max(1, routes.length * 4 + nParked * 2));
  const mids = new THREE.InstancedMesh(carGeometry(false), createCarMaterial(false), Math.max(1, routes.length * 8 + nParked * (CARS - 2)));
  for (const m of [cabs, mids]) {
    m.name = 'SubwayTrains';
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.count = 0;
    group.add(m);
  }
  const dummy = new THREE.Object3D();
  const tmpA = { x: 0, z: 0 }, tmpB = { x: 0, z: 0 };
  const sounding = []; // the trains in the open, for the audio (streetcar-like voices)
  const trains = routes.map(() => [0, 1].map(() => ({ speed: SPEED, y: 0, sections: Array.from({ length: CARS }, () => ({ x: 0, z: 0, yaw: 0 })) })));
  let shift = 0, last = 0, held = null;
  // (for screenshots: route `ri`'s train with its middle `frac` of the way along its open stretch (over the viaduct,
  // or between a cut's portals), held there if `hold`)
  const placeTrain = (ri, frac, hold = true) => {
    const r = routes[ri], cycle = headway * SPEED;
    const o0 = r.open0 ?? EXT, o1 = r.open1 ?? r.len - EXT;
    const target = o0 + frac * (o1 - o0) + TRAIN_LEN / 2;
    shift = ((((target - (last * SPEED + r.phase * cycle)) / SPEED) % headway) + headway) % headway;
    held = hold ? last + shift : null;
  };
  const api = { group, colliders, cars: sounding, update, routes, entrances: ent, placeTrain, cuts: SUBWAY_CUTS };

  function update(time, camera) {
    last = time;
    const elapsed = held ?? time + shift;
    let nc = 0, nm = 0;
    sounding.length = 0;
    const camX = camera ? camera.position.x : 0, camZ = camera ? camera.position.z : 0;
    // the yard's laid-up trains, when near
    for (const p of parked) {
      if (Math.hypot(p.mid.x - camX, p.mid.z - camZ) > 2500) continue;
      for (const cars of p.trains) {
        for (const c of cars) {
          dummy.position.set(c.x, CUT_RAIL, c.z);
          dummy.rotation.set(0, c.yaw, 0);
          dummy.updateMatrix();
          if (c.cab) cabs.setMatrixAt(nc++, dummy.matrix);
          else mids.setMatrixAt(nm++, dummy.matrix);
        }
      }
    }
    routes.forEach((r, ri) => {
      // far away: nothing to draw
      if (Math.hypot(r.pts[r.pts.length >> 1].x - camX, r.pts[r.pts.length >> 1].z - camZ) > 3000) return;
      const cycle = headway * SPEED;
      // up to two trains on a route at once (a cycle shorter than the route)
      for (let j = 0; j < 2; j++) {
        const head = ((elapsed * SPEED + r.phase * cycle) % cycle) + j * cycle;
        if (head - TRAIN_LEN > r.len || head < 0) continue;
        if (head - TRAIN_LEN > r.show1 || head < r.show0) continue; // wholly in a tunnel
        const t = trains[ri][j];
        t.y = r.y;
        let shown = false;
        for (let i = 0; i < CARS; i++) {
          const front = head - i * (CAR_LEN + CAR_GAP), back = front - CAR_LEN;
          sample(r, front, tmpA);
          sample(r, back, tmpB);
          const sec = t.sections[i];
          sec.x = (tmpA.x + tmpB.x) / 2;
          sec.z = (tmpA.z + tmpB.z) / 2;
          sec.yaw = Math.atan2(tmpA.x - tmpB.x, tmpA.z - tmpB.z);
          if (front < r.show0 || back > r.show1) continue;
          shown = true;
          const cab = i === 0 || i === CARS - 1;
          dummy.position.set(sec.x, r.y, sec.z);
          dummy.rotation.set(0, sec.yaw + (i === CARS - 1 ? Math.PI : 0), 0);
          dummy.updateMatrix();
          if (cab) cabs.setMatrixAt(nc++, dummy.matrix);
          else mids.setMatrixAt(nm++, dummy.matrix);
        }
        if (shown) sounding.push(t);
      }
    });
    cabs.count = nc;
    mids.count = nm;
    for (const m of [cabs, mids]) {
      if (!m.count) continue;
      m.instanceMatrix.clearUpdateRanges();
      m.instanceMatrix.addUpdateRange(0, m.count * 16);
      m.instanceMatrix.needsUpdate = true;
    }
  }

  const cutInfo = SUBWAY_CUTS.map((C, i) => `${C.groups.map((G) => `${Math.round(G.t1 - G.t0)} m`).join(' + ')} at x ${Math.round(C.world(C.len / 2, 0).x)} (${cutStats[i].portals} portals, decks: ${cutStats[i].decks.join(', ') || 'none'})`).join('; ');
  console.info(`[subway] ${VIADUCTS.length} viaduct (${VIADUCTS.map((V) => `${Math.round(V.len)} m, lower deck at ${Math.round(V.railY * 10) / 10} m, ${piers} piers`).join('; ')}), ${SUBWAY_CUTS.length} open cuts (${cutInfo}), ${COVERED.length} covered bridge (${COVERED.map((V, i) => `${Math.round(V.len)} m, ${coveredStats[i].piers} piers`).join('; ')}), ${nParked} trains laid up, ${routes.length} train routes; ${ent.stairs} stair entrances & ${ent.signs} pylons alone at ${new Set(ent.sites.map((s) => s.name)).size} stations (${ent.skipped} left out)`);
  return api;
}

Object.assign(window.CITY, { createSubway, subwayKeepsClear, subwayCutAt, SUBWAY_VIADUCTS: VIADUCTS, SUBWAY_CUTS, SUBWAY_CUT_RECTS, SUBWAY_COVERED: COVERED });
})();
