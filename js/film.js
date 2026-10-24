(function () {
// js/film.js
// The launch film: one scripted 35 s camera run through the city in four shots: the golden skyline, Yonge & Dundas by
// night, a first-person ride down a leafy street and a ride along Queen Street that lifts off over Nathan Phillips Square
// to City Hall, those two in the midday sun (js/cinema.js shots, eased & splined). explore.html?film=1 plays it live and loops, with the UI hidden; ?film=render only hides
// the UI and parks the player, for tools/render-film.mjs, which renders it frame by frame on a virtual clock.
// The strongest shot goes first: X autoplays muted and people decide in two seconds.
// World frame: x grid east, z grid south (towards the lake), y up, metres; Union Station at the origin.

// The finale's move, as keys every quarter second (Catmull-Rom between them): x at 10 m/s, easing to 1.5 m/s after the
// lift-off at 7 s; the height (1.65 -> 80 m) and the drift north over the square start with zero speed & acceleration
// (smootherstep), so the ride flows into the climb with no jerk, and the drift waits 1.2 s until the camera is above
// the cars; the look turns from up the street to City Hall from 4.5 s, the lens closing from 66 to 55 degrees.
function liftOffPath() {
  const T = 15, LIFT = 7, X0 = -140, V0 = 10, V1 = 1.5, Z0 = -721.4, Z1 = -770, Y1 = 80, EYE = 1.65;
  const target = [5, 50, -945];
  const ss = (p) => (p <= 0 ? 0 : p >= 1 ? 1 : p * p * (3 - 2 * p));
  const sss = (p) => (p <= 0 ? 0 : p >= 1 ? 1 : p * p * p * (10 - 15 * p + 6 * p * p));
  const r = (v) => Math.round(v * 100) / 100;
  const keys = [];
  let x = X0;
  for (let i = 0; i <= T * 4; i++) {
    const t = i / 4;
    if (i) for (let k = 0; k < 50; k++) x += (V0 + (V1 - V0) * ss((t - 0.25 + (k + 0.5) / 200 - LIFT) / (T - LIFT))) / 200;
    const y = EYE + (Y1 - EYE) * sss((t - LIFT) / (T - LIFT));
    const z = Z0 + (Z1 - Z0) * sss(1.3 * (t - LIFT - 1.2) / (T - LIFT - 1.2));
    const w = ss((t - 4.5) / (T - 1.5 - 4.5));
    const ahead = [x + 80, 2.6, Z0 - 2.5];
    keys.push({ t, pos: [r(x), r(y), r(z)], look: ahead.map((a, j) => r(a + (target[j] - a) * w)), fov: r(66 - 11 * w) });
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
  // 4. The finale, one continuous shot: riding east along Queen Street West at midday (first person, 10 m/s, at the
  //    south curb's edge so the eastbound cars pass alongside), the head turning left to City Hall as Nathan Phillips
  //    Square opens up; at the square's corner the camera lifts off and rises over the square to rest 80 m up, City
  //    Hall's two curved towers and the council chamber framed with Bay Street's towers behind (liftOffPath below)
  { name: 'cityhall-liftoff', time: 'midday', duration: 15, ease: 'linear', path: liftOffPath() }
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
