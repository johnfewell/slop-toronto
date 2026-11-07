(function () {
// js/water-edges.js — naturalistic water edges (st-de3g). Where the city's water meets natural ground (the Island's
// beaches & lagoons, Grenadier Pond, the rivers' banks, Cherry Beach, park ponds) the shore was a hard polygon cut: lawn
// on a raised kerb, a vertical earth bank, a flat water plane. Here, along those shores only:
// - a shore apron: a strip sloping from the land's edge down under the water, sand on a beach, mud & gravel on a bank,
//   its width varying along the shore so the waterline wanders instead of following the polygon's straight segments;
//   damp & darker near the water, a wet swash band that rises & falls, and thin foam at its top on the lake's beaches;
// - the shallows: a transparent tint over the water from the waterline out, the sand or silt showing through, fading to
//   the water's own colour with distance;
// - on the beaches, the sand over the ground (OpenStreetMap's natural=beach / sand outlines, js/toronto-shores.js), in
//   the lawn's, the open land's and the street level's own materials (sandInto), with an irregular edge.
// Engineered edges stay crisp: the mainland's lake shore is armour stone & dock walls except at its mapped beaches and
// wetlands, a shore within reach of a mapped pier / quay / breakwater / groyne / wall is left as it is, and so are the
// slips, channels, basins, pools & fountains. ?shores=0 draws the shores as they were (A/B); the low tier keeps the
// apron & the sand but not the shallows or the swash.
const C = window.CITY;
const S = C.SHORES;
const params = new URLSearchParams(location.search);
const OFF = !S || params.get('shores') === '0';
const DEBUG = params.get('shores') === 'debug' || params.get('shores') === 'debug-all'; // (the apron magenta, the fringe yellow, the shallows cyan)
const Q = C.QUALITY || { tier: 'high' };
const LOW = Q.tier === 'low';

// Shore classes
const BANK = 1, BEACH = 2, MARSH = 3;
const CLASS_NAMES = ['', 'bank', 'beach', 'marsh'];
// The apron's mean width (m) by class, its shallows' reach, and how far a beach / wetland outline reaches a shore (m)
const APRON = { [BANK]: 3.4, [BEACH]: 8.5, [MARSH]: 4 }, MAX_APRON = 14;
const SHALLOWS = { [BANK]: 6, [BEACH]: 22, [MARSH]: 8 };
// The inland fringe's mean width (m): sand up a beach, trampled earth & thin grass along a bank, muck at a marsh
const INLAND = { [BANK]: 1.4, [BEACH]: 7, [MARSH]: 2.4 };
// (a pier alone is a dock standing out from a natural shore, crisp only at its root; a marina's piers wall theirs)
const BEACH_REACH = 14, WET_REACH = 8, HARD_REACH = 9, PIER_REACH = 3, BEACH_GAP = 45;
const STEP = 3, STEP_PILOT = 1.5; // samples along the shore (m)
const REED_BUDGET = 4500; // reed clumps over the whole map at most
// Water bodies whose edges are built, not natural, by name
const BUILT_NAME = /slip|channel|basin|rink|splash|memorial|fountain|pool|reflecting|devonian|canal|harbour|marina/i;
// Mainland zones whose shore is a dock wall or armour stone even where OpenStreetMap maps sand on top (HTO Park & Sugar
// Beach are sand on a dock wall; Ontario Place & Marilyn Bell Park are armour stone): [x0, z0, x1, z1]
const HARD_ZONES = [
  [-2500, 200, 2150, 1000], // the inner harbour's north shore, Bathurst Quay to the Cherry Street bridge
  [-3900, 300, -2450, 1400], // Ontario Place's islands & the western channel
  [-1500, 1880, -300, 2520], // the Islands' yacht clubs & marinas on their north shore
  [-2450, 940, -1380, 1460], // Billy Bishop airport's seawalls (its west, north & east sides; Hanlan's beach below stays)
  [1700, 380, 2560, 640] // the Keating Channel's walls
];
// The rollout, area by area (st-de3g): the natural shores inside these boxes get their edges, [x0, z0, x1, z1]; the
// rest keep theirs until their step ships. ?shores=all draws every natural shore of the map (the next steps' review)
const ROLLOUT = {
  'high-park': [-7250, -2750, -5750, -1100], // Grenadier Pond & the park's ponds (the pilot)
  'toronto-island': [-1750, 1850, 1950, 3650], // the Islands' lagoons & beaches (the pilot; Ward's east end since batch A)
  // batch A, the east waterfront: Cherry Beach, the Portlands & the Don's new mouth, the Leslie Street Spit's marshes,
  // Ashbridges Bay, Woodbine & Kew Beaches (the Eglinton map)
  'east-waterfront': [1450, -800, 9600, 3650],
  // batch B, the west: the Humber's mouth & banks, Humber Bay Park's beaches, Sunnyside
  'west-waterfront': [-8000, -3500, -4800, 1500],
  // batch C, the rest of the map: the Don's & the Humber's valleys, Taylor Creek & the other ravines, the city's ponds,
  // the Eglinton map's band, Hanlan's Point (the box: every shore of either map)
  rest: [-1e5, -1e5, 1e5, 1e5]
};
const BEACHES_SHORE = [6200, -800, 8600, 400];
const inBox = ([x0, z0, x1, z1], x, z) => x > x0 && x < x1 && z > z0 && z < z1;
const ALL = params.get('shores') === 'all' || params.get('shores') === 'debug-all';
const inRollout = (x, z) => ALL || Object.values(ROLLOUT).some(([x0, z0, x1, z1]) => x > x0 && x < x1 && z > z0 && z < z1);
// An island's shore facing this much open lake (m), towards the lake (not north across the harbour), is a beach where
// nothing maps it otherwise: the lake's waves pile the Islands' sand along their south & west shores, while the
// lagoons behind them keep their muddy banks
const EXPOSED = 260;

// ---------------------------------------------------------------------------------------------------------------------
// Spatial lookups over the shore data (32 m cells)
// ---------------------------------------------------------------------------------------------------------------------
const CELL = 32;
const key = (i, j) => i * 1000003 + j;
function segGrid(lines, reach) {
  const g = new Map();
  for (const ln of lines) {
    const p = ln.p, n = p.length / 2, closedRing = !!ln.ring;
    for (let k = 0; k < (closedRing ? n : n - 1); k++) {
      const ax = p[2 * k], az = p[2 * k + 1], bx = p[2 * ((k + 1) % n)], bz = p[2 * ((k + 1) % n) + 1];
      const i0 = Math.floor((Math.min(ax, bx) - reach) / CELL), i1 = Math.floor((Math.max(ax, bx) + reach) / CELL);
      const j0 = Math.floor((Math.min(az, bz) - reach) / CELL), j1 = Math.floor((Math.max(az, bz) + reach) / CELL);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const kk = key(i, j);
        if (!g.has(kk)) g.set(kk, []);
        g.get(kk).push([ax, az, bx, bz, ln]);
      }
    }
  }
  return g;
}
function segDist2(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  let t = L2 > 0 ? ((x - ax) * dx + (z - az) * dz) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const ex = ax + dx * t - x, ez = az + dz * t - z;
  return ex * ex + ez * ez;
}
function nearSeg(g, x, z, r) {
  const list = g.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!list) return null;
  let best = null, bd = r * r;
  for (const s of list) { const d = segDist2(x, z, s[0], s[1], s[2], s[3]); if (d <= bd) { bd = d; best = s[4]; } }
  return best;
}
// (how many piers reach within r of (x, z): more than one is a marina's, walled; one alone a park pond's dock)
function piersNear(g, x, z, r) {
  const seen = new Set();
  for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
    for (const s of g.get(key(i, j)) || []) if (s[4].k === 'pier' && !seen.has(s[4]) && segDist2(x, z, s[0], s[1], s[2], s[3]) < r * r) seen.add(s[4]);
  }
  return seen.size;
}
function inFlatPoly(p, x, z) {
  let inside = false;
  for (let i = 0, n = p.length / 2, j = n - 1; i < n; j = i++) {
    const ax = p[2 * i], az = p[2 * i + 1], bx = p[2 * j], bz = p[2 * j + 1];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}
function polyIndex(polys) {
  const g = new Map();
  for (const poly of polys) {
    const p = poly.p;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < p.length; k += 2) { x0 = Math.min(x0, p[k]); x1 = Math.max(x1, p[k]); z0 = Math.min(z0, p[k + 1]); z1 = Math.max(z1, p[k + 1]); }
    Object.assign(poly, { x0, x1, z0, z1, ring: true });
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
      const kk = key(i, j);
      if (!g.has(kk)) g.set(kk, []);
      g.get(kk).push(poly);
    }
  }
  return (x, z) => {
    const list = g.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (list) for (const poly of list) if (x >= poly.x0 && x <= poly.x1 && z >= poly.z0 && z <= poly.z1 && inFlatPoly(poly.p, x, z)) return poly;
    return null;
  };
}

