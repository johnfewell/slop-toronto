(function () {
const { THREE, openTransitDoors, stepTransitDoors } = window.CITY;
const SUBWAY_RIDE_SHAPE = { carLength: 23, gap: 0.6, cars: 6, width: 3.1, floor: 1.1 };
const TRAIN_LENGTH = 6 * 23 + 5 * 0.6;

function sampleSubwayRide(route, s, out = {}) {
  s = Math.max(0, Math.min(route.len, s));
  let lo = 0, hi = route.pts.length - 1;
  while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (route.cum[mid] <= s) lo = mid; else hi = mid; }
  const a = route.pts[lo], b = route.pts[hi], length = route.cum[hi] - route.cum[lo] || 1;
  const t = (s - route.cum[lo]) / length;
  out.x = a.x + (b.x - a.x) * t;
  out.y = route.y;
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

function createSubwayRideService(routes, { headway = () => 150, duration = () => 110, canRecycle = () => true } = {}) {
  const a = {}, b = {};
  const cars = routes.map((track, i) => {
    const train = { id: `subway-line2-${i}`, run: 0, track, s: track.calls[0], k: 1, speed: 0,
      y: track.y, ridden: false, lastPassengerStop: 1, cooldown: 0,
      sections: Array.from({ length: 6 }, () => ({ x: 0, y: track.y, z: 0, yaw: 0, s: 0 })) };
    openTransitDoors(train, 0, 20);
    return train;
  });
  function place(train) {
    for (let i = 0; i < 6; i++) {
      const front = train.s - i * 23.6;
      sampleSubwayRide(train.track, front, a); sampleSubwayRide(train.track, front - 23, b);
      Object.assign(train.sections[i], { x: (a.x + b.x) / 2, y: train.y, z: (a.z + b.z) / 2,
        yaw: Math.atan2(a.x - b.x, a.z - b.z), s: front - 11.5 });
    }
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
  const cs = Math.cos(centre.yaw), sn = Math.sin(centre.yaw), floor = route.y + 1.1;
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

Object.assign(window.CITY, { SUBWAY_RIDE_SHAPE, buildSubwayRidePaths, sampleSubwayRide, createSubwayRideService, subwayRidePlatform });
})();
