// st-ndw9.13 follow-up: ?gallery=presets chooses the detail map itself (the massing and presets files exist only for it), no
// other URL's map changes, and a presets flag on a map with no presets data says so.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { exploreContext } from './helpers/explore-context.cjs';
import test from 'node:test';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const html = read('explore.html');
const iife = html.match(/<script>\s*\/\/ Download the city scripts([\s\S]*?)<\/script>/)[1].match(/const cityAppScripts = (\(\(\) => \{[\s\S]*?\}\)\(\));/)[1];
const listFor = (search, { touch = false } = {}) => {
  const navigator = { maxTouchPoints: touch ? 5 : 0 };
  const matchMedia = (q) => ({ matches: touch ? /coarse|hover: none/.test(q) : /fine|hover: hover/.test(q) });
  return [...vm.runInContext(iife, exploreContext({ location: { search }, navigator, matchMedia }))];
};
const isEglinton = (list) => list.some((s) => s.includes('/frames/eglinton/'));

test('?gallery=presets alone loads the detail map on a desktop, and on a phone (already the detail map)', () => {
  assert.ok(!isEglinton(listFor('?gallery=presets')), 'desktop');
  assert.deepEqual(listFor('?gallery=presets'), listFor('?map=detail'));
  assert.deepEqual(listFor('?gallery=presets', { touch: true }), listFor('', { touch: true }));
});

test('no other URL changes map: the desktop default and the presets flags still get the bigger map, ?map= still wins', () => {
  assert.ok(isEglinton(listFor('')), 'a desktop default is the bigger map');
  assert.ok(isEglinton(listFor('?massing=1')), '?massing=1 alone is untouched');
  assert.ok(isEglinton(listFor('?massing=1&presets=draw')));
  assert.ok(isEglinton(listFor('?massing=1&presets=debug')));
  assert.ok(isEglinton(listFor('?gallery=other')));
  assert.ok(isEglinton(listFor('?gallery=presets&map=eglinton')), 'an explicit map is respected');
  assert.ok(!isEglinton(listFor('?gallery=presets&map=detail')));
});

test('a presets flag with the sidecar refused warns once that the presets need ?map=detail; ?presets=debug shows it in the legend’s place', () => {
  const main = read('js/main.js');
  assert.match(main, /if \(presetsFlag && M\.error && !presetsByDefault\) \{[\s\S]*?The building presets need \?map=detail[\s\S]*?console\.warn\(`\[presets\] \$\{need\}`\)/);
  assert.match(main, /if \(presetsFlag === 'debug'\) window\.CITY\.__PRESETS_NEED_DETAIL = need;/);
  assert.match(main, /if \(window\.CITY\.__PRESETS_NEED_DETAIL\) \{[\s\S]*?preset-needs-detail/);
  // ?massing=1 alone (no presets parameter, st-ndw9.19: it means presets=draw) takes none of it: on the bigger map it keeps its own
  // warning and nothing else, as before
  assert.match(main, /const presetsByDefault = presetsParam === null && !galleryPage;[\s\S]*?if \(presetsFlag && M\.error && !presetsByDefault\)/);
});
