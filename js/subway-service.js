(function () {
const { THREE, openTransitDoors, stepTransitDoors } = window.CITY;
const SUBWAY_RIDE_SHAPE = { carLength: 23, gap: 0.6, cars: 6, width: 3.1, floor: 1.1 };
const TRAIN_LENGTH = 6 * 23 + 5 * 0.6;

// Rail-top height s metres along a route: its depth profile ([[s, y], ...], linear between: a track ride from
// js/toronto-subway-topology.js) or the one level of the viaduct ride
function subwayRailY(route, s) {
  const P = route.profile;
  if (!P) return route.y;
  if (s <= P[0][0]) return P[0][1];
  for (let i = 1; i < P.length; i++) {
    if (s <= P[i][0]) { const [s0, y0] = P[i - 1], [s1, y1] = P[i]; return y0 + (y1 - y0) * ((s - s0) / ((s1 - s0) || 1)); }
  }
  return P.at(-1)[1];
}

function sampleSubwayRide(route, s, out = {}) {
  s = Math.max(0, Math.min(route.len, s));
  let lo = 0, hi = route.pts.length - 1;
  while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (route.cum[mid] <= s) lo = mid; else hi = mid; }
  const a = route.pts[lo], b = route.pts[hi], length = route.cum[hi] - route.cum[lo] || 1;
  const t = (s - route.cum[lo]) / length;
  out.x = a.x + (b.x - a.x) * t;
  out.y = subwayRailY(route, s);
  out.z = a.z + (b.z - a.z) * t;
  out.yaw = Math.atan2(b.x - a.x, b.z - a.z);
  return out;
}

function buildSubwayRidePaths(stations, viaduct) {
  if (!viaduct || stations.length !== 2) return [];
  const bridge = viaduct.pts[0].x < viaduct.pts.at(-1).x ? viaduct.pts : viaduct.pts.slice().reverse();
  const [west, east] = stations;
  const direction = (a, b) => { const l = Math.hypot(b.x - a.x, b.z - a.z); return { x: (b.x - a.x) / l, z: (b.z - a.z) / l }; };
  const w = direction(west, bridge[0]), e = direction(bridge.at(-1), east);
  const controls = [];
  // Long straight platforms fit the entire consist. Curves join the existing viaduct outside those platforms.
  for (let s = -300; s <= 100; s += 20) controls.push(new THREE.Vector3(west.x + w.x * s, 0, west.z + w.z * s));
  for (const p of bridge) controls.push(new THREE.Vector3(p.x, 0, p.z));
  for (let s = -100; s <= 300; s += 20) controls.push(new THREE.Vector3(east.x + e.x * s, 0, east.z + e.z * s));
  const curve = new THREE.CatmullRomCurve3(controls, false, 'centripetal');
  curve.arcLengthDivisions = 3000;
  const centre = curve.getSpacedPoints(Math.ceil(curve.getLength() / 2));
  return [0, 1].map((dir) => {
    const ordered = dir === 0 ? centre : centre.slice().reverse();
    const pts = ordered.map((p, i) => {
      const a = ordered[Math.max(0, i - 1)], b = ordered[Math.min(ordered.length - 1, i + 1)];
      const d = direction(a, b);
      return { x: p.x - d.z * 2, z: p.z + d.x * 2 };
    });
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    const nearest = (p) => {
      let best = Infinity, at = 0;
      for (let i = 0; i < pts.length; i++) { const d = Math.hypot(pts[i].x - p.x, pts[i].z - p.z); if (d < best) { best = d; at = cum[i]; } }
      return at;
    };
    const origin = stations[dir], destination = stations[1 - dir];
    const ends = bridge.map((p) => nearest(p));
    return { id: `line2-${dir}`, dir, pts, cum, len: cum.at(-1), y: viaduct.railY, origin, destination,
      calls: [nearest(origin) + TRAIN_LENGTH / 2, nearest(destination) + TRAIN_LENGTH / 2],
      open0: Math.min(...ends) + 1, open1: Math.max(...ends) - 1 };
  });
}

// A track ride (js/toronto-subway-topology.js rides[], geometry 'track'): its two directed routes along the
// OpenStreetMap track, resampled every 2 m, with the depth profile. Index 0 runs from stations[0] to stations[1].
// Never in the open (open0/open1 below any distance), so the camera stays on the interior layer throughout.
function buildSubwayTrackPaths(ride, stations) {
  if (!ride || !ride.supported || ride.geometry !== 'track' || stations.length !== 2) return [];
  return stations.map((origin, dir) => {
    const destination = stations[1 - dir];
    const d = ride.directions.find((x) => x.from === origin.id && x.to === destination.id);
    if (!d) return null;
    const raw = [];
    for (let i = 0; i < d.track.length; i += 2) raw.push({ x: d.track[i], z: d.track[i + 1] });
    const rawCum = [0];
    for (let i = 1; i < raw.length; i++) rawCum.push(rawCum[i - 1] + Math.hypot(raw[i].x - raw[i - 1].x, raw[i].z - raw[i - 1].z));
    const total = rawCum.at(-1), n = Math.max(1, Math.ceil(total / 2)), pts = [], cum = [];
    for (let k = 0, j = 1; k <= n; k++) {
      const s = (total * k) / n;
      while (j < raw.length - 1 && rawCum[j] < s) j++;
      const a = raw[j - 1], b = raw[j], t = (s - rawCum[j - 1]) / ((rawCum[j] - rawCum[j - 1]) || 1);
      pts.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }); cum.push(s);
    }
    const route = { id: `${ride.id}-${dir}`, dir, pts, cum, len: total, profile: d.profile, y: 0, origin, destination,
      line: ride.line, direction: d.direction, compass: d.compass, segment: d.segment,
      calls: [d.calls[0] + TRAIN_LENGTH / 2, d.calls[1] + TRAIN_LENGTH / 2], open0: -2, open1: -1 };
    route.y = subwayRailY(route, d.calls[0]);
    return route;
  }).filter(Boolean);
}

