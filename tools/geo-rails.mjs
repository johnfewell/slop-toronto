// Part 8: the railways (OpenStreetMap, osm_rails.json from tools/fetch-osm.mjs ONLY=rails): the TTC's streetcar tracks
// (railway=tram, with the loops & sidings: 501 Queen out to the Humber Loop, 504 King, 505 Dundas, 506 College,
// 509 Harbourfront & 510 Spadina on their rights-of-way, 511 Bathurst, 512 St Clair's stub), the streetcar stops
// (railway=tram_stop), and the heavy-rail lines of the Union Station Rail Corridor & its subdivisions (railway=rail:
// GO Transit, VIA & UP Express, with their yard tracks, sidings & crossovers). The subway stays underground (left out).
// The idea and the reading of the tracks follow aalghooneh/slop-toronto (MIT): js/streetcars.js & its city-grid.js
// rail corridor; the data path here is our own (Geofabrik extract via GDAL).
//   rails: [kind (0 streetcar, 1 heavy rail), service ('' main line, 'yard', 'siding', 'crossover', 'spur'), name,
//           flags (1 bridge, 2 tunnel), [x, z, ...]]  (cut to the detailed city, simplified to 0.3 m)
//   tramStops: [x, z, name, ...]
import { toWorld, rdp, load, log } from './geo-base.mjs';
import { inDetail } from './geo-roads.mjs';

const q = (v) => Math.round(v * 10) / 10;
const MARGIN = 60; // tracks run on this far past the detailed city's edge (the cars turn back out of sight)

let elements = [];
try {
  elements = load('osm_rails.json').elements;
} catch {
  log('no osm_rails.json (run tools/fetch-osm.mjs with ONLY=rails): no streetcars or rail corridor');
}

export const rails = [];
for (const e of elements) {
  if (e.type !== 'way' || !e.geometry) continue;
  const t = e.tags || {};
  const kind = t.railway === 'tram' ? 0 : t.railway === 'rail' ? 1 : -1;
  if (kind < 0) continue;
  const tunnel = !!t.tunnel && t.tunnel !== 'no';
  if (kind === 1 && tunnel) continue; // heavy rail under the city: nothing to see
  const bridge = !!t.bridge && t.bridge !== 'no';
  const flags = (bridge ? 1 : 0) | (tunnel ? 2 : 0);
  // the runs of the way inside the detailed city
  let run = [];
  const flush = () => {
    if (run.length > 1) rails.push([kind, t.service || '', t.name || '', flags, rdp(run, 0.3).flatMap(([x, z]) => [q(x), q(z)])]);
    run = [];
  };
  for (const g of e.geometry) {
    const [x, z] = toWorld(g.lon, g.lat);
    if (inDetail(x, z, MARGIN)) run.push([x, z]);
    else flush();
  }
  flush();
}

export const tramStops = [];
for (const e of elements) {
  if (e.type !== 'node') continue;
  const [x, z] = toWorld(e.lon, e.lat);
  if (!inDetail(x, z)) continue;
  tramStops.push(q(x), q(z), (e.tags && e.tags.name) || '');
}

const km = (k) => Math.round(rails.filter((r) => r[0] === k).reduce((t, r) => {
  const p = r[4];
  for (let i = 2; i < p.length; i += 2) t += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  return t;
}, 0) / 100) / 10;
log(`rails: ${rails.filter((r) => r[0] === 0).length} streetcar ways (${km(0)} km), ${rails.filter((r) => r[0] === 1).length} heavy-rail ways (${km(1)} km), ${tramStops.length / 3} streetcar stops`);
