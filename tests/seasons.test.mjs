// Seasons (js/seasons.js, docs/live-sky.md "Seasons"): Toronto's date turned into the trees' leaves & colour, the grass
// and lying snow; the capture-only overrides; and the shaders that show them, which must read the season from uniforms
// only (a date change rebuilds no material and compiles no shader) and be the classic summer look on 22 August.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
function loadSeasons(extra = {}) {
  const window = { CITY: {} };
  vm.runInNewContext(read('js/seasons.js'), { window, Intl, URLSearchParams, Date, AbortController, setTimeout, clearTimeout, ...extra });
  return window.CITY.SEASONS;
}
const S = loadSeasons();
const plain = (o) => JSON.parse(JSON.stringify(o)); // (objects made inside a vm context have its prototypes)
const at = (month, day) => S.seasonFor({ month, day });

test('22 August, the presets\' day, is the classic summer look: every season value is the shaders\' identity', () => {
  const s = at(8, 22);
  assert.deepEqual({ leaf: s.leaf, autumn: s.autumn, spring: s.spring, dormant: s.dormant, phase: s.phase },
    { leaf: 1, autumn: 0, spring: 0, dormant: 0, phase: 'summer' });
  assert.deepEqual(plain(S.SUMMER), plain(s));
  // the same day as lighting.js's SCENE_DATE
  assert.match(read('js/lighting.js'), /const SCENE_DATE = Object\.freeze\(\{ month: 8, day: 22 \}\);/);
  assert.deepEqual(plain(S.SUMMER_DATE), { month: 8, day: 22 });
  // all of high summer is the same look
  for (const [m, d] of [[6, 20], [7, 1], [7, 31], [8, 1], [9, 10]]) {
    const v = at(m, d);
    assert.deepEqual([v.leaf, v.autumn, v.spring, v.dormant], [1, 0, 0, 0], `${m}/${d}`);
  }
});

test('the year: autumn colour in October, sparse then bare trees from late November to April, spring green', () => {
  // mid-October: full crowns, coloured; the lawns still green
  const oct = at(10, 15);
  assert.equal(oct.phase, 'autumn'); assert.equal(oct.leaf, 1); assert.ok(oct.autumn > 0.95); assert.ok(oct.dormant < 0.05);
  // the colour comes in from mid-September
  assert.equal(at(9, 12).autumn, 0); assert.ok(at(9, 25).autumn > 0.2 && at(9, 25).autumn < 0.5);
  // the leaves come down from late October: sparse in early November, bare by late November
  assert.ok(at(10, 25).leaf > 0.9);
  assert.ok(at(11, 6).leaf > 0.4 && at(11, 6).leaf < 0.7, 'sparse');
  assert.equal(at(11, 24).leaf, 0); assert.equal(at(11, 24).phase, 'winter');
  // winter: bare, dormant grass; nothing left to colour after the new year
  for (const [m, d] of [[12, 1], [12, 20], [12, 31], [1, 1], [1, 15], [2, 28], [3, 20], [4, 1]]) {
    const v = at(m, d);
    assert.equal(v.leaf, 0, `${m}/${d} bare`); assert.equal(v.phase, 'winter', `${m}/${d}`);
  }
  assert.equal(at(12, 31).dormant, 1); assert.equal(at(1, 1).dormant, 1); assert.equal(at(1, 1).autumn, 0);
  // spring: leaf-out from mid-April, full by mid-May; fresh green until mid-June; the lawns green up in April
  assert.equal(at(4, 15).leaf, 0); assert.ok(at(4, 28).leaf > 0.3 && at(4, 28).leaf < 0.7); assert.equal(at(5, 15).leaf, 1);
  assert.equal(at(4, 28).phase, 'spring'); assert.equal(at(4, 28).spring, 1); assert.equal(at(4, 28).dormant, 0);
  assert.equal(at(5, 15).phase, 'spring'); assert.equal(at(6, 15).spring, 0);
  // conifers are not in this at all: ez-trees.js keeps the pines out of the seasonal material
  assert.match(read('js/ez-trees.js'), /fadeMaterial\(near\.material, !id\.includes\('pine'\)\)/);
});

