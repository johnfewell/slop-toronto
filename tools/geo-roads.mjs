// Part 2: Toronto's roads from OpenStreetMap, in the world frame.
// - Every highway=* way that carries traffic, with its class, carriageway width, travel lanes and direction
// - Grade separation: a bridge (or layer > 0) way that actually crosses another road, or a heavy-rail track at grade
//   (Spadina, Bathurst, Strachan, Dufferin, Dundas St W... over the rail corridor), in plan is a flyover, raised on a
//   deck; the roads it joins at either end climb to it on ramps (5.5% grade). Tunnels under roads are dropped. (The
//   streets the railway crosses over, York, Bay, Yonge, Jarvis, King & Queen St W..., stay on the ground: the tracks
//   climb over them, tools/geo-rails.mjs.)
// - The street graph (js/road-network.js builds lanes, junctions & turns from it) with the heights of the decks & ramps,
//   the decks & ramps themselves (city-grid.js builds them), and every road for the maps & labels
import { toWorld, rdp, log, load, osmRoads } from './geo-base.mjs';

// Detailed city (world frame, metres): the Humber to Cherry Beach, the lake to Bloor
export const DETAIL = { x0: -7900, x1: 3700, z0: -3000, z1: 3600 };
export const inDetail = (x, z, m = 0) => x > DETAIL.x0 - m && x < DETAIL.x1 + m && z > DETAIL.z0 - m && z < DETAIL.z1 + m;

// Unambiguous misspellings in the map data (the street signs read these names)
const NAME_FIX = {
  'Olusegun Obasajo Way': 'Olusegun Obasanjo Way',
  'Herbert Maacaulay Way': 'Herbert Macaulay Way',
  'Indepedence Avenue': 'Independence Avenue',
  'Tafa Balewa Way': 'Tafawa Balewa Way',
  'Jistice James Ogebe Street': 'Justice James Ogebe Street',
  'Bernin Kebbi Crescent': 'Birnin Kebbi Crescent',
  'Emeka Anaoku Street': 'Emeka Anyaoku Street',
  'Dar es Salam Crescent': 'Dar es Salaam Crescent',
  'IBB Way ( Ibrahim Badamasi Babangida )': 'IBB Way',
  'P.O.W MAFEMI CRESCENT': 'P.O.W. Mafemi Crescent',
  '16 P.O.W MAFEMI CRESCENT': 'P.O.W. Mafemi Crescent',
  '48 Anthony Enahoro Street': 'Anthony Enahoro Street',
  'RENAO STREET': 'Renao Street'
};
export function cleanName(n) {
  if (!n) return '';
  n = NAME_FIX[n] || n;
  return n.replace(/\b(street|crescent|close|avenue|road|way)$/, (w) => w[0].toUpperCase() + w.slice(1)).trim();
}

// Road classes: rank (importance), default travel lanes one-way / two-way, kerb-side allowance (m)
const CLASS = {
  motorway: [6, 3, 6, 1.5], trunk: [5, 3, 4, 1.2], primary: [4, 3, 4, 1.0], secondary: [3, 2, 2, 1.0],
  tertiary: [2, 2, 2, 0.8], unclassified: [1, 1, 2, 0.4], residential: [1, 1, 2, 0.4], living_street: [0, 1, 2, 0.4],
  motorway_link: [5, 1, 2, 1.0], trunk_link: [4, 1, 2, 0.8], primary_link: [3, 1, 2, 0.8], secondary_link: [2, 1, 2, 0.6],
  tertiary_link: [1, 1, 2, 0.6], service: [0, 1, 1, 0.6]
};
const LANE_W = 3.5;
const DECK_H = 7.5; // deck height per layer (m): 5.5 m clearance + structure
const RAMP_GRADE = 0.055;

// ---------------------------------------------------------------------------------------------------------------------
// Ways
// ---------------------------------------------------------------------------------------------------------------------
const num = (v) => {
  const f = parseFloat(String(v || '').replace(',', '.'));
  return Number.isFinite(f) ? f : null;
};
export const ways = [];
for (const e of osmRoads.elements) {
  const t = e.tags || {};
  const cls = t.highway;
  if (!CLASS[cls] || !e.geometry || e.geometry.length < 2) continue;
  if (cls === 'service' && /^(parking_aisle|driveway|drive-through|emergency_access)$/.test(t.service || '')) continue;
  if (t.access === 'no' && cls === 'service') continue;
  if (t.area === 'yes') continue;
  const [rank, l1, l2, kerb] = CLASS[cls];
  let dir = 0;
  if (/^(yes|true|1)$/.test(t.oneway || '')) dir = 1;
  else if (t.oneway === '-1') dir = -1;
  else if (t.oneway !== 'no' && (/^(roundabout|circular)$/.test(t.junction || '') || cls === 'motorway' || cls === 'motorway_link')) dir = 1;
  let lanes = num(t.lanes);
  if (!lanes || lanes < 1 || lanes > 8) lanes = dir ? l1 : l2;
  lanes = Math.round(lanes);
  let w = num(t.width);
  if (!w || w < 3 || w > 40) w = cls === 'service' ? 5.0 : lanes * LANE_W + kerb;
  const pts = e.geometry.map((g) => toWorld(g.lon, g.lat));
  const bridge = !!t.bridge && t.bridge !== 'no';
  const tunnel = !!t.tunnel && t.tunnel !== 'no' && t.tunnel !== 'culvert';
  const layer = Math.round(num(t.layer) || 0);
  ways.push({ id: e.id, nodes: e.nodes, pts, cls, rank, dir, lanes, w: Math.round(w * 10) / 10, name: cleanName(t.name), ref: t.ref || '', bridge, tunnel, layer, viaduct: t.bridge === 'viaduct', elevated: false, under: false });
}
log(`${ways.length} road ways`);

