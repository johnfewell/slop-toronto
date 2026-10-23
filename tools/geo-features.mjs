// Part 5: buildings (real OpenStreetMap footprints), districts, landmarks and the parkland on each block.
//
// Buildings: every footprint in the detailed city, fitted with its minimum-area rectangle; footprints that aren't
// rectangles are covered by up to five rectangles in that rectangle's frame (L, T & U plans, courtyards). Heights come
// from the map's height / building:levels where mapped (about one footprint in fifty); otherwise they are ESTIMATED,
// deterministically, from the footprint's size, its building type and its district (see estimateLevels): most of the
// city is one and two-storey houses behind compound walls, the Central Business District rises higher.
import { toWorld, ringArea, rdpRing, centroid, bbox, load, log } from './geo-base.mjs';
import { inDetail } from './geo-roads.mjs';
import { elemRings, areas } from './geo-land.mjs';
import { blocks, blockRaster as R, blockLabels as lab, maskRects } from './geo-blocks.mjs';

const osmBuildings = load('osm_buildings.json');
const osmPlaces = load('osm_places.json');
const q = (v) => Math.round(v * 10) / 10;
const q3 = (v) => Math.round(v * 1000) / 1000;
// deterministic 0..1 from a number
const hash = (n) => {
  let x = Math.imul((n ^ 0x9e3779b9) >>> 0, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
};

// ---------------------------------------------------------------------------------------------------------------------
// Districts: the mapped district & suburb points; a place belongs to the nearest
// ---------------------------------------------------------------------------------------------------------------------
const placeOf = (e) => {
  const g = e.geometry || (e.members || []).flatMap((m) => m.geometry || []);
  if (e.type === 'node') return toWorld(e.lon, e.lat);
  return g.length ? centroid(g.map((p) => toWorld(p.lon, p.lat))) : null;
};
export const districts = [];
for (const e of osmPlaces.elements) {
  const t = e.tags || {};
  if (e.type !== 'node' || !/^(suburb|district|quarter|neighbourhood)$/.test(t.place || '') || !t.name) continue;
  const [x, z] = toWorld(e.lon, e.lat);
  if (!inDetail(x, z, 1500)) continue;
  // 'Maitama District' reads 'Maitama' on the signs; the Central Business District keeps its full name
  const name = t.name === 'Central Business District' ? t.name : t.name.replace(/ District$/, '').trim();
  districts.push({ name, x: q(x), z: q(z) });
}
// The Three Arms Zone (the Presidency, the National Assembly & the Supreme Court, at the foot of Aso Rock) isn't a
// mapped place: its point is the centre of the three seats of government
{
  const seats = [];
  for (const e of [...osmPlaces.elements, ...osmBuildings.elements]) {
    const n = (e.tags || {}).name || '';
    if (/^(National Assembly of Nigeria|Supreme Court of Nigeria|Aso Rock Presidential Villa)$/.test(n) && !seats.some((s) => s.n === n)) {
      const p = placeOf(e);
      if (p && Number.isFinite(p[0])) seats.push({ n, p });
    }
  }
  if (seats.length >= 2) {
    const [x, z] = centroid(seats.map((s) => s.p));
    districts.push({ name: 'Three Arms Zone', x: q(x), z: q(z), r: 1300 });
  }
}
log(`${districts.length} districts: ${districts.map((d) => d.name).join(', ')}`);
// District boundaries as mapped (OpenStreetMap admin_level 7: Garki I & II, Wuse, Maitama...): [name, ring]
export const districtBounds = [];
for (const e of load('osm_districts.json').elements) {
  const name = (e.tags.name || '').replace(/ District$/, '').trim();
  for (const ring of elemRings(e)) districtBounds.push({ name: name === 'Central Business' ? 'Central Business District' : name, ring: rdpRing(ring, 6) });
}
log(`${districtBounds.length} district boundary rings: ${[...new Set(districtBounds.map((d) => d.name))].join(', ')}`);
const inRing = (x, z, r) => {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
// The Three Arms Zone (within 900 m of the seats of government), else the mapped district boundary around the point,
// else the nearest district point
export function districtAt(x, z) {
  const taz = districts.find((d) => d.r);
  if (taz && Math.hypot(taz.x - x, taz.z - z) < 900) return taz.name;
  const hit = districtBounds.find((d) => inRing(x, z, d.ring));
  if (hit) return hit.name;
  let best = null, bd = Infinity;
  for (const d of districts) {
    if (d.r) continue;
    const dist = Math.hypot(d.x - x, d.z - z);
    if (dist < bd) { bd = dist; best = d; }
  }
  return best ? best.name : '';
}

// ---------------------------------------------------------------------------------------------------------------------
// Geometry: convex hull, minimum-area rectangle
// ---------------------------------------------------------------------------------------------------------------------
function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const v of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], v) <= 0) lo.pop(); lo.push(v); }
  for (let i = p.length - 1; i >= 0; i--) { const v = p[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], v) <= 0) hi.pop(); hi.push(v); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
