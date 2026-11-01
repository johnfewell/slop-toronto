// tools/make-home-clips-shots.mjs: writes tools/shots/home-clips.json, the camera moves for the home page's muted
// video loops (assets/site/clips/: four time-of-day covers and one clip per listing / ride), from readable JS.
// Every clip is an in-app capture of the Slop Toronto city; nothing is generated or stock.
// usage (from the repository root): node tools/make-home-clips-shots.mjs tools/shots/home-clips.json [cover|listings|all|name,name]
// Then render on the Mac mini via gpu2 (never on the laptop) with tools/render-film.mjs, which plays the shots back to back
// into one MP4, and cut, loop and encode them with tools/encode-home-clips.sh. Roughly:
//   GPU2_LOCK_WAIT=60 gpu2 slop-toronto-home-clips -- env FILM_SHOTS=tools/shots/home-clips.json FILM_SIZE=1600x900 \
//     FILM_FPS=30 node tools/render-film.mjs
//   tools/encode-home-clips.sh <the rendered mp4> assets/site/clips 30 1.5 1600x900 <mp4 crf> <webm crf> cover-golden:11.5 ...
// (the covers are 11.5 s shots: a 10 s loop plus a 1.5 s cross-fade; the listing shots are 7 s). The MP4 CRFs of the
// 2026-10-31 clips, read back from x264's settings in each file (strings <clip>.mp4 | grep -o 'crf=[0-9.]*'): covers
// golden & midday 29, sunset 31, night 32; waterfront-ride 31, streetcar-504 30, the other listings 27. Their WebM CRFs
// weren't recorded; cover-sunset & cover-night, re-rendered that night for the lit CN Tower (st-yir3), used 53 (START=0
// cover-sunset:11.5 and START=11.5 cover-night:11.5 from a two-shot render), which matched the earlier files' sizes.
import fs from 'node:fs';

const fn = (f) => {
  const src = f.toString();
  return src.slice(src.indexOf('{') + 1, src.lastIndexOf('}')).trim();
};

// Helpers on window.__HC, run once when the city is ready
const prelude = fn(() => {
  const H = (window.__HC = {});
  H.wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  // a slow drift: from pos, sliding `side` m across the view and `fwd` m along it, rising `up` m; look keeps its offset
  H.drift = (shot, pos, look, fov, side = 0, fwd = 0, up = 0, lookShift = 1) => {
    const dx = look[0] - pos[0], dz = look[2] - pos[2], l = Math.hypot(dx, dz) || 1;
    const f = [dx / l, dz / l], r = [-f[1], f[0]];
    const d = [r[0] * side + f[0] * fwd, up, r[1] * side + f[1] * fwd];
    shot.ease = 'linear';
    shot.path = [
      { t: 0, pos, look, fov },
      { t: shot.duration, pos: pos.map((v, i) => v + d[i]), look: look.map((v, i) => v + d[i] * lookShift), fov }
    ];
  };
  // a smoothed follow camera: the target's position & forward yaw low-passed per frame
  H.follower = (k = 0.06) => {
    let s = null;
    return (x, y, z, yaw) => {
      if (!s) s = { x, y, z, yaw };
      else {
        s.x += (x - s.x) * 0.5; s.y += (y - s.y) * 0.5; s.z += (z - s.z) * 0.5;
        s.yaw += H.wrap(yaw - s.yaw) * k;
      }
      return s;
    };
  };
  H.clearInput = () => {
    const cm = window.__CITY_APP.controllerManager;
    cm.clearTouchInput();
  };
  const S = window.CITY.LANDMARK_SITES || {};
  console.log('[hc] sites ' + JSON.stringify(Object.fromEntries(Object.entries(S).map(([k, v]) => [k, v && [Math.round(v.x), Math.round(v.z)]]))));
  console.log('[hc] cn ' + JSON.stringify(window.CITY.GEO.points && window.CITY.GEO.points.cnTower) + ' humberArch ' + JSON.stringify(window.CITY.TELEPORT_LOCATIONS.humberArch));
});

const shots = [];
const add = (s) => shots.push(s);