// ---------------------------------------------------------------------------------------------------------------------
// Grade separation
// ---------------------------------------------------------------------------------------------------------------------
const atGrade = (w) => !w.bridge && !w.tunnel && w.layer === 0;
const SEG_CELL = 50;
const segGrid = new Map();
const segKey = (ix, iz) => ix * 1000003 + iz;
for (const w of ways) {
  if (!atGrade(w)) continue;
  for (let i = 0; i + 1 < w.pts.length; i++) {
    const [ax, az] = w.pts[i], [bx, bz] = w.pts[i + 1];
    for (let ix = Math.floor(Math.min(ax, bx) / SEG_CELL); ix <= Math.floor(Math.max(ax, bx) / SEG_CELL); ix++) {
      for (let iz = Math.floor(Math.min(az, bz) / SEG_CELL); iz <= Math.floor(Math.max(az, bz) / SEG_CELL); iz++) {
        const k = segKey(ix, iz);
        if (!segGrid.has(k)) segGrid.set(k, []);
        segGrid.get(k).push([w, i]);
      }
    }
  }
}
// Proper crossing of segments p0p1 and q0q1 (not at either end)
function crossT(p0, p1, q0, q1) {
  const rx = p1[0] - p0[0], rz = p1[1] - p0[1], sx = q1[0] - q0[0], sz = q1[1] - q0[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return -1;
  const t = ((q0[0] - p0[0]) * sz - (q0[1] - p0[1]) * sx) / den;
  const u = ((q0[0] - p0[0]) * rz - (q0[1] - p0[1]) * rx) / den;
  return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999 ? t : -1;
}
function crossesRoad(w) {
  const own = new Set(w.nodes);
  for (let i = 0; i + 1 < w.pts.length; i++) {
    const p0 = w.pts[i], p1 = w.pts[i + 1];
    const seen = new Set();
    for (let ix = Math.floor(Math.min(p0[0], p1[0]) / SEG_CELL); ix <= Math.floor(Math.max(p0[0], p1[0]) / SEG_CELL); ix++) {
      for (let iz = Math.floor(Math.min(p0[1], p1[1]) / SEG_CELL); iz <= Math.floor(Math.max(p0[1], p1[1]) / SEG_CELL); iz++) {
        for (const [o, j] of segGrid.get(segKey(ix, iz)) || []) {
          if (o === w || seen.has(o.id * 4096 + j)) continue;
          seen.add(o.id * 4096 + j);
          // roads that meet the bridge at a node of its own join it there (no crossing)
          if (own.has(o.nodes[j]) || own.has(o.nodes[j + 1])) continue;
          if (crossT(p0, p1, o.pts[j], o.pts[j + 1]) >= 0) return true;
        }
      }
    }
  }
  return false;
}
// Road cuts (underpasses): streets the city takes down under the railway in a cutting (John, 2026-10-25: Strachan
// Avenue at both its crossings, the Kitchener line & the Lakeshore West; OSM maps it on bridges over them). The named
// ways inside the box stay on the ground (their mapped bridges too) and the street dips: see the profile below, after
// the ramps. `depth`: the floor under the tracks, at its full depth the tracks stay at grade (RAIL_CLEAR in
// tools/geo-rails.mjs); ramps no steeper than `maxGrade`, no gentler than `minGrade`, ending `clear` metres short of the
// cross streets' junctions, which stay at their own grade. Where that leaves too little room the cut is shallower and
// tools/geo-rails.mjs lifts the tracks the rest of the way.
// `under: 'subway'` (John, 2026-10-25: Rosedale Valley Road, the valley the flat city leaves out): the street dips under
// the subway's covered bridge instead (OpenStreetMap railway=subway, covered & bridge), which js/subway.js then sets
// down on the ground over the cut as a covered concrete box; `box`: the box's half width, so the floor runs on under
// all of it however skewed the crossing. `follow`: the cut follows the street's own centreline (a curving street: its
// walls stay at the street's sides), not one straight axis. `bank`: grassed banks instead of walls (out per metre up;
// js/city-config.js cuts them short at whatever stands in their way).
const SIDEWALK_W = 4.6; // (tools/geo-blocks.mjs SIDEWALK: the curb to the property line)
const ROAD_CUTS = [
  { name: 'Strachan Avenue', x0: -2600, x1: -2460, z0: -330, z1: 240, depth: 6.2, maxGrade: 0.1, minGrade: 0.05, clear: 16 },
  { name: 'Rosedale Valley Road', x0: 1520, x1: 1760, z0: -2760, z1: -2600, depth: 7.2, maxGrade: 0.09, minGrade: 0.08, clear: 16, under: 'subway', box: 5.4, follow: true, bank: 2 }
];
for (const w of ways) {
  const u = ROAD_CUTS.find((o) => o.name === w.name && w.pts.some(([x, z]) => x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1));
  if (!u) continue;
  w.cut = u;
  if (!u.under) w.railUnder = true; // (tools/geo-rails.mjs: the railway passes over it)
  if (w.bridge) {
    w.bridge = false;
    w.layer = 0;
  }
}
log(`road cuts: ${ways.filter((w) => w.cut).length} ways of ${ROAD_CUTS.map((o) => o.name).join(', ')} go under the tracks`);

// The heavy-rail tracks (railway=rail, not in a tunnel; osm_rails.json from tools/fetch-osm.mjs ONLY=rails). Their
// node ids come from another run of the fetch than the roads', so a level crossing (a node shared with a road) is
// found by its coordinates
const railKey = (x, z) => `${Math.round(x * 100)},${Math.round(z * 100)}`;
const railGrid = new Map();
const railAt = new Set();
const subwayCovered = []; // the subway's covered bridges' segments [[x, z], [x, z]] (road cuts `under: 'subway'`)
{
  let elements = [];
  try { elements = load('osm_rails.json').elements; } catch { /* no rails: no rail bridges */ }
  for (const e of elements) {
    const t = e.tags || {};
    if (e.type === 'way' && e.geometry && t.railway === 'subway' && t.covered === 'yes' && t.bridge && t.bridge !== 'no' && t.bridge !== 'viaduct') {
      const P = e.geometry.map((g) => toWorld(g.lon, g.lat));
      for (let i = 0; i + 1 < P.length; i++) subwayCovered.push([P[i], P[i + 1]]);
    }
    if (e.type !== 'way' || !e.geometry || t.railway !== 'rail' || (t.tunnel && t.tunnel !== 'no')) continue;
    const r = { bridge: !!t.bridge && t.bridge !== 'no', layer: Math.round(num(t.layer) || 0), pts: e.geometry.map((g) => toWorld(g.lon, g.lat)) };
    for (const [x, z] of r.pts) railAt.add(railKey(x, z));
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      for (let ix = Math.floor(Math.min(ax, bx) / SEG_CELL); ix <= Math.floor(Math.max(ax, bx) / SEG_CELL); ix++) {
        for (let iz = Math.floor(Math.min(az, bz) / SEG_CELL); iz <= Math.floor(Math.max(az, bz) / SEG_CELL); iz++) {
          const k = segKey(ix, iz);
          if (!railGrid.has(k)) railGrid.set(k, []);
          railGrid.get(k).push([r, i]);
        }
      }
    }
  }
}
// A road bridge passing over a track below it (a track at grade, or on a lower layer), not meeting it at a level crossing
function crossesRail(w) {
  for (let i = 0; i + 1 < w.pts.length; i++) {
    const p0 = w.pts[i], p1 = w.pts[i + 1];
    if (railAt.has(railKey(...p0)) || railAt.has(railKey(...p1))) continue;
    for (let ix = Math.floor(Math.min(p0[0], p1[0]) / SEG_CELL); ix <= Math.floor(Math.max(p0[0], p1[0]) / SEG_CELL); ix++) {
      for (let iz = Math.floor(Math.min(p0[1], p1[1]) / SEG_CELL); iz <= Math.floor(Math.max(p0[1], p1[1]) / SEG_CELL); iz++) {
        for (const [r, j] of railGrid.get(segKey(ix, iz)) || []) {
          if (r.bridge && r.layer >= w.layer) continue;
          if (crossT(p0, p1, r.pts[j], r.pts[j + 1]) >= 0) return true;
        }
      }
    }
  }
  return false;
}
let nElev = 0, nUnder = 0, nRail = 0;
for (const w of ways) {
  if ((w.bridge || w.layer > 0) && crossesRoad(w)) { w.elevated = true; nElev++; }
  else if ((w.bridge || w.layer > 0) && crossesRail(w)) { w.elevated = true; nElev++; nRail++; }
  else if ((w.tunnel || w.layer < 0) && crossesRoad(w)) { w.under = true; nUnder++; }
}
log(`${nElev} flyover ways (bridges crossing roads, ${nRail} of them over the railway alone), ${nUnder} underpasses dropped`);

