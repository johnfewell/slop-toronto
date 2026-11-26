// usage: node tools/make-live-feed-init.mjs <recorded /live/vehicles json> <out init script>
// A capture init script (CAPTURE_INIT_SCRIPT) that answers the page's /live/vehicles poll with a recorded feed (positions
// as recorded, timestamps moved to now), so a capture on the static server runs the live streetcar matching on real
// positions (window.__LIVE_FEED_RAW holds the recorded feed).
import fs from 'node:fs';
const [src, out] = process.argv.slice(2);
if (!src || !out) throw new Error('usage: make-live-feed-init.mjs <feed.json> <out.js>');
const feed = JSON.parse(fs.readFileSync(src, 'utf8'));
if (!feed || !Array.isArray(feed.v)) throw new Error('not a /live/vehicles feed');
fs.writeFileSync(out, `(() => {
  const feed = ${JSON.stringify(feed)};
  window.__LIVE_FEED_RAW = feed;
  const actual = window.fetch.bind(window);
  window.fetch = (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!url.pathname.endsWith('/live/vehicles')) return actual(input, options);
    const now = Math.floor(Date.now() / 1000);
    return Promise.resolve(new Response(JSON.stringify({ t: now, v: feed.v.map((r) => [r[0], r[1], r[2], r[3], r[4], now - 5, r[6]]) }), { headers: { 'content-type': 'application/json' } }));
  };
})();
`);
