// tools/build-island-access.mjs — the Toronto Islands ferry-terminal -> beach access / amenity identity the island
// access module reads (js/waterfront-island-access.js, st-sb3r.9). The committed geodata carries only a subset of the
// island footpaths (the small-park paths) and no natural=beach polygons, so this tool fetches the REAL OpenStreetMap
// features and writes them, projected to the city's world metres, into js/waterfront-island-access-data.js:
//   - the exact beach polygons: Manitou Beach (relation 1463388), Ward's Island Beach (relation 1463389), Hanlan's
//     Point Beach (relation 16086110) and Gibraltar Point Beach (way 104254897);
//   - the amenities at those beaches and the three ferry terminals (toilets, showers/changing buildings, picnic sites
//     and tables, benches, drinking water, information boards), at their exact mapped node or footprint;
//   - the real walkable path graph near the beaches and the shortest mapped dock -> beach-access route (bridges are
//     walkable; no route is invented over water). The route's full-resolution edges are compared with GEO.roads and
//     GEO.parkPaths and with the arrival layer's connectors; the runtime draws only the genuinely uncovered pieces;
//   - the short, real access spurs where a mapped footway/path/service way reaches the sand.
// Usage (network):   node tools/build-island-access.mjs
// Usage (cached raw): ISLAND_ACCESS_RAW=/path/to/raw node tools/build-island-access.mjs
// It writes only js/waterfront-island-access-data.js. OpenStreetMap contributors, ODbL.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { unpackGeo } from '../js/geodata-loader.js';

const OUT = 'js/waterfront-island-access-data.js';
const API = 'https://api.openstreetmap.org/api/0.6';
const UA = 'slop-toronto-island-access/1.0 (research; +https://sloptoronto.ca)';
const RAW = process.env.ISLAND_ACCESS_RAW || '';

// The city's projection, as the committed geodata states it (identical in the detail and Eglinton frames).
const ctx = vm.createContext({ window: { CITY: {} } });
vm.runInContext(fs.readFileSync('js/toronto-geodata.js', 'utf8'), ctx);
const P = ctx.window.CITY.GEO.frame.projection;
const toWorld = (lon, lat) => {
  const e = (lon - P.lon0) * P.kx, n = (lat - P.lat0) * P.ky, c = Math.cos(P.theta), s = Math.sin(P.theta);
  return [e * c - n * s - P.ox, -(e * s + n * c) - P.oz];
};
const r1 = (v) => Math.round(v * 10) / 10;

const BEACHES = [
  { id: 'manitou', name: 'Manitou Beach', type: 'relation', ref: 1463388, surface: 'sand', wikidata: 'Q120918448' },
  { id: 'wards', name: "Wards Island Beach", type: 'relation', ref: 1463389, surface: 'sand', wikidata: 'Q7968909' },
  { id: 'hanlans', name: "Hanlan's Point Beach", type: 'relation', ref: 16086110, surface: 'sand', wikidata: 'Q5648577' },
  { id: 'gibraltar', name: 'Gibraltar Point Beach', type: 'way', ref: 104254897, surface: 'sand', wikidata: 'Q120917934' }
];
// The island BIA terminal -> its local beach; Gibraltar is the secondary beach at Hanlan's Point.
const DOCK_BEACH = { ward: 'wards', centre: 'manitou', hanlans: 'hanlans' };
const DOCK_NAME = { ward: "Ward's Island", centre: 'Centre Island', hanlans: "Hanlan's Point" };

// The island's OSM window (south, west, north, east) for the amenity and walkable-path queries.
const BBOX = [43.605, -79.41, 43.643, -79.345];

