// tools/build-poles.mjs: js/toronto-poles.js, the City's mapped streetlight & traffic-signal poles in the detail frame,
// from the cut made by tools/fetch-poles.mjs (~/.cache/slop-toronto/poles). node tools/build-poles.mjs [dir] [output.js]
//
// Only the types the city has a model for are written (street light, light + signal, signal, pedestrian light:
// js/street-details.js); miscellaneous (mostly utility) poles and hydro towers are counted, not shipped. Each type is
// its OBJECTIDs (ascending, as deltas) and positions in world decimetres (the City's stated accuracy is +-30 cm).
// `looks` (poleLooks, below) names the model each pole is drawn with where it is not its type's default: the street
// lights on wooden hydro poles, the Distillery's lantern posts and the pedestrian lights' three lamp posts. The source
// has no material or style field, so these are rules on its positions, the roads and the neighbourhoods
// (docs/city-open-data-layers.md).
// The site does not load the script: it ships packed in data/toronto-geodata.bin beside GEO (tools/geo-bin.mjs), so
// writing the committed script also repacks that file (tools/pack-geodata.mjs) and sets its hash in explore.html. The
// script stays the node tools' and tests' copy.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { packGeodata } from './pack-geodata.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const TYPES = {
  6001: 'Circular Hydro Tower', 6003: 'Miscellaneous Pole', 6004: 'Pedestrian Light Pole',
  6005: 'Street Light and Traffic Signal Pole', 6006: 'Street Light Pole', 6008: 'Traffic Signal Pole'
};
export const SHIPPED = [6004, 6005, 6006, 6008];

export function buildPoles(geojson, frame, source, GEO = null) {
  const { projection: p, detail: b } = frame;
  const counts = {}, byType = {}, ids = new Set();
  for (const { properties: a, geometry: g } of geojson.features) {
    const code = Number(a.SUBTYPE_CODE);
    if (!TYPES[code] || TYPES[code] !== a.SUBTYPE_DESC) throw new Error(`Unknown pole subtype ${a.SUBTYPE_CODE} ${a.SUBTYPE_DESC}`);
    const pts = g?.type === 'MultiPoint' ? g.coordinates : g?.type === 'Point' ? [g.coordinates] : null;
    if (!pts || pts.length !== 1) throw new Error(`Pole ${a.OBJECTID}: expected one point`);
    const [lon, lat] = pts[0];
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -80 || lon > -79 || lat < 43 || lat > 44) throw new Error(`Pole ${a.OBJECTID}: invalid coordinate`);
    const e = (lon - p.lon0) * p.kx, n = (lat - p.lat0) * p.ky;
    const x = e * Math.cos(p.theta) - n * Math.sin(p.theta) - p.ox;
    const z = -(e * Math.sin(p.theta) + n * Math.cos(p.theta)) - p.oz;
    if (!(x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1)) continue;
    const id = Number(a.OBJECTID);
    if (!Number.isInteger(id) || ids.has(id)) throw new Error(`Missing/duplicate pole OBJECTID ${a.OBJECTID}`);
    ids.add(id);
    counts[code] = (counts[code] || 0) + 1;
    if (SHIPPED.includes(code)) (byType[code] ||= []).push([id, Math.round(x * 10), Math.round(z * 10)]);
  }
  const types = {};
  for (const code of SHIPPED) {
    const rows = (byType[code] || []).sort((r, s) => r[0] - s[0]);
    types[code] = { name: TYPES[code], ids: rows.map((r, i) => r[0] - (i ? rows[i - 1][0] : 0)), xz: rows.flatMap((r) => [r[1], r[2]]) };
  }
  const looks = GEO ? poleLooks(byType, GEO) : {};
  return { source, counts, shipped: SHIPPED, types, looks };
}

