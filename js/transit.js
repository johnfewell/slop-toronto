(function () {
// js/transit.js
// The TTC's timetable for the city (window.CITY.GEO_TRANSIT, js/toronto-transit.js from tools/build-transit.mjs: the
// routes' stopping patterns through the detailed city, their stops and trips per hour on a weekday) and the city's
// clock for it: streetcars.js, transit-buses.js and subway.js run their vehicles at the real headway of the hour the
// time-of-day buttons show. The presets' clock hours (lighting.js, 22 August, Eastern Daylight Time): golden hour about
// 19:00, midday 13:00, sunset about 20:00, night 23:00.
// Also the destination signs' atlas (an amber LED route number, name & destination per pattern, a row each).

const { THREE } = window.CITY;
const D = window.CITY.GEO_TRANSIT || { routes: [], stops: [], stopNames: [], patterns: [] };
const HOURS = { golden: 19, midday: 13, twilight: 20, sunset: 20, midnight: 23, night: 23 };

let hour = HOURS.golden;
const listeners = [];

const patterns = D.patterns.map((p, i) => {
  const [num, name, type, colour] = D.routes[p.r];
  const pts = [];
  for (let k = 0; k < (p.pts || []).length; k += 2) pts.push({ x: p.pts[k], z: p.pts[k + 1] });
  const stops = (p.stops || []).map((s) => ({ x: D.stops[2 * s], z: D.stops[2 * s + 1], name: D.stopNames[s] }));
  return { id: i, route: num, name, routeType: type, colour, type: p.t, dir: p.d, sign: p.sign, perHour: p.h, trips: p.n, speed: p.v || 4, pts, stops };
});

// Seconds between vehicles of a pattern at hour h (Infinity: none that hour)
const headway = (p, h = hour) => (p.perHour[h] > 0 ? 3600 / p.perHour[h] : Infinity);

// The destination signs: one row per distinct sign, the route number large on the left, the route's name over the
// destination on the right, amber on black. `aspect` = the sign's width / height on the vehicle.
function signAtlas(signs, aspect) {
  const keys = [...new Set(signs.map((s) => s.join('|')))];
  const W = 512, H = Math.round(W / aspect);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H * Math.max(1, keys.length);
  const g = canvas.getContext('2d');
  g.fillStyle = '#07080a';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#ffae2a';
  g.textBaseline = 'middle';
  keys.forEach((k, row) => {
    const [label, dest] = k.split('|');
    const m = label.match(/^(\d+[A-Z]?)\s*(.*)$/) || [label, label, ''];
    const y0 = row * H;
    let size = Math.round(H * 0.78);
    g.font = `800 ${size}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
    g.textAlign = 'left';
    g.fillText(m[1], W * 0.03, y0 + H * 0.54, W * 0.34);
    const numW = Math.min(W * 0.34, g.measureText(m[1]).width) + W * 0.08;
    const room = W - numW - W * 0.03;
    if (dest && aspect < 6) {
      // two lines: the name over the destination
      size = Math.round(H * 0.36);
      g.font = `700 ${size}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
      g.fillText(m[2], numW, y0 + H * 0.29, room);
      g.fillText(dest, numW, y0 + H * 0.72, room);
    } else {
      size = Math.round(H * 0.6);
      g.font = `700 ${size}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
      g.fillText(dest || m[2], numW, y0 + H * 0.54, room);
    }
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false; // (rows from the top, as drawn)
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  return { tex, rows: keys.length, rowOf: (sign) => Math.max(0, keys.indexOf(sign.join('|'))) };
}

// The buses' destination signs (traffic.js: the panels over the windscreen, by the door & at the back, uv 0..1 each):
// an unlit material reading row attribute(attr) of the atlas of every bus pattern's sign
let busSignsCache = null;
function busSigns(attr) {
  if (busSignsCache) return busSignsCache;
  const signs = patterns.filter((p) => p.type === 3).map((p) => p.sign);
  if (!signs.length) return null;
  const { texture, attribute, uv, vec2, float } = window.CITY.TSL;
  const atlas = signAtlas(signs, 1.9 / 0.27);
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = texture(atlas.tex, vec2(uv().x, attribute(attr, 'float').add(float(1).sub(uv().y).clamp(0.03, 0.97)).div(atlas.rows))).rgb;
  busSignsCache = { material, rowOf: atlas.rowOf, rows: atlas.rows };
  return busSignsCache;
}

const TRANSIT = {
  busSigns,
  data: D,
  patterns,
  headway,
  signAtlas,
  get hour() {
    return hour;
  },
  // the time-of-day preset (main.js selectTime): its clock hour
  setTime(id) {
    const h = HOURS[id];
    if (h === undefined || h === hour) return;
    hour = h;
    for (const f of listeners) f(h);
  },
  onHour(f) {
    listeners.push(f);
  },
  ofType: (t) => patterns.filter((p) => p.type === t)
};

if (patterns.length) {
  const n = (t) => patterns.filter((p) => p.type === t).length;
  console.info(`[transit] ${D.routes.length} TTC routes through the city: ${n(0)} streetcar, ${n(3)} bus & ${n(1)} subway patterns, ${D.stops.length / 2} stops (${D.source && D.source.dataset}, ${D.source && D.source.modified})`);
}
Object.assign(window.CITY, { TRANSIT });
})();