// Minimum-area rectangle: { cx, cz, ang (three.js yaw: local +x = (cos ang, -sin ang)), w (along local x), d }
export function minRect(ring) {
  const H = hull(ring);
  let best = null;
  for (let i = 0; i < H.length; i++) {
    const [x0, z0] = H[i], [x1, z1] = H[(i + 1) % H.length];
    const L = Math.hypot(x1 - x0, z1 - z0);
    if (L < 1e-6) continue;
    const ux = (x1 - x0) / L, uz = (z1 - z0) / L;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of H) {
      const a = x * ux + z * uz, b = -x * uz + z * ux;
      a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
    }
    const area = (a1 - a0) * (b1 - b0);
    if (!best || area < best.area) {
      const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2;
      best = { area, cx: ca * ux - cb * uz, cz: ca * uz + cb * ux, w: a1 - a0, d: b1 - b0, ux, uz };
    }
  }
  // turn so the long side is local x, and the yaw stays within ±90°
  let { ux, uz, w, d } = best;
  if (d > w) { [w, d] = [d, w]; [ux, uz] = [-uz, ux]; }
  if (ux < 0) { ux = -ux; uz = -uz; }
  return { cx: best.cx, cz: best.cz, w, d, ux, uz, ang: Math.atan2(-uz, ux), area: w * d };
}

// ---------------------------------------------------------------------------------------------------------------------
// Height estimate where the map has none
// ---------------------------------------------------------------------------------------------------------------------
const SMALL = /^(hut|shed|roof|kiosk|garage|garages|carport|container|toilets|guardhouse|cabin|farm_auxiliary|barn|service|transformer_tower)$/;
const HOUSE = /^(house|detached|semidetached_house|terrace|bungalow|residential)$/;
const BUSINESS = /^(commercial|office|retail|hotel|government|public|civic|bank|supermarket)$/;
function estimateLevels(type, area, district, rnd) {
  const cbd = district === 'Central Business District' || district === 'Three Arms Zone';
  if (SMALL.test(type) || area < 30) return 1;
  if (type === 'apartments') return area > 900 ? 4 + Math.floor(rnd * 3) : 3 + Math.floor(rnd * 2);
  if (HOUSE.test(type)) return area < 160 ? 1 : area < 500 ? (rnd < 0.55 ? 2 : 1) : (rnd < 0.7 ? 2 : 3);
  if (BUSINESS.test(type) || cbd) {
    if (area < 400) return 2 + Math.floor(rnd * 2);
    if (area < 1500) return (cbd ? 3 : 2) + Math.floor(rnd * (cbd ? 5 : 3));
    if (area < 5000) return (cbd ? 4 : 3) + Math.floor(rnd * (cbd ? 7 : 4));
    return 3 + Math.floor(rnd * 5);
  }
  if (/^(school|university|college|hospital|church|mosque|religious|stadium|warehouse|industrial|train_station)$/.test(type)) {
    return area < 600 ? 1 + Math.floor(rnd * 2) : 2 + Math.floor(rnd * 2);
  }
  // building=yes, the bulk of the imported footprints
  if (area < 110) return 1;
  if (area < 320) return rnd < 0.62 ? 1 : 2;
  if (area < 800) return rnd < 0.62 ? 2 : rnd < 0.9 ? 1 : 3;
  if (area < 2500) return 2 + Math.floor(rnd * 3);
  return 2 + Math.floor(rnd * 4);
}
const parseLevels = (v) => {
  const m = /\d+(\.\d+)?/.exec(String(v || ''));
  return m ? Math.max(1, Math.round(parseFloat(m[0]))) : null;
};

