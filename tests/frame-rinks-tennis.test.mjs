// The rink polygons and tennis courts of the whole Eglinton map (jf-2g0): the detail map's records stay as they were (its files do
// not change) and the frame's files add the rest of the City inventory inside the frame, built by the same tools with --frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { unpackGeo } from '../js/geodata-loader.js';
import { frameRinks } from '../tools/build-rinks.mjs';
import { tennisCourts } from '../tools/build-tennis.mjs';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const json = (p) => JSON.parse(read(p));
const run = (files) => { const ctx = { window: { CITY: {} } }; for (const f of files) vm.runInNewContext(read(f), ctx); return ctx.window.CITY; };
const { GEO } = await unpackGeo(fs.readFileSync(new URL('../data/frames/eglinton/toronto-geodata.bin', import.meta.url)));
const detail = run(['js/toronto-city-facilities.js', 'js/toronto-rinks.js', 'js/toronto-tennis.js']);
const egl = run(['js/frames/eglinton/toronto-city-facilities.js', 'js/toronto-rinks.js', 'js/toronto-tennis.js', 'js/frames/eglinton/toronto-rinks.js', 'js/frames/eglinton/toronto-tennis.js']);
const plain = (o) => JSON.parse(JSON.stringify(o));

test('the Eglinton map draws a polygon for every City outdoor rink in its frame, and the detail map\'s file still holds its 17', () => {
  assert.equal(detail.RINKS.records.length, 17);
  const inventory = egl.CITY_FACILITIES.records.filter((r) => r.kind === 'rink');
  assert.equal(inventory.length, 37);
  assert.equal(egl.RINKS.records.length, 37);
  assert.deepEqual(egl.RINKS.records.map((r) => r.assetId).sort(), inventory.map((r) => r.assetId).sort(), 'one polygon per inventory record, joined by asset ID');
  assert.equal(egl.RINKS.frameSource.added, 20);
  // the frame's file is what the builder makes (the detail records are the same ones, in the same order, in front)
  const made = frameRinks(json, 'eglinton', GEO, egl.CITY_FACILITIES, detail.RINKS);
  assert.deepEqual(plain(egl.RINKS.records.slice(17)), plain(made.records));
  assert.deepEqual(plain(egl.RINKS.audit.slice(detail.RINKS.audit.length)), plain(made.audit));
  assert.deepEqual(plain(egl.RINKS.records.slice(0, 17)), plain(detail.RINKS.records), 'the detail records are not changed');
  // each of the twenty is inside the frame's box, and has a reviewed aerial
  const box = GEO.frame.detail, review = json('tools/data/rink-review-20261126-eglinton.json');
  assert.equal(review.records.length, 20);
  for (const r of egl.RINKS.records.slice(17)) {
    assert.ok(r.polygons.every((p) => p.outer.every(([x, z]) => x > box.x0 && x < box.x1 && z > box.z0 && z < box.z1)), r.assetId);
    const rev = review.records.find((v) => v.assetId === r.assetId);
    assert.ok(rev && rev.aerial.sha256.length === 64 && rev.aerial.year === 2025 && rev.reviewedAt === '2026-11-26', r.assetId);
    assert.equal(r.boards, rev.boards);
  }
});

test('where the aerial and the inventory disagree on boards the scene follows the aerial and the audit lists both', () => {
  const by = (id) => egl.RINKS.records.find((r) => r.assetId === id);
  // Giovanni Caboto, Hodgson, Ramsden Park and North Toronto Memorial: the open slab is marked boarded, the round-cornered pad beside it not
  for (const [slab, pad] of [['14276', '43583'], ['14283', '43588'], ['14293', '43596'], ['43728', '43584']]) {
    assert.equal(by(slab).sourceFacts.Boards, 'Yes'); assert.equal(by(slab).boards, false, slab);
    assert.equal(by(pad).sourceFacts.Boards, 'No'); assert.equal(by(pad).boards, true, pad);
    assert.ok(by(pad).gate, `${pad} has a reviewed gate`); assert.equal(by(slab).gate, null);
  }
  const frameAudit = egl.RINKS.audit.slice(detail.RINKS.audit.length).map((a) => a.id).sort();
  assert.deepEqual(plain(frameAudit), ['14276', '14283', '14293', '43583', '43584', '43588', '43596', '43728']);
  // skate trails keep their islands
  assert.ok(by('59882').polygons[0].holes.length >= 1 || by('59882').polygons.length > 1);
  assert.equal(by('59883').type, 'Skate Trail');
});

test('the Eglinton map holds a reviewed footprint for the tennis courts of 27 City facilities, listing the one with none', () => {
  assert.equal(detail.TENNIS.records.length, 43);
  const review = json('tools/data/tennis-review-20261126-eglinton.json');
  assert.equal(review.groups.length, 27);
  assert.equal(egl.TENNIS.records.length, 43 + 112);
  assert.equal(new Set(egl.TENNIS.records.map((r) => r.id)).size, egl.TENNIS.records.length, 'no court twice');
  const made = tennisCourts(json('tools/data/tennis-footprints-20261126-eglinton.json'), review, GEO, egl.CITY_FACILITIES);
  assert.deepEqual(plain(egl.TENNIS.records.slice(43)), plain(made.records));
  assert.deepEqual(plain(egl.TENNIS.records.slice(0, 43)), plain(detail.TENNIS.records), 'the detail courts are not changed');
  assert.deepEqual(plain(egl.TENNIS.frameSource.unmatched.map((u) => u.cityLocationId)), ['514']);
  assert.ok(egl.TENNIS.records.slice(43).every((r) => r.length === 23.77 && r.width === 10.97 && Number.isFinite(r.yaw) && r.listingIds.length >= 1));
  // the City counts that differ from the mapped courts stay in the audit, never summed or adjusted
  const audit = Object.fromEntries(egl.TENNIS.audit.map((a) => [a.cityLocationId, a]));
  assert.equal(audit['167'].mappedCourts, 8); assert.equal(audit['167'].sourceListings[0].courts, 12);
  assert.equal(audit['200'].mappedCourts, 10); assert.equal(audit['200'].sourceListings[0].courts, 7);
  assert.equal(audit['629'].mappedCourts, 2); assert.equal(audit['629'].sourceListings[0].courts, 4);
  assert.equal(egl.TENNIS.records.filter((r) => r.cityLocationId === '629').length, 2, 'the private backyard court is not a City court');
});

test('an OSM court tagged private is joined only where the City lists a club on that park', () => {
  const review = json('tools/data/tennis-review-20261126-eglinton.json'), snapshot = json('tools/data/tennis-footprints-20261126-eglinton.json');
  const privateGroups = review.groups.filter((g) => g.privateAccessOk);
  assert.deepEqual(privateGroups.map((g) => g.cityLocationId).sort(), ['219', '78']);
  for (const g of privateGroups) assert.ok(egl.CITY_FACILITIES.records.filter((r) => r.kind === 'tennis' && r.locationId === g.cityLocationId).every((r) => r.facts['Access type'] === 'Club'));
  const without = structuredClone(review); without.groups.find((g) => g.cityLocationId === '78').privateAccessOk = false;
  assert.throws(() => tennisCourts(snapshot, without, GEO, egl.CITY_FACILITIES), /Unverified/);
  // the private home court beside Cedarvale Park is not in any group
  assert.ok(!review.groups.some((g) => g.ways.includes(1044554553)));
});
