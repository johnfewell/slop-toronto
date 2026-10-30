import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildSite } from '../tools/build-site.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const UMAMI = 'https://umami.cloud6711.workers.dev';
const WEBSITE = '75a0f1a3-3bb4-4dd9-adde-eade0b719665';
const tags = (html) => [...html.matchAll(/<script\b[^>]*\bsrc="https:\/\/umami\.[^"]*"[^>]*><\/script>/g)].map((m) => m[0]);

for (const page of ['index.html', 'explore.html']) {
  test(`${page} counts visits only on the production hosts`, () => {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const [tracker, ...extra] = tags(html);
    assert.equal(extra.length, 0, 'only the counter: no session replay or other Umami scripts');
    assert.doesNotMatch(html, /recorder\.js/, 'session replay is deliberately left out');
    assert.ok(tracker.includes(`src="${UMAMI}/script.js"`));
    assert.ok(tracker.includes(`data-website-id="${WEBSITE}"`));
    assert.ok(tracker.includes('data-domains="sloptoronto.ca,www.sloptoronto.ca"'), 'dev, preview and capture hosts send nothing');
    assert.ok(html.indexOf(tracker) < html.indexOf('</head>'));
    if (page === 'explore.html') {
      // deferred scripts execute in document order: the city's inline module would wait for the analytics downloads
      assert.match(tracker, /\basync\b/);
      assert.doesNotMatch(tracker, /\bdefer\b/);
      assert.ok(html.indexOf(tracker) > html.indexOf('<script type="importmap">'), 'the import map stays ahead of every script');
    }
  });
}

test('the production build leaves the external analytics tags untouched', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toronto-analytics-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'js'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(root, 'js/main.js'), 'export {};');
  for (const page of ['index.html', 'explore.html']) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    fs.writeFileSync(path.join(root, page), `<html><head>${tags(html).join('')}</head><body><script type="module" src="./js/main.js"></script></body></html>`);
  }
  buildSite({ root, out: path.join(root, 'dist') });
  for (const page of ['index.html', 'explore.html']) {
    const source = tags(fs.readFileSync(path.join(ROOT, page), 'utf8'));
    assert.deepEqual(tags(fs.readFileSync(path.join(root, 'dist', page), 'utf8')), source);
  }
});
