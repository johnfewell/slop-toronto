// tools/capture.mjs — screenshots of the running app for review (run on the Mac mini via gpu2, never on the laptop)
// usage: GPU2_OUT=out node tools/capture.mjs [shot.json]   (serves this folder itself: vite would rewrite the import map)
// A shot is { name, mode?, time?, camera?, x?, z?, heading?, wait?, js? } (js: a page expression run before the shot) (world metres, see the geodata frame); the
// A shot may also tap a selector (`tap`) after its setup or reload before setup (`reload`); async `js` is awaited. The
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
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { chromium } from 'playwright';
import { validateShots } from './capture-shots.mjs';

// (checked before the server & browser start: an unknown time preset is an error, not a silent golden hour)
const shots = process.argv[2]
  ? process.argv.slice(2).flatMap((file) => validateShots(JSON.parse(fs.readFileSync(file, 'utf8')), file))
  : [{ name: 'start-golden', time: 'golden' }, { name: 'start-midday', time: 'midday' }];
const ROOT = process.env.CAPTURE_ROOT ? path.resolve(process.env.CAPTURE_ROOT) + path.sep : fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.CAPTURE_PORT || 8768);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1');
// (CAPTURE_BASE: another server's origin instead, e.g. `npx wrangler@4 dev`'s, for the Worker's /live/vehicles)
const BASE = process.env.CAPTURE_BASE || `http://127.0.0.1:${PORT}`;
const OUT = process.env.GPU2_OUT || 'capture-out';

fs.mkdirSync(OUT, { recursive: true });
const METRICS_MS = Number(process.env.CAPTURE_METRICS_MS || 0);
const METRICS_WARMUP = Number(process.env.CAPTURE_METRICS_WARMUP_MS || 1500);
if (!Number.isFinite(METRICS_MS) || METRICS_MS < 0 || METRICS_MS > 120000
    || !Number.isFinite(METRICS_WARMUP) || METRICS_WARMUP < 0 || METRICS_WARMUP > 60000) throw new Error('invalid metrics duration/warm-up');
