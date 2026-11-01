(function () {
// js/live-sky.js
// Live sky (docs/live-sky.md): the city opens at Toronto's real time of day and under the weather Pearson reports now.
// Pure logic only, no three.js: the sun's position for any instant, ECCC's observed condition turned into the look the
// engine can show, the reading's cache, timeout & staleness rules, and which mode the app opens in. lighting.js blends
// the time presets with it, sky-clouds.js sets the clouds, main.js runs it. Tests load this file in node.

const TORONTO = Object.freeze({ lat: 43.65, lon: -79.38, tz: 'America/Toronto' });
const PRESET_IDS = Object.freeze(['golden', 'midday', 'twilight', 'midnight']);

// The same keyless ECCC MSC GeoMet feed, cache key & rules as the landing page (js/landing.js): Toronto Pearson's latest
// observation, kept 10 minutes per tab, ignored when it is over three hours old
const FEED_URL = 'https://api.weather.gc.ca/collections/citypageweather-realtime/items?f=json&lang=en&identifier=on-143&limit=1';
const CACHE_KEY = 'slop-toronto:weather';
const CACHE_MS = 10 * 60 * 1000;
const MAX_AGE_MS = 3 * 3600 * 1000;
const FETCH_TIMEOUT_MS = 4000;

// ---------------------------------------------------------------------------------------------------------------------
// The sun: NOAA's solar position equations (the ones lighting.js has always lit its presets with) for any instant at
// latitude / longitude (degrees, east positive). Elevation without refraction; azimuth clockwise from true north.
// ---------------------------------------------------------------------------------------------------------------------
function solarPosition(date, lat = TORONTO.lat, lon = TORONTO.lon) {
  const rad = Math.PI / 180;
  const jd = date.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * rad) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * rad);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * rad);
  const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad));
  const y = Math.tan((eps / 2) * rad) ** 2;
  const eqTime = 4 / rad * (y * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad) + 4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad) -
    0.5 * y * y * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * M * rad)); // minutes
  const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const tst = (utcMin + eqTime + 4 * lon) % 1440; // true solar time (min)
  const ha = (tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180) * rad;
  const la = lat * rad;
  const zen = Math.acos(Math.min(1, Math.max(-1, Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha))));
  let az = Math.acos(Math.min(1, Math.max(-1, ((Math.sin(la) * Math.cos(zen)) - Math.sin(decl)) / (Math.cos(la) * Math.sin(zen))))) / rad;
  az = ha > 0 ? (az + 180) % 360 : (540 - az) % 360;
  return { elevation: 90 - zen / rad, azimuth: az };
}

// Toronto's wall clock at an instant: { hour (decimal 0-24), label ("4:12 pm") }
function torontoClock(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TORONTO.tz, hour: 'numeric', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).map((p) => [p.type, p.value]));
  const h = Number(parts.hour) % 24, m = Number(parts.minute);
  const label = new Intl.DateTimeFormat('en-CA', { timeZone: TORONTO.tz, hour: 'numeric', minute: '2-digit', hour12: true })
    .format(date).replace(/\./g, '').toLowerCase();
  return { hour: h + m / 60, label };
}

// ---------------------------------------------------------------------------------------------------------------------
// The four presets as anchors along the sun's elevation (degrees): night from 9 degrees down (between civil and nautical
// twilight's end), the sunset light as the sun sets, golden hour 10 degrees up, the midday look from 32 degrees (an October noon reaches 33).
// Between two anchors the weights cross over smoothly; they always sum to 1. Morning takes the same light as evening.
// ---------------------------------------------------------------------------------------------------------------------
const ANCHORS = [['midnight', -9], ['twilight', -1], ['golden', 10], ['midday', 32]];
function presetWeights(elevation) {
  const w = { golden: 0, midday: 0, twilight: 0, midnight: 0 };
  if (!(elevation > ANCHORS[0][1])) { w.midnight = 1; return w; }
  if (elevation >= ANCHORS[ANCHORS.length - 1][1]) { w.midday = 1; return w; }
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const [a, ea] = ANCHORS[i], [b, eb] = ANCHORS[i + 1];
    if (elevation <= eb) {
      const t = (elevation - ea) / (eb - ea);
      const s = t * t * (3 - 2 * t);
      w[a] = 1 - s; w[b] = s;
      return w;
    }
  }
  return w;
}
// The preset with the largest weight: what the id-keyed parts of the city (audio, transit headways, photo mode) read
const dominantPreset = (w) => PRESET_IDS.reduce((best, id) => (w[id] > w[best] ? id : best), 'golden');

