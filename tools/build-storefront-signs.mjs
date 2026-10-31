// tools/build-storefront-signs.mjs — source-keyed storefront signs (bead st-wt0.15, adoption spec ID-1/ID-2/ID-7;
// docs/storefronts.md is the contract).
//
// Two steps, both deterministic:
//   propose  GEO_DATA=~/.cache/slop-toronto/osm-ids node tools/build-storefront-signs.mjs --propose
//            Reads the raw OpenStreetMap POIs behind GEO.pois (their tags: name, shop/amenity, address, check_date),
//            the committed geodata + identity sidecar and the City's CaféTO permits, and writes the reviewable manifest
//            tools/data/storefront-signs.json: one record per sign, keyed by the place's OSM ID and the building face
//            (docs/geodata-ids.md), with its evidence, confidence, review state and wall-local extent; plus every
//            candidate the rules turned down and why. Reviewed fields of existing records (enabled, a corrected name,
//            review, note, style) are kept.
//   compile  node tools/build-storefront-signs.mjs
//            Needs only committed files. Resolves each enabled record through idResolver (an ID that resolves to
//            nothing drops its record; it is never re-attached to a nearby feature), finds the wall at the record's
//            extent and writes js/toronto-storefronts.js (window.CITY.STOREFRONTS) for js/storefront-signs.js and
//            js/buildings.js. The output names the geodata it was compiled against.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { faceOf, idResolver } from './geo-ids.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const MANIFEST = path.join(ROOT, 'tools/data/storefront-signs.json');
export const OUTPUT = path.join(ROOT, 'js/toronto-storefronts.js');

// The pilot corridor: Queen Street West from Ossington Avenue (x -2975) to Spadina Avenue (x -1095), both sides
export const CORRIDOR = { id: 'queen-west-ossington-spadina', street: 'Queen Street West', x0: -2975, x1: -1095, maxPoiDistance: 35 };
export const RULES = {
  // OSM check_date (a mapper confirmed the feature on the ground) on or after this is evidence of a current tenant
  checkDateHigh: '2025-01-01',
  checkDateMedium: '2024-01-01',
  maxFaceToStreet: 26, // m from the face to the addressed street's centre line (no building between)
  facing: 0.75, // the face's outward normal · the direction to the street
  minSpan: 2.4, // m of wall a sign needs (narrower: two tenants on one shopfront, left generic)
  halfSpan: 5.5, // m either side of the place's position along the wall, at most
  minHeight: 3.6 // m: the building must stand above the storefront's fascia
};
const SHOP_EXCLUDED = new Set(['vacant', 'erotic', 'magic_mushrooms', 'no', 'yes']);
const AMENITIES = new Set(['restaurant', 'fast_food', 'cafe', 'bar', 'pub', 'ice_cream', 'bank', 'pharmacy', 'dentist',
  'doctors', 'clinic', 'veterinary', 'internet_cafe', 'bureau_de_change']);
const SIDE_DIR = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };

export const sha16 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);
export const normName = (s) => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/^THE\s+/, '').replace(/[^A-Z0-9]/g, '');
// '607B' -> 607, '482-484' -> 482, '650.5' -> 650.5 (null without a number)
export const houseNumber = (s) => {
  const m = /^\s*(\d+(?:\.\d+)?)/.exec(String(s || ''));
  return m ? Number(m[1]) : null;
};
export function categoryOf(tags) {
  if (tags.shop) return SHOP_EXCLUDED.has(tags.shop) ? null : `shop=${tags.shop}`;
  if (AMENITIES.has(tags.amenity)) return `amenity=${tags.amenity}`;
  return null;
}

export function loadCommitted(root = ROOT) {
  const load = (file) => {
    const context = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
    return context.window.CITY;
  };
  const { GEO } = load('js/toronto-geodata.js');
  const { GEO_IDS: IDS } = load('js/toronto-geodata-ids.js');
  const { CAFETO } = load('js/toronto-cafeto.js');
  return { GEO, IDS, CAFETO, geodataHash: sha16(fs.readFileSync(path.join(root, 'js/toronto-geodata.js'))) };
}