test('the month edges and the calendar: continuous across the new year, leap day, Toronto\'s own date', () => {
  // every value moves smoothly: no jump of more than 0.12 between any two days of the year
  let prev = at(12, 31);
  for (let d = 1; d <= 365; d++) {
    const date = new Date(Date.UTC(2026, 0, d));
    const v = at(date.getUTCMonth() + 1, date.getUTCDate());
    for (const k of ['leaf', 'spring', 'dormant']) assert.ok(Math.abs(v[k] - prev[k]) <= 0.12, `${k} jumps on day ${d}`);
    // (autumn drops to 0 at the new year, when no leaf is left to show it)
    if (d > 1) assert.ok(Math.abs(v.autumn - prev.autumn) <= 0.12, `autumn jumps on day ${d}`);
    for (const k of ['leaf', 'autumn', 'spring', 'dormant']) assert.ok(v[k] >= 0 && v[k] <= 1, `${k} in range on day ${d}`);
    prev = v;
  }
  assert.equal(at(12, 31).leaf, 0, 'the autumn reset at the new year is invisible: no leaves');
  // 29 February is 28 February; out-of-range days are clamped
  assert.deepEqual(plain({ ...at(2, 29), day: 0 }), plain({ ...at(2, 28), day: 0 }));
  assert.equal(S.dayOfYear({ month: 1, day: 1 }), 1); assert.equal(S.dayOfYear({ month: 12, day: 31 }), 365);
  // a Date is Toronto's day: 1 a.m. UTC on 1 December is still 30 November in Toronto
  assert.deepEqual(plain(S.torontoDate(new Date('2026-12-01T01:00:00Z'))), { year: 2026, month: 11, day: 30 });
  assert.deepEqual(plain(S.seasonFor(new Date('2026-12-01T01:00:00Z'))), plain(at(11, 30)));
  assert.throws(() => S.seasonFor(null));
});

test('snow on the ground: Pearson\'s falling snow, the morning\'s snow-on-ground record, melting and staleness', () => {
  const now = Date.parse('2027-01-15T15:00:00-05:00');
  assert.equal(S.snowCover({ now }), 0, 'no weather, no record: none');
  assert.equal(S.snowCover({ weatherKey: 'clear', now }), 0);
  // falling snow whitens the ground; wet snow above freezing less
  assert.equal(S.snowCover({ weatherKey: 'snow', now }), 0.9);
  assert.equal(S.snowCover({ weatherKey: 'snow', temp: -4, now }), 0.9);
  assert.ok(S.snowCover({ weatherKey: 'snow', temp: 4, now }) < 0.6);
  assert.equal(S.snowCover({ weatherKey: 'rain', now }), 0, 'rain lays none');
  // the record: depth on the ground this morning
  const rec = (o) => ({ date: '2027-01-15', snowOnGround: null, snowOnGroundDate: null, recentSnow: 0, maxTemp: -3, ...o });
  assert.equal(S.snowCover({ record: rec({ snowOnGround: 0, snowOnGroundDate: '2027-01-15' }), now }), 0);
  const thin = S.snowCover({ record: rec({ snowOnGround: 1, snowOnGroundDate: '2027-01-15' }), now });
  assert.ok(thin >= 0.45 && thin <= 0.55, `1 cm: thin & patchy (${thin})`);
  assert.equal(S.snowCover({ record: rec({ snowOnGround: 12, snowOnGroundDate: '2027-01-15' }), now }), 1, '12 cm: all white');
  // a recent fall without a depth reading, on cold days; not on mild ones
  assert.ok(S.snowCover({ record: rec({ recentSnow: 3 }), now }) > 0.3);
  assert.equal(S.snowCover({ record: rec({ recentSnow: 3, maxTemp: 8 }), now }), 0);
  assert.equal(S.snowCover({ record: rec({ recentSnow: 0.4 }), now }), 0, 'a trace is nothing');
  // what lies thins out on a mild afternoon
  const deep = rec({ snowOnGround: 12, snowOnGroundDate: '2027-01-15' });
  assert.ok(S.snowCover({ record: deep, temp: 12, now }) < 0.6);
  assert.ok(S.snowCover({ record: deep, temp: 30, now }) >= 1 / 3 - 1e-3);
  // a stale record (more than 3 days old) says nothing about today
  assert.equal(S.snowCover({ record: rec({ date: '2027-01-08', snowOnGround: 20, snowOnGroundDate: '2027-01-08' }), now }), 0);
  // falling snow and lying snow: the larger
  assert.equal(S.snowCover({ weatherKey: 'snow', record: deep, now }), 1);
  // the record is only asked for from mid-October to April
  assert.equal(S.snowSeason({ month: 8, day: 22 }), false);
  assert.equal(S.snowSeason({ month: 10, day: 14 }), false);
  assert.equal(S.snowSeason({ month: 10, day: 15 }), true);
  assert.equal(S.snowSeason({ month: 1, day: 15 }), true);
  assert.equal(S.snowSeason({ month: 4, day: 30 }), true);
  assert.equal(S.snowSeason({ month: 5, day: 1 }), false);
});