function createSubwayRideService(routes, { headway = () => 150, duration = () => 110, canRecycle = () => true, idPrefix = 'subway-line2' } = {}) {
  const a = {}, b = {};
  const cars = routes.map((track, i) => {
    const train = { id: `${idPrefix}-${i}`, run: 0, track, s: track.calls[0], k: 1, speed: 0,
      y: track.y, ridden: false, lastPassengerStop: 1, cooldown: 0,
      sections: Array.from({ length: 6 }, () => ({ x: 0, y: track.y, z: 0, yaw: 0, s: 0 })) };
    openTransitDoors(train, 0, 20);
    return train;
  });
  function place(train) {
    for (let i = 0; i < 6; i++) {
      const front = train.s - i * 23.6;
      sampleSubwayRide(train.track, front, a); sampleSubwayRide(train.track, front - 23, b);
      Object.assign(train.sections[i], { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2,
        yaw: Math.atan2(a.x - b.x, a.z - b.z), s: front - 11.5 });
    }
    train.y = train.sections[0].y; // (the audio's rail height: js/audio-sources.js)
  }
  function prepare(dir) {
    const train = cars[dir];
    if (!train || train.ridden) return null;
    train.s = train.track.calls[0]; train.k = 1; train.cooldown = 0; train.run++;
    openTransitDoors(train, 0, 20);
    place(train);
    return train;
  }
  function update(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(0.1, dt);
    for (const train of cars) {
      if (stepTransitDoors(train, dt)) { place(train); continue; }
      if (train.k >= 2) {
        train.speed = 0;
        train.cooldown += dt;
        if (!train.ridden && train.cooldown >= headway(train.track.dir) && canRecycle(train)) {
          train.s = train.track.calls[0] - 170; train.k = 0; train.speed = 7; train.cooldown = 0; train.run++;
        }
        place(train); continue;
      }
      const next = train.k;
      const d = train.track.calls[next] - train.s;
      const cruise = Math.max(7, Math.min(16, (train.track.calls[1] - train.track.calls[0]) / Math.max(30, duration(train.track.dir) - 18)));
      const target = Math.min(cruise, Math.sqrt(2 * Math.max(0, d)));
      train.speed += Math.max(-dt, Math.min(0.9 * dt, target - train.speed));
      const travel = Math.min(Math.max(0, d), train.speed * dt);
      train.s += travel;
      if (d < 0.12 && train.speed < 0.5) {
        train.s = train.track.calls[next]; train.k = next + 1;
        openTransitDoors(train, next, 20);
      }
      place(train);
    }
  }
  cars.forEach(place);
  return { cars, update, prepare, place };
}

