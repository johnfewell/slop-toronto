// tools/build-high-park-features.mjs → js/high-park-features-data.js
// High Park's features (docs/high-park-features.md, bead st-5yps), from OpenStreetMap, for js/high-park-features.js to
// lay on the park's terrain (docs/high-park-terrain.md): the trails and paths through the park (GEO.parkPaths draws only
// the parkettes'), Hillside Gardens' beds and sunken-garden fountains, the Maple Leaf bed, the labyrinth, the zoo's
// paddocks along Deer Pen Road, Dog Hill and the other off-leash areas, the allotments, the amphitheatre, the parking
// lots, Colborne Lodge and its coach house (neither is in the City's massing, so the city had no building there), and the
// park roads closed to cars (the High Park Movement Strategy: West Road and the middle of Colborne Lodge Drive at all
// times since 2023; the rest of the park's roads on weekends and holidays).
//
// Inputs: the raw OpenStreetMap downloads the geodata build reads (GEO_DATA, default ~/.cache/slop-toronto/osm-ids:
// osm_roads.json, osm_land.json, osm_buildings.json, osm_pois.json) and an Overpass extract of the park
// (HIGH_PARK_OSM, default ~/.cache/slop-toronto/raw/high-park/osm-features.json, fetched with
// `bash tools/overpass.sh <file> tools/data/q_high_park_features.overpassql`) for what the downloads carry without a
// shape (the zoo's enclosure and the labyrinth are in osm_pois.json as points). Everything is cut to the park's curb
// islands (GEO.blocks named High Park), off the water.
// Usage: node tools/build-high-park-features.mjs [--out js/high-park-features-data.js]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, loadCity } from './terrain-pilot-lib.mjs';

const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? process.argv[outArg + 1] : path.join(ROOT, 'js/high-park-features-data.js');
const GEO_DATA = process.env.GEO_DATA || path.join(os.homedir(), '.cache/slop-toronto/osm-ids');
const EXTRACT = process.env.HIGH_PARK_OSM || path.join(os.homedir(), '.cache/slop-toronto/raw/high-park/osm-features.json');
const BOX = { x0: -7200, x1: -5760, z0: -2940, z1: -1080 }; // (the terrain pilot's: tools/build-high-park.mjs)

const C = loadCity();
const W = (g) => { const p = C.worldFromLatLon(g.lat, g.lon); return [p.x, p.z]; };
const q = (v) => Math.round(v * 10) / 10;
const islands = C.BLOCKS.filter((b) => b.parkName === 'High Park' && b.cx > BOX.x0 && b.cx < BOX.x1 && b.cz > BOX.z0 && b.cz < BOX.z1);
const inRing = (ring, x, z) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
};
const edgeDist = (ring, x, z) => {
  let d = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i], ex = b.x - a.x, ez = b.z - a.z, L2 = ex * ex + ez * ez || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / L2));
    d = Math.min(d, Math.hypot(a.x + ex * t - x, a.z + ez * t - z));
  }
  return d;
};
const islandAt = (x, z) => islands.find((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && inRing(b.poly, x, z)) || null;
// on the park's land: on one of its islands, 0.6 m in from the kerb, and dry
const onPark = (x, z, margin = 0.6) => { const b = islandAt(x, z); return !!b && edgeDist(b.poly, x, z) >= margin && !C.waterAt(x, z); };

// --- the OpenStreetMap elements, by id (the downloads first; the park's extract adds the shapes they lack)
const els = new Map();
for (const f of ['osm_roads.json', 'osm_land.json', 'osm_buildings.json', 'osm_pois.json']) {
  for (const e of JSON.parse(fs.readFileSync(path.join(GEO_DATA, f), 'utf8')).elements) {
    if (e.type !== 'way' || !e.geometry || e.geometry.length < 2) continue;
    els.set(e.id, e);
  }
}
let extracted = 0;
if (fs.existsSync(EXTRACT)) {
  for (const e of JSON.parse(fs.readFileSync(EXTRACT, 'utf8')).elements) {
    if (e.type !== 'way' || !e.geometry || e.geometry.length < 2 || els.has(e.id)) continue;
    els.set(e.id, e); extracted++;
  }
} else console.warn(`[hp-features] no Overpass extract at ${EXTRACT}: the zoo's enclosure and the labyrinth will be missing`);
const ways = [...els.values()].map((e) => ({ id: e.id, t: e.tags || {}, pts: e.geometry.map(W) }))
  .filter((w) => w.pts.some(([x, z]) => x > BOX.x0 && x < BOX.x1 && z > BOX.z0 && z < BOX.z1))
  .sort((a, b) => a.id - b.id);

// Douglas-Peucker over [x, z] points
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let best = -1, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1e-9;
    const d = Math.abs((pts[i][0] - a[0]) * ez - (pts[i][1] - a[1]) * ex) / L;
    if (d > best) { best = d; at = i; }
  }
  if (best <= eps) return [a, b];
  return [...rdp(pts.slice(0, at + 1), eps).slice(0, -1), ...rdp(pts.slice(at), eps)];
}

