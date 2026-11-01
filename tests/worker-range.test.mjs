// worker/range.js: the landing clips answer byte-range requests with 206 (Safari / iOS need it to play <video>),
// since the assets binding sends the whole file as 200 whatever the Range header
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker from '../worker/live.js';
import { parseRange } from '../worker/range.js';

const SIZE = 1000;
const FILE = Uint8Array.from({ length: SIZE }, (_, i) => i % 251);
const ETAG = '"abc123"';
const seen = [];
// like the binding: 200 with the whole file, its _headers, 404 off the list. A HEAD gets no body and, like the real
// binding (sloptoronto.ca and wrangler dev, 2026-10-31), no Content-Length either.
const assetHeaders = { 'content-type': 'video/mp4', etag: ETAG, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' };
const env = {
  ASSETS: {
    fetch(req) {
      seen.push(req);
      const { pathname } = new URL(req.url);
      if (!pathname.endsWith('/cinesphere.mp4')) return new Response(null, { status: 404 });
      if (req.method === 'HEAD') return new Response(null, { headers: assetHeaders });
      return new Response(FILE, { headers: { ...assetHeaders, 'content-length': String(SIZE) } });
    }
  }
};
const CLIP = 'https://sloptoronto.ca/assets/site/clips/cinesphere.mp4';
const get = (url, headers = {}, method = 'GET') => worker.fetch(new Request(url, { method, headers }), env, { waitUntil() {} });
const bytes = async (res) => new Uint8Array(await res.arrayBuffer());

test('parseRange reads one byte range and clamps it to the file', () => {
  assert.deepEqual(parseRange('bytes=0-1023', 811367), { start: 0, end: 1023 });
  assert.deepEqual(parseRange('bytes=100-', 1000), { start: 100, end: 999 });
  assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=-5000', 1000), { start: 0, end: 999 });
  assert.deepEqual(parseRange('bytes=990-5000', 1000), { start: 990, end: 999 });
  assert.equal(parseRange('bytes=1000-', 1000), 'unsatisfiable');
  assert.equal(parseRange('bytes=-0', 1000), 'unsatisfiable');
  for (const ignored of [null, '', 'bytes=', 'bytes=-', 'items=0-1', 'bytes=5-2', 'bytes=0-1,5-9', 'bytes=a-b']) {
    assert.equal(parseRange(ignored, 1000), null, String(ignored));
  }
});

test('a clip Range request gets 206 with Content-Range, Content-Length and the exact bytes', async () => {
  for (const [range, start, end] of [['bytes=0-99', 0, 99], ['bytes=500-', 500, 999], ['bytes=-10', 990, 999], ['bytes=0-1', 0, 1], ['bytes=900-99999', 900, 999]]) {
    const res = await get(CLIP, { range });
    assert.equal(res.status, 206, range);
    assert.equal(res.headers.get('content-range'), `bytes ${start}-${end}/${SIZE}`, range);
    assert.equal(res.headers.get('content-length'), String(end - start + 1), range);
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    assert.deepEqual(await bytes(res), FILE.slice(start, end + 1), range);
  }
});

test('206 keeps the asset headers: type, ETag and the _headers caching / nosniff', async () => {
  const res = await get(CLIP, { range: 'bytes=0-9' });
  assert.equal(res.headers.get('content-type'), 'video/mp4');
  assert.equal(res.headers.get('etag'), ETAG);
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('an unsatisfiable range is 416 with Content-Range bytes */size', async () => {
  for (const range of ['bytes=1000-', 'bytes=5000-6000', 'bytes=-0']) {
    const res = await get(CLIP, { range });
    assert.equal(res.status, 416, range);
    assert.equal(res.headers.get('content-range'), `bytes */${SIZE}`);
    assert.equal((await bytes(res)).length, 0);
  }
});

test('a plain GET is still 200 with the whole file, now advertising Accept-Ranges', async () => {
  const res = await get(CLIP);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.equal(res.headers.get('content-length'), String(SIZE));
  assert.deepEqual(await bytes(res), FILE);
});

test('ignored ranges, a stale If-Range and multi-range requests get the whole file as 200', async () => {
  for (const headers of [{ range: 'bytes=0-1,5-9' }, { range: 'bytes=9-2' }, { range: 'bytes=0-9', 'if-range': '"stale"' }, { range: 'bytes=0-9', 'if-range': 'W/"abc123"' }]) {
    const res = await get(CLIP, headers);
    assert.equal(res.status, 200, JSON.stringify(headers));
    assert.equal((await bytes(res)).length, SIZE);
  }
  const res = await get(CLIP, { range: 'bytes=0-9', 'if-range': ETAG });
  assert.equal(res.status, 206, 'a matching If-Range keeps the range');
});

test('HEAD with a range gets the 206 headers and no body', async () => {
  for (const [range, start, end] of [['bytes=10-19', 10, 19], ['bytes=0-1023', 0, SIZE - 1], ['bytes=-10', 990, 999], ['bytes=500-', 500, 999]]) {
    const res = await get(CLIP, { range }, 'HEAD');
    assert.equal(res.status, 206, range);
    assert.equal(res.headers.get('content-range'), `bytes ${start}-${end}/${SIZE}`, range);
    assert.equal(res.headers.get('content-length'), String(end - start + 1), range);
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    assert.equal(res.headers.get('content-type'), 'video/mp4');
    assert.equal(res.body, null);
  }
});

test('a HEAD without Content-Length is measured with a GET that carries no range (regression: 416 bytes */0)', async () => {
  seen.length = 0;
  const res = await get(CLIP, { range: 'bytes=0-1023', 'if-range': ETAG }, 'HEAD');
  assert.equal(res.status, 206);
  assert.notEqual(res.headers.get('content-range'), 'bytes */0');
  assert.deepEqual(seen.map((r) => r.method), ['HEAD', 'GET']);
  assert.equal(seen[1].headers.get('range'), null);
  assert.equal(seen[1].headers.get('if-range'), null);
});

test('a HEAD with an unsatisfiable range is 416 with the real size, never */0', async () => {
  for (const range of ['bytes=1000-', 'bytes=5000-6000', 'bytes=-0']) {
    const res = await get(CLIP, { range }, 'HEAD');
    assert.equal(res.status, 416, range);
    assert.equal(res.headers.get('content-range'), `bytes */${SIZE}`, range);
  }
});

test('a plain HEAD is 200 with Accept-Ranges and costs no extra GET', async () => {
  seen.length = 0;
  const res = await get(CLIP, {}, 'HEAD');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('accept-ranges'), 'bytes');
  assert.equal(res.body, null);
  assert.deepEqual(seen.map((r) => r.method), ['HEAD']);
});

test('a HEAD that declares its Content-Length uses it without a GET', async () => {
  const calls = [];
  const declaring = { ASSETS: { fetch(req) { calls.push(req.method); return new Response(null, { headers: { ...assetHeaders, 'content-length': '5000' } }); } } };
  const res = await worker.fetch(new Request(CLIP, { method: 'HEAD', headers: { range: 'bytes=4000-' } }), declaring, { waitUntil() {} });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 4000-4999/5000');
  assert.deepEqual(calls, ['HEAD']);
});

test('a HEAD whose size cannot be measured is 200 without a range, not 416', async () => {
  for (const [label, getAnswer] of [['GET 500', () => new Response('oops', { status: 500 })], ['GET 404', () => new Response(null, { status: 404 })]]) {
    const failing = { ASSETS: { fetch: (req) => (req.method === 'HEAD' ? new Response(null, { headers: { ...assetHeaders, 'content-length': '' } }) : getAnswer()) } };
    const res = await worker.fetch(new Request(CLIP, { method: 'HEAD', headers: { range: 'bytes=0-9' } }), failing, { waitUntil() {} });
    assert.equal(res.status, 200, label);
    assert.equal(res.headers.get('accept-ranges'), 'bytes', label);
    assert.equal(res.headers.get('content-range'), null, label);
  }
});

test('missing clips and partial answers from the binding pass through untouched', async () => {
  assert.equal((await get('https://sloptoronto.ca/assets/site/clips/nope.mp4', { range: 'bytes=0-9' })).status, 404);
  const partial = new Response('xy', { status: 206, headers: { 'content-range': 'bytes 0-1/2' } });
  const res = await worker.fetch(new Request(CLIP, { headers: { range: 'bytes=0-1' } }), { ASSETS: { fetch: () => partial } }, { waitUntil() {} });
  assert.equal(res, partial);
});

test('clips on the old workers.dev address are served with ranges, not redirected', async () => {
  const res = await get('https://slop-toronto.cloud6711.workers.dev/assets/site/clips/cinesphere.mp4', { range: 'bytes=0-9' });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), `bytes 0-9/${SIZE}`);
  assert.equal((await get('https://slop-toronto.cloud6711.workers.dev/explore')).status, 301, 'the pages still redirect');
});

test('wrangler.jsonc sends the clips to the Worker first, alongside the pages', () => {
  const cfg = JSON.parse(fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
  assert.deepEqual(cfg.assets.run_worker_first, ['/', '/index*', '/explore*', '/assets/site/clips/*']);
  assert.equal(cfg.main, 'worker/live.js');
});
