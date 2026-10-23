(function () {
// js/cinema.js
// Camera moves for film mode (main.js __CITY_APP.film, tools/video/record.mjs). A shot is plain JSON:
//   { path: [{ t, pos: [x, y, z], look: [x, y, z], fov }, ...] }   keyframes, eased & splined (Catmull-Rom)
//   { orbit: { center: [x, y, z], radius: [r0, r1], height: [y0, y1], from, to (degrees, 0 = grid east), fov } }
//   { duration, ease: 'inOut' | 'out' | 'linear' }
// World frame: x grid east (towards Aso Rock), z grid south, y up, metres; Eagle Square at the origin.

const ease = {
  linear: (u) => u,
  inOut: (u) => u * u * (3 - 2 * u),
  out: (u) => 1 - (1 - u) * (1 - u),
  in: (u) => u * u
};

// Catmull-Rom through p0..p3 at u in [0, 1] (between p1 and p2)
const cr = (p0, p1, p2, p3, u) => {
  const u2 = u * u, u3 = u2 * u;
  return p1.map((_, i) => 0.5 * (2 * p1[i] + (-p0[i] + p2[i]) * u + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * u2 +
    (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * u3));
};

function samplePath(keys, t, field) {
  if (t <= keys[0].t) return keys[0][field];
  const last = keys[keys.length - 1];
  if (t >= last.t) return last[field];
  let k = 0;
  while (k < keys.length - 2 && keys[k + 1].t < t) k++;
  const a = keys[Math.max(0, k - 1)], b = keys[k], c = keys[k + 1], d = keys[Math.min(keys.length - 1, k + 2)];
  const u = (t - b.t) / (c.t - b.t || 1);
  return cr(a[field], b[field], c[field], d[field], u);
}

// The camera at shot time t (seconds since the shot began)
function evalShot(shot, t) {
  const dur = shot.duration || (shot.path ? shot.path[shot.path.length - 1].t : 6);
  const u = (ease[shot.ease || 'inOut'] || ease.inOut)(Math.max(0, Math.min(1, t / dur)));
  if (shot.orbit) {
    const o = shot.orbit;
    const lerp = (v) => (Array.isArray(v) ? v[0] + (v[1] - v[0]) * u : v);
    const a = ((o.from + (o.to - o.from) * u) * Math.PI) / 180;
    const r = lerp(o.radius);
    return {
      pos: [o.center[0] + Math.cos(a) * r, lerp(o.height), o.center[2] + Math.sin(a) * r],
      look: [o.center[0], lerp(o.lookY !== undefined ? o.lookY : o.center[1]), o.center[2]],
      fov: lerp(o.fov || 50)
    };
  }
  const tt = u * (shot.path[shot.path.length - 1].t - shot.path[0].t) + shot.path[0].t;
  const fovKeys = shot.path.map((k) => ({ t: k.t, fov: [k.fov || 50] }));
  return { pos: samplePath(shot.path, tt, 'pos'), look: samplePath(shot.path, tt, 'look'), fov: samplePath(fovKeys, tt, 'fov')[0] };
}

// Runs a shot on the app's camera, its clock starting now (elapsed: the app's clock)
function playShot(shot, startElapsed) {
  const cams = window.__CITY_APP.cameraSystem;
  cams.cinema = (elapsed) => evalShot(shot, elapsed - startElapsed);
}

Object.assign(window.CITY, { Cinema: { evalShot, playShot } });
})();