// Toronto's Gardiner Expressway stands on one continuous viaduct from east of Dufferin Street to the Don Roadway, about 12 m up.
// OSM's layers along it (1-4) are stacking order, not height, and its stretches between the tagged bridges sit at
// grade: taken literally they make a 22.5 m roller coaster that drops to the ground and climbs again. Every Gardiner
// way between the two ends goes on the viaduct, and the elevated slip roads joining it (on through the elevated ways
// they join in turn) meet it at its height; past either end it ramps down to the ground as any deck does.
// (Its west end: the mapped viaduct begins east of Dufferin St, x -3513; Dufferin's bridge crosses the rail corridor and
// the expressway still at grade, so the viaduct's ramp down must end before Dufferin.)
const GARDINER = { name: 'Gardiner Expressway', x0: -3600, x1: 2950, h: 12 };
const midX = (w) => w.pts.reduce((a, [x]) => a + x, 0) / w.pts.length;
const viaduct = [];
for (const w of ways) {
  if (w.name !== GARDINER.name || w.cls !== 'motorway' || w.tunnel) continue;
  const x = midX(w);
  if (x < GARDINER.x0 || x > GARDINER.x1) continue;
  w.elevated = true;
  w.under = false;
  w.deckH = GARDINER.h;
  viaduct.push(w);
}
{
  const waysAt = new Map();
  for (const w of ways) for (const n of w.nodes) (waysAt.get(n) || waysAt.set(n, []).get(n)).push(w);
  const queue = [...viaduct];
  let joined = 0;
  while (queue.length) {
    const w = queue.pop();
    for (const n of w.nodes) {
      for (const o of waysAt.get(n) || []) {
        if (o.deckH || !o.elevated) continue;
        o.deckH = GARDINER.h;
        joined++;
        queue.push(o);
      }
    }
  }
  log(`Gardiner viaduct: ${viaduct.length} ways at ${GARDINER.h} m, ${joined} elevated ways joining it levelled to it`);
}

