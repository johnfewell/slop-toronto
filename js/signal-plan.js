(function () {
// js/signal-plan.js
// Toronto's traffic signals as one coordinated system, read by everything that shows or obeys a light: the traffic &
// buses (traffic.js), the signal heads and red / green men (street-details.js), the streetcars (streetcars.js), the
// crossing beeps (audio-sources.js) and the Tour Drive (tour-guide.js).
//
// - One common cycle (SIGNAL_TIMING.cycle) everywhere, so neighbouring lights keep a fixed relation. Each signalised
//   junction (city-config.js SIGNAL_JUNCTIONS) runs two phases (its coordinated road, then the crossing road), or
//   three where a third road comes in at an angle of its own; each phase is green, amber, then all-red.
// - Green waves: every named road with signals is a corridor. Each junction belongs to the road of the highest class
//   through it (OpenStreetMap rank: primary over secondary over tertiary), on a tie the road with more signals along
//   it (the longer progression), then the wider. Along its corridor a junction's offset is the distance from the
//   corridor's start over the progression speed (V_PROG, the speed the city's cars cruise at, ~41 km/h), modulo the
//   cycle. Two-way corridors also carry a band the other way where the spacing allows: a search over the two bands'
//   relative timing (and which way the main band runs) keeps as many junctions inside both as it can, and where the
//   other band can't fit the main one wins. The search also times a corridor's band through the junctions it crosses
//   but doesn't own, to arrive in their cross-road green.
// - Near the player (traffic.js nearSignals, the area the traffic runs in) the lights are actuated: a green ends early
//   once its approaches are empty and another road waits (after its minimum green; never while people are still on the
//   crosswalks it serves), rests or extends while nobody waits across, a side phase nobody calls is skipped, and every
//   change still runs through amber and all-red. Away from the player a light eases back onto its coordinated timing (it dwells in the main road's green
//   when early, cuts the cross road's green short, never under its minimum, when late) and then costs nothing.
//
// - Each junction's timing is its own (timeJunction): the City's mode of control (fixed time lights never actuate;
//   semi-actuated ones without vehicle extensions skip an uncalled side phase but never cut or stretch one; the others
//   gap out & extend), the City's pedestrian timing (a WALK of at least 7 s, then the flashing don't walk sized for the
//   whole crossing at the walking speed the City times it for, 1.2 m/s at most junctions; a leading pedestrian interval
//   of 5 s on the crosswalks that have one: their WALK starts before the parallel traffic's green), and the green
//   split between the roads by the busier lane of each (the City's counts, js/toronto-traffic-data.js), never under
//   what its pedestrians need. The cycle stays common (the City's own cycle lengths aren't published: see
//   tools/build-traffic-data.mjs), so the green waves hold.
// - Midblock pedestrian signals (SIGNAL_CROSSINGS) are lights too, after the junctions in every array (index
//   SIGNALS.crossingIndex(i)): phase 0 the road's green, phase 1 the people's WALK and clearance, which near the player
//   only runs when someone waits to cross.
//
// Every reader asks with (junction, phase, time): the light's local time is (time - shift[j]) mod cycle. shift[j] is
// the junction's offset unless the actuated controller holds or skips its clock (stepSignals). The signal-head shader
// reads the same shifts (SIGNALS.shifts, a uniform array) so the heads stay in step with the traffic.

const { GEO, SIGNAL_JUNCTIONS, SIGNAL_CROSSINGS } = window.CITY;

// Seconds. The cycle is common to every light; each phase's green window within it ([start, end)), then amber
// (`amber` s) and all-red (`allRed` s) before the next phase's green. Pedestrians step off on the WALK, the first
// `walk` seconds of the green of the traffic parallel to them.
const SIGNAL_TIMING = {
  cycle: 70, amber: 3.5, allRed: 1.5, walk: 7, lpi: 5,
  layouts: {
    2: [[0, 34], [39, 65]], // (without the City's data) the coordinated road 34 s, the crossing road 26 s
    3: [[0, 30], [35, 47], [52, 65]] // a third road at its own angle: 30 / 12 / 13 s
  },
  minGreen: [12, 10, 10], // a light never ends a vehicle green sooner
  maxGreen: [Infinity, 40, 30], // nor holds a waiting cross road beyond (the coordinated road rests while nobody waits)
  maxDwell: 15 // s per cycle a light near the player may hold the coordinated green to win back its offset
};
const CYCLE = SIGNAL_TIMING.cycle, AMBER = SIGNAL_TIMING.amber, WALK = SIGNAL_TIMING.walk;
const CLEAR = SIGNAL_TIMING.amber + SIGNAL_TIMING.allRed;
// the City's modes of control (js/toronto-traffic-data.js modes): how a light near the player answers demand
const MODE = { fixed: 0, sap: 1, sa1: 2, sa2: 3, sav: 4, fa: 5, mps: 6, ips: 7 };
const TD = window.CITY.TRAFFIC_DATA;
const SCRAMBLES = new Set(['YONGE ST / DUNDAS ST']); // (the City's signal names, js/toronto-traffic-data.js)
const V_PROG = 11.5; // m/s, the progression speed: traffic.js cars cruise at 10-13.6 m/s
const BAND = 10; // s of green a passing band keeps clear (a platoon's length)
const LEAD = 2; // s a corridor's green starts before its band arrives (the queue moves off first)
const PHASE_SPLIT = Math.cos(30 * Math.PI / 180); // arms within 30 degrees of a phase's axis run with it

const mod = (t, m) => ((t % m) + m) % m;
const baseName = (n) => (n || '').replace(/ (West|East|North|South)$/, '');
const hash = (x, z) => {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

// ---------------------------------------------------------------------------------------------------------------------
// 1. Each junction's arms (from the street graph, like street-details.js): their road, direction, class & width
// ---------------------------------------------------------------------------------------------------------------------
const RG = GEO.roadGraph;
const nodeLinks = new Map();
RG.links.forEach((l) => {
  for (const n of [l[0], l[1]]) (nodeLinks.get(n) || nodeLinks.set(n, []).get(n)).push(l);
});
const nodeAt = new Map();
for (let i = 0; i < RG.nodes.length / 2; i++) nodeAt.set(`${RG.nodes[2 * i]},${RG.nodes[2 * i + 1]}`, i);
const linksOf = new Map(RG.links.map((l, i) => [l, i]));

const J = SIGNAL_JUNCTIONS.map((sj, index) => {
  const arms = [];
  const inJunction = new Set(sj.pts.map((p) => `${p.x},${p.z}`));
  for (const p of sj.pts) {
    const n = nodeAt.get(`${p.x},${p.z}`);
    if (n === undefined) continue;
    for (const l of nodeLinks.get(n) || []) {
      const [a, b, ni, w, lanes, dir, inner, rank] = l;
      const atA = a === n;
      const far = atA ? b : a;
      if (inJunction.has(`${RG.nodes[2 * far]},${RG.nodes[2 * far + 1]}`)) continue; // between a dual road's carriageways
      const other = atA ? (inner.length ? [inner[0], inner[1]] : [RG.nodes[2 * b], RG.nodes[2 * b + 1]])
        : (inner.length ? [inner[inner.length - 2], inner[inner.length - 1]] : [RG.nodes[2 * a], RG.nodes[2 * a + 1]]);
      const ux = other[0] - p.x, uz = other[1] - p.z;
      const L = Math.hypot(ux, uz) || 1;
      const name = RG.names[ni] || '';
      // (its link's daily volume & lanes the way into the junction, for the split; 0 if it only leads away)
      const li = linksOf.get(l);
      const into = dir === 0 ? 0.5 : (dir > 0) === !atA ? 1 : 0;
      const vol = TD ? TD.linkVolume[li] * into : 0;
      const inLanes = dir === 0 ? Math.max(1, Math.floor(lanes / 2)) : Math.max(1, lanes);
      arms.push({ ux: ux / L, uz: uz / L, w, lanes, rank: rank || 0, road: name ? baseName(name) : `#${index}:${arms.length}`, named: !!name, li, perLane: vol / inLanes });
    }
  }
  return { index, x: sj.x, z: sj.z, arms, road: null, axes: null, phases: 2, offset: 0, mode: sj.mode ?? MODE.sa1, px: sj.px, name: sj.name, lpiBits: sj.lpi || 0, fdwAt: sj.fdwAt || 1.2, ped8: sj.ped8 || 0 };
});
const NJ = J.length;

// Corridors: every named road with a signal, the junctions it passes through (sorted along it later)
const corridors = new Map();
for (const j of J) {
  const seen = new Set();
  for (const a of j.arms) {
    if (!a.named || seen.has(a.road)) continue;
    seen.add(a.road);
    if (!corridors.has(a.road)) corridors.set(a.road, { name: a.road, junctions: [], rank: 0, width: 0 });
    const c = corridors.get(a.road);
    c.junctions.push(j);
    c.rank = Math.max(c.rank, a.rank);
    c.width = Math.max(c.width, a.w);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. The coordinated road at each junction and its phases: arms grouped by direction (within 30 degrees), the
//    coordinated road's group first; a third group of its own where a road comes in at another angle
// ---------------------------------------------------------------------------------------------------------------------
for (const j of J) {
  if (!j.arms.length) {
    j.axes = [[1, 0], [0, 1]];
    continue;
  }
  // the road of the highest class here; a road passing through over one ending here; then more signals, then wider
  const roads = new Map();
  for (const a of j.arms) {
    const r = roads.get(a.road) || { road: a.road, rank: 0, arms: 0, w: 0, named: a.named };
    r.rank = Math.max(r.rank, a.rank);
    r.arms++;
    r.w = Math.max(r.w, a.w);
    roads.set(a.road, r);
  }
  const key = (r) => [r.rank, Math.min(r.arms, 2), r.named ? corridors.get(r.road).junctions.length : 0, r.w];
  const better = (p, q) => {
    const a = key(p), b = key(q);
    for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] > b[k];
    return p.road < q.road;
  };
  let lead = null;
  for (const r of roads.values()) if (!lead || better(r, lead)) lead = r;
  j.road = lead.road;
  // its axis: the mean of its arms' directions (folded onto one half-turn)
  let ax = 0, az = 0;
  for (const a of j.arms) {
    if (a.road !== lead.road) continue;
    const s = ax * a.ux + az * a.uz < 0 ? -1 : 1;
    ax += a.ux * s;
    az += a.uz * s;
  }
  const L = Math.hypot(ax, az) || 1;
  const axes = [[ax / L, az / L]];
  // the other arms, most important first, join the nearest axis within 30 degrees or found their own
  const rest = j.arms.filter((a) => a.road !== lead.road).sort((p, q) => q.rank - p.rank || q.w - p.w);
  // (an unnamed arm, a slip lane or a ramp, runs with the nearest phase: it never takes time of its own)
  for (const a of rest) {
    if (!a.named || axes.some(([x, z]) => Math.abs(x * a.ux + z * a.uz) > PHASE_SPLIT)) continue;
    if (axes.length < 3) axes.push([a.ux, a.uz]);
  }
  // two phases: the crossing phase's axis square to the coordinated road unless a crossing arm says otherwise
  if (axes.length === 1) axes.push([-axes[0][1], axes[0][0]]);
  j.axes = axes;
  j.phases = axes.length;
  // Toronto's pedestrian scramble: after the roads' greens, a phase for the people alone, every crosswalk at once (and
  // nobody walks beside the traffic). Yonge & Dundas since 2008.
  if (SCRAMBLES.has(j.name)) {
    j.scramble = true;
    j.phases++;
  }
}

// Which phase does traffic moving along (or against) direction (ux, uz) at junction j run in?
function phaseForDir(j, ux, uz) {
  const axes = (j < NJ ? J[j] : CROSSINGS[j - NJ]).axes;
  let best = 0, bd = -1;
  for (let p = 0; p < axes.length; p++) {
    const d = Math.abs(axes[p][0] * ux + axes[p][1] * uz);
    if (d > bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}
// ---------------------------------------------------------------------------------------------------------------------
// 2b. Each light's own timing within the common cycle (see the top): its phase windows, each from the WALK (a leading
//     pedestrian interval before the traffic's green where the City has one) to the end of the traffic's green, the
//     flashing don't walk at the end of it; the midblock pedestrian signals after the junctions
// ---------------------------------------------------------------------------------------------------------------------
const CROSSINGS = SIGNAL_CROSSINGS.map((c, i) => {
  const L = Math.hypot(c.ux || 0, c.uz || 0);
  const across = L ? [c.ux / L, c.uz / L] : [0, 1];
  return { index: NJ + i, crossing: i, x: c.x, z: c.z, arms: [], axes: [[-across[1], across[0]], across], phases: 2, offset: 0, mode: c.mode ?? MODE.mps, px: c.px, name: c.name, len: c.len || 0, fdwAt: c.fdwAt || 1.2, ped8: c.ped8 || 0 };
});
const ALL = J.concat(CROSSINGS); // every light, by index
const crosswalksOf = new Map(); // px -> the City's crosswalks there [cx, cz, ux, uz, length, type, px]
if (TD) for (const c of TD.crosswalks) if (c[6]) (crosswalksOf.get(c[6]) || crosswalksOf.set(c[6], []).get(c[6])).push(c);
const WIN = [], LPI = [], FDW = [], MIN = [], MAXG = [];
const timing = { split: 0, pedLimited: 0, fromCity: 0, lpi: 0 };
function timeLight(j) {
  const P = j.phases;
  const lpi = new Array(P).fill(0), fdw = new Array(P).fill(0), need = new Array(P).fill(0), demand = new Array(P).fill(0);
  const peds = j.mode !== MODE.sav; // (semi-actuated without push buttons: no pedestrian heads)
  if (j.crossing !== undefined) {
    // a midblock signal: the road's green, then the people's WALK & clearance across it
    const len = j.len || 14;
    fdw[1] = len / j.fdwAt;
    need[1] = WALK + fdw[1];
    need[0] = CYCLE - 2 * CLEAR - need[1];
  } else {
    // the length each phase's pedestrians cross: the City's crosswalks here (people walk alongside the phase their
    // crosswalk runs along), else the widest road of the other phases
    const cross = new Array(P).fill(0);
    const mine = crosswalksOf.get(j.px) || [];
    for (const c of mine) {
      const p = phaseForDir(j.index, c[2], c[3]);
      cross[p] = Math.max(cross[p], c[4]);
    }
    if (mine.length) timing.fromCity++;
    for (const a of j.arms) {
      const pa = phaseForDir(j.index, a.ux, a.uz);
      for (let p = 0; p < P; p++) if (p !== pa && !mine.length) cross[p] = Math.max(cross[p], a.w);
      demand[pa] = Math.max(demand[pa], a.perLane || 0);
    }
    // leading pedestrian intervals: the north & south crosswalks' people walk with the east-west road, the east &
    // west ones' with the north-south road (grid directions: north is -z)
    if (j.lpiBits & 3) lpi[phaseForDir(j.index, 1, 0)] = SIGNAL_TIMING.lpi;
    if (j.lpiBits & 12) lpi[phaseForDir(j.index, 0, 1)] = SIGNAL_TIMING.lpi;
    if (lpi.some((v) => v)) timing.lpi++;
    for (let p = 0; p < P; p++) {
      fdw[p] = peds && cross[p] ? cross[p] / j.fdwAt : 0;
      need[p] = lpi[p] + Math.max(SIGNAL_TIMING.minGreen[p], peds && cross[p] ? WALK + fdw[p] - lpi[p] : 0); // (the head start, then a whole minimum green)
    }
    if (j.scramble) {
      // the people's own phase, timed for the longest crosswalk (nobody walks the diagonal here); the roads' greens
      // their vehicles' alone
      const S = P - 1;
      for (let p = 0; p < S; p++) { lpi[p] = 0; fdw[p] = 0; need[p] = SIGNAL_TIMING.minGreen[p]; }
      fdw[S] = Math.max(...cross.slice(0, S)) / j.fdwAt;
      need[S] = WALK + fdw[S];
      demand[S] = 0;
    }
  }
  // the green time to share: what's left after every phase has what it needs, by each phase's busiest lane (the
  // coordinated road first among equals: its band)
  const avail = CYCLE - P * CLEAR;
  let sum = need.reduce((a, b) => a + b, 0);
  if (sum > avail) {
    // (more than the cycle: what the pedestrians need beyond the vehicles' minimum greens squeezed alike)
    timing.pedLimited++;
    const base = need.map((n, p) => Math.min(n, lpi[p] + SIGNAL_TIMING.minGreen[p])); // (the head start & a whole minimum green)
    const extra = sum - base.reduce((a, b) => a + b, 0);
    const k = Math.max(0, (avail - base.reduce((a, b) => a + b, 0)) / (extra || 1));
    for (let p = 0; p < P; p++) need[p] = base[p] + (need[p] - base[p]) * k;
    sum = avail;
  }
  const g = need.slice();
  if (j.crossing === undefined) {
    const w = demand.map((d, p) => (j.scramble && p === P - 1 ? 0 : Math.max(d, 30) * (p === 0 ? 1.15 : 1)));
    const W = w.reduce((a, b) => a + b, 0);
    // (what Webster's split gives each, as far as the minimums allow)
    let rest = avail - sum;
    for (let pass = 0; pass < 3 && rest > 0.01; pass++) {
      const want = w.map((v) => (avail * v) / W);
      let short = 0;
      for (let p = 0; p < P; p++) short += Math.max(0, want[p] - g[p]);
      if (!short) break;
      const k = Math.min(1, rest / short);
      for (let p = 0; p < P; p++) {
        const add = Math.max(0, want[p] - g[p]) * k;
        g[p] += add;
        rest -= add;
      }
    }
    // (anything left: the coordinated road)
    if (rest > 0.01) g[0] += rest;
    if (TD) timing.split++;
  } else g[0] = avail - g[1];
  const W = [];
  let t = 0;
  for (let p = 0; p < P; p++) {
    const gp = Math.round(g[p] * 10) / 10;
    W.push([t, Math.min(t + gp, CYCLE - CLEAR)]);
    t += gp + CLEAR;
  }
  WIN[j.index] = W;
  LPI[j.index] = lpi;
  // (a squeezed phase keeps 40% of its time, up to the 7 s, for the WALK)
  FDW[j.index] = fdw.map((f, p) => {
    const span = W[p][1] - W[p][0] - lpi[p];
    return f ? Math.max(0, Math.min(f, span - Math.min(WALK, span * 0.4))) : 0;
  });
  // the shortest a light near the player may cut a green to: the vehicles' minimum, or the head start & the WALK
  MIN[j.index] = W.map((w, p) => Math.min(w[1] - w[0], lpi[p] + Math.max(j.crossing !== undefined && p === 0 ? 12 : SIGNAL_TIMING.minGreen[p], FDW[j.index][p] ? WALK : 0)));
  MAXG[j.index] = SIGNAL_TIMING.maxGreen.slice(0, P).map((m, p) => Math.max(m, W[p][1] - W[p][0]));
}
if (TD) for (const j of ALL) timeLight(j);
else {
  for (const j of ALL) {
    WIN[j.index] = SIGNAL_TIMING.layouts[j.phases];
    LPI[j.index] = new Array(j.phases).fill(0);
    FDW[j.index] = new Array(j.phases).fill(0);
    MIN[j.index] = SIGNAL_TIMING.minGreen.slice(0, j.phases);
    MAXG[j.index] = SIGNAL_TIMING.maxGreen.slice(0, j.phases);
  }
}
// the traffic's green of phase p (after its pedestrians' head start)
const greenOf = (k, p) => [WIN[k][p][0] + LPI[k][p], WIN[k][p][1]];

// ---------------------------------------------------------------------------------------------------------------------
// 3. Offsets: green waves along the corridors, the highest-class corridors first
// ---------------------------------------------------------------------------------------------------------------------
const linksByRoad = new Map();
for (const l of RG.links) {
  const r = baseName(RG.names[l[2]]);
  (linksByRoad.get(r) || linksByRoad.set(r, []).get(r)).push(l);
}
const windowOf = (j, p) => greenOf(j, p);
const assigned = new Uint8Array(J.length);
// does a band arriving at time a get through junction k's phase p green (with BAND s to spare)?
const inGreen = (a, k, p) => {
  const [gs, ge] = windowOf(k, p);
  return mod(a - J[k].offset - gs, CYCLE) <= ge - gs - BAND;
};
// (tools/build-signal-plan.mjs refines these offsets with a delay search over every corridor, both ways, and stores
// them in js/toronto-signal-plan.js; this is the fallback for junctions that table doesn't have)
// the corridors' axes, junctions along them & band timings: { ux, uz, mx, mz, along: [{ u, d }], s, phi, beta, oneWay }
const corridorInfo = new Map();
function planCorridors() {
  const corridorList = [...corridors.values()].filter((c) => c.junctions.some((j) => j.road === c.name));
  corridorList.sort((p, q) => q.rank - p.rank || q.junctions.length - p.junctions.length || q.width - p.width || (p.name < q.name ? -1 : 1));
  for (const c of corridorList) {
    // along the corridor: its junctions in order of their position on its principal axis, distance summed junction to
    // junction (so a bending street still counts its real length)
    const js = c.junctions;
    let mx = 0, mz = 0;
    for (const j of js) {
      mx += j.x / js.length;
      mz += j.z / js.length;
    }
    let sxx = 0, sxz = 0, szz = 0;
    for (const j of js) {
      sxx += (j.x - mx) ** 2;
      sxz += (j.x - mx) * (j.z - mz);
      szz += (j.z - mz) ** 2;
    }
    const th = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    let ux = Math.cos(th), uz = Math.sin(th);
    if (ux < -1e-6 || (Math.abs(ux) <= 1e-6 && uz < 0)) { ux = -ux; uz = -uz; } // east (+x) or south (+z) forward
    const along = js.map((j) => ({ j, u: (j.x - mx) * ux + (j.z - mz) * uz })).sort((a, b) => a.u - b.u);
    let d = 0;
    along.forEach((p, i) => {
      if (i) d += Math.hypot(p.j.x - along[i - 1].j.x, p.j.z - along[i - 1].j.z);
      p.d = d;
    });
    // one-way? (most of its links one way, all the same way along the corridor)
    let fwd = 0, back = 0, two = 0;
    for (const l of linksByRoad.get(c.name) || []) {
      if (l[5] === 0) { two++; continue; }
      const ax = RG.nodes[2 * l[0]], az = RG.nodes[2 * l[0] + 1], bx = RG.nodes[2 * l[1]], bz = RG.nodes[2 * l[1] + 1];
      const s = ((bx - ax) * ux + (bz - az) * uz) * l[5];
      if (s > 0) fwd++;
      else back++;
    }
    const oneWay = fwd + back > 2 * two && Math.min(fwd, back) < 0.15 * (fwd + back) ? (fwd >= back ? 1 : -1) : 0;
    const owned = along.filter((p) => p.j.road === c.name && !assigned[p.j.index]);
    const foreign = along.filter((p) => p.j.road !== c.name && assigned[p.j.index]).map((p) => ({ ...p, ph: phaseForDir(p.j.index, ux, uz) }));
    // the search: main band direction s, its timing phi (only matters against junctions already timed), the other band's
    // timing beta (two-way corridors): most junctions carrying both bands, and the most foreign ones passed
    let best = null;
    for (const s of oneWay ? [oneWay] : [1, -1]) {
      for (let phi = 0; phi < CYCLE; phi += foreign.length ? 2 : CYCLE) {
        for (let beta = 0; beta < CYCLE; beta += oneWay ? CYCLE : 2) {
          let score = 0;
          for (const p of owned) {
            const g = windowOf(p.j.index, 0)[1] - BAND;
            const delta = mod((beta - s * p.d / V_PROG) - (phi + s * p.d / V_PROG), CYCLE);
            if (!oneWay && Math.min(delta, CYCLE - delta) <= g) score += 1;
          }
          for (const p of foreign) {
            if (inGreen(phi + s * p.d / V_PROG, p.j.index, p.ph)) score += 1.2;
            if (!oneWay && inGreen(beta - s * p.d / V_PROG, p.j.index, p.ph)) score += 1;
          }
          // (ties: eastbound / southbound main band, the earliest timings)
          if (!best || score > best.score + 1e-9) best = { score, s, phi, beta };
        }
      }
    }
    const { s, phi, beta } = best;
    for (const p of owned) {
      const j = p.j;
      const g = windowOf(j.index, 0)[1] - BAND;
      const af = phi + s * p.d / V_PROG;
      const ab = beta - s * p.d / V_PROG;
      const delta = mod(ab - af, CYCLE);
      let o = af - LEAD;
      if (!oneWay && delta <= g) o = af - (g - delta) / 2; // both bands: centred in the green
      else if (!oneWay && CYCLE - delta <= g) o = ab - (g - (CYCLE - delta)) / 2;
      j.offset = mod(o, CYCLE);
      assigned[j.index] = 1;
    }
    corridorInfo.set(c.name, { ux, uz, mx, mz, along: along.map((p) => ({ u: p.u, d: p.d })), s, phi, beta, oneWay, both: best.score });
}
// junctions no corridor owns (an unnamed road's): their own timing, so not the whole city switches as one
for (const j of J) if (!assigned[j.index]) j.offset = mod(hash(j.x, j.z) * CYCLE, CYCLE);
return corridorList;
}

// Mid-block pedestrian crossings: timed like a junction of the road they cross (its green while its bands pass, the
// WALK between them); their road found from the street graph
const crossingShift = new Float32Array(SIGNAL_CROSSINGS.length);
function planCrossings() {
    const cells = new Map();
    RG.links.forEach((l, li) => {
      const pts = [RG.nodes[2 * l[0]], RG.nodes[2 * l[0] + 1], ...l[6], RG.nodes[2 * l[1]], RG.nodes[2 * l[1] + 1]];
      for (let k = 0; k + 2 < pts.length; k += 2) {
        const key = Math.floor((pts[k] + pts[k + 2]) / 2 / 50) * 100000 + Math.floor((pts[k + 1] + pts[k + 3]) / 2 / 50);
        (cells.get(key) || cells.set(key, []).get(key)).push([pts[k], pts[k + 1], pts[k + 2], pts[k + 3], li]);
      }
    });
    SIGNAL_CROSSINGS.forEach((c, i) => {
      let best = null, bd = 25;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        for (const [x0, z0, x1, z1, li] of cells.get((Math.floor(c.x / 50) + a) * 100000 + Math.floor(c.z / 50) + b) || []) {
          const ex = x1 - x0, ez = z1 - z0;
          const t = Math.max(0, Math.min(1, ((c.x - x0) * ex + (c.z - z0) * ez) / (ex * ex + ez * ez || 1)));
          const dd = Math.hypot(x0 + ex * t - c.x, z0 + ez * t - c.z);
          if (dd < bd) { bd = dd; best = li; }
        }
      }
      const info = best !== null && corridorInfo.get(baseName(RG.names[RG.links[best][2]]));
      if (!info) {
        crossingShift[i] = mod(hash(c.x, c.z) * CYCLE, CYCLE);
        return;
      }
      // distance along the corridor: interpolated between the junctions either side
      const u = (c.x - info.mx) * info.ux + (c.z - info.mz) * info.uz;
      const A = info.along;
      const last = A[A.length - 1];
      let d = u <= A[0].u ? A[0].d + (u - A[0].u) : last.d + (u - last.u);
      for (let k = 0; k + 1 < A.length; k++) {
        if (u >= A[k].u && u <= A[k + 1].u) d = A[k].d + (A[k + 1].d - A[k].d) * (u - A[k].u) / Math.max(1e-6, A[k + 1].u - A[k].u);
      }
      crossingShift[i] = mod(info.phi + info.s * d / V_PROG - LEAD, CYCLE);
    });
}


// The offsets: from the precomputed table where it has every junction & crossing, else planned here
const keyOf = (x, z) => `${Math.round(x * 10)},${Math.round(z * 10)}`;
const TABLE = window.CITY.SIGNAL_OFFSETS;
let planned = 'table';
if (TABLE && !window.CITY.SIGNAL_PLAN_BUILD && J.every((j) => TABLE.junctions[keyOf(j.x, j.z)] !== undefined) &&
  SIGNAL_CROSSINGS.every((c) => TABLE.crossings[keyOf(c.x, c.z)] !== undefined)) {
  for (const j of J) j.offset = TABLE.junctions[keyOf(j.x, j.z)];
  SIGNAL_CROSSINGS.forEach((c, i) => { crossingShift[i] = TABLE.crossings[keyOf(c.x, c.z)]; });
} else {
  if (TABLE && !window.CITY.SIGNAL_PLAN_BUILD) console.warn('[signals] js/toronto-signal-plan.js is out of date (node tools/build-signal-plan.mjs): planning the offsets here');
  planned = 'here';
  planCorridors();
  planCrossings();
}
CROSSINGS.forEach((c, i) => { c.offset = crossingShift[i]; });

// ---------------------------------------------------------------------------------------------------------------------
// 4. Reading a light (k: a junction's index, or SIGNALS.crossingIndex(i) for midblock signal i)
// ---------------------------------------------------------------------------------------------------------------------
const OFFSETS = ALL.map((j) => j.offset);
const shifts = OFFSETS.slice(); // seconds; read by the signal-head shader too (street-details.js)
const PHASE_WINDOWS = ALL.map((j) => j.phases === undefined ? [] : Array.from({ length: j.phases }, (_, p) => greenOf(j.index, p)));
// per light & phase: [WALK start, flashing don't walk start, its end] (none where nobody walks with it)
const WALK_WINDOWS = ALL.map((j) => WIN[j.index].map((w, p) => {
  const peds = j.crossing !== undefined || j.scramble ? p === j.phases - 1 : j.mode !== MODE.sav;
  return peds ? [w[0], w[1] - FDW[j.index][p], w[1]] : null;
}));
const localTime = (j, time) => mod(time - shifts[j], CYCLE);

// 'green', 'amber' or 'red' for phase p of light j
function signalState(j, p, time) {
  const t = localTime(j, time);
  const w = PHASE_WINDOWS[j][p];
  if (!w) return 'red';
  return t >= w[0] && t < w[1] ? 'green' : t >= w[1] && t < w[1] + AMBER ? 'amber' : 'red';
}
// Do pedestrians walking alongside phase p's traffic have the WALK (they may step off)?
function signalWalk(j, p, time) {
  const w = WALK_WINDOWS[j][p];
  if (!w) return false;
  const t = localTime(j, time);
  return t >= w[0] && t < w[1];
}
// ...and their head: 'walk', 'flash' (the flashing don't walk: finish crossing, don't start) or 'dont'
function pedState(j, p, time) {
  const w = WALK_WINDOWS[j][p];
  if (!w) return 'dont';
  const t = localTime(j, time);
  return t >= w[0] && t < w[1] ? 'walk' : t >= w[1] && t < w[2] ? 'flash' : 'dont';
}
// A midblock crossing's WALK (its people's phase, 1)
const crossingIndex = (i) => NJ + i;
const crossingWalk = (i, time) => signalWalk(NJ + i, 1, time);
const CROSSING_WALK_START = SIGNAL_TIMING.layouts[2][0][1] + AMBER + 1; // (the old shared timing: unused with the City's data)

// ---------------------------------------------------------------------------------------------------------------------
// 5. The actuated controller for the lights near the player: demand comes in as calls (traffic.js detectors, the
//    streetcars, waiting pedestrians) for the next step; `busy` marks a phase whose crosswalks still have people on them
// ---------------------------------------------------------------------------------------------------------------------
const calls = new Uint8Array(ALL.length);
const busy = new Uint8Array(ALL.length);
const callSignal = (j, p) => { calls[j] |= 1 << p; };
const busySignal = (j, p) => { busy[j] |= 1 << p; };
const tracked = new Map(); // j -> { tau, actuated, dwell }
const stats = { tracked: 0, actuated: 0, gapOuts: 0, holds: 0, skips: 0 };
const wrap = (d) => {
  const m = mod(d, CYCLE);
  return m > CYCLE / 2 ? m - CYCLE : m;
};
const MODES = ALL.map((j) => j.mode);
// (semi-actuated lights without vehicle extensions, and the midblock pedestrian signals: a phase runs its full length
// or not at all)
const FIXED_LENGTH = MODES.map((m) => m === MODE.sap || m === MODE.mps);

// Advance every tracked light by dt; `near` lists the lights in the player's area (actuated from now on, unless the
// City runs them on fixed time). A phase runs from its WALK (WIN) to the end of its traffic's green; it rests or holds
// in the WALK (before the flashing don't walk), and once that has started it runs to the end.
function stepSignals(time, dt, near) {
  for (const j of near) {
    if (MODES[j] === MODE.fixed) continue;
    let s = tracked.get(j);
    if (!s) tracked.set(j, (s = { tau: localTime(j, time - dt), actuated: true, dwell: 0, seen: 0 }));
    s.actuated = true;
    s.seen = time;
  }
  let actuated = 0;
  for (const [j, s] of tracked) {
    if (s.seen !== time) s.actuated = false;
    if (s.actuated) actuated++;
    const W = WIN[j], F = FDW[j];
    const P = W.length;
    const fixedLength = FIXED_LENGTH[j];
    const tauC = mod(time - OFFSETS[j], CYCLE); // where the coordinated timing is
    let tau = s.tau;
    let p = -1;
    for (let k = 0; k < P; k++) if (tau >= W[k][0] && tau < W[k][1]) p = k;
    let next = tau + dt;
    if (p >= 0) {
      const [gs, ge] = W[p];
      const H = ge - F[p]; // the end of the WALK: the flashing don't walk runs from here to the end of the green
      const hold = (F[p] > 0 ? H : ge) - 1e-3;
      const g = tau - gs;
      if (g < dt * 1.5) s.dwell = 0;
      const bit = 1 << p;
      const mine = calls[j] & bit, others = calls[j] & ~bit, crossing = busy[j] & bit;
      const d = wrap(tau - tauC); // > 0: ahead of the coordinated timing
      if (s.actuated && !fixedLength && g >= MIN[j][p] && tau < H && !mine && others && !crossing) {
        next = ge; // gap out: nobody comes, nobody is crossing, someone waits across
        stats.gapOuts++;
      } else if (next >= hold && tau < hold + 2e-3) {
        // at the end of the WALK: rest in the coordinated green while nobody waits across, hold a cross road's green
        // for its traffic while nobody waits on the others (up to its maximum), or dwell to win back the offset
        const rest = s.actuated && !others && (p === 0 || (!fixedLength && mine && g < MAXG[j][p]));
        const dwell = p === 0 && (d > 0.02 || (fixedLength && d < -0.02)) && s.dwell < (s.actuated ? SIGNAL_TIMING.maxDwell : CYCLE);
        if (rest || dwell) {
          next = Math.min(tau, hold);
          if (!rest) s.dwell += dt;
          stats.holds++;
        }
      } else if (p > 0 && !fixedLength && d < -0.02 && g >= MIN[j][p] && !crossing && !(s.actuated && mine && !others)) {
        next = Math.min(ge, tau + dt + Math.min(-d, dt * 4)); // late: the cross road's green runs out sooner
      }
    }
    // near the player a side phase nobody calls is skipped, straight from the clearance before it to the next phase
    // (the coordinated phase always runs)
    if (s.actuated && p < 0) {
      for (let q = 1; q < P; q++) {
        if (!(tau < W[q][0] && next >= W[q][0])) continue;
        const bit = 1 << q;
        if (!(calls[j] & bit) && !(busy[j] & bit) && calls[j] & ~bit) {
          next = q + 1 < P ? W[q + 1][0] : CYCLE;
          stats.skips++;
        }
      }
    }
    s.tau = mod(next, CYCLE);
    shifts[j] = time - s.tau;
    // back on its coordinated timing and away from the player: nothing to do any more
    if (!s.actuated && Math.abs(wrap(s.tau - mod(time - OFFSETS[j], CYCLE))) < 0.05) {
      shifts[j] = OFFSETS[j];
      tracked.delete(j);
    }
  }
  calls.fill(0);
  busy.fill(0);
  stats.tracked = tracked.size;
  stats.actuated = actuated;
}

// ---------------------------------------------------------------------------------------------------------------------
// 6. Safety: no two phases of a light green (or amber) at once, at any moment of the cycle; every change through
//    amber and all-red, and nobody's WALK before the traffic it crosses has cleared. (traffic.js checks, once the road
//    network is built, that crossing roads at every signalised node run in different phases.)
// ---------------------------------------------------------------------------------------------------------------------
function checkLayouts() {
  const problems = [];
  const check = (name, W, G, walks) => {
    for (let k = 0; k < W.length; k++) {
      const end = G[k][1] + AMBER + SIGNAL_TIMING.allRed;
      const next = k + 1 < W.length ? W[k + 1][0] : CYCLE + W[0][0];
      if (end > next + 1e-6) problems.push(`${name}: phase ${k}'s clearance runs into phase ${(k + 1) % W.length}'s WALK or green`);
      if (G[k][1] - G[k][0] < 8 - 1e-6) problems.push(`${name}: phase ${k}'s green is under 8 s`);
      if (G[k][0] < W[k][0] - 1e-6 || G[k][1] > W[k][1] + 1e-6) problems.push(`${name}: phase ${k}'s green outside its window`);
      const w = walks && walks[k];
      if (w && (w[0] < W[k][0] - 1e-6 || w[1] > w[2] + 1e-6 || w[2] > G[k][1] + 1e-6)) problems.push(`${name}: phase ${k}'s WALK outside its window`);
      if (G[k][1] > CYCLE - CLEAR + 1e-6) problems.push(`${name}: phase ${k} runs past the cycle`);
    }
  };
  for (const [n, W] of Object.entries(SIGNAL_TIMING.layouts)) check(`${n}-phase layout`, W, W, null);
  for (const j of ALL) check(`${j.crossing !== undefined ? 'crossing' : 'junction'} ${j.index} (${j.name || ''})`, WIN[j.index], PHASE_WINDOWS[j.index], WALK_WINDOWS[j.index]);
  return problems;
}
{
  const problems = checkLayouts();
  if (problems.length) console.error('[signals]', problems.length, 'problems:', problems.slice(0, 5).join('; '));
}

const SIGNALS = {
  junctions: J,
  crossings: CROSSINGS,
  lights: ALL,
  corridors: corridorInfo,
  plan: { corridors, linksByRoad, baseName, keyOf, planCorridors, planCrossings, layouts: SIGNAL_TIMING.layouts, planned, timing },
  shifts,
  offsets: OFFSETS,
  crossingShift,
  CROSSING_WALK_START,
  phaseForDir,
  windows: (j) => PHASE_WINDOWS[j], // each phase's traffic green [start, end)
  phaseWindows: (j) => WIN[j], // each phase's whole time [its WALK, the end of its green)
  walkWindows: (j) => WALK_WINDOWS[j], // [WALK start, flashing don't walk start, its end] (or null)
  minGreen: (j) => MIN[j], // from the phase's start (its WALK): the head start, then the traffic's minimum green
  lpi: (j) => LPI[j],
  mode: (j) => MODES[j],
  MODE,
  state: signalState,
  walk: signalWalk,
  pedState,
  crossingWalk,
  crossingIndex,
  localTime,
  call: callSignal,
  busy: busySignal,
  step: stepSignals,
  tracked,
  stats,
  checkLayouts,
  V_PROG
};
if (window.CITY.DEBUG_ROADS !== false) {
  const three = J.filter((j) => j.phases === 3).length;
  console.info(`[signals] ${J.length} junctions & ${CROSSINGS.length} midblock signals on a ${CYCLE} s cycle (${three} with three phases), green waves at ${(V_PROG * 3.6).toFixed(0)} km/h (offsets: ${planned === 'table' ? 'js/toronto-signal-plan.js' : 'planned at load'})${TD ? `; the City's timing: ${timing.split} splits by volume, ${timing.fromCity} with the City's crosswalks, ${timing.lpi} with leading pedestrian intervals, ${timing.pedLimited} squeezed` : ''}`);
}

Object.assign(window.CITY, { SIGNALS, SIGNAL_TIMING });
})();
