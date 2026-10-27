// tools/build-site.mjs: fingerprints code and copies the published site into dist/ (Cloudflare serves dist/ as a Worker's static
// assets, see wrangler.jsonc; dist/_headers sets the response headers).
// usage: node tools/build-site.mjs [outDir]   (default dist; node builtins only, no install needed)
// Ships the two pages, css/, assets/ (minus the git-ignored Abuja leftovers) and only the js/ files the pages load:
// every ./js/*.js named in index.html / explore.html, plus whatever those files import or reference in turn
// (e.g. sky-clouds.js -> import('./clouds.js')). tools/, tests/, vendor/ and node_modules never ship.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PAGES = ['index.html', 'explore.html'];
const TEXT = ['LICENSE', 'CREDITS.md'];
// git-ignored local leftovers that must never ship even when they sit in a local checkout
const SKIP = [/^assets\/landing(\/|$)/, /^assets\/og-image\.jpg$/, /(^|\/)\.DS_Store$/];

export function buildSite({ root = ROOT, out = path.join(root, 'dist') } = {}) {
  const OUT = path.resolve(out);
  if (!OUT.startsWith(path.resolve(root) + path.sep)) throw new Error(`refusing to build into ${OUT}`);
  fs.rmSync(OUT, { recursive: true, force: true }); // dist/ is this script's own output (git-ignored)

  let bytes = 0;
  let files = 0;
  const copy = (rel) => {
    if (SKIP.some((re) => re.test(rel))) return;
    const src = path.join(root, rel);
    if (fs.statSync(src).isDirectory()) {
      for (const name of fs.readdirSync(src)) copy(`${rel}/${name}`);
      return;
    }
    const dst = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    bytes += fs.statSync(src).size;
    files++;
  };

  // js/ files the pages load, followed through relative imports / script paths
  const scripts = new Set();
  const queue = [];
  const want = (rel) => {
    rel = path.posix.normalize(rel);
    if (!rel.startsWith('js/') || scripts.has(rel)) return;
    if (!fs.existsSync(path.join(root, rel))) throw new Error(`missing script ${rel}`);
    scripts.add(rel);
    queue.push(rel);
  };
  for (const page of PAGES) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    for (const m of html.matchAll(/['"]\.\/(js\/[\w./-]+\.m?js)/g)) want(m[1]);
  }
  while (queue.length) {
    const rel = queue.shift();
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    // './js/x.js' paths (relative to the page) and import('./x.js') / from './x.js' (relative to the module)
    for (const m of src.matchAll(/['"`]\.\/(js\/[\w./-]+\.m?js)['"`?]/g)) want(m[1]);
    for (const m of src.matchAll(/(?:import\s*\(\s*|from\s+)['"`](\.\.?\/[\w./-]+\.m?js)['"`]/g)) {
      want(path.posix.join(path.posix.dirname(rel), m[1]));
    }
  }

  // Hash the emitted contents, including rewritten lazy-import dependencies. Keep the ordered classic scripts and
  // external Three.js import map intact rather than bundling globals or making every code edit invalidate geodata.
  const hash = (source) => createHash('sha256').update(source).digest('hex').slice(0, 12);
  const assets = new Map(), visiting = new Set();
  function rewrite(source, rel) {
    source = source.replace(/(['"`])(\.\/(?:js|css)\/[\w./-]+\.(?:m?js|css))(?:\?[^'"`]*)?\1/g,
      (_, quote, ref) => `${quote}./${emit(ref.slice(2))}${quote}`);
    if (rel.startsWith('js/')) source = source.replace(/((?:import\s*\(\s*|from\s+)['"`])(\.\.?\/[\w./-]+\.m?js)(['"`])/g,
      (_, before, ref, after) => {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), ref));
        // A page-relative ./js/ path above may already have been rewritten.
        if ([...assets.values()].includes(target)) return `${before}${ref}${after}`;
        const result = path.posix.relative(path.posix.dirname(rel), emit(target));
        return `${before}${result.startsWith('.') ? result : './' + result}${after}`;
      });
    return source;
  }
  function write(rel, source) {
    const dst = path.join(OUT, rel); fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, source); bytes += Buffer.byteLength(source); files++;
  }
  function emit(rel) {
    if (assets.has(rel)) return assets.get(rel);
    if (visiting.has(rel)) throw new Error(`cyclic local asset imports: ${rel}`);
    if (!/^(?:js|css)\//.test(rel)) throw new Error(`unexpected code asset ${rel}`);
    visiting.add(rel);
    const source = rewrite(fs.readFileSync(path.join(root, rel), 'utf8'), rel);
    const ext = path.posix.extname(rel), name = `${rel.slice(0, -ext.length)}.${hash(source)}${ext}`;
    assets.set(rel, name); visiting.delete(rel); write(name, source); return name;
  }
  for (const rel of [...TEXT, 'assets']) if (fs.existsSync(path.join(root, rel))) copy(rel);
  for (const rel of [...scripts].sort()) emit(rel);
  if (fs.existsSync(path.join(root, 'css'))) for (const name of fs.readdirSync(path.join(root, 'css'))) {
    if (name.endsWith('.css')) emit(`css/${name}`);
  }
  const pages = new Map(PAGES.map((rel) => [rel, rewrite(fs.readFileSync(path.join(root, rel), 'utf8'), rel)]));
  const manifest = { build: hash([...pages.values()].join('\n')), assets: Object.fromEntries([...assets].sort()) };
  for (const [rel, source] of pages) write(rel, source);
  write('asset-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  // Only fingerprinted code is immutable. HTML/manifest and unhashed media revalidate; never join conflicting
  // Cache-Control values via overlapping Cloudflare _headers rules.
  fs.writeFileSync(path.join(OUT, '_headers'), [
    '/*', '  X-Content-Type-Options: nosniff', '  Referrer-Policy: strict-origin-when-cross-origin',
    ...['/', '/index', '/explore', '/*.html', '/asset-manifest.json', '/assets/*'].flatMap((p) => [p, '  Cache-Control: no-cache']),
    ...['/js/*', '/css/*'].flatMap((p) => [p, '  Cache-Control: public, max-age=31536000, immutable']),
    '/*.glb', '  Content-Type: model/gltf-binary'
  ].join('\n') + '\n');
  return { files, bytes, scripts: scripts.size, manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.resolve(ROOT, process.argv[2] || 'dist');
  const result = buildSite({ out });
  console.log(`build-site: ${result.files} files, ${(result.bytes / 1e6).toFixed(1)} MB -> ${path.relative(ROOT, out)}/ (${result.scripts} fingerprinted scripts, build ${result.manifest.build})`);
}
