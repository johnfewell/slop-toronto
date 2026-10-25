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
          assert.equal(element.async, false, 'the browser must preserve dependency order');
          scripts.push(element.src);
        }
      }
    }
  };
  // (no WebGPU here: the module's capability probe awaits nothing and the loader runs straight on)
  const context = vm.createContext({ window, document, navigator: {}, THREE, TSL: {}, StylizedWater: {}, setTimeout, ...imports });
  vm.runInContext(preloadScript[1], context);
  assert.equal(scripts.length, 0);
  // every script the loader lists, once (the count follows the list: scripts are added often)
  assert.equal(links.length, preloadScript[1].match(/'\.\/js\/[\w-]+\.js'/g).length);
  assert.ok(links.findIndex((src) => src.includes('/audio-system.js')) < links.findIndex((src) => src.includes('/main.js')));
  assert.equal(new Set(links).size, links.length, 'each script is preloaded once');

  // Imports are supplied above; evaluate the unchanged module body in the same global lexical environment.
  // (inside an async function: the module awaits the GPU probe at its top level)
  await vm.runInContext(`(async () => {${moduleScript[1].replace(/^\s*import .+;$/gm, '')}})()`, context);
  assert.deepEqual(scripts, links);
  assert.match(scripts[0], /\/quality\.js\?v=/); // the tier is chosen before anything is built
  assert.match(scripts[1], /\/toronto-geodata\.js\?v=/);
  assert.match(scripts.at(-1), /\/main\.js\?v=/);
  assert.equal(new Set(scripts.map((src) => src.split('?v=')[1])).size, 1);
});
