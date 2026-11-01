// The live sky (js/live-sky.js, docs/live-sky.md): the sun over Toronto, ECCC's condition turned into the engine's
// look, the reading's staleness & fallbacks, the startup mode (presets, ?time= and automation override live), and the
// lighting blend (js/lighting.js) & cloud hooks (js/sky-clouds.js) that apply it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
function loadLive(extra = {}) {
  const window = { CITY: {} };
  vm.runInNewContext(read('js/live-sky.js'), { window, Intl, URLSearchParams, Date, AbortController, setTimeout, clearTimeout, ...extra });
  return window.CITY.LIVE_SKY;
}
const L = loadLive();
const plain = (o) => JSON.parse(JSON.stringify(o)); // (objects made inside a vm context have its prototypes)
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} not within ${tol} of ${b}`);

test('the sun over Toronto: solar noon heights through the year, and the 31 October sunset', () => {
  // noon elevation = 90 - latitude + declination
  near(L.solarPosition(new Date('2026-06-21T17:21:00Z')).elevation, 90 - 43.65 + 23.44, 0.5, 'summer solstice noon');
  near(L.solarPosition(new Date('2026-03-20T17:20:00Z')).elevation, 90 - 43.65, 0.6, 'equinox noon');
  near(L.solarPosition(new Date('2026-12-21T17:12:00Z')).elevation, 90 - 43.65 - 23.44, 0.5, 'winter solstice noon');
  near(L.solarPosition(new Date('2026-06-21T17:21:00Z')).azimuth, 180, 3, 'noon sun due south');
  // Toronto's sunset on 31 October 2026 is about 6:08 pm EDT (22:08 UTC): the sun's centre 0.83 degrees down
  near(L.solarPosition(new Date('2026-10-31T22:08:00Z')).elevation, -0.83, 0.5, 'sunset');
  const morning = L.solarPosition(new Date('2026-10-31T12:00:00Z')), evening = L.solarPosition(new Date('2026-10-31T21:00:00Z'));
  assert.ok(morning.azimuth > 90 && morning.azimuth < 150, `morning sun in the south-east: ${morning.azimuth}`);
  assert.ok(evening.azimuth > 210 && evening.azimuth < 270, `evening sun in the south-west: ${evening.azimuth}`);
  assert.ok(L.solarPosition(new Date('2026-11-01T03:00:00Z')).elevation < -30, '11 pm: deep night');
});

test('the sun moves continuously (no snapping to presets): under 0.3 degrees a minute all day', () => {
  let prev = L.solarPosition(new Date('2026-10-31T04:00:00Z'));
  for (let m = 1; m < 24 * 60; m++) {
    const p = L.solarPosition(new Date(Date.parse('2026-10-31T04:00:00Z') + m * 60000));
    assert.ok(Math.abs(p.elevation - prev.elevation) < 0.3, `minute ${m}`);
    prev = p;
  }
});

test('Toronto clock follows Eastern time across the DST change', () => {
  assert.equal(L.torontoClock(new Date('2026-10-31T16:30:00Z')).label, '12:30 pm');
  near(L.torontoClock(new Date('2026-10-31T16:30:00Z')).hour, 12.5, 1e-9, 'EDT');
  assert.equal(L.torontoClock(new Date('2026-11-02T17:30:00Z')).label, '12:30 pm'); // EST after 1 November
});

test('preset weights cross smoothly from night to midday and always sum to 1', () => {
  assert.deepEqual(plain(L.presetWeights(-20)), { golden: 0, midday: 0, twilight: 0, midnight: 1 });
  assert.deepEqual(plain(L.presetWeights(60)), { golden: 0, midday: 1, twilight: 0, midnight: 0 });
  for (const [id, el] of L.ANCHORS) assert.equal(L.presetWeights(el)[id], 1, id);
  let prev = L.presetWeights(-10);
  for (let el = -10; el <= 50; el += 0.05) {
    const w = L.presetWeights(el);
    near(Object.values(w).reduce((a, b) => a + b, 0), 1, 1e-9, `sum at ${el}`);
    for (const id of L.PRESET_IDS) assert.ok(Math.abs(w[id] - prev[id]) < 0.02, `${id} jumps at ${el}`);
    prev = w;
  }
  assert.equal(L.dominantPreset(L.presetWeights(-0.9)), 'twilight');
  assert.equal(L.dominantPreset(L.presetWeights(10.5)), 'golden');
  assert.equal(L.dominantPreset(L.presetWeights(30)), 'midday');
});

test('ECCC conditions map to the closest look the engine can show', () => {
  const table = {
    Sunny: 'clear', Clear: 'clear', 'Mainly Sunny': 'mainlyClear', 'Mainly Clear': 'mainlyClear', 'A few clouds': 'mainlyClear',
    'Partly Cloudy': 'partlyCloudy', 'Cloudy periods': 'partlyCloudy', 'Mostly Cloudy': 'mostlyCloudy', Cloudy: 'overcast',
    Overcast: 'overcast', Fog: 'fog', 'Fog Patches': 'fog', Mist: 'mist', Haze: 'haze', Smoke: 'haze',
    'Light Rain': 'rain', Rain: 'rain', 'Heavy Rain': 'rain', 'Light Rain and Fog': 'rain', 'Light Rainshower': 'showers',
    'Rain Showers': 'showers', 'Light Drizzle': 'drizzle', 'Light Snow': 'snow', 'Snow': 'snow', 'Light Snowshower': 'snow',
    'Blowing Snow': 'snow', 'Rain and Snow': 'snow', 'Freezing Rain': 'freezingRain', 'Ice Pellets': 'freezingRain',
    Thunderstorm: 'thunderstorm', 'Thunderstorm with Light Rainshowers': 'thunderstorm', Precipitation: 'rain'
  };
  for (const [text, key] of Object.entries(table)) assert.equal(L.classifyCondition(text), key, text);
  for (const text of ['', 'Not observed', 'N/A', null, undefined, 42, 'Something new']) assert.equal(L.classifyCondition(text), null, String(text));
  // every kind has a look; the cloud types are the library's single-layer ones (uniform writes, no rebuilt march)
  for (const key of new Set(Object.values(table))) assert.ok(L.WEATHER_LOOKS[key], key);
  for (const look of Object.values(L.WEATHER_LOOKS)) assert.ok(['fairWeatherCumulus', 'stratocumulusDeck', 'overcastSheet'].includes(look.cloud));
  // a clear sky costs nothing extra: no fog, no rain, the same cloud type as the presets
  for (const key of ['clear', 'mainlyClear', 'fair']) {
    const look = L.lookFor(key);
    assert.equal(look.precip, null); assert.equal(look.fog, 0); assert.equal(look.cloud, 'fairWeatherCumulus');
  }
  assert.equal(L.lookFor('rain').precip, 'rain'); assert.equal(L.lookFor('snow').precip, 'snow');
  assert.ok(L.weatherFromCondition('Light Rain').look.amount < L.weatherFromCondition('Rain').look.amount);
  assert.ok(L.lookFor('overcast').sun < 0.3 && L.lookFor('fog').fog > L.lookFor('mist').fog);
  assert.equal(L.lookFor(null), L.WEATHER_LOOKS.fair, 'unknown: the default fair sky');
});

test('staleness: a reading over three hours old, unparseable or from the future falls back to the default sky', () => {
  const now = Date.parse('2026-10-31T20:00:00Z');
  const at = (ms) => ({ condition: 'Light Snow', time: new Date(now - ms).toISOString(), temp: -1, station: 'Toronto Pearson' });
  assert.equal(L.isFresh(at(2.9 * 3600e3), now), true);
  assert.equal(L.isFresh(at(3.1 * 3600e3), now), false);
  assert.equal(L.isFresh(at(-3600e3), now), false, 'an hour in the future');
  assert.equal(L.isFresh({ condition: 'Snow', time: 'garbage' }, now), false);
  assert.equal(L.isFresh(null, now), false);
  const fresh = L.weatherFor(at(1800e3), now);
  assert.equal(fresh.key, 'snow'); assert.equal(fresh.stale, false); assert.ok(fresh.reading);
  const stale = L.weatherFor(at(4 * 3600e3), now);
  assert.equal(stale.key, null); assert.equal(stale.look, L.WEATHER_LOOKS.fair); assert.equal(stale.stale, true); assert.equal(stale.reading, null);
  const none = L.weatherFor(null, now);
  assert.equal(none.key, null); assert.equal(none.look, L.WEATHER_LOOKS.fair); assert.equal(none.stale, false);
});

const feed = (props) => ({ features: [{ properties: { currentConditions: {
  temperature: { value: { en: 4.2 } }, condition: { en: 'Mostly Cloudy' }, timestamp: { en: '2026-10-31T19:00:00.000Z' },
  station: { value: { en: "Toronto Pearson Int'l Airport" } }, ...props } } }] });
const memoryStorage = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }; };

test('the feed: parsed like the landing page, cached under its key, and every failure is null', async () => {
  const ok = (json) => async () => ({ ok: true, json: async () => json });
  const storage = memoryStorage();
  const r = await L.fetchReading({ fetchImpl: ok(feed({})), storage, now: () => 1000 });
  assert.deepEqual(plain(r), { temp: 4.2, condition: 'Mostly Cloudy', time: '2026-10-31T19:00:00.000Z', station: "Toronto Pearson Int'l Airport" });
  assert.deepEqual(JSON.parse(storage.getItem(L.CACHE_KEY)), { at: 1000, data: plain(r) }, 'the landing page shape { at, data }');
  // a cached reading under ten minutes old is used without a request; an older one is fetched again
  let calls = 0;
  const counting = async () => { calls++; return { ok: true, json: async () => feed({ condition: { en: 'Sunny' } }) }; };
  assert.equal((await L.fetchReading({ fetchImpl: counting, storage, now: () => 1000 + 9 * 60e3 })).condition, 'Mostly Cloudy');
  assert.equal(calls, 0);
  assert.equal((await L.fetchReading({ fetchImpl: counting, storage, now: () => 1000 + 11 * 60e3 })).condition, 'Sunny');
  assert.equal(calls, 1);
  const none = memoryStorage();
  assert.equal(await L.fetchReading({ fetchImpl: async () => { throw new Error('offline'); }, storage: none }), null, 'network error');
  assert.equal(await L.fetchReading({ fetchImpl: async () => ({ ok: false }), storage: none }), null, 'HTTP error');
  assert.equal(await L.fetchReading({ fetchImpl: ok({ nope: 1 }), storage: none }), null, 'bad payload');
  assert.equal(await L.fetchReading({ fetchImpl: ok(feed({ station: { value: { en: 'Toronto Island' } } })), storage: none }), null, 'not Pearson');
  assert.equal(await L.fetchReading({ fetchImpl: ok(feed({ temperature: { value: { en: 'N/A' } } })), storage: none }), null, 'no temperature');
  const blocked = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } };
  assert.equal((await L.fetchReading({ fetchImpl: ok(feed({})), storage: blocked })).condition, 'Mostly Cloudy', 'storage blocked');
  assert.equal(none.m.size, 0, 'failures are not cached');
});

test('a slow feed times out within the limit and never blocks', async () => {
  const t0 = Date.now();
  const r = await L.fetchReading({ fetchImpl: () => new Promise(() => {}), storage: memoryStorage(), timeoutMs: 60 });
  assert.equal(r, null);
  assert.ok(Date.now() - t0 < 1000, 'resolved promptly');
  assert.ok(L.FETCH_TIMEOUT_MS <= 5000, 'a few seconds at most');
});

test('startup mode: live by default; ?time= presets and automation override it; the fake clock is capture-only', () => {
  assert.deepEqual(plain(L.resolveStartup({ search: '', webdriver: false })), { mode: 'live', capture: false, fixedClock: null, fixedCondition: null, reason: 'default' });
  for (const id of L.PRESET_IDS) {
    assert.deepEqual(plain(L.resolveStartup({ search: `?time=${id}` })), { mode: 'preset', preset: id, capture: false, reason: '?time' });
    assert.equal(L.resolveStartup({ search: `?time=${id}&liveClock=2026-10-31T16:00:00Z`, webdriver: true }).mode, 'preset', `${id} beats the fixture`);
  }
  assert.equal(L.resolveStartup({ search: '?time=night' }).mode, 'live', 'not a preset: ignored');
  // every capture & browser test (navigator.webdriver) opens at golden hour, as before, whatever the clock says
  assert.deepEqual(plain(L.resolveStartup({ search: '', webdriver: true })), { mode: 'preset', preset: 'golden', capture: true, reason: 'automation' });
  assert.equal(L.resolveStartup({ search: '?time=live', webdriver: true }).preset, 'golden');
  assert.equal(L.resolveStartup({ search: '?liveClock=nonsense', webdriver: true }).preset, 'golden');
  const fixture = L.resolveStartup({ search: '?liveClock=2026-10-31T16:00:00Z&liveWeather=Fog', webdriver: true });
  assert.equal(fixture.mode, 'live'); assert.equal(fixture.fixedClock.toISOString(), '2026-10-31T16:00:00.000Z'); assert.equal(fixture.fixedCondition, 'Fog');
  // outside automation the fixture parameters are ignored: the real clock and the real reading
  const real = L.resolveStartup({ search: '?liveClock=2026-10-31T16:00:00Z&liveWeather=Fog', webdriver: false });
  assert.equal(real.mode, 'live'); assert.equal(real.fixedClock, null); assert.equal(real.fixedCondition, null);
});

test('no checked-in shot list turns live on, so every existing capture stays deterministic', () => {
  const dir = new URL('../tools/shots/', import.meta.url);
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('live-sky'))) {
    const text = fs.readFileSync(new URL(f, dir), 'utf8');
    assert.doesNotMatch(text, /liveSky|liveClock|liveWeather|time-live/, f);
  }
});

// ---- the lighting blend (js/lighting.js) -----------------------------------------------------------------------------
function loadLighting(Addons = { SkyMesh: class {}, SunLight: class {}, SunLightNode: class {} }) {
  const window = { CITY: { THREE, TSL, Addons, cityUniforms: {},
    GEO: { frame: { lat: 43.6453, lon: -79.3806, bearingDeg: -16.8 } } } };
  const ctx = vm.createContext({ window, console: { info() {}, log() {}, warn() {} }, Date, Intl, URLSearchParams });
  vm.runInContext(read('js/live-sky.js'), ctx);
  vm.runInContext(read('js/lighting.js'), ctx);
  return window.CITY;
}

test('the live blend: the real sun by day, the presets\' moonlight at night, the weather on top', () => {
  const C = loadLighting();
  const noon = C.blendLivePreset(new Date('2026-10-31T16:30:00Z'), C.LIVE_SKY.lookFor('clear'));
  assert.equal(noon.id, 'midday'); assert.equal(noon.live, true);
  near(noon.sunDir.y, Math.sin(noon.elevation * Math.PI / 180), 1e-6, 'the city lit from the real sun');
  assert.ok(noon.trueSunDir.distanceTo(noon.sunDir) < 1e-6);
  assert.equal(noon.weatherFog, 0);
  const night = C.blendLivePreset(new Date('2026-11-01T03:00:00Z'), C.LIVE_SKY.lookFor(null));
  assert.equal(night.id, 'midnight');
  assert.ok(night.trueSunDir.y < -0.5, 'the sky takes the real sun, far below');
  assert.ok(night.sunDir.y > 0.5, 'the streets keep the moonlight from above');
  // dusk: never lit from below the horizon
  const dusk = C.blendLivePreset(new Date('2026-10-31T22:12:00Z'), C.LIVE_SKY.lookFor('clear'));
  assert.ok(dusk.elevation < 0 && dusk.sunDir.y > 0, 'held above the horizon');
  assert.equal(dusk.id, 'twilight');
  // overcast: a far dimmer sun, a greyer light, more fill; fog lifts the fog floor; rain wets the roads
  const grey = C.blendLivePreset(new Date('2026-10-31T16:30:00Z'), C.LIVE_SKY.lookFor('overcast'));
  assert.ok(grey.sunIntensity < noon.sunIntensity * 0.3 && grey.hemiIntensity > noon.hemiIntensity);
  const fog = C.blendLivePreset(new Date('2026-10-31T13:00:00Z'), C.LIVE_SKY.lookFor('fog'));
  assert.ok(fog.weatherFog >= 0.0015);
  assert.ok(C.blendLivePreset(new Date('2026-10-31T16:30:00Z'), C.LIVE_SKY.lookFor('rain')).roadWetness >= 0.9);
});

// ---- presets override live, in the lighting & the sky (js/sky-clouds.js on WebGL2: no cloud pass) --------------------
test('a preset after live puts back the preset exactly; live after a preset blends again', async () => {
  // a LightingSystem without a renderer: everything but the GPU bake
  const fakeSky = () => {
    const o = new THREE.Object3D();
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG', 'cloudScale', 'cloudSpeed', 'cloudCoverage', 'cloudDensity', 'cloudElevation', 'showSunDisc']) o[k] = { value: 0 };
    o.sunPosition = { value: new THREE.Vector3() };
    o.material = { colorNode: TSL.vec4(1, 1, 1, 1) };
    return o;
  };
  const C = loadLighting({ SkyMesh: function SkyMesh() { return fakeSky(); }, SunLight: function SunLight() { return new THREE.DirectionalLight(); }, SunLightNode: class {} });
  const u = () => ({ value: 0 });
  const vec = () => ({ value: new THREE.Vector3() }), col = () => ({ value: new THREE.Color() });
  Object.assign(C.cityUniforms, { uSunColor: col(), uSunIntensity: u(), uSkyTopColor: col(), uSkyHorizonColor: col(), uSkySunDir: vec(),
    uInteriorGlow: u(), uRoadWetness: u(), uCanyonBounce: u() });
  C.QUALITY = { shadows: false, shadowTile: 1024 };
  const lighting = new C.LightingSystem(new THREE.Scene(), null);
  const golden = { sun: lighting.sunLight.intensity, fog: lighting.scene.fog.density, wet: C.cityUniforms.uRoadWetness.value };
  lighting.applyLive(new Date('2026-10-31T16:30:00Z'), C.LIVE_SKY.lookFor('fog'));
  assert.equal(lighting.activePresetId, 'midday');
  assert.ok(lighting.live && lighting.scene.fog.density >= 0.0015);
  lighting.applyPreset('golden');
  assert.equal(lighting.live, null);
  assert.equal(lighting.activePresetId, 'golden');
  assert.deepEqual({ sun: lighting.sunLight.intensity, fog: lighting.scene.fog.density, wet: C.cityUniforms.uRoadWetness.value }, golden);
  assert.ok(lighting.sunLight.position.distanceTo(lighting.activePreset.sunDir) < 1e-9);
  // the same preset id as the live blend's dominant one still re-applies (live -> midday is a real change)
  lighting.applyLive(new Date('2026-10-31T16:30:00Z'), C.LIVE_SKY.lookFor('clear'));
  const liveSun = lighting.sunLight.intensity;
  lighting.applyPreset('midday');
  assert.notEqual(lighting.sunLight.intensity, liveSun === 6.6 ? -1 : liveSun);
  assert.equal(lighting.sunLight.intensity, 6.6);
});

test('the physical sky follows the live blend: fog floor, night glow and stars by weight', async () => {
  const source = read('js/sky-clouds.js');
  const window = { CITY: { THREE, TSL, QUALITY: { clouds: 'medium', cloudScale: 0.5 },
    cityUniforms: { uSkySunDir: { value: new THREE.Vector3(0, 1, 0) } },
    GEO: { frame: { lon: -79.3806, lat: 43.6453, elevation: 76, projection: { theta: 0.3 } } } } };
  vm.runInContext(source, vm.createContext({ window, location: { search: '' }, URLSearchParams, console: { warn() {}, info() {}, log() {} } }));
  const r = { initialized: true, contextNode: null, backend: { isWebGLBackend: true } };
  const sky = await window.CITY.setupClouds(r, { load: () => import('../js/clouds.js') });
  assert.equal(sky.setWeather({ cloud: 'overcastSheet', coverage: 0.9 }), false, 'no cloud pass (WebGL2): nothing to set');
  const lighting = { sky: new THREE.Object3D(), scene: new THREE.Scene(), activePresetId: 'golden', uFogDensity: { value: 0 },
    activePreset: { id: 'golden', fogDensity: 0.001 }, bakeEnvironmentMap() {},
    applyPreset(id) { this.activePresetId = id; this.activePreset = { id, fogDensity: 0.001 }; },
    applyLive(p) { this.activePresetId = p.id; this.activePreset = p; } };
  sky.attach(new THREE.PerspectiveCamera(), lighting);
  lighting.applyPreset('golden');
  assert.equal(lighting.uFogDensity.value, 0, 'golden: the physical haze alone');
  lighting.applyPreset('twilight');
  near(lighting.uFogDensity.value, 0.001 * 0.35, 1e-12, 'twilight keeps 35% of the city fog');
  lighting.applyLive({ id: 'twilight', fogDensity: 0.001, weights: { golden: 0, midday: 0, twilight: 0.5, midnight: 0.5 }, weatherFog: 0 });
  near(lighting.uFogDensity.value, 0.001 * (0.5 * 0.35 + 0.5 * 0.5), 1e-12, 'blended share');
  lighting.applyLive({ id: 'midday', fogDensity: 0.0002, weights: { golden: 0, midday: 1, twilight: 0, midnight: 0 }, weatherFog: 0.0016 });
  assert.equal(lighting.uFogDensity.value, 0.0016, 'fog: the floor');
  lighting.applyPreset('midday');
  assert.equal(lighting.uFogDensity.value, 0, 'the preset again: no fog');
});