// The nearest point of a named street's centre line
export function streetPoint(GEO, street) {
  const segs = [];
  for (const r of GEO.roads) {
    if (r[0] !== street) continue;
    const p = r[6];
    for (let i = 0; i + 3 < p.length; i += 2) segs.push([p[i], p[i + 1], p[i + 2], p[i + 3]]);
  }
  return (x, z) => {
    let best = null;
    for (const [ax, az, bx, bz] of segs) {
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      const px = ax + t * dx, pz = az + t * dz, d = Math.hypot(px - x, pz - z);
      if (!best || d < best.d) best = { d, px, pz };
    }
    return best;
  };
}

// The compass side of a building that looks toward a street: the face whose outward normal best matches the direction
// from the place (x, z) to the street's nearest point (px, pz)
export function faceToward(building, x, z, px, pz) {
  const dx = px - x, dz = pz - z, d = Math.hypot(dx, dz) || 1e-9;
  let best = null;
  for (const side of Object.keys(SIDE_DIR)) {
    const f = faceOf(building, side);
    if (!f) continue;
    const facing = (f.normal[0] * dx + f.normal[1] * dz) / d;
    if (!best || facing > best.facing) best = { side, face: f, facing };
  }
  return best;
}

// Where along a face (metres from its end `a`) a point lies
export const alongFace = (f, x, z) => ((x - f.a[0]) * (f.b[0] - f.a[0]) + (z - f.a[1]) * (f.b[1] - f.a[1])) / (f.width || 1e-9);

// The real wall at `s` metres along a face: the building's plan is a set of boxes (L, T & U plans), so the face line
// (the plan's whole extent) may be air in front of a recessed part. Returns the outermost part's wall at s: its world
// point at ground level, its local wall index (js/buildings.js / createFacadeBoxes: 0 -u, 1 +u, 2 -v, 3 +v), how far it
// stands back from the face line and the stretch of the face that wall covers. null over a gap in the plan.
export function wallAt(building, side, s) {
  const f = faceOf(building, side);
  if (!f) return null;
  const [cx, cz, yaw, parts] = building;
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const tx = (f.b[0] - f.a[0]) / f.width, tz = (f.b[1] - f.a[1]) / f.width;
  const qx = f.a[0] + tx * s, qz = f.a[1] + tz * s;
  const toLocal = (x, z) => [(x - cx) * cs - (z - cz) * sn, (x - cx) * sn + (z - cz) * cs];
  const [qu, qv] = toLocal(qx, qz);
  // the face's axis in the plan's frame: normal = ±U or ±V
  const nu = f.normal[0] * cs - f.normal[1] * sn, nv = f.normal[0] * sn + f.normal[1] * cs;
  const alongU = Math.abs(nv) > Math.abs(nu); // the face runs along u (its normal is ±v)
  const sign = alongU ? Math.sign(nv) : Math.sign(nu);
  const along = alongU ? qu : qv;
  let best = null;
  for (const [u0, u1, v0, v1] of parts) {
    const [lo, hi] = alongU ? [u0, u1] : [v0, v1];
    if (along < lo + 0.05 || along > hi - 0.05) continue;
    const out = alongU ? (sign > 0 ? v1 : -v0) : (sign > 0 ? u1 : -u0);
    if (!best || out > best.out) best = { out, lo, hi };
  }
  if (!best) return null;
  const faceOut = alongU ? (sign > 0 ? Math.max(...parts.map((p) => p[3])) : -Math.min(...parts.map((p) => p[2])))
    : (sign > 0 ? Math.max(...parts.map((p) => p[1])) : -Math.min(...parts.map((p) => p[0])));
  const inset = faceOut - best.out;
  const x = qx - f.normal[0] * inset, z = qz - f.normal[1] * inset;
  // the part's extent along the face, in metres from a
  const endS = (a) => {
    const [lu, lv] = alongU ? [a, sign * best.out] : [sign * best.out, a];
    return alongFace(f, cx + lu * cs + lv * sn, cz - lu * sn + lv * cs);
  };
  const [p0, p1] = [endS(best.lo), endS(best.hi)].sort((m, n) => m - n);
  const wall = alongU ? (sign > 0 ? 3 : 2) : (sign > 0 ? 1 : 0);
  return { x, z, nx: f.normal[0], nz: f.normal[1], wall, inset, s0: Math.max(0, p0), s1: Math.min(f.width, p1), face: f };
}