let lookups = null;
function shoreLookups() {
  if (lookups) return lookups;
  const walls = (C.GEO.walls || []).map(([, flat]) => ({ k: 'wall', p: flat }));
  // (a short open breakwater, under 60 m, is a groyne in all but its tag: the Islands' beaches have several)
  const len = (p) => { let L = 0; for (let i = 2; i < p.length; i += 2) L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return L; };
  const hard = [...S.hard.map((h) => ({ ...h, ring: !!h.a, k: h.k === 'breakwater' && !h.a && len(h.p) < 60 ? 'groyne' : h.k })), ...walls];
  lookups = {
    beachAt: polyIndex(S.beaches),
    wetAt: polyIndex(S.wetlands),
    beachEdges: segGrid(S.beaches, BEACH_REACH),
    wetEdges: segGrid(S.wetlands, WET_REACH),
    hardEdges: segGrid(hard, HARD_REACH)
  };
  return lookups;
}
// Natural land use round the shore where no curb island says (GEO.areas: parks, woods, scrub, pitches)
let natAt = null;
function naturalAreaAt(x, z) {
  if (!natAt) {
    const polys = [];
    for (const a of C.GEO.areas) if (a[0] === 'park' || a[0] === 'wood' || a[0] === 'scrub' || a[0] === 'golf') polys.push({ p: a[2] });
    natAt = polyIndex(polys);
  }
  return !!natAt(x, z);
}

// ---------------------------------------------------------------------------------------------------------------------
// Which shores are natural: every water outline the city draws, sampled every STEP m
// ---------------------------------------------------------------------------------------------------------------------
// Where the lake & the rivers running out over the map's edge are drawn: the street level drops its asphalt over them by
// the build's water mask (city-grid.js maskedByWater, GEO.waterMask: 4 m cells, row runs dry / wet from dry). A river the
// mask leaves out lies under the asphalt (the Humber north of the Queensway on the Eglinton map), and its shores get no
// edges: an apron there would draw on the road
let maskData = null;
function drawnWet(x, z) {
  const M = C.GEO.waterMask;
  if (!M) return true;
  if (!maskData) {
    const bin = atob(M.runs), runs = new Uint16Array(bin.length / 2);
    for (let i = 0; i < runs.length; i++) runs[i] = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    maskData = new Uint8Array(M.w * M.h);
    let k = 0;
    for (let j = 0; j < M.h; j++) {
      let i = 0, v = 0;
      while (i < M.w) { const n = runs[k++]; if (v) maskData.fill(1, j * M.w + i, j * M.w + i + n); i += n; v ^= 1; }
      if (v === 0 && runs[k] === 0) k++;
    }
  }
  const i = Math.floor((x - M.x0) / M.res), j = Math.floor((z - M.z0) / M.res);
  if (i < 0 || j < 0 || i >= M.w || j >= M.h) return false;
  // (the cell or one beside it: the mask is linear-filtered in the street level's material)
  for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
    const ii = i + a, jj = j + b;
    if (ii >= 0 && jj >= 0 && ii < M.w && jj < M.h && maskData[jj * M.w + ii]) return true;
  }
  return false;
}

// A pond shows where no curb island covers it, or where the island is parkland or open land (city-grid.js cuts its
// ponds out of those yards); over a paved or built plot the pond lies under the paving (Taddle Creek Pond on the
// Eglinton map), and an apron there would draw across the plaza. (The bigger map's band shows its ponds since
// st-bz1o.13: its terrain floor lies under the water near them)
function pondShows(x, z, ring) {
  if (ring.pilot) return true;
  const b = C.blockAt(x, z);
  return !b || b.park > 0.6 || b.wild > 0.5;
}

// In the bigger map's band the terrain's floor lies under the water within 60 m of it (st-bz1o.13), but not where the
// 60 m relief stands 3 m or more: there the water stays under the ground, and an apron would draw a mud bank by no
// water. (The terrain is built before the water edges: terrain.js terrainNearHeightAt)
function bandCovered(x, z, ring) {
  const B = C.FAR_BAND, T = C.terrainNearHeightAt;
  if (!B || !T || ring.pilot || B.inCore(x, z)) return false;
  return T(x, z) > ring.level - 0.05;
}

function shoreRings() {
  const B = C.CITY_BOUNDS, PILOT = C.DON_VALLEY || null;
  const inside = (pts, m = 0) => pts.every((p) => p.x > B.minX + m && p.x < B.maxX - m && p.z > B.minZ + m && p.z < B.maxZ - m);
  const rings = [];
  for (const w of C.WATER_BODIES) {
    if (w.pts.length < 3) continue;
    const built = BUILT_NAME.test(w.name || '');
    if (inside(w.pts, 5)) {
      const level = PILOT && PILOT.pondLevel ? PILOT.pondLevel(w) : null;
      rings.push({ pts: w.pts, level: level ?? B.waterLevel, pilot: level !== null, built, mainland: false, pond: true, body: w });
    } else if (w.holes && w.holes.length) {
      rings.push({ pts: w.pts, level: B.waterLevel, built, mainland: true, body: w }); // (sampled inside the city only)
      for (const h of w.holes) if (inside(h.pts, 0)) rings.push({ pts: h.pts, level: B.waterLevel, built: false, mainland: false, island: true, body: w });
    }
  }
  for (const e of C.EDGE_WATERS || []) rings.push({ pts: e.pts, level: B.waterLevel, built: BUILT_NAME.test(e.body.name || ''), mainland: false, edge: true, body: e.body });
  return rings;
}

