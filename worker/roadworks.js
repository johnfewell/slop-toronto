// worker/roadworks.js: the City of Toronto's Road Restrictions feed (Open Government Licence - Toronto), cut down to
// compact records for the game's /live/roadworks route (worker/live.js). Pure functions, no network: tests/roadworks.test.mjs
// runs them on real records. The feed itself is https://secure.toronto.ca/opendata/cart/road_restrictions/v3?format=json
// (the dataset's "Road Restrictions (Version 3) - JSON" resource; ~3 MB, ~2,100 records, rebuilt by the City every few minutes).
//
// The City cautions that the records are submitted by the permit applicants and are not field verified, and they carry no
// lane geometry: a centre-line polyline of the stretch, a start and end date, a daily schedule and a free-text description.
// The game draws them as the City's *reported* closures, never as live truth (js/roadworks.js).

export const FEED = 'https://secure.toronto.ca/opendata/cart/road_restrictions/v3?format=json';
// A box around every playable frame (today's map: lat 43.590-43.684, lon -79.490 to -79.319; ?map=eglinton: north to
// Eglinton and east of the Don). The page clips to the frame it loaded.
export const BOUNDS = { lat0: 43.585, lat1: 43.760, lon0: -79.510, lon1: -79.250 };

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const text = (v, max) => {
  if (typeof v !== 'string') return '';
  const s = v.replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
};

// The "[lon,lat],[lon,lat]" polyline of a record as [[lat, lon], ...] with the feed's doubled vertices dropped
export function parsePolyline(s) {
  if (typeof s !== 'string') return [];
  const out = [];
  for (const m of s.matchAll(/\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/g)) {
    const lon = Number(m[1]), lat = Number(m[2]);
    if (!(lat > 40 && lat < 50 && lon > -85 && lon < -75)) continue;
    const p = out[out.length - 1];
    if (!p || p[0] !== lat || p[1] !== lon) out.push([lat, lon]);
  }
  return out;
}

// The permit's work type: usually plain text, sometimes a JSON table ({"tabledata":[{"Option":"Toronto Water",...}]})
export function workType(r) {
  for (const v of [r.workEventType, r.source, r.permitType]) {
    if (typeof v !== 'string' || !v) continue;
    const m = /"Option"\s*:\s*"([^"]+)"/.exec(v);
    if (m) return m[1];
    if (!v.startsWith('{')) return text(v, 60);
  }
  return '';
}

// Daily schedules as seven strings, Sunday first ('' = no work that weekday), from the feed's scheduleMonday ... fields
// (each "HH:MM-HH:MM") and scheduleEveryday. Null when the record gives no schedule at all.
export function schedule(r) {
  const every = typeof r.scheduleEveryday === 'string' && r.scheduleEveryday ? r.scheduleEveryday : '';
  const per = DAYS.map((d) => { const v = r['schedule' + d]; return typeof v === 'string' && v ? v : ''; });
  if (!every && !per.some(Boolean)) return null;
  return per.map((v) => v || every);
}

// One feed record as the game's compact record, or null (with `why` counted by the caller) when it cannot be placed
export function compact(r) {
  const lat = num(r.latitude), lon = num(r.longitude);
  const line = parsePolyline(r.geoPolyline);
  if (!line.length && Number.isFinite(lat) && Number.isFinite(lon)) line.push([lat, lon]);
  if (!line.length) return { why: 'no-location' };
  const s = num(r.startTime), e = num(r.endTime);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return { why: 'no-dates' };
  const type = r.type === 'ROAD_CLOSED' ? 'R' : r.type === 'CONSTRUCTION' ? 'C' : '';
  if (!type) return { why: 'type' };
  return { rec: {
    i: String(r.id), r: text(r.road, 60), n: text(r.name, 140), t: type, s, e,
    d: r.directionsAffected === 'BOTH_DIRECTIONS' ? 2 : 1,
    k: text(r.roadClass, 30), de: text(String(r.description || '').replace(/^Toronto-TMC:\s*/i, ''), 300),
    w: text(r.workPeriod, 30), sc: schedule(r), ci: text(r.currImpact, 12), by: workType(r),
    u: Number.isFinite(num(r.lastUpdated)) ? num(r.lastUpdated) : 0, ll: line
  } };
}

