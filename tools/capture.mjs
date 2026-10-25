// tools/capture.mjs — screenshots of the running app for review (run on the Mac mini via gpu2, never on the laptop)
// usage: GPU2_OUT=out node tools/capture.mjs [shot.json]   (serves this folder itself: vite would rewrite the import map)
// A shot is { name, mode?, time?, camera?, x?, z?, heading?, wait?, js? } (js: a page expression run before the shot) (world metres, see the geodata frame); the
// default list is one overview per time of day.
// CAPTURE_ROOT=dist serves another folder (the built site); CAPTURE_STATIC=1 with CAPTURE_PAGE=index.html screenshots a
// plain page (full page, desktop and phone width) instead of waiting for the city.
// Phone-like runs: CAPTURE_VIEWPORT=412x915 (CSS px), CAPTURE_DPR=2.625, CAPTURE_MOBILE=1 (isMobile & hasTouch, so the
// auto quality tier & the touch UI kick in), CAPTURE_CPU_THROTTLE=4 (the page's main thread that many times slower);
// CAPTURE_UNCAPPED=1 lifts vsync & the frame rate limit, so frame times under 16.7 ms show; CAPTURE_TAG=<t> prefixes
// the screenshots' names (one shot list for several runs). CAPTURE_HEAP=1 writes heap.txt: what stays alive on the JS
// heap after the shots, by allocating function & script (a sampling heap profile).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = process.env.CAPTURE_ROOT ? path.resolve(process.env.CAPTURE_ROOT) + path.sep : fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.CAPTURE_PORT || 8768);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json' };
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
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist',
    ...(process.env.CAPTURE_UNCAPPED ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : []),
    // CAPTURE_HEAP=1 also exposes gc(), so ?memlog=1 reads the heap after a full collection
    ...(process.env.CAPTURE_HEAP ? ['--js-flags=--expose-gc'] : [])]
});
const [VW, VH] = (process.env.CAPTURE_VIEWPORT || '1600x900').split('x').map(Number);
const MOBILE = !!process.env.CAPTURE_MOBILE;
const page = await browser.newPage({
  viewport: { width: VW, height: VH },
  deviceScaleFactor: Number(process.env.CAPTURE_DPR || 1),
  isMobile: MOBILE,
  hasTouch: MOBILE
});
const TAG = process.env.CAPTURE_TAG ? `${process.env.CAPTURE_TAG}-` : '';
if (process.env.CAPTURE_CPU_THROTTLE) {
  const throttle = await page.context().newCDPSession(page);
  await throttle.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CAPTURE_CPU_THROTTLE) });
}
const log = [];
page.on('console', (m) => log.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
page.on('response', (r) => { if (r.status() >= 400) log.push(`[http ${r.status()} error] ${r.url()}`); });

// CAPTURE_PROFILE=1: a CPU profile of the load (until the city is ready), its top self-time functions in profile.txt;
// CAPTURE_PROFILE=shots profiles the shots instead (riding: a shot's hold is a key held through its wait, e.g. "KeyW")
const PROFILE = process.env.CAPTURE_PROFILE;
const cdp = PROFILE ? await page.context().newCDPSession(page) : null;
const startProfile = async () => { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); };
const stopProfile = async () => {
  const { profile } = await cdp.send('Profiler.stop');
  const dt = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n]));
  profile.samples.forEach((id, i) => dt.set(id, (dt.get(id) || 0) + (profile.timeDeltas[i] || 0)));
  const self = new Map();
  for (const [id, us] of dt) {
    const f = byId.get(id).callFrame;
    const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
    self.set(k, (self.get(k) || 0) + us);
  }
  const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 60).map(([k, us]) => `${Math.round(us / 1000)} ms  ${k}`);
  fs.writeFileSync(path.join(OUT, 'profile.txt'), top.join('\n') + '\n');
};
if (PROFILE && PROFILE !== 'shots') await startProfile();
// CAPTURE_HEAP=1: a sampling heap profile from the load to the end of the shots: what is still alive, by the function
// & script that allocated it (heap.txt), and the JS heap size
const HEAP = process.env.CAPTURE_HEAP;
const hcdp = HEAP ? await page.context().newCDPSession(page) : null;
// (CAPTURE_HEAP=alloc: from the shots on, every allocation sampled, garbage included: what the frames allocate)
if (HEAP && HEAP !== 'alloc') { await hcdp.send('HeapProfiler.enable'); await hcdp.send('HeapProfiler.startSampling', { samplingInterval: 32768 }); }
const stopHeap = async () => {
  if (HEAP !== 'alloc') await hcdp.send('HeapProfiler.collectGarbage');
  const { profile } = await hcdp.send('HeapProfiler.getSamplingProfile');
  const bySite = new Map(), byScript = new Map();
  const walk = (n, stack) => {
    const f = n.callFrame;
    const here = `${f.functionName || '(anon)'} ${f.url.split('/').pop().split('?')[0]}:${f.lineNumber + 1}`;
    const st = [...stack, here];
    if (n.selfSize) {
      // the allocation site & its two callers, so builders are told apart
      const k = st.slice(-3).reverse().join(' < ');
      bySite.set(k, (bySite.get(k) || 0) + n.selfSize);
      const sc = f.url.split('/').pop().split('?')[0] || '(native)';
      byScript.set(sc, (byScript.get(sc) || 0) + n.selfSize);
    }
    for (const c of n.children) walk(c, st);
  };
  walk(profile.head, []);
  const mb = (b) => (b / 1048576).toFixed(1).padStart(7) + ' MB';
  const used = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
  const total = [...byScript.values()].reduce((a, b) => a + b, 0);
  fs.writeFileSync(path.join(OUT, `${TAG}heap.txt`), [`usedJSHeapSize ${used} MB, sampled live ${mb(total)}`, '', 'by script:',
    ...[...byScript].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${mb(v)}  ${k}`), '', 'by site:',
    ...[...bySite].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([k, v]) => `${mb(v)}  ${k}`)].join('\n') + '\n');
};
const t0 = Date.now();
await page.goto(`${BASE}/${process.env.CAPTURE_PAGE || 'explore.html'}${process.env.CAPTURE_QUERY || ''}`, { waitUntil: 'load' });
const flush = () => fs.writeFileSync(path.join(OUT, `${TAG}console.log`), log.join('\n') + '\n');
if (process.env.CAPTURE_STATIC) {
  const name = path.basename(process.env.CAPTURE_PAGE || 'page', '.html');
  await page.waitForTimeout(2500);
  await page.evaluate(async () => { // scroll through so lazy images load, then show every section
    for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
    window.scrollTo(0, 0);
    document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in'));
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, `${name}-desktop.png`), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, `${name}-phone.png`), fullPage: true });
  flush();
  console.log(log.filter((l) => l.includes('error') || l.includes('404')).join('\n') || `[capture] ${name} ok`);
  await browser.close();
  server.close();
  process.exit(0);
}
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
if (PROFILE && PROFILE !== 'shots') await stopProfile();
if (PROFILE === 'shots') await startProfile();
if (HEAP === 'alloc') {
  await hcdp.send('HeapProfiler.enable');
  await hcdp.send('HeapProfiler.startSampling', { samplingInterval: 8192, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
}

for (const s of shots) {
  await page.evaluate((s) => {
    const app = window.__CITY_APP;
    if (s.mode) app.selectMode(s.mode);
    if (s.x !== undefined) app.teleportTo(s.x, s.z, s.heading ?? Math.PI);
    if (s.time) app.selectTime(s.time);
    if (s.camera) app.selectCamera(s.camera, true);
    if (s.js) (0, eval)(s.js);
  }, s);
  if (s.hold) await page.keyboard.down(s.hold);
  await page.waitForTimeout(s.wait ?? 4000);
  if (s.hold) await page.keyboard.up(s.hold);
  const fps = await page.evaluate(() => window.__CITY_APP.getFps());
  await page.screenshot({ path: path.join(OUT, `${TAG}${s.name}.png`) });
  log.push(`[capture] ${TAG}${s.name} fps ${Math.round(fps)}`);
}
if (PROFILE === 'shots') await stopProfile();
if (HEAP) await stopHeap();
flush();
console.log(log.filter((l) => l.startsWith('[capture]') || l.includes('error')).join('\n'));
await browser.close();
server.close();
