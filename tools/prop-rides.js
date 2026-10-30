// tools/prop-rides.js: street furniture collisions, rides & cost (dev only, never shipped). A shot loads it into the
// running city (tools/shots/prop-rides.json; ?propcolliders=0 for the "before"). It steps the player's real controller
// synchronously at a fixed dt (deterministic), on real stretches: Bloor's cycle track, King St's sidewalks at Bay,
// Queens Quay's track by the shelters; across & along the separators; past props at a glance; the R key; and the
// collision cost per move. Prints one line: [prop-probe] {json}
(function () {
  const app = window.__CITY_APP, C = window.CITY, cm = app.controllerManager;
  const t0 = performance.now();
  cm.nearColliders(0, 0, 1);
  // (the grid's one-time build, first frame: timed again from scratch)
  cm._colliderCells = null;
  const tb = performance.now();
  cm.nearColliders(0, 0, 1);
  const gridMs = performance.now() - tb;
  const r2 = (v) => Math.round(v * 100) / 100;
  const R = { on: cm.colliders.some((c) => c.kind === 'curb'), colliders: cm.colliders.length, gridMs: r2(gridMs) };

  // ---- inventory
  const inv = {};
  let onRoad = 0;
  for (const c of cm.colliders) {
    if (!c.prop) continue;
    const k = c.kind || 'other';
    inv[k] = (inv[k] || 0) + 1;
    if (!['curb', 'post', 'other'].includes(k)) {
      const x = c.circle ? c.circle.x : c.obb ? c.obb.cx : (c.minX + c.maxX) / 2, z = c.circle ? c.circle.z : c.obb ? c.obb.cz : (c.minZ + c.maxZ) / 2;
      if (!C.blockAt(x, z)) onRoad++;
    }
  }
  R.inventory = inv;
  R.propsOffTheSidewalk = onRoad;

  function place(mode, x, z, heading, speed) {
    app.selectMode(mode);
    const e = cm.getActiveEntity();
    cm.resetInput();
    e.position.set(x, cm.getGroundHeight(x, z, mode), z);
    e.heading = heading;
    e.speed = speed;
    for (const k of ['vx', 'vz', 'angularVel', 'verticalSpeed', 'verticalVel', 'pitchVel', 'rollVel', 'heaveVel']) if (k in e) e[k] = 0;
    if (mode === 'car') { e.health = 100; e.wrecked = 0; e.lastCrash = null; e.gear = 0; }
    e.mesh.position.copy(e.position);
    return e;
  }
  let clock = 2000;
  function ride(mode, x, z, heading, speed, seconds, keys = { forward: true }) {
    const e = place(mode, x, z, heading, speed);
    Object.assign(cm.keys, keys);
    const c0 = cm.worldContactCount || 0, path = [];
    let minSpeed = Infinity;
    const dt = 1 / 60, n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) {
      if (mode === 'car') { e.health = 100; e.wrecked = 0; }
      cm.update(dt, (clock += dt));
      path.push([e.position.x, e.position.z]);
      if (i > 60) minSpeed = Math.min(minSpeed, Math.abs(e.speed));
    }
    cm.resetInput();
    const last = path[Math.max(0, path.length - 61)], end = path[path.length - 1];
    return { e, path, contacts: (cm.worldContactCount || 0) - c0, lastSecond: Math.hypot(end[0] - last[0], end[1] - last[1]), minSpeed, made: Math.hypot(end[0] - x, end[1] - z) };
  }

  // A rider holding a line (a human steering): each frame aimed 6 m ahead on line(x) (a street along x: z at x), riding
  // dir (+1 east, -1 west) from x0 to x1. Contacts by what was met (collider kind), and where it slowed under 2 m/s
  function follow(mode, line, x0, x1, speed) {
    const dir = Math.sign(x1 - x0), e = place(mode, x0, line(x0), Math.atan2(dir, 0), speed);
    cm.keys.forward = true;
    const met = {}, slow = [];
    let c0 = cm.worldContactCount || 0, frames = 0, wasSlow = false;
    const dt = 1 / 60;
    while ((e.position.x - x1) * dir < 0 && frames < 60 * 90) {
      const ax = e.position.x + dir * 6;
      e.heading = Math.atan2(ax - e.position.x, line(ax) - e.position.z);
      if (mode === 'car') { e.health = 100; e.wrecked = 0; }
      cm.update(dt, (clock += dt));
      frames++;
      const c = cm.worldContactCount || 0;
      if (c !== c0) {
        const k = cm.lastWorldContact.collider.kind || (cm.lastWorldContact.collider.polygon ? 'landmark' : 'wall');
        met[k] = (met[k] || 0) + (c - c0);
        c0 = c;
      }
      const isSlow = frames > 90 && Math.abs(e.speed) < 2;
      if (isSlow && !wasSlow && slow.length < 6) slow.push([r2(e.position.x), r2(e.position.z), cm.lastWorldContact ? cm.lastWorldContact.collider.kind || 'wall' : '-']);
      wasSlow = isSlow;
    }
    cm.resetInput();
    return { metres: r2(Math.abs(e.position.x - x0)), seconds: r2(frames / 60), met, slow, finished: (e.position.x - x1) * dir >= 0 };
  }
  // the line `d` m from the curb of the eastbound (dir 1) or westbound pieces of a street's cycle track, as z at x
  function trackLine(x0, x1, z0, z1, dir, d) {
    const pts = [];
    for (const b of C.CYCLING_BANDS || []) {
      if (b.cross || (b.kind !== 3 && b.kind !== 4)) continue;
      for (const p of b.P) if (p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1 && p.tx * dir > 0.8) pts.push([p.x, p.z + p.nz * d * (p.m || 1), p.x + p.nx * d]);
    }
    pts.sort((a, b) => a[2] - b[2]);
    if (pts.length < 2) return null;
    const xs = pts.map((p) => p[2]), zs = pts.map((p) => p[1]);
    const line = (x) => {
      if (x <= xs[0]) return zs[0];
      if (x >= xs[xs.length - 1]) return zs[zs.length - 1];
      let i = 0;
      while (xs[i + 1] < x) i++;
      const t = (x - xs[i]) / (xs[i + 1] - xs[i] || 1);
      return zs[i] + (zs[i + 1] - zs[i]) * t;
    };
    line.x0 = xs[0]; line.x1 = xs[xs.length - 1];
    return line;
  }
  R.follow = {};
  for (const [name, bx0, bx1, bz0, bz1] of [['bloor', -1750, -300, -2850, -2780], ['queensQuay', -1150, 200, 480, 620]]) {
    for (const dir of [1, -1]) {
      for (const [mode, d, speed] of [['cyclist', 0.95, 6], ['cyclist', 1.5, 6], ['car', 4.6, 10]]) {
        const line = trackLine(bx0, bx1, bz0, bz1, dir, d);
        if (!line) continue;
        const a = dir > 0 ? line.x0 + 5 : line.x1 - 5, b = dir > 0 ? line.x1 - 5 : line.x0 + 5;
        R.follow[`${name}-${dir > 0 ? 'east' : 'west'}-${mode}@${d}`] = { from: r2(a), to: r2(b), ...follow(mode, line, a, b, speed) };
      }
    }
  }
  // A rider following a named street: each frame aimed 6 m ahead along the nearest piece of it (each carriageway its
  // own), off(curb) m to the right of its centre line (curb: the drawn curb's distance; c - 1: by it; c + 1.6: on the walk), from
  // x0 to x1. Contacts by kind, and where it slowed
  function followRoad(mode, name, x0, x1, off, speed) {
    const dir = Math.sign(x1 - x0);
    const aim = (x, z) => {
      const n = C.nearestRoads(x, z, 40).find((r) => r.road.name === name && !r.road.raised);
      if (!n) return null;
      let tx = n.dx, tz = n.dz;
      if (tx * dir < 0) { tx = -tx; tz = -tz; }
      // the drawn curb on the right (the first curb island out from the centre line), or the data's half width
      let curb = (n.road.w || 8) / 2;
      for (let q = 0.5; q < 14; q += 0.25) if (C.blockAt(n.px - tz * q, n.pz + tx * q)) { curb = q; break; }
      const o = off(curb);
      return { x: n.px + tx * 6 - tz * o, z: n.pz + tz * 6 + tx * o, cx: n.px - tz * o, cz: n.pz + tx * o };
    };
    let best = null;
    for (const r of C.ROADS) if (r.name === name && !r.raised) for (const p of r.pts) if (!best || Math.abs(p.x - x0) < Math.abs(best.x - x0)) best = p;
    const a0 = aim(best.x, best.z);
    const e = place(mode, a0.cx, a0.cz, Math.atan2(dir, 0), speed);
    cm.keys.forward = true;
    const met = {}, slow = [], where = [];
    let c0 = cm.worldContactCount || 0, frames = 0, wasSlow = false;
    while ((e.position.x - x1) * dir < 0 && frames < 60 * 90) {
      const a = aim(e.position.x, e.position.z);
      if (a) e.heading = Math.atan2(a.x - e.position.x, a.z - e.position.z);
      if (mode === 'car') { e.health = 100; e.wrecked = 0; }
      cm.update(1 / 60, (clock += 1 / 60));
      frames++;
      const c = cm.worldContactCount || 0;
      if (c !== c0) {
        const col = cm.lastWorldContact.collider, k = col.kind || (col.polygon ? 'landmark' : 'wall');
        met[k] = (met[k] || 0) + (c - c0);
        if (col.prop && where.length < 8 && !where.some((w) => w[3] === col)) where.push([k, r2(e.position.x), r2(e.position.z), col]);
        c0 = c;
      }
      const isSlow = frames > 90 && Math.abs(e.speed) < 2;
      if (isSlow && !wasSlow && slow.length < 6) slow.push([r2(e.position.x), r2(e.position.z), cm.lastWorldContact ? cm.lastWorldContact.collider.kind || 'wall' : '-']);
      wasSlow = isSlow;
    }
    cm.resetInput();
    return { metres: r2(Math.abs(e.position.x - a0.cx)), seconds: r2(frames / 60), met, slow, propsAt: where.map((w) => w.slice(0, 3)), finished: (e.position.x - x1) * dir >= 0 };
  }
  // Queens Quay W (Spadina to Bay) & King St (Spadina to Jarvis, through Bay): by the right-hand curb, cyclist & car,
  // both ways; Queens Quay on its walks too (1.6 m out: by the shelters)
  R.qqShelters = cm.colliders.filter((c) => c.kind === 'shelter' && c.obb.cx > -1121 && c.obb.cx < 158 && c.obb.cz > 480 && c.obb.cz < 620).length;
  for (const [tag, name, xa, xb] of [['qq', 'Queens Quay West', -1110, 150], ['king', 'King Street West', -1100, 400]]) {
    for (const dir of [1, -1]) {
      const [x0, x1] = dir > 0 ? [xa, xb] : [xb, xa];
      for (const [where, mode, off, speed] of [['curb', 'cyclist', (c) => c - 1.0, 6], ['lane', 'car', (c) => c - 1.9, 10], ['walk', 'cyclist', (c) => c + 1.6, 6]]) {
        if (tag === 'king' && where === 'walk') continue;
        R.follow[`${tag}-${dir > 0 ? 'east' : 'west'}-${where}`] = followRoad(mode, name, x0, x1, off, speed);
      }
    }
  }
  // King St W, 120 m either side of Bay, on both sidewalks (the middle of the walk: 1.6 m in from the curb, or 2.4)
  {
    const kb = { x: 132.5, z: -349.6 };
    for (const side of [-1, 1]) {
      let curb = 0;
      for (let o = 4; o < 20; o += 0.25) if (C.blockAt(kb.x - 40, kb.z + side * o)) { curb = o; break; }
      if (!curb) continue;
      for (const inset of [1.6, 2.4]) {
        for (const [mode, speed, dir] of [['cyclist', 6, 1], ['cyclist', 6, -1], ['person', 1.6, 1]]) {
          const line = () => kb.z + side * (curb + inset);
          R.follow[`king-${side < 0 ? 'north' : 'south'}-${mode}-${dir > 0 ? 'east' : 'west'}@${inset}`] = follow(mode, line, kb.x - dir * 120, kb.x + dir * 120, speed);
        }
      }
    }
  }

  // ---- the cycle tracks: a band's curb line (C.CYCLING_BANDS), the track's & separator's offsets from it
  const TRACK = 3, TRACK2 = 4, SEP = 0.45;
  const bands = C.CYCLING_BANDS || [];
  const width = (b) => (b.kind === TRACK2 ? 3.0 : 1.85);
  function trackNear(x0, x1, z0, z1, kinds = [TRACK, TRACK2]) {
    let best = null;
    for (const b of bands) {
      if (b.cross || !kinds.includes(b.kind)) continue;
      const P = b.P, inside = P.filter((p) => p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1);
      if (inside.length >= 2 && (!best || P.len > best.P.len)) best = b;
    }
    return best;
  }
  // where (x, z) is relative to band b: s along, d from its curb into the road
  function rel(b, x, z) {
    let bestD = Infinity, out = null;
    for (let i = 0; i + 1 < b.P.length; i++) {
      const p = b.P[i], q = b.P[i + 1], dx = q.x - p.x, dz = q.z - p.z, l2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (z - p.z) * dz) / l2));
      const cx = p.x + dx * t, cz = p.z + dz * t, dd = Math.hypot(x - cx, z - cz);
      if (dd < bestD) { bestD = dd; out = { s: p.s + t * Math.sqrt(l2), d: (x - cx) * p.nx + (z - cz) * p.nz }; }
    }
    return out;
  }
  function onTrack(b, s, d) {
    const P = b.P;
    let i = 0;
    while (i + 2 < P.length && P[i + 1].s < s) i++;
    const p = P[i], q = P[i + 1], t = (s - p.s) / (q.s - p.s || 1);
    const tx = (q.x - p.x), tz = (q.z - p.z), L = Math.hypot(tx, tz) || 1;
    return { x: p.x + (q.x - p.x) * t + p.nx * d, z: p.z + (q.z - p.z) * t + p.nz * d, tx: tx / L, tz: tz / L, nx: p.nx, nz: p.nz };
  }
  function trackRides(name, b) {
    if (!b) return { name, none: true };
    const W = width(b), out = { name, km: r2(b.P.len / 1000), w: W };
    // along it, in its middle, 25 s (or to its end)
    const s0 = 12, q = onTrack(b, s0, W / 2), secs = Math.min(25, (b.P.len - s0 - 15) / 7);
    const a = ride('cyclist', q.x, q.z, Math.atan2(q.tx, q.tz), 6, secs);
    const ds = a.path.map(([x, z]) => rel(b, x, z));
    out.along = { secs: r2(secs), made: r2(a.made), contacts: a.contacts, minSpeed: r2(a.minSpeed), lastSecond: r2(a.lastSecond), dMin: r2(Math.min(...ds.map((v) => v.d))), dMax: r2(Math.max(...ds.map((v) => v.d))), leftTrack: ds.some((v) => v.d > W + SEP + 0.3) };
    // across the separator from the track, steeply (45 degrees) & at a glance (10 degrees), and a car into it at 10 & 45
    for (const [label, mode, deg, d0, sgn, speed] of [['bike45', 'cyclist', 45, W / 2, 1, 6], ['bike10', 'cyclist', 10, W / 2, 1, 6], ['car10', 'car', 10, W + SEP + 2.2, -1, 9], ['car45', 'car', 45, W + SEP + 3.5, -1, 9]]) {
      const res = [];
      for (const s of [40, 90, 140, 190]) {
        if (s > b.P.len - 30) continue;
        const p = onTrack(b, s, d0), r = (deg * Math.PI) / 180;
        // heading: along the track, turned toward the road (sgn 1) or toward the curb (-1)
        const hx = p.tx * Math.cos(r) + p.nx * Math.sin(r) * sgn, hz = p.tz * Math.cos(r) + p.nz * Math.sin(r) * sgn;
        const rr = ride(mode, p.x, p.z, Math.atan2(hx, hz), speed, 2.5);
        const e = rel(b, rr.e.position.x, rr.e.position.z);
        res.push(r2(e.d));
      }
      out[label] = res; // where it ended up, from the curb (the separator: W..W+0.45)
    }
    return out;
  }
  // Bloor St W between Bathurst & Avenue Rd; Queens Quay W between Spadina & Bay
  R.bloor = trackRides('Bloor', trackNear(-1700, -350, -2840, -2790));
  R.queensQuay = trackRides('Queens Quay', trackNear(-1100, 150, 500, 600));

  // ---- King St W at Bay: along both sidewalks, cyclist & walker, 60 m either way of the corner
  {
    const kb = { x: 132.5, z: -349.6 }, out = {};
    for (const side of [-1, 1]) {
      let d = 0;
      for (let o = 4; o < 20; o += 0.5) if (C.blockAt(kb.x - 40, kb.z + side * o)) { d = o + 1.6; break; }
      if (!d) continue;
      if (side > 0) R.kingSidewalk = d;
      for (const [mode, speed, dir] of [['cyclist', 6, 1], ['cyclist', 6, -1], ['person', 1.6, 1]]) {
        const x = kb.x - dir * 70, z = kb.z + side * d;
        const r = ride(mode, x, z, Math.atan2(dir, 0), speed, mode === 'person' ? 12 : 16);
        out[`${side < 0 ? 'north' : 'south'}-${mode}-${dir > 0 ? 'east' : 'west'}`] = { made: r2(r.made), contacts: r.contacts, lastSecond: r2(r.lastSecond), stuck: r.lastSecond < 0.5 };
      }
    }
    R.kingBay = out;
  }

  // ---- past props at a glance: a cyclist riding by each on the sidewalk, its slim body overlapping the prop's edge by
  // 10 cm: it should brush by, never stop
  {
    let seed = 99;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const kinds = ['hydrant', 'litterBin', 'bikeRing', 'postBox', 'pole', 'shelter'];
    const res = {};
    const props = cm.colliders.filter((c) => c.prop && kinds.includes(c.kind));
    for (const k of kinds) {
      const list = props.filter((c) => c.kind === k);
      let n = 0, stuck = 0, stopped = 0;
      for (let i = 0; i < 25 && list.length; i++) {
        const c = list[Math.floor(rnd() * list.length)];
        const cx = c.circle ? c.circle.x : c.obb.cx, cz = c.circle ? c.circle.z : c.obb.cz;
        const half = c.circle ? c.circle.r : Math.min(c.obb.hx, c.obb.hz);
        // a heading along the prop's long side (a box) or any way (a circle)
        const along = c.obb ? (c.obb.hz >= c.obb.hx ? Math.atan2(c.obb.sn, c.obb.cs) : Math.atan2(c.obb.cs, -c.obb.sn)) : rnd() * Math.PI * 2;
        const ux = Math.sin(along), uz = Math.cos(along), vx = uz, vz = -ux; // ahead & to the right
        const lat = half + 0.3 - 0.1, back = (c.obb ? Math.max(c.obb.hx, c.obb.hz) : 0) + 5;
        const sx = cx - ux * back + vx * lat, sz = cz - uz * back + vz * lat;
        if (!C.blockAt(sx, sz)) continue;
        const r = ride('cyclist', sx, sz, along, 5, 2.2);
        n++;
        if (r.lastSecond < 0.5) stuck++;
        if (r.minSpeed < 1) stopped++;
      }
      res[k] = { n, stuck, slowedUnder1: stopped };
    }
    R.glance = res;
  }

  // ---- the R key from random spots downtown: back on a road, clear
  {
    let seed = 4242;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const res = {};
    for (const mode of ['cyclist', 'car', 'person']) {
      let n = 0, ok = 0;
      for (let i = 0; i < 30; i++) {
        const x = -1500 + rnd() * 2200, z = -2900 + rnd() * 3300;
        place(mode, x, z, 0, 0);
        const road = cm.findRoadReset();
        n++;
        if (road) ok++;
      }
      res[mode] = `${ok}/${n}`;
    }
    R.roadReset = res;
  }

  // ---- cost: the controller's whole move (moveBody: the substeps, the gathering & the contacts) & the whole update,
  // riding along Bloor's track, King St's sidewalk & Queens Quay (microseconds per call)
  {
    const cost = {};
    const routes = [];
    if (R.bloor.along) { const b = trackNear(-1700, -350, -2840, -2790), q = onTrack(b, 12, width(b) / 2); routes.push(['bloor', q.x, q.z, Math.atan2(q.tx, q.tz)]); }
    if (R.kingSidewalk) routes.push(['kingBay', 132.5 - 70, -349.6 + R.kingSidewalk, Math.PI / 2]);
    if (R.queensQuay.along) { const b = trackNear(-1100, 150, 500, 600), q = onTrack(b, 12, width(b) / 2); routes.push(['queensQuay', q.x, q.z, Math.atan2(q.tx, q.tz)]); }
    for (const [name, x, z, h] of routes) {
      for (const [mode, speed] of [['cyclist', 8], ['car', 14], ['person', 1.6]]) {
        const e = place(mode, x, z, h, speed);
        const N = 900;
        // warm, then the move alone
        for (let i = 0; i < 60; i++) { e.speed = speed; cm.moveBody(e, mode, 1 / 60); }
        place(mode, x, z, h, speed);
        let t = performance.now();
        for (let i = 0; i < N; i++) { e.speed = speed; if (mode === 'car') { e.health = 100; e.wrecked = 0; } cm.moveBody(e, mode, 1 / 60); }
        const move = ((performance.now() - t) / N) * 1000;
        place(mode, x, z, h, speed);
        cm.keys.forward = true;
        t = performance.now();
        for (let i = 0; i < N; i++) { if (mode === 'car') { e.health = 100; e.wrecked = 0; } cm.update(1 / 60, (clock += 1 / 60)); }
        const upd = ((performance.now() - t) / N) * 1000;
        cm.resetInput();
        const near = cm.nearColliders(x, z, 12).length;
        cost[`${name}-${mode}`] = { moveUs: r2(move), updateUs: r2(upd), within12m: near };
      }
    }
    R.cost = cost;
  }

  app.selectMode('cyclist');
  R.ms = Math.round(performance.now() - t0);
  console.log('[prop-probe] ' + JSON.stringify(R));
  window.__PROP_PROBE = R;
})();
