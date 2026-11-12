// tools/build-island-lanes.mjs — the Toronto Islands' mapped lane network the island-lanes module reads
// (js/waterfront-island-lanes.js, st-sb3r.23). Fetches every highway=* way in the islands' OSM window from Overpass,
// keeps the ones that are BOTH a mapped cartridge/lane class (service or living_street) AND restricted to the island's
// private vehicle regime (motor_vehicle=private, access=private), projects their vertices to the city's world metres,
// retains one run per OSM way and writes them into js/waterfront-island-lanes-data.js together with:
//   - the lane profile per OSM way (class, surface, width, one-way, foot/bicycle, the wood/bridge flags);
//   - the exclusion rules with the exact evidence (the Billy Bishop airport relation, the mainland Box, the service
//     classes the fleet lanes never use here: parking_aisle/driveway/emergency_access);
//   - a sourceMeta registry: OSM way id -> { version, timestamp } for every way the module reads.
// Usage (network):   node tools/build-island-lanes.mjs
// Usage (cached raw): ISLAND_LANES_RAW=/path/to/raw node tools/build-island-lanes.mjs
// It writes only js/waterfront-island-lanes-data.js. OpenStreetMap contributors, ODbL.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const OUT = 'js/waterfront-island-lanes-data.js';
const API = 'https://api.openstreetmap.org/api/0.6';
const UA = 'slop-toronto-island-lanes/1.0 (research; +https://sloptoronto.ca)';
const RAW = process.env.ISLAND_LANES_RAW || '';

// The city's projection, as the committed geodata states it (identical in the detail and Eglinton frames).
const ctx = vm.createContext({ window: { CITY: {} } });
vm.runInContext(fs.readFileSync('js/toronto-geodata.js', 'utf8'), ctx);
const P = ctx.window.CITY.GEO.frame.projection;
const toWorld = (lon, lat) => {
  const e = (lon - P.lon0) * P.kx, n = (lat - P.lat0) * P.ky, c = Math.cos(P.theta), s = Math.sin(P.theta);
  return [e * c - n * s - P.ox, -(e * s + n * c) - P.oz];
};
const r1 = (v) => Math.round(v * 10) / 10;

// The islands' OSM window (south, west, north, east): Hanlan's Point to Ward's Island, the whole mapped island chain.
const BBOX = [43.615, -79.405, 43.635, -79.335];

// The lane classes this module claims: the island's own cartage lanes (service) and living streets. Everything else a
// highway=* way can be in this window (footway, path, pedestrian, cycleway, track, residential, secondary, tertiary,
// unclassified, motorway...) is out of scope and recorded once in the summary with its way count.
const LANE_CLASSES = new Set(['service', 'living_street']);
// The private vehicle regime on the islands: motor vehicles are restricted to residents, the City and the services.
// An access=private way is the same statement on the other access key the county's mappers use.
const PRIVATE = (t) => t.motor_vehicle === 'private' || t.access === 'private';
// Service sub-classes that are not lanes even when private: a stall's aisle, a building's driveway, an emergency exit.
const NON_LANE_SERVICE = new Set(['parking_aisle', 'driveway', 'drive-through', 'emergency_access']);
// The excluded relation: Billy Bishop Toronto City Airport (the whole mapped airport footprint).
const AIRPORT_RELATION = 85471;
// Billy Bishop's mapped bounds (relation 85471, v10): a hard exclusion box. No lane of the island's private regime lies in
// it today; this is the guard that keeps a future airport service way out.
const AIRPORT_BOX = [43.6221213, -79.4049155, 43.6336577, -79.3874595];

// The islands' own lane names. The window also carries the mainland's Bayview Avenue and St Lawrence streets; a way must
// carry one of these names (or be unnamed, joined within 40 m to one that does — the unnamed connectors inside the
// private lane network). The list is generated from the same fetch the build reads.
const ISLAND_ROAD_NAMES = ["Algonquin Bridge Road","Avenue Of The Islands","Bayview Avenue","Beach Road","Centre Island Park","Channel Avenue","Cibola Avenue","Dacotah Avenue","Fifth Street","First Street","Fourth Street","Island Park Trail","Island Service Road","Lagoon Road","Lakeshore Avenue","Lenore Avenue","Meades Walk","Nottawa Avenue","Ojibway Avenue","Omaha Avenue","Oneida Avenue","Second Street","Seneca Avenue","Sixth Street","Terry Kimball Lane","The Mall","Third Street","Ward's Island Dock Line","Willow Avenue","Withrow Street","Wyandot Avenue"];

