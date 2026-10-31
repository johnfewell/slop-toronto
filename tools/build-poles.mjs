// tools/build-poles.mjs: js/toronto-poles.js, the City's mapped streetlight & traffic-signal poles in the detail frame,
// from the cut made by tools/fetch-poles.mjs (~/.cache/slop-toronto/poles). node tools/build-poles.mjs [dir] [output.js]
//
// Only the types the city has a model for are written (street light, light + signal, signal, pedestrian light:
// js/street-details.js), and of the miscellaneous poles the unlit hydro poles and the poles holding up the streetcar
// overhead (miscPoles, below: classified on their positions, the source has no finer subtype; `tram` lists the latter);
// the other miscellaneous poles and the hydro towers are counted, not shipped (`misc` counts each class). Each type is its OBJECTIDs (ascending, as deltas) and positions in world
// decimetres (the City's stated accuracy is +-30 cm).
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
export const SHIPPED = [6003, 6004, 6005, 6006, 6008];
const MISC = 6003;

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
  // the miscellaneous poles: only the unlit hydro poles and the streetcar streets' span poles are drawn (with the city
  // to judge them by; none without)
  const misc = GEO ? miscPoles(byType, GEO) : null;
  byType[MISC] = misc ? (byType[MISC] || []).filter((r) => MISC_DRAWN.includes(misc.class.get(r[0]))) : [];
  const types = {};
  for (const code of SHIPPED) {
    const rows = (byType[code] || []).sort((r, s) => r[0] - s[0]);
    types[code] = { name: TYPES[code], ids: rows.map((r, i) => r[0] - (i ? rows[i - 1][0] : 0)), xz: rows.flatMap((r) => [r[1], r[2]]) };
  }
  const looks = GEO ? poleLooks(byType, GEO, misc) : {};
  // the miscellaneous poles that carry the streetcar overhead's span wires (steel, centre and wooden), OBJECTID deltas
  const tram = misc ? byType[MISC].filter((r) => TRAM_CLASSES.includes(misc.class.get(r[0]))).map((r) => r[0]).sort((a, b) => a - b)
    .map((id, i, a) => id - (i ? a[i - 1] : 0)) : null;
  return { source, counts, ...(misc ? { misc: misc.counts, tram } : {}), shipped: SHIPPED, types, looks };
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
// Miscellaneous poles (6003) are the wooden hydro pole unless listed (miscPoles, below):
// - trolley: the TTC's tapered steel span pole beside a streetcar street; trolleyCentre: its centre pole between the
//   tracks, with a bracket arm over each (The Queensway's and Spadina's rights-of-way, Fleet St)
export const LOOKS = ['wood', 'lantern', 'promenade', 'park', 'trolley', 'trolleyCentre'];
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

// rows by type ([id, x dm, z dm]), miscPoles' result -> { look: OBJECTID deltas (ascending) }
export function poleLooks(byType, GEO, misc = null) {
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
  // the streetcar streets' steel poles
  for (const [id] of byType[MISC] || []) {
    const c = misc?.class.get(id);
    if (c === 'trolley' || c === 'trolleyCentre') looks[c].push(id);
  }
  for (const k of LOOKS) looks[k] = looks[k].sort((a, b) => a - b).map((id, i, a) => id - (i ? a[i - 1] : 0));
  return looks;
}

