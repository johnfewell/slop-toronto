import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/live.js';

test('cold bursts share one refresh, recover after failure and cache from completion', async t => {
  let matches = 0, now = 1000000;
  const reads = [], writes = [];
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', () => new Promise(resolve => reads.push(resolve)));
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  t.after(() => saved ? Object.defineProperty(globalThis, 'caches', saved) : delete globalThis.caches);
  globalThis.caches = { default: {
    async match() { matches++; },
    async put(key, response) { writes.push(response); }
  } };
  const get = () => worker.fetch(new Request('https://sloptoronto.ca/live/vehicles'), {}, { waitUntil() {} });
  const burst = () => Promise.all(Array.from({ length: 16 }, get));
  const failed = burst();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads.length, 1);
  reads[0](new Response(null, { status: 503 }));
  for (const response of await failed) assert.equal(response.status, 502);

  const retried = burst();
  await new Promise(resolve => setImmediate(resolve));
  now += 20000;
  const late = get();
  reads[1](new Response(new Uint8Array([10, 2, 24, 42])));
  for (const response of [...await retried, await late, await get()]) {
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { t: 42, v: [] });
  }
  assert.equal(matches, 2);
  assert.equal(reads.length, 2);
  assert.equal(writes.length, 1);
  assert.equal(+writes[0].headers.get('x-fetched-at'), now);
});
