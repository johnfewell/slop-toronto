import boundary from './geocode-boundary.json' with { type: 'json' };

export const ION = 'https://api.cesium.com/v1/geocode/search';
export const MAX_LEN = 80;
export const MIN_LEN = 2;
export const MAX_RESULTS = 5;
export const BACKOFF_S = 3600; // after ion refuses (429 or 403), seconds before asking again
export const ATTRIBUTION = 'Cesium ion geocoder; Microsoft Bing';
// The City's Regional Municipal Boundary, simplified to 25 m.
function inCity(lat, lon) {
  const ring = boundary.polygon;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [aLat, aLon] = ring[i], [bLat, bLon] = ring[j];
    if ((aLat > lat) !== (bLat > lat) && lon < aLon + (bLon - aLon) * (lat - aLat) / (bLat - aLat)) inside = !inside;
  }
  return inside;
}

/** The query as sent: trimmed, spaces collapsed, control characters dropped; null when too short or too long. */
export function normalise(q) {
  if (typeof q !== 'string') return null;
  const s = q.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length < MIN_LEN || s.length > MAX_LEN) return null;
  return s;
}
/** The cache-free key two identical requests in flight share: the query folded to lower case. */
export const keyOf = (q) => q.toLowerCase();

/**
 * The request to ion for query q: Toronto bias in the text (ion's Bing backend ignores Pelias' focus.point and
 * boundary.rect parameters: checked 2026-11-05), the default geocoder (no `geocoder` parameter: Bing; never Google).
 */
export function ionRequest(q, token) {
  const text = /\btoronto\b/i.test(q) ? q : `${q}, Toronto, ON`;
  const url = `${ION}?text=${encodeURIComponent(text)}`;
  // Keep the bearer token confined to ion. The Worker handles a 3xx like other upstream errors.
  return { url, init: { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, cf: { cacheTtl: 0 }, redirect: 'manual', signal: AbortSignal.timeout(8000) } };
}