test('ECCC\'s daily climate record: parsed from the API\'s GeoJSON, fetched once an hour, never throwing', async () => {
  // (the shape api.weather.gc.ca returned for TORONTO INTL A, 15-18 January 2026, newest first)
  const feature = (date, sog, snow, max) => ({ type: 'Feature', properties: { LOCAL_DATE: `${date} 00:00:00`, SNOW_ON_GROUND: sog, TOTAL_SNOW: snow, MAX_TEMPERATURE: max } });
  const payload = { type: 'FeatureCollection', features: [feature('2026-01-18', null, null, null), feature('2026-01-17', 17, 0.6, 2.1), feature('2026-01-16', 20, 2.8, -1), feature('2026-01-15', 9, 20.2, -8.9)] };
  const r = S.parseClimate(payload);
  assert.deepEqual(plain(r), { date: '2026-01-18', snowOnGround: 17, snowOnGroundDate: '2026-01-17', recentSnow: 3.4, maxTemp: 2.1 });
  assert.equal(S.snowCover({ record: r, now: Date.parse('2026-01-18T12:00:00-05:00') }), 1);
  assert.equal(S.parseClimate({}), null);
  assert.equal(S.parseClimate({ features: [] }), null);
  assert.equal(S.parseClimate(null), null);
  // the request: Pearson's climate ID, newest first, a few days, only the fields used
  assert.match(S.CLIMATE_URL, /^https:\/\/api\.weather\.gc\.ca\/collections\/climate-daily\/items\?/);
  assert.match(S.CLIMATE_URL, /CLIMATE_IDENTIFIER=6158731/); assert.match(S.CLIMATE_URL, /sortby=-LOCAL_DATE/);
  assert.match(S.CLIMATE_URL, /properties=LOCAL_DATE,SNOW_ON_GROUND,TOTAL_SNOW,MAX_TEMPERATURE/);
  // fetched, cached under its own key, read back from the cache within the hour
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  let calls = 0;
  const fetchImpl = async (url) => { calls++; assert.equal(url, S.CLIMATE_URL); return { ok: true, json: async () => payload }; };
  let t = 1_000_000;
  const now = () => t;
  assert.deepEqual(plain(await S.fetchSnowRecord({ fetchImpl, storage, now })), plain(r));
  assert.ok(store.has(S.CLIMATE_CACHE_KEY));
  t += 30 * 60 * 1000;
  assert.deepEqual(plain(await S.fetchSnowRecord({ fetchImpl, storage, now })), plain(r));
  assert.equal(calls, 1, 'the cached record within the hour');
  t += 31 * 60 * 1000;
  await S.fetchSnowRecord({ fetchImpl, storage, now });
  assert.equal(calls, 2, 'asked again after an hour');
  // failures: null, never a throw
  assert.equal(await S.fetchSnowRecord({ fetchImpl: async () => { throw new Error('offline'); }, storage: null }), null);
  assert.equal(await S.fetchSnowRecord({ fetchImpl: async () => ({ ok: false }), storage: null }), null);
  assert.equal(await S.fetchSnowRecord({ fetchImpl: async () => ({ ok: true, json: async () => ({ nonsense: 1 }) }), storage: null }), null);
  assert.equal(await S.fetchSnowRecord({ fetchImpl: () => new Promise(() => {}), storage: null, timeoutMs: 20 }), null, 'a slow API times out');
  assert.equal(await S.fetchSnowRecord({ fetchImpl: undefined, storage: null }), null);
});