// Amenity categories carried: toilets / change & shower buildings / picnic / benches / wayfinding / drinking water.
const AMENITY_KIND = (t) => {
  if (t.amenity === 'toilets') return 'toilets';
  if (t.amenity === 'shower' || t.amenity === 'changing_rooms' || t.building === 'changing_rooms') return 'shower';
  if (t.amenity === 'drinking_water') return 'water';
  if (t.amenity === 'bench') return 'bench';
  if (t.amenity === 'shelter') return 'shelter';
  if (t.amenity === 'bbq') return 'bbq';
  if (t.tourism === 'picnic_site' || t.leisure === 'picnic_table') return 'picnic';
  if (t.tourism === 'information') return 'information';
  return null;
};
const KEEP_TAGS = ['name', 'amenity', 'tourism', 'leisure', 'building', 'building:levels', 'height', 'surface', 'wheelchair', 'fee', 'seasonal', 'opening_hours', 'information', 'board_type', 'drinking_water', 'access', 'changing_table'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let net = 0;
async function fetchText(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    net++;
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/xml' } });
    if (res.ok) return res.text();
    if (res.status === 429 || res.status >= 500) { await sleep(1500 * (attempt + 1)); continue; }
    throw new Error(`${url}: HTTP ${res.status}`);
  }
  throw new Error(`${url}: repeated failure`);
}

function parseOSM(xml) {
  const nodes = {};
  for (const m of xml.matchAll(/<node id="(\d+)"[^>]*?\blat="([-\d.]+)"[^>]*?\blon="([-\d.]+)"/g)) nodes[m[1]] = [+m[3], +m[2]];
  const nodeTags = {};
  for (const m of xml.matchAll(/<node id="(\d+)"([^>]*)>([\s\S]*?)<\/node>/g)) {
    const tags = {};
    for (const t of m[3].matchAll(/<tag k="([^"]+)" v="([^"]*)"/g)) tags[t[1]] = t[2];
    if (Object.keys(tags).length) nodeTags[m[1]] = tags;
  }
  const ways = {};
  for (const m of xml.matchAll(/<way id="(\d+)"[^>]*>([\s\S]*?)<\/way>/g)) {
    const body = m[2];
    const nds = Array.from(body.matchAll(/<nd ref="(\d+)"/g), (x) => x[1]);
    const tags = {};
    for (const t of body.matchAll(/<tag k="([^"]+)" v="([^"]*)"/g)) tags[t[1]] = t[2];
    ways[m[1]] = { nds, tags };
  }
  const relations = {};
  for (const m of xml.matchAll(/<relation id="(\d+)"[^>]*>([\s\S]*?)<\/relation>/g)) {
    const members = Array.from(m[2].matchAll(/<member type="(\w+)" ref="(\d+)" role="([^"]*)"/g), (x) => ({ type: x[1], ref: x[2], role: x[3] }));
    const tags = {};
    for (const t of m[2].matchAll(/<tag k="([^"]+)" v="([^"]*)"/g)) tags[t[1]] = t[2];
    relations[m[1]] = { members, tags };
  }
  return { nodes, nodeTags, ways, relations };
}

async function overpass(query) {
  const endpoints = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  let last;
  for (let a = 0; a < 6; a++) {
    const ep = endpoints[a % endpoints.length];
    try {
      net++;
      const res = await fetch(ep, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ data: query }) });
      const text = await res.text();
      if (res.ok && text.trim().startsWith('{')) return JSON.parse(text);
      last = new Error(`${ep}: HTTP ${res.status} ${text.slice(0, 80)}`);
    } catch (e) { last = e; }
    await sleep(2500 * (a + 1));
  }
  throw last;
}

function readRaw(name) {
  if (!RAW) return null;
  const p = path.join(RAW, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}
function writeRaw(name, obj) {
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(path.join(RAW, name), JSON.stringify(obj));
}

// Join a relation's outer-member ways (by shared node ids) into closed rings.
function chainRings(wayIds, ways) {
  const pool = wayIds.map((id) => (ways[id] ? ways[id].nds.slice() : [])).filter((s) => s.length >= 2);
  const rings = [];
  while (pool.length) {
    let cur = pool.shift();
    for (let guard = 0; guard < 2000; guard++) {
      const end = cur[cur.length - 1];
      let found = false;
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i];
        if (s[0] === end) { cur = cur.concat(s.slice(1)); pool.splice(i, 1); found = true; break; }
        if (s[s.length - 1] === end) { cur = cur.concat(s.slice().reverse().slice(1)); pool.splice(i, 1); found = true; break; }
      }
      if (!found) break;
    }
    if (cur.length > 3 && cur[0] === cur[cur.length - 1]) cur = cur.slice(0, -1);
    if (cur.length >= 3) rings.push(cur);
  }
  return rings;
}

function pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function distSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}
function distRing(ring, x, z) {
  if (pointInRing(ring, x, z)) return 0;
  let d = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) d = Math.min(d, distSeg(x, z, ring[j][0], ring[j][1], ring[i][0], ring[i][1]));
  return d;
}
function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a) / 2;
}
function rdp(pts, tol) {
  if (pts.length < 3) return pts;
  let maxD = 0, idx = 0;
  const [ax, az] = pts[0], [bx, bz] = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) { const d = distSeg(pts[i][0], pts[i][1], ax, az, bx, bz); if (d > maxD) { maxD = d; idx = i; } }
  if (maxD <= tol) return [pts[0], pts[pts.length - 1]];
  return rdp(pts.slice(0, idx + 1), tol).slice(0, -1).concat(rdp(pts.slice(idx), tol));
}

async function loadBeaches() {
  const cached = readRaw('beaches.json');
  if (cached) return cached;
  const out = {};
  for (const b of BEACHES) {
    const xml = await fetchText(`${API}/${b.type}/${b.ref}/full`);
    const osm = parseOSM(xml);
    let nodeLists = [];
    if (b.type === 'relation') {
      const rel = osm.relations[b.ref];
      nodeLists = chainRings(rel.members.filter((m) => m.type === 'way' && (!m.role || m.role === 'outer')).map((m) => m.ref), osm.ways);
    } else {
      nodeLists = [osm.ways[b.ref].nds];
    }
    const rings = [];
    for (const ids of nodeLists) {
      const ring = ids.map((id) => osm.nodes[id]).filter(Boolean).map(([lon, lat]) => toWorld(lon, lat).map(r1));
      if (ring.length >= 3) rings.push(ring);
    }
    if (!rings.length) throw new Error(`${b.id}: no ring from ${b.type}/${b.ref}`);
    out[b.id] = { ...b, rings };
    await sleep(800);
  }
  if (RAW) writeRaw('beaches.json', out);
  return out;
}

async function loadAmenities() {
  const cached = readRaw('amenities.json');
  if (cached) return cached;
  const q = `[out:json][timeout:120];
(
  nwr["amenity"~"^(toilets|shelter|drinking_water|bench|bbq|shower|changing_rooms)$"](${BBOX.join(',')});
  nwr["tourism"~"^(picnic_site|information)$"](${BBOX.join(',')});
  nwr["leisure"="picnic_table"](${BBOX.join(',')});
  nwr["building"="changing_rooms"](${BBOX.join(',')});
);
out geom tags;`;
  const data = await overpass(q);
  if (RAW) writeRaw('amenities.json', data);
  return data;
}

async function loadPathWays() {
  const cached = readRaw('paths.json');
  if (cached) return cached;
  const q = `[out:json][timeout:180];
way["highway"~"^(footway|path|pedestrian|steps|cycleway|service|track|bridleway)$"](${BBOX.join(',')});
out geom tags;`;
  const data = await overpass(q);
  if (RAW) writeRaw('paths.json', data);
  return data;
}

async function loadMeta() {
  const cached = readRaw('meta.json');
  if (cached) return cached;
  const q = `[out:json][timeout:60];
(
 relation(1463388);relation(1463389);relation(16086110);
 way(104254897);way(10427151);
 way(176885369);way(638632056);way(1375105746);way(334837421);
 way(1082523797);way(192960574);way(298736729);way(1426512932);way(795796087);way(190346175);way(192579351);way(193043050);
);
out meta;`;
  const data = await overpass(q);
  if (RAW) writeRaw('meta.json', data);
  return data;
}

