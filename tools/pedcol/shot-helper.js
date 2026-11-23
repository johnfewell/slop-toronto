// Capture helper for the pedestrian collision / curb group captures (st-iqsg). Added with CAPTURE_INIT_SCRIPT.
// All of it only reads the running game and holds the camera still: nothing here changes how anyone walks.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = () => window.__CITY_APP;
window.__pcSleep = sleep;

// the groups of people waiting at curbs now: Map of "node-side-dir" -> { node, mid, side, dir, list }
function waitingGroups() {
  const ids = new Map(), groups = new Map();
  let n = 0;
  for (const p of app().trafficSystem.peds) {
    if (!p.placed || !p.waiting || !(p.node || p.mid)) continue;
    const key = p.node || p.mid;
    if (!ids.has(key)) ids.set(key, ++n);
    const k = `${ids.get(key)}:${p.side}:${p.dir}`;
    if (!groups.has(k)) groups.set(k, { node: p.node, mid: p.mid, side: p.side, dir: p.dir, list: [] });
    groups.get(k).list.push(p);
  }
  return groups;
}
window.__pcAt = null; // { x, z, r }: only the groups waiting there (the same corner for the before and after runs)
const biggest = () => {
  let best = null;
  const at = window.__pcAt;
  for (const g of waitingGroups().values()) {
    if (!g.node || (at && Math.hypot(g.list[0].x - at.x, g.list[0].z - at.z) > at.r)) continue;
    if (window.__pcClear && (g.node.crossing[g.side] > 0 || g.node.crossing.some((c) => c > 0))) continue; // (no car in the junction: the walk will not be held)
    if (!best || g.list.length > best.list.length) best = g;
  }
  return best;
};
// seconds until the WALK comes on for a node's crosswalk side (0: it is on; Infinity: not within 150 s)
function secondsToWalk(g) {
  const S = window.CITY.SIGNALS, ts = app().trafficSystem, c = ts.clock;
  if (!g.node) return Infinity;
  for (let d = 0; d < 150; d += 0.25) if (S.walk(g.node.sigJ, g.node.walkP[g.side], c + d)) return d;
  return Infinity;
}
const centroid = (list) => {
  let x = 0, z = 0;
  for (const p of list) { x += p.x; z += p.z; }
  return { x: x / list.length, z: z / list.length };
};

// Poll until some curb group has `min` people (and, with minRed seconds, that long until its WALK); resolves with a summary
window.__pcFind = async (min, timeoutMs, minRed = 0) => {
  const t0 = performance.now();
  let g = null;
  while (performance.now() - t0 < timeoutMs) {
    g = biggest();
    if (g && g.list.length >= min && secondsToWalk(g) >= minRed) break;
    await sleep(250);
  }
  if (!g) return { error: 'no group waiting' };
  window.__pcGroup = g;
  const c = centroid(g.list), p = g.list[0];
  return { count: g.list.length, x: c.x, z: c.z, hx: p.ux * p.dir, hz: p.uz * p.dir, secondsToWalk: secondsToWalk(g),
    people: g.list.map((q) => ({ id: q.id, x: +q.x.toFixed(2), z: +q.z.toFixed(2), depth: +(q.spotDepth || 0).toFixed(2), spotted: q.spotRoute === q.route, stand: app().trafficSystem.pedRoutes.canStand(q.x, q.z), standLoose: app().trafficSystem.pedRoutes.canStand(q.x, q.z, true), block: !!window.CITY.blockAt(q.x, q.z), lock: q.sepLock, tgt: +(q.sepTarget || 0).toFixed(2), home: +(q.sepHome || 0).toFixed(2), sep: +(q.sep || 0).toFixed(2) })) };
};

// Hold the camera at a fixed pose (until __pcRelease). pose: { x, y, z, lx, ly, lz }
window.__pcHold = (pose) => {
  const cs = app().cameraSystem, T = window.CITY.THREE;
  window.__pcPose = pose;
  if (!cs.__pcUpdate) {
    cs.__pcUpdate = cs.update.bind(cs);
    cs.update = (dt, elapsed) => {
      cs.__pcUpdate(dt, elapsed);
      const q = window.__pcPose;
      if (!q) return;
      const cam = cs.camera;
      cam.position.set(q.x, q.y, q.z);
      cam.lookAt(q.lx, q.ly, q.lz);
      cam.updateMatrixWorld(true);
      if (cs.currentPos) cs.currentPos.copy(cam.position);
      if (cs.currentLookAt) cs.currentLookAt.set(q.lx, q.ly, q.lz);
    };
  }
};
window.__pcRelease = () => { window.__pcPose = null; };

