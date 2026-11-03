(function () {
// js/seasons.js
// Seasons (docs/live-sky.md, "Seasons"): the scenery follows Toronto's real date the way the live sky follows its real
// time and weather. Pure logic only, no three.js: a calendar day turned into the trees' leaves and colour and the grass's
// tone, the snow lying on the ground from Pearson's condition and ECCC's daily snow-on-ground record, that record's
// fetch & cache, and the capture-only date override. main.js writes the result into the scene's season uniforms
// (tsl-materials.js cityUniforms: uLeaf, uAutumn, uSpring, uDormant, uSnow); tests load this file in node.
//
// The presets keep the classic summer look: 22 August (lighting.js SCENE_DATE), where every value below is the shaders'
// identity (full green crowns, summer lawns, no snow).

const TZ = 'America/Toronto';
const SUMMER_DATE = Object.freeze({ month: 8, day: 22 });

// Day of the year, 1-365, on a common-year calendar (29 February counts as 28 February: the curves are about weather,
// not the calendar)
const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
function dayOfYear({ month, day }) {
  const m = Math.min(12, Math.max(1, Math.trunc(month)));
  const len = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return MONTH_START[m - 1] + Math.min(len, Math.max(1, Math.trunc(day)));
}
const doy = (month, day) => dayOfYear({ month, day });

// Toronto's calendar day at an instant: { year, month, day }
function torontoDate(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(date).map((p) => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

// ---------------------------------------------------------------------------------------------------------------------
// The year as keyframes on the day of the year: [day, value], smoothstepped between neighbours, held flat outside them.
// Toronto's street trees (Norway & silver maples, honey locusts, lindens, oaks) leaf out from mid-April and are in full
// leaf by mid-May; the colour starts in mid-September and peaks in mid to late October; the leaves come down from late
// October and the crowns are bare by late November until April. Lawns green up in April and go dormant, tan and olive,
// through November. Conifers keep their needles (ez-trees.js gives them none of this).
// ---------------------------------------------------------------------------------------------------------------------
const CURVES = Object.freeze({
  // deciduous leaves on the trees: 1 full crowns .. 0 bare
  leaf: [[doy(4, 15), 0], [doy(5, 12), 1], [doy(10, 22), 1], [doy(11, 6), 0.55], [doy(11, 24), 0]],
  // autumn colour of the leaves still on: 0 summer green .. 1 every tree turned (each tree turns at its own time)
  autumn: [[doy(9, 12), 0], [doy(10, 16), 1]],
  // spring's fresh, yellower green: new leaves and new grass
  spring: [[doy(4, 8), 0], [doy(4, 25), 1], [doy(5, 20), 1], [doy(6, 15), 0]],
  // dormant grass: 0 summer lawns .. 1 winter's tan and olive
  dormant: [[doy(3, 25), 1], [doy(4, 28), 0], [doy(10, 20), 0], [doy(12, 1), 1]]
});
const smooth = (t) => t * t * (3 - 2 * t);
// (before its first key a curve holds its first value: `dormant` carries winter over the new year, and `autumn` is 0
// again from 1 January, when there are no leaves left to colour)
function curveAt(keys, d) {
  if (d <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [d1, v1] = keys[i];
    if (d <= d1) {
      const [d0, v0] = keys[i - 1];
      return v0 + (v1 - v0) * smooth((d - d0) / (d1 - d0));
    }
  }
  return keys[keys.length - 1][1];
}
const round = (v) => Math.round(v * 1000) / 1000;
function phaseOf(s) {
  if (s.leaf <= 0.02) return 'winter';
  if (s.spring > 0.02 && s.autumn === 0) return 'spring';
  if (s.autumn > 0.02) return 'autumn';
  return 'summer';
}

/**
 * The scenery's season on a calendar day: { month, day, doy, leaf, autumn, spring, dormant, phase }. `date` is a
 * { month, day } (as SCENE_DATE) or a Date (Toronto's day at that instant). 22 August gives the classic summer look:
 * leaf 1, autumn, spring and dormant 0.
 */
function seasonFor(date) {
  const md = date instanceof Date || (date && typeof date.getTime === 'function') ? torontoDate(date) : date;
  if (!md || !Number.isFinite(md.month) || !Number.isFinite(md.day)) throw new Error('seasonFor needs a Date or { month, day }');
  const d = dayOfYear(md);
  const s = {
    month: md.month,
    day: md.day,
    doy: d,
    leaf: round(curveAt(CURVES.leaf, d)),
    autumn: round(curveAt(CURVES.autumn, d)),
    spring: round(curveAt(CURVES.spring, d)),
    dormant: round(curveAt(CURVES.dormant, d))
  };
  s.phase = phaseOf(s);
  return s;
}
const SUMMER = Object.freeze(seasonFor(SUMMER_DATE));

// ---------------------------------------------------------------------------------------------------------------------
// Snow on the ground. Pearson's current condition says whether it is snowing now; ECCC's daily climate record for
// Toronto Pearson (climate ID 6158731, "TORONTO INTL A") says how much snow lies on the ground (SNOW_ON_GROUND, cm,
// read each morning) and how much fell (TOTAL_SNOW, cm). The record is only asked for in the months snow can lie, and is
// a day behind at best.
// ---------------------------------------------------------------------------------------------------------------------
const CLIMATE_URL = 'https://api.weather.gc.ca/collections/climate-daily/items?f=json&lang=en&CLIMATE_IDENTIFIER=6158731' +
  '&sortby=-LOCAL_DATE&limit=5&properties=LOCAL_DATE,SNOW_ON_GROUND,TOTAL_SNOW,MAX_TEMPERATURE';
const CLIMATE_CACHE_KEY = 'slop-toronto:snow';
const CLIMATE_CACHE_MS = 60 * 60 * 1000;
const CLIMATE_MAX_AGE_DAYS = 3; // a record older than this says nothing about today
const FETCH_TIMEOUT_MS = 4000;

// From 15 October to 30 April: the months the record is worth asking for (Toronto's earliest and latest snowfalls)
function snowSeason(md) {
  const d = dayOfYear(md);
  return d >= doy(10, 15) || d <= doy(4, 30);
}

// The record from the API's GeoJSON: { date ('YYYY-MM-DD', the latest day), snowOnGround (cm or null), recentSnow (cm
// fallen over the days given), maxTemp (°C or null) }, or null for a payload we can't read
function parseClimate(json) {
  try {
    const days = json.features.map((f) => f.properties)
      .filter((p) => p && typeof p.LOCAL_DATE === 'string')
      .map((p) => ({ date: p.LOCAL_DATE.slice(0, 10), sog: p.SNOW_ON_GROUND, snow: p.TOTAL_SNOW, max: p.MAX_TEMPERATURE }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    if (!days.length) return null;
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const sogDay = days.find((d) => num(d.sog) !== null);
    const maxDay = days.find((d) => num(d.max) !== null);
    return {
      date: days[0].date,
      snowOnGround: sogDay ? num(sogDay.sog) : null,
      snowOnGroundDate: sogDay ? sogDay.date : null,
      recentSnow: days.slice(0, 3).reduce((s, d) => s + (num(d.snow) || 0), 0),
      maxTemp: maxDay ? num(maxDay.max) : null
    };
  } catch {
    return null;
  }
}
// Days between a 'YYYY-MM-DD' record date and the instant `now` (ms)
const daysSince = (ymd, now) => (now - Date.parse(`${ymd}T12:00:00-05:00`)) / 86400000;

/**
 * How much snow lies on the ground: 0 none .. 1 a full cover (tsl-materials.js uSnow).
 * - weatherKey: live-sky.js's kind of weather now ('snow' is falling snow), temp: Pearson's temperature (°C)
 * - record: parseClimate's record (or null), now: the instant (ms) it is judged at
 * Falling snow whitens the ground at once (less when it is above freezing and melts as it lands). Lying snow comes from
 * the morning's snow-on-ground depth (1 cm: a thin, patchy cover; 10 cm and more: all white), or from a fall of 1 cm or
 * more over the last three days while the days stayed cold. Above 4 °C what lies on the ground thins out (to a third by
 * 14 °C), as it melts in the open first.
 */
function snowCover({ weatherKey = null, temp = null, record = null, now = Date.now() } = {}) {
  const t = typeof temp === 'number' && Number.isFinite(temp) ? temp : null;
  let falling = 0;
  if (weatherKey === 'snow') falling = t === null || t <= 1 ? 0.9 : Math.max(0.35, 0.9 - (t - 1) * 0.14);
  let lying = 0;
  if (record && record.date && daysSince(record.date, now) <= CLIMATE_MAX_AGE_DAYS) {
    const sog = record.snowOnGround;
    if (typeof sog === 'number' && sog >= 1 && (!record.snowOnGroundDate || daysSince(record.snowOnGroundDate, now) <= CLIMATE_MAX_AGE_DAYS)) {
      lying = Math.min(1, 0.45 + sog * 0.055);
    } else if (record.recentSnow >= 1 && (record.maxTemp === null || record.maxTemp <= 3)) {
      lying = Math.min(0.6, 0.3 + record.recentSnow * 0.05);
    }
    if (t !== null && t > 4) lying *= Math.max(1 / 3, 1 - (t - 4) / 15);
  }
  return round(Math.min(1, Math.max(falling, lying)));
}

function safeSession() {
  try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch { return null; }
}
// The latest record, from the tab's cache (an hour) or the API; null on any failure or a slow API. Never throws.
async function fetchSnowRecord({ fetchImpl = globalThis.fetch, storage = safeSession(), now = Date.now, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  try {
    const cached = storage && JSON.parse(storage.getItem(CLIMATE_CACHE_KEY) || 'null');
    if (cached && now() - cached.at < CLIMATE_CACHE_MS && cached.data) return cached.data;
  } catch { /* storage blocked: fetch instead */ }
  if (typeof fetchImpl !== 'function') return null;
  const abort = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = 0;
  try {
    const timeout = new Promise((resolve) => { timer = setTimeout(() => { abort?.abort(); resolve(null); }, timeoutMs); });
    const request = (async () => {
      const res = await fetchImpl(CLIMATE_URL, { signal: abort?.signal, credentials: 'omit' });
      if (!res || !res.ok) return null;
      return parseClimate(await res.json());
    })().catch(() => null);
    const data = await Promise.race([request, timeout]);
    if (data) try { storage?.setItem(CLIMATE_CACHE_KEY, JSON.stringify({ at: now(), data })); } catch { /* fine */ }
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The capture-only overrides, honoured exactly where live-sky.js honours ?liveClock= and ?liveWeather= (under
// automation, navigator.webdriver): ?liveDate=YYYY-MM-DD (or MM-DD) sets the scenery's day while live, whatever the
// fixture's clock says, so one light can be compared across the seasons; ?liveSnow=<cm> stands in for the morning's
// snow-on-ground record. Both only matter while live: a preset is summer. Outside automation they are ignored.
// ---------------------------------------------------------------------------------------------------------------------
function parseDay(text) {
  const m = /^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})$/.exec(String(text || '').trim());
  if (!m) return null;
  const month = Number(m[2]), day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]) return null;
  return { year: m[1] ? Number(m[1]) : null, month, day };
}
function resolveCapture({ search = '', webdriver = false } = {}) {
  if (webdriver !== true) return { fixedDate: null, fixedSnowCm: null };
  const q = new URLSearchParams(search);
  const fixedDate = q.has('liveDate') ? parseDay(q.get('liveDate')) : null;
  const cm = q.has('liveSnow') ? Number(q.get('liveSnow')) : NaN;
  return { fixedDate, fixedSnowCm: Number.isFinite(cm) && cm >= 0 ? cm : null };
}
// A stand-in record for ?liveSnow=<cm>: that much on the ground this morning, on a cold day
function fixtureRecord(cm, now = Date.now()) {
  const date = torontoDate(new Date(now));
  const ymd = `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
  return { date: ymd, snowOnGround: cm, snowOnGroundDate: ymd, recentSnow: 0, maxTemp: -3 };
}

// ---------------------------------------------------------------------------------------------------------------------
// The scenery built once at load (the rinks' ice, the CaféTO patios and the bikeways bent round them: geometry,
// colliders and routes, not uniforms) follows the day the city opens on, chosen here before any of it is built. A city
// that opens live stands on Toronto's date (a capture fixture's ?liveDate=, else its ?liveClock= day); one that opens on
// a preset (?time=<preset>, and every automated capture without a fixture) on the classic 22 August. The day is not
// revisited: a visit rarely crosses a season's edge, and a later preset or Live press only writes the sky's and the
// trees' uniforms (docs/live-sky.md, "Seasons").
// ---------------------------------------------------------------------------------------------------------------------
function siteDay({ startup = null, capture = null, now = new Date() } = {}) {
  if (!startup || startup.mode !== 'live') return { month: SUMMER_DATE.month, day: SUMMER_DATE.day, source: 'preset' };
  if (capture?.fixedDate) return { month: capture.fixedDate.month, day: capture.fixedDate.day, source: 'liveDate' };
  if (startup.fixedClock) {
    const d = torontoDate(startup.fixedClock);
    return { month: d.month, day: d.day, source: 'liveClock' };
  }
  const d = torontoDate(now);
  return { month: d.month, day: d.day, source: 'live' };
}

const SEASONS = {
  TZ, SUMMER_DATE, SUMMER, CURVES, CLIMATE_URL, CLIMATE_CACHE_KEY, CLIMATE_CACHE_MS, CLIMATE_MAX_AGE_DAYS, FETCH_TIMEOUT_MS,
  dayOfYear, torontoDate, curveAt, seasonFor, snowSeason, parseClimate, snowCover, fetchSnowRecord, parseDay, resolveCapture,
  fixtureRecord, siteDay
};
if (typeof window !== 'undefined' && window.CITY) {
  window.CITY.SEASONS = SEASONS;
  // CITY.SITE_DATE: the day the load-built scenery stands on (siteDay), read by rinks.js, cafeto-patios.js and
  // cycling.js. explore.html loads live-sky.js and this file before them; the same rules as main.js's opening mode.
  const LIVE = window.CITY.LIVE_SKY;
  if (LIVE && typeof location !== 'undefined') {
    const webdriver = typeof navigator !== 'undefined' && navigator.webdriver === true;
    window.CITY.SITE_DATE = Object.freeze(siteDay({ startup: LIVE.resolveStartup({ search: location.search, webdriver }),
      capture: resolveCapture({ search: location.search, webdriver }) }));
  }
}
if (typeof module !== 'undefined' && module.exports) module.exports = SEASONS;
})();
