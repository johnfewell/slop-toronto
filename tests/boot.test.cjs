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
  // the city database: fetched at once, decoded by js/geodata-loader.js (stubbed), in CITY before any app script runs
  const GEO = {};
  const fetched = [];
  const response = { ok: true };
  const fetch = (url) => { fetched.push(url); return Promise.resolve(response); };
  const __import = async (url) => {
    assert.equal(url, './js/geodata-loader.js'); // (source URL; the production build fingerprints it)
    return { loadGeo: async (request) => { assert.equal(await request, response); return GEO; } };
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
          assert.equal(element.async, false, 'the browser must preserve dependency order');
          scripts.push(element.src);
        }
      }
    }
  };
  // (no WebGPU here: the module's capability probe awaits nothing and the loader runs straight on)
  const context = vm.createContext({ window, document, navigator: {}, THREE, TSL: {}, StylizedWater: {}, setTimeout, fetch, __import, ...imports });
  vm.runInContext(preloadScript[1].replace(/\bimport\(/g, '__import('), context);
  assert.equal(scripts.length, 0);
  assert.equal(fetched.length, 1);
  assert.match(fetched[0], /^\.\/data\/toronto-geodata\.bin\?v=[0-9a-f]{12}$/);
  // every script the loader lists, once (the count follows the list: scripts are added often; the geodata loader is
  // imported, not listed)
  assert.equal(links.length, preloadScript[1].match(/'\.\/js\/[\w-]+\.js'/g).filter((s) => !s.includes('geodata-loader')).length);
  assert.ok(links.findIndex((src) => src.includes('/audio-system.js')) < links.findIndex((src) => src.includes('/main.js')));
  assert.equal(new Set(links).size, links.length, 'each script is preloaded once');

  // Imports are supplied above; evaluate the unchanged module body in the same global lexical environment.
  // (inside an async function: the module awaits the GPU probe at its top level)
  await vm.runInContext(`(async () => {${moduleScript[1].replace(/^\s*import .+;$/gm, '')}})()`, context);
  assert.deepEqual(scripts, links);
  assert.match(scripts[0], /\/quality\.js$/); // source URLs; the production build fingerprints them
  assert.ok(!scripts.some((src) => src.includes('/toronto-geodata.js')), 'the site loads data/toronto-geodata.bin instead');
  assert.match(scripts.at(-1), /\/main\.js$/);
  for (const name of ['photo-mode', 'multiplayer']) assert.ok(scripts.includes(`./js/${name}.js`), `${name} loads before app startup`);
  assert.ok(scripts.indexOf('./js/mp-protocol.js') < scripts.indexOf('./js/multiplayer.js'));
});