// --- 1. paths: OpenStreetMap's footways, paths, pedestrian ways, steps and cycleways in the park (not the sidewalks
// along its roads, the crossings or the bridges), cut to the park's land in 1 m steps. [surface, width, x, z, ...]
// surface: 0 paved (asphalt, concrete), 1 earth (the trails), 2 boardwalk, 3 gravel, 4 steps
const SURF = (t) => {
  if (t.highway === 'steps') return 4;
  const s = t.surface || '';
  if (/^(wood|metal|boardwalk)$/.test(s)) return 2;
  if (/^(gravel|fine_gravel|compacted|pebblestone|woodchips)$/.test(s)) return 3;
  if (/^(ground|dirt|earth|grass|mud|sand|unpaved)$/.test(s)) return 1;
  if (s) return 0;
  return t.highway === 'path' ? 1 : 0;
};
const WIDTH = (t) => {
  const w = parseFloat(t.width);
  if (w >= 0.8 && w <= 8) return w;
  return { pedestrian: 4.5, cycleway: 3, footway: 2, steps: 1.8, path: 1.4, track: 3, bridleway: 2 }[t.highway] || 2;
};
const paths = [];
let pathLen = 0;
for (const w of ways) {
  const t = w.t;
  if (!/^(footway|path|pedestrian|steps|cycleway|track|bridleway)$/.test(t.highway || '') || t.area === 'yes') continue;
  if (/^(sidewalk|crossing|traffic_island)$/.test(t.footway || '') || /^(sidewalk|crossing)$/.test(t.path || '')) continue;
  if ((t.bridge && t.bridge !== 'no') || (t.tunnel && t.tunnel !== 'no') || (t.layer && t.layer !== '0')) continue;
  const surf = SURF(t), width = WIDTH(t);
  let run = [];
  const flush = () => {
    if (run.length >= 2) {
      const s = rdp(run, 0.15);
      let L = 0;
      for (let i = 1; i < s.length; i++) L += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
      if (L >= 3) { paths.push([surf, width, ...s.flatMap(([x, z]) => [q(x), q(z)])]); pathLen += L; }
    }
    run = [];
  };
  for (let i = 0; i + 1 < w.pts.length; i++) {
    const [ax, az] = w.pts[i], [bx, bz] = w.pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)));
    for (let k = 0; k <= n; k++) {
      if (k === 0 && i > 0) continue;
      const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
      if (onPark(x, z, width / 2 + 0.3)) run.push([x, z]); else flush();
    }
  }
  flush();
}

// --- 2. areas: [kind, name, x, z, ...] (the outline, open: its first point not repeated)
const AREA = (t) => {
  if (t.amenity === 'fountain') return 'fountain';
  if (t.attraction === 'maze') return 'labyrinth';
  if (t.tourism === 'zoo' || t.zoo) return 'zoo';
  if (t.leisure === 'dog_park') return 'dogs';
  if (t.landuse === 'allotments') return 'allotments';
  if (t.landuse === 'flowerbed') return 'bed';
  if (t.leisure === 'garden') return 'garden';
  if (t.amenity === 'theatre') return 'amphitheatre';
  if (t.amenity === 'parking' && (!t.parking || t.parking === 'surface')) return 'parking';
  return null;
};
const areas = [];
const centroid = (pts) => { let x = 0, z = 0; for (const p of pts) { x += p[0]; z += p[1]; } return [x / pts.length, z / pts.length]; };
for (const w of ways) {
  const kind = AREA(w.t);
  if (!kind) continue;
  let pts = w.pts;
  if (pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.01) pts = pts.slice(0, -1);
  if (pts.length < 3) continue;
  // (on the park: most of its outline on the park's islands; a fountain's basin is water, so only its centre counts)
  const on = kind === 'fountain' ? (islandAt(...centroid(pts)) ? 1 : 0) : pts.filter(([x, z]) => islandAt(x, z)).length / pts.length;
  if (on < 0.6) continue;
  // (simplified as two open halves, from the first point to the farthest and back: a closed ring's ends coincide)
  const eps = kind === 'labyrinth' || kind === 'fountain' ? 0.05 : 0.2;
  let far = 0;
  for (let i = 1; i < pts.length; i++) if (Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]) > Math.hypot(pts[far][0] - pts[0][0], pts[far][1] - pts[0][1])) far = i;
  const ring = [...rdp(pts.slice(0, far + 1), eps).slice(0, -1), ...rdp([...pts.slice(far), pts[0]], eps).slice(0, -1)];
  areas.push([kind, w.t.name || '', ...ring.flatMap(([x, z]) => [q(x), q(z)])]);
}