// ---- 1. The cover: the CN Tower & the skyline over the lake, from off Coronation Park (the film's opener), 4 times;
//         turned 11.5 deg left so the tower stands ~70% across (the page's headline covers the left 55%)
const COVER_DUR = 11.5; // 10 s loop + 1.5 s cross-fade
for (const [name, time] of [['cover-golden', 'golden'], ['cover-midday', 'midday'], ['cover-sunset', 'twilight'], ['cover-night', 'midnight']]) {
  add({
    name, time, duration: COVER_DUR, ease: 'linear',
    path: [
      { t: 0, pos: [-2330, 9, 1030], look: [-740, 195, -232], fov: 32 },
      { t: COVER_DUR, pos: [-2310, 10.5, 1048], look: [-720, 196.5, -214], fov: 32 }
    ]
  });
}

// ---- 2. The listings (7 s: a 6 s loop + 1 s cross-fade), west to east
const DUR = 7;

const RIDE_CAMS = {
  // a: the chase, behind & a little to the lake side
  'waterfront-ride': '{ pos: [f.x - fx * 6.5 + rx * 1.2, f.y + 2.4, f.z - fz * 6.5 + rz * 1.2], look: [f.x + fx * 8, f.y + 1.0, f.z + fz * 8], fov: 50 }'
};
for (const [rideName, cam] of Object.entries(RIDE_CAMS)) add({
  name: rideName, time: 'golden', duration: DUR,
  setup: fn(() => {
    // the player's cyclist on the Martin Goodman Trail (its red asphalt) east of the Humber Bay Arch, steered along it
    const H = window.__HC, cm = app.cameraSystem && app.controllerManager, T = C.TELEPORT_LOCATIONS.humberArch;
    const trails = (C.GEO.cycling && C.GEO.cycling.trails) || [];
    let best = null;
    for (const [w, surface, level, flat] of trails) {
      if (!surface) continue;
      const P = [];
      for (let i = 0; i < flat.length; i += 2) P.push({ x: flat[i], z: flat[i + 1] });
      let len = 0;
      for (let i = 1; i < P.length; i++) len += Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z);
      if (len < 140) continue;
      for (let i = 0; i < P.length; i++) {
        const d = Math.hypot(P[i].x - T.x, P[i].z - T.z);
        if (d < 600 && (!best || d < best.d)) best = { d, P, i, w, len };
      }
    }
    if (!best) throw new Error('no red trail near the Humber Bay start');
    // ride the way that heads east (towards the CN Tower); keep >= 110 m of trail ahead
    let P = best.P;
    const east = P[P.length - 1].x > P[0].x;
    if (!east) P = P.slice().reverse();
    const cum = [0];
    for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z));
    let i0 = east ? best.i : P.length - 1 - best.i;
    while (i0 > 0 && cum[cum.length - 1] - cum[i0] < 110) i0--;
    const at = (s) => {
      s = Math.max(0, Math.min(cum[cum.length - 1], s));
      let k = 1;
      while (k < cum.length - 1 && cum[k] < s) k++;
      const u = (s - cum[k - 1]) / (cum[k] - cum[k - 1] || 1);
      return { x: P[k - 1].x + (P[k].x - P[k - 1].x) * u, z: P[k - 1].z + (P[k].z - P[k - 1].z) * u };
    };
    const s0 = cum[i0] + 2, a = at(s0), b = at(s0 + 6);
    app.selectMode('cyclist');
    app.teleportTo(a.x, a.z, Math.atan2(b.x - a.x, b.z - a.z));
    const ctl = app.controllerManager;
    const e = ctl.getActiveEntity();
    const follow = H.follower(0.05);
    const nearestS = (x, z) => {
      let bs = 0, bd = Infinity;
      for (let k = 0; k < P.length; k++) {
        const d = Math.hypot(P[k].x - x, P[k].z - z);
        if (d < bd) { bd = d; bs = cum[k]; }
      }
      return bs;
    };
    shot.camera = () => {
      const p = e.position;
      // pure pursuit along the trail's centre line, 7 m ahead
      const s = nearestS(p.x, p.z), q = at(s + 7);
      const want = Math.atan2(q.x - p.x, q.z - p.z), err = H.wrap(want - e.heading);
      ctl.setTouchInput('forward', 0.62);
      ctl.setTouchInput('left', err > 0.01 ? Math.min(1, err * 2.5) : 0);
      ctl.setTouchInput('right', err < -0.01 ? Math.min(1, -err * 2.5) : 0);
      const f = follow(p.x, p.y, p.z, e.heading);
      const fx = Math.sin(f.yaw), fz = Math.cos(f.yaw), rx = -fz, rz = fx;
      return CAMERA_POSE;
    };
    return { trailD: Math.round(best.d), trailLen: Math.round(best.len), start: [Math.round(a.x), Math.round(a.z)], ahead: Math.round(cum[cum.length - 1] - s0) };
  }).replace('CAMERA_POSE', cam)
});

