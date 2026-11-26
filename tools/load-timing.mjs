// tools/load-timing.mjs: startup (ready) time of built sites, interleaved A/B, over an HTTP/2 + TLS + brotli server
// (Cloudflare serves the site over h2/h3 with brotli at about quality 4: an HTTP/1.1 uncompressed server would invent
// a six-connection queue and four times the bytes). Run on the Mac mini through gpu2, never on the laptop.
// usage: node tools/load-timing.mjs <plan.json>
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

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.wasm': 'application/wasm',
  '.ktx2': 'application/octet-stream', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };
const COMPRESS = /^(text\/|application\/(json|javascript|manifest\+json)|image\/svg)/;
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
    if (COMPRESS.test(type) && /\bbr\b/.test(req.headers['accept-encoding'] || '')) { body = brotli(key, body); headers['content-encoding'] = 'br'; }
    served.push(url.pathname);
    res.writeHead(200, headers); res.end(body);
  }).listen(PORT, '127.0.0.1');

const settings = plan.settings, rounds = plan.rounds || 3, order = (plan.order || 'ABAB').split('');
const results = [];
const save = () => fs.writeFileSync(path.join(OUT, `${plan.tag || 'load'}-results.json`), JSON.stringify(results, null, 2) + '\n');
for (const s of settings) {
  for (let r = 0; r < rounds; r++) {
    for (const arm of order) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await run(arm, s, r).catch((e) => ({ arm, setting: s.name, round: r, error: e.message.split('\n')[0] }));
        results.push(result); save();
        console.log(`[load] ${s.name} r${r} ${arm} ${result.error ? 'ERROR ' + result.error : `ready ${result.readyMs} ms (scripts done ${result.lastScriptEnd} ms, ${result.requests} req, ${(result.transfer / 1e6).toFixed(2)} MB)`}`);
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
  const browser = await chromium.launch({
    channel: 'chromium', headless: true,
    args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--ignore-certificate-errors',
      `--host-resolver-rules=MAP * 127.0.0.1:${PORT}, EXCLUDE 127.0.0.1`]
  });
  try {
    const [w, h] = (s.viewport || '1600x900').split('x').map(Number);
    const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: s.dpr || 1, isMobile: !!s.mobile, hasTouch: !!s.mobile, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.addInitScript(() => performance.setResourceTimingBufferSize(5000));
    const log = [];
    page.on('console', (m) => log.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
    const cdp = await context.newCDPSession(page);
    if (s.cpuThrottle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: s.cpuThrottle });
    if (s.net) {
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: s.net.latency, downloadThroughput: s.net.down / 8, uploadThroughput: s.net.up / 8 });
    }
    await page.goto(`https://127.0.0.1:${PORT}/explore.html${s.query || ''}`, { waitUntil: 'commit', timeout: 180000 });
    const handle = await page.waitForFunction(() => window.__CITY_APP?.ready && performance.now(), null, { timeout: 300000, polling: 50 });
    const readyMs = Math.round(await handle.jsonValue());
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
        initMarks: window.__CITY_APP?.initTimes || null,
        all: res.map((e) => [e.name.replace(location.origin, ''), Math.round(e.startTime), Math.round(e.responseEnd), e.transferSize, e.initiatorType])
      };
    });
    const errors = log.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
    fs.writeFileSync(path.join(OUT, `${plan.tag || 'load'}-${s.name}-r${round}-${arm}.console.log`), log.join('\n') + '\n');
    return { arm, setting: s.name, round, readyMs, ...timing, errors: errors.length, errorSample: errors.slice(0, 5) };
  } finally {
    await browser.close();
  }
}