// ---------------------------------------------------------------------------------------------------------------------
// Landmarks: the real outlines of the places the city is known by (landmarks.js models them; the generic buildings
// leave their footprints alone)
// ---------------------------------------------------------------------------------------------------------------------
// [OSM name, id in the sim, how: 'self' (the feature's own outline) | 'largest' (the largest building inside it)]
const LANDMARK_DEFS = [
  ['CN Tower', 'cnTower', 'self'],
  ['Rogers Centre', 'rogersCentre', 'self'],
  ['Union Station', 'unionStation', 'building'],
  ['Toronto City Hall', 'cityHall', 'building'],
  ['Nathan Phillips Square', 'nathanPhillips', 'self'],
  ['Royal Ontario Museum', 'rom', 'building'],
  ['Ontario Place', 'ontarioPlace', 'self'],
  ['Ontario Place Cinesphere', 'cinesphere', 'building'],
  ['St. Lawrence Market South', 'stLawrence', 'building'],
  ['Distillery District', 'distillery', 'self'],
  ["Canada's Sugar Beach", 'sugarBeach', 'self'],
  ['Harbourfront Centre', 'harbourfront', 'self'],
  ['Toronto Music Garden', 'musicGarden', 'self'],
  ['Scotiabank Arena', 'scotiabankArena', 'building'],
  ['Ontario Legislative Building', 'legislature', 'building'],
  ['Centre Island', 'centreIsland', 'self'],
  ['Trinity Bellwoods Park', 'trinityBellwoods', 'self'],
  ['High Park', 'highPark', 'self'],
  ['Kensington Market', 'kensington', 'self'],
  ['Exhibition Place', 'exhibitionPlace', 'self'],
  ['Fairmont Royal York Hotel', 'royalYork', 'building'],
  ['Gooderham Building', 'flatiron', 'building'],
  ["Princes' Gates", 'princesGates', 'building']
];
// The landmarks landmarks.js models itself (by hand, from the City's 3D Massing multipatch in toronto-landmarks.js, or
// John's ROM model): the massing boxes inside their outlines are left out
const MODELLED = new Set(['cnTower', 'rogersCentre', 'cityHall', 'unionStation', 'legislature', 'scotiabankArena', 'stLawrence', 'cinesphere',
  'royalYork', 'flatiron', 'princesGates', 'rom']);