// ---- which answers fit -------------------------------------------------------------------------------------------
const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’`]/g, '');
const wordsOf = (s) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);
// words that say nothing about which place: the bias we add, the province, small words
const NOISE = new Set(['the', 'of', 'and', 'a', 'an', 'at', 'in', 'on', 'ont', 'ontario', 'toronto', 'canada', 'city', 'ca']);
const significant = (s) => wordsOf(s).filter((w) => !NOISE.has(w) && (w.length >= 3 || /\d/.test(w)));
/** One letter added, dropped, changed, or two neighbours swapped ("kensignton"). */
function editWithin1(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const d = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d.push(i);
    if (d.length === 2 && d[1] === d[0] + 1 && a[d[0]] === b[d[1]] && a[d[1]] === b[d[0]]) return true;
  }
  let i = 0, j = 0, d = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++d > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return d + (a.length - i) + (b.length - j) <= 1;
}
/** Query word q fits label word l: the same, a prefix either way (3+ letters), or one edit (5+ letters). */
const wordFits = (q, l) => q === l || (q.length >= 3 && l.startsWith(q)) || (l.length >= 3 && q.startsWith(l)) || (q.length >= 5 && editWithin1(q, l));
/**
 * Whether a result's label names what the query asked for: at least two thirds of the query's meaningful words are in
 * it (a prefix or one typo allowed), so "Queen and Spadina" is not answered by "Spadina" alone.
 */
export function relevant(q, label) {
  const qs = significant(q), ls = wordsOf(label).filter((w) => !NOISE.has(w));
  if (!qs.length || !ls.length) return false;
  const hit = qs.filter((w) => ls.some((l) => wordFits(w, l))).length;
  return hit >= Math.ceil((qs.length * 2) / 3);
}
/**
 * The label for the list: ion's "Sneaky Dee's, ON" or "100 Queen St W, Toronto, ON M5H 2N2" without the province, its
 * postal code, the country and "Toronto" (the map says that already); a former municipality stays ("300 Borough Dr,
 * Scarborough"). A label that is a postal code stays one.
 */
export function tidyLabel(label) {
  const s = String(label).trim();
  if (/^[a-z]\d[a-z]\s?\d[a-z]\d\b/i.test(s)) return s.replace(/(,\s*(ON|Ontario|Canada|Toronto))+\s*$/i, '').trim();
  return s.replace(/,\s*Canada\s*$/i, '').replace(/,\s*(ON|Ontario)(\s+[a-z]\d[a-z](\s?\d[a-z]\d)?)?\s*$/i, '')
    .replace(/,\s*Toronto(?=,|$)/i, '').replace(/(,\s*(ON|Ontario|Toronto))+\s*$/i, '').trim();
}
/** "Postal code" for a Canadian postal code, "Address" when the label starts with a street number, else "Place". */
export const kindOf = (label) => (/^[a-z]\d[a-z]\s?\d[a-z]\d$/i.test(label) ? 'Postal code' : /^\d+[a-z]?\s/i.test(label) ? 'Address' : 'Place');

/**
 * ion's answer (a GeoJSON FeatureCollection, Pelias-style: properties.label, a bbox and/or a point) cut to what the
 * map uses: [{ name, kind, lat, lon, bbox: [w, s, e, n] | null }], inside the City, relevant to q, no "Toronto" alone,
 * at most MAX_RESULTS, the same place once.
 */
export function parseIon(json, q) {
  const out = [];
  const seen = new Set();
  for (const f of Array.isArray(json?.features) ? json.features : []) {
    const label = f && f.properties && f.properties.label;
    if (!label) continue;
    let lat, lon, bbox = null;
    if (Array.isArray(f.bbox) && f.bbox.length === 4 && f.bbox.every(Number.isFinite)) {
      bbox = f.bbox.map((v) => Math.round(v * 1e6) / 1e6);
      lon = (f.bbox[0] + f.bbox[2]) / 2; lat = (f.bbox[1] + f.bbox[3]) / 2;
    }
    const c = f.geometry && f.geometry.type === 'Point' && f.geometry.coordinates;
    if (c && Number.isFinite(c[0]) && Number.isFinite(c[1])) { lon = c[0]; lat = c[1]; }
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inCity(lat, lon)) continue;
    // a box bigger than ~4 km is a district or the City itself, not a place to fly to
    if (bbox && (bbox[2] - bbox[0] > 0.05 || bbox[3] - bbox[1] > 0.036)) continue;
    const name = tidyLabel(label);
    if (!name || /^toronto$/i.test(name) || !relevant(q, name)) continue;
    const k = name.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ name, kind: kindOf(name), lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, bbox });
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

// ---- who may ask ---------------------------------------------------------------------------------------------------
/** Check the browser’s same-origin headers. The rate limits also apply to clients outside a browser. */
export function fromPage(request) {
  const url = new URL(request.url);
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  const o = request.headers.get('origin') || request.headers.get('referer');
  if (!o) return false;
  try { return new URL(o).origin === url.origin; } catch { return false; }
}

// ---- ion's own refusal: stop asking for a while (a flag, not content: nothing of ion's answer is kept) ------------
let refusedUntil = 0;
/** (tests) forget a refusal */
export const resetGeocode = () => { refusedUntil = 0; inFlight.clear(); };
const refused = (now) => now < refusedUntil;

// ---- the route -----------------------------------------------------------------------------------------------------
const inFlight = new Map(); // key -> Promise<results>: identical requests at the same moment share one call (not a cache)
/**
 * Answer /live/geocode. Returns { status, body } (live.js sets the HTTP headers). deps.fetch is the upstream fetch.
 */
export async function geocode(request, env, deps = {}) {
  const doFetch = deps.fetch || fetch;
  if (request.method !== 'GET') return { status: 405, body: { error: 'GET only' } };
  if (!fromPage(request)) return { status: 403, body: { error: 'for the map page only' } };
  const q = normalise(new URL(request.url).searchParams.get('q'));
  if (!q) return { status: 400, body: { error: `q: ${MIN_LEN}-${MAX_LEN} characters` } };
  const token = env.ION_GEOCODE_TOKEN;
  if (!token) return { status: 503, body: { error: 'geocoding is off' } };
  const now = deps.now ? deps.now() : Date.now();
  if (refused(now)) return { status: 429, body: { error: 'place search is resting; try again later' }, retryAfter: Math.ceil((refusedUntil - now) / 1000) };
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (!env.GEOCODE_IP || !env.GEOCODE_ALL) return { status: 503, body: { error: 'geocoding is off' } };
  const { success } = await env.GEOCODE_IP.limit({ key: 'ip:' + ip });
  if (!success) return { status: 429, body: { error: 'too many searches; try again in a minute' }, retryAfter: 60 };
  const k = keyOf(q);
  let p = inFlight.get(k);
  if (!p) {
    // (set in the same turn as the get above, so a second identical request finds it)
    p = (async () => {
      const { success } = await env.GEOCODE_ALL.limit({ key: 'all' });
      if (!success) { const e = new Error('busy'); e.status = 429; e.busy = true; throw e; }
      const { url, init } = ionRequest(q, token);
      const res = await doFetch(url, init);
      if (res.status === 429 || res.status === 403) { refusedUntil = now + BACKOFF_S * 1000; const e = new Error('ion ' + res.status); e.status = 429; throw e; }
      if (!res.ok) { const e = new Error('ion ' + res.status); e.status = 502; throw e; }
      return parseIon(await res.json(), q).map(({ name, kind, lat, lon }) => ({ name, kind, lat, lon }));
    })();
    inFlight.set(k, p);
    p.finally(() => inFlight.delete(k)).catch(() => {});
  }
  try {
    return { status: 200, body: { q, results: await p, source: ATTRIBUTION } };
  } catch (e) {
    if (e.busy) return { status: 429, body: { error: 'place search is busy; try again in a minute' }, retryAfter: 60 };
    if (e.status === 429) return { status: 429, body: { error: 'place search is resting; try again later' }, retryAfter: BACKOFF_S };
    return { status: 502, body: { error: 'the geocoder did not answer' } };
  }
}
