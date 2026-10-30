// worker/live.js: the old workers.dev address redirects its pages to sloptoronto.ca; everything else is untouched
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/live.js';

const env = { ASSETS: { fetch: (req) => new Response('asset ' + new URL(req.url).host) } };
const get = (url) => worker.fetch(new Request(url), env, { waitUntil() {} });

test('old workers.dev pages redirect permanently to the same path on sloptoronto.ca', async () => {
  for (const [from, to] of [
    ['https://slop-toronto.cloud6711.workers.dev/', 'https://sloptoronto.ca/'],
    ['https://slop-toronto.cloud6711.workers.dev/explore?quality=low', 'https://sloptoronto.ca/explore?quality=low'],
    ['https://slop-toronto.cloud6711.workers.dev/explore.html', 'https://sloptoronto.ca/explore.html']
  ]) {
    const res = await get(from);
    assert.equal(res.status, 301, from);
    assert.equal(res.headers.get('location'), to);
  }
});

test('sloptoronto.ca, www, preview and version URLs are served, not redirected', async () => {
  for (const url of [
    'https://sloptoronto.ca/explore',
    'https://www.sloptoronto.ca/',
    'https://mp-slop-toronto.cloud6711.workers.dev/explore',
    'https://c0943a13-slop-toronto.cloud6711.workers.dev/'
  ]) {
    const res = await get(url);
    assert.equal(res.status, 200, url);
    assert.equal(await res.text(), 'asset ' + new URL(url).host);
  }
});
