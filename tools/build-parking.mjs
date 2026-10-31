// tools/build-parking.mjs: js/toronto-parking.js (window.CITY.PARKING), where the City's by-laws say a curb may or may
// not hold a parked car, from the dated snapshots tools/fetch-parking.mjs writes (docs/parked-cars.md):
// - every curb by-law record (Chapter 950: no parking / stopping / standing, restricted-period parking, the reserved
//   curbs) resolved onto the game's streets: its highway, the stretch "between" its two ends (a cross street, a point
//   so many metres north/south/east/west of one, a street's end, the first lane past one), and its side
// - whether it is in force on the game's day (22 August), on a weekday, between 7 a.m. and 7 p.m.: parked cars stand
//   all day, so a rush-hour ban keeps the curb clear (winter, event and alternate-side rules for the other half of the
//   month are not in force; night-only bans don't apply)
// - the permit parking areas' outlines
// Deterministic: the same snapshots give the same bytes. Unresolved records are counted by reason, never guessed.
// usage: node tools/build-parking.mjs [--out js/toronto-parking.js]
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCHED = { '950-13': 'noParking', '950-14': 'noStopping', '950-16': 'noStanding', '950-15': 'restricted' };
// kinds in the output: 0 no parking (a prohibition in force), 1 parking allowed (restricted periods), 2 a reserved curb
// (taxi stand, loading zone, car share, EV charging...: no parked private cars)
const KIND = (schedule) => (SCHED[schedule] === 'restricted' ? 1 : SCHED[schedule] ? 0 : 2);
const LANE_DEPTH = 40; // m: "the lane first south of X", the lane behind X's lots (no lanes in the game's road data)
const COMPASS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }; // (the game's frame follows Toronto's grid)

export function newest(prefix, root = ROOT) {
  const dir = path.join(root, 'tools/data');
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.json')).sort();
  if (!files.length) throw new Error(`build-parking: no tools/data/${prefix}*.json (run tools/fetch-parking.mjs)`);
  return path.join(dir, files.at(-1));
}

// ---- street names (as patio-layout.js normalises them)
const NORM = [[/\bstreet\b/g, 'st'], [/\bavenue\b/g, 'ave'], [/\broad\b/g, 'rd'], [/\bwest\b/g, 'w'], [/\beast\b/g, 'e'],
  [/\bboulevard\b/g, 'blvd'], [/\bcrescent\b/g, 'cres'], [/\bdrive\b/g, 'dr'], [/\bplace\b/g, 'pl'], [/\bsquare\b/g, 'sq'],
  [/\bterrace\b/g, 'ter'], [/\bnorth\b/g, 'n'], [/\bsouth\b/g, 's'], [/\bgardens\b/g, 'gdns'], [/\blane\b/g, 'ln'],
  [/\bcourt\b/g, 'crt'], [/\bsaint\b/g, 'st'], [/\bst\.\s/g, 'st ']];
export function streetKey(name) {
  let s = String(name || '').toLowerCase().replace(/\s*\((?:ny|et|sc|ey|tor|yk)\)\s*$/, '').trim();
  for (const [re, to] of NORM) s = s.replace(re, to);
  return s.replace(/[^a-z0-9]/g, '');
}

