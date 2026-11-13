const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = readFileSync(join(__dirname, '../explore.html'), 'utf8');
const preloadScript = html.match(/<script>([^]*?)<\/script>/);
const moduleScript = html.match(/<script type="module">([^]*?)<\/script>/);

test('city script preloads start before stylesheets can block the loader', () => {
  assert.ok(preloadScript);
  assert.ok(preloadScript.index < html.indexOf('rel="stylesheet"'));
  assert.match(html, /<link rel="preconnect" href="https:\/\/cdn\.jsdelivr\.net" crossorigin\s*\/>/);
});

test('preloaded URLs match ordered scripts and execution waits for Three.js imports', async () => {
  const links = [];
  const scripts = [];
  const window = {};
  const THREE = {};
  // the city database & the mapped poles: fetched at once, decoded by js/geodata-loader.js (stubbed), in CITY before any
  // app script runs
  const GEO = {}, POLES = {};
  const fetched = [];
  const response = { ok: true };
  const fetch = (url) => { fetched.push(url); return Promise.resolve(response); };
  const __import = async (url) => {
    assert.equal(url, './js/geodata-loader.js'); // (source URL; the production build fingerprints it)
    return { loadGeo: async (request) => { assert.equal(await request, response); return { GEO, POLES }; } };
  };
  // every name the module imports (THREE & TSL apart), as a stub
  const imported = [...moduleScript[1].matchAll(/^\s*import (?:\{([^}]+)\}|\* as (\w+)) from/gm)]
    .flatMap((m) => (m[1] ? m[1].split(',') : [m[2]]).map((n) => n.trim()))
    .filter((n) => n && n !== 'THREE' && n !== 'TSL');
  const imports = Object.fromEntries(imported.map((name) => [name, () => {}]));
  const document = {
    createElement: (tagName) => ({ tagName, async: true }),
    head: {
      appendChild(element) {
        if (element.tagName === 'link') {
          assert.equal(window.CITY, undefined, 'fetching does not initialize or execute app code');
          assert.equal(element.rel, 'preload');
          assert.equal(element.as, 'script');
          links.push(element.href);
        } else {
          assert.equal(window.CITY.THREE, THREE, 'Three.js is available before app script execution');
          assert.equal(window.CITY.GEO, GEO, 'the city database is loaded before app script execution');
          assert.equal(window.CITY.POLES, POLES, 'so are the mapped poles packed with it');
          assert.equal(element.async, false, 'the browser must preserve dependency order');
          scripts.push(element.src);
        }
      }
    }
  };
  // (no WebGPU here: the module's capability probe awaits nothing and the loader runs straight on)
  const context = vm.createContext({ window, document, navigator: {}, THREE, TSL: {}, StylizedWater: {}, setTimeout, fetch, __import,
    URLSearchParams, location: { search: '' }, ...imports });
  vm.runInContext(preloadScript[1].replace(/\bimport\(/g, '__import('), context);
  assert.equal(scripts.length, 0);
  assert.equal(fetched.length, 1);
  // (a desktop's default visit: the Eglinton map, explore.html EGLINTON_ON_DESKTOP; tests/eglinton-frame.test.mjs has the rest)
  assert.match(fetched[0], /^\.\/data\/frames\/eglinton\/toronto-geodata\.bin\?v=[0-9a-f]{12}$/);
  // every script the loader lists, once (the count follows the list: scripts are added often; the geodata loader is
  // imported, not listed)
  // (High Park's terrain pilot loads by default; the Don Valley's data only with ?donvalley=1: see the next tests)
  // (and the lidar-only trees' data only with ?lidarTrees=1: see its test below)
  assert.equal(links.length, preloadScript[1].match(/'\.\/js\/[\w-]+\.js'/g).filter((s) => !s.includes('geodata-loader') && !s.includes('/don-valley-data') && !s.includes('/lidar-trees')).length);
  assert.ok(!links.includes('./js/lidar-trees-data.js') && !links.includes('./js/lidar-trees.js'), 'a default visit loads none of the lidar trees');
  assert.ok(links.includes('./js/high-park-data.js') && links.includes('./js/don-valley.js'), 'High Park\'s terrain is on by default');
  assert.ok(!links.includes('./js/don-valley-data.js'), 'the Don Valley pilot is not loaded without its flag');
  // (the wooded parks' data, High Park's and Toronto Island's, just before their runtime)
  assert.ok(links.indexOf('./js/high-park-woods-data.js') + 2 === links.indexOf('./js/park-woods.js'), 'High Park\'s woods load by default');
  assert.ok(links.indexOf('./js/toronto-island-woods-data.js') + 1 === links.indexOf('./js/park-woods.js'), 'Toronto Island\'s woods load by default');
  assert.ok(links.findIndex((src) => src.includes('/audio-system.js')) < links.findIndex((src) => src.includes('/main.js')));
  assert.equal(new Set(links).size, links.length, 'each script is preloaded once');

  // Imports are supplied above; evaluate the unchanged module body in the same global lexical environment.
  // (inside an async function: the module awaits the GPU probe at its top level)
  await vm.runInContext(`(async () => {${moduleScript[1].replace(/^\s*import .+;$/gm, '')}})()`, context);
  assert.deepEqual(scripts, links);
  // (a desktop's default visit, the Eglinton map: nothing of the lidar trees. The page imported only the geodata loader
  // and fetched only the geodata, both asserted above, so no cell index or cell either)
  assert.equal(window.CITY.LIDAR_TREES_CELLS, undefined);
  assert.equal(fetched.length, 1);
  assert.match(scripts[0], /\/quality\.js$/); // source URLs; the production build fingerprints them
  assert.ok(!scripts.some((src) => src.includes('/toronto-geodata.js')), 'the site loads data/toronto-geodata.bin instead');
  assert.ok(!scripts.some((src) => src.includes('/toronto-poles.js')), 'the poles come packed in data/toronto-geodata.bin');
  assert.ok(!scripts.some((src) => src.includes('/toronto-parked-cars.js')), 'so do the parked cars');
  assert.match(scripts.at(-1), /\/main\.js$/);
  for (const name of ['photo-mode', 'multiplayer']) assert.ok(scripts.includes(`./js/${name}.js`), `${name} loads before app startup`);
  assert.ok(scripts.indexOf('./js/mp-protocol.js') < scripts.indexOf('./js/multiplayer.js'));
});