async function loadWayGeometries(ids) {
  const cache = readRaw('amenity-ways.json') || {};
  const missing = ids.filter((id) => !cache[id]);
  for (const id of missing) {
    try {
      const xml = await fetchText(`${API}/way/${id}/full`);
      const osm = parseOSM(xml);
      const w = osm.ways[id];
      if (w) cache[id] = { nds: w.nds, geometry: w.nds.map((n) => osm.nodes[n]).filter(Boolean).map(([lon, lat]) => ({ lon, lat })) };
    } catch (e) { console.warn(`way ${id}: ${e.message}`); }
    await sleep(500);
  }
  if (RAW) writeRaw('amenity-ways.json', cache);
  return cache;
}

function nearestOnRing(ring, x, z) {
  let best = [x, z], bd = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0], az = ring[j][1], bx = ring[i][0], bz = ring[i][1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
    let t = ((x - ax) * dx + (z - az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < bd) { bd = d; best = [px, pz]; }
  }
  return best;
}
function buildNativeCorridors(GEO_, arrivals) {
  // The corridors the native city already draws: GEO.roads and the small-park paths (GEO.parkPaths), plus the arrival
  // layer's own rendered connectors. A route piece inside one of these is not redrawn (no duplicated overlay).
  const segs = [];
  const push = (ax, az, bx, bz, half) => {
    const pad = half;
    segs.push([Math.min(ax, bx) - pad, Math.min(az, bz) - pad, Math.max(ax, bx) + pad, Math.max(az, bz) + pad, half, ax, az, bx, bz]);
  };
  for (const row of GEO_.parkPaths || []) {
    const half = ((row[0] > 0 ? row[0] : 1.8) / 2) + 0.4;
    for (let i = 2; i + 1 < row.length; i += 2) push(row[i - 2], row[i - 1], row[i], row[i + 1], half);
  }
  for (const r of GEO_.roads || []) {
    const half = ((r[1] > 0 ? r[1] : 3) / 2) + 0.5;
    for (let i = 6; i + 3 < r.length; i += 2) push(r[i], r[i + 1], r[i + 2], r[i + 3], half);
  }
  for (const [dockId, list] of Object.entries(arrivals.connectors || {})) {
    const dock = arrivals.docks[dockId];
    for (const c of list) {
      if (!c.nodes || c.nodes.length < 2) continue;
      if (dock && c.osmId === dock.osmId) continue;
      if (c.nearest !== undefined && c.nearest > 90) continue;
      const w = c.tags && c.tags.width ? parseFloat(c.tags.width) : (c.isWood ? 2.2 : 2.4);
      const half = (Math.max(1.2, Math.min(12, w || 0)) / 2) + 0.35;
      for (let i = 0; i + 1 < c.nodes.length; i++) push(c.nodes[i][0], c.nodes[i][1], c.nodes[i + 1][0], c.nodes[i + 1][1], half);
    }
  }
  return segs;
}
function corridorCovered(segs, x, z) {
  for (const s of segs) {
    if (x < s[0] || x > s[2] || z < s[1] || z > s[3]) continue;
    if (distSeg(x, z, s[5], s[6], s[7], s[8]) <= s[4]) return true;
  }
  return false;
}
function routeCoverage(segments, segs) {
  let length = 0, gap = 0;
  for (const [ax, az, bx, bz, , , w] of segments) {
    const L = Math.hypot(bx - ax, bz - az);
    length += L;
    let covered = true;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      if (!corridorCovered(segs, ax + (bx - ax) * t, az + (bz - az) * t)) { covered = false; break; }
    }
    if (!covered) gap += L;
  }
  return { length: Math.round(length), gap: Math.round(gap), covered: Math.round(length - gap), gapPct: length ? Math.round((gap / length) * 100) : 0 };
}