// ---- the times: is a prohibition in force on the game's day (22 August, taken as a weekday), 7 a.m. to 7 p.m.?
const DAY = { from: 7 * 60, to: 19 * 60 };
const clock = (h, m, ap) => ((Number(h) % 12) + (/p/i.test(ap) ? 12 : 0)) * 60 + Number(m || 0);
export function inForce(text) {
  if (!text) return true; // (no times: always)
  return String(text).replace(/except public holidays?/gi, '').replace(/12:00\s*midnight/gi, '11:59 p.m.')
    .replace(/12:00\s*noon/gi, '12:00 p.m.').split(/;/).some(clauseInForce);
}
function clauseInForce(t) {
  if (/\b20\d\d\b/.test(t)) return false; // a dated event closure, long past or to come
  if (/Dec\.\s*1\b.*Mar\.\s*31/i.test(t)) return false; // winter only
  if (/(?:1st|first) day to the 15th day/i.test(t)) return false; // alternate side: the 22nd is in the second half
  if (/^\s*Anytime\b/i.test(t)) return true;
  // the windows, each "h:mm a.m. to h:mm p.m."; days that name only the weekend are not a weekday's
  const weekendOnly = /\b(Sat\.|Sun\.)/.test(t) && !/Mon\.|Tue|Wed|Thu|Fri/.test(t);
  let any = false;
  for (const m of t.matchAll(/(\d{1,2})(?::(\d\d))?\s*([ap])\.?m\.?(?:\s+of one day)?\s+to\s+(\d{1,2})(?::(\d\d))?\s*([ap])\.?m\.?/gi)) {
    any = true;
    if (weekendOnly) continue;
    const a = clock(m[1], m[2], m[3]), b = clock(m[4], m[5], m[6]);
    const spans = b > a ? [[a, b]] : [[a, 24 * 60], [0, b]]; // (overnight)
    if (spans.some(([p, q]) => p < DAY.to && q > DAY.from)) return true;
  }
  return !any; // ("Mon. to Sat.", a season alone...: all day)
}

// ---- the stretch's two ends, from the "Between" / "Location" text
const DIR = '(north|south|east|west)(?:erly)?';
function parseEnd(s) {
  s = s.trim().replace(/^between\s+/i, '').replace(/\.$/, '');
  let m;
  if ((m = s.match(new RegExp(`^(?:a\\s+)?(?:point\\s+)?(?:approximately\\s+)?([\\d.]+)\\s*(?:metres|meters|m)\\.?\\s+(further\\s+)?${DIR}(?:\\s+of\\s+(?:the\\s+\\w+ (?:street|curb) line of\\s+)?(.+))?$`, 'i')))) {
    return { type: 'offset', dist: Number(m[1]), further: !!m[2], dir: m[3].toLowerCase(), ref: m[4] ? cleanStreet(m[4]) : null };
  }
  if ((m = s.match(new RegExp(`^the ${DIR} (?:end|limit|terminus)(?: of (.+))?$`, 'i')))) return { type: 'end', dir: m[1].toLowerCase(), ref: m[2] ? cleanStreet(m[2]) : null };
  if ((m = s.match(new RegExp(`^the (?:first )?(?:public )?lane (?:first )?${DIR} of (.+)$`, 'i')))) return { type: 'lane', dir: m[1].toLowerCase(), ref: cleanStreet(m[2]) };
  if ((m = s.match(/^the \w+ (?:street|curb) line of (.+)$/i))) return { type: 'street', ...qualified(m[1]) };
  if (/\d|\bpoint\b|^the (?:public )?lane|laneway|^lane |end of|corner|opposite/i.test(s)) return null;
  return { type: 'street', ...qualified(s) };
}
const cleanStreet = (s) => s.replace(/^the \w+ (?:street|curb) line of\s+/i, '').split('/')[0].trim();
function qualified(s) {
  const m = s.match(/^(.+?)\s*\((north|south|east|west)(?:erly)?(?: leg| intersection| branch)?[^)]*\)\s*$/i);
  return m ? { ref: cleanStreet(m[1]), qual: m[2].toLowerCase() } : { ref: cleanStreet(s) };
}
export function parseBetween(text) {
  if (!text) return null;
  const s = String(text).trim().replace(/^between\s+/i, '');
  // split at the " and " (or " to ") after which the rest is an end too (street names hardly ever hold one)
  for (const sep of [' and ', ' to ']) {
    for (let k = s.indexOf(sep); k > 0; k = s.indexOf(sep, k + 1)) {
      const a = parseEnd(s.slice(0, k)), b = parseEnd(s.slice(k + sep.length));
      if (a && b) return [a, b];
    }
  }
  return null;
}

