(function () {
// js/film.js
// The launch film: one scripted ~35 s camera run through the city in four shots, golden hour with a night cut (js/cinema.js
// shots, eased & splined). explore.html?film=1 plays it live and loops, with the UI hidden; ?film=render only hides
// the UI and parks the player, for tools/render-film.mjs, which renders it frame by frame on a virtual clock.
// The strongest shot goes first: X autoplays muted and people decide in two seconds.
// World frame: x grid east, z grid south (towards the lake), y up, metres; Union Station at the origin.

const SHOTS = [
  // 1. The skyline from the lake off Coronation Park, low over the water: the towers and the CN Tower lit gold by the
  //    sun behind the camera, under the evening clouds (telephoto, so the skyline stands tall)
  {
    name: 'skyline', time: 'golden', duration: 8, ease: 'linear',
    path: [
      { t: 0, pos: [-2330, 8, 1030], look: [-520, 195, 110], fov: 32 },
      { t: 8, pos: [-2170, 24, 940], look: [-470, 190, 60], fov: 31 }
    ]
  },
  // 2. Up Yonge Street at street level, over the traffic between the shopfronts, towards Dundas
  {
    name: 'yonge', time: 'golden', duration: 9, ease: 'linear',
    path: [
      { t: 0, pos: [328.5, 4.2, -880], look: [326.5, 6, -1180], fov: 52 },
      { t: 9, pos: [327.5, 4.0, -990], look: [326, 8, -1260], fov: 50 }
    ]
  },
  // 3. Yonge & Dundas by night: Sankofa Square and the screens, a slow crane up out of the square
  {
    name: 'sankofa', time: 'midnight', duration: 8, ease: 'inOut',
    path: [
      { t: 0, pos: [386, 8, -1122], look: [326, 14, -1185], fov: 54 },
      { t: 8, pos: [374, 18, -1136], look: [322, 20, -1200], fov: 54 }
    ]
  },
  // 4. The finale: back out over the western waterfront, rising to the whole city, the CN Tower and the lake
  {
    name: 'waterfront', time: 'golden', duration: 10, ease: 'out',
    path: [
      { t: 0, pos: [-2000, 60, 950], look: [-500, 150, 100], fov: 42 },
      { t: 10, pos: [-2420, 150, 1320], look: [-400, 125, 40], fov: 46 }
    ]
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
