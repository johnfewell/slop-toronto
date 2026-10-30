// tools/mp-perf.mjs: what multiplayer costs a frame (docs/multiplayer-spec.md "Performance budget and measurement"), on
// the Mac mini via gpu2. Starts bots in the staging rooms (tools/mp-bots.mjs, with the given bot arguments), opens the
// city on the uncapped frame clock, waits for the bots, then measures in one page, ABBAABBA, BLOCK seconds each with the
// first second dropped: A = multiplayer on, B = paused (multiplayer.setPaused: nothing drawn or sent). Reports per side:
// frame-time p50/p95/p99, multiplayer's main-thread time per frame (stats()), its message handlers, long tasks over
// 50 ms, and GPU time per frame (?gputime=1, summed over passes).
// usage: GPU2_OUT=out node tools/mp-perf.mjs <label> [--query '&quality=low'] [--block 5] -- [bot arguments...]
//   e.g. gpu2 slop-multiplayer -- env GPU2_OUT=gpu2-out node tools/mp-perf.mjs spread -- --n 48 --radius 2000
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const split = argv.indexOf('--');
const own = split >= 0 ? argv.slice(0, split) : argv, botArgs = split >= 0 ? argv.slice(split + 1) : ['--n', '48'];
const label = own[0] || 'run';
const opt = (name, dflt) => { const i = own.indexOf(`--${name}`); return i >= 0 ? own[i + 1] : dflt; };
const QUERY = opt('query', ''), BLOCK = Number(opt('block', 5)) * 1000;
// a private room of its own, so other people (and other bots) in public-1 don't change the measurement
const ROOM = opt('room', 'pf' + Array.from(label.padEnd(4, 'x').slice(0, 4).toLowerCase(), (c) => /[a-z]/.test(c) ? c : 'x').join(''));
const OUT = process.env.GPU2_OUT || 'mp-perf-out';
fs.mkdirSync(OUT, { recursive: true });

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(8769, '127.0.0.1');

const bots = spawn(process.execPath, [path.join(ROOT, 'tools/mp-bots.mjs'), '--secs', '900', '--room', ROOM, ...botArgs], { stdio: ['ignore', 'pipe', 'inherit'] });
let botLog = '';
bots.stdout.on('data', (d) => { botLog += d; });
const wanted = Number(botArgs[botArgs.indexOf('--n') + 1]) || 48;

const browser = await chromium.launch({
  channel: 'chromium',
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit']
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(`http://127.0.0.1:8769/explore.html?gputime=1${QUERY}#room=${ROOM}`, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__CITY_APP?.ready && window.__CITY_APP.multiplayer?.me, null, { timeout: 240000 });
  // the bots in (or as many as came within 60 s), and the shaders settled
  await page.waitForFunction((n) => window.__CITY_APP.multiplayer.riding >= Math.min(n, 1) + Math.floor(n * 0.6), wanted, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const result = await page.evaluate(async (BLOCK) => {
    const app = window.__CITY_APP, mp = app.multiplayer;
    const long = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push({ t: e.startTime, ms: e.duration }); }).observe({ type: 'longtask', buffered: false });
    const sides = { on: { frames: [], mpFrame: [], handlers: 0, long: 0, gpu: [], riding: [] }, off: { frames: [], mpFrame: [], handlers: 0, long: 0, gpu: [], riding: [] } };
    const block = (side) => new Promise((resolve) => {
      mp.setPaused(side === 'off');
      const t0 = performance.now();
      let last = t0;
      const deltas = [];
      app.gpuTimes();
      mp.stats();
      const step = (now) => {
        if (now - t0 > 1000) deltas.push(now - last); // (the block's first second dropped)
        last = now;
        if (now - t0 < BLOCK) return requestAnimationFrame(step);
        const g = app.gpuTimes(), s = mp.stats();
        const S = sides[side];
        S.frames.push(...deltas);
        if (side === 'on') S.mpFrame.push(s.mean);
        S.handlers += s.handlersMs;
        S.long += long.filter((e) => e.t > t0 + 1000 && e.t < now && e.ms > 50).length;
        if (g) S.gpu.push(Object.values(g.passes).reduce((a, b) => a + b, 0));
        S.riding.push(mp.riding);
        resolve();
      };
      requestAnimationFrame(step);
    });
    for (const side of ['on', 'off', 'off', 'on', 'on', 'off', 'off', 'on']) await block(side);
    mp.setPaused(false);
    const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return +(s[Math.min(s.length - 1, Math.floor(s.length * p))] || 0).toFixed(2); };
    const mean = (a) => +(a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)).toFixed(3);
    const out = {};
    for (const [k, S] of Object.entries(sides)) {
      out[k] = { frames: S.frames.length, p50: q(S.frames, 0.5), p95: q(S.frames, 0.95), p99: q(S.frames, 0.99), gpuMs: mean(S.gpu), longTasks: S.long,
        handlersMsPerSec: +(S.handlers / (4 * BLOCK / 1000)).toFixed(2), riding: Math.max(...S.riding) };
    }
    out.on.mpMsPerFrame = mean(sides.on.mpFrame);
    out.tier = app.quality.tier;
    return out;
  }, BLOCK);
  result.label = label;
  result.room = ROOM;
  result.query = QUERY;
  result.bots = botArgs.join(' ');
  result.pass = result.on.p95 - result.off.p95 <= 1 && result.on.p99 - result.off.p99 <= 1 && result.on.longTasks === 0;
  result.errors = errors;
  await page.screenshot({ path: path.join(OUT, `mp-perf-${label}.png`) });
  fs.writeFileSync(path.join(OUT, `mp-perf-${label}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  bots.kill();
  server.close();
  const refused = botLog.split('\n').filter((l) => /closed|full|limited/.test(l)).slice(0, 5);
  if (refused.length) console.log('bots:', refused.join(' | '));
}