test('?liveDate= and ?liveSnow= are capture-only, as ?liveClock= and ?liveWeather= are', () => {
  const cap = (search) => plain(S.resolveCapture({ search, webdriver: true }));
  assert.deepEqual(cap(''), { fixedDate: null, fixedSnowCm: null });
  assert.deepEqual(cap('?liveDate=2026-12-20'), { fixedDate: { year: 2026, month: 12, day: 20 }, fixedSnowCm: null });
  assert.deepEqual(cap('?liveDate=10-15&liveSnow=8'), { fixedDate: { year: null, month: 10, day: 15 }, fixedSnowCm: 8 });
  assert.deepEqual(cap('?liveDate=2026-13-01&liveSnow=-2'), { fixedDate: null, fixedSnowCm: null }, 'nonsense is ignored');
  assert.deepEqual(cap('?liveDate=2026-02-30'), { fixedDate: null, fixedSnowCm: null });
  assert.deepEqual(cap('?liveDate=2028-02-29').fixedDate, { year: 2028, month: 2, day: 29 });
  // outside automation: ignored, the real date and the real record
  assert.deepEqual(plain(S.resolveCapture({ search: '?liveDate=2026-12-20&liveSnow=10', webdriver: false })), { fixedDate: null, fixedSnowCm: null });
  assert.deepEqual(plain(S.resolveCapture({ search: '?liveDate=2026-12-20' })), { fixedDate: null, fixedSnowCm: null });
  // ?liveSnow=<cm>: that much on the ground this morning, on a cold day
  const now = Date.parse('2027-01-15T15:00:00-05:00');
  const rec = S.fixtureRecord(10, now);
  assert.deepEqual(plain(rec), { date: '2027-01-15', snowOnGround: 10, snowOnGroundDate: '2027-01-15', recentSnow: 0, maxTemp: -3 });
  assert.equal(S.snowCover({ record: rec, now }), 1);
  // main.js applies them only while live (a preset is summer), and leaves the shot lists' default golden hour alone
  const main = read('js/main.js');
  assert.match(main, /const day = live \? \(season\.fixedDate \|\| SEASONS\.torontoDate\(now\)\) : SEASONS\.SUMMER_DATE;/);
  assert.match(main, /const s = live \? SEASONS\.seasonFor\(day\) : SEASONS\.SUMMER;/);
  assert.match(main, /applySeason\(false\); \/\/ \(a preset is the classic summer\)/);
  assert.match(main, /if \(!liveSky\.start\.capture\) return false;\s*const day = date == null/, 'seasons.inject is capture-only');
  assert.match(read('explore.html'), /'\.\/js\/live-sky\.js',\s*'\.\/js\/seasons\.js',/);
});

