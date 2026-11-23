// st-ndw9.19: ?massing=1 with no presets parameter shows the drawn presets (it behaves as ?presets=draw); ?presets=0 or off is the
// old massing look; every other value keeps its meaning; the drawn buildings are on by default only on the bigger desktop map (st-ndw9.21). The logic lives in
// js/main.js: its text is cut out and run here against fake addresses.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const main = fs.readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
const flagCode = main.match(/const presetsParam = [\s\S]*?if \(presetsByDefault\) presetsFlag = 'draw';/)[0];
const flags = (search, gallery = false) => {
  const ctx = vm.createContext({ URLSearchParams, location: { search }, galleryPage: gallery, out: null });
  vm.runInContext(`${flagCode}\nout = { presetsFlag, presetsByDefault, presetsOff };`, ctx);
  return ctx.out;
};

test('?massing=1 with no presets parameter is presets=draw; 0 and off are the old look; other values keep their meaning', () => {
  assert.deepEqual({ ...flags('?massing=1') }, { presetsFlag: 'draw', presetsByDefault: true, presetsOff: false });
  assert.deepEqual({ ...flags('?map=detail&massing=1') }, { presetsFlag: 'draw', presetsByDefault: true, presetsOff: false });
  for (const q of ['?massing=1&presets=0', '?massing=1&presets=off', '?massing=1&presets=']) assert.equal(flags(q).presetsFlag, null, q);
  for (const v of ['draw', 'debug', '1']) assert.equal(flags(`?massing=1&presets=${v}`).presetsFlag, v);
  assert.equal(flags('?massing=1&presets=draw').presetsByDefault, false, 'an explicit draw is not the default');
});

test('the gallery page keeps its meaning: draw by default, and an explicit presets value as given', () => {
  assert.equal(flags('?gallery=presets', true).presetsFlag, 'draw');
  assert.equal(flags('?gallery=presets', true).presetsByDefault, false);
  assert.equal(flags('?gallery=presets&presets=debug', true).presetsFlag, 'debug');
});

test('the drawing is told by a flag, not by rewriting the address: js/buildings.js reads it only for a missing presets parameter', () => {
  const buildings = fs.readFileSync(new URL('../js/buildings.js', import.meta.url), 'utf8');
  const line = buildings.match(/  const urlFlag = .*\n/)[0];
  const run = (search, flag, massing = true) => {
    const ctx = vm.createContext({ URLSearchParams, location: { search }, window: { CITY: { PRESETS_DRAW_BY_DEFAULT: flag } }, massing, out: null });
    vm.runInContext(`${line}\nout = [urlFlag('presets'), urlFlag('gallery')];`, ctx);
    return [...ctx.out];
  };
  assert.deepEqual(run('?massing=1', true), ['draw', null]);
  assert.deepEqual(run('', true), ['draw', null]);
  assert.deepEqual(run('?presets=debug', true), ['debug', null], 'an explicit value wins');
  assert.deepEqual(run('?presets=0', true), ['0', null]);
  assert.deepEqual(run('?massing=1', false), [null, null], 'no flag, no presets parameter: nothing drawn');
  assert.deepEqual(run('?presets=draw', false, false), [null, null], 'without the massing mode nothing reads the address');
  assert.ok(!main.includes('history.replaceState'), 'the address is no longer rewritten');
});

test('the drawn buildings are on by default only on the bigger desktop map; ?presets=0 or off, a phone, a low tier and ?map=detail keep today\'s page', () => {
  const code = main.match(/  const loader = typeof cityAppScripts[\s\S]*?presetsArg !== 'off';/)[0];
  const on = (search, loader) => {
    const ctx = vm.createContext({ URLSearchParams, location: { search }, cityAppScripts: loader, out: null });
    vm.runInContext(`${code}\nout = drawnByDefault;`, ctx);
    return ctx.out;
  };
  const big = { cityMap: 'eglinton', cityDesktop: true };
  assert.equal(on('', big), true);
  assert.equal(on('?autoscale=0&film', big), true);
  assert.equal(on('?presets=debug', big), true);
  assert.equal(on('?presets=0', big), false);
  assert.equal(on('?presets=off&massing=1', big), false);
  assert.equal(on('', { cityMap: 'detail', cityDesktop: true }), false, '?map=detail, or a desktop kept on the detail map');
  assert.equal(on('', { cityMap: 'detail', cityDesktop: false }), false, 'a phone');
  assert.equal(on('?map=eglinton', { cityMap: 'eglinton', cityDesktop: false }), false, 'a phone asked for the bigger map: still today\'s page');
  assert.equal(on('', undefined), false, 'a page with no loader');
});

test('the massing block runs for the default desktop page, the flag and the gallery, and the flag code sits inside it', () => {
  const start = main.indexOf("if (new URLSearchParams(location.search).get('massing') === '1' || galleryPage || drawnByDefault) {");
  const flag = main.indexOf('const presetsParam', start);
  assert.ok(start > 0 && flag > start);
  assert.equal(main.indexOf('const presetsParam'), flag, 'nothing reads the presets parameter before the massing block');
});