const footprints = []; // every building outline (world rings) with its element, for 'largest'
const footprintOf = new Map(); // element key -> footprint
for (const e of osmBuildings.elements) {
  const t = e.tags || {};
  for (const ring of elemRings(e)) {
    const [cx, cz] = centroid(ring);
    if (!inDetail(cx, cz, 100)) continue;
    const f = { e, t, ring, cx, cz, area: Math.abs(ringArea(ring)) };
    footprints.push(f);
    footprintOf.set(`${e.type}${e.id}`, f);
  }
}
const pointInRing = (x, z, r) => {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const landmarkFootprints = new Set();
export const landmarks = {};
{
  const all = [...osmPlaces.elements, ...load('osm_land.json').elements, ...osmBuildings.elements];
  const findEl = (name, wantBuilding) => all.find((e) => (e.tags || {}).name === name && e.type !== 'node' && (!wantBuilding || (e.tags || {}).building));
  for (const [name, id, how] of LANDMARK_DEFS) {
    let ring = null, tags = {};
    if (how === 'point') {
      const n = osmPlaces.elements.find((e) => (e.tags || {}).name === name && e.type === 'node');
      if (n) {
        const [x, z] = toWorld(n.lon, n.lat);
        landmarks[id] = { name, x: q(x), z: q(z) };
      }
      continue;
    }
    const el = findEl(name, how === 'building');
    if (!el) { log(`landmark not found: ${name}`); continue; }
    tags = el.tags || {};
    const rings = elemRings(el);
    if (!rings.length) { log(`landmark without outline: ${name}`); continue; }
    ring = rings.reduce((a, r) => (Math.abs(ringArea(r)) > Math.abs(ringArea(a)) ? r : a));
    if (how === 'largest') {
      let best = null;
      for (const f of footprints) if (pointInRing(f.cx, f.cz, ring) && (!best || f.area > best.area)) best = f;
      if (best) {
        ring = best.ring;
        tags = { ...best.t, name };
        if (MODELLED.has(id)) landmarkFootprints.add(best);
      }
    } else if (how === 'building') {
      const f = footprintOf.get(`${el.type}${el.id}`);
      if (f && MODELLED.has(id)) landmarkFootprints.add(f);
    }
    if (how === 'self' && MODELLED.has(id)) landmarkFootprints.add({ ring });
    const s = rdpRing(ring, 0.3);
    if (ringArea(s) > 0) s.reverse();
    const r = minRect(s);
    landmarks[id] = {
      name, x: q(r.cx), z: q(r.cz), w: q(r.w), d: q(r.d), ang: q3(r.ang), area: Math.round(Math.abs(ringArea(s))),
      h: tags.height ? parseFloat(tags.height) : null, levels: parseLevels(tags['building:levels']),
      ring: s.flatMap(([x, z]) => [q(x), q(z)])
    };
  }
  log(`${Object.keys(landmarks).length} landmarks: ${Object.keys(landmarks).join(', ')}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------------------------------------------------
// Share of a rectangle's sample points that fall off the blocks (on a roadway or in the water)
function offBlocks(r) {
  let off = 0, n = 0;
  for (const fu of [-0.4, 0, 0.4]) {
    for (const fv of [-0.4, 0, 0.4]) {
      const x = r.cx + r.ux * r.w * fu - r.uz * r.d * fv;
      const z = r.cz + r.uz * r.w * fu + r.ux * r.d * fv;
      const i = Math.floor((x - R.x0) / R.res), j = Math.floor((z - R.z0) / R.res);
      n++;
      if (i < 0 || j < 0 || i >= R.w || j >= R.h || !lab[j * R.w + i]) off++;
    }
  }
  return off / n;
}
export const buildings = [];
const stats = { tagged: 0, estimated: 0, dropped: 0, multi: 0, joined: 0 };
// Toronto: the City's 3D Massing parts (tools/fetch-massing.mjs) are the buildings, each standing at its lidar height;
// a tower and its podium are separate parts. OpenStreetMap only lends the building type and name (the footprint the
// part's centre falls in).
const osmGrid = new Map();
const cellKey = (x, z) => `${Math.floor(x / 50)},${Math.floor(z / 50)}`;
for (const f of footprints) {
  const b = bbox(f.ring);
  for (let i = Math.floor(b.x0 / 50); i <= Math.floor(b.x1 / 50); i++) for (let j = Math.floor(b.z0 / 50); j <= Math.floor(b.z1 / 50); j++) {
    const k = `${i},${j}`;
    (osmGrid.get(k) || osmGrid.set(k, []).get(k)).push(f);
  }
}
const osmAt = (x, z) => {
  let best = null;
  for (const f of osmGrid.get(cellKey(x, z)) || []) if (pointInRing(x, z, f.ring) && (!best || f.area < best.area)) best = f;
  return best;
};
const massing = load('massing.json').parts.map((p, i) => {
  const ring = p.ring.map(([lon, lat]) => toWorld(lon, lat));
  if (ring.length > 3) ring.pop();
  const [cx, cz] = centroid(ring);
  return { ring, cx, cz, area: Math.abs(ringArea(ring)), max: p.max, avg: p.avg, min: p.min, id: i + 1 };
});
for (const f of massing) {
  if (!inDetail(f.cx, f.cz)) continue;
  // a few records carry no maximum (0), only an average height
  const top = f.max >= 2.5 ? f.max : f.avg;
  if (f.area < 12 || !(top >= 2.5)) continue;
  if ([...landmarkFootprints].some((l) => pointInRing(f.cx, f.cz, l.ring))) continue;
  const osm = osmAt(f.cx, f.cz);
  if (osm) stats.joined++;
  const t = osm ? osm.t : {};
  const type = t.building || 'yes';
  const ring = rdpRing(f.ring, 0.25);
  if (ring.length < 3) continue;
  const r = minRect(ring);
  if (offBlocks(r) > 0.6) { stats.dropped++; continue; }
  // Plan: one rectangle, or rectangles covering the outline in the rectangle's own frame (0.5 m cells)
  let parts = [[-r.w / 2, r.w / 2, -r.d / 2, r.d / 2]];
  if (f.area / r.area < 0.86 && r.w > 6 && r.d > 6) {
    const C = r.w * r.d > 20000 ? 1 : 0.5;
    const nw = Math.ceil(r.w / C), nd = Math.ceil(r.d / C);
    if (nw * nd < 400000) {
      const local = ring.map(([x, z]) => [(x - r.cx) * r.ux + (z - r.cz) * r.uz, -(x - r.cx) * r.uz + (z - r.cz) * r.ux]);
      const m = new Uint8Array(nw * nd);
      for (let j = 0; j < nd; j++) for (let i = 0; i < nw; i++) m[j * nw + i] = pointInRing(-r.w / 2 + (i + 0.5) * C, -r.d / 2 + (j + 0.5) * C, local) ? 1 : 0;
      const { rects } = maskRects(m, nw, nd, 5, 6);
      if (rects.length) {
        parts = rects.map(([i0, i1, j0, j1]) => [-r.w / 2 + i0 * C, -r.w / 2 + (i1 + 1) * C, -r.d / 2 + j0 * C, -r.d / 2 + (j1 + 1) * C]);
        stats.multi++;
      }
    }
  }
  const seed = f.id;
  // Pitched-roof houses: the lidar maximum is the ridge, the average sits near the eaves
  const house = top < 14 && f.area < 400;
  const h = house ? Math.max(3, f.avg || top) : top;
  const levels = Math.max(1, Math.round(h / 3.4));
  stats.tagged++;
  // Kind: 0 house · 1 low-rise · 2 office / commercial · 3 glass tower · 4 hut / shed · 5 under construction ·
  // 6 place of worship · 7 school / hospital / institutional
  let kind;
  if (type === 'construction') kind = 5;
  else if (SMALL.test(type) || (f.area < 30 && levels <= 1)) kind = 4;
  else if (/^(church|cathedral|chapel|temple|mosque|synagogue|religious)$/.test(type) || /^place_of_worship$/.test(t.amenity || '')) kind = 6;
  else if (/^(school|university|college|hospital|kindergarten|public|government|civic)$/.test(type)) kind = 7;
  else if (levels >= 10) kind = 3;
  else if (levels >= 5 || (BUSINESS.test(type) && levels >= 3)) kind = 2;
  else if (levels <= 3 && f.area < 650 && !BUSINESS.test(type)) kind = 0;
  else kind = 1;
  // Roof: 0 flat (parapet) · 1 pitched · 2 mono-pitch (sheds)
  const rr = hash(seed + 7);
  const roof = kind === 4 ? 2 : kind === 0 ? (top - f.avg > 1.2 || rr < 0.6 ? 1 : 0) : 0;
  buildings.push([
    q(r.cx), q(r.cz), q3(r.ang),
    parts.map((p) => p.map(q)),
    q(h), kind, roof,
    Math.floor(hash(seed + 3) * 256), // colour seed (wall & roof paint, picked at runtime)
    0,
    t.name || ''
  ]);
}
log(`${buildings.length} buildings from the 3D Massing (${stats.joined} with an OSM type or name, ${stats.multi} multi-part plans); ${stats.dropped} off the blocks dropped`);

// ---------------------------------------------------------------------------------------------------------------------
// Parkland & wild ground on every block (share of the block covered, and the largest named park on it)
// ---------------------------------------------------------------------------------------------------------------------
{
  const byLab = new Map(blocks.map((b) => [b._lab, b]));
  const W = R.w, H = R.h;
  for (const a of areas) {
    const green = /^(park|golf|pitch|cemetery)$/.test(a.kind) ? 'park' : /^(wood|scrub|rock)$/.test(a.kind) ? 'wild' : null;
    if (!green) continue;
    const bb = bbox(a.ring);
    const j0 = Math.max(0, Math.floor((bb.z0 - R.z0) / R.res)), j1 = Math.min(H - 1, Math.ceil((bb.z1 - R.z0) / R.res));
    const counts = new Map();
    const xs = [];
    for (let j = j0; j <= j1; j++) {
      const z = R.z0 + (j + 0.5) * R.res;
      xs.length = 0;
      for (let p = 0, k = a.ring.length - 1; p < a.ring.length; k = p++) {
        const [xa, za] = a.ring[k], [xb, zb] = a.ring[p];
        if ((za > z) !== (zb > z)) xs.push(xa + ((z - za) * (xb - xa)) / (zb - za));
      }
      xs.sort((p1, p2) => p1 - p2);
      for (let n = 0; n + 1 < xs.length; n += 2) {
        const i0 = Math.max(0, Math.ceil((xs[n] - R.x0) / R.res - 0.5)), i1 = Math.min(W - 1, Math.floor((xs[n + 1] - R.x0) / R.res - 0.5));
        for (let i = i0; i <= i1; i++) {
          const L = lab[j * W + i];
          if (L) counts.set(L, (counts.get(L) || 0) + 1);
        }
      }
    }
    for (const [L, n] of counts) {
      const b = byLab.get(L);
      if (!b) continue;
      b[green] = (b[green] || 0) + n;
      if (green === 'park' && a.name && n > (b._parkCells || 0)) { b._parkCells = n; b.parkName = a.name; }
    }
  }
  for (const b of blocks) {
    b.park = b.park ? Math.min(1, Math.round((b.park / b.area) * 100) / 100) : 0;
    b.wild = b.wild ? Math.min(1, Math.round((b.wild / b.area) * 100) / 100) : 0;
    if (b.park < 0.25) b.parkName = '';
  }
  log(`blocks mostly parkland: ${blocks.filter((b) => b.park > 0.6).length}; mostly woods, scrub & rock: ${blocks.filter((b) => b.wild > 0.6).length}`);
}