// ---------------------------------------------------------------------------------------------------------------------
// ECCC's observed condition -> the closest look the engine can show. First match wins: precipitation, then obscuration
// (fog, mist, haze, smoke), then cloud cover. ECCC words its conditions "Sunny", "Mainly Clear", "Partly Cloudy",
// "Mostly Cloudy", "Cloudy", "Fog Patches", "Light Rainshower", "Light Snow and Blowing Snow", "Thunderstorm with Rain"...
// ---------------------------------------------------------------------------------------------------------------------
const CONDITION_RULES = [
  [/thunder|lightning|funnel|tornado/i, 'thunderstorm'],
  [/freezing|ice pellet|sleet|hail/i, 'freezingRain'],
  [/snow|flurr|ice crystal/i, 'snow'],
  [/shower/i, 'showers'],
  [/drizzle/i, 'drizzle'],
  [/rain|precipitation/i, 'rain'],
  [/fog/i, 'fog'],
  [/mist/i, 'mist'],
  [/haze|smoke|dust|ash/i, 'haze'],
  [/overcast|^\s*cloudy\b(?!\s*period)/i, 'overcast'],
  [/mostly cloudy|increasing cloud/i, 'mostlyCloudy'],
  [/partly|cloudy periods|variable cloud|sunny period|clearing/i, 'partlyCloudy'],
  [/mainly (sunny|clear)|mostly (sunny|clear)|a few clouds/i, 'mainlyClear'],
  [/sunny|clear/i, 'clear']
];
function classifyCondition(text) {
  if (typeof text !== 'string' || !text.trim() || /not observed|n\/a|unavailable/i.test(text)) return null;
  for (const [re, key] of CONDITION_RULES) if (re.test(text)) return key;
  return null;
}

