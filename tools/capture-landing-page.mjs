// tools/capture-landing-page.mjs: full-page screenshots of the landing page at 1440x900, 1280x800, 390x844 and 360x780, and
// the motion checks (the cover clip plays; under prefers-reduced-motion and under Save-Data it does not), on the Mac mini via gpu2.
// usage: GPU2_OUT=out CAPTURE_TAG=after- CAPTURE_ROOT=dist node tools/capture-landing-page.mjs
//        GPU2_OUT=out CAPTURE_TAG=before- CAPTURE_BASE=https://sloptoronto.ca node tools/capture-landing-page.mjs   (the live page)
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const TAG = process.env.CAPTURE_TAG || '';
const OUT = process.env.GPU2_OUT || 'capture-out';
const PORT = Number(process.env.CAPTURE_PORT || 8770);
const ROOT = process.env.CAPTURE_ROOT ? path.resolve(process.env.CAPTURE_ROOT) + path.sep : fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm' };
let server = null;
let BASE = process.env.CAPTURE_BASE;
if (!BASE) {
  server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
    const size = fs.statSync(file).size, type = TYPES[path.extname(file)] || 'application/octet-stream', range = req.headers.range;
    if (range) { // (video needs byte ranges)
      const m = /bytes=(\d*)-(\d*)/.exec(range), a = m[1] ? +m[1] : 0, b = m[2] ? +m[2] : size - 1;
      res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${a}-${b}/${size}`, 'accept-ranges': 'bytes', 'content-length': b - a + 1 });
      return fs.createReadStream(file, { start: a, end: b }).pipe(res);
    }
    res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
  }).listen(PORT, '127.0.0.1');
  BASE = `http://127.0.0.1:${PORT}`;
}
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const results = {};
for (const [w, h] of [[1440, 900], [1280, 800], [390, 844], [360, 780]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${BASE}/index.html`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(3500);
  await page.evaluate(async () => { // scroll through so lazy images load
    for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 140)); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, h: document.body.scrollHeight,
    brokenImages: [...document.images].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src')),
    playing: [...document.querySelectorAll('video')].filter((v) => !v.paused).length
  }));
  results[`${w}x${h}`] = { ...info, errors: errors.slice(0, 6) };
  await page.screenshot({ path: path.join(OUT, `${TAG}${w}x${h}-full.png`), fullPage: true });
  await page.screenshot({ path: path.join(OUT, `${TAG}${w}x${h}-fold.png`) });
  await ctx.close();
}
// motion: the cover clip plays by default; reduced motion and Save-Data stop every clip
for (const mode of ['normal', 'reduced', 'savedata']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' });
  if (mode === 'savedata') await ctx.addInitScript(() => { Object.defineProperty(navigator, 'connection', { value: { saveData: true, addEventListener() {} }, configurable: true }); });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/index.html`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForTimeout(5000);
  const m = await page.evaluate(() => ({ videos: document.querySelectorAll('video').length, playing: [...document.querySelectorAll('video')].filter((v) => !v.paused && v.readyState > 1).length, isPlayingFrames: document.querySelectorAll('.is-playing').length }));
  results[`motion-${mode}`] = m;
  await ctx.close();
}
fs.writeFileSync(path.join(OUT, `${TAG}landing-page.json`), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results));
await browser.close();
if (server) server.close();
