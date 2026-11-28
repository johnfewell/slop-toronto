// tools/load-timing.mjs: startup (ready) time of built sites, interleaved A/B, over an HTTP/2 + TLS + brotli server
// (Cloudflare serves the site over h2/h3 with brotli at about quality 4: an HTTP/1.1 uncompressed server would invent
// a six-connection queue and four times the bytes). Run on the Mac mini through gpu2, never on the laptop.
// usage: [LOAD_ONLY=<setting name prefix>] [LOAD_ROUNDS=<n>] [LOAD_TAG=<results name>] node tools/load-timing.mjs <plan.json>
// Real-site behaviour (plan.realHeaders: true): the arm's dist/_headers decide Cache-Control, every response carries an ETag and
// answers If-None-Match with 304, and only the types Cloudflare compresses (text, js, css, json, svg, wasm: NOT .glb, .bin, .png)
// are brotli'd, as on sloptoronto.ca. A setting with `warm: true` loads the page once to fill a persistent browser profile's HTTP
// cache, closes the browser, and measures a second load from that profile (a returning visitor). Marks: the page's [init] phases
// are also performance marks (init:firstFrame, init:gpu), so the result has the first-frame time as well as the ready time.
// plan: { arms: { A: "dist-a", B: "dist-b" }, rounds: 3, order: "ABAB",
//         settings: [{ name, query, viewport: "1600x900", dpr, mobile, cpuThrottle, net: { latency, down, up } | null }] }
// (net: CDP Network.emulateNetworkConditions: latency in ms per request, down/up in bits per second)
// Every host the page names (cdn.jsdelivr.net's three.js, fonts, analytics, the rooms socket) resolves to this server:
// three.js comes from tools/capture.mjs's CDN cache (~/.cache/slop-toronto/capture-cdn, filled from jsDelivr on a
// miss), everything else not in the arm's folder is a 404, the same in both arms. A fresh browser per run (cold
// HTTP cache). Ready time: performance.now() in the page when window.__CITY_APP.ready first reads true.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http2 from 'node:http2';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const PORT = Number(process.env.CAPTURE_PORT || 8831);
const OUT = process.env.GPU2_OUT || 'load-timing-out';
fs.mkdirSync(OUT, { recursive: true });
const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-timing-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-days', '2',
  '-keyout', path.join(certDir, 'key.pem'), '-out', path.join(certDir, 'cert.pem')], { stdio: 'ignore' });

// The browser trusts this certificate by its key's hash (--ignore-certificate-errors-spki-list), not by ignoring errors:
// Chrome does not store responses whose certificate has an error in its HTTP cache, so a warm run needs a certificate it accepts
const spki = execFileSync('sh', ['-c', `openssl x509 -in ${path.join(certDir, 'cert.pem')} -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl enc -base64`]).toString().trim();

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.wasm': 'application/wasm',
  '.ktx2': 'application/octet-stream', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };
