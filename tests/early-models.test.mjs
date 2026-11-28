// js/early-models.js (st-tw6z): the start-up .glb downloads begin when the app starts. A module says what it will want, main.js
// starts the downloads, and the module's load takes the bytes that are already coming, the same parse as loadAsync; a failed
// or unwanted download falls back to loadAsync, and ?earlyModels=0 leaves everything as it was.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../js/early-models.js', import.meta.url), 'utf8');

function setup({ search = '', failing = [] } = {}) {
  const fetched = [];
  const context = vm.createContext({
    window: { CITY: {} },
    location: { search },
    URLSearchParams,
    fetch: async (url) => {
      fetched.push(url);
      if (failing.includes(url)) return { ok: false, status: 404 };
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode(`bytes of ${url}`).buffer };
    }
  });
  vm.runInContext(source, context);
  const loader = {
    loaded: [], parsed: [],
    loadAsync(url) { this.loaded.push(url); return Promise.resolve({ from: 'loadAsync', url }); },
    parseAsync(buf, base) { this.parsed.push(base); return Promise.resolve({ from: 'parse', text: new TextDecoder().decode(buf), base }); }
  };
  return { E: context.window.CITY.earlyModels, fetched, loader };
}

test('nothing is fetched until start(), then every wanted file once, in the order it was wanted', async () => {
  const { E, fetched } = setup();
  E.want(['./assets/a.glb', './assets/b.glb']);
  E.want(['./assets/b.glb', './assets/c.glb']);
  assert.deepEqual(fetched, []);
  E.start();
  E.start();
  assert.deepEqual(fetched, ['./assets/a.glb', './assets/b.glb', './assets/c.glb']);
  E.want(['./assets/d.glb']); // (a module that registers after start begins at once)
  assert.deepEqual(fetched.slice(3), ['./assets/d.glb']);
});

test('load parses the early bytes with the file\'s folder as the base, and a second module can take the same file', async () => {
  const { E, loader, fetched } = setup();
  E.want(['./assets/trees/ez-oak-large.glb']);
  E.start();
  const first = await E.load(loader, './assets/trees/ez-oak-large.glb');
  const second = await E.load(loader, './assets/trees/ez-oak-large.glb');
  assert.equal(first.from, 'parse');
  assert.equal(first.text, 'bytes of ./assets/trees/ez-oak-large.glb');
  assert.equal(first.base, './assets/trees/');
  assert.equal(second.from, 'parse');
  assert.deepEqual(loader.loaded, []);
  assert.equal(fetched.length, 1);
});

test('a file nobody wanted, or one whose download failed, is loaded the usual way', async () => {
  const { E, loader } = setup({ failing: ['./assets/bad.glb'] });
  E.want(['./assets/bad.glb']);
  E.start();
  assert.equal((await E.load(loader, './assets/bad.glb')).from, 'loadAsync');
  assert.equal((await E.load(loader, './assets/other.glb')).from, 'loadAsync');
  assert.deepEqual(loader.loaded, ['./assets/bad.glb', './assets/other.glb']);
});

test('?earlyModels=0 starts nothing and load is loadAsync', async () => {
  const { E, loader, fetched } = setup({ search: '?earlyModels=0' });
  E.want(['./assets/a.glb']);
  E.start();
  assert.deepEqual(fetched, []);
  assert.equal((await E.load(loader, './assets/a.glb')).from, 'loadAsync');
});

test('release lets go of the bytes: later loads go the usual way', async () => {
  const { E, loader } = setup();
  E.want(['./assets/a.glb']);
  E.start();
  assert.equal(E.pending(), 1);
  E.release();
  assert.equal(E.pending(), 0);
  assert.equal((await E.load(loader, './assets/a.glb')).from, 'loadAsync');
});

test('settled resolves when every download begun has finished, and at once when none was begun', async () => {
  const none = setup();
  await none.E.settled();
  const { E } = setup({ failing: ['./assets/bad.glb'] });
  E.want(['./assets/a.glb', './assets/bad.glb']);
  E.start();
  const results = await E.settled();
  assert.equal(results.map((r) => r.status).join(), 'fulfilled,rejected');
});
