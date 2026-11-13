// The Eglinton frame (st-bz1o; tools/frames/eglinton.json: the Humber to Victoria Park, the lake to Eglinton), behind
// explore.html?map=eglinton: a default visit loads exactly today's files, the flag swaps in the frame's own city data
// (data/frames/eglinton/, js/frames/eglinton/, built by tools/frames/build-frame.mjs --install), the page asks for the
// binary by its hash, and the binary is that frame's.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { unpackGeo } from '../js/geodata-loader.js';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url));
const html = read('explore.html').toString();
const preload = html.match(/<script>\s*\/\/ Download the city scripts([\s\S]*?)<\/script>/)[1];
const iife = preload.match(/const cityAppScripts = (\(\(\) => \{[\s\S]*?\}\)\(\));/)[1];
// the page's list on a device: `touch` a phone / tablet's touch-first screen, `memory` navigator.deviceMemory (GB);
// `on` evaluates it with EGLINTON_ON_DESKTOP set (the go, st-bz1o.11)
const listFor = (search, { touch = false, memory, on } = {}) => {
  const src = on === undefined ? iife : iife.replace(/const EGLINTON_ON_DESKTOP = (true|false);/, `const EGLINTON_ON_DESKTOP = ${on};`);
  const navigator = { maxTouchPoints: touch ? 5 : 0, ...(memory ? { deviceMemory: memory } : {}) };
  const matchMedia = (q) => ({ matches: touch ? /coarse|hover: none/.test(q) : /fine|hover: hover/.test(q) });
  return vm.runInContext(src, vm.createContext({ URLSearchParams, location: { search }, navigator, matchMedia }));
};
const scriptsFor = (search, device) => [...listFor(search, device)];
// (toronto-patios.js: that map's prebuilt CaféTO layout, tools/build-patios.mjs --frame eglinton, st-3cbb)
const FRAME_FILES = ['toronto-sidewalks.js', 'toronto-subway.js', 'toronto-subway-topology.js', 'toronto-traffic-data.js',
  'toronto-transit.js', 'toronto-signal-plan.js', 'toronto-patios.js'];

test('a default visit loads no file of the Eglinton frame; ?map=eglinton swaps in exactly its seven scripts', () => {
  // (today's map: ?map=detail anywhere, and a phone's default visit)
  const today = scriptsFor('?map=detail'), other = scriptsFor('', { touch: true }), egl = scriptsFor('?map=eglinton');
  assert.ok(!today.some((s) => s.includes('/frames/')), 'today\'s scripts only');
  assert.deepEqual(other, today, 'a phone\'s default visit is today\'s map');
  assert.deepEqual(scriptsFor('?map=other', { touch: true }), today, 'any other value is the device\'s default');
  assert.equal(egl.length, today.length);
  const swapped = egl.filter((s, i) => s !== today[i]);
  assert.deepEqual(swapped.sort(), FRAME_FILES.map((f) => `./js/frames/eglinton/${f}`).sort());
  for (const f of FRAME_FILES) assert.ok(fs.existsSync(new URL(`../js/frames/eglinton/${f}`, import.meta.url)), f);
});

test('the page asks for the Eglinton binary by its hash, and only under ?map=eglinton', () => {
  const bin = read('data/frames/eglinton/toronto-geodata.bin');
  const hash = crypto.createHash('sha256').update(bin).digest('hex').slice(0, 12);
  assert.ok(html.includes(`./data/frames/eglinton/toronto-geodata.bin?v=${hash}'`), `?v=${hash}`);
  const fetchLine = html.match(/const bin = fetch\((.*)\);/)[1];
  assert.match(fetchLine, /^cityAppScripts\.cityMap === 'eglinton' \? '\.\/data\/frames\/eglinton\/toronto-geodata\.bin\?v=[0-9a-f]{12}' : '\.\/data\/toronto-geodata\.bin\?v=[0-9a-f]{12}'$/);
});

test('the Eglinton binary is the Eglinton frame, with its own city beyond today\'s', async () => {
  const { GEO, POLES } = await unpackGeo(read('data/frames/eglinton/toronto-geodata.bin'));
  const frame = JSON.parse(read('tools/frames/eglinton.json'));
  assert.deepEqual(GEO.frame.detail, frame.world);
  // Yonge & Eglinton has buildings; Line 5 is streetcar track (tools/geo-rails.mjs light rail), mostly in its tunnel
  assert.ok(GEO.buildings.filter((b) => Math.hypot(b[0] - 568, b[1] + 6937) < 300).length > 50, 'buildings at Yonge & Eglinton');
  const line5 = GEO.rails.filter((r) => r[0] === 0 && r[4].some((v, i) => i % 2 === 1 && v < -6500));
  assert.ok(line5.length > 50 && line5.some((r) => r[3] & 2), `${line5.length} streetcar ways north of -6500, some in tunnel`);
  assert.ok(POLES && Object.values(POLES.counts).reduce((a, b) => a + b, 0) > 90000, 'the frame\'s own mapped poles');
});

