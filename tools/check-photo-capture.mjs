// Experimental M0a runner. Run through gpu2, never on the laptop GPU.
// Uses existing film stop/resume to hold physics; does not introduce visitor photo UI.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

if (process.env.GPU2 !== '1') throw new Error('photo capture experiments must run through gpu2');
const root = path.resolve(process.env.CAPTURE_ROOT || '.'), out = process.env.GPU2_OUT || 'gpu2-out';
const tier = process.env.PHOTO_TIER || 'high', width = tier === 'low' ? 412 : 1600, height = tier === 'low' ? 915 : 900;
const repeats = Number(process.env.PHOTO_REPEATS || 20);
const settleFrames = Number(process.env.PHOTO_SETTLE_FRAMES || 120);
if (![120, 512].includes(settleFrames)) throw new Error('invalid settling bound');
const tag = process.env.PHOTO_TAG ? process.env.PHOTO_TAG + '-' : '';
if (!/^[a-z0-9-]*$/.test(tag)) throw new Error('invalid PHOTO_TAG');
if (!['high', 'low'].includes(tier) || !Number.isInteger(repeats) || repeats < 1 || repeats > 20) throw new Error('invalid experiment tier/repeats');
fs.mkdirSync(out, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const compareImages = async ({ imageUrl, referenceUrl }) => {
  const decode = async (url) => {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    const c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height;
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bitmap, 0, 0);
    const out = { pixels: ctx.getImageData(0, 0, c.width, c.height).data, width: c.width, height: c.height };
    bitmap.close(); c.width = c.height = 0; return out;
  };
  const a = await decode(imageUrl), b = await decode(referenceUrl);
  if (a.width !== b.width || a.height !== b.height) throw new Error('image dimensions differ');
  const summarize = (firstRow, lastRow) => {
    const histogram = new Uint32Array(256); let sum = 0, nonBlack = 0, n = 0;
    for (let j = firstRow * a.width * 4; j < lastRow * a.width * 4; j += 4) {
      if (a.pixels[j] + a.pixels[j + 1] + a.pixels[j + 2] > 12) nonBlack++;
      for (let k = 0; k < 3; k++) { const d = Math.abs(a.pixels[j + k] - b.pixels[j + k]); histogram[d]++; sum += d; n++; }
    }
    let p95 = 0, seen = 0; for (; p95 < 255; p95++) { seen += histogram[p95]; if (seen >= n * 0.95) break; }
    return { meanAbsoluteRgbError: sum / n, p95AbsoluteRgbError: p95, nonBlackFraction: nonBlack / (n / 3) };
  };
  // Fixed screen regions selected before inspecting this run: sky top35%, water bottom30%.
  return { ...summarize(0, a.height), regions: { sky: summarize(0, Math.floor(a.height * 0.35)), water: summarize(Math.floor(a.height * 0.7), a.height) } };
};