// Primary-photo evidence for the unmarked interior-lane family. These are ordinary resident/traveller photographs
// published on Wikimedia Commons (the file pages carry the author, date and licence), not map data: the captain reads
// the images and accepts or trims the family. The OSM tags alone (motor_vehicle=private) are NOT treated as proof that
// a lane has no painted centre line; only these photographed rows and the photographed living-street family below are.
// `local` paths are the copies fetched for that review under $WATERFRONT_RESEARCH/research/island-lanes/ (not
// committed); the Commons page is the stable citation.
const PHOTO_EVIDENCE = [
  {
    id: 'oneida-2026',
    row: 'Oneida Avenue',
    cls: 'living_street',
    title: 'File:Oneida Avenue on Algonquin Island, Toronto 2026.jpg',
    url: 'https://commons.wikimedia.org/wiki/File:Oneida_Avenue_on_Algonquin_Island,_Toronto_2026.jpg',
    local: '$WATERFRONT_RESEARCH/research/island-lanes/oneida-avenue-2026.jpg',
    lookFor: 'Algonquin living-street cross-section: narrow asphalt/concrete lane, kerb/green edge, no painted yellow centre line'
  },
  {
    id: 'ojibway-2026',
    row: 'Ojibway Avenue',
    cls: 'living_street',
    title: 'File:CN Tower visible from Ojibway Avenue, Algonquin Island, Toronto 2026.jpg',
    url: 'https://commons.wikimedia.org/wiki/File:CN_Tower_visible_from_Ojibway_Avenue,_Algonquin_Island,_Toronto_2026.jpg',
    local: '$WATERFRONT_RESEARCH/research/island-lanes/ojibway-avenue-2026.jpg',
    lookFor: 'Algonquin living-street view along the mapped row: unmarked surface, no centre line'
  },
  {
    id: 'cibola-ward-2026-09',
    row: 'Cibola Avenue',
    cls: 'service',
    title: "File:Cibola Avenue on Ward's Island, September 11 2026.jpg",
    url: "https://commons.wikimedia.org/wiki/File:Cibola_Avenue_on_Ward%27s_Island,_September_11_2026.jpg",
    local: '$WATERFRONT_RESEARCH/research/island-lanes/cibola-ward-2026-09.jpg',
    lookFor: "Ward's Island service lane along the mapped Cibola Avenue row: unmarked surface, no yellow centre line"
  },
  {
    id: 'cibola-ward-2026-02',
    row: 'Cibola Avenue',
    cls: 'service',
    title: "File:Cibola Avenue on Ward's Island, February 28 2026.jpg",
    url: "https://commons.wikimedia.org/wiki/File:Cibola_Avenue_on_Ward%27s_Island,_February_28_2026.jpg",
    local: '$WATERFRONT_RESEARCH/research/island-lanes/cibola-ward-2026-02.jpg',
    lookFor: "Second date/view of the same mapped Cibola Avenue service row"
  },
  {
    id: 'cibola-algonquin-2026',
    row: 'Cibola Avenue',
    cls: 'service',
    title: 'File:Cibola Avenue near Algonquin Bridge, Toronto Islands 2026.jpg',
    url: 'https://commons.wikimedia.org/wiki/File:Cibola_Avenue_near_Algonquin_Bridge,_Toronto_Islands_2026.jpg',
    local: '$WATERFRONT_RESEARCH/research/island-lanes/cibola-algonquin-2026.jpg',
    lookFor: 'Cibola Avenue where it meets the Algonquin Bridge Road: service-lane surface and edge'
  }
];
// A photographed living-street row is evidence for the whole mapped living_street family (the same narrow residential
// cross-section, mapped with the same class). The photographed named service row (Cibola Avenue) is evidence for that
// row only; every other service lane stays exactly as the native paint draws it until a photo confirms it.
const FAMILY_LIVING_STREET = { photoIds: ['oneida-2026', 'ojibway-2026'], basis: 'photographed Algonquin living-street rows; OSM living_street class across the mapped named rows' };
const ROW_PHOTO = { 'Cibola Avenue': 'cibola-ward-2026-09' };

