// Capture helper for tools/shots/rocketbox-pedestrian.json (st-jfzf): holds the camera on one sidewalk walker.
// window.__rbView(distance, height, top) resolves once a walker is chosen (with ?rocketbox=1: once an avatar is on)
// and the camera has followed it for two seconds. The same walker is kept across shots while it stays placed.
window.__rbView = (distance, height, top) => new Promise((resolve) => {
  const app = window.__CITY_APP, cs = app.cameraSystem, T = window.CITY.THREE;
  const rb = window.CITY.rocketbox || null;
  const t0 = performance.now();
  const v = new T.Vector3();
  const choose = () => {
    const kept = window.__rbTarget;
    if (kept && kept.placed && (!rb || rb.avatars.some((a) => a.on && a.rig === kept.rig))) return kept;
    const cam = cs.camera.position;
    let pool = app.trafficSystem.peds.filter((p) => p.placed);
    if (rb) pool = pool.filter((p) => rb.avatars.some((a) => a.on && a.rig === p.rig));
    let best = null, bd = Infinity;
    for (const p of pool) {
      const d = Math.hypot(p.x - cam.x, p.z - cam.z);
      if (d > 1 && d < bd) { bd = d; best = p; }
    }
    return best;
  };
  const tick = () => {
    const waited = performance.now() - t0;
    const target = (!rb || rb.ready) && waited > 3000 ? choose() : null;
    if (!target) {
      if (waited > 40000) return resolve({ error: 'no walker to look at', rocketbox: rb ? rb.report() : null });
      return setTimeout(tick, 250);
    }
    window.__rbTarget = target;
    window.__rbCam = { distance, height, top };
    if (!cs.__rbUpdate) {
      cs.__rbUpdate = cs.update.bind(cs);
      cs.update = (dt, elapsed) => {
        cs.__rbUpdate(dt, elapsed);
        const p = window.__rbTarget, c = window.__rbCam, rig = p.rig;
        const ground = Math.min(rig.jointAt(9, v).y, rig.jointAt(13, v).y) - 0.08 * rig.s;
        const fx = Math.sin(rig.yaw), fz = Math.cos(rig.yaw);
        const cam = cs.camera;
        if (c.top) cam.position.set(rig.x - fx * 0.5, ground + c.height, rig.z - fz * 0.5);
        // ahead of the walker and a little to its left, looking back at it
        else cam.position.set(rig.x + (fx * 0.8 + fz * 0.6) * c.distance, ground + c.height, rig.z + (fz * 0.8 - fx * 0.6) * c.distance);
        v.set(rig.x, ground + (c.top ? 0 : 0.95), rig.z);
        cam.lookAt(v);
        cam.updateMatrixWorld(true);
        if (cs.currentPos) cs.currentPos.copy(cam.position);
        if (cs.currentLookAt) cs.currentLookAt.copy(v);
      };
    }
    setTimeout(() => {
      const info = app.renderer.info;
      resolve({
        walker: { x: +target.x.toFixed(1), z: +target.z.toFixed(1) },
        render: { calls: info.render.calls ?? info.render.drawCalls, triangles: info.render.triangles },
        rocketbox: rb ? rb.report() : null
      });
    }, 2000);
  };
  tick();
});

// st-8p1p.3 --------------------------------------------------------------------------------------------------------
// window.__rbWait(ms): waits, then resolves with the Rocketbox report (files load lazily, so a street view needs a few seconds)
window.__rbWait = (ms) => new Promise((resolve) => setTimeout(() => resolve({
  rocketbox: window.CITY.rocketbox ? window.CITY.rocketbox.report() : null,
  render: (() => { const i = window.__CITY_APP.renderer.info; return { calls: i.render.calls ?? i.render.drawCalls, triangles: i.render.triangles }; })()
}), ms));