test('desktops get the Eglinton map (switched on: st-bz1o.11); phones, tablets, low tiers and small machines never', () => {
  assert.match(iife, /const EGLINTON_ON_DESKTOP = true;/, 'on since John\'s go (2026-11-05)');
  assert.equal(listFor('').cityMap, 'eglinton', 'a desktop\'s default visit');
  assert.equal(listFor('', { on: false }).cityMap, 'detail', 'switched off: a desktop gets today\'s map');
  assert.equal(listFor('?map=eglinton', { touch: true }).cityMap, 'eglinton', '?map=eglinton on any device');
  const on = { on: true };
  assert.equal(listFor('', on).cityMap, 'eglinton', 'on: a desktop');
  assert.equal(listFor('?quality=high', on).cityMap, 'eglinton');
  assert.equal(listFor('', { ...on, memory: 8 }).cityMap, 'eglinton');
  assert.equal(listFor('?map=detail', on).cityMap, 'detail', '?map=detail');
  assert.equal(listFor('', { ...on, touch: true }).cityMap, 'detail', 'a phone or tablet');
  assert.equal(listFor('?quality=low', on).cityMap, 'detail');
  assert.equal(listFor('?quality=medium', on).cityMap, 'detail');
  assert.equal(listFor('', { ...on, memory: 4 }).cityMap, 'detail', 'under 8 GB');
  assert.deepEqual(scriptsFor('', on), scriptsFor('?map=eglinton'), 'the switch loads the same files as the flag');
});

test('the storefront signs find their buildings and places in the Eglinton frame\'s rows; today\'s rows stay as compiled', async () => {
  const load = (GEO) => {
    const window = { CITY: { THREE: {}, TSL: new Proxy({}, { get: () => () => ({}) }), GEO } };
    vm.runInNewContext(read('js/toronto-storefronts.js').toString(), { window });
    vm.runInNewContext(read('js/storefront-signs.js').toString(), { window, console });
    return window.CITY;
  };
  const today = (await unpackGeo(read('data/toronto-geodata.bin'))).GEO;
  const egl = (await unpackGeo(read('data/frames/eglinton/toronto-geodata.bin'))).GEO;
  const T = load(today), E = load(egl);
  const before = JSON.stringify(T.STOREFRONTS.signs.map((s) => [s.b, s.poi]));
  T.rebindStorefrontRows(T.STOREFRONTS, today.buildings, today.pois);
  assert.equal(JSON.stringify(T.STOREFRONTS.signs.map((s) => [s.b, s.poi])), before, 'today\'s geodata: nothing moves');
  E.rebindStorefrontRows(E.STOREFRONTS, egl.buildings, egl.pois);
  const signs = E.STOREFRONTS.signs;
  assert.ok(signs.length >= 40);
  for (const s of signs) {
    const b = egl.buildings[s.b], t = today.buildings[T.STOREFRONTS.signs.find((r) => r.id === s.id).b];
    assert.ok(Math.abs(b[0] - s.bc[0]) <= 0.05 && Math.abs(b[1] - s.bc[1]) <= 0.05, `${s.name}: its building`);
    assert.deepEqual([b[2], b[3]], [t[2], t[3]], `${s.name}: the same footprint, so the same wall`);
    const p = egl.pois[s.poi], q = today.pois[T.STOREFRONTS.signs.find((r) => r.id === s.id).poi];
    assert.deepEqual([p[0], p[1], p[2], p[4]], [q[0], q[1], q[2], s.b], `${s.name}: its place`);
  }
});

test('today\'s buildings keep today\'s paint and roofs in the Eglinton frame (tools/frames/align-buildings.mjs)', async () => {
  const today = (await unpackGeo(read('data/toronto-geodata.bin'))).GEO.buildings;
  const egl = (await unpackGeo(read('data/frames/eglinton/toronto-geodata.bin'))).GEO.buildings;
  const key = (b) => `${b[0]},${b[1]},${JSON.stringify(b[3])}`;
  const at = new Map();
  for (const b of egl) (at.get(key(b)) || at.set(key(b), []).get(key(b))).push(b);
  let differ = 0;
  for (const b of today) {
    const e = at.get(key(b))?.shift();
    assert.ok(e, `today's building at ${b[0]}, ${b[1]} is in the frame`);
    if (e[6] !== b[6] || e[7] !== b[7]) differ++;
  }
  assert.equal(differ, 0, 'buildings repainted or re-roofed');
});
