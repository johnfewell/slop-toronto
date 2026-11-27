// Verify the landing search and the Explore handoff on the Mac mini.
// node tools/search/check-landing.mjs https://sloptoronto.ca
// node tools/search/check-landing.mjs --local    (the built site, with live geocoder responses)
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createDevServer } from '../dev-server.mjs';

const live = 'https://sloptoronto.ca';
const local = process.argv[2] === '--local';
const port = Number(process.env.CAPTURE_PORT || 8827);
const origin = local ? `http://127.0.0.1:${port}` : new URL(process.argv[2] || live).origin;
const out = process.env.GPU2_OUT || 'capture-out';
fs.mkdirSync(out, { recursive: true });
const localServer = local ? createDevServer({ root: 'dist', liveReload: false }).server : null;
if (localServer) {
  localServer.listen(port, '127.0.0.1');
  await once(localServer, 'listening');
}
const browser = await chromium.launch({ channel: 'chromium', args: [
  '--enable-unsafe-webgpu', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'
] });

try {
  for (const phone of [false, true]) {
    const device = phone ? 'phone' : 'desktop';
    const map = phone ? 'detail' : 'eglinton';
    const viewport = phone ? { width: 390, height: 844 } : { width: 1440, height: 900 };
    const page = await browser.newPage({ viewport, isMobile: phone, hasTouch: phone, reducedMotion: 'reduce' });
    const requests = [];
    const errors = [];
    page.on('request', (request) => requests.push(new URL(request.url())));
    page.on('pageerror', (error) => errors.push(error.message));
    if (local) await page.route('**/live/geocode?*', async (route) => {
      const url = new URL(route.request().url());
      const res = await fetch(new URL(url.pathname + url.search, live), {
        cache: 'no-store', headers: { referer: `${live}/`, accept: 'application/json' }
      });
      await route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
    });
    await page.clock.setFixedTime(new Date('2026-11-26T12:30:00-05:00'));

    const home = new URL('/', origin);
    await page.goto(home.href, { waitUntil: 'load', timeout: 180_000 });
    assert.ok(!requests.some((url) => /(?:landing-search|search-geocode|landing-.*\.json|\/live\/geocode)/.test(url.pathname)));
    const input = page.locator('#where-q');
    const options = page.locator('#where-options').getByRole('option');
    const credit = page.locator('.where-credit');

    async function search(query, name) {
      await input.fill(query);
      const row = options.filter({ hasText: name }).first();
      await row.waitFor({ timeout: 20_000 });
      return row;
    }

    const north = await search('850 Coxwell Ave', /850 Coxwell Ave/);
    assert.match(await north.textContent(), /East York/);
    assert.equal(await north.getAttribute('aria-disabled'), phone ? 'true' : null);
    if (phone) assert.match(await north.textContent(), /Outside the downtown map on phones/);
    await search('Queen and Spadina', /Queen.* & Spadina/);
    assert.ok(!requests.some((url) => url.pathname === '/live/geocode'));

    const business = "Sneaky Dee's";
    const businessResponse = page.waitForResponse((res) => {
      const url = new URL(res.url());
      return url.pathname === '/live/geocode' && url.searchParams.get('q') === business && res.ok();
    }, { timeout: 20_000 });
    await input.fill(business);
    await businessResponse;
    await search('M5V 3L9', /M5V 3L9/);
    await credit.waitFor({ timeout: 20_000 });
    assert.equal(await credit.getByAltText('Cesium ion').count(), 1);
    assert.equal(await credit.getByAltText('Microsoft Bing').count(), 1);

    const address = '100 Queen Street West';
    const hall = await search(address, /100 Queen St W/);
    assert.match(await hall.textContent(), /City address.*Old Toronto/);
    assert.equal(await credit.isVisible(), false);
    await input.press('Escape');
    await page.locator('.where-results').waitFor({ state: 'hidden' });
    await input.fill('');
    await search(address, /100 Queen St W/);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(out, `landing-${device}-suggestions.png`) });
    if (phone) await hall.tap();
    else {
      await input.press('ArrowDown');
      assert.equal(await hall.getAttribute('aria-selected'), 'true');
      await input.press('Enter');
    }
    await page.waitForURL((url) => url.pathname === '/explore' && url.searchParams.get('map') === map, { timeout: 180_000 });
    await page.waitForFunction(() => document.getElementById('pc-name')?.textContent === '100 Queen St W', null, { timeout: 240_000 });
    await page.waitForTimeout(1000);
    const arrival = await page.evaluate(() => {
      const app = window.__CITY_APP;
      const { x, z } = app.controllerManager.getActiveEntity().position;
      const cityHall = window.CITY.TELEPORT_LOCATIONS.cityHall;
      return { x, z, east: window.CITY.CITY_BOUNDS.maxX, distance: Math.hypot(x - cityHall.x, z - cityHall.z),
        marker: !!app.scene.getObjectByName('Search destination') };
    });
    assert.equal(arrival.east, phone ? 3700 : 9600);
    assert.equal(arrival.marker, true);
    assert.ok(arrival.distance < 30, JSON.stringify(arrival));
    await page.screenshot({ path: path.join(out, `landing-${device}-arrival.png`) });
    // The card stays open on Go there. Its distance must follow the player after the jump.
    await page.evaluate(() => {
      const guide = window.__CITY_APP.tourGuide;
      guide.showPlace(guide.search('Rogers Centre')[0]);
    });
    const distance = page.locator('#pc-distance');
    const before = await distance.textContent();
    await page.locator('#pc-go').click();
    await page.waitForFunction((before) => document.getElementById('pc-distance').textContent !== before, before);
    assert.match(await distance.textContent(), /^\d+ m /);
    assert.deepEqual(errors, []);
    console.log(device, map, '100 Queen St W arrival', JSON.stringify(arrival), 'Go there distance', before, 'to', await distance.textContent());
    await page.close();
  }
} finally {
  await browser.close();
  localServer?.close();
}
