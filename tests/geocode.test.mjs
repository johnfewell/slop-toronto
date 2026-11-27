import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as workerGeocode from '../worker/geocode.js';
import worker from '../worker/live.js';
import { AREAS, cityAddressesFor, createLookup, IDLE, lookup, parseAddress, shardOf } from '../js/search-geocode.js';
import { key } from '../js/search-text.js';

const TOKEN = 'test-token';
const ORIGIN = 'https://sloptoronto.ca';
const allow = { limit: async () => ({ success: true }) };
const env = { ION_GEOCODE_TOKEN: TOKEN, GEOCODE_IP: allow, GEOCODE_ALL: allow };
const page = (q, headers = { 'sec-fetch-site': 'same-origin' }, method = 'GET') =>
  new Request(`${ORIGIN}/live/geocode?q=${encodeURIComponent(q)}`, { headers, method });
const point = (label, lon, lat) => ({ properties: { label }, geometry: { type: 'Point', coordinates: [lon, lat] } });
const features = { features: [
  point("Acme Books, Toronto, ON", -79.401, 43.655),
  point("Acme Books, Mississauga, ON", -79.61, 43.63), // inside the old bounding box
  point('Toronto, ON', -79.4, 43.66),
  point('Bookshop, Toronto, ON', -79.4, 43.66),
  point("Acme Books, Toronto, ON", -79.401, 43.655)
] };

test('Worker biases Bing to Toronto and keeps the credential in the authorization header', () => {
  assert.equal(workerGeocode.normalise(' \u0000 Acme   Books  '), 'Acme Books');
  assert.equal(workerGeocode.normalise('x'.repeat(81)), null);
  const { url, init } = workerGeocode.ionRequest('Acme Books', TOKEN);
  assert.equal(new URL(url).searchParams.get('text'), 'Acme Books, Toronto, ON');
  assert.equal(new URL(url).searchParams.has('geocoder'), false);
  assert.equal(url.includes(TOKEN), false);
  assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(init.cf.cacheTtl, 0);
  assert.equal(init.redirect, 'manual');
});

test('Worker rejects an upstream redirect without forwarding the request', async () => {
  const result = await workerGeocode.geocode(page('Acme Books'), env, {
    fetch: async () => Response.redirect('https://example.org/', 302)
  });
  assert.equal(result.status, 502);
});

test('Worker keeps distinct relevant results inside the municipal boundary', () => {
  assert.deepEqual(workerGeocode.parseIon(features, 'Acme Books').map((p) => p.name), ['Acme Books']);
  assert.equal(workerGeocode.relevant('Queen and Spadina', 'Spadina'), false);
  assert.equal(workerGeocode.relevant('Kensignton Market', 'Kensington Market'), true);
  assert.equal(workerGeocode.kindOf('M5V 3L9'), 'Postal code');
});

test('Worker guards the route and sets no-store for both successes and errors', async () => {
  const actualFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(features);
  try {
    const good = await worker.fetch(page('Acme Books'), env);
    assert.equal(good.status, 200);
    assert.equal(good.headers.get('cache-control'), 'no-store');
    assert.equal(good.headers.get('x-data-source'), workerGeocode.ATTRIBUTION);
    assert.deepEqual((await good.json()).results, [{ name: 'Acme Books', kind: 'Place', lat: 43.655, lon: -79.401 }]);
    for (const [request, bindings, expected] of [
      [page('Acme Books', { 'sec-fetch-site': 'cross-site', origin: ORIGIN }), env, 403],
      [page('Acme Books', { origin: 'http://sloptoronto.ca' }), env, 403],
      [page('Acme Books', {}, 'POST'), env, 405],
      [page('x'), env, 400],
      [page('Acme Books'), {}, 503],
      [page('Acme Books'), { ION_GEOCODE_TOKEN: TOKEN }, 503]
    ]) {
      const result = await worker.fetch(request, bindings);
      assert.equal(result.status, expected);
      assert.equal(result.headers.get('cache-control'), 'no-store');
    }
  } finally {
    globalThis.fetch = actualFetch;
  }
});

test('Worker limits per-IP and all requests and backs off for an hour on quota refusal', async () => {
  workerGeocode.resetGeocode();
  let hits = 0, now = 1000;
  const deps = { now: () => now, fetch: async () => { hits++; return new Response(null, { status: 403 }); } };
  const deny = { limit: async () => ({ success: false }) };
  for (const field of ['GEOCODE_IP', 'GEOCODE_ALL']) {
    const result = await workerGeocode.geocode(page('Acme Books'), { ...env, [field]: deny }, deps);
    assert.equal(result.status, 429);
    assert.equal(result.retryAfter, 60);
  }
  assert.equal(hits, 0);
  assert.equal((await workerGeocode.geocode(page('Acme Books'), env, deps)).retryAfter, 3600);
  now += 1000;
  assert.equal((await workerGeocode.geocode(page('Other Place'), env, deps)).retryAfter, 3599);
  assert.equal(hits, 1);
  now += 3600_000;
  await workerGeocode.geocode(page('Other Place'), env, deps);
  assert.equal(hits, 2);
  workerGeocode.resetGeocode();
});