// Read-only observation before launching our own browser. gpu2 owns the shared lock; do not kill contenders.
const contention = { checkedAt: new Date().toISOString(), wrapperMarker: fs.existsSync(path.join(OUT, 'CONTENDED.txt')), processes: [], checked: false };
if (process.env.CAPTURE_IDLE_CHECK === '1') {
  try {
    const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,%cpu=,comm='], { encoding: 'utf8' });
    contention.processes = rows.split('\n').flatMap((line) => {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(.+)$/);
      return m && /chromium|google chrome|safari|webkit|whisper|franken/i.test(m[4])
        ? [{ pid: Number(m[1]), ppid: Number(m[2]), cpuPercent: Number(m[3]), command: m[4] }] : [];
    });
    contention.checked = true;
  } catch (e) { contention.error = e.message; }
}
const measurementClass = contention.wrapperMarker || contention.processes.some((p) => p.cpuPercent >= 1) ? 'contended-functional'
  : contention.processes.length ? 'background-processes-unqualified' : contention.checked ? 'no-observed-contention' : 'unqualified';
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
// Deterministic network fixtures for application lifecycle checks, isolated to this fresh browser context.
if (process.env.CAPTURE_INIT_SCRIPT) await page.addInitScript({ path: path.resolve(process.env.CAPTURE_INIT_SCRIPT) });
const seed = process.env.CAPTURE_SEED === undefined ? null : Number(process.env.CAPTURE_SEED);
if (seed !== null) {
  if (!Number.isSafeInteger(seed) || seed < 1 || seed > 0xffffffff) throw new Error('CAPTURE_SEED must be uint32 > 0');
  await page.addInitScript((initial) => {
    let state = initial;
    Math.random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  }, seed);
}
const TAG = process.env.CAPTURE_TAG ? `${process.env.CAPTURE_TAG}-` : '';
if (process.env.CAPTURE_CPU_THROTTLE) {
  const throttle = await page.context().newCDPSession(page);
  await throttle.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CAPTURE_CPU_THROTTLE) });
}
const log = [];
// Optional transport cache for the exact immutable Three.js commit in the
// shipped import map. No npm substitution or alternate renderer: this only
// avoids Chromium's intermittent CDN network-change failures on the mini.
if(process.env.CAPTURE_CDN_CACHE) {
  const html=fs.readFileSync(path.join(ROOT,process.env.CAPTURE_PAGE||'explore.html'),'utf8');
  const prefix=html.match(/https:\/\/cdn\.jsdelivr\.net\/gh\/mrdoob\/three\.js@[a-f0-9]{40}\//)?.[0];
  if(!prefix)throw new Error('Capture CDN cache requires an immutable Three.js commit URL');
  const cache=path.join(os.homedir(),'.cache/slop-toronto/capture-cdn');fs.mkdirSync(cache,{recursive:true});
  const requests=new Map();
  await page.route(prefix+'**',async(route)=>{
    const url=route.request().url(),file=path.join(cache,createHash('sha256').update(url).digest('hex')+'.js');
    if(!requests.has(url))requests.set(url,(async()=>{
      if(fs.existsSync(file))return fs.readFileSync(file);
      const response=await fetch(url,{signal:AbortSignal.timeout(60000)});
      if(!response.ok)throw new Error(`CDN ${response.status}: ${url}`);
      const bytes=Buffer.from(await response.arrayBuffer()),tmp=file+'.'+process.pid;
      fs.writeFileSync(tmp,bytes);fs.renameSync(tmp,file);return bytes;
    })());
    try {
      const body=await requests.get(url);
      log.push(`[capture-cdn] ${createHash('sha256').update(body).digest('hex')} ${url}`);
      await route.fulfill({status:200,contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},body});
    } catch(error){log.push(`[capture-cdn error] ${error.message}`);await route.abort();}
  });
}
page.on('console', (m) => {
  log.push(`[${m.type()}] ${m.text()}`);
  if (process.env.CAPTURE_PROGRESS && (m.type() === 'error' || m.text().startsWith('[ride-check]'))) console.log(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => {
  log.push(`[pageerror] ${e.message}`);
  if (process.env.CAPTURE_PROGRESS) console.log(`[pageerror] ${e.message}`);
});
const served = new Map(), receipts = [];
page.on('response', (r) => {
  if (r.status() >= 400) log.push(`[http ${r.status()} error] ${r.url()}`);
  // Hash the actual served document and integration/capture code, not a possibly different local checkout.
  if (METRICS_MS && r.ok() && /\/(explore\.html|(?:main|measurements|capture-clock|sky-clouds|clouds)(?:\.[a-f0-9]+)?\.js)(?:[?#]|$)/.test(r.url())) {
    receipts.push(r.body().then((body) => served.set(r.url(), { sha256: createHash('sha256').update(body).digest('hex'), bytes: body.length }))
      .catch((e) => served.set(r.url(), { error: e.message })));
  }
});

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
const captureUrl = new URL(`${BASE}/${process.env.CAPTURE_PAGE || 'explore.html'}${process.env.CAPTURE_QUERY || ''}`);
if (METRICS_MS) captureUrl.searchParams.set('metrics', '1');
await page.goto(captureUrl.href, { waitUntil: 'load', timeout: Number(process.env.CAPTURE_LOAD_TIMEOUT_MS || process.env.CAPTURE_NAVIGATION_TIMEOUT_MS || 30000) });
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
const startupReadyMs = Date.now() - t0;
log.push(`[capture] ready after ${startupReadyMs} ms`);
if (PROFILE && PROFILE !== 'shots') await stopProfile();
if (PROFILE === 'shots') await startProfile();
if (HEAP === 'alloc') {
  await hcdp.send('HeapProfiler.enable');
  await hcdp.send('HeapProfiler.startSampling', { samplingInterval: 8192, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
}

try {
  const reports = [];
  for (const s of shots) {
    if (s.viewport) await page.setViewportSize(s.viewport === 'default' ? { width: VW, height: VH } : s.viewport);
    if (s.reload) {
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => window.__CITY_APP?.ready, null, { timeout: 240000 });
    }
    const shotResult = await page.evaluate((s) => {
      const app = window.__CITY_APP;
      if (s.mode) app.selectMode(s.mode);
      if (s.x !== undefined) app.teleportTo(s.x, s.z, s.heading ?? Math.PI);
      if (s.time) app.selectTime(s.time);
      if (s.camera) app.selectCamera(s.camera, true);
      if (s.js) return (0, eval)(s.js);
    }, s);
    if (s.record) fs.writeFileSync(path.join(OUT, `${TAG}${s.name}.json`), JSON.stringify(shotResult, null, 2) + '\n');
    if (s.tap) await page.tap(s.tap);
    if (s.tapMobile && MOBILE) await page.tap(s.tapMobile);
    if (s.press) {
      const box = await page.locator(s.press).boundingBox(); if (!box) throw new Error('Press target is not visible');
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      if (MOBILE) {
        const input = await page.context().newCDPSession(page);
        try { await input.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await page.waitForTimeout(250); }
        finally { await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await input.detach(); }
      } else { await page.mouse.move(x, y); await page.mouse.down(); try { await page.waitForTimeout(250); } finally { await page.mouse.up(); } }
    }
    if (s.download) {
      const [download] = await Promise.all([page.waitForEvent('download'), page.locator(s.download).click()]);
      await download.saveAs(path.join(OUT, `${TAG}${s.name}.jpg`));
    }
    if (s.hold) await page.keyboard.down(s.hold);
    await page.waitForTimeout(s.wait ?? 4000);
    if (METRICS_MS) {
      await Promise.all(receipts);
      await page.evaluate(({ label, warmupMs }) => {
        const app = window.__CITY_APP;
        if (!app.measurements) throw new Error('frame instrumentation unavailable');
        app.gpuTimes?.(); // Reset optional legacy averages; these are not frame-latency percentiles.
        app.measurements.start({ label, warmupMs });
      }, { label: `${TAG}${s.name}`, warmupMs: METRICS_WARMUP });
      await page.waitForTimeout(METRICS_WARMUP + METRICS_MS);
      // Stop before screenshot/readback, and before any resource inspection that walks data.
      const report = await page.evaluate(() => {
        const app = window.__CITY_APP;
        return { frames: app.frameTimes({ raw: true, stop: true }), resources: app.resourceSnapshot(),
          gpuPassAverages: app.gpuTimes?.() || null,
          importMap: JSON.parse(document.querySelector('script[type="importmap"]').textContent) };
      });
      Object.assign(report, { schemaVersion: 1, shot: s.name, capturedAt: new Date().toISOString(), measurementClass, contention,
        browserVersion: browser.version(), machine: { platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0]?.model },
        sourceRevision: process.env.CAPTURE_SOURCE_REVISION || null, startupReadyMs, servedDecodedContent: Object.fromEntries(served),
        query: captureUrl.search, seed, uncapped: !!process.env.CAPTURE_UNCAPPED, cpuThrottle: Number(process.env.CAPTURE_CPU_THROTTLE || 1),
        note: 'seed controls initial Math.random only; wall-timed simulation is not a deterministic replay; frame intervals include pacing' });
      fs.writeFileSync(path.join(OUT, `${TAG}${s.name}.metrics.json`), JSON.stringify(report, null, 2) + '\n');
      reports.push(report);
      fs.writeFileSync(path.join(OUT, `${TAG}metrics.json`), JSON.stringify(reports, null, 2) + '\n');
      if (!report.frames.valid) throw new Error('measurement has no valid complete sample window (or exceeded bounded capacity); raw report retained');
      log.push(`[metrics] ${TAG}${s.name} n=${report.frames.retainedSamples} median=${report.frames.frameIntervalMs.median}ms p95=${report.frames.frameIntervalMs.p95}ms ${measurementClass}`);
    }
    if (s.hold) await page.keyboard.up(s.hold);
    const fps = await page.evaluate(() => window.__CITY_APP.getFps());
    await page.screenshot({ path: path.join(OUT, `${TAG}${s.name}.png`) });
    log.push(`[capture] ${TAG}${s.name} fps ${Math.round(fps)}`);
  }
} catch (error) {
  log.push(`[capture] failed: ${error.message}`);
  flush();
  await page.screenshot({ path: path.join(OUT, `${TAG}failed.png`) });
  console.log(log.filter((l) => l.includes('error') || l.includes('[ride-check]')).slice(-20).join('\n'));
  await browser.close();
  server.close();
  throw error;
}
if (PROFILE === 'shots') await stopProfile();
if (HEAP) await stopHeap();
flush();
console.log(log.filter((l) => l.startsWith('[capture]') || l.startsWith('[metrics]') || l.includes('error')).join('\n'));
await browser.close();
server.close();
