// tools/render-film.mjs — renders the launch film (js/film.js) offline, frame by frame on a virtual clock, to an MP4
// (run on the Mac mini via gpu2, never on the laptop; ffmpeg on the PATH)
// usage: GPU2_OUT=out node tools/render-film.mjs                  the film: $GPU2_OUT/film/slop-toronto-film.mp4
//        FILM_STILLS=1 node tools/render-film.mjs                 stills only: each shot's start, middle and end
//        FILM_STILLS="0:0,2:4.5" node tools/render-film.mjs       stills at shot:seconds
// FILM_SHOTS=<file.json> replaces the film's shots (trying out moves); FILM_SIZE=1280x720, FILM_FPS=60, FILM_CRF=18;
// FILM_QUERY is added to the page's query (default &cloudSpeed=1: the sky keeps the opener's clouds to the end).
// The page's requestAnimationFrame, performance.now and Date.now run on real time while the city loads, then on a
// manual clock: every frame advances it exactly 1 / fps, runs the queued frame callbacks (the app's loop, three's node
// time), waits for the GPU and screenshots, so the traffic, people, water, clouds and screens move at true speed
// however long a frame takes. Before each shot (a cut) the camera holds its first pose for FILM_WARMUP frames, not
// kept, so the clouds' accumulation, the traffic and the level-of-detail fades settle after the jump.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.CAPTURE_PORT || 8769);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1');

const OUT = path.join(process.env.GPU2_OUT || 'capture-out', 'film');
const [W, H] = (process.env.FILM_SIZE || '1920x1080').split('x').map(Number);
const FPS = Number(process.env.FILM_FPS || 60);
const WARMUP = Number(process.env.FILM_WARMUP || 90);
const STILLS = process.env.FILM_STILLS;
const shotsOverride = process.env.FILM_SHOTS ? JSON.parse(fs.readFileSync(process.env.FILM_SHOTS, 'utf8')) : null;
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: 'chromium',
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const log = [];
page.on('console', (m) => log.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}`));
const flush = () => fs.writeFileSync(path.join(OUT, 'console.log'), log.join('\n') + '\n');

// The virtual clock, installed before any page script runs
await page.addInitScript(() => {
  const realRAF = window.requestAnimationFrame.bind(window);
  const realNow = performance.now.bind(performance);
  const realDateNow = Date.now;
  const cancelled = new Set();
  let nextId = 1;
  const clock = {
    manual: false,
    t: 0,
    dateOffset: 0,
    queue: [],
    start() {
      this.t = realNow();
      this.dateOffset = realDateNow() - this.t;
      this.manual = true;
    },
    step(ms) {
      this.t += ms;
      const q = this.queue;
      this.queue = [];
      for (const { id, cb } of q) if (!cancelled.delete(id)) cb(this.t);
    }
  };
  window.__filmClock = clock;
  window.requestAnimationFrame = (cb) => {
    const id = nextId++;
    if (clock.manual) clock.queue.push({ id, cb });
    else realRAF((ts) => {
      if (cancelled.delete(id)) return;
      if (clock.manual) clock.queue.push({ id, cb }); // asked for before the switch, due after it
      else cb(ts);
    });
    return id;
  };
  window.cancelAnimationFrame = (id) => cancelled.add(id);
  performance.now = () => (clock.manual ? clock.t : realNow());
  Date.now = () => (clock.manual ? Math.round(clock.dateOffset + clock.t) : realDateNow());
});

const t0 = Date.now();
await page.goto(`http://127.0.0.1:${PORT}/explore.html?film=render${process.env.FILM_QUERY ?? '&cloudSpeed=1'}`, { waitUntil: 'load' });
try {
  await page.waitForFunction(() => window.__CITY_APP?.ready && document.body.classList.contains('film'), null, { timeout: 240000 });
} catch (e) {
  log.push(`[film] not ready: ${e.message.split('\n')[0]}`);
  await page.screenshot({ path: path.join(OUT, 'not-ready.png') });
  flush();
  console.log(log.slice(-30).join('\n'));
  process.exit(1);
}
log.push(`[film] ready after ${Date.now() - t0} ms`);
// the street-level start view's trees & traffic, then the clock goes manual
await page.waitForTimeout(3000);
const shots = await page.evaluate((override) => {
  if (override) window.CITY.Film.SHOTS.splice(0, Infinity, ...override);
  window.__filmClock.start();
  return window.CITY.Film.SHOTS.map((s) => ({ name: s.name, duration: s.duration }));
}, shotsOverride);

const cdp = await page.context().newCDPSession(page);
// One frame: put the camera at (shot, t), advance the clock one frame, render, wait for the GPU, capture
async function frame(i, t, capture = true) {
  await page.evaluate(async ([i, t, ms]) => {
    window.CITY.Film.show(i, t);
    window.__filmClock.step(ms);
    const device = window.__CITY_APP.renderer.backend.device;
    if (device) await device.queue.onSubmittedWorkDone();
  }, [i, t, 1000 / FPS]);
  if (!capture) return null;
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
  return Buffer.from(data, 'base64');
}

if (STILLS) {
  const list = STILLS === '1'
    ? shots.flatMap((s, i) => [0, s.duration / 2, s.duration - 1 / FPS].map((t) => [i, t]))
    : STILLS.split(',').map((p) => p.split(':').map(Number));
  for (const [i, t] of list) {
    for (let k = 0; k < WARMUP; k++) await frame(i, t, false);
    const name = `still-${i}-${shots[i].name}-${t.toFixed(1)}s.png`;
    fs.writeFileSync(path.join(OUT, name), await frame(i, t));
    log.push(`[film] ${name}`);
  }
} else {
  // the frames go straight into ffmpeg: no frame folder
  const file = path.join(OUT, process.env.FILM_NAME || 'slop-toronto-film.mp4');
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', process.env.FILM_CRF || '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-x264-params', 'aq-mode=3',
    '-movflags', '+faststart', '-an', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((resolve) => ff.on('close', resolve));
  const write = (buf) => (ff.stdin.write(buf) ? null : new Promise((r) => ff.stdin.once('drain', r)));
  const r0 = Date.now();
  let n = 0;
  for (let i = 0; i < shots.length; i++) {
    for (let k = 0; k < WARMUP; k++) await frame(i, 0, false);
    const frames = Math.round(shots[i].duration * FPS);
    for (let f = 0; f < frames; f++) {
      const buf = await frame(i, f / FPS);
      await write(buf);
      n++;
      // a few stills from the very frames of the film
      if (f === Math.round(frames * 0.35)) fs.writeFileSync(path.join(OUT, `frame-${i}-${shots[i].name}.png`), buf);
    }
    log.push(`[film] shot ${i} ${shots[i].name}: ${frames} frames, ${Math.round((Date.now() - r0) / 1000)} s so far`);
    flush();
  }
  ff.stdin.end();
  log.push(`[film] ffmpeg exit ${await done}: ${n} frames -> ${file}`);
}
flush();
console.log(log.filter((l) => l.startsWith('[film]') || l.includes('error')).join('\n'));
await browser.close();
server.close();
