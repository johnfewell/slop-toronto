// tools/metrics-summary.mjs — summarize tools/capture.mjs metrics reports (docs/adoption-measurements.md).
// usage: node tools/metrics-summary.mjs <metrics.json>... > summary.json
// Per run and shot: frame-interval and CPU-submission distributions recomputed from the retained raw samples
// (nearest rank, like js/measurements.js, plus p99; over20ms = a missed 60 Hz vsync, over40ms = a missed 30 fps slot), long tasks / long animation frames when the
// tools/capture-longtasks.js init script was used, renderer memory counts and the owned-resource ledger.
// Shots repeated across runs are then pooled (all retained samples) and the per-run p95 spread is reported.
// Nothing is discarded: invalid windows are listed with their reason.
import fs from 'node:fs';
import path from 'node:path';

const rank = (sorted, p) => sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : null;
const r2 = (n) => n === null || n === undefined ? null : Math.round(n * 100) / 100;
function dist(values) {
  const s = [...values].sort((a, b) => a - b);
  return { n: s.length, mean: r2(s.reduce((a, b) => a + b, 0) / (s.length || 1)), p50: r2(rank(s, 0.5)), p95: r2(rank(s, 0.95)),
    p99: r2(rank(s, 0.99)), max: r2(s.at(-1) ?? null), over20ms: s.filter((v) => v > 20).length, over40ms: s.filter((v) => v > 40).length, over50ms: s.filter((v) => v > 50).length };
}
const runs = [];
for (const file of process.argv.slice(2)) {
  const reports = JSON.parse(fs.readFileSync(file, 'utf8'));
  const run = path.basename(file).replace(/-?metrics\.json$/, '');
  for (const r of reports) {
    const f = r.frames, s = f.samples || {};
    const cpu = (s.simulationCpuMs || []).map((v, i) => v + s.renderSubmissionCpuMs[i]);
    const lt = f.longTasks || null, mem = r.resources?.renderer || {}, owned = r.resources?.owned || {};
    const main = Object.entries(r.servedDecodedContent || {}).find(([u]) => /\/js\/main\./.test(u))?.[1]?.sha256 || null;
    runs.push({ run, shot: r.shot, capturedAt: r.capturedAt, valid: f.valid, measurementClass: r.measurementClass,
      tier: f.metadata?.tier, viewport: f.metadata?.viewport, aa: f.metadata?.aa, mode: f.metadata?.mode, camera: f.metadata?.camera,
      startupReadyMs: r.startupReadyMs, excluded: f.excluded, mainSha256: main && main.slice(0, 12),
      frameIntervalMs: dist(s.frameIntervalMs || []), cpuSubmissionMs: dist(cpu),
      simulationCpuMs: dist(s.simulationCpuMs || []), renderSubmissionCpuMs: dist(s.renderSubmissionCpuMs || []),
      longTasks: lt?.longtask ? { count: lt.longtask.count, totalMs: lt.longtask.totalMs, maxMs: lt.longtask.maxMs } : null,
      longAnimationFrames: lt?.longAnimationFrame ? { count: lt.longAnimationFrame.count, totalMs: lt.longAnimationFrame.totalMs, maxMs: lt.longAnimationFrame.maxMs } : null,
      renderer: { geometries: mem.geometries, textures: mem.textures, programs: mem.programs, renderTargets: mem.renderTargets,
        attributesMiB: r2((mem.attributesSize || 0) / 1048576), storageMiB: r2((mem.storageAttributesSize || 0) / 1048576),
        texturesMiB: r2((mem.texturesSize || 0) / 1048576), totalMiB: r2((mem.total || 0) / 1048576) },
      owned: { live: owned.liveCount, cpuBytes: owned.cpuBytes, gpuBytes: owned.gpuBytes, peakCpuBytes: owned.peakCpuBytes, peakGpuBytes: owned.peakGpuBytes } });
  }
}
// Pool repeated windows of the same tier/shot (warm-up runs are excluded from pools but kept in `runs`).
const pools = {};
for (const file of process.argv.slice(2)) {
  const run = path.basename(file).replace(/-?metrics\.json$/, '');
  if (/warm|retry-of/.test(run)) continue;
  for (const r of JSON.parse(fs.readFileSync(file, 'utf8'))) {
    const key = `${r.frames.metadata?.tier}/${r.shot}`, s = r.frames.samples || {};
    const p = pools[key] ||= { tier: r.frames.metadata?.tier, shot: r.shot, runs: [], frame: [], cpu: [], perRunP95: [], perRunP99: [], longTasks: 0, loafs: 0, valid: true };
    p.runs.push(run); p.valid &&= r.frames.valid;
    p.frame.push(...(s.frameIntervalMs || [])); p.cpu.push(...(s.simulationCpuMs || []).map((v, i) => v + s.renderSubmissionCpuMs[i]));
    p.perRunP95.push(r.frames.frameIntervalMs.p95); p.perRunP99.push(dist(s.frameIntervalMs || []).p99);
    p.longTasks += r.frames.longTasks?.longtask?.count || 0; p.loafs += r.frames.longTasks?.longAnimationFrame?.count || 0;
  }
}
const pooled = Object.values(pools).map((p) => ({ tier: p.tier, shot: p.shot, runs: p.runs, allValid: p.valid,
  frameIntervalMs: dist(p.frame), cpuSubmissionMs: dist(p.cpu), perRunP95: p.perRunP95, perRunP99: p.perRunP99,
  longTasks: p.longTasks, longAnimationFrames: p.loafs }));
process.stdout.write(JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(),
  note: 'nearest-rank percentiles from retained raw samples; frame interval includes vsync/limiter pacing; CPU is simulation+synchronous submission, not GPU time',
  pooled, runs }, null, 1) + '\n');
