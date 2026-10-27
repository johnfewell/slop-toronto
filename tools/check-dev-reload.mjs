// Run via gpu2: real city reload after a CSS edit, preserving the player's location. Never use the laptop GPU.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { createDevServer } from './dev-server.mjs';
if (!process.env.GPU2_OUT) throw new Error('Run this browser check through gpu2.');
const out = process.env.GPU2_OUT, css = new URL('../css/style.css', import.meta.url);
const original = fs.readFileSync(css, 'utf8'), errors = [];
const { server, stop } = createDevServer();
server.listen(0, '127.0.0.1'); await once(server, 'listening');
let browser;
try {
  browser = await chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/explore.html?quality=high&autoscale=0&transit=timetable`);
  await page.waitForFunction(() => window.__CITY_APP?.ready, null, { timeout: 240000 });
  const before = await page.evaluate(() => {
    const a = window.__CITY_APP; a.selectMode('cyclist'); a.teleportTo(-1000, -350, 0.8);
    const c = a.controllerManager, p = c.getActiveEntity();
    return { origin: performance.timeOrigin, mode: c.activeMode, x: p.position.x, z: p.position.z, heading: p.heading };
  });
  fs.appendFileSync(css, '\n/* dev reload verification */\n');
  await page.waitForFunction((origin) => performance.timeOrigin !== origin && window.__CITY_APP?.ready, before.origin, { timeout: 240000 });
  const after = await page.evaluate(() => {
    const c = window.__CITY_APP.controllerManager, p = c.getActiveEntity();
    return { mode: c.activeMode, x: p.position.x, z: p.position.z, heading: p.heading };
  });
  assert.equal(after.mode, before.mode); assert.ok(Math.hypot(after.x - before.x, after.z - before.z) < 1);
  assert.ok(Math.abs(after.heading - before.heading) < 0.01);
  assert.deepEqual(errors, []);
  fs.mkdirSync(out, { recursive: true });
  await page.screenshot({ path: path.join(out, 'dev-reload.png') });
  fs.writeFileSync(path.join(out, 'dev-reload.log'), JSON.stringify({ before, after, errors }, null, 2) + '\n');
  console.log('[cache-check] source edit reloaded the running city and preserved mode, position and heading');
} finally {
  try { await browser?.close(); }
  finally {
    stop(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
    fs.writeFileSync(css, original);
  }
}
