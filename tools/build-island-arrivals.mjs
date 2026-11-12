// tools/build-island-arrivals.mjs — the Toronto Islands ferry-dock geometry the arrival module reads
// (js/waterfront-island-arrivals.js, st-sb3r.9). The committed geodata carries the island ferry docks only as
// Bike Share docking-station POIs (not berths) and omits the island footpaths entirely, so this tool fetches the REAL
// OpenStreetMap features the official map has and writes them, projected to the city's world metres, to
// js/waterfront-island-arrivals-data.js:
//   - each island ferry_terminal (Ward's way, Centre way, Hanlan's node) — the actual berth polygon/point, with its
//     OSM type/id;
//   - the connecting footways/paths/pedestrian ways/steps and piers/quays/wood surfaces that form the real dock
//     approach (the routes a rider actually walks), within reach of each dock;
//   - the water-taxi quay at Hanlan's.
// Usage (network):  node tools/build-island-arrivals.mjs
// It writes only js/waterfront-island-arrivals-data.js (a small, committed data file). No other file is touched.
//
// Source: OpenStreetMap contributors, ODbL. Fetched from https://api.openstreetmap.org/api/0.6/map (official OSM API).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const OUT = 'js/waterfront-island-arrivals-data.js';
const API = 'https://api.openstreetmap.org/api/0.6';
const UA = 'slop-toronto-island-arrivals/1.0 (research; +https://sloptoronto.ca)';

// The city's projection, as the committed geodata states it (identical in detail and Eglinton frames).
const ctx = vm.createContext({ window: { CITY: {} } });
vm.runInContext(fs.readFileSync('js/toronto-geodata.js', 'utf8'), ctx);
const P = ctx.window.CITY.GEO.frame.projection;
const toWorld = (lon, lat) => {
  const e = (lon - P.lon0) * P.kx, n = (lat - P.lat0) * P.ky, c = Math.cos(P.theta), s = Math.sin(P.theta);
  return [e * c - n * s - P.ox, -(e * s + n * c) - P.oz];
};
const round1 = (v) => Math.round(v * 10) / 10;

// The real ferry terminals (fetched 2026-11-09 via Nominatim amenity=ferry_terminal + api/0.6). Ward's and Centre are
// closed ways (berth polygons); Hanlan's is a node plus the nearby water-taxi quay way.
const DOCKS = [
  { id: 'ward', name: "Ward's Island", type: 'way', ref: 251286976 },
  { id: 'centre', name: 'Centre Island', type: 'way', ref: 1175136270 },
  { id: 'hanlans', name: "Hanlan's Point", type: 'node', ref: 56794382, quay: 1375105747 }
];

// Bounding boxes (minlon,minlat,maxlon,maxlat) around each dock, big enough for the dock + its footpath approach.
const BBOX = {
  ward: '-79.365,43.6275,-79.3525,43.6345',
  centre: '-79.3855,43.6175,-79.3715,43.6265',
  hanlans: '-79.396,43.6245,-79.382,43.6325'
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/xml' } });
    if (res.ok) return res.text();
    if (res.status === 429 || res.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
    throw new Error(`${url}: HTTP ${res.status}`);
  }
  throw new Error(`${url}: repeated failure`);
}

function parseOSM(xml) {
  const nodes = {};
  for (const m of xml.matchAll(/<node id="(\d+)"[^>]*?\blat="([-\d.]+)"[^>]*?\blon="([-\d.]+)"/g)) {
    nodes[m[1]] = [Number(m[2]), Number(m[3])];
  }
  const ways = {};
  for (const m of xml.matchAll(/<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)) {
    const body = m[2];
    const nds = Array.from(body.matchAll(/<nd ref="(\d+)"/g), (x) => x[1]);
    const tags = {};
    for (const t of body.matchAll(/<tag k="([^"]+)" v="([^"]*)"/g)) tags[t[1]] = t[2];
    ways[m[1]] = { nds, tags };
  }
  const nodeTags = {};
  for (const m of xml.matchAll(/<node id="(\d+)"[^>]*[^\/>]>([\s\S]*?)<\/node>/g)) {
    for (const t of m[2].matchAll(/<tag k="([^"]+)" v="([^"]*)"/g)) (nodeTags[m[1]] = nodeTags[m[1]] || {})[t[1]] = t[2];
  }
  return { nodes, ways, nodeTags };
}

async function fetchFull(type, ref) {
  const xml = await fetchText(`${API}/${type}/${ref}/full`);
  return parseOSM(xml);
}

function mergeInto(dst, src) {
  Object.assign(dst.nodes, src.nodes);
  Object.assign(dst.ways, src.ways);
  Object.assign(dst.nodeTags, src.nodeTags);
}

function wayGeometry(worldNodes, way) {
  const pts = [];
  for (const n of way.nds) if (worldNodes[n]) pts.push([round1(worldNodes[n][0]), round1(worldNodes[n][1])]);
  return pts;
}