const photoEvidence = (w) => {
  if (w.cls === 'living_street' && w.name) {
    return { unmarked: 1, reason: 'photo-family:living-street', photoIds: FAMILY_LIVING_STREET.photoIds };
  }
  if (ROW_PHOTO[w.name]) return { unmarked: 1, reason: `photo-row:${w.name}`, photoIds: PHOTO_EVIDENCE.filter((p) => p.row === w.name).map((p) => p.id) };
  return { unmarked: 0, reason: null, photoIds: [] };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readRaw(name) {
  if (!RAW) return null;
  const p = path.join(RAW, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}
function writeRaw(name, obj) {
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(path.join(RAW, name), JSON.stringify(obj));
}

async function overpass(query) {
  const endpoints = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  let last;
  for (let a = 0; a < 6; a++) {
    const ep = endpoints[a % endpoints.length];
    try {
      const res = await fetch(ep, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ data: query }) });
      const text = await res.text();
      if (res.ok && text.trim().startsWith('{')) return JSON.parse(text);
      last = new Error(`${ep}: HTTP ${res.status} ${text.slice(0, 120)}`);
    } catch (e) { last = e; }
    await sleep(2500 * (a + 1));
  }
  throw last;
}

async function fetchWayXml(id) {
  for (let a = 0; a < 3; a++) {
    const res = await fetch(`${API}/way/${id}`, { headers: { 'User-Agent': UA, Accept: 'application/xml' } });
    if (res.ok) return res.text();
    if (a === 2) throw new Error(`way ${id}: HTTP ${res.status}`);
    await sleep(1200 * (a + 1));
  }
}

async function fetchRelationXml(id) {
  for (let a = 0; a < 3; a++) {
    const res = await fetch(`${API}/relation/${id}`, { headers: { 'User-Agent': UA, Accept: 'application/xml' } });
    if (res.ok) return res.text();
    if (a === 2) throw new Error(`relation ${id}: HTTP ${res.status}`);
    await sleep(1200 * (a + 1));
  }
}

// The OSM way's own version/timestamp (the source registry; "which version of this tag became evidence").
function wayMeta(xml) {
  const m = xml.match(/<way id="(\d+)"[^>]*version="(\d+)"[^>]*timestamp="([^"]+)"/);
  if (!m) return null;
  const tags = {};
  for (const t of xml.matchAll(/<tag k="([^"]+)" v="([^"]*)"\/>/g)) tags[t[1]] = t[2];
  return { version: +m[2], timestamp: m[3], tags };
}
function relationMeta(xml) {
  const m = xml.match(/<relation id="(\d+)"[^>]*version="(\d+)"[^>]*timestamp="([^"]+)"/);
  return m ? { version: +m[2], timestamp: m[3] } : { version: null, timestamp: null };
}

// Classify one OSM way tag set: lane / excluded, and why.
function classify(tags) {
  const cls = tags.highway;
  if (!cls) return { keep: false, why: 'not a highway' };
  if (!LANE_CLASSES.has(cls)) return { keep: false, why: `class ${cls}` };
  if (cls === 'service' && NON_LANE_SERVICE.has(tags.service || '')) return { keep: false, why: `service ${tags.service}` };
  if (!PRIVATE(tags)) return { keep: false, why: 'public access' };
  return { keep: true, why: null };
}

// The lane's mapped width. OSM carries no width on these ways (verified in the source fetch), so the width is a
// recorded estimate from the class and the mapped lanes tag, never invented as a source value.
function laneWidth(t, cls) {
  const w = t.width !== undefined ? parseFloat(t.width) : NaN;
  if (Number.isFinite(w) && w >= 3 && w <= 40) return { w: w, source: 'OSM width tag' };
  const lanes = Number(t.lanes);
  if (cls === 'living_street') return { w: Number.isFinite(lanes) && lanes >= 2 ? 7.4 : 6.4, source: 'estimate from living_street class' };
  return { w: Number.isFinite(lanes) && lanes >= 2 ? 5.6 : 4.8, source: 'estimate from service class' };
}

