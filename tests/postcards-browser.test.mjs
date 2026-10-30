import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright';

test('native IndexedDB commits bounded albums and rolls back synchronous/asynchronous write failures', {
  skip: !fs.existsSync(chromium.executablePath()) ? 'Playwright Chromium is not installed' : false, timeout: 40000
}, async () => {
  // CPU-only browser test: this page contains no city, canvas, WebGL or WebGPU context.
  const source = fs.readFileSync(new URL('../js/postcards.js', import.meta.url), 'utf8');
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', req.url === '/postcards.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/postcards.js' ? source : '<!doctype html><script>window.CITY={}</script><script src="/postcards.js"></script>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ args: ['--disable-gpu', '--disable-software-rasterizer'] });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const result = await page.evaluate(async () => {
      const check = (value, message) => { if (!value) throw new Error(message); };
      const C = window.CITY, databaseName = 'postcard-test', limits = { maxItems: 2, maxBytes: 250 };
      const store = C.createPostcardStore({ databaseName, limits });
      const composition = (id) => ({ schemaVersion: 1, id, createdAtUtc: '2026-10-28T16:00:00.000Z', appBuild: 'test',
        locationLabel: 'Toronto', caption: 'From the lake', qualityTier: 'high', cloudPreset: 'medium', viewId: 'skyline',
        camera: { position: [0, 80, 300], target: [0, 20, 0], fov: 44 }, environment: { presetId: 'golden', cloudPhase: 20 } });
      // Storage fixtures, not encoded-photo validation. Actual JPEG encoding is covered by GPU capture checks.
      const image = new Blob([new Uint8Array(80)], { type: 'image/jpeg' }), thumb = new Blob([new Uint8Array(20)], { type: 'image/jpeg' });
      for (const id of ['pc-a', 'pc-b', 'pc-c']) await store.save(composition(id), image, thumb);
      const ids = async () => (await store.list()).map((v) => v.id).sort().join(',');
      check(await ids() === 'pc-b,pc-c', 'Count/byte eviction failed');
      check(await store.get('pc-a') === null && (await store.get('pc-b')).blob.size === 80, 'Eviction did not remove only the old blob');
      check(!(await store.list()).some((v) => 'blob' in v || 'thumbnail' in v), 'Metadata listing loaded images');

      const put = IDBObjectStore.prototype.put;
      let quotaError = '', asyncError = '';
      try {
        IDBObjectStore.prototype.put = function (...args) {
          if (this.name === 'images') throw new DOMException('Injected quota failure', 'QuotaExceededError');
          return put.apply(this, args);
        };
        try { await store.save(composition('pc-d'), image, thumb); } catch (error) { quotaError = error.name; }
      } finally { IDBObjectStore.prototype.put = put; }
      check(quotaError === 'QuotaExceededError' && await ids() === 'pc-b,pc-c', 'Quota failure committed an eviction');
      try {
        IDBObjectStore.prototype.put = function (...args) {
          // Real duplicate-key request failure after metadata writes are already queued in this transaction.
          if (this.name === 'images') return this.add({ id: 'pc-c' });
          return put.apply(this, args);
        };
        try { await store.save(composition('pc-d'), image, thumb); } catch (error) { asyncError = error.name; }
      } finally { IDBObjectStore.prototype.put = put; }
      check(asyncError === 'ConstraintError' && await ids() === 'pc-b,pc-c', 'Asynchronous failure committed metadata writes');
      check(await store.get('pc-d') === null && (await store.get('pc-b')).blob.size === 80, 'Rollback lost a committed image');

      const db = await store.open(), damaged = (await store.list()).find((v) => v.id === 'pc-c');
      await new Promise((resolve, reject) => {
        const tx = db.transaction('items', 'readwrite'); tx.objectStore('items').put({ ...damaged, bytes: 'bad' });
        tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
      });
      let corruption = false;
      try { await store.save(composition('pc-d'), image, thumb); } catch { corruption = true; }
      check(corruption && (await store.get('pc-b')).blob.size === 80, 'Corrupt metadata destroyed valid items');
      await store.delete('pc-c');
      const second = C.createPostcardStore({ databaseName, limits });
      await Promise.all([store.save(composition('pc-x'), image, thumb), second.save(composition('pc-y'), image, thumb)]);
      check(await ids() === 'pc-x,pc-y', 'Concurrent saves bypassed the shared transaction bound');
      second.close();
      await new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, 2);
        request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error);
      });
      let oldVersion = false;
      try { await store.list(); } catch (error) { oldVersion = error.name === 'VersionError'; }
      check(oldVersion, 'Version change kept an invalid cached connection');
      store.close();
      return { evicted: true, quotaError, asyncError, corruption, concurrentBound: true, oldVersion };
    });
    assert.deepEqual(result, { evicted: true, quotaError: 'QuotaExceededError', asyncError: 'ConstraintError', corruption: true, concurrentBound: true, oldVersion: true });
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