// ---- the game's streets
export function loadGeo(root = ROOT) {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(path.join(root, 'js/toronto-geodata.js'), 'utf8'), context);
  return context.window.CITY.GEO;
}
function streetIndex(GEO) {
  const byKey = new Map();
  for (const [name, , , , , raised, flat] of GEO.roads) {
    if (!name) continue;
    const k = streetKey(name);
    const segs = byKey.get(k) || byKey.set(k, []).get(k);
    for (let i = 0; i + 3 < flat.length; i += 2) segs.push([flat[i], flat[i + 1], flat[i + 2], flat[i + 3], raised ? 1 : 0]);
  }
  return byKey;
}
// where streets a and b meet (their centre lines crossing, or ending within 12 m of each other), clustered within 30 m
function meetings(A, B) {
  const pts = [];
  for (const [ax, az, bx, bz] of A) {
    for (const [cx, cz, dx, dz] of B) {
      if (Math.max(ax, bx) < Math.min(cx, dx) - 12 || Math.min(ax, bx) > Math.max(cx, dx) + 12 ||
          Math.max(az, bz) < Math.min(cz, dz) - 12 || Math.min(az, bz) > Math.max(cz, dz) + 12) continue;
      const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz, den = rx * sz - rz * sx;
      let p = null;
      if (Math.abs(den) > 1e-9) {
        const t = ((cx - ax) * sz - (cz - az) * sx) / den, u = ((cx - ax) * rz - (cz - az) * rx) / den;
        if (t >= -0.02 && t <= 1.02 && u >= -0.02 && u <= 1.02) p = [ax + rx * t, az + rz * t];
      }
      if (!p) {
        // an end of one within 12 m of the other
        let best = 12;
        for (const [px, pz, qx, qz, ex, ez] of [[ax, az, cx, cz, sx, sz], [bx, bz, cx, cz, sx, sz], [cx, cz, ax, az, rx, rz], [dx, dz, ax, az, rx, rz]]) {
          const L2 = ex * ex + ez * ez || 1e-9, t = Math.max(0, Math.min(1, ((px - qx) * ex + (pz - qz) * ez) / L2));
          const d = Math.hypot(qx + ex * t - px, qz + ez * t - pz);
          if (d < best) { best = d; p = [px, pz]; }
        }
      }
      if (p) pts.push(p);
    }
  }
  const clusters = [];
  for (const p of pts) {
    const c = clusters.find((q) => Math.hypot(q.x - p[0], q.z - p[1]) < 30);
    if (c) { c.sx += p[0]; c.sz += p[1]; c.n++; c.x = c.sx / c.n; c.z = c.sz / c.n; }
    else clusters.push({ x: p[0], z: p[1], sx: p[0], sz: p[1], n: 1 });
  }
  return clusters.map(({ x, z }) => ({ x, z }));
}
// the street's direction at (x, z): its nearest segment's, signed toward compass direction dir
function tangentAt(segs, x, z, dir) {
  let best = null, bd = Infinity;
  for (const [ax, az, bx, bz] of segs) {
    const ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez;
    if (L2 < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L2));
    const d = Math.hypot(ax + ex * t - x, az + ez * t - z);
    if (d < bd) { bd = d; const L = Math.sqrt(L2); best = [ex / L, ez / L]; }
  }
  if (!best || bd > 25) return null;
  const [cx, cz] = COMPASS[dir];
  return best[0] * cx + best[1] * cz < 0 ? [-best[0], -best[1]] : best;
}
const pick = (cands, qual) => {
  if (!qual || cands.length < 2) return cands;
  const [cx, cz] = COMPASS[qual];
  return [cands.reduce((a, b) => (a.x * cx + a.z * cz >= b.x * cx + b.z * cz ? a : b))];
};