// OSM's layers are stacking order too: Dufferin St's bridge (layer 4) passes over the rail corridor and the Gardiner
// beside it at grade, one deck up, not four (30 m: it dragged the Exhibition's streets up to 24 m). A bridge that
// crosses no other flyover is one deck up; the viaducts (bridge=viaduct: Bloor's over the Don) keep their layers.
{
  const elevGrid = new Map();
  for (const w of ways) {
    if (!w.elevated) continue;
    for (let i = 0; i + 1 < w.pts.length; i++) {
      const [ax, az] = w.pts[i], [bx, bz] = w.pts[i + 1];
      for (let ix = Math.floor(Math.min(ax, bx) / SEG_CELL); ix <= Math.floor(Math.max(ax, bx) / SEG_CELL); ix++) {
        for (let iz = Math.floor(Math.min(az, bz) / SEG_CELL); iz <= Math.floor(Math.max(az, bz) / SEG_CELL); iz++) {
          const k = segKey(ix, iz);
          if (!elevGrid.has(k)) elevGrid.set(k, []);
          elevGrid.get(k).push([w, i]);
        }
      }
    }
  }
  const overFlyover = (w) => {
    const own = new Set(w.nodes);
    for (let i = 0; i + 1 < w.pts.length; i++) {
      const p0 = w.pts[i], p1 = w.pts[i + 1];
      for (let ix = Math.floor(Math.min(p0[0], p1[0]) / SEG_CELL); ix <= Math.floor(Math.max(p0[0], p1[0]) / SEG_CELL); ix++) {
        for (let iz = Math.floor(Math.min(p0[1], p1[1]) / SEG_CELL); iz <= Math.floor(Math.max(p0[1], p1[1]) / SEG_CELL); iz++) {
          for (const [o, j] of elevGrid.get(segKey(ix, iz)) || []) {
            if (o === w || own.has(o.nodes[j]) || own.has(o.nodes[j + 1])) continue;
            if (crossT(p0, p1, o.pts[j], o.pts[j + 1]) >= 0) return true;
          }
        }
      }
    }
    return false;
  };
  const flat = [];
  for (const w of ways) {
    if (!w.elevated || w.deckH || w.layer < 2 || w.viaduct || overFlyover(w)) continue;
    w.layer = 1;
    flat.push(w.name || w.cls);
  }
  log(`${flat.length} bridges mapped above layer 1 cross no other flyover: one deck up (${[...new Set(flat)].join(', ')})`);
}

// Per-vertex heights: decks at DECK_H per layer (the Gardiner's at its own), ramps down the roads continuing straight on
// from their ends
const deckBase = (w) => (w.elevated ? w.deckH || DECK_H * Math.max(1, w.layer) : 0);
const byNode = new Map(); // OSM node -> [{ way, index }]
for (const w of ways) {
  w.nodes.forEach((n, i) => {
    if (!byNode.has(n)) byNode.set(n, []);
    byNode.get(n).push({ w, i });
  });
}
for (const w of ways) {
  w.h = new Array(w.pts.length).fill(deckBase(w));
}
const unit = (a, b) => {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
};
// Ramp down from height h0 along way w starting at vertex i0 going in direction step (+1 / -1), `left` metres of ramp
function rampAlong(w, i0, step, h0, left, depth) {
  w.h[i0] = Math.max(w.h[i0], h0);
  // densify: insert a vertex where the ramp ends, so the deck stops exactly there
  let i = i0;
  let s = 0;
  const run = (h0 - deckBase(w)) / RAMP_GRADE;
  while (true) {
    const j = i + step;
    if (j < 0 || j >= w.pts.length) break;
    const L = Math.hypot(w.pts[j][0] - w.pts[i][0], w.pts[j][1] - w.pts[i][1]);
    if (s + L >= left) {
      const t = (left - s) / L;
      const p = [w.pts[i][0] + (w.pts[j][0] - w.pts[i][0]) * t, w.pts[i][1] + (w.pts[j][1] - w.pts[i][1]) * t];
      const at = step > 0 ? j : i;
      w.pts.splice(at, 0, p);
      w.nodes.splice(at, 0, null);
      w.h.splice(at, 0, deckBase(w));
      return;
    }
    s += L;
    const base = deckBase(w);
    const hj = base + (h0 - base) * Math.max(0, 1 - (run - left + s) / run);
    w.h[j] = Math.max(w.h[j], hj);
    i = j;
  }
  // the way ended before the ramp did: carry on into the road continuing straight from its far end
  if (depth > 0) {
    const end = w.nodes[i];
    const dIn = unit(w.pts[i - step], w.pts[i]);
    const next = continuation(end, w, dIn);
    if (next) rampAlong(next.w, next.i, next.step, w.h[i], left - s, depth - 1);
  }
}
// The at-grade way leaving `node` (not `from`) most nearly straight on along d, within 40°
function continuation(node, from, d) {
  let best = null, bd = Math.cos((40 * Math.PI) / 180);
  for (const { w } of byNode.get(node) || []) {
    if (w === from || w.elevated || w.under) continue;
    const i = w.nodes.indexOf(node); // (ramps insert vertices: the index noted in byNode may be stale)
    for (const step of [1, -1]) {
      const j = i + step;
      if (j < 0 || j >= w.pts.length) continue;
      const u = unit(w.pts[i], w.pts[j]);
      const dot = u[0] * d[0] + u[1] * d[1];
      if (dot > bd) { bd = dot; best = { w, i, step }; }
    }
  }
  return best;
}
// Ramps: wherever roads meet at a node at different heights (a deck's end; a slip road joining partway up a ramp; a
// deck joining a lower deck), each lower road climbs to the highest one there along its own ways, on into the road
// straight ahead where a way is shorter than the ramp; repeated until every junction is level
for (let pass = 0; pass < 8; pass++) {
  let changed = false;
  for (const [node, occ] of byNode) {
    if (occ.length < 2) continue;
    const live = occ.filter((o) => !o.w.under).map((o) => ({ w: o.w, k: o.w.nodes.indexOf(node) }));
    let H = 0;
    for (const { w, k } of live) H = Math.max(H, w.h[k]);
    if (H < 0.3) continue;
    for (const { w, k } of live) {
      if (w.h[k] >= H - 0.3) continue;
      changed = true;
      for (const step of [1, -1]) {
        if (k + step < 0 || k + step >= w.pts.length) continue;
        rampAlong(w, w.nodes.indexOf(node), step, H, (H - deckBase(w)) / RAMP_GRADE, 6);
      }
      w.h[w.nodes.indexOf(node)] = H;
    }
  }
  if (!changed) break;
}

