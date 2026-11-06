// tools/capture-hitches.js — CAPTURE_INIT_SCRIPT for hitch attribution (docs/perf-pass-coo.md).
// Like tools/capture-longtasks.js, but keeps what a slow frame was doing: each Long Animation Frame with its top
// scripts (source file, function, invoker, duration), and, with ?compilelog=1, the shader builds, pipelines and buffer
// uploads made after the loading screen (main.js). Both are attached to the report __CITY_APP.frameTimes() returns,
// for entries inside the post-warm-up window, with times relative to the window's start so they line up with the raw
// frame samples. Observers only record browser-provided entries; the served app code is unchanged.
(() => {
  const MAX = 5000, longTasks = [], loafs = [];
  const keep = (list, row) => { list.push(row); if (list.length > MAX) list.shift(); };
  const round = (n) => Math.round(n * 10) / 10;
  const file = (u) => (u || '').split('/').pop().split('?')[0].replace(/\.[a-f0-9]{12}\.js$/, '.js');
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) keep(longTasks, { t: e.startTime, ms: e.duration }); })
      .observe({ type: 'longtask', buffered: true });
  } catch { /* unsupported */ }
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        const scripts = [...(e.scripts || [])].sort((a, b) => b.duration - a.duration).slice(0, 4).map((s) => ({
          ms: round(s.duration), fn: s.sourceFunctionName || '', src: file(s.sourceURL), at: s.sourceCharPosition,
          invoker: (s.invoker || '').slice(0, 80), forcedLayoutMs: round(s.forcedStyleAndLayoutDuration || 0) }));
        keep(loafs, { t: e.startTime, ms: e.duration, blockingMs: e.blockingDuration || 0,
          renderStart: e.renderStart, styleAndLayoutStart: e.styleAndLayoutStart, scripts });
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch { /* unsupported */ }
  // ?gputime=1: every timestamp resolve's frames, total and per-pass GPU ms (three's pool keeps the last resolve's
  // `timestamps` and `frames`), so a window reports GPU ms per frame. Pass intervals can overlap (the shadow maps render
  // inside the first receiver's pass): totals rank arms, they are not exclusive costs.
  const gpu = [];
  const wrapGpu = (app) => {
    const r = app.renderer;
    if (!r?.backend?.trackTimestamp || r.__gpuWrapped) return;
    r.__gpuWrapped = true;
    const orig = r.resolveTimestampsAsync.bind(r);
    r.resolveTimestampsAsync = async (type = 'render') => {
      const v = await orig(type);
      const p = r.backend.timestampQueryPool?.[type];
      if (p?.timestamps?.size && p.frames?.length) {
        const byPass = {}; let total = 0;
        for (const [uid, ms] of p.timestamps) { const k = type[0] + ':' + uid.replace(/:f\d+$/, ''); byPass[k] = (byPass[k] || 0) + ms; total += ms; }
        keep(gpu, { t: performance.now(), type, frames: p.frames.length, total, byPass });
      }
      return v;
    };
  };
  const wrap = () => {
    const app = window.__CITY_APP;
    if (!app || typeof app.frameTimes !== 'function') return false;
    wrapGpu(app);
    if (app.frameTimes.__hitches) return true;
    const original = app.frameTimes;
    const wrapped = function (options) {
      const report = original.call(this, options);
      if (report && report.window) {
        const from = report.window.startMs + report.window.warmupMs, to = report.window.endMs;
        const inside = (rows) => rows.filter((r) => r.t >= from && r.t < to).map((r) => ({ ...r, t: round(r.t - report.window.startMs) }));
        const lf = inside(loafs);
        const compile = app.compileLog ? inside(app.compileLog) : null;
        const g = gpu.filter((e) => e.t >= from && e.t < to);
        const sumBy = (type) => {
          const rows = g.filter((e) => e.type === type), frames = rows.reduce((a, e) => a + e.frames, 0);
          if (!frames) return null;
          const passes = {};
          for (const e of rows) for (const [k, ms] of Object.entries(e.byPass)) passes[k] = (passes[k] || 0) + ms;
          return { resolves: rows.length, frames, totalMsPerFrame: round(rows.reduce((a, e) => a + e.total, 0) / frames * 100) / 100,
            passesMsPerFrame: Object.fromEntries(Object.entries(passes).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, ms]) => [k, Math.round(ms / frames * 1000) / 1000])) };
        };
        report.gpuTimestamps = g.length ? { note: 'three timestamp queries, ms per frame; overlapping intervals, rank only', render: sumBy('render'), compute: sumBy('compute') } : null;
        report.hitches = {
          source: 'tools/capture-hitches.js (PerformanceObserver; ?compilelog=1 main.js log); t relative to window.startMs',
          windowStartMs: round(report.window.startMs), fromMs: round(from), toMs: round(to),
          longTasks: inside(longTasks).map((r) => ({ t: r.t, ms: round(r.ms) })),
          longAnimationFrames: lf.slice(0, 300).map((r) => ({ ...r, ms: round(r.ms), blockingMs: round(r.blockingMs),
            renderStart: round(r.renderStart - report.window.startMs), styleAndLayoutStart: round(r.styleAndLayoutStart - report.window.startMs) })),
          compileLog: compile && {
            entries: compile.length,
            byKind: compile.reduce((m, e) => { m[e.kind] = (m[e.kind] || 0) + 1; return m; }, {}),
            slowest: [...compile].sort((a, b) => b.ms - a.ms).slice(0, 40)
          }
        };
      }
      return report;
    };
    wrapped.__hitches = true;
    app.frameTimes = wrapped;
    return true;
  };
  const timer = setInterval(() => { if (wrap() && window.__CITY_APP?.ready) clearInterval(timer); }, 250);
})();