// --- 2b. barriers on the park's land: [kind, x, z, ...]; kind 0 a fence (chain-link: the ravines' and the pitches'),
// 1 a railing, 2 a hedge, 3 a wall, 4 a paddock's post-and-rail fence (in or on the zoo's enclosure)
const zoo = areas.filter((a) => a[0] === 'zoo').map((a) => { const r = []; for (let i = 2; i < a.length; i += 2) r.push({ x: a[i], z: a[i + 1] }); return r; });
const nearZoo = (x, z) => zoo.some((r) => inRing(r, x, z) || edgeDist(r, x, z) < 3);
const barriers = [];
let barrierLen = 0;
for (const w of ways) {
  const t = w.t;
  if (!/^(fence|hedge|wall|railing)$/.test(t.barrier || '')) continue;
  const on = w.pts.filter(([x, z]) => islandAt(x, z)).length / w.pts.length;
  if (on < 0.5) continue;
  let kind = t.barrier === 'hedge' ? 2 : t.barrier === 'wall' ? 3 : t.barrier === 'railing' || t.fence_type === 'railing' ? 1 : 0;
  if (kind === 0 && w.pts.filter(([x, z]) => nearZoo(x, z)).length / w.pts.length > 0.6) kind = 4;
  const s = rdp(w.pts, 0.1);
  for (let i = 1; i < s.length; i++) barrierLen += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
  barriers.push([kind, ...s.flatMap(([x, z]) => [q(x), q(z)])]);
}

// --- 3. Colborne Lodge (w156278826, historic) and its coach house (w156278825, the washrooms in it): their footprints
const BUILDINGS = { 156278826: 'colborne-lodge', 156278825: 'coach-house' };
const buildings = [];
for (const [id, name] of Object.entries(BUILDINGS)) {
  const w = els.get(Number(id));
  if (!w) { console.warn(`[hp-features] building w${id} (${name}) missing`); continue; }
  let pts = w.geometry.map(W);
  if (Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.01) pts = pts.slice(0, -1);
  buildings.push([name, ...pts.flatMap(([x, z]) => [q(x), q(z)])]);
}

// --- 4. the park roads closed to cars: [when, name, x, z, ...]; when 0: at all times (motor_vehicle=private, the
// Movement Strategy's 2023 closures: West Road, Colborne Lodge Drive's middle, Spring Road), 1: on weekends and holidays
// (motor_vehicle:conditional=no|private @ Sa-Su: the rest of the park's roads)
const closures = [];
for (const w of ways) {
  const t = w.t;
  if (!/^(unclassified|service|residential|tertiary)$/.test(t.highway || '')) continue;
  if (!w.pts.some(([x, z]) => islandAt(x, z) || C.blockAt(x, z) === null)) continue;
  const mv = t.motor_vehicle || t.motorcar || t.access || '';
  const always = /^(private|no)$/.test(mv) && t.highway !== 'service' || (t.highway === 'service' && t.motorcar === 'private');
  const weekend = /(no|private) @ \(?Sa-Su/.test(t['motor_vehicle:conditional'] || '');
  if (!always && !weekend) continue;
  // (only roads through the park: the islands either side of them are the park's)
  const mid = w.pts[Math.floor(w.pts.length / 2)];
  const parkBy = [[8, 0], [-8, 0], [0, 8], [0, -8]].some(([dx, dz]) => islandAt(mid[0] + dx, mid[1] + dz));
  if (!parkBy) continue;
  closures.push([always ? 0 : 1, t.name || '', ...w.pts.flatMap(([x, z]) => [q(x), q(z)])]);
}

const counts = {};
for (const a of areas) counts[a[0]] = (counts[a[0]] || 0) + 1;
const out = {
  version: 1,
  source: '© OpenStreetMap contributors (ODbL): the downloads in GEO_DATA and an Overpass extract of High Park',
  paths, areas, barriers, buildings, closures,
  diagnostics: { paths: paths.length, pathKm: Math.round(pathLen) / 1000, areas: counts, barriers: barriers.length, barrierKm: Math.round(barrierLen) / 1000, buildings: buildings.map((b) => b[0]), closures: closures.map((c) => `${c[1]}${c[0] ? ' (weekends)' : ''}`), extracted }
};
fs.writeFileSync(OUT, `// js/high-park-features-data.js: written by tools/build-high-park-features.mjs (docs/high-park-features.md); do not edit.
// High Park's paths, gardens, paddocks, off-leash areas, Colborne Lodge's footprint and the park roads closed to cars,
// in the world frame. Data © OpenStreetMap contributors (ODbL).
window.CITY = window.CITY || {};
window.CITY.HIGH_PARK_FEATURES = ${JSON.stringify(out)};
`);
console.log(`[hp-features] ${paths.length} path runs (${(pathLen / 1000).toFixed(1)} km), areas ${JSON.stringify(counts)}, ${barriers.length} barriers (${(barrierLen / 1000).toFixed(1)} km), buildings ${buildings.map((b) => b[0]).join(', ')}, ${closures.length} closed road ways; ${extracted} shapes from the extract -> ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