// window.__rbCross(approaching, seconds): picks a walker 36-52 m from the camera that is walking toward it (or away from
// it), and from then on logs its distance and whether it is drawn as an avatar, every 100 ms (window.__rbCrossLog, with
// Date.now()/1000 so the screencast's frame times line up). The camera stays where it is, only turning (narrow lens) to look
// at the walker. Resolves once the walker is chosen; read window.__rbCrossLog afterwards.
function clearLine(p, seconds) {
  const rb = window.CITY.rocketbox, T = window.CITY.THREE, cam = window.__CITY_APP.cameraSystem.camera;
  let scene = rb.avatars[0]?.root;
  while (scene && scene.parent) scene = scene.parent;
  if (!scene || !scene.isScene) return true;
  const rc = new T.Raycaster(), o = new T.Vector3(), d = new T.Vector3();
  const fx = Math.sin(p.rig.yaw), fz = Math.cos(p.rig.yaw);
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const reach = p.v * seconds * 0.6 * t; // (where it will be, at its walking speed, over most of the window)
    d.set(p.x + fx * reach - cam.position.x, 1.5 - cam.position.y, p.z + fz * reach - cam.position.z);
    const len = d.length();
    rc.set(o.copy(cam.position), d.normalize());
    rc.far = len - 2;
    if (rc.intersectObjects(scene.children.filter((c) => c.visible && !c.isLight), true).some((h) => h.object.visible && !h.object.isSkinnedMesh && h.object.name !== 'RocketboxPerson')) return false;
  }
  return true;
}
window.__rbCross = (approaching, seconds) => new Promise((resolve) => {
  const app = window.__CITY_APP, cs = app.cameraSystem, rb = window.CITY.rocketbox, T = window.CITY.THREE;
  const cam = cs.camera;
  const dist = (p) => Math.hypot(p.x - cam.position.x, p.z - cam.position.z);
  const t0 = performance.now();
  const attempt = () => {
    if (performance.now() - t0 > 60000) return resolve({ error: 'no walker found' });
    const lo = approaching ? 38 : 29, hi = approaching ? 52 : 38;
    const pool = app.trafficSystem.peds.filter((p) => p.placed && !p.knock && dist(p) > lo && dist(p) < hi)
      .map((p) => ({ p, d: dist(p) }));
    setTimeout(() => {
      let pick = null;
      for (const c of pool) {
        const d = dist(c.p);
        if (c.p.placed && c.p.v > 1 && !c.p.conversation && !c.p.waiting && !c.p.node && (c.p.dir > 0 ? c.p.len - c.p.t : c.p.t) > 12 && (approaching ? d < c.d - 0.4 : d > c.d + 0.4) && d > lo - 2 && d < hi + 2) { pick = c.p; break; }
      }
      if (!pick) return attempt();
      // (st-8p1p.3) walking away: skip a walker whose line from the camera is blocked now or a few seconds on (it would
      // vanish behind a building); after 25 s of looking, take the first one anyway
      if (!approaching && performance.now() - t0 < 25000 && !clearLine(pick, seconds)) { window.__rbSkipped = (window.__rbSkipped || 0) + 1; return attempt(); }
      const log = window.__rbCrossLog = [];
      const v = new T.Vector3();
      const update = cs.update.bind(cs);
      const fov0 = cam.fov;
      cs.update = (dt, elapsed) => {
        update(dt, elapsed);
        cam.fov = 14;
        cam.updateProjectionMatrix();
        cam.lookAt(v.set(pick.rig.x, pick.rig.jointAt(2, new T.Vector3()).y - 0.35, pick.rig.z));
        cam.updateMatrixWorld(true);
      };
      const iv = setInterval(() => {
        log.push({ t: +(Date.now() / 1000).toFixed(3), dist: +dist(pick).toFixed(2), avatar: rb ? rb.isAvatar(pick) : false });
      }, 100);
      setTimeout(() => { clearInterval(iv); cs.update = update; cam.fov = fov0; cam.updateProjectionMatrix(); }, seconds * 1000);
      resolve({ picked: { x: +pick.x.toFixed(1), z: +pick.z.toFixed(1), female: !!pick.rig.female, dist: +dist(pick).toFixed(1) } });
    }, 700);
  };
  const wait = () => (rb && rb.ready ? attempt() : setTimeout(wait, 250));
  wait();
});