const server = http.createServer((req, res) => {
  const filename = path.resolve(root, '.' + new URL(req.url, 'http://x').pathname);
  if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': mime[path.extname(filename)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(filename).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
const errors = [], diagnostics = [], served = {}, receipts = [], results = [];
try {
  browser = await chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: tier === 'low', hasTouch: tier === 'low' });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => {
    if (['warning', 'error'].includes(msg.type()) && diagnostics.length < 200) diagnostics.push({ type: msg.type(), text: msg.text() });
    if (/GPUValidationError|GPUInternalError|uncaptured.*error|Error while parsing WGSL|ShaderModule.*invalid|clouds.frame has not advanced/i.test(msg.text())) errors.push(msg.text());
  });
  page.on('response', (r) => {
    if (r.ok() && /\/(explore\.html|(?:main|measurements|capture-clock|sky-clouds|clouds)(?:\.[a-f0-9]+)?\.js)(?:[?#]|$)/.test(r.url())) receipts.push(
      r.body().then((b) => { served[r.url()] = { sha256: createHash('sha256').update(b).digest('hex'), bytes: b.length }; })
        .catch((e) => { served[r.url()] = { error: e.message }; }));
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/explore.html?quality=${tier}&autoscale=0&transit=timetable&film&cloudSpeed=0&metrics=1`, { timeout: 120000 });
  await page.waitForFunction(() => window.__CITY_APP?.ready, null, { timeout: 240000 });
  await page.addStyleTag({ content: 'body.film > :not(#canvas-container) { visibility: hidden !important; }' });
  await page.evaluate(() => {
    const app = window.__CITY_APP;
    document.body.classList.add('film');
    app.selectTime('golden'); app.selectCamera('skyline', true);
  });
  await page.waitForTimeout(5000);
  await Promise.all(receipts);
  const baseline = await page.evaluate(async () => {
    const app = window.__CITY_APP;
    app.measurements?.read({ stop: true });
    app.film.start(); // Halts frame() entirely. Do not call film.step(dt=0).
    await app.renderer.backend.device.queue.onSubmittedWorkDone();
    return { memory: { ...app.renderer.info.memory }, resources: app.resourceSnapshot(), frameNo: app.frameNo,
      revision: window.CITY.THREE.REVISION, importMap: JSON.parse(document.querySelector('script[type="importmap"]').textContent),
      camera: app.cameraSystem.activePresetId, outputColorTransform: app.renderPipeline.outputColorTransform };
  });

  // Reset temporal history, then compare held samples with a later lossless reference.
  // Only cloud presentation advances. Never send dt=0 into the world simulation.
  const settlingSamples = [], samplingFrames = [], checkpoints = new Set([1, 8, 24, 48, 90, 120, 128, 256, 280, 346, 384, 512].filter((n) => n <= settleFrames));
  let settlingRenderWaitMs = 0;
  for (let n = 1; n <= settleFrames; n++) {
    const start = performance.now();
    const state = await page.evaluate((first) => window.__CITY_APP.film.renderHeld({ resetHistory: first, sampleFrame: first ? 0 : null }), n === 1);
    settlingRenderWaitMs += performance.now() - start;
    samplingFrames.push({ cloud: state.cloudFrame, renderer: state.rendererFrame });
    if (state.cloudFrame !== n - 1 || (n > 1 && state.rendererFrame <= samplingFrames.at(-2).renderer)) throw new Error('sampling did not advance on an independent renderer frame');
    if (checkpoints.has(n)) {
      const png = await page.screenshot({ type: 'png' });
      fs.writeFileSync(path.join(out, `${tag}${tier}-settling-${n}.png`), png);
      settlingSamples.push({ frames: n, state, renderWaitWallMs: settlingRenderWaitMs, imageUrl: 'data:image/png;base64,' + png.toString('base64') });
    }
  }
  const settling = [];
  for (const sample of settlingSamples) {
    const comparison = await page.evaluate(compareImages, { imageUrl: sample.imageUrl, referenceUrl: settlingSamples.at(-1).imageUrl });
    settling.push({ frames: sample.frames, state: sample.state, renderWaitWallMs: sample.renderWaitWallMs, comparison });
  }

  // Unchanged control at the same cold-reset ordinal, not a continuation with another sample pattern.
  let repeatState;
  for (let n = 1; n <= settleFrames; n++) repeatState = await page.evaluate((first) =>
    window.__CITY_APP.film.renderHeld({ resetHistory: first, sampleFrame: first ? 0 : null }), n === 1);
  const repeatPng = await page.screenshot({ type: 'png' });
  fs.writeFileSync(path.join(out, `${tag}${tier}-settling-${settleFrames}-repeat.png`), repeatPng);
  const repeatControl = { state: repeatState, comparison: await page.evaluate(compareImages,
    { imageUrl: 'data:image/png;base64,' + repeatPng.toString('base64'), referenceUrl: settlingSamples.at(-1).imageUrl }) };

  const phasePairs = [];
  for (const [early, late] of [[24, 280], [90, 346], [128, 384], [256, 512]]) {
    const a = settlingSamples.find((s) => s.frames === early), b = settlingSamples.find((s) => s.frames === late);
    if (!a || !b) continue;
    const comparison = await page.evaluate(compareImages, { imageUrl: a.imageUrl, referenceUrl: b.imageUrl });
    phasePairs.push({ early, late, comparison,
      // Settling screen, separate from lossy JPEG fidelity: fixed thresholds, no adaptive loosening.
      passesSettlingScreen: comparison.meanAbsoluteRgbError <= 0.5 && comparison.p95AbsoluteRgbError <= 2
        && comparison.regions.sky.meanAbsoluteRgbError <= 1 && comparison.regions.sky.p95AbsoluteRgbError <= 4
        && comparison.regions.water.meanAbsoluteRgbError <= 0.1 && comparison.regions.water.p95AbsoluteRgbError <= 1 });
  }

  for (const method of ['canvas', 'target']) {
    for (let i = 0; i < repeats; i++) {
      let shot;
      try {
        shot = await page.evaluate(async ({ method }) => {
          const app = window.__CITY_APP, r = app.renderer, THREE = window.CITY.THREE;
          const w = r.domElement.width, h = r.domElement.height;
          const leases = [], oldOutput = r.getOutputRenderTarget(), oldTarget = r.getRenderTarget();
          let target = null, canvas = null, renderMs = 0, waitOrReadMs = 0, encodeMs = 0;
          const blob = (c) => new Promise((resolve, reject) => c.toBlob((b) => b ? resolve(b) : reject(new Error('null JPEG')), 'image/jpeg', 0.88));
          const start = performance.now();
          try {
            if (method === 'target') {
              target = new THREE.RenderTarget(w, h, { depthBuffer: false, stencilBuffer: false, type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
              // Pipeline already emits display-coded color; do not request another output conversion.
              target.texture.colorSpace = THREE.NoColorSpace;
              leases.push(app.resources.track({ owner: 'photo-spike', kind: 'renderTarget', resource: target, cpuBytes: 0, gpuBytes: w * h * 4 }));
              r.setOutputRenderTarget(target);
            }
            const held = await app.film.renderHeld(); renderMs = held.renderMs; waitOrReadMs = held.waitMs;
            const waitStart = performance.now();
            if (target) {
              const pixels = await r.readRenderTargetPixelsAsync(target, 0, 0, w, h);
              waitOrReadMs += performance.now() - waitStart;
              if (!(pixels instanceof Uint8Array) || pixels.length !== w * h * 4) throw new Error('unexpected readback type/stride');
              canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
              leases.push(app.resources.track({ owner: 'photo-spike', kind: 'canvas', cpuBytes: w * h * 4, gpuBytes: null }));
              leases.push(app.resources.track({ owner: 'photo-spike', kind: 'buffer', cpuBytes: pixels.byteLength, gpuBytes: null }));
              canvas.getContext('2d', { willReadFrequently: true }).putImageData(new ImageData(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength), w, h), 0, 0);
            } else {
              canvas = r.domElement;
            }
            const encStart = performance.now(), image = await blob(canvas); encodeMs = performance.now() - encStart;
            const captureMs = performance.now() - start;
            const imageUrl = await new Promise((resolve, reject) => {
              const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(image);
            });
            return { method, width: w, height: h, bytes: image.size, imageUrl, renderMs, waitOrReadMs, encodeMs, captureMs,
              heldState: held, resourcesAtCapture: app.resourceSnapshot(), memory: { ...r.info.memory } };
          } finally {
            r.setOutputRenderTarget(oldOutput); r.setRenderTarget(oldTarget);
            target?.dispose();
            if (canvas && canvas !== r.domElement) { canvas.width = 0; canvas.height = 0; }
            for (const lease of leases) lease.release();
          }
        }, { method });
        // Restore a held on-screen frame, then compare actual browser-exported JPEG with DevTools PNG.
        // Canvas export already is the on-screen held frame. A target needs a new on-screen presentation.
        if (method === 'target') await page.evaluate(() => window.__CITY_APP.film.renderHeld());
        const reference = await page.screenshot({ type: 'png' });
        const referenceUrl = 'data:image/png;base64,' + reference.toString('base64');
        const comparison = await page.evaluate(compareImages, { imageUrl: shot.imageUrl, referenceUrl });
        const filename = `${tag}${tier}-${method}-${String(i).padStart(2, '0')}`;
        fs.writeFileSync(path.join(out, filename + '.jpg'), Buffer.from(shot.imageUrl.split(',')[1], 'base64'));
        if (i === 0 || i === repeats - 1) fs.writeFileSync(path.join(out, filename + '-reference.png'), reference);
        delete shot.imageUrl;
        shot.afterCleanup = await page.evaluate(() => ({ memory: { ...window.__CITY_APP.renderer.info.memory }, resources: window.__CITY_APP.resourceSnapshot() }));
        results.push({ ...shot, iteration: i, comparison,
          // These are experiment screening thresholds, not a claim of pixel-identical JPEG encoding.
          passesImageScreen: comparison.nonBlackFraction > 0.05 && comparison.meanAbsoluteRgbError <= 4 && comparison.p95AbsoluteRgbError <= 12 });
      } catch (error) { results.push({ method, iteration: i, error: error.message, passesImageScreen: false }); }
    }
  }
  const final = await page.evaluate(async () => {
    const app = window.__CITY_APP;
    await app.renderer.backend.device.queue.onSubmittedWorkDone();
    return { memory: { ...app.renderer.info.memory }, resources: app.resourceSnapshot(), frameNo: app.frameNo };
  });
  const report = { schemaVersion: 1, settleFrames, capturedAt: new Date().toISOString(), tier, width, height, repeats, browser: browser.version(),
    runnerSha256: createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex'),
    baseline, final, results, settling, samplingFrames, phasePairs, repeatControl, errors, diagnostics, served,
    contentionMarker: fs.existsSync(path.join(out, 'CONTENDED.txt')),
    note: 'experimental held-frame export; no visitor ownership/hold integration; no image-screen or latency claim before inspecting receipts' };
  fs.writeFileSync(path.join(out, `${tag}${tier}-photo-spike.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ tier, passedImages: results.filter((r) => r.passesImageScreen).length, attempts: results.length, errors,
    heldSimulation: final.frameNo === baseline.frameNo, remainingOwned: final.resources.owned.liveCount }));
  const viable = ['canvas', 'target'].filter((method) => results.filter((r) => r.method === method).every((r) => r.passesImageScreen));
  if (repeatControl.comparison.meanAbsoluteRgbError !== 0 || (phasePairs.length && !phasePairs.some((p) => p.passesSettlingScreen))
      || !viable.length || errors.length || final.frameNo !== baseline.frameNo || final.resources.owned.liveCount !== baseline.resources.owned.liveCount) process.exitCode = 1;
} catch (error) {
  fs.writeFileSync(path.join(out, `${tag}${tier}-fatal.json`), JSON.stringify({ capturedAt: new Date().toISOString(), error: error.message, errors, diagnostics, served }, null, 2) + '\n');
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