function classify(x, z, nx, nz, ring) {
  const L = shoreLookups();
  // (a point 3 m inland: what the land is)
  const ix = x - nx * 3, iz = z - nz * 3;
  if (!inRollout(x, z)) return 0;
  // (-1: engineered for certain; the run-smoothing below never turns it natural)
  for (const [x0, z0, x1, z1] of HARD_ZONES) if (x > x0 && x < x1 && z > z0 && z < z1) return -1;
  if (ring.built) return -1;
  const hardNear = nearSeg(L.hardEdges, x, z, HARD_REACH);
  // (a pier or a groyne stands out across the shore: crisp at its root only, the beach or bank carries on either side)
  const point = hardNear && (hardNear.k === 'pier' || hardNear.k === 'groyne');
  if (hardNear && (!point || nearSeg(L.hardEdges, x, z, PIER_REACH) || piersNear(L.hardEdges, x, z, 30) > 1)) return -1;
  classify.gap = 0;
  const beach = L.beachAt(ix, iz) || L.beachAt(x, z) || nearSeg(L.beachEdges, x, z, BEACH_REACH);
  if (beach) return BEACH;
  // (a beach mapped a little inland of the drawn shore: the lake's outline and OpenStreetMap's sand disagree by up to
  // 40 m at Woodbine; the sand is carried down to the water, classify.gap metres of it)
  for (let d = 10; d <= BEACH_GAP; d += 5) if (L.beachAt(x - nx * d, z - nz * d)) { classify.gap = d; return BEACH; }
  const wet = L.wetAt(ix, iz) || L.wetAt(x, z) || nearSeg(L.wetEdges, x, z, WET_REACH);
  if (wet) return MARSH;
  // (the Beaches' open shore, Woodbine to Balmy: sand all along, though OpenStreetMap maps only Woodbine's; groynes
  // and the R. C. Harris plant's walls stay crisp by the hard edges)
  if (ring.mainland && inBox(BEACHES_SHORE, x, z) && exposed(x, z, nx, nz)) { classify.gap = 22; return BEACH; } // (some 25 m of sand)
  if (ring.mainland) return 0; // (the lake's mainland shore: armour stone & walls but for its beaches & wetlands)
  if (ring.island && nz > -0.25 && exposed(x, z, nx, nz)) return BEACH;
  const b = C.blockAt(ix, iz);
  if (b) return b.park > 0.5 || b.wild ? BANK : 0;
  return naturalAreaAt(ix, iz) || ring.pilot ? BANK : 0;
}

// (open lake across a fan of directions round the shore's normal: not a lagoon's far end, nor down a channel)
function exposed(x, z, nx, nz) {
  for (const a of [-0.9, -0.45, 0, 0.45, 0.9]) {
    const c = Math.cos(a), s = Math.sin(a), dx = nx * c - nz * s, dz = nx * s + nz * c;
    for (const d of [40, 110, 190, EXPOSED]) if (!C.waterAt(x + dx * d, z + dz * d)) return false;
  }
  return true;
}

// (naturalShores, below, a ring a step)
function* naturalShoresSteps() {
  const B = C.CITY_BOUNDS, PILOT = C.DON_VALLEY || null;
  const runs = [];
  const onEdge = (x, z) => Math.abs(x - B.minX) < 3 || Math.abs(x - B.maxX) < 3 || Math.abs(z - B.minZ) < 3 || Math.abs(z - B.maxZ) < 3;
  const inCity = (x, z) => x > B.minX + 2 && x < B.maxX - 2 && z > B.minZ + 2 && z < B.maxZ - 2;
  for (const ring of shoreRings()) {
    yield;
    const pts = ring.pts, n = pts.length;
    const samples = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const Ls = Math.hypot(b.x - a.x, b.z - a.z);
      if (Ls < 0.01) continue;
      // (High Park's ponds every 1.5 m: the lidar's ground along their outlines rises & falls a metre between samples)
      const k = Math.max(1, Math.ceil(Ls / (ring.pilot ? STEP_PILOT : STEP)));
      let nx = -(b.z - a.z) / Ls, nz = (b.x - a.x) / Ls;
      // (which side the water is: the probe 1.5 m out each way)
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      const wa = !!C.waterAt(mx + nx * 1.5, mz + nz * 1.5), wb = !!C.waterAt(mx - nx * 1.5, mz - nz * 1.5);
      const ok = wa !== wb;
      if (wb && !wa) { nx = -nx; nz = -nz; }
      for (let j = 0; j < k; j++) {
        const x = a.x + ((b.x - a.x) * j) / k, z = a.z + ((b.z - a.z) * j) / k;
        let cls = 0;
        let gap = 0;
        if (ok && inCity(x, z) && !onEdge(x, z) && (ring.pond ? pondShows(x + nx * 2.5, z + nz * 2.5, ring) : drawnWet(x + nx * 2.5, z + nz * 2.5)) && !bandCovered(x + nx * 3, z + nz * 3, ring)) { cls = classify(x, z, nx, nz, ring); gap = classify.gap || 0; }
        samples.push({ x, z, nx, nz, cls, gap });
      }
    }
    if (!samples.length) continue;
    // a majority over 7 samples (17 m) so one stray sample neither breaks a run nor starts one
    const m = samples.length, cls = samples.map((s) => Math.max(0, s.cls));
    const sm = cls.map((_, i) => {
      if (samples[i].cls < 0) return 0;
      const count = [0, 0, 0, 0];
      for (let d = -3; d <= 3; d++) count[cls[(i + d + m) % m]]++;
      let best = cls[i], bc = -1;
      for (let c = 0; c < 4; c++) if (count[c] > bc || (count[c] === bc && c === cls[i])) { bc = count[c]; best = c; }
      return count[0] >= 4 ? 0 : best;
    });
    // runs of natural samples (a whole ring natural: one closed run)
    const allNat = sm.every((c) => c > 0);
    let start = allNat ? 0 : sm.findIndex((c, i) => c > 0 && sm[(i - 1 + m) % m] === 0);
    if (start < 0) continue;
    let run = null, s = 0;
    for (let t = 0; t <= m; t++) {
      const i = (start + t) % m, c = t === m ? (allNat ? sm[start] : 0) : sm[i];
      if (c > 0 && !(t === m && !allNat)) {
        const p = samples[i];
        if (!run) { run = { pts: [], level: ring.level, closed: false, pilot: !!ring.pilot, still: !ring.edge && !/river|creek/i.test(ring.body.name || '') }; s = 0; }
        else { const q = run.pts[run.pts.length - 1]; s += Math.hypot(p.x - q.x, p.z - q.z); }
        const blockLift = C.blockAt(p.x - p.nx * 0.6, p.z - p.nz * 0.6) ? B.sidewalkHeight : 0;
        // (a pilot pond's: the highest ground within a sample's reach along the shore, so the apron's top edge never
        // dips under the draped lawn's edge between samples)
        const tx = -p.nz, tz = p.nx, hAt = (d) => PILOT.heightAt(p.x + tx * d, p.z + tz * d);
        const top = ring.pilot ? (PILOT ? Math.max(hAt(0), hAt(0.8), hAt(-0.8)) : 0) + blockLift : B.sidewalkHeight;
        run.pts.push({ x: p.x, z: p.z, nx: p.nx, nz: p.nz, cls: c, top, s, gap: p.gap });
        if (t === m && allNat) run.closed = true;
      } else if (run) {
        if (run.pts.length >= 4) runs.push(run);
        run = null;
      }
      if (t === m && run && run.pts.length >= 4) runs.push(run);
    }
  }
  return runs;
}

// ---------------------------------------------------------------------------------------------------------------------
// Geometry: the apron & the shallows, merged per 500 m cell (so the far shores are culled with the frustum)
// ---------------------------------------------------------------------------------------------------------------------
const smoothstep01 = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash1 = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const vnoise = (t) => { const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f); return hash1(i) * (1 - u) + hash1(i + 1) * u; };

// How far the water runs out from a shore point along (nx, nz), up to `max` m (open water: two probes; else 1 m steps)
function freeWater(x, z, nx, nz, max) {
  if (C.waterAt(x + nx * max, z + nz * max) && C.waterAt(x + nx * max * 0.5, z + nz * max * 0.5) && C.waterAt(x + nx * max * 0.25, z + nz * max * 0.25)) return max;
  let free = 0;
  for (let d = 1; d <= max; d += 1) { if (!C.waterAt(x + nx * d, z + nz * d)) break; free = d; }
  return free;
}

