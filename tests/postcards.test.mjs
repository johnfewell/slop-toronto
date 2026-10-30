import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const window = { CITY: {} };
vm.runInNewContext(fs.readFileSync(new URL('../js/postcards.js', import.meta.url), 'utf8'), { window, Blob });
const C = window.CITY;
const composition = (id = 'test-1') => ({ schemaVersion: 1, id, createdAtUtc: '2026-10-28T16:00:00.000Z',
  appBuild: 'test', viewId: 'skyline', locationLabel: 'Toronto', caption: 'From the lake', qualityTier: 'high', cloudPreset: 'medium',
  camera: { position: [0, 80, 300], target: [0, 20, 0], fov: 44 }, environment: { presetId: 'golden', cloudPhase: 20 } });
const item = (id, date, bytes = 100) => ({ id, savedAtUtc: date, composition: composition(id), bytes, imageBytes: bytes - 10, thumbnailBytes: 10 });

test('CompositionV1 validates camera/time/identity and copies only supported metadata', () => {
  const raw = composition(); raw.unrelated = 'not stored';
  const clean = C.normalizeComposition(raw);
  assert.equal(clean.id, raw.id); assert.equal(clean.unrelated, undefined);
  raw.camera.position[0] = 999; assert.equal(clean.camera.position[0], 0);
  for (const patch of [{ id: '../bad' }, { schemaVersion: 2 }, { camera: { position: [NaN, 0, 0], target: [0, 0, 0], fov: 44 } }, { environment: { presetId: 'golden', cloudPhase: Infinity } }]) {
    assert.throws(() => C.normalizeComposition({ ...composition(), ...patch }), /Invalid postcard/);
  }
});

test('eviction respects both limits, retains the just-saved entry and never double-counts an update', () => {
  const older = item('old', '2026-10-28T10:00:00.000Z'), newer = item('newer', '2026-10-28T11:00:00.000Z');
  const incoming = item('incoming', '2026-10-28T12:00:00.000Z');
  let plan = C.planPostcardEviction([newer, older], incoming, { maxItems: 2, maxBytes: 1000 });
  assert.equal(plan.evict.join(','), 'old'); assert.equal(plan.bytes, 200); assert.equal(plan.count, 2);
  plan = C.planPostcardEviction([newer, older], incoming, { maxItems: 60, maxBytes: 150 });
  assert.equal(plan.evict.join(','), 'old,newer'); assert.equal(plan.bytes, 100);
  plan = C.planPostcardEviction([older, newer], { ...newer, imageBytes: 100, bytes: 110 }, { maxItems: 2, maxBytes: 210 });
  assert.equal(plan.evict.length, 0); assert.equal(plan.bytes, 210); assert.equal(plan.count, 2);
  assert.equal(older.imageBytes, 90, 'planning does not mutate committed metadata');
});

test('corrupt accounting and an oversize candidate fail before an eviction can be committed', () => {
  const entry = item('old', '2026-10-28T10:00:00.000Z');
  assert.throws(() => C.planPostcardEviction([{ ...entry, bytes: 999 }], entry), /damaged/);
  assert.throws(() => C.planPostcardEviction([], entry, { maxItems: 2, maxBytes: 50 }), /capacity/);
  assert.throws(() => C.planPostcardEviction([], entry, { maxItems: 0, maxBytes: 1000 }), /limits/);
});

test('unavailable storage and oversize encoding reject without weakening the album limits', async () => {
  const store = C.createPostcardStore({ databaseAPI: null });
  await assert.rejects(store.list(), /unavailable/);
  await assert.rejects(store.save(composition(), new Blob(['x'], { type: 'image/png' }), new Blob(['x'], { type: 'image/jpeg' })), /limit/);
  assert.equal(C.POSTCARD_LIMITS.maxItems, 60); assert.equal(C.POSTCARD_LIMITS.maxBytes, 64 * 1024 * 1024);
  assert.equal(C.POSTCARD_LIMITS.maxImageBytes, 2 * 1024 * 1024);
  store.close();
});