// camera on the group found: 'high' (a raised three-quarter view from the side), 'street' (eye height, from the road)
window.__pcView = (kind) => {
  const g = window.__pcGroup, c = centroid(g.list), p = g.list[0];
  const hx = p.ux * p.dir, hz = p.uz * p.dir, wx = p.uz, wz = -p.ux;
  const gy = 0.22;
  if (kind === 'high') {
    window.__pcHold({ x: c.x + wx * 6.5 - hx * 2.5, y: gy + 6.2, z: c.z + wz * 6.5 - hz * 2.5, lx: c.x + hx * 0.3, ly: gy + 0.6, lz: c.z + hz * 0.3 });
  } else if (kind === 'top') {
    window.__pcHold({ x: c.x - hx * 0.01 + wx * 0.01, y: gy + 11, z: c.z - hz * 0.01 + wz * 0.01, lx: c.x + hx * 0.4, ly: gy, lz: c.z + hz * 0.4 });
  } else if (kind === 'wide') {
    window.__pcHold({ x: c.x + wx * 9 - hx * 4, y: gy + 7.5, z: c.z + wz * 9 - hz * 4, lx: c.x + hx * 2.5, ly: gy + 0.4, lz: c.z + hz * 2.5 });
  } else {
    window.__pcHold({ x: c.x + hx * 5.5 + wx * 1.5, y: gy + 1.65, z: c.z + hz * 5.5 + wz * 1.5, lx: c.x - hx * 0.2, ly: gy + 1.0, lz: c.z - hz * 0.2 });
  }
  return { x: c.x, z: c.z };
};

// waits for the WALK to come on at the group's corner, resolves `after` seconds into it
window.__pcUntilWalk = async (after) => {
  const g = window.__pcGroup;
  const t0 = performance.now();
  while (secondsToWalk(g) > 0 && performance.now() - t0 < 150000) await sleep(100);
  await sleep(after * 1000);
  return { waited: (performance.now() - t0) / 1000, stillWaiting: g.list.filter((q) => q.waiting).length };
};
// resolves when the WALK is `lead` seconds away (to start a recording just before the step-off)
window.__pcLead = async (lead) => {
  const g = window.__pcGroup;
  const t0 = performance.now();
  while (secondsToWalk(g) > lead && performance.now() - t0 < 150000) await sleep(100);
  return { lead: secondsToWalk(g), waiting: g.list.filter((q) => q.waiting).length };
};

// Two walkers going opposite ways along the same sidewalk, 5-14 m apart, both walking: hold the camera on them
window.__pcPair = async (timeoutMs, maxLat = 1.0) => {
  const t0 = performance.now();
  const peds = app().trafficSystem.peds;
  while (performance.now() - t0 < timeoutMs) {
    const list = peds.filter((p) => p.placed && !p.node && !p.mid && p.route?.edge && p.v > 0.8 && p.t > 8 && p.t < p.len - 8 && !p.knock);
    let best = null;
    for (const a of list) {
      for (const b of list) {
        if (a.id >= b.id || a.route.edge !== b.route.edge || a.dir === b.dir) continue;
        const dx = b.x - a.x, dz = b.z - a.z, along = (dx * a.ux + dz * a.uz) * a.dir, lat = Math.abs(dx * a.uz - dz * a.ux);
        if (along < 5 || along > 14 || lat > maxLat) continue; // facing, same lane roughly
        const score = along + lat * 4;
        if (!best || score < best.score) best = { a, b, score, along, lat };
      }
    }
    if (best) {
      const { a, b } = best;
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, wx = a.uz, wz = -a.ux, hx = a.ux * a.dir, hz = a.uz * a.dir;
      const gy = 0.22;
      window.__pcPairIds = [a.id, b.id];
      window.__pcHold({ x: mx + wx * 9.5, y: gy + 3.6, z: mz + wz * 9.5, lx: mx, ly: gy + 0.9, lz: mz });
      return { a: a.id, b: b.id, along: best.along, lat: best.lat };
    }
    await sleep(250);
  }
  return { error: 'no pair' };
};