function* buildGeometrySteps(runs) {
  const { THREE } = C;
  const cells = new Map(); // cell -> { apron: {pos, nrm, attr}, shallow: {...} }
  const acc = (k) => {
    if (!cells.has(k)) cells.set(k, { apron: { pos: [], nrm: [], a: [], idx: [] }, shallow: { pos: [], a: [], idx: [] }, reeds: [] });
    return cells.get(k);
  };
  const stats = { runs: runs.length, length: 0, byClass: [0, 0, 0, 0] };
  for (const run of runs) {
    yield;
    // (a bank's geometry takes every other sample, 6 m apart, but on High Park's ponds: its apron is narrow and the
    // waterline's wander comes from the width's noise; beaches & marshes keep every sample, as do the samples where the
    // class changes)
    const R = run.pts, P = R.filter((p, i) => p.cls !== BANK || run.pilot || i % 2 === 0 || i === R.length - 1 || R[i - 1].cls !== BANK || (R[i + 1] && R[i + 1].cls !== BANK));
    const n = P.length;
    // smoothed normals (the average of each sample's neighbours) and the widths
    const N = P.map((p, i) => {
      const a = P[run.closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = P[run.closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      let nx = a.nx + p.nx * 2 + b.nx, nz = a.nz + p.nz * 2 + b.nz;
      const l = Math.hypot(nx, nz) || 1;
      return [nx / l, nz / l];
    });
    const W = P.map((p, i) => {
      // (wide enough that the land's drop to the water slopes no steeper than about 1 in 3 down to the waterline: High
      // Park's lawn stands up to 3 m over Grenadier Pond, the Islands' 0.9 m over the lake)
      const drop = Math.max(0, p.top - run.level);
      const base = Math.max(APRON[p.cls], Math.min(MAX_APRON, drop / (0.6 * 0.33)));
      const w = base * (0.6 + 0.65 * vnoise(p.s / 23 + p.x * 0.001) + 0.25 * (vnoise(p.s / 6.5 + 91.3) - 0.5));
      // (no wider than 40% of the open water in front: a narrow stream keeps its middle)
      const free = freeWater(p.x, p.z, N[i][0], N[i][1], base * 2.6);
      return Math.max(0.5, Math.min(w, free * 0.4));
    });
    // the ends taper to nothing over a few samples
    const taper = (i) => run.closed ? 1 : Math.min(1, (i + 0.5) / 4, (n - i - 0.5) / 4);
    for (let i = 0; i < n; i++) stats.byClass[P[i].cls] += i ? Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z) : 0;
    // the inland fringe: sand up the beach, trampled earth along a bank, over the land's own ground (no further than
    // the same curb island, nor into other water)
    const B = C.CITY_BOUNDS, PILOT = C.DON_VALLEY || null;
    const IN = P.map((p, i) => {
      const want = Math.max(INLAND[p.cls] * (0.6 + 0.8 * vnoise(p.s / 17 + 44.4)), p.cls === BEACH && p.gap ? p.gap + 4 : 0) * taper(i);
      const [nx, nz] = N[i], home = run.pilot ? null : C.blockAt(p.x - nx * 0.6, p.z - nz * 0.6);
      let d = 0;
      for (let k = 1; k <= want; k += 1) {
        const qx = p.x - nx * k, qz = p.z - nz * k;
        if (C.waterAt(qx, qz) || (!run.pilot && C.blockAt(qx, qz) !== home)) break;
        d = k;
      }
      d = Math.max(0, Math.min(want, d - 0.5));
      const qx = p.x - nx * d, qz = p.z - nz * d;
      const y = run.pilot ? (PILOT ? PILOT.heightAt(qx, qz) : 0) + (C.blockAt(qx, qz) ? B.sidewalkHeight : 0) : p.top;
      return [d, y];
    });
    // apron rows: d as a share of the width, height from the land's top down under the water (row 0: the inland fringe)
    const ROWS = [-1, 0, 0.6, 1];
    const segs = run.closed ? n : n - 1;
    // one cell per run piece of ~40 samples, by its first sample
    for (let i0 = 0; i0 < segs; i0 += 40) {
      const i1 = Math.min(segs, i0 + 40);
      const c0 = P[i0];
      const cell = acc(`${Math.floor(c0.x / 500)},${Math.floor(c0.z / 500)}`);
      const A = cell.apron, Sh = cell.shallow;
      const baseA = A.pos.length / 3, baseS = Sh.pos.length / 3;
      for (let ii = i0; ii <= i1; ii++) {
        const i = ii % n, p = P[i], [nx, nz] = N[i], w = W[i] * taper(i), wl = run.level;
        const jitter = (vnoise(p.s / 3.1 + 17.7) - 0.5) * 0.06;
        // the profile: the land's top, the swash just above the water, under the water
        const [win, yIn] = IN[i];
        // (the slope's top a hand's breadth inland and a little over the land's edge, so the old earth bank's top edge
        // never peeks through where the shore turns between samples)
        // (row 1 is set so the slope passes 2 cm over the land's edge at the outline itself)
        const y1 = p.top + 0.02 + (0.2 * Math.max(0, p.top - wl)) / Math.max(0.6 * w, 0.5);
        const yAt = [yIn + 0.02, y1, wl + 0.035 + jitter, wl - 0.45 - w * 0.03];
        for (let r = 0; r < ROWS.length; r++) {
          const d = r === 0 ? -Math.max(win, 0.3) : r === 1 ? -0.2 : ROWS[r] * w;
          A.pos.push(p.x + nx * d, yAt[r], p.z + nz * d);
          // (the slope's normal: up on the fringe, leaning from the water on the slope)
          if (r <= 1) A.nrm.push(0, 1, 0);
          else {
            const k = -(yAt[r] - yAt[r - 1]) / Math.max(0.05, (ROWS[r] - ROWS[r - 1]) * w), l = Math.hypot(k, 1);
            A.nrm.push((nx * k) / l, 1 / l, (nz * k) / l);
          }
          // a: [class, along (m), across (inland: -1 at the fringe's inner edge; the slope: its share of the width), water level]
          A.a.push(p.cls, p.s, ROWS[r], wl);
        }
        // reeds & cattails: thick along a marsh, in patches along a pond's or a lagoon's bank, standing in the shallows
        // at the waterline (none on the lake's beaches, nor on the rivers, whose current & floods keep them off)
        if (!LOW && ii < i1 && (p.cls === MARSH || (p.cls === BANK && run.still))) {
          // (stands of 2 to 5 clumps at irregular spots, thick where the patch noise is high, none between patches)
          const patch = p.cls === MARSH ? 0.45 : smoothstep01(0.55, 0.72, vnoise(p.s / 37 + p.z * 0.003 + 7.1)) * 0.5;
          const h = hash1(p.s * 1.37 + p.x * 0.71);
          if (h < patch * (run.pilot ? 0.5 : 1)) {
            const tx = -nz, tz = nx, n = 2 + Math.floor(hash1(h * 41.3) * 4);
            const along0 = (hash1(h * 91.7) - 0.5) * STEP, out0 = w * (0.4 + 0.6 * hash1(h * 53.3));
            for (let r = 0; r < n; r++) {
              const hr = hash1(h * 17.1 + r * 5.37), along = along0 + (hash1(hr * 3.3) - 0.5) * 2.6, out = out0 + (hash1(hr * 7.9) - 0.5) * 1.6;
              cell.reeds.push([p.x + nx * out + tx * along, wl - 0.08, p.z + nz * out + tz * along, 0.6 + 0.75 * hash1(hr * 13.9), hr * 6.283]);
            }
          }
        }
        // the shallows: from just inside the waterline out
        const wlD = w * 0.62, reach = SHALLOWS[p.cls] * (0.7 + 0.6 * vnoise(p.s / 31 + 5.1)) * taper(i);
        const free = freeWater(p.x, p.z, nx, nz, wlD + reach);
        const out = Math.max(wlD + 0.5, Math.min(wlD + reach, free * 0.48));
        for (const [d, t] of [[wlD - 0.4, 0], [wlD + (out - wlD) * 0.35, 0.35], [out, 1]]) {
          Sh.pos.push(p.x + nx * d, wl + 0.012, p.z + nz * d);
          Sh.a.push(p.cls, p.s, t, d - wlD);
        }
      }
      const cnt = i1 - i0 + 1;
      for (let k = 0; k < cnt - 1; k++) {
        for (let r = 0; r < ROWS.length - 1; r++) {
          const a = baseA + k * ROWS.length + r, b = a + ROWS.length;
          A.idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
        for (let r = 0; r < 2; r++) {
          const a = baseS + k * 3 + r, b = a + 3;
          Sh.idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
  }
  const out = [];
  for (const [k, cell] of cells) {
    const mk = (src, normals) => {
      if (!src.idx.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(src.pos, 3));
      if (normals) g.setAttribute('normal', new THREE.Float32BufferAttribute(src.nrm, 3));
      else { const nn = new Float32Array(src.pos.length); for (let i = 1; i < nn.length; i += 3) nn[i] = 1; g.setAttribute('normal', new THREE.BufferAttribute(nn, 3)); }
      g.setAttribute('shore', new THREE.Float32BufferAttribute(src.a, 4));
      g.setIndex(src.idx);
      g.computeBoundingSphere();
      return g;
    };
    out.push({ key: k, apron: mk(cell.apron, true), shallow: mk(cell.shallow, false), reeds: cell.reeds });
  }
  stats.length = stats.byClass.reduce((a, b) => a + b, 0);
  return { cells: out, stats };
}

// ---------------------------------------------------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------------------------------------------------
// sRGB hex: Toronto Island's pale quartz sand, its wet tone; a bank's silt & gravel; a marsh's dark muck
const SAND = [0xab9673, 0x98835f, 0x86704f];
const MUD = [0x67563f, 0x544432, 0x3a2d1f];
const GRASS_EDGE = 0x5a6235;

// The dry sand: drifts & trampled patches, a little darker in the hollows (one formula for the apron & the ground under
// the beaches, so the two meet without a seam)
function sandColour(p) {
  const { color, mix } = C.TSL;
  const noise2D = C.waterEdgeNoise;
  const n1 = noise2D(p.mul(0.21)), n2 = noise2D(p.mul(1.3).add(4.1)), n3 = noise2D(p.mul(6.0).add(2.2));
  return mix(color(SAND[0]), color(SAND[1]), n1.mul(0.5).add(n3.mul(0.5))).mul(n2.mul(0.14).add(0.92));
}

function apronMaterial() {
  const T = C.TSL;
  const { Fn, attribute, positionWorld, color, mix, smoothstep, float, vec2, sin, clamp, time, max, abs, texture } = T;
  const noise2D = C.waterEdgeNoise;
  const mat = new C.THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
  mat.name = 'ShoreApron';
  const A = attribute('shore', 'vec4');
  const cls = A.x, along = A.y, across = A.z, wl = A.w;
  const beach = smoothstep(1.5, 2.0, cls).mul(smoothstep(2.6, 2.4, cls)); // class 2
  const marsh = smoothstep(2.5, 2.9, cls);
  const h = positionWorld.y.sub(wl); // height over the water
  // the swash: how high the last wave ran up, rising & falling along the shore (beaches: a hand's breadth; ponds: still)
  const swashAmp = mix(float(0.012), float(0.075), beach);
  const phase = time.mul(0.55).add(along.mul(0.045)).add(noise2D(vec2(along.mul(0.08), 3.7)).mul(4.0));
  const swash = sin(phase).mul(0.5).add(0.5).mul(swashAmp).add(mix(float(0.02), float(0.05), beach));
  const wet = LOW ? smoothstep(0.08, 0.0, h) : smoothstep(swash.add(0.015), swash.sub(0.01), h);
  const damp = smoothstep(0.42, 0.04, h); // the damp band above the swash
  mat.colorNode = Fn(() => {
    const p = positionWorld.xz;
    const n1 = noise2D(p.mul(0.35)), n2 = noise2D(p.mul(2.1).add(7.7)), n3 = noise2D(p.mul(7.3).add(1.3));
    const sand = sandColour(p);
    const mud = mix(mix(color(MUD[0]), color(MUD[1]), n1), color(0x655c4e), smoothstep(0.62, 0.8, n2).mul(0.35)); // (a little dull gravel)
    const muck = mix(color(0x45402c), color(MUD[2]), n2);
    const dry = mix(mix(mud, sand, beach), muck, marsh).toVar();
    // the inland fringe & the slope's top: grass tufts through the earth (a bank) or the sand (a beach's back), more
    // of them inland, until the lawn takes over
    const inland = clamp(across.negate(), 0.0, 1.0);
    // (a bank's fringe is lawn all but a few worn patches, so its margin is one band down the slope: grass, mud, the wet
    // line, the water)
    const tuftShare = mix(mix(float(0.92), float(0.12), beach), float(0.5), marsh).add(inland.mul(0.45)).mul(smoothstep(0.25, -0.1, across));
    const tufts = smoothstep(float(1.0).sub(tuftShare), float(1.12).sub(tuftShare), n2.mul(0.65).add(n3.mul(0.35)));
    // a bank's upper slope is grassed down to a muddy strip a little over the water (worn & broken by noise)
    const slopeGrass = smoothstep(0.5, 0.72, h.sub(n1.mul(0.25)).sub(n3.mul(0.08))).mul(float(1.0).sub(beach.mul(0.92))).mul(smoothstep(-0.05, 0.05, across));
    dry.assign(mix(dry, C.seasonalGrass(mix(color(GRASS_EDGE), color(0x6f7840), n1)), max(tufts, slopeGrass)));
    const wetTone = mix(mix(color(MUD[2]), color(SAND[2]), beach), color(0x2a2618), marsh);
    let c = mix(dry, dry.mul(0.78), damp);
    c = mix(c, wetTone, wet);
    if (!LOW) {
      // foam at the swash's top on the lake's beaches: the foam texture's lattice, thin and broken
      const foamTex = C.waterEdgeFoam();
      const ft = texture(foamTex, vec2(along.mul(0.11), h.mul(9.0).add(time.mul(0.05)))).r;
      const line = smoothstep(0.035, 0.0, abs(h.sub(swash))).mul(beach).mul(ft).mul(smoothstep(0.3, 0.6, n2));
      c = mix(c, color(0xd9dcd6), line.mul(0.6));
    }
    return C.snowOver(c, p, clamp(float(1.0).sub(wet), 0.0, 1.0).mul(smoothstep(0.1, 0.3, h)));
  })();
  if (DEBUG) mat.colorNode = mix(color(0xff00ff), color(0xffff00), smoothstep(0.0, -0.05, across));
  // (wet mud stays dull; wet sand keeps a little sheen)
  mat.roughnessNode = mix(mix(float(0.93), float(0.82), damp), mix(float(0.75), float(0.5), beach), wet);
  // the fringe's inner edge: broken by noise into the lawn (discarded fragments, so no blend & no sorting)
  const edgeN = noise2D(positionWorld.xz.mul(0.42)).mul(0.6).add(noise2D(positionWorld.xz.mul(1.9).add(3.0)).mul(0.4));
  mat.maskNode = across.negate().add(edgeN.sub(0.5).mul(0.75)).lessThan(0.72);
  // (it lies a couple of centimetres over the ground it covers; pulled a little forward in depth all the same)
  // (matte like the lawn & open ground it meets: weak specular and a capped grazing rise, so the mud never mirrors the
  // sky in white streaks; the wet sand keeps a little gloss)
  const { specularColor, specularColorBlended, specularF90, vec3 } = C.TSL;
  mat.setupSpecular = function () {
    specularColor.assign(vec3(0.025));
    specularColorBlended.assign(vec3(0.025));
    specularF90.assign(mix(float(0.3), float(0.4), wet.mul(beach)));
  };
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -1;
  mat.polygonOffsetUnits = -2;
  mat.side = C.THREE.DoubleSide;
  return mat;
}

function shallowsMaterial() {
  const T = C.TSL;
  const { Fn, attribute, positionWorld, color, mix, smoothstep, float, vec2, vec4, sin, time, pow, texture, mrt, max } = T;
  const noise2D = C.waterEdgeNoise;
  const mat = new C.THREE.MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0, transparent: true, depthWrite: false, side: C.THREE.DoubleSide });
  mat.name = 'ShoreShallows';
  const A = attribute('shore', 'vec4');
  const cls = A.x, along = A.y, t = A.z, dOut = A.w;
  const beach = smoothstep(1.5, 2.0, cls).mul(smoothstep(2.6, 2.4, cls));
  const marsh = smoothstep(2.5, 2.9, cls);
  mat.colorNode = Fn(() => {
    const p = positionWorld.xz;
    const n1 = noise2D(p.mul(0.08)), n2 = noise2D(p.mul(0.45).add(3.3));
    // the bottom through a little water: sand & a green tint on the lake, brown silt in the ponds, dark muck in a marsh
    const sandy = mix(color(0x8fa88a), color(0x4f8a86), t.mul(0.85).add(n1.mul(0.15)));
    const silty = mix(color(0x6a5d36), color(0x47452a), t);
    const base = mix(mix(silty, sandy, beach), color(0x2f2f1e), marsh).toVar();
    // the sun's caustics' glints on a sandy bottom, a faint shimmer
    if (!LOW) {
      const ripple = sin(p.x.mul(1.3).add(time.mul(1.1)).add(n2.mul(6.0))).mul(sin(p.y.mul(1.1).sub(time.mul(0.9)).add(n1.mul(5.0))));
      base.assign(base.mul(ripple.mul(0.06).mul(beach).mul(float(1.0).sub(t)).add(1.0)));
    }
    return base;
  })();
  // the tint fades with the depth (out from the waterline), its far edge broken up so no offset line shows
  const edgeNoise = noise2D(positionWorld.xz.mul(0.13)).mul(0.5).add(noise2D(positionWorld.xz.mul(0.5).add(9.0)).mul(0.25));
  const fade = pow(max(float(1.0).sub(t), 0.0), 1.6).mul(smoothstep(0.0, 0.35, float(1.0).sub(t).add(edgeNoise.sub(0.4))));
  const strength = mix(mix(float(0.62), float(0.8), beach), float(0.7), marsh);
  let opacity = fade.mul(strength);
  if (!LOW) {
    // lapping foam at the waterline on the lake's beaches (a thin broken line that breathes in & out), none on ponds
    const foamTex = C.waterEdgeFoam();
    const lap = sin(time.mul(0.55).add(along.mul(0.045)).add(noise2D(vec2(along.mul(0.08), 3.7)).mul(4.0))).mul(0.5).add(0.5);
    const edge = dOut.sub(lap.mul(0.9).sub(0.3));
    const ft = texture(foamTex, vec2(along.mul(0.09), dOut.mul(0.22).sub(time.mul(0.04)))).r;
    const foam = smoothstep(1.6, 0.0, edge).mul(smoothstep(-0.6, 0.0, edge)).mul(ft).mul(beach).mul(0.75);
    const foamCol = color(0xeef0ec);
    const prev = mat.colorNode;
    mat.colorNode = mix(prev, foamCol, foam.div(max(opacity.add(foam), 0.001)));
    opacity = opacity.add(foam).min(0.95);
  }
  // (a dull film over the water: the water under it keeps the sky's reflection, so the bottom's tint shows from the bank
  // as well as from the air, a little less at grazing angles)
  const { specularColor, specularColorBlended, specularF90, normalize, cameraPosition, clamp } = C.TSL;
  mat.setupSpecular = function () {
    specularColor.assign(C.TSL.vec3(0.02));
    specularColorBlended.assign(C.TSL.vec3(0.02));
    specularF90.assign(0.25);
  };
  const viewUp = clamp(normalize(cameraPosition.sub(positionWorld)).y, 0.0, 1.0);
  opacity = opacity.mul(mix(float(0.7), float(1.0), smoothstep(0.02, 0.4, viewUp)));
  mat.opacityNode = opacity;
  // (pulled a little forward in depth: where the apron dips under the water the two nearly coplanar surfaces would
  // otherwise trade places along the waterline in a dashed line at a distance)
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -4;
  if (DEBUG) { mat.colorNode = color(0x00ffff); mat.opacityNode = float(0.9); }
  // (the water's own reflections & SSR stay: the scene pass's normal & metal/rough targets keep the water's)
  mat.mrtNode = mrt({ normal: vec4(0.0, 0.0, 0.0, 0.0), metalRough: vec4(0.0, 0.0, 0.0, 0.0) });
  return mat;
}

// A clump of reeds & two cattails (1 unit ~ 2 m tall): tapered blades of mixed heights in a loose spiral, leaning
// out, and the cattails' brown heads on their stems. `reed`: [height share, 0 blade / 1 head / 2 stem]
function reedClump() {
  const pos = [], rd = [], idx = [];
  const quad = (a, b, c, d, ra, rb) => { const o = pos.length / 3; pos.push(...a, ...b, ...c, ...d); rd.push(...ra, ...ra, ...rb, ...rb); idx.push(o, o + 1, o + 2, o, o + 2, o + 3); };
  const N = 12;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 * 2.618 + hash1(i * 3.1) * 0.9, r0 = 0.05 + 0.32 * hash1(i * 7.3) ** 0.7, H = 0.7 + 1.3 * hash1(i * 5.9) ** 0.8, lean = 0.1 + 0.55 * hash1(i * 2.3) * (H / 2);
    const cx = Math.cos(a), cz = Math.sin(a), wdt = 0.055 + 0.03 * hash1(i * 1.7), px = -cz * wdt, pz = cx * wdt;
    const bx = cx * r0, bz = cz * r0, tx = bx + cx * lean, tz = bz + cz * lean;
    quad([bx - px, 0, bz - pz], [bx + px, 0, bz + pz], [tx + px * 0.15, H, tz + pz * 0.15], [tx - px * 0.15, H, tz - pz * 0.15], [0, 0], [1, 0]);
  }
  for (let i = 0; i < 2; i++) {
    const a = hash1(i * 11.3) * 6.283, r0 = 0.05 + 0.12 * i, x = Math.cos(a) * r0, z = Math.sin(a) * r0, H = 1.35 + 0.22 * i;
    for (const [ux, uz] of [[Math.cos(a + 1.2), Math.sin(a + 1.2)]]) {
      quad([x - ux * 0.012, 0, z - uz * 0.012], [x + ux * 0.012, 0, z + uz * 0.012], [x + ux * 0.012, H + 0.18, z + uz * 0.012], [x - ux * 0.012, H + 0.18, z - uz * 0.012], [0, 2], [1, 2]);
      quad([x - ux * 0.045, H - 0.28, z - uz * 0.045], [x + ux * 0.045, H - 0.28, z + uz * 0.045], [x + ux * 0.045, H, z + uz * 0.045], [x - ux * 0.045, H, z - uz * 0.045], [0.85, 1], [1, 1]);
    }
  }
  const g = new C.THREE.BufferGeometry();
  g.setAttribute('position', new C.THREE.Float32BufferAttribute(pos, 3));
  const nrm = new Float32Array(pos.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute('normal', new C.THREE.BufferAttribute(nrm, 3)); // (lit from above, like grass: no dark backfaces)
  g.setAttribute('reed', new C.THREE.Float32BufferAttribute(rd, 2));
  g.setIndex(idx);
  return g;
}
function reedMaterial() {
  const { Fn, attribute, positionLocal, positionWorld, color, mix, smoothstep, float, vec3, sin, time, instanceIndex, step } = C.TSL;
  const mat = new C.THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0, side: C.THREE.DoubleSide });
  mat.name = 'ShoreReeds';
  const R = attribute('reed', 'vec2');
  const v = R.x, head = step(0.5, R.y).mul(step(R.y, 1.5)), stem = step(1.5, R.y);
  // the wind: tips sway, each clump on its own phase
  const ph = float(instanceIndex).mul(0.731);
  const sway = sin(time.mul(1.4).add(ph)).mul(0.6).add(sin(time.mul(2.3).add(ph.mul(1.7))).mul(0.4)).mul(v.mul(v)).mul(0.07);
  mat.positionNode = positionLocal.add(vec3(sway, 0.0, sway.mul(0.6)));
  mat.colorNode = Fn(() => {
    const n = C.waterEdgeNoise(positionWorld.xz.mul(0.3));
    const blade = C.seasonalGrass(mix(mix(color(0x3d4a22), color(0x6f7a3a), v), color(0x9c9460), smoothstep(0.75, 1.0, v).mul(n.mul(0.6).add(0.2))));
    return mix(mix(blade, color(0x5b4a2c), stem.mul(0.5)), mix(color(0x4a2f1c), color(0x5e3c22), n), head);
  })();
  return mat;
}

// ---------------------------------------------------------------------------------------------------------------------
// The sand on the ground: OpenStreetMap's beaches as a mask texture per 256 m tile with sand in it (2 m texels), read
// by the ground's materials (sandInto)
// ---------------------------------------------------------------------------------------------------------------------
let sandTiles = null;
const TILE = 256, TEX = 128; // (2 m texels)
function sandMask() {
  if (sandTiles) return sandTiles;
  sandTiles = { list: [], tex: null, index: null };
  if (OFF || !S.beaches.length) return sandTiles;
  const B = C.CITY_BOUNDS;
  const tiles = new Map();
  for (const b of S.beaches) {
    const p = b.p;
    // (only the shore's beaches: a vertex within 12 m of the water; the parks' sand courts & sandpits stay as drawn)
    let wet = false;
    for (let k = 0; k < p.length && !wet; k += 2) for (const [dx, dz] of [[0, 0], [12, 0], [-12, 0], [0, 12], [0, -12]]) if (C.waterAt(p[k] + dx, p[k + 1] + dz)) { wet = true; break; }
    if (!wet) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < p.length; k += 2) { x0 = Math.min(x0, p[k]); x1 = Math.max(x1, p[k]); z0 = Math.min(z0, p[k + 1]); z1 = Math.max(z1, p[k + 1]); }
    if (x1 < B.minX || x0 > B.maxX || z1 < B.minZ || z0 > B.maxZ || !inRollout((x0 + x1) / 2, (z0 + z1) / 2)) continue;
    for (let i = Math.floor(x0 / TILE); i <= Math.floor(x1 / TILE); i++) for (let j = Math.floor(z0 / TILE); j <= Math.floor(z1 / TILE); j++) {
      const k = `${i},${j}`;
      if (!tiles.has(k)) tiles.set(k, { i, j, beaches: [] });
      tiles.get(k).beaches.push(b);
    }
  }
  // each tile's mask, filled first; the tiles the sand misses are dropped
  const masks = [];
  for (const t of tiles.values()) {
    const mk = new Uint8Array(TEX * TEX);
    const wx0 = t.i * TILE, wz0 = t.j * TILE, px = TILE / TEX;
    // scanline fill of each beach (even-odd), at the texel centres
    for (const b of t.beaches) {
      const p = b.p, m = p.length / 2;
      for (let y = 0; y < TEX; y++) {
        const z = wz0 + (y + 0.5) * px, xs = [];
        for (let i = 0, j = m - 1; i < m; j = i++) {
          const az = p[2 * i + 1], bz = p[2 * j + 1];
          if ((az > z) !== (bz > z)) xs.push(p[2 * i] + ((p[2 * j] - p[2 * i]) * (z - az)) / (bz - az));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const xa = Math.max(0, Math.ceil((xs[k] - wx0) / px - 0.5)), xb = Math.min(TEX - 1, Math.floor((xs[k + 1] - wx0) / px - 0.5));
          for (let x = xa; x <= xb; x++) mk[y * TEX + x] = 255;
        }
      }
    }
    if (mk.some((v) => v)) masks.push({ t, m: mk });
  }
  if (!masks.length || masks.length > 254) return sandTiles;
  const list = masks.map(({ t }) => t);
  // the atlas: tiles side by side in rows of 16
  const cols = Math.min(16, list.length), rows = Math.ceil(list.length / cols);
  const W = cols * TEX, H = rows * TEX, data = new Uint8Array(W * H);
  masks.forEach(({ t, m }, n) => {
    t.slot = n;
    const ox = (n % cols) * TEX, oy = Math.floor(n / cols) * TEX;
    for (let y = 0; y < TEX; y++) data.set(m.subarray(y * TEX, (y + 1) * TEX), (oy + y) * W + ox);
  });
  const { THREE } = C;
  const tex = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  // the index: which atlas slot each 1 km tile of the frame takes (0: none), nearest-filtered
  const I0 = Math.floor(B.minX / TILE), J0 = Math.floor(B.minZ / TILE), NI = Math.floor(B.maxX / TILE) - I0 + 1, NJ = Math.floor(B.maxZ / TILE) - J0 + 1;
  const idx = new Uint8Array(NI * NJ);
  for (const t of list) { const i = t.i - I0, j = t.j - J0; if (i >= 0 && j >= 0 && i < NI && j < NJ) idx[j * NI + i] = t.slot + 1; }
  const index = new THREE.DataTexture(idx, NI, NJ, THREE.RedFormat, THREE.UnsignedByteType);
  index.magFilter = index.minFilter = THREE.NearestFilter;
  index.generateMipmaps = false;
  index.needsUpdate = true;
  Object.assign(sandTiles, { list, tex, index, cols, rows, I0, J0, NI, NJ });
  return sandTiles;
}