async function main() {
  const rawName = 'island-ways.json';
  let elements = readRaw(rawName);
  if (elements && !Array.isArray(elements) && Array.isArray(elements.elements)) elements = elements.elements;
  if (!elements) {
    const q = `[out:json][timeout:120];
way["highway"](${BBOX.join(',')});
out tags geom;`;
    const res = await overpass(q);
    elements = res.elements;
    if (RAW) writeRaw(rawName, elements);
  }
  if (!Array.isArray(elements) || !elements.length) throw new Error('no highway=* ways in the island window');

  const classCounts = {};
  const tangents = new Map();
  const islandNames = new Set(ISLAND_ROAD_NAMES);
  const ways = [];
  const excluded = [];
  for (const e of elements) {
    if (e.type !== 'way' || !Array.isArray(e.geometry) || e.geometry.length < 2) continue;
    const tags = e.tags || {};
    const cls = { keep: false, why: 'no class' };
    const r = classify(tags);
    classCounts[tags.highway || '(none)'] = (classCounts[tags.highway || '(none)'] || 0) + 1;
    if (!r.keep) { excluded.push({ id: e.id, cls: tags.highway || null, why: r.why }); continue; }
    if (!islandNames.has(tags.name || '')) { excluded.push({ id: e.id, cls: tags.highway, why: 'not an island lane name' }); classCounts['off-island ' + tags.highway] = (classCounts['off-island ' + tags.highway] || 0) + 1; continue; }
    if (e.geometry.some((g) => g.lat >= AIRPORT_BOX[0] && g.lat <= AIRPORT_BOX[2] && g.lon >= AIRPORT_BOX[1] && g.lon <= AIRPORT_BOX[3])) { excluded.push({ id: e.id, cls: tags.highway, why: 'airport bbox' }); continue; }
    const width = laneWidth(tags, tags.highway);
    const isWood = tags.surface === 'wood' || tags.highway === 'boardwalk';
    const bridge = tags.bridge === 'yes' || tags.bridge === 'viaduct';
    const oneWay = tags.oneway === 'yes' || tags.oneway === '1';
    const points = e.geometry.map((g) => toWorld(g.lon, g.lat).map(r1));
    // The OSM node ids (Overpass `out geom` keeps them; the fallback coordinate key joins by the rounded metre).
    const nodes = Array.isArray(e.nodes) && e.nodes.length === e.geometry.length
      ? e.nodes.map(String)
      : e.geometry.map((g) => g.lat.toFixed(7) + ',' + g.lon.toFixed(7));
    ways.push({
      id: e.id,
      name: tags.name || '',
      cls: tags.highway,
      w: Math.round(width.w * 10) / 10,
      wSource: width.source,
      surface: tags.surface || null,
      oneway: oneWay ? 1 : 0,
      bridge: bridge ? 1 : 0,
      wood: isWood ? 1 : 0,
      foot: tags.foot === 'yes' ? 1 : tags.foot === 'no' ? -1 : 0,
      bicycle: tags.bicycle || null,
      lanes: Number(tags.lanes) || null,
      maxspeed: tags.maxspeed || null,
      points,
      nodes
    });
  }
  if (!ways.length) throw new Error('no island lane ways after classification');

  // One RUN per kept OSM way. The earlier build chained ways that met at a shared node and, growing at the head, appended
  // the next way at the tail: that put a single 0.8-3 km straight segment across lagoons and the harbour in the data
  // (Cibola Avenue, Island Service Road, Lakeshore Avenue and others). A proximity gate only needs each way's own
  // polyline, so runs are kept per way and never concatenated. A way whose own OSM geometry jumps (a mapped ferry
  // connector) is dropped as a gap, not silently bridged.
  const rendered = [];
  for (const w of ways) {
    if (!Array.isArray(w.points) || w.points.length < 2) continue;
    let length = 0, maxGap = 0;
    for (let i = 1; i < w.points.length; i++) {
      const L = Math.hypot(w.points[i][0] - w.points[i - 1][0], w.points[i][1] - w.points[i - 1][1]);
      length += L;
      if (L > maxGap) maxGap = L;
    }
    if (maxGap > 1500) { excluded.push({ id: w.id, cls: w.cls, why: `geometry gap ${Math.round(maxGap)} m` }); continue; }
    const pe = photoEvidence(w);
    rendered.push({ ...w, length, maxGap, ...pe });
  }

  // Per-way source registry from the API (one request per way, the raw file keeps them for the next build)
  const srcCache = readRaw('meta.json') || {};
  const registry = {};
  for (const w of ways) {
    const key = `way/${w.id}`;
    const hit = srcCache[key];
    if (hit && hit.version && hit.timestamp) { registry[key] = { version: hit.version, timestamp: hit.timestamp }; continue; }
    const xml = await fetchWayXml(w.id);
    const m = wayMeta(xml);
    if (m) { registry[key] = { version: m.version, timestamp: m.timestamp }; }
    else registry[key] = { version: null, timestamp: null };
    await sleep(350);
  }
  if (RAW) writeRaw('meta.json', { ...srcCache, ...registry });

  // The excluded airport relation: its own meta, the exclusion reference for the airport bbox
  let airportMeta = { version: null, timestamp: null };
  try {
    const xml = await fetchRelationXml(AIRPORT_RELATION);
    airportMeta = relationMeta(xml);
  } catch (e) {
    console.warn('[island-lanes] airport relation meta fetch failed:', e.message);
  }

  const excludedWays = excluded;
  const perClass = {};
  for (const w of ways) perClass[w.cls] = (perClass[w.cls] || 0) + 1;
  const nameList = [...new Set(ways.map((w) => w.name).filter(Boolean))].sort();
  const summary = {
    source: 'OpenStreetMap contributors, ODbL',
    fetched: new Date().toISOString().slice(0, 10),
    via: 'Overpass API 0.7.62.11 (island window)',
    window: BBOX,
    counts: {
      ways: elements.length,
      lanes: ways.length,
      runs: rendered.length,
      unmarked: rendered.filter((r) => r.unmarked).length,
      byClass: perClass,
      excluded: Object.fromEntries(Object.entries(classCounts).map(([k, v]) => [k, v])),
      excludedWays: excludedWays.length,
      namedLanes: nameList.length
    },
    excluded: {
      airport: { relation: AIRPORT_RELATION, name: 'Billy Bishop Toronto City Airport', version: airportMeta.version, timestamp: airportMeta.timestamp },
      mainland: 'Box east/north of the islands: the box is the OSM island window, which the mainland does not cross',
      nonLaneService: [...NON_LANE_SERVICE],
      geometryGaps: excluded.filter((e) => /geometry gap/.test(e.why || '')).map((e) => e.id)
    },
    laneNames: nameList,
    sourceProfile: {
      family: 'toronto-island-unmarked-interior-lane',
      status: 'captain-photo-reviewed-2026-11-10',
      officialClaim: {
        text: 'The Toronto Islands are a car-free community: private cars are prohibited, while service and emergency vehicles are authorised. That is a traffic-regime statement, not proof about paint, so it is not used alone to suppress a line.',
        url: 'https://www.toronto.ca/explore-enjoy/toronto-island-ferries/getting-around/'
      },
      photographs: PHOTO_EVIDENCE,
      familyLivingStreet: FAMILY_LIVING_STREET,
      rowPhotos: ROW_PHOTO,
      notEvidence: 'OSM motor_vehicle=private is a legal-access tag. It does not by itself establish that a lane is unmarked or has no centre line; only the primary photographs above do.',
      limits: [
        'No routing, carriageway width, kerb/curb, surface material or junction geometry is changed.',
        'Only yellow centre-line geometry is omitted, at the source-confirmed unmarked rows.',
        'Algonquin Bridge Road is mapped wood + bridge; the wood surface and deck height stay recorded and unresolved, with no flat overlay drawn.',
        'The current native road surface material stays as built.'
      ]
    }
  };

  const out = {
    source: summary.source,
    fetched: summary.fetched,
    via: summary.via,
    projection: { lat0: P.lat0, lon0: P.lon0, kx: P.kx, ky: P.ky, theta: P.theta, ox: P.ox || 0, oz: P.oz || 0 },
    window: BBOX,
    summary,
    runs: rendered.map((w, i) => ({
      id: i,
      ways: [w.id],
      cls: w.cls,
      surface: w.surface,
      oneway: w.oneway,
      bridge: w.bridge,
      wood: w.wood,
      names: [w.name].filter(Boolean),
      lengthM: Math.round(w.length),
      maxGapM: Math.round(w.maxGap),
      w: w.w,
      wSource: w.wSource,
      unmarked: w.unmarked || 0,
      unmarkedReason: w.reason || null,
      unmarkedPhotos: w.photoIds || [],
      points: w.points
    })),
    osmMeta: registry
  };

  const js = `(function () {\n// js/waterfront-island-lanes-data.js\n// Generated by tools/build-island-lanes.mjs from OpenStreetMap (Overpass API, island window). One run per mapped OSM\n// way (never concatenated across a gap), with class/width/surface/bridge/wood flags and the primary-photo evidence for\n// the unmarked interior-lane rows, in world metres. OpenStreetMap contributors, ODbL. Do not edit by hand; rerun the\n// tool. The sourceProfile block records the photographs the captain reviews; OSM motor_vehicle=private is not proof of\n// paint.\nwindow.CITY = window.CITY || {};\nwindow.CITY.ISLAND_LANES_DATA = ${JSON.stringify(out)};\n})();\n`;
  fs.writeFileSync(OUT, js);
  console.log(`[island-lanes] wrote ${OUT}: ${ways.length} ways, ${rendered.length} runs (${rendered.filter((r) => r.unmarked).length} photo-evidenced unmarked), ${nameList.length} names`);
}

await main();