const KEEP_HIGHWAY = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway']);
const KEEP_MANMADE = new Set(['pier', 'quay', 'breakwater']);

function isConnector(tags) {
  if (KEEP_HIGHWAY.has(tags.highway)) return true;
  if (KEEP_MANMADE.has(tags['man_made'])) return true;
  if (tags.surface === 'wood') return true;
  if (tags.amenity === 'ferry_terminal') return true;
  return false;
}

async function main() {
  const out = { source: 'OpenStreetMap contributors, ODbL', fetched: '2026-11-09', via: API, projection: P, docks: {}, connectors: {} };
  for (const dock of DOCKS) {
    const bbox = BBOX[dock.id];
    const area = parseOSM(await fetchText(`${API}/map?bbox=${bbox}`));
    // a way terminal has a /full geometry to merge; a node terminal is already present in the bbox export
    if (dock.type === 'way') mergeInto(area, await fetchFull('way', String(dock.ref)));
    if (dock.quay) mergeInto(area, await fetchFull('way', String(dock.quay)));

    const worldNodes = {};
    for (const [id, [lat, lon]] of Object.entries(area.nodes)) worldNodes[id] = toWorld(lon, lat);

    // the dock itself
    if (dock.type === 'way') {
      const w = area.ways[dock.ref];
      if (!w) throw new Error(`dock way ${dock.ref} missing from fetch`);
      out.docks[dock.id] = {
        osmType: 'way', osmId: dock.ref, name: dock.name, tags: w.tags,
        ring: wayGeometry(worldNodes, w)
      };
    } else {
      const [lat, lon] = area.nodes[dock.ref];
      const [x, z] = toWorld(lon, lat);
      out.docks[dock.id] = { osmType: 'node', osmId: dock.ref, name: dock.name, tags: area.nodeTags[dock.ref] || {}, point: [round1(x), round1(z)] };
      if (dock.quay && area.ways[dock.quay]) {
        out.docks[dock.id].quay = { osmType: 'way', osmId: dock.quay, ring: wayGeometry(worldNodes, area.ways[dock.quay]) };
      }
    }

    // dock reference point for proximity
    const d = out.docks[dock.id];
    const ref = d.ring ? centroid(d.ring) : d.point;

    // the connecting footways/piers/wood near the dock
    const connectors = [];
    for (const [wid, w] of Object.entries(area.ways)) {
      if (!isConnector(w.tags)) continue;
      const pts = wayGeometry(worldNodes, w);
      if (pts.length < 2) continue;
      let dmin = Infinity;
      for (const [x, z] of pts) dmin = Math.min(dmin, Math.hypot(x - ref[0], z - ref[1]));
      if (dmin > 90) continue; // within the real approach; not the whole island
      const surface = w.tags.surface || null;
      connectors.push({
        osmId: Number(wid),
        tags: pick(w.tags, ['highway', 'man_made', 'surface', 'name', 'bridge', 'layer', 'wheelchair', 'access', 'width', 'footway', 'tunnel', 'floating']),
        surface,
        isWood: surface === 'wood' || w.tags.highway === 'boardwalk' || w.tags.footway === 'boardwalk',
        nearest: round1(dmin),
        nodes: pts
      });
    }
    connectors.sort((a, b) => a.nearest - b.nearest);
    out.connectors[dock.id] = connectors;
    console.log(`${dock.id}: ${d.ring ? d.ring.length + ' ring pts' : 'node'} · ${connectors.length} connectors (nearest ${connectors[0] ? connectors[0].nearest : '-'} m, wood ${connectors.filter((c) => c.isWood).length})`);
    await sleep(1200);
  }
  const js = `(function () {\n// js/waterfront-island-arrivals-data.js\n// Generated by tools/build-island-arrivals.mjs from the official OpenStreetMap API (api.openstreetmap.org api/0.6/map\n` +
    `// and .../full). The real island ferry terminals and the footways/piers that form their approaches, projected to the\n` +
    `// city's world metres. OpenStreetMap contributors, ODbL. Do not edit by hand; rerun the tool. Frame-independent\n` +
    `// (same projection in the detail and Eglinton frames: only building indices differ, none are stored here).\n` +
    `window.CITY = window.CITY || {};\nwindow.CITY.ISLAND_ARRIVALS_DATA = ${JSON.stringify(out, null, 1)};\n})();\n`;
  fs.writeFileSync(OUT, js);
  console.log(`wrote ${OUT} (${(js.length / 1024).toFixed(1)} KB)`);
}

function centroid(ring) {
  let x = 0, z = 0;
  for (const [a, b] of ring) { x += a; z += b; }
  return [x / ring.length, z / ring.length];
}
function pick(o, keys) { const r = {}; for (const k of keys) if (k in o) r[k] = o[k]; return r; }

main().catch((e) => { console.error(e); process.exit(1); });