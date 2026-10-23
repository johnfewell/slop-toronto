// Part 3: land cover from OpenStreetMap: Lake Ontario (from the coastline) and the other water, parks & gardens, woods &
// scrub, sports grounds, cemeteries, land use zones, streams & rivers, walls
import { toWorld, rdp, rdpRing, ringArea, centroid, bbox, load, log } from './geo-base.mjs';
import { inDetail } from './geo-roads.mjs';

const osmLand = load('osm_land.json');
const osmPlaces = load('osm_places.json');

// Closed rings of a way or a multipolygon relation (outer ways chained end to end)
export function elemRings(e, role = 'outer') {
  if (e.type === 'way') {
    const g = e.geometry || [];
    if (g.length < 4) return [];
    const r = g.map((p) => toWorld(p.lon, p.lat));
    const a = r[0], b = r[r.length - 1];
    return Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5 ? [r.slice(0, -1)] : [];
  }
  const parts = (e.members || []).filter((m) => m.role === role && m.geometry).map((m) => m.geometry.map((g) => toWorld(g.lon, g.lat)));
  const rings = [];
  const close = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5;
  while (parts.length) {
    let ring = parts.shift();
    for (let guard = 0; guard < 2000 && !close(ring[0], ring[ring.length - 1]); guard++) {
      const i = parts.findIndex((p) => close(p[0], ring[ring.length - 1]) || close(p[p.length - 1], ring[ring.length - 1]));
      if (i < 0) break;
      const p = parts.splice(i, 1)[0];
      ring = ring.concat(close(p[0], ring[ring.length - 1]) ? p.slice(1) : p.reverse().slice(1));
    }
    if (close(ring[0], ring[ring.length - 1]) && ring.length > 3) rings.push(ring.slice(0, -1));
  }
  return rings;
}

function classify(t) {
  if (t.natural === 'water' || /^(reservoir|basin)$/.test(t.landuse || '') || t.water) return 'water';
  if (t.natural === 'bare_rock') return 'rock';
  if (/^(forest)$/.test(t.landuse || '') || t.natural === 'wood') return 'wood';
  if (/^(scrub|grassland|heath)$/.test(t.natural || '') || /^(meadow|greenfield)$/.test(t.landuse || '')) return 'scrub';
  if (t.leisure === 'golf_course') return 'golf';
  if (/^(pitch|track|stadium|sports_centre)$/.test(t.leisure || '')) return 'pitch';
  if (/^(park|garden|recreation_ground|nature_reserve|playground)$/.test(t.leisure || '') || /^(recreation_ground|grass|village_green)$/.test(t.landuse || '')) return 'park';
  if (t.landuse === 'cemetery') return 'cemetery';
  if (/^(residential|commercial|retail|industrial|military|religious|construction|brownfield|institutional|education)$/.test(t.landuse || '')) return `zone:${t.landuse}`;
  if (/^(university|school|hospital)$/.test(t.amenity || '')) return `zone:${t.amenity}`;
  return null;
}

const seen = new Set();
export const areas = []; // { kind, name, ring }
for (const e of [...osmLand.elements, ...osmPlaces.elements]) {
  if (e.type === 'node' || seen.has(`${e.type}${e.id}`)) continue;
  seen.add(`${e.type}${e.id}`);
  const t = e.tags || {};
  const kind = classify(t);
  if (!kind || t.name === 'Lake Ontario') continue;
  for (const ring of elemRings(e)) {
    const [cx, cz] = centroid(ring);
    if (!inDetail(cx, cz, 3000)) continue;
    const area = Math.abs(ringArea(ring));
    if (area < (kind === 'water' ? 150 : 400)) continue;
    let s = rdpRing(ring, kind.startsWith('zone') ? 2 : 0.8);
    if (s.length < 3) continue;
    if (ringArea(s) > 0) s.reverse();
    areas.push({ kind, name: t.name || '', ring: s, area });
  }
}
// ---------------------------------------------------------------------------------------------------------------------
// Lake Ontario: OpenStreetMap's one natural=water multipolygon, cut to about 35 km round the city (osm_lake.json,
// tools/fetch-osm.mjs); its inner rings are the islands (the Toronto Islands, Ontario Place's, the Leslie Spit's ponds
// edges): holes in the water, land again
// ---------------------------------------------------------------------------------------------------------------------
export const islandRings = [];
export let lake = null;
{
  let el = null;
  try { el = load('osm_lake.json').elements[0]; } catch { el = null; }
  if (el) {
    const ring = (m) => m.geometry.map((g) => toWorld(g.lon, g.lat));
    const outers = el.members.filter((m) => m.role === 'outer').map(ring).sort((p, q) => Math.abs(ringArea(q)) - Math.abs(ringArea(p)));
    const outer = rdpRing(outers[0].slice(0, -1), 1.0);
    if (ringArea(outer) > 0) outer.reverse();
    for (const m of el.members.filter((m) => m.role === 'inner')) {
      const r = rdpRing(ring(m).slice(0, -1), 0.6);
      if (r.length >= 3 && Math.abs(ringArea(r)) > 150) islandRings.push(r);
    }
    lake = { ring: outer, holes: islandRings };
    log(`Lake Ontario: shore of ${outer.length} points, ${islandRings.length} islands`);
  } else log('no osm_lake.json: no Lake Ontario');
}
if (lake) areas.push({ kind: 'water', name: 'Lake Ontario', ring: lake.ring, holes: lake.holes, area: Math.abs(ringArea(lake.ring)) });

const tally = {};
for (const a of areas) tally[a.kind] = (tally[a.kind] || 0) + 1;
log(`land cover: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', ')}`);

// Streams & rivers (centre lines with a channel width) and compound walls
export const streams = [];
export const walls = [];
for (const e of osmLand.elements) {
  const t = e.tags || {};
  if (e.type !== 'way' || !e.geometry) continue;
  const pts = e.geometry.map((g) => toWorld(g.lon, g.lat));
  if (!pts.some(([x, z]) => inDetail(x, z, 500))) continue;
  if (/^(river|stream|canal|drain|ditch)$/.test(t.waterway || '') && t.tunnel !== 'culvert') {
    const w = parseFloat(t.width) || { river: 14, canal: 8, stream: 5, drain: 2.5, ditch: 2 }[t.waterway];
    streams.push({ name: t.name || '', w, kind: t.waterway, pts: rdp(pts, 1.0) });
  } else if (t.barrier === 'wall') {
    walls.push({ h: parseFloat(t.height) || 2.4, pts: rdp(pts, 0.3) });
  }
}
log(`${streams.length} streams & rivers, ${walls.length} mapped walls`);

export const waterRings = areas.filter((a) => a.kind === 'water').map((a) => a.ring);
// Water at (x, z): in the lake but not on an island, or in any other water body
const inRingXZ = (x, z, r) => {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const waterBoxes = areas.filter((a) => a.kind === 'water').map((a) => ({ a, b: bbox(a.ring), hb: (a.holes || []).map((h) => ({ h, b: bbox(h) })) }));
export function isWater(x, z) {
  for (const { a, b, hb } of waterBoxes) {
    if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1 || !inRingXZ(x, z, a.ring)) continue;
    if (hb.some(({ h, b: k }) => x >= k.x0 && x <= k.x1 && z >= k.z0 && z <= k.z1 && inRingXZ(x, z, h))) continue;
    return true;
  }
  return false;
}