const COMPRESS = /^(text\/|application\/(json|javascript|manifest\+json|wasm)|image\/svg)/;
const etagCache = new Map();
const etagOf = (key, body) => { if (!etagCache.has(key)) etagCache.set(key, '"' + createHash('md5').update(body).digest('hex') + '"'); return etagCache.get(key); };
// dist/_headers: "/path-glob\n  Header: value" blocks; every matching block applies, later ones win
const headerRules = new Map();
function rulesFor(rootDir) {
  if (!headerRules.has(rootDir)) {
    const f = path.join(rootDir, '_headers');
    const rules = [];
    if (fs.existsSync(f)) {
      let cur = null;
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        if (/^\s*$/.test(line) || line.startsWith('/*\n')) continue;
        if (/^\S/.test(line) && line.startsWith('/') ) { cur = { re: new RegExp('^' + line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'), h: {} }; rules.push(cur); }
        else if (cur && /^\s+\S+:/.test(line)) { const i = line.indexOf(':'); cur.h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); }
      }
    }
    headerRules.set(rootDir, rules);
  }
  return headerRules.get(rootDir);
}
const brCache = new Map();
const brotli = (key, body) => {
  if (!brCache.has(key)) brCache.set(key, zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } }));
  return brCache.get(key);
};
const cdnCache = path.join(os.homedir(), '.cache/slop-toronto/capture-cdn');
fs.mkdirSync(cdnCache, { recursive: true });
async function cdn(url) {
  const file = path.join(cdnCache, createHash('sha256').update(url).digest('hex') + '.js');
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(file + '.' + process.pid, bytes); fs.renameSync(file + '.' + process.pid, file);
  return bytes;
}
let root = null;
const served = [];
const server = http2.createSecureServer({ key: fs.readFileSync(path.join(certDir, 'key.pem')), cert: fs.readFileSync(path.join(certDir, 'cert.pem')), allowHTTP1: true },
  async (req, res) => {
    const host = (req.headers[':authority'] || req.headers.host || '').replace(/:\d+$/, '');
    const url = new URL(req.url, 'https://x');
    let body = null, type = 'application/octet-stream', key = null, cors = false;
    if (host === 'cdn.jsdelivr.net' && /^\/gh\/mrdoob\/three\.js@[a-f0-9]{40}\//.test(url.pathname)) {
      body = await cdn(`https://cdn.jsdelivr.net${url.pathname}`); type = 'text/javascript'; key = `cdn:${url.pathname}`; cors = true;
    } else if (host === '127.0.0.1' || host === 'localhost') {
      let file = path.join(root, decodeURIComponent(url.pathname));
      if (file.endsWith(path.sep)) file += 'index.html';
      if (file.startsWith(root) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        body = fs.readFileSync(file); type = TYPES[path.extname(file)] || 'application/octet-stream'; key = `${root}:${file}`;
      }
    }
    if (!body) { res.writeHead(404, { 'access-control-allow-origin': '*' }); res.end(); return; }
    const headers = { 'content-type': type, 'cache-control': 'no-store', ...(cors ? { 'access-control-allow-origin': '*' } : {}) };
    if (plan.realHeaders && host !== 'cdn.jsdelivr.net') {
      delete headers['cache-control'];
      let pathname = url.pathname; if (pathname.endsWith('/')) pathname += 'index.html';
      for (const r of rulesFor(root)) if (r.re.test(pathname)) Object.assign(headers, r.h);
      headers['cache-control'] ||= 'no-cache';
      headers.etag = etagOf(key, body);
      if (req.headers['if-none-match'] === headers.etag) { served.push(url.pathname + ' (304)'); res.writeHead(304, { etag: headers.etag, 'cache-control': headers['cache-control'] }); res.end(); return; }
    }
    if (COMPRESS.test(type) && /\bbr\b/.test(req.headers['accept-encoding'] || '')) { body = brotli(key, body); headers['content-encoding'] = 'br'; }
    served.push(url.pathname);
    res.writeHead(200, headers); res.end(body);
  }).listen(PORT, '127.0.0.1');

if (process.env.LOAD_TAG) plan.tag = process.env.LOAD_TAG; // (one job per round: the mini's lock lets others in between, and each job's results file keeps its own name)
if (process.env.LOAD_ROUNDS) plan.rounds = Number(process.env.LOAD_ROUNDS);
const only = process.env.LOAD_ONLY; // (a setting's exact name, else every setting whose name starts with it)
const settings = plan.settings.filter((x) => !only || (plan.settings.some((y) => y.name === only) ? x.name === only : x.name.startsWith(only))), rounds = plan.rounds || 3, order = (plan.order || 'ABAB').split('');
const results = [];
const save = () => fs.writeFileSync(path.join(OUT, `${plan.tag || 'load'}-results.json`), JSON.stringify(results, null, 2) + '\n');
for (const s of settings) {
  for (let r = 0; r < rounds; r++) {
    for (const arm of order) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await run(arm, s, r).catch((e) => ({ arm, setting: s.name, round: r, error: e.message.split('\n')[0] }));
        results.push(result); save();
        console.log(`[load] ${s.name} r${r} ${arm} ${result.error ? 'ERROR ' + result.error : `first frame ${result.marks?.['init:firstFrame'] ?? '?'} ready ${result.readyMs} ms (scripts done ${result.lastScriptEnd} ms, ${result.requests} req, ${(result.transfer / 1e6).toFixed(2)} MB)`}`);
        if (!result.error) break;
      }
    }
  }
}
server.close();
fs.rmSync(certDir, { recursive: true, force: true });

