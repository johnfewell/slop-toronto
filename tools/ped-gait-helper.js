// tools/ped-gait-helper.js
// Setup and camera helpers for pedestrian gait before-clips (st-iq0v.1.1)
(function () {
  const G = (window.__gaitHelper = window.__gaitHelper || {});

  function hideHud() {
    const b = document.getElementById('btn-toggle-hud');
    if (b && !document.body.classList.contains('film')) {
      b.click();
      document.body.classList.add('film');
    }
  }
  G.hideHud = hideHud;

  function clearNearbyCars(x, z, radius = 50) {
    const app = window.__CITY_APP, T = app?.trafficSystem;
    if (T && T.cars) {
      for (const c of T.cars) {
        if (Math.hypot(c.x - x, c.z - z) < radius) {
          c.x = 99999; c.z = 99999; c.speed = 0;
        }
      }
    }
  }

  // 1. crowd-sidewalk: busy downtown sidewalk from the side (feet and knees clearly visible)
  G.setupSidewalk = function () {
    hideHud();
    const app = window.__CITY_APP, T = app.trafficSystem;
    const pe = app.controllerManager.entities.person;
    if (pe && pe.mesh) pe.mesh.visible = false;
    app.cameraSystem.cinema = () => {
      const cy = pe ? pe.position.y : 0.85;
      const p = T.peds.find((ped) => ped.placed && !ped.node && Math.hypot(ped.x - 130, ped.z - -340.5) < 40);
      if (p) {
        const py = p.y !== undefined ? p.y : cy;
        return {
          pos: [p.x + 3.8, py + 0.9, p.z - 3.5],
          look: [p.x, py + 0.7, p.z],
          fov: 40
        };
      }
      return {
        pos: [138.0, cy + 0.9, -345.5],
        look: [138.0, cy + 0.7, -340.5],
        fov: 38
      };
    };
    return { ok: true, name: 'crowd-sidewalk' };
  };

  // ---- shared by the corner, crossing and dive shots (nothing here writes a pedestrian's pose or state) ----
  const clockNow = () => window.__CITY_APP.clockState().simulation;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const kindOf = (p) => (p.node ? 'cross' : p.mid ? 'mid' : p.route && p.route.edge ? 'edge' : 'corner');
  const placedCount = () => window.__CITY_APP.trafficSystem.peds.filter((p) => p.placed).length;
  // The crowd fills in around the player over the first seconds (about 60 people at 4 s, 230 at 15 s).
  async function crowdReady(minPlaced = 150, minClock = 14, timeoutMs = 60000) {
    const t0 = performance.now();
    while ((placedCount() < minPlaced || clockNow() < minClock) && performance.now() - t0 < timeoutMs) await sleep(100);
    return { placed: placedCount(), clock: clockNow() };
  }
  const groundOf = () => {
    const cm = window.__CITY_APP.controllerManager;
    const e = cm.entities.person && cm.entities.person.mesh && cm.entities.person.mesh.visible ? cm.entities.person : (cm.entities.car || cm.entities.person);
    return e.position.y;
  };
  G.clockNow = clockNow;
  // TTC streetcars rolling through the shot would block the camera: send the ones near the shot away (the game
  // would otherwise keep re-placing them, so this runs on an interval)
  function clearStreetcars(x, z, r = 90) {
    const T = window.__CITY_APP.trafficSystem;
    // (the ambient buses too: the same send-away clearNearbyCars gives the cars)
    if (T && T.buses) for (const b of T.buses) if (Math.hypot(b.x - x, b.z - z) < r) { b.x = 99999; b.z = 99999; b.speed = 0; }
    const sc = window.__CITY_APP.streetcars;
    if (!sc || !sc.cars) return;
    for (const c of [...sc.cars]) {
      const s = c.sections && c.sections[2];
      if (s && Math.hypot(s.x - x, s.z - z) < r) sc.retire(c);
    }
  }

  // 2. crowd-corner: whole-body view of several pedestrians walking up to and round a street corner.
  // The corner is chosen at run time: the intersection with the most walking pedestrians heading for it within 14 m.
  G.setupCorner = async function () {
    hideHud();
    const app = window.__CITY_APP, T = app.trafficSystem;
    const pe = app.controllerManager.entities.person;
    if (pe && pe.mesh) pe.mesh.visible = false;
    const ready = await crowdReady();
    const pxx = pe.position.x, pzz = pe.position.z;
    // someone walking along a sidewalk who is about to go round the corner: the game has already chosen their next
    // leg (p.nextRoute) and it is a corner link, not a crossing
    const turning = (p) => {
      if (!p.placed || kindOf(p) !== 'edge' || p.v < 0.8 || p.conversation || !p.nextRoute) return false;
      const leg = p.nextRoute[p.nextLeg];
      const ahead = p.dir > 0 ? p.len - p.t : p.t;
      return !!leg && !leg.track.node && !leg.track.mid && !leg.track.edge && ahead < 8 && Math.hypot(p.x - pxx, p.z - pzz) < 70;
    };
    const endOf = (p) => (p.dir > 0 ? [p.ax + p.ux * p.len, p.az + p.uz * p.len] : [p.ax, p.az]);
    let lead = null, group = [];
    const t0 = performance.now();
    // at least two people about to turn the same corner at the same time (up to 4 minutes of waiting)
    while (performance.now() - t0 < 240000 && !lead) {
      const ts = T.peds.filter(turning);
      for (const p of ts) {
        const [ex, ez] = endOf(p);
        const g = ts.filter((q) => { const [qx2, qz2] = endOf(q); return Math.hypot(qx2 - ex, qz2 - ez) < 6; });
        if (g.length >= 2 && g.length > group.length) { group = g; lead = p; }
      }
      if (!lead) await sleep(50);
    }
    const best = lead ? { count: group.length, ids: group } : null;
    const n = { x: lead ? lead.x : 0, z: lead ? lead.z : 0 };
    const out = { ok: !!best, name: 'crowd-corner', ready, turning: group.length };
    if (!best) return out;
    // the corner is where the walker's sidewalk ends; the camera stands on the road side of it, 6 m out and 2 m back
    // along the way they come, looking just before the corner, so people go round it whole in the view
    const Cx = lead.dir > 0 ? lead.ax + lead.ux * lead.len : lead.ax, Cz = lead.dir > 0 ? lead.az + lead.uz * lead.len : lead.az;
    const ax = lead.ux * lead.dir, az = lead.uz * lead.dir;
    let qx = -az, qz = ax;
    const leg = lead.nextRoute[lead.nextLeg];
    const Lx = leg.dir > 0 ? leg.track.ax + leg.track.ux * leg.track.len : leg.track.ax, Lz = leg.dir > 0 ? leg.track.az + leg.track.uz * leg.track.len : leg.track.az;
    // (road side: away from the walker's own sidewalk line, towards where the corner link turns to)
    if (qx * (Lx - Cx) + qz * (Lz - Cz) < 0) { qx = -qx; qz = -qz; }
    const cx = Cx + qx * 6.5, cz = Cz + qz * 6.5;
    const gy = groundOf();
    setInterval(() => { clearNearbyCars(n.x, n.z, 40); clearStreetcars(n.x, n.z); }, 100);
    app.cameraSystem.cinema = () => ({ pos: [cx, gy + 1.3, cz], look: [Cx, gy + 0.9, Cz], fov: 62 });
    G.cornerLog = [];
    const t1 = performance.now();
    const samp = setInterval(() => {
      const t = (performance.now() - t1) / 1000;
      G.cornerLog.push({ t: +t.toFixed(2), clock: +clockNow().toFixed(2), within12: T.peds.filter((p) => p.placed && Math.hypot(p.x - cx, p.z - cz) < 12).length,
        nearCorner: T.peds.filter((p) => p.placed && Math.hypot(p.x - n.x, p.z - n.z) < 8).map((p) => [+p.x.toFixed(1), +p.z.toFixed(1), kindOf(p), +p.v.toFixed(2)]) });
      if (t >= 8.5) { clearInterval(samp); console.log('[gait-log:corner] ' + JSON.stringify(G.cornerLog)); }
    }, 250);
    return Object.assign(out, { cornerPoint: [Cx, Cz], camera: [cx, cz], leadAt: [lead.x, lead.z] });
  };

  // 3. crowd-crossing: pedestrians waiting at a curb step off when their WALK comes on. The shot starts about 1.8 s
  // before the WALK, which is found by reading the signal plan forward from the page's own clock.
  G.setupCrossing = async function () {
    hideHud();
    const app = window.__CITY_APP, T = app.trafficSystem, S = window.CITY.SIGNALS;
    const pe = app.controllerManager.entities.person;
    if (pe && pe.mesh) pe.mesh.visible = false;
    const ready = await crowdReady();
    const px = pe.position.x, pz = pe.position.z;
    const t0 = performance.now();
    let pick = null;
    while (performance.now() - t0 < 60000 && !pick) {
      const groups = new Map();
      for (const p of T.peds) {
        if (!p.placed || !p.node || !p.waiting || p.walkAt >= 0 || Math.hypot(p.x - px, p.z - pz) > 30) continue;
        const key = p.node.sigJ + ':' + p.side;
        (groups.get(key) || groups.set(key, []).get(key)).push(p);
      }
      for (const g of groups.values()) {
        const n = g[0].node, ph = n.walkP[g[0].side];
        if (g.length < 2 || S.walk(n.sigJ, ph, clockNow())) continue;
        let on = null;
        for (let dt = 0.1; dt < 90; dt += 0.1) if (S.walk(n.sigJ, ph, clockNow() + dt)) { on = clockNow() + dt; break; }
        if (on && on - clockNow() > 3 && (!pick || g.length > pick.g.length)) pick = { g, n, ph, on };
      }
      if (!pick) await sleep(250);
    }
    if (!pick) return { ok: false, name: 'crowd-crossing', ready };
    const { g, n, ph } = pick;
    const lead = g[0];
    const mx = lead.ax + lead.ux * lead.len / 2, mz = lead.az + lead.uz * lead.len / 2;
    // camera along the road, 9.5 m from the middle of the crosswalk, so people cross left to right
    const rx = -lead.uz, rz = lead.ux;
    const cx = mx + rx * 9.5, cz = mz + rz * 9.5;
    const gy = groundOf();
    setInterval(() => { clearNearbyCars(mx, mz, 40); clearStreetcars(mx, mz); }, 100);
    app.cameraSystem.cinema = () => ({ pos: [cx, gy + 1.5, cz], look: [mx, gy + 0.8, mz], fov: 50 });
    while (clockNow() < pick.on - 1.8) await sleep(20);
    // log the real signal and the group's own fields, 20 Hz
    G.crossLog = [];
    const t1 = performance.now();
    let walkSeen = null;
    const samp = setInterval(() => {
      const t = (performance.now() - t1) / 1000, c = clockNow();
      const w = S.walk(n.sigJ, ph, c);
      if (w && walkSeen === null) walkSeen = c;
      G.crossLog.push({ t: +t.toFixed(2), clock: +c.toFixed(2), walk: !!w, predictedOn: +pick.on.toFixed(2),
        group: g.map((p) => [+p.x.toFixed(2), +p.z.toFixed(2), p.waiting ? 'wait' : 'go', +p.v.toFixed(2), +p.walkAt.toFixed(2)]) });
      if (t >= 10) { clearInterval(samp); console.log('[gait-log:crossing] ' + JSON.stringify({ walkSeenAtClock: walkSeen, predicted: pick.on, log: G.crossLog })); }
    }, 50);
    return { ok: true, name: 'crowd-crossing', ready, waiting: g.length, at: [mx, mz], camera: [cx, cz], startClock: clockNow(), predictedWalkClock: pick.on };
  };

  // 4. player-walk-run: walking then running in a straight line, side camera
  G.setupPlayerWalkRun = function (delay = 1500) {
    hideHud();
    const app = window.__CITY_APP, cm = app.controllerManager;
    const p = cm.entities.person;
    if (p && p.mesh) p.mesh.visible = true;
    cm.keys.forward = false;
    cm.keys.boost = false;
    cm.keys.left = false;
    cm.keys.right = false;

    app.cameraSystem.cinema = () => {
      const pos = cm.entities.person.position;
      return {
        pos: [pos.x - 4.2, pos.y + 0.85, pos.z],
        look: [pos.x, pos.y + 0.85, pos.z],
        fov: 38
      };
    };

    setTimeout(() => {
      cm.keys.forward = true;
      cm.keys.boost = false;
      setTimeout(() => {
        cm.keys.boost = true;
      }, 3000);
      setTimeout(() => {
        cm.keys.forward = false;
        cm.keys.boost = false;
      }, 7800);
    }, delay);

    return { ok: true, name: 'player-walk-run' };
  };

  // 5. player-turn: turning on the spot and walking tight circle
  G.setupPlayerTurn = function (delay = 1500) {
    hideHud();
    const app = window.__CITY_APP, cm = app.controllerManager;
    const p = cm.entities.person;
    if (p && p.mesh) p.mesh.visible = true;
    cm.keys.forward = false;
    cm.keys.boost = false;
    cm.keys.left = false;
    cm.keys.right = false;

    app.cameraSystem.cinema = () => {
      const pos = cm.entities.person.position;
      return {
        pos: [pos.x + 3.2, pos.y + 1.8, pos.z - 3.2],
        look: [pos.x, pos.y + 0.75, pos.z],
        fov: 42
      };
    };

    setTimeout(() => {
      cm.keys.left = true;
      setTimeout(() => {
        cm.keys.forward = true;
      }, 2500);
      setTimeout(() => {
        cm.keys.forward = false;
        cm.keys.left = false;
      }, 7800);
    }, delay);

    return { ok: true, name: 'player-turn' };
  };

  // 6. player-jump: jumping in direct midday sun (south open plaza in Nathan Phillips Square)
  G.setupPlayerJump = function (delay = 1500) {
    hideHud();
    const app = window.__CITY_APP, cm = app.controllerManager;
    const p = cm.entities.person;
    if (p && p.mesh) p.mesh.visible = true;
    cm.keys.forward = false;
    cm.keys.boost = false;
    cm.keys.left = false;
    cm.keys.right = false;
    cm.keys.up = false;

    // Face east across open sunlit terrace; sun from south illuminates front-right of player
    p.heading = Math.PI / 2;

    app.cameraSystem.cinema = () => {
      const pos = cm.entities.person.position;
      return {
        pos: [pos.x, pos.y + 0.9, pos.z - 4.2],
        look: [pos.x, pos.y + 0.85, pos.z],
        fov: 38
      };
    };

    setTimeout(() => {
      // Jump 1: standing
      setTimeout(() => {
        cm.keys.up = true;
        setTimeout(() => { cm.keys.up = false; }, 120);
      }, 800);

      // Jump 2: standing
      setTimeout(() => {
        cm.keys.up = true;
        setTimeout(() => { cm.keys.up = false; }, 120);
      }, 2600);

      // Jump 3: running jump
      setTimeout(() => {
        cm.keys.forward = true;
        cm.keys.boost = true;
      }, 4200);
      setTimeout(() => {
        cm.keys.up = true;
        setTimeout(() => { cm.keys.up = false; }, 120);
      }, 5200);
      setTimeout(() => {
        cm.keys.forward = false;
        cm.keys.boost = false;
      }, 7800);
    }, delay);

    return { ok: true, name: 'player-jump' };
  };

  // 7. knockdown: car visibly hits pedestrian; ragdoll thrown, lies on ground, gets up and walks
  G.setupKnockdown = function (delay = 2000) {
    hideHud();
    const app = window.__CITY_APP, cm = app.controllerManager, T = app.trafficSystem;
    const car = cm.entities.car;
    cm.keys.forward = false;
    cm.keys.backward = false;
    cm.keys.boost = false;

    // Clear ambient cars within 100m
    setInterval(() => clearNearbyCars(-287, -1550, 100), 50);

    // Pick target pedestrian and anchor them firmly in the road on University Ave
    const target = T.peds.find((p) => p.placed) || T.peds[0];
    const targetX = -287.0, targetZ = -1550.0;
    target.placed = true;
    target.x = targetX;
    target.z = targetZ;
    target.ax = targetX;
    target.az = targetZ;
    target.t = 0;
    target.len = 1000;
    target.ux = 0;
    target.uz = 1;
    target.dir = 1;
    target.v = 0;
    target.speed = 1.3;
    target.pause = 999;
    target.dodge = 0;
    target.dodgeTarget = 0;
    target.avoidCheck = Infinity; // Disable pedestrian dodging so car hits directly
    target.node = null;
    target.mid = null;
    target.route = null;
    target.nextRoute = null;
    target.conversation = null;
    target.knock = null;

    // Position car 12m south, heading north (0 rad)
    car.position.set(-287.0, car.position.y || 0.85, -1562.0);
    car.speed = 0;
    car.heading = 0;
    app.teleportTo(-287.0, -1562.0, 0);

    // Camera placed 5.5m east of impact point, waist level, looking west at pedestrian
    app.cameraSystem.cinema = () => {
      const cy = target.y || car.position.y || 0.85;
      const px = target.knock ? target.knock.x : target.x;
      const pz = target.knock ? target.knock.z : target.z;
      return {
        pos: [-281.5, cy + 1.2, -1546.0],
        look: [px, cy + 0.6, pz],
        fov: 50
      };
    };

    // State recording container
    G.knockdownLog = [];
    let screencastT0 = 0;

    setTimeout(() => {
      screencastT0 = performance.now();
      // Floor the throttle to hit target at ~8 m/s
      cm.keys.forward = true;
      cm.keys.boost = true;

      // Sample pedestrian state at 20 Hz (every 50ms)
      const sampler = setInterval(() => {
        const now = performance.now();
        const tSec = +((now - screencastT0) / 1000).toFixed(2);
        const simClock = +(app.clockState?.().simulation || 0).toFixed(2);
        const k = target.knock;
        const state = !k ? (target.pause > 0 ? 'standing' : 'walking')
          : k.phase === 'rag' ? 'ragdoll'
          : k.phase === 'down' ? 'lying'
          : k.phase === 'up' ? 'getting_up'
          : 'walking';

        const curPx = k ? k.x : target.x;
        const curPz = k ? k.z : target.z;

        G.knockdownLog.push({
          timeSec: tSec,
          simClock: simClock,
          state: state,
          knockPhase: k ? k.phase : null,
          knockTime: k ? +k.time.toFixed(2) : null,
          pos: [+curPx.toFixed(2), +(target.y || 0).toFixed(2), +curPz.toFixed(2)],
          carSpeed: +car.speed.toFixed(2),
          distanceToCar: +Math.hypot(curPx - car.position.x, curPz - car.position.z).toFixed(2)
        });

        // After impact (when knock triggers), stop car immediately so it does not roll into pedestrian
        if (k && cm.keys.forward) {
          cm.keys.forward = false;
          cm.keys.boost = false;
          car.speed = 0;
          cm.keys.backward = false;
        }

        if (tSec >= 12.0) {
          clearInterval(sampler);
          console.log('[gait-log:knockdown] ' + JSON.stringify(G.knockdownLog));
        }
      }, 50);
    }, delay);

    return { ok: true, name: 'knockdown', targetInitial: { x: target.x, z: target.z } };
  };

  // 8. dive: the player's car is driven at speed at a real crowd pedestrian who is walking across a crosswalk. Nothing
  // about the pedestrian is written: the game decides whether to flee, retreat or dive. Its real fields are logged.
  G.setupDive = async function (opts = {}) {
    hideHud();
    const app = window.__CITY_APP, cm = app.controllerManager, T = app.trafficSystem;
    const car = cm.entities.car;
    cm.keys.forward = false; cm.keys.backward = false; cm.keys.boost = false;
    // the car is set down where it will drive from before the crowd fills in (moving the player later would
    // re-place the whole crowd and could lose the person chosen)
    if (opts.x !== undefined) {
      car.position.set(opts.x, car.position.y, opts.z);
      car.speed = 0; car.heading = opts.heading;
      app.teleportTo(opts.x, opts.z, opts.heading);
    }
    const ready = await crowdReady(150, clockNow() + 12);
    // (the shot starts the car where it should drive from: moving the player would re-place the whole crowd, so the
    // person is chosen from the crowd that is already there, 20-50 m ahead of the car, walking out onto a crosswalk
    // that runs across the car's road)
    let px = car.position.x, pz = car.position.z, h0 = car.heading, rx = Math.sin(h0), rz = Math.cos(h0);
    const carAtReady = [px, pz, h0];
    let pick = null;
    const t0 = performance.now();
    while (performance.now() - t0 < 150000 && !pick) {
      px = car.position.x; pz = car.position.z; h0 = car.heading; rx = Math.sin(h0); rz = Math.cos(h0);
      for (const p of T.peds) {
        // a person who set off across a crosswalk a moment ago, walking, not waiting
        if (!p.placed || !p.node || p.waiting || p.v < 0.9 || p.t < 2.0 || p.t > 6.0) continue;
        const ex = p.x - px, ez = p.z - pz, ahead = ex * rx + ez * rz;
        if (Math.hypot(ex, ez) < 10 || Math.hypot(ex, ez) > 90) continue;
        if (!pick || Math.abs(p.t - 2.8) < Math.abs(pick.t - 2.8)) pick = p;
      }
      if (!pick) await sleep(100);
    }
    if (!pick) return { ok: false, name: 'dive', reason: 'no crossing pedestrian found', ready };
    const target = pick;
    G.diveTarget = target; // (st-8p1p.5: lets a stride camera follow the person the car is driven at)
    // the road runs across the crosswalk; the car is set down 30 m back along it, aimed through where the person will be
    // when it arrives, and driven at them (the crowd is already in place, so this is a short move)
    let rx2 = -target.uz, rz2 = target.ux;
    if (rx2 * rx + rz2 * rz < 0) { rx2 = -rx2; rz2 = -rz2; }
    const back = 30, arrive = back / 9.5;
    const aheadT = Math.min(target.len - 1, Math.max(0, target.t + target.dir * target.v * arrive));
    const aimX = target.ax + target.ux * aheadT, aimZ = target.az + target.uz * aheadT;
    const sx = aimX - rx2 * back, sz = aimZ - rz2 * back, heading = Math.atan2(rx2, rz2);
    car.position.set(sx, car.position.y, sz);
    car.speed = 0; car.heading = heading;
    app.teleportTo(sx, sz, heading);
    clearNearbyCars(aimX, aimZ, 90);
    const clr = setInterval(() => { clearNearbyCars(aimX, aimZ, 90); clearStreetcars(aimX, aimZ); }, 50);
    // side camera: beside the crosswalk, level with the person's path, 13 m back so the whole dive stays in frame
    const gy = groundOf();
    const camX = aimX + target.ux * target.dir * -4 + rx2 * 6, camZ = aimZ + target.uz * target.dir * -4 + rz2 * 6;
    app.cameraSystem.cinema = () => ({ pos: [camX, gy + 1.7, camZ], look: [aimX, gy + 0.6, aimZ], fov: 55 });
    G.diveLog = [];
    const t1 = performance.now();
    let first = null;
    cm.keys.forward = true; cm.keys.boost = true;
    const samp = setInterval(() => {
      const t = (performance.now() - t1) / 1000, c = clockNow();
      const dive = Number.isFinite(target.diveStart) ? c - target.diveStart : null;
      if (dive !== null && dive >= 0 && dive < 2.5 && first === null) first = t;
      const px2 = target.knock ? target.knock.x : target.x, pz2 = target.knock ? target.knock.z : target.z;
      G.diveLog.push({ t: +t.toFixed(2), clock: +c.toFixed(2), diveTime: dive === null || dive > 5 ? null : +dive.toFixed(2),
        rigDiving: !!target.rig.diving, placed: target.placed, pos: [+px2.toFixed(2), +pz2.toFixed(2)], alongTrack: +target.t.toFixed(2), dir: target.dir,
        pedSpeed: +target.v.toFixed(2), dodge: +target.dodge.toFixed(2), dodgeTarget: +target.dodgeTarget.toFixed(2), diveT: +target.diveT.toFixed(2),
        knock: target.knock ? target.knock.phase : null,
        carPos: [+car.position.x.toFixed(2), +car.position.z.toFixed(2)], carHeading: +car.heading.toFixed(3), carSpeed: +car.speed.toFixed(2),
        carDistance: +Math.hypot(px2 - car.position.x, pz2 - car.position.z).toFixed(2) });
      // driving input only: steer the car at the person where they are now (analog left/right), throttle held. Once the
      // car is clearly past the crosswalk, lift off so it does not run on through the crowd.
      const ex = px2 - car.position.x, ez = pz2 - car.position.z;
      let err = Math.atan2(ex, ez) - car.heading;
      err = Math.atan2(Math.sin(err), Math.cos(err));
      // (steering stops once the car is within 14 m or the person has started to dive: the game's avoidance then
      // decides, against a car that holds its line)
      const steer = opts.steer !== false && !(Number.isFinite(target.diveStart) && clockNow() - target.diveStart < 2.6) && Math.hypot(ex, ez) > 14;
      cm.keys.left = steer && err > 0.01 ? Math.min(1, err * 4) : 0;
      cm.keys.right = steer && err < -0.01 ? Math.min(1, -err * 4) : 0;
      if ((car.position.x - aimX) * rx2 + (car.position.z - aimZ) * rz2 > 6) { cm.keys.forward = false; cm.keys.boost = false; cm.keys.left = 0; cm.keys.right = 0; }
      if (t >= 11.5) { clearInterval(samp); clearInterval(clr); console.log('[gait-log:dive] ' + JSON.stringify(G.diveLog)); }
    }, 50);
    return { ok: true, name: 'dive', ready, targetAt: [target.x, target.z], carAtReady, start: [car.position.x, car.position.z], heading: car.heading };
  };

  // 9. cyclist: riding in straight line along clear University Ave for whole clip
  G.setupCyclist = function (delay = 1500) {
    hideHud();
    const app = window.__CITY_APP, cm = app.controllerManager;
    cm.keys.forward = false;
    cm.keys.left = false;
    cm.keys.right = false;

    // Clear cars along University Ave
    setInterval(() => clearNearbyCars(-289, -1550, 80), 100);

    app.cameraSystem.cinema = () => {
      const c = cm.entities.cyclist;
      const pos = c.position;
      return {
        pos: [pos.x + 4.5, pos.y + 1.15, pos.z],
        look: [pos.x, pos.y + 0.9, pos.z],
        fov: 40
      };
    };

    setTimeout(() => {
      cm.keys.forward = true;
      setTimeout(() => { cm.keys.forward = false; }, 8500);
    }, delay);

    return { ok: true, name: 'cyclist' };
  };

  // 10. slope: player walking down High Park slope (speed ~1.5 m/s, walking gait, run == 0)
  G.setupSlope = function (delay = 2000) {
    hideHud();
    const app = window.__CITY_APP, cm = app.controllerManager;
    cm.keys.forward = false;
    cm.keys.boost = false;
    cm.keys.left = false;
    cm.keys.right = false;

    app.cameraSystem.cinema = () => {
      const pos = cm.entities.person.position;
      const h = cm.entities.person.heading;
      const sideX = -Math.cos(h), sideZ = Math.sin(h);
      return {
        pos: [pos.x + sideX * 4.2, pos.y + 0.9, pos.z + sideZ * 4.2],
        look: [pos.x, pos.y + 0.8, pos.z],
        fov: 40
      };
    };

    setTimeout(() => {
      // 0.35 gives targetSpeed = 4.4 * 0.35 = 1.54 m/s (below 2.3 m/s run threshold -> pure walk)
      cm.keys.forward = 0.35;
      cm.keys.boost = false;
      setTimeout(() => { cm.keys.forward = false; }, 8500);
    }, delay);

    return { ok: true, name: 'slope' };
  };

  // 11. slope-run: player running down High Park slope (speed ~8.2 m/s, sprint run)
  G.setupSlopeRun = function (delay = 2000) {
    hideHud();
    const app = window.__CITY_APP, cm = app.controllerManager;
    cm.keys.forward = false;
    cm.keys.boost = false;
    cm.keys.left = false;
    cm.keys.right = false;

    app.cameraSystem.cinema = () => {
      const pos = cm.entities.person.position;
      const h = cm.entities.person.heading;
      const sideX = -Math.cos(h), sideZ = Math.sin(h);
      return {
        pos: [pos.x + sideX * 4.5, pos.y + 0.9, pos.z + sideZ * 4.5],
        look: [pos.x, pos.y + 0.8, pos.z],
        fov: 40
      };
    };

    setTimeout(() => {
      cm.keys.forward = true;
      cm.keys.boost = true;
      setTimeout(() => {
        cm.keys.forward = false;
        cm.keys.boost = false;
      }, 8500);
    }, delay);

    return { ok: true, name: 'slope-run' };
  };
  for (const name of ['setupCorner', 'setupCrossing', 'setupDive']) {
    const f = G[name];
    G[name] = async (...a) => {
      try {
        const r = await f(...a);
        console.log('[gait-setup:' + name + '] ' + JSON.stringify(r));
        return r;
      } catch (e) {
        console.log('[gait-setup:' + name + '] ERROR ' + (e && e.stack || e));
        throw e;
      }
    };
  }
})();
