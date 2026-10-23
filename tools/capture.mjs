// tools/capture.mjs — screenshots of the running app for review (run on the Mac mini via gpu2, never on the laptop)
// usage: GPU2_OUT=out node tools/capture.mjs [shot.json]   (serves this folder itself: vite would rewrite the import map)
// A shot is { name, mode?, time?, camera?, x?, z?, heading?, wait?, js? } (js: a page expression run before the shot) (world metres, see the geodata frame); the
// default list is one overview per time of day.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.CAPTURE_PORT || 8768);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1');
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = process.env.GPU2_OUT || 'capture-out';
const shots = process.argv[2]
  ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  : [{ name: 'start-golden', time: 'golden' }, { name: 'start-midday', time: 'midday' }];

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  channel: 'chromium',
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const log = [];
page.on('console', (m) => log.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));

const t0 = Date.now();
await page.goto(`${BASE}/${process.env.CAPTURE_PAGE || 'explore.html'}${process.env.CAPTURE_QUERY || ''}`, { waitUntil: 'load' });
const flush = () => fs.writeFileSync(path.join(OUT, 'console.log'), log.join('\n') + '\n');
try {
  await page.waitForFunction(() => window.__CITY_APP?.ready, null, { timeout: 240000 });
} catch (e) {
  log.push(`[capture] not ready: ${e.message.split('\n')[0]}`);
  await page.screenshot({ path: path.join(OUT, 'not-ready.png') });
  flush();
  console.log(log.slice(-30).join('\n'));
  process.exit(1);
}
log.push(`[capture] ready after ${Date.now() - t0} ms`);

for (const s of shots) {
  await page.evaluate((s) => {
    const app = window.__CITY_APP;
    if (s.mode) app.selectMode(s.mode);
    if (s.x !== undefined) app.teleportTo(s.x, s.z, s.heading ?? Math.PI);
    if (s.time) app.selectTime(s.time);
    if (s.camera) app.selectCamera(s.camera, true);
    if (s.js) (0, eval)(s.js);
  }, s);
  await page.waitForTimeout(s.wait ?? 4000);
  const fps = await page.evaluate(() => window.__CITY_APP.getFps());
  await page.screenshot({ path: path.join(OUT, `${s.name}.png`) });
  log.push(`[capture] ${s.name} fps ${Math.round(fps)}`);
}
flush();
console.log(log.filter((l) => l.startsWith('[capture]') || l.includes('error')).join('\n'));
await browser.close();
server.close();
