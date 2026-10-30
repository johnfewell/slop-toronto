import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { TIME_PRESET_IDS, validateShots } from '../tools/capture-shots.mjs';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('capture time presets match lighting.js TIME_PRESETS and the explore.html time buttons', () => {
  const lighting = read('js/lighting.js');
  const block = lighting.slice(lighting.indexOf('const TIME_PRESETS = {'), lighting.indexOf('\n};', lighting.indexOf('const TIME_PRESETS = {')));
  const presetKeys = [...block.matchAll(/^ {2}([a-z]+): \{/gm)].map((m) => m[1]);
  assert.deepEqual(presetKeys, [...TIME_PRESET_IDS]);
  const buttons = [...read('explore.html').matchAll(/data-time="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(buttons, [...TIME_PRESET_IDS]);
});

test('capture rejects unknown time presets instead of falling back to golden hour', () => {
  assert.doesNotThrow(() => validateShots([{ name: 'a', time: 'midnight' }, { name: 'b' }, { name: 'c', time: 'twilight' }]));
  assert.throws(() => validateShots([{ name: 'ok', time: 'golden' }, { name: 'bench-night', time: 'night' }], 'benches.json'),
    (e) => /benches\.json: unknown time preset/.test(e.message) && /shot 1 "bench-night" has time "night"/.test(e.message)
      && /valid: golden, midday, twilight, midnight/.test(e.message));
  for (const time of ['sunset', 'dusk', 'Midnight', '', null]) assert.throws(() => validateShots([{ name: 'x', time }]), /unknown time preset/);
  assert.throws(() => validateShots({ name: 'not-a-list' }), /expected an array/);
});

test('every checked-in capture fixture uses a valid time preset', () => {
  const dir = new URL('../tools/shots/', import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length > 50, 'positive control: the shot fixtures were found');
  for (const f of files) {
    const shots = JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8'));
    assert.doesNotThrow(() => validateShots(shots, f), f);
  }
});