// ---- the shaders: uniform-driven, identical WGSL whatever the date, built in node as tests/storefronts.test.mjs does --
async function seasonShaders() {
  const THREE = await import('../vendor/three/three.webgpu.js');
  const QUALITY = { surfaceWear: 2, storefronts: 2, treeNear: 55, treeMid: 320, treeMidShadow: 130, treeFar: 1 };
  const window = { CITY: { THREE, TSL: THREE.TSL, QUALITY, GEO: { frame: {} }, cityUniforms: null, Addons: {} } };
  const context = vm.createContext({ window, console, location: { search: '' }, URLSearchParams, document: undefined });
  vm.runInContext(read('js/tsl-materials.js'), context);
  vm.runInContext(read('js/ez-trees.js'), context);
  const C = window.CITY;
  const renderer = new THREE.WebGPURenderer({ canvas: { addEventListener() {}, style: {}, getContext: () => null } });
  renderer.backend.device = { limits: { maxUniformBufferBindingSize: 65536, maxStorageBufferBindingSize: 1 << 27 }, features: new Set() };
  renderer.hasFeature = () => false; // (no adapter: the WGSL is generated, not compiled)
  // (r187 declares the bind-group cache null until init(), and the builder only skips sharing when it is undefined)
  renderer._bindings = undefined;
  const meshes = {};
  const plane = new THREE.PlaneGeometry(1, 1);
  meshes.lawn = new THREE.Mesh(plane, C.createParkLawnMaterial(false));
  meshes.plot = new THREE.Mesh(plane, C.createPlotGroundMaterial());
  meshes.terrain = new THREE.Mesh(plane, C.createTerrainMaterial());
  // mrdoob's tree cards (the far crowns): the attributes trees.js gives them
  const card = new THREE.PlaneGeometry(1, 1);
  card.setAttribute('aTree', new THREE.BufferAttribute(new Float32Array(16), 4));
  card.setAttribute('aTreeData', new THREE.InstancedBufferAttribute(new Float32Array(4), 4));
  const atlas = new THREE.DataTexture(new Uint8Array(16), 2, 2);
  meshes['far-crown'] = new THREE.InstancedMesh(card, C.createTreeMaterial(atlas), 1);
  // an EZ-Tree broadleaf & a pine (ez-trees.js fadeMaterial over the glTF material)
  const ez = new THREE.PlaneGeometry(1, 1);
  ez.setAttribute('aLodOrigin', new THREE.InstancedBufferAttribute(new Float32Array(3), 3));
  ez.setAttribute('aLodFade', new THREE.InstancedBufferAttribute(new Float32Array(4), 4));
  for (const [name, seasonal] of [['ez-broadleaf', true], ['ez-pine', false]]) {
    const m = new THREE.InstancedMesh(ez, C.ezTreeMaterial(new THREE.MeshStandardMaterial({ map: atlas, name }), seasonal), 1);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3), 3);
    meshes[name] = m;
  }
  const names = new Map(Object.entries(C.cityUniforms).map(([k, u]) => [u, k]));
  // every mesh's fragment shader with the season uniforms at `values`, and the scene uniforms each reads (WGSL calls
  // them nodeUniformN)
  const buildAll = (values) => {
    for (const [k, v] of Object.entries(values)) C.cityUniforms[k].value = v;
    const out = {}, reads = {};
    for (const [name, mesh] of Object.entries(meshes)) {
      const b = new THREE.WGSLNodeBuilder(mesh, renderer);
      b.scene = new THREE.Scene();
      b.camera = new THREE.PerspectiveCamera();
      b.build();
      out[name] = b.fragmentShader;
      reads[name] = new Set(b.uniforms.fragment.map((u) => names.get(u.node)).filter(Boolean));
    }
    return { out, reads };
  };
  return { C, buildAll };
}

