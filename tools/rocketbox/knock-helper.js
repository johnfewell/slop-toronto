// Capture helper for st-8p1p.4: a Rocketbox walker hit by the player's car or bicycle must follow the ragdoll (not freeze,
// vanish or stand in a T-pose). Builds on tools/ped-gait-helper.js (loaded before this file) and tools/rocketbox/shot-helper.js.
//
// window.__rbKnock({ kind: 'car' | 'bike' }) : the same set-up as ped-gait-helper's setupKnockdown (one walker anchored in the
// road on University Avenue, the vehicle driven at it from 12 m for the car, 28 m for the bicycle), except that it first waits
// until that walker is drawn as a Rocketbox avatar, and every 50 ms logs into window.__rbKnockLog: the game's knock phase,
// whether the avatar is drawn, its root's visibility, the gaps between the avatar's own joints and the game rig's (pelvis,
// head, hands via the forearms, feet, knees), the pelvis height of both, and how far the avatar's joints moved since the last
// sample (a frozen avatar moves 0 while the game's ragdoll is still moving). window.__rbKnockSummary() reduces the log.
window.__rbKnock = async (opts = {}) => {
  const kind = opts.kind || 'car';
  const app = window.__CITY_APP, cm = app.controllerManager, T = app.trafficSystem, rb = window.CITY.rocketbox, TH = window.CITY.THREE;
  const G = window.__gaitHelper;
  G.hideHud();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clearCars = (x, z, r) => { for (const c of T.cars || []) if (Math.hypot(c.x - x, c.z - z) < r) { c.x = 99999; c.z = 99999; c.speed = 0; } };
  const vehicle = kind === 'bike' ? cm.entities.cyclist : cm.entities.car;
  const tx = -287.0, tz = -1550.0, back = kind === 'bike' ? 28 : 12;
  cm.keys.forward = false; cm.keys.backward = false; cm.keys.boost = false; cm.keys.left = false; cm.keys.right = false;
  // the crowd fills in around the player over the first seconds
  const t0 = performance.now();
  while (T.peds.filter((p) => p.placed).length < 100 && performance.now() - t0 < 60000) await sleep(100);
  setInterval(() => clearCars(tx, tz, 100), 50);
  const target = T.peds.find((p) => p.placed && !p.knock && !p.node) || T.peds.find((p) => p.placed);
  Object.assign(target, { placed: true, x: tx, z: tz, ax: tx, az: tz, t: 0, len: 1000, ux: 0, uz: 1, dir: 1, v: 0, speed: 1.3, pause: 999,
    dodge: 0, dodgeTarget: 0, avoidCheck: Infinity, node: null, mid: null, route: null, nextRoute: null, conversation: null, knock: null });
  vehicle.position.set(tx, vehicle.position.y || 0.85, tz - back);
  vehicle.speed = 0; vehicle.heading = 0;
  app.teleportTo(tx, tz - back, 0);
  const side = opts.side || 1;
  const cy = () => target.y || vehicle.position.y || 0.85;
  app.cameraSystem.cinema = () => {
    const px = target.knock ? target.knock.x : target.x, pz = target.knock ? target.knock.z : target.z;
    return { pos: [tx + 5.2 * side, cy() + 1.3, tz - 3.5], look: [px, cy() + 0.5, pz], fov: 50 };
  };
  // wait for this walker's avatar (its file loads when somebody of that person is first near)
  const w0 = performance.now();
  let avatarAt = null;
  while (performance.now() - w0 < 25000) {
    if (rb && rb.isAvatar(target)) { avatarAt = performance.now() - w0; break; }
    await sleep(100);
  }
  const person = rb ? rb.idOf(target) : null;
  const log = window.__rbKnockLog = [];
  const prev = {};
  const a = new TH.Vector3(), b = new TH.Vector3();
  const names = [['Pelvis', 0], ['Head', 2], ['L Forearm', 4], ['R Forearm', 6], ['L Calf', 8], ['R Calf', 12], ['L Foot', 9], ['R Foot', 13]];
  const T0 = performance.now();
  let hit = false;
  const sampler = setInterval(() => {
    const k = target.knock;
    const av = rb ? rb.avatars.find((q) => q.on && q.rig === target.rig) : null;
    const rec = { t: +((performance.now() - T0) / 1000).toFixed(2), wall: +(Date.now() / 1000).toFixed(3), phase: k ? k.phase : 'none', knockTime: k ? +k.time.toFixed(2) : null,
      avatar: !!(av && av.drawn), rootVisible: av ? !!av.root.visible : false, vehicleSpeed: +vehicle.speed.toFixed(2),
      distToVehicle: +Math.hypot((k ? k.x : target.x) - vehicle.position.x, (k ? k.z : target.z) - vehicle.position.z).toFixed(2) };
    if (av && av.drawn) {
      let maxGap = 0, moved = 0;
      const gaps = {};
      for (const [name, our] of names) {
        av.retarget.worldPos(name, a);
        target.rig.jointAt(our, b);
        gaps[name] = +a.distanceTo(b).toFixed(3);
        maxGap = Math.max(maxGap, gaps[name]);
        if (prev[name]) moved = Math.max(moved, a.distanceTo(prev[name]));
        prev[name] = (prev[name] || new TH.Vector3()).copy(a);
      }
      rec.maxJointGapM = +maxGap.toFixed(3);
      rec.gaps = gaps;
      rec.movedM = +moved.toFixed(3);
      av.retarget.worldPos('Pelvis', a);
      rec.avatarPelvisY = +a.y.toFixed(2);
      rec.rigPelvisY = +target.rig.jointAt(0, b).y.toFixed(2);
    }
    log.push(rec);
    if (k && !hit) { hit = true; cm.keys.forward = false; cm.keys.boost = false; vehicle.speed = 0; cm.keys.backward = false; }
    if (rec.t >= (opts.seconds || 14)) { clearInterval(sampler); console.log('[knock-log:' + kind + '] ' + JSON.stringify(log)); }
  }, 50);
  await sleep(opts.runUp ?? 800);
  cm.keys.forward = true; cm.keys.boost = kind !== 'bike';
  // a bicycle needs more than 4.5 m/s to knock someone down: keep pedalling until it is hit or has passed the target
  const drive = setInterval(() => { if (hit || vehicle.position.z > tz + 6) { clearInterval(drive); cm.keys.forward = false; cm.keys.boost = false; } }, 50);
  return { ok: true, kind, person, avatarAfterMs: avatarAt === null ? null : Math.round(avatarAt), avatarOn: avatarAt !== null };
};

window.__rbKnockSummary = () => {
  const L = window.__rbKnockLog || [];
  const phases = [...new Set(L.map((r) => r.phase))];
  const by = {};
  for (const ph of phases) {
    const R = L.filter((r) => r.phase === ph);
    const drawn = R.filter((r) => r.avatar);
    by[ph] = { samples: R.length, avatarDrawn: drawn.length, rootHidden: R.filter((r) => !r.rootVisible).length,
      maxJointGapM: drawn.length ? Math.max(...drawn.map((r) => r.maxJointGapM)) : null,
      meanJointGapM: drawn.length ? +(drawn.reduce((s, r) => s + r.maxJointGapM, 0) / drawn.length).toFixed(3) : null,
      maxMovedPer50ms: drawn.length ? Math.max(...drawn.map((r) => r.movedM)) : null,
      from: R[0].t, to: R[R.length - 1].t };
  }
  return { phases, by, samples: L.length };
};
