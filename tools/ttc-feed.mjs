// tools/ttc-feed.mjs — which unpacked TTC timetable (GTFS) folder the transit tools read.
//
// - A feed folder given on the command line wins, unchecked: building from another edition on purpose.
// - With TORONTO_DATA_CACHE set (the shared Toronto data repo's cache root), the edition pinned in
//   data/shared-toronto-data-pin.json (datasets["ttc-gtfs-static"]): <cache>/raw/ttc-gtfs-static/<edition>/feed. The
//   edition's manifest must name the pinned zip's SHA-256, or the tools stop.
// - Otherwise this repo's own download, ~/.cache/slop-toronto/gtfs/feed (tools/fetch-gtfs.mjs). The public snapshot
//   builds this way, without the shared repo. With a pin, the download must be the pinned edition: its zip's SHA-256
//   (when the zip is there), else its SOURCE.json date against the pin's. A download older OR newer than the pin stops
//   the tools: the committed transit is the pinned edition's, and a newer edition is a deliberate re-pin (its shape
//   review and the rebuild order in docs/transit-data.md), never a side effect of a fresh download.
// Both layouts keep SOURCE.json beside feed/, which tools/build-transit.mjs reads for the edition's date.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const PIN_FILE = path.join(ROOT, 'data/shared-toronto-data-pin.json');
export const OWN_FEED = path.join(os.homedir(), '.cache/slop-toronto/gtfs/feed');

/** The pinned TTC edition: { edition, zipSha256, publisherModified, ... } or null. */
export function ttcPin(pinFile = PIN_FILE) {
  try { return JSON.parse(fs.readFileSync(pinFile, 'utf8')).datasets?.['ttc-gtfs-static'] || null; } catch { return null; }
}

/** What a downloaded feed folder holds: its feed_info version and dates, its SOURCE.json date, its zip's SHA-256. */
export function describeDownload(feed) {
  const dir = path.dirname(feed);
  const out = { version: null, start: null, end: null, modified: null, zipSha256: null, zip: null };
  try {
    const [head, row] = fs.readFileSync(path.join(feed, 'feed_info.txt'), 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
    const h = head.split(','), v = row.split(',');
    out.version = v[h.indexOf('feed_version')] || null; out.start = v[h.indexOf('feed_start_date')] || null; out.end = v[h.indexOf('feed_end_date')] || null;
  } catch { /* no feed_info */ }
  try { out.modified = JSON.parse(fs.readFileSync(path.join(dir, 'SOURCE.json'), 'utf8')).modified || null; } catch { /* none */ }
  let zips = [];
  try { zips = fs.readdirSync(dir).filter((f) => /\.zip$/i.test(f)); } catch { /* none */ }
  if (zips.length) {
    out.zip = path.join(dir, zips.includes('completegtfs.zip') ? 'completegtfs.zip' : zips[0]);
    out.zipSha256 = crypto.createHash('sha256').update(fs.readFileSync(out.zip)).digest('hex');
  }
  return out;
}

const label = (d) => `${d.version || 'an unknown edition'}${d.modified ? ` (published ${d.modified})` : ''}`;

/** Throws unless the own download at `feed` is the pinned edition. */
export function checkOwnDownload(feed, pin, pinFile = PIN_FILE) {
  const d = describeDownload(feed);
  const pinned = `${pin.edition}${pin.publisherModified ? ` (published ${pin.publisherModified})` : ''}`;
  if (d.zipSha256 && d.zipSha256 === pin.zipSha256) return d;
  if (!d.zipSha256 && d.modified && pin.publisherModified && d.modified === pin.publisherModified) return d;
  const where = `${path.dirname(feed)} (this repo's own download, tools/fetch-gtfs.mjs)`;
  if (!d.zipSha256 && !d.modified) {
    throw new Error(`the TTC timetable in ${where} has no zip and no SOURCE.json, so its edition cannot be checked against the pinned ${pinned} in ${path.relative(ROOT, pinFile)}.\n` +
      `Either set TORONTO_DATA_CACHE to the shared Toronto data cache (it holds the pinned edition), or run node tools/fetch-gtfs.mjs to download the current feed.`);
  }
  const newer = d.modified && pin.publisherModified && d.modified > pin.publisherModified;
  const what = newer ? 'is NEWER than' : d.modified && pin.publisherModified && d.modified < pin.publisherModified ? 'is OLDER than' : 'is not';
  const why = d.zipSha256 ? `its zip's SHA-256 ${d.zipSha256.slice(0, 12)}… is not the pinned ${String(pin.zipSha256).slice(0, 12)}…` : `its SOURCE.json date is not the pin's`;
  let ways = `Either set TORONTO_DATA_CACHE to the shared Toronto data cache (it holds the pinned edition), or run node tools/fetch-gtfs.mjs to download the current feed`;
  if (newer) ways = `The committed transit is built from the pinned edition, so a newer one is a deliberate re-pin, not a side effect of a download: ` +
    `move the pin to it and rebuild in the order of docs/transit-data.md (its shape review included), or set TORONTO_DATA_CACHE to build the pinned edition, ` +
    `or pass the feed folder as the first argument to build from this edition on purpose (unchecked)`;
  else if (d.modified && pin.publisherModified && d.modified < pin.publisherModified) ways += ` (the portal serves the newest edition; if that is newer than the pin, this check will say so)`;
  throw new Error(`the TTC timetable in ${where} is ${label(d)}, which ${what} the edition pinned in ${path.relative(ROOT, pinFile)}, ${pinned}: ${why}.\n${ways}.`);
}

/** The feed folder to read: { feed, from: 'argument' | 'shared' | 'own', edition? }. Throws when the shared cache is
 *  set but the pinned edition is missing or its bytes differ from the pin, and when the own download is not the pinned
 *  edition. opts.ownFeed: the own download's feed folder (tests). */
export function resolveTtcFeed(given = null, { env = process.env, pinFile = PIN_FILE, ownFeed = OWN_FEED } = {}) {
  if (given) return { feed: path.resolve(given), from: 'argument' };
  const cache = env.TORONTO_DATA_CACHE;
  const pin = ttcPin(pinFile);
  if (!cache) {
    if (!pin) return { feed: ownFeed, from: 'own' };
    const d = checkOwnDownload(ownFeed, pin, pinFile);
    return { feed: ownFeed, from: 'own', edition: d.version || pin.edition };
  }
  if (!pin) throw new Error(`TORONTO_DATA_CACHE is set but ${path.relative(ROOT, pinFile)} pins no ttc-gtfs-static edition`);
  const dir = path.join(cache, 'raw/ttc-gtfs-static', pin.edition);
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch {
    throw new Error(`the pinned TTC edition ${pin.edition} is not in ${path.join(cache, 'raw/ttc-gtfs-static')} (fetch it with the shared repo's fetch/ttc-gtfs-static.py, or unset TORONTO_DATA_CACHE to use tools/fetch-gtfs.mjs's download)`);
  }
  if (manifest.sha256 !== pin.zipSha256) throw new Error(`TTC edition ${pin.edition}: its zip's SHA-256 ${manifest.sha256} is not the pinned ${pin.zipSha256}`);
  return { feed: path.join(dir, 'feed'), from: 'shared', edition: pin.edition };
}