async function main() {
  // The terminal anchors come from the already-sourced arrival data (world metres), so the two island layers agree.
  const arrivalsSandbox = { window: { CITY: {} } };
  vm.runInNewContext(fs.readFileSync('js/waterfront-island-arrivals-data.js', 'utf8'), arrivalsSandbox);
  const arrivals = arrivalsSandbox.window.CITY.ISLAND_ARRIVALS_DATA;
  const docks = {};
  for (const [id, d] of Object.entries(arrivals.docks)) {
    const anchor = d.ring ? d.ring.reduce((a, p) => [a[0] + p[0] / d.ring.length, a[1] + p[1] / d.ring.length], [0, 0]) : d.point;
    docks[id] = { name: DOCK_NAME[id], anchor: anchor.map(r1), osmType: d.osmType, osmId: d.osmId };
  }

  const { GEO } = await unpackGeo(fs.readFileSync('data/toronto-geodata.bin'));
  const nativeSegs = buildNativeCorridors(GEO, arrivals);
  // The authoritative dry/wet sampler (same one the runtime/tests use): city-config's waterAt over the committed GEO.
  const citySandbox = { window: { CITY: { GEO } }, console: { info() {}, log() {}, warn() {}, error() {} }, location: { search: '' }, URLSearchParams, performance };
  vm.runInContext(fs.readFileSync('js/city-config.js', 'utf8'), vm.createContext(citySandbox), { filename: 'city-config.js' });
  const waterAt = citySandbox.window.CITY.waterAt;

  const beachRaw = await loadBeaches();
  const beaches = {};
  for (const b of BEACHES) {
    const rings = beachRaw[b.id].rings;
    const area = rings.reduce((s, r) => s + ringArea(r), 0);
    const all = rings.flat();
    const bbox = [Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1]))].map(r1);
    beaches[b.id] = { id: b.id, name: b.name, osmType: b.type, osmId: b.ref, surface: b.surface, wikidata: b.wikidata, rings, areaM2: Math.round(area), bbox };
  }

  // --- amenities at the beaches / terminals ----------------------------------------------------------------
  const amenData = await loadAmenities();
  const beachList = Object.entries(beaches).map(([id, b]) => ({ id, ring: b.rings[0], rings: b.rings, bbox: b.bbox }));
  const nearBeach = (x, z) => {
    let best = null, bd = Infinity;
    for (const b of beachList) {
      if (x < b.bbox[0] - AMENITY_BEACH_M || x > b.bbox[2] + AMENITY_BEACH_M || z < b.bbox[1] - AMENITY_BEACH_M || z > b.bbox[3] + AMENITY_BEACH_M) continue;
      const d = Math.min(...b.rings.map((r) => distRing(r, x, z)));
      if (d < bd) { bd = d; best = b.id; }
    }
    return [best, bd];
  };
  const nearDock = (x, z) => {
    let best = null, bd = Infinity;
    for (const [id, d] of Object.entries(docks)) {
      const dd = Math.hypot(x - d.anchor[0], z - d.anchor[1]);
      if (dd < bd) { bd = dd; best = id; }
    }
    return [best, bd];
  };
  const AMENITY_BEACH_M = 450, AMENITY_DOCK_M = 100;

  const wayIdsNeeded = [];
  const raw = [];
  for (const e of amenData.elements) {
    const t = e.tags || {};
    const kind = AMENITY_KIND(t);
    if (!kind) continue;
    if (e.type === 'way') wayIdsNeeded.push(e.id);
    let point, ring = null;
    if (e.type === 'node') point = toWorld(e.lon, e.lat).map(r1);
    else if (e.geometry && e.geometry.length >= 3) {
      ring = e.geometry.map((g) => toWorld(g.lon, g.lat).map(r1));
      const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      point = [r1(cx), r1(cz)];
    } else if (e.center) point = toWorld(e.center.lon, e.center.lat).map(r1);
    else continue;
    const [beach, beachD] = nearBeach(point[0], point[1]);
    const [dock, dockD] = nearDock(point[0], point[1]);
    if (!(beachD <= AMENITY_BEACH_M || dockD <= AMENITY_DOCK_M)) continue;
    const tags = {};
    for (const k of KEEP_TAGS) if (t[k] !== undefined) tags[k] = t[k];
    raw.push({ kind, osmType: e.type, osmId: e.id, point, ring, tags, beach, beachD: Math.round(beachD), dock, dockD: Math.round(dockD) });
  }
  const wayGeo = await loadWayGeometries(wayIdsNeeded);
  const amenities = raw.map((a) => {
    if (!a.ring && a.osmType === 'way' && wayGeo[a.osmId]) {
      const g = wayGeo[a.osmId].geometry;
      if (g && g.length >= 3) a.ring = g.map((p) => toWorld(p.lon, p.lat).map(r1));
    }
    if (a.ring) {
      const t = a.tags;
      let h = parseFloat(t.height);
      let estimated = false;
      if (!Number.isFinite(h)) {
        const levels = parseFloat(t['building:levels']);
        if (Number.isFinite(levels)) h = levels * 3;
        else { h = a.kind === 'toilets' ? 3.2 : a.kind === 'shower' ? 3.0 : 3.4; estimated = true; }
      }
      a.height = r1(h); a.heightEstimated = estimated;
    }
    return a;
  });
  amenities.sort((a, b) => (a.kind.localeCompare(b.kind)) || (b.beachD - a.beachD));

  // --- walkable path graph and dock -> beach routes --------------------------------------------------------
  // (Overpass's `out geom` here carries the geometry but not the node ids, so the graph is keyed by the projected
  // coordinate rounded to 0.1 m; shared OSM nodes project to the same key, so the mapped network stays connected.)
  const pathsData = await loadPathWays();
  const keyOf = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  const ptOf = (k) => k.split(',').map(Number);
  const pts = new Map();   // key -> [x, z]
  const adj = new Map();   // key -> [{ to, way, highway, surface, bridge, d, ax, az, bx, bz }]
  for (const w of pathsData.elements) {
    const t = w.tags || {};
    if (t.area === 'yes') continue;
    const g = (w.geometry || []).map((p) => toWorld(p.lon, p.lat).map(r1));
    if (g.length < 2) continue;
    for (const p of g) pts.set(keyOf(p), p);
    for (let i = 0; i + 1 < g.length; i++) {
      const a = g[i], b = g[i + 1], ka = keyOf(a), kb = keyOf(b);
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (ka === kb || d < 0.05) continue;
      const mk = (to) => ({ to, way: +w.id, highway: t.highway || null, surface: t.surface || null, bridge: t.bridge || null, d, ax: a[0], az: a[1], bx: b[0], bz: b[1] });
      (adj.get(ka) || adj.set(ka, []).get(ka)).push(mk(kb));
      (adj.get(kb) || adj.set(kb, []).get(kb)).push(mk(ka));
    }
  }
  const keys = [...pts.keys()];
  const nearestKey = (pt) => {
    let best = null, bd = Infinity;
    for (const k of keys) {
      const p = pts.get(k), d = Math.hypot(p[0] - pt[0], p[1] - pt[1]);
      if (d < bd) { bd = d; best = k; }
    }
    return [best, bd];
  };
  const dijkstra = (start, targets = null) => {
    const dist = new Map([[start, 0]]), prev = new Map(), pq = [[0, start]], T = targets ? new Set(targets) : null;
    while (pq.length) {
      pq.sort((a, b) => a[0] - b[0]);
      const [d, u] = pq.shift();
      if (d > dist.get(u)) continue;
      if (T && T.has(u)) return { node: u, length: d, chain: trace(u, prev) };
      for (const e of adj.get(u) || []) {
        const nd = d + e.d;
        if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, { p: u, e }); pq.push([nd, e.to]); }
      }
    }
    return T ? null : { dist, prev };
  };
  const trace = (u, prev) => {
    const chain = [];
    while (u !== undefined) { chain.push(u); u = prev.get(u)?.p; }
    return chain.reverse();
  };
  const ringDist = (b, x, z) => Math.min(...b.rings.map((r) => distRing(r, x, z)));

  // Access spurs: contiguous runs of a real way's geometry within SPUR_M of the beach ring.
  const SPUR_M = 15;
  const ACCESS_WAY_M = 8;
  const access = {};
  for (const b of beachList) {
    const spurs = [];
    let best = null, bestD = Infinity;
    for (const w of pathsData.elements) {
      const t = w.tags || {};
      if (t.area === 'yes') continue;
      const g = (w.geometry || []).map((p) => toWorld(p.lon, p.lat).map(r1));
      if (g.length < 2) continue;
      let minD = Infinity, minP = null;
      for (const p of g) { const d = ringDist(b, p[0], p[1]); if (d < minD) { minD = d; minP = p; } }
      if (minD > ACCESS_WAY_M) continue;
      let run = [];
      const flush = () => {
        if (run.length >= 2) {
          const nodes = run.slice();
          spurs.push({
            osmId: +w.id, highway: t.highway || null, surface: t.surface || null,
            isWood: t.surface === 'wood' || t.highway === 'boardwalk', name: t.name || null,
            maxDist: r1(Math.max(...nodes.map((p) => ringDist(b, p[0], p[1])))), nodes
          });
        }
        run = [];
      };
      for (const p of g) { if (ringDist(b, p[0], p[1]) <= SPUR_M) run.push(p); else flush(); }
      flush();
      if (minD < bestD) { bestD = minD; best = { osmId: +w.id, highway: t.highway || null, surface: t.surface || null, name: t.name || null, point: minP, dist: r1(minD) }; }
    }
    const seen = new Set();
    access[b.id] = {
      spurs: spurs.filter((s) => { const k = `${s.osmId}:${keyOf(s.nodes[0])}`; if (seen.has(k)) return false; seen.add(k); return true; }),
      point: best ? best.point : null, bestWay: best
    };
  }

  // Dock -> local beach route. Targets are graph keys on a way that actually reaches the sand, within 12 m of the ring.
  const routeRoutes = {}, routeSummary = {};
  for (const dockId of Object.keys(docks)) {
    const [start, startD] = nearestKey(docks[dockId].anchor);
    const beachId = DOCK_BEACH[dockId];
    const b = beachList.find((x) => x.id === beachId);
    const accessKeys = new Set();
    for (const s of access[b.id].spurs) for (const p of s.nodes) {
      if (ringDist(b, p[0], p[1]) <= 12 && pts.has(keyOf(p))) accessKeys.add(keyOf(p));
    }
    let r = accessKeys.size ? dijkstra(start, [...accessKeys]) : null;
    let finalGap = 0;
    if (!r) {
      // No mapped path reaches the sand (Ward's beach sand footways are a separate OSM component today). The honest
      // fallback is the reachable mapped path point nearest the beach ring; the remaining distance is the beach/grass
      // gap, recorded rather than bridged with an invented path.
      const all = dijkstra(start);
      let end = null, gap = Infinity;
      for (const k of keys) {
        if (!all.dist.has(k)) continue;
        const p = pts.get(k), g = ringDist(b, p[0], p[1]);
        if (g < gap) { gap = g; end = k; }
      }
      r = end ? { node: end, length: all.dist.get(end), chain: trace(end, all.prev) } : null;
      finalGap = Number.isFinite(gap) ? gap : 0;
    }
    let finalApproach = null;
    if (r && finalGap > 2) {
      // Ward's beach sand footways are a separate OSM component today. The last gap is open beach/grass from the final
      // mapped path point to the beach ring: record it honestly (dry accessible land, NO invented boardwalk) instead of
      // claiming a third fully mapped route.
      const from = pts.get(r.node).map(r1);
      const to = nearestOnRing(b.rings[0], from[0], from[1]).map(r1);
      const gap = Math.hypot(to[0] - from[0], to[1] - from[1]);
      let wet = 0;
      const steps = Math.max(1, Math.ceil(gap));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps, x = from[0] + (to[0] - from[0]) * t, z = from[1] + (to[1] - from[1]) * t;
        if (waterAt(x, z)) wet += gap / steps;
      }
      finalApproach = {
        kind: 'informal-unmapped-beach-approach', from, to, gapM: Math.round(gap), wetM: Math.round(wet),
        dry: wet <= 1,
        label: wet <= 1 ? 'open beach/grass, no OSM walkable way tagged' : 'no OSM walkable way; coastline water-mask samples the straight approach as partly wet'
      };
    }
    if (!r) { console.warn(`route ${dockId}->${beachId}: no mapped walk`); continue; }
    const line = r.chain.map((k) => pts.get(k).map(r1));
    const ways = [], surfaces = [], segments = [];
    for (let i = 0; i + 1 < r.chain.length; i++) {
      const e = (adj.get(r.chain[i]) || []).find((x) => x.to === r.chain[i + 1]);
      if (!e) continue;
      if (!ways.includes(e.way)) ways.push(e.way);
      if (!surfaces.includes(e.surface)) surfaces.push(e.surface);
      const width = e.highway === 'service' ? 3.4 : e.highway === 'path' ? 1.8 : e.highway === 'cycleway' ? 2.5 : 2.4;
      segments.push([r1(e.ax), r1(e.az), r1(e.bx), r1(e.bz), e.surface || null, e.way, width, e.bridge === 'yes' ? 1 : 0]);
    }
    routeRoutes[dockId] = {
      beach: beachId, connected: finalGap <= 2 && !!accessKeys.size, lengthM: Math.round(r.length), finalGapM: Math.round(finalGap),
      startDockM: r1(startD), ways, surfaces: surfaces.filter(Boolean), nodes: rdp(line, 1.0),
      // full-resolution mapped edges: the runtime draws only the pieces NOT already carried by the native roads/park
      // paths or the arrival layer, so there is a real visual walk without a duplicated whole overlay.
      segments, coverage: routeCoverage(segments, nativeSegs), finalApproach
    };
    routeSummary[dockId] = {};
    for (const bb of beachList) {
      const [end] = nearestKey(bb.rings[0][0]);
      const rr = end ? dijkstra(start, [end]) : null;
      routeSummary[dockId][bb.id] = rr ? Math.round(rr.length) : null;
    }
  }

  const metaData = await loadMeta();
  const osmMeta = {};
  for (const e of metaData.elements || []) osmMeta[`${e.type}/${e.id}`] = { version: e.version, timestamp: e.timestamp };

  const out = {
    source: 'OpenStreetMap contributors, ODbL',
    fetched: new Date().toISOString().slice(0, 10),
    via: 'https://api.openstreetmap.org/api/0.6 + Overpass (island window)',
    projection: P,
    osmMeta,
    docks,
    beaches,
    access,
    routes: routeRoutes,
    routeSummary,
    amenities,
    counts: {
      beaches: Object.keys(beaches).length,
      amenities: amenities.length,
      beachAmenities: amenities.filter((a) => a.beachD <= AMENITY_BEACH_M).length,
      spurs: Object.values(access).reduce((s, a) => s + a.spurs.length, 0),
      woodSpurs: Object.values(access).reduce((s, a) => s + a.spurs.filter((x) => x.isWood).length, 0),
      routes: Object.keys(routeRoutes).length
    }
  };

  const js = `(function () {\n// js/waterfront-island-access-data.js\n// Generated by tools/build-island-access.mjs from OpenStreetMap (api.openstreetmap.org api/0.6 + Overpass). Real beach\n` +
    `// polygons, exact mapped amenities, real walkable paths and the shortest mapped dock -> beach-access routes, in world\n` +
    `// metres. OpenStreetMap contributors, ODbL. Do not edit by hand; rerun the tool. Frame-independent (same projection in\n` +
    `// the detail and Eglinton frames; no geodata indices are stored).\n` +
    `window.CITY = window.CITY || {};\nwindow.CITY.ISLAND_ACCESS_DATA = ${JSON.stringify(out)};\n})();\n`;
  fs.writeFileSync(OUT, js);
  console.log(`wrote ${OUT} (${(js.length / 1024).toFixed(1)} KB)`);
  console.log(JSON.stringify(out.counts));
  for (const [id, r] of Object.entries(routeRoutes)) console.log(`route ${id} -> ${r.beach}: ${r.lengthM} m, connected ${r.connected}, gap ${r.finalGapM} m, ${r.ways.length} ways`);
  console.log(`network requests: ${net}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