// window.__rbAway(seconds) (st-8p1p.3): a walker is walking away from us and we are standing on its own path 28 m behind it,
// so nothing can stand between us (it has just come that way). Teleports the player there, facing the walker, then logs its
// distance and whether it is an avatar every 100 ms into window.__rbCrossLog, the camera turning (narrow lens) to hold it.
window.__rbAway = (seconds) => new Promise((resolve) => {
  const app = window.__CITY_APP, cs = app.cameraSystem, rb = window.CITY.rocketbox, T = window.CITY.THREE;
  const cam = cs.camera;
  const t0 = performance.now();
  const attempt = () => {
    if (performance.now() - t0 > 60000) return resolve({ error: 'no walker found' });
    const p = app.trafficSystem.peds.find((q) => q.placed && !q.knock && q.v > 1.1 && !q.conversation && !q.waiting && !q.node && (q.dir > 0 ? q.len - q.t : q.t) > 30 && (q.dir > 0 ? q.t : q.len - q.t) > 30 && Math.hypot(q.x - cam.position.x, q.z - cam.position.z) < 90);
    if (!p) return setTimeout(attempt, 500);
    // (its direction of travel, from where it is half a second on; rig.yaw is not reliably the direction it moves)
    const x0 = p.x, z0 = p.z;
    setTimeout(() => {
      const dx = p.x - x0, dz = p.z - z0, len = Math.hypot(dx, dz);
      if (len < 0.3) return attempt();
      const fx = dx / len, fz = dz / len;
      app.teleportTo(p.x - fx * 28, p.z - fz * 28, Math.atan2(fx, fz));
    setTimeout(() => {
      const dist = () => Math.hypot(p.x - cam.position.x, p.z - cam.position.z);
      const log = window.__rbCrossLog = [];
      const v = new T.Vector3();
      const update = cs.update.bind(cs);
      cs.update = (dt, elapsed) => {
        update(dt, elapsed);
        cam.fov = 14;
        cam.updateProjectionMatrix();
        cam.lookAt(v.set(p.rig.x, p.rig.jointAt(2, new T.Vector3()).y - 0.35, p.rig.z));
        cam.updateMatrixWorld(true);
      };
      const iv = setInterval(() => log.push({ t: +(Date.now() / 1000).toFixed(3), dist: +dist().toFixed(2), avatar: rb ? rb.isAvatar(p) : false }), 100);
      setTimeout(() => { clearInterval(iv); cs.update = update; cam.fov = 60; cam.updateProjectionMatrix(); }, seconds * 1000);
      resolve({ picked: { x: +p.x.toFixed(1), z: +p.z.toFixed(1), female: !!p.rig.female, dist: +dist().toFixed(1) } });
    }, 2500);
    }, 500);
  };
  (function wait() { return rb && rb.ready ? attempt() : setTimeout(wait, 250); })();
});

// window.__rbFace(): turns the player toward the walkers within 8-35 m (their mean direction), by teleporting to the same
// spot with a new heading, so the camera behind it looks along the street at the crowd. Returns how many are near.
window.__rbFace = (x, z) => {
  const app = window.__CITY_APP, cam = app.cameraSystem.camera.position;
  const near = app.trafficSystem.peds.filter((p) => p.placed && Math.hypot(p.x - x, p.z - z) > 8 && Math.hypot(p.x - x, p.z - z) < 35);
  let sx = 0, sz = 0;
  for (const p of near) { sx += p.x - x; sz += p.z - z; }
  if (near.length) app.teleportTo(x, z, Math.atan2(sx, sz));
  return { x, z, within35: near.length, heading: near.length ? +Math.atan2(sx, sz).toFixed(2) : null };
};