// Same-side address order: numbers rise one way along a street. A place whose number is out of order with a neighbour
// on its side (more than 2 m apart) is uncertain: both are left generic. Returns the set of out-of-order indexes.
export function addressOrderConflicts(places) {
  const bad = new Set();
  for (const sideKey of new Set(places.map((p) => p.sideKey))) {
    const side = places.map((p, i) => ({ ...p, i })).filter((p) => p.sideKey === sideKey && p.number !== null)
      .sort((a, b) => a.t - b.t);
    // the street's direction of rising numbers on this side: the sign of their correlation with position
    const n = side.length;
    if (n < 3) continue;
    const mt = side.reduce((s, p) => s + p.t, 0) / n, mn = side.reduce((s, p) => s + p.number, 0) / n;
    const dir = Math.sign(side.reduce((s, p) => s + (p.t - mt) * (p.number - mn), 0)) || 1;
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n && side[b].t - side[a].t < 60; b++) {
        if (side[b].t - side[a].t < 2 || side[a].number === side[b].number) continue;
        if (Math.sign(side[b].number - side[a].number) !== dir) { bad.add(side[a].i); bad.add(side[b].i); }
      }
    }
  }
  return bad;
}

const NUMBER_SPLIT = /[-;,/&]/;
const addressNumbers = (s) => String(s || '').split(NUMBER_SPLIT).map((x) => houseNumber(x)).filter((x) => x !== null);