add({
  name: 'cinesphere', time: 'golden', duration: DUR,
  setup: fn(() => {
    const s = C.LANDMARK_SITES.cinesphere || C.LANDMARK_SITES.ontarioPlace;
    window.__HC.drift(shot, [s.x - 125, 26, s.z + 95], [s.x + 10, 9, s.z - 5], 46, 9, 3, 0);
    return { site: [Math.round(s.x), Math.round(s.z)] };
  })
});

add({
  name: 'cn-tower', time: 'golden', duration: DUR,
  setup: fn(() => {
    const s = C.LANDMARK_SITES.cnTower;
    window.__HC.drift(shot, [s.x + 260, 70, s.z + 590], [s.x, 255, s.z], 48, 18, 0, 1);
    return { site: [Math.round(s.x), Math.round(s.z)] };
  })
});

add({
  name: 'rogers-centre', time: 'golden', duration: DUR,
  setup: fn(() => {
    // from the south-west, low: the dome's shell and the CN Tower beside it, not down into the bowl
    const s = C.LANDMARK_SITES.rogersCentre;
    window.__HC.drift(shot, [s.x - 330, 160, s.z - 420], [s.x + 60, 40, s.z + 40], 48, 16, 0, 0);
    return { site: [Math.round(s.x), Math.round(s.z)] };
  })
});

add({
  name: 'union-station', time: 'golden', duration: DUR,
  setup: fn(() => {
    // a GO train rolling slowly through Union's train shed, the camera alongside its locomotive on a platform
    const H = window.__HC, rc = app.railCorridor;
    const t = rc.trains.find((t) => t.route.union >= 0);
    if (!t) throw new Error('no GO train through Union');
    const r = t.route, trainLen = 21.4 + (t.cars.length - 1) * 26.9;
    // its locomotive mid-shed at the clip's middle (3 s of warm-up first)
    const v = 3.2, s0 = r.union - v * 6.5;
    let clock = null;
    t.wait = 0; t.dwell = 0; t.stopped = true; t.speed = v; t.s = s0;
    const follow = H.follower(0.08);
    shot.camera = (tt) => {
      const now = performance.now() / 1000;
      if (clock === null) clock = now;
      t.s = s0 + v * (now - clock); t.speed = v; t.stopped = true; t.dwell = 0;
      const c = t.cars[0];
      const f = follow(c.x, c.y, c.z, c.yaw);
      const fx = Math.sin(f.yaw), fz = Math.cos(f.yaw), rx = -fz, rz = fx;
      return { pos: [f.x + fx * 17 + rx * 4.6, f.y + 3.0, f.z + fz * 17 + rz * 4.6], look: [f.x - fx * 20, f.y + 1.8, f.z - fz * 20], fov: 54 };
    };
    return { route: Math.round(r.len), union: Math.round(r.union), cars: t.cars.length };
  })
});

add({
  name: 'harbourfront', time: 'golden', duration: DUR,
  setup: fn(() => {
    const s = C.LANDMARK_SITES.harbourfront;
    window.__HC.drift(shot, [s.x - 170, 70, s.z + 230], [s.x - 80, 60, s.z - 60], 48, 14, 4, 0);
    return { site: [Math.round(s.x), Math.round(s.z)] };
  })
});

