// Local source server: no browser caching, plus source-change reloads for already-open tabs. Node builtins only.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.webmanifest': 'application/manifest+json', '.bin': 'application/octet-stream' };
export const DEV_CLIENT = `(() => {
  const version = document.currentScript.dataset.version;
  const events = new EventSource('/__dev/events');
  let reloading = false;
  events.addEventListener('version', (event) => {
    if (event.data === version || reloading) return;
    reloading = true;
    // The city's pagehide handler saves the last safe ground location, including when aboard transit.
    events.close(); location.reload();
  });
  window.addEventListener('pagehide', () => events.close(), { once: true });
})();`;

export function createDevServer({ root = ROOT, liveReload = true } = {}) {
  root = path.resolve(root);
  let revision = randomUUID(), debounce;
  const clients = new Set(), watchers = [];
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400); res.end(); return; }
    if (pathname === '/__dev/events' && liveReload) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      res.flushHeaders(); res.write('event: version\ndata: ' + revision + '\n\n');
      clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    if (pathname === '/__dev/client.js' && liveReload) {
      res.writeHead(200, { 'Content-Type': TYPES['.js'] }); res.end(req.method === 'HEAD' ? '' : DEV_CLIENT); return;
    }
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep) || rel.split('/').some((part) => part.startsWith('.'))) {
      res.writeHead(404); res.end(); return;
    }
    let stat;
    try { stat = fs.statSync(file); } catch { res.writeHead(404); res.end(); return; }
    if (!stat.isFile()) { res.writeHead(404); res.end(); return; }
    const ext = path.extname(file);
    res.setHeader('Content-Type', TYPES[ext] || 'application/octet-stream');
    // Do not honor If-Modified-Since/ETag in development: even existing cache validators must fetch current bytes.
    if (ext === '.html' && liveReload) {
      const html = fs.readFileSync(file, 'utf8').replace('</head>',
        '<script defer src="/__dev/client.js" data-version="' + revision + '"></script>\n</head>');
      res.setHeader('Content-Length', Buffer.byteLength(html)); res.writeHead(200); res.end(req.method === 'HEAD' ? '' : html);
    } else {
      res.setHeader('Content-Length', stat.size); res.writeHead(200);
      if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    }
  });
  function changed() {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      revision = randomUUID();
      for (const client of clients) client.write('event: version\ndata: ' + revision + '\n\n');
    }, 300);
  }
  if (liveReload) for (const dir of ['', 'js', 'css']) {
    const folder = path.join(root, dir);
    if (fs.existsSync(folder)) watchers.push(fs.watch(folder, (_, name) => {
      if (name && /\.(html|m?js|css)$/.test(String(name))) changed();
    }));
  }
  const heartbeat = setInterval(() => { for (const client of clients) client.write(': heartbeat\n\n'); }, 15000);
  heartbeat.unref();
  const stop = () => {
    clearTimeout(debounce); clearInterval(heartbeat); watchers.forEach((watcher) => watcher.close());
    for (const client of clients) client.end(); clients.clear();
  };
  server.on('close', stop);
  return { server, stop };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 5530), { server, stop } = createDevServer();
  server.on('error', (error) => { console.error(error.message); process.exitCode = 1; stop(); });
  server.listen(port, '127.0.0.1', () => console.log('Slop Toronto dev: http://127.0.0.1:' + port + '/explore.html (no cache, live reload)'));
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { stop(); server.close(); });
}