function subwayRidePlatform(route, index) {
  const centre = sampleSubwayRide(route, route.calls[index] - TRAIN_LENGTH / 2);
  const cs = Math.cos(centre.yaw), sn = Math.sin(centre.yaw), floor = centre.y + 1.1;
  const world = (x, z) => ({ x: centre.x + cs * x + sn * z, y: floor, z: centre.z - sn * x + cs * z, heading: centre.yaw });
  return { route, index, centre, floor, world,
    constrain(point, radius = 0.5) {
      const dx = point.x - centre.x, dz = point.z - centre.z;
      return world(Math.max(-5.1 + radius, Math.min(-1.65 - radius, dx * cs - dz * sn)),
        Math.max(-80 + radius, Math.min(80 - radius, dx * sn + dz * cs)));
    },
    landing: world(-2.6, TRAIN_LENGTH / 2 - 11.5 + 8.625)
  };
}

// A cell's floor at v along it: level, or rising evenly from y0 to y1 over its ramp (r0 to r1; the whole cell when
// absent), level beyond the ramp's ends
function stationCellFloor(c, v) {
  const r0 = c.r0 ?? -c.hz, r1 = c.r1 ?? c.hz;
  return c.y0 + (c.y1 - c.y0) * Math.max(0, Math.min(1, (v - r0) / ((r1 - r0) || 1)));
}

// A station's walkable interior (the street-to-platform connection of a track ride): oriented rectangles ("cells",
// already inset by the walker's radius), each with a floor that is level or rises evenly along it (a stair), joined
// where they meet or overlap (a stair meets its landings edge to edge, so its floor never jumps). constrain() keeps a walker inside the cells near its own floor height, so a corridor passing
// over a platform never drops the walker onto it; floorAt() is the floor under it. The controllers use both
// (js/controllers.js interiorSpace). `floor` stays the platform level, for the code that asks for it.
function createStationWalk(cells, { floor = 0, platforms = [] } = {}) {
  const frame = (c) => ({ cs: Math.cos(c.yaw), sn: Math.sin(c.yaw) });
  const local = (c, x, z) => { const { cs, sn } = frame(c), dx = x - c.cx, dz = z - c.cz; return { u: dx * cs - dz * sn, v: dx * sn + dz * cs }; };
  const world = (c, u, v) => { const { cs, sn } = frame(c); return { x: c.cx + cs * u + sn * v, z: c.cz - sn * u + cs * v }; };
  const yOf = stationCellFloor;
  const reach = 0.9; // how far a cell's floor may be from the walker's own and still be walked onto
  const space = { kind: 'walk', cells, floor, platforms, hint: floor,
    cellAt(x, z, y = null) {
      const ref = Number.isFinite(y) ? y : space.hint;
      let best = null, bd = Infinity;
      for (const c of cells) {
        const { u, v } = local(c, x, z);
        if (Math.abs(u) > c.hx + 1e-6 || Math.abs(v) > c.hz + 1e-6) continue;
        const d = Math.abs(yOf(c, v) - ref);
        if (d < bd) { bd = d; best = { cell: c, y: yOf(c, v) }; }
      }
      return best;
    },
    floorAt(x, z, y = null) {
      const hit = space.cellAt(x, z, y);
      if (hit) return hit.y;
      const p = space.constrain({ x, z, y }), again = space.cellAt(p.x, p.z, y);
      return again ? again.y : floor;
    },
    constrain(point, radius = 0.5) {
      const ref = Number.isFinite(point.y) ? point.y : space.hint;
      const hit = space.cellAt(point.x, point.z, ref);
      if (hit && Math.abs(hit.y - ref) < reach) return { x: point.x, z: point.z, y: hit.y };
      let best = null, bd = Infinity;
      for (const pass of [true, false]) {
        for (const c of cells) {
          const { u, v } = local(c, point.x, point.z);
          const cu = Math.max(-c.hx, Math.min(c.hx, u)), cv = Math.max(-c.hz, Math.min(c.hz, v));
          const y = yOf(c, cv);
          if (pass && Math.abs(y - ref) >= reach) continue;
          const w = world(c, cu, cv), d = Math.hypot(w.x - point.x, w.z - point.z);
          if (d < bd) { bd = d; best = { x: w.x, z: w.z, y }; }
        }
        if (best) break;
      }
      return best || { x: point.x, z: point.z, y: floor };
    },
    // the platform (its direction index) a walker stands on, or -1
    platformAt(x, z, y = null) {
      const hit = space.cellAt(x, z, y);
      return hit && hit.cell.kind === 'platform' ? hit.cell.dir : -1;
    }
  };
  return space;
}