// The player (on foot) set down `back` m before a walker coming the other way along its sidewalk, facing it
window.__pcPlayerAtWalker = async (timeoutMs, back) => {
  const t0 = performance.now();
  const peds = app().trafficSystem.peds;
  while (performance.now() - t0 < timeoutMs) {
    const w = peds.find((p) => p.placed && !p.node && !p.mid && p.route?.edge && p.v > 1 && p.t > back + 8 && p.t < p.len - back - 8 && p.dir > 0 && !p.knock);
    if (w) {
      const hx = w.ux * w.dir, hz = w.uz * w.dir;
      const x = w.x + hx * back, z = w.z + hz * back;
      window.__pcRelease();
      app().teleportTo(x, z, Math.atan2(-hx, -hz));
      window.__pcWalker = w;
      return { walker: w.id, x, z, back };
    }
    await sleep(250);
  }
  return { error: 'no walker' };
};
// The player set down `back` m behind the group waiting at a curb, facing it (the group found with __pcFind)
window.__pcPlayerAtGroup = (back) => {
  const g = window.__pcGroup, c = centroid(g.list), p = g.list[0];
  const hx = p.ux * p.dir, hz = p.uz * p.dir;
  window.__pcRelease();
  app().teleportTo(c.x - hx * back, c.z - hz * back, Math.atan2(hx, hz));
  return { x: c.x - hx * back, z: c.z - hz * back, count: g.list.length };
};
// where the player is, and the closest walker (m) now
window.__pcPlayerReport = () => {
  const e = app().controllerManager.getActiveEntity();
  let best = Infinity, id = -1;
  for (const p of app().trafficSystem.peds) {
    if (!p.placed) continue;
    const d = Math.hypot(p.x - e.position.x, p.z - e.position.z);
    if (d < best) { best = d; id = p.id; }
  }
  return { x: e.position.x, z: e.position.z, closest: best, id };
};
// Log the player's distance to the nearest walker every 100 ms into window.__pcLog (read it afterwards)
window.__pcLogStart = () => {
  window.__pcLog = [];
  clearInterval(window.__pcLogTimer);
  window.__pcLogTimer = setInterval(() => window.__pcLog.push({ t: +(performance.now() / 1000).toFixed(2), ...window.__pcPlayerReport() }), 100);
};
window.__pcLogStop = () => { clearInterval(window.__pcLogTimer); return window.__pcLog; };

// the overlap counter (?pedoverlap=1): reset and read
window.__pcOverlapReset = () => { const o = window.__pedOverlap; if (o) Object.assign(o, { shiftN: 0, shiftMax: 0, tiltN: 0, tiltSum: 0, tilt10: 0, tilt20: 0, tiltMax: 0, worst: null, walkerFrames: 0, roadFrames: 0, roadSidewalk: 0, roadCrossing: 0, roomLow: 0, roomMid: 0, roomHigh: 0, passStrict: 0, passLoose: 0, passFree: 0, late: 0, lateFar: 0, wait: 0, cross: 0, walk: 0, frames: 0, pairSum: 0, pairMax: 0, last: 0, steered: 0, ghosted: 0, turned: 0 }); return !!o; };
window.__pcOverlap = () => { const o = window.__pedOverlap; return o ? { ...o, mean: o.pairSum / Math.max(1, o.frames) } : null; };
// wait, resolving with the overlap counter (the crowd around the camera, however it moves)
window.__pcOverlapRun = async (ms) => { window.__pcOverlapReset(); await sleep(ms); return window.__pcOverlap(); };

