// node --test: tools/ttc-feed.mjs picks the TTC timetable the transit tools read, and refuses an edition that is not
// the pinned one (docs/transit-data.md). Temporary folders only; no network, no real feed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveTtcFeed } from '../tools/ttc-feed.mjs';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const PINNED = { version: 'S1000544', modified: '2026-11-04T19:51:45' };

// a download folder like tools/fetch-gtfs.mjs writes: <dir>/completegtfs.zip, <dir>/SOURCE.json, <dir>/feed/feed_info.txt
function download(root, { version, modified, zip = true, source = true }) {
  const dir = path.join(root, `dl-${version}-${zip}-${source}`);
  fs.mkdirSync(path.join(dir, 'feed'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'feed/feed_info.txt'), `feed_publisher_name,feed_start_date,feed_end_date,feed_version\nTTC,20261101,20261219,${version}\n`);
  if (source) fs.writeFileSync(path.join(dir, 'SOURCE.json'), JSON.stringify({ modified }));
  if (zip) fs.writeFileSync(path.join(dir, 'completegtfs.zip'), `zip of ${version}`);
  return path.join(dir, 'feed');
}
function pinFile(root, pin) {
  const f = path.join(root, 'pin.json');
  fs.writeFileSync(f, JSON.stringify({ datasets: { 'trees/2': {}, ...(pin ? { 'ttc-gtfs-static': pin } : {}) } }));
  return f;
}
const pinOf = (root) => pinFile(root, { edition: PINNED.version, zipSha256: sha(`zip of ${PINNED.version}`), publisherModified: PINNED.modified });
const own = (feed, pf) => resolveTtcFeed(null, { env: {}, pinFile: pf, ownFeed: feed });

test('own download: the pinned edition (zip SHA-256 matches) is read', () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-feed-'));
  const feed = download(t, { version: 'S1000544', modified: PINNED.modified });
  assert.deepEqual(own(feed, pinOf(t)), { feed, from: 'own', edition: 'S1000544' });
});

test('own download: no zip, SOURCE.json date matches the pin: read', () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-feed-'));
  const feed = download(t, { version: 'S1000544', modified: PINNED.modified, zip: false });
  assert.equal(own(feed, pinOf(t)).from, 'own');
});

test('own download older than the pin stops, naming both editions and both ways out', () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-feed-'));
  const pf = pinOf(t);
  for (const zip of [true, false]) {
    const feed = download(t, { version: 'S1000542', modified: '2026-09-30T14:17:52', zip });
    assert.throws(() => own(feed, pf), (e) => /S1000542/.test(e.message) && /S1000544/.test(e.message) && /OLDER/.test(e.message) &&
      /TORONTO_DATA_CACHE/.test(e.message) && /tools\/fetch-gtfs\.mjs/.test(e.message));
  }
});

test('own download NEWER than the pin also stops: a new edition is a deliberate re-pin, with the ways out named', () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-feed-'));
  const feed = download(t, { version: 'S1000546', modified: '2026-12-18T10:00:00' });
  assert.throws(() => own(feed, pinOf(t)), (e) => /S1000546/.test(e.message) && /S1000544/.test(e.message) && /NEWER/.test(e.message) &&
    /move the pin/.test(e.message) && /TORONTO_DATA_CACHE/.test(e.message) && /first argument/.test(e.message));
});

test('own download with neither zip nor SOURCE.json stops: its edition cannot be checked', () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-feed-'));
  const feed = download(t, { version: 'S1000544', modified: PINNED.modified, zip: false, source: false });
  assert.throws(() => own(feed, pinOf(t)), /cannot be checked/);
});

test('a feed folder given as an argument is read unchecked; without a pin the own download is read as before', () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-feed-'));
  const old = download(t, { version: 'S1000542', modified: '2026-09-30T14:17:52' });
  assert.equal(resolveTtcFeed(old, { env: {}, pinFile: pinOf(t), ownFeed: old }).from, 'argument');
  assert.deepEqual(resolveTtcFeed(null, { env: {}, pinFile: pinFile(t, null), ownFeed: old }), { feed: old, from: 'own' });
});

test('shared cache: the pinned edition is read; a missing edition or other bytes stop', () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'ttc-feed-'));
  const pf = pinOf(t), cache = path.join(t, 'cache'), ed = path.join(cache, 'raw/ttc-gtfs-static/S1000544');
  assert.throws(() => resolveTtcFeed(null, { env: { TORONTO_DATA_CACHE: cache }, pinFile: pf }), /not in/);
  fs.mkdirSync(path.join(ed, 'feed'), { recursive: true });
  fs.writeFileSync(path.join(ed, 'manifest.json'), JSON.stringify({ sha256: sha('zip of S1000544') }));
  assert.deepEqual(resolveTtcFeed(null, { env: { TORONTO_DATA_CACHE: cache }, pinFile: pf }), { feed: path.join(ed, 'feed'), from: 'shared', edition: 'S1000544' });
  fs.writeFileSync(path.join(ed, 'manifest.json'), JSON.stringify({ sha256: sha('other bytes') }));
  assert.throws(() => resolveTtcFeed(null, { env: { TORONTO_DATA_CACHE: cache }, pinFile: pf }), /is not the pinned/);
});
