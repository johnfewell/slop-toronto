(function () {
// js/parking-layout.js
// Where a car may stand parked at a Toronto curb (docs/parked-cars.md), by explicit rules: every curb of the game's
// streets is walked stall by stall, and a stall is kept only where
// - the City allows parking there: a by-law (js/toronto-parking.js, Chapter 950) neither forbids it nor reserves the
//   curb, and either the curb is paid parking (a Toronto Parking Authority pay station on the street), a by-law allows
//   restricted-period parking, or it is a local street (permit parking area or not); an arterial with none of that is
//   left clear (the rush-hour routes)
// - it is clear of the City's general prohibitions: 3 m from a hydrant, 9 m from an intersection (15 m approaching a
//   signal), a laneway or driveway's mouth, the crossings, the TTC's stops
// - it is clear of the traffic: off the game's traffic lanes (a lane's centre keeps 1.5 m from it, as the CaféTO
//   platforms do), the streetcar tracks (1.8 m from a track's centre), the bikeways, and the CaféTO curb platforms
// - it is not on a surveyed carriageway seen to have no street parking (deps.noParkingAt: the Port Lands streets of
//   tools/fixtures/road-surfaces.json whose chain says `parking: "none"`, docs/road-widths.md)
// - beside a curbside cycle track on the streets in FLOATING_STREETS (the Danforth, Bloor), the stall floats beyond it,
//   against its separator, as the City built them; where the track is routed out round a CaféTO platform (cycling.js)
//   it takes that parking lane, so no stall stands there. Every other cycle track keeps its curb clear
// Deterministic: the same inputs give the same stalls (tools/build-parked-cars.mjs records them in
// js/toronto-parked-cars.js; tests/parked-cars.test.mjs replays it). Rejections are counted by reason.

// The streets whose curbside cycle tracks have floating parking beyond them (curb, track, separator, parked cars,
// traffic), each checked against the City's 2025 aerials (docs/parked-cars.md). On any other street a mapped cycle
// track keeps its curb clear: no stall stands beside it. Add a street (its GEO.roads name) only after its aerials show
// cars parked beyond the track.
const FLOATING_STREETS = Object.freeze([
  'Danforth Avenue', // (the 2025 aerials of 335-341, 456 and 494-500 Danforth, 1165 Bloor W: docs/cafeto-patios.md)
  'Bloor Street West',
  'Bloor Street East'
]);
const RULES = Object.freeze({
  stall: 6.4, // m along the curb per car (Toronto's marked on-street stalls run 6-6.7 m)
  width: 2.0, // m out from the curb a parked car takes (a car's 1.9 m and the gap to the curb)
  gutter: 0.2, // m between the curb and the car's side
  hydrant: 3, // City: no parking within 3 m of a fire hydrant
  junction: 9, // City: no parking within 9 m of an intersection
  signalAhead: 15, // City: within 15 m approaching a signalised intersection
  laneway: 1, laneGap: 8, // a curb gap under 8 m is a laneway or driveway's mouth: 1 m clear of it
  driveway: 1, // m clear of a driveway (an unnamed service road meeting the curb)
  crossingAhead: 15, crossingBehind: 9, // game (as the CaféTO platforms): the pedestrian crossovers & midblock signals
  stopAhead: 30, stopBehind: 18, // game (as the CaféTO platforms; the TTC's stop zones are signed no stopping)
  carClear: 1.5, // game: a lane's centre keeps a bus's half width & a little clear of a parked car (patio-layout.js)
  streetcarClear: 1.8, // game: a Flexity's half width (1.27 m) + 0.5 m from the track's centre
  patioGap: 1.0, // m from a CaféTO curb lane platform
  bikeShareGap: 1.0,
  paidReach: 60, // m: a payment zone's curb runs this far past its first and last machines
  maxCurb: 12, // m from the centre line: a curb further out is a square or a forecourt, not a parking lane
  step: 1, // m: where a stall fails, the next one tried along the curb
  trackReach: 5, // m out from the curb a curbside cycle track is looked for (floating parking beyond it)
  trackGap: 0.1, // m between the cycle track's reserve (its separator and 0.1 m) and a floating stall
  floatingStreets: FLOATING_STREETS // the streets parked beyond their curbside cycle tracks (above)
});
// Toronto's streets by class (GEO.roads cls): those parked on, and the arterials (left clear unless the data says so)
const PARKED_CLASSES = new Set(['residential', 'living_street', 'unclassified', 'tertiary', 'secondary', 'primary']);
const ARTERIAL_RANK = 3;
const SIDE_BITS = { north: 1, south: 2, east: 4, west: 8 };
const NORM = [[/\bstreet\b/g, 'st'], [/\bavenue\b/g, 'ave'], [/\broad\b/g, 'rd'], [/\bwest\b/g, 'w'], [/\beast\b/g, 'e'],
  [/\bboulevard\b/g, 'blvd'], [/\bcrescent\b/g, 'cres'], [/\bdrive\b/g, 'dr'], [/\bplace\b/g, 'pl'], [/\bsquare\b/g, 'sq'],
  [/\bterrace\b/g, 'ter'], [/\bnorth\b/g, 'n'], [/\bsouth\b/g, 's'], [/\bgardens\b/g, 'gdns'], [/\blane\b/g, 'ln'],
  [/\bcourt\b/g, 'crt'], [/\bsaint\b/g, 'st'], [/\bst\.\s/g, 'st ']];
function streetKey(name) {
  let s = String(name || '').toLowerCase().trim();
  for (const [re, to] of NORM) s = s.replace(re, to);
  return s.replace(/[^a-z0-9]/g, '');
}

// a point grid (16 m cells) of things with x, z
function pointGrid(list, cell = 16) {
  const grid = new Map();
  for (const o of list) {
    const k = Math.floor(o.x / cell) * 100003 + Math.floor(o.z / cell);
    (grid.get(k) || grid.set(k, []).get(k)).push(o);
  }
  return (x, z, reach, fn) => {
    for (let i = Math.floor((x - reach) / cell); i <= Math.floor((x + reach) / cell); i++) {
      for (let j = Math.floor((z - reach) / cell); j <= Math.floor((z + reach) / cell); j++) {
        for (const o of grid.get(i * 100003 + j) || []) if (fn(o)) return o;
      }
    }
    return null;
  };
}
// a segment grid of [ax, az, bx, bz, ...] (24 m cells)
function segmentGrid(segs, cell = 24, pad = 4) {
  const grid = new Map();
  for (const s of segs) {
    for (let i = Math.floor((Math.min(s[0], s[2]) - pad) / cell); i <= Math.floor((Math.max(s[0], s[2]) + pad) / cell); i++) {
      for (let j = Math.floor((Math.min(s[1], s[3]) - pad) / cell); j <= Math.floor((Math.max(s[1], s[3]) + pad) / cell); j++) {
        const k = i * 100003 + j;
        (grid.get(k) || grid.set(k, []).get(k)).push(s);
      }
    }
  }
  return (x, z) => grid.get(Math.floor(x / cell) * 100003 + Math.floor(z / cell)) || [];
}
// distance between segment [ax, az, bx, bz] and the rectangle r (centre, along t, out n, half sizes hl, hd)
function segRectDist(s, r) {
  // the segment in the rectangle's frame
  const toU = (x, z) => (x - r.cx) * r.tx + (z - r.cz) * r.tz, toV = (x, z) => (x - r.cx) * r.nx + (z - r.cz) * r.nz;
  const u0 = toU(s[0], s[1]), v0 = toV(s[0], s[1]), du = toU(s[2], s[3]) - u0, dv = toV(s[2], s[3]) - v0;
  // crossing the rectangle (Liang-Barsky): 0
  let t0 = 0, t1 = 1, cross = true;
  for (const [p, q] of [[-du, u0 + r.hl], [du, r.hl - u0], [-dv, v0 + r.hd], [dv, r.hd - v0]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) { cross = false; break; } continue; }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 > t1) { cross = false; break; }
  }
  if (cross) return 0;
  const box = (u, v) => Math.hypot(Math.max(0, Math.abs(u) - r.hl), Math.max(0, Math.abs(v) - r.hd));
  const L2 = du * du + dv * dv || 1e-12;
  const toSeg = (u, v) => { const t = Math.max(0, Math.min(1, ((u - u0) * du + (v - v0) * dv) / L2)); return Math.hypot(u0 + du * t - u, v0 + dv * t - v); };
  return Math.min(box(u0, v0), box(u0 + du, v0 + dv), toSeg(-r.hl, -r.hd), toSeg(r.hl, -r.hd), toSeg(r.hl, r.hd), toSeg(-r.hl, r.hd));
}
const rectSamples = (r, step = 0.5) => {
  const out = [];
  const nu = Math.max(1, Math.ceil((2 * r.hl) / step)), nv = Math.max(1, Math.ceil((2 * r.hd) / step));
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const u = -r.hl + (2 * r.hl * i) / nu, v = -r.hd + (2 * r.hd * j) / nv;
    out.push([r.cx + r.tx * u + r.nx * v, r.cz + r.tz * u + r.nz * v]);
  }
  return out;
};
const rectDist = (r, x, z) => {
  const dx = x - r.cx, dz = z - r.cz;
  const a = Math.max(0, Math.abs(dx * r.tx + dz * r.tz) - r.hl), b = Math.max(0, Math.abs(dx * r.nx + dz * r.nz) - r.hd);
  return Math.hypot(a, b);
};
const overlaps = (a, b, gap) => {
  for (const [ax, az] of [[a.tx, a.tz], [a.nx, a.nz], [b.tx, b.tz], [b.nx, b.nz]]) {
    const ra = a.hl * Math.abs(a.tx * ax + a.tz * az) + a.hd * Math.abs(a.nx * ax + a.nz * az);
    const rb = b.hl * Math.abs(b.tx * ax + b.tz * az) + b.hd * Math.abs(b.nx * ax + b.nz * az);
    if (Math.abs((b.cx - a.cx) * ax + (b.cz - a.cz) * az) > ra + rb + gap) return false;
  }
  return true;
};
const inRing = (ring, x, z) => {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const ax = ring[i], az = ring[i + 1], bx = ring[j], bz = ring[j + 1];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
  }
  return inside;
};