/** The ground's colour with the beaches' sand over it (the lawn's, the open land's & the street level's materials,
 * before their lying snow) */
function sandInto(ground, wp) {
  const M = sandMask();
  if (!M.tex) return ground;
  const T = C.TSL;
  const { Fn, If, texture, vec2, vec3, float, floor, color, mix, smoothstep, fract } = T;
  const noise2D = C.waterEdgeNoise;
  return Fn(() => {
    const out = vec3(ground).toVar();
    const ti = wp.div(TILE);
    const slotUV = floor(ti).sub(vec2(M.I0, M.J0)).add(0.5).div(vec2(M.NI, M.NJ));
    const slot = texture(M.index, slotUV).r.mul(255.0).add(0.5).floor().toVar();
    If(slot.greaterThan(0.5), () => {
      const s = slot.sub(1.0);
      const col = s.mod(M.cols), row = floor(s.div(M.cols));
      // (half a texel in from the tile's border: the linear filter never reads a neighbour tile)
      const f = fract(ti).mul((TEX - 1) / TEX).add(0.5 / TEX);
      const uv = vec2(col.add(f.x).div(M.cols), row.add(f.y).div(M.rows));
      const m = texture(M.tex, uv).r;
      const n1 = noise2D(wp.mul(0.21)), n2 = noise2D(wp.mul(1.3).add(4.1)), n3 = noise2D(wp.mul(6.0).add(2.2));
      // an irregular edge: the mask's soft 2 m ramp cut by noise, with grass tufts a little way in
      const cover = smoothstep(0.35, 0.65, m.add(n1.sub(0.5).mul(0.55)).add(n2.sub(0.5).mul(0.25)));
      const sand = sandColour(wp);
      out.assign(mix(out, sand, cover));
    });
    return out;
  })();
}