// ---------------------------------------------------------------------------------------------------------------------
// The looks. Street light poles (6006) are galvanised steel unless listed:
// - wood: on a wooden hydro pole (a crossarm with the distribution line's insulators, the LED head on a bracket below).
//   Toronto Hydro hangs the lights of the older residential streets on the cedar poles of the overhead line, one pole
//   every ~25-35 m down one side of the street (its ~96,000 wooden poles), while streets with buried services have
//   steel or concrete standards on both sides. So: a light by a local street (residential, unclassified, living street,
//   tertiary, laneway) whose lights along that street (the same name, within WOOD_RADIUS) stand >= WOOD_SHARE on its
//   own side, at least WOOD_MIN of them, outside the rebuilt core and waterfront neighbourhoods (MODERN)
// - lantern: in the Distillery District's lanes (DISTILLERY), the black heritage lantern posts
// Pedestrian light poles (6004) are one of three lamp posts, by place:
// - promenade: the waterfront's slim modern posts, within PROMENADE_QQ of Queens Quay, or in the MODERN_PED neighbourhoods
// - park: a park lamp, inside a park, pitch, golf course or cemetery
// - lantern: the heritage lantern post everywhere else (Old Town, Cabbagetown, the Danforth, St. James Town...)
export const LOOKS = ['wood', 'lantern', 'promenade', 'park'];
const LOCAL = new Set(['residential', 'unclassified', 'living_street', 'tertiary', 'service']);
export const WOOD_RADIUS = 90, WOOD_SHARE = 0.8, WOOD_MIN = 3, WOOD_ROAD = 14; // m, share, lights, m to the street
const MODERN = ['Financial', 'Yonge-Bay Corridor', 'Wellington Place', 'Harbourfront-CityPlace', 'St Lawrence-East Bayfront-The Islands',
  'Downtown Yonge East', 'Bay-Cloverhill', 'Fort York-Liberty Village', 'Regent Park', 'University', 'Humber Bay Shores'];
const MODERN_PED = ['Harbourfront-CityPlace', 'Fort York-Liberty Village', 'Humber Bay Shores', 'Wellington Place', 'Regent Park'];
const PROMENADE_QQ = 250; // m
const PARKS = new Set(['park', 'pitch', 'golf', 'cemetery']);
// Parliament St to Cherry St, south of Mill St's south curb to the rail corridor (lat, lon)
export const DISTILLERY = [[43.65085, -79.3624], [43.65135, -79.3572], [43.6491, -79.3572], [43.6493, -79.3624]];
const DISTILLERY_STREETS = new Set(['Mill Street', 'Parliament Street', 'Cherry Street', 'Front Street East']);

