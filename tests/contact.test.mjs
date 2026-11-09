// The contact address (st-bu5k): the landing page's colophon, the explore page's help panel and the news page's
// colophon each show john@sloptoronto.ca as a mailto: link (Cloudflare Email Routing forwards it).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LINK = '<a href="mailto:john@sloptoronto.ca">john@sloptoronto.ca</a>';

test('the landing colophon shows the contact address', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('<footer class="colophon"');
  const colophon = html.slice(start, html.indexOf('</footer>', start));
  assert.ok(colophon.includes(`<p>Contact: ${LINK}</p>`));
});

test('the explore help panel shows the contact address next to the credits', () => {
  const html = readFileSync(join(ROOT, 'explore.html'), 'utf8');
  const foot = html.slice(html.indexOf('<p class="help-foot">'));
  assert.ok(foot.slice(0, foot.indexOf('</p>')).includes(`Contact: ${LINK}`));
});

test('the news page colophon shows the contact address', () => {
  const html = readFileSync(join(ROOT, 'news/laptop-drew-downtown.html'), 'utf8');
  const start = html.indexOf('<footer class="colophon"');
  const colophon = html.slice(start, html.indexOf('</footer>', start));
  assert.ok(colophon.includes(`<p>Contact: ${LINK}</p>`));
});
