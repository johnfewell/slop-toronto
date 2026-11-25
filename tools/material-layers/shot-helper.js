// Capture helpers for tools/material-layers/shots-*.json (jf-rcw, the physical material layers). Load with
// CAPTURE_INIT_SCRIPT=tools/material-layers/shot-helper.js.
// __mlCar({ lat, lon, dist, height, angle, body, minSpeed }) teleports to the place, waits for a traffic car near it
// (of body type `body`, moving at least `minSpeed`) and holds the camera on it, `dist` m away at `height`, `angle`
// radians round from straight ahead of it (positive: to its right). Resolves with the car's body type & what it saw.
// __mlStreet({ lat, lon, road, height, ahead, back, fov }) stands on the named road at the place, looking along it.
// (the people shots' follow hook, tools/rocketbox/shot-helper.js, stays on the camera system until it is taken off)
const releaseCamera = () => {
  const cs = window.__CITY_APP.cameraSystem;
  if (cs.__rbUpdate) { cs.update = cs.__rbUpdate; cs.__rbUpdate = null; }
};
// __mlPerson(ids, distance, height): the avatar of the first of the person ids that is drawn (else the nearest), held by
// the rocketbox helper's camera; resolves with the person's id
window.__mlPerson = (ids, distance, height) => new Promise((resolve) => {
  const app = window.__CITY_APP, rb = window.CITY.rocketbox;
  const t0 = performance.now();
  releaseCamera();
  import('/tools/rocketbox/shot-helper.js').then(() => {
    const tick = () => {
      const pairs = app.trafficSystem.peds.filter((p) => p.placed).map((p) => [p, rb && rb.avatars.find((a) => a.on && a.rig === p.rig)]).filter(([, a]) => a);
      let hit = null;
      for (const id of ids) { hit = pairs.find(([, a]) => a.person.id === id); if (hit) break; }
      if (!hit && performance.now() - t0 > 45000) hit = pairs[0];
      if (!hit) return performance.now() - t0 > 70000 ? resolve({ error: 'no avatar' }) : setTimeout(tick, 500);
      window.__rbTarget = hit[0];
      window.__rbView(distance, height, false).then(() => resolve({ person: hit[1].person.id }));
    };
    tick();
  });
});
window.__mlCar = ({ lat, lon, dist = 6, height = 1.2, angle = 0.6, body = null, minSpeed = 1.5, fov = 45 }) => new Promise((resolve) => {
  const app = window.__CITY_APP, C = window.CITY, t = C.worldFromLatLon(lat, lon);
  releaseCamera();
  app.teleportTo(t.x, t.z, 0);
  const t0 = performance.now();
  const diag = () => {
    const f = app.trafficSystem.focus();
    const placed = app.trafficSystem.cars.filter((c) => c.x || c.z);
    const near = placed.map((c) => Math.hypot(c.x - f.x, c.z - f.z)).sort((a, b) => a - b);
    return { focus: [Math.round(f.x), Math.round(f.z)], target: [Math.round(t.x), Math.round(t.z)], placed: placed.length, nearest: near.slice(0, 3).map(Math.round), moving: placed.filter((c) => c.speed >= minSpeed).length };
  };
  const pick = (speed) => {
    const f = app.trafficSystem.focus();
    let best = null, bd = 1e9;
    for (const c of app.trafficSystem.cars) {
      if (!(c.x || c.z) || (body && c.bodyType !== body) || c.speed < speed) continue;
      const d = Math.hypot(c.x - f.x, c.z - f.z);
      if (d < bd && d < 90) { bd = d; best = c; }
    }
    return best;
  };
  const tick = () => {
    const waited = performance.now() - t0;
    const car = pick(minSpeed) || (waited > 20000 ? pick(0) : null);
    if (!car) return waited > 40000 ? resolve({ error: 'no car', ...diag() }) : setTimeout(tick, 500);
    app.cameraSystem.cinema = () => {
      const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw), rx = fz, rz = -fx;
      const s = Math.sin(angle), c = Math.cos(angle);
      return { pos: [car.x + (fx * c + rx * s) * dist, height, car.z + (fz * c + rz * s) * dist], look: [car.x, 0.75, car.z], fov };
    };
    resolve({ bodyType: car.bodyType, police: car.isPolice, speed: car.speed, ...diag() });
  };
  tick();
});
window.__mlStreet = ({ lat, lon, road, height = 1.7, ahead = 60, back = 0, fov = 60, lookY = 0.3 }) => {
  const app = window.__CITY_APP, C = window.CITY, t = C.worldFromLatLon(lat, lon);
  releaseCamera();
  const n = C.nearestRoads(t.x, t.z, 80).find((r) => r.road.name === road) || C.nearestRoads(t.x, t.z, 80)[0];
  const p = n.road.pts;
  let ux = 1, uz = 0;
  for (let i = 0; i + 1 < p.length; i++) {
    const L = Math.hypot(p[i + 1].x - p[i].x, p[i + 1].z - p[i].z);
    if (Math.hypot(p[i].x - n.px, p[i].z - n.pz) < L + 1) { ux = (p[i + 1].x - p[i].x) / L; uz = (p[i + 1].z - p[i].z) / L; }
  }
  if (ux < 0) { ux = -ux; uz = -uz; }
  app.teleportTo(n.px, n.pz, 0);
  app.cameraSystem.cinema = () => ({ pos: [n.px - ux * back, height, n.pz - uz * back], look: [n.px + ux * ahead, lookY, n.pz + uz * ahead], fov });
  return { road: n.road.name, ux, uz };
};