// The whole feed (parsed JSON: { Closure: [...] }) to { records, counts }: the records inside the box that have not ended
// before `now - graceMs`, and what was dropped and why
export function parseRestrictions(json, { now = Date.now(), bounds = BOUNDS, graceMs = 86400000 } = {}) {
  const list = json && Array.isArray(json.Closure) ? json.Closure : null;
  if (!list) throw new Error('Road Restrictions feed has no Closure list');
  const counts = { feed: list.length, kept: 0, outside: 0, ended: 0, 'no-location': 0, 'no-dates': 0, type: 0 };
  const records = [];
  for (const r of list) {
    const c = compact(r || {});
    if (!c.rec) { counts[c.why]++; continue; }
    const rec = c.rec;
    if (!rec.ll.some(([la, lo]) => la > bounds.lat0 && la < bounds.lat1 && lo > bounds.lon0 && lo < bounds.lon1)) { counts.outside++; continue; }
    if (rec.e < now - graceMs) { counts.ended++; continue; }
    records.push(rec);
  }
  counts.kept = records.length;
  return { records, counts };
}

// ---------------------------------------------------------------------------------------------------------------------
// TTC detours. The City's road restrictions do not carry the TTC's diversion. alerts.ttc.ca/api/alerts/site-wide is the
// live list (often empty). The TTC homepage server-renders the surface detours it is showing, as a route number and the
// stretch that is off, not the street the buses use. A "via" / "along" street in either text is the published path.
// ---------------------------------------------------------------------------------------------------------------------
const STREET_END = '(?:St|Street|Ave|Avenue|Av|Rd|Road|Blvd|Boulevard|Dr|Drive|Cres|Crescent|Pkwy|Parkway|Lane|Ln|Way|Quay|Ter|Terrace|Pl|Place)';

/** Street names named after "via" or "along" in a detour notice. Location text with no via/along yields none. */
export function viaStreets(text) {
  const hits = [];
  const re = /(?:\bvia\b|\balong\b)\s+([^.;]{0,80})/gi;
  let m;
  while ((m = re.exec(String(text || '')))) {
    for (let part of m[1].split(/\s+(?:and\s+then|and|then|&)\s+|,\s*/i)) {
      part = part.replace(/^(?:then|and)\s+/i, '').replace(/\s+\b(?:to|from|between|at|the|a)\b[\s\S]*$/i, '').trim();
      if (part.length > 60) continue;
      if (new RegExp(`\\b${STREET_END}\\b`, 'i').test(part)) hits.push(part);
    }
  }
  return [...new Set(hits)];
}

/** { route, location, via } from the site-wide alerts JSON. An empty or unexpected body is an empty list. */
export function detoursFromAlerts(json) {
  if (!json || typeof json !== 'object') return [];
  const out = [];
  const take = (route, title, location) => {
    const rt = String(route ?? '').match(/\d{1,3}/);
    const blob = `${title || ''} ${location || ''}`;
    if (!rt || !/detour/i.test(blob)) return;
    out.push({ route: rt[0], location: String(location || title || '').replace(/\s+/g, ' ').trim().slice(0, 240), via: viaStreets(blob) });
  };
  const routes = Array.isArray(json.routes) ? json.routes : [];
  for (const r of routes) {
    const route = r && (r.route || r.routeNumber || r.routeName || r.id || r.name);
    const alerts = r && (Array.isArray(r.alerts) ? r.alerts : Array.isArray(r.items) ? r.items : [r]);
    for (const a of alerts || []) {
      if (!a || typeof a !== 'object') continue;
      take(a.route || route, a.title || a.alertTitle || a.header || a.effect || a.effectDesc || '', a.location || a.alertLocation || a.description || a.body || a.message || '');
    }
  }
  return out;
}

/** Surface detours server-rendered on ttc.ca: route icon, "Detour", then the alert-location line. */
export function parseTtcHomepage(html) {
  const out = [];
  const re = /RouteNameIcon[^>]*>(\d{1,3})<\/span>[\s\S]{0,900}?alert-title">([^<]*)<\/div>[\s\S]{0,500}?alert-location">([^<]*)<\/div>/g;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const title = m[2].replace(/\s+/g, ' ').trim();
    if (!/detour/i.test(title)) continue;
    const location = m[3].replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    out.push({ route: m[1], location, via: viaStreets(`${title} ${location}`) });
  }
  return out;
}

/** Alerts first, then homepage rows whose route and location are not already present. */
export function mergeDetours(alerts, homepage) {
  const out = [];
  const seen = new Set();
  for (const d of [...(alerts || []), ...(homepage || [])]) {
    if (!d || !d.route) continue;
    const key = `${d.route}|${String(d.location || '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ route: String(d.route), location: d.location || '', via: Array.isArray(d.via) ? d.via : [] });
  }
  return out;
}