// ---------------------------------------------------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------------------------------------------------
// (the steps' generators run to the end at once, or a few milliseconds a turn: buildWaterEdges)
const drain = (gen) => { for (;;) { const r = gen.next(); if (r.done) return r.value; } };
async function drainSliced(gen, sliceMs) {
  let t = performance.now();
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
    if (performance.now() - t > sliceMs) { await new Promise((ok) => setTimeout(ok, 0)); t = performance.now(); }
  }
}
/** The natural shores: runs of samples { x, z, nx, nz (towards the water), cls, top, s (m along) } */
const naturalShores = () => drain(naturalShoresSteps());
const buildGeometry = (runs) => drain(buildGeometrySteps(runs));

/**
 * Builds the water edges into the scene. The shores are classified & their meshes built after the city is on screen, a
 * few milliseconds a turn (about half a second of work on the M4 in all): the returned handle's `ready` resolves when
 * they are in. `sync: true` builds them at once (tests, tools)
 */
function buildWaterEdges(scene, { sync = false } = {}) {
  if (OFF) return null;
  const t0 = performance.now();
  const handle = { group: null, info: null, runs: null, update() {}, ready: null };
  const finish = (runs, t1, built) => {
    const { cells, stats } = built;
    const { THREE } = C;
    const group = new THREE.Group();
    group.name = 'WaterEdges';
    const apronMat = apronMaterial();
    const shallowMat = LOW ? null : shallowsMaterial();
    let tris = 0;
    for (const c of cells) {
      if (c.apron) {
        const m = new THREE.Mesh(c.apron, apronMat);
        m.name = 'ShoreApron';
        m.receiveShadow = true;
        group.add(m);
        tris += c.apron.index.count / 3;
      }
      if (c.shallow && shallowMat) {
        const m = new THREE.Mesh(c.shallow, shallowMat);
        m.name = 'ShoreShallows';
        m.renderOrder = 2;
        group.add(m);
        tris += c.shallow.index.count / 3;
      }
    }
    // the reeds: one instanced clump per cell
    let reedCount = 0;
    // (a budget of clumps over the whole map: the bigger map's ravine ponds would otherwise double them; thinned evenly)
    const allReeds = cells.reduce((t, c) => t + c.reeds.length, 0), keep = Math.min(1, REED_BUDGET / Math.max(1, allReeds));
    if (keep < 1) for (const c of cells) c.reeds = c.reeds.filter((r) => hash1(r[0] * 0.37 + r[2] * 0.11) < keep);
    if (!LOW) {
      const reedGeo = reedClump(), reedMat = reedMaterial(), M4 = new THREE.Matrix4(), Qn = new THREE.Quaternion(), V = new THREE.Vector3(), Sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
      for (const c of cells) {
        if (!c.reeds.length) continue;
        const im = new THREE.InstancedMesh(reedGeo, reedMat, c.reeds.length);
        c.reeds.forEach(([x, y, z, sc, rot], i) => {
          Qn.setFromAxisAngle(up, rot);
          im.setMatrixAt(i, M4.compose(V.set(x, y, z), Qn, Sc.set(sc, sc * (0.85 + 0.3 * hash1(x + z)), sc)));
        });
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.name = 'ShoreReeds';
        im.receiveShadow = true;
        group.add(im);
        reedCount += c.reeds.length;
        tris += (reedGeo.index ? reedGeo.index.count : reedGeo.attributes.position.count) / 3 * c.reeds.length;
      }
    }
    scene.add(group);
    // far cells hidden: the reeds beyond 450 m, the shallows beyond 1.4 km, the apron beyond 3 km (sub-pixel there; the old
    // bank stands in)
    // (in the bigger map's band, no further than the band's own city: beyond FAR_BAND.distance scene-culling.js hides
    // its ground & lawns and the terrain's floor stands in, 15 cm under the water, where an apron's top would float)
    const BAND = C.FAR_BAND;
    const far = group.children.map((m) => {
      const b = m.boundingSphere || m.geometry.boundingSphere;
      let max = m.name === 'ShoreShallows' ? 1400 : m.name === 'ShoreReeds' ? 450 : 3000;
      const band = !!(BAND && !BAND.inCore(b.center.x, b.center.z));
      if (band) max = Math.min(max, BAND.distance);
      return { m, c: b.center, r: b.radius, max, band };
    });
    let lastX = Infinity, lastZ = Infinity;
    const update = (pos) => {
      if (!pos || Math.hypot(pos.x - lastX, pos.z - lastZ) < 25) return;
      lastX = pos.x; lastZ = pos.z;
      for (const f of far) f.m.visible = Math.hypot(f.c.x - pos.x, f.c.z - pos.z) - f.r < f.max * (f.band ? 1 : Math.max(1, pos.y / 300));
    };
    const info = { runs: stats.runs, metres: Math.round(stats.length), bank: Math.round(stats.byClass[BANK]), beach: Math.round(stats.byClass[BEACH]), marsh: Math.round(stats.byClass[MARSH]), reeds: reedCount, meshes: group.children.length, triangles: tris, classifyMs: Math.round(t1 - t0), ms: Math.round(performance.now() - t0), sync };
    console.info(`[water-edges] ${info.metres} m of natural shore (${info.beach} m beach, ${info.bank} m bank, ${info.marsh} m marsh) in ${info.runs} runs, ${info.reeds} reed clumps: ${info.meshes} meshes, ${info.triangles} triangles, ${info.ms} ms${sync ? '' : ' (sliced, after the city is on screen)'}, classified in ${info.classifyMs} ms`);
    C.waterEdgesInfo = info;
    return Object.assign(handle, { group, info, runs, update });
  };
  if (sync) {
    const runs = naturalShores(), t1 = performance.now();
    finish(runs, t1, buildGeometry(runs));
    handle.ready = Promise.resolve(handle);
    return handle;
  }
  handle.ready = (async () => {
    const runs = await drainSliced(naturalShoresSteps(), 6);
    const t1 = performance.now();
    return finish(runs, t1, await drainSliced(buildGeometrySteps(runs), 6));
  })();
  C.waterEdgesReady = handle.ready;
  return handle;
}

