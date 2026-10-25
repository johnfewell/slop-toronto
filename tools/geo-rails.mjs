// Part 8: the railways (OpenStreetMap, osm_rails.json from tools/fetch-osm.mjs ONLY=rails): the TTC's streetcar tracks
// (railway=tram, with the loops & sidings: 501 Queen out to the Humber Loop, 504 King, 505 Dundas, 506 College,
// 509 Harbourfront & 510 Spadina on their rights-of-way, 511 Bathurst, 512 St Clair's stub), the streetcar stops
// (railway=tram_stop), and the heavy-rail lines of the Union Station Rail Corridor & its subdivisions (railway=rail:
// GO Transit, VIA & UP Express, with their yard tracks, sidings & crossovers). The subway stays underground (left out).
// The idea and the reading of the tracks follow aalghooneh/slop-toronto (MIT): js/streetcars.js & its city-grid.js
// rail corridor; the data path here is our own (Geofabrik extract via GDAL).
//   rails: [kind (0 streetcar, 1 heavy rail), service ('' main line, 'yard', 'siding', 'crossover', 'spur'), name,
//           flags (1 bridge, 2 tunnel), [x, z, ...]]  (cut to the detailed city, simplified to 0.3 m)
//   tramStops: [x, z, name, ...]
// Grade separation (the city is flat: the real corridor runs on an embankment & bridges east of Union and through
// Parkdale, the streets bridging it west of Union): every crossing of a heavy-rail track and a street, from the tags
// on both ways (bridge, tunnel, layer) and whether they share a node:
//   - the road over the railway (a road bridge at a higher layer than the track: Spadina, Bathurst, Strachan,
//     Dufferin, Dundas St W...): tools/geo-roads.mjs raises it on a deck; the track stays on the ground;
//   - the railway over the road (a rail bridge, or the road in a tunnel / at a lower layer: York, Bay & Yonge under
//     Union Station, Jarvis, Sherbourne, Parliament, Cherry, King & Queen St W, Bloor St W, Queen & Gerrard St E...):
//     the street stays on the ground, the tracks climb over it. Each street's crossings (all the tracks over one road)
//     make a lift: the stretch of street under the bridge, the bridge deck RAIL_CLEAR above the road, level for the
//     street, its sidewalks & the abutments either side, then down at 2% (a heavy-rail grade). Lifts less than FILL
//     apart along the corridor are joined by a fill (their hull, level at the lower deck): the embankment carries on
//     between them instead of dipping;
//     (and the road cuts, tools/geo-roads.mjs ROAD_CUTS: Strachan Ave dipping under the tracks, which stay at grade
//     on a bridge, or rise what the cut can't go down: RAIL_CLEAR above the street's floor);
//   - a shared node, or neither way bridged / tunnelled / layered: a level crossing (in the city, two yard roads
//     north of Fort York & a boat-launch spur): rails flush in the road.
//   railLifts: [deck height, half width (the road & the tracks' spread across it), x0, z0, x1, z1 (the street's centre
//               line under the tracks)];  railFills: [deck height, x, z (four corners, convex)]
// js/city-config.js railLiftAt(x, z) turns these into the track height (the same field for every track, so parallel
// tracks & crossovers agree); js/rail-corridor.js builds the embankments, bridges & abutments on it.
import { toWorld, rdp, load, log } from './geo-base.mjs';
import { inDetail, ways as roadWays } from './geo-roads.mjs';

export const RAIL_CLEAR = 6.2; // bed top above the street under it (a 4.9 m clearance under the 1.3 m deck)
export const RAIL_GRADE = 0.02;
export const LIFT_PLATEAU = 5 + 6; // level past the road's edge: its sidewalk (4.6 m) & the abutment (6 m)
const FILL = 800;

const q = (v) => Math.round(v * 10) / 10;
const MARGIN = 60; // tracks run on this far past the detailed city's edge (the cars turn back out of sight)

let elements = [];
try {
  elements = load('osm_rails.json').elements;
} catch {
  log('no osm_rails.json (run tools/fetch-osm.mjs with ONLY=rails): no streetcars or rail corridor');
}