/** The PARKING object from the snapshots */
export function buildParking({ bylaws, permits, GEO }) {
  const index = streetIndex(GEO);
  const D = GEO.frame.detail;
  const P = GEO.frame.projection;
  const project = (lat, lon) => {
    const e = (lon - P.lon0) * P.kx, n = (lat - P.lat0) * P.ky, c = Math.cos(P.theta), s = Math.sin(P.theta);
    return { x: e * c - n * s - P.ox, z: -(e * s + n * c) - P.oz };
  };
  const meetCache = new Map();
  const meet = (hk, sk) => {
    const k = hk + '|' + sk;
    if (!meetCache.has(k)) meetCache.set(k, index.has(sk) ? meetings(index.get(hk), index.get(sk)) : []);
    return meetCache.get(k);
  };
  const names = [];
  const nameIdx = new Map();
  const rules = [];
  const unresolved = {};
  const skipped = { notInForce: 0 };
  const miss = (why) => { unresolved[why] = (unresolved[why] || 0) + 1; };
  const round = (v) => Math.round(v * 10) / 10;

  for (const r of bylaws.records) {
    const f = r.fields;
    const kind = KIND(r.schedule);
    const times = f['Prohibited Times and/or Days'] ?? f['Times and/or Days'] ?? f['Hours (daily as indicated below)'] ?? null;
    if (kind !== 1 && !inForce(times)) { skipped.notInForce++; continue; }
    const hk = streetKey(f.Highway);
    const H = index.get(hk);
    if (!H) { miss('highway'); continue; }
    const ends = parseBetween(f.Between ?? f.Location);
    if (!ends) { miss('text'); continue; }
    // the cross streets' meetings with the highway (the geoData's points stand in where the game has none)
    const geoPts = (r.geo || []).map((g) => ({ ...project(g.lat, g.lon), key: streetKey(g.to) }));
    const streetPoint = (ref, qual, other) => {
      let sk = streetKey(ref);
      // ("King Street" for King Street East or West: the half the highway meets)
      if (!index.has(sk)) sk = ['e', 'w'].map((x) => sk + x).find((k) => index.has(k) && meet(hk, k).length) || sk;
      let cands = pick(meet(hk, sk), qual);
      if (!cands.length) cands = geoPts.filter((g) => g.key === sk || sk.startsWith(g.key) || g.key.startsWith(sk));
      if (cands.length > 1 && other) cands = [cands.reduce((a, b) => (Math.hypot(a.x - other.x, a.z - other.z) <= Math.hypot(b.x - other.x, b.z - other.z) ? a : b))];
      return cands.length === 1 ? { x: cands[0].x, z: cands[0].z } : null;
    };
    const move = (p, dir, dist) => {
      const t = tangentAt(H, p.x, p.z, dir);
      return t ? { x: p.x + t[0] * dist, z: p.z + t[1] * dist } : null;
    };
    const endOf = (dir) => {
      const [cx, cz] = COMPASS[dir];
      let best = null;
      for (const [ax, az, bx, bz] of H) for (const [x, z] of [[ax, az], [bx, bz]]) if (!best || x * cx + z * cz > best.x * cx + best.z * cz) best = { x, z };
      return best;
    };
    // the street-only ends first (an offset "a point 62 m north" with no street is from the other end's street)
    let lastRef = null;
    for (const e of ends) if (e.ref) lastRef = lastRef || e.ref;
    const resolve = (e, prev, other) => {
      if (e.type === 'street') return streetPoint(e.ref, e.qual, other);
      if (e.type === 'end') return endOf(e.dir);
      if (e.type === 'lane') { const p = streetPoint(e.ref, null, other); return p && move(p, e.dir, LANE_DEPTH); }
      if (e.type === 'offset') {
        const from = e.further ? prev : e.ref ? streetPoint(e.ref, null, other) : (prev && prev.ref ? prev : streetPoint(lastRef, null, other));
        return from && move(from, e.dir, e.dist);
      }
      return null;
    };
    let p0 = resolve(ends[0], null, null);
    if (p0) p0.ref = ends[0].ref ? true : undefined;
    let p1 = resolve(ends[1], p0 && { ...p0, ref: ends[0].type === 'street' || ends[0].ref }, p0);
    if (!p0 && p1) p0 = resolve(ends[0], null, p1);
    if (!p0 || !p1) { miss('ends'); continue; }
    const len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    if (len < 1 || len > 3000) { miss('length'); continue; }
    if (Math.max(p0.x, p1.x) < D.x0 || Math.min(p0.x, p1.x) > D.x1 || Math.max(p0.z, p1.z) < D.z0 || Math.min(p0.z, p1.z) > D.z1) { miss('outside'); continue; }
    const sideText = String(f.Side ?? f['Side Parking'] ?? 'Both').toLowerCase();
    const side = /both/.test(sideText) ? 15 : ['north', 'south', 'east', 'west'].reduce((m, d, i) => (sideText.includes(d) ? m | (1 << i) : m), 0) || 15;
    const name = f.Highway.replace(/\s*\((?:NY|ET|SC|EY|TOR|YK)\)\s*$/, '');
    if (!nameIdx.has(hk)) { nameIdx.set(hk, names.length); names.push(name); }
    rules.push([kind, side, round(p0.x), round(p0.z), round(p1.x), round(p1.z), nameIdx.get(hk), r.schedule]);
  }
  rules.sort((a, b) => a[6] - b[6] || a[2] - b[2] || a[3] - b[3] || a[0] - b[0]);

  // the permit areas, in the game's frame (to 0.1 m)
  const permitAreas = [];
  for (const a of permits.areas) {
    const polys = a.geometry.type === 'MultiPolygon' ? a.geometry.coordinates : [a.geometry.coordinates];
    for (const poly of polys) {
      const ring = [];
      for (const [lon, lat] of poly[0]) { const p = project(lat, lon); ring.push(round(p.x), round(p.z)); }
      permitAreas.push([a.area, ring]);
    }
  }
  permitAreas.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1][0] - b[1][0]));
  const kinds = rules.reduce((m, r) => ((m[r[0]] = (m[r[0]] || 0) + 1), m), {});
  return {
    generator: 'tools/build-parking.mjs',
    source: {
      bylaws: { dataset: bylaws.source.dataset, page: bylaws.source.page, resourceId: bylaws.source.resourceId, modified: bylaws.source.resourceModified, fetchedAt: bylaws.source.fetchedAt, sha256: bylaws.source.sha256, licence: bylaws.source.licence },
      permits: { dataset: permits.source.dataset, page: permits.source.page, resourceId: permits.source.resourceId, modified: permits.source.resourceModified, fetchedAt: permits.source.fetchedAt, sha256: permits.source.sha256, licence: permits.source.licence }
    },
    counts: { records: bylaws.records.length, rules: rules.length, noParking: kinds[0] || 0, allowed: kinds[1] || 0, reserved: kinds[2] || 0, ...skipped, unresolved, permitAreas: permitAreas.length },
    // [kind (0 no parking, 1 allowed, 2 reserved), sides (bits: 1 north, 2 south, 4 east, 8 west), x0, z0, x1, z1, street, schedule]
    names, rules, permitAreas
  };
}