// (noise & foam texture, shared; the noise is tsl-materials.js's value noise, re-made here as it keeps its own private)
let foamTex = null;
function waterEdgeFoam() {
  if (foamTex) return foamTex;
  foamTex = new C.THREE.TextureLoader().load('./assets/water/foam1.png');
  foamTex.wrapS = foamTex.wrapT = C.THREE.RepeatWrapping;
  foamTex.colorSpace = C.THREE.NoColorSpace;
  return foamTex;
}
if (!C.waterEdgeNoise && C.TSL) {
  const { Fn, vec2, float, floor, fract, sin, dot, mix } = C.TSL;
  const hash2D = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));
  C.waterEdgeNoise = Fn(([p]) => {
    const pv = vec2(p).toVar(), i = floor(pv).toVar(), f = fract(pv).toVar();
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0))).toVar();
    return mix(mix(hash2D(i), hash2D(i.add(vec2(1.0, 0.0))), u.x), mix(hash2D(i.add(vec2(0.0, 1.0))), hash2D(i.add(vec2(1.0, 1.0))), u.x), u.y);
  });
}

Object.assign(C, { buildWaterEdges, waterEdgeFoam, waterEdges: { on: !OFF, naturalShores, sandInto, sandMask, classify, CLASS_NAMES, HARD_ZONES, ROLLOUT } });
})();