async function run(arm, s, round) {
  root = path.resolve(plan.arms[arm]) + path.sep;
  served.length = 0;
  const live = plan.liveOrigin; // (a run against the real site, over the mini's own network: no local server, no mapped hosts)
  const launchArgs = live ? ['--enable-unsafe-webgpu', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--enable-unsafe-webgpu', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', `--ignore-certificate-errors-spki-list=${spki}`,
    `--host-resolver-rules=MAP * 127.0.0.1:${PORT}, EXCLUDE 127.0.0.1`];
  // plan.args / setting.args: more browser flags (the capture tool's uncapped frames: --disable-gpu-vsync, --disable-frame-rate-limit)
  launchArgs.push(...(plan.args || []), ...(s.args || []));
  const [w, h] = (s.viewport || '1600x900').split('x').map(Number);
  const ctxOpts = { viewport: { width: w, height: h }, deviceScaleFactor: s.dpr || 1, isMobile: !!s.mobile, hasTouch: !!s.mobile };
  let profile = null;
  if (s.warm) {
    // a returning visitor: one full load (not timed, no network limit) fills the profile's HTTP cache
    profile = fs.mkdtempSync(path.join(os.tmpdir(), 'load-profile-'));
    const prime = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: launchArgs, ...ctxOpts });
    try {
      const pp = prime.pages()[0] || await prime.newPage();
      await pp.goto(`${live ? `${live}/explore` : `https://127.0.0.1:${PORT}/explore.html`}${s.query || ''}`, { waitUntil: 'commit', timeout: 180000 });
      await pp.waitForFunction(() => window.__CITY_APP?.ready, null, { timeout: 300000, polling: 100 });
      await pp.waitForTimeout(3000);
    } finally { await prime.close(); }
    served.length = 0;
  }
  const launched = s.warm
    ? await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: launchArgs, ...ctxOpts })
    : null;
  const browser = launched ? { close: () => launched.close() } : await chromium.launch({ channel: 'chromium', headless: true, args: launchArgs });
  try {
    const context = launched || await browser.newContext(ctxOpts);
    const page = launched ? (launched.pages()[0] || await launched.newPage()) : await context.newPage();
    await page.addInitScript(() => performance.setResourceTimingBufferSize(5000));
    // setting.tailSec: the frames after ready too (every requestAnimationFrame interval, from the page's first frame to tailSec s after ready; the
    // result's `frames`: [[page ms, interval ms], ...] in the frame-time chart's own series format), and a profile of that stretch (.tail.cpuprofile)
    if (s.tailSec) await page.addInitScript(() => {
      // (long animation frames, where the browser has them: what script ran in each frame over 50 ms: window.__loaf, in the result's `loaf`)
      window.__loaf = [];
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) window.__loaf.push({ at: Math.round(e.startTime), ms: Math.round(e.duration), block: Math.round(e.blockingDuration || 0), scripts: e.scripts.map((x) => `${Math.round(x.duration)} ms ${x.invoker || ''} ${x.sourceFunctionName || ''} ${(x.sourceURL || '').replace(/^https?:\/\/[^/]+/, '').replace(/\.[a-f0-9]{8,}\.js$/, '.js')}:${x.sourceCharPosition}`) });
        }).observe({ type: 'long-animation-frame', buffered: true });
      } catch {}
      window.__frames = []; let last = performance.now();
      const tick = (t) => { window.__frames.push([Math.round(t * 10) / 10, Math.round((t - last) * 10) / 10]); last = t; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const log = [];
    page.on('console', (m) => log.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
    const cdp = await context.newCDPSession(page);
    if (s.cpuThrottle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: s.cpuThrottle });
    if (s.net) {
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: s.net.latency, downloadThroughput: s.net.down / 8, uploadThroughput: s.net.up / 8 });
    }
    // setting.profile: true: the V8 sampling profiler (CDP Profiler, 0.5 ms) from the navigation to ready, written beside the results as
    // <tag>-<setting>-r<round>-<arm>.cpuprofile; tools/cpuprofile-summary.mjs reads it (self time by function, by script, and by init phase)
    // setting.heap: true: V8's sampling heap profiler (every 64 KB allocated, only what is still alive when it is read) from the navigation to a few
    // seconds after ready: <tag>-<setting>-r<round>-<arm>.heapprofile (self size by allocation site: tools/cpuprofile-summary.mjs --heap <file>)
    if (s.heap) { await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.startSampling', { samplingInterval: 65536 }); }
    if (s.profile) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); }
    await page.goto(`${live ? `${live}/explore` : `https://127.0.0.1:${PORT}/explore.html`}${s.query || ''}`, { waitUntil: 'commit', timeout: 180000 });
    const handle = await page.waitForFunction(() => window.__CITY_APP?.ready && performance.now(), null, { timeout: 300000, polling: 50 });
    const readyMs = Math.round(await handle.jsonValue());
    if (s.profile) {
      const stopAt = await page.evaluate(() => performance.now()); // (the profile ends about now: this maps its clock to the page's marks)
      const { profile: prof } = await cdp.send('Profiler.stop');
      prof.pageNowAtStop = stopAt;
      fs.writeFileSync(path.join(OUT, `${plan.tag || 'load'}-${s.name}-r${round}-${arm}.cpuprofile`), JSON.stringify(prof));
      if (s.tailSec) await cdp.send('Profiler.start'); // (a second profile for what follows ready)
    }
    if (s.heap) {
      await page.waitForTimeout(3000);
      const { profile: hp } = await cdp.send('HeapProfiler.getSamplingProfile');
      fs.writeFileSync(path.join(OUT, `${plan.tag || 'load'}-${s.name}-r${round}-${arm}.heapprofile`), JSON.stringify(hp));
    }
    if (s.readyJs) await page.evaluate(s.readyJs); // (setting.readyJs: run once the page is ready, e.g. a teleport to the street the frame-time shots use)
    const timing = await page.evaluate(() => {
      const res = performance.getEntriesByType('resource');
      const nav = performance.getEntriesByType('navigation')[0];
      const scripts = res.filter((e) => /\/js\/.*\.js$/.test(new URL(e.name).pathname));
      const pick = (re) => res.filter((e) => re.test(e.name)).map((e) => ({ name: e.name.split('/').slice(-2).join('/'), start: Math.round(e.startTime), end: Math.round(e.responseEnd), bytes: e.transferSize }));
      return {
        secure: isSecureContext, protocol: nav?.nextHopProtocol, domContentLoaded: Math.round(nav?.domContentLoadedEventEnd || 0),
        requests: res.length + 1, transfer: res.reduce((a, e) => a + (e.transferSize || 0), nav?.transferSize || 0),
        lastScriptEnd: Math.round(Math.max(0, ...scripts.map((e) => e.responseEnd))), scriptCount: scripts.length,
        lastCdnEnd: Math.round(Math.max(0, ...res.filter((e) => e.name.includes('cdn.jsdelivr.net')).map((e) => e.responseEnd))),
        lastResourceEnd: Math.round(Math.max(0, ...res.filter((e) => e.startTime < performance.now()).map((e) => e.responseEnd))),
        watched: pick(/(clouds|main|geodata-loader|stylized-water)\.[a-f0-9]+\.js$|three\.(core|webgpu|tsl)\.js$|CSM\w*\.js$|toronto-geodata\.bin/),
        marks: Object.fromEntries(performance.getEntriesByType('mark').filter((m) => m.name.startsWith('init:')).map((m) => [m.name, Math.round(m.startTime)])),
        decoded: res.reduce((a, e) => a + (e.decodedBodySize || 0), 0),
        all: res.map((e) => [e.name.replace(location.origin, ''), Math.round(e.startTime), Math.round(e.responseEnd), e.transferSize, e.initiatorType, e.decodedBodySize, e.encodedBodySize])
      };
    });
    const probe = s.probe ? await page.evaluate(s.probe) : undefined; // (setting.probe: a page expression whose value goes in the result, to compare what two builds made)
    let frames = null, loaf = null;
    if (s.tailSec) {
      await page.waitForTimeout(s.tailSec * 1000);
      frames = await page.evaluate((r) => window.__frames.filter((f) => f[0] >= r - 500), readyMs);
      loaf = await page.evaluate((r) => window.__loaf.filter((f) => f.at >= r - 500), readyMs);
      if (s.profile) {
        const stopAt = await page.evaluate(() => performance.now());
        const { profile: prof } = await cdp.send('Profiler.stop');
        prof.pageNowAtStop = stopAt;
        fs.writeFileSync(path.join(OUT, `${plan.tag || 'load'}-${s.name}-r${round}-${arm}.tail.cpuprofile`), JSON.stringify(prof));
      }
    }
    // a picture a few seconds after ready (what the player first sees, and whether anything still being fetched has arrived)
    await page.waitForTimeout(plan.shotDelayMs ?? 4000);
    await page.screenshot({ path: path.join(OUT, `${plan.tag || 'load'}-${s.name}-r${round}-${arm}.png`) }).catch(() => {});
    // (a link too slow to finish what the page asks for after ready: a second picture a while later, setting.lateShotMs)
    if (s.lateShotMs) {
      await page.waitForTimeout(s.lateShotMs);
      await page.screenshot({ path: path.join(OUT, `${plan.tag || 'load'}-${s.name}-r${round}-${arm}-late.png`) }).catch(() => {});
    }
    const errors = log.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
    fs.writeFileSync(path.join(OUT, `${plan.tag || 'load'}-${s.name}-r${round}-${arm}.console.log`), log.join('\n') + '\n');
    return { arm, setting: s.name, round, readyMs, ...(frames ? { frames } : {}), ...(loaf ? { loaf } : {}), ...(probe !== undefined ? { probe } : {}), ...timing, errors: errors.length, errorSample: errors.slice(0, 5), served304: served.filter((x) => x.endsWith('(304)')).length };
  } finally {
    await browser.close();
    if (profile) fs.rmSync(profile, { recursive: true, force: true });
  }
}