// What each kind of weather does to the scene. cloud: the volumetric cloud type (one of the cloud library's single-layer
// presets, so a change is a uniform write, never a shader rebuild) & its coverage; sun / hemi: multipliers on the direct
// sun & sky fill (an overcast sun throws faint shadows); grey: how far the light & the sky dome go toward neutral grey;
// fog: the city's fog density floor (exp2 per metre: 0.0022 hides two thirds of what is 450 m away); wet: the roads' wetness floor
// (puddles, the wet film); precip: falling rain or snow (precipitation.js) and its strength; saturation & exposure: the
// grade (a camera exposes for a grey day: the city's grade is set for sunshine, so a dull sky lifts it).
// 'fair' is the default sky, today's art-directed look, for no reading, a stale one or an unknown condition.
const WEATHER_LOOKS = Object.freeze({
  fair:         { cloud: 'fairWeatherCumulus', coverage: 0.32, sun: 1, hemi: 1, grey: 0, fog: 0, wet: 0, precip: null, amount: 0, saturation: 1, exposure: 1 },
  clear:        { cloud: 'fairWeatherCumulus', coverage: 0.16, sun: 1, hemi: 1, grey: 0, fog: 0, wet: 0, precip: null, amount: 0, saturation: 1, exposure: 1 },
  mainlyClear:  { cloud: 'fairWeatherCumulus', coverage: 0.26, sun: 1, hemi: 1, grey: 0, fog: 0, wet: 0, precip: null, amount: 0, saturation: 1, exposure: 1 },
  partlyCloudy: { cloud: 'fairWeatherCumulus', coverage: 0.42, sun: 0.92, hemi: 1.02, grey: 0.08, fog: 0, wet: 0, precip: null, amount: 0, saturation: 0.98, exposure: 1 },
  mostlyCloudy: { cloud: 'stratocumulusDeck', coverage: 0.62, sun: 0.6, hemi: 1.08, grey: 0.3, fog: 0, wet: 0, precip: null, amount: 0, saturation: 0.94, exposure: 1.1 },
  overcast:     { cloud: 'overcastSheet', coverage: 0.95, sun: 0.22, hemi: 1.18, grey: 0.65, fog: 0.00028, wet: 0, precip: null, amount: 0, saturation: 0.88, exposure: 1.22 },
  haze:         { cloud: 'fairWeatherCumulus', coverage: 0.28, sun: 0.8, hemi: 1.04, grey: 0.25, fog: 0.00045, wet: 0, precip: null, amount: 0, saturation: 0.92, exposure: 1.05 },
  mist:         { cloud: 'stratocumulusDeck', coverage: 0.8, sun: 0.4, hemi: 1.12, grey: 0.55, fog: 0.0008, wet: 0.3, precip: null, amount: 0, saturation: 0.88, exposure: 1.22 },
  fog:          { cloud: 'overcastSheet', coverage: 0.95, sun: 0.18, hemi: 1.15, grey: 0.75, fog: 0.0022, wet: 0.35, precip: null, amount: 0, saturation: 0.84, exposure: 1.4 },
  drizzle:      { cloud: 'overcastSheet', coverage: 0.95, sun: 0.18, hemi: 1.12, grey: 0.7, fog: 0.0005, wet: 0.75, precip: 'rain', amount: 0.35, saturation: 0.86, exposure: 1.22 },
  showers:      { cloud: 'stratocumulusDeck', coverage: 0.78, sun: 0.45, hemi: 1.1, grey: 0.45, fog: 0.0003, wet: 0.8, precip: 'rain', amount: 0.6, saturation: 0.9, exposure: 1.15 },
  rain:         { cloud: 'overcastSheet', coverage: 0.97, sun: 0.15, hemi: 1.1, grey: 0.72, fog: 0.0006, wet: 0.92, precip: 'rain', amount: 0.85, saturation: 0.86, exposure: 1.25 },
  freezingRain: { cloud: 'overcastSheet', coverage: 0.97, sun: 0.15, hemi: 1.1, grey: 0.75, fog: 0.0006, wet: 0.95, precip: 'rain', amount: 0.6, saturation: 0.84, exposure: 1.3 },
  thunderstorm: { cloud: 'overcastSheet', coverage: 0.99, sun: 0.1, hemi: 0.95, grey: 0.7, fog: 0.0006, wet: 1, precip: 'rain', amount: 1, saturation: 0.86, exposure: 1.2 },
  snow:         { cloud: 'overcastSheet', coverage: 0.96, sun: 0.2, hemi: 1.2, grey: 0.8, fog: 0.0009, wet: 0.35, precip: 'snow', amount: 0.8, saturation: 0.86, exposure: 1.38 }
});
const lookFor = (key) => WEATHER_LOOKS[key] || WEATHER_LOOKS.fair;
// A condition's kind & look, its rain or snow thinned for "Light ..." and thickened for "Heavy ..."
function weatherFromCondition(text) {
  const key = classifyCondition(text);
  const look = lookFor(key);
  if (!look.precip) return { key, look };
  const f = /\bheavy\b/i.test(text) ? 1.25 : /\blight\b/i.test(text) ? 0.55 : 1;
  return { key, look: f === 1 ? look : { ...look, amount: Math.min(1, look.amount * f) } };
}

