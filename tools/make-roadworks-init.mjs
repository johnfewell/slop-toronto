// usage: node tools/make-roadworks-init.mjs <recorded /live/roadworks json> <out init script>
// A capture init script (CAPTURE_INIT_SCRIPT) that answers the page's /live/roadworks request with a recorded feed, so a
// capture on the static server (which has no Worker) draws the City's real road works of the recorded day. Record one with
// `curl https://sloptoronto.ca/live/roadworks`, or cut the City's own feed with worker/roadworks.js parseRestrictions.
import fs from 'node:fs';
const [src, out] = process.argv.slice(2);
if (!src || !out) throw new Error('usage: make-roadworks-init.mjs <feed.json> <out.js>');
const feed = JSON.parse(fs.readFileSync(src, 'utf8'));
if (!feed || !Array.isArray(feed.records) || !Number.isFinite(feed.t)) throw new Error('not a /live/roadworks feed');
fs.writeFileSync(out, `(() => {
  const feed = ${JSON.stringify(feed)};
  window.__ROADWORKS_FEED_RAW = feed;
  const actual = window.fetch.bind(window);
  window.fetch = (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!url.pathname.endsWith('/live/roadworks')) return actual(input, options);
    return Promise.resolve(new Response(JSON.stringify(feed), { headers: { 'content-type': 'application/json' } }));
  };
})();
`);