test('only simultaneous identical requests share an upstream answer', async () => {
  let hits = 0;
  let finish;
  const deps = { fetch: async () => {
    hits++;
    if (hits === 1) await new Promise((resolve) => { finish = resolve; });
    return Response.json(features);
  } };
  const responses = [1, 2].map(() => workerGeocode.geocode(page('Acme Books'), env, deps));
  await new Promise(setImmediate);
  assert.equal(hits, 1);
  finish();
  assert.deepEqual(...await Promise.all(responses));
  await workerGeocode.geocode(page('Acme Books'), env, deps);
  assert.equal(hits, 2);
});

const readShard = (file) => readFile(new URL(`../assets/geocoder/addresses/${file}`, import.meta.url), 'utf8').then(JSON.parse);
const addressData = (name) => readShard(shardOf(key(name)).toString(16).padStart(2, '0') + '.json');
test('City shards preserve former municipalities and prefer an exact number across all areas', async () => {
  assert.equal(key('Queen Street West'), key('Queen St W'));
  assert.deepEqual(parseAddress('81 Euclid Ave, Scarborough'), { num: '81', street: 'Euclid Ave', area: 4, outsideCity: false });
  for (const [num, street, areas] of [
    ['81', 'Euclid Ave', ['Old Toronto', 'Scarborough']],
    ['91', 'Olive Ave', ['Old Toronto', 'North York']],
    ['49', 'Westhead Rd', ['Etobicoke']],
    ['850', 'Coxwell Ave', ['East York']],
    ['2700', 'Eglinton Ave W', ['York']]
  ]) {
    const rows = cityAddressesFor(await addressData(street), num, key(street));
    assert.deepEqual(rows.map((r) => AREAS[r.area]).sort(), areas.sort(), `${num} ${street}`);
    assert.ok(rows.every((r) => r.exact));
  }
  const street = key('Queen St W');
  const sample = { s: { [street]: { points: '101 43650000 -79400000 0,112 43651000 -79401000 0' } } };
  assert.equal(cityAddressesFor(sample, '102', street)[0].num, '112');
  assert.equal(cityAddressesFor(sample, '102', street, null, { exactOnly: true }).length, 0);
});

test('an address fetches one shard and marks off-frame rows before they can be picked', async () => {
  const calls = [];
  const options = {
    signal: new AbortController().signal,
    project: (lat, lon) => ({ x: lon, z: lat }),
    near: { x: -79.42, z: 43.65 },
    onMap: (x) => x < -79.35,
    doFetch: async (url) => {
      calls.push(url);
      return Response.json(await readShard(url.split('/').at(-1)));
    }
  };
  const rows = await lookup('81 Euclid Avenue', options);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].startsWith('/assets/geocoder/addresses/'));
  assert.equal(rows.length, 2);
  assert.match(rows[0].sub, /Old Toronto/);
  assert.equal(rows[0].outside, false);
  assert.match(rows[1].sub, /Scarborough/);
  assert.equal(rows[1].outside, true);
  assert.deepEqual(await lookup('100 Queen St W, Mississauga', options), []);
  assert.equal(calls.length, 1);
});

test('geocoded addresses snap to the nearest exact City point and recheck map coverage', async () => {
  const { lat, lon } = cityAddressesFor(await addressData('Euclid Ave'), '81', key('Euclid Ave'), 4)[0];
  const rows = await lookup('Example Business', {
    signal: new AbortController().signal,
    project: (lat, lon) => ({ x: lon * 80000, z: lat * 111000 }),
    onMap: (x) => x < (lon - 0.0001) * 80000,
    doFetch: async (url, init) => {
      if (url.startsWith('/assets/')) return Response.json(await readShard(url.split('/').at(-1)));
      assert.equal(init.cache, 'no-store');
      return Response.json({ results: [{ name: '81 Euclid Ave', kind: 'Address', lat, lon: lon - 0.00025 }] });
    }
  });
  assert.equal(rows[0].x, lon * 80000);
  assert.equal(rows[0].outside, true);
  assert.equal(rows[0].provider, true);
});

test('lookup waits 400 ms, flushes once on Enter and ignores a cancelled result', async () => {
  const calls = [];
  const results = [];
  let queued, finish;
  const client = createLookup((q, signal) => {
    calls.push(q);
    if (q === 'old') return new Promise((resolve) => { finish = () => {
      assert.equal(signal.aborted, true);
      resolve(['old']);
    }; });
    return [q];
  }, {
    setTimer: (cb, delay) => { assert.equal(delay, IDLE); queued = cb; return 1; },
    clearTimer: () => { queued = null; }
  });
  client.start('old', (r) => results.push(...r));
  assert.deepEqual(calls, []);
  client.flush();
  client.flush();
  assert.deepEqual(calls, ['old']);
  client.start('new', (r) => results.push(...r));
  finish();
  queued();
  await Promise.resolve();
  assert.deepEqual(calls, ['old', 'new']);
  assert.deepEqual(results, ['new']);
});
