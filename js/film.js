(function () {
// js/film.js
// The launch film: one scripted 38 s camera run through the city in four shots: the golden skyline from the lake, Yonge &
// Dundas by night, a first-person ride down a leafy street in the midday sun, and a golden-hour ride down Spadina that
// lifts off and rises over the towers to the Rogers Centre and the CN Tower with the lake behind (js/cinema.js shots,
// eased & splined). explore.html?film=1 plays it live and loops, with the UI hidden; ?film=render only hides
// the UI and parks the player, for tools/render-film.mjs, which renders it frame by frame on a virtual clock.
// The strongest shot goes first: X autoplays muted and people decide in two seconds.
// World frame: x grid east, z grid south (towards the lake), y up, metres; Union Station at the origin.

// A ride that lifts off, as keys every quarter second (Catmull-Rom between them): along `dir` from `start` at eye height
// at V0 m/s, easing (smoothstep) to V1 m/s after the lift-off at LIFT s; the height (EYE -> Y1) and a sideways `drift`
// (from `driftDelay` s after the lift, when the camera is clear of the traffic) both start and end with zero speed &
// acceleration (smootherstep), so the ride flows into the climb with no jerk; the look turns from up the street to
// `target` from 4.5 s, the lens going from 66 to `fov1` degrees.
function liftOffPath(o) {
  const { T, LIFT, start, dir, V0 = 10, V1, EYE = 1.65, Y1, drift = [0, 0], driftDelay = 0, target, fov1 } = o;
  const ss = (p) => (p <= 0 ? 0 : p >= 1 ? 1 : p * p * (3 - 2 * p));
  const sss = (p) => (p <= 0 ? 0 : p >= 1 ? 1 : p * p * p * (10 - 15 * p + 6 * p * p));
  const r = (v) => Math.round(v * 100) / 100;
  const keys = [];
  let s = 0;
  for (let i = 0; i <= T * 4; i++) {
    const t = i / 4;
    if (i) for (let k = 0; k < 50; k++) s += (V0 + (V1 - V0) * ss((t - 0.25 + (k + 0.5) / 200 - LIFT) / (T - LIFT))) / 200;
    const y = EYE + (Y1 - EYE) * sss((t - LIFT) / (T - LIFT));
    const d = sss((t - LIFT - driftDelay) / (T - LIFT - driftDelay));
    const x = start[0] + dir[0] * s + drift[0] * d, z = start[1] + dir[1] * s + drift[1] * d;
    const w = ss((t - 4.5) / (T - 1.5 - 4.5));
    const ahead = [x + dir[0] * 80, 8, z + dir[1] * 80];
    keys.push({ t, pos: [r(x), r(y), r(z)], look: ahead.map((a, j) => r(a + (target[j] - a) * w)), fov: r(66 + (fov1 - 66) * w) });
  }
  return keys;
}

const SHOTS = [
  // 1. The skyline from the lake off Coronation Park, low over the water: the towers and the CN Tower lit gold by the
  //    sun behind the camera, under the evening clouds (telephoto, so the skyline stands tall)
  {
    name: 'skyline', time: 'golden', duration: 7, ease: 'linear',
    path: [
      { t: 0, pos: [-2330, 8, 1030], look: [-520, 195, 110], fov: 32 },
      { t: 7, pos: [-2190, 22, 950], look: [-475, 190, 65], fov: 31 }
    ]
  },
  // 2. Yonge & Dundas by night: Sankofa Square's screens, craning up from above the rooftops and tilting down onto the
  //    lit intersection, its traffic and people
  {
    name: 'sankofa', time: 'midnight', duration: 6, ease: 'inOut',
    path: [
      { t: 0, pos: [380, 15, -1130], look: [326, 24, -1190], fov: 50 },
      { t: 6, pos: [370, 24, -1142], look: [320, 16, -1205], fov: 50 }
    ]
  },
  // 3. A leafy side street (Euclid Avenue, one-way, one lane) in the midday sun, first person at a cyclist's eye height
  //    under the street trees, hugging the curb as the cars pass
  {
    name: 'euclid-ride', time: 'midday', duration: 7, ease: 'linear',
    path: [
      { t: 0, pos: [-2046.5, 1.65, -1880], look: [-2048.5, 3, -2030], fov: 66 },
      { t: 7, pos: [-2046.4, 1.65, -1960], look: [-2048, 3, -2110], fov: 66 }
    ]
  },
  // 4. The finale, one continuous shot at golden hour: riding south down Spadina Avenue (first person, 10 m/s, at the
  //    west curb's edge of the southbound lanes, so the cars and buses pass alongside), then lifting off at 6.5 s and
  //    rising 230 m over the Entertainment District's towers, drifting 40 m east and turning to the south-east, to
  //    frame the Rogers Centre's dome with the whole CN Tower beside it, lit gold by the low sun behind the camera,
  //    the lake and the islands beyond: the city from above, where the opener was the skyline from the lake
  {
    name: 'rogers-liftoff', time: 'golden', duration: 18, ease: 'linear',
    path: liftOffPath({
      T: 18, LIFT: 6.5, start: [-1124.15, -470], dir: [0, 1], V1: 3, Y1: 230, drift: [40, 0], driftDelay: 3,
      target: [-692, 255, 170], fov1: 52
    })
  }
];
const DURATION = SHOTS.reduce((s, shot) => s + shot.duration, 0);

// The shot playing at film time t (seconds), and the time into it
function shotAt(t) {
  let start = 0;
  for (let i = 0; i < SHOTS.length; i++) {
    if (t < start + SHOTS[i].duration || i === SHOTS.length - 1) return { index: i, local: t - start };
    start += SHOTS[i].duration;
  }
}

// Clean frame: no UI (css/style.css body.film) and the player parked out of every shot (Kensington Market)
function prepare() {
  const app = window.__CITY_APP;
  document.body.classList.add('film');
  const k = (window.CITY.TELEPORT_LOCATIONS || {}).kensington || { x: -900, z: -1300 };
  app.teleportTo(k.x, k.z, 0);
  // The Rogers Centre's massing (js/toronto-landmarks.js) has its roof faces wound inwards: single-sided, the dome
  // vanishes from above, leaving a few floating arcs, so the film draws it double-sided (the finale looks down on it)
  const rogers = app.scene.getObjectByName('Landmark_rogersCentre');
  if (rogers && rogers.material.side !== 2) {
    rogers.material = rogers.material.clone();
    rogers.material.side = 2; // THREE.DoubleSide
  }
}

// Puts the camera at time t of shot i, switching the time of day when the shot changes (a cut)
let shown = -1;
function show(i, t) {
  const app = window.__CITY_APP, shot = SHOTS[i];
  if (i !== shown) {
    app.selectTime(shot.time);
    shown = i;
  }
  app.cameraSystem.cinema = () => window.CITY.Cinema.evalShot(shot, t);
}

// Live: the film on the app's clock, looping
function play() {
  prepare();
  const app = window.__CITY_APP;
  let start = null;
  app.cameraSystem.cinema = (elapsed) => {
    if (start === null) start = elapsed;
    const { index, local } = shotAt((elapsed - start) % DURATION);
    if (index !== shown) {
      app.selectTime(SHOTS[index].time);
      shown = index;
    }
    return window.CITY.Cinema.evalShot(SHOTS[index], local);
  };
}

const mode = new URLSearchParams(location.search).get('film');
if (mode) {
  const wait = setInterval(() => {
    if (!window.__CITY_APP || !window.__CITY_APP.ready) return;
    clearInterval(wait);
    if (mode === 'render') prepare();
    else play();
  }, 100);
}

Object.assign(window.CITY, { Film: { SHOTS, DURATION, shotAt, prepare, show, play } });
})();