test('the season shaders build, read the season from render-group uniforms, and are the same WGSL on any date', async () => {
  const summer = { uLeaf: 1, uAutumn: 0, uSpring: 0, uDormant: 0, uSnow: 0 };
  const winter = { uLeaf: 0, uAutumn: 1, uSpring: 0, uDormant: 1, uSnow: 0.9 };
  const { C, buildAll } = await seasonShaders();
  buildAll(summer); // (the first build of a context sets up shared nodes; compare the builds after it)
  const a = buildAll(summer);
  const b = buildAll(winter);
  for (const [name, wgsl] of Object.entries(a.out)) {
    assert.ok(wgsl.length > 1500 && /fn main/.test(wgsl), `${name} builds: ${wgsl.length}`);
    assert.equal(b.out[name], wgsl, `${name}: a date change is uniform values only, never another shader`);
  }
  // the seasonal surfaces read the season uniforms; the pine does not (conifers stay green)
  const has = (name, k) => a.reads[name].has(k);
  for (const name of ['lawn', 'plot', 'terrain']) {
    assert.ok(has(name, 'uDormant') && has(name, 'uSpring'), `${name} follows the grass's season`);
    assert.ok(has(name, 'uSnow'), `${name} takes lying snow`);
  }
  for (const name of ['far-crown', 'ez-broadleaf']) {
    assert.ok(has(name, 'uLeaf'), `${name} drops its leaves`);
    assert.ok(has(name, 'uAutumn') && has(name, 'uSpring'), `${name} turns`);
  }
  for (const k of ['uLeaf', 'uAutumn', 'uSpring', 'uSnow']) assert.ok(!has('ez-pine', k), `the pines stay green (${k})`);
  // all five are one value per render (the render group), as the other scene-wide uniforms
  buildAll(summer);
  const { cityUniforms } = C;
  for (const k of ['uLeaf', 'uAutumn', 'uSpring', 'uDormant', 'uSnow']) {
    assert.ok(cityUniforms[k].groupNode && cityUniforms[k].groupNode.name === 'render', `${k} is in the render group`);
    assert.equal(cityUniforms[k].value, summer[k], `${k} defaults to summer`);
  }
});