function inPoly(flat, x, z) {
  let c = false;
  for (let i = 0, j = flat.length / 2 - 1; i < flat.length / 2; j = i++) {
    const xi = flat[2 * i], zi = flat[2 * i + 1], xj = flat[2 * j], zj = flat[2 * j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

// rows by type ([id, x dm, z dm]) -> { look: OBJECTID deltas (ascending) }
export function poleLooks(byType, GEO) {
  const p = GEO.frame.projection;
  const world = ([lat, lon]) => {
    const e = (lon - p.lon0) * p.kx, n = (lat - p.lat0) * p.ky;
    return [e * Math.cos(p.theta) - n * Math.sin(p.theta) - p.ox, -(e * Math.sin(p.theta) + n * Math.cos(p.theta)) - p.oz];
  };
  const distillery = DISTILLERY.flatMap(world);
  const hoods = (names) => GEO.districtBounds.filter(([name]) => names.includes(name)).map((b) => b[1]);
  const modern = hoods(MODERN), modernPed = hoods(MODERN_PED);
  const parks = GEO.areas.filter((a) => PARKS.has(a[0])).map((a) => a[2]);
  // the at-grade roads' segments, in 40 m cells
  const cells = new Map(), key = (i, j) => i * 100000 + j;
  for (const [name, , , , , raised, flat, cls] of GEO.roads) {
    if (raised) continue;
    for (let i = 0; i + 3 < flat.length; i += 2) {
      const s = { name, cls, ax: flat[i], az: flat[i + 1], bx: flat[i + 2], bz: flat[i + 3] };
      for (let a = Math.floor(Math.min(s.ax, s.bx) / 40); a <= Math.floor(Math.max(s.ax, s.bx) / 40); a++)
        for (let b = Math.floor(Math.min(s.az, s.bz) / 40); b <= Math.floor(Math.max(s.az, s.bz) / 40); b++)
          (cells.get(key(a, b)) || cells.set(key(a, b), []).get(key(a, b))).push(s);
    }
  }
  const segDist = (s, x, z) => {
    const ex = s.bx - s.ax, ez = s.bz - s.az;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / (ex * ex + ez * ez || 1)));
    return Math.hypot(s.ax + ex * t - x, s.az + ez * t - z);
  };
  const nearestRoad = (x, z, within, ok = () => true) => {
    let best = null, bd = within;
    const R = Math.ceil(within / 40);
    for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) {
      for (const s of cells.get(key(Math.floor(x / 40) + a, Math.floor(z / 40) + b)) || []) {
        if (!ok(s)) continue;
        const d = segDist(s, x, z);
        if (d < bd) { bd = d; best = s; }
      }
    }
    return best;
  };
  const side = (s, x, z) => Math.sign((s.bx - s.ax) * (z - s.az) - (s.bz - s.az) * (x - s.ax));
  const looks = Object.fromEntries(LOOKS.map((k) => [k, []]));

  // street lights: their streets first
  const lights = (byType[6006] || []).map(([id, x, z]) => ({ id, x: x / 10, z: z / 10 }));
  const lightCells = new Map();
  for (const l of lights) {
    l.road = nearestRoad(l.x, l.z, WOOD_ROAD);
    const k = key(Math.floor(l.x / WOOD_RADIUS), Math.floor(l.z / WOOD_RADIUS));
    (lightCells.get(k) || lightCells.set(k, []).get(k)).push(l);
  }
  for (const l of lights) {
    if (inPoly(distillery, l.x, l.z) && !(l.road && DISTILLERY_STREETS.has(l.road.name))) { looks.lantern.push(l.id); continue; }
    const r = l.road;
    if (!r || !LOCAL.has(r.cls) || !r.name) continue;
    let n = 0, same = 0;
    const own = side(r, l.x, l.z);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      for (const m of lightCells.get(key(Math.floor(l.x / WOOD_RADIUS) + a, Math.floor(l.z / WOOD_RADIUS) + b)) || []) {
        if (!m.road || m.road.name !== r.name || Math.hypot(m.x - l.x, m.z - l.z) >= WOOD_RADIUS) continue;
        n++;
        if (side(r, m.x, m.z) === own) same++;
      }
    }
    if (n < WOOD_MIN || same / n < WOOD_SHARE) continue;
    if (modern.some((poly) => inPoly(poly, l.x, l.z))) continue;
    looks.wood.push(l.id);
  }
  // pedestrian lights: by place
  for (const [id, xd, zd] of byType[6004] || []) {
    const x = xd / 10, z = zd / 10;
    const look = nearestRoad(x, z, PROMENADE_QQ, (s) => /^Queens Quay/.test(s.name)) ? 'promenade'
      : parks.some((poly) => inPoly(poly, x, z)) ? 'park'
        : modernPed.some((poly) => inPoly(poly, x, z)) ? 'promenade' : 'lantern';
    looks[look].push(id);
  }
  for (const k of LOOKS) looks[k] = looks[k].sort((a, b) => a - b).map((id, i, a) => id - (i ? a[i - 1] : 0));
  return looks;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] || process.env.POLES || path.join(os.homedir(), '.cache/slop-toronto/poles');
  const output = process.argv[3] || path.join(ROOT, 'js/toronto-poles.js');
  const context = { window: { CITY: {} } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/toronto-geodata.js'), 'utf8'), context);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'poles-4326.gpkg.json'), 'utf8'));
  const source = { package: meta.package, url: 'https://open.toronto.ca/dataset/topographic-mapping-poles/', resourceId: meta.resourceId,
    resource: meta.name, updatedAt: meta.lastModified, sha256: meta.sha256, fetchedAt: meta.fetchedAt, licence: 'open-government-licence-toronto',
    note: 'Digitized from aerial imagery, +-30 cm; poles beside tall buildings or in deep shadow may be missing. No heights in the source.' };
  const data = buildPoles(JSON.parse(fs.readFileSync(path.join(dir, 'poles-detail-4326.geojson'), 'utf8')), context.window.CITY.GEO.frame, source, context.window.CITY.GEO);
  fs.writeFileSync(output, '// GENERATED by tools/build-poles.mjs from the City of Toronto\'s Topographic Mapping - Poles (Open Government Licence - Toronto).\n' +
    '(function () { window.CITY = window.CITY || {}; window.CITY.POLES = ' + JSON.stringify(data) + '; })();\n');
  console.log(`[poles] in the detail frame: ${Object.entries(data.counts).map(([c, n]) => `${n} ${TYPES[c]}`).join(', ')}; shipped ${SHIPPED.join(', ')}; looks ${LOOKS.map((k) => `${data.looks[k].length} ${k}`).join(', ')}`);
  if (path.resolve(output) === path.join(ROOT, 'js/toronto-poles.js')) {
    const packed = packGeodata();
    console.log(`[poles] repacked data/toronto-geodata.bin (${packed.file.length} bytes, hash ${packed.hash})`);
  }
}
