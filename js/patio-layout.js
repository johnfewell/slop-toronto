(function () {
// js/patio-layout.js
// CaféTO patios (js/toronto-cafeto.js, tools/build-cafeto.mjs) placed by explicit rules. The City's records are business
// address points (they fall inside the building, 10-25 m from the street's centre line) with the intervention type, not
// patio footprints, so a footprint is derived here from the frontage, the curb, the building face and the 2026 CaféTO
// guidelines, and anything that cannot meet them is rejected and counted, never moved somewhere arbitrary. See
// docs/cafeto-patios.md for the rules and their sources.
//
// - Sidewalk café: a railed rectangle against the building face on the business's address street, on the same curb
//   island and the City's mapped sidewalk, leaving the pedestrian clearway (2.1 m, plus 0.5 m back from the curb) and the
//   simulated walkers' lines clear, an entrance gap at the address, and clear of corners, furniture, trees, stops and
//   subway entrances.
// - Curb lane café: a 1.8 m platform in the curb lane against the curb with a barrier on its road sides, kept clear of
//   the game's traffic lanes, streetcar tracks and bikeways, set back from intersections, laneways, crossings and
//   transit stops as the City requires (direction-aware), and from hydrants and street furniture.
// - Private property patios are never placed (they are on private land the game does not model).
//
// The page does not run this at startup: tools/build-patios.mjs keeps its result, computed in the browser with the
// city's own inputs, in js/toronto-patios.js, and js/cafeto-patios.js loads this script only to recompute (?patios=layout
// or check, or when the inputs it was built from have changed). tests/cafeto.test.mjs replays it in node.

const NORM = [[/\bstreet\b/g, 'st'], [/\bavenue\b/g, 'ave'], [/\broad\b/g, 'rd'], [/\bwest\b/g, 'w'], [/\beast\b/g, 'e'],
  [/\bboulevard\b/g, 'blvd'], [/\bcrescent\b/g, 'cres'], [/\bdrive\b/g, 'dr'], [/\bplace\b/g, 'pl'], [/\bsquare\b/g, 'sq'],
  [/\bterrace\b/g, 'ter'], [/\bnorth\b/g, 'n'], [/\bsouth\b/g, 's'], [/\bcircle\b/g, 'crcl'], [/\bgardens\b/g, 'gdns'],
  [/\blane\b/g, 'ln'], [/\bcourt\b/g, 'crt'], [/\bparkway\b/g, 'pkwy'], [/\bquay\b/g, 'quay']];
function streetKey(name) {
  let s = String(name || '').toLowerCase().trim();
  for (const [re, to] of NORM) s = s.replace(re, to);
  return s.replace(/[^a-z0-9]/g, '');
}

// The rule constants, each with its source (docs/cafeto-patios.md).
const RULES = Object.freeze({
  clearway: 2.1, // CaféTO: pedestrian clearway on most sidewalks
  curbSetback: 0.3, // game choice: the clearway starts beyond the curb stone (CaféTO's 0.5 m is for curbside cafés)
  walkerLines: [1.7, 2.8], // game: the walkers' lines beyond the road's half width (pedestrian-routes.js)
  sidewalkDepthMax: 2.4, // game choice: two rows of bistro tables at most
  sidewalkDepthMin: 0.9, // game choice: one row of small tables against the wall
  sidewalkLengths: [6, 4.5], // game choice: a storefront (the data has no frontage widths)
  entranceGap: 1.2, // CaféTO: an accessible entrance at least 1 m wide (the address is taken as the door)
  cornerClear: 3, // game choice: clear of the corner's curb ramps
  stopClear: 4, // CaféTO clearances: 2.5 m from a transit stop pole, and the 2.4 m boarding area beside it
  crossingClear: 4, // CaféTO clearances: 3 m from an intersection or crossover, plus the crossing's own width
  curbWidth: 1.8, // CaféTO: the average curb lane café width
  curbGap: 0.1, // the gutter left open for drainage under/at the platform's curb edge
  curbLengths: [7, 5], // game choice: a storefront and a bit (CaféTO: the business frontage, up to 12 m)
  carClear: 1.5, // game: a lane's centre keeps a bus's half width & a little clear (cycling.js CAR_CLEAR)
  streetcarClear: 1.8, // game: a Flexity's half width (1.27 m) + 0.5 m from the track's centre
  signalAhead: 30.5, unsignalAhead: 15, junctionBehind: 9, // CaféTO: from the closest curb edge of an intersection
  laneway: 1, laneGap: 8, // CaféTO: 1 m from a driveway/laneway; a curb gap narrower than 8 m is taken as one
  crossingAhead: 15, crossingBehind: 9, // CaféTO: pedestrian crossovers (and the midblock signals)
  stopAhead: 30, stopBehind: 18, // CaféTO: TTC stops
  slides: [0, 1.5, -1.5, 3, -3], // along the frontage (m): the address is the door, not the frontage's centre
  flankReach: 22 // a corner business: its address within this of the flanking street's centre line
});

// The game's traffic lanes on a road (road-network.js laneOffsets/lanesOf): the outermost lane centre's offset from the
// centre line on one side
function outerLane(road) {
  const w = road.w > 3 ? road.w : road.rank >= 3 ? 10.5 : 7.4, half = w / 2;
  if (road.dir) return half >= 10 ? 7.2 : half >= 8.5 ? 5.4 : half >= 6.8 ? 3.6 : half >= 4.4 ? 1.8 : 0;
  return half >= 8.5 ? 5.4 : 1.8;
}

function patioSites(records, deps) {
  const { nearestRoads, blockAt, buildingAt, onSidewalk = () => null, obstacles = [], stops = [], crossings = [],
    junctions = [], railDist = () => Infinity, bikewayAt = () => false, bikeShareAt = null, rules = {} } = deps;
  const R = { ...RULES, ...rules };
  // point obstacles by kind -> clearance (m), in a 16 m grid
  const GRID = 16, grid = new Map();
  for (const o of obstacles) {
    const k = Math.floor(o.x / GRID) * 100003 + Math.floor(o.z / GRID);
    (grid.get(k) || grid.set(k, []).get(k)).push(o);
  }
  const near = (x, z, reach, fn) => {
    for (let i = Math.floor((x - reach) / GRID); i <= Math.floor((x + reach) / GRID); i++) {
      for (let j = Math.floor((z - reach) / GRID); j <= Math.floor((z + reach) / GRID); j++) {
        for (const o of grid.get(i * 100003 + j) || []) if (fn(o)) return o;
      }
    }
    return null;
  };
  const placed = [];
  const sites = [];
  const rejected = { frontage: 0, curb: 0, narrow: 0, sidewalk: 0, corner: 0, obstruction: 0, overlap: 0, lane: 0,
    streetcar: 0, bikeway: 0, junction: 0, crossing: 0, stop: 0, unsupported: 0 };
  const reasons = {}; // record id -> reason, for the audit
  const blockers = {}; // '<type> <furniture kind>' -> obstruction rejections it caused (the last one met)

  // a rectangle in the frame of a frontage: centre (cx, cz), along unit (tx, tz), out unit (nx, nz), half sizes
  const rect = (cx, cz, tx, tz, nx, nz, hl, hd) => ({ cx, cz, tx, tz, nx, nz, hl, hd });
  const inRect = (r, x, z, pad = 0) => {
    const dx = x - r.cx, dz = z - r.cz;
    return Math.abs(dx * r.tx + dz * r.tz) <= r.hl + pad && Math.abs(dx * r.nx + dz * r.nz) <= r.hd + pad;
  };
  const rectDist = (r, x, z) => {
    const dx = x - r.cx, dz = z - r.cz;
    const a = Math.max(0, Math.abs(dx * r.tx + dz * r.tz) - r.hl), b = Math.max(0, Math.abs(dx * r.nx + dz * r.nz) - r.hd);
    return Math.hypot(a, b);
  };
  const samples = (r, step = 0.5) => {
    const out = [];
    const nu = Math.max(1, Math.ceil((2 * r.hl) / step)), nv = Math.max(1, Math.ceil((2 * r.hd) / step));
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      const u = -r.hl + (2 * r.hl * i) / nu, v = -r.hd + (2 * r.hd * j) / nv;
      out.push([r.cx + r.tx * u + r.nx * v, r.cz + r.tz * u + r.nz * v]);
    }
    return out;
  };
  const overlaps = (a, b, gap) => {
    // separating axes of two oriented rectangles
    for (const [ax, az] of [[a.tx, a.tz], [a.nx, a.nz], [b.tx, b.tz], [b.nx, b.nz]]) {
      const ra = a.hl * Math.abs(a.tx * ax + a.tz * az) + a.hd * Math.abs(a.nx * ax + a.nz * az);
      const rb = b.hl * Math.abs(b.tx * ax + b.tz * az) + b.hd * Math.abs(b.nx * ax + b.nz * az);
      if (Math.abs((b.cx - a.cx) * ax + (b.cz - a.cz) * az) > ra + rb + gap) return false;
    }
    return true;
  };

  for (const record of records) {
    const reject = (why) => { rejected[why]++; reasons[record.id] = why; };
    if (record.type !== 'sidewalk' && record.type !== 'curb') { reject('unsupported'); continue; }
    const want = streetKey(record.street);
    const roads = nearestRoads(record.x, record.z, 45).filter((r) => !r.road.raised);
    const road0 = want && roads.find((r) => streetKey(r.road.name) === want);
    if (!road0 || road0.dist < 2) { reject('frontage'); continue; }
    let why = null, blocker = null;
    const note = (w) => { if (!why || ORDER.indexOf(w) > ORDER.indexOf(why)) why = w; };
    // the footprint on one frontage (the street `road`, on the address's side of it), or null
    const attempt = (road) => {
    let site = null;
    const ox = record.x - road.px, oz = record.z - road.pz, d0 = Math.hypot(ox, oz);
    const tx = road.dx, tz = road.dz;
    // out of the road toward the business: the side of the road the address is on
    const side = Math.sign(ox * -tz + oz * tx) || 1;
    const nx = -tz * side, nz = tx * side;
    const at = (u, v) => [road.px + tx * u + nx * v, road.pz + tz * u + nz * v];
    // the curb (first island out from the centre line, past any median) and the building face at u along
    const profile = (u) => {
      let curb = null, block = null, face = null;
      for (let v = 0.2; v <= Math.max(d0, 6) + 4; v += 0.1) {
        const [x, z] = at(u, v), b = blockAt(x, z);
        if (b && !b.median) { curb = v; block = b; break; }
      }
      if (curb === null) return null;
      // (to 1 cm: the curb lies within the last 0.1 m step)
      for (let lo = curb - 0.1, k = 0; k < 4; k++) {
        const mid = (lo + curb) / 2, [x, z] = at(u, mid);
        if (blockAt(x, z) === block) curb = mid; else lo = mid;
      }
      for (let v = curb + 0.3; v <= curb + 15; v += 0.1) {
        const [x, z] = at(u, v);
        if (blockAt(x, z) !== block) break;
        if (buildingAt(x, z)) { face = v; break; }
      }
      return { curb, block, face };
    };
    const p0 = profile(0);
    if (!p0) { note('curb'); return null; }
    const block = p0.block;
    const along = (u, v) => at(u, v); // (readability)
    // how far the island runs along the curb from u in direction dir (+1/-1), and the gap after it (to `limit`)
    const islandRun = (u, dir, v, limit) => {
      let run = null;
      for (let s = 0; s <= limit; s += 0.25) {
        const [x, z] = along(u + dir * s, v);
        if (blockAt(x, z) !== block) { run = Math.max(0, s - 0.25); break; }
      }
      if (run === null) return { run: Infinity, gap: 0 };
      let gap = limit;
      for (let s = run + 0.25; s <= run + 40; s += 0.25) {
        const [x, z] = along(u + dir * s, v), b = blockAt(x, z);
        if (b && !b.median) { gap = s - run - 0.25; break; }
      }
      return { run, gap };
    };
    // nothing within `pad` of the footprint's edge (a sidewalk café), or within the City's platform clearance (pad null)
    const clearOf = (r, pad = null) => {
      const o = near(r.cx, r.cz, r.hl + r.hd + 8, (o) => {
        const clear = pad === null ? o.curbClear : pad;
        return clear > 0 && rectDist(r, o.x, o.z) < clear + o.size;
      });
      if (o) { blocker = o.kind; return false; }
      if (bikeShareAt && samples(r, 1).some(([x, z]) => bikeShareAt(x, z, 'prop'))) { blocker = 'bikeShare'; return false; }
      return true;
    };
    // sidewalk cafés keep 0.4 m apart; neighbours' curb lane platforms may run on end to end, as on Ossington
    const free = (r, gap) => !placed.some((q) => overlaps(q.rect, r, gap));

    if (record.type === 'sidewalk') {
      outer: for (const L of R.sidewalkLengths) {
        for (const u of R.slides) {
          const ps = [profile(u - L / 2), profile(u), profile(u + L / 2)];
          if (ps.some((p) => !p || p.block !== block)) { note('curb'); continue; }
          if (ps.some((p) => p.face === null)) { note('sidewalk'); continue; }
          const curb = Math.max(...ps.map((p) => p.curb)), face = Math.min(...ps.map((p) => p.face));
          // the furniture zone by the curb (trees, poles, hydrants, rings...) and the clearway beyond it
          let furniture = curb;
          near(road.px + tx * u, road.pz + tz * u, L / 2 + curb + 6, (o) => {
            const dx = o.x - road.px, dz = o.z - road.pz, s = dx * tx + dz * tz - u, v = dx * nx + dz * nz;
            if (Math.abs(s) <= L / 2 + 0.5 + o.size && v > curb - 0.5 && v < curb + 3) furniture = Math.max(furniture, v + o.size);
            return false;
          });
          // the simulated walkers' lines (pedestrian-routes.js: the road's half width + 1.7 and + 2.8 m) that fit before
          // the building stay clear: the inner one always, the outer one unless the café gives it up (pedestrian AABB)
          const wall = face - 0.3;
          const lines = R.walkerLines.map((inset) => road.road.w / 2 + inset).filter((v) => v + 0.4 < face && v - 0.4 > curb);
          // (a street off the grid's axes would need a far larger box to give a line up: keep all of them clear there)
          const square = Math.min(Math.abs(tx), Math.abs(tz)) < 0.05;
          const walkers = lines.length ? (square ? lines[0] : lines[lines.length - 1]) + 0.4 : curb;
          const inner = Math.max(curb + R.curbSetback + R.clearway, furniture + R.clearway, walkers + 0.1);
          const depth = Math.min(R.sidewalkDepthMax, wall - inner);
          if (depth < R.sidewalkDepthMin) { note('narrow'); continue; }
          const [cx, cz] = at(u, wall - depth / 2);
          const r = rect(cx, cz, tx, tz, nx, nz, L / 2, depth / 2);
          // on the island, off the buildings, on the City's sidewalk where it is mapped (80% of the footprint)
          const pts = samples(r);
          if (pts.some(([x, z]) => blockAt(x, z) !== block || buildingAt(x, z))) { note('sidewalk'); continue; }
          const mapped = pts.map(([x, z]) => onSidewalk(x, z, block));
          if (mapped.some((m) => m !== null) && mapped.filter((m) => m).length < 0.8 * pts.length) { note('sidewalk'); continue; }
          // the clearway beside it: on the island, nothing standing in it
          const [wx, wz] = at(u, inner - R.clearway / 2);
          const way = rect(wx, wz, tx, tz, nx, nz, L / 2 + 0.5, R.clearway / 2);
          if (samples(way).some(([x, z]) => blockAt(x, z) !== block || buildingAt(x, z))) { note('narrow'); continue; }
          // clear of the corner's ramps: the island carries on past both ends
          if (islandRun(u, 1, inner, L / 2 + R.cornerClear).run <= L / 2 + R.cornerClear ||
              islandRun(u, -1, inner, L / 2 + R.cornerClear).run <= L / 2 + R.cornerClear) { note('corner'); continue; }
          if (!clearOf(r, 0.6) || !clearOf(way, 0.1)) { note('obstruction'); continue; }
          // the crossings' landings and the stops' boarding areas on this side, along the street
          const sideAlong = (list, reach) => list.some((p) => {
            const dx = p.x - road.px, dz = p.z - road.pz, v = dx * nx + dz * nz;
            return v > -2 && v < curb + 8 && Math.abs(dx * tx + dz * tz - u) < L / 2 + reach;
          });
          if (sideAlong(crossings, R.crossingClear)) { note('crossing'); continue; }
          if (sideAlong(stops, R.stopClear)) { note('stop'); continue; }
          if (!free(r, 0.4)) { note('overlap'); continue; }
          // the walkers' outer line this café stands on, given up along this edge (cafeto-patios.js)
          const outerLine = lines.length > 1 && square && lines[1] + 0.4 > inner ? lines[1] : null;
          site = { ...record, kind: 'sidewalk', cx, cz, tx, tz, nx, nz, length: L, depth, along: u, wall, inner, curb, face,
            yaw: Math.atan2(nx, nz), rect: r, roadName: road.road.name, entrance: -u, outerLine };
          break outer;
        }
      }
    } else {
      // the direction the curb lane's traffic runs, for "approaching" (ahead) and "beyond" (behind)
      const rightOfT = side > 0 ? 1 : -1; // (the curb is to the right of +t when nx = -tz)
      const travel = road.road.dir ? road.road.dir : rightOfT; // +1: along +t, -1: against it
      const lane = outerLane(road.road);
      outer: for (const L of R.curbLengths) {
        for (const u of R.slides) {
          const ps = [profile(u - L / 2), profile(u), profile(u + L / 2)];
          if (ps.some((p) => !p || p.block !== block)) { note('curb'); continue; }
          const curbs = ps.map((p) => p.curb), curb = Math.min(...curbs);
          if (Math.max(...curbs) - curb > 0.6) { note('curb'); continue; }
          const outerEdge = curb - R.curbGap, innerEdge = outerEdge - R.curbWidth;
          if (innerEdge < lane + R.carClear) { note('lane'); continue; }
          const [cx, cz] = at(u, (outerEdge + innerEdge) / 2);
          const r = rect(cx, cz, tx, tz, nx, nz, L / 2, R.curbWidth / 2);
          const pts = samples(r);
          if (pts.some(([x, z]) => blockAt(x, z))) { note('curb'); continue; }
          if (pts.some(([x, z]) => railDist(x, z) < R.streetcarClear)) { note('streetcar'); continue; }
          if (pts.some(([x, z]) => bikewayAt(x, z))) { note('bikeway'); continue; }
          // intersections & laneways: the island's ends along the sidewalk beside the curb
          let bad = false;
          for (const dir of [1, -1]) {
            const ahead = dir === travel;
            const { run, gap } = islandRun(u + dir * L / 2, dir, curb + 0.6, 60);
            if (run === Infinity) continue;
            let need;
            if (gap < R.laneGap) need = R.laneway;
            else if (!ahead) need = R.junctionBehind;
            else {
              const [ex, ez] = along(u + dir * (L / 2 + run + gap / 2), curb);
              const signal = junctions.some((j) => Math.hypot(j.x - ex, j.z - ez) < 30);
              need = signal ? R.signalAhead : R.unsignalAhead;
            }
            if (run < need) { bad = true; break; }
          }
          if (bad) { note('junction'); continue; }
          // crossings & stops along this side: ahead/behind of the platform
          const alongOf = (p) => {
            const dx = p.x - road.px, dz = p.z - road.pz;
            return { s: dx * tx + dz * tz - u, v: dx * nx + dz * nz };
          };
          const tooClose = (list, aheadD, behindD, lateral) => list.some((p) => {
            const { s, v } = alongOf(p);
            if (!lateral(v)) return false;
            const gapAhead = s * travel - L / 2, gapBehind = -s * travel - L / 2;
            if (gapAhead >= 0) return gapAhead < aheadD;
            if (gapBehind >= 0) return gapBehind < behindD;
            return true;
          });
          if (tooClose(crossings, R.crossingAhead, R.crossingBehind, (v) => Math.abs(v) < curb + 6)) { note('crossing'); continue; }
          if (tooClose(stops, R.stopAhead, R.stopBehind, (v) => v > 0 && v < curb + 8)) { note('stop'); continue; }
          if (!clearOf(r)) { note('obstruction'); continue; }
          if (!free(r, -0.05)) { note('overlap'); continue; }
          site = { ...record, kind: 'curb', cx, cz, tx, tz, nx, nz, length: L, depth: R.curbWidth, along: u, curb,
            yaw: Math.atan2(nx, nz), rect: r, roadName: road.road.name, travel, entrance: 0 };
          break outer;
        }
      }
    }
    return site;
    };
    let site = attempt(road0);
    // a corner business's sidewalk café is often along the flanking street (seen in the 2025 aerials): the nearest
    // other street, if the address is near it
    if (!site && record.type === 'sidewalk') {
      const flank = roads.find((r) => r !== road0 && streetKey(r.road.name) !== want && r.dist < R.flankReach && r.dist >= 2);
      if (flank) { site = attempt(flank); if (site) site.flank = true; }
    }
    if (site) { placed.push(site); sites.push(site); }
    else {
      reject(why || 'obstruction');
      if ((why || 'obstruction') === 'obstruction' && blocker) blockers[`${record.type} ${blocker}`] = (blockers[`${record.type} ${blocker}`] || 0) + 1;
    }
  }
  return { sites, rejected, reasons, blockers };
}
// the most specific failure a record reached decides its reason (a later check passed the earlier ones)
const ORDER = ['curb', 'sidewalk', 'narrow', 'lane', 'streetcar', 'bikeway', 'corner', 'junction', 'crossing', 'stop', 'obstruction', 'overlap'];

// What stands near a curb: [kind, half size (m), curb lane platform clearance from its edge (m, CaféTO's utility &
// infrastructure clearances; 0: not on the curb's side)]. A sidewalk café keeps 0.6 m from the edge of each.
const FURNITURE = {
  hydrant: [0.25, 1.2], bikeRing: [0.4, 0], shelter: [1.8, 5.0], litterBin: [0.4, 1.0], postBox: [0.35, 1.0],
  parkSign: [0.5, 0], bench: [0.9, 1.0], parkingMeter: [0.3, 1.0], wayfinding: [0.3, 3.0], infoPillar: [0.75, 3.0],
  tree: [0.6, 0], subwayEntrance: [2.5, 0], bikeShare: [1.0, 1.0]
};

// The inputs patioSites needs, from what the city has loaded (the same in the browser and in node's tests):
// GEO (buildings, props, street trees, streetcar rails), blockAt/nearestRoads, the signals & crossovers, the TTC's
// stops and subway entrances, the City's sidewalks and the bikeways. `furniture`: placed sites [{x, z, kind}] (benches,
// pay stations, wayfinding...); `blocked(x, z)`: anything else solid (landmarks); `bikeShareAt` (bike-share.js).
function patioDeps(CITY, { furniture = [], blocked = null, bikeShareAt = null } = {}) {
  const { GEO, blockAt, nearestRoads } = CITY;
  // the buildings' parts as turned rectangles in a 32 m grid (buildings.js makes its colliders from the same parts)
  const BG = 32, bgrid = new Map();
  for (const [cx, cz, ang, parts, h] of GEO.buildings || []) {
    if (!(h > 2)) continue;
    const cs = Math.cos(ang), sn = Math.sin(ang);
    for (const [u0, u1, v0, v1] of parts) {
      const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2, hx = (u1 - u0) / 2, hz = (v1 - v0) / 2;
      if (hx < 0.5 || hz < 0.5) continue;
      const x = cx + uc * cs + vc * sn, z = cz - uc * sn + vc * cs;
      const ex = Math.abs(cs) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
      const part = { x, z, cs, sn, hx, hz };
      for (let i = Math.floor((x - ex) / BG); i <= Math.floor((x + ex) / BG); i++) {
        for (let j = Math.floor((z - ez) / BG); j <= Math.floor((z + ez) / BG); j++) {
          const k = i * 100003 + j;
          (bgrid.get(k) || bgrid.set(k, []).get(k)).push(part);
        }
      }
    }
  }
  const buildingAt = (x, z) => {
    for (const p of bgrid.get(Math.floor(x / BG) * 100003 + Math.floor(z / BG)) || []) {
      const dx = x - p.x, dz = z - p.z;
      // world -> the part's frame (buildings.js: x = cx + u cs + v sn, z = cz - u sn + v cs)
      if (Math.abs(dx * p.cs - dz * p.sn) <= p.hx && Math.abs(dx * p.sn + dz * p.cs) <= p.hz) return true;
    }
    return !!blocked?.(x, z);
  };
  const obstacles = [];
  const add = (x, z, kind) => {
    const f = FURNITURE[kind];
    if (f) obstacles.push({ x, z, kind, size: f[0], curbClear: f[1] });
  };
  for (const [kind, pts] of Object.entries(GEO.props || {})) for (let i = 0; i + 1 < pts.length; i += 2) add(pts[i], pts[i + 1], kind);
  const T = GEO.streetTrees || [];
  for (let i = 0; i + 3 < T.length; i += 4) add(T[i], T[i + 1], 'tree');
  for (const s of furniture) add(s.x, s.z, s.kind);
  const SUB = CITY.GEO_SUBWAY?.entrances || [];
  for (const e of SUB) add(e[0], e[1], 'subwayEntrance');
  // the TTC's stops: GTFS (buses & streetcars) and OpenStreetMap's streetcar stops
  const stops = [];
  const S = CITY.GEO_TRANSIT?.stops || [];
  for (let i = 0; i + 1 < S.length; i += 2) stops.push({ x: S[i], z: S[i + 1] });
  const TS = GEO.tramStops || [];
  for (let i = 0; i + 2 < TS.length; i += 3) stops.push({ x: TS[i], z: TS[i + 1] });
  const crossings = [...(CITY.SIGNAL_CROSSINGS || []), ...(CITY.PXOS || [])].map((c) => ({ x: c.x, z: c.z }));
  const junctions = (CITY.SIGNAL_JUNCTIONS || []).flatMap((j) => (j.pts?.length ? j.pts : [j]).map((p) => ({ x: p.x, z: p.z })));
  // streetcar track centre lines in a 24 m grid
  const RG = 24, rgrid = new Map();
  for (const [kind, , , , flat] of GEO.rails || []) {
    if (kind !== 0) continue;
    for (let i = 0; i + 3 < flat.length; i += 2) {
      const s = [flat[i], flat[i + 1], flat[i + 2], flat[i + 3]];
      for (let a = Math.floor((Math.min(s[0], s[2]) - 3) / RG); a <= Math.floor((Math.max(s[0], s[2]) + 3) / RG); a++) {
        for (let b = Math.floor((Math.min(s[1], s[3]) - 3) / RG); b <= Math.floor((Math.max(s[1], s[3]) + 3) / RG); b++) {
          const k = a * 100003 + b;
          (rgrid.get(k) || rgrid.set(k, []).get(k)).push(s);
        }
      }
    }
  }
  const railDist = (x, z) => {
    let best = Infinity;
    for (const [ax, az, bx, bz] of rgrid.get(Math.floor(x / RG) * 100003 + Math.floor(z / RG)) || []) {
      const ex = bx - ax, ez = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
      best = Math.min(best, Math.hypot(ax + ex * t - x, az + ez * t - z));
    }
    return best;
  };
  // the City's mapped sidewalk under (x, z) on its island: true / false, or null where the island has none mapped
  const pieces = CITY.sidewalkPieceMap || (CITY.sidewalkPieces && CITY.SIDEWALKS ? CITY.sidewalkPieces(CITY.SIDEWALKS, GEO.blocks) : null);
  const inRing = (ring, x, z) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
  };
  const onSidewalk = (x, z, block) => {
    const list = pieces?.get(block.id);
    if (!list) return null;
    return list.some((p) => inRing(p.outer, x, z) && !p.holes.some((h) => inRing(h, x, z)));
  };
  const bikewayAt = (x, z) => (CITY.bikewayIntrusion ? CITY.bikewayIntrusion(x, z, 0.05) > 0 : false);
  return { nearestRoads, blockAt, buildingAt, onSidewalk, obstacles, stops, crossings, junctions, railDist, bikewayAt, bikeShareAt };
}

Object.assign(window.CITY, { patioSites, patioDeps, PATIO_RULES: RULES, PATIO_FURNITURE: FURNITURE,
  patioStreetKey: streetKey, patioOuterLane: outerLane });
})();