const pilotList = (search, phone = false) => [...vm.runInContext(`${preloadScript[1].match(/const cityAppScripts = (\(\(\) => \{[\s\S]*?\}\)\(\));/)[1]}`,
  vm.createContext({ URLSearchParams, location: { search },
    // (a phone: a touch-first screen, as the loader's `desktop` test reads it)
    ...(phone ? { navigator: { maxTouchPoints: 5 }, matchMedia: () => ({ matches: true }) } : {}) }))]; // (out of the vm's realm)

test('High Park\'s terrain loads by default, its data and the pilots\' runtime just before city-config.js; no flag turns it off', () => {
  const def = pilotList('');
  const at = def.indexOf('./js/city-config.js');
  assert.deepEqual(def.slice(at - 2, at), ['./js/high-park-data.js', './js/don-valley.js']);
  assert.ok(!def.includes('./js/don-valley-data.js'));
  // (the old flag is gone: neither ?highpark=1 nor ?highpark=0 changes the list)
  for (const q of ['?highpark=1', '?highpark=0']) assert.deepEqual(pilotList(q), def, q);
});

test('?donvalley=1 adds the Don Valley\'s data before High Park\'s, the one runtime after both', () => {
  const on = pilotList('?donvalley=1'), def = pilotList('');
  assert.deepEqual(on.filter((s) => s !== './js/don-valley-data.js'), def);
  const at = on.indexOf('./js/city-config.js');
  assert.deepEqual(on.slice(at - 3, at), ['./js/don-valley-data.js', './js/high-park-data.js', './js/don-valley.js']);
});

test('?lidarTrees=1 loads the lidar trees\' runtime, and on a desktop its data: the detail map\'s file, or the Eglinton map\'s cells', () => {
  const iife = preloadScript[1].match(/const cityAppScripts = (\(\(\) => \{[\s\S]*?\}\)\(\));/)[1];
  const loaderFor = (search, phone = false) => vm.runInContext(iife, vm.createContext({ URLSearchParams, location: { search },
    ...(phone ? { navigator: { maxTouchPoints: 5 }, matchMedia: () => ({ matches: true }) } : {}) }));
  for (const q of ['', '?map=detail', '?map=eglinton']) {
    const def = pilotList(q);
    assert.ok(!def.includes('./js/lidar-trees.js') && !def.includes('./js/lidar-trees-data.js'), `a default visit loads neither (${q || 'desktop default'})`);
    assert.equal(loaderFor(q).cityLidarCells, false, `and fetches no cells (${q || 'desktop default'})`);
  }
  // the detail map: its one data file just before the runtime
  const def = pilotList('?map=detail');
  const on = pilotList('?lidarTrees=1&map=detail');
  assert.deepEqual(on.filter((s) => !s.includes('/lidar-trees')), def);
  assert.equal(on.indexOf('./js/lidar-trees-data.js') + 1, on.indexOf('./js/lidar-trees.js'));
  assert.ok(on.indexOf('./js/lidar-trees.js') > on.indexOf('./js/park-woods.js') && on.indexOf('./js/lidar-trees.js') < on.indexOf('./js/street-details.js'));
  assert.equal(loaderFor('?lidarTrees=1&map=detail').cityLidarCells, false);
  // the Eglinton map (a desktop's default): the runtime in the list, the cells fetched by the page (cityLidarCells)
  for (const q of ['?lidarTrees=1', '?lidarTrees=1&map=eglinton']) {
    const l = pilotList(q);
    assert.ok(!l.includes('./js/lidar-trees-data.js') && l.includes('./js/lidar-trees.js'), q);
    assert.equal(loaderFor(q).cityLidarCells, true, q);
  }
  // a phone, or a low tier: desktop only for now (John, 2026-11-12). Neither bake; the runtime says why
  for (const [q, phone] of [['?lidarTrees=1', true], ['?lidarTrees=1&map=detail', true], ['?lidarTrees=1&map=eglinton', true], ['?lidarTrees=1&map=detail&quality=low', false], ['?lidarTrees=1&map=eglinton&quality=medium', false]]) {
    const l = pilotList(q, phone);
    assert.ok(!l.includes('./js/lidar-trees-data.js') && l.includes('./js/lidar-trees.js'), `${q}${phone ? ' (phone)' : ''}`);
    assert.equal(loaderFor(q, phone).cityLidarCells, false, `${q}${phone ? ' (phone)' : ''}`);
  }
  assert.equal(loaderFor('', true).cityDesktop, false);
});
