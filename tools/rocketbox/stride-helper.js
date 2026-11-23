// Capture helper for judging the stride on the Rocketbox body (st-8p1p.5). Load with CAPTURE_INIT_SCRIPT, after shot-helper.js
// has been loaded (the shot lists chain them with CAPTURE_INIT_SCRIPT=tools/rocketbox/stride-init.js).
//
// window.__rbSide({ seconds, run, avatar }) picks a sidewalk walker that is walking (v > 1.1) 6-26 m from the camera, holds a
// side-on camera on it (4.6 m to the side, at mid-body height, 32 degree lens) and, every frame, logs the walker's two ankles
// and hip along its travel direction into window.__rbStrideLog (t is Date.now()/1000 so it lines up with the screencast).
// With run: true the walker is put into the game's own escape (the state traffic.js writes when a car or the player is about
// to hit it: avoidSpeed 5 m/s for a few seconds on its own sidewalk); the game's gait, not a written pose, does the running.
// window.__rbStrideSummary() then gives step length, cadence, speed, leg length and the ratios used to judge the stride.
function rbSideStart(p, fx, fz, seconds, wantRun, resolve, forceSide) {
  const app = window.__CITY_APP, cs = app.cameraSystem, T = window.CITY.THREE, rb = window.CITY.rocketbox || null;
  const cam = cs.camera;
  const clock = () => app.clockState().simulation;
    const rig = p.rig, v = new T.Vector3();
    if (window.__gaitHelper) window.__gaitHelper.hideHud();
    if (wantRun) { // what the game writes when it makes someone flee along their own path
      const ahead = p.dir > 0 ? p.len - p.t : p.t;
      p.avoidSpeed = 5; p.avoidT = p.t + p.dir * Math.min(ahead - 2, 40); p.avoidUntil = clock() + seconds + 2; p.pause = 0;
      p.restTime = Math.max(p.restTime || 0, clock() + 10); p.socialTime = Math.max(p.socialTime || 0, clock() + 10);
    }
    // side of the walker with a clear line to the camera spot (street side or sidewalk side, whichever is open)
    const scene = (() => { let s = rb && rb.avatars[0] ? rb.avatars[0].root : null; while (s && s.parent) s = s.parent; return s && s.isScene ? s : null; })();
    let side = forceSide || 1;
    if (scene && !forceSide) {
      const rc = new T.Raycaster(), o = new T.Vector3(), d = new T.Vector3();
      for (const sd of [1, -1]) {
        o.set(rig.x, 1.1, rig.z); d.set(-fz * sd, 0, fx * sd); rc.set(o, d); rc.far = 5;
        if (!rc.intersectObjects(scene.children.filter((c) => c.visible && !c.isLight), true).some((h) => h.object.visible && !h.object.isSkinnedMesh && h.object.name !== 'RocketboxPerson')) { side = sd; break; }
      }
    }
    window.__rbStrideTarget = p;
    window.__rbStrideSide = side;
    const log = window.__rbStrideLog = [];
    const a = new T.Vector3(), b = new T.Vector3(), h = new T.Vector3();
    let dirX = fx, dirZ = fz, lastX = p.x, lastZ = p.z, ended = false;
    const update = cs.update.bind(cs);
    cs.update = (dt, elapsed) => {
      update(dt, elapsed);
      if (ended) return;
      const mx = rig.x - lastX, mz = rig.z - lastZ, ml = Math.hypot(mx, mz);
      if (ml > 0.004) { dirX += (mx / ml - dirX) * 0.15; dirZ += (mz / ml - dirZ) * 0.15; const n = Math.hypot(dirX, dirZ); dirX /= n; dirZ /= n; lastX = rig.x; lastZ = rig.z; }
      rig.jointAt(9, a); rig.jointAt(13, b); rig.jointAt(7, h);
      const ground = Math.min(a.y, b.y);
      cam.position.set(rig.x - dirZ * side * 4.6, ground + 0.95, rig.z + dirX * side * 4.6);
      cam.fov = 32; cam.updateProjectionMatrix();
      v.set(rig.x, ground + 0.9, rig.z);
      cam.lookAt(v);
      cam.updateMatrixWorld(true);
      if (cs.currentPos) cs.currentPos.copy(cam.position);
      if (cs.currentLookAt) cs.currentLookAt.copy(v);
      log.push({ t: +(Date.now() / 1000).toFixed(3), v: +p.v.toFixed(3), speed: +(rig.speed || 0).toFixed(3), phase: +rig.phase.toFixed(3),
        la: +((a.x - rig.x) * dirX + (a.z - rig.z) * dirZ).toFixed(4), ra: +((b.x - rig.x) * dirX + (b.z - rig.z) * dirZ).toFixed(4),
        lh: +(a.y - ground).toFixed(4), rh: +(b.y - ground).toFixed(4), hipY: +(h.y - ground).toFixed(4),
        avatar: rb ? rb.isAvatar(p) : false, s: +rig.s.toFixed(4), x: +rig.x.toFixed(3), z: +rig.z.toFixed(3) });
    };
    setTimeout(() => { ended = true; cs.update = update; }, seconds * 1000);
    setTimeout(() => resolve({ picked: { x: +p.x.toFixed(1), z: +p.z.toFixed(1), female: !!rig.female, id: rb ? rb.idOf(p) : null, v: +p.v.toFixed(2), run: wantRun, side } }), 1500);
  }

