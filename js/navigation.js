(function () {
// js/navigation.js
// Abuja Tour's guide: place search and turn-by-turn directions on the real street graph.
// - Search: every landmark, district, street and named place (OpenStreetMap: hotels, banks, offices, shops, places of
//   worship...), matched by word prefixes with the usual street abbreviations (St, Rd, Ave, Cres, Blvd...), a typo or
//   two forgiven, and category words ("hotel", "bank", "fuel") answered with the nearest places of that kind.
// - Routes: A* over GEO.roadGraph (the same streets & flyovers the traffic drives), by car (one-way streets obeyed,
//   expected speeds by road class), on foot or by bicycle (any direction, no expressways on foot); turn-by-turn steps
//   named after the streets, with true compass directions.

const { GEO, ROADS, DISTRICTS, CITY_LANDMARKS, districtAt, getLocationLabel, shortName, terrainHeightAt } = window.CITY;

// ---------------------------------------------------------------------------------------------------------------------
// Directions & distances
// ---------------------------------------------------------------------------------------------------------------------
const GRID_BEARING = GEO.frame.bearingDeg; // grid north's true bearing (the CBD's street grid is turned -32.25°)
const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
// true bearing (degrees clockwise from true north) of a world direction (x grid east, z grid south)
function trueBearing(dx, dz) {
  return ((Math.atan2(dx, -dz) * 180) / Math.PI + GRID_BEARING + 720) % 360;
}
const compassWord = (deg) => COMPASS[Math.round(deg / 45) % 8];
function formatDistance(m) {
  if (m < 50) return `${Math.max(5, Math.round(m / 5) * 5)} m`;
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}
function formatDuration(s) {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------------------------------------------------
const ABBREV = {
  st: 'street', str: 'street', rd: 'road', ave: 'avenue', av: 'avenue', cres: 'crescent', cr: 'crescent',
  blvd: 'boulevard', expy: 'expressway', expwy: 'expressway', hwy: 'highway', cl: 'close', dr: 'drive', ln: 'lane',
  wy: 'way', sq: 'square', mt: 'mount', intl: 'international', natl: 'national', govt: 'government', hosp: 'hospital',
  univ: 'university', ctr: 'centre', center: 'centre', tor: 'toronto', to: 'toronto'
};
const normalize = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const words = (s) => normalize(s).split(' ').filter(Boolean).map((w) => ABBREV[w] || w);

const CATEGORY_LABEL = {
  hotel: 'Hotel', bank: 'Bank', food: 'Restaurant & café', worship: 'Place of worship', fuel: 'Filling station',
  health: 'Hospital & health', education: 'School & university', market: 'Market & mall', shop: 'Shop',
  government: 'Government', office: 'Office', leisure: 'Leisure & sights', transport: 'Transport', place: 'Place'
};
// what people type when they want a kind of place
const CATEGORY_WORDS = {
  hotel: ['hotel', 'hotels', 'motel', 'lodge', 'guest', 'stay', 'accommodation', 'apartment', 'apartments'],
  bank: ['bank', 'banks', 'atm', 'money'],
  food: ['restaurant', 'restaurants', 'food', 'eat', 'cafe', 'coffee', 'bar', 'lounge', 'club', 'suya', 'chops'],
  worship: ['mosque', 'church', 'worship', 'cathedral', 'chapel', 'masjid'],
  fuel: ['fuel', 'petrol', 'filling', 'gas', 'station'],
  health: ['hospital', 'hospitals', 'clinic', 'pharmacy', 'health', 'doctor', 'medical', 'chemist'],
  education: ['school', 'schools', 'university', 'college', 'library', 'academy'],
  market: ['market', 'mall', 'supermarket', 'shopping', 'plaza'],
  shop: ['shop', 'shops', 'store', 'boutique'],
  government: ['government', 'ministry', 'embassy', 'commission', 'court', 'police', 'federal'],
  office: ['office', 'offices', 'company'],
  leisure: ['park', 'garden', 'museum', 'gallery', 'sight', 'sights', 'attraction', 'leisure', 'stadium', 'cinema'],
  transport: ['bus', 'park', 'motor', 'terminal', 'transport']
};

let INDEX = null;
function buildIndex() {
  if (INDEX) return INDEX;
  const items = [];
  const seen = new Map();
  const add = (it) => {
    const key = normalize(it.name);
    const prev = seen.get(key);
    if (prev && prev.some((p) => Math.hypot(p.x - it.x, p.z - it.z) < 150)) return;
    (prev || seen.set(key, []).get(key)).push(it);
    it.id = `${it.kind}:${items.length}`;
    it.words = words(it.name);
    it.norm = it.words.join(' ');
    items.push(it);
  };
  for (const l of CITY_LANDMARKS) add({ kind: 'landmark', name: l.name, x: l.x, z: l.z, sub: `Landmark · ${l.district || districtAt(l.x, l.z)}`, landmarkId: l.id });
  const districtNames = new Set();
  for (const d of DISTRICTS) {
    if (districtNames.has(d.name)) continue;
    districtNames.add(d.name);
    add({ kind: 'district', name: d.name, x: d.x, z: d.z, sub: 'Neighbourhood · Toronto' });
  }
  for (const [x, z, name, cat] of GEO.pois || []) {
    add({ kind: 'place', cat, name, x, z, sub: `${CATEGORY_LABEL[cat] || 'Place'} · ${districtAt(x, z)}` });
  }
  for (const b of GEO.buildings) {
    if (b[9]) add({ kind: 'place', cat: b[5] === 6 ? 'worship' : b[5] === 7 ? 'education' : 'place', name: b[9], x: b[0], z: b[1], sub: `Building · ${districtAt(b[0], b[1])}` });
  }
  // streets: one entry per name, at the middle of its longest stretch, with the extent of all its stretches
  const streets = new Map();
  for (const r of ROADS) {
    if (!r.name || /^(unnamed|service)/i.test(r.name)) continue;
    let s = streets.get(r.name);
    if (!s) streets.set(r.name, (s = { name: r.name, len: 0, best: null, bestLen: 0, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, rank: 0 }));
    let L = 0;
    for (let i = 1; i < r.pts.length; i++) L += Math.hypot(r.pts[i].x - r.pts[i - 1].x, r.pts[i].z - r.pts[i - 1].z);
    s.len += L;
    s.rank = Math.max(s.rank, r.rank || 0);
    for (const p of r.pts) {
      s.minX = Math.min(s.minX, p.x); s.maxX = Math.max(s.maxX, p.x);
      s.minZ = Math.min(s.minZ, p.z); s.maxZ = Math.max(s.maxZ, p.z);
    }
    if (!s.best || L > s.bestLen) { s.bestLen = L; s.best = r.pts; }
  }
  for (const s of streets.values()) {
    const mid = s.best[Math.floor(s.best.length / 2)];
    const ds = [...new Set([districtAt(s.best[0].x, s.best[0].z), districtAt(mid.x, mid.z), districtAt(s.best[s.best.length - 1].x, s.best[s.best.length - 1].z)])];
    add({ kind: 'street', name: s.name, x: mid.x, z: mid.z, rank: s.rank, sub: `Street · ${ds.slice(0, 2).join(', ')} · ${formatDistance(s.len)}`,
      bounds: { minX: s.minX, maxX: s.maxX, minZ: s.minZ, maxZ: s.maxZ } });
  }
  INDEX = items;
  return items;
}

// edit distance <= 1 (a typo): substitution, insertion or deletion
function oneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

const KIND_WEIGHT = { landmark: 40, district: 30, street: 12, place: 8 };
/**
 * Places matching `query`, best first: [{ id, kind, name, sub, x, z, cat?, bounds?, distance? }]. `near` (x, z) ranks
 * nearer places a little higher and gives each its distance.
 */
function searchPlaces(query, { near = null, limit = 8 } = {}) {
  const index = buildIndex();
  const q = words(query);
  if (!q.length) return [];
  const last = q[q.length - 1];
  const results = [];
  for (const it of index) {
    let score = 0;
    let ok = true;
    for (let k = 0; k < q.length && ok; k++) {
      const w = q[k];
      const isLast = k === q.length - 1;
      let best = 0;
      for (let i = 0; i < it.words.length; i++) {
        const iw = it.words[i];
        if (iw === w) best = Math.max(best, 10 + (i === k ? 3 : 0));
        else if (isLast && iw.startsWith(w)) best = Math.max(best, 6 + Math.min(4, w.length));
        else if (w.length >= 4 && oneEdit(w, iw)) best = Math.max(best, 4);
        else if (w.length >= 4 && isLast && iw.length > w.length && oneEdit(w, iw.slice(0, w.length))) best = Math.max(best, 3);
      }
      if (!best && w.length >= 3 && it.norm.includes(w)) best = 2;
      if (!best) ok = false;
      score += best;
    }
    if (!ok) continue;
    if (it.norm.startsWith(q.join(' '))) score += 5;
    if (it.norm === q.join(' ')) score += 12;
    score += KIND_WEIGHT[it.kind] * 0.35 + (it.rank || 0) * 1.2;
    score -= Math.max(0, it.words.length - q.length) * 1.5;
    let distance = null;
    if (near) {
      distance = Math.hypot(it.x - near.x, it.z - near.z);
      score -= Math.min(6, distance / 2000);
    }
    results.push({ it, score, distance });
  }
  // a kind of place ("hotel", "bank near me"): the nearest of that kind
  const cats = Object.entries(CATEGORY_WORDS).filter(([, ws]) => ws.includes(last) || (q.length > 1 && q.some((w) => ws.includes(w)))).map(([c]) => c);
  if (cats.length) {
    for (const it of index) {
      if (it.kind !== 'place' || !cats.includes(it.cat)) continue;
      const distance = near ? Math.hypot(it.x - near.x, it.z - near.z) : null;
      const prev = results.find((r) => r.it === it);
      const score = 14 - (distance === null ? 0 : Math.min(10, distance / 800));
      if (prev) prev.score = Math.max(prev.score, score + 4);
      else results.push({ it, score, distance });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit).map(({ it, distance }) => ({ ...it, distance }));
}

// ---------------------------------------------------------------------------------------------------------------------
// The street graph
// ---------------------------------------------------------------------------------------------------------------------
const SPEED_KMH = { 6: 90, 5: 75, 4: 60, 3: 50, 2: 40, 1: 30, 0: 20 };
const MODE_SPEED = { walk: 5 / 3.6, cycle: 16 / 3.6 };
let GRAPH = null;
function buildGraph() {
  if (GRAPH) return GRAPH;
  const RG = GEO.roadGraph;
  const n = RG.nodes.length / 2;
  const nodeH = new Float32Array(n);
  for (let i = 0; i < (RG.raised || []).length; i += 2) nodeH[RG.raised[i]] = RG.raised[i + 1];
  const out = Array.from({ length: n }, () => []);
  const links = RG.links.map((l, id) => {
    const [a, b, nameIdx, w, lanes, dir, inner, rank, innerH] = l;
    const pts = [[RG.nodes[2 * a], RG.nodes[2 * a + 1], nodeH[a]]];
    for (let i = 0; i < inner.length; i += 2) pts.push([inner[i], inner[i + 1], innerH ? innerH[i / 2] : 0]);
    pts.push([RG.nodes[2 * b], RG.nodes[2 * b + 1], nodeH[b]]);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const link = { id, a, b, name: RG.names[nameIdx] || '', w, dir, rank, pts, len };
    out[a].push({ link, to: b, fwd: true });
    out[b].push({ link, to: a, fwd: false });
    return link;
  });
  // nodes in 100 m cells, for snapping
  const cells = new Map();
  for (let i = 0; i < n; i++) {
    if (!out[i].length) continue;
    const k = Math.floor(RG.nodes[2 * i] / 100) * 100000 + Math.floor(RG.nodes[2 * i + 1] / 100);
    (cells.get(k) || cells.set(k, []).get(k)).push(i);
  }
  GRAPH = { RG, n, out, links, cells, nodeH, x: (i) => RG.nodes[2 * i], z: (i) => RG.nodes[2 * i + 1] };
  return GRAPH;
}

// Can this mode use the link in this direction?
function usable(link, fwd, mode, strict) {
  if (mode === 'walk' && link.rank >= 6) return false;
  if (mode === 'car' && strict && link.dir !== 0 && (link.dir > 0) !== fwd) return false;
  return true;
}

// The point on the street graph nearest (x, z): the link, the position along it, the point itself
function snapToGraph(x, z, mode = 'car', maxDist = 600) {
  const G = buildGraph();
  let best = null;
  const seenLinks = new Set();
  for (let r = 1; r <= Math.ceil(maxDist / 100) && !best; r++) {
    const ix = Math.floor(x / 100), iz = Math.floor(z / 100);
    for (let a = -r; a <= r; a++) for (let c = -r; c <= r; c++) {
      for (const node of G.cells.get((ix + a) * 100000 + iz + c) || []) {
        for (const { link } of G.out[node]) {
          if (seenLinks.has(link.id) || (mode === 'walk' && link.rank >= 6)) continue;
          seenLinks.add(link.id);
          let along = 0;
          for (let i = 1; i < link.pts.length; i++) {
            const [ax, az, ah] = link.pts[i - 1], [bx, bz, bh] = link.pts[i];
            const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1e-6;
            const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (L * L)));
            const px = ax + dx * t, pz = az + dz * t;
            // prefer the street at ground level: a flyover overhead is a poor place to start or end
            const d = Math.hypot(px - x, pz - z) + ((ah + bh) / 2 > 2 ? 25 : 0);
            if (!best || d < best.d) best = { link, d, along: along + L * t, x: px, z: pz };
            along += L;
          }
        }
      }
    }
  }
  return best;
}

function costOf(link, mode) {
  if (mode === 'car') return link.len / (SPEED_KMH[link.rank] / 3.6);
  return link.len / MODE_SPEED[mode];
}

// A* from a snapped start to a snapped end; returns the path [{ link, fwd }] or null
function astar(start, end, mode, strict) {
  const G = buildGraph();
  const vmax = mode === 'car' ? 90 / 3.6 : MODE_SPEED[mode];
  const h = (i) => Math.hypot(G.x(i) - end.x, G.z(i) - end.z) / vmax;
  const g = new Map();
  const prev = new Map();
  // binary heap of [f, node]
  const heap = [];
  const push = (f, node) => {
    heap.push([f, node]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
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
  const speed = (link) => (mode === 'car' ? SPEED_KMH[link.rank] / 3.6 : MODE_SPEED[mode]);
  // leave the start link by either end it may be driven towards
  const sl = start.link;
  const seeds = [];
  if (usable(sl, true, mode, strict)) seeds.push([sl.b, (sl.len - start.along) / speed(sl), { link: sl, fwd: true, partial: 'start' }]);
  if (usable(sl, false, mode, strict)) seeds.push([sl.a, start.along / speed(sl), { link: sl, fwd: false, partial: 'start' }]);
  for (const [node, cost, step] of seeds) {
    if (cost < (g.get(node) ?? Infinity)) {
      g.set(node, cost);
      prev.set(node, { from: -1, step });
      push(cost + h(node), node);
    }
  }
  // the goal: entering the end link from either end it may be driven from
  const el = end.link;
  const goals = new Map();
  if (usable(el, true, mode, strict)) goals.set(el.a, { cost: end.along / speed(el), fwd: true });
  if (usable(el, false, mode, strict)) goals.set(el.b, { cost: (el.len - end.along) / speed(el), fwd: false });
  // start & end on the same link, in a direction that's allowed
  let best = null;
  if (sl === el) {
    const fwd = end.along >= start.along;
    if (usable(sl, fwd, mode, strict)) best = { cost: Math.abs(end.along - start.along) / speed(sl), node: -1, fwd };
  }
  const closed = new Set();
  let expanded = 0;
  while (heap.length && expanded < 400000) {
    const [f, node] = pop();
    if (closed.has(node)) continue;
    if (best && f >= best.cost) break;
    closed.add(node);
    expanded++;
    const gn = g.get(node);
    const goal = goals.get(node);
    if (goal && (!best || gn + goal.cost < best.cost)) best = { cost: gn + goal.cost, node, fwd: goal.fwd };
    for (const { link, to, fwd } of G.out[node]) {
      if (!usable(link, fwd, mode, strict)) continue;
      const c = gn + costOf(link, mode);
      if (c < (g.get(to) ?? Infinity)) {
        g.set(to, c);
        prev.set(to, { from: node, step: { link, fwd } });
        push(c + h(to), to);
      }
    }
  }
  if (!best) return null;
  if (best.node === -1) return { cost: best.cost, steps: [{ link: sl, fwd: best.fwd, partial: 'both' }] };
  const steps = [{ link: el, fwd: best.fwd, partial: 'end' }];
  for (let node = best.node; prev.has(node);) {
    const p = prev.get(node);
    steps.push(p.step);
    if (p.from < 0) break;
    node = p.from;
  }
  steps.reverse();
  return { cost: best.cost, steps };
}

// The points of a link from `s0` to `s1` metres along it (in its own direction)
function slice(link, s0, s1) {
  const out = [];
  let along = 0;
  for (let i = 1; i < link.pts.length; i++) {
    const A = link.pts[i - 1], B = link.pts[i];
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const lerp = (s) => {
      const t = L ? (s - along) / L : 0;
      return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
    };
    if (along + L >= s0 && along <= s1) {
      if (!out.length) out.push(lerp(Math.max(s0, along)));
      out.push(lerp(Math.min(s1, along + L)));
    }
    along += L;
  }
  return out;
}

/**
 * Directions from `from` to `to` (world points) by `mode` ('car' | 'walk' | 'cycle'):
 * { points: [[x, y, z, lane offset to the right]...], distance (m), duration (s), steps: [{ type, text, street, distance, x, z, at }], start, end }
 */
function findRoute(from, to, mode = 'car') {
  const start = snapToGraph(from.x, from.z, mode);
  const end = snapToGraph(to.x, to.z, mode);
  if (!start || !end) return null;
  let path = astar(start, end, mode, true);
  let approximate = false;
  if (!path && mode === 'car') {
    path = astar(start, end, mode, false); // a one-way street mapped against a missing link: drive it anyway
    approximate = true;
  }
  if (!path) return null;

  // the geometry, with each leg's street and direction
  const legs = [];
  for (const st of path.steps) {
    const L = st.link.len;
    let s0 = 0, s1 = L;
    if (st.partial === 'start' || st.partial === 'both') (st.fwd ? (s0 = start.along) : (s1 = start.along));
    if (st.partial === 'end' || st.partial === 'both') (st.fwd ? (s1 = end.along) : (s0 = end.along));
    if (st.partial === 'both') { s0 = Math.min(start.along, end.along); s1 = Math.max(start.along, end.along); }
    let pts = slice(st.link, s0, s1);
    if (!st.fwd) pts = pts.reverse();
    // where to travel across the road: the right-hand lane of a two-way road, the right-hand pavement on foot, the
    // kerb lane by bicycle (OpenStreetMap maps dual carriageways as two one-way roads: their centre lines are lanes)
    const w = st.link.w;
    const off = mode === 'walk' ? w / 2 + 2 : mode === 'cycle' ? Math.max(0, w / 2 - 1.2) : st.link.dir === 0 ? w / 4 : 0;
    if (pts.length >= 2) legs.push({ name: st.link.name, rank: st.link.rank, pts, len: Math.abs(s1 - s0), off });
  }
  const points = [];
  for (const leg of legs) {
    for (const p of leg.pts) {
      const last = points[points.length - 1];
      if (last && Math.hypot(last[0] - p[0], last[2] - p[1]) < 0.3) continue;
      const ground = terrainHeightAt ? terrainHeightAt(p[0], p[1]) : 0;
      points.push([p[0], Math.max(p[2], ground), p[1], leg.off]);
    }
  }
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][2] - points[i - 1][2]));
  const distance = cum[cum.length - 1] || 0;

  // turn-by-turn: one step per street (unnamed bits folded into the street they lead onto)
  const runs = [];
  let along = 0;
  for (const leg of legs) {
    const name = leg.name || '';
    const prevRun = runs[runs.length - 1];
    if (prevRun && (prevRun.name === name || (!name && leg.len < 60) || (!prevRun.name && prevRun.len < 60))) {
      if (!prevRun.name && name) prevRun.name = name;
      prevRun.len += leg.len;
      prevRun.pts.push(...leg.pts.slice(1));
    } else runs.push({ name, len: leg.len, pts: leg.pts.slice(), at: along });
    along += leg.len;
  }
  // short connectors (across a median, a slip of a few metres) belong to the street they lead onto
  for (let i = runs.length - 2; i >= 1; i--) {
    if (runs[i].len >= 30) continue;
    const r = runs[i], nx = runs[i + 1];
    nx.pts = r.pts.concat(nx.pts.slice(1));
    nx.len += r.len;
    nx.at = r.at;
    runs.splice(i, 1);
  }
  // and two stretches of one street with only a connector between them are one
  for (let i = runs.length - 1; i >= 1; i--) {
    if (runs[i].name !== runs[i - 1].name) continue;
    runs[i - 1].pts.push(...runs[i].pts.slice(1));
    runs[i - 1].len += runs[i].len;
    runs.splice(i, 1);
  }
  const dirAt = (pts, fromEnd) => {
    // the direction over the first / last ~15 m
    if (fromEnd) {
      const B = pts[pts.length - 1];
      let k = pts.length - 2;
      while (k > 0 && Math.hypot(B[0] - pts[k][0], B[1] - pts[k][1]) < 15) k--;
      const A = pts[Math.max(0, k)];
      return [B[0] - A[0], B[1] - A[1]];
    }
    const A = pts[0];
    let k = 1;
    while (k < pts.length - 1 && Math.hypot(pts[k][0] - A[0], pts[k][1] - A[1]) < 15) k++;
    const B = pts[k];
    return [B[0] - A[0], B[1] - A[1]];
  };
  const streetName = (n) => (n ? shortName(n) : 'the road');
  const steps = [];
  runs.forEach((run, i) => {
    const [dx, dz] = dirAt(run.pts, false);
    const p0 = run.pts[0];
    if (i === 0) {
      steps.push({ type: 'depart', text: `Head ${compassWord(trueBearing(dx, dz))} on ${streetName(run.name)}`, street: run.name, distance: run.len, x: p0[0], z: p0[1], at: run.at });
      return;
    }
    const [ix, iz] = dirAt(runs[i - 1].pts, true);
    const a = Math.atan2(ix * dz - iz * dx, ix * dx + iz * dz) * 180 / Math.PI; // + right, - left
    const abs = Math.abs(a);
    const side = a > 0 ? 'right' : 'left';
    let type, verb;
    if (abs < 25) { type = 'straight'; verb = 'Continue onto'; }
    else if (abs < 60) { type = `slight-${side}`; verb = `Keep ${side} onto`; }
    else if (abs < 145) { type = side; verb = `Turn ${side} onto`; }
    else { type = 'uturn'; verb = 'Make a U-turn onto'; }
    // going straight on where the road just loses (or changes) its mapped name: no instruction, the distance carries on
    const prevStep = steps[steps.length - 1];
    if (type === 'straight' && (!run.name || !prevStep.street || run.name === prevStep.street)) {
      prevStep.distance += run.len;
      if (!prevStep.street && run.name) {
        prevStep.street = run.name;
        prevStep.text = prevStep.text.replace(/the road$/, streetName(run.name));
      }
      return;
    }
    steps.push({ type, text: `${verb} ${streetName(run.name)}`, street: run.name, distance: run.len, x: p0[0], z: p0[1], at: run.at });
  });
  const last = points[points.length - 1];
  steps.push({ type: 'arrive', text: 'Arrive at your destination', street: '', distance: 0, x: last[0], z: last[2], at: distance });

  const duration = mode === 'car' ? path.cost * 1.25 + steps.length * 6 : distance / MODE_SPEED[mode] + steps.length * 4; // junctions & signals
  return { mode, points, cum, distance, duration, steps, approximate, start: { x: start.x, z: start.z }, end: { x: end.x, z: end.z } };
}

/**
 * Where along `route` the point (x, z) is: { index, along (m), offRoute (m from the line) }, searching ahead of `hint`
 */
function progressOnRoute(route, x, z, hint = 0) {
  const P = route.points;
  let best = { index: hint, along: route.cum[hint] || 0, offRoute: Infinity };
  const i0 = Math.max(1, hint - 4), i1 = Math.min(P.length - 1, hint + 400);
  for (let i = i0; i <= i1; i++) {
    const A = P[i - 1], B = P[i];
    const dx = B[0] - A[0], dz = B[2] - A[2], L2 = dx * dx + dz * dz || 1e-6;
    const t = Math.max(0, Math.min(1, ((x - A[0]) * dx + (z - A[2]) * dz) / L2));
    const d = Math.hypot(A[0] + dx * t - x, A[2] + dz * t - z);
    if (d < best.offRoute - 0.01) best = { index: i - 1, along: route.cum[i - 1] + Math.sqrt(L2) * t, offRoute: d };
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------------
// A real-world position (a GPS fix): where it falls in the city, or how far from it
// ---------------------------------------------------------------------------------------------------------------------
const { CITY_BOUNDS, worldFromLatLon, geoDistance, isOnLand } = window.CITY;
function inFCT(lat, lon) {
  const r = GEO.fct || [];
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const yi = r[i], xi = r[i + 1], yj = r[j], xj = r[j + 1];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/**
 * { status: 'city' (inside the 3D city) | 'fct' (in the Federal Capital Territory, outside the 3D city) | 'away',
 *   x, z (world), distance (m) & bearing (true) from Eagle Square, district, label }
 */
function locateReal(lat, lon) {
  const { x, z } = worldFromLatLon(lat, lon);
  const { distance, bearing } = geoDistance(GEO.frame.lat, GEO.frame.lon, lat, lon);
  const inCity = x > CITY_BOUNDS.minX && x < CITY_BOUNDS.maxX && z > CITY_BOUNDS.minZ && z < CITY_BOUNDS.maxZ;
  const status = inCity ? 'city' : inFCT(lat, lon) ? 'fct' : 'away';
  return {
    status, x, z, lat, lon, distance, bearing,
    district: inCity ? districtAt(x, z) : '',
    label: inCity ? getLocationLabel(x, z) : '',
    onLand: inCity ? isOnLand(x, z) : true
  };
}

Object.assign(window.CITY, {
  Navigation: { locateReal, inFCT, searchPlaces, findRoute, progressOnRoute, snapToGraph, trueBearing, compassWord, formatDistance, formatDuration, CATEGORY_LABEL, buildIndex }
});
})();