// ---------------------------------------------------------------------------------------------------------------------
// The reading: parsed the way js/landing.js parses it, cached under its key in the same { at, data } shape
// ---------------------------------------------------------------------------------------------------------------------
function parseFeed(json) {
  try {
    const cc = json.features[0].properties.currentConditions;
    const data = {
      temp: Number(cc.temperature.value.en),
      condition: (cc.condition && cc.condition.en) || '',
      time: cc.timestamp.en,
      station: (cc.station && cc.station.value && cc.station.value.en) || ''
    };
    if (!Number.isFinite(data.temp) || !/pearson/i.test(data.station)) return null;
    return data;
  } catch {
    return null;
  }
}
// Whether a reading is usable at `now` (ms): observed, and not over three hours old (nor from the future)
function isFresh(reading, now = Date.now(), maxAgeMs = MAX_AGE_MS) {
  if (!reading || !reading.time) return false;
  const t = new Date(reading.time).getTime();
  return Number.isFinite(t) && t > 0 && now - t <= maxAgeMs && t - now <= 15 * 60 * 1000;
}
// Latest reading, from the tab's cache or the feed; null on any failure, a slow feed (timeoutMs) or a bad payload.
// Never throws.
async function fetchReading({ fetchImpl = globalThis.fetch, storage = safeSession(), now = Date.now, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  try {
    const cached = storage && JSON.parse(storage.getItem(CACHE_KEY) || 'null');
    if (cached && now() - cached.at < CACHE_MS && cached.data) return cached.data;
  } catch { /* storage blocked: fetch instead */ }
  if (typeof fetchImpl !== 'function') return null;
  const abort = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = 0;
  try {
    const timeout = new Promise((resolve) => { timer = setTimeout(() => { abort?.abort(); resolve(null); }, timeoutMs); });
    const request = (async () => {
      const res = await fetchImpl(FEED_URL, { signal: abort?.signal, credentials: 'omit' });
      if (!res || !res.ok) return null;
      return parseFeed(await res.json());
    })().catch(() => null);
    const data = await Promise.race([request, timeout]);
    if (data) try { storage?.setItem(CACHE_KEY, JSON.stringify({ at: now(), data })); } catch { /* fine */ }
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
function safeSession() {
  try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch { return null; }
}
// The weather to show for a reading at `now`: its kind & look, or the default sky (key null) when there is none, it is
// stale, or its condition is one we can't place
function weatherFor(reading, now = Date.now()) {
  const fresh = isFresh(reading, now);
  const { key, look } = fresh ? weatherFromCondition(reading.condition) : { key: null, look: lookFor(null) };
  return { key, look, reading: fresh ? reading : null, stale: !!reading && !fresh };
}

// ---------------------------------------------------------------------------------------------------------------------
// The mode the app opens in. ?time=<preset> picks that preset (a manual override, as the buttons are); ?time=live asks
// for live. Under automation (navigator.webdriver: every capture & browser test) live never starts by itself, so shot
// lists stay deterministic at golden hour; a capture opts in with a fixed fake clock, ?liveClock=<ISO instant>, and
// optionally a fixed condition, ?liveWeather=<ECCC condition text>. With ?liveReading=1 that condition does not come with
// the first sky: it is handed to the startup's reading handler (lateCondition), so it lands where Pearson's reading lands
// on a real open, in the middle of the startup (bead st-eyy2). All three are ignored outside automation.
// ---------------------------------------------------------------------------------------------------------------------
function resolveStartup({ search = '', webdriver = false } = {}) {
  const q = new URLSearchParams(search);
  const time = q.get('time');
  const capture = webdriver === true;
  if (time && PRESET_IDS.includes(time)) return { mode: 'preset', preset: time, capture, reason: '?time' };
  if (capture) {
    const clock = q.has('liveClock') ? new Date(q.get('liveClock')) : null;
    if (!clock || !Number.isFinite(clock.getTime())) return { mode: 'preset', preset: 'golden', capture, reason: 'automation' };
    if (q.get('liveReading') === '1') {
      return { mode: 'live', capture, fixedClock: clock, fixedCondition: null, lateCondition: q.get('liveWeather'), reason: 'capture fixture' };
    }
    return { mode: 'live', capture, fixedClock: clock, fixedCondition: q.get('liveWeather'), reason: 'capture fixture' };
  }
  return { mode: 'live', capture, fixedClock: null, fixedCondition: null, reason: time === 'live' ? '?time' : 'default' };
}

const LIVE_SKY = {
  TORONTO, PRESET_IDS, FEED_URL, CACHE_KEY, CACHE_MS, MAX_AGE_MS, FETCH_TIMEOUT_MS, ANCHORS, WEATHER_LOOKS,
  solarPosition, torontoClock, presetWeights, dominantPreset, classifyCondition, lookFor, weatherFromCondition, parseFeed, isFresh,
  fetchReading, weatherFor, resolveStartup
};
if (typeof window !== 'undefined' && window.CITY) window.CITY.LIVE_SKY = LIVE_SKY;
if (typeof module !== 'undefined' && module.exports) module.exports = LIVE_SKY;
})();
