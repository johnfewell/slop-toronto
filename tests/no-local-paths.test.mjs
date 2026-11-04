// No laptop paths or local host names in what the public repo publishes (st-g5zi). The public repo
// (johnfewell/slop-toronto) is a snapshot of this tree minus the internal files listed in EXCLUDED, so every other
// tracked file, text or binary (gzip archives are checked decompressed), must not name a home folder under /Users or a
// machine's Bonjour (.local) or Tailscale (.ts.net) host name. Write capture folders as $GPU2_REVIEW_DIR/<gpu2 name>/
// (README "Test"), caches as ~/.cache/..., anything else as a description.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The public snapshot's standard exclusions (internal files that never reach the public repo).
const EXCLUDED = [
  /^\.beads\//, /^AGENTS\.md$/, /^CLAUDE\.md$/, /^\.claude\//, /^\.impeccable\//,
  /^docs\/handoff-[^/]*\.md$/, /^docs\/research\//, /^docs\/slop-cities-/, /^docs\/beads\.md$/,
  /^docs\/perf\/.*\/host-observations\.tar\.gz$/, /tweet/i, /slop-toronto-updates/,
  /^tools\/isometric\//, /^tests\/isometric\//,
];
// Built from pieces so this file does not match itself.
const LEAKS = [
  ['a home folder under /Users', new RegExp('/' + 'Users/', 'g')],
  ['a Bonjour host name', new RegExp('\\b[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+\\.' + 'local\\b', 'g')],
  ['the Mac mini host', new RegExp('mac-?mini\\.' + 'local', 'gi')],
  ['a Tailscale host name', new RegExp('\\b[A-Za-z0-9-]+\\.ts\\.' + 'net\\b', 'g')],
];

function findLeaks(text) {
  const found = [];
  for (const [what, re] of LEAKS) {
    for (const m of text.matchAll(re)) {
      const line = text.slice(0, m.index).split('\n').length;
      found.push({ what, line, match: m[0] });
    }
  }
  return found;
}

function trackedFiles() {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 })
      .split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

const files = trackedFiles();

test('the leak patterns catch laptop paths and host names, and pass ordinary text', () => {
  const home = '/' + 'Users/someone/code/x';
  assert.equal(findLeaks(`see ${home}/frames`).length, 1);
  assert.equal(findLeaks('ssh ' + 'mac-mini.' + 'local').length, 2); // a Bonjour name and the mini
  assert.equal(findLeaks('Johns-MacBook-Pro.' + 'local:8811').length, 1);
  assert.equal(findLeaks('mini.tail1234.ts.' + 'net').length, 1);
  assert.deepEqual(findLeaks('$GPU2_REVIEW_DIR/slop-toronto-r3-ride/ ~/.cache/slop-toronto .env.local nodeVar.local'), []);
});

test('no tracked file published by the public snapshot names a laptop path or local host', { skip: files ? false : 'not a git checkout' }, () => {
  const leaks = [];
  for (const file of files) {
    if (EXCLUDED.some((re) => re.test(file))) continue;
    const abs = join(ROOT, file);
    if (!existsSync(abs)) continue; // deleted in the working tree
    let bytes = readFileSync(abs);
    if (/\.(t?gz)$/.test(file)) bytes = gunzipSync(bytes);
    for (const leak of findLeaks(bytes.toString('latin1'))) leaks.push(`${file}:${leak.line}: ${leak.what} (${leak.match})`);
  }
  assert.deepEqual(leaks, [], `write these as $GPU2_REVIEW_DIR/..., ~/.cache/... or a description:\n${leaks.join('\n')}`);
});
