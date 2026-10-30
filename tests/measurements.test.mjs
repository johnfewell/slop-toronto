import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { BufferGeometry, RenderTarget } from 'three';

function api() {
  const window = { CITY: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../js/measurements.js', import.meta.url), 'utf8'), { window });
  return window.CITY;
}
const plain = (x) => JSON.parse(JSON.stringify(x));

test('real frame intervals retain long frames and separate CPU submission from pacing', () => {
  let time = 0;
  const m = api().createFrameMeasurements({ now: () => time, metadata: () => ({ tier: 'low' }) });
  m.start({ label: 'street', warmupMs: 20 });
  m.record(10, 10, 1, 2); // overlaps the reset boundary
  m.record(25, 15, 1, 2); // overlaps warm-up
  m.record(40, 15, 1, 2);
  m.record(140, 100, 3, 4); // never clamp slow intervals to simulation dt
  m.record(160, 20, 2, 3);
  time = 170;
  const r = plain(m.read({ stop: true, raw: true }));
  assert.equal(r.frameIntervalMs.p95, 100);
  assert.equal(r.frameIntervalMs.median, 20);
  assert.equal(r.totalSubmissionCpuMs.p95, 7);
  assert.equal(r.metadata.tier, 'low');
  assert.deepEqual(r.samples.atMs, [40, 140, 160]);
  assert.deepEqual(r.excluded, { 'window-start': 1, warmup: 1 });
  assert.equal(r.active, false);
  m.record(200, 40, 2, 3);
  assert.equal(m.read().retainedSamples, 3, 'readback after stop cannot contaminate the measurement');
});

test('bounded ring preserves order, reports overwritten samples and refuses to certify a truncated window', () => {
  const m = api().createFrameMeasurements({ capacity: 3, now: () => 0 });
  m.start({ warmupMs: 0 });
  for (let i = 1; i <= 6; i++) m.record(i * 10, 10, i, i + 1);
  const r = plain(m.read({ raw: true }));
  assert.deepEqual(r.samples.simulationCpuMs, [4, 5, 6]);
  assert.equal(r.totalAccepted, 5);
  assert.equal(r.overwrittenSamples, 2);
  assert.equal(r.valid, false);
});

test('hidden-tab discontinuity, fixed steps and invalid timings do not become frame latency samples', () => {
  const m = api().createFrameMeasurements({ now: () => 0 });
  m.start({ warmupMs: 0 }); m.record(10, 10, 1, 1);
  m.record(20, 10, 1, 1, 'fixed-step');
  m.markDiscontinuity('visibility'); m.record(10000, 9980, 1, 1);
  m.record(10010, 10, NaN, 1);
  m.record(10020, 10, 1, 1);
  const r = plain(m.read());
  assert.equal(r.retainedSamples, 1);
  assert.equal(r.frameIntervalMs.p95, 10);
  assert.equal(r.excluded['fixed-step'], 1);
  assert.equal(r.excluded.visibility, 1);
  assert.equal(r.excluded.invalid, 1);
  assert.equal(r.valid, false, 'interrupted windows retain evidence but cannot certify a steady measurement');
});

test('zero samples are unavailable, and new windows reset peaks/exclusions/samples', () => {
  let time = 0;
  const m = api().createFrameMeasurements({ now: () => time });
  m.start({ warmupMs: 0 });
  assert.equal(m.read().frameIntervalMs.p95, null);
  assert.equal(m.read().valid, false);
  m.record(10, 10, 2, 2); m.record(20, 10, 2, 2);
  time = 100; m.start({ label: 'new', warmupMs: 0 });
  assert.equal(m.read().totalAccepted, 0);
  assert.equal(m.read().label, 'new');
  assert.throws(() => m.start({ warmupMs: -1 }), /warm-up/);
});

test('resource accounting follows actual Three.js disposal, updates bytes and releases only once', () => {
  const ledger = api().createOwnedResourceLedger();
  const geometry = new BufferGeometry();
  const lease = ledger.track({ owner: 'photo', kind: 'geometry', resource: geometry, cpuBytes: 24, gpuBytes: 32 });
  lease.update({ cpuBytes: 0, gpuBytes: 64 });
  assert.equal(ledger.snapshot().peakCpuBytes, 24);
  assert.equal(ledger.snapshot().peakGpuBytes, 64);
  assert.throws(() => lease.update({ cpuBytes: 50, gpuBytes: -1 }), /bytes/);
  assert.equal(ledger.snapshot().cpuBytes, 0, 'invalid updates are atomic');
  assert.throws(() => ledger.track({ owner: 'photo', kind: 'geometry', resource: geometry }), /already tracked/);
  geometry.dispose();
  assert.equal(lease.release(), false);
  assert.equal(lease.update({ gpuBytes: 10 }), false);
  assert.equal(ledger.snapshot().liveCount, 0);
  assert.equal(ledger.snapshot().releasedCount, 1);
  assert.equal(ledger.snapshot().gpuBytes, 0);
});

test('unregistered/unknown bytes are not silently reported as measured zero and capacities stay bounded', () => {
  const ledger = api().createOwnedResourceLedger({ capacity: 2 });
  ledger.track({ owner: '__proto__', kind: 'image', cpuBytes: null, gpuBytes: 0 });
  ledger.track({ owner: 'facades', kind: 'texture', cpuBytes: 1024, gpuBytes: null });
  const r = plain(ledger.snapshot());
  assert.equal(r.unknownCpu, 1); assert.equal(r.unknownGpu, 1);
  assert.equal(r.owners.__proto__.count, 1);
  assert.equal(r.owners.facades.cpuBytes, 1024);
  assert.throws(() => ledger.track({ owner: 'photo', kind: 'canvas' }), /full/);
});

test('twenty allocation/update/dispose cycles leave no owned allocations or duplicate counts', () => {
  const ledger = api().createOwnedResourceLedger();
  for (let i = 0; i < 20; i++) {
    const target = new RenderTarget(4, 4, { depthBuffer: false });
    const lease = ledger.track({ owner: 'capture', kind: 'renderTarget', resource: target, cpuBytes: 64, gpuBytes: 128 });
    target.dispose(); lease.release();
  }
  const r = ledger.snapshot();
  assert.equal(r.liveCount, 0); assert.equal(r.allocatedCount, 20); assert.equal(r.releasedCount, 20);
  assert.equal(r.cpuBytes, 0); assert.equal(r.gpuBytes, 0); assert.equal(r.peakGpuBytes, 128);
});
