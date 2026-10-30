(function () {
// Bounded diagnostics. Frame intervals are presentation cadence, CPU values are submission work,
// and owned bytes are explicit allocation estimates — none is whole-device GPU time or VRAM.
function createFrameMeasurements({ capacity = 4096, now = () => performance.now(), metadata = () => ({}) } = {}) {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 65536) throw new RangeError('invalid sample capacity');
  const samples = Array.from({ length: 4 }, () => new Float64Array(capacity));
  let active = false, count = 0, total = 0, start = 0, end = 0, after = 0, label = '', discontinuity = null, metadataStart = null;
  let excluded = Object.create(null);
  const reasons = new Set(['window-start', 'visibility', 'startup', 'fixed-step', 'hidden', 'invalid', 'warmup', 'discontinuity', 'capture', 'paused']);
  const round = (n) => Math.round(n * 1000) / 1000;
  function values(column) {
    const out = [];
    for (let i = 0; i < count; i++) out.push(samples[column][(total - count + i) % capacity]);
    return out;
  }
  function distribution(a) {
    if (!a.length) return { count: 0, mean: null, median: null, p95: null, min: null, max: null };
    const sorted = [...a].sort((a, b) => a - b);
    const percentile = (p) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
    return { count: a.length, mean: round(a.reduce((a, b) => a + b, 0) / a.length),
      median: round(percentile(0.5)), p95: round(percentile(0.95)), min: round(sorted[0]), max: round(sorted.at(-1)) };
  }
  function startWindow(options = {}) {
    const warmupMs = options.warmupMs ?? 1500;
    if (!Number.isFinite(warmupMs) || warmupMs < 0) throw new RangeError('invalid warm-up');
    label = String(options.label || 'measurement').slice(0, 160);
    start = now(); end = start; after = start + warmupMs;
    metadataStart = metadata();
    count = total = 0; excluded = Object.create(null); discontinuity = 'window-start'; active = true;
  }
  function record(at, intervalMs, simulationCpuMs, renderCpuMs, reason = null) {
    if (!active) return;
    end = at;
    if (discontinuity) { reason ||= discontinuity; discontinuity = null; }
    if (!Number.isFinite(at) || !Number.isFinite(intervalMs) || !Number.isFinite(simulationCpuMs) || !Number.isFinite(renderCpuMs)
        || intervalMs <= 0 || simulationCpuMs < 0 || renderCpuMs < 0) reason ||= 'invalid';
    if (!reason && at - intervalMs < after) reason = 'warmup';
    if (reason) { reason = reasons.has(reason) ? reason : 'other'; excluded[reason] = (excluded[reason] || 0) + 1; return; }
    const i = total % capacity;
    samples[0][i] = intervalMs; samples[1][i] = simulationCpuMs; samples[2][i] = renderCpuMs; samples[3][i] = at - start;
    total++; count = Math.min(capacity, count + 1);
  }
  function read({ raw = false, stop = false } = {}) {
    const stoppedAt = active ? now() : end;
    if (stop && active) { end = stoppedAt; active = false; }
    const frame = values(0), sim = values(1), draw = values(2);
    const result = { schemaVersion: 1, label, active, metadataStart, metadata: metadata(),
      window: { startMs: round(start), endMs: round(stoppedAt), durationMs: round(Math.max(0, stoppedAt - start)), warmupMs: round(after - start) },
      capacity, totalAccepted: total, retainedSamples: count, overwrittenSamples: total - count, excluded: { ...excluded },
      frameIntervalMs: distribution(frame), simulationCpuMs: distribution(sim), renderSubmissionCpuMs: distribution(draw),
      totalSubmissionCpuMs: distribution(sim.map((v, i) => v + draw[i])),
      valid: count > 0 && total === count && (!discontinuity || discontinuity === 'window-start')
        && Object.keys(excluded).every((r) => r === 'window-start' || r === 'warmup' || r === 'startup'),
      semantics: { frame: 'wall interval between rendered frames; includes pacing, not GPU execution time',
        cpu: 'simulation/preparation and synchronous renderer submission; no queue completion wait',
        percentile: 'nearest rank of retained samples; raw timestamps relative to window start',
        gpu: 'not measured by this collector; optional legacy timestamp pass averages are separate' } };
    if (raw) result.samples = { atMs: values(3), frameIntervalMs: frame, simulationCpuMs: sim, renderSubmissionCpuMs: draw };
    return result;
  }
  return { start: startWindow, record, read, isActive: () => active,
    markDiscontinuity(reason = 'discontinuity') { if (active) discontinuity = reason; } };
}

function createOwnedResourceLedger({ capacity = 1024 } = {}) {
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError('invalid ledger capacity');
  const entries = new Map(), objects = new WeakMap();
  const kinds = new Set(['buffer', 'geometry', 'texture', 'renderTarget', 'canvas', 'image']);
  let next = 0, cpu = 0, gpu = 0, peakCpu = 0, peakGpu = 0, allocated = 0, released = 0;
  const bytes = (value) => {
    if (value === null || value === undefined) return null;
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('bytes must be nonnegative safe integers or null');
    return value;
  };
  function track({ owner, kind, label = '', resource = null, cpuBytes = null, gpuBytes = null }) {
    if (typeof owner !== 'string' || !owner || owner.length > 100 || !kinds.has(kind)) throw new TypeError('invalid owner/kind');
    if (entries.size >= capacity) throw new RangeError('owned-resource ledger is full');
    if (resource !== null && (typeof resource !== 'object' || objects.has(resource))) throw new TypeError('resource already tracked or invalid');
    const entry = { id: ++next, owner, kind, label: String(label).slice(0, 160), cpuBytes: bytes(cpuBytes), gpuBytes: bytes(gpuBytes) };
    function update(patch) {
      if (!entries.has(entry.id)) return false;
      // Validate the whole change before touching totals.
      const c = Object.hasOwn(patch, 'cpuBytes') ? bytes(patch.cpuBytes) : entry.cpuBytes;
      const g = Object.hasOwn(patch, 'gpuBytes') ? bytes(patch.gpuBytes) : entry.gpuBytes;
      cpu += (c || 0) - (entry.cpuBytes || 0); gpu += (g || 0) - (entry.gpuBytes || 0);
      entry.cpuBytes = c; entry.gpuBytes = g;
      peakCpu = Math.max(peakCpu, cpu); peakGpu = Math.max(peakGpu, gpu);
      return true;
    }
    function release() {
      if (!entries.delete(entry.id)) return false;
      cpu -= entry.cpuBytes || 0; gpu -= entry.gpuBytes || 0; released++;
      if (resource) { objects.delete(resource); resource.removeEventListener?.('dispose', release); }
      return true;
    }
    entries.set(entry.id, entry); allocated++;
    if (resource) { objects.set(resource, entry.id); resource.addEventListener?.('dispose', release); }
    cpu += entry.cpuBytes || 0; gpu += entry.gpuBytes || 0;
    peakCpu = Math.max(peakCpu, cpu); peakGpu = Math.max(peakGpu, gpu);
    return { id: entry.id, update, release };
  }
  function snapshot() {
    const owners = Object.create(null);
    let unknownCpu = 0, unknownGpu = 0;
    for (const e of entries.values()) {
      const o = owners[e.owner] ||= { count: 0, cpuBytes: 0, gpuBytes: 0, unknownCpu: 0, unknownGpu: 0, kinds: {} };
      o.count++; o.kinds[e.kind] = (o.kinds[e.kind] || 0) + 1;
      o.cpuBytes += e.cpuBytes || 0; o.gpuBytes += e.gpuBytes || 0;
      if (e.cpuBytes === null) { unknownCpu++; o.unknownCpu++; }
      if (e.gpuBytes === null) { unknownGpu++; o.unknownGpu++; }
    }
    return { schemaVersion: 1, capacity, liveCount: entries.size, allocatedCount: allocated, releasedCount: released,
      cpuBytes: cpu, gpuBytes: gpu, peakCpuBytes: peakCpu, peakGpuBytes: peakGpu, unknownCpu, unknownGpu, owners,
      scope: 'explicit feature-owned estimates only; excludes unregistered city/renderer allocations; unknown is not zero' };
  }
  // release() updates accounting only. The resource owner must dispose/free its actual allocation.
  return { track, snapshot };
}

Object.assign(window.CITY, { createFrameMeasurements, createOwnedResourceLedger });
})();