/**
 * The parking stalls on the game's curbs. `deps`:
 * - roads: [{ name, w, dir, rank, raised, cls, pts }] (city-config.js ROADS), blockAt (curb islands)
 * - lanes: the traffic lanes' centre lines [[ax, az, bx, bz]] (road-network.js, or laneSegments from the road graph)
 * - hydrants, stops, crossings, junctions: [{ x, z }]; driveways: [{ x, z, w }] (where a service road meets a street)
 * - railDist(x, z): to the nearest streetcar track; bikewayAt(x, z): on a bikeway (as built, routed round the CaféTO
 *   platforms); trackAt(x, z): on a cycle track (likewise; on R.floatingStreets a stall floats beyond one at the curb);
 *   bikeShareAt(x, z)
 * - patios: the CaféTO curb platforms [{ cx, cz, tx, tz, nx, nz, length, depth }]
 * - payStations: [{ x, z, zone }]; parking: CITY.PARKING (rules, names, permit areas); inFrame(x, z); heightAt(x, z) (0 at grade)
 * Returns { stalls, rejected, stats }: each stall { x, z, tx, tz, nx, nz (out to the curb), road, side, cat, curb }.
 */
function parkingStalls(deps) {
  const R = { ...RULES, ...(deps.rules || {}) };
  const { roads, blockAt, lanes = [], hydrants = [], stops = [], crossings = [], junctions = [], driveways = [],
    railDist = () => Infinity, bikewayAt = () => false, trackAt = () => false, bikeShareAt = null, patios = [], payStations = [], parking = null,
    inFrame = () => true, heightAt = () => 0, nearestRoad = null, noParkingAt = () => false } = deps;
  const laneAt = segmentGrid(lanes);
  const nearHydrant = pointGrid(hydrants);
  const nearStop = pointGrid(stops, 32);
  const nearCrossing = pointGrid(crossings, 32);
  const nearJunction = pointGrid(junctions, 32);
  const nearDriveway = pointGrid(driveways);
  const patioRects = patios.map((p) => ({ cx: p.cx, cz: p.cz, tx: p.tx, tz: p.tz, nx: p.nx, nz: p.nz, hl: p.length / 2, hd: p.depth / 2 }));
  const nearPatio = pointGrid(patioRects.map((r) => ({ x: r.cx, z: r.cz, r })), 32);
  // the by-law rules by street
  const rulesBy = new Map();
  if (parking) {
    for (const r of parking.rules) {
      const key = streetKey(parking.names[r[6]]);
      const ex = r[4] - r[2], ez = r[5] - r[3], L = Math.hypot(ex, ez);
      (rulesBy.get(key) || rulesBy.set(key, []).get(key)).push({ kind: r[0], sides: r[1], x0: r[2], z0: r[3], tx: ex / L, tz: ez / L, len: L, schedule: r[7] });
    }
  }
  const permitRings = (parking?.permitAreas || []).map(([area, ring]) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]); }
    return { area, ring, x0, x1, z0, z1 };
  });
  const permitAt = (x, z) => permitRings.find((p) => x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1 && inRing(p.ring, x, z))?.area || null;
  // the rules covering (x, z) on a street, on the side whose outward normal is (nx, nz): the strongest wins
  const SIDE_VEC = [[1, 0, -1], [2, 0, 1], [4, 1, 0], [8, -1, 0]];
  const bylawAt = (key, x, z, nx, nz) => {
    let allow = null, deny = null;
    for (const r of rulesBy.get(key) || []) {
      const dx = x - r.x0, dz = z - r.z0, s = dx * r.tx + dz * r.tz;
      if (s < -1 || s > r.len + 1 || Math.abs(dx * r.tz - dz * r.tx) > 25) continue;
      if (r.sides !== 15 && !SIDE_VEC.some(([bit, sx, sz]) => (r.sides & bit) && sx * nx + sz * nz > 0.35)) continue;
      if (r.kind === 1) allow = allow || r;
      else deny = deny || r;
    }
    return deny ? { deny } : allow ? { allow } : null;
  };

  const stalls = [];
  const placedGrid = new Map();
  const addPlaced = (s) => {
    const k = Math.floor(s.rect.cx / 32) * 100003 + Math.floor(s.rect.cz / 32);
    (placedGrid.get(k) || placedGrid.set(k, []).get(k)).push(s);
  };
  const clashes = (r) => {
    for (let i = Math.floor(r.cx / 32) - 1; i <= Math.floor(r.cx / 32) + 1; i++) {
      for (let j = Math.floor(r.cz / 32) - 1; j <= Math.floor(r.cz / 32) + 1; j++) {
        for (const s of placedGrid.get(i * 100003 + j) || []) if (overlaps(s.rect, r, 0.3)) return true;
      }
    }
    return false;
  };
  const rejected = { curb: 0, lane: 0, streetcar: 0, bikeway: 0, junction: 0, laneway: 0, driveway: 0, hydrant: 0, crossing: 0,
    stop: 0, patio: 0, bikeShare: 0, bylaw: 0, reserved: 0, arterial: 0, overlap: 0, grade: 0, surveyed: 0 };
  const cats = {};
  let floating = 0;

  // the curb out from the centre line at (x, z), on the side (nx, nz): its distance and block, or null
  const curbAt = (x, z, nx, nz) => {
    let v = 0.3, block = null;
    for (; v <= R.maxCurb + 0.5; v += 0.4) {
      const b = blockAt(x + nx * v, z + nz * v);
      if (b && !b.median) { block = b; break; }
      if (b && b.median) return null; // (a median first: the other carriageway's side)
    }
    if (!block) return null;
    let lo = v - 0.4;
    for (let k = 0; k < 5; k++) {
      const mid = (lo + v) / 2;
      if (blockAt(x + nx * mid, z + nz * mid) === block) v = mid; else lo = mid;
    }
    return { v, block };
  };

  // paid parking: the stretch of a street a Toronto Parking Authority payment zone's machines stand along (the zone's
  // machines on one street, from the first to the last, and `paidReach` beyond), or round a lone machine
  const zones = new Map();
  for (const p of payStations) {
    const road = nearestRoad ? nearestRoad(p.x, p.z) : null;
    if (!road) continue;
    const k = `${p.zone ?? ''}|${road}`;
    (zones.get(k) || zones.set(k, { road, pts: [] }).get(k)).pts.push(p);
  }
  const paidSpans = [];
  for (const { road, pts } of zones.values()) {
    let a = pts[0], b = pts[0], far = 0;
    for (const p of pts) for (const q of pts) { const d = Math.hypot(p.x - q.x, p.z - q.z); if (d > far) { far = d; a = p; b = q; } }
    paidSpans.push({ key: streetKey(road), ax: a.x, az: a.z, bx: b.x, bz: b.z, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, r: far / 2 + R.paidReach });
  }
  const nearPaid = pointGrid(paidSpans, 64);
  const paidAt = (key, x, z) => !!nearPaid(x, z, 400, (sp) => {
    if (sp.key !== key || Math.hypot(sp.x - x, sp.z - z) > sp.r + 25) return false;
    const ex = sp.bx - sp.ax, ez = sp.bz - sp.az, L = Math.hypot(ex, ez);
    if (L < 1) return Math.hypot(sp.ax - x, sp.az - z) < R.paidReach;
    const t = ((x - sp.ax) * ex + (z - sp.az) * ez) / L, lat = Math.abs(((x - sp.ax) * ez - (z - sp.az) * ex) / L);
    return lat < 25 && t > -R.paidReach && t < L + R.paidReach;
  });
  // whether (x, z) on `road`, its curb's outward normal (nx, nz), may hold a parked car: { cat, permit } or { why }
  function legality(road, key, x, z, nx, nz) {
    if (noParkingAt(x, z)) return { why: 'surveyed' };
    const law = bylawAt(key, x, z, nx, nz);
    if (law?.deny) return { why: law.deny.kind === 2 ? 'reserved' : 'bylaw' };
    const permit = permitAt(x, z);
    if (paidAt(key, x, z)) return { cat: 'paid', permit };
    if (law?.allow) return { cat: 'restricted', permit };
    if (road.rank >= ARTERIAL_RANK) return { why: 'arterial' };
    return { cat: permit ? 'permit' : 'local', permit };
  }
  // the traffic lanes near a rectangle
  const lanesNear = (r, reach) => {
    const seen = new Set();
    const ex = Math.abs(r.tx) * r.hl + Math.abs(r.nx) * r.hd + reach, ez = Math.abs(r.tz) * r.hl + Math.abs(r.nz) * r.hd + reach;
    for (let x = r.cx - ex; x <= r.cx + ex + 23.9; x += 24) {
      for (let z = r.cz - ez; z <= r.cz + ez + 23.9; z += 24) for (const s of laneAt(Math.min(x, r.cx + ex), Math.min(z, r.cz + ez))) seen.add(s);
    }
    return seen;
  };

  const floatingStreets = new Set(R.floatingStreets || []);
  for (const road of roads) {
    if (!road.name || road.raised || road.highway || !PARKED_CLASSES.has(road.cls)) continue;
    const key = streetKey(road.name);
    const floats = floatingStreets.has(road.name);
    const pts = road.pts;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      if (L < R.stall + 2) continue;
      const tx = (b.x - a.x) / L, tz = (b.z - a.z) / L;
      for (const side of [1, -1]) {
        // out of the road toward this curb (the right of the way the line runs, or its left)
        const nx = -tz * side, nz = tx * side;
        const travel = road.dir ? road.dir : side; // +1: traffic on this curb runs along +t
        const at = (u, v) => [a.x + tx * u + nx * v, a.z + tz * u + nz * v];
        // the curb profile every metre, on demand
        const n = Math.floor(L);
        const prof = new Array(n + 1);
        const curbK = (k) => (prof[k] === undefined ? (prof[k] = curbAt(...at(k, 0), nx, nz)) : prof[k]);
        // nothing legal along this side (an arterial without pay stations or a by-law allowing it, a no-parking
        // stretch): not walked stall by stall
        let any = false;
        for (let u = R.stall / 2; u < L && !any; u += R.stall) any = !legality(road, key, ...at(u, 4), nx, nz).why;
        if (!any) {
          const why = legality(road, key, ...at(L / 2, 4), nx, nz).why || 'bylaw';
          rejected[why] += Math.max(1, Math.floor(L / R.stall));
          continue;
        }
        // how far the curb runs on from u (dir +1/-1) at v out, and the gap after it (to `limit`, and 9 m on)
        const islandRun = (u, dir, v, block, limit) => {
          let run = null;
          for (let s = 0; s <= limit; s += 0.5) {
            if (blockAt(...at(u + dir * s, v)) !== block) { run = Math.max(0, s - 0.5); break; }
          }
          if (run === null) return { run: Infinity, gap: 0 };
          let gap = 40;
          for (let s = run + 0.5; s <= run + R.laneGap + 1; s += 0.5) {
            const bb = blockAt(...at(u + dir * s, v));
            if (bb && !bb.median) { gap = s - run - 0.5; break; }
          }
          return { run, gap };
        };
        // a cycle track along the curb over [u0, u1]: how far out from the curb it reaches (m), 0 where there is none (most
        // curbs: a quick look first, finer than any track is wide), -1 where one is not along the whole stall from the
        // curb, the same width (it ends, or bends out round a CaféTO platform there: no car floats beside that)
        const trackFrom = (u0, u1, curb) => {
          const ss = [u0, (u0 + u1) / 2, u1];
          if (!ss.some((s) => [0.3, 1.0, 1.7].some((d) => trackAt(...at(s, curb - d))))) return 0;
          const reach = ss.map((s) => {
            let first = null, last = 0;
            for (let d = 0.05; d <= R.trackReach; d += 0.05) if (trackAt(...at(s, curb - d))) { if (first === null) first = d; last = d; }
            return first !== null && first <= 0.6 ? last : null;
          });
          if (reach.some((r) => r === null) || Math.max(...reach) - Math.min(...reach) > 0.3) return -1;
          return Math.max(...reach);
        };
        const check = (rect, curb, u, block) => {
          if (!inFrame(rect.cx, rect.cz)) return 'curb';
          const pts2 = rectSamples(rect, 0.8);
          if (pts2.some(([x, z]) => blockAt(x, z))) return 'curb';
          if (pts2.some(([x, z]) => Math.abs(heightAt(x, z)) > 0.05)) return 'grade';
          for (const s of lanesNear(rect, R.carClear)) if (segRectDist(s, rect) < R.carClear) return 'lane';
          if (pts2.some(([x, z]) => railDist(x, z) < R.streetcarClear)) return 'streetcar';
          // (a car may stand up to 0.35 m past its stall's ends: its body jittered along, the longest vans)
          if (pts2.some(([x, z]) => bikewayAt(x, z)) || rectSamples({ ...rect, hl: rect.hl + 0.35 }, 0.4).some(([x, z]) => bikewayAt(x, z))) return 'bikeway';
          if (nearHydrant(rect.cx, rect.cz, 8, (h) => rectDist(rect, h.x, h.z) < R.hydrant)) return 'hydrant';
          if (nearPatio(rect.cx, rect.cz, 12, (p) => overlaps(p.r, rect, R.patioGap))) return 'patio';
          if (nearDriveway(rect.cx, rect.cz, 12, (d) => rectDist(rect, d.x, d.z) < (d.w || 3) / 2 + R.driveway)) return 'driveway';
          const alongOf = (p) => { const dx = p.x - a.x, dz = p.z - a.z; return { s: dx * tx + dz * tz - u, v: dx * nx + dz * nz }; };
          const tooClose = (list, aheadD, behindD, lateral) => list(rect.cx, rect.cz, rect.hl + Math.max(aheadD, behindD) + 2, (p) => {
            const { s, v } = alongOf(p);
            if (!lateral(v)) return false;
            const gapAhead = s * travel - rect.hl, gapBehind = -s * travel - rect.hl;
            if (gapAhead >= 0) return gapAhead < aheadD;
            if (gapBehind >= 0) return gapBehind < behindD;
            return true;
          });
          if (tooClose(nearCrossing, R.crossingAhead, R.crossingBehind, (v) => Math.abs(v) < curb + 6)) return 'crossing';
          if (tooClose(nearStop, R.stopAhead, R.stopBehind, (v) => v > 0 && v < curb + 8)) return 'stop';
          // intersections & laneways: the island's ends along the sidewalk beside the curb
          for (const dir of [1, -1]) {
            const { run, gap } = islandRun(u + dir * rect.hl, dir, curb + 0.6, block, R.signalAhead + 1);
            if (run === Infinity) continue;
            let need;
            if (gap < R.laneGap) need = R.laneway;
            else if (dir === travel) {
              const [ex, ez] = at(u + dir * (rect.hl + run + 4), curb);
              need = nearJunction(ex, ez, 30, (j) => Math.hypot(j.x - ex, j.z - ez) < 30) ? R.signalAhead : R.junction;
            } else need = R.junction;
            if (run < need) return gap < R.laneGap ? 'laneway' : 'junction';
          }
          if (bikeShareAt && pts2.some(([x, z]) => bikeShareAt(x, z, 'prop'))) return 'bikeShare';
          if (clashes(rect)) return 'overlap';
          return null;
        };
        for (let u0 = 1; u0 + R.stall <= L - 1;) {
          const u = u0 + R.stall / 2;
          const ku = Math.round(u);
          const pm = curbK(Math.min(n, ku));
          let why = null, site = null, legal = null;
          if (!pm) why = 'curb';
          else {
            const mid0 = pm.v - R.gutter - R.width / 2;
            legal = legality(road, key, ...at(u, mid0), nx, nz);
            if (legal.why) why = legal.why;
            else {
              const ps = [curbK(Math.max(0, Math.round(u0))), pm, curbK(Math.min(n, Math.round(u0 + R.stall)))];
              if (ps.some((p) => !p || p.block !== pm.block)) why = 'curb';
              else {
                const curbs = ps.map((p) => p.v), curb = Math.min(...curbs);
                if (Math.max(...curbs) - curb > 0.6) why = 'curb';
                else {
                  // against the curb, or floating beyond a curbside cycle track (on the floating streets only; elsewhere
                  // a stall at a cycle track's curb stands in it, and is rejected)
                  const track = floats ? trackFrom(u0, u0 + R.stall, curb) : 0;
                  const outer = track > 0 ? curb - track - R.trackGap : curb - R.gutter, inner = outer - R.width, mid = (outer + inner) / 2;
                  const [cx, cz] = at(u, mid);
                  const rect = { cx, cz, tx, tz, nx, nz, hl: R.stall / 2 - 0.3, hd: R.width / 2 };
                  site = { rect, curb, cx, cz, track };
                  why = track < 0 ? 'bikeway' : check(rect, curb, u, pm.block);
                }
              }
            }
          }
          if (why) {
            rejected[why]++;
            u0 += R.step;
            continue;
          }
          const s = { x: site.cx, z: site.cz, tx: tx * travel, tz: tz * travel, nx, nz, road: road.name, side, cat: legal.cat,
            permit: legal.permit, curb: site.curb, rect: site.rect, rank: road.rank, track: site.track };
          if (site.track > 0) floating++;
          stalls.push(s);
          addPlaced(s);
          cats[legal.cat] = (cats[legal.cat] || 0) + 1;
          u0 += R.stall;
        }
      }
    }
  }
  return { stalls, rejected, stats: { stalls: stalls.length, cats, floating } };
}

