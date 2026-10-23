// tools/build-site.mjs: copies what the published site needs into dist/ (Netlify publishes dist/, see netlify.toml).
// usage: node tools/build-site.mjs [outDir]   (default dist; node builtins only, no install needed)
// Ships the two pages, css/, assets/ (minus the git-ignored Abuja leftovers) and only the js/ files the pages load:
// every ./js/*.js named in index.html / explore.html, plus whatever those files import or reference in turn
// (e.g. sky-clouds.js -> import('./clouds.js')). tools/, tests/, vendor/ and node_modules never ship.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.resolve(ROOT, process.argv[2] || 'dist');
const PAGES = ['index.html', 'explore.html'];
const TEXT = ['LICENSE', 'CREDITS.md'];
// git-ignored local leftovers that must never ship even when they sit in a local checkout
const SKIP = [/^assets\/landing(\/|$)/, /^assets\/og-image\.jpg$/, /(^|\/)\.DS_Store$/];

if (!OUT.startsWith(ROOT) || OUT === ROOT) throw new Error(`refusing to build into ${OUT}`);
fs.rmSync(OUT, { recursive: true, force: true }); // dist/ is this script's own output (git-ignored)

let bytes = 0;
let files = 0;
const copy = (rel) => {
  if (SKIP.some((re) => re.test(rel))) return;
  const src = path.join(ROOT, rel);
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
  if (!fs.existsSync(path.join(ROOT, rel))) throw new Error(`missing script ${rel}`);
  scripts.add(rel);
  queue.push(rel);
};
for (const page of PAGES) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  for (const m of html.matchAll(/['"]\.\/(js\/[\w./-]+\.m?js)/g)) want(m[1]);
}
while (queue.length) {
  const rel = queue.shift();
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  // './js/x.js' paths (relative to the page) and import('./x.js') / from './x.js' (relative to the module)
  for (const m of src.matchAll(/['"`]\.\/(js\/[\w./-]+\.m?js)['"`?]/g)) want(m[1]);
  for (const m of src.matchAll(/(?:import\s*\(\s*|from\s+)['"`](\.\.?\/[\w./-]+\.m?js)['"`]/g)) {
    want(path.posix.join(path.posix.dirname(rel), m[1]));
  }
}

for (const rel of [...PAGES, ...TEXT, 'css', 'assets', ...[...scripts].sort()]) {
  if (fs.existsSync(path.join(ROOT, rel))) copy(rel);
}
console.log(`build-site: ${files} files, ${(bytes / 1e6).toFixed(1)} MB -> ${path.relative(ROOT, OUT)}/ (${scripts.size} scripts)`);
