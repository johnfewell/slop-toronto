// The site's city database (data/toronto-geodata.bin, read by js/geodata-loader.js) against js/toronto-geodata.js, the
// same build's script: every key, every number. The packing is lossless, so every value must come back identical.
// Prints, per top-level key: numbers compared, how many are identical, the largest difference.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { unpackGeo } from '../js/geodata-loader.js';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url));

test('data/toronto-geodata.bin decodes to exactly js/toronto-geodata.js', async (t) => {
  const context = { window: {} };
  vm.runInNewContext(read('js/toronto-geodata.js').toString('utf8'), context);
  const want = context.window.CITY.GEO;
  const got = await unpackGeo(read('data/toronto-geodata.bin'));

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

test('explore.html asks for the current file by its hash', () => {
  const hash = crypto.createHash('sha256').update(read('data/toronto-geodata.bin')).digest('hex').slice(0, 12);
  assert.match(read('explore.html').toString('utf8'), new RegExp(`'\\./data/toronto-geodata\\.bin\\?v=${hash}'`),
    'rebuild with tools/build-geodata.mjs (it sets the hash)');
});
