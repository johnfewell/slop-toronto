// tools/capture-longtasks.js — CAPTURE_INIT_SCRIPT for idle-baseline runs (docs/adoption-measurements.md).
// Observes Long Tasks (main-thread tasks > 50 ms) and Long Animation Frames, and attaches the entries that start
// inside each metrics window (after warm-up, before stop) to the report returned by __CITY_APP.frameTimes().
// It does not touch the served app code or its hashes; observers only record browser-provided entries.
(() => {
  const MAX = 5000, longTasks = [], loafs = [];
  const keep = (list, row) => { list.push(row); if (list.length > MAX) list.shift(); };
  const round = (n) => Math.round(n * 10) / 10;
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) keep(longTasks, [e.startTime, e.duration]); })
      .observe({ type: 'longtask', buffered: true });
  } catch { /* unsupported entry type: reported as null below */ }
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) keep(loafs, [e.startTime, e.duration, e.blockingDuration || 0]); })
      .observe({ type: 'long-animation-frame', buffered: true });
  } catch { /* unsupported entry type */ }
  const supported = PerformanceObserver.supportedEntryTypes || [];
  const summarize = (rows, from, to) => {
    const inside = rows.filter(([t]) => t >= from && t < to);
    const d = inside.map((r) => r[1]);
    return { count: inside.length, totalMs: round(d.reduce((a, b) => a + b, 0)), maxMs: d.length ? round(Math.max(...d)) : 0,
      over100ms: d.filter((v) => v > 100).length, entries: inside.slice(0, 200).map((r) => r.map(round)) };
  };
  const wrap = () => {
    const app = window.__CITY_APP;
    if (!app || typeof app.frameTimes !== 'function') return false;
    if (app.frameTimes.__longTasks) return true;
    const original = app.frameTimes;
    const wrapped = function (options) {
      const report = original.call(this, options);
      if (report && report.window) {
        const from = report.window.startMs + report.window.warmupMs, to = report.window.endMs;
        report.longTasks = {
          source: 'tools/capture-longtasks.js (PerformanceObserver; entries starting inside the post-warm-up window)',
          fromMs: round(from), toMs: round(to),
          longtask: supported.includes('longtask') ? summarize(longTasks, from, to) : null,
          longAnimationFrame: supported.includes('long-animation-frame') ? summarize(loafs, from, to) : null
        };
      }
      return report;
    };
    wrapped.__longTasks = true;
    app.frameTimes = wrapped;
    return true;
  };
  const timer = setInterval(() => { if (wrap() && window.__CITY_APP?.ready) clearInterval(timer); }, 250);
})();