add({
  name: 'streetcar-504', time: 'golden', duration: DUR,
  setup: fn(() => {
    // a 504 King streetcar leaving a King St stop downtown, the camera tracking its front three-quarter
    const H = window.__HC, sc = app.streetcars;
    const tracks = sc.routes.filter((t) => t.pattern && String(t.pattern.route) === '504' && t.stopNames);
    const p = {};
    let pick = null;
    for (const t of tracks) {
      for (let i = 0; i < t.stops.length - 1; i++) {
        if (!/^King St/.test(t.stopNames[i] || '')) continue;
        sc.sample(t, t.stops[i], p);
        if (p.x > -1000 && p.x < -150 && (!pick || Math.abs(p.x + 600) < Math.abs(pick.x + 600))) pick = { t, i, x: p.x, z: p.z, name: t.stopNames[i] };
      }
    }
    if (!pick) throw new Error('no 504 King St stop downtown');
    let car = null;
    for (const ds of [6, 20, 40, 60, -30]) { car = sc.spawnAt(pick.t, pick.t.stops[pick.i] + ds); if (car) break; }
    if (!car) throw new Error('could not spawn a 504');
    const follow = H.follower(0.05);
    const a = {}, b = {};
    shot.camera = () => {
      const n = car.sections.length, m = car.sections[Math.floor(n / 2)];
      sc.sample(car.track, car.s - 12, a); sc.sample(car.track, car.s + 4, b);
      const y = Number.isFinite(a.y) ? a.y : 0;
      const f = follow(m.x, y, m.z, Math.atan2(b.x - a.x, b.z - a.z));
      const fx = Math.sin(f.yaw), fz = Math.cos(f.yaw), rx = -fz, rz = fx;
      // ahead of it and out over the other track (the left, in right-hand traffic), looking back at its front
      return { pos: [f.x + fx * 22 - rx * 2.5, f.y + 4.2, f.z + fz * 22 - rz * 2.5], look: [f.x + fx * 2, f.y + 1.8, f.z + fz * 2], fov: 50 };
    };
    return { stop: pick.name, at: [Math.round(pick.x), Math.round(pick.z)], dir: pick.t.pattern.dir };
  })
});

add({
  name: 'st-lawrence', time: 'golden', duration: DUR,
  setup: fn(() => {
    // the photo mode's St. Lawrence Market view: at eye height on the street, raised a little
    const p = C.TELEPORT_LOCATIONS.stLawrence, s = C.LANDMARK_SITES.stLawrence;
    const y = app.controllerManager.getGroundHeight(p.x, p.z, 'person') + 4;
    window.__HC.drift(shot, [p.x, y, p.z], [s.x, y + 6, s.z], 54, 5, 3, 0);
    return { from: [Math.round(p.x), Math.round(p.z)] };
  })
});

add({
  name: 'distillery', time: 'golden', duration: DUR,
  setup: fn(() => {
    const s = C.LANDMARK_SITES.distillery;
    window.__HC.drift(shot, [s.x + 120, 70, s.z - 120], [s.x - 30, 0, s.z + 10], 50, 10, 0, 0);
    return { site: [Math.round(s.x), Math.round(s.z)] };
  })
});

add({
  name: 'subway-viaduct', time: 'midday', duration: DUR,
  setup: fn(() => {
    // a Line 2 train crossing the Bloor Viaduct's lower deck, tracked from the Don Valley below, south of the bridge
    const H = window.__HC, R = app.subwayRide, svc = R.service;
    if (!svc) throw new Error('no viaduct service');
    const train = svc.cars[0], tr = train.track;
    const V = C.SUBWAY_VIADUCTS[0];
    const v = 12, mid = (tr.open0 + tr.open1) / 2, s0 = mid + 70 - v * 3.5 - v * 3; // (3 s of warm-up first)
    let clock = null;
    const follow = H.follower(0.05);
    const pin = (s) => { train.doorState = 'closed'; train.doorProgress = 0; train.k = 1; train.speed = v; train.s = s; svc.place(train); };
    pin(s0);
    shot.camera = () => {
      const now = performance.now() / 1000;
      if (clock === null) clock = now;
      pin(s0 + v * (now - clock));
      const m = train.sections[3];
      const f = follow(m.x, m.y, m.z, m.yaw);
      const fx = Math.sin(f.yaw), fz = Math.cos(f.yaw);
      let nx = -fz, nz = fx;
      if (nz < 0) { nx = -nx; nz = -nz; } // the south side
      return { pos: [f.x + nx * 85 - fx * 12, V.railY - 5, f.z + nz * 85 - fz * 12], look: [f.x + fx * 6, f.y + 5, f.z + fz * 6], fov: 40 };
    };
    return { open: [Math.round(tr.open0), Math.round(tr.open1)], railY: V.railY, deck: V.deck };
  })
});

const which = process.argv[3] || 'all';
const pick = which === 'cover' ? shots.filter((s) => s.name.startsWith('cover-'))
  : which === 'listings' ? shots.filter((s) => !s.name.startsWith('cover-'))
  : which === 'all' ? shots : shots.filter((s) => which.split(',').includes(s.name));
fs.writeFileSync(process.argv[2], JSON.stringify({ prelude, shots: pick }, null, 1) + '\n');
console.log(pick.map((s) => s.name).join(' '));