window.__rbSide = (opts = {}) => new Promise((resolve) => {
  const seconds = opts.seconds || 8, wantRun = !!opts.run, wantAvatar = opts.avatar !== false;
  const app = window.__CITY_APP, cs = app.cameraSystem, T = window.CITY.THREE, rb = window.CITY.rocketbox || null;
  const cam = cs.camera;
  const t0 = performance.now();
  const d2 = (p) => Math.hypot(p.x - cam.position.x, p.z - cam.position.z);
  const clock = () => app.clockState().simulation;
  const attempt = () => {
    if (performance.now() - t0 > 60000) return resolve({ error: 'no walker found' });
    const pool = app.trafficSystem.peds.filter((p) => p.placed && !p.knock && !p.node && !p.mid && p.v > 1.1 && !p.conversation && !p.waiting
      && d2(p) > 6 && d2(p) < 26 && (p.dir > 0 ? p.len - p.t : p.t) > (wantRun ? 30 : 14) && (p.dir > 0 ? p.t : p.len - p.t) > 4
      && (!wantAvatar || !rb || rb.isAvatar(p)));
    if (!pool.length) return setTimeout(attempt, 400);
    pool.sort((a, b) => d2(a) - d2(b));
    const p = pool[0];
    const x0 = p.x, z0 = p.z;
    setTimeout(() => {
      const dx = p.x - x0, dz = p.z - z0, len = Math.hypot(dx, dz);
      if (len < 0.2) return attempt();
      rbSideStart(p, dx / len, dz / len, seconds, wantRun, resolve);
    }, 500);
  };
  (function wait() { return !rb || rb.ready ? attempt() : setTimeout(wait, 250); })();
});

// Step length: the greatest fore-aft gap between the ankles in each step (the log's la - ra, signed along travel). Stride
// length is two steps. Leg length is the hip's height over the ankles' lowest point while a foot is flat.
window.__rbStrideSummary = () => {
  const L = (window.__rbStrideLog || []).filter((r) => r.speed > 0.3 || r.v > 0.3);
  if (L.length < 20) return { error: 'too few samples', n: L.length };
  const sep = L.map((r) => r.la - r.ra);
  const peaks = [];
  for (let i = 2; i < L.length - 2; i++) {
    const s = sep[i];
    if (Math.abs(s) > 0.15 && Math.abs(s) >= Math.abs(sep[i - 1]) && Math.abs(s) >= Math.abs(sep[i + 1]) && Math.abs(s) >= Math.abs(sep[i - 2]) && Math.abs(s) >= Math.abs(sep[i + 2])) peaks.push({ i, t: L[i].t, step: +Math.abs(s).toFixed(3) });
  }
  const steps = peaks.map((p) => p.step);
  const mean = (a) => a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3) : null;
  const dts = peaks.slice(1).map((p, k) => p.t - peaks[k].t).filter((d) => d > 0.1 && d < 1.2);
  const hips = L.map((r) => r.hipY);
  return { samples: L.length, speedMean: mean(L.map((r) => r.v)), rigSpeedMean: mean(L.map((r) => r.speed)), stepsFound: steps.length, stepLengthMean: mean(steps), stepLengthMax: steps.length ? Math.max(...steps) : null,
    stepsPerSecond: dts.length ? +(1 / (dts.reduce((x, y) => x + y, 0) / dts.length)).toFixed(2) : null,
    hipHeightMean: mean(hips), hipHeightMax: +Math.max(...hips).toFixed(3), rigScale: L[0].s, avatarShare: mean(L.map((r) => (r.avatar ? 1 : 0))),
    stepOverLeg: mean(steps) && mean(hips) ? +(mean(steps) / Math.max(...hips)).toFixed(3) : null };
};

// window.__rbSideDive(seconds): after ped-gait-helper's setupDive has started (the player's car is driven at a walker crossing
// the road; the game makes it flee, retreat or dive), holds the same side camera on that walker (on the side away from the
// car) and logs its ankles as __rbSide does. The car is held still once it is 1.5 m past the crossing, so it cannot drive
// through the camera.
window.__rbSideDive = (seconds) => new Promise((resolve) => {
  const G = window.__gaitHelper, app = window.__CITY_APP, cm = app.controllerManager, car = cm.entities.car;
  const t0 = performance.now();
  const wait = () => {
    const p = G.diveTarget;
    if (!p) return performance.now() - t0 > 170000 ? resolve({ error: 'no dive target' }) : setTimeout(wait, 100);
    const fx = p.ux * p.dir, fz = p.uz * p.dir;
    // the car's side of the walker is where it comes from; put the camera on the other
    const toCar = (car.position.x - p.x) * -fz + (car.position.z - p.z) * fx;
    rbSideStart(p, fx, fz, seconds, false, resolve, toCar > 0 ? -1 : 1);
    const hold = setInterval(() => {
      const past = (car.position.x - p.x) * Math.sin(car.heading) + (car.position.z - p.z) * Math.cos(car.heading);
      if (past > 3.5) { car.speed = 0; cm.keys.forward = false; cm.keys.boost = false; cm.keys.left = 0; cm.keys.right = 0; clearInterval(hold); }
    }, 30);
  };
  wait();
});