// ---------------------------------------------------------------------------------------------------------------------
// The miscellaneous poles (6003, ~7,200 in the frame). The source says no more than "Miscellaneous Pole": no material,
// owner or height. On the City's 2025 aerials most are the unlit poles of Toronto Hydro's overhead lines (and the
// telecom lines sharing them): down the other side of a street whose lights hang on the line, between its lit poles,
// down laneways and rear lot lines. The rest are other things, told apart by where they stand:
// - dup: within MISC_DUP of a pole drawn already (the same pole mapped twice, or a guy stub beside it)
// - post: three or more within MISC_POST of each other (bollards, a plaza's light posts or art installation, a park
//   edge's posts; a hydro line's poles stand 20-45 m apart); double: the second of a pair within MISC_DOUBLE (a
//   double pole, a stub beside it): one is drawn
// - within MISC_TRAM of a streetcar track: the poles holding up the streetcar overhead, by where they stand
//   (docs/city-open-data-layers.md, *Poles on the streetcar streets*):
//   - trolleyCentre: between two tracks (not a yard's), each within MISC_CENTRE (The Queensway's and Spadina's rights-of-way, Fleet
//     St): the TTC's centre pole, a bracket arm over each track
//   - trolleyYard: else not by a named street (within MISC_STREET): the carhouse yards and the loops, whose overhead the
//     city does not model; not drawn
//   - trolleyWood: beside the street in the neighbourhoods east of the Don (TROLLEY_WOOD: Riverside, Leslieville, East
//     Chinatown, Riverdale), where Toronto Hydro's wooden poles carry the line and the span wires (Queen East, Gerrard,
//     Broadview): the wooden hydro pole
//   - trolley: beside the street anywhere else: the TTC's tapered steel span pole
//   The span wires run from each across the street to the contact wire (js/streetcars.js tramSpans)
// - rail: within MISC_RAIL of a railway and not by a street (signal masts, the corridors' pole lines)
// - park: inside a park, pitch, golf course or cemetery and not by a street (sports-field lights, flag poles)
// - core: in the rebuilt core and waterfront neighbourhoods (MODERN, as the lights' looks: buried services; but not
//   University, whose Huron-Sussex lanes keep their rear-lot line)
// - median: down a median (trolley, sign and signal poles)
// - building: inside a building's footprint (a pole by a wall, the footprint simplified over it)
// - hydro: the rest, drawn as the wooden hydro pole without its light (js/mapped-poles.js)
export const MISC_CLASSES = ['hydro', 'dup', 'post', 'double', 'trolley', 'trolleyWood', 'trolleyCentre', 'trolleyYard', 'rail', 'park',
  'core', 'median', 'building'];
export const MISC_DRAWN = ['hydro', 'trolley', 'trolleyWood', 'trolleyCentre'];
export const TRAM_CLASSES = ['trolley', 'trolleyWood', 'trolleyCentre'];
export const MISC_DUP = 1.2, MISC_DOUBLE = 4, MISC_POST = 7, MISC_TRAM = 9, MISC_RAIL = 15, MISC_STREET = 12, MISC_CENTRE = 2.5; // m
export const TROLLEY_WOOD = ['South Riverdale', 'North Riverdale', 'Playter Estates-Danforth'];
const MISC_CORE = MODERN.filter((name) => name !== 'University');

