// tools/build-art-heritage.mjs: the City's Public Art and Heritage Register snapshots (tools/fetch-art-heritage.mjs) as
// the game's discovery layers.
// usage: node tools/build-art-heritage.mjs
// writes js/toronto-public-art.js (CITY.PUBLIC_ART: search records, markers and the reviewed modelled works; loaded
// at startup), js/toronto-heritage.js (CITY.HERITAGE: search records keyed to the City 3D Massing buildings by durable
// ID; loaded lazily by js/discovery.js the first time a search box is used) and
// tools/data/heritage-facade-shortlist-<date>.json (candidates for future facade work, never shipped).
// See docs/public-art-heritage.md.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { projectPoint } from './build-open-data.mjs';
import { faceOf } from './geo-ids.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const DATE = '20261029';
const clean = (s) => (s == null || /^(none|null|n\/a|unknown)$/i.test(String(s).trim()) ? '' : String(s).trim().replace(/\s+/g, ' '));
export const slug = (s) => clean(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const words = (s) => slug(s).split('-').filter(Boolean);
// words too common in the names of art and memorials to identify one
const GENERIC = new Set(['the', 'and', 'of', 'a', 'in', 'to', 'for', 'at', 'on', 'memorial', 'monument', 'statue', 'sculpture', 'toronto',
  'untitled', 'park', 'square', 'garden', 'gardens', 'canada', 'canadian', 'war', 'fountain', 'city', 'hall', 'old', 'new', 'no',
  'plaza', 'mural', 'wall', 'place', 'court', 'art', 'public', 'sir']);
const distinct = (s) => [...new Set(words(s).filter((w) => w.length >= 3 && !GENERIC.has(w)))];
// words that make an OpenStreetMap name a place rather than an artwork
const PLACEISH = new Set(['park', 'parkette', 'square', 'house', 'station', 'aquarium', 'st', 'street', 'ave', 'avenue', 'road', 'market', 'building',
  'school', 'church', 'hotel', 'condos', 'condo', 'south', 'north', 'east', 'west', 'centre', 'center', 'library', 'office', 'tower']);
// landmark outlines that are open spaces (art inside them is outdoors); the others are buildings
const OPEN_LANDMARKS = new Set(['nathanPhillips', 'harbourfront', 'musicGarden', 'distillery', 'exhibitionPlace', 'highPark', 'trinityBellwoods',
  'centreIsland', 'sugarBeach', 'kensington', 'ontarioPlace', 'stLawrence']);
const ACCESS_NOTE = {
  'outdoor-point': 'The City\'s point is outdoors (outside every mapped building); the work may still be on private land or partly out of view.',
  'in-building': 'The City\'s point falls inside a building: the work may be indoors, in a lobby or part of the facade.',
  reviewed: 'Reviewed: stands outdoors and can be seen from public space.'
};

export function inRing(x, z, p) {
  let yes = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if ((p[i + 1] > z) !== (p[j + 1] > z) && x < ((p[j] - p[i]) * (z - p[i + 1])) / (p[j + 1] - p[i + 1]) + p[i]) yes = !yes;
  return yes;
}
// Buildings (GEO.buildings rows) as a 50 m grid of their bounding circles, and the ones whose footprint holds a point
function buildingIndex(geo) {
  const grid = new Map(), C = 50;
  geo.buildings.forEach((b, i) => {
    let r = 0;
    for (const [u0, u1, v0, v1] of b[3]) r = Math.max(r, Math.hypot(Math.max(-u0, u1), Math.max(-v0, v1)));
    for (let gx = Math.floor((b[0] - r) / C); gx <= Math.floor((b[0] + r) / C); gx++)
      for (let gz = Math.floor((b[1] - r) / C); gz <= Math.floor((b[1] + r) / C); gz++) {
        const k = gx * 100000 + gz;
        (grid.get(k) || grid.set(k, []).get(k)).push(i);
      }
  });
  // signed distance outside the footprint (0 inside): the nearest of its rectangles
  const outside = (b, x, z) => {
    const dx = x - b[0], dz = z - b[1], cs = Math.cos(b[2]), sn = Math.sin(b[2]);
    const u = dx * cs - dz * sn, v = dx * sn + dz * cs;
    let best = Infinity;
    for (const [u0, u1, v0, v1] of b[3]) best = Math.min(best, Math.hypot(Math.max(u0 - u, 0, u - u1), Math.max(v0 - v, 0, v - v1)));
    return best;
  };
  return {
    near(x, z, reach = 0) {
      const out = [];
      for (const i of grid.get(Math.floor(x / C) * 100000 + Math.floor(z / C)) || []) {
        const d = outside(geo.buildings[i], x, z);
        if (d <= reach) out.push({ index: i, d });
      }
      return out;
    }
  };
}
// The building an address point belongs to: inside a footprint (where a podium and its tower overlap, the lower part,
// the street wall a facade reference is about), else the nearest footprint within `reach` metres
function addressBuilding(index, geo, x, z, reach) {
  const inside = index.near(x, z, 0);
  if (inside.length) {
    inside.sort((a, b) => geo.buildings[a.index][4] - geo.buildings[b.index][4] || a.index - b.index);
    return { index: inside[0].index, evidence: inside.length > 1 ? `point-in-footprint (lowest of ${inside.length})` : 'point-in-footprint' };
  }
  const near = index.near(x, z, reach).sort((a, b) => a.d - b.d || a.index - b.index);
  return near.length ? { index: near[0].index, evidence: `nearest-footprint-${near[0].d.toFixed(1)}m` } : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Public Art
// ---------------------------------------------------------------------------------------------------------------------
export function publicArt(snapshot, review, geo, ids) {
  if (snapshot.features.length !== snapshot.total) throw new Error('Incomplete public art snapshot');
  if (ids.geodata == null || ids.counts.buildings !== geo.buildings.length || ids.counts.pois !== geo.pois.length) throw new Error('GEO_IDS do not describe this geodata');
  const index = buildingIndex(geo);
  const byKey = new Map(), audit = { duplicate: [], outsideFrame: 0, osmMerged: [], inBuilding: [], reviewed: [] };
  const records = [];
  for (const { properties: a, geometry } of snapshot.features) {
    const title = clean(a.TITLE);
    if (!title) throw new Error(`Public art record ${a._id} has no title`);
    // SOURCE_ID is a program/file number that a whole development's works share (98069 has 19), so the key adds the title
    const key = `${slug(a.SOURCE_ID) || 'none'}:${slug(title)}`;
    const identity = JSON.stringify({ ...a, _id: undefined, FID: undefined });
    if (byKey.has(key)) {
      if (byKey.get(key) !== identity) throw new Error(`Conflicting public art records for ${key}`);
      audit.duplicate.push(key);
      continue;
    }
    byKey.set(key, identity);
    const point = projectPoint(geometry, geo.frame);
    if (!point) { audit.outsideFrame++; continue; }
    const year = /^\d{4}$/.test(clean(a.YEAR)) ? +a.YEAR : null;
    const r = { id: `art:${key}`, key, sourceId: clean(a.SOURCE_ID), title, artist: clean(a.ARTIST), year, type: clean(a.ARTWORK_TYPE), medium: clean(a.MEDIUM),
      program: clean(a.PROGRAM), address: clean(a.ADDRESS), ...point };
    const about = clean(a.DESCRIPTION);
    if (about) r.about = about.length > 420 ? about.slice(0, about.lastIndexOf(' ', 410)) + '…' : about;
    if (clean(a.COMMISSIONEDBY)) r.commissionedBy = clean(a.COMMISSIONEDBY);
    try {
      const u = new URL(clean(a.EXTERNAL_LINK));
      if (u.protocol === 'https:' && (u.hostname === 'toronto.ca' || u.hostname.endsWith('.toronto.ca'))) r.link = u.href;
    } catch { /* no City link */ }
    records.push(r);
  }
  // OpenStreetMap places that name the same work nearby: the search shows the City's record instead (one result), and the
  // marker stands on OSM's point, which mappers put on the work itself (the City's is often a street address)
  const used = new Set();
  const pairs = [];
  geo.pois.forEach(([x, z, name, cat], row) => {
    if (cat !== 'leisure' && cat !== 'place') return;
    const pw = distinct(name);
    // a park, a building or a street named after the same person is not the work (unless named exactly as it)
    const placeish = words(name).some((w) => PLACEISH.has(w));
    for (const r of records) {
      const d = Math.hypot(r.x - x, r.z - z);
      if (d > 150) continue;
      const tw = distinct(r.title), shared = tw.filter((w) => pw.includes(w)).length;
      const same = slug(name) === slug(r.title);
      if (placeish && !same) continue;
      const contained = shared && (shared === pw.length || shared === tw.length);
      if (same || (contained && d <= 60) || (shared >= 2 && d <= 30)) pairs.push({ row, r, d, score: (same ? 10 : 0) + shared });
    }
  });
  pairs.sort((a, b) => b.score - a.score || a.d - b.d || a.row - b.row);
  for (const { row, r, d } of pairs) {
    if (used.has(row) || r.osm) continue;
    used.add(row);
    const [x, z, name] = geo.pois[row];
    r.osm = { id: ids.pois[row], row, name, x, z, d: Math.round(d * 10) / 10 };
    audit.osmMerged.push(`${r.key} <- ${ids.pois[row]}`);
  }
  const landmarkAt = (x, z) => Object.entries(geo.landmarks).find(([id, l]) => !OPEN_LANDMARKS.has(id) && l.ring && inRing(x, z, l.ring))?.[0];
  const reviewed = new Map([...review.modelled.map((m) => [m.key, { ...m, show: 'model' }]), ...review.landmarks.map((m) => [m.key, { ...m, show: 'landmark' }])]);
  for (const r of records) {
    const rv = reviewed.get(r.key);
    const at = r.osm && !index.near(r.osm.x, r.osm.z, 0).length && !landmarkAt(r.osm.x, r.osm.z) ? r.osm : r;
    const inside = index.near(at.x, at.z, 0)[0];
    const lm = landmarkAt(at.x, at.z);
    if (rv) {
      reviewed.delete(r.key);
      audit.reviewed.push(r.key);
      r.access = 'reviewed';
      r.show = rv.show;
      if (rv.show === 'landmark') { r.landmarkId = rv.landmark; continue; }
      const p = /^osm:/.test(rv.position) ? r.osm : null;
      if (!p || p.id !== rv.position) throw new Error(`${r.key}: reviewed position ${rv.position} is not its matched OSM place`);
      r.model = rv.model;
      r.place = { x: p.x, z: p.z, yaw: rv.yaw, basis: rv.position };
      continue;
    }
    if (inside || lm) {
      r.access = 'in-building';
      r.show = 'none';
      if (inside) r.building = { id: ids.buildings[inside.index], row: inside.index, name: geo.buildings[inside.index][9] || '' };
      if (lm) r.inLandmark = lm;
      audit.inBuilding.push(r.key);
    } else {
      r.access = 'outdoor-point';
      r.show = 'marker';
      r.place = { x: at.x, z: at.z, basis: at === r ? 'city' : r.osm.id };
    }
  }
  if (reviewed.size) throw new Error(`Reviewed public art not in the snapshot: ${[...reviewed.keys()].join(', ')}`);
  records.sort((a, b) => a.id.localeCompare(b.id));
  return { source: snapshot.source, geodata: ids.geodata, accessNotes: ACCESS_NOTE, audit, records };
}

// ---------------------------------------------------------------------------------------------------------------------
// Heritage Register
// ---------------------------------------------------------------------------------------------------------------------
const UPPER = new Set(['E', 'W', 'N', 'S', 'NE', 'NW', 'SE', 'SW', 'II', 'III', 'IV', 'YMCA', 'TTC', 'CNE', 'GO']);
export function addressLabel(s) {
  return clean(s).split(' ').map((w) => (UPPER.has(w) ? w : w.toLowerCase().replace(/(^|[-'’.(])([a-z])/g, (m, p, c) => p + c.toUpperCase())
    .replace(/^Mc([a-z])/, (m, c) => 'Mc' + c.toUpperCase()).replace(/'S\b/g, "'s"))).join(' ');
}
// Folder_Row is the City's register row: unique in this edition, but the only older export (2022) has a different
// schema without it, so its stability across editions is unproven. Places are therefore keyed by the City's address,
// which is also what people search; Folder_Row identifies an entry within the snapshot.
const STATUS = { 'Part IV': 'Designated, Part IV (individual property)', 'Part V': 'Designated, Part V (heritage conservation district)', Listed: 'Listed (not designated)' };
export function heritageRegister(snapshot, geo, ids) {
  if (snapshot.rows.length !== snapshot.total) throw new Error('Incomplete heritage register snapshot');
  if (ids.counts.buildings !== geo.buildings.length) throw new Error('GEO_IDS do not describe this geodata');
  const col = Object.fromEntries(snapshot.columns.map((k, i) => [k, i]));
  for (const k of ['lon', 'lat', 'Folder_Row', 'STATUS', 'ADDRESS', 'BYLAW_NO', 'DESIGNATED', 'LISTED']) if (!(k in col)) throw new Error(`Heritage snapshot lacks ${k}`);
  const index = buildingIndex(geo);
  const audit = { duplicateEntries: [], outsideFrame: 0, unknownStatus: [], unmatched: 0, groupedAddresses: 0 };
  const seen = new Set(), content = new Map();
  const places = new Map();
  for (const row of snapshot.rows) {
    const a = (k) => row[col[k]];
    const folder = a('Folder_Row');
    if (!Number.isInteger(folder) || seen.has(folder)) throw new Error(`Missing/duplicate heritage Folder_Row ${folder}`);
    seen.add(folder);
    if (!STATUS[a('STATUS')]) { audit.unknownStatus.push(folder); continue; }
    const point = projectPoint({ type: 'Point', coordinates: [a('lon'), a('lat')] }, geo.frame);
    if (!point) { audit.outsideFrame++; continue; }
    const entry = { f: folder, st: a('STATUS') };
    const opt = { d: 'DESIGNATED', l: 'LISTED', bl: 'BYLAW_NO', hcd: 'HTG_CONSER', about: 'DESCRIPTIO', built: 'CONSTRUCTI', arch: 'ARCHITECT_', type: 'BUILDING_T', why: 'REASON', eas: 'EASEMENT_A', omb: 'OMB_DATE', gone: 'YEAR_DEMOL' };
    for (const [k, f] of Object.entries(opt)) if (f in col && clean(a(f))) entry[k] = clean(a(f));
    if (entry.about?.length > 300) entry.about = entry.about.slice(0, entry.about.lastIndexOf(' ', 290)) + '…';
    if (entry.type === 'Unknown') delete entry.type;
    // the same register content under two folder rows (39 in this snapshot): one entry, the other folder kept for audit
    const same = JSON.stringify({ ...entry, f: 0, no: 0, address: a('ADDRESS'), x: point.x, z: point.z });
    if (content.has(same)) { audit.duplicateEntries.push(`${folder} = ${content.get(same)}`); continue; }
    content.set(same, folder);
    // one place per address: several register entries can share it (Exhibition Place's 2 Strachan Ave has 22 structures)
    const addr = addressLabel(a('ADDRESS'));
    const list = places.get(addr) || places.set(addr, []).get(addr);
    let place = list.find((p) => Math.hypot(p.x - point.x, p.z - point.z) < 30);
    if (!place) list.push(place = { address: addr, ...point, entries: [] });
    place.entries.push(entry);
  }
  const records = [];
  for (const list of places.values()) list.forEach((p, k) => {
    p.entries.sort((a, b) => a.f - b.f);
    if (p.entries.length > 1) audit.groupedAddresses++;
    // durable: the City's address (with a suffix only where one address has places far apart, as 61 Front St W does)
    p.id = `heritage:${slug(p.address)}${k ? `~${k + 1}` : ''}`;
    const m = addressBuilding(index, geo, p.x, p.z, 6);
    if (m) {
      p.b = m.index;
      p.bid = ids.buildings[m.index];
      // (the evidence in full for the audit; the record keeps 'in' or the distance to the nearest footprint)
      p.m = m.evidence.startsWith('point') ? 'in' : m.evidence.slice(17);
      audit.matches = (audit.matches || 0) + 1;
      if (geo.buildings[m.index][9]) p.bname = geo.buildings[m.index][9];
    } else {
      // a landmark the game draws from its own outline (Union Station, the Royal York...) rather than City massing
      const lm = Object.entries(geo.landmarks).find(([id, l]) => !OPEN_LANDMARKS.has(id) && l.ring && inRing(p.x, p.z, l.ring));
      if (lm) { p.lm = lm[0]; audit.landmarks = (audit.landmarks || 0) + 1; } else audit.unmatched++;
    }
    records.push(p);
  });
  records.sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(records.map((r) => r.id)).size !== records.length) throw new Error('Duplicate heritage place IDs');
  return { source: snapshot.source, geodata: ids.geodata, statusLabels: STATUS, audit, records };
}

// Candidates for future facade work, best first. A ranking for planning, not a heritage assessment: individually
// designated (Part IV) +4, a heritage easement +2, Part V +1, built before 1900 +1, a public, religious, financial or
// commercial building +1, a named building +1; only places matched to a building with a face toward its address's
// street (else the nearest street) within 80 m.
export function facadeShortlist(heritage, geo, limit = 60) {
  const roads = geo.roads.filter((r) => r[0] && !/^(unnamed|service)/i.test(r[0]));
  const ABBR = { st: 'street', ave: 'avenue', av: 'avenue', rd: 'road', cres: 'crescent', blvd: 'boulevard', dr: 'drive', pl: 'place', sq: 'square',
    crt: 'court', ter: 'terrace', gdns: 'gardens', pk: 'park', ln: 'lane', e: 'east', w: 'west', n: 'north', s: 'south' };
  const streetKey = (name) => words(name).map((w) => ABBR[w] || w).join(' ');
  // the street of the address ("106 King St E" -> king street east), else any street
  const nearestRoad = (x, z, street) => street && nearestRoadOf(x, z, (r) => streetKey(r[0]) === street) || nearestRoadOf(x, z, () => true);
  const nearestRoadOf = (x, z, ok) => {
    let best = null;
    for (const r of roads) {
      if (!ok(r)) continue;
      const p = r[6];
      for (let i = 2; i < p.length; i += 2) {
        const ax = p[i - 2], az = p[i - 1], ex = p[i] - ax, ez = p[i + 1] - az, L2 = ex * ex + ez * ez || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L2)), px = ax + ex * t, pz = az + ez * t, d = Math.hypot(px - x, pz - z);
        if (!best || d < best.d) best = { d, px, pz, name: r[0] };
      }
    }
    return best;
  };
  const scored = [];
  for (const p of heritage.records) {
    if (p.b == null) continue;
    const e = p.entries;
    let score = 0;
    if (e.some((x) => x.st === 'Part IV')) score += 4; else if (e.some((x) => x.st === 'Part V')) score += 1;
    if (e.some((x) => x.eas)) score += 2;
    if (e.some((x) => /^1[5-8]\d\d/.test(x.built || ''))) score += 1;
    if (e.some((x) => /^(Public|Religious|Financial|Commercial)$/.test(x.type || ''))) score += 1;
    if (p.bname) score += 1;
    if (score >= 6) scored.push({ p, score });
  }
  scored.sort((a, b) => b.score - a.score || a.p.id.localeCompare(b.p.id));
  const out = [];
  for (const { p, score } of scored) {
    if (out.length >= limit) break;
    const b = geo.buildings[p.b], road = nearestRoad(b[0], b[1], streetKey(p.address.replace(/^[\d\s\-A-Z]*?(?=[A-Z][a-z])/, '')));
    if (!road || road.d > 80) continue;
    // the side whose outward normal points most toward the nearest street
    const toward = [road.px - b[0], road.pz - b[1]], L = Math.hypot(...toward) || 1;
    const faces = ['n', 'e', 's', 'w'].map((side) => ({ side, f: faceOf(b, side) })).filter((q) => q.f)
      .map((q) => ({ ...q, dot: (q.f.normal[0] * toward[0] + q.f.normal[1] * toward[1]) / L })).sort((a, c) => c.dot - a.dot);
    if (!faces.length || faces[0].dot < 0.5) continue;
    out.push({ place: p.id, address: p.address, building: p.bid, face: `${p.bid}:${faces[0].side}`, street: road.name, score,
      status: [...new Set(p.entries.map((x) => x.st))].join(', '), byLaws: p.entries.map((x) => x.bl).filter(Boolean), built: p.entries[0].built || '',
      name: p.bname || '', width: Math.round(faces[0].f.width * 10) / 10, height: b[4] });
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ctx = { window: { CITY: {} } };
  for (const f of ['toronto-geodata', 'toronto-geodata-ids']) vm.runInNewContext(fs.readFileSync(path.join(root, `js/${f}.js`), 'utf8'), ctx);
  const { GEO, GEO_IDS } = ctx.window.CITY;
  const read = (f) => JSON.parse(fs.readFileSync(path.join(root, 'tools/data', f), 'utf8'));
  const art = publicArt(read(`public-art-${DATE}.json`), read(`public-art-review-${DATE}.json`), GEO, GEO_IDS);
  fs.writeFileSync(path.join(root, 'js/toronto-public-art.js'), '// GENERATED by tools/build-art-heritage.mjs from the City of Toronto Public Art dataset (dated snapshot; images not included).\n(function () { window.CITY.PUBLIC_ART = ' + JSON.stringify(art) + '; })();\n');
  const her = heritageRegister(read(`heritage-register-${DATE}.json`), GEO, GEO_IDS);
  fs.writeFileSync(path.join(root, 'js/toronto-heritage.js'), '// GENERATED by tools/build-art-heritage.mjs from the City of Toronto Heritage Register (dated snapshot; not a legal status determination).\n(function () { window.CITY.HERITAGE = ' + JSON.stringify(her) + '; })();\n');
  const shortlist = facadeShortlist(her, GEO);
  fs.writeFileSync(path.join(root, `tools/data/heritage-facade-shortlist-${DATE}.json`), JSON.stringify({ geodata: GEO_IDS.geodata, rule: 'tools/build-art-heritage.mjs facadeShortlist', places: shortlist }, null, 1) + '\n');
  const shows = {};
  for (const r of art.records) shows[r.show] = (shows[r.show] || 0) + 1;
  console.log(`[publicArt] ${art.records.length} records ${JSON.stringify(shows)}; ${art.audit.duplicate.length} duplicates suppressed, ${art.audit.osmMerged.length} OSM places merged`);
  console.log(`[heritage] ${her.records.length} places from ${her.records.reduce((n, p) => n + p.entries.length, 0)} entries; ${her.audit.duplicateEntries.length} duplicate entries, ${her.audit.unmatched} without a building; shortlist ${shortlist.length}`);
}