// The traffic lanes' centre lines from the road graph alone (road-network.js lanesOf on GEO.roadGraph's links, along
// their polylines), for node: the browser audits against the lanes it actually built (parked-cars.js)
function laneSegments(GEO) {
  const RG = GEO.roadGraph;
  const pos = [];
  for (let i = 0; i < RG.nodes.length; i += 2) pos.push({ x: RG.nodes[i], z: RG.nodes[i + 1] });
  const laneOffsets = (half) => (half >= 10.0 ? [-7.2, -3.6, 0, 3.6, 7.2] : half >= 8.5 ? [-5.4, -1.8, 1.8, 5.4]
    : half >= 6.8 ? [-3.6, 0, 3.6] : half >= 4.4 ? [-1.8, 1.8] : null);
  const out = [];
  for (const [a, b, , w0, , dir, inner, rank] of RG.links) {
    const w = w0 > 3 ? w0 : rank >= 3 ? 10.5 : 7.4, half = w / 2;
    let offs;
    if (dir !== 0) offs = (laneOffsets(half) || [0]).map((o) => o * (dir > 0 ? 1 : -1));
    else { const each = half >= 8.5 ? [1.8, 5.4] : [1.8]; offs = [...each, ...each.map((o) => -o)]; }
    const pts = [pos[a]];
    for (let k = 0; k < inner.length; k += 2) pts.push({ x: inner[k], z: inner[k + 1] });
    pts.push(pos[b]);
    for (let k = 0; k + 1 < pts.length; k++) {
      const p = pts[k], q = pts[k + 1], L = Math.hypot(q.x - p.x, q.z - p.z);
      if (L < 1e-6) continue;
      const rx = -(q.z - p.z) / L, rz = (q.x - p.x) / L;
      for (const o of offs) out.push([p.x + rx * o, p.z + rz * o, q.x + rx * o, q.z + rz * o]);
    }
  }
  return out;
}

Object.assign(window.CITY, { parkingStalls, PARKING_RULES: RULES, parkingLaneSegments: laneSegments, parkingStreetKey: streetKey,
  parkingSegRectDist: segRectDist });
})();