export const parkingJs = (PARKING) => '// js/toronto-parking.js — GENERATED by tools/build-parking.mjs, do not edit by hand. Where the City\'s by-laws\n' +
  '// let a car park at the curb (docs/parked-cars.md): the Chapter 950 curb schedules resolved onto the game\'s streets, and the\n' +
  '// permit parking areas. Source: City of Toronto Open Data, Traffic and Parking By-Law Schedules and On-Street Permit Parking\n' +
  '// Area Maps (Open Government Licence – Toronto).\n' +
  `(function () {\nwindow.CITY = window.CITY || {};\nwindow.CITY.PARKING = ${JSON.stringify(PARKING)};\n})();\n`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outArg = process.argv.indexOf('--out');
  const out = path.join(ROOT, outArg > 0 ? process.argv[outArg + 1] : 'js/toronto-parking.js');
  const bylaws = JSON.parse(fs.readFileSync(newest('parking-bylaws-'), 'utf8'));
  const permits = JSON.parse(fs.readFileSync(newest('permit-parking-'), 'utf8'));
  const PARKING = buildParking({ bylaws, permits, GEO: loadGeo() });
  const js = parkingJs(PARKING);
  fs.writeFileSync(out, js);
  console.log(`[parking] ${path.relative(ROOT, out)}: ${JSON.stringify(PARKING.counts)} (${js.length} bytes)`);
}