// rows by type ([id, x dm, z dm]) -> { class: Map(OBJECTID -> class), counts: { class: n } }
export function miscPoles(byType, GEO) {
  const world = (r) => ({ id: r[0], x: r[1] / 10, z: r[2] / 10 });
  const misc = (byType[MISC] || []).map(world);
  const pointGrid = (pts, cell) => {
    const cells = new Map(), key = (i, j) => i * 100000 + j;
    for (const p of pts) { const k = key(Math.floor(p.x / cell), Math.floor(p.z / cell)); (cells.get(k) || cells.set(k, []).get(k)).push(p); }
    return (x, z, r) => {
      const out = [], R = Math.ceil(r / cell), ci = Math.floor(x / cell), cj = Math.floor(z / cell);
      for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++)
        for (const p of cells.get(key(ci + a, cj + b)) || []) if (Math.hypot(p.x - x, p.z - z) < r) out.push(p);
      return out;
    };
  };
  // segments [ax, az, bx, bz] in 40 m cells: the distance from (x, z) to the nearest within r, or Infinity
  const segGrid = (segs) => {
    const cells = new Map(), key = (i, j) => i * 100000 + j;
    for (const s of segs)
      for (let a = Math.floor(Math.min(s[0], s[2]) / 40); a <= Math.floor(Math.max(s[0], s[2]) / 40); a++)
        for (let b = Math.floor(Math.min(s[1], s[3]) / 40); b <= Math.floor(Math.max(s[1], s[3]) / 40); b++)
          (cells.get(key(a, b)) || cells.set(key(a, b), []).get(key(a, b))).push(s);
    return (x, z, r) => {
      let d = Infinity;
      const R = Math.ceil(r / 40), ci = Math.floor(x / 40), cj = Math.floor(z / 40);
      for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) for (const [ax, az, bx, bz] of cells.get(key(ci + a, cj + b)) || []) {
        const ex = bx - ax, ez = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
        d = Math.min(d, Math.hypot(ax + ex * t - x, az + ez * t - z));
      }
      return d < r ? d : Infinity;
    };
  };
  const segsOf = (flat) => { const out = []; for (let i = 0; i + 3 < flat.length; i += 2) out.push([flat[i], flat[i + 1], flat[i + 2], flat[i + 3]]); return out; };
  const streets = segGrid(GEO.roads.filter((r) => r[0] && !r[5]).flatMap((r) => segsOf(r[6])));
  const trams = segGrid(GEO.rails.filter((r) => r[0] === 0).flatMap((r) => segsOf(r[4])));
  // (the tracks through the streets: not the carhouse yards')
  const tramSegs = GEO.rails.filter((r) => r[0] === 0 && r[1] !== 'yard').flatMap((r) => segsOf(r[4]));
  // between two tracks: a track within MISC_CENTRE on either side (by the nearest segment's direction)
  const tramNear = (() => {
    const cells = new Map(), key = (i, j) => i * 100000 + j;
    for (const s of tramSegs) for (let a = Math.floor(Math.min(s[0], s[2]) / 20); a <= Math.floor(Math.max(s[0], s[2]) / 20); a++)
      for (let b = Math.floor(Math.min(s[1], s[3]) / 20); b <= Math.floor(Math.max(s[1], s[3]) / 20); b++) (cells.get(key(a, b)) || cells.set(key(a, b), []).get(key(a, b))).push(s);
    return (x, z) => {
      const out = [];
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const s of cells.get(key(Math.floor(x / 20) + a, Math.floor(z / 20) + b)) || []) out.push(s);
      return out;
    };
  })();
  const betweenTracks = (x, z) => {
    let ref = null, rd = MISC_CENTRE;
    const near = tramNear(x, z).map(([ax, az, bx, bz]) => {
      const ex = bx - ax, ez = bz - az, L = Math.hypot(ex, ez) || 1, t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (L * L)));
      const d = Math.hypot(ax + ex * t - x, az + ez * t - z);
      return { d, ux: ex / L, uz: ez / L, side: Math.sign(ex * (z - az) - ez * (x - ax)), inside: t > 0 && t < 1 };
    }).filter((s) => s.d < MISC_CENTRE && s.inside);
    for (const s of near) if (s.d < rd) { rd = s.d; ref = s; }
    if (!ref) return false;
    // the side of each track it stands, in the nearest track's sense
    return near.some((s) => s !== ref && Math.abs(s.ux * ref.ux + s.uz * ref.uz) > 0.9 && s.side * Math.sign(s.ux * ref.ux + s.uz * ref.uz) === -ref.side);
  };
  const woodHoods = GEO.districtBounds.filter(([name]) => TROLLEY_WOOD.includes(name)).map((b) => bboxed(b[1]));
  const railways = segGrid(GEO.rails.filter((r) => r[0] === 1).flatMap((r) => segsOf(r[4])));
  function bboxed(flat) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < flat.length; i += 2) { x0 = Math.min(x0, flat[i]); x1 = Math.max(x1, flat[i]); z0 = Math.min(z0, flat[i + 1]); z1 = Math.max(z1, flat[i + 1]); }
    return { flat, x0, x1, z0, z1 };
  }
  const inAny = (polys) => (x, z) => polys.some((p) => x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1 && inPoly(p.flat, x, z));
  const inPark = inAny(GEO.areas.filter((a) => PARKS.has(a[0])).map((a) => bboxed(a[2])));
  const inCore = inAny(GEO.districtBounds.filter(([name]) => MISC_CORE.includes(name)).map((b) => bboxed(b[1])));
  const onMedian = inAny(GEO.blocks.filter((b) => b[5]).map((b) => bboxed(b[0])));
  // building footprints (cx, cz, angle, [[u0, u1, v0, v1]] about the centre), 0.2 m in from their walls
  const parts = [];
  for (const [cx, cz, ang, rects] of GEO.buildings) for (const [u0, u1, v0, v1] of rects) {
    const cs = Math.cos(ang), sn = Math.sin(ang), r = Math.hypot(Math.max(-u0, u1), Math.max(-v0, v1));
    parts.push({ x: cx, z: cz, cs, sn, u0, u1, v0, v1, r });
  }
  const partsNear = pointGrid(parts, 64);
  const inBuilding = (x, z) => partsNear(x, z, 200).some((p) => {
    if (Math.hypot(p.x - x, p.z - z) > p.r + 0.5) return false;
    const dx = x - p.x, dz = z - p.z, u = dx * p.cs - dz * p.sn, v = dx * p.sn + dz * p.cs;
    return u > p.u0 + 0.2 && u < p.u1 - 0.2 && v > p.v0 + 0.2 && v < p.v1 - 0.2;
  });
  const drawn = pointGrid([6004, 6005, 6006, 6008].flatMap((c) => (byType[c] || []).map(world)), 16);
  const others = pointGrid(misc, 16);

  const cls = new Map();
  for (const p of misc) {
    if (drawn(p.x, p.z, MISC_DUP).length) { cls.set(p.id, 'dup'); continue; }
    // the poles that close to it (with it): three or more a row or cluster of posts; a pair one pole, drawn once
    const close = others(p.x, p.z, MISC_POST);
    if (close.length >= 3 || close.some((q) => q !== p && others(q.x, q.z, MISC_POST).length >= 3)) { cls.set(p.id, 'post'); continue; }
    if (others(p.x, p.z, MISC_DOUBLE).some((q) => q.id < p.id)) { cls.set(p.id, 'double'); continue; }
    const street = streets(p.x, p.z, MISC_STREET) < MISC_STREET;
    cls.set(p.id, trams(p.x, p.z, MISC_TRAM) < MISC_TRAM ? (betweenTracks(p.x, p.z) ? 'trolleyCentre' : !street ? 'trolleyYard'
      : inAny(woodHoods)(p.x, p.z) ? 'trolleyWood' : 'trolley')
      : !street && railways(p.x, p.z, MISC_RAIL) < MISC_RAIL ? 'rail'
        : !street && inPark(p.x, p.z) ? 'park'
          : inCore(p.x, p.z) ? 'core'
            : onMedian(p.x, p.z) ? 'median'
              : inBuilding(p.x, p.z) ? 'building' : 'hydro');
  }
  const counts = Object.fromEntries(MISC_CLASSES.map((k) => [k, 0]));
  for (const c of cls.values()) counts[c]++;
  return { class: cls, counts };
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
  console.log(`[poles] in the detail frame: ${Object.entries(data.counts).map(([c, n]) => `${n} ${TYPES[c]}`).join(', ')}; shipped ${SHIPPED.join(', ')}; looks ${LOOKS.map((k) => `${data.looks[k].length} ${k}`).join(', ')}; miscellaneous ${JSON.stringify(data.misc)}`);
  if (path.resolve(output) === path.join(ROOT, 'js/toronto-poles.js')) {
    const packed = packGeodata();
    console.log(`[poles] repacked data/toronto-geodata.bin (${packed.file.length} bytes, hash ${packed.hash})`);
  }
}