export const rails = [];
for (const e of elements) {
  if (e.type !== 'way' || !e.geometry) continue;
  const t = e.tags || {};
  const kind = t.railway === 'tram' ? 0 : t.railway === 'rail' ? 1 : -1;
  if (kind < 0) continue;
  const tunnel = !!t.tunnel && t.tunnel !== 'no';
  if (kind === 1 && tunnel) continue; // heavy rail under the city: nothing to see
  const bridge = !!t.bridge && t.bridge !== 'no';
  const flags = (bridge ? 1 : 0) | (tunnel ? 2 : 0);
  // the runs of the way inside the detailed city
  let run = [];
  const flush = () => {
    if (run.length > 1) rails.push([kind, t.service || '', t.name || '', flags, rdp(run, 0.3).flatMap(([x, z]) => [q(x), q(z)])]);
    run = [];
  };
  for (const g of e.geometry) {
    const [x, z] = toWorld(g.lon, g.lat);
    if (inDetail(x, z, MARGIN)) run.push([x, z]);
    else flush();
  }
  flush();
}

// ---------------------------------------------------------------------------------------------------------------------
// Grade separation
// ---------------------------------------------------------------------------------------------------------------------
const L = (v) => Math.round(parseFloat(v) || 0);
const isTag = (v) => !!v && v !== 'no';
const key = (x, z) => `${Math.round(x * 100)},${Math.round(z * 100)}`;
function crossAt(p0, p1, q0, q1) {
  const rx = p1[0] - p0[0], rz = p1[1] - p0[1], sx = q1[0] - q0[0], sz = q1[1] - q0[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((q0[0] - p0[0]) * sz - (q0[1] - p0[1]) * sx) / den;
  const u = ((q0[0] - p0[0]) * rz - (q0[1] - p0[1]) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { x: p0[0] + rx * t, z: p0[1] + rz * t, u } : null;
}
const CELL = 50;
const roadGrid = new Map();
for (const w of roadWays) {
  if (w.under) continue;
  for (let i = 0; i + 1 < w.pts.length; i++) {
    const [ax, az] = w.pts[i], [bx, bz] = w.pts[i + 1];
    for (let ix = Math.floor(Math.min(ax, bx) / CELL); ix <= Math.floor(Math.max(ax, bx) / CELL); ix++) {
      for (let iz = Math.floor(Math.min(az, bz) / CELL); iz <= Math.floor(Math.max(az, bz) / CELL); iz++) {
        const k = ix * 100003 + iz;
        (roadGrid.get(k) || roadGrid.set(k, []).get(k)).push([w, i]);
      }
    }
  }
}
const under = []; // { x, z, w (road way), dx, dz (road direction), h (road height) }
const over = []; // crossings where the road bridges the track: { x, z, name }
const level = [];
const railSegs = []; // every heavy-rail segment, for the fills' coverage test
for (const e of elements) {
  const t = e.tags || {};
  if (e.type !== 'way' || !e.geometry || t.railway !== 'rail' || isTag(t.tunnel)) continue;
  const P = e.geometry.map((g) => toWorld(g.lon, g.lat));
  if (!P.some(([x, z]) => inDetail(x, z, MARGIN))) continue;
  const own = new Set(P.map(([x, z]) => key(x, z)));
  const rb = isTag(t.bridge), rl = L(t.layer);
  for (let i = 0; i + 1 < P.length; i++) {
    const p0 = P[i], p1 = P[i + 1];
    railSegs.push([p0, p1]);
    const seen = new Set();
    for (let ix = Math.floor(Math.min(p0[0], p1[0]) / CELL); ix <= Math.floor(Math.max(p0[0], p1[0]) / CELL); ix++) {
      for (let iz = Math.floor(Math.min(p0[1], p1[1]) / CELL); iz <= Math.floor(Math.max(p0[1], p1[1]) / CELL); iz++) {
        for (const [w, j] of roadGrid.get(ix * 100003 + iz) || []) {
          if (seen.has(w)) continue;
          const c = crossAt(p0, p1, w.pts[j], w.pts[j + 1]);
          if (!c) continue;
          seen.add(w);
          const shared = own.has(key(...w.pts[j])) || own.has(key(...w.pts[j + 1]));
          const roadOver = w.elevated && !(rb && rl >= w.layer);
          const railOver = !roadOver && ((rb && !(w.bridge && w.layer >= rl)) || w.tunnel || w.layer < rl || w.railUnder);
          if (shared && !roadOver) level.push({ x: c.x, z: c.z, name: w.name || w.cls });
          else if (roadOver) over.push({ x: c.x, z: c.z, name: w.name || w.cls });
          else if (railOver && (w.cls !== 'service' || rb)) {
            const Lw = Math.hypot(w.pts[j + 1][0] - w.pts[j][0], w.pts[j + 1][1] - w.pts[j][1]) || 1;
            const h = w.h[j] + (w.h[j + 1] - w.h[j]) * c.u;
            // (a road already high enough on its own ramp, the Don Valley Parkway climbing to the Gardiner, clears the
            // trains: it passes over them, the tracks stay down; one partway up a ramp has the tracks climb over it)
            if (h > RAIL_CLEAR + 0.6) over.push({ x: c.x, z: c.z, name: w.name || w.cls });
            else under.push({ x: c.x, z: c.z, w, dx: (w.pts[j + 1][0] - w.pts[j][0]) / Lw, dz: (w.pts[j + 1][1] - w.pts[j][1]) / Lw, h });
          } else if (!railOver) level.push({ x: c.x, z: c.z, name: w.name || w.cls });
        }
      }
    }
  }
}
// One lift per street: its crossings clustered (within 60 m: a dual carriageway's two roadways under the same bridge)
const lifts = [];
{
  const byRoad = new Map();
  for (const c of under) {
    const k = c.w.name || `#${c.w.id}`;
    (byRoad.get(k) || byRoad.set(k, []).get(k)).push(c);
  }
  for (const [name, list] of byRoad) {
    const groups = [];
    for (const c of list) {
      const g = groups.filter((q) => q.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < 60));
      const merged = [c, ...g.flat()];
      for (const q of g) groups.splice(groups.indexOf(q), 1);
      groups.push(merged);
    }
    for (const g of groups) {
      let dx = 0, dz = 0, cx = 0, cz = 0;
      for (const c of g) {
        const s = c.dx * g[0].dx + c.dz * g[0].dz < 0 ? -1 : 1;
        dx += c.dx * s; dz += c.dz * s; cx += c.x / g.length; cz += c.z / g.length;
      }
      const dl = Math.hypot(dx, dz) || 1;
      dx /= dl; dz /= dl;
      let a0 = Infinity, a1 = -Infinity, lat = 0, h = -Infinity, hw = 0;
      for (const c of g) {
        const a = (c.x - cx) * dx + (c.z - cz) * dz;
        a0 = Math.min(a0, a); a1 = Math.max(a1, a);
        lat = Math.max(lat, Math.abs(-(c.x - cx) * dz + (c.z - cz) * dx));
        h = Math.max(h, c.h);
        hw = Math.max(hw, c.w.w / 2);
      }
      lifts.push({ name, H: Math.max(0, h + RAIL_CLEAR), road: h, /* (a road cut's floor: below 0) */ hw: lat + hw, x0: cx + dx * (a0 - 2), z0: cz + dz * (a0 - 2), x1: cx + dx * (a1 + 2), z1: cz + dz * (a1 + 2), cx, cz, n: g.length });
    }
  }
}
// Fills: two lifts within FILL of each other along the corridor (rail all along the line between them, no street
// bridging the tracks in between)
const fills = [];
{
  const segGrid = new Map();
  railSegs.forEach((s, i) => {
    const [[ax, az], [bx, bz]] = s;
    for (let ix = Math.floor(Math.min(ax, bx) / CELL); ix <= Math.floor(Math.max(ax, bx) / CELL); ix++) {
      for (let iz = Math.floor(Math.min(az, bz) / CELL); iz <= Math.floor(Math.max(az, bz) / CELL); iz++) {
        const k = ix * 100003 + iz;
        (segGrid.get(k) || segGrid.set(k, []).get(k)).push(s);
      }
    }
  });
  const nearRail = (x, z, r) => {
    for (let ix = Math.floor((x - r) / CELL); ix <= Math.floor((x + r) / CELL); ix++) {
      for (let iz = Math.floor((z - r) / CELL); iz <= Math.floor((z + r) / CELL); iz++) {
        for (const [[ax, az], [bx, bz]] of segGrid.get(ix * 100003 + iz) || []) {
          const ex = bx - ax, ez = bz - az;
          const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
          if (Math.hypot(ax + ex * t - x, az + ez * t - z) < r) return true;
        }
      }
    }
    return false;
  };
  for (let i = 0; i < lifts.length; i++) {
    for (let j = i + 1; j < lifts.length; j++) {
      const A = lifts[i], B = lifts[j];
      const D = Math.hypot(B.cx - A.cx, B.cz - A.cz);
      if (D > FILL || D < 1) continue;
      let hit = 0, n = 0;
      for (let s = 0; s <= D; s += 20, n++) if (nearRail(A.cx + ((B.cx - A.cx) * s) / D, A.cz + ((B.cz - A.cz) * s) / D, 30)) hit++;
      if (hit < n * 0.9) continue;
      // no road bridge over the tracks near the line between them
      const segD = (p) => {
        const ex = B.cx - A.cx, ez = B.cz - A.cz;
        const t = Math.max(0, Math.min(1, ((p.x - A.cx) * ex + (p.z - A.cz) * ez) / (ex * ex + ez * ez)));
        return Math.hypot(A.cx + ex * t - p.x, A.cz + ez * t - p.z);
      };
      if (over.some((o) => segD(o) < 80)) continue;
      // the quad A0 A1 B1 B0, or A0 A1 B0 B1 if that one doesn't cross itself
      const cr = (p, q, r, s) => !!crossAt([p[0], p[1]], [q[0], q[1]], [r[0], r[1]], [s[0], s[1]]);
      const a0 = [A.x0, A.z0], a1 = [A.x1, A.z1];
      let b0 = [B.x0, B.z0], b1 = [B.x1, B.z1];
      if (cr(a1, b1, b0, a0)) [b0, b1] = [b1, b0];
      fills.push({ H: Math.min(A.H, B.H), pts: [a0, a1, b1, b0], names: `${A.name} - ${B.name}` });
    }
  }
}
// The field (as js/city-config.js railLiftAt): the highest lift or fill at (x, z)
function segDist(x, z, ax, az, bx, bz) {
  const ex = bx - ax, ez = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
  return Math.hypot(ax + ex * t - x, az + ez * t - z);
}
function liftAt(x, z) {
  let best = 0;
  for (const l of lifts) best = Math.max(best, l.H - RAIL_GRADE * Math.max(0, segDist(x, z, l.x0, l.z0, l.x1, l.z1) - l.hw - LIFT_PLATEAU));
  for (const f of fills) {
    const P = f.pts;
    let inside = true, d = Infinity;
    for (let i = 0; i < 4; i++) {
      const [ax, az] = P[i], [bx, bz] = P[(i + 1) % 4];
      d = Math.min(d, segDist(x, z, ax, az, bx, bz));
      const c = (bx - ax) * (z - az) - (bz - az) * (x - ax);
      if (i === 0) inside = c;
      else if (Math.sign(c) !== Math.sign(inside)) inside = false;
    }
    best = Math.max(best, f.H - RAIL_GRADE * (inside !== false ? 0 : d));
  }
  return best;
}
const clash = over.filter((o) => liftAt(o.x, o.z) > 0.8);
log(`rail grade separation: ${lifts.length} streets under the tracks (${under.length} crossings), ${fills.length} embankment fills between them, ${new Set(over.map((o) => o.name)).size} streets bridging the tracks (${over.length} crossings), ${level.length} level crossings (${[...new Set(level.map((o) => o.name))].join(', ')})`);
log(`  under: ${lifts.map((l) => `${l.name} ${Math.round(l.H * 10) / 10} m`).join(', ')}`);
log(`  over: ${[...new Set(over.map((o) => o.name))].join(', ')}`);
if (clash.length) log(`  WARNING: tracks lifted under ${clash.length} road bridges: ${clash.map((o) => `${o.name} (${Math.round(liftAt(o.x, o.z) * 10) / 10} m)`).join(', ')}`);
export const railLifts = lifts.map((l) => [q(l.H), q(l.hw), q(l.x0), q(l.z0), q(l.x1), q(l.z1), q(l.road)]); // (+ the street's height under the bridge)
export const railFills = fills.map((f) => [q(f.H), ...f.pts.flat().map(q)]);

export const tramStops = [];
for (const e of elements) {
  if (e.type !== 'node') continue;
  const [x, z] = toWorld(e.lon, e.lat);
  if (!inDetail(x, z)) continue;
  tramStops.push(q(x), q(z), (e.tags && e.tags.name) || '');
}

const km = (k) => Math.round(rails.filter((r) => r[0] === k).reduce((t, r) => {
  const p = r[4];
  for (let i = 2; i < p.length; i += 2) t += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return t;
}, 0) / 100) / 10;
log(`rails: ${rails.filter((r) => r[0] === 0).length} streetcar ways (${km(0)} km), ${rails.filter((r) => r[0] === 1).length} heavy-rail ways (${km(1)} km), ${tramStops.length / 3} streetcar stops`);