// The road cuts' profiles. Along each named street's axis (its points' principal direction, s metres along it): the
// railway's crossings, grouped (a corridor's parallel tracks); each group's floor runs under its tracks, 3.5 m past the
// outer ones either way, with a ramp up to street level at either end clear of the nearest cross street's junction.
// The ways get a vertex at every break of slope (where tools/geo-roads.mjs's street graph puts a node, so the traffic
// follows the profile) and their heights (negative: below street level). The cut's axis (js/city-config.js reads it as
// a polyline) is the straight line through the breaks, or with `follow` the street's own centreline, every vertex.
export const roadCutOut = []; // [name, half width (carriageways & sidewalks), [x, z, h, ...] the axis (polyline), bank?]
for (const C of ROAD_CUTS) {
  const W = ways.filter((w) => w.cut === C);
  if (!W.length) continue;
  const P = W.flatMap((w) => w.pts.filter(([x, z]) => x > C.x0 && x < C.x1 && z > C.z0 && z < C.z1));
  const cx = P.reduce((t, p) => t + p[0], 0) / P.length, cz = P.reduce((t, p) => t + p[1], 0) / P.length;
  let sxx = 0, sxz = 0, szz = 0;
  for (const [x, z] of P) { sxx += (x - cx) ** 2; sxz += (x - cx) * (z - cz); szz += (z - cz) ** 2; }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const ux = Math.cos(ang), uz = Math.sin(ang);
  const along = ([x, z]) => (x - cx) * ux + (z - cz) * uz;
  const across = ([x, z]) => -(x - cx) * uz + (z - cz) * ux;
  // the railway's crossings (or the subway's covered bridge's: then the floor runs on under the whole box, `pad` either
  // side of its track, the more the more skewed the crossing)
  const hits = [];
  let pad = 3.5;
  for (const w of W) {
    for (let i = 0; i + 1 < w.pts.length; i++) {
      const p0 = w.pts[i], p1 = w.pts[i + 1];
      if (C.under === 'subway') {
        for (const [q0, q1] of subwayCovered) {
          const t = crossT(p0, p1, q0, q1);
          if (t < 0) continue;
          hits.push(along([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t]));
          const a = [p1[0] - p0[0], p1[1] - p0[1]], b = [q1[0] - q0[0], q1[1] - q0[1]];
          const sin = Math.abs(a[0] * b[1] - a[1] * b[0]) / (Math.hypot(...a) * Math.hypot(...b) || 1);
          pad = Math.max(pad, (C.box + 1.5) / Math.max(sin, 0.3));
        }
        continue;
      }
      for (let ix = Math.floor(Math.min(p0[0], p1[0]) / SEG_CELL); ix <= Math.floor(Math.max(p0[0], p1[0]) / SEG_CELL); ix++) {
        for (let iz = Math.floor(Math.min(p0[1], p1[1]) / SEG_CELL); iz <= Math.floor(Math.max(p0[1], p1[1]) / SEG_CELL); iz++) {
          for (const [r, j] of railGrid.get(segKey(ix, iz)) || []) {
            const t = crossT(p0, p1, r.pts[j], r.pts[j + 1]);
            if (t >= 0) hits.push(along([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t]));
          }
        }
      }
    }
  }
  hits.sort((a, b) => a - b);
  const groups = [];
  for (const h of hits) {
    if (groups.length && h - groups[groups.length - 1][1] < 40) groups[groups.length - 1][1] = h;
    else groups.push([h, h]);
  }
  // the cross streets' junctions: a node the street shares with a road of another name (or an unnamed one, not a lane)
  const junctions = [];
  for (const w of W) {
    w.nodes.forEach((n, i) => {
      if (n === null) return;
      if ((byNode.get(n) || []).some((o) => o.w.cut !== C && o.w.cls !== 'service' && !o.w.under)) junctions.push(along(w.pts[i]));
    });
  }
  for (const [a, b] of groups) {
    const f0 = a - pad, f1 = b + pad;
    const north = Math.max(-Infinity, ...junctions.filter((j) => j < f0)) + C.clear;
    const south = Math.min(Infinity, ...junctions.filter((j) => j > f1)) - C.clear;
    const D = Math.min(C.depth, C.maxGrade * (f0 - north), C.maxGrade * (south - f1));
    if (!(D > 0.5)) {
      log(`road cut ${C.name} at ${Math.round(a)}..${Math.round(b)}: no room for it between the junctions`);
      continue;
    }
    const r0 = f0 - D / Math.max(C.minGrade, D / (f0 - north)), r1 = f1 + D / Math.max(C.minGrade, D / (south - f1));
    const prof = [[r0, 0], [f0, -D], [f1, -D], [r1, 0]];
    const hAt = (t) => {
      if (t <= r0 || t >= r1) return 0;
      for (let k = 0; k + 1 < prof.length; k++) {
        const [s0, h0] = prof[k], [s1, h1] = prof[k + 1];
        if (t <= s1) return h0 + ((h1 - h0) * (t - s0)) / (s1 - s0 || 1);
      }
      return 0;
    };
    let half = 0;
    for (const w of W) {
      // a vertex at every break of slope, then the heights
      for (const [t] of prof) {
        for (let i = 0; i + 1 < w.pts.length; i++) {
          const ta = along(w.pts[i]), tb = along(w.pts[i + 1]);
          if ((ta - t) * (tb - t) >= 0 || Math.abs(ta - t) < 0.5 || Math.abs(tb - t) < 0.5) continue;
          const f = (t - ta) / (tb - ta);
          const p = [w.pts[i][0] + (w.pts[i + 1][0] - w.pts[i][0]) * f, w.pts[i][1] + (w.pts[i + 1][1] - w.pts[i][1]) * f];
          w.pts.splice(i + 1, 0, p);
          w.nodes.splice(i + 1, 0, null);
          w.h.splice(i + 1, 0, 0);
          (w.cutBreaks || (w.cutBreaks = new Set())).add(p);
          break;
        }
      }
      w.pts.forEach((p, i) => {
        const t = along(p);
        if (t < r0 || t > r1) return;
        // (a vertex within half a metre of a break is the break; following a curving street, every vertex on the ramps
        // is one too: the street graph's nodes carry the heights, a bend between them would be driven at street level)
        if (prof.some(([b]) => Math.abs(b - t) < 0.5) || C.follow) (w.cutBreaks || (w.cutBreaks = new Set())).add(p);
        w.h[i] = Math.min(w.h[i], hAt(t));
        half = Math.max(half, Math.abs(across(p)) + w.w / 2);
      });
    }
    const pt = (t, h) => [cx + ux * t, cz + uz * t, h];
    let axis = prof.flatMap(([t, h]) => pt(t, h));
    if (C.follow) {
      // the street's centreline from ramp end to ramp end (one chain of ways: its points in order along it), its own
      // width either side
      const seen = new Map();
      for (const w of W) for (const p of w.pts) { const t = along(p); if (t >= r0 - 0.01 && t <= r1 + 0.01) seen.set(`${p[0].toFixed(2)},${p[1].toFixed(2)}`, [p[0], p[1], hAt(t), t]); }
      axis = [...seen.values()].sort((a, b) => a[3] - b[3]).flatMap(([x, z, h]) => [x, z, h]);
      half = Math.max(...W.map((w) => w.w / 2));
    }
    roadCutOut.push([C.name, Math.round((half + SIDEWALK_W) * 10) / 10, axis.map((v) => Math.round(v * 100) / 100), ...(C.bank ? [C.bank] : [])]);
    log(`road cut ${C.name}: ${Math.round(a)}..${Math.round(b)} m along it, ${D.toFixed(1)} m down (${C.under ? `under the ${C.under}` : `the tracks ${(C.depth - D).toFixed(1)} m up`}), ramps ${Math.round(f0 - r0)} m & ${Math.round(r1 - f1)} m, ${(half + SIDEWALK_W).toFixed(1)} m either side`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Runs: each way split into at-grade runs (on the ground) and raised runs (decks & ramps)
// ---------------------------------------------------------------------------------------------------------------------
const q = (v) => Math.round(v * 10) / 10;
const groundRuns = []; // { way, pts, nodes }
const decks = []; // { way, pts, h }
for (const w of ways) {
  if (w.under) continue;
  if (!w.pts.some(([x, z]) => inDetail(x, z, 400))) continue;
  let cur = null;
  for (let i = 0; i + 1 < w.pts.length; i++) {
    const raised = w.h[i] > 0.05 || w.h[i + 1] > 0.05;
    const kind = raised ? 'deck' : 'ground';
    // (a road cut's break of slope ends a run: the street graph puts a node there)
    if (!cur || cur.kind !== kind || (i > 0 && w.cutBreaks && w.cutBreaks.has(w.pts[i]))) {
      cur = { kind, way: w, pts: [w.pts[i]], nodes: [w.nodes[i]], h: [w.h[i]] };
      (raised ? decks : groundRuns).push(cur);
    }
    cur.pts.push(w.pts[i + 1]);
    cur.nodes.push(w.nodes[i + 1]);
    cur.h.push(w.h[i + 1]);
  }
}
log(`${groundRuns.length} at-grade runs, ${decks.length} raised runs (decks & ramps)`);

// Roadway capsules the block raster cuts out of the land (geo-blocks.mjs): every carriageway, and the ground under the
// flyovers & their ramps too (no curb island, plot or building may stand under a deck)
export const rasterRoads = [];
for (const r of [...groundRuns, ...decks]) {
  for (let i = 0; i + 1 < r.pts.length; i++) {
    rasterRoads.push({ x0: r.pts[i][0], z0: r.pts[i][1], x1: r.pts[i + 1][0], z1: r.pts[i + 1][1], r: r.way.w / 2, rank: r.way.rank });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The street graph: every road that carries traffic but the service roads, at grade and on the flyovers alike. Roads
// only meet where the map joins them at a node, so a flyover crosses the road beneath without a junction; nodes and
// inner shape points carry their height (the decks & ramps), the traffic rides it.
// ---------------------------------------------------------------------------------------------------------------------
export function buildRoadGraph(crossable = () => true) {
  const graphRuns = [...groundRuns, ...decks].filter((r) => r.way.cls !== 'service' && r.pts.some(([x, z]) => inDetail(x, z)));
  // junction nodes: OSM nodes shared by two runs (or used twice), and every run end. A ramp's end (a vertex the ramp
  // inserted, no OSM node) is keyed by its position, so the deck and the ground run on either side share it.
  const uses = new Map();
  for (const r of graphRuns) for (const n of r.nodes) if (n !== null) uses.set(n, (uses.get(n) || 0) + 1);
  const nodes = [];
  const nodeH = [];
  const nodeId = new Map();
  const idOf = (key, p, h) => {
    if (!nodeId.has(key)) {
      nodeId.set(key, nodes.length / 2);
      nodes.push(q(p[0]), q(p[1]));
      nodeH.push(q(h));
    }
    return nodeId.get(key);
  };
  const names = [];
  const nameIds = new Map();
  const nameId = (n) => {
    if (!nameIds.has(n)) { nameIds.set(n, names.length); names.push(n); }
    return nameIds.get(n);
  };
  const links = [];
  for (const r of graphRuns) {
    const w = r.way;
    const keyAt = (i) => (r.nodes[i] !== null ? `n${r.nodes[i]}` : `p${q(r.pts[i][0])},${q(r.pts[i][1])}`);
    let start = 0;
    for (let i = 1; i < r.pts.length; i++) {
      const last = i === r.pts.length - 1;
      if (!last && !(uses.get(r.nodes[i]) > 1)) continue;
      const a = idOf(keyAt(start), r.pts[start], r.h[start]);
      const b = idOf(keyAt(i), r.pts[i], r.h[i]);
      const inside = (k) => inDetail(r.pts[k][0], r.pts[k][1], -40);
      if (a !== b && inside(start) && inside(i)) {
        // simplify in plan, keeping every point where the height changes (the ramps' profile)
        const seg = r.pts.slice(start, i + 1).map((p, k) => [p[0], p[1], r.h[start + k]]);
        const keep = new Set(rdp(seg.map(([x, z]) => [x, z]), 0.4).map(([x, z]) => `${x},${z}`));
        const pts = seg.filter(([x, z, h], k) => k === 0 || k === seg.length - 1 || keep.has(`${x},${z}`) || (Math.abs(h) > 0.05 && Math.abs(h - seg[k - 1][2]) > 0.3));
        const inner = pts.slice(1, -1);
        const raised = pts.some(([, , h]) => Math.abs(h) > 0.05); // (a deck, or a road cut's dip)
        links.push([a, b, nameId(w.name), w.w, w.lanes, w.dir, inner.flatMap(([x, z]) => [q(x), q(z)]), w.rank, raised ? inner.map(([, , h]) => q(h)) : 0]);
      }
      start = i;
    }
  }
  // Gaps in the map: a road whose end stops a few metres short of the road it obviously goes on into (two ways of one
  // carriageway that were never joined, a side street drawn up to a main road without a shared node). Join a dead end
  // to the dead end of the same road within 12 m, travelling the same way, or else to the nearest node of any road
  // within 4 m (at grade only).
  {
    const deg = new Map(), ends = new Map(); // node -> links; dead-end node -> its link & whether it arrives there
    links.forEach((l, i) => {
      for (const [n, arrives] of [[l[0], false], [l[1], true]]) {
        deg.set(n, (deg.get(n) || 0) + 1);
        ends.set(n, { i, arrives: l[5] === 0 ? null : (l[5] > 0) === arrives });
      }
    });
    const P = (n) => [nodes[2 * n], nodes[2 * n + 1]];
    const cells = new Map();
    for (let n = 0; n < nodes.length / 2; n++) {
      const [x, z] = P(n);
      const k = Math.floor(x / 12) * 100000 + Math.floor(z / 12);
      (cells.get(k) || cells.set(k, []).get(k)).push(n);
    }
    const near = (n, r) => {
      const [x, z] = P(n);
      const out = [];
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        for (const m of cells.get((Math.floor(x / 12) + a) * 100000 + Math.floor(z / 12) + b) || []) {
          const d = Math.hypot(nodes[2 * m] - x, nodes[2 * m + 1] - z);
          if (m !== n && d <= r) out.push([m, d]);
        }
      }
      return out.sort((p, q) => p[1] - q[1]);
    };
    const joined = new Set();
    let healed = 0;
    for (const [n, d] of deg) {
      if (d !== 1 || joined.has(n) || Math.abs(nodeH[n]) > 0.05) continue;
      const end = ends.get(n), l = links[end.i];
      let pick = null;
      for (const [m, dist] of near(n, 12)) {
        if (Math.abs(nodeH[m]) > 0.05 || joined.has(m)) continue;
        if (deg.get(m) === 1) {
          const o = ends.get(m), ol = links[o.i];
          if (ol[2] !== l[2] || ol === l) continue; // the same road only
          if (end.arrives !== null && o.arrives !== null && end.arrives === o.arrives) continue; // one arrives, one leaves
          pick = [m, end.arrives === false ? -1 : 1];
          break;
        }
        if (dist <= 4) { pick = [m, end.arrives === null ? 0 : end.arrives ? 1 : -1]; break; }
      }
      if (!pick) continue;
      const [m, dir] = pick;
      links.push([n, m, l[2], l[3], l[4], dir === 0 ? 0 : dir, [], l[7], 0]);
      joined.add(n);
      if (deg.get(m) === 1) joined.add(m);
      healed++;
    }
    log(`road graph: ${healed} gaps in the map joined`);
  }
  // The edge of the detailed city: roads cut off there would be dead ends no traffic could leave. A one-way roadway
  // leaving the city turns round into the nearest roadway of the same road coming in (a dual carriageway's other side,
  // within 400 m, joined straight across nothing but roadway & median: `crossable`): a link joins them. Any other road
  // end there is marked (`rim`): traffic may make a U-turn at it.
  const rimNodes = [];
  {
    const RIM = 400;
    const nearRim = (x, z) => x < DETAIL.x0 + RIM || x > DETAIL.x1 - RIM || z < DETAIL.z0 + RIM || z > DETAIL.z1 - RIM;
    const deg = new Map(), end = new Map();
    links.forEach((l, i) => {
      for (const [n, arrives] of [[l[0], false], [l[1], true]]) {
        deg.set(n, (deg.get(n) || 0) + 1);
        end.set(n, { i, arrives: l[5] === 0 ? null : (l[5] > 0) === arrives });
      }
    });
    const P = (n) => [nodes[2 * n], nodes[2 * n + 1]];
    const exits = [], entries = [];
    for (const [n, d] of deg) {
      if (d !== 1 || !nearRim(...P(n))) continue;
      const e = end.get(n);
      if (e.arrives === null) rimNodes.push(n);
      else (e.arrives ? exits : entries).push(n);
    }
    // the direction a link's traffic heads at node n
    const heading = (n) => {
      const l = links[end.get(n).i];
      const inner = l[6];
      const other = l[0] === n ? (inner.length ? [inner[0], inner[1]] : P(l[1])) : (inner.length ? [inner[inner.length - 2], inner[inner.length - 1]] : P(l[0]));
      const [x, z] = P(n);
      const L = Math.hypot(other[0] - x, other[1] - z) || 1;
      const away = [(other[0] - x) / L, (other[1] - z) / L];
      return end.get(n).arrives ? [-away[0], -away[1]] : away;
    };
    const used = new Set();
    let joined = 0;
    const clearPath = (a, b) => {
      const [ax, az] = P(a), [bx, bz] = P(b);
      const L = Math.hypot(bx - ax, bz - az);
      for (let t = 2; t < L - 2; t += 2) if (!crossable(ax + ((bx - ax) * t) / L, az + ((bz - az) * t) / L)) return false;
      return true;
    };
    for (const a of exits) {
      const ha = heading(a);
      const name = links[end.get(a).i][2];
      let best = null, bd = 400;
      for (const b of entries) {
        if (used.has(b) || links[end.get(b).i][2] !== name) continue;
        const hb = heading(b);
        const d = Math.hypot(P(b)[0] - P(a)[0], P(b)[1] - P(a)[1]);
        if (d < bd && ha[0] * hb[0] + ha[1] * hb[1] < -0.5 && clearPath(a, b)) { bd = d; best = b; }
      }
      if (best === null) { rimNodes.push(a); continue; }
      used.add(best);
      const l = links[end.get(a).i];
      links.push([a, best, l[2], 7.4, 2, 1, [], l[7], 0]);
      joined++;
    }
    for (const b of entries) if (!used.has(b)) rimNodes.push(b);
    log(`road graph: ${joined} one-way roadways turned round at the edge of the city, ${rimNodes.length} road ends there allow a U-turn`);
  }
  // node heights: only the raised ones, as [node, height, ...]
  const raisedNodes = [];
  nodeH.forEach((h, i) => { if (Math.abs(h) > 0.05) raisedNodes.push(i, h); }); // (negative: down in a road cut)
  log(`road graph: ${nodes.length / 2} nodes (${raisedNodes.length / 2} raised), ${links.length} links, ${names.length} names`);
  return { nodes, links, names, raised: raisedNodes, rim: rimNodes };
}

// Raised runs: [name, width, rank, flat x, z, h ...]
export const deckOut = decks
  .filter((d) => d.pts.some(([x, z]) => inDetail(x, z, 1500)))
  .map((d) => [d.way.name, d.way.w, d.way.rank, d.pts.flatMap(([x, z], i) => [q(x), q(z), q(d.h[i])])]);

// Every road for the maps & labels: [name, width, dir, lanes, rank, raised (1 deck), flat x, z ...]
export const roadLines = [...groundRuns.map((r) => [r, 0]), ...decks.map((r) => [r, 1])]
  .filter(([r]) => r.pts.some(([x, z]) => inDetail(x, z, 1500)))
  .map(([r, raised]) => [r.way.name, r.way.w, r.way.dir, r.way.lanes, r.way.rank, raised, rdp(r.pts, 0.8).flatMap(([x, z]) => [q(x), q(z)]), r.way.cls]);
