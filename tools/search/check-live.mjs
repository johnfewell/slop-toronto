// Exercise the real search UI in Chromium on the review host.
// GPU2_OUT=<directory> node tools/search/check-live.mjs [origin]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const origin = process.argv[2] || 'https://sloptoronto.ca';
const out = process.env.GPU2_OUT || 'capture-out';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', args: [
  '--enable-unsafe-webgpu', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'
] });

try {
  for (const phone of [false, true]) {
    const device = phone ? 'phone' : 'desktop';
    const page = await browser.newPage({
      viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      isMobile: phone, hasTouch: phone
    });
    const url = new URL('/explore', origin);
    url.searchParams.set('liveDate', '2026-11-26');
    url.searchParams.set('liveClock', '2026-11-26T12:30:00-05:00');
    const errors = [];
    const queries = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      const u = new URL(request.url());
      if (u.pathname === '/live/geocode') queries.push(u.searchParams.get('q'));
    });
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 180_000 });
    await page.waitForFunction(() => window.__CITY_APP?.ready, null, { timeout: 240_000 });
    const mode = phone ? 'person' : 'cyclist';
    await page.evaluate((mode) => window.__CITY_APP.selectMode(mode), mode);
    const frame = await page.evaluate(() => ({ bounds: window.CITY.CITY_BOUNDS,
      season: window.__CITY_APP.seasons.state(), mobile: matchMedia('(pointer: coarse)').matches }));
    assert.equal(frame.mobile, phone);
    assert.equal(frame.season.sites.source, 'liveDate');
    const field = page.locator('#place-search');
    const results = page.locator('#search-results .ac-item');
    const report = [];

    async function enter(q, expected, { arrive = false, shot, provider = false } = {}) {
      const response = provider ? page.waitForResponse((res) => {
        const u = new URL(res.url());
        return u.pathname === '/live/geocode' && u.searchParams.get('q') === q && res.ok();
      }, { timeout: 20_000 }) : null;
      await field.fill(q);
      await response;
      if (expected) await results.filter({ hasText: expected }).first().waitFor({ state: 'visible', timeout: 20_000 });
      else await page.locator('#search-results').getByText('No places match', { exact: false }).waitFor({ timeout: 20_000 });
      const rows = await results.allTextContents();
      console.log(device, q, rows.length ? rows.join(' | ') : 'no match');
      if (shot) await page.screenshot({ path: path.join(out, `${device}-${shot}-results.png`) });
      if (!arrive) {
        report.push({ q, rows: rows.length });
        return;
      }
      const row = results.filter({ hasText: expected }).first();
      assert.notEqual(await row.getAttribute('aria-disabled'), 'true');
      if (phone) await row.tap();
      else await row.click();
      await page.locator('#pc-go').click();
      await page.waitForTimeout(1100);
      const landing = await page.evaluate(() => {
        const app = window.__CITY_APP;
        const active = app.controllerManager.getActiveEntity();
        const { x, y, z } = active.position;
        return {
          ...window.CITY.latLonFromWorld(x, z), y,
          mode: app.controllerManager.activeMode,
          marker: !!app.scene.getObjectByName('Search destination')
        };
      });
      assert.equal(landing.mode, mode);
      report.push(provider ? { q, arrived: true, mode: landing.mode } : { q, landing });
      if (shot) await page.screenshot({ path: path.join(out, `${device}-${shot}-arrival.png`) });
      await page.locator('#pc-close').click();
      return landing;
    }

    const cityHall = await enter('100 Queen Street West', /^100 Queen St W\s*City address/, { arrive: true, shot: 'city-hall' });
    const hallFrontage = await page.evaluate(() => {
      const { x, z } = window.CITY.TELEPORT_LOCATIONS.cityHall;
      return window.CITY.latLonFromWorld(x, z);
    });
    assert.ok(Math.hypot(cityHall.lat - hallFrontage.lat, cityHall.lon - hallFrontage.lon) < 0.00035);
    assert.equal(cityHall.marker, true);
    await enter('81 Euclid Ave', /Scarborough.*Outside the map/, { shot: 'duplicate-address' });
    assert.match((await results.first().textContent()) || '', /Old Toronto/);
    assert.equal(await results.filter({ hasText: /Scarborough/ }).first().getAttribute('aria-disabled'), 'true');
    await enter('850 Coxwell Ave', /East York/);
    if (phone) assert.match(await results.first().textContent(), /Outside the map/);
    await enter('49 Westhead Rd', /Etobicoke.*Outside the map/);
    await enter('5100 Yonge St', /North York.*Outside the map/);
    await enter('Queen and Spadina', /Queen.*Spadina/, { arrive: true });
    await enter('royal ontaro museum', /Royal Ontario Museum/);
    await enter('100 Queen St W, Mississauga', null);
    assert.equal(queries.some((q) => /^\d/.test(q)), false);

    await enter('M5V 3L9', /M5V 3L9/, { arrive: true, provider: true });
    await field.fill("Sneaky Dee's");
    await page.waitForFunction(() => {
      const list = document.querySelector('#search-results');
      return list?.querySelector('.ac-item') || list?.textContent.includes('No places match');
    }, null, { timeout: 20_000 });
    console.log(device, 'business', await results.allTextContents());
    fs.writeFileSync(path.join(out, `${device}-checks.json`), JSON.stringify({ frame, report, providerRequests: queries.length, errors }, null, 2) + '\n');
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await browser.close();
}