// Two groups waiting at opposite ends of one crossing (at least `min` each): hold the camera over its middle
window.__pcFindBoth = async (min, timeoutMs) => {
  const t0 = performance.now();
  let best = null;
  while (performance.now() - t0 < timeoutMs) {
    const by = new Map();
    for (const g of waitingGroups().values()) {
      if (!g.node) continue;
      const k = `${g.node.x},${g.node.z}:${g.side}`;
      if (!by.has(k)) by.set(k, {});
      by.get(k)[g.dir > 0 ? 'a' : 'b'] = g;
    }
    best = null;
    for (const v of by.values()) {
      if (!v.a || !v.b) continue;
      const m = Math.min(v.a.list.length, v.b.list.length);
      if (!best || m > best.m) best = { m, ...v };
    }
    if (best && best.m >= min && secondsToWalk(best.a) >= 6) break;
    await sleep(250);
  }
  if (!best) return { error: 'no opposing groups' };
  window.__pcBoth = best;
  window.__pcGroup = best.a;
  const ca = centroid(best.a.list), cb = centroid(best.b.list), p = best.a.list[0];
  const mx = (ca.x + cb.x) / 2, mz = (ca.z + cb.z) / 2, wx = p.uz, wz = -p.ux, hx = p.ux * p.dir, hz = p.uz * p.dir;
  const gy = 0.22, span = Math.hypot(ca.x - cb.x, ca.z - cb.z);
  window.__pcHold({ x: mx + wx * (span * 0.55 + 3), y: gy + 8, z: mz + wz * (span * 0.55 + 3), lx: mx, ly: gy, lz: mz });
  return { a: best.a.list.length, b: best.b.list.length, span, secondsToWalk: secondsToWalk(best.a) };
};

// the bike (or car) set down `back` m before a walker on its sidewalk, facing it; logs how many walkers are knocked down
window.__pcKnockSetup = async (timeoutMs, back) => {
  const t0 = performance.now();
  const peds = app().trafficSystem.peds;
  while (performance.now() - t0 < timeoutMs) {
    const w = peds.find((p) => p.placed && !p.node && !p.mid && p.route?.edge && p.v > 1 && p.t > back + 8 && p.t < p.len - back - 8 && p.dir > 0 && !p.knock);
    if (w) {
      const hx = w.ux * w.dir, hz = w.uz * w.dir;
      window.__pcRelease();
      app().teleportTo(w.x + hx * back, w.z + hz * back, Math.atan2(-hx, -hz));
      window.__pcKnockLog = [];
      clearInterval(window.__pcKnockTimer);
      window.__pcKnockTimer = setInterval(() => window.__pcKnockLog.push({ t: +(performance.now() / 1000).toFixed(2), knocked: peds.filter((p) => p.placed && p.knock).length, ...window.__pcPlayerReport() }), 100);
      return { walker: w.id, back };
    }
    await sleep(250);
  }
  return { error: 'no walker' };
};
window.__pcKnockStop = () => { clearInterval(window.__pcKnockTimer); return window.__pcKnockLog; };

// Body tilt from vertical (degrees, pelvis to head) of the pair's walkers, every 100 ms into window.__pcTilt
window.__pcTiltStart = () => {
  window.__pcTilt = [];
  const T = window.CITY.THREE, a = new T.Vector3(), b = new T.Vector3();
  clearInterval(window.__pcTiltTimer);
  window.__pcTiltTimer = setInterval(() => {
    const peds = app().trafficSystem.peds, ids = window.__pcPairIds || [];
    for (const id of ids) {
      const p = peds[id];
      if (!p || !p.placed) continue;
      p.rig.jointAt(0, a); p.rig.jointAt(2, b);
      window.__pcTilt.push({ id, tilt: Math.atan2(Math.hypot(b.x - a.x, b.z - a.z), b.y - a.y) * 57.29578, sep: p.sep, tgt: p.sepTarget, v: p.v });
    }
  }, 100);
};
window.__pcTiltStop = () => { clearInterval(window.__pcTiltTimer); return window.__pcTilt; };

// Log the group's members every 200 ms (how many still wait, how many are on the crossing, how many are in the roadway beside it)
window.__pcStepLogStart = () => {
  const g = window.__pcGroup, list = g.list.slice();
  window.__pcStepLog = [];
  const t0 = performance.now();
  clearInterval(window.__pcStepTimer);
  window.__pcStepTimer = setInterval(() => window.__pcStepLog.push({ t: +((performance.now() - t0) / 1000).toFixed(1), waiting: list.filter((p) => p.waiting).length, crossing: list.filter((p) => !p.waiting && (p.node || p.mid) && p.t > 2).length, why: list.filter((p) => p.waiting).slice(0, 3).map((p) => app().trafficSystem.pedWhy(p)), secondsToWalk: secondsToWalk(g) }), 200);
  return list.length;
};
window.__pcStepLogStop = () => { clearInterval(window.__pcStepTimer); return window.__pcStepLog; };
