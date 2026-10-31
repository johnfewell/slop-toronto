// The site's city database (data/toronto-geodata.bin, read by js/geodata-loader.js) against the scripts it packs
// (tools/geo-bin.mjs): GEO against js/toronto-geodata.js, the same build's script, and POLES against js/toronto-poles.js,
// every key, every number. The packing is lossless, so every value must come back identical.
// Prints, per top-level key: numbers compared, how many are identical, the largest difference.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { unpackGeo, decodeGeo } from '../js/geodata-loader.js';
import { packCity, LAYERS } from '../tools/geo-bin.mjs';
import { packGeo } from '../tools/geo-pack.mjs';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url));
const layer = (rel, name) => {
  const context = { window: {} };
  vm.runInNewContext(read(rel).toString('utf8'), context);
  return context.window.CITY[name];
};
const scripts = { GEO: 'js/toronto-geodata.js', POLES: 'js/toronto-poles.js' };
const packedLayers = await unpackGeo(read('data/toronto-geodata.bin'));

test('data/toronto-geodata.bin holds exactly the GEO and POLES layers', () => {
  assert.deepEqual(Object.keys(packedLayers), LAYERS);
  assert.deepEqual(Object.keys(scripts), LAYERS);
});

for (const [name, rel] of Object.entries(scripts)) test(`data/toronto-geodata.bin's ${name} decodes to exactly ${rel}`, (t) => {
  const want = layer(rel, name);
  const got = packedLayers[name];

  const rows = [];
  for (const key of new Set([...Object.keys(want), ...Object.keys(got)])) {
    const r = { key, numbers: 0, identical: 0, maxError: 0, other: 0, mismatches: [] };
    const cmp = (a, b, path) => {
      if (typeof a === 'number' && typeof b === 'number') {
        r.numbers++;
        if (Object.is(a, b)) r.identical++;
        r.maxError = Math.max(r.maxError, Math.abs(a - b));
        return;
      }
      r.other++;
      const miss = (why) => r.mismatches.length < 5 && r.mismatches.push(`${path}: ${why}`);
      if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b)) return miss('array vs not');
        if (a.length !== b.length) miss(`length ${a.length} vs ${b.length}`);
        for (let i = 0; i < Math.min(a.length, b.length); i++) cmp(a[i], b[i], `${path}[${i}]`);
        return;
      }
      if (a && b && typeof a === 'object' && typeof b === 'object') {
        if (Object.keys(a).join() !== Object.keys(b).join()) miss('keys differ');
        for (const k of Object.keys(a)) cmp(a[k], b[k], `${path}.${k}`);
        return;
      }
      if (!Object.is(a, b)) miss(`${JSON.stringify(a)?.slice(0, 40)} vs ${JSON.stringify(b)?.slice(0, 40)}`);
    };
    cmp(want[key], got[key], key);
    rows.push(r);
  }
  for (const r of rows) {
    t.diagnostic(`${r.key.padEnd(15)} ${String(r.numbers).padStart(8)} numbers, ${String(r.identical).padStart(8)} identical, max error ${r.maxError}`);
  }
  for (const r of rows) {
    assert.deepEqual(r.mismatches, [], `${r.key}: structure or text differs`);
    assert.equal(r.identical, r.numbers, `${r.key}: ${r.numbers - r.identical} numbers differ (max ${r.maxError})`);
  }
  assert.equal(JSON.stringify(got), JSON.stringify(want));
});

test('the committed binary is the committed scripts packed (rebuild with tools/pack-geodata.mjs)', () => {
  // (a poles or geodata script changed without repacking fails here; tools/build-poles.mjs repacks by itself)
  const packed = packCity({ GEO: layer(scripts.GEO, 'GEO'), POLES: layer(scripts.POLES, 'POLES') });
  assert.ok(packed.file.equals(read('data/toronto-geodata.bin')), 'data/toronto-geodata.bin is stale: node tools/pack-geodata.mjs');
});

test('zigzag columns round-trip, two\'s complement ones too, at every width', () => {
  // scattered points (wide differences of both signs) take the zigzag; the reader undoes it exactly
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const cases = { small: [], medium: [], wide: [], edge: [-(2 ** 30), 2 ** 30 - 1, 0, -1, 1, 2 ** 29, -(2 ** 29)] };
  for (let i = 0; i < 4000; i++) {
    cases.small.push(Math.round((rnd() - 0.5) * 200));
    cases.medium.push(Math.round((rnd() - 0.5) * 60000));
    cases.wide.push(Math.round((rnd() - 0.5) * 2e8) / 10);
  }
  const want = { cases, n: 3.25, k: [1.5, -2, 300000] };
  const { raw, columns } = packGeo(want);
  assert.ok(columns.some((c) => c.zz), 'some column takes the zigzag');
  assert.equal(JSON.stringify(decodeGeo(raw)), JSON.stringify(want));
});

test('explore.html asks for the current file by its hash', () => {
  const hash = crypto.createHash('sha256').update(read('data/toronto-geodata.bin')).digest('hex').slice(0, 12);
  assert.match(read('explore.html').toString('utf8'), new RegExp(`'\\./data/toronto-geodata\\.bin\\?v=${hash}'`),
    'rebuild with tools/build-geodata.mjs (it sets the hash)');
});
