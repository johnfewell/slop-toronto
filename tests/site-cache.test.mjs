import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildSite } from '../tools/build-site.mjs';
import { createDevServer } from '../tools/dev-server.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toronto-cache-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of ['js', 'css', 'assets']) fs.mkdirSync(path.join(root, dir));
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(root, 'js/main.js'), "export const load = () => import('./child.js'); export const debug = './js/debug.js';");
  fs.writeFileSync(path.join(root, 'js/child.js'), 'export const value = 1;');
  fs.writeFileSync(path.join(root, 'js/debug.js'), 'export const debug = true;');
  fs.writeFileSync(path.join(root, 'css/style.css'), "body { background: url('../assets/photo.png'); }");
  fs.writeFileSync(path.join(root, 'assets/photo.png'), 'fixture image');
  const html = `<html><head><link rel="stylesheet" href="./css/style.css"></head><body><script type="module" src="./js/main.js"></script></body></html>`;
  for (const page of ['index.html', 'explore.html']) fs.writeFileSync(path.join(root, page), html);
  return { root, out: path.join(root, 'dist') };
}

test('production URLs are deterministic fingerprints, including lazy modules and debug script references', async (t) => {
  const options = fixture(t), first = buildSite(options).manifest;
  assert.deepEqual(buildSite(options).manifest, first, 'identical builds retain their URLs');
  const main = first.assets['js/main.js'];
  assert.match(main, /^js\/main\.[a-f0-9]{12}\.js$/);
  assert.equal(fs.existsSync(path.join(options.out, 'js/main.js')), false);
  const html = fs.readFileSync(path.join(options.out, 'explore.html'), 'utf8');
  assert.ok(html.includes('./' + main));
  assert.ok(html.includes('./' + first.assets['css/style.css']));
  assert.ok(fs.readFileSync(path.join(options.out, main), 'utf8').includes('./' + first.assets['js/debug.js']));
  assert.equal((await (await import(pathToFileURL(path.join(options.out, main)))).load()).value, 1);
  const css = fs.readFileSync(path.join(options.out, first.assets['css/style.css']), 'utf8');
  assert.ok(css.includes('../assets/photo.png'), 'media URLs still resolve relative to their stylesheet');
  assert.ok(fs.existsSync(path.join(options.out, 'assets/photo.png')));

  fs.writeFileSync(path.join(options.root, 'js/child.js'), 'export const value = 2;');
  const next = buildSite(options).manifest;
  assert.notEqual(next.assets['js/child.js'], first.assets['js/child.js']);
  assert.notEqual(next.assets['js/main.js'], main, 'a lazy dependency edit invalidates its importer too');
  assert.equal(next.assets['css/style.css'], first.assets['css/style.css'], 'unrelated files retain cache reuse');
  assert.equal((await (await import(pathToFileURL(path.join(options.out, next.assets['js/main.js'])))).load()).value, 2);
  assert.notEqual(next.build, first.build);
  const headers = fs.readFileSync(path.join(options.out, '_headers'), 'utf8');
  assert.match(headers, /\/\*\.html\n  Cache-Control: no-cache/);
  assert.match(headers, /\/js\/\*\n  Cache-Control: public, max-age=31536000, immutable/);
  assert.doesNotMatch(headers, /stale-while-revalidate/);
});

test('development ignores cache validators and notifies connected tabs when code changes', async (t) => {
  const { root } = fixture(t), { server, stop } = createDevServer({ root });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { stop(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(base + '/explore.html');
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(await page.text(), /src="\/__dev\/client.js" data-version="[\w-]+"/);
  const res = await fetch(base + '/js/child.js', { headers: { 'if-modified-since': 'Wed, 01 Jan 2099 00:00:00 GMT', 'if-none-match': '*' } });
  assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(await res.text(), 'export const value = 1;');
  const head = await fetch(base + '/explore.html', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');

  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 5000);
  try {
    const stream = await fetch(base + '/__dev/events', { signal: abort.signal });
    const reader = stream.body.getReader(), first = new TextDecoder().decode((await reader.read()).value);
    fs.writeFileSync(path.join(root, 'js/child.js'), 'export const value = 3;');
    const update = new TextDecoder().decode((await reader.read()).value);
    assert.match(update, /event: version/); assert.notEqual(update, first);
    const changed = await fetch(base + '/js/child.js');
    assert.equal(await changed.text(), 'export const value = 3;');
  } finally { clearTimeout(timer); abort.abort(); }
});