// ---------------------------------------------------------------------------------------------------------------------
// propose: the corridor's candidates, their evidence and the rules' verdicts
// ---------------------------------------------------------------------------------------------------------------------
export function proposeStorefronts({ GEO, IDS, CAFETO, tagsById, corridor = CORRIDOR, previous = null, today, extract }) {
  const near = streetPoint(GEO, corridor.street);
  const keep = new Map((previous?.records || []).map((r) => [r.id, r]));
  const places = [];
  GEO.pois.forEach((p, row) => {
    const [x, z, name, , b] = p;
    if (x < corridor.x0 || x > corridor.x1) return;
    const n = near(x, z);
    if (!n || n.d > corridor.maxPoiDistance) return;
    const id = IDS.pois[row], tags = tagsById.get(id);
    if (!tags) throw new Error(`no source tags for ${id} (${name}): re-run with the extract the geodata was built from`);
    const category = categoryOf(tags);
    if (!category) return; // not a storefront business (offices, parks, transit, ...)
    // which side of the street, and position along it (for address order): signed offset & projection on the street
    const [sx, sz] = [x - n.px, z - n.pz];
    places.push({ row, id, x, z, b, name, tags, category, near: n, sideKey: Math.abs(sx) > Math.abs(sz) ? Math.sign(sx) : Math.sign(sz) * 2,
      t: n.px, number: tags['addr:street'] === corridor.street ? houseNumber(tags['addr:housenumber']) : null });
  });
  const disorder = addressOrderConflicts(places);
  // CaféTO permits at the corridor's addresses, by house number
  const permits = new Map();
  const STREET_ABBR = corridor.street.toUpperCase().replace(/STREET/, 'ST').replace(/WEST/, 'W');
  for (const r of CAFETO.records) {
    const address = r.address.replace(/\(.*?\)/g, '');
    if (!address.includes(STREET_ABBR)) continue;
    for (const num of addressNumbers(address.split(STREET_ABBR)[0])) (permits.get(num) || permits.set(num, []).get(num)).push(r);
  }
  const matches = (place, permit) => {
    const a = normName(place.name), b = normName(permit.operator);
    return a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a));
  };

  // every candidate place on a face, for frontage splitting (verified or not: an unverified neighbour still occupies
  // its own shopfront)
  const onFace = new Map();
  const verdicts = places.map((pl, i) => {
    const t = pl.tags;
    const reject = (reason, extra = {}) => ({ pl, reason, ...extra });
    if (t['addr:street'] !== corridor.street) return reject('address on another street');
    if (!t['addr:housenumber']) return reject('no house number');
    if (t.level !== undefined && !/^0(;0)*$/.test(String(t.level))) return reject(`level ${t.level}`);
    if (pl.b < 0) return reject('not inside a mapped building');
    const building = GEO.buildings[pl.b];
    const look = faceToward(building, pl.x, pl.z, pl.near.px, pl.near.pz);
    if (!look || look.facing < RULES.facing) return reject('no face squarely toward the street');
    const f = look.face;
    if (building[4] < RULES.minHeight) return reject('building too low for a fascia');
    const s = Math.max(0, Math.min(f.width, alongFace(f, pl.x, pl.z)));
    const wall = wallAt(building, look.side, s);
    if (!wall) return reject('gap in the plan at the place');
    const toStreet = near(wall.x, wall.z);
    if (!toStreet || toStreet.d > RULES.maxFaceToStreet) return reject('wall set back from the street');
    const faceId = `${IDS.buildings[pl.b]}:${look.side}`;
    (onFace.get(faceId) || onFace.set(faceId, []).get(faceId)).push({ i, s, wall });
    // evidence
    const evidence = [];
    const check = t.check_date || t['survey:date'] || '';
    if (check >= RULES.checkDateMedium) evidence.push({ source: 'osm', kind: 'check_date', date: check });
    const here = addressNumbers(t['addr:housenumber']).flatMap((num) => permits.get(num) || []);
    const permit = here.find((r) => matches(pl, r));
    if (permit) evidence.push({ source: 'cafeto', kind: 'permit', licence: permit.id, operator: permit.operator, address: permit.address });
    // a food or drink place at an address whose CaféTO permit names someone no place there matches: a tenant change?
    const food = /^amenity=(restaurant|fast_food|cafe|bar|pub|ice_cream)$/.test(pl.category);
    const others = here.filter((r) => !places.some((q) => q.tags['addr:housenumber'] && addressNumbers(q.tags['addr:housenumber']).some((n) => addressNumbers(r.address).includes(n)) && matches(q, r)));
    if (food && !permit && others.length) return reject('CaféTO permit at the address names another operator', { faceId, s, wall, conflict: others.map((r) => r.operator) });
    if (disorder.has(i)) return reject('house number out of order with a neighbour', { faceId, s, wall });
    const confidence = permit || check >= RULES.checkDateHigh ? 'high' : check >= RULES.checkDateMedium ? 'medium' : null;
    if (!confidence) return reject(check ? `last checked ${check}` : 'no survey date or permit', { faceId, s, wall });
    return { pl, faceId, side: look.side, s, wall, evidence, confidence };
  });

  // frontage: each sign gets the wall between the midpoints to its neighbours on the face, within RULES.halfSpan of
  // its own position and on the one wall (part) it stands on
  const records = [], rejected = [];
  for (const v of verdicts) {
    if (v.reason) { rejected.push({ id: v.pl.id, name: v.pl.name, address: [v.pl.tags['addr:housenumber'], v.pl.tags['addr:street']].filter(Boolean).join(' '), category: v.pl.category, reason: v.reason, ...(v.conflict ? { conflict: v.conflict } : {}) }); continue; }
    const mates = onFace.get(v.faceId).filter((m) => m.wall.wall === v.wall.wall && Math.abs(m.wall.inset - v.wall.inset) < 0.5).sort((a, b) => a.s - b.s);
    const k = mates.findIndex((m) => verdicts[m.i] === v);
    const prev = mates[k - 1], next = mates[k + 1];
    const s0 = Math.max(v.wall.s0 + 0.3, v.s - RULES.halfSpan, prev ? (prev.s + v.s) / 2 + 0.2 : -Infinity);
    const s1 = Math.min(v.wall.s1 - 0.3, v.s + RULES.halfSpan, next ? (next.s + v.s) / 2 - 0.2 : Infinity);
    if (s1 - s0 < RULES.minSpan) {
      rejected.push({ id: v.pl.id, name: v.pl.name, address: `${v.pl.tags['addr:housenumber']} ${v.pl.tags['addr:street']}`, category: v.pl.category, reason: `only ${(Math.max(0, s1 - s0)).toFixed(1)} m of wall` });
      continue;
    }
    const old = keep.get(v.pl.id);
    const t = v.pl.tags;
    records.push({
      id: v.pl.id,
      face: v.faceId,
      name: old && old.name !== old.sourceName ? old.name : v.pl.name, // a reviewed correction is kept
      sourceName: v.pl.name,
      category: v.pl.category,
      address: `${t['addr:housenumber']} ${t['addr:street']}`,
      span: [Math.round(s0 * 100) / 100, Math.round(s1 * 100) / 100],
      evidence: v.evidence,
      confidence: v.confidence,
      source: { dataset: 'OpenStreetMap', extract, licence: 'ODbL-1.0' },
      rights: 'Name from OpenStreetMap (ODbL 1.0, © OpenStreetMap contributors), drawn as plain lettering; no logo or trade dress.',
      enabled: old ? old.enabled !== false : true,
      review: old?.review || { status: 'rules', by: 'tools/build-storefront-signs.mjs', date: today,
        note: 'Automated evidence rules only; awaiting a person’s review of the contact sheet before release.' },
      ...(old?.style ? { style: old.style } : {}),
      ...(old?.note ? { note: old.note } : {})
    });
  }
  records.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  rejected.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  const gone = [...keep.keys()].filter((id) => !records.some((r) => r.id === id));
  return {
    schema: 1,
    corridor,
    rules: RULES,
    proposedAt: today,
    sources: {
      osm: { dataset: 'OpenStreetMap', extract, licence: 'Open Database License 1.0', attribution: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' },
      cafeto: { ...CAFETO.source, use: 'corroboration only (operator name + municipal address); no permit data is drawn' }
    },
    records,
    rejected,
    ...(gone.length ? { droppedSinceLastProposal: gone } : {})
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// compile: the enabled records, resolved and placed, for the browser
// ---------------------------------------------------------------------------------------------------------------------
const STYLES = ['fascia', 'fasciaSerif', 'lightbox', 'colour'];
// a plausible Toronto main-street board for the kind of place, picked by a hash of its source ID (never brand colours)
export function styleFor(record) {
  let h = 2166136261;
  for (const c of record.id) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const r = (h % 1000) / 1000;
  const c = record.category;
  if (/=(fast_food|convenience|pharmacy|supermarket|variety_store|mobile_phone|bank|dry_cleaning|laundry|e-cigarette|vape)$/.test(c)) return r < 0.7 ? 'lightbox' : 'colour';
  if (/=(restaurant|bar|pub|cafe|ice_cream|pastry|deli|coffee|wine|alcohol|books|antiques|art)$/.test(c)) return r < 0.5 ? 'fasciaSerif' : r < 0.8 ? 'colour' : 'fascia';
  return r < 0.55 ? 'fascia' : r < 0.8 ? 'fasciaSerif' : 'colour';
}

export function compileStorefronts({ GEO, IDS, manifest, geodataHash }) {
  if (manifest?.schema !== 1 || !Array.isArray(manifest.records)) throw new Error('storefront manifest: unknown schema');
  const resolve = idResolver(IDS);
  const signs = [], dropped = [];
  const seen = new Set();
  for (const r of manifest.records) {
    if (seen.has(r.id)) throw new Error(`storefront manifest: duplicate record ${r.id}`);
    seen.add(r.id);
    if (r.enabled === false) { dropped.push({ id: r.id, reason: 'disabled' }); continue; }
    if (typeof r.name !== 'string' || !r.name.trim() || r.name.length > 80) throw new Error(`storefront manifest: bad name on ${r.id}`);
    if (STYLES.indexOf(r.style ?? 'fascia') < 0) throw new Error(`storefront manifest: unknown style ${r.style} on ${r.id}`);
    const place = resolve(r.id), face = resolve(r.face);
    if (!place || place.kind !== 'poi') { dropped.push({ id: r.id, reason: 'place ID does not resolve' }); continue; }
    if (!face || face.kind !== 'face') { dropped.push({ id: r.id, reason: 'face ID does not resolve' }); continue; }
    const building = GEO.buildings[face.row];
    const [s0, s1] = r.span || [];
    const f = faceOf(building, face.side);
    if (!f || !(s1 - s0 >= RULES.minSpan) || s0 < 0 || s1 > f.width + 0.01) { dropped.push({ id: r.id, reason: 'extent off the face' }); continue; }
    const mid = (s0 + s1) / 2;
    const wall = wallAt(building, face.side, mid);
    if (!wall || s0 < wall.s0 - 0.01 || s1 > wall.s1 + 0.01) { dropped.push({ id: r.id, reason: 'extent not on one wall' }); continue; }
    // the place must still be at this building's face: no re-attachment to a nearby feature
    const [px, pz] = GEO.pois[place.row];
    const sP = alongFace(f, px, pz);
    const dWall = (px - wall.x) * -wall.nx + (pz - wall.z) * -wall.nz; // depth behind the wall
    if (sP < s0 - 3 || sP > s1 + 3 || dWall < -8 || dWall > 40) { dropped.push({ id: r.id, reason: 'place is not behind this stretch of wall' }); continue; }
    signs.push({
      id: r.id, face: r.face, name: r.name.normalize('NFC'), style: r.style || styleFor(r), category: r.category,
      confidence: r.confidence, reviewed: r.review?.status === 'reviewed' ? r.review.date : null,
      b: face.row, bc: [building[0], building[1]], wall: wall.wall, poi: place.row,
      x: Math.round(wall.x * 100) / 100, z: Math.round(wall.z * 100) / 100,
      nx: Math.round(wall.nx * 1e4) / 1e4, nz: Math.round(wall.nz * 1e4) / 1e4,
      width: Math.round((s1 - s0) * 100) / 100, h: building[4]
    });
  }
  return {
    schema: 1,
    geodata: geodataHash,
    corridor: manifest.corridor?.id || null,
    attribution: 'Storefront names © OpenStreetMap contributors (ODbL 1.0), selected with City of Toronto CaféTO permits (Open Government Licence – Toronto)',
    signs,
    dropped
  };
}

export function writeRuntime(data, file = OUTPUT) {
  fs.writeFileSync(file, '// js/toronto-storefronts.js — GENERATED by tools/build-storefront-signs.mjs from tools/data/storefront-signs.json; do not edit.\n' +
    '// Source-keyed storefront signs (docs/storefronts.md). Names © OpenStreetMap contributors (ODbL 1.0). Building rows are\n' +
    `// valid only with the geodata ${data.geodata}; js/storefront-signs.js re-checks each building's centre before use.\n` +
    '(function () { window.CITY = window.CITY || {}; window.CITY.STOREFRONTS = ' + JSON.stringify(data) + '; })();\n');
}

// The review sheet (docs/storefront-signs-review.md): every proposed sign with its evidence, and every candidate the rules
// turned down, for a person to check against the street before release (ID-2)
export function reviewSheet(manifest, compiled) {
  const esc = (t) => String(t).replace(/\|/g, '\\|');
  const placed = new Set(compiled.signs.map((s) => s.id));
  const lines = [
    '# Storefront signs: review sheet',
    '',
    `GENERATED by \`tools/build-storefront-signs.mjs\` from \`tools/data/storefront-signs.json\` (proposed ${manifest.proposedAt}). ` +
      'See [storefronts](storefronts.md). Disable a record with `"enabled": false`, or correct its `name` (with a `note`), ' +
      'then re-run the compile. A record shipped only on the automated evidence rules says `rules` under Review.',
    '',
    `Corridor: ${manifest.corridor.street}, x ${manifest.corridor.x0} to ${manifest.corridor.x1} (Ossington Avenue to Spadina Avenue). ` +
      `${manifest.records.length} signs, ${manifest.rejected.length} candidates left generic.`,
    '',
    '| Sign | Address | Category | Evidence | Confidence | Review | Place / face | Drawn |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |'
  ];
  const sorted = [...manifest.records].sort((a, b) => a.address.localeCompare(b.address, 'en', { numeric: true }));
  for (const r of sorted) {
    const ev = r.evidence.map((e) => (e.source === 'osm' ? `OSM check ${e.date}` : `CaféTO ${e.licence} (${esc(e.operator)})`)).join('; ');
    lines.push(`| ${esc(r.name)}${r.name !== r.sourceName ? ` (source: ${esc(r.sourceName)})` : ''} | ${esc(r.address)} | ${r.category} | ${ev} | ${r.confidence} | ` +
      `${r.review.status} ${r.review.date} | \`${r.id}\` · \`${r.face}\` ${r.span[0]}–${r.span[1]} m | ${r.enabled === false ? 'disabled' : placed.has(r.id) ? 'yes' : 'dropped'} |`);
  }
  lines.push('', '## Left generic', '', '| Place | Address | Category | Why |', '| --- | --- | --- | --- |');
  for (const r of [...manifest.rejected].sort((a, b) => a.reason.localeCompare(b.reason) || a.name.localeCompare(b.name))) {
    lines.push(`| ${esc(r.name)} | ${esc(r.address || '')} | ${r.category} | ${esc(r.reason)}${r.conflict ? ` (${esc(r.conflict.join(', '))})` : ''} |`);
  }
  return lines.join('\n') + '\n';
}

// The raw POI tags by OSM ID, from the extract the geodata was built from (GEO_DATA/osm_pois.json)
export function loadSourceTags(dir) {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'osm_pois.json'), 'utf8'));
  const tags = new Map();
  for (const e of raw.elements) tags.set(`osm:${e.osmType || e.type}/${e.id}`, e.tags || {});
  return tags;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inputs = loadCommitted();
  if (process.argv.includes('--propose')) {
    const dir = process.env.GEO_DATA;
    if (!dir) throw new Error('usage: GEO_DATA=<raw osm-ids dir> node tools/build-storefront-signs.mjs --propose');
    const previous = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : null;
    const today = process.env.STOREFRONT_DATE || new Date().toISOString().slice(0, 10);
    const manifest = proposeStorefronts({ ...inputs, tagsById: loadSourceTags(dir), previous, today,
      extract: process.env.OSM_EXTRACT || 'Geofabrik ontario-latest.osm.pbf of 2026-10-23 (the geodata’s extract)' });
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1) + '\n');
    const by = manifest.rejected.reduce((m, r) => ((m[r.reason.replace(/[\d.]+ m/, 'n m').replace(/level .*/, 'upper level').replace(/last checked .*/, 'checked before 2024')] = (m[r.reason.replace(/[\d.]+ m/, 'n m').replace(/level .*/, 'upper level').replace(/last checked .*/, 'checked before 2024')] || 0) + 1), m), {});
    console.log(`[storefronts] proposed ${manifest.records.length} signs (${manifest.records.filter((r) => r.confidence === 'high').length} high confidence); rejected ${manifest.rejected.length}:`, by);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const data = compileStorefronts({ ...inputs, manifest });
  writeRuntime(data);
  fs.writeFileSync(path.join(ROOT, 'docs/storefront-signs-review.md'), reviewSheet(manifest, data));
  console.log(`[storefronts] ${data.signs.length} signs compiled for geodata ${data.geodata}; dropped ${data.dropped.length}`);
}
