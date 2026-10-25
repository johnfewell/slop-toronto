// The TTC subway as seen from the street (OpenStreetMap): its lines (railway=subway, osm_rails.json from
// tools/fetch-osm.mjs ONLY=rails), its stations & their street entrances (osm_subway.json, ONLY=subway). Kept apart from
// tools/geo-rails.mjs (the streetcars & the heavy rail), which leaves the subway out. js/subway.js builds on it: Line 2
// on the Prince Edward Viaduct's lower deck over the Don, the entrances on the sidewalks.
//   ways: [name, flags (1 bridge, 2 tunnel, 4 covered, 8 viaduct), layer, service, [x, z, ...]]  (every subway way
//         reaching within MARGIN of the detailed city, tunnels too: the trains run on into them; simplified to 0.3 m)
//   stations: [x, z, name, line colour, accessible (1: wheelchair=yes, its pylons get the accessibility symbol)]
//   entrances: [x, z, station name, line colour, entrance name]  (street level only: none mapped below ground or
//              indoors, the PATH's & the malls' doors)
import { toWorld, rdp, load, log } from './geo-base.mjs';

// the detailed city (as tools/geo-roads.mjs DETAIL; not imported: that module builds the whole road network)
const DETAIL = { x0: -7900, x1: 3700, z0: -3000, z1: 3600 };
const near = (x, z, m) => x > DETAIL.x0 - m && x < DETAIL.x1 + m && z > DETAIL.z0 - m && z < DETAIL.z1 + m;
const MARGIN = 400;
const q = (v) => Math.round(v * 10) / 10;
const on = (v) => !!v && v !== 'no';
const LINE_COLOUR = { 1: 'yellow', 2: 'green', 4: 'purple', 5: 'orange', 6: 'grey' };

let rails = [], nodes = [];
try {
  rails = load('osm_rails.json').elements;
} catch {
  log('subway: no osm_rails.json (tools/fetch-osm.mjs ONLY=rails)');
}
try {
  nodes = load('osm_subway.json').elements;
} catch {
  log('subway: no osm_subway.json (tools/fetch-osm.mjs ONLY=subway): no entrances');
}

export const ways = [];
for (const e of rails) {
  const t = e.tags || {};
  if (e.type !== 'way' || !e.geometry || t.railway !== 'subway') continue;
  const P = e.geometry.map((g) => toWorld(g.lon, g.lat));
  if (!P.some(([x, z]) => near(x, z, MARGIN))) continue;
  const flags = (on(t.bridge) ? 1 : 0) | (on(t.tunnel) ? 2 : 0) | (on(t.covered) ? 4 : 0) | (t.bridge === 'viaduct' ? 8 : 0);
  ways.push([t.name || '', flags, Math.round(parseFloat(t.layer) || 0), t.service || '', rdp(P, 0.3).flatMap(([x, z]) => [q(x), q(z)])]);
}

// A line's colour from a way name ("Line 2 Bloor-Danforth") or a station's / entrance's own tag
const colourOf = (t, x, z) => {
  if (t.colour && /^(yellow|green|purple|orange|grey)$/.test(t.colour)) return t.colour;
  let best = '', bd = 400;
  for (const [name, , , , f] of ways) {
    const m = /Line (\d)/.exec(name);
    if (!m) continue;
    for (let i = 0; i < f.length; i += 2) {
      const d = Math.hypot(f[i] - x, f[i + 1] - z);
      if (d < bd) { bd = d; best = LINE_COLOUR[m[1]] || ''; }
    }
  }
  return best;
};
const cleanName = (n) => (n || '').replace(/\s+(Subway\s+)?Station$/i, '').trim();

export const stations = [];
for (const e of nodes) {
  const t = e.tags || {};
  if (t.railway !== 'station') continue;
  const [x, z] = toWorld(e.lon, e.lat);
  if (!near(x, z, 200)) continue;
  stations.push([q(x), q(z), cleanName(t.name), colourOf(t, x, z), t.wheelchair === 'yes' ? 1 : 0]);
}

// Below the street (level -1, the PATH's & the malls' doors) or indoors: not a street entrance
const streetLevel = (t) => {
  if (on(t.indoor) || t.door && t.level) return false;
  const levels = String(t.level ?? '0').split(/[;,]/).map(parseFloat).filter((v) => !Number.isNaN(v));
  return !levels.length || levels.some((v) => v >= 0);
};
export const entrances = [];
let below = 0;
for (const e of nodes) {
  const t = e.tags || {};
  if (t.railway !== 'subway_entrance') continue;
  const [x, z] = toWorld(e.lon, e.lat);
  if (!near(x, z, 0)) continue;
  if (!streetLevel(t)) { below++; continue; }
  let st = null, sd = 450;
  for (const s of stations) {
    const d = Math.hypot(s[0] - x, s[1] - z);
    if (d < sd) { sd = d; st = s; }
  }
  entrances.push([q(x), q(z), st ? st[2] : '', st ? st[3] : colourOf(t, x, z), t.name || '']);
}

const km = Math.round(ways.filter((w) => !(w[1] & 2)).reduce((t, w) => {
  const f = w[4];
  for (let i = 2; i < f.length; i += 2) t += Math.hypot(f[i] - f[i - 2], f[i + 1] - f[i - 1]);
  return t;
}, 0)) / 1000;
log(`subway: ${ways.length} ways (${ways.filter((w) => !(w[1] & 2)).length} out of the tunnels, ${km} km), ${stations.length} stations, ${entrances.length} street entrances (${below} below ground or indoors left out)`);