// window.__rbPose(): puts the camera 1.6 m up, 12 m short of the middle of the nearest walkers within 6-30 m, looking at
// them (a 55 degree lens), and holds it there: the camera does not follow anybody afterwards.
window.__rbPose = (want, timeoutMs = 30000) => new Promise((resolve) => {
  // (with a list of people: waits until every one of them is drawn as an avatar, then aims at them)
  const rb0 = window.CITY.rocketbox, t0 = performance.now();
  const ready = () => !want || want.every((id) => window.__CITY_APP.trafficSystem.peds.some((p) => p.placed && rb0.idOf(p) === id));
  const wait = () => (ready() || performance.now() - t0 > timeoutMs ? resolve(aim(want)) : setTimeout(wait, 150));
  wait();
});
function aim(want) {
  const rb0 = window.CITY.rocketbox;
  const app = window.__CITY_APP, cs = app.cameraSystem, T = window.CITY.THREE;
  const cam = cs.camera, me = cam.position.clone();
  const dist = (p) => Math.hypot(p.x - me.x, p.z - me.z);
  const list = app.trafficSystem.peds.filter((p) => p.placed && (want ? want.includes(rb0.idOf(p)) : dist(p) > 6 && dist(p) < 30)).sort((a, b) => dist(a) - dist(b)).slice(0, want && want.length === 1 ? 1 : 6); // (one wanted person: just the nearest)
  if (!list.length) return { error: 'no walkers in range' };
  let cx = 0, cz = 0;
  for (const p of list) { cx += p.x; cz += p.z; }
  cx /= list.length; cz /= list.length;
  const dx = cx - me.x, dz = cz - me.z, d = Math.hypot(dx, dz), back = Math.max(0, d - (want ? 8 : 12));
  const pos = new T.Vector3(me.x + dx / d * back, me.y - 1.2 + 1.6, me.z + dz / d * back);
  const look = new T.Vector3(cx, pos.y - 0.3, cz);
  const update = cs.update.bind(cs);
  cs.update = (dt, elapsed) => {
    update(dt, elapsed);
    cam.position.copy(pos);
    cam.fov = 55;
    cam.updateProjectionMatrix();
    cam.lookAt(look);
    cam.updateMatrixWorld(true);
    if (cs.currentPos) cs.currentPos.copy(pos);
    if (cs.currentLookAt) cs.currentLookAt.copy(look);
  };
  return { walkersAimedAt: list.length, camera: { x: +pos.x.toFixed(1), z: +pos.z.toFixed(1) }, distToMiddle: +Math.hypot(cx - pos.x, cz - pos.z).toFixed(1) };
}

// window.__rbCount(seconds): every 200 ms, which avatars are drawn AND inside the camera's view (window.__rbCountLog,
// with Date.now()/1000 to line up with the screencast frames' times), to pick the frame with the most different people.
window.__rbCountUnused = null;
window.__rbCount = (seconds) => {
  const app = window.__CITY_APP, cam = app.cameraSystem.camera, rb = window.CITY.rocketbox, T = window.CITY.THREE;
  const log = window.__rbCountLog = [];
  const frustum = new T.Frustum(), m = new T.Matrix4(), v = new T.Vector3();
  const iv = setInterval(() => {
    cam.updateMatrixWorld(true);
    frustum.setFromProjectionMatrix(m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const ids = [], at = [];
    for (const p of app.trafficSystem.peds) {
      const id = p.placed ? rb.idOf(p) : null;
      if (id && frustum.containsPoint(v.set(p.x, 1, p.z))) { ids.push(id); at.push(p); }
    }
    // (st-8p1p.3) twinMin: the least distance (m) between two walkers of one person in view, null if there is no such pair
    let twinMin = null;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      if (ids[i] !== ids[j]) continue;
      const d = Math.hypot(at[i].x - at[j].x, at[i].z - at[j].z);
      if (twinMin === null || d < twinMin) twinMin = +d.toFixed(1);
    }
    log.push({ t: +(Date.now() / 1000).toFixed(3), n: ids.length, distinct: new Set(ids).size, twinMin, ids });
  }, 200);
  setTimeout(() => clearInterval(iv), seconds * 1000);
  return { counting: seconds };
};

// (st-8p1p.7) window.__rbFilm(): hides the HUD, as the film frames do
window.__rbFilm = () => {
  const b = document.getElementById('btn-toggle-hud');
  if (b && !document.body.classList.contains('film')) { b.click(); document.body.classList.add('film'); }
};
// (st-8p1p.7) the season the scenery is in, for the capture's record
window.__rbSeason = () => { try { return { season: window.__CITY_APP.seasons.state() }; } catch (e) { return { season: String(e) }; } };