test('the roofs and the far land take snow, by uniform; the summer values are identities in the helpers', () => {
  const tsl = read('js/tsl-materials.js');
  // each roof colour goes through snowOver (curtain wall, pre-war, rendered), and the hipped & shed roofs and the land
  assert.equal((tsl.match(/snowOver\(roofCol(or)?, /g) || []).length, 3);
  assert.match(read('js/buildings.js'), /return snowOver\(c\.mul\(shade\), positionWorld\.xz, holds\);/);
  const sur = read('js/surroundings.js');
  assert.match(sur, /mat\.colorNode = snowOver\(col, wp\.xz, float\(0\.8\)\);/);
  assert.match(sur, /snowOver\(roofCol, positionWorld\.xz, isRoof\.mul\(0\.85\)\)/);
  // the helpers mix by the season uniforms, so the summer values (leaf 1, the rest 0) give back their input; lying
  // snow is skipped outright where there is none (no cost on a snowless day or on a wall)
  assert.match(tsl, /mix\(mix\(c, dormant, cityUniforms\.uDormant\.mul\(0\.82\)\), fresh, cityUniforms\.uSpring\.mul\(0\.5\)\)/);
  assert.match(tsl, /const t = cityUniforms\.uSnow\.mul\(amount\)\.toVar\(\);\s*If\(t\.greaterThan\(0\.001\)/);
  assert.match(tsl, /const tree = clamp\(cityUniforms\.uAutumn\.mul\(1\.6\)/);
  // (TSL's method form a.mix(b, t) is mix(b, t, a): it tinted the bark in the first captures. The season code uses mix())
  const ez = read('js/ez-trees.js');
  const seasonCode = ez.slice(ez.indexOf('function seasonNodes('), ez.indexOf('function fadeMaterial('));
  assert.doesNotMatch(seasonCode.replace(/\/\/.*$/gm, ''), /\.mix\(/);
  assert.match(tsl, /const leafStays = \(key\) => key\.lessThan\(cityUniforms\.uLeaf\.mul\(1\.2\)\.sub\(0\.1\)\);/);
});

// ---- the scenery built once at load (st-1m40): the rinks' ice, the CaféTO patios and the bikeways bent round them ------
// seasons.js CITY.SITE_DATE, the day they stand on, from the same opening rules as the sky (live-sky.js resolveStartup)
function loadSiteDate(search, webdriver, now = null) {
  const window = { CITY: {} };
  const RealDate = Date;
  // (a fixed "now" for the real-path case: Toronto's date at that instant)
  const FakeDate = now ? class extends RealDate { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return new RealDate(now).getTime(); } } : RealDate;
  const ctx = vm.createContext({ window, Intl, URLSearchParams, Date: FakeDate, AbortController, setTimeout, clearTimeout,
    location: { search }, navigator: { webdriver } });
  vm.runInContext(read('js/live-sky.js'), ctx);
  vm.runInContext(read('js/seasons.js'), ctx);
  return window.CITY.SITE_DATE ? plain(window.CITY.SITE_DATE) : null;
}
const rinkRule = (d) => (d.month === 12 || d.month <= 2 || (d.month === 3 && d.day <= 15) ? 'ice' : 'off');
const patioRule = (d) => d.month * 100 + d.day >= 601 && d.month * 100 + d.day <= 930;

test('the load-built scenery\'s day: Toronto\'s date when the city opens live, 22 August on a preset or in an automated capture', () => {
  // a real open (no automation) is live on Toronto's date: 1 November there at 03:30 UTC is still 31 October
  assert.deepEqual(loadSiteDate('', false, '2026-11-01T03:30:00Z'), { month: 10, day: 31, source: 'live' });
  assert.deepEqual(loadSiteDate('', false, '2026-01-15T17:00:00Z'), { month: 1, day: 15, source: 'live' });
  assert.deepEqual(loadSiteDate('?time=live', false, '2026-07-10T17:00:00Z'), { month: 7, day: 10, source: 'live' });
  // a preset in the URL: the presets' 22 August, whatever the date
  assert.deepEqual(loadSiteDate('?time=golden', false, '2026-01-15T17:00:00Z'), { month: 8, day: 22, source: 'preset' });
  // the capture-only overrides are ignored outside automation
  assert.deepEqual(loadSiteDate('?liveDate=2026-07-15&liveClock=2026-01-15T12:00:00-05:00', false, '2026-11-01T17:00:00Z'),
    { month: 11, day: 1, source: 'live' });
  // automation without a fixture opens on golden hour, so on 22 August: every existing shot list is unchanged, and a
  // ?liveDate= alone (no ?liveClock=, so not live) doesn't move it either
  assert.deepEqual(loadSiteDate('', true, '2026-01-15T17:00:00Z'), { month: 8, day: 22, source: 'preset' });
  assert.deepEqual(loadSiteDate('?liveDate=2026-01-15', true), { month: 8, day: 22, source: 'preset' });
  assert.deepEqual(loadSiteDate('?time=midday&liveClock=2026-01-15T12:00:00-05:00', true), { month: 8, day: 22, source: 'preset' });
  // a capture fixture: its ?liveDate= day, else its ?liveClock= day in Toronto
  assert.deepEqual(loadSiteDate('?liveClock=2026-08-22T12:00:00-04:00&liveDate=2026-01-15', true), { month: 1, day: 15, source: 'liveDate' });
  assert.deepEqual(loadSiteDate('?liveClock=2026-08-22T12:00:00-04:00&liveDate=07-12', true), { month: 7, day: 12, source: 'liveDate' });
  assert.deepEqual(loadSiteDate('?liveClock=2027-01-01T02:00:00Z', true), { month: 12, day: 31, source: 'liveClock' });
  // a bad ?liveDate= falls back to the clock's day
  assert.deepEqual(loadSiteDate('?liveClock=2026-12-05T12:00:00-05:00&liveDate=2026-13-40', true), { month: 12, day: 5, source: 'liveClock' });
  // no live-sky.js (node tools loading seasons.js alone): no SITE_DATE, and the builders keep SCENE_DATE
  const bare = { CITY: {} };
  vm.runInNewContext(read('js/seasons.js'), { window: bare, Intl, URLSearchParams, Date, location: { search: '' }, navigator: {} });
  assert.equal(bare.CITY.SITE_DATE, undefined);
  // the pure rule, as main.js's applySeason picks the trees' day
  assert.deepEqual(plain(S.siteDay()), { month: 8, day: 22, source: 'preset' });
  assert.deepEqual(plain(S.siteDay({ startup: { mode: 'live', fixedClock: null }, now: new Date('2026-12-24T17:00:00Z') })), { month: 12, day: 24, source: 'live' });
});

test('the site day picks the rinks\' ice and the CaféTO season: a rink in January vs August, patios in July vs November', () => {
  // the rules the builders apply (rinks.js rinkSeason: 1 December - 15 March; cafeto-patios.js patioSeason: 1 June -
  // 30 September; cycling.js bends the bikeways on the same window), checked against their sources
  const rinks = read('js/rinks.js'), patios = read('js/cafeto-patios.js'), cycling = read('js/cycling.js');
  assert.match(rinks, /return m===12\|\|m===1\|\|m===2\|\|\(m===3&&d<=15\)\?'ice':'off';/);
  assert.match(patios, /return md >= 601 && md <= 930;/);
  assert.match(cycling, /if \(C\.PATIOS && !off && md >= 601 && md <= 930\)/);
  const fixture = (date) => loadSiteDate(`?liveClock=2026-08-22T12:00:00-04:00&liveDate=${date}`, true);
  assert.equal(rinkRule(fixture('2026-01-15')), 'ice');
  assert.equal(rinkRule(fixture('2026-08-15')), 'off');
  assert.equal(patioRule(fixture('2026-07-15')), true);
  assert.equal(patioRule(fixture('2026-11-15')), false);
  // the edges, on a real open
  for (const [iso, rink, patio] of [['2026-11-30T17:00:00Z', 'off', false], ['2026-12-01T17:00:00Z', 'ice', false],
    ['2027-03-15T17:00:00Z', 'ice', false], ['2027-03-16T17:00:00Z', 'off', false], ['2026-05-31T16:00:00Z', 'off', false],
    ['2026-06-01T16:00:00Z', 'off', true], ['2026-09-30T16:00:00Z', 'off', true], ['2026-10-01T16:00:00Z', 'off', false]]) {
    const d = loadSiteDate('', false, iso);
    assert.equal(rinkRule(d), rink, `rinks on ${iso}`);
    assert.equal(patioRule(d), patio, `patios on ${iso}`);
  }
  // the presets and automated captures: off-season rinks, the patios in season (as before)
  const preset = loadSiteDate('', true);
  assert.equal(rinkRule(preset), 'off');
  assert.equal(patioRule(preset), true);
  // all three builders read the one day, before falling back to the scene's
  for (const src of [rinks, patios, cycling]) assert.match(src, /SITE_DATE\s*\|\|\s*C(ITY)?\.SCENE_DATE\s*\|\|\s*\{\s*month:\s*8,\s*day:\s*22\s*\}/);
  // and explore.html loads live-sky.js & seasons.js before the first of them (cycling.js routes at load)
  const html = read('explore.html'), pos = (f) => html.indexOf(`'./js/${f}'`);
  for (const f of ['cycling.js', 'cafeto-patios.js', 'rinks.js', 'main.js']) {
    assert.ok(pos(f) > 0 && pos('seasons.js') < pos(f) && pos('live-sky.js') < pos('seasons.js'), `seasons.js before ${f}`);
  }
});