// The layout of a track-ride station's walk (schematic: the TTC publishes the levels, not the plans; see
// docs/subway-topology.md): its two side platforms (from subwayRidePlatform, one per direction), a stair from each
// platform's end up to a mezzanine across the tracks at the concourse level, and from the mezzanine a corridor to the
// foot of one mapped street entrance's stairway, which climbs along the street (js/subway.js's stairwell) to it.
//   platforms: [dir 0's platform, dir 1's] at this station; entrance: { x, z, tx, tz } the stairway's opening (its
//   middle at the street) and the way down; concourse: the concourse floor (world y). Rooms (cells grown by the
//   walker's radius) are what the renderer walls in.
const STAIR_SLOPE = 0.17 / 0.28; // as js/subway.js's street stairways
function stationWalkLayout({ platforms, entrance, concourse, radius = 0.5 }) {
  const [p0, p1] = platforms;
  const ox = (p0.centre.x + p1.centre.x) / 2, oz = (p0.centre.z + p1.centre.z) / 2, yaw = p0.centre.yaw;
  const h = Math.hypot(p1.centre.x - p0.centre.x, p1.centre.z - p0.centre.z) / 2;
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const toWorld = (u, v) => ({ x: ox + cs * u + sn * v, z: oz - sn * u + cs * v });
  const toLocal = (x, z) => { const dx = x - ox, dz = z - oz; return { u: dx * cs - dz * sn, v: dx * sn + dz * cs }; };
  const F = p0.floor, C = concourse, r = radius, W = h + 5.1;
  // The mezzanine's end: where the corridor leaves the stairway's landing going on the way the stairs go down, so it
  // never doubles back under them; the other end if that one's corridor still runs under the stairway
  const run = -C / STAIR_SLOPE;
  let prefer = 1;
  if (entrance) {
    const along = entrance.tx * sn + entrance.tz * cs;
    const foot = toLocal(entrance.x + entrance.tx * (run + 1.4), entrance.z + entrance.tz * (run + 1.4));
    prefer = Math.abs(along) > 0.5 ? Math.sign(along) : foot.v < 0 ? -1 : 1;
  }
  let best = null;
  for (const e of [prefer, -prefer]) {
    const layout = build(e);
    if (!layout.underStairs) return layout;
    best ||= layout;
  }
  return best;

  function build(e) {
    const cells = [];
    const add = (kind, u0, u1, v0, v1, y0, y1, extra = {}, ramp = null) => {
      // a cell over [u0, u1] x [v0, v1] in the station frame, its floor y0 at v0 rising to y1 at v1 (or over ramp)
      const cv = (v0 + v1) / 2, c = toWorld((u0 + u1) / 2, cv);
      const flip = v1 < v0, sign = flip ? -1 : 1;
      cells.push({ kind, cx: c.x, cz: c.z, yaw: flip ? yaw + Math.PI : yaw, hx: Math.abs(u1 - u0) / 2, hz: Math.abs(v1 - v0) / 2,
        y0, y1, ...(ramp ? { r0: sign * (ramp[0] - cv), r1: sign * (ramp[1] - cv) } : {}), ...extra });
    };
    // the platforms: exactly their own bounds (subwayRidePlatform constrain)
    platforms.forEach((p, dir) => {
      const c = p.world(-3.375, 0);
      cells.push({ kind: 'platform', dir, cx: c.x, cz: c.z, yaw: p.centre.yaw, hx: 1.725 - r, hz: 80 - r, y0: p.floor, y1: p.floor });
    });
    for (const side of [-1, 1]) {
      const dir = side < 0 ? 0 : 1;
      const a = side * (h + 1.65 + r), b = side * (h + 5.1 - r);
      // (level for its first and last half metre: it overlaps the platform and the mezzanine there without a jump)
      add('stair', Math.min(a, b), Math.max(a, b), e * (80 - r - 0.5), e * 88.7, F, C, { dir }, [e * 80, e * 88.2]);
    }
    add('mezzanine', -W + r, W - r, e * 88.2, e * (96 - r), C, C);
    let top = null;
    if (entrance) {
      const t = { x: entrance.tx, z: entrance.tz }, n = { x: -t.z, z: t.x };
      const at = (a, c = 0) => ({ x: entrance.x + t.x * a + n.x * c, z: entrance.z + t.z * a + n.z * c });
      const sy = Math.atan2(t.x, t.z);
      const aTop = 2.3 / STAIR_SLOPE; // the walk starts below the street, out of the street's sight
      {
        // the walked part of the stairway, level for its last half metre into the landing
        const a1 = run + 0.5, m = at((aTop + a1) / 2), hz = (a1 - aTop) / 2;
        cells.push({ kind: 'entrance', cx: m.x, cz: m.z, yaw: sy, hx: 1.0 - r, hz, y0: -aTop * STAIR_SLOPE, y1: C, r0: -hz, r1: hz - 0.5 });
      }
      const landing = at(run + 1.4);
      cells.push({ kind: 'landing', cx: landing.x, cz: landing.z, yaw: sy, hx: 1.4, hz: 1.4, y0: C, y1: C });
      const L = toLocal(landing.x, landing.z), kv = e * 91.9;
      if (Math.abs(L.v - kv) > 0.5) add('corridor', L.u - 1, L.u + 1, L.v, kv + Math.sign(kv - L.v) * 1.0, C, C);
      if (Math.abs(L.u) > W - r) add('corridor', Math.min(L.u, Math.sign(L.u) * (W - r - 1)), Math.max(L.u, Math.sign(L.u) * (W - r - 1)), kv - 1, kv + 1, C, C);
      const s = at(aTop + 0.4);
      top = { x: s.x, z: s.z, y: -(aTop + 0.4) * STAIR_SLOPE, heading: sy, up: Math.atan2(-t.x, -t.z) };
    }
    const rooms = cells.map((c) => ({ ...c, hx: c.hx + r, hz: c.hz + (c.kind === 'platform' ? r : 0) }));
    // the street stairway's room runs all the way up to the street (only its lower part is walked)
    if (entrance) {
      const m = { x: entrance.x + entrance.tx * run / 2, z: entrance.z + entrance.tz * run / 2 };
      const i = rooms.findIndex((c) => c.kind === 'entrance');
      rooms[i] = { ...rooms[i], cx: m.x, cz: m.z, hz: run / 2, y0: 0, y1: C, r0: -run / 2, r1: run / 2 };
    }
    // (a cell other than the stairway's own crossing its footprint, street to landing: a corridor under the stairs)
    let underStairs = false;
    if (entrance) {
      for (let a = 0; a <= run + 0.5 && !underStairs; a += 0.5) for (const c of [-1.2, 0, 1.2]) {
        const x = entrance.x + entrance.tx * a - entrance.tz * c, z = entrance.z + entrance.tz * a + entrance.tx * c;
        if (cells.some((q) => {
          if (q.kind === 'entrance' || q.kind === 'landing') return false;
          const qc = Math.cos(q.yaw), qs = Math.sin(q.yaw), dx = x - q.cx, dz = z - q.cz;
          return Math.abs(dx * qc - dz * qs) < q.hx + 0.5 && Math.abs(dx * qs + dz * qc) < q.hz + 0.5;
        })) { underStairs = true; break; }
      }
    }
    return { frame: { x: ox, z: oz, yaw, h, e, W }, cells, rooms, top, concourse: C, floor: F, underStairs };
    }
}

Object.assign(window.CITY, { SUBWAY_RIDE_SHAPE, buildSubwayRidePaths, buildSubwayTrackPaths, sampleSubwayRide, subwayRailY,
  createSubwayRideService, subwayRidePlatform, createStationWalk, stationWalkLayout, stationCellFloor });
})();
